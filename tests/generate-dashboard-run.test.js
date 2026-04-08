'use strict';

/**
 * generate-dashboard-run.test.js
 *
 * Tests for the programmatic run(context) export added to generate-dashboard.js
 * for MCP tool consumption.
 */

const { describe, it, expect } = require('bun:test');

describe('generate-dashboard run() export', () => {
  it('exports a run function', () => {
    const mod = require('../lib/generate-dashboard');
    expect(typeof mod.run).toBe('function');
  });

  it('run is async (returns a Promise)', () => {
    // We don't call it (that would invoke the full pipeline),
    // but we can verify the function exists and is a named export.
    const mod = require('../lib/generate-dashboard');
    expect(mod.run).toBeDefined();
    // run should be an async function (constructor name is 'AsyncFunction')
    expect(mod.run.constructor.name).toBe('AsyncFunction');
  });

  it('module still has process.exit in main() (main untouched)', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../lib/generate-dashboard'), 'utf8');
    expect(src).toContain('process.exit(0)');
    expect(src).toContain('process.exit(2)');
  });

  it('module has zero console.log calls', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../lib/generate-dashboard'), 'utf8');
    // Strip comments before checking to avoid false positives in comment blocks
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(noComments).not.toContain('console.log');
  });

  it('module.exports contains run', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../lib/generate-dashboard'), 'utf8');
    expect(src).toContain('module.exports');
    expect(src).toContain('{ run }');
  });
});
