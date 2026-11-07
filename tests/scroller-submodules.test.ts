import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SelectionModel } from '../src/ui/scroller/selection-model';
import { KeyboardManager } from '../src/ui/scroller/keyboard-manager';
import { ScrollAnchorTracker } from '../src/ui/scroller/scroll-anchor';
import { PaperCardData } from '../src/types';

describe('Scroller Submodules Unit Tests', () => {
  const mockItems: PaperCardData[] = [
    {
      id: 1,
      key: 'K1',
      title: 'Item 1',
      authorText: 'Author 1',
      citationText: 'Author 1 (2021)',
      itemType: 'journalArticle',
      year: '2021',
      readStatus: 'unread',
      hasPdf: true
    },
    {
      id: 2,
      key: 'K2',
      title: 'Item 2',
      authorText: 'Author 2',
      citationText: 'Author 2 (2022)',
      itemType: 'journalArticle',
      year: '2022',
      readStatus: 'unread',
      hasPdf: true
    },
    {
      id: 3,
      key: 'K3',
      title: 'Item 3',
      authorText: 'Author 3',
      citationText: 'Author 3 (2023)',
      itemType: 'journalArticle',
      year: '2023',
      readStatus: 'unread',
      hasPdf: true
    }
  ];

  describe('SelectionModel', () => {
    let model: SelectionModel;

    beforeEach(() => {
      model = new SelectionModel();
    });

    it('handles single selection, toggle, and range selection correctly', () => {
      // Single selection
      model.selectSingle(0, 1);
      expect(model.getSelectedIds()).toEqual([1]);
      expect(model.focusedIndex).toBe(0);
      expect(model.anchorIndex).toBe(0);

      // Toggle selection (Ctrl/Cmd)
      model.toggleItem(1, 2);
      expect(model.getSelectedIds()).toEqual([1, 2]);
      expect(model.anchorIndex).toBe(1);

      // Range selection (Shift) reset anchor to 0 first
      model.anchorIndex = 0;
      model.selectRange(2, mockItems);
      expect(model.getSelectedIds()).toEqual([1, 2, 3]);
      expect(model.focusedIndex).toBe(2);

      // Select All
      model.selectAll(mockItems);
      expect(model.getSelectedIds()).toEqual([1, 2, 3]);

      // Escape collapse selection
      model.focusedIndex = 1;
      const collapsed = model.collapseSelection(mockItems);
      expect(collapsed).toBe(true);
      expect(model.getSelectedIds()).toEqual([2]);
    });

    it('performs differential DOM class updates', () => {
      const cardMap = new Map<number, HTMLElement>();
      const el1 = document.createElement('div');
      const el2 = document.createElement('div');
      cardMap.set(1, el1);
      cardMap.set(2, el2);

      model.selectSingle(0, 1);
      model.updateSelectionClasses(cardMap);
      expect(el1.classList.contains('selected')).toBe(true);
      expect(el2.classList.contains('selected')).toBe(false);

      model.selectSingle(1, 2);
      model.updateSelectionClasses(cardMap);
      expect(el1.classList.contains('selected')).toBe(false);
      expect(el2.classList.contains('selected')).toBe(true);
    });
  });

  describe('KeyboardManager', () => {
    let container: HTMLElement;
    let viewport: HTMLElement;
    let selectionModel: SelectionModel;
    let manager: KeyboardManager;
    let moveFocusMock: any;
    let onOpenPdfMock: any;

    beforeEach(() => {
      container = document.createElement('div');
      viewport = document.createElement('div');
      selectionModel = new SelectionModel();
      moveFocusMock = vi.fn();
      onOpenPdfMock = vi.fn();

      manager = new KeyboardManager({
        container,
        viewport,
        selectionModel,
        getItems: () => mockItems,
        getCardElement: () => undefined,
        moveFocus: moveFocusMock,
        updateSelectionClasses: vi.fn(),
        notifySelection: vi.fn(),
        options: {
          onOpenPdf: onOpenPdfMock
        }
      });
    });

    it('detects editable elements correctly', () => {
      expect(manager.isEditableElement(document.createElement('input'))).toBe(true);
      expect(manager.isEditableElement(document.createElement('textarea'))).toBe(true);
      expect(manager.isEditableElement(document.createElement('div'))).toBe(false);

      const contentEditable = document.createElement('div');
      contentEditable.setAttribute('contenteditable', 'true');
      expect(manager.isEditableElement(contentEditable)).toBe(true);
    });

    it('forwards arrow keys to moveFocus', () => {
      selectionModel.focusedIndex = 0;
      manager.handleGridKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(moveFocusMock).toHaveBeenCalledWith(1, false);

      manager.handleGridKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(onOpenPdfMock).toHaveBeenCalledWith(mockItems[0]);
    });
  });

  describe('ScrollAnchorTracker', () => {
    it('finds top visible item and restores anchor on delta shift', () => {
      const tracker = new ScrollAnchorTracker();
      const viewport = document.createElement('div');
      viewport.scrollTop = 150;

      const cardMap = new Map<number, HTMLElement>();
      const el1 = document.createElement('div');
      const el2 = document.createElement('div');
      let el2Offset = 200;
      Object.defineProperty(el1, 'offsetTop', { value: 0, configurable: true });
      Object.defineProperty(el2, 'offsetTop', { get: () => el2Offset, configurable: true });
      cardMap.set(1, el1);
      cardMap.set(2, el2);

      const topItem = tracker.findTopVisibleItem(mockItems, cardMap, viewport);
      expect(topItem?.id).toBe(2);

      // Offset shift
      el2Offset = 350;
      tracker.restoreAnchor(topItem, 200, cardMap, viewport);
      expect(viewport.scrollTop).toBe(300); // 150 + (350 - 200)
    });
  });
});
