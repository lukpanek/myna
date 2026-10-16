import { invoke } from '@tauri-apps/api/core';
import type { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { toast } from 'sonner';
import { create } from 'zustand';
import { t } from '@/i18n';
import { interceptExternalLinks } from './native';
import { isTauri } from './platform';
import { installScrollbarActivity } from './scrollbars';

/**
 * Chat pop-out windows. `window.open('about:blank')` gives a second native
 * window (src-tauri/src/window.rs) whose document belongs to this JS context,
 * so `PopoutHost` portals a room into it: same Matrix client, crypto, stores.
 * Styles and the theme classes of <html> are mirrored into the pop-out.
 * WebKit's `window.close()` / `focus()` are not wired up by Tauri, so the native
 * window is driven through its Tauri label (`popout-N`).
 */

/** Label prefix of pop-out windows (`POPOUT_PREFIX` in window.rs). */
const LABEL_PREFIX = 'popout-';

export interface Popout {
  roomId: string;
  win: Window;
  /** Element the room view is portalled into. */
  root: HTMLElement;
  focused: boolean;
  /** Native window; resolved shortly after opening. */
  native: Promise<WebviewWindow | null>;
}

interface PopoutState {
  popouts: Record<string, Popout>;
}

export const usePopouts = create<PopoutState>(() => ({ popouts: {} }));

const WIDTH = 520;
const HEIGHT = 760;

/**
 * Window the user last clicked or typed in: a pop-out's room id, null = main window.
 * Dialogs opened from a message belong to that window.
 */
let activeScope: string | null = null;

export function getActiveScope(): string | null {
  return activeScope;
}

function trackScope(doc: Document, scope: string | null) {
  const mark = () => {
    activeScope = scope;
  };
  doc.addEventListener('pointerdown', mark, true);
  doc.addEventListener('keydown', mark, true);
  doc.defaultView?.addEventListener('focus', mark);
}

trackScope(document, null);

/** Whether the chat is open in a pop-out that has focus (read receipts, notifications). */
export function isPopoutFocused(roomId: string): boolean {
  return usePopouts.getState().popouts[roomId]?.focused ?? false;
}

export function openPopout(roomId: string, title: string): void {
  const existing = usePopouts.getState().popouts[roomId];
  if (existing && !existing.win.closed) {
    void existing.native.then((w) => (w ? w.unminimize().then(() => w.setFocus()) : existing.win.focus())).catch(() => undefined);
    return;
  }
  const left = window.screenX + Math.max(0, window.outerWidth - WIDTH - 40);
  const win = window.open('about:blank', '', `width=${WIDTH},height=${HEIGHT},left=${left},top=${window.screenY + 60}`);
  if (!win) {
    toast.error(t('desktop.popoutFailed'));
    return;
  }
  const root = setUpDocument(win, title);
  const native = findNativeWindow();
  const popout: Popout = { roomId, win, root, focused: true, native };
  usePopouts.setState((s) => ({ popouts: { ...s.popouts, [roomId]: popout } }));

  const setFocused = (focused: boolean) =>
    usePopouts.setState((s) => {
      const current = s.popouts[roomId];
      if (current?.win !== win || current.focused === focused) return s;
      return { popouts: { ...s.popouts, [roomId]: { ...current, focused } } };
    });
  win.addEventListener('focus', () => setFocused(true));
  win.addEventListener('blur', () => setFocused(false));
  trackScope(win.document, roomId);
  interceptExternalLinks(win.document);
  installScrollbarActivity(win.document);

  // `pagehide` fires when the native window closes; polling covers engines that skip it.
  const closed = () => {
    clearInterval(poll);
    if (activeScope === roomId) activeScope = null;
    usePopouts.setState((s) => {
      if (s.popouts[roomId]?.win !== win) return s;
      const { [roomId]: _, ...rest } = s.popouts;
      return { popouts: rest };
    });
  };
  const poll = setInterval(() => win.closed && closed(), 1000);
  win.addEventListener('pagehide', closed);
  void native.then((w) => w?.once('tauri://destroyed', closed)).catch(() => undefined);
}

/** The Tauri window just created for `window.open`: the newest pop-out label nobody holds yet. */
async function findNativeWindow(): Promise<WebviewWindow | null> {
  if (!isTauri) return null;
  const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow');
  const held = new Set(
    await Promise.all(Object.values(usePopouts.getState().popouts).map((p) => p.native.then((w) => w?.label))),
  );
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidates = (await getAllWebviewWindows())
      .filter((w) => w.label.startsWith(LABEL_PREFIX) && !held.has(w.label))
      .sort((a, b) => Number(b.label.slice(LABEL_PREFIX.length)) - Number(a.label.slice(LABEL_PREFIX.length)));
    if (candidates[0]) return candidates[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

function closeWindow(p: Popout) {
  void p.native
    .then((w) => (w ? w.close() : p.win.close()))
    .catch(() => p.win.close());
}

/**
 * Title bar behaviour for the pop-out's room header (`title_bar_mouse_down` in window.rs;
 * Tauri's drag region script would move the main window): drag moves it, double click zooms.
 */
export function popoutTitleBarMouseDown(e: { button: number; detail: number }): void {
  if (!isTauri || e.button !== 0) return;
  void invoke('title_bar_mouse_down', { zoom: e.detail === 2 }).catch(() => undefined);
}

export function closePopout(roomId: string): void {
  const p = usePopouts.getState().popouts[roomId];
  if (p) closeWindow(p);
}

export function closeAllPopouts(): void {
  for (const p of Object.values(usePopouts.getState().popouts)) closeWindow(p);
  usePopouts.setState({ popouts: {} });
}

/** Copies styles and <html> state into the empty pop-out document and returns the mount element. */
function setUpDocument(win: Window, title: string): HTMLElement {
  const doc = win.document;
  doc.title = title;
  const base = doc.createElement('base');
  base.href = document.baseURI;
  doc.head.append(base);
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  doc.head.append(meta);

  const styleClones = new Map<Node, HTMLElement>();
  const copyStyle = (node: Node) => {
    if (node instanceof HTMLStyleElement || (node instanceof HTMLLinkElement && node.rel === 'stylesheet')) {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.dataset.popoutSource = '';
      styleClones.set(node, clone);
      doc.head.append(clone);
    }
  };
  document.head.childNodes.forEach(copyStyle);

  const mirrorRoot = () => {
    const html = document.documentElement;
    doc.documentElement.className = html.className;
    doc.documentElement.lang = html.lang;
    const style = html.getAttribute('style');
    if (style) doc.documentElement.setAttribute('style', style);
    else doc.documentElement.removeAttribute('style');
    for (const { name, value } of Array.from(html.attributes)) {
      if (name.startsWith('data-')) doc.documentElement.setAttribute(name, value);
    }
    doc.body.className = document.body.className;
  };
  mirrorRoot();

  // Theme / font size changes and (in dev) hot-reloaded styles follow the main window.
  const rootObserver = new MutationObserver(mirrorRoot);
  rootObserver.observe(document.documentElement, { attributes: true });
  rootObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const headObserver = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach(copyStyle);
      r.removedNodes.forEach((n) => {
        styleClones.get(n)?.remove();
        styleClones.delete(n);
      });
      if (r.type === 'characterData' || r.type === 'childList') {
        const owner = r.target instanceof HTMLStyleElement ? r.target : r.target.parentNode;
        const clone = owner ? styleClones.get(owner) : undefined;
        if (owner instanceof HTMLStyleElement && clone) clone.textContent = owner.textContent;
      }
    }
  });
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  win.addEventListener('pagehide', () => {
    rootObserver.disconnect();
    headObserver.disconnect();
  });

  const root = doc.createElement('div');
  root.id = 'root';
  doc.body.append(root);
  return root;
}
