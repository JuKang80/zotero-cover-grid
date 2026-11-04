import { injectToolbarControls, ToolbarController } from './toolbar';

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

  // 카드 컨테이너
  const cardsContainer = doc.createElementNS(HTML_NS, 'div');
  cardsContainer.className = 'grid-cards-container';
  viewport.appendChild(cardsContainer);

  itemsPane.appendChild(gridEl);

  // 툴바 주입
  const toolbar = injectToolbarControls(win);

  win.__zoteroCoverGridInstance = {
    gridElement: gridEl,
    viewportElement: viewport,
    cardsContainer,
    toolbar,
    cleanup: () => {
      toolbar?.destroy();
      gridEl.remove();
    }
  };
}

/**
 * 5-Step complete rollback cleanup
 */
export function cleanupCoverGridUI(win: any) {
  const doc = win.document;
  if (!doc) return;

  // Step 1: Remove toolbar switcher & group
  doc.getElementById('zotero-cover-grid-toolbar-group')?.remove();
  doc.getElementById('zotero-cover-grid-view-switcher')?.remove();

  // Step 2: Remove zoom container
  doc.getElementById('zotero-cover-grid-zoom-container')?.remove();

  // Step 3: Remove cover grid container
  doc.getElementById('zotero-cover-grid')?.remove();

  // Step 4: Restore native items tree
  const itemsTree = doc.getElementById('zotero-items-tree');
  if (itemsTree) {
    itemsTree.hidden = false;
    itemsTree.removeAttribute('hidden');
    if (itemsTree.style) itemsTree.style.display = '';
  }

  // Step 5: Tear down instance controller and clear window reference
  win.__zoteroCoverGridInstance?.cleanup?.();
  delete win.__zoteroCoverGridInstance;
}
