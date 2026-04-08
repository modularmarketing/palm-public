#!/usr/bin/env node
'use strict';

/**
 * fetch-metrics.js
 *
 * Retrieves campaign metrics from Iterable API across weekly windows.
 * Reads blast campaign IDs from .blast_campaign_ids.json (with metadata for per-window scoping)
 * and triggered campaign IDs from .triggered_campaign_ids.json.
 * Handles batching (50 IDs/request), 600ms rate limiting, 414 fallback,
 * and merges variable CSV columns across batches/mediums.
 *
 * Usage (CLI):
 *   node lib/fetch-metrics.js \
 *     --api-key "YOUR_KEY" \
 *     --base-url "https://api.iterable.com" \
 *     --output-dir "output/client_name" \
 *     --start-date "2025-12-26" \
 *     --end-date "2026-03-26" \
 *     --blast-ids-file "output/client_name/.blast_campaign_ids.json" \
 *     --triggered-ids-file "output/client_name/.triggered_campaign_ids.json" \
 *     [--campaign-ids-file "output/client_name/.campaign_ids.json"]  (legacy fallback)
 *     [--window-index 0]
 *
 * Programmatic usage:
 *   const { run } = require('./lib/fetch-metrics');
 *   const result = await run({ apiKey, baseUrl, outputDir, startDate, endDate, blastIdsFile, triggeredIdsFile });
 *   // result: { outputPath, rowCount, windowCount, errors }
 *
 * Exit codes (CLI only):
 *   0 = success (all windows/batches succeeded)
 *   1 = partial failure (some data written, some requests failed)
 *   2 = fatal error (bad API key, can't read campaign IDs, no data at all)
 */

const fs = require('node:fs');
const path = require('node:path');
const { iterableFetch, sleep, parseArgs } = require('./iterable-client');
const {
  generateWeeklyWindows,
  writeCsv,
  formatDateISO,
  epochMsToDate,
  formatDateForFilename
} = require('./csv-utils');

// Match reference MAX_CAMPAIGNS_PER_REQUEST = 50 to avoid 414 entirely
const BATCH_SIZE_START = 50;

/**
 * Parse a CSV text response from the metrics endpoint.
 * Returns { headers: string[], rows: Object[] }
 * If the response is empty or header-only, returns { headers: [], rows: [] }
 *
 * @param {string} csvText
 * @returns {{ headers: string[], rows: Object[] }}
 */
function parseCsvResponse(csvText) {
  if (!csvText || !csvText.trim()) {
    return { headers: [], rows: [] };
  }

  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = lines[0].split(',').map(h => h.trim());
  if (lines.length === 1) {
    // Header-only response: no data rows
    return { headers, rows: [] };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] !== undefined ? values[j].trim() : '';
    }
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Fetch metrics for a batch of campaign IDs within a single time window.
 * Handles 414 by halving batch size and retrying. Tracks batch progress internally.
 *
 * @param {number[]} campaignIds
 * @param {{start: Date, end: Date}} window
 * @param {string} apiKey
 * @param {string} baseUrl
 * @param {number} batchSize - starting batch size for this call
 * @param {string} windowLabel - for progress output
 * @param {number} windowIdx
 * @param {number} totalWindows
 * @returns {Promise<{ headers: string[], rows: Object[], errors: string[] }>}
 */
async function fetchMetricsBatch(
  campaignIds, window, apiKey, baseUrl,
  batchSize, windowLabel,
  windowIdx, totalWindows
) {
  let currentBatchSize = batchSize;
  let offset = 0;
  const allHeaders = [];
  const allRows = [];
  const errors = [];
  let batchNumber = 0;

  while (offset < campaignIds.length) {
    // Recompute batchIds each iteration using currentBatchSize (fixes BUG-1)
    const batchIds = campaignIds.slice(offset, offset + currentBatchSize);
    batchNumber++;
    const totalBatches = Math.ceil(campaignIds.length / currentBatchSize);

    process.stderr.write(
      `[PROGRESS] Window ${windowIdx + 1}/${totalWindows} - Batch ${batchNumber}/${totalBatches}` +
      ` - Week of ${windowLabel} (${batchIds.length} campaigns)\n`
    );

    let response;

    // Retry loop for 414 handling — break out on 414 to let outer loop recompute batchIds
    try {
      response = await iterableFetch(
        '/api/campaigns/metrics',
        {
          campaignId: batchIds,
          startDateTime: formatDateISO(window.start),
          endDateTime: formatDateISO(window.end)
        },
        apiKey,
        baseUrl
      );
    } catch (err) {
      if (err.message && err.message.includes('414')) {
        const newSize = Math.floor(currentBatchSize / 2);
        if (newSize < 1) {
          errors.push(`[ERROR] Batch size reached 0 for window ${windowLabel}. Skipping.`);
          process.stderr.write(`[ERROR] Batch size reduction failed for window ${windowLabel}, skipping batch.\n`);
          offset += batchIds.length;
          continue;
        }
        process.stderr.write(`[PROGRESS] Batch size reduced from ${currentBatchSize} to ${newSize} due to URL length limit\n`);
        currentBatchSize = newSize;
        // Do NOT advance offset — outer loop re-enters with reduced batch size and recomputes batchIds
        batchNumber--; // Undo the increment since we're retrying
        continue;
      }
      // Non-414 error
      errors.push(`[ERROR] Window ${windowLabel}, batch offset ${offset}: ${err.message}`);
      process.stderr.write(`[ERROR] ${err.message}\n`);
      offset += batchIds.length;
      continue;
    }

    const csvText = await response.text();
    const { headers, rows } = parseCsvResponse(csvText);

    // Merge headers (union)
    for (const h of headers) {
      if (!allHeaders.includes(h)) {
        allHeaders.push(h);
      }
    }
    allRows.push(...rows);

    offset += batchIds.length;

    // 800ms delay between metrics requests (600ms from reference hit 429s on large accounts)
    await sleep(800);
  }

  return { headers: allHeaders, rows: allRows, errors };
}

/**
 * Fetch all metrics across weekly windows and write to CSV. Returns result metadata.
 *
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {string} options.baseUrl
 * @param {string} options.outputDir - Directory to write output files
 * @param {string} [options.clientName] - Optional client name for logging
 * @param {Date|string} [options.startDate] - Reporting start (defaults to 90 days ago)
 * @param {Date|string} [options.endDate] - Reporting end (defaults to now)
 * @param {string} [options.blastIdsFile] - Path to .blast_campaign_ids.json
 * @param {string} [options.triggeredIdsFile] - Path to .triggered_campaign_ids.json
 * @returns {Promise<{ outputPath: string, rowCount: number, windowCount: number, errors: string[] }>}
 */
async function run(options) {
  const { apiKey, baseUrl, outputDir, blastIdsFile, triggeredIdsFile } = options;

  const outputPath = path.join(outputDir, 'metrics_' + formatDateForFilename() + '.csv');

  let blastCampaigns = []; // Array of { id, startAt, createdAt }
  let triggeredCampaignIds = [];

  if (blastIdsFile) {
    try {
      const raw = fs.readFileSync(blastIdsFile, 'utf8');
      const data = JSON.parse(raw);
      blastCampaigns = data.campaigns || [];
      console.error(`[PROGRESS] Loaded ${blastCampaigns.length} blast campaigns for per-window scoping`);
    } catch (err) {
      throw new Error(`Failed to read blast campaign IDs from ${blastIdsFile}: ${err.message}`);
    }
  }

  if (triggeredIdsFile) {
    try {
      const raw = fs.readFileSync(triggeredIdsFile, 'utf8');
      const data = JSON.parse(raw);
      triggeredCampaignIds = data.campaignIds || [];
      console.error(`[PROGRESS] Loaded ${triggeredCampaignIds.length} triggered campaign IDs (sent to all windows)`);
    } catch (err) {
      throw new Error(`Failed to read triggered campaign IDs from ${triggeredIdsFile}: ${err.message}`);
    }
  }

  if (blastCampaigns.length === 0 && triggeredCampaignIds.length === 0) {
    throw new Error('No campaign IDs found. Run fetch-campaigns first.');
  }

  // Parse date range — accept Date objects or date strings
  let endDate = options.endDate ? new Date(options.endDate) : new Date();
  endDate.setHours(23, 59, 59, 999);

  let startDate = options.startDate
    ? new Date(options.startDate)
    : new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
  startDate.setHours(0, 0, 0, 0);

  const allWindows = generateWeeklyWindows(startDate, endDate);

  // Process newest-to-oldest so timeouts preserve recent data
  const windowsToProcess = allWindows.slice().reverse();

  const totalWindows = allWindows.length;
  const batchSize = BATCH_SIZE_START;

  // Accumulated across all windows
  const mergedHeaderSet = new Set();
  const allRows = [];
  const allErrors = [];

  for (let wi = 0; wi < windowsToProcess.length; wi++) {
    const window = windowsToProcess[wi];
    const realWindowIdx = wi;

    // Format window start as YYYY-MM-DD for progress output
    const windowStart = window.start;
    const yyyy = windowStart.getFullYear();
    const mm = String(windowStart.getMonth() + 1).padStart(2, '0');
    const dd = String(windowStart.getDate()).padStart(2, '0');
    const windowLabel = `${yyyy}-${mm}-${dd}`;

    // Layer 3: blast campaigns only included if date falls within windowStart-14d to windowEnd
    const lowerBound = new Date(window.start.getTime() - 14 * 24 * 60 * 60 * 1000);
    const windowBlastIds = blastCampaigns
      .filter(c => {
        const campaignDate = epochMsToDate(c.startAt) || epochMsToDate(c.createdAt);
        if (!campaignDate) return false;
        return campaignDate >= lowerBound && campaignDate <= window.end;
      })
      .map(c => c.id);

    // Triggered campaigns: send all to every window (long-running; API returns zero for inactive periods)
    const windowCampaignIds = [...windowBlastIds, ...triggeredCampaignIds];

    if (windowCampaignIds.length === 0) {
      console.error(`[PROGRESS] Window ${realWindowIdx + 1}/${totalWindows} - ${windowLabel}: 0 campaigns, skipping`);
      continue;
    }

    console.error(`[PROGRESS] Window ${realWindowIdx + 1}/${totalWindows} - ${windowLabel}: ${windowBlastIds.length} blast + ${triggeredCampaignIds.length} triggered = ${windowCampaignIds.length} campaigns`);

    const { headers, rows, errors } = await fetchMetricsBatch(
      windowCampaignIds, window, apiKey, baseUrl,
      batchSize, windowLabel,
      realWindowIdx, totalWindows
    );

    // Stamp each row with the window date range
    const windowStartISO = formatDateISO(window.start);
    const windowEndISO = formatDateISO(window.end);
    for (const row of rows) {
      row['window_start'] = windowStartISO;
      row['window_end'] = windowEndISO;
    }

    for (const h of headers) {
      mergedHeaderSet.add(h);
    }
    mergedHeaderSet.add('window_start');
    mergedHeaderSet.add('window_end');
    allRows.push(...rows);
    allErrors.push(...errors);
  }

  // Build final merged headers: 'id' first, alphabetical middle, window_start/window_end last
  const allHeadersArr = Array.from(mergedHeaderSet);
  const idHeader = allHeadersArr.includes('id') ? ['id'] : [];
  const windowHeaders = ['window_start', 'window_end'];
  const restHeaders = allHeadersArr
    .filter(h => h !== 'id' && !windowHeaders.includes(h))
    .sort((a, b) => a.localeCompare(b));
  const finalHeaders = [...idHeader, ...restHeaders, ...windowHeaders];

  if (finalHeaders.length === 0) {
    if (allErrors.length > 0) {
      for (const e of allErrors) {
        process.stderr.write(`${e}\n`);
      }
      throw new Error('No metrics data retrieved and errors occurred.');
    }
    // No errors, just no data — empty output is valid (no campaigns sent)
    process.stderr.write(
      `[COMPLETE] 0 metrics rows written to ${outputPath} across ${windowsToProcess.length} weekly windows\n`
    );
    writeCsv(outputPath, [], []);
    return { outputPath, rowCount: 0, windowCount: windowsToProcess.length, errors: allErrors };
  }

  const rowCount = writeCsv(outputPath, finalHeaders, allRows);

  if (allErrors.length > 0) {
    for (const e of allErrors) {
      process.stderr.write(`${e}\n`);
    }
  }

  process.stderr.write(
    `[COMPLETE] ${rowCount} metrics rows written to ${outputPath} across ${windowsToProcess.length} weekly windows\n`
  );

  return { outputPath, rowCount, windowCount: windowsToProcess.length, errors: allErrors };
}

/**
 * CLI entry point — thin wrapper around run().
 */
async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`[ERROR] ${err.message}\n`);
    process.stderr.write(
      'Usage: node fetch-metrics.js --api-key KEY --base-url URL --output-dir DIR ' +
      '--start-date DATE --end-date DATE --blast-ids-file PATH --triggered-ids-file PATH ' +
      '[--campaign-ids-file PATH] [--window-index N]\n'
    );
    process.exit(2);
  }

  const apiKey = args['api-key'];
  const baseUrl = args['base-url'];

  // Support both --output-dir (new) and --output (legacy, derive outputDir from path)
  let outputDir;
  if (args['output-dir']) {
    outputDir = args['output-dir'];
  } else if (args['output']) {
    outputDir = path.dirname(args['output']);
  } else {
    process.stderr.write('[ERROR] Missing required argument: --output-dir or --output\n');
    process.exit(2);
  }

  const blastIdsFile = args['blast-ids-file'];
  const triggeredIdsFile = args['triggered-ids-file'];
  // Also support legacy --campaign-ids-file for backward compat — handle in main() only
  const legacyCampaignIdsFile = args['campaign-ids-file'];

  // If using legacy mode, read into triggeredCampaignIds before calling run()
  // This keeps run() clean (no legacy handling inside run())
  let legacyBlastIdsFile = blastIdsFile;
  let legacyTriggeredIdsFile = triggeredIdsFile;

  if (!blastIdsFile && !triggeredIdsFile && legacyCampaignIdsFile) {
    // Legacy: write a temp triggered ids file pointing at the legacy data
    // Actually, we pass it directly as triggeredIdsFile (it has campaignIds field)
    legacyTriggeredIdsFile = legacyCampaignIdsFile;
    process.stderr.write(`[PROGRESS] Legacy mode: using ${legacyCampaignIdsFile} as triggered-ids-file (no per-window scoping)\n`);
  }

  // Optional single-window mode (--window-index N) - handled by computing startDate/endDate for that window
  // For now, pass through to run() as date range (window-index support is a CLI-only feature)

  try {
    const result = await run({
      apiKey,
      baseUrl,
      outputDir,
      startDate: args['start-date'],
      endDate: args['end-date'],
      blastIdsFile: legacyBlastIdsFile,
      triggeredIdsFile: legacyTriggeredIdsFile
    });
    process.exit(result.errors.length > 0 ? 1 : 0);
  } catch (err) {
    process.stderr.write(`[FATAL] ${err.message}\n`);
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`[FATAL] ${err.message}\n`);
    process.exit(2);
  });
}

module.exports = { run };
