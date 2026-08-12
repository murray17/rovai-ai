---
document_type: protocol-contract
contract: current-user-attention-v1
authority: current-user-message-mention-and-notification
status: accepted
version: 1
last_updated: 2026-08-12
---

# Current User Attention v1 Contract

This contract defines the stable user identity, Structured Camp Message Content segment, text/model projections,
durable In-App Notification, exact read addressing and Renderer behavior produced by Camp Message Send v4.

## 1. Sole current-user identity

```text
currentUserId = "local_user"
```

Core is the sole resolver. v1 has no multi-user authenticated binding and no Agent/Renderer-selected ID. At send
acceptance, Core writes this identity to the segment and Notification in the same transaction and durable replay
reuses it. Agent input/output never exposes it.

Display name is presentation-only. Core resolves the current local profile name when available; otherwise the stable
localized fallback is `你` for zh-CN and `You` for English. Name or locale changes do not rewrite identity, content
digest, Notification source or frozen Runtime Context.

The old internal literal `local-user` is incompatible v0.65 data and is rebuilt as `local_user`; it is not an alias.

## 2. Closed segment and authoritative content

```ts
type CurrentUserMentionSegment = {
  kind: "current_user_mention"
  userId: "local_user"
}
```

Only Core can generate this segment from accepted `mentionUser=true`. Agent inputs, user Composer Drafts, plain text
and generic structured Clipboard cannot submit it as an authoring instruction.

The full closed Structured Content union is:

```text
Text(text)
MemberMention(agentId)
AllMembersMention
CurrentUserMention(userId="local_user")
```

For Agent sends, Core converts strict inline Agent tokens before optionally prepending Current User Mention. The
normalized content is the sole message-content authority. Persisted `submittedBody`, projected display body or
notification summary must not become independently mutable content truth.

The existing `camp_message.body` column remains only as a Core-owned, rebuildable `projectedBody` cache for legacy
read-side and FTS integration. Core writes it from Structured Content in the message transaction; no command can
edit it independently. A current-user display-name or localized-fallback change atomically reprojects every surviving
message that contains this segment and lets the existing body-update path refresh FTS before publishing the profile/
locale change. A failure rolls back both the presentation change and derived rows. Frozen Runtime Context keeps its
already-materialized bytes and is never rewritten by that maintenance.

## 3. Projection rules

`CurrentUserMention` projects as `@<displayName>`. A Core-generated leading segment inserts exactly one U+0020 before
subsequent nonempty content. This separator is projection behavior; it does not alter submitted input or semantic
digest.

All consumers use the same projection:

| Consumer | Contract |
| --- | --- |
| Renderer | structured inline token followed by projected Text/Agent mentions |
| Camp read/search | projected body; exact item also returns safe addressing |
| Context | projected body and explicit `mentionsCurrentUser` boolean |
| plain Clipboard | visible `@displayName` text |
| private structured Clipboard | preserves segment for copy fidelity; user Composer paste downgrades it to Text |
| Notification | Unicode-safe summary derived from projected body, max 160 scalars |
| accessibility | token label `提及当前用户：<displayName>` and readable projected message |

The canonical Structured Content digest includes `current_user_mention(local_user)` and every Text/other Mention
segment in order. It excludes current display name and notification lifecycle. Search indexes projected body and may
separately index `mentionsCurrentUser=true`; search results project the current body from Structured Content rather
than treating the FTS cache as content authority.

Text that spells `@你`, a profile name, `@local_user`, `@local-user`, or similar is never upgraded. It remains Text
for digest, display, search, Context, Clipboard and notification eligibility.

## 4. Durable User Mention Notification

Notification fields:

```text
kind              = camp_message_user_mention
recipientUserId   = local_user
sourceType         = camp_message
sourceMessageId    = accepted messageId
campId             = message campId
```

Uniqueness is:

```text
(kind, recipientUserId, sourceMessageId)
```

One message can create at most one notification for the current user. Different messages always retain independent
Inbox rows, even if they share author, body, Camp or short time window. Replay returns the original row and never
creates a second one.

CampMessage, segment and Notification are created in the same accepted send transaction. A Notification write,
constraint, receipt or event failure rolls back the message and every Delivery/slot. A plain public message or a
lookalike body creates no notification of this kind.

## 5. Inbox read/lifecycle shape

The existing durable Notification Center owns read/unread, clear, pagination, event invalidation and retention. The
item schema adds this kind's source fields:

```json
{
  "id": "notification_123",
  "kind": "camp_message_user_mention",
  "camp": {"id":"camp_123","title":"Design"},
  "sourceType": "camp_message",
  "sourceMessageId": "message_123",
  "sourceAvailable": true,
  "messageSummary": "@你 请确认采用方案 A…",
  "readAt": null,
  "createdAt": "2026-08-12T00:00:00Z",
  "updatedAt": "2026-08-12T00:00:00Z"
}
```

`messageSummary` has the closed type `string | null`. When `sourceAvailable=true`, it is a read-time projection of at
most 160 Unicode scalars, not stored body truth. When `sourceAvailable=false`, it is exactly `null`; Renderer supplies
the localized fixed presentation `来源不可用` and never receives tombstoned content. Notification IDs are Renderer/
Core lifecycle identities and never appear in Agent Camp read. `sourceType="camp_message"` is a closed read-side
discriminator derived from this notification kind, not a separately mutable persistence field.

- new row is unread; heads-up display/timeout/dismiss does not mark it read;
- the existing `clear` lifecycle is the UI's delete/archive action: it hides the row and schedules retention cleanup,
  but never deletes CampMessage and does not introduce a second archive state;
- standard retention remains 90 days, latest 1,000 per user, and cleared physical cleanup after one day;
- mark-read/clear remains idempotent even when source is unavailable;
- while the notification row exists, message availability does not rewrite `mentionsCurrentUser`, notification
  identity or prior user lifecycle state.

## 6. Navigation and unavailable source

A click on one notification row or its single-item heads-up is the existing explicit read-and-open action: Renderer
starts idempotent `markRead` and navigation without making either one wait for the other. Mark-read failure does not
block opening an available source; navigation failure does not undo an already recorded read. Merely displaying or
dismissing a heads-up, or opening the Notification Center, is not this action.

A notification row with `sourceAvailable=true` navigates by both `campId + sourceMessageId`, refreshes authoritative
Camp state, and locates the exact message. It never locates by body, timestamp or nearest item.

For a surviving notification whose Camp still exists, a tombstoned, individually removed, unauthorized or otherwise
unreadable source message returns `sourceAvailable=false`. Renderer shows `来源不可用`, does not select another
message, and still permits read/clear. Clicking an already-known unavailable row performs the explicit mark-read
action but does not navigate or close into an unrelated Camp. `sourceMessageId` remains an opaque locator so a
missing source cannot be mistaken for a different message.

Deleting the entire Camp retains the existing `camp_id ... ON DELETE CASCADE` lifecycle and removes its notification
rows; it does not leave an orphan Inbox item. The source-unavailable presentation applies only while the notification
and its Camp remain readable.

## 7. Heads-up preference and aggregation

Preference shape extends the existing singleton:

```ts
type InAppNotificationPreference = {
  headsUpEnabled: boolean
  approvalHeadsUpEnabled: boolean
  executionHeadsUpEnabled: boolean
  userMentionHeadsUpEnabled: boolean
  version: number
  updatedAt: string
}
```

The new field defaults true. `headsUpEnabled=false` gates all categories; category off only suppresses future
transient presentation and never affects Inbox creation, unread count, clear, retention or navigation. Re-enabling
does not replay old notifications.

Existing heads-up rules remain one visible slot, 8-second lifetime, hover/focus pause, maximum three queued items,
overflow summary, focused/visible-window requirement, and no automatic focus. Within one visible 8-second window,
new unread `camp_message_user_mention` items for the same Camp may aggregate into `本 Camp 还有 N 条消息提及你`.
Aggregation only changes transient presentation:

- every message keeps its own Inbox row and unread state;
- aggregate click opens the Notification Center at those new rows and does not bulk mark read;
- different Camps, different kinds, resolved/read/cleared items or arrivals outside the window do not aggregate;
- dismiss/timeout changes no durable lifecycle state.

## 8. Renderer token and Clipboard

Current User Mention reuses `--mention-ink` / `--mention-ink-hover`, default transparent background, no border,
`display:inline`, 0–1px horizontal padding and the existing 3px radius. It is visually distinguishable from Text but
is not a person link: no popover, navigation, command or Core mutation; it is not tabbable and has no button role.
The accessible label is `提及当前用户：<displayName>`.

Native text selection and plain copy include the visible token. Whole-message structured copy can preserve the
segment in the app-private HTML payload. Because user-authored Drafts cannot create Current User Mention, pasting
that private payload into Composer must insert its visible plain text, not the segment. This preserves copy fidelity
without granting an unauthorized authoring path.

## 9. Agent-safe read and recovery

Exact `camp.read(mode="item")` derives `mentionsCurrentUser` from Structured Content and returns frozen Agent
recipients separately. It never returns `local_user` or Notification identity. Notification read/clear/retention does
not affect this boolean.

With an authoritative message locator, callers may verify the boolean through exact read. Without a locator after
`confirm_outcome`, body search and approximate matching are not authoritative; callers stop without resending.

## References

- [ADR-0165](../adr/0165-core-owned-current-user-message-attention.md)
- [Camp Message Send v4](camp-message-send-v4.md)
- [ADR-0087: Durable In-App Notification Inbox](../adr/0087-core-owned-durable-in-app-notification-inbox.md)
- [Current UI detail](../ui/arctic-dawn.md)
- [v0.65 implementation specification](../versions/v0.65/implementation-spec.md)
