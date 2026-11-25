import { describe, it, expect } from 'vitest';
import { parseInputBlocks } from '../../src/core/parser.js';
import { computeBatchMetrics } from '../../src/core/calculator.js';
import { diagnoseBatch } from '../../src/core/diagnoser.js';
import { buildReportModel, serializeReportToMarkdown } from '../../src/core/report.js';
import { ZHIHU_SAMPLE_TEXT, SAMPLE_AS_OF_UTC_MS, SAMPLE_AI_DIAGNOSIS } from '../../src/core/zhihu-sample.js';
import { ENGINE_VERSION } from '../../src/types.js';

const DEFAULT_SETTINGS = {
  ageThresholdDays: 7,
  smallSampleThreshold: 200,
  maskMentionHandles: true,
  aiProviderId: 'deepseek',
  aiModel: 'deepseek-chat',
  rememberApiKey: false,
};

const FORBIDDEN = ['\u5c0f\u7ea2\u4e66', '\u7b14\u8bb0', '\u5c01\u9762', '\u70b9\u8d5e'];

describe('core/report', () => {
  it('builds consistent ReportModel and Markdown with matching numbers, formulas, disclaimer, and zero forbidden words', () => {
    const parsed = parseInputBlocks(ZHIHU_SAMPLE_TEXT);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: SAMPLE_AS_OF_UTC_MS,
      settings: DEFAULT_SETTINGS,
    });
    const diagnosis = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);
    const model = buildReportModel(metrics, diagnosis, {
      reviewId: 'rev_sample_test',
      createdAtUtcMs: SAMPLE_AS_OF_UTC_MS,
      engineVersion: ENGINE_VERSION,
      isSample: true,
      settings: DEFAULT_SETTINGS,
      deltas: [],
      aiDiagnosis: SAMPLE_AI_DIAGNOSIS,
    });

    const md = serializeReportToMarkdown(model);

    // Numbers match between ReportModel and serialized Markdown
    expect(model.totals.views).toBe(54400);
    expect(model.totals.weightedEngagementRate).toBe('4.00%');
    expect(md).toContain('阅读 54400');
    expect(md).toContain('赞同 928');
    expect(md).toContain('收藏 1008');
    expect(md).toContain('评论 240');
    expect(md).toContain('4.00%');
    expect(md).toContain('赞同率（社区亦称赞阅比）= 赞同 ÷ 阅读 × 100%');
    expect(md).toContain('知乎官方未发布互动率绝对及格线');
    expect(md).toContain('内置示例数据（虚构）');
    expect(md).toContain('AI 示例输出（预先生成，非实时）');
    expect(md).toContain('## 行动建议清单');
    expect(md).toContain('## 增量追踪与下次复盘模板');

    for (const row of model.overviewRows) {
      expect(md).toContain(row.engagementRate);
      expect(md).toContain(row.collectUpvoteRatio);
    }

    // Zero forbidden words
    for (const word of FORBIDDEN) {
      expect(md.includes(word), `Forbidden word "${word}" found in report`).toBe(false);
    }
  });

  it('renders cross-period deltas and <3 answer degradation message cleanly in Markdown', () => {
    const text = `
标题：单篇跟踪回答
发布时间：2026-11-15 10:00
阅读：3000
赞同：120
收藏：90
评论：15
喜欢：20
分享：5
    `;
    const parsed = parseInputBlocks(text);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: SAMPLE_AS_OF_UTC_MS,
      settings: DEFAULT_SETTINGS,
    });
    const diagnosis = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);
    const model = buildReportModel(metrics, diagnosis, {
      reviewId: 'rev_delta_test',
      createdAtUtcMs: SAMPLE_AS_OF_UTC_MS,
      engineVersion: ENGINE_VERSION,
      isSample: false,
      settings: DEFAULT_SETTINGS,
      deltas: [
        {
          title: '单篇跟踪回答',
          publishedDateStr: '2026-11-15',
          prevAsOfDisplay: '2026-11-20 18:00',
          prevAsOfUtcMs: Date.UTC(2026, 10, 20, 18, 0, 0),
          viewsDelta: 1000,
          upvotesDelta: 40,
          collectsDelta: 30,
          commentsDelta: 5,
          incrementalEngagementRate: 7.5,
          hasAnomaly: false,
        },
      ],
    });
    const md = serializeReportToMarkdown(model);
    expect(md).toContain('当前不足 3 篇');
    expect(md).toContain('喜欢 20｜分享 5');
    expect(md).toContain('阅读 +1000');
    expect(md).toContain('期间增量互动率 7.50%');
  });
});
