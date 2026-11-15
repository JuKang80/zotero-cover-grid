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

  it('renders English-only 4-item emoji-free menu even when locale is ko', () => {
    mockWin.Zotero.locale = 'ko-KR';
    const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 150 });

    const menuEl = showPaperCardContextMenu({
      event,
      card: testCard,
      win: mockWin,
      actions: {}
    });

    expect(menuEl).toBeDefined();
    expect(menuEl.textContent).toContain('Open PDF');
    expect(menuEl.textContent).toContain('Copy APA 7 Citation');
    expect(menuEl.textContent).toContain('Regenerate Cover');
    expect(menuEl.textContent).toContain('Move to Trash');
    expect(menuEl.querySelector('#menu-toggle-read')).toBeNull();
    expect(menuEl.querySelector('#menu-native-zotero')).toBeNull();
    expect(menuEl.textContent).not.toMatch(/[가-힣]/);
    expect(menuEl.textContent).not.toMatch(/[📄📝🏷️📋🔄🗑️⚙️]/u);
  });

  it('renders English localized 4-item emoji-free menu when locale is en', () => {
    mockWin.Zotero.locale = 'en-US';
    const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 150 });

    const menuEl = showPaperCardContextMenu({
      event,
      card: testCard,
      win: mockWin,
      actions: {}
    });

    expect(menuEl.textContent).toContain('Open PDF');
    expect(menuEl.textContent).toContain('Copy APA 7 Citation');
    expect(menuEl.textContent).toContain('Regenerate Cover');
    expect(menuEl.textContent).toContain('Move to Trash');
    expect(menuEl.textContent).not.toContain('Toggle Reading Status');
    expect(menuEl.textContent).not.toContain('More Zotero Actions');
    expect(menuEl.textContent).not.toMatch(/[📄📝🏷️📋🔄🗑️⚙️]/u);
  });

  it('triggers action callbacks when menu items are clicked', () => {
    const onOpenPdf = vi.fn();
    const onCopyCitation = vi.fn();
    const onRegenerateCover = vi.fn();
    const onDelete = vi.fn();

    const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 150 });
    const menuEl = showPaperCardContextMenu({
      event,
      card: testCard,
      win: mockWin,
      actions: {
        onOpenPdf,
        onCopyCitation,
        onRegenerateCover,
        onDelete
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
        onCopyCitation,
        onRegenerateCover,
        onDelete
      }
    });

    const copyItem = menuEl2.querySelector('#menu-copy-citation') as HTMLElement;
    copyItem.click();
    expect(onCopyCitation).toHaveBeenCalledWith(testCard);

    // Re-open menu to click 'Move to Trash'
    const menuEl3 = showPaperCardContextMenu({
      event,
      card: testCard,
      win: mockWin,
      actions: {
        onOpenPdf,
        onCopyCitation,
        onRegenerateCover,
        onDelete
      }
    });

    const deleteItem = menuEl3.querySelector('#menu-delete-item') as HTMLElement;
    deleteItem.click();
    expect(onDelete).toHaveBeenCalledWith(testCard);
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
