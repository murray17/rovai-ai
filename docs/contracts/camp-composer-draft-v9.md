---
document_type: interface-contract
contract: camp-composer-draft
version: 9
status: accepted
authority: camp-composer-document-revision-load-mutation-and-send
last_updated: 2026-09-05
---

# Camp Composer Draft v9

v9 replaces [v8](camp-composer-draft-v8.md). The closed `ComposerDocument` V2 wire, identity rules, Core storage,
source attachments, Reply/Continuation fields, Pending transfer and exact-revision fencing retain v8 semantics.
This version changes the Renderer transaction boundary: authoritative Core content changes must return to Lexical,
send and Camp switching lock editing, and a failed Draft read is never an empty revision-zero Draft.

## Canonical document and identity

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

The envelope remains closed and canonical. Empty Text Segments are removed, adjacent Text Segments are merged and
newlines remain `\n` inside Text. `agentId` and `skillId` are the only Member and Skill identities; Catalog labels,
avatars and availability are presentation. `labelFallback` and `nameAtSend` keep their v8 fallback/snapshot roles.

`CampComposerDraftView.content` is authoritative content and `body` is always derived from it. Core readers retain
the v8 legacy-array compatibility and successful writes emit only V2. Lexical JSON remains Renderer-local and is not
a persisted or IPC protocol.

## Renderer authority and mutation order

Lexical owns the actively edited body. `DraftMutationCoordinator` is the Renderer’s only complete
`CampComposerDraftView` owner and serializes content, attachment, Reply, Continuation and recipient mutations against
its current revision. `ComposerDraftSync` owns only the latest EditorState, local/saved versions, dirty/error state,
debounce and bounded retry; it does not cache a Draft View or Core revision.

Every explicit routing mutation follows one order:

```text
lock Lexical interaction
  -> flush the current EditorState through the Coordinator queue
  -> execute the Core mutation against the current exact revision
  -> receive the complete next Draft View
  -> if content changed, authoritative-replace Lexical and clear its old selection/history
  -> unlock interaction
```

This applies to starting/cancelling Reply, resolving a Reply recipient, dismissing Continuation and resolving a
Continuation recipient. An attachment-only or revision-only change does not replace Lexical content. Authoritative
replacement does not create a new local version, autosave or undo item, and closes the current Typeahead.

## Load and navigation

Renderer Draft load has exactly `loading`, `ready` and `error` outcomes. A successful Core read may return an empty
revision-zero Draft and is `ready`. IPC, database or Core failure is `error`: Composer, attachments, routing and send
remain disabled, no fabricated empty Draft becomes authority, and the user receives an explicit retry action.

Before switching from one open Camp to another, Renderer synchronously locks the current Composer and awaits its
attachment preparation plus `flush()`. Only a successful flush permits navigation. Failure preserves the current
EditorState and Camp, reports the save error and unlocks the editor. Component cleanup only releases local listeners,
timers and editor runtime; it is not a persistence boundary.

## Autosave boundary

An autosave captures and serializes one EditorState into one canonical `ComposerDocument`, then passes that object to
`Coordinator.saveContent()`. Canonical documents use a direct linear Segment/Atom comparison; save does not normalize,
stringify, derive body or export the EditorState again merely to compare content.

`save_content` success updates Coordinator authority and revision without refreshing the whole Workspace projection.
Attachment, routing, load and send-related authoritative changes may refresh it. Ordinary dirty/saving/saved state
stays within Draft Sync; only a persistence error or its successful recovery is projected upward. A batch attachment
operation flushes body content once, then submits its attachment mutations sequentially through the same revision queue.

## Typeahead command order

Member and Skill keep one bounded Trigger Plugin. Its critical-priority Enter/Tab command recomputes the trigger from
the current collapsed Lexical selection before the generic send command runs; it does not depend on React menu state.

- current trigger plus ready non-empty candidates selects the highlighted candidate and consumes the key;
- current trigger plus a loading Catalog consumes the key without sending;
- no trigger, or a ready/error Catalog with no candidate, returns control to the ordinary Enter path;
- Shift+Enter bypasses Typeahead selection and inserts the ordinary domain line break;
- composition always blocks candidate insertion and message send.

The matcher still reads only the current TextNode suffix bounded to 128 characters and never crosses an Atom,
LineBreak or Paragraph. Browser spell checking is disabled for the Composer editing surface.

## Flush and send

`flush()` means that its captured Lexical content is persisted through the current Coordinator queue and that the
returned Draft is the Coordinator’s latest complete authority. It serializes the captured EditorState once and exposes
failure to explicit callers.

Send locks Lexical synchronously before its first asynchronous wait, waits attachment preparation, flushes, and sends
only the returned exact Draft revision. No input is accepted into the same Composer while send is in flight. On
acceptance Renderer loads the next Core Draft and authoritative-replaces Lexical before unlocking. On rejection it
does not clear or replace the editor and unlocks the preserved Draft for retry. Consequently v9 has no
`sentLocalVersion`, send-time persistence hold, post-send version comparison or “type the next message during send”
branch.

The existing sendability and publication rules remain: derived body must be non-empty or an attachment View must
exist; V2 Atoms map to public Structured Content only inside the authoritative send flow; Pending receives the complete
V2 intent, attachments, materialized routing and Execution Request atomically.

## References

- [Pending Camp Input v3](pending-camp-input-v3.md)
- [Camp Attachment v8](camp-attachment-v8.md)
- [Composer architecture](../architecture/camp-composer-draft.md)
- [Structured mentions and atoms](../ui/components/structured-mentions.md)
