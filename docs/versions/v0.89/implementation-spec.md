---
document_type: implementation-spec
version: v0.89
authority: version-implementation-specification
status: accepted
last_updated: 2026-08-16
---

# v0.89 Gather canonical 实现规格

本文冻结 v0.89 实施必须组合满足的产品语义；长期字段合同见 [Gather v1](../../contracts/gather-v1.md)、
[Message Delivery v3](../../contracts/message-delivery-v3.md)、[Camp Message Send v8](../../contracts/camp-message-send-v8.md)、
[Built-in Tool Transport v13](../../contracts/builtin-tool-transport-v13.md)与
[ContextManifest Evidence v13](../../contracts/context-manifest-evidence-v13.md)。

## 1. 接受

- canonical operation 为 `team.gather`，CLI 为 `rovai gather`；只有调用时当前 Default Lead 可成功调用；
- closed input 是 `{to:string[], body:string}`；body trim 后非空且不超过 32 KiB；寻址沿用 Send v8 的
  canonical token、line-leading display-name alias、严格 offender 与 canonical byte-order dedupe；
- effective recipient 必须为 1..16，禁止 self、非直属 ancestor、非当前有效成员与 depth overflow；
- 一次 immediate transaction 原子创建一个 CampMessage、GatherRecord、N 个 GatherItem、N 条
  `public_a2a/dispatch/optional` forward Delivery，并预留 N+1 Run responsibility；
- success 只表示 accepted，返回 gatherId、requestMessageId、campTurnId、effectiveRecipients、
  dispatchDeliveryIds 与 `completion=deferred`。Lead 应结束当前 Run，不 polling 或重复调用。

## 2. Capture 与 Item

- source Run 必须等于 collecting GatherItem 当前 `targetAgentRunId`，其 trigger generation 必须等于 Item
  active generation，且 recipient 必须等于冻结 initiator；只有这种精确 return Delivery 才是 capture；
- captured Delivery 保留真实 CampMessage、Structured Mention、reply 与 receipt，消耗 accepted A2A；它以
  `gather_captured` disposition 直接 settled，不建立 attempt/Context/Lead Run，也不消耗新 Run responsibility；
- 显式 return 不关闭 Item；Delivery 尚未 materialize 时由 failed/cancelled/interrupted terminal 关闭；
  materialize 后只由 current member Run succeeded/failed/cancelled 关闭；
- successful member Run 若没有 captured return，保存最多 2 KiB UTF-8 scalar-safe final output fallback，并保留
  full digest/original bytes/truncated；错误只保留 allowlisted code/source/reason。

## 3. Barrier 与 Completion

- 每个能改变 Item terminal 性质的事务都调用同一 Barrier helper；
- collecting Gather 的最后一个 Item 终态时，同一事务验证 Turn/initiator，冻结 message high-water 与完整
  `gather_completed` snapshot，CAS 标记 ready，并创建唯一 `gather_completion/dispatch/required` Delivery；
- Barrier 不 spawn Run。Completion 使用原 initiator Agent 与 Conversation、普通 recipient FIFO、attempt fence、
  target busy/Runtime/capacity wait、Context gate与显式 pre-materialization retry；
- materialization 原子单写 completionRunId，Run 的 invocation kind 是 `gather_completion`、A2A lineage null/depth0、
  trigger message/delivery 分别为 requestMessageId/completionDeliveryId；
- Completion Run succeeded/failed 分别关闭 Gather 为 completed/completion_failed；取消不重开 Items。

## 4. Mandatory Current Input

冻结输入至少包含 gatherId、commandId、requestMessageId，以及每个 canonical Item 的 recipientAgentId、
dispatchDeliveryId、nullable targetAgentRunId、terminal status/source、ordered captured public message refs/excerpts、
nullable fallback 与 nullable safe error。每条 excerpt 最多 1 KiB，每 Item fallback 最多 2 KiB，serialized canonical
snapshot 最大 48 KiB；metadata、Item 与 refs 不得静默省略。

Formatter v15 把该 payload 放在最后的 mandatory `[CURRENT_INPUT]`，普通历史先被 evict；Manifest v13 冻结
schema version、input digest/bytes、Gather/item/ref evidence 与 exact Dynamic Context bytes。recovery 复用冻结 bytes，
不按当前 Lead、Session、历史或 Gather 行重建。

## 5. Retry、取消与预算

- forward retry 复用 dispatchDeliveryId/GatherItem，递增 generation、清除当前 target pointer，保留历史
  attempt/Run；collecting 以外拒绝；
- completion Delivery 仅在没有 completionRunId 时允许 retry；
- User Stop/Camp 关闭/initiator leave 原子取消 Gather 与 pending completion，不创建替代项；Default Lead 更换
  不取消、不转交；
- `accepted_a2a_allocated` 与 `agent_run_responsibilities_allocated` 独立单调：Gather forward 1/1、普通 return
  1/1、captured return 1/0、completion 0/1（接受时已预留）；
- Gather forward 的 Delivery/Run completionRole 都是 optional，completion Delivery/Run 是 required；Barrier 与
  CampTurn recompute 同事务，不能出现 Items terminal 而 required completion 尚未存在的可见空窗。

## 6. 发布与非目标

Transport v13 固定 15 commands/capability；CLI help、catalog、Evidence、Session Charter、health/benchmark
fingerprint 与十 Product Runtime smoke 同步。只更新 `skills/cli-operations/**`。本版本不增加 Gather UI、私有
message、status/cancel CLI、quorum/timeout、per-recipient body、Task/attachment 或任何自然语言归属判断。
