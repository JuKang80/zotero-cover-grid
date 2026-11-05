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

    expect(mockZp.selectItem).toHaveBeenCalledWith(101, false, true);
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

  it('debounces single-click and suppresses it when double-click occurs', async () => {
    vi.useFakeTimers();

    const card: PaperCardData = {
      id: 303,
      key: 'KEY303',
      title: 'Debounce Test',
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

    // 1. Single click
    const clickEvent1 = new MouseEvent('click', { detail: 1 });
    cardEl.dispatchEvent(clickEvent1);

    expect(onClick).not.toHaveBeenCalled();

    // Fast forward 230ms
    vi.advanceTimersByTime(230);
    expect(onClick).toHaveBeenCalledTimes(1);

    onClick.mockClear();

    // 2. Double click sequence: click (detail 1) -> click (detail 2) -> dblclick
    const dblClick1 = new MouseEvent('click', { detail: 1 });
    const dblClick2 = new MouseEvent('click', { detail: 2 });
    const dblEvent = new MouseEvent('dblclick', { detail: 2 });

    cardEl.dispatchEvent(dblClick1);
    // Before 220ms elapses, the second click and dblclick arrive
    vi.advanceTimersByTime(50);
    cardEl.dispatchEvent(dblClick2);
    cardEl.dispatchEvent(dblEvent);

    // Fast forward remaining time
    vi.advanceTimersByTime(300);

    // onClick should NOT have been called due to debouncing cancellation
    expect(onClick).not.toHaveBeenCalled();
    // onDoubleClick should have been called
    expect(onDoubleClick).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
