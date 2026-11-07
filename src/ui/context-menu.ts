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
  onDelete?: (card: PaperCardData) => void;
  onOpenNativeMenu?: (card: PaperCardData, event: MouseEvent) => void;
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
    openNote: '📝 노트 열기 / 편집',
    toggleRead: '🏷️ 읽기 상태 변경 (Unread/Reading/Read)',
    copyCitation: '📋 APA 7 인용 복사',
    copyNote: '📋 노트 본문 복사',
    regenerateCover: '🔄 표지 다시 생성',
    deleteItem: '🗑️ 삭제 / 휴지통 이동',
    deleteNote: '🗑️ 노트 삭제',
    nativeMenu: '⚙️ Zotero 기본 메뉴 열기...'
  },
  en: {
    openPdf: '📄 Open PDF',
    openNote: '📝 Open / Edit Note',
    toggleRead: '🏷️ Toggle Reading Status',
    copyCitation: '📋 Copy APA 7 Citation',
    copyNote: '📋 Copy Note Text',
    regenerateCover: '🔄 Regenerate Cover',
    deleteItem: '🗑️ Remove / Move to Trash',
    deleteNote: '🗑️ Move Note to Trash',
    nativeMenu: '⚙️ More Zotero Actions...'
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
  const isNote = card.itemType === 'note';

  const menuItems: Array<{
    id: string;
    label: string;
    icon: string;
    disabled: boolean;
    separatorBefore?: boolean;
    action: () => void;
  }> = isNote
    ? [
        {
          id: 'menu-open-pdf',
          label: text.openNote,
          icon: '📝',
          disabled: false,
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
          label: text.copyNote,
          icon: '📋',
          disabled: false,
          action: () => actions.onCopyCitation?.(card)
        },
        {
          id: 'menu-delete-item',
          label: text.deleteNote,
          icon: '🗑️',
          disabled: false,
          separatorBefore: true,
          action: () => actions.onDelete?.(card)
        }
      ]
    : [
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

  if (!isNote && actions.onDelete) {
    menuItems.push({
      id: 'menu-delete-item',
      label: text.deleteItem,
      icon: '🗑️',
      disabled: false,
      separatorBefore: true,
      action: () => actions.onDelete?.(card)
    });
  }

  // Native Zotero context menu bridge (#zotero-itemmenu / #zotero-item-contextmenu) if present in window
  const nativePopup =
    doc.getElementById?.('zotero-itemmenu') ||
    doc.getElementById?.('zotero-item-contextmenu');
  if (nativePopup || actions.onOpenNativeMenu) {
    menuItems.push({
      id: 'menu-native-zotero',
      label: text.nativeMenu,
      icon: '⚙️',
      disabled: false,
      separatorBefore: true,
      action: () => {
        if (actions.onOpenNativeMenu) {
          actions.onOpenNativeMenu(card, event);
          return;
        }
        try {
          if (typeof (nativePopup as any)?.openPopupAtScreen === 'function') {
            (nativePopup as any).openPopupAtScreen(
              event.screenX || event.clientX || 100,
              event.screenY || event.clientY || 100,
              true
            );
          }
        } catch {}
      }
    });
  }

  for (const item of menuItems) {
    if (item.separatorBefore) {
      const sepEl = doc.createElementNS(HTML_NS, 'div');
      sepEl.className = 'context-menu-separator';
      menuEl.appendChild(sepEl);
    }

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

  // Positioning (Safe mount on XUL/XHTML window even when doc.body is absent)
  const mountTarget = doc.body || doc.getElementById?.('zotero-main-window') || doc.documentElement;
  mountTarget?.appendChild(menuEl);
  activeMenuEl = menuEl;

  const clickX = event.clientX || 0;
  const clickY = event.clientY || 0;
  const rect = typeof menuEl.getBoundingClientRect === 'function' ? menuEl.getBoundingClientRect() : null;
  const measuredWidth = menuEl.offsetWidth || rect?.width || 0;
  const measuredHeight = menuEl.offsetHeight || rect?.height || 0;
  const separatorCount = menuItems.filter((m) => m.separatorBefore).length;
  const menuWidth = measuredWidth > 0 ? measuredWidth : 280;
  const menuHeight = measuredHeight > 0 ? measuredHeight : menuItems.length * 32 + separatorCount * 9 + 8;
  const winWidth = win?.innerWidth || doc.documentElement?.clientWidth || 1000;
  const winHeight = win?.innerHeight || doc.documentElement?.clientHeight || 800;

  const left = clickX + menuWidth > winWidth ? Math.max(10, winWidth - menuWidth - 10) : Math.max(10, clickX);
  const top = clickY + menuHeight > winHeight ? Math.max(10, winHeight - menuHeight - 10) : Math.max(10, clickY);

  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;

  // Auto-dismiss on click/mousedown outside or ESC
  // Guard against macOS trackpad Control+Click or two-finger tap trailing click event in the same gesture (even if held >150ms)
  const openedAt = Date.now();
  const originTarget = event.target as Node | null;
  let pointerDownOutside = false;

  const handleOutsideMouseDown = (e: MouseEvent) => {
    if (!menuEl.contains(e.target as Node)) {
      pointerDownOutside = true;
      closeActiveContextMenu();
    }
  };

  const handleOutsideClick = (e: MouseEvent) => {
    const elapsed = Date.now() - openedAt;
    if (!pointerDownOutside) {
      if (e.ctrlKey || e.button === 2) return;
      if (
        elapsed < 600 &&
        originTarget &&
        (e.target === originTarget || (originTarget as HTMLElement)?.contains?.(e.target as Node))
      ) {
        return;
      }
      if (elapsed < 150) return;
    }
    if (!menuEl.contains(e.target as Node)) {
      closeActiveContextMenu();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeActiveContextMenu();
    }
  };

  win?.addEventListener?.('mousedown', handleOutsideMouseDown, true);
  win?.addEventListener?.('click', handleOutsideClick, true);
  win?.addEventListener?.('keydown', handleKeyDown, true);

  activeCleanup = () => {
    win?.removeEventListener?.('mousedown', handleOutsideMouseDown, true);
    win?.removeEventListener?.('click', handleOutsideClick, true);
    win?.removeEventListener?.('keydown', handleKeyDown, true);
  };

  return menuEl;
}
