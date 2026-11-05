import { vi } from 'vitest';

const g = globalThis as any;

g.Services = {
  wm: {
    getEnumerator: vi.fn(() => ({
      hasMoreElements: vi.fn(() => false),
      getNext: vi.fn()
    })),
    addListener: vi.fn(),
    removeListener: vi.fn()
  }
};

g.Ci = {
  nsIInterfaceRequestor: {},
  nsIDOMWindow: {}
};

g.IOUtils = {
  read: vi.fn().mockResolvedValue(new Uint8Array([0, 1, 2, 3])),
  write: vi.fn().mockResolvedValue(undefined),
  makeDirectory: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(true),
  stat: vi.fn().mockResolvedValue({ size: 1024, mtime: 123456789 })
};

g.PathUtils = {
  join: (...args: string[]) => args.join('/'),
  profileDir: '/mock/zotero/profile'
};

g.ChromeUtils = {
  importESModule: vi.fn((url: string) => {
    if (url.includes('pdf.mjs')) {
      const mockPage = {
        rotate: 0,
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
        getViewport: vi.fn(({ scale }: any) => ({ width: 600 * (scale || 1), height: 800 * (scale || 1) }))
      };
      const mockDoc = {
        numPages: 10,
        getPage: vi.fn().mockResolvedValue(mockPage),
        destroy: vi.fn().mockResolvedValue(undefined)
      };
      return Promise.resolve({
        getDocument: vi.fn(() => ({
          promise: Promise.resolve(mockDoc)
        }))
      });
    }
    return Promise.resolve({});
  })
};

g.Zotero_Tabs = {
  _tabs: [{ id: 'zotero-pane', type: 'library', title: 'My Library' }],
  add: vi.fn(({ id, type, title, onClose }: any) => {
    const container = document.createElement('div');
    container.id = id;
    const tab = { id, type, title, onClose };
    g.Zotero_Tabs._tabs.push(tab);
    return { id, container };
  }),
  select: vi.fn((id: string) => {
    g.Zotero_Tabs._selectedID = id;
  }),
  close: vi.fn((id: string) => {
    g.Zotero_Tabs._tabs = g.Zotero_Tabs._tabs.filter((t: any) => t.id !== id);
  })
};

g.ZoteroPane = {
  loadedPromise: Promise.resolve(),
  openAttachment: vi.fn(),
  deleteSelectedItems: vi.fn(),
  getSelectedItems: vi.fn(() => []),
  itemsView: { rowProvider: { items: [], onUpdate: { addListener: vi.fn() } } }
};

g.Zotero = {
  Reader: { open: vi.fn().mockResolvedValue(undefined) },
  Prefs: {
    get: vi.fn((pref: string) => (pref.includes('openPDFIn') ? 'tab' : false)),
    set: vi.fn()
  },
  Items: {
    get: vi.fn((id: number) => ({
      id,
      key: `MOCK_KEY_${id}`,
      getBestAttachment: vi.fn().mockResolvedValue({ id: 999, isPDFAttachment: () => true })
    }))
  },
  ItemFields: { getName: vi.fn((type: string) => type) },
  Notifier: {
    registerObserver: vi.fn(() => 'observer-id'),
    unregisterObserver: vi.fn()
  },
  PreferencePanes: {
    pluginPanes: [],
    register: vi.fn().mockResolvedValue('pane-id'),
    unregister: vi.fn()
  },
  Utilities: { cleanAuthor: vi.fn((author: string) => author) }
};

if (!g.ResizeObserver) {
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!g.OffscreenCanvas) {
  g.OffscreenCanvas = class {
    width: number;
    height: number;
    constructor(w: number, h: number) { this.width = w; this.height = h; }
    getContext() {
      return {
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        strokeRect: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 50 }))
      };
    }
    convertToBlob(options?: any) {
      return Promise.resolve(new Blob(['mock-webp'], { type: options?.type || 'image/webp' }));
    }
  };
}

Element.prototype.scrollIntoView = vi.fn();

URL.createObjectURL = vi.fn(() => 'blob:mock-url');
URL.revokeObjectURL = vi.fn();

