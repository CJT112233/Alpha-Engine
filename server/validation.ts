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

  const hasSludgeContext = detectSludgeContext(extractedParams);
  const { hasFlowRate, hasAnalytes } = detectWastewaterContext(extractedParams);
  const isWastewaterInfluent = hasFlowRate || hasAnalytes;

  const sanitizedFeedstocks = feedstocks.map((fs, idx) => {
    if (!fs.feedstockSpecs) return fs;

    const cleanSpecs: EnrichedFeedstockSpecRecord = {};

    for (const [key, spec] of Object.entries(fs.feedstockSpecs)) {
      if (SLUDGE_ONLY_SPEC_KEYS.has(key) && !hasSludgeContext && spec.source === "estimated_default") {
        warnings.push({
          field: spec.displayName,
          section: `Feedstock ${idx + 1}`,
          message: `Sludge-specific default removed — no explicit sludge/biosolids mentioned in inputs`,
          severity: "warning",
        });
        continue;
      }

      if (isWastewaterInfluent && !hasSludgeContext && SLUDGE_ASSUMPTION_KEYS.has(key) && spec.source === "estimated_default") {
        const unitLower = spec.unit.toLowerCase();
        if (unitLower.includes("%") && !unitLower.includes("mg/l")) {
          warnings.push({
            field: spec.displayName,
            section: `Feedstock ${idx + 1}`,
            message: `Solids-basis assumption removed for wastewater project — use BOD/COD/TSS + flow instead`,
            severity: "warning",
          });
          continue;
        }
      }

      if (isWastewaterInfluent && !hasSludgeContext && key === "totalSolids" && spec.source === "estimated_default") {
        warnings.push({
          field: spec.displayName,
          section: `Feedstock ${idx + 1}`,
          message: `TS% removed — wastewater influent detected (mg/L analytes present), TS% only valid for sludge streams`,
          severity: "warning",
        });
        continue;
      }

      cleanSpecs[key] = spec;
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
      message: `Missing required influent flow and/or influent concentrations: ${missingRequired.join("; ")}`,
      severity: "error",
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
