import { llmComplete, isProviderAvailable, getAvailableProviders, providerLabels, type LLMProvider } from "../llm";
import type { OpexResults, OpexLineItem, OpexSummary, MassBalanceResults, CapexResults, EquipmentItem } from "@shared/schema";
import type { PromptKey } from "@shared/default-prompts";
import { DEFAULT_PROMPTS } from "@shared/default-prompts";

const opexPromptMap: Record<string, PromptKey> = {
  a: "opex_type_a",
  b: "opex_type_b",
  c: "opex_type_c",
  d: "opex_type_d",
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

function buildCapexDataString(capexResults: CapexResults | null): string {
  if (!capexResults) return "No CapEx data available.";

  const sections: string[] = [];
  const summary = capexResults.summary;

  if (summary) {
    sections.push("CAPEX SUMMARY:");
    sections.push(`  Total Equipment Cost: $${summary.totalEquipmentCost?.toLocaleString() || 0}`);
    sections.push(`  Total Installed Cost: $${summary.totalInstalledCost?.toLocaleString() || 0}`);
    sections.push(`  Total Project Cost: $${summary.totalProjectCost?.toLocaleString() || 0}`);
    if (summary.costPerUnit) {
      sections.push(`  Cost per Unit: $${summary.costPerUnit.value?.toLocaleString() || 0} ${summary.costPerUnit.unit} (${summary.costPerUnit.basis})`);
    }
  }

  if (capexResults.lineItems && capexResults.lineItems.length > 0) {
    const liLines = capexResults.lineItems.map((li, i) =>
      `  ${i + 1}. ${li.equipmentType} (${li.process}): Base $${li.baseCostPerUnit?.toLocaleString() || 0}/unit × ${li.quantity}, Installed $${li.installedCost?.toLocaleString() || 0}, Total $${li.totalCost?.toLocaleString() || 0}`
    );
    sections.push("CAPEX LINE ITEMS:\n" + liLines.join("\n"));
  }

  return sections.join("\n");
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

const OPEX_CATEGORIES = ["Labor", "Energy", "Chemical", "Maintenance", "Disposal", "Other", "Revenue Offset"];

function categorizeLineItem(item: any): string {
  const cat = (item.category || "").toLowerCase();
  if (cat.includes("labor") || cat.includes("staff") || cat.includes("personnel")) return "Labor";
  if (cat.includes("energy") || cat.includes("electric") || cat.includes("utilit") || cat.includes("fuel") || cat.includes("heat")) return "Energy";
  if (cat.includes("chemical") || cat.includes("consumab") || cat.includes("media") || cat.includes("membrane")) return "Chemical";
  if (cat.includes("mainten") || cat.includes("repair") || cat.includes("spare")) return "Maintenance";
  if (cat.includes("dispos") || cat.includes("haul") || cat.includes("sludge") || cat.includes("digestate") || cat.includes("solid")) return "Disposal";
  if (cat.includes("revenue") || cat.includes("offset") || cat.includes("credit") || cat.includes("sales")) return "Revenue Offset";
  return "Other";
}

function validateOpexResults(parsed: any, totalProjectCapex: number): OpexResults {
  const lineItems: OpexLineItem[] = Array.isArray(parsed.lineItems)
    ? parsed.lineItems.map((item: any, idx: number) => ({
        id: item.id || `opex-${idx}-${Math.random().toString(36).substring(2, 8)}`,
        category: item.category || categorizeLineItem(item),
        description: item.description || "",
        annualCost: typeof item.annualCost === "number" ? item.annualCost : 0,
        unitCost: typeof item.unitCost === "number" ? item.unitCost : undefined,
        unitBasis: item.unitBasis || undefined,
        scalingBasis: item.scalingBasis || undefined,
        percentOfRevenue: typeof item.percentOfRevenue === "number" ? item.percentOfRevenue : undefined,
        costBasis: item.costBasis || "Estimated, 2025 USD",
        source: item.source || "estimated",
        notes: item.notes || "",
        isOverridden: false,
        isLocked: false,
      }))
    : [];

  const totalLaborCost = lineItems.filter(li => categorizeLineItem(li) === "Labor").reduce((sum, li) => sum + li.annualCost, 0);
  const totalEnergyCost = lineItems.filter(li => categorizeLineItem(li) === "Energy").reduce((sum, li) => sum + li.annualCost, 0);
  const totalChemicalCost = lineItems.filter(li => categorizeLineItem(li) === "Chemical").reduce((sum, li) => sum + li.annualCost, 0);
  const totalMaintenanceCost = lineItems.filter(li => categorizeLineItem(li) === "Maintenance").reduce((sum, li) => sum + li.annualCost, 0);
  const totalDisposalCost = lineItems.filter(li => categorizeLineItem(li) === "Disposal").reduce((sum, li) => sum + li.annualCost, 0);
  const revenueOffsets = lineItems.filter(li => categorizeLineItem(li) === "Revenue Offset").reduce((sum, li) => sum + li.annualCost, 0);
  const totalOtherCost = lineItems.filter(li => categorizeLineItem(li) === "Other").reduce((sum, li) => sum + li.annualCost, 0);

  const totalAnnualOpex = totalLaborCost + totalEnergyCost + totalChemicalCost + totalMaintenanceCost + totalDisposalCost + totalOtherCost;
  const netAnnualOpex = totalAnnualOpex + revenueOffsets;

  const defaultSummary: OpexSummary = {
    totalAnnualOpex,
    totalLaborCost,
    totalEnergyCost,
    totalChemicalCost,
    totalMaintenanceCost,
    totalDisposalCost,
    totalOtherCost,
    revenueOffsets,
    netAnnualOpex,
    opexAsPercentOfCapex: totalProjectCapex > 0 ? Math.round((totalAnnualOpex / totalProjectCapex) * 1000) / 10 : undefined,
  };

  const summary = parsed.summary && typeof parsed.summary === "object"
    ? {
        totalAnnualOpex: typeof parsed.summary.totalAnnualOpex === "number" ? parsed.summary.totalAnnualOpex : defaultSummary.totalAnnualOpex,
        totalLaborCost: typeof parsed.summary.totalLaborCost === "number" ? parsed.summary.totalLaborCost : defaultSummary.totalLaborCost,
        totalEnergyCost: typeof parsed.summary.totalEnergyCost === "number" ? parsed.summary.totalEnergyCost : defaultSummary.totalEnergyCost,
        totalChemicalCost: typeof parsed.summary.totalChemicalCost === "number" ? parsed.summary.totalChemicalCost : defaultSummary.totalChemicalCost,
        totalMaintenanceCost: typeof parsed.summary.totalMaintenanceCost === "number" ? parsed.summary.totalMaintenanceCost : defaultSummary.totalMaintenanceCost,
        totalDisposalCost: typeof parsed.summary.totalDisposalCost === "number" ? parsed.summary.totalDisposalCost : defaultSummary.totalDisposalCost,
        totalOtherCost: typeof parsed.summary.totalOtherCost === "number" ? parsed.summary.totalOtherCost : defaultSummary.totalOtherCost,
        revenueOffsets: typeof parsed.summary.revenueOffsets === "number" ? parsed.summary.revenueOffsets : defaultSummary.revenueOffsets,
        netAnnualOpex: typeof parsed.summary.netAnnualOpex === "number" ? parsed.summary.netAnnualOpex : defaultSummary.netAnnualOpex,
        opexPerUnit: parsed.summary.opexPerUnit || undefined,
        opexAsPercentOfCapex: typeof parsed.summary.opexAsPercentOfCapex === "number"
          ? parsed.summary.opexAsPercentOfCapex
          : defaultSummary.opexAsPercentOfCapex,
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
    methodology: parsed.methodology || "Bottom-up operating cost estimate",
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

export interface OpexAIResult {
  results: OpexResults;
  provider: LLMProvider;
  providerLabel: string;
}

export async function generateOpexWithAI(
  upif: any,
  massBalanceResults: MassBalanceResults,
  capexResults: CapexResults | null,
  projectType: string,
  preferredModel: LLMProvider = "gpt5",
  storage?: any,
): Promise<OpexAIResult> {
  const normalizedType = normalizeProjectType(projectType);
  const promptKey = opexPromptMap[normalizedType] || "opex_type_a";

  let model = preferredModel;
  if (!isProviderAvailable(model)) {
    const fallback = getAvailableProviders()[0];
    if (!fallback) {
      throw new Error("No LLM provider is available. Configure an API key for OpenAI or Anthropic.");
    }
    console.log(`OpEx AI: ${model} not available, falling back to ${fallback}`);
    model = fallback;
  }

  const promptTemplate = await getPromptTemplate(promptKey, storage);
  const equipmentDataString = buildEquipmentDataString(massBalanceResults);
  const upifContextString = buildUpifContextString(upif);
  const capexDataString = buildCapexDataString(capexResults);

  const systemPrompt = promptTemplate
    .replace("{{EQUIPMENT_DATA}}", equipmentDataString)
    .replace("{{UPIF_DATA}}", upifContextString)
    .replace("{{CAPEX_DATA}}", capexDataString);

  console.log(`OpEx AI: Generating for project type ${normalizedType.toUpperCase()} using ${model} (prompt: ${promptKey})`);

  const isOpus = model === "claude-opus";
  const opexMaxTokens = isOpus ? 16384 : 32768;
  const opexUserMsg = isOpus
    ? `Generate a complete annual operating expenditure estimate based on the mass balance equipment list, project data, and capital cost estimate provided. Return valid JSON only. CRITICAL: Keep descriptions and notes extremely concise to reduce output size and prevent timeout.`
    : `Generate a complete annual operating expenditure estimate based on the mass balance equipment list, project data, and capital cost estimate provided. Return valid JSON only. Keep the response concise to stay within output limits.`;

  const response = await llmComplete({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: opexUserMsg },
    ],
    maxTokens: opexMaxTokens,
    jsonMode: true,
  });

  console.log(`OpEx AI: Response received from ${response.provider}, ${response.content.length} chars, stop_reason=${response.stopReason || "unknown"}`);

  let rawContent = response.content;
  rawContent = rawContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (parseError) {
    console.log("OpEx AI: Initial JSON parse failed, attempting truncation repair...");
    try {
      parsed = repairTruncatedJSON(rawContent);
      console.log("OpEx AI: Successfully repaired truncated JSON");
    } catch (repairError) {
      console.error("OpEx AI: Failed to parse or repair JSON response:", rawContent.substring(0, 500));
      throw new Error(`AI returned invalid JSON. Parse error: ${(parseError as Error).message}`);
    }
  }

  const totalProjectCapex = capexResults?.summary?.totalProjectCost || 0;
  const results = validateOpexResults(parsed, totalProjectCapex);

  return {
    results,
    provider: response.provider as LLMProvider,
    providerLabel: providerLabels[response.provider as LLMProvider] || response.provider,
  };
}
