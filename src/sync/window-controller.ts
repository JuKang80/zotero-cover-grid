import { PaperCardData, ReadStatus } from '../types';
import { extractPaperCardData } from '../utils/apa-formatter';
import { VirtualGridScroller } from '../ui/virtual-scroller';
import { thumbnailCacheManager } from '../services/cache-manager';
import { updatePaperCardColorTags, updatePaperCardThumbnail } from '../ui/paper-card';

declare const Zotero: any;
declare const ZoteroPane: any;

export class WindowCoverGridController {
  private win: any;
  private observerId: string | null = null;
  private scroller: VirtualGridScroller | null = null;
  private abortController: AbortController | null = null;
  private searchDebounceTimer: any = null;
  private currentSearchQuery = '';
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

    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    if (zp?.itemsView?.onRefresh?.addListener) {
      this.refreshListener = () => {
        if (this.isDestroyed) return;
        return this.reloadCurrentCollection();
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

  private removeItems(ids: number[]) {
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
    if (!q) {
      this.filteredItems = [...this.allItems];
    } else {
      this.filteredItems = this.allItems.filter((it) => {
        return (
          it.title.toLowerCase().includes(q) ||
          it.authorText.toLowerCase().includes(q) ||
          it.citationText.toLowerCase().includes(q) ||
          (it.notePreview && it.notePreview.toLowerCase().includes(q))
        );
      });
    }
    this.scroller?.setItems(this.filteredItems);
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

      zItem.addTag?.(`#${nextStatus}`);
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

      const colors = typeof z.Tags.getColors === 'function' ? z.Tags.getColors(zItem.libraryID) : [];
      const targetColor = Array.isArray(colors) ? colors.find((c: any) => c.position === position) : null;
      if (!targetColor || !targetColor.tag) return;

      // 1. Instant local in-memory reflection for 0ms visual feedback
      if (!card.colorTags) card.colorTags = [];
      const hasColor = card.colorTags.some((c) => c.tag === targetColor.tag || c.color === targetColor.color);
      if (hasColor) {
        card.colorTags = card.colorTags.filter((c) => c.tag !== targetColor.tag && c.color !== targetColor.color);
      } else {
        card.colorTags.push({ tag: targetColor.tag, color: targetColor.color });
      }
      const cardEl = this.scroller?.getCardElement(card.id);
      if (cardEl) {
        updatePaperCardColorTags(cardEl, card.colorTags);
      }

      // 2. Persist to Zotero database with type 0 (manual user tag)
      if (typeof zItem.hasTag === 'function' && zItem.hasTag(targetColor.tag)) {
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
