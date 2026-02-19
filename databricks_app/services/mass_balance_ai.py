import json
import logging
import math
from typing import Optional

from .llm import llm_complete, is_provider_available, get_available_providers, PROVIDER_LABELS

logger = logging.getLogger(__name__)

MASS_BALANCE_PROMPT_MAP = {
    "a": "mass_balance_type_a",
    "b": "mass_balance_type_b",
    "c": "mass_balance_type_c",
    "d": "mass_balance_type_d",
}


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


def build_upif_data_string(upif: dict) -> str:
    sections = []

    project_type = upif.get("project_type") or upif.get("projectType")
    if project_type:
        sections.append(f"Project Type: {project_type}")

    location = upif.get("location")
    if location:
        sections.append(f"Location: {location}")

    feedstocks = upif.get("feedstocks") or []
    if isinstance(feedstocks, list) and len(feedstocks) > 0:
        feedstock_lines = []
        for i, f in enumerate(feedstocks):
            parts = [f"Feedstock {i + 1}: {f.get('feedstockType', 'Unknown')}"]
            vol = f.get("feedstockVolume")
            if vol:
                parts.append(f"  Volume: {vol} {f.get('feedstockUnit', '')}")
            specs = f.get("feedstockSpecs") or {}
            if isinstance(specs, dict):
                for key, spec in specs.items():
                    if isinstance(spec, dict) and spec.get("value") not in (None, ""):
                        parts.append(f"  {key}: {spec['value']} {spec.get('unit', '')}")
            feedstock_lines.append("\n".join(parts))
        sections.append("FEEDSTOCKS/INFLUENTS:\n" + "\n\n".join(feedstock_lines))

    out_req = upif.get("output_requirements") or upif.get("outputRequirements")
    if out_req:
        sections.append(f"Output Requirements: {out_req}")

    out_specs = upif.get("output_specs") or upif.get("outputSpecs") or {}
    if isinstance(out_specs, dict):
        spec_lines = []
        for group, specs in out_specs.items():
            if isinstance(specs, dict):
                for key, spec in specs.items():
                    if isinstance(spec, dict) and spec.get("value") not in (None, ""):
                        display = spec.get("displayName", key)
                        spec_lines.append(f"  {group} > {display}: {spec['value']} {spec.get('unit', '')}")
        if spec_lines:
            sections.append("OUTPUT SPECIFICATIONS:\n" + "\n".join(spec_lines))

    constraints = upif.get("constraints") or []
    if isinstance(constraints, list) and len(constraints) > 0:
        sections.append("Constraints:\n" + "\n".join(f"  - {c}" for c in constraints))

    return "\n\n".join(sections)


async def get_prompt_template(key: str, storage=None) -> str:
    if storage and hasattr(storage, "get_prompt_template"):
        try:
            db_template = storage.get_prompt_template(key)
            if db_template:
                return db_template.get("template", "")
        except Exception:
            pass
    from databricks_app.knowledge_base.default_prompts import DEFAULT_PROMPTS
    prompt_def = DEFAULT_PROMPTS.get(key)
    if prompt_def:
        return prompt_def.get("template", "")
    return ""


def validate_mass_balance_results(parsed: dict) -> dict:
    results = {
        "projectType": parsed.get("projectType", "A"),
        "stages": parsed.get("stages") if isinstance(parsed.get("stages"), list) else [],
        "adStages": parsed.get("adStages") if isinstance(parsed.get("adStages"), list) else [],
        "recycleStreams": parsed.get("recycleStreams") if isinstance(parsed.get("recycleStreams"), list) else [],
        "equipment": parsed.get("equipment") if isinstance(parsed.get("equipment"), list) else [],
        "convergenceIterations": parsed.get("convergenceIterations") if isinstance(parsed.get("convergenceIterations"), (int, float)) else 1,
        "convergenceAchieved": parsed.get("convergenceAchieved") if isinstance(parsed.get("convergenceAchieved"), bool) else True,
        "assumptions": parsed.get("assumptions") if isinstance(parsed.get("assumptions"), list) else [],
        "warnings": parsed.get("warnings") if isinstance(parsed.get("warnings"), list) else [],
        "summary": parsed.get("summary") if isinstance(parsed.get("summary"), dict) else {},
    }

    for stage in results["stages"]:
        if not stage.get("influent"):
            stage["influent"] = {"flow": 0, "bod": 0, "cod": 0, "tss": 0, "tkn": 0, "tp": 0, "fog": 0, "unit": "mg/L"}
        if not stage.get("effluent"):
            stage["effluent"] = {"flow": 0, "bod": 0, "cod": 0, "tss": 0, "tkn": 0, "tp": 0, "fog": 0, "unit": "mg/L"}
        if not stage.get("removalEfficiencies"):
            stage["removalEfficiencies"] = {}
        if not stage.get("designCriteria"):
            stage["designCriteria"] = {}
        if not stage.get("notes"):
            stage["notes"] = []

    for stage in results.get("adStages") or []:
        if not stage.get("inputStream"):
            stage["inputStream"] = {}
        if not stage.get("outputStream"):
            stage["outputStream"] = {}
        if not stage.get("designCriteria"):
            stage["designCriteria"] = {}
        if not stage.get("notes"):
            stage["notes"] = []

    import random
    import string
    for eq in results["equipment"]:
        if not eq.get("id"):
            eq["id"] = f"equip-{''.join(random.choices(string.ascii_lowercase + string.digits, k=6))}"
        if not eq.get("specs"):
            eq["specs"] = {}
        if eq.get("isOverridden") is None:
            eq["isOverridden"] = False
        if eq.get("isLocked") is None:
            eq["isLocked"] = False

    return results


async def generate_mass_balance_with_ai(
    upif: dict,
    project_type: str,
    preferred_model: str = "databricks-gpt-5-2-codex",
    storage=None,
) -> dict:
    normalized_type = normalize_project_type(project_type)
    prompt_key = MASS_BALANCE_PROMPT_MAP.get(normalized_type, "mass_balance_type_a")

    model = preferred_model
    if not is_provider_available(model):
        available = get_available_providers()
        if not available:
            raise RuntimeError("No LLM provider is available.")
        logger.warning("Mass Balance AI: %s not available, falling back to %s", model, available[0])
        model = available[0]

    prompt_template = await get_prompt_template(prompt_key, storage)
    upif_data_string = build_upif_data_string(upif)
    system_prompt = prompt_template.replace("{{UPIF_DATA}}", upif_data_string)

    logger.info(
        "Mass Balance AI: Generating for project type %s using %s (prompt: %s)",
        normalized_type.upper(), model, prompt_key,
    )
    logger.info("Mass Balance AI: UPIF data length: %d chars", len(upif_data_string))

    response = llm_complete(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Generate a complete mass balance and equipment list based on the UPIF data provided. Return valid JSON only."},
        ],
        max_tokens=16384,
        json_mode=True,
    )

    logger.info(
        "Mass Balance AI: Response received from %s, %d chars",
        response["provider"], len(response["content"]),
    )

    raw_content = response["content"].strip()
    import re
    raw_content = re.sub(r"^```(?:json)?\s*\n?", "", raw_content)
    raw_content = re.sub(r"\n?```\s*$", "", raw_content).strip()

    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError as e:
        logger.error("Mass Balance AI: Failed to parse JSON response: %s", raw_content[:500])
        raise RuntimeError(f"AI returned invalid JSON. Parse error: {e}")

    results = validate_mass_balance_results(parsed)

    stage_count = len(results["stages"]) + len(results.get("adStages") or [])
    equip_count = len(results["equipment"])
    logger.info(
        "Mass Balance AI: Validated results - %d stages, %d equipment items, %d warnings",
        stage_count, equip_count, len(results["warnings"]),
    )

    return {
        "results": results,
        "provider": response["provider"],
        "providerLabel": PROVIDER_LABELS.get(response["provider"], response["provider"]),
    }
