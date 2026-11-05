/**
 * Clean-room Context Menu for Paper Cards in Cover Grid View
 * Supports Korean & English localization.
 */

import { PaperCardData } from '../types';

export interface ContextMenuActions {
  onOpenPdf?: (card: PaperCardData) => void;
  onToggleRead?: (card: PaperCardData) => void;
  onCopyCitation?: (card: PaperCardData) => void;
  onRegenerateCover?: (card: PaperCardData) => void;
}

export interface ContextMenuOptions {
  event: MouseEvent;
  card: PaperCardData;
  win: any;
  actions: ContextMenuActions;
}

function getLocale(win: any): 'ko' | 'en' {
  try {
    const loc = win?.Zotero?.locale || (globalThis as any).Zotero?.locale || win?.navigator?.language || '';
    if (String(loc).toLowerCase().startsWith('ko')) {
      return 'ko';
    }
  } catch {}
  return 'en';
}

const I18N = {
  ko: {
    openPdf: '📄 PDF 열기',
    toggleRead: '🏷️ 읽기 상태 변경 (Unread/Reading/Read)',
    copyCitation: '📋 APA 7 인용 복사',
    regenerateCover: '🔄 표지 다시 생성'
  },
  en: {
    openPdf: '📄 Open PDF',
    toggleRead: '🏷️ Toggle Reading Status',
    copyCitation: '📋 Copy APA 7 Citation',
    regenerateCover: '🔄 Regenerate Cover'
  }
};

let activeMenuEl: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;

export function closeActiveContextMenu() {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  if (activeMenuEl) {
    activeMenuEl.remove();
    activeMenuEl = null;
  }
}

export function showPaperCardContextMenu(options: ContextMenuOptions): HTMLElement {
  closeActiveContextMenu();

  const { event, card, win, actions } = options;
  const doc = win?.document || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('Document unavailable for context menu');

  event.preventDefault();
  event.stopPropagation();

  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const menuEl = doc.createElementNS(HTML_NS, 'div');
  menuEl.className = 'cover-grid-context-menu';
  menuEl.id = 'cover-grid-context-menu';

  const locale = getLocale(win);
  const text = I18N[locale];

  const menuItems = [
    {
      id: 'menu-open-pdf',
      label: text.openPdf,
      icon: '📄',
      disabled: !card.hasPdf,
      action: () => actions.onOpenPdf?.(card)
    },
    {
      id: 'menu-toggle-read',
      label: `${text.toggleRead} [${card.readStatus}]`,
      icon: '🏷️',
      disabled: false,
      action: () => actions.onToggleRead?.(card)
    },
    {
      id: 'menu-copy-citation',
      label: text.copyCitation,
      icon: '📋',
      disabled: false,
      action: () => actions.onCopyCitation?.(card)
    },
    {
      id: 'menu-regenerate-cover',
      label: text.regenerateCover,
      icon: '🔄',
      disabled: !card.hasPdf,
      action: () => actions.onRegenerateCover?.(card)
    }
  ];

  for (const item of menuItems) {
    const itemEl = doc.createElementNS(HTML_NS, 'div');
    itemEl.className = `context-menu-item${item.disabled ? ' disabled' : ''}`;
    itemEl.id = item.id;
    itemEl.textContent = item.label;

    if (!item.disabled) {
      itemEl.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        closeActiveContextMenu();
        item.action();
      });
    }

    menuEl.appendChild(itemEl);
  }

  // Positioning
  doc.body.appendChild(menuEl);
  activeMenuEl = menuEl;

  const clickX = event.clientX;
  const clickY = event.clientY;
  const menuWidth = 240;
  const menuHeight = menuItems.length * 36;
  const winWidth = win.innerWidth || doc.documentElement.clientWidth || 1000;
  const winHeight = win.innerHeight || doc.documentElement.clientHeight || 800;

  const left = clickX + menuWidth > winWidth ? Math.max(10, winWidth - menuWidth - 10) : clickX;
  const top = clickY + menuHeight > winHeight ? Math.max(10, winHeight - menuHeight - 10) : clickY;

  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;

  // Auto-dismiss on click outside or ESC
  const handleOutsideClick = (e: MouseEvent) => {
    if (!menuEl.contains(e.target as Node)) {
      closeActiveContextMenu();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeActiveContextMenu();
    }
  };

  win.addEventListener('click', handleOutsideClick, true);
  win.addEventListener('keydown', handleKeyDown, true);

  activeCleanup = () => {
    win.removeEventListener('click', handleOutsideClick, true);
    win.removeEventListener('keydown', handleKeyDown, true);
  };

  return menuEl;
}
