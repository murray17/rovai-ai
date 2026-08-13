---
document_type: implementation-plan
version: v0.67
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-13
---

# v0.67 实施与验收计划

> Phase 1 与 Phase 2 只决定执行顺序，不是发布切分。两阶段、九 Runtime real smoke、packaged UI
> 验收和完整门禁已统一完成；v0.66 的受控关闭实现与 Migration 77 保持不变。

## Checkpoint 0：领域、ADR 与合同

- [x] 冻结唯一 `local_user`、Agent routing / User attention 正交轴与原子通知边界；
- [x] 区分 `submittedBody`、Structured Camp Message Content 与 `projectedBody`；
- [x] 冻结 Camp Message Send v4、Current User Attention v1、Built-in Tool Transport v7；
- [x] 冻结 exact Camp read addressing、compact send output 与无 locator `confirm_outcome` stop；
- [x] 冻结 Charter / operation help / `cli-operations` / `memory-stewardship` 分层与七项 official inventory。

## Phase 1：`--to-user` 完整领域合同

### Checkpoint 1：Core 内容、身份与迁移

- [x] 增加 closed `current_user_mention(local_user)`，只允许 Core 在 Agent send 接受时生成；
- [x] Composer Draft save 与 send 双重拒绝用户提交该 segment，手写/paste lookalike 保持 Text；
- [x] Agent send 先解析 strict inline Agent token，再按 `mentionUser` 前置 Current User Mention；
- [x] renderer、digest、search/index、Context 与 read side 从 Structured Content 投影；
- [x] `camp_message.body` 收敛为可重建 cache；资料/locale 变化时事务重投影并刷新 FTS；
- [x] Migration 78 在 v0.66 Migration 77 之后发布 Data Contract `v0.67` / projection schema 33、
  CampSnapshot 29、Notification item 3、Context Formatter 14 / Manifest 12；
- [x] clean break 结束 incompatible delivery/context/native markers，并把 Rovai-owned `local-user`
  一次性重建为 `local_user`，不删除用户 Project、外部 Runtime session 或 Runtime-owned file。

### Checkpoint 2：原子发送与通知

- [x] `CampMessageSendInput`、CLI schema 与 domain command 增加 default-false `mentionUser`；
- [x] 一次事务写 Message、structured mention、Agent recipients、Delivery/slot、Notification、receipt/events；
- [x] notification 唯一键为 `(kind, recipient_user_id, source_message_id)`，replay 返回原结果；
- [x] `source_message_id` 是稳定 locator；消息不可读显示来源不可用，删除 Camp 才级联清除；
- [x] public-only user mention 产生零 Delivery；`taskId` 仍要求恰好一个 Agent recipient；
- [x] read/clear/retention/source-unavailable、精确导航与有界 read-time summary 复用现有 Inbox 生命周期。

### Checkpoint 3：Transport v7、CLI 与读侧

- [x] `rovai send --to-user` 支持 direct/stdin/input-file 与 command-local help；
- [x] v7 保持十三项命令、Unix IPC、Envelope、receipt、lease 与 Agent Output v2；
- [x] exact `camp.read(mode="item")` 返回 closed addressing，其他 read/search 保持 compact；
- [x] send stdout 仍只有 `{messageId,effectiveRecipients}`；
- [x] 覆盖 task cardinality、unknown field、lookalike、replay、idempotency conflict 与 indeterminate outcome。

### Checkpoint 4：Context、Renderer 与 Notification UI

- [x] Current Input/Shared Conversation 增加 `mentionsCurrentUser`，Formatter v14 / Manifest v12 冻结；
- [x] timeline 以不可交互 inline token 显示 Current User Mention，不进入 tab order；
- [x] plain copy 输出可见文本，private structured copy 保留 segment，用户 paste 降级 Text；
- [x] Notification Center 支持固定文案、摘要、精确定位与来源不可用；
- [x] heads-up 点击并行 mark-read/navigation，偏好默认开启且只影响新 heads-up；
- [x] 8 秒同 Camp heads-up 聚合保持每条 Inbox row 独立；
- [x] Day/Night、1440×920、1040×700、200% zoom、键盘、读屏、拖选与 reduced-motion 通过。

## Phase 2：CLI 渐进式教学

### Checkpoint 5：Session Charter 与精确 help

- [x] Charter 只保留固定命令、current Camp、输入来源、compact result、公共 send 与 recovery 边界；
- [x] 教学入口固定为 `rovai --help` 后接精确 operation `--help`；
- [x] CLI/catalog golden 覆盖全部 operation help，负向拒绝 family-level help；
- [x] `--to-user` 的 flag、例子与限制只由 `rovai send --help` 拥有。

### Checkpoint 6：`cli-operations` official Skill

- [x] 新增 `SKILL.md`、`agents/openai.yaml` 与 `send/task/camp-history/memory/recovery` 五份 references；
- [x] 只触发命令族歧义、message→Task、多操作协调与复杂 recovery；普通单命令不触发；
- [x] recovery 固定 locator-present exact read 与 locator-absent stop/no-resend；
- [x] 不复制完整 schema、不制造 family help，全部链接/manifest/front matter 通过校验；
- [x] official source、默认 enabled、九 Runtime Groups 与用户 Assignment 行为保持。

### Checkpoint 7：`memory-stewardship` 无损整理

- [x] 按需拆分 references，保留触发条件和读取顺序；
- [x] 保留 authority、cache state、read-before-ID、禁止文件/SQLite/projection、secret/untrusted、
  scope/kind/direction、baseRevision、body/retrieval-key、dedupe/revise/Hearth 全部规则；
- [x] 使用真实 `rovai memory ...` operation path，并以 semantic assertions 证明规则无损。

## Checkpoint 8：自动化、真实 Runtime 与发布收口

- [x] Core/CLI/Renderer/Skill/Context/notification/migration 全部自动化覆盖；
- [x] 九 Runtime 在隔离 data-dir/workspace 完成 v7 Built-in CLI 与 `cli-operations` real smoke；
- [x] Rust fmt/check/clippy/test、Vitest/Node、typecheck/build、文档门禁与 diff check 通过；
- [x] arm64 packaged App 与 UI acceptance 通过；真实版本、截图与边界已回填。

## 当前证据

### 自动化与构建

- `cargo test --workspace -- --test-threads=1`：378 library、11 `rovai` CLI、69 `rovai-core` 通过，
  3 个真实 Runtime manual smoke 保持 ignored；workspace check、严格 Clippy 与 fmt 通过；
- `pnpm test`：45 个 Vitest 文件 / 304 项、155 Node、21 docs 通过；typecheck、desktop build、
  ADR generated history、diff-aware docs CI 与 diff check 通过；
- `pnpm package:mac` 生成 arm64 App；App、Core/CLI 与 native module 均为 arm64，
  `codesign --verify --deep --strict` 通过；包为 ad-hoc 签名，未做 notarization。

### Packaged UI

- Notification acceptance 覆盖 Day 1440×920、Night 1040×700/reduced-motion、精确定位、单项已读、
  设置即时生效、8 秒聚合不批量已读、全部已读/清除、焦点恢复与无横向溢出；
- Structured Mention acceptance 覆盖 Night `@你` token、ARIA、拖选/复制、private Clipboard 与真实
  Meta+V paste 降级；
- Skill capture 覆盖 Day 1440×920 与 Night 200% zoom、七项 official inventory、默认九组与无溢出。

### 九 Runtime real smoke

每个 Built-in CLI Case 完成 13 个 canonical operation、16 条目标 Evidence、三种 send 输入、
public-only `--to-user`、Agent+user 双轴、3 条 exact addressing read、conflict 与 lease fencing；
每个 Skill Case 从 managed projection 读取 `cli-operations`，实际调用精确 operation help。Kiro
focused 复测额外断言 successor Run 的 Native Session ID 与 source Run 相同。

| Runtime | 实测版本 / 模型 | Built-in CLI | `cli-operations` |
| --- | --- | --- | --- |
| Codex CLI | `codex-cli 0.147.0` / `gpt-5.6-sol` | pass | pass |
| OpenCode | `1.18.10` / `opencode/big-pickle` | pass | pass |
| GitHub Copilot | `GitHub Copilot CLI 1.0.79` / `claude-sonnet-5` | pass | pass |
| Claude Code | `2.1.220` / runtime default | pass | pass |
| Antigravity | `1.1.12` / runtime default | pass | pass |
| Kiro | `2.16.1` / `auto` | pass | pass |
| Qoder | `1.1.17` / `deepseek/deepseek-v4-flash-pg` | pass | pass |
| CodeBuddy | `2.133.1` / `deepseek-v4-flash` | pass | pass |
| Qwen Code | `0.21.5` / `deepseek-v4-flash(openai)` | pass | pass |

### 已知限制

- Antigravity 与 Kiro 专项 smoke 均证明 successor Run 复用同一 Native Session；Kiro 使用新的 per-Run
  Host 执行 `session/load`，不是复用带旧 Run MCP Projection 的 Host；
- 当前用户仍是 Core-owned 单一本地身份；资料编辑 UI 不在本版本范围；
- 本机包为 ad-hoc 签名，notarization 按开发工作流跳过，不等同于可分发公证包。
