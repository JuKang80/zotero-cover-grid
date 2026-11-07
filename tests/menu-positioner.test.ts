import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateClampedPosition,
  positionMenu,
  attachMenuDismissListeners
} from '../src/ui/menu/menu-positioner';

describe('menu-positioner', () => {
  describe('calculateClampedPosition', () => {
    it('returns exact click coordinates when menu fits inside viewport', () => {
      const pos = calculateClampedPosition({
        clickX: 100,
        clickY: 150,
        menuWidth: 200,
        menuHeight: 150,
        winWidth: 1000,
        winHeight: 800
      });
      expect(pos).toEqual({ left: 100, top: 150 });
    });

    it('clamps horizontal overflow when menu exceeds right boundary', () => {
      const pos = calculateClampedPosition({
        clickX: 900,
        clickY: 150,
        menuWidth: 200,
        menuHeight: 150,
        winWidth: 1000,
        winHeight: 800
      });
      // winWidth - menuWidth - 10 = 1000 - 200 - 10 = 790
      expect(pos.left).toBe(790);
      expect(pos.top).toBe(150);
    });

    it('clamps vertical overflow when menu exceeds bottom boundary', () => {
      const pos = calculateClampedPosition({
        clickX: 100,
        clickY: 750,
        menuWidth: 200,
        menuHeight: 150,
        winWidth: 1000,
        winHeight: 800
      });
      // winHeight - menuHeight - 10 = 800 - 150 - 10 = 640
      expect(pos.left).toBe(100);
      expect(pos.top).toBe(640);
    });

    it('respects minimum 10px boundary when window is smaller than menu', () => {
      const pos = calculateClampedPosition({
        clickX: 50,
        clickY: 50,
        menuWidth: 500,
        menuHeight: 400,
        winWidth: 300,
        winHeight: 200
      });
      expect(pos.left).toBe(10);
      expect(pos.top).toBe(10);
    });
  });

  describe('positionMenu', () => {
    it('sets inline style left and top on menu element', () => {
      const div = document.createElement('div');
      const fakeEvent = { clientX: 200, clientY: 300 } as MouseEvent;
      const fakeWin = { innerWidth: 1200, innerHeight: 900, document };

      const pos = positionMenu(div, fakeEvent, fakeWin, { width: 250, height: 180 });
      expect(pos).toEqual({ left: 200, top: 300 });
      expect(div.style.left).toBe('200px');
      expect(div.style.top).toBe('300px');
    });
  });

  describe('attachMenuDismissListeners', () => {
    let mockWin: any;
    let menuEl: HTMLElement;
    let onClose: any;

    beforeEach(() => {
      onClose = vi.fn();
      menuEl = document.createElement('div');
      document.body.appendChild(menuEl);

      const listeners: Record<string, EventListener[]> = {};
      mockWin = {
        addEventListener: vi.fn((type: string, fn: EventListener) => {
          listeners[type] = listeners[type] || [];
          listeners[type].push(fn);
        }),
        removeEventListener: vi.fn((type: string, fn: EventListener) => {
          if (listeners[type]) {
            listeners[type] = listeners[type].filter((cb) => cb !== fn);
          }
        }),
        emit: (type: string, event: any) => {
          listeners[type]?.forEach((cb) => cb(event));
        }
      };
    });

    afterEach(() => {
      menuEl.remove();
    });

    it('calls onClose on ESC key', () => {
      const cleanup = attachMenuDismissListeners({ win: mockWin, menuEl, onClose });
      mockWin.emit('keydown', { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it('calls onClose on outside mousedown', () => {
      const outsideEl = document.createElement('div');
      document.body.appendChild(outsideEl);

      const cleanup = attachMenuDismissListeners({ win: mockWin, menuEl, onClose });
      mockWin.emit('mousedown', { target: outsideEl });
      expect(onClose).toHaveBeenCalledTimes(1);

      cleanup();
      outsideEl.remove();
    });

    it('cleans up listeners properly', () => {
      const cleanup = attachMenuDismissListeners({ win: mockWin, menuEl, onClose });
      expect(mockWin.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
      cleanup();
      expect(mockWin.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    });
  });
});
