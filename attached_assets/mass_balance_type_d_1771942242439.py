import math
import re

from .mass_balance_type_a import calculate_mass_balance_type_a


AD_DEFAULTS = {
    "sludgeThickening": {
        "thickenedSolids": {"value": 5, "unit": "% TS", "source": "WEF MOP 8"},
        "captureRate": {"value": 95, "unit": "%", "source": "Gravity belt thickener"},
    },
    "digester": {
        "hrt": {"value": 20, "unit": "days", "source": "WEF MOP 8 — WWTP sludge"},
        "organicLoadingRate": {"value": 2.5, "unit": "kg VS/m³·d", "source": "WEF MOP 8"},
        "vsDestruction": {"value": 55, "unit": "%", "source": "WEF MOP 8 — mixed sludge"},
        "temperature": {"value": 35, "unit": "°C", "source": "Mesophilic standard"},
        "mixingPower": {"value": 5, "unit": "W/m³", "source": "WEF MOP 8"},
        "gasYield": {"value": 0.9, "unit": "scf/lb VS destroyed", "source": "WEF MOP 8 — municipal sludge"},
        "ch4Content": {"value": 63, "unit": "%", "source": "Typical WWTP biogas"},
        "co2Content": {"value": 35, "unit": "%", "source": "Typical WWTP biogas"},
        "h2sContent": {"value": 500, "unit": "ppmv", "source": "Typical WWTP biogas — lower than AD-only"},
    },
    "truckedFeedstock": {
        "defaultTS": {"value": 15, "unit": "%", "source": "Typical trucked feedstock"},
        "defaultVS": {"value": 80, "unit": "% of TS", "source": "Typical organic waste"},
        "defaultBMP": {"value": 0.35, "unit": "scf CH₄/lb VS", "source": "Engineering practice"},
    },
    "gasConditioning": {
        "h2sRemovalEff": {"value": 99.5, "unit": "%", "source": "Iron sponge/bioscrubber"},
        "moistureRemoval": {"value": 99, "unit": "%", "source": "Chiller/desiccant"},
        "siloxaneRemoval": {"value": 95, "unit": "%", "source": "Activated carbon"},
    },
    "gasUpgrading": {
        "methaneRecovery": {"value": 97, "unit": "%", "source": "Membrane/PSA typical"},
        "productCH4": {"value": 97, "unit": "%", "source": "Pipeline quality RNG"},
        "electricalDemand": {"value": 8.8, "unit": "kWh/1,000 scf raw biogas", "source": "Engineering practice"},
        "pressureOut": {"value": 200, "unit": "psig", "source": "Pipeline injection"},
    },
    "dewateringPost": {
        "cakeSolids": {"value": 22, "unit": "% TS", "source": "Belt filter press — digested sludge"},
        "captureRate": {"value": 95, "unit": "%", "source": "WEF MOP 8"},
    },
}


def m3_to_gal(m3):
    return m3 * 264.172


def m3_to_scf(m3):
    return m3 * 35.3147


def round_to(val, decimals=1):
    factor = 10 ** decimals
    return math.floor(val * factor + 0.5) / factor


def get_spec_value(fs, keys, default_val):
    feedstock_specs = fs.get("feedstockSpecs")
    if not feedstock_specs:
        return default_val
    for key in keys:
        for k, spec in feedstock_specs.items():
            if k.lower() == key.lower() or key.lower() in spec.get("displayName", "").lower():
                raw = str(spec.get("value", ""))
                cleaned = re.sub(r"[,%]", "", raw)
                try:
                    val = float(cleaned)
                    return val
                except (ValueError, TypeError):
                    pass
    return default_val


def parse_feedstock_volume(fs):
    raw_vol = (fs.get("feedstockVolume") or "0").replace(",", "")
    try:
        vol = float(raw_vol)
    except (ValueError, TypeError):
        vol = 0.0
    unit = (fs.get("feedstockUnit") or "").lower()
    if math.isnan(vol) or vol <= 0:
        return 0
    if "ton" in unit and "year" in unit:
        return vol / 365
    if "ton" in unit and "day" in unit:
        return vol
    if "ton" in unit and "week" in unit:
        return vol / 7
    if "lb" in unit and "day" in unit:
        return vol / 2000
    if "kg" in unit and "day" in unit:
        return vol / 1000
    if "ton" in unit:
        return vol / 365
    return vol


def is_wastewater_feedstock(fs):
    name = (fs.get("feedstockType") or "").lower()
    unit = (fs.get("feedstockUnit") or "").lower()
    if "mgd" in unit or "gpm" in unit or "gpd" in unit or "m³/d" in unit:
        return True
    if "wastewater" in name or "influent" in name or "sewage" in name:
        return True
    feedstock_specs = fs.get("feedstockSpecs")
    if feedstock_specs:
        for k in feedstock_specs.keys():
            kl = k.lower()
            if "bod" in kl or "cod" in kl or "tss" in kl or "tkn" in kl:
                return True
    return False


def _locale_string(val):
    if isinstance(val, float):
        if val == int(val):
            return f"{int(val):,}"
        parts = str(val).split(".")
        int_part = int(parts[0])
        dec_part = parts[1] if len(parts) > 1 else ""
        formatted = f"{int_part:,}"
        if dec_part:
            formatted += "." + dec_part
        return formatted
    return f"{val:,}"


def calculate_mass_balance_type_d(upif: dict) -> dict:
    warnings = []
    assumptions = []
    ad_stages = []
    all_equipment = []
    eq_id_counter = [100]

    def make_id():
        eid = f"eq-d-{eq_id_counter[0]}"
        eq_id_counter[0] += 1
        return eid

    feedstocks = upif.get("feedstocks") or []
    ww_feedstocks = [fs for fs in feedstocks if is_wastewater_feedstock(fs)]
    trucked_feedstocks = [fs for fs in feedstocks if not is_wastewater_feedstock(fs)]

    ww_result = calculate_mass_balance_type_a(upif)
    ww_stages = ww_result.get("stages", [])
    ww_equipment = ww_result.get("equipment", [])
    ww_recycle_streams = ww_result.get("recycleStreams", [])
    for w in ww_result.get("warnings", []):
        warnings.append({**w, "field": f"WW: {w.get('field', '')}"})
    for a in ww_result.get("assumptions", []):
        assumptions.append({**a, "parameter": f"WW: {a.get('parameter', '')}"})

    primary_sludge_ts_kg_per_day = 0
    was_sludge_ts_kg_per_day = 0
    flow_mgd = ww_stages[0]["influent"]["flow"] if len(ww_stages) > 0 else 1.0
    flow_m3_per_day = flow_mgd * 3785.41

    primary_stage = None
    for s in ww_stages:
        if s.get("type") == "primary":
            primary_stage = s
            break

    if primary_stage:
        tss_removed = primary_stage["influent"]["tss"] - primary_stage["effluent"]["tss"]
        primary_sludge_ts_kg_per_day = tss_removed * flow_m3_per_day / 1000
        assumptions.append({"parameter": "Primary Sludge TS", "value": f"{round_to(primary_sludge_ts_kg_per_day)} kg/day", "source": "From WW mass balance — TSS removed"})

    secondary_stage = None
    for s in ww_stages:
        if s.get("type") in ("activated_sludge", "mbr"):
            secondary_stage = s
            break

    if secondary_stage:
        biomass_tss_removed = secondary_stage["influent"]["tss"] - secondary_stage["effluent"]["tss"]
        bod_removed = secondary_stage["influent"]["bod"] - secondary_stage["effluent"]["bod"]
        was_sludge_ts_kg_per_day = (biomass_tss_removed * flow_m3_per_day / 1000) * 0.6 + (bod_removed * flow_m3_per_day / 1000) * 0.4
        assumptions.append({"parameter": "WAS Sludge TS", "value": f"{round_to(was_sludge_ts_kg_per_day)} kg/day", "source": "Estimated from secondary removal"})

    total_ww_sludge_ts = primary_sludge_ts_kg_per_day + was_sludge_ts_kg_per_day
    primary_vs_fraction = 0.65
    was_vs_fraction = 0.75
    if total_ww_sludge_ts > 0:
        blended_vs_fraction = (primary_sludge_ts_kg_per_day * primary_vs_fraction + was_sludge_ts_kg_per_day * was_vs_fraction) / total_ww_sludge_ts
    else:
        blended_vs_fraction = 0.70
    ww_vs_kg_per_day = total_ww_sludge_ts * blended_vs_fraction

    assumptions.append({"parameter": "WW Sludge VS/TS", "value": f"{round_to(blended_vs_fraction * 100)}%", "source": "Blended primary (65%) + WAS (75%)"})

    trucked_vs_kg_per_day = 0
    trucked_ts_kg_per_day = 0
    for fs in trucked_feedstocks:
        tpd = parse_feedstock_volume(fs)
        if tpd <= 0:
            continue
        ts = get_spec_value(fs, ["totalSolids", "total solids", "ts"], AD_DEFAULTS["truckedFeedstock"]["defaultTS"]["value"])
        vs_of_ts = get_spec_value(fs, ["volatileSolids", "volatile solids", "vs", "vs/ts"], AD_DEFAULTS["truckedFeedstock"]["defaultVS"]["value"])
        feed_kg = tpd * 1000
        ts_kg = feed_kg * (ts / 100)
        vs_kg = ts_kg * (vs_of_ts / 100)
        trucked_ts_kg_per_day += ts_kg
        trucked_vs_kg_per_day += vs_kg

    if len(trucked_feedstocks) > 0:
        assumptions.append({"parameter": "Trucked Feedstock VS", "value": f"{round_to(trucked_vs_kg_per_day)} kg VS/day", "source": "From UPIF trucked inputs"})

    total_vs_load = ww_vs_kg_per_day + trucked_vs_kg_per_day
    total_ts_load = total_ww_sludge_ts + trucked_ts_kg_per_day

    if total_vs_load <= 0:
        warnings.append({"field": "AD Feed", "message": "No VS load available for anaerobic digestion. Check wastewater and trucked feedstock inputs.", "severity": "error"})

    thickened_ts = AD_DEFAULTS["sludgeThickening"]["thickenedSolids"]["value"] / 100
    sludge_vol_m3_per_day = (total_ts_load / (thickened_ts * 1000)) if total_ts_load > 0 else 0

    thickening_stage = {
        "name": "Sludge Thickening & Blending",
        "type": "sludgeThickening",
        "inputStream": {
            "wwSludgeTS": {"value": round_to(total_ww_sludge_ts), "unit": "kg TS/day"},
            "truckedFeedstockTS": {"value": round_to(trucked_ts_kg_per_day), "unit": "kg TS/day"},
            "totalVSLoad": {"value": round_to(total_vs_load), "unit": "kg VS/day"},
        },
        "outputStream": {
            "blendedSludgeVolume": {"value": round_to(m3_to_gal(sludge_vol_m3_per_day)), "unit": "gpd"},
            "thickenedTS": {"value": AD_DEFAULTS["sludgeThickening"]["thickenedSolids"]["value"], "unit": "% TS"},
            "totalVS": {"value": round_to(total_vs_load), "unit": "kg VS/day"},
        },
        "designCriteria": AD_DEFAULTS["sludgeThickening"],
        "notes": [
            f"Blending WW sludge + {len(trucked_feedstocks)} trucked feedstock(s)" if len(trucked_feedstocks) > 0 else "WW sludge only — no co-digestion feedstocks",
        ],
    }
    ad_stages.append(thickening_stage)

    feed_ts_pct = round_to((total_ts_load / (sludge_vol_m3_per_day * 1000 / thickened_ts)) * 100, 1) if sludge_vol_m3_per_day > 0 else 0

    all_equipment.append({
        "id": make_id(),
        "process": "Sludge Thickening",
        "equipmentType": "Gravity Belt Thickener",
        "description": "Thickens combined sludge to target TS for digester feed",
        "quantity": 2 if sludge_vol_m3_per_day > 200 else 1,
        "specs": {
            "feedTS": {"value": str(feed_ts_pct), "unit": "% TS"},
            "thickenedTS": {"value": "5", "unit": "% TS"},
            "throughput": {"value": str(round_to(m3_to_gal(sludge_vol_m3_per_day))), "unit": "gpd"},
        },
        "designBasis": "95% solids capture, 5% cake TS",
        "notes": "Polymer conditioning included",
        "isOverridden": False,
        "isLocked": False,
    })

    vs_destruction = AD_DEFAULTS["digester"]["vsDestruction"]["value"] / 100
    hrt = AD_DEFAULTS["digester"]["hrt"]["value"]
    olr = AD_DEFAULTS["digester"]["organicLoadingRate"]["value"]
    gas_yield = AD_DEFAULTS["digester"]["gasYield"]["value"]
    ch4_pct = AD_DEFAULTS["digester"]["ch4Content"]["value"]
    h2s_ppmv = AD_DEFAULTS["digester"]["h2sContent"]["value"]

    vs_destroyed_kg_per_day = total_vs_load * vs_destruction
    biogas_m3_per_day = vs_destroyed_kg_per_day * gas_yield
    biogas_scf_per_day = biogas_m3_per_day * 35.3147
    biogas_scfm = biogas_scf_per_day / 1440
    ch4_m3_per_day = biogas_m3_per_day * (ch4_pct / 100)

    digester_volume_by_hrt = sludge_vol_m3_per_day * hrt
    digester_volume_by_olr = (total_vs_load / olr) if total_vs_load > 0 else 0
    digester_vol_m3 = max(digester_volume_by_hrt, digester_volume_by_olr)
    num_digesters = 2 if digester_vol_m3 > 4000 else 1
    per_digester_vol = digester_vol_m3 / num_digesters

    assumptions.append({"parameter": "AD VS Destruction", "value": f"{round_to(vs_destruction * 100)}%", "source": "WEF MOP 8 — mixed sludge"})
    assumptions.append({"parameter": "AD Biogas Yield", "value": f"{round_to(gas_yield * 35.3147 / 2.20462, 1)} scf/lb VS destroyed", "source": "WEF MOP 8"})
    assumptions.append({"parameter": "AD Biogas CH₄", "value": f"{ch4_pct}%", "source": "Typical WWTP biogas"})

    actual_olr = round_to(total_vs_load / digester_vol_m3, 2) if digester_vol_m3 > 0 else 0
    actual_hrt = round_to(digester_vol_m3 / sludge_vol_m3_per_day) if sludge_vol_m3_per_day > 0 else 0

    digester_stage = {
        "name": "Anaerobic Digestion",
        "type": "digester",
        "inputStream": {
            "sludgeVolume": {"value": round_to(m3_to_gal(sludge_vol_m3_per_day)), "unit": "gpd"},
            "vsLoad": {"value": round_to(total_vs_load), "unit": "kg VS/day"},
            "tsLoad": {"value": round_to(total_ts_load), "unit": "kg TS/day"},
        },
        "outputStream": {
            "biogasFlow": {"value": round_to(m3_to_scf(biogas_m3_per_day)), "unit": "scfd"},
            "biogasFlowSCFM": {"value": round_to(biogas_scfm), "unit": "scfm"},
            "ch4Content": {"value": ch4_pct, "unit": "%"},
            "h2sContent": {"value": h2s_ppmv, "unit": "ppmv"},
            "vsDestroyed": {"value": round_to(vs_destroyed_kg_per_day), "unit": "kg/day"},
        },
        "designCriteria": AD_DEFAULTS["digester"],
        "notes": [
            f"{num_digesters} digester(s) at {_locale_string(round_to(m3_to_gal(per_digester_vol)))} gallons each",
            f"Actual OLR: {actual_olr} kg VS/m³·d",
            f"Actual HRT: {actual_hrt} days",
        ],
    }
    ad_stages.append(digester_stage)

    all_equipment.append({
        "id": make_id(),
        "process": "Anaerobic Digestion",
        "equipmentType": "CSTR Digester",
        "description": "Mesophilic anaerobic digester for WW sludge" + (" + co-digestion" if len(trucked_feedstocks) > 0 else ""),
        "quantity": num_digesters,
        "specs": {
            "volume": {"value": str(round_to(m3_to_gal(per_digester_vol))), "unit": "gallons"},
            "totalVolume": {"value": str(round_to(m3_to_gal(digester_vol_m3))), "unit": "gallons"},
            "hrt": {"value": str(hrt), "unit": "days"},
            "olr": {"value": str(actual_olr), "unit": "kg VS/m³·d"},
            "temperature": {"value": "35", "unit": "°C"},
        },
        "designBasis": f"{hrt}-day HRT, OLR ≤ {olr} kg VS/m³·d",
        "notes": "Includes gas collection, mixing, and heating",
        "isOverridden": False,
        "isLocked": False,
    })

    h2s_removal_eff = AD_DEFAULTS["gasConditioning"]["h2sRemovalEff"]["value"] / 100
    out_h2s_ppmv = h2s_ppmv * (1 - h2s_removal_eff)
    conditioned_biogas_m3_per_day = biogas_m3_per_day * 0.99

    conditioning_stage = {
        "name": "Biogas Conditioning",
        "type": "gasConditioning",
        "inputStream": {
            "biogasFlow": {"value": round_to(m3_to_scf(biogas_m3_per_day)), "unit": "scfd"},
            "ch4Content": {"value": ch4_pct, "unit": "%"},
            "h2sContent": {"value": h2s_ppmv, "unit": "ppmv"},
        },
        "outputStream": {
            "biogasFlow": {"value": round_to(m3_to_scf(conditioned_biogas_m3_per_day)), "unit": "scfd"},
            "h2sContent": {"value": round_to(out_h2s_ppmv, 1), "unit": "ppmv"},
        },
        "designCriteria": AD_DEFAULTS["gasConditioning"],
        "notes": ["H₂S removal, moisture removal, siloxane removal"],
    }
    ad_stages.append(conditioning_stage)

    all_equipment.append({
        "id": make_id(),
        "process": "Gas Conditioning",
        "equipmentType": "H₂S Removal System",
        "description": "Iron sponge or bioscrubber for H₂S removal",
        "quantity": 1,
        "specs": {
            "inletH2S": {"value": str(h2s_ppmv), "unit": "ppmv"},
            "outletH2S": {"value": str(round_to(out_h2s_ppmv, 1)), "unit": "ppmv"},
            "gasFlow": {"value": str(round_to(biogas_scfm)), "unit": "scfm"},
        },
        "designBasis": "99.5% H₂S removal",
        "notes": "",
        "isOverridden": False,
        "isLocked": False,
    })

    all_equipment.append({
        "id": make_id(),
        "process": "Gas Conditioning",
        "equipmentType": "Gas Chiller/Dryer",
        "description": "Moisture removal to pipeline specification",
        "quantity": 1,
        "specs": {
            "gasFlow": {"value": str(round_to(biogas_scfm)), "unit": "scfm"},
        },
        "designBasis": "Dewpoint < -40°F",
        "notes": "",
        "isOverridden": False,
        "isLocked": False,
    })

    methane_recovery = AD_DEFAULTS["gasUpgrading"]["methaneRecovery"]["value"] / 100
    product_ch4 = AD_DEFAULTS["gasUpgrading"]["productCH4"]["value"]
    rng_ch4_m3_per_day = ch4_m3_per_day * methane_recovery
    rng_m3_per_day = rng_ch4_m3_per_day / (product_ch4 / 100)
    rng_scf_per_day = rng_m3_per_day * 35.3147
    rng_scfm = rng_scf_per_day / 1440
    rng_mmbtu_per_day = rng_scf_per_day * 1012 / 1_000_000
    tailgas_m3_per_day = conditioned_biogas_m3_per_day - rng_m3_per_day
    electrical_demand_kw = biogas_m3_per_day * AD_DEFAULTS["gasUpgrading"]["electricalDemand"]["value"] / 24

    upgrading_stage = {
        "name": "Gas Upgrading to RNG",
        "type": "gasUpgrading",
        "inputStream": {
            "biogasFlow": {"value": round_to(m3_to_scf(conditioned_biogas_m3_per_day)), "unit": "scfd"},
            "ch4Content": {"value": ch4_pct, "unit": "%"},
        },
        "outputStream": {
            "rngFlow": {"value": round_to(m3_to_scf(rng_m3_per_day)), "unit": "scfd"},
            "rngFlowSCFM": {"value": round_to(rng_scfm), "unit": "scfm"},
            "rngCH4": {"value": product_ch4, "unit": "%"},
            "rngEnergy": {"value": round_to(rng_mmbtu_per_day, 1), "unit": "MMBtu/day"},
            "tailgasFlow": {"value": round_to(m3_to_scf(tailgas_m3_per_day)), "unit": "scfd"},
        },
        "designCriteria": AD_DEFAULTS["gasUpgrading"],
        "notes": [
            "Membrane or PSA upgrading",
            f"Electrical demand: {round_to(electrical_demand_kw)} kW",
        ],
    }
    ad_stages.append(upgrading_stage)

    all_equipment.append({
        "id": make_id(),
        "process": "Gas Upgrading",
        "equipmentType": "Membrane/PSA Upgrading System",
        "description": "CO₂ removal and methane enrichment to pipeline quality",
        "quantity": 1,
        "specs": {
            "inletFlow": {"value": str(round_to(biogas_scfm)), "unit": "scfm"},
            "productFlow": {"value": str(round_to(rng_scfm)), "unit": "scfm"},
            "productCH4": {"value": str(product_ch4), "unit": "%"},
            "methaneRecovery": {"value": "97", "unit": "%"},
        },
        "designBasis": "97% methane recovery, pipeline quality RNG",
        "notes": "",
        "isOverridden": False,
        "isLocked": False,
    })

    all_equipment.append({
        "id": make_id(),
        "process": "Gas Upgrading",
        "equipmentType": "RNG Compressor",
        "description": "Multi-stage compressor for pipeline injection",
        "quantity": 1,
        "specs": {
            "flow": {"value": str(round_to(rng_scfm)), "unit": "scfm"},
            "dischargePressure": {"value": "200", "unit": "psig"},
        },
        "designBasis": "Pipeline injection pressure",
        "notes": "",
        "isOverridden": False,
        "isLocked": False,
    })

    all_equipment.append({
        "id": make_id(),
        "process": "Gas Management",
        "equipmentType": "Enclosed Flare",
        "description": "Tail gas and excess biogas combustion",
        "quantity": 1,
        "specs": {
            "capacity": {"value": str(round_to(biogas_scfm * 1.1)), "unit": "scfm"},
        },
        "designBasis": "110% of max biogas production",
        "notes": "",
        "isOverridden": False,
        "isLocked": False,
    })

    digested_ts_kg_per_day = total_ts_load - vs_destroyed_kg_per_day
    dewatering_capture_rate = AD_DEFAULTS["dewateringPost"]["captureRate"]["value"] / 100
    cake_solids = AD_DEFAULTS["dewateringPost"]["cakeSolids"]["value"] / 100
    cake_kg_per_day = (digested_ts_kg_per_day * dewatering_capture_rate) / cake_solids
    cake_tpd = cake_kg_per_day / 1000

    dewatering_stage = {
        "name": "Post-Digestion Dewatering",
        "type": "dewatering",
        "inputStream": {
            "digestedSludgeTS": {"value": round_to(digested_ts_kg_per_day), "unit": "kg TS/day"},
        },
        "outputStream": {
            "cake": {"value": round_to(cake_tpd), "unit": "tons/day"},
            "cakeSolidsContent": {"value": AD_DEFAULTS["dewateringPost"]["cakeSolids"]["value"], "unit": "% TS"},
        },
        "designCriteria": AD_DEFAULTS["dewateringPost"],
        "notes": ["Belt filter press or centrifuge", "Filtrate returned to headworks"],
    }
    ad_stages.append(dewatering_stage)

    all_equipment.append({
        "id": make_id(),
        "process": "Dewatering",
        "equipmentType": "Belt Filter Press",
        "description": "Dewatering of digested sludge",
        "quantity": 2 if cake_tpd > 20 else 1,
        "specs": {
            "capacity": {"value": str(round_to(cake_tpd)), "unit": "tons/day"},
            "cakeSolids": {"value": "22", "unit": "% TS"},
        },
        "designBasis": "95% solids capture",
        "notes": "Polymer system included",
        "isOverridden": False,
        "isLocked": False,
    })

    combined_equipment = ww_equipment + all_equipment

    summary = {
        "wastewaterFlow": {"value": str(round_to(flow_mgd, 2)), "unit": "MGD"},
        "wwTreatmentStages": {"value": str(len(ww_stages)), "unit": "stages"},
        "totalVSLoad": {"value": _locale_string(round_to(total_vs_load)), "unit": "kg VS/day"},
        "wwSludgeVS": {"value": _locale_string(round_to(ww_vs_kg_per_day)), "unit": "kg VS/day"},
        "truckedFeedstockVS": {"value": _locale_string(round_to(trucked_vs_kg_per_day)), "unit": "kg VS/day"},
        "biogasProduction": {"value": _locale_string(round_to(m3_to_scf(biogas_m3_per_day))), "unit": "scfd"},
        "biogasFlowSCFM": {"value": _locale_string(round_to(biogas_scfm)), "unit": "scfm"},
        "rngProduction": {"value": _locale_string(round_to(m3_to_scf(rng_m3_per_day))), "unit": "scfd"},
        "rngFlowSCFM": {"value": _locale_string(round_to(rng_scfm)), "unit": "scfm"},
        "rngEnergy": {"value": _locale_string(round_to(rng_mmbtu_per_day, 1)), "unit": "MMBtu/day"},
        "digesterVolume": {"value": _locale_string(round_to(m3_to_gal(digester_vol_m3))), "unit": "gallons"},
        "biosolidsCake": {"value": _locale_string(round_to(cake_tpd)), "unit": "tons/day"},
        "electricalDemand": {"value": _locale_string(round_to(electrical_demand_kw)), "unit": "kW"},
    }

    return {
        "projectType": "D",
        "stages": ww_stages,
        "adStages": ad_stages,
        "recycleStreams": ww_recycle_streams,
        "equipment": combined_equipment,
        "convergenceIterations": ww_result.get("convergenceIterations", 0),
        "convergenceAchieved": ww_result.get("convergenceAchieved", True),
        "assumptions": assumptions,
        "warnings": warnings,
        "summary": summary,
    }
