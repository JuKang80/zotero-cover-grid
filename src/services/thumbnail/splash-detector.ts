export const SPLASH_KEYWORDS = [
  'jstor',
  'elsevier',
  'springer',
  'wiley',
  'ieee xplore',
  'downloaded from',
  'terms and conditions',
  'monograph',
  'bell telephone',
  'technical publications',
  'bell system technical'
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
