import { describe, it, expect } from 'vitest';
import { formatApa7Citation, extractReadStatusFromTags, extractPaperCardData } from '../src/utils/apa-formatter';

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
});
