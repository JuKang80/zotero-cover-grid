import { PaperCardData, ReadStatus } from '../types';
import {
  createPaperCardElement,
  updatePaperCardBadge,
  updatePaperCardThumbnail,
  updatePaperCardColorTags
} from './paper-card';

export interface VirtualScrollerOptions {
  container: HTMLElement;
  viewport: HTMLElement;
  onSelect?: (selectedItems: PaperCardData[]) => void;
  onOpenPdf?: (item: PaperCardData) => void;
  onDeleteItem?: (items: PaperCardData[]) => void;
  onStatusChange?: (item: PaperCardData, nextStatus: ReadStatus) => void;
  onToggleColorTag?: (item: PaperCardData, position: number) => void;
  onContextMenu?: (item: PaperCardData, event: MouseEvent) => void;
}

export class VirtualGridScroller {
  private container: HTMLElement;
  private viewport: HTMLElement;
  private items: PaperCardData[] = [];
  private cardMap = new Map<number, HTMLElement>();
  private selectedIds = new Set<number>();
  private prevSelectedIds = new Set<number>();
  private anchorIndex = 0;
  private focusedIndex = -1;
  private options: VirtualScrollerOptions;
  private boundKeyDown = this.handleKeyDown.bind(this);

  constructor(options: VirtualScrollerOptions) {
    this.container = options.container;
    this.viewport = options.viewport;
    this.options = options;

    this.bindEvents();
  }

  private bindEvents() {
    this.container.addEventListener('keydown', this.boundKeyDown);
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
        : (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero.getMainWindow?.()?.document : null));
    const HTML_NS = 'http://www.w3.org/1999/xhtml';
    if (this.items.length === 0) {
      this.focusedIndex = -1;
      this.anchorIndex = 0;
      if (!this.container.querySelector('.grid-empty-placeholder')) {
        const emptyEl = doc.createElementNS(HTML_NS, 'div');
        emptyEl.className = 'grid-empty-placeholder';
        emptyEl.textContent = '표시할 논문이 없습니다. (No items to display)';
        this.container.appendChild(emptyEl);
      }
      return;
    }
    this.container.querySelector('.grid-empty-placeholder')?.remove();

    if (this.focusedIndex >= this.items.length) {
      this.focusedIndex = -1;
    }
    if (this.anchorIndex >= this.items.length) {
      this.anchorIndex = Math.max(0, this.items.length - 1);
    }

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
            onContextMenu: (c, e) => this.options.onContextMenu?.(c, e),
            onStatusChange: (c, s) => this.options.onStatusChange?.(c, s)
          },
          doc
        );
        this.cardMap.set(card.id, cardEl);
      } else {
        // Update mutable properties
        updatePaperCardBadge(cardEl, card.readStatus);
        updatePaperCardColorTags(cardEl, card.colorTags);
        if (card.coverThumbnailUrl) {
          updatePaperCardThumbnail(cardEl, card.coverThumbnailUrl);
        }
      }

      // Ensure DOM ordering strictly matches this.items sequence
      this.container.appendChild(cardEl);

      // Re-apply selection state
      if (this.selectedIds.has(card.id)) {
        cardEl.classList.add('selected');
      } else {
        cardEl.classList.remove('selected');
      }
    }

    // 3. Scroll Anchoring Restoration
    if (anchor && this.cardMap.has(anchor.id)) {
      const newAnchorOffset = this.getItemOffset(anchor.id);
      const delta = newAnchorOffset - oldAnchorOffset;
      if (delta !== 0) {
        this.viewport.scrollTop += delta;
      }
    }
  }

  private findTopVisibleItem(): PaperCardData | null {
    if (this.items.length === 0) return null;
    const vpTop = this.viewport?.scrollTop || 0;
    for (const item of this.items) {
      const el = this.cardMap.get(item.id);
      if (el && el.offsetTop >= vpTop) {
        return item;
      }
    }
    return this.items[0] || null;
  }

  private getItemOffset(id: number): number {
    const el = this.cardMap.get(id);
    return el ? el.offsetTop : 0;
  }

  public handleCardClick(card: PaperCardData, index: number, event: MouseEvent) {
    if (event.metaKey || event.ctrlKey) {
      // Toggle single item selection
      if (this.selectedIds.has(card.id)) {
        this.selectedIds.delete(card.id);
      } else {
        this.selectedIds.add(card.id);
      }
      this.anchorIndex = index;
    } else if (event.shiftKey && this.anchorIndex >= 0) {
      // Range selection
      const start = Math.min(this.anchorIndex, index);
      const end = Math.max(this.anchorIndex, index);
      this.selectedIds.clear();
      for (let i = start; i <= end; i++) {
        if (this.items[i]) {
          this.selectedIds.add(this.items[i].id);
        }
      }
    } else {
      // Single selection
      this.selectedIds.clear();
      this.selectedIds.add(card.id);
      this.anchorIndex = index;
    }

    this.focusedIndex = index;
    this.updateSelectionClasses();
    this.notifySelection();
  }

  private updateSelectionClasses() {
    // High-performance O(1) differential DOM class update (zero reflow lag)
    for (const prevId of this.prevSelectedIds) {
      if (!this.selectedIds.has(prevId)) {
        this.cardMap.get(prevId)?.classList.remove('selected');
      }
    }
    for (const newId of this.selectedIds) {
      if (!this.prevSelectedIds.has(newId)) {
        this.cardMap.get(newId)?.classList.add('selected');
      }
    }
    this.prevSelectedIds = new Set(this.selectedIds);
  }

  private notifySelection() {
    const selected = this.items.filter((it) => this.selectedIds.has(it.id));
    this.options.onSelect?.(selected);
  }

  public handleKeyDown(e: KeyboardEvent) {
    if (this.items.length === 0) return;

    const cols = this.getColumnCount();

    if (this.focusedIndex === -1 && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      this.moveFocus(0);
      return;
    }

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        this.moveFocus(this.focusedIndex + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.moveFocus(this.focusedIndex - 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.moveFocus(this.focusedIndex + cols);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.moveFocus(this.focusedIndex - 1 * cols);
        break;
      case 'Enter':
      case ' ':
      case 'Space':
        e.preventDefault();
        if (this.focusedIndex >= 0 && this.items[this.focusedIndex]) {
          this.options.onOpenPdf?.(this.items[this.focusedIndex]);
        }
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        e.preventDefault();
        if (this.focusedIndex >= 0 && this.items[this.focusedIndex]) {
          const pos = parseInt(e.key, 10);
          this.options.onToggleColorTag?.(this.items[this.focusedIndex], pos);
        }
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        const selected = this.items.filter((it) => this.selectedIds.has(it.id));
        if (selected.length > 0) {
          this.options.onDeleteItem?.(selected);
        }
        break;
    }
  }

  private getColumnCount(): number {
    const containerWidth = this.container.clientWidth || 800;
    let cardW = 180;
    try {
      const win =
        this.container.ownerDocument?.defaultView ||
        (typeof getComputedStyle !== 'undefined' ? { getComputedStyle } : null);
      const customWidth = win?.getComputedStyle?.(this.container)?.getPropertyValue('--card-width');
      if (customWidth) {
        const parsed = parseInt(customWidth, 10);
        if (!isNaN(parsed) && parsed > 0) {
          cardW = parsed;
        }
      }
    } catch {
      // Ignore
    }
    const cardWidth = cardW + 16; // card width + gap
    return Math.max(1, Math.floor(containerWidth / cardWidth));
  }

  public moveFocus(newIndex: number) {
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= this.items.length) newIndex = this.items.length - 1;

    this.focusedIndex = newIndex;
    const item = this.items[newIndex];
    if (!item) return;

    this.selectedIds.clear();
    this.selectedIds.add(item.id);
    this.anchorIndex = newIndex;

    this.updateSelectionClasses();
    this.notifySelection();

    const el = this.cardMap.get(item.id);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  public getSelectedIds(): number[] {
    return Array.from(this.selectedIds);
  }

  public getCardElement(id: number): HTMLElement | undefined {
    return this.cardMap.get(id);
  }

  public destroy() {
    this.container.removeEventListener('keydown', this.boundKeyDown);
    this.cardMap.clear();
    this.selectedIds.clear();
    this.items = [];
    this.container.innerHTML = '';
  }
}
