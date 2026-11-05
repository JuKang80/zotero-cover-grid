import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ensureMainWindowStability, injectCoverGridUI, cleanupCoverGridUI } from '../src/ui/index';
import { injectToolbarControls } from '../src/ui/toolbar';
import { openCoverGridTab, COVER_GRID_TAB_ID } from '../src/ui/tab-view';
import { startup, onMainWindowLoad, shutdown } from '../src/bootstrap';

declare const Services: any;
declare const Zotero: any;
declare const Zotero_Tabs: any;

describe('Empirical Challenger M2: Main Window Stability & View Toggle Stress Test Harness', () => {
  let mockWin: any;

  function createMockWindow(id = 'main') {
    const doc = document.implementation.createHTMLDocument(`Mock Zotero Window ${id}`);
    doc.body.innerHTML = `
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

    const win: any = {
      document: doc,
      location: { href: 'chrome://zotero/content/standalone/zoteroPane.xhtml' },
      ZoteroPane: {
        loadedPromise: Promise.resolve(),
        itemsView: {
          rowProvider: { items: [] },
          selectItem: vi.fn(),
          onRefresh: { addListener: vi.fn(), removeListener: vi.fn() }
        },
        openAttachment: vi.fn(),
        deleteSelectedItems: vi.fn(),
        getSelectedItems: vi.fn(() => [])
      },
      Zotero_Tabs: {
        _tabs: [{ id: 'zotero-pane', type: 'library', title: 'My Library' }],
        add: vi.fn(({ id, type, title, onClose }: any) => {
          const container = doc.createElement('div');
          container.id = id;
          const tab = { id, type, title, onClose, container };
          win.Zotero_Tabs._tabs.push(tab);
          return { id, container };
        }),
        select: vi.fn((tabId: string) => {
          win.Zotero_Tabs._selectedID = tabId;
        }),
        close: vi.fn((tabId: string) => {
          const idx = win.Zotero_Tabs._tabs.findIndex((t: any) => t.id === tabId);
          if (idx !== -1) {
            const [closed] = win.Zotero_Tabs._tabs.splice(idx, 1);
            closed.onClose?.();
          }
        }),
        deck: doc.getElementById('tabs-deck')
      },
      setTimeout: (fn: Function, delay = 0) => setTimeout(fn, delay)
    };

    return win;
  }

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
      Zotero_Tabs: {
        _tabs: [{ id: 'zotero-pane', type: 'library', title: 'My Library' }],
        add: vi.fn(({ id, type, title, onClose }: any) => {
          const container = document.createElement('div');
          container.id = id;
          const tab = { id, type, title, onClose, container };
          mockWin.Zotero_Tabs._tabs.push(tab);
          return { id, container };
        }),
        select: vi.fn((tabId: string) => {
          mockWin.Zotero_Tabs._selectedID = tabId;
        }),
        close: vi.fn((tabId: string) => {
          const idx = mockWin.Zotero_Tabs._tabs.findIndex((t: any) => t.id === tabId);
          if (idx !== -1) {
            const [closed] = mockWin.Zotero_Tabs._tabs.splice(idx, 1);
            closed.onClose?.();
          }
        }),
        deck: document.getElementById('tabs-deck')
      },
      setTimeout: (fn: Function) => fn()
    };
  });

  afterEach(() => {
    cleanupCoverGridUI(mockWin);
    shutdown({}, 1);
  });

  describe('Stress Harness 1: White Screen Prevention & #zotero-tab-cover Resiliency', () => {
    it('survives rapid tab open-switch-close bursts where #zotero-tab-cover is unhidden', () => {
      const doc = document;
      const tabCover = doc.getElementById('zotero-tab-cover')!;
      const tabsDeck = doc.getElementById('tabs-deck') as any;

      injectCoverGridUI(mockWin);

      // Perform 50 rapid burst cycles of tab interactions
      for (let i = 0; i < 50; i++) {
        // Core Zotero event: tab opened, overlay becomes visible
        tabCover.className = 'zotero-tab-cover-active';
        expect(tabCover.classList.contains('hidden')).toBe(false);

        // Subsystem action: dedicated tab opened
        openCoverGridTab(mockWin);
        expect(tabCover.classList.contains('hidden')).toBe(true);

        // Tab switch simulation: overlay re-emerges
        tabCover.classList.remove('hidden');
        mockWin.Zotero_Tabs.select(COVER_GRID_TAB_ID);
        openCoverGridTab(mockWin);
        expect(tabCover.classList.contains('hidden')).toBe(true);

        // Tab closure simulation: deck resets to -1 and overlay pops up
        tabCover.classList.remove('hidden');
        tabsDeck.selectedIndex = -1;
        mockWin.Zotero_Tabs.close(COVER_GRID_TAB_ID);

        // ensureMainWindowStability must reliably re-hide overlay and reset deck
        ensureMainWindowStability(doc);
        expect(tabCover.classList.contains('hidden')).toBe(true);
        expect(tabsDeck.selectedIndex).toBe(0);
      }
    });

    it('handles adversarial mutations to #zotero-tab-cover without throwing or failing', () => {
      const doc = document;
      const tabCover = doc.getElementById('zotero-tab-cover')!;

      // 1. Extreme class attribute mutation
      tabCover.setAttribute('class', 'foo bar baz active visible modal');
      ensureMainWindowStability(doc);
      expect(tabCover.classList.contains('hidden')).toBe(true);

      // 2. Empty class
      tabCover.className = '';
      ensureMainWindowStability(doc);
      expect(tabCover.classList.contains('hidden')).toBe(true);

      // 3. Repeated 500-iteration stress loop
      for (let i = 0; i < 500; i++) {
        tabCover.className = i % 2 === 0 ? 'visible-overlay' : '';
        ensureMainWindowStability(doc);
        if (!tabCover.classList.contains('hidden')) {
          throw new Error(`Failed to hide tab cover on iteration ${i}`);
        }
      }
      expect(tabCover.classList.contains('hidden')).toBe(true);

      // 4. Detached/removed element
      tabCover.remove();
      expect(() => ensureMainWindowStability(doc)).not.toThrow();

      // 5. Malformed document mocks
      expect(() => ensureMainWindowStability(null)).not.toThrow();
      expect(() => ensureMainWindowStability(undefined)).not.toThrow();
      expect(() => ensureMainWindowStability({} as any)).not.toThrow();
      expect(() => ensureMainWindowStability({ getElementById: () => null } as any)).not.toThrow();
    });
  });

  describe('Stress Harness 2: #tabs-deck selectedIndex Recovery Stress', () => {
    it('restores selectedIndex to 0 for invalid values (-1, undefined) while strictly preserving valid indices', () => {
      const doc = document;
      const tabsDeck = doc.getElementById('tabs-deck') as any;

      const testCases: Array<{ input: any; expected: number; desc: string }> = [
        { input: -1, expected: 0, desc: 'selectedIndex === -1' },
        { input: undefined, expected: 0, desc: 'selectedIndex === undefined' },
        { input: 0, expected: 0, desc: 'selectedIndex === 0 (library view)' },
        { input: 1, expected: 1, desc: 'selectedIndex === 1 (first item tab)' },
        { input: 2, expected: 2, desc: 'selectedIndex === 2 (second item tab)' },
        { input: 10, expected: 10, desc: 'selectedIndex === 10 (tenth item tab)' },
      ];

      for (const tc of testCases) {
        tabsDeck.selectedIndex = tc.input;
        ensureMainWindowStability(doc);
        expect(tabsDeck.selectedIndex).toBe(tc.expected);
      }
    });

    it('survives 200 rapid alternating selectedIndex corruptions', () => {
      const doc = document;
      const tabsDeck = doc.getElementById('tabs-deck') as any;

      for (let i = 0; i < 200; i++) {
        // Corrupt to -1 or undefined
        tabsDeck.selectedIndex = i % 2 === 0 ? -1 : undefined;
        ensureMainWindowStability(doc);
        expect(tabsDeck.selectedIndex).toBe(0);

        // Switch to valid index e.g. 3
        tabsDeck.selectedIndex = 3;
        ensureMainWindowStability(doc);
        expect(tabsDeck.selectedIndex).toBe(3);
      }
    });
  });

  describe('Stress Harness 3: Concurrent initWindow & Guard Deduplication', () => {
    it('survives massive parallel concurrent initWindow invocations without duplicate UI or controllers', async () => {
      // Create a mock window with an asynchronous loadedPromise to maximize race window
      let resolveLoadedPromise!: () => void;
      const delayedPromise = new Promise<void>((resolve) => {
        resolveLoadedPromise = resolve;
      });

      const concurrentWin = createMockWindow('concurrent');
      concurrentWin.ZoteroPane.loadedPromise = delayedPromise;

      // Mock Services.wm.getEnumerator to return concurrentWin
      Services.wm.getEnumerator = vi.fn(() => {
        let yielded = false;
        return {
          hasMoreElements: () => !yielded,
          getNext: () => {
            yielded = true;
            return concurrentWin;
          }
        };
      });

      // Fire 50 concurrent onMainWindowLoad calls + startup call simultaneously
      const promises: Promise<any>[] = [];
      promises.push(new Promise((resolve) => {
        startup({ id: 'zotero-cover-grid@antigravity.user', version: '0.1.0' }, 1);
        resolve(true);
      }));

      for (let i = 0; i < 50; i++) {
        promises.push(new Promise((resolve) => {
          onMainWindowLoad({ window: concurrentWin });
          resolve(true);
        }));
      }

      // Allow microtasks to queue up waiting on loadedPromise
      await new Promise((r) => setTimeout(r, 10));

      // Resolve the delayed loadedPromise to wake up all pending initializations
      resolveLoadedPromise();

      // Wait for all async completions
      await Promise.all(promises);
      await new Promise((r) => setTimeout(r, 40));

      // Verification: exactly ONE instance injected
      const doc = concurrentWin.document;
      const gridElements = doc.querySelectorAll('#zotero-cover-grid');
      const toolbarGroups = doc.querySelectorAll('#zotero-cover-grid-toolbar-group');

      expect(gridElements.length).toBe(1);
      expect(toolbarGroups.length).toBe(1);

      expect(concurrentWin.__zoteroCoverGridInitialized).toBe(true);
      expect(concurrentWin.__zoteroCoverGridInitializing).toBe(false);
      expect(concurrentWin.__zoteroCoverGridInstance).toBeDefined();

      // Clean up
      cleanupCoverGridUI(concurrentWin);
    });

    it('initializes multiple distinct windows concurrently with complete state isolation', async () => {
      const win1 = createMockWindow('win1');
      const win2 = createMockWindow('win2');
      const win3 = createMockWindow('win3');

      // Initialize all 3 simultaneously
      await Promise.all([
        (async () => onMainWindowLoad({ window: win1 }))(),
        (async () => onMainWindowLoad({ window: win2 }))(),
        (async () => onMainWindowLoad({ window: win3 }))()
      ]);

      await new Promise((r) => setTimeout(r, 30));

      // Each window must have its own isolated DOM elements and instances
      for (const win of [win1, win2, win3]) {
        expect(win.__zoteroCoverGridInitialized).toBe(true);
        expect(win.__zoteroCoverGridInstance).toBeDefined();
        expect(win.document.querySelectorAll('#zotero-cover-grid').length).toBe(1);
        expect(win.document.querySelectorAll('#zotero-cover-grid-toolbar-group').length).toBe(1);
        cleanupCoverGridUI(win);
      }
    });

    it('gracefully ignores non-zoteroPane windows (e.g., preferences, quick search dialog)', async () => {
      const prefWin = createMockWindow('pref');
      prefWin.location.href = 'chrome://zotero/content/preferences/preferences.xhtml';

      onMainWindowLoad({ window: prefWin });
      await new Promise((r) => setTimeout(r, 20));

      expect(prefWin.__zoteroCoverGridInitialized).toBeUndefined();
      expect(prefWin.__zoteroCoverGridInstance).toBeUndefined();
      expect(prefWin.document.querySelectorAll('#zotero-cover-grid').length).toBe(0);
    });
  });

  describe('Stress Harness 4: View Toggle State Machine & Dynamic Styles Stress', () => {
    it('executes 100 rapid view toggles without DOM desynchronization or visual leaks', () => {
      injectCoverGridUI(mockWin);

      const btnList = document.getElementById('zotero-cover-grid-btn-list') as HTMLButtonElement;
      const btnGrid = document.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
      const zoomContainer = document.getElementById('zotero-cover-grid-zoom-container') as HTMLElement;
      const coverGrid = document.getElementById('zotero-cover-grid') as HTMLElement;
      const itemsTree = document.getElementById('zotero-items-tree') as HTMLElement;
      const toolbar = mockWin.__zoteroCoverGridInstance.toolbar;

      expect(toolbar.getView()).toBe('list');

      // Rapidly toggle 100 times: List -> Grid -> List -> Grid ...
      for (let i = 0; i < 100; i++) {
        if (i % 2 === 0) {
          btnGrid.click();
          expect(toolbar.getView()).toBe('grid');
          expect(btnGrid.classList.contains('active')).toBe(true);
          expect(btnList.classList.contains('active')).toBe(false);
          expect(coverGrid.hidden).toBe(false);
          expect(coverGrid.style.display).toBe('flex');
          expect(itemsTree.hidden).toBe(true);
          expect(itemsTree.style.display).toBe('none');
          expect(zoomContainer.hidden).toBe(false);
        } else {
          btnList.click();
          expect(toolbar.getView()).toBe('list');
          expect(btnList.classList.contains('active')).toBe(true);
          expect(btnGrid.classList.contains('active')).toBe(false);
          expect(coverGrid.hidden).toBe(true);
          expect(coverGrid.style.display).toBe('none');
          expect(itemsTree.hidden).toBe(false);
          expect(itemsTree.style.display).toBe('');
          expect(zoomContainer.hidden).toBe(true);
        }
      }

      // Final state after 100 toggles: even count ends on List
      expect(toolbar.getView()).toBe('list');
      expect(coverGrid.hidden).toBe(true);
      expect(itemsTree.hidden).toBe(false);
    });

    it('enforces boundary clamping [140, 340] and style updates across extreme zoom values', () => {
      injectCoverGridUI(mockWin);
      const toolbar = mockWin.__zoteroCoverGridInstance.toolbar;
      const coverGrid = document.getElementById('zotero-cover-grid') as HTMLElement;
      const zoomSlider = document.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;

      // Negative values
      toolbar.setZoom(-100);
      expect(zoomSlider.value).toBe('140');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('140px');
      expect(Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 140, true);

      // Low boundary
      toolbar.setZoom(139);
      expect(zoomSlider.value).toBe('140');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('140px');

      // Valid midpoint
      toolbar.setZoom(225);
      expect(zoomSlider.value).toBe('225');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('225px');
      expect(Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 225, true);

      // High boundary
      toolbar.setZoom(341);
      expect(zoomSlider.value).toBe('340');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('340px');

      // Astronomical value
      toolbar.setZoom(99999);
      expect(zoomSlider.value).toBe('340');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('340px');
    });
  });

  describe('Stress Harness 5: Gecko 140 ESR CSS Layout Rules Invariant Checks', () => {
    it('verifies grid.css contains mandatory [hidden] display:none !important rules', () => {
      const cssContent = fs.readFileSync(path.resolve(__dirname, '../src/styles/grid.css'), 'utf-8');
      expect(cssContent).toContain('[hidden]');
      expect(cssContent).toContain('display: none !important');
      expect(cssContent).toContain('#zotero-cover-grid[hidden]');
    });

    it('verifies grid.css contains mandatory flexbox anti-collapse rules (min-height: 0, flex: 1 1 0%)', () => {
      const cssContent = fs.readFileSync(path.resolve(__dirname, '../src/styles/grid.css'), 'utf-8');
      expect(cssContent).toContain('min-height: 0 !important');
      expect(cssContent).toContain('min-width: 0 !important');
      expect(cssContent).toContain('flex: 1 1 0% !important');
    });
  });

  describe('Stress Harness 6: Full Teardown & Idempotency Rollback', () => {
    it('repeated cleanupCoverGridUI calls are completely idempotent and do not leak or throw', () => {
      injectCoverGridUI(mockWin);

      expect(document.getElementById('zotero-cover-grid')).not.toBeNull();
      expect(document.getElementById('zotero-cover-grid-toolbar-group')).not.toBeNull();

      // Call cleanup 10 times consecutively
      for (let i = 0; i < 10; i++) {
        expect(() => cleanupCoverGridUI(mockWin)).not.toThrow();
        expect(document.getElementById('zotero-cover-grid')).toBeNull();
        expect(document.getElementById('zotero-cover-grid-toolbar-group')).toBeNull();
        expect(document.getElementById('zotero-cover-grid-zoom-container')).toBeNull();
        expect(mockWin.__zoteroCoverGridInstance).toBeUndefined();
      }
    });
  });
});
