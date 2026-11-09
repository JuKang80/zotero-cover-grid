declare const Zotero: any;
declare const ZoteroPane: any;

export class CollectionTreeDnD {
  private cleanup: (() => void) | null = null;
  private clickTimer: any = null;
  private isDestroyed = false;

  constructor(private win: any, private onReload: () => void) {}

  public bind(): void {
    this.unbind();
    this.isDestroyed = false;
    const doc = this.win?.document;
    if (!doc) return;
    const colTree = doc.getElementById('zotero-collections-tree');
    if (!colTree) return;

    const handleClick = () => {
      if (this.isDestroyed) return;
      if (this.clickTimer) clearTimeout(this.clickTimer);
      this.clickTimer = setTimeout(() => {
        this.clickTimer = null;
        if (!this.isDestroyed) this.onReload();
      }, 80);
    };

    const handleDragOver = (e: any) => {
      if (this.isDestroyed) return;
      if (
        e.dataTransfer?.types?.includes?.('zotero/item') ||
        e.dataTransfer?.types?.includes?.('text/x-zotero-drag-item')
      ) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDrop = async (e: any) => {
      if (this.isDestroyed) return;
      try {
        const rawJson = e.dataTransfer?.getData?.('text/x-zotero-drag-item');
        const rawIds = e.dataTransfer?.getData?.('zotero/item');
        let itemIDs: number[] = [];
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          if (Array.isArray(parsed?.itemIDs)) itemIDs = parsed.itemIDs.map(Number).filter(Boolean);
        } else if (rawIds) {
          itemIDs = String(rawIds).split(',').map(Number).filter(Boolean);
        }
        if (itemIDs.length === 0) return;

        const targetEl = e.target as HTMLElement | null;
        const rowEl = targetEl?.closest?.(
          '[data-collection-id], [data-row-index], .virtualized-table-row, [role="treeitem"], [role="row"]'
        ) as HTMLElement | null;
        const colIdAttr =
          targetEl?.getAttribute?.('data-collection-id') ||
          rowEl?.getAttribute?.('data-collection-id');
        const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
        const zpRef = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
        let targetCol = colIdAttr && z?.Collections?.get ? z.Collections.get(Number(colIdAttr)) : null;

        // Fallback: Zotero 10 VirtualizedTable row index -> collectionsView.getRow(idx).ref
        if (!targetCol && zpRef?.collectionsView) {
          const cv = zpRef.collectionsView;
          let rowIdx = -1;
          const idxAttr = rowEl?.getAttribute?.('data-row-index') ?? rowEl?.getAttribute?.('aria-rowindex');
          if (idxAttr != null && !isNaN(Number(idxAttr))) {
            rowIdx = Number(idxAttr);
          } else if (typeof cv.tree?.getRowAtClientY === 'function' && typeof e.clientY === 'number') {
            rowIdx = cv.tree.getRowAtClientY(e.clientY);
          }
          if (rowIdx >= 0 && typeof cv.getRow === 'function') {
            const treeRow = cv.getRow(rowIdx);
            const candidate = treeRow?.ref || treeRow;
            if (candidate && (typeof candidate.addItems === 'function' || typeof candidate.addItem === 'function')) {
              targetCol = candidate;
            } else if (candidate?.id && z?.Collections?.get) {
              targetCol = z.Collections.get(Number(candidate.id));
            }
          }
        }

        if (!targetCol && typeof (colTree as any).onDrop === 'function') {
          (colTree as any).onDrop(e, itemIDs);
          return;
        }
        if (targetCol) {
          e.preventDefault?.();
          e.stopPropagation?.();
          if (typeof targetCol.addItems === 'function') {
            await targetCol.addItems(itemIDs);
          } else if (typeof targetCol.addItem === 'function') {
            for (const id of itemIDs) {
              await targetCol.addItem(id);
            }
          }
          if (typeof targetCol.saveTx === 'function') {
            await targetCol.saveTx();
          }
        }
      } catch {}
    };

    const handleKeyDown = (e: any) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter'].includes(e.key)) {
        handleClick();
      }
    };

    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    let removeCollectionsViewListener: (() => void) | null = null;
    if (zp?.collectionsView?.onSelect?.addListener) {
      try {
        zp.collectionsView.onSelect.addListener(handleClick);
        removeCollectionsViewListener = () => {
          try { zp.collectionsView.onSelect.removeListener(handleClick); } catch {}
        };
      } catch {}
    }

    colTree.addEventListener('click', handleClick);
    colTree.addEventListener('select', handleClick);
    colTree.addEventListener('selectionchange', handleClick);
    colTree.addEventListener('keydown', handleKeyDown);
    colTree.addEventListener('keyup', handleClick);
    colTree.addEventListener('mouseup', handleClick);
    colTree.addEventListener('dragover', handleDragOver);
    colTree.addEventListener('drop', handleDrop);

    this.cleanup = () => {
      removeCollectionsViewListener?.();
      colTree.removeEventListener('click', handleClick);
      colTree.removeEventListener('select', handleClick);
      colTree.removeEventListener('selectionchange', handleClick);
      colTree.removeEventListener('keydown', handleKeyDown);
      colTree.removeEventListener('keyup', handleClick);
      colTree.removeEventListener('mouseup', handleClick);
      colTree.removeEventListener('dragover', handleDragOver);
      colTree.removeEventListener('drop', handleDrop);
    };
  }

  public unbind(): void {
    if (this.clickTimer) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
    this.cleanup?.();
    this.cleanup = null;
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.unbind();
  }
}
