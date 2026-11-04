import { describe, it, expect, beforeEach } from 'vitest';
import { injectCoverGridUI, cleanupCoverGridUI } from '../src/ui/index';

describe('Unload Cleanup & 5-Step Rollback', () => {
  let mockWin: any;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="zotero-toolbar">
        <input id="zotero-search-box" />
      </div>
      <div id="zotero-items-pane">
        <div id="zotero-items-tree"></div>
      </div>
    `;
    mockWin = {
      document,
      location: { href: 'chrome://zotero/content/standalone/zoteroPane.xhtml' },
      ZoteroPane: { loadedPromise: Promise.resolve() }
    };
  });

  it('should inject toolbar switcher and zoom slider', () => {
    injectCoverGridUI(mockWin);

    expect(document.getElementById('zotero-cover-grid')).not.toBeNull();
    expect(document.getElementById('zotero-cover-grid-toolbar-group')).not.toBeNull();
    expect(document.getElementById('zotero-cover-grid-view-switcher')).not.toBeNull();
    expect(document.getElementById('zotero-cover-grid-zoom-container')).not.toBeNull();
  });

  it('should switch between list and grid mode on button click', () => {
    injectCoverGridUI(mockWin);

    const btnGrid = document.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
    const btnList = document.getElementById('zotero-cover-grid-btn-list') as HTMLButtonElement;
    const itemsTree = document.getElementById('zotero-items-tree')!;
    const coverGrid = document.getElementById('zotero-cover-grid')!;

    // Initial state: list mode
    expect(itemsTree.hidden).toBe(false);
    expect(coverGrid.hidden).toBe(true);

    // Switch to grid mode
    btnGrid.click();
    expect(itemsTree.hidden).toBe(true);
    expect(coverGrid.hidden).toBe(false);
    expect(btnGrid.classList.contains('active')).toBe(true);
    expect(btnList.classList.contains('active')).toBe(false);

    // Switch back to list mode
    btnList.click();
    expect(itemsTree.hidden).toBe(false);
    expect(coverGrid.hidden).toBe(true);
    expect(btnList.classList.contains('active')).toBe(true);
    expect(btnGrid.classList.contains('active')).toBe(false);
  });

  it('should adjust --card-width when zoom slider changes', () => {
    injectCoverGridUI(mockWin);

    const btnGrid = document.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
    btnGrid.click();

    const slider = document.getElementById('zotero-cover-grid-zoom-slider') as HTMLInputElement;
    const coverGrid = document.getElementById('zotero-cover-grid')!;

    slider.value = '240';
    slider.dispatchEvent(new Event('input'));

    expect(coverGrid.style.getPropertyValue('--card-width')).toBe('240px');
  });

  it('should execute 5-step rollback and restore native tree even if in grid view when unloaded', () => {
    injectCoverGridUI(mockWin);

    // Switch to grid view so items tree is hidden
    const btnGrid = document.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
    btnGrid.click();
    const itemsTree = document.getElementById('zotero-items-tree')!;
    expect(itemsTree.hidden).toBe(true);

    // Execute unload cleanup
    cleanupCoverGridUI(mockWin);

    // Step 1: Toolbar group and switcher removed
    expect(document.getElementById('zotero-cover-grid-toolbar-group')).toBeNull();
    expect(document.getElementById('zotero-cover-grid-view-switcher')).toBeNull();

    // Step 2: Zoom container removed
    expect(document.getElementById('zotero-cover-grid-zoom-container')).toBeNull();

    // Step 3: Cover grid removed
    expect(document.getElementById('zotero-cover-grid')).toBeNull();

    // Step 4: Items tree restored
    expect(itemsTree.hidden).toBe(false);
    expect(itemsTree.getAttribute('hidden')).toBeNull();

    // Step 5: Instance reference cleared
    expect(mockWin.__zoteroCoverGridInstance).toBeUndefined();
  });
});
