import re
from typing import Any

GAS_ONLY_UNITS = {
    "lb/mmscf", "ppmv", "mg/m³", "mg/m3", "°f", "°c",
    "dewpoint", "grain/100 scf", "btu/scf", "% ch₄", "% co₂",
    "% n₂", "% o₂", "%", "psig", "psi",
}

SOLIDS_INDICATOR_PATTERNS = [
    re.compile(r"% ?ts", re.IGNORECASE),
    re.compile(r"% ?solids", re.IGNORECASE),
    re.compile(r"\bts\b", re.IGNORECASE),
    re.compile(r"\bcake\b", re.IGNORECASE),
    re.compile(r"dewatered", re.IGNORECASE),
    re.compile(r"mg/kg", re.IGNORECASE),
    re.compile(r"dry weight", re.IGNORECASE),
    re.compile(r"dry basis", re.IGNORECASE),
]

REMOVAL_EFFICIENCY_PATTERNS = [
    re.compile(r"% ?removal", re.IGNORECASE),
    re.compile(r"removal ?%", re.IGNORECASE),
    re.compile(r"removal efficiency", re.IGNORECASE),
    re.compile(r"percent removal", re.IGNORECASE),
    re.compile(r"reduction", re.IGNORECASE),
]

RNG_GAS_MOISTURE_KEYS = {"waterContent", "moistureContent", "waterDewpoint"}

GAS_UNIT_PATTERNS = [
    re.compile(r"ppmv", re.IGNORECASE),
    re.compile(r"lb/mmscf", re.IGNORECASE),
    re.compile(r"mg/m[³3]", re.IGNORECASE),
    re.compile(r"btu/scf", re.IGNORECASE),
    re.compile(r"grain", re.IGNORECASE),
    re.compile(r"psig", re.IGNORECASE),
    re.compile(r"% ?ch", re.IGNORECASE),
    re.compile(r"% ?co", re.IGNORECASE),
    re.compile(r"% ?n₂", re.IGNORECASE),
    re.compile(r"% ?o₂", re.IGNORECASE),
]

LIQUID_UNIT_PATTERNS = [
    re.compile(r"mg/l", re.IGNORECASE),
    re.compile(r"gpd", re.IGNORECASE),
    re.compile(r"mgd", re.IGNORECASE),
    re.compile(r"m³/d", re.IGNORECASE),
    re.compile(r"gpm", re.IGNORECASE),
    re.compile(r"°[fc]", re.IGNORECASE),
]

SOLIDS_UNIT_PATTERNS = [
    re.compile(r"mg/kg", re.IGNORECASE),
    re.compile(r"dry weight", re.IGNORECASE),
    re.compile(r"dry basis", re.IGNORECASE),
    re.compile(r"% ?\(dewatered", re.IGNORECASE),
]

RNG_PROFILE = "Renewable Natural Gas (RNG) - Pipeline Injection"
DIGESTATE_PROFILE = "Solid Digestate - Land Application"
EFFLUENT_PROFILE = "Liquid Effluent - Discharge to WWTP"


def validate_and_sanitize_output_specs(
    output_specs: dict[str, dict[str, dict]],
    project_type: str | None,
) -> dict[str, Any]:
    sanitized: dict[str, dict[str, dict]] = {}
    unmapped: dict[str, dict] = {}
    performance_targets: list[dict] = []
    warnings: list[dict] = []

    for profile_name, specs in output_specs.items():
        sanitized[profile_name] = {}

        for key, spec in specs.items():
            display_name = spec.get("displayName", "")
            value = str(spec.get("value", ""))
            unit = str(spec.get("unit", ""))
            combined_text = f"{display_name} {value} {unit}".lower()

            if profile_name == RNG_PROFILE:
                if any(p.search(combined_text) for p in SOLIDS_INDICATOR_PATTERNS):
                    warnings.append({
                        "field": display_name,
                        "section": "RNG Gas Quality",
                        "message": "Solids indicator detected in gas section — moved to Unmapped",
                        "severity": "warning",
                        "originalValue": value,
                        "originalUnit": unit,
                    })
                    unmapped[f"rng_rejected_{key}"] = {**spec, "group": "unmapped"}
                    continue

                if key in RNG_GAS_MOISTURE_KEYS:
                    unit_lower = unit.lower()
                    is_gas_unit = any(x in unit_lower for x in ["lb/mmscf", "ppmv", "mg/m", "dewpoint", "grain"])
                    if not is_gas_unit and spec.get("source") != "user_provided":
                        warnings.append({
                            "field": display_name,
                            "section": "RNG Gas Quality",
                            "message": f'Non-gas unit "{unit}" for moisture/water field — requires gas-phase units (dewpoint, ppmv, lb/MMscf, mg/m³)',
                            "severity": "warning",
                            "originalValue": value,
                            "originalUnit": unit,
                        })
                        unmapped[f"rng_unit_{key}"] = {**spec, "group": "unmapped"}
                        continue

            if profile_name == EFFLUENT_PROFILE:
                val_text = f"{value} {unit}".lower()
                is_removal = any(p.search(val_text) for p in REMOVAL_EFFICIENCY_PATTERNS)
                is_pct_target = (
                    "%" in val_text
                    and "mg/l" not in val_text
                    and (">" in val_text or "≥" in val_text)
                    and "ch" not in val_text
                    and "co2" not in val_text
                )
                if is_removal or is_pct_target:
                    performance_targets.append({
                        "displayName": display_name,
                        "value": value,
                        "unit": unit,
                        "source": spec.get("source", ""),
                        "provenance": spec.get("provenance", ""),
                        "group": "performance_targets",
                    })
                    warnings.append({
                        "field": display_name,
                        "section": "Effluent Limits",
                        "message": "Removal efficiency separated from concentration limits — moved to Performance Targets",
                        "severity": "info",
                    })
                    continue

            if profile_name == DIGESTATE_PROFILE:
                val_lower = f"{value} {unit}".lower()
                if any(p.search(val_lower) for p in REMOVAL_EFFICIENCY_PATTERNS):
                    performance_targets.append({
                        "displayName": display_name,
                        "value": value,
                        "unit": unit,
                        "source": spec.get("source", ""),
                        "provenance": spec.get("provenance", ""),
                        "group": "performance_targets",
                    })
                    continue

            sanitized[profile_name][key] = spec

        if not sanitized[profile_name]:
            del sanitized[profile_name]

    return {
        "sanitized": sanitized,
        "unmapped": unmapped,
        "performanceTargets": performance_targets,
        "warnings": warnings,
    }


def validate_feedstocks_for_type_a(
    feedstocks: list[dict],
    extracted_params: list[dict],
    project_type: str | None,
) -> dict[str, Any]:
    warnings: list[dict] = []
    missing_required: list[str] = []
    is_type_a = project_type == "A"

    if not is_type_a:
        return {"feedstocks": feedstocks, "warnings": warnings, "missingRequired": missing_required}

    all_input_text = " ".join(
        f"{p.get('name', '')} {p.get('value', '')}" for p in extracted_params
    ).lower()
    sludge_indicators = [
        "primary sludge", "was ", "waste activated", "sludge blend",
        "sludge thickening", "thickened sludge", "biosolids",
    ]
    has_sludge_context = any(s in all_input_text for s in sludge_indicators)

    sludge_spec_keys = {"deliveryForm", "receivingCondition", "preprocessingRequirement"}
    sludge_assumption_keys = {
        "totalSolids", "volatileSolids", "vsTs", "moistureContent",
        "bulkDensity", "cnRatio", "methanePotential", "biodegradableFraction", "inertFraction",
    }

    sanitized_feedstocks = []
    for idx, fs in enumerate(feedstocks):
        specs = fs.get("feedstockSpecs")
        if not specs:
            sanitized_feedstocks.append(fs)
            continue

        clean_specs = {}
        for key, spec in specs.items():
            source = spec.get("source", "")

            if key in sludge_spec_keys and not has_sludge_context and source == "estimated_default":
                warnings.append({
                    "field": spec.get("displayName", key),
                    "section": f"Feedstock {idx + 1}",
                    "message": "Sludge-specific default removed — no explicit sludge/biosolids mentioned in inputs",
                    "severity": "warning",
                })
                continue

            if key in sludge_assumption_keys and not has_sludge_context and source == "estimated_default":
                unit_lower = spec.get("unit", "").lower()
                if "%" in unit_lower and "mg/l" not in unit_lower:
                    warnings.append({
                        "field": spec.get("displayName", key),
                        "section": f"Feedstock {idx + 1}",
                        "message": "Solids-basis assumption removed for wastewater project — use BOD/COD/TSS + flow instead",
                        "severity": "warning",
                    })
                    continue

            clean_specs[key] = spec

        sanitized_feedstocks.append({**fs, "feedstockSpecs": clean_specs})

    all_text = " ".join(
        f"{p.get('name', '')} {p.get('value', '')} {p.get('unit', '')}" for p in extracted_params
    ).lower()

    has_flow_rate = any(
        x in all_text
        for x in ["flow", "gpd", "mgd", "gpm", "m³/d", "m3/d", "gallons", "liters"]
    )
    param_names = [p.get("name", "").lower() for p in extracted_params]
    has_bod = any("bod" in n for n in param_names)
    has_cod = any("cod" in n for n in param_names)
    has_tss = any("tss" in n or "total suspended" in n for n in param_names)

    if not has_flow_rate:
        missing_required.append("Flow rate (GPD, MGD, m³/d, or similar)")
    if not has_bod and not has_cod and not has_tss:
        missing_required.append("At least one wastewater concentration driver (BOD, COD, or TSS)")

    return {"feedstocks": sanitized_feedstocks, "warnings": warnings, "missingRequired": missing_required}


def apply_ts_tss_guardrail(
    feedstocks: list[dict],
    extracted_params: list[dict],
) -> dict[str, Any]:
    warnings: list[dict] = []
    all_text = " ".join(
        f"{p.get('name', '')} {p.get('value', '')} {p.get('unit', '')}" for p in extracted_params
    ).lower()

    has_tss_explicit = (
        "tss" in all_text
        or "total suspended solids" in all_text
        or "suspended solids" in all_text
    )
    has_ts_explicit = bool(
        re.search(r"\btotal solids\b", all_text)
        or re.search(r"\bts\s*[=:]\s*\d", all_text)
        or re.search(r"\bts\s*%", all_text)
    )

    sanitized = []
    for idx, fs in enumerate(feedstocks):
        specs = fs.get("feedstockSpecs")
        if not specs:
            sanitized.append(fs)
            continue

        new_specs = dict(specs)
        ts_spec = new_specs.get("totalSolids")
        if ts_spec and ts_spec.get("source") == "estimated_default":
            if has_tss_explicit and not has_ts_explicit:
                warnings.append({
                    "field": "Total Solids",
                    "section": f"Feedstock {idx + 1}",
                    "message": "TSS detected but TS was not explicitly provided — removing TS default to avoid confusion (TSS ≠ TS)",
                    "severity": "warning",
                })
                del new_specs["totalSolids"]

        sanitized.append({**fs, "feedstockSpecs": new_specs})

    return {"feedstocks": sanitized, "warnings": warnings}


def deduplicate_parameters(params: list[dict]) -> list[dict]:
    confidence_rank = {"high": 3, "medium": 2, "low": 1}
    seen: dict[str, dict] = {}

    for param in params:
        key = f"{param.get('category', '')}::{param.get('name', '').lower().strip()}"
        existing = seen.get(key)
        if existing is None:
            seen[key] = param
        else:
            existing_rank = confidence_rank.get(existing.get("confidence", "low"), 0)
            new_rank = confidence_rank.get(param.get("confidence", "low"), 0)
            if new_rank > existing_rank:
                seen[key] = param

    return list(seen.values())


def validate_section_assignment(
    params: list[dict],
) -> dict[str, Any]:
    valid = []
    unmapped_params = []
    warnings: list[dict] = []

    for param in params:
        val_unit = f"{param.get('value', '')} {param.get('unit', '')}".lower()
        name_lower = param.get("name", "").lower()
        category = param.get("category", "")

        if category in ("output_requirements", "output requirements"):
            is_gas = any(p.search(val_unit) for p in GAS_UNIT_PATTERNS)
            is_solid = any(p.search(val_unit) for p in SOLIDS_UNIT_PATTERNS)

            if is_gas and any(x in name_lower for x in ["tss", "total suspended", "sludge"]):
                warnings.append({
                    "field": param.get("name", ""),
                    "section": "Output Requirements",
                    "message": f'Solids parameter "{param.get("name", "")}" has gas-phase units — moved to Unmapped',
                    "severity": "warning",
                })
                unmapped_params.append(param)
                continue

            if is_solid and any(x in name_lower for x in ["methane", "ch4", "h2s"]):
                warnings.append({
                    "field": param.get("name", ""),
                    "section": "Output Requirements",
                    "message": f'Gas parameter "{param.get("name", "")}" has solids units — moved to Unmapped',
                    "severity": "warning",
                })
                unmapped_params.append(param)
                continue

        valid.append(param)

    return {"valid": valid, "unmapped": unmapped_params, "warnings": warnings}
