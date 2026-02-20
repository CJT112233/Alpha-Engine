import { llmComplete, isProviderAvailable, getAvailableProviders, providerLabels, type LLMProvider } from "../llm";
import type { MassBalanceResults } from "@shared/schema";
import type { PromptKey } from "@shared/default-prompts";
import { DEFAULT_PROMPTS } from "@shared/default-prompts";

const massBalancePromptMap: Record<string, PromptKey> = {
  a: "mass_balance_type_a",
  b: "mass_balance_type_b",
  c: "mass_balance_type_c",
  d: "mass_balance_type_d",
};

function normalizeProjectType(projectType: string): string {
  const pt = projectType.toLowerCase().trim();
  if (pt.includes("type a") || pt.includes("wastewater") || pt === "a") return "a";
  if (pt.includes("type b") || pt.includes("greenfield") || pt === "b") return "b";
  if (pt.includes("type c") || pt.includes("bolt-on") || pt.includes("bolt on") || pt === "c") return "c";
  if (pt.includes("type d") || pt.includes("hybrid") || pt === "d") return "d";
  return "a";
}

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

export interface MassBalanceAIResult {
  results: MassBalanceResults;
  provider: LLMProvider;
  providerLabel: string;
}

export async function generateMassBalanceWithAI(
  upif: any,
  projectType: string,
  preferredModel: LLMProvider = "gpt5",
  storage?: any,
): Promise<MassBalanceAIResult> {
  const normalizedType = normalizeProjectType(projectType);
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

  const response = await llmComplete({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Generate a complete mass balance and equipment list based on the UPIF data provided. Return valid JSON only. Keep descriptions concise to stay within output limits.` },
    ],
    maxTokens: 32768,
    jsonMode: true,
  });

  console.log(`Mass Balance AI: Response received from ${response.provider}, ${response.content.length} chars`);

  let rawContent = response.content;
  rawContent = rawContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (parseError) {
    console.log("Mass Balance AI: Initial JSON parse failed, attempting truncation repair...");
    try {
      parsed = repairTruncatedJSON(rawContent);
      console.log("Mass Balance AI: Successfully repaired truncated JSON");
    } catch (repairError) {
      console.error("Mass Balance AI: Failed to parse or repair JSON response:", rawContent.substring(0, 500));
      throw new Error(`AI returned invalid JSON. Parse error: ${(parseError as Error).message}`);
    }
  }

  const results = validateMassBalanceResults(parsed);

  const stageCount = results.stages.length + (results.adStages?.length || 0);
  const equipCount = results.equipment.length;
  console.log(`Mass Balance AI: Validated results - ${stageCount} stages, ${equipCount} equipment items, ${results.warnings.length} warnings`);

  return {
    results,
    provider: response.provider,
    providerLabel: providerLabels[response.provider],
  };
}
