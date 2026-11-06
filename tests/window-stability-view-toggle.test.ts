import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureMainWindowStability, injectCoverGridUI, cleanupCoverGridUI } from '../src/ui/index';
import { injectToolbarControls } from '../src/ui/toolbar';
import { startup, onMainWindowLoad, shutdown } from '../src/bootstrap';

declare const Services: any;
declare const Zotero: any;

describe('Milestone 2: Main Window Stability & View Toggle (R2)', () => {
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
          selectItem: vi.fn()
        },
        openAttachment: vi.fn(),
        deleteSelectedItems: vi.fn()
      },
      setTimeout: (fn: Function) => fn()
    };
  });

  afterEach(() => {
    cleanupCoverGridUI(mockWin);
  });

  describe('White Screen Safeguards (#zotero-tab-cover & #tabs-deck)', () => {
    it('should dismiss #zotero-tab-cover overlay by adding hidden class', () => {
      const tabCover = document.getElementById('zotero-tab-cover')!;
      expect(tabCover.classList.contains('hidden')).toBe(false);

      ensureMainWindowStability(document);

      expect(tabCover.classList.contains('hidden')).toBe(true);
    });

    it('should restore #tabs-deck selectedIndex to 0 when it is -1', () => {
      const tabsDeck = document.getElementById('tabs-deck') as any;
      tabsDeck.selectedIndex = -1;

      ensureMainWindowStability(document);

      expect(tabsDeck.selectedIndex).toBe(0);
    });

    it('should restore #tabs-deck selectedIndex to 0 when it is undefined', () => {
      const tabsDeck = document.getElementById('tabs-deck') as any;
      tabsDeck.selectedIndex = undefined;

      ensureMainWindowStability(document);

      expect(tabsDeck.selectedIndex).toBe(0);
    });

    it('should preserve #tabs-deck selectedIndex when it is already valid (e.g. 2)', () => {
      const tabsDeck = document.getElementById('tabs-deck') as any;
      tabsDeck.selectedIndex = 2;

      ensureMainWindowStability(document);

      expect(tabsDeck.selectedIndex).toBe(2);
    });

    it('should handle null/missing elements gracefully without throwing', () => {
      expect(() => ensureMainWindowStability(null)).not.toThrow();
      expect(() => ensureMainWindowStability({})).not.toThrow();
    });

    it('should ensure main window stability during injectCoverGridUI', () => {
      const tabCover = document.getElementById('zotero-tab-cover')!;
      const tabsDeck = document.getElementById('tabs-deck') as any;
      tabsDeck.selectedIndex = -1;
      expect(tabCover.classList.contains('hidden')).toBe(false);

      injectCoverGridUI(mockWin);

      expect(tabCover.classList.contains('hidden')).toBe(true);
      expect(tabsDeck.selectedIndex).toBe(0);
    });
  });

  describe('Window Initialization Concurrency & Deduplication', () => {
    afterEach(() => {
      shutdown({}, 1);
    });

    it('should protect against concurrent initialization calls (startup + onMainWindowLoad race)', async () => {
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

      // Simultaneous calls
      startup({ id: 'zotero-cover-grid@antigravity.user', version: '0.1.0' }, 1);
      onMainWindowLoad({ window: mockWin });

      await new Promise((r) => setTimeout(r, 30));

      // Should be successfully initialized exactly once
      expect(mockWin.__zoteroCoverGridInstance).toBeDefined();
      expect(mockWin.__zoteroCoverGridInitialized).toBe(true);
      expect(document.querySelectorAll('#zotero-cover-grid').length).toBe(1);
      expect(document.querySelectorAll('#zotero-cover-grid-toolbar-group').length).toBe(1);
    });

    it('should automatically close deprecated legacy dedicated tabs during startup initialization', async () => {
      (mockWin as any).Zotero_Tabs = {
        _tabs: [{ id: 'zotero-cover-grid-tab', type: 'custom', title: 'Cover Grid' }],
        close: vi.fn()
      };

      onMainWindowLoad({ window: mockWin });
      await new Promise((r) => setTimeout(r, 20));

      expect((mockWin as any).Zotero_Tabs.close).toHaveBeenCalledWith('zotero-cover-grid-tab');
    });
  });

  describe('View Toggle Buttons & Synchronization', () => {
    it('should initialize toolbar controls in list mode by default with zoom slider hidden', () => {
      const toolbar = injectToolbarControls(mockWin);
      expect(toolbar).not.toBeNull();

      const btnList = document.getElementById('zotero-cover-grid-btn-list') as HTMLButtonElement;
      const btnGrid = document.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
      const zoomContainer = document.getElementById('zotero-cover-grid-zoom-container') as HTMLElement;
      const itemsTree = document.getElementById('zotero-items-tree')!;

      expect(btnList.classList.contains('active')).toBe(true);
      expect(btnList.getAttribute('aria-pressed')).toBe('true');
      expect(btnGrid.classList.contains('active')).toBe(false);
      expect(btnGrid.getAttribute('aria-pressed')).toBe('false');

      expect(zoomContainer.style.display).toBe('none');
      expect(zoomContainer.getAttribute('hidden')).toBe('true');
      expect(itemsTree.hidden).toBe(false);

      toolbar?.destroy();
    });

    it('should switch reliably between list and grid views and synchronize visibility', () => {
      injectCoverGridUI(mockWin);

      const btnList = document.getElementById('zotero-cover-grid-btn-list') as HTMLButtonElement;
      const btnGrid = document.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
      const zoomContainer = document.getElementById('zotero-cover-grid-zoom-container') as HTMLElement;
      const coverGrid = document.getElementById('zotero-cover-grid') as HTMLElement;
      const itemsTree = document.getElementById('zotero-items-tree') as HTMLElement;

      // 1. Switch to Grid View
      btnGrid.click();

      expect(btnGrid.classList.contains('active')).toBe(true);
      expect(btnGrid.getAttribute('aria-pressed')).toBe('true');
      expect(btnList.classList.contains('active')).toBe(false);
      expect(btnList.getAttribute('aria-pressed')).toBe('false');

      // Grid view visible
      expect(coverGrid.hidden).toBe(false);
      expect(coverGrid.getAttribute('hidden')).toBeNull();
      expect(coverGrid.style.display).toBe('flex');

      // Zoom container visible
      expect(zoomContainer.hidden).toBe(false);
      expect(zoomContainer.getAttribute('hidden')).toBeNull();
      expect(zoomContainer.style.display).toBe('inline-flex');

      // Items tree hidden
      expect(itemsTree.hidden).toBe(true);
      expect(itemsTree.getAttribute('hidden')).toBe('true');
      expect(itemsTree.style.display).toBe('none');

      // 2. Switch back to List View
      btnList.click();

      expect(btnList.classList.contains('active')).toBe(true);
      expect(btnList.getAttribute('aria-pressed')).toBe('true');
      expect(btnGrid.classList.contains('active')).toBe(false);
      expect(btnGrid.getAttribute('aria-pressed')).toBe('false');

      // Cover grid hidden
      expect(coverGrid.hidden).toBe(true);
      expect(coverGrid.getAttribute('hidden')).toBe('true');
      expect(coverGrid.style.display).toBe('none');

      // Zoom container hidden
      expect(zoomContainer.hidden).toBe(true);
      expect(zoomContainer.getAttribute('hidden')).toBe('true');
      expect(zoomContainer.style.display).toBe('none');

      // Items tree visible
      expect(itemsTree.hidden).toBe(false);
      expect(itemsTree.getAttribute('hidden')).toBeNull();
      expect(itemsTree.style.display).toBe('');
    });

    it('should adjust card zoom, clamp values, set CSS custom property, and persist to Prefs', () => {
      injectCoverGridUI(mockWin);

      const toolbar = mockWin.__zoteroCoverGridInstance?.toolbar;
      expect(toolbar).toBeDefined();

      const coverGrid = document.getElementById('zotero-cover-grid') as HTMLElement;
      const zoomSlider = document.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;

      // Set zoom to 240px
      toolbar.setZoom(240);
      expect(zoomSlider.value).toBe('240');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('240px');
      expect(Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 240, true);

      // Clamp upper bound: 400 -> 340
      toolbar.setZoom(400);
      expect(zoomSlider.value).toBe('340');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('340px');
      expect(Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 340, true);

      // Clamp lower bound: 100 -> 140
      toolbar.setZoom(100);
      expect(zoomSlider.value).toBe('140');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('140px');
      expect(Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 140, true);
    });

    it('should ensure main window stability when toggling to grid view', () => {
      injectCoverGridUI(mockWin);

      const tabCover = document.getElementById('zotero-tab-cover')!;
      const tabsDeck = document.getElementById('tabs-deck') as any;

      // Simulate a desynchronization condition
      tabCover.classList.remove('hidden');
      tabsDeck.selectedIndex = -1;

      const btnGrid = document.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
      btnGrid.click();

      expect(tabCover.classList.contains('hidden')).toBe(true);
      expect(tabsDeck.selectedIndex).toBe(0);
    });
  });
});
