import type {
  ADProcessStage,
  EquipmentItem,
  MassBalanceResults,
  UpifRecord,
  FeedstockEntry,
  TreatmentStage,
  StreamData,
  RecycleStream,
} from "@shared/schema";
import { calculateMassBalance } from "./massBalance";

type DesignCriterion = { value: number; unit: string; source: string };

const AD_DEFAULTS: Record<string, Record<string, DesignCriterion>> = {
  sludgeThickening: {
    thickenedSolids: { value: 5, unit: "% TS", source: "WEF MOP 8" },
    captureRate: { value: 95, unit: "%", source: "Gravity belt thickener" },
  },
  digester: {
    hrt: { value: 20, unit: "days", source: "WEF MOP 8 — WWTP sludge" },
    organicLoadingRate: { value: 2.5, unit: "kg VS/m³·d", source: "WEF MOP 8" },
    vsDestruction: { value: 55, unit: "%", source: "WEF MOP 8 — mixed sludge" },
    temperature: { value: 35, unit: "°C", source: "Mesophilic standard" },
    mixingPower: { value: 5, unit: "W/m³", source: "WEF MOP 8" },
    gasYield: { value: 0.9, unit: "m³/kg VS destroyed", source: "WEF MOP 8 — municipal sludge" },
    ch4Content: { value: 63, unit: "%", source: "Typical WWTP biogas" },
    co2Content: { value: 35, unit: "%", source: "Typical WWTP biogas" },
    h2sContent: { value: 500, unit: "ppmv", source: "Typical WWTP biogas — lower than AD-only" },
  },
  truckedFeedstock: {
    defaultTS: { value: 15, unit: "%", source: "Typical trucked feedstock" },
    defaultVS: { value: 80, unit: "% of TS", source: "Typical organic waste" },
    defaultBMP: { value: 0.35, unit: "m³ CH₄/kg VS", source: "Engineering practice" },
  },
  gasConditioning: {
    h2sRemovalEff: { value: 99.5, unit: "%", source: "Iron sponge/bioscrubber" },
    moistureRemoval: { value: 99, unit: "%", source: "Chiller/desiccant" },
    siloxaneRemoval: { value: 95, unit: "%", source: "Activated carbon" },
  },
  gasUpgrading: {
    methaneRecovery: { value: 97, unit: "%", source: "Membrane/PSA typical" },
    productCH4: { value: 97, unit: "%", source: "Pipeline quality RNG" },
    electricalDemand: { value: 0.25, unit: "kWh/Nm³ raw biogas", source: "Engineering practice" },
    pressureOut: { value: 200, unit: "psig", source: "Pipeline injection" },
  },
  dewateringPost: {
    cakeSolids: { value: 22, unit: "% TS", source: "Belt filter press — digested sludge" },
    captureRate: { value: 95, unit: "%", source: "WEF MOP 8" },
  },
};

function roundTo(val: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function getSpecValue(fs: FeedstockEntry, keys: string[], defaultVal: number): number {
  if (!fs.feedstockSpecs) return defaultVal;
  for (const key of keys) {
    for (const [k, spec] of Object.entries(fs.feedstockSpecs)) {
      if (k.toLowerCase() === key.toLowerCase() ||
          spec.displayName.toLowerCase().includes(key.toLowerCase())) {
        const val = parseFloat(String(spec.value).replace(/[,%]/g, ""));
        if (!isNaN(val)) return val;
      }
    }
  }
  return defaultVal;
}

function parseFeedstockVolume(fs: FeedstockEntry): number {
  const vol = parseFloat((fs.feedstockVolume || "0").replace(/,/g, ""));
  const unit = (fs.feedstockUnit || "").toLowerCase();
  if (isNaN(vol) || vol <= 0) return 0;
  if (unit.includes("ton") && unit.includes("year")) return vol / 365;
  if (unit.includes("ton") && unit.includes("day")) return vol;
  if (unit.includes("ton") && unit.includes("week")) return vol / 7;
  if (unit.includes("lb") && unit.includes("day")) return vol / 2000;
  if (unit.includes("kg") && unit.includes("day")) return vol / 1000;
  if (unit.includes("ton")) return vol / 365;
  return vol;
}

function isWastewaterFeedstock(fs: FeedstockEntry): boolean {
  const name = (fs.feedstockType || "").toLowerCase();
  const unit = (fs.feedstockUnit || "").toLowerCase();
  if (unit.includes("mgd") || unit.includes("gpm") || unit.includes("gpd") || unit.includes("m³/d")) return true;
  if (name.includes("wastewater") || name.includes("influent") || name.includes("sewage")) return true;
  if (fs.feedstockSpecs) {
    for (const [k] of Object.entries(fs.feedstockSpecs)) {
      const kl = k.toLowerCase();
      if (kl.includes("bod") || kl.includes("cod") || kl.includes("tss") || kl.includes("tkn")) return true;
    }
  }
  return false;
}

export function calculateMassBalanceTypeD(upif: UpifRecord): MassBalanceResults {
  const warnings: MassBalanceResults["warnings"] = [];
  const assumptions: MassBalanceResults["assumptions"] = [];
  const adStages: ADProcessStage[] = [];
  const allEquipment: EquipmentItem[] = [];
  let eqId = 100;
  const makeId = () => `eq-d-${eqId++}`;

  const feedstocks = (upif.feedstocks || []) as FeedstockEntry[];
  const wwFeedstocks = feedstocks.filter(isWastewaterFeedstock);
  const truckedFeedstocks = feedstocks.filter(fs => !isWastewaterFeedstock(fs));

  const wwResult = calculateMassBalance(upif);
  const wwStages = wwResult.stages;
  const wwEquipment = wwResult.equipment;
  const wwRecycleStreams = wwResult.recycleStreams;
  warnings.push(...wwResult.warnings.map(w => ({ ...w, field: `WW: ${w.field}` })));
  assumptions.push(...wwResult.assumptions.map(a => ({ ...a, parameter: `WW: ${a.parameter}` })));

  let primarySludgeTSKgPerDay = 0;
  let wasSludgeTSKgPerDay = 0;
  const flowMGD = wwStages.length > 0 ? wwStages[0].influent.flow : 1.0;
  const flowM3PerDay = flowMGD * 3785.41;

  const primaryStage = wwStages.find(s => s.type === "primary");
  if (primaryStage) {
    const tssRemoved = (primaryStage.influent.tss - primaryStage.effluent.tss);
    primarySludgeTSKgPerDay = tssRemoved * flowM3PerDay / 1000;
    assumptions.push({ parameter: "Primary Sludge TS", value: `${roundTo(primarySludgeTSKgPerDay)} kg/day`, source: "From WW mass balance — TSS removed" });
  }

  const secondaryStage = wwStages.find(s => s.type === "activated_sludge" || s.type === "mbr");
  if (secondaryStage) {
    const biomassTSSRemoved = (secondaryStage.influent.tss - secondaryStage.effluent.tss);
    const bodRemoved = (secondaryStage.influent.bod - secondaryStage.effluent.bod);
    wasSludgeTSKgPerDay = (biomassTSSRemoved * flowM3PerDay / 1000) * 0.6 + (bodRemoved * flowM3PerDay / 1000) * 0.4;
    assumptions.push({ parameter: "WAS Sludge TS", value: `${roundTo(wasSludgeTSKgPerDay)} kg/day`, source: "Estimated from secondary removal" });
  }

  const totalWWSludgeTS = primarySludgeTSKgPerDay + wasSludgeTSKgPerDay;
  const primaryVSFraction = 0.65;
  const wasVSFraction = 0.75;
  const blendedVSFraction = totalWWSludgeTS > 0
    ? (primarySludgeTSKgPerDay * primaryVSFraction + wasSludgeTSKgPerDay * wasVSFraction) / totalWWSludgeTS
    : 0.70;
  const wwVSKgPerDay = totalWWSludgeTS * blendedVSFraction;

  assumptions.push({ parameter: "WW Sludge VS/TS", value: `${roundTo(blendedVSFraction * 100)}%`, source: "Blended primary (65%) + WAS (75%)" });

  let truckedVSKgPerDay = 0;
  let truckedTSKgPerDay = 0;
  for (const fs of truckedFeedstocks) {
    const tpd = parseFeedstockVolume(fs);
    if (tpd <= 0) continue;
    const ts = getSpecValue(fs, ["totalSolids", "total solids", "ts"], AD_DEFAULTS.truckedFeedstock.defaultTS.value);
    const vsOfTs = getSpecValue(fs, ["volatileSolids", "volatile solids", "vs", "vs/ts"], AD_DEFAULTS.truckedFeedstock.defaultVS.value);
    const feedKg = tpd * 1000;
    const tsKg = feedKg * (ts / 100);
    const vsKg = tsKg * (vsOfTs / 100);
    truckedTSKgPerDay += tsKg;
    truckedVSKgPerDay += vsKg;
  }

  if (truckedFeedstocks.length > 0) {
    assumptions.push({ parameter: "Trucked Feedstock VS", value: `${roundTo(truckedVSKgPerDay)} kg VS/day`, source: "From UPIF trucked inputs" });
  }

  const totalVSLoad = wwVSKgPerDay + truckedVSKgPerDay;
  const totalTSLoad = totalWWSludgeTS + truckedTSKgPerDay;

  if (totalVSLoad <= 0) {
    warnings.push({ field: "AD Feed", message: "No VS load available for anaerobic digestion. Check wastewater and trucked feedstock inputs.", severity: "error" });
  }

  const thickenedTS = AD_DEFAULTS.sludgeThickening.thickenedSolids.value / 100;
  const sludgeVolM3PerDay = totalTSLoad > 0 ? (totalTSLoad / (thickenedTS * 1000)) : 0;

  const thickeningStage: ADProcessStage = {
    name: "Sludge Thickening & Blending",
    type: "sludgeThickening",
    inputStream: {
      wwSludgeTS: { value: roundTo(totalWWSludgeTS), unit: "kg TS/day" },
      truckedFeedstockTS: { value: roundTo(truckedTSKgPerDay), unit: "kg TS/day" },
      totalVSLoad: { value: roundTo(totalVSLoad), unit: "kg VS/day" },
    },
    outputStream: {
      blendedSludgeVolume: { value: roundTo(sludgeVolM3PerDay), unit: "m³/day" },
      thickenedTS: { value: AD_DEFAULTS.sludgeThickening.thickenedSolids.value, unit: "% TS" },
      totalVS: { value: roundTo(totalVSLoad), unit: "kg VS/day" },
    },
    designCriteria: AD_DEFAULTS.sludgeThickening,
    notes: [
      truckedFeedstocks.length > 0
        ? `Blending WW sludge + ${truckedFeedstocks.length} trucked feedstock(s)`
        : "WW sludge only — no co-digestion feedstocks",
    ],
  };
  adStages.push(thickeningStage);

  allEquipment.push({
    id: makeId(),
    process: "Sludge Thickening",
    equipmentType: "Gravity Belt Thickener",
    description: "Thickens combined sludge to target TS for digester feed",
    quantity: sludgeVolM3PerDay > 200 ? 2 : 1,
    specs: {
      feedTS: { value: String(roundTo((totalTSLoad / (sludgeVolM3PerDay * 1000 / thickenedTS)) * 100, 1)), unit: "% TS" },
      thickenedTS: { value: "5", unit: "% TS" },
      throughput: { value: String(roundTo(sludgeVolM3PerDay)), unit: "m³/day" },
    },
    designBasis: "95% solids capture, 5% cake TS",
    notes: "Polymer conditioning included",
    isOverridden: false,
    isLocked: false,
  });

  const vsDestruction = AD_DEFAULTS.digester.vsDestruction.value / 100;
  const hrt = AD_DEFAULTS.digester.hrt.value;
  const olr = AD_DEFAULTS.digester.organicLoadingRate.value;
  const gasYield = AD_DEFAULTS.digester.gasYield.value;
  const ch4Pct = AD_DEFAULTS.digester.ch4Content.value;
  const h2sPpmv = AD_DEFAULTS.digester.h2sContent.value;

  const vsDestroyedKgPerDay = totalVSLoad * vsDestruction;
  const biogasM3PerDay = vsDestroyedKgPerDay * gasYield;
  const biogasScfPerDay = biogasM3PerDay * 35.3147;
  const biogasScfm = biogasScfPerDay / 1440;
  const ch4M3PerDay = biogasM3PerDay * (ch4Pct / 100);

  const digesterVolumeByHRT = sludgeVolM3PerDay * hrt;
  const digesterVolumeByOLR = totalVSLoad > 0 ? totalVSLoad / olr : 0;
  const digesterVolM3 = Math.max(digesterVolumeByHRT, digesterVolumeByOLR);
  const numDigesters = digesterVolM3 > 4000 ? 2 : 1;
  const perDigesterVol = digesterVolM3 / numDigesters;

  assumptions.push({ parameter: "AD VS Destruction", value: `${roundTo(vsDestruction * 100)}%`, source: "WEF MOP 8 — mixed sludge" });
  assumptions.push({ parameter: "AD Biogas Yield", value: `${gasYield} m³/kg VS destroyed`, source: "WEF MOP 8" });
  assumptions.push({ parameter: "AD Biogas CH₄", value: `${ch4Pct}%`, source: "Typical WWTP biogas" });

  const digesterStage: ADProcessStage = {
    name: "Anaerobic Digestion",
    type: "digester",
    inputStream: {
      sludgeVolume: { value: roundTo(sludgeVolM3PerDay), unit: "m³/day" },
      vsLoad: { value: roundTo(totalVSLoad), unit: "kg VS/day" },
      tsLoad: { value: roundTo(totalTSLoad), unit: "kg TS/day" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(biogasM3PerDay), unit: "m³/day" },
      biogasFlowSCFM: { value: roundTo(biogasScfm), unit: "scfm" },
      ch4Content: { value: ch4Pct, unit: "%" },
      h2sContent: { value: h2sPpmv, unit: "ppmv" },
      vsDestroyed: { value: roundTo(vsDestroyedKgPerDay), unit: "kg/day" },
    },
    designCriteria: AD_DEFAULTS.digester,
    notes: [
      `${numDigesters} digester(s) at ${roundTo(perDigesterVol).toLocaleString()} m³ each`,
      `Actual OLR: ${roundTo(totalVSLoad / digesterVolM3, 2)} kg VS/m³·d`,
      `Actual HRT: ${roundTo(digesterVolM3 / sludgeVolM3PerDay)} days`,
    ],
  };
  adStages.push(digesterStage);

  allEquipment.push({
    id: makeId(),
    process: "Anaerobic Digestion",
    equipmentType: "CSTR Digester",
    description: "Mesophilic anaerobic digester for WW sludge" + (truckedFeedstocks.length > 0 ? " + co-digestion" : ""),
    quantity: numDigesters,
    specs: {
      volume: { value: String(roundTo(perDigesterVol)), unit: "m³" },
      totalVolume: { value: String(roundTo(digesterVolM3)), unit: "m³" },
      hrt: { value: String(hrt), unit: "days" },
      olr: { value: String(roundTo(totalVSLoad / digesterVolM3, 2)), unit: "kg VS/m³·d" },
      temperature: { value: "35", unit: "°C" },
    },
    designBasis: `${hrt}-day HRT, OLR ≤ ${olr} kg VS/m³·d`,
    notes: "Includes gas collection, mixing, and heating",
    isOverridden: false,
    isLocked: false,
  });

  const h2sRemovalEff = AD_DEFAULTS.gasConditioning.h2sRemovalEff.value / 100;
  const outH2sPpmv = h2sPpmv * (1 - h2sRemovalEff);
  const conditionedBiogasM3PerDay = biogasM3PerDay * 0.99;

  const conditioningStage: ADProcessStage = {
    name: "Biogas Conditioning",
    type: "gasConditioning",
    inputStream: {
      biogasFlow: { value: roundTo(biogasM3PerDay), unit: "m³/day" },
      ch4Content: { value: ch4Pct, unit: "%" },
      h2sContent: { value: h2sPpmv, unit: "ppmv" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(conditionedBiogasM3PerDay), unit: "m³/day" },
      h2sContent: { value: roundTo(outH2sPpmv, 1), unit: "ppmv" },
    },
    designCriteria: AD_DEFAULTS.gasConditioning,
    notes: ["H₂S removal, moisture removal, siloxane removal"],
  };
  adStages.push(conditioningStage);

  allEquipment.push({
    id: makeId(),
    process: "Gas Conditioning",
    equipmentType: "H₂S Removal System",
    description: "Iron sponge or bioscrubber for H₂S removal",
    quantity: 1,
    specs: {
      inletH2S: { value: String(h2sPpmv), unit: "ppmv" },
      outletH2S: { value: String(roundTo(outH2sPpmv, 1)), unit: "ppmv" },
      gasFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
    },
    designBasis: "99.5% H₂S removal",
    notes: "",
    isOverridden: false,
    isLocked: false,
  });

  allEquipment.push({
    id: makeId(),
    process: "Gas Conditioning",
    equipmentType: "Gas Chiller/Dryer",
    description: "Moisture removal to pipeline specification",
    quantity: 1,
    specs: {
      gasFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
    },
    designBasis: "Dewpoint < -40°F",
    notes: "",
    isOverridden: false,
    isLocked: false,
  });

  const methaneRecovery = AD_DEFAULTS.gasUpgrading.methaneRecovery.value / 100;
  const productCH4 = AD_DEFAULTS.gasUpgrading.productCH4.value;
  const rngCH4M3PerDay = ch4M3PerDay * methaneRecovery;
  const rngM3PerDay = rngCH4M3PerDay / (productCH4 / 100);
  const rngScfPerDay = rngM3PerDay * 35.3147;
  const rngScfm = rngScfPerDay / 1440;
  const rngMMBtuPerDay = rngScfPerDay * 1012 / 1_000_000;
  const rngGJPerDay = rngMMBtuPerDay * 1.055;
  const tailgasM3PerDay = conditionedBiogasM3PerDay - rngM3PerDay;
  const electricalDemandKW = biogasM3PerDay * AD_DEFAULTS.gasUpgrading.electricalDemand.value / 24;

  const upgradingStage: ADProcessStage = {
    name: "Gas Upgrading to RNG",
    type: "gasUpgrading",
    inputStream: {
      biogasFlow: { value: roundTo(conditionedBiogasM3PerDay), unit: "m³/day" },
      ch4Content: { value: ch4Pct, unit: "%" },
    },
    outputStream: {
      rngFlow: { value: roundTo(rngM3PerDay), unit: "m³/day" },
      rngFlowSCFM: { value: roundTo(rngScfm), unit: "scfm" },
      rngCH4: { value: productCH4, unit: "%" },
      rngEnergy: { value: roundTo(rngMMBtuPerDay, 1), unit: "MMBtu/day" },
      tailgasFlow: { value: roundTo(tailgasM3PerDay), unit: "m³/day" },
    },
    designCriteria: AD_DEFAULTS.gasUpgrading,
    notes: [
      "Membrane or PSA upgrading",
      `Electrical demand: ${roundTo(electricalDemandKW)} kW`,
    ],
  };
  adStages.push(upgradingStage);

  allEquipment.push({
    id: makeId(),
    process: "Gas Upgrading",
    equipmentType: "Membrane/PSA Upgrading System",
    description: "CO₂ removal and methane enrichment to pipeline quality",
    quantity: 1,
    specs: {
      inletFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
      productFlow: { value: String(roundTo(rngScfm)), unit: "scfm" },
      productCH4: { value: String(productCH4), unit: "%" },
      methaneRecovery: { value: "97", unit: "%" },
    },
    designBasis: "97% methane recovery, pipeline quality RNG",
    notes: "",
    isOverridden: false,
    isLocked: false,
  });

  allEquipment.push({
    id: makeId(),
    process: "Gas Upgrading",
    equipmentType: "RNG Compressor",
    description: "Multi-stage compressor for pipeline injection",
    quantity: 1,
    specs: {
      flow: { value: String(roundTo(rngScfm)), unit: "scfm" },
      dischargePressure: { value: "200", unit: "psig" },
    },
    designBasis: "Pipeline injection pressure",
    notes: "",
    isOverridden: false,
    isLocked: false,
  });

  allEquipment.push({
    id: makeId(),
    process: "Gas Management",
    equipmentType: "Enclosed Flare",
    description: "Tail gas and excess biogas combustion",
    quantity: 1,
    specs: {
      capacity: { value: String(roundTo(biogasScfm * 1.1)), unit: "scfm" },
    },
    designBasis: "110% of max biogas production",
    notes: "",
    isOverridden: false,
    isLocked: false,
  });

  const digestedTSKgPerDay = totalTSLoad - vsDestroyedKgPerDay;
  const dewateringCaptureRate = AD_DEFAULTS.dewateringPost.captureRate.value / 100;
  const cakeSolids = AD_DEFAULTS.dewateringPost.cakeSolids.value / 100;
  const cakeKgPerDay = (digestedTSKgPerDay * dewateringCaptureRate) / cakeSolids;
  const cakeTPD = cakeKgPerDay / 1000;

  const dewateringStage: ADProcessStage = {
    name: "Post-Digestion Dewatering",
    type: "dewatering",
    inputStream: {
      digestedSludgeTS: { value: roundTo(digestedTSKgPerDay), unit: "kg TS/day" },
    },
    outputStream: {
      cake: { value: roundTo(cakeTPD), unit: "tons/day" },
      cakeSolidsContent: { value: AD_DEFAULTS.dewateringPost.cakeSolids.value, unit: "% TS" },
    },
    designCriteria: AD_DEFAULTS.dewateringPost,
    notes: ["Belt filter press or centrifuge", "Filtrate returned to headworks"],
  };
  adStages.push(dewateringStage);

  allEquipment.push({
    id: makeId(),
    process: "Dewatering",
    equipmentType: "Belt Filter Press",
    description: "Dewatering of digested sludge",
    quantity: cakeTPD > 20 ? 2 : 1,
    specs: {
      capacity: { value: String(roundTo(cakeTPD)), unit: "tons/day" },
      cakeSolids: { value: "22", unit: "% TS" },
    },
    designBasis: "95% solids capture",
    notes: "Polymer system included",
    isOverridden: false,
    isLocked: false,
  });

  const combinedEquipment = [...wwEquipment, ...allEquipment];

  const summary: Record<string, { value: string; unit: string }> = {
    wastewaterFlow: { value: roundTo(flowMGD, 2).toString(), unit: "MGD" },
    wwTreatmentStages: { value: String(wwStages.length), unit: "stages" },
    totalVSLoad: { value: roundTo(totalVSLoad).toLocaleString(), unit: "kg VS/day" },
    wwSludgeVS: { value: roundTo(wwVSKgPerDay).toLocaleString(), unit: "kg VS/day" },
    truckedFeedstockVS: { value: roundTo(truckedVSKgPerDay).toLocaleString(), unit: "kg VS/day" },
    biogasProduction: { value: roundTo(biogasM3PerDay).toLocaleString(), unit: "m³/day" },
    biogasFlowSCFM: { value: roundTo(biogasScfm).toLocaleString(), unit: "scfm" },
    rngProduction: { value: roundTo(rngM3PerDay).toLocaleString(), unit: "m³/day" },
    rngFlowSCFM: { value: roundTo(rngScfm).toLocaleString(), unit: "scfm" },
    rngEnergy: { value: roundTo(rngMMBtuPerDay, 1).toLocaleString(), unit: "MMBtu/day" },
    rngEnergyGJ: { value: roundTo(rngGJPerDay, 1).toLocaleString(), unit: "GJ/day" },
    digesterVolume: { value: roundTo(digesterVolM3).toLocaleString(), unit: "m³" },
    biosolidsCake: { value: roundTo(cakeTPD).toLocaleString(), unit: "tons/day" },
    electricalDemand: { value: roundTo(electricalDemandKW).toLocaleString(), unit: "kW" },
  };

  return {
    projectType: "D",
    stages: wwStages,
    adStages,
    recycleStreams: wwRecycleStreams,
    equipment: combinedEquipment,
    convergenceIterations: wwResult.convergenceIterations,
    convergenceAchieved: wwResult.convergenceAchieved,
    assumptions,
    warnings,
    summary,
  };
}
