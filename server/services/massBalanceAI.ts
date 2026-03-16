/**
 * Mass Balance AI Service
 *
 * Generates process mass balances for all 4 project types. The generation strategy
 * depends on project type:
 *
 *   Type A (Wastewater): Full AI generation via LLM — uses customizable prompt templates
 *     to generate process stages (screening, EQ, primary clarification, aeration, etc.),
 *     equipment lists, and summary. AI path uses parallel split (stages+summary vs equipment
 *     list) for ~40% faster wall time, with monolithic fallback if parallel fails.
 *
 *   Types B/C/D (RNG): Deterministic calculator first (massBalanceDeterministic.ts) —
 *     uses BMP-based biogas calculation per feedstock. Falls back to AI only if
 *     deterministic calculation fails. No AI fallback for normal operation.
 *
 * Post-generation enforcement:
 *   enforceProdevalEquipment — validates that AI-generated equipment lists include
 *   required Prodeval VALOGAZ/VALOPACK/VALOPUR gas train components for RNG projects.
 *   Missing components are injected from the prodeval-equipment-library based on
 *   estimated biogas flow (SCFM).
 *
 * JSON resilience:
 *   repairTruncatedJSON — iteratively closes unclosed brackets/braces on truncated LLM
 *   responses (up to 20 attempts). This handles the common case where the LLM hits
 *   max_tokens mid-JSON-output.
 */

import { llmComplete, isProviderAvailable, getAvailableProviders, providerLabels, type LLMProvider } from "../llm";
import type { MassBalanceResults, EquipmentItem } from "@shared/schema";
import type { PromptKey } from "@shared/default-prompts";
import { DEFAULT_PROMPTS } from "@shared/default-prompts";
import {
  selectProdevalUnit,
  getProdevalEquipmentList,
  type ProdevalEquipmentItem,
} from "@shared/prodeval-equipment-library";
import { generateDeterministicMassBalance } from "./massBalanceDeterministic";

/** Maps normalized project type letter to the corresponding prompt template key in the database/defaults */
const massBalancePromptMap: Record<string, PromptKey> = {
  a: "mass_balance_type_a",
  b: "mass_balance_type_b",
  c: "mass_balance_type_c",
  d: "mass_balance_type_d",
};

/**
 * Normalizes user-facing project type strings to single-letter codes (a/b/c/d).
 * Handles both short forms ("A", "b") and full names ("Type B", "Greenfield", "Bolt-On").
 * Defaults to "a" (wastewater) for unrecognized types.
 */
function normalizeProjectType(projectType: string): string {
  const pt = projectType.toLowerCase().trim();
  if (pt.includes("type a") || pt.includes("wastewater") || pt === "a") return "a";
  if (pt.includes("type b") || pt.includes("greenfield") || pt === "b") return "b";
  if (pt.includes("type c") || pt.includes("bolt-on") || pt.includes("bolt on") || pt === "c") return "c";
  if (pt.includes("type d") || pt.includes("hybrid") || pt === "d") return "d";
  return "a";
}

/**
 * Serializes UPIF data into a structured text format for inclusion in LLM prompts.
 * Includes project type, location, all feedstock specs with values/units, output
 * specifications grouped by profile, and constraints. This becomes the {{UPIF_DATA}}
 * placeholder replacement in the prompt template.
 */
function buildUpifDataString(upif: any): string {
  const sections: string[] = [];

  if (upif.projectType) {
    sections.push(`Project Type: ${upif.projectType}`);
  }

  if (upif.location) {
    sections.push(`Location: ${upif.location}`);
  }

  if (upif.feedstocks && Array.isArray(upif.feedstocks) && upif.feedstocks.length > 0) {
    const feedstockLines = upif.feedstocks.map((f: any, i: number) => {
      const parts: string[] = [];
      parts.push(`Feedstock ${i + 1}: ${f.feedstockType || "Unknown"}`);
      if (f.feedstockVolume) parts.push(`  Volume: ${f.feedstockVolume} ${f.feedstockUnit || ""}`);
      if (f.feedstockSpecs && typeof f.feedstockSpecs === "object") {
        for (const [key, spec] of Object.entries(f.feedstockSpecs as Record<string, any>)) {
          if (spec && spec.value !== undefined && spec.value !== null && spec.value !== "") {
            parts.push(`  ${key}: ${spec.value} ${spec.unit || ""}`);
          }
        }
      }
      return parts.join("\n");
    });
    sections.push("FEEDSTOCKS/INFLUENTS:\n" + feedstockLines.join("\n\n"));
  }

  if (upif.outputRequirements) {
    sections.push(`Output Requirements: ${upif.outputRequirements}`);
  }

  if (upif.outputSpecs && typeof upif.outputSpecs === "object") {
    const specLines: string[] = [];
    for (const [group, specs] of Object.entries(upif.outputSpecs as Record<string, any>)) {
      if (specs && typeof specs === "object") {
        for (const [key, spec] of Object.entries(specs as Record<string, any>)) {
          if (spec && spec.value !== undefined && spec.value !== null && spec.value !== "") {
            specLines.push(`  ${group} > ${spec.displayName || key}: ${spec.value} ${spec.unit || ""}`);
          }
        }
      }
    }
    if (specLines.length > 0) {
      sections.push("OUTPUT SPECIFICATIONS:\n" + specLines.join("\n"));
    }
  }

  if (upif.constraints && Array.isArray(upif.constraints) && upif.constraints.length > 0) {
    sections.push("Constraints:\n" + upif.constraints.map((c: string) => `  - ${c}`).join("\n"));
  }

  return sections.join("\n\n");
}

/**
 * Retrieves prompt template from database (user-customized) or falls back to built-in defaults.
 * This allows users to modify mass balance prompts via the Documentation page without
 * code changes. Falls back silently to DEFAULT_PROMPTS if database lookup fails.
 */
async function getPromptTemplate(key: PromptKey, storage?: any): Promise<string> {
  if (storage && typeof storage.getPromptTemplateByKey === "function") {
    try {
      const dbTemplate = await storage.getPromptTemplateByKey(key);
      if (dbTemplate) return dbTemplate.template;
    } catch (e) {
    }
  }
  return DEFAULT_PROMPTS[key].template;
}

/**
 * Validates and normalizes parsed LLM output into the MassBalanceResults schema.
 * Ensures all required fields exist with proper defaults — LLM output is unpredictable,
 * so this acts as a defensive normalization layer. Adds missing influent/effluent objects
 * to stages, missing inputStream/outputStream to AD stages, and generates random IDs
 * for equipment items that lack them.
 */
function validateMassBalanceResults(parsed: any): MassBalanceResults {
  const results: MassBalanceResults = {
    projectType: parsed.projectType || "A",
    stages: Array.isArray(parsed.stages) ? parsed.stages : [],
    adStages: Array.isArray(parsed.adStages) ? parsed.adStages : [],
    recycleStreams: Array.isArray(parsed.recycleStreams) ? parsed.recycleStreams : [],
    equipment: Array.isArray(parsed.equipment) ? parsed.equipment : [],
    convergenceIterations: typeof parsed.convergenceIterations === "number" ? parsed.convergenceIterations : 1,
    convergenceAchieved: typeof parsed.convergenceAchieved === "boolean" ? parsed.convergenceAchieved : true,
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    summary: parsed.summary && typeof parsed.summary === "object" ? parsed.summary : {},
  };

  for (const stage of results.stages) {
    if (!stage.influent) stage.influent = { flow: 0, bod: 0, cod: 0, tss: 0, tkn: 0, tp: 0, fog: 0, unit: "mg/L" };
    if (!stage.effluent) stage.effluent = { flow: 0, bod: 0, cod: 0, tss: 0, tkn: 0, tp: 0, fog: 0, unit: "mg/L" };
    if (!stage.removalEfficiencies) stage.removalEfficiencies = {};
    if (!stage.designCriteria) stage.designCriteria = {};
    if (!stage.notes) stage.notes = [];
  }

  for (const stage of (results.adStages || [])) {
    if (!stage.inputStream) stage.inputStream = {};
    if (!stage.outputStream) stage.outputStream = {};
    if (!stage.designCriteria) stage.designCriteria = {};
    if (!stage.notes) stage.notes = [];
  }

  for (const eq of results.equipment) {
    if (!eq.id) eq.id = `equip-${Math.random().toString(36).substring(2, 8)}`;
    if (!eq.specs) eq.specs = {};
    if (eq.isOverridden === undefined) eq.isOverridden = false;
    if (eq.isLocked === undefined) eq.isLocked = false;
  }

  return results;
}

/**
 * Attempts to repair truncated JSON from LLM responses that hit max_tokens.
 * Strategy: iteratively strip trailing commas and append missing closing brackets/braces
 * until bracket counts balance. Up to 20 repair attempts before giving up.
 * This is critical for large mass balance outputs that may exceed token limits.
 */
function repairTruncatedJSON(raw: string): any {
  let s = raw.trim();
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i++) {
    const openBraces = (s.match(/\{/g) || []).length;
    const closeBraces = (s.match(/\}/g) || []).length;
    const openBrackets = (s.match(/\[/g) || []).length;
    const closeBrackets = (s.match(/\]/g) || []).length;

    if (openBraces === closeBraces && openBrackets === closeBrackets) {
      break;
    }

    s = s.replace(/,\s*$/, "");

    if (openBrackets > closeBrackets) {
      s += "]";
    } else if (openBraces > closeBraces) {
      s += "}";
    } else {
      break;
    }
  }

  return JSON.parse(s);
}

const RNG_PROJECT_TYPES = new Set(["b", "c", "d"]);

/**
 * Keywords used to identify Prodeval gas upgrading equipment in AI-generated equipment lists.
 * Includes brand names (Prodeval, VALOGAZ, VALOPACK, VALOPUR) and functional unit codes
 * (FU 100-800) from Prodeval's product line.
 */
const PRODEVAL_EQUIPMENT_IDENTIFIERS = [
  "prodeval",
  "valogaz",
  "valopack",
  "valopur",
  "fu 100",
  "fu 200",
  "fu 300",
  "fu 500",
  "fu 800",
];

/**
 * Extracts the biogas flow rate (SCFM) from mass balance results for Prodeval unit sizing.
 * Searches in priority order: (1) AD stage output streams, (2) digester equipment specs,
 * (3) summary fields. Handles SCFM/SCFH/SCFD unit conversion.
 * Returns 300 SCFM as a safe fallback if no biogas flow is found — this is the minimum
 * Prodeval unit size (400 SCFM tier handles flows from ~250 SCFM).
 */
function extractBiogasScfmFromResults(results: MassBalanceResults): number {
  for (const stage of (results.adStages || [])) {
    const output = stage.outputStream || {};
    for (const [key, spec] of Object.entries(output)) {
      const keyLower = key.toLowerCase();
      if (
        (keyLower.includes("biogas") && keyLower.includes("flow")) ||
        keyLower === "biogasflow" ||
        keyLower === "biogasproduction"
      ) {
        const val = typeof spec === "object" && spec !== null ? (spec as any).value : spec;
        const numVal = typeof val === "number" ? val : parseFloat(String(val).replace(/,/g, ""));
        if (!isNaN(numVal) && numVal > 0) {
          const unit = typeof spec === "object" && spec !== null ? ((spec as any).unit || "").toLowerCase() : "";
          if (unit.includes("scfm")) return numVal;
          if (unit.includes("scfh")) return numVal / 60;
          if (unit.includes("scfd") || unit.includes("day")) return numVal / 1440;
          return numVal;
        }
      }
    }
  }

  for (const eq of (results.equipment || [])) {
    const typeLower = (eq.equipmentType || "").toLowerCase();
    const descLower = (eq.description || "").toLowerCase();
    if (typeLower.includes("digester") || descLower.includes("digester") || descLower.includes("anaerobic")) {
      for (const [key, spec] of Object.entries(eq.specs || {})) {
        const keyLower = key.toLowerCase();
        if (keyLower.includes("biogas") && (keyLower.includes("flow") || keyLower.includes("production"))) {
          const numVal = parseFloat(String(spec.value).replace(/,/g, ""));
          if (!isNaN(numVal) && numVal > 0) {
            const unit = (spec.unit || "").toLowerCase();
            if (unit.includes("scfm")) return numVal;
            if (unit.includes("scfh")) return numVal / 60;
            if (unit.includes("scfd") || unit.includes("day")) return numVal / 1440;
            return numVal;
          }
        }
      }
    }
  }

  if (results.summary) {
    for (const [key, val] of Object.entries(results.summary)) {
      const keyLower = key.toLowerCase();
      if (keyLower.includes("biogas") && (keyLower.includes("flow") || keyLower.includes("scfm"))) {
        const parsed = typeof val === "object" && val !== null
          ? parseFloat(String((val as any).value).replace(/,/g, ""))
          : parseFloat(String(val).replace(/,/g, ""));
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
  }

  return 300;
}

function isProdevalEquipment(eq: EquipmentItem): boolean {
  const searchText = `${eq.equipmentType} ${eq.description} ${eq.process}`.toLowerCase();
  return PRODEVAL_EQUIPMENT_IDENTIFIERS.some(id => searchText.includes(id));
}

/**
 * Post-generation enforcement: ensures RNG projects (B/C/D) include all required Prodeval
 * gas upgrading equipment. If the AI omitted any of the 9 required component categories
 * (condenser, blower, AC filter, dust filter, mixing bottle, biogas compressor, HP filtration,
 * membrane system, RNG compressor), this function:
 *   1. Removes any non-Prodeval gas train equipment the AI may have hallucinated
 *   2. Injects missing Prodeval components from the prodeval-equipment-library
 *   3. Sizes them based on estimated biogas flow (SCFM)
 *   4. Places them before flare/thermal oxidizer in the equipment list
 */
function enforceProdevalEquipment(
  results: MassBalanceResults,
  normalizedType: string,
): { results: MassBalanceResults; corrections: string[] } {
  if (!RNG_PROJECT_TYPES.has(normalizedType)) {
    return { results, corrections: [] };
  }

  const corrections: string[] = [];
  const existingProdeval = results.equipment.filter(isProdevalEquipment);

  const requiredCategories = [
    { keyword: "condenser", label: "VALOGAZ® Condenser (FU 100)" },
    { keyword: "blower", label: "VALOGAZ® Blower (FU 200)" },
    { keyword: "activated carbon", label: "VALOPACK® AC Filter (FU 300)" },
    { keyword: "dust filter", label: "Dust Filter" },
    { keyword: "mixing bottle", label: "VALOPUR® Mixing Bottle (FU 500)" },
    { keyword: "biogas compressor", label: "VALOPUR® Biogas Compressor (FU 500)" },
    { keyword: "hp filtration", label: "VALOPUR® HP Filtration (FU 800)" },
    { keyword: "membrane", label: "VALOPUR® Membrane System (FU 500)" },
    { keyword: "rng compressor", label: "VALOPUR® RNG Compressor (FU 800)" },
  ];

  const missingCategories: string[] = [];
  for (const cat of requiredCategories) {
    const found = existingProdeval.some(eq => {
      const text = `${eq.equipmentType} ${eq.description}`.toLowerCase();
      return text.includes(cat.keyword);
    });
    if (!found) {
      missingCategories.push(cat.label);
    }
  }

  if (missingCategories.length === 0) {
    console.log("Prodeval Validation: All required Prodeval gas train equipment present in AI output");
    return { results, corrections: [] };
  }

  console.log(`Prodeval Validation: Missing ${missingCategories.length} Prodeval components: ${missingCategories.join(", ")}`);

  const biogasScfm = extractBiogasScfmFromResults(results);
  const unit = selectProdevalUnit(biogasScfm);
  console.log(`Prodeval Validation: Estimated biogas flow ${Math.round(biogasScfm)} SCFM → selected ${unit.modelSize} unit (${unit.numberOfTrains} train(s))`);

  const nonProdevalGasTrain = results.equipment.filter(eq => {
    const text = `${eq.equipmentType} ${eq.description} ${eq.process}`.toLowerCase();
    const isGasTrainProcess = text.includes("gas conditioning") || text.includes("gas upgrading") ||
      text.includes("biogas conditioning") || text.includes("biogas upgrading") ||
      text.includes("rng") || text.includes("membrane") || text.includes("h₂s") ||
      text.includes("h2s") || text.includes("siloxane") || text.includes("amine");
    return isGasTrainProcess && !isProdevalEquipment(eq);
  });

  if (nonProdevalGasTrain.length > 0) {
    corrections.push(`Replaced ${nonProdevalGasTrain.length} non-Prodeval gas train equipment item(s)`);
    const nonProdevalIds = new Set(nonProdevalGasTrain.map(eq => eq.id));
    results.equipment = results.equipment.filter(eq => !nonProdevalIds.has(eq.id));
  }

  let idCounter = 0;
  const makeId = (suffix?: string) => `prodeval-validated-${suffix || (idCounter++).toString()}`;
  const prodevalItems = getProdevalEquipmentList(biogasScfm, makeId);

  const existingProdevalTypes = new Set(
    existingProdeval.map(eq => eq.equipmentType.toLowerCase())
  );

  const newItems: EquipmentItem[] = [];
  for (const item of prodevalItems) {
    if (!existingProdevalTypes.has(item.equipmentType.toLowerCase())) {
      newItems.push({
        ...item,
        isOverridden: false,
        isLocked: false,
      });
    }
  }

  if (newItems.length > 0) {
    corrections.push(`Injected ${newItems.length} Prodeval gas train equipment item(s): ${newItems.map(i => i.equipmentType).join(", ")}`);

    const insertIndex = results.equipment.findIndex(eq => {
      const text = `${eq.equipmentType} ${eq.description}`.toLowerCase();
      return text.includes("flare") || text.includes("thermal oxidizer");
    });

    if (insertIndex >= 0) {
      results.equipment.splice(insertIndex, 0, ...newItems);
    } else {
      results.equipment.push(...newItems);
    }
  }

  if (corrections.length > 0) {
    const warningMsg = `Prodeval Validation: AI output was missing required Prodeval gas train equipment. ${corrections.join(". ")}. Biogas flow: ${Math.round(biogasScfm)} SCFM, unit size: ${unit.modelSize}.`;
    if (!results.warnings) results.warnings = [];
    results.warnings.push({
      field: "equipment",
      message: warningMsg,
      severity: "warning",
    });
    console.log(`Prodeval Validation: ${warningMsg}`);
  }

  return { results, corrections };
}

export interface MassBalanceAIResult {
  results: MassBalanceResults;
  provider: LLMProvider;
  providerLabel: string;
}

const DETERMINISTIC_PROJECT_TYPES = new Set(["b", "c", "d"]);

/**
 * Main entry point for mass balance generation.
 * Routing logic:
 *   - Types B/C/D (RNG): tries deterministic calculator first (BMP-based, no AI cost).
 *     Falls back to AI only if deterministic fails (e.g., missing feedstock data).
 *   - Type A (Wastewater): always uses AI generation (no deterministic path available).
 * Returns the mass balance results along with provider info for generation stats tracking.
 */
export async function generateMassBalanceWithAI(
  upif: any,
  projectType: string,
  preferredModel: LLMProvider = "gpt5",
  storage?: any,
): Promise<MassBalanceAIResult> {
  const normalizedType = normalizeProjectType(projectType);

  if (DETERMINISTIC_PROJECT_TYPES.has(normalizedType)) {
    try {
      console.log(`Mass Balance: Using DETERMINISTIC calculator for Type ${normalizedType.toUpperCase()} (RNG project)`);
      const detResult = generateDeterministicMassBalance(upif, normalizedType);

      const stageCount = (detResult.results.adStages?.length || 0);
      const equipCount = detResult.results.equipment.length;
      console.log(`Mass Balance: Deterministic complete — ${stageCount} stages, ${equipCount} equipment items`);

      return {
        results: detResult.results,
        provider: "deterministic" as any,
        providerLabel: "Deterministic Calculator",
      };
    } catch (detError) {
      console.warn(`Mass Balance: Deterministic calculator failed: ${(detError as Error).message}`);
      console.log(`Mass Balance: Falling back to AI generation for Type ${normalizedType.toUpperCase()}`);
    }
  }

  return generateMassBalanceWithLLM(upif, projectType, preferredModel, storage, normalizedType);
}

/**
 * Parses LLM JSON output with repair fallback for truncated responses.
 * First strips any markdown code fences (```json ... ```), then attempts
 * standard JSON.parse. If that fails (common with truncated outputs),
 * falls back to repairTruncatedJSON which closes unclosed brackets/braces.
 */
function parseAndRepairJSON(rawContent: string, label: string): any {
  let cleaned = rawContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (parseError) {
    console.log(`${label}: Initial JSON parse failed (${(parseError as Error).message}), attempting repair...`);
    try {
      const repaired = repairTruncatedJSON(cleaned);
      console.log(`${label}: Successfully repaired truncated JSON`);
      return repaired;
    } catch (repairError) {
      console.error(`${label}: Failed to parse or repair JSON. First 500 chars:`, cleaned.substring(0, 500));
      throw new Error(`AI returned invalid JSON (${label}, length=${cleaned.length}). Parse error: ${(parseError as Error).message}`);
    }
  }
}

/**
 * Parallel AI generation strategy: splits mass balance into 2 independent LLM calls
 * for ~40% faster wall time vs. a single monolithic call.
 *   Call 1: Process stages, summary, assumptions, warnings, recycle streams (no equipment)
 *   Call 2: Complete equipment list with specs, quantities, design basis
 * Both calls share the same system prompt (UPIF data). Results are merged after both complete.
 * Each call uses 32K max tokens (vs. 64K for monolithic) since the workload is split.
 */
async function generateMassBalanceParallel(
  systemPrompt: string,
  model: LLMProvider,
  normalizedType: string,
): Promise<MassBalanceResults> {
  const stagesInstruction = `Generate the process stages, summary, assumptions, warnings, and recycle streams for this project. Do NOT include the equipment list.
Return valid JSON with these fields:
{
  "projectType": "...",
  "stages": [...],
  "adStages": [...],
  "recycleStreams": [...],
  "assumptions": [...],
  "warnings": [...],
  "summary": {...},
  "calculationSteps": [...],
  "convergenceIterations": 1,
  "convergenceAchieved": true
}
Keep descriptions concise. Return valid JSON only.`;

  const equipmentInstruction = `Generate ONLY the complete equipment list for this project. Include all process equipment with full specs, quantities, design basis, and notes.
Return valid JSON with this field:
{
  "equipment": [
    {
      "id": "eq-001",
      "process": "Process Area",
      "equipmentType": "Equipment Name",
      "description": "Brief description with sizing",
      "quantity": 1,
      "specs": { "paramName": { "value": 100, "unit": "gpm" } },
      "designBasis": "Design basis text",
      "notes": "Notes",
      "isOverridden": false,
      "isLocked": false
    }
  ]
}
Keep descriptions concise. Return valid JSON only.`;

  const maxTokens = 32768;

  console.log(`Mass Balance AI (Parallel): Launching 2 parallel LLM calls using ${model}`);
  const parallelStart = Date.now();

  const [stagesResponse, equipmentResponse] = await Promise.all([
    llmComplete({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: stagesInstruction },
      ],
      maxTokens,
      jsonMode: true,
    }),
    llmComplete({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: equipmentInstruction },
      ],
      maxTokens,
      jsonMode: true,
    }),
  ]);

  console.log(`Mass Balance AI (Parallel): Both calls completed in ${Date.now() - parallelStart}ms`);
  console.log(`Mass Balance AI (Parallel): Stages response: ${stagesResponse.content.length} chars, Equipment response: ${equipmentResponse.content.length} chars`);

  const stagesParsed = parseAndRepairJSON(stagesResponse.content, "MB-Stages");
  const equipmentParsed = parseAndRepairJSON(equipmentResponse.content, "MB-Equipment");

  const merged = {
    ...stagesParsed,
    equipment: Array.isArray(equipmentParsed.equipment) ? equipmentParsed.equipment : [],
  };

  return validateMassBalanceResults(merged);
}

/**
 * Internal LLM-based mass balance generation (called when deterministic path is skipped
 * or fails). Loads the appropriate prompt template, builds UPIF data string, and
 * attempts parallel generation first, falling back to monolithic if parallel fails.
 * After generation, enforces Prodeval equipment for RNG project types.
 */
async function generateMassBalanceWithLLM(
  upif: any,
  projectType: string,
  preferredModel: LLMProvider,
  storage: any,
  normalizedType: string,
): Promise<MassBalanceAIResult> {
  const promptKey = massBalancePromptMap[normalizedType] || "mass_balance_type_a";

  let model = preferredModel;
  if (!isProviderAvailable(model)) {
    const fallback = getAvailableProviders()[0];
    if (!fallback) {
      throw new Error("No LLM provider is available. Configure an API key for OpenAI or Anthropic.");
    }
    console.log(`Mass Balance AI: ${model} not available, falling back to ${fallback}`);
    model = fallback;
  }

  const promptTemplate = await getPromptTemplate(promptKey, storage);
  const upifDataString = buildUpifDataString(upif);
  const systemPrompt = promptTemplate.replace("{{UPIF_DATA}}", upifDataString);

  console.log(`Mass Balance AI: Generating for project type ${normalizedType.toUpperCase()} using ${model} (prompt: ${promptKey})`);
  console.log(`Mass Balance AI: UPIF data length: ${upifDataString.length} chars`);

  let results: MassBalanceResults;
  let usedProvider: LLMProvider = model;

  try {
    results = await generateMassBalanceParallel(systemPrompt, model, normalizedType);
    console.log(`Mass Balance AI: Parallel generation succeeded`);
  } catch (parallelError) {
    console.warn(`Mass Balance AI: Parallel generation failed (${(parallelError as Error).message}), falling back to monolithic call...`);

    const userInstruction = `Generate a complete mass balance and equipment list based on the UPIF data provided. Return valid JSON only. Keep descriptions concise to stay within output limits.`;
    const maxTokens = 65536;

    const response = await llmComplete({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInstruction },
      ],
      maxTokens,
      jsonMode: true,
    });

    console.log(`Mass Balance AI: Fallback response received from ${response.provider}, ${response.content.length} chars, stop_reason=${response.stopReason || "unknown"}`);

    if (response.stopReason === "max_tokens" || response.stopReason === "length") {
      console.warn(`Mass Balance AI: Response was TRUNCATED (stop_reason=${response.stopReason}). Will attempt JSON repair.`);
    }

    const parsed = parseAndRepairJSON(response.content, "MB-Fallback");
    results = validateMassBalanceResults(parsed);
    usedProvider = response.provider as LLMProvider;
  }

  const { results: enforced, corrections } = enforceProdevalEquipment(results, normalizedType);
  results = enforced;
  if (corrections.length > 0) {
    console.log(`Mass Balance AI: Prodeval enforcement applied ${corrections.length} correction(s)`);
  }

  const stageCount = results.stages.length + (results.adStages?.length || 0);
  const equipCount = results.equipment.length;
  console.log(`Mass Balance AI: Validated results - ${stageCount} stages, ${equipCount} equipment items, ${results.warnings.length} warnings`);

  return {
    results,
    provider: usedProvider,
    providerLabel: providerLabels[usedProvider],
  };
}
