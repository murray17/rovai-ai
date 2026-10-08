---
document_type: protocol-contract
contract: planned-shutdown-v8
authority: local-input-and-supervised-core-task-settlement
status: accepted
version: 8
source_version: v1.60
last_updated: 2026-10-08
---

# Planned Shutdown v8

v8 inherits [v7](planned-shutdown-v7.md)'s protocol 3 wire, durable cancel-all transaction, ten-second hard deadline,
writer fences and Renderer preparation. It replaces two local lifecycle details.

Public Composer content is already saved by the Desktop-local per-Camp store in
[Camp Composer Draft v15](camp-composer-draft-v15.md). Renderer preparation still flushes an in-progress Lexical,
quote, attachment or send operation before teardown, but it neither writes a Core Draft nor discards an already saved
local snapshot. Refresh, window recreation and ordinary restart may restore that local snapshot; no other client can
read or merge it.

The AgentRun Scheduler and the event/deadline workers are owned by `run_core`'s shutdown supervisor. The legacy
500ms maintenance loop and its registration are removed. Normal shutdown signals and waits for the Scheduler and
the complete worker set. If launch handoff exceeds its grace, the supervisor aborts and awaits these owners before
considering writer fences quiesced. Non-batch preparation, Runtime cleanup and its follow-up projection, and
Mission/Camp cleanup use Core's existing tracked task set. Cancelling a coordinator cannot detach these writers or
leave slow preparation running behind an already emitted shutdown report. Unexpected worker exit triggers Core cleanup.

