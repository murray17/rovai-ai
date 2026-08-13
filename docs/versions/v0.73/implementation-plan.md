---
document_type: implementation-plan
version: v0.73
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-14
---

# v0.73 实施与验收计划

## Checkpoint 0：版本、权威与小问题收口

- [x] 以现有 complete/acceptance evidence 冻结 v0.72，建立唯一 current v0.73 和前后版本链接；
- [x] 接受 ADR-0178/0179/0180，明确 Memory authority、隔离 Hearth Review Store 与 Transport v9 是三个
  独立决策；
- [x] 建立 Memory Capture v1 与 Online Memory Capture architecture，更新 Context、CURRENT、目录索引和
  Built-in Tool Runtime composition；
- [x] 冻结自然语言 opportunity 只提供 best-effort Skill discovery，不建设确定性 intent Router；
- [x] 冻结 Agent 只能改自己的 Companion 与 directed Relationship，mutual 只允许 user governance；
- [x] 冻结 terminal candidate 全清、formal publication exact pending-add invalidation，以及 Forget 前置
  reconciliation，关闭 targetless add 的复活路径；
- [x] 完成九项跨版本文档影响判断，不把 accepted design 写成 production implementation。

## Checkpoint 1：Store v3、迁移与 Hearth Review 深模块

- [x] 新增 `hearth_review_item` schema、closed status/reason constraint、candidate fields、accepted refs、source
  weak refs、version/timestamps 和 pending-only digest constraint；
- [x] 从 `hearth_memory_proposal` 原子迁移：保留 formal Memory/Revision/keys/Supersession，转换 pending row，
  清 accepted/rejected candidate，并 invalidates 已等于任一 retained formal Hearth Revision 的 pending add；
- [x] 把 formation origin `accepted_hearth_proposal` 映射为 `accepted_hearth_review`，保留 effect、source 与
  capacity class；
- [x] 实现独立 Hearth Review repository/service：submit、user-only list/read、accept/edit-and-accept、reject、
  invalidation 与 derived stale；repository method 不独立 commit；
- [x] Review accept 使用 `expectedReviewItemVersion`；revise 另检查 active Hearth target 与 exact base Revision；
  stale 只从 read/decision transaction 派生，不做 target-change fan-out update；
- [x] accept/reject/invalidate 均清 candidate Kind/body/keys/digest；events、durable results、diagnostics 与
  migration logs 保持 body-free；
- [x] pre-v3 migration fixtures 覆盖 pending add/revise、accepted/rejected、active exact match、source missing、
  existing Agent-origin mutual 与幂等重复启动。

## Checkpoint 2：Agent Memory Capture Facade 与安全闭包

- [x] 把 `memory.write` input 收敛为 closed add/revise union；Core 从 lease/Binding 推导 actor/Camp/Run/epoch，
  不接受模型提供 authority identity；
- [x] Direct path 仅允许 Companion(current Agent) 与 directed(current Agent → present counterparty)，对 mutual、
  reverse directed、other Companion、inactive/unknown target 给出无泄露拒绝；
- [x] Hearth path 只创建 pending Review Item，不创建 Memory/Revision/FTS/Entrypoint/read evidence；
- [x] 保留 canonical body/keys、Secret Filter、idempotency、active exact duplicate、Revision no-change/CAS、
  per-Run quota、active/Agent-origin capacity 和 body-free command result；
- [x] 所有 formal Hearth create/revise（user direct 或 accepted review）通过同一 publisher，原子 invalidates
  final Kind/body matching pending add，并排除被接受的 current item；
- [x] Forget 在清正文前对目标全部未清除 formal Revision body 运行 pending-add safeguard，再清 formal
  revisions/keys/FTS 和所有 target/accepted-linked Review candidate；pending target revise 转
  `target_forgotten`；
- [x] Search/Read/Entrypoint tests 证明 pending/stale Review candidate 不可见，duplicate_pending 不返回 ID/body/
  snippet/keys，guessed Review/Memory ID 不形成 side channel；
- [ ] property/integration tests 覆盖 publication→forget→old candidate 不可复活、edit-and-accept 命中另一
  pending add、并发 accept/reject、stale reactivation、quota/replay 与 transaction rollback。

## Checkpoint 3：Built-in Tool Transport v9 与 operational Skills

- [x] 删除 canonical `memory.propose_hearth`、CLI `propose-hearth`、router/catalog mapping、root/exact help、
  schema、fixture、Bootstrap command list、Skill references 与旧 smoke path；不保留 alias/fallback；
- [x] 版本提升 contract/CLI command/capability/catalog digest 至 v9，并让 AgentRun preflight 拒绝 v8/mixed
  context；Antigravity compatibility 与其他 Runtime rollout 遵守 Transport v9；
- [x] `memory.write` Core canonical result 与 Agent Output Projection 支持 closed
  `effective | review_pending` union；完整 Envelope/receipt/request identity 继续 host-only；
- [x] 更新 golden fixtures、schema digest、direct flags/stdin/`--input-file` parity、single-JSON stdout、Replay、
  lease/fence、recovery 与 negative path tests；
- [x] 重写 `memory-stewardship` frontmatter/default prompt：以“可能存在长期信息”触发，显式请求为高信号但
  不用“必须”；正文按 Companion/Relationship/Hearth 分路并仅决定 add/revise/stop；
- [x] Skill 明确 Agent 不写 mutual、Hearth success 只叫 `review_pending`、Forget 只属于 structured user
  governance；更新 `cli-operations` Memory reference 而不复制完整治理；
- [x] 更新 bundled Skill manifest/digest/installer validation 和 tests，继续保持 system-required、all Runtime
  Group 与 Settings hidden invariant。

## Checkpoint 4：User Review IPC、类型与 Renderer

- [x] 将共享 TS/Rust types、JSON-RPC/IPC、Snapshot/read models 和 user commands 从 Proposal 术语迁移到
  Hearth Review Item；删除 `baseMemoryVersion` 与 persisted stale；
- [x] list/read view 只对 user surface 暴露 pending candidate；terminal rows 强制 candidate null，并提供
  stale、closed invalidation reason、accepted refs 和 edited-before-acceptance；
- [x] Accept/Edit-and-accept/Reject 使用 exact Review version，Revise accept 另用 target base；冲突返回最新
  body-free locator/read model，不由 Renderer optimistic merge；
- [x] Memory workspace banner/drawer 把 pending Review 与 formal Memory 列表/Revision history 分开；fresh 与
  stale actions、dismiss-no-effect、user rejection/system invalidation 文案准确；
- [x] Forget preview 与完成 refresh 覆盖关联 Review cleanup；conflict 保留用户 draft/selection，刷新后要求
  显式决策；
- [ ] 补齐 Loading、Empty、Partial、Error、Submitting、Conflict、Recovery、长内容、source unavailable、
  keyboard/focus/accessible-name 和 Day/Night 一致状态。

## Checkpoint 5：自动化、实机与发布验收

- [x] Rust unit/integration/property/migration tests、shared contracts tests、Renderer Vitest、`pnpm test`、
  `pnpm typecheck`、Desktop build/package 与 `git diff --check` 通过；
- [x] 文档 `docs:test`、`docs:check`、带真实 base SHA 的 `docs:check:ci`、ADR generation check 全部通过；
- [ ] 对 Codex、Claude、OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen、Antigravity 各执行 real-model v9
  smoke：exact help、direct effective、Hearth review_pending、conflict read-and-decide、removed command absence；
- [ ] 另建 Skill opportunity qualification：显式高信号、隐式 commitment/handoff/verified lesson、临时项目
  fact/secret/人格推断负例；报告发现率与误写，不宣称确定性；
- [ ] 使用隔离 `userData` 的开发版或打包 App 完成 Day/Night、1040×700、1440×920、2560×1440、200%
  zoom、reduced motion、键盘、长 CJK/emoji、Review conflict 与 Forget closure 验收；
- [ ] 运行敏感内容检查，证明 candidate/body/digest 不进入 logs、events、durable results、Runtime Evidence、
  diagnostics、FTS after terminal 或 exported terminal Review history；
- [ ] 只有全部发布门槛具备可复现证据后，才把版本 `implementation_status` 与本计划 `status` 改为
  `complete`。

## 当前证据与实现缺口

- 已完成：Store v3/v82 migration、Memory Capture Core、Hearth Review IPC/types/Renderer、Transport v9
  十二命令、统一 `memory.write`、operational Skills、qualification/smoke 路径与完整文档路由；
- 已通过：Rust workspace tests（library 417、CLI 11、Core binary 73，另有 3 个显式 manual smoke ignored）、
  Renderer Vitest 328、Node/benchmark 179、`pnpm test`、`pnpm typecheck`、Desktop build/package、Memory smoke、
  `git diff --check`、ADR generation 与使用当时最新 `origin/main` base SHA 的 `docs:check:ci`；
- 尚未完成：九 Runtime 真实模型 v9 matrix、Skill opportunity qualification、完整隔离 App 尺寸/主题/辅助功能
  矩阵，以及覆盖所有并发/回滚组合的补充 property tests；这些缺口使版本继续保持 `in_progress`。
