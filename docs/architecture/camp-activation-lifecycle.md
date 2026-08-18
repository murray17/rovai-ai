---
document_type: architecture
authority: camp-activation-component-boundary
status: accepted
last_updated: 2026-08-09
---

# Camp Activation Lifecycle

## Component authority

| Component | Responsibility |
| --- | --- |
| Electron Main | Stores the one-click preference and saved default member/Lead configuration; it does not store Camp activation or Composer content. |
| Renderer | Chooses `pending` for a valid one-click entry and `active` for the explicit Dialog, renders the returned Camp, autosaves through the existing Core Composer Draft APIs, and commits a Pending restore target only after Navigation proves the Draft meaningful. |
| Core collaboration service | Validates creation structure, persists Camp activation, guards pre-activation mutation/discard, and activates Pending in the accepted first-message transaction. |
| Camp attachment store | Remains the sole authority for structured Composer Draft content, revision and prepared attachments for both Pending and Active Camps. |
| Navigation/Read Model | Hides empty Pending, exposes meaningful Pending with its activation state, and continues to expose every Active Camp. |
| SQLite startup recovery | Removes only Pending rows that still satisfy the empty initial-state predicate after expired Draft cleanup. |

## State flow

```text
one-click entry
  -> camps.create(pending)
  -> Composer autosave
     -> empty: visible workspace only; no Navigation/restore target
     -> meaningful: Navigation draft + eligible restore target
  -> exact Draft Revision send
     -> rejected: Pending + Draft unchanged
     -> accepted transaction: Active + camp.activated + message/turn/run facts

explicit Dialog
  -> camps.create(active)
  -> durable zero-message Camp
```

Renderer leave cleanup is advisory: it requests a guarded discard but never deletes a row or attachment directory
directly. Core re-reads activation, Draft body, prepared attachments, version and domain facts in the delete transaction.
Startup applies the same authority after attachment expiry cleanup, covering crashes and forced window termination.

## Invariants

- A Pending Camp cannot have an accepted public message; the first accepted message sets Active in the same transaction.
- Active never transitions back to Pending.
- A meaningful Pending Draft is durable even when no Renderer is running.
- An empty Pending is not a stable navigation or restore fact.
- Existing Conversation allocation remains lazy and happens only when later execution targets a member.

## References

- [Camp 生命周期不变量](foundational-invariants.md#camp-lifecycle)
- [Pending Camp Activation v1](../contracts/pending-camp-activation-v1.md)
