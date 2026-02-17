import type {
  StreamData,
  TreatmentStage,
  RecycleStream,
  EquipmentItem,
  MassBalanceResults,
  UpifRecord,
  FeedstockEntry,
} from "@shared/schema";

const CONVERGENCE_TOLERANCE = 0.01;
const MAX_ITERATIONS = 10;

type DesignCriterion = { value: number; unit: string; source: string };
type DesignCriteria = Record<string, DesignCriterion>;

const DEFAULT_REMOVAL_EFFICIENCIES: Record<string, Record<string, number>> = {
  preliminary: { bod: 0.05, cod: 0.05, tss: 0.05, fog: 0.30, tkn: 0, tp: 0 },
  primary: { bod: 0.30, cod: 0.30, tss: 0.55, fog: 0.65, tkn: 0.10, tp: 0.10 },
  activated_sludge: { bod: 0.90, cod: 0.85, tss: 0.88, fog: 0.90, tkn: 0.30, tp: 0.25 },
  mbr: { bod: 0.95, cod: 0.92, tss: 0.99, fog: 0.95, tkn: 0.40, tp: 0.30 },
  trickling_filter: { bod: 0.80, cod: 0.75, tss: 0.80, fog: 0.80, tkn: 0.20, tp: 0.15 },
  nitrification: { bod: 0.10, cod: 0.10, tss: 0.05, fog: 0, tkn: 0.85, tp: 0.05 },
  denitrification: { bod: 0.05, cod: 0.10, tss: 0.05, fog: 0, tkn: 0.20, tp: 0.10 },
  chemical_phosphorus: { bod: 0, cod: 0.05, tss: 0.10, fog: 0, tkn: 0, tp: 0.85 },
  tertiary_filtration: { bod: 0.30, cod: 0.25, tss: 0.70, fog: 0.30, tkn: 0.05, tp: 0.20 },
  disinfection: { bod: 0, cod: 0, tss: 0, fog: 0, tkn: 0, tp: 0 },
};

const DEFAULT_DESIGN_CRITERIA: Record<string, DesignCriteria> = {
  preliminary: {
    screenBarSpacing: { value: 6, unit: "mm", source: "WEF MOP 8" },
    channelVelocity: { value: 0.9, unit: "m/s", source: "WEF MOP 8" },
    gritRemovalDetentionTime: { value: 3, unit: "min", source: "Ten States Standards" },
  },
  primary: {
    detentionTime: { value: 2, unit: "hr", source: "Ten States Standards" },
    surfaceOverflowRate: { value: 800, unit: "gpd/sf", source: "Ten States Standards" },
    weirLoadingRate: { value: 10000, unit: "gpd/lf", source: "Ten States Standards" },
    sidewaterDepth: { value: 12, unit: "ft", source: "WEF MOP 8" },
  },
  activated_sludge: {
    srt: { value: 10, unit: "days", source: "WEF MOP 8" },
    hrt: { value: 6, unit: "hr", source: "WEF MOP 8" },
    mlss: { value: 3000, unit: "mg/L", source: "WEF MOP 8" },
    fmRatio: { value: 0.3, unit: "lb BOD/lb MLSS·d", source: "WEF MOP 8" },
    oxygenDemand: { value: 1.5, unit: "lb O₂/lb BOD", source: "WEF MOP 8" },
    oxygenTransferEfficiency: { value: 0.25, unit: "fraction", source: "WEF MOP 8" },
    safetyFactor: { value: 1.5, unit: "multiplier", source: "Engineering practice" },
    secondaryClarifierSOR: { value: 600, unit: "gpd/sf", source: "Ten States Standards" },
    secondaryClarifierSLR: { value: 25, unit: "lb/sf·d", source: "Ten States Standards" },
    secondaryClarifierDepth: { value: 14, unit: "ft", source: "WEF MOP 8" },
    rasRatio: { value: 0.5, unit: "fraction", source: "WEF MOP 8" },
  },
  mbr: {
    srt: { value: 15, unit: "days", source: "WEF MOP 8" },
    hrt: { value: 8, unit: "hr", source: "Membrane manufacturer" },
    mlss: { value: 8000, unit: "mg/L", source: "Membrane manufacturer" },
    membraneFlux: { value: 15, unit: "gfd", source: "Membrane manufacturer" },
    oxygenDemand: { value: 1.8, unit: "lb O₂/lb BOD", source: "WEF MOP 8" },
    oxygenTransferEfficiency: { value: 0.20, unit: "fraction", source: "WEF MOP 8" },
    safetyFactor: { value: 1.5, unit: "multiplier", source: "Engineering practice" },
  },
  tertiary_filtration: {
    filtrationRate: { value: 5, unit: "gpm/sf", source: "Ten States Standards" },
    backwashRate: { value: 15, unit: "gpm/sf", source: "WEF MOP 8" },
    mediaDepth: { value: 24, unit: "in", source: "WEF MOP 8" },
  },
  disinfection: {
    contactTime: { value: 30, unit: "min", source: "State regulation" },
    chlorineDose: { value: 8, unit: "mg/L", source: "WEF MOP 8" },
    uvDose: { value: 40, unit: "mJ/cm²", source: "NWRI Guidelines" },
  },
  equalization: {
    detentionTime: { value: 8, unit: "hr", source: "WEF MOP 8" },
    peakFactor: { value: 2.5, unit: "multiplier", source: "Engineering practice" },
  },
};

function parseFlowMGD(upif: UpifRecord): number {
  const feedstocks = (upif.feedstocks || []) as FeedstockEntry[];
  for (const fs of feedstocks) {
    const specs = fs.feedstockSpecs || {};
    for (const [, spec] of Object.entries(specs)) {
      const unitLower = spec.unit.toLowerCase();
      const numVal = parseFloat(String(spec.value).replace(/,/g, ""));
      if (isNaN(numVal)) continue;
      if (unitLower === "mgd" || unitLower.includes("million gallons")) return numVal;
      if (unitLower === "gpd" || unitLower.includes("gallons per day")) return numVal / 1_000_000;
      if (unitLower === "gpm" || unitLower.includes("gallons per minute")) return (numVal * 1440) / 1_000_000;
      if (unitLower.includes("m³/d") || unitLower.includes("m3/d")) return numVal * 0.000264172;
    }
    const volStr = fs.feedstockVolume || "";
    const volNum = parseFloat(volStr.replace(/,/g, ""));
    const unitLower = (fs.feedstockUnit || "").toLowerCase();
    if (!isNaN(volNum)) {
      if (unitLower === "mgd") return volNum;
      if (unitLower === "gpd") return volNum / 1_000_000;
      if (unitLower === "gpm") return (volNum * 1440) / 1_000_000;
    }
  }
  return 1.0;
}

function parseAnalyte(upif: UpifRecord, analyteName: string, defaultValue: number): number {
  const feedstocks = (upif.feedstocks || []) as FeedstockEntry[];
  const patterns = [analyteName.toLowerCase()];
  if (analyteName === "BOD") patterns.push("biochemical oxygen demand", "bod5");
  if (analyteName === "COD") patterns.push("chemical oxygen demand");
  if (analyteName === "TSS") patterns.push("total suspended solids");
  if (analyteName === "FOG") patterns.push("fats oils grease", "oil and grease", "o&g");
  if (analyteName === "TKN") patterns.push("total kjeldahl nitrogen");
  if (analyteName === "TP") patterns.push("total phosphorus", "phosphorus");

  for (const fs of feedstocks) {
    const specs = fs.feedstockSpecs || {};
    for (const [, spec] of Object.entries(specs)) {
      const nameLower = spec.displayName.toLowerCase();
      const unitLower = spec.unit.toLowerCase();
      if (patterns.some(p => nameLower.includes(p)) && unitLower.includes("mg/l")) {
        const val = parseFloat(String(spec.value).replace(/,/g, ""));
        if (!isNaN(val)) return val;
      }
    }
  }
  return defaultValue;
}

function parseEffluentTarget(upif: UpifRecord, analyteName: string): number | null {
  const outputSpecs = upif.outputSpecs as Record<string, Record<string, any>> | null;
  if (!outputSpecs) return null;
  const effluentProfile = "Liquid Effluent - Discharge to WWTP";
  const specs = outputSpecs[effluentProfile];
  if (!specs) return null;
  const target = analyteName.toLowerCase();
  for (const [, spec] of Object.entries(specs)) {
    const displayLower = (spec.displayName || "").toLowerCase();
    if (displayLower.includes(target) && (spec.unit || "").toLowerCase().includes("mg/l")) {
      const val = parseFloat(String(spec.value).replace(/[<>≤≥,]/g, ""));
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

function determineTreatmentTrain(upif: UpifRecord): string[] {
  const location = (upif.location || "").toLowerCase();
  const constraints = (upif.constraints || []).map(c => c.toLowerCase()).join(" ");
  const outputReqs = (upif.outputRequirements || "").toLowerCase();
  const allText = `${location} ${constraints} ${outputReqs}`;

  const stages: string[] = ["preliminary", "equalization", "primary"];

  if (allText.includes("mbr") || allText.includes("membrane")) {
    stages.push("mbr");
  } else if (allText.includes("trickling") || allText.includes("rotating")) {
    stages.push("trickling_filter");
  } else {
    stages.push("activated_sludge");
  }

  const effBod = parseEffluentTarget(upif, "bod");
  const effTss = parseEffluentTarget(upif, "tss");
  if ((effBod !== null && effBod <= 10) || (effTss !== null && effTss <= 10) ||
      allText.includes("tertiary") || allText.includes("filtration")) {
    stages.push("tertiary_filtration");
  }

  const effTkn = parseEffluentTarget(upif, "tkn");
  const effNh3 = parseEffluentTarget(upif, "nh3");
  if ((effTkn !== null && effTkn <= 10) || (effNh3 !== null && effNh3 <= 5) ||
      allText.includes("nitrif") || allText.includes("nitrogen")) {
    if (!stages.includes("mbr")) {
      stages.push("nitrification");
    }
    if (allText.includes("denitrif") || allText.includes("total nitrogen") ||
        (effTkn !== null && effTkn <= 5)) {
      stages.push("denitrification");
    }
  }

  const effTp = parseEffluentTarget(upif, "tp");
  if ((effTp !== null && effTp <= 1) || allText.includes("phosphorus removal")) {
    stages.push("chemical_phosphorus");
  }

  stages.push("disinfection");

  return stages;
}

function applyRemoval(influent: StreamData, efficiencies: Record<string, number>): StreamData {
  return {
    flow: influent.flow,
    bod: influent.bod * (1 - (efficiencies.bod || 0)),
    cod: influent.cod * (1 - (efficiencies.cod || 0)),
    tss: influent.tss * (1 - (efficiencies.tss || 0)),
    tkn: influent.tkn * (1 - (efficiencies.tkn || 0)),
    tp: influent.tp * (1 - (efficiencies.tp || 0)),
    fog: influent.fog * (1 - (efficiencies.fog || 0)),
    nh3: influent.nh3 !== undefined
      ? influent.nh3 * (1 - (efficiencies.tkn || 0))
      : undefined,
    no3: influent.no3,
    unit: "mg/L",
  };
}

function roundTo(val: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function roundStream(s: StreamData): StreamData {
  return {
    flow: roundTo(s.flow, 4),
    bod: roundTo(s.bod),
    cod: roundTo(s.cod),
    tss: roundTo(s.tss),
    tkn: roundTo(s.tkn),
    tp: roundTo(s.tp, 2),
    fog: roundTo(s.fog),
    nh3: s.nh3 !== undefined ? roundTo(s.nh3) : undefined,
    no3: s.no3 !== undefined ? roundTo(s.no3) : undefined,
    unit: s.unit,
  };
}

function calculateRecycleStreams(stages: TreatmentStage[], flowMGD: number): RecycleStream[] {
  const recycleStreams: RecycleStream[] = [];

  const hasAS = stages.some(s => s.type === "activated_sludge" || s.type === "mbr");
  if (hasAS) {
    const rasFlow = flowMGD * 0.5;
    recycleStreams.push({
      name: "Return Activated Sludge (RAS)",
      source: "Secondary Clarifier",
      destination: "Aeration Basin",
      flow: roundTo(rasFlow, 4),
      loads: { tss: roundTo(8000 * rasFlow * 8.34) },
    });

    const wasFlow = flowMGD * 0.01;
    recycleStreams.push({
      name: "Waste Activated Sludge (WAS)",
      source: "Secondary Clarifier",
      destination: "Sludge Processing",
      flow: roundTo(wasFlow, 4),
      loads: { tss: roundTo(10000 * wasFlow * 8.34) },
    });
  }

  const hasTertiary = stages.some(s => s.type === "tertiary_filtration");
  if (hasTertiary) {
    const backwashFlow = flowMGD * 0.03;
    recycleStreams.push({
      name: "Filter Backwash",
      source: "Tertiary Filters",
      destination: "Plant Headworks",
      flow: roundTo(backwashFlow, 4),
      loads: { tss: roundTo(200 * backwashFlow * 8.34) },
    });
  }

  return recycleStreams;
}

function sizeEquipment(
  stages: TreatmentStage[],
  flowMGD: number,
  influent: StreamData,
): EquipmentItem[] {
  const equipment: EquipmentItem[] = [];
  const flowGPD = flowMGD * 1_000_000;
  const flowGPM = flowGPD / 1440;
  const peakFlowGPM = flowGPM * 2.5;
  let eqId = 1;

  const makeId = () => `eq-${eqId++}`;

  for (const stage of stages) {
    const criteria = stage.designCriteria;

    if (stage.type === "preliminary") {
      equipment.push({
        id: makeId(),
        process: "Preliminary Treatment",
        equipmentType: "Mechanical Bar Screen",
        description: "Automatic self-cleaning bar screen for removal of large solids and debris",
        quantity: 2,
        specs: {
          barSpacing: { value: String(criteria.screenBarSpacing?.value || 6), unit: "mm" },
          channelWidth: { value: String(roundTo(flowGPM / 449 / (criteria.channelVelocity?.value || 0.9) * 3.281, 1)), unit: "ft" },
          capacity: { value: String(roundTo(peakFlowGPM)), unit: "gpm" },
        },
        designBasis: "Peak flow with N+1 redundancy",
        notes: "Two units: one duty, one standby",
        isOverridden: false,
        isLocked: false,
      });

      equipment.push({
        id: makeId(),
        process: "Preliminary Treatment",
        equipmentType: "Vortex Grit Chamber",
        description: "Vortex-type grit removal system for removal of inorganic grit and sand",
        quantity: 2,
        specs: {
          detentionTime: { value: String(criteria.gritRemovalDetentionTime?.value || 3), unit: "min" },
          volume: { value: String(roundTo(peakFlowGPM * (criteria.gritRemovalDetentionTime?.value || 3) / 7.481)), unit: "cf" },
          capacity: { value: String(roundTo(peakFlowGPM)), unit: "gpm" },
        },
        designBasis: "Peak flow with N+1 redundancy",
        notes: "Two chambers, one duty, one standby",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (stage.type === "equalization") {
      const eqDT = criteria.detentionTime?.value || 8;
      const eqVolGal = flowGPD * (eqDT / 24);
      equipment.push({
        id: makeId(),
        process: "Flow Equalization",
        equipmentType: "Equalization Basin",
        description: "Concrete basin for flow equalization and load dampening",
        quantity: 1,
        specs: {
          detentionTime: { value: String(eqDT), unit: "hr" },
          volume: { value: String(roundTo(eqVolGal)), unit: "gal" },
          volumeMG: { value: String(roundTo(eqVolGal / 1_000_000, 3)), unit: "MG" },
        },
        designBasis: `${eqDT}-hour detention time at average flow`,
        notes: "Includes submersible mixers and aeration to prevent septicity",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (stage.type === "primary") {
      const sor = criteria.surfaceOverflowRate?.value || 800;
      const areaRequired = flowGPD / sor;
      const diameter = Math.sqrt(areaRequired * 4 / Math.PI);
      const depth = criteria.sidewaterDepth?.value || 12;
      equipment.push({
        id: makeId(),
        process: "Primary Treatment",
        equipmentType: "Primary Clarifier",
        description: "Circular primary clarifier for settleable solids and FOG removal",
        quantity: 2,
        specs: {
          surfaceOverflowRate: { value: String(sor), unit: "gpd/sf" },
          surfaceArea: { value: String(roundTo(areaRequired / 2)), unit: "sf" },
          diameter: { value: String(roundTo(Math.sqrt(areaRequired / 2 * 4 / Math.PI))), unit: "ft" },
          sidewaterDepth: { value: String(depth), unit: "ft" },
          detentionTime: { value: String(criteria.detentionTime?.value || 2), unit: "hr" },
        },
        designBasis: `SOR = ${sor} gpd/sf at average flow, ${depth} ft SWD`,
        notes: "Two clarifiers operating in parallel",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (stage.type === "activated_sludge") {
      const hrt = criteria.hrt?.value || 6;
      const aerationVolGal = flowGPD * (hrt / 24);
      const bodLoad = influent.bod * flowMGD * 8.34;
      const o2demand = bodLoad * (criteria.oxygenDemand?.value || 1.5);
      const ote = criteria.oxygenTransferEfficiency?.value || 0.25;
      const sf = criteria.safetyFactor?.value || 1.5;
      const airRequired = o2demand / ote * sf;

      equipment.push({
        id: makeId(),
        process: "Secondary Treatment - Activated Sludge",
        equipmentType: "Aeration Basin",
        description: "Concrete aeration basin with fine bubble diffusers",
        quantity: 2,
        specs: {
          hrt: { value: String(hrt), unit: "hr" },
          volume: { value: String(roundTo(aerationVolGal / 2)), unit: "gal each" },
          volumeMG: { value: String(roundTo(aerationVolGal / 2_000_000, 3)), unit: "MG each" },
          mlss: { value: String(criteria.mlss?.value || 3000), unit: "mg/L" },
          srt: { value: String(criteria.srt?.value || 10), unit: "days" },
          fmRatio: { value: String(roundTo(criteria.fmRatio?.value || 0.3, 2)), unit: "lb BOD/lb MLSS·d" },
        },
        designBasis: `HRT = ${hrt} hr, SRT = ${criteria.srt?.value || 10} days, MLSS = ${criteria.mlss?.value || 3000} mg/L`,
        notes: "Two basins operating in parallel, fine bubble diffused aeration",
        isOverridden: false,
        isLocked: false,
      });

      const clarSOR = criteria.secondaryClarifierSOR?.value || 600;
      const clarArea = flowGPD / clarSOR;
      equipment.push({
        id: makeId(),
        process: "Secondary Treatment - Activated Sludge",
        equipmentType: "Secondary Clarifier",
        description: "Circular secondary clarifier for mixed liquor separation",
        quantity: 2,
        specs: {
          surfaceOverflowRate: { value: String(clarSOR), unit: "gpd/sf" },
          surfaceArea: { value: String(roundTo(clarArea / 2)), unit: "sf each" },
          diameter: { value: String(roundTo(Math.sqrt(clarArea / 2 * 4 / Math.PI))), unit: "ft" },
          sidewaterDepth: { value: String(criteria.secondaryClarifierDepth?.value || 14), unit: "ft" },
          solidsLoadingRate: { value: String(criteria.secondaryClarifierSLR?.value || 25), unit: "lb/sf·d" },
        },
        designBasis: `SOR = ${clarSOR} gpd/sf at average flow`,
        notes: "Two clarifiers operating in parallel",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (stage.type === "mbr") {
      const hrt = criteria.hrt?.value || 8;
      const aerationVolGal = flowGPD * (hrt / 24);
      const membraneFlux = criteria.membraneFlux?.value || 15;
      const membraneArea = flowGPD / membraneFlux;

      equipment.push({
        id: makeId(),
        process: "Secondary Treatment - MBR",
        equipmentType: "Bioreactor Basin",
        description: "MBR bioreactor basin with submerged membrane modules",
        quantity: 2,
        specs: {
          hrt: { value: String(hrt), unit: "hr" },
          volume: { value: String(roundTo(aerationVolGal / 2)), unit: "gal each" },
          mlss: { value: String(criteria.mlss?.value || 8000), unit: "mg/L" },
          srt: { value: String(criteria.srt?.value || 15), unit: "days" },
        },
        designBasis: `HRT = ${hrt} hr, SRT = ${criteria.srt?.value || 15} days, MLSS = ${criteria.mlss?.value || 8000} mg/L`,
        notes: "Two trains with submerged flat-sheet or hollow-fiber membranes",
        isOverridden: false,
        isLocked: false,
      });

      equipment.push({
        id: makeId(),
        process: "Secondary Treatment - MBR",
        equipmentType: "Membrane Modules",
        description: "Submerged membrane filtration modules",
        quantity: Math.ceil(membraneArea / 5000),
        specs: {
          flux: { value: String(membraneFlux), unit: "gfd" },
          totalArea: { value: String(roundTo(membraneArea)), unit: "sf" },
          moduleArea: { value: "5,000", unit: "sf/module" },
        },
        designBasis: `Net flux = ${membraneFlux} gfd at average flow`,
        notes: "Includes spare capacity for cleaning cycles",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (stage.type === "tertiary_filtration") {
      const filtRate = criteria.filtrationRate?.value || 5;
      const filtArea = flowGPM / filtRate;
      equipment.push({
        id: makeId(),
        process: "Tertiary Treatment",
        equipmentType: "Gravity Media Filter",
        description: "Dual-media gravity filter for tertiary polishing",
        quantity: Math.max(2, Math.ceil(filtArea / 200)),
        specs: {
          filtrationRate: { value: String(filtRate), unit: "gpm/sf" },
          totalArea: { value: String(roundTo(filtArea)), unit: "sf" },
          mediaDepth: { value: String(criteria.mediaDepth?.value || 24), unit: "in" },
          backwashRate: { value: String(criteria.backwashRate?.value || 15), unit: "gpm/sf" },
        },
        designBasis: `Filtration rate = ${filtRate} gpm/sf at average flow`,
        notes: "Multiple cells, one cell out of service during backwash",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (stage.type === "chemical_phosphorus") {
      const doseMg = 50;
      const doseRate = doseMg * flowMGD * 8.34;
      equipment.push({
        id: makeId(),
        process: "Chemical Phosphorus Removal",
        equipmentType: "Chemical Feed System",
        description: "Ferric chloride or alum chemical feed system for phosphorus precipitation",
        quantity: 1,
        specs: {
          chemicalType: { value: "Ferric Chloride (FeCl₃)", unit: "" },
          dose: { value: String(doseMg), unit: "mg/L" },
          feedRate: { value: String(roundTo(doseRate)), unit: "lb/day" },
          storageTank: { value: String(roundTo(doseRate * 30 / 12.0)), unit: "gal" },
        },
        designBasis: `${doseMg} mg/L dose at average flow`,
        notes: "Includes chemical storage, metering pump, and mixing chamber",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (stage.type === "disinfection") {
      const ct = criteria.contactTime?.value || 30;
      const contactVolGal = flowGPM * ct;
      equipment.push({
        id: makeId(),
        process: "Disinfection",
        equipmentType: "UV Disinfection System",
        description: "Open-channel UV disinfection system",
        quantity: 1,
        specs: {
          uvDose: { value: String(criteria.uvDose?.value || 40), unit: "mJ/cm²" },
          contactTime: { value: String(ct), unit: "min" },
          channelVolume: { value: String(roundTo(contactVolGal)), unit: "gal" },
          peakCapacity: { value: String(roundTo(peakFlowGPM)), unit: "gpm" },
        },
        designBasis: `UV dose = ${criteria.uvDose?.value || 40} mJ/cm², contact time = ${ct} min`,
        notes: "Includes redundant UV bank and automatic cleaning system",
        isOverridden: false,
        isLocked: false,
      });
    }
  }

  return equipment;
}

export function calculateMassBalance(upif: UpifRecord): MassBalanceResults {
  const warnings: MassBalanceResults["warnings"] = [];
  const assumptions: MassBalanceResults["assumptions"] = [];

  const flowMGD = parseFlowMGD(upif);
  if (flowMGD <= 0) {
    warnings.push({ field: "Flow", message: "No flow rate found in UPIF; defaulting to 1.0 MGD", severity: "warning" });
  }

  const influent: StreamData = {
    flow: flowMGD,
    bod: parseAnalyte(upif, "BOD", 250),
    cod: parseAnalyte(upif, "COD", 500),
    tss: parseAnalyte(upif, "TSS", 250),
    tkn: parseAnalyte(upif, "TKN", 40),
    tp: parseAnalyte(upif, "TP", 7),
    fog: parseAnalyte(upif, "FOG", 100),
    nh3: parseAnalyte(upif, "NH3", 25),
    no3: 0,
    unit: "mg/L",
  };

  const defaults = ["BOD", "COD", "TSS", "TKN", "TP", "FOG"];
  const defaultVals = [250, 500, 250, 40, 7, 100];
  const parsed = [influent.bod, influent.cod, influent.tss, influent.tkn, influent.tp, influent.fog];
  for (let i = 0; i < defaults.length; i++) {
    if (parsed[i] === defaultVals[i]) {
      assumptions.push({
        parameter: `Influent ${defaults[i]}`,
        value: `${defaultVals[i]} mg/L`,
        source: "Typical municipal wastewater (WEF MOP 8)",
      });
    }
  }

  assumptions.push({
    parameter: "Influent Flow",
    value: `${flowMGD} MGD`,
    source: flowMGD === 1.0 ? "Default assumption" : "Extracted from UPIF",
  });

  const treatmentTrain = determineTreatmentTrain(upif);
  const stages: TreatmentStage[] = [];
  let currentStream = { ...influent };

  for (const stageType of treatmentTrain) {
    if (stageType === "equalization") {
      stages.push({
        name: "Flow Equalization",
        type: "equalization",
        influent: roundStream({ ...currentStream }),
        effluent: roundStream({ ...currentStream }),
        removalEfficiencies: {},
        designCriteria: DEFAULT_DESIGN_CRITERIA.equalization || {},
        notes: ["Equalizes flow and load; no removal assumed"],
      });
      continue;
    }

    const efficiencies = DEFAULT_REMOVAL_EFFICIENCIES[stageType] || {};
    const effluent = applyRemoval(currentStream, efficiencies);

    const stageName = stageType.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());

    stages.push({
      name: stageName,
      type: stageType,
      influent: roundStream({ ...currentStream }),
      effluent: roundStream(effluent),
      removalEfficiencies: efficiencies,
      designCriteria: DEFAULT_DESIGN_CRITERIA[stageType] || {},
      notes: [],
    });

    currentStream = effluent;
  }

  let recycleStreams = calculateRecycleStreams(stages, flowMGD);
  let converged = false;
  let iterations = 0;
  let prevRecycleFlows = recycleStreams.map(r => r.flow);

  for (iterations = 1; iterations <= MAX_ITERATIONS; iterations++) {
    const totalRecycleFlow = recycleStreams
      .filter(r => r.destination.includes("Headworks") || r.destination.includes("Aeration"))
      .reduce((sum, r) => sum + r.flow, 0);

    const adjustedFlow = flowMGD + totalRecycleFlow;
    const adjustedInfluent: StreamData = {
      ...influent,
      flow: adjustedFlow,
      bod: (influent.bod * flowMGD) / adjustedFlow,
      cod: (influent.cod * flowMGD) / adjustedFlow,
      tss: (influent.tss * flowMGD) / adjustedFlow,
      tkn: (influent.tkn * flowMGD) / adjustedFlow,
      tp: (influent.tp * flowMGD) / adjustedFlow,
      fog: (influent.fog * flowMGD) / adjustedFlow,
    };

    let recalcStream = { ...adjustedInfluent };
    for (let i = 0; i < stages.length; i++) {
      if (stages[i].type === "equalization") {
        stages[i].influent = roundStream({ ...recalcStream });
        stages[i].effluent = roundStream({ ...recalcStream });
        continue;
      }
      stages[i].influent = roundStream({ ...recalcStream });
      recalcStream = applyRemoval(recalcStream, stages[i].removalEfficiencies);
      stages[i].effluent = roundStream(recalcStream);
    }

    recycleStreams = calculateRecycleStreams(stages, adjustedFlow);
    const currentRecycleFlows = recycleStreams.map(r => r.flow);

    const maxDelta = Math.max(
      ...prevRecycleFlows.map((prev, idx) => {
        const curr = currentRecycleFlows[idx] || 0;
        return prev === 0 ? (curr === 0 ? 0 : 1) : Math.abs(curr - prev) / prev;
      }),
      0,
    );

    if (maxDelta < CONVERGENCE_TOLERANCE) {
      converged = true;
      break;
    }
    prevRecycleFlows = currentRecycleFlows;
  }

  const equipment = sizeEquipment(stages, flowMGD, influent);

  const finalEffluent = stages[stages.length - 1]?.effluent;
  if (finalEffluent) {
    const targets = [
      { name: "BOD", target: parseEffluentTarget(upif, "bod"), actual: finalEffluent.bod },
      { name: "TSS", target: parseEffluentTarget(upif, "tss"), actual: finalEffluent.tss },
      { name: "TKN", target: parseEffluentTarget(upif, "tkn"), actual: finalEffluent.tkn },
      { name: "TP", target: parseEffluentTarget(upif, "tp"), actual: finalEffluent.tp },
    ];
    for (const t of targets) {
      if (t.target !== null && t.actual > t.target) {
        warnings.push({
          field: t.name,
          message: `Predicted effluent ${t.name} (${roundTo(t.actual)} mg/L) exceeds target (${t.target} mg/L). Additional treatment may be required.`,
          severity: "warning",
        });
      }
    }
  }

  return {
    projectType: "A",
    stages,
    adStages: [],
    recycleStreams,
    equipment,
    convergenceIterations: iterations,
    convergenceAchieved: converged,
    assumptions,
    warnings,
    summary: {},
  };
}
