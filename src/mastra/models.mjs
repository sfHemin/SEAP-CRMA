// models.mjs — pick the LLM provider (Salesforce gateway or direct Anthropic)
// and expose two tiers: SONNET (fast, default) and OPUS (deep reasoning).
// ---------------------------------------------------------------------------
// Why two providers behind one switch:
//   - "gateway"   → the Salesforce internal model gateway, a LiteLLM proxy with
//                   an OpenAI-compatible /v1 API. No personal Anthropic key; all
//                   traffic is corporate-governed. This is the default.
//   - "anthropic" → the public Anthropic API with a personal ANTHROPIC_API_KEY.
//
// Both expose Claude Sonnet 4.6 and an Opus tier, so the agents don't care which
// backend is active — they just ask for `sonnet()` or `opus()`.
// ---------------------------------------------------------------------------

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";

const PROVIDER = (process.env.LLM_PROVIDER || "gateway").toLowerCase();

function buildGateway() {
  const baseURL = process.env.SF_GATEWAY_BASE_URL;
  const apiKey = process.env.SF_GATEWAY_TOKEN;
  if (!baseURL || !apiKey) {
    throw new Error("gateway provider needs SF_GATEWAY_BASE_URL and SF_GATEWAY_TOKEN in .env");
  }
  const gw = createOpenAICompatible({ name: "sf-gateway", baseURL, apiKey });
  return {
    sonnet: () => gw(process.env.GATEWAY_MODEL_SONNET || "claude-sonnet-4-6"),
    opus: () => gw(process.env.GATEWAY_MODEL_OPUS || "claude-opus-4-8-vertex"),
  };
}

function buildAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("anthropic provider needs ANTHROPIC_API_KEY in .env");
  const a = createAnthropic({ apiKey });
  return {
    sonnet: () => a(process.env.ANTHROPIC_MODEL_SONNET || "claude-sonnet-4-6"),
    opus: () => a(process.env.ANTHROPIC_MODEL_OPUS || "claude-opus-4-8"),
  };
}

const impl = PROVIDER === "anthropic" ? buildAnthropic() : buildGateway();

/** Fast, cheaper tier — default for chat, listing, simple edits. */
export const sonnet = impl.sonnet;
/** Deep-reasoning tier — recipe/dashboard authoring, tricky debugging. */
export const opus = impl.opus;
export const ACTIVE_PROVIDER = PROVIDER;
