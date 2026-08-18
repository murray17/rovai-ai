---
document_type: protocol-contract
contract: context-manifest-evidence-v18
authority: agent-run-context-evidence
status: accepted
version: 18
last_updated: 2026-08-18
---

# ContextManifest Evidence v18 Contract

Model-context revision 1 is confirmed. This contract replaces
[ContextManifest Evidence v17](context-manifest-evidence-v17.md) as the current entry. v18 preserves every v17 section,
selection, budget, Principal projection, A2A guidance, Gather v3, exact-payload digest, Runtime Input Delivery ACK and
recovery-evidence rule. It changes the Camp identity admitted to and rendered by that contract.

## Formatter 20 Camp identity

AgentRun Context Formatter 20 keeps the exact v17 order:

```text
COLLABORATION_STATE?
→ SELF_ACTIVE_TASKS?
→ SHARED_CONVERSATION?
→ RUN_FACTS?
→ A2A_GUIDANCE?
→ CURRENT_INPUT
```

The only model-shape delta is the value contract of `SHARED_CONVERSATION.campId`:

```json
{"campId":"rvcamp_01h47kvsy5fk1shh6w1g60eecf"}
```

Whenever `SHARED_CONVERSATION` is present, `campId` is required and must satisfy
[Camp Identity v1](camp-identity-v1.md). It continues to apply to every projected origin, reference-closure and recent
message. Message fields, Agent audience, bodies, offsets, attachments, omission envelope and ordering are unchanged.

ContextManifest `camp_id`, every `sharedMessageEvidence[].campId` equivalent persisted reference, and every
`context_manifest_history_camp.camp_id` must carry the same canonical Camp identity. Evidence does not expose a decoded
UUID, alias or Native Session ID. The complete rendered-payload digest continues to bind the exact `rvcamp_...` bytes.

## Unchanged model input

- Session Charter text, Bootstrap v3 wrapper, Bootstrap Formatter 3, Member Identity and Memory Entrypoint are unchanged.
- `CURRENT_INPUT`, `RUN_FACTS`, A2A guidance and Gather Completion Input v3 shapes and omission rules are unchanged.
- Context Delivery Profile v3 selection/order/budgets and Structured Content Agent projection remain unchanged.
- Camp ID remains contextual locator evidence, never authorization or a Runtime Session resume target.

## Versions and invalidation

```text
Native Session Bootstrap contract = native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter = 3 (unchanged)
AgentRun Context Formatter = 20
ContextManifest = 18
Context Delivery Profile = 3 (unchanged)
Gather Completion Input = 3 (unchanged)
```

Formatter20/Manifest18 changes the Native Binding context contract and therefore the compatibility digest. Migration 95
rebuilds `context_manifest` with `CHECK(formatter_version = 20)`, removes old Manifest/Bootstrap/Input evidence, clears
Native Session/Binding and accepted-boundary state, and fails nonterminal execution closed with
`context_formatter_v20_required`. No Formatter19/Manifest17 reader, Camp UUID alias, evidence rewrite or dual write is
available. Production pre-release stores outside the current data contract are quarantined before a new current store.

Migration 94 / schema 49 belongs to the independent Runtime public-failure increment; Migration 95 advances the same
Data Contract v1.10 store to projection schema 50.

## References

- [v1.10 model-context revision 1](../versions/v1.10/model-context-change.md)
- [ContextManifest Evidence v17](context-manifest-evidence-v17.md)
- [Camp Identity v1](camp-identity-v1.md)
- [ADR-0219](../adr/0219-single-namespaced-camp-identity.md)
