// Studio client component

/**
 * AiChatPanel — Composite shell that stacks Preview + AgentChat.
 *
 * Preview is wrapped in React.memo so it never re-renders during AI streaming.
 * AgentChat is the ONLY subtree that subscribes to agentMessages / isGenerating.
 */

import { AgentChat } from "./AgentChat";

import { lazy, Suspense } from "react";
const Preview = lazy(() => import("./Preview").then((mod) => ({ default: mod.MemoizedPreview })));

export function AiChatPanel() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "var(--panel-right)",
      }}
    >
      {/* Preview — memoized, never re-renders during AI text streaming */}
      <div style={{ flexShrink: 0, height: 260, borderBottom: "1px solid var(--border)" }}>
        <Suspense fallback={<div style={{ width: "100%", height: "100%", background: "#000" }} />}>
          <Preview />
        </Suspense>
      </div>

      {/* AgentChat — ALL streaming state is isolated here */}
      <AgentChat />
    </div>
  );
}
