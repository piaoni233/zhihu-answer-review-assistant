// @ts-check

import { getProviderById } from './providers.js';
import { buildAiMessages, buildSanitizedAiPayload } from './prompt.js';
import { verifyAiOutputNumbers } from './verifier.js';

/**
 * OpenAI 兼容直连客户端、30 秒 AbortController 超时与 6 类中文错误分类（详细设计 §7.4）
 */

export const AI_TIMEOUT_MS = 30_000;

/**
 * @typedef {'AUTH_INVALID'|'QUOTA_EXCEEDED'|'MODEL_NOT_FOUND'|'TIMEOUT'|'CORS_OR_NETWORK'|'PARSE_ERROR'} AiErrorCode
 */

/** @type {Record<AiErrorCode, string>} */
export const AI_ERROR_MESSAGES = {
  AUTH_INVALID: 'API Key 无效或无权限访问该模型，请在设置中核对 Key 是否完整且未过期。',
  QUOTA_EXCEEDED: '当前 API 账号额度已耗尽或触发频率限制，请检查服务商账单或稍后再试。',
  MODEL_NOT_FOUND: '所选模型名称不受该服务商支持，请在设置中确认模型 ID（如 deepseek-chat）。',
  TIMEOUT: '请求大模型接口超时（30 秒），建议检查网络后重试；此超时不影响基础复盘报告使用。',
  CORS_OR_NETWORK:
    '无法直连大模型接口：可能是当前网络不可达，或浏览器拦截了跨域请求（请优先使用已验证支持浏览器的 DeepSeek / Moonshot / 通义接口）。',
  PARSE_ERROR: '模型返回格式不符合预期，无法结构化展示；可重试一次或切换更稳定的模型。',
};

export class AiClientError extends Error {
  /**
   * @param {AiErrorCode} code
   * @param {string} [detail]
   */
  constructor(code, detail = '') {
    super(AI_ERROR_MESSAGES[code]);
    this.name = 'AiClientError';
    /** @type {AiErrorCode} */
    this.code = code;
    this.detail = detail;
  }
}

/**
 * 根据 HTTP 状态码与响应体识别标准错误分类。
 * @param {number} status
 * @param {string} [bodyText='']
 * @returns {AiClientError}
 */
export function classifyHttpError(status, bodyText = '') {
  const lower = String(bodyText || '').toLowerCase();
  if (status === 401 || status === 403) {
    return new AiClientError('AUTH_INVALID', `HTTP ${status}`);
  }
  if (status === 429 || lower.includes('insufficient_quota') || lower.includes('quota')) {
    return new AiClientError('QUOTA_EXCEEDED', `HTTP ${status}`);
  }
  if (status === 404 || lower.includes('model_not_found') || lower.includes('does not exist')) {
    return new AiClientError('MODEL_NOT_FOUND', `HTTP ${status}`);
  }
  return new AiClientError('CORS_OR_NETWORK', `HTTP ${status}`);
}

/**
 * 提取并解析大模型返回的 JSON 结构（兼容 ```json 代码块包裹）。
 * @param {string} rawContent
 * @returns {{overallInsight:string, commentReinterpretation:string[], rewriteSuggestions:import('../types.js').AiRewriteSuggestion[]}}
 */
export function parseAiJsonResponse(rawContent) {
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new AiClientError('PARSE_ERROR', '空响应内容');
  }
  let candidate = rawContent.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(candidate);
  if (fenced) {
    candidate = fenced[1].trim();
  }

  let obj;
  try {
    obj = JSON.parse(candidate);
  } catch {
    throw new AiClientError('PARSE_ERROR', 'JSON 解析失败');
  }

  if (
    !obj ||
    typeof obj.overallInsight !== 'string' ||
    !Array.isArray(obj.commentReinterpretation) ||
    !Array.isArray(obj.rewriteSuggestions)
  ) {
    throw new AiClientError('PARSE_ERROR', '缺少约定字段');
  }

  const rewriteSuggestions = obj.rewriteSuggestions
    .filter((s) => s && typeof s.targetTitle === 'string' && typeof s.concreteEdit === 'string')
    .map((s) => ({
      targetTitle: s.targetTitle.trim(),
      diagnosis: typeof s.diagnosis === 'string' ? s.diagnosis.trim() : '',
      concreteEdit: s.concreteEdit.trim(),
    }));

  return {
    overallInsight: obj.overallInsight.trim(),
    commentReinterpretation: obj.commentReinterpretation
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim()),
    rewriteSuggestions,
  };
}

/**
 * 发起 BYOK 浏览器直连实时 AI 诊断，并执行确定性数字核验。
 * @param {{providerId:string, model?:string, apiKey:string, metrics:import('../types.js').BatchMetrics, diagnosis:import('../types.js').DiagnosisResult, fetchImpl?:typeof fetch, signal?:AbortSignal, timeoutMs?:number}} params
 * @returns {Promise<import('../types.js').AiDiagnosisResult>}
 */
export async function requestLiveAiDiagnosis(params) {
  const provider = getProviderById(params.providerId);
  const model = (params.model || provider.defaultModel).trim();
  const apiKey = (params.apiKey || '').trim();
  const fetchFn = params.fetchImpl ?? globalThis.fetch;

  if (!apiKey) {
    throw new AiClientError('AUTH_INVALID', '未提供 API Key');
  }

  const payload = buildSanitizedAiPayload(params.metrics, params.diagnosis);
  const messages = buildAiMessages(payload);

  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? AI_TIMEOUT_MS;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (params.signal) {
    if (params.signal.aborted) {
      clearTimeout(timer);
      throw new DOMException('已取消 AI 请求', 'AbortError');
    }
    params.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const resp = await fetchFn(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      let errText = '';
      try {
        errText = await resp.text();
      } catch {
        // ignore
      }
      throw classifyHttpError(resp.status, errText);
    }

    let bodyJson;
    try {
      bodyJson = await resp.json();
    } catch {
      throw new AiClientError('PARSE_ERROR', '响应体非 JSON');
    }

    const content = bodyJson?.choices?.[0]?.message?.content;
    const structured = parseAiJsonResponse(content);
    const verification = verifyAiOutputNumbers(structured, payload);

    return {
      mode: 'live_byok',
      providerId: provider.id,
      providerName: provider.name,
      model,
      generatedAtUtcMs: Date.now(),
      disclaimer: `【实时 AI 诊断：由 ${provider.name}（${model}）生成；已对文内引用数字做确定性核验】`,
      overallInsight: structured.overallInsight,
      commentReinterpretation: structured.commentReinterpretation,
      rewriteSuggestions: structured.rewriteSuggestions,
      verification,
    };
  } catch (err) {
    if (err instanceof AiClientError) {
      throw err;
    }
    if (err && typeof err === 'object' && /** @type {any} */ (err).name === 'AbortError') {
      if (timedOut) {
        throw new AiClientError('TIMEOUT', 'timeout');
      }
      throw err;
    }
    throw new AiClientError('CORS_OR_NETWORK', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
    if (params.signal) {
      params.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
