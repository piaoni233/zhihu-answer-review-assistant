// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { bootstrapApp } from '../../src/main.js';

const FORBIDDEN = ['\u5c0f\u7ea2\u4e66', '\u7b14\u8bb0', '\u5c01\u9762', '\u70b9\u8d5e'];

describe('UI core flows (JSDOM integration)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '#/workspace');
  });

  it('runs sample flow with A′ pre-generated AI, exports Markdown (copy fallback), and keeps sample out of real baseline', async () => {
    const root = document.getElementById('app');
    const fakeIdb = new IDBFactory();
    const app = await bootstrapApp(root, {
      storageOptions: { indexedDBImpl: fakeIdb, dbName: 'ui_test_db_1' },
    });

    // Click load sample
    const loadBtn = /** @type {HTMLButtonElement} */ (document.getElementById('load-sample-btn'));
    loadBtn.click();

    const genBtn = /** @type {HTMLButtonElement} */ (document.getElementById('generate-report-btn'));
    expect(genBtn.disabled).toBe(false);
    genBtn.click();

    await vi.waitFor(() => {
      expect(document.querySelector('.report-view')).not.toBeNull();
    });

    const reportText = document.body.textContent || '';
    expect(reportText).toContain('示例数据（虚构）');
    expect(reportText).toContain('AI 示例输出（预先生成，非实时）');
    expect(reportText).toContain('54400');
    expect(reportText).toContain('4.00%');
    expect(reportText).toContain('行动建议清单');
    expect(reportText).toContain('下次复盘粘贴块');

    // Copy Markdown fallback modal (jsdom has no navigator.clipboard)
    const copyBtn = /** @type {HTMLButtonElement} */ (document.getElementById('copy-md-btn'));
    copyBtn.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.manual-copy-textarea')).not.toBeNull();
    });
    const fallbackTa = /** @type {HTMLTextAreaElement} */ (document.querySelector('.manual-copy-textarea'));
    expect(fallbackTa.value).toContain('# 知乎回答表现复盘报告');
    expect(fallbackTa.value).toContain('4.00%');

    // Close modal & switch to history
    /** @type {HTMLButtonElement} */ (document.querySelector('.modal-close')).click();
    app.navigate('history');
    expect(document.body.textContent).toContain('已累计 0 / 10 篇不重复真实回答');
    expect(document.body.textContent).toContain('历史复盘记录（共 1 条）');

    // Zero forbidden words anywhere in UI
    for (const w of FORBIDDEN) {
      expect((document.body.textContent || '').includes(w)).toBe(false);
    }
  });

  it('supports two consecutive real reviews and displays cross-period deltas in report and history', async () => {
    const root = document.getElementById('app');
    const fakeIdb = new IDBFactory();
    const app = await bootstrapApp(root, {
      storageOptions: { indexedDBImpl: fakeIdb, dbName: 'ui_test_db_2' },
    });

    const batch1 = `标题：回答甲
发布时间：2026-11-10 10:00
阅读：2000
赞同：80
收藏：100
评论：10

标题：回答乙
发布时间：2026-11-12 10:00
阅读：3000
赞同：90
收藏：60
评论：15

标题：回答丙
发布时间：2026-11-14 10:00
阅读：5000
赞同：100
收藏：50
评论：20`;

    const asOfInput = /** @type {HTMLInputElement} */ (document.getElementById('as-of-input'));
    const pasteInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-input'));

    asOfInput.value = '2026-11-20T18:00';
    asOfInput.dispatchEvent(new Event('change'));
    pasteInput.value = batch1;
    pasteInput.dispatchEvent(new Event('input'));

    /** @type {HTMLButtonElement} */ (document.getElementById('generate-report-btn')).click();
    await vi.waitFor(() => {
      expect(document.querySelector('.report-view')).not.toBeNull();
    });

    // Return to workspace, advance asOf and increase views/upvotes for 回答甲
    app.navigate('workspace');
    const asOfInput2 = /** @type {HTMLInputElement} */ (document.getElementById('as-of-input'));
    const pasteInput2 = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-input'));
    asOfInput2.value = '2026-11-25T18:00';
    asOfInput2.dispatchEvent(new Event('change'));
    pasteInput2.value = batch1
      .replace('阅读：2000', '阅读：3000')
      .replace('赞同：80', '赞同：130')
      .replace('收藏：100', '收藏：140')
      .replace('评论：10', '评论：20');
    pasteInput2.dispatchEvent(new Event('input'));

    /** @type {HTMLButtonElement} */ (document.getElementById('generate-report-btn')).click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('同回答跨期增量对比');
    });
    expect(document.body.textContent).toContain('阅读 +1000');
    expect(document.body.textContent).toContain('赞同 +50');

    // History view shows tracked timeline
    app.navigate('history');
    expect(document.body.textContent).toContain('同回答跨期增量追踪');
    expect(document.body.textContent).toContain('已追踪 2 次');
  });

  it('enforces blocking errors, soft-warning confirmation modal, <3 notice, and degraded storage banner', async () => {
    const root = document.getElementById('app');
    await bootstrapApp(root, { storageOptions: { forceMemory: true } });

    // Degraded banner visible
    expect(document.querySelector('.degraded-banner')).not.toBeNull();

    const pasteInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-input'));
    const asOfInput = /** @type {HTMLInputElement} */ (document.getElementById('as-of-input'));
    asOfInput.value = '2026-11-25T18:00';
    asOfInput.dispatchEvent(new Event('change'));

    // Soft warning: upvotes > views -> opens confirmation modal
    pasteInput.value = `标题：异常高赞同测试
发布时间：2026-11-20 10:00
阅读：100
赞同：150
收藏：10
评论：5`;
    pasteInput.dispatchEvent(new Event('input'));

    const genBtn = /** @type {HTMLButtonElement} */ (document.getElementById('generate-report-btn'));
    expect(genBtn.disabled).toBe(false);
    genBtn.click();

    // Confirmation modal appears before generating
    expect(document.querySelector('.modal-backdrop')).not.toBeNull();
    expect(document.querySelector('.modal-title')?.textContent).toContain('数据异常核对确认');

    // Confirm -> generates <3 report without ranking
    /** @type {HTMLButtonElement} */ (document.querySelector('.modal-footer .btn-primary')).click();
    await vi.waitFor(() => {
      expect(document.querySelector('.report-view')).not.toBeNull();
    });
    expect(document.body.textContent).toContain('当前录入少于 3 篇回答');
  });

  it('supports R1 sample AI regeneration (no-key fallback, live success, failure fallback), R2 custom provider, R3 unverified tags, and R4 connectivity test in UI', async () => {
    const root = document.getElementById('app');
    const fakeIdb = new IDBFactory();

    let nextChatBehavior = 'success';
    const mockFetch = vi.fn(async (url) => {
      if (String(url).endsWith('/models')) {
        return /** @type {any} */ ({
          ok: true,
          json: async () => ({ data: [{ id: 'my-custom-model' }] }),
        });
      }
      if (nextChatBehavior === 'quota') {
        return /** @type {any} */ ({
          ok: false,
          status: 429,
          text: async () => 'insufficient_quota',
        });
      }
      return /** @type {any} */ ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  overallInsight: '实时自定义接口复盘：总阅读 54400，加权互动率 4.00%。',
                  commentReinterpretation: ['评论区要求给出通过率出处。'],
                  rewriteSuggestions: [
                    {
                      targetTitle: '2026 年普通人还有必要花精力考软考高项吗？',
                      diagnosis: '阅读 32000，互动率 2.00%。',
                      concreteEdit: '开头先写分场景结论。',
                    },
                  ],
                }),
              },
            },
          ],
        }),
      });
    });

    const app = await bootstrapApp(root, {
      storageOptions: { indexedDBImpl: fakeIdb, dbName: 'ui_test_db_r1_r4' },
      fetchImpl: mockFetch,
    });

    // 1. Load sample & generate report
    /** @type {HTMLButtonElement} */ (document.getElementById('load-sample-btn')).click();
    /** @type {HTMLButtonElement} */ (document.getElementById('generate-report-btn')).click();
    await vi.waitFor(() => {
      expect(document.getElementById('regenerate-sample-ai-btn')).not.toBeNull();
    });

    // 2. Click "重新生成 AI 诊断" with NO API key -> immediate fallback notice
    /** @type {HTMLButtonElement} */ (document.getElementById('regenerate-sample-ai-btn')).click();
    await vi.waitFor(() => {
      expect(document.getElementById('sample-ai-fallback-notice')).not.toBeNull();
    });
    expect(document.getElementById('sample-ai-fallback-notice')?.textContent).toContain('未配置 Key');
    expect(document.getElementById('ai-mode-badge')?.textContent).toContain('预先生成示例');

    // 3. Go to Settings: verify 4 new built-in providers are labelled "待验证"
    app.navigate('settings');
    const settingsText = document.body.textContent || '';
    expect(settingsText).toContain('智谱 AI（BigModel）');
    expect(settingsText).toContain('豆包（火山方舟）');
    expect(settingsText).toContain('硅基流动（SiliconFlow）');
    expect(settingsText).toContain('OpenRouter');
    expect(settingsText).toContain('待验证');

    // Reject non-HTTPS custom provider
    /** @type {HTMLInputElement} */ (document.getElementById('custom-provider-name')).value = '明文测试';
    /** @type {HTMLInputElement} */ (document.getElementById('custom-provider-url')).value = 'http://bad.example.com/v1';
    /** @type {HTMLInputElement} */ (document.getElementById('custom-provider-model')).value = 'bad-model';
    /** @type {HTMLButtonElement} */ (document.getElementById('add-custom-provider-btn')).click();
    expect(document.getElementById('custom-provider-error')?.textContent).toContain('https://');

    // Add valid HTTPS custom provider with key (sessionStorage by default)
    /** @type {HTMLInputElement} */ (document.getElementById('custom-provider-name')).value = '我的自建接口';
    /** @type {HTMLInputElement} */ (document.getElementById('custom-provider-url')).value = 'https://my-llm.example.com/v1';
    /** @type {HTMLInputElement} */ (document.getElementById('custom-provider-model')).value = 'my-custom-model';
    /** @type {HTMLInputElement} */ (document.getElementById('custom-provider-key')).value = 'mock-custom-key-999';
    /** @type {HTMLButtonElement} */ (document.getElementById('add-custom-provider-btn')).click();

    expect(document.body.textContent).toContain('我的自建接口');
    expect(window.localStorage.getItem('zhihu_review_ai_provider_keys_persisted_v1')).toBeNull();

    // 4. Run R4 connectivity test in Settings -> persists success + latency
    /** @type {HTMLButtonElement} */ (document.getElementById('test-active-provider-btn')).click();
    await vi.waitFor(() => {
      expect(document.getElementById('active-connectivity-box')?.textContent).toContain('已通过连通性测试');
    });
    expect(document.getElementById('active-connectivity-box')?.textContent).toContain('ms');

    // 5. Return to sample report: run R4 connectivity test in AI diagnosis panel
    app.navigate('report');
    /** @type {HTMLButtonElement} */ (document.getElementById('report-test-connectivity-btn')).click();
    await vi.waitFor(() => {
      expect(document.getElementById('report-connectivity-summary')?.textContent).toContain('成功');
    });

    // 6. Click "重新生成 AI 诊断" with custom provider -> consent modal -> live real-time result
    /** @type {HTMLButtonElement} */ (document.getElementById('regenerate-sample-ai-btn')).click();
    expect(document.querySelector('.modal-backdrop')).not.toBeNull();
    /** @type {HTMLButtonElement} */ (document.querySelector('.modal-footer .btn-primary')).click();
    await vi.waitFor(() => {
      expect(document.getElementById('ai-mode-badge')?.textContent).toContain('实时 AI 诊断 · 我的自建接口');
    });
    expect(document.body.textContent).toContain('实时自定义接口复盘');

    // 7. Trigger 429 quota failure on sample regeneration -> falls back to pre-generated sample with exact error notice
    nextChatBehavior = 'quota';
    /** @type {HTMLButtonElement} */ (document.getElementById('regenerate-sample-ai-btn')).click();
    /** @type {HTMLButtonElement} */ (document.querySelector('.modal-footer .btn-primary')).click();
    await vi.waitFor(() => {
      expect(document.getElementById('sample-ai-fallback-notice')).not.toBeNull();
    });
    expect(document.getElementById('sample-ai-fallback-notice')?.textContent).toContain('额度已耗尽');
    expect(document.getElementById('ai-mode-badge')?.textContent).toContain('预先生成示例');
    // Zero forbidden words anywhere in UI
    for (const w of FORBIDDEN) {
      expect((document.body.textContent || '').includes(w)).toBe(false);
    }
  });
});
