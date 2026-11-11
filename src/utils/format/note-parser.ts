/**
 * Note parsing utilities for Zotero Standalone Notes
 */

import { richTextToPlainText } from '../rich-text';

export interface StandaloneNoteData {
  title: string;
  notePreview: string;
  authorText: string;
  citationText: string;
  publicationTitle: string;
  itemType: string;
}

/**
 * Strips HTML formatting and decodes common entities to plain text.
 */
export function stripHtmlToPlainText(rawHtml: string): string {
  if (!rawHtml) return '';
  const prepared = rawHtml
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n');
  
  return prepared
    .split('\n')
    .map((line) => richTextToPlainText(line))
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
    .join('\n')
    .trim();
}

/**
 * Determines whether a Zotero item is a standalone note
 */
export function isStandaloneNoteItem(item: any, itemType?: string): boolean {
  if (typeof item?.isNote === 'function') {
    return item.isNote();
  }
  return itemType === 'note' || item?.itemType === 'note';
}

/**
 * Parses a Zotero standalone note item into normalized metadata fields
 */
export function parseStandaloneNote(item: any): StandaloneNoteData {
  let rawNote = '';
  try {
    rawNote = item.getNote?.() || item.note || '';
  } catch {
    rawNote = '';
  }

  const plainNote = stripHtmlToPlainText(rawNote);
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
  const title = noteTitle || 'Untitled Note';

  let bodyLines = lines;
  if (lines.length > 0 && lines[0] === title) {
    bodyLines = lines.slice(1);
  }
  const previewBody = bodyLines.join(' ');
  const notePreview = previewBody.slice(0, 160);

  let modDate = '';
  try {
    modDate = item.dateModified || item.dateAdded || '';
  } catch {}
  const authorText = modDate ? `Note · ${String(modDate).slice(0, 10)}` : 'Research Note';
  const citationText = 'Note';
  const publicationTitle = 'RESEARCH NOTE';

  return {
    title,
    notePreview,
    authorText,
    citationText,
    publicationTitle,
    itemType: 'note'
  };
}
