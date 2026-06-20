"use strict";

// ════════════════════════════════════════════════════════════════════════════
// Font data — loaded live from font.js via /api/font (served by serve.js),
// so this tool never hand-duplicates glyph bytes. Encoding: bit0 (LSB) = top row,
// bit7 (MSB) = bottom row, 5 bytes per glyph (one per column, left to right).
// ════════════════════════════════════════════════════════════════════════════

// Ukrainian alphabet case pairing — not bitmap data, just used so "Generate font.js
// code" can reproduce font.js's compact lowercase-mirrors-uppercase structure.
const CYR_LOWER_MAP = {
  'а':'А','б':'Б','в':'В','г':'Г','ґ':'Ґ','д':'Д','е':'Е','є':'Є',
  'ж':'Ж','з':'З','и':'И','і':'І','ї':'Ї','й':'Й','к':'К','л':'Л',
  'м':'М','н':'Н','о':'О','п':'П','р':'Р','с':'С','т':'Т','у':'У',
  'ф':'Ф','х':'Х','ц':'Ц','ч':'Ч','ш':'Ш','щ':'Щ','ь':'Ь','ю':'Ю',
  'я':'Я',
};

let LATIN_CHARS = [];
let CYRILLIC_CHARS = [];

// ════════════════════════════════════════════════════════════════════════════
// State
// ════════════════════════════════════════════════════════════════════════════

// font[char] = [b0,b1,b2,b3,b4]
const font = {};
const modified = new Set(); // chars touched in this session
const customChars = [];     // chars added that aren't in Latin or Cyrillic sets

let currentChar = 'A';
let currentTab = 'latin';
let bits = colsToBits([0,0,0,0,0]);

/**
 * Fetches the real font tables from font.js (via /api/font) and seeds
 * LATIN_CHARS, CYRILLIC_CHARS, customChars and the font[] state from them.
 * @returns {Promise<void>}
 */
async function loadFontData() {
  let data;
  try {
    const res = await fetch('/api/font');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    alert(
      'Could not load font data from /api/font: ' + err.message +
      '\n\nRun `npm run glyph-editor` (or `node tools/glyph-editor/serve.js`) and open ' +
      'this page at http://localhost:4000/ — opening the file directly will not work.'
    );
    return;
  }

  LATIN_CHARS = Array.from({ length: data.LATIN_RAW.length }, (_, i) => String.fromCharCode(32 + i));
  LATIN_CHARS.forEach((ch, i) => { font[ch] = [...data.LATIN_RAW[i]]; });

  CYRILLIC_CHARS = Object.keys(data.CYR);
  CYRILLIC_CHARS.forEach(ch => { font[ch] = [...data.CYR[ch]]; });

  customChars.push(...Object.keys(data.CUSTOM));
  customChars.forEach(ch => { font[ch] = [...data.CUSTOM[ch]]; });

  loadChar('A');
  renderCharList();
}

function colsToBits(cols) {
  return Array.from({length: 8}, (_, r) =>
    Array.from({length: 5}, (_, c) => (cols[c] >> r) & 1)
  );
}
function bitsToBytes() {
  return Array.from({length: 5}, (_, c) => {
    let b = 0;
    for (let r = 0; r < 8; r++) if (bits[r][c]) b |= (1 << r);
    return b;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Sidebar — char list
// ════════════════════════════════════════════════════════════════════════════

const charListEl = document.getElementById('charList');
const searchInput = document.getElementById('searchInput');

function getCharsForTab(tab) {
  if (tab === 'latin') return LATIN_CHARS;
  if (tab === 'cyrillic') return CYRILLIC_CHARS;
  return customChars;
}

function renderCharList() {
  const filter = searchInput.value.trim();
  const chars = getCharsForTab(currentTab).filter(ch =>
    !filter || ch.toLowerCase().includes(filter.toLowerCase())
  );

  charListEl.innerHTML = '';
  if (chars.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'grid-column:1/-1;color:var(--muted);font-size:12px;padding:10px;font-family:var(--mono)';
    empty.textContent = currentTab === 'custom' ? 'No custom characters yet — add one below.' : 'No matches.';
    charListEl.appendChild(empty);
    return;
  }

  for (const ch of chars) {
    const cell = document.createElement('button');
    cell.className = 'char-cell' + (ch === currentChar ? ' active' : '') + (modified.has(ch) ? ' modified' : '');
    cell.textContent = ch === ' ' ? '␣' : ch;
    cell.title = ch === ' ' ? 'space' : `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}`;
    cell.onclick = () => loadChar(ch);
    charListEl.appendChild(cell);
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderCharList();
  };
});
searchInput.addEventListener('input', renderCharList);

// ════════════════════════════════════════════════════════════════════════════
// Editor — pixel grid
// ════════════════════════════════════════════════════════════════════════════

function loadChar(ch) {
  currentChar = ch;
  if (!font[ch]) font[ch] = [0,0,0,0,0];
  bits = colsToBits(font[ch]);
  document.getElementById('currentCharDisplay').textContent = ch === ' ' ? '␣ (space)' : ch;
  renderAll();
  renderCharList();
}

function renderAll() {
  renderGrid();
  renderPreview();
  renderHex();
  renderSingleOutput();
}

function renderGrid() {
  document.querySelectorAll('.px').forEach(px => {
    px.classList.toggle('on', !!bits[+px.dataset.r][+px.dataset.c]);
  });
}

function renderPreview() {
  const cv = document.getElementById('prev');
  const ctx = cv.getContext('2d');
  const S = 13, P = 2;
  ctx.fillStyle = '#181d25';
  ctx.fillRect(0, 0, cv.width, cv.height);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 5; c++) {
      ctx.fillStyle = bits[r][c] ? '#ff5f40' : '#1f2530';
      ctx.fillRect(c*(S+P), r*(S+P), S, S);
    }
}

function renderHex() {
  const bytes = bitsToBytes();
  document.querySelectorAll('.hex-box').forEach((el, i) => {
    el.textContent = '0x' + bytes[i].toString(16).toUpperCase().padStart(2,'0');
  });
}

function renderSingleOutput() {
  const bytes = bitsToBytes();
  font[currentChar] = bytes;
  const label = currentChar === ' ' ? 'SP' : currentChar;
  document.getElementById('singleOutput').textContent =
    `[${bytes.map(v=>'0x'+v.toString(16).toUpperCase().padStart(2,'0')).join(',')}], // ${label}`;
}

function markModified() {
  modified.add(currentChar);
}

// Build pixel grid (once)
const pgrid = document.getElementById('pixelGrid');
let painting = false, paintVal = 0;
document.addEventListener('mouseup', () => painting = false);

for (let r = 0; r < 8; r++)
  for (let c = 0; c < 5; c++) {
    const px = document.createElement('button');
    px.className = 'px'; px.dataset.r = r; px.dataset.c = c;
    px.addEventListener('mousedown', e => {
      painting = true; paintVal = bits[r][c] ? 0 : 1;
      bits[r][c] = paintVal; markModified(); renderAll(); renderCharList(); e.preventDefault();
    });
    px.addEventListener('mouseenter', () => {
      if (painting) { bits[+px.dataset.r][+px.dataset.c] = paintVal; markModified(); renderAll(); }
    });
    pgrid.appendChild(px);
  }

const colLabelsEl = document.getElementById('colLabels');
for (let c = 0; c < 5; c++) { const d=document.createElement('div'); d.className='cl'; d.textContent=c; colLabelsEl.appendChild(d); }
const rowLabelsEl = document.getElementById('rowLabels');
for (let r = 0; r < 8; r++) { const d=document.createElement('div'); d.className='rl'; d.textContent=r; rowLabelsEl.appendChild(d); }
const hexRowEl = document.getElementById('hexRow');
for (let c = 0; c < 5; c++) { const d=document.createElement('div'); d.className='hex-box'; hexRowEl.appendChild(d); }

// ════════════════════════════════════════════════════════════════════════════
// Transform tools
// ════════════════════════════════════════════════════════════════════════════

function applyTransform(fn) { fn(); markModified(); renderAll(); renderCharList(); }

document.getElementById('clearBtn').onclick   = () => applyTransform(() => { bits = Array.from({length:8},()=>new Array(5).fill(0)); });
document.getElementById('invertBtn').onclick  = () => applyTransform(() => { bits = bits.map(row=>row.map(v=>1-v)); });
document.getElementById('flipHBtn').onclick   = () => applyTransform(() => { bits = bits.map(row=>[...row].reverse()); });
document.getElementById('flipVBtn').onclick   = () => applyTransform(() => { bits = [...bits].reverse(); });
document.getElementById('shiftLBtn').onclick  = () => applyTransform(() => { bits = bits.map(r=>[...r.slice(1),0]); });
document.getElementById('shiftRBtn').onclick  = () => applyTransform(() => { bits = bits.map(r=>[0,...r.slice(0,4)]); });
document.getElementById('shiftUBtn').onclick  = () => applyTransform(() => { bits = [...bits.slice(1), new Array(5).fill(0)]; });
document.getElementById('shiftDBtn').onclick  = () => applyTransform(() => { bits = [new Array(5).fill(0), ...bits.slice(0,7)]; });

document.getElementById('deleteCharBtn').onclick = () => {
  if (LATIN_CHARS.includes(currentChar)) {
    alert('Latin characters can be cleared but not deleted (fixed 95-char range). Use Clear instead.');
    return;
  }
  if (!confirm(`Delete "${currentChar}" entirely?`)) return;
  delete font[currentChar];
  modified.delete(currentChar);
  const idx = customChars.indexOf(currentChar);
  if (idx >= 0) customChars.splice(idx, 1);
  const fallback = getCharsForTab(currentTab)[0] || 'A';
  loadChar(fallback);
};

// ════════════════════════════════════════════════════════════════════════════
// Add new character
// ════════════════════════════════════════════════════════════════════════════

document.getElementById('addCharBtn').onclick = () => {
  const input = document.getElementById('newCharInput');
  const ch = input.value;
  if (!ch) return;
  if (!font[ch]) {
    font[ch] = [0,0,0,0,0];
    if (!LATIN_CHARS.includes(ch) && !CYRILLIC_CHARS.includes(ch) && !customChars.includes(ch)) {
      customChars.push(ch);
    }
  }
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.tab[data-tab="custom"]').classList.add('active');
  currentTab = 'custom';
  if (!customChars.includes(ch)) customChars.push(ch);
  input.value = '';
  loadChar(ch);
};
document.getElementById('newCharInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('addCharBtn').click();
});

// ════════════════════════════════════════════════════════════════════════════
// Export — generate font.js-ready code
// ════════════════════════════════════════════════════════════════════════════

function byteList(bytes) {
  return bytes.map(v => '0x' + v.toString(16).toUpperCase().padStart(2,'0')).join(',');
}

function generateExport() {
  // LATIN_RAW — fixed order, 95 entries
  const latinLines = LATIN_CHARS.map(ch => {
    const label = ch === ' ' ? 'SP' : ch;
    return `  [${byteList(font[ch])}], // ${label}`;
  });

  // CYR — canonical uppercase entries only; lowercase is mirrored via CYR_LOWER below
  const cyrUpperChars = CYRILLIC_CHARS.filter(ch => !(ch in CYR_LOWER_MAP));
  const cyrLines = cyrUpperChars.map(ch => `  '${ch}': [${byteList(font[ch])}],`);

  const customLines = customChars.map(ch => `  '${ch}': [${byteList(font[ch])}],`);

  const out = [
    'const LATIN_RAW = [',
    latinLines.join('\n'),
    '];',
    'for (let i = 0; i < LATIN_RAW.length; i++) {',
    '  FONT[String.fromCharCode(32 + i)] = LATIN_RAW[i];',
    '}',
    '',
    'const CYR = {',
    cyrLines.join('\n'),
    '};',
    '',
    '// Lowercase → same bitmap as uppercase',
    'const CYR_LOWER = {',
    '  ' + Object.entries(CYR_LOWER_MAP).map(([lo,up]) => `'${lo}':'${up}'`).join(','),
    '};',
    'for (const [lo, up] of Object.entries(CYR_LOWER)) CYR[lo] = CYR[up];',
    'Object.assign(FONT, CYR);',
    '',
    'const CUSTOM = {',
    customLines.join('\n'),
    '};',
    'Object.assign(FONT, CUSTOM);',
  ].join('\n');

  document.getElementById('exportTextarea').value = out;
}

document.getElementById('generateBtn').onclick = generateExport;
document.getElementById('scrollToExport').onclick = () => {
  generateExport();
  document.getElementById('exportSection').scrollIntoView({ behavior: 'smooth' });
};

document.getElementById('copyExportBtn').onclick = async () => {
  const ta = document.getElementById('exportTextarea');
  if (!ta.value) generateExport();
  try {
    await navigator.clipboard.writeText(document.getElementById('exportTextarea').value);
    flashButton('copyExportBtn', 'Copied!');
  } catch {
    ta.select();
    document.execCommand('copy');
    flashButton('copyExportBtn', 'Copied!');
  }
};

document.getElementById('downloadBtn').onclick = () => {
  if (!document.getElementById('exportTextarea').value) generateExport();
  const blob = new Blob([document.getElementById('exportTextarea').value], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'font-export.js';
  a.click();
  URL.revokeObjectURL(url);
};

function flashButton(id, text) {
  const btn = document.getElementById(id);
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1200);
}

// ════════════════════════════════════════════════════════════════════════════
// Import / Export JSON (full session save/restore)
// ════════════════════════════════════════════════════════════════════════════

document.getElementById('exportJsonBtn').onclick = () => {
  const payload = {
    font,
    customChars,
    modified: [...modified],
    savedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'glyph-editor-session.json';
  a.click();
  URL.revokeObjectURL(url);
};

document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.font) Object.assign(font, data.font);
    if (data.customChars) data.customChars.forEach(ch => { if (!customChars.includes(ch)) customChars.push(ch); });
    if (data.modified) data.modified.forEach(ch => modified.add(ch));
    loadChar(currentChar);
    renderCharList();
    alert('Session imported successfully.');
  } catch (err) {
    alert('Failed to import: ' + err.message);
  }
  e.target.value = '';
});

// ════════════════════════════════════════════════════════════════════════════
// Init
// ════════════════════════════════════════════════════════════════════════════

loadFontData();
