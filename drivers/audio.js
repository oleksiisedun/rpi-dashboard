"use strict";

/**
 * drivers/audio.js — system audio playback via mpg123.
 *
 * Follows the hardware-detection pattern used by the other drivers: probes
 * for the mpg123 binary at module load, exposes `available`, and
 * no-ops/logs instead of throwing if it's missing, so the app keeps running
 * (in stub/log mode) on a dev machine without it installed.
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

let available = false;
let currentPlayer = null;
let pending = null; // { filePath, file } queued to play once currentPlayer exits
try {
  execSync("which mpg123", { stdio: "ignore" });
  available = true;
} catch (e) {
  console.warn(`[Audio] mpg123 not available (${e.message}) — running in stub/log mode`);
}

/**
 * Spawn mpg123 for a file and wire up its lifecycle handlers.
 * @param {string} filePath - absolute path to the .mp3 file
 * @param {string} file - basename, for logging
 * @returns {void}
 */
function spawnPlayer(filePath, file) {
  console.log(`[Audio] playing ${file}`);
  // -o pulse: a Bluetooth speaker is only reachable through PipeWire/
  // PulseAudio, not as a raw ALSA hw device — the service also needs
  // XDG_RUNTIME_DIR set so it can find that session's socket (see README).
  const player = spawn("mpg123", ["-q", "-o", "pulse", filePath], { stdio: ["ignore", "ignore", "pipe"] });
  currentPlayer = player;
  player.stderr.on("data", d => console.error(`[Audio] mpg123: ${d.toString().trim()}`));
  player.on("error", e => {
    console.error("[Audio] playback error:", e.message);
    if (currentPlayer === player) currentPlayer = null;
  });
  player.on("exit", code => {
    if (currentPlayer === player) currentPlayer = null;
    if (code !== 0 && !player.killedByUs) console.error(`[Audio] mpg123 exited with code ${code}`);
    if (pending) {
      const next = pending;
      pending = null;
      spawnPlayer(next.filePath, next.file);
    }
  });
}

/**
 * Play a random .mp3 file from a folder, fire-and-forget.
 * @param {string} folder - absolute path to a directory of .mp3 files
 * @returns {void}
 */
function playRandom(folder) {
  let files;
  try {
    files = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith(".mp3"));
  } catch (e) {
    console.warn(`[Audio] could not read ${folder}: ${e.message}`);
    return;
  }
  if (files.length === 0) {
    console.warn(`[Audio] no .mp3 files found in ${folder}`);
    return;
  }

  const file = files[Math.floor(Math.random() * files.length)];
  const filePath = path.join(folder, file);

  if (!available) {
    console.log(`[Audio stub] would play: ${filePath}`);
    return;
  }

  if (currentPlayer) {
    // Don't spawn a second mpg123 while the old one is still releasing the
    // audio sink (PulseAudio/Bluetooth teardown isn't instant) — queue this
    // file and let the exit handler above start it once the old one is gone.
    pending = { filePath, file };
    currentPlayer.killedByUs = true;
    currentPlayer.kill();
    return;
  }

  spawnPlayer(filePath, file);
}

module.exports = { available, playRandom };
