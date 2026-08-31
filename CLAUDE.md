# RPi Dashboard

A small Node/Express app that turns a Raspberry Pi into a local network dashboard with three
subsystems: TOTP 2FA code generation (via `oathtool`), a MAX7219 LED matrix scrolling-text
display (SPI) that can also run a web-UI-only ambient mode (a configurable digital-rain
animation — direction, speed, drop size — mutually exclusive with scrolling text),
and a TM1638 LED&KEY keypad (bit-banged GPIO) whose S1 button shows the TOTP
code on the 7-segment digits and plays a random sound from `sounds/TOTP/` — as does a
standalone normally-closed push-button wired directly
to its own GPIO pin, independent of the TM1638 (`drivers/button.js`) — whose S2 button shows the Pi's LAN IP and port on the MAX7219,
whose S3 button shows the current Wi-Fi network's password on the MAX7219,
whose S4, S5, and S6 buttons each play a random sound from their own
folder (`sounds/S4/`, `sounds/S5/`, and `sounds/S6/`, via `mpg123`), whose S8 button toggles
ambient mode on/off, and whose S7 button restarts
the `rpi-dashboard` systemd service (all show/display durations are tunable via `.env`).
`server.js` also runs a periodic connectivity monitor that takes over the MAX7219 with a
scrolling error message whenever the Pi has no LAN IP or can't reach the internet, automatically
resuming whatever was showing (scroll text or an ambient animation) once connectivity returns.
Every subsystem is designed to run identically whether or not the
physical hardware is attached — see "Hardware-detection pattern" below. Hardware wiring and Pi
setup steps live in `README.md`; this file is about the code.

## File map

| File | Responsibility |
|---|---|
| `config.js` | Single place for tunable values (durations, intervals, default display/ambient settings, connectivity-probe settings, GPIO pins, ports, secret defaults, deploy path/exclusions) used by `server.js`/`display.js`/`ambient.js`/`keypad.js`/`deploy.js`. All tunable values read from `.env` via `process.env` with sensible defaults; pin values use `requirePin()` which logs an error (rather than silently using a wrong default) if the env var is missing. Hardware protocol constants (register addresses, command bytes) stay local to their driver files instead |
| `.env` | App config — display settings, GPIO pins, timing durations, connectivity-probe settings, `TOTP_SECRET`. Gitignored (per-machine values) but **deployed** to the Pi by `deploy.js` so both machines have their own copy. Copy from `.env.example` to get started |
| `.env.deploy` | Deploy credentials — `PI_HOST`, `PI_USER`, `PI_PASSWORD`, `PI_PATH`. Dev-only; gitignored and excluded from `deploy.js` so it never reaches the Pi. Copy from `.env.deploy.example` |
| `server.js` | Loads `.env` into `process.env` via `require("dotenv").config()` as its first line (so `config.js`'s reads are populated regardless of how the process was started — systemd unit, `npm start`, or a bare shell), then the Express app, all HTTP routes, in-memory `displayState`/`displaySettings`/`ambientState` (persisted to `.display-state.json` and restored on boot — ambient wins if both were somehow active), a periodic network-connectivity monitor that takes over the MAX7219 with an error message while offline (see "Known constraints" below), SIGINT/SIGTERM cleanup |
| `drivers/display.js` | MAX7219 SPI driver: scroll-buffer builder, frame renderer, scroll loop. Exports `pushFrame`/`setBrightness`/`clearHardware` (aliases of its private `_pushFrame`/`_setBrightness`/`_clearHardware`) so `drivers/ambient.js` can render through the same SPI primitives without opening its own hardware handle |
| `drivers/ambient.js` | Digital-rain ambient animation for the MAX7219 — each of the 32 columns tracks an independent falling drop (head position + speed), mutated in place every tick rather than derived as a pure function of elapsed time, since a column needs to reset to a new random speed/offset once its drop falls off the bottom. `start({brightness, direction, speed, dropSize})` takes the drop-fall direction (`'down'`/`'up'`, exported as `DIRECTIONS`), speed in rows/sec, and trail length in pixels. Runs its own recursive-`setTimeout` loop (same shape as `display.js`'s scroll loop) at `config.ambient.TICK_MS`, rendering via `drivers/display.js`'s exported primitives. Mutually exclusive with `startScroll` — enforced by `server.js`, not by this module |
| `drivers/font.js` | Bitmap font data (Latin + Ukrainian Cyrillic) consumed by `drivers/display.js`; its `CUSTOM` export is also read directly by `server.js` for the `/api/custom-symbols` route |
| `drivers/tm1638.js` | `TM1638` class — low-level bit-banged GPIO protocol (write/read byte, commands) |
| `drivers/audio.js` | `mpg123` wrapper: probes for the binary at load (hardware-detection pattern), `playRandom(folder)` picks and spawns a random `.mp3`, `stop()` kills whatever is currently playing/queued |
| `drivers/button.js` | Standalone normally-closed GPIO push-button, independent of the TM1638 — opens its pin (`config.button.PIN`) with an internal pull-up and `rpio.poll()`s for the rising edge (press = circuit opens = pin goes high), debouncing in software. Exports `{ available, onPress(handler), stop() }`; `keypad.js` registers `handleS1Press` as its press handler so the button mimics S1 |
| `keypad.js` | Owns the `TM1638` instance, polls buttons at `config.js`'s `POLL_INTERVAL_MS`, debounces button edges, shows current time/date (`HH.MMDD.MM`) on the 7-segment digits by default (1 s update interval), shows TOTP on digits on S1 (or the standalone button from `drivers/button.js`) for `TOTP_SHOW_DURATION_MS` while also playing a random sound from `sounds/TOTP/`, then resumes the clock, plays a random sound from `sounds/S4/` on S4, `sounds/S5/` on S5, and `sounds/S6/` on S6, restarts the `rpi-dashboard` service via `sudo systemctl restart` on S7, and fires registered callbacks on S2 (`onS2Press`), S3 (`onS3Press`), and S8 (`onS8Press`) — S8's ambient-mode toggle logic lives in `server.js`, alongside the ambient state it toggles |
| `totp.js` | `generateTOTP(secret)` — shared `oathtool` wrapper used by both `server.js` and `keypad.js` |
| `sounds/` | `TOTP/`/`S4/`/`S5/`/`S6/` subfolders of `.mp3` files for the TOTP-press and S4/S5/S6 random-sound buttons. Gitignored (per-machine content) but not excluded from `deploy.js`, so it deploys normally |
| `.display-state.json` | Runtime snapshot of `displayState`/`displaySettings`/`ambientState`, written on every `/api/display` or `/api/ambient` start/stop and reloaded on boot so the matrix resumes its last text or ambient animation after a restart. Gitignored and excluded from `deploy.js` — pushing the dev machine's copy would clobber the Pi's actual state |
| `public/index.html` | Single-page vanilla JS/CSS frontend, no build step |
| `deploy.js` | Deployment script — reads Pi credentials from `.env.deploy`, pushes local code (including `.env`) to the Pi over SSH, and restarts the systemd service |
| `tools/glyph-editor/` | Dev-only glyph design tool for `drivers/font.js`, run via `npm run glyph-editor` (`index.html`/`style.css`/`app.js` + `serve.js`, an Express server that reads `drivers/font.js` live and serves it over `/api/font`) — not part of the deployed app |
| `tools/pinmap/` | Dev-only CLI that reads `.env` and prints the RPi 3B 40-pin GPIO map with used/free pins, run via `npm run pinmap` — not part of the deployed app |

## Hardware-detection pattern

Every driver module opens its hardware inside a `try`/`catch` at module load, exposes an
`available` boolean, and guards every hardware call:

```js
let spi = null, available = false;
try {
  spi = require("spi-device").openSync(config.display.SPI_BUS, config.display.SPI_DEVICE);
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
cp .env.example .env          # then add TOTP_SECRET=... to .env
cp .env.deploy.example .env.deploy  # then fill in PI_HOST / PI_USER / PI_PASSWORD
TOTP_SECRET=... node server.js      # or just node server.js if TOTP_SECRET is in .env
```

Runs on `:3000`. No test suite or linter is configured in this project.

## API surface

`server.js` is the source of truth; current routes:

| Method | Route | Body | Description |
|---|---|---|---|
| GET  | `/api/totp` | — | Returns `{ code }` |
| POST | `/api/display` | `{ text, speed?, brightness?, rotate?, direction? }` | Start scroll loop (stops ambient mode first) |
| POST | `/api/display/stop` | — | Stop + clear MAX7219 display |
| GET  | `/api/display/status` | — | Current MAX7219 state |
| GET  | `/api/custom-symbols` | — | Returns `{ symbols }` — the literal characters in `font.js`'s `CUSTOM` set, for the frontend's symbol picker |
| POST | `/api/ambient/start` | `{ brightness?, direction?, speed?, dropSize? }` | Start the digital-rain ambient animation — `direction` ∈ `ambient.DIRECTIONS` (`down`/`up`), `speed` in rows/sec, `dropSize` trail length in pixels — stops scroll mode first |
| POST | `/api/ambient/stop` | — | Stop + clear the ambient animation |
| GET  | `/api/ambient/status` | — | Current ambient state |

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
  populated via `tools/glyph-editor/`.
- `drivers/` holds hardware-facing modules required by `server.js`/`keypad.js` at runtime, so
  unlike `tools/` it is **not** in `deploy.js`'s exclude list.
- `deploy.js` excludes the whole `tools/` directory — it's dev-only and must never reach the Pi.
- `drivers/audio.js` requires the `mpg123` system binary on the Pi (`sudo apt install
  mpg123`); if missing, S4/S5/S6 just log a stub line instead of playing anything.
- `deploy.js` deletes the Pi's entire remote `sounds/` directory (`rm -rf`) before every
  upload, then re-populates it from the local `sounds/` folder — it's a wipe-and-replace, not
  a merge. Any `.mp3` files added directly on the Pi (rather than the dev machine) are lost on
  the next `npm run deploy`. Done because `putDirectory` only adds/overwrites and never
  deletes, so without this step renamed/removed sound files would pile up as stale cruft.
- S7's switch is flaky (previously tested as hardware-faulty, which is why its sound-button role
  was reassigned to S5) — try a different press angle if its restart handler doesn't fire.
- `drivers/button.js`'s button is wired **normally-closed** (connected at rest, open on press) —
  the opposite polarity of a typical push-button. With the internal pull-up, that means the pin
  reads *low* at rest and a press is a *rising* edge (`rpio.POLL_HIGH`), not the falling edge a
  normally-open/pull-up button would produce. Wiring a normally-open button to this driver as-is
  would make it register a "press" whenever the button is released, not pressed.
- `keypad.js`'s S7 handler runs `sudo systemctl restart rpi-dashboard` via `execFile`, with no
  password piped in (unlike `deploy.js`'s SSH-based restart) — it relies on a NOPASSWD sudoers
  rule scoped to that exact command (see README's "Auto-start with systemd"). Without that rule,
  the restart fails and logs an error instead of hanging on a password prompt.
- `server.js`'s `getWifiCredentials()` runs `sudo nmcli device wifi show-password` —
  `nmcli` returns the SSID to any caller but only returns the secret to a
  polkit-authorized session, which an unattended systemd service doesn't have
  (unlike an interactive SSH session, which is authorized and gets the password
  fine without `sudo`). Needs its own NOPASSWD sudoers rule (see README's
  "Auto-start with systemd"); without it, the cached credentials show `(open)`
  because the `Password:` line is silently missing from the output, not because
  the network is actually open. It's called once at startup by
  `refreshWifiCredentials()` and cached in `cachedWifiCreds` — S3 reads that cache
  instead of re-running `nmcli` on every press, so the password only updates on a
  service restart (S7, a redeploy, or a manual restart) and S3 no-ops with a
  warning if pressed before the startup fetch has completed.
- `drivers/audio.js` invokes `mpg123 -o pulse` (not plain ALSA) because a Bluetooth speaker
  has no raw ALSA hw device — it's only reachable through PipeWire/PulseAudio. That means the
  systemd service needs `Environment=XDG_RUNTIME_DIR=/run/user/<uid>` and
  `loginctl enable-linger pi` (see README's "Auto-start with systemd"), or `mpg123` exits 0
  with no error and plays silence — it works fine when run by hand over SSH, which is what
  makes this confusing to debug.
- Ambient mode and scrolling text are mutually exclusive on the MAX7219 and the exclusion is
  enforced entirely in `server.js` (each route stops the other mode before persisting/starting)
  — `drivers/display.js` and `drivers/ambient.js` don't know about each other. `showOverlay()`
  (S2/S3) snapshots whichever mode was active — including the ambient animation/brightness, not
  just scrolling text — before showing the overlay, and resumes that same mode once
  `OVERLAY_DURATION_MS` elapses, so an S2/S3 press only pauses ambient mode rather than
  cancelling it. This snapshot/restore logic is factored into `captureDisplaySnapshot()`/
  `restoreDisplaySnapshot()`, shared with the network-error takeover described below.
- `server.js`'s network monitor (`handleNetworkCheck()`, on a `setInterval` at
  `config.network.CHECK_INTERVAL_MS`) treats the Pi as offline if `getLanIp()` returns `null`
  **or** a raw TCP connect to `config.network.PROBE_HOST:PROBE_PORT` (default `1.1.1.1:443`, via
  Node's built-in `net` module — chosen over shelling out to `ping` to avoid a subprocess-per-check
  and `ping`'s `CAP_NET_RAW`/setuid fragility) fails/times out. On the offline transition it
  snapshots whatever was showing (via `captureDisplaySnapshot()`), stops ambient if it was active,
  and starts a persistent (non-timed) scroll of `config.network.ERROR_MESSAGE`; on the online
  transition it restores that snapshot via `restoreDisplaySnapshot()`. It never mutates
  `displayState`/`ambientState` to reflect the error text itself — same as the S2/S3 overlay's IP/
  password text, it's transient matrix content, not a persisted mode, so `/api/display/status` and
  `/api/ambient/status` keep reporting the pre-error state. `cancelNetworkError()` (called at the
  top of every manual display/ambient action, mirroring `cancelOverlayRevert()`) lets a manual
  action or the S2/S3 overlay take over immediately; because the two interruption mechanisms can
  nest (an outage during an overlay, or an overlay press during an outage), each one hands its
  pending snapshot to the other instead of re-deriving from live state when interrupted — otherwise
  the live `ambientState.active` (already toggled off by whichever mechanism grabbed the matrix
  first) would look like "nothing was running" and the true prior animation would be lost. No
  consecutive-failure hysteresis — a single probe every `CHECK_INTERVAL_MS` already rides out
  transient blips.
- The MAX7219 has no per-pixel PWM — only on/off per pixel plus one global `INTENSITY` register
  (0-15). `drivers/ambient.js`'s rain animation renders at a constant brightness and fakes a
  fade with a fixed-length streak of lit pixels trailing each drop's head instead; a true
  brightness-based fade would need to modulate `INTENSITY` over time via `display.setBrightness()`,
  which isn't per-pixel so can't vary within a single frame.
- `.display-state.json` is excluded from `deploy.js` and survives across deploys untouched (see
  its file-map entry above), so a persisted `ambientState.direction`/`speed`/`dropSize` can be
  stale or (for a state file written before this feature existed) simply missing.
  `server.js`'s boot-restore block sanitizes each field against `ambient.DIRECTIONS`/basic type
  checks and falls back to `config.ambient` defaults for anything invalid, rather than trusting
  the persisted value or letting a bad value reach `ambient.start()` uncaught — an uncaught throw
  there happens before `app.listen()`, which crashes the whole process, not just ambient mode.
