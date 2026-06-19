# RPi Dashboard

A small Node/Express app that turns a Raspberry Pi into a local network dashboard with three
subsystems: TOTP 2FA code generation (via `oathtool`), a MAX7219 LED matrix scrolling-text
display (SPI), and a TM1638 LED&KEY keypad (bit-banged GPIO) whose S1 button shows the TOTP
code on the 7-segment digits. Every subsystem is designed to run identically whether or not the
physical hardware is attached — see "Hardware-detection pattern" below. Hardware wiring and Pi
setup steps live in `README.md`; this file is about the code.

## File map

| File | Responsibility |
|---|---|
| `server.js` | Express app, all HTTP routes, in-memory `displayState`, SIGINT/SIGTERM cleanup |
| `display.js` | MAX7219 SPI driver: scroll-buffer builder, frame renderer, scroll loop |
| `font.js` | Bitmap font data (Latin + Ukrainian Cyrillic) consumed by `display.js` |
| `tm1638.js` | `TM1638` class — low-level bit-banged GPIO protocol (write/read byte, commands) |
| `keypad.js` | Owns the `TM1638` instance, polls buttons every 60 ms, debounces the S1 edge, shows TOTP on digits for 10 s |
| `totp.js` | `generateTOTP(secret)` — shared `oathtool` wrapper used by both `server.js` and `keypad.js` |
| `public/index.html` | Single-page vanilla JS/CSS frontend, no build step |
| `deploy.js` | Deployment script — pushes local code to the Pi over SSH and restarts the systemd service |

## Hardware-detection pattern

Every driver module opens its hardware inside a `try`/`catch` at module load, exposes an
`available` boolean, and guards every hardware call:

```js
let spi = null, available = false;
try {
  spi = require("spi-device").openSync(0, 0);
  available = true;
} catch (e) {
  console.warn(`not available (${e.message}) — running in stub/log mode`);
}
function _writeAll(...) {
  if (!spi) return; // stub mode: no-op or log instead
  ...
}
```

New hardware integrations must follow this same shape so the app keeps running (in stub/log
mode) on a non-Pi dev machine.

## Dev workflow

```bash
npm install        # compiles spi-device/rpio native addons; needs build-essential on the Pi
TOTP_SECRET=... node server.js
```

Runs on `:3000`. No test suite or linter is configured in this project.

## API surface

`server.js` is the source of truth; current routes:

| Method | Route | Body | Description |
|---|---|---|---|
| GET  | `/api/totp` | — | Returns `{ code }` |
| POST | `/api/display` | `{ text, speed?, brightness?, rotate?, direction? }` | Start scroll loop |
| POST | `/api/display/stop` | — | Stop + clear MAX7219 display |
| GET  | `/api/display/status` | — | Current MAX7219 state |

## Known constraints / gotchas

- `TOTP_SECRET` defaults to the literal `"YOUR_SECRET_KEY"` if unset. `totp.js` rejects it (not
  base32) and the route returns a 500 — this is intentional, not a bug.
- `totp.js` strips the secret to `[A-Z2-7=]` before interpolating it into a shell command via
  `exec`. That sanitization is what makes the `exec` call safe — preserve it if touching that
  function.
- The Cyrillic/Latin font bitmaps in `font.js` are hand-verified pixel art (see the inline
  comments documenting each glyph's shape). Don't simplify or regenerate them without visually
  re-checking against the MAX7219.
