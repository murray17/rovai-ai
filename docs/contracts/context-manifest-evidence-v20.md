---
document_type: protocol-contract
contract: context-manifest-evidence-v20
authority: agent-run-context-evidence
status: accepted
version: 20
last_updated: 2026-08-20
---

# ContextManifest Evidence v20 Contract

ContextManifest Evidence v20 replaces [v19](context-manifest-evidence-v19.md) for new AgentRuns. It preserves Context
Delivery Profile v4 selection, Gather v3, Bootstrap, Skill/MCP, omission, exact rendered payload and accepted-ACK evidence.
It advances Formatter to 21, Run Facts to v2 and makes every new attachment path a Camp Published Attachment View path.

## Versions and section order

```text
Native Session Bootstrap contract = native_session_bootstrap_v3
Bootstrap Formatter = 3
AgentRun Context Formatter = 21
ContextManifest = 20
Context Delivery Profile = 4
Run Facts = 2
Gather Completion Input = 3
Camp Attachment View Receipt = 1
Runtime Attachment Auth Receipt = 1
Data Contract = v1.15
Projection Schema = 54
Latest Migration = 99
```

```text
COLLABORATION_STATE?
→ SELF_ACTIVE_TASKS?
→ SHARED_CONVERSATION?
→ RUN_FACTS
→ A2A_GUIDANCE?
→ CURRENT_INPUT
```

`RUN_FACTS` is mandatory because `campResources` is mandatory; `CURRENT_INPUT` remains mandatory and last. Profile v4
candidate selection, self-author filter, reference closure, count/character budgets, omission shape and payload trimming
priority remain unchanged. Formatter 21 measures the final View paths and mandatory fact in the same UTF-8 payload budget.

## Attachment evidence

Current `attachmentRefs` and Shared Message attachment evidence keep their existing fields and ordering, but every `path`
is resolved by PublishedAttachmentPathResolver v1 before selection bytes are frozen. Authority `storage_path` never enters a
new Manifest or model payload.

Each Manifest adds `CampAttachmentViewReceiptV1` and its canonical digest. `referencedAttachmentIds` is the de-duplicated,
UTF-8-byte-sorted set of every final Current/origin/reference/recent/Shared attachment occurrence; it is empty when no
occurrence is explicit. `catalogEntryCount` and `catalogDigest` describe the complete ready Camp catalog without embedding
that catalog in the Manifest.

Persisted pairing is closed:

```text
Manifest 19 + Formatter 20 + Profile 4 + no View receipt   (legacy read only)
Manifest 20 + Formatter 21 + Profile 4 + View receipt v1   (current write)
```

Migration 99 adds explicit `context_manifest_version = 19` to legacy rows and installs a trigger that forbids new legacy
pairings. There is no dispatch-time path replacement, v21→v20 fallback or dual write.

## Materialization and dispatch

Direct and A2A materialization acquire the Camp View read admission, freeze root identity/minimum generation/catalog,
run the existing Profile v4 selector, resolve all selected paths, add Run Facts v2, measure final bytes and freeze Manifest,
Managed Blob and prepared Runtime Input Delivery. Dispatch re-acquires the same Camp admission and verifies that current
state is the same append-only successor.

For the current `generation_fenced_v1` mode, dispatch generation is bound into Host compatibility and Runtime Attachment
Auth Receipt. Frozen Manifest/payload retry reuses exact bytes; it does not reselect history or rewrite paths. A rebuild,
root identity change, missing Entry or non-successor generation fences dispatch.

## Migration 99 clean break

Migration 99 accepts only complete schema 53/Migration 98 state. Before any SQLite mutation it requires an admitted empty
Runtime Files Root and successful Authority/quota preflight. It preserves historical Manifest 19, rendered/runtime input
Managed Blobs, digests, summaries, accepted ACK and execution evidence byte-for-byte. Old nonterminal Formatter 20 inputs
are terminalized according to delivery/action evidence and become non-dispatchable; current Binding/Session pointers are
fenced without erasing historical identities. View backfill reads only `message_attachment`.

## References

- [ContextManifest Evidence v19](context-manifest-evidence-v19.md)
- [Run Facts v2](run-facts-v2.md)
- [Camp Published Attachment View v1](camp-published-attachment-view-v1.md)
- [Context Delivery Profile v4](context-delivery-profile-v4.md)
