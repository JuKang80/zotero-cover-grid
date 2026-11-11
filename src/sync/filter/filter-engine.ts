import { PaperCardData } from '../../types';
import { richTextToSearchableText } from '../../utils/rich-text';

declare const ZoteroPane: any;

export class FilterEngine {
  private searchDebounceTimer: any = null;
  private tagTickTimer: any = null;
  private currentSearchQuery = '';
  private selectedFilterTags = new Set<string>();
  private searchBoxCleanup: (() => void) | null = null;
  private tagSelectorCleanup: (() => void) | null = null;
  private isDestroyed = false;

  constructor(private win: any, private onFilterChanged: () => void) {}

  public getCurrentSearchQuery(): string {
    return this.currentSearchQuery;
  }

  public getSelectedFilterTags(): Set<string> {
    return this.selectedFilterTags;
  }

  public setSelectedFilterTags(tags: string[] | Set<string>): void {
    this.selectedFilterTags = new Set(
      Array.from(tags || [])
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean)
    );
    this.onFilterChanged();
  }

  public getActiveFilterTags(): string[] {
    const result = new Set<string>(this.selectedFilterTags);
    try {
      const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      const doc = this.win?.document;
      const tagSelector: any =
        zp?.tagSelector ||
        doc?.getElementById?.('zotero-tag-selector') ||
        doc?.querySelector?.('tag-selector');

      if (tagSelector) {
        const rawSelected =
          tagSelector.selectedTags ||
          tagSelector.selection ||
          (typeof tagSelector.getSelectedTags === 'function' ? tagSelector.getSelectedTags() : null);
        if (rawSelected && typeof rawSelected[Symbol.iterator] === 'function') {
          for (const t of rawSelected) {
            const name = typeof t === 'string' ? t : t?.tag || t?.name;
            if (name) result.add(String(name).trim().toLowerCase());
          }
        }
        if (typeof tagSelector.querySelectorAll === 'function') {
          const selectedNodes = tagSelector.querySelectorAll(
            '.tag-selector-item.selected, [aria-selected="true"], .selected[data-tag]'
          );
          for (const node of Array.from(selectedNodes) as HTMLElement[]) {
            const tagVal = node.getAttribute?.('data-tag') || node.textContent;
            if (tagVal) result.add(String(tagVal).trim().toLowerCase());
          }
        }
      }
    } catch {}
    return Array.from(result);
  }

  public handleSearchInput(query: string, fastPath = false): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    const trimmed = query.trim().toLowerCase();
    this.currentSearchQuery = trimmed;

    // 0ms Fast-path on empty string
    if (fastPath || trimmed === '') {
      this.onFilterChanged();
      return;
    }

    // 150ms Trailing-edge debounce
    this.searchDebounceTimer = setTimeout(() => {
      this.searchDebounceTimer = null;
      if (!this.isDestroyed) {
        this.onFilterChanged();
      }
    }, 150);
  }

  public filterItems(allItems: PaperCardData[]): PaperCardData[] {
    const q = this.currentSearchQuery;
    const activeTags = this.getActiveFilterTags();

    if (!q && activeTags.length === 0) {
      return [...allItems];
    }

    return allItems.filter((it) => {
      if (q) {
        const matchesQuery =
          it.title.toLowerCase().includes(q) ||
          richTextToSearchableText(it.title).includes(q) ||
          it.authorText.toLowerCase().includes(q) ||
          it.citationText.toLowerCase().includes(q) ||
          (it.notePreview && it.notePreview.toLowerCase().includes(q));
        if (!matchesQuery) return false;
      }
      if (activeTags.length > 0) {
        const itemTagSet = new Set<string>([
          ...(it.tags || []).map((t) => t.toLowerCase()),
          ...(it.colorTags || []).map((c) => c.tag.toLowerCase())
        ]);
        for (const reqTag of activeTags) {
          if (!itemTagSet.has(reqTag)) return false;
        }
      }
      return true;
    });
  }

  public bindSearchBox(): void {
    const doc = this.win?.document;
    if (!doc) return;
    const searchBox = (
      doc.getElementById('zotero-tb-search') ||
      doc.getElementById('zotero-search-box') ||
      doc.querySelector('quick-search-textbox')
    ) as any;
    if (!searchBox) return;

    const inputEl =
      searchBox.inputField ||
      searchBox.searchTextbox?.inputField ||
      searchBox.querySelector?.('input') ||
      doc.getElementById('zotero-tb-search-textbox')?.inputField ||
      searchBox;

    // Sync any pre-existing search query when binding
    try {
      const initialVal = (inputEl && 'value' in inputEl ? inputEl.value : searchBox?.value) || '';
      if (typeof initialVal === 'string' && initialVal.trim()) {
        this.currentSearchQuery = initialVal.trim().toLowerCase();
      }
    } catch {}

    const handleInput = (e: any) => {
      const query = (e.target as HTMLInputElement).value || '';
      this.handleSearchInput(query);
    };

    const handleKey = (e: any) => {
      if (e.key === 'Escape') {
        if ('value' in inputEl) inputEl.value = '';
        if (searchBox !== inputEl && 'value' in searchBox) searchBox.value = '';
        this.handleSearchInput('', true); // 0ms fast-path
      }
    };

    inputEl.addEventListener('input', handleInput);
    inputEl.addEventListener('keydown', handleKey);
    if (searchBox !== inputEl) {
      searchBox.addEventListener('command', handleInput);
      searchBox.addEventListener('input', handleInput);
      searchBox.addEventListener('keydown', handleKey);
    }

    this.searchBoxCleanup = () => {
      inputEl.removeEventListener('input', handleInput);
      inputEl.removeEventListener('keydown', handleKey);
      if (searchBox !== inputEl) {
        searchBox.removeEventListener('command', handleInput);
        searchBox.removeEventListener('input', handleInput);
        searchBox.removeEventListener('keydown', handleKey);
      }
    };
  }

  public bindTagSelector(): void {
    const doc = this.win?.document;
    if (!doc) return;
    const tagSelectorEl =
      doc.getElementById?.('zotero-tag-selector') ||
      doc.getElementById?.('zotero-tag-selector-container') ||
      doc.querySelector?.('tag-selector');
    if (!tagSelectorEl || typeof tagSelectorEl.addEventListener !== 'function') return;

    const handleTagEvent = () => {
      if (this.isDestroyed) return;
      this.onFilterChanged();
      if (this.tagTickTimer) clearTimeout(this.tagTickTimer);
      this.tagTickTimer = setTimeout(() => {
        this.tagTickTimer = null;
        if (!this.isDestroyed) this.onFilterChanged();
      }, 0);
    };

    tagSelectorEl.addEventListener('click', handleTagEvent);
    tagSelectorEl.addEventListener('command', handleTagEvent);
    tagSelectorEl.addEventListener('select', handleTagEvent);
    tagSelectorEl.addEventListener('change', handleTagEvent);

    this.tagSelectorCleanup = () => {
      if (this.tagTickTimer) clearTimeout(this.tagTickTimer);
      this.tagTickTimer = null;
      tagSelectorEl.removeEventListener('click', handleTagEvent);
      tagSelectorEl.removeEventListener('command', handleTagEvent);
      tagSelectorEl.removeEventListener('select', handleTagEvent);
      tagSelectorEl.removeEventListener('change', handleTagEvent);
    };
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.tagTickTimer) {
      clearTimeout(this.tagTickTimer);
      this.tagTickTimer = null;
    }
    this.searchBoxCleanup?.();
    this.searchBoxCleanup = null;
    this.tagSelectorCleanup?.();
    this.tagSelectorCleanup = null;
    this.selectedFilterTags.clear();
  }
}
