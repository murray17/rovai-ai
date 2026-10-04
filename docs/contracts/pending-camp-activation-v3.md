---
document_type: protocol-contract
contract: pending-camp-activation-v3
authority: camp-creation-activation-and-renderer-local-first-input
status: accepted
version: 3
source_version: v1.72
last_updated: 2026-10-02
---

# Pending Camp Activation v3

Inherits [v2](pending-camp-activation-v2.md): pending creation, first accepted send's atomic activation/message/delivery
transaction, mutation guards and guarded empty discard/startup cleanup. Public names follow
[Thread Naming v1](thread-naming-v1.md). Core navigation still excludes every pending Thread.

## AI member-creation draft overlay

[Member Creation Flow v1](member-creation-flow-v1.md) adds one Renderer-window exception to v2's switching behavior.
The root conversation controller retains that flow's unsent Composer snapshot and pending Thread identity in memory.
An empty draft has no sidebar row. Nonblank body, attachments, quotes or reply intent adds a local quick-chat row with
a draft badge; removing all input hides it again. Repeated Add always starts a fresh draft. Selecting a prior local row
restores its input in the same window. Core navigation totals and saved restorable locations are not changed by this overlay.

The first accepted send removes the local overlay and uses ordinary active navigation. A rejected/failed send keeps the
snapshot and pending state. Successful guarded discard or Thread deletion drops the local entry. Refresh, window close,
App exit or another device does not restore it: no localStorage, Core draft table or durable recovery contract is added.
Ordinary pending conversations retain their existing switching behavior.
