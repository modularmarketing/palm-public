/**
 * src/mcp-server.ts — PALM MCP Server
 *
 * Registers 3 tools via McpServer + StdioServerTransport:
 *   palm_get_metrics      — Extract Iterable campaign metrics to CSV files
 *   palm_generate_dashboard — Generate a branded HTML dashboard from CSV data
 *   palm_info             — Return PALM tool description and Modular Marketing attribution
 *
 * Security:
 *   - ITERABLE_API_KEY is read from process.env ONLY — never from tool input parameters
 *   - No process.exit() inside tool handlers — errors return { isError: true, content: [...] }
 *   - Stdout is the MCP protocol wire — use console.error() or process.stderr.write() for logging
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// CJS lib imports — Bun handles CJS/ESM interop seamlessly
const { run: runMetrics } = require('../bin/palm-metrics') as { run: Function };
const { run: runDashboard } = require('../lib/generate-dashboard') as { run: Function };

// ---------------------------------------------------------------------------
// Server instance
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'palm-mcp',
  version: '0.1.0'
});

// ---------------------------------------------------------------------------
// Tool handlers — exported as named functions so tests can call them directly
// ---------------------------------------------------------------------------

/**
 * Handle palm_get_metrics tool invocation.
 * Reads ITERABLE_API_KEY from process.env (never from args).
 */
export async function handleGetMetrics(args: {
  client_name: string;
  data_center: string;
  start_date?: string;
  end_date?: string;
}): Promise<{ isError?: true; content: Array<{ type: 'text'; text: string }> }> {
  const apiKey = process.env.ITERABLE_API_KEY;
  if (!apiKey) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: 'ITERABLE_API_KEY is not set. Set it in your MCP server environment config and restart Claude.'
      }]
    };
  }

  try {
    const result = await runMetrics({
      apiKey,
      baseUrl: `https://api.${args.data_center}.iterable.com`,
      clientName: args.client_name,
      startDate: args.start_date,
      endDate: args.end_date
    });

    const summary = {
      outputDir: result.outputDir,
      workflows: result.workflows?.workflowCount ?? 0,
      campaigns: result.campaigns?.campaignCount ?? 0,
      metricRows: result.metrics?.rowCount ?? 0,
      warnings: result.warnings ?? []
    };

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(summary, null, 2)
      }]
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: message }]
    };
  }
}

/**
 * Handle palm_generate_dashboard tool invocation.
 */
export async function handleGenerateDashboard(args: {
  client_name: string;
}): Promise<{ isError?: true; content: Array<{ type: 'text'; text: string }> }> {
  try {
    const result = await runDashboard({ clientName: args.client_name });

    const summary = { outputPath: result.outputPath };

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(summary, null, 2)
      }]
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: message }]
    };
  }
}

/**
 * Handle palm_info tool invocation.
 */
export function handlePalmInfo(_args: Record<string, never>): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [{
      type: 'text' as const,
      text: [
        '# PALM — Personified Agent-assisted Lifecycle Marketing',
        '',
        'PALM is an open-source Iterable metrics and dashboard toolkit by [Modular Marketing](https://modularmarketing.com).',
        '',
        '## Tools',
        '- **palm_get_metrics** — Extract Iterable campaign metrics to CSV',
        '- **palm_generate_dashboard** — Generate a branded HTML dashboard from CSV data',
        '- **palm_info** — Return this description',
        '',
        'Built by Modular Marketing — lifecycle marketing specialists.',
        'Contact us at [modularmarketing.com](https://modularmarketing.com) for a full Lifecycle Health Check.'
      ].join('\n')
    }]
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore TS2589: Zod + McpServer type inference is excessively deep — runtime behavior is correct
server.registerTool('palm_get_metrics', {
  description: 'Fetch Iterable campaign metrics and export to CSV files. Reads ITERABLE_API_KEY from environment.',
  inputSchema: {
    client_name: z.string().min(1).describe('Client or organization name (used for output directory naming)'),
    data_center: z.string().default('us').describe('Iterable data center region (us, eu). Defaults to us.'),
    start_date: z.string().optional().describe('Reporting period start date (YYYY-MM-DD). Defaults to 90 days ago.'),
    end_date: z.string().optional().describe('Reporting period end date (YYYY-MM-DD). Defaults to today.')
  }
}, handleGetMetrics);

server.registerTool('palm_generate_dashboard', {
  description: 'Generate a branded HTML dashboard from previously extracted CSV metrics.',
  inputSchema: {
    client_name: z.string().min(1).describe('Client or organization name (must match the name used with palm_get_metrics)')
  }
}, handleGenerateDashboard);

server.registerTool('palm_info', {
  description: 'Return PALM tool description and Modular Marketing attribution.',
  inputSchema: {}
}, handlePalmInfo);

// ---------------------------------------------------------------------------
// Server startup — only when this file is the main entrypoint, not during tests
// ---------------------------------------------------------------------------

// Check if running as the main process (not imported by tests).
// import.meta is not available in commonjs module mode, so check via process.argv only.
const isMain = (typeof require !== 'undefined' && require.main === module) ||
  (process.argv[1] != null && (
    process.argv[1].endsWith('mcp-server.ts') ||
    process.argv[1].endsWith('mcp-server.js') ||
    process.argv[1].endsWith('palm-mcp-darwin-arm64') ||
    process.argv[1].endsWith('palm-mcp-darwin-x64') ||
    process.argv[1].endsWith('palm-mcp-windows-x64')
  ));

if (isMain) {
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err: Error) => {
    process.stderr.write('[FATAL] MCP server failed to start: ' + err.message + '\n');
    process.exit(1);
  });
}
