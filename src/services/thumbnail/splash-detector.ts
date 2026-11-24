export const SPLASH_KEYWORDS = [
  'jstor',
  'elsevier',
  'springer',
  'wiley',
  'ieee xplore',
  'downloaded from',
  'terms and conditions',
  'terms & conditions',
  'see discussions, stats, and author profiles',
  'taylor & francis',
  'tandfonline',
  'proquest',
  'bell telephone',
  'technical publications',
  'bell system technical'
];

const EXPLICIT_COVER_SHEET_MARKERS = [
  'downloaded from',
  'terms and conditions',
  'terms & conditions',
  'your use of the jstor archive',
  'see discussions, stats, and author profiles'
];

/**
 * Checks if a PDF page is a publisher splash/cover sheet (e.g. JSTOR, ScienceDirect, ResearchGate cover sheet).
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

    // 1. If page contains an academic abstract, it is a genuine paper page
    if (fullText.includes('abstract')) {
      return false;
    }

    // 2. Explicit download cover sheets (e.g. JSTOR, ResearchGate, Taylor & Francis) may have 400–1200 chars
    const hasExplicitCoverMarker = EXPLICIT_COVER_SHEET_MARKERS.some((kw) => fullText.includes(kw));
    if (hasExplicitCoverMarker && fullText.length <= 1200 && items.length <= 120) {
      return true;
    }

    // 3. Substantial text without explicit cover sheet markers is a genuine paper page
    if (fullText.length > 400 || items.length > 60) {
      return false;
    }

    // 4. Short publisher splash pages matching splash keywords qualify
    return SPLASH_KEYWORDS.some((kw) => fullText.includes(kw));
  } catch {
    return false;
  }
}
