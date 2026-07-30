---
document_type: adr
id: ADR-0074
title: Quick Chat Ubiquitous Language and Binding Identity
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
---

# ADR-0074: Quick Chat Ubiquitous Language and Binding Identity

## Context

Rovai-ai has an application-managed workspace group for Camps that are not bound to a
user-selected directory. Its previous name entered product copy, domain vocabulary, Rust and
TypeScript identifiers, serialized binding values, Navigation Read Side fields, tests and the
managed filesystem path.

Changing only the displayed label would split one concept across two languages and require every
future feature to translate between a new product name and obsolete internal identifiers. The
product is not released, so retaining aliases, dual reads and data migration branches would add
permanent complexity without protecting a supported compatibility contract.

This ADR locally replaces the old managed-workspace name and binding literal in ADR-0071 and
ADR-0072. Their Camp Creation, directory identity, dynamic Git capability and Project grouping
decisions remain effective.

## Decision

### Quick Chat is the canonical term

The canonical English domain and product term is **Quick Chat**. The Chinese product label is
**快速对话**. Quick Chat groups Camps that use Rovai-ai's application-managed workspace; it is
neither a Camp nor a Project.

Current product surfaces, domain documentation, code, tests and contracts must not retain the
previous term as an alias. Historical version snapshots and the ADR passages whose replacement
this decision records remain unchanged as historical evidence.

### Every active identifier uses the new language

The binding and navigation contract is:

```ts
type ProjectBindingKind = 'quick_chat' | 'directory'

interface NavigationSnapshot {
  quickChat: NavigationCampGroup
  projects: NavigationProjectGroup[]
}
```

Rust variants use `QuickChat`; serialized storage and IPC values use `quick_chat`; JavaScript and
TypeScript properties use `quickChat`; CSS/test identifiers use `quick-chat`; and the managed
workspace directory is named `quick-chat/`.

A `quick_chat` Camp remains in Quick Chat even if Git metadata appears in the managed directory.
Directory Camps continue to form Projects only by exact canonical `projectPath`, as required by
ADR-0072.

### The cutover has no compatibility layer

The implementation replaces the current schema, contracts and fixtures in one cutover. It does
not accept the old serialized value, expose deprecated fields, dual-read old state, translate old
IPC payloads or retain code aliases. Existing unreleased collaboration data may be reset rather
than migrated.

The cutover permanently deletes the exact legacy managed directory `<userData>/lobby/` and all of
its contents before creating `<userData>/quick-chat/`. It does not back up, move, import or inspect
those contents for compatibility. Deletion must resolve the authoritative application `userData`
directory, require `lobby` to be its exact direct child, and never follow a symlink outside that
target. Failure to complete the deletion fails the cutover closed rather than starting with
partially migrated state.

## Consequences

- Product, domain, contracts and implementation share one ubiquitous language.
- Quick Chat stays visibly and structurally separate from directory-backed Projects.
- Schema, contract, fixture and managed-path changes must land atomically.
- Existing development collaboration data and every file under the legacy managed directory are
  discarded; old clients are incompatible.
- Historical documents may contain the replaced term, but current implementation guidance cannot
  treat it as an active alias.

## Rejected Alternatives

### Change only user-visible copy

Rejected because internal and external vocabulary would diverge permanently.

### Preserve the old serialized value as a compatibility alias

Rejected because the application is unreleased and dual vocabulary would complicate every
contract, migration and test without serving a supported client.

### Preserve or import the previous managed directory

Rejected because the user explicitly requires a clean, incompatible cutover. Retaining or copying
its contents would keep an undeclared compatibility path and could reintroduce obsolete workspace
identity.

### Model Quick Chat as a Project

Rejected because Project remains a read-time group of Camps sharing one user-selected canonical
directory. Quick Chat is the separate application-managed workspace group.

## References

- [v0.24 Arctic Dawn V3](../versions/v0.24/README.md)
- [ADR-0071: Configured Camp Creation and Lazy Conversations](0071-configured-camp-creation-and-lazy-conversations.md)
- [ADR-0072: Directory Workspace Identity and Dynamic Git Capability](0072-directory-workspace-and-dynamic-git-capability.md)
- [Domain vocabulary](../../CONTEXT.md)
