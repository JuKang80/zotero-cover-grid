import { PaperCardData } from '../types';

declare const ChromeUtils: any;
declare const IOUtils: any;

export const MAX_CANVAS_WIDTH = 640;
export const MAX_CANVAS_HEIGHT = 854;

export const SPLASH_KEYWORDS = [
  'jstor',
  'elsevier',
  'springer',
  'wiley',
  'ieee xplore',
  'downloaded from',
  'all rights reserved',
  'terms and conditions'
];

/**
 * Checks if a PDF page is a publisher splash/cover sheet (e.g. JSTOR)
 */
export async function detectSplashPage(page: any): Promise<boolean> {
  try {
    const textContent = await page.getTextContent();
    const fullText = (textContent.items || [])
      .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .toLowerCase();

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
 * 3-tier safe canvas encoding: WebP -> JPEG -> PNG
 */
export async function convertCanvasToSafeBlob(canvas: any): Promise<Blob> {
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

/**
 * Generates an elegant SVG/Canvas typography fallback cover
 */
export async function generateTypographyFallbackCover(
  card: Partial<PaperCardData>,
  reason: string = 'No PDF'
): Promise<Blob> {
  const width = 480;
  const height = 640;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Generate subtle distinct gradient based on title hash
    let hash = 0;
    const title = card.title || 'Untitled Document';
    for (let i = 0; i < title.length; i++) {
      hash = (hash << 5) - hash + title.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;

    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, `hsl(${hue}, 40%, 25%)`);
    grad.addColorStop(1, `hsl(${(hue + 40) % 360}, 50%, 15%)`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Accent line
    ctx.fillStyle = `hsl(${hue}, 80%, 65%)`;
    ctx.fillRect(40, 50, 60, 6);

    // Item Type / Year badge
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = 'bold 16px sans-serif';
    const typeLabel = (card.itemType || 'DOCUMENT').toUpperCase();
    const yearLabel = card.year ? ` • ${card.year}` : '';
    ctx.fillText(`${typeLabel}${yearLabel}`, 40, 95);

    // Title (wrapped)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    const words = title.split(' ');
    let line = '';
    let y = 150;
    for (const word of words) {
      const testLine = line + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > width - 80 && line !== '') {
        ctx.fillText(line, 40, y);
        line = word + ' ';
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
    ctx.font = '18px sans-serif';
    ctx.fillText(card.authorText || 'Unknown Author', 40, height - 70);

    // Reason tag at bottom
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '12px sans-serif';
    ctx.fillText(`[ ${reason} ]`, 40, height - 40);
  }

  return convertCanvasToSafeBlob(canvas);
}

/**
 * Primary rendering pipeline for PDF thumbnails
 */
export async function renderPdfThumbnail(
  pdfPath: string,
  cardData: Partial<PaperCardData>
): Promise<Blob> {
  // Pre-check file existence and size
  try {
    const exists = await IOUtils.exists(pdfPath);
    if (!exists) {
      return generateTypographyFallbackCover(cardData, 'File Not Found');
    }
    const stat = await IOUtils.stat(pdfPath);
    if (!stat || stat.size === 0) {
      return generateTypographyFallbackCover(cardData, '0-Byte PDF');
    }
  } catch {
    return generateTypographyFallbackCover(cardData, 'Invalid File');
  }

  // Load PDF.js via Gecko ChromeUtils
  let pdfjs: any;
  try {
    pdfjs = await ChromeUtils.importESModule('resource://zotero/reader/pdf/build/pdf.mjs');
  } catch (err) {
    return generateTypographyFallbackCover(cardData, 'PDF.js Unavailable');
  }

  let pdfDoc: any = null;
  try {
    // Intercept password prompts to avoid blocking GUI
    const loadingTask = pdfjs.getDocument({
      url: pdfPath,
      onPassword: (updatePassword: (pw: string) => void) => {
        updatePassword('');
      }
    });

    pdfDoc = await loadingTask.promise;
    if (!pdfDoc || pdfDoc.numPages < 1) {
      return generateTypographyFallbackCover(cardData, 'Empty PDF');
    }

    // Inspect Page 1
    const page1 = await pdfDoc.getPage(1);
    let targetPage = page1;

    // Check splash sheet (JSTOR/Elsevier)
    if (pdfDoc.numPages > 1) {
      const isSplash = await detectSplashPage(page1);
      if (isSplash) {
        targetPage = await pdfDoc.getPage(2);
      }
    }

    const viewport = getClampedViewport(targetPage);
    const canvas = new OffscreenCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const renderContext = {
      canvasContext: canvas.getContext('2d'),
      viewport
    };

    await targetPage.render(renderContext).promise;
    return await convertCanvasToSafeBlob(canvas);
  } catch (err: any) {
    const errorMsg = err?.name === 'PasswordException' ? 'Password Protected' : 'Corrupted PDF';
    return generateTypographyFallbackCover(cardData, errorMsg);
  } finally {
    if (pdfDoc && typeof pdfDoc.destroy === 'function') {
      try {
        await pdfDoc.destroy();
      } catch {
        // Ignore destroy error
      }
    }
  }
}
