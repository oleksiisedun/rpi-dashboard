require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const config = require("./config");

const execFileAsync = promisify(execFile);

const app = express();
const PORT = config.server.PORT;

// ─── Configuration ────────────────────────────────────────────────────────────

const TOTP_SECRET = config.server.TOTP_SECRET;
const OVERLAY_DURATION_MS = config.display.OVERLAY_DURATION_MS;
const DISPLAY_STATE_PATH = path.join(__dirname, ".display-state.json");

/**
 * Persists the current display state, settings, and ambient state to disk so they survive a restart.
 * @param {object} displayState
 * @param {object} displaySettings
 * @param {object} ambientState
 * @returns {void}
 */
function saveDisplayState(displayState, displaySettings, ambientState) {
  try {
    fs.writeFileSync(DISPLAY_STATE_PATH, JSON.stringify({ displayState, displaySettings, ambientState }));
  } catch (e) {
    console.warn(`[Display] Could not save state to ${DISPLAY_STATE_PATH}: ${e.message}`);
  }
}

/**
 * Loads the persisted display state, settings, and ambient state from disk, if present.
 * @returns {{ displayState: object, displaySettings: object, ambientState?: object }|null}
 */
function loadDisplayState() {
  try {
    return JSON.parse(fs.readFileSync(DISPLAY_STATE_PATH, "utf8"));
  } catch (e) {
    return null;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Drivers ──────────────────────────────────────────────────────────────────

const { generateTOTP } = require("./totp");
const display = require("./drivers/display");
const ambient = require("./drivers/ambient");
const { CUSTOM } = require("./drivers/font");
const keypad  = require("./keypad"); // S1 button → shows TOTP on 7-segment for 15s

// ─── State ────────────────────────────────────────────────────────────────────

let displayState = {
  active: false,
  text: "",
  startedAt: null,
};

// Matrix settings from the last web UI submission — kept around (even after
// stop/overlay) so the S2 overlay feature can reuse it.
let displaySettings = {
  speed: config.display.DEFAULT_SPEED_MS,
  brightness: config.display.DEFAULT_BRIGHTNESS,
  rotate: config.display.DEFAULT_ROTATE,
  direction: config.display.DEFAULT_DIRECTION,
};

// Ambient mode state — mutually exclusive with displayState (see mutual-exclusion
// handling in the /api/display and /api/ambient/* routes below).
let ambientState = {
  active: false,
  animation: config.ambient.DEFAULT_ANIMATION,
  brightness: config.ambient.DEFAULT_BRIGHTNESS,
  startedAt: null,
};

const persistedDisplay = loadDisplayState();
if (persistedDisplay) {
  if (persistedDisplay.displayState) displayState = persistedDisplay.displayState;
  if (persistedDisplay.displaySettings) displaySettings = persistedDisplay.displaySettings;
  if (persistedDisplay.ambientState) ambientState = persistedDisplay.ambientState;
}

// Wi-Fi credentials for the S3 overlay — fetched once at startup (see
// refreshWifiCredentials() below) and cached here so S3 press is an instant cache
// read instead of a per-press `sudo nmcli` round trip.
let cachedWifiCreds = null;

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
  if (typeof speed !== "number" || speed <= 0) {
    return res.status(400).json({ error: "speed must be a positive number." });
  }
  if (typeof brightness !== "number" || brightness < 0 || brightness > 15) {
    return res.status(400).json({ error: "brightness must be a number between 0 and 15." });
  }
  if (typeof rotate !== "boolean") {
    return res.status(400).json({ error: "rotate must be a boolean." });
  }
  if (direction !== "rtl" && direction !== "ltr") {
    return res.status(400).json({ error: "direction must be 'rtl' or 'ltr'." });
  }

  cancelOverlayRevert();

  // Mutual exclusion: scrolling text always wins over ambient mode.
  ambient.stop();
  ambientState = { ...ambientState, active: false, startedAt: null };

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
  saveDisplayState(displayState, displaySettings, ambientState);

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
  cancelOverlayRevert();
  display.stop();
  displayState = { active: false, text: "", startedAt: null };
  saveDisplayState(displayState, displaySettings, ambientState);
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

/**
 * GET /api/custom-symbols — returns the literal characters available in font.js's CUSTOM set.
 * @param {express.Request} req
 * @param {express.Response} res
 * @returns {void}
 */
app.get("/api/custom-symbols", (req, res) => {
  res.json({ symbols: Object.keys(CUSTOM) });
});

/**
 * POST /api/ambient/start — stop any scrolling text and start an ambient animation.
 * Body: { animation: string (one of ambient.ANIMATIONS), brightness?: number (0-15) }
 * @param {express.Request} req
 * @param {express.Response} res
 * @returns {void}
 */
app.post("/api/ambient/start", (req, res) => {
  const { animation, brightness = config.ambient.DEFAULT_BRIGHTNESS } = req.body;
  if (!ambient.ANIMATIONS.includes(animation)) {
    return res.status(400).json({ error: `animation must be one of: ${ambient.ANIMATIONS.join(", ")}` });
  }
  if (typeof brightness !== "number" || brightness < 0 || brightness > 15) {
    return res.status(400).json({ error: "brightness must be a number between 0 and 15." });
  }

  cancelOverlayRevert();

  // Mutual exclusion: ambient mode always wins over scrolling text.
  display.stop();
  displayState = { active: false, text: "", startedAt: null };

  ambientState = { active: true, animation, brightness, startedAt: new Date().toISOString() };
  saveDisplayState(displayState, displaySettings, ambientState);

  console.log(`[Ambient] Starting animation: ${animation}`);
  ambient.start(animation, { brightness });

  res.json({ ok: true, message: `Ambient mode: ${animation}` });
});

/**
 * POST /api/ambient/stop — stop the ambient animation and clear the MAX7219 panel.
 * @param {express.Request} req
 * @param {express.Response} res
 * @returns {void}
 */
app.post("/api/ambient/stop", (req, res) => {
  console.log(`[Ambient] Stopping animation.`);
  ambient.stop();
  ambientState = { ...ambientState, active: false, startedAt: null };
  saveDisplayState(displayState, displaySettings, ambientState);
  res.json({ ok: true, message: "Ambient mode stopped." });
});

/**
 * GET /api/ambient/status — returns the current ambient mode state.
 * @param {express.Request} req
 * @param {express.Response} res
 * @returns {void}
 */
app.get("/api/ambient/status", (req, res) => {
  res.json(ambientState);
});

// ─── S2 button → temporary matrix overlay ──────────────────────────────────────

let overlayRevertTimer = null;
let preOverlayState = null; // snapshot of displayState/ambientState captured just before the current overlay started

/**
 * Cancel any pending overlay revert, so a stale pre-overlay snapshot can't
 * later clobber a display state set explicitly after the overlay started.
 * @returns {void}
 */
function cancelOverlayRevert() {
  if (!overlayRevertTimer) return;
  clearTimeout(overlayRevertTimer);
  overlayRevertTimer = null;
  preOverlayState = null;
}

/**
 * Show text on the MAX7219 for OVERLAY_DURATION_MS, using the current web UI
 * matrix settings, then restore whatever was showing before — resuming ambient
 * mode (with its animation/brightness) if that's what was interrupted, resuming
 * scrolling text if that was active, or stopping if nothing was. Used by the S2
 * (LAN IP) and S3 (Wi-Fi password) overlays.
 * @param {string} text
 * @returns {void}
 */
function showOverlay(text) {
  if (!overlayRevertTimer) {
    preOverlayState = {
      displayActive: displayState.active,
      displayText: displayState.text,
      ambientActive: ambientState.active,
      ambientAnimation: ambientState.animation,
      ambientBrightness: ambientState.brightness,
    };
  }

  if (ambientState.active) {
    ambient.stop();
    ambientState = { ...ambientState, active: false, startedAt: null };
    saveDisplayState(displayState, displaySettings, ambientState);
  }

  display.startScroll(text, displaySettings);

  clearTimeout(overlayRevertTimer);
  overlayRevertTimer = setTimeout(() => {
    overlayRevertTimer = null;
    if (preOverlayState.ambientActive) {
      console.log(`[Ambient] Resuming ambient animation after overlay: ${preOverlayState.ambientAnimation}`);
      // The overlay's scroll loop (display.js's own timer) is still running at
      // this point — ambient.start() only clears ambient's timer, not display's,
      // so it must be stopped explicitly or both loops render concurrently.
      display.stop();
      ambientState = {
        active: true,
        animation: preOverlayState.ambientAnimation,
        brightness: preOverlayState.ambientBrightness,
        startedAt: new Date().toISOString(),
      };
      saveDisplayState(displayState, displaySettings, ambientState);
      ambient.start(preOverlayState.ambientAnimation, { brightness: preOverlayState.ambientBrightness });
    } else if (preOverlayState.displayActive) {
      display.startScroll(preOverlayState.displayText, displaySettings);
    } else {
      display.stop();
    }
    preOverlayState = null;
  }, OVERLAY_DURATION_MS);
}

/**
 * Returns this machine's first non-internal IPv4 LAN address, or null if none
 * is found (e.g. no network connected).
 * @returns {string|null}
 */
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const ifaceList of Object.values(interfaces)) {
    for (const iface of ifaceList) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

/**
 * Show this machine's LAN IP and port on the MAX7219 for OVERLAY_DURATION_MS.
 * @returns {void}
 */
function handleS2Press() {
  const ip = getLanIp();
  if (!ip) {
    console.warn("[Display] S2 pressed but no LAN IP address was found");
    return;
  }

  const text = `${ip}:${PORT}`;
  console.log(`[Display] S2 pressed — showing IP for ${OVERLAY_DURATION_MS / 1000}s: "${text}"`);
  showOverlay(text);
}

keypad.onS2Press(handleS2Press);

/**
 * Fetches the active Wi-Fi connection's SSID and password via `nmcli`. Needs `sudo` —
 * NetworkManager only returns the secret to an authorized session, which the service
 * (no interactive login) doesn't have; requires a NOPASSWD sudoers rule (see README).
 * @returns {Promise<{ ssid: string, password: string }|null>} null if there's no active Wi-Fi connection
 */
async function getWifiCredentials() {
  try {
    const { stdout } = await execFileAsync("sudo", ["nmcli", "device", "wifi", "show-password"]);
    const ssidMatch = stdout.match(/^SSID:\s*(.+)$/m);
    if (!ssidMatch) return null;
    const passwordMatch = stdout.match(/^Password:\s*(.+)$/m);
    return { ssid: ssidMatch[1], password: passwordMatch ? passwordMatch[1] : "(open)" };
  } catch (e) {
    console.warn(`[Display] Could not read Wi-Fi credentials: ${e.message}`);
    return null;
  }
}

/**
 * Fetches Wi-Fi credentials via `getWifiCredentials()` and stores them in `cachedWifiCreds`.
 * Called once at startup so S3 press never has to wait on the `sudo nmcli` round trip.
 * @returns {Promise<void>}
 */
async function refreshWifiCredentials() {
  cachedWifiCreds = await getWifiCredentials();
  if (cachedWifiCreds) {
    console.log(`[WiFi] cached credentials for "${cachedWifiCreds.ssid}"`);
  } else {
    console.warn("[WiFi] no active Wi-Fi connection found at startup — S3 will no-op until this succeeds");
  }
}

/**
 * Show the current Wi-Fi network's cached password on the MAX7219 for OVERLAY_DURATION_MS.
 * @returns {void}
 */
function handleS3Press() {
  if (!cachedWifiCreds) {
    console.warn("[Display] S3 pressed but no cached Wi-Fi credentials are available yet");
    return;
  }

  console.log(`[Display] S3 pressed — showing password for "${cachedWifiCreds.ssid}" for ${OVERLAY_DURATION_MS / 1000}s: "${cachedWifiCreds.password}"`);
  showOverlay(cachedWifiCreds.password);
}

keypad.onS3Press(handleS3Press);

// ─── S8 button → toggle ambient mode on/off ────────────────────────────────────

/**
 * Toggle ambient mode: stop it if currently active, otherwise start it (reusing
 * the last-used animation/brightness) and stop any scrolling text, mirroring the
 * mutual-exclusion handling in the /api/ambient/start route.
 * @returns {void}
 */
function handleS8Press() {
  cancelOverlayRevert();

  if (ambientState.active) {
    console.log("[Ambient] S8 pressed — stopping ambient mode");
    ambient.stop();
    ambientState = { ...ambientState, active: false, startedAt: null };
  } else {
    console.log(`[Ambient] S8 pressed — starting ambient mode: ${ambientState.animation}`);
    display.stop();
    displayState = { active: false, text: "", startedAt: null };
    ambientState = { ...ambientState, active: true, startedAt: new Date().toISOString() };
    ambient.start(ambientState.animation, { brightness: ambientState.brightness });
  }

  saveDisplayState(displayState, displaySettings, ambientState);
}

keypad.onS8Press(handleS8Press);

// ─── Restore display state from before the last restart ───────────────────────

// A persisted animation name can go stale across a deploy that renames/removes
// animations (the state file survives deploys — see config.js's deploy exclusions).
// Sanitize before restoring so a stale name can't crash startup.
if (ambientState.active && !ambient.ANIMATIONS.includes(ambientState.animation)) {
  console.warn(`[Ambient] Persisted animation "${ambientState.animation}" no longer exists — clearing instead of restoring.`);
  ambientState = { ...ambientState, active: false, startedAt: null };
  saveDisplayState(displayState, displaySettings, ambientState);
}

if (ambientState.active) {
  console.log(`[Ambient] Restoring ambient animation: ${ambientState.animation}`);
  ambient.start(ambientState.animation, { brightness: ambientState.brightness });
} else if (displayState.active) {
  console.log(`[Display] Restoring previous display: "${displayState.text}"`);
  display.startScroll(displayState.text, displaySettings);
}

refreshWifiCredentials();

// ─── Cleanup on exit ──────────────────────────────────────────────────────────

process.on("SIGINT",  () => { display.stop(); ambient.stop(); keypad.stop(); process.exit(0); });
process.on("SIGTERM", () => { display.stop(); ambient.stop(); keypad.stop(); process.exit(0); });

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RPi Dashboard running at http://0.0.0.0:${PORT}`);
  console.log(`TOTP secret: ${TOTP_SECRET === "YOUR_SECRET_KEY" ? "⚠️  NOT SET — update TOTP_SECRET" : "✅ configured"}`);
  console.log(`Display: ${display.available ? "✅ MAX7219 ready" : "⚠️  running in stub mode (no SPI device)"}`);
  console.log(`Keypad:  ${keypad.available ? "✅ TM1638 ready — press S1 to show TOTP" : "⚠️  running in stub mode (no GPIO device)"}`);
});
