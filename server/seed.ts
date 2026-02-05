import { db } from "./storage";
import { projects, scenarios, textEntries, extractedParameters, upifRecords } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedDatabase() {
  try {
    // Check if we already have data
    const existingProjects = await db.select().from(projects).limit(1);
    if (existingProjects.length > 0) {
      console.log("Database already seeded, skipping...");
      return;
    }

    console.log("Seeding database with demo data...");

    // Create demo projects
    const [project1] = await db.insert(projects).values({
      name: "Quincy Biogas Facility",
      description: "Anaerobic digestion facility processing agricultural waste from local food processors in the Columbia Basin.",
    }).returning();

    const [project2] = await db.insert(projects).values({
      name: "Moses Lake RNG Project",
      description: "Renewable natural gas production facility utilizing dairy manure and food processing waste.",
    }).returning();

    const [project3] = await db.insert(projects).values({
      name: "Yakima Valley Digester",
      description: "Community-scale digester serving multiple dairy operations in the Yakima Valley.",
    }).returning();

    // Create scenarios for project 1
    const [scenario1] = await db.insert(scenarios).values({
      projectId: project1.id,
      name: "Base Case - 100K TPY",
      status: "in_review",
    }).returning();

    const [scenario2] = await db.insert(scenarios).values({
      projectId: project1.id,
      name: "High Capacity Option",
      status: "draft",
    }).returning();

    // Create scenario for project 2
    const [scenario3] = await db.insert(scenarios).values({
      projectId: project2.id,
      name: "Phase 1 Development",
      status: "confirmed",
      confirmedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    }).returning();

    // Add text entries for scenario 1
    await db.insert(textEntries).values([
      {
        scenarioId: scenario1.id,
        content: "100,000 tons per year of potato waste from McCain Foods processing facility. The waste stream includes peels, cull potatoes, and starch wastewater. Approximate TS of 15% and VS/TS ratio of 0.87.",
        category: "feedstock",
      },
      {
        scenarioId: scenario1.id,
        content: "Project site in Quincy, Washington, adjacent to the existing processing facility. Good access to natural gas pipeline infrastructure within 2 miles.",
        category: "location",
      },
      {
        scenarioId: scenario1.id,
        content: "Looking to produce RNG for pipeline injection. Digestate solids will be land applied to nearby agricultural fields. Liquid effluent to be treated and discharged to Moses Lake WWTP.",
        category: "output_requirements",
      },
      {
        scenarioId: scenario1.id,
        content: "Budget of approximately $18M for construction. Must use proven digester technology with at least 5 reference facilities. Targeting 24-month construction timeline.",
        category: "constraints",
      },
    ]);

    // Add extracted parameters for scenario 1
    await db.insert(extractedParameters).values([
      { scenarioId: scenario1.id, category: "feedstock", name: "Feedstock Type", value: "Potato Processing Waste", source: "user_input", confidence: "high", isConfirmed: true },
      { scenarioId: scenario1.id, category: "feedstock", name: "Volume/Capacity", value: "100,000", unit: "tons/year", source: "user_input", confidence: "high", isConfirmed: true },
      { scenarioId: scenario1.id, category: "feedstock", name: "Total Solids (TS)", value: "15", unit: "%", source: "user_input", confidence: "high", isConfirmed: true },
      { scenarioId: scenario1.id, category: "feedstock", name: "VS/TS Ratio", value: "0.87", unit: "", source: "user_input", confidence: "high", isConfirmed: true },
      { scenarioId: scenario1.id, category: "feedstock", name: "C:N Ratio", value: "22-28", unit: "", source: "predicted", confidence: "medium", isConfirmed: false },
      { scenarioId: scenario1.id, category: "feedstock", name: "BOD", value: "15,000-25,000", unit: "mg/L", source: "predicted", confidence: "low", isConfirmed: false },
      { scenarioId: scenario1.id, category: "location", name: "Project Location", value: "Quincy, Washington", source: "user_input", confidence: "high", isConfirmed: true },
      { scenarioId: scenario1.id, category: "output_requirements", name: "Primary Output", value: "Renewable Natural Gas (RNG)", source: "user_input", confidence: "high", isConfirmed: true },
      { scenarioId: scenario1.id, category: "output_requirements", name: "Solids Handling", value: "Land Application", source: "user_input", confidence: "high", isConfirmed: true },
      { scenarioId: scenario1.id, category: "output_requirements", name: "Liquid Handling", value: "Discharge to Moses Lake WWTP", source: "user_input", confidence: "high", isConfirmed: true },
      { scenarioId: scenario1.id, category: "pricing", name: "Project Budget", value: "18,000,000", unit: "USD", source: "user_input", confidence: "medium", isConfirmed: false },
      { scenarioId: scenario1.id, category: "constraints", name: "Technology Requirement", value: "Proven digester technology with 5+ reference facilities", source: "user_input", confidence: "high", isConfirmed: true },
      { scenarioId: scenario1.id, category: "constraints", name: "Timeline", value: "24-month construction", source: "user_input", confidence: "high", isConfirmed: true },
    ]);

    // Create UPIF for scenario 1
    await db.insert(upifRecords).values({
      scenarioId: scenario1.id,
      feedstockType: "Potato Processing Waste",
      feedstockVolume: "100,000",
      feedstockUnit: "tons/year",
      feedstockParameters: {
        "TS": { value: "15", unit: "%" },
        "VS/TS": { value: "0.87", unit: "" },
        "C:N": { value: "22-28", unit: "" },
      },
      outputRequirements: "RNG for pipeline injection; Land application of digestate solids; Liquid effluent discharge to Moses Lake WWTP",
      location: "Quincy, Washington",
      pricingInputs: { "Tipping Fee": "Negotiated with McCain Foods" },
      pricingOutputs: { "RNG": "Market rate + LCFS credits" },
      constraints: [
        "Must use proven digester technology with 5+ reference facilities",
        "24-month construction timeline",
        "Budget cap of $18M",
      ],
      isConfirmed: false,
    });

    // Add text entries for scenario 3 (confirmed)
    await db.insert(textEntries).values([
      {
        scenarioId: scenario3.id,
        content: "50,000 tons per year of dairy manure from 5 local dairies plus 10,000 tons of food processing waste from Lamb Weston facility.",
        category: "feedstock",
      },
      {
        scenarioId: scenario3.id,
        content: "Located in Moses Lake, Grant County, Washington. Site has direct access to Williams Northwest Pipeline.",
        category: "location",
      },
    ]);

    // Create UPIF for scenario 3 (confirmed)
    await db.insert(upifRecords).values({
      scenarioId: scenario3.id,
      feedstockType: "Dairy Manure + Food Processing Waste",
      feedstockVolume: "60,000",
      feedstockUnit: "tons/year",
      feedstockParameters: {
        "TS": { value: "10-12", unit: "%" },
        "VS/TS": { value: "0.80", unit: "" },
      },
      outputRequirements: "RNG for pipeline injection via Williams Northwest Pipeline",
      location: "Moses Lake, Grant County, Washington",
      pricingInputs: {},
      pricingOutputs: {},
      constraints: ["Direct pipeline access required"],
      isConfirmed: true,
      confirmedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    console.log("Database seeded successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
