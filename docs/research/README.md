---
document_type: research-index
authority: research-routing
last_updated: 2026-08-30
---

# Research

`docs/research/` contains evidence, feasibility studies and candidate integration designs.
Research helps explain what was observed, what remains uncertain and which checks are still needed;
it is not, by itself, a product support promise or an implementation authority.

## Authority boundary

A research document may establish:

- an upstream protocol or implementation fact;
- a reproducible local observation;
- a candidate Adapter shape;
- an explicit gap, risk or qualification plan.

It does not establish that a Runtime is selectable or supported in the product. Current product
identity comes from Core's closed Runtime Catalog. Per-platform availability comes from Runtime
Platform Admission, and observed compatibility evidence is maintained in
[`docs/runtime-compatibility.md`](../runtime-compatibility.md).

When a later implementation or qualification result differs from an earlier hypothesis, retain the
historical research but add a clear current-status note. Do not silently rewrite the original
observation into a stronger claim.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `proposed` | Candidate research exists, but implementation or qualification is incomplete. |
| `pre-implementation` | The document is design input for work that has not entered the product path. |
| `implemented` | Relevant code exists; platform admission must still be read separately. |
| `not_qualified` | The Runtime or capability has not passed the required target-platform evidence gate. |
| `qualified` | Qualification exists only for the exact Runtime, version, capability and platform named by the evidence. |
| `accepted-design-input` | The research is accepted as design input, not as proof that every described field is implemented. |

## Current areas

- [Cursor Agent Runtime research](cursor-agent-runtime-research.md)
- [DeepSeek Harness Runtime research](deepseek-harness-runtime/README.md)
- [DingTalk Developer Web Session probe](dingtalk-web-session-probe.md)
- [Grok Build Runtime research](grok-build-runtime-research.md)
- [Kimi Code Runtime research](kimi-code-runtime-research.md)
- [Pi Runtime research](pi-runtime-research.md)
- [Runtime monitoring collectability audit](runtime-monitoring/README.md)
- [TRAE CLI Runtime research and probes](trae-cli-runtime/README.md)

## Publication rules

Research committed to this repository must be safe to publish:

- never include credentials, tokens, private prompts or raw private transcripts;
- replace personal absolute paths with neutral placeholders unless an exact path shape is itself the
  evidence under review;
- use synthetic markers for Skill, MCP and workspace probes when their real names are irrelevant;
- retain versions, upstream revisions, protocol shapes and timings only when they support a stated
  conclusion;
- label assumptions and unverified behavior explicitly;
- do not turn a successful launch or one local sample into a general support claim.

Private qualification cases, provider credentials and user-specific environment inventories belong
outside the public repository.
