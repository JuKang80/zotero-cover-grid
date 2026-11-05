import { PaperCardData, ReadStatus } from '../types';
import { extractPaperCardData } from '../utils/apa-formatter';
import { VirtualGridScroller } from '../ui/virtual-scroller';
import { thumbnailCacheManager } from '../services/cache-manager';

declare const Zotero: any;
declare const ZoteroPane: any;

export class WindowCoverGridController {
  private win: any;
  private observerId: string | null = null;
  private scroller: VirtualGridScroller | null = null;
  private abortController: AbortController | null = null;
  private searchDebounceTimer: any = null;
  private allItems: PaperCardData[] = [];
  private filteredItems: PaperCardData[] = [];
  private isDestroyed = false;
  private searchBoxCleanup: (() => void) | null = null;
  private refreshListener: (() => void) | null = null;
  public onCollectionChange?: (name: string) => void;

  constructor(win: any) {
    this.win = win;
  }

  public getCurrentCollectionName(): string {
    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    try {
      const cols = zp?.getSelectedCollections ? zp.getSelectedCollections() : (zp?.getSelectedCollection ? [zp.getSelectedCollection()] : []);
      if (Array.isArray(cols) && cols.length > 0 && cols[0]?.name) {
        return cols[0].name;
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

    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    if (zp?.itemsView?.onRefresh?.addListener) {
      this.refreshListener = () => {
        if (this.isDestroyed) return;
        this.reloadCurrentCollection();
      };
      zp.itemsView.onRefresh.addListener(this.refreshListener);
    }

    // Auto-refresh when collection row is clicked in left collection tree
    const doc = this.win?.document;
    if (doc) {
      const colTree = doc.getElementById('zotero-collections-tree');
      if (colTree) {
        colTree.addEventListener('click', () => {
          if (this.isDestroyed) return;
          setTimeout(() => this.reloadCurrentCollection(), 80);
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
      const tabId = String(ids[0]);
      if (tabId === 'zotero-cover-grid-tab') {
        this.reloadCurrentCollection();
      }
      return;
    }

    if (type === 'collection') {
      this.reloadCurrentCollection();
      return;
    }

    const numIds = ids.map(Number);

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

  private patchItems(ids: number[]) {
    if (typeof Zotero === 'undefined' || !Zotero.Items) return;
    const idSet = new Set(ids);

    for (let i = 0; i < this.allItems.length; i++) {
      if (idSet.has(this.allItems[i].id)) {
        try {
          const zItem = Zotero.Items.get(this.allItems[i].id);
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

  private removeItems(ids: number[]) {
    const idSet = new Set(ids);
    this.allItems = this.allItems.filter((it) => !idSet.has(it.id));
    this.applyFilter();
  }

  public async reloadCurrentCollection() {
    // 0. Await Zotero lifecycle readiness (database unlock and UI readiness)
    const zObj = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (zObj) {
      const waitPromises: Promise<any>[] = [];
      if (zObj.initializationPromise) waitPromises.push(zObj.initializationPromise);
      if (zObj.unlockPromise) waitPromises.push(zObj.unlockPromise);
      if (zObj.uiReadyPromise) waitPromises.push(zObj.uiReadyPromise);
      if (waitPromises.length > 0) {
        try {
          await Promise.all(waitPromises);
        } catch {
          // Ignore
        }
      }
    }

    // 1. Abort previous pending thumbnails and flush queue
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

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
      // Step A: Priority 1 - Selected collection row or direct collection items
      const selectedCols = zp?.getSelectedCollections ? zp.getSelectedCollections() : (zp?.getSelectedCollection ? [zp.getSelectedCollection()] : []);
      const selectedCol = Array.isArray(selectedCols) && selectedCols.length > 0 ? selectedCols[0] : null;
      if (selectedCol) {
        // Try getChildItems(true) - Passing true returns numeric item IDs without throwing UnloadedDataException
        if (typeof selectedCol.getChildItems === 'function') {
          try {
            const colItemsOrIDs = selectedCol.getChildItems(true);
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
        if (rawItems == null && z?.Search) {
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

      // Step B: Priority 2 - Native collectionTreeRow.getItems()
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

      // Step C: Priority 3 - Native itemsView or getSortedItems
      if (rawItems == null) {
        if (typeof zp?.itemsView?.getSortedItems === 'function') {
          try {
            const treeItems = zp.itemsView.getSortedItems();
            if (Array.isArray(treeItems)) {
              rawItems = treeItems;
            }
          } catch {
            // Fall through
          }
        } else if (typeof zp?.getSortedItems === 'function') {
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
                  const cItems = col.getChildItems(true);
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
        if (z?.Search && libraryID) {
          try {
            const s = new z.Search();
            s.libraryID = libraryID;
            s.addCondition('noChildren', 'true');
            const itemIDs = await s.search();
            if (Array.isArray(itemIDs) && itemIDs.length > 0) {
              rawItems = z.Items?.getAsync ? await z.Items.getAsync(itemIDs) : itemIDs;
            } else if (Array.isArray(itemIDs)) {
              rawItems = [];
            }
          } catch {
            // Fall through
          }
        }
        if (rawItems == null && z?.Items?.getAll) {
          try {
            const allRes = libraryID ? z.Items.getAll(libraryID, true, false) : z.Items.getAll();
            rawItems = allRes instanceof Promise ? await allRes : allRes;
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

    // Filter to valid displayable paper items (exclude notes, attachments, annotations)
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
      if (typeof it.isRegularItem === 'function') {
        return it.isRegularItem();
      }
      if (typeof it.isAttachment === 'function' && it.isAttachment()) return false;
      if (typeof it.isNote === 'function' && it.isNote()) return false;
      if (typeof it.isAnnotation === 'function' && it.isAnnotation()) return false;
      return true;
    });

    // Ensure item data is loaded safely
    if (validItems.length > 0) {
      if (z?.Items?.loadDataTypes) {
        try {
          await z.Items.loadDataTypes(validItems);
        } catch {
          // Ignore
        }
      }
      for (const it of validItems) {
        if (it && typeof it.loadDataType === 'function') {
          try {
            await it.loadDataType('primaryData');
          } catch {
            // Ignore
          }
        }
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
    if (typeof Zotero === 'undefined' || !Zotero.Items) return;
    try {
      let zItem: any = null;
      try {
        zItem = Zotero.Items.get(card.id);
      } catch {
        if (Zotero.Items.getAsync) {
          zItem = await Zotero.Items.getAsync(card.id);
        }
      }
      if (!zItem) return;
      const attachment = await zItem.getBestAttachment?.();
      if (signal.aborted) return;

      const url = await thumbnailCacheManager.getThumbnail(zItem, attachment, card);
      if (signal.aborted) return;

      card.coverThumbnailUrl = url;
      const cardEl = this.scroller?.getCardElement(card.id);
      if (cardEl) {
        const img = cardEl.querySelector('.card-cover-img') as HTMLImageElement;
        if (img) img.src = url;
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

  public handleSearchInput(query: string, fastPath = false) {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    const trimmed = query.trim().toLowerCase();

    // 0ms Fast-path on empty string
    if (fastPath || trimmed === '') {
      this.filteredItems = [...this.allItems];
      this.scroller?.setItems(this.filteredItems);
      return;
    }

    // 150ms Trailing-edge debounce
    this.searchDebounceTimer = setTimeout(() => {
      this.filteredItems = this.allItems.filter((it) => {
        return (
          it.title.toLowerCase().includes(trimmed) ||
          it.authorText.toLowerCase().includes(trimmed) ||
          it.citationText.toLowerCase().includes(trimmed)
        );
      });
      this.scroller?.setItems(this.filteredItems);
    }, 150);
  }

  public applyFilter() {
    this.filteredItems = [...this.allItems];
    this.scroller?.setItems(this.filteredItems);
  }

  public async syncTagStatus(card: PaperCardData, nextStatus: ReadStatus) {
    if (typeof Zotero === 'undefined' || !Zotero.Items) return;
    try {
      const zItem = Zotero.Items.get(card.id);
      if (!zItem) return;

      const readingTags = ['#unread', '#reading', '#read', 'unread', 'reading', 'read'];
      for (const t of readingTags) {
        if (zItem.hasTag?.(t)) {
          zItem.removeTag?.(t);
        }
      }

      zItem.addTag?.(`#${nextStatus}`);
      if (typeof zItem.saveTx === 'function') {
        await zItem.saveTx();
      }
    } catch {
      // Ignore
    }
  }

  public destroy() {
    this.isDestroyed = true;
    this.searchBoxCleanup?.();
    this.searchBoxCleanup = null;
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
