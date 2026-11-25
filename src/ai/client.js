// @ts-check

import { getProviderById } from './providers.js';
import { buildAiMessages, buildSanitizedAiPayload } from './prompt.js';
import { verifyAiOutputNumbers } from './verifier.js';

/**
 * OpenAI 兼容直连客户端、30 秒 AbortController 超时、6 类中文错误分类、
 * 示例报告实时生成与自动回退（R1）以及轻量连通性测试（R4）。
 */

export const AI_TIMEOUT_MS = 30_000;
export const CONNECTIVITY_TIMEOUT_MS = 15_000;

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
    '无法直连大模型接口：可能是当前网络不可达，或浏览器拦截了跨域请求（请先使用“测试连通性”检查，或选用已通过 CORS 预检的服务商）。',
  PARSE_ERROR: '模型返回格式不符合预期，无法结构化展示；可重试一次或切换更稳定的模型。',
};

/** @type {Record<AiErrorCode, string>} */
export const AI_ERROR_SHORT_LABELS = {
  AUTH_INVALID: 'API Key 无效或无权限',
  QUOTA_EXCEEDED: '额度耗尽或触发限流',
  MODEL_NOT_FOUND: '模型不可用',
  TIMEOUT: '请求超时',
  CORS_OR_NETWORK: '网络不可达或跨域受阻',
  PARSE_ERROR: '返回格式异常',
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
 * 同时支持内置服务商与自定义 HTTPS 服务商。
 * @param {{
 *   provider?: import('./providers.js').AiProviderConfig,
 *   providerId?: string,
 *   customProviders?: import('../types.js').CustomAiProvider[],
 *   model?: string,
 *   apiKey: string,
 *   metrics: import('../types.js').BatchMetrics,
 *   diagnosis: import('../types.js').DiagnosisResult,
 *   fetchImpl?: typeof fetch,
 *   signal?: AbortSignal,
 *   timeoutMs?: number
 * }} params
 * @returns {Promise<import('../types.js').AiDiagnosisResult>}
 */
export async function requestLiveAiDiagnosis(params) {
  const provider =
    params.provider || getProviderById(params.providerId || 'deepseek', params.customProviders || []);
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
      fallbackNotice: null,
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

/**
 * R1：内置示例报告的“重新生成 AI 诊断”——尝试实时调用，
 * 若未配置 Key、请求超时或触发任意 6 类错误，则自动回退到预生成示例诊断并返回明确回退原因说明。
 * 确定性报告永远不被 AI 阻塞。
 *
 * @param {{
 *   provider?: import('./providers.js').AiProviderConfig,
 *   providerId?: string,
 *   customProviders?: import('../types.js').CustomAiProvider[],
 *   model?: string,
 *   apiKey: string,
 *   metrics: import('../types.js').BatchMetrics,
 *   diagnosis: import('../types.js').DiagnosisResult,
 *   fallbackDiagnosis: import('../types.js').AiDiagnosisResult,
 *   fetchImpl?: typeof fetch,
 *   signal?: AbortSignal,
 *   timeoutMs?: number
 * }} params
 * @returns {Promise<{
 *   result: import('../types.js').AiDiagnosisResult,
 *   usedFallback: boolean,
 *   fallbackReasonCode: AiErrorCode | 'NO_API_KEY' | null,
 *   fallbackReasonText: string | null,
 *   fallbackNotice: string | null
 * }>}
 */
export async function generateSampleAiWithFallback(params) {
  const provider =
    params.provider || getProviderById(params.providerId || 'deepseek', params.customProviders || []);
  const trimmedKey = String(params.apiKey || '').trim();

  if (!trimmedKey) {
    const fallbackReasonText = '未配置 Key';
    const fallbackNotice = `未配置 Key（当前服务商：${provider.name}），无法发起实时 AI 生成，已自动回退展示预先生成的示例 AI 诊断。`;
    return {
      result: {
        ...params.fallbackDiagnosis,
        fallbackNotice,
      },
      usedFallback: true,
      fallbackReasonCode: 'NO_API_KEY',
      fallbackReasonText,
      fallbackNotice,
    };
  }

  try {
    const liveResult = await requestLiveAiDiagnosis({
      provider,
      model: params.model,
      apiKey: trimmedKey,
      metrics: params.metrics,
      diagnosis: params.diagnosis,
      fetchImpl: params.fetchImpl,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });
    return {
      result: liveResult,
      usedFallback: false,
      fallbackReasonCode: null,
      fallbackReasonText: null,
      fallbackNotice: null,
    };
  } catch (err) {
    // 用户主动取消请求时向上抛出 AbortError，由界面保留当前展示并提示已取消
    if (err && typeof err === 'object' && /** @type {any} */ (err).name === 'AbortError') {
      throw err;
    }

    const aiErr =
      err instanceof AiClientError
        ? err
        : new AiClientError('CORS_OR_NETWORK', err instanceof Error ? err.message : String(err));
    const shortLabel = AI_ERROR_SHORT_LABELS[aiErr.code];
    const fallbackReasonText = `${shortLabel}：${aiErr.message}`;
    const fallbackNotice = `实时 AI 生成失败（${shortLabel}：${aiErr.message}），已自动回退展示预先生成的示例 AI 诊断。`;

    return {
      result: {
        ...params.fallbackDiagnosis,
        fallbackNotice,
      },
      usedFallback: true,
      fallbackReasonCode: aiErr.code,
      fallbackReasonText,
      fallbackNotice,
    };
  }
}

const MODELS_UNSUPPORTED_STATUSES = new Set([400, 404, 405, 422, 501]);

/**
 * R4：服务商轻量连通性测试。
 * 优先请求 `GET {baseUrl}/models`；若服务商不支持 `/models`（如 404/405/501/400/422 或非 JSON 响应），
 * 自动回退为 `POST {baseUrl}/chat/completions`（`max_tokens: 1`）。
 * 成功时报告毫秒级耗时；失败时映射到既有 6 类中文错误分类。
 *
 * @param {{
 *   provider?: import('./providers.js').AiProviderConfig,
 *   providerId?: string,
 *   customProviders?: import('../types.js').CustomAiProvider[],
 *   model?: string,
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 *   nowFn?: () => number
 * }} params
 * @returns {Promise<import('../types.js').ProviderConnectivityResult>}
 */
export async function testProviderConnectivity(params) {
  const provider =
    params.provider || getProviderById(params.providerId || 'deepseek', params.customProviders || []);
  const model = (params.model || provider.defaultModel).trim();
  const apiKey = String(params.apiKey || '').trim();
  const fetchFn = params.fetchImpl ?? globalThis.fetch;
  const nowFn = params.nowFn ?? (() => Date.now());
  const startedAt = nowFn();

  if (!apiKey) {
    return {
      ok: false,
      method: 'none',
      latencyMs: 0,
      testedAtUtcMs: Date.now(),
      errorCode: 'AUTH_INVALID',
      message: `未配置 API Key：${AI_ERROR_MESSAGES.AUTH_INVALID}`,
    };
  }

  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? CONNECTIVITY_TIMEOUT_MS;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (params.signal) {
    if (params.signal.aborted) {
      clearTimeout(timer);
      throw new DOMException('已取消连通性测试', 'AbortError');
    }
    params.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  /** @param {'models'|'chat_fallback'} method @param {AiClientError} aiErr */
  const makeFail = (method, aiErr) => ({
    ok: false,
    method,
    latencyMs: Math.max(0, Math.round(nowFn() - startedAt)),
    testedAtUtcMs: Date.now(),
    errorCode: aiErr.code,
    message: aiErr.message,
  });

  /** @type {'models'|'chat_fallback'} */
  let currentMethod = 'models';

  try {
    // 1. 优先尝试 GET {baseUrl}/models
    const modelsResp = await fetchFn(`${provider.baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (modelsResp.ok) {
      let jsonOk = false;
      try {
        const data = await modelsResp.json();
        jsonOk = Boolean(data && typeof data === 'object');
      } catch {
        jsonOk = false;
      }
      if (jsonOk) {
        const latencyMs = Math.max(0, Math.round(nowFn() - startedAt));
        return {
          ok: true,
          method: 'models',
          latencyMs,
          testedAtUtcMs: Date.now(),
          errorCode: null,
          message: `连通性验证通过（GET /models，耗时 ${latencyMs} ms）`,
        };
      }
      // 200 但返回非 JSON（如反代 HTML 页），回退到 chat/completions 验证
    } else {
      let errText = '';
      try {
        errText = await modelsResp.text();
      } catch {
        // ignore
      }
      // 若为明确鉴权失败或额度耗尽，无需回退直接返回分类错误
      if (!MODELS_UNSUPPORTED_STATUSES.has(modelsResp.status)) {
        return makeFail('models', classifyHttpError(modelsResp.status, errText));
      }
      // 若 400 响应体明确为 quota 耗尽，也不必回退
      const lowerErr = errText.toLowerCase();
      if (lowerErr.includes('insufficient_quota') || lowerErr.includes('quota')) {
        return makeFail('models', new AiClientError('QUOTA_EXCEEDED', `HTTP ${modelsResp.status}`));
      }
    }

    // 2. 回退：最小化 POST {baseUrl}/chat/completions (max_tokens=1)
    currentMethod = 'chat_fallback';
    const chatResp = await fetchFn(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        temperature: 0,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: controller.signal,
    });

    if (!chatResp.ok) {
      let errText = '';
      try {
        errText = await chatResp.text();
      } catch {
        // ignore
      }
      return makeFail('chat_fallback', classifyHttpError(chatResp.status, errText));
    }

    let chatJson;
    try {
      chatJson = await chatResp.json();
    } catch {
      return makeFail('chat_fallback', new AiClientError('PARSE_ERROR', '响应体非 JSON'));
    }

    if (!chatJson || !Array.isArray(chatJson.choices)) {
      return makeFail('chat_fallback', new AiClientError('PARSE_ERROR', '缺少 choices 字段'));
    }

    const latencyMs = Math.max(0, Math.round(nowFn() - startedAt));
    return {
      ok: true,
      method: 'chat_fallback',
      latencyMs,
      testedAtUtcMs: Date.now(),
      errorCode: null,
      message: `连通性验证通过（chat/completions 轻量回退，耗时 ${latencyMs} ms）`,
    };
  } catch (err) {
    if (err instanceof AiClientError) {
      return makeFail(currentMethod, err);
    }
    if (err && typeof err === 'object' && /** @type {any} */ (err).name === 'AbortError') {
      if (timedOut) {
        return makeFail(currentMethod, new AiClientError('TIMEOUT', 'timeout'));
      }
      throw err;
    }
    return makeFail(
      currentMethod,
      new AiClientError('CORS_OR_NETWORK', err instanceof Error ? err.message : String(err)),
    );
  } finally {
    clearTimeout(timer);
    if (params.signal) {
      params.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
