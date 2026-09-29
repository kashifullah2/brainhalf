# Authoritative Model Registry: MODELS.md

Single source of truth for every model the BrainHalf platform accepts, as defined by
`MODEL_ALLOWLIST` in `src/lib/models.ts`. If a model is not in this table, the platform
refuses it — the allowlist is enforced server-side with exact-match resolution and no
substring or prefix dispatch.

## 1. Platform Policy

- **Strict zero-fallback**: an unknown model id or a missing provider credential produces
  an explicit error. The platform never silently substitutes another model.
- **Transport selection is not a fallback**: `claude-sonnet-6` exists once in the picker but
  has two allowlist entries (AWS Bedrock and Anthropic native). The agent picks whichever
  transport has credentials configured (`src/agent.ts`); the model identity never changes.
- **Default model**: `@cf/deepseek-ai/deepseek-v4-pro-0813` (`DEFAULT_MODEL_ID`).
- **Server ceiling**: `MAX_OUTPUT_TOKENS = 65536`, `AI_TIMEOUT_MS = 600,000`.
- **Cloudflare token ladder**: `[32768, 16384, 8192, 4096]` — retries step down only after
  compatible token-limit failures (`src/agent.ts`, `TOKEN_LADDER`).
- **Generation bounds**: `maxSteps` 1–20 (default 10), `maxTokens` 300–65536
  (`src/lib/generation-controls.ts`).

## 2. Model Catalog

### Category A: Cloudflare Workers AI (edge binding `env.AI`)

| Picker name | Model ID | Max output | Vision input | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `@cf/deepseek-ai/deepseek-v4-pro-0813` | same | 65,536 | No | **Default** in browser and server |
| `@cf/openai/gpt-oss-120b` | same | 65,536 | No | |
| `@cf/moonshotai/kimi-k2.7-code` | same | 65,536 | Yes | |
| `@cf/qwen/qwen3.8-27b` | same | 32,768 | No | Capped at 32k: truncates JSX mid-token at higher ceilings |

Server-resolvable but hidden from the picker (`clientSelectable: false`):

| Name | Max output | Reason |
| :--- | :--- | :--- |
| `@cf/zai-org/glm-5.3-flash` | 8,192 | Times out on all generation levels; kept resolvable so saved sessions do not hard-error |

### Category B: AWS Bedrock (`@ai-sdk/amazon-bedrock`)

Credentials: `BEDROCK_API_KEY` / `AWS_BEARER_TOKEN_BEDROCK` / `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`.

| Picker name | Bedrock inference ID | Max output | Vision input |
| :--- | :--- | :--- | :--- |
| `claude-sonnet-6` | `us.anthropic.claude-sonnet-4-6` | 8,192 | Yes |
| `kimi-k3` | `us.moonshotai.kimi-k3` | 8,192 | No |

### Category C: Anthropic native (`@ai-sdk/anthropic`)

Credential: `ANTHROPIC_API_KEY`.

| Name | Model ID | Max output | Notes |
| :--- | :--- | :--- | :--- |
| `claude-sonnet-6` | `claude-sonnet-4-6` | 8,192 | Transport-only entry (`clientSelectable: false`). Used when the Anthropic key is configured and no Bedrock credential is available. Never shown as a second picker entry. |

### Category D: Atria ASI (OpenAI-compatible via `@ai-sdk/openai`)

Credential: `ATRIA_API_KEY`; endpoint override `ATRIA_BASE_URL` (default `https://api.atria-asi.ai/v1`).

| Picker name | Model ID | Max output |
| :--- | :--- | :--- |
| `Atria-Dawn-Preview` | `Atria-Dawn-Preview` | 64,000 |

## 3. Removed Providers & Models

- **Dahl / MiniMax M2.7** — removed from the picker, the server allowlist, the provider
  union, and runtime configuration. `requiredProviders` rejects `dahl` as unsupported.
- **Anthropic native model catalog (Claude 3.x, Opus 4.x picker entries)** — collapsed to
  the single `claude-sonnet-6` transport entry above.
- **Image-synthesis entries (e.g. FLUX)** — not part of the generation allowlist.

## 4. Adding a Model Safely

1. Add one entry to the provider array in `src/lib/models.ts`. The picker derives from
   `CLIENT_SELECTABLE_MODELS`, so a picker-only entry is impossible by construction.
2. Choose `maxTokens` conservatively; provider ceilings above the model's real stable
   output corrupt generated files (see the `qwen3.8-27b` cap).
3. If the model accepts image input, add its picker name to `acceptsImageInput`.
4. Run `npx vitest run src/__tests__/model-allowlist.test.ts` — the catalog contract test.
