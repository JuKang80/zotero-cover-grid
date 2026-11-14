import { PaperCardData, ReadStatus } from '../types';
import {
  CardEventHandlers,
  isMacEnvironment,
  attachCardGestureHandlers,
  attachCardGestures,
} from './card/gesture-handler';
import {
  formatBadgeText,
  formatItemTypeLabel,
  isTagBandEnabled,
  isBadgeEnabled,
  cycleReadStatus,
  renderColorDots,
  buildPaperCardDOM,
  createPaperCardDOM,
} from './card/card-dom-builder';
import {
  updatePaperCardMetadata,
  updatePaperCardBadge,
  updatePaperCardThumbnail,
  updatePaperCardColorTags,
  updatePaperCardPagePill,
  CardPagePillState,
} from './card/card-updater';

// Re-export all sub-module functions and types for 100% backward compatibility
export {
  CardEventHandlers,
  isMacEnvironment,
  attachCardGestureHandlers,
  attachCardGestures,
  formatBadgeText,
  formatItemTypeLabel,
  isTagBandEnabled,
  isBadgeEnabled,
  cycleReadStatus,
  renderColorDots,
  buildPaperCardDOM,
  createPaperCardDOM,
  updatePaperCardMetadata,
  updatePaperCardBadge,
  updatePaperCardThumbnail,
  updatePaperCardColorTags,
  updatePaperCardPagePill,
  CardPagePillState,
};

/**
 * Creates and returns a complete Paper Card HTMLElement by assembling
 * the DOM hierarchy (CardDOMBuilder) and binding event/gesture listeners (GestureHandler).
 */
export function createPaperCardElement(
  card: PaperCardData,
  handlers: CardEventHandlers = {},
  doc?: Document
): HTMLElement {
  const cardEl = buildPaperCardDOM(card, doc, (activeCard, nextStatus) => {
    updatePaperCardBadge(cardEl, nextStatus);
    handlers.onStatusChange?.(activeCard, nextStatus);
  });

  attachCardGestureHandlers(cardEl, card, handlers, doc);

  return cardEl;
}
