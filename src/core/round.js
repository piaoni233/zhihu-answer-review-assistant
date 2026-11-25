// @ts-check

/**
 * Q1/Q2 精确十进制格式化与半偶舍入（银行家舍入）
 * 与 Python `int(round(v))` 及 `f"{x:.2f}"` 行为逐字一致。
 */

/**
 * 将有限数值按“四舍六入五成双”（半偶舍入）取整。
 * @param {number} value
 * @returns {number}
 */
export function roundHalfEvenInt(value) {
  if (!Number.isFinite(value)) {
    throw new RangeError('无法对非有限数值取整');
  }
  const f = Math.floor(value);
  const d = value - f;
  let result;
  if (d > 0.5) {
    result = f + 1;
  } else if (d < 0.5) {
    result = f;
  } else {
    // 双精度下 d === 0.5 精确成立时，取偶数整数
    result = f % 2 === 0 ? f : f + 1;
  }
  return result === 0 ? 0 : result;
}

/**
 * 对双精度浮点数的精确十进制值做半偶舍入并格式化为固定小数位字符串。
 * @param {number|null|undefined} value
 * @param {number} [digits=2]
 * @returns {string}
 */
export function formatFixedHalfEven(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const d = Math.max(0, Math.floor(digits));
  const negative = value < 0;
  const absVal = Math.abs(value);

  if (absVal >= 1e21 || d > 95) {
    const fallback = absVal.toFixed(Math.min(d, 20));
    return negative && Number(fallback) !== 0 ? `-${fallback}` : fallback;
  }

  // |x| < 1e21 时 toFixed(100) 返回 IEEE-754 双精度的精确十进制展开
  const exact = absVal.toFixed(100);
  const dotIdx = exact.indexOf('.');
  const intPart = dotIdx === -1 ? exact : exact.slice(0, dotIdx);
  const fracPart = dotIdx === -1 ? '' : exact.slice(dotIdx + 1);

  const keep = fracPart.slice(0, d);
  const rest = fracPart.slice(d);

  let roundUp = false;
  if (rest.length > 0) {
    const firstRest = rest[0];
    if (firstRest > '5') {
      roundUp = true;
    } else if (firstRest < '5') {
      roundUp = false;
    } else if (/[1-9]/.test(rest.slice(1))) {
      roundUp = true;
    } else {
      const lastKeptDigit = d > 0 ? keep[keep.length - 1] : intPart[intPart.length - 1];
      roundUp = Number(lastKeptDigit) % 2 === 1;
    }
  }

  const scaled = BigInt(intPart + keep) + (roundUp ? 1n : 0n);
  const rawDigits = scaled.toString().padStart(d + 1, '0');
  const formatted = d > 0
    ? `${rawDigits.slice(0, -d)}.${rawDigits.slice(-d)}`
    : rawDigits;

  return negative && scaled !== 0n ? `-${formatted}` : formatted;
}

/**
 * 格式化百分比字符串（保留两位小数，半偶舍入）；无效值返回 "—"。
 * @param {number|null|undefined} value
 * @returns {string}
 */
export function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${formatFixedHalfEven(value, 2)}%`;
}
