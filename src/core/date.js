// @ts-check

/**
 * Q4 墙钟日期解析、整天差计算与 UTC 分钟格式化。
 * 统一以 UTC 毫秒承载无时区墙钟时间，消除浏览器时区与夏令时偏移。
 */

const MS_PER_DAY = 86_400_000;

/**
 * 5 种支持的墙钟日期格式（与详细设计 §2.2 一致）
 * @type {Array<{regex: RegExp, hasTime: boolean, hasSec: boolean}>}
 */
const DATE_PATTERNS = [
  { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/, hasTime: true, hasSec: true },
  { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/, hasTime: true, hasSec: false },
  { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, hasTime: false, hasSec: false },
  { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/, hasTime: true, hasSec: false },
  { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, hasTime: false, hasSec: false },
];

/**
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 解析墙钟日期文本并校验真实日历合法性（拒绝如 2026-02-30、无年份或相对时间）。
 * @param {string} text
 * @returns {import('../types.js').ParsedDate|null}
 */
export function parseWallDate(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const { regex, hasTime, hasSec } of DATE_PATTERNS) {
    const m = regex.exec(trimmed);
    if (!m) continue;

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = hasTime ? Number(m[4]) : 0;
    const minute = hasTime ? Number(m[5]) : 0;
    const second = hasSec ? Number(m[6]) : 0;

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;

    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const verify = new Date(utcMs);
    if (
      verify.getUTCFullYear() !== year ||
      verify.getUTCMonth() !== month - 1 ||
      verify.getUTCDate() !== day ||
      verify.getUTCHours() !== hour ||
      verify.getUTCMinutes() !== minute ||
      verify.getUTCSeconds() !== second
    ) {
      return null;
    }

    return {
      utcMs,
      dateStr: `${year}-${pad2(month)}-${pad2(day)}`,
      hasTime,
    };
  }

  return null;
}

/**
 * 解析 HTML datetime-local 控件值（YYYY-MM-DDTHH:mm[:ss]）为墙钟 UTC 毫秒。
 * @param {string} value
 * @returns {number|null}
 */
export function parseDateTimeLocalValue(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace('T', ' ');
  const parsed = parseWallDate(normalized);
  return parsed ? parsed.utcMs : null;
}

/**
 * 将 Date 对象的本地墙钟分量映射为墙钟 UTC 毫秒（用于默认“当前数据截至时间”）。
 * @param {Date} [date]
 * @returns {number}
 */
export function localDateToWallUtcMs(date = new Date()) {
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  );
}

/**
 * 计算两个墙钟时间之间的整天差（向下取整，与 Python `(later - earlier).days` 一致）。
 * @param {number} earlierUtcMs
 * @param {number} laterUtcMs
 * @returns {number}
 */
export function diffDaysFloor(earlierUtcMs, laterUtcMs) {
  return Math.floor((laterUtcMs - earlierUtcMs) / MS_PER_DAY);
}

/**
 * 将墙钟 UTC 毫秒格式化为 `YYYY-MM-DD HH:mm`。
 * @param {number} utcMs
 * @returns {string}
 */
export function formatUtcMinute(utcMs) {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * 将墙钟 UTC 毫秒格式化为 HTML `datetime-local` 值 `YYYY-MM-DDTHH:mm`。
 * @param {number} utcMs
 * @returns {string}
 */
export function formatUtcDateTimeLocal(utcMs) {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * 将墙钟 UTC 毫秒格式化为 `YYYY-MM-DD`。
 * @param {number} utcMs
 * @returns {string}
 */
export function formatUtcDate(utcMs) {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
