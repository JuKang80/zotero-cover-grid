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

  private static isReadingStatusTag(tagName: string): boolean {
    if (!tagName) return false;
    const normalized = String(tagName)
      .toLowerCase()
      .trim()
      .replace(/^[#/_-]+/, '')
      .replace(/[\s_-]+/g, '');
    return (
      normalized === 'read' ||
      normalized === 'reading' ||
      normalized === 'unread' ||
      normalized === 'toread' ||
      normalized === 'inprogress'
    );
  }

  private static matchesStatusVariant(tagName: string, status: ReadStatus): boolean {
    if (!tagName) return false;
    const normalized = String(tagName)
      .toLowerCase()
      .trim()
      .replace(/^[#/_-]+/, '')
      .replace(/[\s_-]+/g, '');
    if (status === 'read') return normalized === 'read';
    if (status === 'reading') return normalized === 'reading' || normalized === 'inprogress';
    return normalized === 'unread' || normalized === 'toread';
  }

  /**
   * Zotero.Items.get(id) returns `false` (does NOT throw) when the item is not in the
   * in-memory cache, so fall back to getAsync on any falsy result as well as on throw.
   */
  private async resolveZoteroItem(z: any, id: number): Promise<any> {
    let zItem: any = null;
    try {
      zItem = z.Items.get?.(id);
    } catch {
      zItem = null;
    }
    if ((!zItem || typeof zItem !== 'object') && typeof z.Items.getAsync === 'function') {
      try {
        zItem = await z.Items.getAsync(id);
      } catch {
        zItem = null;
      }
    }
    return zItem && typeof zItem === 'object' ? zItem : null;
  }

  public getNormalizedColorTags(libraryID?: number): Array<{ tag: string; color: string; position: number }> {
    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Tags) return [];
    const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
    const libId = libraryID || zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID || 1;
    try {
      const list: Array<{ tag: string; color: string; position: number }> = [];
      if (typeof z.Tags.getColors === 'function') {
        const raw = z.Tags.getColors(libId);
        if (raw) {
          if (typeof raw.entries === 'function' && !Array.isArray(raw)) {
            for (const [tag, val] of raw.entries()) {
              if (typeof tag === 'string' && val && val.color) {
                list.push({ tag, color: val.color, position: Number(val.position ?? 0) });
              }
            }
          } else if (Array.isArray(raw)) {
            for (let i = 0; i < raw.length; i++) {
              const c = raw[i];
              const name = c?.tag || c?.name;
              if (name && c?.color) {
                list.push({ tag: name, color: c.color, position: Number(c.position ?? i) });
              }
            }
          } else if (typeof raw === 'object') {
            for (const [tag, val] of Object.entries(raw)) {
              if (val && (val as any).color) {
                list.push({ tag, color: (val as any).color, position: Number((val as any).position ?? 0) });
              }
            }
          }
        }
      }
      // Supplement via getColorByPosition if list is empty
      if (list.length === 0 && typeof z.Tags.getColorByPosition === 'function') {
        for (let pos = 0; pos < 9; pos++) {
          try {
            const c = z.Tags.getColorByPosition(libId, pos);
            const name = c?.name || c?.tag;
            if (name && c?.color) {
              list.push({ tag: name, color: c.color, position: pos });
            }
          } catch {}
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
      const zItem = await this.resolveZoteroItem(z, card.id);
      if (!zItem) return;

      if (typeof zItem.loadDataType === 'function') {
        try {
          await zItem.loadDataType('tags');
        } catch {}
      }

      const colorList = this.getNormalizedColorTags(zItem.libraryID);
      const existingTags: Array<{ tag: string } | string> = zItem.getTags?.() || [];
      const candidateTagsToRemove = new Set<string>([
        '#unread',
        '#reading',
        '#read',
        'unread',
        'reading',
        'read',
        '_unread',
        '_reading',
        '_read',
        '_to_read',
        '_toread',
        '/unread',
        '/reading',
        '/read'
      ]);
      for (const ct of colorList) {
        if (TagColorSync.isReadingStatusTag(ct.tag)) {
          candidateTagsToRemove.add(ct.tag);
        }
      }
      for (const et of existingTags) {
        const name = typeof et === 'string' ? et : et?.tag;
        if (name && TagColorSync.isReadingStatusTag(name)) {
          candidateTagsToRemove.add(name);
        }
      }

      for (const t of candidateTagsToRemove) {
        if (zItem.hasTag?.(t)) {
          zItem.removeTag?.(t);
        }
      }

      // Prefer user's configured colored tag for this status (e.g., _Read, _Reading, _To_Read, read, #read)
      const exactColorMatch = colorList.find((c) => c.tag.toLowerCase() === nextStatus);
      const hashColorMatch = colorList.find((c) => c.tag.toLowerCase() === `#${nextStatus}`);
      const variantColorMatch = colorList.find((c) => TagColorSync.matchesStatusVariant(c.tag, nextStatus));
      const matchedColorEntry = hashColorMatch || exactColorMatch || variantColorMatch;
      const tagToAdd = matchedColorEntry ? matchedColorEntry.tag : `#${nextStatus}`;

      zItem.addTag?.(tagToAdd, 0);
      card.readStatus = nextStatus;
      const removeLowerSet = new Set(Array.from(candidateTagsToRemove).map((t) => t.toLowerCase()));
      const nextTags = (card.tags || []).filter(
        (t) => !removeLowerSet.has(t.toLowerCase()) && !TagColorSync.isReadingStatusTag(t)
      );
      nextTags.push(tagToAdd);
      card.tags = nextTags;

      // Sync card.colorTags with the new reading status colored tag
      const nextColorTags = (card.colorTags || []).filter(
        (ct) => !removeLowerSet.has(ct.tag.toLowerCase()) && !TagColorSync.isReadingStatusTag(ct.tag)
      );
      if (matchedColorEntry) {
        nextColorTags.push({ tag: matchedColorEntry.tag, color: matchedColorEntry.color });
        const posMap = new Map(colorList.map((c) => [c.tag, c.position]));
        nextColorTags.sort((a, b) => (posMap.get(a.tag) ?? 99) - (posMap.get(b.tag) ?? 99));
      }
      card.colorTags = nextColorTags;

      const cardEl = this.getCardElement(card.id);
      if (cardEl) {
        updatePaperCardBadge(cardEl, nextStatus);
        updatePaperCardColorTags(cardEl, card.colorTags);
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

  public async toggleColorTag(
    cardOrCards: PaperCardData | PaperCardData[],
    position: number
  ): Promise<void> {
    const cards = Array.isArray(cardOrCards) ? cardOrCards : [cardOrCards];
    if (cards.length === 0) return;

    const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (!z?.Items || !z?.Tags) return;
    try {
      const resolvedPairs: Array<{ card: PaperCardData; zItem: any }> = [];
      for (const c of cards) {
        const zItem = await this.resolveZoteroItem(z, c.id);
        if (!zItem) continue;
        if (typeof zItem.loadDataType === 'function') {
          try {
            await zItem.loadDataType('tags');
          } catch {
            try {
              await zItem.loadAllData?.();
            } catch {}
          }
        }
        resolvedPairs.push({ card: c, zItem });
      }
      if (resolvedPairs.length === 0) return;

      const firstItem = resolvedPairs[0].zItem;
      const zp = this.win?.ZoteroPane || (typeof ZoteroPane !== 'undefined' ? ZoteroPane : null);
      const rawLibId = firstItem?.libraryID || zp?.getSelectedLibraryID?.() || z?.Libraries?.userLibraryID || 1;
      const libId = Number(rawLibId) > 0 ? Number(rawLibId) : 1;
      const rawColors = typeof z.Tags.getColors === 'function' ? z.Tags.getColors(libId) : null;
      const colorList = this.getNormalizedColorTags(libId);

      // Pre-load tags data type in batch to ensure hasTag() never throws in Zotero
      if (z?.Items?.loadDataTypes) {
        try {
          await z.Items.loadDataTypes(
            resolvedPairs.map((p) => p.zItem),
            ['tags', 'primaryData']
          );
        } catch {}
      }

      // Position 0: Zotero shortcut '0' removes all colored tags from the selected items
      if (position === 0) {
        const zItems = resolvedPairs.map((p) => p.zItem);
        if (typeof z.Tags.removeColoredTagsFromItems === 'function') {
          try {
            await z.Tags.removeColoredTagsFromItems(zItems);
          } catch {}
        }

        for (const { card, zItem } of resolvedPairs) {
          const toRemove = new Set<string>([
            ...(card.colorTags || []).map((c) => c.tag),
            ...colorList.map((c) => c.tag)
          ]);
          card.colorTags = [];
          for (const tagName of toRemove) {
            try {
              if (typeof zItem.hasTag === 'function' ? zItem.hasTag(tagName) : true) {
                zItem.removeTag?.(tagName);
              }
            } catch {
              try { zItem.removeTag?.(tagName); } catch {}
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
        }
        return;
      }

      // Resolve target color for shortcut key 1..9
      // Strategy 1: Native Zotero.Tags.getColorByPosition(libraryID, position - 1) (100% native parity)
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
        const isMapLike =
          rawColors && typeof rawColors.entries === 'function' && !Array.isArray(rawColors);
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

      // Native Zotero parity: if ANY selected item has targetTag, remove from all selected items; otherwise add to all
      const isRemoving = resolvedPairs.some(({ card, zItem }) => {
        let hadTagInZotero = false;
        try {
          if (typeof zItem.hasTag === 'function') {
            hadTagInZotero = zItem.hasTag(targetTag!);
          }
        } catch {}
        if (!hadTagInZotero) {
          const existingItemTags: Array<{ tag: string } | string> = zItem.getTags?.() || [];
          hadTagInZotero = existingItemTags.some(
            (t: any) => (typeof t === 'string' ? t : t?.tag) === targetTag
          );
        }
        const hadColorOnCard = (card.colorTags || []).some(
          (c) => c.tag === targetTag || (targetColorHex && c.color === targetColorHex)
        );
        return hadTagInZotero || hadColorOnCard;
      });

      // 1. Instant local in-memory & DOM reflection for 0ms visual feedback
      for (const { card, zItem } of resolvedPairs) {
        const existingItemTags: Array<{ tag: string } | string> = zItem.getTags?.() || [];

        if (!card.colorTags) card.colorTags = [];
        if (isRemoving) {
          card.colorTags = card.colorTags.filter(
            (c) => c.tag !== targetTag && (!targetColorHex || c.color !== targetColorHex)
          );
        } else {
          const hex = targetColorHex || '#ff0000';
          if (!card.colorTags.some((c) => c.tag === targetTag)) {
            card.colorTags.push({ tag: targetTag, color: hex });
          }
          const posMap = new Map(colorList.map((c) => [c.tag, c.position]));
          card.colorTags.sort((a, b) => (posMap.get(a.tag) ?? 99) - (posMap.get(b.tag) ?? 99));
        }

        // Compute updated tags to also keep readStatus badge and card.tags in sync
        const baseTagNames = Array.from(
          new Set([
            ...(card.tags || []),
            ...existingItemTags
              .map((t: any) => (typeof t === 'string' ? t : t?.tag))
              .filter(Boolean)
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
      }

      // 2. Persist to Zotero database with 100% native parity
      const zItems = resolvedPairs.map((p) => p.zItem);
      let nativeToggled = false;
      if (typeof z.Tags.toggleItemsListTags === 'function') {
        try {
          await z.Tags.toggleItemsListTags(zItems, targetTag);
          nativeToggled = true;
        } catch {}
      }

      if (!nativeToggled && typeof z.DB?.executeTransaction === 'function') {
        try {
          await z.DB.executeTransaction(async () => {
            try {
              if (z.UndoHistory?.stageAction) {
                z.UndoHistory.stageAction(
                  isRemoving ? 'undo-action-remove-tag' : 'undo-action-add-tag',
                  { count: zItems.length }
                );
              }
            } catch {}

            for (const item of zItems) {
              if (isRemoving) {
                item.removeTag?.(targetTag!);
              } else {
                item.addTag?.(targetTag!, 0);
              }
              if (typeof item.save === 'function') {
                await item.save();
              } else if (typeof item.saveTx === 'function') {
                await item.saveTx();
              }
            }
          });
        } catch {
          // Fallback if transaction fails
          for (const item of zItems) {
            try {
              if (isRemoving) item.removeTag?.(targetTag!);
              else item.addTag?.(targetTag!, 0);
              if (typeof item.saveTx === 'function') await item.saveTx();
              else if (typeof item.save === 'function') await item.save();
            } catch {}
          }
        }
      } else if (!nativeToggled) {
        // Fallback for tests/environments without Zotero.DB
        for (const item of zItems) {
          try {
            if (isRemoving) item.removeTag?.(targetTag!);
            else item.addTag?.(targetTag!, 0);
            if (typeof item.saveTx === 'function') await item.saveTx();
            else if (typeof item.save === 'function') await item.save();
          } catch {}
        }
      }
    } catch (err) {
      const z = this.win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
      z?.logError?.(err);
    }
  }
}
