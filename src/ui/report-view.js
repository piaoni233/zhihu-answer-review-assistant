// @ts-check

import { el, showManualCopyModal, showModal, showToast } from './dom.js';
import { serializeReportToMarkdown } from '../core/report.js';
import { formatPercent } from '../core/round.js';
import {
  copyTextWithFallback,
  downloadTextFile,
  makeMarkdownFilename,
} from '../storage/backup.js';
import { getProviderById } from '../ai/providers.js';
import { buildConsentMessage } from '../ai/prompt.js';
import { splitTextWithUnverifiedMarks } from '../ai/verifier.js';
import { AiClientError } from '../ai/client.js';

/**
 * 复盘报告视图（详细设计 §4.1、§5.6、§6.1、§6.3、§6.4、§7）
 * 严格消费单一 ReportModel，保证屏幕渲染与导出 Markdown 数字 100% 一致。
 */

/**
 * 将含未核验数字标记的文本安全转为 DOM 片段（无 innerHTML，防 XSS）。
 * @param {string} text
 * @param {string[]} unverifiedTokens
 * @returns {DocumentFragment}
 */
function renderVerifiedTextNodes(text, unverifiedTokens) {
  const frag = document.createDocumentFragment();
  const segments = splitTextWithUnverifiedMarks(text, unverifiedTokens);
  for (const seg of segments) {
    if (seg.unverified) {
      frag.appendChild(
        el('mark', { className: 'unverified-num', title: '该数字未在确定性计算结果中核验到' }, [
          `${seg.text}[未核验]`,
        ]),
      );
    } else {
      frag.appendChild(document.createTextNode(seg.text));
    }
  }
  return frag;
}

/**
 * @param {import('../types.js').ActionPriority} priority
 * @returns {string}
 */
function priorityClass(priority) {
  if (priority === '立即编辑原回答') return 'badge-red';
  if (priority === '下一篇回答应用') return 'badge-blue';
  return 'badge-neutral';
}

/**
 * @param {{
 *   report: import('../types.js').ReportModel|null,
 *   settings: import('../types.js').Settings,
 *   hasApiKey: boolean,
 *   canRunLiveAi: boolean,
 *   onGoWorkspace: () => void,
 *   onGoSettings: () => void,
 *   onRunLiveAi: (signal: AbortSignal, tempKey?: string) => Promise<void>
 * }} props
 * @returns {HTMLElement}
 */
export function renderReportView(props) {
  const { report } = props;
  if (!report) {
    return el('section', { className: 'card empty-state-card' }, [
      el('h2', { className: 'section-title' }, ['尚未生成本次复盘报告']),
      el('p', { className: 'muted-text' }, [
        '请先在“复盘工作台”粘贴 3 篇以上知乎回答数据，或点击“载入示例（虚构）”一键体验完整复盘报告。',
      ]),
      el(
        'button',
        { type: 'button', className: 'btn btn-primary', onClick: props.onGoWorkspace },
        ['前往复盘工作台'],
      ),
    ]);
  }

  const root = el('div', { className: 'report-view' });

  // 状态徽标栏
  const hasImmature = report.overviewRows.some((r) => r.isImmature);
  const hasSmall = report.overviewRows.some((r) => r.isSmallSample);
  const badges = [
    el('span', { className: 'badge badge-blue' }, [`共 ${report.meta.itemCount} 篇`]),
    el('span', { className: 'badge badge-neutral' }, [`数据截至 ${report.meta.asOfDisplay}`]),
    el('span', { className: 'badge badge-neutral' }, [`引擎 v${report.meta.engineVersion}`]),
  ];
  if (report.meta.isSample) {
    badges.unshift(el('span', { className: 'badge badge-amber', id: 'report-sample-badge' }, ['示例数据（虚构）']));
  }
  if (hasImmature) {
    badges.push(el('span', { className: 'badge badge-amber' }, [`含数据龄不足 ${report.meta.ageThresholdDays} 天篇目`]));
  }
  if (hasSmall) {
    badges.push(el('span', { className: 'badge badge-amber' }, [`含小样本（<${report.meta.smallSampleThreshold}阅读）`]));
  }

  const handleDownloadMd = () => {
    const md = serializeReportToMarkdown(report);
    const filename = makeMarkdownFilename(report.meta.asOfUtcMs);
    const ok = downloadTextFile(filename, md, 'text/markdown;charset=utf-8', true);
    if (ok) {
      showToast(`已触发下载：${filename}`, 'success');
    } else {
      showManualCopyModal('导出 Markdown（手动复制兜底）', md);
    }
  };

  const handleCopyMd = async () => {
    const md = serializeReportToMarkdown(report);
    const res = await copyTextWithFallback(md);
    if (res.copied) {
      showToast('已复制完整 Markdown 报告到剪贴板', 'success');
    } else {
      showManualCopyModal('复制 Markdown 全文', md);
    }
  };

  // AI 实时状态容器（局部更新，不影响确定性报告阅读）
  const aiStatusBox = el('div', { className: 'ai-status-box', id: 'ai-status-box' });
  /** @type {AbortController|null} */
  let activeAiAbort = null;

  const triggerLiveAiFlow = (tempKey = '') => {
    const provider = getProviderById(props.settings.aiProviderId);
    const consentText = buildConsentMessage(provider);

    showModal({
      title: '数据发送确认',
      body: el('div', {}, [
        el('p', {}, [consentText]),
        el('p', { className: 'muted-text small-note' }, [
          `目标模型：${props.settings.aiModel || provider.defaultModel}；所有指标数字均由本地引擎算好后传入，大模型返回后将再次进行确定性数字核验。`,
        ]),
      ]),
      confirmText: '确认并分析',
      cancelText: '取消',
      onConfirm: async () => {
        activeAiAbort = new AbortController();
        aiStatusBox.replaceChildren(
          el('div', { className: 'ai-loading-bar' }, [
            el('span', {}, [`正在由 ${provider.name} 分析评论与正文结构（最长 30 秒）…`]),
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-ghost btn-sm',
                onClick: () => {
                  activeAiAbort?.abort();
                  aiStatusBox.replaceChildren(
                    el('div', { className: 'alert-box alert-info' }, ['已取消本次 AI 请求。']),
                  );
                },
              },
              ['取消请求'],
            ),
          ]),
        );

        try {
          await props.onRunLiveAi(activeAiAbort.signal, tempKey);
          showToast('实时 AI 深度诊断已完成并完成数字核验', 'success');
        } catch (err) {
          if (err && typeof err === 'object' && /** @type {any} */ (err).name === 'AbortError') {
            return;
          }
          const msg =
            err instanceof AiClientError
              ? err.message
              : '请求大模型失败，请检查网络或配置后重试；此错误不影响上方确定性报告。';
          aiStatusBox.replaceChildren(
            el('div', { className: 'alert-box alert-error', role: 'alert' }, [
              el('div', { className: 'alert-title' }, ['AI 深度诊断未能完成']),
              el('p', {}, [msg]),
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-secondary btn-sm',
                  onClick: () => triggerLiveAiFlow(tempKey),
                },
                ['重试 AI 诊断'],
              ),
            ]),
          );
        } finally {
          activeAiAbort = null;
        }
      },
    });
  };

  const handleRunLiveAiClick = () => {
    if (!props.canRunLiveAi) {
      showToast('请先在工作台生成当前复盘后再运行实时 AI 诊断', 'warning');
      return;
    }
    if (props.hasApiKey) {
      triggerLiveAiFlow();
      return;
    }
    // 未配置 Key 时弹窗允许临时填入或跳转设置
    const tempKeyInput = /** @type {HTMLInputElement} */ (
      el('input', {
        type: 'password',
        className: 'input-control',
        placeholder: '输入自有大模型 API Key（仅本次请求使用）',
        autocomplete: 'off',
      })
    );
    showModal({
      title: '尚未配置自有 API Key',
      body: el('div', {}, [
        el('p', {}, [
          '实时 AI 深度诊断采用“用户自备 Key 浏览器直连”模式，请求不经过我方服务器。您可在此临时输入 Key，或前往“设置与备份”配置服务商与模型。',
        ]),
        el('label', { className: 'form-field' }, [
          el('span', {}, [`临时 API Key（当前服务商：${getProviderById(props.settings.aiProviderId).name}）`]),
          tempKeyInput,
        ]),
        el(
          'button',
          {
            type: 'button',
            className: 'link-btn',
            onClick: () => props.onGoSettings(),
          },
          ['前往“设置与备份”切换服务商或保存 Key →'],
        ),
      ]),
      confirmText: '继续并确认发送',
      cancelText: '暂不运行',
      onConfirm: () => {
        const key = tempKeyInput.value.trim();
        if (!key) {
          showToast('未填写 API Key，已取消调用', 'warning');
          return;
        }
        triggerLiveAiFlow(key);
      },
    });
  };

  const topActionCard = el('section', { className: 'card report-toolbar-card' }, [
    el('div', { className: 'badge-row' }, badges),
    el('div', { className: 'action-btn-group' }, [
      el(
        'button',
        { type: 'button', id: 'export-md-btn', className: 'btn btn-primary', onClick: handleDownloadMd },
        ['导出 Markdown（下载）'],
      ),
      el(
        'button',
        { type: 'button', id: 'copy-md-btn', className: 'btn btn-secondary', onClick: handleCopyMd },
        ['复制 Markdown 全文'],
      ),
      el(
        'button',
        { type: 'button', id: 'run-live-ai-btn', className: 'btn btn-outline', onClick: handleRunLiveAiClick },
        [report.aiSection?.mode === 'live_byok' ? '重新运行实时 AI 诊断' : '运行实时 AI 深度诊断（BYOK）'],
      ),
    ]),
  ]);
  root.appendChild(topActionCard);

  // 1. 核心摘要卡片
  const kpiCards = el('div', { className: 'kpi-grid' }, [
    el('div', { className: 'kpi-item' }, [
      el('div', { className: 'kpi-label' }, ['总阅读']),
      el('div', { className: 'kpi-value tabular-nums' }, [String(report.totals.views)]),
    ]),
    el('div', { className: 'kpi-item' }, [
      el('div', { className: 'kpi-label' }, ['总赞同']),
      el('div', { className: 'kpi-value tabular-nums' }, [String(report.totals.upvotes)]),
    ]),
    el('div', { className: 'kpi-item' }, [
      el('div', { className: 'kpi-label' }, ['总收藏']),
      el('div', { className: 'kpi-value tabular-nums' }, [String(report.totals.collects)]),
    ]),
    el('div', { className: 'kpi-item' }, [
      el('div', { className: 'kpi-label' }, ['总评论']),
      el('div', { className: 'kpi-value tabular-nums' }, [String(report.totals.comments)]),
    ]),
    el('div', { className: 'kpi-item kpi-highlight' }, [
      el('div', { className: 'kpi-label' }, ['加权平均互动率']),
      el('div', { className: 'kpi-value tabular-nums' }, [report.summary.weightedEngagementRate]),
    ]),
    el('div', { className: 'kpi-item' }, [
      el('div', { className: 'kpi-label' }, ['批内互动率中位数']),
      el('div', { className: 'kpi-value tabular-nums' }, [report.summary.medianEngagementRate]),
    ]),
  ]);

  const summarySection = el('section', { className: 'card' }, [
    el('h2', { className: 'section-title' }, ['核心摘要']),
    report.summary.sampleNotice
      ? el('div', { className: 'alert-box alert-warning' }, [report.summary.sampleNotice])
      : null,
    kpiCards,
    el('p', { className: 'summary-headline' }, [report.summary.headline]),
    el('p', { className: 'disclaimer-note' }, [`口径声明：${report.summary.disclaimer}`]),
  ]);
  root.appendChild(summarySection);

  // 2. 指标总览与计算口径（支持移动端紧凑卡片 / 横向滚动表格切换）
  let mobileCardMode = false;
  const overviewTableWrap = el('div', { className: 'table-scroll-wrap' });
  const overviewCardsWrap = el('div', { className: 'mobile-overview-cards is-hidden' });

  const tableEl = el('table', { className: 'metrics-table tabular-nums' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['问题标题']),
        el('th', {}, ['发布时间']),
        el('th', { className: 'num' }, ['数据龄']),
        el('th', { className: 'num' }, ['阅读']),
        el('th', { className: 'num' }, ['赞同']),
        el('th', { className: 'num' }, ['收藏']),
        el('th', { className: 'num' }, ['评论']),
        el('th', { className: 'num' }, ['赞同率']),
        el('th', { className: 'num' }, ['收藏率']),
        el('th', { className: 'num' }, ['评论率']),
        el('th', { className: 'num' }, ['互动率']),
        el('th', { className: 'num' }, ['收赞比']),
      ]),
    ]),
    el(
      'tbody',
      {},
      report.overviewRows.map((row) =>
        el('tr', {}, [
          el('td', { className: 'title-cell' }, [
            el('span', {}, [row.title]),
            row.isSmallSample ? el('span', { className: 'mini-tag tag-amber' }, ['样本小']) : null,
            row.isImmature ? el('span', { className: 'mini-tag tag-amber' }, ['数据龄不足']) : null,
            row.categoryTag ? el('span', { className: 'mini-tag tag-blue' }, [row.categoryTag]) : null,
          ]),
          el('td', { className: 'nowrap' }, [row.publishedRaw]),
          el('td', { className: 'num nowrap' }, [row.ageText]),
          el('td', { className: 'num' }, [String(row.views)]),
          el('td', { className: 'num' }, [String(row.upvotes)]),
          el('td', { className: 'num' }, [String(row.collects)]),
          el('td', { className: 'num' }, [String(row.comments)]),
          el('td', { className: 'num' }, [row.upvoteRate]),
          el('td', { className: 'num' }, [row.collectRate]),
          el('td', { className: 'num' }, [row.commentRate]),
          el('td', { className: 'num strong-cell' }, [row.engagementRate]),
          el('td', { className: 'num' }, [row.collectUpvoteRatio]),
        ]),
      ),
    ),
  ]);
  overviewTableWrap.appendChild(tableEl);

  for (const row of report.overviewRows) {
    overviewCardsWrap.appendChild(
      el('div', { className: 'overview-mobile-card tabular-nums' }, [
        el('div', { className: 'mobile-card-title' }, [row.title]),
        el('div', { className: 'mobile-card-meta' }, [
          `发布：${row.publishedRaw} · 数据龄：${row.ageText}`,
        ]),
        el('div', { className: 'mobile-card-grid' }, [
          el('span', {}, [`阅读 ${row.views}`]),
          el('span', {}, [`赞同 ${row.upvotes} (${row.upvoteRate})`]),
          el('span', {}, [`收藏 ${row.collects} (${row.collectRate})`]),
          el('span', {}, [`评论 ${row.comments} (${row.commentRate})`]),
          el('strong', {}, [`互动率 ${row.engagementRate}`]),
          el('span', {}, [`收赞比 ${row.collectUpvoteRatio}`]),
        ]),
      ]),
    );
  }

  const toggleViewBtn = el(
    'button',
    {
      type: 'button',
      className: 'btn btn-ghost btn-sm mobile-toggle-btn',
      onClick: () => {
        mobileCardMode = !mobileCardMode;
        overviewTableWrap.classList.toggle('is-hidden', mobileCardMode);
        overviewCardsWrap.classList.toggle('is-hidden', !mobileCardMode);
        toggleViewBtn.textContent = mobileCardMode ? '切换横向滚动表格' : '切换紧凑卡片视图';
      },
    },
    ['切换紧凑卡片视图'],
  );

  const extraTotalsText =
    report.totals.hasEndorseLikes || report.totals.hasShares
      ? `｜${[
          report.totals.hasEndorseLikes ? `喜欢 ${report.totals.endorseLikes}` : '',
          report.totals.hasShares ? `分享 ${report.totals.shares}` : '',
        ]
          .filter(Boolean)
          .join('｜')}（不计入互动率）`
      : '';

  const overviewSection = el('section', { className: 'card' }, [
    el('div', { className: 'card-header' }, [
      el('h2', { className: 'section-title' }, ['指标总览与计算口径']),
      toggleViewBtn,
    ]),
    overviewTableWrap,
    overviewCardsWrap,
    el('div', { className: 'totals-strip tabular-nums' }, [
      `汇总：阅读 ${report.totals.views}｜赞同 ${report.totals.upvotes}｜收藏 ${report.totals.collects}｜评论 ${report.totals.comments}${extraTotalsText}｜加权平均互动率 ${report.totals.weightedEngagementRate}（${report.totals.interactions} ÷ ${report.totals.views}）`,
      report.meta.spanDays !== null && report.meta.earliestDate && report.meta.latestDate
        ? `｜发布跨度 ${report.meta.spanDays} 天（${report.meta.earliestDate} 至 ${report.meta.latestDate}）`
        : '',
    ]),
    report.ageAndSampleWarnings.length > 0
      ? el('div', { className: 'alert-box alert-warning' }, [
          el('div', { className: 'alert-title' }, ['样本与数据龄提示']),
          el(
            'ul',
            { className: 'plain-list' },
            report.ageAndSampleWarnings.map((w) => el('li', {}, [w])),
          ),
        ])
      : null,
    el('details', { className: 'formula-details' }, [
      el('summary', {}, ['查看全部指标计算公式（可自行验算）']),
      el(
        'ul',
        { className: 'plain-list' },
        report.formulasNote.map((f) => el('li', {}, [f])),
      ),
    ]),
  ]);
  root.appendChild(overviewSection);

  // 3. 互动率梯队排名
  const rankingSection = el('section', { className: 'card' }, [
    el('h2', { className: 'section-title' }, ['互动率梯队排名']),
  ]);
  if (!report.canRank) {
    rankingSection.appendChild(
      el('div', { className: 'alert-box alert-info' }, [
        '当前录入少于 3 篇回答：已展示上方基础数据与分项比率，暂不生成横向互动率排名与四角色对比诊断。',
      ]),
    );
  } else {
    const maxRate = Math.max(
      ...report.rankingItems.map((r) => Number.parseFloat(r.engagementRate) || 0),
      1,
    );
    const rankList = el('ol', { className: 'ranking-list tabular-nums' });
    for (const r of report.rankingItems) {
      const pctVal = Number.parseFloat(r.engagementRate) || 0;
      const barWidth = Math.max(6, Math.round((pctVal / maxRate) * 100));
      rankList.appendChild(
        el('li', { className: 'ranking-item' }, [
          el('div', { className: 'ranking-head' }, [
            el('span', { className: 'rank-num' }, [`#${r.rank}`]),
            el('strong', { className: 'rank-title' }, [r.title]),
            el('span', { className: 'rank-rate' }, [r.engagementRate]),
          ]),
          el('div', { className: 'rank-bar-track' }, [
            el('div', { className: 'rank-bar-fill', style: `width: ${barWidth}%` }),
          ]),
          el('div', { className: 'ranking-meta' }, [
            el('span', {}, [`${r.medianRatioText} · 阅读 ${r.views} · 收赞比 ${r.collectUpvoteRatio}`]),
            ...r.tags.map((t) => el('span', { className: 'mini-tag tag-amber' }, [t])),
          ]),
        ]),
      );
    }
    rankingSection.appendChild(rankList);
  }
  root.appendChild(rankingSection);

  // 4. 分维度角色诊断
  if (report.canRank) {
    const roleCards = [
      report.roles.best,
      report.roles.benchmark,
      report.roles.worst,
      report.roles.topOpportunity,
    ].filter(Boolean);

    const rolesSection = el('section', { className: 'card' }, [
      el('h2', { className: 'section-title' }, ['分维度角色诊断']),
      report.roles.tiedNote
        ? el('div', { className: 'alert-box alert-info' }, [report.roles.tiedNote])
        : null,
      el(
        'div',
        { className: 'roles-grid' },
        roleCards.map((card) =>
          el('article', { className: `role-card role-${card.key}` }, [
            el('div', { className: 'role-card-kicker' }, [
              card.roleTitle,
              card.isImmature ? '（数据龄不足，仅供参考）' : '',
            ]),
            el('h3', { className: 'role-card-title' }, [`《${card.answerTitle}》`]),
            el(
              'ul',
              { className: 'plain-list' },
              card.bullets.map((b) => el('li', {}, [b])),
            ),
          ]),
        ),
      ),
    ]);
    root.appendChild(rolesSection);
  }

  // 5. 评论区读者信号解析
  const commentsSection = el('section', { className: 'card' }, [
    el('h2', { className: 'section-title' }, ['评论区读者信号解析']),
    el('p', { className: 'disclaimer-note' }, [report.commentInsights.disclaimer]),
  ]);

  const anyComments = report.commentInsights.items.some((ci) => ci.total > 0);
  if (!anyComments) {
    commentsSection.appendChild(
      el('p', { className: 'muted-text' }, [
        '本次未粘贴代表性评论；下次复盘建议每篇摘录 3–5 条代表性评论，便于识别读者质疑与追问。',
      ]),
    );
  } else {
    for (const ci of report.commentInsights.items) {
      const c = ci.counts;
      const pills = el('div', { className: 'comment-pills tabular-nums' }, [
        el('span', { className: 'badge badge-red' }, [`质疑求证 ${c.question_doubt}`]),
        el('span', { className: 'badge badge-blue' }, [`追问 ${c.follow_up}`]),
        el('span', { className: 'badge badge-amber' }, [`催更/蹲后续 ${c.urge_update}`]),
        el('span', { className: 'badge badge-green' }, [`收藏标记 ${c.bookmark_mark}`]),
        el('span', { className: 'badge badge-green-soft' }, [`认可 ${c.endorsement}`]),
        el('span', { className: 'badge badge-neutral' }, [`未分类 ${c.unclassified}`]),
      ]);

      commentsSection.appendChild(
        el('div', { className: 'comment-group' }, [
          el('div', { className: 'comment-group-head' }, [
            el('strong', {}, [`《${ci.title}》`]),
            el('span', { className: 'muted-text' }, [`共采样 ${ci.total} 条`]),
          ]),
          pills,
          ci.comments.length > 0
            ? el('details', { className: 'comment-details' }, [
                el('summary', {}, ['展开已脱敏原评论核对']),
                el(
                  'ul',
                  { className: 'plain-list' },
                  ci.comments.map((cm) =>
                    el('li', {}, [
                      el('span', { className: 'mini-tag tag-neutral' }, [cm.label]),
                      ' ',
                      cm.text,
                    ]),
                  ),
                ),
              ])
            : null,
        ]),
      );
    }
  }
  root.appendChild(commentsSection);

  // 6. 行动建议清单（≤ 5 条）
  const actionsSection = el('section', { className: 'card' }, [
    el('h2', { className: 'section-title' }, ['行动建议清单（最多 5 条）']),
    el(
      'div',
      { className: 'action-cards-list' },
      report.actions.map((act, idx) =>
        el('article', { className: 'action-item-card' }, [
          el('div', { className: 'action-item-head' }, [
            el('h3', { className: 'action-item-title' }, [`${idx + 1}. ${act.title}`]),
            el('span', { className: `badge ${priorityClass(act.priority)}` }, [act.priority]),
          ]),
          el('p', {}, [el('strong', {}, ['定位问题：']), act.problem]),
          el('p', {}, [el('strong', {}, ['数据依据：']), act.evidence]),
          el('p', {}, [el('strong', {}, ['执行动作：']), act.action]),
        ]),
      ),
    ),
  ]);
  root.appendChild(actionsSection);

  // 7. 增量追踪与下次复盘模板
  const trackingSection = el('section', { className: 'card' }, [
    el('h2', { className: 'section-title' }, ['增量追踪与下次复盘模板']),
  ]);

  if (report.crossPeriodDeltas.length > 0) {
    const fmtSign = (n) => (n >= 0 ? `+${n}` : `${n}`);
    trackingSection.appendChild(
      el('div', { className: 'delta-box' }, [
        el('h3', { className: 'subsection-title' }, ['同回答跨期增量对比']),
        el(
          'ul',
          { className: 'plain-list tabular-nums' },
          report.crossPeriodDeltas.map((d) =>
            el('li', { className: d.hasAnomaly ? 'delta-anomaly' : '' }, [
              `《${d.title}》（对比 ${d.prevAsOfDisplay}）：阅读 ${fmtSign(d.viewsDelta)}｜赞同 ${fmtSign(d.upvotesDelta)}｜收藏 ${fmtSign(d.collectsDelta)}｜评论 ${fmtSign(d.commentsDelta)}`,
              d.hasAnomaly
                ? '｜⚠️ 存在负增量，请核对抄录数据或取消赞同/删评波动'
                : d.viewsDelta === 0
                  ? '｜阅读无增长（+0）'
                  : `｜期间增量互动率 ${formatPercent(d.incrementalEngagementRate)}`,
            ]),
          ),
        ),
      ]),
    );
  } else {
    trackingSection.appendChild(
      el('p', { className: 'muted-text' }, [
        '提示：未来使用相同“问题标题 + 发布日期”再次复盘时，系统将自动计算两次复盘之间的阅读与互动增量。',
      ]),
    );
  }

  const copyTemplateBtn = el(
    'button',
    {
      type: 'button',
      className: 'btn btn-secondary btn-sm',
      onClick: async () => {
        const res = await copyTextWithFallback(report.nextTemplate);
        if (res.copied) {
          showToast('已复制下次复盘粘贴模板', 'success');
        } else {
          showManualCopyModal('复制下次复盘模板', report.nextTemplate);
        }
      },
    },
    ['复制下次复盘模板'],
  );

  trackingSection.appendChild(
    el('div', { className: 'template-header' }, [
      el('h3', { className: 'subsection-title' }, ['下次复盘粘贴块']),
      copyTemplateBtn,
    ]),
  );
  trackingSection.appendChild(el('pre', { className: 'template-pre' }, [report.nextTemplate]));
  root.appendChild(trackingSection);

  // 8. AI 深度语义诊断面板（D2 A′）
  const aiSection = el('section', { className: 'card ai-panel', id: 'ai-diagnosis-panel' }, [
    el('div', { className: 'card-header' }, [
      el('h2', { className: 'section-title' }, ['AI 深度语义诊断']),
      report.aiSection
        ? el(
            'span',
            {
              className: `badge ${report.aiSection.mode === 'sample_pregenerated' ? 'badge-amber' : 'badge-green'}`,
            },
            [
              report.aiSection.mode === 'sample_pregenerated'
                ? '预先生成示例（非实时）'
                : `实时 BYOK · ${report.aiSection.providerName}`,
            ],
          )
        : el('span', { className: 'badge badge-neutral' }, ['未启用（可选）']),
    ]),
    aiStatusBox,
  ]);

  if (report.aiSection) {
    const ai = report.aiSection;
    const unverified = ai.verification?.unverifiedTokens || [];

    aiSection.appendChild(
      el(
        'div',
        {
          className: `alert-box ${ai.mode === 'sample_pregenerated' ? 'alert-warning' : 'alert-info'}`,
        },
        [ai.disclaimer],
      ),
    );

    if (ai.verification?.hasUnverified) {
      aiSection.appendChild(
        el('div', { className: 'alert-box alert-error' }, [
          `⚠️ 检测到 AI 输出包含 ${ai.verification.unverifiedCount} 处未在计算结果中核验到的数字，已在正文高亮标出，请以确定性总览表为准。`,
        ]),
      );
    }

    const overallP = el('p', { className: 'ai-overall' });
    overallP.appendChild(el('strong', {}, ['整体语义判断：']));
    overallP.appendChild(renderVerifiedTextNodes(ai.overallInsight, unverified));
    aiSection.appendChild(overallP);

    if (ai.commentReinterpretation.length > 0) {
      aiSection.appendChild(el('h3', { className: 'subsection-title' }, ['评论信号语义复核']));
      const ul = el('ul', { className: 'plain-list' });
      for (const line of ai.commentReinterpretation) {
        const li = el('li');
        li.appendChild(renderVerifiedTextNodes(line, unverified));
        ul.appendChild(li);
      }
      aiSection.appendChild(ul);
    }

    if (ai.rewriteSuggestions.length > 0) {
      aiSection.appendChild(el('h3', { className: 'subsection-title' }, ['原回答编辑改写建议']));
      for (const sug of ai.rewriteSuggestions) {
        const diagP = el('p');
        diagP.appendChild(el('strong', {}, ['诊断要点：']));
        diagP.appendChild(renderVerifiedTextNodes(sug.diagnosis, unverified));

        const editP = el('p', { className: 'ai-edit-box' });
        editP.appendChild(el('strong', {}, ['改写参考：']));
        editP.appendChild(renderVerifiedTextNodes(sug.concreteEdit, unverified));

        aiSection.appendChild(
          el('article', { className: 'ai-rewrite-card' }, [
            el('h4', {}, [`《${sug.targetTitle}》`]),
            diagP,
            editP,
          ]),
        );
      }
    }
  } else {
    aiSection.appendChild(
      el('p', { className: 'muted-text' }, [
        '当前报告完全由本地确定性规则引擎生成。如需 AI 进一步解读评论语义并生成“编辑原回答”改写示例，可点击上方“运行实时 AI 深度诊断（BYOK）”按钮（使用您自备的大模型 Key，浏览器直连）。',
      ]),
    );
  }

  root.appendChild(aiSection);
  return root;
}
