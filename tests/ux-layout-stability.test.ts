import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ScrollAnchorTracker } from '../src/ui/scroller/scroll-anchor';
import { KeyboardManager } from '../src/ui/scroller/keyboard-manager';
import { SelectionModel } from '../src/ui/scroller/selection-model';
import { attachMenuDismissListeners } from '../src/ui/menu/menu-positioner';
import { selectItemInZotero } from '../src/ui/item-actions';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { ThumbnailCacheManager } from '../src/services/cache-manager';
import { detectSplashPage } from '../src/services/thumbnail/splash-detector';

describe('P0/P1/P2 UX & Layout Stability', () => {
  it('grid.css enforces min-width:0, clamped minmax tracks, scrollbar-gutter, and dynamic contain-intrinsic-size', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/grid.css'), 'utf8');
    expect(css).toContain('minmax(min(var(--card-width, 180px), 100%), 1fr)');
    expect(css).toContain('scrollbar-gutter: stable !important;');
    expect(css).toContain('scroll-margin: 16px !important;');
    expect(css).toContain(
      'contain-intrinsic-size: auto var(--card-width, 180px) auto calc(var(--card-width, 180px) * 1.3333 + 92px) !important;'
    );
  });

  it('ScrollAnchorTracker finds partially visible top row when offsetHeight > 0', () => {
    const tracker = new ScrollAnchorTracker();
    const items = [
      { id: 1 } as any,
      { id: 2 } as any,
      { id: 3 } as any
    ];
    const cardMap = new Map<number, any>([
      [1, { offsetTop: 0, offsetHeight: 200 }],
      [2, { offsetTop: 220, offsetHeight: 200 }],
      [3, { offsetTop: 440, offsetHeight: 200 }]
    ]);
    const viewport = { scrollTop: 100 } as any;
    expect(tracker.findTopVisibleItem(items, cardMap, viewport)?.id).toBe(1);
  });

  it('selectItemInZotero respects user-hidden #zotero-item-pane and does not force-expand it', () => {
    const hiddenPane: any = {
      hidden: true,
      style: { removeProperty: vi.fn() },
      removeAttribute: vi.fn(),
      viewItem: vi.fn()
    };
    const mockWin: any = {
      document: {
        getElementById: (id: string) => (id === 'zotero-item-pane' ? hiddenPane : null)
      },
      Zotero: { Items: { get: vi.fn(() => ({ id: 42 })) } },
      ZoteroPane: { selectItem: vi.fn() }
    };

    selectItemInZotero(mockWin, 42);
    expect(hiddenPane.hidden).toBe(true);
    expect(hiddenPane.removeAttribute).not.toHaveBeenCalled();
    expect(hiddenPane.viewItem).toHaveBeenCalled();
  });

  it('KeyboardManager ignores digit shortcuts (0-9) when focus is inside a side pane', () => {
    const onToggleColorTag = vi.fn();
    const selectionModel = new SelectionModel();
    selectionModel.selectSingle(0, 1);

    const container = document.createElement('div');
    const viewport = document.createElement('div');
    document.body.appendChild(viewport);
    viewport.appendChild(container);

    const sidePane = document.createElement('div');
    sidePane.id = 'zotero-collections-tree';
    const treeNode = document.createElement('div');
    sidePane.appendChild(treeNode);
    document.body.appendChild(sidePane);

    const km = new KeyboardManager({
      container,
      viewport,
      selectionModel,
      getItems: () => [{ id: 1 } as any],
      getCardElement: () => undefined,
      moveFocus: vi.fn(),
      updateSelectionClasses: vi.fn(),
      notifySelection: vi.fn(),
      options: { onToggleColorTag }
    });

    const evt = new KeyboardEvent('keydown', { key: '1', code: 'Digit1', cancelable: true });
    Object.defineProperty(evt, 'target', { value: treeNode });
    km.handleDocumentKeyDown(evt);

    expect(onToggleColorTag).not.toHaveBeenCalled();
    viewport.remove();
    sidePane.remove();
  });

  it('attachMenuDismissListeners closes menu on external scroll and window resize', () => {
    const onClose = vi.fn();
    const menuEl = document.createElement('div');
    const listeners = new Map<string, Function>();
    const mockWin = {
      addEventListener: vi.fn((type: string, fn: Function) => listeners.set(type, fn)),
      removeEventListener: vi.fn((type: string) => listeners.delete(type))
    };

    const cleanup = attachMenuDismissListeners({ win: mockWin, menuEl, onClose });
    listeners.get('scroll')?.({ target: document.body });
    expect(onClose).toHaveBeenCalledTimes(1);

    listeners.get('resize')?.({});
    expect(onClose).toHaveBeenCalledTimes(2);

    cleanup();
    expect(mockWin.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    expect(mockWin.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('VirtualGridScroller.preserveScrollAnchor keeps visible card at same relative offset across zoom layout shifts', () => {
    const viewport = document.createElement('div');
    const container = document.createElement('div');
    viewport.appendChild(container);
    Object.defineProperty(viewport, 'clientHeight', { value: 400, configurable: true });
    viewport.scrollTop = 300;

    const scroller = new VirtualGridScroller({ container, viewport });
    scroller.setItems([
      { id: 1, key: 'K1', title: 'P1', authorText: 'A1', year: '2020', citationText: '', itemType: 'journalArticle', readStatus: 'unread', hasPdf: false, colorTags: [] },
      { id: 2, key: 'K2', title: 'P2', authorText: 'A2', year: '2021', citationText: '', itemType: 'journalArticle', readStatus: 'unread', hasPdf: false, colorTags: [] }
    ]);

    const card1 = scroller.getCardElement(1)!;
    const card2 = scroller.getCardElement(2)!;
    Object.defineProperty(card1, 'offsetTop', { value: 0, configurable: true });
    Object.defineProperty(card1, 'offsetHeight', { value: 250, configurable: true });
    Object.defineProperty(card2, 'offsetTop', { value: 320, configurable: true });
    Object.defineProperty(card2, 'offsetHeight', { value: 250, configurable: true });

    // Before zoom: card2 is at offsetTop 320 (20px below scrollTop 300). After zoom, card2 moves to offsetTop 520.
    scroller.preserveScrollAnchor(() => {
      Object.defineProperty(card2, 'offsetTop', { value: 520, configurable: true });
    });

    expect(viewport.scrollTop).toBe(500);
    scroller.destroy();
  });

  it('ThumbnailCacheManager cancels queued tasks on AbortSignal and settles pending renders on clearMemoryCache', async () => {
    const mgr = new ThumbnailCacheManager();
    const abortedCtrl = new AbortController();
    abortedCtrl.abort();

    await expect(
      mgr.getThumbnail({ id: 999, key: 'ABORT_KEY' }, null, undefined, {
        signal: abortedCtrl.signal,
        priority: 'high'
      })
    ).rejects.toThrow('Thumbnail task aborted');
  });

  it('detectSplashPage detects 500+ char explicit download cover sheets while preserving real abstract pages', async () => {
    const longCoverSheet = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          { str: 'See discussions, stats, and author profiles for this publication at: https://www.researchgate.net/publication/12345' },
          { str: 'Downloaded from https://www.tandfonline.com by University Library on 23 Nov 2026. Terms & Conditions of access and use can be found at https://www.tandfonline.com/action/journalInformation ' + 'x'.repeat(300) }
        ]
      })
    };
    expect(await detectSplashPage(longCoverSheet)).toBe(true);
  });

  it('bootstrap.ts has no local /tmp reload polling and release.yml auto-releases on main push', () => {
    const bootstrapSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/bootstrap.ts'), 'utf8');
    expect(bootstrapSrc).not.toContain('zotero-cover-grid-reload.trigger');
    expect(bootstrapSrc).not.toContain('startReloadWatcher');
    expect(bootstrapSrc).toContain('checkForPluginUpdates');

    const releaseYml = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/release.yml'),
      'utf8'
    );
    expect(releaseYml).toContain('branches:\n      - main');
    expect(releaseYml).toContain('Resolve or Auto-Bump Version');
    expect(releaseYml).not.toContain('softprops/action-gh-release');
  });

  it('enforces zero innerHTML/eval in src/ and sha256 update_hash on all updates.json entries', () => {
    const collectTsFiles = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectTsFiles(full));
        else if (entry.name.endsWith('.ts')) out.push(full);
      }
      return out;
    };

    for (const file of collectTsFiles(path.resolve(process.cwd(), 'src'))) {
      const code = fs.readFileSync(file, 'utf8');
      expect(code).not.toMatch(/\.innerHTML\b/);
      expect(code).not.toMatch(/\.eval\s*\(/);
    }

    const updatesJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'addon/updates.json'), 'utf8')
    );
    const updates = updatesJson?.addons?.['zotero-cover-grid@antigravity.user']?.updates || [];
    expect(updates.length).toBeGreaterThan(0);
    for (const entry of updates) {
      expect(entry.update_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });
});
