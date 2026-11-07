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

    let citationText = formatApa7Citation(creators, year);
    let authorText = creators.map((c) => c.lastName || c.name || c.firstName).filter(Boolean).join(', ') || 'Unknown Author';

    let tags: any[] = [];
    try {
      tags = item.getTags?.() || item.tags || [];
    } catch {
      tags = [];
    }
    const tagNames: string[] = tags
      .map((t: any) => (typeof t === 'string' ? t : t?.tag))
      .filter((name: any): name is string => typeof name === 'string' && name.length > 0);
    const readStatus = extractReadStatusFromTags(tags);
    let itemType = 'journalArticle';
    try {
      itemType = item.itemType || item.getItemType?.() || 'journalArticle';
    } catch {
      itemType = 'journalArticle';
    }

    let publicationTitle = '';
    try {
      publicationTitle = item.getField?.('publicationTitle') || item.publicationTitle || '';
    } catch {
      publicationTitle = '';
    }

    // Special handling for Zotero Standalone Notes
    const isNote = typeof item?.isNote === 'function' ? item.isNote() : itemType === 'note';
    let notePreview = '';
    if (isNote) {
      itemType = 'note';
      let rawNote = '';
      try {
        rawNote = item.getNote?.() || item.note || '';
      } catch {
        rawNote = '';
      }
      const plainNote = rawNote
        .replace(/<style[^>]*>.*?<\/style>/gi, '')
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/<br\s*[\/]?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_: string, dec: string) => String.fromCharCode(Number(dec)))
        .replace(/&#x([0-9a-f]+);/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&nbsp;/gi, ' ')
        .replace(/&(apos|lsquo|rsquo);/gi, "'")
        .replace(/&(ldquo|rdquo);/gi, '"')
        .replace(/&(ndash|mdash);/gi, '—')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/[^\S\n]+/g, ' ')
        .trim();

      const lines = plainNote.split('\n').map((l: string) => l.trim()).filter(Boolean);
      let noteTitle = '';
      try {
        noteTitle = item.getNoteTitle?.() || '';
      } catch {
        noteTitle = '';
      }
      if (!noteTitle && lines.length > 0) {
        noteTitle = lines[0];
      }
      title = noteTitle || 'Untitled Note';

      let bodyLines = lines;
      if (lines.length > 0 && lines[0] === title) {
        bodyLines = lines.slice(1);
      }
      const previewBody = bodyLines.join(' ');
      notePreview = previewBody.slice(0, 160);

      let modDate = '';
      try {
        modDate = item.dateModified || item.dateAdded || '';
      } catch {}
      authorText = modDate ? `Note · ${String(modDate).slice(0, 10)}` : 'Research Note';
      citationText = 'Note';
      publicationTitle = 'RESEARCH NOTE';
    }

    // Extract Zotero native colored tags (position 1-9 assigned colors)
    let colorTags: Array<{ tag: string; color: string }> = [];
    try {
      if (typeof item.getItemsListTags === 'function') {
        const listTags = item.getItemsListTags();
        if (Array.isArray(listTags)) {
          colorTags = listTags.filter((t: any) => t && t.color).map((t: any) => ({ tag: t.tag, color: t.color }));
        }
      }
      if (colorTags.length === 0) {
        const zObj =
          (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero : null) ||
          item?.Zotero;
        if (zObj?.Tags?.getColors) {
          const libId = item?.libraryID || zObj.Libraries?.userLibraryID || 1;
          const zColors = zObj.Tags.getColors(libId);
          if (zColors && typeof zColors.get === 'function') {
            colorTags = tags
              .map((t: any) => {
                const name = typeof t === 'string' ? t : t?.tag;
                const entry = name ? zColors.get(name) : null;
                return entry?.color ? { tag: name, color: entry.color, position: entry.position ?? 99 } : null;
              })
              .filter(Boolean)
              .sort((a: any, b: any) => a.position - b.position)
              .map(({ tag, color }: any) => ({ tag, color }));
          } else if (Array.isArray(zColors)) {
            colorTags = tags
              .map((t: any) => {
                const name = typeof t === 'string' ? t : t?.tag;
                const entry = name ? zColors.find((c: any) => c && c.tag === name) : null;
                return entry?.color ? { tag: name, color: entry.color, position: entry.position ?? 99 } : null;
              })
              .filter(Boolean)
              .sort((a: any, b: any) => a.position - b.position)
              .map(({ tag, color }: any) => ({ tag, color }));
          }
        }
      }
    } catch {
      colorTags = [];
    }

    return {
      id,
      key,
      title,
      authorText,
      citationText,
      itemType,
      year,
      publicationTitle,
      notePreview,
      readStatus,
      hasPdf: false, // Will be updated when attachment is resolved
      tags: tagNames,
      colorTags
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

/**
 * Formats full APA 7 bibliographic reference entry
 * Example: Author, A. (2026). Title of paper. Journal Name, 12(3), 45-56. https://doi.org/...
 */
export function formatFullApa7Bibliography(card: PaperCardData, rawItem?: any): string {
  const authorPart = card.authorText || 'Unknown Author';
  const yearPart = card.year ? `(${card.year}).` : '(n.d.).';
  const titlePart = card.title ? (card.title.endsWith('.') ? card.title : `${card.title}.`) : 'Untitled.';

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

/**
 * Robust cross-environment clipboard writer
 */
export async function copyTextToClipboard(text: string, win?: any): Promise<boolean> {
  const targetWin = win || (typeof window !== 'undefined' ? window : (globalThis as any).Zotero?.getMainWindow?.());
  // 1. Try modern navigator.clipboard
  try {
    if (targetWin?.navigator?.clipboard?.writeText) {
      await targetWin.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  // 2. Try Gecko XPCOM clipboard helper
  try {
    const Cc = (globalThis as any).Components?.classes;
    const Ci = (globalThis as any).Components?.interfaces;
    if (Cc && Ci) {
      const helper = Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper);
      helper.copyString(text);
      return true;
    }
  } catch {}

  // 3. Fallback: textarea execCommand
  try {
    const doc = targetWin?.document || (typeof document !== 'undefined' ? document : null);
    if (doc) {
      const textarea = doc.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      doc.body.appendChild(textarea);
      textarea.select();
      doc.execCommand('copy');
      textarea.remove();
      return true;
    }
  } catch {}

  return false;
}
