import { injectCoverGridUI, cleanupCoverGridUI } from './ui/index';
import { thumbnailCacheManager } from './services/cache-manager';

declare const Cc: any;
declare const Ci: any;
declare const Services: any;
declare const Zotero: any;

let windowListener: any = null;
const PREF_PANE_ID = 'zotero-cover-grid-preferences-pane';

/**
 * Patch Zotero.File.getContentsFromURL to gracefully handle jar: URIs containing '@'
 * in their authority/path without throwing NS_ERROR_MALFORMED_URI in XMLHttpRequest.
 */
function patchFileGetContentsIfNeeded() {
  if (typeof Zotero === 'undefined' || !Zotero.File || (Zotero.File as any).__coverGridPatched) {
    return;
  }
  const orig = Zotero.File.getContentsFromURL;
  Zotero.File.getContentsFromURL = function (url: string) {
    try {
      return orig.call(this, url);
    } catch (e) {
      if (typeof Services !== 'undefined' && Services.io && typeof Cc !== 'undefined' && typeof Ci !== 'undefined') {
        try {
          const uri = Services.io.newURI(url);
          const channel = Services.io.newChannelFromURI(
            uri,
            null,
            Services.scriptSecurityManager.getSystemPrincipal(),
            null,
            Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
            Ci.nsIContentPolicy.TYPE_OTHER
          );
          const inputStream = channel.open();
          const cstream = Cc['@mozilla.org/intl/converter-input-stream;1'].createInstance(
            Ci.nsIConverterInputStream
          );
          cstream.init(inputStream, 'UTF-8', 1024, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
          const str = {};
          let result = '';
          while (cstream.readString(4096, str) !== 0) {
            result += (str as any).value;
          }
          cstream.close();
          return result;
        } catch {
          // Re-throw original error if fallback fails
        }
      }
      throw e;
    }
  };
  (Zotero.File as any).__coverGridPatched = true;
}

async function initWindow(win: any) {
  if (!win?.location?.href?.includes('zoteroPane.xhtml')) {
    return;
  }
  if (win.__zoteroCoverGridInitializing || win.__zoteroCoverGridInstance) {
    return;
  }
  win.__zoteroCoverGridInitializing = true;
  try {
    if (win.ZoteroPane?.loadedPromise) {
      await win.ZoteroPane.loadedPromise;
    } else {
      await new Promise<void>((resolve) => {
        let attempts = 0;
        const check = () => {
          if (win.ZoteroPane?.loadedPromise) {
            win.ZoteroPane.loadedPromise.then(() => resolve());
          } else if (attempts++ > 100) {
            resolve();
          } else {
            win.setTimeout(check, 20);
          }
        };
        check();
      });
    }

    // Ensure white tab cover overlay is hidden and deck index is valid
    const doc = win.document;
    if (doc) {
      const tabCover = doc.getElementById('zotero-tab-cover');
      if (tabCover && !tabCover.classList.contains('hidden')) {
        tabCover.classList.add('hidden');
      }
      const tabsDeck = doc.getElementById('tabs-deck');
      if (tabsDeck && (tabsDeck.selectedIndex === -1 || tabsDeck.selectedIndex === undefined)) {
        tabsDeck.selectedIndex = 0;
      }
    }

    // Clean any leftover elements from earlier loads before injecting
    cleanupCoverGridUI(win);
    injectCoverGridUI(win);
  } finally {
    win.__zoteroCoverGridInitializing = false;
  }
}

function destroyWindow(win: any) {
  cleanupCoverGridUI(win);
}

export function startup({ id, version, rootURI }: any, reason: number) {
  const pluginID = id || 'zotero-cover-grid@antigravity.user';

  // Safeguard synchronous file reading for preference pane
  patchFileGetContentsIfNeeded();

  // 1. Clean up duplicate preference panes from previous installs and register a single pane
  if (typeof Zotero !== 'undefined' && Zotero.PreferencePanes) {
    try {
      if (Array.isArray(Zotero.PreferencePanes.pluginPanes)) {
        Zotero.PreferencePanes.pluginPanes = Zotero.PreferencePanes.pluginPanes.filter(
          (p: any) => p.pluginID !== pluginID && p.id !== PREF_PANE_ID
        );
      }
      const cleanRoot = rootURI ? (rootURI.endsWith('/') ? rootURI : `${rootURI}/`) : '';
      Zotero.PreferencePanes.register({
        id: PREF_PANE_ID,
        pluginID: pluginID,
        src: `${cleanRoot}preferences.xhtml`,
        label: 'Cover Grid',
        image: `${cleanRoot}icons/icon-48.png`
      });
    } catch {
      // Ignore registration error
    }
  }

  // 2. Enumerate currently open windows
  if (typeof Services !== 'undefined' && Services.wm) {
    const windows = Services.wm.getEnumerator('navigator:browser');
    while (windows.hasMoreElements()) {
      const win = windows.getNext();
      if (win.document?.readyState === 'complete') {
        initWindow(win);
      } else if (win.addEventListener) {
        win.addEventListener('DOMContentLoaded', () => initWindow(win), { once: true });
      }
    }

    windowListener = {
      onOpenWindow(xulWin: any) {
        try {
          const domWin = xulWin.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
          if (domWin.document?.readyState === 'complete') {
            initWindow(domWin);
          } else if (domWin.addEventListener) {
            domWin.addEventListener('DOMContentLoaded', () => initWindow(domWin), { once: true });
          }
        } catch {
          // Ignore
        }
      },
      onCloseWindow() {},
      onWindowTitleChange() {}
    };
    Services.wm.addListener(windowListener);
  }
}

export function onMainWindowLoad({ window }: any) {
  if (window) {
    initWindow(window);
  }
}

export function onMainWindowUnload({ window }: any) {
  if (window) {
    destroyWindow(window);
  }
}

export function shutdown(data: any, reason: number) {
  // 1. Revoke in-memory blob URLs
  thumbnailCacheManager.clearMemoryCache();

  // 2. Unregister Preference Pane
  if (typeof Zotero !== 'undefined' && Zotero.PreferencePanes?.unregister) {
    try {
      Zotero.PreferencePanes.unregister(PREF_PANE_ID);
    } catch {
      // Ignore
    }
  }

  // 3. Remove window listener
  if (windowListener && typeof Services !== 'undefined' && Services.wm) {
    Services.wm.removeListener(windowListener);
    windowListener = null;
  }

  // 4. Clean all browser windows
  if (typeof Services !== 'undefined' && Services.wm) {
    const windows = Services.wm.getEnumerator('navigator:browser');
    while (windows.hasMoreElements()) {
      destroyWindow(windows.getNext());
    }
  }
}

export function install() {}
export function uninstall() {}
