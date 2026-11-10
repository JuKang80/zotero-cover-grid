import { PaperCardData, ReadStatus } from '../../types';

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

export function formatBadgeText(status: ReadStatus): string {
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

export function formatItemTypeLabel(itemType: string): string {
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
    case 'report':
      return 'Report';
    case 'webpage':
      return 'Web Page';
    case 'presentation':
      return 'Presentation';
    case 'manuscript':
      return 'Manuscript';
    case 'patent':
      return 'Patent';
    case 'newspaperArticle':
      return 'Newspaper';
    case 'magazineArticle':
      return 'Magazine';
    case 'document':
      return 'Document';
    case 'dataset':
      return 'Dataset';
    case 'computerProgram':
    case 'software':
      return 'Software';
    default:
      if (!itemType) return 'Journal Article';
      return itemType
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (s) => s.toUpperCase())
        .trim();
  }
}

export function isTagBandEnabled(): boolean {
  try {
    const z = (globalThis as any).Zotero;
    if (z?.Prefs?.get) {
      const val = z.Prefs.get('extensions.zotero.covergrid.showTagBand', true);
      if (val === false) return false;
    }
  } catch {}
  return true;
}

export function isBadgeEnabled(): boolean {
  try {
    const z = (globalThis as any).Zotero;
    if (z?.Prefs?.get) {
      const val = z.Prefs.get('extensions.zotero.covergrid.showBadge', true);
      if (val === false) return false;
    }
  } catch {}
  return true;
}

export function renderColorDots(container: HTMLElement, colorTags: Array<{ tag: string; color: string }>, doc: Document) {
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  container.innerHTML = '';
  const validTags = (colorTags || []).filter((ct) => ct && ct.color);
  const maxVisible = 5;
  const visible = validTags.slice(0, maxVisible);
  for (const ct of visible) {
    const dot = doc.createElementNS(HTML_NS, 'span');
    dot.className = 'card-color-dot';
    dot.style.setProperty('background-color', ct.color, 'important');
    dot.title = ct.tag;
    container.appendChild(dot);
  }
  if (validTags.length > maxVisible) {
    const more = doc.createElementNS(HTML_NS, 'span');
    more.className = 'card-color-dot-more';
    more.textContent = `+${validTags.length - maxVisible}`;
    more.title = validTags.slice(maxVisible).map((t) => t.tag).join(', ');
    container.appendChild(more);
  }
}

/**
 * Builds the complete DOM tree for a Paper Card:
 * - Cover wrapper (typographic book cover fallback + PDF thumbnail image)
 * - 2-line fixed height title
 * - Author & Citation line
 * - Reading status badge & colored tag dots
 */
export function buildPaperCardDOM(
  card: PaperCardData,
  doc?: Document,
  onBadgeStatusChange?: (card: PaperCardData, nextStatus: ReadStatus) => void
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
  cardEl.setAttribute('draggable', 'true');
  cardEl.title = `${card.title}\n${card.citationText || card.authorText}`;
  (cardEl as any).__cardData = card;

  // Cover image wrapper
  const coverWrapper = targetDoc.createElementNS(HTML_NS, 'div');
  coverWrapper.className = 'card-cover-wrapper';

  // Fallback / Loading Typographic Book Cover
  const bookCoverEl = targetDoc.createElementNS(HTML_NS, 'div');
  const isNote = card.itemType === 'note';
  bookCoverEl.className = `card-book-cover${isNote ? ' is-note' : ''}`;

  const bookHeader = targetDoc.createElementNS(HTML_NS, 'div');
  bookHeader.className = 'book-cover-header';
  bookHeader.textContent = isNote ? '📝 RESEARCH NOTE' : (card.publicationTitle || formatItemTypeLabel(card.itemType)).toUpperCase();
  bookCoverEl.appendChild(bookHeader);

  const bookTitle = targetDoc.createElementNS(HTML_NS, 'div');
  bookTitle.className = 'book-cover-title';
  bookTitle.textContent = card.title;
  bookCoverEl.appendChild(bookTitle);

  // If note has body preview, display it like a ruled memo pad
  if (isNote && card.notePreview) {
    const noteBody = targetDoc.createElementNS(HTML_NS, 'div');
    noteBody.className = 'book-cover-note-body';
    noteBody.textContent = card.notePreview;
    bookCoverEl.appendChild(noteBody);
  }

  const bookFooter = targetDoc.createElementNS(HTML_NS, 'div');
  bookFooter.className = 'book-cover-footer';
  const strippedAuthor = card.citationText ? card.citationText.replace(/\s*\((?:\d{4}|n\.d\.)\)/, '').trim() : '';
  const firstAuthor = strippedAuthor || card.authorText;
  bookFooter.textContent = isNote ? (card.year ? `${card.year} · Note` : 'Note') : (card.year ? `${card.year} · ${firstAuthor}` : firstAuthor);
  bookCoverEl.appendChild(bookFooter);

  // Apply primary color tag for ambient tint / band if present and enabled
  const primaryColor = card.colorTags?.[0]?.color;
  if (primaryColor && isTagBandEnabled()) {
    bookCoverEl.style.setProperty('--card-tag-color', primaryColor);
    bookCoverEl.setAttribute('data-has-tag-color', 'true');
  }

  coverWrapper.appendChild(bookCoverEl);

  // Actual PDF Thumbnail Image
  const imgEl = targetDoc.createElementNS(HTML_NS, 'img') as HTMLImageElement;
  imgEl.className = 'card-cover-img';
  imgEl.alt = card.title;
  imgEl.setAttribute('draggable', 'false');
  imgEl.addEventListener('error', () => {
    coverWrapper.classList.remove('is-loading');
    imgEl.classList.remove('is-loaded');
    imgEl.style.display = 'none';
    bookCoverEl.style.display = 'flex';
  });
  imgEl.addEventListener('load', () => {
    coverWrapper.classList.remove('is-loading');
    imgEl.classList.add('is-loaded');
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
  badgeEl.title = formatBadgeText(card.readStatus);
  if (!isBadgeEnabled()) {
    badgeEl.style.display = 'none';
  }

  badgeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const activeCard: PaperCardData = (cardEl as any).__cardData || card;
    const nextStatus = cycleReadStatus(activeCard.readStatus);
    activeCard.readStatus = nextStatus;
    badgeEl.className = `card-badge ${nextStatus}`;
    badgeEl.textContent = formatBadgeText(nextStatus);
    badgeEl.setAttribute('title', formatBadgeText(nextStatus));
    onBadgeStatusChange?.(activeCard, nextStatus);
  });

  badgeContainer.appendChild(badgeEl);

  // Zotero Native Colored Tags Dots
  const dotsContainer = targetDoc.createElementNS(HTML_NS, 'div');
  dotsContainer.className = 'card-color-dots';
  renderColorDots(dotsContainer, card.colorTags || [], targetDoc);
  badgeContainer.appendChild(dotsContainer);

  cardEl.appendChild(badgeContainer);

  return cardEl;
}

export const createPaperCardDOM = buildPaperCardDOM;
