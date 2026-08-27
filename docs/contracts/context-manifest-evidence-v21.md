---
document_type: protocol-contract
contract: context-manifest-evidence-v21
authority: agent-run-context-evidence
status: accepted
version: 21
last_updated: 2026-08-27
---

# ContextManifest Evidence v21 Contract

ContextManifest Evidence v21 replaces [v20](context-manifest-evidence-v20.md) for new AgentRuns. Formatter 21 model
bytes, Context Delivery Profile v4 selection, Run Facts v2, section order, budgets, attachment paths and every non-View
evidence field remain unchanged. Only the non-model-visible Camp Attachment View receipt and its recovery validation move
from physical View identity to stable attachment semantics.

## Versions

```text
Native Session Bootstrap contract = native_session_bootstrap_v3
Bootstrap Formatter = 3
AgentRun Context Formatter = 21
ContextManifest = 21
Context Delivery Profile = 4
Run Facts = 2
Gather Completion Input = 3
Camp Attachment View Contract = 4
Camp Attachment View Receipt = 2
Runtime Attachment Auth Receipt = 1
Data Contract = v1.25
Projection Schema = 66
Latest Migration = 112
```

## Attachment evidence

`attachmentRefs`, Shared Message evidence and final rendered/model payload retain their existing absolute Runtime View
paths and ordering. Authority `storage_path` still never enters a new Manifest or payload. `RUN_FACTS.campResources`
continues to expose the exact current Camp root with `enumerate_and_read`, `current_camp` and `read_only` semantics.

Each Manifest adds the canonical `CampAttachmentViewReceiptV2` and digest defined by
[Camp Published Attachment View v2](camp-published-attachment-view-v2.md). It freezes the stable relative root, semantic
catalog revision/prefix and complete semantic identity of every explicitly referenced attachment. It does not freeze an
absolute root, root/Entry filesystem identity, publication operation, physical generation or physical catalog digest.

Managed v2 references are frozen by `attachmentRefs` and do not enter the legacy semantic catalog receipt. Only legacy
v1 references whose database locator resolves successfully enter `referencedEntries`. When that set is empty, the same
receipt wire uses `catalogRevision = -1`, zero entries and the canonical empty digest to mean “legacy View not required”.
This sentinel is self-validating and never reads current `camp_attachment_view` state.

Persisted pairing is closed:

```text
Manifest 19 + Formatter 20 + Profile 4 + no View receipt   (legacy read only)
Manifest 20 + Formatter 21 + Profile 4 + View receipt v1   (historical read only)
Manifest 21 + Formatter 21 + Profile 4 + View receipt v2   (current write)
```

There is no legacy dispatch, dual write, historical receipt rewrite or dispatch-time path/receipt translation.

## Materialization, A2A and dispatch

Direct and A2A materialization resolve selected legacy paths from database View metadata and safely omit a legacy reference
whose locator/View state is unavailable. They do not inspect payload bytes. The remaining legacy semantic receipt, or the
no-legacy sentinel, is atomically frozen with Manifest/Managed Blob/prepared delivery evidence. Frozen A2A Context validates
the receipt's own closed shape and digest and never reselects history or rewrites model bytes.

Resume and pre-dispatch validation preserve the exact frozen receipt and paths but do not require the current legacy View
to remain ready. Runtime dispatch separately validates the admitted Runtime Files Root identity, exact Camp root,
containment and workspace non-overlap, then creates `RuntimeAttachmentAuthReceiptV1` with `live_append_v1` and no
compatibility generation. A retry from `not_accepted` reuses exact frozen Formatter/Manifest bytes but creates a current
Camp-root Auth Receipt and request digest. It does not take a legacy read admission, inspect unresolved writer state or
trigger a View rebuild.

## Migration 100 clean break

Migration 100 accepts only complete schema 54/Migration 99 state. It uses existing accepted/delivery/action evidence to
terminalize all old nonterminal Manifest 20/Receipt v1 Runs, Turns, Deliveries, Gathers and recoverable execution, fences
current Binding/Session state, and preserves historical Manifest, rendered payload, Runtime Auth Receipt, ACK, summary and
execution evidence bytes. It backfills the stable semantic catalog and installs Manifest 21 as the only new-write version.

Completed historical Context remains readable evidence but is not rewritten and old unfinished Runtime sessions do not
resume. New Runs exclusively use Manifest 21/Receipt v2.

Migration 101 subsequently advances schema 55 to 56 only to enforce one nonterminal attachment publication per Camp.
It does not change Manifest 21, View Receipt v2, model bytes or recovery validation.

## References

- [ContextManifest Evidence v20](context-manifest-evidence-v20.md)
- [Camp Published Attachment View v2](camp-published-attachment-view-v2.md)
- [Run Facts v2](run-facts-v2.md)
- [Context Delivery Profile v4](context-delivery-profile-v4.md)
- [Accepted Input Recovery v3](accepted-input-recovery-v3.md)
