import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WindowCoverGridController } from '../src/sync/window-controller';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';

declare const Zotero: any;

describe('Multi-Window Event Synchronization', () => {
  let mockWin1: any;
  let mockWin2: any;
  let scroller1: VirtualGridScroller;
  let scroller2: VirtualGridScroller;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="vp1"><div id="c1"></div></div>
      <div id="vp2"><div id="c2"></div></div>
    `;

    mockWin1 = { document };
    mockWin2 = { document };

    scroller1 = new VirtualGridScroller({
      container: document.getElementById('c1')!,
      viewport: document.getElementById('vp1')!
    });

    scroller2 = new VirtualGridScroller({
      container: document.getElementById('c2')!,
      viewport: document.getElementById('vp2')!
    });
  });

  it('should register independent observers for each window and unregister on destroy', () => {
    const ctrl1 = new WindowCoverGridController(mockWin1);
    const ctrl2 = new WindowCoverGridController(mockWin2);

    ctrl1.init(scroller1);
    ctrl2.init(scroller2);

    expect(Zotero.Notifier.registerObserver).toHaveBeenCalledTimes(2);

    ctrl1.destroy();
    expect(Zotero.Notifier.unregisterObserver).toHaveBeenCalledTimes(1);

    ctrl2.destroy();
    expect(Zotero.Notifier.unregisterObserver).toHaveBeenCalledTimes(2);
  });

  it('should patch items when receiving Notifier tag or item modify event', () => {
    const ctrl = new WindowCoverGridController(mockWin1);
    ctrl.init(scroller1);

    const mockItem = {
      id: 99,
      key: 'K99',
      getField: (f: string) => (f === 'title' ? 'Original Title' : '2024'),
      getCreators: () => [{ lastName: 'OriginalAuthor' }],
      getTags: () => [{ tag: '#unread' }],
      itemType: 'journalArticle'
    };

    Zotero.Items.get = vi.fn().mockReturnValue(mockItem);

    // Initial items loaded
    (ctrl as any).allItems = [{
      id: 99,
      key: 'K99',
      title: 'Original Title',
      authorText: 'OriginalAuthor',
      citationText: 'OriginalAuthor (2024)',
      itemType: 'journalArticle',
      year: '2024',
      readStatus: 'unread',
      hasPdf: false
    }];
    ctrl.applyFilter();

    expect(scroller1.getCardElement(99)?.querySelector('.card-badge')?.textContent).toBe('Unread');

    // Simulate item updated in Zotero (e.g. tag changed to #read)
    mockItem.getTags = () => [{ tag: '#read' }];
    ctrl.handleNotifierEvent('modify', 'item-tag', [99], {});

    expect(scroller1.getCardElement(99)?.querySelector('.card-badge')?.textContent).toBe('Read');

    ctrl.destroy();
  });
});
