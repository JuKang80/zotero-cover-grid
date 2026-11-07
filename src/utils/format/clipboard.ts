/**
 * Clipboard utilities for Zotero Cover Grid
 * Supports modern Web Clipboard API, Firefox/Gecko XPCOM, and DOM textarea fallback
 */

/**
 * Robust cross-environment clipboard writer
 */
export async function copyTextToClipboard(text: string, win?: any): Promise<boolean> {
  const targetWin = win || (typeof window !== 'undefined' ? window : (globalThis as any).Zotero?.getMainWindow?.());
  // 1. Try modern navigator.clipboard
  try {
    if (targetWin?.navigator?.clipboard?.writeText) {
      await targetWin.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  // 2. Try Gecko XPCOM clipboard helper
  try {
    const Cc = (globalThis as any).Components?.classes;
    const Ci = (globalThis as any).Components?.interfaces;
    if (Cc && Ci) {
      const helper = Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper);
      helper.copyString(text);
      return true;
    }
  } catch {}

  // 3. Fallback: textarea execCommand
  try {
    const doc = targetWin?.document || (typeof document !== 'undefined' ? document : null);
    if (doc) {
      const textarea = doc.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      doc.body.appendChild(textarea);
      textarea.select();
      doc.execCommand('copy');
      textarea.remove();
      return true;
    }
  } catch {}

  return false;
}
