import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { startup, shutdown } from '../src/bootstrap';

declare const Services: any;
declare const Zotero: any;
declare const Cc: any;
declare const Ci: any;

describe('Milestone 1 Empirical Verification: Preferences & Lifecycle', () => {
  const PREF_PANE_ID = 'zotero-cover-grid-preferences-pane';
  const PLUGIN_ID = 'zotero-cover-grid@antigravity.user';
  const prefsXhtmlPath = path.resolve(__dirname, '../addon/preferences.xhtml');

  let mockDefaultBranch: any;
  let mockOrigGetContents: any;
  let registeredPanes: any[];

  beforeEach(() => {
    registeredPanes = [];
    mockDefaultBranch = {
      setIntPref: vi.fn(),
      setBoolPref: vi.fn(),
      getIntPref: vi.fn(),
      getBoolPref: vi.fn()
    };

    (globalThis as any).Services = {
      prefs: {
        getDefaultBranch: vi.fn((branch: string) => mockDefaultBranch),
        getBranch: vi.fn(() => mockDefaultBranch)
      },
      wm: {
        getEnumerator: vi.fn(() => ({
          hasMoreElements: vi.fn(() => false),
          getNext: vi.fn()
        })),
        addListener: vi.fn(),
        removeListener: vi.fn()
      },
      io: {
        newURI: vi.fn((url: string) => ({ spec: url })),
        newChannelFromURI: vi.fn((uri: any) => ({
          loadInfo: {},
          open: vi.fn(() => ({}))
        }))
      },
      scriptSecurityManager: {
        getSystemPrincipal: vi.fn(() => ({}))
      }
    };

    mockOrigGetContents = vi.fn((url: string) => {
      if (url.includes('throw-malformed-uri')) {
        const err = new Error('NS_ERROR_MALFORMED_URI');
        (err as any).result = 0x804b000a;
        throw err;
      }
      return `<mock-content url="${url}"/>`;
    });

    (globalThis as any).Zotero = {
      File: {
        getContentsFromURL: mockOrigGetContents
      },
      PreferencePanes: {
        pluginPanes: registeredPanes,
        register: vi.fn((pane: any) => {
          registeredPanes.push(pane);
          return Promise.resolve(pane.id);
        }),
        unregister: vi.fn((id: string) => {
          const idx = registeredPanes.findIndex((p) => p.id === id);
          if (idx !== -1) registeredPanes.splice(idx, 1);
        })
      },
      Prefs: {
        get: vi.fn(),
        set: vi.fn()
      }
    };

    (globalThis as any).Cc = {
      '@mozilla.org/intl/converter-input-stream;1': {
        createInstance: vi.fn(() => {
          let readOnce = false;
          return {
            init: vi.fn(),
            readString: vi.fn((count: number, strObj: any) => {
              if (!readOnce) {
                readOnce = true;
                strObj.value = '<vbox id="read-from-cstream"/>';
                return strObj.value.length;
              }
              return 0;
            }),
            close: vi.fn()
          };
        })
      }
    };

    (globalThis as any).Ci = {
      nsILoadInfo: {
        SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL: 0x10
      },
      nsIContentPolicy: {
        TYPE_OTHER: 1
      },
      nsIConverterInputStream: {
        DEFAULT_REPLACEMENT_CHARACTER: 0xfffd
      }
    };
  });

  afterEach(() => {
    shutdown({}, 1);
  });

  describe('1. XML Parsing & Preferences Fragment Structure', () => {
    it('should read addon/preferences.xhtml cleanly as valid XML', () => {
      expect(fs.existsSync(prefsXhtmlPath)).toBe(true);
      const rawMarkup = fs.readFileSync(prefsXhtmlPath, 'utf-8');

      const parser = new DOMParser();
      const doc = parser.parseFromString(rawMarkup, 'application/xml');

      const parserError = doc.querySelector('parsererror');
      expect(parserError).toBeNull();
      const vbox = doc.getElementById('zotero-prefpane-cover-grid');
      expect(vbox).not.toBeNull();
      expect(vbox?.tagName.toLowerCase()).toBe('vbox');
      expect(vbox?.getAttribute('xmlns')).toBe('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul');
      expect(vbox?.getAttribute('xmlns:html')).toBe('http://www.w3.org/1999/xhtml');
    });

    it('should have exact preference attributes on inputs and NO duplicate title', () => {
      const rawMarkup = fs.readFileSync(prefsXhtmlPath, 'utf-8');
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawMarkup, 'application/xml');

      // Check card width input
      const cardWidthInput = doc.getElementById('pref-card-width');
      expect(cardWidthInput).not.toBeNull();
      expect(cardWidthInput?.getAttribute('preference')).toBe('extensions.zotero.covergrid.cardWidth');
      expect(cardWidthInput?.getAttribute('type')).toBe('number');
      expect(cardWidthInput?.getAttribute('min')).toBe('140');
      expect(cardWidthInput?.getAttribute('max')).toBe('340');
      expect(cardWidthInput?.getAttribute('value')).toBe('180');

      // Check splash detect checkbox
      const splashDetectCheckbox = doc.getElementById('pref-splash-detect');
      expect(splashDetectCheckbox).not.toBeNull();
      expect(splashDetectCheckbox?.getAttribute('preference')).toBe('extensions.zotero.covergrid.splashDetect');
      expect(splashDetectCheckbox?.getAttribute('checked')).toBe('true');

      // Check that NO duplicate title <h1> or bold <div> title exists
      const h1Tags = doc.getElementsByTagName('h1');
      expect(h1Tags.length).toBe(0);

      // Verify .main-section exists for Zotero 10 _loadPane heading injection
      const mainSection = doc.querySelector('.main-section');
      expect(mainSection).not.toBeNull();

      // Ensure no div inside main section has title text "Zotero Cover Grid"
      const divs = mainSection?.querySelectorAll('div') || [];
      divs.forEach((d) => {
        expect(d.textContent?.trim()).not.toBe('Zotero Cover Grid');
      });
    });

    it('should parse cleanly through simulated Zotero 10 _parseXHTMLToFragment', () => {
      const rawMarkup = fs.readFileSync(prefsXhtmlPath, 'utf-8');
      const parser = new DOMParser();
      const wrapped = `
        <div xmlns="http://www.w3.org/1999/xhtml"
             xmlns:xul="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul">
          ${rawMarkup}
        </div>
      `;
      const doc = parser.parseFromString(wrapped, 'application/xml');
      expect(doc.querySelector('parsererror')).toBeNull();

      const range = doc.createRange();
      const div = doc.querySelector('div')!;
      range.selectNodeContents(div);
      const fragment = range.extractContents();
      expect(fragment.childNodes.length).toBeGreaterThan(0);
    });
  });

  describe('2. Default Preference Initialization', () => {
    it('should set int and bool preferences on Services.prefs.getDefaultBranch', () => {
      startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);

      expect(Services.prefs.getDefaultBranch).toHaveBeenCalledWith('');
      expect(mockDefaultBranch.setIntPref).toHaveBeenCalledWith('extensions.zotero.covergrid.cardWidth', 180);
      expect(mockDefaultBranch.setBoolPref).toHaveBeenCalledWith('extensions.zotero.covergrid.splashDetect', true);
    });

    it('should handle undefined Services.prefs gracefully without throwing', () => {
      delete (globalThis as any).Services.prefs;
      expect(() => {
        startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);
      }).not.toThrow();
    });

    it('should handle throwing branch.setIntPref gracefully', () => {
      mockDefaultBranch.setIntPref.mockImplementation(() => {
        throw new Error('NS_ERROR_PREF_BRANCH_LOCKED');
      });
      expect(() => {
        startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);
      }).not.toThrow();
    });
  });

  describe('3. PreferencePanes Registration & Cleanup', () => {
    it('should register pane with correct ID, src, and clean previous duplicate entries', () => {
      // Simulate existing old pane in pluginPanes
      Zotero.PreferencePanes.pluginPanes.push({
        id: PREF_PANE_ID,
        pluginID: PLUGIN_ID
      });

      startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);

      expect(Zotero.PreferencePanes.register).toHaveBeenCalledWith(
        expect.objectContaining({
          id: PREF_PANE_ID,
          pluginID: PLUGIN_ID,
          src: 'chrome://covergrid/preferences.xhtml',
          label: 'Cover Grid',
          image: 'chrome://covergrid/icons/icon-48.png'
        })
      );

      // Verify unregister is called on shutdown
      shutdown({}, 1);
      expect(Zotero.PreferencePanes.unregister).toHaveBeenCalledWith(PREF_PANE_ID);
    });
  });

  describe('4. Monkeypatch Installation, Gecko 140 Channel Loading & 100-Cycle Stress', () => {
    it('should transparently pass normal URLs through origGetContents', () => {
      startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);

      const result = Zotero.File.getContentsFromURL('chrome://zotero/content/test.xhtml');
      expect(result).toBe('<mock-content url="chrome://zotero/content/test.xhtml"/>');
      expect(mockOrigGetContents).toHaveBeenCalledWith('chrome://zotero/content/test.xhtml');
    });

    it('should fallback to nsIChannel with allowDeprecatedSystemRequests when orig throws NS_ERROR_MALFORMED_URI', () => {
      startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);

      let channelPassed: any = null;
      Services.io.newChannelFromURI = vi.fn((uri: any) => {
        channelPassed = {
          loadInfo: {},
          open: vi.fn(() => ({}))
        };
        return channelPassed;
      });

      const jarUrl = 'jar:file:///app.xpi!/throw-malformed-uri/pane.xhtml';
      const result = Zotero.File.getContentsFromURL(jarUrl);

      expect(result).toBe('<vbox id="read-from-cstream"/>');
      expect(channelPassed).not.toBeNull();
      expect(channelPassed.loadInfo.allowDeprecatedSystemRequests).toBe(true);
    });

    it('should re-throw original error if fallback also throws', () => {
      startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);

      Services.io.newURI = vi.fn(() => {
        throw new Error('URI parsing totally failed');
      });

      expect(() => {
        Zotero.File.getContentsFromURL('jar:file:///app.xpi!/throw-malformed-uri/bad.xhtml');
      }).toThrow('NS_ERROR_MALFORMED_URI');
    });

    it('should not double-wrap monkeypatch on consecutive startup calls', () => {
      startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);
      const patchedFn1 = Zotero.File.getContentsFromURL;

      startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);
      const patchedFn2 = Zotero.File.getContentsFromURL;

      expect(patchedFn1).toBe(patchedFn2);
    });

    it('should restore original getContentsFromURL on shutdown and tolerate multiple shutdowns', () => {
      const initialFn = Zotero.File.getContentsFromURL;

      startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);
      expect(Zotero.File.getContentsFromURL).not.toBe(initialFn);
      expect((Zotero.File as any).__coverGridPatched).toBe(true);

      shutdown({}, 1);
      expect(Zotero.File.getContentsFromURL).toBe(initialFn);
      expect((Zotero.File as any).__coverGridPatched).toBeUndefined();

      // Double shutdown should be completely harmless
      expect(() => shutdown({}, 1)).not.toThrow();
      expect(Zotero.File.getContentsFromURL).toBe(initialFn);
    });

    it('should endure 100 consecutive startup/shutdown stress cycles without leaking or degrading', () => {
      const initialFn = Zotero.File.getContentsFromURL;

      for (let i = 0; i < 100; i++) {
        startup({ id: PLUGIN_ID, version: '0.1.7', rootURI: 'chrome://covergrid/' }, 1);
        expect((Zotero.File as any).__coverGridPatched).toBe(true);
        expect(Zotero.File.getContentsFromURL).not.toBe(initialFn);

        shutdown({}, 1);
        expect((Zotero.File as any).__coverGridPatched).toBeUndefined();
        expect(Zotero.File.getContentsFromURL).toBe(initialFn);
      }
    });
  });
});
