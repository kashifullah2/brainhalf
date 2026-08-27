// ---------------------------------------------------------------------------
// Keyboard shortcut handler for the Review Queue detail page.
//
// Hotkeys:
//   J / ↓           Next field
//   K / ↑           Previous field
//   A               Approve focused field
//   E               Save edit (corrected) on focused field
//   R               Reject focused field
//   Shift+A         Approve all remaining
//   Escape          Back to queue
//
// Only active when no text input is focused (so editing a field value does not
// trigger actions). The textarea inside each field card captures focus when
// the user clicks into it; hotkeys resume when focus leaves.
// ---------------------------------------------------------------------------

import { useEffect, useCallback, useRef } from "react";

export interface ReviewHotkeysConfig {
  /** Total number of fields in the review list. */
  fieldCount: number;
  /** Currently focused field index (0-based). */
  focusedIndex: number;
  /** Move focus to a field by index. */
  onFocusField: (index: number) => void;
  /** Approve the field at the given index. */
  onApprove: (index: number) => void;
  /** Save correction on the field at the given index. */
  onCorrect: (index: number) => void;
  /** Reject the field at the given index. */
  onReject: (index: number) => void;
  /** Approve all remaining unreviewed fields. */
  onApproveAll: () => void;
  /** Navigate back to the queue list. */
  onBack: () => void;
}

/**
 * Returns true when the active element is a text-editing control and keystrokes
 * should be left alone (so typing in the correction textarea does not fire
 * review actions).
 */
function isEditingText(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useReviewHotkeys(config: ReviewHotkeysConfig) {
  const configRef = useRef(config);
  configRef.current = config;

  const handler = useCallback((e: KeyboardEvent) => {
    // Never intercept when the user is typing into a field value.
    if (isEditingText()) return;

    const c = configRef.current;
    if (c.fieldCount === 0) return;

    switch (e.key) {
      case "j":
      case "ArrowDown": {
        e.preventDefault();
        const next = Math.min(c.focusedIndex + 1, c.fieldCount - 1);
        c.onFocusField(next);
        break;
      }

      case "k":
      case "ArrowUp": {
        e.preventDefault();
        const prev = Math.max(c.focusedIndex - 1, 0);
        c.onFocusField(prev);
        break;
      }

      case "a":
      case "A": {
        e.preventDefault();
        if (e.shiftKey) {
          c.onApproveAll();
        } else {
          c.onApprove(c.focusedIndex);
        }
        break;
      }

      case "e": {
        e.preventDefault();
        c.onCorrect(c.focusedIndex);
        break;
      }

      case "r": {
        e.preventDefault();
        c.onReject(c.focusedIndex);
        break;
      }

      case "Escape": {
        e.preventDefault();
        c.onBack();
        break;
      }

      default:
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}
