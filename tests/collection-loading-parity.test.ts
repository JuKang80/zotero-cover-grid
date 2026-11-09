import { describe, it, expect, vi } from 'vitest';
import { CollectionFetcher } from '../src/sync/collection/collection-fetcher';

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
});
