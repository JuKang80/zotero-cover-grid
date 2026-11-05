import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { injectCoverGridUI } from '../src/ui/index';
import { openCoverGridTab, COVER_GRID_TAB_ID } from '../src/ui/tab-view';
import { injectToolbarControls } from '../src/ui/toolbar';
import { WindowCoverGridController } from '../src/sync/window-controller';
import { renderPdfThumbnail } from '../src/services/pdf-thumbnail-service';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

declare const ChromeUtils: any;
declare const Zotero_Tabs: any;

describe('Empirical Challenger M3: PDF Open, CMap Fonts, Zoom & Packaging', () => {
  let mockWin: any;
  let mockDoc: Document;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="zotero-items-pane">
        <div id="zotero-items-toolbar">
          <input id="zotero-items-search" />
        </div>
        <div id="zotero-items-tree"></div>
      </div>
    `;
    mockDoc = document;

    mockWin = {
      document: mockDoc,
      ZoteroPane: {
        viewItems: vi.fn(),
        openAttachment: vi.fn(),
        deleteSelectedItems: vi.fn(),
        getSortedItems: vi.fn(() => []),
        itemsView: {
          getSortedItems: vi.fn(() => []),
          selectItem: vi.fn(),
          onRefresh: {
            addListener: vi.fn(),
            removeListener: vi.fn()
          }
        },
        getSelectedCollection: vi.fn(() => ({ name: 'Test Collection' }))
      },
      Zotero: {
        Reader: {
          open: vi.fn().mockResolvedValue(undefined)
        },
        Prefs: {
          get: vi.fn((key: string) => {
            if (key === 'extensions.zotero.covergrid.cardWidth') return 220;
            return null;
          }),
          set: vi.fn()
        },
        Items: {
          get: vi.fn((id: number) => ({
            id,
            key: `ITEM_${id}`,
            isRegularItem: () => true,
            getBestAttachment: vi.fn().mockResolvedValue({ id: 8888, isPDFAttachment: () => true })
          })),
          getAll: vi.fn(() => [
            { id: 101, getField: () => 'DUMPED ALL 1', isRegularItem: () => true },
            { id: 102, getField: () => 'DUMPED ALL 2', isRegularItem: () => true }
          ])
        },
        Notifier: {
          registerObserver: vi.fn(() => 'test-observer-id'),
          unregisterObserver: vi.fn()
        }
      },
      Zotero_Tabs
    };

    (globalThis as any).IOUtils = {
      read: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
      exists: vi.fn().mockResolvedValue(true),
      stat: vi.fn().mockResolvedValue({ size: 1024, mtime: 123456789 })
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Double-Click Card PDF Opening
  // =========================================================================
  describe('Double-Click Card PDF Opening', () => {
    it('should invoke zp.viewItems with [item.id] when zp.viewItems succeeds', async () => {
      injectCoverGridUI(mockWin);
      const instance = mockWin.__zoteroCoverGridInstance;
      expect(instance).toBeDefined();

      const mockCardItem = {
        id: 1234,
        key: 'KEY1234',
        title: 'Quantum Computing',
        authors: 'Alice Smith',
        year: '2024'
      };

      // Trigger onOpenPdf directly via scroller options
      await instance.scroller.options.onOpenPdf(mockCardItem);

      expect(mockWin.ZoteroPane.viewItems).toHaveBeenCalledWith([1234]);
      expect(mockWin.Zotero.Reader.open).not.toHaveBeenCalled();
    });

    it('should catch zp.viewItems failure and fall back to zItem.getBestAttachment -> z.Reader.open(attachment.id)', async () => {
      // Simulate real Zotero 10 runtime behavior where viewItems expects item instances and throws if given raw IDs
      mockWin.ZoteroPane.viewItems.mockRejectedValue(
        new TypeError('item.isRegularItem is not a function')
      );

      injectCoverGridUI(mockWin);
      const instance = mockWin.__zoteroCoverGridInstance;

      const mockCardItem = {
        id: 5678,
        key: 'KEY5678',
        title: 'Deep Learning',
        authors: 'Yann LeCun',
        year: '2023'
      };

      await instance.scroller.options.onOpenPdf(mockCardItem);

      // Verify fallback was triggered
      expect(mockWin.ZoteroPane.viewItems).toHaveBeenCalledWith([5678]);
      expect(mockWin.Zotero.Items.get).toHaveBeenCalledWith(5678);
      // Reader.open MUST be invoked with attachment.id (8888), NOT with bibliographic item.id (5678)
      expect(mockWin.Zotero.Reader.open).toHaveBeenCalledWith(8888);
      expect(mockWin.Zotero.Reader.open).not.toHaveBeenCalledWith(5678);
    });

    it('should NEVER invoke z.Reader.open with item.id when getBestAttachment returns null', async () => {
      mockWin.ZoteroPane.viewItems.mockRejectedValue(new Error('viewItems failed'));
      // Return item with no attachments
      mockWin.Zotero.Items.get.mockReturnValue({
        id: 9999,
        getBestAttachment: vi.fn().mockResolvedValue(null)
      });

      injectCoverGridUI(mockWin);
      const instance = mockWin.__zoteroCoverGridInstance;

      await instance.scroller.options.onOpenPdf({ id: 9999, key: 'NO_ATT', title: 'No Attachment' });

      // In Zotero 10, Reader.open(item.id) crashes. It must not be called!
      expect(mockWin.Zotero.Reader.open).not.toHaveBeenCalled();
    });

    it('should handle PDF opening in dedicated tab mode with the same robust fallback', async () => {
      mockWin.ZoteroPane.viewItems.mockRejectedValue(new Error('Tab viewItems failed'));

      openCoverGridTab(mockWin);
      const tabInstance = mockWin.__zoteroCoverGridTabInstance;
      expect(tabInstance).toBeDefined();

      const mockCardItem = {
        id: 7777,
        key: 'KEY7777',
        title: 'Tab Item',
        authors: 'Bob',
        year: '2022'
      };

      await tabInstance.scroller.options.onOpenPdf(mockCardItem);

      expect(mockWin.ZoteroPane.viewItems).toHaveBeenCalledWith([7777]);
      expect(mockWin.Zotero.Reader.open).toHaveBeenCalledWith(8888);
      expect(mockWin.Zotero.Reader.open).not.toHaveBeenCalledWith(7777);
    });
  });

  // =========================================================================
  // 2. CMap & Standard Font Parameters in pdfjs.getDocument()
  // =========================================================================
  describe('CMap & Standard Font Parameters in PDF.js', () => {
    it('should pass cMapUrl, cMapPacked: true, and standardFontDataUrl to pdfjs.getDocument()', async () => {
      let capturedArgs: any = null;

      const mockPage = {
        rotate: 0,
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
        getViewport: vi.fn(() => ({ width: 600, height: 800 }))
      };
      const mockDoc = {
        numPages: 2,
        getPage: vi.fn().mockResolvedValue(mockPage),
        destroy: vi.fn().mockResolvedValue(undefined)
      };

      ChromeUtils.importESModule = vi.fn().mockResolvedValue({
        getDocument: vi.fn((params: any) => {
          capturedArgs = params;
          return { promise: Promise.resolve(mockDoc) };
        }),
        GlobalWorkerOptions: {}
      });

      const cardData: any = { id: 1, key: 'TEST', title: 'Korean Test' };

      await renderPdfThumbnail('/mock/paper.pdf', cardData);

      expect(capturedArgs).not.toBeNull();
      expect(capturedArgs.cMapUrl).toBe('resource://zotero/reader/pdf/web/cmaps/');
      expect(capturedArgs.cMapPacked).toBe(true);
      expect(capturedArgs.standardFontDataUrl).toBe('resource://zotero/reader/pdf/web/standard_fonts/');
      expect(typeof capturedArgs.onPassword).toBe('function');
    });

    it('should verify CMap and font URLs exist in compiled bootstrap.js bundle', () => {
      const bundlePath = path.resolve(__dirname, '../build/addon/bootstrap.js');
      expect(fs.existsSync(bundlePath)).toBe(true);
      const content = fs.readFileSync(bundlePath, 'utf8');

      expect(content).toContain('resource://zotero/reader/pdf/web/cmaps/');
      expect(content).toContain('resource://zotero/reader/pdf/web/standard_fonts/');
      expect(content).toMatch(/cMapPacked:\s*!0|cMapPacked:\s*true/);
    });
  });

  // =========================================================================
  // 3. Initial Card Width & Immediate CSS Variable Application
  // =========================================================================
  describe('Initial Card Width & Toolbar Initialization', () => {
    it('should apply --card-width CSS variable immediately upon toolbar initialization from preferences', () => {
      // Preference specifies 220
      mockWin.Zotero.Prefs.get.mockReturnValue(220);

      injectCoverGridUI(mockWin);

      const gridEl = mockDoc.getElementById('zotero-cover-grid');
      expect(gridEl).not.toBeNull();

      // Verify that --card-width was applied immediately to style
      expect(gridEl?.style.getPropertyValue('--card-width')).toBe('220px');

      const zoomSlider = mockDoc.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;
      expect(zoomSlider).not.toBeNull();
      expect(zoomSlider.value).toBe('220');
    });

    it('should clamp out-of-range initial preferences to [140, 340]', () => {
      // Out of bounds: 500 -> 340
      mockWin.Zotero.Prefs.get.mockReturnValue(500);
      injectCoverGridUI(mockWin);

      const gridEl = mockDoc.getElementById('zotero-cover-grid');
      expect(gridEl?.style.getPropertyValue('--card-width')).toBe('340px');

      // Cleanup
      mockWin.__zoteroCoverGridInstance?.cleanup();
      mockDoc.body.innerHTML = `
        <div id="zotero-items-pane">
          <div id="zotero-items-toolbar"><input id="zotero-items-search" /></div>
        </div>
      `;

      // Out of bounds: 80 -> 140
      mockWin.Zotero.Prefs.get.mockReturnValue(80);
      injectCoverGridUI(mockWin);

      const gridEl2 = mockDoc.getElementById('zotero-cover-grid');
      expect(gridEl2?.style.getPropertyValue('--card-width')).toBe('140px');
    });

    it('should fallback to default 180px when preference is undefined or invalid', () => {
      mockWin.Zotero.Prefs.get.mockReturnValue(null);
      injectCoverGridUI(mockWin);

      const gridEl = mockDoc.getElementById('zotero-cover-grid');
      expect(gridEl?.style.getPropertyValue('--card-width')).toBe('180px');
    });
  });

  // =========================================================================
  // 4. Sidebar Collection Sync & Empty Collection Fallback
  // =========================================================================
  describe('Sidebar Collection Sync & Empty Collection Fallback', () => {
    it('should hook zp.itemsView.onRefresh on init and remove on destroy', () => {
      const controller = new WindowCoverGridController(mockWin);
      const mockScroller: any = { setItems: vi.fn(), getItems: () => [], destroy: vi.fn() };
      controller.init(mockScroller);

      expect(mockWin.ZoteroPane.itemsView.onRefresh.addListener).toHaveBeenCalledTimes(1);

      controller.destroy();
      expect(mockWin.ZoteroPane.itemsView.onRefresh.removeListener).toHaveBeenCalledTimes(1);
    });

    it('should trigger reloadCurrentCollection when onRefresh listener fires', async () => {
      const controller = new WindowCoverGridController(mockWin);
      const mockScroller: any = { setItems: vi.fn(), getItems: () => [], destroy: vi.fn() };
      controller.init(mockScroller);

      // Get the callback passed to onRefresh.addListener
      const refreshCb = mockWin.ZoteroPane.itemsView.onRefresh.addListener.mock.calls[0][0];
      expect(typeof refreshCb).toBe('function');

      mockWin.ZoteroPane.itemsView.getSortedItems.mockReturnValue([
        {
          id: 501,
          key: 'K501',
          getField: (f: string) => (f === 'title' ? 'Refreshed Item' : '2025'),
          getCreators: () => [],
          getTags: () => [],
          isRegularItem: () => true
        }
      ]);

      await refreshCb();

      expect(mockScroller.setItems).toHaveBeenCalled();
      const rendered = mockScroller.setItems.mock.calls[0][0];
      expect(rendered.length).toBe(1);
      expect(rendered[0].title).toBe('Refreshed Item');
    });

    it('should NOT dump entire library when collection is empty (rawItems is [])', async () => {
      const controller = new WindowCoverGridController(mockWin);
      const mockScroller: any = { setItems: vi.fn(), getItems: () => [], destroy: vi.fn() };
      controller.init(mockScroller);

      // itemsView returns empty array [] (an empty collection selected by user)
      mockWin.ZoteroPane.itemsView.getSortedItems.mockReturnValue([]);

      await controller.reloadCurrentCollection();

      // Crucial: Zotero.Items.getAll() MUST NOT be called!
      expect(mockWin.Zotero.Items.getAll).not.toHaveBeenCalled();

      // Scroller should receive an empty array, rendering placeholder
      expect(mockScroller.setItems).toHaveBeenCalledWith([]);
    });

    it('should fallback to Zotero.Items.getAll() ONLY when rawItems is null/undefined', async () => {
      const origGetAll = (globalThis as any).Zotero?.Items?.getAll;
      (globalThis as any).Zotero.Items.getAll = mockWin.Zotero.Items.getAll;

      try {
        const controller = new WindowCoverGridController(mockWin);
        const mockScroller: any = { setItems: vi.fn(), getItems: () => [], destroy: vi.fn() };
        controller.init(mockScroller);

        // Neither itemsView nor getSortedItems exists or returns null
        mockWin.ZoteroPane.itemsView = null;
        mockWin.ZoteroPane.getSortedItems = null;

        await controller.reloadCurrentCollection();

        // In this case, fallback to Zotero.Items.getAll() IS expected
        expect(mockWin.Zotero.Items.getAll).toHaveBeenCalled();
      } finally {
        (globalThis as any).Zotero.Items.getAll = origGetAll;
      }
    });
  });

  // =========================================================================
  // 5. Production Packaging (.xpi) Verification
  // =========================================================================
  describe('Production Packaging (.xpi) Verification', () => {
    const xpiPath = path.resolve(__dirname, '../build/zotero-cover-grid.xpi');

    it('should ensure build/zotero-cover-grid.xpi exists and is a valid zip archive', () => {
      expect(fs.existsSync(xpiPath)).toBe(true);
      const stat = fs.statSync(xpiPath);
      expect(stat.size).toBeGreaterThan(1000); // Greater than 1KB

      // List zip contents using unzip -Z1 (zipinfo -1)
      const output = execSync(`unzip -Z1 "${xpiPath}"`, { encoding: 'utf8' });
      const entryNames = output.split('\n').filter(Boolean);

      // Root files required for Zotero 7 / 10 extension
      expect(entryNames).toContain('manifest.json');
      expect(entryNames).toContain('bootstrap.js');
      expect(entryNames).toContain('preferences.xhtml');
      expect(entryNames).toContain('icons/icon-48.png');
      expect(entryNames).toContain('locale/en-US/covergrid.ftl');
      expect(entryNames).toContain('locale/ko-KR/covergrid.ftl');

      // Verify no unwanted files (no tests, no node_modules, no .map files)
      const unwanted = entryNames.filter(
        (f) =>
          f.includes('tests/') ||
          f.includes('node_modules/') ||
          f.endsWith('.map') ||
          f.includes('.git')
      );
      expect(unwanted).toEqual([]);
    });

    it('should verify manifest.json inside .xpi specifies valid Zotero application ID and version ranges', () => {
      const manifestContent = execSync(`unzip -p "${xpiPath}" manifest.json`, { encoding: 'utf8' });
      const manifest = JSON.parse(manifestContent);

      expect(manifest.name).toBe('Zotero Cover Grid');
      expect(manifest.version).toBeDefined();
      expect(manifest.applications?.zotero?.id).toBe('zotero-cover-grid@antigravity.user');
      expect(manifest.applications?.zotero?.strict_min_version).toBe('6.999');
      expect(manifest.applications?.zotero?.strict_max_version).toBe('11.*');
    });

    it('should verify bootstrap.js inside .xpi defines required Zotero lifecycle hooks', () => {
      const content = execSync(`unzip -p "${xpiPath}" bootstrap.js`, { encoding: 'utf8' });
      expect(content).toContain('install');
      expect(content).toContain('startup');
      expect(content).toContain('shutdown');
      expect(content).toContain('uninstall');
      expect(content).toContain('onMainWindowLoad');
      expect(content).toContain('onMainWindowUnload');
    });
  });
});
