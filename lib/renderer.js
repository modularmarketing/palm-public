'use strict';

/**
 * renderer.js — ApexCharts config generation for PALM Dashboard
 *
 * Stage 3 of the PALM dashboard pipeline.
 * Receives processor.js output and returns:
 *   { chartConfigs: Array<{ id: string, options: Object }>, cssTokens: string }
 *
 * No I/O happens here — only chart config building and CSS token generation.
 *
 * Exports: { run }
 *
 * Requirements addressed: CHART-01, CHART-02, CHART-03, CHART-04,
 *                          DESIGN-02, DESIGN-03, DESIGN-05,
 *                          HEALTH-03 (radar chart configs for scoring)
 */

// ---------------------------------------------------------------------------
// Base chart options — Modular brand palette, light theme (UI-SPEC compliant)
// ---------------------------------------------------------------------------

const BASE_CHART_OPTIONS = {
  theme: { mode: 'light' },
  chart: {
    background: 'transparent',
    toolbar: { show: false },
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    animations: { enabled: false }
  },
  grid: { borderColor: '#2c2c2c22', strokeDashArray: 3 },
  tooltip: { theme: 'light', style: { fontSize: '12px' } },
  xaxis: {
    labels: { style: { fontSize: '12px', colors: '#5A7A8A' } },
    axisBorder: { color: '#2c2c2c' },
    axisTicks: { color: '#2c2c2c' }
  },
  yaxis: {
    labels: { style: { fontSize: '12px', colors: '#5A7A8A' } }
  },
  legend: { labels: { colors: '#2c2c2c' }, fontSize: '12px' }
};

// ---------------------------------------------------------------------------
// Helper: Deep merge for chart options
// Shallow-merges top-level keys; nested-merges chart, xaxis, yaxis, grid, tooltip, legend
// WARNING: If yaxis is an array (mixed-series charts), mergeOptions will corrupt it.
// Must set options.yaxis = [...] AFTER calling mergeOptions() for array yaxis.
// ---------------------------------------------------------------------------

function mergeOptions(base, overrides) {
  const DEEP_KEYS = ['chart', 'xaxis', 'yaxis', 'grid', 'tooltip', 'legend'];
  const result = Object.assign({}, base);

  for (const [key, value] of Object.entries(overrides)) {
    if (DEEP_KEYS.includes(key) && result[key] && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = Object.assign({}, result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper: Axis count formatter (K/M suffix) — used in send volume secondary axis
// ---------------------------------------------------------------------------

function fmtAxisCount(val) {
  if (val == null || isNaN(val)) return '';
  const n = Number(val);
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(0) + 'K';
  return String(Math.round(n));
}

// ---------------------------------------------------------------------------
// Helper: Abbreviated number formatter — used in bar data labels and donut totals
// Always shows one decimal place (e.g. 16.9M, 40.7K) for compact display.
// ---------------------------------------------------------------------------

function abbreviateNumber(val) {
  if (val == null || isNaN(val)) return '';
  const n = Number(val);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

// ---------------------------------------------------------------------------
// CSS token generation — Modular brand palette (UI-SPEC compliant)
// ---------------------------------------------------------------------------

function generateCssTokens() {
  return [
    /* Spacing (unchanged) */
    '--space-xs: 4px;',
    '--space-sm: 8px;',
    '--space-md: 16px;',
    '--space-lg: 24px;',
    '--space-xl: 32px;',
    '--space-2xl: 48px;',
    '--space-3xl: 64px;',
    /* Typography — scaled for data dashboard (not marketing hero) */
    '--text-display: 24px;',
    '--text-heading: 16px;',
    '--text-body: 14px;',
    '--text-label: 12px;',
    /* Colors — Modular brand palette (BRND-01, BRND-02) */
    '--color-bg: #FFFFFF;',
    '--color-surface: #FFFFFF;',
    '--color-surface-2: #F5F7FA;',
    '--color-border: #e5e7eb;',
    '--color-text: #2c2c2c;',
    '--color-text-muted: #6b7280;',
    '--color-accent: #48A9A6;',
    '--color-healthy: #48A9A6;',
    '--color-warning: #E1BC29;',
    '--color-critical: #BD4F6C;',
    /* NEW brand tokens (BRND-02, BRND-09) */
    '--color-navy: #2c2c2c;',
    '--color-teal: #48A9A6;',
    '--color-teal-dark: #3D8F8D;',
    '--color-gold: #E1BC29;',
    '--color-crimson: #BD4F6C;',
    /* Chart-specific tokens */
    '--color-chart-sms: #3D8F8D;',
    '--color-chart-push: #2c2c2c99;',
    '--color-threshold: #5A7A8A;',
    /* Font stack — Inter first (BRND-03) */
    "--font-stack: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif;"
  ].join('\n  ');
}

// ---------------------------------------------------------------------------
// Chart builders
// ---------------------------------------------------------------------------

/**
 * sendVolume — Mixed bar+line chart: blast/triggered bars + bounce/unsub/click rate lines
 * Uses secondary Y-axis for rates. Chart type is 'bar' as root type for mixed series.
 * yaxis is set AFTER mergeOptions() to avoid array corruption.
 * Series order: blast(bar), triggered(bar), click rate(line), bounce rate(line), unsub rate(line)
 * Bar data labels use abbreviateNumber via formatterKey 'fmtAbbrevNumber' (injected by assembler).
 */
function buildSendVolume(processorOutput) {
  const trend = (processorOutput.executive && processorOutput.executive.sendVolumeTrend) || [];
  const dates = trend.map(d => d.date);

  // Blast sends and triggered sends per month bucket
  const blastData     = trend.map(d => (typeof d.blastSends     === 'number' ? d.blastSends     : 0));
  const triggeredData = trend.map(d => (typeof d.triggeredSends === 'number' ? d.triggeredSends : 0));
  const clickData     = trend.map(d => (typeof d.clickRate      === 'number' ? parseFloat(d.clickRate.toFixed(2))  : null));
  const bounceData    = trend.map(d => (typeof d.bounceRate     === 'number' ? parseFloat(d.bounceRate.toFixed(2)) : null));
  const unsubData     = trend.map(d => (typeof d.unsubRate      === 'number' ? parseFloat(d.unsubRate.toFixed(2))  : null));

  const options = mergeOptions(BASE_CHART_OPTIONS, {
    chart: {
      type: 'bar',
      stacked: false,
      height: 350,
      id: 'sendVolumeChart'
    },
    stroke: {
      width: [0, 0, 2, 2, 2],
      curve: 'smooth'
    },
    series: [
      { name: 'Blast sends',     type: 'bar',  data: blastData },
      { name: 'Triggered sends', type: 'bar',  data: triggeredData },
      { name: 'Click rate',      type: 'line', data: clickData },
      { name: 'Bounce rate',     type: 'line', data: bounceData },
      { name: 'Unsub rate',      type: 'line', data: unsubData }
    ],
    colors: ['#2c2c2c', '#48A9A6', '#E1BC29', '#BD4F6C', '#5A7A8A'],
    xaxis: {
      categories: dates,
      title: { text: 'Month', style: { fontSize: '14px', color: '#5A7A8A' } }
    },
    dataLabels: {
      enabled: true,
      enabledOnSeries: [0, 1],
      style: { fontSize: '11px', colors: ['#ffffff', '#ffffff'] },
      background: { enabled: false },
      formatterKey: 'fmtAbbrevNumber'
    }
  });

  // CRITICAL: set yaxis as array AFTER mergeOptions to avoid corruption
  options.yaxis = [
    {
      seriesName: 'Blast sends',
      title: { text: 'Sends', style: { fontSize: '14px', color: '#5A7A8A' } },
      labels: {
        style: { fontSize: '14px', colors: '#5A7A8A' },
        formatterKey: 'fmtAxisCount'
      }
    },
    {
      seriesName: 'Triggered sends',
      show: false
    },
    {
      seriesName: 'Click rate',
      opposite: true,
      title: { text: 'Rate (%)', style: { fontSize: '14px', color: '#5A7A8A' } },
      labels: {
        style: { fontSize: '14px', colors: '#5A7A8A' },
        formatterKey: 'fmtAxisRate2d'
      },
      min: 0,
      max: 5
    },
    {
      seriesName: 'Bounce rate',
      opposite: true,
      show: false,
      min: 0,
      max: 5
    },
    {
      seriesName: 'Unsub rate',
      opposite: true,
      show: false,
      min: 0,
      max: 5
    }
  ];

  return { id: 'sendVolume', options };
}

/**
 * deliveryRate — Line chart with 95% threshold annotation (CHART-01, CHART-04)
 * Threshold shown as annotation only, not in chart title. No title key.
 */
function buildDeliveryRate(processorOutput) {
  const trend = (processorOutput.executive && processorOutput.executive.sendVolumeTrend) || [];
  const dates = trend.map(d => d.date);
  const drPoints = trend.map(d => {
    if (!d.sends || d.sends === 0) return null;
    return parseFloat(((d.delivered / d.sends) * 100).toFixed(2));
  });

  const options = mergeOptions(BASE_CHART_OPTIONS, {
    chart: {
      type: 'line',
      height: 300
    },
    series: [{ name: 'Delivery Rate', data: drPoints }],
    colors: ['#2c2c2c'],
    xaxis: { categories: dates },
    yaxis: {
      min: 80,
      max: 100,
      labels: {
        style: { fontSize: '14px', colors: '#5A7A8A' },
        formatterKey: 'fmtAxisRateInt'
      },
      title: { text: 'Delivery Rate (%)', style: { fontSize: '14px', color: '#5A7A8A' } }
    },
    annotations: {
      yaxis: [{
        y: 95,
        borderColor: '#5A7A8A',
        strokeDashArray: 4,
        label: {
          text: '95% target',
          style: { color: '#5A7A8A', background: '#F5F7FA' }
        }
      }]
    }
  });

  return { id: 'deliveryRate', options };
}

/**
 * clickRateComparison — Line chart: monthly click rate trend
 * No title key. All time-series use monthly buckets.
 */
function buildClickRateComparison(processorOutput) {
  const trend = (processorOutput.executive && processorOutput.executive.sendVolumeTrend) || [];
  const dates = trend.map(d => d.date);
  // clickRate per bucket (weighted, sourced from processor monthly trend)
  const crPoints = trend.map(d => {
    if (typeof d.clickRate === 'number') return parseFloat(d.clickRate.toFixed(2));
    // Fall back to computing from delivered+clicks if available
    if (d.sends && d.sends > 0 && typeof d.uniqueClicks === 'number') {
      return parseFloat(((d.uniqueClicks / d.sends) * 100).toFixed(2));
    }
    return null;
  });

  const options = mergeOptions(BASE_CHART_OPTIONS, {
    chart: {
      type: 'line',
      height: 300
    },
    stroke: { curve: 'smooth', width: 2 },
    series: [{ name: 'Click Rate', data: crPoints }],
    colors: ['#2c2c2c'],
    xaxis: {
      categories: dates,
      title: { text: 'Month', style: { fontSize: '14px', color: '#5A7A8A' } }
    },
    yaxis: {
      labels: {
        style: { fontSize: '14px', colors: '#5A7A8A' },
        formatterKey: 'fmtAxisRate1d'
      },
      title: { text: 'Click Rate (%)', style: { fontSize: '14px', color: '#5A7A8A' } }
    }
  });

  return { id: 'clickRateComparison', options };
}

/**
 * channelComparison — Donut chart: send volume % share by channel
 * No title key. Filters channels with 0 sends.
 * Donut total uses abbreviateNumber via formatterKey 'fmtDonutTotal' (injected by assembler).
 */
function buildChannelComparison(processorOutput) {
  const byChannel = (processorOutput.engagement && processorOutput.engagement.byChannel) || {};
  const email = byChannel.email || {};
  const sms   = byChannel.sms   || {};
  const push  = byChannel.push  || {};

  const emailSends = typeof email.sends === 'number' ? email.sends : 0;
  const smsSends   = typeof sms.sends   === 'number' ? sms.sends   : 0;
  const pushSends  = typeof push.sends  === 'number' ? push.sends  : 0;

  // Build series and labels filtering out 0-send channels (no empty slices)
  // Email = charcoal (#2c2c2c), SMS = teal-dark (#3D8F8D), Push = charcoal 60% (#2c2c2c99)
  const allChannels = [
    { label: 'Email', sends: emailSends, color: '#2c2c2c' },
    { label: 'SMS',   sends: smsSends,   color: '#3D8F8D' },
    { label: 'Push',  sends: pushSends,  color: '#2c2c2c99' }
  ].filter(ch => ch.sends > 0);

  const series = allChannels.map(ch => ch.sends);
  const labels = allChannels.map(ch => ch.label);
  const colors = allChannels.map(ch => ch.color);

  const options = mergeOptions(BASE_CHART_OPTIONS, {
    chart: {
      type: 'donut',
      height: 300
    },
    series,
    labels,
    colors,
    legend: {
      position: 'bottom',
      labels: { colors: '#2c2c2c' },
      fontSize: '14px'
    },
    dataLabels: {
      enabled: true,
      style: { fontSize: '14px', fontWeight: '400' },
      formatterKey: 'fmtPiePercent'
    },
    tooltip: {
      theme: 'light',
      style: { fontSize: '13px', color: '#2c2c2c' },
      fillSeriesColor: false,
      custom: undefined,
      y: { formatterKey: 'fmtAbbrevNumber' }
    },
    plotOptions: {
      pie: {
        donut: {
          labels: {
            show: true,
            value: {
              show: true,
              color: '#2c2c2c',
              formatterKey: 'fmtAbbrevNumber'
            },
            total: {
              show: true,
              label: 'Total',
              color: '#2c2c2c',
              formatterKey: 'fmtDonutTotal'
            }
          }
        }
      }
    }
  });

  return { id: 'channelComparison', options };
}

/**
 * revenueRpmTrend — Dual-axis line: revenue (left) + RPM (right) monthly (CHART-01, CHART-02)
 * No title key. yaxis array set AFTER mergeOptions.
 */
function buildRevenueRpmTrend(processorOutput) {
  const campaigns = processorOutput.campaigns || [];
  const byChannel = (processorOutput.engagement && processorOutput.engagement.byChannel) || {};
  const email     = byChannel.email || {};

  // Group blast campaigns by month using attribution.date if available
  const monthlyBuckets = new Map();

  for (const c of campaigns) {
    if ((c.type || '').toLowerCase() !== 'blast') continue;
    const attrDate = c.attribution && c.attribution.date;
    const revenue  = (c.metrics && typeof c.metrics.revenue === 'number') ? c.metrics.revenue : 0;
    const sends    = (c.metrics && typeof c.metrics.sends === 'number')   ? c.metrics.sends   : 0;

    if (attrDate) {
      // Bucket by YYYY-MM
      const monthKey = attrDate.slice(0, 7);
      if (!monthlyBuckets.has(monthKey)) monthlyBuckets.set(monthKey, { revenue: 0, sends: 0 });
      const bucket = monthlyBuckets.get(monthKey);
      bucket.revenue += revenue;
      bucket.sends   += sends;
    }
  }

  let dates, revenuePoints, rpmPoints;

  if (monthlyBuckets.size > 0) {
    const sortedKeys = Array.from(monthlyBuckets.keys()).sort();
    dates         = sortedKeys;
    revenuePoints = sortedKeys.map(k => parseFloat(monthlyBuckets.get(k).revenue.toFixed(2)));
    rpmPoints     = sortedKeys.map(k => {
      const b = monthlyBuckets.get(k);
      if (!b.sends || b.sends === 0) return null;
      return parseFloat((b.revenue / b.sends * 1000).toFixed(4));
    });
  } else {
    // Fall back to aggregate single-point from engagement.byChannel.email
    dates         = ['Aggregate'];
    revenuePoints = [typeof email.revenue === 'number' ? email.revenue : null];
    rpmPoints     = [typeof email.rpm     === 'number' ? email.rpm     : null];
  }

  const options = mergeOptions(BASE_CHART_OPTIONS, {
    chart: {
      type: 'line',
      height: 350
    },
    series: [
      { name: 'Revenue ($)', data: revenuePoints },
      { name: 'RPM',         data: rpmPoints }
    ],
    colors: ['#48A9A6', '#2c2c2c'],
    xaxis: { categories: dates }
  });

  // yaxis is an array — set AFTER mergeOptions to avoid corruption
  options.yaxis = [
    {
      title: { text: 'Revenue ($)', style: { fontSize: '14px', color: '#5A7A8A' } },
      labels: {
        style: { fontSize: '14px', colors: '#5A7A8A' },
        formatterKey: 'fmtAxisRevenue'
      }
    },
    {
      opposite: true,
      title: { text: 'RPM', style: { fontSize: '14px', color: '#5A7A8A' } },
      labels: {
        style: { fontSize: '14px', colors: '#5A7A8A' },
        formatterKey: 'fmtAxisRpm'
      }
    }
  ];

  return { id: 'revenueRpmTrend', options };
}

/**
 * campaignTypeDistribution — Donut: blast vs triggered SEND VOLUME (not campaign counts)
 * No title key.
 * Uses total send volume per type so the ratio reflects actual email volume, not campaign count.
 * Donut total uses abbreviateNumber via formatterKey 'fmtDonutTotal' (injected by assembler).
 */
function buildCampaignTypeDistribution(processorOutput) {
  // Use send volumes from executive if available; derive from campaigns as fallback
  const counts = (processorOutput.executive && processorOutput.executive.entityCounts) || {};

  let blast, triggered;

  if (typeof counts.blastSendVolume === 'number' && typeof counts.triggeredSendVolume === 'number') {
    // Pre-computed in processor (preferred)
    blast     = counts.blastSendVolume;
    triggered = counts.triggeredSendVolume;
  } else {
    // Derive from campaign list: sum sends per type
    blast     = 0;
    triggered = 0;
    const campaigns = processorOutput.campaigns || [];
    for (const c of campaigns) {
      const sends = (c.metrics && typeof c.metrics.sends === 'number') ? c.metrics.sends : 0;
      const type  = (c.type || '').toLowerCase();
      if (type === 'blast')     blast     += sends;
      if (type === 'triggered') triggered += sends;
    }
  }

  const options = mergeOptions(BASE_CHART_OPTIONS, {
    chart: {
      type: 'donut',
      height: 300
    },
    series: [blast, triggered],
    labels: ['Blast', 'Triggered'],
    colors: ['#2c2c2c', '#48A9A6'],
    dataLabels: {
      enabled: true,
      style: { fontSize: '13px', fontWeight: '400' },
      formatterKey: 'fmtPiePercent'
    },
    tooltip: {
      theme: 'light',
      style: { fontSize: '13px', color: '#2c2c2c' },
      fillSeriesColor: false,
      custom: undefined,
      y: { formatterKey: 'fmtAbbrevNumber' }
    },
    plotOptions: {
      pie: {
        donut: {
          labels: {
            show: true,
            value: {
              show: true,
              color: '#2c2c2c',
              formatterKey: 'fmtAbbrevNumber'
            },
            total: {
              show: true,
              label: 'Total',
              color: '#2c2c2c',
              formatterKey: 'fmtDonutTotal'
            }
          }
        }
      }
    }
  });

  return { id: 'campaignTypeDistribution', options };
}

/**
 * journeyStatusBreakdown — Pie chart: active/paused/draft journey counts
 * No title key. Disabled journeys already filtered in processor.
 * Degenerate guard: if only one non-zero category, returns fallback stat object.
 */
function buildJourneyStatusBreakdown(processorOutput) {
  const journeys = processorOutput.journeys || [];

  // Disabled journeys are pre-filtered in processor; all journeys here are enabled/active.
  // Check for a status field beyond enabled boolean for finer breakdown.
  const active  = journeys.filter(j => j.enabled === true).length;
  const paused  = journeys.filter(j => j.status === 'Draft' || (j.enabled === false && j.status !== 'Draft')).length;
  const draft   = journeys.filter(j => j.status === 'Draft').length;

  const categories = [
    { label: 'Active', count: active,  color: '#48A9A6' },
    { label: 'Paused', count: paused,  color: '#E1BC29' },
    { label: 'Draft',  count: draft,   color: '#5A7A8A' }
  ].filter(cat => cat.count > 0);

  // Degenerate guard: if only one non-zero category, pie is not informative
  if (categories.length <= 1) {
    const statusLabel = categories.length === 1 ? categories[0].label : 'Active';
    const totalCount  = journeys.length;
    return {
      id: 'journeyStatusBreakdown',
      fallback: true,
      stat: { label: statusLabel, count: totalCount }
    };
  }

  const series = categories.map(cat => cat.count);
  const labels = categories.map(cat => cat.label);
  const colors = categories.map(cat => cat.color);

  const options = mergeOptions(BASE_CHART_OPTIONS, {
    chart: {
      type: 'pie',
      height: 250
    },
    series,
    labels,
    colors,
    legend: {
      position: 'bottom',
      labels: { colors: '#2c2c2c' },
      fontSize: '14px'
    },
    dataLabels: {
      enabled: true,
      style: { fontSize: '14px', fontWeight: '400' },
      formatterKey: 'fmtPiePercent'
    }
  });

  return { id: 'journeyStatusBreakdown', options };
}

/**
 * buildRadarScoring — Full-size radar/spider chart for the Scoring tab (HEALTH-03)
 * Reads from processorOutput.scoring. Does NOT use mergeOptions — standalone config.
 * No title key (container headline provided by assembler.js).
 * yaxis: { show: false, min: 0, max: 10 } per UI-SPEC.
 */
function buildRadarScoring(processorOutput) {
  const scoring    = (processorOutput && processorOutput.scoring) || {};
  const dimensions = scoring.dimensions || [];

  // Radar chart is standalone — does not extend BASE_CHART_OPTIONS via mergeOptions
  const options = {
    chart: {
      type: 'radar',
      height: 450,
      background: 'transparent',
      toolbar: { show: false },
      animations: { enabled: false },
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    },
    theme: { mode: 'light' },
    series: [{ name: 'Score', data: dimensions.map(d => d.score) }],
    labels: dimensions.map(d => (d.name || d.label || '').replace(' ', '\n')),
    fill: { opacity: 0.2, colors: ['#2c2c2c'] },
    stroke: { width: 2, colors: ['#2c2c2c'] },
    markers: { size: 4, colors: ['#2c2c2c'] },
    plotOptions: {
      radar: {
        polygons: {
          strokeColors: '#2c2c2c33',
          fill: { colors: ['#F5F7FA', '#FFFFFF'] }
        }
      }
    },
    yaxis: { show: false, min: 0, max: 10 },
    xaxis: {
      labels: { style: { fontSize: '14px', colors: '#5A7A8A' } }
    },
    tooltip: {
      theme: 'light',
      y: { formatterKey: 'fmtScoreTooltip10' }
    },
    dataLabels: {
      enabled: true,
      background: { enabled: false },
      style: { fontSize: '14px', colors: ['#2c2c2c'] }
    }
  };

  return { id: 'radarScoring', options };
}

/**
 * buildRadarMini — Mini radar/spider chart for the Overview score teaser card (HEALTH-03)
 * Same config as radarScoring but smaller: height 120, no axis labels, no data labels, no tooltip.
 * No title key.
 */
function buildRadarMini(processorOutput) {
  const scoring    = (processorOutput && processorOutput.scoring) || {};
  const dimensions = scoring.dimensions || [];

  const options = {
    chart: {
      type: 'radar',
      height: 200,
      background: 'transparent',
      toolbar: { show: false },
      animations: { enabled: false },
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    },
    theme: { mode: 'light' },
    series: [{ name: 'Score', data: dimensions.map(d => d.score) }],
    labels: dimensions.map(d => d.name || d.label || ''),
    fill: { opacity: 0.2, colors: ['#2c2c2c'] },
    stroke: { width: 2, colors: ['#2c2c2c'] },
    markers: { size: 2, colors: ['#2c2c2c'] },
    plotOptions: {
      radar: {
        polygons: {
          strokeColors: '#2c2c2c33',
          fill: { colors: ['#F5F7FA', '#FFFFFF'] }
        }
      }
    },
    yaxis: { show: false, min: 0, max: 10 },
    xaxis: {
      labels: { show: false }
    },
    tooltip: { enabled: false },
    dataLabels: { enabled: false }
  };

  return { id: 'radarMini', options };
}

/**
 * engSendVolume — Bar chart for engagement tab: blast/triggered send volume by month
 * Simpler version of sendVolume (no rate lines), used with toggleEngSendVolume() toggle.
 * Uses abbreviateNumber via formatterKey 'fmtAbbrevNumber' for bar data labels.
 */
function buildEngSendVolume(processorOutput) {
  const trend = (processorOutput.executive && processorOutput.executive.sendVolumeTrend) || [];
  const dates = trend.map(d => d.date);
  const blastData     = trend.map(d => (typeof d.blastSends     === 'number' ? d.blastSends     : 0));
  const triggeredData = trend.map(d => (typeof d.triggeredSends === 'number' ? d.triggeredSends : 0));

  const options = mergeOptions(BASE_CHART_OPTIONS, {
    chart: {
      type: 'bar',
      stacked: true,
      height: 300,
      id: 'engSendVolumeChart'
    },
    series: [
      { name: 'Blast sends',     data: blastData },
      { name: 'Triggered sends', data: triggeredData }
    ],
    colors: ['#2c2c2c', '#48A9A6'],
    xaxis: {
      categories: dates,
      title: { text: 'Month', style: { fontSize: '14px', color: '#5A7A8A' } }
    },
    yaxis: {
      title: { text: 'Sends', style: { fontSize: '14px', color: '#5A7A8A' } },
      labels: {
        style: { fontSize: '12px', colors: '#5A7A8A' },
        formatterKey: 'fmtAxisCount'
      }
    },
    dataLabels: {
      enabled: true,
      style: { fontSize: '11px', colors: ['#ffffff'] },
      background: { enabled: false },
      formatterKey: 'fmtAbbrevNumber'
    },
    legend: {
      position: 'top',
      labels: { colors: '#2c2c2c' },
      fontSize: '12px'
    }
  });

  return { id: 'engSendVolume', options };
}

// ---------------------------------------------------------------------------
// Journey combined chart builder
// ---------------------------------------------------------------------------

/**
 * Build a single combined mixed chart config for a journey.
 * Uses bars for send volume (left Y-axis) and lines for click/unsub rate (right Y-axis).
 * Matches the overview Send Volume Trend pattern: chart.type='line', series with type overrides.
 * yaxis is set AFTER mergeOptions() to avoid array corruption.
 *
 * Series order: Send Volume (bar), Click Rate (line), Unsub Rate (line)
 * Colors: charcoal bars (#2c2c2c), teal click rate (#48A9A6), crimson unsub (#BD4F6C)
 *
 * @param {Object} journey - Journey object with id and timeSeries array
 * @returns {{ id: string, options: Object } | null} Single chart config, or null if no data
 */
function buildJourneyCombinedChart(journey) {
  const ts = (journey.timeSeries || []).filter(b => b.sends > 0 || b.clickRate !== null);
  if (ts.length === 0) return null;

  const chartSuffix = 'j' + String(journey.id).replace(/[^a-zA-Z0-9]/g, '');
  const dates = ts.map(b => b.date);

  const sendData  = ts.map(b => b.sends || 0);
  const clickData = ts.map(b => b.clickRate !== null ? b.clickRate : null);
  const unsubData = ts.map(b => b.unsubRate !== null ? b.unsubRate : null);

  const hasSends = sendData.some(v => v > 0);
  const hasRates = clickData.some(v => v !== null && v > 0) || unsubData.some(v => v !== null && v > 0);

  if (!hasSends && !hasRates) return null;

  const options = mergeOptions(BASE_CHART_OPTIONS, {
    chart: {
      type: 'line',
      height: 160,
      id: 'journey-combined-' + chartSuffix
    },
    stroke: {
      width: [0, 2, 2],
      curve: 'smooth'
    },
    series: [
      { name: 'Send Volume', type: 'bar',  data: sendData },
      { name: 'Click Rate',  type: 'line', data: clickData },
      { name: 'Unsub Rate',  type: 'line', data: unsubData }
    ],
    colors: ['#2c2c2c', '#48A9A6', '#BD4F6C'],
    xaxis: {
      categories: dates,
      labels: { style: { fontSize: '11px', colors: '#5A7A8A' } }
    },
    dataLabels: { enabled: false },
    tooltip: {
      theme: 'light',
      style: { fontSize: '11px' },
      shared: true
    },
    legend: {
      show: true,
      fontSize: '11px'
    }
  });

  // CRITICAL: set yaxis as array AFTER mergeOptions to avoid corruption
  options.yaxis = [
    {
      seriesName: 'Send Volume',
      title: { text: 'Sends', style: { fontSize: '11px', color: '#5A7A8A' } },
      labels: {
        style: { fontSize: '11px', colors: '#5A7A8A' },
        formatterKey: 'fmtAxisCount'
      }
    },
    {
      seriesName: 'Click Rate',
      opposite: true,
      title: { text: 'Rate (%)', style: { fontSize: '11px', color: '#5A7A8A' } },
      labels: {
        style: { fontSize: '11px', colors: '#5A7A8A' },
        formatterKey: 'fmtAxisRate2d'
      },
      min: 0
    },
    {
      seriesName: 'Unsub Rate',
      opposite: true,
      show: false
    }
  ];

  return { id: 'journeyCombined-' + chartSuffix, options };
}

// ---------------------------------------------------------------------------
// Main run() function
// ---------------------------------------------------------------------------

/**
 * @param {Object} processorOutput - Output from processor.run()
 * @returns {{ chartConfigs: Array<{ id: string, options: Object }>, cssTokens: string }}
 */
function run(processorOutput) {
  const cssTokens = generateCssTokens();

  const chartConfigs = [
    buildSendVolume(processorOutput),
    buildDeliveryRate(processorOutput),
    buildClickRateComparison(processorOutput),
    buildChannelComparison(processorOutput),
    buildRevenueRpmTrend(processorOutput),
    buildCampaignTypeDistribution(processorOutput),
    buildJourneyStatusBreakdown(processorOutput),
    buildRadarScoring(processorOutput),
    buildRadarMini(processorOutput),
    buildEngSendVolume(processorOutput)
  ];

  // Per-journey sparklines — top 5 journeys shown in assembler (matching assembler sort/filter)
  // Assembler shows enabled journeys with sends > 0, sorted by total sends descending, top 5.
  // CRITICAL: this sort order MUST match assembler.js buildJourneyCards() exactly.
  // The chart div IDs are generated by assembler from this same journey list.
  // If sort orders differ, chart configs will have IDs that don't match any div in the HTML.
  const journeys = processorOutput.journeys || [];
  const topJourneys = journeys
    .filter(j => j.enabled !== false)
    .filter(j => {
      const agg = j.aggregateMetrics || {};
      const aggSends = typeof agg.sends === 'number' ? agg.sends : 0;
      const tsSends = (j.timeSeries || []).reduce((sum, b) => sum + (b.sends || 0), 0);
      return aggSends > 0 || tsSends > 0;
    })
    .sort((a, b) => {
      function eSends(j) {
        const agg = j.aggregateMetrics || {};
        if (typeof agg.sends === 'number' && agg.sends > 0) return agg.sends;
        return (j.timeSeries || []).reduce((sum, bkt) => sum + (bkt.sends || 0), 0);
      }
      return eSends(b) - eSends(a);
    })
    .slice(0, 5);

  for (const journey of topJourneys) {
    const combined = buildJourneyCombinedChart(journey);
    if (combined) chartConfigs.push(combined);
  }

  console.error('[renderer] generated', chartConfigs.length, 'chart configs');

  return { chartConfigs, cssTokens };
}

module.exports = { run };
