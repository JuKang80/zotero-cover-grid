import { describe, it, expect } from 'vitest';
import {
  formatApa7Citation,
  extractReadStatusFromTags,
  extractPaperCardData,
  formatFullApa7Bibliography,
  copyTextToClipboard
} from '../src/utils/apa-formatter';

describe('APA 7th Edition Citation Formatter', () => {
  it('should format 1 author: Kim (2026)', () => {
    const creators = [{ lastName: 'Kim', firstName: 'Min-soo' }];
    expect(formatApa7Citation(creators, '2026')).toBe('Kim (2026)');
  });

  it('should format 2 authors: Kim & Lee (2026)', () => {
    const creators = [
      { lastName: 'Kim', firstName: 'Min-soo' },
      { lastName: 'Lee', firstName: 'Ji-won' }
    ];
    expect(formatApa7Citation(creators, 2026)).toBe('Kim & Lee (2026)');
  });

  it('should format 3+ authors with et al.: Kim et al. (2026)', () => {
    const creators = [
      { lastName: 'Kim', firstName: 'Min-soo' },
      { lastName: 'Lee', firstName: 'Ji-won' },
      { lastName: 'Park', firstName: 'Seo-yeon' }
    ];
    expect(formatApa7Citation(creators, '2026')).toBe('Kim et al. (2026)');
  });

  it('should handle missing year with (n.d.)', () => {
    const creators = [{ lastName: 'Kim' }];
    expect(formatApa7Citation(creators)).toBe('Kim (n.d.)');
    expect(formatApa7Citation(creators, '')).toBe('Kim (n.d.)');
  });

  it('should handle institutional single name author', () => {
    const creators = [{ name: 'World Health Organization' }];
    expect(formatApa7Citation(creators, 2024)).toBe('World Health Organization (2024)');
  });

  it('should handle zero authors', () => {
    expect(formatApa7Citation([], 2026)).toBe('(2026)');
    expect(formatApa7Citation([])).toBe('(n.d.)');
  });
});

describe('Read Status & Card Data Extraction', () => {
  it('should extract reading status from tags correctly', () => {
    expect(extractReadStatusFromTags([{ tag: '#unread' }])).toBe('unread');
    expect(extractReadStatusFromTags(['#reading'])).toBe('reading');
    expect(extractReadStatusFromTags(['#read'])).toBe('read');
    expect(extractReadStatusFromTags([])).toBe('unread');
  });

  it('should extract complete card data from Zotero item', () => {
    const mockItem = {
      id: 55,
      key: 'MOCKKEY55',
      getField: (field: string) => {
        if (field === 'title') return 'Deep Learning for Vision';
        if (field === 'date') return '2025-05-12';
        return '';
      },
      getCreators: () => [{ lastName: 'He', firstName: 'Kaiming' }],
      getTags: () => [{ tag: '#reading' }],
      itemType: 'journalArticle'
    };

    const card = extractPaperCardData(mockItem);
    expect(card.id).toBe(55);
    expect(card.key).toBe('MOCKKEY55');
    expect(card.title).toBe('Deep Learning for Vision');
    expect(card.year).toBe('2025');
    expect(card.citationText).toBe('He (2025)');
    expect(card.readStatus).toBe('reading');
  });

  it('should extract note title and body preview from Zotero standalone note item', () => {
    const mockNoteItem = {
      id: 77,
      key: 'NOTEKEY77',
      isNote: () => true,
      getNoteTitle: () => '■ 2026 실험 가설 메모',
      getNote: () => '<p><strong>■ 2026 실험 가설 메모</strong></p><p>1. fMRI 신호 대조군 측정 및 데이터 전처리</p><p>2. 피험자 반응 시간 기록 및 통계 분석</p>',
      dateModified: '2026-11-06 18:30:00',
      itemType: 'note',
      getTags: () => []
    };

    const card = extractPaperCardData(mockNoteItem);
    expect(card.id).toBe(77);
    expect(card.itemType).toBe('note');
    expect(card.title).toBe('■ 2026 실험 가설 메모');
    expect(card.citationText).toBe('Note');
    expect(card.authorText).toContain('Note · 2026-11-06');
    expect(card.publicationTitle).toBe('RESEARCH NOTE');
    expect(card.notePreview).toContain('fMRI 신호 대조군 측정');
  });

  it('formats full APA 7 bibliographic reference correctly', () => {
    const card = {
      id: 88,
      key: 'KEY88',
      title: 'Attention Is All You Need',
      citationText: 'Vaswani et al. (2017)',
      authorText: 'Vaswani, A., Shazeer, N., & Parmar, N.',
      year: '2017',
      itemType: 'journalArticle',
      readStatus: 'read' as const,
      hasPdf: true
    };

    const mockItem = {
      getField: (field: string) => {
        if (field === 'publicationTitle') return 'Advances in Neural Information Processing Systems';
        if (field === 'volume') return '30';
        if (field === 'pages') return '5998-6008';
        if (field === 'DOI') return '10.5555/3295222.3295349';
        return '';
      }
    };

    const fullBib = formatFullApa7Bibliography(card, mockItem);
    expect(fullBib).toContain('Vaswani, A., Shazeer, N., & Parmar, N.');
    expect(fullBib).toContain('(2017).');
    expect(fullBib).toContain('Attention Is All You Need.');
    expect(fullBib).toContain('Advances in Neural Information Processing Systems, 30, 5998-6008.');
    expect(fullBib).toContain('https://doi.org/10.5555/3295222.3295349');
  });

  it('copies citation to clipboard with fallbacks', async () => {
    const mockWin = {
      navigator: {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined)
        }
      }
    };

    const success = await copyTextToClipboard('Test Citation (2026)', mockWin);
    expect(success).toBe(true);
    expect(mockWin.navigator.clipboard.writeText).toHaveBeenCalledWith('Test Citation (2026)');
  });
});
