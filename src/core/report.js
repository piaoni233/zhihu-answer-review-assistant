// @ts-check

import { formatFixedHalfEven, formatPercent } from './round.js';

/**
 * 唯一 ReportModel 构建与全新原创知乎 Markdown 序列化（详细设计 §4.1、§4.2）。
 * 界面渲染与 Markdown 导出严格消费同一个 ReportModel，确保数字 100% 一致。
 */

export const RELATIVE_DISCLAIMER =
  '知乎官方未发布互动率绝对及格线，本报告采用“批内相对对照”与“本人历史对照”评估表现，所有“偏高/偏低”均相对于本批中位数或本人过往记录而言。';

export const COMMENT_DISCLAIMER =
  '评论分类基于知乎常见表达关键词按“质疑求证 > 追问 > 催更/蹲后续 > 收藏标记 > 认可”优先级粗分，可能存在反讽或上下文误判，请结合下方脱敏原评论核对；评论中涉及手机号、邮箱、证件号及 @昵称 已做脱敏处理。';

export const FORMULAS_NOTE = [
  '赞同率（社区亦称赞阅比）= 赞同 ÷ 阅读 × 100%（反映读者公开背书意愿）',
  '收藏率 = 收藏 ÷ 阅读 × 100%（反映工具与长尾留存价值）',
  '评论率 = 评论 ÷ 阅读 × 100%（仅代表讨论密度，含追问或质疑，高评论率不等同于好评）',
  '互动率 =（赞同 + 收藏 + 评论）÷ 阅读 × 100%（仅作本批排序键，结构拆解以前三项分项比率与收赞比为准）',
  '收赞比 = 收藏 ÷ 赞同',
];

/**
 * 构建下次复盘可直接粘贴的知乎文本块。
 * @param {import('../types.js').BatchMetrics} metrics
 * @returns {string}
 */
export function buildNextReviewTemplate(metrics) {
  return metrics.items
    .map((m) => {
      const lines = [
        `标题：${m.raw.title}`,
        `发布时间：${m.raw.publishedRaw}`,
        `阅读：${m.raw.views}`,
        `赞同：${m.raw.upvotes}`,
        `收藏：${m.raw.collects}`,
        `评论：${m.raw.comments}`,
      ];
      if (m.raw.categoryTag) {
        lines.push(`回答类型：${m.raw.categoryTag}`);
      }
      lines.push(`# 备注：上次复盘数据龄 ${m.ageDays !== null ? `${m.ageDays} 天` : '未知'}（截至 ${metrics.asOfDisplay}）`);
      lines.push('代表性评论：');
      lines.push('- 粘贴最新有代表性的追问或质疑');
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}

/**
 * 组装单一 ReportModel 对象。
 * @param {import('../types.js').BatchMetrics} metrics
 * @param {import('../types.js').DiagnosisResult} diagnosis
 * @param {{reviewId:string, createdAtUtcMs:number, engineVersion:string, isSample:boolean, settings:import('../types.js').Settings, deltas?:import('../types.js').AnswerDelta[], aiDiagnosis?:import('../types.js').AiDiagnosisResult|null}} meta
 * @returns {import('../types.js').ReportModel}
 */
export function buildReportModel(metrics, diagnosis, meta) {
  const weightedStr = formatPercent(metrics.weightedEngagementRate);
  const medianStr = formatPercent(metrics.medians.engagementRate);
  const spreadStr =
    diagnosis.engagementSpreadPp !== null ? formatFixedHalfEven(diagnosis.engagementSpreadPp, 2) : null;

  let headline = `本批 ${metrics.items.length} 篇回答累计获得阅读 ${metrics.totals.views}、赞同 ${metrics.totals.upvotes}、收藏 ${metrics.totals.collects}、评论 ${metrics.totals.comments}，总互动 ${metrics.totals.interactions} 次，加权平均互动率为 ${weightedStr}（总互动 ${metrics.totals.interactions} ÷ 总阅读 ${metrics.totals.views}）。`;
  if (diagnosis.canRank && spreadStr !== null) {
    headline += `批内互动率中位数为 ${medianStr}，最高与最低相差 ${spreadStr} 个百分点。`;
  }
  if (diagnosis.historyComparisonNote) {
    headline += diagnosis.historyComparisonNote;
  }

  const diagByBlock = new Map(diagnosis.perAnswer.map((d) => [d.blockIndex, d]));

  const overviewRows = metrics.items.map((m) => ({
    blockIndex: m.raw.blockIndex,
    title: m.raw.title,
    publishedRaw: m.raw.publishedRaw,
    ageDays: m.ageDays,
    ageText: m.ageDays !== null ? `${m.ageDays} 天` : '—',
    views: m.raw.views,
    upvotes: m.raw.upvotes,
    collects: m.raw.collects,
    comments: m.raw.comments,
    endorseLikes: m.raw.endorseLikes,
    shares: m.raw.shares,
    categoryTag: m.raw.categoryTag,
    upvoteRate: formatPercent(m.upvoteRate),
    collectRate: formatPercent(m.collectRate),
    commentRate: formatPercent(m.commentRate),
    engagementRate: formatPercent(m.engagementRate),
    collectUpvoteRatio: formatFixedHalfEven(m.collectUpvoteRatio, 2),
    isSmallSample: m.isSmallSample,
    isImmature: m.isImmature,
    rank: m.rank,
  }));

  const rankingItems = diagnosis.canRank
    ? metrics.ranked.map((m) => {
        const diag = diagByBlock.get(m.raw.blockIndex);
        const ratio = diag?.engagementRel.ratioToMedian;
        const medianRatioText =
          ratio !== null && ratio !== undefined
            ? `本批中位数的 ${formatFixedHalfEven(ratio, 2)} 倍`
            : '无中位数倍数';
        /** @type {string[]} */
        const tags = [];
        if (m.isSmallSample) {
          tags.push(`样本小（<${meta.settings.smallSampleThreshold}阅读）`);
        }
        if (m.isImmature) {
          tags.push(`数据龄不足 ${meta.settings.ageThresholdDays} 天`);
        }
        if (m.raw.categoryTag) {
          tags.push(m.raw.categoryTag);
        }
        return {
          rank: m.rank,
          title: m.raw.title,
          engagementRate: formatPercent(m.engagementRate),
          medianRatioText,
          views: m.raw.views,
          collectUpvoteRatio: formatFixedHalfEven(m.collectUpvoteRatio, 2),
          tags,
        };
      })
    : [];

  const commentInsights = {
    disclaimer: COMMENT_DISCLAIMER,
    items: diagnosis.perAnswer.map((d) => ({
      title: d.title,
      total: d.commentAnalysis.total,
      counts: d.commentAnalysis.counts,
      comments: d.commentAnalysis.items,
    })),
  };

  const tiedNote =
    diagnosis.canRank && diagnosis.allEngagementTied && metrics.ranked[0]?.engagementRate !== null
      ? `全批 ${metrics.items.length} 篇互动率完全一致（${formatPercent(metrics.ranked[0].engagementRate)}），无明显互动洼地。`
      : null;

  return {
    meta: {
      reviewId: meta.reviewId,
      createdAtUtcMs: meta.createdAtUtcMs,
      asOfUtcMs: metrics.asOfUtcMs,
      asOfDisplay: metrics.asOfDisplay,
      engineVersion: meta.engineVersion,
      isSample: meta.isSample,
      itemCount: metrics.items.length,
      earliestDate: metrics.timeSpan.earliestDate,
      latestDate: metrics.timeSpan.latestDate,
      spanDays: metrics.timeSpan.spanDays,
      ageThresholdDays: meta.settings.ageThresholdDays,
      smallSampleThreshold: meta.settings.smallSampleThreshold,
    },
    summary: {
      headline,
      disclaimer: RELATIVE_DISCLAIMER,
      sampleNotice: meta.isSample
        ? '当前展示为【内置示例数据（虚构）】，仅用于演示复盘流程，不会写入您的个人真实历史基线。'
        : null,
      historyComparisonNote: diagnosis.historyComparisonNote,
      weightedEngagementRate: weightedStr,
      medianEngagementRate: medianStr,
      engagementSpreadPp: spreadStr,
    },
    overviewRows,
    totals: {
      views: metrics.totals.views,
      upvotes: metrics.totals.upvotes,
      collects: metrics.totals.collects,
      comments: metrics.totals.comments,
      interactions: metrics.totals.interactions,
      endorseLikes: metrics.totals.endorseLikes,
      shares: metrics.totals.shares,
      hasEndorseLikes: metrics.totals.hasEndorseLikes,
      hasShares: metrics.totals.hasShares,
      weightedEngagementRate: weightedStr,
    },
    formulasNote: FORMULAS_NOTE,
    canRank: diagnosis.canRank,
    rankingItems,
    ageAndSampleWarnings: diagnosis.ageAndSampleWarnings,
    roles: {
      allEngagementTied: diagnosis.allEngagementTied,
      tiedNote,
      best: diagnosis.roles.best,
      benchmark: diagnosis.roles.benchmark,
      worst: diagnosis.roles.worst,
      topOpportunity: diagnosis.roles.topOpportunity,
    },
    commentInsights,
    actions: diagnosis.actions,
    crossPeriodDeltas: meta.deltas ?? [],
    nextTemplate: buildNextReviewTemplate(metrics),
    aiSection: meta.aiDiagnosis ?? null,
  };
}

/**
 * 将表格单元格中的管道符转义，避免破坏 Markdown 表格。
 * @param {string} text
 * @returns {string}
 */
function escMdCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * 将 ReportModel 序列化为全新原创知乎复盘报告 Markdown（详细设计 §4.2）。
 * @param {import('../types.js').ReportModel} model
 * @returns {string}
 */
export function serializeReportToMarkdown(model) {
  const { meta, summary, overviewRows, totals } = model;
  const dateRange =
    meta.earliestDate && meta.latestDate
      ? `${meta.earliestDate} 至 ${meta.latestDate}`
      : '日期未完整标注';

  /** @type {string[]} */
  const out = [];

  out.push(`# 知乎回答表现复盘报告（${dateRange} · 共 ${meta.itemCount} 篇）`);
  out.push('');
  out.push(
    `> 数据截至时间：${meta.asOfDisplay}｜引擎版本：v${meta.engineVersion}｜口径声明：${summary.disclaimer}`,
  );
  if (summary.sampleNotice) {
    out.push(`> ⚠️ ${summary.sampleNotice}`);
  }
  out.push('');

  // 核心摘要
  out.push('## 核心摘要');
  out.push('');
  out.push(summary.headline);
  out.push('');

  // 指标总览与计算口径
  out.push('## 指标总览与计算口径');
  out.push('');
  out.push('| 问题标题 | 发布时间 | 数据龄 | 阅读 | 赞同 | 收藏 | 评论 | 赞同率 | 收藏率 | 评论率 | 互动率 | 收赞比 |');
  out.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of overviewRows) {
    out.push(
      `| ${escMdCell(row.title)} | ${escMdCell(row.publishedRaw)} | ${row.ageText} | ${row.views} | ${row.upvotes} | ${row.collects} | ${row.comments} | ${row.upvoteRate} | ${row.collectRate} | ${row.commentRate} | ${row.engagementRate} | ${row.collectUpvoteRatio} |`,
    );
  }
  out.push('');

  let totalsLine = `- **汇总数字**：阅读 ${totals.views}｜赞同 ${totals.upvotes}｜收藏 ${totals.collects}｜评论 ${totals.comments}`;
  if (totals.hasEndorseLikes || totals.hasShares) {
    const extras = [];
    if (totals.hasEndorseLikes) extras.push(`喜欢 ${totals.endorseLikes}`);
    if (totals.hasShares) extras.push(`分享 ${totals.shares}`);
    totalsLine += `｜${extras.join('｜')}（注：喜欢与分享不计入互动率）`;
  }
  out.push(totalsLine);
  out.push(
    `- **加权平均互动率**：${totals.weightedEngagementRate}（计算式：${totals.interactions} ÷ ${totals.views} × 100%，非各篇算术平均）`,
  );
  if (meta.spanDays !== null && meta.earliestDate && meta.latestDate) {
    out.push(
      `- **发布时间跨度**：${meta.spanDays} 天（最早 ${meta.earliestDate}，最晚 ${meta.latestDate}；数据龄按“数据截至时间 − 发布时间”向下取整计算）`,
    );
  }
  out.push('- **指标算式（可自行验算）**：');
  for (const note of model.formulasNote) {
    out.push(`  - ${note}`);
  }

  if (model.ageAndSampleWarnings.length > 0) {
    out.push('');
    out.push('**样本与数据龄提示**：');
    for (const w of model.ageAndSampleWarnings) {
      out.push(`- ${w}`);
    }
  }
  out.push('');

  // 互动率梯队排名
  out.push('## 互动率梯队排名');
  out.push('');
  if (!model.canRank) {
    out.push('当前不足 3 篇，暂不生成横向排名与角色诊断，请补充至 3 篇以上。');
  } else {
    for (const r of model.rankingItems) {
      const tagText = r.tags.length > 0 ? ` [${r.tags.join(' / ')}]` : '';
      out.push(
        `${r.rank}. 《${r.title}》—— 互动率 ${r.engagementRate}（${r.medianRatioText}）｜阅读 ${r.views}｜收赞比 ${r.collectUpvoteRatio}${tagText}`,
      );
    }
  }
  out.push('');

  // 分维度角色诊断
  out.push('## 分维度角色诊断');
  out.push('');
  if (!model.canRank) {
    out.push('当前录入篇数不足 3 篇，暂不进行跨回答角色判定；下方仍展示已粘贴的代表性评论解析。');
    out.push('');
  } else {
    const roleList = [model.roles.best, model.roles.benchmark, model.roles.worst, model.roles.topOpportunity];
    for (const card of roleList) {
      if (!card) continue;
      const suffix = card.isImmature ? '（数据龄不足，仅供参考）' : '';
      out.push(`### ${card.roleTitle}：《${card.answerTitle}》${suffix}`);
      for (const b of card.bullets) {
        out.push(`- ${b}`);
      }
      out.push('');
    }
    if (model.roles.tiedNote) {
      out.push(`- ${model.roles.tiedNote}`);
      out.push('');
    }
  }

  // 评论区读者信号解析
  out.push('### 评论区读者信号解析');
  out.push('');
  out.push(`> 说明：${model.commentInsights.disclaimer}`);
  out.push('');
  const hasAnyComments = model.commentInsights.items.some((c) => c.total > 0);
  if (!hasAnyComments) {
    out.push('- 本次未粘贴代表性评论；下次复盘建议每篇摘录 3–5 条代表性评论，以辅助识别读者质疑与追问。');
  } else {
    for (const ci of model.commentInsights.items) {
      const c = ci.counts;
      out.push(
        `- 《${ci.title}》（共采样 ${ci.total} 条）：质疑求证 ${c.question_doubt} 条｜追问 ${c.follow_up} 条｜催更/蹲后续 ${c.urge_update} 条｜收藏标记 ${c.bookmark_mark} 条｜认可 ${c.endorsement} 条｜未分类 ${c.unclassified} 条`,
      );
      for (const item of ci.comments) {
        out.push(`  - [${item.label}] ${item.text}`);
      }
    }
  }
  out.push('');

  // 行动建议清单
  out.push('## 行动建议清单');
  out.push('');
  model.actions.forEach((act, idx) => {
    out.push(`### ${idx + 1}. ${act.title}`);
    out.push(`- 定位问题：${act.problem}`);
    out.push(`- 数据依据：${act.evidence}`);
    out.push(`- 执行动作：${act.action}`);
    out.push(`- 建议档位：${act.priority}`);
    out.push('');
  });

  // 增量追踪与下次复盘模板
  out.push('## 增量追踪与下次复盘模板');
  out.push('');
  if (model.crossPeriodDeltas.length > 0) {
    out.push('### 跨期对比');
    out.push('');
    for (const d of model.crossPeriodDeltas) {
      const fmtSign = (n) => (n >= 0 ? `+${n}` : `${n}`);
      if (d.hasAnomaly) {
        out.push(
          `- 《${d.title}》（对比 ${d.prevAsOfDisplay}）：阅读 ${fmtSign(d.viewsDelta)}｜赞同 ${fmtSign(d.upvotesDelta)}｜收藏 ${fmtSign(d.collectsDelta)}｜评论 ${fmtSign(d.commentsDelta)}｜⚠️ 存在负增量，请核对抄录数据或取消赞同/删评波动`,
        );
      } else if (d.viewsDelta === 0) {
        out.push(
          `- 《${d.title}》（对比 ${d.prevAsOfDisplay}）：阅读无增长（+0）｜赞同 ${fmtSign(d.upvotesDelta)}｜收藏 ${fmtSign(d.collectsDelta)}｜评论 ${fmtSign(d.commentsDelta)}`,
        );
      } else {
        out.push(
          `- 《${d.title}》（对比 ${d.prevAsOfDisplay}）：阅读 ${fmtSign(d.viewsDelta)}｜赞同 ${fmtSign(d.upvotesDelta)}｜收藏 ${fmtSign(d.collectsDelta)}｜评论 ${fmtSign(d.commentsDelta)}｜期间增量互动率 ${formatPercent(d.incrementalEngagementRate)}`,
        );
      }
    }
    out.push('');
  }

  out.push('### 下次复盘粘贴块（可直接复制修改数字后再次复盘）');
  out.push('');
  out.push('```text');
  out.push(model.nextTemplate);
  out.push('```');

  // AI 深度语义诊断（可选）
  if (model.aiSection) {
    out.push('');
    out.push('## AI 深度语义诊断');
    out.push('');
    out.push(`> ${model.aiSection.disclaimer}`);
    if (model.aiSection.verification.hasUnverified) {
      out.push(
        `> ⚠️ 检测到 AI 输出包含 ${model.aiSection.verification.unverifiedCount} 处未在计算结果中核验到的数字（${model.aiSection.verification.unverifiedTokens.join('、')}），请以确定性总览表为准。`,
      );
    }
    out.push('');
    out.push(`**整体语义判断**：${model.aiSection.overallInsight}`);
    out.push('');
    if (model.aiSection.commentReinterpretation.length > 0) {
      out.push('**评论信号语义复核**：');
      for (const line of model.aiSection.commentReinterpretation) {
        out.push(`- ${line}`);
      }
      out.push('');
    }
    if (model.aiSection.rewriteSuggestions.length > 0) {
      out.push('**原回答改写建议**：');
      for (const s of model.aiSection.rewriteSuggestions) {
        out.push(`- **《${s.targetTitle}》**：${s.diagnosis}`);
        out.push(`  - 可直接应用的改写参考：${s.concreteEdit}`);
      }
    }
  }

  return out.join('\n');
}
