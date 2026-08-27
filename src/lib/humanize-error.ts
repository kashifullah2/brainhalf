// ---------------------------------------------------------------------------
// Turns an extraction error into something a person can act on.
//
// The stored errors are transport-level strings — "OCR processing failed (503):
// OCR is not configured on this deployment." — which tell the reader what broke
// but not what to do, and read like a stack trace in the middle of the UI. The
// raw text is never thrown away: callers keep it as a tooltip.
// ---------------------------------------------------------------------------

export interface HumanError {
  title: string;
  body: string;
  /** Only set when the fix belongs to whoever runs the deployment. */
  operatorHint?: string;
}

export function humanizeExtractionError(raw?: string | null): HumanError {
  const text = (raw ?? "").toLowerCase();

  if (!text) {
    return {
      title: "Extraction didn't finish",
      body: "No reason was recorded. Re-running the document usually settles it.",
    };
  }

  if (text.includes("not configured")) {
    return {
      title: "Extraction isn't switched on yet",
      body: "No model credential is set on this deployment, so the page was never read. Your file is stored safely and nothing was charged.",
      operatorHint:
        "If this deployment is yours: set HUNYUAN_API_KEY (or OPENAI_API_KEY) in .dev.vars for local dev, or in the Pages project's environment variables, then restart.",
    };
  }

  if (text.includes("rate limit") || text.includes("429") || text.includes("daily cap")) {
    return {
      title: "We've hit today's limit",
      body: "The extraction quota for today is used up. Nothing is lost — try this document again after the cap resets.",
    };
  }

  if (text.includes("too large") || text.includes("413") || text.includes("25 mb")) {
    return {
      title: "That file is bigger than we can read",
      body: "Documents up to 25 MB go through. A lower-resolution scan, or splitting a long PDF, usually does it.",
    };
  }

  if (text.includes("timeout") || text.includes("timed out")) {
    return {
      title: "The page took too long to read",
      body: "The model didn't answer in time. Dense or very high-resolution scans are the usual cause — try it again, or downscale it.",
    };
  }

  if (text.includes("unsupported") || text.includes("content-type") || text.includes("content type")) {
    return {
      title: "We can't read that file type",
      body: "JPG, PNG, WEBP and PDF are supported. Anything else needs converting first.",
    };
  }

  if (
    text.includes("unavailable") ||
    text.includes("502") ||
    text.includes("503") ||
    text.includes("upstream") ||
    text.includes("network")
  ) {
    return {
      title: "The extraction service didn't answer",
      body: "This one is on us, not your document. Re-run it in a moment and it normally goes straight through.",
    };
  }

  // Anything genuinely unexpected: show it, but frame it.
  return {
    title: "Extraction failed",
    body: raw ?? "",
  };
}
