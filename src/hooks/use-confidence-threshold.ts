import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSettings } from "@/lib/api-client";

/**
 * The account's review threshold, fetched once and shared.
 *
 * Five components each kept their own `useState(0.8)` plus an effect that
 * fetched `/api/settings` on mount. On a batch page with the side panel open
 * that was three identical requests for one number, and any one of them failing
 * left that component colouring confidence against 0.8 while the account said
 * 0.95 — the same field rendered in two different tones side by side.
 *
 * ReviewQueue and ReviewQueueDetail additionally awaited it *before* fetching
 * their data, putting a whole round trip in series ahead of the page load.
 */
export const CONFIDENCE_THRESHOLD_KEY = ["settings", "confidenceThreshold"] as const;

import { DEFAULT_CONFIDENCE_THRESHOLD } from "../../server/threshold";

/** Used only until the first response lands, and if the request fails. */
export { DEFAULT_CONFIDENCE_THRESHOLD };

export function useConfidenceThreshold(): number {
  const { data } = useQuery({
    queryKey: CONFIDENCE_THRESHOLD_KEY,
    queryFn: async () => (await getSettings()).confidenceThreshold,
    // The threshold changes only when someone drags the Settings slider, and
    // that path invalidates this key explicitly.
    staleTime: 5 * 60_000,
  });
  return data ?? DEFAULT_CONFIDENCE_THRESHOLD;
}

/** Call after writing the threshold so every open view picks up the new value. */
export function useSyncConfidenceThreshold() {
  const queryClient = useQueryClient();
  return (threshold: number) => {
    queryClient.setQueryData(CONFIDENCE_THRESHOLD_KEY, threshold);
    queryClient.invalidateQueries({ queryKey: CONFIDENCE_THRESHOLD_KEY });
  };
}
