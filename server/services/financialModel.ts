import type {
  FinancialAssumptions,
  FinancialModelResults,
  FinancialMetrics,
  ProFormaYear,
  MassBalanceResults,
  CapexResults,
  OpexResults,
} from "@shared/schema";

const DEFAULT_ASSUMPTIONS: FinancialAssumptions = {
  inflationRate: 0.025,
  projectLifeYears: 20,
  constructionMonths: 18,
  uptimePct: 0.98,
  biogasGrowthRate: 0.0,
  rngPricePerMMBtu: 30,
  rngPriceEscalator: 0.02,
  rinPricePerRIN: 2.50,
  rinPriceEscalator: 0.01,
  rinBrokeragePct: 0.20,
  rinPerMMBtu: 11.727,
  natGasPricePerMMBtu: 3.50,
  natGasPriceEscalator: 0.03,
  wheelHubCostPerMMBtu: 1.0,
  electricityCostPerKWh: 0.08,
  electricityEscalator: 0.025,
  gasCostPerMMBtu: 4.00,
  gasCostEscalator: 0.03,
  itcRate: 0.40,
  itcMonetizationPct: 0.88,
  maintenanceCapexPct: 0.015,
  discountRate: 0.10,
  revenueMarket: "d3",
  voluntaryPricing: {
    gasPricePerMMBtu: 3.50,
    gasPriceEscalator: 0.03,
    voluntaryPremiumPerMMBtu: 16,
    voluntaryPremiumEscalator: 0.02,
  },
  feedstockCosts: [],
  debtFinancing: {
    enabled: false,
    loanAmountPct: 0.70,
    interestRate: 0.06,
    termYears: 10,
  },
  fortyFiveZ: {
    enabled: true,
    ciScore: 25,
    targetCI: 50,
    creditPricePerGal: 1.06,
    conversionGalPerMMBtu: 8.614,
    monetizationPct: 0.90,
    endYear: 2029,
  },
};

function extractBiogasScfm(mbResults: MassBalanceResults): number {
  if (mbResults.summary) {
    for (const [key, val] of Object.entries(mbResults.summary)) {
      const k = key.toLowerCase();
      if (k.includes("biogas") && (k.includes("flow") || k.includes("scfm"))) {
        const num = parseFloat(String((val as any).value).replace(/,/g, ""));
        if (!isNaN(num) && num > 0) return num;
      }
    }
  }

  for (const stage of (mbResults.adStages || [])) {
    const output = stage.outputStream || {};
    for (const [key, spec] of Object.entries(output)) {
      const k = key.toLowerCase();
      if ((k.includes("biogas") && k.includes("flow")) || k === "biogasflow") {
        const val = typeof spec === "object" && spec !== null ? (spec as any).value : spec;
        const num = typeof val === "number" ? val : parseFloat(String(val).replace(/,/g, ""));
        if (!isNaN(num) && num > 0) {
          const unit = typeof spec === "object" ? ((spec as any).unit || "").toLowerCase() : "";
          if (unit.includes("scfd") || unit.includes("day")) return num / 1440;
          return num;
        }
      }
    }
  }

  return 300;
}

function extractRngMMBtuPerDay(mbResults: MassBalanceResults, biogasScfm: number): number {
  if (mbResults.summary) {
    for (const [key, val] of Object.entries(mbResults.summary)) {
      const k = key.toLowerCase();
      if (k.includes("rng") && (k.includes("mmbtu") || k.includes("production") || k.includes("energy"))) {
        const num = parseFloat(String((val as any).value).replace(/,/g, ""));
        if (!isNaN(num) && num > 0) {
          const unit = ((val as any).unit || "").toLowerCase();
          if (unit.includes("/day") || unit.includes("day")) return num;
          if (unit.includes("/yr") || unit.includes("year") || unit.includes("annual")) return num / 365;
          return num;
        }
      }
    }
  }

  const biogasBtuPerScf = 600;
  const methaneRecovery = 0.97;
  const capture = 0.98;
  return (biogasScfm * 1440 * biogasBtuPerScf * methaneRecovery * capture) / 1_000_000;
}

function extractOpexBreakdown(opexResults: OpexResults): {
  utilityCost: number;
  laborCost: number;
  maintenanceCost: number;
  chemicalCost: number;
  insuranceCost: number;
  otherCost: number;
} {
  let utilityCost = 0;
  let laborCost = 0;
  let maintenanceCost = 0;
  let chemicalCost = 0;
  let insuranceCost = 0;
  let otherCost = 0;

  for (const item of opexResults.lineItems) {
    const cat = (item.category || "").toLowerCase();
    const desc = (item.description || "").toLowerCase();
    const cost = item.annualCost || 0;

    if (cat.includes("utilit") || cat.includes("energy") || cat.includes("electric") || cat.includes("power")) {
      utilityCost += cost;
    } else if (cat.includes("labor") || cat.includes("staff") || cat.includes("personnel") || cat.includes("management")) {
      laborCost += cost;
    } else if (cat.includes("mainten") || cat.includes("repair") || cat.includes("r&m") || cat.includes("consumab")) {
      maintenanceCost += cost;
    } else if (cat.includes("chemical") || cat.includes("reagent")) {
      chemicalCost += cost;
    } else if (cat.includes("insurance")) {
      insuranceCost += cost;
    } else if (desc.includes("utilit") || desc.includes("electric") || desc.includes("power") || desc.includes("gas cost")) {
      utilityCost += cost;
    } else if (desc.includes("labor") || desc.includes("operator") || desc.includes("management")) {
      laborCost += cost;
    } else if (desc.includes("mainten") || desc.includes("repair") || desc.includes("consumab")) {
      maintenanceCost += cost;
    } else if (desc.includes("chemical")) {
      chemicalCost += cost;
    } else if (desc.includes("insurance")) {
      insuranceCost += cost;
    } else {
      otherCost += cost;
    }
  }

  return { utilityCost, laborCost, maintenanceCost, chemicalCost, insuranceCost, otherCost };
}

function calculateIRR(cashFlows: number[], maxIterations = 1000, tolerance = 1e-7): number | null {
  if (cashFlows.length < 2) return null;

  let lo = -0.99;
  let hi = 10.0;

  const npvAt = (rate: number): number => {
    let npv = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      npv += cashFlows[i] / Math.pow(1 + rate, i);
    }
    return npv;
  };

  const npvLo = npvAt(lo);
  const npvHi = npvAt(hi);
  if (npvLo * npvHi > 0) {
    return null;
  }

  for (let i = 0; i < maxIterations; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npvAt(mid);

    if (Math.abs(npvMid) < tolerance) return mid;

    if (npvMid * npvAt(lo) < 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return (lo + hi) / 2;
}

function calculateNPV(cashFlows: number[], discountRate: number): number {
  let npv = 0;
  for (let i = 0; i < cashFlows.length; i++) {
    npv += cashFlows[i] / Math.pow(1 + discountRate, i);
  }
  return npv;
}

function estimateCIScore(feedstocks?: any[]): number {
  if (!feedstocks || feedstocks.length === 0) return 25;

  const ciByType: Record<string, number> = {
    "dairy manure": 10,
    "manure": 10,
    "cow manure": 10,
    "swine manure": 12,
    "hog manure": 12,
    "poultry litter": 15,
    "food waste": 20,
    "fats oils grease": 18,
    "fog": 18,
    "grease trap": 18,
    "municipal wastewater": 30,
    "wastewater sludge": 28,
    "sewage sludge": 28,
    "landfill gas": 40,
    "crop residue": 35,
    "energy crops": 40,
    "corn silage": 38,
    "grass silage": 35,
    "potato waste": 22,
    "brewery waste": 24,
    "distillery waste": 22,
    "fruit waste": 22,
    "vegetable waste": 22,
    "slaughterhouse waste": 18,
    "rendering waste": 18,
    "sugar beet pulp": 30,
    "organic fraction msw": 35,
    "source separated organics": 25,
  };

  let totalCI = 0;
  let totalWeight = 0;

  for (const f of feedstocks) {
    const name = (f.feedstockType || f.name || "").toLowerCase().trim();
    let ci = 25;
    for (const [key, val] of Object.entries(ciByType)) {
      if (name.includes(key) || key.includes(name)) {
        ci = val;
        break;
      }
    }
    const vol = parseFloat(String(f.feedstockVolume || 1).replace(/,/g, "")) || 1;
    totalCI += ci * vol;
    totalWeight += vol;
  }

  return totalWeight > 0 ? Math.round(totalCI / totalWeight) : 25;
}

function calculate45ZRevenuePerMMBtu(fortyFiveZ: FinancialAssumptions["fortyFiveZ"]): number {
  if (!fortyFiveZ.enabled) return 0;
  const emissionFactor = Math.max(0, (fortyFiveZ.targetCI - fortyFiveZ.ciScore) / fortyFiveZ.targetCI);
  const creditPerGalEquiv = emissionFactor * fortyFiveZ.creditPricePerGal;
  const pricePerMMBtu = creditPerGalEquiv * fortyFiveZ.conversionGalPerMMBtu;
  return pricePerMMBtu * fortyFiveZ.monetizationPct;
}

export function buildDefaultAssumptions(
  mbResults: MassBalanceResults,
  opexResults?: OpexResults,
  feedstocks?: any[],
): FinancialAssumptions {
  const assumptions = {
    ...DEFAULT_ASSUMPTIONS,
    voluntaryPricing: { ...DEFAULT_ASSUMPTIONS.voluntaryPricing },
    fortyFiveZ: { ...DEFAULT_ASSUMPTIONS.fortyFiveZ },
  };

  const estimatedCI = estimateCIScore(feedstocks);
  assumptions.fortyFiveZ.ciScore = estimatedCI;

  if (feedstocks && feedstocks.length > 0) {
    assumptions.feedstockCosts = feedstocks.map((f: any) => {
      let annualTons = 0;
      if (f.feedstockVolume) {
        const vol = parseFloat(String(f.feedstockVolume).replace(/,/g, ""));
        const unit = (f.feedstockUnit || "").toLowerCase();
        if (unit.includes("ton")) {
          annualTons = vol * (unit.includes("day") ? 365 : unit.includes("week") ? 52 : unit.includes("month") ? 12 : 1);
        } else if (unit.includes("gal")) {
          annualTons = vol * 8.34 / 2000 * (unit.includes("day") ? 365 : 1);
        } else {
          annualTons = vol;
        }
      }
      return {
        feedstockName: f.feedstockType || f.name || "Unknown Feedstock",
        costPerTon: 0,
        annualTons: Math.round(annualTons),
        escalator: 0.025,
      };
    });
  }

  return assumptions;
}

export function calculateFinancialModel(
  assumptions: FinancialAssumptions,
  mbResults: MassBalanceResults,
  capexResults: CapexResults,
  opexResults: OpexResults,
): FinancialModelResults {
  const biogasScfmBase = extractBiogasScfm(mbResults);
  const rngMMBtuPerDayBase = extractRngMMBtuPerDay(mbResults, biogasScfmBase);
  const capexTotal = capexResults.summary.totalProjectCost;
  const opexBreakdown = extractOpexBreakdown(opexResults);
  const opexAnnualBase = opexResults.summary.totalAnnualOpex || opexResults.summary.netAnnualOpex || 0;
  const years = assumptions.projectLifeYears;
  const currentYear = new Date().getFullYear();
  const codYear = currentYear + Math.ceil(assumptions.constructionMonths / 12);
  const warnings: FinancialModelResults["warnings"] = [];

  if (capexTotal <= 0) {
    warnings.push({ field: "capex", message: "CapEx total is zero or negative — financial metrics may be unreliable", severity: "warning" });
  }

  const fortyFiveZ = assumptions.fortyFiveZ || DEFAULT_ASSUMPTIONS.fortyFiveZ;
  const net45ZPricePerMMBtu = calculate45ZRevenuePerMMBtu(fortyFiveZ);
  const isVoluntary = assumptions.revenueMarket === "voluntary";
  const volPricing = assumptions.voluntaryPricing || DEFAULT_ASSUMPTIONS.voluntaryPricing;

  const proForma: ProFormaYear[] = [];
  const cashFlows: number[] = [-capexTotal];
  let cumulativeCashFlow = -capexTotal;

  const itcProceeds = capexTotal * assumptions.itcRate * assumptions.itcMonetizationPct;

  for (let y = 1; y <= years; y++) {
    const inflationFactor = Math.pow(1 + assumptions.inflationRate, y - 1);
    const growthFactor = Math.pow(1 + assumptions.biogasGrowthRate, y - 1);

    const biogasScfm = biogasScfmBase * growthFactor;
    const rngMMBtuPerDay = rngMMBtuPerDayBase * growthFactor;
    const rngProductionMMBtu = rngMMBtuPerDay * 365 * assumptions.uptimePct;

    let rinRevenue = 0;
    let rinBrokerage = 0;
    let natGasRevenue = 0;
    let voluntaryRevenue = 0;

    if (isVoluntary) {
      const gasPrice = volPricing.gasPricePerMMBtu * Math.pow(1 + volPricing.gasPriceEscalator, y - 1);
      const premium = volPricing.voluntaryPremiumPerMMBtu * Math.pow(1 + volPricing.voluntaryPremiumEscalator, y - 1);
      const effectiveVolPrice = Math.max(0, gasPrice + premium - assumptions.wheelHubCostPerMMBtu);
      voluntaryRevenue = rngProductionMMBtu * effectiveVolPrice;
    } else {
      const rinPrice = assumptions.rinPricePerRIN * Math.pow(1 + assumptions.rinPriceEscalator, y - 1);
      const rinsGenerated = rngProductionMMBtu * assumptions.rinPerMMBtu;
      rinRevenue = rinsGenerated * rinPrice;
      rinBrokerage = rinRevenue * assumptions.rinBrokeragePct;

      const natGasPrice = assumptions.natGasPricePerMMBtu * Math.pow(1 + assumptions.natGasPriceEscalator, y - 1);
      const effectiveNatGasPrice = Math.max(0, natGasPrice - assumptions.wheelHubCostPerMMBtu);
      natGasRevenue = rngProductionMMBtu * effectiveNatGasPrice;
    }

    const calendarYear = codYear + y - 1;
    let fortyFiveZRevenue = 0;
    if (fortyFiveZ.enabled && calendarYear <= fortyFiveZ.endYear) {
      fortyFiveZRevenue = rngProductionMMBtu * net45ZPricePerMMBtu;
    }

    const totalRevenue = isVoluntary
      ? voluntaryRevenue + fortyFiveZRevenue
      : rinRevenue - rinBrokerage + natGasRevenue + fortyFiveZRevenue;

    const utilityCost = opexBreakdown.utilityCost * Math.pow(1 + assumptions.electricityEscalator, y - 1);
    const laborCost = opexBreakdown.laborCost * inflationFactor;
    const maintenanceCost = opexBreakdown.maintenanceCost * inflationFactor;
    const chemicalCost = opexBreakdown.chemicalCost * inflationFactor;
    const insuranceCost = opexBreakdown.insuranceCost * inflationFactor;
    const otherOpex = opexBreakdown.otherCost * inflationFactor;

    let feedstockCost = 0;
    for (const fs of assumptions.feedstockCosts) {
      const fsFactor = Math.pow(1 + (fs.escalator || assumptions.inflationRate), y - 1);
      feedstockCost += fs.costPerTon * fs.annualTons * fsFactor;
    }

    const totalOpex = utilityCost + feedstockCost + laborCost + maintenanceCost + chemicalCost + insuranceCost + otherOpex;
    const ebitda = totalRevenue - totalOpex;
    const maintenanceCapex = capexTotal * assumptions.maintenanceCapexPct * inflationFactor;

    let debtService = 0;
    if (assumptions.debtFinancing.enabled && y <= assumptions.debtFinancing.termYears) {
      const principal = capexTotal * assumptions.debtFinancing.loanAmountPct;
      const r = assumptions.debtFinancing.interestRate;
      const n = assumptions.debtFinancing.termYears;
      debtService = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    }

    let netCashFlow = ebitda - maintenanceCapex - debtService;
    if (y === 1) {
      netCashFlow += itcProceeds;
    }
    cumulativeCashFlow += netCashFlow;

    cashFlows.push(netCashFlow);

    proForma.push({
      year: y,
      calendarYear,
      biogasScfm: Math.round(biogasScfm),
      rngProductionMMBtu: Math.round(rngProductionMMBtu),
      rinRevenue: Math.round(rinRevenue),
      rinBrokerage: Math.round(rinBrokerage),
      natGasRevenue: Math.round(natGasRevenue),
      voluntaryRevenue: Math.round(voluntaryRevenue),
      fortyFiveZRevenue: Math.round(fortyFiveZRevenue),
      totalRevenue: Math.round(totalRevenue),
      utilityCost: Math.round(utilityCost),
      feedstockCost: Math.round(feedstockCost),
      laborCost: Math.round(laborCost),
      maintenanceCost: Math.round(maintenanceCost),
      chemicalCost: Math.round(chemicalCost),
      insuranceCost: Math.round(insuranceCost),
      otherOpex: Math.round(otherOpex),
      totalOpex: Math.round(totalOpex),
      ebitda: Math.round(ebitda),
      maintenanceCapex: Math.round(maintenanceCapex),
      debtService: Math.round(debtService),
      netCashFlow: Math.round(netCashFlow),
      cumulativeCashFlow: Math.round(cumulativeCashFlow),
    });
  }

  const irr = calculateIRR(cashFlows);
  const npv10 = calculateNPV(cashFlows, assumptions.discountRate);

  const totalCashIn = proForma.reduce((s, y) => s + Math.max(0, y.netCashFlow), 0);
  const moic = capexTotal > 0 ? totalCashIn / capexTotal : 0;

  let paybackYears: number | null = null;
  for (const yr of proForma) {
    if (yr.cumulativeCashFlow >= 0) {
      paybackYears = yr.year;
      break;
    }
  }

  const totalRevenue = proForma.reduce((s, y) => s + y.totalRevenue, 0);
  const totalOpex = proForma.reduce((s, y) => s + y.totalOpex, 0);
  const totalEbitda = proForma.reduce((s, y) => s + y.ebitda, 0);
  const totalMaintenanceCapex = proForma.reduce((s, y) => s + y.maintenanceCapex, 0);

  const metrics: FinancialMetrics = {
    irr: irr !== null ? Math.round(irr * 10000) / 10000 : null,
    npv10: Math.round(npv10),
    moic: Math.round(moic * 100) / 100,
    paybackYears,
    totalRevenue: Math.round(totalRevenue),
    totalOpex: Math.round(totalOpex),
    totalEbitda: Math.round(totalEbitda),
    totalCapex: Math.round(capexTotal),
    itcProceeds: Math.round(itcProceeds),
    totalMaintenanceCapex: Math.round(totalMaintenanceCapex),
    averageAnnualEbitda: Math.round(totalEbitda / years),
  };

  return {
    projectType: mbResults.projectType,
    assumptions,
    proForma,
    metrics,
    capexTotal: Math.round(capexTotal),
    opexAnnualBase: Math.round(opexAnnualBase),
    biogasScfmBase: Math.round(biogasScfmBase),
    rngMMBtuPerDayBase: Math.round(rngMMBtuPerDayBase * 10) / 10,
    warnings,
  };
}
