---
document_type: protocol-contract
contract: run-facts-v2
authority: agent-run-model-facts
status: accepted
version: 2
last_updated: 2026-08-20
---

# Run Facts v2 Contract

Run Facts v2 replaces [v1](run-facts-v1.md). It preserves every v1 optional fact and adds mandatory Camp resource
discovery for every new AgentRun. Formatter 21 therefore always renders `RUN_FACTS` immediately before optional
`A2A_GUIDANCE` and mandatory `CURRENT_INPUT`.

## Shape

```json
{
  "schemaVersion": 2,
  "campResources": {
    "campId": "rvcamp_...",
    "publishedAttachmentRoot": "/absolute/current-camp/attachments",
    "access": "enumerate_and_read",
    "scope": "current_camp",
    "mutability": "read_only"
  }
}
```

`campResources` is always present. The root is the admitted Camp Published Attachment View root for the Run's exact Camp,
including when the View is empty and no attachment occurrence appears in Current Input or Shared Conversation. It is the
only model-facing way to discover the Camp attachment catalog; it is not an attachment list, permission to another Camp,
evidence that the model read a file, or authority to mutate the View.

The optional v1 fields are unchanged:

- `taskContext`: frozen A2A Task reference and no-retargeting fact;
- `sessionContinuity`: lost private-session assumptions must be rechecked;
- `externalEffect`: prior unknown effects require reconciliation before repeat;
- `gather`: current-generation captured-return authority and final-output fallback;
- `delegation`: exhausted A2A target/dispatch budget.

Top-level order is `schemaVersion`, `campResources`, `taskContext`, `sessionContinuity`, `externalEffect`, `gather`,
`delegation`. Optional fields are omitted rather than null/default objects. The exact compact JSON bytes and digest are
frozen in ContextManifest v20.

## References

- [Run Facts v1](run-facts-v1.md)
- [ContextManifest Evidence v20](context-manifest-evidence-v20.md)
- [Camp Published Attachment View v1](camp-published-attachment-view-v1.md)
