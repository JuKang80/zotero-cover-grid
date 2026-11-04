import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WindowCoverGridController } from '../src/sync/window-controller';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { PaperCardData } from '../src/types';

describe('Search Debounce (150ms Trailing-edge & 0ms Fast-path)', () => {
  let mockWin: any;
  let scroller: VirtualGridScroller;
  let ctrl: WindowCoverGridController;

  const mockItems: PaperCardData[] = [
    { id: 1, key: 'K1', title: 'Attention Is All You Need', authorText: 'Vaswani', citationText: 'Vaswani (2017)', itemType: 'doc', year: '2017', readStatus: 'read', hasPdf: true },
    { id: 2, key: 'K2', title: 'BERT: Pre-training of Deep Bidirectional Transformers', authorText: 'Devlin', citationText: 'Devlin (2018)', itemType: 'doc', year: '2018', readStatus: 'read', hasPdf: true },
    { id: 3, key: 'K3', title: 'ResNet: Deep Residual Learning', authorText: 'He', citationText: 'He (2015)', itemType: 'doc', year: '2015', readStatus: 'reading', hasPdf: true }
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <input id="zotero-search-box" />
      <div id="vp"><div id="c"></div></div>
    `;
    mockWin = { document };
    scroller = new VirtualGridScroller({
      container: document.getElementById('c')!,
      viewport: document.getElementById('vp')!
    });
    ctrl = new WindowCoverGridController(mockWin);
    ctrl.init(scroller);
    (ctrl as any).allItems = mockItems;
    ctrl.applyFilter();
  });

  afterEach(() => {
    vi.useRealTimers();
    ctrl.destroy();
  });

  it('should not filter immediately upon typing, but debounce by 150ms', () => {
    expect(scroller.getCardElement(1)).not.toBeNull();
    expect(scroller.getCardElement(2)).not.toBeNull();
    expect(scroller.getCardElement(3)).not.toBeNull();

    // Type query "attention"
    ctrl.handleSearchInput('attention');

    // Immediately after typing, scroller still has 3 items (pending debounce)
    expect((ctrl as any).filteredItems.length).toBe(3);

    // Advance 100ms (not yet reached 150ms)
    vi.advanceTimersByTime(100);
    expect((ctrl as any).filteredItems.length).toBe(3);

    // Advance past 150ms
    vi.advanceTimersByTime(60);
    expect((ctrl as any).filteredItems.length).toBe(1);
    expect((ctrl as any).filteredItems[0].id).toBe(1);
    expect(scroller.getCardElement(1)).not.toBeNull();
    expect(scroller.getCardElement(2)).toBeUndefined();
  });

  it('should restore full list with 0ms fast-path when search input is empty or ESC pressed', () => {
    // Filter first
    ctrl.handleSearchInput('resnet');
    vi.advanceTimersByTime(160);
    expect((ctrl as any).filteredItems.length).toBe(1);

    // Now clear query with fastPath
    ctrl.handleSearchInput('', true);

    // Restored immediately with 0 delay!
    expect((ctrl as any).filteredItems.length).toBe(3);
    expect(scroller.getCardElement(1)).not.toBeNull();
    expect(scroller.getCardElement(2)).not.toBeNull();
    expect(scroller.getCardElement(3)).not.toBeNull();
  });
});
