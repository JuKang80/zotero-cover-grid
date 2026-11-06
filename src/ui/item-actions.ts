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
    const itemPane =
      win?.ZoteroItemPane ||
      zp?.itemPane ||
      (typeof (globalThis as any).ZoteroItemPane !== 'undefined' ? (globalThis as any).ZoteroItemPane : null);

    const applyItemView = (targetItem: any) => {
      if (!targetItem) return;
      if (itemPane && typeof itemPane.viewItem === 'function') {
        try { itemPane.viewItem(targetItem); return; } catch {}
      }
      if (itemPane && typeof itemPane.viewItems === 'function') {
        try { itemPane.viewItems([targetItem]); return; } catch {}
      }
      if (zp && typeof zp.viewItem === 'function') {
        try { zp.viewItem(targetItem); return; } catch {}
      }
    };

    if (item) {
      applyItemView(item);
    } else if (z?.Items?.getAsync) {
      z.Items.getAsync(itemId).then((asyncItem: any) => {
        applyItemView(asyncItem);
      }).catch(() => {});
    }

    // 3. Sync with ZoteroPane selection (both selectItem and itemsView.selectItem)
    const itemsTree = doc?.getElementById('zotero-items-tree');
    const isTreeHidden = itemsTree?.hidden || itemsTree?.style?.display === 'none';

    if (typeof zp?.selectItem === 'function') {
      try {
        if (isTreeHidden && typeof zp.itemsView?.selectItems === 'function') {
          // When tree is hidden in grid mode, do not trigger scrollToRow on 0px height tree
          zp.itemsView.selectItems([itemId], false, true);
        } else {
          zp.selectItem(itemId, false, false);
        }
      } catch {}
    } else if (zp?.itemsView && typeof zp.itemsView.selectItem === 'function') {
      try {
        if (isTreeHidden && typeof zp.itemsView.selectItems === 'function') {
          zp.itemsView.selectItems([itemId], false, true);
        } else {
          zp.itemsView.selectItem(itemId);
        }
      } catch {}
    }
  } catch (err) {
    z?.logError?.(err);
  }
}

export async function openItemInZotero(win: any, itemId: number): Promise<void> {
  const zp = win?.ZoteroPane || (typeof (globalThis as any).ZoteroPane !== 'undefined' ? (globalThis as any).ZoteroPane : null);
  const z = win?.Zotero || (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero : null);

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
