import { VirtualGridScroller } from './virtual-scroller';
import { WindowCoverGridController } from '../sync/window-controller';

declare const Zotero_Tabs: any;
declare const ZoteroPane: any;
declare const Zotero: any;

export const COVER_GRID_TAB_ID = 'zotero-cover-grid-tab';

export function openCoverGridTab(win: any) {
  const tabs = win.Zotero_Tabs || (typeof Zotero_Tabs !== 'undefined' ? Zotero_Tabs : null);
  if (!tabs) return;

  // 1. If tab already exists, simply select and refresh
  const existing = tabs._tabs?.find((t: any) => t.id === COVER_GRID_TAB_ID);
  if (existing) {
    tabs.select(COVER_GRID_TAB_ID);
    if (win.__zoteroCoverGridTabInstance?.controller) {
      win.__zoteroCoverGridTabInstance.controller.reloadCurrentCollection();
    }
    return;
  }

  // 2. Add new dedicated tab
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const doc = win.document;

  const tabInfo = tabs.add({
    id: COVER_GRID_TAB_ID,
    type: 'custom',
    title: '📚 Cover Grid',
    select: true,
    onClose: () => {
      if (win.__zoteroCoverGridTabInstance) {
        win.__zoteroCoverGridTabInstance.controller?.destroy();
        win.__zoteroCoverGridTabInstance.scroller?.destroy();
        win.__zoteroCoverGridTabInstance = null;
      }
    }
  });

  const container = tabInfo?.container;
  if (!container) return;

  // 3. Create root layout
  const root = doc.createElementNS(HTML_NS, 'div');
  root.className = 'cover-grid-tab-root';

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
    const col = zp?.getSelectedCollection?.();
    if (col?.name) colName = col.name;
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

  const zoomSlider = doc.createElementNS(HTML_NS, 'input') as HTMLInputElement;
  zoomSlider.type = 'range';
  zoomSlider.min = '140';
  zoomSlider.max = '340';
  zoomSlider.value = '180';
  zoomSlider.className = 'cover-grid-zoom-slider';
  zoomSlider.title = 'Card Zoom (140px - 340px)';

  zoomContainer.appendChild(zoomLabel);
  zoomContainer.appendChild(zoomSlider);

  const refreshBtn = doc.createElementNS(HTML_NS, 'button');
  refreshBtn.className = 'cover-grid-refresh-btn';
  refreshBtn.textContent = '🔄';
  refreshBtn.title = '목록 새로고침';

  controls.appendChild(searchInput);
  controls.appendChild(zoomContainer);
  controls.appendChild(refreshBtn);
  header.appendChild(controls);
  root.appendChild(header);

  // 5. Grid Viewport & Container
  const viewport = doc.createElementNS(HTML_NS, 'div');
  viewport.className = 'grid-viewport';

  const cardsContainer = doc.createElementNS(HTML_NS, 'div');
  cardsContainer.className = 'grid-cards-container';
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
    onOpenPdf: (item) => {
      const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      const z = win.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
      if (zp?.openAttachment) {
        zp.openAttachment(item.id);
      } else if (z?.Reader?.open) {
        z.Reader.open(item.id);
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

  controller.init(scroller);

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
  });

  // Wire refresh button
  refreshBtn.addEventListener('click', () => {
    try {
      const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      const col = zp?.getSelectedCollection?.();
      colBadge.textContent = col?.name || 'My Library';
    } catch {
      // Ignore
    }
    controller.reloadCurrentCollection();
  });

  win.__zoteroCoverGridTabInstance = {
    container,
    root,
    controller,
    scroller
  };
}
