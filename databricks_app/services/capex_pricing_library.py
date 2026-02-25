"""
Burnham CapEx Model V5.1 – Prodeval equipment pricing library.
Direct Python port of shared/capex-pricing-library.ts
"""

from typing import Dict, Any


CAPEX_SIZE_TIERS = [
    {
        "scfm": 400,
        "majorEquipment": {
            "guu": 3_495_697,
            "flare": 142_425,
            "compressor": 491_596,
        },
        "engineering": {
            "bopDesign": 367_034,
            "bopConstructionAdmin": 193_116,
            "thirdPartyTesting": 85_587,
            "asBuilts": 10_000,
        },
        "civilStructural": {
            "earthworks": 581_283,
            "concrete": 171_160,
            "processStructural": 48_600,
        },
        "processPiping": {
            "pipingBase": 905_209,
            "settingEquipment": 72_019,
        },
        "electrical": 925_604,
        "instrumentationControls": 715_378,
        "nonProcess": {
            "siteInfrastructure": 236_367,
            "siteUtilities": 144_088,
            "siteElectrical": 49_252,
        },
    },
    {
        "scfm": 800,
        "majorEquipment": {
            "guu": 5_589_575,
            "flare": 142_425,
            "compressor": 491_596,
        },
        "engineering": {
            "bopDesign": 452_500,
            "bopConstructionAdmin": 193_116,
            "thirdPartyTesting": 94_146,
            "asBuilts": 10_000,
        },
        "civilStructural": {
            "earthworks": 709_490,
            "concrete": 292_100,
            "processStructural": 72_900,
        },
        "processPiping": {
            "pipingBase": 1_206_945,
            "settingEquipment": 72_019,
        },
        "electrical": 1_238_247,
        "instrumentationControls": 715_378,
        "nonProcess": {
            "siteInfrastructure": 258_839,
            "siteUtilities": 170_563,
            "siteElectrical": 55_194,
        },
    },
    {
        "scfm": 1200,
        "majorEquipment": {
            "guu": 6_113_161,
            "flare": 142_425,
            "compressor": 491_596,
        },
        "engineering": {
            "bopDesign": 593_670,
            "bopConstructionAdmin": 193_116,
            "thirdPartyTesting": 103_561,
            "asBuilts": 10_000,
        },
        "civilStructural": {
            "earthworks": 709_490,
            "concrete": 292_100,
            "processStructural": 72_900,
        },
        "processPiping": {
            "pipingBase": 1_206_945,
            "settingEquipment": 72_019,
        },
        "electrical": 1_274_795,
        "instrumentationControls": 715_378,
        "nonProcess": {
            "siteInfrastructure": 258_839,
            "siteUtilities": 170_563,
            "siteElectrical": 55_194,
        },
    },
]

DEFAULT_CONSTRUCTION_INDIRECT_RATES: Dict[str, float] = {
    "generalConditionsPct": 20.49,
    "buildingPermitsPct": 0.97,
    "insuranceGAPct": 5.22,
    "epcProfitPct": 10.63,
}

DEFAULT_BURNHAM_INTERNAL_COSTS: Dict[str, Any] = {
    "projectManagement": {
        "capitalTeamSitePersonnel": 913_996,
        "rduDcMgmtExpenses": 187_950,
        "tempConstructionFacilities": 130_730,
        "thirdPartyEngineeringSupport": 45_000,
        "constructionPpeFirstAid": 25_450,
        "legalSupport": 60_000,
    },
    "operationsDuringConstruction": {
        "operationsStaffPreCod": 215_998,
        "operationalAdjustments": 100_000,
        "operationsHandtools": 17_500,
        "gasSamplingForQuality": 92_250,
    },
    "insurance": {
        "buildersRiskPolicyPctOfEpc": 1.5,
    },
    "fixturesAndFurnishings": {
        "permanentOfficeFurnishings": 247_150,
    },
    "spareParts": 653_552,
    "utilities": {
        "tempPower": 5_000,
        "permanentPower": 160_000,
        "natGas": 0,
        "water": 0,
        "sewer": 0,
        "it": 2_500,
        "utilitiesDuringConstruction": 77_602,
    },
}

DEFAULT_COMMERCIAL_ITEMS: Dict[str, float] = {
    "utilityConnectionFee": 250_000,
    "devCostsPctOfEpc": 3.0,
    "devFeePctOfEpc": 0.0,
    "contingencyPctOfEpc": 7.5,
    "escalationPct": 5.83,
}

DEFAULT_INTERCONNECT: Dict[str, float] = {
    "interconnectFacilityBase": 2_200_000,
    "lateralCostPerMile": 923_403,
    "defaultLateralMiles": 2.0,
}

DEFAULT_FIELD_TECHNICIANS: Dict[str, float] = {
    "prodevalTechHours": 80,
    "otherVendorTechHours": 80,
    "hourlyRate": 250,
}


def _lerp(a: float, b: float, t: float) -> int:
    return round(a + (b - a) * t)


def _lerp_dict(lower: dict, upper: dict, t: float) -> dict:
    result = {}
    for key in lower:
        if isinstance(lower[key], dict):
            result[key] = _lerp_dict(lower[key], upper[key], t)
        elif isinstance(lower[key], (int, float)):
            result[key] = _lerp(lower[key], upper[key], t)
        else:
            result[key] = lower[key]
    return result


def interpolate_capex_tier(biogas_scfm: float) -> dict:
    if biogas_scfm <= 400:
        return dict(CAPEX_SIZE_TIERS[0])
    if biogas_scfm >= 1200:
        return dict(CAPEX_SIZE_TIERS[2])

    if biogas_scfm <= 800:
        lower = CAPEX_SIZE_TIERS[0]
        upper = CAPEX_SIZE_TIERS[1]
        t = (biogas_scfm - 400) / 400
    else:
        lower = CAPEX_SIZE_TIERS[1]
        upper = CAPEX_SIZE_TIERS[2]
        t = (biogas_scfm - 800) / 400

    result = {
        "scfm": biogas_scfm,
        "majorEquipment": {
            "guu": _lerp(lower["majorEquipment"]["guu"], upper["majorEquipment"]["guu"], t),
            "flare": _lerp(lower["majorEquipment"]["flare"], upper["majorEquipment"]["flare"], t),
            "compressor": _lerp(lower["majorEquipment"]["compressor"], upper["majorEquipment"]["compressor"], t),
        },
        "engineering": {
            "bopDesign": _lerp(lower["engineering"]["bopDesign"], upper["engineering"]["bopDesign"], t),
            "bopConstructionAdmin": _lerp(lower["engineering"]["bopConstructionAdmin"], upper["engineering"]["bopConstructionAdmin"], t),
            "thirdPartyTesting": _lerp(lower["engineering"]["thirdPartyTesting"], upper["engineering"]["thirdPartyTesting"], t),
            "asBuilts": _lerp(lower["engineering"]["asBuilts"], upper["engineering"]["asBuilts"], t),
        },
        "civilStructural": {
            "earthworks": _lerp(lower["civilStructural"]["earthworks"], upper["civilStructural"]["earthworks"], t),
            "concrete": _lerp(lower["civilStructural"]["concrete"], upper["civilStructural"]["concrete"], t),
            "processStructural": _lerp(lower["civilStructural"]["processStructural"], upper["civilStructural"]["processStructural"], t),
        },
        "processPiping": {
            "pipingBase": _lerp(lower["processPiping"]["pipingBase"], upper["processPiping"]["pipingBase"], t),
            "settingEquipment": _lerp(lower["processPiping"]["settingEquipment"], upper["processPiping"]["settingEquipment"], t),
        },
        "electrical": _lerp(lower["electrical"], upper["electrical"], t),
        "instrumentationControls": _lerp(lower["instrumentationControls"], upper["instrumentationControls"], t),
        "nonProcess": {
            "siteInfrastructure": _lerp(lower["nonProcess"]["siteInfrastructure"], upper["nonProcess"]["siteInfrastructure"], t),
            "siteUtilities": _lerp(lower["nonProcess"]["siteUtilities"], upper["nonProcess"]["siteUtilities"], t),
            "siteElectrical": _lerp(lower["nonProcess"]["siteElectrical"], upper["nonProcess"]["siteElectrical"], t),
        },
    }
    return result


def get_tier_label(biogas_scfm: float) -> str:
    if biogas_scfm <= 500:
        return "400 SCFM GUU"
    if biogas_scfm <= 1000:
        return "800 SCFM GUU"
    return "1,200 SCFM GUU"


def calculate_internal_costs_subtotal(costs: dict, epc_total: float) -> float:
    pm = costs["projectManagement"]
    pm_total = (
        pm["capitalTeamSitePersonnel"]
        + pm["rduDcMgmtExpenses"]
        + pm["tempConstructionFacilities"]
        + pm["thirdPartyEngineeringSupport"]
        + pm["constructionPpeFirstAid"]
        + pm["legalSupport"]
    )

    ops = costs["operationsDuringConstruction"]
    ops_total = (
        ops["operationsStaffPreCod"]
        + ops["operationalAdjustments"]
        + ops["operationsHandtools"]
        + ops["gasSamplingForQuality"]
    )

    insurance_total = round(epc_total * costs["insurance"]["buildersRiskPolicyPctOfEpc"] / 100)

    ff = costs["fixturesAndFurnishings"]["permanentOfficeFurnishings"]

    util = costs["utilities"]
    util_total = (
        util["tempPower"]
        + util["permanentPower"]
        + util["natGas"]
        + util["water"]
        + util["sewer"]
        + util["it"]
        + util["utilitiesDuringConstruction"]
    )

    return pm_total + ops_total + insurance_total + ff + costs["spareParts"] + util_total
