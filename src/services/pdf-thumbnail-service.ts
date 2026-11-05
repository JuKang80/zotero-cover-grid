import { PaperCardData } from '../types';

declare const ChromeUtils: any;
declare const IOUtils: any;
declare const Zotero: any;
declare const Services: any;

function getHostWindow(): any {
  try {
    if (typeof Zotero !== 'undefined' && typeof Zotero.getMainWindow === 'function') {
      const w = Zotero.getMainWindow();
      if (w) return w;
    }
  } catch {
    // Ignore
  }
  try {
    if (typeof Services !== 'undefined' && Services.wm?.getMostRecentWindow) {
      const w = Services.wm.getMostRecentWindow('navigator:browser');
      if (w) return w;
    }
  } catch {
    // Ignore
  }
  return null;
}

export const MAX_CANVAS_WIDTH = 640;
export const MAX_CANVAS_HEIGHT = 854;

export const SPLASH_KEYWORDS = [
  'jstor',
  'elsevier',
  'springer',
  'wiley',
  'ieee xplore',
  'downloaded from',
  'terms and conditions'
];

/**
 * Checks if a PDF page is a publisher splash/cover sheet (e.g. JSTOR, ScienceDirect cover sheet).
 * Real scientific paper first pages with title, authors, or scan images will NOT be skipped.
 */
export async function detectSplashPage(page: any): Promise<boolean> {
  try {
    const textContent = await page.getTextContent();
    const items = textContent.items || [];
    // If OCR text is completely absent (e.g. classic paper scanned image without OCR), do not skip Page 1
    if (items.length === 0) {
      return false;
    }

    const fullText = items
      .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .toLowerCase();

    // 1. If page contains an academic abstract or substantial text (>400 chars), it is a genuine paper page!
    if (fullText.includes('abstract') || fullText.length > 400 || items.length > 60) {
      return false;
    }

    // 2. Explicit download cover sheets matching splash keywords qualify
    return SPLASH_KEYWORDS.some((kw) => fullText.includes(kw));
  } catch {
    return false;
  }
}

/**
 * Calculates a scaled viewport preserving rotation and clamped to max dimensions
 */
export function getClampedViewport(page: any) {
  const rotation = page.rotate || 0;
  const initialVp = page.getViewport({ scale: 1.0, rotation });

  const scale = Math.min(
    1.0,
    MAX_CANVAS_WIDTH / initialVp.width,
    MAX_CANVAS_HEIGHT / initialVp.height
  );

  return page.getViewport({ scale, rotation });
}

/**
 * Creates an OffscreenCanvas or HTML5 Canvas compatible with Gecko environment & Cu.Sandbox
 */
export function createSafeCanvas(width: number, height: number): any {
  const safeW = Math.max(1, Math.floor(width));
  const safeH = Math.max(1, Math.floor(height));

  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(safeW, safeH);
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = safeW;
    canvas.height = safeH;
    return canvas;
  }

  const win = getHostWindow();
  if (win) {
    if (typeof win.OffscreenCanvas !== 'undefined') {
      return new win.OffscreenCanvas(safeW, safeH);
    }
    const doc = win.document;
    if (doc) {
      const canvas =
        typeof doc.createElementNS === 'function'
          ? doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas')
          : doc.createElement('canvas');
      canvas.width = safeW;
      canvas.height = safeH;
      return canvas;
    }
  }

  throw new Error('Canvas rendering context unavailable');
}

/**
 * 3-tier safe canvas encoding: WebP -> JPEG -> PNG with fallback to toBlob / toDataURL
 */
export async function convertCanvasToSafeBlob(canvas: any): Promise<Blob> {
  if (typeof canvas.convertToBlob === 'function') {
    try {
      return await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
    } catch {
      try {
        return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      } catch {
        return await canvas.convertToBlob({ type: 'image/png' });
      }
    }
  }

  // Fallback for HTMLCanvasElement
  return new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      try {
        canvas.toBlob((blob: Blob | null) => {
          if (blob) resolve(blob);
          else {
            canvas.toBlob((fallbackBlob: Blob | null) => {
              if (fallbackBlob) resolve(fallbackBlob);
              else reject(new Error('Canvas toBlob failed'));
            }, 'image/png');
          }
        }, 'image/webp', 0.85);
      } catch {
        canvas.toBlob((fallbackBlob: Blob | null) => {
          if (fallbackBlob) resolve(fallbackBlob);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/jpeg', 0.85);
      }
    } else if (typeof canvas.toDataURL === 'function') {
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        fetch(dataUrl)
          .then((res) => res.blob())
          .then(resolve)
          .catch(reject);
      } catch (err) {
        reject(err);
      }
    } else {
      reject(new Error('No blob conversion available on canvas'));
    }
  });
}

/**
 * Generates an elegant SVG/Canvas typography fallback cover
 */
export async function generateTypographyFallbackCover(
  card: Partial<PaperCardData>,
  reason: string = 'No PDF'
): Promise<Blob> {
  const width = 480;
  const height = 640;
  const canvas = createSafeCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Elegant Academic Gradient (Navy / Indigo)
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Top Accent Bar
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, 0, width, 8);

    // Year Badge
    if (card.year) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.roundRect?.(40, 40, 70, 28, 4) || ctx.rect(40, 40, 70, 28);
      ctx.fill();

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(String(card.year), 52, 60);
    }

    // Title (multi-line word wrap)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px serif';
    const title = card.title || 'Untitled Document';
    const words = title.split(' ');
    let line = '';
    let y = 140;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > width - 80 && i > 0) {
        ctx.fillText(line, 40, y);
        line = words[i] + ' ';
        y += 34;
        if (y > 450) {
          line += '...';
          break;
        }
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, 40, y);

    // Author
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '16px sans-serif';
    ctx.fillText(card.authorText || 'Unknown Author', 40, height - 70);

    // Reason tag at bottom
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '12px sans-serif';
    ctx.fillText(`[ ${reason} ]`, 40, height - 40);
  }

  const blob = await convertCanvasToSafeBlob(canvas);
  try {
    (blob as any).__isFallbackCover = true;
  } catch {
    // Ignore if immutable
  }
  return blob;
}

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

    // Inspect Page 1
    const page1 = await pdfDoc.getPage(1);
    let targetPage = page1;

    // Check publisher splash sheet (JSTOR/Elsevier)
    if (pdfDoc.numPages > 1) {
      const isSplash = await detectSplashPage(page1);
      if (isSplash) {
        targetPage = await pdfDoc.getPage(2);
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
    return await convertCanvasToSafeBlob(canvas);
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
