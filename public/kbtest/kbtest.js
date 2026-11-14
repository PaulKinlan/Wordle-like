// Standalone keyboard test: no game code, one way of closing per button.
const vk = navigator.virtualKeyboard;
const field = document.getElementById('field');
const logEl = document.getElementById('log');
const hEl = document.getElementById('h');
const lines = [];
const height = () => (vk ? Math.round(vk.boundingRect.height) : -1);
const gesture = () => (navigator.userActivation ? navigator.userActivation.isActive : 'n/a');
function log(...parts) {
  const t = new Date().toISOString().slice(11, 23);
  lines.push(`${t} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`);
  logEl.textContent = lines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}
const state = () => ({
  vk: height(),
  focused: document.activeElement === field,
  policy: field.getAttribute('virtualkeyboardpolicy'),
  inputmode: field.getAttribute('inputmode'),
  gesture: gesture(),
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n) => new Promise((r) => { const s = () => (--n <= 0 ? r() : requestAnimationFrame(s)); requestAnimationFrame(s); });

if (vk) {
  vk.overlaysContent = true;
  vk.addEventListener('geometrychange', () => { hEl.textContent = String(height()); log('geometry', height()); });
} else log('no navigator.virtualKeyboard');
log('ua', navigator.userAgent);

function reset() {
  field.disabled = false;
  field.readOnly = false;
  field.removeAttribute('inputmode');
  field.setAttribute('virtualkeyboardpolicy', 'manual');
}
// Opens the keyboard the way the game does: focus + show() inside the tap.
function open() {
  reset();
  field.focus();
  vk?.show();
  log('open', state());
}

const closers = {
  'hide()': () => vk.hide(),
  'blur()': () => field.blur(),
  'hide() then blur()': () => { vk.hide(); field.blur(); },
  'auto policy, frame, blur()': async () => { field.setAttribute('virtualkeyboardpolicy', 'auto'); await frames(2); field.blur(); },
  'inputmode none (stay focused)': () => { field.setAttribute('inputmode', 'none'); },
  'inputmode none, blur, frame, focus': async () => { field.setAttribute('inputmode', 'none'); field.blur(); await frames(2); field.focus(); },
  'readonly (stay focused)': () => { field.readOnly = true; },
  'disabled': () => { field.disabled = true; },
};

const tests = document.getElementById('tests');
for (const [name, close] of Object.entries(closers)) {
  for (const mode of ['tap', 'timer']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${name} · ${mode}`;
    // Keep focus on the field when a button is tapped.
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', async () => {
      log(`--- test: ${name} · ${mode}`);
      if (mode === 'tap') {
        // The keyboard must already be open: tap "Open keyboard" first.
        log('before', state());
        await close();
      } else {
        open();
        log('waiting 6s, no tap (so the tap gesture has run out)…');
        await wait(6000);
        log('before', state());
        await close();
      }
      await wait(800);
      log('after 0.8s', state(), height() > 0 ? 'STILL UP' : 'CLOSED');
    });
    tests.append(b);
  }
}
const openBtn = document.createElement('button');
openBtn.type = 'button';
openBtn.textContent = 'Open keyboard';
openBtn.addEventListener('pointerdown', (e) => e.preventDefault());
openBtn.addEventListener('click', open);
const blank = document.createElement('span');
tests.prepend(openBtn, blank);

document.getElementById('copy').addEventListener('click', () => navigator.clipboard.writeText(lines.join('\n')).then(() => log('copied')));
document.getElementById('clear').addEventListener('click', () => { lines.length = 0; logEl.textContent = ''; });
