import { PaperCardData } from '../../types';
import { SelectionModel } from './selection-model';

export interface KeyboardManagerOptions {
  onOpenPdf?: (item: PaperCardData) => void;
  onDeleteItem?: (items: PaperCardData[], forceTrash?: boolean) => void;
  onCopyCitation?: (items: PaperCardData[], asCitation?: boolean) => void;
  onToggleColorTag?: (item: PaperCardData, position: number, allSelected?: PaperCardData[]) => void;
}

export interface KeyboardManagerContext {
  container: HTMLElement;
  viewport: HTMLElement;
  selectionModel: SelectionModel;
  getItems: () => PaperCardData[];
  getCardElement: (id: number) => HTMLElement | undefined;
  moveFocus: (newIndex: number, extendSelection?: boolean) => void;
  updateSelectionClasses: () => void;
  notifySelection: () => void;
  options: KeyboardManagerOptions;
}

export class KeyboardManager {
  private context: KeyboardManagerContext;

  constructor(context: KeyboardManagerContext) {
    this.context = context;
  }

  public isEditableElement(el: any): boolean {
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

  public getColumnCount(container?: HTMLElement): number {
    const target = container || this.context.container;
    const containerWidth = target?.clientWidth || 800;
    let cardW = 180;
    try {
      const win =
        target?.ownerDocument?.defaultView ||
        (typeof getComputedStyle !== 'undefined' ? { getComputedStyle } : null);
      const style = win?.getComputedStyle?.(target);
      const gridTemplateCols =
        style?.getPropertyValue?.('grid-template-columns') || (style as any)?.gridTemplateColumns;
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
    return Math.max(1, Math.floor((containerWidth + 16) / cardWidth));
  }

  public getPageRowCount(): number {
    const viewportHeight = this.context.viewport?.clientHeight || 600;
    const items = this.context.getItems();
    const firstEl = items.length > 0 ? this.context.getCardElement(items[0].id) : undefined;
    const cardHeight = firstEl?.offsetHeight && firstEl.offsetHeight > 0 ? firstEl.offsetHeight : 280;
    const rowHeight = cardHeight + 16; // card height + grid gap
    return Math.max(1, Math.floor(viewportHeight / rowHeight));
  }

  private isQuickLookOpen(doc?: Document | null): boolean {
    const modal = doc?.getElementById?.('zotero-cover-grid-quick-look') as HTMLElement | null;
    return Boolean(modal && !modal.hidden && modal.style?.display !== 'none');
  }

  public handleDocumentKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (this.context.container && this.context.container.isConnected === false) return;
    const doc = this.context.container?.ownerDocument;
    if (this.isQuickLookOpen(doc)) return;
    const items = this.context.getItems();
    if (items.length === 0) return;

    // If event originated inside container/viewport, container listener already handled it
    const target = e.target as any;
    if (
      target &&
      (this.context.container?.contains?.(target) || this.context.viewport?.contains?.(target))
    ) {
      return;
    }

    // Do not intercept typing in inputs, search boxes, or editable fields
    if (this.isEditableElement(target) || this.isEditableElement(doc?.activeElement)) {
      return;
    }

    // Only active when the grid is visible
    const gridRoot = (this.context.container?.closest?.('#zotero-cover-grid') ||
      doc?.getElementById?.('zotero-cover-grid') ||
      this.context.viewport) as HTMLElement | null;
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

    const selectionModel = this.context.selectionModel;
    const hasSelectionOrFocus =
      selectionModel.selectedIds.size > 0 || selectionModel.focusedIndex >= 0;

    // 1. Forward Cmd/Ctrl + A (Select All) when grid is visible
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') {
      if (!inSidePane) {
        this.handleGridKeyDown(e);
      }
      return;
    }

    // 2. Forward Arrow / Home / End / PageUp / PageDown navigation keys to grid
    if (
      ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(
        e.key
      )
    ) {
      if (!inSidePane) {
        this.handleGridKeyDown(e);
      }
      return;
    }

    // 3. Forward Delete / Backspace when cards are selected/focused
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!inSidePane && hasSelectionOrFocus) {
        this.handleGridKeyDown(e);
      }
      return;
    }

    // 4. Forward Enter / Space to open PDF when a card is selected/focused (unless a button is focused)
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Space') {
      const tag = String(target?.tagName || '').toLowerCase();
      if (!inSidePane && tag !== 'button' && hasSelectionOrFocus) {
        this.handleGridKeyDown(e);
      }
      return;
    }

    // 5. Forward number tag keys (0-9) and Quick Copy (Cmd/Ctrl+C) when a card is selected/focused
    // Matches e.code (Digit0-9, Numpad0-9), e.key, or e.keyCode (48-57, 96-105) to support Korean/international IME layouts
    const isDigitKey =
      /^[0-9]$/.test(e.key) ||
      /^(?:Digit|Numpad)([0-9])$/.test(e.code) ||
      (typeof e.keyCode === 'number' &&
        ((e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 96 && e.keyCode <= 105)));
    if (isDigitKey && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (hasSelectionOrFocus || items.length > 0) {
        this.handleGridKeyDown(e);
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'c') {
      const sel = this.context.container?.ownerDocument?.defaultView?.getSelection?.();
      if (!sel || sel.isCollapsed) {
        if (hasSelectionOrFocus) {
          this.handleGridKeyDown(e);
        }
      }
      return;
    }

    // 6. Forward Escape key when multiple cards are selected to collapse multi-selection
    if (e.key === 'Escape') {
      if (!inSidePane && selectionModel.selectedIds.size > 1) {
        this.handleGridKeyDown(e);
      }
      return;
    }
  }

  public handleGridKeyDown(e: KeyboardEvent): void {
    const doc = this.context.container?.ownerDocument;
    if (this.isQuickLookOpen(doc)) return;
    const items = this.context.getItems();
    if (items.length === 0) return;

    const selectionModel = this.context.selectionModel;

    // Escape: Smart selection collapse (collapses multi-selection down to single focused item)
    if (e.key === 'Escape') {
      if (selectionModel.selectedIds.size > 1) {
        e.preventDefault();
        e.stopPropagation();
        const collapsed = selectionModel.collapseSelection(items);
        if (collapsed) {
          this.context.updateSelectionClasses();
          this.context.notifySelection();
        }
        return;
      }
    }

    // Cmd/Ctrl + A: Select all items in current grid
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      selectionModel.selectAll(items);
      this.context.updateSelectionClasses();
      this.context.notifySelection();
      return;
    }

    // Cmd/Ctrl + C: Quick Copy citation / bibliography to clipboard
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'c') {
      const targets = items.filter((it) => selectionModel.selectedIds.has(it.id));
      if (
        targets.length === 0 &&
        selectionModel.focusedIndex >= 0 &&
        items[selectionModel.focusedIndex]
      ) {
        targets.push(items[selectionModel.focusedIndex]);
      }
      if (targets.length > 0 && this.context.options.onCopyCitation) {
        e.preventDefault();
        e.stopPropagation();
        this.context.options.onCopyCitation(targets, e.shiftKey);
      }
      return;
    }

    const cols = this.getColumnCount(this.context.container);

    if (
      selectionModel.focusedIndex === -1 &&
      ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(
        e.key
      )
    ) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'End') {
        this.context.moveFocus(items.length - 1, e.shiftKey);
      } else if (e.key === 'PageDown') {
        const pageStep = this.getPageRowCount() * cols;
        this.context.moveFocus(Math.min(items.length - 1, pageStep), e.shiftKey);
      } else {
        this.context.moveFocus(0, e.shiftKey);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        this.context.moveFocus(selectionModel.focusedIndex + 1, e.shiftKey);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        this.context.moveFocus(selectionModel.focusedIndex - 1, e.shiftKey);
        break;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.context.moveFocus(selectionModel.focusedIndex + cols, e.shiftKey);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.context.moveFocus(selectionModel.focusedIndex - cols, e.shiftKey);
        break;
      case 'PageDown': {
        e.preventDefault();
        e.stopPropagation();
        const pageStep = this.getPageRowCount() * cols;
        this.context.moveFocus(selectionModel.focusedIndex + pageStep, e.shiftKey);
        break;
      }
      case 'PageUp': {
        e.preventDefault();
        e.stopPropagation();
        const pageStep = this.getPageRowCount() * cols;
        this.context.moveFocus(selectionModel.focusedIndex - pageStep, e.shiftKey);
        break;
      }
      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        this.context.moveFocus(0, e.shiftKey);
        break;
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        this.context.moveFocus(items.length - 1, e.shiftKey);
        break;
      case 'Enter':
      case ' ':
      case 'Space': {
        const keyTarget = e.target as HTMLElement | null;
        if (keyTarget?.closest?.('button, [data-stop-card-gesture="true"]')) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (selectionModel.focusedIndex >= 0 && items[selectionModel.focusedIndex]) {
          this.context.options.onOpenPdf?.(items[selectionModel.focusedIndex]);
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        e.stopPropagation();
        const selected = items.filter((it) => selectionModel.selectedIds.has(it.id));
        if (
          selected.length === 0 &&
          selectionModel.focusedIndex >= 0 &&
          items[selectionModel.focusedIndex]
        ) {
          selected.push(items[selectionModel.focusedIndex]);
        }
        if (selected.length > 0) {
          const forceTrash = Boolean(e.metaKey || e.ctrlKey || e.shiftKey);
          if (forceTrash) {
            this.context.options.onDeleteItem?.(selected, true);
          } else {
            this.context.options.onDeleteItem?.(selected);
          }
        }
        break;
      }
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
      default: {
        const numMatch = /^(?:Digit|Numpad)([0-9])$/.exec(e.code) || /^([0-9])$/.exec(e.key);
        let pos = numMatch ? parseInt(numMatch[1] || numMatch[0], 10) : NaN;
        if (isNaN(pos) && typeof e.keyCode === 'number') {
          if (e.keyCode >= 48 && e.keyCode <= 57) pos = e.keyCode - 48;
          else if (e.keyCode >= 96 && e.keyCode <= 105) pos = e.keyCode - 96;
        }
        if (!isNaN(pos) && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          const targets = items.filter((it) => selectionModel.selectedIds.has(it.id));
          if (
            targets.length === 0 &&
            selectionModel.focusedIndex >= 0 &&
            items[selectionModel.focusedIndex]
          ) {
            targets.push(items[selectionModel.focusedIndex]);
          } else if (targets.length === 0 && items.length > 0) {
            targets.push(items[0]);
            selectionModel.selectSingle(0, items[0].id);
            this.context.updateSelectionClasses();
            this.context.notifySelection();
          }
          if (targets.length > 1) {
            this.context.options.onToggleColorTag?.(targets[0], pos, targets);
          } else if (targets.length === 1) {
            this.context.options.onToggleColorTag?.(targets[0], pos);
          }
          break;
        }
        break;
      }
    }
  }
}
