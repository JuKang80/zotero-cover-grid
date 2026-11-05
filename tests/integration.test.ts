import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startup, shutdown } from '../src/bootstrap';

declare const Services: any;
declare const ZoteroPane: any;

describe('End-to-End Extension Lifecycle & User Journey', () => {
  let mockWin: any;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="zotero-main-window">
        <div id="zotero-toolbar">
          <input id="zotero-search-box" />
        </div>
        <div id="zotero-items-pane">
          <div id="zotero-items-tree"></div>
        </div>
      </div>
    `;

    mockWin = {
      document,
      location: { href: 'chrome://zotero/content/standalone/zoteroPane.xhtml' },
      ZoteroPane: {
        loadedPromise: Promise.resolve(),
        itemsView: {
          rowProvider: {
            items: [
              {
                id: 1001,
                key: 'ITEM1001',
                getField: (f: string) => (f === 'title' ? 'Deep Residual Learning' : '2016'),
                getCreators: () => [{ lastName: 'He', firstName: 'Kaiming' }, { lastName: 'Zhang', firstName: 'Xiangyu' }],
                getTags: () => [{ tag: '#reading' }],
                itemType: 'journalArticle'
              },
              {
                id: 1002,
                key: 'ITEM1002',
                getField: (f: string) => (f === 'title' ? 'Attention Is All You Need' : '2017'),
                getCreators: () => [{ lastName: 'Vaswani', firstName: 'Ashish' }, { lastName: 'Shazeer', firstName: 'Noam' }, { lastName: 'Parmar', firstName: 'Niki' }],
                getTags: () => [{ tag: '#read' }],
                itemType: 'journalArticle'
              }
            ]
          },
          selectItem: vi.fn()
        },
        openAttachment: vi.fn(),
        deleteSelectedItems: vi.fn()
      }
    };

    // Configure Services.wm to yield mockWin for every enumerator invocation
    Services.wm.getEnumerator = vi.fn(() => {
      let yielded = false;
      return {
        hasMoreElements: () => !yielded,
        getNext: () => {
          yielded = true;
          return mockWin;
        }
      };
    });
  });

  afterEach(() => {
    shutdown({}, 1);
  });

  it('should complete full user journey: startup -> switch to grid -> zoom -> keyboard nav -> shutdown rollback', async () => {
    // 1. Extension startup
    startup({ id: 'zotero-cover-grid@antigravity.user', version: '0.1.0' }, 1);

    // Let any promises settle
    await new Promise((r) => setTimeout(r, 20));

    // UI elements injected
    const grid = document.getElementById('zotero-cover-grid');
    const itemsTree = document.getElementById('zotero-items-tree')!;
    const btnGrid = document.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
    const btnList = document.getElementById('zotero-cover-grid-btn-list') as HTMLButtonElement;
    const zoomSlider = document.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;

    expect(grid).not.toBeNull();
    expect(btnGrid).not.toBeNull();
    expect(itemsTree.hidden).toBe(false);

    // 2. Switch to Grid View
    btnGrid.click();
    expect(itemsTree.hidden).toBe(true);
    expect(grid?.hidden).toBe(false);

    // Load items into grid
    const instance = mockWin.__zoteroCoverGridInstance;
    expect(instance).toBeDefined();
    await instance.controller.reloadCurrentCollection();

    // Verify rendered cards & APA 7 formatting
    const card1 = document.getElementById('paper-card-1001')!;
    const card2 = document.getElementById('paper-card-1002')!;
    expect(card1).not.toBeNull();
    expect(card2).not.toBeNull();

    // 2 authors: He & Zhang (2016)
    expect(card1.querySelector('.card-author')?.textContent).toBe('He & Zhang (2016)');
    expect(card1.querySelector('.card-badge')?.textContent).toBe('Reading');

    // 3+ authors: Vaswani et al. (2017)
    expect(card2.querySelector('.card-author')?.textContent).toBe('Vaswani et al. (2017)');
    expect(card2.querySelector('.card-badge')?.textContent).toBe('Read');

    // 3. Zoom Slider adjustment
    zoomSlider.value = '260';
    zoomSlider.dispatchEvent(new Event('input'));
    expect(grid?.style.getPropertyValue('--card-width')).toBe('260px');

    // 4. Keyboard Navigation
    instance.scroller.moveFocus(1); // focus item 1002
    expect(instance.scroller.getSelectedIds()).toEqual([1002]);
    expect(mockWin.ZoteroPane.itemsView.selectItem).toHaveBeenCalledWith(1002);

    // 5. Extension shutdown -> Clean 5-step Rollback
    shutdown({}, 1);

    expect(document.getElementById('zotero-cover-grid')).toBeNull();
    expect(document.getElementById('zotero-cover-grid-toolbar-group')).toBeNull();
    expect(itemsTree.hidden).toBe(false);
    expect(mockWin.__zoteroCoverGridInstance).toBeUndefined();
  });
});
