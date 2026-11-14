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

interface VirtualKeyboard extends EventTarget {
  overlaysContent: boolean;
  boundingRect: DOMRect;
  show(): void;
  hide(): void;
}

const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;

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

    // A physical keyboard should work even if focus has wandered.
    document.addEventListener('keydown', (e) => {
      if (!this.enabled || document.activeElement === input || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.key.length === 1 && /\p{L}/u.test(e.key)) this.focus(false);
      else if (e.key === 'Enter' && document.activeElement === document.body) o.onSubmit();
    });

    setupKeyboardInsets();
  }

  configure(maxLength: number) {
    this.maxLength = maxLength;
  }

  setEnabled(on: boolean) {
    const { input } = this.o;
    const was = this.enabled;
    this.enabled = on;
    if (on) {
      input.readOnly = false;
      input.removeAttribute('inputmode');
      input.setAttribute('virtualkeyboardpolicy', 'manual');
      return;
    }
    // inputmode="none" tells the browser this field never wants a keyboard,
    // which takes it down on Android even if hide() was missed.
    input.inputMode = 'none';
    void this.hideKeyboard();
    input.readOnly = true;
    // Android can bring the keyboard back a moment later, when the keyboard
    // app catches up with the Enter press or the field being cleared: check
    // again once that has settled.
    if (was) setTimeout(() => void this.hideKeyboard(), 400);
  }

  /** Whether the on-screen keyboard is up, as far as the browser can tell. */
  private keyboardUp() {
    return document.activeElement === this.o.input || !!(vk && vk.boundingRect.height > 0);
  }

  /**
   * Puts the on-screen keyboard away, and resolves once it has been asked to.
   *
   * With virtualkeyboardpolicy="manual" the browser never hides the keyboard
   * by itself, not even on blur, and hide() only works while the field is
   * focused and editable. So: hide while focused, then (when typing is off)
   * switch the field to the "auto" policy and blur it a frame later, so the
   * browser takes the keyboard down as it would for any other field. If focus
   * has already moved on with the keyboard still up, refocus briefly first.
   * Callers that move focus elsewhere (a dialog) should await this first:
   * showModal() makes the field inert, and a hide() still pending is dropped.
   */
  hideKeyboard(): Promise<void> {
    const { input } = this.o;
    if (!this.keyboardUp()) return Promise.resolve();
    const focused = document.activeElement === input;
    input.readOnly = false;
    if (!focused) input.focus({ preventScroll: true });
    vk?.hide();
    return new Promise((resolve) =>
      requestAnimationFrame(() => {
        if (document.activeElement === input && !this.raising) {
          if (!this.enabled) input.setAttribute('virtualkeyboardpolicy', 'auto');
          input.blur();
        }
        if (!this.enabled) input.readOnly = true;
        resolve();
      }),
    );
  }

  /** Set while focus(true) is raising the keyboard, so a pending hide doesn't undo it. */
  private raising = false;

  clear() {
    const { input } = this.o;
    this.o.onChange('');
    // Changing a focused field's text makes Android restart the keyboard,
    // which can bring it back up. Once typing is off, wait for the blur.
    if (!this.enabled && document.activeElement === input) requestAnimationFrame(() => (input.value = ''));
    else input.value = '';
  }

  /** Focuses the field; with showKeyboard, also raises the on-screen keyboard. */
  focus(showKeyboard: boolean) {
    if (!this.enabled) return;
    this.o.input.focus({ preventScroll: true });
    if (showKeyboard) {
      this.raising = true;
      vk?.show();
      requestAnimationFrame(() => requestAnimationFrame(() => (this.raising = false)));
    }
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
