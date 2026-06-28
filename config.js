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
    SPI_BUS: requirePin("DISPLAY_SPI_BUS"),
    SPI_DEVICE: requirePin("DISPLAY_SPI_DEVICE"),
    NUM_MODULES: 4,
    SPI_SPEED_HZ: 10000000,
    DEFAULT_SPEED_MS: Number(process.env.DISPLAY_DEFAULT_SPEED_MS) || 40,
    DEFAULT_BRIGHTNESS: Number(process.env.DISPLAY_DEFAULT_BRIGHTNESS) || 5,
    DEFAULT_ROTATE: process.env.DISPLAY_DEFAULT_ROTATE === "true",
    DEFAULT_DIRECTION: process.env.DISPLAY_DEFAULT_DIRECTION || "rtl",
    OVERLAY_DURATION_MS: Number(process.env.DISPLAY_OVERLAY_DURATION_MS) || 60000,
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

  deploy: {
    DEFAULT_REMOTE_PATH: process.env.PI_PATH || "/home/pi/rpi-dashboard",
    EXCLUDED: ["node_modules", ".git", ".env", "glyph-editor", ".display-state.json"],
  },
};
