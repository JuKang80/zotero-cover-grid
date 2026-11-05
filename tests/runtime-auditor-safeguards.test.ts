import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startup, onMainWindowLoad, shutdown } from '../src/bootstrap';
import { openCoverGridTab } from '../src/ui/tab-view';
import { WindowCoverGridController } from '../src/sync/window-controller';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { createPaperCardElement } from '../src/ui/paper-card';
import { ensureMainWindowStability } from '../src/ui/index';

declare const Zotero: any;
declare const Services: any;

describe('Lead Runtime Code Auditor Safeguards (Zotero 10 Gecko 140 ESR)', () => {
  let mockWin: any;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="zotero-tab-cover"></div>
      <deck id="tabs-deck"></deck>
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
          rowProvider: { items: [] },
          selectItem: vi.fn(),
          onRefresh: { addListener: vi.fn(), removeListener: vi.fn() }
        },
        openAttachment: vi.fn(),
        deleteSelectedItems: vi.fn()
      },
      ZoteroContextPane: {
        showLoadingMessage: vi.fn()
      },
      setTimeout: (fn: Function) => fn()
    };
  });

  afterEach(() => {
    shutdown({}, 0);
  });

  describe('1. Zotero 10 Lifecycle & Promises (uiReadyPromise & interactive readyState)', () => {
    it('should wait for Zotero.uiReadyPromise along with initializationPromise and unlockPromise', async () => {
      let uiReadyResolved = false;
      const uiReadyPromise = new Promise((resolve) => {
        setTimeout(() => {
          uiReadyResolved = true;
          resolve(true);
        }, 10);
      });

      (Zotero as any).uiReadyPromise = uiReadyPromise;
      (Zotero as any).initializationPromise = Promise.resolve();
      (Zotero as any).unlockPromise = Promise.resolve();

      await onMainWindowLoad({ window: mockWin });

      expect(uiReadyResolved).toBe(true);
      expect(mockWin.__zoteroCoverGridInitialized).toBe(true);

      delete (Zotero as any).uiReadyPromise;
    });

    it('should initialize immediately when document.readyState is interactive without waiting for DOMContentLoaded', () => {
      const addEventListenerSpy = vi.fn();
      const interactiveDoc = {
        readyState: 'interactive',
        getElementById: (id: string) => document.getElementById(id),
        createElementNS: (ns: string, tag: string) => document.createElementNS(ns, tag),
        addEventListener: addEventListenerSpy
      };
      const interactiveWin = {
        document: interactiveDoc,
        location: { href: 'chrome://zotero/content/standalone/zoteroPane.xhtml' },
        ZoteroPane: { loadedPromise: Promise.resolve() },
        setTimeout: (fn: Function) => fn()
      };

      (Zotero as any).getMainWindows = vi.fn(() => [interactiveWin]);

      startup({ id: 'zotero-cover-grid@antigravity.user' }, 1);

      // Should not add DOMContentLoaded listener because readyState is already interactive
      expect(addEventListenerSpy).not.toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function), expect.any(Object));
      const anyWin = interactiveWin as any;
      expect(anyWin.__zoteroCoverGridInitializing || anyWin.__zoteroCoverGridInitialized).toBeTruthy();
    });
  });

  describe('2. WindowCoverGridController Async Fetching & Notifier Edge Cases', () => {
    it('should await getChildItems(true) if it returns a Promise in Zotero 10', async () => {
      const controller = new WindowCoverGridController(mockWin);
      const scroller = new VirtualGridScroller({
        container: document.createElement('div'),
        viewport: document.createElement('div')
      });
      controller.init(scroller);

      const asyncCol = {
        id: 101,
        name: 'Async AI Papers',
        getChildItems: vi.fn().mockResolvedValue([
          {
            id: 201,
            isRegularItem: () => true,
            getField: () => 'Attention is All You Need',
            getCreators: () => [{ lastName: 'Vaswani' }],
            getTags: () => []
          }
        ])
      };

      mockWin.ZoteroPane.getSelectedCollections = vi.fn(() => [asyncCol]);

      await controller.reloadCurrentCollection();

      expect(asyncCol.getChildItems).toHaveBeenCalledWith(true);
      expect(controller.getCurrentCollectionName()).toBe('Async AI Papers');

      controller.destroy();
    });

    it('should fallback to Items.getAsync if Items.get throws UnloadedDataException in patchItems', async () => {
      const controller = new WindowCoverGridController(mockWin);
      const scroller = new VirtualGridScroller({
        container: document.createElement('div'),
        viewport: document.createElement('div')
      });
      controller.init(scroller);

      (controller as any).allItems = [
        {
          id: 555,
          key: 'K555',
          title: 'Initial Title',
          authorText: 'Author A',
          citationText: 'Author A (2025)',
          itemType: 'journalArticle',
          year: '2025',
          readStatus: 'unread',
          hasPdf: true
        }
      ];

      (Zotero.Items as any).get = vi.fn(() => {
        throw new Error('UnloadedDataException: item not in memory cache');
      });
      (Zotero.Items as any).getAsync = vi.fn().mockResolvedValue({
        id: 555,
        key: 'K555',
        getField: (f: string) => (f === 'title' ? 'Updated Title via getAsync' : ''),
        getCreators: () => [{ lastName: 'Author A' }],
        getTags: () => [{ tag: '#reading' }],
        isRegularItem: () => true
      });

      // Send modify notifier event
      controller.handleNotifierEvent('modify', 'item', [555], {});

      // Allow microtask ticks for async patchItems
      await new Promise((r) => setTimeout(r, 20));

      expect(Zotero.Items.getAsync).toHaveBeenCalledWith(555);
      expect((controller as any).allItems[0].title).toBe('Updated Title via getAsync');
      expect((controller as any).allItems[0].readStatus).toBe('reading');

      controller.destroy();
    });

    it('should handle non-array or null ids gracefully in handleNotifierEvent without throwing', () => {
      const controller = new WindowCoverGridController(mockWin);
      expect(() => controller.handleNotifierEvent('modify', 'item', null as any, {})).not.toThrow();
      expect(() => controller.handleNotifierEvent('select', 'tab', undefined as any, {})).not.toThrow();
      controller.destroy();
    });
  });

  describe('3. VirtualScroller & PaperCard DOM Robustness', () => {
    it('should reset focusedIndex to -1 and anchorIndex to 0 when items become empty', () => {
      const container = document.createElement('div');
      const viewport = document.createElement('div');
      const scroller = new VirtualGridScroller({ container, viewport });

      // First set items
      scroller.setItems([
        {
          id: 1,
          key: 'K1',
          title: 'Paper 1',
          authorText: 'Author 1',
          citationText: 'Author (2020)',
          itemType: 'journalArticle',
          year: '2020',
          readStatus: 'unread',
          hasPdf: false
        }
      ]);
      scroller.moveFocus(0);
      expect((scroller as any).focusedIndex).toBe(0);

      // Empty items
      scroller.setItems([]);
      expect((scroller as any).focusedIndex).toBe(-1);
      expect((scroller as any).anchorIndex).toBe(0);
      expect(container.querySelector('.grid-empty-placeholder')).toBeTruthy();

      scroller.destroy();
    });

    it('should hide img element on error without showing broken image icon', () => {
      const cardEl = createPaperCardElement({
        id: 99,
        key: 'K99',
        title: 'Broken Img Test',
        authorText: 'Author',
        citationText: 'Author (2024)',
        itemType: 'journalArticle',
        year: '2024',
        readStatus: 'unread',
        hasPdf: true,
        coverThumbnailUrl: 'blob:invalid-broken-url'
      });

      const img = cardEl.querySelector('.card-cover-img') as HTMLImageElement;
      expect(img).toBeTruthy();

      // Trigger error event
      img.dispatchEvent(new Event('error'));
      expect(img.style.display).toBe('none');

      // Trigger load event
      img.dispatchEvent(new Event('load'));
      expect(img.style.display).toBe('');
    });
  });

  describe('4. Dedicated Tab Cleanup and Stability', () => {
    it('should invoke tab instance cleanup on tab close and dismiss context pane loading message', () => {
      const container = document.createElement('div');
      container.id = 'zotero-cover-grid-tab';
      (globalThis as any).Zotero_Tabs = {
        _tabs: [],
        add: vi.fn(({ onClose }: any) => {
          return { container, onClose };
        }),
        select: vi.fn()
      };

      openCoverGridTab(mockWin);

      expect(mockWin.__zoteroCoverGridTabInstance).toBeTruthy();
      const cleanupSpy = vi.fn();
      mockWin.__zoteroCoverGridTabInstance.cleanup = cleanupSpy;

      // Call onClose
      const addedTab = (globalThis as any).Zotero_Tabs.add.mock.calls[0][0];
      addedTab.onClose();

      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockWin.__zoteroCoverGridTabInstance).toBeNull();
      expect(mockWin.ZoteroContextPane.showLoadingMessage).toHaveBeenCalledWith(false);
    });

    it('should ensure main window stability and dismiss context pane loading messages', () => {
      ensureMainWindowStability(document, mockWin);
      expect(mockWin.ZoteroContextPane.showLoadingMessage).toHaveBeenCalledWith(false);
    });
  });
});
