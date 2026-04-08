'use strict';

/**
 * generate-dashboard.js — Pipeline orchestrator
 *
 * Calls reader -> processor -> renderer -> assembler in sequence.
 *
 * Usage:
 *   node lib/generate-dashboard.js \
 *     --client-name acme_corp \
 *     --output-dir output/acme_corp
 *
 * Exit codes:
 *   0 = success
 *   2 = fatal error
 */

const path = require('node:path');
const reader    = require('./reader');
const processor = require('./processor');
const renderer  = require('./renderer');
const assembler = require('./assembler');

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--client-name' && args[i + 1]) parsed.clientName = args[++i];
    if (args[i] === '--output-dir' && args[i + 1]) parsed.outputDir = args[++i];
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ctx = {
    clientName: args.clientName || 'stub',
    outputDir: args.outputDir || 'output/stub'
  };

  console.error('[generate-dashboard] starting pipeline');
  console.error('[generate-dashboard] client:', ctx.clientName, '| output:', ctx.outputDir);

  const rawData = await reader.run(ctx);
  const metrics = await processor.run(rawData);
  const charts  = await renderer.run(metrics);
  console.error('[generate-dashboard] renderer produced', charts.chartConfigs.length, 'chart configs');
  const result  = await assembler.run({ charts, data: metrics }, ctx);

  console.error('[generate-dashboard] pipeline complete');
  process.exit(0);
}

/**
 * Programmatic entry point for MCP tool consumption.
 * @param {{ clientName: string, outputDir?: string }} context
 * @returns {Promise<{ outputPath: string }>}
 */
async function run(context) {
  const ctx = {
    clientName: context.clientName,
    outputDir: context.outputDir || ('output/' + context.clientName)
  };
  const rawData = await reader.run(ctx);
  const metrics = await processor.run(rawData);
  const charts  = await renderer.run(metrics);
  const result  = await assembler.run({ charts, data: metrics }, ctx);
  return result; // { outputPath: string }
}

module.exports = { run };

if (require.main === module) {
  main().catch(err => {
    console.error('[FATAL] generate-dashboard:', err.message);
    process.exit(2);
  });
}
