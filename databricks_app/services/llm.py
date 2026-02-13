import os
import re
import time
import logging
from typing import Literal, TypedDict, Optional

from openai import OpenAI
from databricks.sdk.core import Config, oauth_service_principal

logger = logging.getLogger(__name__)

LLMProvider = Literal[
    "databricks-gpt-5-2",
    "databricks-claude-opus-4-6",
    "databricks-gemini-3-pro",
    "databricks-claude-opus-4-5",
]

ALL_PROVIDERS: list[str] = [
    "databricks-gpt-5-2",
    "databricks-claude-opus-4-6",
    "databricks-gemini-3-pro",
    "databricks-claude-opus-4-5",
]

PROVIDER_LABELS: dict[str, str] = {
    "databricks-gpt-5-2": "GPT-5 (Databricks)",
    "databricks-claude-opus-4-6": "Claude Opus 4.6 (Databricks)",
    "databricks-gemini-3-pro": "Gemini 3 Pro (Databricks)",
    "databricks-claude-opus-4-5": "Claude Opus 4.5 (Databricks)",
}

CLAUDE_MODELS = {"databricks-claude-opus-4-6", "databricks-claude-opus-4-5"}
GPT_MODELS = {"databricks-gpt-5-2"}


class LLMMessage(TypedDict):
    role: str
    content: str


class LLMCompletionResult(TypedDict):
    content: str
    provider: str
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]


_token_cache: dict[str, object] = {
    "token": None,
    "expires_at": 0.0,
}

_TOKEN_TTL_SECONDS = 3000


def _get_databricks_config() -> Config:
    host = os.environ.get("DATABRICKS_HOST", "")
    client_id = os.environ.get("DATABRICKS_CLIENT_ID", "")
    client_secret = os.environ.get("DATABRICKS_CLIENT_SECRET", "")

    if not host or not client_id or not client_secret:
        raise RuntimeError(
            "Databricks credentials not configured. "
            "Set DATABRICKS_HOST, DATABRICKS_CLIENT_ID, and DATABRICKS_CLIENT_SECRET."
        )

    return Config(
        host=f"https://{host}" if not host.startswith("https://") else host,
        client_id=client_id,
        client_secret=client_secret,
    )


def _get_access_token() -> str:
    now = time.time()
    cached_token = _token_cache.get("token")
    expires_at = _token_cache.get("expires_at", 0.0)

    if cached_token and isinstance(expires_at, (int, float)) and now < expires_at:
        return str(cached_token)

    logger.info("Refreshing Databricks OAuth token")
    cfg = _get_databricks_config()
    header_factory = oauth_service_principal(cfg)
    headers = header_factory()
    token = headers.get("Authorization", "").replace("Bearer ", "")

    if not token:
        raise RuntimeError("Failed to obtain Databricks OAuth token")

    _token_cache["token"] = token
    _token_cache["expires_at"] = now + _TOKEN_TTL_SECONDS
    logger.info("Databricks OAuth token cached (TTL=%ds)", _TOKEN_TTL_SECONDS)
    return token


def _create_openai_client() -> OpenAI:
    token = _get_access_token()
    host = os.environ.get("DATABRICKS_HOST", "")
    if not host.startswith("https://"):
        host = f"https://{host}"

    return OpenAI(
        api_key=token,
        base_url=f"{host}/serving-endpoints",
    )


def get_available_providers() -> list[str]:
    return list(ALL_PROVIDERS)


def is_provider_available(provider: str) -> bool:
    return provider in ALL_PROVIDERS


def _strip_code_fences(text: str) -> str:
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        return match.group(1).strip()
    return text


def _is_claude_model(model: str) -> bool:
    return model in CLAUDE_MODELS


def _is_gpt_model(model: str) -> bool:
    return model in GPT_MODELS


def llm_complete(
    model: str,
    messages: list[LLMMessage],
    max_tokens: int = 8192,
    json_mode: bool = False,
) -> LLMCompletionResult:
    if not is_provider_available(model):
        fallback = get_available_providers()
        if not fallback:
            raise RuntimeError("No LLM providers available.")
        logger.warning("LLM: %s not available, falling back to %s", model, fallback[0])
        model = fallback[0]

    providers_to_try = [model] + [p for p in ALL_PROVIDERS if p != model]
    last_error: Optional[Exception] = None

    for attempt_model in providers_to_try:
        try:
            return _call_model(attempt_model, messages, max_tokens, json_mode)
        except Exception as e:
            last_error = e
            logger.error("LLM error with %s: %s", attempt_model, str(e))
            logger.info("LLM: Falling back from %s to next available model", attempt_model)

    raise RuntimeError(
        f"All LLM providers failed. Last error: {last_error}"
    )


def _call_model(
    model: str,
    messages: list[LLMMessage],
    max_tokens: int,
    json_mode: bool,
) -> LLMCompletionResult:
    logger.info(
        "LLM: Calling Databricks model=%s max_tokens=%d json_mode=%s",
        model, max_tokens, json_mode,
    )

    prepared_messages = list(messages)

    if json_mode and _is_claude_model(model):
        system_msgs = [m for m in prepared_messages if m["role"] == "system"]
        non_system_msgs = [m for m in prepared_messages if m["role"] != "system"]

        system_text = "\n\n".join(m["content"] for m in system_msgs)
        system_text += (
            "\n\nIMPORTANT: You MUST respond with valid JSON only. "
            "No markdown, no code fences, no explanation outside the JSON object."
        )

        prepared_messages = [{"role": "system", "content": system_text}] + non_system_msgs

    client = _create_openai_client()

    kwargs: dict = {
        "model": model,
        "messages": prepared_messages,
        "max_tokens": max_tokens,
    }

    if json_mode and _is_gpt_model(model):
        kwargs["response_format"] = {"type": "json_object"}

    response = client.chat.completions.create(**kwargs)

    content = response.choices[0].message.content or ""

    if json_mode:
        content = _strip_code_fences(content)

    prompt_tokens = response.usage.prompt_tokens if response.usage else None
    completion_tokens = response.usage.completion_tokens if response.usage else None

    logger.info(
        "LLM: Response from %s - prompt_tokens=%s completion_tokens=%s",
        model, prompt_tokens, completion_tokens,
    )

    return LLMCompletionResult(
        content=content,
        provider=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )
