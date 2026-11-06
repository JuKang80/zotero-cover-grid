import { describe, it, expect, vi } from 'vitest';
import { selectItemInZotero, openItemInZotero } from '../src/ui/item-actions';
import { createPaperCardElement } from '../src/ui/paper-card';
import { PaperCardData } from '../src/types';

describe('Clean-Room Item Actions & Debouncing', () => {
  it('selectItemInZotero calls ZoteroPane.selectItem and itemPane.viewItem', () => {
    const mockZp = {
      selectItem: vi.fn(),
      itemPane: {
        viewItem: vi.fn()
      }
    };
    const mockZ = {
      Items: {
        get: vi.fn().mockReturnValue({ id: 101, title: 'Test Paper' })
      }
    };
    const mockWin = {
      ZoteroPane: mockZp,
      Zotero: mockZ
    };

    selectItemInZotero(mockWin, 101);

    expect(mockZp.selectItem).toHaveBeenCalledWith(101, false, false);
    expect(mockZ.Items.get).toHaveBeenCalledWith(101);
    expect(mockZp.itemPane.viewItem).toHaveBeenCalledWith({ id: 101, title: 'Test Paper' });
  });

  it('openItemInZotero opens best attachment in Zotero.Reader when viewItems fails', async () => {
    const mockReader = {
      open: vi.fn().mockResolvedValue(true)
    };
    const mockAttachment = { id: 999 };
    const mockItem = {
      id: 202,
      isAttachment: () => false,
      getBestAttachment: vi.fn().mockResolvedValue(mockAttachment)
    };
    const mockZ = {
      Items: {
        getAsync: vi.fn().mockResolvedValue(mockItem),
        get: vi.fn().mockReturnValue(mockItem)
      },
      Reader: mockReader
    };
    const mockWin = {
      ZoteroPane: {
        viewItems: vi.fn().mockRejectedValue(new Error('fail'))
      },
      Zotero: mockZ
    };

    await openItemInZotero(mockWin, 202);

    expect(mockItem.getBestAttachment).toHaveBeenCalled();
    expect(mockReader.open).toHaveBeenCalledWith(999);
  });

  it('openItemInZotero opens note in Zotero Note Editor when item is a note', async () => {
    const mockNoteItem = {
      id: 404,
      isNote: () => true,
      itemType: 'note'
    };
    const mockOpenNote = vi.fn();
    const mockWin = {
      ZoteroPane: {
        openNote: mockOpenNote
      },
      Zotero: {
        Items: {
          get: vi.fn().mockReturnValue(mockNoteItem)
        }
      }
    };

    await openItemInZotero(mockWin, 404);
    expect(mockOpenNote).toHaveBeenCalledWith(404);
  });

  it('dispatches click instantly without artificial timer lag', () => {
    const card: PaperCardData = {
      id: 303,
      key: 'KEY303',
      title: 'Snappy Click Test',
      citationText: 'Tester (2026)',
      authorText: 'Tester, A.',
      year: '2026',
      itemType: 'journalArticle',
      readStatus: 'unread',
      hasPdf: true
    };

    const onClick = vi.fn();
    const onDoubleClick = vi.fn();

    const cardEl = createPaperCardElement(card, {
      onClick,
      onDoubleClick
    });

    // 1. Single click fires instantly (0ms delay)
    cardEl.dispatchEvent(new MouseEvent('click'));
    expect(onClick).toHaveBeenCalledTimes(1);

    // 2. Double click fires immediately
    cardEl.dispatchEvent(new MouseEvent('dblclick'));
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });
});
