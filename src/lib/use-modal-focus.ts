import { useEffect, useRef } from 'react';

const modalStack: HTMLElement[] = [];

// Body scroll locking is reference-counted so stacked modals don't restore
// scrolling while another modal is still open.
let bodyScrollLocks = 0;
let previousBodyOverflow = '';

function lockBodyScroll() {
  if (bodyScrollLocks === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyScrollLocks += 1;
}

function unlockBodyScroll() {
  bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
  if (bodyScrollLocks === 0) document.body.style.overflow = previousBodyOverflow;
}

export function useModalFocus(isOpen: boolean, onClose?: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const container = containerRef.current;
    if (!isOpen || !container) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(container);
    lockBodyScroll();
    const isTopModal = () => modalStack[modalStack.length - 1] === container;
    const focusable = () => Array.from(container.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]'
    )).filter(element => !element.matches(':disabled, [tabindex="-1"]') && element.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] || container).focus();
    const handleFocus = (event: FocusEvent) => {
      if (isTopModal() && !container.contains(event.target as Node)) focusFirst();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (!isTopModal()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.();
      } else if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0] || container;
        const last = elements[elements.length - 1] || container;
        if (!elements.length || !container.contains(document.activeElement) ||
          (!event.shiftKey && document.activeElement === last) ||
          (event.shiftKey && (document.activeElement === first || document.activeElement === container))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener('focusin', handleFocus);
    document.addEventListener('keydown', handleKey, true);
    if (!container.contains(document.activeElement)) focusFirst();
    return () => {
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('keydown', handleKey, true);
      const position = modalStack.indexOf(container);
      if (position !== -1) modalStack.splice(position, 1);
      unlockBodyScroll();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  return containerRef;
}
