export interface CapexSizeTier {
  scfm: number;
  majorEquipment: {
    guu: number;
    flare: number;
    compressor: number;
  };
  engineering: {
    bopDesign: number;
    bopConstructionAdmin: number;
    thirdPartyTesting: number;
    asBuilts: number;
  };
  civilStructural: {
    earthworks: number;
    concrete: number;
    processStructural: number;
  };
  processPiping: {
    pipingBase: number;
    settingEquipment: number;
  };
  electrical: number;
  instrumentationControls: number;
  nonProcess: {
    siteInfrastructure: number;
    siteUtilities: number;
    siteElectrical: number;
  };
}

export const CAPEX_SIZE_TIERS: CapexSizeTier[] = [
  {
    scfm: 400,
    majorEquipment: {
      guu: 3_495_697,
      flare: 142_425,
      compressor: 491_596,
    },
    engineering: {
      bopDesign: 367_034,
      bopConstructionAdmin: 193_116,
      thirdPartyTesting: 85_587,
      asBuilts: 10_000,
    },
    civilStructural: {
      earthworks: 581_283,
      concrete: 171_160,
      processStructural: 48_600,
    },
    processPiping: {
      pipingBase: 905_209,
      settingEquipment: 72_019,
    },
    electrical: 925_604,
    instrumentationControls: 715_378,
    nonProcess: {
      siteInfrastructure: 236_367,
      siteUtilities: 144_088,
      siteElectrical: 49_252,
    },
  },
  {
    scfm: 800,
    majorEquipment: {
      guu: 5_589_575,
      flare: 142_425,
      compressor: 491_596,
    },
    engineering: {
      bopDesign: 452_500,
      bopConstructionAdmin: 193_116,
      thirdPartyTesting: 94_146,
      asBuilts: 10_000,
    },
    civilStructural: {
      earthworks: 709_490,
      concrete: 292_100,
      processStructural: 72_900,
    },
    processPiping: {
      pipingBase: 1_206_945,
      settingEquipment: 72_019,
    },
    electrical: 1_238_247,
    instrumentationControls: 715_378,
    nonProcess: {
      siteInfrastructure: 258_839,
      siteUtilities: 170_563,
      siteElectrical: 55_194,
    },
  },
  {
    scfm: 1200,
    majorEquipment: {
      guu: 6_113_161,
      flare: 142_425,
      compressor: 491_596,
    },
    engineering: {
      bopDesign: 593_670,
      bopConstructionAdmin: 193_116,
      thirdPartyTesting: 103_561,
      asBuilts: 10_000,
    },
    civilStructural: {
      earthworks: 709_490,
      concrete: 292_100,
      processStructural: 72_900,
    },
    processPiping: {
      pipingBase: 1_206_945,
      settingEquipment: 72_019,
    },
    electrical: 1_274_795,
    instrumentationControls: 715_378,
    nonProcess: {
      siteInfrastructure: 258_839,
      siteUtilities: 170_563,
      siteElectrical: 55_194,
    },
  },
];

export interface ConstructionIndirectRates {
  generalConditionsPct: number;
  buildingPermitsPct: number;
  insuranceGAPct: number;
  epcProfitPct: number;
}

export const DEFAULT_CONSTRUCTION_INDIRECT_RATES: ConstructionIndirectRates = {
  generalConditionsPct: 20.49,
  buildingPermitsPct: 0.97,
  insuranceGAPct: 5.22,
  epcProfitPct: 10.63,
};

export interface CommercialItems {
  utilityConnectionFee: number;
  insurancePctOfEpc: number;
  projectDelivery: number;
  devCostsPctOfEpc: number;
  devFeePctOfEpc: number;
  opsDuringConstruction: number;
  fixturesAndFurnishings: number;
  contingencyPctOfEpc: number;
  escalationPct: number;
}

export const DEFAULT_COMMERCIAL_ITEMS: CommercialItems = {
  utilityConnectionFee: 250_000,
  insurancePctOfEpc: 1.5,
  projectDelivery: 1_360_000,
  devCostsPctOfEpc: 3.0,
  devFeePctOfEpc: 0.0,
  opsDuringConstruction: 426_000,
  fixturesAndFurnishings: 247_000,
  contingencyPctOfEpc: 7.5,
  escalationPct: 5.83,
};

export interface InterconnectDefaults {
  interconnectFacilityBase: number;
  lateralCostPerMile: number;
  defaultLateralMiles: number;
}

export const DEFAULT_INTERCONNECT: InterconnectDefaults = {
  interconnectFacilityBase: 2_200_000,
  lateralCostPerMile: 923_403,
  defaultLateralMiles: 2.0,
};

export interface FieldTechnicians {
  prodevalTechHours: number;
  otherVendorTechHours: number;
  hourlyRate: number;
}

export const DEFAULT_FIELD_TECHNICIANS: FieldTechnicians = {
  prodevalTechHours: 80,
  otherVendorTechHours: 80,
  hourlyRate: 250,
};

export function selectCapexTier(biogasScfm: number): CapexSizeTier {
  if (biogasScfm <= 500) return CAPEX_SIZE_TIERS[0];
  if (biogasScfm <= 1000) return CAPEX_SIZE_TIERS[1];
  return CAPEX_SIZE_TIERS[2];
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function interpolateCapexTier(biogasScfm: number): CapexSizeTier {
  if (biogasScfm <= 400) return CAPEX_SIZE_TIERS[0];
  if (biogasScfm >= 1200) return CAPEX_SIZE_TIERS[2];

  let lower: CapexSizeTier;
  let upper: CapexSizeTier;
  let t: number;

  if (biogasScfm <= 800) {
    lower = CAPEX_SIZE_TIERS[0];
    upper = CAPEX_SIZE_TIERS[1];
    t = (biogasScfm - 400) / 400;
  } else {
    lower = CAPEX_SIZE_TIERS[1];
    upper = CAPEX_SIZE_TIERS[2];
    t = (biogasScfm - 800) / 400;
  }

  return {
    scfm: biogasScfm,
    majorEquipment: {
      guu: lerp(lower.majorEquipment.guu, upper.majorEquipment.guu, t),
      flare: lerp(lower.majorEquipment.flare, upper.majorEquipment.flare, t),
      compressor: lerp(lower.majorEquipment.compressor, upper.majorEquipment.compressor, t),
    },
    engineering: {
      bopDesign: lerp(lower.engineering.bopDesign, upper.engineering.bopDesign, t),
      bopConstructionAdmin: lerp(lower.engineering.bopConstructionAdmin, upper.engineering.bopConstructionAdmin, t),
      thirdPartyTesting: lerp(lower.engineering.thirdPartyTesting, upper.engineering.thirdPartyTesting, t),
      asBuilts: lerp(lower.engineering.asBuilts, upper.engineering.asBuilts, t),
    },
    civilStructural: {
      earthworks: lerp(lower.civilStructural.earthworks, upper.civilStructural.earthworks, t),
      concrete: lerp(lower.civilStructural.concrete, upper.civilStructural.concrete, t),
      processStructural: lerp(lower.civilStructural.processStructural, upper.civilStructural.processStructural, t),
    },
    processPiping: {
      pipingBase: lerp(lower.processPiping.pipingBase, upper.processPiping.pipingBase, t),
      settingEquipment: lerp(lower.processPiping.settingEquipment, upper.processPiping.settingEquipment, t),
    },
    electrical: lerp(lower.electrical, upper.electrical, t),
    instrumentationControls: lerp(lower.instrumentationControls, upper.instrumentationControls, t),
    nonProcess: {
      siteInfrastructure: lerp(lower.nonProcess.siteInfrastructure, upper.nonProcess.siteInfrastructure, t),
      siteUtilities: lerp(lower.nonProcess.siteUtilities, upper.nonProcess.siteUtilities, t),
      siteElectrical: lerp(lower.nonProcess.siteElectrical, upper.nonProcess.siteElectrical, t),
    },
  };
}

export function getTierLabel(biogasScfm: number): string {
  if (biogasScfm <= 500) return "400 SCFM GUU";
  if (biogasScfm <= 1000) return "800 SCFM GUU";
  return "1,200 SCFM GUU";
}
