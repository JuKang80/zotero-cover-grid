import { PaperCardData, ReadStatus } from '../types';

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
 * - No author: Untitled (2026)
 * - No year: Kim (n.d.)
 */
export function formatApa7Citation(creators: Creator[] = [], year?: string | number): string {
  const safeYear = year ? String(year).trim() : 'n.d.';
  const authorNames = creators
    .map((c) => c.lastName || c.name || (c.firstName ? c.firstName : ''))
    .filter((n) => n.trim().length > 0);

  if (authorNames.length === 0) {
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
  for (const t of tags) {
    const tagStr = typeof t === 'string' ? t.toLowerCase() : (t.tag || '').toLowerCase();
    if (tagStr === '#read' || tagStr === 'read') return 'read';
    if (tagStr === '#reading' || tagStr === 'reading') return 'reading';
    if (tagStr === '#unread' || tagStr === 'unread') return 'unread';
  }
  return 'unread';
}

/**
 * Maps raw Zotero item to standard PaperCardData
 */
export function extractPaperCardData(item: any): PaperCardData {
  try {
    const id = item?.id || 0;
    const key = item?.key || `KEY_${id}`;
    let title = 'Untitled';
    try {
      title = item.getField?.('title') || item.title || 'Untitled';
    } catch {
      title = 'Untitled';
    }

    let creators: Creator[] = [];
    try {
      creators = item.getCreators?.() || [];
    } catch {
      creators = [];
    }

    let rawDate = '';
    try {
      rawDate = item.getField?.('date') || item.date || '';
    } catch {
      rawDate = '';
    }
    const yearMatch = String(rawDate).match(/\b\d{4}\b/);
    const year = yearMatch ? yearMatch[0] : '';

    const citationText = formatApa7Citation(creators, year);
    const authorText = creators.map((c) => c.lastName || c.name || c.firstName).filter(Boolean).join(', ') || 'Unknown Author';

    let tags: any[] = [];
    try {
      tags = item.getTags?.() || item.tags || [];
    } catch {
      tags = [];
    }
    const readStatus = extractReadStatusFromTags(tags);
    let itemType = 'journalArticle';
    try {
      itemType = item.itemType || item.getItemType?.() || 'journalArticle';
    } catch {
      itemType = 'journalArticle';
    }

    return {
      id,
      key,
      title,
      authorText,
      citationText,
      itemType,
      year,
      readStatus,
      hasPdf: false // Will be updated when attachment is resolved
    };
  } catch {
    return {
      id: item?.id || 0,
      key: item?.key || 'UNKNOWN',
      title: 'Untitled',
      authorText: 'Unknown Author',
      citationText: '(n.d.)',
      itemType: 'journalArticle',
      year: '',
      readStatus: 'unread',
      hasPdf: false
    };
  }
}
