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

  // Helper to extract items from a single collection
  async function fetchItemsFromCol(targetCol: any) {
    if (!targetCol) return;
    try {
      if (typeof targetCol.loadDataType === 'function') {
        const p = targetCol.loadDataType('childItems');
        if (p instanceof Promise) await p;
      } else if (typeof targetCol.loadAllData === 'function') {
        const p = targetCol.loadAllData();
        if (p instanceof Promise) await p;
      }
    } catch {}

    // Direct inspection of Zotero internal _childItems Set<number> prevents losing unloaded items
    // when targetCol.getChildItems(true) maps unloaded ChildObjects.get(id) -> false -> false.id (undefined)
    try {
      const internalSet = targetCol._childItems;
      if (internalSet && typeof internalSet[Symbol.iterator] === 'function') {
        for (const rawId of internalSet) {
          if (rawId != null && !isNaN(Number(rawId))) {
            itemIDs.add(Number(rawId));
          }
        }
      }
    } catch {}

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
            } else if (it != null && typeof it !== 'boolean' && !isNaN(Number(it))) {
              itemIDs.add(Number(it));
            }
          }
        }
      } catch {
        try {
          let directObjs = targetCol.getChildItems(false);
          if (directObjs instanceof Promise) directObjs = await directObjs;
          if (Array.isArray(directObjs)) {
            for (const it of directObjs) {
              if (typeof it === 'object' && it !== null) {
                itemsList.push(it);
                const id = it.id || it.ref?.id || it.itemID;
                if (id) itemIDs.add(Number(id));
              }
            }
          }
        } catch {}
      }
    }
  }

  // 1. Process root collection
  await fetchItemsFromCol(col);
  const rootColId = col?.id != null ? Number(col.id) : null;
  if (rootColId != null) visitedCols.add(rootColId);

  // 2. If recursive, collect all descendant subcollections
  if (recursive && col) {
    const descendantColObjects: any[] = [];
    const descendantColIDs = new Set<number>();

    // Strategy 1: Native Zotero col.getDescendents() or col.getDescendants()
    if (typeof col.getDescendents === 'function' || typeof col.getDescendants === 'function') {
      try {
        const getDescFn = col.getDescendents ? col.getDescendents.bind(col) : col.getDescendants.bind(col);
        let desc = getDescFn(false);
        if (desc instanceof Promise) desc = await desc;
        if (Array.isArray(desc) && desc.length > 0) {
          for (const d of desc) {
            if (typeof d === 'object' && d !== null) {
              descendantColObjects.push(d);
              if (d.id != null) descendantColIDs.add(Number(d.id));
            } else if (typeof d === 'number') {
              descendantColIDs.add(d);
            }
          }
        } else {
          let descIds = getDescFn(true);
          if (descIds instanceof Promise) descIds = await descIds;
          if (Array.isArray(descIds)) {
            for (const did of descIds) {
              if (did != null && !isNaN(Number(did))) descendantColIDs.add(Number(did));
            }
          }
        }
      } catch {}
    }

    // Strategy 2: Zotero.Collections.getByLibrary(libId) with BFS on parentID (100% native parity across all Zotero versions)
    const libId = col.libraryID ?? z?.Libraries?.userLibraryID;
    if (rootColId != null && z?.Collections?.getByLibrary && libId != null) {
      try {
        let allLibCols = z.Collections.getByLibrary(libId);
        if (allLibCols instanceof Promise) allLibCols = await allLibCols;
        if (Array.isArray(allLibCols) && allLibCols.length > 0) {
          const childrenMap = new Map<number, any[]>();
          for (const c of allLibCols) {
            const pid = c.parentID != null ? Number(c.parentID) : (c.parentCollectionID != null ? Number(c.parentCollectionID) : null);
            if (pid != null && !isNaN(pid)) {
              if (!childrenMap.has(pid)) childrenMap.set(pid, []);
              childrenMap.get(pid)!.push(c);
            }
          }

          const queue = [rootColId];
          while (queue.length > 0) {
            const currentPid = queue.shift()!;
            const children = childrenMap.get(currentPid) || [];
            for (const child of children) {
              const cid = child.id != null ? Number(child.id) : null;
              if (cid != null && !descendantColIDs.has(cid) && cid !== rootColId) {
                descendantColIDs.add(cid);
                descendantColObjects.push(child);
                queue.push(cid);
              }
            }
          }
        }
      } catch {}
    }

    // Strategy 3: Direct properties or methods on col: getChildCollections, subcollections, childCollections, getSubcollections
    async function traverseDirect(c: any) {
      if (!c) return;
      let children: any[] = [];
      if (typeof c.getChildCollections === 'function') {
        try {
          const res = c.getChildCollections();
          children = res instanceof Promise ? await res : res;
        } catch {}
      } else if (typeof c.getSubcollections === 'function') {
        try {
          const res = c.getSubcollections();
          children = res instanceof Promise ? await res : res;
        } catch {}
      } else if (Array.isArray(c.subcollections)) {
        children = c.subcollections;
      } else if (Array.isArray(c.childCollections)) {
        children = c.childCollections;
      }

      if (Array.isArray(children)) {
        for (const child of children) {
          const cid = typeof child === 'object' && child ? Number(child.id) : Number(child);
          if (cid && !descendantColIDs.has(cid) && cid !== rootColId) {
            descendantColIDs.add(cid);
            if (typeof child === 'object' && child) {
              descendantColObjects.push(child);
            }
          }
          if (typeof child === 'object' && child) {
            await traverseDirect(child);
          }
        }
      }
    }
    await traverseDirect(col);

    // Strategy 4: Fallback to z.Collections.getByParent
    if (rootColId != null && typeof z?.Collections?.getByParent === 'function') {
      try {
        const queue = [rootColId];
        while (queue.length > 0) {
          const pid = queue.shift()!;
          let kids = z.Collections.getByParent(pid);
          if (kids instanceof Promise) kids = await kids;
          if (Array.isArray(kids)) {
            for (const k of kids) {
              const kidObj = typeof k === 'number' || typeof k === 'string'
                ? (z.Collections.get ? z.Collections.get(Number(k)) : null)
                : k;
              const kidId = kidObj?.id != null ? Number(kidObj.id) : (typeof k === 'number' ? k : null);
              if (kidId != null && !descendantColIDs.has(kidId) && kidId !== rootColId) {
                descendantColIDs.add(kidId);
                if (kidObj) descendantColObjects.push(kidObj);
                queue.push(kidId);
              }
            }
          }
        }
      } catch {}
    }

    // Now fetch items from all resolved descendant collections
    for (const dCol of descendantColObjects) {
      const cid = dCol.id != null ? Number(dCol.id) : null;
      if (cid != null && visitedCols.has(cid)) continue;
      if (cid != null) visitedCols.add(cid);
      await fetchItemsFromCol(dCol);
    }

    // If some descendant IDs don't have objects yet, get them via z.Collections.get
    for (const cid of descendantColIDs) {
      if (visitedCols.has(cid)) continue;
      visitedCols.add(cid);
      let colObj = z?.Collections?.get ? z.Collections.get(cid) : null;
      if (colObj instanceof Promise) colObj = await colObj;
      if (colObj) {
        await fetchItemsFromCol(colObj);
      }
    }
  }

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
      // 1. Resolve candidate collections from selection or collection tree row
      const candidateCols: any[] = [];
      const selectedCols = zp?.getSelectedCollections
        ? zp.getSelectedCollections()
        : (zp?.getSelectedCollection ? [zp.getSelectedCollection()] : []);
      if (Array.isArray(selectedCols)) {
        for (const c of selectedCols) {
          if (c && (c.id != null || typeof c.getChildItems === 'function')) candidateCols.push(c);
        }
      }

      const treeRow =
        zp?.getCollectionTreeRow?.() ||
        zp?.getCollectionTreeRows?.()?.[0] ||
        zp?.collectionsView?.selectedTreeRow ||
        zp?.collectionsView?.selectedTreeRows?.[0] ||
        (typeof zp?.collectionsView?.getRow === 'function' && typeof zp?.collectionsView?.selectedIndex === 'number' && zp.collectionsView.selectedIndex >= 0
          ? zp.collectionsView.getRow(zp.collectionsView.selectedIndex)
          : null);

      if (treeRow) {
        if (treeRow.isCollection?.() || treeRow.type === 'collection') {
          const colObj = treeRow.ref || (treeRow.id != null && z?.Collections?.get ? z.Collections.get(treeRow.id) : null);
          if (colObj && !candidateCols.some((c) => c.id === colObj.id)) {
            candidateCols.push(colObj);
          }
        }
      }

      // Step A: Priority 1 - If a collection is selected or Cover Grid is active, fetch from collection (+ subcollections)
      if (candidateCols.length > 0) {
        collectionChecked = true;
        const allColItemIDs = new Set<number>();
        const allColObjects: any[] = [];

        for (const col of candidateCols) {
          const collected = await getCollectionItemsRecursively(col, z);
          for (const id of collected.ids) allColItemIDs.add(id);
          for (const it of collected.items) allColObjects.push(it);

          // Supplement with treeRow.getItems() if treeRow matches this collection (ensures 100% parity with Zotero's native list view)
          if (treeRow && (treeRow.ref?.id === col.id || treeRow.id === col.id) && typeof treeRow.getItems === 'function') {
            try {
              let rowItems = treeRow.getItems({ unfiltered: true });
              if (rowItems instanceof Promise) rowItems = await rowItems;
              if (Array.isArray(rowItems)) {
                for (const ri of rowItems) {
                  if (typeof ri === 'object' && ri !== null) {
                    const rid = ri.id || ri.ref?.id || ri.itemID;
                    if (rid != null && !isNaN(Number(rid))) allColItemIDs.add(Number(rid));
                    allColObjects.push(ri);
                  } else if (ri != null && typeof ri !== 'boolean' && !isNaN(Number(ri))) {
                    allColItemIDs.add(Number(ri));
                  }
                }
              }
            } catch {}
          }

          // Fallback: Zotero.Search with 'collectionID' or 'collection' condition
          if (collected.ids.length === 0 && collected.items.length === 0 && z?.Search && col.id != null) {
            try {
              const s = new z.Search();
              s.libraryID = col.libraryID || zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID;
              try {
                s.addCondition('collectionID', 'is', col.id);
              } catch {
                try {
                  s.addCondition('collection', 'is', col.key || col.id);
                } catch {}
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
          const seenObjIds = new Set<number>();
          const mergedObjs: any[] = [];
          for (const obj of allColObjects) {
            const oid = obj?.id || obj?.ref?.id || obj?.itemID;
            if (oid != null && !isNaN(Number(oid))) {
              if (!seenObjIds.has(Number(oid))) {
                seenObjIds.add(Number(oid));
                mergedObjs.push(obj);
              }
            } else {
              mergedObjs.push(obj);
            }
          }
          for (const id of allColItemIDs) {
            if (!seenObjIds.has(id)) {
              seenObjIds.add(id);
              mergedObjs.push(id);
            }
          }
          rawItems = mergedObjs;
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

      // Step B: Priority 2 - Special treeRow handling (Search, Trash, Unfiled, Duplicates, Virtual rows)
      if ((rawItems == null || rawItems.length === 0) && !collectionChecked && treeRow) {
        // 1. treeRow.getItems() (e.g. Recently Read)
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

        // 6. treeRow is Library Root (e.g. "My Library")
        if ((rawItems == null || rawItems.length === 0) && (treeRow.isLibrary?.() || treeRow.type === 'library' || treeRow.name === 'My Library')) {
          try {
            const libraryID = treeRow.libraryID || zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID;
            if (z?.Items?.getAll) {
              collectionChecked = true;
              rawItems = await z.Items.getAll(libraryID, true, false);
            }
          } catch {}
        }
      }

      // Step C: Priority 3 - Native itemsView rows, rowProvider, getSortedItems (when not in a specific collection)
      if (rawItems == null && !collectionChecked) {
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
              if (treeItems.length > 0 || !isCoverGridActive) {
                rawItems = treeItems;
              }
            }
          } catch {}
        }
      }

      // Step D: Priority 4 - zp.getSortedItems / zp.getUnfilteredItems fallback
      if ((rawItems == null || rawItems.length === 0) && !collectionChecked) {
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

    // Resolve all items to objects before loading primaryData/itemData and filtering
    const candidateItems = (rawItems || []).map((it: any) => {
      if (typeof it === 'number' || typeof it === 'string') {
        try {
          return z?.Items?.get ? z.Items.get(Number(it)) : null;
        } catch {
          return null;
        }
      }
      return it;
    }).filter(Boolean);

    // Ensure item data (primaryData, itemData, creators, tags) is loaded BEFORE calling isTopLevelItem / isAttachment
    if (candidateItems.length > 0) {
      try {
        await Promise.race([
          (async () => {
            if (z?.Items?.loadDataTypes) {
              try {
                await z.Items.loadDataTypes(candidateItems, ['primaryData', 'itemData', 'creators', 'tags']);
              } catch {
                try {
                  await z.Items.loadDataTypes(candidateItems);
                } catch {}
              }
            }
            const itemsNeedingLoad = candidateItems.filter(
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

    // Filter to valid displayable paper items, standalone notes, and standalone attachments
    const validItems = candidateItems.filter((it: any) => {
      if (!it) return false;
      let isTopLevel = true;
      try {
        isTopLevel =
          typeof it.isTopLevelItem === 'function'
            ? it.isTopLevelItem()
            : (!it.parentItemID && !it.parentItem && !it.parentID && !it.parentKey);
      } catch {
        isTopLevel = !it.parentItemID && !it.parentID && !it.parentKey;
      }
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
          const fallbackTitle =
            it.getField?.('title') ||
            it.getDisplayTitle?.() ||
            it.attachmentFilename ||
            it.title ||
            'Untitled';
          const cleanTitle = String(fallbackTitle).trim().replace(/\.[^.]+$/, '');
          result.push({
            id: it.id || 0,
            key: it.key || `KEY_${it.id || 0}`,
            title: cleanTitle || 'Untitled',
            authorText: 'Unknown Author',
            citationText: cleanTitle || 'Untitled',
            itemType: it.itemType || 'journalArticle',
            year: '',
            publicationTitle: '',
            notePreview: '',
            readStatus: 'unread',
            hasPdf: Boolean(it.isAttachment?.()),
            tags: [],
            colorTags: []
          });
        } catch {}
      }
    }

    return result;
  }
}
