import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { PaperCardData } from '../src/types';

describe('Scroll Anchoring on List Mutation', () => {
  let container: HTMLElement;
  let viewport: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="viewport" style="height: 400px; overflow-y: auto;">
        <div id="container"></div>
      </div>
    `;
    viewport = document.getElementById('viewport')!;
    container = document.getElementById('container')!;
  });

  it('should adjust scrollTop by delta when new items are prepended above viewport', () => {
    const scroller = new VirtualGridScroller({ container, viewport });

    const initialItems: PaperCardData[] = [
      { id: 10, key: 'K10', title: 'Paper 10', authorText: 'A', citationText: 'A (2020)', itemType: 'doc', year: '2020', readStatus: 'unread', hasPdf: true },
      { id: 20, key: 'K20', title: 'Paper 20', authorText: 'B', citationText: 'B (2021)', itemType: 'doc', year: '2021', readStatus: 'unread', hasPdf: true }
    ];

    scroller.setItems(initialItems);

    const el10 = scroller.getCardElement(10)!;
    const el20 = scroller.getCardElement(20)!;

    // Simulate DOM layout offsets:
    // el10 is at 0
    // el20 starts at 200, but shifts to 400 once prepended item 5 is in the container (>2 children)
    Object.defineProperty(el10, 'offsetTop', { value: 0, configurable: true });
    Object.defineProperty(el20, 'offsetTop', {
      get: () => (container.children.length > 2 ? 400 : 200),
      configurable: true
    });

    viewport.scrollTop = 200; // Scrolled down to item 20

    // Cloud sync prepends new Paper 5 at offset 0, pushing item 20 down by +200px
    const prependedItems: PaperCardData[] = [
      { id: 5, key: 'K5', title: 'Paper 5', authorText: 'New', citationText: 'New (2024)', itemType: 'doc', year: '2024', readStatus: 'unread', hasPdf: true },
      ...initialItems
    ];

    scroller.setItems(prependedItems);

    // Viewport scrollTop should have been adjusted by +200 delta (from 200 to 400)
    expect(viewport.scrollTop).toBe(400);
  });
});
