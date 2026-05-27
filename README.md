# RPi Dashboard

Local Node.js web dashboard for Raspberry Pi with:
- **2FA code generation** via `oathtool`
- **MAX7219 4×8×8 LED matrix** — scrolling text in Latin + Ukrainian Cyrillic

---

## Hardware

| Module pin | RPi pin | GPIO |
|---|---|---|
| VCC | Pin 2 | 5V |
| GND | Pin 6 | GND |
| DIN | Pin 19 | GPIO 10 (MOSI) |
| CS  | Pin 24 | GPIO 8 (CE0) |
| CLK | Pin 23 | GPIO 11 (SCLK) |

Connect to the **IN** connector (rightmost on the PCB back).

---

## Setup on Raspberry Pi

### 1. Enable SPI

```bash
sudo raspi-config
# → Interface Options → SPI → Enable
# Reboot, then verify:
ls /dev/spi*   # should show /dev/spidev0.0
```

### 2. System packages

```bash
sudo apt update
sudo apt install oathtool nodejs npm
```

### 3. Install Node dependencies

```bash
cd ~/rpi-dashboard
npm install
# spi-device compiles a native addon — needs build-essential
# If it fails: sudo apt install build-essential && npm install
```

### 4. Run

```bash
TOTP_SECRET=YOUR_ACTUAL_SECRET node server.js
```

Open `http://<RPI_IP>:3000` from any device on your network.

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

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable rpi-dashboard
sudo systemctl start rpi-dashboard
```

---

## API

| Method | Route | Body | Description |
|---|---|---|---|
| GET  | `/api/totp` | — | Returns `{ code }` |
| POST | `/api/display` | `{ text, speed?, brightness? }` | Start scroll loop |
| POST | `/api/display/stop` | — | Stop + clear display |
| GET  | `/api/display/status` | — | Current state |

`speed` = ms per column shift (default 40; lower = faster).
`brightness` = 0–15 (default 5).

---

## Development without hardware

`display.js` detects missing SPI and falls back to stub mode —
it logs column hex values to stdout so you can develop on any machine
without a Pi connected.
