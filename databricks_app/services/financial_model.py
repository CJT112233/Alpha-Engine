import math
import copy
from datetime import datetime


DEFAULT_ASSUMPTIONS = {
    "inflationRate": 0.025,
    "projectLifeYears": 20,
    "constructionMonths": 18,
    "uptimePct": 0.98,
    "biogasGrowthRate": 0.0,
    "rngPricePerMMBtu": 30,
    "rngPriceEscalator": 0.02,
    "rinPricePerRIN": 2.50,
    "rinPriceEscalator": 0.01,
    "rinBrokeragePct": 0.20,
    "rinPerMMBtu": 11.727,
    "natGasPricePerMMBtu": 3.50,
    "natGasPriceEscalator": 0.03,
    "wheelHubCostPerMMBtu": 1.0,
    "electricityCostPerKWh": 0.08,
    "electricityEscalator": 0.025,
    "gasCostPerMMBtu": 4.00,
    "gasCostEscalator": 0.03,
    "itcRate": 0.40,
    "itcMonetizationPct": 0.88,
    "maintenanceCapexPct": 0.015,
    "discountRate": 0.10,
    "revenueMarket": "d3",
    "voluntaryPricing": {
        "gasPricePerMMBtu": 3.50,
        "gasPriceEscalator": 0.03,
        "voluntaryPremiumPerMMBtu": 16,
        "voluntaryPremiumEscalator": 0.02,
    },
    "feedstockCosts": [],
    "debtFinancing": {
        "enabled": False,
        "loanAmountPct": 0.70,
        "interestRate": 0.06,
        "termYears": 10,
    },
    "fortyFiveZ": {
        "enabled": True,
        "ciScore": 25,
        "targetCI": 50,
        "creditPricePerGal": 1.06,
        "conversionGalPerMMBtu": 8.614,
        "monetizationPct": 0.90,
        "endYear": 2029,
    },
}


def _parse_float(val):
    try:
        return float(str(val).replace(",", ""))
    except (ValueError, TypeError):
        return float("nan")


def extract_biogas_scfm(mb_results: dict) -> float:
    summary = mb_results.get("summary")
    if summary and isinstance(summary, dict):
        for key, val in summary.items():
            k = key.lower()
            if "biogas" in k and ("flow" in k or "scfm" in k):
                raw = val.get("value") if isinstance(val, dict) else val
                num = _parse_float(raw)
                if not math.isnan(num) and num > 0:
                    return num

    for stage in mb_results.get("adStages", []) or []:
        output = stage.get("outputStream", {}) or {}
        for key, spec in output.items():
            k = key.lower()
            if ("biogas" in k and "flow" in k) or k == "biogasflow":
                if isinstance(spec, dict) and spec is not None:
                    raw = spec.get("value", spec)
                else:
                    raw = spec
                num = float(raw) if isinstance(raw, (int, float)) else _parse_float(raw)
                if not math.isnan(num) and num > 0:
                    unit = (spec.get("unit", "") if isinstance(spec, dict) else "").lower()
                    if "scfd" in unit or "day" in unit:
                        return num / 1440
                    return num

    return 300.0


def extract_rng_mmbtu_per_day(mb_results: dict, biogas_scfm: float) -> float:
    summary = mb_results.get("summary")
    if summary and isinstance(summary, dict):
        for key, val in summary.items():
            k = key.lower()
            if "rng" in k and ("mmbtu" in k or "production" in k or "energy" in k):
                raw = val.get("value") if isinstance(val, dict) else val
                num = _parse_float(raw)
                if not math.isnan(num) and num > 0:
                    unit = (val.get("unit", "") if isinstance(val, dict) else "").lower()
                    if "/day" in unit or "day" in unit:
                        return num
                    if "/yr" in unit or "year" in unit or "annual" in unit:
                        return num / 365
                    return num

    biogas_btu_per_scf = 600
    methane_recovery = 0.97
    capture = 0.98
    return (biogas_scfm * 1440 * biogas_btu_per_scf * methane_recovery * capture) / 1_000_000


def extract_opex_breakdown(opex_results: dict) -> dict:
    utility_cost = 0.0
    labor_cost = 0.0
    maintenance_cost = 0.0
    chemical_cost = 0.0
    insurance_cost = 0.0
    feedstock_logistics_cost = 0.0
    digestate_management_cost = 0.0
    admin_overhead_cost = 0.0
    tipping_fee_revenue = 0.0

    for item in opex_results.get("lineItems", []):
        cat = (item.get("category") or "").lower()
        desc = (item.get("description") or "").lower()
        cost = item.get("annualCost") or 0

        if "revenue offset" in cat or ("revenue" in cat and "admin" not in cat and "overhead" not in cat):
            if "tipping" in desc or "tip fee" in desc:
                tipping_fee_revenue += abs(cost)
            continue

        if any(x in cat for x in ["utilit", "energy", "electric", "power"]):
            utility_cost += cost
        elif any(x in cat for x in ["labor", "staff", "personnel"]):
            labor_cost += cost
        elif any(x in cat for x in ["mainten", "repair", "r&m"]):
            maintenance_cost += cost
        elif any(x in cat for x in ["chemical", "reagent", "consumab"]):
            chemical_cost += cost
        elif any(x in cat for x in ["insurance", "regulatory"]):
            insurance_cost += cost
        elif any(x in cat for x in ["feedstock", "logistics"]):
            feedstock_logistics_cost += cost
        elif any(x in cat for x in ["digestate", "disposal", "residual"]):
            digestate_management_cost += cost
        elif any(x in cat for x in ["admin", "overhead", "general"]):
            admin_overhead_cost += cost
        elif any(x in desc for x in ["utilit", "electric", "power", "gas cost"]):
            utility_cost += cost
        elif any(x in desc for x in ["labor", "operator", "staff"]):
            labor_cost += cost
        elif any(x in desc for x in ["mainten", "repair"]):
            maintenance_cost += cost
        elif any(x in desc for x in ["chemical", "consumab"]):
            chemical_cost += cost
        elif "insurance" in desc:
            insurance_cost += cost
        elif "tipping" in desc or "tip fee" in desc:
            tipping_fee_revenue += abs(cost)
        else:
            admin_overhead_cost += cost

    return {
        "utilityCost": utility_cost,
        "laborCost": labor_cost,
        "maintenanceCost": maintenance_cost,
        "chemicalCost": chemical_cost,
        "insuranceCost": insurance_cost,
        "feedstockLogisticsCost": feedstock_logistics_cost,
        "digestateManagementCost": digestate_management_cost,
        "adminOverheadCost": admin_overhead_cost,
        "tippingFeeRevenue": tipping_fee_revenue,
    }


def calculate_irr(cash_flows: list, max_iterations: int = 1000, tolerance: float = 1e-7):
    if len(cash_flows) < 2:
        return None

    lo = -0.99
    hi = 10.0

    def npv_at(rate):
        npv = 0.0
        for i, cf in enumerate(cash_flows):
            npv += cf / math.pow(1 + rate, i)
        return npv

    npv_lo = npv_at(lo)
    npv_hi = npv_at(hi)
    if npv_lo * npv_hi > 0:
        return None

    for _ in range(max_iterations):
        mid = (lo + hi) / 2
        npv_mid = npv_at(mid)

        if abs(npv_mid) < tolerance:
            return mid

        if npv_mid * npv_at(lo) < 0:
            hi = mid
        else:
            lo = mid

    return (lo + hi) / 2


def calculate_npv(cash_flows: list, discount_rate: float) -> float:
    npv = 0.0
    for i, cf in enumerate(cash_flows):
        npv += cf / math.pow(1 + discount_rate, i)
    return npv


def estimate_ci_score(feedstocks: list = None) -> int:
    if not feedstocks or len(feedstocks) == 0:
        return 25

    ci_by_type = {
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
    }

    total_ci = 0.0
    total_weight = 0.0

    for f in feedstocks:
        name = (f.get("feedstockType") or f.get("name") or "").lower().strip()
        ci = 25
        for key, val in ci_by_type.items():
            if name in key or key in name:
                ci = val
                break
        vol_raw = f.get("feedstockVolume", 1)
        vol = _parse_float(vol_raw) if vol_raw is not None else 1.0
        if math.isnan(vol) or vol == 0:
            vol = 1.0
        total_ci += ci * vol
        total_weight += vol

    return round(total_ci / total_weight) if total_weight > 0 else 25


def calculate_45z_revenue_per_mmbtu(forty_five_z: dict) -> float:
    if not forty_five_z.get("enabled"):
        return 0.0
    emission_factor = max(0, (forty_five_z["targetCI"] - forty_five_z["ciScore"]) / forty_five_z["targetCI"])
    credit_per_gal_equiv = emission_factor * forty_five_z["creditPricePerGal"]
    price_per_mmbtu = credit_per_gal_equiv * forty_five_z["conversionGalPerMMBtu"]
    return price_per_mmbtu * forty_five_z["monetizationPct"]


def build_default_assumptions(mb_results: dict, opex_results: dict = None, feedstocks: list = None) -> dict:
    assumptions = copy.deepcopy(DEFAULT_ASSUMPTIONS)

    estimated_ci = estimate_ci_score(feedstocks)
    assumptions["fortyFiveZ"]["ciScore"] = estimated_ci

    if feedstocks and len(feedstocks) > 0:
        feedstock_costs = []
        for f in feedstocks:
            annual_tons = 0.0
            if f.get("feedstockVolume"):
                vol = _parse_float(f["feedstockVolume"])
                if math.isnan(vol):
                    vol = 0.0
                unit = (f.get("feedstockUnit") or "").lower()
                if "ton" in unit:
                    if "day" in unit:
                        annual_tons = vol * 365
                    elif "week" in unit:
                        annual_tons = vol * 52
                    elif "month" in unit:
                        annual_tons = vol * 12
                    else:
                        annual_tons = vol
                elif "gal" in unit:
                    multiplier = 365 if "day" in unit else 1
                    annual_tons = vol * 8.34 / 2000 * multiplier
                else:
                    annual_tons = vol

            feed_unit = (f.get("feedstockUnit") or "").lower()
            unit_basis = "$/gal" if "gal" in feed_unit else "$/ton"
            feedstock_costs.append({
                "feedstockName": f.get("feedstockType") or f.get("name") or "Unknown Feedstock",
                "costType": "tip_fee",
                "unitRate": 0,
                "unitBasis": unit_basis,
                "annualTons": round(annual_tons),
                "escalator": 0.025,
                "costPerTon": 0,
            })
        assumptions["feedstockCosts"] = feedstock_costs

    return assumptions


def calculate_financial_model(assumptions: dict, mb_results: dict, capex_results: dict, opex_results: dict) -> dict:
    biogas_scfm_base = extract_biogas_scfm(mb_results)
    rng_mmbtu_per_day_base = extract_rng_mmbtu_per_day(mb_results, biogas_scfm_base)
    capex_total = capex_results.get("summary", {}).get("totalProjectCost", 0)
    opex_breakdown = extract_opex_breakdown(opex_results)
    opex_annual_base = (
        opex_breakdown["utilityCost"]
        + opex_breakdown["laborCost"]
        + opex_breakdown["maintenanceCost"]
        + opex_breakdown["chemicalCost"]
        + opex_breakdown["insuranceCost"]
        + opex_breakdown["feedstockLogisticsCost"]
        + opex_breakdown["digestateManagementCost"]
        + opex_breakdown["adminOverheadCost"]
    )
    years = assumptions.get("projectLifeYears", DEFAULT_ASSUMPTIONS["projectLifeYears"])
    current_year = datetime.now().year
    cod_year = current_year + math.ceil(assumptions.get("constructionMonths", 18) / 12)
    warnings = []

    if capex_total <= 0:
        warnings.append({
            "field": "capex",
            "message": "CapEx total is zero or negative — financial metrics may be unreliable",
            "severity": "warning",
        })

    forty_five_z = assumptions.get("fortyFiveZ") or DEFAULT_ASSUMPTIONS["fortyFiveZ"]
    net_45z_price_per_mmbtu = calculate_45z_revenue_per_mmbtu(forty_five_z)
    is_voluntary = assumptions.get("revenueMarket") == "voluntary"
    vol_pricing = assumptions.get("voluntaryPricing") or DEFAULT_ASSUMPTIONS["voluntaryPricing"]

    pro_forma = []
    cash_flows = [-capex_total]
    cumulative_cash_flow = -capex_total

    itc_proceeds = capex_total * assumptions.get("itcRate", 0.40) * assumptions.get("itcMonetizationPct", 0.88)

    for y in range(1, years + 1):
        inflation_factor = math.pow(1 + assumptions.get("inflationRate", 0.025), y - 1)
        growth_factor = math.pow(1 + assumptions.get("biogasGrowthRate", 0.0), y - 1)

        biogas_scfm = biogas_scfm_base * growth_factor
        rng_mmbtu_per_day = rng_mmbtu_per_day_base * growth_factor
        rng_production_mmbtu = rng_mmbtu_per_day * 365 * assumptions.get("uptimePct", 0.98)

        rin_revenue = 0.0
        rin_brokerage = 0.0
        nat_gas_revenue = 0.0
        voluntary_revenue = 0.0

        if is_voluntary:
            gas_price = vol_pricing["gasPricePerMMBtu"] * math.pow(1 + vol_pricing["gasPriceEscalator"], y - 1)
            premium = vol_pricing["voluntaryPremiumPerMMBtu"] * math.pow(1 + vol_pricing["voluntaryPremiumEscalator"], y - 1)
            effective_vol_price = max(0, gas_price + premium - assumptions.get("wheelHubCostPerMMBtu", 1.0))
            voluntary_revenue = rng_production_mmbtu * effective_vol_price
        else:
            rin_price = assumptions.get("rinPricePerRIN", 2.50) * math.pow(1 + assumptions.get("rinPriceEscalator", 0.01), y - 1)
            rins_generated = rng_production_mmbtu * assumptions.get("rinPerMMBtu", 11.727)
            rin_revenue = rins_generated * rin_price
            rin_brokerage = rin_revenue * assumptions.get("rinBrokeragePct", 0.20)

            nat_gas_price = assumptions.get("natGasPricePerMMBtu", 3.50) * math.pow(1 + assumptions.get("natGasPriceEscalator", 0.03), y - 1)
            effective_nat_gas_price = max(0, nat_gas_price - assumptions.get("wheelHubCostPerMMBtu", 1.0))
            nat_gas_revenue = rng_production_mmbtu * effective_nat_gas_price

        calendar_year = cod_year + y - 1
        forty_five_z_revenue = 0.0
        if forty_five_z.get("enabled") and calendar_year <= forty_five_z.get("endYear", 2029):
            forty_five_z_revenue = rng_production_mmbtu * net_45z_price_per_mmbtu

        tipping_fee_rev = opex_breakdown["tippingFeeRevenue"] * inflation_factor
        for fs in assumptions.get("feedstockCosts", []):
            if (fs.get("costType") or "cost") == "tip_fee" and fs.get("unitRate", 0) > 0:
                fs_factor = math.pow(1 + (fs.get("escalator") or assumptions.get("inflationRate", 0.025)), y - 1)
                tipping_fee_rev += fs["unitRate"] * fs["annualTons"] * fs_factor

        if is_voluntary:
            total_revenue = voluntary_revenue + forty_five_z_revenue + tipping_fee_rev
        else:
            total_revenue = rin_revenue - rin_brokerage + nat_gas_revenue + forty_five_z_revenue + tipping_fee_rev

        utility_cost = opex_breakdown["utilityCost"] * math.pow(1 + assumptions.get("electricityEscalator", 0.025), y - 1)
        labor_cost = opex_breakdown["laborCost"] * inflation_factor
        maintenance_cost = opex_breakdown["maintenanceCost"] * inflation_factor
        chemical_cost = opex_breakdown["chemicalCost"] * inflation_factor
        insurance_cost = opex_breakdown["insuranceCost"] * inflation_factor

        feedstock_cost = opex_breakdown["feedstockLogisticsCost"] * inflation_factor
        for fs in assumptions.get("feedstockCosts", []):
            if (fs.get("costType") or "cost") == "cost" and fs.get("unitRate", 0) > 0:
                fs_factor = math.pow(1 + (fs.get("escalator") or assumptions.get("inflationRate", 0.025)), y - 1)
                feedstock_cost += fs["unitRate"] * fs["annualTons"] * fs_factor
            elif not fs.get("costType") and fs.get("costPerTon", 0) > 0:
                fs_factor = math.pow(1 + (fs.get("escalator") or assumptions.get("inflationRate", 0.025)), y - 1)
                feedstock_cost += fs["costPerTon"] * fs["annualTons"] * fs_factor

        digestate_management_cost = opex_breakdown["digestateManagementCost"] * inflation_factor
        admin_overhead_cost = opex_breakdown["adminOverheadCost"] * inflation_factor

        total_opex = (
            utility_cost + feedstock_cost + labor_cost + maintenance_cost
            + chemical_cost + insurance_cost + digestate_management_cost + admin_overhead_cost
        )
        ebitda = total_revenue - total_opex
        maintenance_capex = capex_total * assumptions.get("maintenanceCapexPct", 0.015) * inflation_factor

        debt_service = 0.0
        debt_fin = assumptions.get("debtFinancing", DEFAULT_ASSUMPTIONS["debtFinancing"])
        if debt_fin.get("enabled") and y <= debt_fin.get("termYears", 10):
            principal = capex_total * debt_fin.get("loanAmountPct", 0.70)
            r = debt_fin.get("interestRate", 0.06)
            n = debt_fin.get("termYears", 10)
            debt_service = principal * (r * math.pow(1 + r, n)) / (math.pow(1 + r, n) - 1)

        net_cash_flow = ebitda - maintenance_capex - debt_service
        if y == 1:
            net_cash_flow += itc_proceeds
        cumulative_cash_flow += net_cash_flow

        cash_flows.append(net_cash_flow)

        pro_forma.append({
            "year": y,
            "calendarYear": calendar_year,
            "biogasScfm": round(biogas_scfm),
            "rngProductionMMBtu": round(rng_production_mmbtu),
            "rinRevenue": round(rin_revenue),
            "rinBrokerage": round(rin_brokerage),
            "natGasRevenue": round(nat_gas_revenue),
            "voluntaryRevenue": round(voluntary_revenue),
            "fortyFiveZRevenue": round(forty_five_z_revenue),
            "tippingFeeRevenue": round(tipping_fee_rev),
            "totalRevenue": round(total_revenue),
            "utilityCost": round(utility_cost),
            "feedstockCost": round(feedstock_cost),
            "laborCost": round(labor_cost),
            "maintenanceCost": round(maintenance_cost),
            "chemicalCost": round(chemical_cost),
            "insuranceCost": round(insurance_cost),
            "digestateManagementCost": round(digestate_management_cost),
            "adminOverheadCost": round(admin_overhead_cost),
            "totalOpex": round(total_opex),
            "ebitda": round(ebitda),
            "maintenanceCapex": round(maintenance_capex),
            "debtService": round(debt_service),
            "netCashFlow": round(net_cash_flow),
            "cumulativeCashFlow": round(cumulative_cash_flow),
        })

    irr = calculate_irr(cash_flows)
    npv10 = calculate_npv(cash_flows, assumptions.get("discountRate", 0.10))

    total_cash_in = sum(max(0, yr["netCashFlow"]) for yr in pro_forma)
    moic = total_cash_in / capex_total if capex_total > 0 else 0

    payback_years = None
    for yr in pro_forma:
        if yr["cumulativeCashFlow"] >= 0:
            payback_years = yr["year"]
            break

    sum_total_revenue = sum(yr["totalRevenue"] for yr in pro_forma)
    sum_total_opex = sum(yr["totalOpex"] for yr in pro_forma)
    sum_total_ebitda = sum(yr["ebitda"] for yr in pro_forma)
    sum_total_maintenance_capex = sum(yr["maintenanceCapex"] for yr in pro_forma)

    metrics = {
        "irr": round(irr * 10000) / 10000 if irr is not None else None,
        "npv10": round(npv10),
        "moic": round(moic * 100) / 100,
        "paybackYears": payback_years,
        "totalRevenue": round(sum_total_revenue),
        "totalOpex": round(sum_total_opex),
        "totalEbitda": round(sum_total_ebitda),
        "totalCapex": round(capex_total),
        "itcProceeds": round(itc_proceeds),
        "totalMaintenanceCapex": round(sum_total_maintenance_capex),
        "averageAnnualEbitda": round(sum_total_ebitda / years) if years > 0 else 0,
    }

    return {
        "projectType": mb_results.get("projectType"),
        "assumptions": assumptions,
        "proForma": pro_forma,
        "metrics": metrics,
        "capexTotal": round(capex_total),
        "opexAnnualBase": round(opex_annual_base),
        "biogasScfmBase": round(biogas_scfm_base),
        "rngMMBtuPerDayBase": round(rng_mmbtu_per_day_base * 10) / 10,
        "warnings": warnings,
    }
