---
document_type: implementation-plan
version: v0.44
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-07
---

# v0.44 实施与验收计划

> 本计划已完成。自动门禁、真实 Runtime smoke、Migration、打包与相关 Desktop UI 验收证据
> 汇总在本文末尾。

## Checkpoint 1：架构与合同

- [x] 接受 ADR-0129，完整替代 ADR-0050 并记录对其他有效 ADR 的局部替代；
- [x] 冻结 Context Delivery Profile v1 的三个参数、Unicode scalar 计量和确定性算法；
- [x] 冻结 Current Input 溢出、ACK 边界、Member Call origin、omission 和工具读取语义；
- [x] 更新当前版本指针、领域术语与 Renderer UI 规范；
- [x] 升级 AgentRun Context Formatter、ContextManifest 与 Native Binding context contract；
- [x] 增加 Rust/TypeScript 共用的 v0.44 Context fixture。

补充稳定协作状态修订：Formatter v10 移除 `COLLABORATION_STATE` 中的瞬时可用性、忙碌原因、
`changes` 和当前 Turn 参与者提示；Core 只投影稳定团队身份，`team.call_member` 在调用接受
时重新执行可用性与权限判定。Migration v60 fail closed 旧合同下的非终态 Run 并轮换既有
Native Session，终态 Formatter v8/v9 Manifest 继续作为不可变审计证据保留。

## Checkpoint 2：Context Delivery Profile 与 Manifest

- [x] 建立应用内置、不可变的 `ContextDeliveryProfile` 解析边界；Formatter 不含 v1 数字字面量；
- [x] Profile version 与 Formatter version 分离，并对未知/非法 Profile fail closed；
- [x] ContextManifest 冻结 Profile version、resolved snapshot/digest、previous/current boundary、
  origin ref、ordered recent refs 与 optional omission envelope；
- [x] 删除 `camp_summary_ids_json`、`coverage_baseline_sequence` 及 Summary coverage 证明；
- [x] recovery 只读取冻结 payload，不以当前 Profile、消息或 Runtime cap 重建选择；
- [x] Read Model/Audit 正确区分 Manifest boundary、accepted boundary 与工具 Fence。

## Checkpoint 3：确定性原始消息窗口

- [x] 从 `(previous, current]` 加载未 tombstone CampMessage，并只排除当前用户触发消息；
- [x] 选择最新 15 条后按 sequence 升序输出，不补回复祖先、Mention、附件邻域或发送者关系；
- [x] 单条正文保留前 2,000 Unicode scalar，不追加省略号；
- [x] 正确返回 `bodyLength`、`bodyTruncated` 与 `nextBodyOffset`；
- [x] origin 优先占 24,000 scalar 正文预算，recent 超限时从最旧开始整条移除；
- [x] Runtime 总载荷超限时继续移除最旧 recent，并同步更新 omission；
- [x] recent 清空后仍超限则 terminal fail `context_payload_too_large`，不创建 ACK 或 context wait；
- [x] 保留公共附件路径/内容 digest、发送者和 `replyToMessageId`，但它们不参与正文预算或消息补全。

## Checkpoint 4：Member Call originating public user message

- [x] Core 沿 `a2a_parent_agent_run_id` / root lineage 解析最初直接用户触发 CampMessage；
- [x] nested Member Call 继承同一 origin，模型 payload/Call schema 不接受 origin 字段；
- [x] origin 不占 recent 条数、参与正文预算，并按 message ID 与 recent 去重；
- [x] origin tombstone 实时过滤且不通过 omission 泄漏；
- [x] lineage 缺失、跨 Camp、环或不一致 fail closed；
- [x] `replyToMessageId` 只保留公开 CampMessage 直接回复语义。

## Checkpoint 5：Accepted Public Context Boundary

- [x] 将 `native_read_through_camp_message_sequence` 语义和命名收敛为当前 Binding 的
  Accepted Public Context Boundary；
- [x] ACK 事务按 binding ID/generation fencing 单调推进到 Manifest current boundary；
- [x] ACK 后 Run 失败/取消不回退，未 ACK、delivery unknown 和旧 generation 不误推进；
- [x] 新 Native Session 的 effective previous boundary 为 0；
- [x] 边界不进入模型可见 Shared Conversation，也不成为 `camp.search/read` 的读取下界；
- [x] 同一 Manifest 重试保持字节一致，unknown delivery 继续先对账再决定恢复。

## Checkpoint 6：删除 Summary 系统与数据

- [x] 删除 Segment/Epoch Summary 类型、选择、格式化、digest、coverage 与 repository/query；
- [x] 删除 `camp_summary`、`camp_summary_frontier`、`context_compaction_attempt`、
  `context_compaction_waiter`、`context_summary_config` 及专用索引；
- [x] 删除摘要调度循环、生成服务、专用 Runtime completion、重试、lease 与 Camp blocker；
- [x] 删除 Read Model 的 compaction 状态、积压/watermark、Summary 失败与等待投影；
- [x] 删除 `context_compaction`、`context_overloaded` 及其他无恢复路径的 context wait；
- [x] clean-break Migration 明确收敛旧非终态 context wait/input、使旧 Binding 失效；
- [x] 保留原始 CampMessage、终态 ContextManifest Blob 与非 Summary 审计事实。

## Checkpoint 7：删除摘要模型配置与成员高级设置

- [x] 删除 `ContextSummaryModelConfig`、Preference、get/update service 与模型回退解析；
- [x] 删除 Renderer、Preload、Electron Main、Core Client 的 `context.summaryModel.*` 链路；
- [x] 删除 `MemberAdvancedSettings`、`SummaryModelSettings.tsx` 及其测试；
- [x] 删除“高级设置”展开入口、“对话压缩模型”与相关 state/import/CSS；
- [x] 队员详情顺序收敛为身份 → Presence → 运行配置 → Memory Capability → 危险区；
- [x] 完整保留 Member Runtime Configuration、模型参数、推理强度、权限与 sandbox 编辑；
- [x] 不新增空的高级入口或独立上下文设置页。

## Checkpoint 8：自动测试与静态门禁

- [x] Profile 解析、未知版本、不变量与 canonical digest；
- [x] 0/1/15/16 条候选、24,000 scalar 边界、多字节 Unicode 和超长单消息；
- [x] origin root/nested/dedupe/tombstone/corrupt-lineage；
- [x] omission count/range、sequence 间隙、仅 body truncated 不输出 omission；
- [x] ACK/unknown/retry/rebind/restart/terminal-after-ACK 并发矩阵；
- [x] `camp.search/read` 已投递、已省略、Fence 后与 tombstone 回归；
- [x] 用户与 Member Call Current Input 完整性和 `context_payload_too_large`；
- [x] 附件路径、reply tree、Member Runtime 参数与 ContextManifest recovery 回归；
- [x] 静态扫描 Summary 表、类型、API、文案、Job、wait reason 与 UI class 为零；
- [x] `cargo fmt --all -- --check`；
- [x] `cargo test --workspace`；
- [x] `cargo clippy --workspace --all-targets -- -D warnings`；
- [x] `pnpm typecheck`；
- [x] `pnpm test`；
- [x] `pnpm build:desktop`；
- [x] `git diff --check`。

## Checkpoint 9：真实验收与完成条件

- [x] Codex 与 OpenCode Runtime smoke 联合验证独立 AgentRun、Native identity 与恢复边界；
- [x] 新 Native Session 的 previous boundary 归零与有界最近窗口由 Core 集成测试验证；
- [x] Member Call nested lineage 验证完整 Call 与 originating user message 继承；
- [x] 超长当前输入验证明确失败、消息保留、零 Manifest/ACK/Runtime dispatch；
- [x] 打包 App 验证成员高级入口和摘要文案消失，Runtime 参数完整保留；
- [x] Core restart 验证 Manifest byte-identical recovery 与 accepted boundary 不漂移；
- [x] 全部自动门禁与 Runtime/打包验收完成，v0.44 标记为 complete。

## 验收证据（2026-08-07）

- Rust：`cargo test --workspace` 通过 284 个库测试、2 个 CLI 测试与 46 个 Main 测试；
  3 个仅供手工调用的 provider smoke 保持 ignored。`cargo fmt` 与严格 Clippy 通过。
- Desktop：`pnpm typecheck`、174 个 Vitest、78 个 Node 测试和 production build 通过。
- Runtime：Core 与 Member Config smoke 通过；双 Codex AgentRun 在两个独立 host/thread/turn
  上并发完成；OpenCode recovery 保持同一 ContextManifest 且重启无重复副作用。
- Packaging：`pnpm package:mac` 生成 arm64 App；App、Core 与 CLI 严格 codesign 校验通过，
  打包二进制 UUID 与本次 release 构建一致。
- UI：打包 App 的 Member Lifecycle 与 Member Avatar 验收通过；前者明确验证
  `summaryModelAdvancedSettingsRemoved` 与 Member Runtime Parameters 保存/清除/dirty guard。
