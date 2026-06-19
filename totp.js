"use strict";

const { exec } = require("child_process");

/**
 * Generate a TOTP code via oathtool for the given base32 secret.
 * @param {string} secret - base32 TOTP secret
 * @returns {Promise<string>} resolves to the 6-digit code
 */
function generateTOTP(secret) {
  return new Promise((resolve, reject) => {
    const safeSecret = (secret || "").replace(/[^A-Z2-7=]/gi, "");
    if (!safeSecret) {
      return reject(new Error("Invalid TOTP secret configured."));
    }

    exec(`oathtool --totp -b "${safeSecret}"`, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message || "oathtool failed"));
      }
      resolve(stdout.trim());
    });
  });
}

module.exports = { generateTOTP };
