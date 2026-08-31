import * as React from "react";
import { useLocation } from "wouter";

/**
 * Whether the app's navigation drawer is open on small screens.
 *
 * The state lives here rather than in AppLayout because the two components that
 * need it are siblings, not parent and child: Navbar renders the trigger and is
 * mounted once in App.tsx above the router, while AppLayout renders the drawer
 * itself and only exists on /app routes. Passing a prop between them would mean
 * hoisting sidebar state into App, which is where it least belongs.
 *
 * Below the 768px breakpoint the sidebar was a permanent 64px icon rail. On a
 * 375px viewport that is 17% of the width spent on chrome, with no labels — so
 * on mobile it becomes an off-canvas panel with labels, and the page gets the
 * whole screen back.
 */
interface MobileNavState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const MobileNavContext = React.createContext<MobileNavState | null>(null);

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [location] = useLocation();

  const open = React.useCallback(() => setIsOpen(true), []);
  const close = React.useCallback(() => setIsOpen(false), []);
  const toggle = React.useCallback(() => setIsOpen((v) => !v), []);

  // Tapping a destination should navigate AND dismiss. Keying this on the
  // location rather than wiring an onClick to every link means it also covers
  // the back button and any link added later.
  React.useEffect(() => {
    setIsOpen(false);
  }, [location]);

  // Escape closes it, and the body does not scroll behind an open overlay.
  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const value = React.useMemo(
    () => ({ isOpen, open, close, toggle }),
    [isOpen, open, close, toggle],
  );

  return (
    <MobileNavContext.Provider value={value}>
      {children}
    </MobileNavContext.Provider>
  );
}

/**
 * Returns null outside the provider rather than throwing, so Navbar can render
 * on the marketing and auth routes — where there is no app drawer to open —
 * without a guard at every call site.
 */
export function useMobileNav(): MobileNavState | null {
  return React.useContext(MobileNavContext);
}
