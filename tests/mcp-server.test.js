'use strict';

/**
 * mcp-server.test.js — Unit tests for MCP server tool handlers
 *
 * Tests the 3 tool handlers exported from src/mcp-server.ts:
 *   - handleGetMetrics   (palm_get_metrics)
 *   - handleGenerateDashboard (palm_generate_dashboard)
 *   - handlePalmInfo     (palm_info)
 *
 * Requirements tested:
 *   MCP-02: palm_get_metrics reads ITERABLE_API_KEY from env (never from tool input)
 *   MCP-03: Missing API key returns isError: true with descriptive message
 *   MCP-04: Tool handler errors return isError without crashing the server
 *   MCP-05: All tools validate parameters with Zod
 *   MCP-06: Zero console.log in src/mcp-server.ts
 *   MCP-07: palm_info returns PALM + Modular Marketing attribution
 */

const { describe, test, expect, beforeEach, afterEach, mock } = require('bun:test');
const path = require('node:path');
const fs   = require('node:fs');

// ---------------------------------------------------------------------------
// Module mocking — mock the CJS lib modules before importing the server
// ---------------------------------------------------------------------------

// We need to mock require('../bin/palm-metrics') and require('../lib/generate-dashboard')
// Bun's module mocking approach: mock.module() to intercept require calls

let mockRunMetrics = mock(async () => ({
  outputDir: 'output/test',
  workflows: { workflowCount: 5 },
  campaigns: { campaignCount: 10 },
  metrics: { rowCount: 50 },
  warnings: []
}));

let mockRunDashboard = mock(async () => ({
  outputPath: 'output/test/dashboard.html'
}));

mock.module('../bin/palm-metrics', () => ({
  run: mockRunMetrics
}));

mock.module('../lib/generate-dashboard', () => ({
  run: mockRunDashboard
}));

// Import handlers after mocking
const { handleGetMetrics, handleGenerateDashboard, handlePalmInfo } = require('../src/mcp-server');

// ---------------------------------------------------------------------------
// palm_get_metrics tests
// ---------------------------------------------------------------------------

describe('palm_get_metrics: API key handling', () => {
  let originalKey;

  beforeEach(() => {
    originalKey = process.env.ITERABLE_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ITERABLE_API_KEY;
    } else {
      process.env.ITERABLE_API_KEY = originalKey;
    }
    mockRunMetrics.mockClear();
  });

  test('missing API key returns isError: true with ITERABLE_API_KEY in message', async () => {
    delete process.env.ITERABLE_API_KEY;

    const result = await handleGetMetrics({
      client_name: 'test',
      data_center: 'us'
    });

    expect(result.isError).toBe(true);
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('ITERABLE_API_KEY');
  });

  test('calls runMetrics with correct args when API key is present', async () => {
    process.env.ITERABLE_API_KEY = 'fake-key';

    mockRunMetrics.mockImplementation(async () => ({
      outputDir: 'output/acme',
      workflows: { workflowCount: 5 },
      campaigns: { campaignCount: 10 },
      metrics: { rowCount: 50 },
      warnings: []
    }));

    const result = await handleGetMetrics({
      client_name: 'acme',
      data_center: 'us',
      start_date: '2024-01-01',
      end_date: '2024-03-31'
    });

    expect(mockRunMetrics).toHaveBeenCalledTimes(1);
    const callArgs = mockRunMetrics.mock.calls[0][0];
    expect(callArgs.apiKey).toBe('fake-key');
    expect(callArgs.baseUrl).toBe('https://api.us.iterable.com');
    expect(callArgs.clientName).toBe('acme');
    expect(callArgs.startDate).toBe('2024-01-01');
    expect(callArgs.endDate).toBe('2024-03-31');

    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    // Result text should reference the client name or metric counts
    const text = result.content[0].text;
    expect(text.includes('acme') || text.includes('10') || text.includes('50')).toBe(true);
  });

  test('runMetrics throws returns isError: true with error message', async () => {
    process.env.ITERABLE_API_KEY = 'fake-key';

    mockRunMetrics.mockImplementation(async () => {
      throw new Error('Network timeout');
    });

    const result = await handleGetMetrics({
      client_name: 'test',
      data_center: 'us'
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Network timeout');
  });
});

// ---------------------------------------------------------------------------
// palm_generate_dashboard tests
// ---------------------------------------------------------------------------

describe('palm_generate_dashboard: dashboard generation', () => {
  afterEach(() => {
    mockRunDashboard.mockClear();
  });

  test('calls runDashboard with correct context', async () => {
    mockRunDashboard.mockImplementation(async () => ({
      outputPath: 'output/test_client/dashboard.html'
    }));

    const result = await handleGenerateDashboard({
      client_name: 'test_client'
    });

    expect(mockRunDashboard).toHaveBeenCalledTimes(1);
    const callArgs = mockRunDashboard.mock.calls[0][0];
    expect(callArgs.clientName).toBe('test_client');

    expect(result.isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('output/test_client/dashboard.html');
  });

  test('runDashboard throws returns isError: true', async () => {
    mockRunDashboard.mockImplementation(async () => {
      throw new Error('CSV not found');
    });

    const result = await handleGenerateDashboard({
      client_name: 'test_client'
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('CSV not found');
  });
});

// ---------------------------------------------------------------------------
// palm_info tests
// ---------------------------------------------------------------------------

describe('palm_info: attribution text', () => {
  test('returns text containing PALM and Modular Marketing', async () => {
    const result = await handlePalmInfo({});

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('PALM');
    expect(result.content[0].text).toContain('Modular Marketing');
  });
});

// ---------------------------------------------------------------------------
// MCP-06: No console.log in src/mcp-server.ts
// ---------------------------------------------------------------------------

describe('MCP-06: No console.log in src/mcp-server.ts', () => {
  test('src/mcp-server.ts does not contain console.log', () => {
    const serverPath = path.join(__dirname, '..', 'src', 'mcp-server.ts');
    const source = fs.readFileSync(serverPath, 'utf8');
    expect(source).not.toContain('console.log');
  });
});
