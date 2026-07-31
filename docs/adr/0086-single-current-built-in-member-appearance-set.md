---
document_type: adr
id: ADR-0086
title: "Single Current Built-In Member Appearance Set"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.27
supersedes: []
superseded_by: null
---

# ADR-0086: Single Current Built-In Member Appearance Set

## Context

The four canonical Profiles need new user-approved portraits, icons and built-in identity presets.
ADR-0056 made built-in appearance references versioned so old and new packaged bytes could coexist,
but retaining the obsolete art and preset model would add a permanent compatibility branch for a
local product whose current built-ins are intentionally being replaced.

## Decision

Rovai-ai maintains one current packaged appearance and preset for each existing closed built-in
role ID. v0.27 replaces the bytes and preset content behind the current four controlled built-in
references directly; it does not add `v2`, keep an old-art registry, or provide an old-image
fallback. Obsolete bust, glyph, portrait and preset content is deleted when it has no current
consumer.

The v0.27 data migration unconditionally resets the four canonical Profile IDs to the confirmed
new identity and corresponding current built-in reference. Other Profile rows retain their stored
`avatarRef`: managed assets remain unchanged, while any Profile that references a built-in
appearance displays the new single current art. Historical UI is not guaranteed to reproduce the
old packaged appearance.

ADR-0056's controlled-reference parsing, managed immutable compound assets, asset-first commit,
orphan retention, local image safety and backup boundaries remain effective. Appearance still
does not grant identity semantics, Capability, Runtime, permission or lifecycle state.

## Consequences

- The application ships and tests one built-in visual/preset set instead of parallel versions.
- Profiles using a built-in reference may visibly change after upgrade, including non-canonical
  and historical renderings; this is an accepted consequence rather than a compatibility defect.
- Managed user images remain stable because their immutable asset references and files are not
  replaced.
- A future desire for simultaneous historical built-in appearances requires a new decision rather
  than silently reintroducing version branches.

## Rejected Alternatives

- Add `v2` references and retain all `v1` art and registry paths.
- Copy the locally approved art only into managed assets for the four canonical Profiles.
- Preserve old art for non-canonical Profiles while replacing it only for canonical Profiles.
- Keep obsolete preset fields or image files as unused compatibility data.

## References

- [v0.27 Partner Identity Six Fields](../versions/v0.27/README.md)
- [ADR-0056: Controlled Member Avatar References and Application-Managed Local Assets](0056-controlled-member-avatar-assets.md)
