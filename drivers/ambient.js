"use strict";

/**
 * ambient.js — generative ambient animations for the MAX7219 matrix.
 *
 * The MAX7219 has no per-pixel PWM: only on/off per pixel plus one global
 * INTENSITY register (0-15). Every animation below works within that limit.
 *
 * Same flat-module, recursive-setTimeout shape as display.js's scroll loop.
 */

const display = require("./display");
const config = require("../config");

const NUM_MODULES = config.display.NUM_MODULES;
const WIDTH = NUM_MODULES * 8; // 32 columns
const HEIGHT = 8; // 8 rows

const CX = (WIDTH - 1) / 2;
const CY = (HEIGHT - 1) / 2;

// ─── wave: a sine ripple flowing across the columns ────────────────────────────

/**
 * @param {{brightness: number}} opts
 * @returns {{brightness: number}}
 */
function waveInit({ brightness }) {
  return { brightness };
}

/**
 * @param {{brightness: number}} state
 * @param {number} t - seconds elapsed
 * @returns {{frame: number[], brightness: number}}
 */
function waveTick(state, t) {
  const amp = 2.5;
  const wavelength = 14;
  const speed = 2.0;
  const amp2 = 0.6;
  const frame = new Array(WIDTH).fill(0);
  for (let x = 0; x < WIDTH; x++) {
    let yCenter = CY + amp * Math.sin((2 * Math.PI * x) / wavelength + t * speed);
    yCenter += amp2 * Math.sin((4 * Math.PI * x) / wavelength - t * speed * 1.7);
    const yFloor = Math.floor(yCenter);
    let byte = 0;
    if (yFloor >= 0 && yFloor < HEIGHT) byte |= 1 << yFloor;
    if (yFloor + 1 >= 0 && yFloor + 1 < HEIGHT) byte |= 1 << (yFloor + 1);
    frame[x] = byte;
  }
  return { frame, brightness: state.brightness };
}

// ─── plasma: rotating spiral via polar sine field, thresholded on/off ─────────

/**
 * @param {{brightness: number}} opts
 * @returns {{brightness: number}}
 */
function plasmaInit({ brightness }) {
  return { brightness };
}

/**
 * @param {{brightness: number}} state
 * @param {number} t - seconds elapsed
 * @returns {{frame: number[], brightness: number}}
 */
function plasmaTick(state, t) {
  const armCount = 3;
  const tightness = 0.35;
  const rotationSpeed = 1.5;
  const frame = new Array(WIDTH).fill(0);
  for (let x = 0; x < WIDTH; x++) {
    const dx = x - CX;
    let byte = 0;
    for (let y = 0; y < HEIGHT; y++) {
      const dy = (y - CY) * 4; // corrects for the 32:8 aspect ratio so radius reads round
      const angle = Math.atan2(dy, dx);
      const radius = Math.sqrt(dx * dx + dy * dy);
      const value = Math.sin(angle * armCount + radius * tightness - t * rotationSpeed);
      if (value > 0) byte |= 1 << y;
    }
    frame[x] = byte;
  }
  return { frame, brightness: state.brightness };
}

// ─── registry + tick loop ──────────────────────────────────────────────────────

const ANIMATION_DEFS = {
  wave: { init: waveInit, tick: waveTick },
  plasma: { init: plasmaInit, tick: plasmaTick },
};

const ANIMATIONS = Object.keys(ANIMATION_DEFS);

let _timer = null;
let _animDef = null;
let _animState = null;
let _startTime = null;
let _lastFrame = null;
let _lastBrightness = null;

/**
 * Render the current animation frame and reschedule the next tick.
 * @returns {void}
 */
function _tick() {
  const t = (Date.now() - _startTime) / 1000;
  const { frame, brightness } = _animDef.tick(_animState, t);

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
 * Start (or restart) an ambient animation.
 * @param {string} name - one of ANIMATIONS
 * @param {{brightness?: number}} [options]
 * @returns {void}
 */
function start(name, { brightness = config.ambient.DEFAULT_BRIGHTNESS } = {}) {
  const animDef = ANIMATION_DEFS[name];
  if (!animDef) throw new Error(`Unknown ambient animation: ${name}`);

  stop();

  _animDef = animDef;
  _animState = animDef.init({ brightness });
  _startTime = Date.now();
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

module.exports = { start, stop, ANIMATIONS, available: display.available };
