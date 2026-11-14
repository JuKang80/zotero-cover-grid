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
      if (img.getAttribute('src') === url) {
        wrapper?.classList.remove('is-loading');
        img.classList.add('is-loaded');
        img.style.display = '';
        if (bookCover) bookCover.style.display = 'none';
        return;
      }
      wrapper?.classList.add('is-loading');
      img.src = url;
      if ((img as any).complete && (img as any).naturalWidth > 0) {
        wrapper?.classList.remove('is-loading');
        img.classList.add('is-loaded');
        img.style.display = '';
        if (bookCover) bookCover.style.display = 'none';
      }
    } else {
      wrapper?.classList.remove('is-loading');
      img.classList.remove('is-loaded');
      img.style.display = 'none';
      if (bookCover) bookCover.style.display = 'flex';
    }
  }
}

export interface CardPagePillState {
  visible: boolean;
  currentPage: number;
  totalPages: number;
  loading?: boolean;
}

function createLazyPagePill(cardEl: HTMLElement): HTMLElement | null {
  const coverWrapper = cardEl.querySelector('.card-cover-wrapper') as HTMLElement | null;
  if (!coverWrapper) return null;

  const doc = cardEl.ownerDocument || document;
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const createEl = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => {
    return (typeof doc.createElementNS === 'function'
      ? doc.createElementNS(HTML_NS, tag)
      : doc.createElement(tag)) as HTMLElementTagNameMap[K];
  };

  const pagePill = createEl('div');
  pagePill.className = 'card-page-preview-pill';
  pagePill.setAttribute('data-stop-card-gesture', 'true');

  const stopCardEvent = (e: Event) => e.stopPropagation();
  pagePill.addEventListener('click', stopCardEvent);
  pagePill.addEventListener('dblclick', stopCardEvent);
  pagePill.addEventListener('mousedown', stopCardEvent);
  pagePill.addEventListener('dragstart', (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  });

  const refocusCard = () => {
    try {
      cardEl.focus?.({ preventScroll: true });
    } catch {}
  };

  const prevPageBtn = createEl('button');
  prevPageBtn.type = 'button';
  prevPageBtn.className = 'card-page-btn card-page-prev-btn';
  prevPageBtn.textContent = '‹';
  prevPageBtn.title = '이전 페이지';
  prevPageBtn.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    refocusCard();
    (cardEl as any).__cardHandlers?.onPageFlip?.((cardEl as any).__cardData, -1);
  });
  prevPageBtn.addEventListener('dblclick', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  });

  const pageBadgeBtn = createEl('button');
  pageBadgeBtn.type = 'button';
  pageBadgeBtn.className = 'card-page-badge-btn';
  pageBadgeBtn.textContent = '1 / 1';
  pageBadgeBtn.title = 'Quick Look 크게 보기';

  const nextPageBtn = createEl('button');
  nextPageBtn.type = 'button';
  nextPageBtn.className = 'card-page-btn card-page-next-btn';
  nextPageBtn.textContent = '›';
  nextPageBtn.title = '다음 페이지';
  nextPageBtn.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    refocusCard();
    (cardEl as any).__cardHandlers?.onPageFlip?.((cardEl as any).__cardData, 1);
  });
  nextPageBtn.addEventListener('dblclick', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  });

  const pillDivider = createEl('span');
  pillDivider.className = 'card-page-pill-divider';

  const expandBtn = createEl('button');
  expandBtn.type = 'button';
  expandBtn.className = 'card-page-btn card-page-expand-btn';
  expandBtn.textContent = '⤢';
  expandBtn.title = 'Quick Look 크게 보기';

  const openQuickLookHandler = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    refocusCard();
    (cardEl as any).__cardHandlers?.onOpenQuickLook?.((cardEl as any).__cardData);
  };
  pageBadgeBtn.addEventListener('click', openQuickLookHandler);
  pageBadgeBtn.addEventListener('dblclick', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  });
  expandBtn.addEventListener('click', openQuickLookHandler);
  expandBtn.addEventListener('dblclick', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  });

  pagePill.appendChild(prevPageBtn);
  pagePill.appendChild(pageBadgeBtn);
  pagePill.appendChild(nextPageBtn);
  pagePill.appendChild(pillDivider);
  pagePill.appendChild(expandBtn);
  coverWrapper.appendChild(pagePill);
  return pagePill;
}

export function updatePaperCardPagePill(cardEl: HTMLElement, state: CardPagePillState): void {
  let pill = cardEl.querySelector('.card-page-preview-pill') as HTMLElement | null;

  if (!state.visible || state.totalPages <= 0) {
    delete cardEl.dataset.previewPage;
    if (!pill) return;
    pill.hidden = true;
    pill.setAttribute('hidden', 'true');
    pill.style.display = 'none';
    pill.classList.remove('is-loading');
    return;
  }

  if (!pill) {
    pill = createLazyPagePill(cardEl);
    if (!pill) return;
  }

  const clampedPage = Math.min(state.totalPages, Math.max(1, state.currentPage));
  cardEl.dataset.previewPage = String(clampedPage);
  pill.hidden = false;
  pill.removeAttribute('hidden');
  pill.style.display = 'flex';
  pill.classList.toggle('is-loading', Boolean(state.loading));
  const badgeBtn = pill.querySelector('.card-page-badge-btn') as HTMLElement | null;
  if (badgeBtn) {
    badgeBtn.textContent = `${clampedPage} / ${state.totalPages}`;
  }

  const prevBtn = pill.querySelector('.card-page-prev-btn') as HTMLButtonElement | null;
  if (prevBtn) {
    const atStart = clampedPage <= 1;
    prevBtn.disabled = atStart;
    prevBtn.classList.toggle('disabled', atStart);
  }

  const nextBtn = pill.querySelector('.card-page-next-btn') as HTMLButtonElement | null;
  if (nextBtn) {
    const atEnd = clampedPage >= state.totalPages;
    nextBtn.disabled = atEnd;
    nextBtn.classList.toggle('disabled', atEnd);
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
