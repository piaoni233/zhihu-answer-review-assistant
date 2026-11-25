import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { classifyZhihuComment, analyzeComments } from '../../src/core/comments.js';

const CORPUS_PATH = path.resolve(process.cwd(), 'tests/fixtures/comment-corpus.json');
const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));

describe('core/comments', () => {
  it('verifies corpus has >= 10 entries for each of the 5 Zhihu categories', () => {
    expect(corpus.question_doubt.length).toBeGreaterThanOrEqual(10);
    expect(corpus.follow_up.length).toBeGreaterThanOrEqual(10);
    expect(corpus.urge_update.length).toBeGreaterThanOrEqual(10);
    expect(corpus.bookmark_mark.length).toBeGreaterThanOrEqual(10);
    expect(corpus.endorsement.length).toBeGreaterThanOrEqual(10);
  });

  it('classifies all 50+ Zhihu comment corpus sentences accurately', () => {
    for (const [expectedCategory, sentences] of Object.entries(corpus)) {
      for (const text of sentences) {
        expect(classifyZhihuComment(text), `Sentence: "${text}"`).toBe(expectedCategory);
      }
    }
  });

  it('enforces priority: question_doubt beats follow_up (e.g., "来源？", "数据呢？")', () => {
    expect(classifyZhihuComment('来源？')).toBe('question_doubt');
    expect(classifyZhihuComment('数据呢？')).toBe('question_doubt');
    expect(classifyZhihuComment('你确定吗？')).toBe('question_doubt');
    expect(classifyZhihuComment('请问这个结论有依据吗？')).toBe('question_doubt');
  });

  it('analyzes a batch of comments and maintains exact category sum', () => {
    const sample = [
      '这个通过率数据来源是什么？',
      '请问适合零基础吗？',
      '蹲一个后续模板',
      '已收藏，周末看',
      '讲透了，很受教',
      '打卡',
      '',
    ];
    const res = analyzeComments(sample);
    expect(res.total).toBe(6);
    const sum = Object.values(res.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(res.total);
    expect(res.counts.question_doubt).toBe(1);
    expect(res.counts.follow_up).toBe(1);
    expect(res.counts.urge_update).toBe(1);
    expect(res.counts.bookmark_mark).toBe(1);
    expect(res.counts.endorsement).toBe(1);
    expect(res.counts.unclassified).toBe(1);
  });
});
