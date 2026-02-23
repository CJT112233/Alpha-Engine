import type {
  ADProcessStage,
  CalculationStep,
  EquipmentItem,
  MassBalanceResults,
  UpifRecord,
  FeedstockEntry,
  TreatmentStage,
  StreamData,
  RecycleStream,
} from "@shared/schema";
import { calculateMassBalance } from "./massBalance";
import {
  selectProdevalUnit,
  getProdevalEquipmentList,
  getProdevalGasTrainDesignCriteria,
} from "@shared/prodeval-equipment-library";
import type { DesignOverrides } from "./designOverrides";

type DesignCriterion = { value: number; unit: string; source: string };

const AD_DEFAULTS: Record<string, Record<string, DesignCriterion>> = {
  sludgeThickening: {
    thickenedSolids: { value: 5, unit: "% TS", source: "WEF MOP 8" },
    captureRate: { value: 95, unit: "%", source: "Gravity belt thickener" },
  },
  digester: {
    hrt: { value: 20, unit: "days", source: "WEF MOP 8 — WWTP sludge" },
    organicLoadingRate: { value: 2.5, unit: "kg VS/m³·d", source: "WEF MOP 8" },
    vsDestruction: { value: 58, unit: "%", source: "WEF MOP 8 — mixed sludge" },
    temperature: { value: 35, unit: "°C", source: "Mesophilic standard" },
    mixingPower: { value: 5, unit: "W/m³", source: "WEF MOP 8" },
    gasYield: { value: 0.9, unit: "scf/lb VS destroyed", source: "WEF MOP 8 — municipal sludge" },
    ch4Content: { value: 63, unit: "%", source: "Typical WWTP biogas" },
    co2Content: { value: 35, unit: "%", source: "Typical WWTP biogas" },
    h2sContent: { value: 500, unit: "ppmv", source: "Typical WWTP biogas — lower than AD-only" },
  },
  truckedFeedstock: {
    defaultTS: { value: 15, unit: "%", source: "Typical trucked feedstock" },
    defaultVS: { value: 80, unit: "% of TS", source: "Typical organic waste" },
    defaultBMP: { value: 0.35, unit: "scf CH₄/lb VS", source: "Engineering practice" },
  },
  gasConditioning: {
    h2sRemovalEff: { value: 99.5, unit: "%", source: "Iron sponge/bioscrubber" },
    moistureRemoval: { value: 99, unit: "%", source: "Chiller/desiccant" },
    siloxaneRemoval: { value: 95, unit: "%", source: "Activated carbon" },
  },
  gasUpgrading: {
    methaneRecovery: { value: 97, unit: "%", source: "Membrane/PSA typical" },
    productCH4: { value: 97, unit: "%", source: "Pipeline quality RNG" },
    electricalDemand: { value: 8.8, unit: "kWh/1,000 scf raw biogas", source: "Engineering practice" },
    pressureOut: { value: 200, unit: "psig", source: "Pipeline injection" },
  },
  dewateringPost: {
    cakeSolids: { value: 22, unit: "% TS", source: "Belt filter press — digested sludge" },
    captureRate: { value: 95, unit: "%", source: "WEF MOP 8" },
  },
};

function m3ToGal(m3: number): number { return m3 * 264.172; }
function m3ToScf(m3: number): number { return m3 * 35.3147; }

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

function fmt(v: number, decimals: number = 1): string {
  return roundTo(v, decimals).toLocaleString();
}

function cloneDefaults(): Record<string, Record<string, DesignCriterion>> {
  return JSON.parse(JSON.stringify(AD_DEFAULTS));
}

function applyDesignOverridesD(defs: Record<string, Record<string, DesignCriterion>>, overrides: DesignOverrides): void {
  if (overrides.hrtDays !== undefined) defs.digester.hrt.value = overrides.hrtDays;
  if (overrides.vsDestructionPct !== undefined) defs.digester.vsDestruction.value = overrides.vsDestructionPct;
  if (overrides.olrTarget !== undefined) defs.digester.organicLoadingRate.value = overrides.olrTarget;
  if (overrides.digesterTempC !== undefined) defs.digester.temperature.value = overrides.digesterTempC;
  if (overrides.mixingPowerWPerM3 !== undefined) defs.digester.mixingPower.value = overrides.mixingPowerWPerM3;
  if (overrides.gasYield !== undefined) defs.digester.gasYield.value = overrides.gasYield;
  if (overrides.ch4Pct !== undefined) defs.digester.ch4Content.value = overrides.ch4Pct;
  if (overrides.co2Pct !== undefined) defs.digester.co2Content.value = overrides.co2Pct;
  if (overrides.h2sPpmv !== undefined) defs.digester.h2sContent.value = overrides.h2sPpmv;
  if (overrides.cakeSolidsPct !== undefined && defs.dewateringPost) defs.dewateringPost.cakeSolids.value = overrides.cakeSolidsPct;
  if (overrides.solidsCaptureEff !== undefined && defs.dewateringPost) defs.dewateringPost.captureRate.value = overrides.solidsCaptureEff;
}

export function calculateMassBalanceTypeD(upif: UpifRecord, designOverrides?: DesignOverrides): MassBalanceResults {
  const warnings: MassBalanceResults["warnings"] = [];
  const assumptions: MassBalanceResults["assumptions"] = [];
  const calculationSteps: CalculationStep[] = [];
  const adStages: ADProcessStage[] = [];
  const allEquipment: EquipmentItem[] = [];
  let eqId = 100;
  const makeId = () => `eq-d-${eqId++}`;

  const defaults = cloneDefaults();
  if (designOverrides && Object.keys(designOverrides).length > 0) {
    applyDesignOverridesD(defaults, designOverrides);
    console.log(`Mass Balance Type D: Applying design overrides: ${JSON.stringify(designOverrides)}`);
  }

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
    const ts = getSpecValue(fs, ["totalSolids", "total solids", "ts"], defaults.truckedFeedstock.defaultTS.value);
    const vsOfTs = getSpecValue(fs, ["volatileSolids", "volatile solids", "vs", "vs/ts"], defaults.truckedFeedstock.defaultVS.value);
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

  const thickenedTS = defaults.sludgeThickening.thickenedSolids.value / 100;
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
      blendedSludgeVolume: { value: roundTo(m3ToGal(sludgeVolM3PerDay)), unit: "gpd" },
      thickenedTS: { value: defaults.sludgeThickening.thickenedSolids.value, unit: "% TS" },
      totalVS: { value: roundTo(totalVSLoad), unit: "kg VS/day" },
    },
    designCriteria: defaults.sludgeThickening,
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
      throughput: { value: String(roundTo(m3ToGal(sludgeVolM3PerDay))), unit: "gpd" },
    },
    designBasis: "95% solids capture, 5% cake TS",
    notes: "Polymer conditioning included",
    isOverridden: false,
    isLocked: false,
  });

  const vsDestruction = defaults.digester.vsDestruction.value / 100;
  const hrt = defaults.digester.hrt.value;
  const olr = defaults.digester.organicLoadingRate.value;
  const gasYield = defaults.digester.gasYield.value;
  const ch4Pct = defaults.digester.ch4Content.value;
  const h2sPpmv = defaults.digester.h2sContent.value;

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
  assumptions.push({ parameter: "AD Biogas Yield", value: `${roundTo(gasYield * 35.3147 / 2.20462, 1)} scf/lb VS destroyed`, source: "WEF MOP 8" });
  assumptions.push({ parameter: "AD Biogas CH₄", value: `${ch4Pct}%`, source: "Typical WWTP biogas" });

  const digesterStage: ADProcessStage = {
    name: "Anaerobic Digestion",
    type: "digester",
    inputStream: {
      sludgeVolume: { value: roundTo(m3ToGal(sludgeVolM3PerDay)), unit: "gpd" },
      vsLoad: { value: roundTo(totalVSLoad), unit: "kg VS/day" },
      tsLoad: { value: roundTo(totalTSLoad), unit: "kg TS/day" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(m3ToScf(biogasM3PerDay)), unit: "scfd" },
      biogasFlowSCFM: { value: roundTo(biogasScfm), unit: "scfm" },
      ch4Content: { value: ch4Pct, unit: "%" },
      h2sContent: { value: h2sPpmv, unit: "ppmv" },
      vsDestroyed: { value: roundTo(vsDestroyedKgPerDay), unit: "kg/day" },
    },
    designCriteria: defaults.digester,
    notes: [
      `${numDigesters} digester(s) at ${roundTo(m3ToGal(perDigesterVol)).toLocaleString()} gallons each`,
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
      volume: { value: String(roundTo(m3ToGal(perDigesterVol))), unit: "gallons" },
      totalVolume: { value: String(roundTo(m3ToGal(digesterVolM3))), unit: "gallons" },
      hrt: { value: String(hrt), unit: "days" },
      olr: { value: String(roundTo(totalVSLoad / digesterVolM3, 2)), unit: "kg VS/m³·d" },
      temperature: { value: "35", unit: "°C" },
    },
    designBasis: `${hrt}-day HRT, OLR ≤ ${olr} kg VS/m³·d`,
    notes: "Includes gas collection, mixing, and heating",
    isOverridden: false,
    isLocked: false,
  });

  const prodevDesign = getProdevalGasTrainDesignCriteria(biogasScfm);
  const prodevUnit = selectProdevalUnit(biogasScfm);

  const h2sRemovalEff = prodevDesign.gasConditioning.h2sRemovalEff.value / 100;
  const outH2sPpmv = h2sPpmv * (1 - h2sRemovalEff);
  const conditionedBiogasM3PerDay = biogasM3PerDay * (1 - prodevDesign.gasConditioning.volumeLoss.value / 100);
  const conditionedScfm = biogasScfm * (1 - prodevDesign.gasConditioning.volumeLoss.value / 100);

  const conditioningStage: ADProcessStage = {
    name: "Biogas Conditioning (Prodeval)",
    type: "gasConditioning",
    inputStream: {
      biogasFlow: { value: roundTo(m3ToScf(biogasM3PerDay)), unit: "scfd" },
      biogasFlowSCFM: { value: roundTo(biogasScfm), unit: "SCFM" },
      ch4Content: { value: ch4Pct, unit: "%" },
      h2sContent: { value: h2sPpmv, unit: "ppmv" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(m3ToScf(conditionedBiogasM3PerDay)), unit: "scfd" },
      biogasFlowSCFM: { value: roundTo(conditionedScfm), unit: "SCFM" },
      h2sContent: { value: roundTo(outH2sPpmv, 1), unit: "ppmv" },
      moisture: { value: 0, unit: "dry" },
    },
    designCriteria: prodevDesign.gasConditioning,
    notes: [
      `Prodeval VALOGAZ® FU 100/200 + VALOPACK® FU 300 — ${prodevUnit.numberOfTrains} train(s)`,
      `H₂S removal: ${h2sPpmv} → ${roundTo(outH2sPpmv, 1)} ppmv`,
      "Moisture removal via Prodeval VALOGAZ® refrigerated condenser to 39°F dewpoint",
      "H₂S + siloxane removal via Prodeval VALOPACK® lead-lag activated carbon",
    ],
  };
  adStages.push(conditioningStage);

  const methaneRecovery = prodevDesign.gasUpgrading.methaneRecovery.value / 100;
  const productCH4 = prodevDesign.gasUpgrading.productCH4.value;
  const rngCH4M3PerDay = ch4M3PerDay * methaneRecovery;
  const rngM3PerDay = rngCH4M3PerDay / (productCH4 / 100);
  const rngScfPerDay = rngM3PerDay * 35.3147;
  const rngScfm = rngScfPerDay / 1440;
  const rngMMBtuPerDay = rngScfPerDay * 1012 / 1_000_000;
  const tailgasM3PerDay = conditionedBiogasM3PerDay - rngM3PerDay;
  const tailgasScfm = roundTo(m3ToScf(tailgasM3PerDay) / 1440);
  const electricalDemandKW = biogasM3PerDay * prodevDesign.gasUpgrading.electricalDemand.value / 24;
  const pressureOut = prodevDesign.gasUpgrading.pressureOut.value;

  const upgradingStage: ADProcessStage = {
    name: "Gas Upgrading to RNG (Prodeval)",
    type: "gasUpgrading",
    inputStream: {
      biogasFlow: { value: roundTo(m3ToScf(conditionedBiogasM3PerDay)), unit: "scfd" },
      biogasFlowSCFM: { value: roundTo(conditionedScfm), unit: "SCFM" },
      ch4Content: { value: ch4Pct, unit: "%" },
    },
    outputStream: {
      rngFlow: { value: roundTo(m3ToScf(rngM3PerDay)), unit: "scfd" },
      rngFlowSCFM: { value: roundTo(rngScfm), unit: "SCFM" },
      rngCH4: { value: productCH4, unit: "%" },
      rngPressure: { value: pressureOut, unit: "psig" },
      rngEnergy: { value: roundTo(rngMMBtuPerDay, 1), unit: "MMBtu/day" },
      tailgasFlow: { value: roundTo(m3ToScf(tailgasM3PerDay)), unit: "scfd" },
      tailgasFlowSCFM: { value: tailgasScfm, unit: "SCFM" },
      methaneRecovery: { value: roundTo(methaneRecovery * 100), unit: "%" },
    },
    designCriteria: prodevDesign.gasUpgrading,
    notes: [
      `Prodeval VALOPUR® FU 500 — 3-stage membrane separation`,
      `RNG product: ${roundTo(rngScfm)} SCFM at ${pressureOut} psig, ≥${productCH4}% CH₄`,
      `Tail gas: ${tailgasScfm} SCFM → thermal oxidizer or flare`,
      `Electrical demand: ${roundTo(electricalDemandKW)} kW`,
    ],
  };
  adStages.push(upgradingStage);

  const prodevalEquipment = getProdevalEquipmentList(biogasScfm, (suffix?: string) => `eq-d-${suffix || eqId++}`);
  for (const pe of prodevalEquipment) {
    allEquipment.push({
      ...pe,
      isOverridden: false,
      isLocked: false,
    });
  }

  const flareHeight = roundTo(Math.max(15, Math.sqrt(biogasScfm) * 2), 0);
  allEquipment.push({
    id: makeId(),
    process: "Gas Management",
    equipmentType: "Enclosed Flare",
    description: "Enclosed ground flare for tail gas and excess biogas combustion",
    quantity: 1,
    specs: {
      capacity: { value: String(roundTo(biogasScfm * 1.1)), unit: "scfm" },
      destructionEff: { value: "99.5", unit: "%" },
      dimensionsL: { value: "8", unit: "ft (dia)" },
      dimensionsW: { value: "8", unit: "ft (dia)" },
      dimensionsH: { value: String(flareHeight), unit: "ft" },
      power: { value: "5", unit: "HP" },
    },
    designBasis: "110% of maximum biogas production",
    notes: "Emergency flare for biogas + tail gas combustion",
    isOverridden: false,
    isLocked: false,
  });

  const digestedTSKgPerDay = totalTSLoad - vsDestroyedKgPerDay;
  const dewateringCaptureRate = defaults.dewateringPost.captureRate.value / 100;
  const cakeSolids = defaults.dewateringPost.cakeSolids.value / 100;
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
      cakeSolidsContent: { value: defaults.dewateringPost.cakeSolids.value, unit: "% TS" },
    },
    designCriteria: defaults.dewateringPost,
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

  calculationSteps.push({
    category: "Sludge Characterization",
    label: "WW Sludge VS Load",
    formula: "(Primary Sludge TS × VS/TS_primary) + (WAS TS × VS/TS_WAS)",
    inputs: [
      { name: "Primary Sludge TS", value: fmt(primarySludgeTSKgPerDay), unit: "kg TS/day" },
      { name: "Primary VS/TS", value: fmt(primaryVSFraction * 100), unit: "%" },
      { name: "WAS Sludge TS", value: fmt(wasSludgeTSKgPerDay), unit: "kg TS/day" },
      { name: "WAS VS/TS", value: fmt(wasVSFraction * 100), unit: "%" },
    ],
    result: { value: fmt(wwVSKgPerDay), unit: "kg VS/day" },
  });
  if (truckedFeedstocks.length > 0) {
    calculationSteps.push({
      category: "Sludge Characterization",
      label: "Trucked Feedstock VS Load",
      formula: "Sum of (Feed × TS% × VS/TS%) for each trucked feedstock",
      inputs: truckedFeedstocks.map(fs => ({
        name: fs.feedstockType || "Trucked Feedstock",
        value: fmt(parseFeedstockVolume(fs)),
        unit: "tons/day",
      })),
      result: { value: fmt(truckedVSKgPerDay), unit: "kg VS/day" },
    });
  }
  calculationSteps.push({
    category: "Sludge Characterization",
    label: "Total VS Load to Digester",
    formula: "WW Sludge VS + Trucked Feedstock VS",
    inputs: [
      { name: "WW Sludge VS", value: fmt(wwVSKgPerDay), unit: "kg VS/day" },
      { name: "Trucked Feedstock VS", value: fmt(truckedVSKgPerDay), unit: "kg VS/day" },
    ],
    result: { value: fmt(totalVSLoad), unit: "kg VS/day" },
  });
  calculationSteps.push({
    category: "Anaerobic Digestion",
    label: "VS Destroyed",
    formula: "Total VS Load × VS Destruction Rate",
    inputs: [
      { name: "Total VS Load", value: fmt(totalVSLoad), unit: "kg VS/day" },
      { name: "VS Destruction", value: fmt(vsDestruction * 100), unit: "%" },
    ],
    result: { value: fmt(vsDestroyedKgPerDay), unit: "kg/day" },
  });
  calculationSteps.push({
    category: "Anaerobic Digestion",
    label: "Raw Biogas Production",
    formula: "VS Destroyed × Biogas Yield",
    inputs: [
      { name: "VS Destroyed", value: fmt(vsDestroyedKgPerDay), unit: "kg/day" },
      { name: "Biogas Yield", value: fmt(gasYield, 2), unit: "m³/kg VS" },
    ],
    result: { value: fmt(biogasScfm), unit: "SCFM" },
    notes: `= ${fmt(biogasScfPerDay, 0)} scf/day`,
  });
  calculationSteps.push({
    category: "Anaerobic Digestion",
    label: "Digester Volume (governing)",
    formula: "Max(Sludge Volume × HRT, VS Load ÷ OLR)",
    inputs: [
      { name: "By HRT", value: fmt(m3ToGal(digesterVolumeByHRT), 0), unit: "gallons" },
      { name: "By OLR", value: fmt(m3ToGal(digesterVolumeByOLR), 0), unit: "gallons" },
    ],
    result: { value: fmt(m3ToGal(digesterVolM3), 0), unit: "gallons" },
    notes: `${numDigesters} digester(s), HRT = ${roundTo(digesterVolM3 / sludgeVolM3PerDay)} days, OLR = ${roundTo(totalVSLoad / digesterVolM3, 2)} kg VS/m³·d`,
  });
  calculationSteps.push({
    category: "Gas Conditioning",
    label: "Conditioned Biogas Flow",
    formula: "Raw Biogas × (1 − Volume Loss%)",
    inputs: [
      { name: "Raw Biogas", value: fmt(biogasScfm), unit: "SCFM" },
      { name: "Volume Loss", value: fmt(prodevDesign.gasConditioning.volumeLoss.value), unit: "%" },
    ],
    result: { value: fmt(conditionedScfm), unit: "SCFM" },
  });
  const ch4ScfPerDayD = biogasScfPerDay * (ch4Pct / 100);
  calculationSteps.push({
    category: "Gas Upgrading (RNG)",
    label: "CH₄ Available in Biogas",
    formula: "Biogas Flow (scf/day) × CH₄%",
    inputs: [
      { name: "Biogas", value: fmt(biogasScfPerDay, 0), unit: "scf/day" },
      { name: "CH₄ Content", value: fmt(ch4Pct), unit: "%" },
    ],
    result: { value: fmt(ch4ScfPerDayD, 0), unit: "scf CH₄/day" },
  });
  calculationSteps.push({
    category: "Gas Upgrading (RNG)",
    label: "RNG Product Flow",
    formula: "CH₄ Available × Methane Recovery ÷ Product Purity",
    inputs: [
      { name: "CH₄ Available", value: fmt(ch4ScfPerDayD, 0), unit: "scf/day" },
      { name: "Methane Recovery", value: fmt(methaneRecovery * 100), unit: "%" },
      { name: "Product CH₄", value: fmt(productCH4), unit: "%" },
    ],
    result: { value: fmt(rngScfm), unit: "SCFM" },
    notes: `= ${fmt(rngScfPerDay, 0)} scf/day, ${fmt(rngMMBtuPerDay)} MMBTU/day`,
  });
  calculationSteps.push({
    category: "Gas Upgrading (RNG)",
    label: "Tail Gas Flow",
    formula: "Conditioned Biogas − RNG Product",
    inputs: [
      { name: "Conditioned", value: fmt(conditionedScfm), unit: "SCFM" },
      { name: "RNG Product", value: fmt(rngScfm), unit: "SCFM" },
    ],
    result: { value: fmt(tailgasScfm), unit: "SCFM" },
  });
  calculationSteps.push({
    category: "Post-Digestion",
    label: "Dewatered Cake Production",
    formula: "Digested TS × Capture Rate ÷ Cake Solids%",
    inputs: [
      { name: "Digested TS", value: fmt(digestedTSKgPerDay), unit: "kg/day" },
      { name: "Capture Rate", value: fmt(dewateringCaptureRate * 100), unit: "%" },
      { name: "Cake Solids", value: fmt(cakeSolids * 100), unit: "% TS" },
    ],
    result: { value: fmt(cakeTPD), unit: "tons/day" },
  });

  const summary: Record<string, { value: string; unit: string }> = {
    wastewaterFlow: { value: roundTo(flowMGD, 2).toString(), unit: "MGD" },
    wwTreatmentStages: { value: String(wwStages.length), unit: "stages" },
    totalVSLoad: { value: roundTo(totalVSLoad).toLocaleString(), unit: "kg VS/day" },
    wwSludgeVS: { value: roundTo(wwVSKgPerDay).toLocaleString(), unit: "kg VS/day" },
    truckedFeedstockVS: { value: roundTo(truckedVSKgPerDay).toLocaleString(), unit: "kg VS/day" },
    biogasProduction: { value: roundTo(m3ToScf(biogasM3PerDay)).toLocaleString(), unit: "scfd" },
    biogasFlowSCFM: { value: roundTo(biogasScfm).toLocaleString(), unit: "scfm" },
    rngProduction: { value: roundTo(rngMMBtuPerDay, 1).toLocaleString(), unit: "MMBTU/day" },
    rngFlowSCFM: { value: roundTo(rngScfm).toLocaleString(), unit: "SCFM" },
    digesterVolume: { value: roundTo(m3ToGal(digesterVolM3)).toLocaleString(), unit: "gallons" },
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
    calculationSteps,
  };
}
