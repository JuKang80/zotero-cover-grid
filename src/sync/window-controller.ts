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
      const col = zp?.getSelectedCollection?.();
      if (col?.name) return col.name;

      const cols = zp?.getSelectedCollections?.();
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
      ['item', 'item-tag', 'collection-item'],
      'ZoteroCoverGrid'
    );
  }

  public handleNotifierEvent(event: string, type: string, ids: string[] | number[], extraData: any) {
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
      // Step A: Priority 1 - Explicitly selected collection in sidebar
      const selectedCol = zp?.getSelectedCollection?.();
      if (selectedCol) {
        try {
          if (typeof selectedCol.loadDataType === 'function') {
            await selectedCol.loadDataType('childItems');
          }
        } catch {
          // Ignore if already loaded or in test mock
        }
        if (typeof selectedCol.getChildItems === 'function') {
          const colItems = selectedCol.getChildItems();
          if (Array.isArray(colItems)) {
            rawItems = colItems;
          }
        }
      }

      // Step B: If no collection selected, check multiple selected collections
      if (rawItems == null) {
        const selectedCols = zp?.getSelectedCollections?.();
        if (Array.isArray(selectedCols) && selectedCols.length > 0) {
          const itemsMap = new Map<number, any>();
          for (const col of selectedCols) {
            if (col) {
              try {
                if (typeof col.loadDataType === 'function') {
                  await col.loadDataType('childItems');
                }
              } catch {
                // Ignore
              }
              if (typeof col.getChildItems === 'function') {
                for (const it of col.getChildItems()) {
                  if (it && it.id) itemsMap.set(it.id, it);
                }
              }
            }
          }
          rawItems = Array.from(itemsMap.values());
        }
      }

      // Step C: Priority 2 - Check saved search (Smart Collection)
      if (rawItems == null) {
        const savedSearch = zp?.getSelectedSavedSearch?.();
        if (savedSearch && typeof savedSearch.search === 'function') {
          const searchItemIDs = await savedSearch.search(true);
          if (Array.isArray(searchItemIDs) && z?.Items) {
            rawItems = z.Items.get(searchItemIDs);
          }
        }
      }

      // Step D: Priority 3 - Native itemsView or rowProvider
      if (rawItems == null) {
        if (typeof zp?.itemsView?.getSortedItems === 'function') {
          const treeItems = zp.itemsView.getSortedItems();
          if (Array.isArray(treeItems)) {
            rawItems = treeItems;
          }
        } else if (typeof zp?.getSortedItems === 'function') {
          const sorted = zp.getSortedItems();
          if (Array.isArray(sorted)) {
            rawItems = sorted;
          }
        } else if (typeof zp?.getUnfilteredItems === 'function') {
          rawItems = await zp.getUnfilteredItems();
        } else if (zp?.itemsView?.rowProvider?.items) {
          rawItems = zp.itemsView.rowProvider.items;
        }
      }

      // Step E: Priority 4 - Library root fallback
      // ONLY when rawItems is strictly null or undefined (e.g. root library view where no collection/itemsView exists)
      if (rawItems == null) {
        const libraryID = zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID;
        if (z?.Items?.getAll) {
          const allRes = z.Items.getAll(libraryID, false, false);
          rawItems = allRes instanceof Promise ? await allRes : allRes;
        }
      }
    } catch {
      // Fallback to Zotero.Items.getAll() on unexpected error ONLY if rawItems == null
      if (rawItems == null && z?.Items?.getAll) {
        try {
          const allRes = z.Items.getAll();
          rawItems = allRes instanceof Promise ? await allRes : allRes;
        } catch {
          // Ignore
        }
      }
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

    // Filter to valid displayable paper items (exclude notes, attachments, annotations)
    const validItems = (rawItems || []).map((it: any) => {
      if (typeof it === 'number' || typeof it === 'string') {
        return z?.Items ? z.Items.get(it) : null;
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

    this.allItems = validItems.map(extractPaperCardData);
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
      const zItem = Zotero.Items.get(card.id);
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
