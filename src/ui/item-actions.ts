/**
 * Clean-room implementation of Zotero item actions:
 * - selectItemInZotero: Updates right-hand Item Pane with item metadata
 * - openItemInZotero: Opens the primary attachment in Zotero Reader
 *
 * Fully licensed under MIT. Strictly uses standard public Zotero 10 APIs.
 */

export function selectItemInZotero(win: any, itemId: number): void {
  const zp = win?.ZoteroPane || (typeof (globalThis as any).ZoteroPane !== 'undefined' ? (globalThis as any).ZoteroPane : null);
  const z = win?.Zotero || (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero : null);
  const doc = win?.document || (typeof document !== 'undefined' ? document : null);

  if (!z && !zp) return;

  try {
    // 1. Ensure right-hand Item Pane is visible and not collapsed
    if (doc) {
      const pane = doc.getElementById('zotero-item-pane');
      if (pane) {
        pane.hidden = false;
        pane.removeAttribute('hidden');
        pane.style.removeProperty('display');
      }
      const splitter = doc.getElementById('zotero-items-splitter');
      if (splitter) {
        splitter.hidden = false;
        splitter.removeAttribute('hidden');
      }
    }

    const item = z?.Items?.get ? z.Items.get(itemId) : null;

    // 2. Direct Right-Hand Item Pane Inspection (60fps snappy)
    const domItemPane = doc?.getElementById?.('zotero-item-pane') as any;
    const domItemPaneContent = doc?.getElementById?.('zotero-item-pane-content') as any;
    const itemPane =
      win?.ZoteroItemPane ||
      zp?.itemPane ||
      domItemPane ||
      domItemPaneContent ||
      (typeof (globalThis as any).ZoteroItemPane !== 'undefined' ? (globalThis as any).ZoteroItemPane : null);

    const applyItemView = (targetItem: any) => {
      if (!targetItem) return;
      // 1. Update Zotero 10 <zotero-item-pane> custom element directly if present
      if (domItemPane) {
        try {
          if ('item' in domItemPane) domItemPane.item = targetItem;
          if (typeof domItemPane.viewItem === 'function') {
            domItemPane.viewItem(targetItem, 'view');
            return;
          }
        } catch {}
      }
      if (domItemPaneContent) {
        try {
          if ('item' in domItemPaneContent) domItemPaneContent.item = targetItem;
          if (typeof domItemPaneContent.viewItem === 'function') {
            domItemPaneContent.viewItem(targetItem, 'view');
            return;
          }
        } catch {}
      }
      // 2. Fallback to ZoteroItemPane / zp.itemPane controller (NOTE: Never call zp.viewItem here, as zp.viewItem opens PDF/URL!)
      if (itemPane && typeof itemPane.viewItem === 'function') {
        try { itemPane.viewItem(targetItem); return; } catch {}
      }
      if (itemPane && typeof itemPane.viewItems === 'function') {
        try { itemPane.viewItems([targetItem]); return; } catch {}
      }
    };

    if (item) {
      applyItemView(item);
    } else if (z?.Items?.getAsync) {
      z.Items.getAsync(itemId).then((asyncItem: any) => {
        applyItemView(asyncItem);
      }).catch(() => {});
    }

    // 3. Sync with ZoteroPane selection without switching out of Grid View or switching tabs
    const itemsTree = doc?.getElementById?.('zotero-items-tree');
    const coverGrid = doc?.getElementById?.('zotero-cover-grid');
    const tabs = win?.Zotero_Tabs || doc?.defaultView?.Zotero_Tabs;
    const isNonLibraryTab = Boolean(tabs?.selectedID && tabs.selectedID !== 'zotero-pane');
    const isGridActive =
      isNonLibraryTab ||
      (coverGrid && !coverGrid.hidden && coverGrid.style?.display !== 'none') ||
      itemsTree?.hidden ||
      itemsTree?.style?.display === 'none';

    if (isGridActive) {
      // When in Grid View, never call zp.selectItem() because ZoteroPane.selectItem() forces focus back to #zotero-items-tree / list view
      try {
        if (typeof zp?.itemsView?.selectItems === 'function') {
          zp.itemsView.selectItems([itemId], false, true);
        } else if (typeof zp?.itemsView?.selectItem === 'function') {
          zp.itemsView.selectItem(itemId);
        }
      } catch {}
      try {
        if (typeof zp?.itemSelected === 'function') {
          zp.itemSelected(null, itemId);
        }
      } catch {}
      // Enforce that Grid View remains visible and List View tree remains hidden
      if (!isNonLibraryTab) {
        if (itemsTree) {
          itemsTree.hidden = true;
          itemsTree.setAttribute('hidden', 'true');
          itemsTree.style?.setProperty?.('display', 'none', 'important');
        }
        if (coverGrid) {
          coverGrid.hidden = false;
          coverGrid.removeAttribute('hidden');
          coverGrid.style?.setProperty?.('display', 'flex', 'important');
        }
      }
    } else if (typeof zp?.selectItem === 'function') {
      try {
        zp.selectItem(itemId, false, false);
      } catch {}
    } else if (zp?.itemsView && typeof zp.itemsView.selectItem === 'function') {
      try {
        zp.itemsView.selectItem(itemId);
      } catch {}
    }
  } catch (err) {
    z?.logError?.(err);
  }
}

export async function openItemInZotero(win: any, itemId: number): Promise<void> {
  const zp = win?.ZoteroPane || (typeof (globalThis as any).ZoteroPane !== 'undefined' ? (globalThis as any).ZoteroPane : null);
  const z = win?.Zotero || (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero : null);

  // 0. Dedicated handler for Zotero Standalone/Child Notes: Open directly in Note Editor Tab
  try {
    const zItem = z?.Items?.getAsync ? await z.Items.getAsync(itemId) : z?.Items?.get?.(itemId);
    if (zItem && (zItem.isNote?.() || zItem.itemType === 'note')) {
      if (typeof zp?.openNote === 'function') {
        zp.openNote(itemId);
        return;
      }
      if (typeof z?.Notes?.open === 'function') {
        z.Notes.open(itemId);
        return;
      }
    }
  } catch {
    // Fall through
  }

  // 1. First try ZoteroPane.viewItems (Zotero's primary UI view handler)
  if (zp && typeof zp.viewItems === 'function') {
    try {
      await zp.viewItems([itemId]);
      return;
    } catch {
      try {
        const zItem = z?.Items?.getAsync ? await z.Items.getAsync(itemId) : z?.Items?.get?.(itemId);
        if (zItem && typeof zItem.isRegularItem === 'function') {
          await zp.viewItems([zItem]);
          return;
        }
      } catch {
        // Fall through to Reader.open
      }
    }
  }

  // 2. Direct attachment resolution & Reader.open
  if (z) {
    try {
      const zItem = z.Items?.getAsync ? await z.Items.getAsync(itemId) : z.Items?.get?.(itemId);
      const attachment = await zItem?.getBestAttachment?.();
      if (attachment && z.Reader?.open) {
        await z.Reader.open(attachment.id);
        return;
      }
    } catch {
      // Fall through
    }
  }

  // 3. Fallback to legacy openAttachment
  if (typeof zp?.openAttachment === 'function') {
    zp.openAttachment(itemId);
  }
}
