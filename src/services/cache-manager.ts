import { PaperCardData, IThumbnailCacheManager } from '../types';
import {
  renderPdfThumbnail,
  renderPdfPage,
  getPdfPageInfo,
  evictPdfSession,
  clearPdfSessionPool,
  generateTypographyFallbackCover
} from './pdf-thumbnail-service';

declare const IOUtils: any;
declare const PathUtils: any;
declare const Zotero: any;

export interface PdfPageRenderResult {
  url: string;
  totalPages: number;
  actualPageNumber: number;
}

export class ThumbnailCacheManager implements IThumbnailCacheManager {
  private memoryCache = new Map<string, string>(); // Page 1 cover cacheKey -> objectURL
  private lruKeys: string[] = [];
  private maxMemoryEntries = 150;
  private pageMemoryCache = new Map<string, string>(); // Page > 1 `${cacheKey}_p${n}` -> objectURL
  private pageLruKeys: string[] = [];
  private maxPageMemoryEntries = 40;
  private pendingRenders = new Map<string, Promise<string>>();
  private pendingPageRenders = new Map<string, Promise<PdfPageRenderResult>>();
  private pageCountMap = new Map<string, { totalPages: number; pageOffset: number }>();
  private revokedUrls = new Set<string>();
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
    const filename = `${safeKey}_${safeMtime}_v6.webp`;
    return typeof PathUtils !== 'undefined' && typeof PathUtils.join === 'function'
      ? PathUtils.join(cacheDir, filename)
      : `${cacheDir}/${filename}`;
  }

  private revokeUrlSafe(url: string | undefined): void {
    if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(url);
        this.revokedUrls.add(url);
        if (this.revokedUrls.size > 500) {
          const oldest = this.revokedUrls.values().next().value;
          if (oldest) this.revokedUrls.delete(oldest);
        }
      } catch {}
    }
  }

  private recordLruEntry(
    cache: Map<string, string>,
    lru: string[],
    maxEntries: number,
    key: string,
    url: string
  ): void {
    this.revokedUrls.delete(url);
    cache.set(key, url);
    const idx = lru.indexOf(key);
    if (idx !== -1) {
      lru.splice(idx, 1);
    }
    lru.push(key);

    if (lru.length > maxEntries) {
      const oldestKey = lru.shift();
      if (oldestKey) {
        this.revokeUrlSafe(cache.get(oldestKey));
        cache.delete(oldestKey);
      }
    }
  }

  private recordLruAccess(key: string, url: string) {
    this.recordLruEntry(this.memoryCache, this.lruKeys, this.maxMemoryEntries, key, url);
  }

  private recordPageLruAccess(key: string, url: string) {
    this.recordLruEntry(this.pageMemoryCache, this.pageLruKeys, this.maxPageMemoryEntries, key, url);
  }

  private evictMatchingEntries(
    cache: Map<string, string>,
    lru: string[],
    predicate: (entryKey: string) => boolean
  ): void {
    for (const entryKey of Array.from(cache.keys())) {
      if (!predicate(entryKey)) continue;
      this.revokeUrlSafe(cache.get(entryKey));
      cache.delete(entryKey);
      const lruIdx = lru.indexOf(entryKey);
      if (lruIdx !== -1) {
        lru.splice(lruIdx, 1);
      }
    }
  }

  public isUrlRevoked(url: string | undefined): boolean {
    return Boolean(url && this.revokedUrls.has(url));
  }

  public isCachedCoverUrlLive(url: string): boolean {
    return !this.isUrlRevoked(url);
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

  private getCacheIdentity(item: any, attachment?: any) {
    const key = item.key || String(item.id);
    const mtime = attachment?.mtime || attachment?.dateModified || item?.dateModified || 0;
    const cacheKey = `${key}_${mtime}`;
    return { key, mtime, cacheKey };
  }

  private buildFallbackCardData(item: any, cardData?: Partial<PaperCardData>): Partial<PaperCardData> {
    if (cardData) return cardData;
    let title = 'Untitled';
    let authorText = 'Author';
    let year = '';
    try {
      title = item.getField?.('title') || item.title || 'Untitled';
    } catch {}
    try {
      authorText = item.getCreators?.()?.[0]?.lastName || 'Author';
    } catch {}
    try {
      const d = item.getField?.('date') || item.year || '';
      const m = String(d).match(/\b(19|20)\d{2}\b/);
      year = m ? m[0] : String(d);
    } catch {}
    return {
      title,
      authorText,
      year,
      itemType: item.itemType || 'journalArticle'
    };
  }

  private async resolvePdfPathFromAttachment(
    attachment: any
  ): Promise<{ pdfPath: string | null; isPdf: boolean }> {
    let pdfPath: string | null = null;
    try {
      if (typeof attachment?.getFilePathAsync === 'function') {
        pdfPath = await attachment.getFilePathAsync();
      } else if (typeof attachment?.getFilePath === 'function') {
        pdfPath = attachment.getFilePath();
      } else if (attachment?.getFile) {
        pdfPath = attachment.getFile()?.path || null;
      } else if (typeof attachment?.path === 'string') {
        pdfPath = attachment.path;
      }
    } catch {
      // Ignore path resolution error
    }

    let filenameOrPath = '';
    try {
      filenameOrPath = String(
        pdfPath ||
          attachment?.attachmentFilename ||
          attachment?.attachmentPath ||
          ''
      ).toLowerCase();
    } catch {
      filenameOrPath = String(pdfPath || '').toLowerCase();
    }
    const contentType = String(attachment?.attachmentContentType || '').toLowerCase();
    const isExplicitNonPdf =
      Boolean(
        attachment?.isSnapshotAttachment?.() ||
          attachment?.isEPUBAttachment?.() ||
          attachment?.isImageAttachment?.() ||
          attachment?.isVideoAttachment?.()
      ) ||
      contentType.includes('html') ||
      contentType.includes('epub') ||
      contentType.startsWith('image/') ||
      contentType.startsWith('video/') ||
      /\.(html?|epub|png|jpe?g|gif|webp|svg|mp4|mov|docx?|xlsx?|pptx?|txt|md|csv|zip)$/i.test(filenameOrPath);

    const isPdf = Boolean(
      attachment?.isPDFAttachment?.() ||
        contentType.includes('pdf') ||
        filenameOrPath.endsWith('.pdf') ||
        (pdfPath && !isExplicitNonPdf)
    );

    return { pdfPath, isPdf };
  }

  public async getPdfPageCount(
    item: any,
    attachment?: any
  ): Promise<{ totalPages: number; pageOffset: number }> {
    const { cacheKey } = this.getCacheIdentity(item, attachment);
    const cached = this.pageCountMap.get(cacheKey);
    if (cached && cached.totalPages > 0) {
      return cached;
    }

    const { pdfPath, isPdf } = await this.resolvePdfPathFromAttachment(attachment);
    if (!pdfPath || !isPdf) {
      return { totalPages: 0, pageOffset: 0 };
    }

    const info = await getPdfPageInfo(pdfPath);
    if (info.totalPages > 0) {
      this.pageCountMap.set(cacheKey, info);
    }
    return info;
  }

  public async getThumbnail(item: any, attachment?: any, cardData?: Partial<PaperCardData>): Promise<string> {
    const { key, mtime, cacheKey } = this.getCacheIdentity(item, attachment);

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
        const { pdfPath, isPdf } = await this.resolvePdfPathFromAttachment(attachment);
        const card = this.buildFallbackCardData(item, cardData);

        if (pdfPath && isPdf) {
          blob = await renderPdfThumbnail(pdfPath, card);
        } else {
          blob = await generateTypographyFallbackCover(card, 'No PDF Attached');
        }

        // 5. Save to disk cache (skip persisting temporary fallback covers so transient failures can self-heal)
        if (typeof IOUtils !== 'undefined' && !(blob as any)?.__isFallbackCover) {
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

  public async getPageThumbnail(
    item: any,
    attachment: any,
    logicalPage: number,
    cardData?: Partial<PaperCardData>
  ): Promise<PdfPageRenderResult> {
    if (logicalPage <= 1) {
      const [url, info] = await Promise.all([
        this.getThumbnail(item, attachment, cardData),
        this.getPdfPageCount(item, attachment)
      ]);
      return {
        url,
        totalPages: info.totalPages,
        actualPageNumber: 1 + info.pageOffset
      };
    }

    const { cacheKey } = this.getCacheIdentity(item, attachment);
    const pageCacheKey = `${cacheKey}_p${logicalPage}`;
    const existingUrl = this.pageMemoryCache.get(pageCacheKey);
    const cachedInfo = this.pageCountMap.get(cacheKey);
    if (existingUrl && cachedInfo && cachedInfo.totalPages > 0) {
      this.recordPageLruAccess(pageCacheKey, existingUrl);
      const clampedLogical = Math.min(cachedInfo.totalPages, Math.max(1, Math.floor(logicalPage)));
      return {
        url: existingUrl,
        totalPages: cachedInfo.totalPages,
        actualPageNumber: clampedLogical + cachedInfo.pageOffset
      };
    }

    const inflight = this.pendingPageRenders.get(pageCacheKey);
    if (inflight) {
      return inflight;
    }

    const renderPromise = this.enqueue(async () => {
      try {
        const { pdfPath, isPdf } = await this.resolvePdfPathFromAttachment(attachment);
        const card = this.buildFallbackCardData(item, cardData);
        if (!pdfPath || !isPdf) {
          const fallbackUrl = await this.getThumbnail(item, attachment, cardData);
          return { url: fallbackUrl, totalPages: 0, actualPageNumber: 1 };
        }

        const res = await renderPdfPage(pdfPath, logicalPage, { cardData: card });
        const url = URL.createObjectURL(res.blob);
        // Never persist page > 1 to disk; keep only in dedicated LRU memory cache
        this.recordPageLruAccess(pageCacheKey, url);
        if (res.totalPages > 0) {
          const clampedLogical = Math.min(res.totalPages, Math.max(1, Math.floor(logicalPage || 1)));
          const existingOffset =
            this.pageCountMap.get(cacheKey)?.pageOffset ??
            Math.max(0, res.actualPageNumber - clampedLogical);
          this.pageCountMap.set(cacheKey, { totalPages: res.totalPages, pageOffset: existingOffset });
        }
        return {
          url,
          totalPages: res.totalPages,
          actualPageNumber: res.actualPageNumber
        };
      } finally {
        this.pendingPageRenders.delete(pageCacheKey);
      }
    });

    this.pendingPageRenders.set(pageCacheKey, renderPromise);
    return renderPromise;
  }

  public async renderHighResPage(
    item: any,
    attachment: any,
    logicalPage: number,
    cardData?: Partial<PaperCardData>
  ): Promise<PdfPageRenderResult | null> {
    const { pdfPath, isPdf } = await this.resolvePdfPathFromAttachment(attachment);
    if (!pdfPath || !isPdf) {
      return null;
    }

    const { cacheKey } = this.getCacheIdentity(item, attachment);
    const card = this.buildFallbackCardData(item, cardData);
    const res = await renderPdfPage(pdfPath, logicalPage, {
      maxWidth: 1440,
      maxHeight: 1920,
      maxScale: 2.5,
      cardData: card
    });
    if (res.totalPages > 0) {
      const clampedLogical = Math.min(res.totalPages, Math.max(1, Math.floor(logicalPage || 1)));
      this.pageCountMap.set(cacheKey, {
        totalPages: res.totalPages,
        pageOffset: Math.max(0, res.actualPageNumber - clampedLogical)
      });
    }
    const url = URL.createObjectURL(res.blob);
    return {
      url,
      totalPages: res.totalPages,
      actualPageNumber: res.actualPageNumber
    };
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
    const { key, mtime, cacheKey } = this.getCacheIdentity(item, attachment);

    // Evict existing page 1, page preview variants, and active PDF session
    this.pageCountMap.delete(cacheKey);
    this.pendingRenders.delete(cacheKey);
    for (const pKey of Array.from(this.pendingPageRenders.keys())) {
      if (pKey.startsWith(`${cacheKey}_p`)) {
        this.pendingPageRenders.delete(pKey);
      }
    }
    this.evictMatchingEntries(this.memoryCache, this.lruKeys, (memKey) => memKey === cacheKey);
    this.evictMatchingEntries(this.pageMemoryCache, this.pageLruKeys, (memKey) =>
      memKey.startsWith(`${cacheKey}_p`)
    );

    if (attachment) {
      const { pdfPath } = await this.resolvePdfPathFromAttachment(attachment);
      if (pdfPath) {
        await evictPdfSession(pdfPath);
      }
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
      this.revokeUrlSafe(url);
    }
    for (const url of this.pageMemoryCache.values()) {
      this.revokeUrlSafe(url);
    }
    this.memoryCache.clear();
    this.lruKeys = [];
    this.pageMemoryCache.clear();
    this.pageLruKeys = [];
    this.pendingRenders.clear();
    this.pendingPageRenders.clear();
    this.pageCountMap.clear();
    this.taskQueue = [];
    void clearPdfSessionPool();
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

  public async deleteThumbnail(key: string, mtime: string | number): Promise<void> {
    const cacheKeyPrefix = `${key}_${mtime}`;
    const itemPrefix = `${key}_`;
    const matchesTarget = (entryKey: string) =>
      entryKey === key || entryKey === cacheKeyPrefix || entryKey.startsWith(itemPrefix);

    this.evictMatchingEntries(this.memoryCache, this.lruKeys, matchesTarget);
    this.evictMatchingEntries(this.pageMemoryCache, this.pageLruKeys, matchesTarget);
    for (const pKey of Array.from(this.pageCountMap.keys())) {
      if (matchesTarget(pKey)) {
        this.pageCountMap.delete(pKey);
      }
    }

    const dir = this.getCacheDirectory();
    const diskPath = this.getDiskCachePath(dir, key, mtime);
    if (typeof IOUtils !== 'undefined') {
      try {
        await IOUtils.remove(diskPath, { ignoreAbsent: true });
      } catch {}
    }
  }

  public getMemoryCacheSize(): number {
    return this.memoryCache.size;
  }
}

export const thumbnailCacheManager = new ThumbnailCacheManager();
