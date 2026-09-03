---
document_type: implementation-plan
version: v1.40
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-03
---

# v1.40 实施与验收

## 当前交付

- [x] Migration 136 / data contract v1.46 / projection schema 87 扩展 Conversation、CampTurn 与 AgentRun，并保留
  普通会话条件唯一性、活动 Single Chat 条件唯一性、单 Conversation 非终态回复唯一性和冻结路由更新保护。
- [x] Core 增加 `singleChat.open/list/get/send/end`，发送在一个 command/idempotency 事务内完成消息、Turn、Run、
  Runtime 配置、路由、策略和公共边界冻结。
- [x] Core Built-in Router 实施固定 `single_chat_v1` 双层门禁；允许当前 Camp 读取、只读 Task/Memory，拒绝公开发送、
  A2A、Gather、成员/Task/Memory mutation、History 和未列出的 Rovai 操作。
- [x] Context 使用专用 Single Chat Charter/Guidance，排除普通 CLI Charter、Self Active Tasks、A2A Guidance、普通
  Member Skills 与 assigned MCP；公共增量包含目标队员自己的公屏消息并使用独立 accepted watermark。
- [x] Runtime terminal 私有路由只创建一个 agent ConversationMessage；普通 Camp Snapshot、Timeline、Channel 和
  Missing-Send Recovery 排除 Single Chat。启动/Host loss 只取消当前回复，结束事务关闭旧路由并允许立即 successor。
- [x] Renderer 接入真实 Core 方法，提供带头像的对象选择、右侧用户消息、左侧无头像队员回复、执行台式过程、连续
  Command 聚合、中文用时、终态自动折叠、停止、结束确认与“不再询问”。
- [x] 原生 Electron 验收 fixture 完成 Porcelain Day / Steel Night、窄窗口、选择器、活动回复、终态折叠、停止和
  结束确认的截图与几何断言验收。
- [x] 完成全量格式、构建、Rust/TS/文档门禁，并记录当前环境基线例外。

最终判定：

```text
implementation-ready = yes
```

## 验证 owner

- `crates/rovai-core/src/single_chat.rs`：原子 send、同 Conversation busy、无孤儿写入、私有 terminal、迟到 final、
  allowlist、启动取消与 successor 不等待旧 Conversation cleanup。
- `crates/rovai-core/src/db.rs`：v136 从 v1.45/schema 86 原子升级，Schema object 重建、receipt 和当前 marker。
- `crates/rovai-core/src/context.rs`：专用 section 顺序、目标 Agent 自身公屏增量和 accepted ACK watermark。
- `apps/desktop/src/renderer/src/SingleChatPanel.test.ts`：中文终态摘要、Run/epoch Evidence fence、选择器头像、正文无头像、
  结束文案和无专用恢复状态。
- `apps/desktop/src/renderer/src/App.test.ts` 与 `CampDetailPopover.test.ts`：Header 入口、Inspector 互斥和既有 Camp 详情回归。
- `pnpm typecheck`、相关 Vitest、`pnpm build:desktop`、Rust fmt/check/clippy/test 与 Product Contract Fingerprint。
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=5a56103ee56a0e4c3e7a4a4c05917dbd5e05c7c3 pnpm docs:check:ci`。

## 已完成的定向证据（2026-09-03）

- Single Chat service 与 Context 定向 Rust：5/5 通过，其中 `single_chat::tests` 3/3。
- v136 所属完整升级 owner：1/1 通过；Product Contract Fingerprint：1/1 通过。
- Renderer 相关 Vitest：158/158 通过；原生 Electron Single Chat 验收：1/1 通过；`pnpm typecheck` 与
  `pnpm build:desktop` 通过。截图复核覆盖日/夜主题、1180×800 与 1040×700 紧凑布局。
- `pnpm test` 通过：141 个 Vitest 文件、1479 项测试；汇总 Node suite 220 项通过、1 项 Windows-only 跳过；
  文档决定测试 9/9、Skill 门禁与其余协议 suite 均通过。
- Rust fmt/check/clippy `-D warnings` 通过。`cargo test --workspace` 在排除一项已于未改动主干复现的 macOS sandbox
  环境基线后共 725 项通过、5 项既有 ignored；排除项
  `managed_process::tests::macos_runtime_sandbox_denies_user_automation_root_but_keeps_other_files_visible` 在本机以
  sandbox exit 71 失败，与 Single Chat 改动无关。
- `pnpm docs:test`、`pnpm docs:check` 与以 `5cfbce5ff8d734fb84b46fddacd91d011898cf85` 为基线的
  `docs:check:ci` 通过。
