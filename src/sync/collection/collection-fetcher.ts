import { PaperCardData } from '../../types';
import { extractPaperCardData } from '../../utils/apa-formatter';

declare const Zotero: any;
declare const ZoteroPane: any;

/**
 * Recursively retrieves all items and item IDs for a collection and its subcollections,
 * respecting Zotero's recursiveCollections preference (default: true).
 */
export async function getCollectionItemsRecursively(col: any, z?: any): Promise<{ ids: number[]; items: any[] }> {
  const itemIDs = new Set<number>();
  const itemsList: any[] = [];
  const visitedCols = new Set<number>();

  const recursive =
    z?.Prefs?.get?.('extensions.zotero.recursiveCollections') ??
    z?.Prefs?.get?.('recursiveCollections') ??
    true;

  async function traverse(targetCol: any) {
    if (!targetCol) return;
    const colId = targetCol.id != null ? Number(targetCol.id) : null;
    if (colId != null) {
      if (visitedCols.has(colId)) return;
      visitedCols.add(colId);
    }

    // 1. Fetch direct items from this collection
    if (typeof targetCol.getChildItems === 'function') {
      try {
        let direct = targetCol.getChildItems(true);
        if (direct instanceof Promise) direct = await direct;
        if (Array.isArray(direct)) {
          for (const it of direct) {
            if (typeof it === 'object' && it !== null) {
              itemsList.push(it);
              const id = it.id || it.ref?.id || it.itemID;
              if (id) itemIDs.add(Number(id));
            } else if (it != null && !isNaN(Number(it))) {
              itemIDs.add(Number(it));
            }
          }
        }
      } catch {}
    }

    // 2. Fetch subcollections recursively if recursiveCollections is enabled
    if (recursive) {
      let subCols: any[] = [];
      if (typeof targetCol.getChildCollections === 'function') {
        try {
          const res = targetCol.getChildCollections();
          subCols = res instanceof Promise ? await res : res;
        } catch {}
      }

      if (!Array.isArray(subCols) || subCols.length === 0) {
        if (colId != null && typeof z?.Collections?.getByParent === 'function') {
          try {
            const res = z.Collections.getByParent(colId);
            subCols = res instanceof Promise ? await res : res;
          } catch {}
        }
      }

      if (Array.isArray(subCols)) {
        for (const sub of subCols) {
          const subObj =
            typeof sub === 'number' || typeof sub === 'string'
              ? (z?.Collections?.get ? z.Collections.get(Number(sub)) : null)
              : sub;
          if (subObj) {
            await traverse(subObj);
          }
        }
      }
    }
  }

  await traverse(col);
  return { ids: Array.from(itemIDs), items: itemsList };
}

// Backward compatibility helper
export async function getCollectionItemIDsRecursively(col: any, z?: any): Promise<number[]> {
  const res = await getCollectionItemsRecursively(col, z);
  return res.ids;
}

export class CollectionFetcher {
  constructor(private win: any) {}

  public getCurrentCollectionName(): string {
    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    try {
      const cols = zp?.getSelectedCollections ? zp.getSelectedCollections() : (zp?.getSelectedCollection ? [zp.getSelectedCollection()] : []);
      if (Array.isArray(cols) && cols.length > 0 && cols[0]) {
        const firstCol = cols[0];
        if (firstCol.name) return firstCol.name;
        if (typeof firstCol.getName === 'function') return firstCol.getName();
      }

      const rows = zp?.getCollectionTreeRows?.() || (zp?.getCollectionTreeRow ? [zp.getCollectionTreeRow()] : []);
      if (Array.isArray(rows) && rows[0]) {
        const r = rows[0];
        if (r.name) return r.name;
        if (typeof r.getName === 'function') return r.getName();
        if (r.title) return r.title;
      }
    } catch {
      // Ignore
    }
    return 'My Library';
  }

  public async fetchCollectionItems(signal: AbortSignal): Promise<PaperCardData[]> {
    // 0. Await Zotero lifecycle readiness with timeout safeguard
    const zObj = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (zObj) {
      const waitPromises: Promise<any>[] = [];
      if (zObj.initializationPromise) waitPromises.push(zObj.initializationPromise);
      if (zObj.unlockPromise) waitPromises.push(zObj.unlockPromise);
      if (zObj.uiReadyPromise) waitPromises.push(zObj.uiReadyPromise);
      if (waitPromises.length > 0) {
        try {
          await Promise.race([
            Promise.all(waitPromises),
            new Promise((resolve) => setTimeout(resolve, 800))
          ]);
        } catch {
          // Ignore
        }
      }
    }

    if (signal.aborted) return [];

    let rawItems: any[] | null = null;
    let collectionChecked = false;
    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? zObj : null);
    const doc = this.win?.document;

    // Detect if itemsTree is hidden or Cover Grid is active
    const itemsTree = doc?.getElementById?.('zotero-items-tree');
    const gridEl = doc?.getElementById?.('zotero-cover-grid');
    const isCoverGridActive =
      (gridEl && !gridEl.hidden && gridEl.style?.display !== 'none') ||
      (itemsTree && (itemsTree.hidden || itemsTree.style?.display === 'none'));

    try {
      // Step A: Priority 1 - Native itemsView rows, rowProvider, getSortedItems
      if (zp?.itemsView?.rowCount && typeof zp.itemsView.getRow === 'function') {
        try {
          const count = zp.itemsView.rowCount;
          const ids: number[] = [];
          for (let i = 0; i < count; i++) {
            const r = zp.itemsView.getRow(i);
            const id = typeof r === 'object' && r ? (r.id || r.itemID || r.ref?.id || r.item?.id) : r;
            if (typeof id === 'number' && !ids.includes(id)) {
              ids.push(id);
            }
          }
          if (ids.length > 0) {
            if (z?.Items?.getAsync) {
              rawItems = await z.Items.getAsync(ids);
            } else if (z?.Items?.get) {
              rawItems = ids.map((id) => {
                try { return z.Items.get(id); } catch { return null; }
              }).filter(Boolean);
            } else {
              rawItems = ids;
            }
          }
        } catch {}
      }

      if (rawItems == null && zp?.itemsView?.rowProvider?.items) {
        const rowItems = zp.itemsView.rowProvider.items;
        if (Array.isArray(rowItems) && rowItems.length > 0) {
          rawItems = rowItems;
        }
      }

      if (rawItems == null && typeof zp?.itemsView?.getSortedItems === 'function') {
        try {
          const treeItems = zp.itemsView.getSortedItems();
          if (Array.isArray(treeItems)) {
            // When Cover Grid is active, Gecko's hidden VirtualizedTable always returns [].
            // Only accept empty array if Cover Grid is NOT active (i.e. legitimate empty view).
            if (treeItems.length > 0 || !isCoverGridActive) {
              rawItems = treeItems;
            }
          }
        } catch {}
      }

      // Step B: Priority 2 - Native collectionTreeRow (supports Collections, Recently Read, Saved Searches, Trash, Unfiled, Feeds)
      const treeRow =
        zp?.getCollectionTreeRow?.() ||
        zp?.getCollectionTreeRows?.()?.[0] ||
        zp?.collectionsView?.selectedTreeRow ||
        zp?.collectionsView?.selectedTreeRows?.[0] ||
        (typeof zp?.collectionsView?.getRow === 'function' && typeof zp?.collectionsView?.selectedIndex === 'number' && zp.collectionsView.selectedIndex >= 0
          ? zp.collectionsView.getRow(zp.collectionsView.selectedIndex)
          : null);

      if ((rawItems == null || rawItems.length === 0) && treeRow) {
        // 1. treeRow.getItems()
        if (typeof treeRow.getItems === 'function') {
          try {
            let rowItems = treeRow.getItems(true);
            if (rowItems instanceof Promise) rowItems = await rowItems;
            if (Array.isArray(rowItems) && rowItems.length > 0) {
              collectionChecked = true;
              rawItems = rowItems;
            }
          } catch {}
        }

        // 2. treeRow is a saved search or special search
        if ((rawItems == null || rawItems.length === 0) && (treeRow.isSearch?.() || treeRow.type === 'search' || treeRow.type === 'saved-search')) {
          try {
            const searchObj = treeRow.getSearchObject?.() || treeRow.ref || zp?.getSelectedSavedSearch?.();
            if (searchObj && typeof searchObj.search === 'function') {
              const searchIds = await searchObj.search(true);
              if (Array.isArray(searchIds)) {
                collectionChecked = true;
                rawItems = searchIds;
              }
            }
          } catch {}
        }

        // 3. treeRow is Trash
        if ((rawItems == null || rawItems.length === 0) && (treeRow.isTrash?.() || treeRow.type === 'trash')) {
          try {
            const libraryID = zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID;
            if (z?.Items?.getAll) {
              collectionChecked = true;
              rawItems = await z.Items.getAll(libraryID, true, true);
            }
          } catch {}
        }

        // 4. treeRow is Unfiled
        if ((rawItems == null || rawItems.length === 0) && (treeRow.isUnfiled?.() || treeRow.type === 'unfiled')) {
          try {
            const libraryID = zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID;
            if (z?.Items?.getUnfiled) {
              collectionChecked = true;
              rawItems = await z.Items.getUnfiled(libraryID, true);
            }
          } catch {}
        }

        // 5. treeRow is Duplicates
        if ((rawItems == null || rawItems.length === 0) && (treeRow.isDuplicates?.() || treeRow.type === 'duplicates')) {
          try {
            const libraryID = zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID;
            collectionChecked = true;
            rawItems = zp?.getDuplicates ? zp.getDuplicates() : (z?.Duplicates?.getAsync ? await z.Duplicates.getAsync(libraryID) : []);
          } catch {}
        }
      }

      // Step C: Priority 3 - Selected collection(s) with full recursive subcollection support
      if (rawItems == null || rawItems.length === 0) {
        const selectedCols = zp?.getSelectedCollections
          ? zp.getSelectedCollections()
          : (zp?.getSelectedCollection ? [zp.getSelectedCollection()] : []);

        const validCols = Array.isArray(selectedCols) ? selectedCols.filter((c: any) => c && (c.id != null || typeof c.getChildItems === 'function')) : [];

        if (validCols.length > 0) {
          const allColItemIDs = new Set<number>();
          const allColObjects: any[] = [];

          for (const col of validCols) {
            collectionChecked = true;
            const collected = await getCollectionItemsRecursively(col, z);
            for (const id of collected.ids) allColItemIDs.add(id);
            for (const it of collected.items) allColObjects.push(it);

            // Fallback: Zotero.Search with 'collection' or 'collectionID' condition
            if (collected.ids.length === 0 && collected.items.length === 0 && z?.Search && col.id != null) {
              try {
                const s = new z.Search();
                s.libraryID = col.libraryID || zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID;
                try {
                  s.addCondition('collection', 'is', col.id);
                } catch {
                  s.addCondition('collectionID', 'is', col.id);
                }
                s.addCondition('noChildren', 'true');
                const searchItemIDs = await s.search();
                if (Array.isArray(searchItemIDs)) {
                  for (const sid of searchItemIDs) allColItemIDs.add(Number(sid));
                }
              } catch {}
            }
          }

          if (allColObjects.length > 0 && allColObjects.length >= allColItemIDs.size) {
            rawItems = allColObjects;
          } else if (allColItemIDs.size > 0) {
            const idList = Array.from(allColItemIDs);
            if (z?.Items?.getAsync) {
              rawItems = await z.Items.getAsync(idList);
            } else if (z?.Items?.get) {
              rawItems = idList.map((id) => {
                try { return z.Items.get(id); } catch { return null; }
              }).filter(Boolean);
            } else {
              rawItems = idList;
            }
          } else {
            rawItems = [];
          }
        }
      }

      // Step D: Priority 4 - zp.getSortedItems / zp.getUnfilteredItems fallback
      if (rawItems == null || rawItems.length === 0) {
        if (typeof zp?.getSortedItems === 'function') {
          try {
            const sorted = zp.getSortedItems();
            if (Array.isArray(sorted) && sorted.length > 0) {
              rawItems = sorted;
            }
          } catch {}
        } else if (typeof zp?.getUnfilteredItems === 'function') {
          try {
            const unfilt = await zp.getUnfilteredItems();
            if (Array.isArray(unfilt) && unfilt.length > 0) {
              rawItems = unfilt;
            }
          } catch {}
        }
      }

      // Step E: Priority 5 - Saved search fallback (Smart Collection)
      if (rawItems == null || rawItems.length === 0) {
        const savedSearch = zp?.getSelectedSavedSearch?.();
        if (savedSearch && typeof savedSearch.search === 'function') {
          try {
            const searchItemIDs = await savedSearch.search(true);
            if (Array.isArray(searchItemIDs)) {
              collectionChecked = true;
              rawItems = z?.Items?.getAsync ? await z.Items.getAsync(searchItemIDs) : searchItemIDs;
            }
          } catch {}
        }
      }

      // Step F: Priority 6 - Library root fallback (ONLY when no specific collection or virtual row was checked)
      if (rawItems == null && !collectionChecked) {
        const libraryID = zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID;
        if (z?.Items?.getAll) {
          try {
            const allRes = libraryID ? z.Items.getAll(libraryID, true, false) : z.Items.getAll();
            const resolved = allRes instanceof Promise ? await allRes : allRes;
            if (Array.isArray(resolved) && resolved.length > 0) {
              rawItems = resolved;
            }
          } catch {}
        }
        if (rawItems == null && z?.Search && libraryID) {
          try {
            const s = new z.Search();
            s.libraryID = libraryID;
            s.addCondition('noChildren', 'true');
            const itemIDs = await s.search();
            if (Array.isArray(itemIDs) && itemIDs.length > 0) {
              rawItems = z.Items?.getAsync ? await z.Items.getAsync(itemIDs) : itemIDs;
            }
          } catch {}
        }
      }
    } catch {
      rawItems = [];
    }

    // Ensure rawItems is awaited if it is a Promise, and strictly an Array
    if (rawItems instanceof Promise) {
      try {
        rawItems = await rawItems;
      } catch {
        rawItems = [];
      }
    }
    if (!Array.isArray(rawItems)) {
      rawItems = [];
    }

    // Abort check: if a new reload call was issued, abort immediately before updating state
    if (signal.aborted) return [];

    // Step G: Asynchronously load any numeric ID primitives into full Zotero.Item instances
    try {
      const numericIds = rawItems.filter((it: any) => typeof it === 'number' || typeof it === 'string').map(Number);
      if (numericIds.length > 0 && z?.Items?.getAsync) {
        try {
          const loaded = await z.Items.getAsync(numericIds);
          if (Array.isArray(loaded)) {
            const loadedMap = new Map<number, any>();
            for (const item of loaded) {
              if (item?.id) loadedMap.set(item.id, item);
            }
            rawItems = rawItems.map((it: any) => {
              if (typeof it === 'number' || typeof it === 'string') {
                return loadedMap.get(Number(it)) || it;
              }
              return it;
            });
          }
        } catch {
          // Ignore
        }
      }
    } catch {
      // Ignore
    }

    if (signal.aborted) return [];

    // Filter to valid displayable paper items, standalone notes, and standalone attachments
    const validItems = (rawItems || []).map((it: any) => {
      if (typeof it === 'number' || typeof it === 'string') {
        try {
          return z?.Items?.get ? z.Items.get(Number(it)) : null;
        } catch {
          return null;
        }
      }
      return it;
    }).filter((it: any) => {
      if (!it) return false;
      const isTopLevel = typeof it.isTopLevelItem === 'function' ? it.isTopLevelItem() : (!it.parentItemID && !it.parentItem && !it.parentID);
      if (typeof it.isAttachment === 'function' && it.isAttachment()) {
        // Child attachments (belonging to a parent) are excluded, but top-level standalone PDF attachments are displayed
        return Boolean(it.id) && isTopLevel;
      }
      if (typeof it.isAnnotation === 'function' && it.isAnnotation()) return false;
      if (typeof it.isNote === 'function' && it.isNote()) {
        return Boolean(it.id) && isTopLevel;
      }
      if (typeof it.isRegularItem === 'function') {
        return it.isRegularItem();
      }
      return true;
    });

    // Ensure item data (title, creators, date, tags) is loaded safely with timeout safeguard
    if (validItems.length > 0) {
      try {
        await Promise.race([
          (async () => {
            if (z?.Items?.loadDataTypes) {
              try {
                await z.Items.loadDataTypes(validItems, ['primaryData', 'itemData', 'creators', 'tags']);
              } catch {
                try {
                  await z.Items.loadDataTypes(validItems);
                } catch {}
              }
            }
            const itemsNeedingLoad = validItems.filter(
              (it: any) => it && (typeof it.loadAllData === 'function' || typeof it.loadDataType === 'function')
            );
            if (itemsNeedingLoad.length > 0) {
              await Promise.all(
                itemsNeedingLoad.map(async (it: any) => {
                  try {
                    if (typeof it.loadAllData === 'function') {
                      await it.loadAllData();
                    } else if (typeof it.loadDataType === 'function') {
                      await it.loadDataType('primaryData');
                    }
                  } catch {}
                })
              );
            }
          })(),
          new Promise((resolve) => setTimeout(resolve, 800))
        ]);
      } catch {}
    }

    if (signal.aborted) return [];

    // Safely extract paper card data per item; individual item failures never blank the folder
    const result: PaperCardData[] = [];
    for (const it of validItems) {
      if (!it) continue;
      try {
        const card = extractPaperCardData(it);
        if (card && card.id) {
          result.push(card);
        }
      } catch {
        try {
          result.push({
            id: it.id || 0,
            key: it.key || `KEY_${it.id || 0}`,
            title: it.getField?.('title') || it.title || 'Untitled',
            authorText: 'Unknown Author',
            citationText: it.getField?.('title') || 'Untitled',
            itemType: it.itemType || 'journalArticle',
            year: '',
            publicationTitle: '',
            notePreview: '',
            readStatus: 'unread',
            hasPdf: false,
            tags: [],
            colorTags: []
          });
        } catch {}
      }
    }

    return result;
  }
}
