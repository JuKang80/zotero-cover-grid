import { PaperCardData, ReadStatus } from '../types';
import {
  createPaperCardElement,
  updatePaperCardMetadata,
  updatePaperCardBadge,
  updatePaperCardThumbnail,
  updatePaperCardColorTags,
  isMacEnvironment
} from './paper-card';

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
  private selectedIds = new Set<number>();
  private prevSelectedIds = new Set<number>();
  private pendingScrollToSelected = false;
  private anchorIndex = 0;
  private focusedIndex = -1;
  private options: VirtualScrollerOptions;
  private boundKeyDown = this.handleKeyDown.bind(this);
  private boundDocKeyDown = this.handleDocumentKeyDown.bind(this);

  constructor(options: VirtualScrollerOptions) {
    this.container = options.container;
    this.viewport = options.viewport;
    this.options = options;

    this.bindEvents();
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
    if (!el || typeof el !== 'object') return false;
    const tag = String(el.tagName || el.nodeName || '').toLowerCase();
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      tag.includes('textbox') ||
      tag === 'editable-text'
    ) {
      return true;
    }
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
      return true;
    }
    return false;
  }

  private handleDocumentKeyDown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (this.items.length === 0) return;

    // If event originated inside container/viewport, container listener already handled it
    const target = e.target as any;
    if (target && (this.container.contains?.(target) || this.viewport?.contains?.(target))) {
      return;
    }

    // Do not intercept typing in inputs, search boxes, or editable fields
    const doc = this.container?.ownerDocument;
    if (this.isEditableElement(target) || this.isEditableElement(doc?.activeElement)) {
      return;
    }

    // Only active when the grid is visible
    const gridRoot = (this.container.closest?.('#zotero-cover-grid') ||
      doc?.getElementById?.('zotero-cover-grid') ||
      this.viewport) as HTMLElement | null;
    if (gridRoot && (gridRoot.hidden || gridRoot.style?.display === 'none')) {
      return;
    }
    const tabs = (doc?.defaultView as any)?.Zotero_Tabs;
    if (tabs?.selectedID && tabs.selectedID !== 'zotero-pane') {
      return;
    }

    // Do not intercept arrow/navigation keys when focus is inside left collection tree, tag selector, or item pane
    const inSidePane = Boolean(
      target?.closest?.('#zotero-collections-tree, #zotero-tag-selector, #zotero-item-pane')
    );

    // 1. Forward Cmd/Ctrl + A (Select All) when grid is visible
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') {
      if (!inSidePane) {
        this.handleKeyDown(e);
      }
      return;
    }

    // 2. Forward Arrow / Home / End navigation keys to grid
    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      if (!inSidePane) {
        this.handleKeyDown(e);
      }
      return;
    }

    // 3. Forward Delete / Backspace when cards are selected/focused
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!inSidePane && (this.selectedIds.size > 0 || this.focusedIndex >= 0)) {
        this.handleKeyDown(e);
      }
      return;
    }

    // 4. Forward Enter / Space to open PDF when a card is selected/focused (unless a button is focused)
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Space') {
      const tag = String(target?.tagName || '').toLowerCase();
      if (!inSidePane && tag !== 'button' && (this.selectedIds.size > 0 || this.focusedIndex >= 0)) {
        this.handleKeyDown(e);
      }
      return;
    }

    // 5. Forward number tag keys (0-9) and Quick Copy (Cmd/Ctrl+C) when a card is selected/focused
    if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (this.selectedIds.size > 0 || this.focusedIndex >= 0) {
        this.handleKeyDown(e);
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'c') {
      const sel = this.container?.ownerDocument?.defaultView?.getSelection?.();
      if (!sel || sel.isCollapsed) {
        if (this.selectedIds.size > 0 || this.focusedIndex >= 0) {
          this.handleKeyDown(e);
        }
      }
      return;
    }

    // 6. Forward Escape key when multiple cards are selected to collapse multi-selection
    if (e.key === 'Escape') {
      if (!inSidePane && this.selectedIds.size > 1) {
        this.handleKeyDown(e);
      }
      return;
    }
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
        emptyEl.textContent = '표시할 항목이 없습니다. (No items to display)';
        this.container.appendChild(emptyEl);
      }
      return;
    }
    this.container.querySelector('.grid-empty-placeholder')?.remove();

    if (this.selectedIds.size === 0) {
      this.focusedIndex = -1;
      this.anchorIndex = 0;
    } else {
      const firstSelectedId = Array.from(this.selectedIds)[0];
      const idx = this.items.findIndex((it) => it.id === firstSelectedId);
      if (idx !== -1) {
        if (
          this.focusedIndex < 0 ||
          this.focusedIndex >= this.items.length ||
          !this.selectedIds.has(this.items[this.focusedIndex]?.id)
        ) {
          this.focusedIndex = idx;
        }
        if (this.anchorIndex < 0 || this.anchorIndex >= this.items.length) {
          this.anchorIndex = idx;
        }
      } else {
        this.focusedIndex = -1;
        this.anchorIndex = 0;
      }
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
            onContextMenu: (c, e) => {
              if (!this.selectedIds.has(c.id)) {
                const curIdx = this.items.findIndex((it) => it.id === c.id);
                this.selectedIds.clear();
                this.selectedIds.add(c.id);
                this.focusedIndex = curIdx !== -1 ? curIdx : 0;
                this.anchorIndex = this.focusedIndex;
                this.updateSelectionClasses();
                this.notifySelection();
              }
              this.options.onContextMenu?.(c, e);
            },
            onStatusChange: (c, s) => this.options.onStatusChange?.(c, s),
            onDragStart: (c, e) => {
              if (!this.selectedIds.has(c.id)) {
                const curIdx = this.items.findIndex((it) => it.id === c.id);
                this.selectedIds.clear();
                this.selectedIds.add(c.id);
                this.focusedIndex = curIdx !== -1 ? curIdx : 0;
                this.anchorIndex = this.focusedIndex;
                this.updateSelectionClasses();
                this.notifySelection();
              }
              const draggedItems = this.items.filter((it) => this.selectedIds.has(it.id));
              const dragIds = draggedItems.length > 0 ? draggedItems.map((it) => it.id) : [c.id];
              if (e.dataTransfer) {
                try {
                  e.dataTransfer.effectAllowed = 'copyMove';
                  e.dataTransfer.setData('zotero/item', dragIds.join(','));
                  e.dataTransfer.setData('text/x-zotero-drag-item', JSON.stringify({ itemIDs: dragIds }));
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

    this.prevSelectedIds = new Set(this.selectedIds);

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
    // On macOS, Control + Click is a secondary (right) click when contextMenu handler is bound
    if (
      event.ctrlKey &&
      !event.metaKey &&
      this.options.onContextMenu &&
      isMacEnvironment(this.container?.ownerDocument)
    ) {
      if (!this.selectedIds.has(card.id)) {
        this.selectedIds.clear();
        this.selectedIds.add(card.id);
        this.focusedIndex = index;
        this.anchorIndex = index;
        this.updateSelectionClasses();
        this.notifySelection();
      }
      this.options.onContextMenu(card, event);
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      // Toggle single item selection
      if (this.selectedIds.has(card.id)) {
        this.selectedIds.delete(card.id);
        this.focusedIndex = this.selectedIds.size > 0 ? index : -1;
      } else {
        this.selectedIds.add(card.id);
        this.focusedIndex = index;
        this.anchorIndex = index;
      }
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
      this.focusedIndex = index;
    } else {
      // Single selection
      this.selectedIds.clear();
      this.selectedIds.add(card.id);
      this.anchorIndex = index;
      this.focusedIndex = index;
    }

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

    // Escape: Smart selection collapse (collapses multi-selection down to single focused item)
    if (e.key === 'Escape') {
      if (this.selectedIds.size > 1) {
        e.preventDefault();
        const keepId =
          this.focusedIndex >= 0 && this.items[this.focusedIndex]
            ? this.items[this.focusedIndex].id
            : Array.from(this.selectedIds)[0];
        this.selectedIds.clear();
        if (keepId != null) {
          this.selectedIds.add(keepId);
          const idx = this.items.findIndex((it) => it.id === keepId);
          if (idx !== -1) {
            this.focusedIndex = idx;
            this.anchorIndex = idx;
          }
        }
        this.updateSelectionClasses();
        this.notifySelection();
        return;
      }
    }

    // Cmd/Ctrl + A: Select all items in current grid
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.selectedIds.clear();
      for (const it of this.items) {
        this.selectedIds.add(it.id);
      }
      if (this.focusedIndex === -1 && this.items.length > 0) {
        this.focusedIndex = 0;
        this.anchorIndex = 0;
      }
      this.updateSelectionClasses();
      this.notifySelection();
      return;
    }

    // Cmd/Ctrl + C: Quick Copy citation / bibliography to clipboard
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'c') {
      const targets = this.items.filter((it) => this.selectedIds.has(it.id));
      if (targets.length === 0 && this.focusedIndex >= 0 && this.items[this.focusedIndex]) {
        targets.push(this.items[this.focusedIndex]);
      }
      if (targets.length > 0 && this.options.onCopyCitation) {
        e.preventDefault();
        this.options.onCopyCitation(targets, e.shiftKey);
      }
      return;
    }

    const cols = this.getColumnCount();

    if (this.focusedIndex === -1 && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      this.moveFocus(e.key === 'End' ? this.items.length - 1 : 0, e.shiftKey);
      return;
    }

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        this.moveFocus(this.focusedIndex + 1, e.shiftKey);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.moveFocus(this.focusedIndex - 1, e.shiftKey);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.moveFocus(this.focusedIndex + cols, e.shiftKey);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.moveFocus(this.focusedIndex - 1 * cols, e.shiftKey);
        break;
      case 'Home':
        e.preventDefault();
        this.moveFocus(0, e.shiftKey);
        break;
      case 'End':
        e.preventDefault();
        this.moveFocus(this.items.length - 1, e.shiftKey);
        break;
      case 'Enter':
      case ' ':
      case 'Space':
        e.preventDefault();
        if (this.focusedIndex >= 0 && this.items[this.focusedIndex]) {
          this.options.onOpenPdf?.(this.items[this.focusedIndex]);
        }
        break;
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9': {
        if (e.metaKey || e.ctrlKey || e.altKey) break;
        e.preventDefault();
        const pos = parseInt(e.key, 10);
        const targets = this.items.filter((it) => this.selectedIds.has(it.id));
        if (targets.length === 0 && this.focusedIndex >= 0 && this.items[this.focusedIndex]) {
          targets.push(this.items[this.focusedIndex]);
        }
        for (const target of targets) {
          this.options.onToggleColorTag?.(target, pos);
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        const selected = this.items.filter((it) => this.selectedIds.has(it.id));
        if (selected.length === 0 && this.focusedIndex >= 0 && this.items[this.focusedIndex]) {
          selected.push(this.items[this.focusedIndex]);
        }
        if (selected.length > 0) {
          const forceTrash = Boolean(e.metaKey || e.ctrlKey || e.shiftKey);
          if (forceTrash) {
            this.options.onDeleteItem?.(selected, true);
          } else {
            this.options.onDeleteItem?.(selected);
          }
        }
        break;
      }
    }
  }

  private getColumnCount(): number {
    const containerWidth = this.container.clientWidth || 800;
    let cardW = 180;
    try {
      const win =
        this.container.ownerDocument?.defaultView ||
        (typeof getComputedStyle !== 'undefined' ? { getComputedStyle } : null);
      const style = win?.getComputedStyle?.(this.container);
      const gridTemplateCols = style?.getPropertyValue?.('grid-template-columns') || (style as any)?.gridTemplateColumns;
      if (gridTemplateCols && typeof gridTemplateCols === 'string' && gridTemplateCols.includes('px')) {
        const tracks = gridTemplateCols.trim().split(/\s+/).filter((t) => t.endsWith('px'));
        if (tracks.length > 0) {
          return tracks.length;
        }
      }
      const customWidth = style?.getPropertyValue?.('--card-width');
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

  public moveFocus(newIndex: number, extendSelection = false) {
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= this.items.length) newIndex = this.items.length - 1;

    this.focusedIndex = newIndex;
    const item = this.items[newIndex];
    if (!item) return;

    if (extendSelection && this.anchorIndex >= 0) {
      const start = Math.min(this.anchorIndex, newIndex);
      const end = Math.max(this.anchorIndex, newIndex);
      this.selectedIds.clear();
      for (let i = start; i <= end; i++) {
        if (this.items[i]) {
          this.selectedIds.add(this.items[i].id);
        }
      }
    } else {
      this.selectedIds.clear();
      this.selectedIds.add(item.id);
      this.anchorIndex = newIndex;
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
    this.selectedIds = new Set(cleanIds);

    if (cleanIds.length === 0) {
      this.pendingScrollToSelected = false;
      this.focusedIndex = -1;
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
      const firstIdx = this.items.findIndex((it) => it.id === cleanIds[0]);
      if (firstIdx !== -1) {
        this.focusedIndex = firstIdx;
        this.anchorIndex = firstIdx;
      }
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
    return Array.from(this.selectedIds);
  }

  public getSelectedItems(): PaperCardData[] {
    return this.items.filter((it) => this.selectedIds.has(it.id));
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
    this.selectedIds.clear();
    this.items = [];
    this.container.innerHTML = '';
  }
}
