---
document_type: protocol-contract
contract: pending-camp-activation-v4
authority: camp-creation-activation-and-client-local-first-input
status: accepted
version: 4
source_version: v1.72
last_updated: 2026-10-03
---

# Pending Camp Activation v4

Inherits [v3](pending-camp-activation-v3.md)'s creation, mutation guards and first accepted message's atomic
activation/publication/delivery transaction. Public names follow [Thread Naming v1](thread-naming-v1.md).
Ordinary one-click drafts now survive switching, Renderer refresh, window recreation and ordinary App restart on
their originating client. Each click creates an independent Thread ID; a project may contain multiple unsent drafts.

## Local content and Core retention

The client saves the complete per-Thread snapshot described by [Composer Draft v16](camp-composer-draft-v16.md).
Core stores only `(threadId, verified client identity)` presence in `pending_camp_draft_presence`, never body,
quotes or source paths. Nonblank body, at least one attachment/quote, or reply intent means present. Empty input and
continuation alone do not. Client identity comes from the authenticated Host transport, never request parameters.

`threads.pendingDraft.setPresence({ threadId, present: boolean })` returns `{ changed: boolean }`. The closed request
requires an existing Pending Thread outside deletion; otherwise it rejects with `camp.pending_draft_unavailable`.
It idempotently inserts/removes only that client's marker and emits ordinary group navigation invalidation after a
changed commit. It is local editor metadata, not a public message or model context. The Composer serializes writes,
saves its local snapshot first, then awaits marker acknowledgement before considering the edit saved. Same-presence
edits need no additional RPC after acknowledgement. Storage/RPC failures retain the edit and remain retryable;
the existing navigation leave guard waits for pending saves and does not leave on failure.

Navigation group totals, pages and thread reads include Active Threads plus Pending Threads marked for the requesting
client. Desktop exact-ID lookup uses Desktop presence. Empty Pending Threads stay hidden. A saved draft can be selected
after restart; this does not change the separate Main Window Session contract that only Active Threads are automatic
restorable locations. Draft edits do not advance conversation recency. There is no cross-device content sync or merge.

## Activation, clearing and cleanup

Clearing all meaningful input saves the empty snapshot and removes the caller's presence; successful guarded discard
also clears that client's local snapshot. `threads.discardPending` and startup cleanup reject/retain a Thread while
**any** client marker exists, in addition to the existing untouched-empty checks. Clearing one client cannot remove
another client's protection. Core never infers emptiness by opening a client's local store.

The first accepted send clears every marker in the same SQLite activation transaction. Rollback preserves all markers;
failure retains local input. The accepted response replaces the sent local snapshot even if the Active read projection
has not arrived yet. Thread deletion cascades marker removal and retains the existing local cleanup behavior.

Migration 183 additively upgrades admitted v1.72/schema 132 to schema 133, with marker table and activation trigger
committed together. Existing profiles, messages, Thread IDs and source files remain intact. It does not recreate the
Core Draft/revision/lease tables retired by Migration 163 or recover previously lost unsaved input.

## AI member creation

[Member Creation Flow v1](member-creation-flow-v1.md)'s special entry retains its v3 window-local overlay and lifetime.
Its in-memory drafts do not write local snapshots or Core presence. First accepted send still uses the shared activation
transaction. Single Chat's private Draft/Pending contract remains independent.
