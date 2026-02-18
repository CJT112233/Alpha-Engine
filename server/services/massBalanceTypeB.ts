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
  },
  maceration: {
    targetParticleSize: { value: 15, unit: "mm", source: "Engineering practice" },
    depackagingRejectRate: { value: 18, unit: "%", source: "Engineering practice" },
    contaminantRemoval: { value: 95, unit: "%", source: "Engineering practice" },
  },
  equalization: {
    retentionTime: { value: 1.5, unit: "days", source: "Engineering practice" },
    preheatTemp: { value: 35, unit: "°C", source: "Mesophilic AD standard" },
    targetTS: { value: 10, unit: "%", source: "Engineering practice — pumpable slurry" },
  },
  digester: {
    hrt: { value: 25, unit: "days", source: "WEF MOP 8" },
    organicLoadingRate: { value: 3.0, unit: "kg VS/m³·d", source: "WEF MOP 8" },
    vsDestruction: { value: 65, unit: "%", source: "WEF MOP 8" },
    temperature: { value: 37, unit: "°C", source: "Mesophilic standard" },
    mixingPower: { value: 6, unit: "W/m³", source: "WEF MOP 8" },
    gasYield: { value: 0.8, unit: "scf/lb VS destroyed", source: "Engineering practice" },
    ch4Content: { value: 60, unit: "%", source: "Typical AD biogas" },
    co2Content: { value: 38, unit: "%", source: "Typical AD biogas" },
    h2sContent: { value: 1500, unit: "ppmv", source: "Typical AD biogas" },
    headspacePct: { value: 12, unit: "%", source: "Engineering practice" },
  },
  centrifuge: {
    solidsCaptureEff: { value: 92, unit: "%", source: "Decanter centrifuge typical" },
    cakeSolids: { value: 28, unit: "% TS", source: "Decanter centrifuge typical" },
    polymerDose: { value: 10, unit: "kg/ton dry solids", source: "Engineering practice" },
  },
  daf: {
    tssRemoval: { value: 90, unit: "%", source: "Engineering practice" },
    fogRemoval: { value: 95, unit: "%", source: "Engineering practice" },
    hydraulicLoading: { value: 3, unit: "gpm/ft²", source: "Engineering practice" },
    floatRecycleToDigester: { value: 100, unit: "%", source: "Engineering practice" },
  },
  gasConditioning: {
    h2sRemovalEff: { value: 99.5, unit: "%", source: "Iron sponge/bioscrubber" },
    moistureRemoval: { value: 99, unit: "%", source: "Chiller/desiccant" },
    siloxaneRemoval: { value: 95, unit: "%", source: "Activated carbon" },
    volumeLoss: { value: 1, unit: "%", source: "Engineering practice" },
  },
  gasUpgrading: {
    methaneRecovery: { value: 97, unit: "%", source: "Membrane/PSA typical" },
    productCH4: { value: 97, unit: "%", source: "Pipeline quality RNG" },
    electricalDemand: { value: 0.25, unit: "kWh/Nm³ raw biogas", source: "Engineering practice" },
    pressureOut: { value: 200, unit: "psig", source: "Pipeline injection" },
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

function m3ToGal(m3: number): number { return m3 * 264.172; }
function m3ToScf(m3: number): number { return m3 * 35.3147; }
function m3PerMinToGpm(m3min: number): number { return m3min * 264.172; }

function hasPackagedWaste(feedstocks: FeedstockEntry[]): boolean {
  const keywords = ["packaged", "package", "depackag", "wrapped", "containerized", "bagged"];
  return feedstocks.some(fs => {
    const text = ((fs.feedstockType || "") + " " + JSON.stringify(fs.feedstockSpecs || {})).toLowerCase();
    return keywords.some(kw => text.includes(kw));
  });
}

export function calculateMassBalanceTypeB(upif: UpifRecord): MassBalanceResults {
  const warnings: MassBalanceResults["warnings"] = [];
  const assumptions: MassBalanceResults["assumptions"] = [];
  const adStages: ADProcessStage[] = [];
  const equipment: EquipmentItem[] = [];
  let eqId = 1;
  const makeId = (prefix: string) => `${prefix}-${eqId++}`;

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
  const isPackaged = hasPackagedWaste(feedstocks);

  assumptions.push({ parameter: "Blended TS", value: `${roundTo(avgTS)}%`, source: "Weighted average" });
  assumptions.push({ parameter: "Blended VS/TS", value: `${roundTo(avgVS)}%`, source: "Weighted average" });
  assumptions.push({ parameter: "Blended BMP", value: `${roundTo(avgBMP * 35.3147 / 2.2046, 3)} scf CH₄/lb VS`, source: "Weighted average" });

  // ══════════════════════════════════════════════════════════
  // STAGE 1: FEEDSTOCK RECEIVING & STORAGE
  // ══════════════════════════════════════════════════════════
  const receivingStage: ADProcessStage = {
    name: "Feedstock Receiving & Storage",
    type: "receiving",
    inputStream: {
      feedRate: { value: roundTo(totalFeedTpd), unit: "tons/day" },
      totalSolids: { value: roundTo(avgTS), unit: "%" },
      numFeedstocks: { value: feedstocks.length, unit: "streams" },
    },
    outputStream: {
      feedRate: { value: roundTo(totalFeedTpd), unit: "tons/day" },
      totalSolids: { value: roundTo(avgTS), unit: "%" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.receiving,
    notes: [`Receiving ${feedstocks.length} feedstock stream(s), total ${roundTo(totalFeedTpd).toLocaleString()} tons/day`],
  };
  adStages.push(receivingStage);

  const storageVolM3 = (totalFeedTpd * 1000 / 1.05) * AD_DESIGN_DEFAULTS.receiving.storageTime.value;
  equipment.push({
    id: makeId("receiving-hopper"),
    process: "Feedstock Receiving",
    equipmentType: "Receiving Hopper / Tipping Floor",
    description: "Covered receiving area with truck tipping floor and hopper for feedstock unloading",
    quantity: feedstocks.length > 2 ? 2 : 1,
    specs: {
      volume: { value: String(roundTo(m3ToGal(storageVolM3))), unit: "gallons" },
      storageTime: { value: "3", unit: "days" },
      capacity: { value: String(roundTo(totalFeedTpd * 1.5)), unit: "tons/day" },
    },
    designBasis: "1.5x design throughput with 3-day storage",
    notes: "Includes weigh scale, odor control, and leak detection",
    isOverridden: false,
    isLocked: false,
  });

  // ══════════════════════════════════════════════════════════
  // STAGE 2: FEEDSTOCK PREPARATION (MACERATION & SIZE REDUCTION)
  // ══════════════════════════════════════════════════════════
  const rejectRate = isPackaged ? AD_DESIGN_DEFAULTS.maceration.depackagingRejectRate.value / 100 : 0;
  const postMacerationTpd = totalFeedTpd * (1 - rejectRate);

  const macerationStage: ADProcessStage = {
    name: "Feedstock Preparation (Maceration & Size Reduction)",
    type: "maceration",
    inputStream: {
      feedRate: { value: roundTo(totalFeedTpd), unit: "tons/day" },
      totalSolids: { value: roundTo(avgTS), unit: "%" },
    },
    outputStream: {
      feedRate: { value: roundTo(postMacerationTpd), unit: "tons/day" },
      totalSolids: { value: roundTo(avgTS), unit: "%" },
      particleSize: { value: AD_DESIGN_DEFAULTS.maceration.targetParticleSize.value, unit: "mm" },
      rejects: { value: roundTo(totalFeedTpd * rejectRate), unit: "tons/day" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.maceration,
    notes: [
      `Particle size reduction to < ${AD_DESIGN_DEFAULTS.maceration.targetParticleSize.value} mm for optimal digestion`,
      ...(isPackaged ? [`Depackaging included — ${roundTo(rejectRate * 100)}% reject rate for packaging/contaminants`] : ["No depackaging required for this feedstock mix"]),
      "Magnetic separation for ferrous metal removal",
    ],
  };
  adStages.push(macerationStage);

  equipment.push({
    id: makeId("macerator"),
    process: "Feedstock Preparation",
    equipmentType: "Macerator / Grinder",
    description: "Industrial grinder for particle size reduction to < 15 mm",
    quantity: 1,
    specs: {
      capacity: { value: String(roundTo(totalFeedTpd * 1.25)), unit: "tons/day" },
      targetSize: { value: "15", unit: "mm" },
      power: { value: String(roundTo(totalFeedTpd * 3, 0)), unit: "kW" },
    },
    designBasis: "1.25x design feed rate, < 15 mm particle output",
    notes: "Includes magnetic separator for ferrous metal removal",
    isOverridden: false,
    isLocked: false,
  });

  if (isPackaged) {
    equipment.push({
      id: makeId("depackager"),
      process: "Feedstock Preparation",
      equipmentType: "Depackaging Unit",
      description: "Separates organic content from packaging material (plastics, cartons, containers)",
      quantity: 1,
      specs: {
        capacity: { value: String(roundTo(totalFeedTpd * 1.25)), unit: "tons/day" },
        rejectRate: { value: "18", unit: "%" },
        organicRecovery: { value: "82", unit: "%" },
      },
      designBasis: "1.25x design feed rate, 15-20% packaging reject",
      notes: "Rejects conveyed to waste bin for disposal",
      isOverridden: false,
      isLocked: false,
    });
  }

  // ══════════════════════════════════════════════════════════
  // STAGE 3: EQUALIZATION (EQ) TANK
  // ══════════════════════════════════════════════════════════
  const eqRetentionDays = AD_DESIGN_DEFAULTS.equalization.retentionTime.value;
  const targetEqTS = AD_DESIGN_DEFAULTS.equalization.targetTS.value;
  const needsDilution = avgTS > targetEqTS;
  const dilutionWaterTpd = needsDilution ? postMacerationTpd * ((avgTS / targetEqTS) - 1) : 0;
  const eqOutputTpd = postMacerationTpd + dilutionWaterTpd;
  const eqOutputTS = needsDilution ? targetEqTS : avgTS;
  const eqVolumeM3 = (eqOutputTpd * 1000 / 1.02) * eqRetentionDays;
  const eqVSLoadKgPerDay = totalVSLoadKgPerDay * (1 - rejectRate);

  if (needsDilution) {
    assumptions.push({ parameter: "Dilution Water", value: `${roundTo(dilutionWaterTpd)} tons/day added to achieve ${targetEqTS}% TS`, source: "Engineering practice" });
  }

  const eqStage: ADProcessStage = {
    name: "Equalization (EQ) Tank",
    type: "equalization",
    inputStream: {
      feedRate: { value: roundTo(postMacerationTpd), unit: "tons/day" },
      totalSolids: { value: roundTo(avgTS), unit: "%" },
      dilutionWater: { value: roundTo(dilutionWaterTpd), unit: "tons/day" },
    },
    outputStream: {
      feedRate: { value: roundTo(eqOutputTpd), unit: "tons/day" },
      totalSolids: { value: roundTo(eqOutputTS), unit: "%" },
      temperature: { value: AD_DESIGN_DEFAULTS.equalization.preheatTemp.value, unit: "°C" },
      vsLoad: { value: roundTo(eqVSLoadKgPerDay), unit: "kg VS/day" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.equalization,
    notes: [
      `EQ tank volume: ${roundTo(m3ToGal(eqVolumeM3)).toLocaleString()} gallons (${roundTo(eqRetentionDays, 1)}-day retention)`,
      "Continuous mixing for homogenization and stratification prevention",
      `Pre-heated to ${AD_DESIGN_DEFAULTS.equalization.preheatTemp.value}°C via heat exchanger`,
      ...(needsDilution ? [`Dilution water: ${roundTo(dilutionWaterTpd)} tons/day to reduce TS from ${roundTo(avgTS)}% to ${targetEqTS}%`] : []),
    ],
  };
  adStages.push(eqStage);

  const heatDutyKW = roundTo(eqOutputTpd * 1000 * 4.18 * (AD_DESIGN_DEFAULTS.equalization.preheatTemp.value - 15) / 3600, 0);

  equipment.push({
    id: makeId("eq-tank"),
    process: "Equalization",
    equipmentType: "Equalization Tank",
    description: "Insulated blending and homogenization tank with continuous mixing",
    quantity: 1,
    specs: {
      volume: { value: String(roundTo(m3ToGal(eqVolumeM3))), unit: "gallons" },
      retentionTime: { value: String(eqRetentionDays), unit: "days" },
      throughput: { value: String(roundTo(eqOutputTpd)), unit: "tons/day" },
    },
    designBasis: `${eqRetentionDays}-day retention time for consistent digester feed`,
    notes: "Insulated concrete or steel tank with top-entry mixer",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("eq-mixer"),
    process: "Equalization",
    equipmentType: "EQ Tank Mixer",
    description: "Top-entry mechanical mixer for slurry homogenization",
    quantity: 1,
    specs: {
      power: { value: String(roundTo(eqVolumeM3 * 3 / 1000, 1)), unit: "kW" },
      specificPower: { value: "3", unit: "W/m³" },
    },
    designBasis: "3 W/m³ mixing intensity for slurry homogenization",
    notes: "Prevents settling and ensures consistent feed composition",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("feed-heater"),
    process: "Equalization",
    equipmentType: "Feed Heat Exchanger",
    description: "Shell-and-tube or spiral heat exchanger to pre-heat feed to mesophilic temperature",
    quantity: 1,
    specs: {
      heatDuty: { value: String(heatDutyKW), unit: "kW" },
      targetTemp: { value: String(AD_DESIGN_DEFAULTS.equalization.preheatTemp.value), unit: "°C" },
      inletTemp: { value: "15", unit: "°C" },
    },
    designBasis: `Heating from 15°C ambient to ${AD_DESIGN_DEFAULTS.equalization.preheatTemp.value}°C mesophilic`,
    notes: "Waste heat recovery from biogas utilization where available",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("feed-pump"),
    process: "Equalization",
    equipmentType: "Digester Feed Pump",
    description: "Progressive cavity pump for feeding slurry from EQ tank to digester",
    quantity: 2,
    specs: {
      capacity: { value: String(roundTo(m3PerMinToGpm(eqOutputTpd * 1000 / 24 / 60), 1)), unit: "gpm" },
      headPressure: { value: "3", unit: "bar" },
    },
    designBasis: "Duty + standby (N+1 redundancy)",
    notes: "Progressive cavity type suitable for high-solids slurry",
    isOverridden: false,
    isLocked: false,
  });

  // ══════════════════════════════════════════════════════════
  // STAGE 4: ANAEROBIC DIGESTION (CSTR)
  // ══════════════════════════════════════════════════════════
  const vsDestruction = AD_DESIGN_DEFAULTS.digester.vsDestruction.value / 100;
  const hrt = AD_DESIGN_DEFAULTS.digester.hrt.value;
  const olr = AD_DESIGN_DEFAULTS.digester.organicLoadingRate.value;
  const gasYield = AD_DESIGN_DEFAULTS.digester.gasYield.value;
  const ch4Pct = AD_DESIGN_DEFAULTS.digester.ch4Content.value;
  const co2Pct = AD_DESIGN_DEFAULTS.digester.co2Content.value;
  const h2sPpmv = AD_DESIGN_DEFAULTS.digester.h2sContent.value;
  const headspacePct = AD_DESIGN_DEFAULTS.digester.headspacePct.value / 100;

  const vsDestroyedKgPerDay = eqVSLoadKgPerDay * vsDestruction;
  const biogasM3PerDay = vsDestroyedKgPerDay * gasYield;
  const biogasScfPerDay = biogasM3PerDay * 35.3147;
  const biogasScfm = biogasScfPerDay / 1440;
  const ch4M3PerDay = biogasM3PerDay * (ch4Pct / 100);

  const dailyFeedVolM3 = eqOutputTpd * 1000 / 1.02;
  const digesterVolumeByHRT = dailyFeedVolM3 * hrt;
  const digesterVolumeByOLR = eqVSLoadKgPerDay / olr;
  const activeDigesterVolM3 = Math.max(digesterVolumeByHRT, digesterVolumeByOLR);
  const totalDigesterVolM3 = activeDigesterVolM3 * (1 + headspacePct);
  const numDigesters = totalDigesterVolM3 > 5000 ? 2 : 1;
  const perDigesterVol = totalDigesterVolM3 / numDigesters;
  const actualHRT = roundTo(activeDigesterVolM3 / dailyFeedVolM3);
  const actualOLR = roundTo(eqVSLoadKgPerDay / activeDigesterVolM3, 2);

  assumptions.push({ parameter: "VS Destruction", value: `${roundTo(vsDestruction * 100)}%`, source: "WEF MOP 8" });
  assumptions.push({ parameter: "Biogas Yield", value: `${roundTo(gasYield * 35.3147 / 2.2046, 2)} scf/lb VS destroyed`, source: "Engineering practice" });
  assumptions.push({ parameter: "Biogas CH₄", value: `${ch4Pct}%`, source: "Typical AD biogas" });
  assumptions.push({ parameter: "HRT", value: `${hrt} days`, source: "WEF MOP 8" });

  if (avgCN < 15) {
    warnings.push({ field: "C:N Ratio", message: `Blended C:N ratio of ${roundTo(avgCN)} is low (< 15). Consider adding carbon-rich co-substrates to avoid ammonia inhibition.`, severity: "warning" });
  } else if (avgCN > 35) {
    warnings.push({ field: "C:N Ratio", message: `Blended C:N ratio of ${roundTo(avgCN)} is high (> 35). Consider adding nitrogen-rich co-substrates for optimal digestion.`, severity: "warning" });
  }

  const digestateTPD = eqOutputTpd * (1 - vsDestruction * (eqOutputTS / 100) * (avgVS / 100));

  const digesterStage: ADProcessStage = {
    name: "Anaerobic Digestion (CSTR)",
    type: "digester",
    inputStream: {
      feedRate: { value: roundTo(eqOutputTpd), unit: "tons/day" },
      vsLoad: { value: roundTo(eqVSLoadKgPerDay), unit: "kg VS/day" },
      totalSolids: { value: roundTo(eqOutputTS), unit: "%" },
      temperature: { value: AD_DESIGN_DEFAULTS.equalization.preheatTemp.value, unit: "°C" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(biogasScfPerDay), unit: "scfd" },
      biogasFlowSCFM: { value: roundTo(biogasScfm), unit: "scfm" },
      ch4Content: { value: ch4Pct, unit: "%" },
      co2Content: { value: co2Pct, unit: "%" },
      h2sContent: { value: h2sPpmv, unit: "ppmv" },
      vsDestroyed: { value: roundTo(vsDestroyedKgPerDay), unit: "kg/day" },
      digestateFlow: { value: roundTo(digestateTPD), unit: "tons/day" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.digester,
    notes: [
      `${numDigesters} CSTR digester(s) at ${roundTo(m3ToGal(perDigesterVol)).toLocaleString()} gallons each (including ${roundTo(headspacePct * 100)}% headspace)`,
      `Active volume: ${roundTo(m3ToGal(activeDigesterVolM3)).toLocaleString()} gallons`,
      `Actual OLR: ${actualOLR} kg VS/m³·d`,
      `Actual HRT: ${actualHRT} days`,
    ],
  };
  adStages.push(digesterStage);

  equipment.push({
    id: makeId("cstr-digester"),
    process: "Anaerobic Digestion",
    equipmentType: "CSTR Digester",
    description: "Continuously Stirred Tank Reactor, mesophilic operation with gas collection dome",
    quantity: numDigesters,
    specs: {
      volume: { value: String(roundTo(m3ToGal(perDigesterVol))), unit: "gallons" },
      activeVolume: { value: String(roundTo(m3ToGal(activeDigesterVolM3 / numDigesters))), unit: "gallons" },
      totalVolume: { value: String(roundTo(m3ToGal(totalDigesterVolM3))), unit: "gallons" },
      hrt: { value: String(actualHRT), unit: "days" },
      olr: { value: String(actualOLR), unit: "kg VS/m³·d" },
      temperature: { value: "37", unit: "°C" },
    },
    designBasis: `${hrt}-day HRT, OLR ≤ ${olr} kg VS/m³·d, ${roundTo(headspacePct * 100)}% headspace`,
    notes: "Includes gas collection dome, internal heating coils, and insulation",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("digester-mixer"),
    process: "Anaerobic Digestion",
    equipmentType: "Digester Mixer",
    description: "Mechanical mixing system for digester contents",
    quantity: numDigesters,
    specs: {
      power: { value: String(roundTo(AD_DESIGN_DEFAULTS.digester.mixingPower.value * (activeDigesterVolM3 / numDigesters) / 1000, 1)), unit: "kW" },
      specificPower: { value: String(AD_DESIGN_DEFAULTS.digester.mixingPower.value), unit: "W/m³" },
    },
    designBasis: `${AD_DESIGN_DEFAULTS.digester.mixingPower.value} W/m³ mixing intensity`,
    notes: "Draft tube or top-entry mechanical mixer",
    isOverridden: false,
    isLocked: false,
  });

  // ══════════════════════════════════════════════════════════
  // STAGE 5: SOLIDS-LIQUID SEPARATION (CENTRIFUGE)
  // ══════════════════════════════════════════════════════════
  const centSolidsCaptureEff = AD_DESIGN_DEFAULTS.centrifuge.solidsCaptureEff.value / 100;
  const centCakeSolidsPct = AD_DESIGN_DEFAULTS.centrifuge.cakeSolids.value;
  const digestateTS = eqOutputTS * (1 - vsDestruction * (avgVS / 100));
  const digestateTSKgPerDay = digestateTPD * 1000 * (digestateTS / 100);
  const cakeSolidsKgPerDay = digestateTSKgPerDay * centSolidsCaptureEff;
  const cakeTPD = cakeSolidsKgPerDay / (centCakeSolidsPct / 100) / 1000;
  const centrateTPD = digestateTPD - cakeTPD;
  const centrateTSSMgL = digestateTSKgPerDay * (1 - centSolidsCaptureEff) / (centrateTPD * 1000) * 1_000_000;

  assumptions.push({ parameter: "Centrifuge Solids Capture", value: `${roundTo(centSolidsCaptureEff * 100)}%`, source: "Decanter centrifuge typical" });
  assumptions.push({ parameter: "Cake Solids", value: `${centCakeSolidsPct}% TS`, source: "Decanter centrifuge typical" });

  const centrifugeStage: ADProcessStage = {
    name: "Solids-Liquid Separation (Centrifuge)",
    type: "solidsSeparation",
    inputStream: {
      digestateFlow: { value: roundTo(digestateTPD), unit: "tons/day" },
      digestateTS: { value: roundTo(digestateTS), unit: "% TS" },
    },
    outputStream: {
      cakeFlow: { value: roundTo(cakeTPD), unit: "tons/day" },
      cakeSolids: { value: centCakeSolidsPct, unit: "% TS" },
      centrateFlow: { value: roundTo(centrateTPD), unit: "tons/day" },
      centrateTSS: { value: roundTo(centrateTSSMgL, 0), unit: "mg/L" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.centrifuge,
    notes: [
      "Decanter centrifuge for digestate dewatering",
      `Cake: ${roundTo(cakeTPD)} tons/day at ${centCakeSolidsPct}% TS — conveyed to storage/hauling`,
      `Centrate: ${roundTo(centrateTPD)} tons/day — sent to DAF for liquid cleanup`,
      `Polymer conditioning: ${AD_DESIGN_DEFAULTS.centrifuge.polymerDose.value} kg/ton dry solids`,
    ],
  };
  adStages.push(centrifugeStage);

  equipment.push({
    id: makeId("decanter-centrifuge"),
    process: "Solids-Liquid Separation",
    equipmentType: "Decanter Centrifuge",
    description: "High-speed decanter centrifuge for digestate dewatering",
    quantity: 1,
    specs: {
      capacity: { value: String(roundTo(digestateTPD)), unit: "tons/day" },
      solidsCaptureEff: { value: String(roundTo(centSolidsCaptureEff * 100)), unit: "%" },
      cakeSolids: { value: String(centCakeSolidsPct), unit: "% TS" },
      polymerDose: { value: String(AD_DESIGN_DEFAULTS.centrifuge.polymerDose.value), unit: "kg/ton DS" },
    },
    designBasis: `${roundTo(centSolidsCaptureEff * 100)}% solids capture, ${centCakeSolidsPct}% cake solids`,
    notes: "Includes polymer make-down and dosing system",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("cake-conveyor"),
    process: "Solids-Liquid Separation",
    equipmentType: "Cake Conveyor & Storage",
    description: "Screw conveyor from centrifuge to cake storage bin for truck loadout",
    quantity: 1,
    specs: {
      capacity: { value: String(roundTo(cakeTPD)), unit: "tons/day" },
      storageVolume: { value: String(roundTo(m3ToGal(cakeTPD * 3 / 1.1))), unit: "gallons" },
    },
    designBasis: "3-day cake storage capacity",
    notes: "Covered storage with truck loadout capability",
    isOverridden: false,
    isLocked: false,
  });

  // ══════════════════════════════════════════════════════════
  // STAGE 6: LIQUID CLEANUP — DISSOLVED AIR FLOTATION (DAF)
  // ══════════════════════════════════════════════════════════
  const dafTSSRemoval = AD_DESIGN_DEFAULTS.daf.tssRemoval.value / 100;
  const dafFOGRemoval = AD_DESIGN_DEFAULTS.daf.fogRemoval.value / 100;
  const centrateFlowGPD = centrateTPD * 1000 / 3.785;
  const centrateFlowGPM = centrateFlowGPD / 1440;
  const dafSurfaceAreaFt2 = centrateFlowGPM / AD_DESIGN_DEFAULTS.daf.hydraulicLoading.value;
  const dafEffluentTSSMgL = centrateTSSMgL * (1 - dafTSSRemoval);
  const dafFloatTPD = centrateTPD * 0.03;
  const dafEffluentTPD = centrateTPD - dafFloatTPD;
  const dafEffluentGPD = roundTo(dafEffluentTPD * 1000 / 3.785, 0);

  const dafStage: ADProcessStage = {
    name: "Liquid Cleanup — Dissolved Air Flotation (DAF)",
    type: "daf",
    inputStream: {
      centrateFlow: { value: roundTo(centrateTPD), unit: "tons/day" },
      centrateFlowGPD: { value: roundTo(centrateFlowGPD, 0), unit: "GPD" },
      centrateTSS: { value: roundTo(centrateTSSMgL, 0), unit: "mg/L" },
    },
    outputStream: {
      effluentFlow: { value: roundTo(dafEffluentTPD), unit: "tons/day" },
      effluentFlowGPD: { value: dafEffluentGPD, unit: "GPD" },
      effluentTSS: { value: roundTo(dafEffluentTSSMgL, 0), unit: "mg/L" },
      floatSludge: { value: roundTo(dafFloatTPD), unit: "tons/day" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.daf,
    notes: [
      `TSS removal: ${roundTo(dafTSSRemoval * 100)}% (${roundTo(centrateTSSMgL, 0)} → ${roundTo(dafEffluentTSSMgL, 0)} mg/L)`,
      `FOG removal: ${roundTo(dafFOGRemoval * 100)}%`,
      "Chemical conditioning: coagulant (FeCl₃ or alum) + polymer",
      `Float sludge (${roundTo(dafFloatTPD)} tons/day) recycled to digester`,
      `DAF effluent suitable for sewer discharge or irrigation`,
    ],
  };
  adStages.push(dafStage);

  equipment.push({
    id: makeId("daf-unit"),
    process: "Liquid Cleanup",
    equipmentType: "Dissolved Air Flotation (DAF) Unit",
    description: "DAF system for centrate polishing — removes residual TSS, FOG, and colloidal organics",
    quantity: 1,
    specs: {
      surfaceArea: { value: String(roundTo(dafSurfaceAreaFt2)), unit: "ft²" },
      hydraulicLoading: { value: String(AD_DESIGN_DEFAULTS.daf.hydraulicLoading.value), unit: "gpm/ft²" },
      designFlow: { value: String(roundTo(centrateFlowGPM, 1)), unit: "gpm" },
      tssRemoval: { value: String(roundTo(dafTSSRemoval * 100)), unit: "%" },
      fogRemoval: { value: String(roundTo(dafFOGRemoval * 100)), unit: "%" },
    },
    designBasis: `${AD_DESIGN_DEFAULTS.daf.hydraulicLoading.value} gpm/ft² hydraulic loading rate`,
    notes: "Includes recycle pump, saturator, chemical feed system (coagulant + polymer)",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("centrate-tank"),
    process: "Liquid Cleanup",
    equipmentType: "Centrate Collection Tank",
    description: "Holding tank for centrate equalization before DAF treatment",
    quantity: 1,
    specs: {
      volume: { value: String(roundTo(centrateTPD * 1000 / 1.0 * 0.5 * 0.264172)), unit: "gallons" },
      retentionTime: { value: "0.5", unit: "days" },
    },
    designBasis: "0.5-day equalization for consistent DAF feed",
    notes: "Level-controlled pump to DAF unit",
    isOverridden: false,
    isLocked: false,
  });

  // ══════════════════════════════════════════════════════════
  // STAGE 7: BIOGAS CONDITIONING
  // ══════════════════════════════════════════════════════════
  const h2sRemovalEff = AD_DESIGN_DEFAULTS.gasConditioning.h2sRemovalEff.value / 100;
  const outH2sPpmv = h2sPpmv * (1 - h2sRemovalEff);
  const volumeLossPct = AD_DESIGN_DEFAULTS.gasConditioning.volumeLoss.value / 100;
  const conditionedBiogasM3PerDay = biogasM3PerDay * (1 - volumeLossPct);

  const conditioningStage: ADProcessStage = {
    name: "Biogas Conditioning",
    type: "gasConditioning",
    inputStream: {
      biogasFlow: { value: roundTo(biogasScfPerDay), unit: "scfd" },
      biogasFlowSCFM: { value: roundTo(biogasScfm), unit: "scfm" },
      ch4Content: { value: ch4Pct, unit: "%" },
      h2sContent: { value: h2sPpmv, unit: "ppmv" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(m3ToScf(conditionedBiogasM3PerDay)), unit: "scfd" },
      ch4Content: { value: ch4Pct, unit: "%" },
      h2sContent: { value: roundTo(outH2sPpmv, 1), unit: "ppmv" },
      moisture: { value: 0, unit: "saturated → dry" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.gasConditioning,
    notes: [
      `H₂S removal: ${h2sPpmv} → ${roundTo(outH2sPpmv, 1)} ppmv (${roundTo(h2sRemovalEff * 100)}% removal)`,
      "Moisture removal via chiller and desiccant dryer to -40°F dewpoint",
      "Siloxane removal via activated carbon (if applicable)",
    ],
  };
  adStages.push(conditioningStage);

  equipment.push({
    id: makeId("h2s-scrubber"),
    process: "Biogas Conditioning",
    equipmentType: "H₂S Removal System",
    description: h2sPpmv > 5000 ? "Chemical scrubber for high-H₂S biogas" :
                 h2sPpmv > 500 ? "Biological scrubber for hydrogen sulfide removal" :
                 "Iron sponge for hydrogen sulfide removal",
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
    id: makeId("biogas-blower"),
    process: "Biogas Conditioning",
    equipmentType: "Biogas Blower",
    description: "Positive displacement blower for biogas transport through conditioning train",
    quantity: 2,
    specs: {
      gasFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
      pressure: { value: "2", unit: "psig" },
      power: { value: String(roundTo(biogasScfm * 0.1, 1)), unit: "kW" },
    },
    designBasis: "Duty + standby (N+1 redundancy)",
    notes: "Low-pressure transport of biogas through conditioning equipment",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("gas-chiller"),
    process: "Biogas Conditioning",
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

  // ══════════════════════════════════════════════════════════
  // STAGE 8: GAS UPGRADING TO RNG
  // ══════════════════════════════════════════════════════════
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
      biogasFlow: { value: roundTo(m3ToScf(conditionedBiogasM3PerDay)), unit: "scfd" },
      ch4Content: { value: ch4Pct, unit: "%" },
    },
    outputStream: {
      rngFlow: { value: roundTo(rngScfPerDay), unit: "scfd" },
      rngFlowSCFM: { value: roundTo(rngScfm), unit: "scfm" },
      rngCH4: { value: productCH4, unit: "%" },
      rngEnergy: { value: roundTo(rngMMBtuPerDay, 1), unit: "MMBtu/day" },
      tailgasFlow: { value: roundTo(m3ToScf(tailgasM3PerDay)), unit: "scfd" },
      methaneRecovery: { value: roundTo(methaneRecovery * 100), unit: "%" },
    },
    designCriteria: AD_DESIGN_DEFAULTS.gasUpgrading,
    notes: [
      "Membrane or PSA upgrading system",
      `Tail gas: ${roundTo(m3ToScf(tailgasM3PerDay))} scfd → thermal oxidizer or flare`,
      `Electrical demand: ${roundTo(electricalDemandKW)} kW`,
      `RNG energy output: ${roundTo(rngMMBtuPerDay, 1)} MMBTU/day`,
    ],
  };
  adStages.push(upgradingStage);

  equipment.push({
    id: makeId("membrane-psa"),
    process: "Gas Upgrading",
    equipmentType: "Membrane/PSA Upgrading System",
    description: "Multi-stage membrane or pressure swing adsorption system for CO₂ removal",
    quantity: 1,
    specs: {
      inletFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
      productFlow: { value: String(roundTo(rngScfm)), unit: "scfm" },
      productCH4: { value: String(productCH4), unit: "%" },
      methaneRecovery: { value: "97", unit: "%" },
    },
    designBasis: "97% methane recovery, pipeline quality RNG (≥96% CH₄)",
    notes: "Includes monitoring and control system",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("rng-compressor"),
    process: "Gas Upgrading",
    equipmentType: "RNG Compressor",
    description: "Multi-stage compressor for pipeline injection pressure",
    quantity: 1,
    specs: {
      flow: { value: String(roundTo(rngScfm)), unit: "scfm" },
      dischargePressure: { value: String(AD_DESIGN_DEFAULTS.gasUpgrading.pressureOut.value), unit: "psig" },
      power: { value: String(roundTo(electricalDemandKW * 0.6)), unit: "kW" },
    },
    designBasis: `Pipeline injection at ${AD_DESIGN_DEFAULTS.gasUpgrading.pressureOut.value} psig`,
    notes: "Includes aftercooler and moisture knockout",
    isOverridden: false,
    isLocked: false,
  });

  // ══════════════════════════════════════════════════════════
  // STAGE 9: EMERGENCY GAS MANAGEMENT
  // ══════════════════════════════════════════════════════════
  equipment.push({
    id: makeId("enclosed-flare"),
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

  // ══════════════════════════════════════════════════════════
  // RECYCLE STREAMS
  // ══════════════════════════════════════════════════════════
  const recycleStreams = [
    {
      name: "DAF Float Recycle",
      source: "DAF",
      destination: "Digester",
      flow: roundTo(dafFloatTPD),
      loads: { TSS: roundTo(dafFloatTPD * 1000 * 0.05) },
    },
  ];

  // ══════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════
  const digesterVolGallons = totalDigesterVolM3 * 264.172;

  const summary: Record<string, { value: string; unit: string }> = {
    totalFeedRate: { value: roundTo(totalFeedTpd).toLocaleString(), unit: "tons/day" },
    totalVSLoad: { value: roundTo(eqVSLoadKgPerDay).toLocaleString(), unit: "kg VS/day" },
    biogasProduction: { value: roundTo(biogasScfm).toLocaleString(), unit: "scfm" },
    methaneProduction: { value: roundTo(biogasScfm * ch4Pct / 100).toLocaleString(), unit: "scfm CH₄" },
    rngEnergy: { value: roundTo(rngMMBtuPerDay, 1).toLocaleString(), unit: "MMBTU/day" },
    rngFlowSCFM: { value: roundTo(rngScfm).toLocaleString(), unit: "scfm" },
    digesterVolume: { value: roundTo(digesterVolGallons, 0).toLocaleString(), unit: "gallons" },
    hrt: { value: String(actualHRT), unit: "days" },
    vsDestruction: { value: `${roundTo(vsDestruction * 100)}`, unit: "%" },
    solidDigestate: { value: roundTo(cakeTPD).toLocaleString(), unit: "tons/day" },
    dafEffluent: { value: dafEffluentGPD.toLocaleString(), unit: "GPD" },
    electricalDemand: { value: roundTo(electricalDemandKW).toLocaleString(), unit: "kW" },
  };

  return {
    projectType: "B",
    stages: [],
    adStages,
    recycleStreams,
    equipment,
    convergenceIterations: 1,
    convergenceAchieved: true,
    assumptions,
    warnings,
    summary,
  };
}
