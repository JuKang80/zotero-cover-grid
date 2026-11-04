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
