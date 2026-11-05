import { PaperCardData, IThumbnailCacheManager } from '../types';
import { renderPdfThumbnail, generateTypographyFallbackCover } from './pdf-thumbnail-service';

declare const IOUtils: any;
declare const PathUtils: any;
declare const Zotero: any;

export class ThumbnailCacheManager implements IThumbnailCacheManager {
  private memoryCache = new Map<string, string>(); // key -> objectURL
  private lruKeys: string[] = [];
  private maxMemoryEntries = 150;
  private pendingRenders = new Map<string, Promise<string>>();
  private maxConcurrency = 3;
  private currentActive = 0;
  private taskQueue: Array<() => void> = [];

  constructor() {}

  public getCacheDirectory(): string {
    let profile = '/tmp/zotero';
    if (typeof Zotero !== 'undefined' && Zotero.Profile?.dir) {
      profile = Zotero.Profile.dir;
    } else if (typeof PathUtils !== 'undefined' && (PathUtils as any).profileDir) {
      profile = (PathUtils as any).profileDir;
    }
    return typeof PathUtils !== 'undefined' && typeof PathUtils.join === 'function'
      ? PathUtils.join(profile, 'cache', 'covergrid')
      : `${profile}/cache/covergrid`;
  }

  private async ensureCacheDirectory(): Promise<string> {
    const dir = this.getCacheDirectory();
    try {
      if (typeof IOUtils !== 'undefined') {
        await IOUtils.makeDirectory(dir, { ignoreExisting: true, createAncestors: true });
      }
    } catch {
      // Ignore directory creation failure if already exists
    }
    return dir;
  }

  private getDiskCachePath(cacheDir: string, key: string, mtime: string | number): string {
    const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeMtime = String(mtime).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeKey}_${safeMtime}.webp`;
    return typeof PathUtils !== 'undefined' && typeof PathUtils.join === 'function'
      ? PathUtils.join(cacheDir, filename)
      : `${cacheDir}/${filename}`;
  }

  private recordLruAccess(key: string, url: string) {
    this.memoryCache.set(key, url);
    const idx = this.lruKeys.indexOf(key);
    if (idx !== -1) {
      this.lruKeys.splice(idx, 1);
    }
    this.lruKeys.push(key);

    // Evict oldest if exceeding capacity
    if (this.lruKeys.length > this.maxMemoryEntries) {
      const oldestKey = this.lruKeys.shift();
      if (oldestKey) {
        const oldUrl = this.memoryCache.get(oldestKey);
        if (oldUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(oldUrl);
        }
        this.memoryCache.delete(oldestKey);
      }
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.currentActive++;
        try {
          const res = await task();
          resolve(res);
        } catch (err) {
          reject(err);
        } finally {
          this.currentActive--;
          if (this.taskQueue.length > 0) {
            const next = this.taskQueue.shift();
            next?.();
          }
        }
      };

      if (this.currentActive < this.maxConcurrency) {
        run();
      } else {
        this.taskQueue.push(run);
      }
    });
  }

  public async getThumbnail(item: any, attachment?: any, cardData?: Partial<PaperCardData>): Promise<string> {
    const key = item.key || String(item.id);
    const mtime = attachment?.mtime || attachment?.dateModified || item?.dateModified || 0;
    const cacheKey = `${key}_${mtime}`;

    // 1. Check in-memory cache
    if (this.memoryCache.has(cacheKey)) {
      const cached = this.memoryCache.get(cacheKey)!;
      this.recordLruAccess(cacheKey, cached);
      return cached;
    }

    // 2. Check deduplication for pending renders
    if (this.pendingRenders.has(cacheKey)) {
      return this.pendingRenders.get(cacheKey)!;
    }

    const renderPromise = this.enqueue(async () => {
      try {
        const cacheDir = await this.ensureCacheDirectory();
        const diskPath = this.getDiskCachePath(cacheDir, key, mtime);

        // 3. Check disk cache
        if (typeof IOUtils !== 'undefined') {
          const exists = await IOUtils.exists(diskPath);
          if (exists) {
            const bytes = await IOUtils.read(diskPath);
            const blob = new Blob([bytes], { type: 'image/webp' });
            const url = URL.createObjectURL(blob);
            this.recordLruAccess(cacheKey, url);
            return url;
          }
        }

        // 4. Render from PDF or Fallback
        let blob: Blob;
        let pdfPath: string | null = null;
        try {
          if (typeof attachment?.getFilePathAsync === 'function') {
            pdfPath = await attachment.getFilePathAsync();
          } else if (typeof attachment?.getFilePath === 'function') {
            pdfPath = attachment.getFilePath();
          } else if (attachment?.getFile) {
            pdfPath = attachment.getFile()?.path || null;
          }
        } catch {
          // Ignore path resolution error
        }

        const card: Partial<PaperCardData> = cardData || {
          title: item.getField?.('title') || item.title || 'Untitled',
          authorText: item.getCreators?.()?.[0]?.lastName || 'Author',
          year: item.getField?.('year') || '',
          itemType: item.itemType || 'journalArticle'
        };

        const isPdf = typeof attachment?.isPDFAttachment === 'function' ? attachment.isPDFAttachment() : (pdfPath && pdfPath.toLowerCase().endsWith('.pdf'));
        if (pdfPath && isPdf) {
          blob = await renderPdfThumbnail(pdfPath, card);
        } else {
          blob = await generateTypographyFallbackCover(card, 'No PDF Attached');
        }

        // 5. Save to disk cache
        if (typeof IOUtils !== 'undefined') {
          try {
            const arrayBuffer = await blob.arrayBuffer();
            await IOUtils.write(diskPath, new Uint8Array(arrayBuffer));
          } catch {
            // Non-critical write error
          }
        }

        // 6. Store in memory and return
        const url = URL.createObjectURL(blob);
        this.recordLruAccess(cacheKey, url);
        return url;
      } finally {
        this.pendingRenders.delete(cacheKey);
      }
    });

    this.pendingRenders.set(cacheKey, renderPromise);
    return renderPromise;
  }

  public async saveThumbnail(itemKey: string, blob: Blob): Promise<string> {
    const cacheDir = await this.ensureCacheDirectory();
    const diskPath = this.getDiskCachePath(cacheDir, itemKey, Date.now());
    if (typeof IOUtils !== 'undefined') {
      const arrayBuffer = await blob.arrayBuffer();
      await IOUtils.write(diskPath, new Uint8Array(arrayBuffer));
    }
    const url = URL.createObjectURL(blob);
    this.recordLruAccess(itemKey, url);
    return url;
  }

  public async refreshThumbnail(item: any, attachment?: any, cardData?: Partial<PaperCardData>): Promise<string> {
    const key = item.key || String(item.id);
    const mtime = attachment?.mtime || attachment?.dateModified || item?.dateModified || 0;
    const cacheKey = `${key}_${mtime}`;

    // Evict existing
    if (this.memoryCache.has(cacheKey)) {
      const oldUrl = this.memoryCache.get(cacheKey)!;
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(oldUrl);
      }
      this.memoryCache.delete(cacheKey);
    }

    const cacheDir = await this.ensureCacheDirectory();
    const diskPath = this.getDiskCachePath(cacheDir, key, mtime);
    if (typeof IOUtils !== 'undefined') {
      try {
        await IOUtils.remove(diskPath, { ignoreAbsent: true });
      } catch {
        // Ignore
      }
    }

    return this.getThumbnail(item, attachment, cardData);
  }

  public clearMemoryCache(): void {
    // Revoke memory URLs
    for (const url of this.memoryCache.values()) {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore
        }
      }
    }
    this.memoryCache.clear();
    this.lruKeys = [];
    this.pendingRenders.clear();
    this.taskQueue = [];
  }

  public async clearCache(): Promise<void> {
    this.clearMemoryCache();

    // Clear disk cache directory
    const dir = this.getCacheDirectory();
    if (typeof IOUtils !== 'undefined') {
      try {
        await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
      } catch {
        // Ignore
      }
    }
  }

  public getMemoryCacheSize(): number {
    return this.memoryCache.size;
  }
}

export const thumbnailCacheManager = new ThumbnailCacheManager();
