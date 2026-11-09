import { describe, it, expect, vi } from 'vitest';
import { CollectionFetcher, getCollectionItemIDsRecursively } from '../src/sync/collection/collection-fetcher';

describe('CollectionFetcher & Hidden Table Parity', () => {
  it('should fetch collection items from selectedCol when itemsView is hidden (rowCount 0)', async () => {
    const mockItems = [
      { id: 9, isRegularItem: () => true, isAttachment: () => false, isAnnotation: () => false, isNote: () => false, getField: (f: string) => f === 'title' ? 'MATLAB for Psychologists' : '' },
      { id: 10, isRegularItem: () => true, isAttachment: () => false, isAnnotation: () => false, isNote: () => false, getField: (f: string) => f === 'title' ? 'THEORETICAL NEUROSCIENCE' : '' },
      { id: 11, isRegularItem: () => false, isAttachment: () => true, isAnnotation: () => false, isNote: () => false, parentItemID: null, getField: (f: string) => f === 'title' ? 'Computational Cognitive Neuroscience' : '' },
      { id: 14, isRegularItem: () => true, isAttachment: () => false, isAnnotation: () => false, isNote: () => false, getField: (f: string) => f === 'title' ? 'Cognitive neuroscience: the biology of the mind' : '' },
      { id: 1004, isRegularItem: () => true, isAttachment: () => false, isAnnotation: () => false, isNote: () => false, getField: (f: string) => f === 'title' ? 'Introduction to Psychtoolbox-3' : '' }
    ];

    const mockCollection = {
      id: 1,
      name: 'Textbook',
      libraryID: 1,
      getChildItems: vi.fn((asIDs) => asIDs ? [9, 10, 11, 14, 1004] : mockItems)
    };

    const mockWin = {
      ZoteroPane: {
        itemsView: {
          rowCount: 0,
          getSortedItems: vi.fn(() => [])
        },
        getSelectedCollections: vi.fn(() => [mockCollection]),
        getSelectedCollection: vi.fn(() => mockCollection)
      },
      Zotero: {
        Items: {
          getAsync: vi.fn(async (ids) => ids.map((id: number) => mockItems.find((it) => it.id === id))),
          get: vi.fn((id) => mockItems.find((it) => it.id === id))
        }
      }
    };

    const fetcher = new CollectionFetcher(mockWin);
    const abortCtrl = new AbortController();
    const result = await fetcher.fetchCollectionItems(abortCtrl.signal);

    expect(result.length).toBe(5);
    expect(result.map((r) => r.title)).toContain('MATLAB for Psychologists');
    expect(result.map((r) => r.title)).toContain('Computational Cognitive Neuroscience');
    expect(result.map((r) => r.title)).toContain('Cognitive neuroscience: the biology of the mind');
  });

  it('should not dump entire library when selected collection is legitimately empty', async () => {
    const mockEmptyCollection = {
      id: 99,
      name: 'Empty Folder',
      libraryID: 1,
      getChildItems: vi.fn((asIDs) => asIDs ? [] : [])
    };

    const mockWin = {
      ZoteroPane: {
        itemsView: {
          rowCount: 0,
          getSortedItems: vi.fn(() => [])
        },
        getSelectedCollections: vi.fn(() => [mockEmptyCollection]),
        getSelectedCollection: vi.fn(() => mockEmptyCollection)
      },
      Zotero: {
        Items: {
          getAll: vi.fn(() => [{ id: 1, getField: () => 'Should not be returned' }]),
          getAsync: vi.fn(async () => [])
        }
      }
    };

    const fetcher = new CollectionFetcher(mockWin);
    const abortCtrl = new AbortController();
    const result = await fetcher.fetchCollectionItems(abortCtrl.signal);

    expect(result.length).toBe(0);
    expect(mockWin.Zotero.Items.getAll).not.toHaveBeenCalled();
  });

  it('should recursively load items from subcollections when parent folder is selected', async () => {
    const subCol1 = {
      id: 101,
      name: 'Assignments',
      getChildItems: vi.fn(() => [201, 202]),
      getChildCollections: vi.fn(() => [])
    };
    const subCol2 = {
      id: 102,
      name: 'lab meeting',
      getChildItems: vi.fn(() => [301]),
      getChildCollections: vi.fn(() => [])
    };
    const parentCol = {
      id: 100,
      name: '석사',
      libraryID: 1,
      getChildItems: vi.fn(() => [1010]), // 1 direct item
      getChildCollections: vi.fn(() => [subCol1, subCol2]) // 2 subcollections
    };

    const mockAllItems: Record<number, any> = {
      1010: { id: 1010, isRegularItem: () => true, getField: (f: string) => f === 'title' ? 'Parent Direct Paper' : '' },
      201: { id: 201, isRegularItem: () => true, getField: (f: string) => f === 'title' ? 'Assignment Paper 1' : '' },
      202: { id: 202, isRegularItem: () => true, getField: (f: string) => f === 'title' ? 'Assignment Paper 2' : '' },
      301: { id: 301, isRegularItem: () => true, getField: (f: string) => f === 'title' ? 'Lab Meeting Paper' : '' }
    };

    const mockWin = {
      ZoteroPane: {
        itemsView: { rowCount: 0, getSortedItems: vi.fn(() => []) },
        getSelectedCollections: vi.fn(() => [parentCol]),
        getSelectedCollection: vi.fn(() => parentCol)
      },
      Zotero: {
        Prefs: { get: vi.fn(() => true) },
        Items: {
          getAsync: vi.fn(async (ids) => ids.map((id: number) => mockAllItems[id])),
          get: vi.fn((id: number) => mockAllItems[id])
        }
      }
    };

    const fetcher = new CollectionFetcher(mockWin);
    const result = await fetcher.fetchCollectionItems(new AbortController().signal);

    expect(result.length).toBe(4);
    const titles = result.map((r) => r.title);
    expect(titles).toContain('Parent Direct Paper');
    expect(titles).toContain('Assignment Paper 1');
    expect(titles).toContain('Assignment Paper 2');
    expect(titles).toContain('Lab Meeting Paper');
  });

  it('should support virtual collections like Recently Read via treeRow.getItems()', async () => {
    const recentItems = [
      { id: 501, isRegularItem: () => true, getField: (f: string) => f === 'title' ? 'Recently Read Paper 1' : '' },
      { id: 502, isRegularItem: () => true, getField: (f: string) => f === 'title' ? 'Recently Read Paper 2' : '' }
    ];

    const mockTreeRow = {
      name: 'Recently Read',
      type: 'recently-read',
      getItems: vi.fn(async () => [501, 502])
    };

    const mockWin = {
      ZoteroPane: {
        itemsView: { rowCount: 0, getSortedItems: vi.fn(() => []) },
        getSelectedCollections: vi.fn(() => []),
        getCollectionTreeRow: vi.fn(() => mockTreeRow)
      },
      Zotero: {
        Items: {
          getAsync: vi.fn(async (ids) => ids.map((id: number) => recentItems.find((it) => it.id === id))),
          get: vi.fn((id: number) => recentItems.find((it) => it.id === id))
        }
      }
    };

    const fetcher = new CollectionFetcher(mockWin);
    const result = await fetcher.fetchCollectionItems(new AbortController().signal);

    expect(result.length).toBe(2);
    expect(result[0].title).toBe('Recently Read Paper 1');
    expect(result[1].title).toBe('Recently Read Paper 2');
  });

  it('should gracefully handle corrupt item data without blanking out the rest of the folder', async () => {
    const corruptItem = {
      id: 9999,
      isRegularItem: () => true,
      getCreators: () => [{ lastName: null, firstName: undefined } as any],
      getField: () => { throw new Error('Simulated database corruption'); },
      getTags: () => [null as any]
    };
    const healthyItem = {
      id: 8888,
      isRegularItem: () => true,
      getField: (f: string) => f === 'title' ? 'Healthy Paper' : '2026',
      getCreators: () => [{ lastName: 'Smith', firstName: 'John' }],
      getTags: () => [{ tag: 'neuroscience' }]
    };

    const mockCollection = {
      id: 77,
      name: 'Mixed Collection',
      libraryID: 1,
      getChildItems: vi.fn(() => [9999, 8888])
    };

    const mockWin = {
      ZoteroPane: {
        itemsView: { rowCount: 0, getSortedItems: vi.fn(() => []) },
        getSelectedCollections: vi.fn(() => [mockCollection])
      },
      Zotero: {
        Items: {
          getAsync: vi.fn(async (ids) => ids.map((id: number) => id === 9999 ? corruptItem : healthyItem)),
          get: vi.fn((id: number) => id === 9999 ? corruptItem : healthyItem)
        }
      }
    };

    const fetcher = new CollectionFetcher(mockWin);
    const result = await fetcher.fetchCollectionItems(new AbortController().signal);

    // Both items should be returned; the corrupt one falls back safely instead of killing the whole folder
    expect(result.length).toBe(2);
    expect(result.some((r) => r.title === 'Healthy Paper')).toBe(true);
  });
});
