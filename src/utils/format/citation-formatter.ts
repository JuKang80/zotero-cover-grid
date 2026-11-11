import { PaperCardData, ReadStatus } from '../../types';
import { richTextToPlainText } from '../rich-text';

export interface Creator {
  lastName?: string;
  firstName?: string;
  name?: string;
  creatorType?: string;
}

/**
 * APA 7th Edition In-Text Citation Formatter
 * - 1 author: Kim (2026)
 * - 2 authors: Kim & Lee (2026)
 * - 3+ authors: Kim et al. (2026)
 * - No author: [Short Title] (2026) or (2026)
 * - No year: Kim (n.d.)
 */
export function formatApa7Citation(
  creators: Creator[] = [],
  year?: string | number,
  fallbackTitle?: string
): string {
  const safeYear = year ? String(year).trim() : 'n.d.';
  const authorNames = (creators || [])
    .filter(Boolean)
    .map((c) => {
      if (!c) return '';
      if (typeof c === 'string') return c;
      const last = c.lastName != null ? String(c.lastName).trim() : '';
      const full = c.name != null ? String(c.name).trim() : '';
      const first = c.firstName != null ? String(c.firstName).trim() : '';
      return last || full || first;
    })
    .filter((n) => n.length > 0);

  if (authorNames.length === 0) {
    if (fallbackTitle && String(fallbackTitle).trim() && String(fallbackTitle).trim() !== 'Untitled') {
      const cleanTitle = richTextToPlainText(String(fallbackTitle)).trim();
      const shortTitle = cleanTitle.length > 28 ? `${cleanTitle.slice(0, 28).trim()}…` : cleanTitle;
      return `${shortTitle} (${safeYear})`;
    }
    return `(${safeYear})`;
  }

  if (authorNames.length === 1) {
    return `${authorNames[0]} (${safeYear})`;
  }

  if (authorNames.length === 2) {
    return `${authorNames[0]} & ${authorNames[1]} (${safeYear})`;
  }

  // 3 or more authors: APA 7 uses et al. right from the first in-text mention
  return `${authorNames[0]} et al. (${safeYear})`;
}

/**
 * Extracts ReadStatus from Zotero tags
 */
export function extractReadStatusFromTags(tags: Array<{ tag: string } | string> = []): ReadStatus {
  if (!Array.isArray(tags)) return 'unread';
  for (const t of tags) {
    if (!t) continue;
    const tagStr = (typeof t === 'string' ? t : (t.tag || '')).toLowerCase().trim();
    if (tagStr === '#read' || tagStr === 'read') return 'read';
    if (tagStr === '#reading' || tagStr === 'reading') return 'reading';
    if (tagStr === '#unread' || tagStr === 'unread') return 'unread';
  }
  return 'unread';
}

/**
 * Formats full APA 7 bibliographic reference entry
 * Example: Author, A. (2026). Title of paper. Journal Name, 12(3), 45-56. https://doi.org/...
 */
export function formatFullApa7Bibliography(card: PaperCardData, rawItem?: any): string {
  const authorPart = card.authorText || 'Unknown Author';
  const yearPart = card.year ? `(${card.year}).` : '(n.d.).';
  const cleanTitle = richTextToPlainText(card.title || 'Untitled');
  const titlePart = cleanTitle ? (cleanTitle.endsWith('.') ? cleanTitle : `${cleanTitle}.`) : 'Untitled.';

  let publication = '';
  let volume = '';
  let issue = '';
  let pages = '';
  let doi = '';

  if (rawItem && typeof rawItem.getField === 'function') {
    try {
      publication = rawItem.getField('publicationTitle') || rawItem.getField('publisher') || '';
      volume = rawItem.getField('volume') || '';
      issue = rawItem.getField('issue') || '';
      pages = rawItem.getField('pages') || '';
      doi = rawItem.getField('DOI') || '';
    } catch {}
  }

  let journalPart = '';
  if (publication) {
    journalPart = `${publication}`;
    if (volume) {
      journalPart += `, ${volume}`;
      if (issue) journalPart += `(${issue})`;
    }
    if (pages) journalPart += `, ${pages}`;
    journalPart += '.';
  }

  let doiPart = '';
  if (doi) {
    doiPart = doi.startsWith('http') ? doi : `https://doi.org/${doi}`;
  }

  const parts = [authorPart, yearPart, titlePart, journalPart, doiPart].filter(Boolean);
  return parts.join(' ');
}
