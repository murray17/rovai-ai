---
document_type: implementation-plan
version: v0.13
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-27
---

# Rovai-ai v0.13 实施计划与验收清单

> 状态：实现与验收完成；编码检查点 7/7
>
> 版本范围：[README.md](README.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 跨版本决策：[ADR-0052](decisions.md#adr-0052) ·
> [ADR-0055](decisions.md#adr-0055)

检查点按依赖顺序排列，每步独立可验收。所有“已完成”状态均有代码、Migration、
隔离测试或可复现验收证据。

## 检查点 0：协议切换

- [x] ADR-0052/0053/0054 状态置 `accepted`。
- [x] ADR-0021/0033 由 ADR-0052 替代。
- [x] ADR-0032/0044 由 ADR-0053 替代。
- [x] ADR-0043/0046 由 ADR-0054 替代。
- [x] ADR-0053/0054 后续由 ADR-0055 替代，切换为无启动弹窗的显式 opt-in。
- [x] 有效 ADR 的规范性引用改指新决策。
- [x] v0.12 冻结为 historical，v0.13 成为唯一 current 版本。

## 编码检查点

### 1. Migration v23 与 Revision 权威

- [x] Migration 前冻结“新库/升级库”事实，完成 v23 后写入 `schema_migration=23`。
- [x] `memory_revision` 增加 `authority_status` 与
  `confirmed_from_revision_id`；历史行回填 `user_confirmed`。
- [x] `memory_proposal` 增加 `resolution_mode` 与
  `resolution_policy_version`；既有 terminal 行回填 `user`。
- [x] 新增 singleton `memory_auto_policy`，包含 `acknowledged_at`；v24 最终统一
  新库与升级库为 disabled+unacknowledged，并关闭旧版 enabled+unacknowledged
  遗留状态而不伪造用户确认。
- [x] Rust/TypeScript contracts 增加 current authority、Revision authority、
  confirmation link、resolution mode、policy config 和 provisional count。
- [x] `memory.confirm` 使用 Memory version + base Revision CAS 创建同正文
  `user_confirmed` Revision；普通 no-op 规则不被放宽。
- [x] direct create/revise、user Proposal accept、policy auto 和迁移四类路径写入正确
  authority。
- [x] Forget 清正文但不留下可恢复副本；authority/link 非正文审计保持合法。

必须测试：

- 新库/升级库 policy 均默认关闭，未 acknowledgement 时只能 pending；
- v21/v22 fixture 升级后所有历史 Revision 为 `user_confirmed`；
- provisional 必须来自合法 policy-auto Proposal；
- same-body 只允许 `memory.confirm`；
- confirm stale/version conflict、重复命令和并发双确认；
- provisional retire/reactivate、forget、supersession 与历史 Revision。

### 2. 实时策略与原子自动形成

- [x] 实现 `memory.autoPolicy.get/set`，设置写入使用 expected-version CAS 和 body-free
  audit；用户保存时由 Core 写 `acknowledgedAt`。
- [x] `memory.propose_change` 在现有 SQLite immediate transaction 中读取 live policy，
  不把策略冻结进 AgentRun。
- [x] 自动矩阵严格为 `add + companion(self) + lesson`。
- [x] 每 Run policy-auto 上限 1；每 Companion active provisional 上限 8；现有每 Run
  Proposal 4 条与 ordinary Scope capacity 同时执行。
- [x] eligible 路径同事务完成 Proposal accepted、Memory、provisional Revision、
  `resolutionMode=policy_auto`、policy version、事件和幂等结果。
- [x] 非自动 Scope/Kind/action、policy off、auto quota/provisional capacity/ordinary
  capacity 不足时返回合法 pending。
- [x] stale/CAS、secret、no-op、duplicate、越权、fenced Run、无效字段保持失败且不保存
  Proposal。
- [x] user accept/reject 路径写 `resolutionMode=user`；逐条接受与批量拒绝不回归。

必须测试：

- Hearth/Relationship/Preference/Agreement/revise 永不 policy-auto；
- Companion owner 只能从绑定 Agent 身份推导；
- 同 Run 并发两条 eligible Proposal 只有一条自动，另一条 pending；
- Companion 并发第 9 条 provisional 只有一条越界路径降级 pending；
- total capacity 与 provisional 子容量交叉边界；
- policy 切换与正在运行 Run：下一次调用立即使用新版本；
- tool-call replay 在 policy 改变后仍返回原 Memory/Revision；
- receipt/event/result 无正文。

### 3. Projection v2、Guide 与 Stewardship Skill v2

- [x] `ProjectedMemoryEntry` 增加 authority；formatter version 递增。
- [x] confirmed/provisional 分区确定性渲染，所有 entry 均有 authority 文本，不只靠
  位置或颜色表达。
- [x] Guide 增加权威顺序、provisional 非权限/非约定语义和双 receipt 说明，不注入
  Memory body。
- [x] `memory-stewardship` 创建新不可变 SkillRevision，逻辑名与 shadow 规则不变。
- [x] Skill 指导 Agent 避免任务状态、repository fact、人格评价和不可信内容指令，
  并按 receipt 区分 pending/effective provisional。
- [x] Projection Wake/Reconcile、UNAVAILABLE sentinel、live read 与 ContextManifest
  digest/formatter 记录适配新格式。

必须测试：

- confirmed 始终先于 provisional，排序和 digest 跨重启稳定；
- Companion 混合权威、Hearth/Relationship confirmed-only；
- provisional body 被引用为数据，Guide/Projection 无用户确认伪称；
- policy-auto 后当前 Run 的后续 live read 可见；
- confirm/retire/forget/undo 后投影正确变化；
- render/rename/permission/disk 故障继续 fail closed；
- Skill enable/disable、project shadow 与 Runtime 不支持 Skill 不改变 Gateway 权限。

### 4. Core API、Receipt 与 Renderer

- [x] contracts/Main allowlist/preload 增加 `memory.autoPolicy.get/set`、
  `memory.confirm`、`memory.autoApply.undo`。
- [x] tool receipt 使用稳定字段区分 pending 与 policy-auto effective，Adapter
  translator 不丢失 `effective/authority/resolutionMode/memoryId/revisionId`。
- [x] 记忆管理页加入全局策略开关、版本冲突、未来生效说明和现有 provisional 导航。
- [x] 新安装与升级库均不展示启动策略弹窗；记忆管理页提供默认关闭的策略、精确
  自动矩阵和主动开启入口。
- [x] 加入 provisional tab/count、权威文本、来源 Agent/Run、30 天复核和容量显示。
- [x] 加入确认、编辑并确认、停止沿用、普通 Forget，以及满足窄前提时的
  “撤销并删除自动记忆”。
- [x] Proposal 历史区分“用户接受”与“策略自动形成”；pending 区仍无批量接受。
- [x] App 订阅 body-free auto-applied event，做会话内聚合轻通知；关闭通知不改领域
  状态，管理页继续可见。
- [x] Settings/AgentProfile/CampMember 文案明确：global policy 是实时自动开关，
  `memory.propose_change` Capability 是按 Run 冻结的提案资格，两者缺一不可。

必须测试：

- Loading/Empty/Error/Busy/version conflict；
- new/upgrade 默认关闭、无 startup/首次 Run onboarding、设置页显式 opt-in；
- policy on/off 文案与既有 provisional 不被静默处理；
- provisional confirm/edit/retire/forget/undo stale；
- session notice 聚合、关闭、跳转和 App 重启；
- status 非纯颜色、键盘/焦点、`aria-live`、Day/Night；
- `1440×920` 与 `1040×700` 无核心操作遮挡。

### 5. Export v2、诊断、恢复与隐私

- [x] Export 升级为 `rovai-memory-export-v2`，包含 Revision authority/confirmation link
  与 Proposal resolution mode/policy version。
- [x] Export 继续排除 forgotten 正文、pending/rejected Proposal 正文，并保留外部副本
  警告。
- [x] Diagnostics 只增加 policy/version、provisional count、policy-auto count 和
  Projection health，不包含正文。
- [x] `memory.autoApply.undo` 只处理仍未变化的原 policy-auto add Memory；复用 Forget
  清除范围但使用独立命令结果和事件。
- [x] App 重启恢复 policy、authority、resolution、provisional counts、review due 与
  Projection health。
- [x] 日志、事件、receipt、command result、diagnostic、telemetry 与测试 snapshot
  做正文/secret 泄漏断言。

必须测试：

- Export v2 confirmed/provisional/confirmation chain；
- policy-auto accepted candidate 与关联 Memory Forget/undo 的同步清除；
- Undo 不删除后来确认、修订、retire、supersede 或 version 已变化的 Memory；
- 已读 Native Session/外部导出的诚实边界文案；
- Secret Filter 覆盖 policy-auto 路径且无匹配片段回显；
- Projection 失败与重启 reconciliation 不改变 SQLite authority。

### 6. 全量回归与真实 App 验收

- [x] Rust 单元/集成/并发/Migration 测试通过。
- [x] TypeScript contract、Renderer 与 Main/Preload 测试通过。
- [x] 四种 Runtime 共用的 signed structured-content bridge 保留新 receipt 字段。
- [x] `pnpm smoke:memory` 与 Rust integration 覆盖 pending、policy-auto、confirm、undo、
  restart。
- [x] `pnpm smoke:core` 与 v0.12 context/search/summary 回归通过。
- [x] 真实 App 完成新库与升级库两条验收路径。
- [x] 真实 Claude/Codex Runtime 各执行一次 bounded auto Lesson Smoke；不重复消耗模型
  验证已由隔离测试覆盖的组合。
- [x] 更新本文件和 README 的编码检查点与验收证据。

### 7. 无打扰的显式 Opt-in

- [x] ADR-0055 替代 ADR-0053/0054 的默认开启 onboarding，保留原有自动矩阵、
  provisional 权威与安全边界。
- [x] Migration v24 关闭 enabled+unacknowledged 遗留策略，保留所有已确认选择；
  新库与升级库最终均默认关闭。
- [x] Renderer 删除启动弹窗及仅为弹窗存在的策略请求、状态和样式。
- [x] 「设置 → 记忆」继续提供全局开启/关闭入口，并明确默认关闭与主动开启语义。
- [x] 成员页继续只管理 `memory.propose_change` 提案资格，不伪装成全局自动策略。
- [x] 数据库测试覆盖新库默认、未确认旧策略迁移和已确认选择保留；App 验收覆盖无
  启动弹窗与设置页显式开启。

最终证据：

- Rust：`cargo test --workspace` 通过 166 项 library 与 33 项 main 测试；4 项既有手工
  Runtime smoke 保持 ignored；`cargo clippy --workspace --all-targets -- -D warnings`
  通过。
- TypeScript：`pnpm typecheck` 与 9 个 test files / 53 项测试通过。
- 隔离 Core：`pnpm smoke:core`、`pnpm smoke:memory` 通过。
- Runtime：Codex 与 Claude Code 均实际调用 `memory.propose_change` 并形成
  `accepted/effective/policy_auto/provisional`；Claude smoke 额外完成重启不重复检查。
  Codex 首次验证在领域状态成功后由 smoke 字段读取错误触发失败，该错误已改为读取
  合同字段 `acceptedMemoryId`，没有重复消耗模型。
- 打包 App：`pnpm package:mac`、`codesign --verify --deep --strict` 与
  `pnpm accept:memory-ui` 通过；验收包含无启动策略弹窗、新库/模拟 v22 升级默认
  关闭、设置页主动开启、新增/修订、停用/恢复、永久遗忘、投影污染恢复、`0600`、
  重启、Day/Night 和无横向溢出。

## 验证命令

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm typecheck
pnpm test
pnpm smoke:core
pnpm smoke:memory
pnpm build:desktop
```

完成标准：只有 Companion Lesson add 可以自动形成 provisional；所有更高风险路径保持
人工逐条确认；authority、resolution、策略版本、Projection、导出和 UI 表达一致；
任何 stale/secret/越权输入都不能借自动路径持久化或生效。
