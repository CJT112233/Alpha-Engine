/**
 * Unified LLM Service Abstraction Layer
 * 
 * This module provides a unified interface for interacting with multiple LLM providers:
 * - GPT-5 (via OpenAI API)
 * - Claude Sonnet 4.6 (via Anthropic API - with Replit integration support)
 * - Claude Opus 4.6 (via Anthropic direct API only)
 * 
 * The abstraction handles provider availability detection, automatic fallback selection,
 * and provider-specific configuration (e.g., Claude's system message handling).
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

/**
 * LLMProvider: Union type representing all supported LLM providers.
 * - "gpt5": OpenAI's GPT-5 model
 * - "claude": Anthropic Claude Sonnet 4.6
 */
export type LLMProvider = "gpt5" | "claude";

/**
 * LLMMessage: Represents a single message in the conversation history.
 * - role: The participant in the conversation ("system" for instructions, "user" for input, "assistant" for AI response)
 * - content: The actual text content of the message
 */
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * LLMCompletionOptions: Configuration for requesting an LLM completion.
 * - model: The LLM provider to use (gpt5 or claude)
 * - messages: Conversation history to include in the request
 * - maxTokens: Maximum tokens in the response (default: 8192)
 * - jsonMode: If true, forces the model to respond with valid JSON only
 */
export interface LLMCompletionOptions {
  model: LLMProvider;
  messages: LLMMessage[];
  maxTokens?: number;
  jsonMode?: boolean;
}

/**
 * LLMCompletionResult: Response from an LLM completion request.
 * - content: The generated text response from the model
 * - provider: Which provider was actually used (may differ from requested if fallback occurred)
 * - promptTokens: Number of tokens consumed from the input
 * - completionTokens: Number of tokens consumed in the response
 */
export interface LLMCompletionResult {
  content: string;
  provider: LLMProvider;
  promptTokens?: number;
  completionTokens?: number;
  stopReason?: string;
}

// OpenAI client initialization - used for GPT-5 requests
// Extended timeout (10 min) to handle large mass balance / capex generations with slower models
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 300000,
});

/**
 * Anthropic Client Initialization Strategy
 * 
 * The system maintains TWO separate Anthropic client configurations to support different deployment modes:
 * 
 * 1. DIRECT API KEY (ANTHROPIC_API_KEY):
 *    - Direct connection to Anthropic API using user-provided or managed API key
 *    - Supports ALL Anthropic models including Claude Opus 4.6 (not available via integration)
 *    - Fallback option when integration is unavailable
 * 
 * 2. REPLIT INTEGRATION PROXY (AI_INTEGRATIONS_ANTHROPIC_*):
 *    - Routes requests through Replit's integration proxy (baseURL override)
 *    - Only supports a limited set of models defined in integrationSupportedModels
 *    - Provides managed API key handling and enterprise features
 *    - Requires both API key AND baseURL to be configured
 */

const directAnthropicKey = process.env.ANTHROPIC_API_KEY;
const integrationAnthropicKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

// Config for direct Anthropic API access - tries integration key as fallback
const directAnthropicOptions: ConstructorParameters<typeof Anthropic>[0] = {
  apiKey: directAnthropicKey || integrationAnthropicKey,
  timeout: 300000,
};

// Config for Anthropic via Replit integration proxy - overrides baseURL to route through proxy
const integrationAnthropicOptions: ConstructorParameters<typeof Anthropic>[0] = {
  apiKey: integrationAnthropicKey || directAnthropicKey,
  timeout: 300000,
  ...(process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
    ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
    : {}),
};

// Client for direct API access (enables Claude Opus which integration doesn't support)
const directAnthropic = directAnthropicKey ? new Anthropic(directAnthropicOptions) : null;

// Client for Replit integration proxy (limited to integrationSupportedModels)
const integrationAnthropic = (integrationAnthropicKey && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL)
  ? new Anthropic(integrationAnthropicOptions)
  : null;

// Fallback client - ensures we always have a client instance, though it may fail if keys are missing
const anthropic = directAnthropic || integrationAnthropic || new Anthropic({ apiKey: "missing" });

/**
 * integrationSupportedModels: Set of Anthropic model IDs that are compatible with Replit's integration proxy.
 * Models NOT in this set must use the direct API client.
 * This constraint exists because the integration only exposes a curated subset of available models.
 */
const integrationSupportedModels = new Set([
  "claude-opus-4-6", "claude-opus-4-5", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1",
]);

/**
 * isAnthropicAvailable: Checks if ANY Anthropic client is available.
 * Returns true if either:
 * - Direct API key is configured, OR
 * - Both integration API key AND baseURL are configured
 * This ensures Claude Sonnet 4.6 (which supports both paths) can be used.
 */
function isAnthropicAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY || (!!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL);
}

/**
 * isProviderAvailable: Checks if a specific LLM provider can be used.
 * 
 * GPT-5: Requires OpenAI API key
 * Claude Sonnet: Requires any Anthropic config (direct or integration)
 * Claude Opus: ONLY works with direct API key - NOT supported by integration proxy
 *   - Opus is not in integrationSupportedModels, so it requires directAnthropicKey
 */
export function isProviderAvailable(provider: LLMProvider): boolean {
  if (provider === "gpt5") {
    return !!process.env.OPENAI_API_KEY;
  }
  if (provider === "claude") {
    return isAnthropicAvailable();
  }
  return false;
}

/**
 * getAvailableProviders: Returns list of LLM providers that are currently available.
 * Providers are enumerated based on configured API keys:
 * - GPT-5: Added if OpenAI API key is present
 * - Claude Sonnet: Added if any Anthropic configuration is available
 * - Claude Opus: Added only if direct Anthropic API key is configured
 * 
 * This is used for provider fallback selection and UI provider selection lists.
 */
export function getAvailableProviders(): LLMProvider[] {
  const providers: LLMProvider[] = [];
  if (isProviderAvailable("gpt5")) providers.push("gpt5");
  if (isAnthropicAvailable()) {
    providers.push("claude");
  }
  return providers;
}

export const providerLabels: Record<LLMProvider, string> = {
  gpt5: "GPT-5",
  claude: "Claude Sonnet 4.6",
};

/**
 * anthropicModelIds: Maps LLMProvider names to specific Claude model IDs for API calls.
 * 
 * Note on modelId fallback: In completeWithClaude(), if a provider lookup fails,
 * the modelId defaults to "claude-sonnet-4-6". This is safe because:
 * - Sonnet is the mid-tier, most widely supported model
 * - It's available via both direct API and integration proxy
 * - It balances performance with cost (better than Haiku, cheaper than Opus)
 * - The fallback gracefully degrades service availability
 */
const anthropicModelIds: Record<string, string> = {
  claude: "claude-sonnet-4-6",
};

/**
 * llmComplete: Main entry point for requesting LLM completions.
 * 
 * Implements automatic fallback logic:
 * 1. If requested provider is not available, silently falls back to first available provider
 * 2. If NO providers are available, throws an error with configuration guidance
 * 3. Routes to provider-specific completion functions (OpenAI vs Claude)
 * 
 * The requested model may differ from the provider returned in the result due to fallback.
 */
export async function llmComplete(options: LLMCompletionOptions): Promise<LLMCompletionResult> {
  let { model, messages, maxTokens = 8192, jsonMode = false } = options;

  const available = getAvailableProviders();
  if (available.length === 0) {
    throw new Error("No LLM provider is available. Configure an API key for OpenAI or Anthropic.");
  }

  if (!isProviderAvailable(model)) {
    const fallback = available[0];
    console.log(`LLM: ${model} not available, falling back to ${fallback}`);
    model = fallback;
  }

  const tryProvider = async (provider: LLMProvider): Promise<LLMCompletionResult> => {
    if (provider === "claude") {
      return await completeWithClaude(provider, messages, maxTokens, jsonMode);
    }
    return await completeWithOpenAI(messages, maxTokens, jsonMode);
  };

  try {
    return await tryProvider(model);
  } catch (error: any) {
    console.error(`LLM error with ${model}:`, error?.message || error);

    const fallbackProviders = available.filter(p => p !== model);
    for (const fallback of fallbackProviders) {
      try {
        console.log(`LLM: Retrying with fallback provider ${fallback} after ${model} failed`);
        const result = await tryProvider(fallback);
        console.log(`LLM: Fallback to ${fallback} succeeded`);
        return result;
      } catch (fallbackError: any) {
        console.error(`LLM: Fallback ${fallback} also failed:`, fallbackError?.message || fallbackError);
      }
    }

    throw new Error(`All LLM providers failed. Original error (${model}): ${error?.message || "Unknown error"}`);
  }
}

/**
 * completeWithOpenAI: Handles OpenAI GPT-5 API calls.
 * 
 * OpenAI-specific behavior:
 * - Passes messages directly to the API (no system message separation needed)
 * - Supports jsonMode via response_format parameter
 * - Returns token usage metrics from the response
 */
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
    temperature: 0,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  const finishReason = response.choices[0]?.finish_reason || "unknown";
  console.log(`LLM: OpenAI response finish_reason=${finishReason} prompt_tokens=${response.usage?.prompt_tokens} completion_tokens=${response.usage?.completion_tokens}`);

  if (finishReason === "length") {
    console.warn(`LLM: OpenAI response was TRUNCATED (hit max_completion_tokens=${maxTokens}). Output may be incomplete.`);
  }

  return {
    content: response.choices[0]?.message?.content || "",
    provider: "gpt5",
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
    stopReason: finishReason,
  };
}

/**
 * completeWithClaude: Handles Anthropic Claude API calls (both Sonnet and Opus).
 * 
 * Key Claude-specific behaviors:
 * 
 * SYSTEM MESSAGE HANDLING:
 * - Claude uses a separate `system` parameter, not a message with role="system"
 * - Separates system messages from user/assistant messages during request prep
 * - Combines all system messages into single system text parameter
 * 
 * CLIENT ROUTING (Smart Selection):
 * - Tries directAnthropic if: model is not in integrationSupportedModels OR integration unavailable
 *   (This ensures Claude Opus, which isn't integration-supported, uses direct client)
 * - Uses integrationAnthropic if: model IS in integrationSupportedModels AND available
 * - Falls back to generic anthropic client as last resort
 * 
 * JSON MODE:
 * - Appends explicit JSON instruction to system prompt since Claude has no native JSON mode
 * - After response, strips markdown code fences (```json ... ```) if present
 *   (Claude sometimes wraps JSON in fences despite instructions)
 * 
 * RESPONSE EXTRACTION:
 * - Filters response.content for only "text" blocks (ignores tool_use, etc.)
 * - Joins multiple text blocks with newlines (though single block is typical)
 * - Strips leading/trailing whitespace
 */
async function completeWithClaude(
  provider: LLMProvider,
  messages: LLMMessage[],
  maxTokens: number,
  jsonMode: boolean
): Promise<LLMCompletionResult> {
  // Claude uses separate system parameter - extract system messages from conversation
  const systemMessages = messages.filter(m => m.role === "system");
  const nonSystemMessages = messages.filter(m => m.role !== "system");

  // Combine all system messages into single system text
  const systemText = systemMessages.map(m => m.content).join("\n\n");

  // Add JSON enforcement instruction when in JSON mode
  let effectiveSystemText = systemText;
  if (jsonMode) {
    effectiveSystemText += "\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no code fences, no explanation outside the JSON object.";
  }

  // Convert LLMMessages to Claude message format (exclude system role)
  const claudeMessages = nonSystemMessages.map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Claude requires at least one message - add placeholder if none exist
  if (claudeMessages.length === 0) {
    claudeMessages.push({ role: "user", content: "Please respond." });
  }

  // Map provider to Claude model ID - defaults to Sonnet if lookup fails
  const modelId = anthropicModelIds[provider] || "claude-sonnet-4-6";

  let client: Anthropic;
  if (integrationAnthropic && integrationSupportedModels.has(modelId)) {
    client = integrationAnthropic;
    console.log(`LLM: Calling Anthropic (integration) model=${modelId} provider=${provider} maxTokens=${maxTokens} jsonMode=${jsonMode}`);
  } else if (directAnthropic) {
    client = directAnthropic;
    console.log(`LLM: Calling Anthropic (direct key) model=${modelId} provider=${provider} maxTokens=${maxTokens} jsonMode=${jsonMode}`);
  } else {
    client = anthropic;
    console.log(`LLM: Calling Anthropic (fallback) model=${modelId} provider=${provider} maxTokens=${maxTokens} jsonMode=${jsonMode}`);
  }

  // Use streaming to avoid Anthropic SDK's "Streaming is required for operations
  // that may take longer than 10 minutes" error on large generations
  const stream = client.messages.stream({
    model: modelId,
    max_tokens: maxTokens,
    temperature: 0,
    ...(effectiveSystemText ? { system: effectiveSystemText } : {}),
    messages: claudeMessages,
  });

  const response = await stream.finalMessage();

  const stopReason = response.stop_reason || "unknown";
  console.log(`LLM: Anthropic response stop_reason=${stopReason} content_blocks=${response.content.length} input_tokens=${response.usage?.input_tokens} output_tokens=${response.usage?.output_tokens}`);

  if (stopReason === "max_tokens") {
    console.warn(`LLM: Anthropic response was TRUNCATED (hit max_tokens=${maxTokens}). Output may be incomplete JSON. Model: ${modelId}`);
  }

  // Extract text from response content blocks, ignore non-text blocks
  const textBlocks = response.content.filter((b: any) => b.type === "text");
  let content = textBlocks.map((b: any) => b.text).join("\n").trim();

  if (jsonMode) {
    content = content.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  }

  return {
    content,
    provider,
    promptTokens: response.usage?.input_tokens,
    completionTokens: response.usage?.output_tokens,
    stopReason,
  };
}
