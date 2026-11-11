import { describe, it, expect } from 'vitest';
import {
  richTextToPlainText,
  richTextToSearchableText,
  renderRichText
} from '../src/utils/rich-text';
import { createPaperCardDOM } from '../src/ui/card/card-dom-builder';
import { updatePaperCardMetadata } from '../src/ui/card/card-updater';
import { PaperCardData } from '../src/types';

describe('Rich Text Handling (Zotero Title Formatting)', () => {
  it('converts superscript <sup>2</sup> to Unicode superscript in plain text', () => {
    const raw = 'Time<sup>2</sup>: A Framework for the Neural Dynamics of Visual Perception';
    const plain = richTextToPlainText(raw);
    expect(plain).toBe('Time²: A Framework for the Neural Dynamics of Visual Perception');
  });

  it('converts subscript <sub>2</sub> to Unicode subscript in plain text', () => {
    const raw = 'Studies on CO<sub>2</sub> and H<sub>2</sub>O';
    const plain = richTextToPlainText(raw);
    expect(plain).toBe('Studies on CO₂ and H₂O');
  });

  it('strips italics, bold, small caps and span tags cleanly for plain text', () => {
    const raw = '<i>Escherichia coli</i> in <b>Vivo</b> with <sc>DNA</sc> and <span class="nocase">RNA</span>';
    const plain = richTextToPlainText(raw);
    expect(plain).toBe('Escherichia coli in Vivo with DNA and RNA');
  });

  it('decodes HTML entities properly in plain text', () => {
    const raw = 'Authors &amp; Papers &ndash; &quot;Quotes&quot; &lt;3';
    const plain = richTextToPlainText(raw);
    expect(plain).toBe('Authors & Papers – "Quotes" <3');
  });

  it('normalizes searchable text back to ascii digits for search filtering', () => {
    const raw = 'Time<sup>2</sup>: A Framework';
    const searchable = richTextToSearchableText(raw);
    expect(searchable).toBe('time2: a framework');
  });

  it('renders rich text safely into DOM elements with real <sup>, <sub>, <i> nodes', () => {
    const div = document.createElement('div');
    const raw = 'Time<sup>2</sup>: A Framework for the Neural Dynamics of Visual Perception';
    renderRichText(div, raw);

    expect(div.childNodes.length).toBe(3);
    expect(div.childNodes[0].nodeType).toBe(3); // TextNode
    expect(div.childNodes[0].textContent).toBe('Time');

    expect(div.childNodes[1].nodeType).toBe(1); // ElementNode
    const supEl = div.childNodes[1] as HTMLElement;
    expect(supEl.tagName.toLowerCase()).toBe('sup');
    expect(supEl.textContent).toBe('2');

    expect(div.childNodes[2].nodeType).toBe(3); // TextNode
    expect(div.childNodes[2].textContent).toBe(': A Framework for the Neural Dynamics of Visual Perception');
  });

  it('renders Zotero <sc> as span with small-caps style', () => {
    const div = document.createElement('div');
    const raw = 'Intro to <sc>NASA</sc> Missions';
    renderRichText(div, raw);

    const spanEl = div.querySelector('span');
    expect(spanEl).not.toBeNull();
    expect(spanEl?.style.fontVariant).toBe('small-caps');
    expect(spanEl?.textContent).toBe('NASA');
  });

  it('strips dangerous tags like <script> and <img> without running or inserting them', () => {
    const div = document.createElement('div');
    const raw = 'Title <script>alert("xss")</script><img src="x" onerror="evil()">Clean';
    renderRichText(div, raw);

    expect(div.querySelector('script')).toBeNull();
    expect(div.querySelector('img')).toBeNull();
    expect(div.textContent).toContain('Title');
    expect(div.textContent).toContain('Clean');
  });

  it('handles fast path for plain text without tags or entities', () => {
    const div = document.createElement('div');
    const raw = 'Plain Paper Title Without Tags';
    renderRichText(div, raw);

    expect(div.textContent).toBe('Plain Paper Title Without Tags');
    expect(div.childNodes.length).toBe(1);
  });

  it('renders rich text in createPaperCardElement without displaying raw HTML markup', () => {
    const cardData: PaperCardData = {
      id: 555,
      key: 'KEY555',
      title: 'Time<sup>2</sup>: A Framework for the Neural Dynamics of Visual Perception',
      citationText: 'Caplette & Gosselin (2026)',
      authorText: 'Caplette, N. & Gosselin, F.',
      year: '2026',
      itemType: 'journalArticle',
      readStatus: 'unread',
      hasPdf: true
    };

    const cardEl = createPaperCardDOM(cardData);
    const titleEl = cardEl.querySelector('.card-title') as HTMLElement;
    expect(titleEl).not.toBeNull();
    // Must NOT display raw '<sup>' text in DOM
    expect(titleEl.innerHTML).toContain('<sup>2</sup>');
    expect(titleEl.querySelector('sup')?.textContent).toBe('2');
    // Tooltip title must be clean Unicode superscript (Time²) without HTML tags
    expect(titleEl.title).toBe('Time²: A Framework for the Neural Dynamics of Visual Perception');
    expect(cardEl.title).toContain('Time²: A Framework');
    expect(cardEl.title).not.toContain('<sup>');

    // Test card updater sync
    updatePaperCardMetadata(cardEl, {
      ...cardData,
      title: 'Time<sup>3</sup>: Advanced Dynamics'
    });
    expect(titleEl.querySelector('sup')?.textContent).toBe('3');
    expect(titleEl.title).toBe('Time³: Advanced Dynamics');
  });
});
