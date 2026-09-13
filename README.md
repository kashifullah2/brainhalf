# BrainHalf 🧠⚡

> **The Autonomous AI Software Engineering Platform & Cloud IDE on the Edge**  
> Build, preview, edit, and ship modern full-stack web applications in seconds — powered by Cloudflare Workers, Durable Objects with SQLite, multi-model AI, and zero-cold-start edge transpilation.

Live Platform: **[brainhalf.com](https://brainhalf.com)** & **[www.brainhalf.com](https://www.brainhalf.com)**

---

## 🌟 Overview

**BrainHalf** is an end-to-end autonomous AI engineering workspace that runs entirely on Cloudflare's global edge network. It combines real-time AI code generation with an interactive IDE, Monaco code editor, and instant live preview environments.

Unlike traditional cloud IDEs that rely on heavy Docker containers or VMs with 30-second cold starts, BrainHalf compiles and executes full React applications directly at the edge in **under 100 milliseconds** using native ES modules and on-the-fly Sucrase transpilation.

---

## 🚀 Key Features

### 1. Dual Preview Engines
- **⚡ Cloudflare Edge Preview (`/preview/:projectId/`)**:
  - Zero cold-start execution on Cloudflare Workers.
  - On-the-fly Sucrase transpilation of JSX, TSX, TypeScript, and modern JavaScript.
  - Native browser ES Module Import Maps (`https://esm.sh/`) for pre-installed dependencies (React 18/19, ReactDOM, Lucide React, Framer Motion, Tailwind CSS).
  - Infallible mount harness with React `ErrorBoundary` and runtime error interception.
- **📦 Sandpack Virtual Bundler**:
  - In-browser CodeSandbox virtual bundler for client-side sandboxed testing.
  - Seamless toggle between Edge Preview and Sandpack directly from the preview header.

### 2. Multi-Model AI Engine
BrainHalf features a unified, model-agnostic streaming router supporting frontier models across multiple providers:
- **AWS Bedrock Provider**:
  - `Claude Opus 4.6`
  - `Claude Sonnet 4.6`
  - `MiniMax M2.5`
- **Cloudflare Workers AI Provider (Native Edge Binding)**:
  - `Qwen 2.5 Coder 32B Instruct` (`@cf/qwen/qwen2.5-coder-32b-instruct`)
  - `Qwen 3.8 27B` (`@cf/qwen/qwen3.8-27b`)
  - `GLM 5.3 Flash` (`@cf/zai-org/glm-5.3-flash`)
  - `Kimi K2.7 Code` (`@cf/moonshotai/kimi-k2.7-code`)
  - `Llama 3.3 70B Instruct` (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)

### 3. Unlimited Token Output & Stepping Ladder
- Automatically steps through a descending token limit ladder (`[16384, 8192, 4096, 2048]`) to guarantee the maximum possible completion length for every model without hitting provider-specific token caps.

### 4. Spec-Compliant Dual-MIME CSS Serving
- **Module Import Compatibility**: When a file executes `import './styles.css'`, the edge preview serves a spec-compliant JavaScript module (`Content-Type: application/javascript; charset=utf-8`) that injects a `<style>` element into `<head>` and exports the CSS string (`export default css`).
- **Stylesheet Compatibility**: When requested via `<link rel="stylesheet">`, it serves raw CSS (`Content-Type: text/css; charset=utf-8`).
- Completely eliminates browser strict MIME type violations.

### 5. Durable Object SQLite Persistence
- Every project session is bound to a unique Cloudflare Durable Object (`ChatAgent`) backed by embedded SQLite.
- Fully persists:
  - **`messages`**: Multi-turn conversation history and tool outputs.
  - **`project_files`**: Clean, synchronized project filesystem (`/src/App.jsx`, `/src/styles.css`, `/index.html`, etc.).

### 6. Interactive Monaco IDE & Workspace
- Resizable split-pane layout (Chat / Monaco Code Editor / Live Preview).
- Syntax highlighting, auto-completion, line numbers, and dark cyber aesthetics.
- Real-time file tree navigation and active file indicator.
- One-click ZIP export (`JSZip`) and project sharing via persistent URL query parameters (`?project=<id>`).

---

## 🏗️ System Architecture

```
                                  [ USER BROWSER ]
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
          [ WebSocket ]                                    [ HTTP / Preview ]
                 │                                               │
                 ▼                                               ▼
      ┌─────────────────────┐                         ┌─────────────────────┐
      │  Cloudflare Worker  │                         │  Cloudflare Worker  │
      │   (src/worker.ts)   │                         │   (src/worker.ts)   │
      └──────────┬──────────┘                         └──────────┬──────────┘
                 │                                               │
                 ▼                                               ▼
┌──────────────────────────────────┐            ┌──────────────────────────────────┐
│ Durable Object: ChatAgent        │            │ Durable Object: ChatAgent        │
│  - WebSocket onMessage / Stream  │            │  - /preview/:projectId/          │
│  - Embedded SQLite Database      │            │  - On-the-fly Sucrase Transpiler │
│     * messages                   │            │  - Import Maps & ESM Resolver    │
│     * project_files              │            │  - Dual-MIME CSS Injector        │
└──────────┬───────────────────────┘            └──────────────────────────────────┘
           │
           ├─────────────────────────────┐
           ▼                             ▼
┌───────────────────────┐   ┌───────────────────────┐
│ Cloudflare Workers AI │   │      AWS Bedrock      │
│  (env.AI Edge Binding)│   │  (Claude Sonnet/Opus, │
│  - Qwen 2.5 Coder 32B │   │   MiniMax M2.5)       │
│  - Llama 3.3 70B      │   └───────────────────────┘
│  - GLM 5.3 / Kimi     │
└───────────────────────┘
```

---

## 📁 Repository Structure

```
brainhalf/
├── src/
│   ├── agent.ts               # ChatAgent Durable Object (SQLite, AI streaming, Edge Preview router)
│   ├── worker.ts              # Cloudflare Worker entrypoint & preview request dispatcher
│   ├── App.tsx                # Main IDE application container
│   ├── index.css              # Global design system, glassmorphism tokens, animations
│   ├── components/
│   │   ├── ChatPanel.tsx      # AI chat interface, streaming token renderer, model selector
│   │   ├── Workspace.tsx      # Monaco code editor, file tree, Sandpack/Edge preview switcher
│   │   ├── TopNav.tsx         # Project name editor, export, share, settings modals
│   │   └── Sidebar.tsx        # Project list, creation, deletion, persistence
│   ├── lib/
│   │   ├── events.ts          # Type-safe pub/sub event bus (appEvents)
│   │   ├── message-parser.ts  # Streaming <file> & <edit> tag extractor and diff patcher
│   │   ├── project-store.ts   # LocalStorage project metadata & history store
│   │   ├── templates.ts       # Baseline starter templates (React + Tailwind + Lucide)
│   │   └── utils.ts           # Path normalization and file helpers
│   └── __tests__/             # Comprehensive Vitest unit and integration test suite
├── public/
│   ├── _headers               # Cloudflare Pages / Workers strict cache & security headers
│   └── favicon.svg            # Platform favicon
├── dist/                      # Production client build assets
├── wrangler.toml              # Cloudflare Workers configuration (DO, AI, Assets bindings)
├── vite.config.ts             # Vite build & bundler configuration
├── tsconfig.json              # TypeScript strict configuration
├── TODO.md                    # Platform roadmap & task backlog
├── PLATFORM_INFO.md           # Authoritative single-source-of-truth technical reference
└── package.json               # Project dependencies and npm scripts
```

---

## 🛠️ Getting Started

### Prerequisites
- **Node.js**: `v20.0.0` or higher
- **npm**: `v10.0.0` or higher
- **Cloudflare Account**: For Workers AI, Durable Objects, and Wrangler CLI deployment
- **AWS Bedrock Account** *(Optional)*: If utilizing Claude Sonnet 4.6 or MiniMax M2.5

### Installation
```bash
# Clone the repository
git clone https://github.com/kashifullah2/brainhalf.git
cd brainhalf

# Install dependencies
npm install
```

### Local Development
```bash
# Start Vite development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧪 Testing & Linting

BrainHalf maintains strict code quality standards:

```bash
# Run unit & integration test suite (61 tests)
npm test

# Run high-performance Oxlint
npm run lint

# TypeScript verification
npx tsc --noEmit
```

---

## 🚢 Deployment to Cloudflare Workers

### 1. Configure Cloudflare Credentials
Ensure you are authenticated with Wrangler:
```bash
npx wrangler login
```

### 2. Configure Environment Secrets
For AWS Bedrock models, set the following secrets in Cloudflare:
```bash
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
npx wrangler secret put AWS_REGION            # e.g., us-east-1
npx wrangler secret put BEDROCK_API_KEY       # optional alternative
```

### 3. Build & Deploy
```bash
# Build the client bundle
npm run build

# Deploy to Cloudflare Workers & Durable Objects
npx wrangler deploy
```

The application will be live at `https://brainhalf.com` and `https://www.brainhalf.com`.

---

## 📄 License

Private & Proprietary © BrainHalf. All rights reserved.
