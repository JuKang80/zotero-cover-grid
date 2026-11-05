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

  const imgEl = targetDoc.createElementNS(HTML_NS, 'img') as HTMLImageElement;
  imgEl.className = 'card-cover-img';
  imgEl.alt = card.title;
  imgEl.addEventListener('error', () => {
    imgEl.style.display = 'none';
  });
  imgEl.addEventListener('load', () => {
    imgEl.style.display = '';
  });
  if (card.coverThumbnailUrl) {
    imgEl.src = card.coverThumbnailUrl;
  }
  coverWrapper.appendChild(imgEl);
  cardEl.appendChild(coverWrapper);

  // Author & Citation (e.g. Kim et al. (2026))
  const authorEl = targetDoc.createElementNS(HTML_NS, 'div');
  authorEl.className = 'card-author';
  authorEl.textContent = card.citationText || card.authorText;
  authorEl.title = `${card.authorText} (${card.year || 'n.d.'}) - ${card.title}`;
  cardEl.appendChild(authorEl);

  // Title / Subtitle Meta (e.g. APA 7 · Journal Article)
  const metaEl = targetDoc.createElementNS(HTML_NS, 'div');
  metaEl.className = 'card-meta';
  metaEl.textContent = `APA 7 · ${formatItemTypeLabel(card.itemType)}`;
  metaEl.title = card.title;
  cardEl.appendChild(metaEl);

  // Badge Container
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
  if (img) {
    img.src = url;
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
}
