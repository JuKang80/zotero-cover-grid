import gridCss from '../styles/grid.css';
import { injectToolbarControls } from './toolbar';
import { VirtualGridScroller } from './virtual-scroller';
import { WindowCoverGridController } from '../sync/window-controller';

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

  // Sanitize any existing tabs in Zotero_Tabs memory
  const tabs = win?.Zotero_Tabs || doc.defaultView?.Zotero_Tabs;
  if (tabs && Array.isArray(tabs._tabs)) {
    for (const t of tabs._tabs) {
      if (t && !t.data) {
        t.data = { icon: 'library' };
      } else if (t && !t.data?.icon) {
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

  const itemsPane = doc.getElementById('zotero-items-pane');
  if (!itemsPane) return;

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

  // 뷰포트
  const viewport = doc.createElementNS(HTML_NS, 'div');
  viewport.className = 'grid-viewport';
  gridEl.appendChild(viewport);

  // 카드 컨테이너
  const cardsContainer = doc.createElementNS(HTML_NS, 'div');
  cardsContainer.className = 'grid-cards-container';
  viewport.appendChild(cardsContainer);

  itemsPane.appendChild(gridEl);

  // 툴바 주입
  const toolbar = injectToolbarControls(win);

  // Window Controller & Scroller
  const controller = new WindowCoverGridController(win);
  const scroller = new VirtualGridScroller({
    container: cardsContainer,
    viewport,
    onSelect: (selectedItems) => {
      // Synchronize with Zotero right inspector
      const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      if (zp?.itemsView?.selectItem) {
        if (selectedItems.length > 0) {
          zp.itemsView.selectItem(selectedItems[0].id);
        }
      }
    },
    onOpenPdf: async (item) => {
      // Respect user's openPDFIn native pref and Zotero 10 API contracts
      const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      const z = win.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
      if (zp && typeof zp.viewItems === 'function') {
        try {
          await zp.viewItems([item.id]);
          return;
        } catch {
          try {
            const zItem = z?.Items?.get?.(item.id);
            if (zItem && typeof zItem.isRegularItem === 'function') {
              await zp.viewItems([zItem]);
              return;
            }
          } catch {
            // Fall through to Reader.open
          }
        }
      }
      if (z) {
        try {
          const zItem = z.Items?.get?.(item.id);
          const attachment = await zItem?.getBestAttachment?.();
          if (attachment && z.Reader?.open) {
            await z.Reader.open(attachment.id);
            return;
          }
        } catch {
          // Fall through
        }
      }
      if (typeof zp?.openAttachment === 'function') {
        zp.openAttachment(item.id);
      }
    },
    onDeleteItem: (items) => {
      // Respect native delete policy
      const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      if (zp?.deleteSelectedItems) {
        zp.deleteSelectedItems();
      }
    },
    onStatusChange: (item, nextStatus) => {
      controller.syncTagStatus(item, nextStatus);
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

  // Safeguard against white screen after injection
  ensureMainWindowStability(doc, win);
}

/**
 * 5-Step complete rollback cleanup
 */
export function cleanupCoverGridUI(win: any) {
  const doc = win.document;
  if (!doc) return;

  // Step 1: Remove toolbar switcher & group
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
