# Agent SDK Architectural Evaluation & Benchmark

This document presents an objective, empirical evaluation of candidate agent frameworks for **BrainHalf's orchestration layer** (the core engine running on Cloudflare Workers & Durable Objects), evaluating whether the current stack (`agents` + `ai`) remains optimal or should be replaced or augmented.

---

## 1. Architectural Constraints of BrainHalf

BrainHalf operates under specific platform requirements:
1. **Edge Runtime**: Cloudflare Workers V8 JavaScript Isolates (no Node.js native C++ addons, no arbitrary sub-process spawning, no native Python wheels).
2. **Persistence**: Cloudflare Durable Objects backed by embedded SQLite (`ChatAgent` class in `src/agent.ts`).
3. **Transport**: Real-time bidirectional WebSockets to the browser client with chunked token streaming and binary file sync.
4. **Multi-Provider Model Routing**: Dynamic routing across Cloudflare Workers AI (`env.AI`), AWS Bedrock (`@aws-sdk/client-bedrock-runtime`), and Anthropic API.
5. **Language**: 100% TypeScript / ES Modules codebase.

---

## 2. Evaluation of Candidate Agent SDKs

### Candidate 1: Cloudflare Agents SDK (`agents`) — *Current Baseline*
- **Package**: `npm: agents` (v0.22.0)
- **Edge Runtime Compatibility**: **10/10** (Native, built by Cloudflare specifically for Workers and Durable Objects).
- **TypeScript Support**: **10/10** (Native TypeScript).
- **Multi-Provider Routing**: **10/10** (Delegates LLM calls to any provider while managing agent lifecycle).
- **Streaming & WebSockets**: **10/10** (Built-in WebSocket connection management via `Agent.onConnect` / `onMessage`).
- **State & SQLite**: **10/10** (Direct native access to Durable Object SQLite storage `this.sql` and `this.ctx.storage`).
- **Maturity**: Production-ready on Cloudflare.
- **Verdict**: **ESSENTIAL BASELINE — KEEP**. Powers BrainHalf's stateful, persistent, edge-native backend seamlessly.

---

### Candidate 2: Vercel AI SDK (`ai`) — *Current Baseline*
- **Package**: `npm: ai` (v7.0.97) + `@ai-sdk/*`
- **Edge Runtime Compatibility**: **10/10** (Full edge support; standard Fetch/Streams API compliant).
- **TypeScript Support**: **10/10** (First-class TypeScript with Zod tool schemas).
- **Multi-Provider Routing**: **10/10** (Supports `@ai-sdk/amazon-bedrock`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, and custom fetch providers).
- **Streaming & WebSockets**: **10/10** (`streamText({ ... })` emits async iterables piped directly into WebSocket frames).
- **State & SQLite**: **8/10** (Stateless by design; complements Durable Object state without fighting it).
- **Maturity**: Industry standard, actively maintained, widely adopted.
- **Verdict**: **ESSENTIAL BASELINE — KEEP**. The cleanest multi-provider LLM abstraction for edge environments.

---

### Candidate 3: Google Antigravity SDK (`google-antigravity`)
- **Package**: PyPI `google-antigravity`
- **Edge Runtime Compatibility**: **1/10** (Hard incompatibility with Cloudflare Workers; bundles a compiled C/Go runtime binary executable).
- **TypeScript Support**: **2/10** (Python-first library; no official TypeScript edge package).
- **Multi-Provider Routing**: **5/10** (Primarily tailored for Google Gemini / Vertex AI models).
- **Streaming & WebSockets**: **7/10** (Async generator in Python; requires external WebSocket wrapper).
- **State & SQLite**: **6/10** (Own state engine; conflicts with Cloudflare Durable Objects).
- **Maturity**: Pre-v1.0.
- **Verdict**: **NOT SUITABLE FOR DIRECT WORKER EMBEDDING**. Cannot run inside Cloudflare Workers edge isolates. If Antigravity capabilities (autonomous command loop, MCP) are desired, it must run as an external Python sidecar service proxying requests to BrainHalf, or BrainHalf can adopt the official Google GenAI TypeScript SDK (`@google/genai`) for native edge Gemini execution.

---

### Candidate 4: LangGraph (`@langchain/langgraph`)
- **Package**: `npm: @langchain/langgraph`
- **Edge Runtime Compatibility**: **7/10** (TypeScript version runs in JS runtimes, but carries heavy LangChain dependency graph).
- **TypeScript Support**: **9/10** (Comprehensive TypeScript types).
- **Multi-Provider Routing**: **9/10** (LangChain integration ecosystem).
- **Streaming & WebSockets**: **7/10** (Complex event stream model).
- **State & SQLite**: **5/10** (LangGraph has its own Checkpointer abstractions that duplicate or clash with Durable Object SQLite).
- **Maturity**: High, widely used for enterprise graph workflows.
- **Migration Cost**: High (requires rewriting linear agent loop into state graph nodes and edges).
- **Verdict**: **OVERKILL / ARCHITECTURAL MISFIT**. The state graph model fights against Durable Object single-threaded actors and adds significant bundle bloat.

---

### Candidate 5: OpenAI Agents SDK
- **Package**: `npm: @openai/agents` / Swarm TS
- **Edge Runtime Compatibility**: **8/10** (Lightweight HTTP/JSON).
- **TypeScript Support**: **8/10** (TypeScript packages available).
- **Multi-Provider Routing**: **3/10** (Heavily tied to OpenAI API contracts; difficult to route to Bedrock Claude or Cloudflare Workers AI without adapters).
- **Verdict**: **NOT RECOMMENDED**. Provider lock-in violates BrainHalf's multi-provider requirement.

---

### Candidate 6: Claude Agent SDK (Anthropic)
- **Package**: `npm: @anthropic-ai/sdk` + Model Context Protocol
- **Edge Runtime Compatibility**: **9/10** (Clean Web Fetch implementation).
- **TypeScript Support**: **10/10** (Excellent native TypeScript).
- **Multi-Provider Routing**: **6/10** (Direct Anthropic calls; Bedrock requires AWS signing adapter).
- **Streaming & WebSockets**: **9/10** (Native server-sent events / streaming iterators).
- **MCP Support**: **10/10** (Anthropic is the author and reference implementation of MCP).
- **Verdict**: **HIGH VALUE FOR FUTURE TOOLS**. Worth adopting the Anthropic MCP TypeScript SDK specifically for tool/skill plugins, alongside the current Vercel AI SDK.

---

### Candidate 7: Mastra
- **Package**: `npm: @mastra/core`
- **Edge Runtime Compatibility**: **7/10** (TypeScript-first agent framework; edge support is evolving).
- **TypeScript Support**: **10/10** (Clean TypeScript-first DX).
- **Multi-Provider Routing**: **8/10** (Supports multiple LLMs via unified adapter).
- **MCP Support**: **9/10** (Native MCP client/server tooling).
- **State & SQLite**: **6/10** (Assumes LibSQL/Postgres backend; requires custom driver for Durable Object SQLite).
- **Maturity**: Rapidly growing (adopted by modern TS platforms), but still maturing.
- **Migration Cost**: Medium-High.
- **Verdict**: **STRONG CANDIDATE FOR FUTURE MONITORING**. Excellent TypeScript ergonomics, but replacing the existing, battle-tested `agents` + `ai` stack today offers marginal upside while introducing new runtime dependencies.

---

### Candidate 8: AWS Bedrock AgentCore (Strands Agents)
- **Package**: `@aws-sdk/client-bedrock-agent-runtime`
- **Edge Runtime Compatibility**: **8/10** (Runs via AWS SDK v3 with standard crypto).
- **TypeScript Support**: **9/10** (Official AWS SDK v3 types).
- **Multi-Provider Routing**: **2/10** (Strict AWS Bedrock lock-in; cannot invoke Cloudflare Workers AI or local edge models).
- **State Management**: **5/10** (AWS-managed session state stored in AWS cloud; desynced from Cloudflare DO SQLite).
- **Verdict**: **NOT RECOMMENDED AS PRIMARY ENGINE**. Violates edge autonomy and multi-provider agility.

---

## 3. Comparison Matrix

| Framework | Edge Worker Runtime | TypeScript Native | Multi-Provider Routing | Streaming / WS Fit | State Compatibility (DO SQLite) | Recommendation |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Cloudflare Agents SDK (`agents`)** | **10/10** | **10/10** | **10/10** | **10/10** | **10/10** | **KEEP (Core DO Architecture)** |
| **Vercel AI SDK (`ai`)** | **10/10** | **10/10** | **10/10** | **10/10** | **8/10** | **KEEP (Core LLM Streaming)** |
| **Google Antigravity SDK** | 1/10 | 2/10 | 5/10 | 7/10 | 6/10 | **Use via Python Sidecar only** |
| **LangGraph** | 7/10 | 9/10 | 9/10 | 7/10 | 5/10 | Reject (Overkill / Duplicates DO state) |
| **OpenAI Agents SDK** | 8/10 | 8/10 | 3/10 | 7/10 | 7/10 | Reject (Vendor Lock-in) |
| **Claude Agent SDK / MCP** | 9/10 | 10/10 | 6/10 | 9/10 | 8/10 | **Adopt MCP Tooling Alongside** |
| **Mastra** | 7/10 | 10/10 | 8/10 | 8/10 | 6/10 | Monitor (Future Candidate) |
| **AWS Bedrock AgentCore** | 8/10 | 9/10 | 2/10 | 6/10 | 5/10 | Reject (Vendor Lock-in) |

---

## 4. Final Architectural Recommendation

1. **Retain the Primary Stack**: The combination of **Cloudflare Agents SDK (`agents`)** (for Durable Object lifecycle, WebSockets, and SQLite state) and **Vercel AI SDK (`ai`)** (for multi-provider model routing, token streaming, and Zod tool validation) is the most performant, edge-native, and battle-tested architecture for BrainHalf.
2. **Selective Tool Augmentation (MCP)**: Adopt Anthropic's **Model Context Protocol (`@modelcontextprotocol/sdk`)** directly inside `src/agent.ts` to support extensible custom tools and skills without rewriting the core agent loop.
3. **Do Not Migrate to Python SDKs**: Do not attempt to embed Python-only runtimes (such as `google-antigravity`) directly into the Cloudflare Worker. If Antigravity-specific agent loops are desired, deploy them as a dedicated Python microservice proxying back to BrainHalf.
