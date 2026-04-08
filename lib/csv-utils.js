'use strict';

/**
 * CSV writing and date utilities.
 * Zero external dependencies. Uses node:fs and node:path.
 *
 * Exports: epochMsToDate, generateWeeklyWindows, writeCsv, formatDateForFilename, formatDateISO
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Convert epoch milliseconds to a Date object.
 * Returns null if the value is invalid, NaN, or outside the 2015-2030 range.
 *
 * @param {number|string} ms - Epoch milliseconds
 * @returns {Date|null}
 */
function epochMsToDate(ms) {
  if (!ms || !isFinite(ms) || Number(ms) <= 0) return null;
  const date = new Date(Number(ms));
  if (isNaN(date.getTime())) return null;
  // Sanity check: between 2015 and 2030
  const year = date.getFullYear();
  if (year < 2015 || year > 2030) return null;
  return date;
}

/**
 * Generate weekly windows between startDate and endDate.
 * Each window is 7 days. The last window is capped at endDate.
 * Window start: 00:00:00.000, Window end: 23:59:59.999 (or endDate's day at 23:59:59.999)
 *
 * Generates weekly date windows for metrics bucketing.
 *
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Array<{start: Date, end: Date}>}
 */
function generateWeeklyWindows(startDate, endDate) {
  const windows = [];
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  for (let cur = new Date(start); cur <= end; ) {
    const next = new Date(cur);
    next.setDate(next.getDate() + 7);
    windows.push({
      start: new Date(cur),
      end: new Date(Math.min(next.getTime() - 1, end.getTime()))
    });
    cur = next;
  }
  return windows;
}

/**
 * Escape a CSV field value.
 * Wraps in double quotes if the value contains commas, double quotes, or newlines.
 * Escapes inner double quotes by doubling them.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeCsvField(value) {
  const str = String(value == null ? '' : value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Write a CSV file.
 * Creates parent directories if they don't exist.
 *
 * @param {string} filePath  - Absolute or relative file path
 * @param {string[]} headers - Column names
 * @param {Object[]} rows    - Array of objects with keys matching headers
 * @returns {number} - Number of rows written
 */
function writeCsv(filePath, headers, rows) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const lines = [];
  // Header row
  lines.push(headers.map(escapeCsvField).join(','));
  // Data rows
  for (const row of rows) {
    const values = headers.map(h => escapeCsvField(row[h] !== undefined ? row[h] : ''));
    lines.push(values.join(','));
  }

  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return rows.length;
}

/**
 * Return today's date as a YYYY-MM-DD string.
 * @returns {string}
 */
function formatDateForFilename() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Return an ISO 8601 string for use in Iterable API parameters.
 * Example: '2026-01-06T00:00:00.000Z'
 *
 * @param {Date} date
 * @returns {string}
 */
function formatDateISO(date) {
  return date.toISOString();
}

module.exports = {
  epochMsToDate,
  generateWeeklyWindows,
  writeCsv,
  formatDateForFilename,
  formatDateISO
};
