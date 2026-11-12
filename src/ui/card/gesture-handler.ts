import { PaperCardData, ReadStatus } from '../../types';

export interface CardEventHandlers {
  onClick?: (card: PaperCardData, event: MouseEvent) => void;
  onDoubleClick?: (card: PaperCardData, event: MouseEvent) => void;
  onContextMenu?: (card: PaperCardData, event: MouseEvent) => void;
  onStatusChange?: (card: PaperCardData, nextStatus: ReadStatus) => void;
  onDragStart?: (card: PaperCardData, event: DragEvent) => void;
}

export function isMacEnvironment(doc?: any): boolean {
  try {
    const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
    const z = win?.Zotero || (globalThis as any).Zotero;
    if (z?.isMac === true) return true;
    if (z?.isMac === false) return false;
    const platform = String(
      win?.navigator?.platform ||
      win?.navigator?.userAgent ||
      (typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : '')
    );
    if (/Mac|iPhone|iPod|iPad/i.test(platform)) return true;
    if (typeof process !== 'undefined' && (process as any)?.platform === 'darwin') return true;
    if (/Win|Linux/i.test(platform)) return false;
  } catch {}
  return true;
}

/**
 * Attach mouse, trackpad, drag-and-drop, and gesture guard listeners to a paper card element.
 * Handles zero-delay instant click dispatch, macOS Control+Click right-click emulation,
 * and suppression of trailing click events when contextmenu is opened.
 */
export function attachCardGestureHandlers(
  cardEl: HTMLElement,
  card: PaperCardData,
  handlers: CardEventHandlers = {},
  doc?: Document
): void {
  const targetDoc: Document =
    doc ||
    cardEl.ownerDocument ||
    (typeof document !== 'undefined'
      ? document
      : (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero.getMainWindow?.()?.document : null));

  let lastContextMenuTs = 0;
  let suppressNextClick = false;

  const dispatchContextMenu = (e: MouseEvent) => {
    const now = Date.now();
    if (now - lastContextMenuTs < 80) return;
    lastContextMenuTs = now;
    suppressNextClick = true;
    handlers.onContextMenu?.((cardEl as any).__cardData || card, e);
  };

  cardEl.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === 2 || (e.ctrlKey && !e.metaKey && handlers.onContextMenu && isMacEnvironment(targetDoc))) {
      suppressNextClick = true;
    } else {
      suppressNextClick = false;
    }
  });

  cardEl.addEventListener('click', (e: MouseEvent) => {
    // If contextmenu already fired during this press gesture, swallow the trailing click completely (even if held >150ms or Control key released early)
    if (suppressNextClick) {
      suppressNextClick = false;
      if (Date.now() - lastContextMenuTs < 1000) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    // Support synthetic / standalone macOS trackpad Control + Click as right-click context menu instead of multi-select
    if (e.button === 2 || (e.ctrlKey && !e.metaKey && handlers.onContextMenu && isMacEnvironment(targetDoc))) {
      e.preventDefault();
      e.stopPropagation();
      dispatchContextMenu(e);
      suppressNextClick = false;
      return;
    }
    try {
      cardEl.focus?.({ preventScroll: true });
    } catch {}
    handlers.onClick?.((cardEl as any).__cardData || card, e);
  });

  cardEl.addEventListener('dblclick', (e) => {
    handlers.onDoubleClick?.((cardEl as any).__cardData || card, e);
  });

  cardEl.addEventListener('contextmenu', (e) => {
    dispatchContextMenu(e);
  });

  cardEl.addEventListener('dragstart', (e: DragEvent) => {
    cardEl.classList.add('is-dragging');
    const activeCard: PaperCardData = (cardEl as any).__cardData || card;
    if (handlers.onDragStart) {
      handlers.onDragStart(activeCard, e);
    } else if (e.dataTransfer) {
      try {
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('zotero/item', String(activeCard.id));
        e.dataTransfer.setData('text/x-zotero-drag-item', JSON.stringify({ itemIDs: [activeCard.id] }));
        e.dataTransfer.setData('text/plain', `${activeCard.authorText} (${activeCard.year || 'n.d.'}) - ${activeCard.title}`);
      } catch {}
    }
  });

  cardEl.addEventListener('dragend', () => {
    cardEl.classList.remove('is-dragging');
  });
}

export const attachCardGestures = attachCardGestureHandlers;
