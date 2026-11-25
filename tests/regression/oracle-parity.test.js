import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseInputBlocks } from '../../src/core/parser.js';
import { computeBatchMetrics } from '../../src/core/calculator.js';
import { formatFixedHalfEven, formatPercent } from '../../src/core/round.js';
import { parseWallDate } from '../../src/core/date.js';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures');

describe('Oracle parity regression (D4)', () => {
  const rawZhihuText = fs.readFileSync(path.join(FIXTURES_DIR, 'oracle-zhihu.txt'), 'utf8');
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'oracle-expected.json'), 'utf8'));

  it('matches Python oracle verbatim on totals, weighted rate, per-item rates, ratios, ranking, span, and spread', () => {
    const parsed = parseInputBlocks(rawZhihuText);
    expect(parsed.blockingErrors).toHaveLength(0);
    expect(parsed.items).toHaveLength(3);

    const asOfUtcMs = parseWallDate('2026-11-25 18:00').utcMs;
    const metrics = computeBatchMetrics(parsed.items, { asOfUtcMs });

    // Totals: 49200 / 2630 / 2130 / 414 / 5174
    expect(metrics.totals.views).toBe(expected.totals.views);
    expect(metrics.totals.upvotes).toBe(expected.totals.upvotes);
    expect(metrics.totals.collects).toBe(expected.totals.collects);
    expect(metrics.totals.comments).toBe(expected.totals.comments);
    expect(metrics.totals.interactions).toBe(expected.totals.interactions);

    // Weighted engagement rate: 10.52%
    expect(formatPercent(metrics.weightedEngagementRate)).toBe(expected.weightedEngagementRate);

    // Per-item sub-rates and collect/upvote ratios
    metrics.items.forEach((m, idx) => {
      const exp = expected.items[idx];
      expect(m.raw.title).toBe(exp.title);
      expect(formatPercent(m.upvoteRate)).toBe(exp.upvoteRate);
      expect(formatPercent(m.collectRate)).toBe(exp.collectRate);
      expect(formatPercent(m.commentRate)).toBe(exp.commentRate);
      expect(formatPercent(m.engagementRate)).toBe(exp.engagementRate);
      expect(formatFixedHalfEven(m.collectUpvoteRatio, 2)).toBe(exp.collectUpvoteRatio);
    });

    // Ranked engagement rates: 13.05% / 12.27% / 7.57%
    expect(metrics.ranked.map((m) => formatPercent(m.engagementRate))).toEqual(expected.rankedEngagementRates);
    expect(metrics.ranked.map((m) => formatFixedHalfEven(m.collectUpvoteRatio, 2))).toEqual(
      expected.rankedCollectUpvoteRatios,
    );

    // Date span: 5 days (2026-11-16 to 2026-11-21)
    expect(metrics.timeSpan.spanDays).toBe(expected.spanDays);
    expect(metrics.timeSpan.earliestDate).toBe(expected.earliestDate);
    expect(metrics.timeSpan.latestDate).toBe(expected.latestDate);

    // Best - worst spread: 5.48 percentage points
    const spreadPp = metrics.ranked[0].engagementRate - metrics.ranked[metrics.ranked.length - 1].engagementRate;
    expect(formatFixedHalfEven(spreadPp, 2)).toBe(expected.engagementSpreadPp);
  });

  it('skips bad blocks with warnings in oracleCompat mode (Q8) while preserving valid oracle items', () => {
    const combined = `${rawZhihuText}\n\n---\n标题：坏块缺少收藏\n发布时间：2026-11-22 10:00\n阅读：500\n赞同：10\n评论：2`;
    const parsed = parseInputBlocks(combined, { oracleCompat: true });
    expect(parsed.items).toHaveLength(3);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0].code).toBe('MISSING_REQUIRED_FIELDS');
  });
});
