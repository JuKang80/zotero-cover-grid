import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { PaperCardData } from '../src/types';

describe('VirtualGridScroller & Paper Cards', () => {
  let container: HTMLElement;
  let viewport: HTMLElement;
  let onSelectMock: any;
  let onOpenPdfMock: any;
  let onStatusChangeMock: any;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="viewport" style="height: 500px; overflow-y: auto;">
        <div id="container"></div>
      </div>
    `;
    viewport = document.getElementById('viewport')!;
    container = document.getElementById('container')!;
    onSelectMock = vi.fn();
    onOpenPdfMock = vi.fn();
    onStatusChangeMock = vi.fn();
  });

  const mockItems: PaperCardData[] = [
    {
      id: 1,
      key: 'K1',
      title: 'Paper 1',
      authorText: 'Author A',
      citationText: 'Author A (2024)',
      itemType: 'journalArticle',
      year: '2024',
      readStatus: 'unread',
      hasPdf: true
    },
    {
      id: 2,
      key: 'K2',
      title: 'Paper 2',
      authorText: 'Author B',
      citationText: 'Author B (2025)',
      itemType: 'journalArticle',
      year: '2025',
      readStatus: 'reading',
      hasPdf: true
    },
    {
      id: 3,
      key: 'K3',
      title: 'Paper 3',
      authorText: 'Author C',
      citationText: 'Author C (2026)',
      itemType: 'journalArticle',
      year: '2026',
      readStatus: 'read',
      hasPdf: false
    }
  ];

  it('should render paper cards for items', () => {
    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onSelect: onSelectMock,
      onOpenPdf: onOpenPdfMock,
      onStatusChange: onStatusChangeMock
    });

    scroller.setItems(mockItems);
    expect(container.children.length).toBe(3);

    const card1 = container.querySelector('#paper-card-1') as HTMLElement;
    expect(card1).not.toBeNull();
    expect(card1.querySelector('.card-author')?.textContent).toBe('Author A (2024)');
  });

  it('should maintain stable DOM references when items update (Stable Keying)', () => {
    const scroller = new VirtualGridScroller({
      container,
      viewport
    });

    scroller.setItems(mockItems);
    const initialCard1 = scroller.getCardElement(1);

    // Update with modified readStatus
    const updatedItems: PaperCardData[] = [
      { ...mockItems[0], readStatus: 'read' },
      mockItems[1]
    ];
    scroller.setItems(updatedItems);

    const newCard1 = scroller.getCardElement(1);
    expect(newCard1).toBe(initialCard1); // Same DOM node preserved!
    expect(newCard1?.querySelector('.card-badge')?.textContent).toBe('READ');

    // Item 3 removed
    expect(scroller.getCardElement(3)).toBeUndefined();
    expect(container.querySelector('#paper-card-3')).toBeNull();
  });

  it('should handle multi-selection with Cmd/Ctrl and Shift range selection', () => {
    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onSelect: onSelectMock
    });

    scroller.setItems(mockItems);

    // Click item 0
    scroller.handleCardClick(mockItems[0], 0, { metaKey: false, shiftKey: false } as any);
    expect(scroller.getSelectedIds()).toEqual([1]);

    // Cmd+Click item 2
    scroller.handleCardClick(mockItems[2], 2, { metaKey: true, shiftKey: false } as any);
    expect(scroller.getSelectedIds()).toEqual([1, 3]);

    // Shift+Click item 1 with anchor at 0
    scroller.handleCardClick(mockItems[0], 0, { metaKey: false, shiftKey: false } as any);
    scroller.handleCardClick(mockItems[2], 2, { metaKey: false, shiftKey: true } as any);
    expect(scroller.getSelectedIds()).toEqual([1, 2, 3]);
  });

  it('should cycle read status badge on badge click: unread -> reading -> read -> unread', () => {
    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onStatusChange: onStatusChangeMock
    });

    scroller.setItems(mockItems);
    const cardEl = scroller.getCardElement(1)!;
    const badge = cardEl.querySelector('.card-badge') as HTMLElement;

    // Click badge (starts at unread)
    badge.click();
    expect(onStatusChangeMock).toHaveBeenCalledWith(expect.anything(), 'reading');
    expect(badge.textContent).toBe('READING');

    badge.click();
    expect(onStatusChangeMock).toHaveBeenCalledWith(expect.anything(), 'read');
    expect(badge.textContent).toBe('READ');

    badge.click();
    expect(onStatusChangeMock).toHaveBeenCalledWith(expect.anything(), 'unread');
    expect(badge.textContent).toBe('UNREAD');
  });
});
