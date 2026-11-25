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
});
