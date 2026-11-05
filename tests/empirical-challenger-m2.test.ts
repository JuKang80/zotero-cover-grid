import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { injectCoverGridUI, cleanupCoverGridUI, ensureMainWindowStability } from '../src/ui/index';
import { injectToolbarControls } from '../src/ui/toolbar';

declare const Zotero: any;

describe('Empirical Verification: Milestone 2 View Toggle, Zoom Slider & Stability', () => {
  let mockWin: any;
  let mockDoc: Document;
  let mockReloadCollection: any;

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

    mockDoc = document;
    mockReloadCollection = vi.fn();

    mockWin = {
      document: mockDoc,
      location: { href: 'chrome://zotero/content/standalone/zoteroPane.xhtml' },
      ZoteroPane: {
        loadedPromise: Promise.resolve(),
        itemsView: {
          rowProvider: { items: [] },
          selectItem: vi.fn()
        },
        openAttachment: vi.fn(),
        deleteSelectedItems: vi.fn(),
        getSelectedItems: vi.fn(() => [])
      },
      Zotero: {
        Prefs: {
          get: vi.fn((key: string) => {
            if (key === 'extensions.zotero.covergrid.cardWidth') return 180;
            return false;
          }),
          set: vi.fn()
        },
        Items: {
          get: vi.fn()
        },
        Notifier: {
          registerObserver: vi.fn(() => 'obs-1'),
          unregisterObserver: vi.fn()
        }
      },
      setTimeout: (fn: Function) => fn()
    };
  });

  afterEach(() => {
    cleanupCoverGridUI(mockWin);
  });

  describe('1. View Toggle Functionality (List mode <-> Grid mode)', () => {
    it('initializes in list mode with proper hidden and display attributes', () => {
      injectCoverGridUI(mockWin);

      const btnList = mockDoc.getElementById('zotero-cover-grid-btn-list') as HTMLButtonElement;
      const btnGrid = mockDoc.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
      const coverGrid = mockDoc.getElementById('zotero-cover-grid') as HTMLElement;
      const itemsTree = mockDoc.getElementById('zotero-items-tree') as HTMLElement;
      const zoomContainer = mockDoc.getElementById('zotero-cover-grid-zoom-container') as HTMLElement;

      // Active button states
      expect(btnList.classList.contains('active')).toBe(true);
      expect(btnList.getAttribute('aria-pressed')).toBe('true');
      expect(btnGrid.classList.contains('active')).toBe(false);
      expect(btnGrid.getAttribute('aria-pressed')).toBe('false');

      // Cover grid should be hidden initially
      expect(coverGrid.hidden).toBe(true);
      expect(coverGrid.getAttribute('hidden')).toBe('true');

      // Zoom container should be hidden initially
      expect(zoomContainer.hidden).toBe(true);
      expect(zoomContainer.getAttribute('hidden')).toBe('true');
      expect(zoomContainer.style.display).toBe('none');

      // Items tree should be visible
      expect(itemsTree.hidden).toBe(false);
      expect(itemsTree.getAttribute('hidden')).toBeNull();
      expect(itemsTree.style.display).toBe('');
    });

    it('switches to grid mode: toggles hidden attribute, style display, zoom container, and calls reloadCurrentCollection', () => {
      injectCoverGridUI(mockWin);

      // Mock controller instance to verify collection reload
      mockWin.__zoteroCoverGridInstance.controller = {
        reloadCurrentCollection: mockReloadCollection,
        destroy: vi.fn(),
        syncTagStatus: vi.fn()
      };

      const btnGrid = mockDoc.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
      const btnList = mockDoc.getElementById('zotero-cover-grid-btn-list') as HTMLButtonElement;
      const coverGrid = mockDoc.getElementById('zotero-cover-grid') as HTMLElement;
      const itemsTree = mockDoc.getElementById('zotero-items-tree') as HTMLElement;
      const zoomContainer = mockDoc.getElementById('zotero-cover-grid-zoom-container') as HTMLElement;

      // Click Grid button
      btnGrid.click();

      // Button state
      expect(btnGrid.classList.contains('active')).toBe(true);
      expect(btnGrid.getAttribute('aria-pressed')).toBe('true');
      expect(btnList.classList.contains('active')).toBe(false);
      expect(btnList.getAttribute('aria-pressed')).toBe('false');

      // Cover grid: hidden removed, display flex !important
      expect(coverGrid.hidden).toBe(false);
      expect(coverGrid.getAttribute('hidden')).toBeNull();
      expect(coverGrid.style.display).toBe('flex');

      // Items tree: hidden set, display none !important
      expect(itemsTree.hidden).toBe(true);
      expect(itemsTree.getAttribute('hidden')).toBe('true');
      expect(itemsTree.style.display).toBe('none');

      // Zoom container: hidden removed, display inline-flex
      expect(zoomContainer.hidden).toBe(false);
      expect(zoomContainer.getAttribute('hidden')).toBeNull();
      expect(zoomContainer.style.display).toBe('inline-flex');

      // Collection reload was triggered!
      expect(mockReloadCollection).toHaveBeenCalledTimes(1);
    });

    it('switches back to list mode: restores hidden and display styles, hides zoom container, does not trigger reload', () => {
      injectCoverGridUI(mockWin);

      mockWin.__zoteroCoverGridInstance.controller = {
        reloadCurrentCollection: mockReloadCollection,
        destroy: vi.fn(),
        syncTagStatus: vi.fn()
      };

      const btnGrid = mockDoc.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
      const btnList = mockDoc.getElementById('zotero-cover-grid-btn-list') as HTMLButtonElement;
      const coverGrid = mockDoc.getElementById('zotero-cover-grid') as HTMLElement;
      const itemsTree = mockDoc.getElementById('zotero-items-tree') as HTMLElement;
      const zoomContainer = mockDoc.getElementById('zotero-cover-grid-zoom-container') as HTMLElement;

      // Switch to grid first
      btnGrid.click();
      expect(mockReloadCollection).toHaveBeenCalledTimes(1);

      // Switch back to list
      btnList.click();

      // Button state
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

      // Items tree restored
      expect(itemsTree.hidden).toBe(false);
      expect(itemsTree.getAttribute('hidden')).toBeNull();
      expect(itemsTree.style.display).toBe('');

      // Collection reload should NOT have been called again during list switch
      expect(mockReloadCollection).toHaveBeenCalledTimes(1);
    });

    it('maintains strict consistency over rapid multiple toggles', () => {
      injectCoverGridUI(mockWin);

      mockWin.__zoteroCoverGridInstance.controller = {
        reloadCurrentCollection: mockReloadCollection,
        destroy: vi.fn(),
        syncTagStatus: vi.fn()
      };

      const btnGrid = mockDoc.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
      const btnList = mockDoc.getElementById('zotero-cover-grid-btn-list') as HTMLButtonElement;
      const coverGrid = mockDoc.getElementById('zotero-cover-grid') as HTMLElement;
      const itemsTree = mockDoc.getElementById('zotero-items-tree') as HTMLElement;
      const zoomContainer = mockDoc.getElementById('zotero-cover-grid-zoom-container') as HTMLElement;

      for (let i = 0; i < 5; i++) {
        btnGrid.click();
        expect(coverGrid.hidden).toBe(false);
        expect(coverGrid.style.display).toBe('flex');
        expect(itemsTree.hidden).toBe(true);
        expect(zoomContainer.hidden).toBe(false);

        btnList.click();
        expect(coverGrid.hidden).toBe(true);
        expect(coverGrid.style.display).toBe('none');
        expect(itemsTree.hidden).toBe(false);
        expect(zoomContainer.hidden).toBe(true);
      }

      expect(mockReloadCollection).toHaveBeenCalledTimes(5);
    });

    it('handles toggle gracefully when controller is null or throws', () => {
      injectCoverGridUI(mockWin);
      mockWin.__zoteroCoverGridInstance.controller = null;

      const btnGrid = mockDoc.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
      expect(() => btnGrid.click()).not.toThrow();

      mockWin.__zoteroCoverGridInstance.controller = {
        reloadCurrentCollection: () => {
          throw new Error('Simulation of collection reload failure');
        }
      };
      // Expect click to propagate error or handle gracefully
      expect(() => btnGrid.click()).toThrow('Simulation of collection reload failure');
    });

    it('toolbar controller interface setView and getView work programmatically', () => {
      injectCoverGridUI(mockWin);
      const toolbar = mockWin.__zoteroCoverGridInstance.toolbar;

      expect(toolbar.getView()).toBe('list');

      toolbar.setView('grid');
      expect(toolbar.getView()).toBe('grid');
      expect(mockDoc.getElementById('zotero-cover-grid')?.hidden).toBe(false);

      toolbar.setView('list');
      expect(toolbar.getView()).toBe('list');
      expect(mockDoc.getElementById('zotero-cover-grid')?.hidden).toBe(true);
    });
  });

  describe('2. Zoom Slider & CSS Custom Property & Prefs Synchronization', () => {
    it('reads initial card width from preferences if present', () => {
      mockWin.Zotero.Prefs.get = vi.fn((key: string) => {
        if (key === 'extensions.zotero.covergrid.cardWidth') return 240;
        return null;
      });

      const toolbar = injectToolbarControls(mockWin);
      const zoomSlider = mockDoc.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;

      expect(zoomSlider.value).toBe('240');
      toolbar?.destroy();
    });

    it('clamps initial card width if preference exceeds [140, 340]', () => {
      mockWin.Zotero.Prefs.get = vi.fn((key: string) => {
        if (key === 'extensions.zotero.covergrid.cardWidth') return 500;
        return null;
      });

      const toolbar = injectToolbarControls(mockWin);
      const zoomSlider = mockDoc.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;

      expect(zoomSlider.value).toBe('340');
      toolbar?.destroy();
    });

    it('falls back to default 180 if preference is invalid or throws', () => {
      mockWin.Zotero.Prefs.get = vi.fn(() => {
        throw new Error('Pref error');
      });

      const toolbar = injectToolbarControls(mockWin);
      const zoomSlider = mockDoc.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;

      expect(zoomSlider.value).toBe('180');
      toolbar?.destroy();
    });

    it('updates --card-width CSS variable and Zotero.Prefs for values 140, 200, 340', () => {
      injectCoverGridUI(mockWin);
      const toolbar = mockWin.__zoteroCoverGridInstance.toolbar;
      const coverGrid = mockDoc.getElementById('zotero-cover-grid') as HTMLElement;
      const zoomSlider = mockDoc.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;

      // Test 140
      toolbar.setZoom(140);
      expect(zoomSlider.value).toBe('140');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('140px');
      expect(mockWin.Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 140, true);

      // Test 200
      toolbar.setZoom(200);
      expect(zoomSlider.value).toBe('200');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('200px');
      expect(mockWin.Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 200, true);

      // Test 340
      toolbar.setZoom(340);
      expect(zoomSlider.value).toBe('340');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('340px');
      expect(mockWin.Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 340, true);
    });

    it('clamps values out of bounds to [140, 340]', () => {
      injectCoverGridUI(mockWin);
      const toolbar = mockWin.__zoteroCoverGridInstance.toolbar;
      const coverGrid = mockDoc.getElementById('zotero-cover-grid') as HTMLElement;
      const zoomSlider = mockDoc.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;

      // Below 140 (e.g. 50)
      toolbar.setZoom(50);
      expect(zoomSlider.value).toBe('140');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('140px');
      expect(mockWin.Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 140, true);

      // Above 340 (e.g. 450)
      toolbar.setZoom(450);
      expect(zoomSlider.value).toBe('340');
      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('340px');
      expect(mockWin.Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 340, true);
    });

    it('slider input event dispatches and updates CSS property and Prefs', () => {
      injectCoverGridUI(mockWin);
      const coverGrid = mockDoc.getElementById('zotero-cover-grid') as HTMLElement;
      const zoomSlider = mockDoc.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;

      zoomSlider.value = '220';
      zoomSlider.dispatchEvent(new Event('input'));

      expect(coverGrid.style.getPropertyValue('--card-width')).toBe('220px');
      expect(mockWin.Zotero.Prefs.set).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 220, true);
    });

    it('setZoom is resilient when #zotero-cover-grid is not in DOM or Prefs throws', () => {
      const toolbar = injectToolbarControls(mockWin);
      // Cover grid not injected
      expect(() => toolbar?.setZoom(200)).not.toThrow();

      mockWin.Zotero.Prefs.set = vi.fn(() => {
        throw new Error('Prefs error');
      });
      expect(() => toolbar?.setZoom(200)).not.toThrow();

      toolbar?.destroy();
    });
  });

  describe('3. Teardown & DOM Cleanup Verification', () => {
    it('cleanupCoverGridUI completely removes injected elements and restores native tree', () => {
      injectCoverGridUI(mockWin);

      expect(mockDoc.getElementById('zotero-cover-grid')).not.toBeNull();
      expect(mockDoc.getElementById('zotero-cover-grid-toolbar-group')).not.toBeNull();

      // Add a style tag with id 'zotero-cover-grid-style' to verify it gets removed on cleanup
      const testStyle = mockDoc.createElement('style');
      testStyle.id = 'zotero-cover-grid-style';
      mockDoc.body.appendChild(testStyle);
      expect(mockDoc.getElementById('zotero-cover-grid-style')).not.toBeNull();

      cleanupCoverGridUI(mockWin);

      expect(mockDoc.getElementById('zotero-cover-grid')).toBeNull();
      expect(mockDoc.getElementById('zotero-cover-grid-toolbar-group')).toBeNull();
      expect(mockDoc.getElementById('zotero-cover-grid-zoom-container')).toBeNull();
      expect(mockDoc.getElementById('zotero-cover-grid-style')).toBeNull();
      expect(mockWin.__zoteroCoverGridInstance).toBeUndefined();

      const itemsTree = mockDoc.getElementById('zotero-items-tree') as HTMLElement;
      expect(itemsTree.hidden).toBe(false);
      expect(itemsTree.getAttribute('hidden')).toBeNull();
      expect(itemsTree.style.display).toBe('');
    });
  });
});
