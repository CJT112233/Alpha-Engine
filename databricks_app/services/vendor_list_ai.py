import json
import logging
from datetime import datetime, timezone
from typing import Optional

from .llm import llm_complete, is_provider_available, get_available_providers, PROVIDER_LABELS

logger = logging.getLogger(__name__)


def _build_equipment_data_string(equipment: list[dict]) -> str:
    lines = []
    for i, eq in enumerate(equipment):
        parts = [
            f"Equipment {i + 1}:",
            f"  ID: {eq.get('id', '')}",
            f"  Type: {eq.get('equipmentType', eq.get('equipment_type', ''))}",
            f"  Process: {eq.get('process', '')}",
            f"  Quantity: {eq.get('quantity', 1)}",
            f"  Description: {eq.get('description', '')}",
            f"  Design Basis: {eq.get('designBasis', eq.get('design_basis', ''))}",
            "  Specs:",
        ]
        specs = eq.get("specs", {})
        if isinstance(specs, dict):
            for key, spec in specs.items():
                if isinstance(spec, dict):
                    val = spec.get("value", "")
                    unit = spec.get("unit", "")
                    parts.append(f"    {key}: {val} {unit}".rstrip())
                else:
                    parts.append(f"    {key}: {spec}")
        notes = eq.get("notes", "")
        if notes:
            parts.append(f"  Notes: {notes}")
        lines.append("\n".join(parts))
    return "\n\n".join(lines)


async def _get_prompt_template(key: str, storage=None) -> str:
    if storage and hasattr(storage, "get_prompt_template_by_key"):
        try:
            db_template = storage.get_prompt_template_by_key(key)
            if db_template and db_template.get("template"):
                return db_template["template"]
        except Exception:
            pass
    from ..knowledge_base.default_prompts import DEFAULT_PROMPTS
    prompt = DEFAULT_PROMPTS.get(key)
    if prompt:
        return prompt.get("template", "")
    return ""


async def generate_vendor_list_with_ai(
    equipment: list[dict],
    project_type: str,
    preferred_model: str,
    storage=None,
) -> dict:
    template = await _get_prompt_template("vendor_list", storage)
    if not template:
        raise ValueError("Vendor list prompt template not found")

    equipment_data = _build_equipment_data_string(equipment)
    project_context = f"Project Type: {project_type}"

    prompt = template.replace("{{EQUIPMENT_DATA}}", equipment_data)
    prompt = prompt.replace("{{PROJECT_CONTEXT}}", project_context)

    providers_to_try = []
    if is_provider_available(preferred_model):
        providers_to_try.append(preferred_model)
    for p in get_available_providers():
        if p not in providers_to_try:
            providers_to_try.append(p)

    if not providers_to_try:
        raise RuntimeError("No LLM providers available for vendor list generation")

    last_error = None
    for provider in providers_to_try:
        try:
            logger.info("Vendor List: Trying provider %s...", provider)
            result = llm_complete(
                model=provider,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": "Generate the recommended vendor list for the equipment listed above. Return only valid JSON."},
                ],
                max_tokens=8192,
                json_mode=True,
            )

            content = result["content"].strip()
            import re
            fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", content)
            if fence_match:
                content = fence_match.group(1).strip()

            try:
                parsed = json.loads(content)
            except json.JSONDecodeError as e:
                raise ValueError(f"Failed to parse vendor list JSON: {e}")

            items = parsed.get("items")
            if not isinstance(items, list):
                raise ValueError("Vendor list response missing 'items' array")

            for item in items:
                if not item.get("equipmentId") and not item.get("equipment_id"):
                    raise ValueError("Vendor list item missing equipmentId")
                if "equipment_id" in item and "equipmentId" not in item:
                    item["equipmentId"] = item.pop("equipment_id")
                if "equipment_type" in item and "equipmentType" not in item:
                    item["equipmentType"] = item.pop("equipment_type")
                if "specs_summary" in item and "specsSummary" not in item:
                    item["specsSummary"] = item.pop("specs_summary")
                item.setdefault("quantity", 1)
                item.setdefault("specsSummary", "")
                item.setdefault("process", "")
                if not isinstance(item.get("recommendations"), list):
                    item["recommendations"] = []
                for rec in item["recommendations"]:
                    if "spec_sheet_url" in rec and "specSheetUrl" not in rec:
                        rec["specSheetUrl"] = rec.pop("spec_sheet_url")
                    if "website_url" in rec and "websiteUrl" not in rec:
                        rec["websiteUrl"] = rec.pop("website_url")
                    if "model_number" in rec and "modelNumber" not in rec:
                        rec["modelNumber"] = rec.pop("model_number")

            provider_label = PROVIDER_LABELS.get(provider, provider)
            vendor_list = {
                "items": items,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "modelUsed": provider_label,
            }

            return {"vendor_list": vendor_list, "provider_label": provider_label}

        except Exception as e:
            last_error = e
            logger.warning("Vendor List: Provider %s failed: %s", provider, str(e))

    raise last_error or RuntimeError("All providers failed for vendor list generation")
