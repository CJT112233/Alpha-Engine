import type {
  ADProcessStage,
  EquipmentItem,
  MassBalanceResults,
  UpifRecord,
  FeedstockEntry,
} from "@shared/schema";

type DesignCriterion = { value: number; unit: string; source: string };

const AD_DESIGN_DEFAULTS: Record<string, Record<string, DesignCriterion>> = {
  receiving: {
    receivingCapacity: { value: 1.5, unit: "x design throughput", source: "Engineering practice" },
    storageTime: { value: 3, unit: "days", source: "Engineering practice" },
    tankMaterial: { value: 1, unit: "concrete/steel", source: "Engineering practice" },
  },
  pretreatment: {
    screenSize: { value: 10, unit: "mm", source: "Engineering practice" },
    gritRemoval: { value: 95, unit: "%", source: "Engineering practice" },
    heatingTemp: { value: 38, unit: "°C", source: "Mesophilic AD standard" },
  },
  digester: {
    hrt: { value: 25, unit: "days", source: "WEF MOP 8" },
    organicLoadingRate: { value: 3.0, unit: "kg VS/m³·d", source: "WEF MOP 8" },
    vsDestruction: { value: 65, unit: "%", source: "WEF MOP 8" },
    temperature: { value: 38, unit: "°C", source: "Mesophilic standard" },
    mixingPower: { value: 5, unit: "W/m³", source: "WEF MOP 8" },
    gasYield: { value: 0.8, unit: "m³/kg VS destroyed", source: "Engineering practice" },
    ch4Content: { value: 60, unit: "%", source: "Typical AD biogas" },
    co2Content: { value: 38, unit: "%", source: "Typical AD biogas" },
    h2sContent: { value: 1500, unit: "ppmv", source: "Typical AD biogas" },
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
  digestateHandling: {
    solidsSeparationEff: { value: 25, unit: "%", source: "Screw press typical" },
    cakeSolids: { value: 25, unit: "% TS", source: "Screw press typical" },
    filtrateTSS: { value: 5000, unit: "mg/L", source: "Engineering practice" },
  },
};

function parseFeedstockVolume(fs: FeedstockEntry): { tpd: number; unit: string } {
  const vol = parseFloat((fs.feedstockVolume || "0").replace(/,/g, ""));
  const unit = (fs.feedstockUnit || "").toLowerCase();
  if (isNaN(vol) || vol <= 0) return { tpd: 0, unit: "tons/day" };
  if (unit.includes("ton") && unit.includes("year")) return { tpd: vol / 365, unit: "tons/day" };
  if (unit.includes("ton") && unit.includes("day")) return { tpd: vol, unit: "tons/day" };
  if (unit.includes("ton") && unit.includes("week")) return { tpd: vol / 7, unit: "tons/day" };
  if (unit.includes("lb") && unit.includes("day")) return { tpd: vol / 2000, unit: "tons/day" };
  if (unit.includes("kg") && unit.includes("day")) return { tpd: vol / 1000, unit: "tons/day" };
  if (unit.includes("gallon") && unit.includes("day")) return { tpd: vol * 8.34 / 2000, unit: "tons/day" };
  if (unit.includes("ton")) return { tpd: vol / 365, unit: "tons/day" };
  return { tpd: vol, unit: "tons/day" };
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

function roundTo(val: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

export function calculateMassBalanceTypeB(upif: UpifRecord): MassBalanceResults {
  const warnings: MassBalanceResults["warnings"] = [];
  const assumptions: MassBalanceResults["assumptions"] = [];
  const adStages: ADProcessStage[] = [];
  const equipment: EquipmentItem[] = [];
  let eqId = 1;
  const makeId = () => `eq-${eqId++}`;

  const feedstocks = (upif.feedstocks || []) as FeedstockEntry[];
  if (feedstocks.length === 0) {
    warnings.push({ field: "Feedstock", message: "No feedstocks found in UPIF", severity: "error" });
    return {
      projectType: "B",
      stages: [],
      adStages: [],
      recycleStreams: [],
      equipment: [],
      convergenceIterations: 0,
      convergenceAchieved: true,
      assumptions,
      warnings,
      summary: {},
    };
  }

  let totalFeedTpd = 0;
  let totalVSLoadKgPerDay = 0;
  let weightedTS = 0;
  let weightedVS = 0;
  let weightedBMP = 0;
  let weightedCN = 0;
  let totalWeightForAvg = 0;

  for (const fs of feedstocks) {
    const { tpd } = parseFeedstockVolume(fs);
    if (tpd <= 0) {
      warnings.push({ field: "Volume", message: `No volume found for "${fs.feedstockType}"`, severity: "warning" });
      continue;
    }
    const ts = getSpecValue(fs, ["totalSolids", "total solids", "ts"], 15);
    const vsOfTs = getSpecValue(fs, ["volatileSolids", "volatile solids", "vs", "vs/ts"], 80);
    const bmp = getSpecValue(fs, ["methanePotential", "bmp", "biochemical methane potential"], 0.30);
    const cn = getSpecValue(fs, ["cnRatio", "c:n ratio", "c:n", "c/n"], 25);

    const feedKgPerDay = tpd * 1000;
    const tsKg = feedKgPerDay * (ts / 100);
    const vsKg = tsKg * (vsOfTs / 100);

    totalFeedTpd += tpd;
    totalVSLoadKgPerDay += vsKg;
    weightedTS += ts * tpd;
    weightedVS += vsOfTs * tpd;
    weightedBMP += bmp * vsKg;
    weightedCN += cn * tpd;
    totalWeightForAvg += tpd;

    if (ts <= 0) assumptions.push({ parameter: `${fs.feedstockType} TS`, value: "15%", source: "Default assumption" });
    if (vsOfTs <= 0) assumptions.push({ parameter: `${fs.feedstockType} VS/TS`, value: "80%", source: "Default assumption" });
  }

  if (totalFeedTpd <= 0) {
    warnings.push({ field: "Feed Rate", message: "Total feed rate is zero; cannot calculate mass balance", severity: "error" });
    return {
      projectType: "B",
      stages: [],
      adStages: [],
      recycleStreams: [],
      equipment: [],
      convergenceIterations: 0,
      convergenceAchieved: true,
      assumptions,
      warnings,
      summary: {},
    };
  }

  const avgTS = weightedTS / totalWeightForAvg;
  const avgVS = weightedVS / totalWeightForAvg;
  const avgBMP = totalVSLoadKgPerDay > 0 ? weightedBMP / totalVSLoadKgPerDay : 0.30;
  const avgCN = weightedCN / totalWeightForAvg;

  assumptions.push({ parameter: "Blended TS", value: `${roundTo(avgTS)}%`, source: "Weighted average" });
  assumptions.push({ parameter: "Blended VS/TS", value: `${roundTo(avgVS)}%`, source: "Weighted average" });
  assumptions.push({ parameter: "Blended BMP", value: `${roundTo(avgBMP, 3)} m³ CH₄/kg VS`, source: "Weighted average" });

  const receivingStage: ADProcessStage = {
    name: "Feedstock Receiving & Storage",
    type: "receiving",
    inputStream: {
      feedRate: { value: roundTo(totalFeedTpd), unit: "tons/day" },
      totalSolids: { value: roundTo(avgTS), unit: "%" },
    },
    outputStream: {
      feedRate: { value: roundTo(totalFeedTpd), unit: "tons/day" },
      totalSolids: { value: roundTo(avgTS), unit: "%" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.receiving,
    notes: [`Receiving ${feedstocks.length} feedstock(s), total ${roundTo(totalFeedTpd).toLocaleString()} tons/day`],
  };
  adStages.push(receivingStage);

  const storageVolM3 = (totalFeedTpd * 1000 / (avgTS > 10 ? 1.05 : 1.0)) * AD_DESIGN_DEFAULTS.receiving.storageTime.value;
  equipment.push({
    id: makeId(),
    process: "Feedstock Receiving",
    equipmentType: "Receiving Tank/Pit",
    description: "Covered receiving and mixing tank with truck unloading",
    quantity: feedstocks.length > 2 ? 2 : 1,
    specs: {
      volume: { value: String(roundTo(storageVolM3)), unit: "m³" },
      storageTime: { value: "3", unit: "days" },
    },
    designBasis: "1.5x design throughput with 3-day storage",
    notes: "Includes odor control and leak detection",
    isOverridden: false,
    isLocked: false,
  });

  const pretreatStage: ADProcessStage = {
    name: "Pre-treatment & Mixing",
    type: "pretreatment",
    inputStream: {
      feedRate: { value: roundTo(totalFeedTpd), unit: "tons/day" },
      totalSolids: { value: roundTo(avgTS), unit: "%" },
      vsLoad: { value: roundTo(totalVSLoadKgPerDay), unit: "kg VS/day" },
    },
    outputStream: {
      feedRate: { value: roundTo(totalFeedTpd), unit: "tons/day" },
      totalSolids: { value: roundTo(avgTS), unit: "%" },
      temperature: { value: 38, unit: "°C" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.pretreatment,
    notes: ["Screening, grit removal, and heating to mesophilic temperature"],
  };
  adStages.push(pretreatStage);

  equipment.push({
    id: makeId(),
    process: "Pre-treatment",
    equipmentType: "Rotary Drum Screen",
    description: "Removes contaminants > 10mm from feedstock slurry",
    quantity: 1,
    specs: {
      screenSize: { value: "10", unit: "mm" },
      capacity: { value: String(roundTo(totalFeedTpd * 1.25)), unit: "tons/day" },
    },
    designBasis: "1.25x design feed rate",
    notes: "Includes screenings handling and disposal",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId(),
    process: "Pre-treatment",
    equipmentType: "Feed Heater",
    description: "Heat exchanger to raise feed temperature to mesophilic range",
    quantity: 1,
    specs: {
      targetTemp: { value: "38", unit: "°C" },
      heatDuty: { value: String(roundTo(totalFeedTpd * 1000 * 4.18 * (38 - 15) / 3600, 0)), unit: "kW" },
    },
    designBasis: "Heating from 15°C ambient to 38°C mesophilic",
    notes: "Waste heat recovery from biogas engine where available",
    isOverridden: false,
    isLocked: false,
  });

  const vsDestruction = AD_DESIGN_DEFAULTS.digester.vsDestruction.value / 100;
  const hrt = AD_DESIGN_DEFAULTS.digester.hrt.value;
  const olr = AD_DESIGN_DEFAULTS.digester.organicLoadingRate.value;
  const gasYield = AD_DESIGN_DEFAULTS.digester.gasYield.value;
  const ch4Pct = AD_DESIGN_DEFAULTS.digester.ch4Content.value;
  const co2Pct = AD_DESIGN_DEFAULTS.digester.co2Content.value;
  const h2sPpmv = AD_DESIGN_DEFAULTS.digester.h2sContent.value;

  const vsDestroyedKgPerDay = totalVSLoadKgPerDay * vsDestruction;
  const biogasM3PerDay = vsDestroyedKgPerDay * gasYield;
  const biogasScfPerDay = biogasM3PerDay * 35.3147;
  const biogasScfm = biogasScfPerDay / 1440;
  const ch4M3PerDay = biogasM3PerDay * (ch4Pct / 100);

  const digesterVolumeByHRT = (totalFeedTpd * 1000 / (avgTS > 10 ? 1.05 : 1.0)) * hrt;
  const digesterVolumeByOLR = totalVSLoadKgPerDay / olr;
  const digesterVolM3 = Math.max(digesterVolumeByHRT, digesterVolumeByOLR);
  const numDigesters = digesterVolM3 > 5000 ? 2 : 1;
  const perDigesterVol = digesterVolM3 / numDigesters;

  assumptions.push({ parameter: "VS Destruction", value: `${roundTo(vsDestruction * 100)}%`, source: "WEF MOP 8" });
  assumptions.push({ parameter: "Biogas Yield", value: `${gasYield} m³/kg VS destroyed`, source: "Engineering practice" });
  assumptions.push({ parameter: "Biogas CH₄", value: `${ch4Pct}%`, source: "Typical AD biogas" });
  assumptions.push({ parameter: "HRT", value: `${hrt} days`, source: "WEF MOP 8" });

  if (avgCN < 15) {
    warnings.push({ field: "C:N Ratio", message: `Blended C:N ratio of ${roundTo(avgCN)} is low (< 15). Consider adding carbon-rich co-substrates to avoid ammonia inhibition.`, severity: "warning" });
  } else if (avgCN > 35) {
    warnings.push({ field: "C:N Ratio", message: `Blended C:N ratio of ${roundTo(avgCN)} is high (> 35). Consider adding nitrogen-rich co-substrates for optimal digestion.`, severity: "warning" });
  }

  const digesterStage: ADProcessStage = {
    name: "Anaerobic Digestion",
    type: "digester",
    inputStream: {
      feedRate: { value: roundTo(totalFeedTpd), unit: "tons/day" },
      vsLoad: { value: roundTo(totalVSLoadKgPerDay), unit: "kg VS/day" },
      totalSolids: { value: roundTo(avgTS), unit: "%" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(biogasM3PerDay), unit: "m³/day" },
      biogasFlowSCFM: { value: roundTo(biogasScfm), unit: "scfm" },
      ch4Content: { value: ch4Pct, unit: "%" },
      co2Content: { value: co2Pct, unit: "%" },
      h2sContent: { value: h2sPpmv, unit: "ppmv" },
      vsDestroyed: { value: roundTo(vsDestroyedKgPerDay), unit: "kg/day" },
      digestateFlow: { value: roundTo(totalFeedTpd * (1 - vsDestruction * (avgTS / 100) * (avgVS / 100))), unit: "tons/day" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.digester,
    notes: [
      `${numDigesters} digester(s) at ${roundTo(perDigesterVol).toLocaleString()} m³ each`,
      `OLR: ${roundTo(totalVSLoadKgPerDay / digesterVolM3, 2)} kg VS/m³·d`,
      `HRT: ${roundTo(digesterVolM3 / (totalFeedTpd * 1000 / (avgTS > 10 ? 1.05 : 1.0)))} days`,
    ],
  };
  adStages.push(digesterStage);

  equipment.push({
    id: makeId(),
    process: "Anaerobic Digestion",
    equipmentType: "CSTR Digester",
    description: "Continuously stirred tank reactor, mesophilic operation",
    quantity: numDigesters,
    specs: {
      volume: { value: String(roundTo(perDigesterVol)), unit: "m³" },
      totalVolume: { value: String(roundTo(digesterVolM3)), unit: "m³" },
      hrt: { value: String(hrt), unit: "days" },
      olr: { value: String(roundTo(totalVSLoadKgPerDay / digesterVolM3, 2)), unit: "kg VS/m³·d" },
      temperature: { value: "38", unit: "°C" },
    },
    designBasis: `${hrt}-day HRT, OLR ≤ ${olr} kg VS/m³·d`,
    notes: "Includes gas collection dome, mixers, and heating system",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId(),
    process: "Anaerobic Digestion",
    equipmentType: "Digester Mixer",
    description: "Mechanical mixing system for digester contents",
    quantity: numDigesters,
    specs: {
      power: { value: String(roundTo(AD_DESIGN_DEFAULTS.digester.mixingPower.value * perDigesterVol / 1000, 1)), unit: "kW" },
      specificPower: { value: "5", unit: "W/m³" },
    },
    designBasis: "5 W/m³ mixing intensity",
    notes: "Draft tube or top-entry mechanical mixer",
    isOverridden: false,
    isLocked: false,
  });

  const h2sRemovalEff = AD_DESIGN_DEFAULTS.gasConditioning.h2sRemovalEff.value / 100;
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
      ch4Content: { value: ch4Pct, unit: "%" },
      h2sContent: { value: roundTo(outH2sPpmv, 1), unit: "ppmv" },
      moisture: { value: 0, unit: "saturated → dry" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.gasConditioning,
    notes: ["H₂S removal via iron sponge or biological scrubber", "Moisture removal via chiller and desiccant dryer", "Siloxane removal via activated carbon (if applicable)"],
  };
  adStages.push(conditioningStage);

  equipment.push({
    id: makeId(),
    process: "Gas Conditioning",
    equipmentType: "H₂S Removal System",
    description: "Iron sponge or biological scrubber for hydrogen sulfide removal",
    quantity: 1,
    specs: {
      inletH2S: { value: String(h2sPpmv), unit: "ppmv" },
      outletH2S: { value: String(roundTo(outH2sPpmv, 1)), unit: "ppmv" },
      removalEff: { value: "99.5", unit: "%" },
      gasFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
    },
    designBasis: "99.5% H₂S removal to < 10 ppmv",
    notes: "Includes media replacement schedule and monitoring",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId(),
    process: "Gas Conditioning",
    equipmentType: "Gas Chiller/Dryer",
    description: "Refrigerated chiller and desiccant dryer for moisture removal",
    quantity: 1,
    specs: {
      gasFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
      outletDewpoint: { value: "-40", unit: "°F" },
    },
    designBasis: "Reduce moisture to pipeline specifications",
    notes: "Condensate drainage to plant drain",
    isOverridden: false,
    isLocked: false,
  });

  const methaneRecovery = AD_DESIGN_DEFAULTS.gasUpgrading.methaneRecovery.value / 100;
  const productCH4 = AD_DESIGN_DEFAULTS.gasUpgrading.productCH4.value;
  const rngCH4M3PerDay = ch4M3PerDay * methaneRecovery;
  const rngM3PerDay = rngCH4M3PerDay / (productCH4 / 100);
  const rngScfPerDay = rngM3PerDay * 35.3147;
  const rngScfm = rngScfPerDay / 1440;
  const rngMMBtuPerDay = rngScfPerDay * 1012 / 1_000_000;
  const rngGJPerDay = rngMMBtuPerDay * 1.055;
  const tailgasM3PerDay = conditionedBiogasM3PerDay - rngM3PerDay;
  const electricalDemandKW = biogasM3PerDay * AD_DESIGN_DEFAULTS.gasUpgrading.electricalDemand.value / 24;

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
      methaneRecovery: { value: roundTo(methaneRecovery * 100), unit: "%" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.gasUpgrading,
    notes: [
      "Membrane or PSA upgrading system",
      `Tail gas: ${roundTo(tailgasM3PerDay)} m³/day available for flare or thermal oxidizer`,
      `Electrical demand: ${roundTo(electricalDemandKW)} kW`,
    ],
  };
  adStages.push(upgradingStage);

  equipment.push({
    id: makeId(),
    process: "Gas Upgrading",
    equipmentType: "Membrane/PSA Upgrading System",
    description: "Multi-stage membrane or pressure swing adsorption system for CO₂ removal",
    quantity: 1,
    specs: {
      inletFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
      productFlow: { value: String(roundTo(rngScfm)), unit: "scfm" },
      productCH4: { value: String(productCH4), unit: "%" },
      methaneRecovery: { value: "97", unit: "%" },
      pressure: { value: "200", unit: "psig" },
    },
    designBasis: "97% methane recovery, pipeline quality RNG",
    notes: "Includes compression, monitoring, and control system",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId(),
    process: "Gas Upgrading",
    equipmentType: "RNG Compressor",
    description: "Multi-stage compressor for pipeline injection pressure",
    quantity: 1,
    specs: {
      flow: { value: String(roundTo(rngScfm)), unit: "scfm" },
      dischargePressure: { value: "200", unit: "psig" },
      power: { value: String(roundTo(electricalDemandKW * 0.6)), unit: "kW" },
    },
    designBasis: "Pipeline injection pressure with N+1 redundancy consideration",
    notes: "Includes aftercooler and moisture knockout",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId(),
    process: "Gas Management",
    equipmentType: "Enclosed Flare",
    description: "Enclosed ground flare for excess biogas and tail gas combustion",
    quantity: 1,
    specs: {
      capacity: { value: String(roundTo(biogasScfm * 1.1)), unit: "scfm" },
      destructionEff: { value: "99.5", unit: "%" },
    },
    designBasis: "110% of maximum biogas production",
    notes: "Required for startup, upset, and maintenance periods",
    isOverridden: false,
    isLocked: false,
  });

  const digestateTPD = totalFeedTpd * (1 - vsDestruction * (avgTS / 100) * (avgVS / 100));
  const separationEff = AD_DESIGN_DEFAULTS.digestateHandling.solidsSeparationEff.value / 100;
  const solidsTPD = digestateTPD * separationEff;
  const liquidTPD = digestateTPD - solidsTPD;

  const digestateStage: ADProcessStage = {
    name: "Digestate Handling",
    type: "digestateHandling",
    inputStream: {
      digestateFlow: { value: roundTo(digestateTPD), unit: "tons/day" },
    },
    outputStream: {
      solidDigestate: { value: roundTo(solidsTPD), unit: "tons/day" },
      liquidFiltrate: { value: roundTo(liquidTPD), unit: "tons/day" },
      cakeSolids: { value: AD_DESIGN_DEFAULTS.digestateHandling.cakeSolids.value, unit: "% TS" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.digestateHandling,
    notes: ["Screw press or belt filter press for solid/liquid separation"],
  };
  adStages.push(digestateStage);

  equipment.push({
    id: makeId(),
    process: "Digestate Handling",
    equipmentType: "Screw Press",
    description: "Dewatering press for digestate solid/liquid separation",
    quantity: 1,
    specs: {
      capacity: { value: String(roundTo(digestateTPD)), unit: "tons/day" },
      cakeSolids: { value: "25", unit: "% TS" },
      captureRate: { value: "25", unit: "%" },
    },
    designBasis: "25% solids capture, 25% cake solids",
    notes: "Polymer conditioning system included",
    isOverridden: false,
    isLocked: false,
  });

  const summary: Record<string, { value: string; unit: string }> = {
    totalFeedRate: { value: roundTo(totalFeedTpd).toLocaleString(), unit: "tons/day" },
    totalVSLoad: { value: roundTo(totalVSLoadKgPerDay).toLocaleString(), unit: "kg VS/day" },
    biogasProduction: { value: roundTo(biogasM3PerDay).toLocaleString(), unit: "m³/day" },
    biogasFlowSCFM: { value: roundTo(biogasScfm).toLocaleString(), unit: "scfm" },
    rngProduction: { value: roundTo(rngM3PerDay).toLocaleString(), unit: "m³/day" },
    rngFlowSCFM: { value: roundTo(rngScfm).toLocaleString(), unit: "scfm" },
    rngEnergy: { value: roundTo(rngMMBtuPerDay, 1).toLocaleString(), unit: "MMBtu/day" },
    rngEnergyGJ: { value: roundTo(rngGJPerDay, 1).toLocaleString(), unit: "GJ/day" },
    digesterVolume: { value: roundTo(digesterVolM3).toLocaleString(), unit: "m³" },
    electricalDemand: { value: roundTo(electricalDemandKW).toLocaleString(), unit: "kW" },
    solidDigestate: { value: roundTo(solidsTPD).toLocaleString(), unit: "tons/day" },
    liquidFiltrate: { value: roundTo(liquidTPD).toLocaleString(), unit: "tons/day" },
  };

  return {
    projectType: "B",
    stages: [],
    adStages,
    recycleStreams: [],
    equipment,
    convergenceIterations: 1,
    convergenceAchieved: true,
    assumptions,
    warnings,
    summary,
  };
}
