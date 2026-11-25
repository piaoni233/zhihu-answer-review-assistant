// @ts-check

import { el, showModal, showToast } from './dom.js';
import { parseInputBlocks } from '../core/parser.js';
import { validateBatch } from '../core/validator.js';
import {
  formatUtcDateTimeLocal,
  parseDateTimeLocalValue,
  formatUtcMinute,
} from '../core/date.js';
import { ZHIHU_SAMPLE_TEXT, SAMPLE_AS_OF_UTC_MS } from '../core/zhihu-sample.js';

/**
 * 复盘工作台视图（详细设计 §2.6、§6.1、§6.2）
 * 支持文本粘贴、折叠式逐篇添加助手、实时定位校验、软警示确认框与虚构示例载入。
 */

const PLACEHOLDER_TEXT = `标题：为什么很多人学完 Python 语法还是写不出实用脚本？
发布时间：2026-11-15 10:00
阅读：16000
赞同：480
收藏：560
评论：80
回答类型：干货
代表性评论：
- 讲透了，从报错反推需求那段很受教
- 请问初学者做自动化脚本推荐先用哪个标准库？

---
标题：粘贴第 2 篇、第 3 篇回答数据（用空行或 --- 分隔）`;

/**
 * 聚焦并选中 textarea 中指定 1-based 行号。
 * @param {HTMLTextAreaElement} textarea
 * @param {number} lineNo
 */
function focusLineInTextarea(textarea, lineNo) {
  const lines = textarea.value.split('\n');
  const clamped = Math.max(1, Math.min(lineNo, lines.length));
  let offset = 0;
  for (let i = 0; i < clamped - 1; i += 1) {
    offset += lines[i].length + 1;
  }
  const lineLen = lines[clamped - 1]?.length ?? 0;
  textarea.focus();
  textarea.setSelectionRange(offset, offset + lineLen);
}

/**
 * @param {{
 *   rawText: string,
 *   asOfUtcMs: number,
 *   isSample: boolean,
 *   settings: import('../types.js').Settings,
 *   onChangeText: (text: string, isSample: boolean) => void,
 *   onChangeAsOf: (utcMs: number) => void,
 *   onGenerate: (parsed: import('../types.js').ParseResult, validation: import('../types.js').ValidationResult) => Promise<void>
 * }} props
 * @returns {HTMLElement}
 */
export function renderWorkspaceView(props) {
  const wrapper = el('div', { className: 'workspace-view' });

  let currentText = props.rawText;
  let currentAsOfUtcMs = props.asOfUtcMs;
  let currentIsSample = props.isSample;

  const asOfInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'datetime-local',
      id: 'as-of-input',
      className: 'input-control',
      value: formatUtcDateTimeLocal(currentAsOfUtcMs),
    })
  );

  const sampleBadge = el(
    'span',
    { className: `badge badge-amber ${currentIsSample ? '' : 'is-hidden'}` },
    ['示例数据（虚构）'],
  );

  const textarea = /** @type {HTMLTextAreaElement} */ (
    el('textarea', {
      id: 'paste-input',
      className: 'paste-textarea',
      rows: 15,
      placeholder: PLACEHOLDER_TEXT,
      value: currentText,
    })
  );

  const feedbackBox = el('div', { className: 'feedback-panel', id: 'validation-feedback' });

  const generateBtn = /** @type {HTMLButtonElement} */ (
    el(
      'button',
      {
        type: 'button',
        id: 'generate-report-btn',
        className: 'btn btn-primary btn-lg',
      },
      ['一键生成复盘报告'],
    )
  );

  /** @type {import('../types.js').ParseResult} */
  let latestParse = parseInputBlocks(currentText, { maskHandles: props.settings.maskMentionHandles });
  /** @type {import('../types.js').ValidationResult} */
  let latestValidation = validateBatch(latestParse, props.settings, currentAsOfUtcMs);

  const updateValidationUi = () => {
    latestParse = parseInputBlocks(currentText, { maskHandles: props.settings.maskMentionHandles });
    latestValidation = validateBatch(latestParse, props.settings, currentAsOfUtcMs);

    sampleBadge.classList.toggle('is-hidden', !currentIsSample);
    feedbackBox.replaceChildren();

    const summaryBar = el('div', { className: 'parse-status-bar' }, [
      el('span', { className: 'status-pill' }, [
        `已识别 ${latestParse.items.length} / ${latestParse.totalBlocks} 篇有效回答`,
      ]),
      el('span', { className: 'muted-text' }, [
        `数据截至：${formatUtcMinute(currentAsOfUtcMs)}（用于计算每篇数据龄）`,
      ]),
    ]);
    feedbackBox.appendChild(summaryBar);

    if (latestValidation.blockingErrors.length > 0) {
      const errList = el('ul', { className: 'issue-list' });
      for (const err of latestValidation.blockingErrors) {
        const jumpBtn =
          err.blockIndex > 0
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'link-btn',
                  onClick: () => focusLineInTextarea(textarea, err.line),
                },
                [`定位第 ${err.line} 行`],
              )
            : null;
        errList.appendChild(
          el('li', { className: 'issue-item issue-error' }, [
            el('div', { className: 'issue-head' }, [
              el('span', { className: 'issue-msg' }, [err.message]),
              jumpBtn,
            ]),
            err.fixHint ? el('div', { className: 'issue-hint' }, [`修改建议：${err.fixHint}`]) : null,
          ]),
        );
      }
      feedbackBox.appendChild(
        el('div', { className: 'alert-box alert-error', role: 'alert' }, [
          el('div', { className: 'alert-title' }, [
            `发现 ${latestValidation.blockingErrors.length} 处阻断问题，请修正后再生成报告：`,
          ]),
          errList,
        ]),
      );
    }

    if (latestValidation.softWarnings.length > 0) {
      const warnList = el('ul', { className: 'issue-list' });
      for (const w of latestValidation.softWarnings) {
        warnList.appendChild(
          el('li', { className: 'issue-item issue-warning' }, [
            el('div', { className: 'issue-msg' }, [w.message]),
            w.fixHint ? el('div', { className: 'issue-hint' }, [w.fixHint]) : null,
          ]),
        );
      }
      feedbackBox.appendChild(
        el('div', { className: 'alert-box alert-warning' }, [
          el('div', { className: 'alert-title' }, [
            `发现 ${latestValidation.softWarnings.length} 条数据核对警示（点击生成时需二次确认）：`,
          ]),
          warnList,
        ]),
      );
    }

    if (latestValidation.notices.length > 0) {
      const noticeList = el('ul', { className: 'issue-list' });
      for (const n of latestValidation.notices) {
        noticeList.appendChild(
          el('li', { className: 'issue-item issue-notice' }, [
            el('div', { className: 'issue-msg' }, [n.message]),
            n.fixHint ? el('div', { className: 'issue-hint' }, [n.fixHint]) : null,
          ]),
        );
      }
      feedbackBox.appendChild(
        el('div', { className: 'alert-box alert-info' }, [
          el('div', { className: 'alert-title' }, ['口径与状态提示：']),
          noticeList,
        ]),
      );
    }

    generateBtn.disabled = !latestValidation.canGenerate;
  };

  asOfInput.addEventListener('change', () => {
    const parsedMs = parseDateTimeLocalValue(asOfInput.value);
    if (parsedMs !== null) {
      currentAsOfUtcMs = parsedMs;
      props.onChangeAsOf(parsedMs);
      updateValidationUi();
    }
  });

  textarea.addEventListener('input', () => {
    currentText = textarea.value;
    if (currentIsSample && currentText.trim() !== ZHIHU_SAMPLE_TEXT.trim()) {
      currentIsSample = false;
    }
    props.onChangeText(currentText, currentIsSample);
    updateValidationUi();
  });

  const loadSampleBtn = el(
    'button',
    {
      type: 'button',
      id: 'load-sample-btn',
      className: 'btn btn-secondary',
      onClick: () => {
        currentText = ZHIHU_SAMPLE_TEXT;
        currentAsOfUtcMs = SAMPLE_AS_OF_UTC_MS;
        currentIsSample = true;
        textarea.value = currentText;
        asOfInput.value = formatUtcDateTimeLocal(currentAsOfUtcMs);
        props.onChangeAsOf(currentAsOfUtcMs);
        props.onChangeText(currentText, true);
        updateValidationUi();
        showToast('已载入 3 篇知乎虚构示例数据（含预生成 A′ AI 诊断示例）', 'info');
      },
    },
    ['载入示例（虚构）'],
  );

  const clearBtn = el(
    'button',
    {
      type: 'button',
      id: 'clear-input-btn',
      className: 'btn btn-ghost',
      onClick: () => {
        currentText = '';
        currentIsSample = false;
        textarea.value = '';
        props.onChangeText('', false);
        updateValidationUi();
      },
    },
    ['清空'],
  );

  generateBtn.addEventListener('click', async () => {
    updateValidationUi();
    if (!latestValidation.canGenerate) {
      showToast('请先修正上方阻断错误再生成报告', 'error');
      return;
    }
    if (latestValidation.needsConfirmation) {
      const warnBody = el('div', {}, [
        el('p', {}, ['检测到以下数据在常规知乎统计中较为少见，请核对是否误填了字段：']),
        el(
          'ul',
          { className: 'modal-warn-list' },
          latestValidation.softWarnings.map((w) => el('li', {}, [w.message])),
        ),
      ]);
      showModal({
        title: '数据异常核对确认',
        body: warnBody,
        confirmText: '确认数据无误，继续生成',
        cancelText: '返回修改',
        onConfirm: async () => {
          await props.onGenerate(latestParse, latestValidation);
        },
      });
      return;
    }
    await props.onGenerate(latestParse, latestValidation);
  });

  // 折叠式逐篇添加助手（详细设计 §2.6）
  const helperTitle = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', className: 'input-control', placeholder: '例如：如何系统提升技术写作能力？' })
  );
  const helperDate = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'datetime-local',
      className: 'input-control',
      value: formatUtcDateTimeLocal(currentAsOfUtcMs - 3 * 86_400_000),
    })
  );
  const helperViews = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', className: 'input-control', placeholder: '如 12000 或 1.2万' })
  );
  const helperUpvotes = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', className: 'input-control', placeholder: '如 320' })
  );
  const helperCollects = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', className: 'input-control', placeholder: '如 410' })
  );
  const helperComments = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', className: 'input-control', placeholder: '如 45' })
  );
  const helperCategory = /** @type {HTMLSelectElement} */ (
    el('select', { className: 'input-control' }, [
      el('option', { value: '' }, ['不指定回答类型（可选）']),
      el('option', { value: '干货' }, ['干货']),
      el('option', { value: '观点' }, ['观点']),
      el('option', { value: '经历' }, ['经历']),
      el('option', { value: '测评' }, ['测评']),
    ])
  );
  const helperCommentsText = /** @type {HTMLTextAreaElement} */ (
    el('textarea', {
      className: 'input-control',
      rows: 3,
      placeholder: '每行粘贴一条代表性评论（可选，建议 ≤ 5 条）',
    })
  );

  const appendBlockBtn = el(
    'button',
    {
      type: 'button',
      className: 'btn btn-secondary',
      onClick: () => {
        const title = helperTitle.value.trim();
        if (!title) {
          showToast('请先填写问题标题', 'warning');
          helperTitle.focus();
          return;
        }
        const pub = helperDate.value ? helperDate.value.replace('T', ' ') : '';
        const lines = [
          `标题：${title}`,
          `发布时间：${pub}`,
          `阅读：${helperViews.value.trim() || '0'}`,
          `赞同：${helperUpvotes.value.trim() || '0'}`,
          `收藏：${helperCollects.value.trim() || '0'}`,
          `评论：${helperComments.value.trim() || '0'}`,
        ];
        if (helperCategory.value) {
          lines.push(`回答类型：${helperCategory.value}`);
        }
        const cLines = helperCommentsText.value
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (cLines.length > 0) {
          lines.push('代表性评论：');
          for (const cl of cLines) {
            lines.push(cl.startsWith('-') ? cl : `- ${cl}`);
          }
        }
        const block = lines.join('\n');
        currentText = currentText.trim() ? `${currentText.trim()}\n\n---\n${block}` : block;
        currentIsSample = false;
        textarea.value = currentText;
        props.onChangeText(currentText, false);
        updateValidationUi();
        helperTitle.value = '';
        helperViews.value = '';
        helperUpvotes.value = '';
        helperCollects.value = '';
        helperComments.value = '';
        helperCommentsText.value = '';
        showToast('已按标准格式追加到待复盘文本', 'success');
      },
    },
    ['加入待复盘文本'],
  );

  const helperDetails = el('details', { className: 'helper-accordion' }, [
    el('summary', { className: 'helper-summary' }, ['逐篇添加助手（表单填写，防格式出错）']),
    el('div', { className: 'helper-form-grid' }, [
      el('label', { className: 'form-field form-field-full' }, [
        el('span', {}, ['问题标题 *']),
        helperTitle,
      ]),
      el('label', { className: 'form-field' }, [el('span', {}, ['发布时间 *']), helperDate]),
      el('label', { className: 'form-field' }, [el('span', {}, ['回答类型（可选）']), helperCategory]),
      el('label', { className: 'form-field' }, [el('span', {}, ['阅读 *']), helperViews]),
      el('label', { className: 'form-field' }, [el('span', {}, ['赞同 *']), helperUpvotes]),
      el('label', { className: 'form-field' }, [el('span', {}, ['收藏 *']), helperCollects]),
      el('label', { className: 'form-field' }, [el('span', {}, ['评论 *']), helperComments]),
      el('label', { className: 'form-field form-field-full' }, [
        el('span', {}, ['代表性评论（每行一条，可选）']),
        helperCommentsText,
      ]),
      el('div', { className: 'form-field-full' }, [appendBlockBtn]),
    ]),
  ]);

  const topToolbar = el('section', { className: 'card toolbar-card' }, [
    el('div', { className: 'toolbar-row' }, [
      el('label', { className: 'as-of-group', for: 'as-of-input' }, [
        el('span', { className: 'toolbar-label' }, ['数据截至时间']),
        asOfInput,
      ]),
      el('div', { className: 'toolbar-actions' }, [sampleBadge, loadSampleBtn, clearBtn]),
    ]),
    el('p', { className: 'muted-text small-note' }, [
      '建议粘贴 3 篇以上知乎回答数据（用空行或 --- 分隔）。支持“18,200 / 1.2万 / 3千”写法，拒绝“10万+ / 1.2w”等模糊估算；所有计算均在本地完成。',
    ]),
  ]);

  const editorCard = el('section', { className: 'card' }, [
    el('div', { className: 'card-header' }, [
      el('h2', { className: 'section-title' }, ['粘贴知乎回答数据']),
      el('span', { className: 'muted-text' }, ['支持别名：问题标题 / 发布日期 / 阅读量 / 赞同数 / 收藏数 / 评论数 / 喜欢 / 分享']),
    ]),
    textarea,
    helperDetails,
    feedbackBox,
    el('div', { className: 'workspace-cta' }, [generateBtn]),
  ]);

  wrapper.appendChild(topToolbar);
  wrapper.appendChild(editorCard);

  updateValidationUi();
  return wrapper;
}
