declare const Services: any;
declare const Ci: any;
declare const Zotero: any;
declare const ZoteroPane: any;
declare const ChromeUtils: {
  importESModule(url: string): any;
};
declare const IOUtils: {
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  makeDirectory(path: string, options?: { ignoreExisting?: boolean; createAncestors?: boolean }): Promise<void>;
  remove(path: string, options?: { ignoreAbsent?: boolean; recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ size: number; mtime: number }>;
};
declare const PathUtils: {
  join(...parts: string[]): string;
  profileDir: string;
};

interface ZoteroItemAttachment {
  id: number;
  isPDFAttachment?: () => boolean;
  contentType?: string;
  url?: string;
  [key: string]: any;
}

interface ZoteroItem {
  id: number;
  key?: string;
  isRegularItem?: () => boolean;
  isAttachment?: () => boolean;
  isNote?: () => boolean;
  isAnnotation?: () => boolean;
  getBestAttachment: () => Promise<ZoteroItemAttachment | null>;
  getField?: (field: string) => string;
  getCreators?: () => Array<{ firstName?: string; lastName?: string }>;
  getTags?: () => Array<{ tag: string }>;
  hasTag?: (tag: string) => boolean;
  addTag?: (tag: string) => void;
  removeTag?: (tag: string) => void;
  saveTx?: () => Promise<void>;
  [key: string]: any;
}

interface ZoteroItemsViewRefreshListener {
  addListener: (listener: () => void | Promise<void>) => void;
  removeListener: (listener: () => void | Promise<void>) => void;
}

interface ZoteroItemsView {
  onRefresh?: ZoteroItemsViewRefreshListener;
  getSortedItems?: () => any[];
  selectItem?: (id: number) => void;
  rowProvider?: {
    items?: any[];
    [key: string]: any;
  };
  [key: string]: any;
}

interface ZoteroPaneType {
  itemsView?: ZoteroItemsView;
  getSortedItems?: () => any[];
  getUnfilteredItems?: () => Promise<any[]>;
  viewItems?: (items: any[] | number[]) => Promise<void> | void;
  openAttachment?: (id: number) => void;
  deleteSelectedItems?: () => void;
  getSelectedCollection?: () => { name: string } | null;
  [key: string]: any;
}

declare module '*.css' {
  const content: string;
  export default content;
}
