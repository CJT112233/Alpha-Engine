import math
import re
import json


AD_DESIGN_DEFAULTS = {
    "receiving": {
        "receivingCapacity": {"value": 1.5, "unit": "x design throughput", "source": "Engineering practice"},
        "storageTime": {"value": 3, "unit": "days", "source": "Engineering practice"},
    },
    "maceration": {
        "targetParticleSize": {"value": 15, "unit": "mm", "source": "Engineering practice"},
        "depackagingRejectRate": {"value": 18, "unit": "%", "source": "Engineering practice"},
        "contaminantRemoval": {"value": 95, "unit": "%", "source": "Engineering practice"},
    },
    "equalization": {
        "retentionTime": {"value": 1.5, "unit": "days", "source": "Engineering practice"},
        "preheatTemp": {"value": 35, "unit": "°C", "source": "Mesophilic AD standard"},
        "targetTS": {"value": 10, "unit": "%", "source": "Engineering practice — pumpable slurry"},
    },
    "digester": {
        "hrt": {"value": 25, "unit": "days", "source": "WEF MOP 8"},
        "organicLoadingRate": {"value": 3.0, "unit": "kg VS/m³·d", "source": "WEF MOP 8"},
        "vsDestruction": {"value": 65, "unit": "%", "source": "WEF MOP 8"},
        "temperature": {"value": 37, "unit": "°C", "source": "Mesophilic standard"},
        "mixingPower": {"value": 6, "unit": "W/m³", "source": "WEF MOP 8"},
        "gasYield": {"value": 0.8, "unit": "scf/lb VS destroyed", "source": "Engineering practice"},
        "ch4Content": {"value": 60, "unit": "%", "source": "Typical AD biogas"},
        "co2Content": {"value": 38, "unit": "%", "source": "Typical AD biogas"},
        "h2sContent": {"value": 1500, "unit": "ppmv", "source": "Typical AD biogas"},
        "headspacePct": {"value": 12, "unit": "%", "source": "Engineering practice"},
    },
    "centrifuge": {
        "solidsCaptureEff": {"value": 92, "unit": "%", "source": "Decanter centrifuge typical"},
        "cakeSolids": {"value": 28, "unit": "% TS", "source": "Decanter centrifuge typical"},
        "polymerDose": {"value": 10, "unit": "kg/ton dry solids", "source": "Engineering practice"},
    },
    "daf": {
        "tssRemoval": {"value": 90, "unit": "%", "source": "Engineering practice"},
        "fogRemoval": {"value": 95, "unit": "%", "source": "Engineering practice"},
        "hydraulicLoading": {"value": 3, "unit": "gpm/ft²", "source": "Engineering practice"},
        "floatRecycleToDigester": {"value": 100, "unit": "%", "source": "Engineering practice"},
    },
    "gasConditioning": {
        "h2sRemovalEff": {"value": 99.5, "unit": "%", "source": "Iron sponge/bioscrubber"},
        "moistureRemoval": {"value": 99, "unit": "%", "source": "Chiller/desiccant"},
        "siloxaneRemoval": {"value": 95, "unit": "%", "source": "Activated carbon"},
        "volumeLoss": {"value": 1, "unit": "%", "source": "Engineering practice"},
    },
    "gasUpgrading": {
        "methaneRecovery": {"value": 97, "unit": "%", "source": "Membrane/PSA typical"},
        "productCH4": {"value": 97, "unit": "%", "source": "Pipeline quality RNG"},
        "electricalDemand": {"value": 8.8, "unit": "kWh/1,000 scf raw biogas", "source": "Engineering practice"},
        "pressureOut": {"value": 200, "unit": "psig", "source": "Pipeline injection"},
    },
}


def _parse_feedstock_volume(fs: dict) -> dict:
    raw = str(fs.get("feedstockVolume") or "0")
    vol = float(re.sub(r",", "", raw) or "0") if raw else 0.0
    unit = (fs.get("feedstockUnit") or "").lower()
    if math.isnan(vol) or vol <= 0:
        return {"tpd": 0, "unit": "tons/day"}
    if "ton" in unit and "year" in unit:
        return {"tpd": vol / 365, "unit": "tons/day"}
    if "ton" in unit and "day" in unit:
        return {"tpd": vol, "unit": "tons/day"}
    if "ton" in unit and "week" in unit:
        return {"tpd": vol / 7, "unit": "tons/day"}
    if "lb" in unit and "day" in unit:
        return {"tpd": vol / 2000, "unit": "tons/day"}
    if "kg" in unit and "day" in unit:
        return {"tpd": vol / 1000, "unit": "tons/day"}
    if "gallon" in unit and "day" in unit:
        return {"tpd": vol * 8.34 / 2000, "unit": "tons/day"}
    if "ton" in unit:
        return {"tpd": vol / 365, "unit": "tons/day"}
    return {"tpd": vol, "unit": "tons/day"}


def _get_spec_value(fs: dict, keys: list, default_val: float) -> float:
    specs = fs.get("feedstockSpecs")
    if not specs:
        return default_val
    for key in keys:
        for k, spec in specs.items():
            if (k.lower() == key.lower() or
                    key.lower() in spec.get("displayName", "").lower()):
                try:
                    val = float(re.sub(r"[,%]", "", str(spec.get("value", ""))))
                    if not math.isnan(val):
                        return val
                except (ValueError, TypeError):
                    pass
    return default_val


def _round_to(val: float, decimals: int = 1) -> float:
    factor = 10 ** decimals
    return round(val * factor) / factor


def _m3_to_gal(m3: float) -> float:
    return m3 * 264.172


def _m3_to_scf(m3: float) -> float:
    return m3 * 35.3147


def _m3_per_min_to_gpm(m3min: float) -> float:
    return m3min * 264.172


def _has_packaged_waste(feedstocks: list) -> bool:
    keywords = ["packaged", "package", "depackag", "wrapped", "containerized", "bagged"]
    for fs in feedstocks:
        text = ((fs.get("feedstockType") or "") + " " + json.dumps(fs.get("feedstockSpecs") or {})).lower()
        if any(kw in text for kw in keywords):
            return True
    return False


def _format_number(val) -> str:
    if isinstance(val, float):
        if val == int(val):
            return f"{int(val):,}"
        return f"{val:,}"
    return f"{val:,}"


def calculate_mass_balance_type_b(upif: dict) -> dict:
    warnings = []
    assumptions = []
    ad_stages = []
    equipment = []
    eq_id_counter = [1]

    def make_id(prefix: str) -> str:
        result = f"{prefix}-{eq_id_counter[0]}"
        eq_id_counter[0] += 1
        return result

    feedstocks = upif.get("feedstocks") or []
    if len(feedstocks) == 0:
        warnings.append({"field": "Feedstock", "message": "No feedstocks found in UPIF", "severity": "error"})
        return {
            "projectType": "B",
            "stages": [],
            "adStages": [],
            "recycleStreams": [],
            "equipment": [],
            "convergenceIterations": 0,
            "convergenceAchieved": True,
            "assumptions": assumptions,
            "warnings": warnings,
            "summary": {},
        }

    total_feed_tpd = 0.0
    total_vs_load_kg_per_day = 0.0
    weighted_ts = 0.0
    weighted_vs = 0.0
    weighted_bmp = 0.0
    weighted_cn = 0.0
    total_weight_for_avg = 0.0

    for fs in feedstocks:
        parsed = _parse_feedstock_volume(fs)
        tpd = parsed["tpd"]
        if tpd <= 0:
            warnings.append({"field": "Volume", "message": f'No volume found for "{fs.get("feedstockType", "")}"', "severity": "warning"})
            continue
        ts = _get_spec_value(fs, ["totalSolids", "total solids", "ts"], 15)
        vs_of_ts = _get_spec_value(fs, ["volatileSolids", "volatile solids", "vs", "vs/ts"], 80)
        bmp = _get_spec_value(fs, ["methanePotential", "bmp", "biochemical methane potential"], 0.30)
        cn = _get_spec_value(fs, ["cnRatio", "c:n ratio", "c:n", "c/n"], 25)

        feed_kg_per_day = tpd * 1000
        ts_kg = feed_kg_per_day * (ts / 100)
        vs_kg = ts_kg * (vs_of_ts / 100)

        total_feed_tpd += tpd
        total_vs_load_kg_per_day += vs_kg
        weighted_ts += ts * tpd
        weighted_vs += vs_of_ts * tpd
        weighted_bmp += bmp * vs_kg
        weighted_cn += cn * tpd
        total_weight_for_avg += tpd

        if ts <= 0:
            assumptions.append({"parameter": f"{fs.get('feedstockType', '')} TS", "value": "15%", "source": "Default assumption"})
        if vs_of_ts <= 0:
            assumptions.append({"parameter": f"{fs.get('feedstockType', '')} VS/TS", "value": "80%", "source": "Default assumption"})

    if total_feed_tpd <= 0:
        warnings.append({"field": "Feed Rate", "message": "Total feed rate is zero; cannot calculate mass balance", "severity": "error"})
        return {
            "projectType": "B",
            "stages": [],
            "adStages": [],
            "recycleStreams": [],
            "equipment": [],
            "convergenceIterations": 0,
            "convergenceAchieved": True,
            "assumptions": assumptions,
            "warnings": warnings,
            "summary": {},
        }

    avg_ts = weighted_ts / total_weight_for_avg
    avg_vs = weighted_vs / total_weight_for_avg
    avg_bmp = weighted_bmp / total_vs_load_kg_per_day if total_vs_load_kg_per_day > 0 else 0.30
    avg_cn = weighted_cn / total_weight_for_avg
    is_packaged = _has_packaged_waste(feedstocks)

    assumptions.append({"parameter": "Blended TS", "value": f"{_round_to(avg_ts)}%", "source": "Weighted average"})
    assumptions.append({"parameter": "Blended VS/TS", "value": f"{_round_to(avg_vs)}%", "source": "Weighted average"})
    assumptions.append({"parameter": "Blended BMP", "value": f"{_round_to(avg_bmp * 35.3147 / 2.2046, 3)} scf CH₄/lb VS", "source": "Weighted average"})

    # ══════════════════════════════════════════════════════════
    # STAGE 1: FEEDSTOCK RECEIVING & STORAGE
    # ══════════════════════════════════════════════════════════
    receiving_stage = {
        "name": "Feedstock Receiving & Storage",
        "type": "receiving",
        "inputStream": {
            "feedRate": {"value": _round_to(total_feed_tpd), "unit": "tons/day"},
            "totalSolids": {"value": _round_to(avg_ts), "unit": "%"},
            "numFeedstocks": {"value": len(feedstocks), "unit": "streams"},
        },
        "outputStream": {
            "feedRate": {"value": _round_to(total_feed_tpd), "unit": "tons/day"},
            "totalSolids": {"value": _round_to(avg_ts), "unit": "%"},
        },
        "designCriteria": AD_DESIGN_DEFAULTS["receiving"],
        "notes": [f"Receiving {len(feedstocks)} feedstock stream(s), total {_format_number(_round_to(total_feed_tpd))} tons/day"],
    }
    ad_stages.append(receiving_stage)

    storage_vol_m3 = (total_feed_tpd * 1000 / 1.05) * AD_DESIGN_DEFAULTS["receiving"]["storageTime"]["value"]
    equipment.append({
        "id": make_id("receiving-hopper"),
        "process": "Feedstock Receiving",
        "equipmentType": "Receiving Hopper / Tipping Floor",
        "description": "Covered receiving area with truck tipping floor and hopper for feedstock unloading",
        "quantity": 2 if len(feedstocks) > 2 else 1,
        "specs": {
            "volume": {"value": str(_round_to(_m3_to_gal(storage_vol_m3))), "unit": "gallons"},
            "storageTime": {"value": "3", "unit": "days"},
            "capacity": {"value": str(_round_to(total_feed_tpd * 1.5)), "unit": "tons/day"},
        },
        "designBasis": "1.5x design throughput with 3-day storage",
        "notes": "Includes weigh scale, odor control, and leak detection",
        "isOverridden": False,
        "isLocked": False,
    })

    # ══════════════════════════════════════════════════════════
    # STAGE 2: FEEDSTOCK PREPARATION (MACERATION & SIZE REDUCTION)
    # ══════════════════════════════════════════════════════════
    reject_rate = AD_DESIGN_DEFAULTS["maceration"]["depackagingRejectRate"]["value"] / 100 if is_packaged else 0
    post_maceration_tpd = total_feed_tpd * (1 - reject_rate)

    maceration_notes = [
        f"Particle size reduction to < {AD_DESIGN_DEFAULTS['maceration']['targetParticleSize']['value']} mm for optimal digestion",
    ]
    if is_packaged:
        maceration_notes.append(f"Depackaging included — {_round_to(reject_rate * 100)}% reject rate for packaging/contaminants")
    else:
        maceration_notes.append("No depackaging required for this feedstock mix")
    maceration_notes.append("Magnetic separation for ferrous metal removal")

    maceration_stage = {
        "name": "Feedstock Preparation (Maceration & Size Reduction)",
        "type": "maceration",
        "inputStream": {
            "feedRate": {"value": _round_to(total_feed_tpd), "unit": "tons/day"},
            "totalSolids": {"value": _round_to(avg_ts), "unit": "%"},
        },
        "outputStream": {
            "feedRate": {"value": _round_to(post_maceration_tpd), "unit": "tons/day"},
            "totalSolids": {"value": _round_to(avg_ts), "unit": "%"},
            "particleSize": {"value": AD_DESIGN_DEFAULTS["maceration"]["targetParticleSize"]["value"], "unit": "mm"},
            "rejects": {"value": _round_to(total_feed_tpd * reject_rate), "unit": "tons/day"},
        },
        "designCriteria": AD_DESIGN_DEFAULTS["maceration"],
        "notes": maceration_notes,
    }
    ad_stages.append(maceration_stage)

    equipment.append({
        "id": make_id("macerator"),
        "process": "Feedstock Preparation",
        "equipmentType": "Macerator / Grinder",
        "description": "Industrial grinder for particle size reduction to < 15 mm",
        "quantity": 1,
        "specs": {
            "capacity": {"value": str(_round_to(total_feed_tpd * 1.25)), "unit": "tons/day"},
            "targetSize": {"value": "15", "unit": "mm"},
            "power": {"value": str(_round_to(total_feed_tpd * 3, 0)), "unit": "kW"},
        },
        "designBasis": "1.25x design feed rate, < 15 mm particle output",
        "notes": "Includes magnetic separator for ferrous metal removal",
        "isOverridden": False,
        "isLocked": False,
    })

    if is_packaged:
        equipment.append({
            "id": make_id("depackager"),
            "process": "Feedstock Preparation",
            "equipmentType": "Depackaging Unit",
            "description": "Separates organic content from packaging material (plastics, cartons, containers)",
            "quantity": 1,
            "specs": {
                "capacity": {"value": str(_round_to(total_feed_tpd * 1.25)), "unit": "tons/day"},
                "rejectRate": {"value": "18", "unit": "%"},
                "organicRecovery": {"value": "82", "unit": "%"},
            },
            "designBasis": "1.25x design feed rate, 15-20% packaging reject",
            "notes": "Rejects conveyed to waste bin for disposal",
            "isOverridden": False,
            "isLocked": False,
        })

    # ══════════════════════════════════════════════════════════
    # STAGE 3: EQUALIZATION (EQ) TANK
    # ══════════════════════════════════════════════════════════
    eq_retention_days = AD_DESIGN_DEFAULTS["equalization"]["retentionTime"]["value"]
    target_eq_ts = AD_DESIGN_DEFAULTS["equalization"]["targetTS"]["value"]
    needs_dilution = avg_ts > target_eq_ts
    dilution_water_tpd = post_maceration_tpd * ((avg_ts / target_eq_ts) - 1) if needs_dilution else 0
    eq_output_tpd = post_maceration_tpd + dilution_water_tpd
    eq_output_ts = target_eq_ts if needs_dilution else avg_ts
    eq_volume_m3 = (eq_output_tpd * 1000 / 1.02) * eq_retention_days
    eq_vs_load_kg_per_day = total_vs_load_kg_per_day * (1 - reject_rate)

    if needs_dilution:
        assumptions.append({"parameter": "Dilution Water", "value": f"{_round_to(dilution_water_tpd)} tons/day added to achieve {target_eq_ts}% TS", "source": "Engineering practice"})

    eq_notes = [
        f"EQ tank volume: {_format_number(_round_to(_m3_to_gal(eq_volume_m3)))} gallons ({_round_to(eq_retention_days, 1)}-day retention)",
        "Continuous mixing for homogenization and stratification prevention",
        f"Pre-heated to {AD_DESIGN_DEFAULTS['equalization']['preheatTemp']['value']}°C via heat exchanger",
    ]
    if needs_dilution:
        eq_notes.append(f"Dilution water: {_round_to(dilution_water_tpd)} tons/day to reduce TS from {_round_to(avg_ts)}% to {target_eq_ts}%")

    eq_stage = {
        "name": "Equalization (EQ) Tank",
        "type": "equalization",
        "inputStream": {
            "feedRate": {"value": _round_to(post_maceration_tpd), "unit": "tons/day"},
            "totalSolids": {"value": _round_to(avg_ts), "unit": "%"},
            "dilutionWater": {"value": _round_to(dilution_water_tpd), "unit": "tons/day"},
        },
        "outputStream": {
            "feedRate": {"value": _round_to(eq_output_tpd), "unit": "tons/day"},
            "totalSolids": {"value": _round_to(eq_output_ts), "unit": "%"},
            "temperature": {"value": AD_DESIGN_DEFAULTS["equalization"]["preheatTemp"]["value"], "unit": "°C"},
            "vsLoad": {"value": _round_to(eq_vs_load_kg_per_day), "unit": "kg VS/day"},
        },
        "designCriteria": AD_DESIGN_DEFAULTS["equalization"],
        "notes": eq_notes,
    }
    ad_stages.append(eq_stage)

    heat_duty_kw = _round_to(eq_output_tpd * 1000 * 4.18 * (AD_DESIGN_DEFAULTS["equalization"]["preheatTemp"]["value"] - 15) / 3600, 0)

    equipment.append({
        "id": make_id("eq-tank"),
        "process": "Equalization",
        "equipmentType": "Equalization Tank",
        "description": "Insulated blending and homogenization tank with continuous mixing",
        "quantity": 1,
        "specs": {
            "volume": {"value": str(_round_to(_m3_to_gal(eq_volume_m3))), "unit": "gallons"},
            "retentionTime": {"value": str(eq_retention_days), "unit": "days"},
            "throughput": {"value": str(_round_to(eq_output_tpd)), "unit": "tons/day"},
        },
        "designBasis": f"{eq_retention_days}-day retention time for consistent digester feed",
        "notes": "Insulated concrete or steel tank with top-entry mixer",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id("eq-mixer"),
        "process": "Equalization",
        "equipmentType": "EQ Tank Mixer",
        "description": "Top-entry mechanical mixer for slurry homogenization",
        "quantity": 1,
        "specs": {
            "power": {"value": str(_round_to(eq_volume_m3 * 3 / 1000, 1)), "unit": "kW"},
            "specificPower": {"value": "3", "unit": "W/m³"},
        },
        "designBasis": "3 W/m³ mixing intensity for slurry homogenization",
        "notes": "Prevents settling and ensures consistent feed composition",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id("feed-heater"),
        "process": "Equalization",
        "equipmentType": "Feed Heat Exchanger",
        "description": "Shell-and-tube or spiral heat exchanger to pre-heat feed to mesophilic temperature",
        "quantity": 1,
        "specs": {
            "heatDuty": {"value": str(heat_duty_kw), "unit": "kW"},
            "targetTemp": {"value": str(AD_DESIGN_DEFAULTS["equalization"]["preheatTemp"]["value"]), "unit": "°C"},
            "inletTemp": {"value": "15", "unit": "°C"},
        },
        "designBasis": f"Heating from 15°C ambient to {AD_DESIGN_DEFAULTS['equalization']['preheatTemp']['value']}°C mesophilic",
        "notes": "Waste heat recovery from biogas utilization where available",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id("feed-pump"),
        "process": "Equalization",
        "equipmentType": "Digester Feed Pump",
        "description": "Progressive cavity pump for feeding slurry from EQ tank to digester",
        "quantity": 2,
        "specs": {
            "capacity": {"value": str(_round_to(_m3_per_min_to_gpm(eq_output_tpd * 1000 / 24 / 60), 1)), "unit": "gpm"},
            "headPressure": {"value": "3", "unit": "bar"},
        },
        "designBasis": "Duty + standby (N+1 redundancy)",
        "notes": "Progressive cavity type suitable for high-solids slurry",
        "isOverridden": False,
        "isLocked": False,
    })

    # ══════════════════════════════════════════════════════════
    # STAGE 4: ANAEROBIC DIGESTION (CSTR)
    # ══════════════════════════════════════════════════════════
    vs_destruction = AD_DESIGN_DEFAULTS["digester"]["vsDestruction"]["value"] / 100
    hrt = AD_DESIGN_DEFAULTS["digester"]["hrt"]["value"]
    olr = AD_DESIGN_DEFAULTS["digester"]["organicLoadingRate"]["value"]
    gas_yield = AD_DESIGN_DEFAULTS["digester"]["gasYield"]["value"]
    ch4_pct = AD_DESIGN_DEFAULTS["digester"]["ch4Content"]["value"]
    co2_pct = AD_DESIGN_DEFAULTS["digester"]["co2Content"]["value"]
    h2s_ppmv = AD_DESIGN_DEFAULTS["digester"]["h2sContent"]["value"]
    headspace_pct = AD_DESIGN_DEFAULTS["digester"]["headspacePct"]["value"] / 100

    vs_destroyed_kg_per_day = eq_vs_load_kg_per_day * vs_destruction
    biogas_m3_per_day = vs_destroyed_kg_per_day * gas_yield
    biogas_scf_per_day = biogas_m3_per_day * 35.3147
    biogas_scfm = biogas_scf_per_day / 1440
    ch4_m3_per_day = biogas_m3_per_day * (ch4_pct / 100)

    daily_feed_vol_m3 = eq_output_tpd * 1000 / 1.02
    digester_volume_by_hrt = daily_feed_vol_m3 * hrt
    digester_volume_by_olr = eq_vs_load_kg_per_day / olr
    active_digester_vol_m3 = max(digester_volume_by_hrt, digester_volume_by_olr)
    total_digester_vol_m3 = active_digester_vol_m3 * (1 + headspace_pct)
    num_digesters = 2 if total_digester_vol_m3 > 5000 else 1
    per_digester_vol = total_digester_vol_m3 / num_digesters
    actual_hrt = _round_to(active_digester_vol_m3 / daily_feed_vol_m3)
    actual_olr = _round_to(eq_vs_load_kg_per_day / active_digester_vol_m3, 2)

    assumptions.append({"parameter": "VS Destruction", "value": f"{_round_to(vs_destruction * 100)}%", "source": "WEF MOP 8"})
    assumptions.append({"parameter": "Biogas Yield", "value": f"{_round_to(gas_yield * 35.3147 / 2.2046, 2)} scf/lb VS destroyed", "source": "Engineering practice"})
    assumptions.append({"parameter": "Biogas CH₄", "value": f"{ch4_pct}%", "source": "Typical AD biogas"})
    assumptions.append({"parameter": "HRT", "value": f"{hrt} days", "source": "WEF MOP 8"})

    if avg_cn < 15:
        warnings.append({"field": "C:N Ratio", "message": f"Blended C:N ratio of {_round_to(avg_cn)} is low (< 15). Consider adding carbon-rich co-substrates to avoid ammonia inhibition.", "severity": "warning"})
    elif avg_cn > 35:
        warnings.append({"field": "C:N Ratio", "message": f"Blended C:N ratio of {_round_to(avg_cn)} is high (> 35). Consider adding nitrogen-rich co-substrates for optimal digestion.", "severity": "warning"})

    digestate_tpd = eq_output_tpd * (1 - vs_destruction * (eq_output_ts / 100) * (avg_vs / 100))

    digester_stage = {
        "name": "Anaerobic Digestion (CSTR)",
        "type": "digester",
        "inputStream": {
            "feedRate": {"value": _round_to(eq_output_tpd), "unit": "tons/day"},
            "vsLoad": {"value": _round_to(eq_vs_load_kg_per_day), "unit": "kg VS/day"},
            "totalSolids": {"value": _round_to(eq_output_ts), "unit": "%"},
            "temperature": {"value": AD_DESIGN_DEFAULTS["equalization"]["preheatTemp"]["value"], "unit": "°C"},
        },
        "outputStream": {
            "biogasFlow": {"value": _round_to(biogas_scf_per_day), "unit": "scfd"},
            "biogasFlowSCFM": {"value": _round_to(biogas_scfm), "unit": "scfm"},
            "ch4Content": {"value": ch4_pct, "unit": "%"},
            "co2Content": {"value": co2_pct, "unit": "%"},
            "h2sContent": {"value": h2s_ppmv, "unit": "ppmv"},
            "vsDestroyed": {"value": _round_to(vs_destroyed_kg_per_day), "unit": "kg/day"},
            "digestateFlow": {"value": _round_to(digestate_tpd), "unit": "tons/day"},
        },
        "designCriteria": AD_DESIGN_DEFAULTS["digester"],
        "notes": [
            f"{num_digesters} CSTR digester(s) at {_format_number(_round_to(_m3_to_gal(per_digester_vol)))} gallons each (including {_round_to(headspace_pct * 100)}% headspace)",
            f"Active volume: {_format_number(_round_to(_m3_to_gal(active_digester_vol_m3)))} gallons",
            f"Actual OLR: {actual_olr} kg VS/m³·d",
            f"Actual HRT: {actual_hrt} days",
        ],
    }
    ad_stages.append(digester_stage)

    equipment.append({
        "id": make_id("cstr-digester"),
        "process": "Anaerobic Digestion",
        "equipmentType": "CSTR Digester",
        "description": "Continuously Stirred Tank Reactor, mesophilic operation with gas collection dome",
        "quantity": num_digesters,
        "specs": {
            "volume": {"value": str(_round_to(_m3_to_gal(per_digester_vol))), "unit": "gallons"},
            "activeVolume": {"value": str(_round_to(_m3_to_gal(active_digester_vol_m3 / num_digesters))), "unit": "gallons"},
            "totalVolume": {"value": str(_round_to(_m3_to_gal(total_digester_vol_m3))), "unit": "gallons"},
            "hrt": {"value": str(actual_hrt), "unit": "days"},
            "olr": {"value": str(actual_olr), "unit": "kg VS/m³·d"},
            "temperature": {"value": "37", "unit": "°C"},
        },
        "designBasis": f"{hrt}-day HRT, OLR ≤ {olr} kg VS/m³·d, {_round_to(headspace_pct * 100)}% headspace",
        "notes": "Includes gas collection dome, internal heating coils, and insulation",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id("digester-mixer"),
        "process": "Anaerobic Digestion",
        "equipmentType": "Digester Mixer",
        "description": "Mechanical mixing system for digester contents",
        "quantity": num_digesters,
        "specs": {
            "power": {"value": str(_round_to(AD_DESIGN_DEFAULTS["digester"]["mixingPower"]["value"] * (active_digester_vol_m3 / num_digesters) / 1000, 1)), "unit": "kW"},
            "specificPower": {"value": str(AD_DESIGN_DEFAULTS["digester"]["mixingPower"]["value"]), "unit": "W/m³"},
        },
        "designBasis": f"{AD_DESIGN_DEFAULTS['digester']['mixingPower']['value']} W/m³ mixing intensity",
        "notes": "Draft tube or top-entry mechanical mixer",
        "isOverridden": False,
        "isLocked": False,
    })

    # ══════════════════════════════════════════════════════════
    # STAGE 5: SOLIDS-LIQUID SEPARATION (CENTRIFUGE)
    # ══════════════════════════════════════════════════════════
    cent_solids_capture_eff = AD_DESIGN_DEFAULTS["centrifuge"]["solidsCaptureEff"]["value"] / 100
    cent_cake_solids_pct = AD_DESIGN_DEFAULTS["centrifuge"]["cakeSolids"]["value"]
    digestate_ts = eq_output_ts * (1 - vs_destruction * (avg_vs / 100))
    digestate_ts_kg_per_day = digestate_tpd * 1000 * (digestate_ts / 100)
    cake_solids_kg_per_day = digestate_ts_kg_per_day * cent_solids_capture_eff
    cake_tpd = cake_solids_kg_per_day / (cent_cake_solids_pct / 100) / 1000
    centrate_tpd = digestate_tpd - cake_tpd
    centrate_tss_mg_l = digestate_ts_kg_per_day * (1 - cent_solids_capture_eff) / (centrate_tpd * 1000) * 1_000_000

    assumptions.append({"parameter": "Centrifuge Solids Capture", "value": f"{_round_to(cent_solids_capture_eff * 100)}%", "source": "Decanter centrifuge typical"})
    assumptions.append({"parameter": "Cake Solids", "value": f"{cent_cake_solids_pct}% TS", "source": "Decanter centrifuge typical"})

    centrifuge_stage = {
        "name": "Solids-Liquid Separation (Centrifuge)",
        "type": "solidsSeparation",
        "inputStream": {
            "digestateFlow": {"value": _round_to(digestate_tpd), "unit": "tons/day"},
            "digestateTS": {"value": _round_to(digestate_ts), "unit": "% TS"},
        },
        "outputStream": {
            "cakeFlow": {"value": _round_to(cake_tpd), "unit": "tons/day"},
            "cakeSolids": {"value": cent_cake_solids_pct, "unit": "% TS"},
            "centrateFlow": {"value": _round_to(centrate_tpd), "unit": "tons/day"},
            "centrateTSS": {"value": _round_to(centrate_tss_mg_l, 0), "unit": "mg/L"},
        },
        "designCriteria": AD_DESIGN_DEFAULTS["centrifuge"],
        "notes": [
            "Decanter centrifuge for digestate dewatering",
            f"Cake: {_round_to(cake_tpd)} tons/day at {cent_cake_solids_pct}% TS — conveyed to storage/hauling",
            f"Centrate: {_round_to(centrate_tpd)} tons/day — sent to DAF for liquid cleanup",
            f"Polymer conditioning: {AD_DESIGN_DEFAULTS['centrifuge']['polymerDose']['value']} kg/ton dry solids",
        ],
    }
    ad_stages.append(centrifuge_stage)

    equipment.append({
        "id": make_id("decanter-centrifuge"),
        "process": "Solids-Liquid Separation",
        "equipmentType": "Decanter Centrifuge",
        "description": "High-speed decanter centrifuge for digestate dewatering",
        "quantity": 1,
        "specs": {
            "capacity": {"value": str(_round_to(digestate_tpd)), "unit": "tons/day"},
            "solidsCaptureEff": {"value": str(_round_to(cent_solids_capture_eff * 100)), "unit": "%"},
            "cakeSolids": {"value": str(cent_cake_solids_pct), "unit": "% TS"},
            "polymerDose": {"value": str(AD_DESIGN_DEFAULTS["centrifuge"]["polymerDose"]["value"]), "unit": "kg/ton DS"},
        },
        "designBasis": f"{_round_to(cent_solids_capture_eff * 100)}% solids capture, {cent_cake_solids_pct}% cake solids",
        "notes": "Includes polymer make-down and dosing system",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id("cake-conveyor"),
        "process": "Solids-Liquid Separation",
        "equipmentType": "Cake Conveyor & Storage",
        "description": "Screw conveyor from centrifuge to cake storage bin for truck loadout",
        "quantity": 1,
        "specs": {
            "capacity": {"value": str(_round_to(cake_tpd)), "unit": "tons/day"},
            "storageVolume": {"value": str(_round_to(_m3_to_gal(cake_tpd * 3 / 1.1))), "unit": "gallons"},
        },
        "designBasis": "3-day cake storage capacity",
        "notes": "Covered storage with truck loadout capability",
        "isOverridden": False,
        "isLocked": False,
    })

    # ══════════════════════════════════════════════════════════
    # STAGE 6: LIQUID CLEANUP — DISSOLVED AIR FLOTATION (DAF)
    # ══════════════════════════════════════════════════════════
    daf_tss_removal = AD_DESIGN_DEFAULTS["daf"]["tssRemoval"]["value"] / 100
    daf_fog_removal = AD_DESIGN_DEFAULTS["daf"]["fogRemoval"]["value"] / 100
    centrate_flow_gpd = centrate_tpd * 1000 / 3.785
    centrate_flow_gpm = centrate_flow_gpd / 1440
    daf_surface_area_ft2 = centrate_flow_gpm / AD_DESIGN_DEFAULTS["daf"]["hydraulicLoading"]["value"]
    daf_effluent_tss_mg_l = centrate_tss_mg_l * (1 - daf_tss_removal)
    daf_float_tpd = centrate_tpd * 0.03
    daf_effluent_tpd = centrate_tpd - daf_float_tpd
    daf_effluent_gpd = _round_to(daf_effluent_tpd * 1000 / 3.785, 0)

    daf_stage = {
        "name": "Liquid Cleanup — Dissolved Air Flotation (DAF)",
        "type": "daf",
        "inputStream": {
            "centrateFlow": {"value": _round_to(centrate_tpd), "unit": "tons/day"},
            "centrateFlowGPD": {"value": _round_to(centrate_flow_gpd, 0), "unit": "GPD"},
            "centrateTSS": {"value": _round_to(centrate_tss_mg_l, 0), "unit": "mg/L"},
        },
        "outputStream": {
            "effluentFlow": {"value": _round_to(daf_effluent_tpd), "unit": "tons/day"},
            "effluentFlowGPD": {"value": daf_effluent_gpd, "unit": "GPD"},
            "effluentTSS": {"value": _round_to(daf_effluent_tss_mg_l, 0), "unit": "mg/L"},
            "floatSludge": {"value": _round_to(daf_float_tpd), "unit": "tons/day"},
        },
        "designCriteria": AD_DESIGN_DEFAULTS["daf"],
        "notes": [
            f"TSS removal: {_round_to(daf_tss_removal * 100)}% ({_round_to(centrate_tss_mg_l, 0)} → {_round_to(daf_effluent_tss_mg_l, 0)} mg/L)",
            f"FOG removal: {_round_to(daf_fog_removal * 100)}%",
            "Chemical conditioning: coagulant (FeCl₃ or alum) + polymer",
            f"Float sludge ({_round_to(daf_float_tpd)} tons/day) recycled to digester",
            "DAF effluent suitable for sewer discharge or irrigation",
        ],
    }
    ad_stages.append(daf_stage)

    equipment.append({
        "id": make_id("daf-unit"),
        "process": "Liquid Cleanup",
        "equipmentType": "Dissolved Air Flotation (DAF) Unit",
        "description": "DAF system for centrate polishing — removes residual TSS, FOG, and colloidal organics",
        "quantity": 1,
        "specs": {
            "surfaceArea": {"value": str(_round_to(daf_surface_area_ft2)), "unit": "ft²"},
            "hydraulicLoading": {"value": str(AD_DESIGN_DEFAULTS["daf"]["hydraulicLoading"]["value"]), "unit": "gpm/ft²"},
            "designFlow": {"value": str(_round_to(centrate_flow_gpm, 1)), "unit": "gpm"},
            "tssRemoval": {"value": str(_round_to(daf_tss_removal * 100)), "unit": "%"},
            "fogRemoval": {"value": str(_round_to(daf_fog_removal * 100)), "unit": "%"},
        },
        "designBasis": f"{AD_DESIGN_DEFAULTS['daf']['hydraulicLoading']['value']} gpm/ft² hydraulic loading rate",
        "notes": "Includes recycle pump, saturator, chemical feed system (coagulant + polymer)",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id("centrate-tank"),
        "process": "Liquid Cleanup",
        "equipmentType": "Centrate Collection Tank",
        "description": "Holding tank for centrate equalization before DAF treatment",
        "quantity": 1,
        "specs": {
            "volume": {"value": str(_round_to(centrate_tpd * 1000 / 1.0 * 0.5 * 0.264172)), "unit": "gallons"},
            "retentionTime": {"value": "0.5", "unit": "days"},
        },
        "designBasis": "0.5-day equalization for consistent DAF feed",
        "notes": "Level-controlled pump to DAF unit",
        "isOverridden": False,
        "isLocked": False,
    })

    # ══════════════════════════════════════════════════════════
    # STAGE 7: BIOGAS CONDITIONING
    # ══════════════════════════════════════════════════════════
    h2s_removal_eff = AD_DESIGN_DEFAULTS["gasConditioning"]["h2sRemovalEff"]["value"] / 100
    out_h2s_ppmv = h2s_ppmv * (1 - h2s_removal_eff)
    volume_loss_pct = AD_DESIGN_DEFAULTS["gasConditioning"]["volumeLoss"]["value"] / 100
    conditioned_biogas_m3_per_day = biogas_m3_per_day * (1 - volume_loss_pct)

    conditioning_stage = {
        "name": "Biogas Conditioning",
        "type": "gasConditioning",
        "inputStream": {
            "biogasFlow": {"value": _round_to(biogas_scf_per_day), "unit": "scfd"},
            "biogasFlowSCFM": {"value": _round_to(biogas_scfm), "unit": "scfm"},
            "ch4Content": {"value": ch4_pct, "unit": "%"},
            "h2sContent": {"value": h2s_ppmv, "unit": "ppmv"},
        },
        "outputStream": {
            "biogasFlow": {"value": _round_to(_m3_to_scf(conditioned_biogas_m3_per_day)), "unit": "scfd"},
            "ch4Content": {"value": ch4_pct, "unit": "%"},
            "h2sContent": {"value": _round_to(out_h2s_ppmv, 1), "unit": "ppmv"},
            "moisture": {"value": 0, "unit": "saturated → dry"},
        },
        "designCriteria": AD_DESIGN_DEFAULTS["gasConditioning"],
        "notes": [
            f"H₂S removal: {h2s_ppmv} → {_round_to(out_h2s_ppmv, 1)} ppmv ({_round_to(h2s_removal_eff * 100)}% removal)",
            "Moisture removal via chiller and desiccant dryer to -40°F dewpoint",
            "Siloxane removal via activated carbon (if applicable)",
        ],
    }
    ad_stages.append(conditioning_stage)

    if h2s_ppmv > 5000:
        h2s_desc = "Chemical scrubber for high-H₂S biogas"
    elif h2s_ppmv > 500:
        h2s_desc = "Biological scrubber for hydrogen sulfide removal"
    else:
        h2s_desc = "Iron sponge for hydrogen sulfide removal"

    equipment.append({
        "id": make_id("h2s-scrubber"),
        "process": "Biogas Conditioning",
        "equipmentType": "H₂S Removal System",
        "description": h2s_desc,
        "quantity": 1,
        "specs": {
            "inletH2S": {"value": str(h2s_ppmv), "unit": "ppmv"},
            "outletH2S": {"value": str(_round_to(out_h2s_ppmv, 1)), "unit": "ppmv"},
            "removalEff": {"value": "99.5", "unit": "%"},
            "gasFlow": {"value": str(_round_to(biogas_scfm)), "unit": "scfm"},
        },
        "designBasis": "99.5% H₂S removal to < 10 ppmv",
        "notes": "Includes media replacement schedule and monitoring",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id("biogas-blower"),
        "process": "Biogas Conditioning",
        "equipmentType": "Biogas Blower",
        "description": "Positive displacement blower for biogas transport through conditioning train",
        "quantity": 2,
        "specs": {
            "gasFlow": {"value": str(_round_to(biogas_scfm)), "unit": "scfm"},
            "pressure": {"value": "2", "unit": "psig"},
            "power": {"value": str(_round_to(biogas_scfm * 0.1, 1)), "unit": "kW"},
        },
        "designBasis": "Duty + standby (N+1 redundancy)",
        "notes": "Low-pressure transport of biogas through conditioning equipment",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id("gas-chiller"),
        "process": "Biogas Conditioning",
        "equipmentType": "Gas Chiller/Dryer",
        "description": "Refrigerated chiller and desiccant dryer for moisture removal",
        "quantity": 1,
        "specs": {
            "gasFlow": {"value": str(_round_to(biogas_scfm)), "unit": "scfm"},
            "outletDewpoint": {"value": "-40", "unit": "°F"},
        },
        "designBasis": "Reduce moisture to pipeline specifications",
        "notes": "Condensate drainage to plant drain",
        "isOverridden": False,
        "isLocked": False,
    })

    # ══════════════════════════════════════════════════════════
    # STAGE 8: GAS UPGRADING TO RNG
    # ══════════════════════════════════════════════════════════
    methane_recovery = AD_DESIGN_DEFAULTS["gasUpgrading"]["methaneRecovery"]["value"] / 100
    product_ch4 = AD_DESIGN_DEFAULTS["gasUpgrading"]["productCH4"]["value"]
    rng_ch4_m3_per_day = ch4_m3_per_day * methane_recovery
    rng_m3_per_day = rng_ch4_m3_per_day / (product_ch4 / 100)
    rng_scf_per_day = rng_m3_per_day * 35.3147
    rng_scfm = rng_scf_per_day / 1440
    rng_mmbtu_per_day = rng_scf_per_day * 1012 / 1_000_000
    tailgas_m3_per_day = conditioned_biogas_m3_per_day - rng_m3_per_day
    biogas_scfd_total = biogas_m3_per_day * 35.3147
    electrical_demand_kw = biogas_scfd_total * AD_DESIGN_DEFAULTS["gasUpgrading"]["electricalDemand"]["value"] / (1000 * 24)

    upgrading_stage = {
        "name": "Gas Upgrading to RNG",
        "type": "gasUpgrading",
        "inputStream": {
            "biogasFlow": {"value": _round_to(_m3_to_scf(conditioned_biogas_m3_per_day)), "unit": "scfd"},
            "ch4Content": {"value": ch4_pct, "unit": "%"},
        },
        "outputStream": {
            "rngFlow": {"value": _round_to(rng_scf_per_day), "unit": "scfd"},
            "rngFlowSCFM": {"value": _round_to(rng_scfm), "unit": "scfm"},
            "rngCH4": {"value": product_ch4, "unit": "%"},
            "rngEnergy": {"value": _round_to(rng_mmbtu_per_day, 1), "unit": "MMBtu/day"},
            "tailgasFlow": {"value": _round_to(_m3_to_scf(tailgas_m3_per_day)), "unit": "scfd"},
            "methaneRecovery": {"value": _round_to(methane_recovery * 100), "unit": "%"},
        },
        "designCriteria": AD_DESIGN_DEFAULTS["gasUpgrading"],
        "notes": [
            "Membrane or PSA upgrading system",
            f"Tail gas: {_round_to(_m3_to_scf(tailgas_m3_per_day))} scfd → thermal oxidizer or flare",
            f"Electrical demand: {_round_to(electrical_demand_kw)} kW",
            f"RNG energy output: {_round_to(rng_mmbtu_per_day, 1)} MMBTU/day",
        ],
    }
    ad_stages.append(upgrading_stage)

    equipment.append({
        "id": make_id("membrane-psa"),
        "process": "Gas Upgrading",
        "equipmentType": "Membrane/PSA Upgrading System",
        "description": "Multi-stage membrane or pressure swing adsorption system for CO₂ removal",
        "quantity": 1,
        "specs": {
            "inletFlow": {"value": str(_round_to(biogas_scfm)), "unit": "scfm"},
            "productFlow": {"value": str(_round_to(rng_scfm)), "unit": "scfm"},
            "productCH4": {"value": str(product_ch4), "unit": "%"},
            "methaneRecovery": {"value": "97", "unit": "%"},
        },
        "designBasis": "97% methane recovery, pipeline quality RNG (≥96% CH₄)",
        "notes": "Includes monitoring and control system",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id("rng-compressor"),
        "process": "Gas Upgrading",
        "equipmentType": "RNG Compressor",
        "description": "Multi-stage compressor for pipeline injection pressure",
        "quantity": 1,
        "specs": {
            "flow": {"value": str(_round_to(rng_scfm)), "unit": "scfm"},
            "dischargePressure": {"value": str(AD_DESIGN_DEFAULTS["gasUpgrading"]["pressureOut"]["value"]), "unit": "psig"},
            "power": {"value": str(_round_to(electrical_demand_kw * 0.6)), "unit": "kW"},
        },
        "designBasis": f"Pipeline injection at {AD_DESIGN_DEFAULTS['gasUpgrading']['pressureOut']['value']} psig",
        "notes": "Includes aftercooler and moisture knockout",
        "isOverridden": False,
        "isLocked": False,
    })

    # ══════════════════════════════════════════════════════════
    # STAGE 9: EMERGENCY GAS MANAGEMENT
    # ══════════════════════════════════════════════════════════
    equipment.append({
        "id": make_id("enclosed-flare"),
        "process": "Gas Management",
        "equipmentType": "Enclosed Flare",
        "description": "Enclosed ground flare for excess biogas and tail gas combustion",
        "quantity": 1,
        "specs": {
            "capacity": {"value": str(_round_to(biogas_scfm * 1.1)), "unit": "scfm"},
            "destructionEff": {"value": "99.5", "unit": "%"},
        },
        "designBasis": "110% of maximum biogas production",
        "notes": "Required for startup, upset, and maintenance periods",
        "isOverridden": False,
        "isLocked": False,
    })

    # ══════════════════════════════════════════════════════════
    # RECYCLE STREAMS
    # ══════════════════════════════════════════════════════════
    recycle_streams = [
        {
            "name": "DAF Float Recycle",
            "source": "DAF",
            "destination": "Digester",
            "flow": _round_to(daf_float_tpd),
            "loads": {"TSS": _round_to(daf_float_tpd * 1000 * 0.05)},
        },
    ]

    # ══════════════════════════════════════════════════════════
    # SUMMARY
    # ══════════════════════════════════════════════════════════
    digester_vol_gallons = total_digester_vol_m3 * 264.172

    summary = {
        "totalFeedRate": {"value": _format_number(_round_to(total_feed_tpd)), "unit": "tons/day"},
        "totalVSLoad": {"value": _format_number(_round_to(eq_vs_load_kg_per_day)), "unit": "kg VS/day"},
        "biogasProduction": {"value": _format_number(_round_to(biogas_scfm)), "unit": "scfm"},
        "methaneProduction": {"value": _format_number(_round_to(biogas_scfm * ch4_pct / 100)), "unit": "scfm CH₄"},
        "rngEnergy": {"value": _format_number(_round_to(rng_mmbtu_per_day, 1)), "unit": "MMBTU/day"},
        "rngFlowSCFM": {"value": _format_number(_round_to(rng_scfm)), "unit": "scfm"},
        "digesterVolume": {"value": _format_number(_round_to(digester_vol_gallons, 0)), "unit": "gallons"},
        "hrt": {"value": str(actual_hrt), "unit": "days"},
        "vsDestruction": {"value": f"{_round_to(vs_destruction * 100)}", "unit": "%"},
        "solidDigestate": {"value": _format_number(_round_to(cake_tpd)), "unit": "tons/day"},
        "dafEffluent": {"value": _format_number(daf_effluent_gpd), "unit": "GPD"},
        "electricalDemand": {"value": _format_number(_round_to(electrical_demand_kw)), "unit": "kW"},
    }

    return {
        "projectType": "B",
        "stages": [],
        "adStages": ad_stages,
        "recycleStreams": recycle_streams,
        "equipment": equipment,
        "convergenceIterations": 1,
        "convergenceAchieved": True,
        "assumptions": assumptions,
        "warnings": warnings,
        "summary": summary,
    }
