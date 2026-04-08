'use strict';

/**
 * Unit tests for campaign filtering logic in fetch-campaigns.js.
 *
 * Tests the 4-layer filtering:
 *   Layer 1: state eligibility (Running or Finished)
 *   Layer 2a (blast): state=Finished, type=Blast, sendSize>100, date in range
 *   Layer 2b (triggered): state=Running, type=Triggered, has workflowId, optional workflow gating
 */

const { describe, it, expect } = require('bun:test');
const { filterBlastCampaigns, filterTriggeredCampaigns } = require('../lib/fetch-campaigns');

// ---------------------------------------------------------------------------
// filterBlastCampaigns
// ---------------------------------------------------------------------------

describe('filterBlastCampaigns', () => {
  // Date range for all blast tests
  const startDate = new Date('2026-01-01');
  const endDate = new Date('2026-03-31');

  // Valid blast campaign factory
  const validBlast = {
    id: 1001,
    campaignState: 'Finished',
    type: 'Blast',
    sendSize: 500,
    startAt: new Date('2026-02-15').getTime()
  };

  it('accepts Finished Blast campaigns with sendSize > 100 in date range', () => {
    const result = filterBlastCampaigns([validBlast], startDate, endDate);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(1001);
  });

  it('rejects campaigns with sendSize <= 100', () => {
    const result = filterBlastCampaigns(
      [{ ...validBlast, sendSize: 50 }],
      startDate,
      endDate
    );
    expect(result.length).toBe(0);
  });

  it('rejects campaigns with sendSize exactly 100', () => {
    const result = filterBlastCampaigns(
      [{ ...validBlast, sendSize: 100 }],
      startDate,
      endDate
    );
    expect(result.length).toBe(0);
  });

  it('rejects campaigns outside date range (too early)', () => {
    const result = filterBlastCampaigns(
      [{ ...validBlast, startAt: new Date('2025-06-01').getTime() }],
      startDate,
      endDate
    );
    expect(result.length).toBe(0);
  });

  it('rejects campaigns outside date range (too late)', () => {
    const result = filterBlastCampaigns(
      [{ ...validBlast, startAt: new Date('2026-06-01').getTime() }],
      startDate,
      endDate
    );
    expect(result.length).toBe(0);
  });

  it('rejects non-Finished state', () => {
    const result = filterBlastCampaigns(
      [{ ...validBlast, campaignState: 'Running' }],
      startDate,
      endDate
    );
    expect(result.length).toBe(0);
  });

  it('rejects non-Blast type', () => {
    const result = filterBlastCampaigns(
      [{ ...validBlast, type: 'Triggered' }],
      startDate,
      endDate
    );
    expect(result.length).toBe(0);
  });

  it('rejects campaigns with no date (null startAt and null createdAt)', () => {
    const result = filterBlastCampaigns(
      [{ ...validBlast, startAt: null, createdAt: null }],
      startDate,
      endDate
    );
    expect(result.length).toBe(0);
  });

  it('uses createdAt as fallback when startAt is missing', () => {
    const result = filterBlastCampaigns(
      [{ ...validBlast, startAt: null, createdAt: new Date('2026-02-15').getTime() }],
      startDate,
      endDate
    );
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(1001);
  });

  it('handles empty input array', () => {
    const result = filterBlastCampaigns([], startDate, endDate);
    expect(result.length).toBe(0);
  });

  it('accepts multiple valid blast campaigns', () => {
    const campaigns = [
      { ...validBlast, id: 1001, startAt: new Date('2026-01-10').getTime() },
      { ...validBlast, id: 1002, startAt: new Date('2026-02-20').getTime() },
      { ...validBlast, id: 1003, startAt: new Date('2026-03-01').getTime() }
    ];
    const result = filterBlastCampaigns(campaigns, startDate, endDate);
    expect(result.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// filterTriggeredCampaigns
// ---------------------------------------------------------------------------

describe('filterTriggeredCampaigns', () => {
  // Valid triggered campaign factory
  const validTriggered = {
    id: 2001,
    campaignState: 'Running',
    type: 'Triggered',
    workflowId: 9001
  };

  it('accepts Running Triggered campaigns with workflowId', () => {
    const result = filterTriggeredCampaigns([validTriggered], null);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(2001);
  });

  it('rejects missing workflowId (null)', () => {
    const result = filterTriggeredCampaigns(
      [{ ...validTriggered, workflowId: null }],
      null
    );
    expect(result.length).toBe(0);
  });

  it('rejects missing workflowId (undefined)', () => {
    const { workflowId, ...noWorkflow } = validTriggered;
    const result = filterTriggeredCampaigns([noWorkflow], null);
    expect(result.length).toBe(0);
  });

  it('rejects non-Running state', () => {
    const result = filterTriggeredCampaigns(
      [{ ...validTriggered, campaignState: 'Finished' }],
      null
    );
    expect(result.length).toBe(0);
  });

  it('rejects non-Triggered type', () => {
    const result = filterTriggeredCampaigns(
      [{ ...validTriggered, type: 'Blast' }],
      null
    );
    expect(result.length).toBe(0);
  });

  it('filters by activeWorkflowIds when provided — returns only matching', () => {
    const campaigns = [
      validTriggered,
      { ...validTriggered, id: 2002, workflowId: 9999 }
    ];
    const activeWorkflowIds = new Set([9001]);
    const result = filterTriggeredCampaigns(campaigns, activeWorkflowIds);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(2001);
  });

  it('accepts all when activeWorkflowIds is null', () => {
    const campaigns = [
      validTriggered,
      { ...validTriggered, id: 2002, workflowId: 9999 }
    ];
    const result = filterTriggeredCampaigns(campaigns, null);
    expect(result.length).toBe(2);
  });

  it('handles empty input array', () => {
    const result = filterTriggeredCampaigns([], null);
    expect(result.length).toBe(0);
  });

  it('rejects campaigns not in activeWorkflowIds set', () => {
    const activeWorkflowIds = new Set([8000, 8001]); // does not include 9001
    const result = filterTriggeredCampaigns([validTriggered], activeWorkflowIds);
    expect(result.length).toBe(0);
  });

  it('accepts multiple triggered campaigns when all match activeWorkflowIds', () => {
    const campaigns = [
      { ...validTriggered, id: 2001, workflowId: 9001 },
      { ...validTriggered, id: 2002, workflowId: 9002 },
      { ...validTriggered, id: 2003, workflowId: 9003 }
    ];
    const activeWorkflowIds = new Set([9001, 9002, 9003]);
    const result = filterTriggeredCampaigns(campaigns, activeWorkflowIds);
    expect(result.length).toBe(3);
  });
});
