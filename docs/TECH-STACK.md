# 技术选型

> 本文档说明本项目每个技术维度“为什么选它”。选型结论来自 `docs/01-feasibility-architecture.md` §8（阶段一）与 `docs/02-detailed-design.md` §1.1（阶段二拍板），此处按**实际落盘结果**整理；个别规划与实现有出入的地方已在相应条目中注明。
>
> 约定：每个选型写清“选定 — 备选 — 取舍理由”。凡是“待验证”的项，代码与界面均不提前断言可用，须由使用者通过连通性测试实际验证。

## 总览

| 维度 | 选定 | 备选 |
| --- | --- | --- |
| 交付形态 | 静态单页 Web 应用（SPA） | 前后端应用 / 小程序 / 浏览器插件 |
| 语言与类型 | 原生 JavaScript（ES Modules）+ JSDoc + `tsc --noEmit` | TypeScript / Python → WASM（Pyodide） |
| 构建 | Vite 6 | 无构建直出 ES 模块 / Webpack |
| 界面 | 原生 DOM + 轻量安全模板函数 | Preact / Vue / React |
| 单元测试 | Vitest 3 + JSDOM + fake-indexeddb | Node 内置 `node:test` / Jest |
| 界面流程测试 | Vitest + JSDOM 集成测试（`tests/unit/ui-flow.test.js`） | Playwright 端到端（规划项，尚未落盘） |
| 存储 | IndexedDB（自写 Promise 薄封装）+ localStorage（设置） | 仅 localStorage / OPFS |
| Markdown | 自写序列化（只生成、不解析） | marked / markdown-it |
| AI 接入 | OpenAI 兼容协议适配器（浏览器直连） | 官方 SDK / 自有代理 |
| 托管 | GitHub Pages 主站 + Netlify 热备镜像 | Vercel / Cloudflare Pages / EdgeOne Pages |
| CI | GitHub Actions | 手动发布 |
| 依赖策略 | 运行时第三方依赖 0，版本锁定 | — |

## 1. 交付形态：静态单页 Web 应用

**选定**：纯静态 SPA，全部计算与存储在用户浏览器内完成，无后端、无账号。

**为什么选它**：

- 赛事要求可公开访问的演示地址，且核心流程不需要登录；静态站与“免登录”天然契合。
- 没有服务端，就没有服务器运维、费用与数据泄露面；演示地址在评审期（12-07 — 12-11）只需保持托管在线。
- 评审很可能在手机或聊天软件内置浏览器里打开链接；静态单页在各类浏览器里的兼容成本最低。

**备选与取舍**：

- 前后端应用：需要服务器与账号体系，工期与运维成本都超出单人 9 天排期；核心流程并不需要服务端。
- 小程序：需审核与主体资质，评委无法直接打开链接体验。
- 浏览器插件：评委需要先安装，体验门槛最高。

## 2. 语言与类型：原生 JavaScript + JSDoc

**选定**：原生 JavaScript（ES Modules），配合 JSDoc 类型注释与 `// @ts-check`，用 `tsc --noEmit -p jsconfig.json` 做静态类型检查；零构建期语法转译负担。

**为什么选它**：

- 计算核心是约 300 行无依赖纯函数，原生 JS 足够表达；JSDoc 兼顾类型检查与零成本（`jsconfig.json` 已开启 `checkJs`）。
- 构建产物直接就是源码的打包结果，调试与回归都简单；评审期出问题可快速定位。

**备选与取舍**：

- TypeScript：类型更严格，但会增加构建配置与类型调试时间；9 天排期里不值。
- Python → WASM（Pyodide）：可以直接跑 Python 参考实现，但包体数 MB，在大陆网络加载慢；且“直接跑参考实现”与“全新实现”的原创要求冲突。

## 3. 构建：Vite 6

**选定**：Vite 6（`vite.config.js`：`base: './'`，`target: es2022`，产物输出到 `dist/`）。

**为什么选它**：

- 产物压缩与带哈希的文件名，避免用户或评委拿到缓存的旧版本。
- 开发服务器开箱即用；与 Vitest 同一套配置，测试无需额外搭建。
- `base: './'` 使用相对路径，同一份产物可同时部署到 GitHub Pages 子路径与 Netlify 根路径。

**备选与取舍**：

- 无构建直出 ES 模块：资源缓存与旧版浏览器兼容更难控制。
- Webpack：功能更全，但配置更重；本项目只有一个入口，Vite 已足够。

## 4. 界面：原生 DOM + 轻量模板函数

**选定**：原生 DOM 操作 + 轻量安全模板函数（`src/ui/dom.js` 的 `el()` / `escapeHtml()`），零 UI 框架运行时。

**为什么选它**：

- 应用只有 4 个视图（输入工作台 / 报告 / 历史 / 设置），单向数据流（输入 → 解析校验 → 计算诊断 → 渲染 / 存储），无深层嵌套的双向绑定需求。
- 包体小：构建产物 JS 约 134 KB（gzip 约 45 KB），远低于 200 KB 目标，利于大陆首屏加载。
- 用户输入一律转义后插入 DOM，不使用 Markdown 解析库渲染用户内容或 AI 输出，消除 XSS 面。

**备选与取舍**：

- Preact（约 4 KB）：若后续状态复杂度上升，可低成本切换；当前不需要。
- Vue / React：体积与心智成本与本项目规模不匹配。

## 5. 测试：Vitest 3 + JSDOM + fake-indexeddb

**选定**：Vitest 3（`tests/unit/**/*.test.js`、`tests/regression/**/*.test.js`），JSDOM 环境做界面流程集成测试，`fake-indexeddb` 模拟浏览器存储。

**为什么选它**：

- 与 Vite 同配置，原生支持 ES Modules 与 JSDOM；测试与产品复用同一份源码（纯函数核心在 Node 下单测、在浏览器中运行）。
- V8 覆盖率开箱即用，覆盖率统计范围为 `src/core`（纯函数核心）。

**备选与取舍**：

- Node 内置 `node:test`：零依赖退路；但与 Vite 的集成和 JSDOM 支持不如 Vitest 顺手。
- Jest：生态成熟，但 ES Modules 支持需要额外配置，且与 Vite 是两套体系。

当前实测：14 个测试文件、67 个用例全部通过；核心模块语句覆盖率 97.76%，函数覆盖率 100%。

## 6. 界面流程测试：Vitest + JSDOM（Playwright 为规划项）

**现状**：核心流程（粘贴 → 生成报告 → 导出 → 历史 → AI 诊断面板 → 自定义服务商 → 连通性测试）由 `tests/unit/ui-flow.test.js` 在 JSDOM 中做集成测试。

**为什么是现状**：阶段二规划的 Playwright 端到端脚本（桌面 + 375px 移动视口）尚未落盘；JSDOM 集成测试已覆盖核心流程的交互分支，足以支撑提交。

**规划与取舍**：

- Playwright：能脚本化全流程并截图，仍是后续补齐端到端测试的首选；手工测试作为补充（大陆网络、聊天软件内置浏览器只能手工）。
- 本项在 PR 描述的“后续建议”中记录，不阻塞本次文档完善。

## 7. 存储：IndexedDB + localStorage

**选定**：IndexedDB 存复盘历史与回答快照（`src/storage/idb.js` 为约 120 行自写 Promise 薄封装，不引入 `idb` 依赖）；localStorage 存规则设置；AI Key 默认存 `sessionStorage`（关闭页面即删），勾选“记住”才存 `localStorage`。

**为什么选它**：

- 一次复盘约 5–30 KB，IndexedDB 配额以百 MB 计，可存数千次复盘；支持按回答跨期查询（同一回答多次复盘的增量对照）。
- localStorage 同步阻塞、容量约 5 MB、不便查询，只适合放少量设置。
- 运行时第三方依赖保持为 0，消除供应链与体积风险。

**备选与取舍**：

- 仅 localStorage：实现最简单，但容量与查询能力不足。
- OPFS：部分移动浏览器支持不完整。

**降级策略**：启动时探测 IndexedDB；不可用时（如某些内置浏览器或无痕模式）降级为“本次会话内存保存”，并在界面顶部明示，引导用户导出 Markdown 或 JSON 备份。

## 8. Markdown：自写序列化

**选定**：从报告模型自写 Markdown 序列化（`src/core/report.js` 的 `serializeReportToMarkdown`），只生成、不解析。

**为什么选它**：

- 本项目只需要“生成”报告文件，不需要“解析” Markdown；引入解析库是多余依赖。
- 避免解析库带来的 XSS 风险；界面渲染与 Markdown 导出消费同一个报告模型，保证屏幕与导出文件数字 100% 一致。

**备选与取舍**：marked / markdown-it：功能完整，但本项目用不上解析能力，且增加包体与风险面。

## 9. AI 接入：OpenAI 兼容协议适配器（浏览器直连）

**选定**：一套 OpenAI 兼容协议的 `fetch` 适配器（`src/ai/client.js`），浏览器直连用户自选的服务商；Key 只存用户本地，不经过我方服务器（本项目没有我方服务器）。

**为什么选它**：

- 一套代码覆盖多家服务商；内置 8 家：DeepSeek、Moonshot、通义 DashScope、OpenAI（4 家已通过浏览器 CORS 预检）；智谱 AI、豆包、硅基流动、OpenRouter（4 家标注为“待验证”，须由使用者通过连通性测试实际验证）。
- 支持用户自定义 HTTPS 服务商（名称 + Base URL + 模型 + Key），并内置一键连通性测试。

**备选与取舍**：

- 官方 SDK：每家一套 SDK，包体与维护成本都高。
- 自有代理（服务端转发）：评委可实时体验，但引入后端、Key 管理、费用与日志脱敏，且与“无后端”方向冲突；工期 +1.5 天，已否决。
- Anthropic 官方接口：浏览器预检未通过，不建议首批支持。

**设计原则**：大模型不算数——所有数字由确定性引擎算好，作为结构化输入交给模型；模型只做语义诊断；输出中引用的数字由程序核验（`src/ai/verifier.js`），不存在于计算结果中的会标红提示。

## 10. 托管：GitHub Pages 主站 + Netlify 热备镜像

**选定**：主站 GitHub Pages（自定义域名 `ymyh233.me`），热备镜像 Netlify（`netlify.toml` 已配置构建命令与 Node 22 环境）。

**为什么选它**：

- GitHub Pages 与代码仓库同源、零成本、用 GitHub Actions 发布；仓库须公开（这也要求仓库里绝无凭证）。
- 双站热备：主站在大陆网络下不可用时，可切换提交链接到镜像。
- 页面不引用任何境外 CDN 资源（字体、JS 库等），所有资源随站点打包。

**备选与取舍**：

- Vercel：**否决**。其默认域名在大陆不可用的报道最集中。
- Cloudflare Pages / EdgeOne Pages：未实测，未选为首选；自定义域名 + Cloudflare 代理为保底方案（若两站均不可用）。

## 11. CI：GitHub Actions

**选定**：`.github/workflows/ci-deploy.yml`——推送到 `main` 或提交 PR 时依次执行：原创性与安全门禁扫描（`npm run lint:guard`）→ JSDoc 类型检查 → 覆盖率测试 → 构建；`main` 分支构建产物自动发布到 GitHub Pages。

**为什么选它**：每次发布都经过回归与扫描，避免把凭证或禁用词发布出去；部署与仓库在同一平台，配置最少。

**备选与取舍**：手动发布：容易跳过检查、容易误发旧版或含凭证的产物；已否决。

## 12. 依赖策略：运行时第三方依赖为 0

**选定**：`package.json` 中只有 `devDependencies`（Vite、Vitest、TypeScript、JSDOM、fake-indexeddb、`@vitest/coverage-v8`），**没有 `dependencies`**；版本由 `package-lock.json` 锁定。

**为什么选它**：降低供应链攻击与构建失败风险；npm 访问慢时可用镜像源安装；评审期构建可复现。

## 13. 安全：CSP 与输入处理

- `index.html` 设置内容安全策略（CSP）：默认只允许本站资源；`connect-src` 仅放行 AI 适配器支持的大模型域名（未启用 AI 时无外连）。
- 用户输入与 AI 输出一律转义后渲染，不解析、不执行。
- 凭证红线：仓库、前端响应、日志、截图中不得出现任何 Key；CI 的凭证扫描（`sk-`、Bearer token、私钥头）命中即构建失败。
