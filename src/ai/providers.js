// @ts-check

/**
 * 内置 OpenAI 兼容大模型服务商配置与自定义服务商校验（详细设计 §7.1、§10）
 * - 前 4 家（DeepSeek / Moonshot / 通义 DashScope / OpenAI）在阶段一已通过 CORS 预检；
 * - 新增 4 家（智谱 AI / 豆包火山方舟 / 硅基流动 / OpenRouter）及用户自定义服务商均标注为“待验证”，
 *   须由用户通过连通性测试实际验证浏览器直连可用性，不在代码或界面中提前断言支持。
 */

/**
 * @typedef {Object} AiProviderConfig
 * @property {string} id
 * @property {string} name
 * @property {string} host
 * @property {string} baseUrl
 * @property {string} defaultModel
 * @property {import('../types.js').BrowserCorsStatus} browserCorsStatus
 * @property {boolean} [isCustom]
 */

/** @type {AiProviderConfig[]} */
export const AI_PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek（推荐）',
    host: 'api.deepseek.com',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    browserCorsStatus: 'preflight_passed',
    isCustom: false,
  },
  {
    id: 'moonshot',
    name: 'Moonshot（Kimi）',
    host: 'api.moonshot.cn',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    browserCorsStatus: 'preflight_passed',
    isCustom: false,
  },
  {
    id: 'dashscope',
    name: '通义千问 DashScope 兼容',
    host: 'dashscope.aliyuncs.com',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    browserCorsStatus: 'preflight_passed',
    isCustom: false,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    host: 'api.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    browserCorsStatus: 'preflight_passed',
    isCustom: false,
  },
  {
    id: 'zhipu',
    name: '智谱 AI（BigModel）',
    host: 'open.bigmodel.cn',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    browserCorsStatus: 'unverified',
    isCustom: false,
  },
  {
    id: 'doubao',
    name: '豆包（火山方舟）',
    host: 'ark.cn-beijing.volces.com',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1-5-pro-32k-250115',
    browserCorsStatus: 'unverified',
    isCustom: false,
  },
  {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    host: 'api.siliconflow.cn',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    browserCorsStatus: 'unverified',
    isCustom: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    host: 'openrouter.ai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    browserCorsStatus: 'unverified',
    isCustom: false,
  },
];

/**
 * 合并内置与自定义服务商列表。
 * @param {import('../types.js').CustomAiProvider[]} [customProviders=[]]
 * @returns {AiProviderConfig[]}
 */
export function getAllProviders(customProviders = []) {
  const customs = Array.isArray(customProviders) ? customProviders : [];
  return [...AI_PROVIDERS, ...customs];
}

/**
 * 按 ID 精确查找服务商（包含内置与自定义）；找不到返回 null。
 * @param {string} id
 * @param {import('../types.js').CustomAiProvider[]} [customProviders=[]]
 * @returns {AiProviderConfig|null}
 */
export function findProviderById(id, customProviders = []) {
  return getAllProviders(customProviders).find((p) => p.id === id) || null;
}

/**
 * 按 ID 获取服务商（支持内置与自定义），未匹配时回退至默认首项（DeepSeek）。
 * @param {string} id
 * @param {import('../types.js').CustomAiProvider[]} [customProviders=[]]
 * @returns {AiProviderConfig}
 */
export function getProviderById(id, customProviders = []) {
  return findProviderById(id, customProviders) || AI_PROVIDERS[0];
}

/**
 * 返回服务商当前的浏览器直连验证状态文案。
 * 未经连通性测试验证的新服务商/自定义服务商一律标注为“待验证”。
 * @param {AiProviderConfig} provider
 * @param {import('../types.js').ProviderConnectivityResult|null|undefined} [connectivity]
 * @returns {string}
 */
export function getProviderCorsStatusLabel(provider, connectivity = null) {
  if (connectivity && connectivity.ok) {
    return '已通过连通性测试';
  }
  if (provider.browserCorsStatus === 'preflight_passed') {
    return 'CORS 预检已放行';
  }
  return '待验证';
}

/**
 * 生成自定义服务商唯一 ID。
 * @returns {string}
 */
export function generateCustomProviderId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `custom_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 校验并规范化用户输入的自定义 OpenAI 兼容服务商配置（要求 HTTPS Base URL）。
 * @param {{id?:string, name:string, baseUrl:string, defaultModel:string}} input
 * @returns {{ok:boolean, provider:import('../types.js').CustomAiProvider|null, error:string|null}}
 */
export function validateCustomProviderInput(input) {
  const name = String(input?.name || '').trim();
  const rawUrl = String(input?.baseUrl || '').trim();
  const defaultModel = String(input?.defaultModel || '').trim();

  if (!name) {
    return { ok: false, provider: null, error: '请填写自定义服务商的显示名称（例如：公司自建代理）。' };
  }
  if (name.length > 40) {
    return { ok: false, provider: null, error: '服务商显示名称请控制在 40 个字符以内。' };
  }

  if (!rawUrl) {
    return { ok: false, provider: null, error: '请填写 Base URL（例如 https://api.example.com/v1）。' };
  }

  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, provider: null, error: 'Base URL 格式无效，请输入完整的 HTTPS 地址（例如 https://api.example.com/v1）。' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, provider: null, error: '为保障凭证传输安全，自定义服务商 Base URL 必须使用 https:// 协议。' };
  }

  if (!parsed.hostname) {
    return { ok: false, provider: null, error: 'Base URL 缺少合法域名。' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, provider: null, error: 'Base URL 中不得包含用户名或密码凭证。' };
  }

  if (parsed.search || parsed.hash) {
    return { ok: false, provider: null, error: 'Base URL 请勿包含查询参数（?）或锚点（#），填至路径前缀即可（如 /v1）。' };
  }

  const normalizedBaseUrl = rawUrl.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(normalizedBaseUrl)) {
    return {
      ok: false,
      provider: null,
      error: 'Base URL 请填写到版本路径前缀（如 https://api.example.com/v1），不要包含 /chat/completions。',
    };
  }

  if (!defaultModel) {
    return { ok: false, provider: null, error: '请填写该服务商的默认模型 ID（例如 gpt-4o-mini）。' };
  }
  if (defaultModel.length > 100) {
    return { ok: false, provider: null, error: '默认模型 ID 请控制在 100 个字符以内。' };
  }

  return {
    ok: true,
    error: null,
    provider: {
      id: input.id && String(input.id).trim() ? String(input.id).trim() : generateCustomProviderId(),
      name,
      host: parsed.host,
      baseUrl: normalizedBaseUrl,
      defaultModel,
      browserCorsStatus: 'unverified',
      isCustom: true,
    },
  };
}
