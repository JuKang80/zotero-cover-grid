import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WindowCoverGridController } from '../src/sync/window-controller';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';

declare const ZoteroPane: any;
declare const Zotero: any;

describe('Collection Switch & AbortController Queue Flush', () => {
  let mockWin: any;
  let scroller: VirtualGridScroller;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="vp"><div id="c"></div></div>
    `;
    mockWin = { document };
    scroller = new VirtualGridScroller({
      container: document.getElementById('c')!,
      viewport: document.getElementById('vp')!
    });
  });

  it('should abort ongoing thumbnail requests on collection switch', async () => {
    const ctrl = new WindowCoverGridController(mockWin);
    ctrl.init(scroller);

    let firstAbortSignal: AbortSignal | null = null;

    // Simulate collection 1
    ZoteroPane.itemsView.rowProvider.items = [
      { id: 1, key: 'K1', title: 'Paper 1', getField: () => 'Paper 1', getCreators: () => [], getTags: () => [] }
    ];

    const reloadPromise1 = ctrl.reloadCurrentCollection();
    firstAbortSignal = (ctrl as any).abortController.signal;
    expect(firstAbortSignal?.aborted).toBe(false);

    // Immediate collection switch to collection 2 before collection 1 finishes
    ZoteroPane.itemsView.rowProvider.items = [
      { id: 2, key: 'K2', title: 'Paper 2', getField: () => 'Paper 2', getCreators: () => [], getTags: () => [] }
    ];

    const reloadPromise2 = ctrl.reloadCurrentCollection();

    // Previous signal must be aborted!
    expect(firstAbortSignal?.aborted).toBe(true);

    const secondAbortSignal = (ctrl as any).abortController.signal;
    expect(secondAbortSignal?.aborted).toBe(false);

    await Promise.all([reloadPromise1, reloadPromise2]);
    ctrl.destroy();
  });
});
