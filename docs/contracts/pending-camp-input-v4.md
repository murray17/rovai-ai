---
document_type: interface-contract
contract: pending-camp-input
version: 4
status: accepted
authority: pending-input-return-to-composer
last_updated: 2026-09-12
---

# Pending Camp Input v4

Inherits [v3](pending-camp-input-v3.md) publication, FIFO, source refs, repair, submission outcomes and command
idempotency. Desktop editing now withdraws an input into the ordinary Composer Draft.

## Return to Composer

`camp.pendingInputs.edit` accepts a new action:

```ts
{ type: 'return_to_composer', expectedDraftRevision: number }
```

The existing envelope requires local User authority, matching Camp, `pendingInputId` and `expectedRevision`.
If the selected input has a legacy edit session, its current `editToken` is required. Other inputs' sessions do not
prevent withdrawal. Only `queued | needs_repair` inputs may return; a published/cancelled or revised input rejects
with `pending_input.changed`. A changed Draft rejects with `draft_changed`. Neither rejection mutates either owner.

One Core transaction checks both revisions, overwrites the ordinary Draft with the canonical Pending document,
ordered source refs, Reply/recipient-repair intent and immutable quotes, advances Draft revision, marks the Pending
row `cancelled`, increments its revision and removes its edit session. The old Draft, quotes/trash and legacy Prepared
attachments are replaced; source files are never moved or removed. Detached legacy files are cleaned after commit.
Materialized Member Atoms retain their identities; prior Draft continuation state is cleared and the restored route
is treated as explicitly chosen. Withdrawal permits unavailable attachments/recipients so the user can repair them.
Legacy unsaved working text/refs are not silently committed.

The durable result is `pending_input.returned_to_composer` with `{ pendingInputId, draftRevision }`.
Command replay returns this result without restoring again or overwriting subsequent Draft work. Submission outcome
for the old Pending ID is `cancelled`, which retires its execution auto-focus intent.

The publication transaction rechecks the same row/revision/FIFO head. A sender that selected the old head before
withdrawal cannot publish it afterward. If publication commits first, withdrawal rejects and preserves the current
Composer. Following terminal settlement, Scheduler takes the first remaining queue item; ordinary Draft editing
has no queue reservation or publication eligibility.

## Renderer ownership

Desktop locks the ordinary Composer synchronously, settles attachment preparation and flushes existing text through
Draft Mutation Coordinator before requesting withdrawal at its latest revision. The user explicitly chooses to replace
current input content; there is no save/cancel editor or reserved queue position. On success the coordinator reloads
the complete Draft and replaces Lexical content, then focuses the ordinary Composer. A rejection preserves existing
input. An uncertain result or failed post-commit read blocks editing/sending until explicit Draft reload, preventing
old local text from overwriting a successfully returned Draft. Camp navigation is fenced while transfer is in flight.

Resubmission uses a new normal send: append at the current queue tail when execution or Pending exists, otherwise
publish directly. It uses current execution settings. Leaving the Camp or closing the window uses the ordinary Draft
fence in [Camp Composer Draft v13](camp-composer-draft-v13.md).

Legacy begin/takeover/save/cancel and working attachment APIs remain compatible for existing sessions; the new
Desktop does not begin them. A remaining old session is presented as unfinished work with a neutral return/delete
entry, and keeps its existing publication fence until explicitly resolved.

## Desktop submission outcomes

The [v3 durable outcome lookup](pending-camp-input-v3.md#desktop-submission-outcomes) is unchanged. A returned
Pending input reports `cancelled`; its prior submission receipt cannot auto-focus a future, newly submitted input.
