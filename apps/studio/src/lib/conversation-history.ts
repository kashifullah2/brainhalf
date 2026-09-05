/**
 * Conversation history compaction for the agent loop.
 *
 * Preserves tool-calling context in a compact textual form so multi-turn
 * sessions don't lose reasoning, while staying within token budgets.
 */
import type { ContextBudget } from "./context-assembler";
import { DEFAULT_CONTEXT_BUDGET, estimateTokens } from "./context-assembler";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
  /** Compact note of tools invoked (for assistant turns). */
  toolSummary?: string;
}

export interface AgentMessageLike {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: { type: string; message: string; status: string }[];
}

/** Build a one-line tool summary from UI tool call records. */
export function summarizeToolCalls(
  toolCalls?: { type: string; message: string; status: string }[],
): string | undefined {
  if (!toolCalls?.length) return undefined;
  return toolCalls
    .map((t) => `${t.type}${t.status === "done" ? " ✓" : ""}`)
    .join(", ");
}

/** Convert store agent messages into compact history, excluding the active turn. */
export function buildHistoryFromStore(
  messages: AgentMessageLike[],
  excludeIds: Set<string>,
): HistoryMessage[] {
  return messages
    .filter((m) => !excludeIds.has(m.id))
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content.trim().length > 0 || (m.toolCalls?.length ?? 0) > 0)
    .map((m) => {
      const toolSummary = m.role === "assistant" ? summarizeToolCalls(m.toolCalls) : undefined;
      let content = m.content.trim();
      if (toolSummary && !content) {
        content = `(used tools: ${toolSummary})`;
      } else if (toolSummary && content.length > 500) {
        content = `${content.slice(0, 400)}… [tools: ${toolSummary}]`;
      } else if (toolSummary) {
        content = `${content}\n[tools: ${toolSummary}]`;
      }
      return { role: m.role, content, toolSummary };
    });
}

/** Summarize a long assistant/user message for history budget. */
export function compactMessage(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars - 40)}… [message truncated]`;
}

/** Trim history to fit budget, keeping most recent messages. */
export function pruneHistory(
  history: HistoryMessage[],
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): { messages: HistoryMessage[]; dropped: number; totalChars: number } {
  let trimmed = history.slice(-budget.maxHistoryMessages);
  let dropped = history.length - trimmed.length;

  const applyBudget = () => {
    let total = trimmed.reduce((n, m) => n + m.content.length, 0);
    while (total > budget.maxHistoryChars && trimmed.length > 2) {
      const removed = trimmed.shift();
      if (removed) dropped++;
      total = trimmed.reduce((n, m) => n + m.content.length, 0);
    }
    return total;
  };

  trimmed = trimmed.map((m) => ({
    ...m,
    content: compactMessage(m.content, Math.floor(budget.maxHistoryChars / 4)),
  }));

  const totalChars = applyBudget();
  return { messages: trimmed, dropped, totalChars };
}

export function historyToChatMessages(
  history: HistoryMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return history.map((m) => ({ role: m.role, content: m.content }));
}

export function measureHistory(history: HistoryMessage[]): {
  messages: number;
  chars: number;
  estTokens: number;
} {
  const chars = history.reduce((n, m) => n + m.content.length, 0);
  return { messages: history.length, chars, estTokens: estimateTokens(chars) };
}
