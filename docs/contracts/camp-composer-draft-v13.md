---
document_type: interface-contract
contract: camp-composer-draft
version: 13
status: accepted
authority: composer-pending-withdrawal
last_updated: 2026-09-12
---

# Camp Composer Draft v13

Inherits [v12](camp-composer-draft-v12.md) Draft schema, low-frequency persistence, exact revision submission,
navigation and window/App close fences. [Pending Camp Input v4](pending-camp-input-v4.md) adds an explicit
user-authorized overwrite transition from one Pending input to the ordinary Draft.

Draft Mutation Coordinator serializes `return_pending_input` after prior Draft mutations and uses the latest
Draft revision. Only a successful Core withdrawal and authoritative Draft read replace the editor. The ordinary
Draft identity, autosave and attachment/quote/reply UI own all subsequent editing; there is no Pending edit identity,
separate local navigation snapshot or save/cancel mode. A failed/unknown post-commit read requires reload before
local typing or sending can resume. Exact pending and Draft revision fences, replay and legacy session compatibility
are owned by Pending v4.
