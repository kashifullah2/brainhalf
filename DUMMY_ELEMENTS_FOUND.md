# Dummy Elements & Incomplete UI Audit Log

This document lists every dummy button, duplicate UI section, non-functional placeholder, and inert element discovered during testing across the **BrainHalf platform** and **generated application templates**, along with the status of each fix.

---

## Summary of Findings

| ID | Location | Element Description | Issue Category | Root Cause | Fix Applied | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DUM-01** | `TopNav.tsx` | Golden "Upgrade Plan" pill button | Inert dummy button | Added during mockup replication without backend subscription integration | Removed completely from `TopNav.tsx` | **FIXED** |
| **DUM-02** | `ChatPanel.tsx` | "3.73 free credit remaining!" banner | Fake hardcoded badge | Static credit banner docked above input with no real quota counter | Removed completely from `ChatPanel.tsx`; input wrapper restored to 14px rounded border | **FIXED** |
| **DUM-03** | `ChatPanel.tsx` | "✦ Upgrade Plan" button inside credit banner | Dead link / Alert stub | Triggered an alert modal rather than a real plan upgrade | Removed along with the credit banner | **FIXED** |
| **DUM-04** | `ChatPanel.tsx` | "Took a screenshot >" collapsible drawer | Hardcoded dummy component | Hardcoded drawer rendering static "Chat Easy" proposal email mockup | Removed completely from message stream; real messages now stream cleanly | **FIXED** |
| **DUM-05** | `ChatPanel.tsx` | Initial bot message ("The public API and TypeScript gates passed...") | Hardcoded screenshot text | Seeded into default message state for screenshot matching | Removed default message; fresh chats start cleanly with quick templates | **FIXED** |
| **DUM-06** | `LandingPage.tsx` | Floating assistant launcher bot icon | Non-functional widget | Floating button on bottom-right corner without active backend agent window | Removed completely from `LandingPage.tsx` | **FIXED** |
| **DUM-07** | `Workspace.tsx` | Floating assistant launcher bot icon | Redundant widget | Duplicate floating button overlaid on preview canvas | Removed completely from `Workspace.tsx` | **FIXED** |
| **DUM-08** | `LandingPage.tsx` | `-0.34` credit badge next to user avatar | Fake numeric badge | Leftover static mockup badge | Removed completely from `LandingPage.tsx` | **FIXED** |
| **DUM-09** | `LandingPage.tsx` | "Builder Fest: Participate & win up to $100K!" | Static marketing banner | Announcement banner placed on landing page | Removed completely from `LandingPage.tsx` | **FIXED** |
| **DUM-10** | System Prompt (`src/agent.ts`) | Generic LLM tendencies to output `// TODO: implement later` | Code generation placeholder | Models omitting implementation details in long files | Enforced **Rule 16** in `buildSystemPrompt`: strictly forbids "TODO", incomplete files, or comments in lieu of code | **FIXED** |
| **DUM-11** | System Prompt (`src/agent.ts`) | Generic LLM tendency to write `onClick={() => {}}` on secondary buttons | Inert handler | Models generating dummy buttons on secondary actions | Enforced **Rule 16**: every interactive element must mutate state, trigger a modal, or perform a real API call | **FIXED** |
| **DUM-12** | System Prompt (`src/agent.ts`) | "Add to Cart" button index-0 bug | Common LLM logic flaw | Handler added `products[0]` instead of clicked item `product` | Enforced strict item-parameterized handler rule in system prompt | **FIXED** |
| **DUM-13** | System Prompt (`src/agent.ts`) | Dead `#` anchor tags for section navigation | Dead links | Anchor tags with `href="#"` that jump to page top rather than section | Enforced `element.scrollIntoView()` or `react-router-dom` navigation links | **FIXED** |
| **DUM-14** | System Prompt (`src/agent.ts`) | Duplicate component rendering (e.g. duplicate headers) | Visual stitching artifact | Generated apps declaring header in both `App.jsx` and `Header.jsx` | Added anti-duplication rule in `buildSystemPrompt` prohibiting twin headers | **FIXED** |
