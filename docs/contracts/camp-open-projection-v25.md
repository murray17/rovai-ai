---
document_type: protocol-contract
contract: camp-open-projection-v25
authority: camp-open-member-creation-receipts
status: accepted
version: 25
source_version: v1.72
last_updated: 2026-10-08
---

# Camp Open Projection v25

Inherits [v24](camp-open-projection-v24.md), including Open schema 8, bounded Run/message windows, Run input summary,
empty Execution Evidence, independent watermarks and zero-write reads. Adds `memberCreations` to both Snapshot and Open.
Older projections without this additive field render no joined cards.

[Member Creation Flow v1](member-creation-flow-v1.md) owns receipt fields, immutability, transaction, retention and
invalidation. The read selects only the requested Thread's indexed `member_creation` rows, in `(created_at, creation_id)`
order, without profile joins, event-log reconstruction or filesystem access. Receipt count follows that Thread's successful
AI creations and does not expand message, Run or Evidence windows. Unrelated Threads' history cannot increase this read's
scan range. Existing Snapshot/Open schema numbers and model-facing tool responses remain unchanged.

## Message model display projection

`ThreadMessageView.runtimeModel` is additive and optional for older responses. Snapshot, Open, earlier pages and
around-message reads hydrate it from the message's `sourceAgentRunId`, independently of the bounded Run window.
It is null for non-Agent messages, missing/invalid frozen selections or an unavailable source Run. The join checks
both Thread identity (including legacy Turn ownership) and the source conversation's Agent identity.

The object contains only `adapterKind`, nullable `modelId` and nullable `reasoningEffort`. Adapter and explicit model
come from `agent_run.runtime_adapter_kind` and `runtime_model_selection_json`; the effort is the frozen string option
`effort` for Claude Code or `reasoning_effort` for other adapters. For `source = runtime_default`, only the existing
`runtime_observed_model_id` can provide a concrete model; otherwise `modelId` stays null. Missing effort stays null.
Do not project arbitrary options, permissions, credentials, or current AgentProfile values.

Hydration is a single indexed lookup from the requested message IDs inside the existing read transaction. It does not
scan Run history, read event/evidence tables, create new storage, or modify model-facing Built-in history responses.
Existing schema numbers remain unchanged; older clients ignore this field and newer clients label missing metadata
as unrecorded. Catalogs may supply display labels for the frozen IDs, never replacement selections.


## 终态文本定稿的唤醒

继承 v20 的 buffer、失败退避、幂等与进程内恢复限制；原 `process_agent_run_maintenance` 500ms tick
由最早 `retry_not_before` 的一次性提醒替代。无失败不设 timer，成功移除，重试只调用原文本路径，
不重放已提交的业务事务。当前详细合同见 [Run Process Detail Surface v45](run-process-detail-surface-v45.md#终态文本定稿重试)。
