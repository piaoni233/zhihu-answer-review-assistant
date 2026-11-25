// @ts-check

import { normalizeTitle } from '../core/parser.js';
import { calcMedian, calcRate, computeAnswerDelta } from '../core/calculator.js';
import { formatUtcMinute } from '../core/date.js';
import { STORE_ANSWER_INDEX, STORE_REVIEWS } from './idb.js';

/**
 * 复盘档案与回答跨期索引存储层（详细设计 §5.1、§5.4）
 * - isSample === true 的内置示例复盘绝不写入 answerIndex，防止污染个人真实历史基线
 * - 落盘前用 maskedCommentsText 替代 commentsText，不持久化未脱敏评论 PII
 */

/**
 * 构造回答跨期匹配唯一键。
 * @param {string} title
 * @param {string|null} publishedDateStr
 * @returns {string}
 */
export function makeAnswerKey(title, publishedDateStr) {
  return `${normalizeTitle(title)}::${publishedDateStr || 'unknown'}`;
}

/**
 * 生成唯一复盘 ID。
 * @returns {string}
 */
export function generateReviewId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `rev_${crypto.randomUUID()}`;
  }
  return `rev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 剥离回答记录中的未脱敏原文评论，确保持久化只保存脱敏版本。
 * @param {import('../types.js').ReviewRecord} record
 * @returns {import('../types.js').ReviewRecord}
 */
function sanitizeRecordForPersistence(record) {
  return {
    ...record,
    answers: record.answers.map((ans) => ({
      ...ans,
      commentsText: [...ans.maskedCommentsText],
      maskedCommentsText: [...ans.maskedCommentsText],
    })),
  };
}

/**
 * @param {import('./idb.js').KeyValueStoreAdapter} adapter
 */
export function createReviewStore(adapter) {
  /**
   * @param {import('../types.js').ReviewRecord} review
   * @returns {Promise<void>}
   */
  async function indexRealReview(review) {
    if (review.isSample) return;

    const asOfDisplay = formatUtcMinute(review.asOfUtcMs);

    for (const ans of review.answers) {
      const normTitle = normalizeTitle(ans.title);
      const pubDate = ans.publishedDateStr || 'unknown';
      const answerKey = makeAnswerKey(ans.title, pubDate);
      /** @type {import('../types.js').AnswerIndexRecord|undefined} */
      const existing = await adapter.get(STORE_ANSWER_INDEX, answerKey);

      /** @type {import('../types.js').AnswerTimelineEntry} */
      const entry = {
        reviewId: review.id,
        asOfUtcMs: review.asOfUtcMs,
        asOfDisplay,
        views: ans.views,
        upvotes: ans.upvotes,
        collects: ans.collects,
        comments: ans.comments,
        engagementRate: calcRate(ans.upvotes + ans.collects + ans.comments, ans.views),
        upvoteRate: calcRate(ans.upvotes, ans.views),
        collectRate: calcRate(ans.collects, ans.views),
        commentRate: calcRate(ans.comments, ans.views),
      };

      const timeline = existing
        ? existing.timeline.filter((t) => t.reviewId !== review.id)
        : [];
      timeline.push(entry);
      timeline.sort((a, b) => a.asOfUtcMs - b.asOfUtcMs);

      /** @type {import('../types.js').AnswerIndexRecord} */
      const updated = {
        answerKey,
        normTitle,
        title: ans.title,
        publishedDateStr: pubDate,
        categoryTag: ans.categoryTag ?? existing?.categoryTag ?? null,
        lastUpdatedUtcMs: Math.max(review.asOfUtcMs, existing?.lastUpdatedUtcMs ?? 0),
        timeline,
      };

      await adapter.put(STORE_ANSWER_INDEX, updated);
    }
  }

  return {
    get isDegraded() {
      return adapter.isDegraded;
    },
    get degradedReason() {
      return adapter.degradedReason;
    },

    /**
     * 保存一次复盘记录；仅当 isSample === false 时同步更新 answerIndex。
     * @param {import('../types.js').ReviewRecord} record
     */
    async saveReview(record) {
      const clean = sanitizeRecordForPersistence(record);
      await adapter.put(STORE_REVIEWS, clean);
      if (!clean.isSample) {
        await indexRealReview(clean);
      }
    },

    /**
     * 更新已有复盘的 AI 诊断结果（例如用户稍后触发 BYOK 实时 AI 诊断）。
     * @param {string} reviewId
     * @param {import('../types.js').AiDiagnosisResult} aiDiagnosis
     */
    async attachAiDiagnosis(reviewId, aiDiagnosis) {
      /** @type {import('../types.js').ReviewRecord|undefined} */
      const existing = await adapter.get(STORE_REVIEWS, reviewId);
      if (!existing) return;
      existing.aiDiagnosis = aiDiagnosis;
      existing.reportModel = {
        ...existing.reportModel,
        aiSection: aiDiagnosis,
      };
      await adapter.put(STORE_REVIEWS, existing);
    },

    /**
     * @param {string} id
     * @returns {Promise<import('../types.js').ReviewRecord|undefined>}
     */
    async getReview(id) {
      return adapter.get(STORE_REVIEWS, id);
    },

    /**
     * 按创建时间倒序返回所有复盘记录。
     * @returns {Promise<import('../types.js').ReviewRecord[]>}
     */
    async listReviews() {
      /** @type {import('../types.js').ReviewRecord[]} */
      const all = await adapter.getAll(STORE_REVIEWS);
      return all.sort((a, b) => b.createdAtUtcMs - a.createdAtUtcMs);
    },

    /**
     * 删除指定复盘并重建真实回答索引。
     * @param {string} id
     */
    async deleteReview(id) {
      await adapter.delete(STORE_REVIEWS, id);
      await this.rebuildAnswerIndex();
    },

    /**
     * 清空全部复盘与回答索引。
     */
    async clearAll() {
      await adapter.clear(STORE_REVIEWS);
      await adapter.clear(STORE_ANSWER_INDEX);
    },

    /**
     * 基于所有真实复盘（isSample === false）幂等重建 answerIndex。
     */
    async rebuildAnswerIndex() {
      await adapter.clear(STORE_ANSWER_INDEX);
      /** @type {import('../types.js').ReviewRecord[]} */
      const all = await adapter.getAll(STORE_REVIEWS);
      all.sort((a, b) => a.asOfUtcMs - b.asOfUtcMs);
      for (const rev of all) {
        if (!rev.isSample) {
          await indexRealReview(rev);
        }
      }
    },

    /**
     * 获取所有真实回答跨期索引记录（按最近更新时间倒序）。
     * @returns {Promise<import('../types.js').AnswerIndexRecord[]>}
     */
    async listTrackedAnswers() {
      /** @type {import('../types.js').AnswerIndexRecord[]} */
      const all = await adapter.getAll(STORE_ANSWER_INDEX);
      return all.sort((a, b) => b.lastUpdatedUtcMs - a.lastUpdatedUtcMs);
    },

    /**
     * 计算个人历史基线中位数（仅统计 answerIndex 中非示例的真实回答最新快照）。
     * @returns {Promise<import('../types.js').HistoryBaseline>}
     */
    async getHistoryBaseline() {
      /** @type {import('../types.js').AnswerIndexRecord[]} */
      const all = await adapter.getAll(STORE_ANSWER_INDEX);
      const latestSnapshots = all
        .filter((rec) => rec.timeline && rec.timeline.length > 0)
        .map((rec) => ({
          categoryTag: rec.categoryTag,
          latest: rec.timeline[rec.timeline.length - 1],
        }));

      /** @type {Record<string, number[]>} */
      const catBuckets = {};
      for (const s of latestSnapshots) {
        if (s.categoryTag && s.latest.engagementRate !== null) {
          if (!catBuckets[s.categoryTag]) catBuckets[s.categoryTag] = [];
          catBuckets[s.categoryTag].push(s.latest.engagementRate);
        }
      }

      /** @type {Record<string, {sampleCount: number, medianEngagementRate: number|null}>} */
      const byCategory = {};
      for (const [cat, vals] of Object.entries(catBuckets)) {
        byCategory[cat] = {
          sampleCount: vals.length,
          medianEngagementRate: calcMedian(vals),
        };
      }

      return {
        sampleCount: latestSnapshots.length,
        medianEngagementRate: calcMedian(latestSnapshots.map((s) => s.latest.engagementRate)),
        medianUpvoteRate: calcMedian(latestSnapshots.map((s) => s.latest.upvoteRate)),
        medianCollectRate: calcMedian(latestSnapshots.map((s) => s.latest.collectRate)),
        medianCommentRate: calcMedian(latestSnapshots.map((s) => s.latest.commentRate)),
        byCategory,
      };
    },

    /**
     * 查找本批回答在历史库中更早一次（asOfUtcMs < currentAsOfUtcMs）的最近快照并计算增量。
     * @param {import('../types.js').ParsedAnswer[]} answers
     * @param {number} currentAsOfUtcMs
     * @returns {Promise<import('../types.js').AnswerDelta[]>}
     */
    async findCrossPeriodDeltas(answers, currentAsOfUtcMs) {
      /** @type {import('../types.js').AnswerDelta[]} */
      const deltas = [];
      for (const ans of answers) {
        if (!ans.publishedDateStr) continue;
        const key = makeAnswerKey(ans.title, ans.publishedDateStr);
        /** @type {import('../types.js').AnswerIndexRecord|undefined} */
        const idxRec = await adapter.get(STORE_ANSWER_INDEX, key);
        if (!idxRec || !idxRec.timeline || idxRec.timeline.length === 0) continue;

        const earlier = idxRec.timeline.filter((t) => t.asOfUtcMs < currentAsOfUtcMs);
        if (earlier.length === 0) continue;
        const prev = earlier[earlier.length - 1];
        const diff = computeAnswerDelta(prev, ans);
        deltas.push({
          title: ans.title,
          publishedDateStr: ans.publishedDateStr,
          prevAsOfDisplay: prev.asOfDisplay || formatUtcMinute(prev.asOfUtcMs),
          prevAsOfUtcMs: prev.asOfUtcMs,
          ...diff,
        });
      }
      return deltas;
    },
  };
}
