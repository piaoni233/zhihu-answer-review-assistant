// @ts-check

/**
 * 阶段一实测通过 CORS 预检的 4 家 OpenAI 兼容服务商配置（详细设计 §7.1）
 */

/**
 * @typedef {Object} AiProviderConfig
 * @property {string} id
 * @property {string} name
 * @property {string} host
 * @property {string} baseUrl
 * @property {string} defaultModel
 */

/** @type {AiProviderConfig[]} */
export const AI_PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek（推荐）',
    host: 'api.deepseek.com',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  {
    id: 'moonshot',
    name: 'Moonshot（Kimi）',
    host: 'api.moonshot.cn',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
  },
  {
    id: 'dashscope',
    name: '通义千问 DashScope 兼容',
    host: 'dashscope.aliyuncs.com',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    host: 'api.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
];

/**
 * @param {string} id
 * @returns {AiProviderConfig}
 */
export function getProviderById(id) {
  return AI_PROVIDERS.find((p) => p.id === id) || AI_PROVIDERS[0];
}
