const express = require("express");
const path = require("path");
const fs = require("fs");
const config = require("./config");

const app = express();
const PORT = config.server.PORT;

// ─── Configuration ────────────────────────────────────────────────────────────

const TOTP_SECRET = config.server.TOTP_SECRET;
const RANDOM_STRINGS_PATH = path.join(__dirname, ".strings");
const RANDOM_STRING_DURATION_MS = config.display.RANDOM_STRING_DURATION_MS;
const DISPLAY_STATE_PATH = path.join(__dirname, ".display-state.json");

/**
 * Persists the current display state and settings to disk so they survive a restart.
 * @param {object} displayState
 * @param {object} displaySettings
 * @returns {void}
 */
function saveDisplayState(displayState, displaySettings) {
  try {
    fs.writeFileSync(DISPLAY_STATE_PATH, JSON.stringify({ displayState, displaySettings }));
  } catch (e) {
    console.warn(`[Display] Could not save state to ${DISPLAY_STATE_PATH}: ${e.message}`);
  }
}

/**
 * Loads the persisted display state and settings from disk, if present.
 * @returns {{ displayState: object, displaySettings: object }|null}
 */
function loadDisplayState() {
  try {
    return JSON.parse(fs.readFileSync(DISPLAY_STATE_PATH, "utf8"));
  } catch (e) {
    return null;
  }
}

/**
 * Reads .strings and returns the non-empty, non-comment lines.
 * @returns {string[]}
 */
function loadRandomStrings() {
  let raw;
  try {
    raw = fs.readFileSync(RANDOM_STRINGS_PATH, "utf8");
  } catch (e) {
    console.warn(`[Display] Could not read ${RANDOM_STRINGS_PATH}: ${e.message}`);
    return [];
  }
  return raw
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Drivers ──────────────────────────────────────────────────────────────────

const { generateTOTP } = require("./totp");
const display = require("./drivers/display");
const keypad  = require("./keypad"); // S1 button → shows TOTP on 7-segment for 15s

// ─── State ────────────────────────────────────────────────────────────────────

let displayState = {
  active: false,
  text: "",
  startedAt: null,
};

// Matrix settings from the last web UI submission — kept around (even after
// stop/S8 overlay) so the S8 random-string feature can reuse them.
let displaySettings = {
  speed: config.display.DEFAULT_SPEED_MS,
  brightness: config.display.DEFAULT_BRIGHTNESS,
  rotate: config.display.DEFAULT_ROTATE,
  direction: config.display.DEFAULT_DIRECTION,
};

const persistedDisplay = loadDisplayState();
if (persistedDisplay) {
  if (persistedDisplay.displayState) displayState = persistedDisplay.displayState;
  if (persistedDisplay.displaySettings) displaySettings = persistedDisplay.displaySettings;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/totp — returns a freshly generated TOTP code.
 * @param {express.Request} req
 * @param {express.Response} res
 * @returns {Promise<void>}
 */
app.get("/api/totp", async (req, res) => {
  try {
    const code = await generateTOTP(TOTP_SECRET);
    res.json({ code });
  } catch (e) {
    console.error("TOTP error:", e.message);
    res.status(500).json({
      error: "Failed to generate TOTP code. Make sure oathtool is installed (sudo apt install oathtool).",
    });
  }
});

/**
 * POST /api/display — start the MAX7219 scroll loop.
 * Body: { text: string, speed?: number (ms per column, default 40), brightness?: number (0-15, default 5), rotate?: boolean, direction?: 'rtl'|'ltr' }
 * @param {express.Request} req
 * @param {express.Response} res
 * @returns {void}
 */
app.post("/api/display", (req, res) => {
  const {
    text,
    speed = config.display.DEFAULT_SPEED_MS,
    brightness = config.display.DEFAULT_BRIGHTNESS,
    rotate = config.display.DEFAULT_ROTATE,
    direction = config.display.DEFAULT_DIRECTION,
  } = req.body;
  if (typeof text !== "string" || text.trim() === "") {
    return res.status(400).json({ error: "text field is required." });
  }

  displayState = {
    active: true,
    text: text.trim(),
    speed,
    brightness,
    rotate,
    direction,
    startedAt: new Date().toISOString(),
  };
  displaySettings = { speed, brightness, rotate, direction };
  saveDisplayState(displayState, displaySettings);

  console.log(`[Display] Starting loop: "${displayState.text}" dir=${direction} rotate=${rotate}`);

  display.startScroll(displayState.text, { speed, brightness, rotate, direction });

  res.json({ ok: true, message: `Displaying: "${displayState.text}"` });
});

/**
 * POST /api/display/stop — stop the scroll loop and clear the MAX7219 panel.
 * @param {express.Request} req
 * @param {express.Response} res
 * @returns {void}
 */
app.post("/api/display/stop", (req, res) => {
  console.log(`[Display] Stopping loop.`);
  display.stop();
  displayState = { active: false, text: "", startedAt: null };
  saveDisplayState(displayState, displaySettings);
  res.json({ ok: true, message: "Display stopped." });
});

/**
 * GET /api/display/status — returns the current MAX7219 display state.
 * @param {express.Request} req
 * @param {express.Response} res
 * @returns {void}
 */
app.get("/api/display/status", (req, res) => {
  res.json(displayState);
});

// ─── S8 button → random string overlay ─────────────────────────────────────────

let s8RevertTimer = null;
let s8PreOverlayState = null; // { active, text } captured just before the current overlay started

/**
 * Show a random line from .strings on the MAX7219 for
 * RANDOM_STRING_DURATION_MS, using the current web UI matrix settings, then
 * restore whatever was showing before (or stop if nothing was active).
 * @returns {void}
 */
function handleS8Press() {
  const strings = loadRandomStrings();
  if (strings.length === 0) {
    console.warn(`[Display] S8 pressed but ${RANDOM_STRINGS_PATH} has no strings`);
    return;
  }

  if (!s8RevertTimer) {
    s8PreOverlayState = { active: displayState.active, text: displayState.text };
  }

  const text = strings[Math.floor(Math.random() * strings.length)];
  console.log(`[Display] S8 pressed — showing random string for ${RANDOM_STRING_DURATION_MS / 1000}s: "${text}"`);
  display.startScroll(text, displaySettings);

  clearTimeout(s8RevertTimer);
  s8RevertTimer = setTimeout(() => {
    s8RevertTimer = null;
    if (s8PreOverlayState.active) {
      display.startScroll(s8PreOverlayState.text, displaySettings);
    } else {
      display.stop();
    }
    s8PreOverlayState = null;
  }, RANDOM_STRING_DURATION_MS);
}

keypad.onS8Press(handleS8Press);

// ─── Restore display state from before the last restart ───────────────────────

if (displayState.active) {
  console.log(`[Display] Restoring previous display: "${displayState.text}"`);
  display.startScroll(displayState.text, displaySettings);
}

// ─── Cleanup on exit ──────────────────────────────────────────────────────────

process.on("SIGINT",  () => { display.stop(); keypad.stop(); process.exit(0); });
process.on("SIGTERM", () => { display.stop(); keypad.stop(); process.exit(0); });

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RPi Dashboard running at http://0.0.0.0:${PORT}`);
  console.log(`TOTP secret: ${TOTP_SECRET === "YOUR_SECRET_KEY" ? "⚠️  NOT SET — update TOTP_SECRET" : "✅ configured"}`);
  console.log(`Display: ${display.available ? "✅ MAX7219 ready" : "⚠️  running in stub mode (no SPI device)"}`);
  console.log(`Keypad:  ${keypad.available ? "✅ TM1638 ready — press S1 to show TOTP" : "⚠️  running in stub mode (no GPIO device)"}`);
});
