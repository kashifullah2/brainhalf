import { webContainerManager } from "./webcontainer";
import { useStudioStore, FileNode } from "@stores/studio-store";
import { apiUrl, getWebUrl } from "./api";
import {
  persistAgentFile,
  createCheckpoint,
  ensureProject,
} from "./persistence";
import { generateAsset, AssetType } from "./asset-generator";
import {
  searchAndDownloadAsset,
  type SearchAssetParams,
} from "./asset-fetcher";
import { syncPreviewAfterFileWrite } from "./preview-sync";
import { syncPackageJsonToStore } from "./package-sync";
import type { RepairAttempt } from "@stores/studio-store";
import {
  getRepairConfig,
  collectErrors,
  buildRepairPrompt,
} from "./self-healing";
import { summarizeErrors } from "./error-normalizer";
import {
  selectRelevantFiles,
  buildFileContextBlock,
  formatSystemContext,
  collectTouchedPaths,
  DEFAULT_CONTEXT_BUDGET,
  type ContextStats,
} from "./context-assembler";
import {
  buildHistoryFromStore,
  pruneHistory,
  historyToChatMessages,
} from "./conversation-history";
import {
  isValidPath,
  truncate as toolTruncate,
  validateShellCommand,
  validatePackageName,
  readProjectFile,
  executeFixError,
  applyEditFile,
  parseShellCommand,
} from "./agent-tools";

export type StreamEventType =
  | "text"
  | "tool_call_start"
  | "tool_call_delta"
  | "tool_call_complete"
  | "info"
  | "error"
  | "done";

export interface StreamEvent {
  type: StreamEventType;
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    args?: string;
  };
  error?: string;
  message?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/** A message in OpenAI chat format, including tool-calling fields. */
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

/** A tool call fully assembled from the stream, ready to execute. */
interface CompletedToolCall {
  id: string;
  name: string;
  args: string;
}

/** Hard cap on agent loop iterations to prevent runaway cost / infinite loops. */
const MAX_AGENT_ITERATIONS = 10;
/** Cap on how much of a tool result we feed back to the model (chars). */
const MAX_TOOL_RESULT_CHARS = 4000;
/** Cap on captured command output we feed back to the model (chars). */
const MAX_COMMAND_OUTPUT_CHARS = 3000;

async function refreshCreditsBalance() {
  try {
    const res = await fetch(apiUrl("/api/settings/credits"), {
      credentials: "include",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { balance?: number };
    if (typeof data.balance === "number") {
      useStudioStore.setState({ credits: data.balance });
    }
  } catch {
    /* ignore */
  }
}
const TOOL_LABELS: Record<string, string> = {
  create_file: "write file",
  edit_file: "edit file",
  install_package: "install deps",
  run_command: "run command",
  read_file: "read file",
  fix_error: "fix build",
  fetch_asset: "fetch asset",
  search_and_download_asset: "search assets",
};

function truncate(value: string, max: number): string {
  return toolTruncate(value, max);
}

// Validate path to prevent path traversal attacks
function isValidPathLocal(path: string): boolean {
  return isValidPath(path);
}

export class AgentRunner {
  private abortController: AbortController | null = null;

  public cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  public async runGeneration(prompt: string, _projectIdArg?: string) {
    const store = useStudioStore.getState();
    store.setIsGenerating(true);
    store.setGenerationProgress(0);

    // Resolve the real backend project up-front (creates one for signed-in users,
    // null for anonymous). Using the actual id is what makes file persistence and
    // generation-history/usage logging line up — never a hardcoded placeholder.
    const projectId = (await ensureProject()) ?? store.projectId ?? "";

    const userMsgId = Date.now().toString();
    store.addAgentMessage({ id: userMsgId, role: "user", content: prompt });

    const aiMsgId = (Date.now() + 1).toString();
    store.addAgentMessage({
      id: aiMsgId,
      role: "assistant",
      content: "",
      toolCalls: [],
    });

    this.abortController = new AbortController();

    // Drop stale errors + repair history so self-healing only reacts to this run.
    webContainerManager.clearPreviewErrors();
    webContainerManager.clearBuildErrors();
    store.clearRepairHistory();

    // Snapshot current work first so a bad generation can be rolled back.
    const hasExistingWork = store.projectFiles.some(
      (f) => f.type === "file" && (f.content?.trim().length ?? 0) > 0
    );
    if (hasExistingWork) {
      const label = `Before: ${prompt.slice(0, 60)}${
        prompt.length > 60 ? "…" : ""
      }`;
      void createCheckpoint(label);
    }

    try {
      // 1. Resolve provider preferences once (no API keys — server holds them).
      const providerConfig = await this.loadProviderConfig();

      // 2. Seed conversation — file context refreshed before every model turn.
      const excludeIds = new Set([userMsgId, aiMsgId]);
      const rawHistory = buildHistoryFromStore(store.agentMessages, excludeIds);
      const { messages: prunedHistory } = pruneHistory(rawHistory, DEFAULT_CONTEXT_BUDGET);

      const conversation: ChatMessage[] = [
        { role: "system", content: "" },
        ...historyToChatMessages(prunedHistory),
        { role: "user", content: prompt },
      ];

      const contextStatsRef: { latest: ContextStats | null } = { latest: null };

      // 3. The agentic loop: stream a turn, run its tools, feed results back,
      //    and repeat until the model stops asking for tools (or we hit the cap).
      const initial = await this.runAgentTurns(
        conversation,
        projectId,
        providerConfig,
        aiMsgId,
        prompt,
        (stats) => {
          contextStatsRef.latest = stats;
        }
      );

      // 4. Self-healing: capture build/runtime/Vite errors and let the model
      //    repair them across multiple bounded attempts.
      if (initial.didMutateFiles && !initial.aborted) {
        await this.runSelfHealing(conversation, projectId, providerConfig, aiMsgId, prompt);
      }

      const lastContextStats = contextStatsRef.latest;
      if (lastContextStats?.savingsPercent && lastContextStats.savingsPercent > 0) {
        console.info(
          `[context] ${lastContextStats.filesIncluded} files, ~${lastContextStats.savingsPercent}% smaller vs naive dump`,
        );
      }

      if (initial.didMutateFiles) {
        useStudioStore.getState().bumpPreviewReload();
      }

      store.setGenerationProgress(100);
      store.setIsGenerating(false);
      void refreshCreditsBalance();
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : "Unknown error";
      if ((err as { name?: string })?.name === "AbortError") {
        this.appendContent(aiMsgId, "\n\n[Generation Cancelled]");
      } else {
        console.error("Agent error:", err);
        const webUrl = getWebUrl();
        if (
          errMessage.includes("401") ||
          errMessage.includes("Sign in to generate")
        ) {
          this.appendContent(
            aiMsgId,
            `\n\n**Sign in required**\n\nCreate a free account or sign in to use your BrainHalf credits.\n` +
              `Or add your own AI provider key in Settings.\n\n` +
              `→ Sign in: ${webUrl}/sign-in\n→ Settings: ${webUrl}/settings`
          );
        } else if (errMessage.includes("Rate limit exceeded")) {
          this.appendContent(
            aiMsgId,
            `\n\n**Rate limited (BrainHalf API)**\n\nThis is the local request limit, not your AI provider. Restart the workers dev server or wait a few minutes.\n\nWhen using \`.dev.vars\`, the server tries all configured providers (Cerebras → Groq → Gemini → FreeModel → …) automatically.`,
          );
        } else {
          this.appendContent(aiMsgId, `\n\n**Error:** ${errMessage}`);
        }
      }
      store.setIsGenerating(false);
    }
  }

  /** Server resolves BYOK from the session DB; client never pins a provider name. */
  private async loadProviderConfig(): Promise<null> {
    return null;
  }

  /** Refresh the system message with latest project files before each model turn. */
  private async refreshContextBeforeTurn(
    conversation: ChatMessage[],
    userPrompt: string,
  ): Promise<ContextStats> {
    const store = useStudioStore.getState();
    const touched = collectTouchedPaths(
      conversation.filter((m) => m.role !== "system") as Array<{ role: string; content: string }>,
    );
    const selected = selectRelevantFiles({
      files: store.projectFiles,
      userPrompt,
      recentlyTouched: touched,
    });

    const { block, stats } = await buildFileContextBlock({
      files: store.projectFiles,
      selectedPaths: selected,
      readFile: async (path) => {
        try {
          return await webContainerManager.readFile(path);
        } catch {
          return null;
        }
      },
      budget: DEFAULT_CONTEXT_BUDGET,
    });

    if (conversation[0]?.role === "system") {
      conversation[0].content = formatSystemContext(block);
    } else {
      conversation.unshift({ role: "system", content: formatSystemContext(block) });
    }
    return stats;
  }

  /**
   * Runs the agentic loop: stream a model turn, execute any tools it requests,
   * feed the results back, and repeat until the model stops calling tools or the
   * iteration cap is hit. Returns whether files were mutated and if it aborted.
   */
  private async runAgentTurns(
    conversation: ChatMessage[],
    projectId: string,
    providerConfig: { provider: string; baseUrl?: string; model?: string } | null,
    aiMsgId: string,
    userPrompt: string,
    onContextStats?: (stats: ContextStats) => void,
  ): Promise<{ didMutateFiles: boolean; aborted: boolean }> {
    const store = useStudioStore.getState();
    const MUTATING_TOOLS = new Set([
      "create_file",
      "edit_file",
      "install_package",
      "run_command",
      "fix_error",
      "search_and_download_asset",
      "fetch_asset",
    ]);

    let iterations = 0;
    let aborted = false;
    let didMutateFiles = false;

    while (iterations < MAX_AGENT_ITERATIONS) {
      iterations++;
      store.setGenerationProgress(Math.min(95, iterations * 10));

      const stats = await this.refreshContextBeforeTurn(conversation, userPrompt);
      onContextStats?.(stats);

      const { assistantText, toolCalls } = await this.streamTurn(
        conversation,
        projectId,
        providerConfig,
        aiMsgId
      );

      // Record the assistant turn (with tool calls in OpenAI format) so the
      // model sees its own prior actions on the next iteration.
      const assistantMsg: ChatMessage = { role: "assistant", content: assistantText };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.args || "{}" },
        }));
      }
      conversation.push(assistantMsg);

      if (toolCalls.length === 0) break;

      // Execute each tool and append its result so the model can observe and
      // self-correct on the next turn (this is what makes it a real agent).
      for (const tc of toolCalls) {
        if (this.abortController?.signal.aborted) {
          aborted = true;
          break;
        }
        if (MUTATING_TOOLS.has(tc.name)) didMutateFiles = true;
        const result = await this.executeToolSafely(tc, aiMsgId);
        conversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: truncate(result, MAX_TOOL_RESULT_CHARS),
        });
        this.markToolDone(aiMsgId, tc.id);
      }

      if (aborted) break;
    }

    if (iterations >= MAX_AGENT_ITERATIONS) {
      this.appendContent(
        aiMsgId,
        `\n\n_(stopped after ${MAX_AGENT_ITERATIONS} steps — ask me to continue if it's not finished)_`
      );
    }

    return { didMutateFiles, aborted };
  }

  /**
   * Self-healing repair loop. Collects normalized errors from every source,
   * feeds them back to the model, lets it patch the code, then re-verifies —
   * up to a configurable max number of attempts. Each attempt is recorded in
   * the store (for the UI) and logged to the console.
   */
  private async runSelfHealing(
    conversation: ChatMessage[],
    projectId: string,
    providerConfig: { provider: string; baseUrl?: string; model?: string } | null,
    aiMsgId: string,
    userPrompt: string,
  ): Promise<void> {
    const store = useStudioStore.getState();
    const cfg = getRepairConfig();
    let prevId: string | null = null;

    for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
      if (this.abortController?.signal.aborted) return;

      // Verify: collect errors. This both checks the *previous* attempt and
      // produces the work list for *this* attempt.
      const errors = await collectErrors(cfg);

      if (prevId) {
        store.updateRepairAttempt(prevId, {
          status: errors.length === 0 ? "fixed" : "failed",
          finishedAt: Date.now(),
        });
      }

      if (errors.length === 0) {
        if (prevId) {
          this.appendContent(aiMsgId, `\n\n_(self-healing succeeded — preview is clean)_`);
        }
        return;
      }

      const summary = summarizeErrors(errors);
      const record: RepairAttempt = {
        id: `repair-${Date.now()}-${attempt}`,
        attempt,
        maxAttempts: cfg.maxAttempts,
        status: "repairing",
        summary,
        errors: errors.map((e) => ({
          category: e.category,
          message: e.message,
          file: e.file,
        })),
        startedAt: Date.now(),
      };
      store.startRepairAttempt(record);
      console.info(
        `[self-heal] attempt ${attempt}/${cfg.maxAttempts} — ${summary}`,
        errors
      );
      this.appendContent(
        aiMsgId,
        `\n\n_(self-healing ${attempt}/${cfg.maxAttempts}: ${summary} — fixing…)_`
      );

      conversation.push({ role: "user", content: buildRepairPrompt(errors) });

      const run = await this.runAgentTurns(
        conversation,
        projectId,
        providerConfig,
        aiMsgId,
        userPrompt,
      );

      store.updateRepairAttempt(record.id, { status: "verifying" });

      if (run.aborted) {
        store.updateRepairAttempt(record.id, { status: "failed", finishedAt: Date.now() });
        return;
      }
      if (!run.didMutateFiles) {
        // Model made no changes — stop instead of burning the remaining budget.
        store.updateRepairAttempt(record.id, { status: "failed", finishedAt: Date.now() });
        this.appendContent(
          aiMsgId,
          `\n\n_(self-healing stopped: model made no further changes)_`
        );
        return;
      }

      prevId = record.id;
    }

    // Exhausted the budget — do a final verification pass to label the last attempt.
    const finalErrors = await collectErrors(cfg);
    if (prevId) {
      store.updateRepairAttempt(prevId, {
        status: finalErrors.length === 0 ? "fixed" : "failed",
        finishedAt: Date.now(),
      });
    }
    if (finalErrors.length > 0) {
      this.appendContent(
        aiMsgId,
        `\n\n_(self-healing reached ${cfg.maxAttempts} attempts — ${summarizeErrors(
          finalErrors
        )} may remain; ask me to keep going)_`
      );
    } else if (prevId) {
      this.appendContent(aiMsgId, `\n\n_(self-healing succeeded — preview is clean)_`);
    }
  }

  /**
   * Streams a single model turn. Accumulates narration text into the assistant
   * UI bubble and collects fully-assembled tool calls, but does NOT execute
   * them — execution happens in the loop so results can be fed back.
   */
  private async streamTurn(
    conversation: ChatMessage[],
    projectId: string,
    providerConfig: {
      provider: string;
      baseUrl?: string;
      model?: string;
    } | null,
    aiMsgId: string
  ): Promise<{ assistantText: string; toolCalls: CompletedToolCall[] }> {
    const store = useStudioStore.getState();

    const response = await fetch(apiUrl("/api/ai/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        messages: conversation,
        projectId,
        gameType: store.gameType === "2D" ? "2d" : "3d",
        providerConfig,
      }),
      signal: this.abortController!.signal,
    });

    if (!response.ok) {
      let errStr = response.statusText || "Unknown error";
      try {
        errStr = await response.text();
      } catch (e) {
        console.warn("Could not parse error response", e);
      }
      throw new Error(
        `AI request failed (${response.status}): ${
          errStr || response.statusText
        }`
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();

    // Per-index assembly of streamed tool calls.
    const toolCallsByIndex = new Map<string, CompletedToolCall>();
    const completed: CompletedToolCall[] = [];
    const seenCompleted = new Set<string>();

    let turnText = "";
    let sseBuffer = "";
    let textRaf: number | null = null;

    // We append text deltas directly to the bubble so multi-turn narration is continuous.
    const appendDelta = (delta: string) => {
      turnText += delta;
      const msg = useStudioStore
        .getState()
        .agentMessages.find((m) => m.id === aiMsgId);
      const base = msg?.content ?? "";
      useStudioStore
        .getState()
        .updateAgentMessage(aiMsgId, { content: base + delta });
    };

    let rafQueued = false;
    let pendingDelta = "";
    const queueAppend = (delta: string) => {
      pendingDelta += delta;
      if (!rafQueued) {
        rafQueued = true;
        textRaf = requestAnimationFrame(() => {
          rafQueued = false;
          const chunk = pendingDelta;
          pendingDelta = "";
          appendDelta(chunk);
        });
      }
    };

    const registerToolStart = (
      id: string,
      name: string,
      args: string,
      indexKey: string
    ) => {
      toolCallsByIndex.set(indexKey, { id, name, args });
      const label = TOOL_LABELS[name] || name;
      const currentMsg = useStudioStore
        .getState()
        .agentMessages.find((m) => m.id === aiMsgId);
      store.updateAgentMessage(aiMsgId, {
        toolCalls: [
          ...(currentMsg?.toolCalls || []),
          { id, type: name, message: label, status: "loading" as const },
        ],
      });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.replace(/^data: /, "").trim();
          if (dataStr === "[DONE]") break;

          let event: StreamEvent;
          try {
            event = JSON.parse(dataStr) as StreamEvent;
          } catch (e) {
            if (
              e instanceof Error &&
              e.message !== "Unexpected end of JSON input"
            ) {
              console.error("Stream parsing error:", e);
            }
            continue;
          }

          if (event.type === "text" && event.text) {
            // Safety net: strip any stray narration/file markup so older prompt
            // styles never leak literal tags into the chat or model history.
            const cleaned = event.text
              .replace(/<\/?narrate>/g, "")
              .replace(/\[\/?file[^\]]*\]/g, "");
            if (cleaned) queueAppend(cleaned);
          }

          if (event.type === "tool_call_start" && event.toolCall) {
            const indexKey =
              event.toolCall.id || `idx-${toolCallsByIndex.size}`;
            registerToolStart(
              event.toolCall.id,
              event.toolCall.name,
              event.toolCall.args || "",
              indexKey
            );
          }

          if (event.type === "tool_call_delta" && event.toolCall) {
            // Find the matching in-flight tool call by id, else the most recent.
            let entry = [...toolCallsByIndex.values()].find(
              (t) => t.id === event.toolCall!.id
            );
            if (!entry) {
              const last = [...toolCallsByIndex.values()].pop();
              entry = last;
            }
            if (entry) {
              if (event.toolCall.args) entry.args += event.toolCall.args;
              if (event.toolCall.name) entry.name = event.toolCall.name;
            } else if (event.toolCall.id) {
              registerToolStart(
                event.toolCall.id,
                event.toolCall.name || "",
                event.toolCall.args || "",
                event.toolCall.id
              );
            }
          }

          if (event.type === "tool_call_complete" && event.toolCall) {
            const id = event.toolCall.id;
            if (!seenCompleted.has(id)) {
              seenCompleted.add(id);
              const entry = [...toolCallsByIndex.values()].find(
                (t) => t.id === id
              );
              completed.push({
                id,
                name: event.toolCall.name || entry?.name || "",
                args: event.toolCall.args || entry?.args || "",
              });
            }
          }

          if (event.type === "info" && event.message) {
            this.appendContent(aiMsgId, `\n\n_${event.message}_`);
          }

          if (event.type === "error") {
            const errorMsg = event.error || "Unknown streaming error";
            console.error("AI Stream Error:", errorMsg);
            throw new Error(errorMsg);
          }

          if (event.type === "done" && event.usage) {
            store.setCreditsUsed(useStudioStore.getState().creditsUsed + 1);
          }
        }
      }
    } finally {
      if (textRaf !== null) cancelAnimationFrame(textRaf);
      if (pendingDelta) appendDelta(pendingDelta);
      reader.releaseLock();
    }

    return { assistantText: turnText, toolCalls: completed };
  }

  /** Wraps executeTool so a failing tool reports an error back to the model. */
  private async executeToolSafely(
    toolCall: CompletedToolCall,
    aiMsgId: string
  ): Promise<string> {
    try {
      return await this.executeTool(toolCall, aiMsgId);
    } catch (toolErr) {
      const toolMsg =
        toolErr instanceof Error ? toolErr.message : "Tool failed";
      console.error(`Tool ${toolCall.name} error:`, toolErr);
      this.appendContent(
        aiMsgId,
        `\n\n**Tool error (${toolCall.name}):** ${toolMsg}`
      );
      return `ERROR running ${toolCall.name}: ${toolMsg}`;
    }
  }

  private appendContent(aiMsgId: string, text: string) {
    const store = useStudioStore.getState();
    const msg = store.agentMessages.find((m) => m.id === aiMsgId);
    store.updateAgentMessage(aiMsgId, { content: (msg?.content || "") + text });
  }

  private markToolDone(aiMsgId: string, toolId: string, message?: string) {
    const store = useStudioStore.getState();
    const currentMsg = store.agentMessages.find((m) => m.id === aiMsgId);
    if (!currentMsg?.toolCalls) return;
    store.updateAgentMessage(aiMsgId, {
      toolCalls: currentMsg.toolCalls.map((t) =>
        t.id === toolId
          ? { ...t, status: "done" as const, ...(message ? { message } : {}) }
          : t
      ),
    });
  }

  /**
   * Executes a tool against the WebContainer and returns a human/model-readable
   * result string. The returned string is fed back into the conversation so the
   * model can observe outcomes (file contents, build errors) and self-correct.
   */
  private async executeTool(
    toolCall: CompletedToolCall,
    aiMsgId: string
  ): Promise<string> {
    const store = useStudioStore.getState();
    let argsObj: Record<string, unknown> = {};
    try {
      argsObj = JSON.parse(toolCall.args || "{}");
    } catch {
      console.warn("Failed to parse tool args", toolCall.args);
      return `ERROR: arguments for ${
        toolCall.name
      } were not valid JSON: ${truncate(toolCall.args || "", 500)}`;
    }

    switch (toolCall.name) {
      case "create_file": {
        const filePath = argsObj.path as string;
        const content = (argsObj.content as string) ?? "";

        if (!isValidPathLocal(filePath)) {
          return `ERROR: invalid or unsafe path "${filePath}". Use a relative path with no "..".`;
        }

        await webContainerManager.writeFiles({ [filePath]: content });

        const pathParts = filePath.split("/");
        const fileName = pathParts.pop() || "file";
        const parentFolderPath = pathParts.join("/");

        let currentFiles = store.projectFiles;
        let parentNode: FileNode | undefined;

        if (parentFolderPath) {
          // Auto-create missing folder hierarchy
          let currentPath = "";
          let currentParentId: string | null = null;

          for (const folderName of pathParts) {
            currentPath = currentPath
              ? `${currentPath}/${folderName}`
              : folderName;
            let folderNode = currentFiles.find(
              (f) => f.type === "folder" && f.path === currentPath
            );

            if (!folderNode) {
              folderNode = {
                id: `folder-${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 8)}`,
                name: folderName,
                type: "folder",
                parentId: currentParentId,
                path: currentPath,
              };
              currentFiles = [...currentFiles, folderNode];
            }
            currentParentId = folderNode.id;
          }
          parentNode = currentFiles.find((f) => f.id === currentParentId);
        }

        // Update existing node in place if the file already exists, else add it.
        const existing = currentFiles.find(
          (f) => f.type === "file" && f.path === filePath
        );
        if (existing) {
          store.setProjectFiles(
            currentFiles.map((f) =>
              f.id === existing.id ? { ...f, content } : f
            )
          );
          store.openFile(existing.id);
        } else {
          const fileId = `${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
          store.setProjectFiles([
            ...currentFiles,
            {
              id: fileId,
              name: fileName,
              type: "file" as const,
              parentId: parentNode?.id || null,
              content,
              path: filePath,
            },
          ]);
          store.openFile(fileId);
        }

        // Persist to the backend so agent-generated work survives a refresh.
        void persistAgentFile(filePath, content);

        await syncPreviewAfterFileWrite(filePath, content);

        return `File written: ${filePath} (${content.length} bytes).`;
      }

      case "edit_file": {
        const filePath = argsObj.path as string;
        const oldString = (argsObj.old_string as string) ?? "";
        const newString = (argsObj.new_string as string) ?? "";

        const edit = await applyEditFile({
          path: filePath,
          old_string: oldString,
          new_string: newString,
          projectFiles: store.projectFiles,
          readFromDisk: (p) => webContainerManager.readFile(p),
        });

        if (!edit.ok) {
          return `ERROR: ${edit.error}`;
        }

        await webContainerManager.writeFiles({ [filePath]: edit.content });

        const pathParts = filePath.split("/");
        const fileName = pathParts.pop() || "file";
        const parentFolderPath = pathParts.join("/");
        let currentFiles = store.projectFiles;
        let parentNode: FileNode | undefined;
        if (parentFolderPath) {
          parentNode = currentFiles.find(
            (f) => f.type === "folder" && f.path === parentFolderPath,
          );
        }

        const existing = currentFiles.find(
          (f) => f.type === "file" && f.path === filePath,
        );
        if (existing) {
          store.setProjectFiles(
            currentFiles.map((f) =>
              f.id === existing.id ? { ...f, content: edit.content } : f,
            ),
          );
          store.openFile(existing.id);
        } else {
          const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          store.setProjectFiles([
            ...currentFiles,
            {
              id: fileId,
              name: fileName,
              type: "file" as const,
              parentId: parentNode?.id || null,
              content: edit.content,
              path: filePath,
            },
          ]);
          store.openFile(fileId);
        }

        void persistAgentFile(filePath, edit.content);
        await syncPreviewAfterFileWrite(filePath, edit.content);
        return `Edited ${filePath} (${edit.replaced} replacement(s), ${edit.content.length} bytes).`;
      }

      case "install_package": {
        const packageName = argsObj.package_name as string;
        if (!validatePackageName(packageName)) {
          return `ERROR: invalid package name "${packageName}".`;
        }
        let output = "";
        const result = await webContainerManager.installPackage(
          packageName,
          (d) => {
            output += d;
          }
        );
        if (result.skipped) {
          this.markToolDone(
            aiMsgId,
            toolCall.id,
            `${packageName} already installed`
          );
          useStudioStore.getState().bumpPreviewReload();
          return `Package ${packageName} was already installed — skipped.`;
        }
        if (result.code !== 0) {
          return `Install of ${packageName} FAILED (exit ${
            result.code
          }).\n${truncate(output, MAX_COMMAND_OUTPUT_CHARS)}`;
        }
        await syncPackageJsonToStore();
        useStudioStore.getState().bumpPreviewReload();
        return `Installed ${packageName} successfully.`;
      }

      case "run_command": {
        const command = argsObj.command as string;
        const validation = validateShellCommand(command);
        if (!validation.ok) {
          return `ERROR: ${validation.error}`;
        }

        const { cmd, args: cmdArgs } = parseShellCommand(command);

        let output = "";
        let exitCode = 0;
        if (cmd === "npm" && cmdArgs[0] === "install") {
          if (cmdArgs.length === 1) {
            exitCode = await webContainerManager.ensureDependenciesInstalled(
              (d) => {
                output += d;
              }
            );
          } else {
            for (const pkg of cmdArgs.slice(1)) {
              if (pkg.startsWith("-")) continue;
              const r = await webContainerManager.installPackage(pkg, (d) => {
                output += d;
              });
              if (r.code !== 0) exitCode = r.code;
            }
          }
        } else {
          exitCode = await webContainerManager.runCommand(cmd, cmdArgs, (d) => {
            output += d;
          });
        }

        const status =
          exitCode === 0 ? "succeeded" : `FAILED (exit ${exitCode})`;
        if (exitCode === 0 && cmd === "npm" && cmdArgs[0] === "install") {
          await syncPackageJsonToStore();
          useStudioStore.getState().bumpPreviewReload();
        }
        return `Command "${command}" ${status}.\nOutput:\n${truncate(
          output || "(no output)",
          MAX_COMMAND_OUTPUT_CHARS
        )}`;
      }

      case "read_file": {
        const filePath = argsObj.path as string;
        const read = await readProjectFile({
          path: filePath,
          projectFiles: store.projectFiles,
          readFromDisk: (p) => webContainerManager.readFile(p),
        });

        if (!read.ok) {
          return `ERROR: ${read.error}`;
        }

        this.appendContent(aiMsgId, `\n\n(read ${filePath})`);
        return `Contents of ${filePath} (${read.source}):\n${read.content}`;
      }

      case "fix_error": {
        const errorMsg = (argsObj.error as string) || "";
        const filePath = (argsObj.file_path as string) || "";
        const verifyCommand = (argsObj.command as string) || "npm run build";

        const extraErrors = [
          ...webContainerManager.consumePreviewErrors(),
          ...webContainerManager.consumeBuildErrors(),
        ];

        const fix = await executeFixError({
          error: errorMsg,
          filePath,
          verifyCommand,
          projectFiles: store.projectFiles,
          readFromDisk: (p) => webContainerManager.readFile(p),
          runCommand: (cmd, args, onOutput) =>
            webContainerManager.runCommand(cmd, args, onOutput),
          extraErrors,
          maxOutputChars: MAX_COMMAND_OUTPUT_CHARS,
        });

        if (!fix.ok) {
          return `ERROR: ${fix.error}`;
        }

        this.appendContent(aiMsgId, `\n\n(diagnosing ${filePath})`);
        return fix.result.report;
      }

      case "search_and_download_asset": {
        const query = (argsObj.query as string) || "";
        if (!query.trim()) {
          return "ERROR: query is required for search_and_download_asset.";
        }
        const asset = await searchAndDownloadAsset({
          query,
          asset_type:
            (argsObj.asset_type as SearchAssetParams["asset_type"]) || "any",
          source: argsObj.source as SearchAssetParams["source"],
          style: argsObj.style as string | undefined,
          filename: argsObj.filename as string | undefined,
        });

        if (asset.path) {
          this.appendContent(
            aiMsgId,
            `\n\n(downloaded asset ${asset.path} from ${
              asset.source || "library"
            })`
          );
        }
        return asset.note;
      }

      case "fetch_asset": {
        const assetType = (argsObj.asset_type as AssetType) || "texture";
        const description = (argsObj.description as string) || "";
        if (!["texture", "sound", "model"].includes(assetType)) {
          return `ERROR: unsupported asset_type "${assetType}". Use texture, sound, or model.`;
        }
        const asset = await generateAsset(assetType, description);

        // Register a node so generated binary assets appear in the file tree.
        if (asset.path) {
          const currentFiles = store.projectFiles;
          if (
            !currentFiles.some(
              (f) => f.type === "file" && f.path === asset.path
            )
          ) {
            const parts = asset.path.split("/");
            const fileName = parts.pop() as string;
            const parentPath = parts.join("/");
            const parentNode = currentFiles.find(
              (f) => f.type === "folder" && f.path === parentPath
            );
            store.setProjectFiles([
              ...currentFiles,
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: fileName,
                type: "file" as const,
                parentId: parentNode?.id || null,
                path: asset.path,
              },
            ]);
          }
          this.appendContent(aiMsgId, `\n\n(generated asset ${asset.path})`);
        }
        return asset.note;
      }

      default:
        return `ERROR: unknown tool "${toolCall.name}".`;
    }
  }
}

export const agentRunner = new AgentRunner();
