export type ReadStatus = 'unread' | 'reading' | 'read';

export interface Creator {
  firstName?: string;
  lastName?: string;
  name?: string;
  creatorType?: string;
}

export interface PaperCardData {
  id: number;
  key: string;
  title: string;
  authorText: string;     // e.g. "Kim et al. (2026)" (APA 7 표준)
  citationText: string;   // e.g. "APA 7 · Journal Article"
  itemType: string;
  year: string;
  publicationTitle?: string;
  notePreview?: string;
  readStatus: ReadStatus;
  hasPdf: boolean;
  bestAttachmentId?: number;
  coverThumbnailUrl?: string;
  tags?: string[];
  colorTags?: Array<{ tag: string; color: string }>; // Zotero 순정 컬러 태그 (도트용)
}

export interface ThumbnailRenderOptions {
  scale?: number;          // Default: 1.5 (Retina 선명도)
  quality?: number;        // Default: 0.85 (WebP)
  targetPage?: number;     // 1 or 2
  detectPublisherSplash?: boolean;
}

export interface IThumbnailCacheManager {
  getThumbnail(item: any): Promise<string>;
  saveThumbnail(itemKey: string, blob: Blob): Promise<string>;
  clearCache(): Promise<void>;
  refreshThumbnail(item: any): Promise<string>;
}
