import { describe, it, expect } from 'vitest';
import { parseInputBlocks } from '../../src/core/parser.js';
import { computeBatchMetrics } from '../../src/core/calculator.js';
import { diagnoseBatch } from '../../src/core/diagnoser.js';
import {
  ZHIHU_SAMPLE_TEXT,
  SAMPLE_AS_OF_UTC_MS,
  SAMPLE_AI_DIAGNOSIS,
} from '../../src/core/zhihu-sample.js';
import { buildSanitizedAiPayload, buildConsentMessage } from '../../src/ai/prompt.js';
import { getProviderById } from '../../src/ai/providers.js';
import {
  verifyAiOutputNumbers,
  splitTextWithUnverifiedMarks,
} from '../../src/ai/verifier.js';
import {
  classifyHttpError,
  requestLiveAiDiagnosis,
  AiClientError,
} from '../../src/ai/client.js';

const DEFAULT_SETTINGS = {
  ageThresholdDays: 7,
  smallSampleThreshold: 200,
  maskMentionHandles: true,
  aiProviderId: 'deepseek',
  aiModel: 'deepseek-chat',
  rememberApiKey: false,
};

describe('ai/* (sanitized payload, verifier, client error mapping)', () => {
  it('strictly whitelists outbound AI payload with masked comments and zero raw PII or API key', () => {
    const rawWithPii = `标题：测试脱敏载荷
发布时间：2026-11-15 10:00
阅读：1000
赞同：50
收藏：60
评论：10
代表性评论：
- 请联系 13900001111 或 test.user@example.com，@王五 怎么看`;
    const parsed = parseInputBlocks(rawWithPii);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: SAMPLE_AS_OF_UTC_MS,
      settings: DEFAULT_SETTINGS,
    });
    const diag = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);
    const payload = buildSanitizedAiPayload(metrics, diag);
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain('13900001111');
    expect(serialized).not.toContain('test.user@example.com');
    expect(serialized).not.toContain('王五');
    expect(serialized).toContain('139****1111');
    expect(serialized).toContain('@[用户]');
    expect(Object.keys(payload)).toEqual([
      'asOfDisplay',
      'totals',
      'medians',
      'answers',
      'ruleHighlights',
    ]);

    const consent = buildConsentMessage(getProviderById('deepseek'));
    expect(consent).toContain('api.deepseek.com');
    expect(consent).toContain('不含您的 API Key');
  });

  it('verifies built-in A′ sample AI output has 0 unverified numbers and catches fabricated numbers', () => {
    const parsed = parseInputBlocks(ZHIHU_SAMPLE_TEXT);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: SAMPLE_AS_OF_UTC_MS,
      settings: DEFAULT_SETTINGS,
    });
    const diag = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);
    const payload = buildSanitizedAiPayload(metrics, diag);

    // Pre-generated A′ sample AI diagnosis must have 0 unverified numbers
    const sampleCheck = verifyAiOutputNumbers(SAMPLE_AI_DIAGNOSIS, payload);
    expect(sampleCheck.hasUnverified).toBe(false);
    expect(sampleCheck.unverifiedTokens).toEqual([]);

    // Fabricated numbers (e.g., 88.88% and 99999) must be flagged
    const hallucinated = {
      overallInsight: '整体互动率高达 88.88%，建议在 2026 年补齐 99999 字说明。',
      commentReinterpretation: ['实际阅读达到 54400，但被误写成 77777。'],
      rewriteSuggestions: [],
    };
    const check = verifyAiOutputNumbers(hallucinated, payload);
    expect(check.hasUnverified).toBe(true);
    expect(check.unverifiedTokens).toContain('88.88%');
    expect(check.unverifiedTokens).toContain('99999');
    expect(check.unverifiedTokens).toContain('77777');
    expect(check.unverifiedTokens).not.toContain('54400');
    expect(check.unverifiedTokens).not.toContain('2026');

    const segments = splitTextWithUnverifiedMarks(hallucinated.overallInsight, check.unverifiedTokens);
    expect(segments.some((s) => s.unverified && s.text === '88.88%')).toBe(true);
  });

  it('classifies all 6 AI error categories accurately', async () => {
    expect(classifyHttpError(401).code).toBe('AUTH_INVALID');
    expect(classifyHttpError(403).code).toBe('AUTH_INVALID');
    expect(classifyHttpError(429).code).toBe('QUOTA_EXCEEDED');
    expect(classifyHttpError(400, '{"error":{"code":"insufficient_quota"}}').code).toBe('QUOTA_EXCEEDED');
    expect(classifyHttpError(404).code).toBe('MODEL_NOT_FOUND');

    const parsed = parseInputBlocks(ZHIHU_SAMPLE_TEXT);
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: SAMPLE_AS_OF_UTC_MS,
      settings: DEFAULT_SETTINGS,
    });
    const diag = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);

    // Network/CORS error
    await expect(
      requestLiveAiDiagnosis({
        providerId: 'deepseek',
        apiKey: 'mock-key-123',
        metrics,
        diagnosis: diag,
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
    ).rejects.toMatchObject({ code: 'CORS_OR_NETWORK' });

    // Timeout error
    await expect(
      requestLiveAiDiagnosis({
        providerId: 'deepseek',
        apiKey: 'mock-key-123',
        metrics,
        diagnosis: diag,
        timeoutMs: 20,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    // Parse error on malformed model output
    await expect(
      requestLiveAiDiagnosis({
        providerId: 'deepseek',
        apiKey: 'mock-key-123',
        metrics,
        diagnosis: diag,
        fetchImpl: async () =>
          /** @type {any} */ ({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'not valid json' } }] }),
          }),
      }),
    ).rejects.toMatchObject({ code: 'PARSE_ERROR' });

    // Successful structured response with verification
    const liveRes = await requestLiveAiDiagnosis({
      providerId: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'mock-key-123',
      metrics,
      diagnosis: diag,
      fetchImpl: async () =>
        /** @type {any} */ ({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    overallInsight: '总阅读 54400，加权互动率 4.00%，需优先编辑高阅读篇。',
                    commentReinterpretation: ['质疑评论集中于数据来源。'],
                    rewriteSuggestions: [
                      {
                        targetTitle: '2026 年普通人还有必要花精力考软考高项吗？',
                        diagnosis: '阅读 32000 但互动率 2.00%。',
                        concreteEdit: '在首屏前 3 行补充适用人群边界。',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        }),
    });
    expect(liveRes.mode).toBe('live_byok');
    expect(liveRes.verification.hasUnverified).toBe(false);
    expect(new AiClientError('AUTH_INVALID').message).toContain('API Key');
  });
});
