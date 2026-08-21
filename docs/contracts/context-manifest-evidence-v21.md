---
document_type: protocol-contract
contract: context-manifest-evidence-v21
authority: agent-run-context-evidence
status: accepted
version: 21
last_updated: 2026-08-20
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
Camp Attachment View Contract = 2
Camp Attachment View Receipt = 2
Runtime Attachment Auth Receipt = 1
Data Contract = v1.15
Projection Schema = 56
Latest Migration = 101
```

## Attachment evidence

`attachmentRefs`, Shared Message evidence and final rendered/model payload retain their existing absolute Runtime View
paths and ordering. Authority `storage_path` still never enters a new Manifest or payload. `RUN_FACTS.campResources`
continues to expose the exact current Camp root with `enumerate_and_read`, `current_camp` and `read_only` semantics.

Each Manifest adds the canonical `CampAttachmentViewReceiptV2` and digest defined by
[Camp Published Attachment View v2](camp-published-attachment-view-v2.md). It freezes the stable relative root, semantic
catalog revision/prefix and complete semantic identity of every explicitly referenced attachment. It does not freeze an
absolute root, root/Entry filesystem identity, publication operation, physical generation or physical catalog digest.

Persisted pairing is closed:

```text
Manifest 19 + Formatter 20 + Profile 4 + no View receipt   (legacy read only)
Manifest 20 + Formatter 21 + Profile 4 + View receipt v1   (historical read only)
Manifest 21 + Formatter 21 + Profile 4 + View receipt v2   (current write)
```

There is no legacy dispatch, dual write, historical receipt rewrite or dispatch-time path/receipt translation.

## Materialization, A2A and dispatch

Direct and A2A materialization use the same Camp read admission, resolve all selected paths from the ready View, load the
semantic receipt, measure the unchanged final Formatter 21 bytes and atomically freeze Manifest/Managed Blob/prepared
delivery evidence. Frozen A2A Context validates the same v2 receipt and never reselects history or rewrites model bytes.

Resume and pre-dispatch validation accept only an append-only semantic successor: the frozen catalog prefix and referenced
Entries must still match. A semantics-preserving controlled rebuild is admissible even if inode/device/file identity,
operation ID and physical generation changed. Semantic path, kind, counts, bytes/content digest or catalog-prefix drift is
not admissible.

Runtime dispatch then performs a separate current-local integrity admission and creates the unchanged physical
`RuntimeAttachmentAuthReceiptV1`. A retry from `not_accepted` reuses exact frozen Formatter/Manifest bytes but creates a
current Auth Receipt and request digest. An accepted delivery is never resent merely because the View was rebuilt.

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
