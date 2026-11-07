import { PaperCardData } from '../../types';

export class ScrollAnchorTracker {
  public findTopVisibleItem(
    items: PaperCardData[],
    cardMap: Map<number, HTMLElement>,
    viewport: HTMLElement
  ): PaperCardData | null {
    if (items.length === 0) return null;
    const vpTop = viewport?.scrollTop || 0;
    for (const item of items) {
      const el = cardMap.get(item.id);
      if (el && el.offsetTop >= vpTop) {
        return item;
      }
    }
    return items[0] || null;
  }

  public getItemOffset(id: number, cardMap: Map<number, HTMLElement>): number {
    const el = cardMap.get(id);
    return el ? el.offsetTop : 0;
  }

  public restoreAnchor(
    anchor: PaperCardData | null,
    oldAnchorOffset: number,
    cardMap: Map<number, HTMLElement>,
    viewport: HTMLElement
  ): void {
    if (anchor && cardMap.has(anchor.id)) {
      const newAnchorOffset = this.getItemOffset(anchor.id, cardMap);
      const delta = newAnchorOffset - oldAnchorOffset;
      if (delta !== 0 && viewport) {
        viewport.scrollTop += delta;
      }
    }
  }
}
