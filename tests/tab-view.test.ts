import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openCoverGridTab, COVER_GRID_TAB_ID } from '../src/ui/tab-view';

declare const Zotero_Tabs: any;

describe('Dedicated Full Tab Cover Grid View', () => {
  let mockWin: any;

  beforeEach(() => {
    document.body.innerHTML = '<div id="test-root"></div>';
    Zotero_Tabs._tabs = [{ id: 'zotero-pane', type: 'library', title: 'My Library' }];

    mockWin = {
      document,
      Zotero_Tabs,
      ZoteroPane: {
        getSortedItems: vi.fn(() => [
          {
            id: 2001,
            key: 'ITEM2001',
            getField: (f: string) => (f === 'title' ? 'Human-Level Control' : '2015'),
            getCreators: () => [{ lastName: 'Mnih', firstName: 'Volodymyr' }],
            getTags: () => [{ tag: '#unread' }],
            isRegularItem: () => true
          }
        ]),
        openAttachment: vi.fn(),
        getSelectedCollection: () => ({ name: 'Deep Learning' })
      }
    };
  });

  it('should open dedicated tab and construct full-page root with controls', () => {
    openCoverGridTab(mockWin);

    expect(Zotero_Tabs.add).toHaveBeenCalled();
    expect(Zotero_Tabs._tabs.some((t: any) => t.id === COVER_GRID_TAB_ID)).toBe(true);
    expect(mockWin.__zoteroCoverGridTabInstance).toBeDefined();

    const instance = mockWin.__zoteroCoverGridTabInstance;
    expect(instance.root).not.toBeNull();
    expect(instance.root.querySelector('.cover-grid-tab-header')).not.toBeNull();
    expect(instance.root.querySelector('.cover-grid-collection-name')?.textContent).toBe('Deep Learning');
    expect(instance.root.querySelector('.cover-grid-search-input')).not.toBeNull();
  });

  it('should select existing tab if already opened rather than duplicating', () => {
    openCoverGridTab(mockWin);
    const initialAddCount = vi.mocked(Zotero_Tabs.add).mock.calls.length;

    // Second invocation
    openCoverGridTab(mockWin);
    expect(vi.mocked(Zotero_Tabs.add).mock.calls.length).toBe(initialAddCount);
    expect(Zotero_Tabs.select).toHaveBeenCalledWith(COVER_GRID_TAB_ID);
  });
});
