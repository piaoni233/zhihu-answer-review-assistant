# 知乎回答数据复盘助手

> 给知乎创作者的免费复盘工具：粘贴回答数据，一键生成可验算的复盘报告。

[![CI](https://github.com/piaoni233/zhihu-answer-review-assistant/actions/workflows/ci-deploy.yml/badge.svg)](https://github.com/piaoni233/zhihu-answer-review-assistant/actions/workflows/ci-deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![在线演示](https://img.shields.io/badge/在线演示-ymyh233.me-blue.svg)](https://ymyh233.me/zhihu-answer-review-assistant/)

## 项目简介

写完回答只看得到散的阅读、赞同、收藏数，不知道好在哪、差在哪，是很多知乎答主的共同困扰。

**知乎回答数据复盘助手**就是为解决这个问题做的工具：答主把 3 篇以上回答的数据（标题、发布时间、阅读量、赞同、收藏、评论，最好带几条代表性评论）粘贴进来，一键生成复盘报告——多维评分、互动率排名、表现诊断、改进清单、下次复盘用的数据记录模板，一次给全。示例报告还能一键调用真实 AI 重新生成诊断，支持自带 Key、自定义服务商。

纯前端静态应用，零后端、零服务器成本；核心算法用 JS 实现，与 Python 原型交叉验证 347,030 组数据零差异；67 个测试全过，核心覆盖率 97.76%。MIT 开源，GitHub 公开，GitHub Pages 与 Netlify 双部署。

核心原则：

- **本地计算，数据不出浏览器**：全部计算与存储都在用户浏览器内完成，无后端、无账号、不登录。
- **数字全部可验算**：每个比率都写明算式，报告里的每个数字都能按公式复算。
- **不设绝对及格线**：知乎没有官方的互动率标准，本工具只做相对诊断——与本批回答比、与你自己的历史比。

本项目是**知乎黑客松 S3 · 湾区共创季**参赛作品，赛道为「AI✖️知识与探索」，团队“怎么想都不会赢的啊队”（1 人）。作品提交窗口为 2026-12-05 10:00 — 2026-12-07 10:00，决赛路演 12-19。

## 在线演示

| 站点 | 地址 |
| --- | --- |
| 主站（GitHub Pages） | https://ymyh233.me/zhihu-answer-review-assistant/ |
| 热备镜像（Netlify） | https://zhihu-answer-review-assistant.netlify.app/ |

核心流程**无需登录**。打开页面后可点“载入示例”使用内置虚构示例数据，一键体验完整复盘流程。

## 功能特性

- **一键复盘报告**：粘贴 3 篇以上回答数据，生成数据总览表（赞同率、收藏率、评论率、互动率）、互动率排名、四个角色诊断（本期表现最优 / 本期干货标杆 / 本期最需警惕 / 最值得改的一篇，全部用数字举证）、改进清单（每条写清问题、证据数字、具体改法、三档优先级，最多 5 条）、下次复盘用的数据记录模板。
- **相对诊断，不用绝对阈值**：每篇的各项比率写成“为本批中位数的 X 倍”；本地历史累计 10 篇以上后，额外给出“与你过去的中位数相比”的对照；可按类型标签做同类对照。
- **评论区读者信号解析**：按知乎语境把代表性评论分为质疑求证 / 追问 / 催更 / 收藏标记 / 认可五类（质疑优先于追问），计数可验算；评论中的手机号、邮箱、证件号与 @昵称自动打码。
- **数据龄与小样本提示**：每篇标注数据龄（数据截至时间 − 发布时间）；数据龄不足的结论自动降级为“仅供参考”；阅读量过小的回答标注“样本小，比率不稳定”，且不被选为“最优 / 标杆”。
- **本地历史与跨期对照**：复盘自动保存在浏览器本地；同一回答多次复盘时，历史页给出两次之间的阅读、赞同、收藏、评论增量与增量互动率。
- **导出与备份**：报告可导出 Markdown 文件（下载或复制到剪贴板）；复盘历史可导出 JSON 备份、也可导入恢复。
- **AI 深度诊断（可选，需自备 Key）**：内置 8 家 OpenAI 兼容服务商（DeepSeek、Moonshot、通义 DashScope、OpenAI 已通过浏览器 CORS 预检；智谱 AI、豆包、硅基流动、OpenRouter 标注为待验证），支持自定义 HTTPS 服务商（名称 + Base URL + 模型 + Key）与一键连通性测试；内置示例数据配有预先生成的 AI 诊断（界面明确标注“示例输出，非实时”）；模型只做语义诊断，所有数字由确定性引擎算好，AI 输出中引用的数字由程序核验，不存在的会标红提示。
- **隐私保护**：Key 默认只存当前会话（关闭页面即删），勾选“记住”才存本地；界面永不回显完整 Key；AI 诊断只在用户确认告知后才发送计算结果与评论。

## 快速开始

环境要求：Node.js ≥ 20（推荐 22，与 CI 一致），npm。

```bash
git clone https://github.com/piaoni233/zhihu-answer-review-assistant.git
cd zhihu-answer-review-assistant
npm ci
npm run dev      # 本地开发服务器
npm run build    # 构建，产物输出到 dist/
npm run preview  # 本地预览构建产物
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `npm test` | 运行全部单元测试与回归测试 |
| `npm run test:coverage` | 运行测试并生成核心模块覆盖率报告 |
| `npm run test:regression` | 只运行回归测试（Oracle 一致性 + 35 万组差分） |
| `npm run typecheck` | JSDoc 静态类型检查（`tsc --noEmit`） |
| `npm run lint:guard` | 原创性与安全门禁扫描（文案扫描 + 凭证扫描 + 隔离检查） |
| `npm run check:all` | 门禁扫描 + 类型检查 + 覆盖率测试 + 构建（提交前完整自查） |

## 用法

### 粘贴数据

按以下格式粘贴回答数据，每篇之间空一行分隔（也可用工作台里的“逐篇添加”表单辅助录入）：

```text
标题：如何系统地学习一门新语言？
发布时间：2026-11-16 12:00
阅读：18200
赞同：1240
收藏：980
评论：156
代表性评论：
- 来源是哪里？想看原文数据
- 请问每天花多少时间比较合适？
```

要点：

- **至少 3 篇**才生成互动率排名与横向对比诊断；不足 3 篇时只计算各篇基础比率，并告诉你原因。
- 数字支持 `18,200`、`1.2万`、`3千`等写法；不支持 `10万+`、`1.2w` 这类模糊写法（会明确报错）。
- 日期支持 `YYYY-MM-DD HH:mm`、`YYYY-MM-DD` 等格式；不支持无年份或相对时间（如“昨天 12:00”）。
- 阅读量为 0、缺必填字段、数字无法解析时，界面会精确指出是哪一篇、哪一行、为什么，并给出修改建议，不会静默跳过。
- 赞同 / 收藏 / 评论大于阅读量时会弹出警示，需要你确认数据无误后才继续。
- 数据截至时间默认为生成报告的时刻，也可改为你抄录数据的时刻；每篇的数据龄按它计算。

### 生成与复用报告

1. 粘贴数据后点“生成复盘报告”，报告页展示总览、排名、角色诊断、评论信号与改进清单。
2. 报告自动保存到本地历史；点“导出 Markdown”可下载 `.md` 文件，或复制到剪贴板。
3. 下次用同一回答的新数据再次复盘，历史页会显示两次之间的增量。
4. “设置”页可调整数据龄阈值（默认 7 天，可选 3 / 7 / 14 / 30 天）与小样本阈值（默认 200 阅读）。

### AI 深度诊断

- 在“设置”页选择服务商并填入你自己的 Key，点击“重新生成 AI 诊断”即可对当前报告做实时诊断；Key 默认只存当前会话。
- 内置示例数据自带一份预先生成的 AI 诊断，界面明确标注为“示例输出（预先生成，非实时）”，不联网也能看到 AI 诊断长什么样。
- 自定义服务商需填写名称、HTTPS Base URL 与默认模型，保存前可先做连通性测试；测试未通过的服务商会明确标注为“待验证”，不会提前断言可用。

## 计算口径（全部可验算）

| 指标 | 公式 |
| --- | --- |
| 赞同率 | 赞同 ÷ 阅读 × 100%（社区亦称“赞阅比”） |
| 收藏率 | 收藏 ÷ 阅读 × 100% |
| 评论率 | 评论 ÷ 阅读 × 100% |
| 互动率 | （赞同 + 收藏 + 评论）÷ 阅读 × 100%（仅作本批排序键） |
| 收赞比 | 收藏 ÷ 赞同（反映工具与留存价值） |
| 批次加权平均互动率 | 总互动 ÷ 总阅读 × 100%（不是各篇简单平均） |

口径声明：知乎官方未发布互动率标准，本工具不使用绝对及格线；报告中所有“偏高 / 偏低”都是与本批中位数或你自己的历史相比。

**精确舍入是核心正确性规则**：百分比格式化与数字取整采用“四舍六入、五成双”（银行家舍入），与 Python 参考实现逐字一致。例如阅读 32、赞同 1 时，结果为 `3.12%`（朴素的 `toFixed(2)` / `Math.round` 会错误地给出 `3.13%`）；比率严格按 `数值 ÷ 阅读 × 100` 的顺序计算，不可改写为 `数值 × 100 ÷ 阅读`。详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

```text
zhihu-answer-review-assistant/
├── .github/workflows/ci-deploy.yml   # 测试 + 门禁扫描 + 构建 + GitHub Pages 发布
├── index.html                        # 单页入口（含 CSP）
├── vite.config.js                    # Vite 构建与 Vitest 配置
├── jsconfig.json                     # 开启 checkJs 类型检查
├── package.json                      # 仅 devDependencies，无运行时依赖
├── scripts/
│   └── lint-guard.mjs                # 原创性与安全门禁扫描
├── src/
│   ├── main.js                       # 应用启动、路由与状态管理
│   ├── types.js                      # 全局 JSDoc 类型定义
│   ├── core/                         # 纯函数核心：解析、校验、计算、诊断、报告
│   ├── storage/                      # 本地持久化：IndexedDB 历史 + 设置 + 备份
│   ├── ai/                           # AI 诊断适配器：服务商、提示词、客户端、核验器
│   └── ui/                           # 视图层：输入、报告、历史、设置
├── tests/
│   ├── fixtures/                     # 回归固件：标准答案、35 万组差分用例、评论语料
│   ├── unit/                         # 单元测试（12 个文件）
│   └── regression/                   # Oracle 一致性 + 差分回归测试
└── docs/
    ├── 01-feasibility-architecture.md  # 阶段一：可行性分析与架构设计
    ├── 02-detailed-design.md           # 阶段二：详细设计
    ├── ARCHITECTURE.md                 # 架构说明与项目结构
    └── TECH-STACK.md                   # 技术选型
```

完整结构树与模块职责见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 技术栈

| 维度 | 选定方案 |
| --- | --- |
| 交付形态 | 静态单页 Web 应用（SPA） |
| 语言与类型 | 原生 JavaScript（ES Modules）+ JSDoc + `tsc --noEmit` 类型检查 |
| 构建 | Vite 6 |
| 界面 | 原生 DOM + 轻量安全模板函数（零 UI 框架运行时） |
| 测试 | Vitest 3 + JSDOM + fake-indexeddb |
| 存储 | IndexedDB（自写 Promise 薄封装）+ localStorage（设置） |
| Markdown | 自写序列化（只生成、不解析） |
| AI 接入 | OpenAI 兼容协议适配器（浏览器直连） |
| 托管 | GitHub Pages 主站 + Netlify 热备镜像 |
| CI | GitHub Actions |

每个选型的理由、备选方案与取舍见 [docs/TECH-STACK.md](docs/TECH-STACK.md)。运行时第三方依赖为 **0**（`package.json` 中只有 `devDependencies`）。

## 测试

```bash
npm test               # 全部测试
npm run test:coverage  # 测试 + 核心模块覆盖率
npm run test:regression  # 只跑回归测试
```

当前实测结果（本地与 CI 一致）：

- **14 个测试文件、67 个用例，全部通过**。
- **差分回归 347,030 组用例 0 差异**：247,030 组比率格式化用例 + 100,000 组数字解析用例，与标准答案逐项比对无差异。
- **Oracle 一致性回归**：示例数据合计阅读 49200、赞同 2630、收藏 2130、评论 414，总互动 5174，平均互动率 10.52%；各篇互动率 13.05% / 12.27% / 7.57%，与标准答案逐字一致。
- **覆盖率**（统计范围为 `src/core` 纯函数核心，Vitest + V8）：语句覆盖率 97.76%，函数覆盖率 100%。

## 部署

- **CI**：推送到 `main` 分支或提交 PR 时，GitHub Actions 依次执行门禁扫描 → JSDoc 类型检查 → 覆盖率测试 → 构建；任一步失败即阻断发布。
- **主站**：`main` 分支构建产物自动发布到 GitHub Pages（自定义域名 `ymyh233.me` 下的 `/zhihu-answer-review-assistant/` 子路径）。
- **热备镜像**：同一份构建产物同时发布到 Netlify（`netlify.toml` 已配置构建命令与 Node 22 环境）。
- **构建产物**：JS 约 134 KB（gzip 约 45 KB），CSS 约 15 KB（gzip 约 3.5 KB）；页面不引用任何境外 CDN 资源，所有资源随站点打包。

## 文档

- [docs/01-feasibility-architecture.md](docs/01-feasibility-architecture.md) — 阶段一：可行性分析与架构设计（指标口径论证、相对诊断方案、风险清单）
- [docs/02-detailed-design.md](docs/02-detailed-design.md) — 阶段二：详细设计（模块设计、解析与诊断规格、报告模板、测试计划）
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构说明：数据流、分层、完整项目结构树、核心模块职责、数据模型
- [docs/TECH-STACK.md](docs/TECH-STACK.md) — 技术选型：每个选型的理由、备选方案与取舍

## 贡献

欢迎提交 Issue 与 Pull Request。开发流程、代码与文案规范、测试要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前请运行 `npm run check:all`（门禁扫描 + 类型检查 + 覆盖率测试 + 构建）确保全部通过。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
