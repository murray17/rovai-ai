---
document_type: protocol-contract
contract: current-user-attention-v2
authority: current-user-message-mention-and-notification
status: accepted
version: 2
last_updated: 2026-08-13
---

# Current User Attention v2 Contract

This contract replaces [Current User Attention v1](current-user-attention-v1.md). All v1 identity, Structured
Content, projection, atomic notification, retention, heads-up, Clipboard and Agent-safe addressing rules remain
unchanged except for the corrected read acknowledgement, exact navigation and Renderer Markdown behavior below.

## 1. Message Mention read acknowledgement

The generic Camp-level mark-read command must exclude `camp_message_user_mention`. Opening a Camp, loading its latest
snapshot or acknowledging another notification kind cannot consume a Message Mention.

A Message Mention becomes read only through one of these paths:

1. the user explicitly activates that notification row or single-item heads-up; or
2. Renderer refreshes the already-active Camp and confirms the exact `sourceMessageId` node is rendered inside the
   visible timeline viewport while the document and window are still visible and focused.

The second path rechecks focus and document visibility after asynchronous refresh and render. Failure to refresh,
render, intersect the viewport or persist `markRead` leaves the row unread and eligible for its normal heads-up.
`markAllRead` remains an explicit user command and may read all notification kinds.

## 2. Exact message navigation read side

`CampSnapshot.messages` remains a bounded latest-message view. Notification navigation therefore uses this additional
Renderer-facing read:

```ts
camp.messages.around({ campId, messageId }) => {
  schemaVersion: 1
  throughGlobalSequence: number
  campId: string
  anchorMessageId: string
  sourceAvailable: boolean
  messages: CampMessageView[]
}
```

When the anchor is available, `messages` contains the anchor plus at most 20 untombstoned messages before and 20 after
it in the same Camp, ordered by Camp sequence. It uses the same Structured Content, projected body, presentation and
attachment hydration as CampSnapshot. A missing, tombstoned or wrong-Camp anchor returns
`sourceAvailable=false` and an empty message array without disclosing source content.

Renderer merges the bounded window with the current authoritative CampSnapshot by stable message ID and keeps it
while the notification target is active. It does not replace newer messages or derive an anchor from body, time or
nearest sequence.

## 3. Modal close and focus confirmation

Navigation is a two-phase interaction:

1. prepare and render the exact anchored message while the Notification Center remains open;
2. close the modal drawer, then scroll and move keyboard focus to the exact message node.

Only one notification navigation may be in flight. Closing the drawer cancels a pending presentation so an older
request cannot override a newer user action or reopen the drawer. After phase 2, Renderer confirms that the exact node
owns focus. Load, render or focus failure keeps or restores the drawer with an explicit recoverable error and never
silently selects a nearby message. The explicit activation may already have recorded read state, preserving v1's
independent mark-read/navigation semantics.

## 4. Markdown-preserving Renderer projection

For an Agent message whose authoritative Structured Content starts with the sole
`current_user_mention(local_user)`, Renderer displays one noninteractive inline Current User token followed by the
remaining authoritative content through the ordinary sanitized GFM renderer. Headings, lists, code, HTTPS links and
tables therefore keep the same behavior as other Agent messages.

Structured Agent Mention labels in that remainder project as visible text, not interactive identity tokens. Renderer
escapes their display names as Markdown literals and collapses embedded line breaks before parsing, so a display name
cannot introduce a link, heading, code span or other Markdown structure. Text segments remain unmodified Markdown
source. A non-leading or repeated Current User segment fails closed to the plain structured renderer.

## 5. Agent-safe exact verification

Exact `camp.read(mode="item")` continues to return separated `effectiveAgentRecipients` and
`mentionsCurrentUser`. For the current Run's own accepted send, the exact item can use the narrowly bounded
receipt-verification exception in [ADR-0170](../adr/0170-current-run-committed-self-write-exact-read.md). All collection
reads and all other post-boundary messages remain unavailable. Locator-absent recovery still cannot search, guess or
resend.

## References

- [ADR-0165: Core-Owned Current-User Message Attention](../adr/0165-core-owned-current-user-message-attention.md)
- [ADR-0170: Current-Run Committed Self-Write Exact Read](../adr/0170-current-run-committed-self-write-exact-read.md)
- [Current User Attention v1 (historical)](current-user-attention-v1.md)
- [Camp Message Send v4](camp-message-send-v4.md)
- [Built-in Tool Transport v7](builtin-tool-transport-v7.md)
- [Structured Mention UI contract](../ui/components/structured-mentions.md#current-user-mention)
- [v0.67 current version](../versions/v0.67/README.md)
