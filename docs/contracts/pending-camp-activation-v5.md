---
document_type: protocol-contract
contract: pending-camp-activation-v5
authority: camp-first-input-atomic-member-invitations
status: accepted
version: 5
source_version: v1.72
last_updated: 2026-10-08
---

# Pending Camp Activation v5

Inherits [v4](pending-camp-activation-v4.md)'s client-local snapshots, presence, navigation and cleanup.
A User's first inline `thread.messages.send` may now mention present AgentProfiles outside the Pending Thread.
The wire document and command receipt remain unchanged; ordinary membership commands still reject Pending Threads.

## First-input invitations

The Renderer offers the existing outsider picker and derives pending invitations from Member Atom IDs in the current
local document. Selecting a candidate does not change membership. Removing the last occurrence cancels that invitation;
repeated occurrences remain in the content but invite once. No second invitation list or Core draft is persisted.
Pending send submits the frozen document directly; it does not call `threads.members.add`.

Inside the command's immediate transaction, Core admits invitations only for a User-authored inline submission while
the Thread is still Pending. It revalidates every mentioned identity, then applies ordinary membership lifetime,
default capability overrides, generation and member-added event writes. An unavailable current member is rejected,
not reactivated implicitly. Default Lead is preserved. Membership, activation, message, attachment/quote relationships,
waiting Deliveries and presence removal commit together. Broadcast resolves after invitations, including newly joined
members; ordinary text that happens to contain an @ name grants no invitation authority.

A business rejection rolls back tentative domain writes before the gateway stores its rejected receipt. An SQL error
rolls back the transaction, including activation's presence trigger. Neither outcome leaves partial invitations,
messages or Deliveries. The client retains its complete local draft. Runtime execution follows accepted publication;
a later Runtime failure does not reverse membership or publication.

An accepted publication also establishes activation before its refreshed membership projection reaches the Renderer.
The client stops Pending presence/discard operations on that transport, including after Composer remounts, while
continuing local saves. It preserves the accepted unique explicit non-Lead continuation using the frozen identity;
the old Pending roster cannot dismiss it. Follow-up publication still requires the refreshed, addressable membership.
This receipt cache neither grants membership nor changes the persisted local draft format.

## Replay and concurrent submission

Same command ID and payload replay the original receipt without repeating any effect. Changed payload with the same
ID is a conflict. Distinct submissions serialize on the existing transaction: after another first send activates the
Thread, a stale submission uses Active admission, so any still-outside mention is rejected without implicit invitation.
The client refreshes and can retry through ordinary Active add-then-send. It must not infer acceptance from a timeout.

Only User inline first input gains this authority. Agent, System, Automation, private chat and standalone membership
commands retain their existing admission. No schema migration, model-input field, bootstrap or native-session change.
