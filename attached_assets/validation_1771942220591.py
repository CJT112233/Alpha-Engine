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

WASTEWATER_FLOW_INDICATORS = [
    "flow", "gpd", "mgd", "gpm", "m³/d", "m3/d", "gallons per day",
    "million gallons", "liters per day", "l/d", "cubic meters",
]

WASTEWATER_ANALYTE_PATTERNS = [
    re.compile(r"\bbod\b", re.IGNORECASE),
    re.compile(r"\bcod\b", re.IGNORECASE),
    re.compile(r"\btss\b", re.IGNORECASE),
    re.compile(r"\bfog\b", re.IGNORECASE),
    re.compile(r"\btkn\b", re.IGNORECASE),
    re.compile(r"\btp\b", re.IGNORECASE),
    re.compile(r"\btotal suspended", re.IGNORECASE),
    re.compile(r"\bbiochemical oxygen", re.IGNORECASE),
    re.compile(r"\bchemical oxygen", re.IGNORECASE),
]

WASTEWATER_UNIT_INDICATORS = [
    re.compile(r"mg/l", re.IGNORECASE),
    re.compile(r"gpd", re.IGNORECASE),
    re.compile(r"mgd", re.IGNORECASE),
    re.compile(r"gpm", re.IGNORECASE),
    re.compile(r"m³/d", re.IGNORECASE),
    re.compile(r"m3/d", re.IGNORECASE),
]

SLUDGE_EXPLICIT_TERMS = [
    "primary sludge", "was ", "waste activated", "sludge blend",
    "sludge thickening", "thickened sludge", "biosolids",
    "primary/was", "was/primary", "dewatered sludge", "digested sludge",
    "waste activated sludge",
]

SLUDGE_ONLY_SPEC_KEYS = {"deliveryForm", "receivingCondition", "preprocessingRequirement"}

SLUDGE_ASSUMPTION_KEYS = {
    "totalSolids", "volatileSolids", "vsTs", "moistureContent",
    "bulkDensity", "cnRatio", "methanePotential", "biodegradableFraction", "inertFraction",
}

FEEDSTOCK_SOLID_SPEC_KEYS = {
    "totalSolids", "volatileSolids", "vsTs", "cnRatio",
    "methanePotential", "biodegradableFraction", "inertFraction",
    "bulkDensity", "moistureContent",
}

WASTEWATER_HARD_BLOCK_KEYS = {
    "totalSolids", "volatileSolids", "vsTs",
    "methanePotential", "biodegradableFraction", "inertFraction",
    "bulkDensity", "moistureContent", "cnRatio",
    "deliveryForm", "receivingCondition", "preprocessingRequirement",
}

PRIMARY_WAS_TERMS = [
    "primary sludge", "waste activated sludge", "was ", "was/",
    "/was", "primary/was", "was blend", "sludge blend",
    "thickened sludge", "dewatered sludge", "digested sludge",
    "biosolids", "return activated", "ras ", "ras/",
]


def _detect_wastewater_context(extracted_params: list[dict]) -> dict[str, Any]:
    all_text = " ".join(
        f"{p.get('name', '')} {p.get('value', '')} {p.get('unit', '')}" for p in extracted_params
    ).lower()

    has_flow_rate = any(ind in all_text for ind in WASTEWATER_FLOW_INDICATORS)

    detected_analytes = []
    for pattern in WASTEWATER_ANALYTE_PATTERNS:
        if pattern.search(all_text):
            detected_analytes.append(pattern.pattern)

    has_unit_match = any(p.search(all_text) for p in WASTEWATER_UNIT_INDICATORS)
    has_analytes = len(detected_analytes) > 0 or has_unit_match

    return {"hasFlowRate": has_flow_rate, "hasAnalytes": has_analytes, "detectedAnalytes": detected_analytes}


def _detect_sludge_context(extracted_params: list[dict]) -> bool:
    all_text = " ".join(
        f"{p.get('name', '')} {p.get('value', '')}" for p in extracted_params
    ).lower()
    return any(s in all_text for s in SLUDGE_EXPLICIT_TERMS)


def reject_biosolids_output_profile(
    output_specs: dict[str, dict[str, dict]],
) -> dict[str, Any]:
    warnings: list[dict] = []
    unmapped: dict[str, dict] = {}

    if DIGESTATE_PROFILE not in output_specs:
        return {"sanitized": output_specs, "unmapped": unmapped, "warnings": warnings}

    specs = output_specs[DIGESTATE_PROFILE]
    for key, spec in specs.items():
        unmapped[f"biosolids_rejected_{key}"] = {**spec, "group": "unmapped"}

    warnings.append({
        "field": "Solid Digestate - Land Application",
        "section": "Output Profiles",
        "message": f"Biosolids/land application output profile rejected — this system produces RNG and/or treated effluent, not land-applied biosolids. All {len(specs)} criteria moved to Unmapped.",
        "severity": "error",
    })

    sanitized = {k: v for k, v in output_specs.items() if k != DIGESTATE_PROFILE}
    return {"sanitized": sanitized, "unmapped": unmapped, "warnings": warnings}


def validate_and_sanitize_output_specs(
    output_specs: dict[str, dict[str, dict]],
    project_type: str | None,
    extracted_params: list[dict] | None = None,
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

                if key in ("methaneFraction", "methane") or "methane" in combined_text:
                    try:
                        numeric_value = float(re.sub(r"[^0-9.]", "", value))
                        if numeric_value < 90 and spec.get("source") != "user_provided":
                            warnings.append({
                                "field": display_name,
                                "section": "RNG Gas Quality",
                                "message": f"Methane value {value} appears to be raw biogas (<90%), not pipeline-quality RNG (≥96%) — moved to Unmapped",
                                "severity": "error",
                                "originalValue": value,
                                "originalUnit": unit,
                            })
                            unmapped[f"rng_biogas_{key}"] = {**spec, "group": "unmapped"}
                            continue
                    except (ValueError, TypeError):
                        pass

                display_lower = display_name.lower()
                is_composition_field = any(x in display_lower for x in ["content", "fraction", "composition", "concentration"])
                if is_composition_field and unit != "%" and "%" not in unit:
                    unit_lower = unit.lower()
                    is_acceptable = any(x in unit_lower for x in ["ppmv", "lb/mmscf", "mg/m", "grain", "btu"])
                    if not is_acceptable and unit_lower not in GAS_ONLY_UNITS and spec.get("source") != "user_provided":
                        warnings.append({
                            "field": display_name,
                            "section": "RNG Gas Quality",
                            "message": f'Composition field "{display_name}" has non-percentage/non-gas unit "{unit}" — expected % or gas-phase unit',
                            "severity": "warning",
                            "originalValue": value,
                            "originalUnit": unit,
                        })
                        unmapped[f"rng_unit_mismatch_{key}"] = {**spec, "group": "unmapped"}
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

            sanitized[profile_name][key] = spec

        if not sanitized[profile_name]:
            del sanitized[profile_name]

    return {
        "sanitized": sanitized,
        "unmapped": unmapped,
        "performanceTargets": performance_targets,
        "warnings": warnings,
    }


def validate_biogas_vs_rng(
    output_specs: dict[str, dict[str, dict]],
) -> dict[str, Any]:
    warnings: list[dict] = []
    unmapped: dict[str, dict] = {}

    if RNG_PROFILE not in output_specs:
        return {"sanitized": output_specs, "unmapped": unmapped, "warnings": warnings}

    sanitized = dict(output_specs)
    rng_specs = dict(sanitized[RNG_PROFILE])
    keys_to_remove = []

    for key, spec in rng_specs.items():
        display_lower = spec.get("displayName", "").lower()
        is_methane = any(x in display_lower for x in ["methane", "ch4", "ch₄"]) or key in ("methaneFraction", "methane")

        if not is_methane:
            continue

        try:
            numeric_value = float(re.sub(r"[^0-9.]", "", str(spec.get("value", ""))))
        except (ValueError, TypeError):
            continue

        if numeric_value < 90:
            warnings.append({
                "field": spec.get("displayName", ""),
                "section": "RNG Gas Quality",
                "message": f"Methane {spec.get('value', '')}{spec.get('unit', '')} is raw biogas (<90%), not pipeline-quality RNG (≥96%). Biogas methane values must not appear in RNG gas-quality table.",
                "severity": "error",
                "originalValue": str(spec.get("value", "")),
                "originalUnit": str(spec.get("unit", "")),
            })
            unmapped[f"biogas_methane_{key}"] = {**spec, "group": "unmapped"}
            keys_to_remove.append(key)

    for key in keys_to_remove:
        del rng_specs[key]

    sanitized[RNG_PROFILE] = rng_specs
    if not rng_specs:
        del sanitized[RNG_PROFILE]

    return {"sanitized": sanitized, "unmapped": unmapped, "warnings": warnings}


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

    ww_context = _detect_wastewater_context(extracted_params)
    has_flow_rate = ww_context["hasFlowRate"]
    has_analytes = ww_context["hasAnalytes"]
    detected_analytes = ww_context.get("detectedAnalytes", [])
    is_wastewater_influent = has_flow_rate or has_analytes

    if not is_wastewater_influent:
        if not has_flow_rate:
            missing_required.append("Influent flow rate (GPD, MGD, m³/d, or similar)")
        if not has_analytes:
            missing_required.append("At least one influent concentration (BOD, COD, or TSS in mg/L)")
        warnings.append({
            "field": "Type A Required Inputs",
            "section": "Completeness Check",
            "message": f"Missing required influent data: {'; '.join(missing_required)}",
            "severity": "error",
        })
        return {"feedstocks": feedstocks, "warnings": warnings, "missingRequired": missing_required}

    sanitized_feedstocks = []
    for idx, fs in enumerate(feedstocks):
        specs = fs.get("feedstockSpecs")
        if not specs:
            sanitized_feedstocks.append(fs)
            continue

        clean_specs = {}
        blocked_count = 0

        for key, spec in specs.items():
            display_name = spec.get("displayName", key)
            spec_value = spec.get("value", "")
            spec_unit = spec.get("unit", "")

            if key in WASTEWATER_HARD_BLOCK_KEYS:
                blocked_count += 1
                warnings.append({
                    "field": display_name,
                    "section": f"Feedstock {idx + 1}",
                    "message": f'Blocked — wastewater influent detected (flow/mg/L analytes present). "{display_name}" ({spec_value} {spec_unit}) is a solids-basis parameter not applicable to liquid influent characterization.',
                    "severity": "warning",
                    "originalValue": spec_value,
                    "originalUnit": spec_unit,
                })
                continue

            unit_lower = spec_unit.lower()
            is_bmp_unit = any(u in unit_lower for u in ["m³/kg", "m3/kg", "l/kg", "ft³/lb", "ft3/lb"])
            if is_bmp_unit:
                blocked_count += 1
                warnings.append({
                    "field": display_name,
                    "section": f"Feedstock {idx + 1}",
                    "message": f'Blocked — BMP unit "{spec_unit}" is a solids-basis metric, not applicable to wastewater influent.',
                    "severity": "warning",
                    "originalValue": spec_value,
                    "originalUnit": spec_unit,
                })
                continue

            name_lower = display_name.lower()
            value_lower = (spec_value or "").lower()
            has_primary_was = any(t in name_lower or t in value_lower for t in PRIMARY_WAS_TERMS)
            if has_primary_was:
                blocked_count += 1
                warnings.append({
                    "field": display_name,
                    "section": f"Feedstock {idx + 1}",
                    "message": f'Blocked — primary/WAS sludge language detected in "{display_name}". Wastewater influent section should describe incoming liquid stream, not sludge byproducts.',
                    "severity": "warning",
                    "originalValue": spec_value,
                    "originalUnit": spec_unit,
                })
                continue

            clean_specs[key] = spec

        fs_name_lower = (fs.get("feedstockType") or "").lower()
        has_fs_name_sludge = any(t in fs_name_lower for t in PRIMARY_WAS_TERMS)
        if has_fs_name_sludge:
            warnings.append({
                "field": "Feedstock Type",
                "section": f"Feedstock {idx + 1}",
                "message": f'Feedstock name "{fs.get("feedstockType", "")}" contains primary/WAS sludge terminology — wastewater influent projects should describe the incoming liquid stream (e.g., "Municipal Wastewater Influent"), not sludge.',
                "severity": "error",
            })

        if blocked_count > 0:
            warnings.append({
                "field": "Solids-Basis Parameters",
                "section": f"Feedstock {idx + 1}",
                "message": f"Removed {blocked_count} solids-basis parameter(s) (VS/TS, BMP, delivery form, etc.) — Feedstock section should display influent analytes (BOD/COD/TSS/FOG in mg/L) + flow rate instead.",
                "severity": "info",
            })

        sanitized_feedstocks.append({**fs, "feedstockSpecs": clean_specs})

    if not has_flow_rate:
        missing_required.append("Influent flow rate (GPD, MGD, m³/d, or similar)")
    if not has_analytes:
        missing_required.append("At least one influent concentration (BOD, COD, or TSS in mg/L)")

    if missing_required:
        warnings.append({
            "field": "Type A Required Inputs",
            "section": "Completeness Check",
            "message": f"Missing required influent data: {'; '.join(missing_required)} — Feedstock section requires influent analytes + flow.",
            "severity": "error",
        })
    else:
        analyte_desc = ", ".join(detected_analytes) if detected_analytes else "BOD/COD/TSS"
        warnings.append({
            "field": "Wastewater Influent Mode",
            "section": "Type A Gate",
            "message": f"Wastewater influent detected — Feedstock section locked to influent analytes ({analyte_desc}) + flow. All solids-basis parameters (VS/TS, BMP, C:N, etc.) blocked.",
            "severity": "info",
        })

    return {"feedstocks": sanitized_feedstocks, "warnings": warnings, "missingRequired": missing_required}


def validate_feedstocks_for_type_d(
    feedstocks: list[dict],
    extracted_params: list[dict],
    project_type: str | None,
) -> dict[str, Any]:
    warnings: list[dict] = []
    missing_required: list[str] = []

    if project_type != "D":
        return {"feedstocks": feedstocks, "warnings": warnings, "missingRequired": missing_required}

    has_sludge_context = _detect_sludge_context(extracted_params)
    ww_context = _detect_wastewater_context(extracted_params)
    has_flow_rate = ww_context["hasFlowRate"]
    has_analytes = ww_context["hasAnalytes"]

    if not has_flow_rate:
        missing_required.append("At least one wastewater flow value (GPD, MGD, m³/d, or similar)")
    if not has_analytes:
        missing_required.append("At least one wastewater analyte (BOD, COD, or TSS in mg/L)")

    has_trucked_feedstock = False
    for fs in feedstocks:
        type_lower = (fs.get("feedstockType") or "").lower()
        is_ww = any(x in type_lower for x in ["wastewater", "influent", "sewage", "municipal"])
        if not is_ww and fs.get("feedstockType") and fs.get("feedstockVolume"):
            has_trucked_feedstock = True

    if not has_trucked_feedstock:
        missing_required.append("At least one trucked-in feedstock identity + quantity")

    if missing_required:
        warnings.append({
            "field": "Type D Required Inputs",
            "section": "Completeness Check",
            "message": f"Missing required items for hybrid project: {'; '.join(missing_required)}",
            "severity": "error",
        })

    sanitized_feedstocks = []
    for idx, fs in enumerate(feedstocks):
        specs = fs.get("feedstockSpecs")
        if not specs:
            sanitized_feedstocks.append(fs)
            continue

        type_lower = (fs.get("feedstockType") or "").lower()
        is_ww = any(x in type_lower for x in ["wastewater", "influent", "sewage", "municipal"])

        if not is_ww:
            sanitized_feedstocks.append(fs)
            continue

        clean_specs = {}
        has_swap_indicator = False
        swapped_keys = []

        for key, spec in specs.items():
            if not has_sludge_context and key in FEEDSTOCK_SOLID_SPEC_KEYS and spec.get("source") == "estimated_default":
                has_swap_indicator = True
                swapped_keys.append(spec.get("displayName", key))
                warnings.append({
                    "field": spec.get("displayName", key),
                    "section": f"Feedstock {idx + 1} (Wastewater)",
                    "message": f'Solids parameter "{spec.get("displayName", key)}" removed from wastewater stream — TS%/VS/BMP only valid for trucked feedstocks, not wastewater influent',
                    "severity": "warning",
                })
                continue
            clean_specs[key] = spec

        if has_swap_indicator and not has_flow_rate and not has_analytes:
            warnings.append({
                "field": f"Feedstock {idx + 1}",
                "section": "Swap Detection",
                "message": f"Stream labeled as wastewater contains solids parameters ({', '.join(swapped_keys)}) but no flow/analytes detected — likely mis-assigned feedstock. Parameters re-routed to Unmapped.",
                "severity": "error",
            })

        sanitized_feedstocks.append({**fs, "feedstockSpecs": clean_specs})

    return {"feedstocks": sanitized_feedstocks, "warnings": warnings, "missingRequired": missing_required}


def apply_swap_detection(
    feedstocks: list[dict],
    extracted_params: list[dict],
) -> dict[str, Any]:
    warnings: list[dict] = []
    swapped_specs: dict[str, dict] = {}
    ww_context = _detect_wastewater_context(extracted_params)
    has_flow_rate = ww_context["hasFlowRate"]
    has_analytes = ww_context["hasAnalytes"]

    sanitized = []
    for idx, fs in enumerate(feedstocks):
        specs = fs.get("feedstockSpecs")
        if not specs:
            sanitized.append(fs)
            continue

        type_lower = (fs.get("feedstockType") or "").lower()
        is_ww = any(x in type_lower for x in ["wastewater", "influent", "sewage", "municipal"])

        if not is_ww:
            sanitized.append(fs)
            continue

        has_solid_specs = any(k in FEEDSTOCK_SOLID_SPEC_KEYS for k in specs)

        if has_solid_specs and not has_flow_rate and not has_analytes:
            clean_specs = {}
            for key, spec in specs.items():
                if key in FEEDSTOCK_SOLID_SPEC_KEYS:
                    swapped_specs[f"swap_{idx}_{key}"] = {
                        "value": spec.get("value", ""),
                        "unit": spec.get("unit", ""),
                        "source": spec.get("source", ""),
                        "confidence": spec.get("confidence", ""),
                        "provenance": f'Swap detection: moved from wastewater stream "{fs.get("feedstockType", "")}" — likely mis-assigned feedstock parameter',
                        "group": "unmapped",
                        "displayName": spec.get("displayName", key),
                        "sortOrder": 99,
                    }
                else:
                    clean_specs[key] = spec

            warnings.append({
                "field": f"Feedstock {idx + 1}: {fs.get('feedstockType', '')}",
                "section": "Swap Detection",
                "message": "Wastewater-labeled stream contains TS%/moisture/BMP but no flow or mg/L analytes exist — parameters re-routed to Unmapped as likely mis-assigned feedstock data",
                "severity": "error",
            })
            sanitized.append({**fs, "feedstockSpecs": clean_specs})
        else:
            sanitized.append(fs)

    return {"feedstocks": sanitized, "warnings": warnings, "swappedSpecs": swapped_specs}


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
