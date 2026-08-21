---
document_type: protocol-contract
contract: camp-published-attachment-view-v3
authority: camp-published-attachment-runtime-view
status: accepted
version: 3
last_updated: 2026-08-20
---

# Camp Published Attachment View v3 Contract

v3 replaces [v2](camp-published-attachment-view-v2.md). Root admission, read-only copy, generation fence,
`CampAttachmentViewReceiptV2` wire, stable entry identity and three-phase full verification remain. v3 changes publication
ordering and defines the Runtime Desired Catalog in the presence of terminal public attachment failure.

## Revision axes and resolution ledger

Each Camp persists three axes:

```text
semanticRevision       every committed public attachment publication
resolvedRevision       contiguous high-water resolved available or failed
catalogRevision        physical/runtime-available append-only catalog
```

Operations queue by `semanticRevision`; only the head may materialize. A resolution ledger includes each resolved
revision and either its available entry digest or a failed tombstone. `resolutionDigest` commits the ordered ledger so a
failed public attachment cannot be silently omitted or later revived. `catalogRevision` advances only for real available
View entries. Existing v2 receipts remain valid prefixes because every pre-v3 Published Attachment was available.

## Unified publication

Semantic commit occurs before View copy and owns the public message, ordered attachments, reservation, writer intent,
operation and Delivery gate. The worker then executes:

```text
short DB transaction  → select FIFO head and immutable copy plan
write admission       → fence incompatible Host
no Database lock      → copy/hash/identity verification/fsync in blocking work
short DB transaction  → CAS outcome, update revisions/catalog/reservation/gates
```

Success promotes complete entries and marks attachments `available`. Recoverable failure marks
`recovery_required` and retains intent/reservation. Terminal failure marks attachments `failed`, appends tombstones,
advances contiguous resolved revision, releases intent/reservation and settles gated Deliveries. Same-Camp operations may
be committed concurrently but are projected FIFO; followers cannot overtake an unresolved head.

## Desired set and verification

All consumers use one definition:

```text
Desired = message_attachment WHERE runtime_projection_state = 'available'
Actual  = View Entry receipts + filesystem entries
```

Runtime authorization additionally requires no unresolved publication operation/writer intent. Startup recovery,
explicit full verification, controlled rebuild and path resolution verify both the available catalog and resolution
ledger/tombstones. A failed row is not a missing View Entry and must not be rebuilt. An available row without a verified
Entry is integrity failure.

Full verification snapshots generation/catalog/resolution expectations under a short Database lock, performs recursive
filesystem enumeration and SHA-256 in `spawn_blocking` with no Database reference, then commits only if the snapshot is
unchanged. A normal publish verifies only newly promoted entries plus existing catalog/resolution receipts; a normal Run
creates one verified authorization reused by Context materialization and Runtime launch.

## Admission and compatibility

The scheduler acquires exactly one Camp read admission before Claim, and in the same short Database critical section
requires no persistent writer intent. The admission lives for the whole Run. Materialization, authorization, Host acquire,
resume and input dispatch accept it as proof and must not reacquire the fair RwLock. The worker owns write admission while
mutating physical View state.

`CAMP_ATTACHMENT_VIEW_CONTRACT_VERSION = 3`. Runtime compatibility fences Hosts from v2. The semantic receipt wire stays
schema 2; its catalog is now explicitly the append-only Runtime-available catalog.

## Migration 102

Migration 102 accepts complete schema 56/Migration 101, advances to schema 57/Data Contract v1.17 and backfills every
existing `message_attachment` as `available`. Existing catalog state initializes semantic/resolved revisions and the
resolution digest; existing nonterminal legacy operations become ordered recovery input. It installs publication,
reservation, tombstone and Delivery gate constraints without rewriting historical Context/receipt bytes.

## References

- [Camp Published Attachment View v2](camp-published-attachment-view-v2.md)
- [Camp Attachment v3](camp-attachment-v3.md)
- [Runtime Launch and Verification v12](runtime-launch-and-verification-v12.md)
- [V1.17-D01](../versions/v1.17/decisions.md#v1-17-d01)

