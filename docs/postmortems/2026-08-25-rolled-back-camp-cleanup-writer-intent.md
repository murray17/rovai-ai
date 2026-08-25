---
document_type: postmortem
incident_id: INC-2026-08-25-CAMP-CLEANUP-WRITER-INTENT
incident_date: 2026-08-25
status: closed
systems:
  - camp-attachment-publication
  - camp-attachment-view-recovery
  - agent-run-admission
  - agent-run-scheduler
  - pending-camp-lifecycle
  - macos-packaged-app
last_updated: 2026-08-26
---

# Rolled-Back Camp Cleanup Writer Intent Blocked AgentRun Admission

## Executive summary

On 2026-08-25, an AgentRun remained `queued` from 17:20 while its CampTurn stayed `running`. It had
no lease, `startedAt`, failure, or projected wait reason, although its Member and Runtime were ready
and no other nonterminal Run was using capacity. The scheduler log snapshot contained 607 failed
claim attempts with `camp_attachment_view_not_ready`. A later reproduction in a second Camp with no
attachments, using the new pre-claim verification path, failed before Runtime launch with the public
error `camp_attachment_view_unavailable` instead of remaining indefinitely queued.

Both manifestations had the same blocker. The Camps' Published Attachment Views were `ready`, but
their journals retained a canceled `camp_delete_cleanup` operation in the contradictory terminal
state `status = rolled_back, resolution_state = unresolved`.

The admission predicate treated every unresolved journal row as a live publication writer intent
without considering operation kind or terminal status. It therefore rejected the Camp even though
there was no publication to finish, no nonterminal operation, and no attachment to verify. A
read-only scan found two live Camps with this exact stale state and no live Camp with a genuinely
nonterminal unresolved operation.

The stale state was introduced when the unified publication lifecycle added a resolution axis but
the existing Camp cleanup cancellation path continued to settle only its status axis. The
attachment-local degradation fix merged earlier that day did not create the cleanup row. Its
pre-claim verification changed the latent symptom from an indefinitely queued Run to an explicit
terminal failure, which made the pre-existing lifecycle defect visible.

The incident was resolved by settling canceled cleanup operations as `resolution_state = failed`,
repairing only the historical terminal shape during startup reconciliation, and extending the
cleanup regression test through the actual writer-intent admission predicate. The fix was merged
in [PR #59](https://github.com/murray17/rovai-ai/pull/59). The affected database retained its Camp,
message, attachment, AgentRun, and audit records. The initially blocked Run never acquired a lease,
and the later failed Run stopped before input delivery to a Runtime.

This is a blameless review. Cleanup cancellation and publication resolution were developed as
separate lifecycle concerns, and the missing cross-axis invariant was not represented at their
shared admission seam. The purpose of this document is to make that system gap and its recurrence
criteria explicit.

## Incident metadata

| Field | Value |
|---|---|
| Detection | User first reported an indefinitely queued Camp; a later confirming reproduction surfaced the same blocker as an explicit failure after the attachment-local degradation build |
| Affected path | Camp Published Attachment View reconciliation before AgentRun claim |
| Trigger condition | A canceled `camp_delete_cleanup` row remained `rolled_back / unresolved` |
| User-visible symptom | Older dispatch path: Run stayed queued without a wait reason; newer pre-claim path: Run failed with `camp_attachment_view_unavailable`; neither produced model output |
| Directly affected population | Two live Camps matched the exact stale terminal state in the diagnosed database |
| Runtime delivery | The queued Run never acquired a lease; no evidence of Runtime input delivery existed for the later failed Run |
| Data integrity | SQLite `quick_check` passed; persisted entity counts were unchanged across package installation |
| Resolution | Lifecycle settlement and exact-shape startup repair in commit [`f1b0bb8`](https://github.com/murray17/rovai-ai/commit/f1b0bb8a541c1abda05ccf1ad0d79deb6bd62f0f), merged as [`67a51df`](https://github.com/murray17/rovai-ai/commit/67a51df29c581e5ece27c87737612ef48042c707) |
| Incident duration | Not calculated because the first user-visible failure and verified daily-App recovery timestamps were not retained as structured incident data |

## Impact

The initial AgentRun could not leave the queue/admission boundary, so the requested work did not
execute and its CampTurn appeared active without progress. The scheduler retried the same candidate
without persisting a wait or terminal reason. Retrying on the newly packaged attachment-degradation
build produced an explicit terminal failure until the separate cleanup-lifecycle repair was
installed and startup reconciliation could settle the historical row.

At diagnosis, exactly two live Camps had a `camp_delete_cleanup` operation in the
`rolled_back / unresolved` state. Both Views were `ready`; the reported Camp had no View entries or
message attachments. A minimized database check returned:

```text
kind-agnostic unresolved writer intent: true
nonterminal unresolved operation:       false
unresolved publication operation:       false
```

This established that the observed failure was broader than its true risk: the gate was refusing
the entire Camp for a terminal cleanup bookkeeping inconsistency, not protecting an in-flight
publication or unverified attachment bytes.

No Camp, CampMessage, attachment, AgentRun, event-log, or audit row was deleted to recover. The
failed Run did not reach Runtime input delivery, so there was no duplicate external execution to
reconcile. No database downgrade was required; downgrade would not have repaired the contradictory
operation state and could have discarded newer derived projections.

## Detection and response

The user first detected the incident from a Camp that stayed queued. The Run projection showed no
lease, `startedAt`, failure, or wait reason; process logs showed 607 failed claims with
`camp_attachment_view_not_ready`. Ready Member and Runtime projections, prior successful Runs, and
the absence of another nonterminal Run ruled out capacity and Runtime readiness.

The later confirming reproduction occurred after restarting a package that contained the latest
attachment-local degradation fix. Build provenance was checked to rule out an older Core: the
running binary had the expected new Mach-O identity. The Camp's View and attachment rows were then
inspected read-only, showing `ready`, zero entries, and no attachment source for a digest failure.

The latest AgentRun private detail narrowed the rejection to
`camp_attachment_view_not_ready`. Comparing the broad admission predicate with two reduced
predicates isolated a single stale cleanup operation. A database-wide read-only scan then found the
same terminal shape in one other Camp and no corresponding nonterminal unresolved operation.

The response deliberately did not delete journal rows or mutate the daily database by hand. The
repair was implemented in the normal startup reconciler, tested against a simulated historical
row, merged through CI, and delivered in a newly built package. That preserved the journal as
evidence and gave every affected installation the same deterministic recovery path.

## Timeline

All times are Asia/Shanghai. Database event times below were converted from their persisted UTC
timestamps. Times not retained as structured evidence are left imprecise.

| Time | Event |
|---|---|
| 2026-08-20 18:59 | Commit [`99df95b`](https://github.com/murray17/rovai-ai/commit/99df95b75c4a6fa8eda82f9cf254cdaf8ba679b2) unified attachment publication and Agent file delivery. Migration 102 added `resolution_state` with an `unresolved` default, while cleanup cancellation continued to update only `status`. |
| 2026-08-25 17:13:05.778 | The first of two later-observed live Camps recorded a canceled cleanup as `rolled_back / unresolved`. Its View returned to `ready`. |
| 2026-08-25 17:20:06.601 | A later AgentRun in that Camp entered `queued`. It never acquired a lease or `startedAt`; the sampled log accumulated 607 rejected claims with `camp_attachment_view_not_ready`. |
| 2026-08-25 17:21 | The reported Camp recorded the same stale cleanup shape. Its View returned to `ready` and remained empty. |
| 2026-08-25 17:33 | [PR #58](https://github.com/murray17/rovai-ai/pull/58) merged attachment-local degradation and pre-claim verification. It did not change cleanup cancellation settlement. |
| 2026-08-25 17:44 | The newly packaged Core from PR #58 started against the daily data directory. |
| 2026-08-25 17:47 | A new AgentRun in the reported Camp was queued and then failed with `camp_attachment_view_unavailable`; no Runtime input was delivered. |
| 2026-08-25, shortly after failure | Read-only predicate minimization proved that only the terminal cleanup row, not a publication, attachment, or nonterminal operation, was holding the gate. A database-wide scan found two affected Camps. |
| 2026-08-25 17:47 | [PR #59](https://github.com/murray17/rovai-ai/pull/59) was opened with atomic cleanup settlement, startup repair, and regression coverage. |
| 2026-08-25 17:52 | PR #59 merged after Rust tests, formatting and Clippy, database smoke, Windows compile, and documentation governance checks passed. |
| 2026-08-25, after merge | A package built from merged `main` passed signature/build-identity checks and isolated startup smoke. It was installed without modifying the daily database; recovery would run on the next canonical-App startup. |

## Technical root cause

The journal has two lifecycle axes with different purposes:

```text
status:           is physical cleanup work still active?
resolution_state: does this row still hold a semantic writer intent?
```

For a canceled Camp deletion, cleanup correctly restored the prior View state and changed the
operation status to `rolled_back`. After Migration 102, however, the same row also had
`resolution_state = unresolved` by default. The cancellation transaction did not settle that new
axis:

```text
camp_delete_cleanup planned / unresolved
                 |
                 | deletion canceled
                 v
camp_delete_cleanup rolled_back / unresolved
                 |                         ^
                 | terminal status         | stale writer-intent axis
                 +-------------------------+
```

Startup recovery intentionally excluded `completed` and `rolled_back` operations from incomplete
operation processing. That was correct for the physical status axis, but it meant the stale
resolution axis was never repaired.

AgentRun admission called `database_has_unresolved_writer_intent`, whose query selected any row for
the Camp where `resolution_state = unresolved`. It did not restrict the operation to publication
kind or a nonterminal status. Consequently, the terminal cleanup row looked indistinguishable from
a real in-flight publication at the gate and caused `camp_attachment_view_not_ready`.

The systemic root cause was the absence of one invariant across those seams: when an operation is
terminal in both its physical and semantic lifecycles, the transition must atomically settle every
axis that participates in future admission. A physically rolled-back publication can still require
semantic failure resolution, but a canceled cleanup has no such publication work left. Unit
coverage proved that cancellation restored the View to `ready`, but did not cross the writer-intent
predicate that the scheduler actually used.

## Trigger conditions and likelihood

The defect required all of the following in a build containing Migration 102 but not PR #59:

1. the Camp had a Published Attachment View row, so cleanup preparation returned an operation;
2. Core prepared `camp_delete_cleanup` before a delete or pending-discard business mutation;
3. the business mutation did not apply, or pre-mutation fencing failed, so Core cancelled cleanup;
4. a later AgentRun in the same Camp reached dispatch admission.

Given a prepared cleanup reached the affected cancellation function, recurrence was deterministic:
the old SQL always left the new operation's default resolution as `unresolved`. In the measured
local post-migration sample, both rolled-back cleanup rows were unresolved (`2/2`). That small,
selected sample confirms the mechanism but is not a population-wide probability estimate. Overall
frequency depended on how often a prepared cleanup was cancelled.

Source inspection found one plausible routine route with high conditional likelihood. The
`CampWorkspace` draft cleanup effect depends on Camp ID only and captures the snapshot's
`activationState`. A pending Camp's first accepted message activates the same Camp ID, so the effect
is not recreated solely because activation changes. Leaving later with an empty draft can run the
older closure and request `camps.discardPending`; Core correctly rejects the now-active Camp, then
cancels the prepared cleanup.

The operation journal proves the generic cancelled-cleanup trigger but does not retain enough typed
route evidence to prove that this Renderer sequence created either observed row. Deletion blockers,
Runtime fencing failure, or another rejected pending-discard condition could reach the same
cancellation function. The UI route is therefore the strongest source-supported hypothesis, not a
confirmed incident fact.

After PR #59, all of these cancellation routes settle writer intent and no longer produce this
admission failure. Existing contradictory rows are repaired during startup reconciliation.

## Contributing factors

### Resolution state was added to a shared operation table

The publication resolution model applied to rows of multiple kinds. The database default made new
rows safe for publication staging, but also made every newly created cleanup row unresolved unless
each terminal path explicitly settled it.

### Predicate naming hid broader query semantics

`has_unresolved_publication` and `database_has_unresolved_writer_intent` described semantic
publication concepts, while their SQL matched every operation kind. Reviewers could reasonably
infer a narrower predicate from the names than the database actually enforced.

### Recovery followed status but admission followed resolution

The recovery scan ignored terminal statuses; admission ignored status entirely. Each local rule was
plausible in isolation, but together they made the contradictory row permanent and Camp-blocking.

### Regression coverage stopped at the View state

The cleanup rollback test asserted that the Camp View returned to `ready`. It did not assert the
operation's resolution state, exercise the shared writer-intent predicate, or attempt a subsequent
AgentRun admission.

### A Renderer lifecycle callback can exercise cancellation routinely

The pending-Camp leave callback can outlive the pending-to-active transition because its effect is
keyed only by Camp ID. Core rejection is the correct authority boundary, but it made the faulty
cleanup-cancellation path more likely to execute during ordinary navigation.

### The earlier symptom involved real attachment integrity

The immediately preceding incident involved an Authority/View digest mismatch. Seeing the same
public Camp error after that fix made an attachment regression a plausible first hypothesis, even
though the new Camp had no attachments. The public error did not identify the blocking operation
kind and lifecycle state.

## Why existing safeguards did not prevent the incident

- The View returned to `ready`, so View-state reconciliation alone considered cleanup rollback
  complete.
- Startup recovery skipped `rolled_back` rows and therefore never inspected the stale orthogonal
  resolution field.
- The writer-intent check failed closed, but its match set was wider than the unsafe state it was
  intended to guard.
- The older claim path logged the unexpected writer-intent error and returned without persisting a
  wait or terminal result, so repeated safe refusal appeared as an infinite queue.
- PR #58 correctly moved verification before Run claim and added attachment-local repair, but it had
  no reason to rewrite unrelated terminal cleanup rows without evidence of this lifecycle defect.
- CI covered cleanup rollback and publication resolution separately, not the full sequence
  "cancel cleanup, then admit a future Run."
- No automated invariant or diagnostic reported terminal operations that still held unresolved
  writer intent.

## What was not the cause

- The reported Camp contained no attachment entries, so no Agent-generated or user-generated
  attachment and no attachment digest caused this failure.
- PR #58 did not create either stale cleanup row. Both rows came from the older cleanup settlement
  behavior; PR #58 changed how the latent admission failure surfaced.
- The package was not stale during the confirming reproduction. Its Core build identity matched the
  PR #58 build under test.
- SQLite schema version or database corruption did not cause the failure. `quick_check` passed, and
  the contradictory row was valid under the then-current schema constraints.
- User retry behavior did not create the poison state. Every retry deterministically encountered the
  same persisted terminal row.

## Resolution and recovery

The fix made new cancellation and historical recovery converge on the same terminal meaning:

1. `cancel_camp_delete_cleanup` now atomically writes
   `status = rolled_back, resolution_state = failed` while restoring the prior View state.
2. Before scanning incomplete operations, startup reconciliation updates only the historical exact
   shape `kind = camp_delete_cleanup AND status = rolled_back AND resolution_state = unresolved` to
   `failed`.
3. The cleanup regression test now proves the View, status, and resolution tuple, calls the real
   writer-intent predicate, simulates the historical stale row, runs reconciliation, and proves that
   the gate is released.
4. The change was merged through PR #59 and packaged from the merge commit. CI passed Rust fast
   tests, Rust database smoke, formatting and Clippy, Windows x64 compile, and documentation
   governance.

The startup update is deliberately narrow. It does not reinterpret active operations, publication
rows, successful resolution ledgers, View entries, messages, or attachment Authority. It repairs a
state that was already physically terminal and restores the semantic outcome that cleanup
cancellation should have recorded originally.

## What went well

- The failed Run stopped before Runtime input delivery, preventing duplicate or uncertain external
  side effects.
- Read-only comparison of the broad and minimized predicates separated the exact blocker from the
  surrounding attachment system quickly.
- The scan measured the affected population before repair and found only one precise historical
  shape across two live Camps.
- Existing journal evidence made a deterministic startup repair possible without deleting the Camp
  or editing the daily database by hand.
- Database integrity and persisted entity counts remained stable across diagnosis and package
  installation.
- The fix was small, covered both future transitions and historical recovery, and passed the full PR
  gate before merge.

## What could be improved

- Terminal transition helpers should settle every admission-relevant axis by construction instead
  of relying on each caller to remember fields added by later migrations.
- Tests for journal rollback and cancellation should end at the next public seam—Run admission or
  publication eligibility—not only at local View state.
- Renderer leave callbacks should use current activation state or be invalidated when a pending Camp
  activates without changing identity.
- Unexpected dispatch-check failures need a bounded persisted result or stable wait reason, plus
  rate-limited diagnostics, instead of an unbounded stderr loop.
- Private diagnostics should identify the blocking operation kind, status, and resolution state in
  a redacted form so an empty Camp is not initially diagnosed as an attachment digest failure.
- Startup and support diagnostics should count contradictory terminal/unresolved rows without
  exposing Camp IDs or user content.
- Incident timestamps should be stored as structured milestones so mitigation and recovery duration
  do not need to be reconstructed from process and database evidence.

## Where we were fortunate

- The broad gate failed closed before launch; it blocked useful work but did not expose unverified
  bytes to a Runtime.
- The affected Camp was empty, which made it possible to disprove an attachment-integrity hypothesis
  without inspecting user content.
- The stale row retained a precise operation kind and terminal status, allowing an exact historical
  repair rather than a broad data rewrite.
- Only two live Camps matched the defect when measured.

## Corrective and preventive actions

Status reflects the evidence available when this postmortem was published. Accountable roles must
be mapped to a named maintainer before an open action starts.

| ID | Action | Accountable role | Priority | Status | Evidence or target |
|---|---|---|---|---|---|
| PM-01 | Settle canceled Camp cleanup status and writer intent in one transaction | Camp Attachment Lifecycle | P0 | Complete | [`f1b0bb8`](https://github.com/murray17/rovai-ai/commit/f1b0bb8a541c1abda05ccf1ad0d79deb6bd62f0f) |
| PM-02 | Repair only historical `camp_delete_cleanup / rolled_back / unresolved` rows before startup admission | Camp Attachment Recovery | P0 | Complete | [`f1b0bb8`](https://github.com/murray17/rovai-ai/commit/f1b0bb8a541c1abda05ccf1ad0d79deb6bd62f0f) |
| PM-03 | Extend cleanup rollback coverage through the real writer-intent predicate and historical recovery | Core Testing | P0 | Complete | `camp_delete_cleanup_journal_rolls_back_or_recovers_from_the_business_commit` |
| PM-04 | Add a table-driven lifecycle matrix for every operation kind and status, including which physically terminal rows may still require semantic resolution | Core Testing | P1 | Planned | Target: Camp Attachment journal invariant suite |
| PM-05 | Centralize or type transitions that are terminal on both axes so status and resolution cannot be settled independently by accident | Camp Attachment Lifecycle | P1 | Planned | Target: next journal lifecycle change |
| PM-06 | Add redacted startup diagnostics for terminal/unresolved contradictions and admission-blocking operation class | Core Observability | P1 | Planned | Target: diagnostics contract review before implementation |
| PM-07 | Record structured detection, mitigation, package activation, and verified recovery milestones for local release incidents | Release Engineering | P2 | Planned | Target: incident and local release checklist update |
| PM-08 | Invalidate or refresh pending-Camp leave cleanup when the same Camp activates; add a Renderer lifecycle regression | Camp Renderer | P1 | Planned | Target: next pending-Camp lifecycle change |
| PM-09 | Give unexpected dispatch-check failures a bounded persisted outcome or stable wait reason with rate-limited diagnostics | Scheduler Observability | P1 | Planned | Target: scheduler error-handling design and regression |

## Recurrence criteria

This incident is considered to have recurred if any of the following is observed:

- a canceled `camp_delete_cleanup` with `status = rolled_back` still makes
  `database_has_unresolved_writer_intent` return true for its Camp;
- a canceled Camp cleanup leaves `resolution_state = unresolved`;
- startup reconciliation leaves the exact historical cleanup shape unrepaired;
- a scheduler repeatedly logs the same terminal-cleanup writer-intent rejection while leaving its
  Run queued without a persisted wait or failure reason;
- a zero-attachment, `ready` Camp is rejected solely because of a terminal cleanup journal row; or
- a cleanup rollback test passes at the View state but the Camp cannot admit the next eligible Run.

An actual unresolved publication, unsafe root identity, unknown filesystem node, containment error,
or nonterminal cleanup remains a valid fail-closed condition and is not a recurrence of this
incident.

## Lessons

An operation that is finished on both lifecycle axes is only terminal if every downstream gate
agrees. When one table combines physical operation status with semantic resolution, a transition
that finishes both must settle them atomically and be tested at the next consumer, not merely
asserted in isolation. Predicate names are not a substitute for reading their match set, and
recovery scans must cover contradictory cross-axis states even when the physical status is already
terminal.

The incident also demonstrates why a fail-closed boundary still needs precise scope. Attachment
integrity failures should remove only unsafe attachment availability, while a canceled cleanup
should release its writer intent completely. Preserving public history and audit evidence does not
require preserving a stale gate.

## References

- [PR #58: attachment-local degradation](https://github.com/murray17/rovai-ai/pull/58)
- [PR #59: release rolled-back Camp cleanup writer intents](https://github.com/murray17/rovai-ai/pull/59)
- [Introducing commit `99df95b`](https://github.com/murray17/rovai-ai/commit/99df95b75c4a6fa8eda82f9cf254cdaf8ba679b2)
- [Fix commit `f1b0bb8`](https://github.com/murray17/rovai-ai/commit/f1b0bb8a541c1abda05ccf1ad0d79deb6bd62f0f)
- [Camp Published Attachment View architecture](../architecture/camp-published-attachment-view.md)
- [Camp Published Attachment View v4 contract](../contracts/camp-published-attachment-view-v4.md)
- [Camp Permanent Deletion v2 contract](../contracts/camp-permanent-deletion-v2.md)
- [Camp Attachment v5 contract](../contracts/camp-attachment-v5.md)
- [V1.28-D10: attachment-local integrity degradation](../versions/v1.28/decisions.md#v1-28-d10)
- [Cleanup lifecycle implementation and regression](../../crates/rovai-core/src/camp_attachment_view.rs)
- [Writer-intent admission predicate](../../crates/rovai-core/src/camp_attachment_publication.rs)
- [Pending-Camp leave lifecycle](../../apps/desktop/src/renderer/src/CampWorkspace.tsx)
- [Pending-Camp discard caller](../../apps/desktop/src/renderer/src/App.tsx)
