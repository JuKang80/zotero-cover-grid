import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractNativeSelectedIds,
  extractGridSelectedIds,
  syncListToGrid,
  syncGridToList
} from '../src/ui/toolbar/view-state-sync';

describe('view-state-sync', () => {
  let mockWin: any;

  beforeEach(() => {
    mockWin = {
      ZoteroPane: {
        getSelectedItems: vi.fn().mockReturnValue([101, 102])
      },
      __zoteroCoverGridInstance: {
        scroller: {
          getSelectedIds: vi.fn().mockReturnValue([201, 202]),
          setSelectedIds: vi.fn()
        },
        controller: {
          reloadCurrentCollection: vi.fn().mockResolvedValue(true)
        }
      },
      requestAnimationFrame: (cb: Function) => cb()
    };
  });

  describe('extractNativeSelectedIds', () => {
    it('extracts item IDs from ZoteroPane.getSelectedItems', () => {
      const ids = extractNativeSelectedIds(mockWin);
      expect(ids).toEqual([101, 102]);
    });

    it('handles object items with id property', () => {
      mockWin.ZoteroPane.getSelectedItems.mockReturnValue([{ id: 10 }, { id: 20 }]);
      const ids = extractNativeSelectedIds(mockWin);
      expect(ids).toEqual([10, 20]);
    });

    it('returns empty array when ZoteroPane has no items or throws', () => {
      mockWin.ZoteroPane.getSelectedItems.mockReturnValue(null);
      expect(extractNativeSelectedIds(mockWin)).toEqual([]);
    });
  });

  describe('extractGridSelectedIds', () => {
    it('extracts item IDs from Cover Grid scroller', () => {
      const ids = extractGridSelectedIds(mockWin);
      expect(ids).toEqual([201, 202]);
    });

    it('returns empty array when scroller is missing', () => {
      mockWin.__zoteroCoverGridInstance = undefined;
      expect(extractGridSelectedIds(mockWin)).toEqual([]);
    });
  });

  describe('syncListToGrid', () => {
    it('syncs selected IDs and reloads current collection', async () => {
      const ids = syncListToGrid({ win: mockWin });
      expect(ids).toEqual([101, 102]);
      expect(mockWin.__zoteroCoverGridInstance.scroller.setSelectedIds).toHaveBeenCalledWith(
        [101, 102],
        { scrollIntoView: true }
      );
      expect(mockWin.__zoteroCoverGridInstance.controller.reloadCurrentCollection).toHaveBeenCalled();
    });
  });

  describe('syncGridToList', () => {
    it('restores selection and viewport scroll in native list view', () => {
      const itemsTree = document.createElement('div');
      const mockSelectItems = vi.fn();
      const mockEnsureRowIsVisible = vi.fn();
      const mockGetRowIndexByID = vi.fn().mockReturnValue(3);

      mockWin.ZoteroPane.itemsView = {
        selectItems: mockSelectItems,
        getRowIndexByID: mockGetRowIndexByID,
        ensureRowIsVisible: mockEnsureRowIsVisible,
        tree: {
          scrollToRow: vi.fn()
        }
      };

      syncGridToList({ win: mockWin, itemsTree, selectedIds: [301, 302] });

      expect(mockSelectItems).toHaveBeenCalledWith([301, 302]);
      expect(mockEnsureRowIsVisible).toHaveBeenCalledWith(3);
    });
  });
});
