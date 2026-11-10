declare const Services: any;
declare const Zotero: any;

export const MAX_CANVAS_WIDTH = 640;
export const MAX_CANVAS_HEIGHT = 854;

export function getHostWindow(): any {
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

/**
 * Calculates a scaled viewport preserving rotation and clamped to max dimensions
 */
export function getClampedViewport(page: any) {
  const rotation = page.rotate || 0;
  const initialVp = page.getViewport({ scale: 1.0, rotation });

  const scale = Math.min(
    2.0,
    MAX_CANVAS_WIDTH / initialVp.width,
    MAX_CANVAS_HEIGHT / initialVp.height
  );

  return page.getViewport({ scale, rotation });
}

/**
 * Creates an OffscreenCanvas or HTML5 Canvas compatible with Gecko environment & Cu.Sandbox
 */
export function createSafeCanvas(width: number, height: number, doc?: any): any {
  const safeW = Math.max(1, Math.floor(width));
  const safeH = Math.max(1, Math.floor(height));

  if (doc) {
    const canvas =
      typeof doc.createElementNS === 'function'
        ? doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas')
        : doc.createElement('canvas');
    canvas.width = safeW;
    canvas.height = safeH;
    return canvas;
  }

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
    const hostDoc = win.document;
    if (hostDoc) {
      const canvas =
        typeof hostDoc.createElementNS === 'function'
          ? hostDoc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas')
          : hostDoc.createElement('canvas');
      canvas.width = safeW;
      canvas.height = safeH;
      return canvas;
    }
  }

  throw new Error('Canvas rendering context unavailable');
}

/**
 * Trims dark scanner platen borders and microfilm gutter bands from scanned PDFs.
 * Only trims if a dark outer edge transitions into light paper, avoiding cropping
 * intentionally dark book covers or posters.
 */
export function trimCanvasArtifacts(canvas: any, doc?: any): any {
  if (!canvas || !canvas.width || !canvas.height) return canvas;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx || typeof ctx.getImageData !== 'function') return canvas;

  try {
    const width = canvas.width;
    const height = canvas.height;
    if (width < 30 || height < 30) return canvas;

    const imgData = ctx.getImageData(0, 0, width, height);
    if (!imgData || !imgData.data) return canvas;
    const data = imgData.data;

    const getLuminance = (x: number, y: number): number => {
      const idx = (y * width + x) * 4;
      return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    };

    const isColumnDark = (x: number, sampleStep = 8): boolean => {
      let darkCount = 0;
      let total = 0;
      for (let y = 0; y < height; y += sampleStep) {
        total++;
        if (getLuminance(x, y) < 75) darkCount++;
      }
      return darkCount / total > 0.7;
    };

    const isRowDark = (y: number, sampleStep = 8): boolean => {
      let darkCount = 0;
      let total = 0;
      for (let x = 0; x < width; x += sampleStep) {
        total++;
        if (getLuminance(x, y) < 75) darkCount++;
      }
      return darkCount / total > 0.7;
    };

    const maxScanX = Math.floor(width * 0.18);
    const maxScanY = Math.floor(height * 0.12);

    let left = 0;
    while (left < maxScanX && isColumnDark(left)) left++;

    let right = width - 1;
    while (right > width - 1 - maxScanX && isColumnDark(right)) right--;

    let top = 0;
    while (top < maxScanY && isRowDark(top)) top++;

    let bottom = height - 1;
    while (bottom > height - 1 - maxScanY && isRowDark(bottom)) bottom--;

    // Safeguard: verify that the region just inside the border is noticeably lighter
    const isInsideLightX = (x: number): boolean => {
      let lightCount = 0;
      let total = 0;
      for (let y = Math.floor(height * 0.2); y < Math.floor(height * 0.8); y += 8) {
        total++;
        if (getLuminance(x, y) > 130) lightCount++;
      }
      return lightCount / total > 0.5;
    };

    const isInsideLightY = (y: number): boolean => {
      let lightCount = 0;
      let total = 0;
      for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x += 8) {
        total++;
        if (getLuminance(x, y) > 130) lightCount++;
      }
      return lightCount / total > 0.5;
    };

    if (left > 0 && !isInsideLightX(Math.min(width - 1, left + 4))) left = 0;
    if (right < width - 1 && !isInsideLightX(Math.max(0, right - 4))) right = width - 1;
    if (top > 0 && !isInsideLightY(Math.min(height - 1, top + 4))) top = 0;
    if (bottom < height - 1 && !isInsideLightY(Math.max(0, bottom - 4))) bottom = height - 1;

    const cropW = right - left + 1;
    const cropH = bottom - top + 1;

    if ((left > 0 || right < width - 1 || top > 0 || bottom < height - 1) && cropW >= width * 0.6 && cropH >= height * 0.6) {
      const trimmedCanvas = createSafeCanvas(cropW, cropH, doc);
      const trimmedCtx = trimmedCanvas.getContext('2d');
      if (trimmedCtx) {
        trimmedCtx.drawImage(canvas, left, top, cropW, cropH, 0, 0, cropW, cropH);
        return trimmedCanvas;
      }
    }
  } catch {
    // Graceful fallback to original canvas on any error
  }

  return canvas;
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
