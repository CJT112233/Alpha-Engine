export interface FeedstockProperty {
  value: string;
  unit: string;
  confidence: "high" | "medium" | "low";
  provenance: string;
  group: "identity" | "physical" | "biochemical" | "contaminants" | "extended" | "composition";
  displayName: string;
  sortOrder: number;
}

export interface FeedstockProfile {
  name: string;
  aliases: string[];
  category: string;
  properties: Record<string, FeedstockProperty>;
}

export interface EnrichedFeedstockSpec {
  value: string;
  unit: string;
  source: "user_provided" | "ai_inferred" | "estimated_default";
  confidence: "high" | "medium" | "low";
  provenance: string;
  group: "identity" | "physical" | "biochemical" | "contaminants" | "extended" | "composition";
  displayName: string;
  sortOrder: number;
}

export const feedstockGroupLabels: Record<string, string> = {
  identity: "Identity & Flow",
  physical: "Physical Characteristics",
  biochemical: "Organic & Biochemical Properties",
  contaminants: "Contaminants & Inerts",
  extended: "Extended Parameters",
  composition: "Gas Composition",
};

export const feedstockGroupOrder: string[] = [
  "identity",
  "composition",
  "physical",
  "biochemical",
  "contaminants",
  "extended",
];

export const FEEDSTOCK_LIBRARY: FeedstockProfile[] = [
  {
    name: "Potato Waste",
    aliases: ["potato waste", "potato processing waste", "potato peels", "potato culls", "potato processing", "potato residue", "potato slurry"],
    category: "Food Processing Waste",
    properties: {
      deliveryForm: {
        value: "Slurry / wet solid",
        unit: "",
        confidence: "medium",
        provenance: "Typical for potato processing facilities; peels and culls are often conveyed as wet solids or slurry",
        group: "identity",
        displayName: "Delivery Form",
        sortOrder: 1,
      },
      receivingCondition: {
        value: "Raw, unprocessed",
        unit: "",
        confidence: "medium",
        provenance: "Standard receiving condition for food processing waste streams",
        group: "identity",
        displayName: "Receiving Condition",
        sortOrder: 2,
      },
      totalSolids: {
        value: "12-18",
        unit: "% wet basis",
        confidence: "medium",
        provenance: "Literature range for potato processing waste (EPA AgSTAR; Labatut et al., 2011; Achinas & Euverink, 2016)",
        group: "physical",
        displayName: "Total Solids (TS)",
        sortOrder: 3,
      },
      volatileSolids: {
        value: "85-92",
        unit: "% of TS",
        confidence: "medium",
        provenance: "Literature range for potato waste VS/TS (Labatut et al., 2011; Gunaseelan, 1997)",
        group: "physical",
        displayName: "Volatile Solids (VS)",
        sortOrder: 4,
      },
      vsTs: {
        value: "0.85-0.92",
        unit: "",
        confidence: "medium",
        provenance: "Derived from VS and TS ranges; consistent with food processing waste literature",
        group: "physical",
        displayName: "VS/TS Ratio",
        sortOrder: 5,
      },
      moistureContent: {
        value: "82-88",
        unit: "%",
        confidence: "medium",
        provenance: "Derived from TS range (100% - TS%); typical for wet food processing waste",
        group: "physical",
        displayName: "Moisture Content",
        sortOrder: 6,
      },
      bulkDensity: {
        value: "55-65",
        unit: "lb/ft³",
        confidence: "low",
        provenance: "Estimated based on moisture content and typical food waste densities",
        group: "physical",
        displayName: "Bulk Density (as received)",
        sortOrder: 7,
      },
      cnRatio: {
        value: "20-30",
        unit: "",
        confidence: "medium",
        provenance: "Literature range for potato waste C:N (Gunaseelan, 1997; Li et al., 2013)",
        group: "biochemical",
        displayName: "C:N Ratio",
        sortOrder: 8,
      },
      biodegradableFraction: {
        value: "75-85",
        unit: "% of VS",
        confidence: "medium",
        provenance: "High starch content in potato waste yields high biodegradability (Labatut et al., 2011)",
        group: "biochemical",
        displayName: "Biodegradable Fraction of VS",
        sortOrder: 9,
      },
      methanePotential: {
        value: "0.30-0.42",
        unit: "m³ CH₄/kg VS",
        confidence: "medium",
        provenance: "BMP literature values for potato waste (Gunaseelan, 1997; Labatut et al., 2011; Parawira et al., 2004)",
        group: "biochemical",
        displayName: "Biochemical Methane Potential (BMP)",
        sortOrder: 10,
      },
      inertFraction: {
        value: "2-5",
        unit: "% by mass",
        confidence: "low",
        provenance: "Estimated; potato processing waste typically has low inert content unless mixed with field soil/stones",
        group: "contaminants",
        displayName: "Inert/Contaminant Fraction",
        sortOrder: 11,
      },
      preprocessingRequirement: {
        value: "Screening, size reduction (grinding)",
        unit: "",
        confidence: "medium",
        provenance: "Standard preprocessing for potato waste to ensure consistent particle size for digestion",
        group: "contaminants",
        displayName: "Expected Preprocessing",
        sortOrder: 12,
      },
      tkn: {
        value: "2.0-4.0",
        unit: "g/kg wet",
        confidence: "low",
        provenance: "Estimated from typical potato waste nitrogen content (Achinas & Euverink, 2016)",
        group: "extended",
        displayName: "Total Kjeldahl Nitrogen (TKN)",
        sortOrder: 13,
      },
      lipidFraction: {
        value: "0.1-0.5",
        unit: "%",
        confidence: "low",
        provenance: "Potato waste is predominantly starch/carbohydrate with very low lipid content",
        group: "extended",
        displayName: "Lipid Fraction",
        sortOrder: 14,
      },
      foamingRisk: {
        value: "Low",
        unit: "",
        confidence: "medium",
        provenance: "Low protein and lipid content reduces foaming risk compared to high-protein substrates",
        group: "extended",
        displayName: "Foaming Risk",
        sortOrder: 15,
      },
      inhibitionRisk: {
        value: "Low (monitor pH due to rapid acidification)",
        unit: "",
        confidence: "medium",
        provenance: "High starch content can cause rapid VFA accumulation; monitor pH and VFA/alkalinity ratio",
        group: "extended",
        displayName: "Inhibition Risk",
        sortOrder: 16,
      },
    },
  },
  {
    name: "Dairy Manure",
    aliases: ["dairy manure", "cow manure", "cattle manure", "dairy waste", "dairy", "dairy farm waste", "dairy farm manure"],
    category: "Animal Manure",
    properties: {
      deliveryForm: {
        value: "Slurry (scraped or flushed)",
        unit: "",
        confidence: "medium",
        provenance: "Standard dairy manure handling; flush systems typical in Pacific NW operations",
        group: "identity",
        displayName: "Delivery Form",
        sortOrder: 1,
      },
      receivingCondition: {
        value: "Raw, as-collected",
        unit: "",
        confidence: "medium",
        provenance: "Dairy manure typically received without preprocessing unless sand-bedded",
        group: "identity",
        displayName: "Receiving Condition",
        sortOrder: 2,
      },
      totalSolids: {
        value: "8-12",
        unit: "% wet basis",
        confidence: "high",
        provenance: "Well-established range for scraped dairy manure (ASAE D384.2; EPA AgSTAR Handbook)",
        group: "physical",
        displayName: "Total Solids (TS)",
        sortOrder: 3,
      },
      volatileSolids: {
        value: "75-85",
        unit: "% of TS",
        confidence: "high",
        provenance: "Standard dairy manure VS/TS range (ASAE D384.2; EPA AgSTAR)",
        group: "physical",
        displayName: "Volatile Solids (VS)",
        sortOrder: 4,
      },
      vsTs: {
        value: "0.75-0.85",
        unit: "",
        confidence: "high",
        provenance: "Derived from VS and TS data; well-established in dairy AD literature",
        group: "physical",
        displayName: "VS/TS Ratio",
        sortOrder: 5,
      },
      moistureContent: {
        value: "88-92",
        unit: "%",
        confidence: "high",
        provenance: "Derived from TS range; consistent with scraped dairy manure",
        group: "physical",
        displayName: "Moisture Content",
        sortOrder: 6,
      },
      bulkDensity: {
        value: "60-65",
        unit: "lb/ft³",
        confidence: "medium",
        provenance: "Typical for liquid/slurry dairy manure (ASAE D384.2)",
        group: "physical",
        displayName: "Bulk Density (as received)",
        sortOrder: 7,
      },
      cnRatio: {
        value: "15-25",
        unit: "",
        confidence: "high",
        provenance: "Standard C:N for dairy manure (ASAE D384.2; Möller & Müller, 2012)",
        group: "biochemical",
        displayName: "C:N Ratio",
        sortOrder: 8,
      },
      biodegradableFraction: {
        value: "40-55",
        unit: "% of VS",
        confidence: "medium",
        provenance: "Dairy manure has moderate biodegradability due to lignocellulosic fiber from feed (Labatut et al., 2011)",
        group: "biochemical",
        displayName: "Biodegradable Fraction of VS",
        sortOrder: 9,
      },
      methanePotential: {
        value: "0.15-0.25",
        unit: "m³ CH₄/kg VS",
        confidence: "high",
        provenance: "Well-established BMP range for dairy manure (EPA AgSTAR; Möller et al., 2004)",
        group: "biochemical",
        displayName: "Biochemical Methane Potential (BMP)",
        sortOrder: 10,
      },
      inertFraction: {
        value: "5-15",
        unit: "% by mass",
        confidence: "medium",
        provenance: "Sand bedding, grit, and undigested fiber; varies significantly by farm management",
        group: "contaminants",
        displayName: "Inert/Contaminant Fraction",
        sortOrder: 11,
      },
      preprocessingRequirement: {
        value: "Sand separation, grit removal, mixing",
        unit: "",
        confidence: "medium",
        provenance: "Sand-bedded dairies require sand separation; all systems benefit from mixing/homogenization",
        group: "contaminants",
        displayName: "Expected Preprocessing",
        sortOrder: 12,
      },
      tkn: {
        value: "3.5-5.5",
        unit: "g/kg wet",
        confidence: "medium",
        provenance: "Literature values for dairy manure nitrogen (ASAE D384.2; Möller & Müller, 2012)",
        group: "extended",
        displayName: "Total Kjeldahl Nitrogen (TKN)",
        sortOrder: 13,
      },
      ammoniaN: {
        value: "1.5-3.0",
        unit: "g/kg wet",
        confidence: "medium",
        provenance: "Typically 40-60% of TKN in dairy manure (Möller & Müller, 2012)",
        group: "extended",
        displayName: "Ammonia-N",
        sortOrder: 14,
      },
      pathogenRisk: {
        value: "Moderate",
        unit: "",
        confidence: "medium",
        provenance: "Animal manure carries potential pathogens; thermophilic digestion or pasteurization may be required",
        group: "extended",
        displayName: "Pathogen Risk Class",
        sortOrder: 15,
      },
      inhibitionRisk: {
        value: "Moderate (ammonia at high loading rates)",
        unit: "",
        confidence: "medium",
        provenance: "High nitrogen content can cause ammonia inhibition at elevated OLR; monitor FAN levels",
        group: "extended",
        displayName: "Inhibition Risk",
        sortOrder: 16,
      },
    },
  },
  {
    name: "Food Waste",
    aliases: ["food waste", "food scraps", "food processing waste", "organic food waste", "food residuals", "commercial food waste", "restaurant waste", "cafeteria waste"],
    category: "Food Waste",
    properties: {
      deliveryForm: {
        value: "Mixed solid / slurry",
        unit: "",
        confidence: "medium",
        provenance: "Food waste form varies; commercial sources often deliver as mixed solids requiring depackaging",
        group: "identity",
        displayName: "Delivery Form",
        sortOrder: 1,
      },
      receivingCondition: {
        value: "Packaged or loose; requires depackaging/sorting",
        unit: "",
        confidence: "medium",
        provenance: "Commercial/retail food waste often arrives packaged; pre-consumer may be loose",
        group: "identity",
        displayName: "Receiving Condition",
        sortOrder: 2,
      },
      totalSolids: {
        value: "20-30",
        unit: "% wet basis",
        confidence: "medium",
        provenance: "Literature range for mixed food waste (Zhang et al., 2014; EPA WARM model)",
        group: "physical",
        displayName: "Total Solids (TS)",
        sortOrder: 3,
      },
      volatileSolids: {
        value: "85-95",
        unit: "% of TS",
        confidence: "medium",
        provenance: "Food waste has high organic content and low ash (Zhang et al., 2014; Browne & Murphy, 2013)",
        group: "physical",
        displayName: "Volatile Solids (VS)",
        sortOrder: 4,
      },
      vsTs: {
        value: "0.85-0.95",
        unit: "",
        confidence: "medium",
        provenance: "Derived from VS and TS ranges; typical for source-separated food waste",
        group: "physical",
        displayName: "VS/TS Ratio",
        sortOrder: 5,
      },
      moistureContent: {
        value: "70-80",
        unit: "%",
        confidence: "medium",
        provenance: "Derived from TS range; consistent with mixed food waste composition",
        group: "physical",
        displayName: "Moisture Content",
        sortOrder: 6,
      },
      bulkDensity: {
        value: "45-55",
        unit: "lb/ft³",
        confidence: "low",
        provenance: "Estimated; varies significantly with composition and packaging content",
        group: "physical",
        displayName: "Bulk Density (as received)",
        sortOrder: 7,
      },
      cnRatio: {
        value: "14-22",
        unit: "",
        confidence: "medium",
        provenance: "Literature range for mixed food waste C:N (Zhang et al., 2014; Li et al., 2013)",
        group: "biochemical",
        displayName: "C:N Ratio",
        sortOrder: 8,
      },
      biodegradableFraction: {
        value: "80-90",
        unit: "% of VS",
        confidence: "medium",
        provenance: "Food waste is highly biodegradable; one of the highest-yield AD substrates (Zhang et al., 2014)",
        group: "biochemical",
        displayName: "Biodegradable Fraction of VS",
        sortOrder: 9,
      },
      methanePotential: {
        value: "0.35-0.55",
        unit: "m³ CH₄/kg VS",
        confidence: "medium",
        provenance: "BMP for mixed food waste (Zhang et al., 2014; Browne & Murphy, 2013; Kafle et al., 2013)",
        group: "biochemical",
        displayName: "Biochemical Methane Potential (BMP)",
        sortOrder: 10,
      },
      inertFraction: {
        value: "5-15",
        unit: "% by mass",
        confidence: "medium",
        provenance: "Packaging contamination in commercial food waste; varies by source separation quality",
        group: "contaminants",
        displayName: "Inert/Contaminant Fraction",
        sortOrder: 11,
      },
      preprocessingRequirement: {
        value: "Depackaging, screening, grinding, dilution",
        unit: "",
        confidence: "medium",
        provenance: "Standard food waste preprocessing train for AD facilities (EPA guidelines)",
        group: "contaminants",
        displayName: "Expected Preprocessing",
        sortOrder: 12,
      },
      tkn: {
        value: "4.0-8.0",
        unit: "g/kg wet",
        confidence: "low",
        provenance: "Varies widely with food waste composition; protein-rich waste has higher N",
        group: "extended",
        displayName: "Total Kjeldahl Nitrogen (TKN)",
        sortOrder: 13,
      },
      fogContent: {
        value: "10-30",
        unit: "% of TS",
        confidence: "low",
        provenance: "FOG fraction varies by source; restaurant waste higher than pre-consumer",
        group: "extended",
        displayName: "FOG (Fats, Oils, Grease)",
        sortOrder: 14,
      },
      foamingRisk: {
        value: "Moderate to High",
        unit: "",
        confidence: "medium",
        provenance: "FOG and protein content increase foaming risk; antifoam systems may be needed",
        group: "extended",
        displayName: "Foaming Risk",
        sortOrder: 15,
      },
      inhibitionRisk: {
        value: "Moderate (VFA accumulation, ammonia, salts)",
        unit: "",
        confidence: "medium",
        provenance: "Rapid hydrolysis can cause VFA spikes; high protein sources risk ammonia inhibition",
        group: "extended",
        displayName: "Inhibition Risk",
        sortOrder: 16,
      },
    },
  },
  {
    name: "FOG (Fats, Oils, Grease)",
    aliases: ["fog", "fats oils grease", "grease trap waste", "used cooking oil", "yellow grease", "brown grease", "trap grease", "fats oils and grease"],
    category: "FOG",
    properties: {
      deliveryForm: {
        value: "Liquid / semi-solid",
        unit: "",
        confidence: "medium",
        provenance: "FOG typically received as pumpable liquid or semi-solid from grease traps and interceptors",
        group: "identity",
        displayName: "Delivery Form",
        sortOrder: 1,
      },
      receivingCondition: {
        value: "Raw; may require heating for flow",
        unit: "",
        confidence: "medium",
        provenance: "FOG solidifies at ambient temperature; often requires heated receiving and mixing",
        group: "identity",
        displayName: "Receiving Condition",
        sortOrder: 2,
      },
      totalSolids: {
        value: "5-30",
        unit: "% wet basis",
        confidence: "low",
        provenance: "Wide range depending on source; grease trap waste lower TS than rendered fats (Long et al., 2012)",
        group: "physical",
        displayName: "Total Solids (TS)",
        sortOrder: 3,
      },
      volatileSolids: {
        value: "90-98",
        unit: "% of TS",
        confidence: "medium",
        provenance: "FOG is almost entirely organic with very low ash content (Long et al., 2012)",
        group: "physical",
        displayName: "Volatile Solids (VS)",
        sortOrder: 4,
      },
      vsTs: {
        value: "0.90-0.98",
        unit: "",
        confidence: "medium",
        provenance: "Derived from VS and TS; FOG has highest VS/TS of common AD substrates",
        group: "physical",
        displayName: "VS/TS Ratio",
        sortOrder: 5,
      },
      moistureContent: {
        value: "70-95",
        unit: "%",
        confidence: "low",
        provenance: "Varies widely; grease trap waste is mostly water, rendered fats are drier",
        group: "physical",
        displayName: "Moisture Content",
        sortOrder: 6,
      },
      cnRatio: {
        value: "23-40",
        unit: "",
        confidence: "low",
        provenance: "FOG has high carbon and low nitrogen; C:N varies by fat/protein ratio",
        group: "biochemical",
        displayName: "C:N Ratio",
        sortOrder: 8,
      },
      biodegradableFraction: {
        value: "85-95",
        unit: "% of VS",
        confidence: "medium",
        provenance: "Fats are highly biodegradable but slow to hydrolyze; long-chain fatty acid degradation",
        group: "biochemical",
        displayName: "Biodegradable Fraction of VS",
        sortOrder: 9,
      },
      methanePotential: {
        value: "0.70-1.00",
        unit: "m³ CH₄/kg VS",
        confidence: "medium",
        provenance: "FOG has highest BMP of common AD substrates (Long et al., 2012; Alves et al., 2009)",
        group: "biochemical",
        displayName: "Biochemical Methane Potential (BMP)",
        sortOrder: 10,
      },
      inertFraction: {
        value: "1-5",
        unit: "% by mass",
        confidence: "low",
        provenance: "Grease trap waste may contain grit and debris; rendered fats are cleaner",
        group: "contaminants",
        displayName: "Inert/Contaminant Fraction",
        sortOrder: 11,
      },
      preprocessingRequirement: {
        value: "Heating, screening, metered dosing",
        unit: "",
        confidence: "medium",
        provenance: "FOG must be added gradually to avoid LCFA inhibition; heating ensures pumpability",
        group: "contaminants",
        displayName: "Expected Preprocessing",
        sortOrder: 12,
      },
      foamingRisk: {
        value: "High",
        unit: "",
        confidence: "high",
        provenance: "FOG is the primary cause of foaming in AD systems; antifoam and controlled dosing essential",
        group: "extended",
        displayName: "Foaming Risk",
        sortOrder: 15,
      },
      inhibitionRisk: {
        value: "High (LCFA inhibition at excessive loading)",
        unit: "",
        confidence: "high",
        provenance: "Long-chain fatty acids from FOG hydrolysis inhibit methanogens; limit FOG to 20-30% of OLR",
        group: "extended",
        displayName: "Inhibition Risk",
        sortOrder: 16,
      },
    },
  },
  {
    name: "Crop Residue",
    aliases: ["crop residue", "crop waste", "agricultural residue", "agricultural waste", "corn stover", "wheat straw", "straw", "crop silage", "energy crops", "grass silage"],
    category: "Agricultural Residue",
    properties: {
      deliveryForm: {
        value: "Solid (baled or loose)",
        unit: "",
        confidence: "medium",
        provenance: "Crop residues typically delivered as baled material or loose chopped biomass",
        group: "identity",
        displayName: "Delivery Form",
        sortOrder: 1,
      },
      receivingCondition: {
        value: "Dry, requires mixing/slurrying",
        unit: "",
        confidence: "medium",
        provenance: "High-solids crop residues need dilution or co-digestion with wet substrates",
        group: "identity",
        displayName: "Receiving Condition",
        sortOrder: 2,
      },
      totalSolids: {
        value: "25-50",
        unit: "% wet basis",
        confidence: "medium",
        provenance: "Range for field-dried crop residues (ASAE D384.2; Mussoline et al., 2013)",
        group: "physical",
        displayName: "Total Solids (TS)",
        sortOrder: 3,
      },
      volatileSolids: {
        value: "80-92",
        unit: "% of TS",
        confidence: "medium",
        provenance: "Crop residues have high VS but significant lignocellulosic fraction (Mussoline et al., 2013)",
        group: "physical",
        displayName: "Volatile Solids (VS)",
        sortOrder: 4,
      },
      vsTs: {
        value: "0.80-0.92",
        unit: "",
        confidence: "medium",
        provenance: "Derived from VS and TS ranges for typical crop residues",
        group: "physical",
        displayName: "VS/TS Ratio",
        sortOrder: 5,
      },
      cnRatio: {
        value: "40-80",
        unit: "",
        confidence: "medium",
        provenance: "Crop residues have high C:N; often require co-digestion with nitrogen-rich substrates",
        group: "biochemical",
        displayName: "C:N Ratio",
        sortOrder: 8,
      },
      biodegradableFraction: {
        value: "30-50",
        unit: "% of VS",
        confidence: "medium",
        provenance: "Lignocellulosic structure limits biodegradability; pretreatment improves yield",
        group: "biochemical",
        displayName: "Biodegradable Fraction of VS",
        sortOrder: 9,
      },
      methanePotential: {
        value: "0.15-0.30",
        unit: "m³ CH₄/kg VS",
        confidence: "medium",
        provenance: "BMP for crop residues varies by lignin content (Mussoline et al., 2013; Chandra et al., 2012)",
        group: "biochemical",
        displayName: "Biochemical Methane Potential (BMP)",
        sortOrder: 10,
      },
      preprocessingRequirement: {
        value: "Size reduction, mixing with liquid substrate",
        unit: "",
        confidence: "medium",
        provenance: "Chopping/grinding required; high-solids feedstock needs co-digestion or wet preprocessing",
        group: "contaminants",
        displayName: "Expected Preprocessing",
        sortOrder: 12,
      },
      inhibitionRisk: {
        value: "Low (nutrient deficiency possible)",
        unit: "",
        confidence: "medium",
        provenance: "Low nitrogen may limit microbial activity; high C:N requires nitrogen supplementation or co-digestion",
        group: "extended",
        displayName: "Inhibition Risk",
        sortOrder: 16,
      },
    },
  },
  {
    name: "Poultry Litter",
    aliases: ["poultry litter", "chicken manure", "chicken litter", "poultry manure", "turkey litter", "broiler litter"],
    category: "Animal Manure",
    properties: {
      deliveryForm: {
        value: "Solid (with bedding material)",
        unit: "",
        confidence: "medium",
        provenance: "Poultry litter includes manure mixed with bedding (wood shavings, straw, etc.)",
        group: "identity",
        displayName: "Delivery Form",
        sortOrder: 1,
      },
      receivingCondition: {
        value: "Raw, with bedding; requires dilution",
        unit: "",
        confidence: "medium",
        provenance: "High-solids poultry litter requires water addition for wet AD systems",
        group: "identity",
        displayName: "Receiving Condition",
        sortOrder: 2,
      },
      totalSolids: {
        value: "50-75",
        unit: "% wet basis",
        confidence: "medium",
        provenance: "Poultry litter TS depends on bedding type and cleanout frequency (ASAE D384.2)",
        group: "physical",
        displayName: "Total Solids (TS)",
        sortOrder: 3,
      },
      volatileSolids: {
        value: "60-75",
        unit: "% of TS",
        confidence: "medium",
        provenance: "Lower VS/TS due to bedding material and high ash content (ASAE D384.2)",
        group: "physical",
        displayName: "Volatile Solids (VS)",
        sortOrder: 4,
      },
      vsTs: {
        value: "0.60-0.75",
        unit: "",
        confidence: "medium",
        provenance: "Derived from VS and TS; bedding and ash reduce VS fraction",
        group: "physical",
        displayName: "VS/TS Ratio",
        sortOrder: 5,
      },
      cnRatio: {
        value: "8-15",
        unit: "",
        confidence: "medium",
        provenance: "Poultry manure is nitrogen-rich with low C:N (ASAE D384.2; Kelleher et al., 2002)",
        group: "biochemical",
        displayName: "C:N Ratio",
        sortOrder: 8,
      },
      biodegradableFraction: {
        value: "45-60",
        unit: "% of VS",
        confidence: "medium",
        provenance: "Moderate biodegradability; bedding material reduces overall digestibility",
        group: "biochemical",
        displayName: "Biodegradable Fraction of VS",
        sortOrder: 9,
      },
      methanePotential: {
        value: "0.20-0.35",
        unit: "m³ CH₄/kg VS",
        confidence: "medium",
        provenance: "BMP for poultry litter (Kelleher et al., 2002; Niu et al., 2013)",
        group: "biochemical",
        displayName: "Biochemical Methane Potential (BMP)",
        sortOrder: 10,
      },
      preprocessingRequirement: {
        value: "Dilution, mixing, possible pretreatment for bedding",
        unit: "",
        confidence: "medium",
        provenance: "High-solids content requires significant dilution for wet AD systems",
        group: "contaminants",
        displayName: "Expected Preprocessing",
        sortOrder: 12,
      },
      inhibitionRisk: {
        value: "High (ammonia toxicity at thermophilic temperatures)",
        unit: "",
        confidence: "high",
        provenance: "Very high nitrogen content causes free ammonia inhibition; requires careful OLR management",
        group: "extended",
        displayName: "Inhibition Risk",
        sortOrder: 16,
      },
    },
  },
  {
    name: "Swine Manure",
    aliases: ["swine manure", "pig manure", "hog manure", "swine waste", "pig waste", "hog waste"],
    category: "Animal Manure",
    properties: {
      deliveryForm: {
        value: "Liquid slurry (pit-stored)",
        unit: "",
        confidence: "medium",
        provenance: "Swine manure typically collected via pit storage as liquid slurry",
        group: "identity",
        displayName: "Delivery Form",
        sortOrder: 1,
      },
      receivingCondition: {
        value: "Raw slurry",
        unit: "",
        confidence: "medium",
        provenance: "Swine slurry received directly from storage pits; minimal preprocessing",
        group: "identity",
        displayName: "Receiving Condition",
        sortOrder: 2,
      },
      totalSolids: {
        value: "3-8",
        unit: "% wet basis",
        confidence: "high",
        provenance: "Swine slurry is relatively dilute (ASAE D384.2; EPA AgSTAR)",
        group: "physical",
        displayName: "Total Solids (TS)",
        sortOrder: 3,
      },
      volatileSolids: {
        value: "70-80",
        unit: "% of TS",
        confidence: "medium",
        provenance: "Standard swine manure VS/TS (ASAE D384.2)",
        group: "physical",
        displayName: "Volatile Solids (VS)",
        sortOrder: 4,
      },
      vsTs: {
        value: "0.70-0.80",
        unit: "",
        confidence: "medium",
        provenance: "Derived from VS and TS data for swine manure",
        group: "physical",
        displayName: "VS/TS Ratio",
        sortOrder: 5,
      },
      cnRatio: {
        value: "10-18",
        unit: "",
        confidence: "medium",
        provenance: "Swine manure has moderate-low C:N; nitrogen-rich substrate (ASAE D384.2)",
        group: "biochemical",
        displayName: "C:N Ratio",
        sortOrder: 8,
      },
      methanePotential: {
        value: "0.25-0.35",
        unit: "m³ CH₄/kg VS",
        confidence: "medium",
        provenance: "BMP for swine manure (EPA AgSTAR; Moller et al., 2004)",
        group: "biochemical",
        displayName: "Biochemical Methane Potential (BMP)",
        sortOrder: 10,
      },
      preprocessingRequirement: {
        value: "Mixing, possible solids screening",
        unit: "",
        confidence: "medium",
        provenance: "Swine slurry generally ready for digestion; screening removes debris",
        group: "contaminants",
        displayName: "Expected Preprocessing",
        sortOrder: 12,
      },
      inhibitionRisk: {
        value: "Moderate (ammonia, hydrogen sulfide)",
        unit: "",
        confidence: "medium",
        provenance: "High nitrogen and sulfur content; H2S in biogas requires treatment",
        group: "extended",
        displayName: "Inhibition Risk",
        sortOrder: 16,
      },
    },
  },
  {
    name: "Municipal Wastewater Sludge",
    aliases: ["wastewater sludge", "sewage sludge", "biosolids", "wwtf sludge", "wwtp sludge", "primary sludge", "waste activated sludge", "was", "municipal sludge"],
    category: "Wastewater Sludge",
    properties: {
      deliveryForm: {
        value: "Thickened liquid sludge",
        unit: "",
        confidence: "medium",
        provenance: "WWTP sludge typically thickened to 3-6% TS before digestion",
        group: "identity",
        displayName: "Delivery Form",
        sortOrder: 1,
      },
      receivingCondition: {
        value: "Thickened; blended primary + secondary",
        unit: "",
        confidence: "medium",
        provenance: "Standard practice is to blend primary and WAS before mesophilic AD",
        group: "identity",
        displayName: "Receiving Condition",
        sortOrder: 2,
      },
      totalSolids: {
        value: "3-6",
        unit: "% wet basis",
        confidence: "medium",
        provenance: "Typical thickened mixed sludge TS for AD feed (WEF MOP 8)",
        group: "physical",
        displayName: "Total Solids (TS)",
        sortOrder: 3,
      },
      volatileSolids: {
        value: "65-80",
        unit: "% of TS",
        confidence: "medium",
        provenance: "Blended primary + WAS VS/TS range (WEF MOP 8; Metcalf & Eddy)",
        group: "physical",
        displayName: "Volatile Solids (VS)",
        sortOrder: 4,
      },
      vsTs: {
        value: "0.65-0.80",
        unit: "",
        confidence: "medium",
        provenance: "Derived from VS and TS; depends on primary/WAS blend ratio",
        group: "physical",
        displayName: "VS/TS Ratio",
        sortOrder: 5,
      },
      cnRatio: {
        value: "8-15",
        unit: "",
        confidence: "medium",
        provenance: "Wastewater sludge is nitrogen-rich; low C:N (Metcalf & Eddy)",
        group: "biochemical",
        displayName: "C:N Ratio",
        sortOrder: 8,
      },
      methanePotential: {
        value: "0.20-0.35",
        unit: "m³ CH₄/kg VS",
        confidence: "medium",
        provenance: "BMP depends on primary/WAS ratio; primary sludge yields more methane (WEF MOP 8)",
        group: "biochemical",
        displayName: "Biochemical Methane Potential (BMP)",
        sortOrder: 10,
      },
      preprocessingRequirement: {
        value: "Thickening, screening, blending",
        unit: "",
        confidence: "medium",
        provenance: "Standard WWTP sludge preprocessing before AD (WEF MOP 8)",
        group: "contaminants",
        displayName: "Expected Preprocessing",
        sortOrder: 12,
      },
      inhibitionRisk: {
        value: "Low to Moderate (heavy metals, industrial discharges)",
        unit: "",
        confidence: "medium",
        provenance: "Industrial pretreatment program compliance reduces inhibition risk; monitor heavy metals",
        group: "extended",
        displayName: "Inhibition Risk",
        sortOrder: 16,
      },
    },
  },
];

export function matchFeedstockType(feedstockName: string): FeedstockProfile | undefined {
  const lower = feedstockName.toLowerCase().trim();
  for (const profile of FEEDSTOCK_LIBRARY) {
    if (profile.name.toLowerCase() === lower) return profile;
    for (const alias of profile.aliases) {
      if (lower.includes(alias) || alias.includes(lower)) return profile;
    }
  }
  return undefined;
}

const SLUDGE_ONLY_KEYS = new Set([
  "deliveryForm",
  "receivingCondition",
  "preprocessingRequirement",
]);

const SOLIDS_ONLY_KEYS = new Set([
  "totalSolids",
  "volatileSolids",
  "vsTs",
  "moistureContent",
  "bulkDensity",
  "cnRatio",
  "methanePotential",
  "biodegradableFraction",
  "inertFraction",
]);

export function enrichFeedstockSpecs(
  feedstockType: string,
  userProvidedParams: Record<string, { value: string; unit?: string; extractionSource?: string }>,
  projectType?: string | null,
): Record<string, EnrichedFeedstockSpec> {
  const profile = matchFeedstockType(feedstockType);
  const specs: Record<string, EnrichedFeedstockSpec> = {};
  const isTypeA = projectType === "A";

  if (profile) {
    for (const [key, prop] of Object.entries(profile.properties)) {
      if (isTypeA && SLUDGE_ONLY_KEYS.has(key)) {
        continue;
      }
      if (isTypeA && SOLIDS_ONLY_KEYS.has(key) && prop.unit.includes("%")) {
        continue;
      }
      specs[key] = {
        value: prop.value,
        unit: prop.unit,
        source: "estimated_default",
        confidence: prop.confidence,
        provenance: prop.provenance,
        group: prop.group,
        displayName: prop.displayName,
        sortOrder: prop.sortOrder,
      };
    }
  }

  const paramKeyMap: Record<string, string> = {
    "total solids": "totalSolids",
    "total solids (ts)": "totalSolids",
    "ts": "totalSolids",
    "ts%": "totalSolids",
    "ts (%)": "totalSolids",
    "volatile solids": "volatileSolids",
    "volatile solids (vs)": "volatileSolids",
    "vs": "volatileSolids",
    "vs (% of ts)": "volatileSolids",
    "vs/ts": "vsTs",
    "vs/ts ratio": "vsTs",
    "vs to ts ratio": "vsTs",
    "moisture": "moistureContent",
    "moisture content": "moistureContent",
    "moisture (%)": "moistureContent",
    "bulk density": "bulkDensity",
    "bulk density (as received)": "bulkDensity",
    "density": "bulkDensity",
    "c:n": "cnRatio",
    "c:n ratio": "cnRatio",
    "cn ratio": "cnRatio",
    "c/n ratio": "cnRatio",
    "carbon to nitrogen ratio": "cnRatio",
    "carbon nitrogen ratio": "cnRatio",
    "carbon-to-nitrogen ratio": "cnRatio",
    "bmp": "methanePotential",
    "methane potential": "methanePotential",
    "biochemical methane potential": "methanePotential",
    "biochemical methane potential (bmp)": "methanePotential",
    "methane yield": "methanePotential",
    "biodegradable fraction": "biodegradableFraction",
    "biodegradable fraction of vs": "biodegradableFraction",
    "biodegradability": "biodegradableFraction",
    "inert fraction": "inertFraction",
    "inert/contaminant fraction": "inertFraction",
    "contaminant fraction": "inertFraction",
    "inerts": "inertFraction",
    "preprocessing": "preprocessingRequirement",
    "expected preprocessing": "preprocessingRequirement",
    "preprocessing requirement": "preprocessingRequirement",
    "expected preprocessing requirement": "preprocessingRequirement",
    "delivery form": "deliveryForm",
    "form": "deliveryForm",
    "receiving condition": "receivingCondition",
    "tkn": "tkn",
    "total kjeldahl nitrogen": "tkn",
    "total kjeldahl nitrogen (tkn)": "tkn",
    "ammonia": "ammoniaN",
    "ammonia-n": "ammoniaN",
    "nh3-n": "ammoniaN",
    "foaming risk": "foamingRisk",
    "inhibition risk": "inhibitionRisk",
    "pathogen risk": "pathogenRisk",
    "pathogen risk class": "pathogenRisk",
    "fog": "fogContent",
    "fog content": "fogContent",
    "fats oils grease": "fogContent",
    "fats, oils, grease": "fogContent",
    "lipid fraction": "lipidFraction",
    "lipids": "lipidFraction",
  };

  if (profile) {
    for (const [key, prop] of Object.entries(profile.properties)) {
      const displayLower = prop.displayName.toLowerCase();
      if (!paramKeyMap[displayLower]) {
        paramKeyMap[displayLower] = key;
      }
    }
  }

  for (const [paramName, paramData] of Object.entries(userProvidedParams)) {
    const normalizedName = paramName.toLowerCase().trim();
    let mappedKey = paramKeyMap[normalizedName];

    if (!mappedKey) {
      let bestAlias = "";
      for (const [alias, key] of Object.entries(paramKeyMap)) {
        if (normalizedName.includes(alias) || alias.includes(normalizedName)) {
          if (alias.length > bestAlias.length) {
            bestAlias = alias;
            mappedKey = key;
          }
        }
      }
    }

    const resolvedSource: EnrichedFeedstockSpec["source"] =
      paramData.extractionSource === "ai_extraction" ? "ai_inferred" : "user_provided";
    const resolvedProvenance = resolvedSource === "ai_inferred"
      ? "AI-inferred value from project input"
      : "User-provided value from project input";
    const resolvedConfidence: EnrichedFeedstockSpec["confidence"] =
      resolvedSource === "ai_inferred" ? "medium" : "high";

    if (mappedKey && specs[mappedKey]) {
      specs[mappedKey] = {
        ...specs[mappedKey],
        value: paramData.value,
        unit: paramData.unit || specs[mappedKey].unit,
        source: resolvedSource,
        confidence: resolvedConfidence,
        provenance: resolvedProvenance,
      };
    } else if (mappedKey) {
      specs[mappedKey] = {
        value: paramData.value,
        unit: paramData.unit || "",
        source: resolvedSource,
        confidence: resolvedConfidence,
        provenance: resolvedProvenance,
        group: "physical",
        displayName: paramName,
        sortOrder: 50,
      };
    }
  }

  return specs;
}

export interface BiogasProfile {
  name: string;
  aliases: string[];
  properties: Record<string, { value: string; unit: string; displayName: string; group: string; sortOrder: number; provenance: string }>;
}

const BIOGAS_PROFILES: BiogasProfile[] = [
  {
    name: "WWTP Digester Gas",
    aliases: ["wwtp", "wastewater", "municipal digester", "sewage digester", "wwtf", "water reclamation", "wpcp"],
    properties: {
      ch4: { value: "55-65", unit: "%", displayName: "Methane (CH₄)", group: "composition", sortOrder: 1, provenance: "Typical WWTP digester gas composition (WEF MOP 8)" },
      co2: { value: "35-45", unit: "%", displayName: "Carbon Dioxide (CO₂)", group: "composition", sortOrder: 2, provenance: "Typical WWTP digester gas composition" },
      h2s: { value: "500-3,000", unit: "ppmv", displayName: "Hydrogen Sulfide (H₂S)", group: "contaminants", sortOrder: 3, provenance: "Typical WWTP digester gas; highly variable by sludge characteristics" },
      siloxanes: { value: "5-50", unit: "mg/m³", displayName: "Siloxanes", group: "contaminants", sortOrder: 4, provenance: "WWTP digester gas typically has higher siloxanes from consumer products in sewage" },
      o2: { value: "0.1-0.5", unit: "%", displayName: "Oxygen (O₂)", group: "composition", sortOrder: 5, provenance: "Trace O₂ from air leaks in gas collection system" },
      n2: { value: "1-3", unit: "%", displayName: "Nitrogen (N₂)", group: "composition", sortOrder: 6, provenance: "Trace N₂ from air ingress" },
      moisture: { value: "Saturated", unit: "at gas temp", displayName: "Moisture", group: "physical", sortOrder: 7, provenance: "Biogas exits digester water-saturated" },
      heatingValue: { value: "550-650", unit: "BTU/scf", displayName: "Heating Value (LHV)", group: "physical", sortOrder: 8, provenance: "Based on 55-65% CH₄ content" },
    },
  },
  {
    name: "Landfill Gas",
    aliases: ["landfill", "lfg", "municipal solid waste", "msw landfill"],
    properties: {
      ch4: { value: "45-55", unit: "%", displayName: "Methane (CH₄)", group: "composition", sortOrder: 1, provenance: "Typical landfill gas composition (EPA AP-42, Chapter 2.4)" },
      co2: { value: "35-45", unit: "%", displayName: "Carbon Dioxide (CO₂)", group: "composition", sortOrder: 2, provenance: "Typical landfill gas composition" },
      h2s: { value: "50-500", unit: "ppmv", displayName: "Hydrogen Sulfide (H₂S)", group: "contaminants", sortOrder: 3, provenance: "Landfill gas typically lower H₂S than digester gas" },
      siloxanes: { value: "1-20", unit: "mg/m³", displayName: "Siloxanes", group: "contaminants", sortOrder: 4, provenance: "Variable; depends on waste composition" },
      o2: { value: "0.5-3", unit: "%", displayName: "Oxygen (O₂)", group: "composition", sortOrder: 5, provenance: "Air infiltration through landfill cover" },
      n2: { value: "2-15", unit: "%", displayName: "Nitrogen (N₂)", group: "composition", sortOrder: 6, provenance: "Air infiltration; can be significant in older wells" },
      moisture: { value: "Saturated", unit: "at gas temp", displayName: "Moisture", group: "physical", sortOrder: 7, provenance: "Landfill gas exits saturated with moisture" },
      heatingValue: { value: "450-550", unit: "BTU/scf", displayName: "Heating Value (LHV)", group: "physical", sortOrder: 8, provenance: "Based on 45-55% CH₄ content" },
      nmoc: { value: "500-1,500", unit: "ppmv as hexane", displayName: "NMOCs", group: "contaminants", sortOrder: 9, provenance: "Non-methane organic compounds typical for MSW landfills" },
    },
  },
  {
    name: "Dairy Digester Gas",
    aliases: ["dairy", "dairy manure", "cow manure", "cattle digester", "farm digester", "ag digester", "agricultural digester"],
    properties: {
      ch4: { value: "55-65", unit: "%", displayName: "Methane (CH₄)", group: "composition", sortOrder: 1, provenance: "Typical dairy manure digester gas (AgSTAR)" },
      co2: { value: "35-45", unit: "%", displayName: "Carbon Dioxide (CO₂)", group: "composition", sortOrder: 2, provenance: "Typical dairy digester gas composition" },
      h2s: { value: "1,000-5,000", unit: "ppmv", displayName: "Hydrogen Sulfide (H₂S)", group: "contaminants", sortOrder: 3, provenance: "Dairy manure digester gas; high sulfur from protein in feed" },
      siloxanes: { value: "< 1", unit: "mg/m³", displayName: "Siloxanes", group: "contaminants", sortOrder: 4, provenance: "Agricultural biogas typically has negligible siloxanes" },
      o2: { value: "0.1-0.5", unit: "%", displayName: "Oxygen (O₂)", group: "composition", sortOrder: 5, provenance: "Minimal air ingress in covered lagoon/plug flow systems" },
      n2: { value: "1-3", unit: "%", displayName: "Nitrogen (N₂)", group: "composition", sortOrder: 6, provenance: "Trace N₂ from air ingress" },
      moisture: { value: "Saturated", unit: "at gas temp", displayName: "Moisture", group: "physical", sortOrder: 7, provenance: "Biogas exits digester water-saturated" },
      heatingValue: { value: "550-650", unit: "BTU/scf", displayName: "Heating Value (LHV)", group: "physical", sortOrder: 8, provenance: "Based on 55-65% CH₄ content" },
    },
  },
  {
    name: "Food Waste Digester Gas",
    aliases: ["food waste", "food processing", "organic waste digester", "industrial digester", "co-digestion"],
    properties: {
      ch4: { value: "58-68", unit: "%", displayName: "Methane (CH₄)", group: "composition", sortOrder: 1, provenance: "Food waste AD biogas typically higher CH₄ due to high VS destruction" },
      co2: { value: "30-40", unit: "%", displayName: "Carbon Dioxide (CO₂)", group: "composition", sortOrder: 2, provenance: "Typical food waste digester gas composition" },
      h2s: { value: "500-3,000", unit: "ppmv", displayName: "Hydrogen Sulfide (H₂S)", group: "contaminants", sortOrder: 3, provenance: "Variable; depends on protein content of food waste" },
      siloxanes: { value: "< 1", unit: "mg/m³", displayName: "Siloxanes", group: "contaminants", sortOrder: 4, provenance: "Food waste biogas typically has negligible siloxanes" },
      o2: { value: "0.1-0.5", unit: "%", displayName: "Oxygen (O₂)", group: "composition", sortOrder: 5, provenance: "Minimal air ingress in well-sealed digesters" },
      n2: { value: "1-3", unit: "%", displayName: "Nitrogen (N₂)", group: "composition", sortOrder: 6, provenance: "Trace N₂" },
      moisture: { value: "Saturated", unit: "at gas temp", displayName: "Moisture", group: "physical", sortOrder: 7, provenance: "Biogas exits digester water-saturated" },
      heatingValue: { value: "580-680", unit: "BTU/scf", displayName: "Heating Value (LHV)", group: "physical", sortOrder: 8, provenance: "Based on 58-68% CH₄ content" },
    },
  },
];

function matchBiogasProfile(sourceType: string): BiogasProfile | null {
  const lower = sourceType.toLowerCase();
  for (const profile of BIOGAS_PROFILES) {
    if (lower.includes(profile.name.toLowerCase())) return profile;
    for (const alias of profile.aliases) {
      if (lower.includes(alias)) return profile;
    }
  }
  return BIOGAS_PROFILES[0];
}

export function enrichBiogasSpecs(
  biogasSourceType: string,
  userProvidedParams: Record<string, { value: string; unit?: string; extractionSource?: string }>,
): Record<string, EnrichedFeedstockSpec> {
  const profile = matchBiogasProfile(biogasSourceType);
  const specs: Record<string, EnrichedFeedstockSpec> = {};

  if (profile) {
    for (const [key, prop] of Object.entries(profile.properties)) {
      specs[key] = {
        value: prop.value,
        unit: prop.unit,
        source: "estimated_default",
        confidence: "medium",
        provenance: prop.provenance,
        group: prop.group as EnrichedFeedstockSpec["group"],
        displayName: prop.displayName,
        sortOrder: prop.sortOrder,
      };
    }
  }

  const biogasParamMap: Record<string, string> = {
    "ch4": "ch4",
    "methane": "ch4",
    "ch₄": "ch4",
    "methane content": "ch4",
    "co2": "co2",
    "carbon dioxide": "co2",
    "co₂": "co2",
    "h2s": "h2s",
    "hydrogen sulfide": "h2s",
    "h₂s": "h2s",
    "siloxanes": "siloxanes",
    "siloxane": "siloxanes",
    "o2": "o2",
    "oxygen": "o2",
    "o₂": "o2",
    "n2": "n2",
    "nitrogen": "n2",
    "moisture": "moisture",
    "water content": "moisture",
    "heating value": "heatingValue",
    "btu": "heatingValue",
    "hhv": "heatingValue",
    "lhv": "heatingValue",
    "current disposition": "currentDisposition",
    "disposition": "currentDisposition",
    "variability": "variability",
    "flow variability": "variability",
    "nmoc": "nmoc",
    "nmocs": "nmoc",
  };

  for (const [paramName, paramData] of Object.entries(userProvidedParams)) {
    const normalizedName = paramName.toLowerCase().trim();
    let mappedKey = biogasParamMap[normalizedName];

    if (!mappedKey) {
      for (const [alias, key] of Object.entries(biogasParamMap)) {
        if (normalizedName.includes(alias) || alias.includes(normalizedName)) {
          mappedKey = key;
          break;
        }
      }
    }

    const resolvedSource: EnrichedFeedstockSpec["source"] =
      paramData.extractionSource === "ai_extraction" ? "ai_inferred" : "user_provided";
    const resolvedProvenance = resolvedSource === "ai_inferred"
      ? "AI-inferred value from project input"
      : "User-provided value from project input";
    const resolvedConfidence: EnrichedFeedstockSpec["confidence"] =
      resolvedSource === "ai_inferred" ? "medium" : "high";

    if (mappedKey && specs[mappedKey]) {
      specs[mappedKey] = {
        ...specs[mappedKey],
        value: paramData.value,
        unit: paramData.unit || specs[mappedKey].unit,
        source: resolvedSource,
        confidence: resolvedConfidence,
        provenance: resolvedProvenance,
      };
    } else if (mappedKey) {
      const displayNames: Record<string, string> = {
        currentDisposition: "Current Disposition",
        variability: "Flow Variability",
      };
      specs[mappedKey] = {
        value: paramData.value,
        unit: paramData.unit || "",
        source: resolvedSource,
        confidence: resolvedConfidence,
        provenance: resolvedProvenance,
        group: "physical",
        displayName: displayNames[mappedKey] || paramName,
        sortOrder: 50,
      };
    }
  }

  return specs;
}
