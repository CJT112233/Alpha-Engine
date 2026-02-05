import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { insertProjectSchema, insertScenarioSchema, insertTextEntrySchema } from "@shared/schema";
import { z } from "zod";
import OpenAI from "openai";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

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
  
  if (lowerContent.includes("$") || lowerContent.includes("price") ||
      lowerContent.includes("cost") || lowerContent.includes("budget") ||
      lowerContent.includes("million") || lowerContent.includes("fee")) {
    return "pricing";
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
  
  // Extract budget/pricing
  const budgetPatterns = [
    /\$(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?/gi,
    /budget\s*(?:of\s*)?\$?(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?/gi,
  ];
  
  for (const pattern of budgetPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        let value = parseFloat(match[1]);
        let unit = "USD";
        if (match[2]?.toLowerCase().startsWith("m")) {
          value *= 1000000;
          unit = "USD (millions)";
        } else if (match[2]?.toLowerCase().startsWith("k")) {
          value *= 1000;
          unit = "USD (thousands)";
        }
        params.push({
          category: "pricing",
          name: "Project Budget",
          value: value.toLocaleString(),
          unit,
          source: "user_input",
          confidence: "medium",
        });
      }
    }
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
    return [];
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: `You are an expert at extracting project parameters from unstructured text for anaerobic digestion and biogas projects. 
          
Extract the following categories of parameters:
- feedstock: type of waste/material (e.g., potato waste, dairy manure, food waste), volume/capacity (tons per year), technical specs (TS%, VS/TS ratio, BOD, COD, C:N ratio)
- location: project location (city, state, county)
- output_requirements: what the project will produce (RNG, biogas, electricity, compost, digestate handling)
- pricing: budget, costs, fees, revenue projections
- constraints: requirements, limitations, equipment specifications, regulatory requirements

For each parameter, provide:
- category: one of "feedstock", "location", "output_requirements", "pricing", "constraints"
- name: descriptive name of the parameter
- value: the extracted value
- unit: unit of measurement if applicable
- confidence: "high" if explicitly stated, "medium" if inferred, "low" if uncertain

Respond with JSON in this format:
{
  "parameters": [
    {"category": "feedstock", "name": "Feedstock Type", "value": "...", "unit": null, "confidence": "high"},
    ...
  ]
}`
        },
        {
          role: "user",
          content: `Extract all project parameters from the following text:\n\n${content}`
        }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2048,
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");
    
    if (!result.parameters || !Array.isArray(result.parameters)) {
      console.log("AI returned invalid format, falling back to pattern matching");
      return extractParametersFromText(entries);
    }

    return result.parameters.map((p: { category: string; name: string; value: string; unit?: string; confidence: string }) => ({
      category: p.category,
      name: p.name,
      value: p.value,
      unit: p.unit || undefined,
      source: "ai_extraction",
      confidence: p.confidence,
    }));
  } catch (error) {
    console.error("AI extraction failed, falling back to pattern matching:", error);
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
      
      const doc = await storage.createDocument({
        scenarioId: req.params.scenarioId,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size.toString(),
        extractedText: null, // Would be populated by OCR service in production
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
      
      // Extract parameters using AI (falls back to pattern matching if AI fails)
      const extractedParams = await extractParametersWithAI(entries);
      
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
      
      // Create or update UPIF
      const existingUpif = await storage.getUpifByScenario(scenarioId);
      
      const feedstockType = extractedParams.find(p => p.name === "Feedstock Type")?.value;
      const volumeParam = extractedParams.find(p => p.name === "Volume/Capacity");
      const location = extractedParams.find(p => p.name === "Project Location")?.value;
      const outputParams = extractedParams.filter(p => p.category === "output_requirements");
      const constraints = extractedParams.filter(p => p.category === "constraints").map(p => p.value);
      
      const upifData = {
        scenarioId,
        feedstockType,
        feedstockVolume: volumeParam?.value,
        feedstockUnit: volumeParam?.unit,
        outputRequirements: outputParams.map(p => `${p.name}: ${p.value}`).join("; "),
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

  app.post("/api/scenarios/:scenarioId/confirm-parameters", async (req: Request, res: Response) => {
    try {
      await storage.confirmAllParameters(req.params.scenarioId);
      const params = await storage.getParametersByScenario(req.params.scenarioId);
      res.json(params);
    } catch (error) {
      console.error("Error confirming parameters:", error);
      res.status(500).json({ error: "Failed to confirm parameters" });
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

  return httpServer;
}
