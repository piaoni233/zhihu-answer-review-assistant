// @ts-check

/**
 * 纯文本安全 DOM 工具、轻提示 Toast 与模态弹窗组件（防 XSS）
 * 所有动态文本均通过 textContent 插入，绝不将用户输入拼入 innerHTML。
 */

/**
 * 转义 HTML 特殊字符（仅在需要纯文本序列化时使用）。
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 安全创建 DOM 元素。
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {Array<Node|string|number|null|undefined|false>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null || val === false) continue;
      if (key === 'className') {
        node.className = String(val);
      } else if (key === 'dataset' && typeof val === 'object') {
        for (const [dk, dv] of Object.entries(val)) {
          node.dataset[dk] = String(dv);
        }
      } else if (key.startsWith('on') && typeof val === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key in node && key !== 'list' && key !== 'type' && key !== 'for') {
        /** @type {any} */ (node)[key] = val;
      } else {
        node.setAttribute(key, val === true ? '' : String(val));
      }
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
  return node;
}

/**
 * 清空并挂载子节点。
 * @param {HTMLElement} container
 * @param {...(Node|string|null|undefined)} nodes
 */
export function mount(container, ...nodes) {
  container.replaceChildren();
  for (const n of nodes) {
    if (n === null || n === undefined) continue;
    container.appendChild(typeof n === 'string' ? document.createTextNode(n) : n);
  }
}

/** @type {HTMLElement|null} */
let toastContainer = null;

/**
 * 显示轻提示。
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} [type='info']
 * @param {number} [durationMs=3200]
 */
export function showToast(message, type = 'info', durationMs = 3200) {
  if (typeof document === 'undefined') return;
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = el('div', { className: 'toast-container', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastContainer);
  }
  const item = el('div', { className: `toast toast-${type}` }, [message]);
  toastContainer.appendChild(item);
  setTimeout(() => {
    item.remove();
  }, durationMs);
}

/**
 * 打开通用模态弹窗。
 * @param {{title:string, body:Node|string, confirmText?:string, cancelText?:string, danger?:boolean, hideCancel?:boolean, onConfirm?:() => void|Promise<void>, onCancel?:() => void}} options
 * @returns {() => void} 关闭函数
 */
export function showModal(options) {
  const backdrop = el('div', { className: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true' });

  const close = () => {
    backdrop.remove();
  };

  const confirmBtn = el(
    'button',
    {
      type: 'button',
      className: `btn ${options.danger ? 'btn-danger' : 'btn-primary'}`,
      onClick: async () => {
        if (options.onConfirm) {
          await options.onConfirm();
        }
        close();
      },
    },
    [options.confirmText || '确认'],
  );

  const footerChildren = [];
  if (!options.hideCancel) {
    footerChildren.push(
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-secondary',
          onClick: () => {
            if (options.onCancel) options.onCancel();
            close();
          },
        },
        [options.cancelText || '取消'],
      ),
    );
  }
  footerChildren.push(confirmBtn);

  const dialog = el('div', { className: 'modal-card' }, [
    el('div', { className: 'modal-header' }, [
      el('h3', { className: 'modal-title' }, [options.title]),
      el(
        'button',
        {
          type: 'button',
          className: 'modal-close',
          'aria-label': '关闭弹窗',
          onClick: () => {
            if (options.onCancel) options.onCancel();
            close();
          },
        },
        ['×'],
      ),
    ]),
    el('div', { className: 'modal-body' }, [
      typeof options.body === 'string' ? el('p', {}, [options.body]) : options.body,
    ]),
    el('div', { className: 'modal-footer' }, footerChildren),
  ]);

  backdrop.appendChild(dialog);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      if (options.onCancel) options.onCancel();
      close();
    }
  });
  document.body.appendChild(backdrop);
  return close;
}

/**
 * 剪贴板不可用时的手动复制兜底弹窗（详细设计 §5.6）。
 * @param {string} title
 * @param {string} text
 */
export function showManualCopyModal(title, text) {
  const ta = /** @type {HTMLTextAreaElement} */ (
    el('textarea', {
      className: 'manual-copy-textarea',
      readOnly: true,
      rows: 12,
      value: text,
    })
  );
  const body = el('div', {}, [
    el('p', { className: 'muted-text' }, [
      '当前浏览器环境不支持自动写入剪贴板，请长按或按 Ctrl+C / Cmd+C 复制下方全部文本：',
    ]),
    ta,
  ]);

  showModal({
    title,
    body,
    confirmText: '我已复制',
    hideCancel: true,
  });

  setTimeout(() => {
    ta.focus();
    ta.select();
  }, 50);
}
