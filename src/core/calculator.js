// @ts-check

import { diffDaysFloor, formatUtcDate, formatUtcMinute } from './date.js';

/**
 * 确定性计算引擎（与 oracle 严格逐字一致）：
 * Q3 比率运算顺序、Q4 墙钟整天跨度、Q5 稳定排序与并列处理、Q9 可选字段不入互动率。
 */

/**
 * Q3：严格先除后乘，避免与 Python `part / whole * 100.0` 的双精度舍入偏差。
 * @param {number} part
 * @param {number} whole
 * @returns {number|null}
 */
export function calcRate(part, whole) {
  if (!whole) return null;
  return (part / whole) * 100.0;
}

/**
 * 计算数值数组的中位数（忽略 null / undefined / NaN）。
 * @param {Array<number|null|undefined>} values
 * @returns {number|null}
 */
export function calcMedian(values) {
  const valid = values
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  if (valid.length % 2 === 1) {
    return valid[mid];
  }
  return (valid[mid - 1] + valid[mid]) / 2;
}

/**
 * 计算整批回答的所有确定性指标、合计、中位数、排名与时间跨度。
 * @param {import('../types.js').ParsedAnswer[]} items
 * @param {{asOfUtcMs:number, settings?:Partial<import('../types.js').Settings>}} options
 * @returns {import('../types.js').BatchMetrics}
 */
export function computeBatchMetrics(items, options) {
  const asOfUtcMs = options.asOfUtcMs;
  const ageThresholdDays = options.settings?.ageThresholdDays ?? 7;
  const smallSampleThreshold = options.settings?.smallSampleThreshold ?? 200;

  /** @type {import('../types.js').AnswerMetrics[]} */
  const metricItems = items.map((raw) => {
    const upvoteRate = calcRate(raw.upvotes, raw.views);
    const collectRate = calcRate(raw.collects, raw.views);
    const commentRate = calcRate(raw.comments, raw.views);
    const engagementRate = calcRate(raw.upvotes + raw.collects + raw.comments, raw.views);
    const collectUpvoteRatio = raw.upvotes > 0 ? raw.collects / raw.upvotes : null;
    const ageDays = raw.publishedUtcMs !== null ? diffDaysFloor(raw.publishedUtcMs, asOfUtcMs) : null;
    const isSmallSample = raw.views < smallSampleThreshold;
    const isImmature = ageDays !== null && ageDays < ageThresholdDays;

    return {
      raw,
      upvoteRate,
      collectRate,
      commentRate,
      engagementRate,
      collectUpvoteRatio,
      ageDays,
      isSmallSample,
      isImmature,
      rank: 0,
    };
  });

  // Q5：稳定降序排列，views === 0 (engagementRate === null) 按 -1 排最后
  const ranked = [...metricItems].sort((a, b) => {
    const ea = a.engagementRate !== null ? a.engagementRate : -1;
    const eb = b.engagementRate !== null ? b.engagementRate : -1;
    return eb - ea;
  });

  ranked.forEach((m, idx) => {
    m.rank = idx + 1;
  });

  let totalViews = 0;
  let totalUpvotes = 0;
  let totalCollects = 0;
  let totalComments = 0;
  let totalEndorseLikes = 0;
  let totalShares = 0;
  let hasEndorseLikes = false;
  let hasShares = false;

  for (const item of items) {
    totalViews += item.views;
    totalUpvotes += item.upvotes;
    totalCollects += item.collects;
    totalComments += item.comments;
    if (item.endorseLikes !== null && item.endorseLikes !== undefined) {
      totalEndorseLikes += item.endorseLikes;
      hasEndorseLikes = true;
    }
    if (item.shares !== null && item.shares !== undefined) {
      totalShares += item.shares;
      hasShares = true;
    }
  }

  const totalInteractions = totalUpvotes + totalCollects + totalComments;
  const weightedEngagementRate = calcRate(totalInteractions, totalViews);

  const medians = {
    upvoteRate: calcMedian(metricItems.map((m) => m.upvoteRate)),
    collectRate: calcMedian(metricItems.map((m) => m.collectRate)),
    commentRate: calcMedian(metricItems.map((m) => m.commentRate)),
    engagementRate: calcMedian(metricItems.map((m) => m.engagementRate)),
  };

  // Q4 时间跨度与数据龄范围
  const datedMs = items
    .map((it) => it.publishedUtcMs)
    .filter((ms) => typeof ms === 'number' && Number.isFinite(ms));

  let spanDays = null;
  let earliestDate = null;
  let latestDate = null;

  if (datedMs.length >= 1) {
    let minMs = datedMs[0];
    let maxMs = datedMs[0];
    for (let i = 1; i < datedMs.length; i += 1) {
      if (datedMs[i] < minMs) minMs = datedMs[i];
      if (datedMs[i] > maxMs) maxMs = datedMs[i];
    }
    spanDays = datedMs.length > 1 ? diffDaysFloor(minMs, maxMs) : 0;
    earliestDate = formatUtcDate(minMs);
    latestDate = formatUtcDate(maxMs);
  }

  const ages = metricItems
    .map((m) => m.ageDays)
    .filter((a) => typeof a === 'number' && Number.isFinite(a));

  let minAgeDays = null;
  let maxAgeDays = null;
  let hasLargeAgeSpread = false;

  if (ages.length >= 1) {
    minAgeDays = Math.min(...ages);
    maxAgeDays = Math.max(...ages);
    if (ages.length >= 2) {
      hasLargeAgeSpread =
        maxAgeDays - minAgeDays > 7 &&
        (minAgeDays === 0 ? maxAgeDays > 7 : maxAgeDays / minAgeDays > 2);
    }
  }

  return {
    asOfUtcMs,
    asOfDisplay: formatUtcMinute(asOfUtcMs),
    items: metricItems,
    ranked,
    totals: {
      views: totalViews,
      upvotes: totalUpvotes,
      collects: totalCollects,
      comments: totalComments,
      interactions: totalInteractions,
      endorseLikes: totalEndorseLikes,
      shares: totalShares,
      hasEndorseLikes,
      hasShares,
    },
    weightedEngagementRate,
    medians,
    timeSpan: {
      spanDays,
      earliestDate,
      latestDate,
      minAgeDays,
      maxAgeDays,
      hasLargeAgeSpread,
    },
  };
}

/**
 * 计算同一回答在前后两次复盘快照之间的跨期增量。
 * @param {{views:number, upvotes:number, collects:number, comments:number}} prevSnapshot
 * @param {{views:number, upvotes:number, collects:number, comments:number}} currSnapshot
 * @returns {{viewsDelta:number, upvotesDelta:number, collectsDelta:number, commentsDelta:number, incrementalEngagementRate:number|null, hasAnomaly:boolean}}
 */
export function computeAnswerDelta(prevSnapshot, currSnapshot) {
  const viewsDelta = currSnapshot.views - prevSnapshot.views;
  const upvotesDelta = currSnapshot.upvotes - prevSnapshot.upvotes;
  const collectsDelta = currSnapshot.collects - prevSnapshot.collects;
  const commentsDelta = currSnapshot.comments - prevSnapshot.comments;

  const hasAnomaly =
    viewsDelta < 0 || upvotesDelta < 0 || collectsDelta < 0 || commentsDelta < 0;

  const incrementalEngagementRate =
    !hasAnomaly && viewsDelta > 0
      ? calcRate(upvotesDelta + collectsDelta + commentsDelta, viewsDelta)
      : null;

  return {
    viewsDelta,
    upvotesDelta,
    collectsDelta,
    commentsDelta,
    incrementalEngagementRate,
    hasAnomaly,
  };
}
