import { describe, it, expect, vi } from 'vitest';
import {
  getClampedViewport,
  renderPdfThumbnail,
  convertCanvasToSafeBlob,
  generateTypographyFallbackCover,
  MAX_CANVAS_WIDTH,
  MAX_CANVAS_HEIGHT
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
});
