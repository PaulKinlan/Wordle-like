// A test page for finding which kind of text field stops the phone keyboard's
// word predictions. Not linked from the game. Results stay in localStorage.
const COMMON = { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', writingsuggestions: 'false' };

const VARIANTS = [
  { id: 'current', name: 'What the game uses now', attrs: { type: 'text', inputmode: 'text', ...COMMON } },
  { id: 'bare', name: 'Plain text field (nothing turned off)', attrs: { type: 'text' } },
  { id: 'password', name: 'Password field', attrs: { type: 'password', ...COMMON } },
  { id: 'email', name: 'Email field', attrs: { type: 'email', ...COMMON } },
  { id: 'url', name: 'URL field', attrs: { type: 'url', ...COMMON } },
  { id: 'search', name: 'Search field', attrs: { type: 'search', ...COMMON } },
  { id: 'im-email', name: 'Text field with email keyboard', attrs: { type: 'text', inputmode: 'email', ...COMMON } },
  { id: 'im-url', name: 'Text field with URL keyboard', attrs: { type: 'text', inputmode: 'url', ...COMMON } },
  { id: 'otp', name: 'One-time-code field', attrs: { type: 'text', ...COMMON, autocomplete: 'one-time-code' } },
  { id: 'clear', name: 'Cleared after every letter (no word for the keyboard to guess from)', attrs: { type: 'text', ...COMMON }, clear: true },
  { id: 'ce', name: 'Editable box instead of a field', editable: true },
];

const KEY = 'letterly:lab:ime';
let results = {};
try { results = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(results)); } catch { /* ignore */ } };

const letters = (s) => [...s.normalize('NFC').toLowerCase()].filter((c) => /\p{L}/u.test(c)).join('');
const list = document.getElementById('variants');

for (const v of VARIANTS) {
  const li = document.createElement('li');
  const h = document.createElement('h2');
  h.textContent = v.name;
  const code = document.createElement('code');
  let field;
  if (v.editable) {
    field = document.createElement('div');
    field.contentEditable = 'true';
    for (const [k, val] of Object.entries(COMMON)) field.setAttribute(k, val);
    code.textContent = '<div contenteditable spellcheck=false autocorrect=off autocapitalize=none writingsuggestions=false>';
  } else {
    field = document.createElement('input');
    for (const [k, val] of Object.entries(v.attrs)) field.setAttribute(k, val);
    field.name = `lab-${v.id}`;
    field.setAttribute('data-1p-ignore', '');
    field.setAttribute('data-lpignore', 'true');
    code.textContent = `<input ${Object.entries(v.attrs).map(([k, val]) => `${k}="${val}"`).join(' ')}>`;
  }
  const got = document.createElement('div');
  got.className = 'got';
  let typed = '';
  field.addEventListener('input', (e) => {
    const raw = v.editable ? field.textContent : field.value;
    if (v.clear) {
      if (e.isComposing) return;
      typed = (typed + letters(raw)).slice(-12);
      field.value = '';
    } else {
      typed = letters(raw);
    }
    got.textContent = typed || ' ';
  });
  if (v.clear) field.addEventListener('compositionend', () => { typed = (typed + letters(field.value)).slice(-12); field.value = ''; got.textContent = typed; });
  got.textContent = ' ';

  const ask = document.createElement('div');
  ask.className = 'ask';
  const q = (key, label) => {
    const l = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!results[v.id]?.[key];
    box.addEventListener('change', () => { results[v.id] = { ...results[v.id], [key]: box.checked }; save(); });
    l.append(box, label);
    return l;
  };
  ask.append(q('predictions', 'Predictions shown'), q('accentsOk', 'Accents work'), q('odd', 'Something odd'));
  li.append(h, code, field, got, ask);
  list.append(li);
}

document.getElementById('ua').textContent = navigator.userAgent;
document.getElementById('copy').addEventListener('click', async () => {
  const lines = VARIANTS.map((v) => {
    const r = results[v.id] || {};
    return `${v.id}: predictions=${r.predictions ? 'yes' : 'no'} accents=${r.accentsOk ? 'ok' : 'no'}${r.odd ? ' odd' : ''}`;
  });
  const text = `${navigator.userAgent}\n${lines.join('\n')}`;
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  document.getElementById('copied').hidden = false;
});
