import { describe, it, expect, vi } from 'vitest';
import {
  getClampedViewport,
  renderPdfThumbnail,
  convertCanvasToSafeBlob,
  generateTypographyFallbackCover,
  MAX_CANVAS_WIDTH,
  MAX_CANVAS_HEIGHT,
  trimCanvasArtifacts
} from '../src/services/pdf-thumbnail-service';

declare const IOUtils: any;
declare const ChromeUtils: any;

describe('PDF Thumbnail Edge Cases & Defense', () => {
  it('should clamp massive A0 poster dimensions down preserving aspect ratio', () => {
    const mockHugePage = {
      rotate: 0,
      getViewport: ({ scale, rotation }: any) => ({
        width: 2384 * scale,
        height: 3370 * scale,
        rotation
      })
    };

    const vp = getClampedViewport(mockHugePage);
    expect(vp.width).toBeLessThanOrEqual(MAX_CANVAS_WIDTH + 1);
    expect(vp.height).toBeLessThanOrEqual(MAX_CANVAS_HEIGHT + 1);
  });

  it('should preserve rotation angle in clamped viewport', () => {
    const mockRotatedPage = {
      rotate: 90,
      getViewport: ({ scale, rotation }: any) => ({
        width: 800 * scale,
        height: 600 * scale,
        rotation
      })
    };

    const vp = getClampedViewport(mockRotatedPage);
    expect(vp.rotation).toBe(90);
  });

  it('should generate fallback typography cover for 0-byte PDF without crashing', async () => {
    IOUtils.stat.mockResolvedValueOnce({ size: 0 });

    const card = { title: 'Zero Byte Paper', authorText: 'Doe' };
    const blob = await renderPdfThumbnail('/path/empty.pdf', card);

    expect(blob).toBeDefined();
    expect(blob.type).toBe('image/webp');
  });

  it('should handle PasswordException gracefully and return fallback cover without blocking', async () => {
    IOUtils.stat.mockResolvedValueOnce({ size: 1024 });
    ChromeUtils.importESModule.mockResolvedValueOnce({
      getDocument: () => ({
        promise: Promise.reject({ name: 'PasswordException', message: 'Password required' })
      })
    });

    const card = { title: 'Encrypted Report', authorText: 'Smith' };
    const blob = await renderPdfThumbnail('/path/encrypted.pdf', card);

    expect(blob).toBeDefined();
  });

  it('should safely fallback across 3 tiers (WebP -> JPEG -> PNG)', async () => {
    const mockCanvas = {
      convertToBlob: vi.fn()
        .mockRejectedValueOnce(new Error('WebP not supported'))
        .mockRejectedValueOnce(new Error('JPEG encoder error'))
        .mockResolvedValueOnce(new Blob(['png-bytes'], { type: 'image/png' }))
    };

    const blob = await convertCanvasToSafeBlob(mockCanvas);
    expect(blob.type).toBe('image/png');
    expect(mockCanvas.convertToBlob).toHaveBeenCalledTimes(3);
  });

  describe('trimCanvasArtifacts Scanner Border Defense', () => {
    it('should trim dark scanner platen borders from edges when transitioning to light paper', () => {
      const w = 100;
      const h = 100;
      const data = new Uint8ClampedArray(w * h * 4);

      // Create a canvas with 10px dark scanner border on left/right and white paper inside
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          if (x < 10 || x >= 90) {
            // Dark scanner border
            data[idx] = 20;
            data[idx + 1] = 20;
            data[idx + 2] = 20;
            data[idx + 3] = 255;
          } else {
            // White paper
            data[idx] = 250;
            data[idx + 1] = 250;
            data[idx + 2] = 250;
            data[idx + 3] = 255;
          }
        }
      }

      const mockCtx = {
        getImageData: vi.fn(() => ({ data, width: w, height: h })),
        drawImage: vi.fn()
      };

      const mockCanvas = {
        width: w,
        height: h,
        getContext: vi.fn(() => mockCtx)
      };

      const trimmed = trimCanvasArtifacts(mockCanvas);
      expect(trimmed).toBeDefined();
      expect(trimmed.width).toBeLessThan(w);
    });

    it('should preserve all-dark book covers without cropping', () => {
      const w = 100;
      const h = 100;
      const data = new Uint8ClampedArray(w * h * 4);

      // Entire image is dark (e.g. black book cover)
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 25;
        data[i + 1] = 25;
        data[i + 2] = 25;
        data[i + 3] = 255;
      }

      const mockCtx = {
        getImageData: vi.fn(() => ({ data, width: w, height: h })),
        drawImage: vi.fn()
      };

      const mockCanvas = {
        width: w,
        height: h,
        getContext: vi.fn(() => mockCtx)
      };

      const trimmed = trimCanvasArtifacts(mockCanvas);
      // Because entire page is dark, it should NOT crop!
      expect(trimmed.width).toBe(w);
      expect(trimmed.height).toBe(h);
    });

    it('should return original canvas gracefully when getImageData is unsupported', () => {
      const mockCanvas = {
        width: 100,
        height: 100,
        getContext: vi.fn(() => ({})) // no getImageData
      };

      const result = trimCanvasArtifacts(mockCanvas);
      expect(result).toBe(mockCanvas);
    });
  });

  it('should pass wasmUrl, iccUrl, CanvasFactory, and retry with disableFontFace=true on legacy PDF font failure', async () => {
    IOUtils.exists.mockResolvedValueOnce(true);
    IOUtils.read.mockResolvedValueOnce(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));

    const capturedOptions: any[] = [];
    let renderAttempt = 0;

    ChromeUtils.importESModule.mockResolvedValueOnce({
      getDocument: (opts: any) => {
        capturedOptions.push(opts);
        return {
          promise: Promise.resolve({
            numPages: 1,
            getPage: async () => ({
              rotate: 0,
              getViewport: ({ scale, rotation }: any) => ({ width: 300 * scale, height: 400 * scale, rotation }),
              render: () => ({
                promise: (() => {
                  renderAttempt++;
                  // Simulate first 2 render attempts failing due to legacy Type1/OCR FontFace OTS rejection,
                  // succeeding when reopened with disableFontFace=true
                  if (!opts.disableFontFace) {
                    return Promise.reject(new Error('Failed to load font: OTS parsing error'));
                  }
                  return Promise.resolve();
                })()
              })
            }),
            destroy: vi.fn()
          }),
          destroy: vi.fn()
        };
      }
    });

    const card = { title: 'Learning and memorization of classifications', authorText: 'Shepard et al.' };
    const blob = await renderPdfThumbnail('/path/shj1961.pdf', card);

    expect(blob).toBeDefined();
    expect((blob as any).__isFallbackCover).toBeFalsy();
    expect(capturedOptions.length).toBe(2);
    expect(capturedOptions[0].wasmUrl).toBe('resource://zotero/reader/pdf/web/wasm/');
    expect(capturedOptions[0].iccUrl).toBe('resource://zotero/reader/pdf/web/iccs/');
    expect(capturedOptions[0].CanvasFactory).toBeDefined();
    expect(capturedOptions[0].disableFontFace).toBe(false);
    expect(capturedOptions[1].disableFontFace).toBe(true);
  });
});
