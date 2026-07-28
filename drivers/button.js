"use strict";

/**
 * drivers/button.js — standalone GPIO push-button, independent of the TM1638.
 *
 * Wired normally-closed: the two leads are connected (circuit closed, pin
 * pulled low through the switch) at rest, and pressing the button *opens*
 * the circuit, letting the internal pull-up pull the pin high — so a press
 * is a rising edge, the opposite polarity of a typical normally-open button.
 *
 * Wiring (physical RPi header pin):
 *   One lead → configured pin (internal pull-up, no external resistor needed)
 *   Other lead → any GND pin
 *
 * Follows the hardware-detection pattern used by the other drivers: opens
 * the GPIO pin in a try/catch at module load, exposes `available`, and
 * no-ops if it's missing so the app keeps running (in stub mode) on a
 * non-Pi dev machine.
 */

const rpio = require("rpio");
const config = require("../config");

const DEBOUNCE_MS = 20;

let pin = config.button.PIN;
let available = false;
let pressHandler = null;

/**
 * Debounce a rising-edge interrupt and, if the pin is still high after the
 * settle time, fire the registered press handler.
 * @param {number} p
 * @returns {void}
 */
function onEdge(p) {
  rpio.msleep(DEBOUNCE_MS);
  if (rpio.read(p) !== rpio.HIGH) return; // bounced back low — not a real press
  pressHandler && pressHandler();
}

try {
  rpio.open(pin, rpio.INPUT, rpio.PULL_UP);
  rpio.poll(pin, onEdge, rpio.POLL_HIGH);
  available = true;
  console.log("[Button] initialized OK");
} catch (e) {
  console.warn(`[Button] not available (${e.message}) — running in stub mode`);
}

/**
 * Register a handler to invoke once per physical button press.
 * @param {() => void} handler
 * @returns {void}
 */
function onPress(handler) {
  pressHandler = handler;
}

/**
 * Stop polling and release the GPIO pin.
 * @returns {void}
 */
function stop() {
  if (!available) return;
  rpio.close(pin);
}

module.exports = { available, onPress, stop };
