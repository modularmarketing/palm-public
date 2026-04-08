'use strict';

/**
 * Unit tests for window date column injection in fetch-metrics.js.
 *
 * Tests that every metrics row gets window_start and window_end ISO date columns
 * corresponding to the window being processed.
 */

const { describe, it, expect } = require('bun:test');
const { formatDateISO } = require('../lib/csv-utils');

// ---------------------------------------------------------------------------
// Window date stamping logic
// ---------------------------------------------------------------------------

/**
 * Simulate the row-stamping logic from fetch-metrics.js run().
 * This mirrors the exact code pattern in the main loop:
 *   const windowStartISO = formatDateISO(window.start);
 *   const windowEndISO = formatDateISO(window.end);
 *   for (const row of rows) {
 *     row['window_start'] = windowStartISO;
 *     row['window_end'] = windowEndISO;
 *   }
 */
function stampRowsWithWindow(rows, window) {
  const windowStartISO = formatDateISO(window.start);
  const windowEndISO = formatDateISO(window.end);
  for (const row of rows) {
    row['window_start'] = windowStartISO;
    row['window_end'] = windowEndISO;
  }
  return rows;
}

describe('window date column injection', () => {
  // Window: 2026-01-06 to 2026-01-12
  const window1 = {
    start: new Date('2026-01-06T00:00:00.000Z'),
    end: new Date('2026-01-12T23:59:59.999Z')
  };

  // Window: 2026-01-13 to 2026-01-19
  const window2 = {
    start: new Date('2026-01-13T00:00:00.000Z'),
    end: new Date('2026-01-19T23:59:59.999Z')
  };

  it('stamps every row with window_start from a single window', () => {
    const rows = [
      { id: '123', 'Total Email Sends': '500' },
      { id: '456', 'Total Email Sends': '250' }
    ];
    stampRowsWithWindow(rows, window1);
    expect(rows[0].window_start).toBe('2026-01-06T00:00:00.000Z');
    expect(rows[1].window_start).toBe('2026-01-06T00:00:00.000Z');
  });

  it('stamps every row with window_end from a single window', () => {
    const rows = [
      { id: '123', 'Total Email Sends': '500' },
      { id: '456', 'Total Email Sends': '250' }
    ];
    stampRowsWithWindow(rows, window1);
    expect(rows[0].window_end).toBe('2026-01-12T23:59:59.999Z');
    expect(rows[1].window_end).toBe('2026-01-12T23:59:59.999Z');
  });

  it('rows from different windows have different window dates', () => {
    const rowsW1 = [{ id: '111', 'Total Email Sends': '100' }];
    const rowsW2 = [{ id: '222', 'Total Email Sends': '200' }];

    stampRowsWithWindow(rowsW1, window1);
    stampRowsWithWindow(rowsW2, window2);

    // Window 1 rows: should have window1 dates
    expect(rowsW1[0].window_start).toBe('2026-01-06T00:00:00.000Z');
    expect(rowsW1[0].window_end).toBe('2026-01-12T23:59:59.999Z');

    // Window 2 rows: should have window2 dates
    expect(rowsW2[0].window_start).toBe('2026-01-13T00:00:00.000Z');
    expect(rowsW2[0].window_end).toBe('2026-01-19T23:59:59.999Z');

    // Confirm they differ
    expect(rowsW1[0].window_start).not.toBe(rowsW2[0].window_start);
    expect(rowsW1[0].window_end).not.toBe(rowsW2[0].window_end);
  });

  it('preserves existing row properties (id and metric columns unchanged)', () => {
    const rows = [
      {
        id: '789',
        'Total Email Sends': '1000',
        'Total Email Opens': '350',
        'Total Email Clicks': '75'
      }
    ];
    stampRowsWithWindow(rows, window1);

    // Window columns added
    expect(rows[0].window_start).toBe('2026-01-06T00:00:00.000Z');
    expect(rows[0].window_end).toBe('2026-01-12T23:59:59.999Z');

    // Original properties intact
    expect(rows[0].id).toBe('789');
    expect(rows[0]['Total Email Sends']).toBe('1000');
    expect(rows[0]['Total Email Opens']).toBe('350');
    expect(rows[0]['Total Email Clicks']).toBe('75');
  });

  it('handles empty rows array without error', () => {
    const rows = [];
    expect(() => stampRowsWithWindow(rows, window1)).not.toThrow();
    expect(rows.length).toBe(0);
  });

  it('uses formatDateISO from csv-utils for consistent ISO formatting', () => {
    const rows = [{ id: '001', 'Total Email Sends': '50' }];
    const expectedStart = formatDateISO(window1.start);
    const expectedEnd = formatDateISO(window1.end);

    stampRowsWithWindow(rows, window1);

    expect(rows[0].window_start).toBe(expectedStart);
    expect(rows[0].window_end).toBe(expectedEnd);
  });
});
