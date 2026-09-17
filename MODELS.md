# Authoritative Model Registry: MODELS.md

This document serves as the authoritative, single-source-of-truth registry of every LLM and AI model supported, exposed, or handled by the BrainHalf platform as defined in `src/lib/models.ts` and `src/agent.ts`.

## 1. Platform Policy & Fallback Architecture
- **Strict Zero-Fallback Policy**:
  Any request specifying an unsupported model, unknown identifier, or missing credentials triggers an immediate explicit HTTP 400/500 error. The platform strictly prohibits silent fallback, model substitution, or degradation to default models.
- **Descending Token Ladder** (Cloudflare Workers AI):
  `[65536, 32768, 16384, 8192]`. Starts at the maximum ceiling to avoid partial truncation.
- **Server Ceiling**: `MAX_OUTPUT_TOKENS = 65536` (`AI_TIMEOUT_MS = 600,000ms`).

---

## 2. Model Catalog

### Category A: Cloudflare Workers AI (Edge Native)
Bindings: `env.AI` directly on Cloudflare Edge Worker.

| Model Name / Selector | Concrete Model ID | Streaming Support | Key Location | Fallback Policy | Max Output Tokens |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Yes (SSE / stream: true) | Cloudflare `env.AI` binding | Strict Zero-Fallback (refuse if unbound) | 65,536 |
| `@cf/openai/gpt-oss-20b` | `@cf/openai/gpt-oss-20b` | Yes (SSE / stream: true) | Cloudflare `env.AI` binding | Strict Zero-Fallback (refuse if unbound) | 65,536 |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | `@cf/meta/llama-4-scout-17b-16e-instruct` | Yes (SSE / stream: true) | Cloudflare `env.AI` binding | Strict Zero-Fallback (refuse if unbound) | 65,536 |
| `@cf/openai/gpt-oss-120b` | `@cf/openai/gpt-oss-120b` | Yes (SSE / stream: true) | Cloudflare `env.AI` binding | Strict Zero-Fallback (refuse if unbound) | 65,536 |
| `@cf/moonshotai/kimi-k2.7-code` | `@cf/moonshotai/kimi-k2.7-code` | Yes (SSE / stream: true) | Cloudflare `env.AI` binding | Strict Zero-Fallback (refuse if unbound) | 65,536 |
| `@cf/qwen/qwen2.5-coder-32b-instruct` | `@cf/qwen/qwen2.5-coder-32b-instruct` | Yes (SSE / stream: true) | Cloudflare `env.AI` binding | Strict Zero-Fallback (refuse if unbound) | 65,536 |
| `@cf/qwen/qwen3.8-27b` | `@cf/qwen/qwen3.8-27b` | Yes (SSE / stream: true) | Cloudflare `env.AI` binding | Strict Zero-Fallback (refuse if unbound) | 65,536 |
| `@cf/black-forest-labs/flux-1-schnell` | `@cf/black-forest-labs/flux-1-schnell` | No (Binary image synthesis) | Cloudflare `env.AI` binding | Strict Zero-Fallback | N/A (Image Tool) |

### Category B: Anthropic Native Provider
SDK: `@ai-sdk/anthropic` (`createAnthropic`).

| Model Name / Selector | Concrete Model ID | Streaming Support | Key Location | Fallback Policy | Max Output Tokens |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `claude-3-7-sonnet` | `claude-3-7-sonnet-20250219` | Yes (`streamText`) | `env.ANTHROPIC_API_KEY` | Strict Zero-Fallback | 64,000 |
| `claude-3-5-sonnet` | `claude-3-5-sonnet-20241022` | Yes (`streamText`) | `env.ANTHROPIC_API_KEY` | Strict Zero-Fallback | 64,000 |
| `claude-3-opus` | `claude-3-opus-20240229` | Yes (`streamText`) | `env.ANTHROPIC_API_KEY` | Strict Zero-Fallback | 64,000 |
| `claude-3-5-haiku` | `claude-3-5-haiku-20241022` | Yes (`streamText`) | `env.ANTHROPIC_API_KEY` | Strict Zero-Fallback | 64,000 |
| `claude-sonnet-4.6` | `claude-sonnet-4-6` | Yes (`streamText`) | `env.ANTHROPIC_API_KEY` | Strict Zero-Fallback | 64,000 |
| `claude-opus-4.6` | `claude-opus-4-6` | Yes (`streamText`) | `env.ANTHROPIC_API_KEY` | Strict Zero-Fallback | 64,000 |

### Category C: AWS Bedrock Provider
SDK: `@ai-sdk/amazon-bedrock` (`createAmazonBedrock`).

| Model Name / Selector | Concrete Model ID | Streaming Support | Key Location | Fallback Policy | Max Output Tokens |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `claude-opus-4.6` | `us.anthropic.claude-opus-4-6-v1:0` | Yes (`streamText`) | `env.BEDROCK_API_KEY` or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Strict Zero-Fallback | 64,000 |
| `claude-sonnet-4.6` | `us.anthropic.claude-sonnet-4-6-v1:0` | Yes (`streamText`) | `env.BEDROCK_API_KEY` or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Strict Zero-Fallback | 64,000 |
| `claude-sonnet` | `us.anthropic.claude-sonnet-4-6-v1:0` | Yes (`streamText`) | `env.BEDROCK_API_KEY` or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Strict Zero-Fallback | 64,000 |
| `minimax-m2.5` | `minimax.minimax-m2.5` | Yes (`streamText`) | `env.BEDROCK_API_KEY` or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Strict Zero-Fallback | 64,000 |
| `minimax` | `minimax.minimax-m2.5` | Yes (`streamText`) | `env.BEDROCK_API_KEY` or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Strict Zero-Fallback | 64,000 |

### Category D: Atria ASI Provider
SDK: `@ai-sdk/openai` (`createOpenAI` with OpenAI-compatible endpoint `https://api.atria-asi.ai/v1`).

| Model Name / Selector | Concrete Model ID | Streaming Support | Key Location | Fallback Policy | Max Output Tokens |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `Atria-Dawn-Preview` | `Atria-Dawn-Preview` | Yes (`streamText`) | `env.ATRIA_API_KEY` (override: `env.ATRIA_BASE_URL`) | Strict Zero-Fallback | 64,000 |

