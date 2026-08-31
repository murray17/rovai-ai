---
document_type: contract
name: Camp Open Projection
version: v10
status: accepted
source_version: v1.34
last_updated: 2026-08-31
---

# Camp Open Projection v10

v10 replaces [v9](camp-open-projection-v9.md). `CampOpenProjection.schemaVersion` becomes **6**;
the full `CampSnapshot.schemaVersion` remains **34**. Contract version v10 and wire schema 6 are
separate version sequences. Core and Desktop readers must be updated together; an old open schema
is rejected rather than interpreted as an empty conversation.

## Business projection read boundary

`camps.open` and `ReadModelService::camp_open_projection()` must not read `event_log`, including
through nested loaders, CTEs or views. The same projection builder is used after `camps.enter`
reconciliation; this restriction does not remove that command's existing reconciliation or receipts.

One SQLite read transaction obtains current Camp business projections and reads
`event_sequence.last_sequence WHERE singleton = 1` as `throughGlobalSequence`. The watermark,
selection generation, invalidation subscription and non-regressing refresh fence remain unchanged.
No event replay is used to reconstruct a Camp or its messages.

Changes to the open wire shape:

- Remove `timeline` and `coverage.timeline` entirely; they are not empty audit-history promises.
- Remove the timeline exact-count query from open coverage.
- Every open message has `timelineGlobalSequence: null`. Its Camp-local `sequence`, current
  rendered content, reply identity, recipient presentation and attachments remain unchanged.
- A dedicated open-message loader reads non-tombstoned `camp_message` rows and uses the existing
  message hydration. It must not calculate publication event sequences.

Other collections and their coverage remain as in v9: Camp, members and membership reconciliation,
Tasks, messages, deliveries, turns, AgentRuns, complete non-terminal Evidence, pending approvals and
completed Run file-change summaries. Existing windows remain unchanged, including the most recent
20 messages. Older messages are still available through explicit history pages; open does not return
all historical messages at once. Member Fast remains an optional cached projection.

## Presentation and retained history

The Renderer may adapt open schema 6 into its existing surface Snapshot by setting `timeline: []`.
Previously loaded earlier messages remain merged by stable message identity and Camp-local sequence;
their historical event sequence must not influence UI ordering. Full Snapshot and explicit history,
find and diagnostic APIs keep their existing publication-sequence behavior.

Conversation ordering uses business data. Messages retain `message.sequence` order; cards use their
business timestamp, explicit kind order (message, Task, Stop, file changes) and stable ID. The two
ordered streams are merged by timestamp. If the wall clock moves backwards, preserving message
sequence takes precedence over a perfectly chronological mixed stream. A conditional mixed sort
comparator must not introduce ordering cycles. Completed file-change cards retain their existing
placement after the last public message from the source Run. Rendering rules and reading position
are owned by the [Camp workspace](../ui/components/conversation-workspace.md).

Task details retain Task-owned responsibility, status reasons and timestamps. The optional audit
`cause` inferred from event history is no longer displayed. No replacement business field is added.

## Public A2A 投递来源

`MessageDeliveryView.public_a2a.sourceAgentRunId` remains the optional causal sender projected from
`message_delivery.source_agent_run_id`, independently of the loaded message window. It is not the
target, target parent or return-to Run. Forward, return and gather-captured deliveries preserve this
distinction; the `gather_completion` branch does not expose a public sender field. Missing source
identity is not inferred from replies or target lineage.

## Compatibility and verification

This change adds no SQLite schema migration, historical scan, backfill, index or data rewrite.
Legacy events with null `camp_id` and non-null `task_id` do not affect opening their Camp: current
Task, message and Run state comes from business tables. `event_log` continues to support command
idempotency, audit, invalidation subscriptions, navigation and diagnostic readers.

The SQL boundary is verified with a SQLite authorizer denying all reads of `event_log`. A populated
Camp must still return messages, attachments, Tasks, turns, Runs, deliveries, approvals, file changes
and active Evidence. A scale regression keeps that business state fixed while adding 50,000,
500,000 and 5,000,000 unrelated events: projection content and SQLite VM work stay unchanged while
`throughGlobalSequence` advances. Wall-clock timings are reported, not used as a flaky absolute gate.
