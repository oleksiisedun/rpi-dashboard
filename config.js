"use strict";

/**
 * config.js — single place for tunable values across the app.
 * Hardware protocol constants (register addresses, command bytes) are NOT here —
 * they stay local to the driver files since they're fixed by the chip datasheet,
 * not meant to be hand-tuned.
 */
module.exports = {
  server: {
    PORT: process.env.PORT || 3000,
    TOTP_SECRET: process.env.TOTP_SECRET || "YOUR_SECRET_KEY",
  },

  display: {
    NUM_MODULES: 4,
    SPI_SPEED_HZ: 10000000,
    DEFAULT_SPEED_MS: 40,        // ms per scroll column
    DEFAULT_BRIGHTNESS: 5,       // 0-15
    DEFAULT_ROTATE: false,
    DEFAULT_DIRECTION: "rtl",
    OVERLAY_DURATION_MS: 60000, // shared duration for the S2 (LAN IP) and S8 (random string) overlays
  },

  keypad: {
    TM1638_STB_PIN: 29,
    TM1638_CLK_PIN: 31,
    TM1638_DIO_PIN: 33,
    TM1638_BRIGHTNESS: 4,        // 0-7
    TOTP_SHOW_DURATION_MS: 15000,
    ERROR_SHOW_DURATION_MS: 3000,
    POLL_INTERVAL_MS: 60,        // ~16 Hz
  },

  deploy: {
    DEFAULT_REMOTE_PATH: "/home/pi/rpi-dashboard",
    EXCLUDED: ["node_modules", ".git", ".env", "glyph-editor", ".display-state.json"],
  },
};
