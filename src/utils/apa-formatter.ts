import { PaperCardData } from '../types';
import {
  Creator,
  formatApa7Citation,
  extractReadStatusFromTags
} from './format/citation-formatter';
import {
  isStandaloneNoteItem,
  parseStandaloneNote
} from './format/note-parser';

// Re-export all submodules to maintain 100% backward compatibility as a Facade
export * from './format/clipboard';
export * from './format/note-parser';
export * from './format/citation-formatter';

/**
 * Maps raw Zotero item to standard PaperCardData
 */
export function extractPaperCardData(item: any): PaperCardData {
  try {
    const id = item?.id || 0;
    const key = item?.key || `KEY_${id}`;
    let title = 'Untitled';
    try {
      const rawTitle = item.getField?.('title') || item.title;
      if (rawTitle && String(rawTitle).trim()) {
        title = String(rawTitle).trim();
      } else {
        const fallbackTitle =
          item.getDisplayTitle?.() ||
          item.attachmentFilename ||
          item.getFilename?.() ||
          item.filename ||
          '';
        if (fallbackTitle && String(fallbackTitle).trim()) {
          // If fallback is a filename with extension (e.g. .pdf), clean it for display
          title = String(fallbackTitle).trim().replace(/\.[^.]+$/, '');
        }
      }
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

    let citationText = formatApa7Citation(creators, year, title);
    let authorText =
      creators.map((c) => c.lastName || c.name || c.firstName).filter(Boolean).join(', ') ||
      (title && title !== 'Untitled' ? title : 'Unknown Author');

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
      if (item.isAttachment?.()) {
        itemType = 'attachment';
      } else {
        itemType = item.itemType || item.getItemType?.() || 'journalArticle';
      }
    } catch {
      itemType = 'journalArticle';
    }

    let isAttachmentPdf = false;
    const isAttachment = typeof item.isAttachment === 'function' && item.isAttachment();
    if (isAttachment) {
      let filenameOrPath = '';
      try {
        filenameOrPath = String(item.attachmentFilename || item.attachmentPath || '').toLowerCase();
      } catch {
        try {
          filenameOrPath = String(item.attachmentPath || '').toLowerCase();
        } catch {}
      }
      const contentType = String(item.attachmentContentType || '').toLowerCase();
      const isExplicitNonPdf =
        Boolean(
          item.isSnapshotAttachment?.() ||
          item.isEPUBAttachment?.() ||
          item.isImageAttachment?.() ||
          item.isVideoAttachment?.() ||
          item.attachmentLinkMode === 3
        ) ||
        contentType.includes('html') ||
        contentType.includes('epub') ||
        contentType.startsWith('image/') ||
        contentType.startsWith('video/') ||
        /\.(html?|epub|png|jpe?g|gif|webp|svg|mp4|mov|docx?|xlsx?|pptx?|txt|md|csv|zip)$/i.test(filenameOrPath);
      const isFileAtt = typeof item.isFileAttachment === 'function' ? item.isFileAttachment() : true;
      isAttachmentPdf = Boolean(
        item.isPDFAttachment?.() ||
        contentType.includes('pdf') ||
        filenameOrPath.endsWith('.pdf') ||
        (isFileAtt && !isExplicitNonPdf)
      );
    }

    let publicationTitle = '';
    try {
      publicationTitle = item.getField?.('publicationTitle') || item.publicationTitle || '';
    } catch {
      publicationTitle = '';
    }

    // Special handling for Zotero Standalone Notes
    const isNote = isStandaloneNoteItem(item, itemType);
    let notePreview = '';
    if (isNote) {
      const parsedNote = parseStandaloneNote(item);
      itemType = parsedNote.itemType;
      title = parsedNote.title;
      notePreview = parsedNote.notePreview;
      authorText = parsedNote.authorText;
      citationText = parsedNote.citationText;
      publicationTitle = parsedNote.publicationTitle;
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
                const entry = name ? zColors.get(name) || zColors.get(String(name).normalize()) : null;
                return entry?.color ? { tag: name, color: entry.color, position: entry.position ?? 99 } : null;
              })
              .filter(Boolean)
              .sort((a: any, b: any) => a.position - b.position)
              .map(({ tag, color }: any) => ({ tag, color }));
          } else if (Array.isArray(zColors)) {
            colorTags = tags
              .map((t: any) => {
                const name = typeof t === 'string' ? t : t?.tag;
                const entry = name
                  ? zColors.find((c: any) => c && (c.tag === name || c.name === name))
                  : null;
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
      hasPdf: isAttachmentPdf, // Initialized for attachments, updated asynchronously for parent items
      pdfResolved: isAttachment || isNote,
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
      hasPdf: false,
      pdfResolved: false
    };
  }
}
