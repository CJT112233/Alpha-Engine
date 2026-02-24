import re
import math


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


def get_default_opex_assumptions(
    project_type: str,
    mass_balance_results: dict = None,
    capex_results: dict = None,
) -> list[dict]:
    pt = normalize_project_type(project_type)
    is_ww = pt == "a"

    maintenance_rate = 3 if is_ww else 4
    electricity_rate = 0.08
    load_factor = 75
    operating_hours_per_year = 8760
    insurance_rate = 0.5

    assumptions: list[dict] = [
        {"key": "maintenance_rate", "parameter": "Maintenance Rate", "value": maintenance_rate, "unit": "% of equipment CapEx", "source": "WEF MOP 8 / Industry benchmark", "category": "Maintenance", "description": "Annual maintenance & repair cost as a percentage of total equipment capital cost"},
        {"key": "electricity_rate", "parameter": "Electricity Rate", "value": electricity_rate, "unit": "$/kWh", "source": "EIA national average", "category": "Energy", "description": "Average electricity cost per kilowatt-hour"},
        {"key": "load_factor", "parameter": "Equipment Load Factor", "value": load_factor, "unit": "%", "source": "Engineering estimate", "category": "Energy", "description": "Average equipment utilization as a fraction of installed capacity"},
        {"key": "operating_hours", "parameter": "Operating Hours per Year", "value": operating_hours_per_year, "unit": "hr/yr", "source": "Continuous operation", "category": "Energy", "description": "Total operating hours per year (8,760 = 24/7)"},
        {"key": "insurance_rate", "parameter": "Insurance Rate", "value": insurance_rate, "unit": "% of total project cost", "source": "Industry benchmark", "category": "Other", "description": "Annual property & liability insurance as percentage of total project cost"},
    ]

    if is_ww:
        assumptions.extend([
            {"key": "operator_count", "parameter": "Number of Operators", "value": 4, "unit": "FTEs", "source": "WEF staffing guidelines", "category": "Labor", "description": "Full-time equivalent operators for plant operation"},
            {"key": "operator_salary", "parameter": "Operator Salary", "value": 65000, "unit": "$/yr per FTE", "source": "BLS median wastewater operator", "category": "Labor", "description": "Average annual salary per operator including benefits loading"},
            {"key": "management_count", "parameter": "Management Staff", "value": 1, "unit": "FTEs", "source": "Typical for plant size", "category": "Labor", "description": "Plant manager / superintendent"},
            {"key": "management_salary", "parameter": "Management Salary", "value": 95000, "unit": "$/yr per FTE", "source": "BLS data", "category": "Labor", "description": "Annual salary for management staff"},
            {"key": "benefits_loading", "parameter": "Benefits Loading Factor", "value": 35, "unit": "%", "source": "Industry standard", "category": "Labor", "description": "Fringe benefits as percentage of base salary (health insurance, retirement, etc.)"},
            {"key": "chemical_cost_per_mg", "parameter": "Chemical Cost", "value": 200, "unit": "$/MG treated", "source": "EPA CWNS benchmark", "category": "Chemical", "description": "Average chemical costs per million gallons treated"},
            {"key": "sludge_disposal_cost", "parameter": "Sludge Disposal Cost", "value": 60, "unit": "$/wet ton", "source": "Regional average", "category": "Disposal", "description": "Cost to haul and dispose of dewatered biosolids"},
            {"key": "lab_testing_annual", "parameter": "Lab & Testing", "value": 25000, "unit": "$/yr", "source": "Regulatory compliance estimate", "category": "Other", "description": "Annual laboratory analysis and compliance testing costs"},
        ])
    else:
        operator_count = 3 if pt == "b" else 2
        assumptions.extend([
            {"key": "operator_count", "parameter": "Number of Operators", "value": operator_count, "unit": "FTEs", "source": "RNG facility staffing", "category": "Labor", "description": "Full-time equivalent operators for facility operation"},
            {"key": "operator_salary", "parameter": "Operator Salary", "value": 75000, "unit": "$/yr per FTE", "source": "BLS median", "category": "Labor", "description": "Average annual salary per operator"},
            {"key": "management_count", "parameter": "Management Staff", "value": 1, "unit": "FTEs", "source": "Typical for facility size", "category": "Labor", "description": "Site manager"},
            {"key": "management_salary", "parameter": "Management Salary", "value": 100000, "unit": "$/yr per FTE", "source": "Industry benchmark", "category": "Labor", "description": "Annual salary for management staff"},
            {"key": "benefits_loading", "parameter": "Benefits Loading Factor", "value": 35, "unit": "%", "source": "Industry standard", "category": "Labor", "description": "Fringe benefits as percentage of base salary"},
            {"key": "feedstock_receiving_cost", "parameter": "Feedstock Receiving & Handling", "value": 15 if pt == "b" else 5, "unit": "$/ton", "source": "Industry estimate", "category": "Chemical", "description": "Cost for feedstock receiving, screening, and preprocessing"},
            {"key": "digestate_disposal_cost", "parameter": "Digestate Disposal Cost", "value": 20, "unit": "$/wet ton", "source": "Regional average", "category": "Disposal", "description": "Cost to haul and land-apply or dispose of digestate"},
            {"key": "membrane_replacement", "parameter": "Membrane/Media Replacement", "value": 50000 if pt == "b" else 35000, "unit": "$/yr", "source": "Prodeval maintenance schedule", "category": "Maintenance", "description": "Annual membrane and media replacement for gas upgrading system"},
            {"key": "lab_testing_annual", "parameter": "Lab & Testing", "value": 15000, "unit": "$/yr", "source": "Regulatory compliance estimate", "category": "Other", "description": "Annual gas quality testing and environmental monitoring"},
            {"key": "interconnect_fees", "parameter": "Pipeline Interconnect Fees", "value": 12000, "unit": "$/yr", "source": "Utility estimate", "category": "Other", "description": "Annual gas pipeline interconnection and metering fees"},
        ])

    return assumptions


def _format_number(n) -> str:
    return f"{n:,}"


def calculate_all_deterministic_line_items(
    assumptions: list[dict],
    mass_balance_results: dict,
    capex_results: dict | None,
    project_type: str,
) -> list[dict]:
    line_items: list[dict] = []
    pt = normalize_project_type(project_type)
    id_counter = [0]

    def make_id() -> str:
        id_counter[0] += 1
        return f"opex-det-{id_counter[0]}"

    def get_val(key: str) -> float:
        for a in assumptions:
            if a.get("key") == key:
                return float(a.get("value", 0))
        return 0.0

    capex_summary = (capex_results or {}).get("summary", {}) or {}
    total_equipment_cost = capex_summary.get("totalEquipmentCost", 0) or 0
    total_project_cost = capex_summary.get("totalProjectCost", 0) or 0

    maintenance_rate = get_val("maintenance_rate") / 100
    if total_equipment_cost > 0 and maintenance_rate > 0:
        maintenance_cost = round(total_equipment_cost * maintenance_rate)
        line_items.append({
            "id": make_id(),
            "category": "Maintenance",
            "description": f"Annual maintenance & repairs ({maintenance_rate * 100:.1f}% of equipment CapEx ${_format_number(total_equipment_cost)})",
            "annualCost": maintenance_cost,
            "unitCost": None,
            "unitBasis": None,
            "scalingBasis": f"${_format_number(total_equipment_cost)} equipment cost",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: {maintenance_rate * 100:.1f}% \u00d7 ${_format_number(total_equipment_cost)}",
            "source": "WEF MOP 8 / industry benchmark",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    membrane_replacement = get_val("membrane_replacement")
    if membrane_replacement > 0:
        line_items.append({
            "id": make_id(),
            "category": "Maintenance",
            "description": "Membrane & media replacement (gas upgrading system)",
            "annualCost": round(membrane_replacement),
            "unitCost": None,
            "unitBasis": None,
            "scalingBasis": "Per Prodeval maintenance schedule",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: ${_format_number(membrane_replacement)}/yr",
            "source": "Prodeval maintenance schedule",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    power_keys = ["power", "motor", "hp", "installed power", "rated power", "brake horsepower"]
    total_kw = 0.0
    equipment_list = mass_balance_results.get("equipment") or []
    for eq in equipment_list:
        specs = eq.get("specs")
        if not specs:
            continue
        best_kw = 0.0
        for key, spec in specs.items():
            key_lower = key.lower()
            if not any(pk in key_lower for pk in power_keys):
                continue
            raw_val = str(spec.get("value", "")).replace(",", "")
            try:
                num_val = float(raw_val)
            except (ValueError, TypeError):
                continue
            if num_val <= 0:
                continue
            unit_lower = (spec.get("unit") or "").lower()
            kw = 0.0
            if "hp" in unit_lower or "horsepower" in unit_lower:
                kw = num_val * 0.7457
            elif "mw" in unit_lower:
                kw = num_val * 1000
            elif "kw" in unit_lower:
                kw = num_val
            elif "w" in unit_lower:
                kw = num_val / 1000
            else:
                kw = num_val * 0.7457
            if kw > best_kw:
                best_kw = kw
        total_kw += best_kw * (eq.get("quantity") or 1)

    electricity_rate = get_val("electricity_rate")
    load_factor = get_val("load_factor") / 100
    operating_hours = get_val("operating_hours")
    if total_kw > 0 and electricity_rate > 0:
        annual_energy_cost = round(total_kw * load_factor * operating_hours * electricity_rate)
        line_items.append({
            "id": make_id(),
            "category": "Energy",
            "description": f"Electrical power ({round(total_kw)} kW installed, {load_factor * 100:.0f}% load factor, ${electricity_rate}/kWh)",
            "annualCost": annual_energy_cost,
            "unitCost": electricity_rate,
            "unitBasis": "$/kWh",
            "scalingBasis": f"{round(total_kw)} kW installed capacity",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: {round(total_kw)} kW \u00d7 {load_factor * 100:.0f}% \u00d7 {_format_number(operating_hours)} hr \u00d7 ${electricity_rate}/kWh",
            "source": "Equipment specs + EIA rates",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    operator_count = get_val("operator_count")
    operator_salary = get_val("operator_salary")
    management_count = get_val("management_count")
    management_salary = get_val("management_salary")
    benefits_loading = get_val("benefits_loading") / 100

    if operator_count > 0 and operator_salary > 0:
        total_operator_cost = round(operator_count * operator_salary * (1 + benefits_loading))
        loaded_pct = (1 + benefits_loading) * 100
        line_items.append({
            "id": make_id(),
            "category": "Labor",
            "description": f"Plant operators ({int(operator_count)} FTEs \u00d7 ${_format_number(operator_salary)}/yr \u00d7 {loaded_pct:.0f}% loaded)",
            "annualCost": total_operator_cost,
            "unitCost": operator_salary,
            "unitBasis": "$/yr per FTE",
            "scalingBasis": f"{int(operator_count)} FTEs",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: {int(operator_count)} \u00d7 ${_format_number(operator_salary)} \u00d7 {loaded_pct:.0f}%",
            "source": "BLS / industry staffing",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    if management_count > 0 and management_salary > 0:
        total_mgmt_cost = round(management_count * management_salary * (1 + benefits_loading))
        loaded_pct = (1 + benefits_loading) * 100
        line_items.append({
            "id": make_id(),
            "category": "Labor",
            "description": f"Management staff ({int(management_count)} FTE \u00d7 ${_format_number(management_salary)}/yr \u00d7 {loaded_pct:.0f}% loaded)",
            "annualCost": total_mgmt_cost,
            "unitCost": management_salary,
            "unitBasis": "$/yr per FTE",
            "scalingBasis": f"{int(management_count)} FTEs",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: {int(management_count)} \u00d7 ${_format_number(management_salary)} \u00d7 {loaded_pct:.0f}%",
            "source": "Industry benchmark",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    chemical_cost_per_mg = get_val("chemical_cost_per_mg")
    if chemical_cost_per_mg > 0 and pt == "a":
        summary = mass_balance_results.get("summary") or {}
        design_flow_entry = summary.get("designFlow") or {}
        try:
            flow_mgd = float(str(design_flow_entry.get("value", "1")))
        except (ValueError, TypeError):
            flow_mgd = 1.0
        annual_mg = flow_mgd * 365
        annual_chem_cost = round(chemical_cost_per_mg * annual_mg)
        line_items.append({
            "id": make_id(),
            "category": "Chemical",
            "description": f"Treatment chemicals (${chemical_cost_per_mg}/MG \u00d7 {_format_number(annual_mg)} MG/yr)",
            "annualCost": annual_chem_cost,
            "unitCost": chemical_cost_per_mg,
            "unitBasis": "$/MG",
            "scalingBasis": f"{flow_mgd} MGD \u00d7 365 days",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: ${chemical_cost_per_mg}/MG \u00d7 {_format_number(annual_mg)} MG/yr",
            "source": "EPA CWNS benchmark",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    feedstock_receiving_cost = get_val("feedstock_receiving_cost")
    if feedstock_receiving_cost > 0 and pt in ("b", "c", "d"):
        annual_tons = 0.0
        summary = mass_balance_results.get("summary") or {}
        for key, val in summary.items():
            if "feedstock" in key.lower() and "ton" in (val.get("unit") or "").lower():
                raw = str(val.get("value", "")).replace(",", "")
                try:
                    v = float(raw)
                    if v > 0:
                        annual_tons = v * 365
                except (ValueError, TypeError):
                    pass
        if annual_tons <= 0:
            annual_tons = 36500
        annual_cost = round(feedstock_receiving_cost * annual_tons)
        line_items.append({
            "id": make_id(),
            "category": "Chemical",
            "description": f"Feedstock receiving & handling (${feedstock_receiving_cost}/ton \u00d7 {_format_number(annual_tons)} tons/yr)",
            "annualCost": annual_cost,
            "unitCost": feedstock_receiving_cost,
            "unitBasis": "$/ton",
            "scalingBasis": f"{_format_number(annual_tons)} tons/yr throughput",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: ${feedstock_receiving_cost}/ton \u00d7 {_format_number(annual_tons)} tons/yr",
            "source": "Industry estimate",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    sludge_disposal_cost = get_val("sludge_disposal_cost")
    if sludge_disposal_cost > 0 and pt == "a":
        summary = mass_balance_results.get("summary") or {}
        design_flow_entry = summary.get("designFlow") or {}
        try:
            flow_mgd = float(str(design_flow_entry.get("value", "1")))
        except (ValueError, TypeError):
            flow_mgd = 1.0
        annual_wet_tons = round(flow_mgd * 365 * 8.34 * 0.01 * 0.2)
        annual_cost = round(sludge_disposal_cost * annual_wet_tons)
        line_items.append({
            "id": make_id(),
            "category": "Disposal",
            "description": f"Biosolids disposal (${sludge_disposal_cost}/wet ton \u00d7 {_format_number(annual_wet_tons)} wet tons/yr)",
            "annualCost": annual_cost,
            "unitCost": sludge_disposal_cost,
            "unitBasis": "$/wet ton",
            "scalingBasis": f"{_format_number(annual_wet_tons)} wet tons/yr",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: ${sludge_disposal_cost}/wet ton \u00d7 {_format_number(annual_wet_tons)} wet tons/yr",
            "source": "Regional average",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    digestate_disposal_cost = get_val("digestate_disposal_cost")
    if digestate_disposal_cost > 0 and pt in ("b", "c", "d"):
        annual_digestate_tons = 0.0
        summary = mass_balance_results.get("summary") or {}
        for key, val in summary.items():
            if "digestate" in key.lower() and "ton" in (val.get("unit") or "").lower():
                raw = str(val.get("value", "")).replace(",", "")
                try:
                    v = float(raw)
                    if v > 0:
                        annual_digestate_tons = v * 365
                except (ValueError, TypeError):
                    pass
        if annual_digestate_tons <= 0:
            annual_digestate_tons = 18250
        annual_cost = round(digestate_disposal_cost * annual_digestate_tons)
        line_items.append({
            "id": make_id(),
            "category": "Disposal",
            "description": f"Digestate disposal (${digestate_disposal_cost}/wet ton \u00d7 {_format_number(annual_digestate_tons)} wet tons/yr)",
            "annualCost": annual_cost,
            "unitCost": digestate_disposal_cost,
            "unitBasis": "$/wet ton",
            "scalingBasis": f"{_format_number(annual_digestate_tons)} wet tons/yr",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: ${digestate_disposal_cost}/wet ton \u00d7 {_format_number(annual_digestate_tons)} wet tons/yr",
            "source": "Regional average",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    insurance_rate = get_val("insurance_rate") / 100
    if total_project_cost > 0 and insurance_rate > 0:
        insurance_cost = round(total_project_cost * insurance_rate)
        line_items.append({
            "id": make_id(),
            "category": "Other",
            "description": f"Property & liability insurance ({insurance_rate * 100:.1f}% of ${_format_number(total_project_cost)} project cost)",
            "annualCost": insurance_cost,
            "unitCost": None,
            "unitBasis": None,
            "scalingBasis": f"${_format_number(total_project_cost)} total project cost",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: {insurance_rate * 100:.1f}% \u00d7 ${_format_number(total_project_cost)}",
            "source": "Industry benchmark",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    lab_testing_annual = get_val("lab_testing_annual")
    if lab_testing_annual > 0:
        line_items.append({
            "id": make_id(),
            "category": "Other",
            "description": "Laboratory analysis & compliance testing",
            "annualCost": round(lab_testing_annual),
            "unitCost": None,
            "unitBasis": None,
            "scalingBasis": "Annual lump sum",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: ${_format_number(lab_testing_annual)}/yr",
            "source": "Regulatory compliance estimate",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    interconnect_fees = get_val("interconnect_fees")
    if interconnect_fees > 0:
        line_items.append({
            "id": make_id(),
            "category": "Other",
            "description": "Pipeline interconnection & metering fees",
            "annualCost": round(interconnect_fees),
            "unitCost": None,
            "unitBasis": None,
            "scalingBasis": "Annual lump sum",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: ${_format_number(interconnect_fees)}/yr",
            "source": "Utility estimate",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })

    return line_items


def _categorize(cat: str) -> str:
    c = cat.lower()
    if "labor" in c or "staff" in c or "personnel" in c:
        return "Labor"
    if "energy" in c or "electric" in c or "utilit" in c:
        return "Energy"
    if "chemical" in c or "consumab" in c or "media" in c or "membrane" in c or "feedstock" in c:
        return "Chemical"
    if "mainten" in c or "repair" in c or "spare" in c:
        return "Maintenance"
    if "dispos" in c or "haul" in c or "sludge" in c or "digestate" in c:
        return "Disposal"
    if "revenue" in c or "offset" in c or "credit" in c:
        return "Revenue Offset"
    return "Other"


def _build_opex_summary_from_line_items(line_items: list[dict], total_project_capex: float) -> dict:
    total_labor_cost = sum(li["annualCost"] for li in line_items if _categorize(li["category"]) == "Labor")
    total_energy_cost = sum(li["annualCost"] for li in line_items if _categorize(li["category"]) == "Energy")
    total_chemical_cost = sum(li["annualCost"] for li in line_items if _categorize(li["category"]) == "Chemical")
    total_maintenance_cost = sum(li["annualCost"] for li in line_items if _categorize(li["category"]) == "Maintenance")
    total_disposal_cost = sum(li["annualCost"] for li in line_items if _categorize(li["category"]) == "Disposal")
    total_other_cost = sum(li["annualCost"] for li in line_items if _categorize(li["category"]) == "Other")
    revenue_offsets = sum(li["annualCost"] for li in line_items if _categorize(li["category"]) == "Revenue Offset")

    total_annual_opex = total_labor_cost + total_energy_cost + total_chemical_cost + total_maintenance_cost + total_disposal_cost + total_other_cost
    net_annual_opex = total_annual_opex + revenue_offsets

    opex_as_percent_of_capex = None
    if total_project_capex > 0:
        opex_as_percent_of_capex = round((total_annual_opex / total_project_capex) * 1000) / 10

    return {
        "totalAnnualOpex": total_annual_opex,
        "totalLaborCost": total_labor_cost,
        "totalEnergyCost": total_energy_cost,
        "totalChemicalCost": total_chemical_cost,
        "totalMaintenanceCost": total_maintenance_cost,
        "totalDisposalCost": total_disposal_cost,
        "totalOtherCost": total_other_cost,
        "revenueOffsets": revenue_offsets,
        "netAnnualOpex": net_annual_opex,
        "opexAsPercentOfCapex": opex_as_percent_of_capex,
    }


def recompute_opex_from_assumptions(
    editable_assumptions: list[dict],
    mass_balance_results: dict,
    capex_results: dict | None,
    project_type: str,
    existing_results: dict,
) -> dict:
    line_items = calculate_all_deterministic_line_items(
        editable_assumptions, mass_balance_results, capex_results, project_type
    )
    total_project_capex = ((capex_results or {}).get("summary") or {}).get("totalProjectCost", 0) or 0
    summary = _build_opex_summary_from_line_items(line_items, total_project_capex)

    display_assumptions = []
    for a in editable_assumptions:
        val = a.get("value", 0)
        unit = a.get("unit", "")
        if isinstance(val, (int, float)):
            if "$" in unit or "/yr" in unit:
                formatted = f"${_format_number(val)} {unit}"
            else:
                formatted = f"{_format_number(val)} {unit}"
        else:
            formatted = f"{val} {unit}"
        display_assumptions.append({
            "parameter": a.get("parameter", ""),
            "value": formatted,
            "source": a.get("source", ""),
        })

    result = dict(existing_results)
    result["lineItems"] = line_items
    result["summary"] = summary
    result["assumptions"] = display_assumptions
    result["editableAssumptions"] = editable_assumptions
    result["methodology"] = "Deterministic bottom-up operating cost estimate from editable assumptions"
    return result
