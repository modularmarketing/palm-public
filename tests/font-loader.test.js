'use strict';

const { describe, test, expect } = require('bun:test');
const { generateFontFaceCSS } = require('../lib/font-loader');

describe('generateFontFaceCSS', () => {
  test('returns a string', () => {
    const css = generateFontFaceCSS();
    expect(typeof css).toBe('string');
  });

  test('contains 3 @font-face declarations', () => {
    const css = generateFontFaceCSS();
    const matches = css.match(/@font-face/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(3);
  });

  test('contains font-weight: 400', () => {
    const css = generateFontFaceCSS();
    expect(css).toContain('font-weight: 400');
  });

  test('contains font-weight: 600', () => {
    const css = generateFontFaceCSS();
    expect(css).toContain('font-weight: 600');
  });

  test('contains font-weight: 900', () => {
    const css = generateFontFaceCSS();
    expect(css).toContain('font-weight: 900');
  });

  test('contains font-display: swap in each declaration', () => {
    const css = generateFontFaceCSS();
    const matches = css.match(/font-display: swap/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(3);
  });

  test('contains data:font/woff2;base64, prefix in each src url()', () => {
    const css = generateFontFaceCSS();
    const matches = css.match(/data:font\/woff2;base64,/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(3);
  });

  test("contains font-family: 'Inter' in each declaration", () => {
    const css = generateFontFaceCSS();
    const matches = css.match(/font-family: 'Inter'/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBe(3);
  });
});
