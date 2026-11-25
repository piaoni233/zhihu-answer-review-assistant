// @ts-check

import { el, showModal, showToast } from './dom.js';
import { AI_PROVIDERS, getProviderById } from '../ai/providers.js';
import { maskApiKey } from '../storage/settings-store.js';

/**
 * 设置与数据备份视图（详细设计 §5.3、§5.5、§6.1）
 * - 诊断规则参数（数据龄阈值、小样本阈值、@昵称脱敏开关）
 * - BYOK AI 服务商、模型、API Key（默认 sessionStorage，永不回显完整 Key）
 * - JSON 备份导出、去重校验导入、二次确认清空全部本地数据
 */

/**
 * @param {{
 *   settings: import('../types.js').Settings,
 *   currentApiKey: string,
 *   onSaveSettings: (partial: Partial<import('../types.js').Settings>) => void,
 *   onSaveApiKey: (key: string, remember: boolean) => void,
 *   onClearApiKey: () => void,
 *   onExportBackup: () => Promise<void>,
 *   onImportBackup: (jsonText: string) => Promise<void>,
 *   onClearAllData: () => Promise<void>
 * }} props
 * @returns {HTMLElement}
 */
export function renderSettingsView(props) {
  const root = el('div', { className: 'settings-view' });

  // 1. 诊断参数设置
  const ageSelect = /** @type {HTMLSelectElement} */ (
    el(
      'select',
      { className: 'input-control', id: 'setting-age-threshold' },
      [3, 7, 14, 30].map((days) =>
        el(
          'option',
          { value: String(days), selected: props.settings.ageThresholdDays === days },
          [`${days} 天${days === 7 ? '（默认）' : ''}`],
        ),
      ),
    )
  );

  const smallSampleInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'number',
      id: 'setting-small-sample',
      className: 'input-control',
      min: 10,
      max: 100000,
      value: String(props.settings.smallSampleThreshold),
    })
  );

  const maskMentionCheckbox = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'checkbox',
      id: 'setting-mask-mentions',
      checked: props.settings.maskMentionHandles,
    })
  );

  const saveRulesBtn = el(
    'button',
    {
      type: 'button',
      className: 'btn btn-primary',
      onClick: () => {
        const smallVal = Number(smallSampleInput.value);
        if (!Number.isFinite(smallVal) || smallVal < 10) {
          showToast('小样本阅读阈值请填写 ≥ 10 的整数', 'warning');
          return;
        }
        props.onSaveSettings({
          ageThresholdDays: Number(ageSelect.value),
          smallSampleThreshold: Math.floor(smallVal),
          maskMentionHandles: maskMentionCheckbox.checked,
        });
        showToast('诊断规则参数已保存，下次生成报告生效', 'success');
      },
    },
    ['保存诊断参数'],
  );

  root.appendChild(
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title' }, ['诊断规则参数']),
      el('div', { className: 'settings-grid' }, [
        el('label', { className: 'form-field' }, [
          el('span', {}, ['数据龄提示阈值（低于该天数标注“首轮分发可能未结束”）']),
          ageSelect,
        ]),
        el('label', { className: 'form-field' }, [
          el('span', {}, ['小样本阅读阈值（低于该阅读量不选为最优/标杆，默认 200）']),
          smallSampleInput,
        ]),
        el('label', { className: 'checkbox-field form-field-full' }, [
          maskMentionCheckbox,
          el('span', {}, ['自动对代表性评论中的 @用户昵称 进行脱敏处理（手机号、邮箱、证件号始终强制脱敏）']),
        ]),
      ]),
      el('div', { className: 'settings-actions' }, [saveRulesBtn]),
    ]),
  );

  // 2. BYOK AI 深度诊断设置
  const providerSelect = /** @type {HTMLSelectElement} */ (
    el(
      'select',
      { className: 'input-control', id: 'setting-ai-provider' },
      AI_PROVIDERS.map((p) =>
        el(
          'option',
          { value: p.id, selected: props.settings.aiProviderId === p.id },
          [`${p.name} (${p.host})`],
        ),
      ),
    )
  );

  const modelInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'text',
      id: 'setting-ai-model',
      className: 'input-control',
      value: props.settings.aiModel || getProviderById(props.settings.aiProviderId).defaultModel,
      placeholder: '例如 deepseek-chat',
    })
  );

  providerSelect.addEventListener('change', () => {
    const p = getProviderById(providerSelect.value);
    modelInput.value = p.defaultModel;
  });

  const keyInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'password',
      id: 'setting-ai-key',
      className: 'input-control',
      placeholder: props.currentApiKey
        ? '已保存 Key（如需更换请直接输入新 Key）'
        : '输入您自备的大模型 API Key',
      autocomplete: 'off',
    })
  );

  const rememberCheckbox = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'checkbox',
      id: 'setting-remember-key',
      checked: props.settings.rememberApiKey,
    })
  );

  const keyStatusEl = el('div', { className: 'muted-text small-note' }, [
    `当前 Key 状态：${maskApiKey(props.currentApiKey)}（界面永不回显完整凭证）`,
  ]);

  const saveAiBtn = el(
    'button',
    {
      type: 'button',
      className: 'btn btn-primary',
      onClick: () => {
        const provider = getProviderById(providerSelect.value);
        const model = modelInput.value.trim() || provider.defaultModel;
        const remember = rememberCheckbox.checked;
        props.onSaveSettings({
          aiProviderId: provider.id,
          aiModel: model,
          rememberApiKey: remember,
        });
        const newKey = keyInput.value.trim();
        if (newKey) {
          props.onSaveApiKey(newKey, remember);
          keyInput.value = '';
        } else if (props.currentApiKey) {
          props.onSaveApiKey(props.currentApiKey, remember);
        }
        showToast('AI 接口配置已保存', 'success');
      },
    },
    ['保存 AI 配置'],
  );

  const clearKeyBtn = el(
    'button',
    {
      type: 'button',
      className: 'btn btn-secondary',
      onClick: () => {
        props.onClearApiKey();
        keyInput.value = '';
        showToast('已清除当前浏览器中保存的 API Key', 'info');
      },
    },
    ['清除已保存 Key'],
  );

  root.appendChild(
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title' }, ['AI 深度诊断配置（BYOK 用户自备 Key）']),
      el('p', { className: 'muted-text small-note' }, [
        '仅支持实测放行浏览器直连（CORS）的 OpenAI 兼容接口。Key 默认仅存于 sessionStorage（关闭标签页即销毁），请求直接发往您选定的服务商，绝不经过我方服务器。',
      ]),
      el('div', { className: 'settings-grid' }, [
        el('label', { className: 'form-field' }, [el('span', {}, ['大模型服务商']), providerSelect]),
        el('label', { className: 'form-field' }, [el('span', {}, ['模型 ID（可按需修改）']), modelInput]),
        el('label', { className: 'form-field form-field-full' }, [
          el('span', {}, ['API Key（输入后仅遮罩保存）']),
          keyInput,
        ]),
        el('label', { className: 'checkbox-field form-field-full' }, [
          rememberCheckbox,
          el('span', {}, ['记住 Key 到本地浏览器 localStorage（公用电脑请勿勾选）']),
        ]),
      ]),
      keyStatusEl,
      el('div', { className: 'settings-actions' }, [saveAiBtn, clearKeyBtn]),
    ]),
  );

  // 3. 数据备份与恢复
  const fileInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'file',
      accept: 'application/json,.json',
      className: 'is-hidden',
    })
  );

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await props.onImportBackup(text);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入备份失败', 'error');
    } finally {
      fileInput.value = '';
    }
  });

  root.appendChild(
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title' }, ['本地数据备份与恢复']),
      el('p', { className: 'muted-text small-note' }, [
        'JSON 备份仅包含复盘记录与诊断参数（绝不包含您的 API Key）。建议定期导出，以防清理浏览器缓存导致历史记录丢失。',
      ]),
      fileInput,
      el('div', { className: 'settings-actions' }, [
        el(
          'button',
          {
            type: 'button',
            id: 'export-backup-btn',
            className: 'btn btn-secondary',
            onClick: () => props.onExportBackup(),
          },
          ['导出 JSON 备份'],
        ),
        el(
          'button',
          {
            type: 'button',
            id: 'import-backup-btn',
            className: 'btn btn-secondary',
            onClick: () => fileInput.click(),
          },
          ['导入 JSON 备份（自动去重）'],
        ),
        el(
          'button',
          {
            type: 'button',
            id: 'clear-all-data-btn',
            className: 'btn btn-danger',
            onClick: () => {
              showModal({
                title: '清空全部本地数据（高风险操作）',
                body: '此操作将永久删除本浏览器中保存的全部历史复盘与同回答跨期追踪记录（建议先导出 JSON 备份）。确定继续吗？',
                confirmText: '确认永久清空',
                danger: true,
                onConfirm: async () => {
                  await props.onClearAllData();
                  showToast('已清空全部本地复盘历史', 'info');
                },
              });
            },
          },
          ['清空全部本地数据'],
        ),
      ]),
    ]),
  );

  return root;
}
