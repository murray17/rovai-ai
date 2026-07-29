---
document_type: implementation-plan
version: v0.22
lifecycle: current
authority: implementation-plan-and-acceptance
last_updated: 2026-07-29
---

# Rovai-ai v0.22 实施计划与验收清单

> 状态：产品实现完成，自动化与真实应用验收通过
>
> 版本范围：[README.md](README.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 跨版本决策：
> [ADR-0071](../../adr/0071-configured-camp-creation-and-lazy-conversations.md)

`[x]` 只表示已有文档、代码、Migration、自动测试或可复现验收证据。按顺序推进，但不得
为了勾选检查点保留旧首条消息流程、降低 Core 结构准入或把 Conversation 再次改为 eager。

## 检查点 0：共同理解与权威文档

- [x] 核对 `AGENTS.md`、文档路由、v0.21 最终实现状态、有效 ADR、UI 规范、
  `CONTEXT.md`、Migration、Core、IPC、Renderer、测试和参考原型。
- [x] 在用户逐项确认后更新 Camp Creation、Camp Name Origin、Initial Camp
  Membership、Camp Collaboration Mode、Default Lead、Conversation 与 Execution
  Admission 正式术语。
- [x] 用户明确确认“已达成共同理解”，授权进入实现。
- [x] 冻结 v0.21 为已完成历史版本，并将唯一当前版本切换为 v0.22。
- [x] 接受 ADR-0071，建立对 ADR-0058 的局部替代指针。
- [x] 记录参考原型与当前领域/架构的冲突，不把原型当作规范真源。

## 检查点 1：Contracts 与直接 schema 切换

- [x] 定义 `CampNameOrigin`、`CampCollaborationMode`、配置式 CreateCamp request/command/
  result；Renderer 与 Rust 使用一致的闭集值。
- [x] `camp` schema 增加 `name_origin` 和 `collaboration_mode` CHECK 约束并提升 migration
  version。
- [x] 直接清除或重建不兼容的旧 collaboration aggregate 数据，不迁移首条消息 Camp、
  不回填来源、不双读写。
- [x] Fresh database、重复 reopen、局部清理和 `foreign_key_check` 测试通过。
- [x] 删除公开 `camps.createFromFirstMessage` 与 creation-preflight Runtime gate；未使用
  的旧合同、类型和 pending request method 一并退出。

## 检查点 2：配置式 Camp 创建

- [x] `camps.create` 接受可选名称、Repository Binding、非空精确成员、Default Lead 和
  collaboration mode。
- [x] Core 在一个事务中复核 User actor、成员 Presence、无重复、Lead containment、
  mode、绝对路径与 Repository Binding。
- [x] Runtime 未配置、未安装、未认证或未就绪均不阻止 Camp 创建。
- [x] 成功只创建一张 Camp 和所选 CampMembers；Conversation、Message、Turn、Run、
  Native Session 与 Bootstrap 均为零。
- [x] stale member、invalid Lead/mode/binding 只产生原子 rejection，不静默修正。
- [x] command replay 返回同一 Camp；同 command ID 不同 payload 产生 idempotency
  conflict。

## 检查点 3：名称状态机

- [x] Core 统一实现 whitespace normalization 与 80 Unicode scalar value 计数。
- [x] 空名称创建为 `未命名对话/default`，非空创建为规范化值/`user`。
- [x] 首条已接受用户执行在同一事务中把 `default` 更新为确定性截断名称/`generated`。
- [x] 显式 rename 总是写 `user`，包括重命名为 `未命名对话`。
- [x] rejected、pending、cancelled 或部分 admission 不改变名称与来源。
- [x] 边界测试覆盖 CJK、emoji、组合字符、换行/多空格、79/80/81 scalar values。

## 检查点 4：按目标延迟 Conversation

- [x] Address resolution 先按 CampMember + Profile Presence 返回身份目标，不以
  Conversation inner join 过滤。
- [x] Preflight 对缺失 Conversation 报告 idle/unqueued，并能为最终执行准备稳定 ID。
- [x] 全目标最终准入后，在同一事务中创建或复用每个目标 Conversation，并创建
  CampMessage、CampTurn 和 AgentRuns。
- [x] 一个目标失败时，全部新 Conversation、Message、Turn 和 Runs 都不存在。
- [x] 非目标成员在首条及后续消息后仍可没有 Conversation。
- [x] `add_camp_member`/reactivation 不创建 Conversation，已有 Conversation 连续性保留。
- [x] ADR-0066 的 Resolution Job/Pending Intent 可先存在，但只有最终成功才消费并创建
  业务事实。

## 检查点 5：Read Side、删除与 IPC

- [x] Camp Snapshot、Navigation、Default Lead reconciliation 和 member views 支持零
  Conversation、零消息 Camp。
- [x] Navigation 在创建后立即显示新 Camp，并使用 Camp timestamp 稳定排序。
- [x] 空 Camp 可永久删除；删除继续遵守 quiescent blockers 和全从属清理。
- [x] Main process 对 Project 选择重新验证 worktree root、Git common dir 与 object
  format。
- [x] 创建成功的 IPC result 足以刷新/激活 Camp；失败返回稳定可本地化代码。
- [x] `camp.messages.send` 成为新 Camp 首条消息的唯一产品路径，Runtime Resolution
  pending/cancel/retry 仍可恢复。

## 检查点 6：Renderer Dialog

- [x] 全局新对话入口打开 Dialog，默认「不关联项目」。
- [x] Project `＋` 先选目录；取消无副作用，成功后 Dialog 预选精确 binding。
- [x] selector 包含 Lobby、已知具体路径和最后的系统选择器入口。
- [x] 成员默认全选，最后一名不可取消；Lead 推荐、手动保持和移除后自动切换符合稳定
  Member Order。
- [x] 左侧「并肩协作」启用并选中；右侧「领队统筹」禁用并标记「暂未开放」。
- [x] 「可选配置」可折叠并提供名称；按钮为「创建」。
- [x] 提交期间防重复；失败保留 Draft；成功关闭、刷新 Navigation、进入 Camp 并聚焦
  Composer。
- [x] 删除旧全屏 NewConversationWorkspace、欢迎草稿和首条消息建 Camp 文案/测试。

## 检查点 7：自动化与视觉验收

- [x] Rust 单元/集成测试覆盖创建结构准入、幂等、名称来源、lazy Conversation、
  all-or-none admission、member reactivation、删除和 migration。
- [x] Read Side 测试覆盖空 Camp、无 Conversation 成员、Navigation 与首条消息后状态。
- [x] Renderer/contract 测试覆盖默认值、最后成员保护、Lead 自动切换、禁用 mode、
  Draft 保留和成功焦点。
- [x] `cargo test -p rovai-core --all-targets`、`cargo clippy -p rovai-core --all-targets
  -- -D warnings`、`pnpm typecheck`、`pnpm test`、`pnpm build:desktop` 全部通过。
- [x] 打包或等价真实 Desktop IPC Smoke 验证：创建空 Camp→重启仍存在→首条消息自动
  命名→只创建 Lead Conversation→显式多目标全成或全败。
- [x] `1440×920` Day 与 `1040×700` Night 验证 Dialog、滚动、focus trap、Escape、
  返回焦点、200% zoom、reduced motion 和无横向溢出。

## 完成证据

- `cargo test -p rovai-core --all-targets -- --test-threads=1`：
  lib 196 项通过；bin 44 项通过、5 项显式 manual smoke ignored。
- `cargo clippy -p rovai-core --all-targets -- -D warnings`、`pnpm typecheck`、
  `pnpm test`（21 files / 102 tests）和 `pnpm build:desktop` 全部通过。
- `node scripts/smoke-core.mjs` 验证 fresh/reopen 与临时 Repository 选择；
  `node scripts/smoke-intake.mjs` 使用真实 Core 与 Codex Runtime 验证空 Camp 创建、
  重启持久化、首条自动命名、Lead Conversation 复用、永久删除及再次重启。
- `scripts/accept-new-conversation-ui.mjs` 通过真实 Electron CDP 验证创建成功闭环，以及
  `1440×920` Day、`1040×700` Night、focus trap、Escape/返回焦点、200% zoom、
  reduced motion 和整页无横向溢出。

## 完成定义

完成时，仓库中不能再存在以下产品语义：

- “发送第一条消息才保存 Camp”；
- “没有可执行 Runtime 就不能创建 Camp”；
- “每名 CampMember 必有一张 Conversation”；
- “并肩协作默认广播”；
- “Renderer 禁用即可代表 mode 不受支持”；
- “默认名称可覆盖用户明确命名”；
- 为未发布旧数据保留兼容分支。

最终验收证据在实际完成后追加到本文件；当前勾选只覆盖已冻结的共同理解和文档。
