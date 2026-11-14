import { PaperCardData, ReadStatus } from '../types';
import { VirtualGridScroller } from '../ui/virtual-scroller';
import { thumbnailCacheManager } from '../services/cache-manager';
import { clearPdfSessionPool } from '../services/pdf-thumbnail-service';
import { updatePaperCardThumbnail, updatePaperCardPagePill } from '../ui/paper-card';
import { QuickLookModal } from '../ui/quick-look-modal';
import { openItemInZotero } from '../ui/item-actions';
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
  private activePreviewCard: PaperCardData | null = null;
  private activePreviewItemId: number | null = null;
  private activePreviewPage = 1;
  private activePreviewTotalPages = 0;
  private previewSeq = 0;
  private quickLookModal: QuickLookModal | null = null;
  private thumbnailBatchTimer: ReturnType<typeof setTimeout> | null = null;

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

  private clearThumbnailBatchTimer(): void {
    if (this.thumbnailBatchTimer !== null) {
      clearTimeout(this.thumbnailBatchTimer);
      this.thumbnailBatchTimer = null;
    }
  }

  public async reloadCurrentCollection(): Promise<void> {
    this.clearThumbnailBatchTimer();
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
    this.resetActiveCardPreview();
    this.quickLookModal?.close();

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

    const selectedAfterReload = this.scroller?.getSelectedItems?.() || [];
    if (selectedAfterReload.length === 1) {
      void this.handleSelectionChange(selectedAfterReload);
    }

    // Background thumbnail loading: kick off initial viewport items immediately,
    // and cooperatively stream large collections to avoid stalling on thousands of items.
    const total = this.allItems.length;
    const syncLimit = 150;
    const endSync = total < syncLimit ? total : syncLimit;
    for (let i = 0; i < endSync; i++) {
      if (signal.aborted) break;
      this.loadThumbnailForCard(this.allItems[i], signal);
    }
    if (total > syncLimit && !signal.aborted && !this.isDestroyed) {
      this.scheduleBackgroundThumbnailBatches(this.allItems, syncLimit, signal);
    }
  }

  private scheduleBackgroundThumbnailBatches(
    items: PaperCardData[],
    startIdx: number,
    signal: AbortSignal
  ): void {
    const batchSize = 150;
    let cursor = startIdx;
    const step = () => {
      this.thumbnailBatchTimer = null;
      if (this.isDestroyed || signal.aborted) return;
      const end = Math.min(cursor + batchSize, items.length);
      for (; cursor < end; cursor++) {
        if (signal.aborted) return;
        this.loadThumbnailForCard(items[cursor], signal);
      }
      if (cursor < items.length && !signal.aborted && !this.isDestroyed) {
        this.thumbnailBatchTimer = setTimeout(step, 0);
      }
    };
    this.thumbnailBatchTimer = setTimeout(step, 0);
  }

  private async resolvePdfAttachment(
    card: PaperCardData
  ): Promise<{ zItem: any; attachment: any; isPdf: boolean } | null> {
    if (card.itemType === 'note') {
      return null;
    }
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Items) return null;

    let zItem: any = null;
    try {
      zItem = z.Items.get(card.id);
    } catch {
      if (z.Items.getAsync) {
        zItem = await z.Items.getAsync(card.id);
      }
    }
    if (!zItem || typeof zItem !== 'object') {
      if (z.Items.getAsync) {
        try {
          zItem = await z.Items.getAsync(card.id);
        } catch {}
      }
    }
    if (!zItem) return null;

    let attachment: any = null;
    if (typeof zItem.isAttachment === 'function' && zItem.isAttachment()) {
      attachment = zItem;
    } else if (typeof zItem.getBestAttachment === 'function') {
      attachment = await zItem.getBestAttachment();
    }
    if (!attachment) {
      return { zItem, attachment: null, isPdf: false };
    }

    if (typeof attachment.loadAllData === 'function') {
      try {
        await attachment.loadAllData();
      } catch {}
    }

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

    return { zItem, attachment, isPdf };
  }

  private async loadThumbnailForCard(card: PaperCardData, signal: AbortSignal): Promise<void> {
    if (card.itemType === 'note') {
      card.hasPdf = false;
      card.pdfResolved = true;
      return;
    }
    try {
      const resolved = await this.resolvePdfAttachment(card);
      if (!resolved || signal.aborted) return;

      const { zItem, attachment, isPdf } = resolved;
      card.hasPdf = Boolean(attachment && isPdf);
      card.pdfResolved = true;

      // Keep typographic book cover when no PDF attachment exists
      if (!attachment || !isPdf) return;

      const url = await thumbnailCacheManager.getThumbnail(zItem, attachment, card);
      if (signal.aborted) return;

      card.coverThumbnailUrl = url;
      const cardEl = this.scroller?.getCardElement(card.id);
      if (cardEl && !(this.activePreviewItemId === card.id && this.activePreviewPage > 1)) {
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
    if (this.activePreviewItemId !== null) {
      const activeMatch = this.filteredItems.find((it) => it.id === this.activePreviewItemId);
      if (!activeMatch) {
        this.quickLookModal?.close();
        this.resetActiveCardPreview();
      } else {
        this.activePreviewCard = activeMatch;
      }
    }
    this.scroller?.setItems(this.filteredItems);
  }

  public resetActiveCardPreview(): void {
    this.previewSeq++;
    const prevId = this.activePreviewItemId;
    const prevCard = this.activePreviewCard;
    if (prevId !== null) {
      const prevEl = this.scroller?.getCardElement(prevId);
      if (prevEl) {
        updatePaperCardPagePill(prevEl, { visible: false, currentPage: 1, totalPages: 0 });
        if (this.activePreviewPage > 1 && prevCard?.coverThumbnailUrl) {
          if (!thumbnailCacheManager.isUrlRevoked(prevCard.coverThumbnailUrl)) {
            updatePaperCardThumbnail(prevEl, prevCard.coverThumbnailUrl);
          } else if (this.abortController && !this.abortController.signal.aborted && !this.isDestroyed) {
            void this.loadThumbnailForCard(prevCard, this.abortController.signal);
          }
        }
      }
    }
    this.activePreviewItemId = null;
    this.activePreviewCard = null;
    this.activePreviewPage = 1;
    this.activePreviewTotalPages = 0;
  }

  public async handleSelectionChange(selectedItems: PaperCardData[]): Promise<void> {
    if (this.isDestroyed) return;

    if (!Array.isArray(selectedItems) || selectedItems.length !== 1) {
      this.resetActiveCardPreview();
      return;
    }

    const card = selectedItems[0];
    if (this.activePreviewItemId === card.id && this.activePreviewTotalPages > 0) {
      const cardEl = this.scroller?.getCardElement(card.id);
      if (cardEl) {
        updatePaperCardPagePill(cardEl, {
          visible: true,
          currentPage: this.activePreviewPage,
          totalPages: this.activePreviewTotalPages
        });
      }
      return;
    }

    // Switching to a different single card resets any previous card back to page 1 immediately
    this.resetActiveCardPreview();

    if (card.itemType === 'note' || (card.hasPdf === false && card.pdfResolved !== false)) {
      return;
    }

    const seq = ++this.previewSeq;
    this.activePreviewItemId = card.id;
    this.activePreviewCard = card;
    this.activePreviewPage = 1;
    this.activePreviewTotalPages = 0;

    try {
      const resolved = await this.resolvePdfAttachment(card);
      if (this.isDestroyed || seq !== this.previewSeq || this.activePreviewItemId !== card.id) {
        return;
      }
      if (!resolved || !resolved.attachment || !resolved.isPdf) {
        card.hasPdf = false;
        card.pdfResolved = true;
        this.resetActiveCardPreview();
        return;
      }
      card.hasPdf = true;
      card.pdfResolved = true;

      const info = await thumbnailCacheManager.getPdfPageCount(resolved.zItem, resolved.attachment);
      if (this.isDestroyed || seq !== this.previewSeq || this.activePreviewItemId !== card.id) {
        return;
      }

      if (info.totalPages > 0) {
        this.activePreviewTotalPages = info.totalPages;
        const cardEl = this.scroller?.getCardElement(card.id);
        if (cardEl) {
          updatePaperCardPagePill(cardEl, {
            visible: true,
            currentPage: this.activePreviewPage,
            totalPages: info.totalPages
          });
        }
      }
    } catch {
      // Non-fatal: pill remains hidden if page info cannot be resolved
    }
  }

  public async flipCardPage(card: PaperCardData, direction: -1 | 1): Promise<void> {
    if (this.isDestroyed || card.itemType === 'note' || (card.hasPdf === false && card.pdfResolved !== false)) {
      return;
    }

    if (this.activePreviewItemId !== card.id) {
      await this.handleSelectionChange([card]);
      if (this.isDestroyed || this.activePreviewItemId !== card.id) return;
    }

    const total = this.activePreviewTotalPages;
    if (total <= 1) return;

    const prevPage = this.activePreviewPage;
    const nextPage = Math.min(total, Math.max(1, prevPage + direction));
    if (nextPage === prevPage) return;

    const seq = ++this.previewSeq;
    this.activePreviewPage = nextPage;

    const cardEl = this.scroller?.getCardElement(card.id);
    if (cardEl) {
      updatePaperCardPagePill(cardEl, {
        visible: true,
        currentPage: nextPage,
        totalPages: total,
        loading: true
      });
    }

    try {
      const resolved = await this.resolvePdfAttachment(card);
      if (this.isDestroyed || seq !== this.previewSeq || this.activePreviewItemId !== card.id) return;
      if (!resolved || !resolved.attachment || !resolved.isPdf) {
        this.activePreviewPage = prevPage;
        card.hasPdf = false;
        card.pdfResolved = true;
        this.resetActiveCardPreview();
        return;
      }

      const res = await thumbnailCacheManager.getPageThumbnail(
        resolved.zItem,
        resolved.attachment,
        nextPage,
        card
      );
      if (this.isDestroyed || seq !== this.previewSeq || this.activePreviewItemId !== card.id) return;

      if (res.totalPages > 0) {
        this.activePreviewTotalPages = res.totalPages;
      }
      const targetEl = this.scroller?.getCardElement(card.id);
      if (targetEl) {
        // Keep card.coverThumbnailUrl untouched as Page 1 for instant reset
        updatePaperCardThumbnail(targetEl, res.url);
        updatePaperCardPagePill(targetEl, {
          visible: true,
          currentPage: this.activePreviewPage,
          totalPages: this.activePreviewTotalPages || total,
          loading: false
        });
      }
    } catch {
      if (seq === this.previewSeq && this.activePreviewItemId === card.id) {
        this.activePreviewPage = prevPage;
        const targetEl = this.scroller?.getCardElement(card.id);
        if (targetEl) {
          updatePaperCardPagePill(targetEl, {
            visible: true,
            currentPage: prevPage,
            totalPages: this.activePreviewTotalPages || total,
            loading: false
          });
        }
      }
    }
  }

  public async openQuickLook(card: PaperCardData): Promise<void> {
    if (this.isDestroyed || card.itemType === 'note' || (card.hasPdf === false && card.pdfResolved !== false)) {
      return;
    }

    if (this.activePreviewItemId !== card.id) {
      await this.handleSelectionChange([card]);
      if (this.isDestroyed || this.activePreviewItemId !== card.id) return;
    }

    const openSeq = this.previewSeq;
    const resolved = await this.resolvePdfAttachment(card);
    if (this.isDestroyed || openSeq !== this.previewSeq || this.activePreviewItemId !== card.id) return;
    if (!resolved || !resolved.attachment || !resolved.isPdf) return;

    const pageInfo = await thumbnailCacheManager.getPdfPageCount(resolved.zItem, resolved.attachment);
    if (this.isDestroyed || openSeq !== this.previewSeq || this.activePreviewItemId !== card.id) return;
    const totalPages = pageInfo.totalPages || this.activePreviewTotalPages || 1;
    const initialPage = this.activePreviewItemId === card.id ? this.activePreviewPage : 1;

    if (!this.quickLookModal) {
      this.quickLookModal = new QuickLookModal(this.win);
    }

    await this.quickLookModal.open({
      card,
      initialPage,
      totalPages,
      pageOffset: pageInfo.pageOffset,
      onRenderPage: async (_c, pageNum) => {
        return await thumbnailCacheManager.renderHighResPage(
          resolved.zItem,
          resolved.attachment,
          pageNum,
          card
        );
      },
      onPageChange: (_c, pageNum) => {
        if (!this.isDestroyed && this.activePreviewItemId === card.id) {
          const pageSeq = ++this.previewSeq;
          this.activePreviewPage = pageNum;
          const cardEl = this.scroller?.getCardElement(card.id);
          if (cardEl) {
            updatePaperCardPagePill(cardEl, {
              visible: true,
              currentPage: pageNum,
              totalPages: this.activePreviewTotalPages || totalPages
            });
            void thumbnailCacheManager
              .getPageThumbnail(resolved.zItem, resolved.attachment, pageNum, card)
              .then((res) => {
                if (
                  !this.isDestroyed &&
                  pageSeq === this.previewSeq &&
                  this.activePreviewItemId === card.id &&
                  this.activePreviewPage === pageNum
                ) {
                  const el = this.scroller?.getCardElement(card.id);
                  if (el) updatePaperCardThumbnail(el, res.url);
                }
              })
              .catch(() => {});
          }
        }
      },
      onOpenInTab: (_c, actualPageNumber) => {
        void openItemInZotero(this.win, card.id, Math.max(0, actualPageNumber - 1));
      }
    });
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

  public async toggleColorTag(card: PaperCardData | PaperCardData[], position: number): Promise<void> {
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
    this.clearThumbnailBatchTimer();
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
    this.resetActiveCardPreview();
    this.quickLookModal?.destroy();
    this.quickLookModal = null;
    void clearPdfSessionPool();
    this.treeDnD.destroy();
    this.filterEngine.destroy();
    this.notifierHandler.destroy();
    this.scroller?.destroy();
    this.scroller = null;
    this.allItems = [];
    this.filteredItems = [];
  }
}
