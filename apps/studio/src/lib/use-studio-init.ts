import { useEffect } from "react";
import { useStudioStore } from "@stores/studio-store";
import { apiUrl } from "./api";
import { loadProjectFiles, saveDirtyFiles } from "./persistence";

/** Debounce window for autosaving edited files (ms). */
const AUTOSAVE_DELAY_MS = 1500;

/** Load credits and optional project (metadata + saved files) from URL on mount */
export function useStudioInit() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("projectId");

    if (projectId) {
      useStudioStore.getState().setProjectId(projectId);
      fetch(apiUrl(`/api/projects/${projectId}`), { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((p: { title?: string; gameType?: string } | null) => {
          if (p?.title) useStudioStore.getState().setProjectTitle(p.title);
        })
        .catch(() => {});

      // Hydrate saved files into the store + WebContainer so work survives refresh.
      void loadProjectFiles(projectId);
    }
    // Fresh sessions: useWebContainer hook handles boot + sync + ensureStudioReady.
    // No independent boot call here to avoid a race condition.

    fetch(apiUrl("/api/settings/credits"), { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { balance?: number } | null) => {
        if (data && typeof data.balance === "number") {
          useStudioStore.setState({ credits: data.balance });
        }
      })
      .catch(() => {});

    fetch(apiUrl("/api/auth/get-session"), { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user?: unknown } | null) => {
        useStudioStore.getState().setIsSignedIn(!!data?.user);
      })
      .catch(() => useStudioStore.getState().setIsSignedIn(false));

    // Debounced autosave: whenever files become dirty, persist them shortly after.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useStudioStore.subscribe((state) => {
      const hasDirty = state.projectFiles.some(
        (f) => f.type === "file" && f.isDirty
      );
      if (!hasDirty) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void saveDirtyFiles();
      }, AUTOSAVE_DELAY_MS);
    });

    // Best-effort flush on tab close so the last keystrokes aren't lost.
    const flushOnHide = () => {
      void saveDirtyFiles();
    };
    window.addEventListener("beforeunload", flushOnHide);

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("beforeunload", flushOnHide);
    };
  }, []);
}
