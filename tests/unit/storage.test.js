import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createStorageAdapter } from '../../src/storage/idb.js';
import { createReviewStore } from '../../src/storage/review-store.js';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  loadApiKey,
  saveApiKey,
  clearApiKey,
  maskApiKey,
} from '../../src/storage/settings-store.js';
import {
  createBackupPayload,
  validateBackupPayload,
  importBackupIntoStore,
} from '../../src/storage/backup.js';
import { parseInputBlocks } from '../../src/core/parser.js';
import { computeBatchMetrics } from '../../src/core/calculator.js';
import { diagnoseBatch } from '../../src/core/diagnoser.js';
import { buildReportModel } from '../../src/core/report.js';
import { parseWallDate } from '../../src/core/date.js';
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

function buildTestReview({ id, text, asOfStr, isSample = false }) {
  const asOfUtcMs = parseWallDate(asOfStr).utcMs;
  const parsed = parseInputBlocks(text);
  const metrics = computeBatchMetrics(parsed.items, { asOfUtcMs, settings: DEFAULT_SETTINGS });
  const diag = diagnoseBatch(metrics, null, DEFAULT_SETTINGS);
  const reportModel = buildReportModel(metrics, diag, {
    reviewId: id,
    createdAtUtcMs: asOfUtcMs,
    engineVersion: ENGINE_VERSION,
    isSample,
    settings: DEFAULT_SETTINGS,
  });
  return {
    id,
    createdAtUtcMs: asOfUtcMs,
    asOfUtcMs,
    engineVersion: ENGINE_VERSION,
    settingsSnapshot: DEFAULT_SETTINGS,
    isSample,
    rawInputText: text,
    answers: parsed.items,
    reportModel,
    aiDiagnosis: null,
  };
}

describe('storage/* (IndexedDB, MemoryStore fallback, review-store, settings, backup)', () => {
  it('supports IndexedDB CRUD, cross-period deltas, PII stripping, and keeps isSample out of answerIndex', async () => {
    const fakeIdb = new IDBFactory();
    const adapter = await createStorageAdapter({ indexedDBImpl: fakeIdb, dbName: 'test_zhihu_db_1' });
    expect(adapter.isDegraded).toBe(false);
    const store = createReviewStore(adapter);

    // 1. Sample review must NOT pollute answerIndex
    const sampleRev = buildTestReview({
      id: 'rev_sample_1',
      isSample: true,
      asOfStr: '2026-11-20 12:00',
      text: `标题：示例回答不应进索引
发布时间：2026-11-10 10:00
阅读：1000
赞同：50
收藏：50
评论：10`,
    });
    await store.saveReview(sampleRev);
    expect(await store.listReviews()).toHaveLength(1);
    expect(await store.listTrackedAnswers()).toHaveLength(0);

    // 2. First real review with sensitive phone in comment (must be masked on persistence)
    const rev1 = buildTestReview({
      id: 'rev_real_1',
      isSample: false,
      asOfStr: '2026-11-20 12:00',
      text: `标题：如何高效写技术文档？
发布时间：2026-11-15 10:00
阅读：2000
赞同：60
收藏：80
评论：10
代表性评论：
- 联系 13812345678 讨论`,
    });
    await store.saveReview(rev1);

    const fetched = await store.getReview('rev_real_1');
    expect(fetched.answers[0].commentsText[0]).toContain('138****5678');
    expect(fetched.answers[0].commentsText[0]).not.toContain('13812345678');

    // 3. Second real review on same answer at later asOf computes cross-period delta
    const rev2Text = `标题：如何高效写技术文档
发布时间：2026-11-15 10:00
阅读：3000
赞同：100
收藏：130
评论：20`;
    const parsed2 = parseInputBlocks(rev2Text);
    const asOf2 = parseWallDate('2026-11-25 18:00').utcMs;
    const deltas = await store.findCrossPeriodDeltas(parsed2.items, asOf2);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].viewsDelta).toBe(1000);
    expect(deltas[0].upvotesDelta).toBe(40);
    expect(deltas[0].collectsDelta).toBe(50);
    expect(deltas[0].commentsDelta).toBe(10);
    expect(deltas[0].incrementalEngagementRate).toBeCloseTo(10.0, 5);

    const rev2 = buildTestReview({
      id: 'rev_real_2',
      isSample: false,
      asOfStr: '2026-11-25 18:00',
      text: rev2Text,
    });
    await store.saveReview(rev2);
    const tracked = await store.listTrackedAnswers();
    expect(tracked).toHaveLength(1);
    expect(tracked[0].timeline).toHaveLength(2);

    // 4. Delete review rebuilds index cleanly
    await store.deleteReview('rev_real_2');
    const trackedAfterDelete = await store.listTrackedAnswers();
    expect(trackedAfterDelete[0].timeline).toHaveLength(1);

    adapter.close();
  });

  it('falls back seamlessly to MemoryStore when IndexedDB is unavailable', async () => {
    const failingIdb = /** @type {any} */ ({
      open() {
        throw new Error('SecurityError: IndexedDB disabled');
      },
    });
    const adapter = await createStorageAdapter({ indexedDBImpl: failingIdb });
    expect(adapter.isDegraded).toBe(true);
    expect(adapter.degradedReason).toContain('内存');

    const store = createReviewStore(adapter);
    const rev = buildTestReview({
      id: 'rev_mem_1',
      asOfStr: '2026-11-25 18:00',
      text: `标题：降级模式测试
发布时间：2026-11-18 10:00
阅读：500
赞同：20
收藏：10
评论：2`,
    });
    await store.saveReview(rev);
    expect(await store.listReviews()).toHaveLength(1);
  });

  it('exports JSON backup and imports with deduplication and schema validation', async () => {
    const adapter1 = await createStorageAdapter({ forceMemory: true });
    const store1 = createReviewStore(adapter1);
    const rev = buildTestReview({
      id: 'rev_bk_1',
      asOfStr: '2026-11-25 18:00',
      text: `标题：备份测试回答
发布时间：2026-11-18 10:00
阅读：800
赞同：30
收藏：40
评论：5`,
    });
    await store1.saveReview(rev);

    const payload = createBackupPayload(await store1.listReviews(), DEFAULT_SETTINGS);
    expect(validateBackupPayload(payload).ok).toBe(true);
    expect(validateBackupPayload({ appId: 'wrong' }).ok).toBe(false);

    const json = JSON.stringify(payload);
    // Import into store1 again -> should skip duplicate
    const dupResult = await importBackupIntoStore(store1, json);
    expect(dupResult.importedCount).toBe(0);
    expect(dupResult.skippedCount).toBe(1);

    // Import into fresh store2 -> should import 1 and rebuild index
    const adapter2 = await createStorageAdapter({ forceMemory: true });
    const store2 = createReviewStore(adapter2);
    const freshResult = await importBackupIntoStore(store2, json);
    expect(freshResult.importedCount).toBe(1);
    expect(freshResult.skippedCount).toBe(0);
    expect(await store2.listTrackedAnswers()).toHaveLength(1);
  });

  it('manages settings and API key storage securely (sessionStorage default, masked display)', () => {
    const local = makeMockWebStorage();
    const session = makeMockWebStorage();

    expect(loadSettings(local)).toEqual(DEFAULT_SETTINGS);
    const updated = saveSettings({ ageThresholdDays: 14, smallSampleThreshold: 500 }, local);
    expect(updated.ageThresholdDays).toBe(14);
    expect(loadSettings(local).smallSampleThreshold).toBe(500);

    // Corrupt JSON recovers safely
    local.setItem('zhihu_review_settings_v1', '{broken-json');
    expect(loadSettings(local)).toEqual(DEFAULT_SETTINGS);

    // Key defaults to sessionStorage only
    saveApiKey('demo-key-987654', false, { session, local });
    expect(session.getItem('zhihu_review_ai_key')).toBe('demo-key-987654');
    expect(local.getItem('zhihu_review_ai_key_persisted')).toBeNull();
    expect(loadApiKey({ session, local })).toBe('demo-key-987654');
    expect(maskApiKey('demo-key-987654')).toBe('dem****7654');

    // Remember = true persists to localStorage; clearApiKey wipes both
    saveApiKey('demo-key-987654', true, { session, local });
    expect(local.getItem('zhihu_review_ai_key_persisted')).toBe('demo-key-987654');
    clearApiKey({ session, local });
    expect(loadApiKey({ session, local })).toBe('');
  });
});
