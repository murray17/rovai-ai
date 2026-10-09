---
document_type: protocol-contract
contract: context-manifest-evidence-v33
authority: public-multi-input-agent-run-context-evidence
status: accepted
version: 33
last_updated: 2026-10-09
---

# ContextManifest Evidence v33

Inherits [v32](context-manifest-evidence-v32.md), changing only public batch message Mention metadata under
[Message Mentions v1](message-mentions-v1.md). Normal RUN_INPUT.messages entries always include mentions and
omit their independent mentionsCurrentUser. The body, authors, selection, quotes, attachments and skills
remain unchanged. Non-batch CURRENT_INPUT/history retain mentionsCurrentUser and their existing shape.

New claimed public Runs freeze Formatter/Manifest **33**, Profile **10**, Run Facts **9**.
Non-batch remains **28/7/6**. Bootstrap, Charter, Native Binding compatibility and Session lifecycle do
not change. New Runs in existing Sessions immediately use the new format. No negotiation is introduced.

Migration 187 expands the existing closed version constraints from v1.72/schema 136 to schema 137.
It preserves all business/evidence rows and their original bytes. Old claimed RunInput records retain
their format, including those without a materialized Manifest; v32 reconstruction still produces the old
message shape. Previously supported older recovery paths keep their existing admission. Frozen payloads
and Manifests are reused without rerendering. New inserts require v33 RunInput, while Manifest recovery
requires a matching frozen input version.

The same current serializer serves claim sizing and final projection. Mentions participate in actual
UTF-8 input bytes, the existing complete RUN_INPUT digest and exact rendered payload digest. No additional
budget/evidence system, body clipping or partial input is added.

The confirmed change and validation plan are in [revision 1](../versions/v1.72/model-context-change-message-mentions.md).
