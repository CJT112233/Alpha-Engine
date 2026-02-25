/**
 * REST API Routes for the Project Alpha application.
 *
 * This file defines all backend endpoints including:
 * - CRUD operations for projects, scenarios, text entries, and documents
 * - AI-powered parameter extraction (GPT-5 / Claude) with pattern-matching fallback
 * - UPIF (Unified Project Intake Form) generation, enrichment, and field-level locking
 * - Reviewer chat: conversational AI that can update UPIF fields while respecting locks
 * - PDF export of the finalized UPIF with tables, watermarks, and AI-generated summaries
 */
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { insertProjectSchema, insertScenarioSchema, insertTextEntrySchema, type FeedstockEntry, type ConfirmedFields, type InsertUpif } from "@shared/schema";
import { z } from "zod";
import { type EnrichedFeedstockSpec } from "@shared/feedstock-library";
import { enrichFeedstockSpecsFromDb, enrichBiogasSpecsFromDb } from "./enrichment-db";
import { syncPromptToDatabricks, syncLibraryProfileToDatabricks, syncValidationConfigToDatabricks } from "./databricks-sync";
import { enrichOutputSpecs, matchOutputType, type EnrichedOutputSpec } from "@shared/output-criteria-library";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import PDFDocument from "pdfkit";
import { feedstockGroupLabels, feedstockGroupOrder } from "@shared/feedstock-library";
import { outputGroupLabels, outputGroupOrder } from "@shared/output-criteria-library";
import { llmComplete, getAvailableProviders, providerLabels, isProviderAvailable, type LLMProvider } from "./llm";
import { DEFAULT_PROMPTS, PROMPT_KEYS, type PromptKey } from "@shared/default-prompts";
import { exportMassBalancePDF, exportMassBalanceExcel, exportCapexPDF, exportCapexExcel, exportOpexPDF, exportOpexExcel, exportProjectSummaryPDF } from "./services/exportService";
import type { MassBalanceResults, CapexResults, OpexResults } from "@shared/schema";
import {
  validateAndSanitizeOutputSpecs,
  validateFeedstocksForTypeA,
  validateFeedstocksForTypeD,
  validateTypeADesignDrivers,
  applyTsTssGuardrail,
  applySwapDetection,
  deduplicateParameters,
  validateSectionAssignment,
  rejectBiosolidsOutputProfile,
  validateBiogasVsRng,
  type ValidationWarning,
  type PerformanceTarget,
} from "./validation";

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/** Multer middleware for file uploads. Stores files in uploads/ with a 50 MB size limit. */
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

/** Formats large numbers with comma separators (e.g. 1000000 → "1,000,000") for display. */
function formatNumericValue(val: string): string {
  if (!val) return val;
  return val.replace(/(?<![.\d])\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?/g, (match) => {
    const num = Number(match.replace(/,/g, ""));
    if (isNaN(num)) return match;
    return num.toLocaleString();
  });
}

/**
 * Replaces Unicode characters (math symbols, subscripts, superscripts, special
 * punctuation) with their ASCII equivalents so PDFKit can render them safely.
 */
function sanitizePdfText(text: string): string {
  if (!text) return text;
  return text
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≪/g, "<<")
    .replace(/≫/g, ">>")
    .replace(/₀/g, "0")
    .replace(/₁/g, "1")
    .replace(/₂/g, "2")
    .replace(/₃/g, "3")
    .replace(/₄/g, "4")
    .replace(/₅/g, "5")
    .replace(/₆/g, "6")
    .replace(/₇/g, "7")
    .replace(/₈/g, "8")
    .replace(/₉/g, "9")
    .replace(/⁰/g, "0")
    .replace(/¹/g, "1")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/⁴/g, "4")
    .replace(/⁵/g, "5")
    .replace(/⁶/g, "6")
    .replace(/⁷/g, "7")
    .replace(/⁸/g, "8")
    .replace(/⁹/g, "9")
    .replace(/−/g, "-")
    .replace(/–/g, "-")
    .replace(/—/g, "-")
    .replace(/′/g, "'")
    .replace(/″/g, "\"")
    .replace(/…/g, "...")
    .replace(/•/g, "*")
    .replace(/·/g, ".")
    .replace(/×/g, "x")
    .replace(/÷/g, "/")
    .replace(/±/g, "+/-")
    .replace(/µ/g, "u")
    .replace(/³/g, "3");
}

/**
 * Converts table-like structures in raw PDF text into structured markdown-style
 * tables. Detects header rows by keyword patterns (e.g. "Parameter", "Units",
 * "Limit") and multi-column spacing, then reformats subsequent data rows into
 * pipe-delimited markdown table format for better downstream AI parsing.
 */
function postProcessPdfText(rawText: string): string {
  const lines = rawText.split("\n");
  const processed: string[] = [];
  let inTable = false;
  let tableHeaders: string[] = [];
  let tablesFound = 0;

  const tableHeaderPatterns = [
    /^(Parameter|Element|Alternative|Item|Component|Pollutant|Constituent|Category|Description|Metric|Variable|Criteria|Criterion)\s+/i,
  ];

  const tableHeaderKeywords = [
    "Units", "Limit", "Current", "Loading", "Low", "High", "Base",
    "CAPEX", "OPEX", "Alt.", "Value", "Result", "Average", "Maximum",
    "Minimum", "Target", "Actual", "Standard", "Concentration", "Flow",
    "Cost", "Price", "Total", "Projected", "Annual",
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (inTable) {
        inTable = false;
        tableHeaders = [];
        processed.push("");
      }
      continue;
    }

    const matchesHeaderPattern = tableHeaderPatterns.some(p => p.test(line));
    const hasKeywords = tableHeaderKeywords.some(kw => line.includes(kw));
    const hasMultipleColumns = line.split(/\s{2,}/).length >= 3;

    if ((matchesHeaderPattern && hasKeywords) || (hasMultipleColumns && hasKeywords && !inTable)) {
      const cells = line.split(/\s{2,}/);
      if (cells.length >= 3) {
        inTable = true;
        tableHeaders = cells;
        tablesFound++;
        processed.push("");
        processed.push("| " + tableHeaders.join(" | ") + " |");
        processed.push("| " + tableHeaders.map(() => "---").join(" | ") + " |");
        continue;
      }
    }

    if (inTable && line && !line.startsWith("Table") && !/^\d+\s+[A-Z]/.test(line)) {
      const cells = line.split(/\s{2,}/);
      if (cells.length >= 2 && cells.length <= tableHeaders.length + 2) {
        processed.push("| " + cells.join(" | ") + " |");
        continue;
      } else {
        inTable = false;
        tableHeaders = [];
      }
    }

    processed.push(line);
  }

  if (tablesFound > 0) {
    console.log(`PDF post-processing: converted ${tablesFound} table(s) to structured format`);
  }

  return processed.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractTextFromImage(filePath: string, mimeType: string, originalName: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn(`Image OCR skipped for "${originalName}": no OpenAI API key configured`);
    return null;
  }

  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60000 });

    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString("base64");
    const mediaMime = mimeType.startsWith("image/") ? mimeType : "image/png";
    const dataUrl = `data:${mediaMime};base64,${base64Image}`;

    console.log(`Image OCR: analyzing "${originalName}" (${(imageBuffer.length / 1024).toFixed(0)} KB) with GPT vision...`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract ALL text visible in this image. Include every piece of text you can see — headings, labels, numbers, table data, annotations, handwriting, and any other readable content. Preserve the structure as much as possible (tables as columns, lists as lists). If there are numbers with units, include both. Output ONLY the extracted text, no commentary.",
            },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" },
            },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (text && text.length > 0) {
      console.log(`Image OCR: extracted ${text.length} chars from "${originalName}"`);
      return text;
    }

    console.log(`Image OCR: no text found in "${originalName}"`);
    return null;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`Image OCR failed for "${originalName}":`, errMsg);
    return null;
  }
}

/**
 * Extracts readable text from an uploaded document for AI analysis.
 * Supports PDF (with table post-processing), DOCX (via mammoth), XLSX/XLS/CSV
 * (via SheetJS), images (via OpenAI vision OCR), and plain text files.
 * Returns null for unsupported formats.
 */
async function extractTextFromFile(filePath: string, mimeType: string, originalName: string): Promise<string | null> {
  try {
    const ext = path.extname(originalName).toLowerCase();

    if (mimeType === "application/pdf" || ext === ".pdf") {
      const { PDFParse } = await import("pdf-parse");
      const dataBuffer = fs.readFileSync(filePath);
      const uint8Data = new Uint8Array(dataBuffer);
      const parser = new PDFParse(uint8Data);
      await (parser as any).load();
      const result = await parser.getText();
      const rawText = result?.text?.trim() || null;
      if (!rawText) return null;
      return postProcessPdfText(rawText);
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

    if (mimeType.startsWith("image/") || [".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp", ".gif"].includes(ext)) {
      return await extractTextFromImage(filePath, mimeType, originalName);
    }

    return null;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`Error extracting text from file "${originalName}" (${mimeType}):`, errMsg);
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    return null;
  }
}

/**
 * Simple keyword-based categorization of free-text input. Maps user text to one
 * of: "feedstock", "output_requirements", "location", or "constraints" based on
 * keyword matches. Returns null if no category is confidently identified.
 */
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

/**
 * Pattern-matching fallback for parameter extraction when AI is unavailable.
 * Uses regex patterns to find feedstock types, volumes, technical parameters
 * (TS, VS/TS, BOD, COD, C:N), locations, output requirements, and constraints.
 * Also predicts common technical parameters for known feedstock types (e.g.
 * potato waste, dairy manure) when user-provided values are missing.
 */
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
  const hasFeedstock = params.some(p => p.category === "feedstock" || p.category === "input");
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

/**
 * Main AI-powered parameter extraction function. Sends combined text entries
 * to the selected LLM (GPT-5 or Claude) with the extraction system prompt.
 *
 * Handles:
 * - Appending clarifying Q&A answers to enrich the input context
 * - Falling back to another available provider if the preferred model is unavailable
 * - Parsing the JSON response with field name normalization (handles Opus-style
 *   "parameter" / "label" fields vs standard "name" field)
 * - Falling back to regex pattern matching (extractParametersFromText) on failure
 */
async function extractParametersWithAI(entries: Array<{ content: string; category: string | null }>, model: LLMProvider = "gpt5", clarifyingQA?: Array<{ question: string; answer: string }>, promptKey?: PromptKey): Promise<ExtractedParam[]> {
  let content = entries.map(e => e.content).join("\n\n");

  if (clarifyingQA && clarifyingQA.length > 0) {
    const qaSection = clarifyingQA
      .filter(qa => qa.answer && qa.answer.trim())
      .map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`)
      .join("\n\n");
    if (qaSection) {
      content += `\n\n--- ADDITIONAL CLARIFYING INFORMATION ---\nThe following answers were provided to clarifying questions about this project:\n\n${qaSection}`;
    }
  }
  
  if (!content.trim()) {
    console.log("AI extraction: No content to extract from");
    return [];
  }

  if (!isProviderAvailable(model)) {
    const fallback = getAvailableProviders()[0];
    if (!fallback) {
      console.log("AI extraction: No LLM provider available, using pattern matching");
      return extractParametersFromText(entries);
    }
    console.log(`AI extraction: ${model} not available, falling back to ${fallback}`);
    model = fallback;
  }

  console.log(`AI extraction: Starting extraction with ${providerLabels[model]} for content length:`, content.length);

  const effectivePromptKey = promptKey || "extraction";
  console.log(`AI extraction: Using prompt key: ${effectivePromptKey}`);
  const systemPrompt = await getPromptTemplate(effectivePromptKey);

  try {
    const response = await llmComplete({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Carefully analyze the following project description and extract ALL parameters. Be thorough - capture every detail mentioned or clearly implied:\n\n${content}` },
      ],
      maxTokens: 16384,
      jsonMode: true,
    });

    const rawResponse = response.content || "{}";
    console.log(`AI extraction: Received response from ${providerLabels[model]}, length:`, rawResponse.length);
    console.log("AI extraction: Token usage - prompt:", response.promptTokens, "completion:", response.completionTokens);
    
    const result = JSON.parse(rawResponse);
    
    if (!result.parameters || !Array.isArray(result.parameters)) {
      console.log("AI returned invalid format, falling back to pattern matching. Raw response:", rawResponse.substring(0, 500));
      return extractParametersFromText(entries);
    }

    console.log("AI extraction: Successfully extracted", result.parameters.length, "parameters");
    if (result.parameters.length > 0) {
      console.log("AI extraction: First parameter keys:", Object.keys(result.parameters[0]));
      console.log("AI extraction: First parameter sample:", JSON.stringify(result.parameters[0]));
    }
    console.log("AI extraction: Categories breakdown:", 
      result.parameters.reduce((acc: Record<string, number>, p: { category: string }) => {
        acc[p.category] = (acc[p.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    );

    return result.parameters
      .map((p: any) => ({
        category: p.category,
        name: p.name || p.parameter_name || p.parameter || p.label || p.field,
        value: String(p.value ?? ""),
        unit: p.unit || p.units || undefined,
        source: "ai_extraction",
        confidence: p.confidence || "medium",
      }))
      .filter((p: any) => p.name && p.category && p.value !== undefined);
  } catch (error) {
    console.error("AI extraction failed, falling back to pattern matching. Error:", error);
    return extractParametersFromText(entries);
  }
}

/** Retrieves a prompt template from the DB (user customization) or falls back to built-in defaults. */
async function getPromptTemplate(key: PromptKey): Promise<string> {
  const dbTemplate = await storage.getPromptTemplateByKey(key);
  if (dbTemplate) return dbTemplate.template;
  return DEFAULT_PROMPTS[key].template;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Create uploads directory if it doesn't exist
  if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads", { recursive: true });
  }

  // =========================================================================
  // LLM Providers & Prompt Management Routes
  // =========================================================================

  app.get("/api/llm-providers", (_req: Request, res: Response) => {
    const available = getAvailableProviders();
    res.json({
      providers: available.map(p => ({ id: p, label: providerLabels[p] })),
      default: available[0] || "gpt5",
    });
  });

  app.get("/api/prompts", async (_req: Request, res: Response) => {
    try {
      const dbTemplates = await storage.getAllPromptTemplates();
      const dbMap = new Map(dbTemplates.map(t => [t.key, t]));

      const result = PROMPT_KEYS.map(key => {
        const defaults = DEFAULT_PROMPTS[key];
        const dbEntry = dbMap.get(key);
        return {
          key: defaults.key,
          name: dbEntry?.name || defaults.name,
          description: dbEntry?.description || defaults.description,
          template: dbEntry?.template || defaults.template,
          isSystemPrompt: defaults.isSystemPrompt,
          availableVariables: defaults.availableVariables,
          isCustomized: !!dbEntry,
          updatedAt: dbEntry?.updatedAt || null,
        };
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/prompts/:key", async (req: Request, res: Response) => {
    try {
      const key = (req.params.key as string) as PromptKey;
      if (!PROMPT_KEYS.includes(key)) {
        return res.status(404).json({ error: "Unknown prompt key" });
      }
      const defaults = DEFAULT_PROMPTS[key];
      const dbEntry = await storage.getPromptTemplateByKey(key);
      res.json({
        key: defaults.key,
        name: dbEntry?.name || defaults.name,
        description: dbEntry?.description || defaults.description,
        template: dbEntry?.template || defaults.template,
        defaultTemplate: defaults.template,
        isSystemPrompt: defaults.isSystemPrompt,
        availableVariables: defaults.availableVariables,
        isCustomized: !!dbEntry,
        updatedAt: dbEntry?.updatedAt || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/prompts/:key", async (req: Request, res: Response) => {
    try {
      const key = (req.params.key as string) as PromptKey;
      if (!PROMPT_KEYS.includes(key)) {
        return res.status(404).json({ error: "Unknown prompt key" });
      }
      const { template } = req.body;
      if (!template || typeof template !== "string" || template.trim().length === 0) {
        return res.status(400).json({ error: "Template text is required" });
      }
      const defaults = DEFAULT_PROMPTS[key];
      const saved = await storage.upsertPromptTemplate({
        key,
        name: defaults.name,
        description: defaults.description,
        template: template.trim(),
        isSystemPrompt: defaults.isSystemPrompt,
      });
      syncPromptToDatabricks(key, template.trim()).catch(err =>
        console.error("[Databricks Sync] Background prompt sync failed:", err)
      );
      res.json({
        ...saved,
        availableVariables: defaults.availableVariables,
        isCustomized: true,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/prompts/:key/reset", async (req: Request, res: Response) => {
    try {
      const key = (req.params.key as string) as PromptKey;
      if (!PROMPT_KEYS.includes(key)) {
        return res.status(404).json({ error: "Unknown prompt key" });
      }
      await storage.deletePromptTemplate(key);
      const defaults = DEFAULT_PROMPTS[key];
      res.json({
        key: defaults.key,
        name: defaults.name,
        description: defaults.description,
        template: defaults.template,
        isSystemPrompt: defaults.isSystemPrompt,
        availableVariables: defaults.availableVariables,
        isCustomized: false,
        updatedAt: null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/scenarios/:id/preferred-model", async (req: Request, res: Response) => {
    try {
      const { model } = req.body;
      if (!model || !["gpt5", "claude", "claude-opus"].includes(model)) {
        return res.status(400).json({ error: "Invalid model. Must be 'gpt5', 'claude', or 'claude-opus'." });
      }
      const scenario = await storage.getScenario((req.params.id as string));
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }
      const updated = await storage.updateScenarioModel((req.params.id as string), model);
      res.json(updated);
    } catch (error) {
      console.error("Error updating preferred model:", error);
      res.status(500).json({ error: "Failed to update preferred model" });
    }
  });

  app.patch("/api/scenarios/:id/project-type", async (req: Request, res: Response) => {
    try {
      const { projectType, confirmed } = req.body;
      if (!projectType || !["A", "B", "C", "D"].includes(projectType)) {
        return res.status(400).json({ error: "Invalid project type. Must be 'A', 'B', 'C', or 'D'." });
      }
      const scenario = await storage.getScenario((req.params.id as string));
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }
      const updated = await storage.updateScenarioProjectType((req.params.id as string), projectType, confirmed !== false);
      res.json(updated);
    } catch (error) {
      console.error("Error updating project type:", error);
      res.status(500).json({ error: "Failed to update project type" });
    }
  });

  // =========================================================================
  // Dashboard Stats
  // =========================================================================

  app.get("/api/dashboard/stats", async (_req: Request, res: Response) => {
    try {
      const allScenarios = await storage.getRecentScenarios();
      const confirmedMassBalanceCount = await (async () => {
        const { db } = await import("./storage");
        const { massBalanceRuns } = await import("@shared/schema");
        const { eq, sql } = await import("drizzle-orm");
        const result = await db.select({ count: sql<number>`count(*)` })
          .from(massBalanceRuns)
          .where(eq(massBalanceRuns.status, "finalized"));
        return Number(result[0]?.count ?? 0);
      })();
      res.json({
        confirmedMassBalances: confirmedMassBalanceCount,
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // =========================================================================
  // Library Profiles CRUD
  // =========================================================================

  app.get("/api/library-profiles/:type", async (req: Request, res: Response) => {
    try {
      const profiles = await storage.getLibraryProfilesByType(req.params.type as string);
      res.json(profiles);
    } catch (error) {
      console.error("Error fetching library profiles:", error);
      res.status(500).json({ error: "Failed to fetch library profiles" });
    }
  });

  app.get("/api/library-profiles/:type/:id", async (req: Request, res: Response) => {
    try {
      const profile = await storage.getLibraryProfile(req.params.id as string);
      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }
      res.json(profile);
    } catch (error) {
      console.error("Error fetching library profile:", error);
      res.status(500).json({ error: "Failed to fetch library profile" });
    }
  });

  app.patch("/api/library-profiles/:type/:id", async (req: Request, res: Response) => {
    try {
      const { name, aliases, category, properties } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (aliases !== undefined) updates.aliases = aliases;
      if (category !== undefined) updates.category = category;
      if (properties !== undefined) updates.properties = properties;

      const updated = await storage.updateLibraryProfile(req.params.id as string, updates);
      if (!updated) {
        return res.status(404).json({ error: "Profile not found" });
      }
      syncLibraryProfileToDatabricks({
        libraryType: updated.libraryType,
        name: updated.name,
        aliases: updated.aliases || [],
        category: updated.category || "",
        properties: updated.properties,
        sortOrder: updated.sortOrder || 0,
        isCustomized: updated.isCustomized || false,
      }).catch(err =>
        console.error("[Databricks Sync] Background library profile sync failed:", err)
      );
      res.json(updated);
    } catch (error) {
      console.error("Error updating library profile:", error);
      res.status(500).json({ error: "Failed to update library profile" });
    }
  });

  app.post("/api/library-profiles/:type", async (req: Request, res: Response) => {
    try {
      const { name, aliases, category, properties, sortOrder } = req.body;
      const profile = await storage.createLibraryProfile({
        libraryType: req.params.type as string,
        name,
        aliases: aliases || [],
        category,
        properties,
        sortOrder: sortOrder || 0,
        isCustomized: true,
      });
      syncLibraryProfileToDatabricks({
        libraryType: profile.libraryType,
        name: profile.name,
        aliases: profile.aliases || [],
        category: profile.category || "",
        properties: profile.properties,
        sortOrder: profile.sortOrder || 0,
        isCustomized: true,
      }).catch(err =>
        console.error("[Databricks Sync] Background new library profile sync failed:", err)
      );
      res.status(201).json(profile);
    } catch (error) {
      console.error("Error creating library profile:", error);
      res.status(500).json({ error: "Failed to create library profile" });
    }
  });

  app.delete("/api/library-profiles/:type/:id", async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteLibraryProfile(req.params.id as string);
      if (!deleted) {
        return res.status(404).json({ error: "Profile not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting library profile:", error);
      res.status(500).json({ error: "Failed to delete library profile" });
    }
  });

  // =========================================================================
  // Validation Config CRUD
  // =========================================================================

  app.get("/api/validation-config", async (_req: Request, res: Response) => {
    try {
      const configs = await storage.getAllValidationConfig();
      res.json(configs);
    } catch (error) {
      console.error("Error fetching validation config:", error);
      res.status(500).json({ error: "Failed to fetch validation config" });
    }
  });

  app.get("/api/validation-config/:key", async (req: Request, res: Response) => {
    try {
      const config = await storage.getValidationConfig(req.params.key as string);
      if (!config) {
        return res.status(404).json({ error: "Config not found" });
      }
      res.json(config);
    } catch (error) {
      console.error("Error fetching validation config:", error);
      res.status(500).json({ error: "Failed to fetch validation config" });
    }
  });

  app.patch("/api/validation-config/:key", async (req: Request, res: Response) => {
    try {
      const { configValue, description, category } = req.body;
      const existing = await storage.getValidationConfig(req.params.key as string);
      if (!existing) {
        return res.status(404).json({ error: "Config not found" });
      }
      const updated = await storage.upsertValidationConfig({
        configKey: req.params.key as string,
        configValue: configValue !== undefined ? configValue : existing.configValue,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
      });
      const { invalidateValidationConfigCache } = await import("./validation-config-loader");
      invalidateValidationConfigCache();
      syncValidationConfigToDatabricks({
        configKey: updated.configKey,
        configValue: updated.configValue,
        description: updated.description || "",
        category: updated.category || "",
      }).catch(err =>
        console.error("[Databricks Sync] Background validation config sync failed:", err)
      );
      res.json(updated);
    } catch (error) {
      console.error("Error updating validation config:", error);
      res.status(500).json({ error: "Failed to update validation config" });
    }
  });

  // =========================================================================
  // Projects CRUD
  // =========================================================================

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
      const project = await storage.getProject((req.params.id as string));
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
      await storage.deleteProject((req.params.id as string));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting project:", error);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // =========================================================================
  // Scenarios CRUD
  // =========================================================================

  app.get("/api/projects/:projectId/scenarios", async (req: Request, res: Response) => {
    try {
      const scenarios = await storage.getScenariosByProject((req.params.projectId as string));
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
      const scenario = await storage.getScenario((req.params.id as string));
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
        projectId: (req.params.projectId as string),
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
      await storage.deleteScenario((req.params.id as string));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting scenario:", error);
      res.status(500).json({ error: "Failed to delete scenario" });
    }
  });

  // =========================================================================
  // Text Entries CRUD
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/text-entries", async (req: Request, res: Response) => {
    try {
      const entries = await storage.getTextEntriesByScenario((req.params.scenarioId as string));
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
        scenarioId: (req.params.scenarioId as string),
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

  app.patch("/api/text-entries/:id", async (req: Request, res: Response) => {
    try {
      const { content } = req.body;
      if (!content || typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ error: "Content is required" });
      }
      const updated = await storage.updateTextEntry(req.params.id as string, content.trim());
      if (!updated) {
        return res.status(404).json({ error: "Text entry not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating text entry:", error);
      res.status(500).json({ error: "Failed to update text entry" });
    }
  });

  app.delete("/api/text-entries/:id", async (req: Request, res: Response) => {
    try {
      await storage.deleteTextEntry((req.params.id as string));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting text entry:", error);
      res.status(500).json({ error: "Failed to delete text entry" });
    }
  });

  // =========================================================================
  // Documents Upload & CRUD
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/documents", async (req: Request, res: Response) => {
    try {
      const docs = await storage.getDocumentsByScenario((req.params.scenarioId as string));
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
        scenarioId: (req.params.scenarioId as string),
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
      await storage.deleteDocument((req.params.id as string));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  // =========================================================================
  // Parameters & Clarifying Questions
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/parameters", async (req: Request, res: Response) => {
    try {
      const params = await storage.getParametersByScenario((req.params.scenarioId as string));
      res.json(params);
    } catch (error) {
      console.error("Error fetching parameters:", error);
      res.status(500).json({ error: "Failed to fetch parameters" });
    }
  });

  app.post("/api/scenarios/:scenarioId/clarify", async (req: Request, res: Response) => {
    try {
      const scenarioId = (req.params.scenarioId as string);
      console.log(`Clarify: Starting for scenario ${scenarioId}`);

      const entries = await storage.getTextEntriesByScenario(scenarioId);
      const documents = await storage.getDocumentsByScenario(scenarioId);
      const docEntries = documents
        .filter(doc => doc.extractedText && doc.extractedText.trim())
        .map(doc => ({
          content: `[From document: ${doc.originalName}]\n${doc.extractedText}`,
          category: null as string | null,
        }));

      const allEntries = [...entries, ...docEntries];
      const content = allEntries.map(e => e.content).join("\n\n");
      console.log(`Clarify: ${entries.length} text entries, ${docEntries.length} doc entries, content length: ${content.length}`);

      if (!content.trim()) {
        return res.status(400).json({ error: "No input content to analyze. Add text or upload documents first." });
      }

      const scenario = await storage.getScenario(scenarioId);
      const model = (scenario?.preferredModel as LLMProvider) || "gpt5";
      console.log(`Clarify: Using model ${model}`);

      if (getAvailableProviders().length === 0) {
        console.log("Clarify: No AI providers available");
        return res.status(500).json({ error: "No AI provider is configured." });
      }

      const systemPrompt = await getPromptTemplate("clarify");

      const response = await llmComplete({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Here is the project information submitted so far:\n\n${content}` },
        ],
        maxTokens: 2048,
        jsonMode: true,
      });

      const rawResponse = response.content || "{}";
      console.log(`Clarify: Received response, length: ${rawResponse.length}, provider: ${response.provider}`);
      let parsed: { questions?: Array<{ question: string }> };
      try {
        parsed = JSON.parse(rawResponse);
      } catch (parseErr) {
        console.error("Clarify: Failed to parse JSON response, using defaults. Raw:", rawResponse.substring(0, 300));
        parsed = { questions: [
          { question: "What are the specific feedstock types and their expected daily/annual volumes?" },
          { question: "What is the intended use for the biogas produced (e.g., RNG pipeline injection, electricity generation, flaring)?" },
          { question: "How will the liquid effluent from the digester be managed (e.g., discharge to municipal WWTP, land application, on-site treatment)?" },
        ]};
      }

      const questions = parsed.questions || [];
      console.log(`Clarify: Generated ${questions.length} questions`);
      await storage.updateScenarioClarification(scenarioId, questions, null);

      res.json({ questions, provider: response.provider });
    } catch (error: any) {
      console.error("Error generating clarifying questions:", error?.message || error);
      res.status(500).json({ error: `Failed to generate clarifying questions: ${error?.message || "Unknown error"}` });
    }
  });

  app.post("/api/scenarios/:scenarioId/clarify-answers", async (req: Request, res: Response) => {
    try {
      const scenarioId = (req.params.scenarioId as string);
      const { answers } = req.body;

      if (!answers || !Array.isArray(answers)) {
        return res.status(400).json({ error: "Answers array is required" });
      }

      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      await storage.updateScenarioClarification(
        scenarioId,
        scenario.clarifyingQuestions,
        answers
      );

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving clarifying answers:", error?.message || error);
      res.status(500).json({ error: "Failed to save answers" });
    }
  });

  // =========================================================================
  // Extract & UPIF Generation — THE CORE ENDPOINT
  //
  // This is the most important route. It orchestrates the full extraction and
  // UPIF assembly pipeline:
  //  1. Gathers all text entries + extracted document text for the scenario
  //  2. Calls AI extraction (extractParametersWithAI) using the scenario's
  //     preferred model, including any clarifying Q&A answers
  //  3. Groups feedstock parameters by numbered prefix (Feedstock 1, 2, …)
  //  4. Maps technical parameter names to standardized keys (TS, VS/TS, etc.)
  //  5. Enriches feedstock specs from the knowledge base library
  //  6. Collects location, output requirements, and constraints
  //  7. Enriches output acceptance criteria (RNG pipeline, digestate, effluent)
  //     using keyword detection against input text
  //  8. Merges with existing UPIF, preserving confirmed/locked fields
  //  9. Creates or updates the UPIF record and advances scenario to "in_review"
  // =========================================================================

  app.post("/api/scenarios/:scenarioId/extract", async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      const scenarioId = (req.params.scenarioId as string);
      
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
      
      const extractScenario = await storage.getScenario(scenarioId);
      const extractModel = (extractScenario?.preferredModel as LLMProvider) || "gpt5";
      const clarifyingAnswers = (extractScenario?.clarifyingAnswers as Array<{ question: string; answer: string }>) || undefined;

      const typePromptMap: Record<string, PromptKey> = {
        A: "extraction_type_a",
        B: "extraction_type_b",
        C: "extraction_type_c",
        D: "extraction_type_d",
      };
      const projectType = extractScenario?.projectType as string | null;
      const extractionPromptKey = (projectType && extractScenario?.projectTypeConfirmed && typePromptMap[projectType]) || "extraction";
      console.log(`Extraction: projectType=${projectType}, confirmed=${extractScenario?.projectTypeConfirmed}, using prompt: ${extractionPromptKey}`);

      const rawExtractedParams = await extractParametersWithAI(allEntries, extractModel, clarifyingAnswers, extractionPromptKey);
      
      const basicValid = rawExtractedParams.filter(p => p.name && p.category);
      if (basicValid.length < rawExtractedParams.length) {
        console.log(`AI extraction: Filtered out ${rawExtractedParams.length - basicValid.length} parameters with missing name/category`);
      }
      
      const deduped = deduplicateParameters(basicValid);
      if (deduped.length < basicValid.length) {
        console.log(`Validation: Deduplicated ${basicValid.length - deduped.length} duplicate parameters`);
      }
      
      const { valid: sectionValid, unmapped: sectionUnmapped, warnings: sectionWarnings } = validateSectionAssignment(deduped);
      if (sectionUnmapped.length > 0) {
        console.log(`Validation: ${sectionUnmapped.length} parameters moved to unmapped due to section mismatch`);
      }
      
      const extractedParams = sectionValid;
      const allValidationWarnings: ValidationWarning[] = [...sectionWarnings];
      const allUnmappedParams = sectionUnmapped;
      
      await storage.deleteParametersByScenario(scenarioId);
      
      for (const param of extractedParams) {
        await storage.createParameter({
          scenarioId,
          ...param,
          source: (param as any).source || "document",
          isConfirmed: false,
        });
      }
      
      // Create or update UPIF with deterministic parameter mapping
      const existingUpif = await storage.getUpifByScenario(scenarioId);
      
      // Step 1: Group feedstock/input parameters by feedstock identity (numbered prefix or legacy names)
      // Accept both "feedstock" and "input" categories to support custom prompts that use "input" for influents/feedstocks
      const feedstockParams = extractedParams.filter(p => p.category === "feedstock" || p.category === "input");
      
      const classifyFeedstockParam = (name: string): { index: number; cleanName: string } => {
        const numbered = name.match(/^(?:Feedstock|Influent)\s+(\d+)\s+(.+)$/i);
        if (numbered) return { index: parseInt(numbered[1]), cleanName: numbered[2].trim() };
        const lower = name.toLowerCase();
        if (lower.includes("primary") || lower.includes("feedstock type") || lower.includes("influent type")) return { index: 1, cleanName: name.replace(/primary\s*/i, "").replace(/(?:feedstock|influent)\s*/i, "").trim() || "Type" };
        if (lower.includes("secondary")) return { index: 2, cleanName: name.replace(/secondary\s*/i, "").replace(/(?:feedstock|influent)\s*/i, "").trim() || "Type" };
        if (lower.includes("tertiary")) return { index: 3, cleanName: name.replace(/tertiary\s*/i, "").replace(/(?:feedstock|influent)\s*/i, "").trim() || "Type" };
        if (lower.includes("number of") || lower.includes("feedstock source") || lower.includes("influent source")) return { index: 0, cleanName: name };
        return { index: 1, cleanName: name };
      }
      
      const feedstockGroups: Map<number, Array<{ cleanName: string; value: string; unit?: string; extractionSource?: string }>> = new Map();
      for (const param of feedstockParams) {
        const { index, cleanName } = classifyFeedstockParam(param.name);
        if (index === 0) continue;
        if (!feedstockGroups.has(index)) feedstockGroups.set(index, []);
        feedstockGroups.get(index)!.push({ cleanName, value: param.value || "", unit: param.unit || undefined, extractionSource: (param as any).source });
      }
      
      const mapTechnicalParamName = (rawName: string, isTypeC: boolean = false): string | null => {
        const n = rawName.toLowerCase().trim();
        
        if (isTypeC) {
          if (n === "ch4" || n.includes("methane") || n.includes("ch₄")) return "CH4";
          if (n === "co2" || n.includes("carbon dioxide") || n.includes("co₂")) return "CO2";
          if (n === "h2s" || n.includes("hydrogen sulfide") || n.includes("h₂s")) return "H2S";
          if (n === "siloxanes" || n.includes("siloxane")) return "Siloxanes";
          if (n === "o2" || n.includes("oxygen") || n.includes("o₂")) return "O2";
          if (n === "n2" || (n === "nitrogen" && !n.includes("c:n"))) return "N2";
          if (n.includes("moisture") || n.includes("water content")) return "Moisture";
          if (n.includes("current disposition") || n.includes("disposition")) return "Current Disposition";
          if (n.includes("variability") || n.includes("flow variability") || n.includes("seasonal")) return "Variability";
          if (n.includes("heating value") || n.includes("btu") || n.includes("hhv") || n.includes("lhv")) return "Heating Value";
          return null;
        }
        
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
        if (n === "bod" || n.startsWith("bod ") || n.startsWith("bod5") || n.includes("biochemical oxygen demand")) return "BOD";
        if (n === "cod" || n.startsWith("cod ") || n.includes("chemical oxygen demand")) return "COD";
        if (n === "tss" || n.startsWith("tss ") || n.includes("total suspended solids")) return "TSS";
        if (n === "tds" || n.startsWith("tds ") || n.includes("total dissolved solids")) return "TDS";
        if (n === "ph" || n.startsWith("ph ") || n === "ph level" || n.includes("ph range") || n.includes("ph (")) return "pH";
        if (n === "fog" || n.startsWith("fog ") || n.includes("fog (") || n.includes("fats") || (n.includes("oil") && n.includes("grease")) || n.includes("o&g")) return "FOG";
        if (n === "temperature" || n.includes("temp")) return "Temperature";
        if ((n === "n" || n === "nitrogen" || n.includes("total nitrogen") || n === "tkn" || n.startsWith("tkn ") || n.includes("total kjeldahl")) && !n.includes("c:n") && !n.includes("c/n")) return "Nitrogen";
        if (n === "p" || n === "phosphorus" || n.includes("total phosphorus")) return "Phosphorus";
        return null;
      }
      
      const feedstockEntries: FeedstockEntry[] = [];
      const sortedKeys = Array.from(feedstockGroups.keys()).sort((a, b) => a - b);
      const isTypeC = projectType === "C";
      
      for (const idx of sortedKeys) {
        const group = feedstockGroups.get(idx)!;
        const typeParam = group.find(p => {
          const l = p.cleanName.toLowerCase();
          return l === "type" || l.includes("type") || l === "feedstock" || l === "";
        });
        const volumeParam = group.find(p => {
          const l = p.cleanName.toLowerCase();
          return l.includes("volume") || l.includes("quantity") || l.includes("capacity") || l.includes("flow rate") || l.includes("flow");
        });
        
        const feedstockType = typeParam?.value || (isTypeC ? `Biogas Source ${idx}` : `Unknown Feedstock ${idx}`);
        const userParams: Record<string, { value: string; unit?: string; extractionSource?: string }> = {};
        const rawParams: Record<string, { value: string; unit: string }> = {};
        
        for (const p of group) {
          if (p === typeParam || p === volumeParam) continue;
          const mapped = mapTechnicalParamName(p.cleanName, isTypeC);
          if (mapped) {
            userParams[mapped] = { value: p.value, unit: p.unit, extractionSource: p.extractionSource };
          }
          rawParams[p.cleanName] = { value: p.value, unit: p.unit || "" };
        }

        if (volumeParam && volumeParam.value) {
          const volNameLower = volumeParam.cleanName.toLowerCase();
          const flowKey = volNameLower.includes("peak") ? "Peak Flow" : "Average Flow";
          userParams[flowKey] = { value: volumeParam.value, unit: volumeParam.unit, extractionSource: volumeParam.extractionSource };
        }
        
        if (isTypeC) {
          const specs = await enrichBiogasSpecsFromDb(feedstockType, userParams);
          console.log(`Enrichment (Type C biogas): Feedstock ${idx} "${feedstockType}" - ${Object.keys(specs).length} specs`);
          
          feedstockEntries.push({
            feedstockType,
            feedstockVolume: volumeParam?.value,
            feedstockUnit: volumeParam?.unit || "SCFM",
            feedstockParameters: Object.keys(rawParams).length > 0 ? rawParams : undefined,
            feedstockSpecs: Object.keys(specs).length > 0 ? specs : undefined,
          });
        } else {
          const specs = await enrichFeedstockSpecsFromDb(feedstockType, userParams, projectType);
          console.log(`Enrichment: Feedstock ${idx} "${feedstockType}" - ${Object.keys(specs).length} specs`);
          
          feedstockEntries.push({
            feedstockType,
            feedstockVolume: volumeParam?.value,
            feedstockUnit: volumeParam?.unit,
            feedstockParameters: Object.keys(rawParams).length > 0 ? rawParams : undefined,
            feedstockSpecs: Object.keys(specs).length > 0 ? specs : undefined,
          });
        }
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
      const outputParams = extractedParams.filter(p => p.category === "output_requirements" || p.category === "output requirements");
      
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
      
      const blockedDigestateProfile = "Solid Digestate - Land Application";
      for (const param of outputParams) {
        const outputDesc = `${param.name} ${param.value}`.toLowerCase();
        const matched = matchOutputType(outputDesc);
        if (matched && !outputSpecs[matched.name]) {
          if (matched.name === blockedDigestateProfile) {
            console.log("Output enrichment: Blocking Solid Digestate profile from matchOutputType — biosolids output not supported");
            continue;
          }
          const enriched = enrichOutputSpecs(matched.name, userOutputCriteria, location || undefined);
          outputSpecs[matched.name] = enriched;
          console.log("Output enrichment: Generated", Object.keys(enriched).length, "criteria for", matched.name);
        }
      }
      
      const allOutputText = outputParams.map(p => `${p.name} ${p.value}`).join(" ").toLowerCase();
      const allInputText = allEntries.map(e => e.content).join(" ").toLowerCase();
      const searchText = `${allOutputText} ${allInputText}`;
      
      const isTypeA = projectType === "A";
      
      const rngKeywords = ["rng", "pipeline", "biomethane", "renewable natural gas", "upgraded biogas", "pipeline injection"];
      const digestateKeywords = ["digestate", "land application", "biosolids", "compost", "soil amendment", "land apply"];
      const effluentKeywords = isTypeA
        ? ["effluent", "discharge to sewer", "indirect discharge", "potw", "pretreatment", "liquid effluent", "centrate", "filtrate"]
        : ["effluent", "wwtp", "discharge", "sewer", "wastewater", "liquid effluent", "centrate", "filtrate", "liquid digestate", "treatment plant"];
      
      const rngProfile = "Renewable Natural Gas (RNG) - Pipeline Injection";
      const digestateProfile = "Solid Digestate - Land Application";
      const effluentProfile = "Liquid Effluent - Discharge to WWTP";
      
      if (!outputSpecs[rngProfile] && rngKeywords.some(k => searchText.includes(k))) {
        const enriched = enrichOutputSpecs(rngProfile, userOutputCriteria, location || undefined);
        outputSpecs[rngProfile] = enriched;
        console.log("Output enrichment (keyword fallback): Generated", Object.keys(enriched).length, "criteria for", rngProfile);
      }
      
      if (!outputSpecs[digestateProfile] && digestateKeywords.some(k => searchText.includes(k))) {
        console.log("Output enrichment: Skipping Solid Digestate / Land Application profile — biosolids output not supported (guardrail V0)");
      }
      
      if (!outputSpecs[effluentProfile] && effluentKeywords.some(k => searchText.includes(k))) {
        const enriched = enrichOutputSpecs(effluentProfile, userOutputCriteria, location || undefined);
        outputSpecs[effluentProfile] = enriched;
        console.log("Output enrichment (keyword fallback): Generated", Object.keys(enriched).length, "criteria for", effluentProfile);
      }

      if (isTypeA && !outputSpecs[effluentProfile]) {
        const enriched = enrichOutputSpecs(effluentProfile, userOutputCriteria, location || undefined);
        outputSpecs[effluentProfile] = enriched;
        console.log("Output enrichment (Type A guarantee): Auto-added effluent profile with", Object.keys(enriched).length, "criteria");
      }

      if (isTypeA && outputSpecs[effluentProfile]) {
        const effluentSpecs = outputSpecs[effluentProfile];
        const requiredEffluentKeys: Array<{
          key: string;
          displayName: string;
          value: string;
          unit: string;
          provenance: string;
          sortOrder: number;
        }> = [
          { key: "bod", displayName: "BOD (Biochemical Oxygen Demand)", value: "\u2264 250-500", unit: "mg/L", provenance: "Typical municipal industrial pretreatment limit; varies by WWTP", sortOrder: 2 },
          { key: "cod", displayName: "COD (Chemical Oxygen Demand)", value: "\u2264 500-1000", unit: "mg/L", provenance: "Often 2x BOD limit; check local pretreatment ordinance", sortOrder: 3 },
          { key: "tss", displayName: "TSS (Total Suspended Solids)", value: "\u2264 250-400", unit: "mg/L", provenance: "Typical municipal sewer discharge limit", sortOrder: 4 },
          { key: "fog", displayName: "FOG (Fats, Oils, Grease)", value: "\u2264 100-150", unit: "mg/L", provenance: "Standard grease trap limit; FOG is primary surcharge trigger", sortOrder: 5 },
          { key: "ph", displayName: "pH", value: "6.0-9.0", unit: "", provenance: "Standard municipal sewer pH range", sortOrder: 20 },
        ];

        let addedCount = 0;
        for (const req of requiredEffluentKeys) {
          if (!effluentSpecs[req.key]) {
            effluentSpecs[req.key] = {
              value: req.value,
              unit: req.unit,
              confidence: "medium" as const,
              provenance: req.provenance,
              group: "discharge",
              displayName: req.displayName,
              sortOrder: req.sortOrder,
              source: "estimated_requirement",
            };
            addedCount++;
          }
        }
        if (addedCount > 0) {
          console.log(`Output enrichment (Type A guarantee): Added ${addedCount} missing required effluent parameter(s) — BOD, COD, TSS, FOG, pH`);
        }
      }
      
      console.log("Output enrichment: Total output profiles enriched:", Object.keys(outputSpecs).length);
      
      // ===== VALIDATION PIPELINE =====
      
      // V0: Universal biosolids rejection — strip Solid Digestate profile from ALL project types
      const {
        sanitized: noBiosolidsSpecs,
        unmapped: biosolidsUnmapped,
        warnings: biosolidsWarnings,
      } = rejectBiosolidsOutputProfile(outputSpecs);
      allValidationWarnings.push(...biosolidsWarnings);
      if (Object.keys(biosolidsUnmapped).length > 0) {
        console.log(`Validation: Biosolids profile rejected — ${Object.keys(biosolidsUnmapped).length} specs moved to unmapped`);
      }
      
      // V1: Validate & sanitize output specs (gas/liquid/solids section checks, removal efficiency separation, unit locking)
      const {
        sanitized: v1Sanitized,
        unmapped: unmappedOutputSpecs,
        performanceTargets,
        warnings: outputWarnings,
      } = validateAndSanitizeOutputSpecs(noBiosolidsSpecs, projectType, extractedParams);
      allValidationWarnings.push(...outputWarnings);
      
      if (Object.keys(unmappedOutputSpecs).length > 0) {
        console.log(`Validation: ${Object.keys(unmappedOutputSpecs).length} output specs moved to unmapped`);
      }
      if (performanceTargets.length > 0) {
        console.log(`Validation: ${performanceTargets.length} removal efficiencies separated to performance targets`);
      }
      
      // V1b: Biogas vs RNG separation — reject biogas methane (<90%) from RNG table
      const {
        sanitized: sanitizedOutputSpecs,
        unmapped: biogasUnmapped,
        warnings: biogasWarnings,
      } = validateBiogasVsRng(v1Sanitized);
      allValidationWarnings.push(...biogasWarnings);
      
      // V2: Type A feedstock validation (wastewater detection gate, sludge hard block, fail-fast)
      const {
        feedstocks: typeAValidatedFeedstocks,
        warnings: typeAWarnings,
        missingRequired,
      } = validateFeedstocksForTypeA(feedstockEntries, extractedParams, projectType);
      allValidationWarnings.push(...typeAWarnings);
      
      // V2b: Type D stream separation + completeness checks
      const {
        feedstocks: typeDValidatedFeedstocks,
        warnings: typeDWarnings,
        missingRequired: typeDMissing,
      } = validateFeedstocksForTypeD(
        projectType === "A" ? typeAValidatedFeedstocks : feedstockEntries,
        extractedParams,
        projectType,
      );
      allValidationWarnings.push(...typeDWarnings);
      
      const postTypeValidated = projectType === "D" ? typeDValidatedFeedstocks
        : projectType === "A" ? typeAValidatedFeedstocks
        : feedstockEntries;
      
      // V2c: Type A core design driver completeness check + auto-populate missing drivers
      const { warnings: designDriverWarnings, feedstocks: designDriverFeedstocks } = await validateTypeADesignDrivers(
        postTypeValidated, extractedParams, projectType
      );
      allValidationWarnings.push(...designDriverWarnings);
      const postDesignDriverValidated = (projectType === "A" || projectType === "D") ? designDriverFeedstocks : postTypeValidated;
      if (designDriverWarnings.length > 0 && (projectType === "A" || projectType === "D")) {
        const warningCount = designDriverWarnings.filter(w => w.severity === "warning").length;
        const errorCount = designDriverWarnings.filter(w => w.severity === "error").length;
        const infoCount = designDriverWarnings.filter(w => w.severity === "info").length;
        const driverTypeLabel = projectType === "D" ? "Type D wastewater" : "Type A";
        if (warningCount > 0) {
          console.log(`Validation: ${driverTypeLabel} design driver check — auto-populated missing design driver(s) with industry defaults`);
        }
        if (errorCount > 0) {
          console.log(`Validation: ${driverTypeLabel} design driver check — ${errorCount} critical design driver(s) still missing`);
        }
        if (infoCount > 0 && warningCount === 0 && errorCount === 0) {
          console.log(`Validation: ${driverTypeLabel} design driver check — all core design drivers present`);
        }
      }
      
      // V3: TS/TSS guardrail
      const { feedstocks: tsTssValidated, warnings: tsTssWarnings } = applyTsTssGuardrail(postDesignDriverValidated, extractedParams);
      allValidationWarnings.push(...tsTssWarnings);
      
      // V4: Swap detection — wastewater streams with solids params but no flow/analytes
      const { feedstocks: swapValidated, warnings: swapWarnings, swappedSpecs } = applySwapDetection(tsTssValidated, extractedParams);
      allValidationWarnings.push(...swapWarnings);
      
      // Use validated feedstocks for the rest of the pipeline
      const validatedFeedstockEntries = swapValidated;
      
      // Build unmapped specs from section-rejected params + output unmapped + biosolids + biogas + swapped
      const allUnmappedSpecs: Record<string, { value: string; unit: string; source: string; confidence: string; provenance: string; group: string; displayName: string; sortOrder: number }> = {};
      for (const unmappedBucket of [unmappedOutputSpecs, biosolidsUnmapped, biogasUnmapped]) {
        for (const [key, spec] of Object.entries(unmappedBucket)) {
          allUnmappedSpecs[key] = {
            value: spec.value,
            unit: spec.unit,
            source: spec.source,
            confidence: spec.confidence,
            provenance: spec.provenance,
            group: "unmapped",
            displayName: spec.displayName,
            sortOrder: spec.sortOrder,
          };
        }
      }
      for (const [key, spec] of Object.entries(swappedSpecs)) {
        allUnmappedSpecs[key] = spec;
      }
      for (const param of allUnmappedParams) {
        const safeKey = `param_${param.name.replace(/\s+/g, "_").toLowerCase()}`;
        allUnmappedSpecs[safeKey] = {
          value: param.value || "",
          unit: param.unit || "",
          source: (param as any).source || "predicted",
          confidence: (param as any).confidence || "low",
          provenance: "Moved to unmapped by validation — section/unit mismatch",
          group: "unmapped",
          displayName: param.name,
          sortOrder: 99,
        };
      }
      
      if (allValidationWarnings.length > 0) {
        console.log(`Validation: Total warnings: ${allValidationWarnings.length}`);
        for (const w of allValidationWarnings) {
          console.log(`  [${w.severity}] ${w.section}: ${w.message}`);
        }
      }
      
      const newOutputRequirements = outputParams.map(p => `${p.name}: ${p.value}${p.unit ? ` ${p.unit}` : ""}`).join("; ");

      const cf = (existingUpif?.confirmedFields as ConfirmedFields | null) || {};
      const oldFeedstocks = (existingUpif?.feedstocks as FeedstockEntry[] | null) || [];
      const oldOutputSpecs = existingUpif?.outputSpecs as Record<string, Record<string, EnrichedOutputSpec>> | null;

      const mergedFeedstocks = validatedFeedstockEntries.length > 0 ? validatedFeedstockEntries : [];
      if (cf.feedstocks && existingUpif) {
        for (const [idxStr, confirmed] of Object.entries(cf.feedstocks)) {
          const idx = parseInt(idxStr);
          const oldFs = oldFeedstocks[idx];
          if (!oldFs) continue;
          const newFs = mergedFeedstocks[idx];
          if (!newFs) {
            mergedFeedstocks[idx] = oldFs;
            continue;
          }
          if (confirmed.feedstockType) newFs.feedstockType = oldFs.feedstockType;
          if (confirmed.feedstockVolume) newFs.feedstockVolume = oldFs.feedstockVolume;
          if (confirmed.feedstockUnit) newFs.feedstockUnit = oldFs.feedstockUnit;
          if (confirmed.feedstockSpecs && oldFs.feedstockSpecs && newFs.feedstockSpecs) {
            for (const [specKey, isLocked] of Object.entries(confirmed.feedstockSpecs)) {
              if (isLocked && oldFs.feedstockSpecs[specKey]) {
                newFs.feedstockSpecs[specKey] = oldFs.feedstockSpecs[specKey];
              }
            }
          }
        }
      }

      if (isTypeA) {
        if (!sanitizedOutputSpecs[effluentProfile]) {
          const enriched = enrichOutputSpecs(effluentProfile, userOutputCriteria, location || undefined);
          sanitizedOutputSpecs[effluentProfile] = enriched;
          console.log("Post-validation (Type A guarantee): Re-added effluent profile stripped by validation");
        }
        const effluentFinal = sanitizedOutputSpecs[effluentProfile];
        if (effluentFinal) {
          const requiredKeys = [
            { key: "bod", displayName: "BOD (Biochemical Oxygen Demand)", value: "\u2264 250-500", unit: "mg/L", provenance: "Typical municipal industrial pretreatment limit; varies by WWTP", sortOrder: 2 },
            { key: "cod", displayName: "COD (Chemical Oxygen Demand)", value: "\u2264 500-1000", unit: "mg/L", provenance: "Often 2x BOD limit; check local pretreatment ordinance", sortOrder: 3 },
            { key: "tss", displayName: "TSS (Total Suspended Solids)", value: "\u2264 250-400", unit: "mg/L", provenance: "Typical municipal sewer discharge limit", sortOrder: 4 },
            { key: "fog", displayName: "FOG (Fats, Oils, Grease)", value: "\u2264 100-150", unit: "mg/L", provenance: "Standard grease trap limit; FOG is primary surcharge trigger", sortOrder: 5 },
            { key: "ph", displayName: "pH", value: "6.0-9.0", unit: "", provenance: "Standard municipal sewer pH range", sortOrder: 20 },
          ];
          for (const req of requiredKeys) {
            if (!effluentFinal[req.key]) {
              effluentFinal[req.key] = {
                value: req.value,
                unit: req.unit,
                confidence: "medium" as const,
                provenance: req.provenance,
                group: "discharge",
                displayName: req.displayName,
                sortOrder: req.sortOrder,
                source: "estimated_requirement",
              };
            }
          }
        }
      }

      let mergedOutputSpecs: Record<string, Record<string, EnrichedOutputSpec>> | undefined = Object.keys(sanitizedOutputSpecs).length > 0 ? sanitizedOutputSpecs : undefined;
      if (cf.outputSpecs && oldOutputSpecs) {
        for (const [profile, specConfirms] of Object.entries(cf.outputSpecs)) {
          if (!oldOutputSpecs[profile]) continue;
          const hasAnyConfirmed = Object.values(specConfirms).some(Boolean);
          if (!hasAnyConfirmed) continue;
          if (!mergedOutputSpecs) mergedOutputSpecs = {};
          if (!mergedOutputSpecs[profile]) {
            mergedOutputSpecs[profile] = {};
          }
          for (const [specKey, isLocked] of Object.entries(specConfirms)) {
            if (isLocked && oldOutputSpecs[profile][specKey]) {
              mergedOutputSpecs[profile][specKey] = oldOutputSpecs[profile][specKey];
            }
          }
        }
      }

      const mergedLocation = cf.location && existingUpif?.location ? existingUpif.location : location;
      const mergedOutputReq = cf.outputRequirements && existingUpif?.outputRequirements ? existingUpif.outputRequirements : newOutputRequirements;

      const mergedConstraints = [...constraints];
      if (cf.constraints && existingUpif?.constraints) {
        for (const [idxStr, isLocked] of Object.entries(cf.constraints)) {
          const idx = parseInt(idxStr);
          if (isLocked && existingUpif.constraints[idx] !== undefined) {
            mergedConstraints[idx] = existingUpif.constraints[idx];
          }
        }
      }

      const mergedPrimary = mergedFeedstocks[0];

      const upifData = {
        scenarioId,
        feedstockType: mergedPrimary?.feedstockType,
        feedstockVolume: mergedPrimary?.feedstockVolume,
        feedstockUnit: mergedPrimary?.feedstockUnit,
        feedstockParameters: mergedPrimary?.feedstockParameters,
        feedstockSpecs: mergedPrimary?.feedstockSpecs,
        feedstocks: mergedFeedstocks.length > 0 ? mergedFeedstocks : undefined,
        outputRequirements: mergedOutputReq,
        outputSpecs: mergedOutputSpecs,
        validationWarnings: allValidationWarnings.length > 0 ? allValidationWarnings : undefined,
        unmappedSpecs: Object.keys(allUnmappedSpecs).length > 0 ? allUnmappedSpecs : undefined,
        performanceTargets: performanceTargets.length > 0 ? performanceTargets : undefined,
        location: mergedLocation,
        constraints: mergedConstraints.filter((c): c is string => c != null),
        confirmedFields: Object.keys(cf).length > 0 ? cf : undefined,
        isConfirmed: false,
      };
      
      if (existingUpif) {
        await storage.updateUpif(scenarioId, upifData);
      } else {
        await storage.createUpif(upifData);
      }
      
      // Update scenario status
      await storage.updateScenarioStatus(scenarioId, "in_review");
      
      const extractScenarioFull = await storage.getScenario(scenarioId);
      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "UPIF",
        modelUsed: extractModel,
        projectId: extractScenarioFull?.projectId || null,
        projectName: extractScenarioFull?.project?.name || null,
        scenarioId,
        scenarioName: extractScenarioFull?.name || null,
        durationMs,
        status: "success",
      }).catch(e => console.error("Failed to log generation:", e));

      const params = await storage.getParametersByScenario(scenarioId);
      res.json(params);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "UPIF",
        modelUsed: "unknown",
        durationMs,
        status: "error",
        errorMessage: (error as any)?.message || "Unknown error",
      }).catch(e => console.error("Failed to log generation:", e));
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
      
      const param = await storage.updateParameter((req.params.id as string), updates);
      if (!param) {
        return res.status(404).json({ error: "Parameter not found" });
      }
      res.json(param);
    } catch (error) {
      console.error("Error updating parameter:", error);
      res.status(500).json({ error: "Failed to update parameter" });
    }
  });

  // =========================================================================
  // UPIF CRUD & Confirm
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/upif", async (req: Request, res: Response) => {
    try {
      const upif = await storage.getUpifByScenario((req.params.scenarioId as string));
      res.json(upif || null);
    } catch (error) {
      console.error("Error fetching UPIF:", error);
      res.status(500).json({ error: "Failed to fetch UPIF" });
    }
  });

  app.patch("/api/scenarios/:scenarioId/upif", async (req: Request, res: Response) => {
    try {
      const upif = await storage.updateUpif((req.params.scenarioId as string), req.body);
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
      const scenarioId = (req.params.scenarioId as string);
      
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

  app.get("/api/scenarios/:scenarioId/sibling-upifs", async (req: Request, res: Response) => {
    try {
      const scenario = await storage.getScenario((req.params.scenarioId as string));
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });

      const siblings = await storage.getScenariosByProject(scenario.projectId);
      const results: { scenarioId: string; scenarioName: string; isConfirmed: boolean; updatedAt: string }[] = [];

      for (const sib of siblings) {
        if (sib.id === (req.params.scenarioId as string)) continue;
        const upif = await storage.getUpifByScenario(sib.id);
        if (upif) {
          results.push({
            scenarioId: sib.id,
            scenarioName: sib.name,
            isConfirmed: !!upif.isConfirmed,
            updatedAt: upif.updatedAt?.toString() || upif.createdAt?.toString() || "",
          });
        }
      }
      res.json(results);
    } catch (error) {
      console.error("Error fetching sibling UPIFs:", error);
      res.status(500).json({ error: "Failed to fetch sibling UPIFs" });
    }
  });

  app.post("/api/scenarios/:scenarioId/import-upif", async (req: Request, res: Response) => {
    try {
      const { sourceScenarioId } = req.body;
      if (!sourceScenarioId || typeof sourceScenarioId !== "string") {
        return res.status(400).json({ error: "sourceScenarioId is required" });
      }

      const targetScenario = await storage.getScenario((req.params.scenarioId as string));
      if (!targetScenario) return res.status(404).json({ error: "Target scenario not found" });

      if (targetScenario.status === "confirmed") {
        return res.status(400).json({ error: "Cannot import into a confirmed scenario. Reset the scenario first." });
      }

      const sourceScenario = await storage.getScenario(sourceScenarioId);
      if (!sourceScenario) return res.status(404).json({ error: "Source scenario not found" });

      if (sourceScenario.projectId !== targetScenario.projectId) {
        return res.status(403).json({ error: "Can only import UPIFs from scenarios within the same project" });
      }

      const sourceUpif = await storage.getUpifByScenario(sourceScenarioId);
      if (!sourceUpif) return res.status(404).json({ error: "Source scenario has no UPIF to import" });

      const existingUpif = await storage.getUpifByScenario((req.params.scenarioId as string));

      const importData: Partial<InsertUpif> = {
        feedstockType: sourceUpif.feedstockType,
        feedstockVolume: sourceUpif.feedstockVolume,
        feedstockUnit: sourceUpif.feedstockUnit,
        feedstockParameters: sourceUpif.feedstockParameters,
        outputRequirements: sourceUpif.outputRequirements,
        location: sourceUpif.location,
        constraints: sourceUpif.constraints,
        feedstockSpecs: sourceUpif.feedstockSpecs,
        outputSpecs: sourceUpif.outputSpecs,
        feedstocks: sourceUpif.feedstocks,
        validationWarnings: sourceUpif.validationWarnings,
        unmappedSpecs: sourceUpif.unmappedSpecs,
        performanceTargets: sourceUpif.performanceTargets,
      };

      let upif;
      if (existingUpif) {
        upif = await storage.updateUpif((req.params.scenarioId as string), {
          ...importData,
          isConfirmed: false,
          confirmedFields: null,
        });
      } else {
        upif = await storage.createUpif({
          scenarioId: (req.params.scenarioId as string),
          ...importData,
        } as InsertUpif);
      }

      await storage.updateScenarioStatus((req.params.scenarioId as string), "in_review");

      res.json(upif);
    } catch (error) {
      console.error("Error importing UPIF:", error);
      res.status(500).json({ error: "Failed to import UPIF" });
    }
  });

  // =========================================================================
  // UPIF Reviewer Chat
  //
  // Conversational AI endpoint that lets reviewers discuss and refine the UPIF.
  // The flow:
  //  1. Builds a list of locked (confirmed) fields that must not be changed
  //  2. Creates a UPIF snapshot providing the AI with current field values
  //  3. Sends the last 10 chat messages + user message to the LLM
  //  4. Parses the AI response for an assistant message and field updates
  //  5. Server-side enforcement: any updates to locked fields are reverted
  //  6. Applies valid updates to the UPIF and stores the chat message
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/upif/chat", async (req: Request, res: Response) => {
    try {
      const messages = await storage.getChatMessagesByScenario((req.params.scenarioId as string));
      res.json(messages);
    } catch (error) {
      console.error("Error fetching chat messages:", error);
      res.status(500).json({ error: "Failed to fetch chat messages" });
    }
  });

  app.post("/api/scenarios/:scenarioId/upif/chat", async (req: Request, res: Response) => {
    try {
      const scenarioId = (req.params.scenarioId as string);
      const { message } = req.body;

      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "Message is required" });
      }

      const upif = await storage.getUpifByScenario(scenarioId);
      if (!upif) {
        return res.status(404).json({ error: "No UPIF found for this scenario" });
      }

      const cf = (upif.confirmedFields as ConfirmedFields | null) || {};
      const feedstocks = (upif.feedstocks as FeedstockEntry[] | null) || [];

      await storage.createChatMessage({
        scenarioId,
        role: "user",
        content: message.trim(),
      });

      const scenario = await storage.getScenario(scenarioId);
      const chatModel = (scenario?.preferredModel as LLMProvider) || "gpt5";

      if (getAvailableProviders().length === 0) {
        const assistantMsg = await storage.createChatMessage({
          scenarioId,
          role: "assistant",
          content: "No AI provider is configured. Please ensure an API key is set up.",
        });
        return res.json(assistantMsg);
      }

      const lockedFieldsList: string[] = [];
      if (cf.location) lockedFieldsList.push("location");
      if (cf.outputRequirements) lockedFieldsList.push("outputRequirements");
      if (cf.constraints) {
        for (const [idx, locked] of Object.entries(cf.constraints)) {
          if (locked && upif.constraints?.[parseInt(idx)]) {
            lockedFieldsList.push(`constraints[${idx}]: "${upif.constraints[parseInt(idx)]}"`);
          }
        }
      }
      if (cf.feedstocks) {
        for (const [idx, fsConf] of Object.entries(cf.feedstocks)) {
          const fs = feedstocks[parseInt(idx)];
          if (!fs) continue;
          if (fsConf.feedstockType) lockedFieldsList.push(`feedstocks[${idx}].feedstockType: "${fs.feedstockType}"`);
          if (fsConf.feedstockVolume) lockedFieldsList.push(`feedstocks[${idx}].feedstockVolume: "${fs.feedstockVolume}"`);
          if (fsConf.feedstockUnit) lockedFieldsList.push(`feedstocks[${idx}].feedstockUnit: "${fs.feedstockUnit}"`);
          if (fsConf.feedstockSpecs) {
            for (const [specKey, locked] of Object.entries(fsConf.feedstockSpecs)) {
              if (locked) lockedFieldsList.push(`feedstocks[${idx}].feedstockSpecs.${specKey}`);
            }
          }
        }
      }
      if (cf.outputSpecs) {
        for (const [profile, specs] of Object.entries(cf.outputSpecs)) {
          for (const [specKey, locked] of Object.entries(specs)) {
            if (locked) lockedFieldsList.push(`outputSpecs["${profile}"].${specKey}`);
          }
        }
      }

      const upifSnapshot: Record<string, unknown> = {
        location: upif.location,
        outputRequirements: upif.outputRequirements,
        constraints: upif.constraints,
        feedstocks: feedstocks.map((fs, i) => ({
          index: i,
          feedstockType: fs.feedstockType,
          feedstockVolume: fs.feedstockVolume,
          feedstockUnit: fs.feedstockUnit,
          feedstockSpecs: fs.feedstockSpecs ? Object.fromEntries(
            Object.entries(fs.feedstockSpecs).map(([k, v]) => [k, { value: v.value, unit: v.unit }])
          ) : undefined,
        })),
        outputSpecs: upif.outputSpecs ? Object.fromEntries(
          Object.entries(upif.outputSpecs as Record<string, Record<string, { value: string; unit: string }>>).map(([profile, specs]) => [
            profile,
            Object.fromEntries(Object.entries(specs).map(([k, v]) => [k, { value: v.value, unit: v.unit }]))
          ])
        ) : undefined,
      };

      const chatHistory = await storage.getChatMessagesByScenario(scenarioId);
      const recentHistory = chatHistory.slice(-10);

      const reviewerTemplate = await getPromptTemplate("reviewer_chat");
      const systemPrompt = reviewerTemplate
        .replace("{{UPIF_STATE}}", JSON.stringify(upifSnapshot, null, 2))
        .replace("{{LOCKED_FIELDS}}", lockedFieldsList.length > 0 ? lockedFieldsList.map(f => `- ${f}`).join("\n") : "None - all fields are unlocked");

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
      ];

      for (const msg of recentHistory) {
        if (msg.role === "user") {
          messages.push({ role: "user", content: msg.content });
        } else if (msg.role === "assistant") {
          messages.push({ role: "assistant", content: msg.content });
        }
      }
      messages.push({ role: "user", content: message.trim() });

      const response = await llmComplete({
        model: chatModel,
        messages,
        maxTokens: 8192,
        jsonMode: true,
      });

      const rawResponse = response.content || "{}";
      let parsed: {
        assistantMessage?: string;
        updates?: Record<string, unknown>;
        changedFields?: string[];
      };

      try {
        parsed = JSON.parse(rawResponse);
      } catch {
        parsed = { assistantMessage: "I had trouble processing your request. Please try again." };
      }

      const assistantMessage = parsed.assistantMessage || "I've reviewed your feedback.";
      const updates = parsed.updates || {};
      const modelChangedFields = parsed.changedFields || [];

      const patchData: Record<string, unknown> = {};
      let actualChanges: string[] = [];

      if (updates.location !== null && updates.location !== undefined && typeof updates.location === "string" && !cf.location) {
        patchData.location = updates.location;
        actualChanges.push("location");
      }
      if (updates.outputRequirements !== null && updates.outputRequirements !== undefined && typeof updates.outputRequirements === "string" && !cf.outputRequirements) {
        patchData.outputRequirements = updates.outputRequirements;
        actualChanges.push("outputRequirements");
      }
      if (updates.constraints !== null && updates.constraints !== undefined && Array.isArray(updates.constraints)) {
        const newConstraints = [...(updates.constraints as string[])];
        if (cf.constraints && upif.constraints) {
          for (const [idxStr, isLocked] of Object.entries(cf.constraints)) {
            const idx = parseInt(idxStr);
            if (isLocked && upif.constraints[idx] !== undefined) {
              newConstraints[idx] = upif.constraints[idx];
            }
          }
        }
        patchData.constraints = newConstraints;
        actualChanges.push("constraints");
      }
      if (updates.feedstocks !== null && updates.feedstocks !== undefined && Array.isArray(updates.feedstocks)) {
        const newFeedstocks = updates.feedstocks as FeedstockEntry[];
        for (let i = 0; i < newFeedstocks.length; i++) {
          const oldFs = feedstocks[i];
          const newFs = newFeedstocks[i];
          if (!oldFs || !newFs) continue;
          if (oldFs.feedstockSpecs && newFs.feedstockSpecs) {
            const mergedSpecs = { ...oldFs.feedstockSpecs };
            for (const [specKey, newSpec] of Object.entries(newFs.feedstockSpecs)) {
              if (mergedSpecs[specKey]) {
                mergedSpecs[specKey] = {
                  ...mergedSpecs[specKey],
                  value: newSpec.value ?? mergedSpecs[specKey].value,
                  unit: newSpec.unit ?? mergedSpecs[specKey].unit,
                };
              } else {
                mergedSpecs[specKey] = {
                  value: newSpec.value || "",
                  unit: newSpec.unit || "",
                  source: newSpec.source || "user_provided",
                  confidence: newSpec.confidence || "medium",
                  provenance: newSpec.provenance || "Added via reviewer chat",
                  group: newSpec.group || "extended",
                  displayName: newSpec.displayName || specKey,
                  sortOrder: newSpec.sortOrder ?? 99,
                };
              }
            }
            newFs.feedstockSpecs = mergedSpecs;
          } else if (oldFs.feedstockSpecs && !newFs.feedstockSpecs) {
            newFs.feedstockSpecs = oldFs.feedstockSpecs;
          }
        }
        if (cf.feedstocks) {
          for (const [idxStr, fsConf] of Object.entries(cf.feedstocks)) {
            const idx = parseInt(idxStr);
            const oldFs = feedstocks[idx];
            const newFs = newFeedstocks[idx];
            if (!oldFs || !newFs) continue;
            if (fsConf.feedstockType) newFs.feedstockType = oldFs.feedstockType;
            if (fsConf.feedstockVolume) newFs.feedstockVolume = oldFs.feedstockVolume;
            if (fsConf.feedstockUnit) newFs.feedstockUnit = oldFs.feedstockUnit;
            if (fsConf.feedstockSpecs && oldFs.feedstockSpecs && newFs.feedstockSpecs) {
              for (const [specKey, locked] of Object.entries(fsConf.feedstockSpecs)) {
                if (locked && oldFs.feedstockSpecs[specKey]) {
                  newFs.feedstockSpecs[specKey] = oldFs.feedstockSpecs[specKey];
                }
              }
            }
          }
        }
        patchData.feedstocks = newFeedstocks;
        const primary = newFeedstocks[0];
        if (primary) {
          patchData.feedstockType = primary.feedstockType;
          patchData.feedstockVolume = primary.feedstockVolume;
          patchData.feedstockUnit = primary.feedstockUnit;
          patchData.feedstockSpecs = primary.feedstockSpecs;
        }
        actualChanges.push("feedstocks");
      }
      if (updates.outputSpecs !== null && updates.outputSpecs !== undefined && typeof updates.outputSpecs === "object") {
        const newOutputSpecs = updates.outputSpecs as Record<string, Record<string, unknown>>;
        if (cf.outputSpecs) {
          const oldOutputSpecs = upif.outputSpecs as Record<string, Record<string, unknown>> | null;
          if (oldOutputSpecs) {
            for (const [profile, specConfirms] of Object.entries(cf.outputSpecs)) {
              for (const [specKey, locked] of Object.entries(specConfirms)) {
                if (locked && oldOutputSpecs[profile]?.[specKey] && newOutputSpecs[profile]) {
                  newOutputSpecs[profile][specKey] = oldOutputSpecs[profile][specKey];
                }
              }
            }
          }
        }
        patchData.outputSpecs = newOutputSpecs;
        actualChanges.push("outputSpecs");
      }

      if (Object.keys(patchData).length > 0) {
        await storage.updateUpif(scenarioId, patchData);
      }

      const detailedChanges = modelChangedFields.length > 0
        ? modelChangedFields.filter(f => actualChanges.some(ac => f.startsWith(ac) || f === ac))
        : actualChanges;

      const assistantMsg = await storage.createChatMessage({
        scenarioId,
        role: "assistant",
        content: assistantMessage,
        appliedUpdates: actualChanges.length > 0 ? {
          changedFields: detailedChanges.length > 0 ? detailedChanges : actualChanges,
          summary: `Updated: ${actualChanges.join(", ")}`,
        } : undefined,
      });

      res.json(assistantMsg);
    } catch (error: any) {
      console.error("Error in UPIF chat:", error?.message || error);
      const errMsg = error?.message || "Unknown error";
      res.status(500).json({ error: `Failed to process chat message: ${errMsg}` });
    }
  });

  // =========================================================================
  // PDF Export
  //
  // Generates a downloadable PDF of the UPIF using PDFKit. The document
  // includes: title header, DRAFT watermark (if unconfirmed), AI-generated
  // project summary, feedstock tables grouped by spec category, output
  // acceptance criteria tables, location, constraints list, and page numbers.
  // =========================================================================

  /**
   * Helper to render a data table in the PDF. Handles column widths, header
   * row styling, alternating row backgrounds, cell text wrapping, and
   * automatic page breaks when content overflows.
   */
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
    const minRowHeight = 18;
    const cellPadding = 3;
    const pageHeight = 792;
    const tableWidth = colWidths.reduce((a, b) => a + b, 0);
    let y = startY;

    const lastColIdx = colWidths.length - 1;

    const measureRowHeight = (cells: string[], bold: boolean): number => {
      let maxH = minRowHeight;
      for (let i = 0; i < cells.length; i++) {
        const cellText = sanitizePdfText(cells[i] || "");
        const cellWidth = colWidths[i] - cellPadding * 2;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
        const textH = doc.heightOfString(cellText, { width: cellWidth });
        const cellH = textH + cellPadding * 2;
        if (cellH > maxH) maxH = cellH;
      }
      return maxH;
    };

    const drawRow = (cells: string[], bold: boolean, bgColor?: string) => {
      const rowHeight = measureRowHeight(cells, bold);

      if (y + rowHeight > pageHeight - margin - 30) {
        doc.addPage();
        y = margin;
      }
      if (bgColor) {
        doc.save();
        doc.rect(startX, y, tableWidth, rowHeight).fill(bgColor);
        doc.restore();
      }
      let x = startX;
      for (let i = 0; i < cells.length; i++) {
        const cellText = sanitizePdfText(cells[i] || "");
        const isLastCol = i === lastColIdx;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(fontSize)
          .fillColor("#333333")
          .text(cellText, x + cellPadding, y + cellPadding, {
            width: colWidths[i] - cellPadding * 2,
            height: isLastCol ? rowHeight - cellPadding : minRowHeight - cellPadding,
            ellipsis: !isLastCol,
            lineBreak: isLastCol,
          });
        x += colWidths[i];
      }
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
      const scenarioId = (req.params.scenarioId as string);
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
          `${f.feedstockType}${f.feedstockVolume ? ` (${formatNumericValue(f.feedstockVolume)} ${f.feedstockUnit || ""})` : ""}`
        ).join(", ");

        const pdfTemplate = await getPromptTemplate("pdf_summary");
        const prompt = pdfTemplate
          .replace("{{PROJECT_NAME}}", project.name)
          .replace("{{SCENARIO_NAME}}", scenario.name)
          .replace("{{FEEDSTOCKS}}", feedstockDesc || "Not specified")
          .replace("{{LOCATION}}", upif.location || "Not specified")
          .replace("{{OUTPUT_REQUIREMENTS}}", upif.outputRequirements || "Not specified")
          .replace("{{CONSTRAINTS}}", upif.constraints?.join("; ") || "None specified");

        const pdfScenario = await storage.getScenario(scenarioId);
        const pdfModel = (pdfScenario?.preferredModel as LLMProvider) || "gpt5";
        const completion = await llmComplete({
          model: pdfModel,
          messages: [{ role: "user", content: prompt }],
          maxTokens: 300,
        });
        aiSummary = completion.content?.trim() || "";
      } catch (err) {
        console.error("LLM summary generation failed, using fallback:", err);
      }

      if (!aiSummary) {
        const parts: string[] = [];
        parts.push(`This project intake form documents the "${project.name}" project (scenario: "${scenario.name}").`);
        if (feedstocks.length > 0) {
          const desc = feedstocks.map(f => `${f.feedstockType}${f.feedstockVolume ? ` at ${formatNumericValue(f.feedstockVolume)} ${f.feedstockUnit || ""}` : ""}`).join(", ");
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
          .fillColor("#e53e3e")
          .opacity(0.12)
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
        .text(`Scenario: ${scenario.name}`, leftMargin, doc.y + 4, { align: "center", width: contentWidth });

      const pdfProjectType = (scenario as any).projectType as string | null;
      const pdfTypeConfirmed = (scenario as any).projectTypeConfirmed as boolean;
      const pdfTypeLabels: Record<string, string> = { A: "Wastewater Treatment", B: "RNG Greenfield", C: "RNG Bolt-On", D: "Hybrid" };
      if (pdfProjectType && pdfTypeConfirmed) {
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#2563eb")
          .text(`Project Type ${pdfProjectType}: ${pdfTypeLabels[pdfProjectType] || pdfProjectType}`, leftMargin, doc.y + 4, { align: "center", width: contentWidth });
      }

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
        .text(sanitizePdfText(formatNumericValue(aiSummary)), leftMargin, currentY, { width: contentWidth, lineGap: 2 });
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
            .text(sanitizePdfText(feedstock.feedstockType), leftMargin, currentY);
          currentY = doc.y + 4;

          if (feedstock.feedstockVolume) {
            doc.font("Helvetica").fontSize(10).fillColor("#555555")
              .text(sanitizePdfText(`Volume: ${formatNumericValue(feedstock.feedstockVolume)} ${feedstock.feedstockUnit || ""}`), leftMargin, currentY);
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
                formatNumericValue(spec.value || ""),
                spec.unit || "",
                spec.source === "user_provided" ? "User" : "Estimated",
                spec.provenance || "",
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
            .text(sanitizePdfText(profileName), leftMargin, currentY);
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
              formatNumericValue(spec.value || ""),
              spec.unit || "",
              (spec.source || "").replace(/_/g, " "),
              spec.confidence || "",
              spec.provenance || "",
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
        .text(sanitizePdfText(upif.location || "Not specified"), leftMargin, currentY, { width: contentWidth });
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
            .text(sanitizePdfText(`  *  ${constraint}`), leftMargin, currentY, { width: contentWidth });
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

  // =========================================================================
  // MASS BALANCE ROUTES
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/mass-balance", async (req: Request, res: Response) => {
    try {
      const runs = await storage.getMassBalanceRunsByScenario((req.params.scenarioId as string));
      res.json(runs);
    } catch (error) {
      console.error("Error fetching mass balance runs:", error);
      res.status(500).json({ error: "Failed to fetch mass balance runs" });
    }
  });

  app.get("/api/mass-balance/:id", async (req: Request, res: Response) => {
    try {
      const run = await storage.getMassBalanceRun((req.params.id as string));
      if (!run) return res.status(404).json({ error: "Mass balance run not found" });
      res.json(run);
    } catch (error) {
      console.error("Error fetching mass balance run:", error);
      res.status(500).json({ error: "Failed to fetch mass balance run" });
    }
  });

  app.post("/api/scenarios/:scenarioId/mass-balance/generate", async (req: Request, res: Response) => {
    req.setTimeout(180000);
    res.setTimeout(180000);
    const startTime = Date.now();
    let modelUsed = "deterministic";
    try {
      const scenarioId = req.params.scenarioId as string;
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });

      if (scenario.status !== "confirmed") {
        return res.status(400).json({ error: "Scenario must be confirmed before generating a mass balance. Confirm the UPIF first." });
      }

      const upif = await storage.getUpifByScenario(scenarioId);
      if (!upif) return res.status(400).json({ error: "No UPIF found for this scenario. Generate and confirm a UPIF first." });

      const projectType = (scenario as any).projectType || (upif as any).projectType || "";
      const preferredModel = (scenario.preferredModel || "gpt5") as LLMProvider;
      console.log(`Mass Balance Generate: scenarioId=${scenarioId}, projectType="${projectType}", preferredModel=${preferredModel}`);

      let results;
      const ptNorm = projectType.toLowerCase().trim();
      const isRngType = ptNorm === "b" || ptNorm === "c" || ptNorm === "d"
        || ptNorm.includes("type b") || ptNorm.includes("type c") || ptNorm.includes("type d")
        || ptNorm.includes("greenfield") || ptNorm.includes("bolt-on") || ptNorm.includes("bolt on") || ptNorm.includes("hybrid");

      if (isRngType) {
        try {
          const { generateDeterministicMassBalance } = await import("./services/massBalanceDeterministic");
          const detResult = generateDeterministicMassBalance(upif, projectType);
          results = detResult.results;
          modelUsed = "Deterministic Calculator";
          console.log(`Mass Balance: Deterministic calculation succeeded in ${Date.now() - startTime}ms`);
        } catch (detError) {
          const detErrMsg = (detError as Error).message;
          console.warn(`Mass Balance: Deterministic calculation failed, falling back to AI:`, detErrMsg);
          try {
            const AI_TIMEOUT_MS = 120000;
            const { generateMassBalanceWithAI } = await import("./services/massBalanceAI");
            const aiPromise = generateMassBalanceWithAI(upif, projectType, preferredModel, storage);
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("AI mass balance generation timed out after 2 minutes")), AI_TIMEOUT_MS)
            );
            const aiResult = await Promise.race([aiPromise, timeoutPromise]);
            results = aiResult.results;
            modelUsed = aiResult.providerLabel + " (deterministic fallback)";
            console.log(`Mass Balance: AI fallback succeeded using ${modelUsed}`);
          } catch (aiError) {
            const aiErrMsg = (aiError as Error).message;
            console.error(`Mass Balance: AI fallback also failed:`, aiErrMsg);
            throw new Error(`Deterministic calculator failed: ${detErrMsg}. AI fallback also failed: ${aiErrMsg}`);
          }
        }
      } else {
        try {
          const AI_TIMEOUT_MS = 120000;
          const { generateMassBalanceWithAI } = await import("./services/massBalanceAI");
          const aiPromise = generateMassBalanceWithAI(upif, projectType, preferredModel, storage);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("AI mass balance generation timed out after 2 minutes")), AI_TIMEOUT_MS)
          );
          const aiResult = await Promise.race([aiPromise, timeoutPromise]);
          results = aiResult.results;
          modelUsed = aiResult.providerLabel;
          console.log(`Mass Balance: AI generation succeeded using ${modelUsed}`);
        } catch (aiError) {
          console.error(`Mass Balance: AI generation failed for Type A:`, (aiError as Error).message);
          throw aiError;
        }
      }

      const existingRuns = await storage.getMassBalanceRunsByScenario(scenarioId);
      const nextVersion = String(existingRuns.length + 1);

      const run = await storage.createMassBalanceRun({
        scenarioId,
        version: nextVersion,
        status: "draft",
        inputSnapshot: {
          upifId: upif.id,
          feedstocks: upif.feedstocks,
          outputSpecs: upif.outputSpecs,
          projectType,
        },
        results,
        overrides: {},
        locks: {},
      });

      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "Mass Balance",
        modelUsed,
        projectId: scenario.projectId,
        projectName: scenario.project?.name || null,
        scenarioId,
        scenarioName: scenario.name,
        durationMs,
        status: "success",
      }).catch(e => console.error("Failed to log generation:", e));

      res.json(run);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "Mass Balance",
        modelUsed,
        durationMs,
        status: "error",
        errorMessage: (error as any)?.message || "Unknown error",
      }).catch(e => console.error("Failed to log generation:", e));
      const errMsg = (error as any)?.message || "Unknown error";
      console.error("Error generating mass balance:", errMsg, error);
      res.status(500).json({ error: `Failed to generate mass balance: ${errMsg}` });
    }
  });

  function applyOverrideToResults(obj: any, path: string[], value: string) {
    if (path.length === 0 || !obj) return;
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = path[i];
      const idx = Number(segment);
      if (!isNaN(idx) && Array.isArray(current)) {
        current = current[idx];
      } else if (Array.isArray(current)) {
        const match = current.find((item: any) => item && item.id === segment);
        if (match) {
          current = match;
        } else {
          return;
        }
      } else if (current && typeof current === "object") {
        current = current[segment];
      } else {
        return;
      }
      if (!current) return;
    }
    const lastKey = path[path.length - 1];
    if (current && typeof current === "object") {
      if (current[lastKey] !== undefined && typeof current[lastKey] === "object" && current[lastKey] !== null && "value" in current[lastKey]) {
        const numVal = Number(value.replace(/,/g, ""));
        current[lastKey].value = isNaN(numVal) ? value : numVal;
      } else {
        const numVal = Number(value.replace(/,/g, ""));
        current[lastKey] = isNaN(numVal) ? value : numVal;
      }
    }
  }

  const overridesSchema = z.object({
    overrides: z.record(z.string(), z.object({
      value: z.string(),
      unit: z.string(),
      overriddenBy: z.string(),
      reason: z.string(),
      originalValue: z.string(),
    })),
  });

  const locksSchema = z.object({
    locks: z.record(z.string(), z.boolean()),
  });

  const statusSchema = z.object({
    status: z.enum(["draft", "reviewed", "finalized"]),
  });

  app.patch("/api/mass-balance/:id/overrides", async (req: Request, res: Response) => {
    try {
      const run = await storage.getMassBalanceRun((req.params.id as string));
      if (!run) return res.status(404).json({ error: "Mass balance run not found" });

      const parsed = overridesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid overrides format", details: parsed.error.issues });
      }

      const mergedOverrides = { ...(run.overrides || {}), ...parsed.data.overrides };
      const updated = await storage.updateMassBalanceRun((req.params.id as string), {
        overrides: mergedOverrides,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating overrides:", error);
      res.status(500).json({ error: "Failed to update overrides" });
    }
  });

  app.patch("/api/mass-balance/:id/locks", async (req: Request, res: Response) => {
    try {
      const run = await storage.getMassBalanceRun((req.params.id as string));
      if (!run) return res.status(404).json({ error: "Mass balance run not found" });

      const parsed = locksSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid locks format", details: parsed.error.issues });
      }

      const mergedLocks = { ...(run.locks || {}), ...parsed.data.locks };
      const updated = await storage.updateMassBalanceRun((req.params.id as string), {
        locks: mergedLocks,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error updating locks:", error);
      res.status(500).json({ error: "Failed to update locks" });
    }
  });

  app.post("/api/mass-balance/:id/recompute", async (req: Request, res: Response) => {
    try {
      const run = await storage.getMassBalanceRun((req.params.id as string));
      if (!run) return res.status(404).json({ error: "Mass balance run not found" });

      const upif = await storage.getUpifByScenario(run.scenarioId);
      if (!upif) return res.status(400).json({ error: "Source UPIF no longer exists" });

      const scenario = await storage.getScenario(run.scenarioId);
      const projectType = (scenario as any)?.projectType || (upif as any).projectType || "";

      const existingOverrides = (run.overrides || {}) as Record<string, any>;
      const existingLocks = (run.locks || {}) as Record<string, boolean>;

      const { extractDesignOverrides, isRecalculableField } = await import("./services/designOverrides");
      const designOverrides = extractDesignOverrides(existingOverrides, existingLocks);
      const hasDesignOverrides = Object.keys(designOverrides).length > 0;

      let results;
      const ptLower = projectType.toLowerCase().trim();

      if (hasDesignOverrides) {
        console.log(`Mass Balance Recompute: Deterministic recalculation with design overrides: ${JSON.stringify(designOverrides)}`);
        if (ptLower === "b" || ptLower.includes("type b") || ptLower.includes("greenfield")) {
          const { calculateMassBalanceTypeB } = await import("./services/massBalanceTypeB");
          results = calculateMassBalanceTypeB(upif, designOverrides);
        } else if (ptLower === "c" || ptLower.includes("type c") || ptLower.includes("bolt-on") || ptLower.includes("bolt on")) {
          const { calculateMassBalanceTypeC } = await import("./services/massBalanceTypeC");
          results = calculateMassBalanceTypeC(upif);
        } else if (ptLower === "d" || ptLower.includes("type d") || ptLower.includes("hybrid")) {
          const { calculateMassBalanceTypeD } = await import("./services/massBalanceTypeD");
          results = calculateMassBalanceTypeD(upif, designOverrides);
        } else {
          const { calculateMassBalance } = await import("./services/massBalance");
          results = calculateMassBalance(upif);
        }
      } else {
        const preferredModel = (scenario?.preferredModel || "gpt5") as LLMProvider;
        try {
          const { generateMassBalanceWithAI } = await import("./services/massBalanceAI");
          const aiResult = await generateMassBalanceWithAI(upif, projectType, preferredModel, storage);
          results = aiResult.results;
          console.log(`Mass Balance Recompute: AI succeeded using ${aiResult.providerLabel}`);
        } catch (aiError) {
          console.warn(`Mass Balance Recompute: AI failed, falling back to deterministic:`, (aiError as Error).message);
          if (ptLower === "b" || ptLower.includes("type b") || ptLower.includes("greenfield")) {
            const { calculateMassBalanceTypeB } = await import("./services/massBalanceTypeB");
            results = calculateMassBalanceTypeB(upif);
          } else if (ptLower === "c" || ptLower.includes("type c") || ptLower.includes("bolt-on") || ptLower.includes("bolt on")) {
            const { calculateMassBalanceTypeC } = await import("./services/massBalanceTypeC");
            results = calculateMassBalanceTypeC(upif);
          } else if (ptLower === "d" || ptLower.includes("type d") || ptLower.includes("hybrid")) {
            const { calculateMassBalanceTypeD } = await import("./services/massBalanceTypeD");
            results = calculateMassBalanceTypeD(upif);
          } else {
            const { calculateMassBalance } = await import("./services/massBalance");
            results = calculateMassBalance(upif);
          }
        }
      }

      const lockedKeys = Object.entries(existingLocks).filter(([_, v]) => v).map(([k]) => k);

      if (lockedKeys.length > 0) {
        for (const key of lockedKeys) {
          if (isRecalculableField(key)) continue;
          const override = existingOverrides[key];
          if (!override) continue;
          const parts = key.split(".");
          applyOverrideToResults(results, parts, override.value);
        }
      }

      const updated = await storage.updateMassBalanceRun(run.id, {
        results,
        status: "draft",
      });
      res.json(updated);
    } catch (error) {
      console.error("Error recomputing mass balance:", error);
      res.status(500).json({ error: "Failed to recompute mass balance" });
    }
  });

  app.patch("/api/mass-balance/:id/status", async (req: Request, res: Response) => {
    try {
      const run = await storage.getMassBalanceRun((req.params.id as string));
      if (!run) return res.status(404).json({ error: "Mass balance run not found" });

      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid status. Must be: draft, reviewed, or finalized", details: parsed.error.issues });
      }

      const updated = await storage.updateMassBalanceRun((req.params.id as string), { status: parsed.data.status });
      res.json(updated);
    } catch (error) {
      console.error("Error updating status:", error);
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  // =========================================================================
  // Mass Balance Export (PDF & Excel)
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/mass-balance/export-pdf", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const runs = await storage.getMassBalanceRunsByScenario(scenarioId);
      const latestRun = runs?.[0];
      if (!latestRun?.results) return res.status(404).json({ error: "No mass balance data found" });
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });
      const results = latestRun.results as MassBalanceResults;
      const projectType = results.projectType || (scenario as any).projectType || "B";
      const pdfBuffer = await exportMassBalancePDF(results, scenario.name, scenario.project?.name || "Project", projectType);
      const safeName = (scenario.name || "mass-balance").replace(/[^a-zA-Z0-9_-]/g, "_");
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="MassBalance-${safeName}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error exporting mass balance PDF:", error);
      res.status(500).json({ error: "Failed to export mass balance PDF" });
    }
  });

  app.get("/api/scenarios/:scenarioId/mass-balance/export-excel", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const runs = await storage.getMassBalanceRunsByScenario(scenarioId);
      const latestRun = runs?.[0];
      if (!latestRun?.results) return res.status(404).json({ error: "No mass balance data found" });
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });
      const results = latestRun.results as MassBalanceResults;
      const projectType = results.projectType || (scenario as any).projectType || "B";
      const upif = await storage.getUpifByScenario(scenarioId);
      const xlsxBuffer = await exportMassBalanceExcel(results, scenario.name, scenario.project?.name || "Project", projectType, upif);
      const safeName = (scenario.name || "mass-balance").replace(/[^a-zA-Z0-9_-]/g, "_");
      res.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="MassBalance-${safeName}.xlsx"`,
        "Content-Length": xlsxBuffer.length.toString(),
      });
      res.send(xlsxBuffer);
    } catch (error) {
      console.error("Error exporting mass balance Excel:", error);
      res.status(500).json({ error: "Failed to export mass balance Excel" });
    }
  });

  // =========================================================================
  // Recommended Vendor List
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/vendor-list", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const runs = await storage.getMassBalanceRunsByScenario(scenarioId);
      const latestRun = runs?.[0];
      if (!latestRun) return res.status(404).json({ error: "No mass balance run found" });
      res.json({ vendorList: latestRun.vendorList || null, runId: latestRun.id });
    } catch (error) {
      console.error("Error fetching vendor list:", error);
      res.status(500).json({ error: "Failed to fetch vendor list" });
    }
  });

  app.post("/api/scenarios/:scenarioId/vendor-list/generate", async (req: Request, res: Response) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    const startTime = Date.now();
    let modelUsed = "unknown";
    try {
      const scenarioId = req.params.scenarioId as string;
      const runs = await storage.getMassBalanceRunsByScenario(scenarioId);
      const latestRun = runs?.[0];
      if (!latestRun?.results) {
        return res.status(400).json({ error: "No mass balance results found. Generate a mass balance first." });
      }
      const results = latestRun.results as MassBalanceResults;
      if (!results.equipment || results.equipment.length === 0) {
        return res.status(400).json({ error: "No equipment found in mass balance results." });
      }

      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });

      const projectType = results.projectType || (scenario as any).projectType || "B";
      const preferredModel = (scenario.preferredModel || "gpt5") as LLMProvider;

      const { generateVendorListWithAI } = await import("./services/vendorListAI");
      const aiResult = await generateVendorListWithAI(results.equipment, projectType, preferredModel, storage);
      modelUsed = aiResult.providerLabel;

      const updated = await storage.updateMassBalanceRun(latestRun.id, {
        vendorList: aiResult.vendorList,
      });

      const elapsed = Date.now() - startTime;
      try {
        await storage.createGenerationLog({
          documentType: "Vendor List",
          modelUsed,
          projectId: scenario.projectId,
          projectName: scenario.project?.name || null,
          scenarioId,
          scenarioName: scenario.name,
          durationMs: elapsed,
          status: "success",
          errorMessage: null,
        });
      } catch {}

      res.json({ vendorList: aiResult.vendorList, runId: latestRun.id });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error("Error generating vendor list:", error);
      try {
        const sid = req.params.scenarioId as string;
        const scenario = await storage.getScenario(sid);
        if (scenario) {
          await storage.createGenerationLog({
            documentType: "Vendor List",
            modelUsed,
            projectId: scenario.projectId,
            projectName: scenario.project?.name || null,
            scenarioId: sid,
            scenarioName: scenario.name,
            durationMs: elapsed,
            status: "error",
            errorMessage: (error as Error).message,
          });
        }
      } catch {}
      res.status(500).json({ error: "Failed to generate vendor list: " + (error as Error).message });
    }
  });

  app.get("/api/scenarios/:scenarioId/vendor-list/export-pdf", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const runs = await storage.getMassBalanceRunsByScenario(scenarioId);
      const latestRun = runs?.[0];
      if (!latestRun?.vendorList) return res.status(404).json({ error: "No vendor list found. Generate a vendor list first." });
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });
      const { exportVendorListPDF } = await import("./services/exportService");
      const projectType = (latestRun.results as MassBalanceResults)?.projectType || (scenario as any).projectType || "B";
      const pdfBuffer = await exportVendorListPDF(latestRun.vendorList as any, scenario.name, scenario.project?.name || "Project", projectType);
      const safeName = (scenario.name || "vendor-list").replace(/[^a-zA-Z0-9_-]/g, "_");
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="VendorList-${safeName}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error exporting vendor list PDF:", error);
      res.status(500).json({ error: "Failed to export vendor list PDF" });
    }
  });

  app.get("/api/scenarios/:scenarioId/vendor-list/export-excel", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const runs = await storage.getMassBalanceRunsByScenario(scenarioId);
      const latestRun = runs?.[0];
      if (!latestRun?.vendorList) return res.status(404).json({ error: "No vendor list found. Generate a vendor list first." });
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });
      const { exportVendorListExcel } = await import("./services/exportService");
      const projectType = (latestRun.results as MassBalanceResults)?.projectType || (scenario as any).projectType || "B";
      const excelBuffer = exportVendorListExcel(latestRun.vendorList as any, scenario.name, scenario.project?.name || "Project", projectType);
      const safeName = (scenario.name || "vendor-list").replace(/[^a-zA-Z0-9_-]/g, "_");
      res.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="VendorList-${safeName}.xlsx"`,
        "Content-Length": excelBuffer.length.toString(),
      });
      res.send(excelBuffer);
    } catch (error) {
      console.error("Error exporting vendor list Excel:", error);
      res.status(500).json({ error: "Failed to export vendor list Excel" });
    }
  });

  // =========================================================================
  // CapEx Estimates
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/capex", async (req: Request, res: Response) => {
    try {
      const estimates = await storage.getCapexEstimatesByScenario((req.params.scenarioId as string));
      res.json(estimates);
    } catch (error) {
      console.error("Error fetching capex estimates:", error);
      res.status(500).json({ error: "Failed to fetch capex estimates" });
    }
  });

  app.post("/api/scenarios/:scenarioId/capex/generate", async (req: Request, res: Response) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    const startTime = Date.now();
    let modelUsed = "unknown";
    const scenarioId = (req.params.scenarioId as string);

    try {
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });

      const mbRuns = await storage.getMassBalanceRunsByScenario(scenarioId);
      const latestMB = mbRuns[0];
      if (!latestMB) {
        return res.status(400).json({ error: "No mass balance found. Generate and finalize a mass balance first." });
      }
      if (latestMB.status !== "finalized") {
        return res.status(400).json({ error: "Mass balance must be finalized before generating CapEx. Please finalize the mass balance first." });
      }

      const mbResults = latestMB.results as import("@shared/schema").MassBalanceResults;
      if (!mbResults || !mbResults.equipment || mbResults.equipment.length === 0) {
        return res.status(400).json({ error: "Mass balance has no equipment list. Cannot generate CapEx." });
      }

      const upif = await storage.getUpifByScenario(scenarioId);
      const upifData = upif ? {
        projectType: (upif as any).projectType,
        location: upif.location,
        feedstocks: upif.feedstocks,
        outputRequirements: upif.outputRequirements,
        constraints: upif.constraints,
      } : {} as any;

      const projectType = mbResults.projectType || upifData.projectType || (scenario as any).projectType || "A";
      const preferredModel = (scenario.preferredModel || "gpt5") as import("./llm").LLMProvider;

      const normalizedPT = projectType.toLowerCase().replace(/type\s*/i, "").trim();
      const isRngType = ["b", "c", "d"].includes(normalizedPT) ||
        normalizedPT.includes("greenfield") || normalizedPT.includes("bolt") || normalizedPT.includes("hybrid");

      let capexResult: { results: import("@shared/schema").CapexResults; providerLabel: string };

      if (isRngType) {
        try {
          const { generateCapexDeterministic } = await import("./services/capexDeterministic");
          const { estimateUpstreamEquipmentCosts, getUncoveredEquipment } = await import("./services/capexAI");

          const uncoveredCount = getUncoveredEquipment(mbResults).length;
          let upstreamLineItems: import("@shared/schema").CapexLineItem[] = [];

          if (uncoveredCount > 0) {
            console.log(`CapEx Hybrid: ${uncoveredCount} upstream equipment items need AI estimation...`);
            const upstreamResult = await estimateUpstreamEquipmentCosts(upifData, mbResults, projectType, preferredModel, storage);
            upstreamLineItems = upstreamResult.lineItems;
            console.log(`CapEx Hybrid: AI estimated ${upstreamLineItems.length} upstream items in ${Date.now() - startTime}ms`);
          }

          const detResult = generateCapexDeterministic(mbResults, projectType, {
            upstreamEquipmentLineItems: upstreamLineItems,
          });
          capexResult = { results: detResult.results, providerLabel: detResult.providerLabel };
          modelUsed = detResult.providerLabel;
          console.log(`CapEx: Hybrid calculator succeeded for type ${projectType} in ${Date.now() - startTime}ms`);
        } catch (detError) {
          console.log(`CapEx: Hybrid calculator failed (${(detError as Error).message}), falling back to full AI...`);
          const { generateCapexWithAI } = await import("./services/capexAI");
          const aiResult = await generateCapexWithAI(upifData, mbResults, projectType, preferredModel, storage);
          capexResult = { results: aiResult.results, providerLabel: aiResult.providerLabel };
          modelUsed = aiResult.providerLabel;
        }
      } else {
        const { generateCapexWithAI } = await import("./services/capexAI");
        const aiResult = await generateCapexWithAI(upifData, mbResults, projectType, preferredModel, storage);
        capexResult = { results: aiResult.results, providerLabel: aiResult.providerLabel };
        modelUsed = aiResult.providerLabel;
      }

      const existingEstimates = await storage.getCapexEstimatesByScenario(scenarioId);
      const version = String(existingEstimates.length + 1);

      const estimate = await storage.createCapexEstimate({
        scenarioId,
        massBalanceRunId: latestMB.id,
        version,
        status: "draft",
        inputSnapshot: {
          massBalanceId: latestMB.id,
          massBalanceVersion: latestMB.version,
          projectType,
          equipmentCount: mbResults.equipment.length,
          model: modelUsed,
        },
        results: capexResult.results,
        overrides: {},
        locks: {},
      });

      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "CapEx",
        modelUsed,
        projectId: scenario.projectId,
        projectName: scenario.project?.name || null,
        scenarioId,
        scenarioName: scenario.name,
        durationMs,
        status: "success",
      }).catch(e => console.error("Failed to log generation:", e));

      res.json(estimate);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "CapEx",
        modelUsed,
        durationMs,
        status: "error",
        errorMessage: (error as any)?.message || "Unknown error",
      }).catch(e => console.error("Failed to log generation:", e));

      console.error("Error generating capex:", error);
      res.status(500).json({ error: `Failed to generate CapEx estimate: ${(error as Error).message}` });
    }
  });

  app.post("/api/capex/:id/recompute", async (req: Request, res: Response) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    const startTime = Date.now();
    let modelUsed = "unknown";

    try {
      const existing = await storage.getCapexEstimate((req.params.id as string));
      if (!existing) return res.status(404).json({ error: "CapEx estimate not found" });

      const scenario = await storage.getScenario(existing.scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });

      const mbRun = await storage.getMassBalanceRun(existing.massBalanceRunId);
      if (!mbRun) return res.status(400).json({ error: "Associated mass balance run not found" });

      const mbResults = mbRun.results as import("@shared/schema").MassBalanceResults;
      const upif = await storage.getUpifByScenario(existing.scenarioId);
      const upifData = upif ? {
        projectType: (upif as any).projectType,
        location: upif.location,
        feedstocks: upif.feedstocks,
        outputRequirements: upif.outputRequirements,
        constraints: upif.constraints,
      } : {} as any;

      const projectType = mbResults?.projectType || upifData.projectType || (scenario as any).projectType || "A";
      const preferredModel = (scenario.preferredModel || "gpt5") as import("./llm").LLMProvider;

      const normalizedPT = projectType.toLowerCase().replace(/type\s*/i, "").trim();
      const isRngType = ["b", "c", "d"].includes(normalizedPT) ||
        normalizedPT.includes("greenfield") || normalizedPT.includes("bolt") || normalizedPT.includes("hybrid");

      let capexResult: { results: import("@shared/schema").CapexResults; providerLabel: string };

      if (isRngType) {
        try {
          const { generateCapexDeterministic } = await import("./services/capexDeterministic");
          const { estimateUpstreamEquipmentCosts, getUncoveredEquipment } = await import("./services/capexAI");

          const uncoveredCount = getUncoveredEquipment(mbResults).length;
          let upstreamLineItems: import("@shared/schema").CapexLineItem[] = [];

          if (uncoveredCount > 0) {
            console.log(`CapEx recompute hybrid: ${uncoveredCount} upstream equipment items need AI estimation...`);
            const upstreamResult = await estimateUpstreamEquipmentCosts(upifData, mbResults, projectType, preferredModel, storage);
            upstreamLineItems = upstreamResult.lineItems;
          }

          const detResult = generateCapexDeterministic(mbResults, projectType, {
            upstreamEquipmentLineItems: upstreamLineItems,
          });
          capexResult = { results: detResult.results, providerLabel: detResult.providerLabel };
          modelUsed = detResult.providerLabel;
        } catch (detError) {
          console.log(`CapEx recompute: Hybrid failed (${(detError as Error).message}), falling back to full AI...`);
          const { generateCapexWithAI } = await import("./services/capexAI");
          const aiResult = await generateCapexWithAI(upifData, mbResults, projectType, preferredModel, storage);
          capexResult = { results: aiResult.results, providerLabel: aiResult.providerLabel };
          modelUsed = aiResult.providerLabel;
        }
      } else {
        const { generateCapexWithAI } = await import("./services/capexAI");
        const aiResult = await generateCapexWithAI(upifData, mbResults, projectType, preferredModel, storage);
        capexResult = { results: aiResult.results, providerLabel: aiResult.providerLabel };
        modelUsed = aiResult.providerLabel;
      }

      const oldLocks = (existing.locks || {}) as Record<string, boolean>;
      const oldOverrides = (existing.overrides || {}) as Record<string, any>;
      const newResults = capexResult.results;

      for (const [path, isLocked] of Object.entries(oldLocks)) {
        if (!isLocked) continue;
        const override = oldOverrides[path];
        if (!override) continue;

        const lineItemMatch = path.match(/^lineItems\.(.+?)\.(.+)$/);
        if (lineItemMatch) {
          const [, itemId, field] = lineItemMatch;
          const lineItem = newResults.lineItems.find(li => li.id === itemId || li.equipmentId === itemId);
          if (lineItem && field in lineItem) {
            const numVal = parseFloat(override.value);
            (lineItem as any)[field] = isNaN(numVal) ? override.value : numVal;
          }
        }

        const summaryMatch = path.match(/^summary\.(.+)$/);
        if (summaryMatch) {
          const [, field] = summaryMatch;
          if (field in newResults.summary) {
            const numVal = parseFloat(override.value);
            (newResults.summary as any)[field] = isNaN(numVal) ? override.value : numVal;
          }
        }
      }

      const updated = await storage.updateCapexEstimate(existing.id, {
        results: newResults,
        overrides: oldOverrides,
        locks: oldLocks,
        inputSnapshot: {
          ...(existing.inputSnapshot as any || {}),
          lastRecompute: new Date().toISOString(),
          model: modelUsed,
        },
      });

      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "CapEx",
        modelUsed,
        projectId: scenario.projectId,
        projectName: scenario.project?.name || null,
        scenarioId: existing.scenarioId,
        scenarioName: scenario.name,
        durationMs,
        status: "success",
      }).catch(e => console.error("Failed to log generation:", e));

      res.json(updated);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "CapEx",
        modelUsed,
        durationMs,
        status: "error",
        errorMessage: (error as any)?.message || "Unknown error",
      }).catch(e => console.error("Failed to log generation:", e));

      console.error("Error recomputing capex:", error);
      res.status(500).json({ error: `Failed to recompute CapEx: ${(error as Error).message}` });
    }
  });

  app.patch("/api/capex/:id", async (req: Request, res: Response) => {
    try {
      const existing = await storage.getCapexEstimate((req.params.id as string));
      if (!existing) return res.status(404).json({ error: "CapEx estimate not found" });

      const { results, overrides, locks, status } = req.body;
      const updates: any = {};

      if (results !== undefined) updates.results = results;
      if (overrides !== undefined) updates.overrides = overrides;
      if (locks !== undefined) updates.locks = locks;
      if (status !== undefined) {
        const validStatuses = ["draft", "reviewed", "finalized"];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ error: `Invalid status. Must be: ${validStatuses.join(", ")}` });
        }
        updates.status = status;
      }

      const updated = await storage.updateCapexEstimate((req.params.id as string), updates);
      res.json(updated);
    } catch (error) {
      console.error("Error updating capex:", error);
      res.status(500).json({ error: "Failed to update CapEx estimate" });
    }
  });

  // =========================================================================
  // CapEx Export (PDF & Excel)
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/capex/export-pdf", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const estimates = await storage.getCapexEstimatesByScenario(scenarioId);
      const latestEstimate = estimates?.[0];
      if (!latestEstimate?.results) return res.status(404).json({ error: "No CapEx data found" });
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });
      const results = latestEstimate.results as CapexResults;
      const projectType = results.projectType || (scenario as any).projectType || "B";
      const pdfBuffer = await exportCapexPDF(results, scenario.name, scenario.project?.name || "Project", projectType);
      const safeName = (scenario.name || "capex").replace(/[^a-zA-Z0-9_-]/g, "_");
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="CapEx-${safeName}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error exporting CapEx PDF:", error);
      res.status(500).json({ error: "Failed to export CapEx PDF" });
    }
  });

  app.get("/api/scenarios/:scenarioId/capex/export-excel", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const estimates = await storage.getCapexEstimatesByScenario(scenarioId);
      const latestEstimate = estimates?.[0];
      if (!latestEstimate?.results) return res.status(404).json({ error: "No CapEx data found" });
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });
      const results = latestEstimate.results as CapexResults;
      const projectType = results.projectType || (scenario as any).projectType || "B";
      const xlsxBuffer = await exportCapexExcel(results, scenario.name, scenario.project?.name || "Project", projectType);
      const safeName = (scenario.name || "capex").replace(/[^a-zA-Z0-9_-]/g, "_");
      res.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="CapEx-${safeName}.xlsx"`,
        "Content-Length": xlsxBuffer.length.toString(),
      });
      res.send(xlsxBuffer);
    } catch (error) {
      console.error("Error exporting CapEx Excel:", error);
      res.status(500).json({ error: "Failed to export CapEx Excel" });
    }
  });

  // =========================================================================
  // OpEx Estimates
  // =========================================================================

  app.get("/api/scenarios/:scenarioId/opex", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const estimates = await storage.getOpexEstimatesByScenario(scenarioId);
      res.json(estimates);
    } catch (error) {
      console.error("Error fetching OpEx estimates:", error);
      res.status(500).json({ error: "Failed to fetch OpEx estimates" });
    }
  });

  app.post("/api/scenarios/:scenarioId/opex/generate", async (req: Request, res: Response) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    const startTime = Date.now();
    let modelUsed = "unknown";
    const scenarioId = (req.params.scenarioId as string);

    try {
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });

      const mbRuns = await storage.getMassBalanceRunsByScenario(scenarioId);
      const latestMB = mbRuns[0];
      if (!latestMB) {
        return res.status(400).json({ error: "No mass balance found. Generate and finalize a mass balance first." });
      }
      if (latestMB.status !== "finalized") {
        return res.status(400).json({ error: "Mass balance must be finalized before generating OpEx." });
      }

      const mbResults = latestMB.results as MassBalanceResults;
      if (!mbResults || !mbResults.equipment || mbResults.equipment.length === 0) {
        return res.status(400).json({ error: "Mass balance has no equipment list. Cannot generate OpEx." });
      }

      const capexEstimates = await storage.getCapexEstimatesByScenario(scenarioId);
      const latestCapex = capexEstimates[0];
      const capexResults = latestCapex?.results as CapexResults | null;

      const upif = await storage.getUpifByScenario(scenarioId);
      const upifData = upif ? {
        projectType: (upif as any).projectType,
        location: upif.location,
        feedstocks: upif.feedstocks,
        outputRequirements: upif.outputRequirements,
        constraints: upif.constraints,
      } : {} as any;

      const projectType = mbResults.projectType || upifData.projectType || (scenario as any).projectType || "A";
      const preferredModel = (scenario.preferredModel || "gpt5") as import("./llm").LLMProvider;

      const { generateOpexWithAI } = await import("./services/opexAI");
      const aiResult = await generateOpexWithAI(upifData, mbResults, capexResults, projectType, preferredModel, storage);
      modelUsed = aiResult.providerLabel;

      const existingEstimates = await storage.getOpexEstimatesByScenario(scenarioId);
      const version = String(existingEstimates.length + 1);

      const estimate = await storage.createOpexEstimate({
        scenarioId,
        massBalanceRunId: latestMB.id,
        capexEstimateId: latestCapex?.id || null,
        version,
        status: "draft",
        inputSnapshot: {
          massBalanceId: latestMB.id,
          massBalanceVersion: latestMB.version,
          capexEstimateId: latestCapex?.id || null,
          projectType,
          equipmentCount: mbResults.equipment.length,
          model: modelUsed,
        },
        results: aiResult.results,
        overrides: {},
        locks: {},
      });

      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "OpEx",
        modelUsed,
        projectId: scenario.projectId,
        projectName: scenario.project?.name || null,
        scenarioId,
        scenarioName: scenario.name,
        durationMs,
        status: "success",
      }).catch(e => console.error("Failed to log generation:", e));

      res.json(estimate);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "OpEx",
        modelUsed,
        durationMs,
        status: "error",
        errorMessage: (error as any)?.message || "Unknown error",
      }).catch(e => console.error("Failed to log generation:", e));

      console.error("Error generating opex:", error);
      res.status(500).json({ error: `Failed to generate OpEx estimate: ${(error as Error).message}` });
    }
  });

  app.patch("/api/opex/:id", async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const updates = req.body;
      const updated = await storage.updateOpexEstimate(id, updates);
      if (!updated) return res.status(404).json({ error: "OpEx estimate not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating OpEx estimate:", error);
      res.status(500).json({ error: "Failed to update OpEx estimate" });
    }
  });

  app.post("/api/opex/:id/recompute", async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const estimate = await storage.getOpexEstimate(id);
      if (!estimate) return res.status(404).json({ error: "OpEx estimate not found" });

      const results = estimate.results as OpexResults;
      if (!results) return res.status(400).json({ error: "No OpEx results to recompute" });

      const { editableAssumptions: rawAssumptions } = req.body;
      if (!rawAssumptions || !Array.isArray(rawAssumptions)) {
        return res.status(400).json({ error: "editableAssumptions array is required" });
      }

      const validatedAssumptions: import("@shared/schema").OpexEditableAssumption[] = [];
      for (const item of rawAssumptions) {
        if (!item || typeof item !== "object" || !item.key || typeof item.key !== "string") {
          return res.status(400).json({ error: `Invalid assumption: missing or invalid 'key'` });
        }
        const numVal = typeof item.value === "number" ? item.value : parseFloat(String(item.value));
        if (isNaN(numVal) || !isFinite(numVal)) {
          return res.status(400).json({ error: `Invalid numeric value for assumption '${item.key}'` });
        }
        if (numVal < 0) {
          return res.status(400).json({ error: `Negative value not allowed for assumption '${item.key}'` });
        }
        validatedAssumptions.push({
          key: String(item.key),
          parameter: String(item.parameter || ""),
          value: numVal,
          unit: String(item.unit || ""),
          source: String(item.source || "User override"),
          category: String(item.category || "Other"),
          description: item.description ? String(item.description) : undefined,
        });
      }

      const mbRun = await storage.getMassBalanceRun(estimate.massBalanceRunId);
      const mbResults = mbRun ? (mbRun.results as MassBalanceResults) : ({ summary: {}, equipment: [], assumptions: [], projectType: results.projectType || "B", stages: [], recycleStreams: [], convergenceIterations: 0, convergenceAchieved: true, warnings: [] } as unknown as MassBalanceResults);

      let capexResults: CapexResults | null = null;
      if (estimate.capexEstimateId) {
        const capexEst = await storage.getCapexEstimate(estimate.capexEstimateId);
        if (capexEst) capexResults = capexEst.results as CapexResults;
      }

      const scenario = await storage.getScenario(estimate.scenarioId);
      const projectType = results.projectType || (scenario as any)?.projectType || "B";

      const { recomputeOpexFromAssumptions } = await import("./services/opexAI");
      const updatedResults = recomputeOpexFromAssumptions(
        validatedAssumptions,
        mbResults,
        capexResults,
        projectType,
        results,
      );

      const updated = await storage.updateOpexEstimate(id, {
        results: updatedResults,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error recomputing OpEx:", error);
      res.status(500).json({ error: `Failed to recompute OpEx: ${(error as Error).message}` });
    }
  });

  app.get("/api/scenarios/:scenarioId/opex/export-pdf", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const estimates = await storage.getOpexEstimatesByScenario(scenarioId);
      const latestEstimate = estimates?.[0];
      if (!latestEstimate?.results) return res.status(404).json({ error: "No OpEx data found" });
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });
      const results = latestEstimate.results as OpexResults;
      const projectType = results.projectType || (scenario as any).projectType || "B";
      const pdfBuffer = await exportOpexPDF(results, scenario.name, scenario.project?.name || "Project", projectType);
      const safeName = (scenario.name || "opex").replace(/[^a-zA-Z0-9_-]/g, "_");
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="OpEx-${safeName}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      });
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error exporting OpEx PDF:", error);
      res.status(500).json({ error: "Failed to export OpEx PDF" });
    }
  });

  app.get("/api/scenarios/:scenarioId/opex/export-excel", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const estimates = await storage.getOpexEstimatesByScenario(scenarioId);
      const latestEstimate = estimates?.[0];
      if (!latestEstimate?.results) return res.status(404).json({ error: "No OpEx data found" });
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });
      const results = latestEstimate.results as OpexResults;
      const projectType = results.projectType || (scenario as any).projectType || "B";
      const xlsxBuffer = exportOpexExcel(results, scenario.name, scenario.project?.name || "Project", projectType);
      const safeName = (scenario.name || "opex").replace(/[^a-zA-Z0-9_-]/g, "_");
      res.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="OpEx-${safeName}.xlsx"`,
        "Content-Length": xlsxBuffer.length.toString(),
      });
      res.send(xlsxBuffer);
    } catch (error) {
      console.error("Error exporting OpEx Excel:", error);
      res.status(500).json({ error: "Failed to export OpEx Excel" });
    }
  });

  // =========================================================================
  // Generation Stats
  // =========================================================================

  app.get("/api/generation-stats", async (_req: Request, res: Response) => {
    try {
      const logs = await storage.getAllGenerationLogs();
      res.json(logs);
    } catch (error) {
      console.error("Error fetching generation stats:", error);
      res.status(500).json({ error: "Failed to fetch generation stats" });
    }
  });

  // ========================================================================
  // PROJECT SUMMARY EXPORT ROUTE
  // ========================================================================

  app.get("/api/scenarios/:scenarioId/project-summary", async (req: Request, res: Response) => {
    try {
      const scenarioId = req.params.scenarioId as string;
      const mode = (req.query.mode as string) === "full" ? "full" : "executive";

      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });

      const upif = await storage.getUpifByScenario(scenarioId);
      if (!upif) return res.status(400).json({ error: "UPIF not found" });

      const mbRuns = await storage.getMassBalanceRunsByScenario(scenarioId);
      const latestMB = mbRuns[0];
      if (!latestMB) {
        return res.status(400).json({ error: "Mass balance must be generated first." });
      }

      const capexEstimates = await storage.getCapexEstimatesByScenario(scenarioId);
      const latestCapex = capexEstimates[0];
      if (!latestCapex) {
        return res.status(400).json({ error: "CapEx estimate must be generated first." });
      }

      const opexEstimates = await storage.getOpexEstimatesByScenario(scenarioId);
      const latestOpex = opexEstimates[0];
      if (!latestOpex) {
        return res.status(400).json({ error: "OpEx estimate must be generated first." });
      }

      const financialModels = await storage.getFinancialModelsByScenario(scenarioId);
      const latestFM = financialModels[0];
      if (!latestFM || !latestFM.results) {
        return res.status(400).json({ error: "Financial model must be generated first." });
      }

      const projectType = (scenario as any).projectType || (upif as any).projectType || "B";
      const projectName = (scenario as any).project?.name || "Project";

      const pdfBuffer = await exportProjectSummaryPDF(
        mode as "executive" | "full",
        projectName,
        scenario.name,
        projectType,
        upif,
        latestMB.results as MassBalanceResults,
        latestCapex.results as CapexResults,
        latestOpex.results as OpexResults,
        latestFM.results as any,
      );

      const fileName = `Project_Summary_${mode === "full" ? "Full" : "Executive"}_${scenario.name.replace(/\s+/g, "_")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error exporting project summary:", error);
      res.status(500).json({ error: "Failed to export project summary" });
    }
  });

  // ========================================================================
  // FINANCIAL MODEL ROUTES
  // ========================================================================

  app.get("/api/scenarios/:scenarioId/financial-model", async (req: Request, res: Response) => {
    try {
      const models = await storage.getFinancialModelsByScenario(req.params.scenarioId as string);
      res.json(models);
    } catch (error) {
      console.error("Error fetching financial models:", error);
      res.status(500).json({ error: "Failed to fetch financial models" });
    }
  });

  app.get("/api/financial-model/:id", async (req: Request, res: Response) => {
    try {
      const model = await storage.getFinancialModel(req.params.id as string);
      if (!model) return res.status(404).json({ error: "Financial model not found" });
      res.json(model);
    } catch (error) {
      console.error("Error fetching financial model:", error);
      res.status(500).json({ error: "Failed to fetch financial model" });
    }
  });

  app.post("/api/scenarios/:scenarioId/financial-model/generate", async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      const scenarioId = req.params.scenarioId as string;
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Scenario not found" });

      const upif = await storage.getUpifByScenario(scenarioId);
      if (!upif) return res.status(400).json({ error: "No UPIF found for this scenario." });

      const mbRuns = await storage.getMassBalanceRunsByScenario(scenarioId);
      const latestMB = mbRuns[0];
      if (!latestMB) {
        return res.status(400).json({ error: "Mass balance must be generated first." });
      }

      const capexEstimates = await storage.getCapexEstimatesByScenario(scenarioId);
      const latestCapex = capexEstimates[0];
      if (!latestCapex) {
        return res.status(400).json({ error: "CapEx estimate must be generated first." });
      }

      const opexEstimates = await storage.getOpexEstimatesByScenario(scenarioId);
      const latestOpex = opexEstimates[0];
      if (!latestOpex) {
        return res.status(400).json({ error: "OpEx estimate must be generated first." });
      }

      const mbResults = latestMB.results as MassBalanceResults;
      const capexResults = latestCapex.results as CapexResults;
      const opexResults = latestOpex.results as OpexResults;

      const { buildDefaultAssumptions, calculateFinancialModel } = await import("./services/financialModel");
      const feedstocks = (upif as any).feedstocks || [];
      const assumptions = buildDefaultAssumptions(mbResults, opexResults, feedstocks);
      const results = calculateFinancialModel(assumptions, mbResults, capexResults, opexResults);

      const existingModels = await storage.getFinancialModelsByScenario(scenarioId);
      const nextVersion = String(existingModels.length + 1);

      const model = await storage.createFinancialModel({
        scenarioId,
        massBalanceRunId: latestMB.id,
        capexEstimateId: latestCapex.id,
        opexEstimateId: latestOpex.id,
        version: nextVersion,
        status: "draft",
        assumptions,
        results,
      });

      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "Financial Model",
        modelUsed: "deterministic",
        projectId: scenario.projectId,
        projectName: scenario.project?.name || null,
        scenarioId,
        scenarioName: scenario.name,
        durationMs,
        status: "success",
      }).catch(e => console.error("Failed to log generation:", e));

      res.json(model);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      storage.createGenerationLog({
        documentType: "Financial Model",
        modelUsed: "deterministic",
        durationMs,
        status: "error",
        errorMessage: (error as any)?.message || "Unknown error",
      }).catch(e => console.error("Failed to log generation:", e));
      console.error("Error generating financial model:", error);
      res.status(500).json({ error: "Failed to generate financial model" });
    }
  });

  app.patch("/api/financial-model/:id/assumptions", async (req: Request, res: Response) => {
    try {
      const model = await storage.getFinancialModel(req.params.id as string);
      if (!model) return res.status(404).json({ error: "Financial model not found" });
      if (model.status === "finalized") return res.status(400).json({ error: "Cannot edit a finalized financial model." });

      const updatedAssumptions = req.body.assumptions;
      if (!updatedAssumptions || typeof updatedAssumptions !== "object") {
        return res.status(400).json({ error: "No assumptions provided" });
      }

      const requiredNumericFields = [
        "inflationRate", "projectLifeYears", "constructionMonths", "uptimePct",
        "biogasGrowthRate", "rngPricePerMMBtu", "rngPriceEscalator", "rinPricePerRIN",
        "rinPriceEscalator", "rinBrokeragePct", "rinPerMMBtu", "natGasPricePerMMBtu",
        "natGasPriceEscalator", "wheelHubCostPerMMBtu", "electricityCostPerKWh",
        "electricityEscalator", "gasCostPerMMBtu", "gasCostEscalator", "itcRate",
        "itcMonetizationPct", "maintenanceCapexPct", "discountRate",
      ];
      for (const field of requiredNumericFields) {
        if (typeof updatedAssumptions[field] !== "number" || isNaN(updatedAssumptions[field])) {
          return res.status(400).json({ error: `Invalid value for ${field}` });
        }
      }
      if (!Number.isInteger(updatedAssumptions.projectLifeYears) || updatedAssumptions.projectLifeYears < 1 || updatedAssumptions.projectLifeYears > 30) {
        return res.status(400).json({ error: "Project life must be between 1 and 30 years" });
      }

      const existingAssumptions = (model.results as any)?.assumptions || model.assumptions;
      if (existingAssumptions) {
        updatedAssumptions.rinPerMMBtu = existingAssumptions.rinPerMMBtu ?? 11.727;
        if (updatedAssumptions.fortyFiveZ) {
          updatedAssumptions.fortyFiveZ.targetCI = existingAssumptions.fortyFiveZ?.targetCI ?? 50;
          updatedAssumptions.fortyFiveZ.conversionGalPerMMBtu = existingAssumptions.fortyFiveZ?.conversionGalPerMMBtu ?? 8.614;
        }
      }

      if (updatedAssumptions.feedstockCosts && Array.isArray(updatedAssumptions.feedstockCosts)) {
        updatedAssumptions.feedstockCosts = updatedAssumptions.feedstockCosts.map((fc: any) => ({
          feedstockName: fc.feedstockName || "Unknown",
          costType: fc.costType || (fc.costPerTon > 0 ? "cost" : "tip_fee"),
          unitRate: fc.unitRate ?? fc.costPerTon ?? 0,
          unitBasis: fc.unitBasis || "$/ton",
          annualTons: fc.annualTons || 0,
          escalator: fc.escalator ?? 0.025,
          costPerTon: fc.costPerTon ?? fc.unitRate ?? 0,
        }));
      }

      const mbRun = await storage.getMassBalanceRun(model.massBalanceRunId);
      if (!mbRun) return res.status(400).json({ error: "Associated mass balance not found" });

      let capexResults: CapexResults | null = null;
      let opexResults: OpexResults | null = null;
      if (model.capexEstimateId) {
        const capex = await storage.getCapexEstimate(model.capexEstimateId);
        if (capex) capexResults = capex.results as CapexResults;
      }
      if (model.opexEstimateId) {
        const opex = await storage.getOpexEstimate(model.opexEstimateId);
        if (opex) opexResults = opex.results as OpexResults;
      }
      if (!capexResults || !opexResults) {
        return res.status(400).json({ error: "CapEx or OpEx data not found" });
      }

      const { calculateFinancialModel } = await import("./services/financialModel");
      const mbResults = mbRun.results as MassBalanceResults;
      const results = calculateFinancialModel(updatedAssumptions, mbResults, capexResults, opexResults);

      const updated = await storage.updateFinancialModel(req.params.id as string, {
        assumptions: updatedAssumptions,
        results,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error updating financial model assumptions:", error);
      res.status(500).json({ error: "Failed to update financial model" });
    }
  });

  app.patch("/api/financial-model/:id/status", async (req: Request, res: Response) => {
    try {
      const model = await storage.getFinancialModel(req.params.id as string);
      if (!model) return res.status(404).json({ error: "Financial model not found" });

      const { status } = req.body;
      if (!["draft", "finalized"].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'draft' or 'finalized'." });
      }

      const updated = await storage.updateFinancialModel(req.params.id as string, { status });
      res.json(updated);
    } catch (error) {
      console.error("Error updating financial model status:", error);
      res.status(500).json({ error: "Failed to update financial model status" });
    }
  });

  const calculatorFiles: Record<string, { file: string; label: string; type: string; description: string }> = {
    A: { file: "server/services/massBalance.ts", label: "Type A: Wastewater Treatment", type: "A", description: "High-strength industrial wastewater from food processing (dairy, meat, potato, beverage, produce, etc.). Treats influent to meet effluent discharge standards. RNG may be a byproduct when organic loading justifies it." },
    B: { file: "server/services/massBalanceTypeB.ts", label: "Type B: RNG Greenfield", type: "B", description: "Full anaerobic digestion pipeline from feedstock receiving through RNG production. Handles solid and semi-solid organic feedstocks (food waste, crop residuals). Complete process train: receiving, pretreatment, digestion, gas conditioning, upgrading." },
    C: { file: "server/services/massBalanceTypeC.ts", label: "Type C: RNG Bolt-On", type: "C", description: "Biogas-only inputs. An existing facility already produces biogas; this project adds gas conditioning and upgrading equipment to convert raw biogas to pipeline-quality RNG. No digester sizing needed." },
    D: { file: "server/services/massBalanceTypeD.ts", label: "Type D: Hybrid", type: "D", description: "Combines wastewater treatment (Type A) with co-digestion from trucked organic feedstocks for additional gas production and RNG production. Wastewater is treated, biogas is upgraded to RNG." },
  };

  app.get("/api/calculators", (_req: Request, res: Response) => {
    res.json(Object.entries(calculatorFiles).map(([key, val]) => ({ key, ...val })));
  });

  app.get("/api/calculators/:type", async (req: Request, res: Response) => {
    const type = (req.params.type as string).toUpperCase();
    const calc = calculatorFiles[type];
    if (!calc) {
      return res.status(404).json({ error: "Calculator not found" });
    }
    try {
      const filePath = path.resolve(calc.file);
      const source = await fs.promises.readFile(filePath, "utf-8");
      res.json({ ...calc, key: type, source, lineCount: source.split("\n").length });
    } catch (error) {
      console.error(`Error reading calculator file ${calc.file}:`, error);
      res.status(500).json({ error: "Failed to read calculator source" });
    }
  });

  return httpServer;
}
