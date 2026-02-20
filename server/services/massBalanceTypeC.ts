import type {
  ADProcessStage,
  EquipmentItem,
  MassBalanceResults,
  UpifRecord,
  FeedstockEntry,
} from "@shared/schema";

type DesignCriterion = { value: number; unit: string; source: string };

const GAS_CONDITIONING_DEFAULTS: Record<string, Record<string, DesignCriterion>> = {
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
};

function roundTo(val: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}
function kWToHP(kw: number): number { return roundTo(kw * 1.341, 1); }

function getSpecValue(fs: FeedstockEntry, keys: string[], defaultVal: number): number {
  if (!fs.feedstockSpecs) return defaultVal;
  for (const key of keys) {
    for (const [k, spec] of Object.entries(fs.feedstockSpecs)) {
      const kl = k.toLowerCase();
      const dl = spec.displayName.toLowerCase();
      if (kl === key.toLowerCase() || kl.includes(key.toLowerCase()) || dl.includes(key.toLowerCase())) {
        const val = parseFloat(String(spec.value).replace(/[,%]/g, ""));
        if (!isNaN(val)) return val;
      }
    }
  }
  return defaultVal;
}

function parseBiogasFlow(fs: FeedstockEntry): { scfm: number; source: string } {
  if (!fs.feedstockSpecs) {
    const vol = parseFloat((fs.feedstockVolume || "0").replace(/,/g, ""));
    const unit = (fs.feedstockUnit || "").toLowerCase();
    if (!isNaN(vol) && vol > 0) {
      if (unit.includes("scfm")) return { scfm: vol, source: "User-provided" };
      if (unit.includes("scfh")) return { scfm: vol / 60, source: "User-provided" };
      if (unit.includes("scfd") || (unit.includes("scf") && unit.includes("day"))) return { scfm: vol / 1440, source: "User-provided" };
      if (unit.includes("m³/d") || unit.includes("m3/d")) return { scfm: (vol * 35.3147) / 1440, source: "Converted from m³/day" };
      if (unit.includes("m³/h") || unit.includes("m3/h")) return { scfm: (vol * 35.3147) / 60, source: "Converted from m³/hr" };
      if (unit.includes("nm³") || unit.includes("nm3")) return { scfm: (vol * 35.3147) / 1440, source: "Converted from Nm³/day" };
      if (unit.includes("scfm") || unit.includes("cfm")) return { scfm: vol, source: "User-provided" };
      return { scfm: vol, source: "Assumed scfm" };
    }
  }
  const flowVal = getSpecValue(fs, ["flow", "biogasFlow", "biogas flow", "gas flow"], 0);
  if (flowVal > 0) return { scfm: flowVal, source: "From specs" };
  return { scfm: 0, source: "Not found" };
}

export function calculateMassBalanceTypeC(upif: UpifRecord): MassBalanceResults {
  const warnings: MassBalanceResults["warnings"] = [];
  const assumptions: MassBalanceResults["assumptions"] = [];
  const adStages: ADProcessStage[] = [];
  const equipment: EquipmentItem[] = [];
  let eqId = 1;
  const makeId = () => `eq-${eqId++}`;

  const feedstocks = (upif.feedstocks || []) as FeedstockEntry[];
  if (feedstocks.length === 0) {
    warnings.push({ field: "Biogas Input", message: "No biogas input parameters found in UPIF", severity: "error" });
    return {
      projectType: "C",
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

  const fs = feedstocks[0];
  const { scfm: biogasScfm, source: flowSource } = parseBiogasFlow(fs);

  if (biogasScfm <= 0) {
    warnings.push({ field: "Biogas Flow", message: "No biogas flow rate found. Provide flow in scfm, scfh, m³/day, or similar units.", severity: "error" });
    return {
      projectType: "C",
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

  const ch4Pct = getSpecValue(fs, ["ch4", "methane", "ch₄"], 60);
  const co2Pct = getSpecValue(fs, ["co2", "carbon dioxide", "co₂"], 100 - ch4Pct - 2);
  const n2Pct = getSpecValue(fs, ["n2", "nitrogen"], 1);
  const o2Pct = getSpecValue(fs, ["o2", "oxygen"], 0.5);
  const h2sPpmv = getSpecValue(fs, ["h2s", "hydrogen sulfide", "h₂s"], 1500);
  const siloxanePpbv = getSpecValue(fs, ["siloxane", "siloxanes"], 5000);

  const biogasMaxScfm = getSpecValue(fs, ["max flow", "maxFlowScfm", "maximum flow", "peak flow"], biogasScfm * 1.3);
  const biogasMinScfm = getSpecValue(fs, ["min flow", "minFlowScfm", "minimum flow"], biogasScfm * 0.6);
  const biogasPressurePsig = getSpecValue(fs, ["pressure", "pressurePsig", "gas pressure", "inlet pressure"], 1.0);
  const biogasBtuPerScf = getSpecValue(fs, ["btu/scf", "btuPerScf", "heating value", "btu", "hhv", "lhv"], ch4Pct * 10.12);

  assumptions.push({ parameter: "Biogas Average Flow", value: `${roundTo(biogasScfm).toLocaleString()} SCFM`, source: flowSource });
  if (biogasMaxScfm === biogasScfm * 1.3) assumptions.push({ parameter: "Biogas Max Flow", value: `${roundTo(biogasMaxScfm).toLocaleString()} SCFM`, source: "Default 1.3× average flow" });
  if (biogasMinScfm === biogasScfm * 0.6) assumptions.push({ parameter: "Biogas Min Flow", value: `${roundTo(biogasMinScfm).toLocaleString()} SCFM`, source: "Default 0.6× average flow" });
  if (ch4Pct === 60) assumptions.push({ parameter: "CH₄ Content", value: "60%", source: "Default assumption — typical AD biogas" });
  if (h2sPpmv === 1500) assumptions.push({ parameter: "H₂S", value: "1,500 ppm", source: "Default assumption — typical AD biogas" });

  const biogasScfPerDay = biogasScfm * 1440;
  const biogasM3PerDay = biogasScfPerDay / 35.3147;
  const biogasMmbtuPerDay = (biogasScfPerDay * biogasBtuPerScf) / 1_000_000;

  const inletStage: ADProcessStage = {
    name: "Existing Biogas Supply",
    type: "biogasInlet",
    inputStream: {
      avgFlowScfm: { value: roundTo(biogasScfm), unit: "SCFM" },
      maxFlowScfm: { value: roundTo(biogasMaxScfm), unit: "SCFM" },
      minFlowScfm: { value: roundTo(biogasMinScfm), unit: "SCFM" },
      pressurePsig: { value: roundTo(biogasPressurePsig, 1), unit: "psig" },
      ch4: { value: roundTo(ch4Pct, 1), unit: "%" },
      co2: { value: roundTo(co2Pct, 1), unit: "%" },
      h2s: { value: roundTo(h2sPpmv), unit: "ppm" },
      n2: { value: roundTo(n2Pct, 1), unit: "%" },
      o2: { value: roundTo(o2Pct, 1), unit: "%" },
      btuPerScf: { value: roundTo(biogasBtuPerScf), unit: "Btu/SCF" },
      mmbtuPerDay: { value: roundTo(biogasMmbtuPerDay, 1), unit: "MMBtu/Day" },
      siloxanes: { value: roundTo(siloxanePpbv), unit: "ppbv" },
    },
    outputStream: {
      avgFlowScfm: { value: roundTo(biogasScfm), unit: "SCFM" },
    },
    designCriteria: {},
    notes: ["Existing digester biogas supply — no digester sizing included in Type C"],
  };
  adStages.push(inletStage);

  const h2sRemovalEff = GAS_CONDITIONING_DEFAULTS.gasConditioning.h2sRemovalEff.value / 100;
  const siloxaneRemovalEff = GAS_CONDITIONING_DEFAULTS.gasConditioning.siloxaneRemoval.value / 100;
  const outH2sPpmv = h2sPpmv * (1 - h2sRemovalEff);
  const outSiloxanePpbv = siloxanePpbv * (1 - siloxaneRemovalEff);
  const conditionedScfm = biogasScfm * 0.99;

  const conditioningStage: ADProcessStage = {
    name: "Biogas Conditioning",
    type: "gasConditioning",
    inputStream: {
      biogasFlow: { value: roundTo(biogasScfm), unit: "scfm" },
      h2s: { value: roundTo(h2sPpmv), unit: "ppmv" },
      siloxanes: { value: roundTo(siloxanePpbv), unit: "ppbv" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(conditionedScfm), unit: "scfm" },
      h2s: { value: roundTo(outH2sPpmv, 1), unit: "ppmv" },
      siloxanes: { value: roundTo(outSiloxanePpbv), unit: "ppbv" },
      moisture: { value: 0, unit: "dry" },
    },
    designCriteria: GAS_CONDITIONING_DEFAULTS.gasConditioning,
    notes: [
      "H₂S removal via iron sponge or biological scrubber",
      "Siloxane removal via activated carbon adsorption",
      "Moisture removal via chiller and desiccant dryer",
    ],
  };
  adStages.push(conditioningStage);

  const cScrubberH = roundTo(Math.max(8, Math.sqrt(biogasScfm) * 1.5), 0);
  const cScrubberDia = roundTo(Math.max(3, Math.sqrt(biogasScfm) * 0.5), 1);
  equipment.push({
    id: makeId(),
    process: "Gas Conditioning",
    equipmentType: "H₂S Removal System",
    description: "Iron sponge or biological scrubber for hydrogen sulfide removal",
    quantity: 1,
    specs: {
      inletH2S: { value: String(roundTo(h2sPpmv)), unit: "ppmv" },
      outletH2S: { value: String(roundTo(outH2sPpmv, 1)), unit: "ppmv" },
      removalEff: { value: "99.5", unit: "%" },
      gasFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
      dimensionsL: { value: String(cScrubberDia), unit: "ft (dia)" },
      dimensionsW: { value: String(cScrubberDia), unit: "ft (dia)" },
      dimensionsH: { value: String(cScrubberH), unit: "ft" },
      power: { value: String(roundTo(Math.max(3, biogasScfm * 0.05), 0)), unit: "HP" },
    },
    designBasis: "99.5% H₂S removal to < 10 ppmv",
    notes: "Includes media replacement schedule",
    isOverridden: false,
    isLocked: false,
  });

  if (siloxanePpbv > 100) {
    const silDia = roundTo(Math.max(2, Math.sqrt(biogasScfm) * 0.3), 1);
    const silH = roundTo(Math.max(6, Math.sqrt(biogasScfm) * 1.0), 0);
    equipment.push({
      id: makeId(),
      process: "Gas Conditioning",
      equipmentType: "Siloxane Removal System",
      description: "Activated carbon adsorption vessel for siloxane removal",
      quantity: 2,
      specs: {
        inletSiloxane: { value: String(roundTo(siloxanePpbv)), unit: "ppbv" },
        outletSiloxane: { value: String(roundTo(outSiloxanePpbv)), unit: "ppbv" },
        removalEff: { value: "95", unit: "%" },
        gasFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
        dimensionsL: { value: String(silDia), unit: "ft (dia)" },
        dimensionsW: { value: String(silDia), unit: "ft (dia)" },
        dimensionsH: { value: String(silH), unit: "ft" },
        power: { value: "1", unit: "HP" },
      },
      designBasis: "Lead/lag configuration, 95% removal",
      notes: "Carbon replacement on breakthrough detection",
      isOverridden: false,
      isLocked: false,
    });
  }

  equipment.push({
    id: makeId(),
    process: "Gas Conditioning",
    equipmentType: "Gas Chiller/Dryer",
    description: "Refrigerated chiller and desiccant dryer for moisture removal",
    quantity: 1,
    specs: {
      gasFlow: { value: String(roundTo(biogasScfm)), unit: "scfm" },
      outletDewpoint: { value: "-40", unit: "°F" },
      dimensionsL: { value: "8", unit: "ft" },
      dimensionsW: { value: "4", unit: "ft" },
      dimensionsH: { value: "6", unit: "ft" },
      power: { value: String(roundTo(Math.max(5, biogasScfm * 0.08), 0)), unit: "HP" },
    },
    designBasis: "Reduce moisture to pipeline specifications",
    notes: "Condensate drainage included",
    isOverridden: false,
    isLocked: false,
  });

  const methaneRecovery = GAS_CONDITIONING_DEFAULTS.gasUpgrading.methaneRecovery.value / 100;
  const productCH4 = GAS_CONDITIONING_DEFAULTS.gasUpgrading.productCH4.value;
  const ch4ScfPerDay = biogasScfPerDay * (ch4Pct / 100);
  const rngCH4ScfPerDay = ch4ScfPerDay * methaneRecovery;
  const rngScfPerDay = rngCH4ScfPerDay / (productCH4 / 100);
  const rngScfm = rngScfPerDay / 1440;
  const rngMMBtuPerDay = rngScfPerDay * 1012 / 1_000_000;
  const tailgasScfm = conditionedScfm - rngScfm;
  const electricalDemandKW = biogasM3PerDay * GAS_CONDITIONING_DEFAULTS.gasUpgrading.electricalDemand.value / 24;

  const rngMaxScfm = (biogasMaxScfm / biogasScfm) * rngScfm;
  const rngMinScfm = (biogasMinScfm / biogasScfm) * rngScfm;
  const rngPressurePsig = GAS_CONDITIONING_DEFAULTS.gasUpgrading.pressureOut.value;
  const rngBtuPerScf = productCH4 * 10.12;
  const rngCO2Pct = 100 - productCH4 - 0.5 - 0.1;
  const rngH2SPpm = outH2sPpmv < 4 ? roundTo(outH2sPpmv, 1) : 4;
  const rngN2Pct = 0.4;
  const rngO2Pct = 0.1;

  const upgradingStage: ADProcessStage = {
    name: "Gas Upgrading to RNG",
    type: "gasUpgrading",
    inputStream: {
      avgFlowScfm: { value: roundTo(conditionedScfm), unit: "SCFM" },
      ch4: { value: roundTo(ch4Pct, 1), unit: "%" },
    },
    outputStream: {
      avgFlowScfm: { value: roundTo(rngScfm), unit: "SCFM" },
      maxFlowScfm: { value: roundTo(rngMaxScfm), unit: "SCFM" },
      minFlowScfm: { value: roundTo(rngMinScfm), unit: "SCFM" },
      pressurePsig: { value: rngPressurePsig, unit: "psig" },
      ch4: { value: productCH4, unit: "%" },
      co2: { value: roundTo(rngCO2Pct, 1), unit: "%" },
      h2s: { value: rngH2SPpm, unit: "ppm" },
      n2: { value: rngN2Pct, unit: "%" },
      o2: { value: rngO2Pct, unit: "%" },
      btuPerScf: { value: roundTo(rngBtuPerScf), unit: "Btu/SCF" },
      mmbtuPerDay: { value: roundTo(rngMMBtuPerDay, 1), unit: "MMBtu/Day" },
      tailgasFlow: { value: roundTo(tailgasScfm), unit: "SCFM" },
      methaneRecovery: { value: roundTo(methaneRecovery * 100), unit: "%" },
    },
    designCriteria: GAS_CONDITIONING_DEFAULTS.gasUpgrading,
    notes: [
      "Membrane or PSA upgrading system",
      `Tail gas: ${roundTo(tailgasScfm)} SCFM — route to flare or thermal oxidizer`,
      `Electrical demand: ${roundTo(electricalDemandKW)} kW`,
    ],
  };
  adStages.push(upgradingStage);

  const cUpgradingPowerHP = roundTo(kWToHP(electricalDemandKW * 0.4), 0);
  equipment.push({
    id: makeId(),
    process: "Gas Upgrading",
    equipmentType: "Membrane/PSA Upgrading System",
    description: "Multi-stage membrane or pressure swing adsorption for CO₂ removal",
    quantity: 1,
    specs: {
      inletFlow: { value: String(roundTo(conditionedScfm)), unit: "scfm" },
      productFlow: { value: String(roundTo(rngScfm)), unit: "scfm" },
      productCH4: { value: String(productCH4), unit: "%" },
      methaneRecovery: { value: "97", unit: "%" },
      pressure: { value: "200", unit: "psig" },
      dimensionsL: { value: String(roundTo(Math.max(20, biogasScfm * 0.08), 0)), unit: "ft" },
      dimensionsW: { value: String(roundTo(Math.max(10, biogasScfm * 0.04), 0)), unit: "ft" },
      dimensionsH: { value: "12", unit: "ft" },
      power: { value: String(cUpgradingPowerHP), unit: "HP" },
    },
    designBasis: "97% methane recovery, pipeline quality RNG",
    notes: "Includes compression, monitoring, and control system",
    isOverridden: false,
    isLocked: false,
  });

  const cCompressorPowerHP = roundTo(kWToHP(electricalDemandKW * 0.6), 0);
  equipment.push({
    id: makeId(),
    process: "Gas Upgrading",
    equipmentType: "RNG Compressor",
    description: "Multi-stage compressor for pipeline injection pressure",
    quantity: 1,
    specs: {
      flow: { value: String(roundTo(rngScfm)), unit: "scfm" },
      dischargePressure: { value: "200", unit: "psig" },
      dimensionsL: { value: "8", unit: "ft" },
      dimensionsW: { value: "5", unit: "ft" },
      dimensionsH: { value: "6", unit: "ft" },
      power: { value: String(cCompressorPowerHP), unit: "HP" },
    },
    designBasis: "Pipeline injection pressure",
    notes: "Includes aftercooler and moisture knockout",
    isOverridden: false,
    isLocked: false,
  });

  const cFlareH = roundTo(Math.max(15, Math.sqrt(biogasScfm) * 2), 0);
  equipment.push({
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
      dimensionsH: { value: String(cFlareH), unit: "ft" },
      power: { value: "5", unit: "HP" },
    },
    designBasis: "110% of maximum biogas flow",
    notes: "Required for startup, upset, and maintenance",
    isOverridden: false,
    isLocked: false,
  });

  const summary: Record<string, { value: string; unit: string }> = {
    biogasAvgFlowScfm: { value: roundTo(biogasScfm).toLocaleString(), unit: "SCFM" },
    biogasMaxFlowScfm: { value: roundTo(biogasMaxScfm).toLocaleString(), unit: "SCFM" },
    biogasMinFlowScfm: { value: roundTo(biogasMinScfm).toLocaleString(), unit: "SCFM" },
    biogasPressurePsig: { value: roundTo(biogasPressurePsig, 1).toString(), unit: "psig" },
    biogasCH4: { value: roundTo(ch4Pct, 1).toString(), unit: "%" },
    biogasCO2: { value: roundTo(co2Pct, 1).toString(), unit: "%" },
    biogasH2S: { value: roundTo(h2sPpmv).toLocaleString(), unit: "ppm" },
    biogasN2: { value: roundTo(n2Pct, 1).toString(), unit: "%" },
    biogasO2: { value: roundTo(o2Pct, 1).toString(), unit: "%" },
    biogasBtuPerScf: { value: roundTo(biogasBtuPerScf).toLocaleString(), unit: "Btu/SCF" },
    biogasMmbtuPerDay: { value: roundTo(biogasMmbtuPerDay, 1).toLocaleString(), unit: "MMBtu/Day" },
    rngAvgFlowScfm: { value: roundTo(rngScfm).toLocaleString(), unit: "SCFM" },
    rngMaxFlowScfm: { value: roundTo(rngMaxScfm).toLocaleString(), unit: "SCFM" },
    rngMinFlowScfm: { value: roundTo(rngMinScfm).toLocaleString(), unit: "SCFM" },
    rngPressurePsig: { value: rngPressurePsig.toString(), unit: "psig" },
    rngCH4: { value: productCH4.toString(), unit: "%" },
    rngCO2: { value: roundTo(rngCO2Pct, 1).toString(), unit: "%" },
    rngH2S: { value: rngH2SPpm.toString(), unit: "ppm" },
    rngN2: { value: rngN2Pct.toString(), unit: "%" },
    rngO2: { value: rngO2Pct.toString(), unit: "%" },
    rngBtuPerScf: { value: roundTo(rngBtuPerScf).toLocaleString(), unit: "Btu/SCF" },
    rngMmbtuPerDay: { value: roundTo(rngMMBtuPerDay, 1).toLocaleString(), unit: "MMBtu/Day" },
    methaneRecovery: { value: roundTo(methaneRecovery * 100).toString(), unit: "%" },
    tailgasFlow: { value: roundTo(tailgasScfm).toLocaleString(), unit: "SCFM" },
    electricalDemand: { value: roundTo(electricalDemandKW).toLocaleString(), unit: "kW" },
  };

  return {
    projectType: "C",
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
