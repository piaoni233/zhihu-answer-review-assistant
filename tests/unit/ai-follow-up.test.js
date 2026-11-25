import { describe, it, expect, vi } from 'vitest';
import { parseInputBlocks } from '../../src/core/parser.js';
import { validateBatch } from '../../src/core/validator.js';
import { computeBatchMetrics } from '../../src/core/calculator.js';
import { diagnoseBatch } from '../../src/core/diagnoser.js';
import { buildReportModel, serializeReportToMarkdown } from '../../src/core/report.js';
import {
  ZHIHU_SAMPLE_TEXT,
  SAMPLE_AS_OF_UTC_MS,
  SAMPLE_AI_DIAGNOSIS,
} from '../../src/core/zhihu-sample.js';
import {
  AI_PROVIDERS,
  getAllProviders,
  getProviderById,
  getProviderCorsStatusLabel,
  validateCustomProviderInput,
} from '../../src/ai/providers.js';
import {
  AI_ERROR_MESSAGES,
  generateSampleAiWithFallback,
  requestLiveAiDiagnosis,
  testProviderConnectivity,
} from '../../src/ai/client.js';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  saveProviderConnectivityResult,
  loadProviderApiKey,
  saveProviderApiKey,
  clearProviderApiKey,
  syncApiKeyPersistence,
  clearAllApiKeys,
} from '../../src/storage/settings-store.js';
import { ENGINE_VERSION } from '../../src/types.js';

function makeMockWebStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function buildSampleContext() {
  const parsed = parseInputBlocks(ZHIHU_SAMPLE_TEXT);
  const metrics = computeBatchMetrics(parsed.items, {
    asOfUtcMs: SAMPLE_AS_OF_UTC_MS,
    settings: DEFAULT_SETTINGS,
  });
  const diagnosis = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);
  return { parsed, metrics, diagnosis };
}

describe('R3 — Built-in providers list integrity & CORS verification badges', () => {
  it('contains all 8 built-in providers with unique IDs, valid HTTPS baseUrls, and default models', () => {
    const ids = AI_PROVIDERS.map((p) => p.id);
    expect(ids).toEqual([
      'deepseek',
      'moonshot',
      'dashscope',
      'openai',
      'zhipu',
      'doubao',
      'siliconflow',
      'openrouter',
    ]);
    expect(new Set(ids).size).toBe(8);

    for (const p of AI_PROVIDERS) {
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(p.defaultModel.trim().length).toBeGreaterThan(0);
      const parsed = new URL(p.baseUrl);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.host).toBe(p.host);
      expect(p.baseUrl.endsWith('/')).toBe(false);
    }
  });

  it('marks the 4 new built-in providers as unverified ("待验证") until connectivity test passes', () => {
    for (const id of ['deepseek', 'moonshot', 'dashscope', 'openai']) {
      const p = getProviderById(id);
      expect(p.browserCorsStatus).toBe('preflight_passed');
      expect(getProviderCorsStatusLabel(p)).toBe('CORS 预检已放行');
    }

    for (const id of ['zhipu', 'doubao', 'siliconflow', 'openrouter']) {
      const p = getProviderById(id);
      expect(p.browserCorsStatus).toBe('unverified');
      expect(getProviderCorsStatusLabel(p)).toBe('待验证');
      expect(
        getProviderCorsStatusLabel(p, {
          ok: true,
          method: 'models',
          latencyMs: 120,
          testedAtUtcMs: Date.now(),
          errorCode: null,
          message: 'ok',
        }),
      ).toBe('已通过连通性测试');
    }
  });
});

describe('R2 — Custom provider validation, storage, and invocation parity', () => {
  it('validates custom HTTPS OpenAI-compatible provider input and rejects insecure or malformed URLs', () => {
    const okRes = validateCustomProviderInput({
      name: '自建兼容网关',
      baseUrl: 'https://gateway.example.com/v1/',
      defaultModel: 'my-model-v1',
    });
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.provider.baseUrl).toBe('https://gateway.example.com/v1');
      expect(okRes.provider.host).toBe('gateway.example.com');
      expect(okRes.provider.browserCorsStatus).toBe('unverified');
      expect(okRes.provider.isCustom).toBe(true);
      expect(getProviderCorsStatusLabel(okRes.provider)).toBe('待验证');
    }

    // Reject HTTP (non-HTTPS)
    expect(
      validateCustomProviderInput({
        name: '明文地址',
        baseUrl: 'http://gateway.example.com/v1',
        defaultModel: 'gpt-4o-mini',
      }).ok,
    ).toBe(false);

    // Reject invalid URL
    expect(
      validateCustomProviderInput({
        name: '非法地址',
        baseUrl: 'not-a-url',
        defaultModel: 'gpt-4o-mini',
      }).ok,
    ).toBe(false);

    // Reject /chat/completions suffix
    expect(
      validateCustomProviderInput({
        name: '含路径后缀',
        baseUrl: 'https://gateway.example.com/v1/chat/completions',
        defaultModel: 'gpt-4o-mini',
      }).ok,
    ).toBe(false);

    // Reject embedded credentials
    expect(
      validateCustomProviderInput({
        name: '含凭证',
        baseUrl: 'https://user:pass@gateway.example.com/v1',
        defaultModel: 'gpt-4o-mini',
      }).ok,
    ).toBe(false);

    // Reject empty name or model
    expect(
      validateCustomProviderInput({
        name: '   ',
        baseUrl: 'https://gateway.example.com/v1',
        defaultModel: 'gpt-4o-mini',
      }).ok,
    ).toBe(false);
    expect(
      validateCustomProviderInput({
        name: '缺模型',
        baseUrl: 'https://gateway.example.com/v1',
        defaultModel: '',
      }).ok,
    ).toBe(false);
  });

  it('persists custom providers in settings without keys, and stores per-provider keys in sessionStorage by default', () => {
    const local = makeMockWebStorage();
    const session = makeMockWebStorage();

    const checked = validateCustomProviderInput({
      id: 'custom_demo_1',
      name: '团队兼容服务',
      baseUrl: 'https://llm.team.example.com/v1',
      defaultModel: 'team-chat-1',
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;

    saveSettings({ customProviders: [checked.provider], aiProviderId: checked.provider.id }, local);
    const loaded = loadSettings(local);
    expect(loaded.customProviders).toHaveLength(1);
    expect(loaded.customProviders[0].id).toBe('custom_demo_1');
    expect(getAllProviders(loaded.customProviders)).toHaveLength(9);
    expect(getProviderById('custom_demo_1', loaded.customProviders).baseUrl).toBe(
      'https://llm.team.example.com/v1',
    );

    // Key stored in sessionStorage only by default
    saveProviderApiKey('custom_demo_1', 'demo-custom-key-abc', false, { session, local });
    expect(loadProviderApiKey('custom_demo_1', { session, local })).toBe('demo-custom-key-abc');
    expect(local.getItem('zhihu_review_ai_provider_keys_persisted_v1')).toBeNull();
    // Settings JSON never contains the API key
    expect(local.getItem('zhihu_review_settings_v1')).not.toContain('demo-custom-key-abc');

    // Separate provider has isolated key
    expect(loadProviderApiKey('deepseek', { session, local })).toBe('');

    // Opting to remember syncs keys to localStorage; turning off wipes localStorage copy
    syncApiKeyPersistence(true, { session, local });
    expect(local.getItem('zhihu_review_ai_provider_keys_persisted_v1')).toContain('demo-custom-key-abc');
    syncApiKeyPersistence(false, { session, local });
    expect(local.getItem('zhihu_review_ai_provider_keys_persisted_v1')).toBeNull();
    expect(loadProviderApiKey('custom_demo_1', { session, local })).toBe('demo-custom-key-abc');

    clearProviderApiKey('custom_demo_1', { session, local });
    expect(loadProviderApiKey('custom_demo_1', { session, local })).toBe('');
    clearAllApiKeys({ session, local });
  });

  it('uses custom provider endpoints identically for live diagnosis, R1 sample regen, and R4 connectivity test', async () => {
    const { metrics, diagnosis } = buildSampleContext();
    const checked = validateCustomProviderInput({
      id: 'custom_parity_1',
      name: '自定义测试接口',
      baseUrl: 'https://custom.api.example.com/v1',
      defaultModel: 'custom-chat',
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;

    const calls = [];
    const mockFetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      if (String(url).endsWith('/models')) {
        return /** @type {any} */ ({
          ok: true,
          json: async () => ({ data: [{ id: 'custom-chat' }] }),
        });
      }
      return /** @type {any} */ ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  overallInsight: '总阅读 54400，加权互动率 4.00%。',
                  commentReinterpretation: ['评论区质疑集中于信源。'],
                  rewriteSuggestions: [
                    {
                      targetTitle: '2026 年普通人还有必要花精力考软考高项吗？',
                      diagnosis: '阅读 32000，互动率 2.00%。',
                      concreteEdit: '首屏补充适用人群与政策来源。',
                    },
                  ],
                }),
              },
            },
          ],
        }),
      });
    });

    const conn = await testProviderConnectivity({
      provider: checked.provider,
      apiKey: 'mock-custom-key',
      fetchImpl: mockFetch,
    });
    expect(conn.ok).toBe(true);
    expect(conn.method).toBe('models');

    const live = await requestLiveAiDiagnosis({
      providerId: checked.provider.id,
      customProviders: [checked.provider],
      apiKey: 'mock-custom-key',
      metrics,
      diagnosis,
      fetchImpl: mockFetch,
    });
    expect(live.mode).toBe('live_byok');
    expect(live.providerName).toBe('自定义测试接口');

    const sampleOutcome = await generateSampleAiWithFallback({
      provider: checked.provider,
      apiKey: 'mock-custom-key',
      metrics,
      diagnosis,
      fallbackDiagnosis: SAMPLE_AI_DIAGNOSIS,
      fetchImpl: mockFetch,
    });
    expect(sampleOutcome.usedFallback).toBe(false);
    expect(sampleOutcome.result.mode).toBe('live_byok');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://custom.api.example.com/v1/models',
      'POST https://custom.api.example.com/v1/chat/completions',
      'POST https://custom.api.example.com/v1/chat/completions',
    ]);
  });
});

describe('R1 — Sample AI regeneration with automatic fallback on no-key / timeout / all 6 error categories', () => {
  it('returns live real-time result with verifier number check when call succeeds', async () => {
    const { metrics, diagnosis } = buildSampleContext();
    const outcome = await generateSampleAiWithFallback({
      providerId: 'deepseek',
      apiKey: 'mock-valid-key',
      metrics,
      diagnosis,
      fallbackDiagnosis: SAMPLE_AI_DIAGNOSIS,
      fetchImpl: async () =>
        /** @type {any} */ ({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    overallInsight: '实时复盘：总阅读 54400，编造数字 99.99% 应被核验标出。',
                    commentReinterpretation: ['高阅读回答评论存在质疑信号。'],
                    rewriteSuggestions: [],
                  }),
                },
              },
            ],
          }),
        }),
    });

    expect(outcome.usedFallback).toBe(false);
    expect(outcome.fallbackNotice).toBeNull();
    expect(outcome.result.mode).toBe('live_byok');
    expect(outcome.result.disclaimer).toContain('实时 AI 诊断');
    expect(outcome.result.verification.hasUnverified).toBe(true);
    expect(outcome.result.verification.unverifiedTokens).toContain('99.99%');
  });

  it('falls back immediately without calling fetch when API key is missing', async () => {
    const { metrics, diagnosis } = buildSampleContext();
    const fetchSpy = vi.fn();

    const outcome = await generateSampleAiWithFallback({
      providerId: 'deepseek',
      apiKey: '',
      metrics,
      diagnosis,
      fallbackDiagnosis: SAMPLE_AI_DIAGNOSIS,
      fetchImpl: fetchSpy,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.fallbackReasonCode).toBe('NO_API_KEY');
    expect(outcome.fallbackNotice).toContain('未配置 Key');
    expect(outcome.fallbackNotice).toContain('预先生成的示例 AI 诊断');
    expect(outcome.result.mode).toBe('sample_pregenerated');
    expect(outcome.result.overallInsight).toBe(SAMPLE_AI_DIAGNOSIS.overallInsight);
  });

  it('falls back with exact Chinese reason on TIMEOUT and every one of the 6 error categories', async () => {
    const { metrics, diagnosis } = buildSampleContext();

    /** @type {Array<{code: import('../../src/ai/client.js').AiErrorCode, fetchImpl: typeof fetch, timeoutMs?: number}>} */
    const cases = [
      {
        code: 'AUTH_INVALID',
        fetchImpl: async () => /** @type {any} */ ({ ok: false, status: 401, text: async () => 'unauthorized' }),
      },
      {
        code: 'QUOTA_EXCEEDED',
        fetchImpl: async () => /** @type {any} */ ({ ok: false, status: 429, text: async () => 'rate limit' }),
      },
      {
        code: 'MODEL_NOT_FOUND',
        fetchImpl: async () => /** @type {any} */ ({ ok: false, status: 404, text: async () => 'model_not_found' }),
      },
      {
        code: 'TIMEOUT',
        timeoutMs: 15,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      },
      {
        code: 'CORS_OR_NETWORK',
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch');
        },
      },
      {
        code: 'PARSE_ERROR',
        fetchImpl: async () =>
          /** @type {any} */ ({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'broken non-json' } }] }),
          }),
      },
    ];

    for (const tc of cases) {
      const outcome = await generateSampleAiWithFallback({
        providerId: 'deepseek',
        apiKey: 'mock-key-123',
        metrics,
        diagnosis,
        fallbackDiagnosis: SAMPLE_AI_DIAGNOSIS,
        fetchImpl: tc.fetchImpl,
        timeoutMs: tc.timeoutMs,
      });

      expect(outcome.usedFallback).toBe(true);
      expect(outcome.fallbackReasonCode).toBe(tc.code);
      expect(outcome.fallbackNotice).toContain(AI_ERROR_MESSAGES[tc.code]);
      expect(outcome.fallbackNotice).toContain('预先生成的示例 AI 诊断');
      expect(outcome.result.mode).toBe('sample_pregenerated');
      expect(outcome.result.fallbackNotice).toBe(outcome.fallbackNotice);
    }
  });
});

describe('R4 — Connectivity test with mocked fetch (GET /models -> chat fallback) & persistence', () => {
  it('succeeds via GET {baseUrl}/models and reports latency in ms', async () => {
    let t = 1000;
    const mockFetch = vi.fn(async (url, init) => {
      t += 85;
      expect(url).toBe('https://api.deepseek.com/v1/models');
      expect(init?.method).toBe('GET');
      return /** @type {any} */ ({
        ok: true,
        json: async () => ({ object: 'list', data: [{ id: 'deepseek-chat' }] }),
      });
    });

    const res = await testProviderConnectivity({
      providerId: 'deepseek',
      apiKey: 'mock-key-123',
      fetchImpl: mockFetch,
      nowFn: () => t,
    });

    expect(res.ok).toBe(true);
    expect(res.method).toBe('models');
    expect(res.latencyMs).toBe(85);
    expect(res.errorCode).toBeNull();
    expect(res.message).toContain('85 ms');

    // Persist per-provider result in settings
    const local = makeMockWebStorage();
    saveProviderConnectivityResult('deepseek', res, local);
    const reloaded = loadSettings(local);
    expect(reloaded.connectivityResults?.deepseek?.ok).toBe(true);
    expect(reloaded.connectivityResults?.deepseek?.latencyMs).toBe(85);
    expect(reloaded.connectivityResults?.deepseek?.testedAtUtcMs).toBe(res.testedAtUtcMs);
  });

  it('falls back to minimal POST /chat/completions (max_tokens=1) when /models is unsupported', async () => {
    let t = 2000;
    const calls = [];
    const mockFetch = vi.fn(async (url, init) => {
      t += 60;
      calls.push({ url: String(url), method: init?.method, body: init?.body });
      if (String(url).endsWith('/models')) {
        return /** @type {any} */ ({
          ok: false,
          status: 404,
          text: async () => 'not found',
        });
      }
      const parsedBody = JSON.parse(String(init?.body));
      expect(parsedBody.max_tokens).toBe(1);
      expect(parsedBody.model).toBe('glm-4-flash');
      return /** @type {any} */ ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      });
    });

    const res = await testProviderConnectivity({
      providerId: 'zhipu',
      apiKey: 'mock-zhipu-key',
      fetchImpl: mockFetch,
      nowFn: () => t,
    });

    expect(res.ok).toBe(true);
    expect(res.method).toBe('chat_fallback');
    expect(res.latencyMs).toBe(120);
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe('GET');
    expect(calls[1].method).toBe('POST');
  });

  it('maps connectivity failures to the existing 6 Chinese error categories', async () => {
    // Missing key
    const noKey = await testProviderConnectivity({
      providerId: 'openai',
      apiKey: '',
    });
    expect(noKey.ok).toBe(false);
    expect(noKey.errorCode).toBe('AUTH_INVALID');

    // 401 on /models -> AUTH_INVALID immediately without fallback
    const authFetch = vi.fn(async () => /** @type {any} */ ({ ok: false, status: 401, text: async () => 'bad key' }));
    const authRes = await testProviderConnectivity({
      providerId: 'openai',
      apiKey: 'bad-key',
      fetchImpl: authFetch,
    });
    expect(authRes.ok).toBe(false);
    expect(authRes.errorCode).toBe('AUTH_INVALID');
    expect(authRes.message).toBe(AI_ERROR_MESSAGES.AUTH_INVALID);
    expect(authFetch).toHaveBeenCalledTimes(1);

    // 429 on /models -> QUOTA_EXCEEDED
    const quotaRes = await testProviderConnectivity({
      providerId: 'openai',
      apiKey: 'mock-key',
      fetchImpl: async () => /** @type {any} */ ({ ok: false, status: 429, text: async () => 'quota exceeded' }),
    });
    expect(quotaRes.ok).toBe(false);
    expect(quotaRes.errorCode).toBe('QUOTA_EXCEEDED');
    expect(quotaRes.message).toBe(AI_ERROR_MESSAGES.QUOTA_EXCEEDED);

    // 404 on /models then 404 on /chat/completions -> MODEL_NOT_FOUND
    const modelNotFoundRes = await testProviderConnectivity({
      providerId: 'doubao',
      apiKey: 'mock-key',
      fetchImpl: async () => /** @type {any} */ ({ ok: false, status: 404, text: async () => 'model_not_found' }),
    });
    expect(modelNotFoundRes.ok).toBe(false);
    expect(modelNotFoundRes.errorCode).toBe('MODEL_NOT_FOUND');

    // Timeout
    const timeoutRes = await testProviderConnectivity({
      providerId: 'siliconflow',
      apiKey: 'mock-key',
      timeoutMs: 15,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    });
    expect(timeoutRes.ok).toBe(false);
    expect(timeoutRes.errorCode).toBe('TIMEOUT');

    // CORS / network error
    const corsRes = await testProviderConnectivity({
      providerId: 'openrouter',
      apiKey: 'mock-key',
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(corsRes.ok).toBe(false);
    expect(corsRes.errorCode).toBe('CORS_OR_NETWORK');

    // Parse error on fallback chat response
    const parseRes = await testProviderConnectivity({
      providerId: 'zhipu',
      apiKey: 'mock-key',
      fetchImpl: async (url) => {
        if (String(url).endsWith('/models')) {
          return /** @type {any} */ ({ ok: false, status: 405, text: async () => 'not allowed' });
        }
        return /** @type {any} */ ({ ok: true, json: async () => ({ unexpected: true }) });
      },
    });
    expect(parseRes.ok).toBe(false);
    expect(parseRes.errorCode).toBe('PARSE_ERROR');
  });
});

describe('R5 — Completeness audit fixes (re-pasting # comments, duplicate title notice, category baseline note)', () => {
  it('ignores # comment lines when re-pasting generated nextTemplate', () => {
    const { metrics, diagnosis } = buildSampleContext();
    const model = buildReportModel(metrics, diagnosis, {
      reviewId: 'rev_r5_1',
      createdAtUtcMs: SAMPLE_AS_OF_UTC_MS,
      engineVersion: ENGINE_VERSION,
      isSample: false,
      settings: DEFAULT_SETTINGS,
    });

    const reparsed = parseInputBlocks(model.nextTemplate);
    expect(reparsed.items).toHaveLength(3);
    expect(reparsed.blockingErrors).toHaveLength(0);
    expect(reparsed.notices.filter((n) => n.code === 'UNKNOWN_FIELD')).toHaveLength(0);
  });

  it('emits a visible DUPLICATE_TITLE notice when two blocks share the same normalized title', () => {
    const dupText = `标题：重复问题测试？
发布时间：2026-11-15 10:00
阅读：1000
赞同：40
收藏：50
评论：5

标题：重复问题测试
发布时间：2026-11-18 10:00
阅读：1500
赞同：60
收藏：70
评论：8`;
    const parsed = parseInputBlocks(dupText);
    const val = validateBatch(parsed, DEFAULT_SETTINGS, SAMPLE_AS_OF_UTC_MS);
    expect(val.canGenerate).toBe(true);
    expect(val.notices.some((n) => n.code === 'DUPLICATE_TITLE')).toBe(true);
  });

  it('surfaces categoryReferenceNote and AI fallbackNotice in ReportModel and Markdown export', () => {
    const parsed = parseInputBlocks(ZHIHU_SAMPLE_TEXT);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: SAMPLE_AS_OF_UTC_MS,
      settings: DEFAULT_SETTINGS,
    });
    const historyBaseline = {
      sampleCount: 12,
      medianEngagementRate: 5.0,
      medianUpvoteRate: 2.0,
      medianCollectRate: 2.5,
      medianCommentRate: 0.5,
      byCategory: {
        干货: { sampleCount: 6, medianEngagementRate: 6.25 },
      },
    };
    const diagnosis = diagnoseBatch(metrics, historyBaseline, DEFAULT_SETTINGS);
    const model = buildReportModel(metrics, diagnosis, {
      reviewId: 'rev_r5_2',
      createdAtUtcMs: SAMPLE_AS_OF_UTC_MS,
      engineVersion: ENGINE_VERSION,
      isSample: true,
      settings: DEFAULT_SETTINGS,
      aiDiagnosis: {
        ...SAMPLE_AI_DIAGNOSIS,
        fallbackNotice: '未配置 Key，已自动回退展示预先生成的示例 AI 诊断。',
      },
    });

    expect(model.overviewRows[0].categoryReferenceNote).toContain('同类型（干货）历史中位参考');
    const md = serializeReportToMarkdown(model);
    expect(md).toContain('同类型历史中位参考');
    expect(md).toContain('6.25%');
    expect(md).toContain('未配置 Key，已自动回退展示预先生成的示例 AI 诊断。');
  });
});
