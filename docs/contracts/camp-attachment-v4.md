---
document_type: interface-contract
contract: camp-attachment
version: 4
status: accepted
authority: camp-attachment-ingress-publication-and-runtime-path
last_updated: 2026-08-20
---

# Camp Attachment v4

v4 replaces [v3](camp-attachment-v3.md). File/directory shape, limits, canonical digest, immutable Authority, unified
publication aggregate and Runtime projection states remain unchanged. v4 closes concurrent Authority ingress and
AgentRun temporary-source isolation.

## Authority ingress serialization

Every operation that changes a Camp Authority root's access mode or child set MUST hold one process-wide shared
per-Camp ingress admission. The identity is the exact Authority instance root plus canonical Camp ID, and the admission
is shared across independently constructed `CampAttachmentStore` values. It covers:

- public Camp root creation/restriction;
- Agent source freeze and its failure cleanup;
- Composer prepare, remove and discard filesystem phases;
- unowned Agent source cleanup and Camp Authority removal.

Callers that already hold the admission use a private root helper and MUST NOT reacquire it. The admission may cover
blocking copy/hash within that Camp, but it MUST NOT hold the global Database mutex or built-in invocation guard. Two
different Camps do not share this admission. Known child-path Runtime verification remains read-only and does not mutate
the root access mode.

## AgentRun source roots

The Agent adapter accepts only the canonical execution workspace or the exact `ROVAI_RUN_TMP` returned by current lease
authentication. That Run tmp is a process-stable path whose contents are reset before each lease becomes active; path
admission is therefore bound to process ID/token, lease ID/generation/token, AgentRun ID, execution epoch and exact root.
Application Support parents, another process/lease Run tmp, Authority, Runtime View and arbitrary absolute paths fail
closed. Source no-follow, mount/reparse containment, limits and immutable Authority copy remain v3.

## Public and Runtime states

`pending | available | recovery_required | failed`, quota/reservation, public visibility, Runtime Desired Catalog,
operation ownership and Camp deletion semantics remain v3. Attachment-only Agent Send creates the same empty-body public
message and ordered attachment facts as Composer; provenance is the only ingress distinction after Authority adoption.

## References

- [Camp Attachment v3](camp-attachment-v3.md)
- [Camp Message Send v12](camp-message-send-v12.md)
- [Camp Published Attachment View v3](camp-published-attachment-view-v3.md)
- [V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)
