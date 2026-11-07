import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VirtualGridScroller } from '../src/ui/virtual-scroller';
import { WindowCoverGridController } from '../src/sync/window-controller';
import { showPaperCardContextMenu, closeActiveContextMenu } from '../src/ui/context-menu';
import { selectItemsInZotero, deleteItemsInZotero } from '../src/ui/item-actions';
import { injectCoverGridUI, cleanupCoverGridUI } from '../src/ui/index';
import { PaperCardData } from '../src/types';

describe('v0.4.0 Native Zotero Parity UX Suite', () => {
  const sampleItems: PaperCardData[] = [
    {
      id: 101,
      key: 'K101',
      title: 'Paper One',
      authorText: 'Kim',
      citationText: 'Kim (2024)',
      itemType: 'journalArticle',
      year: '2024',
      readStatus: 'unread',
      hasPdf: true,
      tags: ['neuro', 'ai']
    },
    {
      id: 102,
      key: 'K102',
      title: 'Paper Two',
      authorText: 'Lee',
      citationText: 'Lee (2025)',
      itemType: 'journalArticle',
      year: '2025',
      readStatus: 'reading',
      hasPdf: true,
      tags: ['ai', 'memory']
    },
    {
      id: 103,
      key: 'K103',
      title: 'Research Memo Note',
      authorText: 'Note · 2026-11-06',
      citationText: 'Note',
      itemType: 'note',
      year: '2026',
      notePreview: 'Key hypothesis about working memory capacity',
      readStatus: 'unread',
      hasPdf: false,
      tags: ['memo']
    }
  ];

  afterEach(() => {
    closeActiveContextMenu();
  });

  it('1. Bidirectional View-Switch Selection & Scroll Sync (List <-> Grid)', async () => {
    document.body.innerHTML = `
      <div id="zotero-main-window">
        <div id="zotero-toolbar">
          <input id="zotero-search-box" />
        </div>
        <div id="zotero-items-pane">
          <div id="zotero-items-tree"></div>
        </div>
      </div>
    `;

    const selectItemSpy = vi.fn();
    const ensureRowIsVisibleSpy = vi.fn();
    const mockWin: any = {
      document,
      ZoteroPane: {
        getSelectedItems: vi.fn(() => [102]),
        selectItem: selectItemSpy,
        itemsView: {
          rowProvider: {
            items: sampleItems.map((it) => ({
              id: it.id,
              key: it.key,
              getField: (f: string) => (f === 'title' ? it.title : it.year),
              getCreators: () => [{ lastName: it.authorText }],
              getTags: () => (it.tags || []).map((t) => ({ tag: t })),
              isRegularItem: () => it.itemType !== 'note',
              isNote: () => it.itemType === 'note'
            }))
          },
          selectItem: vi.fn(),
          selectItems: vi.fn(),
          getRowIndexByID: vi.fn((id: number) => (id === 101 ? 0 : 1)),
          ensureRowIsVisible: ensureRowIsVisibleSpy
        }
      }
    };

    injectCoverGridUI(mockWin);
    const instance = mockWin.__zoteroCoverGridInstance;
    await instance.controller.reloadCurrentCollection();

    const btnGrid = document.getElementById('zotero-cover-grid-btn-grid') as HTMLButtonElement;
    const btnList = document.getElementById('zotero-cover-grid-btn-list') as HTMLButtonElement;

    // List -> Grid: item 102 was selected in list view, so grid selects 102 and scrolls to it
    btnGrid.click();
    await instance.controller.reloadCurrentCollection();
    expect(instance.scroller.getSelectedIds()).toEqual([102]);
    const card102 = instance.scroller.getCardElement(102);
    expect(card102?.classList.contains('selected')).toBe(true);

    // Select item 101 in Grid, then switch Grid -> List
    instance.scroller.setSelectedIds([101]);
    btnList.click();
    expect(selectItemSpy).toHaveBeenCalledWith(101, false, false);
    expect(ensureRowIsVisibleSpy).toHaveBeenCalledWith(0);

    cleanupCoverGridUI(mockWin);
  });

  it('2. Shortcuts Parity: Shift+Arrow range selection, Cmd+C Quick Copy, and Backspace vs Cmd+Backspace', () => {
    const container = document.createElement('div');
    const viewport = document.createElement('div');
    container.style.width = '800px';

    const onDeleteItem = vi.fn();
    const onCopyCitation = vi.fn();
    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onDeleteItem,
      onCopyCitation
    });

    scroller.setItems(sampleItems);
    scroller.moveFocus(0); // Focus item 101 (index 0)
    expect(scroller.getSelectedIds()).toEqual([101]);

    // Shift + ArrowRight expands selection to [101, 102]
    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
    expect(scroller.getSelectedIds()).toEqual([101, 102]);

    // Shift + ArrowRight again expands selection to [101, 102, 103]
    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
    expect(scroller.getSelectedIds()).toEqual([101, 102, 103]);

    // Cmd + C triggers Quick Copy for all 3 selected items
    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
    expect(onCopyCitation).toHaveBeenCalledWith(sampleItems, false);

    // Plain Backspace calls onDeleteItem(selected) without forceTrash
    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(onDeleteItem).toHaveBeenCalledWith(sampleItems);

    // Cmd + Backspace calls onDeleteItem(selected, true) to force move to trash
    onDeleteItem.mockClear();
    scroller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Backspace', metaKey: true }));
    expect(onDeleteItem).toHaveBeenCalledWith(sampleItems, true);
  });

  it('3. Drag & Drop Cards to Left Collection Tree (#zotero-collections-tree)', async () => {
    document.body.innerHTML = `
      <div id="zotero-collections-tree">
        <div class="collection-row" data-collection-id="77"></div>
      </div>
      <div id="viewport"><div id="container"></div></div>
    `;
    const container = document.getElementById('container')!;
    const viewport = document.getElementById('viewport')!;

    const scroller = new VirtualGridScroller({ container, viewport });
    scroller.setItems(sampleItems);
    scroller.setSelectedIds([101, 102]);

    const card101 = scroller.getCardElement(101)!;
    expect(card101.getAttribute('draggable')).toBe('true');

    // Simulate dragstart with mock DataTransfer
    const dataMap = new Map<string, string>();
    const dragEvent: any = new Event('dragstart');
    dragEvent.dataTransfer = {
      effectAllowed: 'none',
      setData: (type: string, val: string) => dataMap.set(type, val),
      getData: (type: string) => dataMap.get(type) || ''
    };
    card101.dispatchEvent(dragEvent);

    expect(dataMap.get('zotero/item')).toBe('101,102');
    expect(JSON.parse(dataMap.get('text/x-zotero-drag-item')!)).toEqual({ itemIDs: [101, 102] });

    // Simulate drop onto #zotero-collections-tree
    const addItemsSpy = vi.fn();
    const mockWin: any = {
      document,
      Zotero: {
        Collections: {
          get: vi.fn((colId: number) => (colId === 77 ? { id: 77, addItems: addItemsSpy } : null))
        }
      }
    };
    const controller = new WindowCoverGridController(mockWin);
    controller.init(scroller);

    const colRow = document.querySelector('.collection-row')!;
    const dropEvent: any = new Event('drop', { bubbles: true });
    dropEvent.dataTransfer = dragEvent.dataTransfer;
    colRow.dispatchEvent(dropEvent);

    await new Promise((r) => setTimeout(r, 10));
    expect(addItemsSpy).toHaveBeenCalledWith([101, 102]);
    controller.destroy();
  });

  it('4. Multi-Selection Inspector Summary ("N개 항목 선택됨") & ZoteroPane Sync', () => {
    const selectItemsSpy = vi.fn();
    const showMessageSpy = vi.fn();
    document.body.innerHTML = `<div id="zotero-item-pane"></div>`;
    const paneEl = document.getElementById('zotero-item-pane') as any;
    paneEl.showMessage = showMessageSpy;

    const mockWin: any = {
      document,
      Zotero: { locale: 'ko-KR' },
      ZoteroPane: {
        itemsView: {
          selectItems: selectItemsSpy
        }
      }
    };

    selectItemsInZotero(mockWin, [101, 102, 103]);
    expect(selectItemsSpy).toHaveBeenCalledWith([101, 102, 103], false, true);
    expect(showMessageSpy).toHaveBeenCalledWith('3개 항목 선택됨');
  });

  it('5. MacBook Trackpad Control+Click & Standalone Note Context Menu Actions', () => {
    const container = document.createElement('div');
    const viewport = document.createElement('div');
    const onContextMenu = vi.fn();
    const onSelect = vi.fn();

    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onContextMenu,
      onSelect
    });
    scroller.setItems(sampleItems);

    // MacBook Control + Click on Note Card (id: 103) must open Context Menu instead of multi-select toggle
    const noteCardEl = scroller.getCardElement(103)!;
    noteCardEl.dispatchEvent(new MouseEvent('click', { ctrlKey: true, metaKey: false, bubbles: true }));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].id).toBe(103);

    // Render Context Menu for Standalone Note (hasPdf: false) -> Note actions must be enabled!
    const onOpenNote = vi.fn();
    const onCopyNote = vi.fn();
    const onDeleteNote = vi.fn();
    const menuEl = showPaperCardContextMenu({
      event: new MouseEvent('contextmenu', { clientX: 120, clientY: 160, ctrlKey: true }),
      card: sampleItems[2],
      win: {
        document,
        innerWidth: 1024,
        innerHeight: 768,
        addEventListener: window.addEventListener.bind(window),
        removeEventListener: window.removeEventListener.bind(window),
        Zotero: { locale: 'ko-KR' }
      },
      actions: {
        onOpenPdf: onOpenNote,
        onCopyCitation: onCopyNote,
        onDelete: onDeleteNote
      }
    });

    // Trailing click from Control+Click gesture must NOT immediately dismiss the menu
    window.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
    expect(document.getElementById('cover-grid-context-menu')).not.toBeNull();

    const openBtn = menuEl.querySelector('#menu-open-pdf') as HTMLElement;
    expect(openBtn.classList.contains('disabled')).toBe(false);
    expect(openBtn.textContent).toContain('노트 열기');
    openBtn.click();
    expect(onOpenNote).toHaveBeenCalledWith(sampleItems[2]);
  });

  it('6. Bottom-Left Tag Selector Real-Time Filtering (0ms)', () => {
    document.body.innerHTML = `
      <div id="zotero-tag-selector">
        <div class="tag-selector-item" data-tag="memory">memory</div>
      </div>
      <div id="viewport"><div id="container"></div></div>
    `;
    const container = document.getElementById('container')!;
    const viewport = document.getElementById('viewport')!;
    const scroller = new VirtualGridScroller({ container, viewport });

    const mockWin: any = { document };
    const controller = new WindowCoverGridController(mockWin);
    controller.init(scroller);
    (controller as any).allItems = [...sampleItems];
    controller.applyFilter();
    expect(container.querySelectorAll('.paper-card').length).toBe(3);

    // Select 'memory' tag in #zotero-tag-selector
    const tagNode = document.querySelector('.tag-selector-item')!;
    tagNode.classList.add('selected');
    tagNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Immediately filters to Paper Two (which has 'memory' tag) in 0ms
    const renderedCards = container.querySelectorAll('.paper-card');
    expect(renderedCards.length).toBe(1);
    expect(renderedCards[0].getAttribute('data-item-id')).toBe('102');

    // Deselect tag -> restores all 3 cards in 0ms
    tagNode.classList.remove('selected');
    tagNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.querySelectorAll('.paper-card').length).toBe(3);

    controller.destroy();
  });

  it('7. Multi-Agent Audit Edge Cases: Long-Hold Trackpad Click (>200ms), Document-Level Arrow/Cmd+A Forwarding, and Tag Mutation Sync', async () => {
    document.body.innerHTML = `
      <div id="zotero-cover-grid">
        <div id="viewport"><div id="container"></div></div>
      </div>
    `;
    const container = document.getElementById('container')!;
    const viewport = document.getElementById('viewport')!;
    const onContextMenu = vi.fn();
    const onSelect = vi.fn();

    const scroller = new VirtualGridScroller({
      container,
      viewport,
      onContextMenu,
      onSelect
    });
    scroller.setItems(sampleItems);

    // Edge Case A: Document-level ArrowRight and Cmd+A work immediately after entering Grid before any card is clicked
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(scroller.getSelectedIds()).toEqual([101]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));
    expect(scroller.getSelectedIds()).toEqual([101, 102, 103]);

    // Edge Case B: MacBook Trackpad Control+Click held for >200ms and Control key released before mouseup/click
    const card101 = scroller.getCardElement(101)!;
    card101.dispatchEvent(new MouseEvent('mousedown', { button: 0, ctrlKey: true, bubbles: true }));
    card101.dispatchEvent(new MouseEvent('contextmenu', { button: 2, ctrlKey: true, bubbles: true }));
    expect(onContextMenu).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 200));
    // Trailing click after 200ms (even with ctrlKey released) must be swallowed and NOT reset multi-selection!
    card101.dispatchEvent(new MouseEvent('click', { button: 0, ctrlKey: false, bubbles: true }));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(scroller.getSelectedIds()).toEqual([101, 102, 103]);

    scroller.destroy();
  });
});
