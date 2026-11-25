// @ts-check

import { validateCustomProviderInput } from '../ai/providers.js';

/**
 * 设置持久化（localStorage）与 BYOK API Key 存储（默认 sessionStorage，可选 localStorage）。
 * - 支持自定义 OpenAI 兼容服务商元数据与按服务商持久化的连通性测试结果（均不含任何 API Key）。
 * - 支持按 providerId 分别存储 API Key，并保持与旧版单 Key 接口的向后兼容。
 * - 读取或写入异常（无痕/禁写/JSON 损坏）均优雅降级，永不崩溃。
 */

export const SETTINGS_STORAGE_KEY = 'zhihu_review_settings_v1';
export const SESSION_API_KEY_STORAGE = 'zhihu_review_ai_key';
export const PERSISTED_API_KEY_STORAGE = 'zhihu_review_ai_key_persisted';
export const SESSION_PROVIDER_KEYS_STORAGE = 'zhihu_review_ai_provider_keys_v1';
export const PERSISTED_PROVIDER_KEYS_STORAGE = 'zhihu_review_ai_provider_keys_persisted_v1';

/** @type {import('../types.js').Settings} */
export const DEFAULT_SETTINGS = {
  ageThresholdDays: 7,
  smallSampleThreshold: 200,
  maskMentionHandles: true,
  aiProviderId: 'deepseek',
  aiModel: 'deepseek-chat',
  rememberApiKey: false,
  customProviders: [],
  connectivityResults: {},
};

const VALID_AGE_THRESHOLDS = new Set([3, 7, 14, 30]);

/**
 * 返回默认设置的独立深拷贝，避免调用方误修改常量。
 * @returns {import('../types.js').Settings}
 */
function cloneDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    customProviders: [],
    connectivityResults: {},
  };
}

/**
 * @param {'localStorage'|'sessionStorage'} kind
 * @returns {Storage|null}
 */
function getWebStorage(kind) {
  try {
    if (typeof globalThis !== 'undefined' && globalThis[kind]) {
      return globalThis[kind];
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 清洗并校验持久化中的自定义服务商数组（过滤任何非法或非 HTTPS 项）。
 * @param {any} rawList
 * @returns {import('../types.js').CustomAiProvider[]}
 */
function sanitizeCustomProviders(rawList) {
  if (!Array.isArray(rawList)) return [];
  /** @type {import('../types.js').CustomAiProvider[]} */
  const valid = [];
  /** @type {Set<string>} */
  const seenIds = new Set();

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const checked = validateCustomProviderInput({
      id: typeof item.id === 'string' ? item.id : undefined,
      name: item.name,
      baseUrl: item.baseUrl,
      defaultModel: item.defaultModel,
    });
    if (checked.ok && !seenIds.has(checked.provider.id)) {
      seenIds.add(checked.provider.id);
      valid.push(checked.provider);
    }
  }
  return valid;
}

/**
 * 清洗并校验持久化中的各服务商连通性测试结果映射。
 * @param {any} rawMap
 * @returns {Record<string, import('../types.js').ProviderConnectivityResult>}
 */
function sanitizeConnectivityResults(rawMap) {
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};
  /** @type {Record<string, import('../types.js').ProviderConnectivityResult>} */
  const out = {};
  for (const [pid, rec] of Object.entries(rawMap)) {
    if (!pid || !rec || typeof rec !== 'object') continue;
    if (typeof rec.ok !== 'boolean' || typeof rec.testedAtUtcMs !== 'number') continue;
    const method =
      rec.method === 'models' || rec.method === 'chat_fallback' || rec.method === 'none'
        ? rec.method
        : 'none';
    out[pid] = {
      ok: rec.ok,
      method,
      latencyMs: Number.isFinite(Number(rec.latencyMs)) ? Math.max(0, Math.round(Number(rec.latencyMs))) : 0,
      testedAtUtcMs: rec.testedAtUtcMs,
      errorCode: typeof rec.errorCode === 'string' ? rec.errorCode : null,
      message: typeof rec.message === 'string' ? rec.message : '',
    };
  }
  return out;
}

/**
 * 加载用户设置（缺失或损坏时回退默认值）。
 * @param {Storage|null} [storage]
 * @returns {import('../types.js').Settings}
 */
export function loadSettings(storage = getWebStorage('localStorage')) {
  if (!storage) return cloneDefaultSettings();
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return cloneDefaultSettings();
    const parsed = JSON.parse(raw);
    const ageThresholdDays = VALID_AGE_THRESHOLDS.has(Number(parsed.ageThresholdDays))
      ? Number(parsed.ageThresholdDays)
      : DEFAULT_SETTINGS.ageThresholdDays;
    const smallSampleNum = Number(parsed.smallSampleThreshold);
    const smallSampleThreshold =
      Number.isFinite(smallSampleNum) && smallSampleNum >= 10 && smallSampleNum <= 100000
        ? Math.floor(smallSampleNum)
        : DEFAULT_SETTINGS.smallSampleThreshold;

    return {
      ageThresholdDays,
      smallSampleThreshold,
      maskMentionHandles:
        typeof parsed.maskMentionHandles === 'boolean'
          ? parsed.maskMentionHandles
          : DEFAULT_SETTINGS.maskMentionHandles,
      aiProviderId:
        typeof parsed.aiProviderId === 'string' && parsed.aiProviderId.trim()
          ? parsed.aiProviderId.trim()
          : DEFAULT_SETTINGS.aiProviderId,
      aiModel:
        typeof parsed.aiModel === 'string' && parsed.aiModel.trim()
          ? parsed.aiModel.trim()
          : DEFAULT_SETTINGS.aiModel,
      rememberApiKey: Boolean(parsed.rememberApiKey),
      customProviders: sanitizeCustomProviders(parsed.customProviders),
      connectivityResults: sanitizeConnectivityResults(parsed.connectivityResults),
    };
  } catch {
    return cloneDefaultSettings();
  }
}

/**
 * 保存用户设置。
 * @param {Partial<import('../types.js').Settings>} partial
 * @param {Storage|null} [storage]
 * @returns {import('../types.js').Settings}
 */
export function saveSettings(partial, storage = getWebStorage('localStorage')) {
  const current = loadSettings(storage);
  const next = {
    ...current,
    ...partial,
    customProviders:
      partial.customProviders !== undefined
        ? sanitizeCustomProviders(partial.customProviders)
        : current.customProviders || [],
    connectivityResults:
      partial.connectivityResults !== undefined
        ? sanitizeConnectivityResults(partial.connectivityResults)
        : current.connectivityResults || {},
  };
  if (storage) {
    try {
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 禁写环境下静默退化为内存设置
    }
  }
  return next;
}

/**
 * 持久化指定服务商的最新连通性测试结果（绝不保存任何 API Key）。
 * @param {string} providerId
 * @param {import('../types.js').ProviderConnectivityResult} result
 * @param {Storage|null} [storage]
 * @returns {import('../types.js').Settings}
 */
export function saveProviderConnectivityResult(
  providerId,
  result,
  storage = getWebStorage('localStorage'),
) {
  const current = loadSettings(storage);
  const nextMap = {
    ...(current.connectivityResults || {}),
    [providerId]: result,
  };
  return saveSettings({ connectivityResults: nextMap }, storage);
}

/**
 * 读取指定存储中的按服务商 Key 映射表。
 * @param {Storage|null} storage
 * @param {string} keyName
 * @returns {Record<string, string>}
 */
function readProviderKeyMap(storage, keyName) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(keyName);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
        out[k] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 写入指定存储中的按服务商 Key 映射表。
 * @param {Storage|null} storage
 * @param {string} keyName
 * @param {Record<string, string>} map
 */
function writeProviderKeyMap(storage, keyName, map) {
  if (!storage) return;
  try {
    if (Object.keys(map).length === 0) {
      storage.removeItem(keyName);
    } else {
      storage.setItem(keyName, JSON.stringify(map));
    }
  } catch {
    // ignore
  }
}

/**
 * 读取当前 API Key（兼容旧版单 Key 槽位：优先 sessionStorage，其次持久化 localStorage）。
 * @param {{session?: Storage|null, local?: Storage|null}} [storages]
 * @returns {string}
 */
export function loadApiKey(storages = {}) {
  const session = storages.session !== undefined ? storages.session : getWebStorage('sessionStorage');
  const local = storages.local !== undefined ? storages.local : getWebStorage('localStorage');
  try {
    const fromSession = session?.getItem(SESSION_API_KEY_STORAGE);
    if (fromSession) return fromSession;
  } catch {
    // ignore
  }
  try {
    const fromLocal = local?.getItem(PERSISTED_API_KEY_STORAGE);
    if (fromLocal) return fromLocal;
  } catch {
    // ignore
  }
  return '';
}

/**
 * 保存 API Key（兼容旧版单 Key 槽位）：默认仅写 sessionStorage；仅当 remember=true 时额外写入 localStorage。
 * @param {string} key
 * @param {boolean} remember
 * @param {{session?: Storage|null, local?: Storage|null}} [storages]
 */
export function saveApiKey(key, remember, storages = {}) {
  const trimmed = String(key || '').trim();
  const session = storages.session !== undefined ? storages.session : getWebStorage('sessionStorage');
  const local = storages.local !== undefined ? storages.local : getWebStorage('localStorage');

  if (!trimmed) {
    clearApiKey(storages);
    return;
  }

  try {
    session?.setItem(SESSION_API_KEY_STORAGE, trimmed);
  } catch {
    // ignore
  }

  try {
    if (remember) {
      local?.setItem(PERSISTED_API_KEY_STORAGE, trimmed);
    } else {
      local?.removeItem(PERSISTED_API_KEY_STORAGE);
    }
  } catch {
    // ignore
  }
}

/**
 * 清除旧版单 Key 槽位中保存的 API Key。
 * @param {{session?: Storage|null, local?: Storage|null}} [storages]
 */
export function clearApiKey(storages = {}) {
  const session = storages.session !== undefined ? storages.session : getWebStorage('sessionStorage');
  const local = storages.local !== undefined ? storages.local : getWebStorage('localStorage');
  try {
    session?.removeItem(SESSION_API_KEY_STORAGE);
  } catch {
    // ignore
  }
  try {
    local?.removeItem(PERSISTED_API_KEY_STORAGE);
  } catch {
    // ignore
  }
}

/**
 * 按服务商 ID 读取 API Key（优先 sessionStorage，其次 localStorage；若分服务商映射表均为空则兼容回退旧版单 Key）。
 * @param {string} providerId
 * @param {{session?: Storage|null, local?: Storage|null}} [storages]
 * @returns {string}
 */
export function loadProviderApiKey(providerId, storages = {}) {
  const pid = String(providerId || '').trim();
  if (!pid) return '';
  const session = storages.session !== undefined ? storages.session : getWebStorage('sessionStorage');
  const local = storages.local !== undefined ? storages.local : getWebStorage('localStorage');

  const sessionMap = readProviderKeyMap(session, SESSION_PROVIDER_KEYS_STORAGE);
  if (sessionMap[pid]) return sessionMap[pid];

  const localMap = readProviderKeyMap(local, PERSISTED_PROVIDER_KEYS_STORAGE);
  if (localMap[pid]) return localMap[pid];

  // 向后兼容：若用户此前仅通过旧版单 Key 槽位保存，仅对当前已选服务商做兼容回退
  if (Object.keys(sessionMap).length === 0 && Object.keys(localMap).length === 0) {
    const activeProviderId = loadSettings(local).aiProviderId;
    if (pid === activeProviderId) {
      return loadApiKey({ session, local });
    }
  }
  return '';
}

/**
 * 按服务商 ID 保存 API Key：默认仅写 sessionStorage；仅当 remember=true 时额外写入 localStorage。
 * @param {string} providerId
 * @param {string} key
 * @param {boolean} remember
 * @param {{session?: Storage|null, local?: Storage|null}} [storages]
 */
export function saveProviderApiKey(providerId, key, remember, storages = {}) {
  const pid = String(providerId || '').trim();
  if (!pid) return;
  const trimmed = String(key || '').trim();
  const session = storages.session !== undefined ? storages.session : getWebStorage('sessionStorage');
  const local = storages.local !== undefined ? storages.local : getWebStorage('localStorage');

  if (!trimmed) {
    clearProviderApiKey(pid, { session, local });
    return;
  }

  const sessionMap = readProviderKeyMap(session, SESSION_PROVIDER_KEYS_STORAGE);
  sessionMap[pid] = trimmed;
  writeProviderKeyMap(session, SESSION_PROVIDER_KEYS_STORAGE, sessionMap);

  const localMap = readProviderKeyMap(local, PERSISTED_PROVIDER_KEYS_STORAGE);
  if (remember) {
    localMap[pid] = trimmed;
  } else {
    delete localMap[pid];
  }
  writeProviderKeyMap(local, PERSISTED_PROVIDER_KEYS_STORAGE, localMap);
}

/**
 * 清除指定服务商保存的 API Key。
 * @param {string} providerId
 * @param {{session?: Storage|null, local?: Storage|null}} [storages]
 */
export function clearProviderApiKey(providerId, storages = {}) {
  const pid = String(providerId || '').trim();
  if (!pid) return;
  const session = storages.session !== undefined ? storages.session : getWebStorage('sessionStorage');
  const local = storages.local !== undefined ? storages.local : getWebStorage('localStorage');

  const sessionMap = readProviderKeyMap(session, SESSION_PROVIDER_KEYS_STORAGE);
  if (pid in sessionMap) {
    delete sessionMap[pid];
    writeProviderKeyMap(session, SESSION_PROVIDER_KEYS_STORAGE, sessionMap);
  }

  const localMap = readProviderKeyMap(local, PERSISTED_PROVIDER_KEYS_STORAGE);
  if (pid in localMap) {
    delete localMap[pid];
    writeProviderKeyMap(local, PERSISTED_PROVIDER_KEYS_STORAGE, localMap);
  }

  const activeProviderId = loadSettings(local).aiProviderId;
  if (pid === activeProviderId) {
    clearApiKey({ session, local });
  }
}

/**
 * 同步“记住 Key 到 localStorage”开关状态：开启时将当前会话中的各 Key 同步写入 localStorage；关闭时清除所有 localStorage 持久化 Key。
 * @param {boolean} remember
 * @param {{session?: Storage|null, local?: Storage|null}} [storages]
 */
export function syncApiKeyPersistence(remember, storages = {}) {
  const session = storages.session !== undefined ? storages.session : getWebStorage('sessionStorage');
  const local = storages.local !== undefined ? storages.local : getWebStorage('localStorage');

  if (remember) {
    const sessionMap = readProviderKeyMap(session, SESSION_PROVIDER_KEYS_STORAGE);
    const localMap = readProviderKeyMap(local, PERSISTED_PROVIDER_KEYS_STORAGE);
    const merged = { ...localMap, ...sessionMap };
    writeProviderKeyMap(local, PERSISTED_PROVIDER_KEYS_STORAGE, merged);
    const legacySession = (() => {
      try {
        return session?.getItem(SESSION_API_KEY_STORAGE) || '';
      } catch {
        return '';
      }
    })();
    if (legacySession) {
      try {
        local?.setItem(PERSISTED_API_KEY_STORAGE, legacySession);
      } catch {
        // ignore
      }
    }
  } else {
    try {
      local?.removeItem(PERSISTED_PROVIDER_KEYS_STORAGE);
      local?.removeItem(PERSISTED_API_KEY_STORAGE);
    } catch {
      // ignore
    }
  }
}

/**
 * 清除所有服务商及旧版槽位中的全部 API Key。
 * @param {{session?: Storage|null, local?: Storage|null}} [storages]
 */
export function clearAllApiKeys(storages = {}) {
  const session = storages.session !== undefined ? storages.session : getWebStorage('sessionStorage');
  const local = storages.local !== undefined ? storages.local : getWebStorage('localStorage');
  clearApiKey({ session, local });
  try {
    session?.removeItem(SESSION_PROVIDER_KEYS_STORAGE);
    local?.removeItem(PERSISTED_PROVIDER_KEYS_STORAGE);
  } catch {
    // ignore
  }
}

/**
 * 遮罩展示 API Key（界面永不回显完整 Key）。
 * @param {string} key
 * @returns {string}
 */
export function maskApiKey(key) {
  const trimmed = String(key || '').trim();
  if (!trimmed) return '未配置';
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}
