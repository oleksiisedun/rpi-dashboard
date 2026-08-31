"use strict";

/**
 * ambient.js — "digital rain" ambient animation for the MAX7219 matrix.
 *
 * The MAX7219 has no per-pixel PWM: only on/off per pixel plus one global
 * INTENSITY register (0-15), so a fade is faked with a fixed-length streak of
 * lit pixels trailing each drop's head instead of a true brightness gradient.
 *
 * Same flat-module, recursive-setTimeout shape as display.js's scroll loop.
 */

const display = require("./display");
const config = require("../config");

const NUM_MODULES = config.display.NUM_MODULES;
const WIDTH = NUM_MODULES * 8; // 32 columns
const HEIGHT = 8; // 8 rows

const DIRECTIONS = ["down", "up"];

/**
 * @param {boolean} staggered - true to start already mid-fall at a random offset
 *   (used at init, so drops aren't all born at the same instant); false to
 *   start just off-screen (used on reset, once the rain is already flowing)
 * @param {number} speed - rows/sec, used as the midpoint for this drop's jitter
 * @param {number} dropSize - trail length in pixels
 * @returns {{head: number, speed: number}}
 */
function _newDrop(staggered, speed, dropSize) {
  return {
    head: staggered ? -Math.random() * (HEIGHT + dropSize) * 3 : -Math.random() * HEIGHT,
    speed: speed * (0.7 + Math.random() * 0.6),
  };
}

/**
 * @param {{brightness: number, direction: string, speed: number, dropSize: number}} opts
 * @returns {{brightness: number, direction: string, speed: number, dropSize: number, cols: {head: number, speed: number}[]}}
 */
function _init({ brightness, direction, speed, dropSize }) {
  const cols = [];
  for (let x = 0; x < WIDTH; x++) cols.push(_newDrop(true, speed, dropSize));
  return { brightness, direction, speed, dropSize, cols };
}

/**
 * @param {ReturnType<typeof _init>} state
 * @returns {{frame: number[], brightness: number}}
 */
function _renderFrame(state) {
  const { direction, dropSize, speed } = state;
  const dt = config.ambient.TICK_MS / 1000;
  const frame = new Array(WIDTH).fill(0);
  for (let x = 0; x < WIDTH; x++) {
    const drop = state.cols[x];
    drop.head += drop.speed * dt;
    if (drop.head - dropSize > HEIGHT) {
      state.cols[x] = _newDrop(false, speed, dropSize);
      continue;
    }
    let byte = 0;
    for (let i = 0; i < dropSize; i++) {
      const progress = Math.floor(drop.head) - i;
      const y = direction === "up" ? HEIGHT - 1 - progress : progress;
      if (y >= 0 && y < HEIGHT) byte |= 1 << y;
    }
    frame[x] = byte;
  }
  return { frame, brightness: state.brightness };
}

// ─── tick loop ──────────────────────────────────────────────────────────────

let _timer = null;
let _state = null;
let _lastFrame = null;
let _lastBrightness = null;

/**
 * Render the current animation frame and reschedule the next tick.
 * @returns {void}
 */
function _tick() {
  const { frame, brightness } = _renderFrame(_state);

  if (frame !== _lastFrame) {
    display.pushFrame(frame, 0);
    _lastFrame = frame;
  }
  if (brightness !== _lastBrightness) {
    display.setBrightness(brightness);
    _lastBrightness = brightness;
  }

  _timer = setTimeout(_tick, config.ambient.TICK_MS);
}

/**
 * Start (or restart) the digital rain animation.
 * @param {{brightness?: number, direction?: 'down'|'up', speed?: number, dropSize?: number}} [options]
 *   speed is in rows/sec, dropSize is the trail length in pixels.
 * @returns {void}
 */
function start({
  brightness = config.ambient.DEFAULT_BRIGHTNESS,
  direction = config.ambient.DEFAULT_DIRECTION,
  speed = config.ambient.DEFAULT_SPEED,
  dropSize = config.ambient.DEFAULT_DROP_SIZE,
} = {}) {
  stop();

  _state = _init({
    brightness,
    direction: DIRECTIONS.includes(direction) ? direction : config.ambient.DEFAULT_DIRECTION,
    speed,
    dropSize,
  });
  _lastFrame = null;
  _lastBrightness = null;

  _tick();
}

/**
 * Stop the ambient animation loop and clear the panel.
 * @returns {void}
 */
function stop() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  if (!display.available) {
    process.stdout.write("\n");
    return;
  }
  display.clearHardware();
}

module.exports = { start, stop, DIRECTIONS, available: display.available };
