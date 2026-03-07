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

const RECALCULABLE_FIELDS: Record<string, keyof DesignOverrides> = {
  "summary.hrt": "hrtDays",
  "summary.vsDestruction": "vsDestructionPct",
  "summary.biogasAvgFlowScfm": "biogasScfm",
  "summary.rngAvgFlowScfm": "rngScfm",
  "summary.feedTpd": "feedTpd",
  "summary.totalFeedTpd": "feedTpd",

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

  for (const fieldKey of allOverrideKeys) {
    const override = overrides[fieldKey];
    if (!override || override.value === undefined) continue;

    const designKey = RECALCULABLE_FIELDS[fieldKey];
    if (designKey) {
      const numVal = parseFloat(String(override.value).replace(/,/g, ""));
      if (!isNaN(numVal)) {
        (result as any)[designKey] = numVal;
      }
      continue;
    }

    const match = matchDesignCriteriaKey(fieldKey);
    if (match) {
      const numVal = parseFloat(String(override.value).replace(/,/g, ""));
      if (!isNaN(numVal)) {
        (result as any)[match] = numVal;
      }
      continue;
    }

    const outputMatch = stages
      ? matchOutputStreamKeyWithContext(fieldKey, stages)
      : matchOutputStreamKey(fieldKey);
    if (outputMatch) {
      const numVal = parseFloat(String(override.value).replace(/,/g, ""));
      if (!isNaN(numVal)) {
        (result as any)[outputMatch] = numVal;
      }
    }
  }

  return result;
}

function matchOutputStreamKey(fieldKey: string): keyof DesignOverrides | null {
  if (!fieldKey.includes("outputStream.")) return null;
  const lastPart = fieldKey.split(".").pop() || "";
  if (lastPart !== "avgFlowScfm") return null;

  if (fieldKey.includes("adStages.3.")) {
    return "biogasScfm";
  }

  return null;
}

let stageTypeMap: Map<number, string> | null = null;

export function setStageTypeMap(stages: Array<{ type?: string }>) {
  stageTypeMap = new Map();
  stages.forEach((stage, idx) => {
    if (stage.type) {
      stageTypeMap!.set(idx, stage.type);
    }
  });
}

export function matchOutputStreamKeyWithContext(fieldKey: string, stages?: Array<{ type?: string }>): keyof DesignOverrides | null {
  if (!fieldKey.includes("outputStream.")) return null;
  const lastPart = fieldKey.split(".").pop() || "";
  if (lastPart !== "avgFlowScfm") return null;

  const stageIdx = fieldKey.match(/adStages\.(\d+)\./);
  if (!stageIdx) return null;
  const idx = parseInt(stageIdx[1]);

  const stageTypes = stages || (stageTypeMap ? Array.from(stageTypeMap.entries()).reduce((acc, [i, t]) => { acc[i] = { type: t }; return acc; }, [] as Array<{ type?: string }>) : null);

  if (stageTypes && stageTypes[idx]) {
    const stageType = stageTypes[idx].type?.toLowerCase() || "";
    if (stageType === "digester" || stageType === "anaerobic digester" || stageType === "ad") {
      return "biogasScfm";
    }
    if (stageType === "gasupgrading" || stageType === "gas upgrading" || stageType === "rng" || stageType === "membrane") {
      return "rngScfm";
    }
  }

  if (idx === 3) return "biogasScfm";
  if (idx >= 6) return "rngScfm";

  return null;
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
  if (fieldKey.includes("outputStream.")) {
    return matchOutputStreamKey(fieldKey) !== null;
  }
  return false;
}
