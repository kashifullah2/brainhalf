/**
 * Planning is an explicit intent, not a consequence of a detailed app brief.
 * Long requirements and lists must still build the application by default.
 */
import { isSystemContinuation } from './chat-transcript';
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

/**
 * B4: Detects wipe-the-project requests ("delete all files", "wipe everything").
 * Targeted deletions ("delete the old logo") are NOT destructive — only
 * requests covering all/most of the codebase. When true, the generation must
 * run tool-less so zero file operations can occur before explicit confirmation.
 */
export function isDestructivePrompt(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text) return false;
  // Explicit slash commands are never destructive prompts.
  if (/^\/(plan|planner|build|implement|ship)\b/i.test(text)) return false;
  return /\b(delete|remove|wipe|clear|erase|destroy)\b[^.?!]{0,60}\b(all|every|entire|whole)\b[^.?!]{0,40}\b(files?|code|codebase|project|everything)\b/i.test(text)
    || /\bwipe\b[^.?!]{0,40}\b(codebase|project|everything)\b/i.test(text)
    || /\bstart\s+over\b[^.?!]{0,30}\b(delete|remove|clear)\b/i.test(text);
}

/**
 * B5: Detects plain-text questions and creative-writing requests that must be
 * answered in chat with ZERO file operations ("write a haiku", "explain
 * recursion"). Conservative by design: anything mentioning the app/project or
 * carrying build intent returns false so builds are never hijacked.
 */
export function isQuestionPrompt(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text || isConversationalPrompt(text)) return false;
  if (/^\/(plan|planner|build|implement|ship)\b/i.test(text)) return false;
  // Destructive requests are handled by the B4 gate, never as questions.
  if (isDestructivePrompt(text)) return false;

  // Any app-building intent disqualifies question mode. A build verb paired
  // with a build target ("add a button", "fix the login page") is a build.
  const buildTarget = /\b(app|website|web\s?app|component|webpage|web\s?page|landing(\s?page)?|dashboard|button|form|feature|project|codebase|repo|repository|code|file|files|database|api|endpoint)\b/i;
  const buildVerb = /\b(build|create|generate|make|add|fix|edit|update|change|modify|implement|refactor|redesign|restyle|deploy|publish|delete|remove|design)\b/i;
  if (buildVerb.test(text) && buildTarget.test(text)) return false;
  // "in my app / to the project / of this site" anchors it to the workspace.
  if (/\b(my|this|the)\s+(app|project|website|site|code|codebase)\b/i.test(text)) return false;

  // Question-shaped messages.
  if (/^(what|why|how|when|where|who|whom|whose|which|can|could|would|do|does|did|is|are|was|were|will|should|have|has|tell\s+me|explain|define|describe)\b/i.test(text)) return true;
  // Ends with a question mark and no build intent (checked above).
  if (/\?\s*$/.test(text)) return true;
  // Creative writing requests — haiku/poem/story, not code.
  if (/^(please\s+)?(write|compose)\s+(me\s+)?(a|an|the)?\s*(haiku|poem|poetry|story|short\s+story|joke|essay|song|lyrics|letter|speech|article|summary|tagline|slogan|limerick)\b/i.test(text)) return true;

  return false;
}

/**
 * Detects vague build requests with no actionable target ("make something
 * cool", "build me anything", "do something fun"). These carry build intent
 * but nothing to build — launching a full generation burns minutes and
 * produces a random app. When true, the generation runs tool-less so the
 * model asks clarifying questions instead.
 */
export function isAmbiguousPrompt(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text || isConversationalPrompt(text) || isQuestionPrompt(text) || isDestructivePrompt(text)) return false;
  if (/^\/(plan|planner|build|implement|ship)\b/i.test(text)) return false;
  // A concrete build target disqualifies ambiguity (handled as a real build).
  const buildTarget = /\b(app|website|web\s?app|component|webpage|web\s?page|landing(\s?page)?|dashboard|button|form|feature|project|codebase|repo|repository|code|file|files|database|api|endpoint|page|site|shop|store|blog|portfolio|game)\b/i;
  if (buildTarget.test(text)) return false;
  if (/\b(my|this|the)\s+(app|project|website|site|code|codebase)\b/i.test(text)) return false;
  // Vague object + build verb, nothing concrete: "make something cool".
  const vagueObject = /\b(something|anything|whatever|stuff)\b/i;
  const buildVerb = /\b(make|build|create|generate|design|do)\b/i;
  if (vagueObject.test(text) && buildVerb.test(text)) return true;
  // Very short bare imperatives with no object at all: "surprise me".
  if (/^(surprise me|impress me|show me something)[\s.!]*$/i.test(text)) return true;
  return false;
}

/**
 * Staging (the 3-stage architecture/layout/backend pipeline) is for fresh
 * full-app builds only. System continuations ([AUTO-FIX], [AUTO-CONTINUE],
 * truncation retries) must never enter staging: the stage instructions
 * contradict the continuation's explicit orders (e.g. "regenerate ONLY these
 * files"), so the repair fails while burning 3 model calls of the user's
 * budget. Same for questions, destructive confirmations, clarifying prompts,
 * resumes, and edits to an existing app.
 */
export function shouldUseStagedPipeline(options: {
  plannerMode: boolean;
  modes?: { questionMode?: boolean; destructiveMode?: boolean; ambiguousMode?: boolean };
  resumeChain: unknown;
  isFreshBuild: boolean;
  actualPrompt: string;
  fileOutputRetry: boolean;
}): boolean {
  const { plannerMode, modes, resumeChain, isFreshBuild, actualPrompt, fileOutputRetry } = options;
  return !plannerMode
    && !modes?.questionMode
    && !modes?.destructiveMode
    && !modes?.ambiguousMode
    && !resumeChain
    && isFreshBuild
    && !isSystemContinuation(actualPrompt)
    && !isConversationalPrompt(actualPrompt)
    && !fileOutputRetry
    && !actualPrompt.includes('<edit ');
}
