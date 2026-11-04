import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThumbnailCacheManager } from '../src/services/cache-manager';

describe('ThumbnailCacheManager', () => {
  let cacheManager: ThumbnailCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheManager = new ThumbnailCacheManager();
  });

  it('should return cached object URL on memory cache hit', async () => {
    const item = { id: 101, key: 'ITEM101', title: 'Test Paper' };
    const attachment = { id: 201, mtime: 12345, isPDFAttachment: () => true, path: '/fake.pdf' };

    const firstUrl = await cacheManager.getThumbnail(item, attachment);
    expect(firstUrl).toBeDefined();

    // Second call should return immediately from memory without reading disk again
    const secondUrl = await cacheManager.getThumbnail(item, attachment);
    expect(secondUrl).toBe(firstUrl);
    expect(cacheManager.getMemoryCacheSize()).toBe(1);
  });

  it('should invalidate cache and revoke URL on refreshThumbnail', async () => {
    const item = { id: 102, key: 'ITEM102', title: 'Paper 2' };
    const attachment = { id: 202, mtime: 99999, isPDFAttachment: () => true, path: '/fake2.pdf' };

    const url1 = await cacheManager.getThumbnail(item, attachment);
    expect(url1).toBeDefined();

    await cacheManager.refreshThumbnail(item, attachment);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url1);
  });

  it('should clear all cached items and revoke URLs on clearCache', async () => {
    const item1 = { id: 1, key: 'K1' };
    const item2 = { id: 2, key: 'K2' };

    await cacheManager.getThumbnail(item1);
    await cacheManager.getThumbnail(item2);
    expect(cacheManager.getMemoryCacheSize()).toBe(2);

    await cacheManager.clearCache();
    expect(cacheManager.getMemoryCacheSize()).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
