import { useStudioStore, AgentMessage, RepairAttempt } from "@stores/studio-store";
import { Send, Square, Loader2, Wrench, Check, AlertTriangle } from "lucide-react";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  memo,
  type MutableRefObject,
} from "react";
import { agentRunner } from "@lib/agent-runner";

import { getWebUrl } from "@lib/api";

function isLocalStudio(): boolean {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

const PROMPT_EXAMPLES = [
  "Top-down shooter, WASD + mouse aim, waves every 15s",
  "2D platformer with double jump and moving platforms",
  "Endless runner — lane switch, obstacles, score multiplier",
];

const TOOL_LABELS: Record<string, string> = {
  create_file: "write file",
  edit_file: "edit file",
  install_package: "npm install",
  run_command: "run command",
  read_file: "read file",
  fix_error: "fix build",
  fetch_asset: "fetch asset",
  search_and_download_asset: "search assets",
};

function toolLabel(name: string, message?: string): string {
  if (message && !message.startsWith("Executing")) return message;
  return TOOL_LABELS[name] || name.replace(/_/g, " ");
}

const MessageRow = memo(
  function MessageRow({
    msg,
    isLast,
    isGenerating,
  }: {
    msg: AgentMessage;
    isLast: boolean;
    isGenerating: boolean;
  }) {
    const isUser = msg.role === "user";
    const showCursor =
      isGenerating &&
      isLast &&
      msg.role === "assistant" &&
      !msg.toolCalls?.some((t) => t.status === "loading");

    return (
      <div className={`studio-msg ${isUser ? "user" : "assistant"}`}>
        <div className="studio-msg-meta">{isUser ? "you" : "agent"}</div>
        {msg.content ? (
          <div className="studio-msg-body">
            {msg.content}
            {showCursor && <span className="studio-cursor" aria-hidden />}
          </div>
        ) : null}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <ul className="studio-tool-list">
            {msg.toolCalls.map((tool) => (
              <li
                key={tool.id}
                className={`studio-tool-pill ${tool.status === "done" ? "done" : ""} ${tool.status === "loading" ? "loading" : ""}`}
              >
                {tool.status === "loading" ? (
                  <Loader2 size={11} className="studio-tool-spin" />
                ) : (
                  <span className="studio-tool-check">✓</span>
                )}
                <span>{toolLabel(tool.type, tool.message)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
  (prev, next) => {
    if (prev.msg.id !== next.msg.id || prev.isLast !== next.isLast || prev.isGenerating !== next.isGenerating) {
      return false;
    }
    if (prev.msg.content !== next.msg.content) return false;
    const pt = prev.msg.toolCalls;
    const nt = next.msg.toolCalls;
    if (pt?.length !== nt?.length) return false;
    if (pt && nt) {
      for (let i = 0; i < pt.length; i++) {
        if (pt[i].id !== nt[i].id || pt[i].status !== nt[i].status || pt[i].message !== nt[i].message) {
          return false;
        }
      }
    }
    return true;
  }
);

const AgentChatMessages = memo(function AgentChatMessagesPanel({
  onPickPrompt,
}: {
  onPickPrompt: (text: string) => void;
}) {
  const agentMessages = useStudioStore((s) => s.agentMessages);
  const isGenerating = useStudioStore((s) => s.isGenerating);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef<number | null>(null);
  const lastScrollKey = useRef("");

  const scrollToBottom = useCallback(() => {
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      scrollRaf.current = null;
    });
  }, []);

  useEffect(() => {
    const last = agentMessages[agentMessages.length - 1];
    const key = `${agentMessages.length}:${last?.content?.length ?? 0}:${last?.toolCalls?.length ?? 0}:${isGenerating}`;
    if (key === lastScrollKey.current) return;
    lastScrollKey.current = key;
    scrollToBottom();
  }, [agentMessages, isGenerating, scrollToBottom]);

  const visible = agentMessages.filter(
    (m) => m.role === "user" || m.content || (m.toolCalls && m.toolCalls.length > 0)
  );
  const hasUserMessage = agentMessages.some((m) => m.role === "user");

  return (
    <div className="studio-chat-messages">
      {!hasUserMessage && (
        <div className="studio-welcome">
          <h2>What are we building?</h2>
          <p>Be specific about controls, camera, and 2D vs 3D. The agent scaffolds the repo and runs the dev server.</p>
          <ul className="studio-prompt-chips" aria-label="Example prompts">
            {PROMPT_EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  className="studio-prompt-chip"
                  disabled={isGenerating}
                  onClick={() => onPickPrompt(example)}
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {visible.map((msg, i, arr) => (
        <MessageRow
          key={msg.id}
          msg={msg}
          isLast={i === arr.length - 1}
          isGenerating={isGenerating}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
});

function RepairAttemptRow({ attempt }: { attempt: RepairAttempt }) {
  const active = attempt.status === "repairing" || attempt.status === "verifying";
  const failed = attempt.status === "failed";
  const fixed = attempt.status === "fixed";

  const icon = active ? (
    <Loader2 size={11} className="studio-tool-spin" />
  ) : fixed ? (
    <Check size={11} />
  ) : failed ? (
    <AlertTriangle size={11} />
  ) : (
    <Wrench size={11} />
  );

  const statusLabel: Record<RepairAttempt["status"], string> = {
    detected: "detected",
    repairing: "fixing",
    verifying: "verifying",
    fixed: "fixed",
    failed: "unresolved",
  };

  return (
    <li className={`studio-repair-row ${attempt.status}`}>
      <span className="studio-repair-icon">{icon}</span>
      <span className="studio-repair-text">
        <strong>
          attempt {attempt.attempt}/{attempt.maxAttempts}
        </strong>{" "}
        — {attempt.summary} · {statusLabel[attempt.status]}
      </span>
    </li>
  );
}

const RepairProgress = memo(function RepairProgressPanel() {
  const repairHistory = useStudioStore((s) => s.repairHistory);
  if (repairHistory.length === 0) return null;

  return (
    <div className="studio-repair-panel" role="status" aria-label="Self-healing progress">
      <div className="studio-repair-header">
        <Wrench size={12} />
        <span>self-healing</span>
      </div>
      <ul className="studio-repair-list">
        {repairHistory.map((attempt) => (
          <RepairAttemptRow key={attempt.id} attempt={attempt} />
        ))}
      </ul>
    </div>
  );
});

const AgentChatInput = memo(function AgentChatInputPanel({
  fillRef,
}: {
  fillRef: MutableRefObject<((text: string) => void) | null>;
}) {
  const isGenerating = useStudioStore((s) => s.isGenerating);
  const [input, setInput] = useState("");

  const fillInput = useCallback((text: string) => {
    setInput(text);
    requestAnimationFrame(() => {
      const ta = document.querySelector(".studio-chat-textarea") as HTMLTextAreaElement | null;
      if (ta) {
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
        ta.focus();
      }
    });
  }, []);

  useEffect(() => {
    fillRef.current = fillInput;
    return () => {
      fillRef.current = null;
    };
  }, [fillRef, fillInput]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isGenerating) return;
    const prompt = input.trim();
    setInput("");
    const ta = document.querySelector(".studio-chat-textarea") as HTMLTextAreaElement | null;
    if (ta) ta.style.height = "auto";
    queueMicrotask(() => agentRunner.runGeneration(prompt));
  }, [input, isGenerating]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="studio-chat-input-wrap">
      <div className="studio-chat-input-box">
        <textarea
          className="studio-chat-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isGenerating
              ? "agent is working…"
              : "e.g. top-down shooter, WASD + mouse aim, waves every 15s"
          }
          disabled={isGenerating}
          rows={1}
          onInput={(e) => {
            const t = e.target as HTMLTextAreaElement;
            t.style.height = "auto";
            t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
          }}
        />
        {isGenerating ? (
          <button
            type="button"
            className="studio-chat-send stop"
            onClick={() => agentRunner.cancel()}
            title="Stop"
            aria-label="Stop generation"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className="studio-chat-send"
            onClick={handleSend}
            disabled={!input.trim()}
            title="Send (Enter)"
            aria-label="Send message"
          >
            <Send size={15} />
          </button>
        )}
      </div>
    </div>
  );
});

export function AgentChat() {
  const isGenerating = useStudioStore((s) => s.isGenerating);
  const isSignedIn = useStudioStore((s) => s.isSignedIn);
  const fillRef = useRef<((text: string) => void) | null>(null);

  const showAuthBanner = isSignedIn === false && !isLocalStudio();

  return (
    <div className="studio-chat">
      <div className="studio-panel-header">
        <span className="studio-panel-label">agent</span>
        {isGenerating && (
          <span className="studio-agent-status">
            <Loader2 size={12} className="studio-tool-spin" />
            working
          </span>
        )}
      </div>

      {showAuthBanner && (
        <div className="studio-auth-banner" role="status">
          <p>Sign in to generate games with your free credits.</p>
          <div className="studio-auth-banner-actions">
            <a href={`${getWebUrl()}/sign-in`} className="studio-auth-banner-btn primary">
              Sign in
            </a>
            <a href={`${getWebUrl()}/settings`} className="studio-auth-banner-btn">
              Add API key
            </a>
          </div>
        </div>
      )}

      <AgentChatMessages onPickPrompt={(t) => fillRef.current?.(t)} />
      <RepairProgress />
      <AgentChatInput fillRef={fillRef} />
    </div>
  );
}
