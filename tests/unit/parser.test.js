import { describe, it, expect } from 'vitest';
import {
  parseZhihuNumber,
  maskSensitiveText,
  normalizeTitle,
  parseInputBlocks,
} from '../../src/core/parser.js';

describe('core/parser', () => {
  it('parses valid integers, commas, Chinese units, and applies half-even rounding', () => {
    expect(parseZhihuNumber('0')).toBe(0);
    expect(parseZhihuNumber('18200')).toBe(18200);
    expect(parseZhihuNumber('18,200')).toBe(18200);
    expect(parseZhihuNumber('18，200')).toBe(18200);
    expect(parseZhihuNumber('1.2万')).toBe(12000);
    expect(parseZhihuNumber('3千')).toBe(3000);
    expect(parseZhihuNumber('1.25千')).toBe(1250);
    expect(parseZhihuNumber('12.5')).toBe(12);
    expect(parseZhihuNumber('13.5')).toBe(14);
  });

  it('rejects fuzzy quantities, English shorthand, negatives, non-numbers, and overflow', () => {
    expect(() => parseZhihuNumber('10万+')).toThrow(/模糊估算|英文简写/);
    expect(() => parseZhihuNumber('1.2w')).toThrow(/模糊估算|英文简写/);
    expect(() => parseZhihuNumber('1k')).toThrow(/模糊估算|英文简写/);
    expect(() => parseZhihuNumber('约2万')).toThrow(/模糊估算|英文简写/);
    expect(() => parseZhihuNumber('-5')).toThrow(/非负数字/);
    expect(() => parseZhihuNumber('暂无')).toThrow(/非负数字/);
    expect(() => parseZhihuNumber('--')).toThrow(/非负数字/);
    expect(() => parseZhihuNumber('999999999999999999')).toThrow(/合理范围/);
  });

  it('masks phones, emails, ID cards, and optional @mentions without mangling emails', () => {
    const raw = '联系我 13812345678 或 alice.wang@example.com 证件 11010519900101123X，回复 @张三 看看';
    const masked = maskSensitiveText(raw, true);
    expect(masked).toContain('138****5678');
    expect(masked).toContain('al***@example.com');
    expect(masked).toContain('1101********123X');
    expect(masked).toContain('@[用户]');
    expect(masked).not.toContain('13812345678');
    expect(masked).not.toContain('张三');

    const keepMention = maskSensitiveText('同意 @李四 的观点', false);
    expect(keepMention).toBe('同意 @李四 的观点');
  });

  it('supports all Zhihu aliases, colons inside titles (Q7), and comment swallowing (Q6)', () => {
    const text = `
问题标题：如何评价：2026 年的开发者工具？
发布日期：2026/11/16 12:00
浏览量：1.2万
获赞同：360
收藏数：540
评论数：42
喜欢：88
分享：15
回答类型：干货
代表性评论：
- 写得很透彻
阅读量：99999
• 请问有没有参考链接？
    `;
    const res = parseInputBlocks(text);
    expect(res.blockingErrors).toHaveLength(0);
    expect(res.items).toHaveLength(1);
    const item = res.items[0];
    expect(item.title).toBe('如何评价：2026 年的开发者工具？');
    expect(item.views).toBe(12000);
    expect(item.upvotes).toBe(360);
    expect(item.collects).toBe(540);
    expect(item.comments).toBe(42);
    expect(item.endorseLikes).toBe(88);
    expect(item.shares).toBe(15);
    expect(item.categoryTag).toBe('干货');
    // Q6: lines after 代表性评论： belong to comments even if formatted like 阅读量：99999
    expect(item.commentsText).toEqual(['写得很透彻', '阅读量：99999', '请问有没有参考链接？']);
  });

  it('D5: accepts non-standard upvote alias silently into upvotes and emits clean notice without forbidden wording', () => {
    const text = `
标题：测试 D5 兼容别名
发布时间：2026-11-16 12:00
阅读：5000
点赞：200
收藏：100
评论：20
    `;
    const res = parseInputBlocks(text);
    expect(res.blockingErrors).toHaveLength(0);
    expect(res.items[0].upvotes).toBe(200);
    const d5Notice = res.notices.find((n) => n.code === 'D5_ALIAS_MAPPED');
    expect(d5Notice).toBeDefined();
    expect(d5Notice.message).toContain('非知乎标准字段名');
    expect(d5Notice.message).toContain('赞同');
    expect(d5Notice.message).not.toContain('点赞');
  });

  it('reports exact block/line errors in UI mode and skips with warnings in oracleCompat mode (Q8)', () => {
    const badText = `
标题：缺字段的一篇
发布时间：2026-11-16 12:00
阅读：1000

---
标题：数字非法的一篇
发布时间：2026-11-16 12:00
阅读：10万+
赞同：50
收藏：20
评论：5

---
发布时间：2026-11-16 12:00
阅读：1000
赞同：10
收藏：5
评论：2

---
标题：正常的一篇
发布时间：2026-11-16 12:00
阅读：2000
赞同：100
收藏：80
评论：10
    `;

    const uiRes = parseInputBlocks(badText);
    expect(uiRes.items).toHaveLength(1);
    expect(uiRes.blockingErrors.map((e) => e.code)).toEqual([
      'MISSING_REQUIRED_FIELDS',
      'INVALID_NUMBER',
      'MISSING_TITLE',
    ]);
    expect(uiRes.blockingErrors[1].line).toBe(9);

    const compatRes = parseInputBlocks(badText, { oracleCompat: true });
    expect(compatRes.items).toHaveLength(1);
    expect(compatRes.blockingErrors).toHaveLength(0);
    expect(compatRes.warnings).toHaveLength(3);
  });

  it('normalizes titles consistently for cross-period matching', () => {
    expect(normalizeTitle('  为什么  学完语法还是不会写？ ')).toBe('为什么 学完语法还是不会写');
    expect(normalizeTitle('为什么 学完语法还是不会写?')).toBe('为什么 学完语法还是不会写');
  });

  it('reports invalid date, unknown field notices, and >5 comments notice accurately', () => {
    const text = `
标题：日期非法与多评论测试
发布时间：昨天 12:00
阅读：1000
赞同：20
收藏：10
评论：5
未知列：随便写

---
标题：超过五条评论测试
发布时间：2026-11-16 12:00
阅读：1000
赞同：20
收藏：10
评论：6
代表性评论：第一条紧跟冒号
- 第二条
- 第三条
- 第四条
- 第五条
- 第六条
    `;
    const res = parseInputBlocks(text);
    expect(res.blockingErrors.some((e) => e.code === 'INVALID_DATE')).toBe(true);
    expect(res.notices.some((n) => n.code === 'UNKNOWN_FIELD')).toBe(true);
    expect(res.notices.some((n) => n.code === 'TOO_MANY_COMMENTS')).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].commentsText).toHaveLength(6);
  });
});
