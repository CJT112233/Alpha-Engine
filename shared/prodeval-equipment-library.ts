export type ProdevalSpec = { value: string; unit: string };

export interface ProdevalEquipmentItem {
  id: string;
  process: string;
  equipmentType: string;
  description: string;
  quantity: number;
  specs: Record<string, ProdevalSpec>;
  designBasis: string;
  notes: string;
}

export interface ProdevalUnitConfig {
  modelSize: string;
  nominalCapacityScfm: number;
  numberOfTrains: number;
  perTrainScfm: number;
  methaneRecovery: number;
  productCH4: number;
  rngPressurePsig: number;
  h2sRemovalEff: number;
  volumeLossPct: number;
  condenserOutletTempF: number;
  blowerOutletPsig: number;
  acFilterPressurePsig: number;
  compressorOutletPsig: number;
  membranePressurePsig: number;
  hpFiltrationPsig: number;
  electricalDemandKWhPer1000Scf: number;
}

export const PRODEVAL_UNIT_CONFIGS: ProdevalUnitConfig[] = [
  {
    modelSize: "400 SCFM",
    nominalCapacityScfm: 400,
    numberOfTrains: 1,
    perTrainScfm: 399,
    methaneRecovery: 97,
    productCH4: 97,
    rngPressurePsig: 200,
    h2sRemovalEff: 99.5,
    volumeLossPct: 1,
    condenserOutletTempF: 39,
    blowerOutletPsig: 2.32,
    acFilterPressurePsig: 2.18,
    compressorOutletPsig: 202,
    membranePressurePsig: 189,
    hpFiltrationPsig: 116,
    electricalDemandKWhPer1000Scf: 8.8,
  },
  {
    modelSize: "800 SCFM",
    nominalCapacityScfm: 800,
    numberOfTrains: 2,
    perTrainScfm: 399,
    methaneRecovery: 97,
    productCH4: 97,
    rngPressurePsig: 200,
    h2sRemovalEff: 99.5,
    volumeLossPct: 1,
    condenserOutletTempF: 39,
    blowerOutletPsig: 2.32,
    acFilterPressurePsig: 2.18,
    compressorOutletPsig: 202,
    membranePressurePsig: 189,
    hpFiltrationPsig: 116,
    electricalDemandKWhPer1000Scf: 8.8,
  },
  {
    modelSize: "1200 SCFM",
    nominalCapacityScfm: 1200,
    numberOfTrains: 3,
    perTrainScfm: 399,
    methaneRecovery: 97,
    productCH4: 97,
    rngPressurePsig: 200,
    h2sRemovalEff: 99.5,
    volumeLossPct: 1,
    condenserOutletTempF: 39,
    blowerOutletPsig: 2.32,
    acFilterPressurePsig: 2.18,
    compressorOutletPsig: 202,
    membranePressurePsig: 189,
    hpFiltrationPsig: 116,
    electricalDemandKWhPer1000Scf: 8.8,
  },
];

export function selectProdevalUnit(biogasScfm: number): ProdevalUnitConfig {
  if (biogasScfm <= 500) return PRODEVAL_UNIT_CONFIGS[0];
  if (biogasScfm <= 1000) return PRODEVAL_UNIT_CONFIGS[1];
  return PRODEVAL_UNIT_CONFIGS[2];
}

function roundTo(val: number, decimals: number = 0): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function kWToHP(kw: number): number {
  return roundTo(kw * 1.341, 0);
}

export function getProdevalEquipmentList(
  biogasScfm: number,
  makeId: (suffix?: string) => string,
): ProdevalEquipmentItem[] {
  const unit = selectProdevalUnit(biogasScfm);
  const equipment: ProdevalEquipmentItem[] = [];

  equipment.push({
    id: makeId("prodeval-condenser"),
    process: "Biogas Conditioning",
    equipmentType: "Prodeval VALOGAZ® Condenser",
    description: `Refrigerated condenser for biogas moisture removal — Prodeval FU 100 Drying module, ${unit.numberOfTrains} train(s)`,
    quantity: unit.numberOfTrains,
    specs: {
      manufacturer: { value: "Prodeval", unit: "" },
      model: { value: `VALOGAZ® FU 100 (${unit.modelSize})`, unit: "" },
      gasFlow: { value: String(roundTo(unit.perTrainScfm)), unit: "SCFM per train" },
      totalGasFlow: { value: String(roundTo(unit.perTrainScfm * unit.numberOfTrains)), unit: "SCFM" },
      outletTemp: { value: String(unit.condenserOutletTempF), unit: "°F" },
      dimensionsL: { value: "10", unit: "ft" },
      dimensionsW: { value: "6", unit: "ft" },
      dimensionsH: { value: "8", unit: "ft" },
      power: { value: String(roundTo(Math.max(15, unit.perTrainScfm * 0.06))), unit: "HP" },
    },
    designBasis: "Biogas cooling and moisture knockout to dew point",
    notes: "Includes 2 × chiller units (N+1 redundancy) per train, condensate separator, and condensate collection bottle",
  });

  equipment.push({
    id: makeId("prodeval-blower"),
    process: "Biogas Conditioning",
    equipmentType: "Prodeval VALOGAZ® Blower",
    description: `Positive displacement blower for biogas transport — Prodeval FU 200 Blower module, ${unit.numberOfTrains} train(s)`,
    quantity: unit.numberOfTrains,
    specs: {
      manufacturer: { value: "Prodeval", unit: "" },
      model: { value: `VALOGAZ® FU 200 (${unit.modelSize})`, unit: "" },
      gasFlow: { value: String(roundTo(unit.perTrainScfm)), unit: "SCFM per train" },
      outletPressure: { value: String(unit.blowerOutletPsig), unit: "psig" },
      dimensionsL: { value: "6", unit: "ft" },
      dimensionsW: { value: "4", unit: "ft" },
      dimensionsH: { value: "5", unit: "ft" },
      power: { value: String(roundTo(Math.max(20, unit.perTrainScfm * 0.1))), unit: "HP" },
    },
    designBasis: `Low-pressure transport at ${unit.blowerOutletPsig} psig outlet`,
    notes: "Roots-type PD blower with inlet filter and silencer",
  });

  equipment.push({
    id: makeId("prodeval-ac-filter"),
    process: "Biogas Conditioning",
    equipmentType: "Prodeval VALOPACK® Activated Carbon Filter",
    description: `Activated carbon adsorption for H₂S, siloxane, and VOC removal — Prodeval FU 300 Filtration module, ${unit.numberOfTrains} train(s)`,
    quantity: unit.numberOfTrains,
    specs: {
      manufacturer: { value: "Prodeval", unit: "" },
      model: { value: `VALOPACK® FU 300 (${unit.modelSize})`, unit: "" },
      gasFlow: { value: String(roundTo(unit.perTrainScfm)), unit: "SCFM per train" },
      configuration: { value: "Lead-lag", unit: "" },
      tankVolume: { value: "2,113", unit: "gal (2 × 4 m³ tanks)" },
      operatingPressure: { value: String(unit.acFilterPressurePsig), unit: "psig" },
      h2sRemoval: { value: "99.5", unit: "%" },
      siloxaneRemoval: { value: "95", unit: "%" },
      dimensionsL: { value: "12", unit: "ft" },
      dimensionsW: { value: "6", unit: "ft" },
      dimensionsH: { value: "10", unit: "ft" },
      volume: { value: "2,113", unit: "gal" },
      power: { value: "2", unit: "HP" },
    },
    designBasis: "Lead-lag activated carbon configuration, 2 × 4 m³ vessels per train",
    notes: "Includes dust filter downstream of AC vessels; carbon replacement on breakthrough detection",
  });

  equipment.push({
    id: makeId("prodeval-dust-filter"),
    process: "Biogas Conditioning",
    equipmentType: "Prodeval Dust Filter",
    description: "Particulate filter downstream of activated carbon to protect membrane system",
    quantity: unit.numberOfTrains,
    specs: {
      manufacturer: { value: "Prodeval", unit: "" },
      gasFlow: { value: String(roundTo(unit.perTrainScfm)), unit: "SCFM per train" },
      particleRemoval: { value: "<800", unit: "µm" },
      dimensionsL: { value: "4", unit: "ft" },
      dimensionsW: { value: "3", unit: "ft" },
      dimensionsH: { value: "5", unit: "ft" },
      power: { value: "1", unit: "HP" },
    },
    designBasis: "Protection of downstream membrane modules from particulates",
    notes: "Element replacement on differential pressure indication",
  });

  equipment.push({
    id: makeId("prodeval-mixing-bottle"),
    process: "Gas Upgrading",
    equipmentType: "Prodeval Mixing Bottle",
    description: `Gas mixing vessel combining ${unit.numberOfTrains} conditioning train(s) before compression`,
    quantity: 1,
    specs: {
      manufacturer: { value: "Prodeval", unit: "" },
      model: { value: `VALOPUR® FU 500 (${unit.modelSize})`, unit: "" },
      totalGasFlow: { value: String(roundTo(unit.perTrainScfm * unit.numberOfTrains)), unit: "SCFM" },
      operatingPressure: { value: String(unit.acFilterPressurePsig), unit: "psig" },
      dimensionsL: { value: "4", unit: "ft (dia)" },
      dimensionsW: { value: "4", unit: "ft (dia)" },
      dimensionsH: { value: "6", unit: "ft" },
      volume: { value: "565", unit: "gal" },
      power: { value: "0", unit: "HP" },
    },
    designBasis: "Buffer vessel for flow equalization before membrane compressor",
    notes: "Passive vessel — no moving parts",
  });

  const compressorPowerHP = kWToHP(biogasScfm * 0.25);
  equipment.push({
    id: makeId("prodeval-compressor"),
    process: "Gas Upgrading",
    equipmentType: "Prodeval VALOPUR® Biogas Compressor",
    description: `Multi-stage biogas compressor for membrane feed — Prodeval FU 500 Purification module`,
    quantity: biogasScfm > 600 ? 2 : 1,
    specs: {
      manufacturer: { value: "Prodeval", unit: "" },
      model: { value: `VALOPUR® FU 500 Compressor (${unit.modelSize})`, unit: "" },
      inletFlow: { value: String(roundTo(unit.perTrainScfm * unit.numberOfTrains)), unit: "SCFM" },
      inletPressure: { value: String(unit.acFilterPressurePsig), unit: "psig" },
      outletPressure: { value: String(unit.compressorOutletPsig), unit: "psig" },
      dimensionsL: { value: "10", unit: "ft" },
      dimensionsW: { value: "6", unit: "ft" },
      dimensionsH: { value: "7", unit: "ft" },
      power: { value: String(compressorPowerHP), unit: "HP" },
    },
    designBasis: `Compression from ${unit.acFilterPressurePsig} psig to ${unit.compressorOutletPsig} psig for membrane feed`,
    notes: biogasScfm > 600 ? "2 × compressors (duty + standby)" : "Single compressor with auto-start standby",
  });

  equipment.push({
    id: makeId("prodeval-hp-filter"),
    process: "Gas Upgrading",
    equipmentType: "Prodeval VALOPUR® HP Filtration",
    description: "High-pressure coalescing filter upstream of membrane modules",
    quantity: 1,
    specs: {
      manufacturer: { value: "Prodeval", unit: "" },
      model: { value: `VALOPUR® FU 800 HP Filtration (${unit.modelSize})`, unit: "" },
      gasFlow: { value: String(roundTo(unit.perTrainScfm * unit.numberOfTrains)), unit: "SCFM" },
      operatingPressure: { value: String(unit.compressorOutletPsig), unit: "psig" },
      dimensionsL: { value: "3", unit: "ft (dia)" },
      dimensionsW: { value: "3", unit: "ft (dia)" },
      dimensionsH: { value: "5", unit: "ft" },
      power: { value: "0", unit: "HP" },
    },
    designBasis: "Protect membrane from oil and particulate carryover",
    notes: "Element replacement on differential pressure indication",
  });

  const membraneStages = 3;
  equipment.push({
    id: makeId("prodeval-membrane"),
    process: "Gas Upgrading",
    equipmentType: "Prodeval VALOPUR® Membrane System",
    description: `${membraneStages}-stage membrane separation for CO₂ removal and CH₄ enrichment — Prodeval FU 500 Purification`,
    quantity: 1,
    specs: {
      manufacturer: { value: "Prodeval", unit: "" },
      model: { value: `VALOPUR® FU 500 Membrane (${unit.modelSize})`, unit: "" },
      stages: { value: String(membraneStages), unit: "stages" },
      inletFlow: { value: String(roundTo(unit.perTrainScfm * unit.numberOfTrains)), unit: "SCFM" },
      feedPressure: { value: String(unit.compressorOutletPsig), unit: "psig" },
      productCH4: { value: String(unit.productCH4), unit: "%" },
      methaneRecovery: { value: String(unit.methaneRecovery), unit: "%" },
      rngOutletPressure: { value: String(unit.membranePressurePsig), unit: "psig" },
      dimensionsL: { value: "20", unit: "ft" },
      dimensionsW: { value: "8", unit: "ft" },
      dimensionsH: { value: "10", unit: "ft" },
      power: { value: "5", unit: "HP" },
    },
    designBasis: `${membraneStages}-stage membrane with ${unit.methaneRecovery}% CH₄ recovery, product ≥${unit.productCH4}% CH₄`,
    notes: "Permeate (offgas) routed to flare or thermal oxidizer; condensate bottle for liquid recovery; hydraulic guard for safety",
  });

  const hpCompressorPowerHP = kWToHP(biogasScfm * 0.15);
  equipment.push({
    id: makeId("prodeval-hp-compressor"),
    process: "Gas Upgrading",
    equipmentType: "Prodeval VALOPUR® RNG Compressor",
    description: `High-pressure compressor for RNG pipeline injection — Prodeval FU 800 Compression module`,
    quantity: 1,
    specs: {
      manufacturer: { value: "Prodeval", unit: "" },
      model: { value: `VALOPUR® FU 800 Compressor (${unit.modelSize})`, unit: "" },
      inletPressure: { value: String(unit.membranePressurePsig), unit: "psig" },
      outletPressure: { value: String(unit.rngPressurePsig), unit: "psig" },
      dimensionsL: { value: "8", unit: "ft" },
      dimensionsW: { value: "5", unit: "ft" },
      dimensionsH: { value: "6", unit: "ft" },
      power: { value: String(hpCompressorPowerHP), unit: "HP" },
    },
    designBasis: `Pipeline injection at ${unit.rngPressurePsig} psig`,
    notes: "Includes aftercooler and moisture knockout; HP filtration downstream",
  });

  return equipment;
}

type DesignCriterion = { value: number; unit: string; source: string };

export function getProdevalGasTrainDesignCriteria(biogasScfm: number): { gasConditioning: Record<string, DesignCriterion>; gasUpgrading: Record<string, DesignCriterion> } {
  const unit = selectProdevalUnit(biogasScfm);
  return {
    gasConditioning: {
      h2sRemovalEff: { value: unit.h2sRemovalEff, unit: "%", source: "Prodeval VALOPACK® spec" },
      moistureRemoval: { value: 99, unit: "%", source: "Prodeval VALOGAZ® spec" },
      siloxaneRemoval: { value: 95, unit: "%", source: "Prodeval VALOPACK® AC filter" },
      volumeLoss: { value: unit.volumeLossPct, unit: "%", source: "Prodeval engineering data" },
    },
    gasUpgrading: {
      methaneRecovery: { value: unit.methaneRecovery, unit: "%", source: "Prodeval VALOPUR® membrane spec" },
      productCH4: { value: unit.productCH4, unit: "%", source: "Prodeval VALOPUR® membrane spec" },
      electricalDemand: { value: unit.electricalDemandKWhPer1000Scf, unit: "kWh/1,000 scf raw biogas", source: "Prodeval performance data" },
      pressureOut: { value: unit.rngPressurePsig, unit: "psig", source: "Prodeval VALOPUR® FU 800" },
    },
  };
}

export const PRODEVAL_PROCESS_DESCRIPTION = `Prodeval VALOGAZ®/VALOPACK®/VALOPUR® integrated gas upgrading system:
- FU 100 VALOGAZ® Drying: Refrigerated condenser + separator for moisture removal (outlet ~39°F)
- FU 200 VALOGAZ® Blower: PD blower for gas transport (~2.3 psig)
- FU 300 VALOPACK® Filtration: Lead-lag activated carbon (2×4m³) + dust filter for H₂S/siloxane/VOC removal
- FU 500 VALOPUR® Purification: Mixing bottle → biogas compressor (~200 psig) → 3-stage membrane separation (97% CH₄ recovery)
- FU 800 VALOPUR® Compression: HP compressor + filtration for pipeline injection
Standard unit sizes: 400 SCFM (1 train), 800 SCFM (2 trains), 1,200 SCFM (3 trains). Each train handles ~400 SCFM.`;
