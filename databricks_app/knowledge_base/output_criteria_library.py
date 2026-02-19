from typing import TypedDict, Optional, Literal


class OutputCriterion(TypedDict):
    value: str
    unit: str
    confidence: Literal["high", "medium", "low"]
    provenance: str
    group: str
    displayName: str
    sortOrder: int


class OutputProfile(TypedDict):
    name: str
    aliases: list[str]
    category: str
    criteria: dict[str, OutputCriterion]


class EnrichedOutputSpec(TypedDict):
    value: str
    unit: str
    source: Literal["typical_industry_standard", "estimated_requirement", "assumed_placeholder", "user_provided"]
    confidence: Literal["high", "medium", "low"]
    provenance: str
    group: str
    displayName: str
    sortOrder: int


output_group_labels: dict[str, str] = {
    "gas_quality": "Gas Quality Specifications",
    "delivery": "Delivery & Interconnection",
    "physical": "Physical Requirements",
    "nutrients": "Nutrient Specifications",
    "metals": "Heavy Metals Limits",
    "pathogens": "Pathogen & Vector Requirements",
    "regulatory": "Regulatory Framework",
    "discharge": "Discharge Limits",
    "prohibited": "Prohibited Substances",
}

output_group_order: list[str] = [
    "gas_quality",
    "delivery",
    "physical",
    "nutrients",
    "pathogens",
    "metals",
    "regulatory",
    "discharge",
    "prohibited",
]

OUTPUT_CRITERIA_LIBRARY: list[OutputProfile] = [
    {
        "name": "Renewable Natural Gas (RNG) - Pipeline Injection",
        "aliases": ["rng", "renewable natural gas", "pipeline injection", "pipeline gas", "biomethane", "upgraded biogas", "pipeline-quality gas"],
        "category": "Gas Product",
        "criteria": {
            "methaneContent": {
                "value": "\u2265 95",
                "unit": "% CH\u2084",
                "confidence": "high",
                "provenance": "Typical US pipeline specification (FERC/NAESB standards)",
                "group": "gas_quality",
                "displayName": "Methane Content (CH\u2084)",
                "sortOrder": 1,
            },
            "co2Content": {
                "value": "\u2264 2",
                "unit": "% CO\u2082",
                "confidence": "high",
                "provenance": "Standard pipeline limit",
                "group": "gas_quality",
                "displayName": "Carbon Dioxide Content (CO\u2082)",
                "sortOrder": 2,
            },
            "nitrogenContent": {
                "value": "\u2264 3",
                "unit": "% N\u2082",
                "confidence": "medium",
                "provenance": "Varies by pipeline; typical interstate limit",
                "group": "gas_quality",
                "displayName": "Nitrogen Content (N\u2082)",
                "sortOrder": 3,
            },
            "oxygenContent": {
                "value": "\u2264 0.2",
                "unit": "% O\u2082",
                "confidence": "high",
                "provenance": "Pipeline safety requirement; prevents corrosion/combustion risk",
                "group": "gas_quality",
                "displayName": "Oxygen Content (O\u2082)",
                "sortOrder": 4,
            },
            "totalInerts": {
                "value": "\u2264 5",
                "unit": "%",
                "confidence": "medium",
                "provenance": "Sum of CO2, N2, O2",
                "group": "gas_quality",
                "displayName": "Total Inerts",
                "sortOrder": 5,
            },
            "heatingValue": {
                "value": "950-1050",
                "unit": "Btu/scf",
                "confidence": "high",
                "provenance": "Standard pipeline heating value range (NAESB/tariff requirements)",
                "group": "gas_quality",
                "displayName": "Heating Value (HHV)",
                "sortOrder": 6,
            },
            "h2sContent": {
                "value": "\u2264 4 ppmv (\u2264 0.25 grain/100 scf)",
                "unit": "ppmv",
                "confidence": "high",
                "provenance": "Common pipeline limit; varies by utility",
                "group": "gas_quality",
                "displayName": "Hydrogen Sulfide (H\u2082S)",
                "sortOrder": 7,
            },
            "totalSulfur": {
                "value": "\u2264 10-20",
                "unit": "ppmv",
                "confidence": "medium",
                "provenance": "Varies by utility tariff",
                "group": "gas_quality",
                "displayName": "Total Sulfur",
                "sortOrder": 8,
            },
            "siloxanes": {
                "value": "\u2264 0.1-0.5",
                "unit": "mg/m\u00b3",
                "confidence": "medium",
                "provenance": "Critical for downstream equipment protection",
                "group": "gas_quality",
                "displayName": "Siloxanes",
                "sortOrder": 9,
            },
            "waterContent": {
                "value": "\u2264 7 lb/MMscf",
                "unit": "lb/MMscf",
                "confidence": "high",
                "provenance": "Pipeline dehydration requirement",
                "group": "gas_quality",
                "displayName": "Water Content",
                "sortOrder": 10,
            },
            "deliveryPressure": {
                "value": "200-800",
                "unit": "psig",
                "confidence": "medium",
                "provenance": "Varies by pipeline; transmission vs distribution",
                "group": "delivery",
                "displayName": "Delivery Pressure",
                "sortOrder": 11,
            },
            "mercaptanOdorant": {
                "value": "May be required",
                "unit": "",
                "confidence": "low",
                "provenance": "Some pipelines require mercaptan addition for leak detection",
                "group": "delivery",
                "displayName": "Mercaptan Odorant",
                "sortOrder": 12,
            },
            "wobbIndex": {
                "value": "1290-1390",
                "unit": "Btu/scf",
                "confidence": "medium",
                "provenance": "Interchangeability index; some utilities specify",
                "group": "gas_quality",
                "displayName": "Wobbe Index",
                "sortOrder": 13,
            },
        },
    },
    {
        "name": "Solid Digestate - Land Application",
        "aliases": ["solid digestate", "digestate", "land application", "land apply", "biosolids", "dewatered solids", "soil amendment", "compost"],
        "category": "Solid Byproduct",
        "criteria": {
            "moistureContent": {
                "value": "50-70",
                "unit": "% (dewatered cake)",
                "confidence": "medium",
                "provenance": "Typical belt press/centrifuge cake moisture",
                "group": "physical",
                "displayName": "Moisture Content",
                "sortOrder": 1,
            },
            "totalSolids": {
                "value": "30-50",
                "unit": "%",
                "confidence": "medium",
                "provenance": "Inverse of moisture for dewatered cake",
                "group": "physical",
                "displayName": "Total Solids",
                "sortOrder": 2,
            },
            "nitrogenTotal": {
                "value": "2-5 (report)",
                "unit": "% dry basis",
                "confidence": "medium",
                "provenance": "Agronomic nutrient; governs application rate",
                "group": "nutrients",
                "displayName": "Total Nitrogen",
                "sortOrder": 3,
            },
            "phosphorus": {
                "value": "1-3 (report)",
                "unit": "% dry basis",
                "confidence": "medium",
                "provenance": "Agronomic nutrient",
                "group": "nutrients",
                "displayName": "Phosphorus (as P\u2082O\u2085)",
                "sortOrder": 4,
            },
            "potassium": {
                "value": "0.5-2 (report)",
                "unit": "% dry basis",
                "confidence": "medium",
                "provenance": "Agronomic nutrient",
                "group": "nutrients",
                "displayName": "Potassium (as K\u2082O)",
                "sortOrder": 5,
            },
            "applicationRate": {
                "value": "Agronomic rate based on N requirement",
                "unit": "",
                "confidence": "medium",
                "provenance": "State-specific; typically limited by nitrogen or phosphorus loading",
                "group": "regulatory",
                "displayName": "Application Rate",
                "sortOrder": 6,
            },
            "regulatoryFramework": {
                "value": "State environmental agency permit + local regulations",
                "unit": "",
                "confidence": "high",
                "provenance": "Federal minimum; states may impose stricter limits",
                "group": "regulatory",
                "displayName": "Regulatory Framework",
                "sortOrder": 7,
            },
        },
    },
    {
        "name": "Liquid Effluent - Discharge to WWTP",
        "aliases": ["liquid effluent", "liquid digestate", "wwtp discharge", "wastewater discharge", "discharge to sewer", "industrial discharge", "effluent", "centrate", "filtrate"],
        "category": "Liquid Byproduct",
        "criteria": {
            "flowRate": {
                "value": "Must coordinate with WWTP capacity",
                "unit": "",
                "confidence": "low",
                "provenance": "Site-specific; requires WWTP evaluation for hydraulic capacity",
                "group": "discharge",
                "displayName": "Flow Rate",
                "sortOrder": 1,
            },
            "bod": {
                "value": "\u2264 250-500",
                "unit": "mg/L",
                "confidence": "medium",
                "provenance": "Typical municipal industrial pretreatment limit; varies by WWTP",
                "group": "discharge",
                "displayName": "BOD (Biochemical Oxygen Demand)",
                "sortOrder": 2,
            },
            "cod": {
                "value": "\u2264 500-1000",
                "unit": "mg/L",
                "confidence": "medium",
                "provenance": "Often 2x BOD limit; check local pretreatment ordinance",
                "group": "discharge",
                "displayName": "COD (Chemical Oxygen Demand)",
                "sortOrder": 3,
            },
            "tss": {
                "value": "\u2264 250-400",
                "unit": "mg/L",
                "confidence": "medium",
                "provenance": "Typical municipal sewer discharge limit",
                "group": "discharge",
                "displayName": "TSS (Total Suspended Solids)",
                "sortOrder": 4,
            },
            "fog": {
                "value": "\u2264 100-150",
                "unit": "mg/L",
                "confidence": "high",
                "provenance": "Standard grease trap limit; FOG is primary surcharge trigger",
                "group": "discharge",
                "displayName": "FOG (Fats, Oils, Grease)",
                "sortOrder": 5,
            },
            "ammoniaN": {
                "value": "\u2264 50-100",
                "unit": "mg/L",
                "confidence": "medium",
                "provenance": "High ammonia from AD centrate is common surcharge/rejection trigger; flag this",
                "group": "discharge",
                "displayName": "Ammonia-N (NH\u2083-N)",
                "sortOrder": 6,
            },
            "totalNitrogen": {
                "value": "Report",
                "unit": "mg/L",
                "confidence": "low",
                "provenance": "Often not directly limited but used for surcharge calculation",
                "group": "discharge",
                "displayName": "Total Nitrogen",
                "sortOrder": 7,
            },
            "ph": {
                "value": "6.0-9.0",
                "unit": "",
                "confidence": "high",
                "provenance": "Standard municipal sewer pH range",
                "group": "discharge",
                "displayName": "pH",
                "sortOrder": 8,
            },
            "temperature": {
                "value": "\u2264 140\u00b0F (60\u00b0C)",
                "unit": "\u00b0F",
                "confidence": "high",
                "provenance": "Standard sewer temperature limit",
                "group": "discharge",
                "displayName": "Temperature",
                "sortOrder": 9,
            },
            "prohibitedSubstances": {
                "value": "No flammable, corrosive, or toxic discharges",
                "unit": "",
                "confidence": "high",
                "provenance": "40 CFR 403 general prohibitions",
                "group": "prohibited",
                "displayName": "Prohibited Substances",
                "sortOrder": 10,
            },
            "pretreatmentFlag": {
                "value": "BOD, TSS, ammonia most likely to trigger surcharges",
                "unit": "",
                "confidence": "medium",
                "provenance": "Common surcharge parameters for high-strength industrial waste",
                "group": "regulatory",
                "displayName": "Pretreatment Surcharge Flags",
                "sortOrder": 11,
            },
            "surchargeRisk": {
                "value": "Ammonia-N and BOD are primary surcharge triggers for AD centrate",
                "unit": "",
                "confidence": "medium",
                "provenance": "AD centrate typically has 500-2000 mg/L NH3-N; significant surcharge potential",
                "group": "regulatory",
                "displayName": "Surcharge Risk Assessment",
                "sortOrder": 12,
            },
            "rejectionRisk": {
                "value": "Extreme ammonia or pH excursions may cause rejection",
                "unit": "",
                "confidence": "medium",
                "provenance": "WWTP nitrification capacity is the limiting factor",
                "group": "regulatory",
                "displayName": "Rejection Risk Assessment",
                "sortOrder": 13,
            },
        },
    },
]


def match_output_type(output_description: str) -> Optional[OutputProfile]:
    lower = output_description.lower().strip()
    for profile in OUTPUT_CRITERIA_LIBRARY:
        if profile["name"].lower() == lower:
            return profile
        for alias in profile["aliases"]:
            if lower in alias or alias in lower:
                return profile
    return None


def enrich_output_specs(
    output_type: str,
    user_provided_criteria: dict[str, dict],
    location: Optional[str] = None,
) -> dict[str, EnrichedOutputSpec]:
    profile = match_output_type(output_type)
    specs: dict[str, EnrichedOutputSpec] = {}

    if profile:
        for key, criterion in profile["criteria"].items():
            base_provenance = criterion["provenance"]
            provenance = (
                f"{base_provenance} [Location context: {location} \u2014 verify local/state requirements]"
                if location
                else base_provenance
            )

            specs[key] = {
                "value": criterion["value"],
                "unit": criterion["unit"],
                "source": "typical_industry_standard" if criterion["confidence"] == "high" else "estimated_requirement",
                "confidence": criterion["confidence"],
                "provenance": provenance,
                "group": criterion["group"],
                "displayName": criterion["displayName"],
                "sortOrder": criterion["sortOrder"],
            }

    criterion_key_map: dict[str, str] = {
        "methane": "methaneContent",
        "methane content": "methaneContent",
        "ch4": "methaneContent",
        "ch4 content": "methaneContent",
        "ch4 (%)": "methaneContent",
        "carbon dioxide": "co2Content",
        "co2": "co2Content",
        "co2 content": "co2Content",
        "co2 (%)": "co2Content",
        "nitrogen": "nitrogenContent",
        "nitrogen content": "nitrogenContent",
        "n2": "nitrogenContent",
        "n2 content": "nitrogenContent",
        "oxygen": "oxygenContent",
        "oxygen content": "oxygenContent",
        "o2": "oxygenContent",
        "o2 content": "oxygenContent",
        "total inerts": "totalInerts",
        "inerts": "totalInerts",
        "heating value": "heatingValue",
        "hhv": "heatingValue",
        "btu": "heatingValue",
        "btu/scf": "heatingValue",
        "higher heating value": "heatingValue",
        "h2s": "h2sContent",
        "h2s content": "h2sContent",
        "hydrogen sulfide": "h2sContent",
        "total sulfur": "totalSulfur",
        "sulfur": "totalSulfur",
        "siloxanes": "siloxanes",
        "siloxane": "siloxanes",
        "water content": "waterContent",
        "water": "waterContent",
        "moisture": "waterContent",
        "water dewpoint": "waterContent",
        "delivery pressure": "deliveryPressure",
        "pressure": "deliveryPressure",
        "injection pressure": "deliveryPressure",
        "mercaptan": "mercaptanOdorant",
        "mercaptan odorant": "mercaptanOdorant",
        "odorant": "mercaptanOdorant",
        "wobbe index": "wobbIndex",
        "wobbe": "wobbIndex",
        "interchangeability": "wobbIndex",
        "moisture content": "moistureContent",
        "cake moisture": "moistureContent",
        "total solids": "totalSolids",
        "ts": "totalSolids",
        "total nitrogen": "nitrogenTotal",
        "nitrogen total": "nitrogenTotal",
        "tkn": "nitrogenTotal",
        "total kjeldahl nitrogen": "nitrogenTotal",
        "phosphorus": "phosphorus",
        "p2o5": "phosphorus",
        "phosphorus content": "phosphorus",
        "potassium": "potassium",
        "k2o": "potassium",
        "potassium content": "potassium",
        "pathogen class": "pathogenClass",
        "pathogen classification": "pathogenClass",
        "pathogens": "pathogenClass",
        "class a": "pathogenClass",
        "class b": "pathogenClass",
        "vector attraction": "vectorAttraction",
        "var": "vectorAttraction",
        "vector attraction reduction": "vectorAttraction",
        "arsenic": "arsenic",
        "as": "arsenic",
        "cadmium": "cadmium",
        "cd": "cadmium",
        "copper": "copper",
        "cu": "copper",
        "lead": "lead",
        "pb": "lead",
        "mercury": "mercury",
        "hg": "mercury",
        "molybdenum": "molybdenum",
        "mo": "molybdenum",
        "nickel": "nickel",
        "ni": "nickel",
        "selenium": "selenium",
        "se": "selenium",
        "zinc": "zinc",
        "zn": "zinc",
        "application rate": "applicationRate",
        "agronomic rate": "applicationRate",
        "land application rate": "applicationRate",
        "regulatory framework": "regulatoryFramework",
        "regulation": "regulatoryFramework",
        "regulations": "regulatoryFramework",
        "flow rate": "flowRate",
        "flow": "flowRate",
        "hydraulic capacity": "flowRate",
        "bod": "bod",
        "biochemical oxygen demand": "bod",
        "bod5": "bod",
        "cod": "cod",
        "chemical oxygen demand": "cod",
        "tss": "tss",
        "total suspended solids": "tss",
        "suspended solids": "tss",
        "fog": "fog",
        "fats oils grease": "fog",
        "fats, oils, grease": "fog",
        "fats oils and grease": "fog",
        "grease": "fog",
        "ammonia": "ammoniaN",
        "ammonia-n": "ammoniaN",
        "nh3-n": "ammoniaN",
        "ammonia nitrogen": "ammoniaN",
        "total nitrogen (effluent)": "totalNitrogen",
        "ph": "ph",
        "temperature": "temperature",
        "temp": "temperature",
        "discharge temperature": "temperature",
        "prohibited substances": "prohibitedSubstances",
        "prohibited": "prohibitedSubstances",
        "general prohibitions": "prohibitedSubstances",
        "pretreatment": "pretreatmentFlag",
        "pretreatment flag": "pretreatmentFlag",
        "surcharge": "surchargeRisk",
        "surcharge risk": "surchargeRisk",
        "surcharges": "surchargeRisk",
        "rejection risk": "rejectionRisk",
        "rejection": "rejectionRisk",
    }

    if profile:
        for key, criterion in profile["criteria"].items():
            display_lower = criterion["displayName"].lower()
            if display_lower not in criterion_key_map:
                criterion_key_map[display_lower] = key

    for criterion_name, criterion_data in user_provided_criteria.items():
        normalized_name = criterion_name.lower().strip()
        mapped_key = criterion_key_map.get(normalized_name)

        if not mapped_key:
            best_alias = ""
            for alias, key in criterion_key_map.items():
                if normalized_name in alias or alias in normalized_name:
                    if len(alias) > len(best_alias):
                        best_alias = alias
                        mapped_key = key

        location_note = f" [Location context: {location}]" if location else ""

        if mapped_key and mapped_key in specs:
            specs[mapped_key] = {
                **specs[mapped_key],
                "value": criterion_data["value"],
                "unit": criterion_data.get("unit", specs[mapped_key]["unit"]),
                "source": "user_provided",
                "confidence": "high",
                "provenance": f"User-provided value from project input{location_note}",
            }
        elif mapped_key:
            specs[mapped_key] = {
                "value": criterion_data["value"],
                "unit": criterion_data.get("unit", ""),
                "source": "user_provided",
                "confidence": "high",
                "provenance": f"User-provided value from project input{location_note}",
                "group": "discharge",
                "displayName": criterion_name,
                "sortOrder": 50,
            }

    return specs
