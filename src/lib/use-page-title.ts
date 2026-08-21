import { useEffect } from "react";

/**
 * Sets the browser tab title for the current page. SPA route changes never
 * touch <title> on their own, so each page sets its own.
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
