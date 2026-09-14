/**
 * BrainHalf Model & Agent Performance Benchmark — Central Configuration
 *
 * Consumed by orchestrator.spec.ts and task-check modules.
 * Controlled via environment variables:
 *   BENCHMARK_MODELS   — comma-separated model IDs to run (default: all)
 *   BENCHMARK_TASKS    — comma-separated task IDs to run (default: all)
 *   BASE_URL           — BrainHalf instance URL (default: http://localhost:5173)
 *   BENCHMARK_SKIP_ORCHESTRATOR — if "1", skip build step and use PREVIEW_URL directly
 *   PREVIEW_URL        — used only when BENCHMARK_SKIP_ORCHESTRATOR=1
 */

export const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** All available models in BrainHalf */
export const ALL_MODELS: ModelConfig[] = [
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B',
    provider: 'cloudflare',
  },
  {
    id: '@cf/qwen/qwen2.5-coder-32b-instruct',
    label: 'Qwen 2.5 Coder 32B',
    provider: 'cloudflare',
  },
  {
    id: '@cf/qwen/qwen3.8-27b',
    label: 'Qwen 3.8 27B',
    provider: 'cloudflare',
  },
  {
    id: '@cf/zai-org/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
    provider: 'cloudflare',
  },
  {
    id: '@cf/moonshotai/kimi-k2.7-code',
    label: 'Kimi K2.7 Code',
    provider: 'cloudflare',
  },
  {
    id: 'claude-opus-4.6',
    label: 'Claude Opus 4.6',
    provider: 'bedrock',
  },
  {
    id: 'claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    provider: 'bedrock',
  },
  {
    id: 'minimax-m2.5',
    label: 'MiniMax M2.5',
    provider: 'bedrock',
  },
];

/** Timeouts by tier (ms) */
export const TIER_TIMEOUT_MS: Record<Tier, number> = {
  easy: 90_000,
  medium: 150_000,
  hard: 240_000,
  very_hard: 360_000,
};

export type Tier = 'easy' | 'medium' | 'hard' | 'very_hard';

export interface ModelConfig {
  id: string;
  label: string;
  provider: 'cloudflare' | 'bedrock';
}

export interface TaskConfig {
  id: string;
  tier: Tier;
  title: string;
  buildPrompt: string;
  /** Number of Playwright checks in this task (for x/y reporting) */
  totalChecks: number;
}

export const ALL_TASKS: TaskConfig[] = [
  // ── EASY ──────────────────────────────────────────────────────────────────
  {
    id: 'easy-1',
    tier: 'easy',
    title: 'Unit Converter',
    totalChecks: 7,
    buildPrompt:
      "Build a unit converter app with three tabs: Length, Weight, Temperature. Each tab has an input field, a 'from' unit dropdown, a 'to' unit dropdown, and a live-updating result. Use a clean card layout with a single accent color. No backend needed, all conversion logic client-side.",
  },
  {
    id: 'easy-2',
    tier: 'easy',
    title: 'Todo List with Filters',
    totalChecks: 7,
    buildPrompt:
      "Build a todo list app: add task via input + Enter or button, mark complete via checkbox, delete via trash icon, filter by All/Active/Completed using tabs, and show a live count of remaining active tasks. Persist nothing to backend, just in-memory state.",
  },
  {
    id: 'easy-3',
    tier: 'easy',
    title: 'Color Palette Generator',
    totalChecks: 5,
    buildPrompt:
      'Build a tool that generates 5 random complementary color swatches on load and on button click. Each swatch shows its hex code, and clicking a swatch copies the hex to clipboard with a toast/confirmation.',
  },
  // ── MEDIUM ────────────────────────────────────────────────────────────────
  {
    id: 'medium-1',
    tier: 'medium',
    title: 'Kanban Board (Drag & Drop)',
    totalChecks: 6,
    buildPrompt:
      "Build a Kanban board with 3 columns: To Do, In Progress, Done. Users can add cards to any column, drag cards between columns, edit card title inline, and delete cards. Show a card count per column header. Persist state in-memory only.",
  },
  {
    id: 'medium-2',
    tier: 'medium',
    title: 'Multi-Step Signup Form',
    totalChecks: 8,
    buildPrompt:
      "Build a 3-step signup wizard: Step 1 (name, email with validation), Step 2 (password + confirm password with match validation), Step 3 (review + submit). Include a progress indicator, back/next buttons, and prevent advancing on invalid input. On submit, show a success screen with entered data summary.",
  },
  {
    id: 'medium-3',
    tier: 'medium',
    title: 'Product Catalog with Cart',
    totalChecks: 8,
    buildPrompt:
      "Build a product catalog page (8-10 mock products with name, price, image placeholder) with search-by-name filtering, category filter dropdown, and an 'Add to Cart' button per product. Include a cart drawer/sidebar showing items, quantities, per-item and total price, with quantity +/- controls and remove button.",
  },
  // ── HARD ──────────────────────────────────────────────────────────────────
  {
    id: 'hard-1',
    tier: 'hard',
    title: 'Analytics Dashboard with Charts',
    totalChecks: 7,
    buildPrompt:
      "Build an analytics dashboard with: a date-range selector (Last 7 days / 30 days / 90 days), a line chart of revenue over the selected range, a bar chart of top 5 products by sales, and 4 KPI cards (Total Revenue, Orders, Avg Order Value, Conversion Rate) that recompute when the date range changes. Use mock/generated data. Include a CSV export button for the currently visible data.",
  },
  {
    id: 'hard-2',
    tier: 'hard',
    title: 'Real-Time Chat UI (Simulated)',
    totalChecks: 7,
    buildPrompt:
      "Build a chat interface with a conversation list sidebar (5 mock contacts, showing last message preview and unread badge), a message thread view, a message input with send button, and simulated 'typing...' and auto-reply behavior (bot responds 1-2 seconds after user sends a message). Clicking a different contact switches the thread and clears its unread badge.",
  },
  {
    id: 'hard-3',
    tier: 'hard',
    title: 'Booking/Reservation Calendar',
    totalChecks: 7,
    buildPrompt:
      "Build a booking calendar app: month-view calendar, clicking a date opens a time-slot picker (9am-5pm, 1-hour slots), already-booked slots are disabled/greyed, booking a slot requires name + email, and booked slots show up visually on the calendar (e.g. a dot or count badge on that date). Include a 'My Bookings' list view showing all bookings with a cancel option that frees the slot back up.",
  },
  // ── VERY HARD ─────────────────────────────────────────────────────────────
  {
    id: 'very-hard-1',
    tier: 'very_hard',
    title: 'Full Project Management Tool',
    totalChecks: 10,
    buildPrompt:
      "Build a multi-page project management app: (1) a login screen (mock auth, any email/password combo succeeds, invalid formats rejected), (2) after login, a dashboard listing projects with create/delete, (3) clicking a project opens a Kanban board (To Do/In Progress/Done) scoped to that project with drag-and-drop, due dates, and priority tags (Low/Med/High, color-coded), (4) a reporting page showing task-completion rate charts per project, (5) a persistent top nav with logout. State must persist across page/route navigation within the session (not reset when navigating between dashboard and board).",
  },
  {
    id: 'very-hard-2',
    tier: 'very_hard',
    title: 'E-Commerce Storefront with Checkout Flow',
    totalChecks: 10,
    buildPrompt:
      "Build a full storefront: product listing with filters/search/sort (price low-high, high-low), product detail page (route per product with variant selection e.g. size/color), cart persisting across page navigation, a 3-step checkout (shipping info → payment mock form with card-number format validation → order review), and an order confirmation page with a generated order number. Include an order history page listing past mock orders.",
  },
  {
    id: 'very-hard-3',
    tier: 'very_hard',
    title: 'Collaborative Document Editor (Simulated)',
    totalChecks: 8,
    buildPrompt:
      "Build a simplified collaborative text editor: a document list sidebar, a rich-text editing area (bold/italic/underline/bullet list toolbar), auto-save indicator ('Saving...' → 'Saved' after 1s of inactivity), a simulated 'second user' cursor/highlight that appears in the doc after 5 seconds to mimic collaboration, version history showing last 3 saved versions with the ability to restore an older version, and a share-link generator that copies a mock URL to clipboard.",
  },
];

// ── Runtime filtering via env vars ──────────────────────────────────────────

function parseEnvList(varName: string): string[] | null {
  const raw = process.env[varName];
  if (!raw || !raw.trim()) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getEnabledModels(): ModelConfig[] {
  const filter = parseEnvList('BENCHMARK_MODELS');
  if (!filter) return ALL_MODELS;
  return ALL_MODELS.filter((m) => filter.includes(m.id) || filter.includes(m.label));
}

export function getEnabledTasks(): TaskConfig[] {
  const filter = parseEnvList('BENCHMARK_TASKS');
  if (!filter) return ALL_TASKS;
  return ALL_TASKS.filter((t) => filter.includes(t.id) || filter.includes(t.title));
}

export const SKIP_ORCHESTRATOR = process.env.BENCHMARK_SKIP_ORCHESTRATOR === '1';
export const DIRECT_PREVIEW_URL = process.env.PREVIEW_URL || '';

/** Selectors used to interact with BrainHalf IDE */
export const IDE_SELECTORS = {
  modelSelect: 'select[aria-label="Select AI Model"]',
  chatTextarea: 'textarea[placeholder*="BrainHalf"], textarea[placeholder*="idea"], textarea[placeholder*="architect"]',
  sendButton: 'button[title*="Send"]',
  stopButton: 'button[title*="Stop Generation"]',
  newProjectButton: 'button[aria-label="Create New Project"], button[title*="New Project"], button[aria-label*="New"]',
  previewIframe: 'iframe[src*="/preview/"]',
  appContainer: '.app-container',
} as const;
