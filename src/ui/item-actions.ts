/**
 * Clean-room implementation of Zotero item actions:
 * - selectItemInZotero: Updates right-hand Item Pane with item metadata
 * - openItemInZotero: Opens the primary attachment in Zotero Reader
 *
 * Fully licensed under MIT. Strictly uses standard public Zotero 10 APIs.
 */

export function selectItemInZotero(win: any, itemId: number): void {
  const zp = win?.ZoteroPane || (typeof (globalThis as any).ZoteroPane !== 'undefined' ? (globalThis as any).ZoteroPane : null);
  if (!zp) return;

  try {
    // 1. Primary ZoteroPane item selection API (selects item and updates right item pane)
    if (typeof zp.selectItem === 'function') {
      zp.selectItem(itemId, false, true);
    } else if (zp.itemsView && typeof zp.itemsView.selectItem === 'function') {
      zp.itemsView.selectItem(itemId);
    }

    // 2. Explicitly ensure Item Pane inspects the item if itemPane is available
    if (zp.itemPane && typeof zp.itemPane.viewItem === 'function') {
      const z = win?.Zotero || (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero : null);
      const item = z?.Items?.get ? z.Items.get(itemId) : null;
      if (item) {
        zp.itemPane.viewItem(item);
      }
    }
  } catch (err) {
    const z = win?.Zotero || (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero : null);
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
