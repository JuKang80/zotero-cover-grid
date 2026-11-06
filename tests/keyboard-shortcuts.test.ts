import { describe, it, expect, vi } from 'vitest';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { PaperCardData } from '../src/types';

describe('Keyboard Shortcuts (1~9 Color Tags, r Read Status, Space/Enter Open PDF)', () => {
  function setupScroller() {
    const container = document.createElement('div');
    const viewport = document.createElement('div');
    container.style.width = '800px';

    const onOpenPdf = vi.fn();
    const onStatusChange = vi.fn();
    const onToggleColorTag = vi.fn();
    const onSelect = vi.fn();

    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onOpenPdf,
      onStatusChange,
      onToggleColorTag,
      onSelect
    });

    const testItems: PaperCardData[] = [
      {
        id: 101,
        key: 'KEY101',
        title: 'Cognitive Offloading',
        citationText: 'Smith (2026)',
        authorText: 'Smith, J.',
        year: '2026',
        itemType: 'journalArticle',
        readStatus: 'unread',
        hasPdf: true
      },
      {
        id: 102,
        key: 'KEY102',
        title: 'Neural Networks',
        citationText: 'Lee (2025)',
        authorText: 'Lee, K.',
        year: '2025',
        itemType: 'preprint',
        readStatus: 'reading',
        hasPdf: true
      }
    ];

    scroller.setItems(testItems);
    scroller.moveFocus(0); // Focus first item (id: 101)

    return { scroller, container, onOpenPdf, onStatusChange, onToggleColorTag, testItems };
  }

  it('toggles color tag when numeric keys 1 through 9 are pressed', () => {
    const { container, onToggleColorTag, testItems } = setupScroller();

    // Press '1'
    container.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    expect(onToggleColorTag).toHaveBeenCalledWith(testItems[0], 1);

    // Press '5'
    container.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
    expect(onToggleColorTag).toHaveBeenCalledWith(testItems[0], 5);

    // Press '9'
    container.dispatchEvent(new KeyboardEvent('keydown', { key: '9', bubbles: true }));
    expect(onToggleColorTag).toHaveBeenCalledWith(testItems[0], 9);
  });

  it('does not trigger status change on r or R key (r shortcut removed per user request)', () => {
    const { container, onStatusChange } = setupScroller();

    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    expect(onStatusChange).not.toHaveBeenCalled();

    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', bubbles: true }));
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('opens PDF when Space bar or Enter is pressed', () => {
    const { container, onOpenPdf, testItems } = setupScroller();

    // Press Enter
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onOpenPdf).toHaveBeenCalledWith(testItems[0]);

    onOpenPdf.mockClear();

    // Press Space
    container.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onOpenPdf).toHaveBeenCalledWith(testItems[0]);
  });
});
