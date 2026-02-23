/**
 * Shared data model for the UPIF (Unified Project Intake Form) application.
 * This schema defines all database tables and TypeScript types used by both
 * the frontend and backend. It ensures type consistency across the entire application
 * and serves as the single source of truth for the database structure.
 */

import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Projects table: Top-level containers for related scenarios.
 * Each project groups multiple evaluation scenarios together for organizational purposes.
 */
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schema for projects - validates and types data when creating a new project
export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true });
// TypeScript type for inserting a project (excludes auto-generated fields)
export type InsertProject = z.infer<typeof insertProjectSchema>;
// TypeScript type for selecting a project from the database (includes all fields)
export type Project = typeof projects.$inferSelect;

/**
 * Scenarios table: Individual evaluation scenarios within a project.
 * Each scenario has a preferred LLM model and supports clarifying Q&A for better accuracy.
 */
export const scenarios = pgTable("scenarios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft, in_review, confirmed
  preferredModel: text("preferred_model").default("gpt5"), // gpt5, claude, claude-opus
  projectType: text("project_type"), // A, B, C, D (WWT, RNG Greenfield, RNG Bolt-On, Hybrid)
  projectTypeConfirmed: boolean("project_type_confirmed").default(false),
  clarifyingQuestions: jsonb("clarifying_questions"), // Array of { question: string }
  clarifyingAnswers: jsonb("clarifying_answers"), // Array of { question: string, answer: string }
  createdAt: timestamp("created_at").defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at"),
});

// Insert schema for scenarios - validates and types data when creating a new scenario
export const insertScenarioSchema = createInsertSchema(scenarios).omit({ id: true, createdAt: true, confirmedAt: true });
// TypeScript type for inserting a scenario (excludes auto-generated fields)
export type InsertScenario = z.infer<typeof insertScenarioSchema>;
// TypeScript type for selecting a scenario from the database (includes all fields)
export type Scenario = typeof scenarios.$inferSelect;

/**
 * Text Entries table: Free-form text inputs categorized by type.
 * Stores user-provided content organized into categories: feedstock, output_requirements, location, constraints.
 */
export const textEntries = pgTable("text_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  category: text("category"), // feedstock, output_requirements, location, constraints
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schema for text entries - validates and types data when creating a new text entry
export const insertTextEntrySchema = createInsertSchema(textEntries).omit({ id: true, createdAt: true });
// TypeScript type for inserting a text entry (excludes auto-generated fields)
export type InsertTextEntry = z.infer<typeof insertTextEntrySchema>;
// TypeScript type for selecting a text entry from the database (includes all fields)
export type TextEntry = typeof textEntries.$inferSelect;

/**
 * Documents table: Uploaded files with extracted text for AI processing.
 * Stores file metadata and extracted text content used for parameter extraction and analysis.
 */
export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: text("size").notNull(),
  extractedText: text("extracted_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schema for documents - validates and types data when uploading a new document
export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, createdAt: true });
// TypeScript type for inserting a document (excludes auto-generated fields)
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
// TypeScript type for selecting a document from the database (includes all fields)
export type Document = typeof documents.$inferSelect;

/**
 * Extracted Parameters table: AI-extracted parameters with confidence levels and source tracking.
 * Stores individual parameters extracted or predicted by AI, including their values, units, source, and confidence scores.
 */
export const extractedParameters = pgTable("extracted_parameters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // feedstock, output_requirements, location, constraints
  name: text("name").notNull(),
  value: text("value"),
  unit: text("unit"),
  source: text("source").notNull(), // user_input, document, predicted
  confidence: text("confidence"), // high, medium, low
  isConfirmed: boolean("is_confirmed").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schema for extracted parameters - validates and types data when creating a new parameter
export const insertParameterSchema = createInsertSchema(extractedParameters).omit({ id: true, createdAt: true });
// TypeScript type for inserting an extracted parameter (excludes auto-generated fields)
export type InsertParameter = z.infer<typeof insertParameterSchema>;
// TypeScript type for selecting an extracted parameter from the database (includes all fields)
export type ExtractedParameter = typeof extractedParameters.$inferSelect;

/**
 * EnrichedFeedstockSpecRecord: Detailed feedstock specifications enriched with metadata.
 * Represents enriched feedstock parameters organized by categories (identity, physical, biochemical, etc.)
 * with source tracking, confidence levels, and provenance information for UPIF enrichment.
 */
export type EnrichedFeedstockSpecRecord = Record<string, {
  value: string;
  unit: string;
  source: "user_provided" | "ai_inferred" | "estimated_default";
  confidence: "high" | "medium" | "low";
  provenance: string;
  group: "identity" | "physical" | "biochemical" | "contaminants" | "extended" | "composition" | "flow" | "energy";
  displayName: string;
  sortOrder: number;
}>;

/**
 * FeedstockEntry: A single feedstock entry within a UPIF record.
 * Contains feedstock type, volume, and detailed specifications used to build the consolidated feedstock list.
 * Each feedstock can have multiple parameter entries and enriched specifications.
 */
export type FeedstockEntry = {
  feedstockType: string;
  feedstockVolume?: string;
  feedstockUnit?: string;
  feedstockParameters?: Record<string, { value: string; unit: string }>;
  feedstockSpecs?: EnrichedFeedstockSpecRecord;
};

/**
 * ConfirmedFields: Tracks which UPIF fields have been explicitly confirmed by the user.
 * Maps to specific UPIF sections (location, output requirements, constraints, feedstocks, output specs)
 * to enable per-field confirmation tracking and validation in the UPIF review process.
 */
export type ConfirmedFields = {
  location?: boolean;
  outputRequirements?: boolean;
  constraints?: Record<number, boolean>;
  feedstocks?: Record<number, {
    feedstockType?: boolean;
    feedstockVolume?: boolean;
    feedstockUnit?: boolean;
    feedstockSpecs?: Record<string, boolean>;
  }>;
  outputSpecs?: Record<string, Record<string, boolean>>;
};

/**
 * UPIF Records table: The consolidated Unified Project Intake Form.
 * Stores the complete project intake information with multi-feedstock support, enriched specifications,
 * output acceptance criteria, and per-field confirmation state for detailed tracking of what has been verified.
 */
export const upifRecords = pgTable("upif_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  feedstockType: text("feedstock_type"),
  feedstockVolume: text("feedstock_volume"),
  feedstockUnit: text("feedstock_unit"),
  feedstockParameters: jsonb("feedstock_parameters").$type<Record<string, { value: string; unit: string }>>(),
  feedstockSpecs: jsonb("feedstock_specs").$type<EnrichedFeedstockSpecRecord>(),
  feedstocks: jsonb("feedstocks").$type<FeedstockEntry[]>(),
  outputRequirements: text("output_requirements"),
  outputSpecs: jsonb("output_specs").$type<Record<string, Record<string, {
    value: string;
    unit: string;
    source: "typical_industry_standard" | "estimated_requirement" | "assumed_placeholder" | "user_provided" | "ai_inferred";
    confidence: "high" | "medium" | "low";
    provenance: string;
    group: string;
    displayName: string;
    sortOrder: number;
  }>>>(),
  validationWarnings: jsonb("validation_warnings").$type<Array<{
    field: string;
    section: string;
    message: string;
    severity: "error" | "warning" | "info";
    originalValue?: string;
    originalUnit?: string;
  }>>(),
  unmappedSpecs: jsonb("unmapped_specs").$type<Record<string, {
    value: string;
    unit: string;
    source: string;
    confidence: string;
    provenance: string;
    group: string;
    displayName: string;
    sortOrder: number;
  }>>(),
  performanceTargets: jsonb("performance_targets").$type<Array<{
    displayName: string;
    value: string;
    unit: string;
    source: string;
    provenance: string;
    group: string;
  }>>(),
  location: text("location"),
  constraints: text("constraints").array(),
  confirmedFields: jsonb("confirmed_fields").$type<ConfirmedFields>(),
  isConfirmed: boolean("is_confirmed").default(false),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Insert schema for UPIF records - validates and types data when creating or updating a UPIF record
export const insertUpifSchema = createInsertSchema(upifRecords).omit({ id: true, createdAt: true, updatedAt: true, confirmedAt: true });
// TypeScript type for inserting/updating a UPIF record (excludes auto-generated fields)
export type InsertUpif = z.infer<typeof insertUpifSchema>;
// TypeScript type for selecting a UPIF record from the database (includes all fields)
export type UpifRecord = typeof upifRecords.$inferSelect;

/**
 * UPIF Chat Messages table: Chat history for the AI reviewer.
 * Stores conversation between users and the AI reviewer that suggests UPIF modifications,
 * including applied updates and tracking of which fields were changed during the review process.
 */
export const upifChatMessages = pgTable("upif_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user, assistant
  content: text("content").notNull(),
  appliedUpdates: jsonb("applied_updates").$type<{
    changedFields: string[];
    summary: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schema for chat messages - validates and types data when creating a new chat message
export const insertChatMessageSchema = createInsertSchema(upifChatMessages).omit({ id: true, createdAt: true });
// TypeScript type for inserting a chat message (excludes auto-generated fields)
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
// TypeScript type for selecting a chat message from the database (includes all fields)
export type UpifChatMessage = typeof upifChatMessages.$inferSelect;

/**
 * Prompt Templates table: User-customizable AI prompt templates stored in the database.
 * Allows customization of system and user prompts used by AI models for parameter extraction,
 * enrichment, and UPIF review suggestions while maintaining version control through updatedAt tracking.
 */
export const promptTemplates = pgTable("prompt_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  template: text("template").notNull(),
  isSystemPrompt: boolean("is_system_prompt").default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Insert schema for prompt templates - validates and types data when creating or updating a prompt template
export const insertPromptTemplateSchema = createInsertSchema(promptTemplates).omit({ id: true, updatedAt: true });
// TypeScript type for inserting/updating a prompt template (excludes auto-generated fields)
export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;
// TypeScript type for selecting a prompt template from the database (includes all fields)
export type PromptTemplate = typeof promptTemplates.$inferSelect;

/**
 * Shared types for mass balance stream data at each treatment stage.
 */
export type StreamData = {
  flow: number;
  bod: number;
  cod: number;
  tss: number;
  tkn: number;
  tp: number;
  fog: number;
  nh3?: number;
  no3?: number;
  unit: string;
};

export type TreatmentStage = {
  name: string;
  type: string;
  influent: StreamData;
  effluent: StreamData;
  removalEfficiencies: Record<string, number>;
  designCriteria: Record<string, { value: number; unit: string; source: string }>;
  notes: string[];
};

export type RecycleStream = {
  name: string;
  source: string;
  destination: string;
  flow: number;
  loads: Record<string, number>;
};

export type EquipmentItem = {
  id: string;
  process: string;
  equipmentType: string;
  description: string;
  quantity: number;
  specs: Record<string, { value: string; unit: string }>;
  designBasis: string;
  notes: string;
  isOverridden: boolean;
  isLocked: boolean;
};

export type ADProcessStage = {
  name: string;
  type: string;
  inputStream: Record<string, { value: number; unit: string }>;
  outputStream: Record<string, { value: number; unit: string }>;
  designCriteria: Record<string, { value: number; unit: string; source: string }>;
  notes: string[];
};

export type CalculationStep = {
  category: string;
  label: string;
  formula: string;
  inputs: Array<{ name: string; value: string; unit: string }>;
  result: { value: string; unit: string };
  notes?: string;
};

export type MassBalanceResults = {
  projectType?: string;
  stages: TreatmentStage[];
  adStages?: ADProcessStage[];
  recycleStreams: RecycleStream[];
  equipment: EquipmentItem[];
  convergenceIterations: number;
  convergenceAchieved: boolean;
  assumptions: Array<{ parameter: string; value: string; source: string }>;
  warnings: Array<{ field: string; message: string; severity: "error" | "warning" | "info" }>;
  summary?: Record<string, { value: string; unit: string }>;
  calculationSteps?: CalculationStep[];
};

export type MassBalanceOverrides = Record<string, {
  value: string;
  unit: string;
  overriddenBy: string;
  reason: string;
  originalValue: string;
}>;

export type MassBalanceLocks = Record<string, boolean>;

export type VendorRecommendation = {
  manufacturer: string;
  modelNumber: string;
  specSheetUrl?: string;
  websiteUrl?: string;
  notes?: string;
};

export type VendorListItem = {
  equipmentId: string;
  equipmentType: string;
  process: string;
  quantity: number;
  specsSummary: string;
  recommendations: VendorRecommendation[];
};

export type VendorList = {
  items: VendorListItem[];
  generatedAt: string;
  modelUsed: string;
};

/**
 * Mass Balance Runs table: Versioned mass balance & equipment list results for scenarios.
 */
export const massBalanceRuns = pgTable("mass_balance_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  version: text("version").notNull().default("1"),
  status: text("status").notNull().default("draft"),
  inputSnapshot: jsonb("input_snapshot"),
  results: jsonb("results").$type<MassBalanceResults>(),
  overrides: jsonb("overrides").$type<MassBalanceOverrides>(),
  locks: jsonb("locks").$type<MassBalanceLocks>(),
  vendorList: jsonb("vendor_list").$type<VendorList>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMassBalanceRunSchema = createInsertSchema(massBalanceRuns).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMassBalanceRun = z.infer<typeof insertMassBalanceRunSchema>;
export type MassBalanceRun = typeof massBalanceRuns.$inferSelect;

/**
 * CapEx line item: Individual equipment cost estimate referencing mass balance equipment.
 */
export type CapexLineItem = {
  id: string;
  equipmentId: string;
  process: string;
  equipmentType: string;
  description: string;
  quantity: number;
  baseCostPerUnit: number;
  installationFactor: number;
  installedCost: number;
  contingencyPct: number;
  contingencyCost: number;
  totalCost: number;
  costBasis: string;
  source: string;
  notes: string;
  isOverridden: boolean;
  isLocked: boolean;
};

export type CapexSummary = {
  totalEquipmentCost: number;
  totalInstalledCost: number;
  totalContingency: number;
  totalDirectCost: number;
  engineeringPct: number;
  engineeringCost: number;
  totalProjectCost: number;
  costPerUnit?: { value: number; unit: string; basis: string };
};

export type CapexResults = {
  projectType?: string;
  lineItems: CapexLineItem[];
  summary: CapexSummary;
  assumptions: Array<{ parameter: string; value: string; source: string }>;
  warnings: Array<{ field: string; message: string; severity: "error" | "warning" | "info" }>;
  costYear: string;
  currency: string;
  methodology: string;
};

export type CapexOverrides = Record<string, {
  value: string;
  unit: string;
  overriddenBy: string;
  reason: string;
  originalValue: string;
}>;

export type CapexLocks = Record<string, boolean>;

/**
 * CapEx Estimates table: Versioned capital cost estimates for scenarios.
 * Generated from confirmed mass balance equipment lists using AI.
 */
export const capexEstimates = pgTable("capex_estimates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  massBalanceRunId: varchar("mass_balance_run_id").notNull().references(() => massBalanceRuns.id, { onDelete: "cascade" }),
  version: text("version").notNull().default("1"),
  status: text("status").notNull().default("draft"),
  inputSnapshot: jsonb("input_snapshot"),
  results: jsonb("results").$type<CapexResults>(),
  overrides: jsonb("overrides").$type<CapexOverrides>(),
  locks: jsonb("locks").$type<CapexLocks>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCapexEstimateSchema = createInsertSchema(capexEstimates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCapexEstimate = z.infer<typeof insertCapexEstimateSchema>;
export type CapexEstimate = typeof capexEstimates.$inferSelect;

/**
 * OpEx line item: Individual annual operating cost category.
 */
export type OpexLineItem = {
  id: string;
  category: string;
  description: string;
  annualCost: number;
  unitCost?: number;
  unitBasis?: string;
  scalingBasis?: string;
  percentOfRevenue?: number;
  costBasis: string;
  source: string;
  notes: string;
  isOverridden: boolean;
  isLocked: boolean;
};

export type OpexSummary = {
  totalAnnualOpex: number;
  totalLaborCost: number;
  totalEnergyCost: number;
  totalChemicalCost: number;
  totalMaintenanceCost: number;
  totalDisposalCost: number;
  totalOtherCost: number;
  revenueOffsets: number;
  netAnnualOpex: number;
  opexPerUnit?: { value: number; unit: string; basis: string };
  opexAsPercentOfCapex?: number;
};

export type OpexEditableAssumption = {
  key: string;
  parameter: string;
  value: number;
  unit: string;
  source: string;
  category: string;
  description?: string;
};

export type OpexResults = {
  projectType?: string;
  lineItems: OpexLineItem[];
  summary: OpexSummary;
  assumptions: Array<{ parameter: string; value: string; source: string }>;
  editableAssumptions?: OpexEditableAssumption[];
  warnings: Array<{ field: string; message: string; severity: "error" | "warning" | "info" }>;
  costYear: string;
  currency: string;
  methodology: string;
};

export type OpexOverrides = Record<string, {
  value: string;
  unit: string;
  overriddenBy: string;
  reason: string;
  originalValue: string;
}>;

export type OpexLocks = Record<string, boolean>;

/**
 * OpEx Estimates table: Versioned annual operating cost estimates for scenarios.
 * Generated from confirmed mass balance and CapEx data using AI.
 */
export const opexEstimates = pgTable("opex_estimates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  massBalanceRunId: varchar("mass_balance_run_id").notNull().references(() => massBalanceRuns.id, { onDelete: "cascade" }),
  capexEstimateId: varchar("capex_estimate_id").references(() => capexEstimates.id, { onDelete: "set null" }),
  version: text("version").notNull().default("1"),
  status: text("status").notNull().default("draft"),
  inputSnapshot: jsonb("input_snapshot"),
  results: jsonb("results").$type<OpexResults>(),
  overrides: jsonb("overrides").$type<OpexOverrides>(),
  locks: jsonb("locks").$type<OpexLocks>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOpexEstimateSchema = createInsertSchema(opexEstimates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOpexEstimate = z.infer<typeof insertOpexEstimateSchema>;
export type OpexEstimate = typeof opexEstimates.$inferSelect;

/**
 * Financial Model assumptions: User-editable inputs for the 10-year pro-forma.
 */
export type FinancialAssumptions = {
  inflationRate: number;
  projectLifeYears: number;
  constructionMonths: number;
  uptimePct: number;
  biogasGrowthRate: number;
  rngPricePerMMBtu: number;
  rngPriceEscalator: number;
  rinPricePerRIN: number;
  rinPriceEscalator: number;
  rinBrokeragePct: number;
  rinPerMMBtu: number;
  natGasPricePerMMBtu: number;
  natGasPriceEscalator: number;
  wheelHubCostPerMMBtu: number;
  electricityCostPerKWh: number;
  electricityEscalator: number;
  gasCostPerMMBtu: number;
  gasCostEscalator: number;
  itcRate: number;
  itcMonetizationPct: number;
  maintenanceCapexPct: number;
  discountRate: number;
  revenueMarket: "d3" | "voluntary";
  voluntaryPricing: {
    gasPricePerMMBtu: number;
    gasPriceEscalator: number;
    voluntaryPremiumPerMMBtu: number;
    voluntaryPremiumEscalator: number;
  };
  feedstockCosts: Array<{
    feedstockName: string;
    costPerTon: number;
    annualTons: number;
    escalator: number;
  }>;
  debtFinancing: {
    enabled: boolean;
    loanAmountPct: number;
    interestRate: number;
    termYears: number;
  };
  fortyFiveZ: {
    enabled: boolean;
    ciScore: number;
    targetCI: number;
    creditPricePerGal: number;
    conversionGalPerMMBtu: number;
    monetizationPct: number;
    endYear: number;
  };
};

export type ProFormaYear = {
  year: number;
  calendarYear: number;
  biogasScfm: number;
  rngProductionMMBtu: number;
  rinRevenue: number;
  rinBrokerage: number;
  natGasRevenue: number;
  voluntaryRevenue: number;
  fortyFiveZRevenue: number;
  totalRevenue: number;
  utilityCost: number;
  feedstockCost: number;
  laborCost: number;
  maintenanceCost: number;
  chemicalCost: number;
  insuranceCost: number;
  otherOpex: number;
  totalOpex: number;
  ebitda: number;
  maintenanceCapex: number;
  debtService: number;
  netCashFlow: number;
  cumulativeCashFlow: number;
};

export type FinancialMetrics = {
  irr: number | null;
  npv10: number;
  moic: number;
  paybackYears: number | null;
  totalRevenue: number;
  totalOpex: number;
  totalEbitda: number;
  totalCapex: number;
  itcProceeds: number;
  totalMaintenanceCapex: number;
  averageAnnualEbitda: number;
};

export type FinancialModelResults = {
  projectType?: string;
  assumptions: FinancialAssumptions;
  proForma: ProFormaYear[];
  metrics: FinancialMetrics;
  capexTotal: number;
  opexAnnualBase: number;
  biogasScfmBase: number;
  rngMMBtuPerDayBase: number;
  warnings: Array<{ field: string; message: string; severity: "error" | "warning" | "info" }>;
};

export const financialModels = pgTable("financial_models", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  massBalanceRunId: varchar("mass_balance_run_id").notNull().references(() => massBalanceRuns.id, { onDelete: "cascade" }),
  capexEstimateId: varchar("capex_estimate_id").references(() => capexEstimates.id, { onDelete: "set null" }),
  opexEstimateId: varchar("opex_estimate_id").references(() => opexEstimates.id, { onDelete: "set null" }),
  version: text("version").notNull().default("1"),
  status: text("status").notNull().default("draft"),
  assumptions: jsonb("assumptions").$type<FinancialAssumptions>(),
  results: jsonb("results").$type<FinancialModelResults>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertFinancialModelSchema = createInsertSchema(financialModels).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFinancialModel = z.infer<typeof insertFinancialModelSchema>;
export type FinancialModel = typeof financialModels.$inferSelect;

/**
 * Generation Logs table: Tracks timing and metadata for AI-generated documents.
 * Records how long each generation takes, which model was used, and links to the project/scenario.
 */
export const generationLogs = pgTable("generation_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentType: text("document_type").notNull(),
  modelUsed: text("model_used").notNull(),
  projectId: varchar("project_id"),
  projectName: text("project_name"),
  scenarioId: varchar("scenario_id"),
  scenarioName: text("scenario_name"),
  durationMs: integer("duration_ms").notNull(),
  status: text("status").notNull().default("success"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertGenerationLogSchema = createInsertSchema(generationLogs).omit({ id: true, createdAt: true });
export type InsertGenerationLog = z.infer<typeof insertGenerationLogSchema>;
export type GenerationLog = typeof generationLogs.$inferSelect;

/**
 * Library Profiles table: Stores editable feedstock, wastewater influent,
 * and output criteria profiles in the database.
 * Each row is one profile (e.g., "Potato Waste" or "RNG - Pipeline Injection").
 */
export const libraryProfiles = pgTable("library_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  libraryType: text("library_type").notNull(),
  name: text("name").notNull(),
  aliases: jsonb("aliases").$type<string[]>().default([]).notNull(),
  category: text("category").notNull(),
  properties: jsonb("properties").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  isCustomized: boolean("is_customized").default(false).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLibraryProfileSchema = createInsertSchema(libraryProfiles).omit({ id: true, updatedAt: true });
export type InsertLibraryProfile = z.infer<typeof insertLibraryProfileSchema>;
export type LibraryProfile = typeof libraryProfiles.$inferSelect;

/**
 * Validation Config table: Stores configurable validation pipeline parameters
 * (thresholds, blocked lists, auto-population factors).
 */
export const validationConfig = pgTable("validation_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  configKey: text("config_key").notNull().unique(),
  configValue: jsonb("config_value").notNull(),
  description: text("description"),
  category: text("category").notNull().default("general"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertValidationConfigSchema = createInsertSchema(validationConfig).omit({ id: true, updatedAt: true });
export type InsertValidationConfig = z.infer<typeof insertValidationConfigSchema>;
export type ValidationConfig = typeof validationConfig.$inferSelect;

/**
 * Users table: Basic auth user accounts for application access.
 * Stores user credentials used for authentication and session management.
 */
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

// Insert schema for users - validates and types data when creating a new user account
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

// TypeScript type for inserting a user (only username and password)
export type InsertUser = z.infer<typeof insertUserSchema>;
// TypeScript type for selecting a user from the database (includes all fields)
export type User = typeof users.$inferSelect;
