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
