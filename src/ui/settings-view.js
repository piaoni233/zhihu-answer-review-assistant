// @ts-check

import { el, showModal, showToast } from './dom.js';
import {
  getAllProviders,
  getProviderById,
  getProviderCorsStatusLabel,
  validateCustomProviderInput,
} from '../ai/providers.js';
import { maskApiKey } from '../storage/settings-store.js';
import { formatUtcMinute, localDateToWallUtcMs } from '../core/date.js';

/**
 * 设置与数据备份视图（详细设计 §5.3、§5.5、§6.1、§10）
 * - 诊断规则参数（数据龄阈值、小样本阈值、@昵称脱敏开关）
 * - BYOK AI 服务商配置（8 家内置 + 自定义 OpenAI 兼容 HTTPS 服务商）、按服务商独立 Key 存储与逐项连通性测试
 * - JSON 备份导出、去重校验导入、二次确认清空全部本地数据
 */

/**
 * 格式化连通性测试时间（本地墙钟 YYYY-MM-DD HH:mm）。
 * @param {number} tsMs
 * @returns {string}
 */
function formatTestTimestamp(tsMs) {
  return formatUtcMinute(localDateToWallUtcMs(new Date(tsMs)));
}

/**
 * 返回服务商直连状态对应的徽标样式类。
 * @param {import('../ai/providers.js').AiProviderConfig} provider
 * @param {import('../types.js').ProviderConnectivityResult|null|undefined} conn
 * @returns {string}
 */
function corsStatusBadgeClass(provider, conn) {
  if (conn && conn.ok) return 'badge-green';
  if (provider.browserCorsStatus === 'preflight_passed') return 'badge-blue';
  return 'badge-amber';
}

/**
 * @param {{
 *   settings: import('../types.js').Settings,
 *   getProviderApiKey: (providerId: string) => string,
 *   onSaveSettings: (partial: Partial<import('../types.js').Settings>) => void,
 *   onSaveProviderApiKey: (providerId: string, key: string, remember: boolean) => void,
 *   onClearProviderApiKey: (providerId: string) => void,
 *   onSyncKeyPersistence: (remember: boolean) => void,
 *   onAddCustomProvider: (provider: import('../types.js').CustomAiProvider, apiKey: string, remember: boolean) => void,
 *   onDeleteCustomProvider: (providerId: string) => void,
 *   onTestConnectivity: (providerId: string, overrideKey?: string, overrideModel?: string) => Promise<import('../types.js').ProviderConnectivityResult>,
 *   onExportBackup: () => Promise<void>,
 *   onImportBackup: (jsonText: string) => Promise<void>,
 *   onClearAllData: () => Promise<void>
 * }} props
 * @returns {HTMLElement}
 */
export function renderSettingsView(props) {
  const root = el('div', { className: 'settings-view' });
  const customProviders = props.settings.customProviders || [];
  const allProviders = getAllProviders(customProviders);
  const connectivityMap = props.settings.connectivityResults || {};

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

  // 2. BYOK AI 深度诊断设置（含 8 家内置 + 自定义服务商 + 连通性测试）
  const activeProvider = getProviderById(props.settings.aiProviderId, customProviders);

  const providerSelect = /** @type {HTMLSelectElement} */ (
    el(
      'select',
      { className: 'input-control', id: 'setting-ai-provider' },
      allProviders.map((p) => {
        const statusLabel = getProviderCorsStatusLabel(p, connectivityMap[p.id]);
        const customPrefix = p.isCustom ? '[自定义] ' : '';
        return el(
          'option',
          { value: p.id, selected: activeProvider.id === p.id },
          [`${customPrefix}${p.name} (${p.host}) · ${statusLabel}`],
        );
      }),
    )
  );

  const modelInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'text',
      id: 'setting-ai-model',
      className: 'input-control',
      value: props.settings.aiModel || activeProvider.defaultModel,
      placeholder: `例如 ${activeProvider.defaultModel}`,
    })
  );

  const keyInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'password',
      id: 'setting-ai-key',
      className: 'input-control',
      placeholder: props.getProviderApiKey(activeProvider.id)
        ? '已为当前服务商保存 Key（如需更换请直接输入新 Key）'
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

  const keyStatusEl = el('div', { className: 'muted-text small-note', id: 'setting-key-status' });
  const activeConnectivityBox = el('div', { className: 'connectivity-meta', id: 'active-connectivity-box' });

  /** @param {string} providerId */
  const refreshSelectedProviderInfo = (providerId) => {
    const p = getProviderById(providerId, customProviders);
    const savedKey = props.getProviderApiKey(p.id);
    const conn = connectivityMap[p.id] || null;
    const statusLabel = getProviderCorsStatusLabel(p, conn);

    keyInput.placeholder = savedKey
      ? '已为当前服务商保存 Key（如需更换请直接输入新 Key）'
      : `输入 ${p.name} 的 API Key`;
    keyStatusEl.textContent = `当前服务商 Key 状态：${maskApiKey(savedKey)}（界面永不回显完整凭证）`;

    const connNodes = [
      el('span', { className: `badge ${corsStatusBadgeClass(p, conn)}` }, [
        `浏览器直连：${statusLabel}`,
      ]),
      el('span', { className: 'muted-text small-note' }, [`接口基址：${p.baseUrl}`]),
    ];
    if (conn) {
      connNodes.push(
        el(
          'div',
          { className: `alert-box ${conn.ok ? 'alert-info' : 'alert-error'} small-alert` },
          [
            `上次连通性测试（${formatTestTimestamp(conn.testedAtUtcMs)}）：${conn.ok ? `✅ 成功，耗时 ${conn.latencyMs} ms（${conn.message}）` : `❌ 失败 [${conn.errorCode || 'ERROR'}]：${conn.message}`}`,
          ],
        ),
      );
    } else if (p.browserCorsStatus === 'unverified') {
      connNodes.push(
        el('div', { className: 'alert-box alert-warning small-alert' }, [
          '该服务商浏览器直连状态为“待验证”，请填入 API Key 后点击下方“测试连通性”完成实测验证。',
        ]),
      );
    }
    activeConnectivityBox.replaceChildren(...connNodes);
  };

  providerSelect.addEventListener('change', () => {
    const p = getProviderById(providerSelect.value, customProviders);
    modelInput.value = p.defaultModel;
    keyInput.value = '';
    refreshSelectedProviderInfo(p.id);
  });

  refreshSelectedProviderInfo(activeProvider.id);

  const saveAiBtn = el(
    'button',
    {
      type: 'button',
      id: 'save-ai-settings-btn',
      className: 'btn btn-primary',
      onClick: () => {
        const provider = getProviderById(providerSelect.value, customProviders);
        const model = modelInput.value.trim() || provider.defaultModel;
        const remember = rememberCheckbox.checked;
        props.onSaveSettings({
          aiProviderId: provider.id,
          aiModel: model,
          rememberApiKey: remember,
        });
        const newKey = keyInput.value.trim();
        if (newKey) {
          props.onSaveProviderApiKey(provider.id, newKey, remember);
          keyInput.value = '';
        } else {
          props.onSyncKeyPersistence(remember);
        }
        showToast(`已保存 ${provider.name} 的 AI 接口配置`, 'success');
      },
    },
    ['保存 AI 配置'],
  );

  const testActiveBtn = /** @type {HTMLButtonElement} */ (
    el(
      'button',
      {
        type: 'button',
        id: 'test-active-provider-btn',
        className: 'btn btn-outline',
        onClick: async () => {
          const provider = getProviderById(providerSelect.value, customProviders);
          const inlineKey = keyInput.value.trim();
          const inlineModel = modelInput.value.trim() || provider.defaultModel;
          const remember = rememberCheckbox.checked;
          if (inlineKey) {
            props.onSaveProviderApiKey(provider.id, inlineKey, remember);
          }
          testActiveBtn.disabled = true;
          testActiveBtn.textContent = '正在测试连通性…';
          try {
            const res = await props.onTestConnectivity(provider.id, inlineKey, inlineModel);
            if (res.ok) {
              showToast(`${provider.name} 连通性通过（${res.latencyMs} ms）`, 'success', 4000);
            } else {
              showToast(`${provider.name} 连通性失败：${res.message}`, 'error', 5000);
            }
          } finally {
            testActiveBtn.disabled = false;
            testActiveBtn.textContent = '测试连通性';
          }
        },
      },
      ['测试连通性'],
    )
  );

  const clearKeyBtn = el(
    'button',
    {
      type: 'button',
      id: 'clear-ai-key-btn',
      className: 'btn btn-secondary',
      onClick: () => {
        const provider = getProviderById(providerSelect.value, customProviders);
        props.onClearProviderApiKey(provider.id);
        keyInput.value = '';
        showToast(`已清除 ${provider.name} 在本浏览器保存的 API Key`, 'info');
      },
    },
    ['清除当前服务商 Key'],
  );

  root.appendChild(
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title' }, ['AI 深度诊断配置（BYOK 用户自备 Key）']),
      el('p', { className: 'muted-text small-note' }, [
        '支持 8 家内置 OpenAI 兼容服务商及自定义 HTTPS 服务商。标注“待验证”的服务商浏览器直连支持尚未实测，请先通过“测试连通性”验证；Key 默认仅存于 sessionStorage（关闭标签页即销毁），请求直连目标服务商，绝不经过我方服务器。',
      ]),
      el('div', { className: 'settings-grid' }, [
        el('label', { className: 'form-field' }, [el('span', {}, ['大模型服务商']), providerSelect]),
        el('label', { className: 'form-field' }, [el('span', {}, ['模型 ID（可按需修改）']), modelInput]),
        el('label', { className: 'form-field form-field-full' }, [
          el('span', {}, ['API Key（按服务商独立存储，输入后仅遮罩展示）']),
          keyInput,
        ]),
        el('label', { className: 'checkbox-field form-field-full' }, [
          rememberCheckbox,
          el('span', {}, ['记住 Key 到本地浏览器 localStorage（公用电脑请勿勾选）']),
        ]),
      ]),
      keyStatusEl,
      activeConnectivityBox,
      el('div', { className: 'settings-actions' }, [saveAiBtn, testActiveBtn, clearKeyBtn]),
    ]),
  );

  // 2b. 全部服务商列表与逐项连通性测试（R3 + R4）
  const providerRows = allProviders.map((p) => {
    const conn = connectivityMap[p.id] || null;
    const savedKey = props.getProviderApiKey(p.id);
    const statusLabel = getProviderCorsStatusLabel(p, conn);
    const isSelected = activeProvider.id === p.id;

    const rowTestBtn = /** @type {HTMLButtonElement} */ (
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-outline btn-sm',
          dataset: { testProvider: p.id },
          onClick: async () => {
            rowTestBtn.disabled = true;
            rowTestBtn.textContent = '测试中…';
            try {
              const res = await props.onTestConnectivity(p.id);
              if (res.ok) {
                showToast(`${p.name} 连通性通过（${res.latencyMs} ms）`, 'success', 4000);
              } else {
                showToast(`${p.name} 连通性失败：${res.message}`, 'error', 5000);
              }
            } finally {
              rowTestBtn.disabled = false;
              rowTestBtn.textContent = '测试连通性';
            }
          },
        },
        ['测试连通性'],
      )
    );

    const selectBtn = el(
      'button',
      {
        type: 'button',
        className: `btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`,
        disabled: isSelected,
        onClick: () => {
          props.onSaveSettings({
            aiProviderId: p.id,
            aiModel: p.defaultModel,
          });
          showToast(`已切换当前服务商为 ${p.name}`, 'info');
        },
      },
      [isSelected ? '当前选用' : '选用'],
    );

    const deleteBtn = p.isCustom
      ? el(
          'button',
          {
            type: 'button',
            className: 'btn btn-ghost btn-sm text-danger',
            dataset: { deleteCustomProvider: p.id },
            onClick: () => {
              showModal({
                title: '删除自定义服务商',
                body: `确定删除自定义服务商“${p.name}”（${p.baseUrl}）并清除其本地保存的 Key 与测试记录吗？`,
                confirmText: '确认删除',
                danger: true,
                onConfirm: () => {
                  props.onDeleteCustomProvider(p.id);
                  showToast(`已删除自定义服务商：${p.name}`, 'info');
                },
              });
            },
          },
          ['删除'],
        )
      : null;

    const connSummaryText = conn
      ? conn.ok
        ? `成功 · ${conn.latencyMs} ms（${formatTestTimestamp(conn.testedAtUtcMs)}）`
        : `失败 [${conn.errorCode || 'ERR'}]（${formatTestTimestamp(conn.testedAtUtcMs)}）`
      : '尚未测试';

    return el('tr', { className: isSelected ? 'provider-row-active' : '' }, [
      el('td', {}, [
        el('div', { className: 'provider-name-cell' }, [
          el('strong', {}, [p.name]),
          p.isCustom ? el('span', { className: 'mini-tag tag-blue' }, ['自定义']) : null,
        ]),
        el('div', { className: 'muted-text small-note' }, [`${p.baseUrl} · 默认 ${p.defaultModel}`]),
      ]),
      el('td', { className: 'nowrap' }, [
        el('span', { className: `badge ${corsStatusBadgeClass(p, conn)}` }, [statusLabel]),
      ]),
      el('td', { className: 'nowrap' }, [maskApiKey(savedKey)]),
      el('td', { title: conn ? conn.message : '' }, [connSummaryText]),
      el('td', { className: 'nowrap' }, [
        el('div', { className: 'provider-row-actions' }, [selectBtn, rowTestBtn, deleteBtn]),
      ]),
    ]);
  });

  root.appendChild(
    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title' }, ['服务商列表与连通性验证状态']),
      el('p', { className: 'muted-text small-note' }, [
        '轻量连通性测试优先请求 GET {baseUrl}/models，若服务商不支持则自动回退为 max_tokens=1 的最小 chat/completions 请求，并按服务商记录最近测试时间与耗时。',
      ]),
      el('div', { className: 'table-scroll-wrap provider-table-wrap' }, [
        el('table', { className: 'metrics-table tabular-nums' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', {}, ['服务商与接口基址']),
              el('th', {}, ['浏览器直连状态']),
              el('th', {}, ['Key 状态']),
              el('th', {}, ['最近连通性测试']),
              el('th', {}, ['操作']),
            ]),
          ]),
          el('tbody', {}, providerRows),
        ]),
      ]),
    ]),
  );

  // 2c. 添加自定义 OpenAI 兼容服务商（R2）
  const customNameInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'text',
      id: 'custom-provider-name',
      className: 'input-control',
      placeholder: '例如：个人中转网关 / 兼容服务商',
    })
  );
  const customUrlInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'url',
      id: 'custom-provider-url',
      className: 'input-control',
      placeholder: 'https://api.example.com/v1',
    })
  );
  const customModelInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'text',
      id: 'custom-provider-model',
      className: 'input-control',
      placeholder: '例如：gpt-4o-mini 或 deepseek-chat',
    })
  );
  const customKeyInput = /** @type {HTMLInputElement} */ (
    el('input', {
      type: 'password',
      id: 'custom-provider-key',
      className: 'input-control',
      placeholder: 'API Key（默认仅存 sessionStorage，可选）',
      autocomplete: 'off',
    })
  );
  const customErrBox = el('div', { className: 'alert-box alert-error is-hidden', id: 'custom-provider-error', role: 'alert' });

  const addCustomBtn = el(
    'button',
    {
      type: 'button',
      id: 'add-custom-provider-btn',
      className: 'btn btn-secondary',
      onClick: () => {
        const checked = validateCustomProviderInput({
          name: customNameInput.value,
          baseUrl: customUrlInput.value,
          defaultModel: customModelInput.value,
        });
        if (!checked.ok) {
          customErrBox.textContent = checked.error;
          customErrBox.classList.remove('is-hidden');
          return;
        }
        customErrBox.classList.add('is-hidden');
        const key = customKeyInput.value.trim();
        const remember = rememberCheckbox.checked;
        props.onAddCustomProvider(checked.provider, key, remember);
        showToast(`已添加并选用自定义服务商：${checked.provider.name}（状态：待验证）`, 'success', 4000);
      },
    },
    ['添加并使用自定义服务商'],
  );

  root.appendChild(
    el('section', { className: 'card custom-provider-card' }, [
      el('h2', { className: 'section-title' }, ['添加自定义 OpenAI 兼容服务商']),
      el('p', { className: 'muted-text small-note' }, [
        '兼容标准 OpenAI 协议的第三方或自建接口均可添加。Base URL 必须使用 https://（通常以 /v1 结尾，不含 /chat/completions）；添加后可用于实时诊断、示例报告重新生成与连通性测试。',
      ]),
      el('div', { className: 'settings-grid' }, [
        el('label', { className: 'form-field' }, [el('span', {}, ['显示名称 *']), customNameInput]),
        el('label', { className: 'form-field' }, [el('span', {}, ['Base URL（须为 https://）*']), customUrlInput]),
        el('label', { className: 'form-field' }, [el('span', {}, ['默认模型 ID *']), customModelInput]),
        el('label', { className: 'form-field' }, [
          el('span', {}, ['API Key（遵循上方“记住 Key”设置）']),
          customKeyInput,
        ]),
      ]),
      customErrBox,
      el('div', { className: 'settings-actions' }, [addCustomBtn]),
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
