import { describe, it, expect, vi } from 'vitest';
import { WindowCoverGridController } from '../src/sync/window-controller';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { formatApa7Citation, extractPaperCardData } from '../src/utils/apa-formatter';
import { PaperCardData } from '../src/types';

describe('Functional Polish: Leak Prevention, ESC Deselect, and Fallback Citation', () => {
  it('1. should cleanly detach collection tree event listeners on destroy()', () => {
    const colTree = document.createElement('div');
    colTree.id = 'zotero-collections-tree';
    document.body.appendChild(colTree);

    const removeEventListenerSpy = vi.spyOn(colTree, 'removeEventListener');

    const win = {
      document,
      Zotero: {
        isMac: true,
        Notifier: { registerObserver: vi.fn(), unregisterObserver: vi.fn() }
      },
      ZoteroPane: {}
    };

    const controller = new WindowCoverGridController(win);
    const container = document.createElement('div');
    const viewport = document.createElement('div');
    const scroller = new VirtualGridScroller({ container, viewport });

    controller.init(scroller);

    // Destroy should remove click, dragover, and drop listeners
    controller.destroy();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function));

    colTree.remove();
  });

  it('2. should collapse multi-selection to single focused card when ESC is pressed', () => {
    const container = document.createElement('div');
    const viewport = document.createElement('div');
    const onSelect = vi.fn();

    const scroller = new VirtualGridScroller({ container, viewport, onSelect });

    const sampleItems: PaperCardData[] = [
      { id: 1, key: 'K1', title: 'Doc 1', authorText: 'Author A', citationText: 'A (2024)', year: '2024', itemType: 'journalArticle', readStatus: 'unread', hasPdf: true },
      { id: 2, key: 'K2', title: 'Doc 2', authorText: 'Author B', citationText: 'B (2024)', year: '2024', itemType: 'journalArticle', readStatus: 'unread', hasPdf: true },
      { id: 3, key: 'K3', title: 'Doc 3', authorText: 'Author C', citationText: 'C (2024)', year: '2024', itemType: 'journalArticle', readStatus: 'unread', hasPdf: true }
    ];

    scroller.setItems(sampleItems);

    // Multi-select all 3 cards via Cmd+A
    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'a', metaKey: true }));
    expect(scroller.getSelectedIds()).toEqual([1, 2, 3]);

    // Pressing ESC collapses multi-selection down to the focused card (id: 1)
    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(scroller.getSelectedIds()).toEqual([1]);

    scroller.destroy();
  });

  it('3. should format APA 7 citation using fallback title when creators array is empty', () => {
    // 3.1 Direct formatApa7Citation with fallback title
    expect(formatApa7Citation([], '2024', 'Global Economic Outlook Report')).toBe('Global Economic Outlook Repo… (2024)');
    expect(formatApa7Citation([], '2024', '')).toBe('(2024)');

    // 3.2 extractPaperCardData with institutional / authorless item
    const mockItem = {
      id: 501,
      key: 'REPORT_501',
      getField: (f: string) => (f === 'title' ? 'United Nations Climate Study' : f === 'date' ? '2025' : ''),
      getCreators: () => []
    };

    const cardData = extractPaperCardData(mockItem);
    expect(cardData.citationText).toBe('United Nations Climate Study (2025)');
    expect(cardData.authorText).toBe('United Nations Climate Study');
  });
});
