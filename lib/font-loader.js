'use strict';

/**
 * font-loader.js — Inter woff2 font encoding for dashboard CSS
 *
 * Reads Inter woff2 font files from assets/fonts/ and generates
 * @font-face CSS declarations with base64-encoded font data.
 *
 * Used by assembler.js to inline fonts into the self-contained HTML output.
 * The generated CSS ensures Inter renders correctly from file:// protocol
 * with no external dependencies.
 *
 * Exports: { generateFontFaceCSS }
 */

const fs   = require('node:fs');
const path = require('node:path');

const FONT_DIR = path.resolve(__dirname, '../assets/fonts');

const WEIGHTS = [
  { file: 'Inter-Regular.woff2',  weight: 400 },
  { file: 'Inter-SemiBold.woff2', weight: 600 },
  { file: 'Inter-Black.woff2',    weight: 900 },
];

/**
 * generateFontFaceCSS()
 *
 * Reads each Inter woff2 file, base64-encodes it, and returns a CSS string
 * containing 3 @font-face declarations for weights 400, 600, and 900.
 *
 * @returns {string} CSS @font-face block ready for inline injection
 */
function generateFontFaceCSS() {
  const declarations = WEIGHTS.map(({ file, weight }) => {
    const fontPath = path.join(FONT_DIR, file);
    let fontData;
    try {
      fontData = fs.readFileSync(fontPath);
    } catch (err) {
      console.error(`[font-loader] Failed to read ${fontPath}: ${err.message}`);
      throw err;
    }
    const base64 = fontData.toString('base64');
    return `@font-face {
  font-family: 'Inter';
  font-weight: ${weight};
  font-style: normal;
  font-display: swap;
  src: url(data:font/woff2;base64,${base64}) format('woff2');
}`;
  });

  return declarations.join('\n');
}

module.exports = { generateFontFaceCSS };
