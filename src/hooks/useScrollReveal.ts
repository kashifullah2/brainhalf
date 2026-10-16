import { useEffect } from 'react';

export function useScrollReveal() {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (targets.length === 0) return;

    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targets.forEach(el => el.classList.add('is-visible'));
      return;
    }

    targets.forEach(el => el.classList.add('will-reveal'));

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
