import { PaperCardData } from '../../types';
import { extractPaperCardData } from '../../utils/apa-formatter';

declare const Zotero: any;

export interface NotifierHandlerOptions {
  win: any;
  getAllItems: () => PaperCardData[];
  setAllItems: (items: PaperCardData[]) => void;
  onReload: () => void | Promise<void>;
  onFilter: () => void;
}

export class NotifierHandler {
  private observerId: string | null = null;
  private isDestroyed = false;

  constructor(private options: NotifierHandlerOptions) {}

  public register(): void {
    const z = this.options.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Notifier) return;

    const observer = {
      notify: (event: string, type: string, ids: string[] | number[], extraData: any) => {
        if (this.isDestroyed) return;
        this.handleNotifierEvent(event, type, ids, extraData);
      }
    };

    this.observerId = z.Notifier.registerObserver(
      observer,
      ['item', 'item-tag', 'collection-item', 'collection', 'tab'],
      'ZoteroCoverGrid'
    );
  }

  public handleNotifierEvent(event: string, type: string, ids: string[] | number[], extraData: any): void {
    if (type === 'tab' && event === 'select') {
      const tabId = Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : '';
      if (tabId === 'zotero-cover-grid-tab') {
        this.options.onReload();
      }
      return;
    }

    if (type === 'collection') {
      this.options.onReload();
      return;
    }

    const numIds = Array.isArray(ids) ? ids.map(Number) : (ids ? [Number(ids)] : []);

    if (type === 'item') {
      if (event === 'modify') {
        this.patchItems(numIds);
      } else if (event === 'delete') {
        this.removeItems(numIds);
      } else if (event === 'add') {
        this.options.onReload();
      }
    } else if (type === 'item-tag') {
      this.patchItems(numIds);
    } else if (type === 'collection-item') {
      this.options.onReload();
    }
  }

  public async patchItems(ids: number[]): Promise<void> {
    const z = this.options.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Items) return;
    const idSet = new Set(ids);
    const allItems = this.options.getAllItems();

    for (let i = 0; i < allItems.length; i++) {
      if (idSet.has(allItems[i].id)) {
        try {
          let zItem: any = null;
          try {
            zItem = z.Items.get(allItems[i].id);
          } catch {
            if (z.Items.getAsync) {
              zItem = await z.Items.getAsync(allItems[i].id);
            }
          }
          if (zItem) {
            const prevThumbnailUrl = allItems[i].coverThumbnailUrl;
            const prevHasPdf = allItems[i].hasPdf;
            allItems[i] = extractPaperCardData(zItem);
            if (prevThumbnailUrl) {
              allItems[i].coverThumbnailUrl = prevThumbnailUrl;
            }
            allItems[i].hasPdf = prevHasPdf;
          }
        } catch {
          // Ignore
        }
      }
    }

    this.options.onFilter();
  }

  public removeItems(ids: number[]): void {
    const idSet = new Set(ids);
    const updated = this.options.getAllItems().filter((it) => !idSet.has(it.id));
    this.options.setAllItems(updated);
    this.options.onFilter();
  }

  public destroy(): void {
    this.isDestroyed = true;
    const z = this.options.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (this.observerId && z?.Notifier) {
      z.Notifier.unregisterObserver(this.observerId);
      this.observerId = null;
    }
  }
}
