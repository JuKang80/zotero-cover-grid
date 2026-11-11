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

/**
 * Primary rendering pipeline for PDF thumbnails
 */
export async function renderPdfThumbnail(
  pdfPath: string,
  cardData: Partial<PaperCardData>
): Promise<Blob> {
  // Pre-check file existence and size
  let bytes: Uint8Array;
  try {
    if (typeof IOUtils !== 'undefined') {
      const exists = await IOUtils.exists(pdfPath);
      if (!exists) {
        return generateTypographyFallbackCover(cardData, 'File Not Found');
      }
      bytes = await IOUtils.read(pdfPath);
      if (!bytes || bytes.length === 0) {
        return generateTypographyFallbackCover(cardData, '0-Byte PDF');
      }
    } else {
      return generateTypographyFallbackCover(cardData, 'IOUtils Unavailable');
    }
  } catch {
    return generateTypographyFallbackCover(cardData, 'Invalid File');
  }

  // Load PDF.js via Gecko ChromeUtils or Window ESM scope (where DOMMatrix is defined in Zotero 10)
  let pdfjs: any;
  const hostWin = getHostWindow();
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
  } catch (err) {
    return generateTypographyFallbackCover(cardData, 'PDF.js Unavailable');
  }

  if (!pdfjs) {
    return generateTypographyFallbackCover(cardData, 'PDF.js Not Found');
  }

  // Set workerSrc for Gecko environment to avoid fake worker warning or failures
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'resource://zotero/reader/pdf/build/pdf.worker.mjs';
  }

  let pdfDoc: any = null;
  let loadingTask: any = null;
  try {
    const baseDoc =
      hostWin?.document ||
      (typeof document !== 'undefined' ? document : null);

    // Always provide an XHTML-safe ownerDocument proxy and CanvasFactory so internal PDF.js
    // temporary canvases (used for scanned 1-bit ImageMask, CCITT Fax, JBIG2, SMask) and FontLoader
    // never fail inside a Zotero XUL window or Cu.Sandbox.
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

    const buildDocOptions = (disableFontFace = false): any => {
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

    const resolveTargetPage = async (doc: any) => {
      let page = await doc.getPage(1);
      if (doc.numPages > 1) {
        let splashEnabled = true;
        try {
          if (typeof Zotero !== 'undefined' && Zotero.Prefs?.get) {
            const pref = Zotero.Prefs.get('extensions.zotero.covergrid.splashDetect', true);
            if (pref === false) splashEnabled = false;
          }
        } catch {}
        if (splashEnabled && (await detectSplashPage(page))) {
          try {
            page = await doc.getPage(2);
          } catch {
            // Keep page 1 on fallback
          }
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
    loadingTask = pdfjs.getDocument(buildDocOptions(false));
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
        loadingTask = pdfjs.getDocument(buildDocOptions(true));
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
