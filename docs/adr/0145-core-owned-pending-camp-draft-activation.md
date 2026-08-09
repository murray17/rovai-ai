---
document_type: adr
id: ADR-0145
title: Core-Owned Pending Camp Draft Activation
status: accepted
date: 2026-08-09
decision_scope: cross-version
source_version: v0.49
supersedes: []
superseded_by: null
---

# ADR-0145: Core-Owned Pending Camp Draft Activation

## Context

ADR-0071 makes an explicitly created empty Camp a durable collaboration aggregate. ADR-0080 and ADR-0128 make the
Camp Composer Draft Core-owned and require an exact stored Draft Revision for user message submission. Those rules
remain correct for the explicit creation Dialog, but a one-click entry should behave like a new-conversation draft:
opening it must not immediately add an empty formal Camp to navigation or replace the last stable restore target.

A Renderer-only draft cannot satisfy this behavior. It would have no stable Camp identity for the existing Composer
Draft and attachment stores, and sequential “create Camp, then save draft, then send” would reintroduce partial states
at the first-message boundary.

## Decision

Camp has a Core-owned `pending | active` activation state. Existing Camps, omitted creation-state inputs, and the
explicit creation Dialog use `active`; only confirmed one-click creation requests `pending`.

A Pending Camp is a private new-conversation aggregate with its selected workspace, members, Lead and Composer Draft:

- creating it does not emit `camp.created` and an empty Pending Camp is absent from Navigation and Camp history lists;
- a Pending Camp whose authoritative Composer Draft has non-whitespace content or prepared attachments appears in
  Navigation with activation state `pending`, and Renderer labels it “草稿”;
- only Composer Draft/attachment mutation, guarded discard, and the first user-message submission are admitted before
  activation; ordinary Camp configuration and Task mutation require an Active Camp;
- a Pending Camp becomes Active in the same SQLite transaction that accepts and persists its first user message.
  That transaction emits `camp.activated` before the normal message event. Any validation, version, addressing,
  Runtime preflight, or persistence rejection leaves both the Pending state and exact Draft unchanged;
- discard is idempotent and can delete only a Pending Camp with no meaningful Draft, public message, execution,
  Task, Conversation, or other domain fact. It can never delete an Active Camp. Startup performs the same guarded
  cleanup for abandoned empty Pending Camps;
- a meaningful Pending Draft is a restorable Camp location. An empty Pending Camp is not a stable Restorable Location;
  leaving it discards it, while process interruption is repaired by startup cleanup.

Activation does not pre-create Agent Conversations. ADR-0071's lazy per-target Conversation allocation and
ADR-0128's exact Core-owned Draft Revision submission remain unchanged. The explicit creation Dialog also keeps the
ADR-0071 behavior that a user-confirmed zero-message Active Camp is durable until explicit deletion.

## Consequences

- One-click entry can open a fully functional Composer immediately without creating visible empty Camp history.
- Non-empty unsent content and attachments survive Renderer reload and application restart under Core authority.
- First-message activation, generated title, message persistence, attachment consumption, CampTurn creation, and
  AgentRun admission share one transaction and cannot expose a half-activated Camp.
- Navigation and Camp Snapshot contracts expose activation state, and SQLite Migration 67 defaults all existing rows
  to `active`.
- Pending cleanup requires a narrow Core command and startup reconciliation; Renderer disappearance alone is never
  treated as proof that deletion is safe.

## Rejected Alternatives

- Keep the entire draft only in Renderer memory: rejected because it loses restart durability and duplicates the
  authoritative Composer Draft.
- Create an ordinary Active Camp and merely hide it until input: rejected because the formal Camp and restore/audit
  facts would already exist despite the product promise.
- Create the Camp only when Send is clicked: rejected because attachments and autosaved structured content already
  require a stable Core Camp identity.
- Activate when the first character is typed: rejected because unsent content must remain distinguishable and
  discardable as a draft.

## References

- [ADR-0071: Configured Camp Creation and Lazy Conversations](0071-configured-camp-creation-and-lazy-conversations.md)
- [ADR-0080: Durable Camp Composer Draft and Atomic Attachment Consumption](0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md)
- [ADR-0128: Structured Draft-Only User Camp Message Submission](0128-structured-draft-only-user-message-submission.md)
- [v0.49 production design](../versions/v0.49/production-design.md)
