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
    electricalDemand: { value: 8.8, unit: "kWh/1,000 scf raw biogas", source: "Engineering practice" },
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

type StreamParam = { value: number; unit: string };

function buildSolidsStream(tpd: number, tsPct: number, vsPctOfTs: number, codMgL: number = 0): Record<string, StreamParam> {
  const tpy = roundTo(tpd * 365, 0);
  const lbPerDay = roundTo(tpd * 2000, 0);
  const densityLbPerGal = 8.34 + (tsPct / 100) * 0.5;
  const gpd = roundTo(lbPerDay / densityLbPerGal, 0);
  const tsLbPerDay = roundTo(lbPerDay * (tsPct / 100), 0);
  const vsLbPerDay = roundTo(tsLbPerDay * (vsPctOfTs / 100), 0);
  const codLbPerDay = codMgL > 0 ? roundTo(codMgL * gpd * 8.34 / 1_000_000, 0) : 0;
  return {
    flowTonsPerYear: { value: tpy, unit: "tons/year" },
    flowTonsPerDay: { value: roundTo(tpd), unit: "tons/day" },
    flowLbPerDay: { value: lbPerDay, unit: "lb/d" },
    flowGPD: { value: gpd, unit: "GPD" },
    totalSolidsPct: { value: roundTo(tsPct), unit: "%" },
    volatileSolidsPct: { value: roundTo(vsPctOfTs), unit: "%" },
    totalSolidsLbPerDay: { value: tsLbPerDay, unit: "lb/d" },
    volatileSolidsLbPerDay: { value: vsLbPerDay, unit: "lb/d" },
    codMgL: { value: roundTo(codMgL, 0), unit: "mg/L" },
    codLbPerDay: { value: codLbPerDay, unit: "lb/d" },
  };
}

function buildCodFractionation(codMgL: number, scodFraction: number = 0.3, codVsRatio: number = 1.4): Record<string, StreamParam> {
  const scodMgL = roundTo(codMgL * scodFraction, 0);
  const pcodMgL = roundTo(codMgL * (1 - scodFraction), 0);
  return {
    scodMgL: { value: scodMgL, unit: "mg/L" },
    pcodMgL: { value: pcodMgL, unit: "mg/L" },
    codVsRatio: { value: roundTo(codVsRatio, 2), unit: "lb COD/lb VS" },
  };
}

function buildGasStream(avgScfm: number, pressurePsig: number, ch4Pct: number, co2Pct: number, h2sPpm: number, n2Pct: number = 1.0, o2Pct: number = 0.5): Record<string, StreamParam> {
  const maxScfm = roundTo(avgScfm * 1.3);
  const minScfm = roundTo(avgScfm * 0.6);
  const btuPerScf = roundTo(ch4Pct / 100 * 1012, 0);
  const mmbtuPerDay = roundTo(avgScfm * 1440 * btuPerScf / 1_000_000, 1);
  return {
    avgFlowScfm: { value: roundTo(avgScfm), unit: "SCFM" },
    maxFlowScfm: { value: maxScfm, unit: "SCFM" },
    minFlowScfm: { value: minScfm, unit: "SCFM" },
    pressurePsig: { value: roundTo(pressurePsig), unit: "psig" },
    ch4: { value: roundTo(ch4Pct, 1), unit: "%" },
    co2: { value: roundTo(co2Pct, 1), unit: "%" },
    h2s: { value: roundTo(h2sPpm, 0), unit: "ppm" },
    n2: { value: roundTo(n2Pct, 1), unit: "%" },
    o2: { value: roundTo(o2Pct, 1), unit: "%" },
    btuPerScf: { value: btuPerScf, unit: "Btu/SCF" },
    mmbtuPerDay: { value: mmbtuPerDay, unit: "MMBtu/Day" },
  };
}

function buildWastewaterStream(
  wetFlowLbPerDay: number, tsLbPerDay: number, vsLbPerDay: number,
  tssLbPerDay: number, vssLbPerDay: number, codLbPerDay: number,
  scodLbPerDay: number, rbscodLbPerDay: number, rscodLbPerDay: number,
  tnLbPerDay: number, tknLbPerDay: number, nh3nLbPerDay: number, tpLbPerDay: number
): Record<string, StreamParam> {
  return {
    wetFlowLbPerDay: { value: roundTo(wetFlowLbPerDay, 0), unit: "lb/d" },
    tsLbPerDay: { value: roundTo(tsLbPerDay, 0), unit: "lb/d" },
    vsLbPerDay: { value: roundTo(vsLbPerDay, 0), unit: "lb/d" },
    tssLbPerDay: { value: roundTo(tssLbPerDay, 0), unit: "lb/d" },
    vssLbPerDay: { value: roundTo(vssLbPerDay, 0), unit: "lb/d" },
    codLbPerDay: { value: roundTo(codLbPerDay, 0), unit: "lb/d" },
    scodLbPerDay: { value: roundTo(scodLbPerDay, 0), unit: "lb/d" },
    rbscodLbPerDay: { value: roundTo(rbscodLbPerDay, 0), unit: "lb/d" },
    rscodLbPerDay: { value: roundTo(rscodLbPerDay, 0), unit: "lb/d" },
    tnLbPerDay: { value: roundTo(tnLbPerDay, 0), unit: "lb/d" },
    tknLbPerDay: { value: roundTo(tknLbPerDay, 0), unit: "lb/d" },
    nh3nLbPerDay: { value: roundTo(nh3nLbPerDay, 0), unit: "lb/d" },
    tpLbPerDay: { value: roundTo(tpLbPerDay, 0), unit: "lb/d" },
  };
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
  let weightedCOD = 0;
  let weightedTKN = 0;
  let weightedTP = 0;
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
    const codMgL = getSpecValue(fs, ["cod", "chemical oxygen demand"], 0);
    const tknMgL = getSpecValue(fs, ["tkn", "total kjeldahl nitrogen"], 0);
    const tpMgL = getSpecValue(fs, ["tp", "total phosphorus", "totalPhosphorus"], 0);

    const feedKgPerDay = tpd * 1000;
    const tsKg = feedKgPerDay * (ts / 100);
    const vsKg = tsKg * (vsOfTs / 100);

    totalFeedTpd += tpd;
    totalVSLoadKgPerDay += vsKg;
    weightedTS += ts * tpd;
    weightedVS += vsOfTs * tpd;
    weightedBMP += bmp * vsKg;
    weightedCN += cn * tpd;
    weightedCOD += codMgL * tpd;
    weightedTKN += tknMgL * tpd;
    weightedTP += tpMgL * tpd;
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
  const avgCOD = weightedCOD / totalWeightForAvg;
  const avgTKN = weightedTKN / totalWeightForAvg;
  const avgTP = weightedTP / totalWeightForAvg;
  const isPackaged = hasPackagedWaste(feedstocks);

  const scodFraction = 0.30;
  const totalFeedLbPerDay = totalFeedTpd * 2000;
  const feedDensityLbPerGal = 8.34 + (avgTS / 100) * 0.5;
  const totalFeedGPD = totalFeedLbPerDay / feedDensityLbPerGal;
  const totalTSLbPerDay = totalFeedLbPerDay * (avgTS / 100);
  const totalVSLbPerDay = totalTSLbPerDay * (avgVS / 100);
  const totalCODLbPerDay = avgCOD > 0 ? roundTo(avgCOD * totalFeedGPD * 8.34 / 1_000_000, 0) : roundTo(totalVSLbPerDay * 1.4, 0);
  const codVsRatio = (totalCODLbPerDay > 0 && totalVSLbPerDay > 0)
    ? totalCODLbPerDay / totalVSLbPerDay
    : 1.4;
  const totalSCODLbPerDay = roundTo(totalCODLbPerDay * scodFraction, 0);
  const totalTKNLbPerDay = avgTKN > 0 ? roundTo(avgTKN * totalFeedGPD * 8.34 / 1_000_000, 0) : roundTo(totalFeedLbPerDay * 0.005, 0);
  const totalNH3NLbPerDay = roundTo(totalTKNLbPerDay * 0.6, 0);
  const totalTPLbPerDay = avgTP > 0 ? roundTo(avgTP * totalFeedGPD * 8.34 / 1_000_000, 0) : roundTo(totalFeedLbPerDay * 0.001, 0);
  const effectiveCODMgL = avgCOD > 0 ? avgCOD : roundTo(totalVSLbPerDay * 1.4 / (totalFeedGPD * 8.34) * 1_000_000, 0);

  assumptions.push({ parameter: "Blended TS", value: `${roundTo(avgTS)}%`, source: "Weighted average" });
  assumptions.push({ parameter: "Blended VS/TS", value: `${roundTo(avgVS)}%`, source: "Weighted average" });
  assumptions.push({ parameter: "Blended BMP", value: `${roundTo(avgBMP * 35.3147 / 2.2046, 3)} scf CH₄/lb VS`, source: "Weighted average" });
  if (avgCOD <= 0) {
    assumptions.push({ parameter: "Blended COD", value: `${roundTo(effectiveCODMgL, 0)} mg/L (estimated from 1.4 × VS)`, source: "Engineering estimate" });
  }
  if (avgTKN <= 0) {
    assumptions.push({ parameter: "TKN", value: `Estimated at 0.5% of wet weight`, source: "Typical food waste" });
  }
  if (avgTP <= 0) {
    assumptions.push({ parameter: "TP", value: `Estimated at 0.1% of wet weight`, source: "Typical food waste" });
  }

  // ══════════════════════════════════════════════════════════
  // STAGE 1: FEEDSTOCK RECEIVING & STORAGE
  // ══════════════════════════════════════════════════════════
  const receivingSolids = buildSolidsStream(totalFeedTpd, avgTS, avgVS, effectiveCODMgL);
  const receivingCodFrac = buildCodFractionation(effectiveCODMgL, scodFraction, codVsRatio > 0 ? codVsRatio : 1.4);
  const receivingStage: ADProcessStage = {
    name: "Feedstock Receiving & Storage",
    type: "receiving",
    inputStream: {
      ...receivingSolids,
      ...receivingCodFrac,
      numFeedstocks: { value: feedstocks.length, unit: "streams" },
    },
    outputStream: {
      ...receivingSolids,
      ...receivingCodFrac,
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
  const postMacSolids = buildSolidsStream(postMacerationTpd, avgTS, avgVS, effectiveCODMgL);
  const postMacCodFrac = buildCodFractionation(effectiveCODMgL, scodFraction, codVsRatio > 0 ? codVsRatio : 1.4);

  const macerationStage: ADProcessStage = {
    name: "Feedstock Preparation (Maceration & Size Reduction)",
    type: "maceration",
    inputStream: {
      ...receivingSolids,
      ...receivingCodFrac,
    },
    outputStream: {
      ...postMacSolids,
      ...postMacCodFrac,
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

  const eqInputSolids = buildSolidsStream(postMacerationTpd, avgTS, avgVS, effectiveCODMgL);
  const eqOutputSolids = buildSolidsStream(eqOutputTpd, eqOutputTS, avgVS, effectiveCODMgL * (eqOutputTS / avgTS));
  const eqOutputCodFrac = buildCodFractionation(effectiveCODMgL * (eqOutputTS / avgTS), scodFraction, codVsRatio > 0 ? codVsRatio : 1.4);

  const eqStage: ADProcessStage = {
    name: "Equalization (EQ) Tank",
    type: "equalization",
    inputStream: {
      ...eqInputSolids,
      ...postMacCodFrac,
      dilutionWater: { value: roundTo(dilutionWaterTpd), unit: "tons/day" },
    },
    outputStream: {
      ...eqOutputSolids,
      ...eqOutputCodFrac,
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

  const biogasRawStream = buildGasStream(biogasScfm, 0.5, ch4Pct, co2Pct, h2sPpmv, 1.0, 0.5);
  const digestateTS = eqOutputTS * (1 - vsDestruction * (avgVS / 100));
  const digestateVSOfTS = avgVS * (1 - vsDestruction) / (1 - vsDestruction * (avgVS / 100));
  const digestateSolids = buildSolidsStream(digestateTPD, digestateTS, digestateVSOfTS, effectiveCODMgL * 0.35);
  const digestateCodFrac = buildCodFractionation(effectiveCODMgL * 0.35, 0.5, codVsRatio > 0 ? codVsRatio : 1.4);

  const digesterStage: ADProcessStage = {
    name: "Anaerobic Digestion (CSTR)",
    type: "digester",
    inputStream: {
      ...eqOutputSolids,
      ...eqOutputCodFrac,
      vsLoad: { value: roundTo(eqVSLoadKgPerDay), unit: "kg VS/day" },
      temperature: { value: AD_DESIGN_DEFAULTS.equalization.preheatTemp.value, unit: "°C" },
    },
    outputStream: {
      ...biogasRawStream,
      vsDestroyed: { value: roundTo(vsDestroyedKgPerDay), unit: "kg/day" },
      ...digestateSolids,
      ...digestateCodFrac,
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
  const digestateTSKgPerDay = digestateTPD * 1000 * (digestateTS / 100);
  const cakeSolidsKgPerDay = digestateTSKgPerDay * centSolidsCaptureEff;
  const cakeTPD = cakeSolidsKgPerDay / (centCakeSolidsPct / 100) / 1000;
  const centrateTPD = digestateTPD - cakeTPD;
  const centrateTSSMgL = digestateTSKgPerDay * (1 - centSolidsCaptureEff) / (centrateTPD * 1000) * 1_000_000;

  assumptions.push({ parameter: "Centrifuge Solids Capture", value: `${roundTo(centSolidsCaptureEff * 100)}%`, source: "Decanter centrifuge typical" });
  assumptions.push({ parameter: "Cake Solids", value: `${centCakeSolidsPct}% TS`, source: "Decanter centrifuge typical" });

  const centrateLbPerDay = centrateTPD * 2000;
  const centrateTSLbPerDay = digestateTSKgPerDay * (1 - centSolidsCaptureEff) * 2.2046;
  const centrateVSLbPerDay = centrateTSLbPerDay * (digestateVSOfTS / 100);
  const centrateTSSLbPerDay = centrateTSLbPerDay * 0.85;
  const centrateVSSLbPerDay = centrateVSLbPerDay * 0.85;
  const postDigestionCODFactor = 0.35;
  const centrateCODLbPerDay = totalCODLbPerDay * postDigestionCODFactor * (1 - centSolidsCaptureEff * 0.5);
  const centrateSCODLbPerDay = centrateCODLbPerDay * 0.6;
  const centrateRbSCODLbPerDay = centrateSCODLbPerDay * 0.3;
  const centrateRSCODLbPerDay = centrateSCODLbPerDay * 0.7;
  const centrateTNLbPerDay = totalTKNLbPerDay * 0.85;
  const centrateTKNLbPerDay = centrateTNLbPerDay * 0.95;
  const centrateNH3NLbPerDay = centrateTKNLbPerDay * 0.7;
  const centrateTPLbPerDay = totalTPLbPerDay * 0.6;

  const centrateWW = buildWastewaterStream(
    centrateLbPerDay, centrateTSLbPerDay, centrateVSLbPerDay,
    centrateTSSLbPerDay, centrateVSSLbPerDay, centrateCODLbPerDay,
    centrateSCODLbPerDay, centrateRbSCODLbPerDay, centrateRSCODLbPerDay,
    centrateTNLbPerDay, centrateTKNLbPerDay, centrateNH3NLbPerDay, centrateTPLbPerDay
  );
  const cakeSolids = buildSolidsStream(cakeTPD, centCakeSolidsPct, digestateVSOfTS * 0.8, 0);

  const centrifugeStage: ADProcessStage = {
    name: "Solids-Liquid Separation (Centrifuge)",
    type: "solidsSeparation",
    inputStream: {
      ...digestateSolids,
      ...digestateCodFrac,
    },
    outputStream: {
      ...cakeSolids,
      ...centrateWW,
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

  const dafEffluentLbPerDay = dafEffluentTPD * 2000;
  const dafEffTSLbPerDay = centrateTSLbPerDay * (1 - dafTSSRemoval) * 0.7;
  const dafEffVSLbPerDay = centrateVSLbPerDay * (1 - dafTSSRemoval) * 0.7;
  const dafEffTSSLbPerDay = centrateTSSLbPerDay * (1 - dafTSSRemoval);
  const dafEffVSSLbPerDay = centrateVSSLbPerDay * (1 - dafTSSRemoval);
  const dafEffCODLbPerDay = centrateCODLbPerDay * 0.7;
  const dafEffSCODLbPerDay = centrateSCODLbPerDay * 0.9;
  const dafEffRbSCODLbPerDay = centrateRbSCODLbPerDay * 0.85;
  const dafEffRSCODLbPerDay = centrateRSCODLbPerDay * 0.9;
  const dafEffTNLbPerDay = centrateTNLbPerDay * 0.95;
  const dafEffTKNLbPerDay = centrateTKNLbPerDay * 0.95;
  const dafEffNH3NLbPerDay = centrateNH3NLbPerDay * 0.95;
  const dafEffTPLbPerDay = centrateTPLbPerDay * 0.5;

  const dafEffluentWW = buildWastewaterStream(
    dafEffluentLbPerDay, dafEffTSLbPerDay, dafEffVSLbPerDay,
    dafEffTSSLbPerDay, dafEffVSSLbPerDay, dafEffCODLbPerDay,
    dafEffSCODLbPerDay, dafEffRbSCODLbPerDay, dafEffRSCODLbPerDay,
    dafEffTNLbPerDay, dafEffTKNLbPerDay, dafEffNH3NLbPerDay, dafEffTPLbPerDay
  );

  const dafStage: ADProcessStage = {
    name: "Liquid Cleanup — Dissolved Air Flotation (DAF)",
    type: "daf",
    inputStream: {
      ...centrateWW,
    },
    outputStream: {
      ...dafEffluentWW,
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
  const conditionedScfm = biogasScfm * (1 - volumeLossPct);

  const conditionedBiogasStream = buildGasStream(conditionedScfm, 2, ch4Pct, co2Pct, outH2sPpmv, 1.0, 0.5);

  const conditioningStage: ADProcessStage = {
    name: "Biogas Conditioning",
    type: "gasConditioning",
    inputStream: {
      ...biogasRawStream,
    },
    outputStream: {
      ...conditionedBiogasStream,
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
  const tailgasM3PerDay = conditionedBiogasM3PerDay - rngM3PerDay;
  const biogasScfdTotal = biogasM3PerDay * 35.3147;
  const electricalDemandKW = biogasScfdTotal * AD_DESIGN_DEFAULTS.gasUpgrading.electricalDemand.value / (1000 * 24);

  const rngProductCO2 = 100 - productCH4 - 0.5 - 0.3;
  const pressureOut = AD_DESIGN_DEFAULTS.gasUpgrading.pressureOut.value;
  const rngStream = buildGasStream(rngScfm, pressureOut, productCH4, rngProductCO2, 4, 0.5, 0.3);
  const tailgasScfm = roundTo(m3ToScf(tailgasM3PerDay) / 1440);

  const upgradingStage: ADProcessStage = {
    name: "Gas Upgrading to RNG",
    type: "gasUpgrading",
    inputStream: {
      ...conditionedBiogasStream,
    },
    outputStream: {
      ...rngStream,
      tailgasFlow: { value: roundTo(m3ToScf(tailgasM3PerDay)), unit: "scfd" },
      tailgasFlowSCFM: { value: tailgasScfm, unit: "SCFM" },
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

  const biogasBtuPerScf = roundTo(ch4Pct / 100 * 1012, 0);
  const biogasMmbtuPerDay = roundTo(biogasScfm * 1440 * biogasBtuPerScf / 1_000_000, 1);
  const rngBtuPerScf = roundTo(productCH4 / 100 * 1012, 0);
  const rngMmbtuPerDayFinal = roundTo(rngScfm * 1440 * rngBtuPerScf / 1_000_000, 1);

  const summary: Record<string, { value: string; unit: string }> = {
    totalFeedRate: { value: roundTo(totalFeedTpd).toLocaleString(), unit: "tons/day" },
    totalFeedLbPerDay: { value: roundTo(totalFeedLbPerDay, 0).toLocaleString(), unit: "lb/d" },
    totalFeedGPD: { value: roundTo(totalFeedGPD, 0).toLocaleString(), unit: "GPD" },
    totalSolidsPct: { value: `${roundTo(avgTS)}`, unit: "%" },
    volatileSolidsPct: { value: `${roundTo(avgVS)}`, unit: "%" },
    totalSolidsLbPerDay: { value: roundTo(totalTSLbPerDay, 0).toLocaleString(), unit: "lb/d" },
    volatileSolidsLbPerDay: { value: roundTo(totalVSLbPerDay, 0).toLocaleString(), unit: "lb/d" },
    codMgL: { value: roundTo(effectiveCODMgL, 0).toLocaleString(), unit: "mg/L" },
    codLbPerDay: { value: roundTo(totalCODLbPerDay, 0).toLocaleString(), unit: "lb/d" },
    scodMgL: { value: roundTo(effectiveCODMgL * scodFraction, 0).toLocaleString(), unit: "mg/L" },
    pcodMgL: { value: roundTo(effectiveCODMgL * (1 - scodFraction), 0).toLocaleString(), unit: "mg/L" },
    codVsRatio: { value: `${roundTo(codVsRatio > 0 ? codVsRatio : 1.4, 2)}`, unit: "lb COD/lb VS" },
    totalVSLoad: { value: roundTo(eqVSLoadKgPerDay).toLocaleString(), unit: "kg VS/day" },
    digesterVolume: { value: roundTo(digesterVolGallons, 0).toLocaleString(), unit: "gallons" },
    hrt: { value: String(actualHRT), unit: "days" },
    vsDestruction: { value: `${roundTo(vsDestruction * 100)}`, unit: "%" },
    biogasAvgFlowScfm: { value: roundTo(biogasScfm).toLocaleString(), unit: "SCFM" },
    biogasMaxFlowScfm: { value: roundTo(biogasScfm * 1.3).toLocaleString(), unit: "SCFM" },
    biogasMinFlowScfm: { value: roundTo(biogasScfm * 0.6).toLocaleString(), unit: "SCFM" },
    biogasPressurePsig: { value: "0.5", unit: "psig" },
    biogasCH4: { value: `${ch4Pct}`, unit: "%" },
    biogasCO2: { value: `${co2Pct}`, unit: "%" },
    biogasH2S: { value: `${h2sPpmv}`, unit: "ppm" },
    biogasN2: { value: "1.0", unit: "%" },
    biogasO2: { value: "0.5", unit: "%" },
    biogasBtuPerScf: { value: `${biogasBtuPerScf}`, unit: "Btu/SCF" },
    biogasMmbtuPerDay: { value: `${biogasMmbtuPerDay}`, unit: "MMBtu/Day" },
    rngAvgFlowScfm: { value: roundTo(rngScfm).toLocaleString(), unit: "SCFM" },
    rngMaxFlowScfm: { value: roundTo(rngScfm * 1.3).toLocaleString(), unit: "SCFM" },
    rngMinFlowScfm: { value: roundTo(rngScfm * 0.6).toLocaleString(), unit: "SCFM" },
    rngPressurePsig: { value: `${pressureOut}`, unit: "psig" },
    rngCH4: { value: `${productCH4}`, unit: "%" },
    rngCO2: { value: `${roundTo(rngProductCO2, 1)}`, unit: "%" },
    rngH2S: { value: "4", unit: "ppm" },
    rngN2: { value: "0.5", unit: "%" },
    rngO2: { value: "0.3", unit: "%" },
    rngBtuPerScf: { value: `${rngBtuPerScf}`, unit: "Btu/SCF" },
    rngMmbtuPerDay: { value: `${rngMmbtuPerDayFinal}`, unit: "MMBtu/Day" },
    methaneRecovery: { value: `${roundTo(methaneRecovery * 100)}`, unit: "%" },
    solidDigestate: { value: roundTo(cakeTPD).toLocaleString(), unit: "tons/day" },
    dafEffluent: { value: dafEffluentGPD.toLocaleString(), unit: "GPD" },
    centrateTKNLbPerDay: { value: roundTo(centrateTKNLbPerDay, 0).toLocaleString(), unit: "lb/d" },
    centrateNH3NLbPerDay: { value: roundTo(centrateNH3NLbPerDay, 0).toLocaleString(), unit: "lb/d" },
    centrateTPLbPerDay: { value: roundTo(centrateTPLbPerDay, 0).toLocaleString(), unit: "lb/d" },
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
