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
    input.addEventListener('pointerup', () => this.focus(true));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.enabled) o.onSubmit();
    });

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
    this.enabled = on;
    this.o.input.readOnly = !on;
    if (!on) {
      this.o.input.blur();
      vk?.hide();
    }
  }

  clear() {
    this.o.input.value = '';
    this.o.onChange('');
  }

  /** Focuses the field; with showKeyboard, also raises the on-screen keyboard. */
  focus(showKeyboard: boolean) {
    if (!this.enabled) return;
    this.o.input.focus({ preventScroll: true });
    if (showKeyboard) vk?.show();
  }

  private clean(value: string) {
    return [...this.o.normalize(value)].slice(0, this.maxLength).join('');
  }

  private sync() {
    const { input } = this.o;
    const letters = this.clean(input.value);
    if (input.value !== letters) input.value = letters;
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
