import { PaperCardData } from '../../types';
import { createSafeCanvas, convertCanvasToSafeBlob } from './canvas-utils';

/**
 * Generates an elegant SVG/Canvas typography fallback cover
 */
export async function generateTypographyFallbackCover(
  card: Partial<PaperCardData>,
  reason: string = 'No PDF',
  doc?: any
): Promise<Blob> {
  const width = 480;
  const height = 640;
  const canvas = createSafeCanvas(width, height, doc);
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
