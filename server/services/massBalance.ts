import type {
  StreamData,
  TreatmentStage,
  RecycleStream,
  EquipmentItem,
  ADProcessStage,
  MassBalanceResults,
  UpifRecord,
  FeedstockEntry,
} from "@shared/schema";
import {
  selectProdevalUnit,
  getProdevalEquipmentList,
  getProdevalGasTrainDesignCriteria,
} from "@shared/prodeval-equipment-library";

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
  // Industrial pretreatment process types
  daf: { bod: 0.30, cod: 0.25, tss: 0.85, fog: 0.95, tkn: 0.05, tp: 0.15 },
  anaerobic_pretreatment: { bod: 0.85, cod: 0.80, tss: 0.60, fog: 0.80, tkn: 0.15, tp: 0.10 },
  chemical_precipitation: { bod: 0.15, cod: 0.20, tss: 0.80, fog: 0.40, tkn: 0.05, tp: 0.85 },
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
  // Industrial pretreatment process design criteria
  daf: {
    riseRate: { value: 4, unit: "gpm/sf", source: "Ludwigson, Industrial Pretreatment Design" },
    recycleRatio: { value: 0.30, unit: "fraction", source: "Ludwigson, Industrial Pretreatment Design" },
    pressure: { value: 60, unit: "psi", source: "Equipment manufacturer" },
    retentionTime: { value: 30, unit: "min", source: "Ludwigson, Industrial Pretreatment Design" },
    asRatio: { value: 0.02, unit: "mL/mL", source: "Ludwigson, Industrial Pretreatment Design" },
  },
  anaerobic_pretreatment: {
    olr: { value: 6, unit: "kg COD/m³·d", source: "Ludwigson, Industrial Pretreatment Design" },
    hrt: { value: 8, unit: "hr", source: "Ludwigson, Industrial Pretreatment Design" },
    temperature: { value: 35, unit: "°C", source: "Ludwigson, Industrial Pretreatment Design" },
    gasProduction: { value: 0.35, unit: "m³ CH₄/kg COD removed", source: "Ludwigson, Industrial Pretreatment Design" },
  },
  chemical_precipitation: {
    chemicalDose: { value: 200, unit: "mg/L", source: "Ludwigson, Industrial Pretreatment Design" },
    targetPh: { value: 8.5, unit: "pH", source: "Ludwigson, Industrial Pretreatment Design" },
    mixingIntensity: { value: 300, unit: "s⁻¹", source: "Ludwigson, Industrial Pretreatment Design" },
    settlingRate: { value: 600, unit: "gpd/sf", source: "Ludwigson, Industrial Pretreatment Design" },
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

  // Parse influent values to drive pollutant-aware process selection
  const influentCod = parseAnalyte(upif, "COD") ?? 8000;
  const influentFog = parseAnalyte(upif, "FOG") ?? 500;
  const influentBod = parseAnalyte(upif, "BOD") ?? 4000;

  // Industrial pretreatment process selection — based on pollutant loads, NOT municipal defaults
  if (allText.includes("mbr") || allText.includes("membrane")) {
    stages.push("mbr");
  } else if (allText.includes("trickling") || allText.includes("rotating")) {
    stages.push("trickling_filter");
  } else if (allText.includes("activated sludge") || allText.includes("cas")) {
    stages.push("activated_sludge");
  } else if (influentFog > 200) {
    // FOG-dominant waste stream → DAF is primary treatment
    stages.push("daf");
    if (influentCod > 4000) {
      // High COD remaining after DAF → anaerobic pretreatment
      stages.push("anaerobic_pretreatment");
    }
  } else if (influentCod > 4000 || influentBod > 3000) {
    // High-strength organic waste → anaerobic pretreatment
    stages.push("anaerobic_pretreatment");
  } else if (allText.includes("metal") || allText.includes("precip")) {
    stages.push("chemical_precipitation");
  } else {
    // Industrial default: DAF (NOT activated sludge)
    stages.push("daf");
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

  // Disinfection ONLY if explicitly mentioned — POTW discharge does not require it
  if (allText.includes("disinfection") || allText.includes("uv") || allText.includes("chlorin")) {
    stages.push("disinfection");
  }

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

function kWToHP(kw: number): number {
  return roundTo(kw * 1.341);
}

function galToFt3(gal: number): number {
  return roundTo(gal / 7.481);
}

function cylinderDimensions(volumeGal: number, aspectRatio: number = 1.5): { diameter: number; height: number } {
  const volumeFt3 = volumeGal / 7.481;
  const diameter = roundTo(Math.pow((4 * volumeFt3) / (Math.PI * aspectRatio), 1 / 3));
  const height = roundTo(diameter * aspectRatio);
  return { diameter, height };
}

function rectDimensions(volumeGal: number, depthFt: number = 8): { length: number; width: number; height: number } {
  const volumeFt3 = volumeGal / 7.481;
  const footprint = volumeFt3 / depthFt;
  const width = roundTo(Math.sqrt(footprint / 2));
  const length = roundTo(width * 2);
  return { length, width, height: depthFt };
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
          dimensionsL: { value: "8", unit: "ft" },
          dimensionsW: { value: "4", unit: "ft" },
          dimensionsH: { value: "6", unit: "ft" },
          power: { value: "2", unit: "HP" },
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
        specs: (() => {
          const gritVolGal = roundTo(peakFlowGPM * (criteria.gritRemovalDetentionTime?.value || 3));
          const gritDims = cylinderDimensions(gritVolGal);
          return {
            detentionTime: { value: String(criteria.gritRemovalDetentionTime?.value || 3), unit: "min" },
            volume: { value: String(gritVolGal), unit: "gal" },
            capacity: { value: String(roundTo(peakFlowGPM)), unit: "gpm" },
            dimensionsL: { value: String(gritDims.diameter), unit: "ft (dia)" },
            dimensionsW: { value: String(gritDims.diameter), unit: "ft (dia)" },
            dimensionsH: { value: String(gritDims.height), unit: "ft" },
            power: { value: "3", unit: "HP" },
          };
        })(),
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
        specs: (() => {
          const eqDims = rectDimensions(eqVolGal, 12);
          const eqMixHP = roundTo(eqVolGal * 0.01 / 1000);
          return {
            detentionTime: { value: String(eqDT), unit: "hr" },
            volume: { value: String(roundTo(eqVolGal)), unit: "gal" },
            volumeMG: { value: String(roundTo(eqVolGal / 1_000_000, 3)), unit: "MG" },
            dimensionsL: { value: String(eqDims.length), unit: "ft" },
            dimensionsW: { value: String(eqDims.width), unit: "ft" },
            dimensionsH: { value: String(eqDims.height), unit: "ft" },
            power: { value: String(eqMixHP), unit: "HP" },
          };
        })(),
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
        specs: (() => {
          const primDia = roundTo(Math.sqrt(areaRequired / 2 * 4 / Math.PI));
          const primVolGal = roundTo(Math.PI * Math.pow(primDia / 2, 2) * depth * 7.481);
          return {
            surfaceOverflowRate: { value: String(sor), unit: "gpd/sf" },
            surfaceArea: { value: String(roundTo(areaRequired / 2)), unit: "sf" },
            diameter: { value: String(primDia), unit: "ft" },
            sidewaterDepth: { value: String(depth), unit: "ft" },
            detentionTime: { value: String(criteria.detentionTime?.value || 2), unit: "hr" },
            volume: { value: String(primVolGal), unit: "gal" },
            dimensionsL: { value: String(primDia), unit: "ft (dia)" },
            dimensionsW: { value: String(primDia), unit: "ft (dia)" },
            dimensionsH: { value: String(depth), unit: "ft" },
            power: { value: "1", unit: "HP" },
          };
        })(),
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
        specs: (() => {
          const aerDims = rectDimensions(aerationVolGal / 2, 15);
          const blowerHP = roundTo(airRequired / 100);
          return {
            hrt: { value: String(hrt), unit: "hr" },
            volume: { value: String(roundTo(aerationVolGal / 2)), unit: "gal" },
            volumeMG: { value: String(roundTo(aerationVolGal / 2_000_000, 3)), unit: "MG" },
            mlss: { value: String(criteria.mlss?.value || 3000), unit: "mg/L" },
            srt: { value: String(criteria.srt?.value || 10), unit: "days" },
            fmRatio: { value: String(roundTo(criteria.fmRatio?.value || 0.3, 2)), unit: "lb BOD/lb MLSS·d" },
            dimensionsL: { value: String(aerDims.length), unit: "ft" },
            dimensionsW: { value: String(aerDims.width), unit: "ft" },
            dimensionsH: { value: String(aerDims.height), unit: "ft" },
            power: { value: String(blowerHP), unit: "HP" },
          };
        })(),
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
        specs: (() => {
          const secDia = roundTo(Math.sqrt(clarArea / 2 * 4 / Math.PI));
          const secDepth = criteria.secondaryClarifierDepth?.value || 14;
          const secVolGal = roundTo(Math.PI * Math.pow(secDia / 2, 2) * secDepth * 7.481);
          return {
            surfaceOverflowRate: { value: String(clarSOR), unit: "gpd/sf" },
            surfaceArea: { value: String(roundTo(clarArea / 2)), unit: "sf each" },
            diameter: { value: String(secDia), unit: "ft" },
            sidewaterDepth: { value: String(secDepth), unit: "ft" },
            solidsLoadingRate: { value: String(criteria.secondaryClarifierSLR?.value || 25), unit: "lb/sf·d" },
            volume: { value: String(secVolGal), unit: "gal" },
            dimensionsL: { value: String(secDia), unit: "ft (dia)" },
            dimensionsW: { value: String(secDia), unit: "ft (dia)" },
            dimensionsH: { value: String(secDepth), unit: "ft" },
            power: { value: "1", unit: "HP" },
          };
        })(),
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
        specs: (() => {
          const mbrDims = rectDimensions(aerationVolGal / 2, 15);
          const mbrBodLoad = influent.bod * flowMGD * 8.34;
          const mbrO2 = mbrBodLoad * (criteria.oxygenDemand?.value || 1.8);
          const mbrOte = criteria.oxygenTransferEfficiency?.value || 0.20;
          const mbrSf = criteria.safetyFactor?.value || 1.5;
          const mbrAirReq = mbrO2 / mbrOte * mbrSf;
          const mbrBlowerHP = roundTo(mbrAirReq / 100);
          return {
            hrt: { value: String(hrt), unit: "hr" },
            volume: { value: String(roundTo(aerationVolGal / 2)), unit: "gal" },
            mlss: { value: String(criteria.mlss?.value || 8000), unit: "mg/L" },
            srt: { value: String(criteria.srt?.value || 15), unit: "days" },
            dimensionsL: { value: String(mbrDims.length), unit: "ft" },
            dimensionsW: { value: String(mbrDims.width), unit: "ft" },
            dimensionsH: { value: String(mbrDims.height), unit: "ft" },
            power: { value: String(mbrBlowerHP), unit: "HP" },
          };
        })(),
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
        specs: (() => {
          const numModules = Math.ceil(membraneArea / 5000);
          return {
            flux: { value: String(membraneFlux), unit: "gfd" },
            totalArea: { value: String(roundTo(membraneArea)), unit: "sf" },
            moduleArea: { value: "5,000", unit: "sf/module" },
            dimensionsL: { value: "8", unit: "ft" },
            dimensionsW: { value: "4", unit: "ft" },
            dimensionsH: { value: "6", unit: "ft" },
            power: { value: String(roundTo(numModules * 5)), unit: "HP" },
          };
        })(),
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
        specs: (() => {
          const numCells = Math.max(2, Math.ceil(filtArea / 200));
          const cellArea = filtArea / numCells;
          const cellWidth = roundTo(Math.sqrt(cellArea));
          const cellLength = roundTo(cellArea / cellWidth);
          const mediaDepthFt = roundTo((criteria.mediaDepth?.value || 24) / 12);
          const filtDepth = roundTo(mediaDepthFt + 3);
          const cellVolGal = roundTo(cellWidth * cellLength * filtDepth * 7.481);
          return {
            filtrationRate: { value: String(filtRate), unit: "gpm/sf" },
            totalArea: { value: String(roundTo(filtArea)), unit: "sf" },
            mediaDepth: { value: String(criteria.mediaDepth?.value || 24), unit: "in" },
            backwashRate: { value: String(criteria.backwashRate?.value || 15), unit: "gpm/sf" },
            volume: { value: String(cellVolGal), unit: "gal" },
            dimensionsL: { value: String(cellLength), unit: "ft" },
            dimensionsW: { value: String(cellWidth), unit: "ft" },
            dimensionsH: { value: String(filtDepth), unit: "ft" },
            power: { value: "3", unit: "HP" },
          };
        })(),
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
          dimensionsL: { value: "8", unit: "ft" },
          dimensionsW: { value: "6", unit: "ft" },
          dimensionsH: { value: "8", unit: "ft" },
          power: { value: "2", unit: "HP" },
        },
        designBasis: `${doseMg} mg/L dose at average flow`,
        notes: "Includes chemical storage, metering pump, and mixing chamber",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (stage.type === "daf") {
      const riseRate = criteria.riseRate?.value || 4;
      const dafArea = flowGPM / riseRate;
      const recycleRatio = criteria.recycleRatio?.value || 0.30;
      const retTime = criteria.retentionTime?.value || 30;
      const dafVolGal = flowGPM * retTime * (1 + recycleRatio);
      equipment.push({
        id: makeId(),
        process: "Industrial Pretreatment - DAF",
        equipmentType: "Dissolved Air Flotation Unit",
        description: "Pressurized dissolved air flotation system for FOG and TSS removal",
        quantity: Math.max(1, Math.ceil(dafArea / 400)),
        specs: (() => {
          const numUnits = Math.max(1, Math.ceil(dafArea / 400));
          const unitArea = dafArea / numUnits;
          const unitWidth = roundTo(Math.sqrt(unitArea / 3));
          const unitLength = roundTo(unitWidth * 3);
          return {
            riseRate: { value: String(riseRate), unit: "gpm/sf" },
            totalSurfaceArea: { value: String(roundTo(dafArea)), unit: "sf" },
            recycleRatio: { value: String(roundTo(recycleRatio * 100)), unit: "%" },
            pressure: { value: String(criteria.pressure?.value || 60), unit: "psi" },
            retentionTime: { value: String(retTime), unit: "min" },
            volume: { value: String(roundTo(dafVolGal)), unit: "gal" },
            dimensionsL: { value: String(unitLength), unit: "ft" },
            dimensionsW: { value: String(unitWidth), unit: "ft" },
            dimensionsH: { value: "8", unit: "ft" },
            power: { value: String(roundTo(flowGPM * 0.05)), unit: "HP" },
          };
        })(),
        designBasis: `Rise rate = ${riseRate} gpm/sf, ${roundTo(recycleRatio * 100)}% recycle, ${retTime} min retention`,
        notes: "Includes saturator, recycle pump, air compressor, and skimmer. Designed for high FOG and TSS removal in industrial pretreatment.",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (stage.type === "anaerobic_pretreatment") {
      const hrt = criteria.hrt?.value || 8;
      const reactorVolGal = flowGPD * (hrt / 24);
      const olr = criteria.olr?.value || 6;
      const codLoadKg = influent.cod * flowMGD * 3.785 * 1000 / 1_000_000;
      const gasRate = criteria.gasProduction?.value || 0.35;
      const codRemoved = influent.cod * (DEFAULT_REMOVAL_EFFICIENCIES.anaerobic_pretreatment?.cod || 0.80);
      const methaneProduction = roundTo(codRemoved * flowMGD * 3.785 * gasRate, 1);
      equipment.push({
        id: makeId(),
        process: "Industrial Pretreatment - Anaerobic",
        equipmentType: "Anaerobic Reactor (UASB/IC/EGSB)",
        description: "High-rate anaerobic reactor for high-strength organic waste pretreatment with biogas recovery",
        quantity: Math.max(1, Math.ceil(reactorVolGal / 500_000)),
        specs: (() => {
          const numReactors = Math.max(1, Math.ceil(reactorVolGal / 500_000));
          const unitVolGal = reactorVolGal / numReactors;
          const reactorDims = rectDimensions(unitVolGal, 25);
          return {
            hrt: { value: String(hrt), unit: "hr" },
            olr: { value: String(olr), unit: "kg COD/m³·d" },
            volume: { value: String(roundTo(unitVolGal)), unit: "gal" },
            volumeMG: { value: String(roundTo(unitVolGal / 1_000_000, 3)), unit: "MG" },
            temperature: { value: String(criteria.temperature?.value || 35), unit: "°C" },
            methaneProduction: { value: String(methaneProduction), unit: "m³ CH₄/day" },
            dimensionsL: { value: String(reactorDims.length), unit: "ft" },
            dimensionsW: { value: String(reactorDims.width), unit: "ft" },
            dimensionsH: { value: String(reactorDims.height), unit: "ft" },
            power: { value: String(roundTo(reactorVolGal / 50_000)), unit: "HP" },
          };
        })(),
        designBasis: `HRT = ${hrt} hr, OLR = ${olr} kg COD/m³·d, ${criteria.temperature?.value || 35}°C mesophilic`,
        notes: "High-rate anaerobic technology (UASB, IC, or EGSB). Includes biogas collection, flare, and heat exchanger for temperature control.",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (stage.type === "chemical_precipitation") {
      const chemDose = criteria.chemicalDose?.value || 200;
      const doseRate = chemDose * flowMGD * 8.34;
      const settlingRate = criteria.settlingRate?.value || 600;
      const clarArea = flowGPD / settlingRate;

      equipment.push({
        id: makeId(),
        process: "Industrial Pretreatment - Chemical Precipitation",
        equipmentType: "Rapid Mix / Flocculation Tank",
        description: "Chemical feed, rapid mix, and flocculation system for metals/solids precipitation",
        quantity: 1,
        specs: (() => {
          const mixVolGal = flowGPM * 2;
          const flocVolGal = flowGPM * 20;
          const flocDims = rectDimensions(flocVolGal, 12);
          return {
            chemicalDose: { value: String(chemDose), unit: "mg/L" },
            chemicalFeedRate: { value: String(roundTo(doseRate)), unit: "lb/day" },
            targetPh: { value: String(criteria.targetPh?.value || 8.5), unit: "pH" },
            mixingIntensity: { value: String(criteria.mixingIntensity?.value || 300), unit: "s⁻¹" },
            rapidMixVolume: { value: String(roundTo(mixVolGal)), unit: "gal" },
            flocculationVolume: { value: String(roundTo(flocVolGal)), unit: "gal" },
            dimensionsL: { value: String(flocDims.length), unit: "ft" },
            dimensionsW: { value: String(flocDims.width), unit: "ft" },
            dimensionsH: { value: String(flocDims.height), unit: "ft" },
            power: { value: String(roundTo(flocVolGal / 5000 + 2)), unit: "HP" },
          };
        })(),
        designBasis: `${chemDose} mg/L dose, G = ${criteria.mixingIntensity?.value || 300} s⁻¹, 20-min flocculation`,
        notes: "Includes chemical storage tanks, metering pumps, pH control, and polymer system",
        isOverridden: false,
        isLocked: false,
      });

      equipment.push({
        id: makeId(),
        process: "Industrial Pretreatment - Chemical Precipitation",
        equipmentType: "Clarifier / Settling Basin",
        description: "Circular clarifier for settling chemically precipitated solids",
        quantity: Math.max(1, Math.ceil(clarArea / 2000)),
        specs: (() => {
          const numClarifiers = Math.max(1, Math.ceil(clarArea / 2000));
          const unitArea = clarArea / numClarifiers;
          const clarDia = roundTo(Math.sqrt(unitArea * 4 / Math.PI));
          const clarDepth = 12;
          const clarVolGal = roundTo(Math.PI * Math.pow(clarDia / 2, 2) * clarDepth * 7.481);
          return {
            settlingRate: { value: String(settlingRate), unit: "gpd/sf" },
            surfaceArea: { value: String(roundTo(unitArea)), unit: "sf" },
            diameter: { value: String(clarDia), unit: "ft" },
            sidewaterDepth: { value: String(clarDepth), unit: "ft" },
            volume: { value: String(clarVolGal), unit: "gal" },
            dimensionsL: { value: String(clarDia), unit: "ft (dia)" },
            dimensionsW: { value: String(clarDia), unit: "ft (dia)" },
            dimensionsH: { value: String(clarDepth), unit: "ft" },
            power: { value: "2", unit: "HP" },
          };
        })(),
        designBasis: `Settling rate = ${settlingRate} gpd/sf at average flow`,
        notes: "Includes sludge scraper mechanism and scum baffle",
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
        specs: (() => {
          const uvDims = rectDimensions(contactVolGal, 3);
          const uvDoseVal = criteria.uvDose?.value || 40;
          const uvPowerKW = roundTo(uvDoseVal * flowGPM * 0.001, 1);
          const uvPowerHP = kWToHP(uvPowerKW);
          return {
            uvDose: { value: String(uvDoseVal), unit: "mJ/cm²" },
            contactTime: { value: String(ct), unit: "min" },
            channelVolume: { value: String(roundTo(contactVolGal)), unit: "gal" },
            peakCapacity: { value: String(roundTo(peakFlowGPM)), unit: "gpm" },
            volume: { value: String(roundTo(contactVolGal)), unit: "gal" },
            dimensionsL: { value: String(uvDims.length), unit: "ft" },
            dimensionsW: { value: String(uvDims.width), unit: "ft" },
            dimensionsH: { value: String(uvDims.height), unit: "ft" },
            power: { value: String(uvPowerHP), unit: "HP" },
          };
        })(),
        designBasis: `UV dose = ${criteria.uvDose?.value || 40} mJ/cm², contact time = ${ct} min`,
        notes: "Includes redundant UV bank and automatic cleaning system",
        isOverridden: false,
        isLocked: false,
      });
    }
  }

  equipment.push({
    id: makeId(),
    process: "Solids Handling",
    equipmentType: "Sludge Dewatering",
    description: "Mechanical sludge dewatering system (belt filter press or screw press)",
    quantity: 1,
    specs: {
      capacity: { value: String(roundTo(flowMGD * 0.01 * 1_000_000 / 1440)), unit: "gpm" },
      dimensionsL: { value: "12", unit: "ft" },
      dimensionsW: { value: "5", unit: "ft" },
      dimensionsH: { value: "6", unit: "ft" },
      power: { value: "25", unit: "HP" },
    },
    designBasis: "Sized for waste sludge processing",
    notes: "Includes polymer feed system and sludge cake conveyor",
    isOverridden: false,
    isLocked: false,
  });

  return equipment;
}

function projectIncludesRNG(upif: UpifRecord): boolean {
  const text = [
    upif.outputRequirements || "",
    JSON.stringify(upif.outputSpecs || {}),
    (upif.constraints || []).join(" "),
    (upif as any).projectDescription || "",
  ].join(" ").toLowerCase();
  return text.includes("rng") ||
    text.includes("renewable natural gas") ||
    text.includes("pipeline injection") ||
    text.includes("biomethane") ||
    text.includes("upgraded biogas") ||
    text.includes("pipeline-quality") ||
    text.includes("pipeline gas") ||
    text.includes("biogas upgrading");
}

function calculateTypeADigestionAndGasTrain(
  upif: UpifRecord,
  flowMGD: number,
  influent: StreamData,
): {
  adStages: ADProcessStage[];
  equipment: EquipmentItem[];
  assumptions: Array<{ parameter: string; value: string; source: string }>;
  warnings: MassBalanceResults["warnings"];
  summary: Record<string, any>;
} {
  const adStages: ADProcessStage[] = [];
  const equipment: EquipmentItem[] = [];
  const assumptions: Array<{ parameter: string; value: string; source: string }> = [];
  const warnings: MassBalanceResults["warnings"] = [];
  const summary: Record<string, any> = {};
  let eqId = 100;
  const makeId = (suffix?: string) => `eq-ad-${suffix || eqId++}`;

  const bodLoadLbPerDay = influent.bod * flowMGD * 8.34;
  const codLoadLbPerDay = influent.cod * flowMGD * 8.34;
  const tssLoadLbPerDay = influent.tss * flowMGD * 8.34;

  const primarySludgeTSS = tssLoadLbPerDay * 0.55;
  const wasSludgeTSS = bodLoadLbPerDay * 0.40;
  const totalSludgeLbPerDay = primarySludgeTSS + wasSludgeTSS;
  const sludgeTpd = totalSludgeLbPerDay / 2000;

  const vsContentPct = 75;
  const vsLbPerDay = totalSludgeLbPerDay * (vsContentPct / 100);
  const tsContentPct = 4;
  const sludgeGPD = (totalSludgeLbPerDay / (tsContentPct / 100)) / 8.34;

  const hrt = 20;
  const temperature = 37;
  const vsDestruction = 55;
  const gasYield = 15;
  const ch4Content = 63;
  const co2Content = 35;
  const h2sContentPpmv = 800;

  assumptions.push(
    { parameter: "Sludge VS Content", value: `${vsContentPct}%`, source: "Typical WWT sludge (WEF MOP 8)" },
    { parameter: "Sludge TS Content", value: `${tsContentPct}%`, source: "Typical combined sludge (WEF MOP 8)" },
    { parameter: "Digester HRT", value: `${hrt} days`, source: "Mesophilic AD design practice" },
    { parameter: "VS Destruction", value: `${vsDestruction}%`, source: "WEF MOP 8 typical for WWT sludge" },
    { parameter: "Biogas Yield", value: `${gasYield} scf/lb VS destroyed`, source: "WEF MOP 8" },
    { parameter: "Biogas CH₄ Content", value: `${ch4Content}%`, source: "Typical WWT sludge biogas" },
  );

  const vsDestroyedLbPerDay = vsLbPerDay * (vsDestruction / 100);
  const biogasScfPerDay = vsDestroyedLbPerDay * gasYield;
  const biogasScfm = biogasScfPerDay / 1440;

  const ch4ScfPerDay = biogasScfPerDay * (ch4Content / 100);
  const biogasMMBtuPerDay = ch4ScfPerDay * 1012 / 1_000_000;

  const digesterVolGal = sludgeGPD * hrt;
  const digesterVolFt3 = digesterVolGal / 7.481;
  const headspacePct = 12;
  const totalVolFt3 = digesterVolFt3 / (1 - headspacePct / 100);
  const digesterDia = roundTo(Math.pow((4 * totalVolFt3) / (Math.PI * 1.0), 1 / 3));
  const digesterH = roundTo(digesterDia * 1.0);
  const mixingPower = 6;
  const mixingHP = kWToHP(mixingPower * digesterVolFt3 * 0.0283168 / 1000);

  const digestionStage: ADProcessStage = {
    name: "Anaerobic Digestion (Sludge)",
    type: "digestion",
    inputStream: {
      sludgeFlow: { value: roundTo(sludgeGPD), unit: "GPD" },
      totalSolids: { value: roundTo(tsContentPct, 1), unit: "% TS" },
      volatileSolids: { value: roundTo(vsContentPct), unit: "% VS" },
      vsLoad: { value: roundTo(vsLbPerDay), unit: "lb VS/day" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(biogasScfm), unit: "SCFM" },
      biogasScfPerDay: { value: roundTo(biogasScfPerDay), unit: "scf/day" },
      ch4Content: { value: ch4Content, unit: "%" },
      co2Content: { value: co2Content, unit: "%" },
      h2s: { value: h2sContentPpmv, unit: "ppmv" },
      energyContent: { value: roundTo(biogasMMBtuPerDay, 1), unit: "MMBTU/day" },
      vsDestruction: { value: vsDestruction, unit: "%" },
    },
    designCriteria: {
      hrt: { value: hrt, unit: "days", source: "WEF MOP 8" },
      temperature: { value: temperature, unit: "°C", source: "Mesophilic standard" },
      vsDestruction: { value: vsDestruction, unit: "%", source: "WEF MOP 8" },
      gasYield: { value: gasYield, unit: "scf/lb VS destroyed", source: "WEF MOP 8" },
      ch4Content: { value: ch4Content, unit: "%", source: "Typical WWT sludge biogas" },
      mixingPower: { value: mixingPower, unit: "W/m³", source: "WEF MOP 8" },
    },
    notes: [
      `Primary + WAS sludge: ${roundTo(sludgeTpd, 1)} tons/day`,
      `Biogas production: ${roundTo(biogasScfPerDay)} scf/day (${roundTo(biogasScfm)} SCFM)`,
      `Energy content: ${roundTo(biogasMMBtuPerDay, 1)} MMBTU/day`,
    ],
  };
  adStages.push(digestionStage);

  equipment.push({
    id: makeId("digester"),
    process: "Anaerobic Digestion",
    equipmentType: "Anaerobic Digester",
    description: "Mesophilic CSTR anaerobic digester for sludge stabilization and biogas production",
    quantity: 1,
    specs: {
      volume: { value: String(roundTo(digesterVolGal)), unit: "gal" },
      hrt: { value: String(hrt), unit: "days" },
      temperature: { value: String(temperature), unit: "°C" },
      dimensionsL: { value: String(digesterDia), unit: "ft (dia)" },
      dimensionsW: { value: String(digesterDia), unit: "ft (dia)" },
      dimensionsH: { value: String(digesterH), unit: "ft" },
      power: { value: String(mixingHP), unit: "HP" },
    },
    designBasis: `${hrt}-day HRT, mesophilic (${temperature}°C), ${mixingPower} W/m³ mixing`,
    notes: "Includes gas collection, safety relief, and foam control systems",
    isOverridden: false,
    isLocked: false,
  });

  const prodevDesign = getProdevalGasTrainDesignCriteria(biogasScfm);
  const prodevUnit = selectProdevalUnit(biogasScfm);

  const h2sRemovalEff = prodevDesign.gasConditioning.h2sRemovalEff.value / 100;
  const outH2sPpmv = h2sContentPpmv * (1 - h2sRemovalEff);
  const volumeLossPct = prodevDesign.gasConditioning.volumeLoss.value / 100;
  const conditionedScfm = biogasScfm * (1 - volumeLossPct);

  const conditioningStage: ADProcessStage = {
    name: "Biogas Conditioning (Prodeval)",
    type: "gasConditioning",
    inputStream: {
      biogasFlow: { value: roundTo(biogasScfm), unit: "SCFM" },
      ch4: { value: ch4Content, unit: "%" },
      co2: { value: co2Content, unit: "%" },
      h2s: { value: h2sContentPpmv, unit: "ppmv" },
    },
    outputStream: {
      biogasFlow: { value: roundTo(conditionedScfm), unit: "SCFM" },
      h2s: { value: roundTo(outH2sPpmv, 1), unit: "ppmv" },
      moisture: { value: 0, unit: "dry" },
    },
    designCriteria: prodevDesign.gasConditioning,
    notes: [
      `Prodeval VALOGAZ® FU 100/200 + VALOPACK® FU 300 — ${prodevUnit.numberOfTrains} train(s)`,
      `H₂S removal: ${h2sContentPpmv} → ${roundTo(outH2sPpmv, 1)} ppmv (${roundTo(h2sRemovalEff * 100)}%)`,
      "Moisture removal via refrigerated condenser to 39°F dewpoint",
      "H₂S + siloxane removal via lead-lag activated carbon",
    ],
  };
  adStages.push(conditioningStage);

  const methaneRecovery = prodevDesign.gasUpgrading.methaneRecovery.value / 100;
  const productCH4 = prodevDesign.gasUpgrading.productCH4.value;
  const rngCH4ScfPerDay = ch4ScfPerDay * methaneRecovery;
  const rngScfPerDay = rngCH4ScfPerDay / (productCH4 / 100);
  const rngScfm = rngScfPerDay / 1440;
  const rngMMBtuPerDay = rngScfPerDay * 1012 / 1_000_000;
  const tailgasScfm = conditionedScfm - rngScfm;
  const electricalDemandKW = biogasScfPerDay * prodevDesign.gasUpgrading.electricalDemand.value / (1000 * 24);

  const rngPressurePsig = prodevDesign.gasUpgrading.pressureOut.value;
  const rngProductCO2 = 100 - productCH4 - 0.5 - 0.3;
  const rngBtuPerScf = productCH4 * 10.12;

  const upgradingStage: ADProcessStage = {
    name: "Gas Upgrading to RNG (Prodeval)",
    type: "gasUpgrading",
    inputStream: {
      avgFlowScfm: { value: roundTo(conditionedScfm), unit: "SCFM" },
      ch4: { value: roundTo(ch4Content, 1), unit: "%" },
    },
    outputStream: {
      avgFlowScfm: { value: roundTo(rngScfm), unit: "SCFM" },
      pressurePsig: { value: rngPressurePsig, unit: "psig" },
      ch4: { value: productCH4, unit: "%" },
      co2: { value: roundTo(rngProductCO2, 1), unit: "%" },
      btuPerScf: { value: roundTo(rngBtuPerScf), unit: "Btu/SCF" },
      mmbtuPerDay: { value: roundTo(rngMMBtuPerDay, 1), unit: "MMBtu/Day" },
      tailgasFlow: { value: roundTo(tailgasScfm), unit: "SCFM" },
      methaneRecovery: { value: roundTo(methaneRecovery * 100), unit: "%" },
    },
    designCriteria: prodevDesign.gasUpgrading,
    notes: [
      `Prodeval VALOPUR® FU 500 — 3-stage membrane separation`,
      `RNG product: ${roundTo(rngScfm)} SCFM at ${rngPressurePsig} psig, ≥${productCH4}% CH₄`,
      `Tail gas: ${roundTo(tailgasScfm)} SCFM → thermal oxidizer or flare`,
      `Electrical demand: ${roundTo(electricalDemandKW)} kW`,
      `RNG energy output: ${roundTo(rngMMBtuPerDay, 1)} MMBTU/day`,
    ],
  };
  adStages.push(upgradingStage);

  const prodevalEquipment = getProdevalEquipmentList(biogasScfm, makeId);
  for (const pe of prodevalEquipment) {
    equipment.push({
      ...pe,
      isOverridden: false,
      isLocked: false,
    });
  }

  const flareHeight = roundTo(Math.max(15, Math.sqrt(biogasScfm) * 2), 0);
  equipment.push({
    id: makeId("enclosed-flare"),
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

  summary.biogasProduction = {
    scfPerDay: roundTo(biogasScfPerDay),
    scfm: roundTo(biogasScfm),
    mmbtuPerDay: roundTo(biogasMMBtuPerDay, 1),
  };
  summary.rngProduction = {
    scfPerDay: roundTo(rngScfPerDay),
    scfm: roundTo(rngScfm),
    mmbtuPerDay: roundTo(rngMMBtuPerDay, 1),
    pressurePsig: rngPressurePsig,
    productCH4Pct: productCH4,
    methaneRecoveryPct: roundTo(methaneRecovery * 100),
  };
  summary.prodevalUnit = {
    model: prodevUnit.modelSize,
    trains: prodevUnit.numberOfTrains,
    perTrainScfm: prodevUnit.perTrainScfm,
  };

  return { adStages, equipment, assumptions, warnings, summary };
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
    bod: parseAnalyte(upif, "BOD", 4000),
    cod: parseAnalyte(upif, "COD", 8000),
    tss: parseAnalyte(upif, "TSS", 1000),
    tkn: parseAnalyte(upif, "TKN", 80),
    tp: parseAnalyte(upif, "TP", 15),
    fog: parseAnalyte(upif, "FOG", 500),
    nh3: parseAnalyte(upif, "NH3", 50),
    no3: 0,
    unit: "mg/L",
  };

  const defaults = ["BOD", "COD", "TSS", "TKN", "TP", "FOG"];
  const defaultVals = [4000, 8000, 1000, 80, 15, 500];
  const parsed = [influent.bod, influent.cod, influent.tss, influent.tkn, influent.tp, influent.fog];
  for (let i = 0; i < defaults.length; i++) {
    if (parsed[i] === defaultVals[i]) {
      assumptions.push({
        parameter: `Influent ${defaults[i]}`,
        value: `${defaultVals[i]} mg/L`,
        source: "Typical high-strength industrial wastewater (Ludwigson, Industrial Pretreatment Design)",
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

  let adStages: ADProcessStage[] = [];
  let adEquipment: EquipmentItem[] = [];
  let summaryData: Record<string, any> = {};

  if (projectIncludesRNG(upif)) {
    const adResult = calculateTypeADigestionAndGasTrain(upif, flowMGD, influent);
    adStages = adResult.adStages;
    adEquipment = adResult.equipment;
    assumptions.push(...adResult.assumptions);
    warnings.push(...adResult.warnings);
    summaryData = adResult.summary;
  }

  return {
    projectType: "A",
    stages,
    adStages,
    recycleStreams,
    equipment: [...equipment, ...adEquipment],
    convergenceIterations: iterations,
    convergenceAchieved: converged,
    assumptions,
    warnings,
    summary: summaryData,
  };
}
