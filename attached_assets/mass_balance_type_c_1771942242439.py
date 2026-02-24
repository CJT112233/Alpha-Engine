import math
import re


GAS_CONDITIONING_DEFAULTS = {
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
}


def round_to(val, decimals=1):
    factor = 10 ** decimals
    return math.floor(val * factor + 0.5) / factor


def get_spec_value(fs, keys, default_val):
    feedstock_specs = fs.get("feedstockSpecs")
    if not feedstock_specs:
        return default_val
    for key in keys:
        for k, spec in feedstock_specs.items():
            kl = k.lower()
            dl = spec.get("displayName", "").lower()
            if kl == key.lower() or key.lower() in kl or key.lower() in dl:
                raw = str(spec.get("value", ""))
                cleaned = re.sub(r"[,%]", "", raw)
                try:
                    val = float(cleaned)
                    return val
                except (ValueError, TypeError):
                    pass
    return default_val


def parse_biogas_flow(fs):
    feedstock_specs = fs.get("feedstockSpecs")
    if not feedstock_specs:
        raw_vol = (fs.get("feedstockVolume") or "0").replace(",", "")
        try:
            vol = float(raw_vol)
        except (ValueError, TypeError):
            vol = 0.0
        unit = (fs.get("feedstockUnit") or "").lower()
        if not math.isnan(vol) and vol > 0:
            if "scfm" in unit:
                return {"scfm": vol, "source": "User-provided"}
            if "scfh" in unit:
                return {"scfm": vol / 60, "source": "User-provided"}
            if "scfd" in unit or ("scf" in unit and "day" in unit):
                return {"scfm": vol / 1440, "source": "User-provided"}
            if "m³/d" in unit or "m3/d" in unit:
                return {"scfm": (vol * 35.3147) / 1440, "source": "Converted from m³/day"}
            if "m³/h" in unit or "m3/h" in unit:
                return {"scfm": (vol * 35.3147) / 60, "source": "Converted from m³/hr"}
            if "nm³" in unit or "nm3" in unit:
                return {"scfm": (vol * 35.3147) / 1440, "source": "Converted from Nm³/day"}
            if "scfm" in unit or "cfm" in unit:
                return {"scfm": vol, "source": "User-provided"}
            return {"scfm": vol, "source": "Assumed scfm"}

    flow_val = get_spec_value(fs, ["flow", "biogasFlow", "biogas flow", "gas flow"], 0)
    if flow_val > 0:
        return {"scfm": flow_val, "source": "From specs"}
    return {"scfm": 0, "source": "Not found"}


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


def calculate_mass_balance_type_c(upif: dict) -> dict:
    warnings = []
    assumptions = []
    ad_stages = []
    equipment = []
    eq_id_counter = [1]

    def make_id():
        eid = f"eq-{eq_id_counter[0]}"
        eq_id_counter[0] += 1
        return eid

    feedstocks = upif.get("feedstocks") or []
    if len(feedstocks) == 0:
        warnings.append({"field": "Biogas Input", "message": "No biogas input parameters found in UPIF", "severity": "error"})
        return {
            "projectType": "C",
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

    fs = feedstocks[0]
    parsed = parse_biogas_flow(fs)
    biogas_scfm = parsed["scfm"]
    flow_source = parsed["source"]

    if biogas_scfm <= 0:
        warnings.append({"field": "Biogas Flow", "message": "No biogas flow rate found. Provide flow in scfm, scfh, m³/day, or similar units.", "severity": "error"})
        return {
            "projectType": "C",
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

    ch4_pct = get_spec_value(fs, ["ch4", "methane", "ch₄"], 60)
    co2_pct = get_spec_value(fs, ["co2", "carbon dioxide", "co₂"], 100 - ch4_pct - 2)
    n2_pct = get_spec_value(fs, ["n2", "nitrogen"], 1)
    o2_pct = get_spec_value(fs, ["o2", "oxygen"], 0.5)
    h2s_ppmv = get_spec_value(fs, ["h2s", "hydrogen sulfide", "h₂s"], 1500)
    siloxane_ppbv = get_spec_value(fs, ["siloxane", "siloxanes"], 5000)

    assumptions.append({"parameter": "Biogas Flow", "value": f"{round_to(biogas_scfm)} scfm", "source": flow_source})
    if ch4_pct == 60:
        assumptions.append({"parameter": "CH₄ Content", "value": "60%", "source": "Default assumption — typical AD biogas"})
    if h2s_ppmv == 1500:
        assumptions.append({"parameter": "H₂S", "value": "1,500 ppmv", "source": "Default assumption — typical AD biogas"})

    biogas_scf_per_day = biogas_scfm * 1440
    biogas_m3_per_day = biogas_scf_per_day / 35.3147

    inlet_stage = {
        "name": "Existing Biogas Supply",
        "type": "biogasInlet",
        "inputStream": {
            "biogasFlow": {"value": round_to(biogas_scfm), "unit": "scfm"},
            "biogasFlowDaily": {"value": round_to(biogas_scf_per_day), "unit": "scf/day"},
            "ch4": {"value": round_to(ch4_pct, 1), "unit": "%"},
            "co2": {"value": round_to(co2_pct, 1), "unit": "%"},
            "n2": {"value": round_to(n2_pct, 1), "unit": "%"},
            "o2": {"value": round_to(o2_pct, 1), "unit": "%"},
            "h2s": {"value": round_to(h2s_ppmv), "unit": "ppmv"},
            "siloxanes": {"value": round_to(siloxane_ppbv), "unit": "ppbv"},
        },
        "outputStream": {
            "biogasFlow": {"value": round_to(biogas_scfm), "unit": "scfm"},
        },
        "designCriteria": {},
        "notes": ["Existing digester biogas supply — no digester sizing included in Type C"],
    }
    ad_stages.append(inlet_stage)

    h2s_removal_eff = GAS_CONDITIONING_DEFAULTS["gasConditioning"]["h2sRemovalEff"]["value"] / 100
    siloxane_removal_eff = GAS_CONDITIONING_DEFAULTS["gasConditioning"]["siloxaneRemoval"]["value"] / 100
    out_h2s_ppmv = h2s_ppmv * (1 - h2s_removal_eff)
    out_siloxane_ppbv = siloxane_ppbv * (1 - siloxane_removal_eff)
    conditioned_scfm = biogas_scfm * 0.99

    conditioning_stage = {
        "name": "Biogas Conditioning",
        "type": "gasConditioning",
        "inputStream": {
            "biogasFlow": {"value": round_to(biogas_scfm), "unit": "scfm"},
            "h2s": {"value": round_to(h2s_ppmv), "unit": "ppmv"},
            "siloxanes": {"value": round_to(siloxane_ppbv), "unit": "ppbv"},
        },
        "outputStream": {
            "biogasFlow": {"value": round_to(conditioned_scfm), "unit": "scfm"},
            "h2s": {"value": round_to(out_h2s_ppmv, 1), "unit": "ppmv"},
            "siloxanes": {"value": round_to(out_siloxane_ppbv), "unit": "ppbv"},
            "moisture": {"value": 0, "unit": "dry"},
        },
        "designCriteria": GAS_CONDITIONING_DEFAULTS["gasConditioning"],
        "notes": [
            "H₂S removal via iron sponge or biological scrubber",
            "Siloxane removal via activated carbon adsorption",
            "Moisture removal via chiller and desiccant dryer",
        ],
    }
    ad_stages.append(conditioning_stage)

    equipment.append({
        "id": make_id(),
        "process": "Gas Conditioning",
        "equipmentType": "H₂S Removal System",
        "description": "Iron sponge or biological scrubber for hydrogen sulfide removal",
        "quantity": 1,
        "specs": {
            "inletH2S": {"value": str(round_to(h2s_ppmv)), "unit": "ppmv"},
            "outletH2S": {"value": str(round_to(out_h2s_ppmv, 1)), "unit": "ppmv"},
            "removalEff": {"value": "99.5", "unit": "%"},
            "gasFlow": {"value": str(round_to(biogas_scfm)), "unit": "scfm"},
        },
        "designBasis": "99.5% H₂S removal to < 10 ppmv",
        "notes": "Includes media replacement schedule",
        "isOverridden": False,
        "isLocked": False,
    })

    if siloxane_ppbv > 100:
        equipment.append({
            "id": make_id(),
            "process": "Gas Conditioning",
            "equipmentType": "Siloxane Removal System",
            "description": "Activated carbon adsorption vessel for siloxane removal",
            "quantity": 2,
            "specs": {
                "inletSiloxane": {"value": str(round_to(siloxane_ppbv)), "unit": "ppbv"},
                "outletSiloxane": {"value": str(round_to(out_siloxane_ppbv)), "unit": "ppbv"},
                "removalEff": {"value": "95", "unit": "%"},
                "gasFlow": {"value": str(round_to(biogas_scfm)), "unit": "scfm"},
            },
            "designBasis": "Lead/lag configuration, 95% removal",
            "notes": "Carbon replacement on breakthrough detection",
            "isOverridden": False,
            "isLocked": False,
        })

    equipment.append({
        "id": make_id(),
        "process": "Gas Conditioning",
        "equipmentType": "Gas Chiller/Dryer",
        "description": "Refrigerated chiller and desiccant dryer for moisture removal",
        "quantity": 1,
        "specs": {
            "gasFlow": {"value": str(round_to(biogas_scfm)), "unit": "scfm"},
            "outletDewpoint": {"value": "-40", "unit": "°F"},
        },
        "designBasis": "Reduce moisture to pipeline specifications",
        "notes": "Condensate drainage included",
        "isOverridden": False,
        "isLocked": False,
    })

    methane_recovery = GAS_CONDITIONING_DEFAULTS["gasUpgrading"]["methaneRecovery"]["value"] / 100
    product_ch4 = GAS_CONDITIONING_DEFAULTS["gasUpgrading"]["productCH4"]["value"]
    ch4_scf_per_day = biogas_scf_per_day * (ch4_pct / 100)
    rng_ch4_scf_per_day = ch4_scf_per_day * methane_recovery
    rng_scf_per_day = rng_ch4_scf_per_day / (product_ch4 / 100)
    rng_scfm = rng_scf_per_day / 1440
    rng_mmbtu_per_day = rng_scf_per_day * 1012 / 1_000_000
    tailgas_scfm = conditioned_scfm - rng_scfm
    electrical_demand_kw = biogas_m3_per_day * GAS_CONDITIONING_DEFAULTS["gasUpgrading"]["electricalDemand"]["value"] / 24

    upgrading_stage = {
        "name": "Gas Upgrading to RNG",
        "type": "gasUpgrading",
        "inputStream": {
            "biogasFlow": {"value": round_to(conditioned_scfm), "unit": "scfm"},
            "ch4Content": {"value": round_to(ch4_pct, 1), "unit": "%"},
        },
        "outputStream": {
            "rngFlow": {"value": round_to(rng_scfm), "unit": "scfm"},
            "rngFlowDaily": {"value": round_to(rng_scf_per_day), "unit": "scf/day"},
            "rngCH4": {"value": product_ch4, "unit": "%"},
            "rngEnergy": {"value": round_to(rng_mmbtu_per_day, 1), "unit": "MMBtu/day"},
            "tailgasFlow": {"value": round_to(tailgas_scfm), "unit": "scfm"},
            "methaneRecovery": {"value": round_to(methane_recovery * 100), "unit": "%"},
        },
        "designCriteria": GAS_CONDITIONING_DEFAULTS["gasUpgrading"],
        "notes": [
            "Membrane or PSA upgrading system",
            f"Tail gas: {round_to(tailgas_scfm)} scfm — route to flare or thermal oxidizer",
            f"Electrical demand: {round_to(electrical_demand_kw)} kW",
        ],
    }
    ad_stages.append(upgrading_stage)

    equipment.append({
        "id": make_id(),
        "process": "Gas Upgrading",
        "equipmentType": "Membrane/PSA Upgrading System",
        "description": "Multi-stage membrane or pressure swing adsorption for CO₂ removal",
        "quantity": 1,
        "specs": {
            "inletFlow": {"value": str(round_to(conditioned_scfm)), "unit": "scfm"},
            "productFlow": {"value": str(round_to(rng_scfm)), "unit": "scfm"},
            "productCH4": {"value": str(product_ch4), "unit": "%"},
            "methaneRecovery": {"value": "97", "unit": "%"},
            "pressure": {"value": "200", "unit": "psig"},
        },
        "designBasis": "97% methane recovery, pipeline quality RNG",
        "notes": "Includes compression, monitoring, and control system",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id(),
        "process": "Gas Upgrading",
        "equipmentType": "RNG Compressor",
        "description": "Multi-stage compressor for pipeline injection pressure",
        "quantity": 1,
        "specs": {
            "flow": {"value": str(round_to(rng_scfm)), "unit": "scfm"},
            "dischargePressure": {"value": "200", "unit": "psig"},
            "power": {"value": str(round_to(electrical_demand_kw * 0.6)), "unit": "kW"},
        },
        "designBasis": "Pipeline injection pressure",
        "notes": "Includes aftercooler and moisture knockout",
        "isOverridden": False,
        "isLocked": False,
    })

    equipment.append({
        "id": make_id(),
        "process": "Gas Management",
        "equipmentType": "Enclosed Flare",
        "description": "Enclosed ground flare for tail gas and excess biogas combustion",
        "quantity": 1,
        "specs": {
            "capacity": {"value": str(round_to(biogas_scfm * 1.1)), "unit": "scfm"},
            "destructionEff": {"value": "99.5", "unit": "%"},
        },
        "designBasis": "110% of maximum biogas flow",
        "notes": "Required for startup, upset, and maintenance",
        "isOverridden": False,
        "isLocked": False,
    })

    summary = {
        "biogasInletFlow": {"value": _locale_string(round_to(biogas_scfm)), "unit": "scfm"},
        "biogasInletCH4": {"value": str(round_to(ch4_pct, 1)), "unit": "%"},
        "biogasInletH2S": {"value": _locale_string(round_to(h2s_ppmv)), "unit": "ppmv"},
        "rngProduction": {"value": _locale_string(round_to(rng_scfm)), "unit": "scfm"},
        "rngProductionDaily": {"value": _locale_string(round_to(rng_scf_per_day)), "unit": "scf/day"},
        "rngCH4Purity": {"value": str(product_ch4), "unit": "%"},
        "rngEnergy": {"value": _locale_string(round_to(rng_mmbtu_per_day, 1)), "unit": "MMBtu/day"},
        "methaneRecovery": {"value": str(round_to(methane_recovery * 100)), "unit": "%"},
        "tailgasFlow": {"value": _locale_string(round_to(tailgas_scfm)), "unit": "scfm"},
        "electricalDemand": {"value": _locale_string(round_to(electrical_demand_kw)), "unit": "kW"},
    }

    return {
        "projectType": "C",
        "stages": [],
        "adStages": ad_stages,
        "recycleStreams": [],
        "equipment": equipment,
        "convergenceIterations": 1,
        "convergenceAchieved": True,
        "assumptions": assumptions,
        "warnings": warnings,
        "summary": summary,
    }
