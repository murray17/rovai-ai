---
document_type: protocol-contract
contract: context-manifest-evidence-v19
authority: agent-run-context-evidence
status: accepted
version: 19
last_updated: 2026-08-20
---

# ContextManifest Evidence v19 Contract

ContextManifest Evidence v19 replaces
[v18](context-manifest-evidence-v18.md) as the current entry. It preserves Formatter 20, every persisted column and JSON
shape, exact rendered-payload bytes/digest, Runtime Input Delivery ACK, Gather v3, Principal projection and recovery
evidence rule. It changes the Profile evidence and public-message selection interpretation to
[Context Delivery Profile v4](context-delivery-profile-v4.md).

## Versions

```text
Native Session Bootstrap contract = native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter = 3 (unchanged)
AgentRun Context Formatter = 20 (unchanged)
ContextManifest = 19
Context Delivery Profile = 4
Gather Completion Input = 3 (unchanged)
Data Contract = v1.15 (unchanged)
Projection Schema = 53
Latest Migration = 98
```

Formatter 20 keeps the exact section order and closed model shape:

```text
COLLABORATION_STATE?
→ SELF_ACTIVE_TASKS?
→ SHARED_CONVERSATION?
→ RUN_FACTS?
→ A2A_GUIDANCE?
→ CURRENT_INPUT
```

`CURRENT_INPUT` remains mandatory and last. No section, field, order, compact serialization or omission-envelope shape
changes between Manifest v18 and v19.

## Profile v4 evidence

Every new Manifest freezes:

```text
context_delivery_profile_version = 4
context_delivery_profile_json.profileVersion = 4
context_delivery_profile_digest =
  022688d6f133ea3bb6e6d5773cd30aec1db7a184e4419bbc0fe9c554518bc8d9
```

The recent selection and whole-history omission evidence use the Profile v4 eligible set: current-Agent authored public
messages are removed before `maxPublicMessages`, and are not counted as whole-history omission. Each message actually
included in origin/reference/recent still receives the complete v18 `sharedMessageEvidence`, body/attachment digest and
canonical Camp reference. A current-Agent-authored message included only as required `referenceClosure` therefore remains
fully evidenced; a message excluded only by the recent author predicate does not receive fabricated omission evidence.

A2A prospective preflight and direct materialization must freeze the same recipient Agent ID, selector, omission result and
resolved Profile JSON. Retrying or recovering an already frozen Delivery reuses and verifies exact Manifest/payload bytes;
it does not reselect live public history.

## Migration 98 and recovery

Migration 98 accepts only a fully migrated `v1.15 / projection schema 52` store with Migration 97 present. It atomically:

- closes nonterminal Run, Turn, Delivery/Attempt and Gather state with
  `context_delivery_profile_v4_required` (never-dispatched Delivery retains the existing
  `interrupted_before_dispatch` manual-retry boundary);
- removes frozen Delivery context and old Manifest references;
- deletes Manifest/history-camp, Runtime Input Delivery, Bootstrap/redelivery, compaction and resume evidence;
- clears Native Session/Binding compatibility, secret, generation and accepted public boundary state;
- rebuilds `context_manifest` with `CHECK(formatter_version = 20)` and
  `CHECK(context_delivery_profile_version = 4)`;
- records schema 53 and Migration 98.

Camp, CampMessage, Conversation logical identity, Task, Memory, Agent profile, Runtime installation and Library facts are
preserved. There is no Profile v3/Manifest v18 compatibility reader, old frozen-input replay, dual write, downgrade reader
or in-place evidence rewrite. Stores outside the exact admitted source/current marker matrix fail closed under the existing
data-contract admission and quarantine policy.

## References

- [v1.15 confirmed model-context revision 1](../versions/v1.15/model-context-change-self-authored-recent-messages.md)
- [ContextManifest Evidence v18](context-manifest-evidence-v18.md)
- [Context Delivery Profile v4](context-delivery-profile-v4.md)
- [V1.15-D03](../versions/v1.15/decisions.md#v1-15-d03)
