"""Approved OpenRouter extraction models and privacy routing policy."""

from __future__ import annotations

APPROVED_EXTRACTION_MODEL = "anthropic/claude-haiku-5.5"
ALLOWED_OPENROUTER_MODELS: frozenset[str] = frozenset({APPROVED_EXTRACTION_MODEL})

# OpenRouter provider slugs documented for provider.only (not display names).
ALLOWED_OPENROUTER_PROVIDERS: tuple[str, ...] = ("google-vertex", "amazon-bedrock")


def build_provider_payload(
    providers: tuple[str, ...] = ALLOWED_OPENROUTER_PROVIDERS,
) -> dict[str, object]:
    """Build the mandatory no-fallback, zero-retention routing preferences."""
    if not providers:
        raise ValueError("OPENROUTER_PROVIDER_NOT_PRIVACY_ALLOWLISTED")
    return {
        "zdr": True,
        "data_collection": "deny",
        "require_parameters": True,
        "allow_fallbacks": False,
        "only": list(providers),
    }
