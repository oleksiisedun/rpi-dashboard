# RPi Dashboard

A small Node/Express app that turns a Raspberry Pi into a local network dashboard with three
subsystems: TOTP 2FA code generation (via `oathtool`), a MAX7219 LED matrix scrolling-text
display (SPI), and a TM1638 LED&KEY keypad (bit-banged GPIO) whose S1 button shows the TOTP
code on the 7-segment digits, whose S2 button shows the Pi's LAN IP and port on the MAX7219,
whose S6 and S5 buttons each play a random sound from their own
folder (`sounds/S6/` and `sounds/S5/`, via `mpg123`), whose S7 button restarts the
`rpi-dashboard` systemd service, and whose S8 button shows a random string
from `.strings` on the MAX7219 (all show/display durations are tunable in `config.js`). Every subsystem is designed to run identically whether or not the
physical hardware is attached — see "Hardware-detection pattern" below. Hardware wiring and Pi
setup steps live in `README.md`; this file is about the code.

## File map

| File | Responsibility |
|---|---|
| `config.js` | Single place for tunable values (durations, intervals, default display settings, GPIO pins, ports, secret defaults, deploy path/exclusions) used by `server.js`/`display.js`/`keypad.js`/`deploy.js`. Hardware protocol constants (register addresses, command bytes) stay local to their driver files instead |
| `server.js` | Express app, all HTTP routes, in-memory `displayState`/`displaySettings` (persisted to `.display-state.json` and restored on boot), S8 random-string overlay handler, SIGINT/SIGTERM cleanup |
| `drivers/display.js` | MAX7219 SPI driver: scroll-buffer builder, frame renderer, scroll loop |
| `drivers/font.js` | Bitmap font data (Latin + Ukrainian Cyrillic) consumed by `drivers/display.js` |
| `drivers/tm1638.js` | `TM1638` class — low-level bit-banged GPIO protocol (write/read byte, commands) |
| `drivers/audio.js` | `mpg123` wrapper: probes for the binary at load (hardware-detection pattern), `playRandom(folder)` picks and spawns a random `.mp3` |
| `keypad.js` | Owns the `TM1638` instance, polls buttons at `config.js`'s `POLL_INTERVAL_MS`, debounces button edges, shows TOTP on digits on S1 for `TOTP_SHOW_DURATION_MS`, plays a random sound from `sounds/S6/` on S6 and `sounds/S5/` on S5, restarts the `rpi-dashboard` service via `sudo systemctl restart` on S7, fires registered callbacks on S2 (`onS2Press`) and S8 (`onS8Press`) |
| `totp.js` | `generateTOTP(secret)` — shared `oathtool` wrapper used by both `server.js` and `keypad.js` |
| `.strings` | One message per line (blank/`#` lines ignored) — source for the S8 random-string overlay. Gitignored (per-machine content, like `.env`); `.strings.example` is the committed template |
| `sounds/` | `S6/`/`S5/` subfolders of `.mp3` files for the S6/S5 random-sound buttons. Gitignored (per-machine content, like `.strings`) but not excluded from `deploy.js`, so it deploys normally |
| `.display-state.json` | Runtime snapshot of `displayState`/`displaySettings`, written on every `/api/display` start/stop and reloaded on boot so the matrix resumes its last text after a restart. Gitignored and excluded from `deploy.js` (per-machine runtime state, like `.env` — pushing the dev machine's copy would clobber the Pi's actual state) |
| `public/index.html` | Single-page vanilla JS/CSS frontend, no build step |
| `deploy.js` | Deployment script — pushes local code to the Pi over SSH and restarts the systemd service |
| `glyph-editor/` | Dev-only glyph design tool for `drivers/font.js` (`index.html`/`style.css`/`app.js` + `serve.js`, an Express server that reads `drivers/font.js` live and serves it over `/api/font`) — not part of the deployed app |

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
- `font.js` also exports a `CUSTOM` section for glyphs outside Latin/Cyrillic, meant to be
  populated via `glyph-editor/`.
- `drivers/` holds hardware-facing modules required by `server.js`/`keypad.js` at runtime, so
  unlike `glyph-editor/` it is **not** in `deploy.js`'s exclude list.
- `deploy.js` excludes the whole `glyph-editor/` directory — it's dev-only and must never reach the Pi.
- `.strings` is gitignored but **not** in `deploy.js`'s exclude list, so it deploys
  normally — unlike `.env`, it's meant to reach the Pi, just not git.
- `drivers/audio.js` requires the `mpg123` system binary on the Pi (`sudo apt install
  mpg123`); if missing, S5/S6 just log a stub line instead of playing anything.
- S7's switch is flaky (previously tested as hardware-faulty, which is why its sound-button role
  was reassigned to S5) — try a different press angle if its restart handler doesn't fire.
- `keypad.js`'s S7 handler runs `sudo systemctl restart rpi-dashboard` via `execFile`, with no
  password piped in (unlike `deploy.js`'s SSH-based restart) — it relies on a NOPASSWD sudoers
  rule scoped to that exact command (see README's "Auto-start with systemd"). Without that rule,
  the restart fails and logs an error instead of hanging on a password prompt.
- `drivers/audio.js` invokes `mpg123 -o pulse` (not plain ALSA) because a Bluetooth speaker
  has no raw ALSA hw device — it's only reachable through PipeWire/PulseAudio. That means the
  systemd service needs `Environment=XDG_RUNTIME_DIR=/run/user/<uid>` and
  `loginctl enable-linger pi` (see README's "Auto-start with systemd"), or `mpg123` exits 0
  with no error and plays silence — it works fine when run by hand over SSH, which is what
  makes this confusing to debug.
