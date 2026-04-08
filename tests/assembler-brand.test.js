'use strict';

/**
 * assembler-brand.test.js — Brand compliance tests for assembler.js HTML output
 *
 * Verifies that the assembler generates HTML conforming to Modular brand system:
 *   BRND-06: Sharp corners (no 8px border-radius)
 *   BRND-08: Asymmetric layout grid patterns in HTML
 *   DASH-03: Correct tab names (Overview, Engagement, Campaign Detail, Journey Analysis, Scoring)
 *   DASH-05: Health scoring cards with left accent borders
 *   DASH-07: Sortable tables with sortTable function
 *
 * Uses bun test runner.
 *
 * Note: assembler.js was rewritten to use Tailwind CSS utility classes.
 * Tests verify brand intent via colors, structure, and class patterns —
 * not implementation-specific CSS class names from the old hand-written CSS approach.
 */

const { test, expect, describe, beforeAll } = require('bun:test');
const path = require('node:path');
const fs   = require('node:fs');
const os   = require('node:os');

const assembler = require('../lib/assembler');

// ---------------------------------------------------------------------------
// Mock data — minimal shape matching processor.js output
// ---------------------------------------------------------------------------

const MOCK_CSS_TOKENS = `
  --color-bg: #FFFFFF;
  --color-surface: #F5F7FA;
  --color-surface-2: #EBF0F5;
  --color-border: #19364D;
  --color-text: #19364D;
  --color-text-muted: #5A7A8A;
  --color-accent: #48A9A6;
  --color-navy: #19364D;
  --color-teal: #48A9A6;
  --color-teal-dark: #3D8F8D;
  --color-gold: #E1BC29;
  --color-crimson: #BD4F6C;
  --color-healthy: #48A9A6;
  --color-warning: #E1BC29;
  --color-critical: #BD4F6C;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  --space-3xl: 64px;
  --text-label: 14px;
  --text-body: 16px;
  --text-heading: 20px;
  --text-display: 28px;
  --font-stack: 'Inter', system-ui, sans-serif;
`;

const MOCK_CHARTS = {
  cssTokens: MOCK_CSS_TOKENS,
  chartConfigs: [
    { id: 'campaignTypeDistribution', title: 'Campaign Type Distribution', options: { chart: { type: 'donut' }, series: [60, 40], labels: ['Blast', 'Triggered'] } },
    { id: 'sendVolume',               title: 'Send Volume',               options: { chart: { type: 'bar'   }, series: [], xaxis: { categories: [] } } },
    { id: 'channelComparison',        title: 'Channel Comparison',        options: { chart: { type: 'donut' }, series: [], labels: [] } },
    { id: 'deliveryRate',             title: 'Delivery Rate',             options: { chart: { type: 'line'  }, series: [], xaxis: { categories: [] } } },
    { id: 'clickRateComparison',      title: 'Click Rate Comparison',     options: { chart: { type: 'line'  }, series: [], xaxis: { categories: [] } } },
    { id: 'revenueRpmTrend',          title: 'Revenue & RPM Trend',       options: { chart: { type: 'line'  }, series: [], xaxis: { categories: [] } } },
    { id: 'radarScoring',             title: 'Radar Scoring',             options: { chart: { type: 'radar' }, series: [], xaxis: { categories: [] } } },
    { id: 'radarMini',                title: 'Radar Mini',                options: { chart: { type: 'radar' }, series: [], xaxis: { categories: [] } } },
    { id: 'journeyStatusBreakdown',   title: 'Journey Status Breakdown',  fallback: true, stat: { count: 5, label: 'enabled' }, options: {} }
  ]
};

const MOCK_DATA = {
  executive: {
    totalSends: 150000,
    avgOpenRate: 22.5,
    avgClickRate: 3.2,
    totalRevenue: 45000,
    sendVolumeTrend: [
      { date: '2025-01-01', blastSends: 10000, triggeredSends: 5000 },
      { date: '2025-03-01', blastSends: 12000, triggeredSends: 6000 }
    ],
    topPerformers: [
      { name: 'Test Campaign', medium: 'email', type: 'blast', metrics: { clickRate: 5.2, revenue: 1200, sends: 10000 } }
    ],
    topPerformersLabel: 'Top Performers by Click Rate'
  },
  engagement: {
    byChannel: {
      email: { sends: 100000, delivered: 98000, deliveryRate: 98.0, openRate: 22.5, openRateFiltered: 20.0, clickRate: 3.2, ctor: 14.2, rpm: 0.45 },
      sms:   { sends: 30000, delivered: 29000, deliveryRate: 96.7, clickRate: 2.1, bounceRate: 1.5 },
      push:  { sends: 20000, delivered: 19500, deliveryRate: 97.5, bounceRate: 0.5 }
    }
  },
  campaigns: [
    {
      name: 'Welcome Email',
      type: 'triggered',
      medium: 'email',
      metrics: { sends: 5000, delivered: 4900, deliveryRate: 98.0, openRate: 45.0, clickRate: 8.5, ctor: 18.9, rpm: 1.20 },
      dataQuality: { flags: [] }
    },
    {
      name: 'Monthly Blast',
      type: 'blast',
      medium: 'email',
      metrics: { sends: 25000, delivered: 24500, deliveryRate: 98.0, openRate: 18.0, clickRate: 2.5, ctor: 13.9, rpm: 0.35 },
      dataQuality: { flags: [] }
    }
  ],
  journeys: [
    {
      name: 'Onboarding Series',
      enabled: true,
      journeyType: 'Automation',
      campaignCount: 3,
      campaigns: [],
      aggregateMetrics: { sends: 15000, deliveryRate: 97.5, clickRate: 6.2, openRate: 38.0 }
    }
  ],
  scoring: {
    overallAverage: 7.2,
    overallTier: 'healthy',
    dimensions: [
      {
        label: 'List Health',
        score: 8,
        tier: 'healthy',
        items: [
          { label: 'Bounce rate < 2%', pass: true,  contribution: 1, explanation: 'Good deliverability' },
          { label: 'Unsubscribe rate < 0.5%', pass: false, contribution: 0, explanation: 'Elevated unsub rate' }
        ]
      },
      {
        label: 'Engagement Quality',
        score: 6,
        tier: 'functional',
        items: [
          { label: 'Open rate > 20%', pass: true, contribution: 1, explanation: 'Meeting benchmark' }
        ]
      }
    ]
  }
};

// ---------------------------------------------------------------------------
// Generate HTML once for all tests
// ---------------------------------------------------------------------------

let generatedHtml = '';
let tmpDir = '';

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-test-'));
  const result = await assembler.run(
    { charts: MOCK_CHARTS, data: MOCK_DATA },
    { clientName: 'test_client', outputDir: tmpDir }
  );
  generatedHtml = fs.readFileSync(result.outputPath, 'utf8');
});

// ---------------------------------------------------------------------------
// BRND-06: Sharp corners — no 8px border-radius
// ---------------------------------------------------------------------------

describe('BRND-06: Sharp corners', () => {
  test('HTML output contains zero instances of border-radius: 8px', () => {
    const matches = (generatedHtml.match(/border-radius:\s*8px/g) || []);
    expect(matches.length).toBe(0);
  });

  test('HTML output contains zero instances of rounded-lg Tailwind class', () => {
    // rounded-lg = 8px radius. rounded-* classes are forbidden per brand brief.
    expect(generatedHtml).not.toContain('rounded-lg');
    expect(generatedHtml).not.toContain('rounded-md');
    expect(generatedHtml).not.toContain('rounded-xl');
  });
});

// ---------------------------------------------------------------------------
// BRND-08: Asymmetric layout grid patterns
// ---------------------------------------------------------------------------

describe('BRND-08: Asymmetric layout grid patterns', () => {
  test('HTML contains 2fr 1fr asymmetric grid pattern (66/33)', () => {
    // Tailwind inline grid: grid-cols-[2fr_1fr]
    expect(generatedHtml).toContain('2fr_1fr');
  });

  test('HTML contains 3fr 1fr asymmetric grid pattern (75/25)', () => {
    // Tailwind inline grid: grid-cols-[3fr_1fr]
    expect(generatedHtml).toContain('3fr_1fr');
  });

  test('HTML contains 1fr 1fr equal grid pattern (50/50)', () => {
    // Tailwind inline grid: grid-cols-[1fr_1fr]
    expect(generatedHtml).toContain('1fr_1fr');
  });
});

// ---------------------------------------------------------------------------
// DASH-03: Correct tab names
// ---------------------------------------------------------------------------

describe('DASH-03: Tab names', () => {
  test('HTML contains tab "Overview"', () => {
    expect(generatedHtml).toContain('data-tab="overview"');
  });

  test('HTML contains tab named "Engagement" (not "Engagement Overview")', () => {
    expect(generatedHtml).toContain('data-tab="engagement"');
  });

  test('HTML does NOT contain "Engagement Overview" as a tab label', () => {
    const hasOldLabel = generatedHtml.includes('>Engagement Overview<');
    expect(hasOldLabel).toBe(false);
  });

  test('HTML contains tab "Campaign Detail"', () => {
    expect(generatedHtml).toContain('data-tab="campaign-detail"');
  });

  test('HTML contains tab "Journey Analysis"', () => {
    expect(generatedHtml).toContain('data-tab="journey-analysis"');
  });

  test('HTML contains tab "Scoring"', () => {
    expect(generatedHtml).toContain('data-tab="scoring"');
  });

  test('HTML contains all 5 tab names as visible text', () => {
    const tabs = ['Overview', 'Engagement', 'Campaign Detail', 'Journey Analysis', 'Scoring'];
    tabs.forEach(tab => {
      expect(generatedHtml).toContain(`>${tab}<`);
    });
  });
});

// ---------------------------------------------------------------------------
// Tab bar CSS: charcoal background, white text, teal active underline
// ---------------------------------------------------------------------------

describe('Tab bar brand styling', () => {
  test('Tab bar background uses charcoal (#2c2c2c)', () => {
    // Tailwind: bg-[#2c2c2c] on the <nav>
    expect(generatedHtml).toContain('bg-[#2c2c2c]');
  });

  test('Tab item text color is white', () => {
    // Tailwind: text-white on tab items
    expect(generatedHtml).toContain('text-white');
  });

  test('Active tab has teal bottom border (#48A9A6)', () => {
    // Custom CSS: .tab-item.active { border-bottom: 2px solid #48A9A6; }
    expect(generatedHtml).toContain('#48A9A6');
  });
});

// ---------------------------------------------------------------------------
// DASH-07: Table headers with navy background
// ---------------------------------------------------------------------------

describe('DASH-07: Table header styling', () => {
  test('Table header uses navy background (#19364D)', () => {
    // Tailwind: bg-[#19364D] on <th> elements
    expect(generatedHtml).toContain('bg-[#19364D]');
  });

  test('HTML contains sortTable function', () => {
    expect(generatedHtml).toContain('function sortTable');
  });
});

// ---------------------------------------------------------------------------
// Badge colors: brand palette (not dark theme)
// ---------------------------------------------------------------------------

describe('Badge colors: brand palette', () => {
  test('Blast badge uses charcoal background (#2c2c2c)', () => {
    // Tailwind inline: bg-[#2c2c2c] on blast badge
    expect(generatedHtml).toContain('bg-[#2c2c2c]');
  });

  test('Triggered badge uses teal background (#48A9A6)', () => {
    // Tailwind inline: bg-[#48A9A6] on triggered badge
    expect(generatedHtml).toContain('bg-[#48A9A6]');
  });

  test('No dark theme badge colors remain (#1e40af)', () => {
    expect(generatedHtml).not.toContain('#1e40af');
  });

  test('No dark theme badge colors remain (#4c1d95)', () => {
    expect(generatedHtml).not.toContain('#4c1d95');
  });

  test('No dark theme status colors remain (#064e3b)', () => {
    expect(generatedHtml).not.toContain('#064e3b');
  });

  test('No dark theme badge text colors remain (#93c5fd)', () => {
    expect(generatedHtml).not.toContain('#93c5fd');
  });

  test('No dark theme badge text colors remain (#c4b5fd)', () => {
    expect(generatedHtml).not.toContain('#c4b5fd');
  });
});

// ---------------------------------------------------------------------------
// DASH-05: Scoring cards with left accent borders
// ---------------------------------------------------------------------------

describe('DASH-05: Scoring card left accent borders', () => {
  test('Scoring card HTML has border-left style attribute', () => {
    // buildScoringCard uses inline style="border-left: 4px solid ..."
    expect(generatedHtml).toContain('border-left: 4px solid');
  });

  test('Scoring card healthy variant uses teal border (#48A9A6)', () => {
    // Mock data has tier: 'healthy' -> borderColor = '#48A9A6'
    expect(generatedHtml).toContain('border-left: 4px solid #48A9A6');
  });

  test('Scoring card functional variant uses gold border (#E1BC29)', () => {
    // Mock data has tier: 'functional' -> borderColor = '#E1BC29'
    expect(generatedHtml).toContain('border-left: 4px solid #E1BC29');
  });

  test('Pass badge uses brand teal background', () => {
    // Tailwind: bg-[#48A9A6]/20 on pass badges
    expect(generatedHtml).toContain('bg-[#48A9A6]/20');
  });

  test('Fail badge uses brand crimson background', () => {
    // Tailwind: bg-[#BD4F6C]/20 on fail badges
    expect(generatedHtml).toContain('bg-[#BD4F6C]/20');
  });

  test('Pass badge does NOT use old dark green', () => {
    expect(generatedHtml).not.toContain('rgba(34,197,94,0.2)');
  });

  test('Fail badge does NOT use old dark red', () => {
    expect(generatedHtml).not.toContain('rgba(239,68,68,0.2)');
  });
});

// ---------------------------------------------------------------------------
// Tailwind CSS inlined
// ---------------------------------------------------------------------------

describe('Tailwind CSS inlined', () => {
  test('Generated HTML contains compiled Tailwind CSS', () => {
    // The compiled CSS is inlined — check for Tailwind reset patterns
    expect(generatedHtml).toContain('box-sizing');
  });

  test('No hand-written .layout-66-33 class in output (now Tailwind grid utilities)', () => {
    // The old CSS-class-based layout approach is replaced by Tailwind inline grids
    expect(generatedHtml).not.toContain('.layout-66-33');
  });

  test('No hand-written .metric-card class in CSS block (now Tailwind utilities)', () => {
    // Old: .metric-card { ... } in <style>. New: Tailwind classes directly on elements.
    expect(generatedHtml).not.toContain('.metric-card {');
  });
});

// ---------------------------------------------------------------------------
// Brand colors used correctly
// ---------------------------------------------------------------------------

describe('Brand color usage', () => {
  test('Charcoal #2c2c2c used as dominant structural color', () => {
    expect(generatedHtml).toContain('#2c2c2c');
  });

  test('Navy #19364D used for KPI table headers and accents', () => {
    expect(generatedHtml).toContain('#19364D');
  });

  test('Teal #48A9A6 used for positive indicators and CTAs', () => {
    expect(generatedHtml).toContain('#48A9A6');
  });

  test('Surface background #F5F7FA used for card backgrounds', () => {
    expect(generatedHtml).toContain('#F5F7FA');
  });

  test('CTA banner uses navy background', () => {
    // The scoring tab CTA banner: bg-[#19364D]
    expect(generatedHtml).toContain('bg-[#19364D]');
  });

  test('CTA button uses teal (#48A9A6)', () => {
    expect(generatedHtml).toContain('bg-[#48A9A6]');
  });
});

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

describe('Footer brand elements', () => {
  test('Footer contains PALM brand text', () => {
    expect(generatedHtml).toContain('PALM (Personified Agent-assisted Lifecycle Marketing)');
  });

  test('Footer contains link to modularmarketing.com', () => {
    expect(generatedHtml).toContain('modularmarketing.com');
  });

  test('Footer contains Modular logo SVG (inline)', () => {
    // Modular logo SVG is inlined — check for viewBox attribute as signature
    expect(generatedHtml).toContain('viewBox="0 0 900 250"');
  });
});
