import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderPdfPage,
  getPdfPageInfo,
  clearPdfSessionPool
} from '../src/services/pdf-thumbnail-service';
import { ThumbnailCacheManager } from '../src/services/cache-manager';
import { createPaperCardElement, updatePaperCardPagePill } from '../src/ui/paper-card';
import { QuickLookModal } from '../src/ui/quick-look-modal';
import { WindowCoverGridController } from '../src/sync/window-controller';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { openItemInZotero } from '../src/ui/item-actions';
import { PaperCardData } from '../src/types';

declare const IOUtils: any;
declare const ChromeUtils: any;

function makeCard(id: number, overrides: Partial<PaperCardData> = {}): PaperCardData {
  return {
    id,
    key: `KEY_${id}`,
    title: `Paper ${id}`,
    authorText: `Author ${id}`,
    citationText: `Author ${id} (2026)`,
    itemType: 'journalArticle',
    year: '2026',
    readStatus: 'unread',
    hasPdf: true,
    coverThumbnailUrl: `blob:page1-${id}`,
    ...overrides
  };
}

describe('Card Page Preview & Quick Look Modal', () => {
  const g = globalThis as any;
  let origImportESModule: any;
  let origPrefsGet: any;
  let origItemsGet: any;
  let origCreateObjectURL: any;
  let urlSeq = 0;

  beforeEach(async () => {
    vi.clearAllMocks();
    urlSeq = 0;
    origImportESModule = g.ChromeUtils.importESModule;
    origPrefsGet = g.Zotero.Prefs.get;
    origItemsGet = g.Zotero.Items.get;
    origCreateObjectURL = g.URL.createObjectURL;

    g.ChromeUtils.importESModule = vi.fn((url: string) => {
      if (url.includes('pdf.mjs')) {
        const mockPage = {
          rotate: 0,
          getTextContent: vi.fn().mockResolvedValue({ items: [] }),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
          getViewport: vi.fn(({ scale }: any) => ({ width: 600 * (scale || 1), height: 800 * (scale || 1) }))
        };
        const mockDoc = {
          numPages: 10,
          getPage: vi.fn().mockResolvedValue(mockPage),
          destroy: vi.fn().mockResolvedValue(undefined)
        };
        return Promise.resolve({
          getDocument: vi.fn(() => ({
            promise: Promise.resolve(mockDoc)
          }))
        });
      }
      return Promise.resolve({});
    });
    g.Zotero.Prefs.get = vi.fn((pref: string) => {
      if (pref.includes('openPDFIn')) return 'tab';
      if (pref.includes('splashDetect')) return true;
      return false;
    });
    g.URL.createObjectURL = vi.fn(() => `blob:mock-url-${++urlSeq}`);

    await clearPdfSessionPool();
  });

  afterEach(async () => {
    g.ChromeUtils.importESModule = origImportESModule;
    g.Zotero.Prefs.get = origPrefsGet;
    g.Zotero.Items.get = origItemsGet;
    g.URL.createObjectURL = origCreateObjectURL;
    await clearPdfSessionPool();
  });

  it('reuses PdfSessionPool for the same PDF and handles splash page 1/N offset', async () => {
    const getPageMock = vi.fn(async (pageNum: number) => ({
      rotate: 0,
      getTextContent: vi.fn().mockResolvedValue({
        items:
          pageNum === 1
            ? [
                { str: 'Downloaded from https://www.jstor.org/stable/12345' },
                { str: 'This content downloaded from JSTOR' },
                { str: 'All use subject to JSTOR Terms and Conditions' }
              ]
            : [{ str: 'Actual Paper Content Page ' + pageNum }]
      }),
      getViewport: vi.fn(({ scale }: any) => ({
        width: 600 * (scale || 1),
        height: 800 * (scale || 1)
      })),
      render: vi.fn(() => ({ promise: Promise.resolve() }))
    }));

    const destroyMock = vi.fn().mockResolvedValue(undefined);
    const getDocumentMock = vi.fn(() => ({
      promise: Promise.resolve({
        numPages: 12,
        getPage: getPageMock,
        destroy: destroyMock
      })
    }));

    ChromeUtils.importESModule.mockResolvedValue({ getDocument: getDocumentMock });

    const info = await getPdfPageInfo('/tmp/jstor-paper.pdf');
    expect(info.pageOffset).toBe(1);
    expect(info.totalPages).toBe(11); // Skipped page 1 -> logical 1..11

    const res1 = await renderPdfPage('/tmp/jstor-paper.pdf', 1);
    expect(res1.totalPages).toBe(11);
    expect(res1.actualPageNumber).toBe(2); // Logical page 1 maps to PDF page 2

    const res2 = await renderPdfPage('/tmp/jstor-paper.pdf', 3);
    expect(res2.totalPages).toBe(11);
    expect(res2.actualPageNumber).toBe(4);

    // Pooled: file bytes read and parsed once across info + 2 page renders
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    expect(IOUtils.read).toHaveBeenCalledTimes(1);
  });

  it('evicts oldest PdfSessionPool session when exceeding 2 open PDFs', async () => {
    const destroys: any[] = [];
    const getDocumentMock = vi.fn(() => {
      const destroy = vi.fn().mockResolvedValue(undefined);
      destroys.push(destroy);
      return {
        promise: Promise.resolve({
          numPages: 5,
          getPage: vi.fn(async () => ({
            rotate: 0,
            getTextContent: vi.fn().mockResolvedValue({ items: [{ str: 'Normal paper abstract content with plenty of real words' }] }),
            getViewport: vi.fn(({ scale }: any) => ({ width: 500 * scale, height: 700 * scale })),
            render: vi.fn(() => ({ promise: Promise.resolve() }))
          })),
          destroy
        })
      };
    });

    ChromeUtils.importESModule.mockResolvedValue({ getDocument: getDocumentMock });

    await getPdfPageInfo('/tmp/p1.pdf');
    await new Promise((r) => setTimeout(r, 5));
    await getPdfPageInfo('/tmp/p2.pdf');
    await new Promise((r) => setTimeout(r, 5));
    expect(destroys[0]).not.toHaveBeenCalled();

    await getPdfPageInfo('/tmp/p3.pdf');
    expect(destroys[0]).toHaveBeenCalledTimes(1);
    expect(destroys[1]).not.toHaveBeenCalled();
  });

  it('caches page > 1 thumbnails only in memory (never disk) in ThumbnailCacheManager', async () => {
    const cache = new ThumbnailCacheManager();
    const item = { id: 50, key: 'KEY50', title: 'Test PDF' };
    const attachment = {
      id: 500,
      mtime: 111,
      isPDFAttachment: () => true,
      getFilePathAsync: vi.fn().mockResolvedValue('/tmp/cache-test.pdf')
    };

    IOUtils.exists.mockResolvedValueOnce(false); // cover disk check -> miss
    const p1 = await cache.getPageThumbnail(item, attachment, 1);
    expect(p1.url).toBeDefined();
    const writesAfterP1 = IOUtils.write.mock.calls.length;

    const p2a = await cache.getPageThumbnail(item, attachment, 2);
    expect(p2a.url).toBeDefined();
    expect(p2a.totalPages).toBe(10);
    // Page 2 must NOT write to disk cache
    expect(IOUtils.write.mock.calls.length).toBe(writesAfterP1);

    // Memory cache hit for page 2
    const callsBeforeHit = ChromeUtils.importESModule.mock.calls.length;
    const p2b = await cache.getPageThumbnail(item, attachment, 2);
    expect(p2b.url).toBe(p2a.url);
    expect(ChromeUtils.importESModule.mock.calls.length).toBe(callsBeforeHit);

    // High-res render returns dedicated URL without overwriting card page 2 memory cache
    const hiRes = await cache.renderHighResPage(item, attachment, 2);
    expect(hiRes).not.toBeNull();
    expect(hiRes!.url).not.toBe(p2a.url);
  });

  it('prevents card click and double-click propagation inside the preview pill', () => {
    const card = makeCard(1);
    const onClick = vi.fn();
    const onDoubleClick = vi.fn();
    const onPageFlip = vi.fn();
    const onOpenQuickLook = vi.fn();

    const cardEl = createPaperCardElement(card, {
      onClick,
      onDoubleClick,
      onPageFlip,
      onOpenQuickLook
    });

    updatePaperCardPagePill(cardEl, { visible: true, currentPage: 2, totalPages: 8 });
    const prevBtn = cardEl.querySelector('.card-page-prev-btn') as HTMLButtonElement;
    const nextBtn = cardEl.querySelector('.card-page-next-btn') as HTMLButtonElement;
    const badgeBtn = cardEl.querySelector('.card-page-badge-btn') as HTMLButtonElement;
    const expandBtn = cardEl.querySelector('.card-page-expand-btn') as HTMLButtonElement;

    expect(badgeBtn.textContent).toBe('2 / 8');

    nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    nextBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    prevBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    badgeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expandBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onClick).not.toHaveBeenCalled();
    expect(onDoubleClick).not.toHaveBeenCalled();
    expect(onPageFlip).toHaveBeenNthCalledWith(1, card, 1);
    expect(onPageFlip).toHaveBeenNthCalledWith(2, card, -1);
    expect(onOpenQuickLook).toHaveBeenCalledTimes(2);
  });

  it('shows pill only on single-selected PDF cards and resets previous card to page 1 on card change', async () => {
    document.body.innerHTML = `<div id="vp"><div id="grid"></div></div>`;
    const viewport = document.getElementById('vp')!;
    const container = document.getElementById('grid')!;

    const card1 = makeCard(101);
    const card2 = makeCard(102);
    const noteCard = makeCard(103, { itemType: 'note', hasPdf: false, coverThumbnailUrl: undefined });

    (globalThis as any).Zotero.Items.get = vi.fn((id: number) => ({
      id,
      key: `KEY_${id}`,
      getBestAttachment: vi.fn().mockResolvedValue(
        id === 103
          ? null
          : {
              id: id * 10,
              mtime: 100,
              isPDFAttachment: () => true,
              getFilePathAsync: vi.fn().mockResolvedValue(`/tmp/paper-${id}.pdf`)
            }
      )
    }));

    let mockWin: any;
    const controller = new WindowCoverGridController(
      (mockWin = {
        document,
        Zotero: (globalThis as any).Zotero,
        ZoteroPane: (globalThis as any).ZoteroPane
      })
    );

    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onSelect: (selected) => {
        void controller.handleSelectionChange(selected);
      },
      onPageFlip: (item, dir) => {
        void controller.flipCardPage(item, dir);
      },
      onOpenQuickLook: (item) => {
        void controller.openQuickLook(item);
      }
    });

    controller.scroller = scroller;
    controller.allItems = [card1, card2, noteCard];
    scroller.setItems([card1, card2, noteCard]);

    const el1 = scroller.getCardElement(101)!;
    const el2 = scroller.getCardElement(102)!;
    const elNote = scroller.getCardElement(103)!;
    const img1 = el1.querySelector('.card-cover-img') as HTMLImageElement;

    // 1. Single-click card 1 -> shows pill (1 / 10)
    el1.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    const pill1 = el1.querySelector('.card-page-preview-pill') as HTMLElement;
    expect(pill1.hidden).toBe(false);
    expect(pill1.querySelector('.card-page-badge-btn')?.textContent).toBe('1 / 10');

    // 2. Flip to page 2 on card 1 -> image src updates cleanly, card.coverThumbnailUrl preserved
    const nextBtn1 = pill1.querySelector('.card-page-next-btn') as HTMLButtonElement;
    nextBtn1.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(pill1.querySelector('.card-page-badge-btn')?.textContent).toBe('2 / 10');
    expect(img1.getAttribute('src')).not.toBe('blob:page1-101');
    expect(card1.coverThumbnailUrl).toBe('blob:page1-101');

    // 3. Click card 2 -> card 1 auto-resets back to page 1 cover and hides its pill
    el2.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(pill1.hidden).toBe(true);
    expect(img1.getAttribute('src')).toBe('blob:page1-101');

    const pill2 = el2.querySelector('.card-page-preview-pill') as HTMLElement;
    expect(pill2.hidden).toBe(false);

    // 4. Multi-select (Cmd/Ctrl + click card 1) -> hides all pills
    el1.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(pill1.hidden).toBe(true);
    expect(pill2.hidden).toBe(true);

    // 5. Select Note card -> never shows pill
    elNote.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    const pillNote = elNote.querySelector('.card-page-preview-pill') as HTMLElement | null;
    expect(pillNote === null || pillNote.hidden).toBe(true);

    controller.destroy();
  });

  it('supports Quick Look paging, zoom slider, trackpad pinch, browser shortcuts, drag pan, and Open in Tab', async () => {
    document.body.innerHTML = '<div></div>';
    const modal = new QuickLookModal({ document });
    const card = makeCard(201);
    const onPageChange = vi.fn();
    const onOpenInTab = vi.fn();
    const onRenderPage = vi.fn(async (_c: PaperCardData, page: number) => ({
      url: `blob:hires-page-${page}`,
      totalPages: 6,
      actualPageNumber: page + 1 // simulate splash offset = 1
    }));

    await modal.open({
      card,
      initialPage: 3,
      totalPages: 6,
      onRenderPage,
      onPageChange,
      onOpenInTab
    });

    expect(modal.isOpen()).toBe(true);
    expect(modal.getState().currentPage).toBe(3);

    const root = document.getElementById('zotero-cover-grid-quick-look')!;
    const stage = root.querySelector('.quick-look-stage') as HTMLElement;
    const wrapper = root.querySelector('.quick-look-page-wrapper') as HTMLElement;
    const slider = root.querySelector('.quick-look-zoom-slider') as HTMLInputElement;
    const zoomLabel = root.querySelector('.quick-look-zoom-label') as HTMLButtonElement;
    const prevBtn = root.querySelector('.quick-look-nav-prev') as HTMLButtonElement;
    const nextBtn = root.querySelector('.quick-look-nav-next') as HTMLButtonElement;
    const openTabBtn = root.querySelector('.quick-look-open-tab-btn') as HTMLButtonElement;

    // 1. Plain wheel at 100% must NOT flip pages
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    expect(modal.getState().currentPage).toBe(3);

    // 2. Zoom Slider updates zoom
    slider.value = '160';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(modal.getState().zoom).toBe(160);
    expect(zoomLabel.textContent).toBe('160%');
    expect(stage.classList.contains('is-zoomed')).toBe(true);

    // 3. Drag-to-pan when zoomed > 100%
    stage.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 125, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(modal.getState().panX).toBe(40);
    expect(modal.getState().panY).toBe(25);
    expect(wrapper.style.transform).toContain('translate(40px, 25px) scale(1.6)');

    // 4. Trackpad Pinch-to-Zoom (ctrlKey + wheel; happy-dom strips ctrlKey on WheelEventInit so define it explicitly)
    const pinchEvent = new WheelEvent('wheel', { deltaY: -20, bubbles: true, cancelable: true });
    Object.defineProperty(pinchEvent, 'ctrlKey', { value: true });
    stage.dispatchEvent(pinchEvent);
    expect(modal.getState().zoom).toBe(190);

    // 5. Zotero / Browser Zoom shortcuts (Cmd/Ctrl + =/-/0)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', metaKey: true, bubbles: true }));
    expect(modal.getState().zoom).toBe(205);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'Minus', ctrlKey: true, bubbles: true }));
    expect(modal.getState().zoom).toBe(190);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', metaKey: true, bubbles: true }));
    expect(modal.getState().zoom).toBe(100);
    expect(modal.getState().panX).toBe(0);

    // 6. Navigate Next & Prev page + ArrowLeft/ArrowRight
    nextBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(modal.getState().currentPage).toBe(4);
    expect(onPageChange).toHaveBeenCalledWith(card, 4);

    prevBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(modal.getState().currentPage).toBe(3);

    // 7. Open in Tab passes actualPageNumber (3 + splashOffset 1 = 4) and closes modal
    openTabBtn.click();
    expect(onOpenInTab).toHaveBeenCalledWith(card, 4);
    expect(modal.isOpen()).toBe(false);

    // 8. Re-open and Escape closes modal and revokes object URL
    await modal.open({ card, initialPage: 1, totalPages: 6, onRenderPage });
    expect(modal.isOpen()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.isOpen()).toBe(false);
    expect((globalThis as any).URL.revokeObjectURL).toHaveBeenCalled();

    modal.destroy();
  });

  it('openItemInZotero passes 0-based pageIndex to Zotero.Reader.open when specified', async () => {
    const readerOpen = vi.fn().mockResolvedValue(true);
    const attachment = { id: 777 };
    const item = {
      id: 300,
      isAttachment: () => false,
      getBestAttachment: vi.fn().mockResolvedValue(attachment)
    };
    const win = {
      Zotero: {
        Items: { getAsync: vi.fn().mockResolvedValue(item), get: vi.fn().mockReturnValue(item) },
        Reader: { open: readerOpen }
      },
      ZoteroPane: { viewItems: vi.fn() }
    };

    await openItemInZotero(win, 300, 3);
    expect(readerOpen).toHaveBeenCalledWith(777, { pageIndex: 3 });
  });

  it('resolves unresolved regular items (pdfResolved: false), preserves page > 1 during filter, blocks grid keys during Quick Look, and tracks pageOffset early', async () => {
    document.body.innerHTML = `<div id="zotero-cover-grid"><div id="vp"><div id="grid"></div></div></div>`;
    const viewport = document.getElementById('vp')!;
    const container = document.getElementById('grid')!;

    const unresolvedCard = makeCard(501, {
      hasPdf: false,
      pdfResolved: false,
      coverThumbnailUrl: 'blob:page1-501'
    });
    const secondCard = makeCard(502, {
      hasPdf: true,
      pdfResolved: true,
      coverThumbnailUrl: 'blob:page1-502'
    });

    (globalThis as any).Zotero.Items.get = vi.fn((id: number) => ({
      id,
      key: `KEY_${id}`,
      getBestAttachment: vi.fn().mockResolvedValue({
        id: id * 10,
        mtime: 222,
        isPDFAttachment: () => true,
        getFilePathAsync: vi.fn().mockResolvedValue(`/tmp/unresolved-${id}.pdf`)
      })
    }));

    const controller = new WindowCoverGridController({
      document,
      Zotero: (globalThis as any).Zotero,
      ZoteroPane: (globalThis as any).ZoteroPane
    });

    const onDeleteItem = vi.fn();
    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onSelect: (selected) => void controller.handleSelectionChange(selected),
      onPageFlip: (item, dir) => void controller.flipCardPage(item, dir),
      onOpenQuickLook: (item) => void controller.openQuickLook(item),
      onDeleteItem
    });

    controller.scroller = scroller;
    controller.allItems = [unresolvedCard, secondCard];
    controller.filteredItems = [unresolvedCard, secondCard];
    scroller.setItems([unresolvedCard, secondCard]);

    const el501 = scroller.getCardElement(501)!;
    const img501 = el501.querySelector('.card-cover-img') as HTMLImageElement;

    // 1. Clicking unresolved regular card resolves PDF on demand and displays pill
    el501.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 25));
    expect(unresolvedCard.hasPdf).toBe(true);
    expect(unresolvedCard.pdfResolved).toBe(true);
    const pill501 = el501.querySelector('.card-page-preview-pill') as HTMLElement;
    expect(pill501.hidden).toBe(false);

    // 2. Flip to page 2 and re-run applyFilter -> page 2 preview stays intact
    (pill501.querySelector('.card-page-next-btn') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 25));
    const page2Src = img501.getAttribute('src');
    expect(page2Src).not.toBe('blob:page1-501');

    controller.applyFilter();
    expect(img501.getAttribute('src')).toBe(page2Src);

    // 3. Open Quick Look and ensure ArrowRight / Delete do not leak to grid behind modal
    let resolveDelayedRender!: (val: any) => void;
    const delayedRender = new Promise<any>((res) => {
      resolveDelayedRender = res;
    });
    const modal = new QuickLookModal({ document });
    const openPromise = modal.open({
      card: unresolvedCard,
      initialPage: 2,
      totalPages: 10,
      pageOffset: 1,
      onRenderPage: async () => delayedRender
    });
    // Even before async render completes, actualPageNumber reflects pageOffset (2 + 1 = 3)
    expect(modal.getState().actualPageNumber).toBe(3);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(scroller.getSelectedIds()).toEqual([501]);
    expect(onDeleteItem).not.toHaveBeenCalled();

    resolveDelayedRender({ url: 'blob:hi-res-3', totalPages: 10, actualPageNumber: 4 });
    await openPromise;
    modal.destroy();
    controller.destroy();
  });
});
