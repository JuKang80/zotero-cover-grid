import gridCss from '../styles/grid.css';
import { injectToolbarControls } from './toolbar';
import { VirtualGridScroller } from './virtual-scroller';
import { WindowCoverGridController } from '../sync/window-controller';
import { selectItemInZotero, selectItemsInZotero, openItemInZotero, deleteItemsInZotero } from './item-actions';
import { showPaperCardContextMenu } from './context-menu';
import { formatFullApa7Bibliography, copyTextToClipboard } from '../utils/apa-formatter';
import { cycleReadStatus } from './paper-card';

declare const ZoteroPane: any;
declare const Zotero: any;

/**
 * Safeguard against blank white screen:
 * 1. Dismiss #zotero-tab-cover overlay (.classList.add('hidden'))
 * 2. Sanitize Zotero_Tabs._tabs to prevent tab.data.icon TypeError in Zotero internal tabs.js
 * 3. Clean up orphaned empty #zotero-cover-grid-tab containers if uninitialized
 * 4. Restore #tabs-deck selectedIndex to 0 if invalid
 */
export function ensureMainWindowStability(doc: any, win?: any): void {
  if (!doc || typeof doc.getElementById !== 'function') return;

  const tabCover = doc.getElementById('zotero-tab-cover');
  if (tabCover && !tabCover.classList.contains('hidden')) {
    tabCover.classList.add('hidden');
  }

  // Dismiss context pane loading spinner if active
  const contextPane = win?.ZoteroContextPane || doc.defaultView?.ZoteroContextPane;
  if (contextPane?.showLoadingMessage) {
    try {
      contextPane.showLoadingMessage(false);
    } catch {
      // Ignore
    }
  }

  // Sanitize any existing tabs in Zotero_Tabs memory
  const tabs = win?.Zotero_Tabs || doc.defaultView?.Zotero_Tabs;
  if (tabs && Array.isArray(tabs._tabs)) {
    for (const t of tabs._tabs) {
      if (t && !t.data) {
        t.data = { icon: 'library' };
      } else if (t && (t.id === 'zotero-cover-grid-tab' || t.type === 'custom') && !t.data?.icon) {
        t.data.icon = 'library';
      }
    }
  }

  const tabsDeck = doc.getElementById('tabs-deck');
  if (tabsDeck) {
    // If an orphaned empty cover-grid tab-content exists without children or without active tab instance, remove it
    const orphanedTabContent = doc.getElementById('zotero-cover-grid-tab');
    if (orphanedTabContent && (!orphanedTabContent.firstElementChild || !win?.__zoteroCoverGridTabInstance)) {
      const activeTabInList = tabs?._tabs?.some((t: any) => t.id === 'zotero-cover-grid-tab');
      if (!activeTabInList) {
        orphanedTabContent.remove();
      }
    }

    const childCount = tabsDeck.children?.length || 0;
    if (tabsDeck.selectedIndex === -1 || tabsDeck.selectedIndex === undefined || (childCount > 0 && tabsDeck.selectedIndex >= childCount)) {
      tabsDeck.selectedIndex = 0;
    }
  }
}

/**
 * UI injection and teardown lifecycle for Zotero MainWindow
 */
export function injectCoverGridUI(win: any) {
  const doc = win.document;
  if (!doc) return;

  // Safeguard against white screen before injection
  ensureMainWindowStability(doc, win);

  // Close and remove any deprecated legacy 'zotero-cover-grid-tab' (📚 Cover Grid tab) from older sessions
  const tabs = win?.Zotero_Tabs || doc.defaultView?.Zotero_Tabs;
  if (tabs) {
    try {
      const legacyTab = Array.isArray(tabs._tabs)
        ? tabs._tabs.find((t: any) => t && t.id === 'zotero-cover-grid-tab')
        : null;
      if (legacyTab && typeof tabs.close === 'function') {
        tabs.close('zotero-cover-grid-tab');
      }
      if (typeof tabs.select === 'function' && tabs.selectedID === 'zotero-cover-grid-tab') {
        tabs.select('zotero-pane');
      }
    } catch {
      // Ignore
    }
  }
  doc.getElementById('zotero-cover-grid-tab')?.remove();

  const itemsPane = doc.getElementById('zotero-items-pane');
  const itemsTree = doc.getElementById('zotero-items-tree');
  const targetParent = itemsTree?.parentElement || itemsPane;
  if (!targetParent && !itemsTree) return;

  // 이미 주입되어 있는지 확인
  if (doc.getElementById('zotero-cover-grid')) return;

  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  // Inject Stylesheet if not present
  if (!doc.getElementById('zotero-cover-grid-style') && gridCss) {
    const styleEl = doc.createElementNS(HTML_NS, 'style');
    styleEl.id = 'zotero-cover-grid-style';
    styleEl.textContent = gridCss;
    (doc.head || doc.documentElement).appendChild(styleEl);
  }

  const gridEl = doc.createElementNS(HTML_NS, 'div');
  gridEl.id = 'zotero-cover-grid';
  gridEl.setAttribute('hidden', 'true');
  gridEl.className = 'zotero-cover-grid-root';
  gridEl.style.cssText = 'display: none !important; flex-direction: column !important; flex: 1 1 auto !important; height: 100% !important; width: 100% !important; min-height: 0 !important; min-width: 0 !important; box-sizing: border-box !important; position: relative !important; overflow: hidden !important;';

  // 뷰포트
  const viewport = doc.createElementNS(HTML_NS, 'div');
  viewport.className = 'grid-viewport';
  gridEl.appendChild(viewport);

  // 카드 컨테이너
  const cardsContainer = doc.createElementNS(HTML_NS, 'div');
  cardsContainer.className = 'grid-cards-container';
  viewport.appendChild(cardsContainer);

  if (itemsTree && itemsTree.parentNode) {
    itemsTree.parentNode.insertBefore(gridEl, itemsTree.nextSibling);
  } else if (targetParent) {
    targetParent.appendChild(gridEl);
  }

  // 툴바 주입
  const toolbar = injectToolbarControls(win);

  // Window Controller & Scroller
  const controller = new WindowCoverGridController(win);
  const scroller = new VirtualGridScroller({
    container: cardsContainer,
    viewport,
    onSelect: (selectedItems) => {
      // Synchronize with Zotero right item pane / inspector (single & multi-selection)
      if (selectedItems.length === 1) {
        selectItemInZotero(win, selectedItems[0].id);
      } else if (selectedItems.length > 1) {
        selectItemsInZotero(
          win,
          selectedItems.map((it) => it.id)
        );
      }
    },
    onOpenPdf: async (item) => {
      await openItemInZotero(win, item.id);
    },
    onDeleteItem: (items, forceTrash) => {
      // Respect native delete policy (Backspace vs Cmd+Backspace/Shift+Delete)
      deleteItemsInZotero(
        win,
        items.map((it) => it.id),
        Boolean(forceTrash)
      );
    },
    onCopyCitation: async (items, asCitation) => {
      const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      const z = win.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
      // 1. Try native Zotero Quick Copy if available
      try {
        if (typeof zp?.copySelectedItemsToClipboard === 'function') {
          zp.copySelectedItemsToClipboard(Boolean(asCitation));
        }
      } catch {}
      // 2. Reliable APA 7 / Note clipboard copy
      const lines = items.map((card) => {
        const zItem = z?.Items?.get ? z.Items.get(card.id) : null;
        if (card.itemType === 'note') {
          return card.notePreview ? `${card.title}\n${card.notePreview}` : card.title;
        }
        return asCitation ? card.citationText : formatFullApa7Bibliography(card, zItem);
      });
      await copyTextToClipboard(lines.join('\n\n'), win);
      // 3. Subtle non-flashy notification
      toolbar?.showStatusMessage?.('✓ 인용 복사됨');
      try {
        if (typeof z?.updateStatusLabel === 'function') {
          z.updateStatusLabel('인용이 클립보드에 복사되었습니다.');
        }
      } catch {}
    },
    onStatusChange: (item, nextStatus) => {
      controller.syncTagStatus(item, nextStatus);
    },
    onToggleColorTag: (item, position) => {
      controller.toggleColorTag(item, position);
    },
    onContextMenu: (item, event) => {
      const getTargetCards = (clickedCard: any) => {
        const selected = scroller.getSelectedItems();
        if (selected.length > 1 && selected.some((it) => it.id === clickedCard.id)) {
          return selected;
        }
        return [clickedCard];
      };

      showPaperCardContextMenu({
        event,
        card: item,
        win,
        actions: {
          onOpenPdf: async (card) => {
            await openItemInZotero(win, card.id);
          },
          onToggleRead: (card) => {
            const targets = getTargetCards(card);
            const nextStatus = cycleReadStatus(card.readStatus);
            for (const target of targets) {
              target.readStatus = nextStatus;
              controller.syncTagStatus(target, nextStatus);
            }
          },
          onCopyCitation: async (card) => {
            const z = win.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
            const targets = getTargetCards(card);
            const lines = targets.map((target) => {
              const zItem = z?.Items?.get ? z.Items.get(target.id) : null;
              if (target.itemType === 'note') {
                return target.notePreview ? `${target.title}\n${target.notePreview}` : target.title;
              }
              return formatFullApa7Bibliography(target, zItem);
            });
            await copyTextToClipboard(lines.join('\n\n'), win);
          },
          onRegenerateCover: async (card) => {
            const targets = getTargetCards(card);
            for (const target of targets) {
              await controller.regenerateCover(target);
            }
          },
          onDelete: async (card) => {
            const targetIds = scroller.getSelectedIds().includes(card.id)
              ? scroller.getSelectedIds()
              : [card.id];
            await deleteItemsInZotero(win, targetIds, false);
          }
        }
      });
    }
  });

  controller.init(scroller);

  win.__zoteroCoverGridInstance = {
    gridElement: gridEl,
    viewportElement: viewport,
    cardsContainer,
    toolbar,
    scroller,
    controller,
    cleanup: () => {
      controller.destroy();
      toolbar?.destroy();
      gridEl.remove();
      doc.getElementById('zotero-cover-grid-style')?.remove();
    }
  };

  // Pre-load current collection so switching to grid view renders immediately
  controller.reloadCurrentCollection();

  // Safeguard against white screen after injection
  ensureMainWindowStability(doc, win);
}

/**
 * 5-Step complete rollback cleanup
 */
export function cleanupCoverGridUI(win: any) {
  const doc = win.document;
  if (!doc) return;

  // Step 1: Remove toolbar switcher & group (and any legacy open-tab button)
  doc.getElementById('zotero-cover-grid-btn-open-tab')?.remove();
  doc.getElementById('zotero-cover-grid-toolbar-group')?.remove();
  doc.getElementById('zotero-cover-grid-view-switcher')?.remove();

  // Step 2: Remove zoom container
  doc.getElementById('zotero-cover-grid-zoom-container')?.remove();

  // Step 3: Remove cover grid container
  doc.getElementById('zotero-cover-grid')?.remove();

  // Step 4: Restore native items tree
  const itemsTree = doc.getElementById('zotero-items-tree');
  if (itemsTree) {
    itemsTree.hidden = false;
    itemsTree.removeAttribute('hidden');
    if (itemsTree.style) itemsTree.style.display = '';
  }

  // Remove injected styles
  doc.getElementById('zotero-cover-grid-style')?.remove();

  // Step 5: Close dedicated tab if open
  if (win.Zotero_Tabs) {
    try {
      const existing = win.Zotero_Tabs._tabs?.find((t: any) => t.id === 'zotero-cover-grid-tab');
      if (existing) {
        win.Zotero_Tabs.close('zotero-cover-grid-tab');
      }
    } catch {
      // Ignore
    }
  }

  // Step 6: Tear down instance controller and clear window reference
  win.__zoteroCoverGridInstance?.cleanup?.();
  delete win.__zoteroCoverGridInstance;
  delete win.__zoteroCoverGridTabInstance;

  // Step 7: Safeguard against white screen desynchronization
  ensureMainWindowStability(doc, win);
}
