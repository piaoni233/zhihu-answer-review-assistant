// @ts-check

import { formatFixedHalfEven, formatPercent } from '../core/round.js';

/**
 * AI 脱敏白名单载荷构造与提示词拼装（详细设计 §7.2、§7.3）
 * 严禁发送 rawInputText、API Key、本地历史全库或未脱敏评论。
 */

export const AI_SYSTEM_PROMPT = `你是一位熟悉知乎内容生态的回答复盘顾问。你会收到一份由确定性引擎计算好的知乎回答数据摘要（JSON）。
必须严格遵守以下规则：
1. 绝对不要重新计算或修改任何比率、总数、排名，也不要编造输入 JSON 中不存在的数字。每次引用数据必须与 JSON 中的数字或百分比完全一致。
2. 全程使用知乎术语（回答、问题标题、阅读、赞同、收藏、评论、收赞比、盐值、折叠、编辑原回答），禁止出现其他内容平台术语。
3. 重点分析：① 评论区字面背后的读者真实诉求（尤其区分“质疑求证”与“普通追问”，纠正关键词粗分可能的误判）；② 为什么高阅读回答没能留住人（聚焦首屏前三行、论据信源、问题匹配度）；③ 给出 2–3 条可直接用于“编辑原回答”的改写话术或段落结构建议。
4. 按严格 JSON 返回，不要附加多余解释文本：
{
  "overallInsight": "100字以内整体语义判断",
  "commentReinterpretation": ["对评论信号的语义复核，修正关键词可能误判之处"],
  "rewriteSuggestions": [
    { "targetTitle": "问题标题", "diagnosis": "原因分析", "concreteEdit": "可直接复制修改原回答的开头或补充段示例" }
  ]
}`;

/**
 * 按 §7.2 白名单构造发送给大模型的脱敏 JSON 载荷。
 * @param {import('../types.js').BatchMetrics} metrics
 * @param {import('../types.js').DiagnosisResult} diagnosis
 */
export function buildSanitizedAiPayload(metrics, diagnosis) {
  return {
    asOfDisplay: metrics.asOfDisplay,
    totals: {
      views: metrics.totals.views,
      upvotes: metrics.totals.upvotes,
      collects: metrics.totals.collects,
      comments: metrics.totals.comments,
      weightedEngagementRate: formatPercent(metrics.weightedEngagementRate),
    },
    medians: {
      upvoteRate: formatPercent(metrics.medians.upvoteRate),
      collectRate: formatPercent(metrics.medians.collectRate),
      commentRate: formatPercent(metrics.medians.commentRate),
      engagementRate: formatPercent(metrics.medians.engagementRate),
    },
    answers: metrics.items.map((m) => ({
      title: m.raw.title,
      ageDays: m.ageDays,
      views: m.raw.views,
      upvotes: m.raw.upvotes,
      collects: m.raw.collects,
      comments: m.raw.comments,
      rates: {
        upvoteRate: formatPercent(m.upvoteRate),
        collectRate: formatPercent(m.collectRate),
        commentRate: formatPercent(m.commentRate),
        engagementRate: formatPercent(m.engagementRate),
        collectUpvoteRatio: formatFixedHalfEven(m.collectUpvoteRatio, 2),
      },
      flags: {
        isSmallSample: m.isSmallSample,
        isImmature: m.isImmature,
      },
      maskedComments: [...m.raw.maskedCommentsText],
    })),
    ruleHighlights: {
      bestTitle: diagnosis.roles.best?.answerTitle ?? null,
      benchmarkTitle: diagnosis.roles.benchmark?.answerTitle ?? null,
      worstTitle: diagnosis.roles.worst?.answerTitle ?? null,
      topOpportunityTitle: diagnosis.roles.topOpportunity?.answerTitle ?? null,
    },
  };
}

/**
 * 拼装发送给大模型的消息数组。
 * @param {ReturnType<typeof buildSanitizedAiPayload>} payload
 * @returns {Array<{role:'system'|'user', content:string}>}
 */
export function buildAiMessages(payload) {
  return [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `以下是本次知乎回答复盘的确定性计算摘要（请勿重算或编造数字）：\n${JSON.stringify(payload, null, 2)}`,
    },
  ];
}

/**
 * 构造发送前的数据出境确认文案（详细设计 §7.2）。
 * @param {import('./providers.js').AiProviderConfig} provider
 * @returns {string}
 */
export function buildConsentMessage(provider) {
  return `点击“确认并分析”后，浏览器将直接向 ${provider.name}（${provider.host}）发送本次复盘的计算结果、问题标题与已脱敏的代表性评论（不含您的 API Key 与本地其他历史记录，请求不经过任何第三方或开发者服务器）。请确认是否继续？`;
}
