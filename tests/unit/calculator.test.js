import { describe, it, expect } from 'vitest';
import { calcRate, calcMedian, computeBatchMetrics, computeAnswerDelta } from '../../src/core/calculator.js';
import { parseInputBlocks } from '../../src/core/parser.js';
import { parseWallDate } from '../../src/core/date.js';
import { formatPercent } from '../../src/core/round.js';

describe('core/calculator', () => {
  it('calculates rates with Q3 order and handles zero denominator', () => {
    expect(calcRate(1, 0)).toBeNull();
    expect(formatPercent(calcRate(1, 32))).toBe('3.12%');
  });

  it('calculates medians for odd, even, and empty arrays', () => {
    expect(calcMedian([])).toBeNull();
    expect(calcMedian([null, undefined])).toBeNull();
    expect(calcMedian([10, 2, 6])).toBe(6);
    expect(calcMedian([10, 2, 6, 4])).toBe(5);
  });

  it('preserves input order on ties and places views=0 last (Q5)', () => {
    const text = `
标题：第一篇并列
发布时间：2026-11-10 10:00
阅读：1000
赞同：50
收藏：30
评论：20

标题：零阅读垫底
发布时间：2026-11-11 10:00
阅读：0
赞同：0
收藏：0
评论：0

标题：第二篇并列
发布时间：2026-11-12 10:00
阅读：2000
赞同：100
收藏：60
评论：40
    `;
    const parsed = parseInputBlocks(text, { oracleCompat: true });
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: parseWallDate('2026-11-25 18:00').utcMs,
    });
    expect(metrics.ranked.map((m) => m.raw.title)).toEqual([
      '第一篇并列',
      '第二篇并列',
      '零阅读垫底',
    ]);
    expect(metrics.ranked[2].engagementRate).toBeNull();
    expect(metrics.ranked[2].rank).toBe(3);
  });

  it('detects large age spread correctly', () => {
    const text = `
标题：老回答
发布时间：2026-10-01 10:00
阅读：5000
赞同：100
收藏：100
评论：10

标题：新回答
发布时间：2026-11-24 10:00
阅读：500
赞同：10
收藏：10
评论：1
    `;
    const parsed = parseInputBlocks(text);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: parseWallDate('2026-11-25 18:00').utcMs,
    });
    expect(metrics.timeSpan.hasLargeAgeSpread).toBe(true);
  });

  it('computes cross-period deltas for positive, zero-view, and negative anomaly cases', () => {
    const pos = computeAnswerDelta(
      { views: 1000, upvotes: 40, collects: 30, comments: 5 },
      { views: 2000, upvotes: 80, collects: 70, comments: 15 },
    );
    expect(pos.hasAnomaly).toBe(false);
    expect(pos.viewsDelta).toBe(1000);
    expect(formatPercent(pos.incrementalEngagementRate)).toBe('9.00%');

    const zero = computeAnswerDelta(
      { views: 1000, upvotes: 40, collects: 30, comments: 5 },
      { views: 1000, upvotes: 40, collects: 30, comments: 5 },
    );
    expect(zero.hasAnomaly).toBe(false);
    expect(zero.incrementalEngagementRate).toBeNull();

    const anom = computeAnswerDelta(
      { views: 1000, upvotes: 40, collects: 30, comments: 5 },
      { views: 1200, upvotes: 38, collects: 30, comments: 5 },
    );
    expect(anom.hasAnomaly).toBe(true);
    expect(anom.upvotesDelta).toBe(-2);
    expect(anom.incrementalEngagementRate).toBeNull();
  });
});
