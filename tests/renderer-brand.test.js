'use strict';

/**
 * renderer-brand.test.js
 * Verifies brand compliance of renderer.js:
 *   - generateCssTokens() returns Modular brand palette (white bg, navy, teal, gold, crimson)
 *   - No dark theme hex values in CSS token output
 *   - BASE_CHART_OPTIONS uses light theme with Inter font and brand axis colors
 *   - Chart builder functions use brand colors (spot-checked via run() output)
 *
 * Requirements: DASH-04, DASH-08, BRND-01, BRND-02, BRND-07, BRND-09
 */

const { describe, it, expect, beforeAll } = require('bun:test');
const renderer = require('../lib/renderer');

// Minimal processorOutput fixture — all fields the 9 chart builders may access
const mockProcessor = {
  kpis: { totalSends: 0, avgOpenRate: 0, avgClickRate: 0, estimatedRevenue: 0, avgUnsubRate: 0 },
  weeklyTrends: [],
  byChannel: {},
  campaigns: [],
  topPerformers: [],
  campaignTypes: { blast: 0, triggered: 0 },
  journeys: [],
  journeyStatus: { active: 0, paused: 0, draft: 0 },
  scoring: { overall: 0, dimensions: [], items: [] },
  dataQuality: { flags: [] },
  // renderer uses processorOutput.executive, processorOutput.engagement, etc.
  executive: {
    sendVolumeTrend: [],
    entityCounts: { blastCampaigns: 0, triggeredCampaigns: 0 }
  },
  engagement: {
    byChannel: { email: {}, sms: {}, push: {} }
  }
};

let result;

beforeAll(async () => {
  result = await renderer.run(mockProcessor);
});

// -------------------------------------------------------------------------
// CSS Token Tests (via cssTokens output)
// -------------------------------------------------------------------------

describe('generateCssTokens() — brand colors', () => {
  it('returns white background (BRND-01)', () => {
    expect(result.cssTokens).toContain('--color-bg: #FFFFFF;');
  });

  it('returns navy brand token (BRND-02)', () => {
    expect(result.cssTokens).toContain('--color-navy: #19364D;');
  });

  it('returns teal brand token', () => {
    expect(result.cssTokens).toContain('--color-teal: #48A9A6;');
  });

  it('returns WCAG-safe teal-dark token (BRND-09)', () => {
    expect(result.cssTokens).toContain('--color-teal-dark: #3D8F8D;');
  });

  it('returns gold brand token', () => {
    expect(result.cssTokens).toContain('--color-gold: #E1BC29;');
  });

  it('returns crimson brand token', () => {
    expect(result.cssTokens).toContain('--color-crimson: #BD4F6C;');
  });

  it('returns navy border token (BRND-07)', () => {
    expect(result.cssTokens).toContain('--color-border: #19364D;');
  });

  it('returns light surface token', () => {
    expect(result.cssTokens).toContain('--color-surface: #F5F7FA;');
  });

  it('returns font-stack with Inter first', () => {
    expect(result.cssTokens).toContain("--font-stack: 'Inter'");
  });
});

describe('generateCssTokens() — no dark theme values', () => {
  const darkHexValues = [
    '#0f172a', '#1e293b', '#334155', '#475569', '#94a3b8', '#f1f5f9'
  ];

  for (const hex of darkHexValues) {
    it(`does NOT contain dark theme color ${hex}`, () => {
      expect(result.cssTokens).not.toContain(hex);
    });
  }
});

// -------------------------------------------------------------------------
// BASE_CHART_OPTIONS Tests (via chart config output)
// -------------------------------------------------------------------------

describe('BASE_CHART_OPTIONS — light theme with brand axis colors', () => {
  let deliveryRateChart;

  beforeAll(() => {
    // deliveryRate uses mergeOptions so it inherits BASE_CHART_OPTIONS
    deliveryRateChart = result.chartConfigs.find(c => c.id === 'deliveryRate');
  });

  it('chart theme mode is light', () => {
    // The theme is a top-level key in the merged options
    expect(deliveryRateChart.options.theme.mode).toBe('light');
  });

  it('chart fontFamily contains Inter', () => {
    expect(deliveryRateChart.options.chart.fontFamily).toContain('Inter');
  });

  it('grid borderColor is navy 20% (#19364D33)', () => {
    expect(deliveryRateChart.options.grid.borderColor).toBe('#19364D33');
  });

  it('xaxis label colors are text-muted (#5A7A8A)', () => {
    expect(deliveryRateChart.options.xaxis.labels.style.colors).toBe('#5A7A8A');
  });

  it('tooltip theme is light', () => {
    expect(deliveryRateChart.options.tooltip.theme).toBe('light');
  });

  it('legend label colors are navy (#19364D)', () => {
    expect(deliveryRateChart.options.legend.labels.colors).toBe('#19364D');
  });
});

// -------------------------------------------------------------------------
// Radar chart standalone config (does not use mergeOptions)
// -------------------------------------------------------------------------

describe('buildRadarScoring — standalone light theme', () => {
  let radarChart;

  beforeAll(() => {
    radarChart = result.chartConfigs.find(c => c.id === 'radarScoring');
  });

  it('theme mode is light', () => {
    expect(radarChart.options.theme.mode).toBe('light');
  });

  it('fill colors use navy (#19364D)', () => {
    expect(radarChart.options.fill.colors).toContain('#19364D');
  });

  it('polygon fill colors use light theme (F5F7FA/FFFFFF)', () => {
    const fills = radarChart.options.plotOptions.radar.polygons.fill.colors;
    expect(fills).toContain('#F5F7FA');
    expect(fills).toContain('#FFFFFF');
  });

  it('data label colors are navy (#19364D)', () => {
    expect(radarChart.options.dataLabels.style.colors).toContain('#19364D');
  });
});

describe('buildRadarMini — standalone light theme', () => {
  let radarMini;

  beforeAll(() => {
    radarMini = result.chartConfigs.find(c => c.id === 'radarMini');
  });

  it('theme mode is light', () => {
    expect(radarMini.options.theme.mode).toBe('light');
  });

  it('polygon fill colors use light theme', () => {
    const fills = radarMini.options.plotOptions.radar.polygons.fill.colors;
    expect(fills).toContain('#F5F7FA');
    expect(fills).toContain('#FFFFFF');
  });
});

// -------------------------------------------------------------------------
// Donut chart total label (Pitfall 4 prevention)
// -------------------------------------------------------------------------

describe('buildCampaignTypeDistribution — donut label color', () => {
  it('donut total label color is navy (#19364D) not white-on-white', () => {
    const donutChart = result.chartConfigs.find(c => c.id === 'campaignTypeDistribution');
    const totalColor = donutChart.options.plotOptions.pie.donut.labels.total.color;
    expect(totalColor).toBe('#19364D');
  });
});

// -------------------------------------------------------------------------
// Channel comparison uses brand colors (not dark theme)
// -------------------------------------------------------------------------

describe('buildChannelComparison — brand palette', () => {
  it('legend label colors are navy (#19364D)', () => {
    const chart = result.chartConfigs.find(c => c.id === 'channelComparison');
    expect(chart.options.legend.labels.colors).toBe('#19364D');
  });
});

// -------------------------------------------------------------------------
// Journey status breakdown legend
// -------------------------------------------------------------------------

describe('buildJourneyStatusBreakdown — brand palette', () => {
  it('returns fallback stat when all journey counts are zero', () => {
    const chart = result.chartConfigs.find(c => c.id === 'journeyStatusBreakdown');
    // With empty journeys array, all counts are 0 -> only 0-count cats -> fallback
    expect(chart.fallback).toBe(true);
  });
});
