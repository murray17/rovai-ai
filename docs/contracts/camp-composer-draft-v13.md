---
document_type: interface-contract
contract: camp-composer-draft
version: 13
status: accepted
authority: camp-composer-draft-client-ownership
last_updated: 2026-09-12
---

# Camp Composer Draft v13

v13 inherits [v12](camp-composer-draft-v12.md)'s document, exact-revision mutation, send, navigation and Desktop close
contracts. It adds Host-verified editing clients, without synchronization, merging or collaborative editing.

Core Draft identity is `(campId, clientId)`. Legacy Desktop uses the reserved `desktop` scope and retains its existing
wire/consumption semantics. Web receives a stable `draftId` derived from Camp and verified editor; an HTTP parameter
cannot select another client. [Host Web v2](host-web-v2.md) owns fresh authentication and editor-proof recovery.

The scope applies to reads, content/reply/continuation/quote mutations, source binding/removal, pending admission and
send consumption. Command digests include a non-Desktop editor identity; historical Desktop digests are unchanged.
Successful send/queue/discard clears only the Web client's content and advances its revision. Empty metadata remains,
including at expiry, so an old revision cannot become valid again after clear/recreate. Desktop A and Web B/C neither
consume nor overwrite one another's Drafts. Accepted source files keep Attachment v9's OS-controlled lifetime.

Migration 150 accepts the exact v1.57/projection-99/receipt-149 source, preserves existing Desktop rows and Prepared
references, creates composite ownership keys, and records v1.59/projection-100 atomically. Receipt failure rolls back
DDL/data; partial or lookalike schemas are not current. Old binaries cannot admit the new marker.

Within one page, reconnect and same-Owner reauthentication preserve the mounted editor and outstanding command IDs.
They update authentication generations and reauthorize reads, not Draft identity. A different Host/Owner/editor scope
cannot consume late results from the old scope. Renderer interaction/selection/history remain local.

Conversation-scoped private-chat Drafts must receive equivalent ownership before network private-chat writes are
admitted. Their current lack of Web admission is an implementation gap, not a permanent platform restriction.
