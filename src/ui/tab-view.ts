import gridCss from '../styles/grid.css';
import { VirtualGridScroller } from './virtual-scroller';
import { WindowCoverGridController } from '../sync/window-controller';
import { selectItemInZotero, openItemInZotero } from './item-actions';

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
      } else if (t && (t.id === COVER_GRID_TAB_ID || t.type === 'custom') && !t.data?.icon) {
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

  // 5. Grid Main Layout (Viewport + Inspector Drawer)
  const tabMain = doc.createElementNS(HTML_NS, 'div');
  tabMain.className = 'cover-grid-tab-main';

  const viewport = doc.createElementNS(HTML_NS, 'div');
  viewport.className = 'grid-viewport';
  viewport.style.cssText = 'display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; width: 100% !important; height: 100% !important; min-height: 0 !important; overflow-y: auto !important; overflow-x: hidden !important; padding: 16px !important; box-sizing: border-box !important;';

  const cardsContainer = doc.createElementNS(HTML_NS, 'div');
  cardsContainer.className = 'grid-cards-container';
  cardsContainer.style.cssText = 'width: 100% !important; box-sizing: border-box !important;';
  viewport.appendChild(cardsContainer);
  tabMain.appendChild(viewport);

  const inspector = doc.createElementNS(HTML_NS, 'div');
  inspector.className = 'cover-grid-tab-inspector';
  tabMain.appendChild(inspector);

  root.appendChild(tabMain);
  container.appendChild(root);

  const renderInspector = async (cardItem: any) => {
    if (!cardItem) {
      inspector.style.display = 'none';
      return;
    }
    inspector.innerHTML = '';
    inspector.style.display = 'flex';

    // Header (Type badge + Close btn)
    const inspHeader = doc.createElementNS(HTML_NS, 'div');
    inspHeader.className = 'inspector-header';

    const typeBadge = doc.createElementNS(HTML_NS, 'span');
    typeBadge.className = 'inspector-type-badge';
    typeBadge.textContent = cardItem.itemType || 'Journal Article';

    const closeBtn = doc.createElementNS(HTML_NS, 'button');
    closeBtn.className = 'inspector-close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = '닫기';
    closeBtn.onclick = () => { inspector.style.display = 'none'; };

    inspHeader.appendChild(typeBadge);
    inspHeader.appendChild(closeBtn);
    inspector.appendChild(inspHeader);

    // Title
    const titleEl = doc.createElementNS(HTML_NS, 'div');
    titleEl.className = 'inspector-title';
    titleEl.textContent = cardItem.title || 'Untitled Document';
    inspector.appendChild(titleEl);

    // Authors
    const authorsEl = doc.createElementNS(HTML_NS, 'div');
    authorsEl.className = 'inspector-authors';
    authorsEl.textContent = cardItem.authorText || 'Unknown Authors';
    inspector.appendChild(authorsEl);

    // Citation Text
    const citationEl = doc.createElementNS(HTML_NS, 'div');
    citationEl.className = 'inspector-citation';
    citationEl.textContent = cardItem.citationText || `(${cardItem.year || 'n.d.'})`;
    inspector.appendChild(citationEl);

    // Fetch full Zotero Item for Abstract & Metadata
    try {
      const z = win.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
      const zItem = z?.Items?.get ? z.Items.get(cardItem.id) : null;
      if (zItem) {
        const abstract = zItem.getField ? zItem.getField('abstractNote') : '';
        if (abstract) {
          const absLabel = doc.createElementNS(HTML_NS, 'div');
          absLabel.className = 'inspector-section-label';
          absLabel.textContent = 'Abstract';
          inspector.appendChild(absLabel);

          const absEl = doc.createElementNS(HTML_NS, 'div');
          absEl.className = 'inspector-abstract';
          absEl.textContent = abstract;
          inspector.appendChild(absEl);
        }
      }
    } catch {
      // Ignore
    }

    // Action Buttons
    const actions = doc.createElementNS(HTML_NS, 'div');
    actions.className = 'inspector-actions';

    const openPdfBtn = doc.createElementNS(HTML_NS, 'button');
    openPdfBtn.className = 'inspector-open-pdf-btn';
    openPdfBtn.textContent = '📄 PDF 열기';
    openPdfBtn.onclick = async () => {
      await openItemInZotero(win, cardItem.id);
    };

    actions.appendChild(openPdfBtn);
    inspector.appendChild(actions);
  };

  // 6. Setup Controller & Virtual Scroller
  const controller = new WindowCoverGridController(win);
  const scroller = new VirtualGridScroller({
    container: cardsContainer,
    viewport,
    onSelect: (selectedItems) => {
      if (selectedItems.length > 0) {
        selectItemInZotero(win, selectedItems[0].id);
        renderInspector(selectedItems[0]);
      } else {
        renderInspector(null);
      }
    },
    onOpenPdf: async (item) => {
      await openItemInZotero(win, item.id);
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
    if (typeof Zotero !== 'undefined' && typeof Zotero.debug === 'function') {
      Zotero.debug('[CoverGrid] Hot reload failed: ' + e);
    }
  }

  // In-memory fallback: reload current window controller and scroller in place
  if (win?.__zoteroCoverGridTabInstance?.controller) {
    win.__zoteroCoverGridTabInstance.controller.reloadCurrentCollection();
  }
}
