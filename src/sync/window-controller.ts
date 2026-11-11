import { PaperCardData, ReadStatus } from '../types';
import { VirtualGridScroller } from '../ui/virtual-scroller';
import { thumbnailCacheManager } from '../services/cache-manager';
import { updatePaperCardThumbnail } from '../ui/paper-card';
import { CollectionFetcher } from './collection/collection-fetcher';
import { CollectionTreeDnD } from './collection/collection-tree-dnd';
import { FilterEngine } from './filter/filter-engine';
import { TagColorSync } from './tags/tag-color-sync';
import { NotifierHandler } from './notifier/notifier-handler';

declare const Zotero: any;
declare const ZoteroPane: any;

export class WindowCoverGridController {
  private win: any;
  public scroller: VirtualGridScroller | null = null;
  public abortController: AbortController | null = null;
  public allItems: PaperCardData[] = [];
  public filteredItems: PaperCardData[] = [];
  public onCollectionChange?: (name: string) => void;

  public fetcher: CollectionFetcher;
  public treeDnD: CollectionTreeDnD;
  public filterEngine: FilterEngine;
  public tagColorSync: TagColorSync;
  public notifierHandler: NotifierHandler;

  private isDestroyed = false;
  private refreshListener: (() => void) | null = null;

  constructor(win: any) {
    this.win = win;
    this.fetcher = new CollectionFetcher(win);
    this.treeDnD = new CollectionTreeDnD(win, () => this.reloadCurrentCollection());
    this.filterEngine = new FilterEngine(win, () => this.applyFilter());
    this.tagColorSync = new TagColorSync(win, (id) => this.scroller?.getCardElement(id));
    this.notifierHandler = new NotifierHandler({
      win,
      getAllItems: () => this.allItems,
      setAllItems: (items) => { this.allItems = items; },
      onReload: () => this.reloadCurrentCollection(),
      onFilter: () => this.applyFilter()
    });
  }

  public getCurrentCollectionName(): string {
    return this.fetcher.getCurrentCollectionName();
  }

  public init(scroller: VirtualGridScroller): void {
    this.scroller = scroller;
    this.notifierHandler.register();
    this.filterEngine.bindSearchBox();
    this.filterEngine.bindTagSelector();
    this.treeDnD.bind();

    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    if (zp?.itemsView?.onRefresh?.addListener) {
      this.refreshListener = () => {
        if (this.isDestroyed) return;
        return this.reloadCurrentCollection();
      };
      zp.itemsView.onRefresh.addListener(this.refreshListener);
    }
  }

  public async reloadCurrentCollection(): Promise<void> {
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

    if (this.onCollectionChange) {
      try {
        this.onCollectionChange(this.getCurrentCollectionName());
      } catch {
        // Ignore
      }
    }

    const items = await this.fetcher.fetchCollectionItems(signal);
    if (signal.aborted) return;

    this.allItems = items;
    this.applyFilter();

    // Background thumbnail loading with abort check
    for (const card of this.allItems) {
      if (signal.aborted) break;
      this.loadThumbnailForCard(card, signal);
    }
  }

  private async loadThumbnailForCard(card: PaperCardData, signal: AbortSignal): Promise<void> {
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

      // Regular items resolve via getBestAttachment; standalone PDF attachments are themselves the attachment
      let attachment: any = null;
      if (typeof zItem.isAttachment === 'function' && zItem.isAttachment()) {
        attachment = zItem;
      } else if (typeof zItem.getBestAttachment === 'function') {
        attachment = await zItem.getBestAttachment();
      }

      if (attachment && typeof attachment.loadAllData === 'function') {
        try {
          await attachment.loadAllData();
        } catch {}
      }

      if (signal.aborted) return;

      let filenameOrPath = '';
      try {
        filenameOrPath = String(
          attachment?.attachmentFilename ||
          attachment?.attachmentPath ||
          ''
        ).toLowerCase();
      } catch {
        try {
          filenameOrPath = String(attachment?.attachmentPath || '').toLowerCase();
        } catch {}
      }
      const contentType = String(attachment?.attachmentContentType || '').toLowerCase();
      const isExplicitNonPdf =
        Boolean(
          attachment?.isSnapshotAttachment?.() ||
          attachment?.isEPUBAttachment?.() ||
          attachment?.isImageAttachment?.() ||
          attachment?.isVideoAttachment?.() ||
          attachment?.attachmentLinkMode === 3 // LINK_MODE_LINKED_URL
        ) ||
        contentType.includes('html') ||
        contentType.includes('epub') ||
        contentType.startsWith('image/') ||
        contentType.startsWith('video/') ||
        /\.(html?|epub|png|jpe?g|gif|webp|svg|mp4|mov|docx?|xlsx?|pptx?|txt|md|csv|zip)$/i.test(filenameOrPath);

      const isFileAtt =
        typeof attachment?.isFileAttachment === 'function'
          ? attachment.isFileAttachment()
          : Boolean(attachment);

      const isPdf = Boolean(
        attachment &&
        (attachment?.isPDFAttachment?.() ||
          contentType.includes('pdf') ||
          filenameOrPath.endsWith('.pdf') ||
          (isFileAtt && !isExplicitNonPdf))
      );

      card.hasPdf = Boolean(attachment && isPdf);

      // Keep typographic book cover when no PDF attachment exists
      if (!attachment || !isPdf) return;

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

  public bindSearchBox(): void {
    this.filterEngine.bindSearchBox();
  }

  public bindTagSelector(): void {
    this.filterEngine.bindTagSelector();
  }

  public setSelectedFilterTags(tags: string[] | Set<string>): void {
    this.filterEngine.setSelectedFilterTags(tags);
  }

  public handleSearchInput(query: string, fastPath = false): void {
    this.filterEngine.handleSearchInput(query, fastPath);
  }

  public applyFilter(): void {
    this.filteredItems = this.filterEngine.filterItems(this.allItems);
    this.scroller?.setItems(this.filteredItems);
  }

  public handleNotifierEvent(event: string, type: string, ids: string[] | number[], extraData: any): void {
    this.notifierHandler.handleNotifierEvent(event, type, ids, extraData);
  }

  public async patchItems(ids: number[]): Promise<void> {
    await this.notifierHandler.patchItems(ids);
  }

  public removeItems(ids: number[]): void {
    this.notifierHandler.removeItems(ids);
  }

  public getNormalizedColorTags(libraryID?: number) {
    return this.tagColorSync.getNormalizedColorTags(libraryID);
  }

  public getActiveFilterTags(): string[] {
    return this.filterEngine.getActiveFilterTags();
  }

  public async syncTagStatus(card: PaperCardData, nextStatus: ReadStatus): Promise<void> {
    await this.tagColorSync.syncTagStatus(card, nextStatus);
    if (this.filterEngine.getActiveFilterTags().length > 0) {
      this.applyFilter();
    }
  }

  public async toggleColorTag(card: PaperCardData, position: number): Promise<void> {
    await this.tagColorSync.toggleColorTag(card, position);
    if (this.filterEngine.getActiveFilterTags().length > 0) {
      this.applyFilter();
    }
  }

  public async regenerateCover(card: PaperCardData): Promise<void> {
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

  public destroy(): void {
    this.isDestroyed = true;
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
    this.treeDnD.destroy();
    this.filterEngine.destroy();
    this.notifierHandler.destroy();
    this.scroller?.destroy();
    this.scroller = null;
    this.allItems = [];
    this.filteredItems = [];
  }
}
