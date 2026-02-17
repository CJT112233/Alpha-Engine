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
    electricalDemand: { value: 0.25, unit: "kWh/Nm³ raw biogas", source: "Engineering practice" },
    pressureOut: { value: 200, unit: "psig", source: "Pipeline injection" },
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

  assumptions.push({ parameter: "Biogas Flow", value: `${roundTo(biogasScfm)} scfm`, source: flowSource });
  if (ch4Pct === 60) assumptions.push({ parameter: "CH₄ Content", value: "60%", source: "Default assumption — typical AD biogas" });
  if (h2sPpmv === 1500) assumptions.push({ parameter: "H₂S", value: "1,500 ppmv", source: "Default assumption — typical AD biogas" });

  const biogasScfPerDay = biogasScfm * 1440;
  const biogasM3PerDay = biogasScfPerDay / 35.3147;

  const inletStage: ADProcessStage = {
    name: "Existing Biogas Supply",
    type: "biogasInlet",
    inputStream: {
      biogasFlow: { value: roundTo(biogasScfm), unit: "scfm" },
      biogasFlowDaily: { value: roundTo(biogasScfPerDay), unit: "scf/day" },
      ch4: { value: roundTo(ch4Pct, 1), unit: "%" },
      co2: { value: roundTo(co2Pct, 1), unit: "%" },
      n2: { value: roundTo(n2Pct, 1), unit: "%" },
      o2: { value: roundTo(o2Pct, 1), unit: "%" },
      h2s: { value: roundTo(h2sPpmv), unit: "ppmv" },
      siloxanes: { value: roundTo(siloxanePpbv), unit: "ppbv" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(biogasScfm), unit: "scfm" },
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
    },
    designBasis: "99.5% H₂S removal to < 10 ppmv",
    notes: "Includes media replacement schedule",
    isOverridden: false,
    isLocked: false,
  });

  if (siloxanePpbv > 100) {
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
  const rngGJPerDay = rngMMBtuPerDay * 1.055;
  const tailgasScfm = conditionedScfm - rngScfm;
  const electricalDemandKW = biogasM3PerDay * GAS_CONDITIONING_DEFAULTS.gasUpgrading.electricalDemand.value / 24;

  const upgradingStage: ADProcessStage = {
    name: "Gas Upgrading to RNG",
    type: "gasUpgrading",
    inputStream: {
      biogasFlow: { value: roundTo(conditionedScfm), unit: "scfm" },
      ch4Content: { value: roundTo(ch4Pct, 1), unit: "%" },
    },
    outputStream: {
      rngFlow: { value: roundTo(rngScfm), unit: "scfm" },
      rngFlowDaily: { value: roundTo(rngScfPerDay), unit: "scf/day" },
      rngCH4: { value: productCH4, unit: "%" },
      rngEnergy: { value: roundTo(rngMMBtuPerDay, 1), unit: "MMBtu/day" },
      tailgasFlow: { value: roundTo(tailgasScfm), unit: "scfm" },
      methaneRecovery: { value: roundTo(methaneRecovery * 100), unit: "%" },
    },
    designCriteria: GAS_CONDITIONING_DEFAULTS.gasUpgrading,
    notes: [
      "Membrane or PSA upgrading system",
      `Tail gas: ${roundTo(tailgasScfm)} scfm — route to flare or thermal oxidizer`,
      `Electrical demand: ${roundTo(electricalDemandKW)} kW`,
    ],
  };
  adStages.push(upgradingStage);

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
    designBasis: "Pipeline injection pressure",
    notes: "Includes aftercooler and moisture knockout",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId(),
    process: "Gas Management",
    equipmentType: "Enclosed Flare",
    description: "Enclosed ground flare for tail gas and excess biogas combustion",
    quantity: 1,
    specs: {
      capacity: { value: String(roundTo(biogasScfm * 1.1)), unit: "scfm" },
      destructionEff: { value: "99.5", unit: "%" },
    },
    designBasis: "110% of maximum biogas flow",
    notes: "Required for startup, upset, and maintenance",
    isOverridden: false,
    isLocked: false,
  });

  const summary: Record<string, { value: string; unit: string }> = {
    biogasInletFlow: { value: roundTo(biogasScfm).toLocaleString(), unit: "scfm" },
    biogasInletCH4: { value: roundTo(ch4Pct, 1).toString(), unit: "%" },
    biogasInletH2S: { value: roundTo(h2sPpmv).toLocaleString(), unit: "ppmv" },
    rngProduction: { value: roundTo(rngScfm).toLocaleString(), unit: "scfm" },
    rngProductionDaily: { value: roundTo(rngScfPerDay).toLocaleString(), unit: "scf/day" },
    rngCH4Purity: { value: productCH4.toString(), unit: "%" },
    rngEnergy: { value: roundTo(rngMMBtuPerDay, 1).toLocaleString(), unit: "MMBtu/day" },
    rngEnergyGJ: { value: roundTo(rngGJPerDay, 1).toLocaleString(), unit: "GJ/day" },
    methaneRecovery: { value: roundTo(methaneRecovery * 100).toString(), unit: "%" },
    tailgasFlow: { value: roundTo(tailgasScfm).toLocaleString(), unit: "scfm" },
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
