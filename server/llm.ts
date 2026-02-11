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

const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
const anthropicOptions: ConstructorParameters<typeof Anthropic>[0] = {
  apiKey: anthropicApiKey,
};
if (!process.env.ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
  anthropicOptions.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
}
const anthropic = new Anthropic(anthropicOptions);

function isAnthropicAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY || (!!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL);
}

export function isProviderAvailable(provider: LLMProvider): boolean {
  if (provider === "gpt5") {
    return !!process.env.OPENAI_API_KEY;
  }
  if (provider === "claude" || provider === "claude-opus") {
    return isAnthropicAvailable();
  }
  return false;
}

export function getAvailableProviders(): LLMProvider[] {
  const providers: LLMProvider[] = [];
  if (isProviderAvailable("gpt5")) providers.push("gpt5");
  if (isAnthropicAvailable()) {
    providers.push("claude");
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

  if (model === "claude" || model === "claude-opus") {
    return completeWithClaude(model, messages, maxTokens, jsonMode);
  }
  return completeWithOpenAI(messages, maxTokens, jsonMode);
}

async function completeWithOpenAI(
  messages: LLMMessage[],
  maxTokens: number,
  jsonMode: boolean
): Promise<LLMCompletionResult> {
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

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    ...(effectiveSystemText ? { system: effectiveSystemText } : {}),
    messages: claudeMessages,
  });

  const textBlock = response.content.find(b => b.type === "text");
  let content = textBlock?.text || "";

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
