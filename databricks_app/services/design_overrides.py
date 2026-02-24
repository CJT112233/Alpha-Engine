from typing import Any, Dict, Optional


RECALCULABLE_FIELDS: Dict[str, str] = {
    "summary.hrt": "hrtDays",
    "summary.vsDestruction": "vsDestructionPct",

    "adStages.3.designCriteria.hrt": "hrtDays",
    "adStages.3.designCriteria.olr": "olrTarget",
    "adStages.3.designCriteria.vsDestruction": "vsDestructionPct",
    "adStages.3.designCriteria.temperature": "digesterTempF",
    "adStages.3.designCriteria.digesterVolume": "hrtDays",
    "adStages.3.designCriteria.mixingPower": "mixingPowerWPerM3",

    "adStages.2.designCriteria.retentionTime": "eqRetentionDays",
    "adStages.2.designCriteria.mixingPower": "mixingPowerWPerM3",

    "adStages.4.designCriteria.solidsCaptureEfficiency": "solidsCaptureEff",
    "adStages.4.designCriteria.cakeSolids": "cakeSolidsPct",
    "adStages.4.designCriteria.polymerDosing": "polymerDoseKgPerTon",

    "adStages.5.designCriteria.tssRemoval": "dafTssRemoval",
    "adStages.5.designCriteria.fogRemoval": "dafFogRemoval",
    "adStages.5.designCriteria.hydraulicLoading": "dafHydraulicLoading",

    "adStages.0.designCriteria.storageDays": "storageDays",
    "adStages.1.designCriteria.targetParticleSize": "targetParticleSize",
    "adStages.1.designCriteria.depackagingRejectRate": "depackagingRejectRate",
}

CRITERIA_MAP: Dict[str, str] = {
    "hrt": "hrtDays",
    "olr": "olrTarget",
    "organicLoadingRate": "olrTarget",
    "vsDestruction": "vsDestructionPct",
    "temperature": "digesterTempF",
    "digesterVolume": "hrtDays",
    "mixingPower": "mixingPowerWPerM3",
    "retentionTime": "eqRetentionDays",
    "solidsCaptureEfficiency": "solidsCaptureEff",
    "cakeSolids": "cakeSolidsPct",
    "polymerDosing": "polymerDoseKgPerTon",
    "tssRemoval": "dafTssRemoval",
    "fogRemoval": "dafFogRemoval",
    "hydraulicLoading": "dafHydraulicLoading",
    "storageDays": "storageDays",
    "targetParticleSize": "targetParticleSize",
    "depackagingRejectRate": "depackagingRejectRate",
    "headspacePct": "headspacePct",
    "gasYield": "gasYield",
    "ch4Content": "ch4Pct",
    "co2Content": "co2Pct",
    "h2sContent": "h2sPpmv",
    "preheatTemp": "preheatTempC",
    "targetTS": "targetTSPct",
    "thickenedSolids": "sludgeThickenedSolidsPct",
    "captureRate": "sludgeCaptureRate",
}


def _match_design_criteria_key(field_key: str) -> Optional[str]:
    if "designCriteria." in field_key:
        last_part = field_key.split(".")[-1]
        return CRITERIA_MAP.get(last_part)
    return None


def extract_design_overrides(
    overrides: Dict[str, Any],
    locks: Dict[str, Any],
) -> Dict[str, float]:
    result: Dict[str, float] = {}

    all_override_keys = set(list((overrides or {}).keys()))
    for k, v in (locks or {}).items():
        if v:
            all_override_keys.add(k)

    for field_key in all_override_keys:
        override = (overrides or {}).get(field_key)
        if not override or override.get("value") is None:
            continue

        design_key = RECALCULABLE_FIELDS.get(field_key)
        if design_key:
            try:
                num_val = float(str(override["value"]).replace(",", ""))
                result[design_key] = num_val
            except (ValueError, TypeError):
                pass
            continue

        match = _match_design_criteria_key(field_key)
        if match:
            try:
                num_val = float(str(override["value"]).replace(",", ""))
                result[match] = num_val
            except (ValueError, TypeError):
                pass

    return result


def is_recalculable_field(field_key: str) -> bool:
    if field_key in RECALCULABLE_FIELDS:
        return True
    if "designCriteria." in field_key:
        last_part = field_key.split(".")[-1]
        return last_part in CRITERIA_MAP
    return False
