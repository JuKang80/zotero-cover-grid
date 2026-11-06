import { PaperCardData, ReadStatus } from '../types';

export interface CardEventHandlers {
  onClick?: (card: PaperCardData, event: MouseEvent) => void;
  onDoubleClick?: (card: PaperCardData, event: MouseEvent) => void;
  onContextMenu?: (card: PaperCardData, event: MouseEvent) => void;
  onStatusChange?: (card: PaperCardData, nextStatus: ReadStatus) => void;
}

export function cycleReadStatus(current: ReadStatus): ReadStatus {
  switch (current) {
    case 'unread':
      return 'reading';
    case 'reading':
      return 'read';
    case 'read':
      return 'unread';
    default:
      return 'unread';
  }
}

function formatBadgeText(status: ReadStatus): string {
  switch (status) {
    case 'reading':
      return 'Reading';
    case 'read':
      return 'Read';
    case 'unread':
      return 'Unread';
    default:
      return 'Unread';
  }
}

function formatItemTypeLabel(itemType: string): string {
  switch (itemType) {
    case 'journalArticle':
      return 'Journal Article';
    case 'book':
      return 'Book';
    case 'bookSection':
      return 'Book Section';
    case 'conferencePaper':
      return 'Conference';
    case 'preprint':
      return 'Preprint';
    case 'thesis':
      return 'Thesis';
    default:
      return 'Journal Article';
  }
}

export function createPaperCardElement(
  card: PaperCardData,
  handlers: CardEventHandlers = {},
  doc?: Document
): HTMLElement {
  const targetDoc: Document =
    doc ||
    (typeof document !== 'undefined'
      ? document
      : (typeof (globalThis as any).Zotero !== 'undefined' ? (globalThis as any).Zotero.getMainWindow?.()?.document : null));
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const cardEl = targetDoc.createElementNS(HTML_NS, 'div');
  cardEl.className = 'paper-card';
  cardEl.id = `paper-card-${card.id}`;
  cardEl.setAttribute('data-item-id', String(card.id));
  cardEl.setAttribute('tabindex', '0');

  // Cover image wrapper
  const coverWrapper = targetDoc.createElementNS(HTML_NS, 'div');
  coverWrapper.className = 'card-cover-wrapper';

  // Fallback / Loading Typographic Book Cover
  const bookCoverEl = targetDoc.createElementNS(HTML_NS, 'div');
  bookCoverEl.className = 'card-book-cover';

  const bookHeader = targetDoc.createElementNS(HTML_NS, 'div');
  bookHeader.className = 'book-cover-header';
  bookHeader.textContent = (card.publicationTitle || formatItemTypeLabel(card.itemType)).toUpperCase();
  bookCoverEl.appendChild(bookHeader);

  const bookTitle = targetDoc.createElementNS(HTML_NS, 'div');
  bookTitle.className = 'book-cover-title';
  bookTitle.textContent = card.title;
  bookCoverEl.appendChild(bookTitle);

  const bookFooter = targetDoc.createElementNS(HTML_NS, 'div');
  bookFooter.className = 'book-cover-footer';
  const firstAuthor = card.citationText ? card.citationText.replace(/\s*\(\d{4}\)/, '') : card.authorText;
  bookFooter.textContent = card.year ? `${card.year} · ${firstAuthor}` : firstAuthor;
  bookCoverEl.appendChild(bookFooter);

  // Apply primary color tag for ambient tint if present
  const primaryColor = card.colorTags?.[0]?.color;
  if (primaryColor) {
    bookCoverEl.style.setProperty('--card-tag-color', primaryColor);
    bookCoverEl.setAttribute('data-has-tag-color', 'true');
  }

  coverWrapper.appendChild(bookCoverEl);

  // Actual PDF Thumbnail Image
  const imgEl = targetDoc.createElementNS(HTML_NS, 'img') as HTMLImageElement;
  imgEl.className = 'card-cover-img';
  imgEl.alt = card.title;
  imgEl.addEventListener('error', () => {
    coverWrapper.classList.remove('is-loading');
    imgEl.style.display = 'none';
    bookCoverEl.style.display = 'flex';
  });
  imgEl.addEventListener('load', () => {
    coverWrapper.classList.remove('is-loading');
    imgEl.style.display = '';
    bookCoverEl.style.display = 'none';
  });

  if (card.coverThumbnailUrl) {
    coverWrapper.classList.add('is-loading');
    imgEl.src = card.coverThumbnailUrl;
  } else {
    imgEl.style.display = 'none';
  }
  coverWrapper.appendChild(imgEl);
  cardEl.appendChild(coverWrapper);

  // 1. Uniform 2-Line Fixed Height Paper Title
  const titleEl = targetDoc.createElementNS(HTML_NS, 'div');
  titleEl.className = 'card-title';
  titleEl.textContent = card.title;
  titleEl.title = card.title;
  cardEl.appendChild(titleEl);

  // 2. Author & Citation (1 line ellipsis, e.g. Kim et al. (2026))
  const authorEl = targetDoc.createElementNS(HTML_NS, 'div');
  authorEl.className = 'card-author';
  authorEl.textContent = card.citationText || card.authorText;
  authorEl.title = `${card.authorText} (${card.year || 'n.d.'}) - ${card.title}`;
  cardEl.appendChild(authorEl);

  // 3. Badge Container (Reading Status Badge & Native Color Dots)
  const badgeContainer = targetDoc.createElementNS(HTML_NS, 'div');
  badgeContainer.className = 'card-badge-container';

  const badgeEl = targetDoc.createElementNS(HTML_NS, 'span');
  badgeEl.className = `card-badge ${card.readStatus}`;
  badgeEl.textContent = formatBadgeText(card.readStatus);
  badgeEl.title = `Reading Status: ${card.readStatus} (클릭하여 상태 변경)`;

  badgeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const nextStatus = cycleReadStatus(card.readStatus);
    card.readStatus = nextStatus;
    updatePaperCardBadge(cardEl, nextStatus);
    handlers.onStatusChange?.(card, nextStatus);
  });

  badgeContainer.appendChild(badgeEl);

  // Zotero Native Colored Tags Dots
  const dotsContainer = targetDoc.createElementNS(HTML_NS, 'div');
  dotsContainer.className = 'card-color-dots';
  renderColorDots(dotsContainer, card.colorTags || [], targetDoc);
  badgeContainer.appendChild(dotsContainer);

  cardEl.appendChild(badgeContainer);

  // Event Listeners (Zero-delay instant click dispatch for 60fps snappy responsiveness)
  cardEl.addEventListener('click', (e) => {
    handlers.onClick?.(card, e);
  });

  cardEl.addEventListener('dblclick', (e) => {
    handlers.onDoubleClick?.(card, e);
  });

  cardEl.addEventListener('contextmenu', (e) => handlers.onContextMenu?.(card, e));

  return cardEl;
}

export function updatePaperCardBadge(cardEl: HTMLElement, status: ReadStatus) {
  const badge = cardEl.querySelector('.card-badge');
  if (badge) {
    badge.className = `card-badge ${status}`;
    badge.textContent = formatBadgeText(status);
    badge.setAttribute('title', `Reading Status: ${status} (클릭하여 상태 변경)`);
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
      img.style.display = 'none';
      if (bookCover) bookCover.style.display = 'flex';
    }
  }
}

function renderColorDots(container: HTMLElement, colorTags: Array<{ tag: string; color: string }>, doc: Document) {
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  container.innerHTML = '';
  for (const ct of colorTags) {
    if (!ct || !ct.color) continue;
    const dot = doc.createElementNS(HTML_NS, 'span');
    dot.className = 'card-color-dot';
    dot.style.setProperty('background-color', ct.color, 'important');
    dot.title = ct.tag;
    container.appendChild(dot);
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
    if (primaryColor) {
      bookCover.style.setProperty('--card-tag-color', primaryColor);
      bookCover.setAttribute('data-has-tag-color', 'true');
    } else {
      bookCover.removeAttribute('data-has-tag-color');
    }
  }
}
