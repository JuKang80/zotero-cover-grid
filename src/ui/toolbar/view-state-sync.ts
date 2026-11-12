/**
 * View State Synchronization: List <-> Grid Selection & Viewport Reflow
 */

/**
 * Extracts currently selected item IDs from native Zotero list view (ZoteroPane / itemsView).
 */
export function extractNativeSelectedIds(win: any): number[] {
  let listSelectedIds: number[] = [];
  try {
    const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    const rawSel =
      zp?.getSelectedItems?.(true) ||
      zp?.itemsView?.getSelectedItems?.(true) ||
      zp?.getSelectedItems?.();
    if (Array.isArray(rawSel) && rawSel.length > 0) {
      listSelectedIds = rawSel
        .map((it: any) => (typeof it === 'object' && it ? Number(it.id) : Number(it)))
        .filter((n: number) => !isNaN(n) && n > 0);
    }
  } catch {}
  return listSelectedIds;
}

/**
 * Extracts currently selected item IDs from Cover Grid virtual scroller.
 */
export function extractGridSelectedIds(win: any): number[] {
  try {
    return win.__zoteroCoverGridInstance?.scroller?.getSelectedIds?.() || [];
  } catch {
    return [];
  }
}

export interface SyncToGridOptions {
  win: any;
  selectedIds?: number[];
  getCurrentView?: () => 'list' | 'grid';
}

/**
 * Synchronizes selected items from native list view into the Cover Grid scroller,
 * triggering scroll-into-view both immediately and after async reload settles.
 */
export function syncListToGrid(options: SyncToGridOptions): number[] {
  const { win, getCurrentView } = options;
  const listSelectedIds = options.selectedIds ?? extractNativeSelectedIds(win);

  const scroller = win.__zoteroCoverGridInstance?.scroller;
  const controller = win.__zoteroCoverGridInstance?.controller;

  if (scroller?.setSelectedIds) {
    scroller.setSelectedIds(listSelectedIds, { scrollIntoView: listSelectedIds.length > 0 });
  }

  // Trigger collection reload!
  if (controller?.reloadCurrentCollection) {
    const res = controller.reloadCurrentCollection();
    if (res && typeof res.then === 'function') {
      res.then(() => {
        const isGrid = getCurrentView ? getCurrentView() === 'grid' : true;
        if (isGrid && listSelectedIds.length > 0 && scroller?.setSelectedIds) {
          scroller.setSelectedIds(listSelectedIds, { scrollIntoView: true });
        }
      }).catch(() => {});
    }
  }

  return listSelectedIds;
}

export interface SyncToListOptions {
  win: any;
  itemsTree: any;
  selectedIds?: number[];
}

/**
 * Restores selection and scroll position in native Zotero items tree,
 * with synchronous reflow (0ms) and requestAnimationFrame follow-up.
 */
export function syncGridToList(options: SyncToListOptions): void {
  const { win, itemsTree } = options;
  if (!itemsTree) return;

  const gridSelectedIds = options.selectedIds ?? extractGridSelectedIds(win);

  // Force synchronous reflow so Gecko updates bounding rect and dimensions
  try {
    void itemsTree.offsetHeight;
  } catch {}

  const zp = win.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
  const iv = zp?.itemsView;

  // 1. Immediately reset any corrupted scroll offsets from when itemsTree was hidden
  try {
    const rowCount = typeof iv?.rowCount === 'number' ? iv.rowCount : 0;
    const treeHeight = itemsTree.clientHeight || itemsTree.offsetHeight || 500;
    // If list is small or rowCount is within single screen, unconditionally reset scrollTop = 0
    if (rowCount <= 20 || (rowCount > 0 && rowCount * 28 <= treeHeight)) {
      itemsTree.scrollTop = 0;
      if (itemsTree.scrollContainer) itemsTree.scrollContainer.scrollTop = 0;
      if (iv?.tree?._scrollContainer) iv.tree._scrollContainer.scrollTop = 0;
    }
  } catch {}

  const instantPaintTree = () => {
    try {
      void itemsTree.offsetHeight;
      if (typeof zp?.updateLayoutConstraints === 'function') {
        zp.updateLayoutConstraints();
      }
      if (iv?.tree) {
        try { iv.tree.rerender?.(); } catch {}
        try { iv.tree.refresh?.(); } catch {}
        try { iv.tree._jsWindow?.render?.(); } catch {}
      }
      if (itemsTree.treeBoxObject && typeof itemsTree.treeBoxObject.invalidate === 'function') {
        itemsTree.treeBoxObject.invalidate();
      }
      // Restore selection in native list view without forcing raw scrollToRow
      if (gridSelectedIds.length > 0) {
        if (gridSelectedIds.length > 1 && typeof iv?.selectItems === 'function') {
          try { iv.selectItems(gridSelectedIds); } catch {}
          try { zp?.itemSelected?.(); } catch {}
        } else if (typeof zp?.selectItem === 'function') {
          try { zp.selectItem(gridSelectedIds[0], false, false); } catch {}
        } else if (typeof iv?.selectItem === 'function') {
          try { iv.selectItem(gridSelectedIds[0]); } catch {}
        }
        if (typeof iv?.getRowIndexByID === 'function') {
          try {
            const rowIdx = iv.getRowIndexByID(gridSelectedIds[0]);
            if (typeof rowIdx === 'number' && rowIdx >= 0) {
              iv.ensureRowIsVisible?.(rowIdx);
            }
          } catch {}
        }
      }
      try { (itemsTree as any).focus?.(); } catch {}
      itemsTree.dispatchEvent(new Event('resize', { bubbles: true }));
      win.dispatchEvent(new Event('resize'));
    } catch {}
  };

  // 1. Synchronous 0ms instant paint (No database I/O, renders from memory in < 1ms)
  instantPaintTree();

  // 2. Next animation frame (Guarantees Gecko layout pass after pane dimension change)
  const raf = win?.requestAnimationFrame || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
  if (raf) {
    raf(instantPaintTree);
  }
}
