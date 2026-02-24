"""
Burnham CapEx Model V5.1 – Deterministic CapEx estimator for RNG project types (B, C, D).
Direct Python port of server/services/capexDeterministic.ts
"""

import re
import uuid
from typing import Optional

from databricks_app.services.capex_pricing_library import (
    interpolate_capex_tier,
    get_tier_label,
    DEFAULT_CONSTRUCTION_INDIRECT_RATES,
    DEFAULT_COMMERCIAL_ITEMS,
    DEFAULT_INTERCONNECT,
    DEFAULT_FIELD_TECHNICIANS,
    DEFAULT_BURNHAM_INTERNAL_COSTS,
)


def _make_id(prefix: str) -> str:
    return f"{prefix}-{str(uuid.uuid4())[:8]}"


def extract_biogas_scfm(mass_balance_results: dict) -> Optional[float]:
    summary = mass_balance_results.get("summary")
    if summary:
        priority_keys = [
            "biogasflow", "biogasflowscfm", "biogas_flow", "biogas_flow_scfm",
            "rawbiogasflow", "raw_biogas_flow", "rawbiogas", "raw_biogas",
            "totalbiogas", "total_biogas", "totalbiogasflow", "total_biogas_flow",
        ]

        for target_key in priority_keys:
            normalized_target = re.sub(r"[^a-z0-9]", "", target_key)
            for key, val in summary.items():
                normalized_key = re.sub(r"[^a-z0-9]", "", key.lower())
                if normalized_key == normalized_target:
                    try:
                        num = float(str(val.get("value", "")).replace(",", ""))
                    except (ValueError, AttributeError):
                        continue
                    if num > 0:
                        unit = (val.get("unit") or "").lower()
                        if "scfd" in unit:
                            return num / 1440
                        if "scfh" in unit:
                            return num / 60
                        return num

        for key, val in summary.items():
            k = key.lower()
            if "biogas" in k and ("flow" in k or "scfm" in k or "production" in k):
                try:
                    num = float(str(val.get("value", "")).replace(",", ""))
                except (ValueError, AttributeError):
                    continue
                if num > 0:
                    unit = (val.get("unit") or "").lower()
                    if "scfd" in unit:
                        return num / 1440
                    if "scfh" in unit:
                        return num / 60
                    return num

        for key, val in summary.items():
            unit = (val.get("unit") or "").lower()
            if "scfm" in unit and "gas" in key.lower():
                try:
                    num = float(str(val.get("value", "")).replace(",", ""))
                except (ValueError, AttributeError):
                    continue
                if num > 0:
                    return num

    ad_stages = mass_balance_results.get("adStages") or []
    if len(ad_stages) > 0:
        for stage in ad_stages:
            output_stream = stage.get("outputStream")
            if output_stream:
                for key, val in output_stream.items():
                    k = key.lower()
                    if "biogas" in k and ("flow" in k or "scfm" in k):
                        v = val.get("value") if isinstance(val, dict) else None
                        if isinstance(v, (int, float)) and v > 0:
                            unit = (val.get("unit") or "").lower() if isinstance(val, dict) else ""
                            if "scfd" in unit:
                                return v / 1440
                            return v

    return None


def normalize_project_type(project_type: str) -> str:
    pt = project_type.lower().strip()
    if "type a" in pt or "wastewater" in pt or pt == "a":
        return "a"
    if "type b" in pt or "greenfield" in pt or pt == "b":
        return "b"
    if "type c" in pt or "bolt-on" in pt or "bolt on" in pt or pt == "c":
        return "c"
    if "type d" in pt or "hybrid" in pt or pt == "d":
        return "d"
    return "a"


def generate_capex_deterministic(
    mass_balance_results: dict,
    project_type: str,
    options: Optional[dict] = None,
) -> dict:
    if options is None:
        options = {}

    normalized = normalize_project_type(project_type)
    if normalized == "a":
        raise ValueError(
            "Deterministic CapEx calculator is only available for RNG project types (B, C, D). "
            "Type A requires AI estimation."
        )

    biogas_scfm = extract_biogas_scfm(mass_balance_results)
    if not biogas_scfm:
        raise ValueError(
            "Cannot determine biogas flow rate from mass balance results. "
            "Required for deterministic CapEx calculation."
        )

    if biogas_scfm > 1200:
        raise ValueError(
            f"Biogas flow {biogas_scfm} SCFM exceeds maximum Prodeval capacity (1,200 SCFM). "
            "AI estimation required for custom solutions."
        )

    tier = interpolate_capex_tier(biogas_scfm)
    tier_label = get_tier_label(biogas_scfm)
    cost_basis = f"Burnham CapEx Model V5.1, Feb 2026 pricing, {tier_label}"

    line_items = []

    line_items.append({
        "id": _make_id("guu"),
        "equipmentId": "",
        "process": "Major Equipment",
        "equipmentType": "Prodeval Gas Upgrading Unit (GUU)",
        "description": f"Prodeval VALOGAZ/VALOPACK/VALOPUR integrated gas upgrading system — {tier_label}",
        "quantity": 1,
        "baseCostPerUnit": tier["majorEquipment"]["guu"],
        "installationFactor": 1.0,
        "installedCost": tier["majorEquipment"]["guu"],
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": tier["majorEquipment"]["guu"],
        "costBasis": cost_basis,
        "source": "Prodeval firm pricing",
        "notes": "Firm Prodeval pricing — includes condenser, blower, AC filter, membrane, compressors",
        "isOverridden": False,
        "isLocked": True,
    })

    line_items.append({
        "id": _make_id("flare"),
        "equipmentId": "",
        "process": "Major Equipment",
        "equipmentType": "Enclosed Ground Flare",
        "description": "Enclosed ground flare for tail gas / emergency combustion",
        "quantity": 1,
        "baseCostPerUnit": tier["majorEquipment"]["flare"],
        "installationFactor": 1.0,
        "installedCost": tier["majorEquipment"]["flare"],
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": tier["majorEquipment"]["flare"],
        "costBasis": cost_basis,
        "source": "Burnham estimate",
        "notes": "Burnham-supplied flare",
        "isOverridden": False,
        "isLocked": False,
    })

    line_items.append({
        "id": _make_id("compressor"),
        "equipmentId": "",
        "process": "Major Equipment",
        "equipmentType": "Product Gas Compressor",
        "description": "Product gas compressor for pipeline injection",
        "quantity": 1,
        "baseCostPerUnit": tier["majorEquipment"]["compressor"],
        "installationFactor": 1.0,
        "installedCost": tier["majorEquipment"]["compressor"],
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": tier["majorEquipment"]["compressor"],
        "costBasis": cost_basis,
        "source": "Burnham estimate",
        "notes": "Burnham-supplied compressor",
        "isOverridden": False,
        "isLocked": False,
    })

    upstream_items = options.get("upstreamEquipmentLineItems") or []
    for item in upstream_items:
        line_items.append(item)

    subtotal_upstream_equipment = sum(i.get("totalCost", 0) for i in upstream_items)
    subtotal_equipment = (
        tier["majorEquipment"]["guu"]
        + tier["majorEquipment"]["flare"]
        + tier["majorEquipment"]["compressor"]
        + subtotal_upstream_equipment
    )

    engineering_total = (
        tier["engineering"]["bopDesign"]
        + tier["engineering"]["bopConstructionAdmin"]
        + tier["engineering"]["thirdPartyTesting"]
        + tier["engineering"]["asBuilts"]
    )
    line_items.append({
        "id": _make_id("engineering"),
        "equipmentId": "",
        "process": "Construction Directs",
        "equipmentType": "Engineering",
        "description": "BOP Design, Construction Admin, 3rd Party Testing, As-Builts",
        "quantity": 1,
        "baseCostPerUnit": engineering_total,
        "installationFactor": 1.0,
        "installedCost": engineering_total,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": engineering_total,
        "costBasis": cost_basis,
        "source": "AEI/ARCO/Purpose quotes",
        "notes": (
            f"Design: ${tier['engineering']['bopDesign']:,.0f}, "
            f"Const Admin: ${tier['engineering']['bopConstructionAdmin']:,.0f}, "
            f"Testing: ${tier['engineering']['thirdPartyTesting']:,.0f}, "
            f"As-Builts: ${tier['engineering']['asBuilts']:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    civ_struct_total = (
        tier["civilStructural"]["earthworks"]
        + tier["civilStructural"]["concrete"]
        + tier["civilStructural"]["processStructural"]
    )
    line_items.append({
        "id": _make_id("civstruct"),
        "equipmentId": "",
        "process": "Construction Directs",
        "equipmentType": "Civil / Structural",
        "description": "Earthworks, concrete foundations/pads, process structural",
        "quantity": 1,
        "baseCostPerUnit": civ_struct_total,
        "installationFactor": 1.0,
        "installedCost": civ_struct_total,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": civ_struct_total,
        "costBasis": cost_basis,
        "source": "ARCO GMP / RS Means",
        "notes": (
            f"Earthworks: ${tier['civilStructural']['earthworks']:,.0f}, "
            f"Concrete: ${tier['civilStructural']['concrete']:,.0f}, "
            f"Process Structural: ${tier['civilStructural']['processStructural']:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    piping_total = (
        tier["processPiping"]["pipingBase"]
        + tier["processPiping"]["settingEquipment"]
    )
    line_items.append({
        "id": _make_id("piping"),
        "equipmentId": "",
        "process": "Construction Directs",
        "equipmentType": "Process Piping / Mechanical",
        "description": "Process piping, mechanical, and equipment setting",
        "quantity": 1,
        "baseCostPerUnit": piping_total,
        "installationFactor": 1.0,
        "installedCost": piping_total,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": piping_total,
        "costBasis": cost_basis,
        "source": "ARCO GMP",
        "notes": (
            f"Piping: ${tier['processPiping']['pipingBase']:,.0f}, "
            f"Setting Equipment: ${tier['processPiping']['settingEquipment']:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    line_items.append({
        "id": _make_id("electrical"),
        "equipmentId": "",
        "process": "Construction Directs",
        "equipmentType": "Process Electrical",
        "description": "Electrical ductbank, distribution, cables, conduit, terminations, grounding",
        "quantity": 1,
        "baseCostPerUnit": tier["electrical"],
        "installationFactor": 1.0,
        "installedCost": tier["electrical"],
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": tier["electrical"],
        "costBasis": cost_basis,
        "source": "Detailed takeoff",
        "notes": "Switchgear, breakers, transformers, cables, conduit, grounding",
        "isOverridden": False,
        "isLocked": False,
    })

    ft = DEFAULT_FIELD_TECHNICIANS
    field_tech_cost = ft["prodevalTechHours"] * ft["hourlyRate"] + ft["otherVendorTechHours"] * ft["hourlyRate"]
    ic_total = tier["instrumentationControls"] + field_tech_cost
    line_items.append({
        "id": _make_id("ic"),
        "equipmentId": "",
        "process": "Construction Directs",
        "equipmentType": "Instrumentation / Controls / Automation",
        "description": "BOP controls (IT/OT hardware, PLC, SCADA), field technicians",
        "quantity": 1,
        "baseCostPerUnit": ic_total,
        "installationFactor": 1.0,
        "installedCost": ic_total,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": ic_total,
        "costBasis": cost_basis,
        "source": "Burnham / vendor quotes",
        "notes": (
            f"Controls: ${tier['instrumentationControls']:,.0f}, "
            f"Field technicians: ${field_tech_cost:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    non_process_total = (
        tier["nonProcess"]["siteInfrastructure"]
        + tier["nonProcess"]["siteUtilities"]
        + tier["nonProcess"]["siteElectrical"]
    )
    line_items.append({
        "id": _make_id("nonprocess"),
        "equipmentId": "",
        "process": "Construction Directs",
        "equipmentType": "Non-Process Infrastructure",
        "description": "Site infrastructure, site utilities, site electrical",
        "quantity": 1,
        "baseCostPerUnit": non_process_total,
        "installationFactor": 1.0,
        "installedCost": non_process_total,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": non_process_total,
        "costBasis": cost_basis,
        "source": "ARCO / RS Means",
        "notes": (
            f"Infrastructure: ${tier['nonProcess']['siteInfrastructure']:,.0f}, "
            f"Utilities: ${tier['nonProcess']['siteUtilities']:,.0f}, "
            f"Electrical: ${tier['nonProcess']['siteElectrical']:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    subtotal_construction_directs = (
        engineering_total + civ_struct_total + piping_total
        + tier["electrical"] + ic_total + non_process_total
    )

    general_requirements = round(subtotal_construction_directs * 0.1595)
    line_items.append({
        "id": _make_id("genreq"),
        "equipmentId": "",
        "process": "Construction Directs",
        "equipmentType": "General Requirements",
        "description": "General requirements for construction",
        "quantity": 1,
        "baseCostPerUnit": general_requirements,
        "installationFactor": 1.0,
        "installedCost": general_requirements,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": general_requirements,
        "costBasis": cost_basis,
        "source": "Calculated (15.95% of construction directs)",
        "notes": "",
        "isOverridden": False,
        "isLocked": False,
    })

    total_construction_directs = subtotal_construction_directs + general_requirements

    rates = DEFAULT_CONSTRUCTION_INDIRECT_RATES
    general_conditions = round(total_construction_directs * rates["generalConditionsPct"] / 100)
    building_permits = round(total_construction_directs * rates["buildingPermitsPct"] / 100)
    insurance_ga = round(total_construction_directs * rates["insuranceGAPct"] / 100)
    epc_profit = round(total_construction_directs * rates["epcProfitPct"] / 100)
    subtotal_const_mgmt = general_conditions + building_permits + insurance_ga + epc_profit

    line_items.append({
        "id": _make_id("constmgmt"),
        "equipmentId": "",
        "process": "Construction Mgmt & Indirects",
        "equipmentType": "Construction Management & Indirects",
        "description": "General conditions, building permits, insurance/G&A, EPC profit",
        "quantity": 1,
        "baseCostPerUnit": subtotal_const_mgmt,
        "installationFactor": 1.0,
        "installedCost": subtotal_const_mgmt,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": subtotal_const_mgmt,
        "costBasis": cost_basis,
        "source": "Calculated from construction directs",
        "notes": (
            f"Gen Conditions ({rates['generalConditionsPct']}%): ${general_conditions:,.0f}, "
            f"Permits ({rates['buildingPermitsPct']}%): ${building_permits:,.0f}, "
            f"Insurance ({rates['insuranceGAPct']}%): ${insurance_ga:,.0f}, "
            f"EPC Profit ({rates['epcProfitPct']}%): ${epc_profit:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    interconnect_facility = options.get("interconnectFacility", DEFAULT_INTERCONNECT["interconnectFacilityBase"])
    lateral_miles = options.get("lateralMiles", DEFAULT_INTERCONNECT["defaultLateralMiles"])
    lateral_cost_per_mile = options.get("lateralCostPerMile", DEFAULT_INTERCONNECT["lateralCostPerMile"])
    lateral_cost = round(lateral_miles * lateral_cost_per_mile)
    subtotal_interconnect = interconnect_facility + lateral_cost

    line_items.append({
        "id": _make_id("interconnect"),
        "equipmentId": "",
        "process": "Interconnect",
        "equipmentType": "Pipeline Interconnect",
        "description": f"Interconnect facility + {lateral_miles} mile(s) lateral",
        "quantity": 1,
        "baseCostPerUnit": subtotal_interconnect,
        "installationFactor": 1.0,
        "installedCost": subtotal_interconnect,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": subtotal_interconnect,
        "costBasis": cost_basis,
        "source": "Pipeline utility quotes / estimates",
        "notes": (
            f"Interconnect facility: ${interconnect_facility:,.0f}, "
            f"Lateral ({lateral_miles} mi @ ${lateral_cost_per_mile:,.0f}/mi): ${lateral_cost:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    total_epc = subtotal_equipment + total_construction_directs + subtotal_const_mgmt + subtotal_interconnect

    comm = DEFAULT_COMMERCIAL_ITEMS
    ic = DEFAULT_BURNHAM_INTERNAL_COSTS
    escalation_pct = options.get("escalationPct", comm["escalationPct"])
    contingency_pct = options.get("contingencyPct", comm["contingencyPctOfEpc"])

    pm = ic["projectManagement"]
    pm_total = (
        pm["capitalTeamSitePersonnel"]
        + pm["rduDcMgmtExpenses"]
        + pm["tempConstructionFacilities"]
        + pm["thirdPartyEngineeringSupport"]
        + pm["constructionPpeFirstAid"]
        + pm["legalSupport"]
    )

    line_items.append({
        "id": _make_id("projmgmt"),
        "equipmentId": "",
        "process": "Burnham Internal Costs",
        "equipmentType": "Project Management",
        "description": "Capital team site personnel, RDU/DC management, temp facilities, 3rd party engineering, PPE, legal",
        "quantity": 1,
        "baseCostPerUnit": pm_total,
        "installationFactor": 1.0,
        "installedCost": pm_total,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": pm_total,
        "costBasis": cost_basis,
        "source": "Burnham Internal Costs Estimate",
        "notes": (
            f"Site Personnel: ${pm['capitalTeamSitePersonnel']:,.0f}, "
            f"RDU/DC Mgmt: ${pm['rduDcMgmtExpenses']:,.0f}, "
            f"Temp Facilities: ${pm['tempConstructionFacilities']:,.0f}, "
            f"3rd Party Eng: ${pm['thirdPartyEngineeringSupport']:,.0f}, "
            f"PPE: ${pm['constructionPpeFirstAid']:,.0f}, "
            f"Legal: ${pm['legalSupport']:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    ops = ic["operationsDuringConstruction"]
    ops_total = (
        ops["operationsStaffPreCod"]
        + ops["operationalAdjustments"]
        + ops["operationsHandtools"]
        + ops["gasSamplingForQuality"]
    )

    line_items.append({
        "id": _make_id("opsconst"),
        "equipmentId": "",
        "process": "Burnham Internal Costs",
        "equipmentType": "Operations During Construction",
        "description": "Operations staff pre-COD, operational adjustments, handtools, gas sampling",
        "quantity": 1,
        "baseCostPerUnit": ops_total,
        "installationFactor": 1.0,
        "installedCost": ops_total,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": ops_total,
        "costBasis": cost_basis,
        "source": "Burnham Internal Costs Estimate",
        "notes": (
            f"Ops Staff pre-COD: ${ops['operationsStaffPreCod']:,.0f}, "
            f"Adjustments: ${ops['operationalAdjustments']:,.0f}, "
            f"Handtools: ${ops['operationsHandtools']:,.0f}, "
            f"Gas Sampling: ${ops['gasSamplingForQuality']:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    builders_risk = round(total_epc * ic["insurance"]["buildersRiskPolicyPctOfEpc"] / 100)

    line_items.append({
        "id": _make_id("insurance"),
        "equipmentId": "",
        "process": "Burnham Internal Costs",
        "equipmentType": "Builder's Risk Insurance",
        "description": f"Builder's Risk Policy ({ic['insurance']['buildersRiskPolicyPctOfEpc']}% of EPC)",
        "quantity": 1,
        "baseCostPerUnit": builders_risk,
        "installationFactor": 1.0,
        "installedCost": builders_risk,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": builders_risk,
        "costBasis": cost_basis,
        "source": "Burnham Internal Costs Estimate",
        "notes": f"{ic['insurance']['buildersRiskPolicyPctOfEpc']}% of EPC (${total_epc:,.0f})",
        "isOverridden": False,
        "isLocked": False,
    })

    ff_total = ic["fixturesAndFurnishings"]["permanentOfficeFurnishings"]

    line_items.append({
        "id": _make_id("fixtures"),
        "equipmentId": "",
        "process": "Burnham Internal Costs",
        "equipmentType": "Fixtures & Furnishings",
        "description": "Permanent office furnishings",
        "quantity": 1,
        "baseCostPerUnit": ff_total,
        "installationFactor": 1.0,
        "installedCost": ff_total,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": ff_total,
        "costBasis": cost_basis,
        "source": "Burnham Internal Costs Estimate",
        "notes": "",
        "isOverridden": False,
        "isLocked": False,
    })

    line_items.append({
        "id": _make_id("spares"),
        "equipmentId": "",
        "process": "Burnham Internal Costs",
        "equipmentType": "Spare Parts",
        "description": "Spare parts inventory",
        "quantity": 1,
        "baseCostPerUnit": ic["spareParts"],
        "installationFactor": 1.0,
        "installedCost": ic["spareParts"],
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": ic["spareParts"],
        "costBasis": cost_basis,
        "source": "Burnham Internal Costs Estimate",
        "notes": "",
        "isOverridden": False,
        "isLocked": False,
    })

    util = ic["utilities"]
    util_total = (
        util["tempPower"] + util["permanentPower"] + util["natGas"]
        + util["water"] + util["sewer"] + util["it"]
        + util["utilitiesDuringConstruction"]
    )

    line_items.append({
        "id": _make_id("utilities"),
        "equipmentId": "",
        "process": "Burnham Internal Costs",
        "equipmentType": "Utilities",
        "description": "Temporary power, permanent power, IT, utilities during construction",
        "quantity": 1,
        "baseCostPerUnit": util_total,
        "installationFactor": 1.0,
        "installedCost": util_total,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": util_total,
        "costBasis": cost_basis,
        "source": "Burnham Internal Costs Estimate",
        "notes": (
            f"Temp Power: ${util['tempPower']:,.0f}, "
            f"Permanent: ${util['permanentPower']:,.0f}, "
            f"IT: ${util['it']:,.0f}, "
            f"During Construction: ${util['utilitiesDuringConstruction']:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    line_items.append({
        "id": _make_id("ribbon"),
        "equipmentId": "",
        "process": "Burnham Internal Costs",
        "equipmentType": "Ribbon Cutting",
        "description": "Project ribbon cutting ceremony",
        "quantity": 1,
        "baseCostPerUnit": ic["ribbonCutting"],
        "installationFactor": 1.0,
        "installedCost": ic["ribbonCutting"],
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": ic["ribbonCutting"],
        "costBasis": cost_basis,
        "source": "Burnham Internal Costs Estimate",
        "notes": "",
        "isOverridden": False,
        "isLocked": False,
    })

    subtotal_internal_costs = (
        pm_total + ops_total + builders_risk + ff_total
        + ic["spareParts"] + util_total + ic["ribbonCutting"]
    )

    dev_costs = round(total_epc * comm["devCostsPctOfEpc"] / 100)
    dev_fee = round(total_epc * comm["devFeePctOfEpc"] / 100)
    contingency = round(total_epc * contingency_pct / 100)
    escalation_base = subtotal_equipment + total_construction_directs
    escalation = round(escalation_base * escalation_pct / 100)

    total_commercial = comm["utilityConnectionFee"] + dev_costs + dev_fee + contingency

    line_items.append({
        "id": _make_id("commercial"),
        "equipmentId": "",
        "process": "Commercial / Owner's Costs",
        "equipmentType": "Commercial Items",
        "description": "Utility connection, development costs, contingency",
        "quantity": 1,
        "baseCostPerUnit": total_commercial,
        "installationFactor": 1.0,
        "installedCost": total_commercial,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": total_commercial,
        "costBasis": cost_basis,
        "source": "Burnham standard rates",
        "notes": (
            f"Utility: ${comm['utilityConnectionFee']:,.0f}, "
            f"Dev ({comm['devCostsPctOfEpc']}% EPC): ${dev_costs:,.0f}, "
            f"Contingency ({contingency_pct}% EPC): ${contingency:,.0f}"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    line_items.append({
        "id": _make_id("escalation"),
        "equipmentId": "",
        "process": "Commercial / Owner's Costs",
        "equipmentType": "CPI Escalation",
        "description": f"CPI-based cost escalation ({escalation_pct}% of equipment + construction directs)",
        "quantity": 1,
        "baseCostPerUnit": escalation,
        "installationFactor": 1.0,
        "installedCost": escalation,
        "contingencyPct": 0,
        "contingencyCost": 0,
        "totalCost": escalation,
        "costBasis": cost_basis,
        "source": "BLS CPI data",
        "notes": (
            f"{escalation_pct}% escalation applied to equipment (${subtotal_equipment:,.0f}) "
            f"+ construction directs (${total_construction_directs:,.0f})"
        ),
        "isOverridden": False,
        "isLocked": False,
    })

    total_capex = total_epc + subtotal_internal_costs + total_commercial + escalation
    itc_exclusions = (
        comm["utilityConnectionFee"] + ops_total + ff_total
        + ic["spareParts"] + ic["ribbonCutting"] + subtotal_interconnect
    )
    itc_eligible = total_capex - itc_exclusions

    annual_rng_mmbtu = biogas_scfm * 60 * 24 * 365 * 0.55 * 0.97 / 1_000_000
    cost_per_unit_value = round(total_capex / annual_rng_mmbtu) if annual_rng_mmbtu > 0 else 0

    summary = {
        "totalEquipmentCost": subtotal_equipment,
        "totalInstalledCost": total_epc,
        "totalContingency": contingency,
        "totalDirectCost": total_construction_directs,
        "engineeringPct": 0,
        "engineeringCost": 0,
        "totalProjectCost": total_capex,
        "costPerUnit": {
            "value": cost_per_unit_value,
            "unit": "$/MMBTU annual RNG capacity",
            "basis": f"Based on {biogas_scfm} SCFM biogas, 55% CH\u2084, 97% recovery",
        },
    }

    has_upstream_ai = len(upstream_items) > 0
    assumptions = [
        {"parameter": "Biogas Flow Rate", "value": f"{biogas_scfm:,.0f} SCFM", "source": "Mass Balance"},
        {"parameter": "GUU Size Tier", "value": tier_label, "source": "Prodeval equipment selection"},
        {"parameter": "Prodeval GUU Price", "value": f"${tier['majorEquipment']['guu']:,.0f}", "source": "Prodeval firm pricing"},
    ]
    if has_upstream_ai:
        assumptions.append({
            "parameter": "Upstream Equipment",
            "value": f"{len(upstream_items)} items, ${subtotal_upstream_equipment:,.0f}",
            "source": "AI estimate (vendor benchmarks)",
        })
    assumptions.extend([
        {"parameter": "Interconnect Facility", "value": f"${interconnect_facility:,.0f}", "source": "Default / user input"},
        {"parameter": "Lateral Distance", "value": f"{lateral_miles} miles", "source": "Default / user input"},
        {"parameter": "Lateral Cost", "value": f"${lateral_cost_per_mile:,.0f}/mile", "source": "Pipeline utility estimates"},
        {"parameter": "Contingency", "value": f"{contingency_pct}% of EPC", "source": "Burnham standard"},
        {"parameter": "CPI Escalation", "value": f"{escalation_pct}%", "source": "BLS CPI data"},
        {"parameter": "Builder's Risk Insurance", "value": f"{ic['insurance']['buildersRiskPolicyPctOfEpc']}% of EPC", "source": "Burnham Internal Costs Estimate"},
        {"parameter": "Internal Costs Subtotal", "value": f"${subtotal_internal_costs:,.0f}", "source": "Burnham Internal Costs Estimate"},
        {"parameter": "Dev Costs", "value": f"{comm['devCostsPctOfEpc']}% of EPC", "source": "Burnham standard"},
        {"parameter": "Cost Year", "value": "Feb 2026", "source": "Burnham CapEx Model V5.1"},
        {"parameter": "ITC Eligible CapEx", "value": f"${itc_eligible:,.0f}", "source": "Calculated"},
    ])
    if has_upstream_ai:
        assumptions.append({
            "parameter": "Estimation Method",
            "value": "Hybrid: deterministic (GUU/BOP/internals) + AI (upstream equipment)",
            "source": "Burnham CapEx Model V5.1",
        })

    warnings = []

    if 400 < biogas_scfm < 800:
        warnings.append({
            "field": "biogasFlow",
            "message": f"Biogas flow ({biogas_scfm} SCFM) is between standard tiers. Costs interpolated between 400 and 800 SCFM tiers.",
            "severity": "info",
        })
    elif 800 < biogas_scfm < 1200:
        warnings.append({
            "field": "biogasFlow",
            "message": f"Biogas flow ({biogas_scfm} SCFM) is between standard tiers. Costs interpolated between 800 and 1,200 SCFM tiers.",
            "severity": "info",
        })

    if normalized == "c":
        warnings.append({
            "field": "projectType",
            "message": "Type C (Bolt-On): CapEx covers gas upgrading BOP only. Upstream biogas supply infrastructure not included.",
            "severity": "info",
        })

    if has_upstream_ai:
        methodology = "Burnham CapEx Model V5.1 — hybrid: deterministic pricing (Prodeval/BOP/internals) + AI estimation (upstream process equipment)"
    else:
        methodology = "Burnham CapEx Model V5.1 — deterministic pricing based on firm Prodeval quotes and BOP estimates"

    results = {
        "projectType": normalized.upper(),
        "lineItems": line_items,
        "summary": summary,
        "assumptions": assumptions,
        "warnings": warnings,
        "costYear": "2026",
        "currency": "USD",
        "methodology": methodology,
    }

    return {
        "results": results,
        "provider": "hybrid" if has_upstream_ai else "deterministic",
        "providerLabel": (
            "Hybrid (Burnham V5.1 + AI upstream equipment)"
            if has_upstream_ai
            else "Deterministic (Burnham CapEx Model V5.1)"
        ),
    }
