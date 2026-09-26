---
document_type: contract
name: Current User Attention
version: v8
status: accepted
source_version: v1.71
last_updated: 2026-09-27
---

# Current User Attention v8

v8 inherits [v7](current-user-attention-v7.md)'s foreground Camp quiet scope and exact acknowledgement. The new
[Notification Episode v9](notification-episode-v9.md) semantics, including Mission, Task and private replies, use the same
quiet scope: entering a focused visible Camp removes its queued heads-up cards without reading their facts or replaying
them later. Settings group “会话 / 使命 / 任务”; source-based coalescing is presentation-only.

Mission and Task actions validate the exact subject in the target Camp and open its Mission introduction or Task detail.
An older Task omitted from the bounded Camp snapshot is anchored by its exact ID, just as older messages and Runs are.
Missing subjects fail closed. Private replies retain the original Conversation and Run, never a successor conversation.
Round/private Run visible acknowledgement matches the occurrence's exact Run identity through the observed Journal
boundary. Mission and Task status occurrences require their explicit acknowledgement; generic Camp visibility is not
such evidence. Card activation retains the existing exact acknowledgement-then-navigation behavior and error recovery.

Camp “有新回复” dots now derive from the first durable publication of non-withdrawn Agent messages, consistently with
Mission rows. Run termination alone creates no new-reply dot. The existing `latestCompletionGlobalSequence` wire field
retains its name but carries this publication boundary; `unread_completed` remains the marker literal. Running state
still has presentation priority. Public/private separation, monotonic `navigation.campViewed` and the distinction between
Camp viewed and exact Notification acknowledgement remain unchanged.
