"use strict";

/**
 * tm1638.js — Low-level bit-banged driver for the TM1638 chip
 * (used on "LED&KEY" boards: 8× 7-segment digits, 8 LEDs, 8 buttons).
 *
 * Unlike the MAX7219, TM1638 is NOT SPI — DIO is a single bidirectional
 * line used both to send display data and to read button states, so we
 * drive it with plain GPIO bit-banging via the `rpio` package.
 *
 * Wiring (physical RPi header pins):
 *   VCC → Pin 4 (5V)
 *   GND → Pin 9
 *   STB → Pin 29 (GPIO 5)
 *   CLK → Pin 31 (GPIO 6)
 *   DIO → Pin 33 (GPIO 13)
 *
 * Protocol summary:
 *   - Each transaction: STB low → clock out command/address/data bytes
 *     (LSB first) → STB high.
 *   - Command 0x40: data write, auto-increment address.
 *   - Command 0xC0 | addr: set starting address (0–15), each address
 *     holds one byte for one of the 8 digit/LED grids:
 *       addr 0 = digit0 segments, addr 1 = digit0 LED,
 *       addr 2 = digit1 segments, addr 3 = digit1 LED, ... etc.
 *   - Command 0x80 | 0x08 | brightness(0-7): display on + brightness.
 *   - Command 0x42: read key-scan data (4 bytes follow, bidirectional).
 */

const rpio = require("rpio");

class TM1638 {
  /**
   * Open the GPIO pins and run the TM1638 display init sequence.
   * @param {{stb?: number, clk?: number, dio?: number, brightness?: number}} [options] - RPi header pin numbers and initial brightness (0-7)
   */
  constructor({ stb = 29, clk = 31, dio = 33, brightness = 4 } = {}) {
    this.stb = stb;
    this.clk = clk;
    this.dio = dio;

    rpio.open(this.stb, rpio.OUTPUT, rpio.HIGH);
    rpio.open(this.clk, rpio.OUTPUT, rpio.HIGH);
    rpio.open(this.dio, rpio.OUTPUT, rpio.HIGH);

    this._initDisplay(brightness);
  }

  // ── Low-level bit I/O ─────────────────────────────────────────────────────

  /**
   * Clock one byte out on DIO, LSB first.
   * @param {number} byte
   * @returns {void}
   */
  _writeByte(byte) {
    for (let i = 0; i < 8; i++) {
      rpio.write(this.clk, rpio.LOW);
      rpio.write(this.dio, (byte >> i) & 1 ? rpio.HIGH : rpio.LOW);
      rpio.usleep(1);
      rpio.write(this.clk, rpio.HIGH);
      rpio.usleep(1);
    }
  }

  /**
   * Clock one byte in from DIO, LSB first.
   * @returns {number} the byte read
   */
  _readByte() {
    let byte = 0;
    for (let i = 0; i < 8; i++) {
      rpio.write(this.clk, rpio.LOW);
      rpio.usleep(1);
      const bit = rpio.read(this.dio);
      if (bit) byte |= (1 << i);
      rpio.write(this.clk, rpio.HIGH);
      rpio.usleep(1);
    }
    return byte;
  }

  /** @returns {void} */
  _strobeLow()  { rpio.write(this.stb, rpio.LOW); }
  /** @returns {void} */
  _strobeHigh() { rpio.write(this.stb, rpio.HIGH); }

  /**
   * Send a single command byte wrapped in a strobe low/high transaction.
   * @param {number} cmd
   * @returns {void}
   */
  _sendCommand(cmd) {
    this._strobeLow();
    this._writeByte(cmd);
    this._strobeHigh();
  }

  // ── Display setup ─────────────────────────────────────────────────────────

  /**
   * Set auto-increment write mode, apply brightness, and clear the display.
   * @param {number} brightness - 0-7
   * @returns {void}
   */
  _initDisplay(brightness) {
    this._sendCommand(0x40); // data write, auto-increment
    this.setBrightness(brightness);
    this.clear();
  }

  /**
   * Set display-on brightness level, clamped to the valid hardware range.
   * @param {number} level - 0-7
   * @returns {void}
   */
  setBrightness(level) {
    const b = Math.max(0, Math.min(7, level));
    this._sendCommand(0x80 | 0x08 | b); // display ON + brightness
  }

  /**
   * Blank all digit, LED, and segment registers.
   * @returns {void}
   */
  clear() {
    this._sendCommand(0x40);
    this._strobeLow();
    this._writeByte(0xC0); // start address 0
    for (let i = 0; i < 16; i++) this._writeByte(0x00);
    this._strobeHigh();
  }

  /**
   * Write all 8 digit segment bytes in one shot.
   * LED bytes are left untouched (written as 0) unless you call setLED separately.
   * @param {number[]} segments - segments[i] = raw 7-seg byte for digit i (bit0=a ... bit6=g, bit7=dp)
   * @returns {void}
   */
  setSegments(segments) {
    this._sendCommand(0x40);
    this._strobeLow();
    this._writeByte(0xC0); // start address 0
    for (let i = 0; i < 8; i++) {
      this._writeByte(segments[i] || 0x00); // digit i segments
      this._writeByte(0x00);                // digit i LED (untouched here)
    }
    this._strobeHigh();
  }

  /**
   * Turn a single discrete LED on or off.
   * @param {number} index - LED index 0-7
   * @param {boolean} on
   * @returns {void}
   */
  setLED(index, on) {
    const addr = (index * 2 + 1) & 0x0F;
    this._sendCommand(0x44); // fixed-address mode
    this._strobeLow();
    this._writeByte(0xC0 | addr);
    this._writeByte(on ? 0x01 : 0x00);
    this._strobeHigh();
    this._sendCommand(0x40); // back to auto-increment for next setSegments()
  }

  // ── Button reading ────────────────────────────────────────────────────────

  /**
   * Read the key-scan registers and decode the pressed buttons.
   * @returns {number} 8-bit mask: bit0 = S1 ... bit7 = S8 (1 = pressed)
   */
  getButtons() {
    this._strobeLow();
    this._writeByte(0x42); // read key-scan command

    rpio.open(this.dio, rpio.INPUT); // switch DIO to input for the reply
    rpio.usleep(2);                  // chip needs a moment to drive the line

    const raw = [];
    for (let i = 0; i < 4; i++) raw.push(this._readByte());

    rpio.open(this.dio, rpio.OUTPUT, rpio.HIGH); // back to output
    this._strobeHigh();

    let keys = 0;
    for (let i = 0; i < 4; i++) {
      keys |= (raw[i] & 0x01) << (i * 2);
      keys |= ((raw[i] >> 4) & 0x01) << (i * 2 + 1);
    }
    return keys;
  }
}

module.exports = TM1638;
