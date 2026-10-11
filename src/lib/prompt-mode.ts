import { isSystemContinuation } from './chat-transcript';

/* ═══════════════════════════════════════════════════════════════════════════
 * Shared patterns
 * ═══════════════════════════════════════════════════════════════════════════ */

// Broad list of web-related nouns that anchor a prompt to a build.
// Shared between question and ambiguous gates so they agree on what's concrete.
const BUILD_TARGET = /\b(app|website|web\s?app|component|webpage|web\s?page|landing(?:\s?page)?|dashboard|button|form|feature|project|codebase|repo|repository|code|file|files|database|api|endpoint|page|pages|site|shop|store|blog|portfolio|game|navbar|sidebar|header|footer|menu|modal|theme|layout|table|chart|card|list|input|search|notification|animation|image|gallery|video|slider|dropdown|popup|dialog|drawer|tab|panel|toolbar|toggle|icon|logo|login|signup|auth|checkout|cart|profile|settings|editor|viewer|player|calendar|map)\b/i;

const BUILD_VERB = /\b(build|create|generate|make|add|fix|edit|update|change|modify|implement|refactor|redesign|restyle|deploy|publish|delete|remove|design|set\s?up|install|configure|connect|integrate|replace|move|rename|copy|paste|insert|wrap|unwrap|merge|split|convert|migrate|upgrade|downgrade|enable|disable|hide|show|render|display|fetch|load|import|export|style|animate)\b/i;

// Anchors the prompt to the user's workspace.
const WORKSPACE_ANCHOR = /\b(?:my|this|the|our|your)\s+(?:app|project|website|site|code|codebase|repo|page)\b/i;

/* ═══════════════════════════════════════════════════════════════════════════
 * Planner mode
 *
 * Planning is an explicit intent, not a consequence of a detailed app brief.
 * Long requirements and lists must still build the application by default.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function shouldAutoPlannerMode(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text) return false;

  if (/^\/(plan|planner)\b/i.test(text)) return true;
  if (/^\/(build|implement|ship)\b/i.test(text)) return false;
  if (/\bno[\s-]?plan\b/i.test(text)) return false;

  return /^(?:please\s+)?(?:plan\b|brainstorm\b|outline\b|(?:give|write|create)\s+(?:me\s+)?(?:a\s+)?(?:plan|roadmap)\b|help\s+me\s+plan\b|(?:audit|review)\s+(?:the\s+)?(?:codebase|architecture)\b)/i.test(text);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Conversational gate
 *
 * A conversational turn must not start a hidden app-generation retry.
 * Matches greetings, acknowledgements, and meta-questions about the tool.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function isConversationalPrompt(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text) return false;
  return /^(?:hi|hello|hey|yo|sup|greetings|howdy|hiya|good\s+(?:morning|afternoon|evening|day)|thanks|thank\s+you|thx|thanks?\s+(?:a\s+lot|so\s+much|very\s+much)|ok|okay|sure|got\s+it|nice|cool|great|perfect|awesome|sounds?\s+good|understood|alright|yep|yup|yeah|yes|no|nope|nah|hmm|hm|ah|oh|wow|lol|haha)[\s,.!?]*$/i.test(text)
    || /^(?:what\s+can\s+you\s+(?:do|build|make)|what\s+are\s+you|who\s+are\s+you|how\s+(?:does\s+this|do\s+you)\s+work)[\s,.!?]*$/i.test(text);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * B4: Destructive gate
 *
 * Detects wipe-the-project requests ("delete all files", "wipe everything",
 * "nuke the codebase", "scrap it all"). Targeted deletions ("delete the old
 * logo") are NOT destructive — only requests covering all/most of the
 * codebase. When true, the generation runs tool-less so zero file operations
 * can occur before explicit confirmation.
 *
 * Stops at clause boundaries (,.;) to avoid false positives like
 * "remove the header, add all pages to the project nav".
 *
 * Qualified targets ("all unused code", "every old file") are excluded
 * because they describe a scoped cleanup, not a full wipe.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function isDestructivePrompt(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text) return false;
  if (isSystemContinuation(text)) return false;
  if (/^\/(plan|planner|build|implement|ship)\b/i.test(text)) return false;

  const ACTION = /\b(?:delete|remove|wipe|clear|erase|destroy|nuke|scrap|trash)\b/i;
  // Qualifier words that narrow the scope (targeted cleanup, not a wipe).
  const QUALIFIER = /\b(?:unused|old|dead|duplicate|commented|temporary|extra|unnecessary|unneeded|redundant|stale|broken|deprecated|obsolete|empty|blank)\b/i;
  // Full-scope words: the request covers the whole project.
  // "everything" is a single token (not "every" + boundary + noun).
  const SCOPE_WORD = /\b(?:everything|(?:(?:all|every|each|entire|whole)\s+(?:(?:of\s+)?(?:the|my|our|your)\s+)?(?:files?|code(?:base)?|project|app|repo(?:sitory)?|things?)))\b/i;
  const IT_ALL = /\bit\s+all\b/i;

  // Split on sentence/clause boundaries to prevent cross-clause matches.
  const clauses = text.split(/[.?!,;]+/);
  for (const clause of clauses) {
    const c = clause.trim();
    if (!ACTION.test(c)) continue;
    // "everything" / "it all" alone in the same clause
    if (/\beverything\b/i.test(c) || IT_ALL.test(c)) return true;
    // Scoped: "delete all files", "wipe the entire codebase"
    if (SCOPE_WORD.test(c)) {
      // But NOT "remove all unused code" — qualifier makes it targeted
      const afterAction = c.replace(ACTION, '');
      if (!QUALIFIER.test(afterAction)) return true;
    }
  }
  // "start over" + a delete verb in the same sentence
  if (/\bstart\s+over\b/i.test(text) && ACTION.test(text)) return true;
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * B5: Question/chat gate
 *
 * Detects plain-text questions and creative-writing requests that must be
 * answered in chat with ZERO file operations ("write a haiku", "explain
 * recursion"). Conservative by design: anything mentioning the app/project
 * or carrying build intent returns false so builds are never hijacked.
 *
 * Modal verbs (can/could/would/will + you) are only questions when the next
 * verb is explanation-oriented (explain, tell, show, describe). "Can you
 * build me a portfolio site?" is a build request.
 *
 * The trailing-? rule only fires when the prompt starts with a recognized
 * English question word, so non-English prompts like "¿Puedes crear una
 * app?" are not misclassified.
 * ═══════════════════════════════════════════════════════════════════════════ */

const EXPLANATION_VERB = /^(?:explain|tell|show|describe|define|walk|teach|remind|clarify|elaborate|summarize|list|compare|outline|recap|review|discuss|say|think|know|mean|understand)/i;

export function isQuestionPrompt(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text || isConversationalPrompt(text)) return false;
  if (isSystemContinuation(text)) return false;
  if (/^\/(plan|planner|build|implement|ship)\b/i.test(text)) return false;
  if (isDestructivePrompt(text)) return false;

  // Modal requests: "Can you build me a site?" vs "Can you explain auth?"
  // Modals are the only question openers where we must distinguish build from
  // question intent, because "Can you fix the navbar?" is a build request.
  const modal = text.match(/^(?:please\s+)?(?:can|could|would|will)\s+(?:you|u)\s+(?:please\s+)?(\w+)/i);
  if (modal) {
    if (EXPLANATION_VERB.test(modal[1])) return true;
    // If the verb after the modal is a build verb, it's a build command
    // even when the target isn't in our list ("Could you add dark mode?")
    if (BUILD_VERB.test(modal[1])) return false;
    if (BUILD_VERB.test(text) && BUILD_TARGET.test(text)) return false;
    if (WORKSPACE_ANCHOR.test(text)) return false;
    return /\?\s*$/.test(text);
  }

  // Standard question openers. These are always questions regardless of build
  // words in the sentence — "How does the delete button work?" is a question
  // even though "delete" is a build verb and "button" is a build target.
  if (/^(?:what|why|how|when|where|who|whom|whose|which|do|does|did|is|are|was|were|should|have|has|tell\s+me|explain|define|describe)\b/i.test(text)) return true;

  // For everything else: build intent disqualifies question mode.
  if (BUILD_VERB.test(text) && BUILD_TARGET.test(text)) return false;
  if (WORKSPACE_ANCHOR.test(text)) return false;

  // Only apply trailing ? when the prompt starts with an English question word
  if (/\?\s*$/.test(text) && /^(?:what|why|how|when|where|who|whom|whose|which|is|are|was|were|do|does|did|can|could|would|will|should|shall|have|has|had|may|might|must|tell|explain|describe|define)/i.test(text)) return true;

  // Creative writing requests — haiku/poem/story, not code.
  if (/^(?:please\s+)?(?:write|compose)\s+(?:me\s+)?(?:a|an|the)?\s*(?:haiku|poem|poetry|story|short\s+story|joke|essay|song|lyrics|letter|speech|article|summary|tagline|slogan|limerick)\b/i.test(text)) return true;

  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Ambiguous gate
 *
 * Detects vague build requests with no actionable target ("make something
 * cool", "build me anything", "do something fun"). These carry build intent
 * but nothing to build — launching a full generation burns minutes and
 * produces a random app. When true, the generation runs tool-less so the
 * model asks clarifying questions instead.
 *
 * "Something" is only vague when the prompt is short and has no descriptive
 * tail. "Make something that tracks my expenses" is concrete enough.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function isAmbiguousPrompt(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text || isConversationalPrompt(text) || isQuestionPrompt(text) || isDestructivePrompt(text)) return false;
  if (isSystemContinuation(text)) return false;
  if (/^\/(plan|planner|build|implement|ship)\b/i.test(text)) return false;
  if (BUILD_TARGET.test(text)) return false;
  if (WORKSPACE_ANCHOR.test(text)) return false;

  // Vague object + build verb, nothing concrete: "make something cool".
  // But "make something that tracks my expenses" has a descriptive clause.
  const vagueObject = /\b(?:something|anything|whatever|stuff)\b/i;
  if (vagueObject.test(text) && BUILD_VERB.test(text)) {
    // A relative clause ("that", "which", "to", "for", "with") makes it concrete.
    if (/\b(?:that|which|to|for|with)\b/i.test(text)) return false;
    const wordCount = text.split(/\s+/).length;
    if (wordCount <= 10) return true;
    return true;
  }

  // Very short bare imperatives with no object at all.
  if (/^(?:surprise me|impress me|show me something|do something|just do it|idk|i don'?t know)[\s.!]*$/i.test(text)) return true;
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Staged pipeline gate
 *
 * Staging (the 3-stage architecture/layout/backend pipeline) is for fresh
 * full-app builds only. System continuations, questions, destructive
 * confirmations, clarifying prompts, resumes, and edits to an existing app
 * must never enter staging.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function shouldUseStagedPipeline(options: {
  plannerMode: boolean;
  modes?: { questionMode?: boolean; destructiveMode?: boolean; ambiguousMode?: boolean };
  resumeChain: unknown;
  isFreshBuild: boolean;
  actualPrompt: string;
  fileOutputRetry: boolean;
}): boolean {
  const { plannerMode, modes, resumeChain, isFreshBuild, actualPrompt, fileOutputRetry } = options;
  if (plannerMode
    || modes?.questionMode
    || modes?.destructiveMode
    || modes?.ambiguousMode
    || resumeChain
    || !isFreshBuild
    || isSystemContinuation(actualPrompt)
    || isConversationalPrompt(actualPrompt)
    || fileOutputRetry
    || actualPrompt.includes('<edit ')) {
    return false;
  }
  const wordCount = actualPrompt.trim().split(/\s+/).length;
  const wantsPhased = /\bphase[d]?\b|\bstep[ -]?by[ -]?step\b|\bstage[d]?\b/i.test(actualPrompt);
  return wordCount > 400 || wantsPhased;
}
