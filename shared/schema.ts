/**
 * Shared data model for the UPIF (Unified Project Intake Form) application.
 * This schema defines all database tables and TypeScript types used by both
 * the frontend and backend. It ensures type consistency across the entire application
 * and serves as the single source of truth for the database structure.
 */

import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
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
  source: "user_provided" | "estimated_default";
  confidence: "high" | "medium" | "low";
  provenance: string;
  group: "identity" | "physical" | "biochemical" | "contaminants" | "extended";
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
