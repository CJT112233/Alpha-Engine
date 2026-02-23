import type { MassBalanceResults, ADProcessStage, EquipmentItem } from "@shared/schema";
import { FEEDSTOCK_LIBRARY, type FeedstockProfile } from "@shared/feedstock-library";
import {
  selectProdevalUnit,
  getProdevalEquipmentList,
  getProdevalGasTrainDesignCriteria,
} from "@shared/prodeval-equipment-library";

interface ParsedFeedstock {
  name: string;
  tonsPerYear: number;
  tsPct: number;
  vsPctOfTs: number;
  biodegradablePct: number;
  bmpM3CH4PerKgVS: number;
  inertPct: number;
  tknGPerKgWet: number;
  isPackaged: boolean;
  depackagingRejectPct: number;
  libraryMatch: string | null;
}

interface BiogasCalcResult {
  totalFeedTonsPerYear: number;
  totalFeedTonsPerDay: number;
  totalFeedLbPerDay: number;
  totalTsLbPerDay: number;
  totalVsLbPerDay: number;
  vsDestroyedLbPerDay: number;
  vsDestructionPct: number;
  biogasScfd: number;
  biogasScfm: number;
  ch4Pct: number;
  co2Pct: number;
  ch4Scfd: number;
  rngScfd: number;
  rngScfm: number;
  rngMmbtuPerDay: number;
  digestateLbPerDay: number;
  digestateTsPct: number;
  cakeLbPerDay: number;
  cakeTsPct: number;
  centrateLbPerDay: number;
}

function parseMidpoint(rangeStr: string): number {
  const cleaned = rangeStr.replace(/,/g, "").trim();
  const match = cleaned.match(/([\d.]+)\s*[-–—]\s*([\d.]+)/);
  if (match) {
    return (parseFloat(match[1]) + parseFloat(match[2])) / 2;
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function matchFeedstockLibrary(feedstockType: string): FeedstockProfile | null {
  const searchTerm = feedstockType.toLowerCase().trim();
  for (const profile of FEEDSTOCK_LIBRARY) {
    if (profile.name.toLowerCase() === searchTerm) return profile;
    for (const alias of profile.aliases) {
      if (searchTerm.includes(alias) || alias.includes(searchTerm)) return profile;
    }
  }
  for (const profile of FEEDSTOCK_LIBRARY) {
    const words = searchTerm.split(/\s+/);
    for (const word of words) {
      if (word.length < 3) continue;
      if (profile.name.toLowerCase().includes(word)) return profile;
      for (const alias of profile.aliases) {
        if (alias.includes(word)) return profile;
      }
    }
  }
  return null;
}

function parseVolumeToTonsPerYear(volume: string, unit: string): number {
  const val = parseFloat(volume.replace(/,/g, ""));
  if (isNaN(val)) return 0;
  const u = (unit || "").toLowerCase().replace(/\s+/g, "");
  if (u.includes("tpy") || u.includes("ton/yr") || u.includes("tons/year") || u.includes("tonsper year") || u.includes("tonsperyear")) return val;
  if (u.includes("tpd") || u.includes("ton/d") || u.includes("tons/day") || u.includes("tonsperday")) return val * 365;
  if (u.includes("tpm") || u.includes("tons/month") || u.includes("tonspermonth")) return val * 12;
  if (u.includes("lb/d") || u.includes("lbperday") || u.includes("lb/day")) return (val * 365) / 2000;
  if (u.includes("gpd") || u.includes("gal/d") || u.includes("gallonsperday")) return (val * 8.34 * 365) / 2000;
  if (u.includes("mgd")) return (val * 1e6 * 8.34 * 365) / 2000;
  if (u.includes("kg") && (u.includes("day") || u.includes("/d"))) return (val * 2.205 * 365) / 2000;
  if (u.includes("tonnes") || u.includes("metric")) return val * 1.1023;
  return val;
}

function getSpecValue(specs: any, key: string): string | null {
  if (!specs || typeof specs !== "object") return null;
  const entry = specs[key];
  if (entry && typeof entry === "object" && entry.value !== undefined && entry.value !== null && entry.value !== "") {
    return String(entry.value);
  }
  return null;
}

function getSpecValueWithUnit(specs: any, key: string): { value: string; unit: string } | null {
  if (!specs || typeof specs !== "object") return null;
  const entry = specs[key];
  if (entry && typeof entry === "object" && entry.value !== undefined && entry.value !== null && entry.value !== "") {
    return { value: String(entry.value), unit: String(entry.unit || "") };
  }
  return null;
}

function getSpecByDisplayName(specs: any, displayName: string): string | null {
  if (!specs || typeof specs !== "object") return null;
  for (const [, spec] of Object.entries(specs)) {
    const s = spec as any;
    if (s && typeof s === "object" && s.displayName) {
      const dn = String(s.displayName).toLowerCase().trim();
      if (dn === displayName.toLowerCase().trim() && s.value !== undefined && s.value !== null && s.value !== "") {
        return String(s.value);
      }
    }
  }
  return null;
}

function parseFeedstocks(upif: any): ParsedFeedstock[] {
  const feedstocks: ParsedFeedstock[] = [];
  const entries = upif.feedstocks || [];
  if (!Array.isArray(entries) || entries.length === 0) {
    console.warn("Deterministic MB: No feedstocks found in UPIF");
    return feedstocks;
  }

  for (const entry of entries) {
    const type = entry.feedstockType || "Unknown Feedstock";
    const volume = entry.feedstockVolume || "0";
    const unit = entry.feedstockUnit || "TPY";
    const specs = entry.feedstockSpecs || {};
    const tpy = parseVolumeToTonsPerYear(volume, unit);

    const libraryProfile = matchFeedstockLibrary(type);
    const libProps = libraryProfile?.properties || {};

    const tsStr = getSpecValue(specs, "totalSolids")
      || getSpecByDisplayName(specs, "Total Solids (TS)")
      || getSpecByDisplayName(specs, "TS")
      || getSpecByDisplayName(specs, "Total Solids")
      || libProps.totalSolids?.value || "15";
    const vsStr = getSpecValue(specs, "volatileSolids")
      || getSpecValue(specs, "vsTs")
      || getSpecByDisplayName(specs, "VS/TS Ratio")
      || getSpecByDisplayName(specs, "VS/TS")
      || getSpecByDisplayName(specs, "Volatile Solids (VS)")
      || libProps.volatileSolids?.value || "85";
    const bioStr = getSpecValue(specs, "biodegradableFraction") || libProps.biodegradableFraction?.value || "70";
    const bmpSpec = getSpecValueWithUnit(specs, "methanePotential");
    const bmpStr = bmpSpec?.value || libProps.methanePotential?.value || "0.30";
    const bmpUnit = bmpSpec?.unit || libProps.methanePotential?.unit || "";
    const inertStr = getSpecValue(specs, "inertFraction") || libProps.inertFraction?.value || "3";
    const tknStr = getSpecValue(specs, "tkn") || libProps.tkn?.value || "3.0";

    let bmpM3 = parseMidpoint(bmpStr);
    if (bmpM3 > 1.0 || /ml/i.test(bmpUnit)) {
      bmpM3 = bmpM3 / 1000;
    }

    const nameLower = type.toLowerCase();
    const isPackaged = nameLower.includes("packaged") || nameLower.includes("depack");

    console.log(`Deterministic MB: Feedstock "${type}" → TPY=${tpy}, TS=${parseMidpoint(tsStr)}%, VS/TS=${parseMidpoint(vsStr)}%, BMP=${bmpM3} m³CH4/kgVS (raw="${bmpStr}" unit="${bmpUnit}")`);

    feedstocks.push({
      name: type,
      tonsPerYear: tpy,
      tsPct: parseMidpoint(tsStr),
      vsPctOfTs: parseMidpoint(vsStr),
      biodegradablePct: parseMidpoint(bioStr),
      bmpM3CH4PerKgVS: bmpM3,
      inertPct: parseMidpoint(inertStr),
      tknGPerKgWet: parseMidpoint(tknStr),
      isPackaged,
      depackagingRejectPct: isPackaged ? 17.5 : 0,
      libraryMatch: libraryProfile?.name || null,
    });
  }

  return feedstocks;
}

function calculateBiogasProduction(feedstocks: ParsedFeedstock[]): BiogasCalcResult {
  let totalTonsPerYear = 0;
  let totalTsLbPerDay = 0;
  let totalVsLbPerDay = 0;
  let totalNetFeedLbPerDay = 0;

  const CH4_PCT = 60;
  const CO2_PCT = 40;
  const M3_TO_SCF = 35.3147;
  const KG_TO_LB = 2.20462;
  const RNG_BTU_PER_SCF = 1012;
  const VS_DESTRUCTION_PCT = 58;

  for (const fs of feedstocks) {
    const tpy = fs.tonsPerYear;
    const tpd = tpy / 365;
    const lbPerDay = tpd * 2000;

    const rejectFraction = fs.depackagingRejectPct / 100;
    const netLbPerDay = lbPerDay * (1 - rejectFraction);

    const tsLbPerDay = netLbPerDay * (fs.tsPct / 100);
    const vsLbPerDay = tsLbPerDay * (fs.vsPctOfTs / 100);

    totalTonsPerYear += tpy;
    totalNetFeedLbPerDay += netLbPerDay;
    totalTsLbPerDay += tsLbPerDay;
    totalVsLbPerDay += vsLbPerDay;
  }

  const vsDestroyedLbPerDay = totalVsLbPerDay * (VS_DESTRUCTION_PCT / 100);
  const vsDestroyedKgPerDay = vsDestroyedLbPerDay / KG_TO_LB;

  let totalCH4M3PerDay = 0;
  for (const fs of feedstocks) {
    const tpd = fs.tonsPerYear / 365;
    const lbPerDay = tpd * 2000 * (1 - fs.depackagingRejectPct / 100);
    const tsLb = lbPerDay * (fs.tsPct / 100);
    const vsLb = tsLb * (fs.vsPctOfTs / 100);
    const vsDestroyedLb = vsLb * (VS_DESTRUCTION_PCT / 100);
    const vsDestroyedKg = vsDestroyedLb / KG_TO_LB;
    totalCH4M3PerDay += vsDestroyedKg * fs.bmpM3CH4PerKgVS;
  }

  const ch4Scfd = totalCH4M3PerDay * M3_TO_SCF;
  const biogasScfd = ch4Scfd / (CH4_PCT / 100);
  const biogasScfm = biogasScfd / 1440;

  const prodevalUnit = selectProdevalUnit(biogasScfm);
  const methaneRecovery = prodevalUnit.methaneRecovery / 100;
  const volumeLoss = prodevalUnit.volumeLossPct / 100;

  const conditionedBiogasScfd = biogasScfd * (1 - volumeLoss);
  const rngScfd = conditionedBiogasScfd * (CH4_PCT / 100) * methaneRecovery / (prodevalUnit.productCH4 / 100);
  const rngScfm = rngScfd / 1440;
  const rngMmbtuPerDay = rngScfd * RNG_BTU_PER_SCF / 1e6;

  const digestateLbPerDay = totalNetFeedLbPerDay - (vsDestroyedLbPerDay * 0.95);
  const remainingTsLb = totalTsLbPerDay - vsDestroyedLbPerDay;
  const digestateTsPct = (remainingTsLb / digestateLbPerDay) * 100;

  const solidsCaptureEff = 0.92;
  const cakeTsPct = 28;
  const cakeSolidsLb = remainingTsLb * solidsCaptureEff;
  const cakeLbPerDay = cakeSolidsLb / (cakeTsPct / 100);
  const centrateLbPerDay = digestateLbPerDay - cakeLbPerDay;

  return {
    totalFeedTonsPerYear: totalTonsPerYear,
    totalFeedTonsPerDay: totalTonsPerYear / 365,
    totalFeedLbPerDay: totalNetFeedLbPerDay,
    totalTsLbPerDay: totalTsLbPerDay,
    totalVsLbPerDay: totalVsLbPerDay,
    vsDestroyedLbPerDay: vsDestroyedLbPerDay,
    vsDestructionPct: VS_DESTRUCTION_PCT,
    biogasScfd,
    biogasScfm,
    ch4Pct: CH4_PCT,
    co2Pct: CO2_PCT,
    ch4Scfd,
    rngScfd,
    rngScfm,
    rngMmbtuPerDay,
    digestateLbPerDay,
    digestateTsPct: Math.min(digestateTsPct, 8),
    cakeLbPerDay,
    cakeTsPct,
    centrateLbPerDay,
  };
}

function r(val: number, decimals: number = 0): string {
  if (decimals === 0) return Math.round(val).toLocaleString("en-US");
  return val.toFixed(decimals);
}

function rv(val: number, decimals: number = 0): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function buildTypeBAdStages(
  feedstocks: ParsedFeedstock[],
  calc: BiogasCalcResult,
): ADProcessStage[] {
  const stages: ADProcessStage[] = [];
  const HRT_DAYS = 25;
  const OLR_TARGET = 3.5;
  const DIGESTER_TEMP_F = 98;
  const EQ_RETENTION_DAYS = 1.5;
  const FEED_DENSITY_LB_PER_GAL = 8.5;

  const feedGpd = calc.totalFeedLbPerDay / FEED_DENSITY_LB_PER_GAL;
  const feedM3PerDay = feedGpd * 0.003785;

  stages.push({
    name: "Stage 1: Feedstock Receiving & Storage",
    type: "receiving",
    inputStream: {
      flowTonsPerYear: { value: rv(calc.totalFeedTonsPerYear), unit: "TPY" },
      flowTonsPerDay: { value: rv(calc.totalFeedTonsPerDay, 1), unit: "TPD" },
      flowLbPerDay: { value: rv(calc.totalFeedLbPerDay), unit: "lb/d" },
      totalSolidsPct: { value: rv((calc.totalTsLbPerDay / calc.totalFeedLbPerDay) * 100, 1), unit: "%" },
      totalSolidsLbPerDay: { value: rv(calc.totalTsLbPerDay), unit: "lb/d" },
    },
    outputStream: {
      flowLbPerDay: { value: rv(calc.totalFeedLbPerDay), unit: "lb/d" },
      totalSolidsLbPerDay: { value: rv(calc.totalTsLbPerDay), unit: "lb/d" },
    },
    designCriteria: {
      storageDays: { value: 3, unit: "days", source: "Design standard" },
      storageCapacity: { value: rv(calc.totalFeedTonsPerDay * 3, 0), unit: "tons", source: "1.5× design throughput" },
    },
    notes: feedstocks.map(f => `${f.name}: ${r(f.tonsPerYear)} TPY (${r(f.tonsPerYear / 365, 1)} TPD)`),
  });

  const hasPackaged = feedstocks.some(f => f.isPackaged);
  stages.push({
    name: "Stage 2: Feedstock Preparation",
    type: "maceration",
    inputStream: {
      flowLbPerDay: { value: rv(calc.totalFeedLbPerDay), unit: "lb/d" },
      totalSolidsPct: { value: rv((calc.totalTsLbPerDay / calc.totalFeedLbPerDay) * 100, 1), unit: "%" },
    },
    outputStream: {
      flowLbPerDay: { value: rv(calc.totalFeedLbPerDay), unit: "lb/d" },
      particleSize: { value: 15, unit: "mm" },
    },
    designCriteria: {
      targetParticleSize: { value: 15, unit: "mm", source: "AD design guideline" },
      ...(hasPackaged ? { depackagingRejectRate: { value: 17.5, unit: "%", source: "Typical for packaged food waste" } } : {}),
    },
    notes: [
      "Macerator/grinder for particle size reduction to 10-20 mm",
      ...(hasPackaged ? ["Depackaging unit for packaged waste streams (15-20% reject rate)"] : []),
      "Magnetic separation for ferrous contaminants",
    ],
  });

  const eqVolumeGal = feedGpd * EQ_RETENTION_DAYS;
  stages.push({
    name: "Stage 3: Equalization Tank",
    type: "equalization",
    inputStream: {
      flowGPD: { value: rv(feedGpd), unit: "GPD" },
      flowLbPerDay: { value: rv(calc.totalFeedLbPerDay), unit: "lb/d" },
      totalSolidsPct: { value: rv((calc.totalTsLbPerDay / calc.totalFeedLbPerDay) * 100, 1), unit: "%" },
    },
    outputStream: {
      flowGPD: { value: rv(feedGpd), unit: "GPD" },
      totalSolidsPct: { value: rv(Math.min((calc.totalTsLbPerDay / calc.totalFeedLbPerDay) * 100, 12), 1), unit: "%" },
      temperatureF: { value: DIGESTER_TEMP_F, unit: "°F" },
    },
    designCriteria: {
      retentionTime: { value: EQ_RETENTION_DAYS, unit: "days", source: "Design standard" },
      tankVolume: { value: rv(eqVolumeGal), unit: "gal", source: "Feed flow × retention time" },
      mixingPower: { value: 5, unit: "W/m³", source: "Typical for slurry equalization" },
    },
    notes: [
      "Continuous mixing to prevent settling and stratification",
      `Pre-heating feed to ${DIGESTER_TEMP_F}°F via heat exchanger`,
    ],
  });

  const digesterVolumeGal = feedGpd * HRT_DAYS * 1.12;
  const digesterVolumeM3 = digesterVolumeGal * 0.003785;
  const vsLoadingKgPerM3Day = (calc.totalVsLbPerDay / 2.20462) / digesterVolumeM3;
  const mixingPowerWPerM3 = 6;
  const mixingPowerHP = rv((mixingPowerWPerM3 * digesterVolumeM3) / 746, 0);

  stages.push({
    name: "Stage 4: Anaerobic Digestion (CSTR)",
    type: "digester",
    inputStream: {
      flowGPD: { value: rv(feedGpd), unit: "GPD" },
      flowLbPerDay: { value: rv(calc.totalFeedLbPerDay), unit: "lb/d" },
      totalSolidsLbPerDay: { value: rv(calc.totalTsLbPerDay), unit: "lb/d" },
      volatileSolidsLbPerDay: { value: rv(calc.totalVsLbPerDay), unit: "lb/d" },
    },
    outputStream: {
      digestateLbPerDay: { value: rv(calc.digestateLbPerDay), unit: "lb/d" },
      digestateTsPct: { value: rv(calc.digestateTsPct, 1), unit: "%" },
      biogasFlow: { value: rv(calc.biogasScfm, 1), unit: "SCFM" },
      biogasScfd: { value: rv(calc.biogasScfd), unit: "SCFD" },
      ch4Content: { value: calc.ch4Pct, unit: "%" },
      co2Content: { value: calc.co2Pct, unit: "%" },
      h2sContent: { value: 1500, unit: "ppmv" },
      biogasMmbtuPerDay: { value: rv(calc.biogasScfd * calc.ch4Pct / 100 * 1012 / 1e6, 1), unit: "MMBTU/day" },
    },
    designCriteria: {
      hrt: { value: HRT_DAYS, unit: "days", source: "Mesophilic CSTR design" },
      olr: { value: rv(vsLoadingKgPerM3Day, 1), unit: "kg VS/m³·d", source: "Calculated from feed VS and digester volume" },
      vsDestruction: { value: calc.vsDestructionPct, unit: "%", source: "Mesophilic AD typical range 60-80%" },
      temperature: { value: DIGESTER_TEMP_F, unit: "°F", source: "Mesophilic range (95-100°F)" },
      digesterVolume: { value: rv(digesterVolumeGal), unit: "gal", source: "Feed flow × HRT × 1.12 (headspace)" },
      mixingPower: { value: mixingPowerWPerM3, unit: "W/m³", source: "CSTR mechanical mixing standard" },
    },
    notes: [
      `VS destroyed: ${r(calc.vsDestroyedLbPerDay)} lb/d (${calc.vsDestructionPct}% destruction)`,
      `Digester volume: ${r(digesterVolumeGal)} gal (${r(digesterVolumeM3)} m³) including 12% headspace`,
      `OLR: ${rv(vsLoadingKgPerM3Day, 1)} kg VS/m³·d`,
    ],
  });

  const centrateTssLb = calc.centrateLbPerDay * 0.005;
  stages.push({
    name: "Stage 5: Solids-Liquid Separation (Centrifuge)",
    type: "solidsSeparation",
    inputStream: {
      digestateLbPerDay: { value: rv(calc.digestateLbPerDay), unit: "lb/d" },
      digestateTsPct: { value: rv(calc.digestateTsPct, 1), unit: "%" },
    },
    outputStream: {
      cakeLbPerDay: { value: rv(calc.cakeLbPerDay), unit: "lb/d" },
      cakeTsPct: { value: calc.cakeTsPct, unit: "%" },
      centrateLbPerDay: { value: rv(calc.centrateLbPerDay), unit: "lb/d" },
    },
    designCriteria: {
      solidsCaptureEfficiency: { value: 92, unit: "%", source: "Decanter centrifuge typical" },
      cakeSolids: { value: calc.cakeTsPct, unit: "%", source: "Centrifuge design" },
      polymerDosing: { value: 10, unit: "kg/ton dry solids", source: "Typical range 5-15" },
    },
    notes: [
      "Decanter centrifuge for digestate dewatering",
      `Cake: ${r(calc.cakeLbPerDay)} lb/d at ${calc.cakeTsPct}% TS — to storage/hauling`,
      `Centrate: ${r(calc.centrateLbPerDay)} lb/d — to DAF treatment`,
    ],
  });

  const dafInflowGpd = calc.centrateLbPerDay / 8.34;
  stages.push({
    name: "Stage 6: Liquid Cleanup — Dissolved Air Flotation (DAF)",
    type: "daf",
    inputStream: {
      centrateLbPerDay: { value: rv(calc.centrateLbPerDay), unit: "lb/d" },
      centrateGPD: { value: rv(dafInflowGpd), unit: "GPD" },
    },
    outputStream: {
      effluentGPD: { value: rv(dafInflowGpd * 0.95), unit: "GPD" },
      floatLbPerDay: { value: rv(calc.centrateLbPerDay * 0.05), unit: "lb/d" },
    },
    designCriteria: {
      tssRemoval: { value: 90, unit: "%", source: "DAF design standard" },
      fogRemoval: { value: 95, unit: "%", source: "DAF design standard" },
      hydraulicLoading: { value: 3, unit: "gpm/ft²", source: "Typical range 2-4" },
    },
    notes: [
      "Chemical conditioning: FeCl₃ coagulant + polymer",
      "DAF float recycled to digester or hauled off-site",
      "DAF effluent suitable for sewer discharge or irrigation",
    ],
  });

  const prodevalCriteria = getProdevalGasTrainDesignCriteria(calc.biogasScfm);
  const conditionedScfm = calc.biogasScfm * (1 - selectProdevalUnit(calc.biogasScfm).volumeLossPct / 100);

  stages.push({
    name: "Stage 7: Biogas Conditioning — Prodeval VALOGAZ® + VALOPACK®",
    type: "gasConditioning",
    inputStream: {
      avgFlowScfm: { value: rv(calc.biogasScfm, 1), unit: "SCFM" },
      ch4: { value: calc.ch4Pct, unit: "%" },
      co2: { value: calc.co2Pct, unit: "%" },
      h2s: { value: 1500, unit: "ppmv" },
      pressurePsig: { value: 0.5, unit: "psig" },
    },
    outputStream: {
      avgFlowScfm: { value: rv(conditionedScfm, 1), unit: "SCFM" },
      ch4: { value: calc.ch4Pct, unit: "%" },
      h2s: { value: 7.5, unit: "ppmv" },
      pressurePsig: { value: selectProdevalUnit(calc.biogasScfm).acFilterPressurePsig, unit: "psig" },
    },
    designCriteria: {
      ...prodevalCriteria.gasConditioning,
    },
    notes: [
      "Prodeval VALOGAZ® FU 100: Refrigerated condenser for moisture removal",
      "Prodeval VALOGAZ® FU 200: PD blower for gas transport",
      "Prodeval VALOPACK® FU 300: Lead-lag activated carbon for H₂S/siloxane/VOC removal + dust filter",
    ],
  });

  const prodevalUnit = selectProdevalUnit(calc.biogasScfm);
  stages.push({
    name: "Stage 8: Gas Upgrading to RNG — Prodeval VALOPUR®",
    type: "gasUpgrading",
    inputStream: {
      avgFlowScfm: { value: rv(conditionedScfm, 1), unit: "SCFM" },
      ch4: { value: calc.ch4Pct, unit: "%" },
      pressurePsig: { value: prodevalUnit.acFilterPressurePsig, unit: "psig" },
    },
    outputStream: {
      rngFlowScfm: { value: rv(calc.rngScfm, 1), unit: "SCFM" },
      rngFlowScfd: { value: rv(calc.rngScfd), unit: "SCFD" },
      rngCh4: { value: prodevalUnit.productCH4, unit: "%" },
      rngPressure: { value: prodevalUnit.rngPressurePsig, unit: "psig" },
      rngMmbtuPerDay: { value: rv(calc.rngMmbtuPerDay, 1), unit: "MMBTU/day" },
      rngMmbtuPerYear: { value: rv(calc.rngMmbtuPerDay * 365), unit: "MMBTU/yr" },
      btuPerScf: { value: 1012, unit: "BTU/SCF" },
    },
    designCriteria: {
      ...prodevalCriteria.gasUpgrading,
    },
    notes: [
      `Prodeval VALOPUR® FU 500: 3-stage membrane separation (${prodevalUnit.methaneRecovery}% CH₄ recovery)`,
      `Prodeval VALOPUR® FU 800: HP compressor for pipeline injection at ${prodevalUnit.rngPressurePsig} psig`,
      `Tail gas (CO₂-rich permeate) to enclosed flare/thermal oxidizer`,
    ],
  });

  stages.push({
    name: "Stage 9: Emergency/Backup Gas Management",
    type: "gasManagement",
    inputStream: {
      maxBiogasFlowScfm: { value: rv(calc.biogasScfm * 1.1, 1), unit: "SCFM" },
    },
    outputStream: {},
    designCriteria: {
      flareCapacity: { value: rv(calc.biogasScfm * 1.1, 0), unit: "SCFM", source: "110% of max biogas production" },
      destructionEfficiency: { value: 99.5, unit: "%", source: "EPA regulatory requirement" },
    },
    notes: [
      "Enclosed flare sized for 110% of maximum biogas production",
      "Required for startup, shutdown, and upset conditions",
    ],
  });

  return stages;
}

function buildTypeBEquipment(
  feedstocks: ParsedFeedstock[],
  calc: BiogasCalcResult,
): EquipmentItem[] {
  const equipment: EquipmentItem[] = [];
  let idCounter = 0;
  const makeId = (suffix: string) => `det-${suffix}-${idCounter++}`;

  const FEED_DENSITY_LB_PER_GAL = 8.5;
  const feedGpd = calc.totalFeedLbPerDay / FEED_DENSITY_LB_PER_GAL;
  const HRT_DAYS = 25;
  const EQ_RETENTION_DAYS = 1.5;

  equipment.push({
    id: makeId("receiving"),
    process: "Feedstock Receiving",
    equipmentType: "Receiving Hopper / Tipping Floor",
    description: `Covered receiving area with tipping floor and receiving pit, ${r(calc.totalFeedTonsPerDay * 3)} ton storage capacity`,
    quantity: 1,
    specs: {
      capacity: { value: r(calc.totalFeedTonsPerDay * 1.5, 0), unit: "TPD" },
      storageCapacity: { value: r(calc.totalFeedTonsPerDay * 3, 0), unit: "tons" },
      dimensionsL: { value: "60", unit: "ft" },
      dimensionsW: { value: "40", unit: "ft" },
      dimensionsH: { value: "20", unit: "ft" },
      power: { value: "5", unit: "HP" },
    },
    designBasis: `1.5× design throughput, 3-day covered storage`,
    notes: "Includes truck scale, odor control, and drainage collection",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("macerator"),
    process: "Feedstock Preparation",
    equipmentType: "Macerator / Grinder",
    description: "Twin-shaft macerator for particle size reduction to 10-20 mm",
    quantity: 1,
    specs: {
      throughput: { value: r(calc.totalFeedTonsPerDay * 1.25, 0), unit: "TPD" },
      targetParticleSize: { value: "10-20", unit: "mm" },
      dimensionsL: { value: "8", unit: "ft" },
      dimensionsW: { value: "4", unit: "ft" },
      dimensionsH: { value: "5", unit: "ft" },
      power: { value: r(Math.max(30, calc.totalFeedTonsPerDay * 0.5), 0), unit: "HP" },
    },
    designBasis: "125% of design throughput for particle size reduction",
    notes: "Twin-shaft design for reliability; includes magnetic separator upstream",
    isOverridden: false,
    isLocked: false,
  });

  const hasPackaged = feedstocks.some(f => f.isPackaged);
  if (hasPackaged) {
    equipment.push({
      id: makeId("depackager"),
      process: "Feedstock Preparation",
      equipmentType: "Depackaging Unit",
      description: "Mechanical depackaging for packaged food waste streams",
      quantity: 1,
      specs: {
        throughput: { value: r(calc.totalFeedTonsPerDay * 0.5, 0), unit: "TPD" },
        rejectRate: { value: "15-20", unit: "%" },
        dimensionsL: { value: "12", unit: "ft" },
        dimensionsW: { value: "6", unit: "ft" },
        dimensionsH: { value: "8", unit: "ft" },
        power: { value: "40", unit: "HP" },
      },
      designBasis: "Mechanical separation of packaging from organic fraction",
      notes: "Reject stream (packaging) to landfill; organic fraction to EQ tank",
      isOverridden: false,
      isLocked: false,
    });
  }

  const eqVolumeGal = feedGpd * EQ_RETENTION_DAYS;
  equipment.push({
    id: makeId("eq-tank"),
    process: "Equalization",
    equipmentType: "Equalization Tank",
    description: `Insulated EQ tank with continuous mixing, ${r(eqVolumeGal)} gal capacity`,
    quantity: 1,
    specs: {
      volume: { value: r(eqVolumeGal), unit: "gal" },
      retentionTime: { value: "1.5", unit: "days" },
      dimensionsL: { value: r(Math.max(15, Math.pow(eqVolumeGal / 7.48 / Math.PI * 4, 1/3) * 1.5), 0), unit: "ft (dia)" },
      dimensionsW: { value: r(Math.max(15, Math.pow(eqVolumeGal / 7.48 / Math.PI * 4, 1/3) * 1.5), 0), unit: "ft (dia)" },
      dimensionsH: { value: r(Math.max(12, Math.pow(eqVolumeGal / 7.48 / Math.PI * 4, 1/3)), 0), unit: "ft" },
      power: { value: r(Math.max(5, eqVolumeGal * 0.003785 * 5 / 746 * 1.341), 0), unit: "HP" },
    },
    designBasis: `${EQ_RETENTION_DAYS} day retention, continuous mixing`,
    notes: "Includes top-entry mixer, heat exchanger for feed pre-heating, and level instrumentation",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("hx"),
    process: "Equalization",
    equipmentType: "Feed Heat Exchanger",
    description: "Shell-and-tube heat exchanger for feed pre-heating to digester temperature",
    quantity: 1,
    specs: {
      duty: { value: r(calc.totalFeedLbPerDay * 0.5 * (98 - 60) / 1e6, 2), unit: "MMBTU/hr" },
      feedTemp: { value: "60", unit: "°F (inlet)" },
      outletTemp: { value: "98", unit: "°F" },
      dimensionsL: { value: "8", unit: "ft" },
      dimensionsW: { value: "3", unit: "ft" },
      dimensionsH: { value: "3", unit: "ft" },
      power: { value: "2", unit: "HP" },
    },
    designBasis: "Heat feed from ambient to 98°F mesophilic digester temperature",
    notes: "Hot water from digester heating loop or boiler; includes CIP connections",
    isOverridden: false,
    isLocked: false,
  });

  const feedPumpGpm = feedGpd / 1440;
  equipment.push({
    id: makeId("feed-pump"),
    process: "Digester Feed",
    equipmentType: "Digester Feed Pump",
    description: "Progressive cavity pump for digester feed (duty + standby)",
    quantity: 2,
    specs: {
      flowRate: { value: r(feedPumpGpm, 1), unit: "GPM" },
      tdh: { value: "40", unit: "ft" },
      dimensionsL: { value: "6", unit: "ft" },
      dimensionsW: { value: "3", unit: "ft" },
      dimensionsH: { value: "4", unit: "ft" },
      power: { value: r(Math.max(5, feedPumpGpm * 40 / 3960 / 0.6 * 1.2), 0), unit: "HP" },
    },
    designBasis: "Progressive cavity pump rated for high-solids slurry (duty + standby)",
    notes: "Variable speed drive for feed rate control",
    isOverridden: false,
    isLocked: false,
  });

  const digesterVolumeGal = feedGpd * HRT_DAYS * 1.12;
  const digesterVolumeM3 = digesterVolumeGal * 0.003785;
  const numDigesters = digesterVolumeGal > 500000 ? 2 : 1;
  const perDigesterGal = digesterVolumeGal / numDigesters;
  const diamFt = rv(Math.pow(perDigesterGal / 7.48 / (Math.PI / 4) / 30, 0.5), 0);
  const heightFt = rv(Math.min(35, perDigesterGal / 7.48 / (Math.PI / 4 * diamFt * diamFt)), 0);

  equipment.push({
    id: makeId("digester"),
    process: "Anaerobic Digestion",
    equipmentType: "CSTR Anaerobic Digester",
    description: `Mesophilic CSTR digester with gas collection dome, ${r(perDigesterGal)} gal each`,
    quantity: numDigesters,
    specs: {
      volumePerUnit: { value: r(perDigesterGal), unit: "gal" },
      totalVolume: { value: r(digesterVolumeGal), unit: "gal" },
      volumeM3: { value: r(digesterVolumeM3), unit: "m³" },
      hrt: { value: "25", unit: "days" },
      temperature: { value: "98", unit: "°F" },
      dimensionsL: { value: String(Math.max(30, diamFt)), unit: "ft (dia)" },
      dimensionsW: { value: String(Math.max(30, diamFt)), unit: "ft (dia)" },
      dimensionsH: { value: String(Math.max(20, heightFt)), unit: "ft" },
      power: { value: r(Math.max(15, digesterVolumeM3 * 6 / 746 * 1.341 / numDigesters), 0), unit: "HP" },
    },
    designBasis: `${HRT_DAYS}-day HRT, mesophilic (98°F), 12% gas headspace`,
    notes: `${numDigesters > 1 ? `${numDigesters} digesters in parallel; ` : ""}Top-entry mixers (6 W/m³), gas collection dome, insulated and heated`,
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("digester-mixer"),
    process: "Anaerobic Digestion",
    equipmentType: "Digester Mixer",
    description: "Top-entry mechanical mixers for digester contents mixing",
    quantity: numDigesters * 2,
    specs: {
      mixingIntensity: { value: "6", unit: "W/m³" },
      totalPower: { value: r(digesterVolumeM3 * 6 / 746 * 1.341, 0), unit: "HP" },
      dimensionsL: { value: "4", unit: "ft" },
      dimensionsW: { value: "4", unit: "ft" },
      dimensionsH: { value: "15", unit: "ft" },
      power: { value: r(digesterVolumeM3 * 6 / 746 * 1.341 / (numDigesters * 2), 0), unit: "HP" },
    },
    designBasis: "6 W/m³ mixing intensity, 2 mixers per digester",
    notes: "Draft-tube or top-entry design; VFD for speed control",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("boiler"),
    process: "Anaerobic Digestion",
    equipmentType: "Digester Heating Boiler",
    description: "Hot water boiler for digester heating loop",
    quantity: 1,
    specs: {
      duty: { value: r(calc.totalFeedLbPerDay * 0.5 * (98 - 60) / 1e6 * 1.3, 2), unit: "MMBTU/hr" },
      fuel: { value: "Natural gas / biogas", unit: "" },
      dimensionsL: { value: "8", unit: "ft" },
      dimensionsW: { value: "5", unit: "ft" },
      dimensionsH: { value: "6", unit: "ft" },
      power: { value: "5", unit: "HP" },
    },
    designBasis: "Maintain digester at 98°F, 130% of steady-state heat loss",
    notes: "Dual-fuel capability (natural gas for startup, biogas for operation)",
    isOverridden: false,
    isLocked: false,
  });

  const centrifugeTpd = calc.digestateLbPerDay / 2000;
  equipment.push({
    id: makeId("centrifuge"),
    process: "Solids-Liquid Separation",
    equipmentType: "Decanter Centrifuge",
    description: `High-solids decanter centrifuge, ${r(centrifugeTpd, 1)} TPD capacity`,
    quantity: 1,
    specs: {
      throughput: { value: r(centrifugeTpd, 1), unit: "TPD" },
      solidsCaptureEfficiency: { value: "92", unit: "%" },
      cakeSolids: { value: "28", unit: "%" },
      dimensionsL: { value: "14", unit: "ft" },
      dimensionsW: { value: "5", unit: "ft" },
      dimensionsH: { value: "6", unit: "ft" },
      power: { value: r(Math.max(30, centrifugeTpd * 3), 0), unit: "HP" },
    },
    designBasis: "Decanter centrifuge with polymer conditioning",
    notes: "Polymer dosing: 10 kg/ton dry solids; includes polymer make-down system",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("centrate-tank"),
    process: "Solids-Liquid Separation",
    equipmentType: "Centrate Collection Tank",
    description: "Collection tank for centrifuge centrate before DAF treatment",
    quantity: 1,
    specs: {
      volume: { value: r(calc.centrateLbPerDay / 8.34 * 0.5), unit: "gal" },
      retentionTime: { value: "0.5", unit: "days" },
      dimensionsL: { value: "10", unit: "ft (dia)" },
      dimensionsW: { value: "10", unit: "ft (dia)" },
      dimensionsH: { value: "10", unit: "ft" },
      power: { value: "3", unit: "HP" },
    },
    designBasis: "0.5-day buffer between centrifuge and DAF",
    notes: "Includes submersible mixer and level control",
    isOverridden: false,
    isLocked: false,
  });

  const dafGpd = calc.centrateLbPerDay / 8.34;
  const dafGpm = dafGpd / 1440;
  const dafAreaSqFt = dafGpm / 3;
  equipment.push({
    id: makeId("daf"),
    process: "Liquid Cleanup",
    equipmentType: "Dissolved Air Flotation (DAF) Unit",
    description: `DAF unit for centrate polishing, ${r(dafGpd)} GPD capacity`,
    quantity: 1,
    specs: {
      hydraulicCapacity: { value: r(dafGpd), unit: "GPD" },
      flowRate: { value: r(dafGpm, 1), unit: "GPM" },
      surfaceArea: { value: r(dafAreaSqFt), unit: "ft²" },
      hydraulicLoading: { value: "3", unit: "gpm/ft²" },
      dimensionsL: { value: r(Math.max(8, Math.sqrt(dafAreaSqFt) * 1.5), 0), unit: "ft" },
      dimensionsW: { value: r(Math.max(6, Math.sqrt(dafAreaSqFt)), 0), unit: "ft" },
      dimensionsH: { value: "6", unit: "ft" },
      power: { value: r(Math.max(5, dafGpm * 0.3), 0), unit: "HP" },
    },
    designBasis: "3 gpm/ft² hydraulic loading, 90% TSS removal, 95% FOG removal",
    notes: "Includes air saturator, recycle pump, chemical dosing (FeCl₃ + polymer), and float skimmer",
    isOverridden: false,
    isLocked: false,
  });

  const prodevalEquipment = getProdevalEquipmentList(calc.biogasScfm, (suffix) => makeId(suffix || "prodeval"));
  for (const item of prodevalEquipment) {
    equipment.push({
      ...item,
      isOverridden: false,
      isLocked: false,
    });
  }

  equipment.push({
    id: makeId("flare"),
    process: "Emergency Gas Management",
    equipmentType: "Enclosed Flare",
    description: `Enclosed ground flare sized for ${r(calc.biogasScfm * 1.1, 0)} SCFM (110% of max biogas)`,
    quantity: 1,
    specs: {
      capacity: { value: r(calc.biogasScfm * 1.1, 0), unit: "SCFM" },
      destructionEfficiency: { value: "99.5", unit: "%" },
      dimensionsL: { value: "8", unit: "ft (dia)" },
      dimensionsW: { value: "8", unit: "ft (dia)" },
      dimensionsH: { value: "25", unit: "ft" },
      power: { value: "3", unit: "HP" },
    },
    designBasis: "110% of maximum biogas production, ≥99.5% destruction",
    notes: "Required for startup, shutdown, upset conditions, and RNG system maintenance",
    isOverridden: false,
    isLocked: false,
  });

  equipment.push({
    id: makeId("cake-storage"),
    process: "Solids Management",
    equipmentType: "Cake Storage / Loadout",
    description: "Covered cake storage pad with front-end loader access",
    quantity: 1,
    specs: {
      storageCapacity: { value: r(calc.cakeLbPerDay / 2000 * 7), unit: "tons" },
      storageDays: { value: "7", unit: "days" },
      dimensionsL: { value: "40", unit: "ft" },
      dimensionsW: { value: "30", unit: "ft" },
      dimensionsH: { value: "12", unit: "ft" },
      power: { value: "0", unit: "HP" },
    },
    designBasis: "7-day cake storage capacity",
    notes: "Covered to prevent stormwater contamination; truck loadout for beneficial reuse",
    isOverridden: false,
    isLocked: false,
  });

  const effluentStorageGal = dafGpd * 3;
  equipment.push({
    id: makeId("effluent-tank"),
    process: "Effluent Management",
    equipmentType: "Effluent Storage Tank",
    description: `Effluent storage tank, ${r(effluentStorageGal)} gal (3-day storage)`,
    quantity: 1,
    specs: {
      volume: { value: r(effluentStorageGal), unit: "gal" },
      storageDays: { value: "3", unit: "days" },
      dimensionsL: { value: "15", unit: "ft (dia)" },
      dimensionsW: { value: "15", unit: "ft (dia)" },
      dimensionsH: { value: "12", unit: "ft" },
      power: { value: "2", unit: "HP" },
    },
    designBasis: "3-day effluent storage before discharge/hauling",
    notes: "Includes submersible pump for discharge to sewer or tanker loading",
    isOverridden: false,
    isLocked: false,
  });

  return equipment;
}

function buildAssumptions(feedstocks: ParsedFeedstock[], calc: BiogasCalcResult): Array<{ parameter: string; value: string; source: string }> {
  const assumptions: Array<{ parameter: string; value: string; source: string }> = [];

  assumptions.push(
    { parameter: "Digester Type", value: "Mesophilic CSTR", source: "Standard for mixed organic feedstocks" },
    { parameter: "Digester Temperature", value: "98°F (37°C)", source: "Mesophilic range" },
    { parameter: "Hydraulic Retention Time (HRT)", value: "25 days", source: "Typical for mixed feedstock AD" },
    { parameter: "VS Destruction", value: `${calc.vsDestructionPct}%`, source: "Mesophilic AD typical range 60-80%" },
    { parameter: "Biogas CH₄ Content", value: `${calc.ch4Pct}%`, source: "Typical for organic waste AD" },
    { parameter: "Biogas CO₂ Content", value: `${calc.co2Pct}%`, source: "Typical for organic waste AD" },
    { parameter: "Biogas H₂S", value: "1,500 ppmv", source: "Conservative estimate for mixed feedstocks" },
    { parameter: "RNG Heating Value", value: "1,012 BTU/SCF", source: "Pipeline-quality RNG standard" },
    { parameter: "Gas Upgrading Vendor", value: "Prodeval (VALOGAZ®/VALOPACK®/VALOPUR®)", source: "Default vendor specification" },
    { parameter: "Methane Recovery", value: "97%", source: "Prodeval VALOPUR® membrane spec" },
    { parameter: "Product RNG Purity", value: "≥97% CH₄", source: "Prodeval VALOPUR® membrane spec" },
    { parameter: "Pipeline Injection Pressure", value: "200 psig", source: "Prodeval VALOPUR® FU 800 spec" },
    { parameter: "Centrifuge Solids Capture", value: "92%", source: "Decanter centrifuge design standard" },
    { parameter: "Centrifuge Cake TS", value: "28%", source: "Typical for digestate dewatering" },
    { parameter: "DAF TSS Removal", value: "90%", source: "DAF design standard" },
    { parameter: "Operating Days Per Year", value: "365", source: "Continuous operation" },
  );

  for (const fs of feedstocks) {
    const src = fs.libraryMatch ? `${fs.libraryMatch} library profile` : "User-provided / estimated default";
    assumptions.push(
      { parameter: `${fs.name} — Total Solids`, value: `${fs.tsPct}%`, source: src },
      { parameter: `${fs.name} — Volatile Solids`, value: `${fs.vsPctOfTs}% of TS`, source: src },
      { parameter: `${fs.name} — BMP`, value: `${fs.bmpM3CH4PerKgVS} m³ CH₄/kg VS`, source: src },
    );
  }

  return assumptions;
}

function buildSummary(calc: BiogasCalcResult): Record<string, { value: string; unit: string }> {
  return {
    totalFeedstockInput: { value: r(calc.totalFeedTonsPerYear), unit: "TPY" },
    dailyFeedRate: { value: r(calc.totalFeedTonsPerDay, 1), unit: "TPD" },
    totalVSLoading: { value: r(calc.totalVsLbPerDay), unit: "lb VS/day" },
    vsDestroyed: { value: r(calc.vsDestroyedLbPerDay), unit: "lb VS/day" },
    biogasProduction: { value: r(calc.biogasScfm, 1), unit: "SCFM" },
    biogasProductionDaily: { value: r(calc.biogasScfd), unit: "SCFD" },
    biogasCH4Content: { value: String(calc.ch4Pct), unit: "%" },
    rngProduction: { value: r(calc.rngScfm, 1), unit: "SCFM" },
    rngProductionDaily: { value: r(calc.rngScfd), unit: "SCFD" },
    rngEnergyDaily: { value: r(calc.rngMmbtuPerDay, 1), unit: "MMBTU/day" },
    rngEnergyAnnual: { value: r(calc.rngMmbtuPerDay * 365), unit: "MMBTU/yr" },
    dewateredCake: { value: r(calc.cakeLbPerDay / 2000, 1), unit: "TPD" },
    cakeSolids: { value: String(calc.cakeTsPct), unit: "%" },
    dafEffluent: { value: r(calc.centrateLbPerDay / 8.34), unit: "GPD" },
  };
}

interface BiogasInputParams {
  avgFlowScfm: number;
  maxFlowScfm: number;
  minFlowScfm: number;
  ch4Pct: number;
  co2Pct: number;
  h2sPpm: number;
  n2Pct: number;
  o2Pct: number;
  pressurePsig: number;
  btuPerScf: number;
}

function parseBiogasInput(upif: any): BiogasInputParams {
  const specs = upif.outputSpecs || {};
  const feedstocks = upif.feedstocks || [];

  let avgFlowScfm = 0;
  for (const fs of feedstocks) {
    const vol = fs.feedstockVolume || "0";
    const unit = (fs.feedstockUnit || "").toLowerCase();
    const val = parseFloat(vol.replace(/,/g, ""));
    if (isNaN(val)) continue;
    if (unit.includes("scfm")) avgFlowScfm += val;
    else if (unit.includes("scfh")) avgFlowScfm += val / 60;
    else if (unit.includes("scfd")) avgFlowScfm += val / 1440;
    else if (unit.includes("mmbtu")) avgFlowScfm += (val * 1e6 / 600) / 1440;
    else avgFlowScfm += val;
  }

  if (avgFlowScfm <= 0) avgFlowScfm = 400;

  const getVal = (obj: any, key: string, def: number): number => {
    if (!obj || typeof obj !== "object") return def;
    const v = obj[key];
    if (v && typeof v === "object" && v.value !== undefined) {
      const parsed = parseFloat(String(v.value).replace(/,/g, ""));
      return isNaN(parsed) ? def : parsed;
    }
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const parsed = parseFloat(v.replace(/,/g, ""));
      return isNaN(parsed) ? def : parsed;
    }
    return def;
  };

  const ch4Pct = getVal(specs, "biogasCH4", 60);
  const btuPerScf = ch4Pct * 10.12;

  return {
    avgFlowScfm,
    maxFlowScfm: avgFlowScfm * 1.15,
    minFlowScfm: avgFlowScfm * 0.70,
    ch4Pct,
    co2Pct: getVal(specs, "biogasCO2", 100 - ch4Pct - 2),
    h2sPpm: getVal(specs, "biogasH2S", 1500),
    n2Pct: getVal(specs, "biogasN2", 1.5),
    o2Pct: getVal(specs, "biogasO2", 0.5),
    pressurePsig: getVal(specs, "biogasPressure", 0.5),
    btuPerScf,
  };
}

function buildTypeCAdStages(bg: BiogasInputParams): ADProcessStage[] {
  const stages: ADProcessStage[] = [];
  const prodevalUnit = selectProdevalUnit(bg.avgFlowScfm);
  const prodevalCriteria = getProdevalGasTrainDesignCriteria(bg.avgFlowScfm);
  const volumeLoss = prodevalUnit.volumeLossPct / 100;
  const conditionedScfm = bg.avgFlowScfm * (1 - volumeLoss);
  const methaneRecovery = prodevalUnit.methaneRecovery / 100;
  const rngScfm = conditionedScfm * (bg.ch4Pct / 100) * methaneRecovery / (prodevalUnit.productCH4 / 100);
  const rngScfd = rngScfm * 1440;
  const rngMmbtuPerDay = rngScfd * 1012 / 1e6;
  const biogasScfd = bg.avgFlowScfm * 1440;
  const biogasMmbtuPerDay = biogasScfd * bg.btuPerScf / 1e6;

  stages.push({
    name: "Stage 1: Biogas Input Characterization",
    type: "conditioning",
    inputStream: {
      avgFlowScfm: { value: rv(bg.avgFlowScfm, 1), unit: "SCFM" },
      maxFlowScfm: { value: rv(bg.maxFlowScfm, 1), unit: "SCFM" },
      minFlowScfm: { value: rv(bg.minFlowScfm, 1), unit: "SCFM" },
      dailyFlowScfd: { value: rv(biogasScfd), unit: "SCFD" },
      ch4: { value: bg.ch4Pct, unit: "%" },
      co2: { value: bg.co2Pct, unit: "%" },
      h2s: { value: bg.h2sPpm, unit: "ppm" },
      n2: { value: bg.n2Pct, unit: "%" },
      o2: { value: bg.o2Pct, unit: "%" },
      pressurePsig: { value: bg.pressurePsig, unit: "psig" },
      btuPerScf: { value: rv(bg.btuPerScf, 1), unit: "Btu/SCF" },
      mmbtuPerDay: { value: rv(biogasMmbtuPerDay, 1), unit: "MMBtu/Day" },
    },
    outputStream: {
      avgFlowScfm: { value: rv(bg.avgFlowScfm, 1), unit: "SCFM" },
    },
    designCriteria: {},
    notes: [
      "Existing biogas from facility — no digestion or feedstock receiving in this scope",
      `Biogas composition: ${bg.ch4Pct}% CH₄, ${bg.co2Pct}% CO₂, ${bg.h2sPpm} ppm H₂S`,
    ],
  });

  stages.push({
    name: "Stage 2: Biogas Conditioning — Prodeval VALOGAZ® + VALOPACK®",
    type: "conditioning",
    inputStream: {
      avgFlowScfm: { value: rv(bg.avgFlowScfm, 1), unit: "SCFM" },
      ch4: { value: bg.ch4Pct, unit: "%" },
      co2: { value: bg.co2Pct, unit: "%" },
      h2s: { value: bg.h2sPpm, unit: "ppm" },
      pressurePsig: { value: bg.pressurePsig, unit: "psig" },
    },
    outputStream: {
      avgFlowScfm: { value: rv(conditionedScfm, 1), unit: "SCFM" },
      ch4: { value: bg.ch4Pct, unit: "%" },
      h2s: { value: 7.5, unit: "ppm" },
      pressurePsig: { value: prodevalUnit.acFilterPressurePsig, unit: "psig" },
    },
    designCriteria: {
      ...prodevalCriteria.gasConditioning,
    },
    notes: [
      "Prodeval VALOGAZ® FU 100: Refrigerated condenser for moisture removal",
      "Prodeval VALOGAZ® FU 200: PD blower for gas transport (~2.3 psig)",
      "Prodeval VALOPACK® FU 300: Lead-lag activated carbon for H₂S/siloxane/VOC removal",
    ],
  });

  stages.push({
    name: "Stage 3: Gas Upgrading to RNG — Prodeval VALOPUR®",
    type: "gasUpgrading",
    inputStream: {
      avgFlowScfm: { value: rv(conditionedScfm, 1), unit: "SCFM" },
      ch4: { value: bg.ch4Pct, unit: "%" },
      pressurePsig: { value: prodevalUnit.acFilterPressurePsig, unit: "psig" },
    },
    outputStream: {
      avgFlowScfm: { value: rv(rngScfm, 1), unit: "SCFM" },
      maxFlowScfm: { value: rv(rngScfm * 1.1, 1), unit: "SCFM" },
      minFlowScfm: { value: rv(rngScfm * 0.7, 1), unit: "SCFM" },
      rngFlowScfd: { value: rv(rngScfd), unit: "SCFD" },
      rngCh4: { value: prodevalUnit.productCH4, unit: "%" },
      rngCo2: { value: rv(100 - prodevalUnit.productCH4 - 1.5, 1), unit: "%" },
      rngH2s: { value: 4, unit: "ppm" },
      rngN2: { value: 1.0, unit: "%" },
      rngO2: { value: 0.5, unit: "%" },
      rngPressure: { value: prodevalUnit.rngPressurePsig, unit: "psig" },
      btuPerScf: { value: 1012, unit: "Btu/SCF" },
      rngMmbtuPerDay: { value: rv(rngMmbtuPerDay, 1), unit: "MMBtu/Day" },
    },
    designCriteria: {
      ...prodevalCriteria.gasUpgrading,
    },
    notes: [
      `Prodeval VALOPUR® FU 500: 3-stage membrane separation (${prodevalUnit.methaneRecovery}% CH₄ recovery)`,
      `Prodeval VALOPUR® FU 800: HP compressor for pipeline injection at ${prodevalUnit.rngPressurePsig} psig`,
    ],
  });

  const tailGasScfm = bg.avgFlowScfm - rngScfm;
  stages.push({
    name: "Stage 4: Tail Gas & Emergency Management",
    type: "gasManagement",
    inputStream: {
      tailGasFlowScfm: { value: rv(tailGasScfm, 1), unit: "SCFM" },
      maxBiogasFlowScfm: { value: rv(bg.maxFlowScfm * 1.1, 1), unit: "SCFM" },
    },
    outputStream: {},
    designCriteria: {
      flareCapacity: { value: rv(bg.maxFlowScfm * 1.1, 0), unit: "SCFM", source: "110% of max biogas production" },
      destructionEfficiency: { value: 99.5, unit: "%", source: "EPA regulatory requirement" },
    },
    notes: [
      "Tail gas (CO₂-rich permeate) to enclosed flare/thermal oxidizer",
      "Enclosed flare sized for 110% of maximum biogas flow",
    ],
  });

  return stages;
}

function buildTypeCEquipment(bg: BiogasInputParams): EquipmentItem[] {
  const equipment: EquipmentItem[] = [];
  let idCounter = 0;
  const makeId = (suffix: string) => `det-${suffix}-${idCounter++}`;

  const prodevalEquipment = getProdevalEquipmentList(bg.avgFlowScfm, (suffix) => makeId(suffix || "prodeval"));
  for (const item of prodevalEquipment) {
    equipment.push({
      ...item,
      isOverridden: false,
      isLocked: false,
    });
  }

  equipment.push({
    id: makeId("flare"),
    process: "Emergency Gas Management",
    equipmentType: "Enclosed Flare",
    description: `Enclosed ground flare sized for ${r(bg.maxFlowScfm * 1.1, 0)} SCFM (110% of max biogas)`,
    quantity: 1,
    specs: {
      capacity: { value: r(bg.maxFlowScfm * 1.1, 0), unit: "SCFM" },
      destructionEfficiency: { value: "99.5", unit: "%" },
      dimensionsL: { value: "8", unit: "ft (dia)" },
      dimensionsW: { value: "8", unit: "ft (dia)" },
      dimensionsH: { value: "25", unit: "ft" },
      power: { value: "3", unit: "HP" },
    },
    designBasis: "110% of maximum biogas production, ≥99.5% destruction",
    notes: "Required for startup, shutdown, upset conditions, and RNG system maintenance",
    isOverridden: false,
    isLocked: false,
  });

  return equipment;
}

function buildTypeCAssumptions(bg: BiogasInputParams): Array<{ parameter: string; value: string; source: string }> {
  const prodevalUnit = selectProdevalUnit(bg.avgFlowScfm);
  return [
    { parameter: "Project Type", value: "Type C — RNG Bolt-On (biogas upgrading only)", source: "User selection" },
    { parameter: "Biogas Source", value: "Existing facility biogas (not in scope)", source: "Bolt-on project definition" },
    { parameter: "Average Biogas Flow", value: `${r(bg.avgFlowScfm, 1)} SCFM`, source: "UPIF / user input" },
    { parameter: "Biogas CH₄ Content", value: `${bg.ch4Pct}%`, source: "UPIF / default" },
    { parameter: "Biogas H₂S", value: `${r(bg.h2sPpm)} ppm`, source: "UPIF / conservative estimate" },
    { parameter: "RNG Heating Value", value: "1,012 BTU/SCF", source: "Pipeline-quality RNG standard" },
    { parameter: "Gas Upgrading Vendor", value: "Prodeval (VALOGAZ®/VALOPACK®/VALOPUR®)", source: "Default vendor specification" },
    { parameter: "Methane Recovery", value: `${prodevalUnit.methaneRecovery}%`, source: "Prodeval VALOPUR® membrane spec" },
    { parameter: "Product RNG Purity", value: `≥${prodevalUnit.productCH4}% CH₄`, source: "Prodeval VALOPUR® membrane spec" },
    { parameter: "Pipeline Injection Pressure", value: `${prodevalUnit.rngPressurePsig} psig`, source: "Prodeval VALOPUR® FU 800 spec" },
    { parameter: "Electrical Demand", value: "~8.8 kWh/1,000 scf raw biogas", source: "Prodeval system spec" },
    { parameter: "Operating Days Per Year", value: "365", source: "Continuous operation" },
  ];
}

function buildTypeCSummary(bg: BiogasInputParams): Record<string, { value: string; unit: string }> {
  const prodevalUnit = selectProdevalUnit(bg.avgFlowScfm);
  const volumeLoss = prodevalUnit.volumeLossPct / 100;
  const conditionedScfm = bg.avgFlowScfm * (1 - volumeLoss);
  const methaneRecovery = prodevalUnit.methaneRecovery / 100;
  const rngScfm = conditionedScfm * (bg.ch4Pct / 100) * methaneRecovery / (prodevalUnit.productCH4 / 100);
  const rngScfd = rngScfm * 1440;
  const rngMmbtuPerDay = rngScfd * 1012 / 1e6;
  const biogasScfd = bg.avgFlowScfm * 1440;
  const biogasMmbtuPerDay = biogasScfd * bg.btuPerScf / 1e6;
  const tailGasScfm = bg.avgFlowScfm - rngScfm;
  const electricalKw = bg.avgFlowScfm * 60 * 8.8 / 1000;

  return {
    biogasAvgFlowScfm: { value: r(bg.avgFlowScfm, 1), unit: "SCFM" },
    biogasMaxFlowScfm: { value: r(bg.maxFlowScfm, 1), unit: "SCFM" },
    biogasMinFlowScfm: { value: r(bg.minFlowScfm, 1), unit: "SCFM" },
    biogasPressurePsig: { value: r(bg.pressurePsig, 1), unit: "psig" },
    biogasCH4: { value: r(bg.ch4Pct, 1), unit: "%" },
    biogasCO2: { value: r(bg.co2Pct, 1), unit: "%" },
    biogasH2S: { value: r(bg.h2sPpm), unit: "ppm" },
    biogasN2: { value: r(bg.n2Pct, 1), unit: "%" },
    biogasO2: { value: r(bg.o2Pct, 1), unit: "%" },
    biogasBtuPerScf: { value: r(bg.btuPerScf, 1), unit: "Btu/SCF" },
    biogasMmbtuPerDay: { value: r(biogasMmbtuPerDay, 1), unit: "MMBtu/Day" },
    rngAvgFlowScfm: { value: r(rngScfm, 1), unit: "SCFM" },
    rngMaxFlowScfm: { value: r(rngScfm * 1.1, 1), unit: "SCFM" },
    rngMinFlowScfm: { value: r(rngScfm * 0.7, 1), unit: "SCFM" },
    rngPressurePsig: { value: String(prodevalUnit.rngPressurePsig), unit: "psig" },
    rngCH4: { value: String(prodevalUnit.productCH4), unit: "%" },
    rngCO2: { value: r(100 - prodevalUnit.productCH4 - 1.5, 1), unit: "%" },
    rngH2S: { value: "4", unit: "ppm" },
    rngN2: { value: "1.0", unit: "%" },
    rngO2: { value: "0.5", unit: "%" },
    rngBtuPerScf: { value: "1,012", unit: "Btu/SCF" },
    rngMmbtuPerDay: { value: r(rngMmbtuPerDay, 1), unit: "MMBtu/Day" },
    methaneRecovery: { value: String(prodevalUnit.methaneRecovery), unit: "%" },
    tailgasFlow: { value: r(tailGasScfm, 1), unit: "SCFM" },
    electricalDemand: { value: r(electricalKw, 0), unit: "kW" },
  };
}

const MAX_PRODEVAL_CAPACITY_SCFM = 1200;

function generateTypeCMassBalance(upif: any): DeterministicMBResult {
  console.log(`Deterministic MB: Starting Type C (Bolt-On) calculation`);
  const startTime = Date.now();

  const bg = parseBiogasInput(upif);
  console.log(`Deterministic MB: Biogas input = ${r(bg.avgFlowScfm, 1)} SCFM, ${bg.ch4Pct}% CH₄, ${bg.h2sPpm} ppm H₂S`);

  if (bg.avgFlowScfm > MAX_PRODEVAL_CAPACITY_SCFM) {
    throw new Error(`Biogas flow of ${r(bg.avgFlowScfm, 0)} SCFM exceeds maximum Prodeval equipment capacity (${MAX_PRODEVAL_CAPACITY_SCFM} SCFM). Falling back to AI for custom solution.`);
  }

  const prodevalUnit = selectProdevalUnit(bg.avgFlowScfm);
  const volumeLoss = prodevalUnit.volumeLossPct / 100;
  const conditionedScfm = bg.avgFlowScfm * (1 - volumeLoss);
  const methaneRecovery = prodevalUnit.methaneRecovery / 100;
  const rngScfm = conditionedScfm * (bg.ch4Pct / 100) * methaneRecovery / (prodevalUnit.productCH4 / 100);
  const rngMmbtuPerDay = rngScfm * 1440 * 1012 / 1e6;
  console.log(`Deterministic MB: RNG = ${r(rngScfm, 1)} SCFM (${r(rngMmbtuPerDay, 1)} MMBTU/day)`);

  const adStages = buildTypeCAdStages(bg);
  const equipment = buildTypeCEquipment(bg);
  const assumptions = buildTypeCAssumptions(bg);
  const summary = buildTypeCSummary(bg);

  const warnings: Array<{ field: string; message: string; severity: "error" | "warning" | "info" }> = [];
  warnings.push({
    field: "method",
    message: "Mass balance generated using deterministic engineering calculations for Type C (Bolt-On) — biogas upgrading only, no feedstock receiving or digestion.",
    severity: "info",
  });

  if (bg.avgFlowScfm > prodevalUnit.nominalCapacityScfm * 1.1) {
    warnings.push({
      field: "gasUpgrading",
      message: `Biogas flow (${r(bg.avgFlowScfm, 0)} SCFM) exceeds selected Prodeval unit capacity (${prodevalUnit.nominalCapacityScfm} SCFM). Consider additional trains.`,
      severity: "warning",
    });
  }

  const dummyCalc: BiogasCalcResult = {
    totalFeedTonsPerYear: 0,
    totalFeedTonsPerDay: 0,
    totalFeedLbPerDay: 0,
    totalTsLbPerDay: 0,
    totalVsLbPerDay: 0,
    vsDestroyedLbPerDay: 0,
    vsDestructionPct: 0,
    biogasScfd: bg.avgFlowScfm * 1440,
    biogasScfm: bg.avgFlowScfm,
    ch4Pct: bg.ch4Pct,
    co2Pct: bg.co2Pct,
    ch4Scfd: bg.avgFlowScfm * 1440 * bg.ch4Pct / 100,
    rngScfd: rngScfm * 1440,
    rngScfm,
    rngMmbtuPerDay,
    digestateLbPerDay: 0,
    digestateTsPct: 0,
    cakeLbPerDay: 0,
    cakeTsPct: 0,
    centrateLbPerDay: 0,
  };

  const results: MassBalanceResults = {
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

  const elapsed = Date.now() - startTime;
  console.log(`Deterministic MB: Type C complete in ${elapsed}ms — ${adStages.length} stages, ${equipment.length} equipment items`);

  return { results, feedstocks: [], calculations: dummyCalc };
}

function generateTypeDMassBalance(upif: any): DeterministicMBResult {
  console.log(`Deterministic MB: Starting Type D (Hybrid) calculation`);
  const startTime = Date.now();

  const feedstocks = parseFeedstocks(upif);
  const hasFeedstocks = feedstocks.length > 0 && feedstocks.reduce((sum, f) => sum + f.tonsPerYear, 0) > 0;

  const wwSpecs = upif.outputSpecs || {};
  const getWwVal = (key: string, def: number): number => {
    const v = wwSpecs[key];
    if (v && typeof v === "object" && v.value !== undefined) {
      const parsed = parseFloat(String(v.value).replace(/,/g, ""));
      return isNaN(parsed) ? def : parsed;
    }
    return def;
  };

  const wwFlowMgd = getWwVal("designFlow", 1.0);
  const wwFlowGpd = wwFlowMgd * 1e6;
  const wwBod = getWwVal("bodInfluent", 250);
  const wwCod = getWwVal("codInfluent", 500);
  const wwTss = getWwVal("tssInfluent", 250);
  const wwTkn = getWwVal("tknInfluent", 35);
  const wwTp = getWwVal("tpInfluent", 6);

  const primaryBodRemoval = 0.35;
  const primaryTssRemoval = 0.60;
  const primaryCodRemoval = 0.35;

  const primaryEffBod = wwBod * (1 - primaryBodRemoval);
  const primaryEffTss = wwTss * (1 - primaryTssRemoval);
  const primaryEffCod = wwCod * (1 - primaryCodRemoval);

  const secondaryBodRemoval = 0.90;
  const secondaryTssRemoval = 0.88;
  const secondaryCodRemoval = 0.85;
  const secondaryEffBod = primaryEffBod * (1 - secondaryBodRemoval);
  const secondaryEffTss = primaryEffTss * (1 - secondaryTssRemoval);
  const secondaryEffCod = primaryEffCod * (1 - secondaryCodRemoval);
  const secondaryEffTkn = wwTkn * 0.30;
  const secondaryEffTp = wwTp * 0.50;

  const stages: any[] = [
    {
      name: "Preliminary Treatment",
      type: "preliminary",
      influent: { flow: wwFlowMgd, bod: wwBod, cod: wwCod, tss: wwTss, tkn: wwTkn, tp: wwTp, fog: 100, unit: "mg/L" },
      effluent: { flow: wwFlowMgd, bod: wwBod, cod: wwCod, tss: wwTss * 0.95, tkn: wwTkn, tp: wwTp, fog: 100, unit: "mg/L" },
      removalEfficiencies: { BOD: 0, COD: 0, TSS: 5 },
      designCriteria: {
        barScreenOpening: { value: 6, unit: "mm", source: "Ten States Standards" },
        gritRemoval: { value: 95, unit: "%", source: "WEF MOP 8" },
      },
      notes: ["Mechanical bar screen (6mm opening)", "Aerated grit chamber"],
    },
    {
      name: "Primary Clarification",
      type: "primary",
      influent: { flow: wwFlowMgd, bod: wwBod, cod: wwCod, tss: wwTss, tkn: wwTkn, tp: wwTp, fog: 100, unit: "mg/L" },
      effluent: { flow: wwFlowMgd, bod: rv(primaryEffBod, 1), cod: rv(primaryEffCod, 1), tss: rv(primaryEffTss, 1), tkn: wwTkn, tp: wwTp, fog: 30, unit: "mg/L" },
      removalEfficiencies: { BOD: rv(primaryBodRemoval * 100), COD: rv(primaryCodRemoval * 100), TSS: rv(primaryTssRemoval * 100) },
      designCriteria: {
        surfaceOverflowRate: { value: 800, unit: "gpd/ft²", source: "Ten States Standards" },
        detentionTime: { value: 2, unit: "hours", source: "WEF MOP 8" },
      },
      notes: ["Circular primary clarifier with sludge collection", `Primary sludge: ~${rv(wwFlowMgd * 8.34 * wwTss * primaryTssRemoval * 0.001 / 0.04, 0)} GPD at 4% TS`],
    },
    {
      name: "Secondary Treatment (Activated Sludge)",
      type: "secondary",
      influent: { flow: wwFlowMgd, bod: rv(primaryEffBod, 1), cod: rv(primaryEffCod, 1), tss: rv(primaryEffTss, 1), tkn: wwTkn, tp: wwTp, fog: 30, unit: "mg/L" },
      effluent: { flow: wwFlowMgd, bod: rv(secondaryEffBod, 1), cod: rv(secondaryEffCod, 1), tss: rv(secondaryEffTss, 1), tkn: rv(secondaryEffTkn, 1), tp: rv(secondaryEffTp, 1), fog: 5, unit: "mg/L" },
      removalEfficiencies: { BOD: rv(secondaryBodRemoval * 100), COD: rv(secondaryCodRemoval * 100), TSS: rv(secondaryTssRemoval * 100) },
      designCriteria: {
        srt: { value: 10, unit: "days", source: "Design standard" },
        mlss: { value: 3000, unit: "mg/L", source: "Conventional activated sludge" },
        fmRatio: { value: 0.25, unit: "lb BOD/lb MLVSS·d", source: "Design guideline" },
      },
      notes: ["Conventional activated sludge with secondary clarifiers", "WAS generated feeds AD system"],
    },
    {
      name: "Disinfection",
      type: "disinfection",
      influent: { flow: wwFlowMgd, bod: rv(secondaryEffBod, 1), cod: rv(secondaryEffCod, 1), tss: rv(secondaryEffTss, 1), tkn: rv(secondaryEffTkn, 1), tp: rv(secondaryEffTp, 1), fog: 5, unit: "mg/L" },
      effluent: { flow: wwFlowMgd, bod: rv(secondaryEffBod, 1), cod: rv(secondaryEffCod, 1), tss: rv(secondaryEffTss, 1), tkn: rv(secondaryEffTkn, 1), tp: rv(secondaryEffTp, 1), fog: 5, unit: "mg/L" },
      removalEfficiencies: { BOD: 0, COD: 0, TSS: 0 },
      designCriteria: {
        contactTime: { value: 30, unit: "min", source: "EPA guidelines" },
        uvDose: { value: 40, unit: "mJ/cm²", source: "NWRI guidelines" },
      },
      notes: ["UV disinfection system", "Meets NPDES discharge requirements"],
    },
  ];

  const primarySludgeLbPerDay = wwFlowGpd * 8.34 * wwTss * primaryTssRemoval / 1e6;
  const primarySludgeTsPct = 4;

  const wasYieldCoeff = 0.5;
  const bodRemovedLbPerDay = wwFlowGpd * 8.34 * primaryEffBod * secondaryBodRemoval / 1e6;
  const wasVssLbPerDay = bodRemovedLbPerDay * wasYieldCoeff;
  const wasTssLbPerDay = wasVssLbPerDay / 0.8;
  const wasTsPct = 1.0;
  const wasLbPerDay = wasTssLbPerDay / (wasTsPct / 100);

  const totalSludgeLbPerDay = (primarySludgeLbPerDay / (primarySludgeTsPct / 100)) + wasLbPerDay;
  const totalSludgeTsLbPerDay = primarySludgeLbPerDay + wasTssLbPerDay;
  const totalSludgeTsPct = (totalSludgeTsLbPerDay / totalSludgeLbPerDay) * 100;
  const sludgeVsPctOfTs = 75;
  const sludgeVsLbPerDay = totalSludgeTsLbPerDay * (sludgeVsPctOfTs / 100);

  let totalVsLbPerDay = sludgeVsLbPerDay;
  let totalTsLbPerDay = totalSludgeTsLbPerDay;
  let totalFeedLbPerDay = totalSludgeLbPerDay;
  let totalFeedTpy = 0;

  const CH4_PCT = 60;
  const CO2_PCT = 40;
  const M3_TO_SCF = 35.3147;
  const KG_TO_LB = 2.20462;
  const VS_DESTRUCTION_PCT = 90;
  const SLUDGE_BMP = 0.22;

  let coDigestionFeedstocks: ParsedFeedstock[] = [];
  if (hasFeedstocks) {
    coDigestionFeedstocks = feedstocks;
    for (const fs of coDigestionFeedstocks) {
      const tpd = fs.tonsPerYear / 365;
      const lbPerDay = tpd * 2000 * (1 - fs.depackagingRejectPct / 100);
      const tsLb = lbPerDay * (fs.tsPct / 100);
      const vsLb = tsLb * (fs.vsPctOfTs / 100);
      totalVsLbPerDay += vsLb;
      totalTsLbPerDay += tsLb;
      totalFeedLbPerDay += lbPerDay;
      totalFeedTpy += fs.tonsPerYear;
    }
  }

  const vsDestroyedLbPerDay = totalVsLbPerDay * (VS_DESTRUCTION_PCT / 100);
  const vsDestroyedKgPerDay = vsDestroyedLbPerDay / KG_TO_LB;

  let totalCH4M3PerDay = (sludgeVsLbPerDay * (VS_DESTRUCTION_PCT / 100) / KG_TO_LB) * SLUDGE_BMP;
  for (const fs of coDigestionFeedstocks) {
    const tpd = fs.tonsPerYear / 365;
    const lbPerDay = tpd * 2000 * (1 - fs.depackagingRejectPct / 100);
    const tsLb = lbPerDay * (fs.tsPct / 100);
    const vsLb = tsLb * (fs.vsPctOfTs / 100);
    const vsDestroyed = vsLb * (VS_DESTRUCTION_PCT / 100);
    totalCH4M3PerDay += (vsDestroyed / KG_TO_LB) * fs.bmpM3CH4PerKgVS;
  }

  const ch4Scfd = totalCH4M3PerDay * M3_TO_SCF;
  const biogasScfd = ch4Scfd / (CH4_PCT / 100);
  const biogasScfm = biogasScfd / 1440;

  const prodevalUnit = selectProdevalUnit(biogasScfm);
  const methaneRecovery = prodevalUnit.methaneRecovery / 100;
  const volumeLoss = prodevalUnit.volumeLossPct / 100;
  const conditionedBiogasScfd = biogasScfd * (1 - volumeLoss);
  const rngScfd = conditionedBiogasScfd * (CH4_PCT / 100) * methaneRecovery / (prodevalUnit.productCH4 / 100);
  const rngScfm = rngScfd / 1440;
  const rngMmbtuPerDay = rngScfd * 1012 / 1e6;

  console.log(`Deterministic MB: WW sludge VS = ${r(sludgeVsLbPerDay)} lb/d, Co-digestion VS = ${r(totalVsLbPerDay - sludgeVsLbPerDay)} lb/d`);
  console.log(`Deterministic MB: Biogas = ${r(biogasScfm, 1)} SCFM, RNG = ${r(rngScfm, 1)} SCFM (${r(rngMmbtuPerDay, 1)} MMBTU/day)`);

  if (biogasScfm > MAX_PRODEVAL_CAPACITY_SCFM) {
    throw new Error(`Biogas flow of ${r(biogasScfm, 0)} SCFM exceeds maximum Prodeval equipment capacity (${MAX_PRODEVAL_CAPACITY_SCFM} SCFM). Falling back to AI for custom solution.`);
  }

  const feedDensity = 8.34;
  const feedGpd = totalFeedLbPerDay / feedDensity;
  const HRT_DAYS = 20;
  const digesterVolumeGal = feedGpd * HRT_DAYS * 1.12;
  const digesterVolumeM3 = digesterVolumeGal * 0.003785;
  const numDigesters = digesterVolumeGal > 500000 ? 2 : 1;

  const prodevalCriteria = getProdevalGasTrainDesignCriteria(biogasScfm);
  const conditionedScfm = biogasScfm * (1 - volumeLoss);

  const adStages: ADProcessStage[] = [];

  adStages.push({
    name: "Stage 1: Sludge Thickening & Blending",
    type: "receiving",
    inputStream: {
      primarySludgeLbPerDay: { value: rv(primarySludgeLbPerDay / (primarySludgeTsPct / 100)), unit: "lb/d" },
      primarySludgeTs: { value: primarySludgeTsPct, unit: "%" },
      wasLbPerDay: { value: rv(wasLbPerDay), unit: "lb/d" },
      wasTs: { value: wasTsPct, unit: "%" },
      ...(hasFeedstocks ? { coDigestionLbPerDay: { value: rv(totalFeedLbPerDay - totalSludgeLbPerDay), unit: "lb/d" } } : {}),
    },
    outputStream: {
      blendedFeedLbPerDay: { value: rv(totalFeedLbPerDay), unit: "lb/d" },
      blendedFeedGpd: { value: rv(feedGpd), unit: "GPD" },
      blendedTsPct: { value: rv(Math.min(totalSludgeTsPct + (hasFeedstocks ? 2 : 0), 8), 1), unit: "%" },
    },
    designCriteria: {
      gravityBeltThickener: { value: 5, unit: "% TS target", source: "WEF MOP 8" },
    },
    notes: [
      `Primary sludge: ${r(primarySludgeLbPerDay)} lb/d TS at ${primarySludgeTsPct}%`,
      `WAS: ${r(wasTssLbPerDay)} lb/d TS at ${wasTsPct}%`,
      ...(hasFeedstocks ? coDigestionFeedstocks.map(f => `Co-digestion: ${f.name} — ${r(f.tonsPerYear)} TPY`) : []),
    ],
  });

  adStages.push({
    name: "Stage 2: Anaerobic Digestion (Mesophilic)",
    type: "digester",
    inputStream: {
      flowGPD: { value: rv(feedGpd), unit: "GPD" },
      flowLbPerDay: { value: rv(totalFeedLbPerDay), unit: "lb/d" },
      totalSolidsLbPerDay: { value: rv(totalTsLbPerDay), unit: "lb/d" },
      volatileSolidsLbPerDay: { value: rv(totalVsLbPerDay), unit: "lb/d" },
    },
    outputStream: {
      digestateLbPerDay: { value: rv(totalFeedLbPerDay - vsDestroyedLbPerDay * 0.95), unit: "lb/d" },
      biogasFlow: { value: rv(biogasScfm, 1), unit: "SCFM" },
      biogasScfd: { value: rv(biogasScfd), unit: "SCFD" },
      ch4Content: { value: CH4_PCT, unit: "%" },
    },
    designCriteria: {
      hrt: { value: HRT_DAYS, unit: "days", source: "Sludge digestion standard (15-25 days)" },
      vsDestruction: { value: VS_DESTRUCTION_PCT, unit: "%", source: "Sludge + co-digestion typical" },
      temperature: { value: 98, unit: "°F", source: "Mesophilic range" },
      digesterVolume: { value: rv(digesterVolumeGal), unit: "gal", source: "Feed × HRT × 1.12" },
    },
    notes: [
      `VS destroyed: ${r(vsDestroyedLbPerDay)} lb/d (${VS_DESTRUCTION_PCT}% destruction)`,
      `Digester volume: ${r(digesterVolumeGal)} gal (${r(digesterVolumeM3)} m³)`,
      `${numDigesters} digester(s) in ${numDigesters > 1 ? "parallel" : "single train"}`,
    ],
  });

  const digestateLb = totalFeedLbPerDay - vsDestroyedLbPerDay * 0.95;
  const remainingTs = totalTsLbPerDay - vsDestroyedLbPerDay;
  const cakeTsPct = 25;
  const solidsCaptureEff = 0.90;
  const cakeSolidsLb = remainingTs * solidsCaptureEff;
  const cakeLbPerDay = cakeSolidsLb / (cakeTsPct / 100);
  const centrateLbPerDay = digestateLb - cakeLbPerDay;

  adStages.push({
    name: "Stage 3: Digestate Dewatering",
    type: "solidsSeparation",
    inputStream: {
      digestateLbPerDay: { value: rv(digestateLb), unit: "lb/d" },
    },
    outputStream: {
      cakeLbPerDay: { value: rv(cakeLbPerDay), unit: "lb/d" },
      cakeTsPct: { value: cakeTsPct, unit: "%" },
      centrateLbPerDay: { value: rv(centrateLbPerDay), unit: "lb/d" },
    },
    designCriteria: {
      solidsCaptureEfficiency: { value: rv(solidsCaptureEff * 100), unit: "%", source: "Belt filter press typical" },
      cakeSolids: { value: cakeTsPct, unit: "%", source: "Belt press design" },
    },
    notes: [
      "Belt filter press for sludge dewatering",
      "Centrate/filtrate returned to headworks",
    ],
  });

  adStages.push({
    name: "Stage 4: Biogas Conditioning — Prodeval VALOGAZ® + VALOPACK®",
    type: "gasConditioning",
    inputStream: {
      avgFlowScfm: { value: rv(biogasScfm, 1), unit: "SCFM" },
      ch4: { value: CH4_PCT, unit: "%" },
      co2: { value: CO2_PCT, unit: "%" },
      h2s: { value: 1500, unit: "ppmv" },
      pressurePsig: { value: 0.5, unit: "psig" },
    },
    outputStream: {
      avgFlowScfm: { value: rv(conditionedScfm, 1), unit: "SCFM" },
      ch4: { value: CH4_PCT, unit: "%" },
      h2s: { value: 7.5, unit: "ppmv" },
      pressurePsig: { value: prodevalUnit.acFilterPressurePsig, unit: "psig" },
    },
    designCriteria: { ...prodevalCriteria.gasConditioning },
    notes: [
      "Prodeval VALOGAZ® FU 100: Refrigerated condenser",
      "Prodeval VALOGAZ® FU 200: PD blower",
      "Prodeval VALOPACK® FU 300: Lead-lag activated carbon",
    ],
  });

  adStages.push({
    name: "Stage 5: Gas Upgrading to RNG — Prodeval VALOPUR®",
    type: "gasUpgrading",
    inputStream: {
      avgFlowScfm: { value: rv(conditionedScfm, 1), unit: "SCFM" },
      ch4: { value: CH4_PCT, unit: "%" },
      pressurePsig: { value: prodevalUnit.acFilterPressurePsig, unit: "psig" },
    },
    outputStream: {
      rngFlowScfm: { value: rv(rngScfm, 1), unit: "SCFM" },
      rngFlowScfd: { value: rv(rngScfd), unit: "SCFD" },
      rngCh4: { value: prodevalUnit.productCH4, unit: "%" },
      rngPressure: { value: prodevalUnit.rngPressurePsig, unit: "psig" },
      rngMmbtuPerDay: { value: rv(rngMmbtuPerDay, 1), unit: "MMBTU/day" },
      rngMmbtuPerYear: { value: rv(rngMmbtuPerDay * 365), unit: "MMBTU/yr" },
    },
    designCriteria: { ...prodevalCriteria.gasUpgrading },
    notes: [
      `Prodeval VALOPUR® FU 500: 3-stage membrane (${prodevalUnit.methaneRecovery}% CH₄ recovery)`,
      `Prodeval VALOPUR® FU 800: HP compressor at ${prodevalUnit.rngPressurePsig} psig`,
    ],
  });

  adStages.push({
    name: "Stage 6: Emergency/Backup Gas Management",
    type: "gasManagement",
    inputStream: {
      maxBiogasFlowScfm: { value: rv(biogasScfm * 1.1, 1), unit: "SCFM" },
    },
    outputStream: {},
    designCriteria: {
      flareCapacity: { value: rv(biogasScfm * 1.1, 0), unit: "SCFM", source: "110% of max biogas production" },
      destructionEfficiency: { value: 99.5, unit: "%", source: "EPA regulatory requirement" },
    },
    notes: ["Enclosed flare for startup, shutdown, and upset conditions"],
  });

  const equipment: EquipmentItem[] = [];
  let idCounter = 0;
  const makeId = (suffix: string) => `det-${suffix}-${idCounter++}`;

  equipment.push({
    id: makeId("bar-screen"),
    process: "Preliminary Treatment",
    equipmentType: "Mechanical Bar Screen",
    description: `Mechanical bar screen, 6mm opening, ${r(wwFlowMgd, 2)} MGD capacity`,
    quantity: 1,
    specs: { capacity: { value: r(wwFlowMgd, 2), unit: "MGD" }, opening: { value: "6", unit: "mm" }, dimensionsL: { value: "8", unit: "ft" }, dimensionsW: { value: "4", unit: "ft" }, dimensionsH: { value: "10", unit: "ft" }, power: { value: "3", unit: "HP" } },
    designBasis: "Preliminary screening at design flow",
    notes: "Includes screenings conveyor and washer/compactor",
    isOverridden: false, isLocked: false,
  });

  equipment.push({
    id: makeId("grit-chamber"),
    process: "Preliminary Treatment",
    equipmentType: "Aerated Grit Chamber",
    description: `Aerated grit chamber, ${r(wwFlowMgd, 2)} MGD capacity`,
    quantity: 1,
    specs: { capacity: { value: r(wwFlowMgd, 2), unit: "MGD" }, detentionTime: { value: "3", unit: "min" }, dimensionsL: { value: "20", unit: "ft" }, dimensionsW: { value: "6", unit: "ft" }, dimensionsH: { value: "10", unit: "ft" }, power: { value: "5", unit: "HP" } },
    designBasis: "95% grit removal at design flow",
    notes: "Aerated design for grit separation; includes grit classifier",
    isOverridden: false, isLocked: false,
  });

  const clarifierArea = wwFlowGpd / 800;
  const clarifierDia = rv(Math.sqrt(clarifierArea * 4 / Math.PI), 0);
  equipment.push({
    id: makeId("primary-clarifier"),
    process: "Primary Treatment",
    equipmentType: "Primary Clarifier",
    description: `Circular primary clarifier, ${clarifierDia} ft diameter`,
    quantity: 1,
    specs: { surfaceArea: { value: r(clarifierArea), unit: "ft²" }, overflowRate: { value: "800", unit: "gpd/ft²" }, detentionTime: { value: "2", unit: "hours" }, dimensionsL: { value: String(clarifierDia), unit: "ft (dia)" }, dimensionsW: { value: String(clarifierDia), unit: "ft (dia)" }, dimensionsH: { value: "12", unit: "ft" }, power: { value: "3", unit: "HP" } },
    designBasis: "800 gpd/ft² overflow rate at design flow",
    notes: "Includes sludge collector mechanism and scum removal",
    isOverridden: false, isLocked: false,
  });

  const aerationVolGal = wwFlowGpd * 0.25;
  equipment.push({
    id: makeId("aeration-basin"),
    process: "Secondary Treatment",
    equipmentType: "Aeration Basin",
    description: `Activated sludge aeration basin, ${r(aerationVolGal)} gal`,
    quantity: 1,
    specs: { volume: { value: r(aerationVolGal), unit: "gal" }, hrt: { value: "6", unit: "hours" }, mlss: { value: "3,000", unit: "mg/L" }, dimensionsL: { value: r(Math.pow(aerationVolGal / 7.48, 1/3) * 2, 0), unit: "ft" }, dimensionsW: { value: r(Math.pow(aerationVolGal / 7.48, 1/3), 0), unit: "ft" }, dimensionsH: { value: "15", unit: "ft" }, power: { value: r(aerationVolGal * 0.003785 * 20 / 746, 0), unit: "HP" } },
    designBasis: "6-hour HRT, 3,000 mg/L MLSS, conventional activated sludge",
    notes: "Fine bubble diffused aeration; includes RAS/WAS pumping",
    isOverridden: false, isLocked: false,
  });

  const secClarArea = wwFlowGpd / 600;
  const secClarDia = rv(Math.sqrt(secClarArea * 4 / Math.PI), 0);
  equipment.push({
    id: makeId("secondary-clarifier"),
    process: "Secondary Treatment",
    equipmentType: "Secondary Clarifier",
    description: `Circular secondary clarifier, ${secClarDia} ft diameter`,
    quantity: 1,
    specs: { surfaceArea: { value: r(secClarArea), unit: "ft²" }, overflowRate: { value: "600", unit: "gpd/ft²" }, dimensionsL: { value: String(secClarDia), unit: "ft (dia)" }, dimensionsW: { value: String(secClarDia), unit: "ft (dia)" }, dimensionsH: { value: "14", unit: "ft" }, power: { value: "3", unit: "HP" } },
    designBasis: "600 gpd/ft² overflow rate at design flow",
    notes: "Includes sludge collector and RAS/WAS wells",
    isOverridden: false, isLocked: false,
  });

  equipment.push({
    id: makeId("uv-disinfection"),
    process: "Disinfection",
    equipmentType: "UV Disinfection System",
    description: `UV disinfection, ${r(wwFlowMgd, 2)} MGD capacity, 40 mJ/cm² dose`,
    quantity: 1,
    specs: { capacity: { value: r(wwFlowMgd, 2), unit: "MGD" }, uvDose: { value: "40", unit: "mJ/cm²" }, contactTime: { value: "30", unit: "seconds" }, dimensionsL: { value: "12", unit: "ft" }, dimensionsW: { value: "4", unit: "ft" }, dimensionsH: { value: "3", unit: "ft" }, power: { value: r(Math.max(5, wwFlowMgd * 15), 0), unit: "kW" } },
    designBasis: "NWRI UV disinfection guidelines, 40 mJ/cm²",
    notes: "Medium-pressure UV lamps with automatic wiper system",
    isOverridden: false, isLocked: false,
  });

  equipment.push({
    id: makeId("gravity-belt"),
    process: "Sludge Thickening",
    equipmentType: "Gravity Belt Thickener",
    description: "Gravity belt thickener for WAS thickening",
    quantity: 1,
    specs: { throughput: { value: r(wasLbPerDay / 2000, 1), unit: "TPD" }, thickenedTs: { value: "5", unit: "%" }, dimensionsL: { value: "12", unit: "ft" }, dimensionsW: { value: "6", unit: "ft" }, dimensionsH: { value: "5", unit: "ft" }, power: { value: "5", unit: "HP" } },
    designBasis: "WAS thickening from 1% to 5% TS",
    notes: "Polymer conditioning; filtrate returned to headworks",
    isOverridden: false, isLocked: false,
  });

  if (hasFeedstocks) {
    equipment.push({
      id: makeId("receiving-co"),
      process: "Co-Digestion Receiving",
      equipmentType: "Receiving Station",
      description: "Receiving station for trucked-in co-digestion feedstocks",
      quantity: 1,
      specs: { capacity: { value: r(totalFeedTpy / 365, 1), unit: "TPD" }, dimensionsL: { value: "40", unit: "ft" }, dimensionsW: { value: "30", unit: "ft" }, dimensionsH: { value: "15", unit: "ft" }, power: { value: "5", unit: "HP" } },
      designBasis: "Covered receiving with truck scale",
      notes: `Co-digestion feedstocks: ${coDigestionFeedstocks.map(f => f.name).join(", ")}`,
      isOverridden: false, isLocked: false,
    });
  }

  const perDigesterGal = digesterVolumeGal / numDigesters;
  const diamFt = rv(Math.pow(perDigesterGal / 7.48 / (Math.PI / 4) / 25, 0.5), 0);
  equipment.push({
    id: makeId("digester"),
    process: "Anaerobic Digestion",
    equipmentType: "Mesophilic Anaerobic Digester",
    description: `Mesophilic digester, ${r(perDigesterGal)} gal each, ${HRT_DAYS}-day HRT`,
    quantity: numDigesters,
    specs: { volumePerUnit: { value: r(perDigesterGal), unit: "gal" }, totalVolume: { value: r(digesterVolumeGal), unit: "gal" }, hrt: { value: String(HRT_DAYS), unit: "days" }, temperature: { value: "98", unit: "°F" }, dimensionsL: { value: String(Math.max(30, diamFt)), unit: "ft (dia)" }, dimensionsW: { value: String(Math.max(30, diamFt)), unit: "ft (dia)" }, dimensionsH: { value: "25", unit: "ft" }, power: { value: r(digesterVolumeM3 * 6 / 746 / numDigesters, 0), unit: "HP" } },
    designBasis: `${HRT_DAYS}-day HRT, mesophilic (98°F), ${VS_DESTRUCTION_PCT}% VS destruction`,
    notes: `${numDigesters > 1 ? numDigesters + " digesters; " : ""}Heated and insulated with gas collection dome`,
    isOverridden: false, isLocked: false,
  });

  equipment.push({
    id: makeId("belt-press"),
    process: "Sludge Dewatering",
    equipmentType: "Belt Filter Press",
    description: `Belt filter press for digestate dewatering`,
    quantity: 1,
    specs: { throughput: { value: r(digestateLb / 2000, 1), unit: "TPD" }, cakeSolids: { value: String(cakeTsPct), unit: "%" }, solidsCaptureEfficiency: { value: String(rv(solidsCaptureEff * 100)), unit: "%" }, dimensionsL: { value: "14", unit: "ft" }, dimensionsW: { value: "8", unit: "ft" }, dimensionsH: { value: "6", unit: "ft" }, power: { value: "15", unit: "HP" } },
    designBasis: "Belt filter press with polymer conditioning",
    notes: "Filtrate returned to headworks",
    isOverridden: false, isLocked: false,
  });

  const prodevalEquipment = getProdevalEquipmentList(biogasScfm, (suffix) => makeId(suffix || "prodeval"));
  for (const item of prodevalEquipment) {
    equipment.push({ ...item, isOverridden: false, isLocked: false });
  }

  equipment.push({
    id: makeId("flare"),
    process: "Emergency Gas Management",
    equipmentType: "Enclosed Flare",
    description: `Enclosed ground flare, ${r(biogasScfm * 1.1, 0)} SCFM capacity`,
    quantity: 1,
    specs: { capacity: { value: r(biogasScfm * 1.1, 0), unit: "SCFM" }, destructionEfficiency: { value: "99.5", unit: "%" }, dimensionsL: { value: "8", unit: "ft (dia)" }, dimensionsW: { value: "8", unit: "ft (dia)" }, dimensionsH: { value: "25", unit: "ft" }, power: { value: "3", unit: "HP" } },
    designBasis: "110% of maximum biogas production, ≥99.5% destruction",
    notes: "Required for startup, shutdown, and upset conditions",
    isOverridden: false, isLocked: false,
  });

  const assumptions: Array<{ parameter: string; value: string; source: string }> = [
    { parameter: "Project Type", value: "Type D — Hybrid (WW Treatment + AD/RNG)", source: "User selection" },
    { parameter: "Design Wastewater Flow", value: `${r(wwFlowMgd, 2)} MGD`, source: "UPIF / user input" },
    { parameter: "Influent BOD", value: `${wwBod} mg/L`, source: "UPIF / default" },
    { parameter: "Influent TSS", value: `${wwTss} mg/L`, source: "UPIF / default" },
    { parameter: "Primary BOD Removal", value: `${rv(primaryBodRemoval * 100)}%`, source: "Ten States Standards / WEF MOP 8" },
    { parameter: "Primary TSS Removal", value: `${rv(primaryTssRemoval * 100)}%`, source: "Ten States Standards / WEF MOP 8" },
    { parameter: "Secondary BOD Removal", value: `${rv(secondaryBodRemoval * 100)}%`, source: "Conventional activated sludge" },
    { parameter: "WAS Yield Coefficient", value: `${wasYieldCoeff} lb VSS/lb BOD removed`, source: "Design standard" },
    { parameter: "Digester HRT", value: `${HRT_DAYS} days`, source: "Sludge digestion standard" },
    { parameter: "VS Destruction", value: `${VS_DESTRUCTION_PCT}%`, source: "Sludge digestion typical (lower than pure organic waste)" },
    { parameter: "Sludge BMP", value: `${SLUDGE_BMP} m³ CH₄/kg VS`, source: "Municipal sludge typical" },
    { parameter: "Biogas CH₄ Content", value: `${CH4_PCT}%`, source: "Sludge + co-digestion typical" },
    { parameter: "Gas Upgrading Vendor", value: "Prodeval (VALOGAZ®/VALOPACK®/VALOPUR®)", source: "Default vendor specification" },
    { parameter: "Methane Recovery", value: `${prodevalUnit.methaneRecovery}%`, source: "Prodeval VALOPUR® membrane spec" },
    { parameter: "Product RNG Purity", value: `≥${prodevalUnit.productCH4}% CH₄`, source: "Prodeval VALOPUR® membrane spec" },
    { parameter: "Pipeline Injection Pressure", value: `${prodevalUnit.rngPressurePsig} psig`, source: "Prodeval VALOPUR® FU 800 spec" },
    { parameter: "Operating Days Per Year", value: "365", source: "Continuous operation" },
  ];

  for (const fs of coDigestionFeedstocks) {
    const src = fs.libraryMatch ? `${fs.libraryMatch} library profile` : "User-provided / estimated default";
    assumptions.push(
      { parameter: `${fs.name} — Total Solids`, value: `${fs.tsPct}%`, source: src },
      { parameter: `${fs.name} — Volatile Solids`, value: `${fs.vsPctOfTs}% of TS`, source: src },
      { parameter: `${fs.name} — BMP`, value: `${fs.bmpM3CH4PerKgVS} m³ CH₄/kg VS`, source: src },
    );
  }

  const summary: Record<string, { value: string; unit: string }> = {
    designWastewaterFlow: { value: r(wwFlowMgd, 2), unit: "MGD" },
    influentBod: { value: String(wwBod), unit: "mg/L" },
    influentTss: { value: String(wwTss), unit: "mg/L" },
    effluentBod: { value: r(secondaryEffBod, 1), unit: "mg/L" },
    effluentTss: { value: r(secondaryEffTss, 1), unit: "mg/L" },
    primarySludge: { value: r(primarySludgeLbPerDay), unit: "lb TS/day" },
    wasSludge: { value: r(wasTssLbPerDay), unit: "lb TSS/day" },
    ...(hasFeedstocks ? { coDigestionFeedstock: { value: r(totalFeedTpy), unit: "TPY" } } : {}),
    totalVsToDigester: { value: r(totalVsLbPerDay), unit: "lb VS/day" },
    vsDestroyed: { value: r(vsDestroyedLbPerDay), unit: "lb VS/day" },
    biogasProduction: { value: r(biogasScfm, 1), unit: "SCFM" },
    biogasProductionDaily: { value: r(biogasScfd), unit: "SCFD" },
    biogasCH4Content: { value: String(CH4_PCT), unit: "%" },
    rngProduction: { value: r(rngScfm, 1), unit: "SCFM" },
    rngProductionDaily: { value: r(rngScfd), unit: "SCFD" },
    rngEnergyDaily: { value: r(rngMmbtuPerDay, 1), unit: "MMBTU/day" },
    rngEnergyAnnual: { value: r(rngMmbtuPerDay * 365), unit: "MMBTU/yr" },
    dewateredCake: { value: r(cakeLbPerDay / 2000, 1), unit: "TPD" },
    cakeSolids: { value: String(cakeTsPct), unit: "%" },
  };

  const warnings: Array<{ field: string; message: string; severity: "error" | "warning" | "info" }> = [];
  warnings.push({
    field: "method",
    message: "Mass balance generated using deterministic engineering calculations for Type D (Hybrid) — combined wastewater treatment and AD/RNG.",
    severity: "info",
  });

  if (biogasScfm < 50) {
    warnings.push({
      field: "biogasProduction",
      message: `Low biogas production (${r(biogasScfm, 1)} SCFM). Consider co-digestion feedstocks to improve RNG economics.`,
      severity: "warning",
    });
  }

  for (const fs of coDigestionFeedstocks) {
    if (!fs.libraryMatch) {
      warnings.push({
        field: "feedstock",
        message: `"${fs.name}" was not matched to feedstock library. Default design parameters were used.`,
        severity: "warning",
      });
    }
  }

  const recycleStreams = [
    { name: "Dewatering Filtrate Return", source: "Belt Filter Press", destination: "Headworks", flow: rv(centrateLbPerDay / 8.34), loads: { tss: rv(centrateLbPerDay * 0.002) } },
  ];

  const calc: BiogasCalcResult = {
    totalFeedTonsPerYear: totalFeedTpy + (totalSludgeLbPerDay * 365 / 2000),
    totalFeedTonsPerDay: totalFeedLbPerDay / 2000,
    totalFeedLbPerDay,
    totalTsLbPerDay,
    totalVsLbPerDay,
    vsDestroyedLbPerDay,
    vsDestructionPct: VS_DESTRUCTION_PCT,
    biogasScfd,
    biogasScfm,
    ch4Pct: CH4_PCT,
    co2Pct: CO2_PCT,
    ch4Scfd,
    rngScfd,
    rngScfm,
    rngMmbtuPerDay,
    digestateLbPerDay: digestateLb,
    digestateTsPct: rv((remainingTs / digestateLb) * 100, 1),
    cakeLbPerDay,
    cakeTsPct,
    centrateLbPerDay,
  };

  const results: MassBalanceResults = {
    projectType: "D",
    stages,
    adStages,
    recycleStreams,
    equipment,
    convergenceIterations: 1,
    convergenceAchieved: true,
    assumptions,
    warnings,
    summary,
  };

  const elapsed = Date.now() - startTime;
  console.log(`Deterministic MB: Type D complete in ${elapsed}ms — ${stages.length} WW stages, ${adStages.length} AD stages, ${equipment.length} equipment items`);

  return { results, feedstocks: coDigestionFeedstocks, calculations: calc };
}

export interface DeterministicMBResult {
  results: MassBalanceResults;
  feedstocks: ParsedFeedstock[];
  calculations: BiogasCalcResult;
}

export function generateDeterministicMassBalance(upif: any, projectType: string): DeterministicMBResult {
  const ptLower = projectType.toLowerCase().trim();

  if (ptLower === "c" || ptLower.includes("type c") || ptLower.includes("bolt-on") || ptLower.includes("bolt on")) {
    return generateTypeCMassBalance(upif);
  }

  if (ptLower === "d" || ptLower.includes("type d") || ptLower.includes("hybrid")) {
    return generateTypeDMassBalance(upif);
  }

  console.log(`Deterministic MB: Starting calculation for project type ${projectType}`);
  const startTime = Date.now();

  const feedstocks = parseFeedstocks(upif);
  if (feedstocks.length === 0) {
    throw new Error("No feedstocks found in UPIF data. Cannot generate deterministic mass balance.");
  }

  const totalTpy = feedstocks.reduce((sum, f) => sum + f.tonsPerYear, 0);
  if (totalTpy <= 0) {
    throw new Error("Total feedstock volume is zero or negative. Check UPIF feedstock entries.");
  }

  console.log(`Deterministic MB: Parsed ${feedstocks.length} feedstock(s), total ${r(totalTpy)} TPY`);
  for (const fs of feedstocks) {
    console.log(`  - ${fs.name}: ${r(fs.tonsPerYear)} TPY, TS=${fs.tsPct}%, VS=${fs.vsPctOfTs}% of TS, BMP=${fs.bmpM3CH4PerKgVS} m³ CH₄/kg VS${fs.libraryMatch ? ` (matched: ${fs.libraryMatch})` : ""}`);
  }

  const calc = calculateBiogasProduction(feedstocks);
  console.log(`Deterministic MB: Biogas = ${r(calc.biogasScfm, 1)} SCFM (${r(calc.biogasScfd)} SCFD), RNG = ${r(calc.rngScfm, 1)} SCFM (${r(calc.rngMmbtuPerDay, 1)} MMBTU/day)`);

  if (calc.biogasScfm > MAX_PRODEVAL_CAPACITY_SCFM) {
    throw new Error(`Biogas flow of ${r(calc.biogasScfm, 0)} SCFM exceeds maximum Prodeval equipment capacity (${MAX_PRODEVAL_CAPACITY_SCFM} SCFM). Falling back to AI for custom solution.`);
  }

  const adStages = buildTypeBAdStages(feedstocks, calc);
  const equipment = buildTypeBEquipment(feedstocks, calc);
  const assumptions = buildAssumptions(feedstocks, calc);
  const summary = buildSummary(calc);

  const warnings: Array<{ field: string; message: string; severity: "error" | "warning" | "info" }> = [];
  warnings.push({
    field: "method",
    message: "Mass balance generated using deterministic engineering calculations (not AI). Results are based on standard design parameters and feedstock library defaults.",
    severity: "info",
  });

  for (const fs of feedstocks) {
    if (!fs.libraryMatch) {
      warnings.push({
        field: "feedstock",
        message: `"${fs.name}" was not matched to feedstock library. Default design parameters were used. Verify TS, VS, and BMP values.`,
        severity: "warning",
      });
    }
  }

  const prodevalUnit = selectProdevalUnit(calc.biogasScfm);
  if (calc.biogasScfm > prodevalUnit.nominalCapacityScfm * 1.1) {
    warnings.push({
      field: "gasUpgrading",
      message: `Biogas flow (${r(calc.biogasScfm, 0)} SCFM) exceeds selected Prodeval unit capacity (${prodevalUnit.nominalCapacityScfm} SCFM). Consider additional trains or verify feedstock assumptions.`,
      severity: "warning",
    });
  }

  const results: MassBalanceResults = {
    projectType: "B",
    stages: [],
    adStages,
    recycleStreams: [
      {
        name: "DAF Float Recycle",
        source: "DAF",
        destination: "Digester",
        flow: rv(calc.centrateLbPerDay * 0.05 / 8.34),
        loads: { tss: rv(calc.centrateLbPerDay * 0.005 * 0.9) },
      },
    ],
    equipment,
    convergenceIterations: 1,
    convergenceAchieved: true,
    assumptions,
    warnings,
    summary,
  };

  const elapsed = Date.now() - startTime;
  console.log(`Deterministic MB: Complete in ${elapsed}ms — ${adStages.length} stages, ${equipment.length} equipment items`);

  return { results, feedstocks, calculations: calc };
}
