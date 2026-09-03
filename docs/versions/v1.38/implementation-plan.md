---
document_type: implementation-plan
version: v1.38
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-03
---

# v1.38 实施与验收

## 当前交付

- [x] 渠道页同时把飞书和钉钉作为可管理 Provider；两者复用同一 Tab、连接、账号与队员 Bot 路径。
- [x] 钉钉使用官方图标、真实连接状态、原生 button/Tab、`aria-selected` 和可见键盘焦点，不再显示禁用的“敬请期待”。
- [x] 保存的钉钉账号、连接、Bot 和受控管理链接从 typed Snapshot 恢复；`selectedKind=dingtalk` 与 DingTalk-only Snapshot
  均进入钉钉管理界面，秘密和项目绝对路径仍不进入 Renderer。
- [x] 保留钉钉 Main/Core、SQLite 数据、凭据、Stream、Card 与 Outbox，不做 destructive migration。
- [x] 飞书 active Host 只响应 Run started/terminal 与当前执行卡 Run 的 live event；其他 AgentRun、全局 Runtime 及
  `terminal_sealed` Run 不触发完整 `channels.host.tick`，Web 执行台链路不变。
- [x] 飞书首次恢复 Pump 跳过历史群全量 roster 网络扫描，仍执行一次 Core 恢复；精确刷新和运行期 fallback 保留。
- [x] Runtime 已捕获的 Compaction 信号可为同一 active AgentRun 生成本地 display sidecar；Codex
  `contextCompaction` 在普通 activity 前截获，其他 Runtime 不扩 detector policy、不猜缺失字段。
- [x] 展示只复用当前已有 Runtime 入口；不修改 Runtime 启动参数或环境，不安装仅用于展示的 Hook、Plugin 或配置 Overlay。
  Claude 与 Cursor 当前无展示入口，本次需求不新增其协议接入。
- [x] 执行台使用非 Tool 的 28px 四轨 Compaction 行；只有 token/summary 可展开，长 summary 复用 Managed Blob，
  公共渠道、局域网执行台、世界地图与 Bootstrap outbox 均排除；`imminent` 为中性 recorded，只有 `started` 算 active，
  图标沿用普通 command muted 色。
- [ ] packaged Applications 视觉验收：Porcelain Day / Steel Night、最小窗口、200% zoom 与键盘顺序。
- [ ] PR 合入最新 `main` 并从合并后的 `main` 构建、安装 `/Applications/Rovai.app`。

## 重新开放与能力待办（管理入口已开放）

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
- [x] 按 [V1.38-D02](decisions.md#v1-38-d02) 移除“敬请期待”整面 gate，未验收平台能力改为独立 Gate。
- [ ] 继续完成私聊、单 Bot 群、多 Bot 群、连续排队、停止、最近输出、执行台与撤回的 packaged 双端组合验收；该矩阵
  约束对应能力结论，不再隐藏整个钉钉管理入口。

## 验证 owner

- `apps/desktop/src/main/channel-host-pump.test.ts`、`channel-settings.test.ts`：飞书 tracked-Run event scope、active
  门禁、started/terminal 时序、钉钉仍使用的默认策略，以及启动恢复先 tick 且不读取历史群 roster。
- `apps/desktop/src/main/dingtalk-channel-settings.test.ts`：多 App callback 首次顺序/去重、永久 Markdown 父消息摘要、
  Card 参数/callback 与既有执行卡动作。
- `crates/rovai-core/src/channel.rs`：一个 durable aggregate/根请求、多有序 AgentRun、deadline auto-seal、迟到 replay、
  父消息投影、安全诊断，以及既有项目卡、FIFO、执行/排队 recall owner。
- `apps/desktop/src/renderer/src/ChannelSettings.test.ts`：双 Provider 选择、钉钉账号/Bot 管理事实、DingTalk-only Snapshot
  回退、Provider 计数、无旧预告/disabled gate，以及秘密与项目路径不泄露。
- `crates/rovai-core/src/acp.rs`、`codex.rs`、`main.rs`、`bin/rovai.rs`、`execution_evidence.rs`、`read_model.rs`：
  现有精确信号字段映射、Codex 先行截获、observation active Run 归属、Managed Blob 和 public/non-activity 隔离；
  `acp.rs` 的私有 Host 配置测试同时约束只有 Kiro 获得现有 Overlay。
- `apps/desktop/src/renderer/src/App.test.ts`、`execution-tool-grouping.test.ts`、Main channel tests：同 ID 原位更新、
  token/summary disclosure、静态行、Tool 计数边界和公共 wake 隔离。
- `pnpm typecheck`、Renderer/Vitest 全量、`pnpm build:desktop`：类型、现有渠道交互与生产构建回归。
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=<main base> pnpm docs:check:ci`：版本切换、当前 UI 权威和文档路由。
- packaged App 人工检查：飞书/钉钉在日/夜主题都可选择，真实图标比例不变，选中、连接、空态和键盘焦点清晰；不出现
  旧“敬请期待”预告。
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

## Compaction 选择性撤回验证（2026-09-03）

- 已通过 `cargo fmt --all --check`、`cargo check -p rovai-core --all-targets` 与
  `cargo clippy -p rovai-core --all-targets -- -D warnings`；`rovai-core` binary tests 为 189 passed / 4 个 manual
  Runtime smoke ignored，`rovai` CLI tests 为 32 passed，slow tests 为 297 passed。
- `cargo test -p rovai-core --lib` 为 477 passed / 1 failed；唯一失败仍是未改动的 macOS nested sandbox owner，
  最小 `/usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true` 在当前执行环境同样返回
  `sandbox_apply: Operation not permitted`（exit 71），因此不把全量 Rust lib 记为通过。
- 已通过 `pnpm typecheck`、`pnpm test`（Vitest 137 files / 1433 tests；Node/协议 220 passed、1 个 Windows-only
  skip）、Compaction grouping 定向 Vitest 10/10 与 `pnpm build:desktop`。
- 已通过 `pnpm docs:test`、`pnpm docs:check` 与
  `DOCS_BASE_REF=b9870c0c28b2487ddfac723fe2e932c0e3fabfac pnpm docs:check:ci`。
- 源码审计确认不存在展示专用 CLI/IPC、Claude `PostCompact` 注入或 Cursor 配置 Overlay；现有 observation 路径、
  Codex 先行截获、`imminent` 中性状态、仅 `started` 算 active 以及普通 command muted 图标颜色均保留。

## 钉钉管理入口开放验证（2026-09-03）

- Renderer owner 在旧 gate 下先得到 5/16 失败，入口实现后通过 16/16；覆盖双 Provider 选择、钉钉连接与 Bot 管理事实、
  DingTalk-only Snapshot 回退、Provider 数量、旧预告/disabled gate 移除，以及秘密和项目路径不泄露。
- 已通过 `pnpm typecheck` 与 `pnpm test`（Vitest 138 files / 1456 tests；Node/协议 220 passed、1 个 Windows-only
  skip）；`pnpm package:mac:daily` 同时完成 release Core、`pnpm build:desktop`、arm64 App 打包和 ad-hoc 签名校验。
- 已通过 `pnpm docs:test`、`pnpm docs:check` 与
  `DOCS_BASE_REF=f84f642e5278740001c4a80f2f2f7c8f7c81a0a6 pnpm docs:check:ci`；Impeccable 对本次 Renderer 目标的单次
  静态探测返回零问题。
- 已把构建产物无中断安装到 `/Applications/Rovai AI.app` 并保留旧包备份；安装源与目标 `app.asar` SHA-256 一致，
  目标深度签名复核通过，安装前记录的日常 App/Core/Helper 进程均继续存活。磁盘 Bundle 已更新，当前运行进程仍需用户在
  合适时机从 canonical path 退出并重开才会载入新版。
- packaged App 使用全新隔离 `userData` 启动到主窗口；空白 profile 因没有可打开的会话而保持启动门禁，未借用日常
  SQLite、凭据或伪造状态绕过，因此不把本轮记作渠道页日/夜主题、缩放或真实租户验收。手机端与各具体平台能力矩阵仍是
  后续 owner，不由开放入口推断为完成。
