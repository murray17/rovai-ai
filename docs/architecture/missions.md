---
document_type: architecture
authority: mission-architecture
status: accepted
last_updated: 2026-09-26
---

# Missions

Mission is the durable purpose of a public team Camp. Core owns its opaque relational identity, stable display number,
latest definition, independent business status, activity facts and execution workspace. Camp remains the sole owner of conversation, membership, lead,
drafts, published files and execution. Renderer does not create a parallel conversation model.

`MissionService` applies atomic commands through the existing gateway. The scheduler enters preparing
only after execution admission; the application coordinator then resolves or recovers the Mission workspace
outside the SQLite lock. Preparation and cleanup admission share a short fence so an accepted cleanup intent
cannot race reuse of the same workspace. The durable intent then runs under a separate serialized cleanup worker,
so Git removal does not hold preparation or ordinary Mission operations for unrelated workspaces. Preparation
persists association before Git work and rechecks claim fences before launching the Runtime. Non-Git projects
retain their original cwd. A worktree is retained throughout ordinary Mission use. Standalone cleanup records
two asynchronous steps in its existing association; a later preparing phase restores the branch/worktree
according to actual resource state.

`MissionGit` reads the source checkout's current local branch and `HEAD` when the first admitted Run enters
preparing, and again only when both previously managed Git resources have been removed. It uses the resolved
commit, the Host-resolved Git executable and verified ownership to create, restore or clean worktrees. Cleanup
verifies the directory and managed branch as independent resources, persists the managed-branch OID on the first
attempt, and removes the verified clean Worktree without force before checking branch use and conditionally deleting
the local Mission branch at that OID. A different named checkout is retained as a branch; a detached commit must be
reachable from another persistent reference. Its two
durable checkpoints let retries skip the completed worktree step and reuse the saved OID; an absent resource is
idempotent without widening cleanup beyond the verified path, registration or staging root.
The command normally commits `cleanup_pending` before notifying the worker, but a preflight dirty or unsafe detached
refusal leaves a ready workspace ready. Startup/periodic recovery scans unfinished pending rows only. A worker failure
becomes `cleanup_failed` unless an intact-resource audit proves that no Worktree removal occurred for a still-live
Mission, in which case the attempt ends back at `ready`; failed rows are never automatically retried. The same audit
lets an explicit retry or later execution recover legacy non-destructive failures without trusting checkpoint booleans.
The cleanup request performs only permission, durable-state, occupancy and idempotency admission; the worker owns
the only filesystem/Git safety observation. Its ordinary successful attached-worktree path combines identity,
`HEAD`, managed OID and actual checkout into one Git observation, then uses non-force Worktree removal, one branch
occupancy listing and one conditional reference deletion: at most four Git processes, with no separate status scan.
Exceptional detached, missing-reference, stale-registration and failure diagnosis may require additional calls.
Each attempt logs queue, safety, removal, branch and publication timings. Successful live cleanup
keeps both completed checkpoints for reconstruction; successful orphan cleanup removes the workspace row.

For an existing persistent Worktree, execution admission validates canonical paths, repository identity,
registration, owner marker, Host and occupancy without requiring its current branch to equal the persisted
managed branch. Checkout observation is a separate best-effort read: branch plus `HEAD`, detached `HEAD`, or
unavailable. It is neither persisted nor allowed to change resource ownership. A branch change, missing managed
branch, detached `HEAD`, checkout-observation failure or unavailable Diff base cannot alone block Runtime launch.
Rovai does not switch or adopt branches and does not rewrite the fixed base.

MissionGit computes cumulative changes from the recorded `base_sha` to the current Worktree content with an
independent temporary index, including committed, staged, unstaged and untracked changes. One changes request
returns checkout observation and file list together. Its bounded process-local `viewId` retains only request
association and file metadata, not a temporary index or historical content. A file request regenerates a private
index and current list, rejects an association that is no longer applicable, and then runs the path-scoped Diff.
The normal list-read path uses three Git processes: one combined `rev-parse` reads and validates the Worktree root,
Git/admin/common directories, real/shared index paths, `HEAD`, actual branch and fixed base; one private-index
`git -c core.splitIndex=false add -A -N` prepares tracked and untracked entries; and one combined raw/numstat Diff
produces the file set. Index and shared-index files are copied with filesystem operations, and the real index is
never written. Repositories without a materialized index or with another exceptional layout may use an additional
safe initialization or diagnostic call. `missions.fileDiff` repeats the current-view read before its path-scoped
patch call so `same_view` remains authoritative; no long-lived Git-result cache, watcher, worker or timer is added.
Multiple outstanding handles prevent a late old list request from replacing the newer handle; Renderer also
discards superseded responses and clears file detail on refresh. This deliberately provides a current dynamic
view, not a filesystem-atomic snapshot or a workspace versioning system. Git and actual files are the authority,
not Agent narratives. The Worktree is an execution location, not an Agent capability.

User definition edits use an internal optimistic revision so stale dialogs cannot overwrite newer title or
description. Agent updates remain field patches with last-commit-wins semantics and never see that revision.
Only the latest title/description are retained; activity and start evidence keep field-change/reference facts,
not historical definition bodies. Each Agent conversation keeps the latest Mission detail version successfully
delivered to Runtime. After its first accepted Mission input, a newer definition adds one exact `updateNotice`
to Mission Run Facts until an input carrying that version is accepted. `mission get` is a pure read.

Mission keeps its shared UI projection path-free. The Agent read side has two deliberately deep projections:
`mission.list` queries only number, Camp, title, status and update time, while `MissionAgentInfo` joins one current
definition with ordered structured source attachments. Both are available to every effective authenticated
AgentRun across all Missions and do not reuse the target Camp's mutation authorization. Omitted-ID `mission.get`
resolves only the authenticated Run's current Camp; an explicit internal `rvm_...` ID resolves directly and never
switches the current Mission. `mission.update` and `mission.status` accept no target selector and still require
the current active membership and exact execution fence.

Status mutation is independent from message publication. `sourceMessageId` is an optional association for every
status; when present it must resolve to a current public message in the same Camp, and when omitted it clears any
previous association. Core never publishes, searches for or implicitly chooses a message during a status update.
This does not weaken mutation authorization or change Run admission, cancellation or completion.

Mission execution presentation is derived from Camp-owned queue facts rather than business status. A dedicated
Mission start Delivery in `waiting`/`claimed`, or any non-terminal AgentRun in the Mission Camp, makes the start
entry unavailable; the same predicate is enforced by `missions.start` in its command transaction. Only
`queued`/`running`/`waiting` AgentRuns contribute executing members, so an unclaimed Delivery hides an accepted
start without claiming that execution has begun. Delivery claim emits the ordinary navigation invalidation,
allowing the board, drawer and full conversation to observe the queued Run before Runtime connection or output.

Database relations, internal events, Agent results and new Run Facts share that same internal ID. The stable number
is not returned to Agents; Renderer alone formats it as `M-xxx` for user-facing Mission surfaces and managed
workspace names. No Agent-side ID translation layer exists.

The read side does no filesystem observation, so registered attachment identity, saved metadata and original
path remain discoverable even when the source later disappears. Built-in invocation evidence continues to
project definition facts without raw attachment paths. The opaque internal ID is shared by relations, audit,
Agent-facing results and Context.

The opaque ID remains the relational and Agent key. A monotonic integer is the human and Git naming identity:
UI renders `M-018`, while the paired branch and sibling worktree use `rovai/mission/018` and `<repo>-mission-018`.
Deleted numbers are never reused; collision suffixes do not change the number. Context materialization projects compact identity/status and trusted start intent. The actual workspace
snapshot has its own dynamic section and acceptance marker, fenced to the native binding/generation.
No Mission business version is taught to Agents; field patches use last-committed values.

Desktop, wide Web and Mobile share Mission commands and the existing CampWorkspace. Desktop drawer and full
conversation preserve one mounted composer/preview owner; Mobile uses a status list and full conversation with
board return, retaining the same Camp draft and preview ownership. Renderer consumes
Core's cleanup capability and does not infer it from Mission status. Deletion defaults to leaving worktree and
branch in place. Optional cleanup records its intent in the same transaction that deletes the Mission, removes
the card immediately, and exposes only failed orphan work through the existing cleanup route; retained resources
never enter that route. Protocol and failure behavior live in [Mission v11](../contracts/mission-v11.md); UI in
[Mission board](../ui/components/mission-board.md). Reasons for the durable workspace and simplified model
interface are in [V1.59-D11](../versions/v1.59/decisions.md#v1-59-d11); the explicit minimal cleanup choice is in
[V1.59-D14](../versions/v1.59/decisions.md#v1-59-d14). Global discovery and current-only mutation are explained
by [V1.61-D01](../versions/v1.61/decisions.md#v1-61-d01). Status/message decoupling is explained by
[V1.62-D01](../versions/v1.62/decisions.md#v1-62-d01); asynchronous cleanup ordering is explained by
[V1.62-D02](../versions/v1.62/decisions.md#v1-62-d02); managed branch and observed checkout separation is
explained by [V1.62-D04](../versions/v1.62/decisions.md#v1-62-d04).
