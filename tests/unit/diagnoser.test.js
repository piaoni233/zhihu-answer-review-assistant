import { describe, it, expect } from 'vitest';
import { parseInputBlocks } from '../../src/core/parser.js';
import { computeBatchMetrics } from '../../src/core/calculator.js';
import { diagnoseBatch, evaluateRelativeToMedian } from '../../src/core/diagnoser.js';
import { parseWallDate } from '../../src/core/date.js';
import { ZHIHU_SAMPLE_TEXT, SAMPLE_AS_OF_UTC_MS } from '../../src/core/zhihu-sample.js';
import { roundHalfEvenInt } from '../../src/core/round.js';

const DEFAULT_SETTINGS = {
  ageThresholdDays: 7,
  smallSampleThreshold: 200,
  maskMentionHandles: true,
  aiProviderId: 'deepseek',
  aiModel: 'deepseek-chat',
  rememberApiKey: false,
};

describe('core/diagnoser', () => {
  it('evaluates relative multipliers accurately around 1.50 and 0.67 boundaries', () => {
    expect(evaluateRelativeToMedian(15, 10).level).toBe('high');
    expect(evaluateRelativeToMedian(14.9, 10).level).toBe('normal');
    expect(evaluateRelativeToMedian(6.8, 10).level).toBe('normal');
    expect(evaluateRelativeToMedian(6.7, 10).level).toBe('low');
    expect(evaluateRelativeToMedian(null, 10).level).toBe('na');
    expect(evaluateRelativeToMedian(5, 0).level).toBe('na');
  });

  it('diagnoses built-in Zhihu sample with expected roles, gap 1440, immature flag, and <= 5 actions', () => {
    const parsed = parseInputBlocks(ZHIHU_SAMPLE_TEXT);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: SAMPLE_AS_OF_UTC_MS,
      settings: DEFAULT_SETTINGS,
    });
    const diag = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);

    expect(diag.canRank).toBe(true);
    expect(diag.roles.best?.answerTitle).toContain('Python');
    expect(diag.roles.benchmark?.answerTitle).toContain('远程办公');
    expect(diag.roles.worst?.answerTitle).toContain('软考高项');
    expect(diag.roles.topOpportunity?.answerTitle).toContain('软考高项');
    expect(roundHalfEvenInt(diag.roles.topOpportunity?.potentialGap ?? 0)).toBe(1440);
    expect(diag.roles.worst?.isImmature).toBe(true);
    expect(diag.actions.length).toBeGreaterThanOrEqual(3);
    expect(diag.actions.length).toBeLessThanOrEqual(5);
    expect(diag.actions[0].priority).toBe('立即编辑原回答');
  });

  it('excludes small-sample (<200 views) answers from best/benchmark when normal answers exist', () => {
    const text = `
标题：极小样本超高比率
发布时间：2026-11-10 10:00
阅读：50
赞同：10
收藏：10
评论：5

标题：正常回答甲
发布时间：2026-11-10 10:00
阅读：2000
赞同：100
收藏：120
评论：20

标题：正常回答乙
发布时间：2026-11-10 10:00
阅读：3000
赞同：60
收藏：30
评论：10
    `;
    const parsed = parseInputBlocks(text);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: parseWallDate('2026-11-25 18:00').utcMs,
      settings: DEFAULT_SETTINGS,
    });
    const diag = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);

    // Small sample still ranks #1 by engagementRate (50%), but is NOT selected as best/benchmark
    expect(metrics.ranked[0].raw.title).toBe('极小样本超高比率');
    expect(diag.roles.best?.answerTitle).toBe('正常回答甲');
    expect(diag.roles.benchmark?.answerTitle).toBe('正常回答甲');
    expect(diag.ageAndSampleWarnings.some((w) => w.includes('极小样本超高比率'))).toBe(true);
  });

  it('handles all-tied engagement rates cleanly without forcing a fake worst answer', () => {
    const text = `
标题：并列甲
发布时间：2026-11-10 10:00
阅读：1000
赞同：30
收藏：20
评论：10

标题：并列乙
发布时间：2026-11-11 10:00
阅读：2000
赞同：60
收藏：40
评论：20

标题：并列丙
发布时间：2026-11-12 10:00
阅读：3000
赞同：90
收藏：60
评论：30
    `;
    const parsed = parseInputBlocks(text);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: parseWallDate('2026-11-25 18:00').utcMs,
      settings: DEFAULT_SETTINGS,
    });
    const diag = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);

    expect(diag.allEngagementTied).toBe(true);
    expect(diag.roles.worst).toBeNull();
    expect(diag.roles.topOpportunity).toBeNull();
    expect(diag.roles.best?.tiedTitles).toEqual(['并列乙', '并列丙']);
  });

  it('includes personal history baseline (>=10 answers) and category baseline (>=5 answers)', () => {
    const parsed = parseInputBlocks(ZHIHU_SAMPLE_TEXT);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: SAMPLE_AS_OF_UTC_MS,
      settings: DEFAULT_SETTINGS,
    });
    const historyBaseline = {
      sampleCount: 12,
      medianEngagementRate: 3.25,
      medianUpvoteRate: 1.5,
      medianCollectRate: 1.2,
      medianCommentRate: 0.3,
      byCategory: {
        干货: { sampleCount: 6, medianEngagementRate: 5.5 },
      },
    };
    const diag = diagnoseBatch(metrics, historyBaseline, DEFAULT_SETTINGS);
    expect(diag.historyComparisonNote).toContain('12 篇真实回答');
    expect(diag.historyComparisonNote).toContain('高出 0.75 个百分点');
    expect(diag.perAnswer[0].categoryReferenceNote).toContain('同类型（干货）');
  });

  it('falls back gracefully when fewer than 3 answers are provided', () => {
    const text = `
标题：单篇回答
发布时间：2026-11-15 10:00
阅读：1000
赞同：40
收藏：60
评论：5
    `;
    const parsed = parseInputBlocks(text);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: SAMPLE_AS_OF_UTC_MS,
      settings: DEFAULT_SETTINGS,
    });
    const diag = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);
    expect(diag.canRank).toBe(false);
    expect(diag.roles.best).toBeNull();
    expect(diag.actions.length).toBeGreaterThanOrEqual(1);
    expect(diag.actions.length).toBeLessThanOrEqual(5);
  });
});
