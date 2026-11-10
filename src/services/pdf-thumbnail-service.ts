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
    const docOptions: any = {
      data: bytes,
      cMapUrl: 'resource://zotero/reader/pdf/web/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'resource://zotero/reader/pdf/web/standard_fonts/',
      onPassword: (updatePassword: (pw: string) => void) => {
        updatePassword('');
      }
    };

    // Provide XHTML ownerDocument when running inside Zotero XUL window so internal PDF.js canvas creation succeeds
    if (typeof document === 'undefined' && hostWin?.document) {
      const xulDoc = hostWin.document;
      docOptions.ownerDocument = new Proxy(xulDoc, {
        get(target, prop) {
          if (prop === 'createElement') {
            return (tagName: string) =>
              typeof target.createElementNS === 'function'
                ? target.createElementNS('http://www.w3.org/1999/xhtml', tagName)
                : target.createElement(tagName);
          }
          const val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
    }

    // Pass raw byte array directly to avoid file URI resolution and permission issues
    loadingTask = pdfjs.getDocument(docOptions);

    pdfDoc = await loadingTask.promise;
    if (!pdfDoc || pdfDoc.numPages < 1) {
      return generateTypographyFallbackCover(cardData, 'Empty PDF');
    }

    // Render Page 1, or Page 2 if publisher splash page detection is enabled and triggered
    let targetPage = await pdfDoc.getPage(1);
    if (pdfDoc.numPages > 1) {
      let splashEnabled = true;
      try {
        if (typeof Zotero !== 'undefined' && Zotero.Prefs?.get) {
          const pref = Zotero.Prefs.get('extensions.zotero.covergrid.splashDetect', true);
          if (pref === false) splashEnabled = false;
        }
      } catch {}
      if (splashEnabled && (await detectSplashPage(targetPage))) {
        try {
          targetPage = await pdfDoc.getPage(2);
        } catch {
          // Keep page 1 on fallback
        }
      }
    }

    const viewport = getClampedViewport(targetPage);
    const canvas = createSafeCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, viewport.width, viewport.height);
    }
    const renderContext = {
      canvasContext: ctx,
      viewport
    };

    await targetPage.render(renderContext).promise;
    const finalCanvas = trimCanvasArtifacts(canvas);
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
