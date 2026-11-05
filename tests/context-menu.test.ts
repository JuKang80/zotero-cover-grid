import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showPaperCardContextMenu, closeActiveContextMenu } from '../src/ui/context-menu';
import { PaperCardData } from '../src/types';

describe('Paper Card Context Menu', () => {
  let mockWin: any;
  let testCard: PaperCardData;

  beforeEach(() => {
    mockWin = {
      document: window.document,
      innerWidth: 1024,
      innerHeight: 768,
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      Zotero: { locale: 'ko-KR' }
    };

    testCard = {
      id: 555,
      key: 'KEY555',
      title: 'Attention is All You Need',
      citationText: 'Vaswani et al. (2017)',
      authorText: 'Vaswani, A.',
      year: '2017',
      itemType: 'journalArticle',
      readStatus: 'unread',
      hasPdf: true
    };
  });

  afterEach(() => {
    closeActiveContextMenu();
  });

  it('renders Korean localized menu items when locale is ko', () => {
    mockWin.Zotero.locale = 'ko-KR';
    const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 150 });

    const menuEl = showPaperCardContextMenu({
      event,
      card: testCard,
      win: mockWin,
      actions: {}
    });

    expect(menuEl).toBeDefined();
    expect(menuEl.textContent).toContain('PDF 열기');
    expect(menuEl.textContent).toContain('읽기 상태 변경');
    expect(menuEl.textContent).toContain('APA 7 인용 복사');
    expect(menuEl.textContent).toContain('표지 다시 생성');
  });

  it('renders English localized menu items when locale is en', () => {
    mockWin.Zotero.locale = 'en-US';
    const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 150 });

    const menuEl = showPaperCardContextMenu({
      event,
      card: testCard,
      win: mockWin,
      actions: {}
    });

    expect(menuEl.textContent).toContain('Open PDF');
    expect(menuEl.textContent).toContain('Toggle Reading Status');
    expect(menuEl.textContent).toContain('Copy APA 7 Citation');
    expect(menuEl.textContent).toContain('Regenerate Cover');
  });

  it('triggers action callbacks when menu items are clicked', () => {
    const onOpenPdf = vi.fn();
    const onToggleRead = vi.fn();
    const onCopyCitation = vi.fn();
    const onRegenerateCover = vi.fn();

    const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 150 });
    const menuEl = showPaperCardContextMenu({
      event,
      card: testCard,
      win: mockWin,
      actions: {
        onOpenPdf,
        onToggleRead,
        onCopyCitation,
        onRegenerateCover
      }
    });

    // Click 'Open PDF'
    const openItem = menuEl.querySelector('#menu-open-pdf') as HTMLElement;
    openItem.click();
    expect(onOpenPdf).toHaveBeenCalledWith(testCard);

    // Re-open menu to click 'Copy Citation'
    const menuEl2 = showPaperCardContextMenu({
      event,
      card: testCard,
      win: mockWin,
      actions: {
        onOpenPdf,
        onToggleRead,
        onCopyCitation,
        onRegenerateCover
      }
    });

    const copyItem = menuEl2.querySelector('#menu-copy-citation') as HTMLElement;
    copyItem.click();
    expect(onCopyCitation).toHaveBeenCalledWith(testCard);
  });

  it('disables PDF-dependent items when card has no PDF', () => {
    const cardWithoutPdf = { ...testCard, hasPdf: false };
    const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 150 });

    const menuEl = showPaperCardContextMenu({
      event,
      card: cardWithoutPdf,
      win: mockWin,
      actions: {}
    });

    const openItem = menuEl.querySelector('#menu-open-pdf');
    const regenItem = menuEl.querySelector('#menu-regenerate-cover');

    expect(openItem?.classList.contains('disabled')).toBe(true);
    expect(regenItem?.classList.contains('disabled')).toBe(true);
  });

  it('closes menu when Escape key is pressed', () => {
    const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 150 });
    showPaperCardContextMenu({
      event,
      card: testCard,
      win: mockWin,
      actions: {}
    });

    expect(document.getElementById('cover-grid-context-menu')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.getElementById('cover-grid-context-menu')).toBeNull();
  });
});
