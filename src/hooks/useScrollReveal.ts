import { useEffect } from 'react';

/**
 * Observes every [data-reveal] element in the document and adds the
 * `is-visible` class once the element enters the viewport (with 60px margin).
 * Disconnects after all elements have been revealed.
 */
export function useScrollReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll<HTMLElement>('[data-reveal]').forEach(el => {
        el.classList.add('is-visible');
      });
      return;
    }

    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (targets.length === 0) return;

    let pending = targets.length;
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add('is-visible');
            io.unobserve(entry.target);
            pending -= 1;
            if (pending <= 0) io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -60px 0px', threshold: 0.08 }
    );

    targets.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}
