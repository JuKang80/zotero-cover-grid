import { PaperCardData, ReadStatus } from '../types';
import {
  createPaperCardElement,
  updatePaperCardMetadata,
  updatePaperCardBadge,
  updatePaperCardThumbnail,
  updatePaperCardColorTags,
  isMacEnvironment
} from './paper-card';
import { SelectionModel } from './scroller/selection-model';
import { KeyboardManager } from './scroller/keyboard-manager';
import { ScrollAnchorTracker } from './scroller/scroll-anchor';

export { SelectionModel } from './scroller/selection-model';
export { KeyboardManager } from './scroller/keyboard-manager';
export { ScrollAnchorTracker } from './scroller/scroll-anchor';

export interface VirtualScrollerOptions {
  container: HTMLElement;
  viewport: HTMLElement;
  onSelect?: (selectedItems: PaperCardData[]) => void;
  onOpenPdf?: (item: PaperCardData) => void;
  onDeleteItem?: (items: PaperCardData[], forceTrash?: boolean) => void;
  onCopyCitation?: (items: PaperCardData[], asCitation?: boolean) => void;
  onStatusChange?: (item: PaperCardData, nextStatus: ReadStatus) => void;
  onToggleColorTag?: (item: PaperCardData, position: number) => void;
  onContextMenu?: (item: PaperCardData, event: MouseEvent) => void;
}

export class VirtualGridScroller {
  private container: HTMLElement;
  private viewport: HTMLElement;
  private items: PaperCardData[] = [];
  private cardMap = new Map<number, HTMLElement>();
  private pendingScrollToSelected = false;
  private options: VirtualScrollerOptions;

  // Submodules
  public selectionModel: SelectionModel;
  public keyboardManager: KeyboardManager;
  public scrollAnchorTracker: ScrollAnchorTracker;

  private boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private boundDocKeyDown = (e: KeyboardEvent) => this.handleDocumentKeyDown(e);

  constructor(options: VirtualScrollerOptions) {
    this.container = options.container;
    this.viewport = options.viewport;
    this.options = options;

    this.selectionModel = new SelectionModel();
    this.scrollAnchorTracker = new ScrollAnchorTracker();
    this.keyboardManager = new KeyboardManager({
      container: this.container,
      viewport: this.viewport,
      selectionModel: this.selectionModel,
      getItems: () => this.items,
      getCardElement: (id) => this.cardMap.get(id),
      moveFocus: (newIndex, extendSelection) => this.moveFocus(newIndex, extendSelection),
      updateSelectionClasses: () => this.updateSelectionClasses(),
      notifySelection: () => this.notifySelection(),
      options: this.options
    });

    this.bindEvents();
  }

  // --- Backward compatibility getters & setters for tests and external callers ---
  public get focusedIndex(): number {
    return this.selectionModel.focusedIndex;
  }
  public set focusedIndex(val: number) {
    this.selectionModel.focusedIndex = val;
  }

  public get anchorIndex(): number {
    return this.selectionModel.anchorIndex;
  }
  public set anchorIndex(val: number) {
    this.selectionModel.anchorIndex = val;
  }

  public get selectedIds(): Set<number> {
    return this.selectionModel.selectedIds;
  }
  public set selectedIds(val: Set<number>) {
    this.selectionModel.selectedIds = val;
  }

  public get prevSelectedIds(): Set<number> {
    return this.selectionModel.prevSelectedIds;
  }
  public set prevSelectedIds(val: Set<number>) {
    this.selectionModel.prevSelectedIds = val;
  }

  private bindEvents() {
    this.container.addEventListener('keydown', this.boundKeyDown);
    if (this.viewport && this.viewport !== this.container) {
      this.viewport.addEventListener('keydown', this.boundKeyDown);
    }
    const doc = this.container?.ownerDocument;
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('keydown', this.boundDocKeyDown);
    }
  }

  private isEditableElement(el: any): boolean {
    return this.keyboardManager.isEditableElement(el);
  }

  private handleDocumentKeyDown(e: KeyboardEvent) {
    this.keyboardManager.handleDocumentKeyDown(e);
  }

  public setItems(newItems: PaperCardData[]) {
    // 1. Scroll Anchoring Pre-calculation
    const anchor = this.findTopVisibleItem();
    const oldAnchorOffset = anchor ? this.getItemOffset(anchor.id) : 0;

    this.items = [...newItems];

    // 2. Stable Keying: Update or Create DOM cards
    const newIdSet = new Set(this.items.map((it) => it.id));

    // Remove deleted items
    for (const [id, el] of this.cardMap.entries()) {
      if (!newIdSet.has(id)) {
        el.remove();
        this.cardMap.delete(id);
        this.selectedIds.delete(id);
      }
    }

    // Append/Update current items
    const doc =
      this.container.ownerDocument ||
      (typeof document !== 'undefined'
        ? document
        : (typeof (globalThis as any).Zotero !== 'undefined'
            ? (globalThis as any).Zotero.getMainWindow?.()?.document
            : null));
    const HTML_NS = 'http://www.w3.org/1999/xhtml';
    if (this.items.length === 0) {
      this.selectionModel.reconcileAfterMutation(this.items, this.cardMap);
      if (!this.container.querySelector('.grid-empty-placeholder')) {
        const emptyEl = doc.createElementNS(HTML_NS, 'div');
        emptyEl.className = 'grid-empty-placeholder';
        emptyEl.textContent = '표시할 항목이 없습니다. (No items to display)';
        this.container.appendChild(emptyEl);
      }
      return;
    }
    this.container.querySelector('.grid-empty-placeholder')?.remove();

    this.selectionModel.reconcileAfterMutation(this.items, this.cardMap);

    for (let i = 0; i < this.items.length; i++) {
      const card = this.items[i];
      let cardEl = this.cardMap.get(card.id);

      if (!cardEl) {
        cardEl = createPaperCardElement(
          card,
          {
            onClick: (c, e) => {
              const curIdx = this.items.findIndex((it) => it.id === c.id);
              this.handleCardClick(c, curIdx !== -1 ? curIdx : 0, e);
            },
            onDoubleClick: (c) => this.options.onOpenPdf?.(c),
            onContextMenu: (c, e) => {
              if (!this.selectedIds.has(c.id)) {
                const curIdx = this.items.findIndex((it) => it.id === c.id);
                this.selectionModel.selectSingle(curIdx !== -1 ? curIdx : 0, c.id);
                this.updateSelectionClasses();
                this.notifySelection();
              }
              this.options.onContextMenu?.(c, e);
            },
            onStatusChange: (c, s) => this.options.onStatusChange?.(c, s),
            onDragStart: (c, e) => {
              if (!this.selectedIds.has(c.id)) {
                const curIdx = this.items.findIndex((it) => it.id === c.id);
                this.selectionModel.selectSingle(curIdx !== -1 ? curIdx : 0, c.id);
                this.updateSelectionClasses();
                this.notifySelection();
              }
              const draggedItems = this.items.filter((it) => this.selectedIds.has(it.id));
              const dragIds = draggedItems.length > 0 ? draggedItems.map((it) => it.id) : [c.id];
              if (e.dataTransfer) {
                try {
                  e.dataTransfer.effectAllowed = 'copyMove';
                  e.dataTransfer.setData('zotero/item', dragIds.join(','));
                  e.dataTransfer.setData(
                    'text/x-zotero-drag-item',
                    JSON.stringify({ itemIDs: dragIds })
                  );
                  const plainLines = (draggedItems.length > 0 ? draggedItems : [c]).map(
                    (it) => `${it.authorText} (${it.year || 'n.d.'}) - ${it.title}`
                  );
                  e.dataTransfer.setData('text/plain', plainLines.join('\n'));
                } catch {}
              }
            }
          },
          doc
        );
        this.cardMap.set(card.id, cardEl);
      } else {
        // Update mutable properties & metadata
        updatePaperCardMetadata(cardEl, card);
        updatePaperCardBadge(cardEl, card.readStatus);
        updatePaperCardColorTags(cardEl, card.colorTags);
        if (card.coverThumbnailUrl) {
          updatePaperCardThumbnail(cardEl, card.coverThumbnailUrl);
        }
      }

      // Ensure DOM ordering matches this.items sequence without detaching in-order nodes
      if (this.container.children[i] !== cardEl) {
        this.container.insertBefore(cardEl, this.container.children[i] || null);
      }

      // Re-apply selection state
      if (this.selectedIds.has(card.id)) {
        cardEl.classList.add('selected');
      } else {
        cardEl.classList.remove('selected');
      }
    }

    this.selectionModel.prevSelectedIds = new Set(this.selectedIds);

    // 3. Scroll Anchoring Restoration or Pending View-Switch Scroll Sync
    if (this.pendingScrollToSelected && this.selectedIds.size > 0) {
      this.pendingScrollToSelected = false;
      const firstSelectedId = Array.from(this.selectedIds)[0];
      const targetIdx = this.items.findIndex((it) => it.id === firstSelectedId);
      if (targetIdx !== -1) {
        this.focusedIndex = targetIdx;
        this.anchorIndex = targetIdx;
      }
      const targetEl = this.cardMap.get(firstSelectedId);
      if (targetEl) {
        try {
          targetEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          targetEl.focus({ preventScroll: true });
        } catch {
          targetEl.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        }
      }
      return;
    }

    this.scrollAnchorTracker.restoreAnchor(anchor, oldAnchorOffset, this.cardMap, this.viewport);
  }

  private findTopVisibleItem(): PaperCardData | null {
    return this.scrollAnchorTracker.findTopVisibleItem(this.items, this.cardMap, this.viewport);
  }

  private getItemOffset(id: number): number {
    return this.scrollAnchorTracker.getItemOffset(id, this.cardMap);
  }

  public handleCardClick(card: PaperCardData, index: number, event: MouseEvent) {
    // On macOS, Control + Click is a secondary (right) click when contextMenu handler is bound
    if (
      event.ctrlKey &&
      !event.metaKey &&
      this.options.onContextMenu &&
      isMacEnvironment(this.container?.ownerDocument)
    ) {
      if (!this.selectedIds.has(card.id)) {
        this.selectionModel.selectSingle(index, card.id);
        this.updateSelectionClasses();
        this.notifySelection();
      }
      this.options.onContextMenu(card, event);
      return;
    }

    this.selectionModel.handleCardClick(card, index, event, this.items);

    this.updateSelectionClasses();
    this.notifySelection();

    const el = this.cardMap.get(card.id);
    try {
      el?.focus({ preventScroll: true });
    } catch {
      el?.focus();
    }
  }

  private updateSelectionClasses() {
    this.selectionModel.updateSelectionClasses(this.cardMap);
  }

  private notifySelection() {
    const selected = this.items.filter((it) => this.selectedIds.has(it.id));
    this.options.onSelect?.(selected);
  }

  public handleKeyDown(e: KeyboardEvent) {
    this.keyboardManager.handleGridKeyDown(e);
  }

  private getColumnCount(): number {
    return this.keyboardManager.getColumnCount(this.container);
  }

  public moveFocus(newIndex: number, extendSelection = false) {
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= this.items.length) newIndex = this.items.length - 1;

    this.focusedIndex = newIndex;
    const item = this.items[newIndex];
    if (!item) return;

    if (extendSelection && this.anchorIndex >= 0) {
      this.selectionModel.selectRange(newIndex, this.items);
    } else {
      this.selectionModel.selectSingle(newIndex, item.id);
    }

    this.updateSelectionClasses();
    this.notifySelection();

    const el = this.cardMap.get(item.id);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  public setSelectedIds(
    ids: number[],
    options: { scrollIntoView?: boolean; notify?: boolean } = {}
  ) {
    const cleanIds = (ids || []).map(Number).filter((n) => !isNaN(n) && n > 0);
    this.selectionModel.setSelectedIds(cleanIds, this.items);

    if (cleanIds.length === 0) {
      this.pendingScrollToSelected = false;
      this.updateSelectionClasses();
      if (options.notify) {
        this.notifySelection();
      }
      return;
    }

    if (options.scrollIntoView && cleanIds.length > 0) {
      this.pendingScrollToSelected = true;
    }

    if (this.items.length > 0 && cleanIds.length > 0) {
      this.updateSelectionClasses();
      if (options.scrollIntoView) {
        const targetEl = this.cardMap.get(cleanIds[0]);
        if (targetEl) {
          this.pendingScrollToSelected = false;
          try {
            targetEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            targetEl.focus({ preventScroll: true });
          } catch {
            targetEl.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          }
        }
      }
      if (options.notify) {
        this.notifySelection();
      }
    }
  }

  public getSelectedIds(): number[] {
    return this.selectionModel.getSelectedIds();
  }

  public getSelectedItems(): PaperCardData[] {
    return this.selectionModel.getSelectedItems(this.items);
  }

  public getCardElement(id: number): HTMLElement | undefined {
    return this.cardMap.get(id);
  }

  public destroy() {
    this.container.removeEventListener('keydown', this.boundKeyDown);
    if (this.viewport && this.viewport !== this.container) {
      this.viewport.removeEventListener('keydown', this.boundKeyDown);
    }
    const doc = this.container?.ownerDocument;
    if (doc && typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('keydown', this.boundDocKeyDown);
    }
    this.cardMap.clear();
    this.selectionModel.clear();
    this.items = [];
    this.container.innerHTML = '';
  }
}
