"use strict";

const express = require("express");
const { LATIN_RAW, CYR, CUSTOM, UNKNOWN_GLYPH } = require("../../font.js");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.static(__dirname));

/**
 * GET /api/font — returns the real bitmap font tables from font.js, so
 * index.html never has to hand-duplicate glyph data.
 * @param {express.Request} req
 * @param {express.Response} res
 * @returns {void}
 */
app.get("/api/font", (req, res) => {
  res.json({ LATIN_RAW, CYR, CUSTOM, UNKNOWN_GLYPH });
});

app.listen(PORT, () => {
  console.log(`Glyph editor running at http://localhost:${PORT}/`);
});
