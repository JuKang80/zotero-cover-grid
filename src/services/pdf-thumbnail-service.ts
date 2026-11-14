import { PaperCardData } from '../types';
import {
  MAX_CANVAS_WIDTH,
  MAX_CANVAS_HEIGHT,
  getHostWindow,
  getClampedViewport,
  createSafeCanvas,
  convertCanvasToSafeBlob,
  trimCanvasArtifacts
} from './thumbnail/canvas-utils';
import { SPLASH_KEYWORDS, detectSplashPage } from './thumbnail/splash-detector';
import { generateTypographyFallbackCover } from './thumbnail/typography-cover';

// 100% backward-compatible re-exports
export {
  MAX_CANVAS_WIDTH,
  MAX_CANVAS_HEIGHT,
  getHostWindow,
  getClampedViewport,
  createSafeCanvas,
  convertCanvasToSafeBlob,
  trimCanvasArtifacts,
  SPLASH_KEYWORDS,
  detectSplashPage,
  generateTypographyFallbackCover
};

declare const ChromeUtils: any;
declare const IOUtils: any;
declare const Zotero: any;

async function readPdfBytes(pdfPath: string): Promise<{ bytes?: Uint8Array; errorReason?: string }> {
  try {
    if (typeof IOUtils === 'undefined') {
      return { errorReason: 'IOUtils Unavailable' };
    }
    const exists = await IOUtils.exists(pdfPath);
    if (!exists) {
      return { errorReason: 'File Not Found' };
    }
    const bytes = await IOUtils.read(pdfPath);
    if (!bytes || bytes.length === 0) {
      return { errorReason: '0-Byte PDF' };
    }
    return { bytes };
  } catch {
    return { errorReason: 'Invalid File' };
  }
}

async function loadPdfJs(hostWin: any): Promise<any> {
  let pdfjs: any;
  try {
    if (typeof ChromeUtils !== 'undefined' && ChromeUtils.importESModule) {
      try {
        pdfjs = await ChromeUtils.importESModule('resource://zotero/reader/pdf/build/pdf.mjs');
      } catch {
        try {
          pdfjs = await ChromeUtils.importESModule('resource://pdf.js/build/pdf.mjs');
        } catch {
          // Fall through to hostWin dynamic import
        }
      }
    }
    if (!pdfjs && hostWin && typeof hostWin.eval === 'function') {
      try {
        pdfjs = await hostWin.eval('import("resource://zotero/reader/pdf/build/pdf.mjs")');
      } catch {
        pdfjs = await hostWin.eval('import("resource://pdf.js/build/pdf.mjs")');
      }
    }
  } catch {
    return null;
  }

  if (pdfjs?.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'resource://zotero/reader/pdf/build/pdf.worker.mjs';
  }
  return pdfjs || null;
}

function createPdfDocumentHelper(baseDoc: any) {
  const safeOwnerDocument = baseDoc
    ? new Proxy(baseDoc, {
        get(target, prop) {
          if (prop === 'createElement') {
            return (tagName: string) => {
              const lower = String(tagName).toLowerCase();
              if (lower === 'canvas') {
                return createSafeCanvas(1, 1, target);
              }
              return typeof target.createElementNS === 'function'
                ? target.createElementNS('http://www.w3.org/1999/xhtml', tagName)
                : target.createElement(tagName);
            };
          }
          const val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        }
      })
    : undefined;

  class SafeCanvasFactory {
    create(width: number, height: number) {
      const c = createSafeCanvas(width, height, baseDoc);
      return {
        canvas: c,
        context: c.getContext('2d')
      };
    }
    reset(canvasAndContext: any, width: number, height: number) {
      if (!canvasAndContext?.canvas) return;
      canvasAndContext.canvas.width = Math.max(1, Math.floor(width));
      canvasAndContext.canvas.height = Math.max(1, Math.floor(height));
    }
    destroy(canvasAndContext: any) {
      if (!canvasAndContext?.canvas) return;
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    }
  }

  return (bytes: Uint8Array, disableFontFace = false): any => {
    const opts: any = {
      data: bytes.slice ? bytes.slice(0) : new Uint8Array(bytes),
      cMapUrl: 'resource://zotero/reader/pdf/web/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'resource://zotero/reader/pdf/web/standard_fonts/',
      wasmUrl: 'resource://zotero/reader/pdf/web/wasm/',
      iccUrl: 'resource://zotero/reader/pdf/web/iccs/',
      useSystemFonts: !disableFontFace,
      disableFontFace,
      isEvalSupported: false,
      isOffscreenCanvasSupported: false,
      CanvasFactory: SafeCanvasFactory,
      onPassword: (updatePassword: (pw: string) => void) => {
        updatePassword('');
      }
    };
    if (safeOwnerDocument) {
      opts.ownerDocument = safeOwnerDocument;
    }
    return opts;
  };
}

function isSplashDetectEnabled(): boolean {
  try {
    if (typeof Zotero !== 'undefined' && Zotero.Prefs?.get) {
      const pref = Zotero.Prefs.get('extensions.zotero.covergrid.splashDetect', true);
      if (pref === false) return false;
    }
  } catch {}
  return true;
}

async function renderPdfPageToCanvas(
  page: any,
  maxWidth = MAX_CANVAS_WIDTH,
  maxHeight = MAX_CANVAS_HEIGHT,
  maxScale = 2.0
): Promise<any> {
  const viewport = getClampedViewport(page, maxWidth, maxHeight, maxScale);
  const canvas = createSafeCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
  }
  await page.render({ canvasContext: ctx, viewport }).promise;
  return trimCanvasArtifacts(canvas);
}

interface PdfSessionEntry {
  pdfPath: string;
  pdfjs: any;
  bytes: Uint8Array;
  pdfDoc: any;
  loadingTask: any;
  pageOffset: number;
  totalPages: number;
  lastUsed: number;
  disableFontFace: boolean;
  timer?: any;
  reopenPromise?: Promise<PdfSessionEntry>;
}

const SESSION_POOL_MAX = 2;
const SESSION_IDLE_MS = 30_000;

class PdfSessionPool {
  private sessions = new Map<string, PdfSessionEntry>();
  private pending = new Map<string, Promise<PdfSessionEntry>>();
  private clearGeneration = 0;

  private scheduleEviction(entry: PdfSessionEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => {
      void this.evict(entry.pdfPath);
    }, SESSION_IDLE_MS);
  }

  private async destroyEntry(entry: PdfSessionEntry): Promise<void> {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    if (entry.pdfDoc && typeof entry.pdfDoc.destroy === 'function') {
      try {
        await entry.pdfDoc.destroy();
      } catch {}
    }
    if (entry.loadingTask && typeof entry.loadingTask.destroy === 'function') {
      try {
        await entry.loadingTask.destroy();
      } catch {}
    }
  }

  public async evict(pdfPath: string): Promise<void> {
    const entry = this.sessions.get(pdfPath);
    if (!entry) return;
    this.sessions.delete(pdfPath);
    await this.destroyEntry(entry);
  }

  private async evictOldestIfNeeded(): Promise<void> {
    while (this.sessions.size >= SESSION_POOL_MAX) {
      let oldestKey: string | null = null;
      let oldestTs = Infinity;
      for (const [k, v] of this.sessions.entries()) {
        if (v.lastUsed < oldestTs) {
          oldestTs = v.lastUsed;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      await this.evict(oldestKey);
    }
  }

  public async acquire(pdfPath: string): Promise<PdfSessionEntry> {
    const existing = this.sessions.get(pdfPath);
    if (existing) {
      if (existing.reopenPromise) {
        return existing.reopenPromise;
      }
      existing.lastUsed = Date.now();
      this.scheduleEviction(existing);
      return existing;
    }

    const inflight = this.pending.get(pdfPath);
    if (inflight) {
      return inflight;
    }

    const gen = this.clearGeneration;
    const openPromise = (async (): Promise<PdfSessionEntry> => {
      const { bytes, errorReason } = await readPdfBytes(pdfPath);
      if (!bytes) {
        throw new Error(errorReason || 'Invalid PDF');
      }

      const hostWin = getHostWindow();
      const pdfjs = await loadPdfJs(hostWin);
      if (!pdfjs) {
        throw new Error('PDF.js Unavailable');
      }

      const baseDoc =
        hostWin?.document ||
        (typeof document !== 'undefined' ? document : null);
      const buildDocOptions = createPdfDocumentHelper(baseDoc);

      const loadingTask = pdfjs.getDocument(buildDocOptions(bytes, false));
      const pdfDoc = await loadingTask.promise;
      if (!pdfDoc || pdfDoc.numPages < 1) {
        try {
          await pdfDoc?.destroy?.();
          await loadingTask?.destroy?.();
        } catch {}
        throw new Error('Empty PDF');
      }

      if (gen !== this.clearGeneration) {
        try {
          await pdfDoc?.destroy?.();
          await loadingTask?.destroy?.();
        } catch {}
        throw new Error('PdfSessionPool cleared');
      }

      let pageOffset = 0;
      if (pdfDoc.numPages > 1 && isSplashDetectEnabled()) {
        try {
          const page1 = await pdfDoc.getPage(1);
          if (await detectSplashPage(page1)) {
            pageOffset = 1;
          }
        } catch {
          pageOffset = 0;
        }
      }

      if (gen !== this.clearGeneration) {
        try {
          await pdfDoc?.destroy?.();
          await loadingTask?.destroy?.();
        } catch {}
        throw new Error('PdfSessionPool cleared');
      }

      const totalPages = Math.max(1, pdfDoc.numPages - pageOffset);
      await this.evictOldestIfNeeded();

      if (gen !== this.clearGeneration) {
        try {
          await pdfDoc?.destroy?.();
          await loadingTask?.destroy?.();
        } catch {}
        throw new Error('PdfSessionPool cleared');
      }

      const entry: PdfSessionEntry = {
        pdfPath,
        pdfjs,
        bytes,
        pdfDoc,
        loadingTask,
        pageOffset,
        totalPages,
        lastUsed: Date.now(),
        disableFontFace: false
      };
      this.sessions.set(pdfPath, entry);
      this.scheduleEviction(entry);
      return entry;
    })();

    this.pending.set(pdfPath, openPromise);
    try {
      return await openPromise;
    } finally {
      this.pending.delete(pdfPath);
    }
  }

  public async reopenWithDisabledFontFace(entry: PdfSessionEntry): Promise<PdfSessionEntry> {
    if (entry.disableFontFace) return entry;
    if (entry.reopenPromise) return entry.reopenPromise;

    const gen = this.clearGeneration;
    entry.reopenPromise = (async () => {
      try {
        const hostWin = getHostWindow();
        const baseDoc =
          hostWin?.document ||
          (typeof document !== 'undefined' ? document : null);
        const buildDocOptions = createPdfDocumentHelper(baseDoc);

        await this.destroyEntry(entry);
        const loadingTask = entry.pdfjs.getDocument(buildDocOptions(entry.bytes, true));
        const pdfDoc = await loadingTask.promise;

        if (gen !== this.clearGeneration || this.sessions.get(entry.pdfPath) !== entry) {
          try {
            await pdfDoc?.destroy?.();
            await loadingTask?.destroy?.();
          } catch {}
          throw new Error('PdfSessionPool entry invalidated');
        }

        entry.pdfDoc = pdfDoc;
        entry.loadingTask = loadingTask;
        entry.disableFontFace = true;
        entry.lastUsed = Date.now();
        this.scheduleEviction(entry);
        return entry;
      } catch (err) {
        if (this.sessions.get(entry.pdfPath) === entry) {
          this.sessions.delete(entry.pdfPath);
        }
        throw err;
      }
    })().finally(() => {
      entry.reopenPromise = undefined;
    });

    return entry.reopenPromise;
  }

  public async clear(): Promise<void> {
    this.clearGeneration++;
    const entries = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const entry of entries) {
      await this.destroyEntry(entry);
    }
  }
}

const pdfSessionPool = new PdfSessionPool();

export async function evictPdfSession(pdfPath: string): Promise<void> {
  await pdfSessionPool.evict(pdfPath);
}

export async function clearPdfSessionPool(): Promise<void> {
  await pdfSessionPool.clear();
}

export async function getPdfPageInfo(
  pdfPath: string
): Promise<{ totalPages: number; pageOffset: number }> {
  try {
    const session = await pdfSessionPool.acquire(pdfPath);
    return {
      totalPages: session.totalPages,
      pageOffset: session.pageOffset
    };
  } catch {
    return { totalPages: 0, pageOffset: 0 };
  }
}

export async function renderPdfPage(
  pdfPath: string,
  logicalPage: number,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    maxScale?: number;
    cardData?: Partial<PaperCardData>;
  } = {}
): Promise<{ blob: Blob; totalPages: number; actualPageNumber: number }> {
  const maxWidth = options.maxWidth ?? MAX_CANVAS_WIDTH;
  const maxHeight = options.maxHeight ?? MAX_CANVAS_HEIGHT;
  const maxScale = options.maxScale ?? 2.0;
  const cardData = options.cardData ?? {};

  try {
    let session = await pdfSessionPool.acquire(pdfPath);
    const clampedLogical = Math.min(session.totalPages, Math.max(1, Math.floor(logicalPage || 1)));
    const actualPageNumber = Math.min(session.pdfDoc.numPages, clampedLogical + session.pageOffset);

    let page = await session.pdfDoc.getPage(actualPageNumber);
    let finalCanvas: any;
    try {
      finalCanvas = await renderPdfPageToCanvas(page, maxWidth, maxHeight, maxScale);
    } catch (firstErr: any) {
      if (firstErr?.name === 'PasswordException') {
        throw firstErr;
      }
      session = await pdfSessionPool.reopenWithDisabledFontFace(session);
      page = await session.pdfDoc.getPage(actualPageNumber);
      finalCanvas = await renderPdfPageToCanvas(page, maxWidth, maxHeight, maxScale);
    }

    session.lastUsed = Date.now();
    const blob = await convertCanvasToSafeBlob(finalCanvas);
    return {
      blob,
      totalPages: session.totalPages,
      actualPageNumber
    };
  } catch (err: any) {
    const errorMsg = err?.name === 'PasswordException' ? 'Password Protected' : 'Render Failed';
    const blob = await generateTypographyFallbackCover(cardData, errorMsg);
    return {
      blob,
      totalPages: 0,
      actualPageNumber: 1
    };
  }
}

/**
 * Primary rendering pipeline for PDF thumbnails
 */
export async function renderPdfThumbnail(
  pdfPath: string,
  cardData: Partial<PaperCardData>
): Promise<Blob> {
  // Pre-check file existence and size
  const { bytes, errorReason } = await readPdfBytes(pdfPath);
  if (!bytes) {
    return generateTypographyFallbackCover(cardData, errorReason || 'Invalid File');
  }

  // Load PDF.js via Gecko ChromeUtils or Window ESM scope (where DOMMatrix is defined in Zotero 10)
  const hostWin = getHostWindow();
  const pdfjs = await loadPdfJs(hostWin);
  if (!pdfjs) {
    return generateTypographyFallbackCover(cardData, 'PDF.js Unavailable');
  }

  let pdfDoc: any = null;
  let loadingTask: any = null;
  try {
    const baseDoc =
      hostWin?.document ||
      (typeof document !== 'undefined' ? document : null);
    const buildDocOptions = createPdfDocumentHelper(baseDoc);

    const resolveTargetPage = async (doc: any) => {
      let page = await doc.getPage(1);
      if (doc.numPages > 1 && isSplashDetectEnabled() && (await detectSplashPage(page))) {
        try {
          page = await doc.getPage(2);
        } catch {
          // Keep page 1 on fallback
        }
      }
      return page;
    };

    const renderPageToCanvas = async (page: any) => {
      const viewport = getClampedViewport(page);
      const canvas = createSafeCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, viewport.width, viewport.height);
      }
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas;
    };

    // Pass raw byte array directly to avoid file URI resolution and permission issues
    loadingTask = pdfjs.getDocument(buildDocOptions(bytes, false));
    pdfDoc = await loadingTask.promise;
    if (!pdfDoc || pdfDoc.numPages < 1) {
      return generateTypographyFallbackCover(cardData, 'Empty PDF');
    }

    let targetPage = await resolveTargetPage(pdfDoc);
    let renderedCanvas: any;
    try {
      renderedCanvas = await renderPageToCanvas(targetPage);
    } catch (firstRenderErr: any) {
      if (firstRenderErr?.name === 'PasswordException') {
        throw firstRenderErr;
      }
      // Retry with disableFontFace=true for legacy PDFs with broken Type1/Type3/OCR fonts
      // rejected by the browser OpenType Sanitizer (FontFace.loaded)
      try {
        renderedCanvas = await renderPageToCanvas(targetPage);
      } catch {
        try {
          await pdfDoc.destroy?.();
        } catch {}
        try {
          await loadingTask.destroy?.();
        } catch {}
        loadingTask = pdfjs.getDocument(buildDocOptions(bytes, true));
        pdfDoc = await loadingTask.promise;
        targetPage = await resolveTargetPage(pdfDoc);
        renderedCanvas = await renderPageToCanvas(targetPage);
      }
    }

    const finalCanvas = trimCanvasArtifacts(renderedCanvas);
    return await convertCanvasToSafeBlob(finalCanvas);
  } catch (err: any) {
    const errorMsg = err?.name === 'PasswordException' ? 'Password Protected' : 'Render Failed';
    return generateTypographyFallbackCover(cardData, errorMsg);
  } finally {
    if (pdfDoc && typeof pdfDoc.destroy === 'function') {
      try {
        await pdfDoc.destroy();
      } catch {
        // Ignore destroy error
      }
    }
    if (loadingTask && typeof loadingTask.destroy === 'function') {
      try {
        await loadingTask.destroy();
      } catch {
        // Ignore destroy error
      }
    }
  }
}
