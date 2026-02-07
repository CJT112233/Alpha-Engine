import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Projects - top level container
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

// Scenarios - each project can have multiple scenarios
export const scenarios = pgTable("scenarios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft, in_review, confirmed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at"),
});

export const insertScenarioSchema = createInsertSchema(scenarios).omit({ id: true, createdAt: true, confirmedAt: true });
export type InsertScenario = z.infer<typeof insertScenarioSchema>;
export type Scenario = typeof scenarios.$inferSelect;

// Text Entries - conversational inputs
export const textEntries = pgTable("text_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  category: text("category"), // feedstock, output_requirements, location, constraints
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTextEntrySchema = createInsertSchema(textEntries).omit({ id: true, createdAt: true });
export type InsertTextEntry = z.infer<typeof insertTextEntrySchema>;
export type TextEntry = typeof textEntries.$inferSelect;

// Documents - uploaded files
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

export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, createdAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

// Extracted Parameters - AI-extracted and predicted values
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

export const insertParameterSchema = createInsertSchema(extractedParameters).omit({ id: true, createdAt: true });
export type InsertParameter = z.infer<typeof insertParameterSchema>;
export type ExtractedParameter = typeof extractedParameters.$inferSelect;

export type EnrichedFeedstockSpecRecord = Record<string, {
  value: string;
  unit: string;
  source: "user_provided" | "estimated_default";
  confidence: "high" | "medium" | "low";
  provenance: string;
  group: "identity" | "physical" | "biochemical" | "contaminants" | "extended";
  displayName: string;
  sortOrder: number;
}>;

export type FeedstockEntry = {
  feedstockType: string;
  feedstockVolume?: string;
  feedstockUnit?: string;
  feedstockParameters?: Record<string, { value: string; unit: string }>;
  feedstockSpecs?: EnrichedFeedstockSpecRecord;
};

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

// UPIF - Unified Project Intake Form
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
    source: "typical_industry_standard" | "estimated_requirement" | "assumed_placeholder" | "user_provided";
    confidence: "high" | "medium" | "low";
    provenance: string;
    group: string;
    displayName: string;
    sortOrder: number;
  }>>>(),
  location: text("location"),
  constraints: text("constraints").array(),
  confirmedFields: jsonb("confirmed_fields").$type<ConfirmedFields>(),
  isConfirmed: boolean("is_confirmed").default(false),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUpifSchema = createInsertSchema(upifRecords).omit({ id: true, createdAt: true, updatedAt: true, confirmedAt: true });
export type InsertUpif = z.infer<typeof insertUpifSchema>;
export type UpifRecord = typeof upifRecords.$inferSelect;

// UPIF Chat Messages - reviewer chat history
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

export const insertChatMessageSchema = createInsertSchema(upifChatMessages).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type UpifChatMessage = typeof upifChatMessages.$inferSelect;

// Users table (keeping existing structure)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
