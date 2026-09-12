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
