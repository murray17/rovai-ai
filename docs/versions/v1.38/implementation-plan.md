---
document_type: implementation-plan
version: v1.38
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-03
---

# v1.38 实施与验收

## 当前交付

- [x] 渠道页只把飞书作为可管理 Provider。
- [x] 钉钉固定显示官方图标、置灰状态和“敬请期待”，使用原生 disabled/ARIA 语义，无 hover、点击或键盘动作。
- [x] 保存的钉钉账号、连接、Bot 和管理链接不从 Renderer 暴露；`selectedKind=dingtalk` 与 DingTalk-only Snapshot 均不会
  恢复钉钉管理界面。
- [x] 保留钉钉 Main/Core、SQLite 数据、凭据、Stream、Card 与 Outbox，不做 destructive migration。
- [x] 飞书 active Host 只响应 Run started/terminal 与当前执行卡 Run 的 live event；其他 AgentRun、全局 Runtime 及
  `terminal_sealed` Run 不触发完整 `channels.host.tick`，Web 执行台链路不变。
- [x] 飞书首次恢复 Pump 跳过历史群全量 roster 网络扫描，仍执行一次 Core 恢复；精确刷新和运行期 fallback 保留。
- [x] Runtime 已捕获的 Compaction 信号可为同一 active AgentRun 生成本地 display sidecar；Codex
  `contextCompaction` 在普通 activity 前截获，其他 Runtime 不扩 detector policy、不猜缺失字段。
- [x] Claude additive `PostCompact` 只投影非空 `compact_summary`；Cursor 进程私有 `preCompact` 只投影明确
  current/window/usage token 字段。两条 display-only Hook 均由 active Run/adapter/Native Session fence 授权，不建立
  observation、outbox、跨 Run 状态或新 detector policy。
- [x] 执行台使用非 Tool 的 28px 四轨 Compaction 行；只有 token/summary 可展开，长 summary 复用 Managed Blob，
  公共渠道、局域网执行台、世界地图与 Bootstrap outbox 均排除；`imminent` 为中性 recorded，只有 `started` 算 active，
  图标沿用普通 command muted 色。
- [ ] packaged Applications 视觉验收：Porcelain Day / Steel Night、最小窗口、200% zoom 与键盘顺序。
- [ ] PR 合入最新 `main` 并从合并后的 `main` 构建、安装 `/Applications/Rovai.app`。

## 重新开放待办（执行中，入口仍暂停）

- [x] 同消息多 Bot callback 聚合为一个根请求和多个目标 `AgentRun`；Core 按首次持久观察顺序合并，Main 3 秒正常封口，
  SQLite deadline 支持重启恢复，迟到/重放不新增根请求；Rust/TS owner 覆盖顺序、去重、集合校验和超时恢复。
- [ ] 执行中三按钮卡立即可见，平台 loading 不覆盖执行期；排队卡、终态卡、下一轮真实撤回完成桌面/手机真实验收。
- [ ] 内部群项目选择、Quick Chat、刷新、过期、双击和 Non-owner 形成完整 callback 闭环。
- [x] 明确限制钉钉真实附件收发：私聊 file/audio/video 仅摘要，普通群 Bot 平台不接收这些类型；未建立 Managed
  Attachment ingress 前不下载 `downloadCode`，出站不借用 custom webhook schema。
- [x] 永久正文增加同 Camp 直接父消息的有界 Markdown 摘要，并明确不是 native reply；原生 A2A `@` 无已验证字段，
  超长正文仍等待逐片 durable Outbox/顺序/重试设计，不在单 delivery 内多发。
- [x] 加入 callback 聚合与 Card create/update/recall 的安全诊断计数，不投影正文、附件内容、外部/内部 identity、
  credential、URL、token 或远端响应。
- [ ] 通过私聊、单 Bot 群、多 Bot 群、连续排队、停止、最近输出、执行台与撤回的 packaged 双端验收后，才移除
  “敬请期待” gate。

## 验证 owner

- `apps/desktop/src/main/channel-host-pump.test.ts`、`channel-settings.test.ts`：飞书 tracked-Run event scope、active
  门禁、started/terminal 时序、钉钉仍使用的默认策略，以及启动恢复先 tick 且不读取历史群 roster。
- `apps/desktop/src/main/dingtalk-channel-settings.test.ts`：多 App callback 首次顺序/去重、永久 Markdown 父消息摘要、
  Card 参数/callback 与既有执行卡动作。
- `crates/rovai-core/src/channel.rs`：一个 durable aggregate/根请求、多有序 AgentRun、deadline auto-seal、迟到 replay、
  父消息投影、安全诊断，以及既有项目卡、FIFO、执行/排队 recall owner。
- `apps/desktop/src/renderer/src/ChannelSettings.test.ts`：开放 Provider 过滤、固定钉钉预告、disabled/ARIA、legacy
  Snapshot 不泄露和飞书回退。
- `crates/rovai-core/src/acp.rs`、`claude.rs`、`codex.rs`、`main.rs`、`bin/rovai.rs`、`execution_evidence.rs`、
  `read_model.rs`：精确信号字段映射、Claude/Cursor display-only Hook、Codex 先行截获、active Run fencing、Managed Blob
  和 public/non-activity 隔离。
- `apps/desktop/src/renderer/src/App.test.ts`、`execution-tool-grouping.test.ts`、Main channel tests：同 ID 原位更新、
  token/summary disclosure、静态行、Tool 计数边界和公共 wake 隔离。
- `pnpm typecheck`、Renderer/Vitest 全量、`pnpm build:desktop`：类型、现有渠道交互与生产构建回归。
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=<main base> pnpm docs:check:ci`：版本切换、当前 UI 权威和文档路由。
- packaged App 人工检查：入口在日/夜主题均清晰置灰，真实图标比例不变，“敬请期待”可读且不产生点击反馈。
- packaged 钉钉真实租户：桌面端/手机端分别保留多 Bot callback、项目卡、三入口、排队、停止、最近输出、执行台、
  终态与下一轮真实撤回的脱敏证据；本地 fixture 不能替代。

## 本次实现验证（2026-09-02）

- 已通过 `cargo fmt --all`、`cargo check --workspace --all-targets` 与
  `cargo clippy --workspace --all-targets -- -D warnings`。
- 已通过三个 Rust owner：多 Bot 一个有序 durable request、SQLite deadline auto-seal/replay、飞书与钉钉父消息投影；
  多 Bot owner 同时核对 collecting/ready 与 Card create/recall 安全诊断计数。
- 已通过钉钉 Main 定向 Vitest 49/49、`pnpm typecheck`、`pnpm test`（Vitest 135 files / 1425 tests；
  Node/协议 220 passed、1 个 Windows-only skip）与 `pnpm build:desktop`。
- 已通过 `pnpm docs:test`、`pnpm docs:check`、
  `DOCS_BASE_REF=aa8a734125b867fc3c25de3a5b0f243c4fdb038d pnpm docs:check:ci`；Impeccable 静态探测对
  本次卡片呈现和 UI/合同目标返回零问题。
- `cargo test -p rovai-core --lib` 本轮为 475 passed / 1 failed；唯一失败是未改动的 macOS 嵌套沙箱 owner，当前执行环境对
  最小 `/usr/bin/sandbox-exec` 同样返回 `sandbox_apply: Operation not permitted`（exit 71），因此不把全量 Rust lib 记为通过，
  留给具备 nested sandbox 权限的 CI/本机复验。
- packaged App 与钉钉真实租户双端矩阵仍未执行，Renderer gate 保持关闭。

## Compaction 跟进验证（2026-09-03）

- 已通过 `cargo fmt --all --check` 与 `cargo clippy -p rovai-core --all-targets -- -D warnings`；`rovai-core`
  binary tests 为 192 passed / 4 个 manual Runtime smoke ignored，`rovai` CLI tests 为 32 passed。
- `cargo test -p rovai-core --lib` 为 477 passed / 1 failed；唯一失败仍是未改动的 macOS nested sandbox owner，
  当前执行环境的 `sandbox-exec` 返回 exit 71。Runtime compatibility 冻结摘要、Compaction admission、Claude/Cursor
  Hook 映射与本地 display persistence 均已通过。
- 已通过 `pnpm typecheck`、`pnpm test`、Compaction grouping 定向 Vitest 10/10 与 `pnpm build:desktop`。
- 当前安装的 Cursor `2025.09.18-7ae6800` 不具备 ACP，未把 display-only wiring 记作真实 Runtime Smoke；Cursor
  全平台资格与 detector policy 保持原状态。
