---
document_type: protocol-contract
contract: mission-v12
authority: mission-structured-member-description
status: accepted
version: 12
last_updated: 2026-10-08
---

# Mission v12

Inherits [Mission v11](mission-v11.md). Desktop/Web definition commands additionally accept
`descriptionContent`, an ordered array of these closed segments:

```ts
type MissionDescriptionContent = Array<
  | { kind: 'text'; text: string }
  | { kind: 'member_mention'; agentId: string }
>
```

The array is the authoritative description; adjacent text is normalized, repeated member references retain
their positions. Stable IDs resolve current display names. A deleted/unavailable member is never rebound by
name. Broadcast, User, Skill, quotes and editor-specific nodes are not admitted. The rendered description
retains the 12,000-character limit and the segment count is bounded to 12,000.

`MissionRecord.descriptionContent` is a UI projection. `MissionInfo` / `MissionAgentInfo.description` remains
a readable string, e.g. `请 @爱丽丝 实现。`; `mission get` gains no field, schema or instruction. Run Facts,
Bootstrap, model context selection, evidence and version axes are unchanged. No Runtime is started by saving.

## Definition commands and membership

Creation accepts either legacy `description` text or `descriptionContent` (an omitted/empty legacy string is
allowed with structured content). Update accepts one description representation, never both. Legacy Agent
`mission update --description` remains a text replacement: equal text preserves references, changed text becomes
a single text segment without guessing identities. A title/tag/attachment-only patch preserves references.
Only User commands may submit structured descriptions and invite members.

Core resolves/validates every mentioned identity in the same transaction as the definition write. Creation
unions mentioned IDs with explicit initial members. Update adds mentioned outsiders through the existing Camp
membership admission and event owner; it does not replace existing capabilities, remove members or change an
existing Default Lead. Present outsiders can join; active away members can remain referenced. Removed profiles
and leave-pending members reject the write with `mission.member_unavailable` and `agentIds` for repair.
Repeated mentions invite once. Deleting a mention never removes an existing Camp member.

User edits retain the captured `expectedDetailsVersion`. Structure changes advance that revision even when
the rendered text is identical. Validation, membership additions, description, tags/attachments and activity
commit together. Any refusal or storage failure leaves the old definition and membership intact. Command replay
returns the existing receipt, without new invitations. Renderer keeps draft content and pending invitations
after failure, and reuses a command identity for an unchanged request whose outcome is unknown.

## Storage and upgrade

Migration 185 advances v1.72/schema 134 to 135, adding `mission_description(mission_id, content_json)` with a
cascading Mission FK and JSON array constraint. Existing descriptions become literal text segments; existing
`@name` text is not parsed. `mission.description` is a compatibility text cache written by the same command;
reads render current names from structured content and do not mutate storage. Existing Missions, memberships,
attachments, statuses, activities, frozen model evidence and receipts are retained. Schema, migration receipt
and authority marker share one transaction; failure leaves schema 134 intact. Older supported sources migrate
through their existing sequence before this additive step.
