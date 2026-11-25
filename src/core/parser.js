// @ts-check

import { roundHalfEvenInt } from './round.js';
import { parseWallDate } from './date.js';

/**
 * 块切分、标签别名解析（含 D5 白名单）、数字解析、隐私打码。
 */

/** @type {Record<string, import('../types.js').CanonicalField>} */
export const FIELD_ALIASES = {
  标题: 'title',
  题目: 'title',
  问题: 'title',
  问题标题: 'title',
  回答标题: 'title',
  回答: 'title',

  发布时间: 'published',
  发布日期: 'published',
  发布: 'published',
  日期: 'published',

  阅读量: 'views',
  阅读: 'views',
  阅读数: 'views',
  浏览量: 'views',
  浏览: 'views',

  赞同: 'upvotes',
  赞同数: 'upvotes',
  获赞同: 'upvotes',
  点赞: 'upvotes', // D5-WHITELIST
  赞: 'upvotes', // D5-WHITELIST

  收藏: 'collects',
  收藏数: 'collects',

  评论: 'comments',
  评论数: 'comments',

  喜欢: 'endorseLikes',
  喜欢数: 'endorseLikes',

  分享: 'shares',
  分享数: 'shares',

  类型: 'categoryTag',
  回答类型: 'categoryTag',
  分类: 'categoryTag',
  标签: 'categoryTag',
};

/** @type {Set<string>} */
const D5_NON_STANDARD_UPVOTE_LABELS = new Set([
  '点赞', // D5-WHITELIST
  '赞', // D5-WHITELIST
]);

/** @type {Record<string, string>} */
export const FIELD_DISPLAY_NAMES = {
  title: '问题标题',
  published: '发布时间',
  views: '阅读',
  upvotes: '赞同',
  collects: '收藏',
  comments: '评论',
  endorseLikes: '喜欢',
  shares: '分享',
  categoryTag: '回答类型',
};

/** @type {Array<'title'|'published'|'views'|'upvotes'|'collects'|'comments'>} */
const REQUIRED_FIELDS = ['title', 'published', 'views', 'upvotes', 'collects', 'comments'];

const BLOCK_SEPARATOR_RE = /^(---|===|\*\*\*)$/;
const COMMENT_SECTION_RE = /^(代表性评论|评论示例|典型评论)[：:]\s*(.*)$/;
const LABEL_LINE_RE = /^([^：:]{1,12})[：:]\s*(.+)$/;
const COMMENT_BULLET_RE = /^[-•·]\s*/;

const FUZZY_OR_EN_UNIT_RE = /[+＋]|(?:^|\d)\s*[wWkK]$|约|左右|大概|余/;
const STRICT_NUMBER_RE = /^([0-9]+(?:\.[0-9]+)?)\s*(万|千)?$/;

const MAX_SAFE_VALUE = 9e15;

/**
 * 解析知乎粘贴数字（支持千分位逗号、万/千单位，使用半偶舍入取整）。
 * @param {string} text
 * @returns {number}
 */
export function parseZhihuNumber(text) {
  if (typeof text !== 'string') {
    throw new Error('数值必须为非负数字，可带千分位逗号或“万/千”单位');
  }
  const cleaned = text.trim().replace(/[,，]/g, '');
  if (!cleaned) {
    throw new Error('数值必须为非负数字，可带千分位逗号或“万/千”单位');
  }

  if (FUZZY_OR_EN_UNIT_RE.test(cleaned)) {
    throw new Error('不支持模糊估算或英文简写单位（如“10万+”、“1.2w”），请改为精确数字或使用“万/千”');
  }

  const m = STRICT_NUMBER_RE.exec(cleaned);
  if (!m) {
    throw new Error('数值必须为非负数字，可带千分位逗号或“万/千”单位');
  }

  let value = Number.parseFloat(m[1]);
  if (m[2] === '万') {
    value *= 10000;
  } else if (m[2] === '千') {
    value *= 1000;
  }

  if (!Number.isFinite(value) || value > MAX_SAFE_VALUE) {
    throw new Error('数字超出合理范围，请核对是否误贴');
  }

  return roundHalfEvenInt(value);
}

/**
 * 对代表性评论执行隐私脱敏（手机号、邮箱、身份证号、可选 @昵称）。
 * @param {string} text
 * @param {boolean} [maskHandles=true]
 * @returns {string}
 */
export function maskSensitiveText(text, maskHandles = true) {
  if (typeof text !== 'string' || !text) return '';
  let masked = text;
  // 1. 15/18 位身份证号（先于手机号避免长串数字局部误伤）
  masked = masked.replace(/(?<!\d)([1-9]\d{3})\d{7,10}(\d{3}[\dXx])(?!\d)/g, '$1********$2');
  // 2. 中国大陆手机号
  masked = masked.replace(/(?<!\d)(1[3-9]\d)(\d{4})(\d{4})(?!\d)/g, '$1****$3');
  // 3. 邮箱地址
  masked = masked.replace(/([a-zA-Z0-9._%+-]{1,2})[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '$1***$2');
  // 4. @用户昵称（排除邮箱域名中的 @）
  if (maskHandles) {
    masked = masked.replace(/(?<![a-zA-Z0-9._%+*-])@([^\s:：,，。!！?？/()（）]{1,24})/g, '@[用户]');
  }
  return masked;
}

/**
 * 规范化标题，用于同名回答跨期匹配。
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  return String(title || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[？?！!。.]$/, '');
}

/**
 * 解析粘贴文本为结构化回答记录（附块号、行号与逐条提示）。
 * @param {string} rawText
 * @param {{oracleCompat?:boolean, maskHandles?:boolean}} [options]
 * @returns {import('../types.js').ParseResult}
 */
export function parseInputBlocks(rawText, options = {}) {
  const { oracleCompat = false, maskHandles = true } = options;

  /** @type {import('../types.js').ParsedAnswer[]} */
  const items = [];
  /** @type {import('../types.js').ParseIssue[]} */
  const blockingErrors = [];
  /** @type {import('../types.js').ParseIssue[]} */
  const warnings = [];
  /** @type {import('../types.js').ParseIssue[]} */
  const notices = [];

  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { items, blockingErrors, warnings, notices, totalBlocks: 0 };
  }

  const rawLines = rawText.replace(/\r\n?/g, '\n').split('\n');

  /** @type {Array<{startLine:number, lines:Array<{lineNo:number, text:string}>}>} */
  const blocks = [];
  /** @type {Array<{lineNo:number, text:string}>} */
  let currentLines = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const lineNo = i + 1;
    const text = rawLines[i];
    const trimmed = text.trim();
    if (!trimmed || BLOCK_SEPARATOR_RE.test(trimmed)) {
      if (currentLines.length > 0) {
        blocks.push({ startLine: currentLines[0].lineNo, lines: currentLines });
        currentLines = [];
      }
    } else {
      currentLines.push({ lineNo, text });
    }
  }
  if (currentLines.length > 0) {
    blocks.push({ startLine: currentLines[0].lineNo, lines: currentLines });
  }

  const pushFailure = (issue) => {
    if (oracleCompat) {
      warnings.push({ ...issue, severity: 'warning' });
    } else {
      blockingErrors.push({ ...issue, severity: 'error' });
    }
  };

  for (let bIdx = 0; bIdx < blocks.length; bIdx += 1) {
    const block = blocks[bIdx];
    const blockIndex = bIdx + 1;

    /** @type {Record<string, string>} */
    const rawFields = {};
    /** @type {Record<string, number>} */
    const fieldLines = {};
    /** @type {Record<string, string>} */
    const fieldLabels = {};
    /** @type {string[]} */
    const commentsText = [];
    /** @type {Array<{lineNo:number, label:string, type:'d5'|'unknown'}>} */
    const blockNotices = [];

    let inCommentSection = false;

    for (const { lineNo, text } of block.lines) {
      const stripped = text.trim();

      if (!inCommentSection) {
        const cm = COMMENT_SECTION_RE.exec(stripped);
        if (cm) {
          inCommentSection = true;
          const trailing = cm[2].trim().replace(COMMENT_BULLET_RE, '').trim();
          if (trailing) {
            commentsText.push(trailing);
          }
          continue;
        }
      }

      if (inCommentSection) {
        const commentItem = stripped.replace(COMMENT_BULLET_RE, '').trim();
        if (commentItem) {
          commentsText.push(commentItem);
        }
        continue;
      }

      const lm = LABEL_LINE_RE.exec(stripped);
      if (!lm) {
        continue;
      }

      const label = lm[1].trim();
      const value = lm[2].trim();
      const canonical = FIELD_ALIASES[label];

      if (!canonical) {
        blockNotices.push({ lineNo, label, type: 'unknown' });
        continue;
      }

      if (D5_NON_STANDARD_UPVOTE_LABELS.has(label)) {
        blockNotices.push({ lineNo, label, type: 'd5' });
      }

      rawFields[canonical] = value;
      fieldLines[canonical] = lineNo;
      fieldLabels[canonical] = label;
    }

    const titleDisplay = rawFields.title || `未命名第 ${blockIndex} 篇`;

    for (const bn of blockNotices) {
      if (bn.type === 'd5') {
        notices.push({
          severity: 'notice',
          code: 'D5_ALIAS_MAPPED',
          blockIndex,
          startLine: block.startLine,
          line: bn.lineNo,
          message: `第 ${blockIndex} 篇《${titleDisplay}》第 ${bn.lineNo} 行：检测到非知乎标准字段名，已自动按“赞同”口径计算。`,
          fixHint: '建议后续记录时直接写“赞同：数值”。',
        });
      } else {
        notices.push({
          severity: 'notice',
          code: 'UNKNOWN_FIELD',
          blockIndex,
          startLine: block.startLine,
          line: bn.lineNo,
          fieldLabel: bn.label,
          message: `第 ${blockIndex} 篇《${titleDisplay}》第 ${bn.lineNo} 行：未识别字段“${bn.label}”，已忽略。`,
          fixHint: '若为笔误，请对照支持标签名修改。',
        });
      }
    }

    // 必填项：标题优先检查
    if (!rawFields.title) {
      pushFailure({
        severity: 'error',
        code: 'MISSING_TITLE',
        blockIndex,
        startLine: block.startLine,
        line: block.startLine,
        message: `第 ${blockIndex} 篇（第 ${block.startLine} 行附近）：缺少问题标题，无法识别该篇回答。`,
        fixHint: '请在该块开头补充一行“标题：你的问题标题”。',
      });
      continue;
    }

    const missingFields = REQUIRED_FIELDS.filter((f) => !(f in rawFields));
    if (missingFields.length > 0) {
      const missingZh = missingFields.map((f) => FIELD_DISPLAY_NAMES[f]).join('、');
      pushFailure({
        severity: 'error',
        code: 'MISSING_REQUIRED_FIELDS',
        blockIndex,
        startLine: block.startLine,
        line: block.startLine,
        message: `第 ${blockIndex} 篇《${rawFields.title}》（第 ${block.startLine} 行）：缺少必填项【${missingZh}】。`,
        fixHint: '请补全上述字段后再生成报告；若某项为 0，请明确填写“0”。',
      });
      continue;
    }

    // 数字字段解析
    /** @type {Record<string, number>} */
    const numericValues = {};
    let blockHasNumberError = false;
    /** @type {Array<'views'|'upvotes'|'collects'|'comments'|'endorseLikes'|'shares'>} */
    const numericFields = ['views', 'upvotes', 'collects', 'comments', 'endorseLikes', 'shares'];

    for (const f of numericFields) {
      if (!(f in rawFields)) continue;
      try {
        numericValues[f] = parseZhihuNumber(rawFields[f]);
      } catch (err) {
        blockHasNumberError = true;
        const fieldName = FIELD_DISPLAY_NAMES[f];
        const line = fieldLines[f] ?? block.startLine;
        const detail = err instanceof Error ? err.message : '格式不正确';
        pushFailure({
          severity: 'error',
          code: 'INVALID_NUMBER',
          blockIndex,
          startLine: block.startLine,
          line,
          fieldLabel: fieldLabels[f],
          message: `第 ${blockIndex} 篇《${rawFields.title}》第 ${line} 行：【${fieldName}】的数值“${rawFields[f]}”无法识别（${detail}）。`,
          fixHint: '请改为非负整数或“1.2万 / 3千 / 18,200”格式，勿填写“10万+”或“1.2w”等估算值。',
        });
        if (oracleCompat) break;
      }
    }

    if (blockHasNumberError) {
      continue;
    }

    // 日期解析
    const parsedDate = parseWallDate(rawFields.published);
    if (!parsedDate && !oracleCompat) {
      const line = fieldLines.published ?? block.startLine;
      pushFailure({
        severity: 'error',
        code: 'INVALID_DATE',
        blockIndex,
        startLine: block.startLine,
        line,
        fieldLabel: fieldLabels.published,
        message: `第 ${blockIndex} 篇《${rawFields.title}》第 ${line} 行：发布时间“${rawFields.published}”无法解析。`,
        fixHint: '请使用“YYYY-MM-DD HH:mm”或“YYYY-MM-DD”格式（例如 2026-11-16 12:00），暂不支持无年份或相对时间。',
      });
      continue;
    }

    if (commentsText.length > 5) {
      notices.push({
        severity: 'notice',
        code: 'TOO_MANY_COMMENTS',
        blockIndex,
        startLine: block.startLine,
        line: block.startLine,
        message: `第 ${blockIndex} 篇《${rawFields.title}》粘贴了 ${commentsText.length} 条评论，建议控制在 5 条代表性评论以内（当前已全部保留分析）。`,
      });
    }

    const maskedCommentsText = commentsText.map((c) => maskSensitiveText(c, maskHandles));

    items.push({
      blockIndex,
      startLine: block.startLine,
      fieldLines,
      title: rawFields.title,
      publishedRaw: rawFields.published,
      publishedUtcMs: parsedDate ? parsedDate.utcMs : null,
      publishedDateStr: parsedDate ? parsedDate.dateStr : null,
      views: numericValues.views,
      upvotes: numericValues.upvotes,
      collects: numericValues.collects,
      comments: numericValues.comments,
      endorseLikes: 'endorseLikes' in numericValues ? numericValues.endorseLikes : null,
      shares: 'shares' in numericValues ? numericValues.shares : null,
      categoryTag: rawFields.categoryTag ? rawFields.categoryTag.trim() : null,
      commentsText,
      maskedCommentsText,
    });
  }

  return {
    items,
    blockingErrors,
    warnings,
    notices,
    totalBlocks: blocks.length,
  };
}
