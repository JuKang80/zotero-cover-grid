import { describe, it, expect, vi } from 'vitest';
import { TagColorSync } from '../src/sync/tags/tag-color-sync';

function makeItem(id: number) {
  const tags = new Set<string>();
  return {
    id,
    libraryID: 1,
    getTags: () => Array.from(tags).map((tag) => ({ tag })),
    hasTag: (t: string) => tags.has(t),
    addTag: vi.fn((t: string) => tags.add(t)),
    removeTag: vi.fn((t: string) => tags.delete(t)),
    saveTx: vi.fn(async () => {}),
    _tags: tags
  };
}

describe('TagColorSync: uncached Zotero items', () => {
  it('falls back to getAsync when Zotero.Items.get returns false (item not in memory)', async () => {
    const item = makeItem(42);
    const win: any = {
      Zotero: {
        Items: {
          get: vi.fn(() => false), // Zotero returns false, does not throw
          getAsync: vi.fn(async () => item)
        },
        Tags: {
          getColors: () => new Map([['Important', { color: '#ff0000', position: 0 }]]),
          getColorByPosition: (_lib: number, pos: number) =>
            pos === 0 ? { name: 'Important', color: '#ff0000' } : false
        }
      }
    };
    const sync = new TagColorSync(win, () => null);
    const card: any = { id: 42, key: 'K42', title: 't', tags: [], colorTags: [], readStatus: 'unread' };

    await sync.toggleColorTag(card, 1);

    expect(win.Zotero.Items.getAsync).toHaveBeenCalledWith(42);
    expect(item.addTag).toHaveBeenCalledWith('Important', 0);
    expect(item._tags.has('Important')).toBe(true);
    expect(card.colorTags).toEqual([{ tag: 'Important', color: '#ff0000' }]);
  });
});
