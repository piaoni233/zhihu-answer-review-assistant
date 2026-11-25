// @ts-check

import { el, showModal, showToast } from './dom.js';
import { formatUtcMinute } from '../core/date.js';
import { computeAnswerDelta } from '../core/calculator.js';
import { formatPercent } from '../core/round.js';

/**
 * 历史与跨期对比视图（详细设计 §6.1）
 * - 历史复盘列表（按时间倒序、支持原样回看与删除）
 * - 个人历史基线达标进度（累计 ≥ 10 篇真实回答）
 * - 同回答跨期追踪时间线与阶段增量对比
 */

/**
 * @param {{
 *   reviews: import('../types.js').ReviewRecord[],
 *   trackedAnswers: import('../types.js').AnswerIndexRecord[],
 *   baseline: import('../types.js').HistoryBaseline,
 *   onOpenReview: (review: import('../types.js').ReviewRecord) => void,
 *   onDeleteReview: (id: string) => Promise<void>,
 *   onGoWorkspace: () => void
 * }} props
 * @returns {HTMLElement}
 */
export function renderHistoryView(props) {
  const root = el('div', { className: 'history-view' });

  // 1. 个人历史基线进度卡
  const count = props.baseline.sampleCount;
  const pct = Math.min(100, Math.round((count / 10) * 100));
  const baselineText =
    count >= 10
      ? `已累计 ${count} 篇不重复真实回答，个人历史基线已激活（历史互动率中位数 ${formatPercent(props.baseline.medianEngagementRate)}）。`
      : `已累计 ${count} / 10 篇不重复真实回答（示例数据不计入），满 10 篇后自动开启“与你本人历史中位数对比”。`;

  root.appendChild(
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title' }, ['个人历史基线进度']),
      el('p', { className: 'muted-text' }, [baselineText]),
      el('div', { className: 'progress-track' }, [
        el('div', { className: 'progress-fill', style: `width: ${pct}%` }),
      ]),
    ]),
  );

  // 2. 同回答跨期追踪面板
  const multiTracked = props.trackedAnswers.filter((a) => a.timeline.length >= 2);
  const trackingCard = el('section', { className: 'card' }, [
    el('h2', { className: 'section-title' }, ['同回答跨期增量追踪']),
  ]);

  if (multiTracked.length === 0) {
    trackingCard.appendChild(
      el('p', { className: 'muted-text' }, [
        '暂无累计出现 ≥ 2 次的真实回答。对同一篇回答（相同问题标题 + 发布日期）在不同时间点再次复盘，即可在此查看各阶段阅读与互动增量趋势。',
      ]),
    );
  } else {
    for (const rec of multiTracked) {
      const rows = [];
      for (let i = 0; i < rec.timeline.length; i += 1) {
        const snap = rec.timeline[i];
        let deltaText = '首次基线';
        if (i > 0) {
          const prev = rec.timeline[i - 1];
          const delta = computeAnswerDelta(prev, snap);
          const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
          if (delta.hasAnomaly) {
            deltaText = `阅读 ${sign(delta.viewsDelta)} / 赞同 ${sign(delta.upvotesDelta)}（⚠️ 负增量）`;
          } else if (delta.viewsDelta === 0) {
            deltaText = '阅读 +0（无增长）';
          } else {
            deltaText = `阅读 ${sign(delta.viewsDelta)} / 赞同 ${sign(delta.upvotesDelta)} / 收藏 ${sign(delta.collectsDelta)} / 评论 ${sign(delta.commentsDelta)}（增量互动率 ${formatPercent(delta.incrementalEngagementRate)}）`;
          }
        }
        rows.push(
          el('tr', {}, [
            el('td', { className: 'nowrap' }, [snap.asOfDisplay || formatUtcMinute(snap.asOfUtcMs)]),
            el('td', { className: 'num' }, [String(snap.views)]),
            el('td', { className: 'num' }, [String(snap.upvotes)]),
            el('td', { className: 'num' }, [String(snap.collects)]),
            el('td', { className: 'num' }, [String(snap.comments)]),
            el('td', { className: 'num' }, [formatPercent(snap.engagementRate)]),
            el('td', {}, [deltaText]),
          ]),
        );
      }

      trackingCard.appendChild(
        el('div', { className: 'tracked-answer-card' }, [
          el('div', { className: 'tracked-head' }, [
            el('strong', {}, [`《${rec.title}》`]),
            el('span', { className: 'muted-text' }, [
              `发布日期 ${rec.publishedDateStr} · 已追踪 ${rec.timeline.length} 次`,
            ]),
          ]),
          el('div', { className: 'table-scroll-wrap' }, [
            el('table', { className: 'metrics-table tabular-nums' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', {}, ['数据截至时间']),
                  el('th', { className: 'num' }, ['阅读']),
                  el('th', { className: 'num' }, ['赞同']),
                  el('th', { className: 'num' }, ['收藏']),
                  el('th', { className: 'num' }, ['评论']),
                  el('th', { className: 'num' }, ['累计互动率']),
                  el('th', {}, ['较上次增量']),
                ]),
              ]),
              el('tbody', {}, rows),
            ]),
          ]),
        ]),
      );
    }
  }
  root.appendChild(trackingCard);

  // 3. 历史复盘记录列表
  const listCard = el('section', { className: 'card' }, [
    el('h2', { className: 'section-title' }, [`历史复盘记录（共 ${props.reviews.length} 条）`]),
  ]);

  if (props.reviews.length === 0) {
    listCard.appendChild(
      el('div', { className: 'empty-inline' }, [
        el('p', { className: 'muted-text' }, [
          '暂无本地复盘记录，完成首次复盘后将自动保存在当前浏览器。',
        ]),
        el(
          'button',
          { type: 'button', className: 'btn btn-primary', onClick: props.onGoWorkspace },
          ['去复盘工作台开始第一次复盘'],
        ),
      ]),
    );
  } else {
    const listEl = el('div', { className: 'history-list' });
    for (const rev of props.reviews) {
      const rm = rev.reportModel;
      listEl.appendChild(
        el('article', { className: 'history-item-card' }, [
          el('div', { className: 'history-item-main' }, [
            el('div', { className: 'badge-row' }, [
              rev.isSample ? el('span', { className: 'badge badge-amber' }, ['示例']) : null,
              rev.aiDiagnosis ? el('span', { className: 'badge badge-green' }, ['含 AI 诊断']) : null,
              el('span', { className: 'badge badge-blue' }, [`${rm.meta.itemCount} 篇`]),
              el('span', { className: 'badge badge-neutral tabular-nums' }, [
                `加权互动率 ${rm.summary.weightedEngagementRate}`,
              ]),
            ]),
            el('div', { className: 'history-item-title' }, [
              `复盘截至 ${rm.meta.asOfDisplay}（总阅读 ${rm.totals.views}）`,
            ]),
            el('div', { className: 'muted-text small-note' }, [
              `保存于 ${formatUtcMinute(rev.createdAtUtcMs)} · 引擎 v${rev.engineVersion}`,
            ]),
          ]),
          el('div', { className: 'history-item-actions' }, [
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-secondary btn-sm',
                onClick: () => props.onOpenReview(rev),
              },
              ['查看原报告'],
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-ghost btn-sm text-danger',
                onClick: () => {
                  showModal({
                    title: '删除复盘记录',
                    body: `确定要删除“复盘截至 ${rm.meta.asOfDisplay}”这条记录吗？删除后将自动重建同回答跨期索引。`,
                    confirmText: '确认删除',
                    danger: true,
                    onConfirm: async () => {
                      await props.onDeleteReview(rev.id);
                      showToast('已删除该条复盘记录', 'info');
                    },
                  });
                },
              },
              ['删除'],
            ),
          ]),
        ]),
      );
    }
    listCard.appendChild(listEl);
  }
  root.appendChild(listCard);

  return root;
}
