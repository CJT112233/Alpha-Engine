import json
import logging
import math
import re
from typing import Optional

from .llm import llm_complete, is_provider_available, get_available_providers, PROVIDER_LABELS

logger = logging.getLogger(__name__)

CAPEX_PROMPT_MAP = {
    "a": "capex_type_a",
    "b": "capex_type_b",
    "c": "capex_type_c",
    "d": "capex_type_d",
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


def build_equipment_data_string(mb_results: dict) -> str:
    sections = []

    summary = mb_results.get("summary") or {}
    if isinstance(summary, dict) and len(summary) > 0:
        summary_lines = []
        for key, val in summary.items():
            if isinstance(val, dict):
                summary_lines.append(f"  {key}: {val.get('value', '')} {val.get('unit', '')}")
            else:
                summary_lines.append(f"  {key}: {val}")
        sections.append("MASS BALANCE SUMMARY:\n" + "\n".join(summary_lines))

    equipment = mb_results.get("equipment") or []
    if isinstance(equipment, list) and len(equipment) > 0:
        eq_lines = []
        for i, eq in enumerate(equipment):
            parts = [f"Equipment {i + 1}: {eq.get('equipmentType', 'Unknown')} ({eq.get('process', '')})"]
            parts.append(f"  ID: {eq.get('id', '')}")
            parts.append(f"  Description: {eq.get('description', '')}")
            parts.append(f"  Quantity: {eq.get('quantity', 1)}")
            parts.append(f"  Design Basis: {eq.get('designBasis', '')}")
            specs = eq.get("specs") or {}
            if isinstance(specs, dict):
                for key, spec in specs.items():
                    if isinstance(spec, dict):
                        parts.append(f"  {key}: {spec.get('value', '')} {spec.get('unit', '')}")
            notes = eq.get("notes")
            if notes:
                parts.append(f"  Notes: {notes}")
            eq_lines.append("\n".join(parts))
        sections.append("EQUIPMENT LIST:\n" + "\n\n".join(eq_lines))

    stages = mb_results.get("stages") or []
    if isinstance(stages, list) and len(stages) > 0:
        sections.append(f"Treatment Stages: {len(stages)} stages defined")

    ad_stages = mb_results.get("adStages") or []
    if isinstance(ad_stages, list) and len(ad_stages) > 0:
        sections.append(f"AD Process Stages: {len(ad_stages)} stages defined")

    return "\n\n".join(sections)


def build_upif_context_string(upif: dict) -> str:
    sections = []

    project_type = upif.get("project_type") or upif.get("projectType")
    if project_type:
        sections.append(f"Project Type: {project_type}")

    location = upif.get("location")
    if location:
        sections.append(f"Location: {location}")

    feedstocks = upif.get("feedstocks") or []
    if isinstance(feedstocks, list) and len(feedstocks) > 0:
        feed_lines = []
        for i, f in enumerate(feedstocks):
            parts = [f"Feedstock {i + 1}: {f.get('feedstockType', 'Unknown')}"]
            vol = f.get("feedstockVolume")
            if vol:
                parts.append(f"  Volume: {vol} {f.get('feedstockUnit', '')}")
            feed_lines.append("\n".join(parts))
        sections.append("FEEDSTOCKS:\n" + "\n".join(feed_lines))

    out_req = upif.get("output_requirements") or upif.get("outputRequirements")
    if out_req:
        sections.append(f"Output Requirements: {out_req}")

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
    from knowledge_base.default_prompts import DEFAULT_PROMPTS
    prompt_def = DEFAULT_PROMPTS.get(key)
    if prompt_def:
        return prompt_def.get("template", "")
    return ""


def validate_capex_results(parsed: dict) -> dict:
    raw_items = parsed.get("lineItems") if isinstance(parsed.get("lineItems"), list) else []
    line_items = []
    import random
    import string

    for idx, item in enumerate(raw_items):
        li = {
            "id": item.get("id") or f"capex-{idx}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=6))}",
            "equipmentId": item.get("equipmentId", ""),
            "process": item.get("process", "General"),
            "equipmentType": item.get("equipmentType", "Unknown"),
            "description": item.get("description", ""),
            "quantity": item["quantity"] if isinstance(item.get("quantity"), (int, float)) else 1,
            "baseCostPerUnit": item["baseCostPerUnit"] if isinstance(item.get("baseCostPerUnit"), (int, float)) else 0,
            "installationFactor": item["installationFactor"] if isinstance(item.get("installationFactor"), (int, float)) else 2.5,
            "installedCost": item["installedCost"] if isinstance(item.get("installedCost"), (int, float)) else 0,
            "contingencyPct": item["contingencyPct"] if isinstance(item.get("contingencyPct"), (int, float)) else 20,
            "contingencyCost": item["contingencyCost"] if isinstance(item.get("contingencyCost"), (int, float)) else 0,
            "totalCost": item["totalCost"] if isinstance(item.get("totalCost"), (int, float)) else 0,
            "costBasis": item.get("costBasis", "Estimated, 2025 USD"),
            "source": item.get("source", "estimated"),
            "notes": item.get("notes", ""),
            "isOverridden": False,
            "isLocked": False,
        }

        if li["installedCost"] == 0 and li["baseCostPerUnit"] > 0:
            li["installedCost"] = li["baseCostPerUnit"] * li["quantity"] * li["installationFactor"]
        if li["contingencyCost"] == 0 and li["installedCost"] > 0:
            li["contingencyCost"] = round(li["installedCost"] * (li["contingencyPct"] / 100))
        if li["totalCost"] == 0:
            li["totalCost"] = li["installedCost"] + li["contingencyCost"]

        line_items.append(li)

    total_equipment_cost = sum(i["baseCostPerUnit"] * i["quantity"] for i in line_items)
    total_installed_cost = sum(i["installedCost"] for i in line_items)
    total_contingency = sum(i["contingencyCost"] for i in line_items)
    total_direct_cost = total_installed_cost + total_contingency

    default_summary = {
        "totalEquipmentCost": total_equipment_cost,
        "totalInstalledCost": total_installed_cost,
        "totalContingency": total_contingency,
        "totalDirectCost": total_direct_cost,
        "engineeringPct": 15,
        "engineeringCost": round(total_direct_cost * 0.15),
        "totalProjectCost": round(total_direct_cost * 1.15),
    }

    raw_summary = parsed.get("summary") if isinstance(parsed.get("summary"), dict) else {}
    summary = {}
    for key in ["totalEquipmentCost", "totalInstalledCost", "totalContingency",
                 "totalDirectCost", "engineeringPct", "engineeringCost", "totalProjectCost"]:
        if isinstance(raw_summary.get(key), (int, float)):
            summary[key] = raw_summary[key]
        else:
            summary[key] = default_summary[key]
    if raw_summary.get("costPerUnit"):
        summary["costPerUnit"] = raw_summary["costPerUnit"]

    return {
        "projectType": parsed.get("projectType", "A"),
        "lineItems": line_items,
        "summary": summary,
        "assumptions": parsed.get("assumptions") if isinstance(parsed.get("assumptions"), list) else [],
        "warnings": parsed.get("warnings") if isinstance(parsed.get("warnings"), list) else [],
        "costYear": parsed.get("costYear", "2025"),
        "currency": parsed.get("currency", "USD"),
        "methodology": parsed.get("methodology", "AACE Class 4/5 factored estimate"),
    }


async def generate_capex_with_ai(
    upif: dict,
    mb_results: dict,
    project_type: str,
    preferred_model: str = "databricks-gpt-5-2-codex",
    storage=None,
) -> dict:
    normalized_type = normalize_project_type(project_type)
    prompt_key = CAPEX_PROMPT_MAP.get(normalized_type, "capex_type_a")

    model = preferred_model
    if not is_provider_available(model):
        available = get_available_providers()
        if not available:
            raise RuntimeError("No LLM provider is available.")
        logger.warning("CapEx AI: %s not available, falling back to %s", model, available[0])
        model = available[0]

    prompt_template = await get_prompt_template(prompt_key, storage)
    equipment_data_string = build_equipment_data_string(mb_results)
    upif_context_string = build_upif_context_string(upif)

    system_prompt = prompt_template.replace("{{EQUIPMENT_DATA}}", equipment_data_string).replace("{{UPIF_DATA}}", upif_context_string)

    logger.info(
        "CapEx AI: Generating for project type %s using %s (prompt: %s)",
        normalized_type.upper(), model, prompt_key,
    )
    logger.info(
        "CapEx AI: Equipment data length: %d chars, UPIF context: %d chars",
        len(equipment_data_string), len(upif_context_string),
    )

    response = llm_complete(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Generate a complete capital expenditure estimate based on the mass balance equipment list and project data provided. Return valid JSON only."},
        ],
        max_tokens=16384,
        json_mode=True,
    )

    logger.info(
        "CapEx AI: Response received from %s, %d chars",
        response["provider"], len(response["content"]),
    )

    raw_content = response["content"].strip()
    raw_content = re.sub(r"^```(?:json)?\s*\n?", "", raw_content)
    raw_content = re.sub(r"\n?```\s*$", "", raw_content).strip()

    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError as e:
        logger.error("CapEx AI: Failed to parse JSON response: %s", raw_content[:500])
        raise RuntimeError(f"AI returned invalid JSON. Parse error: {e}")

    results = validate_capex_results(parsed)

    return {
        "results": results,
        "provider": response["provider"],
        "providerLabel": PROVIDER_LABELS.get(response["provider"], response["provider"]),
    }
