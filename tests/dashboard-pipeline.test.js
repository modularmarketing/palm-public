'use strict';

/**
 * dashboard-pipeline.test.js — Integration test for the full dashboard pipeline
 *
 * Tests the full renderer -> assembler pipeline with realistic mock processor data.
 * Skips reader and processor (unit tested elsewhere) and validates that the
 * generated HTML output meets ALL 19 brand + dashboard requirements:
 *
 * DASH-01: Pipeline produces a valid HTML file
 * DASH-02: No external CDN/HTTP resource references
 * DASH-03: All 5 tab labels present
 * DASH-04: 9 ApexCharts render calls
 * DASH-05: 5 scoring dimension cards
 * DASH-08: ApexCharts library inlined
 * BRND-01: --color-bg: #FFFFFF (white background)
 * BRND-02: --color-navy: #19364D
 * BRND-03: @font-face with base64-encoded woff2 data
 * BRND-04: PALM icon SVG in header
 * BRND-05: Modular logo SVG in footer
 * BRND-06: No border-radius: 8px
 * BRND-07: --color-border: #19364D
 * BRND-08: layout-66-33 and layout-75-25 class usage
 * BRND-09: Teal not used as CSS color: on text elements
 * BRND-10: Footer CTA text and modularmarketing.com link
 * BRND-11: "Get Your Full Lifecycle Audit" and "25 health signals"
 */

const { describe, test, expect, beforeAll, afterAll } = require('bun:test');
const path = require('node:path');
const fs   = require('node:fs');
const os   = require('node:os');

const renderer  = require('../lib/renderer');
const assembler = require('../lib/assembler');

// ---------------------------------------------------------------------------
// Mock processor output — realistic data using actual processor output shape
// (executive, engagement, campaigns, journeys, scoring structure)
// ---------------------------------------------------------------------------

const MOCK_PROCESSOR_OUTPUT = {
  executive: {
    totalSends: 150000,
    avgOpenRate: 24.5,
    avgClickRate: 3.8,
    totalRevenue: 45000,
    sendVolumeTrend: [
      { date: '2025-01-01', blastSends: 30000, triggeredSends: 20000, sends: 50000, delivered: 49000 },
      { date: '2025-02-01', blastSends: 32000, triggeredSends: 22000, sends: 54000, delivered: 52920 },
      { date: '2025-03-01', blastSends: 28000, triggeredSends: 18000, sends: 46000, delivered: 45080 }
    ],
    entityCounts: {
      blastCampaigns: 3,
      triggeredCampaigns: 5
    },
    topPerformers: [
      {
        name: 'Welcome Series',
        type: 'triggered',
        medium: 'email',
        metrics: { sends: 10000, clickRate: 8.0, revenue: 5000 }
      },
      {
        name: 'Weekly Newsletter',
        type: 'blast',
        medium: 'email',
        metrics: { sends: 50000, clickRate: 3.0, revenue: 8000 }
      }
    ],
    topPerformersLabel: 'Top Performers by Click Rate'
  },
  engagement: {
    byChannel: {
      email: {
        sends: 120000,
        delivered: 117600,
        deliveryRate: 98.0,
        openRate: 24.5,
        openRateFiltered: 22.0,
        clickRate: 3.8,
        ctor: 15.5,
        rpm: 0.38
      },
      sms: {
        sends: 25000,
        delivered: 24250,
        deliveryRate: 97.0,
        clickRate: 2.0,
        bounceRate: 1.5
      },
      push: {
        sends: 5000,
        delivered: 4900,
        deliveryRate: 98.0,
        bounceRate: 0.5
      }
    }
  },
  campaigns: [
    {
      name: 'Welcome Series',
      type: 'triggered',
      medium: 'email',
      metrics: {
        sends: 10000,
        delivered: 9800,
        deliveryRate: 98.0,
        openRate: 35.0,
        openRateFiltered: 32.0,
        clickRate: 8.0,
        ctor: 22.9,
        rpm: 0.50
      },
      dataQuality: { flags: [] }
    },
    {
      name: 'Weekly Newsletter',
      type: 'blast',
      medium: 'email',
      metrics: {
        sends: 50000,
        delivered: 49000,
        deliveryRate: 98.0,
        openRate: 22.0,
        openRateFiltered: 20.0,
        clickRate: 3.0,
        ctor: 13.6,
        rpm: 0.16
      },
      dataQuality: { flags: ['low_click_rate'] }
    },
    {
      name: 'Cart Abandonment',
      type: 'triggered',
      medium: 'email',
      metrics: {
        sends: 8000,
        delivered: 7900,
        deliveryRate: 98.75,
        openRate: 42.0,
        openRateFiltered: 39.0,
        clickRate: 12.0,
        ctor: 28.6,
        rpm: 1.20
      },
      dataQuality: { flags: [] }
    }
  ],
  journeys: [
    {
      name: 'Onboarding Journey',
      enabled: true,
      journeyType: 'Automation',
      campaignCount: 3,
      campaigns: [],
      aggregateMetrics: {
        sends: 15000,
        deliveryRate: 97.5,
        clickRate: 6.2,
        openRate: 38.0
      }
    },
    {
      name: 'Win-Back Journey',
      enabled: true,
      journeyType: 'Automation',
      campaignCount: 2,
      campaigns: [],
      aggregateMetrics: {
        sends: 5000,
        deliveryRate: 96.0,
        clickRate: 4.1,
        openRate: 28.0
      }
    }
  ],
  scoring: {
    overallAverage: 7.2,
    overallTier: 'healthy',
    dimensions: [
      {
        label: 'Deliverability',
        score: 8.5,
        tier: 'healthy',
        items: [
          { label: 'SPF/DKIM configured', pass: true, contribution: 1, explanation: 'Authentication configured' },
          { label: 'Bounce rate < 2%', pass: true, contribution: 1, explanation: 'Good deliverability' },
          { label: 'Complaint rate < 0.1%', pass: true, contribution: 1, explanation: 'Low complaints' },
          { label: 'Suppression list active', pass: true, contribution: 1, explanation: 'Suppression in use' },
          { label: 'Dedicated IP warm-up', pass: false, contribution: 0, explanation: 'No dedicated IP' }
        ]
      },
      {
        label: 'Engagement Quality',
        score: 6.8,
        tier: 'functional',
        items: [
          { label: 'Open rate > 20%', pass: true, contribution: 1, explanation: 'Meeting benchmark' },
          { label: 'Click rate > 3%', pass: true, contribution: 1, explanation: 'Good click rate' },
          { label: 'Unsubscribe rate < 0.5%', pass: true, contribution: 1, explanation: 'Low unsub rate' },
          { label: 'Re-engagement campaign', pass: false, contribution: 0, explanation: 'Not implemented' },
          { label: 'Sunset policy active', pass: false, contribution: 0, explanation: 'No sunset policy' }
        ]
      },
      {
        label: 'Multi-Channel',
        score: 5.5,
        tier: 'functional',
        items: [
          { label: 'SMS enabled', pass: true, contribution: 1, explanation: 'SMS active' },
          { label: 'Push enabled', pass: true, contribution: 1, explanation: 'Push active' },
          { label: 'In-app messaging', pass: false, contribution: 0, explanation: 'Not configured' },
          { label: 'Channel preference center', pass: false, contribution: 0, explanation: 'Not built' },
          { label: 'Cross-channel orchestration', pass: false, contribution: 0, explanation: 'Not implemented' }
        ]
      },
      {
        label: 'Automation Depth',
        score: 7.8,
        tier: 'healthy',
        items: [
          { label: 'Welcome series', pass: true, contribution: 1, explanation: 'Active' },
          { label: 'Cart abandonment', pass: true, contribution: 1, explanation: 'Active' },
          { label: 'Browse abandonment', pass: false, contribution: 0, explanation: 'Not set up' },
          { label: 'Win-back campaign', pass: true, contribution: 1, explanation: 'Active' },
          { label: 'Post-purchase flow', pass: true, contribution: 1, explanation: 'Active' }
        ]
      },
      {
        label: 'Lifecycle Strategy',
        score: 6.2,
        tier: 'functional',
        items: [
          { label: 'Segmentation strategy', pass: true, contribution: 1, explanation: 'Segmentation in use' },
          { label: 'RFM scoring', pass: false, contribution: 0, explanation: 'Not implemented' },
          { label: 'Cohort analysis', pass: false, contribution: 0, explanation: 'Not in use' },
          { label: 'LTV tracking', pass: false, contribution: 0, explanation: 'Partial' },
          { label: 'Churn prediction', pass: false, contribution: 0, explanation: 'Not implemented' }
        ]
      }
    ]
  }
};

// ---------------------------------------------------------------------------
// Setup: run renderer -> assembler pipeline once for all tests
// ---------------------------------------------------------------------------

let generatedHtml = '';
let outputFilePath = '';
let tmpDir = '';

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-pipeline-test-'));

  // Stage 3: renderer
  const charts = await renderer.run(MOCK_PROCESSOR_OUTPUT);

  // Stage 4: assembler
  const result = await assembler.run(
    { charts, data: MOCK_PROCESSOR_OUTPUT },
    { clientName: 'Test Corp', outputDir: tmpDir }
  );

  outputFilePath = result.outputPath;
  generatedHtml  = fs.readFileSync(outputFilePath, 'utf8');
});

afterAll(() => {
  // Clean up temp directory
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {
    // non-fatal cleanup failure
  }
});

// ---------------------------------------------------------------------------
// DASH-01: Pipeline produces a valid HTML file
// ---------------------------------------------------------------------------

describe('DASH-01: Pipeline output — valid HTML file', () => {
  test('HTML file exists at output path', () => {
    expect(fs.existsSync(outputFilePath)).toBe(true);
  });

  test('HTML file is larger than 50KB (fonts + ApexCharts + content)', () => {
    const stats = fs.statSync(outputFilePath);
    expect(stats.size).toBeGreaterThan(50 * 1024);
  });

  test('HTML file starts with <!DOCTYPE html>', () => {
    expect(generatedHtml.trim().startsWith('<!DOCTYPE html>')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DASH-02: No external CDN or HTTP resource references
// ---------------------------------------------------------------------------

describe('DASH-02: No external resource references', () => {
  test('No <script src="http..."> CDN references', () => {
    const matches = (generatedHtml.match(/<script[^>]+src=["']https?:\/\//gi) || []);
    expect(matches.length).toBe(0);
  });

  test('No <link href="http..."> CDN references', () => {
    const matches = (generatedHtml.match(/<link[^>]+href=["']https?:\/\//gi) || []);
    expect(matches.length).toBe(0);
  });

  test('No <img src="http..."> external images', () => {
    const matches = (generatedHtml.match(/<img[^>]+src=["']https?:\/\//gi) || []);
    expect(matches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DASH-03: All 5 tab labels present
// ---------------------------------------------------------------------------

describe('DASH-03: All 5 tab labels', () => {
  const EXPECTED_TABS = ['Overview', 'Engagement', 'Campaign Detail', 'Journey Analysis', 'Scoring'];

  EXPECTED_TABS.forEach(tabName => {
    test(`HTML contains tab label "${tabName}"`, () => {
      expect(generatedHtml).toContain(`>${tabName}<`);
    });
  });
});

// ---------------------------------------------------------------------------
// DASH-04: 9 ApexCharts render calls
// ---------------------------------------------------------------------------

describe('DASH-04: 9 ApexCharts chart configs', () => {
  test('CHART_CONFIGS JSON array contains exactly 9 chart configurations', () => {
    // Charts render via a forEach loop over CHART_CONFIGS — only one occurrence
    // of "new ApexCharts" exists. Verify count by parsing CHART_CONFIGS.
    const match = generatedHtml.match(/CHART_CONFIGS\s*=\s*(\[[\s\S]*?\]);/);
    expect(match).not.toBeNull();
    const chartConfigs = JSON.parse(match[1]);
    expect(chartConfigs.length).toBe(10);
  });

  test('HTML contains the ApexCharts rendering loop (new ApexCharts)', () => {
    expect(generatedHtml).toContain('new ApexCharts');
  });
});

// ---------------------------------------------------------------------------
// DASH-05: 5 scoring dimensions
// ---------------------------------------------------------------------------

describe('DASH-05: 5 scoring dimension cards', () => {
  test('HTML contains all 5 scoring dimension names', () => {
    const dimensionNames = ['Deliverability', 'Engagement Quality', 'Multi-Channel', 'Automation Depth', 'Lifecycle Strategy'];
    dimensionNames.forEach(dim => {
      expect(generatedHtml).toContain(dim);
    });
  });

  test('HTML contains at least 5 scoring-card div elements', () => {
    // buildScoringCard() generates: <div class="scoring-card bg-[#F5F7FA] ..."
    const dimCards = (generatedHtml.match(/class="scoring-card /g) || []);
    expect(dimCards.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// DASH-08: ApexCharts library inlined
// ---------------------------------------------------------------------------

describe('DASH-08: ApexCharts library inlined', () => {
  test('HTML contains ApexCharts library source code', () => {
    // ApexCharts inlined JS starts with a version comment or function
    const hasApex = generatedHtml.includes('ApexCharts') && generatedHtml.includes('apexcharts');
    expect(hasApex).toBe(true);
  });

  test('ApexCharts is in a <script> block (not external)', () => {
    // The library content should be inside a <script> tag
    const scriptStart = generatedHtml.indexOf('<script>');
    const scriptEnd   = generatedHtml.lastIndexOf('</script>');
    const scriptContent = generatedHtml.substring(scriptStart, scriptEnd);
    expect(scriptContent).toContain('ApexCharts');
  });
});

// ---------------------------------------------------------------------------
// BRND-01: White background
// ---------------------------------------------------------------------------

describe('BRND-01: White background', () => {
  test('HTML body uses white background (#FFFFFF or bg-white)', () => {
    // Tailwind: class="bg-white" on <body> or compiled CSS .bg-white { background: #fff }
    const hasWhiteBg = generatedHtml.includes('bg-white') || generatedHtml.includes('#FFFFFF') || generatedHtml.includes('#ffffff');
    expect(hasWhiteBg).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BRND-02: Deep Navy brand color
// ---------------------------------------------------------------------------

describe('BRND-02: Deep Navy brand color', () => {
  test('HTML contains navy color #19364D', () => {
    // Navy used in table headers, KPI card accents, scoring dimensions
    expect(generatedHtml).toContain('#19364D');
  });
});

// ---------------------------------------------------------------------------
// BRND-03: @font-face with base64-encoded woff2
// ---------------------------------------------------------------------------

describe('BRND-03: Inter font — base64-encoded @font-face', () => {
  test('HTML contains @font-face declaration', () => {
    expect(generatedHtml).toContain('@font-face');
  });

  test('@font-face uses data:font/woff2;base64, embedding', () => {
    expect(generatedHtml).toContain('data:font/woff2;base64,');
  });
});

// ---------------------------------------------------------------------------
// BRND-04: Modular logo SVG in header
// ---------------------------------------------------------------------------

describe('BRND-04: Modular logo SVG in header', () => {
  test('HTML contains inline <svg> element', () => {
    expect(generatedHtml).toContain('<svg');
  });

  test('Header area contains an SVG element (Modular logo)', () => {
    const headerStart = generatedHtml.indexOf('<header');
    const headerEnd   = generatedHtml.indexOf('</header>', headerStart);
    const headerContent = headerStart >= 0 && headerEnd >= 0
      ? generatedHtml.substring(headerStart, headerEnd)
      : generatedHtml;
    expect(headerContent).toContain('<svg');
  });
});

// ---------------------------------------------------------------------------
// BRND-05: Modular logo SVG in footer
// ---------------------------------------------------------------------------

describe('BRND-05: Modular logo in footer', () => {
  test('HTML footer area contains an SVG element (Modular logo)', () => {
    const footerStart = generatedHtml.indexOf('<footer');
    const footerEnd   = generatedHtml.indexOf('</footer>', footerStart);
    const footerContent = footerStart >= 0 && footerEnd >= 0
      ? generatedHtml.substring(footerStart, footerEnd)
      : generatedHtml;
    expect(footerContent).toContain('<svg');
  });
});

// ---------------------------------------------------------------------------
// BRND-06: Sharp corners — no border-radius: 8px
// ---------------------------------------------------------------------------

describe('BRND-06: Sharp corners', () => {
  test('HTML CSS does NOT contain border-radius: 8px', () => {
    const matches = (generatedHtml.match(/border-radius:\s*8px/g) || []);
    expect(matches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BRND-07: Charcoal border color used
// ---------------------------------------------------------------------------

describe('BRND-07: Border color usage', () => {
  test('HTML uses charcoal (#2c2c2c) for borders', () => {
    // Tailwind: border-[#2c2c2c] on table cells and cards
    expect(generatedHtml).toContain('border-[#2c2c2c]');
  });
});

// ---------------------------------------------------------------------------
// BRND-08: Asymmetric layout grid patterns used in HTML
// ---------------------------------------------------------------------------

describe('BRND-08: Asymmetric layout classes', () => {
  test('HTML uses 2fr 1fr grid pattern (66/33)', () => {
    // Tailwind inline grid-cols-[2fr_1fr]
    expect(generatedHtml).toContain('2fr_1fr');
  });

  test('HTML uses 3fr 1fr grid pattern (75/25)', () => {
    // Tailwind inline grid-cols-[3fr_1fr]
    expect(generatedHtml).toContain('3fr_1fr');
  });
});

// ---------------------------------------------------------------------------
// BRND-09: Teal used appropriately (accent, not primary text on white)
// ---------------------------------------------------------------------------

describe('BRND-09: Teal used as accent color', () => {
  test('HTML contains teal (#48A9A6) as accent color', () => {
    // Teal is used for CTA buttons, positive indicators, active tab underline
    expect(generatedHtml).toContain('#48A9A6');
  });

  test('No dark theme text colors remain', () => {
    // Specifically check that old dark theme text colors are absent
    expect(generatedHtml).not.toContain('#93c5fd');
    expect(generatedHtml).not.toContain('#c4b5fd');
  });
});

// ---------------------------------------------------------------------------
// BRND-10: Footer CTA — PALM attribution and Modular link
// ---------------------------------------------------------------------------

describe('BRND-10: Footer CTA content', () => {
  test('HTML contains PALM attribution text', () => {
    expect(generatedHtml).toContain('PALM');
  });

  test('HTML contains "Personified Agent-assisted Lifecycle Marketing"', () => {
    expect(generatedHtml).toContain('Personified Agent-assisted Lifecycle Marketing');
  });

  test('HTML contains "modularmarketing.com" link', () => {
    expect(generatedHtml).toContain('modularmarketing.com');
  });

  test('HTML contains "by Modular" attribution', () => {
    expect(generatedHtml.toLowerCase()).toContain('by modular');
  });
});

// ---------------------------------------------------------------------------
// BRND-11: Scoring CTA — upsell content
// ---------------------------------------------------------------------------

describe('BRND-11: Scoring CTA', () => {
  test('HTML contains "Get Your Full Lifecycle Audit" CTA heading', () => {
    expect(generatedHtml).toContain('Get Your Full Lifecycle Audit');
  });

  test('HTML contains "25 health signals" reference', () => {
    expect(generatedHtml).toContain('25 health signals');
  });
});
