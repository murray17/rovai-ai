---
document_type: contract
name: Notification Episode
version: v9
status: accepted
source_version: v1.71
last_updated: 2026-09-27
---

# Notification Episode v9

v9 inherits [v8](notification-episode-v8.md)'s immutable Occurrence / mutable Disposition, Journal cursors,
exact acknowledgement, retention and foreground Camp quieting. Inbox and changes wire `schemaVersion` is **9**.
Migration **175** accepts the exact v1.70/schema 124 source and advances to v1.71/schema **125**. It retains old
Occurrences, dispositions, cursors and preference choices, and does not backfill terminal history.

## Sources and identities

| New semantic | Episode kind / subject | Occurrence source | Producer |
| --- | --- | --- | --- |
| `round_completed` | `round` / root message ID | `round`, revision 1 | Entire message-connected component succeeds |
| `single_chat_reply` | `single_chat` / private final message ID | `single_chat_message`, revision 1 | Single Chat Run succeeds with persisted final message |
| `mission_needs_you` | `mission` / Mission ID | `mission`, transition revision | Actual entry into `needs_you` |
| `mission_status_changed` | `mission` / Mission ID | `mission`, transition revision | Actual entry into `not_started`, `in_progress`, `completed` |
| `task_status_changed` | `task` / Task ID | `task`, transition revision | Actual entry into `pending`, `in_progress`, `blocked`, `completed`, `cancelled` |

Existing `approval_pending`, `user_mention`, `turn_failed`, `turn_incomplete` remain. New public Runs do not emit
`turn_completed`; existing occurrences remain readable. Failures and incomplete outcomes identify the exact Run,
including its frozen private destination. A user-requested cancellation never generates a success or failure heads-up.

A notification round is a **notification-only** connected component: every `agent_run_input` connects its message and
Run; every public message's `source_agent_run_id` connects it to its producing Run. All inputs of a batch participate,
not just `anchorMessageId`. Components sharing a Run merge transitively. A Camp ID alone creates no edge.
At least one published user / external Principal message must be present. The lexically minimum such message ID
identifies the component. Every related Run must have succeeded and every delivery of its messages must be settled;
waiting, claimed, failed or cancelled deliveries and non-success Runs prevent success. Publication and tombstone
boundaries remain authoritative. The projection probes synchronously when Runs or deliveries finish and when messages
publish; a unique round record prevents replay. It is not a scheduler, execution aggregate, budget or permission owner.

Mission/Task notifications are admitted within the domain command transaction. Same-state writes, title/detail edits,
source-link-only changes and idempotent command replay do not admit another occurrence. User-authored status operations
do not admit heads-up facts. Leaving a Mission's `needs_you` state resolves its old question through the existing exact
Disposition invalidation, including user changes. Task `blocked` does not imply a user response is required.

## Projection and actions

New action kinds are `open_mission` and `open_task`; existing `open_agent_run` and `open_single_chat` identify round
completion and private replies. Optional `action.subject` has:

- `kind`: `round | mission | task`; `id`, current `title`;
- frozen transition `status: string | null`;
- explicit `sourceMessageId: string | null`, producing actor `sourceAgentRunId: string | null`;
- `relatedRunIds: string[]`, populated only for a completed round.

A Mission question comes only from the transition's explicit, same-Camp published `sourceMessageId`. It need not
mention the user. The existing structured-message summary renderer produces its body; withdrawn/missing content is
unavailable. Without that link, show only Mission title + “需要你”; never synthesize an explanation. Business action
availability depends on the exact Mission/Task, not availability of its optional question message. Business Episodes
display the latest transition while retaining independently addressable historical occurrences. Acknowledging the latest
transition never changes that display back to an older unread status; the newest remaining historical acknowledgement
target is exposed as a secondary action, separately from the latest primary subject.

## Preferences and coalescing

The previous five Boolean fields remain. Add required `singleChatHeadsUpEnabled`, `missionNeedsYouHeadsUpEnabled`,
`missionStatusHeadsUpEnabled` (default true), and `taskStatusHeadsUpEnabled` (default false). Add required unique arrays:
`missionStatuses` accepts `completed | in_progress | not_started`, default `[completed]`; `taskStatuses` accepts
`completed | blocked | cancelled | in_progress | pending`, default `[completed, blocked, cancelled]`. Empty filters
are valid. Unsupported or duplicate values reject with `notification_episode.invalid_status_filter`. Existing CAS,
idempotent update and conflict recovery apply to the entire preference snapshot; disabling a switch retains its filter.

When both categories are eligible, a Mission `needs_you` signal replaces a Mention with the **same source message ID**.
A Mission `completed` transition replaces round completion only when its actor Run belongs to that round. Core skips
subordinate fresh signals based on durable source identity and current preferences; Renderer removes subordinate
queued presentations when the preferred signal arrives later. Independent signals and immutable facts remain separate.
No text matching, Camp-wide collapse, acknowledgement or replay of previously suppressed cards is allowed.
