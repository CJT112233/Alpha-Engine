import type { EnrichedOutputSpec } from "@shared/output-criteria-library";
import type { FeedstockEntry, EnrichedFeedstockSpecRecord } from "@shared/schema";

export interface ValidationWarning {
  field: string;
  section: string;
  message: string;
  severity: "error" | "warning" | "info";
  originalValue?: string;
  originalUnit?: string;
}

export interface PerformanceTarget {
  displayName: string;
  value: string;
  unit: string;
  source: string;
  provenance: string;
  group: string;
}

const GAS_ONLY_UNITS = new Set([
  "lb/mmscf", "ppmv", "mg/m³", "mg/m3", "°f", "°c",
  "dewpoint", "grain/100 scf", "btu/scf", "% ch₄", "% co₂",
  "% n₂", "% o₂", "%", "psig", "psi",
]);

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

const REMOVAL_EFFICIENCY_PATTERNS = [
  /% ?removal/i,
  /removal ?%/i,
  /removal efficiency/i,
  /percent removal/i,
  /reduction/i,
];

const RNG_GAS_MOISTURE_KEYS = new Set([
  "waterContent", "moistureContent", "waterDewpoint",
]);

const WASTEWATER_FLOW_INDICATORS = [
  "flow", "gpd", "mgd", "gpm", "m³/d", "m3/d", "gallons per day",
  "million gallons", "liters per day", "l/d", "cubic meters",
];

const WASTEWATER_ANALYTE_PATTERNS = [
  /\bbod\b/i, /\bcod\b/i, /\btss\b/i, /\bfog\b/i, /\btkn\b/i, /\btp\b/i,
  /\btotal suspended/i, /\bbiochemical oxygen/i, /\bchemical oxygen/i,
];

const WASTEWATER_UNIT_INDICATORS = [/mg\/l/i, /mg\/L/i, /gpd/i, /mgd/i, /gpm/i, /m³\/d/i, /m3\/d/i];

const SLUDGE_EXPLICIT_TERMS = [
  "primary sludge", "was ", "waste activated", "sludge blend",
  "sludge thickening", "thickened sludge", "biosolids",
  "primary/was", "was/primary", "dewatered sludge", "digested sludge",
  "waste activated sludge",
];

const SLUDGE_ONLY_SPEC_KEYS = new Set([
  "deliveryForm", "receivingCondition", "preprocessingRequirement",
]);

const SLUDGE_ASSUMPTION_KEYS = new Set([
  "totalSolids", "volatileSolids", "vsTs", "moistureContent",
  "bulkDensity", "cnRatio", "methanePotential", "biodegradableFraction", "inertFraction",
]);

const FEEDSTOCK_SOLID_SPEC_KEYS = new Set([
  "totalSolids", "volatileSolids", "vsTs", "cnRatio",
  "methanePotential", "biodegradableFraction", "inertFraction",
  "bulkDensity", "moistureContent",
]);

const WASTEWATER_HARD_BLOCK_KEYS = new Set([
  "totalSolids", "volatileSolids", "vsTs",
  "methanePotential", "biodegradableFraction", "inertFraction",
  "bulkDensity", "moistureContent", "cnRatio",
  "deliveryForm", "receivingCondition", "preprocessingRequirement",
]);

const PRIMARY_WAS_TERMS = [
  "primary sludge", "waste activated sludge", "was ", "was/",
  "/was", "primary/was", "was blend", "sludge blend",
  "thickened sludge", "dewatered sludge", "digested sludge",
  "biosolids", "return activated", "ras ", "ras/",
];

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

function detectSludgeContext(
  extractedParams: Array<{ name: string; value?: string | null }>,
): boolean {
  const allText = extractedParams.map(p => `${p.name} ${p.value || ""}`).join(" ").toLowerCase();
  return SLUDGE_EXPLICIT_TERMS.some(s => allText.includes(s));
}

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
    let hasSwapIndicator = false;
    const swappedKeys: string[] = [];

    for (const [key, spec] of Object.entries(fs.feedstockSpecs)) {
      if (!hasSludgeContext && FEEDSTOCK_SOLID_SPEC_KEYS.has(key) && spec.source === "estimated_default") {
        hasSwapIndicator = true;
        swappedKeys.push(spec.displayName);
        warnings.push({
          field: spec.displayName,
          section: `Feedstock ${idx + 1} (Wastewater)`,
          message: `Solids parameter "${spec.displayName}" removed from wastewater stream — TS%/VS/BMP only valid for trucked feedstocks, not wastewater influent`,
          severity: "warning",
        });
        continue;
      }

      cleanSpecs[key] = spec;
    }

    if (hasSwapIndicator && !hasFlowRate && !hasAnalytes) {
      warnings.push({
        field: `Feedstock ${idx + 1}`,
        section: "Swap Detection",
        message: `Stream labeled as wastewater contains solids parameters (${swappedKeys.join(", ")}) but no flow/analytes detected — likely mis-assigned feedstock. Parameters re-routed to Unmapped.`,
        severity: "error",
      });
    }

    return { ...fs, feedstockSpecs: cleanSpecs };
  });

  return { feedstocks: sanitizedFeedstocks, warnings, missingRequired };
}

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
  if (matchKeys.some(mk => keyLower === mk.toLowerCase() || keyLower.startsWith(mk.toLowerCase()))) return true;
  if (matchDisplayNames.some(p => p.test(displayName))) return true;
  return false;
}

function detectFlowInSpecs(
  feedstocks: FeedstockEntry[],
  extractedParams: Array<{ name: string; value?: string | null; unit?: string | null; category?: string }>,
): { hasAvgFlow: boolean; hasPeakFlow: boolean } {
  let hasAvgFlow = false;
  let hasPeakFlow = false;
  let hasGenericFlow = false;

  for (const fs of feedstocks) {
    if (fs.feedstockSpecs) {
      for (const [, spec] of Object.entries(fs.feedstockSpecs)) {
        const dn = spec.displayName;
        if (FLOW_PEAK_PATTERNS.some(p => p.test(dn))) hasPeakFlow = true;
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
    else if (FLOW_AVG_PATTERNS.some(pat => pat.test(text))) hasAvgFlow = true;
    else if (FLOW_GENERIC_PATTERN.test(text)) hasGenericFlow = true;
  }

  if (hasGenericFlow && !hasAvgFlow) {
    hasAvgFlow = true;
  }

  return { hasAvgFlow, hasPeakFlow };
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

export function validateTypeADesignDrivers(
  feedstocks: FeedstockEntry[],
  extractedParams: Array<{ name: string; value?: string | null; unit?: string | null; category?: string }>,
  projectType: string | null,
): { warnings: ValidationWarning[]; feedstocks: FeedstockEntry[] } {
  const warnings: ValidationWarning[] = [];

  if (projectType !== "A") {
    return { warnings, feedstocks };
  }

  const { hasAvgFlow, hasPeakFlow } = detectFlowInSpecs(feedstocks, extractedParams);
  const missingDrivers: string[] = [];

  if (!hasAvgFlow) missingDrivers.push("Average Flow");
  if (!hasPeakFlow) missingDrivers.push("Peak Flow");

  const feedstockParams = extractedParams.filter(p => {
    const cat = (p.category || "").toLowerCase();
    return cat === "feedstock" || cat === "input";
  });

  for (const driver of TYPE_A_DESIGN_DRIVER_SPECS) {
    let found = false;
    for (const fs of feedstocks) {
      if (!fs.feedstockSpecs) continue;
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

  let updatedFeedstocks = feedstocks;

  if (missingDrivers.length > 0) {
    const industry = detectIndustryType(feedstocks);
    const industryLabel = feedstocks.map(fs => fs.feedstockType || "").filter(Boolean).join(", ") || "food processing wastewater";

    const AUTO_POPULATE_DRIVERS = new Set(["Peak Flow", "BOD", "COD", "TSS", "FOG", "TKN", "pH"]);

    updatedFeedstocks = feedstocks.map((fs, idx) => {
      if (idx !== 0) return fs;
      const specs: EnrichedFeedstockSpecRecord = { ...(fs.feedstockSpecs || {}) };
      let nextSortOrder = Object.values(specs).reduce((max, s) => Math.max(max, s.sortOrder || 0), 0) + 1;

      for (const missing of missingDrivers) {
        if (!AUTO_POPULATE_DRIVERS.has(missing)) continue;

        let key: string;
        let displayName: string;
        let value: string;
        let unit: string;

        switch (missing) {
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
            key = "phLevel";
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

      return { ...fs, feedstockSpecs: specs };
    });

    const autoPopulated = missingDrivers.filter(d => AUTO_POPULATE_DRIVERS.has(d));
    const stillMissing = missingDrivers.filter(d => !AUTO_POPULATE_DRIVERS.has(d));

    if (autoPopulated.length > 0) {
      warnings.push({
        field: "Core Design Drivers",
        section: "Type A Completeness",
        message: `Auto-populated ${autoPopulated.length} missing design driver(s): ${autoPopulated.join(", ")}. Values are industry-typical estimates for ${industryLabel} — please review and update with actual data.`,
        severity: "warning",
      });

      for (const filled of autoPopulated) {
        warnings.push({
          field: filled,
          section: "Type A Completeness",
          message: `"${filled}" was not found in user input — auto-populated with typical industry default. Please verify or update this value.`,
          severity: "warning",
        });
      }
    }

    if (stillMissing.length > 0) {
      warnings.push({
        field: "Core Design Drivers",
        section: "Type A Completeness",
        message: `Missing core design driver(s): ${stillMissing.join(", ")}. Type A wastewater projects must surface Flow (avg + peak), BOD, COD, TSS, FOG, TKN, and pH in the Feedstock/Influent section.`,
        severity: "error",
      });

      for (const missing of stillMissing) {
        warnings.push({
          field: missing,
          section: "Type A Completeness",
          message: `"${missing}" not found in Feedstock/Influent section — this is a core design driver for wastewater treatment and must be provided.`,
          severity: "error",
        });
      }
    }
  } else {
    warnings.push({
      field: "Core Design Drivers",
      section: "Type A Completeness",
      message: "All six core design drivers present: Flow (avg + peak), BOD, COD, TSS, FOG, pH.",
      severity: "info",
    });
  }

  return { warnings, feedstocks: updatedFeedstocks };
}
