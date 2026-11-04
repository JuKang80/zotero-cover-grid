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

  constructor(win: any) {
    this.win = win;
  }

  public init(scroller: VirtualGridScroller) {
    this.scroller = scroller;
    this.registerNotifier();
    this.bindSearchBox();
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
            this.allItems[i] = extractPaperCardData(zItem);
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

    // 2. Fetch items from current collection / ZoteroPane
    let rawItems: any[] = [];
    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    if (zp?.itemsView?.rowProvider?.items) {
      rawItems = zp.itemsView.rowProvider.items;
    }

    this.allItems = rawItems.map(extractPaperCardData);
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
    const searchBox = doc.getElementById('zotero-search-box') as HTMLInputElement;
    if (!searchBox) return;

    searchBox.addEventListener('input', (e: Event) => {
      const query = (e.target as HTMLInputElement).value || '';
      this.handleSearchInput(query);
    });

    searchBox.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        searchBox.value = '';
        this.handleSearchInput('', true); // 0ms fast-path
      }
    });
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

      const readingTags = ['#unread', '#reading', '#read'];
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
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this.abortController) {
      this.abortController.abort();
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
