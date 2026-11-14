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

export function selectItemsInZotero(win: any, itemIds: number[]): void {
  if (!Array.isArray(itemIds) || itemIds.length === 0) return;
  if (itemIds.length === 1) {
    selectItemInZotero(win, itemIds[0]);
    return;
  }

  const zp = win?.ZoteroPane || (typeof (globalThis as any).ZoteroPane !== 'undefined' ? (globalThis as any).ZoteroPane : null);
  const z = win?.Zotero || (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero : null);
  const doc = win?.document || (typeof document !== 'undefined' ? document : null);
  if (!z && !zp) return;

  try {
    // 1. Sync multi-selection with Zotero itemsView so top menus & actions reflect N selected items
    try {
      if (typeof zp?.itemsView?.selectItems === 'function') {
        zp.itemsView.selectItems(itemIds, false, true);
      }
    } catch {}

    // 2. Update right-hand Item Pane with multi-item summary ("N items selected")
    const domItemPane = doc?.getElementById?.('zotero-item-pane') as any;
    const domItemPaneContent = doc?.getElementById?.('zotero-item-pane-content') as any;
    const itemPane =
      win?.ZoteroItemPane ||
      zp?.itemPane ||
      domItemPane ||
      domItemPaneContent ||
      (typeof (globalThis as any).ZoteroItemPane !== 'undefined' ? (globalThis as any).ZoteroItemPane : null);

    const locale = String(z?.locale || win?.navigator?.language || '').toLowerCase();
    const msg = locale.startsWith('ko')
      ? `${itemIds.length}개 항목 선택됨`
      : `${itemIds.length} items selected`;

    const loadedItems = itemIds
      .map((id) => {
        try {
          return z?.Items?.get ? z.Items.get(id) : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    let handled = false;
    for (const target of [domItemPane, domItemPaneContent, itemPane]) {
      if (!target) continue;
      if (typeof target.showMessage === 'function') {
        try {
          target.showMessage(msg);
          handled = true;
          break;
        } catch {}
      }
      if (typeof target.viewItems === 'function' && loadedItems.length > 0) {
        try {
          target.viewItems(loadedItems);
          handled = true;
          break;
        } catch {}
      }
      if (typeof target.setItems === 'function' && loadedItems.length > 0) {
        try {
          target.setItems(loadedItems);
          handled = true;
          break;
        } catch {}
      }
    }

    if (!handled && typeof zp?.itemSelected === 'function') {
      try {
        zp.itemSelected();
      } catch {}
    }

    // 3. Keep Grid View visible
    const itemsTree = doc?.getElementById?.('zotero-items-tree');
    const coverGrid = doc?.getElementById?.('zotero-cover-grid');
    if (coverGrid && !coverGrid.hidden && coverGrid.style?.display !== 'none') {
      if (itemsTree) {
        itemsTree.hidden = true;
        itemsTree.setAttribute('hidden', 'true');
        itemsTree.style?.setProperty?.('display', 'none', 'important');
      }
    }
  } catch (err) {
    z?.logError?.(err);
  }
}

export async function deleteItemsInZotero(win: any, itemIds: number[], forceTrash = false): Promise<void> {
  if (!Array.isArray(itemIds) || itemIds.length === 0) return;
  const zp = win?.ZoteroPane || (typeof (globalThis as any).ZoteroPane !== 'undefined' ? (globalThis as any).ZoteroPane : null);
  const z = win?.Zotero || (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero : null);

  try {
    // Ensure Zotero itemsView has the target items selected before invoking native delete
    try {
      if (typeof zp?.itemsView?.selectItems === 'function') {
        zp.itemsView.selectItems(itemIds, false, true);
      } else if (itemIds.length === 1 && typeof zp?.itemsView?.selectItem === 'function') {
        zp.itemsView.selectItem(itemIds[0]);
      }
    } catch {}

    const selectedCol =
      zp?.getSelectedCollection?.() ||
      (Array.isArray(zp?.getSelectedCollections?.()) ? zp.getSelectedCollections()[0] : null);

    let handledByPane = false;
    if (typeof zp?.deleteSelectedItems === 'function') {
      if (forceTrash) {
        await zp.deleteSelectedItems(true);
      } else {
        await zp.deleteSelectedItems();
      }
      handledByPane = true;
    } else if (typeof zp?.deleteSelectedItem === 'function') {
      await zp.deleteSelectedItem();
      handledByPane = true;
    }

    // When in a collection and plain Backspace (forceTrash = false) is pressed without ZoteroPane helper: remove from collection only
    if (!handledByPane && !forceTrash && selectedCol) {
      if (typeof selectedCol.removeItems === 'function') {
        await selectedCol.removeItems(itemIds);
      } else if (typeof selectedCol.removeItem === 'function') {
        for (const id of itemIds) {
          await selectedCol.removeItem(id);
        }
      }
      if (typeof selectedCol.saveTx === 'function') {
        await selectedCol.saveTx();
      }
      handledByPane = true;
    }

    // When forceTrash is true (Cmd+Backspace / Shift+Delete) or fallback is needed: guarantee items are moved to trash
    if ((!handledByPane || (forceTrash && selectedCol)) && z?.Items) {
      for (const id of itemIds) {
        const zItem = z.Items.getAsync ? await z.Items.getAsync(id) : z.Items.get?.(id);
        if (zItem && !zItem.deleted) {
          zItem.deleted = true;
          if (typeof zItem.saveTx === 'function') {
            await zItem.saveTx();
          }
        }
      }
    }

    // Immediately remove deleted cards from the active grid view
    win?.__zoteroCoverGridInstance?.controller?.removeItems?.(itemIds);
  } catch (err) {
    z?.logError?.(err);
  }
}

export async function openItemInZotero(win: any, itemId: number, pageIndex?: number): Promise<void> {
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

  // 0.5 When an explicit pageIndex is requested (e.g. from Quick Look), prefer Zotero.Reader.open with location
  if (typeof pageIndex === 'number' && pageIndex >= 0 && z?.Reader?.open) {
    try {
      const zItem = z.Items?.getAsync ? await z.Items.getAsync(itemId) : z.Items?.get?.(itemId);
      const attachment = (typeof zItem?.isAttachment === 'function' && zItem.isAttachment())
        ? zItem
        : await zItem?.getBestAttachment?.();
      if (attachment) {
        try {
          await z.Reader.open(attachment.id, { pageIndex });
          return;
        } catch {
          try {
            await z.Reader.open(attachment.id);
            return;
          } catch {}
        }
      }
    } catch {
      // Fall through to standard flow
    }
  }

  // 1. First try ZoteroPane.viewItems (Zotero's primary UI view handler)
  if (zp && typeof zp.viewItems === 'function') {
    try {
      await zp.viewItems([itemId]);
      return;
    } catch {
      try {
        const zItem = z?.Items?.getAsync ? await z.Items.getAsync(itemId) : z?.Items?.get?.(itemId);
        if (zItem) {
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
      const attachment = (typeof zItem?.isAttachment === 'function' && zItem.isAttachment())
        ? zItem
        : await zItem?.getBestAttachment?.();
      if (attachment) {
        if (z.Reader?.open) {
          try {
            await z.Reader.open(attachment.id);
            return;
          } catch {}
        }
        if (typeof zp?.openAttachment === 'function') {
          zp.openAttachment(attachment.id);
          return;
        }
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
