import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './ActionMenu.css';

export interface ActionMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

/** Shared keyboard and focus behavior for secondary workspace actions. */
export default function ActionMenu({ label, children, items, className = '' }: {
  label: string; children: ReactNode; items: ActionMenuItem[]; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 400 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const id = useId();
  const tooltipId = `${id}-tooltip`;

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom - 16;
    const above = anchor.top - 16;
    const height = menu.current.scrollHeight;
    const opensAbove = below < Math.min(height, 240) && above > below;
    const maxHeight = Math.max(80, opensAbove ? above : below);
    setPosition({
      left: Math.max(12, Math.min(anchor.right - 224, window.innerWidth - 236)),
      top: opensAbove ? Math.max(12, anchor.top - Math.min(height, maxHeight) - 6) : anchor.bottom + 6,
      maxHeight,
    });
    const buttons = menu.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    buttons[focusLast.current ? buttons.length - 1 : 0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener('pointerdown', outside);
    // Attach scroll/blur/resize dismissal one beat after opening: the smooth
    // scroll-into-view that preceded the opening click can keep firing scroll
    // events for a few frames, and those must not instantly close the menu.
    let detachDismiss: (() => void) | undefined;
    const dismissTimer = window.setTimeout(() => {
      window.addEventListener('resize', dismiss);
      window.addEventListener('blur', dismiss);
      window.addEventListener('scroll', scroll, true);
      detachDismiss = () => {
        window.removeEventListener('resize', dismiss);
        window.removeEventListener('blur', dismiss);
        window.removeEventListener('scroll', scroll, true);
      };
    }, 150);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.clearTimeout(dismissTimer);
      detachDismiss?.();
    };
  }, [open]);

  const close = () => { trigger.current?.focus(); setOpen(false); };

  return <>
    <span
      className="studio-control-tooltip-anchor"
      onMouseEnter={() => { if (!open) setShowTooltip(true); }}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => { if (!open) setShowTooltip(true); }}
      onBlur={() => setShowTooltip(false)}
    >
    <button ref={trigger} type="button" className={className} aria-label={label}
      aria-describedby={showTooltip && !open ? tooltipId : undefined}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => {
        setShowTooltip(false);
        focusLast.current = false;
        setOpen(value => !value);
      }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          setShowTooltip(false);
          event.preventDefault();
          focusLast.current = event.key === 'ArrowUp';
          setOpen(true);
        }
      }}>{children}</button>
      {showTooltip && !open && <span className="studio-control-tooltip" role="tooltip" id={tooltipId}>{label}</span>}
    </span>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label={label} className="studio-action-menu"
      style={position}
      onKeyDown={event => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
          close(); return;
        }
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next = current;
        if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
        else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else return;
        event.preventDefault(); buttons[next]?.focus();
      }}>
      {items.map(item => <div key={item.label} role="none">
        {item.separator && <div role="separator" className="studio-action-menu-divider" />}
        <button type="button" role="menuitem" className={item.danger ? 'is-danger' : ''} disabled={item.disabled}
          onClick={() => { close(); item.onSelect(); }}>{item.icon}<span>{item.label}</span></button>
      </div>)}
    </div>, document.body)}
  </>;
}
