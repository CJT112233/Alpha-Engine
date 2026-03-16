/**
 * UPIF Validation Pipeline
 *
 * Sequential validator chain that sanitizes AI-extracted project parameters before
 * they become part of the Unified Project Intake Form. Each validator targets a
 * specific class of misclassification that commonly occurs when LLMs extract
 * structured data from unstructured project descriptions.
 *
 * Pipeline order (as called from the UPIF generation route):
 *   1. rejectBiosolidsOutputProfile — blocks land-application digestate output profile
 *   2. validateAndSanitizeOutputSpecs — sanitizes RNG gas quality specs (solids in gas
 *      section, raw biogas methane <90%, moisture with non-gas units)
 *   3. validateBiogasVsRng — catches methane <90% = raw biogas, not pipeline RNG
 *   4. validateFeedstocksForTypeA — blocks solids-basis params (VS/TS, BMP, C:N) from
 *      wastewater influent; requires flow rate + mg/L analytes
 *   5. validateFeedstocksForTypeD — requires both WW flow AND co-digestion feedstocks
 *   6. validateTypeADesignDrivers — auto-populates BOD/COD/TSS/FOG/TKN drivers +
 *      avg/min/peak flow from industry-specific defaults
 *   7. applyTsTssGuardrail — prevents TS default when only TSS was provided (TSS ≠ TS)
 *   8. applySwapDetection — detects WW-labeled streams with solid specs + no flow =
 *      mis-assigned feedstock data
 *   9. deduplicateParameters — removes duplicate extracted params, keeping highest confidence
 *  10. validateSectionAssignment — catches unit/section mismatches (gas units on solids params)
 *
 * Each validator returns { warnings, feedstocks/sanitized } so the caller can accumulate
 * all warnings and apply all transformations in sequence.
 */

import type { EnrichedOutputSpec } from "@shared/output-criteria-library";
import type { FeedstockEntry, EnrichedFeedstockSpecRecord } from "@shared/schema";
import { getValidationConfigValue } from "./validation-config-loader";

/**
 * ValidationWarning: Structured warning/error emitted by each validator step.
 * Accumulated across the full pipeline and returned to the client for display.
 * Severity levels: "error" = blocks/removes data, "warning" = flags concern, "info" = informational.
 */
export interface ValidationWarning {
  field: string;
  section: string;
  message: string;
  severity: "error" | "warning" | "info";
  originalValue?: string;
  originalUnit?: string;
}

/**
 * PerformanceTarget: Removal efficiency targets extracted from output specs.
 * Separated from concentration limits because they represent design goals
 * (e.g., ">90% BOD removal") rather than discharge limits (e.g., "≤30 mg/L BOD").
 */
export interface PerformanceTarget {
  displayName: string;
  value: string;
  unit: string;
  source: string;
  provenance: string;
  group: string;
}

/** Units that only appear in gas-phase specifications — used to detect misplaced solids data in RNG output profiles */
const GAS_ONLY_UNITS = new Set([
  "lb/mmscf", "ppmv", "mg/m³", "mg/m3", "°f", "°c",
  "dewpoint", "grain/100 scf", "btu/scf", "% ch₄", "% co₂",
  "% n₂", "% o₂", "%", "psig", "psi",
]);

/** Patterns indicating solids-phase data — triggers rejection when found in RNG gas quality section */
const SOLIDS_INDICATOR_PATTERNS = [
  /% ?ts/i,
  /% ?solids/i,
  /\bts\b/i,
  /\bcake\b/i,
  /dewatered/i,
  /mg\/kg/i,
  /dry weight/i,
  /dry basis/i,
];

/** Patterns for removal efficiency values — separated from concentration limits into PerformanceTargets */
const REMOVAL_EFFICIENCY_PATTERNS = [
  /% ?removal/i,
  /removal ?%/i,
  /removal efficiency/i,
  /percent removal/i,
  /reduction/i,
];

/** Moisture/water fields in RNG specs that must have gas-phase units (lb/MMscf, ppmv, dewpoint) */
const RNG_GAS_MOISTURE_KEYS = new Set([
  "waterContent", "moistureContent", "waterDewpoint",
]);

/** Terms that signal wastewater flow data — used by detectWastewaterContext to confirm liquid influent */
const WASTEWATER_FLOW_INDICATORS = [
  "flow", "gpd", "mgd", "gpm", "m³/d", "m3/d", "gallons per day",
  "million gallons", "liters per day", "l/d", "cubic meters",
];

/** Analyte patterns for wastewater influent characterization (mg/L concentrations) */
const WASTEWATER_ANALYTE_PATTERNS = [
  /\bbod\b/i, /\bcod\b/i, /\btss\b/i, /\bfog\b/i, /\btkn\b/i, /\btp\b/i,
  /\btotal suspended/i, /\bbiochemical oxygen/i, /\bchemical oxygen/i,
];

/** Unit patterns that confirm wastewater-style data (mg/L, GPD, MGD, etc.) */
const WASTEWATER_UNIT_INDICATORS = [/mg\/l/i, /mg\/L/i, /gpd/i, /mgd/i, /gpm/i, /m³\/d/i, /m3\/d/i];

/**
 * Explicit sludge terminology — when detected, indicates the AI extracted sludge/biosolids
 * data instead of raw wastewater influent. Sludge is a WWTP byproduct, not an input stream.
 */
const SLUDGE_EXPLICIT_TERMS = [
  "primary sludge", "was ", "waste activated", "sludge blend",
  "sludge thickening", "thickened sludge", "biosolids",
  "primary/was", "was/primary", "dewatered sludge", "digested sludge",
  "waste activated sludge",
];

/** Spec keys that only make sense for sludge, not wastewater influent */
const SLUDGE_ONLY_SPEC_KEYS = new Set([
  "deliveryForm", "receivingCondition", "preprocessingRequirement",
]);

/** Spec keys that are solids-basis assumptions — blocked for wastewater influent characterization */
const SLUDGE_ASSUMPTION_KEYS = new Set([
  "totalSolids", "volatileSolids", "vsTs", "moistureContent",
  "bulkDensity", "cnRatio", "methanePotential", "biodegradableFraction", "inertFraction",
]);

/** Solids-basis spec keys used by applySwapDetection to identify mis-assigned feedstock data */
const FEEDSTOCK_SOLID_SPEC_KEYS = new Set([
  "totalSolids", "volatileSolids", "vsTs", "cnRatio",
  "methanePotential", "biodegradableFraction", "inertFraction",
  "bulkDensity", "moistureContent",
]);

/**
 * Hard-block keys for Type A wastewater projects — these parameters are unconditionally
 * removed from wastewater influent specs because they describe solids, not liquid influent.
 * Includes identity keys (deliveryForm, receivingCondition) that only apply to trucked feedstocks.
 */
const WASTEWATER_HARD_BLOCK_KEYS = new Set([
  "totalSolids", "volatileSolids", "vsTs",
  "methanePotential", "biodegradableFraction", "inertFraction",
  "bulkDensity", "moistureContent", "cnRatio",
  "deliveryForm", "receivingCondition", "preprocessingRequirement",
]);

/**
 * Primary sludge / WAS terminology — blocks feedstock names and spec values containing
 * these terms. Wastewater influent projects should describe the incoming liquid stream,
 * not downstream sludge products.
 */
const PRIMARY_WAS_TERMS = [
  "primary sludge", "waste activated sludge", "was ", "was/",
  "/was", "primary/was", "was blend", "sludge blend",
  "thickened sludge", "dewatered sludge", "digested sludge",
  "biosolids", "return activated", "ras ", "ras/",
];

/**
 * Scans extracted parameters for wastewater-specific signals (flow rates and mg/L analytes).
 * Used by multiple validators to determine if the project describes a liquid influent stream
 * vs. a solids-basis feedstock. Both flow and analytes must be present for full WW confirmation.
 */
function detectWastewaterContext(
  extractedParams: Array<{ name: string; value?: string | null; unit?: string | null }>,
): { hasFlowRate: boolean; hasAnalytes: boolean; detectedAnalytes: string[] } {
  const allText = extractedParams
    .map(p => `${p.name} ${p.value || ""} ${p.unit || ""}`.toLowerCase())
    .join(" ");

  const hasFlowRate = WASTEWATER_FLOW_INDICATORS.some(ind => allText.includes(ind));

  const detectedAnalytes: string[] = [];
  for (const pattern of WASTEWATER_ANALYTE_PATTERNS) {
    if (pattern.test(allText)) {
      detectedAnalytes.push(pattern.source.replace(/\\b/g, "").replace(/\(/g, "").replace(/\)/g, ""));
    }
  }

  const hasUnitMatch = WASTEWATER_UNIT_INDICATORS.some(p => p.test(allText));
  const hasAnalytes = detectedAnalytes.length > 0 || hasUnitMatch;

  return { hasFlowRate, hasAnalytes, detectedAnalytes };
}

/**
 * Checks if extracted parameters contain explicit sludge/biosolids terminology.
 * Used by Type D validator — sludge context suggests the AI confused influent with sludge.
 */
function detectSludgeContext(
  extractedParams: Array<{ name: string; value?: string | null }>,
): boolean {
  const allText = extractedParams.map(p => `${p.name} ${p.value || ""}`).join(" ").toLowerCase();
  return SLUDGE_EXPLICIT_TERMS.some(s => allText.includes(s));
}

/**
 * Validator #1: Rejects the "Solid Digestate - Land Application" output profile entirely.
 * This system produces RNG and/or treated effluent — land-applied biosolids are not a valid
 * output. All criteria from the rejected profile are moved to Unmapped for reference.
 */
export function rejectBiosolidsOutputProfile(
  outputSpecs: Record<string, Record<string, EnrichedOutputSpec>>,
): { sanitized: Record<string, Record<string, EnrichedOutputSpec>>; unmapped: Record<string, EnrichedOutputSpec>; warnings: ValidationWarning[] } {
  const digestateProfile = "Solid Digestate - Land Application";
  const warnings: ValidationWarning[] = [];
  const unmapped: Record<string, EnrichedOutputSpec> = {};

  if (!outputSpecs[digestateProfile]) {
    return { sanitized: outputSpecs, unmapped, warnings };
  }

  const specs = outputSpecs[digestateProfile];
  for (const [key, spec] of Object.entries(specs)) {
    unmapped[`biosolids_rejected_${key}`] = { ...spec, group: "unmapped" };
  }

  warnings.push({
    field: "Solid Digestate - Land Application",
    section: "Output Profiles",
    message: `Biosolids/land application output profile rejected — this system produces RNG and/or treated effluent, not land-applied biosolids. All ${Object.keys(specs).length} criteria moved to Unmapped.`,
    severity: "error",
  });

  const sanitized = { ...outputSpecs };
  delete sanitized[digestateProfile];

  return { sanitized, unmapped, warnings };
}

/**
 * Validator #2: Sanitizes output specifications across all output profiles.
 * For RNG profiles: rejects solids-indicator specs in gas section, catches non-gas moisture
 * units, flags raw biogas methane (<90%) masquerading as pipeline RNG (≥96%), and validates
 * composition field units. For effluent profiles: separates removal efficiency values
 * (e.g., ">90% BOD removal") into PerformanceTargets, keeping only concentration limits.
 */
export function validateAndSanitizeOutputSpecs(
  outputSpecs: Record<string, Record<string, EnrichedOutputSpec>>,
  projectType: string | null,
  extractedParams?: Array<{ name: string; value?: string | null; unit?: string | null }>,
): {
  sanitized: Record<string, Record<string, EnrichedOutputSpec>>;
  unmapped: Record<string, EnrichedOutputSpec>;
  performanceTargets: PerformanceTarget[];
  warnings: ValidationWarning[];
} {
  const sanitized: Record<string, Record<string, EnrichedOutputSpec>> = {};
  const unmapped: Record<string, EnrichedOutputSpec> = {};
  const performanceTargets: PerformanceTarget[] = [];
  const warnings: ValidationWarning[] = [];

  const rngProfile = "Renewable Natural Gas (RNG) - Pipeline Injection";
  const effluentProfile = "Liquid Effluent - Discharge to WWTP";

  for (const [profileName, specs] of Object.entries(outputSpecs)) {
    sanitized[profileName] = {};

    for (const [key, spec] of Object.entries(specs)) {
      const combinedText = `${spec.displayName} ${spec.value} ${spec.unit}`.toLowerCase();

      if (profileName === rngProfile) {
        if (SOLIDS_INDICATOR_PATTERNS.some(p => p.test(combinedText))) {
          warnings.push({
            field: spec.displayName,
            section: "RNG Gas Quality",
            message: `Solids indicator detected in gas section — moved to Unmapped`,
            severity: "warning",
            originalValue: spec.value,
            originalUnit: spec.unit,
          });
          unmapped[`rng_rejected_${key}`] = { ...spec, group: "unmapped" };
          continue;
        }

        if (RNG_GAS_MOISTURE_KEYS.has(key)) {
          const unitLower = spec.unit.toLowerCase();
          const isGasUnit = unitLower.includes("lb/mmscf") ||
            unitLower.includes("ppmv") ||
            unitLower.includes("mg/m") ||
            unitLower.includes("dewpoint") ||
            unitLower.includes("grain");
          if (!isGasUnit && spec.source !== "user_provided") {
            warnings.push({
              field: spec.displayName,
              section: "RNG Gas Quality",
              message: `Non-gas unit "${spec.unit}" for moisture/water field — requires gas-phase units (dewpoint, ppmv, lb/MMscf, mg/m³)`,
              severity: "warning",
              originalValue: spec.value,
              originalUnit: spec.unit,
            });
            unmapped[`rng_unit_${key}`] = { ...spec, group: "unmapped" };
            continue;
          }
        }

        if (key === "methaneFraction" || key === "methane" || combinedText.includes("methane")) {
          const numericValue = parseFloat(spec.value.replace(/[^0-9.]/g, ""));
          if (!isNaN(numericValue) && numericValue < 90 && spec.source !== "user_provided") {
            warnings.push({
              field: spec.displayName,
              section: "RNG Gas Quality",
              message: `Methane value ${spec.value} appears to be raw biogas (<90%), not pipeline-quality RNG (≥96%) — moved to Unmapped`,
              severity: "error",
              originalValue: spec.value,
              originalUnit: spec.unit,
            });
            unmapped[`rng_biogas_${key}`] = { ...spec, group: "unmapped" };
            continue;
          }
        }

        const displayLower = spec.displayName.toLowerCase();
        const isCompositionField = displayLower.includes("content") ||
          displayLower.includes("fraction") ||
          displayLower.includes("composition") ||
          displayLower.includes("concentration");
        if (isCompositionField && spec.unit === "%") {
          // ok
        } else if (isCompositionField && !spec.unit.includes("%") &&
          !GAS_ONLY_UNITS.has(spec.unit.toLowerCase()) &&
          spec.source !== "user_provided") {
          const unitLower = spec.unit.toLowerCase();
          const isAcceptableGasUnit = unitLower.includes("ppmv") ||
            unitLower.includes("lb/mmscf") ||
            unitLower.includes("mg/m") ||
            unitLower.includes("grain") ||
            unitLower.includes("btu");
          if (!isAcceptableGasUnit) {
            warnings.push({
              field: spec.displayName,
              section: "RNG Gas Quality",
              message: `Composition field "${spec.displayName}" has non-percentage/non-gas unit "${spec.unit}" — expected % or gas-phase unit`,
              severity: "warning",
              originalValue: spec.value,
              originalUnit: spec.unit,
            });
            unmapped[`rng_unit_mismatch_${key}`] = { ...spec, group: "unmapped" };
            continue;
          }
        }
      }

      if (profileName === effluentProfile) {
        const valText = `${spec.value} ${spec.unit}`.toLowerCase();
        if (REMOVAL_EFFICIENCY_PATTERNS.some(p => p.test(valText)) ||
            (valText.includes("%") && !valText.includes("mg/l") && !valText.includes("mg/L") &&
             (valText.includes(">") || valText.includes("≥")) && !valText.includes("ch") && !valText.includes("co2"))) {
          performanceTargets.push({
            displayName: spec.displayName,
            value: spec.value,
            unit: spec.unit,
            source: spec.source,
            provenance: spec.provenance,
            group: "performance_targets",
          });
          warnings.push({
            field: spec.displayName,
            section: "Effluent Limits",
            message: `Removal efficiency separated from concentration limits — moved to Performance Targets`,
            severity: "info",
          });
          continue;
        }
      }

      sanitized[profileName][key] = spec;
    }

    if (Object.keys(sanitized[profileName]).length === 0) {
      delete sanitized[profileName];
    }
  }

  return { sanitized, unmapped, performanceTargets, warnings };
}

/**
 * Validator #4: Type A (Wastewater Treatment) feedstock sanitization.
 * Enforces that wastewater projects describe liquid influent, not solids:
 * - Requires at least one flow rate (GPD/MGD/m³/d) AND one mg/L analyte (BOD/COD/TSS)
 * - Hard-blocks all solids-basis parameters (VS/TS, BMP, C:N, delivery form, etc.)
 * - Rejects BMP units (m³/kg VS, L/kg VS, ft³/lb) which are solids-basis metrics
 * - Blocks primary/WAS sludge terminology in spec names and values
 */
export function validateFeedstocksForTypeA(
  feedstocks: FeedstockEntry[],
  extractedParams: Array<{ name: string; value?: string | null; category: string; unit?: string | null }>,
  projectType: string | null,
): {
  feedstocks: FeedstockEntry[];
  warnings: ValidationWarning[];
  missingRequired: string[];
} {
  const warnings: ValidationWarning[] = [];
  const missingRequired: string[] = [];
  const isTypeA = projectType === "A";

  if (!isTypeA) {
    return { feedstocks, warnings, missingRequired };
  }

  const { hasFlowRate, hasAnalytes, detectedAnalytes } = detectWastewaterContext(extractedParams);
  const isWastewaterInfluent = hasFlowRate || hasAnalytes;

  if (!isWastewaterInfluent) {
    if (!hasFlowRate) {
      missingRequired.push("Influent flow rate (GPD, MGD, m³/d, or similar)");
    }
    if (!hasAnalytes) {
      missingRequired.push("At least one influent concentration (BOD, COD, or TSS in mg/L)");
    }
    warnings.push({
      field: "Type A Required Inputs",
      section: "Completeness Check",
      message: `Missing required influent data: ${missingRequired.join("; ")}`,
      severity: "error",
    });
    return { feedstocks, warnings, missingRequired };
  }

  const sanitizedFeedstocks = feedstocks.map((fs, idx) => {
    if (!fs.feedstockSpecs) return fs;

    const cleanSpecs: EnrichedFeedstockSpecRecord = {};
    let blockedCount = 0;

    for (const [key, spec] of Object.entries(fs.feedstockSpecs)) {
      if (WASTEWATER_HARD_BLOCK_KEYS.has(key)) {
        blockedCount++;
        warnings.push({
          field: spec.displayName,
          section: `Feedstock ${idx + 1}`,
          message: `Blocked — wastewater influent detected (flow/mg/L analytes present). "${spec.displayName}" (${spec.value} ${spec.unit}) is a solids-basis parameter not applicable to liquid influent characterization.`,
          severity: "warning",
          originalValue: spec.value,
          originalUnit: spec.unit,
        });
        continue;
      }

      const specNameLower = spec.displayName.toLowerCase();
      const specValueLower = (spec.value || "").toLowerCase();
      const specUnitLower = spec.unit.toLowerCase();
      const isBmpUnit = specUnitLower.includes("m³/kg") || specUnitLower.includes("m3/kg") ||
        specUnitLower.includes("l/kg") || specUnitLower.includes("ft³/lb") || specUnitLower.includes("ft3/lb");
      if (isBmpUnit) {
        blockedCount++;
        warnings.push({
          field: spec.displayName,
          section: `Feedstock ${idx + 1}`,
          message: `Blocked — BMP unit "${spec.unit}" is a solids-basis metric, not applicable to wastewater influent.`,
          severity: "warning",
          originalValue: spec.value,
          originalUnit: spec.unit,
        });
        continue;
      }

      const hasPrimaryWasLang = PRIMARY_WAS_TERMS.some(t =>
        specNameLower.includes(t) || specValueLower.includes(t));
      if (hasPrimaryWasLang) {
        blockedCount++;
        warnings.push({
          field: spec.displayName,
          section: `Feedstock ${idx + 1}`,
          message: `Blocked — primary/WAS sludge language detected in "${spec.displayName}". Wastewater influent section should describe incoming liquid stream, not sludge byproducts.`,
          severity: "warning",
          originalValue: spec.value,
          originalUnit: spec.unit,
        });
        continue;
      }

      cleanSpecs[key] = spec;
    }

    const fsNameLower = (fs.feedstockType || "").toLowerCase();
    const hasFsNameSludge = PRIMARY_WAS_TERMS.some(t => fsNameLower.includes(t));
    if (hasFsNameSludge) {
      warnings.push({
        field: "Feedstock Type",
        section: `Feedstock ${idx + 1}`,
        message: `Feedstock name "${fs.feedstockType}" contains primary/WAS sludge terminology — wastewater influent projects should describe the incoming liquid stream (e.g., "Municipal Wastewater Influent"), not sludge.`,
        severity: "error",
      });
    }

    if (blockedCount > 0) {
      warnings.push({
        field: "Solids-Basis Parameters",
        section: `Feedstock ${idx + 1}`,
        message: `Removed ${blockedCount} solids-basis parameter(s) (VS/TS, BMP, delivery form, etc.) — Feedstock section should display influent analytes (BOD/COD/TSS/FOG in mg/L) + flow rate instead.`,
        severity: "info",
      });
    }

    return { ...fs, feedstockSpecs: cleanSpecs };
  });

  if (!hasFlowRate) {
    missingRequired.push("Influent flow rate (GPD, MGD, m³/d, or similar)");
  }
  if (!hasAnalytes) {
    missingRequired.push("At least one influent concentration (BOD, COD, or TSS in mg/L)");
  }

  if (missingRequired.length > 0) {
    warnings.push({
      field: "Type A Required Inputs",
      section: "Completeness Check",
      message: `Missing required influent data: ${missingRequired.join("; ")} — Feedstock section requires influent analytes + flow.`,
      severity: "error",
    });
  } else {
    warnings.push({
      field: "Wastewater Influent Mode",
      section: "Type A Gate",
      message: `Wastewater influent detected — Feedstock section locked to influent analytes (${detectedAnalytes.length > 0 ? detectedAnalytes.join(", ") : "BOD/COD/TSS"}) + flow. All solids-basis parameters (VS/TS, BMP, C:N, etc.) blocked.`,
      severity: "info",
    });
  }

  return { feedstocks: sanitizedFeedstocks, warnings, missingRequired };
}

/**
 * Validator #5: Type D (Hybrid) feedstock completeness check.
 * Hybrid projects require BOTH wastewater flow/analytes AND trucked-in co-digestion feedstocks.
 * Also applies the same solids-basis blocking as Type A for any wastewater-labeled streams,
 * while allowing solids-basis specs on the co-digestion feedstock streams.
 */
export function validateFeedstocksForTypeD(
  feedstocks: FeedstockEntry[],
  extractedParams: Array<{ name: string; value?: string | null; category: string; unit?: string | null }>,
  projectType: string | null,
): {
  feedstocks: FeedstockEntry[];
  warnings: ValidationWarning[];
  missingRequired: string[];
} {
  const warnings: ValidationWarning[] = [];
  const missingRequired: string[] = [];

  if (projectType !== "D") {
    return { feedstocks, warnings, missingRequired };
  }

  const hasSludgeContext = detectSludgeContext(extractedParams);
  const { hasFlowRate, hasAnalytes, detectedAnalytes } = detectWastewaterContext(extractedParams);

  if (!hasFlowRate) {
    missingRequired.push("At least one wastewater flow value (GPD, MGD, m³/d, or similar)");
  }
  if (!hasAnalytes) {
    missingRequired.push("At least one wastewater analyte (BOD, COD, or TSS in mg/L)");
  }

  let hasTruckedFeedstock = false;
  for (const fs of feedstocks) {
    const typeLower = (fs.feedstockType || "").toLowerCase();
    const isWastewaterStream = typeLower.includes("wastewater") ||
      typeLower.includes("influent") ||
      typeLower.includes("sewage") ||
      typeLower.includes("municipal");
    if (!isWastewaterStream && fs.feedstockType && fs.feedstockVolume) {
      hasTruckedFeedstock = true;
    }
  }

  if (!hasTruckedFeedstock) {
    missingRequired.push("At least one trucked-in feedstock identity + quantity");
  }

  if (missingRequired.length > 0) {
    warnings.push({
      field: "Type D Required Inputs",
      section: "Completeness Check",
      message: `Missing required items for hybrid project: ${missingRequired.join("; ")}`,
      severity: "error",
    });
  }

  const sanitizedFeedstocks = feedstocks.map((fs, idx) => {
    if (!fs.feedstockSpecs) return fs;

    const typeLower = (fs.feedstockType || "").toLowerCase();
    const isWastewaterStream = typeLower.includes("wastewater") ||
      typeLower.includes("influent") ||
      typeLower.includes("sewage") ||
      typeLower.includes("municipal");

    if (!isWastewaterStream) return fs;

    const cleanSpecs: EnrichedFeedstockSpecRecord = {};
    let blockedCount = 0;

    for (const [key, spec] of Object.entries(fs.feedstockSpecs)) {
      if (WASTEWATER_HARD_BLOCK_KEYS.has(key)) {
        blockedCount++;
        warnings.push({
          field: spec.displayName,
          section: `Feedstock ${idx + 1} (Wastewater)`,
          message: `Blocked — wastewater influent detected. "${spec.displayName}" (${spec.value} ${spec.unit}) is a solids-basis parameter not applicable to liquid influent characterization.`,
          severity: "warning",
          originalValue: spec.value,
          originalUnit: spec.unit,
        });
        continue;
      }

      const specUnitLower = spec.unit.toLowerCase();
      const isBmpUnit = specUnitLower.includes("m³/kg") || specUnitLower.includes("m3/kg") ||
        specUnitLower.includes("l/kg") || specUnitLower.includes("ft³/lb") || specUnitLower.includes("ft3/lb");
      if (isBmpUnit) {
        blockedCount++;
        warnings.push({
          field: spec.displayName,
          section: `Feedstock ${idx + 1} (Wastewater)`,
          message: `Blocked — BMP unit "${spec.unit}" is a solids-basis metric, not applicable to wastewater influent.`,
          severity: "warning",
          originalValue: spec.value,
          originalUnit: spec.unit,
        });
        continue;
      }

      const specNameLower = spec.displayName.toLowerCase();
      const specValueLower = (spec.value || "").toLowerCase();
      const hasPrimaryWasLang = PRIMARY_WAS_TERMS.some(t =>
        specNameLower.includes(t) || specValueLower.includes(t));
      if (hasPrimaryWasLang) {
        blockedCount++;
        warnings.push({
          field: spec.displayName,
          section: `Feedstock ${idx + 1} (Wastewater)`,
          message: `Blocked — primary/WAS sludge language detected in "${spec.displayName}". Wastewater influent section should describe incoming liquid stream, not sludge byproducts.`,
          severity: "warning",
          originalValue: spec.value,
          originalUnit: spec.unit,
        });
        continue;
      }

      cleanSpecs[key] = spec;
    }

    if (blockedCount > 0) {
      warnings.push({
        field: "Solids-Basis Parameters",
        section: `Feedstock ${idx + 1} (Wastewater)`,
        message: `Removed ${blockedCount} solids-basis parameter(s) (VS/TS, BMP, delivery form, etc.) — wastewater stream should display influent analytes (BOD/COD/TSS/FOG in mg/L) + flow rate instead.`,
        severity: "info",
      });
    }

    return { ...fs, feedstockSpecs: cleanSpecs };
  });

  return { feedstocks: sanitizedFeedstocks, warnings, missingRequired };
}

/**
 * Validator #8: Swap detection for mis-assigned feedstock data.
 * Catches the case where a wastewater-labeled stream (e.g., "Municipal Wastewater") contains
 * solids-basis specs (TS%, VS%, BMP) but NO flow rate or mg/L analytes exist anywhere in
 * the extracted parameters. This pattern indicates the AI confused a trucked feedstock
 * (e.g., food waste) with wastewater. The solids specs are moved to Unmapped for review.
 */
export function applySwapDetection(
  feedstocks: FeedstockEntry[],
  extractedParams: Array<{ name: string; value?: string | null; unit?: string | null }>,
): { feedstocks: FeedstockEntry[]; warnings: ValidationWarning[]; swappedSpecs: Record<string, any> } {
  const warnings: ValidationWarning[] = [];
  const swappedSpecs: Record<string, any> = {};
  const { hasFlowRate, hasAnalytes } = detectWastewaterContext(extractedParams);

  const sanitized = feedstocks.map((fs, idx) => {
    if (!fs.feedstockSpecs) return fs;

    const typeLower = (fs.feedstockType || "").toLowerCase();
    const isWastewaterStream = typeLower.includes("wastewater") ||
      typeLower.includes("influent") ||
      typeLower.includes("sewage") ||
      typeLower.includes("municipal");

    if (!isWastewaterStream) return fs;

    const hasSolidSpecs = Object.keys(fs.feedstockSpecs).some(k => FEEDSTOCK_SOLID_SPEC_KEYS.has(k));

    if (hasSolidSpecs && !hasFlowRate && !hasAnalytes) {
      const cleanSpecs: EnrichedFeedstockSpecRecord = {};

      for (const [key, spec] of Object.entries(fs.feedstockSpecs)) {
        if (FEEDSTOCK_SOLID_SPEC_KEYS.has(key)) {
          swappedSpecs[`swap_${idx}_${key}`] = {
            value: spec.value,
            unit: spec.unit,
            source: spec.source,
            confidence: spec.confidence,
            provenance: `Swap detection: moved from wastewater stream "${fs.feedstockType}" — likely mis-assigned feedstock parameter`,
            group: "unmapped",
            displayName: spec.displayName,
            sortOrder: 99,
          };
        } else {
          cleanSpecs[key] = spec;
        }
      }

      warnings.push({
        field: `Feedstock ${idx + 1}: ${fs.feedstockType}`,
        section: "Swap Detection",
        message: `Wastewater-labeled stream contains TS%/moisture/BMP but no flow or mg/L analytes exist — parameters re-routed to Unmapped as likely mis-assigned feedstock data`,
        severity: "error",
      });

      return { ...fs, feedstockSpecs: cleanSpecs };
    }

    return fs;
  });

  return { feedstocks: sanitized, warnings, swappedSpecs };
}

/**
 * Validator #3: Biogas vs RNG methane content check.
 * Raw biogas has 55-65% CH₄; pipeline-quality RNG requires ≥96% CH₄.
 * If any methane field in the RNG output profile shows <90%, it's raw biogas data
 * that was incorrectly placed in the RNG section. Moved to Unmapped with error severity.
 */
export function validateBiogasVsRng(
  outputSpecs: Record<string, Record<string, EnrichedOutputSpec>>,
): { sanitized: Record<string, Record<string, EnrichedOutputSpec>>; unmapped: Record<string, EnrichedOutputSpec>; warnings: ValidationWarning[] } {
  const rngProfile = "Renewable Natural Gas (RNG) - Pipeline Injection";
  const warnings: ValidationWarning[] = [];
  const unmapped: Record<string, EnrichedOutputSpec> = {};

  if (!outputSpecs[rngProfile]) {
    return { sanitized: outputSpecs, unmapped, warnings };
  }

  const sanitized = { ...outputSpecs };
  const rngSpecs = { ...sanitized[rngProfile] };

  for (const [key, spec] of Object.entries(rngSpecs)) {
    const displayLower = spec.displayName.toLowerCase();
    const isMethaneField = displayLower.includes("methane") ||
      displayLower.includes("ch4") ||
      displayLower.includes("ch₄") ||
      key === "methaneFraction" || key === "methane";

    if (!isMethaneField) continue;

    const numericValue = parseFloat(spec.value.replace(/[^0-9.]/g, ""));
    if (isNaN(numericValue)) continue;

    if (numericValue < 90) {
      warnings.push({
        field: spec.displayName,
        section: "RNG Gas Quality",
        message: `Methane ${spec.value}${spec.unit} is raw biogas (<90%), not pipeline-quality RNG (≥96%). Biogas methane values must not appear in RNG gas-quality table.`,
        severity: "error",
        originalValue: spec.value,
        originalUnit: spec.unit,
      });
      unmapped[`biogas_methane_${key}`] = { ...spec, group: "unmapped" };
      delete rngSpecs[key];
    }
  }

  sanitized[rngProfile] = rngSpecs;
  if (Object.keys(rngSpecs).length === 0) {
    delete sanitized[rngProfile];
  }

  return { sanitized, unmapped, warnings };
}

/**
 * Validator #7: TS/TSS disambiguation guardrail.
 * TSS (Total Suspended Solids, mg/L) ≠ TS (Total Solids, % wet basis).
 * If the user provided TSS but NOT TS, the library may have auto-populated a TS default.
 * This validator removes that TS default to prevent confusion — TSS is a water quality
 * analyte while TS is a solids characterization parameter.
 */
export function applyTsTssGuardrail(
  feedstocks: FeedstockEntry[],
  extractedParams: Array<{ name: string; value?: string | null; unit?: string | null }>,
): { feedstocks: FeedstockEntry[]; warnings: ValidationWarning[] } {
  const warnings: ValidationWarning[] = [];
  const allText = extractedParams.map(p => `${p.name} ${p.value || ""} ${p.unit || ""}`.toLowerCase()).join(" ");
  const hasTSSExplicit = allText.includes("tss") || allText.includes("total suspended solids") || allText.includes("suspended solids");
  const hasTSExplicit = /\btotal solids\b/.test(allText) || /\bts\s*[=:]\s*\d/.test(allText) || /\bts\s*%/.test(allText);

  const sanitized = feedstocks.map((fs, idx) => {
    if (!fs.feedstockSpecs) return fs;
    const specs = { ...fs.feedstockSpecs };

    if (specs.totalSolids && specs.totalSolids.source === "estimated_default") {
      if (hasTSSExplicit && !hasTSExplicit) {
        warnings.push({
          field: "Total Solids",
          section: `Feedstock ${idx + 1}`,
          message: `TSS detected but TS was not explicitly provided — removing TS default to avoid confusion (TSS ≠ TS)`,
          severity: "warning",
        });
        delete specs.totalSolids;
      }
    }

    return { ...fs, feedstockSpecs: specs };
  });

  return { feedstocks: sanitized, warnings };
}

/**
 * Validator #9: Removes duplicate extracted parameters, keeping the one with highest confidence.
 * Duplicates are identified by category + normalized name. When the AI extracts from multiple
 * document sections, the same parameter may appear twice with different confidence levels.
 * Confidence ranking: high (3) > medium (2) > low (1).
 */
export function deduplicateParameters(
  params: Array<{ name: string; value?: string | null; category: string; confidence?: string | null; unit?: string | null; source?: string | null }>,
): Array<{ name: string; value?: string | null; category: string; confidence?: string | null; unit?: string | null; source?: string | null }> {
  const seen = new Map<string, typeof params[0]>();
  const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };

  for (const param of params) {
    const key = `${param.category}::${param.name.toLowerCase().trim()}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, param);
    } else {
      const existingRank = confidenceRank[existing.confidence || "low"] || 0;
      const newRank = confidenceRank[param.confidence || "low"] || 0;
      if (newRank > existingRank) {
        seen.set(key, param);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Validator #10: Cross-checks parameter units against their assigned section.
 * Catches physically impossible combinations like solids parameters (TSS, sludge) with
 * gas-phase units (ppmv, lb/MMscf), or gas parameters (methane, H₂S) with solids units
 * (mg/kg, dry basis). Mismatched items are moved to Unmapped.
 */
export function validateSectionAssignment(
  params: Array<{ name: string; value?: string | null; category: string; unit?: string | null }>,
): { valid: typeof params; unmapped: typeof params; warnings: ValidationWarning[] } {
  const valid: typeof params = [];
  const unmappedParams: typeof params = [];
  const warnings: ValidationWarning[] = [];

  const gasUnitPatterns = [/ppmv/i, /lb\/mmscf/i, /mg\/m[³3]/i, /btu\/scf/i, /grain/i, /psig/i, /% ?ch/i, /% ?co/i, /% ?n₂/i, /% ?o₂/i];
  const liquidUnitPatterns = [/mg\/l/i, /gpd/i, /mgd/i, /m³\/d/i, /gpm/i, /°[fc]/i];
  const solidsUnitPatterns = [/mg\/kg/i, /dry weight/i, /dry basis/i, /% ?\(dewatered/i];

  for (const param of params) {
    const valUnit = `${param.value || ""} ${param.unit || ""}`.toLowerCase();
    const nameLower = param.name.toLowerCase();

    if (param.category === "output_requirements" || param.category === "output requirements") {
      const isGas = gasUnitPatterns.some(p => p.test(valUnit));
      const isSolid = solidsUnitPatterns.some(p => p.test(valUnit));

      if (isGas && (nameLower.includes("tss") || nameLower.includes("total suspended") || nameLower.includes("sludge"))) {
        warnings.push({
          field: param.name,
          section: "Output Requirements",
          message: `Solids parameter "${param.name}" has gas-phase units — moved to Unmapped`,
          severity: "warning",
        });
        unmappedParams.push(param);
        continue;
      }

      if (isSolid && (nameLower.includes("methane") || nameLower.includes("ch4") || nameLower.includes("h2s"))) {
        warnings.push({
          field: param.name,
          section: "Output Requirements",
          message: `Gas parameter "${param.name}" has solids units — moved to Unmapped`,
          severity: "warning",
        });
        unmappedParams.push(param);
        continue;
      }
    }

    valid.push(param);
  }

  return { valid, unmapped: unmappedParams, warnings };
}

/**
 * Core wastewater design drivers that must be present in the UPIF for Type A/D projects.
 * Each driver defines matching rules (by key and display name patterns) so the validator
 * can check whether the AI successfully extracted it from the user's input.
 * Missing drivers are auto-populated from INDUSTRY_DEFAULTS based on feedstock type.
 */
const TYPE_A_DESIGN_DRIVER_SPECS: Array<{
  label: string;
  matchKeys: string[];
  matchDisplayNames: RegExp[];
}> = [
  {
    label: "BOD",
    matchKeys: ["bod", "bod5", "biochemicalOxygenDemand"],
    matchDisplayNames: [/\bbod[_\s]?5?\b/i, /biochemical oxygen demand/i],
  },
  {
    label: "COD",
    matchKeys: ["cod", "chemicalOxygenDemand"],
    matchDisplayNames: [/\bcod\b/i, /chemical oxygen demand/i],
  },
  {
    label: "TSS",
    matchKeys: ["tss", "totalSuspendedSolids"],
    matchDisplayNames: [/\btss\b/i, /total suspended solids/i],
  },
  {
    label: "FOG",
    matchKeys: ["fogContent", "fog", "fatsOilsGrease"],
    matchDisplayNames: [/\bfog\b/i, /fats[\s,]*oils[\s,]*(?:and\s*)?grease/i, /\bo&g\b/i, /\boil\s*(?:and|&)\s*grease/i],
  },
  {
    label: "TKN",
    matchKeys: ["tkn", "nitrogen", "totalKjeldahlNitrogen"],
    matchDisplayNames: [/\btkn\b/i, /total kjeldahl nitrogen/i, /total nitrogen/i],
  },
  {
    label: "pH",
    matchKeys: ["ph", "phLevel"],
    matchDisplayNames: [/\bph\b/i, /ph[\s_-]?level/i, /ph[\s_-]?range/i],
  },
];

const FLOW_AVG_PATTERNS = [
  /\bavg\.?\s*(?:daily\s*)?flow/i, /\baverage\s*(?:daily\s*)?flow/i,
  /\badf\b/i, /\badwf\b/i, /\baadf\b/i,
  /\bflow\s*\(avg/i, /\bflow\s*-\s*avg/i,
  /\bdesign\s*(?:avg\.?\s*)?flow/i,
  /\binfluent\s*flow\b/i,
];

const FLOW_MIN_PATTERNS = [
  /\bmin(?:imum)?\s*(?:daily\s*)?flow/i,
  /\blow\s*(?:daily\s*)?flow/i,
  /\bflow\s*\(min/i, /\bflow\s*-\s*min/i,
  /\bmin\s*flow/i,
];

const FLOW_PEAK_PATTERNS = [
  /\bpeak\s*(?:daily\s*)?flow/i, /\bpeak\s*(?:hourly\s*)?flow/i,
  /\bpdf\b/i, /\bphf\b/i, /\bpwwf\b/i, /\bmdwf\b/i,
  /\bmax(?:imum)?\s*(?:daily\s*)?flow/i, /\bmax\s*(?:hourly\s*)?flow/i,
  /\bpeak\s*wet\s*weather/i,
  /\bflow\s*\(peak/i, /\bflow\s*-\s*peak/i,
];

const FLOW_GENERIC_PATTERN = /\bflow\b/i;

function specMatchesDriver(
  key: string,
  displayName: string,
  matchKeys: string[],
  matchDisplayNames: RegExp[],
): boolean {
  const keyLower = key.toLowerCase();
  if (matchKeys.some(mk => keyLower === mk.toLowerCase())) return true;
  if (matchDisplayNames.some(p => p.test(displayName))) return true;
  return false;
}

function detectFlowInSpecs(
  feedstocks: FeedstockEntry[],
  extractedParams: Array<{ name: string; value?: string | null; unit?: string | null; category?: string }>,
): { hasAvgFlow: boolean; hasMinFlow: boolean; hasPeakFlow: boolean } {
  let hasAvgFlow = false;
  let hasMinFlow = false;
  let hasPeakFlow = false;
  let hasGenericFlow = false;

  for (const fs of feedstocks) {
    if (fs.feedstockSpecs) {
      for (const [, spec] of Object.entries(fs.feedstockSpecs)) {
        const dn = spec.displayName;
        if (FLOW_PEAK_PATTERNS.some(p => p.test(dn))) hasPeakFlow = true;
        else if (FLOW_MIN_PATTERNS.some(p => p.test(dn))) hasMinFlow = true;
        else if (FLOW_AVG_PATTERNS.some(p => p.test(dn))) hasAvgFlow = true;
        else if (FLOW_GENERIC_PATTERN.test(dn)) hasGenericFlow = true;
      }
    }
    const volUnit = (fs.feedstockUnit || "").toLowerCase();
    const isFlowUnit = /mgd|gpd|gpm|m³\/d|m3\/d|gallons?\s*per\s*day|liters?\s*per\s*day|l\/d/i.test(volUnit);
    if (isFlowUnit && fs.feedstockVolume) {
      hasAvgFlow = true;
    }
  }

  const feedstockParams = extractedParams.filter(p => {
    const cat = (p.category || "").toLowerCase();
    return cat === "feedstock" || cat === "input";
  });
  for (const p of feedstockParams) {
    const text = `${p.name} ${p.value || ""}`;
    if (FLOW_PEAK_PATTERNS.some(pat => pat.test(text))) hasPeakFlow = true;
    else if (FLOW_MIN_PATTERNS.some(pat => pat.test(text))) hasMinFlow = true;
    else if (FLOW_AVG_PATTERNS.some(pat => pat.test(text))) hasAvgFlow = true;
    else if (FLOW_GENERIC_PATTERN.test(text)) hasGenericFlow = true;
  }

  if (hasGenericFlow && !hasAvgFlow) {
    hasAvgFlow = true;
  }

  return { hasAvgFlow, hasMinFlow, hasPeakFlow };
}

interface IndustryDefaults {
  bod: string;
  cod: string;
  tss: string;
  fog: string;
  tkn: string;
  ph: string;
  peakFlowMultiplier: number;
}

/**
 * Industry-specific influent characterization defaults (all concentrations in mg/L).
 * Used by validateTypeADesignDrivers to auto-populate missing design drivers.
 * Values are typical ranges from industry literature and EPA CWNS data.
 * peakFlowMultiplier: ratio of peak daily flow to average daily flow.
 */
const INDUSTRY_DEFAULTS: Record<string, IndustryDefaults> = {
  dairy:    { bod: "2,000-6,000", cod: "4,000-10,000", tss: "500-2,000",   fog: "200-800",  tkn: "50-150",   ph: "4.0-7.0",  peakFlowMultiplier: 2.0 },
  meat:     { bod: "1,500-5,000", cod: "3,000-8,000",  tss: "800-3,000",   fog: "100-500",  tkn: "80-200",   ph: "6.0-7.5",  peakFlowMultiplier: 2.5 },
  poultry:  { bod: "1,200-4,000", cod: "2,500-7,000",  tss: "600-2,500",   fog: "100-400",  tkn: "80-250",   ph: "6.0-7.5",  peakFlowMultiplier: 2.0 },
  produce:  { bod: "500-3,000",   cod: "1,000-5,000",  tss: "200-1,500",   fog: "50-200",   tkn: "20-80",    ph: "4.0-6.0",  peakFlowMultiplier: 2.0 },
  potato:   { bod: "2,000-5,000", cod: "3,500-8,000",  tss: "1,000-3,000", fog: "50-200",   tkn: "30-100",   ph: "5.0-7.0",  peakFlowMultiplier: 2.0 },
  beverage: { bod: "500-2,000",   cod: "1,000-4,000",  tss: "200-800",     fog: "20-100",   tkn: "15-50",    ph: "3.0-6.0",  peakFlowMultiplier: 1.5 },
  brewery:  { bod: "1,000-3,000", cod: "2,000-6,000",  tss: "300-1,000",   fog: "20-80",    tkn: "25-80",    ph: "4.0-7.0",  peakFlowMultiplier: 1.5 },
  winery:   { bod: "1,500-5,000", cod: "3,000-10,000", tss: "300-1,500",   fog: "20-80",    tkn: "20-60",    ph: "3.5-5.5",  peakFlowMultiplier: 3.0 },
  seafood:  { bod: "1,000-4,000", cod: "2,000-7,000",  tss: "500-2,000",   fog: "100-400",  tkn: "60-150",   ph: "6.0-7.5",  peakFlowMultiplier: 2.0 },
  bakery:   { bod: "1,000-3,000", cod: "2,000-5,000",  tss: "400-1,500",   fog: "100-500",  tkn: "20-60",    ph: "4.0-7.0",  peakFlowMultiplier: 1.5 },
  default:  { bod: "1,000-4,000", cod: "2,000-7,000",  tss: "500-2,000",   fog: "100-400",  tkn: "30-100",   ph: "5.0-7.0",  peakFlowMultiplier: 2.0 },
};

/**
 * Matches feedstock type names against industry keywords to select the appropriate
 * set of default influent characteristics. Falls back to generic "default" profile
 * if no industry match is found. Handles synonyms (e.g., "cheese" → dairy).
 */
function detectIndustryType(feedstocks: FeedstockEntry[]): IndustryDefaults {
  const allText = feedstocks.map(fs => (fs.feedstockType || "").toLowerCase()).join(" ");
  for (const [key, defaults] of Object.entries(INDUSTRY_DEFAULTS)) {
    if (key === "default") continue;
    if (allText.includes(key)) return defaults;
  }
  if (allText.includes("milk") || allText.includes("cheese") || allText.includes("yogurt") || allText.includes("whey")) return INDUSTRY_DEFAULTS.dairy;
  if (allText.includes("slaughter") || allText.includes("rendering") || allText.includes("beef") || allText.includes("pork")) return INDUSTRY_DEFAULTS.meat;
  if (allText.includes("chicken") || allText.includes("turkey") || allText.includes("egg")) return INDUSTRY_DEFAULTS.poultry;
  if (allText.includes("vegetable") || allText.includes("fruit") || allText.includes("salad") || allText.includes("juice")) return INDUSTRY_DEFAULTS.produce;
  if (allText.includes("spud") || allText.includes("french fry") || allText.includes("starch")) return INDUSTRY_DEFAULTS.potato;
  if (allText.includes("beer") || allText.includes("ale") || allText.includes("hops")) return INDUSTRY_DEFAULTS.brewery;
  if (allText.includes("wine") || allText.includes("grape") || allText.includes("crush")) return INDUSTRY_DEFAULTS.winery;
  if (allText.includes("soda") || allText.includes("soft drink") || allText.includes("bottling") || allText.includes("distill")) return INDUSTRY_DEFAULTS.beverage;
  if (allText.includes("fish") || allText.includes("shrimp") || allText.includes("crab") || allText.includes("shellfish")) return INDUSTRY_DEFAULTS.seafood;
  if (allText.includes("bread") || allText.includes("dough") || allText.includes("flour") || allText.includes("baking")) return INDUSTRY_DEFAULTS.bakery;
  return INDUSTRY_DEFAULTS.default;
}

/**
 * Validator #6: Type A/D design driver completeness + auto-population.
 * Checks for all core wastewater design drivers (flow avg/min/peak, BOD, COD, TSS, FOG, TKN, pH).
 * Missing drivers from the AUTO_POPULATE set are filled with industry-typical defaults based on
 * feedstock type (e.g., dairy → 2,000-6,000 mg/L BOD). Min/peak flow are derived from average
 * flow using configurable multipliers (min: 0.6x default, peak: industry-specific 1.5-3.0x).
 * For Type D, only targets wastewater-labeled feedstock streams (not co-digestion streams).
 */
export async function validateTypeADesignDrivers(
  feedstocks: FeedstockEntry[],
  extractedParams: Array<{ name: string; value?: string | null; unit?: string | null; category?: string }>,
  projectType: string | null,
): Promise<{ warnings: ValidationWarning[]; feedstocks: FeedstockEntry[] }> {
  const warnings: ValidationWarning[] = [];

  if (projectType !== "A" && projectType !== "D") {
    return { warnings, feedstocks };
  }

  const typeLabel = projectType === "D" ? "Type D (Wastewater)" : "Type A";

  const targetFeedstockIndices: number[] = [];
  if (projectType === "D") {
    feedstocks.forEach((fs, idx) => {
      const typeLower = (fs.feedstockType || "").toLowerCase();
      const isWastewater = typeLower.includes("wastewater") ||
        typeLower.includes("influent") ||
        typeLower.includes("sewage") ||
        typeLower.includes("municipal");
      if (isWastewater) targetFeedstockIndices.push(idx);
    });
    if (targetFeedstockIndices.length === 0) {
      targetFeedstockIndices.push(0);
    }
  } else {
    targetFeedstockIndices.push(0);
  }

  const { hasAvgFlow, hasMinFlow, hasPeakFlow } = detectFlowInSpecs(feedstocks, extractedParams);
  const missingDrivers: string[] = [];

  if (!hasAvgFlow) missingDrivers.push("Average Flow");
  if (!hasMinFlow) missingDrivers.push("Min Flow");
  if (!hasPeakFlow) missingDrivers.push("Peak Flow");

  const feedstockParams = extractedParams.filter(p => {
    const cat = (p.category || "").toLowerCase();
    return cat === "feedstock" || cat === "input";
  });

  for (const driver of TYPE_A_DESIGN_DRIVER_SPECS) {
    let found = false;
    for (const fsIdx of targetFeedstockIndices) {
      const fs = feedstocks[fsIdx];
      if (!fs?.feedstockSpecs) continue;
      for (const [key, spec] of Object.entries(fs.feedstockSpecs)) {
        if (specMatchesDriver(key, spec.displayName, driver.matchKeys, driver.matchDisplayNames)) {
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      for (const p of feedstockParams) {
        const text = `${p.name} ${p.value || ""}`;
        if (driver.matchDisplayNames.some(pat => pat.test(text))) {
          found = true;
          break;
        }
      }
    }

    if (!found) {
      missingDrivers.push(driver.label);
    }
  }

  let updatedFeedstocks = [...feedstocks];

  const AUTO_POPULATE_DRIVERS = new Set(["Min Flow", "Peak Flow", "BOD", "COD", "TSS", "FOG", "TKN", "pH"]);
  const driversToPopulate = missingDrivers.filter(d => AUTO_POPULATE_DRIVERS.has(d));

  if (driversToPopulate.length > 0) {
    const industry = detectIndustryType(feedstocks);
    const industryLabel = feedstocks.map(fs => fs.feedstockType || "").filter(Boolean).join(", ") || "food processing wastewater";

    for (const fsIdx of targetFeedstockIndices) {
      const fs = updatedFeedstocks[fsIdx];
      if (!fs) continue;
      const specs: EnrichedFeedstockSpecRecord = { ...(fs.feedstockSpecs || {}) };
      let nextSortOrder = Object.values(specs).reduce((max, s) => Math.max(max, s.sortOrder || 0), 0) + 1;

      for (const missing of driversToPopulate) {
        let key: string;
        let displayName: string;
        let value: string;
        let unit: string;

        const minFlowFactorConfig = await getValidationConfigValue("min_flow_factor", { value: 0.6 });
        const minFlowFactor = minFlowFactorConfig.value ?? 0.6;

        switch (missing) {
          case "Min Flow": {
            const avgFlowMin = fs.feedstockVolume ? parseFloat(fs.feedstockVolume.replace(/,/g, "")) : null;
            const avgUnitMin = fs.feedstockUnit || "GPD";
            if (avgFlowMin && !isNaN(avgFlowMin)) {
              value = Math.round(avgFlowMin * minFlowFactor).toLocaleString();
              unit = avgUnitMin;
            } else {
              value = `${minFlowFactor}x average`;
              unit = "multiplier";
            }
            key = "minFlowRate";
            displayName = "Min Flow Rate";
            break;
          }
          case "Peak Flow": {
            const avgFlow = fs.feedstockVolume ? parseFloat(fs.feedstockVolume.replace(/,/g, "")) : null;
            const avgUnit = fs.feedstockUnit || "GPD";
            if (avgFlow && !isNaN(avgFlow)) {
              value = Math.round(avgFlow * industry.peakFlowMultiplier).toLocaleString();
              unit = avgUnit;
            } else {
              value = `${industry.peakFlowMultiplier}x average`;
              unit = "multiplier";
            }
            key = "peakFlowRate";
            displayName = "Peak Flow Rate";
            break;
          }
          case "BOD": {
            key = "bod";
            displayName = "BOD (Biochemical Oxygen Demand)";
            value = industry.bod;
            unit = "mg/L";
            break;
          }
          case "COD": {
            key = "cod";
            displayName = "COD (Chemical Oxygen Demand)";
            value = industry.cod;
            unit = "mg/L";
            break;
          }
          case "TSS": {
            key = "tss";
            displayName = "TSS (Total Suspended Solids)";
            value = industry.tss;
            unit = "mg/L";
            break;
          }
          case "FOG": {
            key = "fogContent";
            displayName = "FOG (Fats, Oils & Grease)";
            value = industry.fog;
            unit = "mg/L";
            break;
          }
          case "TKN": {
            key = "tkn";
            displayName = "TKN (Total Kjeldahl Nitrogen)";
            value = industry.tkn;
            unit = "mg/L";
            break;
          }
          case "pH": {
            key = "ph";
            displayName = "pH Range";
            value = industry.ph;
            unit = "";
            break;
          }
          default:
            continue;
        }

        if (!specs[key]) {
          specs[key] = {
            value,
            unit,
            source: "estimated_default",
            confidence: "low",
            provenance: `Design default — estimated from typical ${industryLabel} characteristics`,
            group: "biochemical",
            displayName,
            sortOrder: nextSortOrder++,
          };
        }
      }

      updatedFeedstocks[fsIdx] = { ...fs, feedstockSpecs: specs };
    }

    warnings.push({
      field: "Core Design Drivers",
      section: `${typeLabel} Completeness`,
      message: `Auto-populated ${driversToPopulate.length} missing design driver(s): ${driversToPopulate.join(", ")}. Values are industry-typical estimates for ${industryLabel} — please review and update with actual data.`,
      severity: "warning",
    });

    for (const filled of driversToPopulate) {
      warnings.push({
        field: filled,
        section: `${typeLabel} Completeness`,
        message: `"${filled}" was not found in user input — auto-populated with typical industry default. Please verify or update this value.`,
        severity: "warning",
      });
    }
  }

  const stillMissing = missingDrivers.filter(d => !AUTO_POPULATE_DRIVERS.has(d));

  if (stillMissing.length > 0) {
    warnings.push({
      field: "Core Design Drivers",
      section: `${typeLabel} Completeness`,
      message: `Missing core design driver(s): ${stillMissing.join(", ")}. Wastewater projects must surface Flow (avg + min + peak), BOD, COD, TSS, FOG, TKN, and pH in the Feedstock/Influent section.`,
      severity: "error",
    });

    for (const missing of stillMissing) {
      warnings.push({
        field: missing,
        section: `${typeLabel} Completeness`,
        message: `"${missing}" not found in Feedstock/Influent section — this is a core design driver for wastewater treatment and must be provided.`,
        severity: "error",
      });
    }
  }

  if (missingDrivers.length === 0) {
    warnings.push({
      field: "Core Design Drivers",
      section: `${typeLabel} Completeness`,
      message: "All core design drivers present: Flow (avg + min + peak), BOD, COD, TSS, FOG, TKN, pH.",
      severity: "info",
    });
  }

  return { warnings, feedstocks: updatedFeedstocks };
}
