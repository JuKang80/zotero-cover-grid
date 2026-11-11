import { PaperCardData, ReadStatus } from '../../types';
import { renderRichText, richTextToPlainText } from '../../utils/rich-text';
import {
  formatBadgeText,
  formatItemTypeLabel,
  isTagBandEnabled,
  renderColorDots,
} from './card-dom-builder';

export function updatePaperCardMetadata(cardEl: HTMLElement, card: PaperCardData) {
  (cardEl as any).__cardData = card;
  const plainTitle = richTextToPlainText(card.title);
  cardEl.title = `${plainTitle}\n${card.citationText || card.authorText}`;
  const titleEl = cardEl.querySelector('.card-title') as HTMLElement | null;
  if (titleEl && (titleEl as any).__renderedRichText !== card.title) {
    renderRichText(titleEl, card.title);
    titleEl.title = plainTitle;
  }
  const authorEl = cardEl.querySelector('.card-author') as HTMLElement | null;
  const nextAuthor = card.citationText || card.authorText;
  if (authorEl) {
    if (authorEl.textContent !== nextAuthor) authorEl.textContent = nextAuthor;
    authorEl.title = `${card.authorText} (${card.year || 'n.d.'}) - ${plainTitle}`;
  }
  const bookTitle = cardEl.querySelector('.book-cover-title') as HTMLElement | null;
  if (bookTitle && (bookTitle as any).__renderedRichText !== card.title) {
    renderRichText(bookTitle, card.title);
  }
  const bookHeader = cardEl.querySelector('.book-cover-header') as HTMLElement | null;
  const isNote = card.itemType === 'note';
  if (bookHeader) {
    const nextHeader = isNote ? '📝 RESEARCH NOTE' : richTextToPlainText(card.publicationTitle || formatItemTypeLabel(card.itemType)).toUpperCase();
    if (bookHeader.textContent !== nextHeader) bookHeader.textContent = nextHeader;
  }
  const bookFooter = cardEl.querySelector('.book-cover-footer') as HTMLElement | null;
  if (bookFooter) {
    const strippedAuthor = card.citationText ? card.citationText.replace(/\s*\((?:\d{4}|n\.d\.)\)/, '').trim() : '';
    const firstAuthor = richTextToPlainText(strippedAuthor || card.authorText);
    const nextFooter = isNote ? (card.year ? `${card.year} · Note` : 'Note') : (card.year ? `${card.year} · ${firstAuthor}` : firstAuthor);
    if (bookFooter.textContent !== nextFooter) bookFooter.textContent = nextFooter;
  }
  if (isNote) {
    const bookCoverEl = cardEl.querySelector('.card-book-cover') as HTMLElement | null;
    let noteBody = cardEl.querySelector('.book-cover-note-body') as HTMLElement | null;
    if (card.notePreview) {
      if (!noteBody && bookCoverEl && bookFooter) {
        const doc = cardEl.ownerDocument || document;
        noteBody = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        noteBody.className = 'book-cover-note-body';
        bookCoverEl.insertBefore(noteBody, bookFooter);
      }
      if (noteBody && noteBody.textContent !== card.notePreview) {
        noteBody.textContent = card.notePreview;
      }
    } else if (noteBody) {
      noteBody.remove();
    }
  }
}

export function updatePaperCardBadge(cardEl: HTMLElement, status: ReadStatus) {
  const badge = cardEl.querySelector('.card-badge');
  if (badge) {
    badge.className = `card-badge ${status}`;
    badge.textContent = formatBadgeText(status);
    badge.setAttribute('title', formatBadgeText(status));
  }
}

export function updatePaperCardThumbnail(cardEl: HTMLElement, url: string) {
  const img = cardEl.querySelector('.card-cover-img') as HTMLImageElement;
  const bookCover = cardEl.querySelector('.card-book-cover') as HTMLElement;
  const wrapper = cardEl.querySelector('.card-cover-wrapper') as HTMLElement;
  if (img) {
    if (url) {
      wrapper?.classList.add('is-loading');
      img.src = url;
    } else {
      wrapper?.classList.remove('is-loading');
      img.classList.remove('is-loaded');
      img.style.display = 'none';
      if (bookCover) bookCover.style.display = 'flex';
    }
  }
}

export function updatePaperCardColorTags(cardEl: HTMLElement, colorTags?: Array<{ tag: string; color: string }>) {
  const dotsContainer = cardEl.querySelector('.card-color-dots') as HTMLElement;
  if (dotsContainer) {
    const doc = cardEl.ownerDocument || document;
    renderColorDots(dotsContainer, colorTags || [], doc);
  }
  const bookCover = cardEl.querySelector('.card-book-cover') as HTMLElement;
  if (bookCover) {
    const primaryColor = colorTags?.[0]?.color;
    if (primaryColor && isTagBandEnabled()) {
      bookCover.style.setProperty('--card-tag-color', primaryColor);
      bookCover.setAttribute('data-has-tag-color', 'true');
    } else {
      bookCover.removeAttribute('data-has-tag-color');
      bookCover.style.removeProperty('--card-tag-color');
    }
  }
}
