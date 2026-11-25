// @ts-check

import { analyzeComments } from './comments.js';
import { formatFixedHalfEven, formatPercent, roundHalfEvenInt } from './round.js';

/**
 * 确定性相对诊断引擎（对应详细设计 §3.2、§3.3、§3.5）：
 * - D1 相对诊断（批内中位数 1.50 / 0.67 倍、收赞比结构信号、个人历史基线 >= 10 篇）
 * - 小样本（< 200）与数据龄（< 阈值）保护
 * - 四大核心角色判定与并列处理
 * - 知乎原生态行动建议清单（最多 5 条，三档优先级）
 */

const HIGH_MULTIPLIER = 1.5;
const LOW_MULTIPLIER = 0.67;
const TIE_EPSILON = 1e-12;
const GAP_TIE_EPSILON = 1e-6;
const MAX_ACTIONS = 5;

/**
 * 计算单项比率相对批内中位数的倍数与档位。
 * @param {number|null} value
 * @param {number|null} median
 * @returns {import('../types.js').RelativeMetricEval}
 */
export function evaluateRelativeToMedian(value, median) {
  if (value === null || median === null || median === 0) {
    return { ratioToMedian: null, level: 'na', description: '暂无中位数倍数对照' };
  }
  const ratio = value / median;
  const ratioStr = formatFixedHalfEven(ratio, 2);
  if (ratio >= HIGH_MULTIPLIER) {
    return {
      ratioToMedian: ratio,
      level: 'high',
      description: `明显高于本批中位数，为中位数的 ${ratioStr} 倍`,
    };
  }
  if (ratio <= LOW_MULTIPLIER) {
    return {
      ratioToMedian: ratio,
      level: 'low',
      description: `明显低于本批中位数，仅为中位数的 ${ratioStr} 倍`,
    };
  }
  return {
    ratioToMedian: ratio,
    level: 'normal',
    description: `与本批中位水平接近，为中位数的 ${ratioStr} 倍`,
  };
}

/**
 * @param {import('../types.js').AnswerMetrics} item
 * @param {import('../types.js').RelativeMetricEval} upvoteRel
 * @param {import('../types.js').RelativeMetricEval} collectRel
 * @returns {string}
 */
function describeStructureSignal(item, upvoteRel, collectRel) {
  const ratio = item.collectUpvoteRatio;
  if (ratio !== null && ratio >= 1.0) {
    return `收赞比 ${formatFixedHalfEven(ratio, 2)}（收藏 ${item.raw.collects} ≥ 赞同 ${item.raw.upvotes}），干货/工具属性强，读者倾向留存复用。`;
  }
  if (ratio !== null && ratio < 0.5 && (upvoteRel.ratioToMedian ?? 0) > 1.0) {
    return `收赞比 ${formatFixedHalfEven(ratio, 2)} 且赞同率高于中位水平，属于观点/共鸣表达型回答，读者愿意公开赞同表态，但留存需求偏弱。`;
  }
  if (collectRel.level === 'low') {
    return `收藏率 ${formatPercent(item.collectRate)}（${collectRel.description}），收赞比 ${formatFixedHalfEven(ratio, 2)}，实用留存抓手偏弱。`;
  }
  return `收赞比 ${formatFixedHalfEven(ratio, 2)}，赞同率 ${formatPercent(item.upvoteRate)}、收藏率 ${formatPercent(item.collectRate)}、评论率 ${formatPercent(item.commentRate)}，各项互动结构较均衡。`;
}

/**
 * @param {import('../types.js').AnswerMetrics} item
 * @returns {string}
 */
function findWeakestSubMetricText(item) {
  const candidates = [
    { name: '赞同率', val: item.upvoteRate },
    { name: '收藏率', val: item.collectRate },
    { name: '评论率', val: item.commentRate },
  ].filter((c) => c.val !== null);
  if (candidates.length === 0) return '各分项比率（阅读为 0 无法计算）';
  candidates.sort((a, b) => /** @type {number} */ (a.val) - /** @type {number} */ (b.val));
  return `${candidates[0].name}（${formatPercent(candidates[0].val)}）`;
}

/**
 * 生成整批相对诊断、四角色判定与最多 5 条行动建议。
 * @param {import('../types.js').BatchMetrics} metrics
 * @param {import('../types.js').HistoryBaseline|null} historyBaseline
 * @param {import('../types.js').Settings} settings
 * @returns {import('../types.js').DiagnosisResult}
 */
export function diagnoseBatch(metrics, historyBaseline, settings) {
  const ageThresholdDays = settings?.ageThresholdDays ?? 7;
  const smallSampleThreshold = settings?.smallSampleThreshold ?? 200;

  const validItems = metrics.items.filter((m) => m.engagementRate !== null);
  const canRank = metrics.items.length >= 3 && validItems.length > 0;
  const allSmallSample = validItems.length > 0 && validItems.every((m) => m.isSmallSample);

  /** @type {string[]} */
  const ageAndSampleWarnings = [];

  if (metrics.timeSpan.hasLargeAgeSpread) {
    ageAndSampleWarnings.push(
      `本批回答发布新旧跨度较大（数据龄 ${metrics.timeSpan.minAgeDays} 天至 ${metrics.timeSpan.maxAgeDays} 天），绝对阅读量不可直接横向对比，请重点观察各项比率与跨期增量。`,
    );
  }
  if (allSmallSample) {
    ageAndSampleWarnings.push(
      `全批 ${validItems.length} 篇回答阅读量均低于 ${smallSampleThreshold}（小样本），比率受单次互动波动影响较大，以下诊断仅供参考。`,
    );
  } else {
    for (const m of metrics.items) {
      if (m.isSmallSample) {
        ageAndSampleWarnings.push(
          `《${m.raw.title}》当前阅读 ${m.raw.views}（低于 ${smallSampleThreshold}），属于小样本，比率波动较大，选拔“表现最优/标杆”时将优先考察非小样本回答。`,
        );
      }
    }
  }
  for (const m of metrics.items) {
    if (m.isImmature) {
      ageAndSampleWarnings.push(
        `《${m.raw.title}》数据龄为 ${m.ageDays} 天（低于设定提示阈值 ${ageThresholdDays} 天），首轮分发可能尚未结束，涉及该篇的结论标注“仅供参考”。`,
      );
    }
  }

  // 个人历史基线对比（累计 >= 10 篇有效历史回答时启用）
  let historyComparisonNote = null;
  if (
    historyBaseline &&
    historyBaseline.sampleCount >= 10 &&
    historyBaseline.medianEngagementRate !== null &&
    metrics.weightedEngagementRate !== null
  ) {
    const diffPp = metrics.weightedEngagementRate - historyBaseline.medianEngagementRate;
    const absPp = formatFixedHalfEven(Math.abs(diffPp), 2);
    const direction = diffPp >= 0 ? '高出' : '低于';
    historyComparisonNote = `较你过往 ${historyBaseline.sampleCount} 篇真实回答的历史中位数（${formatPercent(historyBaseline.medianEngagementRate)}）${direction} ${absPp} 个百分点。`;
  }

  // 逐篇相对诊断 + 知乎五类评论分析（严格消费脱敏评论）
  /** @type {import('../types.js').AnswerDiagnosis[]} */
  const perAnswer = metrics.items.map((m) => {
    const upvoteRel = canRank
      ? evaluateRelativeToMedian(m.upvoteRate, metrics.medians.upvoteRate)
      : { ratioToMedian: null, level: /** @type {'na'} */ ('na'), description: '不足 3 篇不作批内倍数对比' };
    const collectRel = canRank
      ? evaluateRelativeToMedian(m.collectRate, metrics.medians.collectRate)
      : { ratioToMedian: null, level: /** @type {'na'} */ ('na'), description: '不足 3 篇不作批内倍数对比' };
    const commentRel = canRank
      ? evaluateRelativeToMedian(m.commentRate, metrics.medians.commentRate)
      : { ratioToMedian: null, level: /** @type {'na'} */ ('na'), description: '不足 3 篇不作批内倍数对比' };
    const engagementRel = canRank
      ? evaluateRelativeToMedian(m.engagementRate, metrics.medians.engagementRate)
      : { ratioToMedian: null, level: /** @type {'na'} */ ('na'), description: '不足 3 篇不作批内倍数对比' };

    const commentAnalysis = analyzeComments(m.raw.maskedCommentsText);

    let categoryReferenceNote = null;
    if (m.raw.categoryTag) {
      const catStats = historyBaseline?.byCategory?.[m.raw.categoryTag];
      if (catStats && catStats.sampleCount >= 5 && catStats.medianEngagementRate !== null) {
        categoryReferenceNote = `同类型（${m.raw.categoryTag}）历史中位参考（${catStats.sampleCount} 篇）：${formatPercent(catStats.medianEngagementRate)}`;
      }
    }

    return {
      title: m.raw.title,
      blockIndex: m.raw.blockIndex,
      upvoteRel,
      collectRel,
      commentRel,
      engagementRel,
      structureSignal: describeStructureSignal(m, upvoteRel, collectRel),
      commentAnalysis,
      categoryReferenceNote,
    };
  });

  const diagByBlock = new Map(perAnswer.map((d) => [d.blockIndex, d]));

  // 极差与全并列检查
  const rankedValid = metrics.ranked.filter((m) => m.engagementRate !== null);
  let engagementSpreadPp = null;
  let allEngagementTied = false;
  if (rankedValid.length >= 2) {
    const topRate = /** @type {number} */ (rankedValid[0].engagementRate);
    const botRate = /** @type {number} */ (rankedValid[rankedValid.length - 1].engagementRate);
    engagementSpreadPp = topRate - botRate;
    allEngagementTied = Math.abs(engagementSpreadPp) < TIE_EPSILON;
  }

  /** @type {{best: import('../types.js').RoleCard|null, benchmark: import('../types.js').RoleCard|null, worst: import('../types.js').RoleCard|null, topOpportunity: import('../types.js').RoleCard|null}} */
  const roles = {
    best: null,
    benchmark: null,
    worst: null,
    topOpportunity: null,
  };

  if (canRank) {
    const nonSmallPool = validItems.filter((m) => !m.isSmallSample);
    const elitePool = nonSmallPool.length > 0 ? nonSmallPool : validItems;

    // 1. 本期表现最优 (best)
    const eliteByEng = [...elitePool].sort(
      (a, b) => /** @type {number} */ (b.engagementRate) - /** @type {number} */ (a.engagementRate),
    );
    const bestItem = eliteByEng[0];
    const bestTied = eliteByEng
      .filter((m) => Math.abs(/** @type {number} */ (m.engagementRate) - /** @type {number} */ (bestItem.engagementRate)) < TIE_EPSILON)
      .slice(1)
      .map((m) => m.raw.title);
    const bestDiag = /** @type {import('../types.js').AnswerDiagnosis} */ (diagByBlock.get(bestItem.raw.blockIndex));

    const bestBullets = [
      `互动表现：互动率 ${formatPercent(bestItem.engagementRate)}（本批中位数 ${formatPercent(metrics.medians.engagementRate)}，${bestDiag.engagementRel.description}），其中赞同率 ${formatPercent(bestItem.upvoteRate)}、收藏率 ${formatPercent(bestItem.collectRate)}、评论率 ${formatPercent(bestItem.commentRate)}。`,
      `结构特征：${bestDiag.structureSignal}`,
    ];
    if (bestTied.length > 0) {
      bestBullets.push(`并列说明：与《${bestTied.join('》《')}》互动率并列第一，按输入顺序取首篇为主展示。`);
    }

    roles.best = {
      key: 'best',
      roleTitle: '本期表现最优',
      answerTitle: bestItem.raw.title,
      blockIndex: bestItem.raw.blockIndex,
      isImmature: bestItem.isImmature,
      isSmallSample: bestItem.isSmallSample,
      tiedTitles: bestTied,
      bullets: bestBullets,
    };

    // 2. 本期干货/标杆样本 (benchmark)
    // Q5: 最高阅读量按严格 > 从头遍历，并列取先出现者
    let highestViewsItem = metrics.items[0];
    for (let i = 1; i < metrics.items.length; i += 1) {
      if (metrics.items[i].raw.views > highestViewsItem.raw.views) {
        highestViewsItem = metrics.items[i];
      }
    }

    let benchmarkItem = null;
    let benchmarkReason = '';
    /** @type {string[]} */
    let benchmarkTied = [];

    // 优先级①：双冠标杆（最高阅读量且在非小样本/全池中最高互动率）
    if (
      highestViewsItem.raw.blockIndex === bestItem.raw.blockIndex ||
      (highestViewsItem.engagementRate !== null &&
        Math.abs(highestViewsItem.engagementRate - /** @type {number} */ (bestItem.engagementRate)) < TIE_EPSILON &&
        (!highestViewsItem.isSmallSample || allSmallSample))
    ) {
      benchmarkItem = highestViewsItem;
      benchmarkReason = `双冠标杆：同时拿下本期最高阅读（${benchmarkItem.raw.views}）与最高互动率（${formatPercent(benchmarkItem.engagementRate)}），选题流量与内容转化兼优。`;
    } else {
      // 优先级②：非小样本中 collectUpvoteRatio >= 1.0 且 collectRate 最高者
      const dryGoodsPool = elitePool.filter(
        (m) => m.collectUpvoteRatio !== null && m.collectUpvoteRatio >= 1.0 && m.collectRate !== null,
      );
      const candidatePool = dryGoodsPool.length > 0 ? dryGoodsPool : elitePool.filter((m) => m.collectRate !== null);
      const sortedBench = [...candidatePool].sort((a, b) => {
        const diff = /** @type {number} */ (b.collectRate) - /** @type {number} */ (a.collectRate);
        if (Math.abs(diff) >= TIE_EPSILON) return diff;
        return b.raw.views - a.raw.views;
      });
      benchmarkItem = sortedBench[0];
      benchmarkTied = sortedBench
        .slice(1)
        .filter((m) => Math.abs(/** @type {number} */ (m.collectRate) - /** @type {number} */ (benchmarkItem.collectRate)) < TIE_EPSILON)
        .map((m) => m.raw.title);
      const bDiag = /** @type {import('../types.js').AnswerDiagnosis} */ (diagByBlock.get(benchmarkItem.raw.blockIndex));
      benchmarkReason =
        dryGoodsPool.length > 0
          ? `干货标杆：收藏率 ${formatPercent(benchmarkItem.collectRate)}（${bDiag.collectRel.description}），收赞比 ${formatFixedHalfEven(benchmarkItem.collectUpvoteRatio, 2)}（收藏 ${benchmarkItem.raw.collects} ≥ 赞同 ${benchmarkItem.raw.upvotes}），具备明显工具留存价值。`
          : `留存标杆：收藏率 ${formatPercent(benchmarkItem.collectRate)} 居本批候选最高，收赞比 ${formatFixedHalfEven(benchmarkItem.collectUpvoteRatio, 2)}。`;
    }

    const isCombinedWithBest = benchmarkItem.raw.blockIndex === bestItem.raw.blockIndex;
    const medianViews = (() => {
      const sortedViews = metrics.items.map((m) => m.raw.views).sort((a, b) => a - b);
      const mid = Math.floor(sortedViews.length / 2);
      return sortedViews.length % 2 === 1
        ? sortedViews[mid]
        : (sortedViews[mid - 1] + sortedViews[mid]) / 2;
    })();

    const benchmarkBullets = [
      `复用价值：${benchmarkReason}`,
      benchmarkItem.raw.views < medianViews
        ? `短板观察：当前阅读 ${benchmarkItem.raw.views} 低于本批阅读中位数（${roundHalfEvenInt(medianViews)}），内容质量在线但曝光不足，可能受选题热度、回答时机或首屏前几行吸引力限制。`
        : `流量匹配：阅读 ${benchmarkItem.raw.views} 达到或高于本批中位水平，建议拆解其开头结构与清单写法在后续回答中复用。`,
    ];
    if (benchmarkTied.length > 0) {
      benchmarkBullets.push(`并列说明：收藏率与《${benchmarkTied.join('》《')}》并列，按阅读量更高优先取本篇。`);
    }

    roles.benchmark = {
      key: 'benchmark',
      roleTitle: isCombinedWithBest ? '本期干货/标杆样本（兼任综合最优）' : '本期干货/标杆样本',
      answerTitle: benchmarkItem.raw.title,
      blockIndex: benchmarkItem.raw.blockIndex,
      isImmature: benchmarkItem.isImmature,
      isSmallSample: benchmarkItem.isSmallSample,
      tiedTitles: benchmarkTied,
      bullets: benchmarkBullets,
      isCombinedWithBest,
    };

    // 3. 本期最需警惕（互动洼地）(worst)
    if (!allEngagementTied) {
      const minRate = /** @type {number} */ (rankedValid[rankedValid.length - 1].engagementRate);
      const tiedWorst = rankedValid.filter(
        (m) => Math.abs(/** @type {number} */ (m.engagementRate) - minRate) < TIE_EPSILON,
      );
      // 末尾并列时优先警惕阅读量更大者
      const worstSorted = [...tiedWorst].sort((a, b) => b.raw.views - a.raw.views);
      const worstItem = worstSorted[0];
      const worstTiedTitles = worstSorted.slice(1).map((m) => m.raw.title);
      const worstDiag = /** @type {import('../types.js').AnswerDiagnosis} */ (diagByBlock.get(worstItem.raw.blockIndex));
      const belowMedianPp =
        metrics.medians.engagementRate !== null
          ? formatFixedHalfEven(metrics.medians.engagementRate - /** @type {number} */ (worstItem.engagementRate), 2)
          : '—';

      const worstBullets = [
        `薄弱指标：互动率 ${formatPercent(worstItem.engagementRate)}，较本批中位数低 ${belowMedianPp} 个百分点（${worstDiag.engagementRel.description}）；分项中最低为 ${findWeakestSubMetricText(worstItem)}。`,
        '归因排查方向：答主无法修改问题标题本身，建议从首屏前 3 行留存、正文干货密度与信源完整度、问题下回答排序位置或是否触发折叠进行自查。',
      ];
      if (worstTiedTitles.length > 0) {
        worstBullets.push(`并列说明：与《${worstTiedTitles.join('》《')}》互动率并列最低，优先列出阅读量更大的一篇。`);
      }

      roles.worst = {
        key: 'worst',
        roleTitle: '本期最需警惕（互动洼地）',
        answerTitle: worstItem.raw.title,
        blockIndex: worstItem.raw.blockIndex,
        isImmature: worstItem.isImmature,
        isSmallSample: worstItem.isSmallSample,
        tiedTitles: worstTiedTitles,
        bullets: worstBullets,
      };
    }

    // 4. 投入产出优先级最高（待优化主力）(topOpportunity)
    if (!allEngagementTied && metrics.medians.engagementRate !== null) {
      const medEng = metrics.medians.engagementRate;
      const withGap = validItems
        .map((m) => ({
          item: m,
          gap: (m.raw.views * (medEng - /** @type {number} */ (m.engagementRate))) / 100,
        }))
        .filter((x) => x.gap > 0);

      let chosen = null;
      let chosenGap = null;

      if (withGap.length > 0) {
        withGap.sort((a, b) => {
          if (Math.abs(b.gap - a.gap) >= GAP_TIE_EPSILON) return b.gap - a.gap;
          return b.item.raw.views - a.item.raw.views;
        });
        chosen = withGap[0].item;
        chosenGap = withGap[0].gap;
      } else {
        // 退回：选阅读最高且收藏率最低者（若全部阅读与收藏率完全一致则跳过）
        const distinctViewsOrCollect =
          new Set(validItems.map((m) => `${m.raw.views}:${m.collectRate}`)).size > 1;
        if (distinctViewsOrCollect) {
          const fallback = [...validItems].sort((a, b) => {
            if (b.raw.views !== a.raw.views) return b.raw.views - a.raw.views;
            return (a.collectRate ?? 0) - (b.collectRate ?? 0);
          });
          chosen = fallback[0];
        }
      }

      if (chosen) {
        const oppBullets = chosenGap !== null
          ? [
              `潜在互动缺口：该篇阅读 ${chosen.raw.views}，当前互动率 ${formatPercent(chosen.engagementRate)} 低于本批中位数 ${formatPercent(medEng)}。若编辑优化后达到本批中位水平，预计可多撬动约 ${roundHalfEvenInt(chosenGap)} 次互动（算式：${chosen.raw.views} × (${formatPercent(medEng)} − ${formatPercent(chosen.engagementRate)}) ≈ ${roundHalfEvenInt(chosenGap)} 次）。`,
              '知乎长尾优势：知乎回答支持随时编辑并持续获取搜索与问题页长尾流量，优先改写该篇投入产出比最高。',
            ]
          : [
              `优化空间：本批均不低于中位互动率，该篇阅读 ${chosen.raw.views} 居高且收藏率 ${formatPercent(chosen.collectRate)} 相对偏弱，可通过补充清单或案例进一步提升留存。`,
            ];

        roles.topOpportunity = {
          key: 'topOpportunity',
          roleTitle: '投入产出优先级最高（待优化主力）',
          answerTitle: chosen.raw.title,
          blockIndex: chosen.raw.blockIndex,
          isImmature: chosen.isImmature,
          isSmallSample: chosen.isSmallSample,
          tiedTitles: [],
          bullets: oppBullets,
          potentialGap: chosenGap,
        };
      }
    }
  }

  // 生成知乎原生态行动建议清单（最多 5 条，对应详细设计 §3.5）
  /** @type {import('../types.js').ActionItem[]} */
  const candidates = [];
  /** @type {Set<string>} */
  const seenKeys = new Set();

  /** @param {string} dedupeKey @param {import('../types.js').ActionItem} item */
  const addAction = (dedupeKey, item) => {
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);
    candidates.push(item);
  };

  // 规则 1：任一篇存在质疑求证类评论 >= 1 条 -> 立即编辑原回答
  for (const diag of perAnswer) {
    if (diag.commentAnalysis.counts.question_doubt >= 1) {
      const sampleDoubt = diag.commentAnalysis.items.find((c) => c.category === 'question_doubt');
      addAction(`doubt:${diag.blockIndex}`, {
        title: `补齐信源回应《${diag.title.slice(0, 12)}》质疑`,
        problem: `《${diag.title}》评论区出现 ${diag.commentAnalysis.counts.question_doubt} 条“质疑求证”信号`,
        evidence: `采样 ${diag.commentAnalysis.total} 条评论中质疑求证占 ${diag.commentAnalysis.counts.question_doubt} 条（例如：“${sampleDoubt?.text ?? ''}”）。`,
        action: '针对质疑点（如数据来源、前提边界或逻辑推断）直接编辑原回答对应段落补充出处与适用范围，并在评论区置顶说明已修订位置。',
        priority: '立即编辑原回答',
      });
    }
  }

  // 规则 2：存在 topOpportunity 且潜在互动缺口 > 0 -> 立即编辑原回答
  if (roles.topOpportunity && roles.topOpportunity.potentialGap && roles.topOpportunity.potentialGap > 0) {
    const oppMetric = metrics.items.find((m) => m.raw.blockIndex === roles.topOpportunity?.blockIndex);
    if (oppMetric) {
      addAction(`opp:${oppMetric.raw.blockIndex}`, {
        title: `重构《${oppMetric.raw.title.slice(0, 12)}》首屏承接`,
        problem: `《${oppMetric.raw.title}》高阅读低互动，存在最大潜在互动缺口`,
        evidence: `阅读 ${oppMetric.raw.views}、互动率 ${formatPercent(oppMetric.engagementRate)}（中位数 ${formatPercent(metrics.medians.engagementRate)}），收藏率 ${formatPercent(oppMetric.collectRate)}、赞同率 ${formatPercent(oppMetric.upvoteRate)}，缺口约 ${roundHalfEvenInt(roles.topOpportunity.potentialGap)} 次互动。`,
        action: '立即编辑原回答首屏前 3 行，直接亮明核心结论与适用人群，并补充结构化小标题或可执行清单，承接已流入的问题页与搜索流量。',
        priority: '立即编辑原回答',
      });
    }
  }

  // 规则 3：任一篇存在追问类评论 >= 2 条或占评论 >= 40% -> 立即编辑原回答
  for (const diag of perAnswer) {
    const followCount = diag.commentAnalysis.counts.follow_up;
    const followRatio = diag.commentAnalysis.total > 0 ? followCount / diag.commentAnalysis.total : 0;
    if (followCount >= 2 || (diag.commentAnalysis.total > 0 && followRatio >= 0.4)) {
      const sampleFollow = diag.commentAnalysis.items.find((c) => c.category === 'follow_up');
      addAction(`followup:${diag.blockIndex}`, {
        title: `在《${diag.title.slice(0, 12)}》文末补追问小节`,
        problem: `《${diag.title}》存在读者高频追问的信息缺口`,
        evidence: `采样 ${diag.commentAnalysis.total} 条评论中有 ${followCount} 条属于追问（占比 ${formatPercent(followRatio * 100)}，如：“${sampleFollow?.text ?? ''}”）。`,
        action: '将评论区高频追问整理为“常见追问补充”小节追加到原回答末尾，降低新读者理解门槛并提升收藏转化。',
        priority: '立即编辑原回答',
      });
    }
  }

  // 规则 4：存在高阅读低互动回答且无明显质疑 -> 立即编辑原回答
  if (canRank && metrics.medians.engagementRate !== null) {
    let highestViews = metrics.items[0];
    for (let i = 1; i < metrics.items.length; i += 1) {
      if (metrics.items[i].raw.views > highestViews.raw.views) {
        highestViews = metrics.items[i];
      }
    }
    const hvDiag = diagByBlock.get(highestViews.raw.blockIndex);
    if (
      highestViews.engagementRate !== null &&
      highestViews.engagementRate < metrics.medians.engagementRate &&
      (hvDiag?.commentAnalysis.counts.question_doubt ?? 0) === 0
    ) {
      addAction(`highview_loweng:${highestViews.raw.blockIndex}`, {
        title: `加固《${highestViews.raw.title.slice(0, 12)}》正文留存`,
        problem: `《${highestViews.raw.title}》阅读最高但互动低于中位数`,
        evidence: `阅读 ${highestViews.raw.views} 居本批首位，但互动率 ${formatPercent(highestViews.engagementRate)} 低于中位数 ${formatPercent(metrics.medians.engagementRate)}。`,
        action: '检查首屏前几行与首图是否仅停留在情绪吸睛，在正文第一屏后补充可核验的数据或案例；同时自查排版过密或回答排序位置。',
        priority: '立即编辑原回答',
      });
    }
  }

  // 规则 5：高收藏标杆但阅读处于本批后半段 -> 下一篇回答应用
  if (roles.benchmark && metrics.items.length >= 3) {
    const benchMetric = metrics.items.find((m) => m.raw.blockIndex === roles.benchmark?.blockIndex);
    const sortedViews = metrics.items.map((m) => m.raw.views).sort((a, b) => a - b);
    const medianViews = sortedViews[Math.floor(sortedViews.length / 2)];
    if (benchMetric && benchMetric.raw.views < medianViews) {
      addAction(`bench_views:${benchMetric.raw.blockIndex}`, {
        title: '复用干货结构并前置选题热度',
        problem: `标杆回答《${benchMetric.raw.title}》转化高但阅读偏低`,
        evidence: `收藏率 ${formatPercent(benchMetric.collectRate)}、收赞比 ${formatFixedHalfEven(benchMetric.collectUpvoteRatio, 2)}，但阅读 ${benchMetric.raw.views} 低于本批中位阅读 ${medianViews}。`,
        action: '保留该回答的干货拆解结构与实操清单写法，下一篇优先挑选正在上升期的热榜或高搜索意图问题，争取尽早占领前排回答排序。',
        priority: '下一篇回答应用',
      });
    }
  }

  // 规则 6：存在催更/蹲后续评论 >= 1 条 -> 下一篇回答应用
  for (const diag of perAnswer) {
    if (diag.commentAnalysis.counts.urge_update >= 1) {
      const sampleUrge = diag.commentAnalysis.items.find((c) => c.category === 'urge_update');
      addAction(`urge:${diag.blockIndex}`, {
        title: `围绕《${diag.title.slice(0, 12)}》延伸续写`,
        problem: `《${diag.title}》评论区出现明确续写/蹲后续需求`,
        evidence: `检测到 ${diag.commentAnalysis.counts.urge_update} 条催更/蹲后续评论（例如：“${sampleUrge?.text ?? ''}”）。`,
        action: '围绕读者蹲守的延伸问题撰写新回答，并在原回答末尾附加互链引导长尾流量互导。',
        priority: '下一篇回答应用',
      });
    }
  }

  // 规则 7：数据龄不足或新旧差异大 -> 记录观察
  const immatureItems = metrics.items.filter((m) => m.isImmature);
  if (immatureItems.length > 0 || metrics.timeSpan.hasLargeAgeSpread) {
    addAction('age_observe', {
      title: '定期二次抄录观察长尾增量',
      problem: '部分回答处于首轮分发期或批内新旧跨度较大',
      evidence:
        immatureItems.length > 0
          ? `共有 ${immatureItems.length} 篇回答数据龄低于 ${ageThresholdDays} 天（如《${immatureItems[0].raw.title}》仅 ${immatureItems[0].ageDays} 天）。`
          : `本批回答数据龄跨度为 ${metrics.timeSpan.minAgeDays} 天至 ${metrics.timeSpan.maxAgeDays} 天。`,
      action: `对数据龄不足 ${ageThresholdDays} 天的回答暂不下最终定论，隔 3–7 天重新抄录数据生成复盘，通过“跨期增量对比”观察长尾表现。`,
      priority: '记录观察',
    });
  }

  // 规则 8：保底建议（不足 3 条时补充）
  if (candidates.length < 3) {
    addAction('baseline_fallback', {
      title: '建立固定周期抄录与排查习惯',
      problem: '需持续积累个人历史基线并排查低曝光原因',
      evidence: `当前批次共 ${metrics.items.length} 篇，累计总阅读 ${metrics.totals.views}、加权平均互动率 ${formatPercent(metrics.weightedEngagementRate)}。`,
      action: '若存在某篇阅读量明显偏低，自查是否在问题下排序靠后、问题已过热度期或存在折叠提示；保持每周固定抄录一次数据，满 10 篇后自动开启个人历史基线对照。',
      priority: '记录观察',
    });
  }

  // 截断至最多 5 条（按优先级权重排序：立即编辑原回答 > 下一篇回答应用 > 记录观察）
  /** @type {Record<import('../types.js').ActionPriority, number>} */
  const priorityOrder = {
    立即编辑原回答: 1,
    下一篇回答应用: 2,
    记录观察: 3,
  };
  candidates.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const actions = candidates.slice(0, MAX_ACTIONS);

  return {
    canRank,
    allSmallSample,
    allEngagementTied,
    engagementSpreadPp,
    ageAndSampleWarnings,
    historyComparisonNote,
    perAnswer,
    roles,
    actions,
    totalCandidateActions: candidates.length,
  };
}
