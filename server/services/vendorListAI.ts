import { llmComplete, isProviderAvailable, getAvailableProviders, providerLabels, type LLMProvider } from "../llm";
import type { EquipmentItem, VendorList } from "@shared/schema";
import type { PromptKey } from "@shared/default-prompts";
import { DEFAULT_PROMPTS } from "@shared/default-prompts";

function buildEquipmentDataString(equipment: EquipmentItem[]): string {
  return equipment.map((eq, i) => {
    const specLines = Object.entries(eq.specs)
      .map(([key, spec]) => {
        const val = (spec.value !== null && typeof spec.value === "object" && "value" in spec.value)
          ? String((spec.value as any).value)
          : String(spec.value ?? "");
        return `    ${key}: ${val} ${spec.unit || ""}`.trim();
      })
      .join("\n");

    return [
      `Equipment ${i + 1}:`,
      `  ID: ${eq.id}`,
      `  Type: ${eq.equipmentType}`,
      `  Process: ${eq.process}`,
      `  Quantity: ${eq.quantity}`,
      `  Description: ${eq.description}`,
      `  Design Basis: ${eq.designBasis}`,
      `  Specs:`,
      specLines,
      eq.notes ? `  Notes: ${eq.notes}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

async function getPromptTemplate(key: PromptKey, storage?: any): Promise<string> {
  if (storage && typeof storage.getPromptTemplateByKey === "function") {
    try {
      const dbTemplate = await storage.getPromptTemplateByKey(key);
      if (dbTemplate?.template) return dbTemplate.template;
    } catch {
    }
  }
  return DEFAULT_PROMPTS[key]?.template || "";
}

export async function generateVendorListWithAI(
  equipment: EquipmentItem[],
  projectType: string,
  preferredModel: LLMProvider,
  storage?: any,
): Promise<{ vendorList: VendorList; providerLabel: string }> {
  const template = await getPromptTemplate("vendor_list", storage);
  if (!template) {
    throw new Error("Vendor list prompt template not found");
  }

  const equipmentData = buildEquipmentDataString(equipment);
  const projectContext = `Project Type: ${projectType}`;

  const prompt = template
    .replace("{{EQUIPMENT_DATA}}", equipmentData)
    .replace("{{PROJECT_CONTEXT}}", projectContext);

  const providersToTry: LLMProvider[] = [];
  if (isProviderAvailable(preferredModel)) {
    providersToTry.push(preferredModel);
  }
  const allProviders = getAvailableProviders();
  for (const p of allProviders) {
    if (!providersToTry.includes(p)) {
      providersToTry.push(p);
    }
  }

  if (providersToTry.length === 0) {
    throw new Error("No LLM providers available for vendor list generation");
  }

  let lastError: Error | null = null;
  for (const provider of providersToTry) {
    try {
      console.log(`Vendor List: Trying provider ${provider}...`);
      const result = await llmComplete({
        model: provider,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Generate the recommended vendor list for the equipment listed above. Return only valid JSON." },
        ],
        maxTokens: 8192,
        jsonMode: true,
      });

      let parsed: any;
      try {
        let content = result.content.trim();
        const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) content = fenceMatch[1].trim();
        parsed = JSON.parse(content);
      } catch (parseErr) {
        throw new Error(`Failed to parse vendor list JSON: ${(parseErr as Error).message}`);
      }

      if (!parsed.items || !Array.isArray(parsed.items)) {
        throw new Error("Vendor list response missing 'items' array");
      }

      for (const item of parsed.items) {
        if (!item.equipmentId || !item.equipmentType) {
          throw new Error("Vendor list item missing required fields (equipmentId, equipmentType)");
        }
        if (!Array.isArray(item.recommendations)) {
          item.recommendations = [];
        }
        item.quantity = item.quantity || 1;
        item.specsSummary = item.specsSummary || "";
        item.process = item.process || "";
      }

      const vendorList: VendorList = {
        items: parsed.items,
        generatedAt: new Date().toISOString(),
        modelUsed: providerLabels[provider] || provider,
      };

      return { vendorList, providerLabel: providerLabels[provider] || provider };
    } catch (err) {
      lastError = err as Error;
      console.warn(`Vendor List: Provider ${provider} failed:`, lastError.message);
    }
  }

  throw lastError || new Error("All providers failed for vendor list generation");
}
