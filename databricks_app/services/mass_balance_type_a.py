import math
import re

CONVERGENCE_TOLERANCE = 0.01
MAX_ITERATIONS = 10

DEFAULT_REMOVAL_EFFICIENCIES = {
    "preliminary": {"bod": 0.05, "cod": 0.05, "tss": 0.05, "fog": 0.30, "tkn": 0, "tp": 0},
    "primary": {"bod": 0.30, "cod": 0.30, "tss": 0.55, "fog": 0.65, "tkn": 0.10, "tp": 0.10},
    "activated_sludge": {"bod": 0.90, "cod": 0.85, "tss": 0.88, "fog": 0.90, "tkn": 0.30, "tp": 0.25},
    "mbr": {"bod": 0.95, "cod": 0.92, "tss": 0.99, "fog": 0.95, "tkn": 0.40, "tp": 0.30},
    "trickling_filter": {"bod": 0.80, "cod": 0.75, "tss": 0.80, "fog": 0.80, "tkn": 0.20, "tp": 0.15},
    "nitrification": {"bod": 0.10, "cod": 0.10, "tss": 0.05, "fog": 0, "tkn": 0.85, "tp": 0.05},
    "denitrification": {"bod": 0.05, "cod": 0.10, "tss": 0.05, "fog": 0, "tkn": 0.20, "tp": 0.10},
    "chemical_phosphorus": {"bod": 0, "cod": 0.05, "tss": 0.10, "fog": 0, "tkn": 0, "tp": 0.85},
    "tertiary_filtration": {"bod": 0.30, "cod": 0.25, "tss": 0.70, "fog": 0.30, "tkn": 0.05, "tp": 0.20},
    "disinfection": {"bod": 0, "cod": 0, "tss": 0, "fog": 0, "tkn": 0, "tp": 0},
}

DEFAULT_DESIGN_CRITERIA = {
    "preliminary": {
        "screenBarSpacing": {"value": 6, "unit": "mm", "source": "WEF MOP 8"},
        "channelVelocity": {"value": 0.9, "unit": "m/s", "source": "WEF MOP 8"},
        "gritRemovalDetentionTime": {"value": 3, "unit": "min", "source": "Ten States Standards"},
    },
    "primary": {
        "detentionTime": {"value": 2, "unit": "hr", "source": "Ten States Standards"},
        "surfaceOverflowRate": {"value": 800, "unit": "gpd/sf", "source": "Ten States Standards"},
        "weirLoadingRate": {"value": 10000, "unit": "gpd/lf", "source": "Ten States Standards"},
        "sidewaterDepth": {"value": 12, "unit": "ft", "source": "WEF MOP 8"},
    },
    "activated_sludge": {
        "srt": {"value": 10, "unit": "days", "source": "WEF MOP 8"},
        "hrt": {"value": 6, "unit": "hr", "source": "WEF MOP 8"},
        "mlss": {"value": 3000, "unit": "mg/L", "source": "WEF MOP 8"},
        "fmRatio": {"value": 0.3, "unit": "lb BOD/lb MLSS\u00b7d", "source": "WEF MOP 8"},
        "oxygenDemand": {"value": 1.5, "unit": "lb O\u2082/lb BOD", "source": "WEF MOP 8"},
        "oxygenTransferEfficiency": {"value": 0.25, "unit": "fraction", "source": "WEF MOP 8"},
        "safetyFactor": {"value": 1.5, "unit": "multiplier", "source": "Engineering practice"},
        "secondaryClarifierSOR": {"value": 600, "unit": "gpd/sf", "source": "Ten States Standards"},
        "secondaryClarifierSLR": {"value": 25, "unit": "lb/sf\u00b7d", "source": "Ten States Standards"},
        "secondaryClarifierDepth": {"value": 14, "unit": "ft", "source": "WEF MOP 8"},
        "rasRatio": {"value": 0.5, "unit": "fraction", "source": "WEF MOP 8"},
    },
    "mbr": {
        "srt": {"value": 15, "unit": "days", "source": "WEF MOP 8"},
        "hrt": {"value": 8, "unit": "hr", "source": "Membrane manufacturer"},
        "mlss": {"value": 8000, "unit": "mg/L", "source": "Membrane manufacturer"},
        "membraneFlux": {"value": 15, "unit": "gfd", "source": "Membrane manufacturer"},
        "oxygenDemand": {"value": 1.8, "unit": "lb O\u2082/lb BOD", "source": "WEF MOP 8"},
        "oxygenTransferEfficiency": {"value": 0.20, "unit": "fraction", "source": "WEF MOP 8"},
        "safetyFactor": {"value": 1.5, "unit": "multiplier", "source": "Engineering practice"},
    },
    "tertiary_filtration": {
        "filtrationRate": {"value": 5, "unit": "gpm/sf", "source": "Ten States Standards"},
        "backwashRate": {"value": 15, "unit": "gpm/sf", "source": "WEF MOP 8"},
        "mediaDepth": {"value": 24, "unit": "in", "source": "WEF MOP 8"},
    },
    "disinfection": {
        "contactTime": {"value": 30, "unit": "min", "source": "State regulation"},
        "chlorineDose": {"value": 8, "unit": "mg/L", "source": "WEF MOP 8"},
        "uvDose": {"value": 40, "unit": "mJ/cm\u00b2", "source": "NWRI Guidelines"},
    },
    "equalization": {
        "detentionTime": {"value": 8, "unit": "hr", "source": "WEF MOP 8"},
        "peakFactor": {"value": 2.5, "unit": "multiplier", "source": "Engineering practice"},
    },
}


def _parse_flow_mgd(upif: dict) -> float:
    feedstocks = upif.get("feedstocks") or []
    for fs in feedstocks:
        specs = fs.get("feedstockSpecs") or {}
        for spec in specs.values():
            unit_lower = spec.get("unit", "").lower()
            raw_val = str(spec.get("value", "")).replace(",", "")
            try:
                num_val = float(raw_val)
            except (ValueError, TypeError):
                continue
            if unit_lower == "mgd" or "million gallons" in unit_lower:
                return num_val
            if unit_lower == "gpd" or "gallons per day" in unit_lower:
                return num_val / 1_000_000
            if unit_lower == "gpm" or "gallons per minute" in unit_lower:
                return (num_val * 1440) / 1_000_000
            if "m\u00b3/d" in unit_lower or "m3/d" in unit_lower:
                return num_val * 0.000264172
        vol_str = fs.get("feedstockVolume") or ""
        vol_raw = str(vol_str).replace(",", "")
        unit_lower = (fs.get("feedstockUnit") or "").lower()
        try:
            vol_num = float(vol_raw)
        except (ValueError, TypeError):
            vol_num = float("nan")
        if not math.isnan(vol_num):
            if unit_lower == "mgd":
                return vol_num
            if unit_lower == "gpd":
                return vol_num / 1_000_000
            if unit_lower == "gpm":
                return (vol_num * 1440) / 1_000_000
    return 1.0


def _parse_analyte(upif: dict, analyte_name: str, default_value: float) -> float:
    feedstocks = upif.get("feedstocks") or []
    patterns = [analyte_name.lower()]
    if analyte_name == "BOD":
        patterns.extend(["biochemical oxygen demand", "bod5"])
    if analyte_name == "COD":
        patterns.append("chemical oxygen demand")
    if analyte_name == "TSS":
        patterns.append("total suspended solids")
    if analyte_name == "FOG":
        patterns.extend(["fats oils grease", "oil and grease", "o&g"])
    if analyte_name == "TKN":
        patterns.append("total kjeldahl nitrogen")
    if analyte_name == "TP":
        patterns.extend(["total phosphorus", "phosphorus"])

    for fs in feedstocks:
        specs = fs.get("feedstockSpecs") or {}
        for spec in specs.values():
            name_lower = spec.get("displayName", "").lower()
            unit_lower = spec.get("unit", "").lower()
            if any(p in name_lower for p in patterns) and "mg/l" in unit_lower:
                raw = str(spec.get("value", "")).replace(",", "")
                try:
                    val = float(raw)
                    return val
                except (ValueError, TypeError):
                    pass
    return default_value


def _parse_effluent_target(upif: dict, analyte_name: str):
    output_specs = upif.get("outputSpecs")
    if not output_specs:
        return None
    effluent_profile = "Liquid Effluent - Discharge to WWTP"
    specs = output_specs.get(effluent_profile)
    if not specs:
        return None
    target = analyte_name.lower()
    for spec in specs.values():
        display_lower = (spec.get("displayName") or "").lower()
        if target in display_lower and "mg/l" in (spec.get("unit") or "").lower():
            cleaned = re.sub(r"[<>\u2264\u2265,]", "", str(spec.get("value", "")))
            try:
                val = float(cleaned)
                return val
            except (ValueError, TypeError):
                pass
    return None


def _determine_treatment_train(upif: dict) -> list:
    location = (upif.get("location") or "").lower()
    constraints_list = upif.get("constraints") or []
    constraints = " ".join(c.lower() for c in constraints_list)
    output_reqs = (upif.get("outputRequirements") or "").lower()
    all_text = f"{location} {constraints} {output_reqs}"

    stages = ["preliminary", "equalization", "primary"]

    if "mbr" in all_text or "membrane" in all_text:
        stages.append("mbr")
    elif "trickling" in all_text or "rotating" in all_text:
        stages.append("trickling_filter")
    else:
        stages.append("activated_sludge")

    eff_bod = _parse_effluent_target(upif, "bod")
    eff_tss = _parse_effluent_target(upif, "tss")
    if ((eff_bod is not None and eff_bod <= 10)
            or (eff_tss is not None and eff_tss <= 10)
            or "tertiary" in all_text
            or "filtration" in all_text):
        stages.append("tertiary_filtration")

    eff_tkn = _parse_effluent_target(upif, "tkn")
    eff_nh3 = _parse_effluent_target(upif, "nh3")
    if ((eff_tkn is not None and eff_tkn <= 10)
            or (eff_nh3 is not None and eff_nh3 <= 5)
            or "nitrif" in all_text
            or "nitrogen" in all_text):
        if "mbr" not in stages:
            stages.append("nitrification")
        if ("denitrif" in all_text
                or "total nitrogen" in all_text
                or (eff_tkn is not None and eff_tkn <= 5)):
            stages.append("denitrification")

    eff_tp = _parse_effluent_target(upif, "tp")
    if (eff_tp is not None and eff_tp <= 1) or "phosphorus removal" in all_text:
        stages.append("chemical_phosphorus")

    stages.append("disinfection")
    return stages


def _apply_removal(influent: dict, efficiencies: dict) -> dict:
    return {
        "flow": influent["flow"],
        "bod": influent["bod"] * (1 - efficiencies.get("bod", 0)),
        "cod": influent["cod"] * (1 - efficiencies.get("cod", 0)),
        "tss": influent["tss"] * (1 - efficiencies.get("tss", 0)),
        "tkn": influent["tkn"] * (1 - efficiencies.get("tkn", 0)),
        "tp": influent["tp"] * (1 - efficiencies.get("tp", 0)),
        "fog": influent["fog"] * (1 - efficiencies.get("fog", 0)),
        "nh3": (influent["nh3"] * (1 - efficiencies.get("tkn", 0))
                if influent.get("nh3") is not None else None),
        "no3": influent.get("no3"),
        "unit": "mg/L",
    }


def _round_to(val: float, decimals: int = 1) -> float:
    factor = 10 ** decimals
    return round(val * factor) / factor


def _round_stream(s: dict) -> dict:
    return {
        "flow": _round_to(s["flow"], 4),
        "bod": _round_to(s["bod"]),
        "cod": _round_to(s["cod"]),
        "tss": _round_to(s["tss"]),
        "tkn": _round_to(s["tkn"]),
        "tp": _round_to(s["tp"], 2),
        "fog": _round_to(s["fog"]),
        "nh3": _round_to(s["nh3"]) if s.get("nh3") is not None else None,
        "no3": _round_to(s["no3"]) if s.get("no3") is not None else None,
        "unit": s.get("unit"),
    }


def _calculate_recycle_streams(stages: list, flow_mgd: float) -> list:
    recycle_streams = []

    has_as = any(s["type"] in ("activated_sludge", "mbr") for s in stages)
    if has_as:
        ras_flow = flow_mgd * 0.5
        recycle_streams.append({
            "name": "Return Activated Sludge (RAS)",
            "source": "Secondary Clarifier",
            "destination": "Aeration Basin",
            "flow": _round_to(ras_flow, 4),
            "loads": {"tss": _round_to(8000 * ras_flow * 8.34)},
        })

        was_flow = flow_mgd * 0.01
        recycle_streams.append({
            "name": "Waste Activated Sludge (WAS)",
            "source": "Secondary Clarifier",
            "destination": "Sludge Processing",
            "flow": _round_to(was_flow, 4),
            "loads": {"tss": _round_to(10000 * was_flow * 8.34)},
        })

    has_tertiary = any(s["type"] == "tertiary_filtration" for s in stages)
    if has_tertiary:
        backwash_flow = flow_mgd * 0.03
        recycle_streams.append({
            "name": "Filter Backwash",
            "source": "Tertiary Filters",
            "destination": "Plant Headworks",
            "flow": _round_to(backwash_flow, 4),
            "loads": {"tss": _round_to(200 * backwash_flow * 8.34)},
        })

    return recycle_streams


def _get_criterion_value(criteria: dict, key: str, default):
    entry = criteria.get(key)
    if entry is not None and isinstance(entry, dict):
        return entry.get("value", default)
    return default


def _size_equipment(stages: list, flow_mgd: float, influent: dict) -> list:
    equipment = []
    flow_gpd = flow_mgd * 1_000_000
    flow_gpm = flow_gpd / 1440
    peak_flow_gpm = flow_gpm * 2.5
    eq_id = [1]

    def make_id():
        eid = f"eq-{eq_id[0]}"
        eq_id[0] += 1
        return eid

    for stage in stages:
        criteria = stage.get("designCriteria", {})

        if stage["type"] == "preliminary":
            bar_spacing = _get_criterion_value(criteria, "screenBarSpacing", 6)
            channel_vel = _get_criterion_value(criteria, "channelVelocity", 0.9)
            grit_dt = _get_criterion_value(criteria, "gritRemovalDetentionTime", 3)

            equipment.append({
                "id": make_id(),
                "process": "Preliminary Treatment",
                "equipmentType": "Mechanical Bar Screen",
                "description": "Automatic self-cleaning bar screen for removal of large solids and debris",
                "quantity": 2,
                "specs": {
                    "barSpacing": {"value": str(bar_spacing), "unit": "mm"},
                    "channelWidth": {"value": str(_round_to(flow_gpm / 449 / channel_vel * 3.281, 1)), "unit": "ft"},
                    "capacity": {"value": str(_round_to(peak_flow_gpm)), "unit": "gpm"},
                },
                "designBasis": "Peak flow with N+1 redundancy",
                "notes": "Two units: one duty, one standby",
                "isOverridden": False,
                "isLocked": False,
            })

            equipment.append({
                "id": make_id(),
                "process": "Preliminary Treatment",
                "equipmentType": "Vortex Grit Chamber",
                "description": "Vortex-type grit removal system for removal of inorganic grit and sand",
                "quantity": 2,
                "specs": {
                    "detentionTime": {"value": str(grit_dt), "unit": "min"},
                    "volume": {"value": str(_round_to(peak_flow_gpm * grit_dt / 7.481)), "unit": "cf"},
                    "capacity": {"value": str(_round_to(peak_flow_gpm)), "unit": "gpm"},
                },
                "designBasis": "Peak flow with N+1 redundancy",
                "notes": "Two chambers, one duty, one standby",
                "isOverridden": False,
                "isLocked": False,
            })

        if stage["type"] == "equalization":
            eq_dt = _get_criterion_value(criteria, "detentionTime", 8)
            eq_vol_gal = flow_gpd * (eq_dt / 24)
            equipment.append({
                "id": make_id(),
                "process": "Flow Equalization",
                "equipmentType": "Equalization Basin",
                "description": "Concrete basin for flow equalization and load dampening",
                "quantity": 1,
                "specs": {
                    "detentionTime": {"value": str(eq_dt), "unit": "hr"},
                    "volume": {"value": str(_round_to(eq_vol_gal)), "unit": "gal"},
                    "volumeMG": {"value": str(_round_to(eq_vol_gal / 1_000_000, 3)), "unit": "MG"},
                },
                "designBasis": f"{eq_dt}-hour detention time at average flow",
                "notes": "Includes submersible mixers and aeration to prevent septicity",
                "isOverridden": False,
                "isLocked": False,
            })

        if stage["type"] == "primary":
            sor = _get_criterion_value(criteria, "surfaceOverflowRate", 800)
            area_required = flow_gpd / sor
            depth = _get_criterion_value(criteria, "sidewaterDepth", 12)
            dt = _get_criterion_value(criteria, "detentionTime", 2)
            equipment.append({
                "id": make_id(),
                "process": "Primary Treatment",
                "equipmentType": "Primary Clarifier",
                "description": "Circular primary clarifier for settleable solids and FOG removal",
                "quantity": 2,
                "specs": {
                    "surfaceOverflowRate": {"value": str(sor), "unit": "gpd/sf"},
                    "surfaceArea": {"value": str(_round_to(area_required / 2)), "unit": "sf"},
                    "diameter": {"value": str(_round_to(math.sqrt(area_required / 2 * 4 / math.pi))), "unit": "ft"},
                    "sidewaterDepth": {"value": str(depth), "unit": "ft"},
                    "detentionTime": {"value": str(dt), "unit": "hr"},
                },
                "designBasis": f"SOR = {sor} gpd/sf at average flow, {depth} ft SWD",
                "notes": "Two clarifiers operating in parallel",
                "isOverridden": False,
                "isLocked": False,
            })

        if stage["type"] == "activated_sludge":
            hrt = _get_criterion_value(criteria, "hrt", 6)
            aeration_vol_gal = flow_gpd * (hrt / 24)
            bod_load = influent["bod"] * flow_mgd * 8.34
            o2_demand_val = _get_criterion_value(criteria, "oxygenDemand", 1.5)
            o2_demand = bod_load * o2_demand_val
            ote = _get_criterion_value(criteria, "oxygenTransferEfficiency", 0.25)
            sf = _get_criterion_value(criteria, "safetyFactor", 1.5)
            air_required = o2_demand / ote * sf
            mlss = _get_criterion_value(criteria, "mlss", 3000)
            srt = _get_criterion_value(criteria, "srt", 10)
            fm_ratio = _get_criterion_value(criteria, "fmRatio", 0.3)

            equipment.append({
                "id": make_id(),
                "process": "Secondary Treatment - Activated Sludge",
                "equipmentType": "Aeration Basin",
                "description": "Concrete aeration basin with fine bubble diffusers",
                "quantity": 2,
                "specs": {
                    "hrt": {"value": str(hrt), "unit": "hr"},
                    "volume": {"value": str(_round_to(aeration_vol_gal / 2)), "unit": "gal each"},
                    "volumeMG": {"value": str(_round_to(aeration_vol_gal / 2_000_000, 3)), "unit": "MG each"},
                    "mlss": {"value": str(mlss), "unit": "mg/L"},
                    "srt": {"value": str(srt), "unit": "days"},
                    "fmRatio": {"value": str(_round_to(fm_ratio, 2)), "unit": "lb BOD/lb MLSS\u00b7d"},
                },
                "designBasis": f"HRT = {hrt} hr, SRT = {srt} days, MLSS = {mlss} mg/L",
                "notes": "Two basins operating in parallel, fine bubble diffused aeration",
                "isOverridden": False,
                "isLocked": False,
            })

            clar_sor = _get_criterion_value(criteria, "secondaryClarifierSOR", 600)
            clar_area = flow_gpd / clar_sor
            clar_depth = _get_criterion_value(criteria, "secondaryClarifierDepth", 14)
            clar_slr = _get_criterion_value(criteria, "secondaryClarifierSLR", 25)
            equipment.append({
                "id": make_id(),
                "process": "Secondary Treatment - Activated Sludge",
                "equipmentType": "Secondary Clarifier",
                "description": "Circular secondary clarifier for mixed liquor separation",
                "quantity": 2,
                "specs": {
                    "surfaceOverflowRate": {"value": str(clar_sor), "unit": "gpd/sf"},
                    "surfaceArea": {"value": str(_round_to(clar_area / 2)), "unit": "sf each"},
                    "diameter": {"value": str(_round_to(math.sqrt(clar_area / 2 * 4 / math.pi))), "unit": "ft"},
                    "sidewaterDepth": {"value": str(clar_depth), "unit": "ft"},
                    "solidsLoadingRate": {"value": str(clar_slr), "unit": "lb/sf\u00b7d"},
                },
                "designBasis": f"SOR = {clar_sor} gpd/sf at average flow",
                "notes": "Two clarifiers operating in parallel",
                "isOverridden": False,
                "isLocked": False,
            })

        if stage["type"] == "mbr":
            hrt = _get_criterion_value(criteria, "hrt", 8)
            aeration_vol_gal = flow_gpd * (hrt / 24)
            membrane_flux = _get_criterion_value(criteria, "membraneFlux", 15)
            membrane_area = flow_gpd / membrane_flux
            mlss = _get_criterion_value(criteria, "mlss", 8000)
            srt = _get_criterion_value(criteria, "srt", 15)

            equipment.append({
                "id": make_id(),
                "process": "Secondary Treatment - MBR",
                "equipmentType": "Bioreactor Basin",
                "description": "MBR bioreactor basin with submerged membrane modules",
                "quantity": 2,
                "specs": {
                    "hrt": {"value": str(hrt), "unit": "hr"},
                    "volume": {"value": str(_round_to(aeration_vol_gal / 2)), "unit": "gal each"},
                    "mlss": {"value": str(mlss), "unit": "mg/L"},
                    "srt": {"value": str(srt), "unit": "days"},
                },
                "designBasis": f"HRT = {hrt} hr, SRT = {srt} days, MLSS = {mlss} mg/L",
                "notes": "Two trains with submerged flat-sheet or hollow-fiber membranes",
                "isOverridden": False,
                "isLocked": False,
            })

            equipment.append({
                "id": make_id(),
                "process": "Secondary Treatment - MBR",
                "equipmentType": "Membrane Modules",
                "description": "Submerged membrane filtration modules",
                "quantity": math.ceil(membrane_area / 5000),
                "specs": {
                    "flux": {"value": str(membrane_flux), "unit": "gfd"},
                    "totalArea": {"value": str(_round_to(membrane_area)), "unit": "sf"},
                    "moduleArea": {"value": "5,000", "unit": "sf/module"},
                },
                "designBasis": f"Net flux = {membrane_flux} gfd at average flow",
                "notes": "Includes spare capacity for cleaning cycles",
                "isOverridden": False,
                "isLocked": False,
            })

        if stage["type"] == "tertiary_filtration":
            filt_rate = _get_criterion_value(criteria, "filtrationRate", 5)
            filt_area = flow_gpm / filt_rate
            media_depth = _get_criterion_value(criteria, "mediaDepth", 24)
            backwash_rate = _get_criterion_value(criteria, "backwashRate", 15)
            equipment.append({
                "id": make_id(),
                "process": "Tertiary Treatment",
                "equipmentType": "Gravity Media Filter",
                "description": "Dual-media gravity filter for tertiary polishing",
                "quantity": max(2, math.ceil(filt_area / 200)),
                "specs": {
                    "filtrationRate": {"value": str(filt_rate), "unit": "gpm/sf"},
                    "totalArea": {"value": str(_round_to(filt_area)), "unit": "sf"},
                    "mediaDepth": {"value": str(media_depth), "unit": "in"},
                    "backwashRate": {"value": str(backwash_rate), "unit": "gpm/sf"},
                },
                "designBasis": f"Filtration rate = {filt_rate} gpm/sf at average flow",
                "notes": "Multiple cells, one cell out of service during backwash",
                "isOverridden": False,
                "isLocked": False,
            })

        if stage["type"] == "chemical_phosphorus":
            dose_mg = 50
            dose_rate = dose_mg * flow_mgd * 8.34
            equipment.append({
                "id": make_id(),
                "process": "Chemical Phosphorus Removal",
                "equipmentType": "Chemical Feed System",
                "description": "Ferric chloride or alum chemical feed system for phosphorus precipitation",
                "quantity": 1,
                "specs": {
                    "chemicalType": {"value": "Ferric Chloride (FeCl\u2083)", "unit": ""},
                    "dose": {"value": str(dose_mg), "unit": "mg/L"},
                    "feedRate": {"value": str(_round_to(dose_rate)), "unit": "lb/day"},
                    "storageTank": {"value": str(_round_to(dose_rate * 30 / 12.0)), "unit": "gal"},
                },
                "designBasis": f"{dose_mg} mg/L dose at average flow",
                "notes": "Includes chemical storage, metering pump, and mixing chamber",
                "isOverridden": False,
                "isLocked": False,
            })

        if stage["type"] == "disinfection":
            ct = _get_criterion_value(criteria, "contactTime", 30)
            uv_dose = _get_criterion_value(criteria, "uvDose", 40)
            contact_vol_gal = flow_gpm * ct
            equipment.append({
                "id": make_id(),
                "process": "Disinfection",
                "equipmentType": "UV Disinfection System",
                "description": "Open-channel UV disinfection system",
                "quantity": 1,
                "specs": {
                    "uvDose": {"value": str(uv_dose), "unit": "mJ/cm\u00b2"},
                    "contactTime": {"value": str(ct), "unit": "min"},
                    "channelVolume": {"value": str(_round_to(contact_vol_gal)), "unit": "gal"},
                    "peakCapacity": {"value": str(_round_to(peak_flow_gpm)), "unit": "gpm"},
                },
                "designBasis": f"UV dose = {uv_dose} mJ/cm\u00b2, contact time = {ct} min",
                "notes": "Includes redundant UV bank and automatic cleaning system",
                "isOverridden": False,
                "isLocked": False,
            })

    return equipment


def calculate_mass_balance_type_a(upif: dict) -> dict:
    warnings = []
    assumptions = []

    flow_mgd = _parse_flow_mgd(upif)
    if flow_mgd <= 0:
        warnings.append({
            "field": "Flow",
            "message": "No flow rate found in UPIF; defaulting to 1.0 MGD",
            "severity": "warning",
        })

    influent = {
        "flow": flow_mgd,
        "bod": _parse_analyte(upif, "BOD", 250),
        "cod": _parse_analyte(upif, "COD", 500),
        "tss": _parse_analyte(upif, "TSS", 250),
        "tkn": _parse_analyte(upif, "TKN", 40),
        "tp": _parse_analyte(upif, "TP", 7),
        "fog": _parse_analyte(upif, "FOG", 100),
        "nh3": _parse_analyte(upif, "NH3", 25),
        "no3": 0,
        "unit": "mg/L",
    }

    defaults_names = ["BOD", "COD", "TSS", "TKN", "TP", "FOG"]
    default_vals = [250, 500, 250, 40, 7, 100]
    parsed = [influent["bod"], influent["cod"], influent["tss"],
              influent["tkn"], influent["tp"], influent["fog"]]
    for i in range(len(defaults_names)):
        if parsed[i] == default_vals[i]:
            assumptions.append({
                "parameter": f"Influent {defaults_names[i]}",
                "value": f"{default_vals[i]} mg/L",
                "source": "Typical municipal wastewater (WEF MOP 8)",
            })

    assumptions.append({
        "parameter": "Influent Flow",
        "value": f"{flow_mgd} MGD",
        "source": "Default assumption" if flow_mgd == 1.0 else "Extracted from UPIF",
    })

    treatment_train = _determine_treatment_train(upif)
    stages = []
    current_stream = dict(influent)

    for stage_type in treatment_train:
        if stage_type == "equalization":
            stages.append({
                "name": "Flow Equalization",
                "type": "equalization",
                "influent": _round_stream(dict(current_stream)),
                "effluent": _round_stream(dict(current_stream)),
                "removalEfficiencies": {},
                "designCriteria": DEFAULT_DESIGN_CRITERIA.get("equalization", {}),
                "notes": ["Equalizes flow and load; no removal assumed"],
            })
            continue

        efficiencies = DEFAULT_REMOVAL_EFFICIENCIES.get(stage_type, {})
        effluent = _apply_removal(current_stream, efficiencies)

        stage_name = stage_type.replace("_", " ").title()

        stages.append({
            "name": stage_name,
            "type": stage_type,
            "influent": _round_stream(dict(current_stream)),
            "effluent": _round_stream(effluent),
            "removalEfficiencies": efficiencies,
            "designCriteria": DEFAULT_DESIGN_CRITERIA.get(stage_type, {}),
            "notes": [],
        })

        current_stream = effluent

    recycle_streams = _calculate_recycle_streams(stages, flow_mgd)
    converged = False
    iterations = 0
    prev_recycle_flows = [r["flow"] for r in recycle_streams]

    for it in range(1, MAX_ITERATIONS + 1):
        iterations = it

        total_recycle_flow = sum(
            r["flow"] for r in recycle_streams
            if "Headworks" in r["destination"] or "Aeration" in r["destination"]
        )

        adjusted_flow = flow_mgd + total_recycle_flow
        adjusted_influent = {
            "flow": adjusted_flow,
            "bod": (influent["bod"] * flow_mgd) / adjusted_flow,
            "cod": (influent["cod"] * flow_mgd) / adjusted_flow,
            "tss": (influent["tss"] * flow_mgd) / adjusted_flow,
            "tkn": (influent["tkn"] * flow_mgd) / adjusted_flow,
            "tp": (influent["tp"] * flow_mgd) / adjusted_flow,
            "fog": (influent["fog"] * flow_mgd) / adjusted_flow,
            "nh3": influent.get("nh3"),
            "no3": influent.get("no3"),
            "unit": "mg/L",
        }

        recalc_stream = dict(adjusted_influent)
        for i in range(len(stages)):
            if stages[i]["type"] == "equalization":
                stages[i]["influent"] = _round_stream(dict(recalc_stream))
                stages[i]["effluent"] = _round_stream(dict(recalc_stream))
                continue
            stages[i]["influent"] = _round_stream(dict(recalc_stream))
            recalc_stream = _apply_removal(recalc_stream, stages[i]["removalEfficiencies"])
            stages[i]["effluent"] = _round_stream(recalc_stream)

        recycle_streams = _calculate_recycle_streams(stages, adjusted_flow)
        current_recycle_flows = [r["flow"] for r in recycle_streams]

        deltas = []
        for idx, prev in enumerate(prev_recycle_flows):
            curr = current_recycle_flows[idx] if idx < len(current_recycle_flows) else 0
            if prev == 0:
                deltas.append(0 if curr == 0 else 1)
            else:
                deltas.append(abs(curr - prev) / prev)
        deltas.append(0)
        max_delta = max(deltas)

        if max_delta < CONVERGENCE_TOLERANCE:
            converged = True
            break
        prev_recycle_flows = current_recycle_flows

    equipment = _size_equipment(stages, flow_mgd, influent)

    final_effluent = stages[-1]["effluent"] if stages else None
    if final_effluent:
        targets = [
            {"name": "BOD", "target": _parse_effluent_target(upif, "bod"), "actual": final_effluent["bod"]},
            {"name": "TSS", "target": _parse_effluent_target(upif, "tss"), "actual": final_effluent["tss"]},
            {"name": "TKN", "target": _parse_effluent_target(upif, "tkn"), "actual": final_effluent["tkn"]},
            {"name": "TP", "target": _parse_effluent_target(upif, "tp"), "actual": final_effluent["tp"]},
        ]
        for t in targets:
            if t["target"] is not None and t["actual"] > t["target"]:
                warnings.append({
                    "field": t["name"],
                    "message": (f"Predicted effluent {t['name']} ({_round_to(t['actual'])} mg/L) "
                                f"exceeds target ({t['target']} mg/L). Additional treatment may be required."),
                    "severity": "warning",
                })

    return {
        "projectType": "A",
        "stages": stages,
        "adStages": [],
        "recycleStreams": recycle_streams,
        "equipment": equipment,
        "convergenceIterations": iterations,
        "convergenceAchieved": converged,
        "assumptions": assumptions,
        "warnings": warnings,
        "summary": {},
    }
