import { injectCoverGridUI, cleanupCoverGridUI } from './ui/index';

declare const Services: any;
declare const Ci: any;
declare const Zotero: any;

let windowListener: any = null;

async function initWindow(win: any) {
  if (!win?.location?.href?.includes('zoteroPane.xhtml')) {
    return;
  }
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

  injectCoverGridUI(win);
}

function destroyWindow(win: any) {
  cleanupCoverGridUI(win);
}

export function startup({ id, version, rootURI }: any, reason: number) {
  // Register Preference Pane in Zotero Settings (Cmd + ,)
  if (typeof Zotero !== 'undefined' && Zotero.PreferencePanes?.register) {
    try {
      Zotero.PreferencePanes.register({
        pluginID: id || 'zotero-cover-grid@antigravity.user',
        src: (rootURI || '') + 'preferences.xhtml',
        label: 'Cover Grid',
        image: (rootURI || '') + 'icons/icon-48.png'
      });
    } catch (e) {
      // Ignore registration error
    }
  }

  // Enumerate currently open windows
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
  if (windowListener && typeof Services !== 'undefined' && Services.wm) {
    Services.wm.removeListener(windowListener);
    windowListener = null;
  }
  if (typeof Services !== 'undefined' && Services.wm) {
    const windows = Services.wm.getEnumerator('navigator:browser');
    while (windows.hasMoreElements()) {
      destroyWindow(windows.getNext());
    }
  }
}

export function install() {}
export function uninstall() {}
