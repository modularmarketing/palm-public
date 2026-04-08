#!/usr/bin/env node
'use strict';

/**
 * fetch-workflows.js
 *
 * Retrieves all non-archived workflows (journeys) from the Iterable API
 * via pagination and writes a CSV file.
 *
 * Usage (CLI):
 *   node lib/fetch-workflows.js \
 *     --api-key "YOUR_KEY" \
 *     --base-url "https://api.iterable.com" \
 *     --output-dir "output/client_name"
 *
 * Programmatic usage:
 *   const { run } = require('./lib/fetch-workflows');
 *   const result = await run({ apiKey, baseUrl, outputDir, clientName });
 *   // result: { outputPath, workflowCount, activeWorkflowIdsPath }
 *
 * Exit codes (CLI only):
 *   0 = success
 *   2 = fatal error (bad API key, network failure, missing args)
 */

const fs = require('node:fs');
const path = require('node:path');
const { iterableFetch, parseArgs } = require('./iterable-client');
const { epochMsToDate, writeCsv, formatDateForFilename } = require('./csv-utils');

const PAGE_SIZE = 50; // Max per Iterable docs for GET /api/journeys

/**
 * Convert epoch ms fields to ISO strings, fall back to empty string.
 *
 * @param {number|undefined} ms
 * @returns {string}
 */
function epochMsToIso(ms) {
  if (ms === undefined || ms === null) return '';
  const date = epochMsToDate(ms);
  return date ? date.toISOString() : '';
}

/**
 * Paginate GET /api/journeys and return all workflow objects.
 *
 * @param {string} apiKey
 * @param {string} baseUrl
 * @returns {Promise<Object[]>}
 */
async function fetchAllWorkflows(apiKey, baseUrl) {
  const allWorkflows = [];
  let page = 1;
  let totalExpected = null;

  while (true) {
    process.stderr.write(`[PROGRESS] Fetching workflows page ${page}${totalExpected ? ' (of ~' + Math.ceil(totalExpected / PAGE_SIZE) + ')' : ''}...\n`);

    const response = await iterableFetch(
      '/api/journeys',
      { page, pageSize: PAGE_SIZE },
      apiKey,
      baseUrl
    );

    const data = await response.json();

    // Capture total count from API response (Iterable provides totalJourneysCount)
    if (data.totalJourneysCount !== undefined && totalExpected === null) {
      totalExpected = data.totalJourneysCount;
      process.stderr.write(`[INFO] API reports ${totalExpected} total journeys\n`);
    }

    // Handle various response shapes: array at top level or inside a key
    let workflows;
    if (Array.isArray(data)) {
      workflows = data;
    } else if (Array.isArray(data.journeys)) {
      workflows = data.journeys;
    } else if (Array.isArray(data.workflows)) {
      workflows = data.workflows;
    } else {
      // Unknown shape — log and stop
      process.stderr.write(
        `[WARN] Unexpected response shape on page ${page}: ${JSON.stringify(Object.keys(data))}\n`
      );
      workflows = [];
    }

    allWorkflows.push(...workflows);

    // Stop conditions (in priority order):
    // 1. Empty page — no more data
    if (workflows.length === 0) break;
    // 2. Reached the total count reported by the API
    if (totalExpected !== null && allWorkflows.length >= totalExpected) break;
    // 3. No nextPageUrl means this is the last page
    if (data.nextPageUrl === undefined || data.nextPageUrl === null) break;

    page++;
  }

  if (totalExpected !== null && allWorkflows.length < totalExpected) {
    process.stderr.write(`[WARN] Expected ${totalExpected} workflows but only fetched ${allWorkflows.length}\n`);
  }

  return allWorkflows;
}

/**
 * Build CSV headers from all workflow objects dynamically.
 * Ensures id, name, state, createdAt, updatedAt come first, then any other fields.
 *
 * @param {Object[]} workflows
 * @returns {string[]}
 */
function buildHeaders(workflows) {
  if (workflows.length === 0) {
    return ['id', 'name', 'state', 'createdAt', 'updatedAt'];
  }

  // Collect all unique keys across all workflow objects
  const keySet = new Set();
  for (const wf of workflows) {
    for (const key of Object.keys(wf)) {
      keySet.add(key);
    }
  }

  // Priority fields first, then remaining keys alphabetically
  const priority = ['id', 'name', 'state', 'createdAt', 'updatedAt'];
  const remaining = Array.from(keySet)
    .filter(k => !priority.includes(k))
    .sort((a, b) => a.localeCompare(b));

  return [...priority.filter(k => keySet.has(k)), ...remaining];
}

/**
 * Build a CSV row object for a workflow, converting epoch ms date fields to ISO strings.
 *
 * @param {Object} workflow
 * @param {string[]} headers
 * @returns {Object}
 */
function buildCsvRow(workflow, headers) {
  const row = {};
  for (const key of headers) {
    const value = workflow[key];
    if (value === undefined || value === null) {
      row[key] = '';
    } else if (key === 'createdAt' || key === 'updatedAt') {
      row[key] = epochMsToIso(value);
    } else if (typeof value === 'object') {
      // Serialize nested objects as JSON strings
      row[key] = JSON.stringify(value);
    } else {
      row[key] = value;
    }
  }
  return row;
}

/**
 * Fetch all workflows and write to CSV. Returns result metadata.
 *
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {string} options.baseUrl
 * @param {string} options.outputDir - Directory to write output files
 * @param {string} [options.clientName] - Optional client name for logging
 * @returns {Promise<{ outputPath: string, workflowCount: number, activeWorkflowIdsPath: string }>}
 */
async function run(options) {
  const { apiKey, baseUrl, outputDir } = options;

  const outputPath = path.join(outputDir, 'workflows_' + formatDateForFilename() + '.csv');
  const activeIdsPath = path.join(outputDir, '.active_workflow_ids.json');

  let allWorkflows;
  try {
    allWorkflows = await fetchAllWorkflows(apiKey, baseUrl);
  } catch (err) {
    throw new Error(`Failed to fetch workflows: ${err.message}`);
  }

  // Filter to active workflows: enabled, not archived, not draft
  const activeWorkflows = allWorkflows.filter(wf => {
    if (wf.enabled !== true) return false;
    if (wf.isArchived === true) return false;
    if ((wf.journeyType || '').toLowerCase() === 'draft') return false;
    return true;
  });

  const headers = buildHeaders(allWorkflows);
  const rows = allWorkflows.map(wf => buildCsvRow(wf, headers));

  writeCsv(outputPath, headers, rows);

  // Write active workflow IDs for downstream triggered campaign gating
  const activeIds = activeWorkflows.map(wf => wf.id);
  const activeIdsData = {
    activeWorkflowIds: activeIds,
    totalWorkflows: allWorkflows.length,
    activeCount: activeIds.length,
    filteredAt: new Date().toISOString()
  };
  fs.writeFileSync(activeIdsPath, JSON.stringify(activeIdsData, null, 2), 'utf8');

  process.stderr.write(`[COMPLETE] ${allWorkflows.length} workflows written to ${outputPath}, ${activeIds.length} active workflow IDs saved\n`);

  return {
    outputPath,
    workflowCount: allWorkflows.length,
    activeWorkflowIdsPath: activeIdsPath
  };
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
      'Usage: node fetch-workflows.js --api-key KEY --base-url URL --output-dir DIR\n'
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

  try {
    await run({ apiKey, baseUrl, outputDir });
  } catch (err) {
    process.stderr.write(`[FATAL] ${err.message}\n`);
    process.exit(2);
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`[FATAL] ${err.message}\n`);
    process.exit(2);
  });
}

module.exports = { run };
