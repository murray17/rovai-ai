---
document_type: interface-contract
contract: camp-composer-draft
version: 16
status: accepted
authority: client-local-public-camp-composer-recovery
last_updated: 2026-10-03
---

# Camp Composer Draft v16

Inherits [v15](camp-composer-draft-v15.md)'s local snapshot format, Active Thread behavior, continuation/reply validation,
source-attachment authority and accepted-send boundary. It extends per-Thread local persistence to ordinary one-click
Pending Threads under [Pending Camp Activation v4](pending-camp-activation-v4.md). A project has no singleton draft:
each new Thread owns its own document, quotes, reply intent, continuation and ready attachment identities.

Meaningful input becomes a draft row after local storage and Core presence acknowledgement. Switching Threads, Renderer
refresh, window recreation and ordinary restart restore saved input from the same client's store. Restore revalidates
attachment authority and reply/member availability before editing/sending. Other clients do not receive the content.
Clearing input hides the row; leaving then permits guarded empty discard. Accepted send replaces the persisted snapshot
before waiting for the Active projection, preventing sent text from reappearing on the next visit. Rejection retains it.

Local storage failure or failed presence update preserves the editor and blocks completion of the save/leave operation;
retry uses the existing Composer save path. Core presence has no revision or edit lease and is not a second content
authority. Invalid or unavailable local data follows v15's fail-closed handling. The AI member-creation entry continues
to use its explicitly window-local v3 overlay; Single Chat remains governed by its separate private contract.
