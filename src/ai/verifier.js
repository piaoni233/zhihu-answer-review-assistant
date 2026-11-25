// @ts-check

/**
 * AI 输出引用数字核验器（详细设计 §7.5）
 * 防幻觉防线：比对 AI 文本引用的数字是否存在于确定性计算载荷中，未核验数字标出不静默放行。
 */

/**
 * 向允许集合注册数字及其等效写法（整数、去尾零、千分位、带/不带百分号）。
 * @param {Set<string>} set
 * @param {string} rawToken
 */
function addNumericVariants(set, rawToken) {
  const cleaned = rawToken.trim().replace(/,/g, '');
  if (!cleaned) return;
  const isPct = cleaned.endsWith('%');
  const numPart = isPct ? cleaned.slice(0, -1) : cleaned;
  if (!/^\d+(?:\.\d+)?$/.test(numPart)) return;

  const num = Number(numPart);
  if (!Number.isFinite(num)) return;

  const variants = new Set([numPart, String(num)]);
  if (numPart.includes('.')) {
    const trimmedZero = numPart.replace(/\.?0+$/, '');
    if (trimmedZero) variants.add(trimmedZero);
  }
  if (Number.isInteger(num)) {
    variants.add(num.toLocaleString('en-US'));
  }

  for (const v of variants) {
    if (isPct) {
      set.add(`${v}%`);
      set.add(v);
    } else {
      set.add(v);
    }
  }
}

/**
 * 从脱敏载荷中收集所有允许引用的数字字符串集合。
 * @param {any} payload
 * @returns {Set<string>}
 */
export function collectAllowedNumbers(payload) {
  /** @type {Set<string>} */
  const allowed = new Set();

  /** @param {any} node */
  function walk(node) {
    if (node === null || node === undefined) return;
    if (typeof node === 'number') {
      addNumericVariants(allowed, String(node));
      return;
    }
    if (typeof node === 'string') {
      const matches = node.match(/\d[\d,]*(?:\.\d+)?%?/g);
      if (matches) {
        for (const m of matches) {
          addNumericVariants(allowed, m);
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === 'object') {
      for (const val of Object.values(node)) walk(val);
    }
  }

  walk(payload);
  return allowed;
}

/**
 * 判断提取出的数字实体在上下文中是否属于非指标数字（年份、序数、篇幅描述等）。
 * @param {string} text
 * @param {number} index
 * @param {string} token
 * @returns {boolean}
 */
function isNonMetricContext(text, index, token) {
  if (token.endsWith('%')) return false;
  const before = text.slice(Math.max(0, index - 4), index);
  const after = text.slice(index + token.length, index + token.length + 4);

  // 年份如 2026 年 / 2025年
  if (/^(?:19|20)\d{2}$/.test(token) && /^\s*年/.test(after)) return true;
  // 序数词与排版引用：第 1 条、前 3 行、20 行、1. / 2、
  if (/(第|前|后|近|约|每)\s*$/.test(before)) return true;
  if (/^\s*(行|条|步|点|类|种|个|篇|段|字|分钟|小时|天|周|月|年|倍)/.test(after) && Number(token.replace(/,/g, '')) <= 50) {
    return true;
  }
  if ((index === 0 || /[\n\s]/.test(before.slice(-1))) && /^[.、)]/.test(after)) return true;

  return false;
}

/**
 * 提取单段文本中未被允许集合覆盖的数字实体。
 * @param {string} text
 * @param {Set<string>} allowed
 * @returns {string[]}
 */
export function findUnverifiedTokensInText(text, allowed) {
  if (typeof text !== 'string' || !text) return [];
  /** @type {string[]} */
  const unverified = [];
  const re = /\d[\d,]*(?:\.\d+)?%?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    if (isNonMetricContext(text, m.index, token)) continue;
    const norm = token.replace(/,/g, '');
    const isPct = norm.endsWith('%');
    const numericVal = isPct ? norm.slice(0, -1) : norm;
    const trimmed = numericVal.includes('.') ? numericVal.replace(/\.?0+$/, '') : numericVal;
    const key1 = isPct ? `${numericVal}%` : numericVal;
    const key2 = isPct ? `${trimmed}%` : trimmed;

    if (!allowed.has(token) && !allowed.has(key1) && !allowed.has(key2)) {
      unverified.push(token);
    }
  }
  return unverified;
}

/**
 * 对完整 AI 诊断输出执行确定性数字核验。
 * @param {{overallInsight:string, commentReinterpretation:string[], rewriteSuggestions:import('../types.js').AiRewriteSuggestion[]}} aiContent
 * @param {any} payload
 * @returns {import('../types.js').AiVerificationReport}
 */
export function verifyAiOutputNumbers(aiContent, payload) {
  const allowed = collectAllowedNumbers(payload);
  /** @type {string[]} */
  const allUnverified = [];

  allUnverified.push(...findUnverifiedTokensInText(aiContent.overallInsight, allowed));
  for (const line of aiContent.commentReinterpretation || []) {
    allUnverified.push(...findUnverifiedTokensInText(line, allowed));
  }
  for (const sug of aiContent.rewriteSuggestions || []) {
    allUnverified.push(...findUnverifiedTokensInText(sug.diagnosis, allowed));
    allUnverified.push(...findUnverifiedTokensInText(sug.concreteEdit, allowed));
  }

  return {
    hasUnverified: allUnverified.length > 0,
    unverifiedCount: allUnverified.length,
    unverifiedTokens: Array.from(new Set(allUnverified)),
  };
}

/**
 * 将一段纯文本切分为安全渲染片段，标记其中未核验数字（用于 DOM <mark> 安全渲染，防 XSS）。
 * @param {string} text
 * @param {string[]} unverifiedTokens
 * @returns {Array<{text:string, unverified:boolean}>}
 */
export function splitTextWithUnverifiedMarks(text, unverifiedTokens) {
  if (!text || !unverifiedTokens || unverifiedTokens.length === 0) {
    return [{ text: text || '', unverified: false }];
  }
  const tokenSet = new Set(unverifiedTokens);
  /** @type {Array<{text:string, unverified:boolean}>} */
  const segments = [];
  const re = /\d[\d,]*(?:\.\d+)?%?/g;
  let lastIdx = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    if (!tokenSet.has(token) || isNonMetricContext(text, m.index, token)) {
      continue;
    }
    if (m.index > lastIdx) {
      segments.push({ text: text.slice(lastIdx, m.index), unverified: false });
    }
    segments.push({ text: token, unverified: true });
    lastIdx = m.index + token.length;
  }

  if (lastIdx < text.length) {
    segments.push({ text: text.slice(lastIdx), unverified: false });
  }
  return segments.length > 0 ? segments : [{ text, unverified: false }];
}
