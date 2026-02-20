/**
 * Data Access Layer (DAL) for the application.
 * Handles all database operations using Drizzle ORM with PostgreSQL.
 * Implements the IStorage interface to provide a contract for CRUD operations
 * across all domain entities (Projects, Scenarios, TextEntries, Documents, etc.).
 */

import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  projects,
  scenarios,
  textEntries,
  documents,
  extractedParameters,
  upifRecords,
  upifChatMessages,
  promptTemplates,
  massBalanceRuns,
  capexEstimates,
  opexEstimates,
  generationLogs,
  libraryProfiles,
  validationConfig,
  type Project,
  type InsertProject,
  type Scenario,
  type InsertScenario,
  type TextEntry,
  type InsertTextEntry,
  type Document,
  type InsertDocument,
  type ExtractedParameter,
  type InsertParameter,
  type UpifRecord,
  type InsertUpif,
  type UpifChatMessage,
  type InsertChatMessage,
  type PromptTemplate,
  type InsertPromptTemplate,
  type MassBalanceRun,
  type InsertMassBalanceRun,
  type CapexEstimate,
  type InsertCapexEstimate,
  type OpexEstimate,
  type InsertOpexEstimate,
  type GenerationLog,
  type InsertGenerationLog,
  type LibraryProfile,
  type InsertLibraryProfile,
  type ValidationConfig,
  type InsertValidationConfig,
} from "@shared/schema";

// Initialize PostgreSQL connection pool from environment DATABASE_URL
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create Drizzle ORM instance for database operations
export const db = drizzle(pool);

/**
 * Storage interface that defines the contract for all database CRUD operations.
 * Methods are grouped by domain entity: Projects, Scenarios, TextEntries, Documents,
 * Parameters, UPIF records, UPIF Chat messages, and Prompt Templates.
 */
export interface IStorage {
  // Projects
  getAllProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  // Scenarios
  getScenariosByProject(projectId: string): Promise<Scenario[]>;
  getScenario(id: string): Promise<(Scenario & { project: Project }) | undefined>;
  getRecentScenarios(): Promise<(Scenario & { projectName: string })[]>;
  createScenario(scenario: InsertScenario): Promise<Scenario>;
  updateScenarioStatus(id: string, status: string, confirmedAt?: Date): Promise<Scenario | undefined>;
  updateScenarioModel(id: string, model: string): Promise<Scenario | undefined>;
  updateScenarioProjectType(id: string, projectType: string, confirmed: boolean): Promise<Scenario | undefined>;
  updateScenarioClarification(id: string, questions: unknown, answers: unknown): Promise<Scenario | undefined>;
  deleteScenario(id: string): Promise<void>;

  // Text Entries
  getTextEntriesByScenario(scenarioId: string): Promise<TextEntry[]>;
  createTextEntry(entry: InsertTextEntry): Promise<TextEntry>;
  deleteTextEntry(id: string): Promise<void>;

  // Documents
  getDocumentsByScenario(scenarioId: string): Promise<Document[]>;
  createDocument(doc: InsertDocument): Promise<Document>;
  deleteDocument(id: string): Promise<void>;

  // Parameters
  getParametersByScenario(scenarioId: string): Promise<ExtractedParameter[]>;
  createParameter(param: InsertParameter): Promise<ExtractedParameter>;
  updateParameter(id: string, updates: Partial<InsertParameter>): Promise<ExtractedParameter | undefined>;
  deleteParametersByScenario(scenarioId: string): Promise<void>;

  // UPIF
  getUpifByScenario(scenarioId: string): Promise<UpifRecord | undefined>;
  createUpif(upif: InsertUpif): Promise<UpifRecord>;
  updateUpif(scenarioId: string, updates: Partial<InsertUpif>): Promise<UpifRecord | undefined>;
  confirmUpif(scenarioId: string): Promise<UpifRecord | undefined>;

  // UPIF Chat
  getChatMessagesByScenario(scenarioId: string): Promise<UpifChatMessage[]>;
  createChatMessage(msg: InsertChatMessage): Promise<UpifChatMessage>;

  // Prompt Templates
  getAllPromptTemplates(): Promise<PromptTemplate[]>;
  getPromptTemplateByKey(key: string): Promise<PromptTemplate | undefined>;
  upsertPromptTemplate(data: InsertPromptTemplate): Promise<PromptTemplate>;
  deletePromptTemplate(key: string): Promise<void>;

  // Mass Balance Runs
  getMassBalanceRunsByScenario(scenarioId: string): Promise<MassBalanceRun[]>;
  getMassBalanceRun(id: string): Promise<MassBalanceRun | undefined>;
  createMassBalanceRun(run: InsertMassBalanceRun): Promise<MassBalanceRun>;
  updateMassBalanceRun(id: string, updates: Partial<InsertMassBalanceRun>): Promise<MassBalanceRun | undefined>;

  // CapEx Estimates
  getCapexEstimatesByScenario(scenarioId: string): Promise<CapexEstimate[]>;
  getCapexEstimate(id: string): Promise<CapexEstimate | undefined>;
  createCapexEstimate(estimate: InsertCapexEstimate): Promise<CapexEstimate>;
  updateCapexEstimate(id: string, updates: Partial<InsertCapexEstimate>): Promise<CapexEstimate | undefined>;

  // OpEx Estimates
  getOpexEstimatesByScenario(scenarioId: string): Promise<OpexEstimate[]>;
  getOpexEstimate(id: string): Promise<OpexEstimate | undefined>;
  createOpexEstimate(estimate: InsertOpexEstimate): Promise<OpexEstimate>;
  updateOpexEstimate(id: string, updates: Partial<InsertOpexEstimate>): Promise<OpexEstimate | undefined>;

  // Generation Logs
  getAllGenerationLogs(): Promise<GenerationLog[]>;
  createGenerationLog(log: InsertGenerationLog): Promise<GenerationLog>;

  // Library Profiles
  getLibraryProfilesByType(libraryType: string): Promise<LibraryProfile[]>;
  getLibraryProfile(id: string): Promise<LibraryProfile | undefined>;
  createLibraryProfile(profile: InsertLibraryProfile): Promise<LibraryProfile>;
  updateLibraryProfile(id: string, updates: Partial<InsertLibraryProfile>): Promise<LibraryProfile | undefined>;
  deleteLibraryProfile(id: string): Promise<boolean>;

  // Validation Config
  getAllValidationConfig(): Promise<ValidationConfig[]>;
  getValidationConfig(configKey: string): Promise<ValidationConfig | undefined>;
  upsertValidationConfig(config: InsertValidationConfig): Promise<ValidationConfig>;
}

/**
 * Implementation of IStorage interface using Drizzle ORM queries.
 * Provides all CRUD operations for database entities with proper type safety.
 */
export class DatabaseStorage implements IStorage {
  // ============================================================================
  // PROJECTS
  // ============================================================================
  // Project CRUD operations: retrieve all, get single, create, delete

  async getAllProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const result = await db.select().from(projects).where(eq(projects.id, id));
    return result[0];
  }

  async createProject(project: InsertProject): Promise<Project> {
    const result = await db.insert(projects).values(project).returning();
    return result[0];
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  // ============================================================================
  // SCENARIOS
  // ============================================================================
  // Scenario CRUD operations with project joins.
  // getScenario and getRecentScenarios use innerJoin with projects table to include
  // project context in the response.

  async getScenariosByProject(projectId: string): Promise<Scenario[]> {
    return db
      .select()
      .from(scenarios)
      .where(eq(scenarios.projectId, projectId))
      .orderBy(desc(scenarios.createdAt));
  }

  async getScenario(id: string): Promise<(Scenario & { project: Project }) | undefined> {
    const result = await db
      .select({
        scenario: scenarios,
        project: projects,
      })
      .from(scenarios)
      .innerJoin(projects, eq(scenarios.projectId, projects.id))
      .where(eq(scenarios.id, id));

    if (result.length === 0) return undefined;

    return {
      ...result[0].scenario,
      project: result[0].project,
    };
  }

  async getRecentScenarios(): Promise<(Scenario & { projectName: string })[]> {
    const result = await db
      .select({
        scenario: scenarios,
        projectName: projects.name,
      })
      .from(scenarios)
      .innerJoin(projects, eq(scenarios.projectId, projects.id))
      .orderBy(desc(scenarios.createdAt));

    return result.map((r) => ({
      ...r.scenario,
      projectName: r.projectName,
    }));
  }

  async createScenario(scenario: InsertScenario): Promise<Scenario> {
    const result = await db.insert(scenarios).values(scenario).returning();
    return result[0];
  }

  async updateScenarioStatus(id: string, status: string, confirmedAt?: Date): Promise<Scenario | undefined> {
    const updates: Partial<Scenario> = { status };
    if (confirmedAt) {
      updates.confirmedAt = confirmedAt;
    }
    const result = await db
      .update(scenarios)
      .set(updates)
      .where(eq(scenarios.id, id))
      .returning();
    return result[0];
  }

  async updateScenarioModel(id: string, model: string): Promise<Scenario | undefined> {
    const result = await db
      .update(scenarios)
      .set({ preferredModel: model })
      .where(eq(scenarios.id, id))
      .returning();
    return result[0];
  }

  async updateScenarioProjectType(id: string, projectType: string, confirmed: boolean): Promise<Scenario | undefined> {
    const result = await db
      .update(scenarios)
      .set({ projectType, projectTypeConfirmed: confirmed })
      .where(eq(scenarios.id, id))
      .returning();
    return result[0];
  }

  async updateScenarioClarification(id: string, questions: unknown, answers: unknown): Promise<Scenario | undefined> {
    const result = await db
      .update(scenarios)
      .set({ clarifyingQuestions: questions, clarifyingAnswers: answers })
      .where(eq(scenarios.id, id))
      .returning();
    return result[0];
  }

  async deleteScenario(id: string): Promise<void> {
    await db.delete(scenarios).where(eq(scenarios.id, id));
  }

  // ============================================================================
  // TEXT ENTRIES
  // ============================================================================
  // Text entry CRUD operations: retrieve by scenario, create, delete

  async getTextEntriesByScenario(scenarioId: string): Promise<TextEntry[]> {
    return db
      .select()
      .from(textEntries)
      .where(eq(textEntries.scenarioId, scenarioId))
      .orderBy(desc(textEntries.createdAt));
  }

  async createTextEntry(entry: InsertTextEntry): Promise<TextEntry> {
    const result = await db.insert(textEntries).values(entry).returning();
    return result[0];
  }

  async deleteTextEntry(id: string): Promise<void> {
    await db.delete(textEntries).where(eq(textEntries.id, id));
  }

  // ============================================================================
  // DOCUMENTS
  // ============================================================================
  // Document CRUD operations: retrieve by scenario, create, delete

  async getDocumentsByScenario(scenarioId: string): Promise<Document[]> {
    return db
      .select()
      .from(documents)
      .where(eq(documents.scenarioId, scenarioId))
      .orderBy(desc(documents.createdAt));
  }

  async createDocument(doc: InsertDocument): Promise<Document> {
    const result = await db.insert(documents).values(doc).returning();
    return result[0];
  }

  async deleteDocument(id: string): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  // ============================================================================
  // PARAMETERS
  // ============================================================================
  // Extracted parameter CRUD operations: retrieve by scenario, create, update, delete

  async getParametersByScenario(scenarioId: string): Promise<ExtractedParameter[]> {
    return db
      .select()
      .from(extractedParameters)
      .where(eq(extractedParameters.scenarioId, scenarioId))
      .orderBy(extractedParameters.category, extractedParameters.name);
  }

  async createParameter(param: InsertParameter): Promise<ExtractedParameter> {
    const result = await db.insert(extractedParameters).values(param).returning();
    return result[0];
  }

  async updateParameter(id: string, updates: Partial<InsertParameter>): Promise<ExtractedParameter | undefined> {
    const result = await db
      .update(extractedParameters)
      .set(updates)
      .where(eq(extractedParameters.id, id))
      .returning();
    return result[0];
  }

  async deleteParametersByScenario(scenarioId: string): Promise<void> {
    await db.delete(extractedParameters).where(eq(extractedParameters.scenarioId, scenarioId));
  }

  // ============================================================================
  // UPIF RECORDS
  // ============================================================================
  // UPIF (Unit Process Information Form) record operations.
  // updateUpif automatically updates the updatedAt timestamp.
  // confirmUpif sets isConfirmed to true and sets confirmedAt to current timestamp.

  async getUpifByScenario(scenarioId: string): Promise<UpifRecord | undefined> {
    const result = await db.select().from(upifRecords).where(eq(upifRecords.scenarioId, scenarioId));
    return result[0];
  }

  async createUpif(upif: InsertUpif): Promise<UpifRecord> {
    const result = await db.insert(upifRecords).values(upif).returning();
    return result[0];
  }

  async updateUpif(scenarioId: string, updates: Partial<InsertUpif>): Promise<UpifRecord | undefined> {
    const result = await db
      .update(upifRecords)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(upifRecords.scenarioId, scenarioId))
      .returning();
    return result[0];
  }

  async confirmUpif(scenarioId: string): Promise<UpifRecord | undefined> {
    const result = await db
      .update(upifRecords)
      .set({ isConfirmed: true, confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(upifRecords.scenarioId, scenarioId))
      .returning();
    return result[0];
  }

  // ============================================================================
  // UPIF CHAT MESSAGES
  // ============================================================================
  // UPIF chat message CRUD operations: retrieve by scenario, create

  async getChatMessagesByScenario(scenarioId: string): Promise<UpifChatMessage[]> {
    return db
      .select()
      .from(upifChatMessages)
      .where(eq(upifChatMessages.scenarioId, scenarioId))
      .orderBy(upifChatMessages.createdAt);
  }

  async createChatMessage(msg: InsertChatMessage): Promise<UpifChatMessage> {
    const result = await db.insert(upifChatMessages).values(msg).returning();
    return result[0];
  }

  // ============================================================================
  // PROMPT TEMPLATES
  // ============================================================================
  // Prompt template CRUD operations.
  // upsertPromptTemplate performs an insert-or-update operation: if a template with
  // the same key exists, it updates the record; otherwise, it inserts a new one.

  async getAllPromptTemplates(): Promise<PromptTemplate[]> {
    return db.select().from(promptTemplates).orderBy(promptTemplates.key);
  }

  async getPromptTemplateByKey(key: string): Promise<PromptTemplate | undefined> {
    const result = await db.select().from(promptTemplates).where(eq(promptTemplates.key, key));
    return result[0];
  }

  async upsertPromptTemplate(data: InsertPromptTemplate): Promise<PromptTemplate> {
    const existing = await this.getPromptTemplateByKey(data.key);
    if (existing) {
      const result = await db
        .update(promptTemplates)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(promptTemplates.key, data.key))
        .returning();
      return result[0];
    }
    const result = await db.insert(promptTemplates).values(data).returning();
    return result[0];
  }

  async deletePromptTemplate(key: string): Promise<void> {
    await db.delete(promptTemplates).where(eq(promptTemplates.key, key));
  }

  // ============================================================================
  // MASS BALANCE RUNS
  // ============================================================================

  async getMassBalanceRunsByScenario(scenarioId: string): Promise<MassBalanceRun[]> {
    return db
      .select()
      .from(massBalanceRuns)
      .where(eq(massBalanceRuns.scenarioId, scenarioId))
      .orderBy(desc(massBalanceRuns.createdAt));
  }

  async getMassBalanceRun(id: string): Promise<MassBalanceRun | undefined> {
    const result = await db.select().from(massBalanceRuns).where(eq(massBalanceRuns.id, id));
    return result[0];
  }

  async createMassBalanceRun(run: InsertMassBalanceRun): Promise<MassBalanceRun> {
    const result = await db.insert(massBalanceRuns).values(run).returning();
    return result[0];
  }

  async updateMassBalanceRun(id: string, updates: Partial<InsertMassBalanceRun>): Promise<MassBalanceRun | undefined> {
    const result = await db
      .update(massBalanceRuns)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(massBalanceRuns.id, id))
      .returning();
    return result[0];
  }

  // ============================================================================
  // CAPEX ESTIMATES
  // ============================================================================

  async getCapexEstimatesByScenario(scenarioId: string): Promise<CapexEstimate[]> {
    return db
      .select()
      .from(capexEstimates)
      .where(eq(capexEstimates.scenarioId, scenarioId))
      .orderBy(desc(capexEstimates.createdAt));
  }

  async getCapexEstimate(id: string): Promise<CapexEstimate | undefined> {
    const result = await db.select().from(capexEstimates).where(eq(capexEstimates.id, id));
    return result[0];
  }

  async createCapexEstimate(estimate: InsertCapexEstimate): Promise<CapexEstimate> {
    const result = await db.insert(capexEstimates).values(estimate).returning();
    return result[0];
  }

  async updateCapexEstimate(id: string, updates: Partial<InsertCapexEstimate>): Promise<CapexEstimate | undefined> {
    const result = await db
      .update(capexEstimates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(capexEstimates.id, id))
      .returning();
    return result[0];
  }

  // ============================================================================
  // OPEX ESTIMATES
  // ============================================================================

  async getOpexEstimatesByScenario(scenarioId: string): Promise<OpexEstimate[]> {
    return db
      .select()
      .from(opexEstimates)
      .where(eq(opexEstimates.scenarioId, scenarioId))
      .orderBy(desc(opexEstimates.createdAt));
  }

  async getOpexEstimate(id: string): Promise<OpexEstimate | undefined> {
    const result = await db.select().from(opexEstimates).where(eq(opexEstimates.id, id));
    return result[0];
  }

  async createOpexEstimate(estimate: InsertOpexEstimate): Promise<OpexEstimate> {
    const result = await db.insert(opexEstimates).values(estimate).returning();
    return result[0];
  }

  async updateOpexEstimate(id: string, updates: Partial<InsertOpexEstimate>): Promise<OpexEstimate | undefined> {
    const result = await db
      .update(opexEstimates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(opexEstimates.id, id))
      .returning();
    return result[0];
  }

  // ============================================================================
  // GENERATION LOGS
  // ============================================================================

  async getAllGenerationLogs(): Promise<GenerationLog[]> {
    return db.select().from(generationLogs).orderBy(desc(generationLogs.createdAt));
  }

  async createGenerationLog(log: InsertGenerationLog): Promise<GenerationLog> {
    const result = await db.insert(generationLogs).values(log).returning();
    return result[0];
  }

  // ============================================================================
  // LIBRARY PROFILES
  // ============================================================================

  async getLibraryProfilesByType(libraryType: string): Promise<LibraryProfile[]> {
    return db
      .select()
      .from(libraryProfiles)
      .where(eq(libraryProfiles.libraryType, libraryType))
      .orderBy(libraryProfiles.sortOrder);
  }

  async getLibraryProfile(id: string): Promise<LibraryProfile | undefined> {
    const result = await db.select().from(libraryProfiles).where(eq(libraryProfiles.id, id));
    return result[0];
  }

  async createLibraryProfile(profile: InsertLibraryProfile): Promise<LibraryProfile> {
    const result = await db.insert(libraryProfiles).values(profile).returning();
    return result[0];
  }

  async updateLibraryProfile(id: string, updates: Partial<InsertLibraryProfile>): Promise<LibraryProfile | undefined> {
    const result = await db
      .update(libraryProfiles)
      .set({ ...updates, isCustomized: true, updatedAt: new Date() })
      .where(eq(libraryProfiles.id, id))
      .returning();
    return result[0];
  }

  async deleteLibraryProfile(id: string): Promise<boolean> {
    const result = await db.delete(libraryProfiles).where(eq(libraryProfiles.id, id)).returning();
    return result.length > 0;
  }

  // ============================================================================
  // VALIDATION CONFIG
  // ============================================================================

  async getAllValidationConfig(): Promise<ValidationConfig[]> {
    return db.select().from(validationConfig).orderBy(validationConfig.category);
  }

  async getValidationConfig(configKey: string): Promise<ValidationConfig | undefined> {
    const result = await db.select().from(validationConfig).where(eq(validationConfig.configKey, configKey));
    return result[0];
  }

  async upsertValidationConfig(config: InsertValidationConfig): Promise<ValidationConfig> {
    const existing = await this.getValidationConfig(config.configKey);
    if (existing) {
      const result = await db
        .update(validationConfig)
        .set({ configValue: config.configValue, description: config.description, category: config.category, updatedAt: new Date() })
        .where(eq(validationConfig.configKey, config.configKey))
        .returning();
      return result[0];
    }
    const result = await db.insert(validationConfig).values(config).returning();
    return result[0];
  }
}

// Singleton instance of DatabaseStorage used by routes for all database operations
export const storage = new DatabaseStorage();
