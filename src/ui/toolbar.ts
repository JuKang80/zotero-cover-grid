/**
 * Toolbar injection: Segmented View Switcher [ ≡ | ⊞ ] & Card Zoom Slider
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

  // 1. Segmented Switcher [ ≡ | ⊞ ]
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

  // 3. Zoom Slider Container
  const zoomContainer = doc.createElementNS(HTML_NS, 'div');
  zoomContainer.id = 'zotero-cover-grid-zoom-container';
  zoomContainer.className = 'zoom-slider-container';
  zoomContainer.style.setProperty('display', 'none', 'important'); // Only visible in grid mode
  zoomContainer.hidden = true;
  zoomContainer.setAttribute('hidden', 'true');

  const zoomLabel = doc.createElementNS(HTML_NS, 'span');
  zoomLabel.className = 'zoom-slider-label';
  zoomLabel.textContent = '🔍';

  // Read initial card width from preferences if present
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
  zoomSlider.id = 'zotero-cover-grid-zoom-slider';
  zoomSlider.type = 'range';
  zoomSlider.min = '140';
  zoomSlider.max = '340';
  zoomSlider.value = String(initialCardWidth);
  zoomSlider.title = 'Card Zoom (140px - 340px)';

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
    let coverGrid = doc.getElementById('zotero-cover-grid');

    if (mode === 'grid') {
      btnList.classList.remove('active');
      btnList.setAttribute('aria-pressed', 'false');
      btnGrid.classList.add('active');
      btnGrid.setAttribute('aria-pressed', 'true');

      // Zoom container visible
      zoomContainer.hidden = false;
      zoomContainer.removeAttribute('hidden');
      zoomContainer.style.setProperty('display', 'inline-flex', 'important');

      // Ensure coverGrid is positioned right next to itemsTree if itemsTree exists
      if (itemsTree && itemsTree.parentNode && coverGrid && coverGrid.parentNode !== itemsTree.parentNode) {
        itemsTree.parentNode.insertBefore(coverGrid, itemsTree.nextSibling);
      }

      // Items tree completely hidden
      if (itemsTree) {
        itemsTree.hidden = true;
        itemsTree.setAttribute('hidden', 'true');
        itemsTree.style.setProperty('display', 'none', 'important');
      }

      // Cover grid visible with flex layout
      if (coverGrid) {
        coverGrid.hidden = false;
        coverGrid.removeAttribute('hidden');
        coverGrid.style.setProperty('display', 'flex', 'important');
      }

      // Ensure main window stability on view switch
      const tabCover = doc.getElementById('zotero-tab-cover');
      if (tabCover && !tabCover.classList.contains('hidden')) {
        tabCover.classList.add('hidden');
      }
      const tabsDeck = doc.getElementById('tabs-deck');
      if (tabsDeck && (tabsDeck.selectedIndex === -1 || tabsDeck.selectedIndex === undefined)) {
        tabsDeck.selectedIndex = 0;
      }

      // Trigger collection reload!
      if (win.__zoteroCoverGridInstance?.controller) {
        win.__zoteroCoverGridInstance.controller.reloadCurrentCollection();
      }
    } else {
      btnGrid.classList.remove('active');
      btnGrid.setAttribute('aria-pressed', 'false');
      btnList.classList.add('active');
      btnList.setAttribute('aria-pressed', 'true');

      // Zoom container hidden
      zoomContainer.hidden = true;
      zoomContainer.setAttribute('hidden', 'true');
      zoomContainer.style.setProperty('display', 'none', 'important');

      // Cover grid hidden
      if (coverGrid) {
        coverGrid.hidden = true;
        coverGrid.setAttribute('hidden', 'true');
        coverGrid.style.setProperty('display', 'none', 'important');
      }

      // Items tree restored to natural layout
      if (itemsTree) {
        itemsTree.hidden = false;
        itemsTree.removeAttribute('hidden');
        itemsTree.style.removeProperty('display');
        itemsTree.style.display = '';

        // Force synchronous reflow so Gecko updates bounding rect and dimensions
        try {
          void itemsTree.offsetHeight;
        } catch {}

        const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
        const rerenderItemsTree = () => {
          try {
            void itemsTree.offsetHeight;
            if (typeof zp?.updateLayoutConstraints === 'function') {
              zp.updateLayoutConstraints();
            }
            const iv = zp?.itemsView;
            if (iv) {
              try { iv.invalidateRowCache?.(true); } catch {}
              if (iv.tree) {
                try { iv.tree.invalidate?.(); } catch {}
                try { iv.tree.rerender?.(); } catch {}
                try { iv.tree._jsWindow?.invalidate?.(); } catch {}
                try { iv.tree._jsWindow?.render?.(); } catch {}
              }
              try { iv.refreshAndMaintainSelection?.(); } catch {}
              try { iv.refresh?.(); } catch {}
            }
            if (itemsTree.treeBoxObject && typeof itemsTree.treeBoxObject.invalidate === 'function') {
              itemsTree.treeBoxObject.invalidate();
            }
            itemsTree.dispatchEvent(new Event('resize', { bubbles: true }));
            win.dispatchEvent(new Event('resize'));
          } catch {}
        };

        // 1. Immediate pass
        rerenderItemsTree();

        // 2. Next animation frame (Gecko frame reconstruct)
        const raf = win?.requestAnimationFrame || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
        if (raf) {
          raf(rerenderItemsTree);
        }

        // 3. Dual-stage delayed passes (handles splitter animation / right pane open transition)
        const timerFn = win?.setTimeout || (typeof setTimeout === 'function' ? setTimeout : null);
        if (timerFn) {
          timerFn(rerenderItemsTree, 40);
          timerFn(rerenderItemsTree, 150);
        }
      }
    }
  };

  const setZoom = (widthPx: number) => {
    const clamped = Math.min(340, Math.max(140, widthPx));
    zoomSlider.value = String(clamped);
    const coverGrid = doc.getElementById('zotero-cover-grid');
    if (coverGrid) {
      coverGrid.style.setProperty('--card-width', `${clamped}px`);
    }
    try {
      const z = win.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
      if (z?.Prefs?.set) {
        z.Prefs.set('extensions.zotero.covergrid.cardWidth', clamped, true);
      }
    } catch {
      // Ignore
    }
  };

  btnList.addEventListener('click', (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    setView('list');
  });
  btnGrid.addEventListener('click', (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    setView('grid');
  });
  zoomSlider.addEventListener('input', (e: Event) => {
    const val = Number((e.target as HTMLInputElement).value);
    setZoom(val);
  });

  // Initialize card width zoom level
  setZoom(initialCardWidth);

  return {
    setView,
    getView: () => currentView,
    setZoom,
    destroy: () => {
      toolbarGroup.remove();
    }
  };
}
