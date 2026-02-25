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
  const gasCostPerMMBtu = 4.50;

  const assumptions: OpexEditableAssumption[] = [
    { key: "maintenance_rate", parameter: "Maintenance Rate", value: maintenanceRate, unit: "% of equipment CapEx", source: "WEF MOP 8 / Industry benchmark", category: "Maintenance", description: "Annual maintenance & repair cost as a percentage of total equipment capital cost" },
    { key: "electricity_rate", parameter: "Electricity Rate", value: electricityRate, unit: "$/kWh", source: "EIA national average", category: "Energy", description: "Average electricity cost per kilowatt-hour" },
    { key: "gas_cost", parameter: "Natural Gas Cost", value: gasCostPerMMBtu, unit: "$/MMBtu", source: "Burnham OpEx Model", category: "Energy", description: "Natural gas cost per MMBtu for heating" },
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
      { key: "potable_water_rate", parameter: "Potable Water Rate", value: 0.007, unit: "$/gal", source: "Burnham OpEx Model", category: "Water & Sewer", description: "Municipal potable water supply cost per gallon" },
      { key: "sewer_fee_rate", parameter: "Sewer Fee Rate", value: 0.01, unit: "$/gal", source: "Burnham OpEx Model", category: "Water & Sewer", description: "Sewage discharge fee per gallon of effluent" },
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
      { key: "ad_elec_per_gpd", parameter: "AD Electricity Rate", value: 3, unit: "(kWh/yr)/GPD", source: "Burnham OpEx Model", category: "Energy", description: "Annual electrical consumption per GPD of AD influent" },
      { key: "guu_elec_per_scfm", parameter: "GUU Electricity Rate", value: 7227, unit: "(kWh/yr)/scfm", source: "Burnham OpEx Model", category: "Energy", description: "Annual electrical consumption per scfm biogas for gas upgrading unit" },
      { key: "ad_ng_per_gpd", parameter: "AD Natural Gas Rate", value: 0.157, unit: "(MMBtu/yr)/GPD", source: "Burnham OpEx Model", category: "Energy", description: "Annual natural gas consumption per GPD for AD heating" },
      { key: "guu_ng_per_scfm", parameter: "GUU Natural Gas Rate", value: 2, unit: "(MMBtu/yr)/scfm", source: "Burnham OpEx Model", category: "Energy", description: "Annual natural gas consumption per scfm biogas for GUU" },
      { key: "ad_thermal_efficiency", parameter: "AD Thermal Efficiency", value: 90, unit: "%", source: "Burnham OpEx Model", category: "Energy", description: "Boiler/heater thermal efficiency for AD heating" },
      { key: "ad_heat_supply_efficiency", parameter: "AD Heat Supply Efficiency", value: 82, unit: "%", source: "Burnham OpEx Model", category: "Energy", description: "Heat distribution system efficiency" },
      { key: "ad_import_temp", parameter: "AD Import Temperature", value: 76, unit: "°F", source: "Burnham OpEx Model", category: "Energy", description: "Temperature of incoming feedstock/influent" },
      { key: "ad_operating_temp", parameter: "AD Operating Temperature", value: 95, unit: "°F", source: "Burnham OpEx Model", category: "Energy", description: "Target digester operating temperature" },
      { key: "feedstock_receiving_cost", parameter: "Feedstock Receiving & Handling", value: pt === "b" ? 15 : 5, unit: "$/ton", source: "Industry estimate", category: "Chemical", description: "Cost for feedstock receiving, screening, and preprocessing" },
      { key: "guu_consumables_per_scfm", parameter: "GUU Consumables", value: 90, unit: "$/scfm biogas", source: "Burnham OpEx Model", category: "Chemical", description: "Annual consumables cost per scfm biogas for gas upgrading unit" },
      { key: "liquid_digestate_disposal_cost", parameter: "Liquid Digestate Disposal", value: 0.01, unit: "$/gal", source: "Burnham OpEx Model", category: "Disposal", description: "Cost to haul and dispose of liquid digestate fraction" },
      { key: "solid_digestate_disposal_cost", parameter: "Solid Digestate Disposal", value: 10, unit: "$/ton", source: "Burnham OpEx Model", category: "Disposal", description: "Cost to haul and land-apply solid digestate fraction" },
      { key: "membrane_replacement", parameter: "Membrane/Media Replacement", value: pt === "b" ? 50000 : 35000, unit: "$/yr", source: "Prodeval maintenance schedule", category: "Maintenance", description: "Annual membrane and media replacement for gas upgrading system" },
      { key: "potable_water_rate", parameter: "Potable Water Rate", value: 0.007, unit: "$/gal", source: "Burnham OpEx Model", category: "Water & Sewer", description: "Municipal potable water supply cost per gallon" },
      { key: "sewer_fee_rate", parameter: "Sewer Fee Rate", value: 0.01, unit: "$/gal", source: "Burnham OpEx Model", category: "Water & Sewer", description: "Sewage discharge fee per gallon of liquid effluent" },
      { key: "lab_testing_annual", parameter: "Lab & Testing", value: 15000, unit: "$/yr", source: "Regulatory compliance estimate", category: "Other", description: "Annual gas quality testing and environmental monitoring" },
      { key: "interconnect_fees", parameter: "Pipeline Interconnect Fees", value: 12000, unit: "$/yr", source: "Utility estimate", category: "Other", description: "Annual gas pipeline interconnection and metering fees" },
    );
  }

  return assumptions;
}

function extractMBValue(summary: Record<string, any> | undefined, ...keywords: string[]): number {
  if (!summary) return 0;
  for (const [key, val] of Object.entries(summary)) {
    const kl = key.toLowerCase();
    if (keywords.some(kw => kl.includes(kw))) {
      const v = parseFloat(String(val.value).replace(/,/g, ""));
      if (!isNaN(v) && v > 0) return v;
    }
  }
  return 0;
}

function extractMBValueWithUnit(summary: Record<string, any> | undefined, keyword: string, unitKeyword: string): number {
  if (!summary) return 0;
  for (const [key, val] of Object.entries(summary)) {
    if (key.toLowerCase().includes(keyword) && (val.unit || "").toLowerCase().includes(unitKeyword)) {
      const v = parseFloat(String(val.value).replace(/,/g, ""));
      if (!isNaN(v) && v > 0) return v;
    }
  }
  return 0;
}

export function calculateAllDeterministicLineItems(
  assumptions: OpexEditableAssumption[],
  massBalanceResults: MassBalanceResults,
  capexResults: CapexResults | null,
  projectType: string,
): OpexLineItem[] {
  const lineItems: OpexLineItem[] = [];
  const pt = normalizeProjectType(projectType);
  const isRNG = pt === "b" || pt === "c" || pt === "d";
  let idCounter = 1;
  const makeId = () => `opex-det-${idCounter++}`;

  const getVal = (key: string): number => {
    const a = assumptions.find(a => a.key === key);
    return a ? a.value : 0;
  };

  const totalEquipmentCost = capexResults?.summary?.totalEquipmentCost || 0;
  const totalProjectCost = capexResults?.summary?.totalProjectCost || 0;

  const summary = massBalanceResults.summary;
  const rngMMBtu = extractMBValue(summary, "rng", "renewable") || extractMBValue(summary, "biomethane", "pipeline gas");
  const annualRngMMBtu = rngMMBtu > 10000 ? rngMMBtu : rngMMBtu * 365;

  const influGPD = extractMBValue(summary, "influent", "inflow", "ad influent", "burnham") || extractMBValue(summary, "flow", "gpd");
  const biogasScfm = extractMBValue(summary, "biogas", "scfm");

  const electricityRate = getVal("electricity_rate");
  const gasCost = getVal("gas_cost");
  const loadFactor = getVal("load_factor") / 100;
  const operatingHours = getVal("operating_hours");

  const maintenanceRate = getVal("maintenance_rate") / 100;
  if (totalEquipmentCost > 0 && maintenanceRate > 0) {
    const maintenanceCost = Math.round(totalEquipmentCost * maintenanceRate);
    lineItems.push({
      id: makeId(),
      category: "Maintenance",
      description: `Annual maintenance & repairs (${(maintenanceRate * 100).toFixed(1)}% of equipment CapEx $${totalEquipmentCost.toLocaleString()})`,
      annualCost: maintenanceCost,
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((maintenanceCost / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: `$${totalEquipmentCost.toLocaleString()} equipment cost`,
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
      equipmentArea: "GUU",
      description: "Membrane & media replacement (gas upgrading system)",
      annualCost: Math.round(membraneReplacement),
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((membraneReplacement / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: "Per Prodeval maintenance schedule",
      costBasis: `Deterministic: $${membraneReplacement.toLocaleString()}/yr`,
      source: "Prodeval maintenance schedule",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  if (isRNG && influGPD > 0 && biogasScfm > 0 && electricityRate > 0) {
    const adElecRate = getVal("ad_elec_per_gpd");
    const guuElecRate = getVal("guu_elec_per_scfm");

    if (adElecRate > 0) {
      const adElecKwh = influGPD * adElecRate;
      const adElecCost = Math.round(adElecKwh * electricityRate);
      lineItems.push({
        id: makeId(),
        category: "Energy",
        equipmentArea: "AD",
        description: `AD electrical power (${Math.round(influGPD).toLocaleString()} GPD × ${adElecRate} kWh/yr/GPD × $${electricityRate}/kWh)`,
        annualCost: adElecCost,
        unitCost: electricityRate,
        unitBasis: "$/kWh",
        costPerMMBtu: annualRngMMBtu > 0 ? Math.round((adElecCost / annualRngMMBtu) * 100) / 100 : undefined,
        scalingBasis: `${Math.round(influGPD).toLocaleString()} GPD AD influent`,
        costBasis: `Deterministic: ${Math.round(influGPD).toLocaleString()} GPD × ${adElecRate} kWh/yr/GPD × $${electricityRate}/kWh`,
        source: "Burnham OpEx Model",
        notes: "",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (guuElecRate > 0) {
      const guuElecKwh = biogasScfm * guuElecRate;
      const guuElecCost = Math.round(guuElecKwh * electricityRate);
      lineItems.push({
        id: makeId(),
        category: "Energy",
        equipmentArea: "GUU",
        description: `GUU electrical power (${Math.round(biogasScfm).toLocaleString()} scfm × ${guuElecRate.toLocaleString()} kWh/yr/scfm × $${electricityRate}/kWh)`,
        annualCost: guuElecCost,
        unitCost: electricityRate,
        unitBasis: "$/kWh",
        costPerMMBtu: annualRngMMBtu > 0 ? Math.round((guuElecCost / annualRngMMBtu) * 100) / 100 : undefined,
        scalingBasis: `${Math.round(biogasScfm).toLocaleString()} scfm biogas`,
        costBasis: `Deterministic: ${Math.round(biogasScfm).toLocaleString()} scfm × ${guuElecRate.toLocaleString()} kWh/yr/scfm × $${electricityRate}/kWh`,
        source: "Burnham OpEx Model",
        notes: "",
        isOverridden: false,
        isLocked: false,
      });
    }
  } else {
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

    if (totalKw > 0 && electricityRate > 0) {
      const annualEnergyCost = Math.round(totalKw * loadFactor * operatingHours * electricityRate);
      lineItems.push({
        id: makeId(),
        category: "Energy",
        description: `Electrical power (${Math.round(totalKw)} kW installed, ${(loadFactor * 100).toFixed(0)}% load factor, $${electricityRate}/kWh)`,
        annualCost: annualEnergyCost,
        unitCost: electricityRate,
        unitBasis: "$/kWh",
        costPerMMBtu: annualRngMMBtu > 0 ? Math.round((annualEnergyCost / annualRngMMBtu) * 100) / 100 : undefined,
        scalingBasis: `${Math.round(totalKw)} kW installed capacity`,
        costBasis: `Deterministic: ${Math.round(totalKw)} kW × ${(loadFactor * 100).toFixed(0)}% × ${operatingHours.toLocaleString()} hr × $${electricityRate}/kWh`,
        source: "Equipment specs + EIA rates",
        notes: "",
        isOverridden: false,
        isLocked: false,
      });
    }
  }

  if (isRNG && gasCost > 0) {
    const adNgPerGpd = getVal("ad_ng_per_gpd");
    const guuNgPerScfm = getVal("guu_ng_per_scfm");
    const thermalEff = getVal("ad_thermal_efficiency") / 100 || 0.9;
    const heatSupplyEff = getVal("ad_heat_supply_efficiency") / 100 || 0.82;
    const importTemp = getVal("ad_import_temp") || 76;
    const adTemp = getVal("ad_operating_temp") || 95;
    const deltaTemp = adTemp - importTemp;

    if (influGPD > 0 && deltaTemp > 0) {
      const waterLbsPerYear = influGPD * 365 * 8.34;
      const thermsNeeded = deltaTemp * waterLbsPerYear / 1e6;
      const purchasedNG = thermsNeeded / (thermalEff * heatSupplyEff);
      const adNgCost = Math.round(purchasedNG * gasCost);
      if (adNgCost > 0) {
        lineItems.push({
          id: makeId(),
          category: "Energy",
          equipmentArea: "AD",
          description: `AD heating — natural gas (ΔT=${deltaTemp}°F, ${Math.round(influGPD).toLocaleString()} GPD, η=${(thermalEff * 100).toFixed(0)}%/${(heatSupplyEff * 100).toFixed(0)}%)`,
          annualCost: adNgCost,
          unitCost: gasCost,
          unitBasis: "$/MMBtu",
          costPerMMBtu: annualRngMMBtu > 0 ? Math.round((adNgCost / annualRngMMBtu) * 100) / 100 : undefined,
          scalingBasis: `${Math.round(purchasedNG).toLocaleString()} MMBtu/yr purchased NG`,
          costBasis: `Deterministic: ΔT ${deltaTemp}°F × ${Math.round(waterLbsPerYear).toLocaleString()} lbs/yr ÷ η(${(thermalEff * 100).toFixed(0)}% × ${(heatSupplyEff * 100).toFixed(0)}%) × $${gasCost}/MMBtu`,
          source: "Burnham OpEx Model — thermodynamic calc",
          notes: "",
          isOverridden: false,
          isLocked: false,
        });
      }
    } else if (influGPD > 0 && adNgPerGpd > 0) {
      const adNgMMBtu = influGPD * adNgPerGpd;
      const adNgCost = Math.round(adNgMMBtu * gasCost);
      lineItems.push({
        id: makeId(),
        category: "Energy",
        equipmentArea: "AD",
        description: `AD natural gas (${Math.round(influGPD).toLocaleString()} GPD × ${adNgPerGpd} MMBtu/yr/GPD × $${gasCost}/MMBtu)`,
        annualCost: adNgCost,
        unitCost: gasCost,
        unitBasis: "$/MMBtu",
        costPerMMBtu: annualRngMMBtu > 0 ? Math.round((adNgCost / annualRngMMBtu) * 100) / 100 : undefined,
        scalingBasis: `${Math.round(influGPD).toLocaleString()} GPD AD influent`,
        costBasis: `Deterministic: ${Math.round(influGPD).toLocaleString()} GPD × ${adNgPerGpd} MMBtu/yr/GPD × $${gasCost}/MMBtu`,
        source: "Burnham OpEx Model",
        notes: "",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (biogasScfm > 0 && guuNgPerScfm > 0) {
      const guuNgMMBtu = biogasScfm * guuNgPerScfm;
      const guuNgCost = Math.round(guuNgMMBtu * gasCost);
      lineItems.push({
        id: makeId(),
        category: "Energy",
        equipmentArea: "GUU",
        description: `GUU natural gas (${Math.round(biogasScfm).toLocaleString()} scfm × ${guuNgPerScfm} MMBtu/yr/scfm × $${gasCost}/MMBtu)`,
        annualCost: guuNgCost,
        unitCost: gasCost,
        unitBasis: "$/MMBtu",
        costPerMMBtu: annualRngMMBtu > 0 ? Math.round((guuNgCost / annualRngMMBtu) * 100) / 100 : undefined,
        scalingBasis: `${Math.round(biogasScfm).toLocaleString()} scfm biogas`,
        costBasis: `Deterministic: ${Math.round(biogasScfm).toLocaleString()} scfm × ${guuNgPerScfm} MMBtu/yr/scfm × $${gasCost}/MMBtu`,
        source: "Burnham OpEx Model",
        notes: "",
        isOverridden: false,
        isLocked: false,
      });
    }
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
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((totalOperatorCost / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: `${operatorCount} FTEs`,
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
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((totalMgmtCost / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: `${managementCount} FTEs`,
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
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((annualChemCost / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: `${flowMGD} MGD × 365 days`,
      costBasis: `Deterministic: $${chemicalCostPerMG}/MG × ${annualMG.toLocaleString()} MG/yr`,
      source: "EPA CWNS benchmark",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const feedstockReceivingCost = getVal("feedstock_receiving_cost");
  if (feedstockReceivingCost > 0 && isRNG) {
    let annualTons = 0;
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
      equipmentArea: "AD",
      description: `Feedstock receiving & handling ($${feedstockReceivingCost}/ton × ${annualTons.toLocaleString()} tons/yr)`,
      annualCost: annualCost,
      unitCost: feedstockReceivingCost,
      unitBasis: "$/ton",
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((annualCost / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: `${annualTons.toLocaleString()} tons/yr throughput`,
      costBasis: `Deterministic: $${feedstockReceivingCost}/ton × ${annualTons.toLocaleString()} tons/yr`,
      source: "Industry estimate",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  const guuConsumablesPerScfm = getVal("guu_consumables_per_scfm");
  if (guuConsumablesPerScfm > 0 && biogasScfm > 0 && isRNG) {
    const guuConsCost = Math.round(guuConsumablesPerScfm * biogasScfm);
    lineItems.push({
      id: makeId(),
      category: "Chemical",
      equipmentArea: "GUU",
      description: `GUU consumables ($${guuConsumablesPerScfm}/scfm × ${Math.round(biogasScfm).toLocaleString()} scfm)`,
      annualCost: guuConsCost,
      unitCost: guuConsumablesPerScfm,
      unitBasis: "$/scfm biogas",
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((guuConsCost / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: `${Math.round(biogasScfm).toLocaleString()} scfm biogas`,
      costBasis: `Deterministic: $${guuConsumablesPerScfm}/scfm × ${Math.round(biogasScfm).toLocaleString()} scfm`,
      source: "Burnham OpEx Model",
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
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((annualCost / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: `${annualWetTons.toLocaleString()} wet tons/yr`,
      costBasis: `Deterministic: $${sludgeDisposalCost}/wet ton × ${annualWetTons.toLocaleString()} wet tons/yr`,
      source: "Regional average",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  if (isRNG) {
    const liquidDisposalCost = getVal("liquid_digestate_disposal_cost");
    const solidDisposalCost = getVal("solid_digestate_disposal_cost");

    let liquidGalYr = 0;
    let solidTonsYr = 0;
    if (summary) {
      for (const [key, val] of Object.entries(summary)) {
        const kl = key.toLowerCase();
        if (kl.includes("liquid") && kl.includes("digestate")) {
          const v = parseFloat(String(val.value).replace(/,/g, ""));
          if (!isNaN(v) && v > 0) {
            const ul = (val.unit || "").toLowerCase();
            if (ul.includes("gal")) liquidGalYr = v > 1000000 ? v : v * 365;
            else if (ul.includes("ton")) { liquidGalYr = v * 365 * 2000 / 8.34; }
          }
        }
        if (kl.includes("solid") && kl.includes("digestate")) {
          const v = parseFloat(String(val.value).replace(/,/g, ""));
          if (!isNaN(v) && v > 0) {
            const ul = (val.unit || "").toLowerCase();
            if (ul.includes("ton")) solidTonsYr = v > 1000 ? v : v * 365;
          }
        }
      }
    }
    if (liquidGalYr <= 0 && influGPD > 0) liquidGalYr = influGPD * 365 * 0.85;
    if (solidTonsYr <= 0 && influGPD > 0) solidTonsYr = influGPD * 365 * 8.34 * 0.05 / 2000;

    if (liquidDisposalCost > 0 && liquidGalYr > 0) {
      const cost = Math.round(liquidDisposalCost * liquidGalYr);
      lineItems.push({
        id: makeId(),
        category: "Disposal",
        equipmentArea: "AD",
        description: `Liquid digestate disposal ($${liquidDisposalCost}/gal × ${Math.round(liquidGalYr).toLocaleString()} gal/yr)`,
        annualCost: cost,
        unitCost: liquidDisposalCost,
        unitBasis: "$/gal",
        costPerMMBtu: annualRngMMBtu > 0 ? Math.round((cost / annualRngMMBtu) * 100) / 100 : undefined,
        scalingBasis: `${Math.round(liquidGalYr).toLocaleString()} gal/yr liquid digestate`,
        costBasis: `Deterministic: $${liquidDisposalCost}/gal × ${Math.round(liquidGalYr).toLocaleString()} gal/yr`,
        source: "Burnham OpEx Model",
        notes: "",
        isOverridden: false,
        isLocked: false,
      });
    }

    if (solidDisposalCost > 0 && solidTonsYr > 0) {
      const cost = Math.round(solidDisposalCost * solidTonsYr);
      lineItems.push({
        id: makeId(),
        category: "Disposal",
        equipmentArea: "AD",
        description: `Solid digestate disposal ($${solidDisposalCost}/ton × ${Math.round(solidTonsYr).toLocaleString()} tons/yr)`,
        annualCost: cost,
        unitCost: solidDisposalCost,
        unitBasis: "$/ton",
        costPerMMBtu: annualRngMMBtu > 0 ? Math.round((cost / annualRngMMBtu) * 100) / 100 : undefined,
        scalingBasis: `${Math.round(solidTonsYr).toLocaleString()} tons/yr solid digestate`,
        costBasis: `Deterministic: $${solidDisposalCost}/ton × ${Math.round(solidTonsYr).toLocaleString()} tons/yr`,
        source: "Burnham OpEx Model",
        notes: "",
        isOverridden: false,
        isLocked: false,
      });
    }
  }

  const potableWaterRate = getVal("potable_water_rate");
  const sewerFeeRate = getVal("sewer_fee_rate");
  if (potableWaterRate > 0 || sewerFeeRate > 0) {
    let effluentGalYr = 0;
    if (pt === "a") {
      const flowMGD = parseFloat(String(massBalanceResults.summary?.["designFlow"]?.value || "0"));
      effluentGalYr = flowMGD * 365 * 1e6;
    } else if (influGPD > 0) {
      effluentGalYr = influGPD * 365 * 0.85;
    }

    if (potableWaterRate > 0 && effluentGalYr > 0) {
      const potableGalYr = effluentGalYr * 0.05;
      const cost = Math.round(potableWaterRate * potableGalYr);
      if (cost > 0) {
        lineItems.push({
          id: makeId(),
          category: "Water & Sewer",
          description: `Potable water supply ($${potableWaterRate}/gal × ${Math.round(potableGalYr).toLocaleString()} gal/yr)`,
          annualCost: cost,
          unitCost: potableWaterRate,
          unitBasis: "$/gal",
          costPerMMBtu: annualRngMMBtu > 0 ? Math.round((cost / annualRngMMBtu) * 100) / 100 : undefined,
          scalingBasis: `${Math.round(potableGalYr).toLocaleString()} gal/yr potable water`,
          costBasis: `Deterministic: $${potableWaterRate}/gal × ${Math.round(potableGalYr).toLocaleString()} gal/yr`,
          source: "Burnham OpEx Model",
          notes: "",
          isOverridden: false,
          isLocked: false,
        });
      }
    }

    if (sewerFeeRate > 0 && effluentGalYr > 0) {
      const cost = Math.round(sewerFeeRate * effluentGalYr);
      if (cost > 0) {
        lineItems.push({
          id: makeId(),
          category: "Water & Sewer",
          description: `Sewer discharge fees ($${sewerFeeRate}/gal × ${Math.round(effluentGalYr).toLocaleString()} gal/yr)`,
          annualCost: cost,
          unitCost: sewerFeeRate,
          unitBasis: "$/gal",
          costPerMMBtu: annualRngMMBtu > 0 ? Math.round((cost / annualRngMMBtu) * 100) / 100 : undefined,
          scalingBasis: `${Math.round(effluentGalYr).toLocaleString()} gal/yr effluent`,
          costBasis: `Deterministic: $${sewerFeeRate}/gal × ${Math.round(effluentGalYr).toLocaleString()} gal/yr`,
          source: "Burnham OpEx Model",
          notes: "",
          isOverridden: false,
          isLocked: false,
        });
      }
    }
  }

  const insuranceRate = getVal("insurance_rate") / 100;
  if (totalProjectCost > 0 && insuranceRate > 0) {
    const insuranceCost = Math.round(totalProjectCost * insuranceRate);
    lineItems.push({
      id: makeId(),
      category: "Other",
      description: `Property & liability insurance (${(insuranceRate * 100).toFixed(1)}% of $${totalProjectCost.toLocaleString()} project cost)`,
      annualCost: insuranceCost,
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((insuranceCost / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: `$${totalProjectCost.toLocaleString()} total project cost`,
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
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((labTestingAnnual / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: "Annual lump sum",
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
      costPerMMBtu: annualRngMMBtu > 0 ? Math.round((interconnectFees / annualRngMMBtu) * 100) / 100 : undefined,
      scalingBasis: "Annual lump sum",
      costBasis: `Deterministic: $${interconnectFees.toLocaleString()}/yr`,
      source: "Utility estimate",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  return lineItems;
}

function buildOpexSummaryFromLineItems(lineItems: OpexLineItem[], totalProjectCapex: number, annualRngMMBtu?: number): OpexSummary {
  const categorize = (cat: string): string => {
    const c = cat.toLowerCase();
    if (c.includes("labor") || c.includes("staff") || c.includes("personnel")) return "Labor";
    if (c.includes("energy") || c.includes("electric") || c.includes("utilit") || c.includes("natural gas") || c.includes("fuel") || c.includes("heat")) return "Energy";
    if (c.includes("chemical") || c.includes("consumab") || c.includes("media") || c.includes("membrane") || c.includes("feedstock")) return "Chemical";
    if (c.includes("mainten") || c.includes("repair") || c.includes("spare")) return "Maintenance";
    if (c.includes("dispos") || c.includes("haul") || c.includes("sludge") || c.includes("digestate")) return "Disposal";
    if (c.includes("water") || c.includes("sewer")) return "Water & Sewer";
    if (c.includes("revenue") || c.includes("offset") || c.includes("credit")) return "Revenue Offset";
    return "Other";
  };

  const totalLaborCost = lineItems.filter(li => categorize(li.category) === "Labor").reduce((s, li) => s + li.annualCost, 0);
  const totalEnergyCost = lineItems.filter(li => categorize(li.category) === "Energy").reduce((s, li) => s + li.annualCost, 0);
  const totalChemicalCost = lineItems.filter(li => categorize(li.category) === "Chemical").reduce((s, li) => s + li.annualCost, 0);
  const totalMaintenanceCost = lineItems.filter(li => categorize(li.category) === "Maintenance").reduce((s, li) => s + li.annualCost, 0);
  const totalDisposalCost = lineItems.filter(li => categorize(li.category) === "Disposal").reduce((s, li) => s + li.annualCost, 0);
  const totalWaterSewerCost = lineItems.filter(li => categorize(li.category) === "Water & Sewer").reduce((s, li) => s + li.annualCost, 0);
  const totalOtherCost = lineItems.filter(li => categorize(li.category) === "Other").reduce((s, li) => s + li.annualCost, 0);
  const revenueOffsets = lineItems.filter(li => categorize(li.category) === "Revenue Offset").reduce((s, li) => s + li.annualCost, 0);

  const totalAnnualOpex = totalLaborCost + totalEnergyCost + totalChemicalCost + totalMaintenanceCost + totalDisposalCost + totalWaterSewerCost + totalOtherCost;
  const netAnnualOpex = totalAnnualOpex + revenueOffsets;

  const opexPerMMBtu = annualRngMMBtu && annualRngMMBtu > 0
    ? Math.round((totalAnnualOpex / annualRngMMBtu) * 100) / 100
    : undefined;

  return {
    totalAnnualOpex,
    totalLaborCost,
    totalEnergyCost,
    totalChemicalCost,
    totalMaintenanceCost,
    totalDisposalCost,
    totalWaterSewerCost: totalWaterSewerCost > 0 ? totalWaterSewerCost : undefined,
    totalOtherCost,
    revenueOffsets,
    netAnnualOpex,
    opexPerMMBtu,
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
  const rngMMBtu = extractMBValue(massBalanceResults.summary, "rng", "renewable") || extractMBValue(massBalanceResults.summary, "biomethane", "pipeline gas");
  const annualRngMMBtu = rngMMBtu > 10000 ? rngMMBtu : rngMMBtu * 365;
  const summary = buildOpexSummaryFromLineItems(lineItems, totalProjectCapex, annualRngMMBtu > 0 ? annualRngMMBtu : undefined);

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
  if (cat.includes("water") || cat.includes("sewer")) return "Water & Sewer";
  if (cat.includes("revenue") || cat.includes("offset") || cat.includes("credit") || cat.includes("sales")) return "Revenue Offset";
  return "Other";
}

function validateOpexResults(parsed: any, totalProjectCapex: number): OpexResults {
  const lineItems: OpexLineItem[] = Array.isArray(parsed.lineItems)
    ? parsed.lineItems.map((item: any, idx: number) => ({
        id: item.id || `opex-${idx}-${Math.random().toString(36).substring(2, 8)}`,
        category: item.category || categorizeLineItem(item),
        equipmentArea: item.equipmentArea || undefined,
        description: item.description || "",
        annualCost: typeof item.annualCost === "number" ? item.annualCost : 0,
        unitCost: typeof item.unitCost === "number" ? item.unitCost : undefined,
        unitBasis: item.unitBasis || undefined,
        costPerMMBtu: typeof item.costPerMMBtu === "number" ? item.costPerMMBtu : undefined,
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
  const totalWaterSewerCost = lineItems.filter(li => categorizeLineItem(li) === "Water & Sewer").reduce((sum, li) => sum + li.annualCost, 0);
  const revenueOffsets = lineItems.filter(li => categorizeLineItem(li) === "Revenue Offset").reduce((sum, li) => sum + li.annualCost, 0);
  const totalOtherCost = lineItems.filter(li => categorizeLineItem(li) === "Other").reduce((sum, li) => sum + li.annualCost, 0);

  const totalAnnualOpex = totalLaborCost + totalEnergyCost + totalChemicalCost + totalMaintenanceCost + totalDisposalCost + totalWaterSewerCost + totalOtherCost;
  const netAnnualOpex = totalAnnualOpex + revenueOffsets;

  const defaultSummary: OpexSummary = {
    totalAnnualOpex,
    totalLaborCost,
    totalEnergyCost,
    totalChemicalCost,
    totalMaintenanceCost,
    totalDisposalCost,
    totalWaterSewerCost: totalWaterSewerCost > 0 ? totalWaterSewerCost : undefined,
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

  const opexMaxTokens = 32768;
  const opexUserMsg = `Generate a complete annual operating expenditure estimate based on the mass balance equipment list, project data, and capital cost estimate provided. Return valid JSON only. Keep descriptions and notes concise (1 sentence max). Combine similar items where possible.${skipNote}`;

  const AI_TIMEOUT_MS = 240_000;

  let response: Awaited<ReturnType<typeof llmComplete>>;
  try {
    response = await Promise.race([
      llmComplete({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: opexUserMsg },
        ],
        maxTokens: opexMaxTokens,
        jsonMode: true,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("OPEX_AI_TIMEOUT")), AI_TIMEOUT_MS)
      ),
    ]);
  } catch (timeoutOrLlmError) {
    const isTimeout = (timeoutOrLlmError as Error).message === "OPEX_AI_TIMEOUT";
    console.warn(`OpEx AI: ${isTimeout ? `LLM timed out after ${AI_TIMEOUT_MS / 1000}s` : `LLM call failed: ${(timeoutOrLlmError as Error).message}`} — using deterministic fallback`);
    return buildDeterministicFallback(projectType, massBalanceResults, capexResults);
  }

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
      console.warn("OpEx AI: Failed to parse or repair JSON — using deterministic fallback");
      return buildDeterministicFallback(projectType, massBalanceResults, capexResults);
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

function buildDeterministicFallback(
  projectType: string,
  massBalanceResults: MassBalanceResults,
  capexResults: CapexResults | null,
): OpexAIResult {
  const editableAssumptions = getDefaultOpexAssumptions(projectType, massBalanceResults, capexResults);
  const lineItems = calculateAllDeterministicLineItems(editableAssumptions, massBalanceResults, capexResults, projectType);
  const totalProjectCapex = capexResults?.summary?.totalProjectCost || 0;

  const rngMMBtu = extractMBValue(massBalanceResults.summary, "rng", "renewable") || extractMBValue(massBalanceResults.summary, "biomethane", "pipeline gas");
  const annualRngMMBtu = rngMMBtu > 10000 ? rngMMBtu : rngMMBtu * 365;
  const summary = buildOpexSummaryFromLineItems(lineItems, totalProjectCapex, annualRngMMBtu > 0 ? annualRngMMBtu : undefined);

  const displayAssumptions = editableAssumptions.map(a => ({
    parameter: a.parameter,
    value: typeof a.value === "number"
      ? (a.unit.includes("$") || a.unit.includes("/yr") ? `$${a.value.toLocaleString()} ${a.unit}` : `${a.value.toLocaleString()} ${a.unit}`)
      : `${a.value} ${a.unit}`,
    source: a.source,
  }));

  const results: OpexResults = {
    lineItems,
    summary,
    assumptions: displayAssumptions,
    editableAssumptions,
    warnings: [{ field: "general", message: "OpEx estimated using deterministic Burnham defaults (AI was unavailable). All values are editable.", severity: "info" as const }],
    costYear: new Date().getFullYear().toString(),
    currency: "USD",
    methodology: "Deterministic calculation using Burnham OpEx Model defaults",
  };

  console.log(`OpEx Deterministic Fallback: Generated ${lineItems.length} line items, total annual OpEx $${summary.totalAnnualOpex.toLocaleString()}`);

  return {
    results,
    provider: "gpt5" as LLMProvider,
    providerLabel: "Deterministic (Burnham defaults)",
  };
}
