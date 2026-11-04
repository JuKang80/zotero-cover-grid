import { describe, it, expect, vi } from 'vitest';
import { detectSplashPage, SPLASH_KEYWORDS } from '../src/services/pdf-thumbnail-service';

describe('PDF Splash Sheet Detector', () => {
  it('should detect JSTOR splash page from text content', async () => {
    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          { str: 'Your use of the JSTOR archive indicates your acceptance of the Terms & Conditions' },
          { str: 'Downloaded from 192.168.1.1' }
        ]
      })
    };

    const isSplash = await detectSplashPage(mockPage);
    expect(isSplash).toBe(true);
  });

  it('should detect Elsevier and Springer splash pages', async () => {
    const mockElsevier = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: 'ScienceDirect Elsevier All rights reserved' }]
      })
    };

    const mockSpringer = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: 'Springer Nature Link. Downloaded from user IP' }]
      })
    };

    expect(await detectSplashPage(mockElsevier)).toBe(true);
    expect(await detectSplashPage(mockSpringer)).toBe(true);
  });

  it('should return false for regular scientific paper first pages', async () => {
    const mockPaper = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          { str: 'Deep Residual Learning for Image Recognition' },
          { str: 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun' },
          { str: 'Abstract. Deeper neural networks are more difficult to train.' }
        ]
      })
    };

    const isSplash = await detectSplashPage(mockPaper);
    expect(isSplash).toBe(false);
  });

  it('should handle errors gracefully and return false', async () => {
    const brokenPage = {
      getTextContent: vi.fn().mockRejectedValue(new Error('Corrupt page stream'))
    };

    const isSplash = await detectSplashPage(brokenPage);
    expect(isSplash).toBe(false);
  });
});
