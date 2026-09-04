---
document_type: interface-contract
contract: camp-composer-draft
version: 8
status: accepted
authority: camp-composer-document-identity-revision-and-send
last_updated: 2026-09-04
---

# Camp Composer Draft v8

v8 replaces [v7](camp-composer-draft-v7.md). Revision fencing, Reply, Continuation, exact-Draft consumption,
source attachments and legacy Prepared exhaustion retain v7 semantics. This version replaces Draft Structured Content
with the closed `ComposerDocument` V2 protocol and makes `body` a projection.

## Canonical document

```ts
interface ComposerDocument {
  version: 2
  segments: ComposerSegment[]
}

type ComposerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'atom'; atom: ComposerAtom }

type ComposerAtom =
  | { type: 'member'; agentId: string; labelFallback?: string }
  | { type: 'all_members' }
  | { type: 'skill'; skillId: string; nameAtSend: string }
```

The envelope, every Segment and every Atom deny unknown fields. `version` must equal `2`; there are at most 4096
Segments and at most 1 MiB of UTF-8 text plus Member fallback labels. Member/Skill identities are trimmed, non-empty,
control-free strings of at most 256 UTF-8 bytes. A Member fallback is trimmed, non-empty, control-free and at most
120 Unicode scalars. `nameAtSend` follows the canonical Skill-name contract.

Normalization removes empty Text Segments and merges adjacent Text Segments. Newlines remain `\n` within Text;
paragraph, selection, history, editor node key, DOM and presentation state are not domain fields.

## Identity and presentation

`agentId` is the only Member identity. `labelFallback` is used only when the current Catalog cannot resolve that
identity for display or plain-text projection; it never participates in matching or rebinding. `skillId` is the only
Skill identity; `nameAtSend` is the send-time semantic/display snapshot. All Members has no reference ID.

Renames, avatars and available/unavailable state are Catalog presentation. They do not mutate the document or Draft
revision. An unavailable Atom retains its identity and is rejected or handled by the existing send-time authority; it
is never silently deleted, rebound by name or converted to text during normal editing.

## Compatibility and persistence

Core readers accept either the V2 envelope or a legacy top-level Structured Content array containing only `text`,
`member_mention`, `all_members_mention` and `skill_mention`. `current_user_mention`, `external_quote` or malformed/
unknown shapes are not user-editable and fail conversion. Every successful create/update thereafter serializes the
normalized V2 envelope; there is no dual write and no SQLite migration.

`CampComposerDraftView.content` and every Draft content mutation use `ComposerDocument`. `body` remains present for
compatibility but is always derived from that same document using current Member names, then fallback labels; All
Members projects as `@所有队员` and Skill as `/<nameAtSend>`. Callers must not maintain an independent body state.

Lexical JSON may exist only as Renderer-local diagnostic or transient state. It is never persisted in Core, passed
across IPC as the Draft protocol or used as a cross-version recovery format.

## Revision, flush and send

Core still accepts only the expected exact Draft revision and returns the next authoritative revision. Renderer may
edit ahead locally, but before send, Reply/Continuation changes, Camp/Draft switching or another revision-dependent
mutation it must flush the latest committed EditorState into one V2 Snapshot and obtain the exact Core revision.

Sending converts V2 to the existing public Structured Camp Message Content inside the authoritative flow. Member,
All Members and Skill map to their corresponding public Mention; `labelFallback` is not published as identity.
Public Message, Channel, History, Skill resolution and model-context contracts therefore remain unchanged.

At send start Renderer records `sentLocalVersion` and the flushed Draft revision. Success may clear the editor only
when the current local version still equals `sentLocalVersion`; later input stays in the editor and continues through
Draft persistence. Rejection preserves the exact Draft and local content under the existing error semantics.

## Attachment and queue inheritance

A Draft is sendable when its derived body is non-empty or an attachment View exists. Source refs, attachment-only
send, immediate publication, Pending admission and legacy Prepared restrictions retain v7. When queuing, the complete
V2 document is copied with attachments, materialized Reply/Continuation intent and Execution Request in the existing
transaction.

## References

- [Pending Camp Input v3](pending-camp-input-v3.md)
- [Camp Attachment v8](camp-attachment-v8.md)
- [Composer architecture](../architecture/camp-composer-draft.md)
- [Structured mentions and atoms](../ui/components/structured-mentions.md)
