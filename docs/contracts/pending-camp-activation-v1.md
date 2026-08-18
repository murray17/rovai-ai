---
document_type: protocol-contract
contract: pending-camp-activation-v1
authority: camp-creation-activation-and-draft-navigation
status: accepted
version: 1
last_updated: 2026-08-09
---

# Pending Camp Activation v1 Contract

## 1. Creation

`camps.create` accepts `activationState: "pending" | "active"` together with the existing name, workspace,
membership, Lead and collaboration-mode fields. Omitted activation state is interpreted as `active` for backward
compatibility. The explicit creation Dialog sends `active`; a confirmed one-click entry sends `pending`.

Both states atomically create the Camp row and Initial Camp Membership. Active creation returns `camp.created` and
emits the existing event. Pending creation returns `camp.pending_created`, exposes the Camp ID to its Renderer
Composer, and does not emit `camp.created`.

## 2. Read models

Camp Snapshot schema v26 adds:

```ts
camp.activationState: "pending" | "active"
```

Navigation Snapshot/Page schema v3 adds the same field to every Camp item. Active Camps are listed normally. Pending
Camps are listed only when the authoritative `camp_composer_draft.body` contains non-whitespace content or at least
one `prepared_attachment` exists. General Camp history lists exclude Pending Camps.

## 3. First-message activation

User message submission retains ADR-0128's `campId + exact draftRevision` input. After all validation and execution
preflight succeeds, the existing message transaction sets `activation_state = active`, appends `camp.activated`, and
then persists the normal message/turn/run facts. Any rejection or transaction rollback leaves activation state,
Composer Draft, attachments and Draft Revision unchanged.

Pending Camps reject ordinary Camp configuration and Task mutation with
`camp.pending_activation_required`. Composer Draft/attachment operations and the first user-message submission remain
available. Agent-authored sends cannot originate from Pending because no AgentRun is admitted before activation.

## 4. Guarded discard

`camps.discardPending` is a user command with:

```json
{"commandId":"…","command":{"campId":"…"}}
```

It is idempotent for an absent Camp. It rejects an Active Camp with `camp.pending_discard_active` and a meaningful or
domain-mutated Pending Camp with `camp.pending_not_empty`. It may delete only a Pending Camp with initial version,
zero messages, no non-command-result domain event, no non-whitespace Draft body, and no prepared attachment. Startup
cleanup applies the same predicate directly before Renderer startup. Physical Camp attachment storage is removed only
after the database deletion succeeds.

## References

- [ADR-0145](../versions/v0.49/decisions.md#adr-0145)
- [ADR-0080](../versions/v0.25/decisions.md#adr-0080)
- [ADR-0128](../versions/v0.43/decisions.md#adr-0128)
