---
document_type: version-decisions
version: v0.70
lifecycle: historical
last_updated: 2026-08-18
---

# v0.70 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0173](#adr-0173) | Leading Structured Mentions Excluded from Generated Camp Names | `accepted` |
| [ADR-0174](#adr-0174) | Ten-Skill Official Inventory and Pinned Matt Pocock Imports | `superseded` |

<!-- legacy-adr:begin id=ADR-0173 source-file-sha256=e94d76c031b974179bbf0c6b97b7a73b6e00f4fba9ad7dc117eb28575278aaed -->
<a id="adr-0173"></a>

## ADR-0173: Leading Structured Mentions Excluded from Generated Camp Names

迁移时原路径：`docs/adr/0173-leading-structured-mentions-excluded-from-generated-camp-names.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0173
title: Leading Structured Mentions Excluded from Generated Camp Names
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.70
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0173 -->
<a id="adr-0173-context"></a>
### Context

ADR-0071 derives a default Camp name synchronously from the first accepted user message. After
Structured Content became the sole user-message authority, that visible body can begin with one or
more recipient Mention tokens. Treating those routing tokens as title words makes the navigation
label begin with `@队员`, even though the recipient is not the subject of the conversation.

The distinction cannot be recovered safely from the projected plain-text body: a handwritten
`@文字` may be intentional title content, and a display name may contain whitespace. Generated
names therefore need the authoritative Structured Content boundary rather than text heuristics.

<a id="adr-0173-decision"></a>
### Decision

This decision locally refines ADR-0071's generated Camp-name algorithm. When the first accepted
user submission may replace a `default` name, Core starts from its authoritative Structured
Content and removes only the contiguous leading addressing block made of `member_mention` and
`all_members_mention` segments, together with whitespace-only Text around that block. It then
renders the remaining segments through the normal identity projection, normalizes whitespace and
takes the first 80 Unicode scalar values.

Once substantive Text begins, every later Mention remains ordinary title text. Text segments are
never parsed for `@` syntax, so handwritten `@文字` is preserved. If removing the leading Mention
block leaves no title content, Core stores `未命名对话` while still changing the internal origin to
`generated`; a later message cannot become a second automatic naming attempt. Explicit user names
and renames remain unchanged.

The navigation rail renders the resulting Camp name as ordinary non-interactive text. It does not
turn any `@文字` in a Camp row into a Mention token, profile trigger or separate action.

Before release, development data with `name_origin = generated` may be reprojected in place from
the first accepted user message using this exact rule. This decision creates no compatibility or
general migration contract for older builds.

<a id="adr-0173-consequences"></a>
### Consequences

- Generated navigation labels begin with the conversation subject instead of routing metadata.
- Structured identity remains the only authority for deciding what may be removed; literal text
  and non-leading Mention content are stable.
- Name generation remains synchronous, deterministic and Core-owned, with no new field or wire
  shape.
- Pre-release historical data needs a one-time local refresh to match the new projection.

<a id="adr-0173-rejected-alternatives"></a>
### Rejected Alternatives

- **Strip a leading `@...` from the rendered string:** rejected because it would erase intentional
  text and cannot delimit names safely.
- **Hide the prefix only in Renderer:** rejected because search, notifications and other Camp-name
  consumers would retain a different durable identity.
- **Make sidebar Mention text interactive:** rejected because Camp rows navigate to Camps; member
  identity inspection belongs to message and member surfaces.
- **Ask a Runtime or LLM to rewrite the title:** rejected for the determinism and lifecycle reasons
  already established by ADR-0071.

<a id="adr-0173-references"></a>
### References

- [v0.70 current version](README.md)
- [ADR-0071: Configured Camp Creation and Lazy Conversations](../v0.22/decisions.md#adr-0071)
- [ADR-0128: Structured Draft-Only User Camp Message Submission](../v0.43/decisions.md#adr-0128)
- [App Shell and unified navigation](../../ui/components/app-shell-navigation.md)
<!-- legacy-adr-body:end id=ADR-0173 -->
<!-- legacy-adr:end id=ADR-0173 -->

<!-- legacy-adr:begin id=ADR-0174 source-file-sha256=5a6f0a2c64a8fc596c507b08b57e81ce05583d9c0c4e22b591cec20ea15e21da -->
<a id="adr-0174"></a>

## ADR-0174: Ten-Skill Official Inventory and Pinned Matt Pocock Imports

迁移时原路径：`docs/adr/0174-ten-skill-official-inventory-and-pinned-matt-pocock-imports.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0174
title: Ten-Skill Official Inventory and Pinned Matt Pocock Imports
status: superseded
date: 2026-08-13
decision_scope: cross-version
source_version: v0.70
supersedes:
  - ADR-0167
superseded_by: ADR-0176
```

<!-- legacy-adr-body:begin id=ADR-0174 -->
<a id="adr-0174-context"></a>
### Context

ADR-0167 freezes the exact seven-Skill official inventory and requires a successor decision for any
addition. The `mattpocock/skills` repository contains three engineering workflows that are useful in
Rovai without first being redesigned around Camp collaboration: disciplined bug diagnosis, explicit
test-driven development, and writing instructions for coding agents.

A floating GitHub reference or runtime-time download would make the application package
non-reproducible. Importing the upstream trigger descriptions unchanged would also make the Skills
too eager: diagnosis could be mistaken for fix authority, TDD could trigger for ordinary test work,
and agent-instruction writing could absorb normal user documentation.

<a id="adr-0174-decision"></a>
### Decision

1. Rovai releases exactly ten official Skills: `analyze-agent-codebase`, `cli-operations`,
   `diagnosing-bugs`, `grill-duo`, `grill-duo-with-docs`, `memory-stewardship`, `tasteful-ui`, `tdd`,
   `worktree`, and `writing-for-agents`.
2. `diagnosing-bugs`, `tdd`, and `writing-for-agents` are pinned GitHub-origin official Skills from
   `https://github.com/mattpocock/skills` at revision
   `84fdeffd12f2ee307994d1eb6feb48173b6e0502`. Rovai vendors every file in the selected upstream
   directories and adds the repository MIT `LICENSE` plus a per-Skill `NOTICE` recording repository,
   revision, and source directory.
3. Rovai may narrow only each imported `SKILL.md` front-matter description and localize
   `agents/openai.yaml`. The remaining `SKILL.md` body and all other selected upstream resources are
   retained unchanged. The resulting bundled manifests contain 5 files for `diagnosing-bugs`, 6 for
   `tdd`, and 5 for `writing-for-agents`.
4. Trigger boundaries are explicit:
   - `diagnosing-bugs` is for an explicit diagnosis, root-cause investigation, regression, hard or
     intermittent bug, or a failed earlier fix. A diagnosis-only request does not authorize a fix.
   - `tdd` is for explicit TDD, test-first, red-green-refactor, or an agreed failing-test-first feature
     or fix. Merely adding or updating tests does not trigger it.
   - `writing-for-agents` is for Skills and other documents consumed as coding-agent instructions,
     including invocation wording, progressive disclosure, and completion criteria. It does not own
     ordinary user documentation, product copy, or code comments.
5. The three additions use the ordinary official Skill Library lifecycle: immutable bundled
   Revisions, default enabled state, default assignment to all nine Runtime Groups, user-controlled
   later enablement and Assignment, official-name collision protection, and GitHub provenance shown
   only as source metadata. They receive no required/locked state or special delivery protocol.
6. Build and runtime installation remain offline. None follows a branch or checks GitHub for
   updates. A future refresh must select an exact commit, re-vendor all selected source directories,
   re-check license and notices, and validate the full bundled manifests.
7. All constraints inherited from ADR-0167 remain in force, including the pinned
   `tasteful-ui` snapshot. No Skill grants filesystem, Git, network, Tool, collaboration, approval,
   diagnosis, test-seam, documentation, or implementation authority beyond the current request and
   Runtime permissions.
8. Any future official inventory change requires another successor ADR plus coordinated Core
   manifest, terminology, source presentation, smoke, and acceptance fixture changes.

This decision completely supersedes ADR-0167. ADR-0158 continues to own the default-all Runtime
Group policy, while ADR-0166 continues to own progressive CLI teaching.

<a id="adr-0174-consequences"></a>
### Consequences

- Core, Renderer, documentation, and acceptance fixtures share one exact ten-item inventory.
- The three imported workflows are reproducible, auditable, and visibly GitHub-origin without
  requiring network access during build, install, or execution.
- Narrow descriptions reduce accidental invocation while preserving the upstream workflow bodies.
- `diagnosing-bugs` adds one non-executable shell template that remains visible in the Skill risk
  summary; the other two additions contain documentation only.
- Updating the shared upstream revision changes all three immutable snapshots together unless a
  later ADR explicitly splits their provenance.

<a id="adr-0174-rejected-alternatives"></a>
### Rejected Alternatives

- **Import the entire `mattpocock/skills` repository.** Rejected because most Skills have not been
  evaluated against Rovai terminology, authority, delivery, and Camp collaboration boundaries.
- **Track `main` or download during build/runtime.** Rejected because the released content, license
  evidence, offline behavior, and immutable Revision could no longer be reproduced.
- **Keep the broad upstream descriptions unchanged.** Rejected because metadata is the invocation
  boundary and would create predictable false-positive triggers.
- **Rewrite the three workflow bodies into Rovai-native variants now.** Rejected because the chosen
  workflows are already self-contained; provenance-preserving adaptation is smaller and easier to
  audit.
- **Import upstream `code-review` unchanged.** Rejected for now because its Standards/Spec parallel
  reviewer pattern should be redesigned around Rovai's public asynchronous A2A Messages, fixed Camp
  partners, solo fallback, and explicit authority boundary rather than silently treating generic
  subagents as Rovai teammates.

<a id="adr-0174-references"></a>
### References

- [v0.70 current version](README.md)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](../v0.58/decisions.md#adr-0158)
- [ADR-0166: Progressive Built-In CLI Teaching](../v0.65/decisions.md#adr-0166)
- [ADR-0167: Seven-Skill Official Inventory (historical)](../v0.65/decisions.md#adr-0167)
- [`diagnosing-bugs` bundled source](../../../skills/diagnosing-bugs/SKILL.md)
- [`tdd` bundled source](../../../skills/tdd/SKILL.md)
- [`writing-for-agents` bundled source](../../../skills/writing-for-agents/SKILL.md)
- [Domain terminology](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0174 -->
<!-- legacy-adr:end id=ADR-0174 -->
