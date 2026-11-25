// @ts-check

/**
 * IndexedDB 薄封装与 MemoryStore 降级适配器（详细设计 §5.1、§5.2）
 * 零第三方依赖，支持启动探测与无痕/内置浏览器无缝降级。
 */

export const DB_NAME = 'zhihu_review_db';
export const SCHEMA_VERSION = 1;
export const STORE_REVIEWS = 'reviews';
export const STORE_ANSWER_INDEX = 'answerIndex';

export const DEGRADED_BANNER_MESSAGE =
  '当前浏览器环境禁止本地数据库写入（如无痕模式或内置浏览器），本次复盘仅暂存于当前页面内存，刷新或关闭后将丢失。请及时点击“导出 Markdown”或“导出 JSON 备份”。';

/**
 * @typedef {Object} KeyValueStoreAdapter
 * @property {boolean} isDegraded
 * @property {string|null} degradedReason
 * @property {(storeName:string, key:string) => Promise<any>} get
 * @property {(storeName:string) => Promise<any[]>} getAll
 * @property {(storeName:string, value:any) => Promise<void>} put
 * @property {(storeName:string, key:string) => Promise<void>} delete
 * @property {(storeName:string) => Promise<void>} clear
 * @property {() => void} close
 */

/**
 * 创建内存降级存储（页面生命周期内保持同构异步接口）。
 * @param {string|null} [reason=null]
 * @returns {KeyValueStoreAdapter}
 */
export function createMemoryStore(reason = null) {
  /** @type {Record<string, Map<string, any>>} */
  const stores = {
    [STORE_REVIEWS]: new Map(),
    [STORE_ANSWER_INDEX]: new Map(),
  };

  /** @param {string} storeName */
  const keyField = (storeName) => (storeName === STORE_ANSWER_INDEX ? 'answerKey' : 'id');

  return {
    isDegraded: true,
    degradedReason: reason || DEGRADED_BANNER_MESSAGE,
    async get(storeName, key) {
      const val = stores[storeName]?.get(key);
      return val !== undefined ? structuredClone(val) : undefined;
    },
    async getAll(storeName) {
      const map = stores[storeName];
      if (!map) return [];
      return Array.from(map.values()).map((v) => structuredClone(v));
    },
    async put(storeName, value) {
      const map = stores[storeName];
      if (!map) throw new Error(`未知存储表：${storeName}`);
      const k = value[keyField(storeName)];
      map.set(k, structuredClone(value));
    },
    async delete(storeName, key) {
      stores[storeName]?.delete(key);
    },
    async clear(storeName) {
      stores[storeName]?.clear();
    },
    close() {},
  };
}

/**
 * 打开 IndexedDB 并在 onupgradeneeded 中幂等创建 Object Stores 与索引。
 * @param {IDBFactory} idbFactory
 * @param {string} [dbName=DB_NAME]
 * @param {number} [timeoutMs=1500]
 * @returns {Promise<IDBDatabase>}
 */
function openDatabaseWithTimeout(idbFactory, dbName = DB_NAME, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('IndexedDB 打开超时'));
      }
    }, timeoutMs);

    /** @type {IDBOpenDBRequest} */
    let req;
    try {
      req = idbFactory.open(dbName, SCHEMA_VERSION);
    } catch (err) {
      clearTimeout(timer);
      settled = true;
      reject(err);
      return;
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_REVIEWS)) {
        const reviewStore = db.createObjectStore(STORE_REVIEWS, { keyPath: 'id' });
        reviewStore.createIndex('byCreatedAt', 'createdAtUtcMs', { unique: false });
        reviewStore.createIndex('byAsOf', 'asOfUtcMs', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ANSWER_INDEX)) {
        const indexStore = db.createObjectStore(STORE_ANSWER_INDEX, { keyPath: 'answerKey' });
        indexStore.createIndex('byTitle', 'normTitle', { unique: false });
        indexStore.createIndex('byUpdatedAt', 'lastUpdatedUtcMs', { unique: false });
      }
    };

    req.onsuccess = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(req.result);
      }
    };

    req.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(req.error || new Error('IndexedDB 打开失败'));
      }
    };

    req.onblocked = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('IndexedDB 被其他标签页阻塞'));
      }
    };
  });
}

/**
 * 探测浏览器 IndexedDB 是否可正常读写。
 * @param {{indexedDBImpl?: IDBFactory, dbName?: string, timeoutMs?: number}} [options]
 * @returns {Promise<{ok:boolean, db:IDBDatabase|null, reason:string|null}>}
 */
export async function probeIndexedDB(options = {}) {
  const idbFactory = options.indexedDBImpl ?? (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined);
  if (!idbFactory) {
    return { ok: false, db: null, reason: DEGRADED_BANNER_MESSAGE };
  }
  try {
    const db = await openDatabaseWithTimeout(idbFactory, options.dbName ?? DB_NAME, options.timeoutMs ?? 1500);
    return { ok: true, db, reason: null };
  } catch {
    return { ok: false, db: null, reason: DEGRADED_BANNER_MESSAGE };
  }
}

/**
 * @param {IDBRequest} req
 * @returns {Promise<any>}
 */
function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      const err = req.error;
      if (err && err.name === 'QuotaExceededError') {
        const quotaErr = new Error('本地浏览器存储空间已满，请导出 JSON 备份并清理早期记录。');
        quotaErr.name = 'QuotaExceededError';
        reject(quotaErr);
        return;
      }
      reject(err || new Error('本地数据库操作失败'));
    };
  });
}

/**
 * 创建统一存储适配器；若 IndexedDB 不可用则自动降级为 MemoryStore。
 * @param {{forceMemory?: boolean, indexedDBImpl?: IDBFactory, dbName?: string, timeoutMs?: number}} [options]
 * @returns {Promise<KeyValueStoreAdapter>}
 */
export async function createStorageAdapter(options = {}) {
  if (options.forceMemory) {
    return createMemoryStore(DEGRADED_BANNER_MESSAGE);
  }
  const probe = await probeIndexedDB(options);
  if (!probe.ok || !probe.db) {
    return createMemoryStore(probe.reason);
  }

  const db = probe.db;

  return {
    isDegraded: false,
    degradedReason: null,
    async get(storeName, key) {
      const tx = db.transaction(storeName, 'readonly');
      return promisifyRequest(tx.objectStore(storeName).get(key));
    },
    async getAll(storeName) {
      const tx = db.transaction(storeName, 'readonly');
      return promisifyRequest(tx.objectStore(storeName).getAll());
    },
    async put(storeName, value) {
      const tx = db.transaction(storeName, 'readwrite');
      await promisifyRequest(tx.objectStore(storeName).put(value));
    },
    async delete(storeName, key) {
      const tx = db.transaction(storeName, 'readwrite');
      await promisifyRequest(tx.objectStore(storeName).delete(key));
    },
    async clear(storeName) {
      const tx = db.transaction(storeName, 'readwrite');
      await promisifyRequest(tx.objectStore(storeName).clear());
    },
    close() {
      db.close();
    },
  };
}
