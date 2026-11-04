import { injectCoverGridUI, cleanupCoverGridUI } from './ui/index';

declare const Services: any;
declare const Ci: any;

let windowListener: any = null;

async function initWindow(win: any) {
  if (win.location?.href !== 'chrome://zotero/content/standalone/zoteroPane.xhtml') {
    return;
  }
  if (win.ZoteroPane?.loadedPromise) {
    await win.ZoteroPane.loadedPromise;
  } else {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (win.ZoteroPane?.loadedPromise) {
          win.ZoteroPane.loadedPromise.then(() => resolve());
        } else {
          win.setTimeout(check, 10);
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
  const windows = Services.wm.getEnumerator('navigator:browser');
  while (windows.hasMoreElements()) {
    initWindow(windows.getNext());
  }

  windowListener = {
    onOpenWindow(xulWin: any) {
      const domWin = xulWin.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
      if (domWin.document.readyState === 'complete') {
        initWindow(domWin);
      } else {
        domWin.addEventListener('DOMContentLoaded', () => initWindow(domWin), { once: true });
      }
    },
    onCloseWindow() {},
    onWindowTitleChange() {}
  };
  Services.wm.addListener(windowListener);
}

export function shutdown(data: any, reason: number) {
  if (windowListener) {
    Services.wm.removeListener(windowListener);
    windowListener = null;
  }
  const windows = Services.wm.getEnumerator('navigator:browser');
  while (windows.hasMoreElements()) {
    destroyWindow(windows.getNext());
  }
}

export function install() {}
export function uninstall() {}
