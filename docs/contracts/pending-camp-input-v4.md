---
document_type: interface-contract
contract: pending-camp-input
version: 4
status: accepted
authority: camp-next-turn-client-edit-ownership
last_updated: 2026-09-12
---

# Pending Camp Input v4

v4 inherits [v3](pending-camp-input-v3.md)'s FIFO, publication, structured content, repair and durable submission
outcomes. Admission additionally retains the originating verified Draft client; working edit sessions carry their
own verified client. This does not create one queue per browser: the Camp still has one Core-owned FIFO.

The authenticated Owner can read canonical pending facts. Only the current editing client receives the working
attachment/quote state and may save, cancel or mutate working refs under the exact token/revision fence. Other
clients receive `foreignClient: true`, `recoveryRequired: true`, the current lease identity and empty working refs;
this projection cannot restore the foreign editor's local text.

The same Owner may **explicitly** request the existing `takeover` action with the current pending ID, revision and
lease token. Core rotates the token, binds the new editor and initializes working state from canonical Pending content.
It does not import unsubmitted foreign edits. The prior client cannot write with its old token. A stale takeover also
fails. Neither reading a queue nor reconnecting automatically takes over. This recovery prevents a closed page from
holding the FIFO indefinitely while preserving the existing single-edit-session model.

An ordinary foreign cancel/delete/working mutation remains fenced; the UI labels takeover and does not offer it as
an invisible edit resume. Headless scheduling and attachment lifetime retain the existing Core behavior. Network
working-file upload still requires the same scope/receipt rules as [Host Web v2](host-web-v2.md) before its admission.

## Return to Composer

`camp.pendingInputs.edit` accepts a new action:

```ts
{ type: 'return_to_composer', expectedDraftRevision: number }
```

The existing envelope requires authenticated Owner authority, matching Camp, `pendingInputId` and `expectedRevision`.
If the selected input has a legacy edit session, its verified editing client and current `editToken` are required.
A foreign client must explicitly take over before returning it; possession of a lease token alone is insufficient. Other inputs' sessions do not
prevent withdrawal. Only `queued | needs_repair` inputs may return; a published/cancelled or revised input rejects
with `pending_input.changed`. A changed Draft rejects with `draft_changed`. Neither rejection mutates either owner.

One Core transaction checks both revisions, overwrites only the caller’s verified `(campId, clientId)` Draft with the canonical Pending document,
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

The shared Desktop/Web page locks the ordinary Composer synchronously, settles attachment preparation and flushes existing text through
Draft Mutation Coordinator before requesting withdrawal at its latest revision. The user explicitly chooses to replace
current input content; there is no save/cancel editor or reserved queue position. On success the coordinator reloads
the complete Draft and replaces Lexical content, then focuses the ordinary Composer. A rejection preserves existing
input. An uncertain result or failed post-commit read blocks editing/sending until explicit Draft reload, preventing
old local text from overwriting a successfully returned Draft. Camp navigation is fenced while transfer is in flight.

Resubmission uses a new normal send: append at the current queue tail when execution or Pending exists, otherwise
publish directly. It uses current execution settings. Leaving the Camp or closing the window uses the ordinary Draft
fence in [Camp Composer Draft v13](camp-composer-draft-v13.md).

Legacy begin/takeover/save/cancel and working attachment APIs remain compatible for existing sessions; the new
shared Desktop/Web page does not begin them. A remaining old session is presented as unfinished work with a neutral return/delete
entry. A foreign session instead labels the action “接管并移回输入框” and disables direct deletion. It keeps
its existing publication fence until explicitly resolved.

## Submission outcomes

The [v3 durable outcome lookup](pending-camp-input-v3.md#desktop-submission-outcomes) is unchanged. A returned
Pending input reports `cancelled`; its prior submission receipt cannot auto-focus a future, newly submitted input.
