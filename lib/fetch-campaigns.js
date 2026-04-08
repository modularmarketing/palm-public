#!/usr/bin/env node
'use strict';

/**
 * fetch-campaigns.js
 *
 * Retrieves campaigns from Iterable API, applies eligibility filtering,
 * writes campaigns CSV and campaign_ids.json for downstream metrics retrieval.
 *
 * Usage (CLI):
 *   node lib/fetch-campaigns.js \
 *     --api-key "YOUR_KEY" \
 *     --base-url "https://api.iterable.com" \
 *     --output-dir "output/client_name" \
 *     --start-date "2025-12-26" \
 *     --end-date "2026-03-26"
 *
 * Programmatic usage:
 *   const { run } = require('./lib/fetch-campaigns');
 *   const result = await run({ apiKey, baseUrl, outputDir, startDate, endDate, activeWorkflowsFile });
 *   // result: { outputPath, campaignCount, blastCount, triggeredCount, blastIdsPath, triggeredIdsPath }
 *
 * Exit codes (CLI only):
 *   0 = success
 *   1 = partial failure (some data written, some errors)
 *   2 = fatal error (bad API key, network failure, missing args)
 */

const path = require('node:path');
const fs = require('node:fs');
const { iterableFetch, parseArgs } = require('./iterable-client');
const { epochMsToDate, writeCsv, formatDateISO, formatDateForFilename } = require('./csv-utils');

const CAMPAIGNS_PER_PAGE = 1000;

/**
 * Filter blast campaigns by state, type, and size thresholds.
 *
 * Blast campaigns: state=Finished (case-sensitive), type=Blast (case-sensitive, required),
 * sendSize>100, campaign date within reporting window.
 *
 * @param {Object[]} campaigns  - Raw campaign objects from API
 * @param {Date}     startDate  - Reporting interval start
 * @param {Date}     endDate    - Reporting interval end
 * @returns {Object[]}
 */
function filterBlastCampaigns(campaigns, startDate, endDate) {
  return campaigns.filter(c => {
    const state = c.campaignState || '';
    if (state !== 'Finished') return false;

    const type = c.type || '';
    if (type !== 'Blast') return false;

    if (Number(c.sendSize || 0) <= 100) return false;

    const campaignDate = epochMsToDate(c.startAt) || epochMsToDate(c.createdAt);
    if (!campaignDate) return false;

    return campaignDate >= startDate && campaignDate <= endDate;
  });
}

/**
 * Filter triggered campaigns by workflow association and date range.
 *
 * Triggered campaigns: state=Running (case-sensitive), type=Triggered (case-sensitive),
 * must have workflowId, optionally gated by active workflow set. No date restriction.
 *
 * @param {Object[]} campaigns         - Raw campaign objects from API
 * @param {Set|null} activeWorkflowIds - Set of active workflow IDs (from fetch-workflows.js), or null to skip gating
 * @returns {Object[]}
 */
function filterTriggeredCampaigns(campaigns, activeWorkflowIds) {
  return campaigns.filter(c => {
    const state = c.campaignState || '';
    if (state !== 'Running') return false;

    const type = c.type || '';
    if (type !== 'Triggered') return false;

    if (!c.workflowId) return false;

    if (activeWorkflowIds && !activeWorkflowIds.has(c.workflowId)) return false;

    return true;
  });
}

/**
 * Paginate GET /api/campaigns and collect all campaigns.
 *
 * @param {string} apiKey
 * @param {string} baseUrl
 * @returns {Promise<Object[]>}
 */
async function fetchAllCampaigns(apiKey, baseUrl) {
  const allCampaigns = [];
  let page = 1;
  let totalExpected = null;

  while (true) {
    console.error(`[PROGRESS] Fetching campaigns page ${page}${totalExpected ? ' (of ~' + Math.ceil(totalExpected / CAMPAIGNS_PER_PAGE) + ')' : ''}...`);
    const response = await iterableFetch(
      '/api/campaigns',
      { page, pageSize: CAMPAIGNS_PER_PAGE },
      apiKey,
      baseUrl
    );

    const data = await response.json();
    const campaigns = data.campaigns || [];

    // Capture total count if API provides it
    if (totalExpected === null) {
      if (data.totalCampaignsCount !== undefined) totalExpected = data.totalCampaignsCount;
      else if (data.totalCount !== undefined) totalExpected = data.totalCount;
      if (totalExpected) console.error(`[INFO] API reports ${totalExpected} total campaigns`);
    }

    allCampaigns.push(...campaigns);

    // Stop conditions:
    if (campaigns.length === 0) break;
    if (totalExpected !== null && allCampaigns.length >= totalExpected) break;
    if (data.nextPageUrl === undefined && totalExpected === null && campaigns.length < CAMPAIGNS_PER_PAGE) break;

    page++;
  }

  if (totalExpected !== null && allCampaigns.length < totalExpected) {
    console.error(`[WARN] Expected ${totalExpected} campaigns but only fetched ${allCampaigns.length}`);
  }

  return allCampaigns;
}

/**
 * Build the CSV row object for a campaign, converting epoch ms to ISO dates.
 *
 * @param {Object} campaign
 * @param {string} category - 'blast' or 'triggered'
 * @returns {Object}
 */
function buildCsvRow(campaign, category) {
  return {
    id: campaign.id,
    name: campaign.name,
    campaignState: campaign.campaignState,
    type: campaign.type,
    campaignCategory: category,
    medium: campaign.medium,
    sendSize: campaign.sendSize,
    startAt: campaign.startAt ? formatDateISO(epochMsToDate(campaign.startAt) || new Date(campaign.startAt)) : '',
    createdAt: campaign.createdAt ? formatDateISO(epochMsToDate(campaign.createdAt) || new Date(campaign.createdAt)) : '',
    updatedAt: campaign.updatedAt ? formatDateISO(epochMsToDate(campaign.updatedAt) || new Date(campaign.updatedAt)) : '',
    templateId: campaign.templateId != null ? campaign.templateId : '',
    workflowId: campaign.workflowId != null ? campaign.workflowId : '',
    listIds: campaign.listIds ? JSON.stringify(campaign.listIds) : '[]'
  };
}

const CSV_HEADERS = [
  'id', 'name', 'campaignState', 'type', 'campaignCategory', 'medium', 'sendSize',
  'startAt', 'createdAt', 'updatedAt', 'templateId', 'workflowId', 'listIds'
];

/**
 * Fetch all campaigns, filter, and write to CSV. Returns result metadata.
 *
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {string} options.baseUrl
 * @param {string} options.outputDir - Directory to write output files
 * @param {string} [options.clientName] - Optional client name for logging
 * @param {Date|string} [options.startDate] - Reporting start (defaults to 90 days ago)
 * @param {Date|string} [options.endDate] - Reporting end (defaults to now)
 * @param {string} [options.activeWorkflowsFile] - Path to .active_workflow_ids.json
 * @returns {Promise<{ outputPath: string, campaignCount: number, blastCount: number, triggeredCount: number, blastIdsPath: string, triggeredIdsPath: string }>}
 */
async function run(options) {
  const { apiKey, baseUrl, outputDir, activeWorkflowsFile } = options;

  const outputPath = path.join(outputDir, 'campaigns_' + formatDateForFilename() + '.csv');
  const blastIdsPath = path.join(outputDir, '.blast_campaign_ids.json');
  const triggeredIdsPath = path.join(outputDir, '.triggered_campaign_ids.json');

  // Parse date range — accept Date objects or date strings
  let endDate = options.endDate ? new Date(options.endDate) : new Date();
  endDate.setHours(23, 59, 59, 999);

  let startDate = options.startDate
    ? new Date(options.startDate)
    : new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
  startDate.setHours(0, 0, 0, 0);

  // Load active workflow IDs for triggered campaign gating (optional)
  let activeWorkflowIds = null;
  if (activeWorkflowsFile) {
    try {
      const raw = fs.readFileSync(activeWorkflowsFile, 'utf8');
      const data = JSON.parse(raw);
      activeWorkflowIds = new Set(data.activeWorkflowIds || []);
      console.error(`[PROGRESS] Loaded ${activeWorkflowIds.size} active workflow IDs for triggered campaign filtering`);
    } catch (err) {
      console.error(`[WARN] Could not read active workflows file: ${err.message}. Triggered campaigns will not be filtered by workflow status.`);
    }
  }

  // Fetch all campaigns via pagination
  const allCampaigns = await fetchAllCampaigns(apiKey, baseUrl);

  // Layer 1: discard non-eligible states at ingest (only Running and Finished proceed)
  const eligibleCampaigns = allCampaigns.filter(c => {
    const state = c.campaignState || '';
    return state === 'Running' || state === 'Finished';
  });
  console.error(`[PROGRESS] ${allCampaigns.length} campaigns retrieved, ${eligibleCampaigns.length} eligible (Running/Finished), applying blast/triggered filters...`);

  // Layer 2: separate blast and triggered campaigns with distinct eligibility criteria
  const blastCampaigns = filterBlastCampaigns(eligibleCampaigns, startDate, endDate);
  const triggeredCampaigns = filterTriggeredCampaigns(eligibleCampaigns, activeWorkflowIds);
  const eligible = [...blastCampaigns, ...triggeredCampaigns];

  console.error(`[PROGRESS] ${allCampaigns.length} total -> ${blastCampaigns.length} blast + ${triggeredCampaigns.length} triggered = ${eligible.length} eligible`);

  // Write campaigns CSV with category annotation
  const rows = [
    ...blastCampaigns.map(c => buildCsvRow(c, 'blast')),
    ...triggeredCampaigns.map(c => buildCsvRow(c, 'triggered'))
  ];
  const rowCount = writeCsv(outputPath, CSV_HEADERS, rows);

  // Blast campaign IDs (with campaign objects for per-window scoping downstream)
  const blastIdsData = {
    campaignIds: blastCampaigns.map(c => c.id),
    campaigns: blastCampaigns.map(c => ({
      id: c.id,
      startAt: c.startAt,
      createdAt: c.createdAt
    })),
    totalCampaigns: blastCampaigns.length,
    type: 'blast',
    filteredAt: new Date().toISOString()
  };
  fs.writeFileSync(blastIdsPath, JSON.stringify(blastIdsData, null, 2), 'utf8');

  // Triggered campaign IDs
  const triggeredIdsData = {
    campaignIds: triggeredCampaigns.map(c => c.id),
    totalCampaigns: triggeredCampaigns.length,
    type: 'triggered',
    filteredAt: new Date().toISOString()
  };
  fs.writeFileSync(triggeredIdsPath, JSON.stringify(triggeredIdsData, null, 2), 'utf8');

  // Legacy-compat combined file (fetch-metrics.js can still read .campaign_ids.json during transition)
  const allIds = eligible.map(c => c.id);
  const combinedData = {
    campaignIds: allIds,
    blastCount: blastCampaigns.length,
    triggeredCount: triggeredCampaigns.length,
    totalCampaigns: allIds.length,
    filteredAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(outputDir, '.campaign_ids.json'), JSON.stringify(combinedData, null, 2), 'utf8');

  console.error(`[COMPLETE] ${rowCount} campaigns written (${blastCampaigns.length} blast, ${triggeredCampaigns.length} triggered) to ${outputPath}`);

  return {
    outputPath,
    campaignCount: rowCount,
    blastCount: blastCampaigns.length,
    triggeredCount: triggeredCampaigns.length,
    blastIdsPath,
    triggeredIdsPath
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
    console.error(`[ERROR] ${err.message}`);
    console.error('Usage: node fetch-campaigns.js --api-key KEY --base-url URL --output-dir DIR [--start-date DATE] [--end-date DATE] [--active-workflows-file PATH]');
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
    console.error('[ERROR] Missing required argument: --output-dir or --output');
    process.exit(2);
  }

  try {
    await run({
      apiKey,
      baseUrl,
      outputDir,
      startDate: args['start-date'],
      endDate: args['end-date'],
      activeWorkflowsFile: args['active-workflows-file']
    });
  } catch (err) {
    console.error(`[FATAL] ${err.message}`);
    process.exit(2);
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[FATAL] ${err.message}`);
    process.exit(2);
  });
}

module.exports = { run, filterBlastCampaigns, filterTriggeredCampaigns };
