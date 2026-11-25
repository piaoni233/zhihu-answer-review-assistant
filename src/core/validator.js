// @ts-check

import { formatUtcMinute } from './date.js';

/**
 * 批量校验器：阻断错误、软警示（互动 > 阅读）、不足 3 篇状态降级、截至时间早于发布时间。
 */

/**
 * @param {import('../types.js').ParseResult} parseResult
 * @param {import('../types.js').Settings} _settings
 * @param {number|null} [asOfUtcMs=null]
 * @returns {import('../types.js').ValidationResult}
 */
export function validateBatch(parseResult, _settings, asOfUtcMs = null) {
  /** @type {import('../types.js').ParseIssue[]} */
  const blockingErrors = [...parseResult.blockingErrors];
  /** @type {import('../types.js').ParseIssue[]} */
  const softWarnings = [...parseResult.warnings];
  /** @type {import('../types.js').ParseIssue[]} */
  const notices = [...parseResult.notices];

  if (parseResult.totalBlocks === 0) {
    blockingErrors.push({
      severity: 'error',
      code: 'EMPTY_INPUT',
      blockIndex: 0,
      startLine: 1,
      line: 1,
      message: '尚未检测到回答数据。请粘贴至少 1 篇（建议 3 篇以上）回答数据，或点击“载入示例”快速体验。',
      fixHint: '可直接使用“逐篇添加助手”表单或按模板粘贴。',
    });
    return {
      canGenerate: false,
      needsConfirmation: false,
      canRank: false,
      blockingErrors,
      softWarnings,
      notices,
    };
  }

  const asOfDisplay = asOfUtcMs !== null ? formatUtcMinute(asOfUtcMs) : '';

  for (const item of parseResult.items) {
    const viewsLine = item.fieldLines?.views ?? item.startLine;
    const pubLine = item.fieldLines?.published ?? item.startLine;

    if (item.views === 0) {
      blockingErrors.push({
        severity: 'error',
        code: 'ZERO_VIEWS',
        blockIndex: item.blockIndex,
        startLine: item.startLine,
        line: viewsLine,
        message: `第 ${item.blockIndex} 篇《${item.title}》第 ${viewsLine} 行：阅读量为 0，无法作为比率分母。`,
        fixHint: '请核对创作中心数据；刚发布暂无阅读量的回答建议先不纳入对比。',
      });
    }

    if (asOfUtcMs !== null && item.publishedUtcMs !== null && asOfUtcMs < item.publishedUtcMs) {
      blockingErrors.push({
        severity: 'error',
        code: 'AS_OF_BEFORE_PUBLISHED',
        blockIndex: item.blockIndex,
        startLine: item.startLine,
        line: pubLine,
        message: `第 ${item.blockIndex} 篇《${item.title}》的发布时间晚于当前“数据截至时间”（${asOfDisplay}）。`,
        fixHint: '请将顶部“数据截至时间”调整为实际抄录数据的时刻，或检查发布时间年份。',
      });
    }

    if (item.views > 0) {
      /** @type {Array<{field:'upvotes'|'collects'|'comments', label:string}>} */
      const interactionFields = [
        { field: 'upvotes', label: '赞同' },
        { field: 'collects', label: '收藏' },
        { field: 'comments', label: '评论' },
      ];
      for (const { field, label } of interactionFields) {
        const val = item[field];
        if (val > item.views) {
          const line = item.fieldLines?.[field] ?? item.startLine;
          softWarnings.push({
            severity: 'warning',
            code: 'INTERACTION_EXCEEDS_VIEWS',
            blockIndex: item.blockIndex,
            startLine: item.startLine,
            line,
            message: `第 ${item.blockIndex} 篇《${item.title}》：【${label}】(${val}) 大于阅读量 (${item.views})，这在常规统计中较为少见。`,
            fixHint: '请确认是否将其他字段误填为阅读量；如确认无误可点击“确认数据无误，继续生成”。',
          });
        }
      }
    }
  }

  const validCount = parseResult.items.length;
  const canGenerate = blockingErrors.length === 0 && validCount > 0;
  const canRank = canGenerate && validCount >= 3;

  if (canGenerate && validCount < 3) {
    notices.push({
      severity: 'notice',
      code: 'FEWER_THAN_THREE',
      blockIndex: 0,
      startLine: 1,
      line: 1,
      message: `当前仅录入 ${validCount} 篇回答（少于 3 篇）：已为你计算各篇基础比率，暂不生成互动率排名与横向对比诊断。`,
      fixHint: `建议再补充至少 ${3 - validCount} 篇回答后重新生成完整复盘。`,
    });
  }

  return {
    canGenerate,
    needsConfirmation: canGenerate && softWarnings.length > 0,
    canRank,
    blockingErrors,
    softWarnings,
    notices,
  };
}
