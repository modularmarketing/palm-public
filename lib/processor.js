'use strict';

/**
 * processor.js — Data processing engine for PALM dashboard pipeline
 *
 * Stage 2 of the PALM dashboard pipeline. Transforms raw CSV data from
 * reader.js into computed metrics, health scores, and data quality flags
 * for all four dashboard views.
 *
 * No I/O happens here — only calculation, scoring, and flagging.
 *
 * Exports: { run }
 *
 * Requirements addressed: CALC-01 through CALC-05, ATTR-01 through ATTR-03,
 * DQ-01 through DQ-03
 */

// ---------------------------------------------------------------------------
// Helper: Group metrics rows by campaign ID
// ---------------------------------------------------------------------------

/**
 * Build a Map: campaignId -> metricsRow[]
 * Each campaign has 1–13 rows (one per weekly fetch window).
 *
 * @param {Object[]} metrics - All metrics rows from reader.js
 * @returns {Map<string, Object[]>}
 */
function groupMetricsByCampaign(metrics) {
  const map = new Map();
  for (const row of metrics) {
    const id = row['id'];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Helper: Aggregate raw counts across all metric rows for one campaign
// ---------------------------------------------------------------------------

/**
 * Sum raw counts across all metric rows for one campaign.
 * Clamps negative delivered values to 0 (Iterable API anomaly per DQ-02).
 * Tracks zero-send windows and negative delivered occurrences.
 *
 * @param {Object[]} rows   - All metrics rows for one campaign
 * @param {string}   medium - Detected medium ('email'|'push'|'sms'|etc.)
 * @returns {Object}        - Aggregated raw counts
 */
function aggregateRawCounts(rows, medium) {
  const agg = {
    // Email
    emailSends: 0,
    emailDelivered: 0,
    emailBounced: 0,
    emailUniqueClicks: 0,
    emailUniqueOpens: 0,
    emailUniqueOpensFiltered: 0,
    emailComplaints: 0,
    emailUnsubscribes: 0,
    // Push
    pushSends: 0,
    pushDelivered: 0,
    pushBounced: 0,
    pushUniqueOpened: 0,
    // SMS
    smsSends: 0,
    smsDelivered: 0,
    smsBounced: 0,
    smsUniqueClicks: 0,
    // Revenue
    revenue: 0,
    // Quality tracking
    windowCount: rows.length,
    zeroSendWindows: 0,
    negativeDeliveredCount: 0
  };

  for (const row of rows) {
    // Email counts
    const emailSends     = parseFloat(row['Total Email Sends'] || 0)    || 0;
    const rawEmailDel    = parseFloat(row['Total Emails Delivered'] || 0) || 0;
    const emailBounced   = parseFloat(row['Total Emails Bounced'] || 0)  || 0;
    const emailClicks    = parseFloat(row['Unique Email Clicks'] || 0)   || 0;
    const emailOpens     = parseFloat(row['Unique Email Opens'] || 0)    || 0;
    const emailOpensFilt = parseFloat(row['Unique Email Opens (filtered)'] || 0) || 0;

    // Clamp negative delivered (Iterable API anomaly)
    if (rawEmailDel < 0) agg.negativeDeliveredCount++;
    const emailDelivered = Math.max(0, rawEmailDel);

    agg.emailSends              += emailSends;
    agg.emailDelivered          += emailDelivered;
    agg.emailBounced            += emailBounced;
    agg.emailUniqueClicks       += emailClicks;
    agg.emailUniqueOpens        += emailOpens;
    agg.emailUniqueOpensFiltered += emailOpensFilt;
    agg.emailComplaints         += parseFloat(row['Total Complaints'] || 0) || 0;
    agg.emailUnsubscribes       += parseFloat(row['Total Unsubscribes'] || 0) || 0;

    // Push counts
    const pushSends     = parseFloat(row['Total Pushes Sent'] || 0)      || 0;
    const rawPushDel    = parseFloat(row['Total Pushes Delivered'] || 0) || 0;
    const pushBounced   = parseFloat(row['Total Pushes Bounced'] || 0)   || 0;
    const pushOpened    = parseFloat(row['Unique Pushes Opened'] || 0)   || 0;

    const pushDelivered = Math.max(0, rawPushDel);
    if (rawPushDel < 0) agg.negativeDeliveredCount++;

    agg.pushSends       += pushSends;
    agg.pushDelivered   += pushDelivered;
    agg.pushBounced     += pushBounced;
    agg.pushUniqueOpened += pushOpened;

    // SMS counts
    const smsSends     = parseFloat(row['Total SMS Sent'] || 0)       || 0;
    const rawSmsDel    = parseFloat(row['Total SMS Delivered'] || 0)  || 0;
    const smsBounced   = parseFloat(row['Total SMS Bounced'] || 0)    || 0;
    const smsClicks    = parseFloat(row['Unique SMS Clicks'] || 0)    || 0;

    const smsDelivered = Math.max(0, rawSmsDel);
    if (rawSmsDel < 0) agg.negativeDeliveredCount++;

    agg.smsSends       += smsSends;
    agg.smsDelivered   += smsDelivered;
    agg.smsBounced     += smsBounced;
    agg.smsUniqueClicks += smsClicks;

    // Revenue
    agg.revenue += parseFloat(row['Revenue'] || 0) || 0;

    // Zero-send windows: all channel send columns are 0
    if (emailSends === 0 && pushSends === 0 && smsSends === 0) {
      agg.zeroSendWindows++;
    }
  }

  return agg;
}

// ---------------------------------------------------------------------------
// Helper: Compute weighted rates from aggregated raw counts
// ---------------------------------------------------------------------------

/**
 * Compute all derived rates from aggregated raw counts.
 * Always uses sum(numerator) / sum(denominator) — never averages per-row rates (CALC-01).
 * Returns null for any rate where denominator is 0.
 *
 * Denominators per CALC-02:
 *   - deliveryRate, bounceRate: sends
 *   - clickRate, openRate, openRateFiltered, ctor, rpm: delivered
 *
 * Channel suppression per CALC-05:
 *   - email: all metrics
 *   - push: deliveryRate, bounceRate only
 *   - sms: deliveryRate, bounceRate, clickRate only
 *
 * @param {Object} agg    - Output of aggregateRawCounts
 * @param {string} medium - Detected medium
 * @returns {Object}      - All applicable computed rates (percentages)
 */
function computeWeightedRates(agg, medium) {
  const rates = {};

  const safeRate = (numerator, denominator) =>
    denominator > 0 ? (numerator / denominator) * 100 : null;

  if (medium === 'email') {
    // Per CALC-02: delivery & bounce use sends denominator
    rates.deliveryRate        = safeRate(agg.emailDelivered, agg.emailSends);
    rates.bounceRate          = safeRate(agg.emailBounced, agg.emailSends);
    // Per CALC-02: click and open rates use delivered denominator
    rates.clickRate           = safeRate(agg.emailUniqueClicks, agg.emailDelivered);
    rates.openRate            = safeRate(agg.emailUniqueOpens, agg.emailDelivered);
    rates.openRateFiltered    = safeRate(agg.emailUniqueOpensFiltered, agg.emailDelivered);
    // Per CALC-03: CTOR uses filtered opens with fallback to raw opens
    const ctorDenominator = agg.emailUniqueOpensFiltered > 0
      ? agg.emailUniqueOpensFiltered
      : agg.emailUniqueOpens;
    rates.ctor = safeRate(agg.emailUniqueClicks, ctorDenominator);
    // Per CALC-04: RPM = (revenue / delivered) * 1000
    rates.rpm = agg.emailDelivered > 0
      ? (agg.revenue / agg.emailDelivered) * 1000
      : null;

  } else if (medium === 'push') {
    // Per CALC-05: push omits openRate (no MPP equivalent)
    rates.deliveryRate = safeRate(agg.pushDelivered, agg.pushSends);
    rates.bounceRate   = safeRate(agg.pushBounced, agg.pushSends);

  } else if (medium === 'sms') {
    // Per CALC-05: SMS omits openRate and filtered metrics
    rates.deliveryRate = safeRate(agg.smsDelivered, agg.smsSends);
    rates.bounceRate   = safeRate(agg.smsBounced, agg.smsSends);
    rates.clickRate    = safeRate(agg.smsUniqueClicks, agg.smsDelivered);
  }

  return rates;
}

// ---------------------------------------------------------------------------
// Helper: Compute median of a numeric array (ignores nulls)
// ---------------------------------------------------------------------------

/**
 * @param {Array<number|null>} values
 * @returns {number|null}
 */
function computeMedian(values) {
  const nums = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (nums.length === 0) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0
    ? (nums[mid - 1] + nums[mid]) / 2
    : nums[mid];
}

// ---------------------------------------------------------------------------
// Helper: Flag data quality issues
// ---------------------------------------------------------------------------

/**
 * Create data quality flags for a campaign.
 * Checks: rate > 100%, negative delivered, < 100 deliveries, 3x-median outlier.
 *
 * @param {Object} campaign      - Campaign row object
 * @param {Object} agg           - Aggregated raw counts
 * @param {Object} rates         - Computed rates
 * @param {Object} allMedianRates - { metricName: medianValue } across all campaigns
 * @returns {{ flags: Array, isOutlier: boolean, outlierReasons: string[] }}
 */
function flagDataQuality(campaign, agg, rates, allMedianRates) {
  const flags = [];
  let isOutlier = false;
  const outlierReasons = [];

  // Per DQ-01/DQ-02: Rate > 100% = tracking error
  const rateNames = ['deliveryRate', 'bounceRate', 'clickRate', 'openRate', 'openRateFiltered'];
  for (const metric of rateNames) {
    const val = rates[metric];
    if (val !== null && val !== undefined && val > 100) {
      flags.push({ type: 'tracking_error', metric, value: val });
      isOutlier = true;
      outlierReasons.push(metric + ' > 100%');
    }
  }

  // Per DQ-01/DQ-02: Negative delivered detected (clamped during aggregation)
  if (agg.negativeDeliveredCount > 0) {
    flags.push({ type: 'negative_delivered', count: agg.negativeDeliveredCount });
  }

  // Per DQ-03: Low sample — total delivered < 100
  const totalDelivered = agg.emailDelivered + agg.pushDelivered + agg.smsDelivered;
  if (totalDelivered < 100 && totalDelivered > 0) {
    flags.push({ type: 'low_sample', delivered: totalDelivered, note: 'insufficient for conclusions' });
  }

  // Per DQ-02: 3x-median outlier detection
  for (const metric of rateNames) {
    const val = rates[metric];
    const median = allMedianRates[metric];
    if (val !== null && val !== undefined && median !== null && median !== undefined) {
      if (val > 3 * median) {
        flags.push({ type: 'outlier', metric, value: val, median });
        isOutlier = true;
        if (!outlierReasons.includes(metric + ' > 3x median')) {
          outlierReasons.push(metric + ' > 3x median');
        }
      }
    }
  }

  return { flags, isOutlier, outlierReasons };
}

// ---------------------------------------------------------------------------
// Helper: Score a single health signal (legacy — kept for scoreTier() only)
// ---------------------------------------------------------------------------

/**
 * Convert a metric value to a tier and score.
 *
 * @param {number} value      - The metric value
 * @param {Object} thresholds - { healthyMax, functionalMin, functionalMax, needsWorkMin }
 * @param {boolean} higherIsBetter - true for delivery rate; false for bounce rate, sprawl, etc.
 * @returns {{ tier: string, score: number, value: number }}
 */
function scoreTier(value, higherIsBetter, thresholds) {
  let tier, score;

  if (higherIsBetter) {
    // Higher value = healthier (e.g., delivery rate)
    if (value > thresholds.healthyMin) {
      tier = 'healthy'; score = 9;
    } else if (value >= thresholds.functionalMin) {
      tier = 'functional'; score = 6;
    } else {
      tier = 'needsWork'; score = 2;
    }
  } else {
    // Lower value = healthier (e.g., bounce rate, sprawl count)
    if (value < thresholds.healthyMax) {
      tier = 'healthy'; score = 9;
    } else if (value <= thresholds.functionalMax) {
      tier = 'functional'; score = 6;
    } else {
      tier = 'needsWork'; score = 2;
    }
  }

  return { tier, score, value };
}

// ---------------------------------------------------------------------------
// Helpers for 5-dimension scoring framework
// ---------------------------------------------------------------------------

/**
 * Evaluate a single checklist item.
 * Returns pass: null and contribution: null when data is unavailable.
 *
 * @param {boolean} condition     - Whether the threshold is met
 * @param {boolean} dataAvailable - Whether the data needed exists
 * @returns {{ pass: boolean|null, contribution: number|null }}
 */
function evalItem(condition, dataAvailable) {
  if (!dataAvailable) return { pass: null, contribution: null };
  return { pass: Boolean(condition), contribution: condition ? 2 : 0 };
}

/**
 * Sum non-null contributions for a dimension's items.
 *
 * @param {Object[]} items - Array of { contribution: number|null }
 * @returns {number}
 */
function dimScore(items) {
  return items
    .filter(i => i.contribution !== null)
    .reduce((sum, i) => sum + i.contribution, 0);
}

/**
 * Map a dimension score to a tier label.
 * Uses UI-SPEC tier names: 'healthy' | 'functional' | 'critical'
 * NOTE: Do NOT use scoreTier() here — tier names differ ('needsWork' vs 'critical').
 *
 * @param {number} score - Integer 0-10
 * @returns {'healthy'|'functional'|'critical'}
 */
function dimTier(score) {
  if (score >= 8) return 'healthy';
  if (score >= 5) return 'needs_work';
  return 'critical';
}

// ---------------------------------------------------------------------------
// Helper: 5-dimension scoring framework (replaces scoreHealth)
// ---------------------------------------------------------------------------

/**
 * Score the program across 5 dimensions using the 5-dimension health scoring framework.
 * Each dimension has 5 checklist items x 2pts = 10pts max.
 * Items with unavailable data return pass: null and are excluded from score totals.
 *
 * @param {Object[]} processedCampaigns - Campaigns with _agg and _dq attached
 * @param {Object[]} workflows          - Raw workflow rows from reader.js
 * @param {Object[]} blastCampaigns     - Final blast campaigns
 * @param {Object[]} triggeredCampaigns - Final triggered campaigns
 * @returns {Object} - data.scoring shape per UI-SPEC
 */
function scoreProgram(processedCampaigns, workflows, blastCampaigns, triggeredCampaigns) {

  // ---------------------------------------------------------------------------
  // Shared computed values (reused across multiple dimensions)
  // ---------------------------------------------------------------------------

  // Aggregate email non-outliers for deliverability/engagement base
  let totalEmailSends = 0;
  let totalEmailDelivered = 0;
  let totalEmailBounced = 0;
  let totalEmailUniqueClicks = 0;
  let totalEmailUniqueOpens = 0;
  let totalEmailUniqueOpensFiltered = 0;
  let totalEmailComplaints = 0;
  let totalEmailUnsubscribes = 0;

  for (const c of processedCampaigns) {
    if (c.medium === 'email' && c._agg && c._dq && !c._dq.isOutlier) {
      totalEmailSends              += c._agg.emailSends;
      totalEmailDelivered          += c._agg.emailDelivered;
      totalEmailBounced            += c._agg.emailBounced;
      totalEmailUniqueClicks       += c._agg.emailUniqueClicks;
      totalEmailUniqueOpens        += c._agg.emailUniqueOpens;
      totalEmailUniqueOpensFiltered += c._agg.emailUniqueOpensFiltered;
      totalEmailComplaints         += c._agg.emailComplaints;
      totalEmailUnsubscribes       += c._agg.emailUnsubscribes;
    }
  }

  // Blast email click rate (sum/sum weighted)
  const blastEmailCampaigns = blastCampaigns.filter(c => c.medium === 'email');
  let blastEmailClicks = 0;
  let blastEmailDelivered = 0;
  for (const c of blastEmailCampaigns) {
    // Use raw agg from processedCampaigns map
    const pc = processedCampaigns.find(p => String(p.id) === String(c.id));
    if (pc && pc._agg && pc._dq && !pc._dq.isOutlier) {
      blastEmailClicks    += pc._agg.emailUniqueClicks;
      blastEmailDelivered += pc._agg.emailDelivered;
    }
  }
  const blastClickRate = blastEmailDelivered > 0
    ? (blastEmailClicks / blastEmailDelivered) * 100
    : null;

  // Triggered email click rate (sum/sum weighted) — shared between Engagement and Automation
  const triggeredEmailCampaigns = triggeredCampaigns.filter(c => c.medium === 'email');
  let triggeredEmailClicks = 0;
  let triggeredEmailDelivered = 0;
  let triggeredEmailSends = 0;
  for (const c of triggeredEmailCampaigns) {
    const pc = processedCampaigns.find(p => String(p.id) === String(c.id));
    if (pc && pc._agg && pc._dq && !pc._dq.isOutlier) {
      triggeredEmailClicks    += pc._agg.emailUniqueClicks;
      triggeredEmailDelivered += pc._agg.emailDelivered;
      triggeredEmailSends     += pc._agg.emailSends;
    }
  }
  const triggeredClickRate = triggeredEmailDelivered > 0
    ? (triggeredEmailClicks / triggeredEmailDelivered) * 100
    : null;

  // CTOR: clicks / opens (filtered if available, else raw)
  const ctorDenominator = totalEmailUniqueOpensFiltered > 0
    ? totalEmailUniqueOpensFiltered
    : totalEmailUniqueOpens;
  const ctorRate = ctorDenominator > 0
    ? (totalEmailUniqueClicks / ctorDenominator) * 100
    : null;

  // Mediums with sends > 0 across all campaigns
  const mediumSends = new Map();
  for (const c of blastCampaigns.concat(triggeredCampaigns)) {
    const m = c.medium;
    if (!m || m === 'unknown') continue;
    mediumSends.set(m, (mediumSends.get(m) || 0) + (c.metrics.sends || 0));
  }
  const activeMediums = Array.from(mediumSends.entries()).filter(([, sends]) => sends > 0).map(([m]) => m);
  const activeMediumCount = activeMediums.length;

  // Total sends across all mediums for dominance check
  const totalAllSends = Array.from(mediumSends.values()).reduce((s, v) => s + v, 0);
  const noSingleMediumDominates = totalAllSends > 0
    && Array.from(mediumSends.values()).every(s => (s / totalAllSends) * 100 <= 90);

  // Enabled workflows for automation/lifecycle
  const enabledWorkflows = workflows.filter(w => w.enabled === 'true');
  const enabledWorkflowCount = enabledWorkflows.length;

  // Dead workflow ratio for Automation (< 30%) and Lifecycle (< 20%)
  // Dead = enabled but zero associated campaigns in processedCampaigns
  const campaignWorkflowIds = new Set(
    processedCampaigns
      .filter(c => c.workflowId && c.workflowId !== '' && c.workflowId !== '0')
      .map(c => String(c.workflowId))
  );
  const deadEnabledCount = enabledWorkflows.filter(w => !campaignWorkflowIds.has(String(w.id))).length;
  const deadRatioAutomation  = enabledWorkflowCount > 0 ? deadEnabledCount / enabledWorkflowCount : 0;
  const deadRatioLifecycle   = workflows.length > 0 ? deadEnabledCount / workflows.length : 0;

  // Click rate trend: first-half vs second-half buckets (use processedCampaigns with attribution dates)
  // Group email blast campaigns by month, compute weighted click rate per month
  const monthClickData = new Map();
  for (const c of blastCampaigns) {
    if (c.medium !== 'email' || !c.attribution || !c.attribution.date) continue;
    const month = c.attribution.date.substring(0, 7); // YYYY-MM
    const pc = processedCampaigns.find(p => String(p.id) === String(c.id));
    if (!pc || !pc._agg || (pc._dq && pc._dq.isOutlier)) continue;
    const prev = monthClickData.get(month) || { clicks: 0, delivered: 0 };
    prev.clicks    += pc._agg.emailUniqueClicks;
    prev.delivered += pc._agg.emailDelivered;
    monthClickData.set(month, prev);
  }
  const sortedMonths = Array.from(monthClickData.keys()).sort();
  let clickRateTrendPass = null; // null if insufficient data
  if (sortedMonths.length >= 2) {
    const half = Math.floor(sortedMonths.length / 2);
    const firstHalf  = sortedMonths.slice(0, half);
    const secondHalf = sortedMonths.slice(half);
    const rateFor = (months) => {
      let clicks = 0; let delivered = 0;
      for (const m of months) { const d = monthClickData.get(m); clicks += d.clicks; delivered += d.delivered; }
      return delivered > 0 ? (clicks / delivered) * 100 : null;
    };
    const r1 = rateFor(firstHalf);
    const r2 = rateFor(secondHalf);
    if (r1 !== null && r2 !== null) clickRateTrendPass = (r2 >= r1);
  }

  // Consistent blast volume: month-over-month, no drop > 50%
  const blastMonthSends = new Map();
  for (const c of blastCampaigns) {
    if (c.medium !== 'email' || !c.attribution || !c.attribution.date) continue;
    const month = c.attribution.date.substring(0, 7);
    const pc = processedCampaigns.find(p => String(p.id) === String(c.id));
    if (!pc || !pc._agg) continue;
    blastMonthSends.set(month, (blastMonthSends.get(month) || 0) + pc._agg.emailSends);
  }
  const blastMonths = Array.from(blastMonthSends.keys()).sort();
  let consistentVolume = true;
  let hasBlastData = blastMonths.length >= 2;
  if (hasBlastData) {
    for (let i = 1; i < blastMonths.length; i++) {
      const prev = blastMonthSends.get(blastMonths[i - 1]);
      const curr = blastMonthSends.get(blastMonths[i]);
      if (prev > 0 && curr / prev < 0.5) { consistentVolume = false; break; }
    }
  }

  // No single-point dependency: top 2 workflows by triggered send volume < 80% of total
  const workflowSends = new Map();
  for (const c of triggeredCampaigns) {
    const wid = c.workflowId;
    if (!wid || wid === '' || wid === '0') continue;
    workflowSends.set(wid, (workflowSends.get(wid) || 0) + (c.metrics.sends || 0));
  }
  const sortedWfSends = Array.from(workflowSends.values()).sort((a, b) => b - a);
  const totalTriggeredSends = sortedWfSends.reduce((s, v) => s + v, 0);
  const top2 = sortedWfSends.slice(0, 2).reduce((s, v) => s + v, 0);
  const noSinglePointDep = totalTriggeredSends > 0 ? (top2 / totalTriggeredSends) < 0.80 : false;

  // Each active medium has triggered campaigns
  const triggeredMediums = new Set(triggeredCampaigns.map(c => c.medium).filter(Boolean));
  const allActiveMediumsHaveTriggered = activeMediums.length > 0
    && activeMediums.every(m => triggeredMediums.has(m));

  // Cross-channel journeys: any workflow with 2+ distinct mediums across its campaigns
  const workflowMediums = new Map();
  for (const c of blastCampaigns.concat(triggeredCampaigns)) {
    const wid = c.workflowId;
    if (!wid || wid === '' || wid === '0' || !c.medium) continue;
    if (!workflowMediums.has(wid)) workflowMediums.set(wid, new Set());
    workflowMediums.get(wid).add(c.medium);
  }
  const crossChannelJourneyExists = Array.from(workflowMediums.values()).some(s => s.size >= 2);

  // Welcome/onboarding workflow present and active
  const welcomePattern = /\b(welcome|onboard|onboarding)\b/i;
  const hasWelcomeWorkflow = enabledWorkflows.some(w => welcomePattern.test(w.name || ''));

  // ---------------------------------------------------------------------------
  // Dimension 1: Deliverability
  // ---------------------------------------------------------------------------

  const deliverabilityItems = [
    {
      label: 'Delivery rate above target',
      explanation: 'This checks whether your email delivery rate stayed above 97% over the review period. A drop below this threshold often signals a list hygiene or sending reputation issue.',
      threshold: '>97% over trailing review period',
      ...evalItem(totalEmailSends > 0 && (totalEmailDelivered / totalEmailSends) * 100 > 97, totalEmailSends > 0)
    },
    {
      label: 'Bounce rate within safe zone',
      explanation: 'This checks whether your email bounce rate stayed below 2%. High bounces can damage your sender reputation with inbox providers.',
      threshold: '<2% over trailing review period',
      ...evalItem(totalEmailSends > 0 && (totalEmailBounced / totalEmailSends) * 100 < 2, totalEmailSends > 0)
    },
    {
      label: 'Complaint rate within safe zone',
      explanation: 'This checks whether spam complaint rates are below the Gmail/Yahoo threshold of 0.05%.',
      threshold: '<0.05% (Gmail/Yahoo threshold)',
      ...evalItem(
        totalEmailSends > 0 && (totalEmailComplaints / totalEmailSends) * 100 < 0.05,
        totalEmailSends > 0 && totalEmailComplaints >= 0
      )
    },
    {
      label: 'Unsubscribe rate within safe zone',
      explanation: 'This checks whether your unsubscribe rate stays below 0.5% per period.',
      threshold: '<0.5% per period',
      ...evalItem(
        totalEmailSends > 0 && (totalEmailUnsubscribes / totalEmailSends) * 100 < 0.5,
        totalEmailSends > 0 && totalEmailUnsubscribes >= 0
      )
    },
    {
      label: 'Consistent blast send volume',
      explanation: 'This checks whether blast send volume has been consistent month-over-month, without sudden drops greater than 50%. Large drops can indicate deliverability issues or paused programs.',
      threshold: 'No month-over-month drop >50% in blast sends',
      ...evalItem(consistentVolume, hasBlastData)
    }
  ];

  const deliverabilityScore = dimScore(deliverabilityItems);
  const deliverability = {
    key: 'deliverability',
    label: 'Deliverability',
    score: deliverabilityScore,
    tier: dimTier(deliverabilityScore),
    items: deliverabilityItems
  };

  // ---------------------------------------------------------------------------
  // Dimension 2: Engagement
  // ---------------------------------------------------------------------------

  const engagementItems = [
    {
      label: 'Email blast click rate meets benchmark',
      explanation: 'This checks whether your blast email click rate exceeds the 1.5% benchmark. Click rate is the strongest signal of subscriber engagement with your content.',
      threshold: '>1.5%',
      ...evalItem(blastClickRate !== null && blastClickRate > 1.5, blastClickRate !== null)
    },
    {
      label: 'Email triggered click rate meets benchmark',
      explanation: 'This checks whether your triggered email click rate exceeds the 2.3% benchmark. Triggered emails typically perform better than blasts because they respond to subscriber actions.',
      threshold: '>2.3%',
      ...evalItem(triggeredClickRate !== null && triggeredClickRate > 2.3, triggeredClickRate !== null)
    },
    {
      label: 'Click rate trend stable or improving',
      explanation: 'This checks whether your click rate trend is stable or improving over the review period. A declining trend may indicate content fatigue or list quality issues.',
      threshold: 'Net positive or zero change over available periods',
      ...evalItem(clickRateTrendPass === true, clickRateTrendPass !== null)
    },
    {
      label: 'Unsubscribe rate within safe zone',
      explanation: 'This checks whether your unsubscribe rate stays below 0.5% per period.',
      threshold: '<0.5% per period',
      ...evalItem(
        totalEmailSends > 0 && (totalEmailUnsubscribes / totalEmailSends) * 100 < 0.5,
        totalEmailSends > 0 && totalEmailUnsubscribes >= 0
      )
    },
    {
      label: 'Click-to-open rate indicates content relevance',
      explanation: 'This checks whether your click-to-open rate exceeds 10%, which indicates your email content is relevant to subscribers who open your messages.',
      threshold: '>10% CTOR',
      ...evalItem(ctorRate !== null && ctorRate > 10, ctorRate !== null)
    }
  ];

  const engagementScore = dimScore(engagementItems);
  const engagement = {
    key: 'engagement',
    label: 'Engagement',
    score: engagementScore,
    tier: dimTier(engagementScore),
    items: engagementItems
  };

  // ---------------------------------------------------------------------------
  // Dimension 3: Multi-Channel Maturity
  // ---------------------------------------------------------------------------

  const multiChannelItems = [
    {
      label: 'At least 2 mediums active and coordinated',
      explanation: 'This checks whether you are actively sending through at least two messaging channels. Multi-channel programs reach subscribers where they are most responsive.',
      threshold: '>=2 mediums with sends > 0',
      ...evalItem(activeMediumCount >= 2, true)
    },
    {
      label: 'Each active medium has automated campaigns',
      explanation: 'This checks whether each active channel has automated triggered campaigns, not just one-off blasts. Automation drives consistent engagement without manual effort.',
      threshold: 'Every active medium has at least one triggered campaign',
      ...evalItem(allActiveMediumsHaveTriggered, activeMediums.length > 0)
    },
    {
      label: 'Cross-channel journeys detected',
      explanation: 'This checks whether any of your automated journeys coordinate messages across multiple channels. Cross-channel journeys provide a more cohesive subscriber experience.',
      threshold: 'At least one workflow uses 2+ mediums',
      ...evalItem(crossChannelJourneyExists, workflowMediums.size > 0)
    },
    {
      label: 'Message type diversity check',
      explanation: 'Message type diversity check is not available in the current data export.',
      threshold: '>1 message type (e.g., newsletter vs promo)',
      ...evalItem(false, false)
    },
    {
      label: 'No single medium dominates send volume',
      explanation: 'This checks whether your send volume is distributed across channels rather than concentrated in a single medium. Over-reliance on one channel creates risk if that channel\'s performance degrades.',
      threshold: 'No medium >90% of total send volume',
      ...evalItem(noSingleMediumDominates, totalAllSends > 0)
    }
  ];

  const multiChannelScore = dimScore(multiChannelItems);
  const multiChannelMaturity = {
    key: 'multiChannelMaturity',
    label: 'Multi-Channel Maturity',
    score: multiChannelScore,
    tier: dimTier(multiChannelScore),
    items: multiChannelItems
  };

  // ---------------------------------------------------------------------------
  // Dimension 4: Automation Maturity
  // ---------------------------------------------------------------------------

  const triggeredPct = totalEmailSends > 0
    ? (triggeredEmailSends / totalEmailSends) * 100
    : null;

  const automationItems = [
    {
      label: 'Triggered marketing sends meaningful share',
      explanation: 'This checks whether triggered emails make up at least 15% of your total email volume. A healthy automation program should drive meaningful volume beyond manual blasts.',
      threshold: '>15% of total email volume',
      ...evalItem(triggeredPct !== null && triggeredPct > 15, triggeredPct !== null)
    },
    {
      label: 'Journey count above threshold',
      explanation: 'This checks whether you have more than 10 journeys configured. A mature automation program typically has journeys for onboarding, re-engagement, purchase follow-up, and other lifecycle stages.',
      threshold: '>10 journeys',
      ...evalItem(workflows.length > 10, true)
    },
    {
      label: 'Low dead-enabled workflow ratio',
      explanation: 'This checks whether fewer than 30% of your enabled journeys have had zero campaign activity. Dead workflows create clutter and may indicate abandoned programs.',
      threshold: '<30% enabled workflows with zero sends',
      ...evalItem(deadRatioAutomation < 0.30, enabledWorkflowCount > 0)
    },
    {
      label: 'Email triggered click rate meets benchmark',
      explanation: 'This checks whether your triggered email click rate exceeds the 2.3% benchmark. This item is shared with the Engagement dimension because triggered performance matters for both.',
      threshold: '>2.3%',
      ...evalItem(triggeredClickRate !== null && triggeredClickRate > 2.3, triggeredClickRate !== null)
    },
    {
      label: 'Welcome/onboarding workflow present and active',
      explanation: 'This checks whether you have an active welcome or onboarding journey. Welcome series are the highest-performing automated email programs and set the tone for subscriber relationships.',
      threshold: 'Enabled workflow matching "welcome", "onboard", or "onboarding"',
      ...evalItem(hasWelcomeWorkflow, enabledWorkflowCount > 0)
    }
  ];

  const automationScore = dimScore(automationItems);
  const automationMaturity = {
    key: 'automationMaturity',
    label: 'Automation Maturity',
    score: automationScore,
    tier: dimTier(automationScore),
    items: automationItems
  };

  // ---------------------------------------------------------------------------
  // Dimension 5: Lifecycle Coverage
  // ---------------------------------------------------------------------------

  const lifecycleItems = [
    {
      label: 'Low dead workflow ratio',
      explanation: 'This checks whether fewer than 20% of all your workflows are enabled but inactive. This is a stricter threshold than the Automation check because lifecycle coverage requires an actively maintained program catalog.',
      threshold: '<20% of all workflows with zero associated campaigns',
      ...evalItem(deadRatioLifecycle < 0.20, workflows.length > 0)
    },
    {
      label: 'Multiple send types used',
      explanation: 'This checks whether you use both blast and triggered campaign types. A complete lifecycle program needs both planned communications and behavior-triggered automation.',
      threshold: 'Both blast and triggered campaigns present',
      ...evalItem(blastCampaigns.length > 0 && triggeredCampaigns.length > 0, true)
    },
    {
      label: 'No single-point dependency',
      explanation: 'This checks whether your triggered send volume is distributed across journeys rather than concentrated in just one or two. Over-reliance on a single journey creates risk if that program underperforms.',
      threshold: 'Top 2 workflows <80% of total triggered sends',
      ...evalItem(noSinglePointDep, totalTriggeredSends > 0)
    },
    {
      label: 'Program breadth',
      explanation: 'This checks whether you have more than 10 total workflows. Program breadth indicates a mature lifecycle approach covering multiple subscriber touchpoints.',
      threshold: '>10 total workflows',
      ...evalItem(workflows.length > 10, true)
    },
    {
      label: 'Multiple message mediums active',
      explanation: 'This checks whether you are sending through multiple messaging channels. This item is shared with the Multi-Channel dimension because channel breadth is essential for lifecycle coverage.',
      threshold: '>=2 mediums with sends > 0',
      ...evalItem(activeMediumCount >= 2, true)
    }
  ];

  const lifecycleScore = dimScore(lifecycleItems);
  const lifecycleCoverage = {
    key: 'lifecycleCoverage',
    label: 'Lifecycle Coverage',
    score: lifecycleScore,
    tier: dimTier(lifecycleScore),
    items: lifecycleItems
  };

  // ---------------------------------------------------------------------------
  // Assembly
  // ---------------------------------------------------------------------------

  const assessedDimensions = [
    deliverability,
    engagement,
    multiChannelMaturity,
    automationMaturity,
    lifecycleCoverage
  ];

  // 3 dimensions that require manual audit — not assessable from Iterable API data
  const notAssessedDimensions = [
    { label: 'Data Schema', score: 5, tier: 'not_assessed', notAssessed: true, items: [] },
    { label: 'Templates', score: 5, tier: 'not_assessed', notAssessed: true, items: [] },
    { label: 'Platform', score: 5, tier: 'not_assessed', notAssessed: true, items: [] }
  ];

  // All 8 dimensions in radar order: Deliverability, Engagement, Automation,
  // Data Schema, Lifecycle, Templates, Platform, Multichannel
  const dimensions = [
    deliverability,
    engagement,
    automationMaturity,
    notAssessedDimensions[0], // Data Schema
    lifecycleCoverage,
    notAssessedDimensions[1], // Templates
    notAssessedDimensions[2], // Platform
    multiChannelMaturity
  ];

  // Overall score uses all 8 dimensions (not-assessed default to 5/10)
  const sumOfScores = dimensions.reduce((s, d) => s + d.score, 0);
  const overallAverage = parseFloat((sumOfScores / dimensions.length).toFixed(1));
  const overallTier = dimTier(Math.round(overallAverage));

  return { overallAverage, overallTier, dimensions, assessedCount: assessedDimensions.length, totalCount: dimensions.length };
}

// ---------------------------------------------------------------------------
// Helper: Build attribution metadata
// ---------------------------------------------------------------------------

/**
 * Set attribution date and bucket for a campaign.
 * Per ATTR-01: blast uses startAt; triggered uses collection period.
 * Per ATTR-02: triggered uses monthly buckets if > 3 months data, weekly otherwise.
 * Per ATTR-03: triggered with zero sends → engagementTail = true, rates = null.
 *
 * @param {Object} campaign - Campaign row
 * @param {Object} agg      - Aggregated raw counts
 * @returns {{ date: string|null, bucket: string, engagementTail: boolean }}
 */
function buildAttribution(campaign, agg) {
  const type = campaign.type || '';

  if (type === 'Blast') {
    return {
      date: campaign.startAt || null,
      bucket: 'weekly',
      engagementTail: false
    };
  }

  // Triggered campaigns
  const totalSends = agg.emailSends + agg.pushSends + agg.smsSends;
  const engagementTail = totalSends === 0;

  // Determine bucket based on data window length
  const bucket = agg.windowCount > 12 ? 'monthly' : 'weekly';

  return {
    date: null, // collection period attribution
    bucket,
    engagementTail
  };
}

// ---------------------------------------------------------------------------
// Helper: Build normalized sends value for a campaign
// ---------------------------------------------------------------------------

/**
 * Return the total sends for any medium combination.
 */
function getTotalSends(agg) {
  return agg.emailSends + agg.pushSends + agg.smsSends;
}

// ---------------------------------------------------------------------------
// Helper: Get delivered count for primary medium
// ---------------------------------------------------------------------------

function getPrimaryDelivered(agg, medium) {
  if (medium === 'email') return agg.emailDelivered;
  if (medium === 'push')  return agg.pushDelivered;
  if (medium === 'sms')   return agg.smsDelivered;
  return agg.emailDelivered + agg.pushDelivered + agg.smsDelivered;
}

// ---------------------------------------------------------------------------
// Main run()
// ---------------------------------------------------------------------------

/**
 * Transform reader.js output into four view-specific data objects.
 *
 * @param {Object} rawData - Output of reader.run()
 * @returns {Promise<{executive, engagement, campaigns, journeys}>}
 */
async function run(rawData) {
  const { campaigns: rawCampaigns, metrics, workflows, warnings } = rawData;

  console.error('[processor] campaigns:', rawCampaigns.length,
    '| metrics rows:', metrics.length,
    '| workflows:', workflows.length,
    '| reader warnings:', (warnings || []).length);

  // ---------------------------------------------------------------------------
  // Step 1: Group metrics by campaign ID
  // ---------------------------------------------------------------------------

  const metricsByCampaign = groupMetricsByCampaign(metrics);

  // ---------------------------------------------------------------------------
  // Step 2: For each campaign, aggregate raw counts + compute weighted rates
  // ---------------------------------------------------------------------------

  const processedCampaigns = rawCampaigns.map(c => {
    const rows = metricsByCampaign.get(String(c.id)) || [];
    const agg   = aggregateRawCounts(rows, c.medium);
    const rates = computeWeightedRates(agg, c.medium);
    return {
      id: c.id,
      name: c.name,
      campaignState: c.campaignState,
      type: c.type || '',
      campaignCategory: c.campaignCategory || '',
      medium: c.medium,
      sendSize: parseInt(c.sendSize, 10) || 0,
      workflowId: c.workflowId || '',
      startAt: c.startAt || '',
      createdAt: c.createdAt || '',
      updatedAt: c.updatedAt || '',
      templateId: c.templateId || '',
      _agg: agg,
      _rates: rates,
      _dq: null // filled in step 4
    };
  });

  // ---------------------------------------------------------------------------
  // Step 3: Compute median rates across all campaigns for outlier detection
  // ---------------------------------------------------------------------------

  const metricNames = ['deliveryRate', 'bounceRate', 'clickRate', 'openRate', 'openRateFiltered'];
  const allMedianRates = {};
  for (const metric of metricNames) {
    const values = processedCampaigns.map(c => c._rates[metric] !== undefined ? c._rates[metric] : null);
    allMedianRates[metric] = computeMedian(values);
  }

  // ---------------------------------------------------------------------------
  // Step 4: Flag data quality issues (using medians from step 3)
  // ---------------------------------------------------------------------------

  for (const c of processedCampaigns) {
    c._dq = flagDataQuality(c, c._agg, c._rates, allMedianRates);
  }

  // ---------------------------------------------------------------------------
  // Step 5: Build attribution and assemble final campaign objects
  // ---------------------------------------------------------------------------

  const finalCampaigns = processedCampaigns.map(c => {
    const attr = buildAttribution(c, c._agg);
    const totalSends = getTotalSends(c._agg);

    // Null out rates for engagement-tail triggered campaigns (ATTR-03)
    const metrics = attr.engagementTail
      ? buildNullRates(c.medium)
      : buildCampaignMetrics(c._agg, c._rates, c.medium);

    return {
      id: c.id,
      name: c.name,
      type: c.type,
      medium: c.medium,
      campaignState: c.campaignState,
      workflowId: c.workflowId,
      sendSize: c.sendSize,
      metrics,
      dataQuality: c._dq,
      attribution: { date: attr.date, bucket: attr.bucket },
      engagementTail: attr.engagementTail
    };
  });

  // ---------------------------------------------------------------------------
  // Step 6: Separate blast and triggered
  // ---------------------------------------------------------------------------

  const blastCampaigns     = finalCampaigns.filter(c => c.type === 'Blast');
  const triggeredCampaigns = finalCampaigns.filter(c => c.type === 'Triggered');

  // ---------------------------------------------------------------------------
  // Step 7: Score program across 5 dimensions (replaces old scoreHealth)
  // ---------------------------------------------------------------------------

  const scoring = scoreProgram(processedCampaigns, workflows, blastCampaigns, triggeredCampaigns);

  // ---------------------------------------------------------------------------
  // Step 8: Build journeys — group campaigns by workflowId, join with workflows
  // ---------------------------------------------------------------------------

  const workflowMap = new Map();
  for (const wf of workflows) {
    workflowMap.set(String(wf.id), wf);
  }

  // Build metrics lookup for per-journey time-series (reused below)
  const metricsById = new Map();
  if (Array.isArray(metrics)) {
    for (const row of metrics) {
      const id = String(row['id'] || '');
      if (!id) continue;
      if (!metricsById.has(id)) metricsById.set(id, []);
      metricsById.get(id).push(row);
    }
  }

  const journeyGroups = new Map();
  for (const c of finalCampaigns) {
    if (!c.workflowId || c.workflowId === '' || c.workflowId === '0') continue;
    const wid = String(c.workflowId);
    if (!journeyGroups.has(wid)) journeyGroups.set(wid, []);
    journeyGroups.get(wid).push(c);
  }

  const journeys = [];
  for (const [wid, jCampaigns] of journeyGroups.entries()) {
    const wf = workflowMap.get(wid) || { id: wid, name: 'Unknown Workflow', enabled: 'false', journeyType: '' };
    const aggMetrics = aggregateJourneyMetrics(jCampaigns, processedCampaigns);
    // Filter out campaigns with zero or missing sends so journey nested tables show real data only
    const filteredCampaigns = jCampaigns.filter(c => c.metrics && typeof c.metrics.sends === 'number' && c.metrics.sends > 0);

    // Per-journey monthly time-series (email sends, click rate, unsub rate, revenue)
    const campIds = jCampaigns.map(c => String(c.id));
    const timeSeries = buildJourneyTimeSeries(campIds, metricsById);

    journeys.push({
      id: wid,
      name: wf.name || 'Unknown Workflow',
      enabled: wf.enabled === 'true',
      journeyType: wf.journeyType || '',
      campaignCount: filteredCampaigns.length,
      aggregateMetrics: aggMetrics,
      timeSeries,
      campaigns: filteredCampaigns
    });
  }

  // Sort journeys by campaign count descending
  journeys.sort((a, b) => b.campaignCount - a.campaignCount);

  // ---------------------------------------------------------------------------
  // Step 9: Build engagement.byChannel — aggregate per medium (exclude outliers)
  // ---------------------------------------------------------------------------

  const emailNonOutliers = processedCampaigns.filter(c => c.medium === 'email' && !c._dq.isOutlier);
  const pushNonOutliers  = processedCampaigns.filter(c => c.medium === 'push'  && !c._dq.isOutlier);
  const smsNonOutliers   = processedCampaigns.filter(c => c.medium === 'sms'   && !c._dq.isOutlier);

  const emailAgg = sumAggArray(emailNonOutliers);
  const pushAgg  = sumAggArray(pushNonOutliers);
  const smsAgg   = sumAggArray(smsNonOutliers);

  const byChannel = {
    email: buildChannelSummary(emailAgg, 'email'),
    push:  buildChannelSummary(pushAgg, 'push'),
    sms:   buildChannelSummary(smsAgg, 'sms')
  };

  // ---------------------------------------------------------------------------
  // Step 10: Build time-series data
  // ---------------------------------------------------------------------------

  const sendVolumeTrend = buildSendVolumeTrend(processedCampaigns, finalCampaigns, metrics);
  const timeSeries = buildTimeSeries(processedCampaigns, finalCampaigns, metrics);

  // ---------------------------------------------------------------------------
  // Step 11: Compute top performers (revenue-first, filter low-send outliers)
  // Sort by revenue first, click rate as tiebreaker. Filter >= 500 sends.
  // ---------------------------------------------------------------------------

  const topPerformerCandidates = finalCampaigns
    .filter(c => c.medium === 'email' && c.metrics.clickRate !== null && !c.engagementTail && c.metrics.sends >= 500)
    .sort((a, b) => {
      // Revenue-first sort: campaigns with revenue > 0 sorted by revenue descending
      const aRev = a.metrics.revenue || 0;
      const bRev = b.metrics.revenue || 0;
      if (bRev > 0 || aRev > 0) {
        if (bRev !== aRev) return bRev - aRev;
      }
      // Tiebreaker: click rate descending
      return (b.metrics.clickRate || 0) - (a.metrics.clickRate || 0);
    })
    .slice(0, 10);

  const hasRevenue = topPerformerCandidates.some(c => (c.metrics.revenue || 0) > 0);
  const topPerformersLabel = hasRevenue ? 'Top Performers by Revenue' : 'Top Performers by Click Rate';
  const topPerformers = topPerformerCandidates;

  console.error('[processor] done —',
    finalCampaigns.length, 'campaigns,',
    journeys.length, 'journeys,',
    'scoring:', scoring.overallAverage + '/10 (' + scoring.overallTier + ')'
  );

  // Compute aggregate totals for executive KPIs
  const totalSends = finalCampaigns.reduce((sum, c) => sum + (c.metrics?.sends || 0), 0);
  const totalRevenue = finalCampaigns.reduce((sum, c) => sum + (c.metrics?.revenue || 0), 0);

  return {
    executive: {
      sendVolumeTrend,
      topPerformers,
      topPerformersLabel,
      totalSends,
      totalRevenue,
      entityCounts: {
        totalCampaigns: rawCampaigns.length,
        blastCampaigns: blastCampaigns.length,
        triggeredCampaigns: triggeredCampaigns.length
      }
    },
    engagement: {
      byChannel,
      timeSeries
    },
    campaigns: finalCampaigns, // engagement tail removal handled in assembler
    journeys: journeys.filter(j => j.enabled === true), // disabled journeys excluded
    scoring // NEW: 5-dimension scoring framework output
  };
}

// ---------------------------------------------------------------------------
// Internal: Build metrics object for a campaign
// ---------------------------------------------------------------------------

function buildCampaignMetrics(agg, rates, medium) {
  if (medium === 'email') {
    return {
      sends: agg.emailSends,
      delivered: agg.emailDelivered,
      bounced: agg.emailBounced,
      uniqueClicks: agg.emailUniqueClicks,
      uniqueOpens: agg.emailUniqueOpens,
      uniqueOpensFiltered: agg.emailUniqueOpensFiltered,
      revenue: agg.revenue,
      deliveryRate: rates.deliveryRate || null,
      bounceRate: rates.bounceRate || null,
      clickRate: rates.clickRate || null,
      openRate: rates.openRate || null,
      openRateFiltered: rates.openRateFiltered || null,
      ctor: rates.ctor || null,
      rpm: rates.rpm || null
    };
  } else if (medium === 'push') {
    return {
      sends: agg.pushSends,
      delivered: agg.pushDelivered,
      bounced: agg.pushBounced,
      uniqueOpened: agg.pushUniqueOpened,
      deliveryRate: rates.deliveryRate || null,
      bounceRate: rates.bounceRate || null
    };
  } else if (medium === 'sms') {
    return {
      sends: agg.smsSends,
      delivered: agg.smsDelivered,
      bounced: agg.smsBounced,
      uniqueClicks: agg.smsUniqueClicks,
      deliveryRate: rates.deliveryRate || null,
      bounceRate: rates.bounceRate || null,
      clickRate: rates.clickRate || null
    };
  }
  // Unknown / inapp — return raw counts
  return {
    sends: agg.emailSends + agg.pushSends + agg.smsSends,
    delivered: agg.emailDelivered + agg.pushDelivered + agg.smsDelivered
  };
}

function buildNullRates(medium) {
  if (medium === 'email') {
    return {
      sends: 0, delivered: 0, bounced: 0,
      uniqueClicks: 0, uniqueOpens: 0, uniqueOpensFiltered: 0, revenue: 0,
      deliveryRate: null, bounceRate: null, clickRate: null,
      openRate: null, openRateFiltered: null, ctor: null, rpm: null
    };
  } else if (medium === 'push') {
    return { sends: 0, delivered: 0, bounced: 0, uniqueOpened: 0,
      deliveryRate: null, bounceRate: null };
  } else if (medium === 'sms') {
    return { sends: 0, delivered: 0, bounced: 0, uniqueClicks: 0,
      deliveryRate: null, bounceRate: null, clickRate: null };
  }
  // unknown / inapp: include null rate fields so callers can check them
  return {
    sends: 0, delivered: 0,
    deliveryRate: null, bounceRate: null, clickRate: null
  };
}

// ---------------------------------------------------------------------------
// Internal: Sum aggregates across a set of processed campaigns
// ---------------------------------------------------------------------------

function sumAggArray(processedArr) {
  const total = {
    emailSends: 0, emailDelivered: 0, emailBounced: 0,
    emailUniqueClicks: 0, emailUniqueOpens: 0, emailUniqueOpensFiltered: 0,
    pushSends: 0, pushDelivered: 0, pushBounced: 0, pushUniqueOpened: 0,
    smsSends: 0, smsDelivered: 0, smsBounced: 0, smsUniqueClicks: 0,
    revenue: 0
  };
  for (const c of processedArr) {
    const a = c._agg;
    total.emailSends              += a.emailSends;
    total.emailDelivered          += a.emailDelivered;
    total.emailBounced            += a.emailBounced;
    total.emailUniqueClicks       += a.emailUniqueClicks;
    total.emailUniqueOpens        += a.emailUniqueOpens;
    total.emailUniqueOpensFiltered += a.emailUniqueOpensFiltered;
    total.pushSends               += a.pushSends;
    total.pushDelivered           += a.pushDelivered;
    total.pushBounced             += a.pushBounced;
    total.pushUniqueOpened        += a.pushUniqueOpened;
    total.smsSends                += a.smsSends;
    total.smsDelivered            += a.smsDelivered;
    total.smsBounced              += a.smsBounced;
    total.smsUniqueClicks         += a.smsUniqueClicks;
    total.revenue                 += a.revenue;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Internal: Build channel summary from aggregated counts
// ---------------------------------------------------------------------------

function buildChannelSummary(agg, medium) {
  const rates = computeWeightedRates(agg, medium);
  if (medium === 'email') {
    return {
      sends: agg.emailSends,
      delivered: agg.emailDelivered,
      bounced: agg.emailBounced,
      uniqueClicks: agg.emailUniqueClicks,
      uniqueOpens: agg.emailUniqueOpens,
      revenue: agg.revenue,
      deliveryRate: rates.deliveryRate,
      bounceRate: rates.bounceRate,
      clickRate: rates.clickRate,
      openRate: rates.openRate,
      openRateFiltered: rates.openRateFiltered,
      ctor: rates.ctor,
      rpm: rates.rpm
    };
  } else if (medium === 'push') {
    return {
      sends: agg.pushSends,
      delivered: agg.pushDelivered,
      bounced: agg.pushBounced,
      uniqueOpened: agg.pushUniqueOpened,
      deliveryRate: rates.deliveryRate,
      bounceRate: rates.bounceRate
    };
  } else if (medium === 'sms') {
    return {
      sends: agg.smsSends,
      delivered: agg.smsDelivered,
      bounced: agg.smsBounced,
      uniqueClicks: agg.smsUniqueClicks,
      deliveryRate: rates.deliveryRate,
      bounceRate: rates.bounceRate,
      clickRate: rates.clickRate
    };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Internal: Aggregate metrics across all campaigns in a journey
// ---------------------------------------------------------------------------

function aggregateJourneyMetrics(journeyCampaigns, processedCampaigns) {
  // Map finalCampaign id -> processedCampaign for _agg access
  const procMap = new Map(processedCampaigns.map(c => [String(c.id), c]));

  // Don't exclude outliers from journey aggregation — triggered campaigns
  // naturally have higher engagement rates than the blast-dominated median.
  // Excluding them wipes out entire journeys (e.g. Abandoned Cart with 47K sends).
  const filtered = journeyCampaigns
    .map(c => procMap.get(String(c.id)))
    .filter(c => c && c._agg);

  if (filtered.length === 0) return {};

  const emailFiltered = filtered.filter(c => c.medium === 'email');
  if (emailFiltered.length === 0) {
    // Non-email journey — return all-channel send total
    const agg = sumAggArray(filtered);
    const totalSends = agg.emailSends + agg.pushSends + agg.smsSends;
    return { sends: totalSends };
  }

  const agg   = sumAggArray(emailFiltered);
  const rates = computeWeightedRates(agg, 'email');

  // All-channel total sends (email + push + SMS) for journey ranking
  const allAgg = sumAggArray(filtered);
  const totalSends = allAgg.emailSends + allAgg.pushSends + allAgg.smsSends;

  return {
    sends: totalSends,
    delivered: agg.emailDelivered,
    bounced: agg.emailBounced,
    revenue: agg.revenue,
    deliveryRate: rates.deliveryRate,
    bounceRate: rates.bounceRate,
    clickRate: rates.clickRate,
    openRate: rates.openRate,
    ctor: rates.ctor,
    rpm: rates.rpm
  };
}

// ---------------------------------------------------------------------------
// Internal: Build per-journey monthly time-series
// ---------------------------------------------------------------------------

/**
 * Build a monthly time-series for a single journey.
 * Iterates all metrics rows for the journey's campaigns, bucketing by window_start YYYY-MM.
 * Returns an array sorted by date: [{ date, sends, delivered, uniqueClicks, unsubscribes, revenue }]
 * Rates (clickRate, unsubRate) are computed per-bucket from raw counts.
 *
 * @param {string[]}  campaignIds  - IDs of campaigns belonging to this journey
 * @param {Map}       metricsById  - Map of campaignId -> metricsRow[]
 * @returns {Object[]} sorted monthly buckets
 */
function buildJourneyTimeSeries(campaignIds, metricsById) {
  const monthMap = new Map();

  for (const id of campaignIds) {
    const rows = metricsById.get(String(id)) || [];
    for (const row of rows) {
      const windowStart = row['window_start'];
      if (!windowStart) continue;
      const monthKey = String(windowStart).substring(0, 7); // YYYY-MM

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, { date: monthKey, sends: 0, delivered: 0, uniqueClicks: 0, unsubscribes: 0, revenue: 0 });
      }
      const b = monthMap.get(monthKey);
      b.sends        += parseFloat(row['Total Email Sends'] || 0) || 0;
      const rawDel    = parseFloat(row['Total Emails Delivered'] || 0) || 0;
      b.delivered    += Math.max(0, rawDel);
      b.uniqueClicks += parseFloat(row['Unique Email Clicks'] || 0) || 0;
      b.unsubscribes += parseFloat(row['Total Unsubscribes'] || 0) || 0;
      b.revenue      += parseFloat(row['Revenue'] || 0) || 0;
    }
  }

  return Array.from(monthMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(b => ({
      date:       b.date,
      sends:      b.sends,
      delivered:  b.delivered,
      clickRate:  b.delivered > 0 ? parseFloat(((b.uniqueClicks / b.delivered) * 100).toFixed(2)) : null,
      unsubRate:  b.sends > 0     ? parseFloat(((b.unsubscribes / b.sends) * 100).toFixed(3)) : null,
      revenue:    b.revenue
    }));
}

// ---------------------------------------------------------------------------
// Internal: Build send volume time-series
// ---------------------------------------------------------------------------

/**
 * Build a monthly time-series of email sends bucketed by YYYY-MM.
 * Includes blast/triggered split, bounce rate, unsub rate, click rate.
 *
 * For BLAST campaigns: uses attribution.date (startAt) for bucketing.
 * For TRIGGERED campaigns: iterates raw metrics rows and uses window_start
 *   (ISO date string from Phase 02.1 CSV column) to bucket by month.
 *
 * @param {Object[]} processedCampaigns - Campaigns with _agg and _dq
 * @param {Object[]} finalCampaigns     - Campaigns with attribution.date and type
 * @param {Object[]} metricsRows        - Raw metrics rows from reader (all campaigns)
 */
function buildSendVolumeTrend(processedCampaigns, finalCampaigns, metricsRows) {
  const procMap = new Map(processedCampaigns.map(c => [String(c.id), c]));
  const monthMap = new Map();

  // Build lookup: campaignId -> metricsRow[] for triggered window bucketing
  const metricsById = new Map();
  if (Array.isArray(metricsRows)) {
    for (const row of metricsRows) {
      const id = String(row['id'] || '');
      if (!id) continue;
      if (!metricsById.has(id)) metricsById.set(id, []);
      metricsById.get(id).push(row);
    }
  }

  function ensureBucket(monthKey) {
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        date: monthKey,
        blastSends: 0,
        triggeredSends: 0,
        delivered: 0,
        bounced: 0,
        uniqueClicks: 0,
        complaints: 0,
        unsubscribes: 0
      });
    }
    return monthMap.get(monthKey);
  }

  let triggeredPool = null;

  for (const fc of finalCampaigns) {
    const pc = procMap.get(String(fc.id));
    if (!pc) continue;

    const isBlast = (fc.type || '').toLowerCase() === 'blast';

    // For blast campaigns, skip outliers — their anomalous rates would skew the trend.
    // For triggered campaigns, never skip on isOutlier: triggered engagement rates are
    // naturally higher than the blast-dominated global median and are not data errors.
    if (isBlast && pc._dq && pc._dq.isOutlier) continue;

    if (isBlast) {
      // Blast: use attribution.date (startAt) — single bucket per campaign
      const date = fc.attribution && fc.attribution.date;
      if (!date) continue;
      const monthKey = date.substring(0, 7); // YYYY-MM
      const bucket = ensureBucket(monthKey);
      bucket.blastSends   += pc._agg.emailSends || 0;
      bucket.delivered    += pc._agg.emailDelivered || 0;
      bucket.bounced      += pc._agg.emailBounced || 0;
      bucket.uniqueClicks += pc._agg.emailUniqueClicks || 0;
      bucket.complaints   += pc._agg.emailComplaints || 0;
      bucket.unsubscribes += pc._agg.emailUnsubscribes || 0;
    } else {
      // Triggered: bucket each metrics row by window_start when available
      const rows = metricsById.get(String(fc.id)) || [];
      const windowedRows = rows.filter(r => r['window_start']);

      if (windowedRows.length > 0) {
        // Windowed data available — bucket by month
        for (const row of windowedRows) {
          const monthKey = String(row['window_start']).substring(0, 7);
          const bucket = ensureBucket(monthKey);

          bucket.triggeredSends += parseFloat(row['Total Email Sends'] || 0) || 0;
          bucket.delivered      += Math.max(0, parseFloat(row['Total Emails Delivered'] || 0) || 0);
          bucket.bounced        += parseFloat(row['Total Emails Bounced'] || 0) || 0;
          bucket.uniqueClicks   += parseFloat(row['Unique Email Clicks'] || 0) || 0;
          bucket.complaints     += parseFloat(row['Total Complaints'] || 0) || 0;
          bucket.unsubscribes   += parseFloat(row['Total Unsubscribes'] || 0) || 0;
        }
      } else {
        // No windowed data — accumulate triggered totals for even distribution later.
        // Triggered campaigns are always-on, so their aggregate sends span the whole
        // reporting window. Bucketing by createdAt puts data in years-old months.
        // Instead, collect totals and distribute evenly across blast months below.
        if (!triggeredPool) triggeredPool = { sends: 0, delivered: 0, bounced: 0, clicks: 0, complaints: 0, unsubs: 0 };
        triggeredPool.sends      += (pc._agg.emailSends || 0) + (pc._agg.pushSends || 0) + (pc._agg.smsSends || 0);
        triggeredPool.delivered  += pc._agg.emailDelivered || 0;
        triggeredPool.bounced    += pc._agg.emailBounced || 0;
        triggeredPool.clicks     += pc._agg.emailUniqueClicks || 0;
        triggeredPool.complaints += pc._agg.emailComplaints || 0;
        triggeredPool.unsubs     += pc._agg.emailUnsubscribes || 0;
      }
    }
  }

  // Distribute accumulated triggered totals evenly across existing month buckets.
  // Triggered campaigns are always-on — their aggregate sends span the full window,
  // so spreading them evenly is the most honest representation without windowed data.
  if (triggeredPool && monthMap.size > 0) {
    const months = Array.from(monthMap.values());
    const n = months.length;
    for (const bucket of months) {
      bucket.triggeredSends += Math.round(triggeredPool.sends / n);
      bucket.delivered      += Math.round(triggeredPool.delivered / n);
      bucket.bounced        += Math.round(triggeredPool.bounced / n);
      bucket.uniqueClicks   += Math.round(triggeredPool.clicks / n);
      bucket.complaints     += Math.round(triggeredPool.complaints / n);
      bucket.unsubscribes   += Math.round(triggeredPool.unsubs / n);
    }
  }

  return Array.from(monthMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(b => {
      const sends = b.blastSends + b.triggeredSends;
      return {
        date: b.date,
        blastSends: b.blastSends,
        triggeredSends: b.triggeredSends,
        sends,
        delivered: b.delivered,
        uniqueClicks: b.uniqueClicks,
        bounceRate: sends > 0 ? (b.bounced / sends) * 100 : null,
        unsubRate: sends > 0 ? (b.unsubscribes / sends) * 100 : null,
        clickRate: b.delivered > 0 ? (b.uniqueClicks / b.delivered) * 100 : null
      };
    });
}

/**
 * Build per-channel time series for trend charts.
 */
function buildTimeSeries(processedCampaigns, finalCampaigns, metricsRows) {
  return buildSendVolumeTrend(processedCampaigns, finalCampaigns, metricsRows);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { run };
