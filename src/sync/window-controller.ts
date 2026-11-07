import { PaperCardData, ReadStatus } from '../types';
import { extractPaperCardData, extractReadStatusFromTags } from '../utils/apa-formatter';
import { VirtualGridScroller } from '../ui/virtual-scroller';
import { thumbnailCacheManager } from '../services/cache-manager';
import { updatePaperCardBadge, updatePaperCardColorTags, updatePaperCardThumbnail } from '../ui/paper-card';

declare const Zotero: any;
declare const ZoteroPane: any;

export class WindowCoverGridController {
  private win: any;
  private observerId: string | null = null;
  private scroller: VirtualGridScroller | null = null;
  private abortController: AbortController | null = null;
  private searchDebounceTimer: any = null;
  private currentSearchQuery = '';
  private selectedFilterTags = new Set<string>();
  private allItems: PaperCardData[] = [];
  private filteredItems: PaperCardData[] = [];
  private isDestroyed = false;
  private searchBoxCleanup: (() => void) | null = null;
  private tagSelectorCleanup: (() => void) | null = null;
  private refreshListener: (() => void) | null = null;
  public onCollectionChange?: (name: string) => void;

  constructor(win: any) {
    this.win = win;
  }

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

  public init(scroller: VirtualGridScroller) {
    this.scroller = scroller;
    this.registerNotifier();
    this.bindSearchBox();
    this.bindTagSelector();

    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    if (zp?.itemsView?.onRefresh?.addListener) {
      this.refreshListener = () => {
        if (this.isDestroyed) return;
        return this.reloadCurrentCollection();
      };
      zp.itemsView.onRefresh.addListener(this.refreshListener);
    }

    // Auto-refresh when collection row is clicked or items are dropped in left collection tree
    const doc = this.win?.document;
    if (doc) {
      const colTree = doc.getElementById('zotero-collections-tree');
      if (colTree) {
        colTree.addEventListener('click', () => {
          if (this.isDestroyed) return;
          setTimeout(() => this.reloadCurrentCollection(), 80);
        });
        colTree.addEventListener('dragover', (e: any) => {
          if (this.isDestroyed) return;
          if (
            e.dataTransfer?.types?.includes?.('zotero/item') ||
            e.dataTransfer?.types?.includes?.('text/x-zotero-drag-item')
          ) {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          }
        });
        colTree.addEventListener('drop', async (e: any) => {
          if (this.isDestroyed) return;
          try {
            const rawJson = e.dataTransfer?.getData?.('text/x-zotero-drag-item');
            const rawIds = e.dataTransfer?.getData?.('zotero/item');
            let itemIDs: number[] = [];
            if (rawJson) {
              const parsed = JSON.parse(rawJson);
              if (Array.isArray(parsed?.itemIDs)) itemIDs = parsed.itemIDs.map(Number).filter(Boolean);
            } else if (rawIds) {
              itemIDs = String(rawIds).split(',').map(Number).filter(Boolean);
            }
            if (itemIDs.length === 0) return;

            const targetEl = e.target as HTMLElement | null;
            const rowEl = targetEl?.closest?.(
              '[data-collection-id], [data-row-index], .virtualized-table-row, [role="treeitem"], [role="row"]'
            ) as HTMLElement | null;
            const colIdAttr =
              targetEl?.getAttribute?.('data-collection-id') ||
              rowEl?.getAttribute?.('data-collection-id');
            const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
            const zpRef = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
            let targetCol = colIdAttr && z?.Collections?.get ? z.Collections.get(Number(colIdAttr)) : null;

            // Fallback: Zotero 10 VirtualizedTable row index -> collectionsView.getRow(idx).ref
            if (!targetCol && zpRef?.collectionsView) {
              const cv = zpRef.collectionsView;
              let rowIdx = -1;
              const idxAttr = rowEl?.getAttribute?.('data-row-index') ?? rowEl?.getAttribute?.('aria-rowindex');
              if (idxAttr != null && !isNaN(Number(idxAttr))) {
                rowIdx = Number(idxAttr);
              } else if (typeof cv.tree?.getRowAtClientY === 'function' && typeof e.clientY === 'number') {
                rowIdx = cv.tree.getRowAtClientY(e.clientY);
              }
              if (rowIdx >= 0 && typeof cv.getRow === 'function') {
                const treeRow = cv.getRow(rowIdx);
                const candidate = treeRow?.ref || treeRow;
                if (candidate && (typeof candidate.addItems === 'function' || typeof candidate.addItem === 'function')) {
                  targetCol = candidate;
                } else if (candidate?.id && z?.Collections?.get) {
                  targetCol = z.Collections.get(Number(candidate.id));
                }
              }
            }

            if (!targetCol && typeof (colTree as any).onDrop === 'function') {
              (colTree as any).onDrop(e, itemIDs);
              return;
            }
            if (targetCol) {
              e.preventDefault?.();
              e.stopPropagation?.();
              if (typeof targetCol.addItems === 'function') {
                await targetCol.addItems(itemIDs);
              } else if (typeof targetCol.addItem === 'function') {
                for (const id of itemIDs) {
                  await targetCol.addItem(id);
                }
              }
              if (typeof targetCol.saveTx === 'function') {
                await targetCol.saveTx();
              }
            }
          } catch {}
        });
      }
    }
  }

  private registerNotifier() {
    if (typeof Zotero === 'undefined' || !Zotero.Notifier) return;

    const observer = {
      notify: (event: string, type: string, ids: string[] | number[], extraData: any) => {
        if (this.isDestroyed) return;
        this.handleNotifierEvent(event, type, ids, extraData);
      }
    };

    this.observerId = Zotero.Notifier.registerObserver(
      observer,
      ['item', 'item-tag', 'collection-item', 'collection', 'tab'],
      'ZoteroCoverGrid'
    );
  }

  public handleNotifierEvent(event: string, type: string, ids: string[] | number[], extraData: any) {
    if (type === 'tab' && event === 'select') {
      const tabId = Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : '';
      if (tabId === 'zotero-cover-grid-tab') {
        this.reloadCurrentCollection();
      }
      return;
    }

    if (type === 'collection') {
      this.reloadCurrentCollection();
      return;
    }

    const numIds = Array.isArray(ids) ? ids.map(Number) : (ids ? [Number(ids)] : []);

    if (type === 'item') {
      if (event === 'modify') {
        this.patchItems(numIds);
      } else if (event === 'delete') {
        this.removeItems(numIds);
      } else if (event === 'add') {
        this.reloadCurrentCollection();
      }
    } else if (type === 'item-tag') {
      this.patchItems(numIds);
    } else if (type === 'collection-item') {
      this.reloadCurrentCollection();
    }
  }

  private async patchItems(ids: number[]) {
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Items) return;
    const idSet = new Set(ids);

    for (let i = 0; i < this.allItems.length; i++) {
      if (idSet.has(this.allItems[i].id)) {
        try {
          let zItem: any = null;
          try {
            zItem = z.Items.get(this.allItems[i].id);
          } catch {
            if (z.Items.getAsync) {
              zItem = await z.Items.getAsync(this.allItems[i].id);
            }
          }
          if (zItem) {
            const prevThumbnailUrl = this.allItems[i].coverThumbnailUrl;
            const prevHasPdf = this.allItems[i].hasPdf;
            this.allItems[i] = extractPaperCardData(zItem);
            if (prevThumbnailUrl) {
              this.allItems[i].coverThumbnailUrl = prevThumbnailUrl;
            }
            this.allItems[i].hasPdf = prevHasPdf;
          }
        } catch {
          // Ignore
        }
      }
    }

    this.applyFilter();
  }

  public removeItems(ids: number[]) {
    const idSet = new Set(ids);
    this.allItems = this.allItems.filter((it) => !idSet.has(it.id));
    this.applyFilter();
  }

  public async reloadCurrentCollection() {
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

    // 1. Abort previous pending thumbnails and flush queue (safe for Cu.Sandbox where AbortController may be absent)
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // Ignore
      }
    }
    const AbortCtrl =
      this.win?.AbortController ||
      (typeof AbortController !== 'undefined' ? AbortController : null);
    let ctrl: AbortController | null = null;
    if (AbortCtrl) {
      try {
        ctrl = new AbortCtrl();
      } catch {
        // Ignore
      }
    }
    if (!ctrl) {
      ctrl = {
        signal: { aborted: false } as AbortSignal,
        abort() {
          (this.signal as any).aborted = true;
        }
      } as AbortController;
    }
    this.abortController = ctrl;
    const signal = ctrl.signal;

    // Notify collection name change if registered
    if (this.onCollectionChange) {
      try {
        this.onCollectionChange(this.getCurrentCollectionName());
      } catch {
        // Ignore
      }
    }

    // 2. Fetch items from current collection / ZoteroPane
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
    if (signal.aborted) return;

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

    if (signal.aborted) return;

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

    if (signal.aborted) return;

    try {
      this.allItems = validItems.map(extractPaperCardData);
    } catch {
      this.allItems = [];
    }

    this.applyFilter();

    // 3. Background thumbnail loading with abort check
    for (const card of this.allItems) {
      if (signal.aborted) break;
      this.loadThumbnailForCard(card, signal);
    }
  }

  private async loadThumbnailForCard(card: PaperCardData, signal: AbortSignal) {
    if (card.itemType === 'note') {
      card.hasPdf = false;
      return;
    }
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Items) return;
    try {
      let zItem: any = null;
      try {
        zItem = z.Items.get(card.id);
      } catch {
        if (z.Items.getAsync) {
          zItem = await z.Items.getAsync(card.id);
        }
      }
      if (!zItem) return;
      const attachment = await zItem.getBestAttachment?.();
      if (signal.aborted) return;

      card.hasPdf = Boolean(attachment);

      // Keep the rich DOM typographic book cover when no PDF attachment exists
      if (!attachment) {
        return;
      }

      const url = await thumbnailCacheManager.getThumbnail(zItem, attachment, card);
      if (signal.aborted) return;

      card.coverThumbnailUrl = url;
      const cardEl = this.scroller?.getCardElement(card.id);
      if (cardEl) {
        updatePaperCardThumbnail(cardEl, url);
      }
    } catch {
      // Ignore background render failure
    }
  }

  public bindSearchBox() {
    const doc = this.win.document;
    if (!doc) return;
    const searchBox = (
      doc.getElementById('zotero-tb-search') ||
      doc.getElementById('zotero-search-box') ||
      doc.querySelector('quick-search-textbox')
    ) as any;
    if (!searchBox) return;

    const inputEl =
      searchBox.inputField ||
      searchBox.searchTextbox?.inputField ||
      searchBox.querySelector?.('input') ||
      doc.getElementById('zotero-tb-search-textbox')?.inputField ||
      searchBox;

    // Sync any pre-existing search query when binding
    try {
      const initialVal = (inputEl && 'value' in inputEl ? inputEl.value : searchBox?.value) || '';
      if (typeof initialVal === 'string' && initialVal.trim()) {
        this.currentSearchQuery = initialVal.trim().toLowerCase();
      }
    } catch {}

    const handleInput = (e: any) => {
      const query = (e.target as HTMLInputElement).value || '';
      this.handleSearchInput(query);
    };

    const handleKey = (e: any) => {
      if (e.key === 'Escape') {
        if ('value' in inputEl) inputEl.value = '';
        if (searchBox !== inputEl && 'value' in searchBox) searchBox.value = '';
        this.handleSearchInput('', true); // 0ms fast-path
      }
    };

    inputEl.addEventListener('input', handleInput);
    inputEl.addEventListener('keydown', handleKey);
    if (searchBox !== inputEl) {
      searchBox.addEventListener('command', handleInput);
      searchBox.addEventListener('input', handleInput);
      searchBox.addEventListener('keydown', handleKey);
    }

    this.searchBoxCleanup = () => {
      inputEl.removeEventListener('input', handleInput);
      inputEl.removeEventListener('keydown', handleKey);
      if (searchBox !== inputEl) {
        searchBox.removeEventListener('command', handleInput);
        searchBox.removeEventListener('input', handleInput);
        searchBox.removeEventListener('keydown', handleKey);
      }
    };
  }

  public bindTagSelector() {
    const doc = this.win?.document;
    if (!doc) return;
    const tagSelectorEl =
      doc.getElementById?.('zotero-tag-selector') ||
      doc.getElementById?.('zotero-tag-selector-container') ||
      doc.querySelector?.('tag-selector');
    if (!tagSelectorEl || typeof tagSelectorEl.addEventListener !== 'function') return;

    let tagTickTimer: any = null;
    const handleTagEvent = () => {
      if (this.isDestroyed) return;
      this.applyFilter();
      if (tagTickTimer) clearTimeout(tagTickTimer);
      tagTickTimer = setTimeout(() => {
        tagTickTimer = null;
        if (!this.isDestroyed) this.applyFilter();
      }, 0);
    };

    tagSelectorEl.addEventListener('click', handleTagEvent);
    tagSelectorEl.addEventListener('command', handleTagEvent);
    tagSelectorEl.addEventListener('select', handleTagEvent);
    tagSelectorEl.addEventListener('change', handleTagEvent);

    this.tagSelectorCleanup = () => {
      if (tagTickTimer) clearTimeout(tagTickTimer);
      tagSelectorEl.removeEventListener('click', handleTagEvent);
      tagSelectorEl.removeEventListener('command', handleTagEvent);
      tagSelectorEl.removeEventListener('select', handleTagEvent);
      tagSelectorEl.removeEventListener('change', handleTagEvent);
    };
  }

  public setSelectedFilterTags(tags: string[] | Set<string>) {
    this.selectedFilterTags = new Set(
      Array.from(tags || [])
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean)
    );
    this.applyFilter();
  }

  private getActiveFilterTags(): string[] {
    const result = new Set<string>(this.selectedFilterTags);
    try {
      const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      const doc = this.win?.document;
      const tagSelector: any =
        zp?.tagSelector ||
        doc?.getElementById?.('zotero-tag-selector') ||
        doc?.querySelector?.('tag-selector');

      if (tagSelector) {
        const rawSelected =
          tagSelector.selectedTags ||
          tagSelector.selection ||
          (typeof tagSelector.getSelectedTags === 'function' ? tagSelector.getSelectedTags() : null);
        if (rawSelected && typeof rawSelected[Symbol.iterator] === 'function') {
          for (const t of rawSelected) {
            const name = typeof t === 'string' ? t : t?.tag || t?.name;
            if (name) result.add(String(name).trim().toLowerCase());
          }
        }
        if (typeof tagSelector.querySelectorAll === 'function') {
          const selectedNodes = tagSelector.querySelectorAll(
            '.tag-selector-item.selected, [aria-selected="true"], .selected[data-tag]'
          );
          for (const node of Array.from(selectedNodes) as HTMLElement[]) {
            const tagVal = node.getAttribute?.('data-tag') || node.textContent;
            if (tagVal) result.add(String(tagVal).trim().toLowerCase());
          }
        }
      }
    } catch {}
    return Array.from(result);
  }

  public handleSearchInput(query: string, fastPath = false) {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    const trimmed = query.trim().toLowerCase();
    this.currentSearchQuery = trimmed;

    // 0ms Fast-path on empty string
    if (fastPath || trimmed === '') {
      this.applyFilter();
      return;
    }

    // 150ms Trailing-edge debounce
    this.searchDebounceTimer = setTimeout(() => {
      this.applyFilter();
    }, 150);
  }

  public applyFilter() {
    const q = this.currentSearchQuery;
    const activeTags = this.getActiveFilterTags();

    if (!q && activeTags.length === 0) {
      this.filteredItems = [...this.allItems];
    } else {
      this.filteredItems = this.allItems.filter((it) => {
        if (q) {
          const matchesQuery =
            it.title.toLowerCase().includes(q) ||
            it.authorText.toLowerCase().includes(q) ||
            it.citationText.toLowerCase().includes(q) ||
            (it.notePreview && it.notePreview.toLowerCase().includes(q));
          if (!matchesQuery) return false;
        }
        if (activeTags.length > 0) {
          const itemTagSet = new Set<string>([
            ...(it.tags || []).map((t) => t.toLowerCase()),
            ...(it.colorTags || []).map((c) => c.tag.toLowerCase())
          ]);
          for (const reqTag of activeTags) {
            if (!itemTagSet.has(reqTag)) return false;
          }
        }
        return true;
      });
    }
    this.scroller?.setItems(this.filteredItems);
  }

  private getNormalizedColorTags(libraryID?: number): Array<{ tag: string; color: string; position: number }> {
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Tags?.getColors) return [];
    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    const libId = libraryID || zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID || 1;
    try {
      const raw = z.Tags.getColors(libId);
      const list: Array<{ tag: string; color: string; position: number }> = [];
      if (!raw) return list;
      if (typeof raw.entries === 'function' && !Array.isArray(raw)) {
        for (const [tag, val] of raw.entries()) {
          if (typeof tag === 'string' && val && val.color) {
            list.push({ tag, color: val.color, position: Number(val.position ?? 0) });
          }
        }
      } else if (Array.isArray(raw)) {
        for (const c of raw) {
          if (c && c.tag && c.color) {
            list.push({ tag: c.tag, color: c.color, position: Number(c.position ?? 0) });
          }
        }
      } else if (typeof raw === 'object') {
        for (const [tag, val] of Object.entries(raw)) {
          if (val && (val as any).color) {
            list.push({ tag, color: (val as any).color, position: Number((val as any).position ?? 0) });
          }
        }
      }
      return list;
    } catch {
      return [];
    }
  }

  public async syncTagStatus(card: PaperCardData, nextStatus: ReadStatus) {
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Items) return;
    try {
      let zItem: any = null;
      try {
        zItem = z.Items.get(card.id);
      } catch {
        if (z.Items.getAsync) {
          zItem = await z.Items.getAsync(card.id);
        }
      }
      if (!zItem) return;

      const readingTags = ['#unread', '#reading', '#read', 'unread', 'reading', 'read'];
      for (const t of readingTags) {
        if (zItem.hasTag?.(t)) {
          zItem.removeTag?.(t);
        }
      }

      // If user has a colored tag configured for plain 'unread'/'reading'/'read', prefer that tag name so color dots stay synced
      const colorList = this.getNormalizedColorTags(zItem.libraryID);
      const plainColorMatch = colorList.find((c) => c.tag.toLowerCase() === nextStatus);
      const hashColorMatch = colorList.find((c) => c.tag.toLowerCase() === `#${nextStatus}`);
      const tagToAdd = hashColorMatch ? hashColorMatch.tag : plainColorMatch ? plainColorMatch.tag : `#${nextStatus}`;

      zItem.addTag?.(tagToAdd);
      card.readStatus = nextStatus;
      const readingTagSet = new Set(readingTags.map((t) => t.toLowerCase()));
      const nextTags = (card.tags || []).filter((t) => !readingTagSet.has(t.toLowerCase()));
      nextTags.push(tagToAdd);
      card.tags = nextTags;

      const cardEl = this.scroller?.getCardElement(card.id);
      if (cardEl) {
        updatePaperCardBadge(cardEl, nextStatus);
      }

      if (this.getActiveFilterTags().length > 0) {
        this.applyFilter();
      }

      if (typeof zItem.saveTx === 'function') {
        await zItem.saveTx();
      }
    } catch {
      // Ignore
    }
  }

  public async toggleColorTag(card: PaperCardData, position: number) {
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Items || !z?.Tags) return;
    try {
      let zItem: any = null;
      try {
        zItem = z.Items.get(card.id);
      } catch {
        if (z.Items.getAsync) {
          zItem = await z.Items.getAsync(card.id);
        }
      }
      if (!zItem) return;

      const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      const libId = zItem.libraryID || zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID || 1;
      const rawColors = typeof z.Tags.getColors === 'function' ? z.Tags.getColors(libId) : null;
      const colorList = this.getNormalizedColorTags(libId);

      // Position 0: Zotero shortcut '0' removes all colored tags from the item
      if (position === 0) {
        const toRemove = new Set<string>([
          ...(card.colorTags || []).map((c) => c.tag),
          ...colorList.map((c) => c.tag)
        ]);
        card.colorTags = [];
        for (const tagName of toRemove) {
          if (typeof zItem.hasTag === 'function' ? zItem.hasTag(tagName) : true) {
            zItem.removeTag?.(tagName);
          }
        }
        const remainingTags = (zItem.getTags?.() || []).filter((t: any) => {
          const name = typeof t === 'string' ? t : t?.tag;
          return name && !toRemove.has(name);
        });
        card.tags = (card.tags || []).filter((t) => !toRemove.has(t));
        card.readStatus = extractReadStatusFromTags(remainingTags);
        const cardEl = this.scroller?.getCardElement(card.id);
        if (cardEl) {
          updatePaperCardColorTags(cardEl, []);
          updatePaperCardBadge(cardEl, card.readStatus);
        }
        if (this.getActiveFilterTags().length > 0) {
          this.applyFilter();
        }
        if (typeof zItem.saveTx === 'function') {
          await zItem.saveTx();
        }
        return;
      }

      // Resolve target color for shortcut key 1..9
      // Zotero's native Tags.getColors() Map uses 0-based positions (0..8 for keys 1..9)
      const isMapLike = rawColors && typeof rawColors.entries === 'function' && !Array.isArray(rawColors);
      const hasZeroIndex = colorList.some((c) => c.position === 0);
      let targetColor: { tag: string; color: string; position: number } | undefined;

      if (isMapLike || hasZeroIndex) {
        targetColor =
          colorList.find((c) => c.position === position - 1) ||
          (!hasZeroIndex ? colorList.find((c) => c.position === position) : undefined);
      } else {
        targetColor =
          colorList.find((c) => c.position === position) ||
          colorList.find((c) => c.position === position - 1);
      }

      if (!targetColor && typeof z.Tags.getTagByPosition === 'function') {
        const tagByPos = z.Tags.getTagByPosition(libId, position - 1);
        const colorByPos = tagByPos && typeof z.Tags.getColor === 'function' ? z.Tags.getColor(libId, tagByPos) : null;
        if (tagByPos && colorByPos) {
          targetColor = { tag: tagByPos, color: colorByPos, position: position - 1 };
        }
      }

      if (!targetColor || !targetColor.tag) return;

      const existingItemTags: Array<{ tag: string } | string> = zItem.getTags?.() || [];
      const hadTagInZotero =
        (typeof zItem.hasTag === 'function' && zItem.hasTag(targetColor.tag)) ||
        existingItemTags.some((t: any) => (typeof t === 'string' ? t : t?.tag) === targetColor.tag);
      const hadColorOnCard = (card.colorTags || []).some(
        (c) => c.tag === targetColor.tag || c.color === targetColor!.color
      );
      const isRemoving = hadTagInZotero || hadColorOnCard;

      // 1. Instant local in-memory reflection for 0ms visual feedback
      if (!card.colorTags) card.colorTags = [];
      if (isRemoving) {
        card.colorTags = card.colorTags.filter(
          (c) => c.tag !== targetColor!.tag && c.color !== targetColor!.color
        );
      } else {
        card.colorTags.push({ tag: targetColor.tag, color: targetColor.color });
        const posMap = new Map(colorList.map((c) => [c.tag, c.position]));
        card.colorTags.sort((a, b) => (posMap.get(a.tag) ?? 99) - (posMap.get(b.tag) ?? 99));
      }

      // Compute updated tags to also keep readStatus badge and card.tags in sync
      const baseTagNames = Array.from(
        new Set([
          ...(card.tags || []),
          ...existingItemTags.map((t: any) => (typeof t === 'string' ? t : t?.tag)).filter(Boolean)
        ])
      );
      let updatedTagNames = baseTagNames;
      if (isRemoving) {
        updatedTagNames = updatedTagNames.filter((name) => name !== targetColor!.tag);
      } else if (!updatedTagNames.includes(targetColor.tag)) {
        updatedTagNames.push(targetColor.tag);
      }
      card.tags = updatedTagNames;
      card.readStatus = extractReadStatusFromTags(updatedTagNames);

      const cardEl = this.scroller?.getCardElement(card.id);
      if (cardEl) {
        updatePaperCardColorTags(cardEl, card.colorTags);
        updatePaperCardBadge(cardEl, card.readStatus);
      }

      if (this.getActiveFilterTags().length > 0) {
        this.applyFilter();
      }

      // 2. Persist to Zotero database with type 0 (manual user tag)
      if (isRemoving) {
        zItem.removeTag?.(targetColor.tag);
      } else {
        zItem.addTag?.(targetColor.tag, 0);
      }

      if (typeof zItem.saveTx === 'function') {
        await zItem.saveTx();
      }
    } catch {
      // Ignore
    }
  }

  public async regenerateCover(card: PaperCardData) {
    try {
      await thumbnailCacheManager.deleteThumbnail(card.key, '');
      const ctrl = this.abortController;
      if (ctrl) {
        await this.loadThumbnailForCard(card, ctrl.signal);
      }
    } catch {
      // Ignore
    }
  }

  public destroy() {
    this.isDestroyed = true;
    this.searchBoxCleanup?.();
    this.searchBoxCleanup = null;
    this.tagSelectorCleanup?.();
    this.tagSelectorCleanup = null;
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.refreshListener) {
      const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      if (zp?.itemsView?.onRefresh?.removeListener) {
        zp.itemsView.onRefresh.removeListener(this.refreshListener);
      }
      this.refreshListener = null;
    }
    if (this.observerId && typeof Zotero !== 'undefined' && Zotero.Notifier) {
      Zotero.Notifier.unregisterObserver(this.observerId);
      this.observerId = null;
    }
    this.scroller?.destroy();
    this.scroller = null;
    this.allItems = [];
    this.filteredItems = [];
  }
}
