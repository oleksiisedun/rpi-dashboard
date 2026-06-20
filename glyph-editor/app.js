"use strict";

// ════════════════════════════════════════════════════════════════════════════
// Font data — loaded live from font.js via /api/font (served by serve.js),
// so this tool never hand-duplicates glyph bytes. Encoding: bit0 (LSB) = top row,
// bit7 (MSB) = bottom row, 5 bytes per glyph (one per column, left to right).
// ════════════════════════════════════════════════════════════════════════════

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
      '\n\nRun `npm run glyph-editor` (or `node glyph-editor/serve.js`) and open ' +
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

/**
 * Converts 5 column bytes into an 8×5 row/col bit matrix for the pixel grid.
 * @param {number[]} cols - 5 bytes, bit0 (LSB) = top row, bit7 (MSB) = bottom row.
 * @returns {number[][]} 8 rows of 5 bits each.
 */
function colsToBits(cols) {
  return Array.from({length: 8}, (_, r) =>
    Array.from({length: 5}, (_, c) => (cols[c] >> r) & 1)
  );
}

/**
 * Converts the current 8×5 bit matrix back into 5 column bytes.
 * @returns {number[]} 5 bytes, one per column.
 */
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

/**
 * Returns the character list backing the given sidebar tab.
 * @param {'latin'|'cyrillic'|'custom'} tab
 * @returns {string[]}
 */
function getCharsForTab(tab) {
  if (tab === 'latin') return LATIN_CHARS;
  if (tab === 'cyrillic') return CYRILLIC_CHARS;
  return customChars;
}

/**
 * Rebuilds the sidebar character grid for the active tab, applying the search filter.
 * @returns {void}
 */
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

/**
 * Wires each sidebar tab button to switch the active tab and re-render the char list.
 * @returns {void}
 */
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

/**
 * Loads a character into the editor, seeding its bitmap if it's new, and refreshes the UI.
 * @param {string} ch
 * @returns {void}
 */
function loadChar(ch) {
  currentChar = ch;
  if (!font[ch]) font[ch] = [0,0,0,0,0];
  bits = colsToBits(font[ch]);
  document.getElementById('currentCharDisplay').textContent = ch === ' ' ? '␣ (space)' : ch;
  renderAll();
  renderCharList();
}

/**
 * Re-renders every view that depends on the current `bits` matrix.
 * @returns {void}
 */
function renderAll() {
  renderGrid();
  renderPreview();
  renderHex();
  renderSingleOutput();
}

/**
 * Syncs the pixel grid buttons' "on" class with the current `bits` matrix.
 * @returns {void}
 */
function renderGrid() {
  document.querySelectorAll('.px').forEach(px => {
    px.classList.toggle('on', !!bits[+px.dataset.r][+px.dataset.c]);
  });
}

/**
 * Draws the current glyph onto the small canvas preview.
 * @returns {void}
 */
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

/**
 * Updates the per-column hex byte readout under the pixel grid.
 * @returns {void}
 */
function renderHex() {
  const bytes = bitsToBytes();
  document.querySelectorAll('.hex-box').forEach((el, i) => {
    el.textContent = '0x' + bytes[i].toString(16).toUpperCase().padStart(2,'0');
  });
}

/**
 * Commits the current `bits` matrix into `font[currentChar]` and renders the
 * single-glyph `font.js`-style code snippet.
 * @returns {void}
 */
function renderSingleOutput() {
  const bytes = bitsToBytes();
  font[currentChar] = bytes;
  const label = currentChar === ' ' ? 'SP' : currentChar;
  document.getElementById('singleOutput').textContent =
    `[${bytes.map(v=>'0x'+v.toString(16).toUpperCase().padStart(2,'0')).join(',')}], // ${label}`;
}

/**
 * Flags the current character as touched in this session.
 * @returns {void}
 */
function markModified() {
  modified.add(currentChar);
}

// Build pixel grid (once)
const pgrid = document.getElementById('pixelGrid');
let painting = false, paintVal = 0;
document.addEventListener('mouseup', () => painting = false);

/**
 * Builds the 8×5 pixel grid buttons and wires click-drag painting: mousedown toggles
 * the pressed pixel and starts a drag; mouseenter during a drag paints with that
 * same value, so a single drag stroke draws or erases a run of pixels.
 * @returns {void}
 */
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

/**
 * Runs a `bits`-mutating transform, then marks the glyph modified and re-renders.
 * @param {() => void} fn - Mutates the module-level `bits` matrix in place.
 * @returns {void}
 */
function applyTransform(fn) { fn(); markModified(); renderAll(); renderCharList(); }

/** Clears every pixel in the current glyph. @returns {void} */
document.getElementById('clearBtn').onclick   = () => applyTransform(() => { bits = Array.from({length:8},()=>new Array(5).fill(0)); });
/** Inverts every pixel in the current glyph. @returns {void} */
document.getElementById('invertBtn').onclick  = () => applyTransform(() => { bits = bits.map(row=>row.map(v=>1-v)); });
/** Mirrors the current glyph horizontally. @returns {void} */
document.getElementById('flipHBtn').onclick   = () => applyTransform(() => { bits = bits.map(row=>[...row].reverse()); });
/** Mirrors the current glyph vertically. @returns {void} */
document.getElementById('flipVBtn').onclick   = () => applyTransform(() => { bits = [...bits].reverse(); });
/** Shifts the current glyph one column left, discarding the leftmost column. @returns {void} */
document.getElementById('shiftLBtn').onclick  = () => applyTransform(() => { bits = bits.map(r=>[...r.slice(1),0]); });
/** Shifts the current glyph one column right, discarding the rightmost column. @returns {void} */
document.getElementById('shiftRBtn').onclick  = () => applyTransform(() => { bits = bits.map(r=>[0,...r.slice(0,4)]); });
/** Shifts the current glyph one row up, discarding the top row. @returns {void} */
document.getElementById('shiftUBtn').onclick  = () => applyTransform(() => { bits = [...bits.slice(1), new Array(5).fill(0)]; });
/** Shifts the current glyph one row down, discarding the bottom row. @returns {void} */
document.getElementById('shiftDBtn').onclick  = () => applyTransform(() => { bits = [new Array(5).fill(0), ...bits.slice(0,7)]; });

/**
 * Deletes the current custom character entirely (Latin chars can only be cleared,
 * since the editor expects a fixed 95-char Latin range).
 * @returns {void}
 */
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

/**
 * Adds the character typed into the "new char" input as a custom glyph (seeded
 * blank if not already in the font), switches to the Custom tab, and loads it.
 * @returns {void}
 */
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
/**
 * Lets Enter in the "new char" input trigger the Add button instead of submitting a form.
 * @returns {void}
 */
document.getElementById('newCharInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('addCharBtn').click();
});

// ════════════════════════════════════════════════════════════════════════════
// Export — generate font.js-ready code
// ════════════════════════════════════════════════════════════════════════════

/**
 * Formats bytes as a comma-separated `0xNN` list for generated `font.js` code.
 * @param {number[]} bytes
 * @returns {string}
 */
function byteList(bytes) {
  return bytes.map(v => '0x' + v.toString(16).toUpperCase().padStart(2,'0')).join(',');
}

/**
 * Builds one `'char': [bytes],` line per character modified this session, so it
 * can be pasted directly into the relevant object (usually CUSTOM) in font.js.
 * @returns {void}
 */
function generateExport() {
  const lines = [...modified].map(ch => `'${ch}': [${byteList(font[ch])}],`);
  document.getElementById('exportTextarea').value =
    lines.length ? lines.join('\n') : '// No characters modified this session.';
}

document.getElementById('generateBtn').onclick = generateExport;
/**
 * Regenerates the export code and scrolls the export section into view.
 * @returns {void}
 */
document.getElementById('scrollToExport').onclick = () => {
  generateExport();
  document.getElementById('exportSection').scrollIntoView({ behavior: 'smooth' });
};

/**
 * Copies the generated export code to the clipboard, falling back to a
 * select+`execCommand('copy')` for browsers without clipboard API access.
 * @returns {Promise<void>}
 */
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

/**
 * Briefly swaps a button's label to give feedback, then restores it.
 * @param {string} id - Element id of the button.
 * @param {string} text - Temporary label to show.
 * @returns {void}
 */
function flashButton(id, text) {
  const btn = document.getElementById(id);
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1200);
}

// ════════════════════════════════════════════════════════════════════════════
// Import / Export JSON (full session save/restore)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Downloads the full editor session (font, custom chars, modified set) as JSON
 * so work can be resumed later without re-running the export step.
 * @returns {void}
 */
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
/**
 * Restores a previously exported session JSON file, merging it into the
 * current in-memory font state.
 * @param {Event} e
 * @returns {Promise<void>}
 */
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
