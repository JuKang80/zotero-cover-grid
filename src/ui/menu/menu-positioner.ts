/**
 * Menu Viewport Positioning & Dismiss Handlers
 */

export interface MenuPositionParams {
  clickX: number;
  clickY: number;
  menuWidth: number;
  menuHeight: number;
  winWidth: number;
  winHeight: number;
}

export interface PositionCoordinates {
  left: number;
  top: number;
}

/**
 * Calculates clamped menu coordinates to prevent overflow at right and bottom edges.
 */
export function calculateClampedPosition(params: MenuPositionParams): PositionCoordinates {
  const { clickX, clickY, menuWidth, menuHeight, winWidth, winHeight } = params;
  const left = clickX + menuWidth > winWidth ? Math.max(10, winWidth - menuWidth - 10) : Math.max(10, clickX);
  const top = clickY + menuHeight > winHeight ? Math.max(10, winHeight - menuHeight - 10) : Math.max(10, clickY);
  return { left, top };
}

/**
 * Positions a menu element within the viewport based on mouse event and window dimensions.
 */
export function positionMenu(
  menuEl: HTMLElement,
  event: MouseEvent,
  win: any,
  fallbackDimensions?: { width?: number; height?: number }
): PositionCoordinates {
  const doc = win?.document || (typeof document !== 'undefined' ? document : null);
  const clickX = event.clientX || 0;
  const clickY = event.clientY || 0;
  const rect = typeof menuEl.getBoundingClientRect === 'function' ? menuEl.getBoundingClientRect() : null;
  const measuredWidth = menuEl.offsetWidth || rect?.width || 0;
  const measuredHeight = menuEl.offsetHeight || rect?.height || 0;

  const menuWidth = measuredWidth > 0 ? measuredWidth : (fallbackDimensions?.width ?? 280);
  const menuHeight = measuredHeight > 0 ? measuredHeight : (fallbackDimensions?.height ?? 200);

  const winWidth = win?.innerWidth || doc?.documentElement?.clientWidth || 1000;
  const winHeight = win?.innerHeight || doc?.documentElement?.clientHeight || 800;

  const pos = calculateClampedPosition({
    clickX,
    clickY,
    menuWidth,
    menuHeight,
    winWidth,
    winHeight
  });

  menuEl.style.left = `${pos.left}px`;
  menuEl.style.top = `${pos.top}px`;

  return pos;
}

export interface DismissListenersOptions {
  win: any;
  menuEl: HTMLElement;
  originTarget?: Node | null;
  onClose: () => void;
}

/**
 * Attaches dismiss listeners for outside click, outside mousedown, and ESC key.
 * Protects against macOS trackpad Control+Click / two-finger tap trailing clicks.
 * Returns a cleanup function.
 */
export function attachMenuDismissListeners(options: DismissListenersOptions): () => void {
  const { win, menuEl, originTarget, onClose } = options;
  const openedAt = Date.now();
  let pointerDownOutside = false;

  const handleOutsideMouseDown = (e: MouseEvent) => {
    if (!menuEl.contains(e.target as Node)) {
      pointerDownOutside = true;
      onClose();
    }
  };

  const handleOutsideClick = (e: MouseEvent) => {
    const elapsed = Date.now() - openedAt;
    if (!pointerDownOutside) {
      if (e.ctrlKey || e.button === 2) return;
      if (
        elapsed < 600 &&
        originTarget &&
        (e.target === originTarget || (originTarget as HTMLElement)?.contains?.(e.target as Node))
      ) {
        return;
      }
      if (elapsed < 150) return;
    }
    if (!menuEl.contains(e.target as Node)) {
      onClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  win?.addEventListener?.('mousedown', handleOutsideMouseDown, true);
  win?.addEventListener?.('click', handleOutsideClick, true);
  win?.addEventListener?.('keydown', handleKeyDown, true);

  return () => {
    win?.removeEventListener?.('mousedown', handleOutsideMouseDown, true);
    win?.removeEventListener?.('click', handleOutsideClick, true);
    win?.removeEventListener?.('keydown', handleKeyDown, true);
  };
}
