import { injectCoverGridUI, cleanupCoverGridUI, ensureMainWindowStability } from './ui/index';
import { thumbnailCacheManager } from './services/cache-manager';

declare const Cc: any;
declare const Ci: any;
declare const Services: any;
declare const Zotero: any;

let windowListener: any = null;
const PREF_PANE_ID = 'zotero-cover-grid-preferences-pane';
let origGetContents: ((url: string) => string) | null = null;
let reloadWatcherTimer: any = null;
let lastTriggerMtime = 0;

/**
 * Watcher for external reload triggers (e.g. from CLI or remote device via /tmp/zotero-cover-grid-reload.trigger)
 */
function startReloadWatcher(pluginID: string) {
  if (reloadWatcherTimer) {
    clearInterval(reloadWatcherTimer);
    reloadWatcherTimer = null;
  }

  const triggerPath = '/tmp/zotero-cover-grid-reload.trigger';

  // Initialize lastTriggerMtime to the current file mtime on startup so we don't enter an infinite reload loop!
  try {
    if (typeof (globalThis as any).IOUtils !== 'undefined') {
      const IOUtils = (globalThis as any).IOUtils;
      IOUtils.exists(triggerPath).then((exists: boolean) => {
        if (exists) {
          return IOUtils.stat(triggerPath).then((stat: any) => {
            if (lastTriggerMtime === 0 && stat?.lastModified) {
              lastTriggerMtime = stat.lastModified;
            }
          });
        }
      }).catch(() => {});
    }
  } catch {}

  reloadWatcherTimer = setInterval(async () => {
    try {
      if (typeof (globalThis as any).IOUtils !== 'undefined') {
        const IOUtils = (globalThis as any).IOUtils;
        if (await IOUtils.exists(triggerPath)) {
          const stat = await IOUtils.stat(triggerPath);
          if (lastTriggerMtime === 0) {
            lastTriggerMtime = stat.lastModified;
            return;
          }
          if (stat.lastModified > lastTriggerMtime) {
            lastTriggerMtime = stat.lastModified;
            if (typeof Zotero !== 'undefined') {
              Zotero.debug('[CoverGrid] External reload trigger detected. Hot reloading...');
            }
            if (typeof Services !== 'undefined') {
              try {
                Services.obs?.notifyObservers(null, 'startupcache-invalidate');
              } catch {
                // Ignore
              }
            }
            if (typeof (globalThis as any).ChromeUtils !== 'undefined') {
              const { AddonManager } = (globalThis as any).ChromeUtils.importESModule(
                'resource://gre/modules/AddonManager.sys.mjs'
              );
              // 1. Prefer AddonManager.installTemporaryAddon on build/addon directory so Zotero's
              //    _addonObserver.onInstalled unloads the old sandbox scope and loads the new bootstrap.js
              try {
                if (typeof AddonManager.installTemporaryAddon === 'function' && typeof Cc !== 'undefined' && typeof Ci !== 'undefined') {
                  const addonDir = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
                  addonDir.initWithPath('/Users/user/workspace/zotero-cover-grid/build/addon');
                  if (addonDir.exists()) {
                    await AddonManager.installTemporaryAddon(addonDir);
                    return;
                  }
                }
              } catch {
                // Fall through to reload / disable+enable
              }

              // 2. Fallback: re-evaluate bootstrap.js directly into the current sandbox scope and re-run startup
              const addon = await AddonManager.getAddonByID(pluginID);
              if (addon) {
                try {
                  await addon.disable();
                  if (typeof Services !== 'undefined' && Services.scriptloader && addon.getResourceURI) {
                    const scriptUri = `${addon.getResourceURI().spec}bootstrap.js?t=${Date.now()}`;
                    Services.scriptloader.loadSubScriptWithOptions(scriptUri, {
                      target: globalThis,
                      ignoreCache: true
                    });
                  }
                  await addon.enable();
                } catch {
                  if (typeof addon.reload === 'function') {
                    await addon.reload();
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  }, 1000);
}

function stopReloadWatcher() {
  if (reloadWatcherTimer) {
    clearInterval(reloadWatcherTimer);
    reloadWatcherTimer = null;
  }
}

/**
 * Register default preferences on the root default branch so Zotero 10 preferences UI
 * and Zotero.Prefs can reliably read and synchronize extension settings.
 */
function setDefaultPreferences() {
  if (typeof Services !== 'undefined' && Services.prefs) {
    try {
      const branch = Services.prefs.getDefaultBranch('');
      branch.setIntPref('extensions.zotero.covergrid.cardWidth', 180);
      branch.setBoolPref('extensions.zotero.covergrid.splashDetect', true);
      branch.setStringPref('extensions.zotero.covergrid.openPDFIn', 'tab');
      branch.setBoolPref('extensions.zotero.covergrid.showBadge', true);
      branch.setBoolPref('extensions.zotero.covergrid.showTagBand', true);
    } catch {
      // Ignore if default branch is inaccessible in test/sandboxed environment
    }
  }
}

/**
 * Patch Zotero.File.getContentsFromURL to gracefully handle jar: URIs containing '@'
 * in their authority/path without throwing NS_ERROR_MALFORMED_URI in XMLHttpRequest.
 * Gecko 140 ESR requires allowDeprecatedSystemRequests = true on system principal channels.
 */
function patchFileGetContentsIfNeeded() {
  if (typeof Zotero === 'undefined' || !Zotero.File || (Zotero.File as any).__coverGridPatched) {
    return;
  }
  const orig: (url: string) => string = Zotero.File.getContentsFromURL;
  origGetContents = orig;
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
          if (channel.loadInfo) {
            channel.loadInfo.allowDeprecatedSystemRequests = true;
          }
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

const initializingWindows = new WeakSet<any>();

/**
 * Robust check if a window is a Zotero main window across Zotero 7/10 versions and themes.
 */
function isZoteroMainWindow(win: any): boolean {
  if (!win) return false;
  const href = win.location?.href || '';
  if (href && href !== 'about:blank') {
    if (
      href.includes('preferences.xhtml') ||
      href.includes('progress.xhtml') ||
      href.includes('dialog.xhtml') ||
      href.includes('reader.xhtml')
    ) {
      return false;
    }
    return href.includes('zoteroPane.xhtml') || href.includes('standalone.xhtml');
  }
  return Boolean(win.ZoteroPane && (win.document?.getElementById('zotero-items-pane') || win.document?.getElementById('zotero-items-tree')));
}

async function initWindow(win: any) {
  if (!isZoteroMainWindow(win)) {
    // If location is not yet resolved (e.g. about:blank at window creation), hook load events
    if (win?.addEventListener && (win.location?.href === 'about:blank' || !win.location?.href)) {
      const retryListener = () => {
        if (isZoteroMainWindow(win)) initWindow(win);
      };
      win.addEventListener('DOMContentLoaded', retryListener, { once: true });
      win.addEventListener('load', retryListener, { once: true });
    }
    return;
  }

  // Deduplicate window initialization against concurrent calls / race conditions
  if (
    win.__zoteroCoverGridInitializing ||
    win.__zoteroCoverGridInitialized ||
    win.__zoteroCoverGridInstance ||
    initializingWindows.has(win)
  ) {
    return;
  }
  win.__zoteroCoverGridInitializing = true;
  initializingWindows.add(win);

  try {
    // 0. Immediately dismiss #zotero-tab-cover (Zotero startup icon overlay) at 0ms before awaiting promises
    if (win.document) {
      ensureMainWindowStability(win.document, win);
    }

    const zObj = win?.Zotero || (typeof Zotero !== 'undefined' ? Zotero : null);
    if (zObj) {
      const waitPromises: Promise<any>[] = [];
      if (zObj.initializationPromise) waitPromises.push(zObj.initializationPromise);
      if (zObj.unlockPromise) waitPromises.push(zObj.unlockPromise);
      if (zObj.uiReadyPromise) waitPromises.push(zObj.uiReadyPromise);
      if (waitPromises.length > 0) {
        try {
          await Promise.race([
            Promise.all(waitPromises),
            new Promise((resolve) => setTimeout(resolve, 600))
          ]);
        } catch {
          // Ignore
        }
      }
    }

    if (win.ZoteroPane?.loadedPromise) {
      try {
        await Promise.race([
          win.ZoteroPane.loadedPromise,
          new Promise((resolve) => setTimeout(resolve, 600))
        ]);
      } catch {}
    }

    // Fast-path DOM injection with rapid retry loop if items pane is still rendering in XUL deck
    const tryInject = () => {
      const targetDoc = win.document;
      if (!targetDoc) return false;
      ensureMainWindowStability(targetDoc, win);
      const itemsPane = targetDoc.getElementById('zotero-items-pane');
      const itemsTree = targetDoc.getElementById('zotero-items-tree');
      if (itemsTree || itemsPane) {
        if (!win.__zoteroCoverGridInstance) {
          if (targetDoc.getElementById('zotero-cover-grid')) {
            targetDoc.getElementById('zotero-cover-grid')?.remove();
          }
          injectCoverGridUI(win);
        }
        ensureMainWindowStability(targetDoc, win);
        return Boolean(win.__zoteroCoverGridInstance || targetDoc.getElementById('zotero-cover-grid'));
      }
      return false;
    };

    let injected = tryInject();
    if (!injected && win.document) {
      await new Promise<void>((resolve) => {
        let attempts = 0;
        const interval = (win.setInterval || setInterval)(() => {
          if (tryInject() || ++attempts >= 30) {
            clearInterval(interval);
            resolve();
          }
        }, 15);
      });
    }

    if (win.__zoteroCoverGridInstance || win.document?.getElementById('zotero-cover-grid')) {
      win.__zoteroCoverGridInitialized = true;
    }
  } finally {
    win.__zoteroCoverGridInitializing = false;
    initializingWindows.delete(win);
  }
}

function destroyWindow(win: any) {
  cleanupCoverGridUI(win);
  delete win.__zoteroCoverGridInitialized;
  delete win.__zoteroCoverGridInitializing;
  initializingWindows.delete(win);
}

/**
 * Automatically check for updates via Zotero's AddonManager and updates.json
 */
function checkForPluginUpdates(pluginID: string) {
  if (typeof (globalThis as any).ChromeUtils !== 'undefined') {
    try {
      const { AddonManager } = (globalThis as any).ChromeUtils.importESModule(
        'resource://gre/modules/AddonManager.sys.mjs'
      );
      AddonManager.getAddonByID(pluginID).then((addon: any) => {
        if (addon && typeof addon.findUpdates === 'function') {
          addon.findUpdates(
            {
              onUpdateAvailable: (_addonObj: any, install: any) => {
                if (typeof Zotero !== 'undefined') {
                  Zotero.debug(`[CoverGrid] Auto-update found: ${install.version}. Installing in background...`);
                }
                install.install();
              },
              onUpdateFinished: () => {}
            },
            AddonManager.UPDATE_WHEN_USER_REQUESTED
          );
        }
      }).catch(() => {});
    } catch {
      // Ignore
    }
  }
}

export function startup({ id, version, rootURI }: any, reason: number) {
  const pluginID = id || 'zotero-cover-grid@antigravity.user';

  // 1. Initialize default preferences on root default branch
  setDefaultPreferences();

  // 2. Safeguard synchronous file reading for preference pane
  patchFileGetContentsIfNeeded();

  // 3. Clean up duplicate preference panes from previous installs and register a single pane
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
      }).catch?.(() => {});
    } catch {
      // Ignore registration error
    }
  }

  // 4. Enumerate currently open windows
  if (typeof Zotero !== 'undefined' && typeof Zotero.getMainWindows === 'function') {
    for (const win of Zotero.getMainWindows()) {
      if (win.document?.readyState === 'complete' || win.document?.readyState === 'interactive') {
        initWindow(win);
      } else if (win.addEventListener) {
        win.addEventListener('DOMContentLoaded', () => initWindow(win), { once: true });
        win.addEventListener('load', () => initWindow(win), { once: true });
      }
    }
  }
  if (typeof Services !== 'undefined' && Services.wm) {
    const windows = Services.wm.getEnumerator('navigator:browser');
    while (windows.hasMoreElements()) {
      const win = windows.getNext();
      if (win.document?.readyState === 'complete' || win.document?.readyState === 'interactive') {
        initWindow(win);
      } else if (win.addEventListener) {
        win.addEventListener('DOMContentLoaded', () => initWindow(win), { once: true });
        win.addEventListener('load', () => initWindow(win), { once: true });
      }
    }
  }

  if (typeof Services !== 'undefined' && Services.wm) {
    windowListener = {
      onOpenWindow(xulWin: any) {
        try {
          const domWin = xulWin.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
          if (domWin.document?.readyState === 'complete' || domWin.document?.readyState === 'interactive') {
            initWindow(domWin);
          } else if (domWin.addEventListener) {
            domWin.addEventListener('DOMContentLoaded', () => initWindow(domWin), { once: true });
            domWin.addEventListener('load', () => initWindow(domWin), { once: true });
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

  // 5. Start background watcher for remote/CLI reload triggers
  startReloadWatcher(pluginID);

  // 6. Automatically check for updates via Zotero's AddonManager and updates.json
  checkForPluginUpdates(pluginID);
}

export function onMainWindowLoad({ window }: any) {
  if (window) {
    return initWindow(window);
  }
}

export function onMainWindowUnload({ window }: any) {
  if (window) {
    destroyWindow(window);
  }
}

export function shutdown(data: any, reason: number) {
  // Stop remote reload trigger watcher
  stopReloadWatcher();

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

  // 3. Restore original Zotero.File.getContentsFromURL to prevent monkeypatch leak
  if (origGetContents && typeof Zotero !== 'undefined' && Zotero.File) {
    try {
      Zotero.File.getContentsFromURL = origGetContents;
      delete (Zotero.File as any).__coverGridPatched;
      origGetContents = null;
    } catch {
      // Ignore
    }
  }

  // 4. Remove window listener
  if (windowListener && typeof Services !== 'undefined' && Services.wm) {
    Services.wm.removeListener(windowListener);
    windowListener = null;
  }

  // 5. Clean all browser windows
  if (typeof Zotero !== 'undefined' && typeof Zotero.getMainWindows === 'function') {
    for (const win of Zotero.getMainWindows()) {
      destroyWindow(win);
    }
  } else if (typeof Services !== 'undefined' && Services.wm) {
    const windows = Services.wm.getEnumerator('navigator:browser');
    while (windows.hasMoreElements()) {
      destroyWindow(windows.getNext());
    }
  }
}

export function install() {}
export function uninstall() {}
