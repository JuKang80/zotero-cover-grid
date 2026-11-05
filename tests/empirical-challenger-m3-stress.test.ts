import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WindowCoverGridController } from '../src/sync/window-controller';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { openCoverGridTab, COVER_GRID_TAB_ID } from '../src/ui/tab-view';
import { injectCoverGridUI, cleanupCoverGridUI } from '../src/ui/index';
import { thumbnailCacheManager } from '../src/services/cache-manager';

declare const Zotero: any;
declare const ZoteroPane: any;
declare const Zotero_Tabs: any;

describe('Empirical Adversarial Stress & Edge Cases: Milestone 3 (R3)', () => {
  let mockWin: any;
  let mockDoc: Document;
  let scroller: VirtualGridScroller;
  let containerEl: HTMLElement;
  let viewportEl: HTMLElement;
  const g = globalThis as any;

  beforeEach(() => {
    vi.clearAllMocks();

    document.body.innerHTML = `
      <div id="zotero-tab-cover" class="hidden"></div>
      <deck id="tabs-deck"></deck>
      <div id="zotero-main-window">
        <div id="zotero-toolbar">
          <input id="zotero-search-box" />
        </div>
        <div id="zotero-items-pane">
          <div id="zotero-items-tree"></div>
        </div>
      </div>
      <div id="vp"><div id="c"></div></div>
    `;

    mockDoc = document;
    containerEl = document.getElementById('c')!;
    viewportEl = document.getElementById('vp')!;
    scroller = new VirtualGridScroller({ container: containerEl, viewport: viewportEl });

    Zotero_Tabs._tabs = [{ id: 'zotero-pane', type: 'library', title: 'My Library' }];

    mockWin = {
      document: mockDoc,
      location: { href: 'chrome://zotero/content/standalone/zoteroPane.xhtml' },
      Zotero_Tabs,
      ZoteroPane: {
        loadedPromise: Promise.resolve(),
        viewItems: vi.fn().mockResolvedValue(undefined),
        openAttachment: vi.fn(),
        deleteSelectedItems: vi.fn(),
        getSelectedItems: vi.fn(() => []),
        getSelectedCollection: vi.fn(() => ({ name: 'Deep Learning' })),
        itemsView: {
          onRefresh: {
            addListener: vi.fn(),
            removeListener: vi.fn()
          },
          getSortedItems: vi.fn(() => []),
          selectItem: vi.fn(),
          rowProvider: { items: [] }
        }
      },
      Zotero: {
        Reader: { open: vi.fn().mockResolvedValue(undefined) },
        Prefs: {
          get: vi.fn(() => 180),
          set: vi.fn()
        },
        Items: {
          get: vi.fn((id: number) => ({
            id,
            key: `KEY_${id}`,
            getField: (f: string) => (f === 'title' ? `Paper ${id}` : '2026'),
            getCreators: () => [{ firstName: 'A', lastName: 'B' }],
            getTags: () => [],
            isRegularItem: () => true,
            getBestAttachment: vi.fn().mockResolvedValue({ id: id + 9000, isPDFAttachment: () => true })
          })),
          getAll: vi.fn(() => [])
        },
        Notifier: {
          registerObserver: vi.fn(() => 'obs-stress'),
          unregisterObserver: vi.fn()
        }
      },
      setTimeout: (fn: Function) => fn()
    };

    g.Zotero = mockWin.Zotero;
    g.ZoteroPane = mockWin.ZoteroPane;
  });

  afterEach(() => {
    scroller?.destroy();
    cleanupCoverGridUI(mockWin);
  });

  // =========================================================================
  // 1. Stress: Malformed Items in Collection
  // =========================================================================
  describe('Malformed & Missing Data Items in Collection', () => {
    it('should survive rawItems containing null, undefined, primitive IDs, and sparse item objects', async () => {
      const sparseItems = [
        null,
        undefined,
        42, // numeric id
        '99', // string id
        { id: 400, isRegularItem: () => true }, // sparse object without getField/getCreators
        { isRegularItem: () => false, isNote: () => true }, // note
        { isRegularItem: () => false, isAttachment: () => true }, // attachment
        {
          id: 500,
          key: 'K500',
          getField: () => '', // empty title
          getCreators: () => [], // empty creators
          getTags: () => [], // empty tags
          isRegularItem: () => true,
          getBestAttachment: vi.fn().mockResolvedValue(null)
        }
      ];

      mockWin.ZoteroPane.itemsView.getSortedItems.mockReturnValue(sparseItems);

      const ctrl = new WindowCoverGridController(mockWin);
      ctrl.init(scroller);

      await expect(ctrl.reloadCurrentCollection()).resolves.not.toThrow();

      // IDs 42, 99 and objects 400, 500 should be retained
      expect(ctrl['allItems'].length).toBe(4);
      expect(scroller['items'].length).toBe(4);

      ctrl.destroy();
    });

    it('should survive thumbnail render rejections without unhandled exceptions', async () => {
      vi.spyOn(thumbnailCacheManager, 'getThumbnail').mockRejectedValue(new Error('Out of memory canvas error'));

      const validItem = {
        id: 701,
        key: 'K701',
        getField: () => 'OOM Paper',
        getCreators: () => [],
        getTags: () => [],
        isRegularItem: () => true,
        getBestAttachment: vi.fn().mockResolvedValue({ id: 801, isPDFAttachment: () => true })
      };
      mockWin.ZoteroPane.itemsView.getSortedItems.mockReturnValue([validItem]);

      const ctrl = new WindowCoverGridController(mockWin);
      ctrl.init(scroller);

      await expect(ctrl.reloadCurrentCollection()).resolves.not.toThrow();
      expect(ctrl['allItems'].length).toBe(1);
      expect(ctrl['allItems'][0].title).toBe('OOM Paper');

      ctrl.destroy();
    });
  });

  // =========================================================================
  // 2. Stress: High-Volume Collection Scaling (5,000 items)
  // =========================================================================
  describe('High-Volume Large Collection Scaling', () => {
    it('should process a collection of 5,000 items efficiently without crashing or memory blowout', async () => {
      const largeCollection: any[] = [];
      for (let i = 0; i < 5000; i++) {
        largeCollection.push({
          id: 10000 + i,
          key: `ITEM_${10000 + i}`,
          getField: (f: string) => (f === 'title' ? `Paper #${i}` : '2025'),
          getCreators: () => [{ lastName: `Author${i % 100}`, firstName: 'John' }],
          getTags: () => (i % 3 === 0 ? [{ tag: '#unread' }] : []),
          isRegularItem: () => true,
          getBestAttachment: vi.fn().mockResolvedValue(null)
        });
      }

      mockWin.ZoteroPane.itemsView.getSortedItems.mockReturnValue(largeCollection);

      const ctrl = new WindowCoverGridController(mockWin);
      ctrl.init(scroller);

      const startTime = performance.now();
      await ctrl.reloadCurrentCollection();
      const elapsed = performance.now() - startTime;

      expect(ctrl['allItems'].length).toBe(5000);
      expect(ctrl['filteredItems'].length).toBe(5000);
      expect(scroller['items'].length).toBe(5000);

      // Should complete in under 10.0 seconds in JS test environment under parallel load
      expect(elapsed).toBeLessThan(10000);

      ctrl.destroy();
    });
  });

  // =========================================================================
  // 3. Stress: Concurrent Execution & Interrupted Aborts
  // =========================================================================
  describe('Concurrent Invocations & Race Condition Resilience', () => {
    it('should ensure last invocation wins when multiple reloadCurrentCollection calls overlap asynchronously', async () => {
      const ctrl = new WindowCoverGridController(mockWin);
      ctrl.init(scroller);

      mockWin.ZoteroPane.itemsView.getSortedItems = vi.fn().mockImplementationOnce(() => {
        return [{ id: 1, key: 'K1', getField: () => 'Call 1 Paper', isRegularItem: () => true }];
      });

      const reload1 = ctrl.reloadCurrentCollection();
      const signal1 = (ctrl as any).abortController.signal;

      // Call 2: immediately afterwards
      mockWin.ZoteroPane.itemsView.getSortedItems = vi.fn().mockReturnValue([
        { id: 2, key: 'K2', getField: () => 'Call 2 Paper', isRegularItem: () => true }
      ]);

      const reload2 = ctrl.reloadCurrentCollection();
      const signal2 = (ctrl as any).abortController.signal;

      expect(signal1.aborted).toBe(true);
      expect(signal2.aborted).toBe(false);

      await Promise.all([reload1, reload2]);

      // State must be from Call 2
      expect(ctrl['allItems'].length).toBe(1);
      expect(ctrl['allItems'][0].title).toBe('Call 2 Paper');

      ctrl.destroy();
    });

    it('should gracefully handle double destroy() without throwing or double-unsubscribing', () => {
      const ctrl = new WindowCoverGridController(mockWin);
      ctrl.init(scroller);

      expect(() => {
        ctrl.destroy();
        ctrl.destroy();
      }).not.toThrow();

      expect(mockWin.ZoteroPane.itemsView.onRefresh.removeListener).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 4. PDF Open Exception Fallback Flow
  // =========================================================================
  describe('PDF Open Fallback Flow', () => {
    it('should safely fall through from viewItems to Reader.open when viewItems throws', async () => {
      mockWin.ZoteroPane.viewItems = vi.fn().mockRejectedValue(new Error('viewItems native error'));
      const mockAttachment = { id: 8888, isPDFAttachment: () => true };
      mockWin.Zotero.Items.get = vi.fn(() => ({
        getBestAttachment: vi.fn().mockResolvedValue(mockAttachment)
      }));

      injectCoverGridUI(mockWin);
      const instance = mockWin.__zoteroCoverGridInstance;

      const testCard = {
        id: 9999,
        key: 'KEY_9999',
        title: 'Fallback Paper',
        citationText: 'Fallback (2026)',
        authorText: 'Nobody',
        readStatus: 'unread' as const,
        hasPdf: true
      };

      const onOpenPdf = instance.scroller['options'].onOpenPdf;
      await onOpenPdf(testCard);

      expect(mockWin.ZoteroPane.viewItems).toHaveBeenCalledWith([9999]);
      expect(mockWin.Zotero.Reader.open).toHaveBeenCalledWith(8888);
    });

    it('should cleanly fallback to openAttachment legacy when Reader.open is unavailable', async () => {
      mockWin.ZoteroPane.viewItems = vi.fn().mockRejectedValue(new Error('viewItems native error'));
      mockWin.Zotero.Reader = null; // No Reader
      mockWin.Zotero.Items.get = vi.fn(() => ({
        getBestAttachment: vi.fn().mockResolvedValue(null)
      }));

      injectCoverGridUI(mockWin);
      const instance = mockWin.__zoteroCoverGridInstance;

      const testCard = {
        id: 777,
        key: 'KEY_777',
        title: 'Legacy Paper',
        citationText: 'Legacy (2026)',
        authorText: 'Old',
        readStatus: 'unread' as const,
        hasPdf: true
      };

      const onOpenPdf = instance.scroller['options'].onOpenPdf;
      await onOpenPdf(testCard);

      expect(mockWin.ZoteroPane.openAttachment).toHaveBeenCalledWith(777);
    });
  });

  // =========================================================================
  // 5. Build Artifact & Packaging Verification
  // =========================================================================
  describe('Compiled Bundle & Packaged Distribution Integrity', () => {
    it('should verify production bundle contains all Milestone 3 runtime contracts', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const bundlePath = path.resolve(__dirname, '../build/addon/bootstrap.js');

      expect(fs.existsSync(bundlePath)).toBe(true);
      const bundle = fs.readFileSync(bundlePath, 'utf8');

      // 1. CMap & font URLs
      expect(bundle).toContain('resource://zotero/reader/pdf/web/cmaps/');
      expect(bundle).toContain('resource://zotero/reader/pdf/web/standard_fonts/');
      expect(bundle).toContain('cMapPacked');

      // 2. Sidebar sync via itemsView.onRefresh
      expect(bundle).toContain('onRefresh.addListener');
      expect(bundle).toContain('onRefresh.removeListener');

      // 3. Empty collection retention check (rawItems == null)
      expect(bundle).toMatch(/(?:rawItems\s*==\s*null|[a-zA-Z0-9_$]+==null)/);

      // 4. Priority itemsView.getSortedItems()
      expect(bundle).toContain('itemsView.getSortedItems');

      // 5. Zotero 10 PDF Open (viewItems)
      expect(bundle).toContain('viewItems');
      expect(bundle).toContain('getBestAttachment');

      // 6. Initial Zoom application
      expect(bundle).toContain('--card-width');
      expect(bundle).toContain('setZoom');
    });

    it('should verify packaged .xpi file exists and is valid zip', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const xpiPath = path.resolve(__dirname, '../build/zotero-cover-grid.xpi');

      expect(fs.existsSync(xpiPath)).toBe(true);
      const stats = fs.statSync(xpiPath);
      expect(stats.size).toBeGreaterThan(10000); // >10KB

      // Check zip magic header: PK\x03\x04
      const buffer = Buffer.alloc(4);
      const fd = fs.openSync(xpiPath, 'r');
      fs.readSync(fd, buffer, 0, 4, 0);
      fs.closeSync(fd);
      expect(buffer[0]).toBe(0x50); // P
      expect(buffer[1]).toBe(0x4b); // K
      expect(buffer[2]).toBe(0x03);
      expect(buffer[3]).toBe(0x04);
    });
  });
});
