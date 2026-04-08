#!/usr/bin/env node
'use strict';

/**
 * palm-metrics.js
 *
 * CLI orchestrator that runs the full Iterable metrics pipeline:
 *   Step 1: fetch-workflows  -> workflows CSV + active workflow IDs
 *   Step 2: fetch-campaigns  -> campaigns CSV + blast/triggered ID files
 *   Step 3: fetch-metrics    -> metrics CSV across weekly windows
 *
 * Usage (CLI):
 *   palm-metrics \
 *     --api-key "YOUR_KEY" \
 *     --base-url "https://api.iterable.com" \
 *     --client-name "acme" \
 *     [--output-dir "output"] \
 *     [--start-date "2025-12-26"] \
 *     [--end-date "2026-03-26"]
 *
 * Programmatic usage (Phase 4 MCP server):
 *   const { run } = require('./bin/palm-metrics');
 *   const result = await run({ apiKey, baseUrl, outputDir, clientName, startDate, endDate });
 *   // result: { workflows, campaigns, metrics, outputDir, warnings }
 *
 * Output directory: output/{client_name}/ (created automatically)
 *
 * Exit codes (CLI only):
 *   0 = success, all steps complete, no warnings
 *   1 = success with warnings (some metric batches failed but partial data written)
 *   2 = fatal error (step failed, pipeline stopped)
 */

const { run: runWorkflows } = require('../lib/fetch-workflows');
const { run: runCampaigns } = require('../lib/fetch-campaigns');
const { run: runMetrics } = require('../lib/fetch-metrics');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Parse --key value argument pairs from process.argv.
 * Custom parser for palm-metrics with different required args than lib scripts.
 *
 * @param {string[]} argv - process.argv
 * @returns {Object} - Parsed arguments as { 'api-key': '...', 'base-url': '...', ... }
 * @throws {Error} - If a required key is missing
 */
function parseCliArgs(argv) {
  const args = {};
  const rawArgs = argv.slice(2);

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = rawArgs[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith('--')) {
        args[key] = nextArg;
        i++;
      } else {
        args[key] = true;
      }
    }
  }

  const required = ['api-key', 'base-url'];
  for (const key of required) {
    if (!args[key] || args[key] === true) {
      throw new Error(`Missing required argument: --${key}`);
    }
  }

  return args;
}

/**
 * Run the full three-step metrics pipeline.
 *
 * Steps execute sequentially. If any step throws, the pipeline stops
 * and re-throws with a descriptive message. Partial CSV output from
 * earlier steps is preserved on disk.
 *
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {string} options.baseUrl
 * @param {string} [options.outputDir='output'] - Root output directory (client subdir appended)
 * @param {string} [options.clientName='default'] - Client name (used for output subdirectory)
 * @param {Date|string} [options.startDate] - Reporting start (defaults to 90 days ago)
 * @param {Date|string} [options.endDate] - Reporting end (defaults to now)
 * @returns {Promise<{
 *   workflows: { outputPath: string, workflowCount: number, activeWorkflowIdsPath: string },
 *   campaigns: { outputPath: string, campaignCount: number, blastCount: number, triggeredCount: number, blastIdsPath: string, triggeredIdsPath: string },
 *   metrics:   { outputPath: string, rowCount: number, windowCount: number, errors: string[] },
 *   outputDir: string,
 *   warnings:  string[]
 * }>}
 */
async function run(options) {
  // Compute date range once
  let endDate = options.endDate ? new Date(options.endDate) : new Date();
  endDate.setHours(23, 59, 59, 999);

  let startDate = options.startDate
    ? new Date(options.startDate)
    : new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
  startDate.setHours(0, 0, 0, 0);

  // Create client output directory
  const clientDir = path.join(options.outputDir || 'output', options.clientName || 'default');
  fs.mkdirSync(clientDir, { recursive: true });

  const sharedOpts = {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    outputDir: clientDir,
    clientName: options.clientName || 'default',
    startDate,
    endDate
  };

  // Step 1: Fetch workflows
  process.stderr.write('[palm-metrics] Step 1/3: Fetching workflows...\n');
  let wfResult;
  try {
    wfResult = await runWorkflows(sharedOpts);
    process.stderr.write(
      `[palm-metrics] Step 1/3 complete: ${wfResult.workflowCount} workflows -> ${wfResult.outputPath}\n`
    );
  } catch (err) {
    throw new Error(`Step 1 (fetch-workflows) failed: ${err.message}`);
  }

  // Step 2: Fetch campaigns
  process.stderr.write('[palm-metrics] Step 2/3: Fetching campaigns...\n');
  let campResult;
  try {
    campResult = await runCampaigns({
      ...sharedOpts,
      activeWorkflowsFile: wfResult.activeWorkflowIdsPath
    });
    process.stderr.write(
      `[palm-metrics] Step 2/3 complete: ${campResult.blastCount} blast + ${campResult.triggeredCount} triggered -> ${campResult.outputPath}\n`
    );
  } catch (err) {
    throw new Error(`Step 2 (fetch-campaigns) failed: ${err.message}`);
  }

  // Step 3: Fetch metrics
  process.stderr.write('[palm-metrics] Step 3/3: Fetching metrics...\n');
  let metrResult;
  try {
    metrResult = await runMetrics({
      ...sharedOpts,
      blastIdsFile: campResult.blastIdsPath,
      triggeredIdsFile: campResult.triggeredIdsPath
    });
    process.stderr.write(
      `[palm-metrics] Step 3/3 complete: ${metrResult.rowCount} metric rows -> ${metrResult.outputPath}\n`
    );
  } catch (err) {
    throw new Error(`Step 3 (fetch-metrics) failed: ${err.message}`);
  }

  const warnings = (metrResult.errors && metrResult.errors.length > 0) ? metrResult.errors : [];

  return {
    workflows: wfResult,
    campaigns: campResult,
    metrics: metrResult,
    outputDir: clientDir,
    warnings
  };
}

/**
 * CLI entry point — thin wrapper around run().
 */
async function main() {
  let args;
  try {
    args = parseCliArgs(process.argv);
  } catch (err) {
    process.stderr.write(`[ERROR] ${err.message}\n`);
    process.stderr.write(
      'Usage: palm-metrics --api-key KEY --base-url URL --client-name NAME [--output-dir DIR] [--start-date DATE] [--end-date DATE]\n'
    );
    process.exit(2);
  }

  try {
    const result = await run({
      apiKey: args['api-key'],
      baseUrl: args['base-url'],
      outputDir: args['output-dir'] || args['output'] || 'output',
      clientName: args['client-name'] || 'default',
      startDate: args['start-date'],
      endDate: args['end-date']
    });

    process.stderr.write(`[palm-metrics] Pipeline complete. Output: ${result.outputDir}\n`);
    process.stderr.write(`  Workflows: ${result.workflows.outputPath}\n`);
    process.stderr.write(`  Campaigns: ${result.campaigns.outputPath}\n`);
    process.stderr.write(`  Metrics:   ${result.metrics.outputPath}\n`);

    if (result.warnings.length > 0) {
      process.stderr.write(`[palm-metrics] ${result.warnings.length} warning(s) during metrics fetch\n`);
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[FATAL] ${err.message}\n`);
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = { run };
