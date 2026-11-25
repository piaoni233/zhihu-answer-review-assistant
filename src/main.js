// @ts-check

import './ui/styles.css';
import { ENGINE_VERSION } from './types.js';
import { localDateToWallUtcMs } from './core/date.js';
import { computeBatchMetrics } from './core/calculator.js';
import { diagnoseBatch } from './core/diagnoser.js';
import { buildReportModel } from './core/report.js';
import { SAMPLE_AI_DIAGNOSIS } from './core/zhihu-sample.js';
import { createStorageAdapter } from './storage/idb.js';
import { createReviewStore, generateReviewId } from './storage/review-store.js';
import {
  clearProviderApiKey,
  loadProviderApiKey,
  loadSettings,
  saveProviderApiKey,
  saveProviderConnectivityResult,
  saveSettings,
  syncApiKeyPersistence,
} from './storage/settings-store.js';
import {
  createBackupPayload,
  downloadTextFile,
  importBackupIntoStore,
  makeBackupFilename,
} from './storage/backup.js';
import { getProviderById } from './ai/providers.js';
import {
  generateSampleAiWithFallback,
  requestLiveAiDiagnosis,
  testProviderConnectivity,
} from './ai/client.js';
import { renderAppShell } from './ui/app-shell.js';
import { renderWorkspaceView } from './ui/workspace-view.js';
import { renderReportView } from './ui/report-view.js';
import { renderHistoryView } from './ui/history-view.js';
import { renderSettingsView } from './ui/settings-view.js';
import { showManualCopyModal, showToast } from './ui/dom.js';

/**
 * 应用入口：存储探测、单向状态流、Hash 路由与 4 视图协调。
 */

/** @typedef {import('./ui/app-shell.js').ViewName} ViewName */

/**
 * 初始化并挂载整个单页应用（导出供集成测试复用）。
 * @param {HTMLElement} root
 * @param {{storageOptions?: {forceMemory?:boolean, indexedDBImpl?:IDBFactory, dbName?:string}, fetchImpl?: typeof fetch}} [deps]
 */
export async function bootstrapApp(root, deps = {}) {
  const adapter = await createStorageAdapter(deps.storageOptions);
  const reviewStore = createReviewStore(adapter);

  /**
   * @type {{
   *   activeView: ViewName,
   *   rawText: string,
   *   asOfUtcMs: number,
   *   isSample: boolean,
   *   settings: import('./types.js').Settings,
   *   currentReview: import('./types.js').ReviewRecord|null,
   *   currentMetrics: import('./types.js').BatchMetrics|null,
   *   currentDiagnosis: import('./types.js').DiagnosisResult|null,
   *   reviews: import('./types.js').ReviewRecord[],
   *   trackedAnswers: import('./types.js').AnswerIndexRecord[],
   *   baseline: import('./types.js').HistoryBaseline
   * }}
   */
  const state = {
    activeView: 'workspace',
    rawText: '',
    asOfUtcMs: localDateToWallUtcMs(new Date()),
    isSample: false,
    settings: loadSettings(),
    currentReview: null,
    currentMetrics: null,
    currentDiagnosis: null,
    reviews: [],
    trackedAnswers: [],
    baseline: {
      sampleCount: 0,
      medianEngagementRate: null,
      medianUpvoteRate: null,
      medianCollectRate: null,
      medianCommentRate: null,
      byCategory: {},
    },
  };

  async function refreshStorageCache() {
    state.reviews = await reviewStore.listReviews();
    state.trackedAnswers = await reviewStore.listTrackedAnswers();
    state.baseline = await reviewStore.getHistoryBaseline();
  }

  /** @param {ViewName} view */
  function navigate(view) {
    state.activeView = view;
    if (typeof window !== 'undefined' && window.location) {
      const targetHash = `#/${view}`;
      if (window.location.hash !== targetHash) {
        window.history.replaceState(null, '', targetHash);
      }
    }
    render();
  }

  /**
   * 轻量连通性测试并按服务商持久化最新测试时间与结果（R4）。
   * @param {string} providerId
   * @param {string} [overrideKey]
   * @param {string} [overrideModel]
   * @returns {Promise<import('./types.js').ProviderConnectivityResult>}
   */
  async function handleTestConnectivity(providerId, overrideKey = '', overrideModel = '') {
    const provider = getProviderById(providerId, state.settings.customProviders);
    const apiKey = (overrideKey || '').trim() || loadProviderApiKey(provider.id);
    const model =
      (overrideModel || '').trim() ||
      (provider.id === state.settings.aiProviderId ? state.settings.aiModel : provider.defaultModel) ||
      provider.defaultModel;

    const result = await testProviderConnectivity({
      provider,
      model,
      apiKey,
      fetchImpl: deps.fetchImpl,
    });
    state.settings = saveProviderConnectivityResult(provider.id, result);
    render();
    return result;
  }

  /**
   * 核心链路：计算 -> 跨期增量 -> 诊断 -> ReportModel -> 本地持久化 -> 跳转报告页
   * 确定性报告永远不被 AI 阻塞。
   * @param {import('./types.js').ParseResult} parsed
   */
  async function handleGenerateReport(parsed) {
    const metrics = computeBatchMetrics(parsed.items, {
      asOfUtcMs: state.asOfUtcMs,
      settings: state.settings,
    });
    const baseline = await reviewStore.getHistoryBaseline();
    const deltas = state.isSample
      ? []
      : await reviewStore.findCrossPeriodDeltas(parsed.items, state.asOfUtcMs);

    const diagnosis = diagnoseBatch(metrics, baseline, state.settings);
    const reviewId = generateReviewId();
    const nowMs = localDateToWallUtcMs(new Date());
    const initialAi = state.isSample ? { ...SAMPLE_AI_DIAGNOSIS, fallbackNotice: null } : null;

    const reportModel = buildReportModel(metrics, diagnosis, {
      reviewId,
      createdAtUtcMs: nowMs,
      engineVersion: ENGINE_VERSION,
      isSample: state.isSample,
      settings: state.settings,
      deltas,
      aiDiagnosis: initialAi,
    });

    /** @type {import('./types.js').ReviewRecord} */
    const record = {
      id: reviewId,
      createdAtUtcMs: nowMs,
      asOfUtcMs: state.asOfUtcMs,
      engineVersion: ENGINE_VERSION,
      settingsSnapshot: { ...state.settings },
      isSample: state.isSample,
      rawInputText: state.rawText,
      answers: parsed.items,
      reportModel,
      aiDiagnosis: initialAi,
    };

    try {
      await reviewStore.saveReview(record);
    } catch (err) {
      if (err instanceof Error && err.name === 'QuotaExceededError') {
        showToast(err.message, 'error', 5000);
      } else {
        showToast('保存到本地历史失败，本次报告仍可正常阅读与导出', 'warning', 4500);
      }
    }

    state.currentReview = record;
    state.currentMetrics = metrics;
    state.currentDiagnosis = diagnosis;
    await refreshStorageCache();
    navigate('report');
    showToast('复盘报告已生成并保存至本地历史', 'success');
  }

  function render() {
    const viewContainer = renderAppShell({
      root,
      activeView: state.activeView,
      isDegraded: reviewStore.isDegraded,
      degradedReason: reviewStore.degradedReason,
      reviewCount: state.reviews.length,
      onNavigate: (view) => navigate(view),
    });

    if (state.activeView === 'workspace') {
      viewContainer.appendChild(
        renderWorkspaceView({
          rawText: state.rawText,
          asOfUtcMs: state.asOfUtcMs,
          isSample: state.isSample,
          settings: state.settings,
          onChangeText: (text, isSample) => {
            state.rawText = text;
            state.isSample = isSample;
          },
          onChangeAsOf: (utcMs) => {
            state.asOfUtcMs = utcMs;
          },
          onGenerate: async (parsed) => {
            await handleGenerateReport(parsed);
          },
        }),
      );
      return;
    }

    if (state.activeView === 'report') {
      const activeProvider = getProviderById(state.settings.aiProviderId, state.settings.customProviders);
      const apiKey = loadProviderApiKey(activeProvider.id);
      const canRunLiveAi = Boolean(state.currentReview && state.currentMetrics && state.currentDiagnosis);

      viewContainer.appendChild(
        renderReportView({
          report: state.currentReview ? state.currentReview.reportModel : null,
          settings: state.settings,
          activeProvider,
          hasApiKey: Boolean(apiKey),
          canRunLiveAi,
          onGoWorkspace: () => navigate('workspace'),
          onGoSettings: () => navigate('settings'),
          onTestConnectivity: async () => handleTestConnectivity(activeProvider.id),
          onRunLiveAi: async (signal, tempKey) => {
            if (!state.currentReview || !state.currentMetrics || !state.currentDiagnosis) return;
            const effectiveKey = tempKey || loadProviderApiKey(activeProvider.id);
            const aiResult = await requestLiveAiDiagnosis({
              provider: activeProvider,
              model: state.settings.aiModel,
              apiKey: effectiveKey,
              metrics: state.currentMetrics,
              diagnosis: state.currentDiagnosis,
              fetchImpl: deps.fetchImpl,
              signal,
            });
            state.currentReview.aiDiagnosis = aiResult;
            state.currentReview.reportModel = {
              ...state.currentReview.reportModel,
              aiSection: aiResult,
            };
            await reviewStore.attachAiDiagnosis(state.currentReview.id, aiResult);
            await refreshStorageCache();
            render();
          },
          onRegenerateSampleAi: async (signal, tempKey) => {
            if (!state.currentReview || !state.currentMetrics || !state.currentDiagnosis) {
              return {
                result: SAMPLE_AI_DIAGNOSIS,
                usedFallback: true,
                fallbackReasonCode: 'NO_API_KEY',
                fallbackReasonText: '未配置 Key',
                fallbackNotice: '未检测到当前示例报告上下文，继续展示预先生成的示例 AI 诊断。',
              };
            }
            const effectiveKey = tempKey || loadProviderApiKey(activeProvider.id);
            const outcome = await generateSampleAiWithFallback({
              provider: activeProvider,
              model: state.settings.aiModel,
              apiKey: effectiveKey,
              metrics: state.currentMetrics,
              diagnosis: state.currentDiagnosis,
              fallbackDiagnosis: SAMPLE_AI_DIAGNOSIS,
              fetchImpl: deps.fetchImpl,
              signal,
            });
            state.currentReview.aiDiagnosis = outcome.result;
            state.currentReview.reportModel = {
              ...state.currentReview.reportModel,
              aiSection: outcome.result,
            };
            await reviewStore.attachAiDiagnosis(state.currentReview.id, outcome.result);
            await refreshStorageCache();
            render();
            return outcome;
          },
        }),
      );
      return;
    }

    if (state.activeView === 'history') {
      viewContainer.appendChild(
        renderHistoryView({
          reviews: state.reviews,
          trackedAnswers: state.trackedAnswers,
          baseline: state.baseline,
          onOpenReview: (rev) => {
            state.currentReview = rev;
            state.currentMetrics = computeBatchMetrics(rev.answers, {
              asOfUtcMs: rev.asOfUtcMs,
              settings: rev.settingsSnapshot,
            });
            state.currentDiagnosis = diagnoseBatch(state.currentMetrics, null, rev.settingsSnapshot);
            navigate('report');
          },
          onDeleteReview: async (id) => {
            await reviewStore.deleteReview(id);
            if (state.currentReview?.id === id) {
              state.currentReview = null;
              state.currentMetrics = null;
              state.currentDiagnosis = null;
            }
            await refreshStorageCache();
            render();
          },
          onGoWorkspace: () => navigate('workspace'),
        }),
      );
      return;
    }

    if (state.activeView === 'settings') {
      viewContainer.appendChild(
        renderSettingsView({
          settings: state.settings,
          getProviderApiKey: (providerId) => loadProviderApiKey(providerId),
          onSaveSettings: (partial) => {
            state.settings = saveSettings(partial);
            render();
          },
          onSaveProviderApiKey: (providerId, key, remember) => {
            saveProviderApiKey(providerId, key, remember);
            render();
          },
          onClearProviderApiKey: (providerId) => {
            clearProviderApiKey(providerId);
            render();
          },
          onSyncKeyPersistence: (remember) => {
            syncApiKeyPersistence(remember);
            render();
          },
          onAddCustomProvider: (provider, apiKey, remember) => {
            const nextCustom = [...(state.settings.customProviders || []), provider];
            state.settings = saveSettings({
              customProviders: nextCustom,
              aiProviderId: provider.id,
              aiModel: provider.defaultModel,
              rememberApiKey: remember,
            });
            if (apiKey) {
              saveProviderApiKey(provider.id, apiKey, remember);
            }
            syncApiKeyPersistence(remember);
            render();
          },
          onDeleteCustomProvider: (providerId) => {
            const nextCustom = (state.settings.customProviders || []).filter((p) => p.id !== providerId);
            const nextConn = { ...(state.settings.connectivityResults || {}) };
            delete nextConn[providerId];
            clearProviderApiKey(providerId);
            /** @type {Partial<import('./types.js').Settings>} */
            const patch = {
              customProviders: nextCustom,
              connectivityResults: nextConn,
            };
            if (state.settings.aiProviderId === providerId) {
              patch.aiProviderId = 'deepseek';
              patch.aiModel = 'deepseek-chat';
            }
            state.settings = saveSettings(patch);
            render();
          },
          onTestConnectivity: async (providerId, overrideKey, overrideModel) =>
            handleTestConnectivity(providerId, overrideKey, overrideModel),
          onExportBackup: async () => {
            const reviews = await reviewStore.listReviews();
            const payload = createBackupPayload(reviews, state.settings);
            const filename = makeBackupFilename();
            const jsonText = JSON.stringify(payload, null, 2);
            const ok = downloadTextFile(filename, jsonText, 'application/json;charset=utf-8', false);
            if (ok) {
              showToast(`已导出 JSON 备份：${filename}`, 'success');
            } else {
              showManualCopyModal('导出 JSON 备份（手动复制兜底）', jsonText);
            }
          },
          onImportBackup: async (jsonText) => {
            const res = await importBackupIntoStore(reviewStore, jsonText);
            if (res.settings) {
              state.settings = saveSettings(res.settings);
            }
            await refreshStorageCache();
            render();
            showToast(
              `导入完成：已导入 ${res.importedCount} 条新复盘，跳过 ${res.skippedCount} 条重复记录`,
              'success',
              4000,
            );
          },
          onClearAllData: async () => {
            await reviewStore.clearAll();
            state.currentReview = null;
            state.currentMetrics = null;
            state.currentDiagnosis = null;
            await refreshStorageCache();
            render();
          },
        }),
      );
    }
  }

  // 解析初始 Hash 路由
  if (typeof window !== 'undefined' && window.location?.hash) {
    const h = window.location.hash.replace(/^#\/?/, '');
    if (h === 'workspace' || h === 'report' || h === 'history' || h === 'settings') {
      state.activeView = h;
    }
  }

  await refreshStorageCache();
  render();

  return { state, reviewStore, navigate, render };
}

if (typeof document !== 'undefined') {
  const mountEl = document.getElementById('app');
  if (mountEl) {
    bootstrapApp(mountEl);
  }
}
