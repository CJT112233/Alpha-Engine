import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export type LLMProvider = "gpt5" | "claude" | "claude-opus";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompletionOptions {
  model: LLMProvider;
  messages: LLMMessage[];
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LLMCompletionResult {
  content: string;
  provider: LLMProvider;
  promptTokens?: number;
  completionTokens?: number;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const directAnthropicKey = process.env.ANTHROPIC_API_KEY;
const integrationAnthropicKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

const directAnthropicOptions: ConstructorParameters<typeof Anthropic>[0] = {
  apiKey: directAnthropicKey || integrationAnthropicKey,
};

const integrationAnthropicOptions: ConstructorParameters<typeof Anthropic>[0] = {
  apiKey: integrationAnthropicKey || directAnthropicKey,
  ...(process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
    ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
    : {}),
};

const directAnthropic = directAnthropicKey ? new Anthropic(directAnthropicOptions) : null;

const integrationAnthropic = (integrationAnthropicKey && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL)
  ? new Anthropic(integrationAnthropicOptions)
  : null;

const anthropic = directAnthropic || integrationAnthropic || new Anthropic({ apiKey: "missing" });

const integrationSupportedModels = new Set([
  "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1",
]);

function isAnthropicAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY || (!!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL);
}

export function isProviderAvailable(provider: LLMProvider): boolean {
  if (provider === "gpt5") {
    return !!process.env.OPENAI_API_KEY;
  }
  if (provider === "claude") {
    return isAnthropicAvailable();
  }
  if (provider === "claude-opus") {
    return !!directAnthropicKey;
  }
  return false;
}

export function getAvailableProviders(): LLMProvider[] {
  const providers: LLMProvider[] = [];
  if (isProviderAvailable("gpt5")) providers.push("gpt5");
  if (isAnthropicAvailable()) {
    providers.push("claude");
  }
  if (directAnthropicKey) {
    providers.push("claude-opus");
  }
  return providers;
}

export const providerLabels: Record<LLMProvider, string> = {
  gpt5: "GPT-5",
  claude: "Claude Sonnet 4.5",
  "claude-opus": "Claude Opus 4.6",
};

const anthropicModelIds: Record<string, string> = {
  claude: "claude-sonnet-4-5",
  "claude-opus": "claude-opus-4-6",
};

export async function llmComplete(options: LLMCompletionOptions): Promise<LLMCompletionResult> {
  let { model, messages, maxTokens = 8192, jsonMode = false } = options;

  if (!isProviderAvailable(model)) {
    const fallback = getAvailableProviders()[0];
    if (!fallback) {
      throw new Error("No LLM provider is available. Configure an API key for OpenAI or Anthropic.");
    }
    console.log(`LLM: ${model} not available, falling back to ${fallback}`);
    model = fallback;
  }

  try {
    if (model === "claude" || model === "claude-opus") {
      return await completeWithClaude(model, messages, maxTokens, jsonMode);
    }
    return await completeWithOpenAI(messages, maxTokens, jsonMode);
  } catch (error: any) {
    console.error(`LLM error with ${model}:`, error?.message || error);
    throw error;
  }
}

async function completeWithOpenAI(
  messages: LLMMessage[],
  maxTokens: number,
  jsonMode: boolean
): Promise<LLMCompletionResult> {
  console.log(`LLM: Calling OpenAI model=gpt-5 maxTokens=${maxTokens} jsonMode=${jsonMode}`);

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages,
    max_completion_tokens: maxTokens,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  return {
    content: response.choices[0]?.message?.content || "",
    provider: "gpt5",
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
  };
}

async function completeWithClaude(
  provider: LLMProvider,
  messages: LLMMessage[],
  maxTokens: number,
  jsonMode: boolean
): Promise<LLMCompletionResult> {
  const systemMessages = messages.filter(m => m.role === "system");
  const nonSystemMessages = messages.filter(m => m.role !== "system");

  const systemText = systemMessages.map(m => m.content).join("\n\n");

  let effectiveSystemText = systemText;
  if (jsonMode) {
    effectiveSystemText += "\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no code fences, no explanation outside the JSON object.";
  }

  const claudeMessages = nonSystemMessages.map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  if (claudeMessages.length === 0) {
    claudeMessages.push({ role: "user", content: "Please respond." });
  }

  const modelId = anthropicModelIds[provider] || "claude-sonnet-4-5";

  let client: Anthropic;
  if (directAnthropic && (!integrationSupportedModels.has(modelId) || !integrationAnthropic)) {
    client = directAnthropic;
    console.log(`LLM: Calling Anthropic (direct key) model=${modelId} provider=${provider} maxTokens=${maxTokens} jsonMode=${jsonMode}`);
  } else if (integrationAnthropic && integrationSupportedModels.has(modelId)) {
    client = integrationAnthropic;
    console.log(`LLM: Calling Anthropic (integration) model=${modelId} provider=${provider} maxTokens=${maxTokens} jsonMode=${jsonMode}`);
  } else {
    client = anthropic;
    console.log(`LLM: Calling Anthropic (fallback) model=${modelId} provider=${provider} maxTokens=${maxTokens} jsonMode=${jsonMode}`);
  }

  const response = await client.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    ...(effectiveSystemText ? { system: effectiveSystemText } : {}),
    messages: claudeMessages,
  });

  console.log(`LLM: Anthropic response stop_reason=${response.stop_reason} content_blocks=${response.content.length} types=${response.content.map(b => b.type).join(",")}`);

  const textBlocks = response.content.filter((b: any) => b.type === "text");
  let content = textBlocks.map((b: any) => b.text).join("\n").trim();

  if (jsonMode) {
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      content = fenceMatch[1].trim();
    }
  }

  return {
    content,
    provider,
    promptTokens: response.usage?.input_tokens,
    completionTokens: response.usage?.output_tokens,
  };
}
