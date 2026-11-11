/**
 * Rich Text Utilities for Zotero Titles and Metadata
 *
 * Zotero supports basic HTML tags in item titles and fields:
 * <sup>, <sub>, <i>, <em>, <b>, <strong>, <sc>, <span>
 * along with HTML entities (&amp;, &lt;, &gt;, &quot;, &#39;).
 *
 * This module safely renders these tags into DOM nodes without security risks
 * and converts them to clean plain text (with Unicode superscripts/subscripts)
 * for tooltips, canvas covers, clipboard citations, and search indexing.
 */

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  'n': 'ⁿ',
  'i': 'ⁱ'
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  'a': 'ₐ',
  'e': 'ₑ',
  'o': 'ₒ',
  'x': 'ₓ',
  'h': 'ₕ',
  'k': 'ₖ',
  'l': 'ₗ',
  'm': 'ₘ',
  'n': 'ₙ',
  'p': 'ₚ',
  's': 'ₛ',
  't': 'ₜ'
};

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&ndash;': '–',
  '&mdash;': '—',
  '&nbsp;': ' ',
  '&thinsp;': ' ',
  '&plusmn;': '±',
  '&times;': '×',
  '&divide;': '÷',
  '&le;': '≤',
  '&ge;': '≥',
  '&ne;': '≠',
  '&infin;': '∞'
};

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const ALLOWED_TAGS = new Set(['sup', 'sub', 'i', 'em', 'b', 'strong', 'sc', 'span', 'br']);

/**
 * Converts a rich text string containing HTML tags to clean plain text.
 * Replaces <sup> and <sub> with corresponding Unicode characters when possible.
 * Decodes HTML entities and strips remaining tags.
 */
export function richTextToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  let text = String(html);

  // Replace <sup>...</sup> with Unicode superscripts
  text = text.replace(/<sup[^>]*>(.*?)<\/sup>/gi, (_, content) => {
    return content.split('').map((char: string) => SUPERSCRIPT_MAP[char] || char).join('');
  });

  // Replace <sub>...</sub> with Unicode subscripts
  text = text.replace(/<sub[^>]*>(.*?)<\/sub>/gi, (_, content) => {
    return content.split('').map((char: string) => SUBSCRIPT_MAP[char] || char).join('');
  });

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&(?:[a-z\d]+|#\d+|#x[a-f\d]+);/gi, (entity) => {
    const lower = entity.toLowerCase();
    if (HTML_ENTITY_MAP[lower]) return HTML_ENTITY_MAP[lower];
    if (lower.startsWith('&#x')) {
      const code = parseInt(lower.slice(3, -1), 16);
      return !isNaN(code) ? String.fromCharCode(code) : entity;
    }
    if (lower.startsWith('&#')) {
      const code = parseInt(lower.slice(2, -1), 10);
      return !isNaN(code) ? String.fromCharCode(code) : entity;
    }
    return entity;
  });

  // Normalize whitespace
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Converts a rich text string into a normalized searchable plain text representation.
 * Converts Unicode superscripts/subscripts back to standard ascii numbers/letters and strips tags.
 */
export function richTextToSearchableText(html: string | null | undefined): string {
  if (!html) return '';
  const plain = richTextToPlainText(html);
  let searchable = plain;
  for (const [ascii, uni] of Object.entries(SUPERSCRIPT_MAP)) {
    searchable = searchable.split(uni).join(ascii);
  }
  for (const [ascii, uni] of Object.entries(SUBSCRIPT_MAP)) {
    searchable = searchable.split(uni).join(ascii);
  }
  return searchable.toLowerCase();
}

/**
 * Safely renders rich text into an HTMLElement container using safe DOM nodes.
 * Only allowed formatting tags (sup, sub, i, em, b, strong, sc, span, br) are rendered.
 * Any other tags are stripped without executing scripts or injecting dangerous markup.
 */
export function renderRichText(container: HTMLElement, richText: string | null | undefined): void {
  if (!container) return;
  const rawText = richText != null ? String(richText) : '';
  (container as any).__renderedRichText = rawText;

  // Fast path for plain strings with no HTML tags or entities
  if (!rawText.includes('<') && !rawText.includes('&')) {
    container.textContent = rawText;
    return;
  }

  container.textContent = '';
  const targetDoc = container.ownerDocument || document;

  try {
    let sourceBody: Element | null = null;
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(rawText, 'text/html');
      sourceBody = parsedDoc.body;
    } else {
      const temp = targetDoc.createElementNS(HTML_NS, 'div');
      temp.innerHTML = rawText;
      sourceBody = temp;
    }

    if (sourceBody) {
      appendSanitizedNodes(sourceBody, container, targetDoc);
    } else {
      container.textContent = richTextToPlainText(rawText);
    }
  } catch {
    container.textContent = richTextToPlainText(rawText);
  }
}

function appendSanitizedNodes(sourceParent: Node, targetParent: Node, doc: Document): void {
  for (let i = 0; i < sourceParent.childNodes.length; i++) {
    const node = sourceParent.childNodes[i];
    if (node.nodeType === 3) {
      // Text node
      targetParent.appendChild(doc.createTextNode(node.textContent || ''));
    } else if (node.nodeType === 1) {
      // Element node
      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      if (ALLOWED_TAGS.has(tag)) {
        let childEl: HTMLElement;
        if (tag === 'sc') {
          // Zotero small caps
          childEl = doc.createElementNS(HTML_NS, 'span') as HTMLElement;
          childEl.style.fontVariant = 'small-caps';
        } else if (tag === 'br') {
          childEl = doc.createElementNS(HTML_NS, 'br') as HTMLElement;
        } else {
          childEl = doc.createElementNS(HTML_NS, tag) as HTMLElement;
        }

        if (tag === 'span') {
          const className = el.getAttribute('class');
          if (className) {
            // Keep safe class names (e.g. nocase)
            const safeClass = className.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
            if (safeClass) childEl.className = safeClass;
          }
        }

        targetParent.appendChild(childEl);
        if (tag !== 'br') {
          appendSanitizedNodes(el, childEl, doc);
        }
      } else {
        // Tag is not allowed: recursively preserve child text/content but strip the tag itself
        appendSanitizedNodes(el, targetParent, doc);
      }
    }
  }
}
