# RPi Dashboard

Local Node.js web dashboard for Raspberry Pi with:
- **2FA code generation** via `oathtool` (web UI button + physical S1 button)
- **MAX7219 4×8×8 LED matrix** — scrolling text in Latin + Ukrainian Cyrillic
- **TM1638 LED&KEY module** — press S1 to show the TOTP code on the 7-segment
  digits for 10 seconds, press S6 or S7 to play a random sound from
  `sounds/S6/` or `sounds/S7/` respectively, or press S8 to scroll a random
  message from `.strings` on the MAX7219 for 30 seconds

---

## Hardware

### MAX7219 dot-matrix display

| Module pin | RPi pin | GPIO |
|---|---|---|
| VCC | Pin 2 | 5V |
| GND | Pin 6 | GND |
| DIN | Pin 19 | GPIO 10 (MOSI) |
| CS  | Pin 24 | GPIO 8 (CE0) |
| CLK | Pin 23 | GPIO 11 (SCLK) |

Connect to the **IN** connector (rightmost on the PCB back).

### TM1638 LED&KEY module

| Module pin (J1) | RPi pin | GPIO |
|---|---|---|
| VCC | Pin 4  | 5V |
| GND | Pin 9  | GND |
| STB | Pin 29 | GPIO 5 |
| CLK | Pin 31 | GPIO 6 |
| DIO | Pin 33 | GPIO 13 |

These pins don't conflict with the MAX7219's SPI0 pins.

---

## Setup on Raspberry Pi

### 1. Enable SPI (for the MAX7219)

```bash
sudo raspi-config
# → Interface Options → SPI → Enable
# Reboot, then verify:
ls /dev/spi*   # should show /dev/spidev0.0
```

### 2. GPIO group permissions (for the TM1638)

```bash
sudo usermod -a -G gpio pi
# logout and back in (or reboot) for the group change to take effect
```

### 3. System packages

```bash
sudo apt update
sudo apt install oathtool mpg123 nodejs npm build-essential
```

### 4. Install Node dependencies

```bash
cd ~/rpi-dashboard
npm install
# spi-device and rpio both compile native addons — build-essential is required
```

### 5. Run

```bash
cp .strings.example .strings   # gitignored — edit with your own messages
mkdir -p sounds/S6 sounds/S7   # gitignored — add your own .mp3 files to each
cp /path/to/your/s6-sounds/*.mp3 sounds/S6/
cp /path/to/your/s7-sounds/*.mp3 sounds/S7/
TOTP_SECRET=YOUR_ACTUAL_SECRET node server.js
```

Open `http://<RPI_IP>:3000` from any device on your network.

You should see in the logs:
```
Display: ✅ MAX7219 ready
Keypad:  ✅ TM1638 ready — press S1 to show TOTP
```

Press **S1** on the TM1638 board — the TOTP code appears on the 7-segment
digits for 10 seconds, then clears automatically.

Press **S6** or **S7** — a random `.mp3` from `sounds/S6/` or `sounds/S7/`
(respectively) plays via `mpg123 -o pulse`, which routes through
PipeWire/PulseAudio so it reaches whatever output is set as your default sink
(3.5mm jack, HDMI, USB, or a paired Bluetooth speaker). That means the
systemd service needs access to your user's PipeWire/Pulse session — see the
`XDG_RUNTIME_DIR` note in "Auto-start with systemd" below, or sound will play
correctly when you test `mpg123` by hand over SSH but stay silent when
triggered by the service. `sounds/` is gitignored like `.strings` (see step 5
above), so each machine keeps its own files — add them on your dev machine
and push with `npm run deploy` (it's not in `deploy.js`'s exclude list
either), or copy them directly onto the Pi.

Press **S8** — a random line from `.strings` scrolls on the MAX7219
for 30 seconds (using whatever speed/brightness/rotate/direction is currently
set in the web UI), then the previous display state (or nothing, if it was
stopped) resumes. `.strings` is gitignored (see step 5 above), so
each machine keeps its own copy — edit it on your dev machine and push it
with `npm run deploy` (it's not in `deploy.js`'s exclude list), or edit it
directly on the Pi. One message per line; blank lines and lines starting
with `#` are ignored.

---

## Auto-start with systemd

```bash
sudo nano /etc/systemd/system/rpi-dashboard.service
```

```ini
[Unit]
Description=RPi Dashboard
After=network.target

[Service]
WorkingDirectory=/home/pi/rpi-dashboard
ExecStart=/usr/bin/node server.js
Restart=always
User=pi
Environment=TOTP_SECRET=YOUR_ACTUAL_SECRET
Environment=XDG_RUNTIME_DIR=/run/user/1000

[Install]
WantedBy=multi-user.target
```

`XDG_RUNTIME_DIR` (replace `1000` with the output of `id -u pi` if different)
lets the S6/S7 sound playback (`mpg123 -o pulse`, see `drivers/audio.js`) find
your user's PipeWire/PulseAudio session — without it, `mpg123` exits cleanly
but plays nothing, since it can't reach the socket that knows about your
audio output (especially a Bluetooth speaker, which has no plain ALSA
device). You also need that session to actually be running when the service
starts, even without an interactive login:

```bash
loginctl enable-linger pi
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable rpi-dashboard
sudo systemctl start rpi-dashboard
```

---

## Deploying updates

From your dev machine:

```bash
cp .env.example .env   # fill in PI_HOST / PI_USER / PI_PASSWORD / PI_PATH
npm install
npm run deploy
```

This copies the project to the Pi over SSH, runs `npm install --production` there, and restarts
the `rpi-dashboard` systemd service (using `sudo -S`, with the password piped in from `.env`).

---

## API

| Method | Route | Body | Description |
|---|---|---|---|
| GET  | `/api/totp` | — | Returns `{ code }` |
| POST | `/api/display` | `{ text, speed?, brightness?, rotate?, direction? }` | Start scroll loop |
| POST | `/api/display/stop` | — | Stop + clear MAX7219 display |
| GET  | `/api/display/status` | — | Current MAX7219 state |

`speed` = ms per column shift (default 40). `brightness` = 0–15 (default 5).
`direction` = `'rtl'` (default) or `'ltr'`.

---

## Files

| File | Purpose |
|---|---|
| `server.js` | Express app, HTTP routes |
| `drivers/display.js` | MAX7219 driver (SPI, scrolling) |
| `drivers/font.js` | Bitmap font data — Latin + Ukrainian Cyrillic |
| `drivers/tm1638.js` | Low-level TM1638 bit-banged GPIO driver |
| `drivers/audio.js` | `mpg123`-based random sound playback for the S6/S7 buttons |
| `keypad.js` | S1 button → TOTP-on-digits behavior; S6/S7 buttons → random sound; S8 button → random-string overlay (handled in `server.js`) |
| `totp.js` | Shared `oathtool` wrapper used by both the API and the keypad |
| `.strings.example` | Template for `.strings` (the gitignored, real one) — copy it per step 5 above |
| `sounds/` | Gitignored folder with `S6/`/`S7/` subfolders of `.mp3` files for the S6/S7 buttons — create per step 5 above |

---

## Development without hardware

Both `drivers/display.js` and `drivers/tm1638.js`/`keypad.js` detect missing SPI/GPIO
and fall back to stub/log mode, so you can develop on any machine
without a Pi connected. `drivers/audio.js` follows the same pattern for a missing
`mpg123` binary.
