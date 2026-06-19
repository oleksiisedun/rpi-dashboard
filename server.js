const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Configuration ────────────────────────────────────────────────────────────

const TOTP_SECRET = process.env.TOTP_SECRET || "YOUR_SECRET_KEY";

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Drivers ──────────────────────────────────────────────────────────────────

const { generateTOTP } = require("./totp");
const display = require("./display");
const keypad  = require("./keypad"); // S1 button → shows TOTP on 7-segment for 10s

// ─── State ────────────────────────────────────────────────────────────────────

let displayState = {
  active: false,
  text: "",
  startedAt: null,
};

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
  const { text, speed = 40, brightness = 5, rotate = false, direction = 'rtl' } = req.body;
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
