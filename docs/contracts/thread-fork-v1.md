---
document_type: protocol-contract
contract: thread-fork-v1
authority: published-thread-copy
status: accepted
version: 1
source_version: v1.72
last_updated: 2026-11-12
---

# Thread Fork v1

`threads.fork` creates an ordinary Active Thread from published public history. It creates no parent/child
relationship, Runtime Session or executable input. Subsequent reads, sends, Delivery and Context use the ordinary paths.

## Command and receipt

```ts
type ForkThreadRequest = {
  commandId: string
  sourceThreadId: string
  sourceMessageId?: string
}
type ForkThreadResult = { threadId: string }
```

The result is the existing `StoredCommandResult` payload. Host naming normalizes to `camps.fork`; the domain command
is `camp.fork`. The Owner's Envelope has `camp_id=None`, so deleting either Thread does not delete this receipt.
`commands.reconcile` accepts the same operation and original request. Receipt replay precedes source/workspace lookup
and retains the gateway's existing command-type, actor and scope checks. `commandId` identifies the first submission;
clients preserve its original request and do not reuse it for changed conditions after a recorded rejection.

## Admission and snapshot

Only the current Owner may copy an Active public Thread without a deletion operation. Pending Threads, Mission
Threads and private Conversation IDs are not sources. Directory admission uses the existing workspace gate inside
the immediate command transaction, after receipt lookup. Running Threads, empty history, zero effective members and
channel sources are allowed. Channel binding is not inherited.

An optional anchor must belong to the source, be a published Agent message, and be neither withdrawn nor deleted.
Otherwise return `camp.fork_anchor_unavailable` with “这条消息已不可用，无法从这里分叉”; never substitute another cutoff.
Copy through its real message sequence, including the anchor and earlier User messages. Full copy reads all eligible
rows in the transaction. The two public event types establish one publication per message; frontend pagination is
irrelevant. Later publications remain only in the source.

## Copy whitelist

- New Thread/message IDs; source project binding and directory; title truncated to 80 Unicode scalar values after
  reserving ` 副本`. The target is Active, Peer, and has an empty Composer. Ordinary creation admission is unchanged.
- Published public messages, including User, Agent, external-principal and visible System messages such as scheduled
  instructions; historical display times, sequence order, body, structured content, saved
  quotes and attachment display metadata. Public visibility excludes `a2a_event` / `task_event` presentations and
  legacy System messages authored by `approval`, in addition to deleted/unpublished rows. Hidden messages cannot be
  anchors. Withdrawn placeholders retain only their stored cleared content.
- `presentation_json` and `recipient_presentation_json` retain the target defaults (`NULL` and `{}`). Source
  presentation kinds still participate in public-message eligibility before copying; structured content retains
  the message's text, mentions and explicit references.
- Normal messages preserve addressed and frozen effective recipients independently. Existing history reads derive `mentions`
  from `effective_recipient_ids_json`, never from today's roster or by re-resolving the message. These publication
  facts do not create new Delivery records. Withdrawn placeholders use `address_mode=default` and empty addressed/effective
  recipient arrays before historical members are collected, so stale recipients do not create Left relations.
- Ordinary reply IDs map only inside the copied set. Explicit body links and Thread/Mission/file/task references
  keep their original targets. No recursive JSON ID substitution is permitted.
- Quotes use the existing `MessageQuoteSnapshot` parser and serializer, retaining text, captured author, capture
  time, format and quote ID while removing retired digest/locator fields. A public source owned by the source
  Thread maps to the new Thread/message IDs only when its message is copied and not withdrawn. Uncopied, withdrawn,
  private or other-Thread sources become absent; the excerpt remains usable without navigation metadata. A source
  carrying a private Conversation locator does not become a public locator. Quote text/model projection is unchanged.
- Effective active relations retain capability limits, including globally Away profiles. Leaving/Left or removed
  profiles do not become active. Only historical message authors, mentions and recipients actually referenced
  in copied content receive additional Left rows. Relation version and timestamps initialize as new relationships.
  A null Lead stays null; a non-null Lead outside the effective set rejects the command.
- A captured quote author alone does not require a member relation; its frozen display name is self-contained.
- Current Source Refs retain original sources. Legacy and managed attachment associations become Source Refs using
  saved paths/metadata, without filesystem existence checks or copied ownership rows. The two Threads share original
  directories/files. Existing open-time unavailable feedback applies; no retention, refcount or deletion guard is added.

Run/Turn/Delivery/operation associations are null. Run-dependent model labels remain unrecorded; no model snapshot
or present-day model substitution is introduced. Conversation/native Session, Run, queue, Task/Mission, approval,
usage, notification/unread state, collaboration state, drafts, extra execution configuration, Fast preferences,
Team guidance and source navigation/execution summaries are not copied. Newly published imported history initializes
the target Owner's read watermark, so copying does not manufacture unread replies.

## Atomicity and side effects

The gateway transaction loads receipt, validates source/directory/anchor, captures messages/members, inserts the
ordinary target, and inserts all messages with empty structured content before filling content and reply links.
It copies existing reference indexes for non-withdrawn messages without re-deriving them from message text
or recipient IDs. Withdrawn placeholders have no copied reference indexes. Fork does not populate `camp_message_mention`;
history `mentions` retain their existing frozen-recipient source. Ordinary mention writers/schema and SQLite/FTS triggers
maintain their existing indexes. It then establishes new publication facts with new event IDs, timestamps and global sequences, and
stores the command result. Any late SQL or receipt failure rolls everything back. Do not loop over ordinary sends.

Empty content during INSERT avoids the existing mention notification producer; null source Runs avoid round probes.
No Delivery or channel outbox path is called. `camp.fork` is excluded from the generic `camp.*` execution wake hint.
Existing navigation/message invalidations emit only after commit. Concurrent submissions of the same command return
one target; replay after source/target deletion does not recreate it.

## Foreground recovery and navigation

The application owns one foreground request across workspace unmounts. Both entries share its busy state; editing,
reading and navigation remain available. Persistence stores only command/source/optional anchor IDs and, once known,
the target ID, isolated by the existing Profile/Host/Owner scope. Refresh reads the existing receipt; no background
task or retry queue is created. Unknown outcome retries use the same original request. Opening a known target
through ordinary navigation never calls `threads.fork`.

Only completion during the same source-page visit may automatically navigate, through the existing leave guard.
Visit and navigation ownership are checked again after async draft/attachment work. A→B and A→B→A suppress automatic
navigation. Completion after leaving the source, and save/open failure after a known copy, produce no completion or
opening-failure toast, target title, or Open action. The known copy remains accessible through ordinary navigation;
its saved locator is not a new copy request. Fork opening does not commit a cached preview before the full projection
succeeds. An already visible target counts as opened only with a full projection; recovery identifiers are cleared only
after this confirmation. Rejected feedback auto-dismisses after 3.2 seconds; unknown outcomes retain explicit retry.
The loading indicator waits 200ms before appearing and stays visible for at least 600ms once shown, with errors taking
precedence. This visual timing never delays the command, navigation or busy-state completion. The
[conversation UI contract](../ui/components/conversation-workspace.md#thread-分叉) owns presentation.
