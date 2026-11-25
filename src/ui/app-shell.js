// @ts-check

import { el, mount } from './dom.js';

/**
 * 应用顶栏导航、存储降级警示横幅与 4 视图外壳（详细设计 §6.1、§6.3）
 */

/** @typedef {'workspace'|'report'|'history'|'settings'} ViewName */

/** @type {Array<{id:ViewName, label:string, shortLabel:string}>} */
const NAV_ITEMS = [
  { id: 'workspace', label: '复盘工作台', shortLabel: '工作台' },
  { id: 'report', label: '复盘报告', shortLabel: '报告' },
  { id: 'history', label: '历史与对比', shortLabel: '历史' },
  { id: 'settings', label: '设置与备份', shortLabel: '设置' },
];

/**
 * 渲染应用整体外壳并返回内容挂载容器。
 * @param {{root:HTMLElement, activeView:ViewName, isDegraded:boolean, degradedReason:string|null, reviewCount:number, onNavigate:(view:ViewName) => void}} options
 * @returns {HTMLElement}
 */
export function renderAppShell(options) {
  const navButtons = NAV_ITEMS.map((item) => {
    const isActive = options.activeView === item.id;
    const badge =
      item.id === 'history' && options.reviewCount > 0
        ? el('span', { className: 'nav-count' }, [String(options.reviewCount)])
        : null;

    return el(
      'button',
      {
        type: 'button',
        className: `nav-tab ${isActive ? 'is-active' : ''}`,
        dataset: { view: item.id },
        'aria-current': isActive ? 'page' : undefined,
        onClick: () => options.onNavigate(item.id),
      },
      [
        el('span', { className: 'nav-label-full' }, [item.label]),
        el('span', { className: 'nav-label-short' }, [item.shortLabel]),
        badge,
      ],
    );
  });

  const header = el('header', { className: 'app-header' }, [
    el('div', { className: 'app-header-inner' }, [
      el('div', { className: 'brand' }, [
        el('span', { className: 'brand-mark', 'aria-hidden': 'true' }, ['知']),
        el('div', { className: 'brand-text' }, [
          el('h1', { className: 'brand-title' }, ['知乎回答数据复盘助手']),
          el('span', { className: 'brand-sub' }, ['本地确定性计算 · 相对诊断 · 数据不出浏览器']),
        ]),
      ]),
      el('nav', { className: 'app-nav', 'aria-label': '主导航' }, navButtons),
    ]),
  ]);

  const degradedBanner = options.isDegraded
    ? el('div', { className: 'degraded-banner', role: 'alert' }, [
        el('strong', {}, ['存储降级提示：']),
        el('span', {}, [options.degradedReason || '当前环境无法写入本地数据库，复盘仅暂存于内存，请及时导出备份。']),
      ])
    : null;

  const main = el('main', { className: 'app-main', id: 'view-container' });

  const footer = el('footer', { className: 'app-footer' }, [
    el('p', {}, [
      '纯前端静态运行：核心计算与历史记录均在您的浏览器本地完成，不抓取平台数据，不收集账号凭证。',
    ]),
  ]);

  mount(options.root, header, degradedBanner, main, footer);
  return main;
}
