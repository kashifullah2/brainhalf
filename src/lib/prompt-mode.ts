/**
 * Planning is an explicit intent, not a consequence of a detailed app brief.
 * Long requirements and lists must still build the application by default.
 */
export function shouldAutoPlannerMode(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text) return false;

  // Explicit user controls always win.
  if (/^\/(plan|planner)\b/i.test(text)) return true;
  if (/^\/(build|implement|ship)\b/i.test(text)) return false;
  if (/\bno[\s-]?plan\b/i.test(text)) return false;

  return /^(?:please\s+)?(?:plan\b|brainstorm\b|outline\b|(?:give|write|create)\s+(?:me\s+)?(?:a\s+)?(?:plan|roadmap)\b|help\s+me\s+plan\b|(?:audit|review)\s+(?:the\s+)?(?:codebase|architecture)\b)/i.test(text);
}

/** A conversational turn must not start a hidden app-generation retry. */
export function isConversationalPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return /^(?:hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening)[\s,.!?]*$/i.test(text)
    || /^(?:what can you do|what can you build|who are you|how does this work)[\s,.!?]*$/i.test(text);
}
