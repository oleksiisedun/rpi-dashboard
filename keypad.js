"use strict";

/**
 * keypad.js — TM1638 LED&KEY integration.
 *
 * Behavior: pressing S1 generates a fresh TOTP code and shows it on the
 * 8 seven-segment digits for 10 seconds, then clears the display.
 * Pressing S8 invokes a caller-supplied handler (see onS8Press) — used by
 * server.js to show a random string on the MAX7219.
 */

const { generateTOTP } = require("./totp");

const TOTP_SECRET = process.env.TOTP_SECRET || "YOUR_SECRET_KEY";
const SHOW_DURATION_MS = 10000;
const POLL_INTERVAL_MS = 60; // ~16 Hz — plenty fast for a human button press

let tm = null;
let available = false;

try {
  const TM1638 = require("./tm1638");
  tm = new TM1638({ stb: 29, clk: 31, dio: 33, brightness: 4 });
  available = true;
  console.log("[Keypad] TM1638 initialized OK");
} catch (e) {
  console.warn(`[Keypad] TM1638 not available (${e.message}) — running in stub mode`);
}

// ── 7-segment font (bit0=a ... bit6=g, bit7=dp) ────────────────────────────

const DIGIT_FONT = {
  "0": 0x3F, "1": 0x06, "2": 0x5B, "3": 0x4F, "4": 0x66,
  "5": 0x6D, "6": 0x7D, "7": 0x07, "8": 0x7F, "9": 0x6F,
  " ": 0x00, "-": 0x40,
};

/**
 * Show a string (max 8 chars) on the digit displays, centered with
 * single-space padding if it's the 6-digit TOTP code.
 * @param {string} text
 * @returns {void}
 */
function showOnDigits(text) {
  const padded = text
    .padStart(Math.ceil((8 + text.length) / 2), " ")
    .padEnd(8, " ")
    .slice(0, 8);

  const segments = padded.split("").map(ch => DIGIT_FONT[ch] ?? 0x00);

  if (!tm) {
    console.log(`[Keypad stub] would display: "${padded}"`);
    return;
  }
  tm.setSegments(segments);
}

/**
 * Blank all 7-segment digits.
 * @returns {void}
 */
function clearDigits() {
  if (!tm) { console.log("[Keypad stub] clear"); return; }
  tm.clear();
}

// ── S1 press → show TOTP for 10s ───────────────────────────────────────────

let clearTimer = null;

/**
 * Generate a fresh TOTP code and show it on the digits for SHOW_DURATION_MS,
 * then clear automatically.
 * @returns {Promise<void>}
 */
async function handleS1Press() {
  console.log("[Keypad] S1 pressed — generating TOTP code");
  try {
    const code = await generateTOTP(TOTP_SECRET);
    showOnDigits(code);

    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      clearDigits();
      clearTimer = null;
    }, SHOW_DURATION_MS);
  } catch (e) {
    console.error("[Keypad] TOTP error:", e.message);
    showOnDigits("Err");
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { clearDigits(); clearTimer = null; }, 3000);
  }
}

// ── S8 press → caller-supplied handler ─────────────────────────────────────

let s8Handler = null;

/**
 * Register a handler to invoke once per physical S8 press (rising edge).
 * @param {() => void} handler
 * @returns {void}
 */
function onS8Press(handler) {
  s8Handler = handler;
}

// ── Button polling with edge detection (fires once per physical press) ────

let lastButtons = 0;
let pollHandle = null;

/**
 * Read the button mask and fire handlers once per physical button press (rising edge).
 * @returns {void}
 */
function poll() {
  if (!tm) return;
  let buttons;
  try {
    buttons = tm.getButtons();
  } catch (e) {
    console.error("[Keypad] read error:", e.message);
    return;
  }

  const justPressed = buttons & ~lastButtons;
  if (justPressed & 0x01) handleS1Press();         // bit0 = S1
  if (justPressed & 0x80) s8Handler && s8Handler(); // bit7 = S8

  lastButtons = buttons;
}

/**
 * Begin polling the TM1638 for button presses.
 * @returns {void}
 */
function start() {
  if (!tm) return;
  pollHandle = setInterval(poll, POLL_INTERVAL_MS);
}

/**
 * Stop polling, cancel any pending auto-clear, and blank the digits.
 * @returns {void}
 */
function stop() {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  if (clearTimer)  { clearTimeout(clearTimer);  clearTimer  = null; }
  clearDigits();
}

start();

module.exports = { available, stop, onS8Press };
