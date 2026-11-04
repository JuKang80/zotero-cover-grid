import { describe, it, expect, beforeEach } from 'vitest';
import { injectCoverGridUI, cleanupCoverGridUI } from '../src/ui/index';

describe('DOM Lifecycle & Injection', () => {
  let mockWin: any;

  beforeEach(() => {
    document.body.innerHTML = `
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

  it('should inject zotero-cover-grid into items pane as hidden by default', () => {
    injectCoverGridUI(mockWin);
    const grid = document.getElementById('zotero-cover-grid');
    expect(grid).not.toBeNull();
    expect(grid?.getAttribute('hidden')).toBe('true');
  });

  it('should cleanup injected UI and restore items tree', () => {
    injectCoverGridUI(mockWin);
    const tree = document.getElementById('zotero-items-tree')!;
    tree.hidden = true;

    cleanupCoverGridUI(mockWin);
    expect(document.getElementById('zotero-cover-grid')).toBeNull();
    expect(tree.hidden).toBe(false);
  });
});
