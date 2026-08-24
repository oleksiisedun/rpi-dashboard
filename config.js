"use strict";

/**
 * config.js — single place for tunable values across the app.
 * Hardware protocol constants (register addresses, command bytes) are NOT here —
 * they stay local to the driver files since they're fixed by the chip datasheet,
 * not meant to be hand-tuned.
 */

/**
 * Reads a pin number from an env var and logs an error if it is not set.
 * @param {string} envVar
 * @returns {number|undefined}
 */
function requirePin(envVar) {
  const raw = process.env[envVar];
  if (raw === undefined || raw === "") {
    console.error(`[Config] ${envVar} is not set — set it in .env`);
    return undefined;
  }
  return Number(raw);
}

module.exports = {
  server: {
    PORT: process.env.PORT || 3000,
    TOTP_SECRET: process.env.TOTP_SECRET || "YOUR_SECRET_KEY",
  },

  display: {
    SPI_BUS: Number(process.env.DISPLAY_SPI_BUS) || 0,
    SPI_DEVICE: Number(process.env.DISPLAY_SPI_DEVICE) || 0,
    NUM_MODULES: 4,
    SPI_SPEED_HZ: 10000000,
    DEFAULT_SPEED_MS: Number(process.env.DISPLAY_DEFAULT_SPEED_MS) || 40,
    DEFAULT_BRIGHTNESS: Number(process.env.DISPLAY_DEFAULT_BRIGHTNESS) || 5,
    DEFAULT_ROTATE: process.env.DISPLAY_DEFAULT_ROTATE === "true",
    DEFAULT_DIRECTION: process.env.DISPLAY_DEFAULT_DIRECTION || "rtl",
    OVERLAY_DURATION_MS: Number(process.env.DISPLAY_OVERLAY_DURATION_MS) || 60000,
  },

  ambient: {
    TICK_MS: Number(process.env.AMBIENT_TICK_MS) || 80,
    DEFAULT_ANIMATION: process.env.AMBIENT_DEFAULT_ANIMATION || "wave",
    DEFAULT_BRIGHTNESS: Number(process.env.AMBIENT_DEFAULT_BRIGHTNESS) || 8,
  },

  network: {
    CHECK_INTERVAL_MS: Number(process.env.NETWORK_CHECK_INTERVAL_MS) || 30000,
    PROBE_HOST: process.env.NETWORK_PROBE_HOST || "1.1.1.1",
    PROBE_PORT: Number(process.env.NETWORK_PROBE_PORT) || 443,
    PROBE_TIMEOUT_MS: Number(process.env.NETWORK_PROBE_TIMEOUT_MS) || 5000,
    ERROR_MESSAGE: process.env.NETWORK_ERROR_MESSAGE || "NO NETWORK CONNECTION",
  },

  keypad: {
    TM1638_STB_PIN: requirePin("TM1638_STB_PIN"),
    TM1638_CLK_PIN: requirePin("TM1638_CLK_PIN"),
    TM1638_DIO_PIN: requirePin("TM1638_DIO_PIN"),
    TM1638_BRIGHTNESS: Number(process.env.TM1638_BRIGHTNESS) || 3,
    TOTP_SHOW_DURATION_MS: Number(process.env.TOTP_SHOW_DURATION_MS) || 15000,
    ERROR_SHOW_DURATION_MS: Number(process.env.ERROR_SHOW_DURATION_MS) || 3000,
    POLL_INTERVAL_MS: Number(process.env.POLL_INTERVAL_MS) || 60,
  },

  button: {
    PIN: requirePin("TOTP_BUTTON_PIN"),
  },

  deploy: {
    DEFAULT_REMOTE_PATH: process.env.PI_PATH || "/home/pi/rpi-dashboard",
    EXCLUDED: ["node_modules", ".git", ".env.deploy", "tools", ".display-state.json", "Archive"],
  },
};
