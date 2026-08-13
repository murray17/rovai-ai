---
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
---

# ADR-0173: Leading Structured Mentions Excluded from Generated Camp Names

## Context

ADR-0071 derives a default Camp name synchronously from the first accepted user message. After
Structured Content became the sole user-message authority, that visible body can begin with one or
more recipient Mention tokens. Treating those routing tokens as title words makes the navigation
label begin with `@队员`, even though the recipient is not the subject of the conversation.

The distinction cannot be recovered safely from the projected plain-text body: a handwritten
`@文字` may be intentional title content, and a display name may contain whitespace. Generated
names therefore need the authoritative Structured Content boundary rather than text heuristics.

## Decision

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

## Consequences

- Generated navigation labels begin with the conversation subject instead of routing metadata.
- Structured identity remains the only authority for deciding what may be removed; literal text
  and non-leading Mention content are stable.
- Name generation remains synchronous, deterministic and Core-owned, with no new field or wire
  shape.
- Pre-release historical data needs a one-time local refresh to match the new projection.

## Rejected Alternatives

- **Strip a leading `@...` from the rendered string:** rejected because it would erase intentional
  text and cannot delimit names safely.
- **Hide the prefix only in Renderer:** rejected because search, notifications and other Camp-name
  consumers would retain a different durable identity.
- **Make sidebar Mention text interactive:** rejected because Camp rows navigate to Camps; member
  identity inspection belongs to message and member surfaces.
- **Ask a Runtime or LLM to rewrite the title:** rejected for the determinism and lifecycle reasons
  already established by ADR-0071.

## References

- [v0.70 current version](../versions/v0.70/README.md)
- [ADR-0071: Configured Camp Creation and Lazy Conversations](0071-configured-camp-creation-and-lazy-conversations.md)
- [ADR-0128: Structured Draft-Only User Camp Message Submission](0128-structured-draft-only-user-message-submission.md)
- [App Shell and unified navigation](../ui/components/app-shell-navigation.md)
