import { llmComplete, isProviderAvailable, getAvailableProviders, providerLabels, type LLMProvider } from "../llm";
import type { OpexResults, OpexLineItem, OpexSummary, MassBalanceResults, CapexResults, EquipmentItem, OpexEditableAssumption } from "@shared/schema";
import type { PromptKey } from "@shared/default-prompts";
import { DEFAULT_PROMPTS } from "@shared/default-prompts";

const opexPromptMap: Record<string, PromptKey> = {
  a: "opex_type_a",
  b: "opex_type_b",
  c: "opex_type_c",
  d: "opex_type_d",
};

export function getDefaultOpexAssumptions(projectType: string, massBalanceResults?: MassBalanceResults, capexResults?: CapexResults | null): OpexEditableAssumption[] {
  const pt = normalizeProjectType(projectType);
  const isWW = pt === "a";
  const isRNG = pt === "b" || pt === "c" || pt === "d";

  const maintenanceRate = isWW ? 3 : 4;
  const electricityRate = 0.08;
  const loadFactor = 75;
  const operatingHoursPerYear = 8760;
  const insuranceRate = 0.5;

  const assumptions: OpexEditableAssumption[] = [
    { key: "maintenance_rate", parameter: "Maintenance Rate", value: maintenanceRate, unit: "% of equipment CapEx", source: "WEF MOP 8 / Industry benchmark", category: "Maintenance", description: "Annual maintenance & repair cost as a percentage of total equipment capital cost" },
    { key: "electricity_rate", parameter: "Electricity Rate", value: electricityRate, unit: "$/kWh", source: "EIA national average", category: "Energy", description: "Average electricity cost per kilowatt-hour" },
    { key: "load_factor", parameter: "Equipment Load Factor", value: loadFactor, unit: "%", source: "Engineering estimate", category: "Energy", description: "Average equipment utilization as a fraction of installed capacity" },
    { key: "operating_hours", parameter: "Operating Hours per Year", value: operatingHoursPerYear, unit: "hr/yr", source: "Continuous operation", category: "Energy", description: "Total operating hours per year (8,760 = 24/7)" },
    { key: "insurance_rate", parameter: "Insurance Rate", value: insuranceRate, unit: "% of total project cost", source: "Industry benchmark", category: "Other", description: "Annual property & liability insurance as percentage of total project cost" },
  ];

  if (isWW) {
    assumptions.push(
      { key: "operator_count", parameter: "Number of Operators", value: 4, unit: "FTEs", source: "WEF staffing guidelines", category: "Labor", description: "Full-time equivalent operators for plant operation" },
      { key: "operator_salary", parameter: "Operator Salary", value: 65000, unit: "$/yr per FTE", source: "BLS median wastewater operator", category: "Labor", description: "Average annual salary per operator including benefits loading" },
      { key: "management_count", parameter: "Management Staff", value: 1, unit: "FTEs", source: "Typical for plant size", category: "Labor", description: "Plant manager / superintendent" },
      { key: "management_salary", parameter: "Management Salary", value: 95000, unit: "$/yr per FTE", source: "BLS data", category: "Labor", description: "Annual salary for management staff" },
      { key: "benefits_loading", parameter: "Benefits Loading Factor", value: 35, unit: "%", source: "Industry standard", category: "Labor", description: "Fringe benefits as percentage of base salary (health insurance, retirement, etc.)" },
      { key: "chemical_cost_per_mg", parameter: "Chemical Cost", value: 200, unit: "$/MG treated", source: "EPA CWNS benchmark", category: "Chemical", description: "Average chemical costs per million gallons treated" },
      { key: "sludge_disposal_cost", parameter: "Sludge Disposal Cost", value: 60, unit: "$/wet ton", source: "Regional average", category: "Disposal", description: "Cost to haul and dispose of dewatered biosolids" },
      { key: "lab_testing_annual", parameter: "Lab & Testing", value: 25000, unit: "$/yr", source: "Regulatory compliance estimate", category: "Other", description: "Annual laboratory analysis and compliance testing costs" },
    );
  } else {
    const operatorCount = pt === "b" ? 3 : 2;
    assumptions.push(
      { key: "operator_count", parameter: "Number of Operators", value: operatorCount, unit: "FTEs", source: "RNG facility staffing", category: "Labor", description: "Full-time equivalent operators for facility operation" },
      { key: "operator_salary", parameter: "Operator Salary", value: 75000, unit: "$/yr per FTE", source: "BLS median", category: "Labor", description: "Average annual salary per operator" },
      { key: "management_count", parameter: "Management Staff", value: 1, unit: "FTEs", source: "Typical for facility size", category: "Labor", description: "Site manager" },
      { key: "management_salary", parameter: "Management Salary", value: 100000, unit: "$/yr per FTE", source: "Industry benchmark", category: "Labor", description: "Annual salary for management staff" },
      { key: "benefits_loading", parameter: "Benefits Loading Factor", value: 35, unit: "%", source: "Industry standard", category: "Labor", description: "Fringe benefits as percentage of base salary" },
      { key: "feedstock_receiving_cost", parameter: "Feedstock Receiving & Handling", value: pt === "b" ? 15 : 5, unit: "$/ton", source: "Industry estimate", category: "Chemical", description: "Cost for feedstock receiving, screening, and preprocessing" },
      { key: "digestate_disposal_cost", parameter: "Digestate Disposal Cost", value: 20, unit: "$/wet ton", source: "Regional average", category: "Disposal", description: "Cost to haul and land-apply or dispose of digestate" },
      { key: "membrane_replacement", parameter: "Membrane/Media Replacement", value: pt === "b" ? 50000 : 35000, unit: "$/yr", source: "Prodeval maintenance schedule", category: "Maintenance", description: "Annual membrane and media replacement for gas upgrading system" },
      { key: "lab_testing_annual", parameter: "Lab & Testing", value: 15000, unit: "$/yr", source: "Regulatory compliance estimate", category: "Other", description: "Annual gas quality testing and environmental monitoring" },
      { key: "interconnect_fees", parameter: "Pipeline Interconnect Fees", value: 12000, unit: "$/yr", source: "Utility estimate", category: "Other", description: "Annual gas pipeline interconnection and metering fees" },
    );
  }

  return assumptions;
}

export function calculateAllDeterministicLineItems(
  assumptions: OpexEditableAssumption[],
  massBalanceResults: MassBalanceResults,
  capexResults: CapexResults | null,
  projectType: string,
): OpexLineItem[] {
  const lineItems: OpexLineItem[] = [];
  const pt = normalizeProjectType(projectType);
  let idCounter = 1;
  const makeId = () => `opex-det-${idCounter++}`;

  const getVal = (key: string): number => {
    const a = assumptions.find(a => a.key === key);
    return a ? a.value : 0;
  };

  const totalEquipmentCost = capexResults?.summary?.totalEquipmentCost || 0;
  const totalProjectCost = capexResults?.summary?.totalProjectCost || 0;

  const maintenanceRate = getVal("maintenance_rate") / 100;
  if (totalEquipmentCost > 0 && maintenanceRate > 0) {
    const maintenanceCost = Math.round(totalEquipmentCost * maintenanceRate);
    lineItems.push({
      id: makeId(),
      category: "Maintenance",
      description: `Annual maintenance & repairs (${(maintenanceRate * 100).toFixed(1)}% of equipment CapEx $${totalEquipmentCost.toLocaleString()})`,
      annualCost: maintenanceCost,
      unitCost: undefined,
      unitBasis: undefined,
      scalingBasis: `$${totalEquipmentCost.toLocaleString()} equipment cost`,
      percentOfRevenue: undefined,
      costBasis: `Deterministic: ${(maintenanceRate * 100).toFixed(1)}% × $${totalEquipmentCost.toLocaleString()}`,
      source: "WEF MOP 8 / industry benchmark",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const membraneReplacement = getVal("membrane_replacement");
  if (membraneReplacement > 0) {
    lineItems.push({
      id: makeId(),
      category: "Maintenance",
      description: "Membrane & media replacement (gas upgrading system)",
      annualCost: Math.round(membraneReplacement),
      unitCost: undefined,
      unitBasis: undefined,
      scalingBasis: "Per Prodeval maintenance schedule",
      percentOfRevenue: undefined,
      costBasis: `Deterministic: $${membraneReplacement.toLocaleString()}/yr`,
      source: "Prodeval maintenance schedule",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const powerKeys = ["power", "motor", "hp", "installed power", "rated power", "brake horsepower"];
  let totalKw = 0;
  if (massBalanceResults.equipment && massBalanceResults.equipment.length > 0) {
    for (const eq of massBalanceResults.equipment) {
      if (!eq.specs) continue;
      let bestKw = 0;
      for (const [key, spec] of Object.entries(eq.specs)) {
        const keyLower = key.toLowerCase();
        if (!powerKeys.some(pk => keyLower.includes(pk))) continue;
        const numVal = parseFloat(String(spec.value).replace(/,/g, ""));
        if (isNaN(numVal) || numVal <= 0) continue;
        const unitLower = (spec.unit || "").toLowerCase();
        let kw = 0;
        if (unitLower.includes("hp") || unitLower.includes("horsepower")) {
          kw = numVal * 0.7457;
        } else if (unitLower.includes("mw")) {
          kw = numVal * 1000;
        } else if (unitLower.includes("kw")) {
          kw = numVal;
        } else if (unitLower.includes("w")) {
          kw = numVal / 1000;
        } else {
          kw = numVal * 0.7457;
        }
        if (kw > bestKw) bestKw = kw;
      }
      totalKw += bestKw * (eq.quantity || 1);
    }
  }

  const electricityRate = getVal("electricity_rate");
  const loadFactor = getVal("load_factor") / 100;
  const operatingHours = getVal("operating_hours");
  if (totalKw > 0 && electricityRate > 0) {
    const annualEnergyCost = Math.round(totalKw * loadFactor * operatingHours * electricityRate);
    lineItems.push({
      id: makeId(),
      category: "Energy",
      description: `Electrical power (${Math.round(totalKw)} kW installed, ${(loadFactor * 100).toFixed(0)}% load factor, $${electricityRate}/kWh)`,
      annualCost: annualEnergyCost,
      unitCost: electricityRate,
      unitBasis: "$/kWh",
      scalingBasis: `${Math.round(totalKw)} kW installed capacity`,
      percentOfRevenue: undefined,
      costBasis: `Deterministic: ${Math.round(totalKw)} kW × ${(loadFactor * 100).toFixed(0)}% × ${operatingHours.toLocaleString()} hr × $${electricityRate}/kWh`,
      source: "Equipment specs + EIA rates",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const operatorCount = getVal("operator_count");
  const operatorSalary = getVal("operator_salary");
  const managementCount = getVal("management_count");
  const managementSalary = getVal("management_salary");
  const benefitsLoading = getVal("benefits_loading") / 100;

  if (operatorCount > 0 && operatorSalary > 0) {
    const totalOperatorCost = Math.round(operatorCount * operatorSalary * (1 + benefitsLoading));
    lineItems.push({
      id: makeId(),
      category: "Labor",
      description: `Plant operators (${operatorCount} FTEs × $${operatorSalary.toLocaleString()}/yr × ${((1 + benefitsLoading) * 100).toFixed(0)}% loaded)`,
      annualCost: totalOperatorCost,
      unitCost: operatorSalary,
      unitBasis: "$/yr per FTE",
      scalingBasis: `${operatorCount} FTEs`,
      percentOfRevenue: undefined,
      costBasis: `Deterministic: ${operatorCount} × $${operatorSalary.toLocaleString()} × ${((1 + benefitsLoading) * 100).toFixed(0)}%`,
      source: "BLS / industry staffing",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  if (managementCount > 0 && managementSalary > 0) {
    const totalMgmtCost = Math.round(managementCount * managementSalary * (1 + benefitsLoading));
    lineItems.push({
      id: makeId(),
      category: "Labor",
      description: `Management staff (${managementCount} FTE × $${managementSalary.toLocaleString()}/yr × ${((1 + benefitsLoading) * 100).toFixed(0)}% loaded)`,
      annualCost: totalMgmtCost,
      unitCost: managementSalary,
      unitBasis: "$/yr per FTE",
      scalingBasis: `${managementCount} FTEs`,
      percentOfRevenue: undefined,
      costBasis: `Deterministic: ${managementCount} × $${managementSalary.toLocaleString()} × ${((1 + benefitsLoading) * 100).toFixed(0)}%`,
      source: "Industry benchmark",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const chemicalCostPerMG = getVal("chemical_cost_per_mg");
  if (chemicalCostPerMG > 0 && pt === "a") {
    const flowMGD = parseFloat(String(massBalanceResults.summary?.["designFlow"]?.value || "1"));
    const annualMG = flowMGD * 365;
    const annualChemCost = Math.round(chemicalCostPerMG * annualMG);
    lineItems.push({
      id: makeId(),
      category: "Chemical",
      description: `Treatment chemicals ($${chemicalCostPerMG}/MG × ${annualMG.toLocaleString()} MG/yr)`,
      annualCost: annualChemCost,
      unitCost: chemicalCostPerMG,
      unitBasis: "$/MG",
      scalingBasis: `${flowMGD} MGD × 365 days`,
      percentOfRevenue: undefined,
      costBasis: `Deterministic: $${chemicalCostPerMG}/MG × ${annualMG.toLocaleString()} MG/yr`,
      source: "EPA CWNS benchmark",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const feedstockReceivingCost = getVal("feedstock_receiving_cost");
  if (feedstockReceivingCost > 0 && (pt === "b" || pt === "c" || pt === "d")) {
    let annualTons = 0;
    const summary = massBalanceResults.summary;
    if (summary) {
      for (const [key, val] of Object.entries(summary)) {
        if (key.toLowerCase().includes("feedstock") && val.unit?.toLowerCase().includes("ton")) {
          const v = parseFloat(String(val.value).replace(/,/g, ""));
          if (!isNaN(v) && v > 0) annualTons = v * 365;
        }
      }
    }
    if (annualTons <= 0) annualTons = 36500;
    const annualCost = Math.round(feedstockReceivingCost * annualTons);
    lineItems.push({
      id: makeId(),
      category: "Chemical",
      description: `Feedstock receiving & handling ($${feedstockReceivingCost}/ton × ${annualTons.toLocaleString()} tons/yr)`,
      annualCost: annualCost,
      unitCost: feedstockReceivingCost,
      unitBasis: "$/ton",
      scalingBasis: `${annualTons.toLocaleString()} tons/yr throughput`,
      percentOfRevenue: undefined,
      costBasis: `Deterministic: $${feedstockReceivingCost}/ton × ${annualTons.toLocaleString()} tons/yr`,
      source: "Industry estimate",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const sludgeDisposalCost = getVal("sludge_disposal_cost");
  if (sludgeDisposalCost > 0 && pt === "a") {
    const flowMGD = parseFloat(String(massBalanceResults.summary?.["designFlow"]?.value || "1"));
    const annualWetTons = Math.round(flowMGD * 365 * 8.34 * 0.01 * 0.2);
    const annualCost = Math.round(sludgeDisposalCost * annualWetTons);
    lineItems.push({
      id: makeId(),
      category: "Disposal",
      description: `Biosolids disposal ($${sludgeDisposalCost}/wet ton × ${annualWetTons.toLocaleString()} wet tons/yr)`,
      annualCost: annualCost,
      unitCost: sludgeDisposalCost,
      unitBasis: "$/wet ton",
      scalingBasis: `${annualWetTons.toLocaleString()} wet tons/yr`,
      percentOfRevenue: undefined,
      costBasis: `Deterministic: $${sludgeDisposalCost}/wet ton × ${annualWetTons.toLocaleString()} wet tons/yr`,
      source: "Regional average",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const digestateDisposalCost = getVal("digestate_disposal_cost");
  if (digestateDisposalCost > 0 && (pt === "b" || pt === "c" || pt === "d")) {
    let annualDigestateTons = 0;
    const summary = massBalanceResults.summary;
    if (summary) {
      for (const [key, val] of Object.entries(summary)) {
        if (key.toLowerCase().includes("digestate") && val.unit?.toLowerCase().includes("ton")) {
          const v = parseFloat(String(val.value).replace(/,/g, ""));
          if (!isNaN(v) && v > 0) annualDigestateTons = v * 365;
        }
      }
    }
    if (annualDigestateTons <= 0) annualDigestateTons = 18250;
    const annualCost = Math.round(digestateDisposalCost * annualDigestateTons);
    lineItems.push({
      id: makeId(),
      category: "Disposal",
      description: `Digestate disposal ($${digestateDisposalCost}/wet ton × ${annualDigestateTons.toLocaleString()} wet tons/yr)`,
      annualCost: annualCost,
      unitCost: digestateDisposalCost,
      unitBasis: "$/wet ton",
      scalingBasis: `${annualDigestateTons.toLocaleString()} wet tons/yr`,
      percentOfRevenue: undefined,
      costBasis: `Deterministic: $${digestateDisposalCost}/wet ton × ${annualDigestateTons.toLocaleString()} wet tons/yr`,
      source: "Regional average",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const insuranceRate = getVal("insurance_rate") / 100;
  if (totalProjectCost > 0 && insuranceRate > 0) {
    const insuranceCost = Math.round(totalProjectCost * insuranceRate);
    lineItems.push({
      id: makeId(),
      category: "Other",
      description: `Property & liability insurance (${(insuranceRate * 100).toFixed(1)}% of $${totalProjectCost.toLocaleString()} project cost)`,
      annualCost: insuranceCost,
      unitCost: undefined,
      unitBasis: undefined,
      scalingBasis: `$${totalProjectCost.toLocaleString()} total project cost`,
      percentOfRevenue: undefined,
      costBasis: `Deterministic: ${(insuranceRate * 100).toFixed(1)}% × $${totalProjectCost.toLocaleString()}`,
      source: "Industry benchmark",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const labTestingAnnual = getVal("lab_testing_annual");
  if (labTestingAnnual > 0) {
    lineItems.push({
      id: makeId(),
      category: "Other",
      description: "Laboratory analysis & compliance testing",
      annualCost: Math.round(labTestingAnnual),
      unitCost: undefined,
      unitBasis: undefined,
      scalingBasis: "Annual lump sum",
      percentOfRevenue: undefined,
      costBasis: `Deterministic: $${labTestingAnnual.toLocaleString()}/yr`,
      source: "Regulatory compliance estimate",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const interconnectFees = getVal("interconnect_fees");
  if (interconnectFees > 0) {
    lineItems.push({
      id: makeId(),
      category: "Other",
      description: "Pipeline interconnection & metering fees",
      annualCost: Math.round(interconnectFees),
      unitCost: undefined,
      unitBasis: undefined,
      scalingBasis: "Annual lump sum",
      percentOfRevenue: undefined,
      costBasis: `Deterministic: $${interconnectFees.toLocaleString()}/yr`,
      source: "Utility estimate",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  return lineItems;
}

function buildOpexSummaryFromLineItems(lineItems: OpexLineItem[], totalProjectCapex: number): OpexSummary {
  const categorize = (cat: string): string => {
    const c = cat.toLowerCase();
    if (c.includes("labor") || c.includes("staff") || c.includes("personnel")) return "Labor";
    if (c.includes("energy") || c.includes("electric") || c.includes("utilit")) return "Energy";
    if (c.includes("chemical") || c.includes("consumab") || c.includes("media") || c.includes("membrane") || c.includes("feedstock")) return "Chemical";
    if (c.includes("mainten") || c.includes("repair") || c.includes("spare")) return "Maintenance";
    if (c.includes("dispos") || c.includes("haul") || c.includes("sludge") || c.includes("digestate")) return "Disposal";
    if (c.includes("revenue") || c.includes("offset") || c.includes("credit")) return "Revenue Offset";
    return "Other";
  };

  const totalLaborCost = lineItems.filter(li => categorize(li.category) === "Labor").reduce((s, li) => s + li.annualCost, 0);
  const totalEnergyCost = lineItems.filter(li => categorize(li.category) === "Energy").reduce((s, li) => s + li.annualCost, 0);
  const totalChemicalCost = lineItems.filter(li => categorize(li.category) === "Chemical").reduce((s, li) => s + li.annualCost, 0);
  const totalMaintenanceCost = lineItems.filter(li => categorize(li.category) === "Maintenance").reduce((s, li) => s + li.annualCost, 0);
  const totalDisposalCost = lineItems.filter(li => categorize(li.category) === "Disposal").reduce((s, li) => s + li.annualCost, 0);
  const totalOtherCost = lineItems.filter(li => categorize(li.category) === "Other").reduce((s, li) => s + li.annualCost, 0);
  const revenueOffsets = lineItems.filter(li => categorize(li.category) === "Revenue Offset").reduce((s, li) => s + li.annualCost, 0);

  const totalAnnualOpex = totalLaborCost + totalEnergyCost + totalChemicalCost + totalMaintenanceCost + totalDisposalCost + totalOtherCost;
  const netAnnualOpex = totalAnnualOpex + revenueOffsets;

  return {
    totalAnnualOpex,
    totalLaborCost,
    totalEnergyCost,
    totalChemicalCost,
    totalMaintenanceCost,
    totalDisposalCost,
    totalOtherCost,
    revenueOffsets,
    netAnnualOpex,
    opexAsPercentOfCapex: totalProjectCapex > 0 ? Math.round((totalAnnualOpex / totalProjectCapex) * 1000) / 10 : undefined,
  };
}

export function recomputeOpexFromAssumptions(
  editableAssumptions: OpexEditableAssumption[],
  massBalanceResults: MassBalanceResults,
  capexResults: CapexResults | null,
  projectType: string,
  existingResults: OpexResults,
): OpexResults {
  const lineItems = calculateAllDeterministicLineItems(editableAssumptions, massBalanceResults, capexResults, projectType);
  const totalProjectCapex = capexResults?.summary?.totalProjectCost || 0;
  const summary = buildOpexSummaryFromLineItems(lineItems, totalProjectCapex);

  const displayAssumptions = editableAssumptions.map(a => ({
    parameter: a.parameter,
    value: typeof a.value === "number"
      ? (a.unit.includes("$") || a.unit.includes("/yr") ? `$${a.value.toLocaleString()} ${a.unit}` : `${a.value.toLocaleString()} ${a.unit}`)
      : `${a.value} ${a.unit}`,
    source: a.source,
  }));

  return {
    ...existingResults,
    lineItems,
    summary,
    assumptions: displayAssumptions,
    editableAssumptions,
    methodology: "Deterministic bottom-up operating cost estimate from editable assumptions",
  };
}

function normalizeProjectType(projectType: string): string {
  const pt = projectType.toLowerCase().trim();
  if (pt.includes("type a") || pt.includes("wastewater") || pt === "a") return "a";
  if (pt.includes("type b") || pt.includes("greenfield") || pt === "b") return "b";
  if (pt.includes("type c") || pt.includes("bolt-on") || pt.includes("bolt on") || pt === "c") return "c";
  if (pt.includes("type d") || pt.includes("hybrid") || pt === "d") return "d";
  return "a";
}

function buildEquipmentDataString(massBalanceResults: MassBalanceResults): string {
  const sections: string[] = [];

  if (massBalanceResults.summary && Object.keys(massBalanceResults.summary).length > 0) {
    const summaryLines = Object.entries(massBalanceResults.summary).map(
      ([key, val]) => `  ${key}: ${val.value} ${val.unit}`
    );
    sections.push("MASS BALANCE SUMMARY:\n" + summaryLines.join("\n"));
  }

  if (massBalanceResults.equipment && massBalanceResults.equipment.length > 0) {
    const opexRelevantSpecs = new Set([
      "power", "totalPower", "capacity", "throughput", "flowRate", "volume", "totalVolume",
      "duty", "gasFlow", "totalGasFlow", "hydraulicCapacity", "storageCapacity",
      "temperature", "retentionTime", "hrt", "mixingIntensity", "mixingPower"
    ]);
    const eqLines = massBalanceResults.equipment.map((eq: EquipmentItem, i: number) => {
      const parts: string[] = [];
      parts.push(`${i + 1}. ${eq.equipmentType} (${eq.process}) ×${eq.quantity}`);
      if (eq.specs && Object.keys(eq.specs).length > 0) {
        const relevantSpecs = Object.entries(eq.specs)
          .filter(([key]) => opexRelevantSpecs.has(key))
          .map(([key, spec]) => `${key}:${spec.value}${spec.unit}`)
          .join(", ");
        if (relevantSpecs) parts.push(`  ${relevantSpecs}`);
      }
      return parts.join("\n");
    });
    sections.push("EQUIPMENT LIST:\n" + eqLines.join("\n"));
  }

  return sections.join("\n\n");
}

function buildUpifContextString(upif: any): string {
  const sections: string[] = [];

  if (upif.projectType) sections.push(`Project Type: ${upif.projectType}`);
  if (upif.location) sections.push(`Location: ${upif.location}`);

  if (upif.feedstocks && Array.isArray(upif.feedstocks) && upif.feedstocks.length > 0) {
    const feedLines = upif.feedstocks.map((f: any, i: number) => {
      const parts: string[] = [`Feedstock ${i + 1}: ${f.feedstockType || "Unknown"}`];
      if (f.feedstockVolume) parts.push(`  Volume: ${f.feedstockVolume} ${f.feedstockUnit || ""}`);
      return parts.join("\n");
    });
    sections.push("FEEDSTOCKS:\n" + feedLines.join("\n"));
  }

  if (upif.outputRequirements) sections.push(`Output Requirements: ${upif.outputRequirements}`);

  if (upif.constraints && Array.isArray(upif.constraints) && upif.constraints.length > 0) {
    sections.push("Constraints:\n" + upif.constraints.map((c: string) => `  - ${c}`).join("\n"));
  }

  return sections.join("\n\n");
}

function buildCapexDataString(capexResults: CapexResults | null): string {
  if (!capexResults) return "No CapEx data available.";

  const sections: string[] = [];
  const summary = capexResults.summary;

  if (summary) {
    sections.push("CAPEX SUMMARY:");
    sections.push(`  Total Equipment Cost: $${summary.totalEquipmentCost?.toLocaleString() || 0}`);
    sections.push(`  Total Installed Cost: $${summary.totalInstalledCost?.toLocaleString() || 0}`);
    sections.push(`  Total Project Cost: $${summary.totalProjectCost?.toLocaleString() || 0}`);
    if (summary.costPerUnit) {
      sections.push(`  Cost per Unit: $${summary.costPerUnit.value?.toLocaleString() || 0} ${summary.costPerUnit.unit}`);
    }
  }

  if (capexResults.lineItems && capexResults.lineItems.length > 0) {
    const processTotals = new Map<string, number>();
    for (const li of capexResults.lineItems) {
      const proc = li.process || "Other";
      processTotals.set(proc, (processTotals.get(proc) || 0) + (li.totalCost || 0));
    }
    const procLines = Array.from(processTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([proc, total]) => `  ${proc}: $${total.toLocaleString()}`);
    sections.push("CAPEX BY PROCESS AREA:\n" + procLines.join("\n"));
  }

  return sections.join("\n");
}

async function getPromptTemplate(key: PromptKey, storage?: any): Promise<string> {
  if (storage && typeof storage.getPromptTemplateByKey === "function") {
    try {
      const dbTemplate = await storage.getPromptTemplateByKey(key);
      if (dbTemplate) return dbTemplate.template;
    } catch (e) {
    }
  }
  return DEFAULT_PROMPTS[key].template;
}

const OPEX_CATEGORIES = ["Labor", "Energy", "Chemical", "Maintenance", "Disposal", "Other", "Revenue Offset"];

interface DeterministicResult {
  lineItems: OpexLineItem[];
  skippedCategories: string[];
}

function calculateDeterministicLineItems(
  massBalanceResults: MassBalanceResults,
  capexResults: CapexResults | null,
  projectType: string,
): DeterministicResult {
  const lineItems: OpexLineItem[] = [];
  const skippedCategories: string[] = [];
  const pt = projectType.toLowerCase();

  const totalEquipmentCost = capexResults?.summary?.totalEquipmentCost || 0;
  if (totalEquipmentCost > 0) {
    const maintenanceRate = (pt === "a") ? 0.03 : 0.04;
    const maintenanceCost = Math.round(totalEquipmentCost * maintenanceRate);
    lineItems.push({
      id: `opex-det-maintenance-${Math.random().toString(36).substring(2, 8)}`,
      category: "Maintenance",
      description: `Annual maintenance & repairs (${(maintenanceRate * 100).toFixed(0)}% of equipment CapEx)`,
      annualCost: maintenanceCost,
      unitCost: undefined,
      unitBasis: undefined,
      scalingBasis: `$${totalEquipmentCost.toLocaleString()} equipment cost`,
      percentOfRevenue: undefined,
      costBasis: `Deterministic: ${(maintenanceRate * 100).toFixed(0)}% of total equipment CapEx`,
      source: "WEF MOP 8 / industry benchmark",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
    skippedCategories.push("Maintenance");
  }

  const powerKeys = ["power", "motor", "hp", "installed power", "rated power", "brake horsepower"];
  let totalKw = 0;
  if (massBalanceResults.equipment && massBalanceResults.equipment.length > 0) {
    for (const eq of massBalanceResults.equipment) {
      if (!eq.specs) continue;
      let bestKw = 0;
      for (const [key, spec] of Object.entries(eq.specs)) {
        const keyLower = key.toLowerCase();
        if (!powerKeys.some(pk => keyLower.includes(pk))) continue;
        const numVal = parseFloat(String(spec.value).replace(/,/g, ""));
        if (isNaN(numVal) || numVal <= 0) continue;
        const unitLower = (spec.unit || "").toLowerCase();
        let kw = 0;
        if (unitLower.includes("hp") || unitLower.includes("horsepower")) {
          kw = numVal * 0.7457;
        } else if (unitLower.includes("mw")) {
          kw = numVal * 1000;
        } else if (unitLower.includes("kw")) {
          kw = numVal;
        } else if (unitLower.includes("w")) {
          kw = numVal / 1000;
        } else {
          kw = numVal * 0.7457;
        }
        if (kw > bestKw) bestKw = kw;
      }
      totalKw += bestKw * (eq.quantity || 1);
    }
  }

  if (totalKw > 0) {
    const loadFactor = 0.75;
    const hoursPerYear = 8760;
    const electricityRate = 0.08;
    const annualEnergyCost = Math.round(totalKw * loadFactor * hoursPerYear * electricityRate);
    lineItems.push({
      id: `opex-det-energy-${Math.random().toString(36).substring(2, 8)}`,
      category: "Energy",
      description: `Electrical power (${Math.round(totalKw)} kW installed, 75% load factor, $0.08/kWh)`,
      annualCost: annualEnergyCost,
      unitCost: electricityRate,
      unitBasis: "$/kWh",
      scalingBasis: `${Math.round(totalKw)} kW installed capacity`,
      percentOfRevenue: undefined,
      costBasis: "Deterministic: equipment HP specs from mass balance × $0.08/kWh",
      source: "EIA national average electricity rate",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
    skippedCategories.push("Energy");
  }

  return { lineItems, skippedCategories };
}

function categorizeLineItem(item: any): string {
  const cat = (item.category || "").toLowerCase();
  if (cat.includes("labor") || cat.includes("staff") || cat.includes("personnel")) return "Labor";
  if (cat.includes("energy") || cat.includes("electric") || cat.includes("utilit") || cat.includes("fuel") || cat.includes("heat")) return "Energy";
  if (cat.includes("chemical") || cat.includes("consumab") || cat.includes("media") || cat.includes("membrane")) return "Chemical";
  if (cat.includes("mainten") || cat.includes("repair") || cat.includes("spare")) return "Maintenance";
  if (cat.includes("dispos") || cat.includes("haul") || cat.includes("sludge") || cat.includes("digestate") || cat.includes("solid")) return "Disposal";
  if (cat.includes("revenue") || cat.includes("offset") || cat.includes("credit") || cat.includes("sales")) return "Revenue Offset";
  return "Other";
}

function validateOpexResults(parsed: any, totalProjectCapex: number): OpexResults {
  const lineItems: OpexLineItem[] = Array.isArray(parsed.lineItems)
    ? parsed.lineItems.map((item: any, idx: number) => ({
        id: item.id || `opex-${idx}-${Math.random().toString(36).substring(2, 8)}`,
        category: item.category || categorizeLineItem(item),
        description: item.description || "",
        annualCost: typeof item.annualCost === "number" ? item.annualCost : 0,
        unitCost: typeof item.unitCost === "number" ? item.unitCost : undefined,
        unitBasis: item.unitBasis || undefined,
        scalingBasis: item.scalingBasis || undefined,
        percentOfRevenue: typeof item.percentOfRevenue === "number" ? item.percentOfRevenue : undefined,
        costBasis: item.costBasis || "Estimated, 2025 USD",
        source: item.source || "estimated",
        notes: item.notes || "",
        isOverridden: false,
        isLocked: false,
      }))
    : [];

  const totalLaborCost = lineItems.filter(li => categorizeLineItem(li) === "Labor").reduce((sum, li) => sum + li.annualCost, 0);
  const totalEnergyCost = lineItems.filter(li => categorizeLineItem(li) === "Energy").reduce((sum, li) => sum + li.annualCost, 0);
  const totalChemicalCost = lineItems.filter(li => categorizeLineItem(li) === "Chemical").reduce((sum, li) => sum + li.annualCost, 0);
  const totalMaintenanceCost = lineItems.filter(li => categorizeLineItem(li) === "Maintenance").reduce((sum, li) => sum + li.annualCost, 0);
  const totalDisposalCost = lineItems.filter(li => categorizeLineItem(li) === "Disposal").reduce((sum, li) => sum + li.annualCost, 0);
  const revenueOffsets = lineItems.filter(li => categorizeLineItem(li) === "Revenue Offset").reduce((sum, li) => sum + li.annualCost, 0);
  const totalOtherCost = lineItems.filter(li => categorizeLineItem(li) === "Other").reduce((sum, li) => sum + li.annualCost, 0);

  const totalAnnualOpex = totalLaborCost + totalEnergyCost + totalChemicalCost + totalMaintenanceCost + totalDisposalCost + totalOtherCost;
  const netAnnualOpex = totalAnnualOpex + revenueOffsets;

  const defaultSummary: OpexSummary = {
    totalAnnualOpex,
    totalLaborCost,
    totalEnergyCost,
    totalChemicalCost,
    totalMaintenanceCost,
    totalDisposalCost,
    totalOtherCost,
    revenueOffsets,
    netAnnualOpex,
    opexAsPercentOfCapex: totalProjectCapex > 0 ? Math.round((totalAnnualOpex / totalProjectCapex) * 1000) / 10 : undefined,
  };

  const summary = parsed.summary && typeof parsed.summary === "object"
    ? {
        totalAnnualOpex: typeof parsed.summary.totalAnnualOpex === "number" ? parsed.summary.totalAnnualOpex : defaultSummary.totalAnnualOpex,
        totalLaborCost: typeof parsed.summary.totalLaborCost === "number" ? parsed.summary.totalLaborCost : defaultSummary.totalLaborCost,
        totalEnergyCost: typeof parsed.summary.totalEnergyCost === "number" ? parsed.summary.totalEnergyCost : defaultSummary.totalEnergyCost,
        totalChemicalCost: typeof parsed.summary.totalChemicalCost === "number" ? parsed.summary.totalChemicalCost : defaultSummary.totalChemicalCost,
        totalMaintenanceCost: typeof parsed.summary.totalMaintenanceCost === "number" ? parsed.summary.totalMaintenanceCost : defaultSummary.totalMaintenanceCost,
        totalDisposalCost: typeof parsed.summary.totalDisposalCost === "number" ? parsed.summary.totalDisposalCost : defaultSummary.totalDisposalCost,
        totalOtherCost: typeof parsed.summary.totalOtherCost === "number" ? parsed.summary.totalOtherCost : defaultSummary.totalOtherCost,
        revenueOffsets: typeof parsed.summary.revenueOffsets === "number" ? parsed.summary.revenueOffsets : defaultSummary.revenueOffsets,
        netAnnualOpex: typeof parsed.summary.netAnnualOpex === "number" ? parsed.summary.netAnnualOpex : defaultSummary.netAnnualOpex,
        opexPerUnit: parsed.summary.opexPerUnit || undefined,
        opexAsPercentOfCapex: typeof parsed.summary.opexAsPercentOfCapex === "number"
          ? parsed.summary.opexAsPercentOfCapex
          : defaultSummary.opexAsPercentOfCapex,
      }
    : defaultSummary;

  return {
    projectType: parsed.projectType || "A",
    lineItems,
    summary,
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    costYear: parsed.costYear || "2025",
    currency: parsed.currency || "USD",
    methodology: parsed.methodology || "Bottom-up operating cost estimate",
  };
}

function repairTruncatedJSON(raw: string): any {
  let s = raw.trim();
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i++) {
    const openBraces = (s.match(/\{/g) || []).length;
    const closeBraces = (s.match(/\}/g) || []).length;
    const openBrackets = (s.match(/\[/g) || []).length;
    const closeBrackets = (s.match(/\]/g) || []).length;

    if (openBraces === closeBraces && openBrackets === closeBrackets) {
      break;
    }

    s = s.replace(/,\s*$/, "");

    if (openBrackets > closeBrackets) {
      s += "]";
    } else if (openBraces > closeBraces) {
      s += "}";
    } else {
      break;
    }
  }

  return JSON.parse(s);
}

export interface OpexAIResult {
  results: OpexResults;
  provider: LLMProvider;
  providerLabel: string;
}

export async function generateOpexWithAI(
  upif: any,
  massBalanceResults: MassBalanceResults,
  capexResults: CapexResults | null,
  projectType: string,
  preferredModel: LLMProvider = "gpt5",
  storage?: any,
): Promise<OpexAIResult> {
  const normalizedType = normalizeProjectType(projectType);
  const promptKey = opexPromptMap[normalizedType] || "opex_type_a";

  let model = preferredModel;
  if (!isProviderAvailable(model)) {
    const fallback = getAvailableProviders()[0];
    if (!fallback) {
      throw new Error("No LLM provider is available. Configure an API key for OpenAI or Anthropic.");
    }
    console.log(`OpEx AI: ${model} not available, falling back to ${fallback}`);
    model = fallback;
  }

  const promptTemplate = await getPromptTemplate(promptKey, storage);
  const equipmentDataString = buildEquipmentDataString(massBalanceResults);
  const upifContextString = buildUpifContextString(upif);
  const capexDataString = buildCapexDataString(capexResults);

  const { lineItems: deterministicItems, skippedCategories } = calculateDeterministicLineItems(
    massBalanceResults, capexResults, normalizedType
  );

  if (deterministicItems.length > 0) {
    console.log(`OpEx AI: Pre-calculated ${deterministicItems.length} deterministic line items (${skippedCategories.join(", ")})`);
  }

  const systemPrompt = promptTemplate
    .replace("{{EQUIPMENT_DATA}}", equipmentDataString)
    .replace("{{UPIF_DATA}}", upifContextString)
    .replace("{{CAPEX_DATA}}", capexDataString);

  console.log(`OpEx AI: Generating for project type ${normalizedType.toUpperCase()} using ${model} (prompt: ${promptKey})`);

  const skipNote = skippedCategories.length > 0
    ? ` NOTE: The following cost categories have been pre-calculated from engineering data and must be EXCLUDED from your response — do NOT generate line items for: ${skippedCategories.join(", ")}.`
    : "";

  const isOpus = model === "claude-opus";
  const opexMaxTokens = isOpus ? 12288 : 16384;
  const opexUserMsg = `Generate a complete annual operating expenditure estimate based on the mass balance equipment list, project data, and capital cost estimate provided. Return valid JSON only. Keep descriptions and notes concise (1 sentence max). Combine similar items where possible.${skipNote}`;

  const response = await llmComplete({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: opexUserMsg },
    ],
    maxTokens: opexMaxTokens,
    jsonMode: true,
  });

  console.log(`OpEx AI: Response received from ${response.provider}, ${response.content.length} chars, stop_reason=${response.stopReason || "unknown"}`);

  let rawContent = response.content;
  rawContent = rawContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (parseError) {
    console.log("OpEx AI: Initial JSON parse failed, attempting truncation repair...");
    try {
      parsed = repairTruncatedJSON(rawContent);
      console.log("OpEx AI: Successfully repaired truncated JSON");
    } catch (repairError) {
      console.error("OpEx AI: Failed to parse or repair JSON response:", rawContent.substring(0, 500));
      throw new Error(`AI returned invalid JSON. Parse error: ${(parseError as Error).message}`);
    }
  }

  if (deterministicItems.length > 0) {
    const aiLineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems : [];
    const filteredAiItems = aiLineItems.filter((item: any) => {
      const cat = categorizeLineItem(item);
      if (skippedCategories.includes(cat)) return false;
      const desc = ((item.description || "") + " " + (item.category || "")).toLowerCase();
      if (skippedCategories.includes("Maintenance") && (desc.includes("mainten") || desc.includes("repair"))) return false;
      if (skippedCategories.includes("Energy") && (desc.includes("energy") || desc.includes("electric") || desc.includes("power cost"))) return false;
      return true;
    });
    parsed.lineItems = [...deterministicItems, ...filteredAiItems];
  }

  const totalProjectCapex = capexResults?.summary?.totalProjectCost || 0;
  const results = validateOpexResults(parsed, totalProjectCapex);

  const editableAssumptions = getDefaultOpexAssumptions(projectType, massBalanceResults, capexResults);
  results.editableAssumptions = editableAssumptions;

  const displayAssumptions = editableAssumptions.map(a => ({
    parameter: a.parameter,
    value: typeof a.value === "number"
      ? (a.unit.includes("$") || a.unit.includes("/yr") ? `$${a.value.toLocaleString()} ${a.unit}` : `${a.value.toLocaleString()} ${a.unit}`)
      : `${a.value} ${a.unit}`,
    source: a.source,
  }));
  if (results.assumptions.length === 0 || results.assumptions.every(a => !a.parameter)) {
    results.assumptions = displayAssumptions;
  } else {
    results.assumptions = [...displayAssumptions, ...results.assumptions];
  }

  return {
    results,
    provider: response.provider as LLMProvider,
    providerLabel: providerLabels[response.provider as LLMProvider] || response.provider,
  };
}
