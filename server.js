const express = require("express");
const { exec } = require("child_process");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Configuration ────────────────────────────────────────────────────────────

const TOTP_SECRET = process.env.TOTP_SECRET || "YOUR_SECRET_KEY";

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Display driver ───────────────────────────────────────────────────────────

const display = require("./display");

// ─── State ────────────────────────────────────────────────────────────────────

let displayState = {
  active: false,
  text: "",
  startedAt: null,
};

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/totp
 */
app.get("/api/totp", (req, res) => {
  const safeSecret = TOTP_SECRET.replace(/[^A-Z2-7=]/gi, "");
  if (!safeSecret) {
    return res.status(500).json({ error: "Invalid TOTP secret configured." });
  }

  exec(`oathtool --totp -b "${safeSecret}"`, (err, stdout, stderr) => {
    if (err) {
      console.error("oathtool error:", stderr || err.message);
      return res.status(500).json({
        error: "Failed to generate TOTP code. Make sure oathtool is installed (sudo apt install oathtool).",
      });
    }
    res.json({ code: stdout.trim() });
  });
});

/**
 * POST /api/display
 * Body: { text: string, speed?: number (ms per column, default 40), brightness?: number (0-15, default 5) }
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
 * POST /api/display/stop
 */
app.post("/api/display/stop", (req, res) => {
  console.log(`[Display] Stopping loop.`);
  display.stop();
  displayState = { active: false, text: "", startedAt: null };
  res.json({ ok: true, message: "Display stopped." });
});

/**
 * GET /api/display/status
 */
app.get("/api/display/status", (req, res) => {
  res.json(displayState);
});

// ─── Cleanup on exit ──────────────────────────────────────────────────────────

process.on("SIGINT",  () => { display.stop(); process.exit(0); });
process.on("SIGTERM", () => { display.stop(); process.exit(0); });

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RPi Dashboard running at http://0.0.0.0:${PORT}`);
  console.log(`TOTP secret: ${TOTP_SECRET === "YOUR_SECRET_KEY" ? "⚠️  NOT SET — update TOTP_SECRET" : "✅ configured"}`);
  console.log(`Display: ${display.available ? "✅ MAX7219 ready" : "⚠️  running in stub mode (no SPI device)"}`);
});
