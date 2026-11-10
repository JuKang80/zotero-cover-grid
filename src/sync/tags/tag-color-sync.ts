import { PaperCardData, ReadStatus } from '../../types';
import { extractReadStatusFromTags } from '../../utils/apa-formatter';
import { updatePaperCardBadge, updatePaperCardColorTags } from '../../ui/paper-card';

declare const Zotero: any;
declare const ZoteroPane: any;

export class TagColorSync {
  constructor(
    private win: any,
    private getCardElement: (id: number) => HTMLElement | null | undefined
  ) {}

  public getNormalizedColorTags(libraryID?: number): Array<{ tag: string; color: string; position: number }> {
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Tags?.getColors) return [];
    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    const libId = libraryID || zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID || 1;
    try {
      const raw = z.Tags.getColors(libId);
      const list: Array<{ tag: string; color: string; position: number }> = [];
      if (!raw) return list;
      if (typeof raw.entries === 'function' && !Array.isArray(raw)) {
        for (const [tag, val] of raw.entries()) {
          if (typeof tag === 'string' && val && val.color) {
            list.push({ tag, color: val.color, position: Number(val.position ?? 0) });
          }
        }
      } else if (Array.isArray(raw)) {
        for (const c of raw) {
          if (c && c.tag && c.color) {
            list.push({ tag: c.tag, color: c.color, position: Number(c.position ?? 0) });
          }
        }
      } else if (typeof raw === 'object') {
        for (const [tag, val] of Object.entries(raw)) {
          if (val && (val as any).color) {
            list.push({ tag, color: (val as any).color, position: Number((val as any).position ?? 0) });
          }
        }
      }
      return list;
    } catch {
      return [];
    }
  }

  public async syncTagStatus(card: PaperCardData, nextStatus: ReadStatus): Promise<void> {
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Items) return;
    try {
      let zItem: any = null;
      try {
        zItem = z.Items.get(card.id);
      } catch {
        if (z.Items.getAsync) {
          zItem = await z.Items.getAsync(card.id);
        }
      }
      if (!zItem) return;

      const readingTags = ['#unread', '#reading', '#read', 'unread', 'reading', 'read'];
      for (const t of readingTags) {
        if (zItem.hasTag?.(t)) {
          zItem.removeTag?.(t);
        }
      }

      // If user has a colored tag configured for plain 'unread'/'reading'/'read', prefer that tag name so color dots stay synced
      const colorList = this.getNormalizedColorTags(zItem.libraryID);
      const plainColorMatch = colorList.find((c) => c.tag.toLowerCase() === nextStatus);
      const hashColorMatch = colorList.find((c) => c.tag.toLowerCase() === `#${nextStatus}`);
      const tagToAdd = hashColorMatch ? hashColorMatch.tag : plainColorMatch ? plainColorMatch.tag : `#${nextStatus}`;

      zItem.addTag?.(tagToAdd);
      card.readStatus = nextStatus;
      const readingTagSet = new Set(readingTags.map((t) => t.toLowerCase()));
      const nextTags = (card.tags || []).filter((t) => !readingTagSet.has(t.toLowerCase()));
      nextTags.push(tagToAdd);
      card.tags = nextTags;

      const cardEl = this.getCardElement(card.id);
      if (cardEl) {
        updatePaperCardBadge(cardEl, nextStatus);
      }

      if (typeof zItem.saveTx === 'function') {
        await zItem.saveTx();
      }
    } catch {
      // Ignore
    }
  }

  public async toggleColorTag(card: PaperCardData, position: number): Promise<void> {
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Items || !z?.Tags) return;
    try {
      let zItem: any = null;
      try {
        zItem = z.Items.get(card.id);
      } catch {
        if (z.Items.getAsync) {
          zItem = await z.Items.getAsync(card.id);
        }
      }
      if (!zItem) return;

      // Ensure item tags data is loaded into memory to prevent UnloadedDataException
      if (typeof zItem.loadDataType === 'function') {
        try {
          await zItem.loadDataType('tags');
        } catch {
          try {
            await zItem.loadAllData?.();
          } catch {}
        }
      }

      const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      const libId = zItem.libraryID || zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID || 1;
      const rawColors = typeof z.Tags.getColors === 'function' ? z.Tags.getColors(libId) : null;
      const colorList = this.getNormalizedColorTags(libId);

      // Position 0: Zotero shortcut '0' removes all colored tags from the item
      if (position === 0) {
        if (typeof z.Tags.removeColoredTagsFromItems === 'function') {
          try {
            await z.Tags.removeColoredTagsFromItems([zItem]);
          } catch {}
        }

        const toRemove = new Set<string>([
          ...(card.colorTags || []).map((c) => c.tag),
          ...colorList.map((c) => c.tag)
        ]);
        card.colorTags = [];
        for (const tagName of toRemove) {
          if (typeof zItem.hasTag === 'function' ? zItem.hasTag(tagName) : true) {
            zItem.removeTag?.(tagName);
          }
        }
        const remainingTags = (zItem.getTags?.() || []).filter((t: any) => {
          const name = typeof t === 'string' ? t : t?.tag;
          return name && !toRemove.has(name);
        });
        card.tags = (card.tags || []).filter((t) => !toRemove.has(t));
        card.readStatus = extractReadStatusFromTags(remainingTags);
        const cardEl = this.getCardElement(card.id);
        if (cardEl) {
          updatePaperCardColorTags(cardEl, []);
          updatePaperCardBadge(cardEl, card.readStatus);
        }
        if (typeof zItem.saveTx === 'function') {
          await zItem.saveTx();
        } else if (typeof zItem.save === 'function') {
          await zItem.save();
        }
        return;
      }

      // Resolve target color for shortcut key 1..9
      // Strategy 1: Native Zotero.Tags.getColorByPosition(libraryID, position) (100% native parity)
      let targetTag: string | null = null;
      let targetColorHex: string | null = null;

      if (typeof z.Tags.getColorByPosition === 'function') {
        try {
          const colorData = z.Tags.getColorByPosition(libId, position - 1);
          if (colorData && (colorData.name || colorData.tag)) {
            targetTag = colorData.name || colorData.tag;
            targetColorHex = colorData.color || null;
          }
        } catch {}
      }

      // Strategy 2: Normalized color tags fallback
      if (!targetTag) {
        const isMapLike = rawColors && typeof rawColors.entries === 'function' && !Array.isArray(rawColors);
        const hasZeroIndex = colorList.some((c) => c.position === 0);
        let found: { tag: string; color: string; position: number } | undefined;

        if (isMapLike || hasZeroIndex) {
          found =
            colorList.find((c) => c.position === position - 1) ||
            (!hasZeroIndex ? colorList.find((c) => c.position === position) : undefined);
        } else {
          found =
            colorList.find((c) => c.position === position) ||
            colorList.find((c) => c.position === position - 1);
        }

        if (found?.tag) {
          targetTag = found.tag;
          targetColorHex = found.color;
        }
      }

      if (!targetTag) return;

      const existingItemTags: Array<{ tag: string } | string> = zItem.getTags?.() || [];
      const hadTagInZotero =
        (typeof zItem.hasTag === 'function' && zItem.hasTag(targetTag)) ||
        existingItemTags.some((t: any) => (typeof t === 'string' ? t : t?.tag) === targetTag);
      const hadColorOnCard = (card.colorTags || []).some(
        (c) => c.tag === targetTag || (targetColorHex && c.color === targetColorHex)
      );
      const isRemoving = hadTagInZotero || hadColorOnCard;

      // 1. Instant local in-memory reflection for 0ms visual feedback
      if (!card.colorTags) card.colorTags = [];
      if (isRemoving) {
        card.colorTags = card.colorTags.filter(
          (c) => c.tag !== targetTag && (!targetColorHex || c.color !== targetColorHex)
        );
      } else {
        const hex = targetColorHex || '#ff0000';
        card.colorTags.push({ tag: targetTag, color: hex });
        const posMap = new Map(colorList.map((c) => [c.tag, c.position]));
        card.colorTags.sort((a, b) => (posMap.get(a.tag) ?? 99) - (posMap.get(b.tag) ?? 99));
      }

      // Compute updated tags to also keep readStatus badge and card.tags in sync
      const baseTagNames = Array.from(
        new Set([
          ...(card.tags || []),
          ...existingItemTags.map((t: any) => (typeof t === 'string' ? t : t?.tag)).filter(Boolean)
        ])
      );
      let updatedTagNames = baseTagNames;
      if (isRemoving) {
        updatedTagNames = updatedTagNames.filter((name) => name !== targetTag);
      } else if (!updatedTagNames.includes(targetTag)) {
        updatedTagNames.push(targetTag);
      }
      card.tags = updatedTagNames;
      card.readStatus = extractReadStatusFromTags(updatedTagNames);

      const cardEl = this.getCardElement(card.id);
      if (cardEl) {
        updatePaperCardColorTags(cardEl, card.colorTags);
        updatePaperCardBadge(cardEl, card.readStatus);
      }

      // 2. Persist to Zotero database with type 0 (manual user tag)
      if (isRemoving) {
        zItem.removeTag?.(targetTag);
      } else {
        zItem.addTag?.(targetTag, 0);
      }

      if (typeof zItem.saveTx === 'function') {
        await zItem.saveTx();
      } else if (typeof zItem.save === 'function') {
        await zItem.save();
      }
    } catch {
      // Ignore
    }
  }
}
