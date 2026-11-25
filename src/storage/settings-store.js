// @ts-check

/**
 * 设置持久化（localStorage）与 BYOK API Key 存储（默认 sessionStorage，可选 localStorage）。
 * 读取或写入异常（无痕/禁写/JSON 损坏）均优雅降级，永不崩溃。
 */

export const SETTINGS_STORAGE_KEY = 'zhihu_review_settings_v1';
export const SESSION_API_KEY_STORAGE = 'zhihu_review_ai_key';
export const PERSISTED_API_KEY_STORAGE = 'zhihu_review_ai_key_persisted';

/** @type {import('../types.js').Settings} */
export const DEFAULT_SETTINGS = {
  ageThresholdDays: 7,
  smallSampleThreshold: 200,
  maskMentionHandles: true,
  aiProviderId: 'deepseek',
  aiModel: 'deepseek-chat',
  rememberApiKey: false,
};

const VALID_AGE_THRESHOLDS = new Set([3, 7, 14, 30]);

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
 * 加载用户设置（缺失或损坏时回退默认值）。
 * @param {Storage|null} [storage]
 * @returns {import('../types.js').Settings}
 */
export function loadSettings(storage = getWebStorage('localStorage')) {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
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
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 保存用户设置。
 * @param {Partial<import('../types.js').Settings>} partial
 * @param {Storage|null} [storage]
 * @returns {import('../types.js').Settings}
 */
export function saveSettings(partial, storage = getWebStorage('localStorage')) {
  const next = { ...loadSettings(storage), ...partial };
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
 * 读取当前 API Key（优先 sessionStorage，其次持久化 localStorage）。
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
 * 保存 API Key：默认仅写 sessionStorage；仅当 remember=true 时额外写入 localStorage。
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
 * 清除所有位置保存的 API Key。
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
