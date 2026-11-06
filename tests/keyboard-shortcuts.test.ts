import { describe, it, expect, vi } from 'vitest';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { WindowCoverGridController } from '../src/sync/window-controller';
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

  it('handles Zotero Map-based Tags.getColors (0-based position 0..8) and key 0 to clear all colored tags', async () => {
    const itemTags = new Set<string>(['unread']);
    const mockItem = {
      id: 101,
      libraryID: 1,
      hasTag: (t: string) => itemTags.has(t),
      addTag: vi.fn((t: string) => itemTags.add(t)),
      removeTag: vi.fn((t: string) => itemTags.delete(t)),
      getTags: () => Array.from(itemTags).map((tag) => ({ tag })),
      saveTx: vi.fn(async () => {})
    };

    const colorsMap = new Map<string, { color: string; position: number }>([
      ['unread', { color: '#FF6666', position: 0 }], // Key '1'
      ['read', { color: '#5FB236', position: 1 }]    // Key '2'
    ]);

    const mockWin = {
      document,
      Zotero: {
        Items: { get: () => mockItem },
        Tags: { getColors: () => colorsMap }
      }
    };

    const controller = new WindowCoverGridController(mockWin);
    const card: PaperCardData = {
      id: 101,
      key: 'KEY101',
      title: 'Test Paper',
      citationText: 'Smith (2026)',
      authorText: 'Smith',
      year: '2026',
      itemType: 'journalArticle',
      readStatus: 'unread',
      hasPdf: true,
      colorTags: [{ tag: 'unread', color: '#FF6666' }]
    };

    // Pressing '2' adds 'read' (position 1 in 0-based Map)
    await controller.toggleColorTag(card, 2);
    expect(mockItem.addTag).toHaveBeenCalledWith('read', 0);
    expect(card.colorTags?.map((c) => c.tag)).toEqual(['unread', 'read']);

    // Pressing '1' removes 'unread' (position 0 in 0-based Map) and updates readStatus to 'read'
    await controller.toggleColorTag(card, 1);
    expect(mockItem.removeTag).toHaveBeenCalledWith('unread');
    expect(card.colorTags?.map((c) => c.tag)).toEqual(['read']);
    expect(card.readStatus).toBe('read');

    // Pressing '0' removes all remaining colored tags
    await controller.toggleColorTag(card, 0);
    expect(mockItem.removeTag).toHaveBeenCalledWith('read');
    expect(card.colorTags).toEqual([]);
  });
});
