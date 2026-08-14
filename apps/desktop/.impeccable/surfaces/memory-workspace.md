---
version: 3
slug: "memory-workspace"
primary_target: "apps/desktop/src/renderer/src/MemoryLibrary.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/styles.css"
---

# Memory workspace surface brief

## User goal

Understand what the system remembers, which scope and authority own it, review pending Hearth Review Items, and
perform explicit governed writes without confusing projected evidence with editable source material.

## First view and hierarchy

Keep the shared App rail, then a full-width Memory header with the English subtitle
“Memory / Library”, four quiet summary surfaces and a bounded attention banner when Hearth Review
Items need review. The header has no decorative top edge or bottom rule. The main workbench is a
list/detail split, not a wall of cards. At desktop widths the list is at least 310px and the detail at
least 390px; at the minimum window they reflow without whole-page horizontal scrolling.

Memory uses current theme surfaces but preserves evidence tokens for source text, revisions and
projection details. Steel establishes subtitles, active tabs and selection rather than a decorative
page edge; attention marks pending review, not ordinary Memory content.

## Summary, policy and Hearth review

Summary numbers reflect the current read model and remain honest in Loading, Partial and Recovery.
Policy/automatic-memory controls state their actual scope and do not promise model behavior beyond
the authoritative configuration.

Pending Review Items open the dedicated review drawer. Make it explicit that candidate content is not an active
Memory and is visible only on this user review surface. Show candidate content, source, requested add/revise action,
target/base where applicable, and the exact available decision. A fresh item supports accept, edit body/keys then
accept, or reject; a derived stale revise supports reject only and explains the changed target without offering silent
rebase. Drawer dismiss changes no domain state. Toast is only completion feedback and never the sole review surface.

Accepted, rejected and invalidated items are body-free history. `target_forgotten` and
`exact_candidate_published` may be explained with safe product copy, but the UI must not reconstruct cleared text or
claim that invalidation was a user rejection.

## Scope, search and workbench

Scope tabs, governance filters and search narrow the authoritative list without creating a second
dataset. Selecting a row opens complete content, authority, scope, timestamps and revision history.
Empty search, no selection, partial projection and unavailable evidence each have distinct language
and a useful next step.

## Writes and concurrency

Create, edit, forget and Review Decisions use the current Memory or Review Item version plus the exact base Revision
when the command requires it. Keep the user's draft and
selection on conflict, refresh the authoritative record, explain what changed and require an explicit
retry. Forgetting uses danger semantics and a preview; it is not represented as ordinary disabled or
archive state.

Do not expose private source paths or silently merge conflicting text. Renderer success must follow
the Core response, not optimistic visual state.

## Inheritance and hard boundaries

Inherit root [`DESIGN.md`](../../../../DESIGN.md), theme evidence tokens and the
[accessibility baseline](../../../../docs/ui/qa/accessibility.md). This brief owns composition only;
Memory scope, authority, Hearth Review policy, persistence and concurrency remain in current ADRs,
Contracts and Core read/write models.
