"use strict";

/**
 * display.js — MAX7219 4×(8×8) LED matrix driver
 *
 * Hardware: 4 daisy-chained MAX7219 modules on /dev/spidev0.0
 * Protocol: SPI, MSB first, Mode 0, up to 10 MHz
 *
 * Supports Latin (ASCII 32-126) and Ukrainian Cyrillic.
 * Each glyph is 5 columns wide + 1 blank spacer = 6 px per char.
 *
 * Font encoding: bit 0 (LSB) = top row, bit 7 (MSB) = bottom row.
 */

const { FONT, UNKNOWN_GLYPH } = require("./font");
const config = require("./config");

// ─── Constants ────────────────────────────────────────────────────────────────

const NUM_MODULES = config.display.NUM_MODULES;
const SPI_SPEED   = config.display.SPI_SPEED_HZ;

const REG = {
  NOOP        : 0x00,
  DIGIT0      : 0x01,
  DECODE_MODE : 0x09,
  INTENSITY   : 0x0A,
  SCAN_LIMIT  : 0x0B,
  SHUTDOWN    : 0x0C,
  DISPLAY_TEST: 0x0F,
};

// ─── SPI init ─────────────────────────────────────────────────────────────────

let spi       = null;
let available = false;

try {
  const SpiDev = require("spi-device");
  spi = SpiDev.openSync(0, 0);
  available = true;
  _initMaximChips();
  console.log("[Display] MAX7219 SPI opened OK");
} catch (e) {
  console.warn(`[Display] SPI not available (${e.message}) — running in stub/log mode`);
}

// ─── SPI helpers ──────────────────────────────────────────────────────────────

/**
 * Write the same register/value pair to every daisy-chained MAX7219.
 * @param {number} register
 * @param {number} value
 * @returns {void}
 */
function _writeAll(register, value) {
  if (!spi) return;
  const buf = Buffer.alloc(NUM_MODULES * 2);
  for (let i = 0; i < NUM_MODULES; i++) {
    buf[i * 2]     = register;
    buf[i * 2 + 1] = value;
  }
  spi.transferSync([{ sendBuffer: buf, receiveBuffer: Buffer.alloc(buf.length), byteLength: buf.length, speedHz: SPI_SPEED }]);
}

/**
 * Write a different [register, value] pair to each of the daisy-chained MAX7219s.
 * @param {Array<[number, number]>} moduleData - one [register, value] tuple per module
 * @returns {void}
 */
function _writeEach(moduleData) {
  if (!spi) return;
  const buf = Buffer.alloc(NUM_MODULES * 2);
  for (let i = 0; i < NUM_MODULES; i++) {
    const [reg, val] = moduleData[i] || [REG.NOOP, 0];
    buf[i * 2]     = reg;
    buf[i * 2 + 1] = val;
  }
  spi.transferSync([{ sendBuffer: buf, receiveBuffer: Buffer.alloc(buf.length), byteLength: buf.length, speedHz: SPI_SPEED }]);
}

/**
 * Run the MAX7219 startup sequence (decode mode, scan limit, intensity, power-up) and clear the panel.
 * @returns {void}
 */
function _initMaximChips() {
  _writeAll(REG.SHUTDOWN,     0x00);
  _writeAll(REG.DISPLAY_TEST, 0x00);
  _writeAll(REG.DECODE_MODE,  0x00);
  _writeAll(REG.SCAN_LIMIT,   0x07);
  _writeAll(REG.INTENSITY,    0x05);
  _writeAll(REG.SHUTDOWN,     0x01);
  _clearHardware();
}

/**
 * Blank every row on every module.
 * @returns {void}
 */
function _clearHardware() {
  for (let row = 0; row < 8; row++) _writeAll(REG.DIGIT0 + row, 0x00);
}

/**
 * Set MAX7219 intensity, clamped to the valid hardware range.
 * @param {number} level - 0-15
 * @returns {void}
 */
function _setBrightness(level) {
  _writeAll(REG.INTENSITY, Math.max(0, Math.min(15, level)));
}

// ─── Bitmap helpers ───────────────────────────────────────────────────────────

/**
 * Reverse the bit order of a byte (used to flip glyph columns for 180° rotation).
 * @param {number} b
 * @returns {number}
 */
function _reverseByte(b) {
  b = ((b & 0xF0) >> 4) | ((b & 0x0F) << 4);
  b = ((b & 0xCC) >> 2) | ((b & 0x33) << 2);
  b = ((b & 0xAA) >> 1) | ((b & 0x55) << 1);
  return b;
}

// ─── Scroll buffer ────────────────────────────────────────────────────────────

/**
 * Build the flat column array for the scroll sequence. direction is handled separately in
 * startScroll by scrolling pos backwards.
 * @param {string} text
 * @param {{rotate?: boolean}} [options] - rotate=true applies a 180° flip (column order reversed + bits inverted)
 * @returns {number[]} flat array of column bytes
 */
function _buildScrollBuffer(text, { rotate = false } = {}) {
  const raw = [];

  for (let i = 0; i < NUM_MODULES * 8; i++) raw.push(0x00);

  for (const ch of text) {
    const glyph = FONT[ch] || UNKNOWN_GLYPH;
    for (const col of glyph) raw.push(col);
    raw.push(0x00);
  }

  for (let i = 0; i < NUM_MODULES * 8; i++) raw.push(0x00);

  if (!rotate) return raw;
  return raw.map(b => _reverseByte(b)).reverse();
}

// ─── Frame renderer ───────────────────────────────────────────────────────────

/**
 * Render one 32×8 window of the scroll buffer to the panel (or stdout in stub mode).
 * @param {number[]} columns - full flat column array from _buildScrollBuffer
 * @param {number} startIndex - index of the first visible column
 * @returns {void}
 */
function _pushFrame(columns, startIndex) {
  if (!spi) {
    const slice = columns.slice(startIndex, startIndex + NUM_MODULES * 8);
    process.stdout.write("\r[stub] " + slice.map(b => b.toString(16).padStart(2,"0")).join(" "));
    return;
  }

  for (let row = 0; row < 8; row++) {
    const perModule = [];
    for (let mod = 0; mod < NUM_MODULES; mod++) {
      let rowByte = 0;
      for (let col = 0; col < 8; col++) {
        const byte = columns[startIndex + mod * 8 + col] || 0;
        if ((byte >> row) & 1) rowByte |= (1 << (7 - col));
      }
      perModule.push([REG.DIGIT0 + row, rowByte]);
    }
    _writeEach(perModule);
  }
}

// ─── Scroll loop ──────────────────────────────────────────────────────────────

let _scrollTimer = null;

/**
 * Start (or restart) the scrolling display loop for the given text.
 * @param {string} text
 * @param {{speed?: number, brightness?: number, rotate?: boolean, direction?: 'rtl'|'ltr'}} [options]
 * @returns {void}
 */
function startScroll(text, {
  speed = config.display.DEFAULT_SPEED_MS,
  brightness = config.display.DEFAULT_BRIGHTNESS,
  rotate = config.display.DEFAULT_ROTATE,
  direction = config.display.DEFAULT_DIRECTION,
} = {}) {
  stop();
  if (spi) _setBrightness(brightness);

  const columns   = _buildScrollBuffer(text, { rotate });
  const totalCols = columns.length - NUM_MODULES * 8;

  // rtl: pos goes 0 → totalCols (text enters from right, standard)
  // ltr: pos goes totalCols → 0 (text enters from left)
  let pos = direction === 'ltr' ? totalCols : 0;

  /**
   * Render the current frame and advance the scroll position by one column.
   * @returns {void}
   */
  function tick() {
    _pushFrame(columns, pos);
    if (direction === 'ltr') {
      pos--;
      if (pos < 0) pos = totalCols;
    } else {
      pos++;
      if (pos > totalCols) pos = 0;
    }
    _scrollTimer = setTimeout(tick, speed);
  }

  tick();
}

/**
 * Stop the scroll loop and clear the panel.
 * @returns {void}
 */
function stop() {
  if (_scrollTimer) { clearTimeout(_scrollTimer); _scrollTimer = null; }
  if (!spi) { process.stdout.write("\n"); return; }
  _clearHardware();
}

module.exports = { startScroll, stop, available };
