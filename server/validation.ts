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

export function validateAndSanitizeOutputSpecs(
  outputSpecs: Record<string, Record<string, EnrichedOutputSpec>>,
  projectType: string | null,
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
  const digestateProfile = "Solid Digestate - Land Application";
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

      if (profileName === digestateProfile) {
        const valLower = `${spec.value} ${spec.unit}`.toLowerCase();
        if (REMOVAL_EFFICIENCY_PATTERNS.some(p => p.test(valLower))) {
          performanceTargets.push({
            displayName: spec.displayName,
            value: spec.value,
            unit: spec.unit,
            source: spec.source,
            provenance: spec.provenance,
            group: "performance_targets",
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

  const sanitizedFeedstocks = feedstocks.map((fs, idx) => {
    if (!fs.feedstockSpecs) return fs;

    const cleanSpecs: EnrichedFeedstockSpecRecord = {};
    const sludgeIndicators = ["primary sludge", "was ", "waste activated", "sludge blend",
      "sludge thickening", "thickened sludge", "biosolids"];

    const allInputText = extractedParams.map(p => `${p.name} ${p.value || ""}`).join(" ").toLowerCase();
    const hasSludgeContext = sludgeIndicators.some(s => allInputText.includes(s));

    for (const [key, spec] of Object.entries(fs.feedstockSpecs)) {
      const sludgeSpecKeys = new Set([
        "deliveryForm", "receivingCondition", "preprocessingRequirement",
      ]);
      const sludgeAssumptionKeys = new Set([
        "totalSolids", "volatileSolids", "vsTs", "moistureContent",
        "bulkDensity", "cnRatio", "methanePotential", "biodegradableFraction", "inertFraction",
      ]);

      if (sludgeSpecKeys.has(key) && !hasSludgeContext && spec.source === "estimated_default") {
        warnings.push({
          field: spec.displayName,
          section: `Feedstock ${idx + 1}`,
          message: `Sludge-specific default removed — no explicit sludge/biosolids mentioned in inputs`,
          severity: "warning",
        });
        continue;
      }

      if (sludgeAssumptionKeys.has(key) && !hasSludgeContext && spec.source === "estimated_default") {
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

      cleanSpecs[key] = spec;
    }

    return { ...fs, feedstockSpecs: cleanSpecs };
  });

  const allParamNames = extractedParams.map(p => p.name.toLowerCase());
  const allParamValues = extractedParams.map(p => `${p.name} ${p.value || ""} ${p.unit || ""}`.toLowerCase());
  const allText = allParamValues.join(" ");

  const hasFlowRate = allText.includes("flow") || allText.includes("gpd") || allText.includes("mgd") ||
    allText.includes("gpm") || allText.includes("m³/d") || allText.includes("m3/d") ||
    allText.includes("gallons") || allText.includes("liters");
  const hasBOD = allParamNames.some(n => n.includes("bod"));
  const hasCOD = allParamNames.some(n => n.includes("cod"));
  const hasTSS = allParamNames.some(n => n.includes("tss") || n.includes("total suspended"));

  if (!hasFlowRate) {
    missingRequired.push("Flow rate (GPD, MGD, m³/d, or similar)");
  }
  if (!hasBOD && !hasCOD && !hasTSS) {
    missingRequired.push("At least one wastewater concentration driver (BOD, COD, or TSS)");
  }

  return { feedstocks: sanitizedFeedstocks, warnings, missingRequired };
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
      const isLiquid = liquidUnitPatterns.some(p => p.test(valUnit));
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
