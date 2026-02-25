import type { CapexResults, CapexLineItem, MassBalanceResults } from "@shared/schema";
import {
  interpolateCapexTier,
  getTierLabel,
  DEFAULT_CONSTRUCTION_INDIRECT_RATES,
  DEFAULT_COMMERCIAL_ITEMS,
  DEFAULT_INTERCONNECT,
  DEFAULT_FIELD_TECHNICIANS,
  DEFAULT_BURNHAM_INTERNAL_COSTS,
  type CapexSizeTier,
} from "@shared/capex-pricing-library";

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 8)}`;
}

function extractBiogasScfm(massBalanceResults: MassBalanceResults): number | null {
  if (massBalanceResults.summary) {
    const priorityKeys = [
      "biogasflow", "biogasflowscfm", "biogas_flow", "biogas_flow_scfm",
      "rawbiogasflow", "raw_biogas_flow", "rawbiogas", "raw_biogas",
      "totalbiogas", "total_biogas", "totalbiogasflow", "total_biogas_flow",
    ];

    for (const targetKey of priorityKeys) {
      for (const [key, val] of Object.entries(massBalanceResults.summary)) {
        if (key.toLowerCase().replace(/[^a-z0-9]/g, "") === targetKey.replace(/[^a-z0-9]/g, "")) {
          const num = parseFloat(String(val.value).replace(/,/g, ""));
          if (!isNaN(num) && num > 0) {
            const unit = (val.unit || "").toLowerCase();
            if (unit.includes("scfd")) return num / 1440;
            if (unit.includes("scfh")) return num / 60;
            return num;
          }
        }
      }
    }

    for (const [key, val] of Object.entries(massBalanceResults.summary)) {
      const k = key.toLowerCase();
      if (k.includes("biogas") && (k.includes("flow") || k.includes("scfm") || k.includes("production"))) {
        const num = parseFloat(String(val.value).replace(/,/g, ""));
        if (!isNaN(num) && num > 0) {
          const unit = (val.unit || "").toLowerCase();
          if (unit.includes("scfd")) return num / 1440;
          if (unit.includes("scfh")) return num / 60;
          return num;
        }
      }
    }

    for (const [key, val] of Object.entries(massBalanceResults.summary)) {
      const unit = (val.unit || "").toLowerCase();
      if (unit.includes("scfm") && key.toLowerCase().includes("gas")) {
        const num = parseFloat(String(val.value).replace(/,/g, ""));
        if (!isNaN(num) && num > 0) return num;
      }
    }
  }

  if (massBalanceResults.adStages && massBalanceResults.adStages.length > 0) {
    for (const stage of massBalanceResults.adStages) {
      if (stage.outputStream) {
        for (const [key, val] of Object.entries(stage.outputStream)) {
          const k = key.toLowerCase();
          if (k.includes("biogas") && (k.includes("flow") || k.includes("scfm"))) {
            const num = val.value;
            if (typeof num === "number" && num > 0) {
              const unit = (val.unit || "").toLowerCase();
              if (unit.includes("scfd")) return num / 1440;
              return num;
            }
          }
        }
      }
    }
  }

  return null;
}

function normalizeProjectType(projectType: string): string {
  const pt = projectType.toLowerCase().trim();
  if (pt.includes("type a") || pt.includes("wastewater") || pt === "a") return "a";
  if (pt.includes("type b") || pt.includes("greenfield") || pt === "b") return "b";
  if (pt.includes("type c") || pt.includes("bolt-on") || pt.includes("bolt on") || pt === "c") return "c";
  if (pt.includes("type d") || pt.includes("hybrid") || pt === "d") return "d";
  return "a";
}

export interface DeterministicCapexOptions {
  interconnectFacility?: number;
  lateralMiles?: number;
  lateralCostPerMile?: number;
  escalationPct?: number;
  contingencyPct?: number;
  stateForSalesTax?: string;
  upstreamEquipmentLineItems?: CapexLineItem[];
}

export interface DeterministicCapexResult {
  results: CapexResults;
  provider: string;
  providerLabel: string;
}

export function generateCapexDeterministic(
  massBalanceResults: MassBalanceResults,
  projectType: string,
  options: DeterministicCapexOptions = {},
): DeterministicCapexResult {
  const normalized = normalizeProjectType(projectType);
  if (normalized === "a") {
    throw new Error("Deterministic CapEx calculator is only available for RNG project types (B, C, D). Type A requires AI estimation.");
  }

  const biogasScfm = extractBiogasScfm(massBalanceResults);
  if (!biogasScfm) {
    throw new Error("Cannot determine biogas flow rate from mass balance results. Required for deterministic CapEx calculation.");
  }

  if (biogasScfm > 1200) {
    throw new Error(`Biogas flow ${biogasScfm} SCFM exceeds maximum Prodeval capacity (1,200 SCFM). AI estimation required for custom solutions.`);
  }

  const tier = interpolateCapexTier(biogasScfm);
  const tierLabel = getTierLabel(biogasScfm);
  const costBasis = `Burnham CapEx Model V5.1, Feb 2026 pricing, ${tierLabel}`;

  const lineItems: CapexLineItem[] = [];

  lineItems.push({
    id: makeId("guu"),
    equipmentId: "",
    process: "Major Equipment",
    equipmentType: "Prodeval Gas Upgrading Unit (GUU)",
    description: `Prodeval VALOGAZ/VALOPACK/VALOPUR integrated gas upgrading system — ${tierLabel}`,
    quantity: 1,
    baseCostPerUnit: tier.majorEquipment.guu,
    installationFactor: 1.0,
    installedCost: tier.majorEquipment.guu,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: tier.majorEquipment.guu,
    costBasis,
    source: "Prodeval firm pricing",
    notes: "Firm Prodeval pricing — includes condenser, blower, AC filter, membrane, compressors",
    isOverridden: false,
    isLocked: true,
  });

  lineItems.push({
    id: makeId("flare"),
    equipmentId: "",
    process: "Major Equipment",
    equipmentType: "Enclosed Ground Flare",
    description: "Enclosed ground flare for tail gas / emergency combustion",
    quantity: 1,
    baseCostPerUnit: tier.majorEquipment.flare,
    installationFactor: 1.0,
    installedCost: tier.majorEquipment.flare,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: tier.majorEquipment.flare,
    costBasis,
    source: "Burnham estimate",
    notes: "Burnham-supplied flare",
    isOverridden: false,
    isLocked: false,
  });

  lineItems.push({
    id: makeId("compressor"),
    equipmentId: "",
    process: "Major Equipment",
    equipmentType: "Product Gas Compressor",
    description: "Product gas compressor for pipeline injection",
    quantity: 1,
    baseCostPerUnit: tier.majorEquipment.compressor,
    installationFactor: 1.0,
    installedCost: tier.majorEquipment.compressor,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: tier.majorEquipment.compressor,
    costBasis,
    source: "Burnham estimate",
    notes: "Burnham-supplied compressor",
    isOverridden: false,
    isLocked: false,
  });

  const upstreamItems = options.upstreamEquipmentLineItems || [];
  if (upstreamItems.length > 0) {
    for (const item of upstreamItems) {
      lineItems.push(item);
    }
  }

  const subtotalUpstreamEquipment = upstreamItems.reduce((sum, i) => sum + i.totalCost, 0);
  const subtotalEquipment = tier.majorEquipment.guu + tier.majorEquipment.flare + tier.majorEquipment.compressor + subtotalUpstreamEquipment;

  const engineeringTotal = tier.engineering.bopDesign + tier.engineering.bopConstructionAdmin +
    tier.engineering.thirdPartyTesting + tier.engineering.asBuilts;
  lineItems.push({
    id: makeId("engineering"),
    equipmentId: "",
    process: "Construction Directs",
    equipmentType: "Engineering",
    description: "BOP Design, Construction Admin, 3rd Party Testing, As-Builts",
    quantity: 1,
    baseCostPerUnit: engineeringTotal,
    installationFactor: 1.0,
    installedCost: engineeringTotal,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: engineeringTotal,
    costBasis,
    source: "AEI/ARCO/Purpose quotes",
    notes: `Design: $${tier.engineering.bopDesign.toLocaleString()}, Const Admin: $${tier.engineering.bopConstructionAdmin.toLocaleString()}, Testing: $${tier.engineering.thirdPartyTesting.toLocaleString()}, As-Builts: $${tier.engineering.asBuilts.toLocaleString()}`,
    isOverridden: false,
    isLocked: false,
  });

  const civStructTotal = tier.civilStructural.earthworks + tier.civilStructural.concrete +
    tier.civilStructural.processStructural;
  lineItems.push({
    id: makeId("civstruct"),
    equipmentId: "",
    process: "Construction Directs",
    equipmentType: "Civil / Structural",
    description: "Earthworks, concrete foundations/pads, process structural",
    quantity: 1,
    baseCostPerUnit: civStructTotal,
    installationFactor: 1.0,
    installedCost: civStructTotal,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: civStructTotal,
    costBasis,
    source: "ARCO GMP / RS Means",
    notes: `Earthworks: $${tier.civilStructural.earthworks.toLocaleString()}, Concrete: $${tier.civilStructural.concrete.toLocaleString()}, Process Structural: $${tier.civilStructural.processStructural.toLocaleString()}`,
    isOverridden: false,
    isLocked: false,
  });

  const pipingTotal = tier.processPiping.pipingBase + tier.processPiping.settingEquipment;
  lineItems.push({
    id: makeId("piping"),
    equipmentId: "",
    process: "Construction Directs",
    equipmentType: "Process Piping / Mechanical",
    description: "Process piping, mechanical, and equipment setting",
    quantity: 1,
    baseCostPerUnit: pipingTotal,
    installationFactor: 1.0,
    installedCost: pipingTotal,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: pipingTotal,
    costBasis,
    source: "ARCO GMP",
    notes: `Piping: $${tier.processPiping.pipingBase.toLocaleString()}, Setting Equipment: $${tier.processPiping.settingEquipment.toLocaleString()}`,
    isOverridden: false,
    isLocked: false,
  });

  lineItems.push({
    id: makeId("electrical"),
    equipmentId: "",
    process: "Construction Directs",
    equipmentType: "Process Electrical",
    description: "Electrical ductbank, distribution, cables, conduit, terminations, grounding",
    quantity: 1,
    baseCostPerUnit: tier.electrical,
    installationFactor: 1.0,
    installedCost: tier.electrical,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: tier.electrical,
    costBasis,
    source: "Detailed takeoff",
    notes: "Switchgear, breakers, transformers, cables, conduit, grounding",
    isOverridden: false,
    isLocked: false,
  });

  const icTotal = tier.instrumentationControls +
    DEFAULT_FIELD_TECHNICIANS.prodevalTechHours * DEFAULT_FIELD_TECHNICIANS.hourlyRate +
    DEFAULT_FIELD_TECHNICIANS.otherVendorTechHours * DEFAULT_FIELD_TECHNICIANS.hourlyRate;
  lineItems.push({
    id: makeId("ic"),
    equipmentId: "",
    process: "Construction Directs",
    equipmentType: "Instrumentation / Controls / Automation",
    description: "BOP controls (IT/OT hardware, PLC, SCADA), field technicians",
    quantity: 1,
    baseCostPerUnit: icTotal,
    installationFactor: 1.0,
    installedCost: icTotal,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: icTotal,
    costBasis,
    source: "Burnham / vendor quotes",
    notes: `Controls: $${tier.instrumentationControls.toLocaleString()}, Field technicians: $${(DEFAULT_FIELD_TECHNICIANS.prodevalTechHours * DEFAULT_FIELD_TECHNICIANS.hourlyRate + DEFAULT_FIELD_TECHNICIANS.otherVendorTechHours * DEFAULT_FIELD_TECHNICIANS.hourlyRate).toLocaleString()}`,
    isOverridden: false,
    isLocked: false,
  });

  const nonProcessTotal = tier.nonProcess.siteInfrastructure + tier.nonProcess.siteUtilities +
    tier.nonProcess.siteElectrical;
  lineItems.push({
    id: makeId("nonprocess"),
    equipmentId: "",
    process: "Construction Directs",
    equipmentType: "Non-Process Infrastructure",
    description: "Site infrastructure, site utilities, site electrical",
    quantity: 1,
    baseCostPerUnit: nonProcessTotal,
    installationFactor: 1.0,
    installedCost: nonProcessTotal,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: nonProcessTotal,
    costBasis,
    source: "ARCO / RS Means",
    notes: `Infrastructure: $${tier.nonProcess.siteInfrastructure.toLocaleString()}, Utilities: $${tier.nonProcess.siteUtilities.toLocaleString()}, Electrical: $${tier.nonProcess.siteElectrical.toLocaleString()}`,
    isOverridden: false,
    isLocked: false,
  });

  const subtotalConstructionDirects = engineeringTotal + civStructTotal + pipingTotal +
    tier.electrical + icTotal + nonProcessTotal;

  const generalRequirements = Math.round(subtotalConstructionDirects * 0.1595);
  lineItems.push({
    id: makeId("genreq"),
    equipmentId: "",
    process: "Construction Directs",
    equipmentType: "General Requirements",
    description: "General requirements for construction",
    quantity: 1,
    baseCostPerUnit: generalRequirements,
    installationFactor: 1.0,
    installedCost: generalRequirements,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: generalRequirements,
    costBasis,
    source: "Calculated (15.95% of construction directs)",
    notes: "",
    isOverridden: false,
    isLocked: false,
  });

  const totalConstructionDirects = subtotalConstructionDirects + generalRequirements;

  const rates = DEFAULT_CONSTRUCTION_INDIRECT_RATES;
  const generalConditions = Math.round(totalConstructionDirects * rates.generalConditionsPct / 100);
  const buildingPermits = Math.round(totalConstructionDirects * rates.buildingPermitsPct / 100);
  const insuranceGA = Math.round(totalConstructionDirects * rates.insuranceGAPct / 100);
  const epcProfit = Math.round(totalConstructionDirects * rates.epcProfitPct / 100);
  const subtotalConstMgmt = generalConditions + buildingPermits + insuranceGA + epcProfit;

  lineItems.push({
    id: makeId("constmgmt"),
    equipmentId: "",
    process: "Construction Mgmt & Indirects",
    equipmentType: "Construction Management & Indirects",
    description: "General conditions, building permits, insurance/G&A, EPC profit",
    quantity: 1,
    baseCostPerUnit: subtotalConstMgmt,
    installationFactor: 1.0,
    installedCost: subtotalConstMgmt,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: subtotalConstMgmt,
    costBasis,
    source: "Calculated from construction directs",
    notes: `Gen Conditions (${rates.generalConditionsPct}%): $${generalConditions.toLocaleString()}, Permits (${rates.buildingPermitsPct}%): $${buildingPermits.toLocaleString()}, Insurance (${rates.insuranceGAPct}%): $${insuranceGA.toLocaleString()}, EPC Profit (${rates.epcProfitPct}%): $${epcProfit.toLocaleString()}`,
    isOverridden: false,
    isLocked: false,
  });

  const interconnectFacility = options.interconnectFacility ?? DEFAULT_INTERCONNECT.interconnectFacilityBase;
  const lateralMiles = options.lateralMiles ?? DEFAULT_INTERCONNECT.defaultLateralMiles;
  const lateralCostPerMile = options.lateralCostPerMile ?? DEFAULT_INTERCONNECT.lateralCostPerMile;
  const lateralCost = Math.round(lateralMiles * lateralCostPerMile);
  const subtotalInterconnect = interconnectFacility + lateralCost;

  lineItems.push({
    id: makeId("interconnect"),
    equipmentId: "",
    process: "Interconnect",
    equipmentType: "Pipeline Interconnect",
    description: `Interconnect facility + ${lateralMiles} mile(s) lateral`,
    quantity: 1,
    baseCostPerUnit: subtotalInterconnect,
    installationFactor: 1.0,
    installedCost: subtotalInterconnect,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: subtotalInterconnect,
    costBasis,
    source: "Pipeline utility quotes / estimates",
    notes: `Interconnect facility: $${interconnectFacility.toLocaleString()}, Lateral (${lateralMiles} mi @ $${lateralCostPerMile.toLocaleString()}/mi): $${lateralCost.toLocaleString()}`,
    isOverridden: false,
    isLocked: false,
  });

  const totalEPC = subtotalEquipment + totalConstructionDirects + subtotalConstMgmt + subtotalInterconnect;

  const comm = DEFAULT_COMMERCIAL_ITEMS;
  const ic = DEFAULT_BURNHAM_INTERNAL_COSTS;
  const escalationPct = options.escalationPct ?? comm.escalationPct;
  const contingencyPct = options.contingencyPct ?? comm.contingencyPctOfEpc;

  const pm = ic.projectManagement;
  const pmTotal = pm.capitalTeamSitePersonnel + pm.rduDcMgmtExpenses +
    pm.tempConstructionFacilities + pm.thirdPartyEngineeringSupport +
    pm.constructionPpeFirstAid + pm.legalSupport;

  lineItems.push({
    id: makeId("projmgmt"),
    equipmentId: "",
    process: "Burnham Internal Costs",
    equipmentType: "Project Management",
    description: "Capital team site personnel, RDU/DC management, temp facilities, 3rd party engineering, PPE, legal",
    quantity: 1,
    baseCostPerUnit: pmTotal,
    installationFactor: 1.0,
    installedCost: pmTotal,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: pmTotal,
    costBasis,
    source: "Burnham Internal Costs Estimate",
    notes: `Site Personnel: $${pm.capitalTeamSitePersonnel.toLocaleString()}, RDU/DC Mgmt: $${pm.rduDcMgmtExpenses.toLocaleString()}, Temp Facilities: $${pm.tempConstructionFacilities.toLocaleString()}, 3rd Party Eng: $${pm.thirdPartyEngineeringSupport.toLocaleString()}, PPE: $${pm.constructionPpeFirstAid.toLocaleString()}, Legal: $${pm.legalSupport.toLocaleString()}`,
    isOverridden: false,
    isLocked: false,
  });

  const ops = ic.operationsDuringConstruction;
  const opsTotal = ops.operationsStaffPreCod + ops.operationalAdjustments +
    ops.operationsHandtools + ops.gasSamplingForQuality;

  lineItems.push({
    id: makeId("opsconst"),
    equipmentId: "",
    process: "Burnham Internal Costs",
    equipmentType: "Operations During Construction",
    description: "Operations staff pre-COD, operational adjustments, handtools, gas sampling",
    quantity: 1,
    baseCostPerUnit: opsTotal,
    installationFactor: 1.0,
    installedCost: opsTotal,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: opsTotal,
    costBasis,
    source: "Burnham Internal Costs Estimate",
    notes: `Ops Staff pre-COD: $${ops.operationsStaffPreCod.toLocaleString()}, Adjustments: $${ops.operationalAdjustments.toLocaleString()}, Handtools: $${ops.operationsHandtools.toLocaleString()}, Gas Sampling: $${ops.gasSamplingForQuality.toLocaleString()}`,
    isOverridden: false,
    isLocked: false,
  });

  const buildersRisk = Math.round(totalEPC * ic.insurance.buildersRiskPolicyPctOfEpc / 100);

  lineItems.push({
    id: makeId("insurance"),
    equipmentId: "",
    process: "Burnham Internal Costs",
    equipmentType: "Builder's Risk Insurance",
    description: `Builder's Risk Policy (${ic.insurance.buildersRiskPolicyPctOfEpc}% of EPC)`,
    quantity: 1,
    baseCostPerUnit: buildersRisk,
    installationFactor: 1.0,
    installedCost: buildersRisk,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: buildersRisk,
    costBasis,
    source: "Burnham Internal Costs Estimate",
    notes: `${ic.insurance.buildersRiskPolicyPctOfEpc}% of EPC ($${totalEPC.toLocaleString()})`,
    isOverridden: false,
    isLocked: false,
  });

  const ffTotal = ic.fixturesAndFurnishings.permanentOfficeFurnishings;

  lineItems.push({
    id: makeId("fixtures"),
    equipmentId: "",
    process: "Burnham Internal Costs",
    equipmentType: "Fixtures & Furnishings",
    description: "Permanent office furnishings",
    quantity: 1,
    baseCostPerUnit: ffTotal,
    installationFactor: 1.0,
    installedCost: ffTotal,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: ffTotal,
    costBasis,
    source: "Burnham Internal Costs Estimate",
    notes: "",
    isOverridden: false,
    isLocked: false,
  });

  const spareParts = Math.round(subtotalEquipment * ic.sparePartsPctOfEquipment / 100);

  const util = ic.utilities;
  const utilTotal = util.tempPower + util.permanentPower + util.natGas +
    util.water + util.sewer + util.it + util.utilitiesDuringConstruction;

  lineItems.push({
    id: makeId("utilities"),
    equipmentId: "",
    process: "Burnham Internal Costs",
    equipmentType: "Utilities",
    description: "Temporary power, permanent power, IT, utilities during construction",
    quantity: 1,
    baseCostPerUnit: utilTotal,
    installationFactor: 1.0,
    installedCost: utilTotal,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: utilTotal,
    costBasis,
    source: "Burnham Internal Costs Estimate",
    notes: `Temp Power: $${util.tempPower.toLocaleString()}, Permanent: $${util.permanentPower.toLocaleString()}, IT: $${util.it.toLocaleString()}, During Construction: $${util.utilitiesDuringConstruction.toLocaleString()}`,
    isOverridden: false,
    isLocked: false,
  });

  lineItems.push({
    id: makeId("ribbon"),
    equipmentId: "",
    process: "Burnham Internal Costs",
    equipmentType: "Ribbon Cutting",
    description: "Project ribbon cutting ceremony",
    quantity: 1,
    baseCostPerUnit: ic.ribbonCutting,
    installationFactor: 1.0,
    installedCost: ic.ribbonCutting,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: ic.ribbonCutting,
    costBasis,
    source: "Burnham Internal Costs Estimate",
    notes: "",
    isOverridden: false,
    isLocked: false,
  });

  const subtotalInternalCosts = pmTotal + opsTotal + buildersRisk + ffTotal +
    utilTotal + ic.ribbonCutting;

  const devCosts = comm.devCosts;
  const devFee = Math.round(totalEPC * comm.devFeePctOfEpc / 100);
  const contingency = Math.round(totalEPC * contingencyPct / 100);
  const insuranceOnDirectCosts = Math.round(totalEPC * 1.5 / 100);
  const escalationBase = subtotalEquipment + totalConstructionDirects;
  const escalation = Math.round(escalationBase * escalationPct / 100);

  lineItems.push({
    id: makeId("contingency"),
    equipmentId: "",
    process: "Commercial / Owner's Costs",
    equipmentType: "Contingency",
    description: `Contingency (${contingencyPct}% of EPC)`,
    quantity: 1,
    baseCostPerUnit: contingency,
    installationFactor: 1.0,
    installedCost: contingency,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: contingency,
    costBasis,
    source: "Burnham standard",
    notes: `${contingencyPct}% of EPC ($${totalEPC.toLocaleString()})`,
    isOverridden: false,
    isLocked: false,
  });

  lineItems.push({
    id: makeId("devcosts"),
    equipmentId: "",
    process: "Commercial / Owner's Costs",
    equipmentType: "Development Costs",
    description: "Project development costs",
    quantity: 1,
    baseCostPerUnit: devCosts,
    installationFactor: 1.0,
    installedCost: devCosts,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: devCosts,
    costBasis,
    source: "Burnham standard",
    notes: "",
    isOverridden: false,
    isLocked: false,
  });

  lineItems.push({
    id: makeId("sparepartscomm"),
    equipmentId: "",
    process: "Commercial / Owner's Costs",
    equipmentType: "Spare Parts",
    description: `Spare parts (${ic.sparePartsPctOfEquipment}% of total equipment costs)`,
    quantity: 1,
    baseCostPerUnit: spareParts,
    installationFactor: 1.0,
    installedCost: spareParts,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: spareParts,
    costBasis,
    source: "Burnham standard",
    notes: `${ic.sparePartsPctOfEquipment}% of total equipment costs ($${subtotalEquipment.toLocaleString()})`,
    isOverridden: false,
    isLocked: false,
  });

  lineItems.push({
    id: makeId("insurancedc"),
    equipmentId: "",
    process: "Commercial / Owner's Costs",
    equipmentType: "Insurance",
    description: "Insurance (1.5% of direct costs)",
    quantity: 1,
    baseCostPerUnit: insuranceOnDirectCosts,
    installationFactor: 1.0,
    installedCost: insuranceOnDirectCosts,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: insuranceOnDirectCosts,
    costBasis,
    source: "Burnham standard",
    notes: `1.5% of direct costs ($${totalEPC.toLocaleString()})`,
    isOverridden: false,
    isLocked: false,
  });

  if (comm.utilityConnectionFee > 0) {
    lineItems.push({
      id: makeId("utilconn"),
      equipmentId: "",
      process: "Commercial / Owner's Costs",
      equipmentType: "Utility Connection Fee",
      description: "Utility connection fee",
      quantity: 1,
      baseCostPerUnit: comm.utilityConnectionFee,
      installationFactor: 1.0,
      installedCost: comm.utilityConnectionFee,
      contingencyPct: 0,
      contingencyCost: 0,
      totalCost: comm.utilityConnectionFee,
      costBasis,
      source: "Burnham standard",
      notes: "",
      isOverridden: false,
      isLocked: false,
    });
  }

  lineItems.push({
    id: makeId("escalation"),
    equipmentId: "",
    process: "Commercial / Owner's Costs",
    equipmentType: "CPI Escalation",
    description: `CPI-based cost escalation (${escalationPct}% of equipment + construction directs)`,
    quantity: 1,
    baseCostPerUnit: escalation,
    installationFactor: 1.0,
    installedCost: escalation,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: escalation,
    costBasis,
    source: "BLS CPI data",
    notes: `${escalationPct}% escalation applied to equipment ($${subtotalEquipment.toLocaleString()}) + construction directs ($${totalConstructionDirects.toLocaleString()})`,
    isOverridden: false,
    isLocked: false,
  });

  const engineeringPct = 7;
  const engineeringCost = Math.round(totalEPC * engineeringPct / 100);

  lineItems.push({
    id: makeId("engineering"),
    equipmentId: "",
    process: "Commercial / Owner's Costs",
    equipmentType: "Engineering",
    description: `Engineering (${engineeringPct}% of EPC)`,
    quantity: 1,
    baseCostPerUnit: engineeringCost,
    installationFactor: 1.0,
    installedCost: engineeringCost,
    contingencyPct: 0,
    contingencyCost: 0,
    totalCost: engineeringCost,
    costBasis,
    source: "Burnham standard",
    notes: `${engineeringPct}% of EPC ($${totalEPC.toLocaleString()})`,
    isOverridden: false,
    isLocked: false,
  });

  const totalCommercial = contingency + devCosts + spareParts + insuranceOnDirectCosts +
    comm.utilityConnectionFee + devFee + escalation + engineeringCost;

  const totalCapex = totalEPC + subtotalInternalCosts + totalCommercial;
  const itcExclusions = comm.utilityConnectionFee + opsTotal + ffTotal +
    ic.ribbonCutting + subtotalInterconnect;
  const itcEligible = totalCapex - itcExclusions;

  const summary = {
    totalEquipmentCost: subtotalEquipment,
    totalInstalledCost: totalEPC,
    totalContingency: contingency,
    totalDirectCost: totalEPC,
    subtotalDirectCosts: totalEPC,
    subtotalInternalCosts,
    contingency,
    devCosts,
    spareParts,
    insurance: insuranceOnDirectCosts,
    escalation,
    engineeringPct,
    engineeringCost,
    totalProjectCost: totalCapex,
    costPerUnit: {
      value: Math.round(totalCapex / (biogasScfm * 60 * 24 * 365 * 0.55 * 0.97 / 1_000_000)),
      unit: "$/MMBTU annual RNG capacity",
      basis: `Based on ${biogasScfm} SCFM biogas, 55% CH₄, 97% recovery`,
    },
  };

  const hasUpstreamAI = upstreamItems.length > 0;
  const assumptions = [
    { parameter: "Biogas Flow Rate", value: `${biogasScfm.toLocaleString()} SCFM`, source: "Mass Balance" },
    { parameter: "GUU Size Tier", value: tierLabel, source: "Prodeval equipment selection" },
    { parameter: "Prodeval GUU Price", value: `$${tier.majorEquipment.guu.toLocaleString()}`, source: "Prodeval firm pricing" },
    ...(hasUpstreamAI ? [
      { parameter: "Upstream Equipment", value: `${upstreamItems.length} items, $${subtotalUpstreamEquipment.toLocaleString()}`, source: "AI estimate (vendor benchmarks)" },
    ] : []),
    { parameter: "Interconnect Facility", value: `$${interconnectFacility.toLocaleString()}`, source: "Default / user input" },
    { parameter: "Lateral Distance", value: `${lateralMiles} miles`, source: "Default / user input" },
    { parameter: "Lateral Cost", value: `$${lateralCostPerMile.toLocaleString()}/mile`, source: "Pipeline utility estimates" },
    { parameter: "Contingency", value: `${contingencyPct}% of EPC`, source: "Burnham standard" },
    { parameter: "CPI Escalation", value: `${escalationPct}%`, source: "BLS CPI data" },
    { parameter: "Builder's Risk Insurance", value: `${ic.insurance.buildersRiskPolicyPctOfEpc}% of EPC`, source: "Burnham Internal Costs Estimate" },
    { parameter: "Internal Costs Subtotal", value: `$${subtotalInternalCosts.toLocaleString()}`, source: "Burnham Internal Costs Estimate" },
    { parameter: "Dev Costs", value: `$${devCosts.toLocaleString()}`, source: "Burnham standard" },
    { parameter: "Spare Parts", value: `${ic.sparePartsPctOfEquipment}% of total equipment costs`, source: "Burnham standard" },
    { parameter: "Insurance", value: `1.5% of direct costs`, source: "Burnham standard" },
    { parameter: "Cost Year", value: "Feb 2026", source: "Burnham CapEx Model V5.1" },
    { parameter: "ITC Eligible CapEx", value: `$${itcEligible.toLocaleString()}`, source: "Calculated" },
    ...(hasUpstreamAI ? [
      { parameter: "Estimation Method", value: "Hybrid: deterministic (GUU/BOP/internals) + AI (upstream equipment)", source: "Burnham CapEx Model V5.1" },
    ] : []),
  ];

  const warnings: Array<{ field: string; message: string; severity: "error" | "warning" | "info" }> = [];

  if (biogasScfm > 400 && biogasScfm < 800) {
    warnings.push({
      field: "biogasFlow",
      message: `Biogas flow (${biogasScfm} SCFM) is between standard tiers. Costs interpolated between 400 and 800 SCFM tiers.`,
      severity: "info",
    });
  } else if (biogasScfm > 800 && biogasScfm < 1200) {
    warnings.push({
      field: "biogasFlow",
      message: `Biogas flow (${biogasScfm} SCFM) is between standard tiers. Costs interpolated between 800 and 1,200 SCFM tiers.`,
      severity: "info",
    });
  }

  if (normalized === "c") {
    warnings.push({
      field: "projectType",
      message: "Type C (Bolt-On): CapEx covers gas upgrading BOP only. Upstream biogas supply infrastructure not included.",
      severity: "info",
    });
  }

  const results: CapexResults = {
    projectType: normalized.toUpperCase(),
    lineItems,
    summary,
    assumptions,
    warnings,
    costYear: "2026",
    currency: "USD",
    methodology: hasUpstreamAI
      ? "Burnham CapEx Model V5.1 — hybrid: deterministic pricing (Prodeval/BOP/internals) + AI estimation (upstream process equipment)"
      : "Burnham CapEx Model V5.1 — deterministic pricing based on firm Prodeval quotes and BOP estimates",
  };

  return {
    results,
    provider: hasUpstreamAI ? "hybrid" : "deterministic",
    providerLabel: hasUpstreamAI
      ? "Hybrid (Burnham V5.1 + AI upstream equipment)"
      : "Deterministic (Burnham CapEx Model V5.1)",
  };
}
