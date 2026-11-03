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
- HTML 内嵌栅格图片原始字节与计算后的主题样式，提供固定复制代码/图片放大行为。
  PNG 从同一阅读面生成，超限明确失败而不截断；Markdown 保留原围栏和链接文本、结构化引用的展示名。
- `MessageQuotes` 的原生选区浮条新增选文导出，不改引用保存、复制与定位语义。
- 五套主题增加 `--conversation-selection-surface`；使用现有动作色绘制复选框，没有新增外观设置。
- 无 Rust、Schema、DTO、授权或 Runtime 改动，不涉及模型上下文变化与真实模型验收。

## 验证归属

纯函数用例归 `message-export.test.ts`：默认选项、发布边界/顺序、范围选择、结构化投影、选文隔离、文件名。
浏览器行为归 `scripts/lib/message-export.test.mjs`，命令 `pnpm test:message-export-ui`：
使用现有生产 Renderer 夹具与独立临时 Chrome profile，覆盖三种格式实际下载、HTML 离线图片/链接/放大、
PNG 像素中确有图片、缺图卡片、超长失败、元信息开关、日/夜中性灰、窄/矮视口、选文边界、草稿及跨会话清理。
夹具使用合成消息和图片，不启动 Core、Runtime 或日常用户实例。

新增界面入口纳入既有 `App.test.ts` 顶栏结构断言；引用语义继续由 `pnpm test:message-quotes` 拥有。
类型、全量 Vitest、桌面构建、主题/英文词表和通用文档治理作为交付检查，不将模拟 transport 误作真实 Runtime 证据。

验证结果：`pnpm typecheck`、全量 `pnpm exec vitest run`（265 文件、3085 项通过、2 项跳过）、
`pnpm test:message-export-ui`、`pnpm test:message-quotes`、`pnpm build:desktop` 及三项文档治理通过。
导出验收生成 1440 × 1856 PNG，并验证内嵌图片区域有实际像素。浏览器使用 1440 × 920 日/夜主题，
另覆盖 375 × 812 与 844 × 390；无 Core 或真实 Runtime 测试。
并行构建期间既有 `evaluation-host` 的完成状态轮询曾超时；未改动该用例，单独 5 项与全量复跑均通过。

## Worktree 交接

Work item: 消息多选与导出

Worktree: 仓库同级 `rovai-ai-message-export`（绝对路径保留在线程交接）

Branch: `rovai/message-export`

Base: `origin/main`，`117a9281dd2adfbb847f6630c5bea809716205af`

Governance: none

Status: ready

Next: 工作分支交付，等待 User 审阅；按既有偏好不自动创建 PR、合并或安装。
