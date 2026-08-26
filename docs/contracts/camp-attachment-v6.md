---
document_type: interface-contract
contract: camp-attachment
version: 6
status: accepted
authority: camp-managed-attachment-v2
last_updated: 2026-08-27
---

# Camp Attachment v6

v6 replaces [v5](camp-attachment-v5.md) for every new Composer and Agent-authored CampMessage attachment. The
file/directory union, ingress limits, no-follow traversal, canonical digest, preview/open safety and Camp ownership rules
remain. The current write model is Managed Attachment v2; the old Authority plus Published View model remains read-only
compatibility for already published legacy rows.

## Current write model

One successful first send creates one immutable payload below the already authorized Camp attachment root:

```text
<runtime-camp-files-root>/camps/<camp-id>/attachments/
  .managed-v2/<attachment-id>/payload/<safe-leaf-or-directory>
```

SQLite stores only the root-relative locator. `managed_attachment` owns the Camp-scoped resource, digest/tree receipt,
global `available | missing | corrupted | pending_delete` state and monotonically assigned `available_revision`.
`camp_message_attachment_ref` owns ordered Message references and a display-name snapshot. Composite foreign keys prove
that Message and Attachment belong to the same Camp. Reusing one available v2 identity in the same Camp inserts only a
new reference; it does not copy bytes or build a Runtime View. Cross-Camp use requires a new ingest and identity.

`attachmentId` is an identifier, not a capability. Every lookup matches both Camp and attachment identity. The resource
is Camp-public after commit: a Context path says that the attachment was actively presented in that input, not that later
filesystem access can be revoked per Context.

## Ingest and atomic semantic commit

Composer bytes remain in the existing private Prepared Attachment store until Send. Agent files are admitted only from
the exact execution workspace or `ROVAI_RUN_TMP`. Both sources then use:

```text
durable pending intent + quota reservation
  -> private same-filesystem staging
  -> one verified copy and canonical file/tree digest
  -> fsync
  -> atomic no-replace promote into the opaque final identity
  -> final identity/type/digest verification
  -> one SQLite semantic commit
```

The semantic commit rechecks the Composer Draft revision when applicable, increments `camp.attachment_revision`, inserts
available resources and ordered refs, creates the CampMessage and Deliveries, consumes the Draft, and marks the intent
committed. Failure before that commit produces no public Message or Delivery; the Draft remains unchanged and the intent
becomes abandoned. Startup recovery abandons unfinished pending intents and removes their staging or promoted orphans.
Committed payloads are never rebuilt from a second Authority copy.

Managed v2 ingest MUST NOT acquire legacy Camp View write admission, wait for Camp attachment quiescence, wait for an
active AgentRun, mutate a View generation, stop/fence an old Run, or create a `projection_blocked` Delivery. A source Run
is re-authorized after its potentially long copy, but it continues running throughout.

## Context, Runtime and failures

Context and read-model assembly query SQLite metadata only. They construct the persisted absolute v2 path and do not
`stat`, open, enumerate or digest the payload. They do not synthesize an unavailable descriptor or Run Fact when local
bytes later disappear. The Runtime or its tool observes its own native filesystem failure when it actually reads the
path; such a per-Run failure does not mutate global attachment state.

Adapters continue receiving the existing Camp-scoped `attachments` root. v2 adds no Inline bytes, per-Run copy, Host
broker, global attachment root or new permission-evidence database. Existing Session/Runtime permission behavior owns
whether a later filesystem child is readable.

Explicit image preview and Desktop open/reveal are different from Context assembly: they revalidate the exact v2 path,
type and digest/tree receipt immediately before returning a privileged local target. A failed explicit open does not
silently rewrite the persisted global state.

## Legacy compatibility

Existing `message_attachment` rows and Published View files remain governed by
[Camp Published Attachment View v4](camp-published-attachment-view-v4.md). They are not bulk migrated, not dual-written
and never receive new Composer or Agent attachments. Existing startup reconciliation and zero-attempt cancellation may
finish or settle legacy publication work, but Managed v2 never enters that worker. Historical Camps can continue to load,
send new v2 messages and dispatch Runs without converting their legacy rows.

## References

- [Camp Attachment v5](camp-attachment-v5.md)
- [Camp Composer Draft v5](camp-composer-draft-v5.md)
- [Camp Message Send v13](camp-message-send-v13.md)
- [Message Delivery v8](message-delivery-v8.md)
- [Camp attachment architecture](../architecture/camp-published-attachment-view.md)
