'use strict';

/**
 * reader.js — CSV ingestion, schema validation, and medium detection
 *
 * Stage 1 of the PALM dashboard pipeline. Loads campaigns, metrics, and
 * workflows CSVs from output/{client_name}/, validates required columns,
 * detects campaign medium from metrics data, and returns structured arrays
 * that processor.js consumes.
 *
 * No calculations happen here — only I/O, parsing, validation, and medium
 * detection.
 *
 * Exports: { run }
 */

const fs   = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Required columns per CSV type
// ---------------------------------------------------------------------------

const REQUIRED_CAMPAIGNS = [
  'id', 'name', 'campaignState', 'type', 'campaignCategory', 'sendSize', 'workflowId'
];

const REQUIRED_METRICS = [
  'id',
  'Total Email Sends',
  'Total Emails Delivered',
  'Total Emails Bounced',
  'Unique Email Clicks',
  'Unique Email Opens',
  'Revenue'
];

const REQUIRED_WORKFLOWS = [
  'id', 'name', 'enabled', 'isArchived', 'journeyType', 'triggerEventNames'
];

// ---------------------------------------------------------------------------
// CSV File Discovery
// ---------------------------------------------------------------------------

/**
 * Find the latest CSV file whose name starts with prefix inside dir.
 * Relies on ISO date suffixes (YYYY-MM-DD) so lexicographic sort is correct.
 *
 * @param {string} dir    - Directory path to search
 * @param {string} prefix - Filename prefix, e.g. 'campaigns_'
 * @returns {string}      - Full path to the matching file
 * @throws {Error}        - If dir does not exist or no matching file found
 */
function findLatestCsv(dir, prefix) {
  if (!fs.existsSync(dir)) {
    throw new Error('Output directory not found: ' + dir);
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.csv'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No ' + prefix + '*.csv found in ' + dir);
  }

  return path.join(dir, files[0]);
}

// ---------------------------------------------------------------------------
// CSV Parser
// ---------------------------------------------------------------------------

/**
 * Parse CSV text into structured headers + rows.
 * Split-based, zero-dependency parser. Suitable for machine-generated CSVs
 * from the Iterable fetch scripts (known, well-formed input).
 *
 * @param {string} content - Raw CSV text
 * @returns {{ headers: string[], rows: Object[] }}
 */
function parseCsv(content) {
  if (!content || !content.trim()) {
    return { headers: [], rows: [] };
  }

  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Parse a CSV line respecting quoted fields (handles commas inside quotes)
  function splitCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"'; // escaped quote
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = splitCsvLine(lines[0]);
  if (lines.length === 1) {
    return { headers, rows: [] };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] !== undefined ? values[j] : '';
    }
    rows.push(row);
  }

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Schema Validation
// ---------------------------------------------------------------------------

/**
 * Validate that all required columns are present in the CSV headers.
 * Returns structured warnings — never throws for missing columns so that
 * processing continues with whatever data is available.
 *
 * @param {string[]} headers      - Actual CSV column headers
 * @param {string[]} requiredCols - Expected required column names
 * @param {string} csvName        - CSV label for warning messages (e.g. 'campaigns')
 * @returns {Array<{type: string, csv: string, column: string}>}
 */
function validateSchema(headers, requiredCols, csvName) {
  const warnings = [];
  const headerSet = new Set(headers);
  for (const col of requiredCols) {
    if (!headerSet.has(col)) {
      warnings.push({ type: 'missing_column', csv: csvName, column: col });
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Medium Detection
// ---------------------------------------------------------------------------

/**
 * Detect the primary send medium for a campaign.
 *
 * PRIMARY (metrics-based): inspect all metrics rows for this campaign and
 * check for non-zero send counts across channel-specific columns.
 * Priority order: email > push > sms > inapp
 *
 * FALLBACK (name-based): if metrics yield no signal, check for known
 * substrings in the campaign name (case-insensitive).
 *
 * DEFAULT: 'unknown' when neither approach yields a result.
 *
 * @param {Object} campaign    - Campaign row object
 * @param {Object[]} metricRows - All metrics rows for this campaign's ID
 * @returns {string}            - One of: 'email' | 'push' | 'sms' | 'inapp' | 'unknown'
 */
function detectMedium(campaign, metricRows) {
  // PRIMARY: metrics-based detection
  if (metricRows && metricRows.length > 0) {
    let hasEmail = false;
    let hasPush  = false;
    let hasSms   = false;
    let hasInapp = false;

    for (const row of metricRows) {
      if (!hasEmail && parseFloat(row['Total Email Sends']) > 0) hasEmail = true;
      if (!hasPush  && parseFloat(row['Total Pushes Sent']) > 0) hasPush  = true;
      if (!hasSms   && parseFloat(row['Total SMS Sent']) > 0)    hasSms   = true;
      if (!hasInapp && parseFloat(row['Total In-app Sent']) > 0) hasInapp = true;
    }

    if (hasEmail) return 'email';
    if (hasPush)  return 'push';
    if (hasSms)   return 'sms';
    if (hasInapp) return 'inapp';
  }

  // FALLBACK: name-based detection
  const nameLower = (campaign.name || '').toLowerCase();
  if (nameLower.includes('-email-'))  return 'email';
  if (nameLower.includes('-push-'))   return 'push';
  if (nameLower.includes('-sms-'))    return 'sms';
  if (nameLower.includes('-inapp-'))  return 'inapp';

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Main run()
// ---------------------------------------------------------------------------

/**
 * Load and validate all three CSVs for the given client.
 *
 * @param {Object} context
 * @param {string} context.clientName - Client directory name (e.g. 'acme_corp')
 * @param {string} [context.outputDir] - Override output directory path
 * @returns {Promise<{
 *   campaigns: Object[],
 *   metrics: Object[],
 *   workflows: Object[],
 *   warnings: Array<{type: string, csv: string, column: string}>
 * }>}
 */
async function run(context) {
  const dir = context.outputDir || ('output/' + context.clientName);

  // Discover latest CSV files for each type
  const campaignsPath  = findLatestCsv(dir, 'campaigns_');
  const metricsPath    = findLatestCsv(dir, 'metrics_');
  const workflowsPath  = findLatestCsv(dir, 'workflows_');

  // Read and parse
  const { rows: campaigns } = parseCsv(fs.readFileSync(campaignsPath, 'utf8'));
  const { headers: metricsHeaders, rows: metrics } = parseCsv(fs.readFileSync(metricsPath, 'utf8'));
  const { headers: workflowHeaders, rows: workflows } = parseCsv(fs.readFileSync(workflowsPath, 'utf8'));
  const { headers: campaignHeaders } = parseCsv(fs.readFileSync(campaignsPath, 'utf8'));

  // Schema validation (warnings, not errors)
  const warnings = [
    ...validateSchema(campaignHeaders,  REQUIRED_CAMPAIGNS,  'campaigns'),
    ...validateSchema(metricsHeaders,   REQUIRED_METRICS,    'metrics'),
    ...validateSchema(workflowHeaders,  REQUIRED_WORKFLOWS,  'workflows')
  ];

  // Build metrics index: campaign id -> metrics rows[]
  const metricsById = new Map();
  for (const row of metrics) {
    const id = row['id'];
    if (!metricsById.has(id)) metricsById.set(id, []);
    metricsById.get(id).push(row);
  }

  // Detect medium for each campaign
  for (const campaign of campaigns) {
    const campaignMetrics = metricsById.get(campaign.id) || [];
    campaign.medium = detectMedium(campaign, campaignMetrics);
  }

  console.error(
    '[reader] loaded',
    campaigns.length, 'campaigns,',
    metrics.length, 'metrics rows,',
    workflows.length, 'workflows,',
    warnings.length, 'warnings'
  );

  return { campaigns, metrics, workflows, warnings };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { run };
