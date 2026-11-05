import gridCss from '../styles/grid.css';
import { VirtualGridScroller } from './virtual-scroller';
import { WindowCoverGridController } from '../sync/window-controller';

declare const Zotero_Tabs: any;
declare const ZoteroPane: any;
declare const Zotero: any;

export const COVER_GRID_TAB_ID = 'zotero-cover-grid-tab';

export function openCoverGridTab(win: any) {
  const tabs = win.Zotero_Tabs || (typeof Zotero_Tabs !== 'undefined' ? Zotero_Tabs : null);
  if (!tabs) return;

  const doc = win.document;
  if (!doc) return;

  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  // Ensure stylesheet is injected
  if (!doc.getElementById('zotero-cover-grid-style') && gridCss) {
    const styleEl = doc.createElementNS(HTML_NS, 'style');
    styleEl.id = 'zotero-cover-grid-style';
    styleEl.textContent = gridCss;
    (doc.head || doc.documentElement).appendChild(styleEl);
  }

  // Safeguard: Ensure white tab cover overlay is never left visible
  const hideTabCover = () => {
    const cover = doc.getElementById('zotero-tab-cover');
    if (cover) cover.classList.add('hidden');
    if (win.ZoteroContextPane?.showLoadingMessage) {
      try {
        win.ZoteroContextPane.showLoadingMessage(false);
      } catch {
        // Ignore
      }
    }
  };

  // Ensure all existing tabs have valid data objects to prevent Zotero_Tabs._update crash
  if (Array.isArray(tabs._tabs)) {
    for (const t of tabs._tabs) {
      if (t && !t.data) {
        t.data = { icon: 'library' };
      } else if (t && !t.data?.icon) {
        t.data.icon = 'library';
      }
    }
  }

  // 1. If tab already exists, simply select and refresh
  const existing = tabs._tabs?.find((t: any) => t.id === COVER_GRID_TAB_ID);
  if (existing) {
    if (!existing.data) existing.data = { icon: 'library' };
    tabs.select(COVER_GRID_TAB_ID);
    hideTabCover();
    if (win.__zoteroCoverGridTabInstance?.controller) {
      win.__zoteroCoverGridTabInstance.controller.reloadCurrentCollection();
    }
    return;
  }

  // 2. Add new dedicated tab
  const tabInfo = tabs.add({
    id: COVER_GRID_TAB_ID,
    type: 'custom',
    title: '📚 Cover Grid',
    data: { icon: 'library' },
    select: true,
    onClose: () => {
      if (win.__zoteroCoverGridTabInstance) {
        win.__zoteroCoverGridTabInstance.cleanup?.();
        win.__zoteroCoverGridTabInstance.controller?.destroy();
        win.__zoteroCoverGridTabInstance.scroller?.destroy();
        win.__zoteroCoverGridTabInstance = null;
      }
      hideTabCover();
      if (tabs.deck && (tabs.deck.selectedIndex === -1 || tabs.deck.selectedIndex >= tabs.deck.children?.length)) {
        tabs.deck.selectedIndex = 0;
      }
      if (typeof tabs._update === 'function') {
        try { tabs._update(); } catch {}
      }
    }
  });

  hideTabCover();

  const container = tabInfo?.container;
  if (!container) return;

  container.id = COVER_GRID_TAB_ID;
  container.style.cssText = 'display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; width: 100% !important; height: 100% !important; min-height: 0 !important; overflow: hidden !important;';

  // 3. Create root layout
  const root = doc.createElementNS(HTML_NS, 'div');
  root.className = 'cover-grid-tab-root';
  root.style.cssText = 'display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; width: 100% !important; height: 100% !important; min-height: 0 !important; overflow: hidden !important;';

  // 4. Header with collection name, search, zoom, refresh
  const header = doc.createElementNS(HTML_NS, 'div');
  header.className = 'cover-grid-tab-header';

  // Title Group
  const titleGroup = doc.createElementNS(HTML_NS, 'div');
  titleGroup.className = 'cover-grid-tab-title-group';

  const icon = doc.createElementNS(HTML_NS, 'span');
  icon.className = 'cover-grid-tab-icon';
  icon.textContent = '📚';

  const title = doc.createElementNS(HTML_NS, 'span');
  title.className = 'cover-grid-tab-title';
  title.textContent = 'Cover Grid';

  const colBadge = doc.createElementNS(HTML_NS, 'span');
  colBadge.className = 'cover-grid-collection-name';
  let colName = 'My Library';
  try {
    const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    const cols = zp?.getSelectedCollections ? zp.getSelectedCollections() : (zp?.getSelectedCollection ? [zp.getSelectedCollection()] : []);
    const firstCol = cols?.[0];
    if (firstCol) {
      colName = firstCol.name || (typeof firstCol.getName === 'function' ? firstCol.getName() : 'My Library');
    }
  } catch {
    // Ignore
  }
  colBadge.textContent = colName;

  titleGroup.appendChild(icon);
  titleGroup.appendChild(title);
  titleGroup.appendChild(colBadge);
  header.appendChild(titleGroup);

  // Controls Group
  const controls = doc.createElementNS(HTML_NS, 'div');
  controls.className = 'cover-grid-tab-controls';

  const searchInput = doc.createElementNS(HTML_NS, 'input') as HTMLInputElement;
  searchInput.type = 'search';
  searchInput.className = 'cover-grid-search-input';
  searchInput.placeholder = '논문 검색 (제목, 저자, 연도)...';

  const zoomContainer = doc.createElementNS(HTML_NS, 'div');
  zoomContainer.className = 'zoom-slider-container';

  const zoomLabel = doc.createElementNS(HTML_NS, 'span');
  zoomLabel.className = 'zoom-slider-label';
  zoomLabel.textContent = '🔍';

  // Read initial card width preference
  let initialCardWidth = 180;
  try {
    const z = win.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (z?.Prefs?.get) {
      const prefVal = z.Prefs.get('extensions.zotero.covergrid.cardWidth', true);
      if (typeof prefVal === 'number' && !isNaN(prefVal)) {
        initialCardWidth = Math.min(340, Math.max(140, prefVal));
      }
    }
  } catch {
    // Ignore and use default 180
  }

  const zoomSlider = doc.createElementNS(HTML_NS, 'input') as HTMLInputElement;
  zoomSlider.type = 'range';
  zoomSlider.min = '140';
  zoomSlider.max = '340';
  zoomSlider.value = String(initialCardWidth);
  zoomSlider.className = 'cover-grid-zoom-slider';
  zoomSlider.title = 'Card Zoom (140px - 340px)';
  root.style.setProperty('--card-width', `${initialCardWidth}px`);

  zoomContainer.appendChild(zoomLabel);
  zoomContainer.appendChild(zoomSlider);

  const refreshBtn = doc.createElementNS(HTML_NS, 'button');
  refreshBtn.className = 'cover-grid-refresh-btn';
  refreshBtn.textContent = '🔄';
  refreshBtn.title = '목록 새로고침';

  const reloadBtn = doc.createElementNS(HTML_NS, 'button');
  reloadBtn.className = 'cover-grid-reload-btn';
  reloadBtn.textContent = '⚡';
  reloadBtn.title = '플러그인 코드 핫 리로드 (재시작 없이 즉시 반영 / 단축키: Cmd+Alt+R)';
  reloadBtn.addEventListener('click', async () => {
    reloadBtn.textContent = '⏳';
    await hotReloadPlugin(win);
    setTimeout(() => { reloadBtn.textContent = '⚡'; }, 600);
  });

  controls.appendChild(searchInput);
  controls.appendChild(zoomContainer);
  controls.appendChild(refreshBtn);
  controls.appendChild(reloadBtn);
  header.appendChild(controls);
  root.appendChild(header);

  // 5. Grid Viewport & Container
  const viewport = doc.createElementNS(HTML_NS, 'div');
  viewport.className = 'grid-viewport';
  viewport.style.cssText = 'display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; width: 100% !important; height: 100% !important; min-height: 0 !important; overflow-y: auto !important; overflow-x: hidden !important; padding: 16px !important; box-sizing: border-box !important;';

  const cardsContainer = doc.createElementNS(HTML_NS, 'div');
  cardsContainer.className = 'grid-cards-container';
  cardsContainer.style.cssText = 'width: 100% !important; box-sizing: border-box !important; flex: 1 0 auto !important; min-height: 100px !important;';
  viewport.appendChild(cardsContainer);
  root.appendChild(viewport);

  container.appendChild(root);

  // 6. Setup Controller & Virtual Scroller
  const controller = new WindowCoverGridController(win);
  const scroller = new VirtualGridScroller({
    container: cardsContainer,
    viewport,
    onSelect: (selectedItems) => {
      const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      if (selectedItems.length > 0 && zp?.itemsView?.selectItem) {
        try {
          zp.itemsView.selectItem(selectedItems[0].id);
        } catch {
          // Ignore
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
            const zItem = z?.Items?.getAsync ? await z.Items.getAsync(item.id) : z?.Items?.get?.(item.id);
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
          const zItem = z.Items?.getAsync ? await z.Items.getAsync(item.id) : z.Items?.get?.(item.id);
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
    onDeleteItem: () => {
      const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      if (zp?.deleteSelectedItems) {
        zp.deleteSelectedItems();
      }
    },
    onStatusChange: (item, nextStatus) => {
      controller.syncTagStatus(item, nextStatus);
    }
  });

  // Hook selection change so switching tabs reloads active collection
  container.onTabSelectionChanged = (selected: boolean) => {
    if (selected) {
      hideTabCover();
      try {
        const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
        const cols = zp?.getSelectedCollections ? zp.getSelectedCollections() : (zp?.getSelectedCollection ? [zp.getSelectedCollection()] : []);
        colBadge.textContent = cols?.[0]?.name || 'My Library';
      } catch {
        // Ignore
      }
      controller.reloadCurrentCollection();
    }
  };

  controller.onCollectionChange = (name: string) => {
    colBadge.textContent = name;
  };

  controller.init(scroller);
  controller.reloadCurrentCollection();

  // Wire search input
  searchInput.addEventListener('input', (e: Event) => {
    controller.handleSearchInput((e.target as HTMLInputElement).value || '');
  });
  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      controller.handleSearchInput('', true);
    }
  });

  // Wire zoom slider
  zoomSlider.addEventListener('input', (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    root.style.setProperty('--card-width', `${val}px`);
    try {
      const z = win.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
      if (z?.Prefs?.set) {
        z.Prefs.set('extensions.zotero.covergrid.cardWidth', parseInt(val, 10), true);
      }
    } catch {
      // Ignore
    }
  });

  // Wire refresh button
  refreshBtn.addEventListener('click', () => {
    try {
      const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      const cols = zp?.getSelectedCollections ? zp.getSelectedCollections() : (zp?.getSelectedCollection ? [zp.getSelectedCollection()] : []);
      colBadge.textContent = cols?.[0]?.name || 'My Library';
    } catch {
      // Ignore
    }
    controller.reloadCurrentCollection();
  });

  // Wire hotkey Cmd+Alt+R (Ctrl+Alt+R) for instant hot reload
  const handleHotKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'r' || e.key === 'R' || e.code === 'KeyR')) {
      e.preventDefault();
      e.stopPropagation();
      hotReloadPlugin(win);
    }
  };
  if (typeof win?.addEventListener === 'function') {
    win.addEventListener('keydown', handleHotKey);
  } else if (typeof doc?.addEventListener === 'function') {
    doc.addEventListener('keydown', handleHotKey);
  }

  win.__zoteroCoverGridTabInstance = {
    container,
    root,
    controller,
    scroller,
    cleanup: () => {
      win?.removeEventListener?.('keydown', handleHotKey);
      doc?.removeEventListener?.('keydown', handleHotKey);
    }
  };
}

export async function hotReloadPlugin(win: any) {
  try {
    const ChromeUtils = win?.ChromeUtils || (typeof (globalThis as any).ChromeUtils !== 'undefined' ? (globalThis as any).ChromeUtils : null);
    if (ChromeUtils?.importESModule) {
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const addon = await AddonManager.getAddonByID('zotero-cover-grid@antigravity.user');
      if (addon) {
        try {
          const Services = win?.Services || (globalThis as any).Services;
          Services?.obs?.notifyObservers(null, 'startupcache-invalidate');
        } catch {
          // Ignore
        }
        await addon.disable();
        await addon.enable();
        return;
      }
    }
  } catch (e) {
    console.error('[CoverGrid] Hot reload failed:', e);
  }

  // In-memory fallback: reload current window controller and scroller in place
  if (win?.__zoteroCoverGridTabInstance?.controller) {
    win.__zoteroCoverGridTabInstance.controller.reloadCurrentCollection();
  }
}
