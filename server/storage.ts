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
} from "@shared/schema";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool);

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
}

export class DatabaseStorage implements IStorage {
  // Projects
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

  // Scenarios
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
      .orderBy(desc(scenarios.createdAt))
      .limit(10);

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

  async deleteScenario(id: string): Promise<void> {
    await db.delete(scenarios).where(eq(scenarios.id, id));
  }

  // Text Entries
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

  // Documents
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

  // Parameters
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

  // UPIF
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
}

export const storage = new DatabaseStorage();
