/**
 * Toolbar injection: Segmented View Switcher [ ≡ | ⊞ ] & Zoom Slider (140px ~ 320px)
 */

export interface ToolbarController {
  setView(mode: 'list' | 'grid'): void;
  getView(): 'list' | 'grid';
  setZoom(widthPx: number): void;
  destroy(): void;
}

export function injectToolbarControls(win: any): ToolbarController | null {
  const doc = win.document;
  if (!doc) return null;

  // Search box or items toolbar container
  const searchBox =
    doc.getElementById('zotero-tb-search') ||
    doc.getElementById('zotero-search-box') ||
    doc.querySelector('quick-search-textbox') ||
    doc.querySelector('.zotero-toolbar-search') ||
    doc.getElementById('zotero-items-toolbar') ||
    doc.getElementById('zotero-items-pane');
  if (!searchBox) return null;

  // Check if toolbar group already injected
  if (doc.getElementById('zotero-cover-grid-toolbar-group')) {
    return null;
  }

  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  const toolbarGroup = doc.createElementNS(HTML_NS, 'div');
  toolbarGroup.id = 'zotero-cover-grid-toolbar-group';
  toolbarGroup.className = 'cover-grid-toolbar-group';

  // Segmented Switcher [ ≡ | ⊞ ]
  const switcher = doc.createElementNS(HTML_NS, 'div');
  switcher.id = 'zotero-cover-grid-view-switcher';
  switcher.className = 'view-segmented-toggle';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'View Switcher');

  const btnList = doc.createElementNS(HTML_NS, 'button');
  btnList.className = 'view-toggle-btn active';
  btnList.id = 'zotero-cover-grid-btn-list';
  btnList.textContent = '≡';
  btnList.title = 'List View';
  btnList.setAttribute('aria-pressed', 'true');

  const btnGrid = doc.createElementNS(HTML_NS, 'button');
  btnGrid.className = 'view-toggle-btn';
  btnGrid.id = 'zotero-cover-grid-btn-grid';
  btnGrid.textContent = '⊞';
  btnGrid.title = 'Cover Grid View';
  btnGrid.setAttribute('aria-pressed', 'false');

  switcher.appendChild(btnList);
  switcher.appendChild(btnGrid);
  toolbarGroup.appendChild(switcher);

  // Zoom Slider Container
  const zoomContainer = doc.createElementNS(HTML_NS, 'div');
  zoomContainer.id = 'zotero-cover-grid-zoom-container';
  zoomContainer.className = 'zoom-slider-container';
  zoomContainer.style.display = 'none'; // Only visible in grid mode

  const zoomLabel = doc.createElementNS(HTML_NS, 'span');
  zoomLabel.className = 'zoom-slider-label';
  zoomLabel.textContent = '🔍';

  const zoomSlider = doc.createElementNS(HTML_NS, 'input') as HTMLInputElement;
  zoomSlider.id = 'zotero-cover-grid-zoom-slider';
  zoomSlider.type = 'range';
  zoomSlider.min = '140';
  zoomSlider.max = '320';
  zoomSlider.value = '180';
  zoomSlider.title = 'Card Zoom (140px - 320px)';

  zoomContainer.appendChild(zoomLabel);
  zoomContainer.appendChild(zoomSlider);
  toolbarGroup.appendChild(zoomContainer);

  // Insert after searchBox or inside toolbar
  if (searchBox.id === 'zotero-items-toolbar') {
    searchBox.appendChild(toolbarGroup);
  } else if (searchBox.parentNode) {
    searchBox.parentNode.insertBefore(toolbarGroup, searchBox.nextSibling);
  } else {
    searchBox.appendChild(toolbarGroup);
  }

  let currentView: 'list' | 'grid' = 'list';

  const setView = (mode: 'list' | 'grid') => {
    currentView = mode;
    const itemsTree = doc.getElementById('zotero-items-tree');
    const coverGrid = doc.getElementById('zotero-cover-grid');

    if (mode === 'grid') {
      btnList.classList.remove('active');
      btnList.setAttribute('aria-pressed', 'false');
      btnGrid.classList.add('active');
      btnGrid.setAttribute('aria-pressed', 'true');
      zoomContainer.style.display = 'inline-flex';

      if (itemsTree) {
        itemsTree.hidden = true;
        itemsTree.setAttribute('hidden', 'true');
      }
      if (coverGrid) {
        coverGrid.hidden = false;
        coverGrid.removeAttribute('hidden');
      }
    } else {
      btnGrid.classList.remove('active');
      btnGrid.setAttribute('aria-pressed', 'false');
      btnList.classList.add('active');
      btnList.setAttribute('aria-pressed', 'true');
      zoomContainer.style.display = 'none';

      if (coverGrid) {
        coverGrid.hidden = true;
        coverGrid.setAttribute('hidden', 'true');
      }
      if (itemsTree) {
        itemsTree.hidden = false;
        itemsTree.removeAttribute('hidden');
      }
    }
  };

  const setZoom = (widthPx: number) => {
    const clamped = Math.min(320, Math.max(140, widthPx));
    zoomSlider.value = String(clamped);
    const coverGrid = doc.getElementById('zotero-cover-grid');
    if (coverGrid) {
      coverGrid.style.setProperty('--card-width', `${clamped}px`);
    }
  };

  const onListClick = () => setView('list');
  const onGridClick = () => setView('grid');
  const onZoomInput = (e: Event) => {
    const val = Number((e.target as HTMLInputElement).value);
    setZoom(val);
  };

  btnList.addEventListener('click', onListClick);
  btnGrid.addEventListener('click', onGridClick);
  zoomSlider.addEventListener('input', onZoomInput);

  return {
    setView,
    getView: () => currentView,
    setZoom,
    destroy: () => {
      btnList.removeEventListener('click', onListClick);
      btnGrid.removeEventListener('click', onGridClick);
      zoomSlider.removeEventListener('input', onZoomInput);
      toolbarGroup.remove();
    }
  };
}
