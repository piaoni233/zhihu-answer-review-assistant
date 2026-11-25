import { describe, it, expect } from 'vitest';
import { parseInputBlocks } from '../../src/core/parser.js';
import { validateBatch } from '../../src/core/validator.js';
import { parseWallDate } from '../../src/core/date.js';

const DEFAULT_SETTINGS = {
  ageThresholdDays: 7,
  smallSampleThreshold: 200,
  maskMentionHandles: true,
  aiProviderId: 'deepseek',
  aiModel: 'deepseek-chat',
  rememberApiKey: false,
};

const AS_OF = parseWallDate('2026-11-25 18:00').utcMs;

describe('core/validator', () => {
  it('blocks empty input with clear Chinese guidance', () => {
    const parsed = parseInputBlocks('   \n\n  ');
    const val = validateBatch(parsed, DEFAULT_SETTINGS, AS_OF);
    expect(val.canGenerate).toBe(false);
    expect(val.blockingErrors[0].code).toBe('EMPTY_INPUT');
  });

  it('blocks views === 0 and points to the exact block and line', () => {
    const text = `标题：零阅读测试
发布时间：2026-11-20 10:00
阅读：0
赞同：0
收藏：0
评论：0`;
    const parsed = parseInputBlocks(text);
    const val = validateBatch(parsed, DEFAULT_SETTINGS, AS_OF);
    expect(val.canGenerate).toBe(false);
    const err = val.blockingErrors.find((e) => e.code === 'ZERO_VIEWS');
    expect(err).toBeDefined();
    expect(err.blockIndex).toBe(1);
    expect(err.line).toBe(3);
  });

  it('blocks when asOfUtcMs is earlier than published time', () => {
    const text = `标题：未来发布回答
发布时间：2026-11-26 10:00
阅读：1000
赞同：10
收藏：5
评论：2`;
    const parsed = parseInputBlocks(text);
    const val = validateBatch(parsed, DEFAULT_SETTINGS, AS_OF);
    expect(val.canGenerate).toBe(false);
    expect(val.blockingErrors[0].code).toBe('AS_OF_BEFORE_PUBLISHED');
  });

  it('flags soft warning and needsConfirmation when upvotes/collects/comments exceed views', () => {
    const text = `标题：异常高赞同
发布时间：2026-11-20 10:00
阅读：100
赞同：120
收藏：150
评论：10`;
    const parsed = parseInputBlocks(text);
    const val = validateBatch(parsed, DEFAULT_SETTINGS, AS_OF);
    expect(val.canGenerate).toBe(true);
    expect(val.needsConfirmation).toBe(true);
    expect(val.softWarnings).toHaveLength(2);
    expect(val.softWarnings[0].code).toBe('INTERACTION_EXCEEDS_VIEWS');
  });

  it('degrades to no-ranking mode with notice when fewer than 3 answers', () => {
    const text = `标题：回答一
发布时间：2026-11-18 10:00
阅读：1000
赞同：50
收藏：30
评论：5

标题：回答二
发布时间：2026-11-19 10:00
阅读：2000
赞同：60
收藏：40
评论：10`;
    const parsed = parseInputBlocks(text);
    const val = validateBatch(parsed, DEFAULT_SETTINGS, AS_OF);
    expect(val.canGenerate).toBe(true);
    expect(val.canRank).toBe(false);
    expect(val.notices.some((n) => n.code === 'FEWER_THAN_THREE')).toBe(true);
  });
});
