/**
 * UI injection and teardown lifecycle for Zotero MainWindow
 */
export function injectCoverGridUI(win: any) {
  const doc = win.document;
  if (!doc) return;

  const itemsPane = doc.getElementById('zotero-items-pane');
  if (!itemsPane) return;

  // 이미 주입되어 있는지 확인
  if (doc.getElementById('zotero-cover-grid')) return;

  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const gridEl = doc.createElementNS(HTML_NS, 'div');
  gridEl.id = 'zotero-cover-grid';
  gridEl.setAttribute('hidden', 'true');
  gridEl.className = 'zotero-cover-grid-root';

  // 뷰포트
  const viewport = doc.createElementNS(HTML_NS, 'div');
  viewport.className = 'grid-viewport';
  gridEl.appendChild(viewport);

  itemsPane.appendChild(gridEl);

  win.__zoteroCoverGridInstance = {
    gridElement: gridEl,
    cleanup: () => {
      gridEl.remove();
    }
  };
}

export function cleanupCoverGridUI(win: any) {
  const doc = win.document;
  if (!doc) return;

  doc.getElementById('zotero-cover-grid')?.remove();
  doc.getElementById('zotero-cover-grid-view-switcher')?.remove();
  doc.getElementById('zotero-cover-grid-zoom-container')?.remove();

  const itemsTree = doc.getElementById('zotero-items-tree');
  if (itemsTree) {
    itemsTree.hidden = false;
    itemsTree.removeAttribute('hidden');
    if (itemsTree.style) itemsTree.style.display = '';
  }

  win.__zoteroCoverGridInstance?.cleanup?.();
  delete win.__zoteroCoverGridInstance;
}
