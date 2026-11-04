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

export function createPaperCardElement(
  card: PaperCardData,
  handlers: CardEventHandlers = {},
  doc: Document = document
): HTMLElement {
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const cardEl = doc.createElementNS(HTML_NS, 'div');
  cardEl.className = 'paper-card';
  cardEl.id = `paper-card-${card.id}`;
  cardEl.setAttribute('data-item-id', String(card.id));
  cardEl.setAttribute('tabindex', '0');

  // Cover image wrapper
  const coverWrapper = doc.createElementNS(HTML_NS, 'div');
  coverWrapper.className = 'card-cover-wrapper';

  const imgEl = doc.createElementNS(HTML_NS, 'img') as HTMLImageElement;
  imgEl.className = 'card-cover-img';
  imgEl.alt = card.title;
  if (card.coverThumbnailUrl) {
    imgEl.src = card.coverThumbnailUrl;
  }
  coverWrapper.appendChild(imgEl);
  cardEl.appendChild(coverWrapper);

  // Author & Citation
  const authorEl = doc.createElementNS(HTML_NS, 'div');
  authorEl.className = 'card-author';
  authorEl.textContent = card.citationText || card.authorText;
  authorEl.title = `${card.authorText} (${card.year || 'n.d.'})`;
  cardEl.appendChild(authorEl);

  // Title / Meta
  const metaEl = doc.createElementNS(HTML_NS, 'div');
  metaEl.className = 'card-meta';
  metaEl.textContent = card.title;
  metaEl.title = card.title;
  cardEl.appendChild(metaEl);

  // Badge Container
  const badgeContainer = doc.createElementNS(HTML_NS, 'div');
  badgeContainer.className = 'card-badge-container';

  const badgeEl = doc.createElementNS(HTML_NS, 'span');
  badgeEl.className = `card-badge ${card.readStatus}`;
  badgeEl.textContent = card.readStatus.toUpperCase();
  badgeEl.title = `Reading Status: ${card.readStatus} (Click to change)`;

  badgeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const nextStatus = cycleReadStatus(card.readStatus);
    card.readStatus = nextStatus;
    updatePaperCardBadge(cardEl, nextStatus);
    handlers.onStatusChange?.(card, nextStatus);
  });

  badgeContainer.appendChild(badgeEl);
  cardEl.appendChild(badgeContainer);

  // Event Listeners
  cardEl.addEventListener('click', (e) => handlers.onClick?.(card, e));
  cardEl.addEventListener('dblclick', (e) => handlers.onDoubleClick?.(card, e));
  cardEl.addEventListener('contextmenu', (e) => handlers.onContextMenu?.(card, e));

  return cardEl;
}

export function updatePaperCardBadge(cardEl: HTMLElement, status: ReadStatus) {
  const badge = cardEl.querySelector('.card-badge');
  if (badge) {
    badge.className = `card-badge ${status}`;
    badge.textContent = status.toUpperCase();
    badge.setAttribute('title', `Reading Status: ${status} (Click to change)`);
  }
}

export function updatePaperCardThumbnail(cardEl: HTMLElement, url: string) {
  const img = cardEl.querySelector('.card-cover-img') as HTMLImageElement;
  if (img) {
    img.src = url;
  }
}
