import { PaperCardData } from '../../types';
import { extractPaperCardData } from '../../utils/apa-formatter';

declare const Zotero: any;
declare const ZoteroPane: any;

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

      const rows = zp?.getCollectionTreeRows?.();
      if (Array.isArray(rows) && rows[0]?.getName) {
        return rows[0].getName();
      }
    } catch {
      // Ignore
    }
    return 'My Library';
  }

  public async fetchCollectionItems(signal: AbortSignal): Promise<PaperCardData[]> {
    // 0. Await Zotero lifecycle readiness (database unlock and UI readiness) with timeout safeguard
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
    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);

    try {
      // Step A: Priority 1 - Native itemsView rows, getRow, getSortedItems (Strictly inherits active Zotero table sort order)
      if (zp?.itemsView?.rowCount && typeof zp.itemsView.getRow === 'function') {
        try {
          const count = zp.itemsView.rowCount;
          const ids: number[] = [];
          for (let i = 0; i < count; i++) {
            const r = zp.itemsView.getRow(i);
            const id = typeof r === 'object' && r ? (r.id || r.ref?.id) : r;
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
        } catch {
          // Fall through
        }
      }

      if (rawItems == null && typeof zp?.itemsView?.getSortedItems === 'function') {
        try {
          const treeItems = zp.itemsView.getSortedItems();
          if (Array.isArray(treeItems)) {
            rawItems = treeItems;
          }
        } catch {
          // Fall through
        }
      }

      // Step B: Priority 2 - Selected collection row or direct collection items
      if (rawItems == null) {
        const selectedCols = zp?.getSelectedCollections ? zp.getSelectedCollections() : (zp?.getSelectedCollection ? [zp.getSelectedCollection()] : []);
        const selectedCol = Array.isArray(selectedCols) && selectedCols.length > 0 ? selectedCols[0] : null;
        if (selectedCol) {
          // Try getChildItems(true) - Passing true returns numeric item IDs without throwing UnloadedDataException
          if (typeof selectedCol.getChildItems === 'function') {
            try {
              let colItemsOrIDs = selectedCol.getChildItems(true);
              if (colItemsOrIDs instanceof Promise) {
                colItemsOrIDs = await colItemsOrIDs;
              }
              if (Array.isArray(colItemsOrIDs)) {
                const hasObjects = colItemsOrIDs.some((it: any) => typeof it === 'object' && it !== null);
                if (hasObjects) {
                  rawItems = colItemsOrIDs;
                } else if (colItemsOrIDs.length > 0 && z?.Items?.getAsync) {
                  rawItems = await z.Items.getAsync(colItemsOrIDs);
                } else if (colItemsOrIDs.length > 0 && z?.Items?.get) {
                  try {
                    rawItems = z.Items.get(colItemsOrIDs);
                  } catch {
                    rawItems = colItemsOrIDs;
                  }
                } else {
                  rawItems = colItemsOrIDs;
                }
              }
            } catch {
              // Fall through to Search / getAsync
            }
          }

          // Try native Zotero.Search with selected collectionID
          if ((rawItems == null || rawItems.length === 0) && z?.Search) {
            try {
              const s = new z.Search();
              s.libraryID = selectedCol.libraryID || zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID;
              s.addCondition('collectionID', 'is', selectedCol.id);
              s.addCondition('noChildren', 'true');
              if (z.Prefs?.get?.('recursiveCollections')) {
                s.addCondition('recursive', 'true');
              }
              const itemIDs = await s.search();
              if (Array.isArray(itemIDs)) {
                if (itemIDs.length > 0 && z.Items?.getAsync) {
                  rawItems = await z.Items.getAsync(itemIDs);
                } else if (itemIDs.length > 0 && z.Items?.get) {
                  try {
                    rawItems = z.Items.get(itemIDs);
                  } catch {
                    rawItems = itemIDs;
                  }
                } else {
                  rawItems = itemIDs;
                }
              }
            } catch {
              // Fall through
            }
          }
        }
      }

      // Step C: Priority 3 - Native collectionTreeRow.getItems()
      if (rawItems == null) {
        const treeRow = zp?.getCollectionTreeRow?.() || zp?.getCollectionTreeRows?.()?.[0];
        if (treeRow && typeof treeRow.getItems === 'function') {
          try {
            const rowItems = await treeRow.getItems();
            if (Array.isArray(rowItems)) {
              rawItems = rowItems;
            }
          } catch {
            // Fall through
          }
        }
      }

      if (rawItems == null) {
        if (typeof zp?.getSortedItems === 'function') {
          try {
            const sorted = zp.getSortedItems();
            if (Array.isArray(sorted)) {
              rawItems = sorted;
            }
          } catch {
            // Fall through
          }
        } else if (typeof zp?.getUnfilteredItems === 'function') {
          try {
            rawItems = await zp.getUnfilteredItems();
          } catch {
            // Fall through
          }
        } else if (zp?.itemsView?.rowProvider?.items) {
          rawItems = zp.itemsView.rowProvider.items;
        }
      }

      // Step D: Priority 4 - Multiple selected collections
      if (rawItems == null) {
        const selectedCols = zp?.getSelectedCollections?.();
        if (Array.isArray(selectedCols) && selectedCols.length > 0) {
          const itemsMap = new Map<number, any>();
          for (const col of selectedCols) {
            if (col) {
              if (typeof col.getChildItems === 'function') {
                try {
                  let cItems = col.getChildItems(true);
                  if (cItems instanceof Promise) {
                    cItems = await cItems;
                  }
                  if (Array.isArray(cItems) && cItems.length > 0) {
                    const loadedItems = z?.Items?.getAsync ? await z.Items.getAsync(cItems) : cItems;
                    for (const it of loadedItems) {
                      const numId = typeof it === 'object' && it?.id ? it.id : Number(it);
                      if (numId) itemsMap.set(numId, it);
                    }
                  }
                } catch {
                  // Ignore
                }
              }
              if (z?.Search && col.libraryID) {
                try {
                  const s = new z.Search();
                  s.libraryID = col.libraryID;
                  s.addCondition('collectionID', 'is', col.id);
                  s.addCondition('noChildren', 'true');
                  const colItemIDs = await s.search();
                  if (Array.isArray(colItemIDs) && colItemIDs.length > 0) {
                    const colItems = z.Items?.getAsync ? await z.Items.getAsync(colItemIDs) : colItemIDs;
                    for (const it of colItems) {
                      if (it && it.id) itemsMap.set(it.id, it);
                    }
                  }
                } catch {
                  // Ignore
                }
              }
            }
          }
          if (itemsMap.size > 0) {
            rawItems = Array.from(itemsMap.values());
          }
        }
      }

      // Step E: Priority 5 - Saved search (Smart Collection)
      if (rawItems == null) {
        const savedSearch = zp?.getSelectedSavedSearch?.();
        if (savedSearch && typeof savedSearch.search === 'function') {
          try {
            const searchItemIDs = await savedSearch.search(true);
            if (Array.isArray(searchItemIDs) && searchItemIDs.length > 0) {
              rawItems = z?.Items?.getAsync ? await z.Items.getAsync(searchItemIDs) : searchItemIDs;
            }
          } catch {
            // Fall through
          }
        }
      }

      // Step F: Priority 6 - Library root fallback
      if (rawItems == null) {
        const libraryID = zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID;
        if (z?.Items?.getAll) {
          try {
            const allRes = libraryID ? z.Items.getAll(libraryID, true, false) : z.Items.getAll();
            const resolved = allRes instanceof Promise ? await allRes : allRes;
            if (Array.isArray(resolved) && resolved.length > 0) {
              rawItems = resolved;
            }
          } catch {
            // Fall through
          }
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
          } catch {
            // Fall through
          }
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

    // Filter to valid displayable paper items and standalone notes (exclude child notes, attachments, annotations)
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
      if (typeof it.isAttachment === 'function' && it.isAttachment()) return false;
      if (typeof it.isAnnotation === 'function' && it.isAnnotation()) return false;
      if (typeof it.isNote === 'function' && it.isNote()) {
        return Boolean(it.id) && !it.parentItemID && !it.parentID;
      }
      if (typeof it.isRegularItem === 'function') {
        return it.isRegularItem();
      }
      return true;
    });

    // Ensure item data (title, creators, date, tags) is loaded safely
    if (validItems.length > 0) {
      if (z?.Items?.loadDataTypes) {
        try {
          await z.Items.loadDataTypes(validItems, ['primaryData', 'itemData', 'creators', 'tags']);
        } catch {
          try {
            await z.Items.loadDataTypes(validItems);
          } catch {
            // Ignore
          }
        }
      }
      const itemsNeedingLoad = validItems.filter(
        (it: any) => it && (typeof it.loadAllData === 'function' || typeof it.loadDataType === 'function')
      );
      if (itemsNeedingLoad.length > 0) {
        await Promise.all(
          itemsNeedingLoad.map(async (it: any) => {
            if (typeof it.loadAllData === 'function') {
              try {
                await it.loadAllData();
                return;
              } catch {
                // Fall through
              }
            }
            if (typeof it.loadDataType === 'function') {
              try {
                await it.loadDataType('primaryData');
              } catch {
                // Ignore
              }
            }
          })
        );
      }
    }

    if (signal.aborted) return [];

    try {
      return validItems.map(extractPaperCardData);
    } catch {
      return [];
    }
  }
}
