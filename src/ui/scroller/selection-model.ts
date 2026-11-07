import { PaperCardData } from '../../types';

export class SelectionModel {
  public selectedIds = new Set<number>();
  public prevSelectedIds = new Set<number>();
  public anchorIndex = 0;
  public focusedIndex = -1;

  public selectSingle(index: number, id: number): void {
    this.selectedIds.clear();
    this.selectedIds.add(id);
    this.anchorIndex = index;
    this.focusedIndex = index;
  }

  public toggleItem(index: number, id: number): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
      this.focusedIndex = this.selectedIds.size > 0 ? index : -1;
    } else {
      this.selectedIds.add(id);
      this.focusedIndex = index;
      this.anchorIndex = index;
    }
  }

  public selectRange(index: number, items: PaperCardData[]): void {
    if (this.anchorIndex < 0) return;
    const start = Math.min(this.anchorIndex, index);
    const end = Math.max(this.anchorIndex, index);
    this.selectedIds.clear();
    for (let i = start; i <= end; i++) {
      if (items[i]) {
        this.selectedIds.add(items[i].id);
      }
    }
    this.focusedIndex = index;
  }

  public selectAll(items: PaperCardData[]): void {
    this.selectedIds.clear();
    for (const it of items) {
      this.selectedIds.add(it.id);
    }
    if (this.focusedIndex === -1 && items.length > 0) {
      this.focusedIndex = 0;
      this.anchorIndex = 0;
    }
  }

  public collapseSelection(items: PaperCardData[]): boolean {
    if (this.selectedIds.size <= 1) return false;
    const keepId =
      this.focusedIndex >= 0 && items[this.focusedIndex]
        ? items[this.focusedIndex].id
        : Array.from(this.selectedIds)[0];
    this.selectedIds.clear();
    if (keepId != null) {
      this.selectedIds.add(keepId);
      const idx = items.findIndex((it) => it.id === keepId);
      if (idx !== -1) {
        this.focusedIndex = idx;
        this.anchorIndex = idx;
      }
    }
    return true;
  }

  public handleCardClick(
    card: PaperCardData,
    index: number,
    event: MouseEvent,
    items: PaperCardData[]
  ): void {
    if (event.metaKey || event.ctrlKey) {
      this.toggleItem(index, card.id);
    } else if (event.shiftKey && this.anchorIndex >= 0) {
      this.selectRange(index, items);
    } else {
      this.selectSingle(index, card.id);
    }
  }

  public updateSelectionClasses(cardMap: Map<number, HTMLElement>): void {
    // High-performance O(1) differential DOM class update (zero reflow lag)
    for (const prevId of this.prevSelectedIds) {
      if (!this.selectedIds.has(prevId)) {
        cardMap.get(prevId)?.classList.remove('selected');
      }
    }
    for (const newId of this.selectedIds) {
      if (!this.prevSelectedIds.has(newId)) {
        cardMap.get(newId)?.classList.add('selected');
      }
    }
    this.prevSelectedIds = new Set(this.selectedIds);
  }

  public reconcileAfterMutation(items: PaperCardData[], cardMap: Map<number, HTMLElement>): void {
    const newIdSet = new Set(items.map((it) => it.id));

    // Remove deleted items
    for (const id of Array.from(this.selectedIds)) {
      if (!newIdSet.has(id)) {
        this.selectedIds.delete(id);
      }
    }

    if (items.length === 0) {
      this.focusedIndex = -1;
      this.anchorIndex = 0;
      return;
    }

    if (this.selectedIds.size === 0) {
      this.focusedIndex = -1;
      this.anchorIndex = 0;
    } else {
      const firstSelectedId = Array.from(this.selectedIds)[0];
      const idx = items.findIndex((it) => it.id === firstSelectedId);
      if (idx !== -1) {
        if (
          this.focusedIndex < 0 ||
          this.focusedIndex >= items.length ||
          !this.selectedIds.has(items[this.focusedIndex]?.id)
        ) {
          this.focusedIndex = idx;
        }
        if (this.anchorIndex < 0 || this.anchorIndex >= items.length) {
          this.anchorIndex = idx;
        }
      } else {
        this.focusedIndex = -1;
        this.anchorIndex = 0;
      }
    }
  }

  public setSelectedIds(ids: number[], items: PaperCardData[]): void {
    const cleanIds = (ids || []).map(Number).filter((n) => !isNaN(n) && n > 0);
    this.selectedIds = new Set(cleanIds);

    if (cleanIds.length === 0) {
      this.focusedIndex = -1;
      return;
    }

    if (items.length > 0 && cleanIds.length > 0) {
      const firstIdx = items.findIndex((it) => it.id === cleanIds[0]);
      if (firstIdx !== -1) {
        this.focusedIndex = firstIdx;
        this.anchorIndex = firstIdx;
      }
    }
  }

  public getSelectedIds(): number[] {
    return Array.from(this.selectedIds);
  }

  public getSelectedItems(items: PaperCardData[]): PaperCardData[] {
    return items.filter((it) => this.selectedIds.has(it.id));
  }

  public clear(): void {
    this.selectedIds.clear();
    this.prevSelectedIds.clear();
    this.focusedIndex = -1;
    this.anchorIndex = 0;
  }
}
