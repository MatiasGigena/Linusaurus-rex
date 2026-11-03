import { useEffect, useRef, type ReactNode } from 'react';

export interface ContextItem {
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  run(): void;
}
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: (ContextItem | null)[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const menu = ref.current;
    if (menu) {
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    const pointer = (event: PointerEvent) => {
      if (!menu?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !menu) return;
      event.preventDefault();
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[
        (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      ]?.focus();
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
    };
  }, [x, y, onClose]);
  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: x, top: y }}>
      {items.map((item, index) =>
        item ? (
          <button
            role="menuitem"
            key={index}
            disabled={item.disabled}
            className={item.danger ? 'is-danger' : ''}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ) : (
          <hr key={index} />
        ),
      )}
    </div>
  );
}
