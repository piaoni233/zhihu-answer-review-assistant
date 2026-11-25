// @ts-check

import { formatUtcDate } from '../core/date.js';

/**
 * JSON 备份导出/校验/导入 与 Markdown 下载/剪贴板兜底（详细设计 §5.5、§5.6）
 */

export const BACKUP_APP_ID = 'zhihu-answer-review-assistant';
export const BACKUP_SCHEMA_VERSION = 1;

/**
 * 构造 JSON 备份对象（绝不含 API Key）。
 * @param {import('../types.js').ReviewRecord[]} reviews
 * @param {import('../types.js').Settings} settings
 * @param {number} [exportedAtUtcMs]
 */
export function createBackupPayload(reviews, settings, exportedAtUtcMs = Date.now()) {
  return {
    appId: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAtUtcMs,
    settings: {
      ageThresholdDays: settings.ageThresholdDays,
      smallSampleThreshold: settings.smallSampleThreshold,
      maskMentionHandles: settings.maskMentionHandles,
    },
    reviews,
  };
}

/**
 * 校验 JSON 备份结构是否合法。
 * @param {any} data
 * @returns {{ok: boolean, error: string|null, payload: any}}
 */
export function validateBackupPayload(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: '备份文件内容不是合法的 JSON 对象。', payload: null };
  }
  if (data.appId !== BACKUP_APP_ID) {
    return { ok: false, error: '备份文件标识（appId）不匹配，请确认是否选择了本工具导出的备份文件。', payload: null };
  }
  if (data.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: `不支持的备份架构版本（${String(data.schemaVersion)}），当前仅支持版本 ${BACKUP_SCHEMA_VERSION}。`, payload: null };
  }
  if (!Array.isArray(data.reviews)) {
    return { ok: false, error: '备份文件缺少 reviews 数组字段。', payload: null };
  }

  for (let i = 0; i < data.reviews.length; i += 1) {
    const rev = data.reviews[i];
    if (
      !rev ||
      typeof rev.id !== 'string' ||
      typeof rev.createdAtUtcMs !== 'number' ||
      typeof rev.asOfUtcMs !== 'number' ||
      !Array.isArray(rev.answers) ||
      !rev.reportModel
    ) {
      return {
        ok: false,
        error: `第 ${i + 1} 条复盘记录缺少必要字段（id / createdAtUtcMs / asOfUtcMs / answers / reportModel），已拒绝导入。`,
        payload: null,
      };
    }
  }

  return { ok: true, error: null, payload: data };
}

/**
 * 校验并将 JSON 备份去重合并导入复盘存储，随后重建 answerIndex。
 * @param {ReturnType<import('./review-store.js').createReviewStore>} reviewStore
 * @param {string} jsonText
 * @returns {Promise<{importedCount: number, skippedCount: number, settings: Partial<import('../types.js').Settings>|null}>}
 */
export async function importBackupIntoStore(reviewStore, jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('备份文件不是有效的 JSON 格式，无法解析。');
  }

  const check = validateBackupPayload(parsed);
  if (!check.ok) {
    throw new Error(check.error || '备份文件校验失败');
  }

  const existing = await reviewStore.listReviews();
  const existingIds = new Set(existing.map((r) => r.id));

  let importedCount = 0;
  let skippedCount = 0;

  for (const rev of check.payload.reviews) {
    if (existingIds.has(rev.id)) {
      skippedCount += 1;
      continue;
    }
    await reviewStore.saveReview(rev);
    existingIds.add(rev.id);
    importedCount += 1;
  }

  await reviewStore.rebuildAnswerIndex();

  return {
    importedCount,
    skippedCount,
    settings: check.payload.settings || null,
  };
}

/**
 * 生成规范备份文件名：`zhihu-review-backup-YYYYMMDD-HHmm.json`。
 * @param {Date} [date]
 * @returns {string}
 */
export function makeBackupFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `zhihu-review-backup-${y}${m}${d}-${hh}${mm}.json`;
}

/**
 * 生成 Markdown 导出文件名：`知乎回答复盘-YYYYMMDD.md`。
 * @param {number} asOfUtcMs
 * @returns {string}
 */
export function makeMarkdownFilename(asOfUtcMs) {
  const compact = formatUtcDate(asOfUtcMs).replace(/-/g, '');
  return `知乎回答复盘-${compact}.md`;
}

/**
 * 触发浏览器文件下载（Markdown 附 UTF-8 BOM 以兼容 Windows 文本编辑器）。
 * @param {string} filename
 * @param {string} content
 * @param {string} [mimeType='text/markdown;charset=utf-8']
 * @param {boolean} [withBom=true]
 * @returns {boolean}
 */
export function downloadTextFile(filename, content, mimeType = 'text/markdown;charset=utf-8', withBom = true) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    return false;
  }
  try {
    const payload = withBom ? `\uFEFF${content}` : content;
    const blob = new Blob([payload], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/**
 * 优先调用 Clipboard API 复制文本；失败时通知上层 UI 打开全选文本弹窗兜底。
 * @param {string} text
 * @returns {Promise<{copied: boolean, needsManualFallback: boolean}>}
 */
export async function copyTextWithFallback(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return { copied: true, needsManualFallback: false };
    }
  } catch {
    // 移动端或非 HTTPS / 权限被拒，回落到手动全选弹窗
  }
  return { copied: false, needsManualFallback: true };
}
