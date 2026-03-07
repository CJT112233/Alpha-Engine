export interface DesignOverrides {
  hrtDays?: number;
  vsDestructionPct?: number;
  olrTarget?: number;
  digesterTempF?: number;
  digesterTempC?: number;
  eqRetentionDays?: number;
  feedDensityLbPerGal?: number;
  ch4Pct?: number;
  co2Pct?: number;
  h2sPpmv?: number;
  headspacePct?: number;
  gasYield?: number;
  mixingPowerWPerM3?: number;
  solidsCaptureEff?: number;
  cakeSolidsPct?: number;
  polymerDoseKgPerTon?: number;
  dafTssRemoval?: number;
  dafFogRemoval?: number;
  dafHydraulicLoading?: number;
  methaneRecovery?: number;
  productCH4?: number;
  pressureOutPsig?: number;
  sludgeBMP?: number;
  sludgeThickenedSolidsPct?: number;
  sludgeCaptureRate?: number;
  dewateringCakeSolidsPct?: number;
  dewateringCaptureRate?: number;
  storageDays?: number;
  targetParticleSize?: number;
  depackagingRejectRate?: number;
  preheatTempC?: number;
  targetTSPct?: number;
  biogasScfm?: number;
  rngScfm?: number;
  feedTpd?: number;
  totalSolidsPct?: number;
  volatileSolidsPct?: number;
}

export const SUMMARY_INPUT_KEYS = new Set([
  "totalFeedRate",
  "totalSolidsPct",
  "volatileSolidsPct",
  "hrt",
  "vsDestruction",
  "biogasAvgFlowScfm",
  "rngAvgFlowScfm",
  "biogasCH4",
  "biogasCO2",
  "biogasH2S",
  "methaneRecovery",
]);

const RECALCULABLE_FIELDS: Record<string, keyof DesignOverrides> = {
  "summary.hrt": "hrtDays",
  "summary.vsDestruction": "vsDestructionPct",
  "summary.biogasAvgFlowScfm": "biogasScfm",
  "summary.rngAvgFlowScfm": "rngScfm",
  "summary.totalFeedRate": "feedTpd",
  "summary.feedTpd": "feedTpd",
  "summary.totalFeedTpd": "feedTpd",
  "summary.totalSolidsPct": "totalSolidsPct",
  "summary.volatileSolidsPct": "volatileSolidsPct",
  "summary.biogasCH4": "ch4Pct",
  "summary.biogasCO2": "co2Pct",
  "summary.biogasH2S": "h2sPpmv",
  "summary.methaneRecovery": "methaneRecovery",

  "adStages.3.designCriteria.hrt": "hrtDays",
  "adStages.3.designCriteria.olr": "olrTarget",
  "adStages.3.designCriteria.vsDestruction": "vsDestructionPct",
  "adStages.3.designCriteria.temperature": "digesterTempF",
  "adStages.3.designCriteria.digesterVolume": "hrtDays",
  "adStages.3.designCriteria.mixingPower": "mixingPowerWPerM3",

  "adStages.2.designCriteria.retentionTime": "eqRetentionDays",
  "adStages.2.designCriteria.mixingPower": "mixingPowerWPerM3",

  "adStages.4.designCriteria.solidsCaptureEfficiency": "solidsCaptureEff",
  "adStages.4.designCriteria.cakeSolids": "cakeSolidsPct",
  "adStages.4.designCriteria.polymerDosing": "polymerDoseKgPerTon",

  "adStages.5.designCriteria.tssRemoval": "dafTssRemoval",
  "adStages.5.designCriteria.fogRemoval": "dafFogRemoval",
  "adStages.5.designCriteria.hydraulicLoading": "dafHydraulicLoading",

  "adStages.0.designCriteria.storageDays": "storageDays",
  "adStages.1.designCriteria.targetParticleSize": "targetParticleSize",
  "adStages.1.designCriteria.depackagingRejectRate": "depackagingRejectRate",
};

export function extractDesignOverrides(
  overrides: Record<string, any>,
  locks: Record<string, boolean>,
  stages?: Array<{ type?: string }>,
): DesignOverrides {
  const result: DesignOverrides = {};

  const allOverrideKeys = new Set([
    ...Object.keys(overrides || {}),
    ...Object.keys(locks || {}).filter(k => locks[k]),
  ]);

  console.log(`extractDesignOverrides: Processing ${allOverrideKeys.size} override keys: [${Array.from(allOverrideKeys).join(", ")}]`);

  for (const fieldKey of allOverrideKeys) {
    const override = overrides[fieldKey];
    if (!override || override.value === undefined) continue;

    const designKey = RECALCULABLE_FIELDS[fieldKey];
    if (designKey) {
      const numVal = parseFloat(String(override.value).replace(/,/g, ""));
      if (!isNaN(numVal)) {
        (result as any)[designKey] = numVal;
        console.log(`  Mapped: ${fieldKey} → ${designKey} = ${numVal}`);
      }
      continue;
    }

    const match = matchDesignCriteriaKey(fieldKey);
    if (match) {
      const numVal = parseFloat(String(override.value).replace(/,/g, ""));
      if (!isNaN(numVal)) {
        (result as any)[match] = numVal;
        console.log(`  Mapped (criteria): ${fieldKey} → ${match} = ${numVal}`);
      }
      continue;
    }
  }

  console.log(`extractDesignOverrides: Result = ${JSON.stringify(result)}`);
  return result;
}

function matchDesignCriteriaKey(fieldKey: string): keyof DesignOverrides | null {
  const criteriaMap: Record<string, keyof DesignOverrides> = {
    hrt: "hrtDays",
    olr: "olrTarget",
    organicLoadingRate: "olrTarget",
    vsDestruction: "vsDestructionPct",
    temperature: "digesterTempF",
    digesterVolume: "hrtDays",
    mixingPower: "mixingPowerWPerM3",
    retentionTime: "eqRetentionDays",
    solidsCaptureEfficiency: "solidsCaptureEff",
    cakeSolids: "cakeSolidsPct",
    polymerDosing: "polymerDoseKgPerTon",
    tssRemoval: "dafTssRemoval",
    fogRemoval: "dafFogRemoval",
    hydraulicLoading: "dafHydraulicLoading",
    storageDays: "storageDays",
    targetParticleSize: "targetParticleSize",
    depackagingRejectRate: "depackagingRejectRate",
    headspacePct: "headspacePct",
    gasYield: "gasYield",
    ch4Content: "ch4Pct",
    co2Content: "co2Pct",
    h2sContent: "h2sPpmv",
    preheatTemp: "preheatTempC",
    targetTS: "targetTSPct",
    thickenedSolids: "sludgeThickenedSolidsPct",
    captureRate: "sludgeCaptureRate",
  };

  if (fieldKey.includes("designCriteria.")) {
    const lastPart = fieldKey.split(".").pop() || "";
    return criteriaMap[lastPart] || null;
  }
  return null;
}

export function isSummaryInputField(summaryKey: string): boolean {
  return SUMMARY_INPUT_KEYS.has(summaryKey);
}

export function isRecalculableField(fieldKey: string): boolean {
  if (RECALCULABLE_FIELDS[fieldKey]) return true;
  if (fieldKey.includes("designCriteria.")) {
    const lastPart = fieldKey.split(".").pop() || "";
    const criteriaKeys = [
      "hrt", "olr", "organicLoadingRate", "vsDestruction", "temperature",
      "digesterVolume", "mixingPower",
      "retentionTime", "solidsCaptureEfficiency", "cakeSolids", "polymerDosing",
      "tssRemoval", "fogRemoval", "hydraulicLoading", "storageDays",
      "targetParticleSize", "depackagingRejectRate", "headspacePct",
      "gasYield", "ch4Content", "co2Content", "h2sContent", "preheatTemp",
      "targetTS", "thickenedSolids", "captureRate",
    ];
    return criteriaKeys.includes(lastPart);
  }
  return false;
}
