import type { Env } from "../env";
import {
  FREEMODEL_DEFAULT_BASE_URL,
  FREEMODEL_DEFAULT_MODEL,
  FREEMODEL_LEGACY_MODEL,
  GROQ_DEFAULT_BASE_URL,
  GROQ_DEFAULT_MODEL,
  GEMINI_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
  CLOUDFLARE_DEFAULT_MODEL,
} from "@brainhalf/ai/providers";

function resolveFreeModelName(env: Env, userModel?: string): string {
  const raw =
    userModel || env.FREEMODEL_DEFAULT_MODEL || FREEMODEL_DEFAULT_MODEL;
  if (raw === FREEMODEL_LEGACY_MODEL) return FREEMODEL_DEFAULT_MODEL;
  return raw;
}

export function freemodelApiKey(env: Env): string | undefined {
  return env.FREEMODEL_API_KEY || env.FREEMODEL_API;
}

export function resolveEnvApiKey(
  env: Env,
  provider: string
): string | undefined {
  switch (provider) {
    case "Cerebras":
      return env.CEREBRAS_API_KEY;
    case "AgentRouter":
      return env.AGENT_ROUTER_API_KEY;
    case "OpenProvider":
      return env.OPENPROVIDER_API_KEY;
    case "FreeModel":
      return freemodelApiKey(env);
    case "Groq":
      return env.GROQ_API_KEY;
    case "Gemini":
      return env.GOOGLE_API_KEY;
    case "Cloudflare":
      return env.CLOUDFLARE_AI_API_TOKEN;
    default:
      return env.CEREBRAS_API_KEY || freemodelApiKey(env);
  }
}

export function providerHasEnvKey(env: Env, provider: string): boolean {
  if (provider === "Cloudflare") {
    return Boolean(env.CLOUDFLARE_AI_API_TOKEN && env.CLOUDFLARE_AI_BASE_URL);
  }
  return Boolean(resolveEnvApiKey(env, provider));
}

/** Primary + fallback providers when using platform keys from .dev.vars */
export function resolveProviderChain(env: Env): string[] {
  const chain: string[] = [];
  const add = (name: string) => {
    if (providerHasEnvKey(env, name) && !chain.includes(name)) chain.push(name);
  };

  const primary = env.DEFAULT_AI_PROVIDER?.trim();
  const fallback = env.DEFAULT_AI_PROVIDER_FALLBACK?.trim();

  if (primary) {
    add(primary);
  } else {
    add("Cerebras");
  }

  // Fallback supports a comma-separated list (e.g. "Groq,Gemini,FreeModel")
  if (fallback) {
    for (const name of fallback.split(",")) {
      const trimmed = name.trim();
      if (trimmed) add(trimmed);
    }
  }

  // Always append all remaining configured providers as a safety net so the
  // chain never dies because a single upstream returned 503.
  for (const name of [
    "Cerebras",
    "Cloudflare",
    "Groq",
    "Gemini",
    "FreeModel",
    "AgentRouter",
    "OpenProvider",
  ]) {
    add(name);
  }

  if (chain.length === 0) chain.push("Cerebras");
  return chain;
}

export function resolveDefaultProvider(env: Env): string {
  return resolveProviderChain(env)[0];
}

export function resolvePlatformProviderOptions(
  env: Env,
  provider: string,
  userConfig: { baseUrl?: string; model?: string } | null | undefined
): { baseUrl?: string; model?: string } {
  switch (provider) {
    case "FreeModel":
      return {
        baseUrl:
          userConfig?.baseUrl ||
          env.FREEMODEL_BASE_URL ||
          FREEMODEL_DEFAULT_BASE_URL,
        model: resolveFreeModelName(env, userConfig?.model),
      };
    case "Groq":
      return {
        baseUrl:
          userConfig?.baseUrl || env.GROQ_BASE_URL || GROQ_DEFAULT_BASE_URL,
        model:
          userConfig?.model || env.GROQ_DEFAULT_MODEL || GROQ_DEFAULT_MODEL,
      };
    case "Gemini":
      return {
        baseUrl:
          userConfig?.baseUrl || env.GOOGLE_BASE_URL || GEMINI_DEFAULT_BASE_URL,
        model:
          userConfig?.model || env.GOOGLE_DEFAULT_MODEL || GEMINI_DEFAULT_MODEL,
      };
    case "Cloudflare":
      return {
        baseUrl: userConfig?.baseUrl || env.CLOUDFLARE_AI_BASE_URL,
        model:
          userConfig?.model ||
          env.CLOUDFLARE_AI_DEFAULT_MODEL ||
          CLOUDFLARE_DEFAULT_MODEL,
      };
    default:
      return {
        baseUrl: userConfig?.baseUrl,
        model: userConfig?.model,
      };
  }
}
