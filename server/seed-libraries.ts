import { storage } from "./storage";
import { FEEDSTOCK_LIBRARY, WASTEWATER_INFLUENT_LIBRARY } from "@shared/feedstock-library";
import { OUTPUT_CRITERIA_LIBRARY } from "@shared/output-criteria-library";

export async function seedLibraryProfiles() {
  const existingFeedstock = await storage.getLibraryProfilesByType("feedstock");
  const existingWastewater = await storage.getLibraryProfilesByType("wastewater_influent");
  const existingOutput = await storage.getLibraryProfilesByType("output_criteria");

  const existingFeedstockNames = new Set(existingFeedstock.map(p => p.name));
  const missingFeedstock = FEEDSTOCK_LIBRARY.filter(f => !existingFeedstockNames.has(f.name));
  if (missingFeedstock.length > 0) {
    console.log(`Seeding ${missingFeedstock.length} missing feedstock library profiles (${existingFeedstock.length} already exist)...`);
    for (const f of missingFeedstock) {
      const sortOrder = FEEDSTOCK_LIBRARY.indexOf(f);
      await storage.createLibraryProfile({
        libraryType: "feedstock",
        name: f.name,
        aliases: f.aliases,
        category: f.category,
        properties: f.properties,
        sortOrder,
        isCustomized: false,
      });
    }
    console.log(`Seeded ${missingFeedstock.length} new feedstock profiles. Total: ${existingFeedstock.length + missingFeedstock.length}.`);
  }

  const existingWastewaterNames = new Set(existingWastewater.map(p => p.name));
  const missingWastewater = WASTEWATER_INFLUENT_LIBRARY.filter(w => !existingWastewaterNames.has(w.name));
  if (missingWastewater.length > 0) {
    console.log(`Seeding ${missingWastewater.length} missing wastewater influent library profiles...`);
    for (const w of missingWastewater) {
      const sortOrder = WASTEWATER_INFLUENT_LIBRARY.indexOf(w);
      await storage.createLibraryProfile({
        libraryType: "wastewater_influent",
        name: w.name,
        aliases: w.aliases,
        category: w.category,
        properties: w.properties,
        sortOrder,
        isCustomized: false,
      });
    }
    console.log(`Seeded ${missingWastewater.length} new wastewater influent profiles.`);
  }

  const existingOutputNames = new Set(existingOutput.map(p => p.name));
  const missingOutput = OUTPUT_CRITERIA_LIBRARY.filter(o => !existingOutputNames.has(o.name));
  if (missingOutput.length > 0) {
    console.log(`Seeding ${missingOutput.length} missing output criteria library profiles...`);
    for (const o of missingOutput) {
      const sortOrder = OUTPUT_CRITERIA_LIBRARY.indexOf(o);
      await storage.createLibraryProfile({
        libraryType: "output_criteria",
        name: o.name,
        aliases: o.aliases,
        category: o.category,
        properties: o.criteria,
        sortOrder,
        isCustomized: false,
      });
    }
    console.log(`Seeded ${missingOutput.length} new output criteria profiles.`);
  }
}

export async function seedValidationConfig() {
  const existing = await storage.getAllValidationConfig();
  if (existing.length > 0) return;

  console.log("Seeding validation config...");

  const configs = [
    {
      configKey: "min_flow_factor",
      configValue: { value: 0.6, description: "Multiplier to estimate minimum flow from average flow" },
      description: "Factor applied to average flow to estimate minimum flow (default: 0.6x average)",
      category: "flow_estimation",
    },
    {
      configKey: "peak_flow_factor_default",
      configValue: { value: 2.0, description: "Default peak flow multiplier when industry-specific factor is unavailable" },
      description: "Default peak-to-average flow factor (default: 2.0x average)",
      category: "flow_estimation",
    },
    {
      configKey: "peak_flow_factors_by_industry",
      configValue: {
        food_processing: 3.0,
        meat_poultry: 2.5,
        dairy: 2.0,
        brewery: 2.5,
        ethanol: 1.5,
        default: 2.0,
      },
      description: "Peak flow factors by industry type for Type A wastewater projects",
      category: "flow_estimation",
    },
    {
      configKey: "ppd_conversion_factor",
      configValue: { value: 8.34, description: "Pounds per day = mg/L × MGD × 8.34" },
      description: "Conversion factor for mass loading calculation (ppd = mg/L × MGD × 8.34)",
      category: "unit_conversion",
    },
    {
      configKey: "concentration_parameters",
      configValue: ["bod", "bod5", "cod", "tkn", "totalnitrogen", "tn"],
      description: "Parameter keys treated as concentrations (mg/L) for dual-unit display",
      category: "type_a_display",
    },
    {
      configKey: "blocked_solids_parameters",
      configValue: [
        "totalsolids", "ts", "volatilesolids", "vs", "vsts", "vstsratio",
        "moisturecontent", "moisture", "bulkdensity", "density",
        "bmp", "biochemicalmethane", "biochemicalmethanepotential",
        "cn", "cnratio", "carbonnitrogenratio",
        "deliveryform", "receivingcondition", "preprocessing"
      ],
      description: "Parameters blocked from Type A wastewater projects (solids-basis only)",
      category: "type_a_validation",
    },
    {
      configKey: "biogas_ch4_threshold",
      configValue: { value: 90, description: "CH₄ % below which biogas is rejected from RNG gas-quality table" },
      description: "Methane content threshold for biogas vs RNG classification",
      category: "gas_quality",
    },
    {
      configKey: "rng_ch4_minimum",
      configValue: { value: 96, description: "Minimum CH₄ % for pipeline-quality RNG specification" },
      description: "Minimum methane content for pipeline-quality RNG",
      category: "gas_quality",
    },
    {
      configKey: "ts_tss_threshold",
      configValue: { value: 10000, description: "TSS values above 10,000 mg/L flagged as potential TS misreport" },
      description: "Threshold (mg/L) above which TSS values trigger TS/TSS guardrail warning",
      category: "guardrails",
    },
  ];

  for (const config of configs) {
    await storage.upsertValidationConfig(config);
  }

  console.log(`Seeded ${configs.length} validation config entries.`);
}
