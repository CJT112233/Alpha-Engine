import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { insertProjectSchema, insertScenarioSchema, insertTextEntrySchema, type FeedstockEntry } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";
import { enrichFeedstockSpecs, type EnrichedFeedstockSpec } from "@shared/feedstock-library";
import { enrichOutputSpecs, matchOutputType, type EnrichedOutputSpec } from "@shared/output-criteria-library";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import PDFDocument from "pdfkit";
import { feedstockGroupLabels, feedstockGroupOrder } from "@shared/feedstock-library";
import { outputGroupLabels, outputGroupOrder } from "@shared/output-criteria-library";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

async function extractTextFromFile(filePath: string, mimeType: string, originalName: string): Promise<string | null> {
  try {
    const ext = path.extname(originalName).toLowerCase();

    if (mimeType === "application/pdf" || ext === ".pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text?.trim() || null;
    }

    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === ".docx") {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value?.trim() || null;
    }

    if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        mimeType === "application/vnd.ms-excel" ||
        ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
      const workbook = XLSX.readFile(filePath);
      const textParts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        if (csv.trim()) {
          textParts.push(`[Sheet: ${sheetName}]\n${csv}`);
        }
      }
      return textParts.join("\n\n").trim() || null;
    }

    if (mimeType === "text/plain" || mimeType === "text/csv" ||
        ext === ".txt" || ext === ".csv" || ext === ".md") {
      const text = fs.readFileSync(filePath, "utf-8");
      return text.trim() || null;
    }

    if (ext === ".doc") {
      return null;
    }

    return null;
  } catch (error) {
    console.error("Error extracting text from file:", error);
    return null;
  }
}

// Helper to categorize text input based on content
function categorizeInput(content: string): string | null {
  const lowerContent = content.toLowerCase();
  
  if (lowerContent.includes("ton") || lowerContent.includes("gallon") || 
      lowerContent.includes("feedstock") || lowerContent.includes("waste") ||
      lowerContent.includes("manure") || lowerContent.includes("organic") ||
      lowerContent.includes("ts%") || lowerContent.includes("vs/ts") ||
      lowerContent.includes("bod") || lowerContent.includes("cod")) {
    return "feedstock";
  }
  
  if (lowerContent.includes("rng") || lowerContent.includes("biogas") ||
      lowerContent.includes("discharge") || lowerContent.includes("land appl") ||
      lowerContent.includes("output") || lowerContent.includes("produce") ||
      lowerContent.includes("electricity") || lowerContent.includes("compost")) {
    return "output_requirements";
  }
  
  if (lowerContent.includes("washington") || lowerContent.includes("location") ||
      lowerContent.includes("site") || lowerContent.includes("city") ||
      lowerContent.includes("county") || lowerContent.includes("state")) {
    return "location";
  }
  
  if (lowerContent.includes("must") || lowerContent.includes("require") ||
      lowerContent.includes("constraint") || lowerContent.includes("assumption") ||
      lowerContent.includes("limit") || lowerContent.includes("using")) {
    return "constraints";
  }
  
  return null;
}

// Helper to extract parameters from text (simple pattern matching for MVP)
interface ExtractedParam {
  category: string;
  name: string;
  value: string;
  unit?: string;
  source: string;
  confidence: string;
}

function extractParametersFromText(entries: Array<{ content: string; category: string | null }>): ExtractedParam[] {
  const params: ExtractedParam[] = [];
  const content = entries.map(e => e.content).join(" ");
  const lowerContent = content.toLowerCase();
  
  // Extract volume and feedstock type with multiple patterns
  let foundFeedstock = false;
  let foundVolume = false;
  
  // Pattern 1: "100,000 tons per year of potato waste"
  const pattern1 = /(\d[\d,]*)\s*(tons?|gallons?|lbs?|pounds?)\s*(?:per\s*year|\/year|annually)?\s*(?:of\s+)([a-zA-Z\s]+?)(?:\s+from|\s+waste|\s+material|\.|\,|$)/gi;
  const matches1 = Array.from(content.matchAll(pattern1));
  for (const match of matches1) {
    if (match[1] && match[3]) {
      const volume = match[1].replace(/,/g, "");
      const type = match[3].trim();
      if (!isNaN(parseInt(volume)) && type.length > 2 && !foundFeedstock) {
        params.push({
          category: "feedstock",
          name: "Feedstock Type",
          value: type.charAt(0).toUpperCase() + type.slice(1),
          source: "user_input",
          confidence: "high",
        });
        foundFeedstock = true;
      }
      if (!isNaN(parseInt(volume)) && !foundVolume) {
        params.push({
          category: "feedstock",
          name: "Volume/Capacity",
          value: volume,
          unit: `${match[2]}/year`,
          source: "user_input",
          confidence: "high",
        });
        foundVolume = true;
      }
    }
  }
  
  // Pattern 2: Check for common waste types directly
  if (!foundFeedstock) {
    const wasteTypes = [
      { pattern: /potato\s*(?:waste|processing|peels?|culls?)/i, value: "Potato Waste" },
      { pattern: /dairy\s*(?:manure|waste)/i, value: "Dairy Manure" },
      { pattern: /food\s*(?:waste|processing|scraps?)/i, value: "Food Waste" },
      { pattern: /organic\s*(?:waste|material)/i, value: "Organic Waste" },
      { pattern: /agricultural\s*(?:waste|residue)/i, value: "Agricultural Waste" },
      { pattern: /manure/i, value: "Manure" },
    ];
    
    for (const { pattern, value } of wasteTypes) {
      if (pattern.test(content)) {
        params.push({
          category: "feedstock",
          name: "Feedstock Type",
          value,
          source: "user_input",
          confidence: "high",
        });
        foundFeedstock = true;
        break;
      }
    }
  }
  
  // Pattern 3: Extract volume if not found yet - look for number + unit patterns
  if (!foundVolume) {
    const volumePattern = /(\d[\d,]*)\s*(tons?|gallons?|lbs?|pounds?)\s*(?:per\s*year|\/year|annually)?/gi;
    const volumeMatches = Array.from(content.matchAll(volumePattern));
    for (const match of volumeMatches) {
      if (match[1]) {
        const volume = match[1].replace(/,/g, "");
        if (!isNaN(parseInt(volume)) && parseInt(volume) > 100) {
          params.push({
            category: "feedstock",
            name: "Volume/Capacity",
            value: volume,
            unit: `${match[2]}/year`,
            source: "user_input",
            confidence: "high",
          });
          foundVolume = true;
          break;
        }
      }
    }
  }
  
  // Extract technical parameters
  const technicalPatterns: Array<{ regex: RegExp; name: string; unit: string }> = [
    { regex: /(\d+(?:\.\d+)?)\s*%?\s*(?:total\s*)?(?:ts|total\s*solids)/gi, name: "Total Solids (TS)", unit: "%" },
    { regex: /vs\/ts\s*(?:ratio\s*)?(?:of\s*)?(\d+(?:\.\d+)?)/gi, name: "VS/TS Ratio", unit: "" },
    { regex: /(\d+(?:\.\d+)?)\s*vs\/ts/gi, name: "VS/TS Ratio", unit: "" },
    { regex: /bod\s*(?:of\s*)?(\d+(?:,\d+)?)\s*(mg\/l|ppm)?/gi, name: "BOD", unit: "mg/L" },
    { regex: /cod\s*(?:of\s*)?(\d+(?:,\d+)?)\s*(mg\/l|ppm)?/gi, name: "COD", unit: "mg/L" },
    { regex: /c:?n\s*(?:ratio\s*)?(?:of\s*)?(\d+):?(\d+)?/gi, name: "C:N Ratio", unit: "" },
  ];
  
  for (const { regex, name, unit } of technicalPatterns) {
    const matches = content.matchAll(regex);
    for (const match of matches) {
      if (match[1]) {
        const value = match[1].replace(/,/g, "");
        params.push({
          category: "feedstock",
          name,
          value: match[2] ? `${match[1]}:${match[2]}` : value,
          unit: unit || match[2] || undefined,
          source: "user_input",
          confidence: "high",
        });
      }
    }
  }
  
  // Extract location
  const locationPatterns = [
    /(?:in|at|near|located\s+in)\s+([A-Z][a-zA-Z\s]+,\s*[A-Z]{2}|[A-Z][a-zA-Z\s]+,\s*[A-Z][a-z]+)/g,
    /([A-Z][a-zA-Z]+,\s*(?:Washington|Oregon|California|Idaho|Montana))/g,
  ];
  
  for (const pattern of locationPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        params.push({
          category: "location",
          name: "Project Location",
          value: match[1].trim(),
          source: "user_input",
          confidence: "high",
        });
        break;
      }
    }
  }
  
  // Extract output requirements
  if (lowerContent.includes("rng")) {
    params.push({
      category: "output_requirements",
      name: "Primary Output",
      value: "Renewable Natural Gas (RNG)",
      source: "user_input",
      confidence: "high",
    });
  }
  if (lowerContent.includes("land appl")) {
    params.push({
      category: "output_requirements",
      name: "Solids Handling",
      value: "Land Application",
      source: "user_input",
      confidence: "high",
    });
  }
  if (lowerContent.includes("discharge") && lowerContent.includes("wwtp")) {
    params.push({
      category: "output_requirements",
      name: "Liquid Handling",
      value: "Discharge to Municipal WWTP",
      source: "user_input",
      confidence: "high",
    });
  }
  
  // Extract constraints
  const constraintPatterns = [
    /must\s+use\s+([^,.]+)/gi,
    /using\s+([^,.]+)\s+(?:equipment|technology|digester)/gi,
    /must\s+meet\s+([^,.]+)/gi,
  ];
  
  for (const pattern of constraintPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        params.push({
          category: "constraints",
          name: "Constraint",
          value: match[1].trim(),
          source: "user_input",
          confidence: "high",
        });
      }
    }
  }
  
  // Add predicted parameters if feedstock is mentioned but technical params are missing
  const hasFeedstock = params.some(p => p.category === "feedstock");
  const hasTechnicalParams = params.some(p => ["Total Solids (TS)", "VS/TS Ratio", "BOD"].includes(p.name));
  
  if (hasFeedstock && !hasTechnicalParams) {
    // Predict common parameters for potato waste
    if (lowerContent.includes("potato")) {
      params.push(
        { category: "feedstock", name: "Total Solids (TS)", value: "12-18", unit: "%", source: "predicted", confidence: "medium" },
        { category: "feedstock", name: "VS/TS Ratio", value: "0.85-0.92", unit: "", source: "predicted", confidence: "medium" },
        { category: "feedstock", name: "C:N Ratio", value: "20-30", unit: "", source: "predicted", confidence: "low" },
      );
    } else if (lowerContent.includes("dairy") || lowerContent.includes("manure")) {
      params.push(
        { category: "feedstock", name: "Total Solids (TS)", value: "8-12", unit: "%", source: "predicted", confidence: "medium" },
        { category: "feedstock", name: "VS/TS Ratio", value: "0.75-0.85", unit: "", source: "predicted", confidence: "medium" },
        { category: "feedstock", name: "C:N Ratio", value: "15-25", unit: "", source: "predicted", confidence: "low" },
      );
    }
  }
  
  // Deduplicate by name
  const uniqueParams = params.reduce((acc, param) => {
    const existing = acc.find(p => p.name === param.name && p.category === param.category);
    if (!existing) {
      acc.push(param);
    }
    return acc;
  }, [] as ExtractedParam[]);
  
  return uniqueParams;
}

// AI-powered parameter extraction using OpenAI
async function extractParametersWithAI(entries: Array<{ content: string; category: string | null }>): Promise<ExtractedParam[]> {
  const content = entries.map(e => e.content).join("\n\n");
  
  if (!content.trim()) {
    console.log("AI extraction: No content to extract from");
    return [];
  }

  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.log("AI extraction: No OPENAI_API_KEY configured, using pattern matching");
    return extractParametersFromText(entries);
  }

  console.log("AI extraction: Starting extraction with OpenAI for content length:", content.length);

  const systemPrompt = `You are a senior biogas and anaerobic digestion project engineer conducting a detailed project intake review. Your job is to extract EVERY relevant technical, commercial, and logistical parameter from unstructured project descriptions.

APPROACH:
1. Read the entire text carefully and identify every piece of factual information: numbers, locations, materials, requirements, dates, costs, technical specifications, and implied details.
2. For each fact, classify it into the appropriate category.
3. Create a separate parameter entry for each distinct piece of information. Do NOT combine multiple facts into one parameter.

CATEGORIES:
- feedstock: Waste/material types, volumes and quantities, composition data (TS%, VS/TS ratio, BOD, COD, C:N ratio, moisture content), seasonal variations, number of sources/suppliers, current disposal methods, feedstock availability, hauling distances
- location: City, state, county, region, GPS coordinates, site details, proximity to gas pipelines or electrical grid, zoning information, land area/acreage, elevation, climate considerations
- output_requirements: Desired products (RNG, electricity, compressed biogas, compost, digestate, soil amendments), capacity/production targets, pipeline interconnection details, offtake agreements, power purchase agreements, gas quality specs (BTU, siloxane limits, H2S limits)
- constraints: Regulatory requirements (EPA, state DEQ, air permits, NPDES), timeline/deadlines, equipment preferences or specifications, technology preferences (mesophilic vs thermophilic, CSTR vs plug flow), existing infrastructure, partnership structures, labor considerations, odor requirements, noise limits, setback distances, environmental impact requirements

MULTIPLE FEEDSTOCKS:
When a project mentions more than one feedstock material, use a NUMBERED prefix to group parameters by feedstock identity:
- "Feedstock 1 Type", "Feedstock 1 Volume", "Feedstock 1 TS%", etc.
- "Feedstock 2 Type", "Feedstock 2 Volume", "Feedstock 2 TS%", etc.
Technical parameters like TS%, VS/TS, C:N ratio should also be prefixed with the feedstock number if they pertain to a specific feedstock.
If there is only one feedstock, you may omit the number prefix or use "Feedstock 1".

EXAMPLE INPUT:
"We have a food processing facility in Marion County, OR generating 50 tons/day of vegetable processing waste and 10 tons/day of FOG from our grease traps. TS is around 8% for the vegetable waste. We want to produce RNG for pipeline injection and will need to discharge liquid effluent to the local municipal WWTP. The dewatered digestate will be land-applied on nearby farmland. Budget is $18M. Need air permit submitted by Q1 2027 and online by Q4 2027. We prefer a mesophilic CSTR design."

EXAMPLE OUTPUT:
{"parameters": [
  {"category": "feedstock", "name": "Feedstock 1 Type", "value": "Vegetable processing waste", "unit": null, "confidence": "high"},
  {"category": "feedstock", "name": "Feedstock 1 Volume", "value": "50", "unit": "tons/day", "confidence": "high"},
  {"category": "feedstock", "name": "Feedstock 1 TS%", "value": "8", "unit": "%", "confidence": "high"},
  {"category": "feedstock", "name": "Feedstock 2 Type", "value": "FOG (Fats, Oils, Grease)", "unit": null, "confidence": "high"},
  {"category": "feedstock", "name": "Feedstock 2 Volume", "value": "10", "unit": "tons/day", "confidence": "high"},
  {"category": "feedstock", "name": "Number of Feedstock Sources", "value": "2", "unit": "sources", "confidence": "medium"},
  {"category": "location", "name": "County", "value": "Marion County", "unit": null, "confidence": "high"},
  {"category": "location", "name": "State", "value": "Oregon", "unit": null, "confidence": "high"},
  {"category": "output_requirements", "name": "Primary Output", "value": "Renewable Natural Gas (RNG)", "unit": null, "confidence": "high"},
  {"category": "output_requirements", "name": "Liquid Handling", "value": "Discharge to Municipal WWTP", "unit": null, "confidence": "high"},
  {"category": "output_requirements", "name": "Solid Digestate Handling", "value": "Land application on nearby farmland", "unit": null, "confidence": "high"},
  {"category": "constraints", "name": "Capital Budget", "value": "18", "unit": "million USD", "confidence": "high"},
  {"category": "constraints", "name": "Air Permit Deadline", "value": "Q1 2027", "unit": null, "confidence": "high"},
  {"category": "constraints", "name": "Target Online Date", "value": "Q4 2027", "unit": null, "confidence": "high"},
  {"category": "constraints", "name": "Digester Technology Preference", "value": "Mesophilic CSTR", "unit": null, "confidence": "high"}
]}

RULES:
- Be EXHAUSTIVE. Extract every quantitative value, date, location, material, cost, and requirement mentioned.
- A typical paragraph should yield 8-15+ parameters. If you find fewer than 5, re-read the text - you are missing details.
- Create SEPARATE parameter entries for each distinct fact. Never combine "Feedstock Type" and "Volume" into one parameter.
- Use specific, descriptive parameter names (e.g., "Primary Feedstock Volume" not "Volume", "Capital Budget" not "Cost").
- Always include units when they are stated or can be reasonably inferred.
- Look for IMPLIED information too: if someone mentions a farm or facility, extract both the feedstock source AND the location.
- LIQUID HANDLING IS CRITICAL: Every anaerobic digestion project produces liquid effluent that must go somewhere. If the input mentions discharge to sewer, WWTP, wastewater treatment, or any liquid handling pathway, extract it as an output_requirements parameter (e.g., "Liquid Handling": "Discharge to Municipal WWTP"). If liquid handling is not mentioned but feedstock is described, infer "Liquid Handling" as "To be determined - WWTP discharge or land application likely required" with confidence "low".
- For confidence levels: "high" = explicitly stated with a specific value, "medium" = clearly implied or partially stated, "low" = requires assumption or is ambiguous.

COMMONLY MISSED DETAILS - check for these:
- Seasonal variations in feedstock availability
- Current disposal methods (what happens to waste now?)
- Distance/proximity mentions (miles to pipeline, nearest town)
- Timeline or deadline references (permits, construction, operations)
- Regulatory or permit mentions (EPA, DEQ, LCFS, RFS)
- Number of sources, facilities, or partners
- Implied infrastructure needs (RNG implies gas cleanup + pipeline interconnect)
- Liquid effluent handling pathway (WWTP discharge, land application, irrigation, storage lagoon)
- Technology specifications (digester type, gas cleanup method)
- Environmental requirements (odor, noise, setbacks, emissions)

Return ONLY the JSON object with the "parameters" array.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `Carefully analyze the following project description and extract ALL parameters. Be thorough - capture every detail mentioned or clearly implied:\n\n${content}`
        }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 16384,
    });

    const rawResponse = response.choices[0].message.content || "{}";
    console.log("AI extraction: Received response from OpenAI, length:", rawResponse.length);
    console.log("AI extraction: Token usage - prompt:", response.usage?.prompt_tokens, "completion:", response.usage?.completion_tokens);
    
    const result = JSON.parse(rawResponse);
    
    if (!result.parameters || !Array.isArray(result.parameters)) {
      console.log("AI returned invalid format, falling back to pattern matching. Raw response:", rawResponse.substring(0, 500));
      return extractParametersFromText(entries);
    }

    console.log("AI extraction: Successfully extracted", result.parameters.length, "parameters");
    console.log("AI extraction: Categories breakdown:", 
      result.parameters.reduce((acc: Record<string, number>, p: { category: string }) => {
        acc[p.category] = (acc[p.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    );

    return result.parameters.map((p: { category: string; name: string; value: string; unit?: string; confidence: string }) => ({
      category: p.category,
      name: p.name,
      value: String(p.value),
      unit: p.unit || undefined,
      source: "ai_extraction",
      confidence: p.confidence,
    }));
  } catch (error) {
    console.error("AI extraction failed, falling back to pattern matching. Error:", error);
    return extractParametersFromText(entries);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Create uploads directory if it doesn't exist
  if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads", { recursive: true });
  }

  // Projects
  app.get("/api/projects", async (_req: Request, res: Response) => {
    try {
      const projects = await storage.getAllProjects();
      res.json(projects);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  app.post("/api/projects", async (req: Request, res: Response) => {
    try {
      const data = insertProjectSchema.parse(req.body);
      const project = await storage.createProject(data);
      res.status(201).json(project);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating project:", error);
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  app.delete("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      await storage.deleteProject(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting project:", error);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // Scenarios
  app.get("/api/projects/:projectId/scenarios", async (req: Request, res: Response) => {
    try {
      const scenarios = await storage.getScenariosByProject(req.params.projectId);
      res.json(scenarios);
    } catch (error) {
      console.error("Error fetching scenarios:", error);
      res.status(500).json({ error: "Failed to fetch scenarios" });
    }
  });

  app.get("/api/scenarios/recent", async (_req: Request, res: Response) => {
    try {
      const scenarios = await storage.getRecentScenarios();
      res.json(scenarios);
    } catch (error) {
      console.error("Error fetching recent scenarios:", error);
      res.status(500).json({ error: "Failed to fetch recent scenarios" });
    }
  });

  app.get("/api/scenarios/:id", async (req: Request, res: Response) => {
    try {
      const scenario = await storage.getScenario(req.params.id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }
      res.json(scenario);
    } catch (error) {
      console.error("Error fetching scenario:", error);
      res.status(500).json({ error: "Failed to fetch scenario" });
    }
  });

  app.post("/api/projects/:projectId/scenarios", async (req: Request, res: Response) => {
    try {
      const data = insertScenarioSchema.parse({
        ...req.body,
        projectId: req.params.projectId,
      });
      const scenario = await storage.createScenario(data);
      res.status(201).json(scenario);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating scenario:", error);
      res.status(500).json({ error: "Failed to create scenario" });
    }
  });

  app.delete("/api/scenarios/:id", async (req: Request, res: Response) => {
    try {
      await storage.deleteScenario(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting scenario:", error);
      res.status(500).json({ error: "Failed to delete scenario" });
    }
  });

  // Text Entries
  app.get("/api/scenarios/:scenarioId/text-entries", async (req: Request, res: Response) => {
    try {
      const entries = await storage.getTextEntriesByScenario(req.params.scenarioId);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching text entries:", error);
      res.status(500).json({ error: "Failed to fetch text entries" });
    }
  });

  app.post("/api/scenarios/:scenarioId/text-entries", async (req: Request, res: Response) => {
    try {
      const category = categorizeInput(req.body.content);
      const data = insertTextEntrySchema.parse({
        ...req.body,
        scenarioId: req.params.scenarioId,
        category,
      });
      const entry = await storage.createTextEntry(data);
      res.status(201).json(entry);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating text entry:", error);
      res.status(500).json({ error: "Failed to create text entry" });
    }
  });

  app.delete("/api/text-entries/:id", async (req: Request, res: Response) => {
    try {
      await storage.deleteTextEntry(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting text entry:", error);
      res.status(500).json({ error: "Failed to delete text entry" });
    }
  });

  // Documents
  app.get("/api/scenarios/:scenarioId/documents", async (req: Request, res: Response) => {
    try {
      const docs = await storage.getDocumentsByScenario(req.params.scenarioId);
      res.json(docs);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/scenarios/:scenarioId/documents", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const filePath = req.file.path;
      let extractedText: string | null = null;
      
      try {
        extractedText = await extractTextFromFile(filePath, req.file.mimetype, req.file.originalname);
        if (extractedText) {
          console.log(`Document text extraction: extracted ${extractedText.length} chars from ${req.file.originalname}`);
        } else {
          console.log(`Document text extraction: no text extracted from ${req.file.originalname} (unsupported format or empty)`);
        }
      } catch (extractErr) {
        console.error("Document text extraction failed (non-fatal):", extractErr);
      }
      
      const doc = await storage.createDocument({
        scenarioId: req.params.scenarioId,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size.toString(),
        extractedText,
      });
      
      res.status(201).json(doc);
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });

  app.delete("/api/documents/:id", async (req: Request, res: Response) => {
    try {
      await storage.deleteDocument(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  // Parameters
  app.get("/api/scenarios/:scenarioId/parameters", async (req: Request, res: Response) => {
    try {
      const params = await storage.getParametersByScenario(req.params.scenarioId);
      res.json(params);
    } catch (error) {
      console.error("Error fetching parameters:", error);
      res.status(500).json({ error: "Failed to fetch parameters" });
    }
  });

  app.post("/api/scenarios/:scenarioId/extract", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId;
      
      // Get all text entries for this scenario
      const entries = await storage.getTextEntriesByScenario(scenarioId);
      
      // Get all documents with extracted text for this scenario
      const documents = await storage.getDocumentsByScenario(scenarioId);
      const docEntries = documents
        .filter(doc => doc.extractedText && doc.extractedText.trim())
        .map(doc => ({
          content: `[From document: ${doc.originalName}]\n${doc.extractedText}`,
          category: null as string | null,
        }));
      
      if (docEntries.length > 0) {
        console.log(`Including ${docEntries.length} document(s) with extracted text in parameter extraction`);
      }
      
      // Combine text entries and document text for extraction
      const allEntries = [...entries, ...docEntries];
      
      // Extract parameters using AI (falls back to pattern matching if AI fails)
      const extractedParams = await extractParametersWithAI(allEntries);
      
      // Clear existing parameters
      await storage.deleteParametersByScenario(scenarioId);
      
      // Create new parameters
      for (const param of extractedParams) {
        await storage.createParameter({
          scenarioId,
          ...param,
          isConfirmed: false,
        });
      }
      
      // Create or update UPIF with deterministic parameter mapping
      const existingUpif = await storage.getUpifByScenario(scenarioId);
      
      // Step 1: Group feedstock parameters by feedstock identity (numbered prefix or legacy names)
      const feedstockParams = extractedParams.filter(p => p.category === "feedstock");
      
      function classifyFeedstockParam(name: string): { index: number; cleanName: string } {
        const numbered = name.match(/^Feedstock\s+(\d+)\s+(.+)$/i);
        if (numbered) return { index: parseInt(numbered[1]), cleanName: numbered[2].trim() };
        const lower = name.toLowerCase();
        if (lower.includes("primary") || lower.includes("feedstock type")) return { index: 1, cleanName: name.replace(/primary\s*/i, "").replace(/feedstock\s*/i, "").trim() || "Type" };
        if (lower.includes("secondary")) return { index: 2, cleanName: name.replace(/secondary\s*/i, "").replace(/feedstock\s*/i, "").trim() || "Type" };
        if (lower.includes("tertiary")) return { index: 3, cleanName: name.replace(/tertiary\s*/i, "").replace(/feedstock\s*/i, "").trim() || "Type" };
        if (lower.includes("number of") || lower.includes("feedstock source")) return { index: 0, cleanName: name };
        return { index: 1, cleanName: name };
      }
      
      const feedstockGroups: Map<number, Array<{ cleanName: string; value: string; unit?: string }>> = new Map();
      for (const param of feedstockParams) {
        const { index, cleanName } = classifyFeedstockParam(param.name);
        if (index === 0) continue;
        if (!feedstockGroups.has(index)) feedstockGroups.set(index, []);
        feedstockGroups.get(index)!.push({ cleanName, value: param.value || "", unit: param.unit || undefined });
      }
      
      function mapTechnicalParamName(rawName: string): string | null {
        const n = rawName.toLowerCase().trim();
        const isVolumeMetric = n.includes("annual") || n.includes("quantity") || n.includes("daily") || n.includes("average") || n.includes("generation") || n.includes("onsite") || n.includes("number of") || n.includes("facility type") || n.includes("source") || n.includes("herd");
        if (isVolumeMetric) return null;
        if (n.includes("vs/ts") || n.includes("vs:ts") || n.includes("volatile solids to total solids")) return "VS/TS";
        if (n.includes("total solids") || n === "ts%" || n === "ts (%)" || n === "ts") return "Total Solids";
        if (n.includes("volatile solids") || n === "vs" || n === "vs (% of ts)") return "Volatile Solids";
        if ((n.includes("c:n") || n.includes("c/n")) || (n.includes("carbon") && n.includes("nitrogen"))) return "C:N Ratio";
        if (n.includes("moisture")) return "Moisture Content";
        if (n.includes("bulk density") || n === "density") return "Bulk Density";
        if (n.includes("bmp") || n.includes("biochemical methane") || n.includes("methane potential")) return "BMP";
        if (n.includes("biodegradable fraction") || n.includes("biodegradability")) return "Biodegradable Fraction";
        return null;
      }
      
      const feedstockEntries: FeedstockEntry[] = [];
      const sortedKeys = Array.from(feedstockGroups.keys()).sort((a, b) => a - b);
      
      for (const idx of sortedKeys) {
        const group = feedstockGroups.get(idx)!;
        const typeParam = group.find(p => {
          const l = p.cleanName.toLowerCase();
          return l === "type" || l.includes("type") || l === "feedstock" || l === "";
        });
        const volumeParam = group.find(p => {
          const l = p.cleanName.toLowerCase();
          return l.includes("volume") || l.includes("quantity") || l.includes("capacity");
        });
        
        const feedstockType = typeParam?.value || `Unknown Feedstock ${idx}`;
        const userParams: Record<string, { value: string; unit?: string }> = {};
        const rawParams: Record<string, { value: string; unit: string }> = {};
        
        for (const p of group) {
          if (p === typeParam || p === volumeParam) continue;
          const mapped = mapTechnicalParamName(p.cleanName);
          if (mapped) {
            userParams[mapped] = { value: p.value, unit: p.unit };
          }
          rawParams[p.cleanName] = { value: p.value, unit: p.unit || "" };
        }
        
        const specs = enrichFeedstockSpecs(feedstockType, userParams);
        console.log(`Enrichment: Feedstock ${idx} "${feedstockType}" - ${Object.keys(specs).length} specs`);
        
        feedstockEntries.push({
          feedstockType,
          feedstockVolume: volumeParam?.value,
          feedstockUnit: volumeParam?.unit,
          feedstockParameters: Object.keys(rawParams).length > 0 ? rawParams : undefined,
          feedstockSpecs: Object.keys(specs).length > 0 ? specs : undefined,
        });
      }
      
      console.log("Enrichment: Total feedstock entries:", feedstockEntries.length);
      
      // Legacy single-feedstock fields (backward compat - use first entry)
      const primaryFeedstock = feedstockEntries[0];
      
      // Collect all location info
      const locationParams = extractedParams.filter(p => p.category === "location");
      const location = locationParams.length > 0
        ? locationParams.map(p => `${p.value}`).join(", ")
        : "";
      
      // Collect all output requirements
      const outputParams = extractedParams.filter(p => p.category === "output_requirements");
      
      // Collect all constraints
      const constraints = extractedParams.filter(p => p.category === "constraints").map(p => 
        p.name !== "Constraint" ? `${p.name}: ${p.value}` : p.value
      );
      
      // Step 4: Enrich output acceptance criteria using the output criteria knowledge base
      const outputSpecs: Record<string, Record<string, EnrichedOutputSpec>> = {};
      const userOutputCriteria: Record<string, { value: string; unit?: string }> = {};
      for (const param of outputParams) {
        userOutputCriteria[param.name] = { value: param.value || "", unit: param.unit || undefined };
      }
      
      for (const param of outputParams) {
        const outputDesc = `${param.name} ${param.value}`.toLowerCase();
        const matched = matchOutputType(outputDesc);
        if (matched && !outputSpecs[matched.name]) {
          const enriched = enrichOutputSpecs(matched.name, userOutputCriteria, location || undefined);
          outputSpecs[matched.name] = enriched;
          console.log("Output enrichment: Generated", Object.keys(enriched).length, "criteria for", matched.name);
        }
      }
      
      const allOutputText = outputParams.map(p => `${p.name} ${p.value}`).join(" ").toLowerCase();
      const allInputText = allEntries.map(e => e.content).join(" ").toLowerCase();
      const searchText = `${allOutputText} ${allInputText}`;
      
      const rngKeywords = ["rng", "pipeline", "biomethane", "renewable natural gas", "upgraded biogas", "pipeline injection"];
      const digestateKeywords = ["digestate", "land application", "biosolids", "compost", "soil amendment", "land apply"];
      const effluentKeywords = ["effluent", "wwtp", "discharge", "sewer", "wastewater", "liquid effluent", "centrate", "filtrate", "liquid digestate", "treatment plant"];
      
      const rngProfile = "Renewable Natural Gas (RNG) - Pipeline Injection";
      const digestateProfile = "Solid Digestate - Land Application";
      const effluentProfile = "Liquid Effluent - Discharge to WWTP";
      
      if (!outputSpecs[rngProfile] && rngKeywords.some(k => searchText.includes(k))) {
        const enriched = enrichOutputSpecs(rngProfile, userOutputCriteria, location || undefined);
        outputSpecs[rngProfile] = enriched;
        console.log("Output enrichment (keyword fallback): Generated", Object.keys(enriched).length, "criteria for", rngProfile);
      }
      if (!outputSpecs[digestateProfile] && digestateKeywords.some(k => searchText.includes(k))) {
        const enriched = enrichOutputSpecs(digestateProfile, userOutputCriteria, location || undefined);
        outputSpecs[digestateProfile] = enriched;
        console.log("Output enrichment (keyword fallback): Generated", Object.keys(enriched).length, "criteria for", digestateProfile);
      }
      if (!outputSpecs[effluentProfile] && effluentKeywords.some(k => searchText.includes(k))) {
        const enriched = enrichOutputSpecs(effluentProfile, userOutputCriteria, location || undefined);
        outputSpecs[effluentProfile] = enriched;
        console.log("Output enrichment (keyword fallback): Generated", Object.keys(enriched).length, "criteria for", effluentProfile);
      }
      
      console.log("Output enrichment: Total output profiles enriched:", Object.keys(outputSpecs).length);
      
      const upifData = {
        scenarioId,
        feedstockType: primaryFeedstock?.feedstockType,
        feedstockVolume: primaryFeedstock?.feedstockVolume,
        feedstockUnit: primaryFeedstock?.feedstockUnit,
        feedstockParameters: primaryFeedstock?.feedstockParameters,
        feedstockSpecs: primaryFeedstock?.feedstockSpecs,
        feedstocks: feedstockEntries.length > 0 ? feedstockEntries : undefined,
        outputRequirements: outputParams.map(p => `${p.name}: ${p.value}${p.unit ? ` ${p.unit}` : ""}`).join("; "),
        outputSpecs: Object.keys(outputSpecs).length > 0 ? outputSpecs : undefined,
        location,
        constraints,
        isConfirmed: false,
      };
      
      if (existingUpif) {
        await storage.updateUpif(scenarioId, upifData);
      } else {
        await storage.createUpif(upifData);
      }
      
      // Update scenario status
      await storage.updateScenarioStatus(scenarioId, "in_review");
      
      const params = await storage.getParametersByScenario(scenarioId);
      res.json(params);
    } catch (error) {
      console.error("Error extracting parameters:", error);
      res.status(500).json({ error: "Failed to extract parameters" });
    }
  });

  app.patch("/api/parameters/:id", async (req: Request, res: Response) => {
    try {
      const { value, isConfirmed } = req.body;
      const updates: Record<string, unknown> = {};
      if (value !== undefined) updates.value = value;
      if (isConfirmed !== undefined) updates.isConfirmed = isConfirmed;
      
      const param = await storage.updateParameter(req.params.id, updates);
      if (!param) {
        return res.status(404).json({ error: "Parameter not found" });
      }
      res.json(param);
    } catch (error) {
      console.error("Error updating parameter:", error);
      res.status(500).json({ error: "Failed to update parameter" });
    }
  });

  // UPIF
  app.get("/api/scenarios/:scenarioId/upif", async (req: Request, res: Response) => {
    try {
      const upif = await storage.getUpifByScenario(req.params.scenarioId);
      res.json(upif || null);
    } catch (error) {
      console.error("Error fetching UPIF:", error);
      res.status(500).json({ error: "Failed to fetch UPIF" });
    }
  });

  app.patch("/api/scenarios/:scenarioId/upif", async (req: Request, res: Response) => {
    try {
      const upif = await storage.updateUpif(req.params.scenarioId, req.body);
      if (!upif) {
        return res.status(404).json({ error: "UPIF not found" });
      }
      res.json(upif);
    } catch (error) {
      console.error("Error updating UPIF:", error);
      res.status(500).json({ error: "Failed to update UPIF" });
    }
  });

  app.post("/api/scenarios/:scenarioId/confirm", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId;
      
      // Confirm UPIF
      await storage.confirmUpif(scenarioId);
      
      // Update scenario status
      await storage.updateScenarioStatus(scenarioId, "confirmed", new Date());
      
      const scenario = await storage.getScenario(scenarioId);
      res.json(scenario);
    } catch (error) {
      console.error("Error confirming scenario:", error);
      res.status(500).json({ error: "Failed to confirm scenario" });
    }
  });

  // PDF Table Drawing Helper
  function drawTable(
    doc: InstanceType<typeof PDFDocument>,
    headers: string[],
    rows: string[][],
    startX: number,
    startY: number,
    colWidths: number[],
    options?: { fontSize?: number; margin?: number }
  ): number {
    const fontSize = options?.fontSize || 8;
    const margin = options?.margin || 50;
    const rowHeight = 18;
    const pageHeight = 792;
    let y = startY;

    const drawRow = (cells: string[], bold: boolean, bgColor?: string) => {
      if (y + rowHeight > pageHeight - margin - 30) {
        doc.addPage();
        y = margin;
      }
      if (bgColor) {
        doc.save();
        doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill(bgColor);
        doc.restore();
      }
      let x = startX;
      for (let i = 0; i < cells.length; i++) {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(fontSize)
          .fillColor("#333333")
          .text(cells[i] || "", x + 3, y + 4, {
            width: colWidths[i] - 6,
            height: rowHeight - 4,
            ellipsis: true,
            lineBreak: false,
          });
        x += colWidths[i];
      }
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);
      doc.strokeColor("#cccccc").lineWidth(0.5)
        .moveTo(startX, y + rowHeight).lineTo(startX + tableWidth, y + rowHeight).stroke();
      y += rowHeight;
    };

    drawRow(headers, true, "#e8e8e8");
    rows.forEach((row, idx) => {
      drawRow(row, false, idx % 2 === 1 ? "#f5f5f5" : undefined);
    });

    return y;
  }

  // PDF Export Route
  app.get("/api/scenarios/:scenarioId/upif/export-pdf", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId;
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }
      const project = await storage.getProject(scenario.projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      const upif = await storage.getUpifByScenario(scenarioId);
      if (!upif) {
        return res.status(404).json({ error: "No UPIF found for this scenario" });
      }

      const isDraft = scenario.status !== "confirmed";

      // Build feedstock list
      const feedstocks: FeedstockEntry[] = upif.feedstocks && upif.feedstocks.length > 0
        ? upif.feedstocks
        : upif.feedstockType
          ? [{
              feedstockType: upif.feedstockType,
              feedstockVolume: upif.feedstockVolume || undefined,
              feedstockUnit: upif.feedstockUnit || undefined,
              feedstockSpecs: upif.feedstockSpecs || undefined,
            }]
          : [];

      // Generate AI summary
      let aiSummary = "";
      try {
        const feedstockDesc = feedstocks.map(f =>
          `${f.feedstockType}${f.feedstockVolume ? ` (${f.feedstockVolume} ${f.feedstockUnit || ""})` : ""}`
        ).join(", ");

        const prompt = `Write a concise one-paragraph project summary for a biogas/anaerobic digestion project intake form. The project "${project.name}" (scenario: "${scenario.name}") involves the following:
- Feedstock(s): ${feedstockDesc || "Not specified"}
- Location: ${upif.location || "Not specified"}
- Output requirements: ${upif.outputRequirements || "Not specified"}
- Constraints: ${upif.constraints?.join("; ") || "None specified"}

Provide a professional, technical summary in 3-5 sentences.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-5",
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: 300,
        });
        aiSummary = completion.choices[0]?.message?.content?.trim() || "";
      } catch (err) {
        console.error("OpenAI summary generation failed, using fallback:", err);
      }

      if (!aiSummary) {
        const parts: string[] = [];
        parts.push(`This project intake form documents the "${project.name}" project (scenario: "${scenario.name}").`);
        if (feedstocks.length > 0) {
          const desc = feedstocks.map(f => `${f.feedstockType}${f.feedstockVolume ? ` at ${f.feedstockVolume} ${f.feedstockUnit || ""}` : ""}`).join(", ");
          parts.push(`The proposed feedstock(s) include ${desc}.`);
        }
        if (upif.location) parts.push(`The project is located in ${upif.location}.`);
        if (upif.outputRequirements) parts.push(`Output requirements: ${upif.outputRequirements}.`);
        if (upif.constraints && upif.constraints.length > 0) parts.push(`Key constraints: ${upif.constraints.join("; ")}.`);
        aiSummary = parts.join(" ");
      }

      // Create PDF
      const doc = new PDFDocument({
        size: "LETTER",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));

      const pdfReady = new Promise<Buffer>((resolve) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
      });

      const pageWidth = 612;
      const contentWidth = pageWidth - 100;
      const leftMargin = 50;

      const addWatermark = () => {
        if (!isDraft) return;
        doc.save();
        doc.fontSize(120)
          .font("Helvetica-Bold")
          .fillColor("#cccccc")
          .opacity(0.15)
          .translate(pageWidth / 2, 792 / 2)
          .rotate(-45, { origin: [0, 0] })
          .text("DRAFT", -200, -50, { align: "center" });
        doc.restore();
        doc.opacity(1);
      };

      doc.on("pageAdded", () => {
        addWatermark();
      });

      // First page watermark
      addWatermark();

      // Header
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#222222")
        .text("UNIFIED PROJECT INTAKE FORM", leftMargin, 50, { align: "center", width: contentWidth });

      doc.font("Helvetica-Bold").fontSize(14).fillColor("#444444")
        .text(project.name, leftMargin, doc.y + 6, { align: "center", width: contentWidth });

      doc.font("Helvetica").fontSize(11).fillColor("#666666")
        .text(scenario.name, leftMargin, doc.y + 4, { align: "center", width: contentWidth });

      const dateStr = upif.createdAt ? new Date(upif.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";
      doc.font("Helvetica").fontSize(9).fillColor("#888888")
        .text(dateStr, leftMargin, doc.y + 6, { align: "right", width: contentWidth });

      const statusText = isDraft ? "DRAFT" : "CONFIRMED";
      const statusColor = isDraft ? "#d97706" : "#16a34a";
      doc.font("Helvetica-Bold").fontSize(9).fillColor(statusColor)
        .text(`Status: ${statusText}`, leftMargin, doc.y + 2, { align: "right", width: contentWidth });

      // Horizontal rule
      let currentY = doc.y + 10;
      doc.strokeColor("#cccccc").lineWidth(1)
        .moveTo(leftMargin, currentY).lineTo(leftMargin + contentWidth, currentY).stroke();
      currentY += 15;

      // AI Summary Section
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#222222")
        .text("Project Summary", leftMargin, currentY);
      currentY = doc.y + 6;

      doc.font("Helvetica").fontSize(10).fillColor("#333333")
        .text(aiSummary, leftMargin, currentY, { width: contentWidth, lineGap: 2 });
      currentY = doc.y + 12;

      doc.strokeColor("#cccccc").lineWidth(0.5)
        .moveTo(leftMargin, currentY).lineTo(leftMargin + contentWidth, currentY).stroke();
      currentY += 15;

      // Feedstock Information Section
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#222222")
        .text("Feedstock Information", leftMargin, currentY);
      currentY = doc.y + 8;

      if (feedstocks.length === 0) {
        doc.font("Helvetica").fontSize(10).fillColor("#666666")
          .text("No feedstock information available.", leftMargin, currentY, { width: contentWidth });
        currentY = doc.y + 10;
      } else {
        for (const feedstock of feedstocks) {
          if (currentY > 700) {
            doc.addPage();
            currentY = 50;
          }

          doc.font("Helvetica-Bold").fontSize(11).fillColor("#333333")
            .text(feedstock.feedstockType, leftMargin, currentY);
          currentY = doc.y + 4;

          if (feedstock.feedstockVolume) {
            doc.font("Helvetica").fontSize(10).fillColor("#555555")
              .text(`Volume: ${feedstock.feedstockVolume} ${feedstock.feedstockUnit || ""}`, leftMargin, currentY);
            currentY = doc.y + 6;
          }

          if (feedstock.feedstockSpecs && Object.keys(feedstock.feedstockSpecs).length > 0) {
            const specs = feedstock.feedstockSpecs;
            const grouped: Record<string, Array<[string, any]>> = {};

            for (const [key, spec] of Object.entries(specs)) {
              const group = spec.group || "extended";
              if (!grouped[group]) grouped[group] = [];
              grouped[group].push([key, spec]);
            }

            for (const group of Object.keys(grouped)) {
              grouped[group].sort((a, b) => (a[1].sortOrder || 0) - (b[1].sortOrder || 0));
            }

            const colWidths = [130, 100, 60, 70, 152];
            const headers = ["Parameter", "Value", "Unit", "Source", "Notes"];

            for (const groupKey of feedstockGroupOrder) {
              const items = grouped[groupKey];
              if (!items || items.length === 0) continue;

              if (currentY > 700) {
                doc.addPage();
                currentY = 50;
              }

              doc.font("Helvetica-Bold").fontSize(9).fillColor("#555555")
                .text(feedstockGroupLabels[groupKey] || groupKey, leftMargin, currentY);
              currentY = doc.y + 4;

              const rows = items.map(([, spec]) => [
                spec.displayName || "",
                spec.value || "",
                spec.unit || "",
                spec.source === "user_provided" ? "User" : "Estimated",
                (spec.provenance || "").substring(0, 60),
              ]);

              currentY = drawTable(doc, headers, rows, leftMargin, currentY, colWidths);
              currentY += 6;
            }
          }
          currentY += 8;
        }
      }

      // Output Requirements Section
      if (currentY > 680) {
        doc.addPage();
        currentY = 50;
      }

      doc.strokeColor("#cccccc").lineWidth(0.5)
        .moveTo(leftMargin, currentY).lineTo(leftMargin + contentWidth, currentY).stroke();
      currentY += 15;

      doc.font("Helvetica-Bold").fontSize(13).fillColor("#222222")
        .text("Output Requirements & Acceptance Criteria", leftMargin, currentY);
      currentY = doc.y + 8;

      if (upif.outputRequirements) {
        doc.font("Helvetica").fontSize(10).fillColor("#333333")
          .text(upif.outputRequirements, leftMargin, currentY, { width: contentWidth });
        currentY = doc.y + 10;
      }

      if (upif.outputSpecs && Object.keys(upif.outputSpecs).length > 0) {
        for (const [profileName, criteria] of Object.entries(upif.outputSpecs)) {
          if (currentY > 680) {
            doc.addPage();
            currentY = 50;
          }

          doc.font("Helvetica-Bold").fontSize(11).fillColor("#333333")
            .text(profileName, leftMargin, currentY);
          currentY = doc.y + 4;

          const grouped: Record<string, Array<[string, any]>> = {};
          for (const [key, spec] of Object.entries(criteria)) {
            const group = spec.group || "regulatory";
            if (!grouped[group]) grouped[group] = [];
            grouped[group].push([key, spec]);
          }

          for (const group of Object.keys(grouped)) {
            grouped[group].sort((a, b) => (a[1].sortOrder || 0) - (b[1].sortOrder || 0));
          }

          const colWidths = [110, 80, 55, 75, 55, 137];
          const headers = ["Criterion", "Value", "Unit", "Source", "Confidence", "Notes"];

          for (const groupKey of outputGroupOrder) {
            const items = grouped[groupKey];
            if (!items || items.length === 0) continue;

            if (currentY > 700) {
              doc.addPage();
              currentY = 50;
            }

            doc.font("Helvetica-Bold").fontSize(9).fillColor("#555555")
              .text(outputGroupLabels[groupKey] || groupKey, leftMargin, currentY);
            currentY = doc.y + 4;

            const rows = items.map(([, spec]) => [
              spec.displayName || "",
              spec.value || "",
              spec.unit || "",
              (spec.source || "").replace(/_/g, " "),
              spec.confidence || "",
              (spec.provenance || "").substring(0, 50),
            ]);

            currentY = drawTable(doc, headers, rows, leftMargin, currentY, colWidths);
            currentY += 6;
          }
          currentY += 8;
        }
      }

      // Location & Constraints
      if (currentY > 680) {
        doc.addPage();
        currentY = 50;
      }

      doc.strokeColor("#cccccc").lineWidth(0.5)
        .moveTo(leftMargin, currentY).lineTo(leftMargin + contentWidth, currentY).stroke();
      currentY += 15;

      doc.font("Helvetica-Bold").fontSize(13).fillColor("#222222")
        .text("Location", leftMargin, currentY);
      currentY = doc.y + 4;

      doc.font("Helvetica").fontSize(10).fillColor("#333333")
        .text(upif.location || "Not specified", leftMargin, currentY, { width: contentWidth });
      currentY = doc.y + 12;

      doc.font("Helvetica-Bold").fontSize(13).fillColor("#222222")
        .text("Constraints", leftMargin, currentY);
      currentY = doc.y + 4;

      if (upif.constraints && upif.constraints.length > 0) {
        for (const constraint of upif.constraints) {
          if (currentY > 750) {
            doc.addPage();
            currentY = 50;
          }
          doc.font("Helvetica").fontSize(10).fillColor("#333333")
            .text(`  \u2022  ${constraint}`, leftMargin, currentY, { width: contentWidth });
          currentY = doc.y + 2;
        }
      } else {
        doc.font("Helvetica").fontSize(10).fillColor("#666666")
          .text("No constraints specified.", leftMargin, currentY, { width: contentWidth });
      }

      // Add page numbers and footer to all pages
      const totalPages = doc.bufferedPageRange().count;
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        doc.font("Helvetica").fontSize(9).fillColor("#888888")
          .text(`Page ${i + 1} of ${totalPages}`, leftMargin, 760, { align: "center", width: contentWidth });
        doc.font("Helvetica").fontSize(8).fillColor("#aaaaaa")
          .text("Generated by Project Alpha", leftMargin, 760, { align: "right", width: contentWidth });
      }

      doc.end();

      const pdfBuffer = await pdfReady;

      const safeName = scenario.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="UPIF-${safeName}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error exporting UPIF PDF:", error);
      res.status(500).json({ error: "Failed to export PDF" });
    }
  });

  return httpServer;
}
