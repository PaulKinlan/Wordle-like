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
}

export class NativeEntry {
  private maxLength = 5;
  private enabled = true;

  constructor(private o: EntryOptions) {
    const { input, form } = o;
    input.addEventListener('input', (e) => {
      if ((e as InputEvent).isComposing) {
        o.onChange(this.clean(input.value));
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
    input.addEventListener('blur', () => document.body.classList.remove('typing'));
    // Taps land on the form, not the field (it has pointer-events: none): a tap
    // into a text field makes Android show its cursor handle, a focus() call doesn't.
    form.addEventListener('pointerup', () => this.focus(true));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.enabled) o.onSubmit();
    });

    // The keyboard is only for the board: a tap anywhere else (a tab, a
    // button, a menu, empty space) puts it away. This runs before the tap
    // moves focus, while hide() still works (see hideKeyboard).
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!form.contains(e.target as Node)) this.hideKeyboard();
      },
      true,
    );

    // If the keyboard is up while typing is on but focus has wandered off the
    // field, keystrokes would go nowhere: put focus back on the board.
    vk?.addEventListener('geometrychange', () => {
      if (vkHeight() <= 0 || !this.enabled || document.activeElement === input) return;
      if (document.querySelector('dialog[open]')) return;
      debugLog('kb refocus', { vk: vkHeight() });
      input.focus();
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
        debugLog('kb page back, refocused', { vk: vkHeight() });
      }, 150);
    });

    setupKeyboardInsets();
  }

  configure(maxLength: number) {
    this.maxLength = maxLength;
  }

  setEnabled(on: boolean) {
    const { input } = this.o;
    this.enabled = on;
    debugLog('kb enabled', on, { focused: document.activeElement === input, vk: vkHeight() });
    if (on) {
      input.readOnly = false;
      input.removeAttribute('inputmode');
      input.setAttribute('virtualkeyboardpolicy', 'manual');
      return;
    }
    this.hideKeyboard();
    // Android can bring the keyboard back once the keyboard app catches up
    // with the Enter press: check again when that has settled.
    setTimeout(() => {
      if (!this.enabled && vkHeight() > 0) {
        debugLog('kb still up after 400ms, hiding again');
        this.hideKeyboard();
      }
    }, 400);
  }

  /**
   * Puts the on-screen keyboard away, using every lever there is, in order:
   * 1. navigator.virtualKeyboard.hide() while the field is focused, editable
   *    and on the "manual" policy (the API's own way).
   * 2. Then switch the field to the browser's normal ("auto") policy with
   *    inputmode="none" and move focus off it. Chrome reads the policy when
   *    focus changes, so the field is focused once more under "auto" (no
   *    keyboard, inputmode="none") and blurred again: a blur under "auto"
   *    is what closes the keyboard on every Android browser.
   * All of this is synchronous, so a dialog opened right after can't get in
   * the way. Each step goes to the ?debug log.
   */
  hideKeyboard() {
    const { input } = this.o;
    const focused = document.activeElement === input;
    debugLog('kb hide start', { focused, vk: vkHeight() });
    if (!focused && !(vkHeight() > 0)) {
      if (!this.enabled) this.lockField();
      return;
    }
    input.readOnly = false;
    if (!focused) input.focus({ preventScroll: true });
    try {
      vk?.hide();
    } catch (e) {
      debugLog('kb hide() threw', e);
    }
    if (this.enabled) return; // a pause (dialog over a game in progress): the field keeps its policy
    input.inputMode = 'none';
    input.setAttribute('virtualkeyboardpolicy', 'auto');
    input.blur();
    input.focus({ preventScroll: true });
    input.blur();
    this.lockField();
    debugLog('kb hide done', { focused: document.activeElement === input, vk: vkHeight() });
  }

  /** Typing is off: no keyboard for this field until it's turned back on. */
  private lockField() {
    const { input } = this.o;
    input.inputMode = 'none';
    input.readOnly = true;
  }

  clear() {
    this.o.input.value = '';
    this.o.onChange('');
  }

  /** Focuses the field; with showKeyboard (a tap on the board), also raises the keyboard. */
  focus(showKeyboard: boolean) {
    if (!this.enabled) return;
    const { input } = this.o;
    input.focus({ preventScroll: true });
    if (showKeyboard) {
      try {
        vk?.show();
      } catch (e) {
        debugLog('kb show() threw', e);
      }
    }
    debugLog('kb focus', { show: showKeyboard, vk: vkHeight() });
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

/** Keeps the layout above the on-screen keyboard. Sets --kb on <html>. */
function setupKeyboardInsets() {
  const root = document.documentElement;
  if (vk) {
    vk.overlaysContent = true;
    vk.addEventListener('geometrychange', () => debugLog('kb geometry', vkHeight()));
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
