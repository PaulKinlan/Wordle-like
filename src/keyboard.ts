// Typing with the device's own keyboard: no on-screen keyboard of our own.
//
// One invisible <input> sits over the board. Whatever is typed is cleaned to
// letters only and shown one letter per tile. Autocorrect, autocomplete,
// autocapitalise and spellcheck are switched off in the markup.
//
// Progressive enhancements:
// - VirtualKeyboard API (Chromium): the keyboard overlays the page and we lay
//   out above it using env(keyboard-inset-height); we show it ourselves on tap.
// - visualViewport (Safari, Firefox): measure the keyboard and do the same.
import { expandWord } from '../shared/game';
import { debugLog } from './debug';

interface VirtualKeyboard extends EventTarget {
  overlaysContent: boolean;
  boundingRect: DOMRect;
  show(): void;
  hide(): void;
}

const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;
/** The on-screen keyboard's height where the browser reports it (-1 if it can't). */
const vkHeight = () => (vk ? Math.round(vk.boundingRect.height) : -1);

export interface EntryOptions {
  input: HTMLInputElement;
  form: HTMLFormElement;
  normalize: (text: string) => string;
  onChange: (letters: string) => void;
  onSubmit: () => void;
  /** Called when typing is switched on or off (the game ended, a race is waiting...). */
  onEnabled?: (on: boolean) => void;
}

export class NativeEntry {
  private maxLength = 5;
  private enabled = true;
  private hiding: Promise<void> | null = null;
  /** The browser itself has opened the keyboard on this page (see focus). */
  private browserOpened = false;
  /** The letters typed so far, one per tile. */
  private letters = '';
  /** The game's own on-screen keyboard is on: never raise the phone's. */
  private ownKeyboard = false;

  constructor(private o: EntryOptions) {
    const { input, form } = o;
    input.addEventListener('input', (e) => {
      if ((e as InputEvent).isComposing) {
        this.letters = this.clean(input.value);
        o.onChange(this.letters);
        return;
      }
      this.sync();
    });
    input.addEventListener('compositionend', () => this.sync());
    // Keep the caret at the end, so typing and backspace act on the last tile.
    input.addEventListener('select', () => this.caretToEnd());
    input.addEventListener('focus', () => {
      this.caretToEnd();
      document.body.classList.add('typing');
    });
    input.addEventListener('blur', (e) => {
      document.body.classList.remove('typing');
      if (this.enabled) debugLog('kb field lost focus', { to: describe((e as FocusEvent).relatedTarget as Element | null), vk: vkHeight() });
    });
    // Taps land on the field itself (it covers the board, invisible), so the
    // browser opens the keyboard its own way. A keyboard opened with
    // navigator.virtualKeyboard.show() instead can't be closed again on
    // Android Chrome (neither hide() nor blur() works); one the browser
    // opened closes on blur.
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      debugLog('kb submit', { gesture: gesture() });
      if (this.enabled) o.onSubmit();
    });

    // The keyboard is only for the board: a tap anywhere else (a tab, a
    // button, a menu, empty space) puts it away.
    document.addEventListener(
      'pointerdown',
      (e) => {
        // Controls marked data-keeps-keyboard (Skip) keep focus on the field.
        const target = e.target as Element;
        if (!form.contains(target) && !target.closest?.('[data-keeps-keyboard]')) void this.hideKeyboard();
      },
      true,
    );

    vk?.addEventListener('geometrychange', () => {
      if (vkHeight() > 0 && input.getAttribute('virtualkeyboardpolicy') !== 'manual') this.browserOpened = true;
    });

    // A physical keyboard should work even if focus has wandered.
    document.addEventListener('keydown', (e) => {
      if (!this.enabled || document.activeElement === input || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.key.length === 1 && /\p{L}/u.test(e.key)) this.focus(false);
      else if (e.key === 'Enter' && document.activeElement === document.body) o.onSubmit();
    });

    // Switching apps or tabs takes the keyboard away. If it was up mid-game,
    // try to bring it back on return (unless a dialog is open by then).
    // The browser may not raise the keyboard without a tap; then focus is
    // back on the board and one tap brings the keyboard up.
    let wasTyping = false;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        wasTyping = this.enabled && (document.activeElement === input || vkHeight() > 0);
        debugLog('kb page hidden', { wasTyping });
        return;
      }
      if (!wasTyping) return;
      wasTyping = false;
      setTimeout(() => {
        if (!this.enabled || document.querySelector('dialog[open]')) return;
        this.focus(true);
      }, 150);
    });

    setupKeyboardInsets();
  }

  configure(maxLength: number) {
    this.maxLength = maxLength;
  }

  setEnabled(on: boolean): Promise<void> {
    const { input } = this.o;
    const was = this.enabled;
    if (was !== on) debugLog('kb enabled', on, { focused: document.activeElement === input, vk: vkHeight() });
    this.enabled = on;
    if (was !== on) this.o.onEnabled?.(on);
    if (on) {
      input.disabled = false;
      input.readOnly = false;
      this.syncInputMode();
      input.classList.remove('locked');
      return Promise.resolve();
    }
    return this.hideKeyboard();
  }

  get isEnabled() {
    return this.enabled;
  }

  /** With the game's own keyboard, the phone's keyboard never comes up (a physical one still works). */
  setOwnKeyboard(on: boolean) {
    this.ownKeyboard = on;
    this.syncInputMode();
    if (on) void this.hideKeyboard();
  }

  // inputmode="none" tells the browser this field never wants a keyboard, so
  // a tap on the board focuses it without raising one.
  private syncInputMode() {
    if (this.enabled && !this.ownKeyboard) this.o.input.removeAttribute('inputmode');
    else this.o.input.inputMode = 'none';
  }

  // ---- the on-screen keyboard types through these

  /** Adds one tile's letter. */
  type(letter: string) {
    if (!this.enabled) return;
    this.commit(this.letters + letter);
  }

  /** Removes the last tile. */
  backspace() {
    if (!this.enabled) return;
    this.commit([...this.letters].slice(0, -1).join(''));
  }

  /** Swaps the last tile's letter (Japanese mark key). */
  replaceLast(change: (letter: string) => string) {
    const tiles = [...this.letters];
    if (!this.enabled || !tiles.length) return;
    tiles.push(change(tiles.pop()!));
    this.commit(tiles.join(''));
  }

  submit() {
    if (this.enabled) this.o.onSubmit();
  }

  /**
   * Sets the tiles directly, without re-reading the field: a Welsh n then g
   * tapped as two keys stays two tiles, where typed text would join them.
   */
  private commit(letters: string) {
    this.letters = [...letters].slice(0, this.maxLength).join('');
    this.o.input.value = expandWord(this.letters);
    this.caretToEnd();
    this.o.onChange(this.letters);
  }

  /**
   * Puts the on-screen keyboard away by taking focus off the field, which is
   * what closes a keyboard the browser opened. If show() was used since (see
   * focus), hide() is called first: that is its matching call. Resolves once
   * the keyboard is down, or after a short wait if it isn't.
   */
  hideKeyboard(): Promise<void> {
    const { input } = this.o;
    const focused = document.activeElement === input;
    if (this.hiding) return this.hiding;
    if (!focused && !(vkHeight() > 0)) {
      if (!this.enabled) this.lockField();
      return Promise.resolve(); // nothing to put away (not logged: every tap lands here)
    }
    debugLog('kb hide start', { focused, vk: vkHeight(), active: describe(document.activeElement), gesture: gesture() });
    if (focused && input.getAttribute('virtualkeyboardpolicy') === 'manual') {
      try {
        vk?.hide();
      } catch (e) {
        debugLog('kb hide() threw', e);
      }
    }
    input.removeAttribute('virtualkeyboardpolicy');
    input.blur();
    if (!this.enabled) this.lockField();
    this.hiding = this.closed(600)
      .then((ok) => debugLog(ok ? 'kb closed' : 'kb STILL UP after blur', { vk: vkHeight(), active: describe(document.activeElement) }))
      .finally(() => {
        this.hiding = null;
      });
    return this.hiding;
  }

  /** Waits up to `ms` for the keyboard to go down. True if it did (or we can't tell). */
  private closed(ms = 350): Promise<boolean> {
    if (!vk) return frames(2).then(() => true);
    if (vkHeight() <= 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        vk.removeEventListener('geometrychange', check);
        resolve(ok);
      };
      const check = () => {
        if (vkHeight() <= 0) done(true);
      };
      const timer = setTimeout(() => done(vkHeight() <= 0), ms);
      vk.addEventListener('geometrychange', check);
    });
  }

  /** Typing is off: no keyboard for this field, and taps pass through it, until it's turned back on. */
  private lockField() {
    const { input } = this.o;
    input.inputMode = 'none';
    input.readOnly = true;
    input.classList.add('locked');
  }

  clear() {
    this.o.input.value = '';
    this.letters = '';
    this.o.onChange('');
  }

  /**
   * Focuses the field. With showKeyboard (New word, or coming back to the
   * app mid-game) it also asks for the on-screen keyboard: a plain focus()
   * can't, so this is what navigator.virtualKeyboard.show() is for. It needs
   * the "manual" policy on the focused field; the policy goes back to normal
   * when the keyboard is next put away.
   *
   * Only once the browser has opened the keyboard itself on this page (a tap
   * on the board): on Android Chrome a keyboard whose first opening was
   * show() can't be closed again. Before that, the player's tap opens it.
   */
  focus(showKeyboard: boolean) {
    if (!this.enabled) return;
    if (this.ownKeyboard) showKeyboard = false;
    const { input } = this.o;
    const show = showKeyboard && !!vk && this.browserOpened;
    if (show) input.setAttribute('virtualkeyboardpolicy', 'manual');
    input.focus({ preventScroll: true });
    if (show) {
      try {
        vk.show();
      } catch (e) {
        debugLog('kb show() threw', e);
      }
    }
    if (showKeyboard) debugLog('kb focus', { show, vk: vkHeight() });
  }

  private clean(value: string) {
    return [...this.o.normalize(value)].slice(0, this.maxLength).join('');
  }

  private sync() {
    const { input } = this.o;
    const letters = this.clean(input.value);
    // The field holds ordinary letters: Welsh "ll" is one tile but two letters typed.
    const text = expandWord(letters);
    if (input.value !== text) input.value = text;
    this.caretToEnd();
    this.letters = letters;
    this.o.onChange(letters);
  }

  private caretToEnd() {
    const { input } = this.o;
    const end = input.value.length;
    if (input.selectionStart !== end || input.selectionEnd !== end) {
      try {
        input.setSelectionRange(end, end);
      } catch {
        /* not focusable yet */
      }
    }
  }
}

/** A short name for an element in the debug log, like "input#entry". */
const describe = (el: Element | null) =>
  el ? el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '') : 'none';

/** Whether the page has a user gesture right now (transient activation), for the debug log. */
const gesture = () => {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua ? ua.isActive : 'n/a';
};

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

/** Keeps the layout above the on-screen keyboard. Sets --kb on <html>. */
function setupKeyboardInsets() {
  const root = document.documentElement;
  if (vk) {
    vk.overlaysContent = true;
    // Logged once it settles, with the window sizes: they show which browser
    // chrome (address bar top or bottom) is around the keyboard.
    let settle = 0;
    vk.addEventListener('geometrychange', () => {
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        const r = vk.boundingRect;
        debugLog('kb geometry', {
          h: Math.round(r.height),
          y: Math.round(r.y),
          inner: window.innerHeight,
          vv: Math.round(window.visualViewport?.height ?? 0),
          screen: screen.height,
        });
      }, 150);
    });
    root.classList.add('vk-api'); // CSS uses env(keyboard-inset-height)
    return;
  }
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--kb', `${Math.round(inset)}px`);
    if (inset > 0) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

/**
 * Guesses likely languages from the physical keyboard layout (Keyboard API,
 * Chromium desktop only). Used to order the language picker.
 */
export async function keyboardLanguageHints(): Promise<string[]> {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
  if (!kb?.getLayoutMap) return [];
  try {
    const map = await kb.getLayoutMap();
    const k = (code: string) => map.get(code)?.toLowerCase();
    if (k('KeyQ') === 'a' && k('KeyW') === 'z') return ['fr'];
    if (k('Semicolon') === 'ñ') return ['es'];
    if (k('KeyY') === 'z') return ['de'];
    if (k('Semicolon') === 'ö' && k('Quote') === 'ä') return ['sv', 'fi'];
    if (k('Semicolon') === 'æ' || k('Quote') === 'æ') return ['da', 'nb'];
    if (k('Semicolon') === 'ç') return ['pt'];
    if (k('Semicolon') === 'ò') return ['it'];
    if (k('KeyQ') === 'q' && k('KeyW') === 'w' && k('KeyY') === 'y') return ['en'];
  } catch {
    // Permission policy or unsupported: fall back to navigator.languages.
  }
  return [];
}
