import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { PaperCardData } from '../src/types';

describe('Keyboard Navigation & Auto-tracking Scroll', () => {
  let container: HTMLElement;
  let viewport: HTMLElement;
  let onSelectMock: any;
  let onOpenPdfMock: any;
  let onDeleteItemMock: any;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="viewport" style="height: 500px; overflow-y: auto;">
        <div id="container" style="width: 800px;"></div>
      </div>
    `;
    viewport = document.getElementById('viewport')!;
    container = document.getElementById('container')!;
    onSelectMock = vi.fn();
    onOpenPdfMock = vi.fn();
    onDeleteItemMock = vi.fn();
  });

  const mockItems: PaperCardData[] = [
    { id: 10, key: 'K10', title: 'Doc 10', authorText: 'A', citationText: 'A (2020)', itemType: 'doc', year: '2020', readStatus: 'unread', hasPdf: true },
    { id: 20, key: 'K20', title: 'Doc 20', authorText: 'B', citationText: 'B (2021)', itemType: 'doc', year: '2021', readStatus: 'unread', hasPdf: true },
    { id: 30, key: 'K30', title: 'Doc 30', authorText: 'C', citationText: 'C (2022)', itemType: 'doc', year: '2022', readStatus: 'unread', hasPdf: true },
    { id: 40, key: 'K40', title: 'Doc 40', authorText: 'D', citationText: 'D (2023)', itemType: 'doc', year: '2023', readStatus: 'unread', hasPdf: true },
    { id: 50, key: 'K50', title: 'Doc 50', authorText: 'E', citationText: 'E (2024)', itemType: 'doc', year: '2024', readStatus: 'unread', hasPdf: true }
  ];

  it('should navigate cards with arrow keys and call scrollIntoView', () => {
    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onSelect: onSelectMock,
      onOpenPdf: onOpenPdfMock,
      onDeleteItem: onDeleteItemMock
    });

    scroller.setItems(mockItems);

    // Initial right arrow moves to index 0
    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(scroller.getSelectedIds()).toEqual([10]);
    expect(onSelectMock).toHaveBeenCalledWith([mockItems[0]]);

    const card10 = scroller.getCardElement(10)!;
    expect(card10.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });

    // Right arrow to index 1
    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(scroller.getSelectedIds()).toEqual([20]);

    // Left arrow back to index 0
    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(scroller.getSelectedIds()).toEqual([10]);
    scroller.destroy();
  });

  it('should trigger onOpenPdf on Enter key', () => {
    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onOpenPdf: onOpenPdfMock
    });

    scroller.setItems(mockItems);
    scroller.moveFocus(1); // focus doc 20

    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onOpenPdfMock).toHaveBeenCalledWith(mockItems[1]);
    scroller.destroy();
  });

  it('should trigger onDeleteItem on Delete / Backspace key', () => {
    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onDeleteItem: onDeleteItemMock
    });

    scroller.setItems(mockItems);
    scroller.moveFocus(2); // focus doc 30

    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(onDeleteItemMock).toHaveBeenCalledWith([mockItems[2]]);
    scroller.destroy();
  });

  it('should not double-fire arrow navigation when keydown bubbles from card -> container -> viewport', () => {
    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onSelect: onSelectMock
    });

    scroller.setItems(mockItems);
    scroller.moveFocus(0);
    onSelectMock.mockClear();

    const card10 = scroller.getCardElement(10)!;
    const focusSpy = vi.spyOn(scroller.getCardElement(20)!, 'focus');

    card10.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

    // Should advance by exactly 1 item (to id 20), not 2 items (to id 30)
    expect(scroller.getSelectedIds()).toEqual([20]);
    expect(onSelectMock).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    scroller.destroy();
  });

  it('should navigate by page rows on PageDown and PageUp', () => {
    const manyItems: PaperCardData[] = Array.from({ length: 20 }, (_, i) => ({
      id: 100 + i,
      key: `K${100 + i}`,
      title: `Doc ${i}`,
      authorText: 'A',
      citationText: 'A (2024)',
      itemType: 'doc',
      year: '2024',
      readStatus: 'unread',
      hasPdf: true
    }));

    Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true }); // 2 cols (180+16)
    Object.defineProperty(viewport, 'clientHeight', { value: 600, configurable: true }); // 2 rows (280+16=296 -> 2 rows)

    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onSelect: onSelectMock
    });
    scroller.setItems(manyItems);
    scroller.moveFocus(0);

    const card0 = scroller.getCardElement(100)!;
    card0.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));

    // 2 cols * 2 rows = 4 items forward -> index 4 (id 104)
    expect(scroller.getSelectedIds()).toEqual([104]);

    const card4 = scroller.getCardElement(104)!;
    card4.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true }));

    expect(scroller.getSelectedIds()).toEqual([100]);
    scroller.destroy();
  });
});
