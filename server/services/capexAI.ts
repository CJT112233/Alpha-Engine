import { llmComplete, isProviderAvailable, getAvailableProviders, providerLabels, type LLMProvider } from "../llm";
import type { CapexResults, CapexLineItem, MassBalanceResults, EquipmentItem } from "@shared/schema";
import type { PromptKey } from "@shared/default-prompts";
import { DEFAULT_PROMPTS } from "@shared/default-prompts";

const capexPromptMap: Record<string, PromptKey> = {
  a: "capex_type_a",
  b: "capex_type_b",
  c: "capex_type_c",
  d: "capex_type_d",
};

function normalizeProjectType(projectType: string): string {
  const pt = projectType.toLowerCase().trim();
  if (pt.includes("type a") || pt.includes("wastewater") || pt === "a") return "a";
  if (pt.includes("type b") || pt.includes("greenfield") || pt === "b") return "b";
  if (pt.includes("type c") || pt.includes("bolt-on") || pt.includes("bolt on") || pt === "c") return "c";
  if (pt.includes("type d") || pt.includes("hybrid") || pt === "d") return "d";
  return "a";
}

function buildEquipmentDataString(massBalanceResults: MassBalanceResults): string {
  const sections: string[] = [];

  if (massBalanceResults.summary && Object.keys(massBalanceResults.summary).length > 0) {
    const summaryLines = Object.entries(massBalanceResults.summary).map(
      ([key, val]) => `  ${key}: ${val.value} ${val.unit}`
    );
    sections.push("MASS BALANCE SUMMARY:\n" + summaryLines.join("\n"));
  }

  if (massBalanceResults.equipment && massBalanceResults.equipment.length > 0) {
    const eqLines = massBalanceResults.equipment.map((eq: EquipmentItem, i: number) => {
      const parts: string[] = [];
      parts.push(`Equipment ${i + 1}: ${eq.equipmentType} (${eq.process})`);
      parts.push(`  ID: ${eq.id}`);
      parts.push(`  Description: ${eq.description}`);
      parts.push(`  Quantity: ${eq.quantity}`);
      parts.push(`  Design Basis: ${eq.designBasis}`);
      if (eq.specs && Object.keys(eq.specs).length > 0) {
        for (const [key, spec] of Object.entries(eq.specs)) {
          parts.push(`  ${key}: ${spec.value} ${spec.unit}`);
        }
      }
      if (eq.notes) parts.push(`  Notes: ${eq.notes}`);
      return parts.join("\n");
    });
    sections.push("EQUIPMENT LIST:\n" + eqLines.join("\n\n"));
  }

  if (massBalanceResults.stages && massBalanceResults.stages.length > 0) {
    sections.push(`Treatment Stages: ${massBalanceResults.stages.length} stages defined`);
  }

  if (massBalanceResults.adStages && massBalanceResults.adStages.length > 0) {
    sections.push(`AD Process Stages: ${massBalanceResults.adStages.length} stages defined`);
  }

  return sections.join("\n\n");
}

function buildUpifContextString(upif: any): string {
  const sections: string[] = [];

  if (upif.projectType) sections.push(`Project Type: ${upif.projectType}`);
  if (upif.location) sections.push(`Location: ${upif.location}`);

  if (upif.feedstocks && Array.isArray(upif.feedstocks) && upif.feedstocks.length > 0) {
    const feedLines = upif.feedstocks.map((f: any, i: number) => {
      const parts: string[] = [`Feedstock ${i + 1}: ${f.feedstockType || "Unknown"}`];
      if (f.feedstockVolume) parts.push(`  Volume: ${f.feedstockVolume} ${f.feedstockUnit || ""}`);
      return parts.join("\n");
    });
    sections.push("FEEDSTOCKS:\n" + feedLines.join("\n"));
  }

  if (upif.outputRequirements) sections.push(`Output Requirements: ${upif.outputRequirements}`);

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

function validateCapexResults(parsed: any): CapexResults {
  const lineItems: CapexLineItem[] = Array.isArray(parsed.lineItems)
    ? parsed.lineItems.map((item: any, idx: number) => ({
        id: item.id || `capex-${idx}-${Math.random().toString(36).substring(2, 8)}`,
        equipmentId: item.equipmentId || "",
        process: item.process || "General",
        equipmentType: item.equipmentType || "Unknown",
        description: item.description || "",
        quantity: typeof item.quantity === "number" ? item.quantity : 1,
        baseCostPerUnit: typeof item.baseCostPerUnit === "number" ? item.baseCostPerUnit : 0,
        installationFactor: typeof item.installationFactor === "number" ? item.installationFactor : 2.5,
        installedCost: typeof item.installedCost === "number" ? item.installedCost : 0,
        contingencyPct: typeof item.contingencyPct === "number" ? item.contingencyPct : 20,
        contingencyCost: typeof item.contingencyCost === "number" ? item.contingencyCost : 0,
        totalCost: typeof item.totalCost === "number" ? item.totalCost : 0,
        costBasis: item.costBasis || "Estimated, 2025 USD",
        source: item.source || "estimated",
        notes: item.notes || "",
        isOverridden: false,
        isLocked: false,
      }))
    : [];

  for (const item of lineItems) {
    if (item.installedCost === 0 && item.baseCostPerUnit > 0) {
      item.installedCost = item.baseCostPerUnit * item.quantity * item.installationFactor;
    }
    if (item.contingencyCost === 0 && item.installedCost > 0) {
      item.contingencyCost = Math.round(item.installedCost * (item.contingencyPct / 100));
    }
    if (item.totalCost === 0) {
      item.totalCost = item.installedCost + item.contingencyCost;
    }
  }

  const totalEquipmentCost = lineItems.reduce((sum, i) => sum + i.baseCostPerUnit * i.quantity, 0);
  const totalInstalledCost = lineItems.reduce((sum, i) => sum + i.installedCost, 0);
  const totalContingency = lineItems.reduce((sum, i) => sum + i.contingencyCost, 0);
  const totalDirectCost = totalInstalledCost + totalContingency;

  const defaultSummary = {
    totalEquipmentCost,
    totalInstalledCost,
    totalContingency,
    totalDirectCost,
    engineeringPct: 7,
    engineeringCost: Math.round(totalDirectCost * 0.07),
    totalProjectCost: Math.round(totalDirectCost * 1.07),
  };

  const summary = parsed.summary && typeof parsed.summary === "object"
    ? {
        totalEquipmentCost: typeof parsed.summary.totalEquipmentCost === "number" ? parsed.summary.totalEquipmentCost : defaultSummary.totalEquipmentCost,
        totalInstalledCost: typeof parsed.summary.totalInstalledCost === "number" ? parsed.summary.totalInstalledCost : defaultSummary.totalInstalledCost,
        totalContingency: typeof parsed.summary.totalContingency === "number" ? parsed.summary.totalContingency : defaultSummary.totalContingency,
        totalDirectCost: typeof parsed.summary.totalDirectCost === "number" ? parsed.summary.totalDirectCost : defaultSummary.totalDirectCost,
        engineeringPct: typeof parsed.summary.engineeringPct === "number" ? parsed.summary.engineeringPct : defaultSummary.engineeringPct,
        engineeringCost: typeof parsed.summary.engineeringCost === "number" ? parsed.summary.engineeringCost : defaultSummary.engineeringCost,
        totalProjectCost: typeof parsed.summary.totalProjectCost === "number" ? parsed.summary.totalProjectCost : defaultSummary.totalProjectCost,
        costPerUnit: parsed.summary.costPerUnit || undefined,
      }
    : defaultSummary;

  return {
    projectType: parsed.projectType || "A",
    lineItems,
    summary,
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    costYear: parsed.costYear || "2025",
    currency: parsed.currency || "USD",
    methodology: parsed.methodology || "AACE Class 4/5 factored estimate",
  };
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

export interface CapexAIResult {
  results: CapexResults;
  provider: LLMProvider;
  providerLabel: string;
}

function buildFilteredEquipmentDataString(
  massBalanceResults: MassBalanceResults,
  equipmentFilter: (eq: EquipmentItem) => boolean,
): string {
  const sections: string[] = [];

  if (massBalanceResults.summary && Object.keys(massBalanceResults.summary).length > 0) {
    const summaryLines = Object.entries(massBalanceResults.summary).map(
      ([key, val]) => `  ${key}: ${val.value} ${val.unit}`
    );
    sections.push("MASS BALANCE SUMMARY:\n" + summaryLines.join("\n"));
  }

  const filteredEquipment = (massBalanceResults.equipment || []).filter(equipmentFilter);
  if (filteredEquipment.length > 0) {
    const eqLines = filteredEquipment.map((eq: EquipmentItem, i: number) => {
      const parts: string[] = [];
      parts.push(`Equipment ${i + 1}: ${eq.equipmentType} (${eq.process})`);
      parts.push(`  ID: ${eq.id}`);
      parts.push(`  Description: ${eq.description}`);
      parts.push(`  Quantity: ${eq.quantity}`);
      parts.push(`  Design Basis: ${eq.designBasis}`);
      if (eq.specs && Object.keys(eq.specs).length > 0) {
        for (const [key, spec] of Object.entries(eq.specs)) {
          parts.push(`  ${key}: ${spec.value} ${spec.unit}`);
        }
      }
      if (eq.notes) parts.push(`  Notes: ${eq.notes}`);
      return parts.join("\n");
    });
    sections.push("EQUIPMENT LIST (items requiring cost estimation):\n" + eqLines.join("\n\n"));
  }

  if (massBalanceResults.adStages && massBalanceResults.adStages.length > 0) {
    sections.push(`AD Process Stages: ${massBalanceResults.adStages.length} stages defined`);
  }

  return sections.join("\n\n");
}

const DETERMINISTIC_EQUIPMENT_PATTERNS = [
  /prodeval/i, /valogaz/i, /valopack/i, /valopur/i,
  /gas\s*upgrad/i, /membrane\s*system/i, /rng\s*compressor/i,
  /hp\s*filtration/i, /mixing\s*bottle/i, /dust\s*filter/i,
  /biogas\s*compressor/i, /enclosed\s*flare/i,
];

export function isEquipmentCoveredByDeterministic(eq: EquipmentItem): boolean {
  const text = `${eq.equipmentType} ${eq.process} ${eq.description}`.toLowerCase();
  return DETERMINISTIC_EQUIPMENT_PATTERNS.some(p => p.test(text));
}

export function getUncoveredEquipment(massBalanceResults: MassBalanceResults): EquipmentItem[] {
  return (massBalanceResults.equipment || []).filter(eq => !isEquipmentCoveredByDeterministic(eq));
}

export interface CapexUpstreamAIResult {
  lineItems: CapexLineItem[];
  provider: LLMProvider;
  providerLabel: string;
}

export async function estimateUpstreamEquipmentCosts(
  upif: any,
  massBalanceResults: MassBalanceResults,
  projectType: string,
  preferredModel: LLMProvider = "gpt5",
  storage?: any,
): Promise<CapexUpstreamAIResult> {
  const uncoveredEquipment = getUncoveredEquipment(massBalanceResults);
  if (uncoveredEquipment.length === 0) {
    return { lineItems: [], provider: preferredModel, providerLabel: "No upstream equipment" };
  }

  let model = preferredModel;
  if (!isProviderAvailable(model)) {
    const fallback = getAvailableProviders()[0];
    if (!fallback) {
      throw new Error("No LLM provider is available. Configure an API key for OpenAI or Anthropic.");
    }
    model = fallback;
  }

  const equipmentDataString = buildFilteredEquipmentDataString(
    massBalanceResults,
    eq => !isEquipmentCoveredByDeterministic(eq),
  );
  const upifContextString = buildUpifContextString(upif);

  const systemPrompt = `You are a senior process engineer and cost estimator specializing in anaerobic digestion and biogas facilities. You are estimating ONLY the upstream process equipment costs — the gas upgrading equipment (Prodeval), BOP construction, interconnect, and Burnham internal costs are handled separately by a deterministic model.

PROJECT & EQUIPMENT DATA:
${equipmentDataString}

PROJECT CONTEXT:
${upifContextString}

For EACH equipment item listed above, provide a CapEx line item with:
1. Base cost per unit (equipment purchase price, FOB) — use vendor budgetary quotes, BioCycle benchmarks, EPA AgSTAR data
2. Installation factor (typically 1.5-3.5x depending on equipment complexity)
3. Installed cost = base cost × quantity × installation factor
4. Contingency: 0% (contingency is applied globally by the deterministic model)

IMPORTANT RULES:
- Estimate costs for EVERY equipment item listed above — do not skip any
- Equipment IDs must match the IDs provided (e.g., "eq-xxx")
- All costs in 2026 USD, no decimals for values > $1,000
- Use realistic industry pricing — reference vendor budgetary quotes and published benchmarks
- Keep descriptions concise
- Do NOT include gas upgrading, flare, RNG compressor, interconnect, or Burnham internal costs — those are handled separately

Return ONLY valid JSON in this format:
{
  "lineItems": [
    {
      "id": "capex-upstream-unique",
      "equipmentId": "matching-equipment-id",
      "process": "Process Area",
      "equipmentType": "Equipment Type",
      "description": "Brief description with sizing",
      "quantity": 1,
      "baseCostPerUnit": 500000,
      "installationFactor": 2.5,
      "installedCost": 1250000,
      "contingencyPct": 0,
      "contingencyCost": 0,
      "totalCost": 1250000,
      "costBasis": "Vendor budgetary, 2026 USD",
      "source": "vendor/AACE/benchmark",
      "notes": "Key sizing info",
      "isOverridden": false,
      "isLocked": false
    }
  ]
}

Return ONLY valid JSON. No markdown, no code fences, no explanation.`;

  console.log(`CapEx Hybrid AI: Estimating ${uncoveredEquipment.length} upstream equipment items using ${model}`);

  const response = await llmComplete({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Estimate costs for the ${uncoveredEquipment.length} upstream process equipment items listed. Return valid JSON only.` },
    ],
    maxTokens: 16384,
    jsonMode: true,
  });

  console.log(`CapEx Hybrid AI: Response received from ${response.provider}, ${response.content.length} chars`);

  let rawContent = response.content;
  rawContent = rawContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (parseError) {
    try {
      parsed = repairTruncatedJSON(rawContent);
    } catch (repairError) {
      console.error("CapEx Hybrid AI: Failed to parse JSON:", rawContent.substring(0, 500));
      throw new Error(`AI returned invalid JSON for upstream equipment. Parse error: ${(parseError as Error).message}`);
    }
  }

  const lineItems: CapexLineItem[] = Array.isArray(parsed.lineItems)
    ? parsed.lineItems.map((item: any, idx: number) => {
        const li: CapexLineItem = {
          id: item.id || `capex-upstream-${idx}-${Math.random().toString(36).substring(2, 8)}`,
          equipmentId: item.equipmentId || "",
          process: item.process || "Upstream Process",
          equipmentType: item.equipmentType || "Unknown",
          description: item.description || "",
          quantity: typeof item.quantity === "number" ? item.quantity : 1,
          baseCostPerUnit: typeof item.baseCostPerUnit === "number" ? item.baseCostPerUnit : 0,
          installationFactor: typeof item.installationFactor === "number" ? item.installationFactor : 2.5,
          installedCost: typeof item.installedCost === "number" ? item.installedCost : 0,
          contingencyPct: 0,
          contingencyCost: 0,
          totalCost: typeof item.totalCost === "number" ? item.totalCost : 0,
          costBasis: item.costBasis || "AI estimate, 2026 USD",
          source: item.source || "AI estimate",
          notes: item.notes || "",
          isOverridden: false,
          isLocked: false,
        };
        if (li.installedCost === 0 && li.baseCostPerUnit > 0) {
          li.installedCost = Math.round(li.baseCostPerUnit * li.quantity * li.installationFactor);
        }
        if (li.totalCost === 0) {
          li.totalCost = li.installedCost;
        }
        return li;
      })
    : [];

  return {
    lineItems,
    provider: response.provider as LLMProvider,
    providerLabel: providerLabels[response.provider as LLMProvider] || response.provider,
  };
}

export async function generateCapexWithAI(
  upif: any,
  massBalanceResults: MassBalanceResults,
  projectType: string,
  preferredModel: LLMProvider = "gpt5",
  storage?: any,
): Promise<CapexAIResult> {
  const normalizedType = normalizeProjectType(projectType);
  const promptKey = capexPromptMap[normalizedType] || "capex_type_a";

  let model = preferredModel;
  if (!isProviderAvailable(model)) {
    const fallback = getAvailableProviders()[0];
    if (!fallback) {
      throw new Error("No LLM provider is available. Configure an API key for OpenAI or Anthropic.");
    }
    console.log(`CapEx AI: ${model} not available, falling back to ${fallback}`);
    model = fallback;
  }

  const promptTemplate = await getPromptTemplate(promptKey, storage);
  const equipmentDataString = buildEquipmentDataString(massBalanceResults);
  const upifContextString = buildUpifContextString(upif);

  const systemPrompt = promptTemplate
    .replace("{{EQUIPMENT_DATA}}", equipmentDataString)
    .replace("{{UPIF_DATA}}", upifContextString);

  console.log(`CapEx AI: Generating for project type ${normalizedType.toUpperCase()} using ${model} (prompt: ${promptKey})`);
  console.log(`CapEx AI: Equipment data length: ${equipmentDataString.length} chars, UPIF context: ${upifContextString.length} chars`);

  const isOpus = model === "claude-opus";
  const capexMaxTokens = isOpus ? 16384 : 32768;
  const capexUserMsg = isOpus
    ? `Generate a complete capital expenditure estimate based on the mass balance equipment list and project data provided. Return valid JSON only. CRITICAL: Keep descriptions and notes extremely concise to reduce output size and prevent timeout.`
    : `Generate a complete capital expenditure estimate based on the mass balance equipment list and project data provided. Return valid JSON only. Keep the response concise - use short descriptions and notes to stay within output limits.`;

  const response = await llmComplete({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: capexUserMsg },
    ],
    maxTokens: capexMaxTokens,
    jsonMode: true,
  });

  console.log(`CapEx AI: Response received from ${response.provider}, ${response.content.length} chars, stop_reason=${response.stopReason || "unknown"}`);

  let rawContent = response.content;
  rawContent = rawContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (parseError) {
    console.log("CapEx AI: Initial JSON parse failed, attempting truncation repair...");
    try {
      parsed = repairTruncatedJSON(rawContent);
      console.log("CapEx AI: Successfully repaired truncated JSON");
    } catch (repairError) {
      console.error("CapEx AI: Failed to parse or repair JSON response:", rawContent.substring(0, 500));
      throw new Error(`AI returned invalid JSON. Parse error: ${(parseError as Error).message}`);
    }
  }

  const results = validateCapexResults(parsed);

  return {
    results,
    provider: response.provider as LLMProvider,
    providerLabel: providerLabels[response.provider as LLMProvider] || response.provider,
  };
}
