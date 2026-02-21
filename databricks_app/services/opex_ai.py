import json
import logging
import re
from typing import Optional

from .llm import llm_complete, is_provider_available, get_available_providers, PROVIDER_LABELS

logger = logging.getLogger(__name__)

OPEX_PROMPT_MAP = {
    "a": "opex_type_a",
    "b": "opex_type_b",
    "c": "opex_type_c",
    "d": "opex_type_d",
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
            parts = [f"Feedstock {i + 1}: {f.get('feedstockType') or f.get('feedstock_type') or 'Unknown'}"]
            vol = f.get("feedstockVolume") or f.get("feedstock_volume")
            unit = f.get("feedstockUnit") or f.get("feedstock_unit") or ""
            if vol:
                parts.append(f"  Volume: {vol} {unit}")
            feed_lines.append("\n".join(parts))
        sections.append("FEEDSTOCKS:\n" + "\n".join(feed_lines))

    output_req = upif.get("output_requirements") or upif.get("outputRequirements")
    if output_req:
        sections.append(f"Output Requirements: {output_req}")

    constraints = upif.get("constraints") or []
    if isinstance(constraints, list) and len(constraints) > 0:
        sections.append("Constraints:\n" + "\n".join(f"  - {c}" for c in constraints))

    return "\n\n".join(sections)


def build_capex_data_string(capex_results: Optional[dict]) -> str:
    if not capex_results:
        return "No CapEx data available."

    sections = []
    summary = capex_results.get("summary") or {}

    if summary:
        sections.append("CAPEX SUMMARY:")
        sections.append(f"  Total Equipment Cost: ${summary.get('totalEquipmentCost', 0):,.0f}")
        sections.append(f"  Total Installed Cost: ${summary.get('totalInstalledCost', 0):,.0f}")
        sections.append(f"  Total Project Cost: ${summary.get('totalProjectCost', 0):,.0f}")
        cpu = summary.get("costPerUnit")
        if cpu and isinstance(cpu, dict):
            sections.append(f"  Cost per Unit: ${cpu.get('value', 0):,.0f} {cpu.get('unit', '')} ({cpu.get('basis', '')})")

    line_items = capex_results.get("lineItems") or []
    if isinstance(line_items, list) and len(line_items) > 0:
        li_lines = []
        for i, li in enumerate(line_items):
            li_lines.append(
                f"  {i + 1}. {li.get('equipmentType', 'Unknown')} ({li.get('process', '')}): "
                f"Base ${li.get('baseCostPerUnit', 0):,.0f}/unit × {li.get('quantity', 1)}, "
                f"Installed ${li.get('installedCost', 0):,.0f}, Total ${li.get('totalCost', 0):,.0f}"
            )
        sections.append("CAPEX LINE ITEMS:\n" + "\n".join(li_lines))

    return "\n".join(sections)


def _get_prompt_template(key: str, storage=None) -> str:
    if storage and hasattr(storage, "get_prompt_template_by_key"):
        try:
            db_template = storage.get_prompt_template_by_key(key)
            if db_template:
                return db_template.get("template") or db_template
        except Exception:
            pass
    from knowledge_base.default_prompts import DEFAULT_PROMPTS
    prompt_data = DEFAULT_PROMPTS.get(key)
    if prompt_data:
        return prompt_data["template"]
    raise ValueError(f"Unknown prompt key: {key}")


def _categorize_line_item(item: dict) -> str:
    cat = (item.get("category") or "").lower()
    if any(k in cat for k in ["labor", "staff", "personnel"]):
        return "Labor"
    if any(k in cat for k in ["energy", "electric", "utilit", "fuel", "heat"]):
        return "Energy"
    if any(k in cat for k in ["chemical", "consumab", "media", "membrane"]):
        return "Chemical"
    if any(k in cat for k in ["mainten", "repair", "spare"]):
        return "Maintenance"
    if any(k in cat for k in ["dispos", "haul", "sludge", "digestate", "solid"]):
        return "Disposal"
    if any(k in cat for k in ["revenue", "offset", "credit", "sales"]):
        return "Revenue Offset"
    return "Other"


def _validate_opex_results(parsed: dict, total_project_capex: float = 0) -> dict:
    line_items = []
    raw_items = parsed.get("lineItems") or []
    if isinstance(raw_items, list):
        for idx, item in enumerate(raw_items):
            line_items.append({
                "id": item.get("id") or f"opex-{idx}-{id(item) % 100000:05d}",
                "category": item.get("category") or _categorize_line_item(item),
                "description": item.get("description") or "",
                "annualCost": item.get("annualCost", 0) if isinstance(item.get("annualCost"), (int, float)) else 0,
                "unitCost": item.get("unitCost") if isinstance(item.get("unitCost"), (int, float)) else None,
                "unitBasis": item.get("unitBasis") or None,
                "scalingBasis": item.get("scalingBasis") or None,
                "percentOfRevenue": item.get("percentOfRevenue") if isinstance(item.get("percentOfRevenue"), (int, float)) else None,
                "costBasis": item.get("costBasis") or "Estimated, 2025 USD",
                "source": item.get("source") or "estimated",
                "notes": item.get("notes") or "",
                "isOverridden": False,
                "isLocked": False,
            })

    total_labor = sum(li["annualCost"] for li in line_items if _categorize_line_item(li) == "Labor")
    total_energy = sum(li["annualCost"] for li in line_items if _categorize_line_item(li) == "Energy")
    total_chemical = sum(li["annualCost"] for li in line_items if _categorize_line_item(li) == "Chemical")
    total_maintenance = sum(li["annualCost"] for li in line_items if _categorize_line_item(li) == "Maintenance")
    total_disposal = sum(li["annualCost"] for li in line_items if _categorize_line_item(li) == "Disposal")
    total_other = sum(li["annualCost"] for li in line_items if _categorize_line_item(li) == "Other")
    revenue_offsets = sum(li["annualCost"] for li in line_items if _categorize_line_item(li) == "Revenue Offset")

    total_annual_opex = total_labor + total_energy + total_chemical + total_maintenance + total_disposal + total_other
    net_annual_opex = total_annual_opex + revenue_offsets

    default_summary = {
        "totalAnnualOpex": total_annual_opex,
        "totalLaborCost": total_labor,
        "totalEnergyCost": total_energy,
        "totalChemicalCost": total_chemical,
        "totalMaintenanceCost": total_maintenance,
        "totalDisposalCost": total_disposal,
        "totalOtherCost": total_other,
        "revenueOffsets": revenue_offsets,
        "netAnnualOpex": net_annual_opex,
        "opexAsPercentOfCapex": round(total_annual_opex / total_project_capex * 100, 1) if total_project_capex > 0 else None,
    }

    raw_summary = parsed.get("summary") or {}
    summary = {}
    for key in default_summary:
        raw_val = raw_summary.get(key)
        if isinstance(raw_val, (int, float)):
            summary[key] = raw_val
        else:
            summary[key] = default_summary[key]

    if raw_summary.get("opexPerUnit") and isinstance(raw_summary["opexPerUnit"], dict):
        summary["opexPerUnit"] = raw_summary["opexPerUnit"]

    return {
        "projectType": parsed.get("projectType") or "A",
        "lineItems": line_items,
        "summary": summary,
        "assumptions": parsed.get("assumptions") if isinstance(parsed.get("assumptions"), list) else [],
        "warnings": parsed.get("warnings") if isinstance(parsed.get("warnings"), list) else [],
        "costYear": parsed.get("costYear") or "2025",
        "currency": parsed.get("currency") or "USD",
        "methodology": parsed.get("methodology") or "Bottom-up operating cost estimate",
    }


def _calculate_deterministic_line_items(
    mb_results: dict,
    capex_results: Optional[dict],
    project_type: str,
) -> dict:
    line_items = []
    skipped_categories = []
    pt = project_type.lower()

    total_equipment_cost = 0
    if capex_results and isinstance(capex_results, dict):
        capex_summary = capex_results.get("summary") or {}
        total_equipment_cost = capex_summary.get("totalEquipmentCost", 0)

    if total_equipment_cost > 0:
        maintenance_rate = 0.03 if pt == "a" else 0.04
        maintenance_cost = round(total_equipment_cost * maintenance_rate)
        line_items.append({
            "id": f"opex-det-maintenance",
            "category": "Maintenance",
            "description": f"Annual maintenance & repairs ({int(maintenance_rate * 100)}% of equipment CapEx)",
            "annualCost": maintenance_cost,
            "unitCost": None,
            "unitBasis": None,
            "scalingBasis": f"${total_equipment_cost:,.0f} equipment cost",
            "percentOfRevenue": None,
            "costBasis": f"Deterministic: {int(maintenance_rate * 100)}% of total equipment CapEx",
            "source": "WEF MOP 8 / industry benchmark",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })
        skipped_categories.append("Maintenance")

    power_keys = ["power", "motor", "hp", "installed power", "rated power", "brake horsepower"]
    total_kw = 0.0
    equipment = mb_results.get("equipment") or []
    if isinstance(equipment, list):
        for eq in equipment:
            specs = eq.get("specs") or {}
            if not isinstance(specs, dict):
                continue
            best_kw = 0.0
            for key, spec in specs.items():
                key_lower = key.lower()
                if not any(pk in key_lower for pk in power_keys):
                    continue
                if not isinstance(spec, dict):
                    continue
                try:
                    num_val = float(str(spec.get("value", "0")).replace(",", ""))
                except (ValueError, TypeError):
                    continue
                if num_val <= 0:
                    continue
                unit_lower = (spec.get("unit") or "").lower()
                if "hp" in unit_lower or "horsepower" in unit_lower:
                    kw = num_val * 0.7457
                elif "mw" in unit_lower:
                    kw = num_val * 1000
                elif "kw" in unit_lower:
                    kw = num_val
                elif "w" in unit_lower:
                    kw = num_val / 1000
                else:
                    kw = num_val * 0.7457
                if kw > best_kw:
                    best_kw = kw
            total_kw += best_kw * (eq.get("quantity") or 1)

    if total_kw > 0:
        load_factor = 0.75
        hours_per_year = 8760
        electricity_rate = 0.08
        annual_energy_cost = round(total_kw * load_factor * hours_per_year * electricity_rate)
        line_items.append({
            "id": f"opex-det-energy",
            "category": "Energy",
            "description": f"Electrical power ({round(total_kw)} kW installed, 75% load factor, $0.08/kWh)",
            "annualCost": annual_energy_cost,
            "unitCost": electricity_rate,
            "unitBasis": "$/kWh",
            "scalingBasis": f"{round(total_kw)} kW installed capacity",
            "percentOfRevenue": None,
            "costBasis": "Deterministic: equipment HP specs from mass balance × $0.08/kWh",
            "source": "EIA national average electricity rate",
            "notes": "",
            "isOverridden": False,
            "isLocked": False,
        })
        skipped_categories.append("Energy")

    return {"lineItems": line_items, "skippedCategories": skipped_categories}


def _repair_truncated_json(raw: str):
    s = raw.strip()
    for _ in range(20):
        open_braces = s.count("{") - s.count("}")
        open_brackets = s.count("[") - s.count("]")
        if open_braces == 0 and open_brackets == 0:
            break
        s = re.sub(r",\s*$", "", s)
        if open_brackets > 0:
            s += "]"
        elif open_braces > 0:
            s += "}"
        else:
            break
    return json.loads(s)


async def generate_opex_with_ai(
    upif: dict,
    mb_results: dict,
    capex_results: Optional[dict],
    project_type: str,
    preferred_model: str = "gpt5",
    storage=None,
) -> dict:
    normalized_type = normalize_project_type(project_type)
    prompt_key = OPEX_PROMPT_MAP.get(normalized_type, "opex_type_a")

    model = preferred_model
    if not is_provider_available(model):
        available = get_available_providers()
        if not available:
            raise RuntimeError("No LLM provider is available. Configure an API key for OpenAI or Anthropic.")
        model = available[0]
        logger.info("OpEx AI: %s not available, falling back to %s", preferred_model, model)

    prompt_template = _get_prompt_template(prompt_key, storage)
    equipment_data = build_equipment_data_string(mb_results)
    upif_context = build_upif_context_string(upif)
    capex_data = build_capex_data_string(capex_results)

    det_result = _calculate_deterministic_line_items(mb_results, capex_results, normalized_type)
    deterministic_items = det_result["lineItems"]
    skipped_categories = det_result["skippedCategories"]

    if deterministic_items:
        logger.info(
            "OpEx AI: Pre-calculated %d deterministic line items (%s)",
            len(deterministic_items), ", ".join(skipped_categories),
        )

    system_prompt = (
        prompt_template
        .replace("{{EQUIPMENT_DATA}}", equipment_data)
        .replace("{{UPIF_DATA}}", upif_context)
        .replace("{{CAPEX_DATA}}", capex_data)
    )

    logger.info(
        "OpEx AI: Generating for project type %s using %s (prompt: %s)",
        normalized_type.upper(), model, prompt_key,
    )

    skip_note = ""
    if skipped_categories:
        skip_note = (
            f" NOTE: The following cost categories have been pre-calculated from engineering data "
            f"and must be EXCLUDED from your response — do NOT generate line items for: "
            f"{', '.join(skipped_categories)}."
        )

    is_opus = model == "claude-opus"
    max_tokens = 16384 if is_opus else 32768
    user_msg = (
        "Generate a complete annual operating expenditure estimate based on the mass balance "
        "equipment list, project data, and capital cost estimate provided. Return valid JSON only. "
        "Keep the response concise to stay within output limits."
        + skip_note
    )

    response = await llm_complete(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        max_tokens=max_tokens,
        json_mode=True,
    )

    raw_content = response["content"]
    raw_content = re.sub(r"^```(?:json)?\s*\n?", "", raw_content)
    raw_content = re.sub(r"\n?```\s*$", "", raw_content).strip()

    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError as e:
        logger.warning("OpEx AI: Initial JSON parse failed, attempting truncation repair...")
        try:
            parsed = _repair_truncated_json(raw_content)
            logger.info("OpEx AI: Successfully repaired truncated JSON")
        except (json.JSONDecodeError, Exception) as repair_err:
            logger.error("OpEx AI: Failed to parse or repair JSON: %s", raw_content[:500])
            raise RuntimeError(f"AI returned invalid JSON. Parse error: {e}")

    if deterministic_items:
        ai_line_items = parsed.get("lineItems") or []
        filtered_ai = []
        if isinstance(ai_line_items, list):
            for item in ai_line_items:
                cat = _categorize_line_item(item)
                if cat in skipped_categories:
                    continue
                desc = ((item.get("description") or "") + " " + (item.get("category") or "")).lower()
                if "Maintenance" in skipped_categories and ("mainten" in desc or "repair" in desc):
                    continue
                if "Energy" in skipped_categories and ("energy" in desc or "electric" in desc or "power cost" in desc):
                    continue
                filtered_ai.append(item)
        parsed["lineItems"] = deterministic_items + filtered_ai

    total_project_capex = 0
    if capex_results and isinstance(capex_results, dict):
        capex_summary = capex_results.get("summary") or {}
        total_project_capex = capex_summary.get("totalProjectCost", 0)

    results = _validate_opex_results(parsed, total_project_capex)

    return {
        "results": results,
        "provider": response.get("provider", model),
        "provider_label": PROVIDER_LABELS.get(response.get("provider", model), model),
    }
