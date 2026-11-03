---
document_type: implementation-plan
version: v1.72
lifecycle: current
authority: message-export-implementation
last_updated: 2026-11-03
---

# 消息导出实施记录

User 确认 B 方案（复选框 + 中性灰行底）、移除预览汇总/规则入口，并授权独立 worktree 实现。
HTML/PNG 的头像、作者、时间、发送对象默认勾选；Markdown 不提供头像，其余三项默认勾选。
当前规范归[会话工作区](../../ui/components/conversation-workspace.md#消息导出)。

## 实现边界

- `MessageExport` 拥有会话内选择、范围选择、预览与格式选项；正文仍由 `ThreadWorkspace` 的现有结构化
  消息渲染路径提供。Composer 保持挂载；Thread 切换清理选择并取消未完成导出。
- `message-export` 投影可导出消息与 Markdown，生成独立 HTML 和 PNG。快照仅遍历导出阅读面，
  不遍历公屏执行区；内部动作转为静态元素，清洗消息 HTML，仅 HTTP(S) 链接保留可跳转行为。
  原图经既有 `ImageGallery` 受控附件/输出图读取和 Blob 缓存进入导出，不新增路径读取或上传接口。
- HTML 内嵌栅格图片原始字节与计算后的主题样式，保留可重排的正文布局，提供固定复制代码/图片放大行为。
  PNG 从固定 720px 阅读面生成，超限明确失败而不截断；Markdown 保留原围栏和链接文本、结构化引用的展示名。
- `MessageQuotes` 的原生选区浮条新增选文导出，不改引用保存、复制与定位语义。
- 五套主题增加 `--conversation-selection-surface`；使用现有动作色绘制复选框，没有新增外观设置。
- 无 Rust、Schema、DTO、授权或 Runtime 改动，不涉及模型上下文变化与真实模型验收。

## 验证归属

纯函数用例归 `message-export.test.ts`：默认选项、发布边界/顺序、范围选择、结构化投影、选文隔离、文件名、原相邻消息时间。
浏览器行为归 `scripts/lib/message-export.test.mjs`，命令 `pnpm test:message-export-ui`：
使用现有生产 Renderer 夹具与独立临时 Chrome profile，拦截下载链接以检查三种格式 Blob，覆盖 HTML 离线图片/链接/放大、
PNG 像素中确有图片、缺图卡片、超长失败、元信息开关、日/夜中性灰、窄/矮视口、选文边界、草稿及跨会话清理。
回归覆盖任务列表状态、持续加载超时与重试、日/夜代码块计算样式对照、连续/跳选消息时间、默认/自定义标题，
以及下载后的独立 HTML 在 375 / 720 / 1440px 宽度重新排版且图标与引用标题同行。
夹具使用合成消息和图片，不启动 Core、Runtime 或日常用户实例。

`pnpm accept:message-export [App 路径]` 启动打包 Desktop 与生产 Host，使用全新临时 userData、
Skill 库和合成消息；确认数据库位于隔离目录后才写入样本。不拦截链接点击或 Blob API，通过 Electron
实际下载链路保存 HTML / PNG / Markdown，检查落盘字节与内容。没有真实模型 Run，也不安装或重启日常 App。

新增界面入口纳入既有 `App.test.ts` 顶栏结构断言；引用语义继续由 `pnpm test:message-quotes` 拥有。
类型、全量 Vitest、桌面构建、主题/英文词表和通用文档治理作为交付检查，不将模拟 transport 误作真实 Runtime 证据。

本轮 `pnpm typecheck`、全量 `pnpm exec vitest run`（265 文件、3086 项通过、2 项跳过）、
`pnpm test:rust:pr`（484 项通过、1 项忽略）、`pnpm test:message-export-ui`、
`pnpm test:message-quotes`、`pnpm build:desktop` 及三项文档治理通过。
浏览器夹具生成 1440 × 2188 PNG，并验证内嵌图片区域有实际像素；独立 HTML 在 375 / 720 / 1440px
均无页面横向溢出。App 内预览另覆盖 375 × 812 与 844 × 390、日/夜主题。

arm64 打包 Desktop 的 `pnpm accept:message-export` 通过：三种文件实际落盘，HTML 保留两种任务状态，
1440 × 1086 PNG 目视确认勾选状态和代码样式，Markdown 保留任务语法和 `diff` 围栏。
脚本等待刷新后的新页面与启动遮罩退出，再使用鼠标操作；下载不拦截点击或 Blob API。
本项启动了隔离的生产 Core/Host，没有启动真实 Runtime，也没有安装或重启日常 App。

## 审查修复

- GFM 任务复选框先转为静态 SVG 标记，再清理通用控件，保留 checked 状态。
- 资源加载截止仍 pending 时阻止生成，保留当前预览、选择与重试入口。
- 导出 Markdown 纳入同一组会话代码样式作用域；同时保留背景、边框、圆角与内边距。
- 默认标题使用当前 sourceTitle；手动标题单独保存，不被会话改名覆盖。
- 多选入口恢复双勾列表图标。连续发言沿用现有生产代码的末条时间，不采用审查中误述的首条时间。
  导出与原会话共用分段判断，并记录源时间线下一条 ID，避免跳选消息被误合并。
- HTML 排除计算后的宽高和网格像素轨道，恢复引用标签的相对网格；PNG 继续冻结阅读面尺寸。

## Worktree 交接

Work item: 消息多选与导出

Worktree: 仓库同级 `rovai-ai-message-export`（绝对路径保留在线程交接）

Branch: `rovai/message-export`

Base: `origin/main`，`117a9281dd2adfbb847f6630c5bea809716205af`

Governance: none

Status: ready

Next: 工作分支交付，等待 User 审阅；按既有偏好不自动创建 PR、合并或安装。
