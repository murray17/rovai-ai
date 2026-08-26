---
document_type: postmortem
incident_id: INC-2026-08-25-CODEX-OUTPUT-DELTA-CAMP-OPEN
incident_date: 2026-08-25
status: closed
systems:
  - codex-runtime-adapter
  - codex-host-ingress
  - execution-evidence
  - camp-open-read-model
  - renderer-runtime-activity
  - agent-run-recovery
last_updated: 2026-08-26
---

# Codex Command Output Delta Amplification Blocked Camp Open and Recovery

## Executive summary

On 2026-08-25, a local conversation remained on recovery after the application was restarted. An
initial stale Run in the first reported Camp was repaired, but recovery still did not complete. The
second blocker was a different Camp whose AgentRun had stopped making progress and was persisted as
`waiting / recovery_blocked`. Because that status was nonterminal, every normal open of that Camp
attempted to return the Run's complete Execution Evidence.

The Run had accumulated 84,620 Evidence rows. Of those, 78,837 rows (93.2%) were
`command.output.delta`: small stdout/stderr transport frames emitted while Codex commands ran. Their
declared content totaled 9,027,234 bytes; all Evidence content for the Run totaled 15,345,180 bytes,
before SQLite row, JSON envelope, IPC serialization, canonical-activity attachment, and Renderer
object overhead. The database snapshot contained 120,734 Evidence rows overall, including 97,893
command output deltas. A SQLite backup passed `quick_check`; the failure was read and projection
amplification, not database corruption.

Rovai had treated every Codex output frame as an append-only semantic Evidence record even though
Codex's terminal `item/completed.commandExecution.aggregatedOutput` already supplied the authoritative
Command result. The same frames also entered Renderer live state. Transaction batching reduced write
overhead but preserved one durable row and one UI event per frame. Camp open then deliberately loaded
complete Evidence for every nonterminal Run, turning the recovery-blocked Run's frame cardinality into
an unbounded open response and Renderer rebuild.

Immediate recovery preserved a pre-repair SQLite backup and converged the affected Run to a terminal
failure without deleting its Evidence. Once terminal, its history moved behind the existing exact-Run
lazy read path and the Camp could be opened without mounting all 84,620 rows. This operator recovery
did not solve recurrence.

The product correction was delivered in two stages. [PR #69](https://github.com/murray17/rovai-ai/pull/69)
made future Codex command output deltas transient: they no longer write Execution Evidence, update
Canonical Activity, create Managed Blobs, or enter Renderer live state; terminal `aggregatedOutput`
remains the single authoritative result. [PR #72](https://github.com/murray17/rovai-ai/pull/72) moved
the drop to Codex Host stdout ingress so output floods never enter Core's unbounded `codex_tx` queue.
Both changes intentionally leave historical Evidence and Blob data unchanged.

This is a blameless review. Durable per-event capture, complete nonterminal projection, and streaming
transaction batching were each locally understandable choices. The incident emerged because no seam
owned an end-to-end cardinality invariant distinguishing transport frames from semantic execution
facts.

## Incident metadata

| Field | Value |
|---|---|
| Detection | User reported that a conversation would not close normally; after App restart and repair of the first stale Run, recovery still failed and read-only inspection found the high-cardinality second blocker |
| Affected path | Codex stdout ingestion, Execution Evidence durability, nonterminal Camp open projection, and Renderer runtime-activity reconstruction |
| Trigger condition | A prolonged Codex Run emitted high-cardinality command output frames and later remained nonterminal as `waiting / recovery_blocked` |
| User-visible symptom | The Camp could not reach a usable open projection and restarting the App did not clear the restoring-conversation state |
| Diagnosed Run | 84,620 Evidence rows; 78,837 command output deltas; 15,345,180 declared Evidence content bytes |
| Diagnosed database | 120,734 Evidence rows; 97,893 command output deltas; 69,574,656-byte SQLite backup; `quick_check = ok` |
| Data integrity | No SQLite corruption was found; the pre-repair backup and all 84,620 Evidence rows were retained |
| Immediate recovery | Converged the recovery-blocked Run to terminal failure so historical Evidence moved behind exact-Run lazy loading |
| Recurrence prevention | [PR #69](https://github.com/murray17/rovai-ai/pull/69) and [PR #72](https://github.com/murray17/rovai-ai/pull/72) |
| Incident duration | Not calculated because user-visible detection, acknowledgement, and meaningful-paint recovery were not retained as structured timestamps |

## Impact

The affected Camp could not complete its normal open or cold-restore path while the bloated Run
remained nonterminal. Closing and restarting the application did not reduce the workload because the
Run status and Evidence were durable; startup selected the same Camp and encountered the same open
projection again.

The diagnosed Run contained this Evidence distribution:

| Evidence type | Rows | Declared content bytes |
|---|---:|---:|
| `command.output.delta` | 78,837 | 9,027,234 |
| `agent.text.delta` | 2,749 | 224,918 |
| `agent.reasoning.summary.delta` | 776 | 94,971 |
| Command started/completed | 777 | 5,020,264 |
| Reasoning summary started/completed | 1,140 | 383,600 |
| File change started/completed | 220 | 557,076 |
| Narration started/completed | 68 | 21,042 |
| Tool call started/completed and plan | 53 | 16,075 |
| **Total** | **84,620** | **15,345,180** |

These byte counts come from `content_byte_count`; they do not include SQLite record/index overhead,
payload preview envelopes, IPC JSON syntax, deserialized Rust/JavaScript objects, canonical activity
attachment, React state, or sorting/rebuild scratch space. Therefore 15.3 MB is a lower bound on the
material handled by the open path, not the peak process-memory measurement.

The snapshot also showed that 78,837 deltas were concentrated in one nonterminal Run. The broader
database had 97,893 delta rows out of 120,734 total Evidence rows (81.1%), demonstrating that this was
not a normal relationship between semantic operations and durable evidence volume.

No Camp messages, attachments, command terminal results, or Evidence rows were deleted to restore
access. No historical migration or compaction was shipped with the product fixes. Old Camps can still
retain their original row counts; after the affected Run became terminal, existing terminal-history
lazy loading kept those rows off the normal Camp open path.

### Causality boundary

The retained backup distinguishes two adjacent recovery problems. The first Camp named during
diagnosis had a stale nonterminal Run with zero Execution Evidence at backup time. Repairing that Run
did not restore the application, which led to discovery of the second Camp and its 84,620-row
nonterminal Run. This postmortem covers that second delta-amplification blocker.

The evidence therefore supports two narrower conclusions, not one broad one: stale Run lifecycle
state caused the first Camp's close/recovery defect, while delta cardinality made the second Camp's
nonterminal open projection unbounded. The delta rows must not be cited as the cause of the first
Camp's zero-Evidence stale Run merely because both symptoms occurred during the same recovery
sequence.

## Detection and response

The incident was detected by the user from the product surface, not from a cardinality alert. The
conversation first resisted normal closure. After application exit and restart, the target stayed on
recovery rather than reaching meaningful content. A first stale Run was repaired, but the user
reported that recovery still did not complete; investigation then found the high-cardinality second
blocker.

A read-only inspection of the daily database and its pre-repair backup established four facts:

- SQLite integrity was intact (`quick_check = ok`);
- the affected Run was `waiting` with `wait_reason = recovery_blocked` and had no `ended_at`;
- Camp open semantics classified that Run as nonterminal and therefore requested its complete
  Execution Evidence without a limit;
- 78,837 of the Run's 84,620 Evidence rows were stdout/stderr transport frames, not distinct Commands
  or Tool results.

The database was backed up before recovery. The affected Run was then made terminal while preserving
its Evidence, allowing normal Camp open to use summary data and defer terminal Run history until the
user selected the exact Run. The retained backup and current database both contain exactly 84,620
Evidence rows for that Run, so recovery did not depend on deleting the incident evidence.

The first product review removed delta durability and Renderer delivery but found a remaining queue
risk: Codex stdout was still parsed into `CodexIncoming` and sent through an
`mpsc::unbounded_channel` before Core recognized and discarded the delta. A second correction moved
classification and dropping to stdout ingress while preserving JSON-RPC response and server-request
routing. This closed both the persisted/read amplification and transient queue amplification paths.

## Timeline

All times are Asia/Hong_Kong. Persisted Runtime times were converted from UTC. Times not retained as
structured evidence are deliberately left imprecise.

| Time | Event |
|---|---|
| Before 2026-08-25 | Codex `command.output.delta` frames were normalized as durable Execution Evidence and Renderer live events. Streaming batches reduced transaction count but retained per-frame cardinality. |
| 2026-08-25 20:06:23 | The later-affected AgentRun was created and started. |
| 2026-08-25 20:07:01 | The Run persisted its first observed `command.output.delta`. |
| 2026-08-25 22:31:37 | The Run persisted its last observed delta. It had accumulated 84,620 Evidence rows, including 78,837 deltas, and later appeared as `waiting / recovery_blocked`. |
| 2026-08-25, time not recorded | The user could not close the first conversation normally. After exiting and restarting the App, the UI remained on recovery. |
| 2026-08-25 22:50 | A 69,574,656-byte SQLite backup was retained before repair. It later passed `quick_check` and preserved both recovery blockers for analysis. |
| 2026-08-25 22:52:22 | The first reported Camp's stale, zero-Evidence Run converged to terminal `cancelled`. Recovery still did not complete. |
| 2026-08-25 23:01:39 | The second Camp's 84,620-row Run converged from `waiting / recovery_blocked` to terminal `failed`; all Evidence rows remained present. |
| 2026-08-26 00:39 | [PR #63](https://github.com/murray17/rovai-ai/pull/63) merged continuous Tool grouping and two-level result disclosure. It did not create, delete, or compact delta Evidence. |
| 2026-08-26 10:08 | [PR #69](https://github.com/murray17/rovai-ai/pull/69) merged the future-data clean break: zero delta Evidence, Canonical Activity, Blob, or Renderer live events; terminal aggregate remained authoritative. |
| 2026-08-26, after PR #69 | A post-fix verification Camp completed multiple Runs with zero new `command.output.delta` Evidence rows. |
| 2026-08-26 13:04 | [PR #72](https://github.com/murray17/rovai-ai/pull/72) merged Host-ingress early-drop after a production-ingress test sent 100,000 valid deltas into a non-consuming receiver and observed zero `CodexIncoming` sends, followed by correctly ordered terminal events. |

## Technical root cause

The failure combined a semantic-classification defect with a read-cardinality coupling:

```text
Codex command stdout/stderr
  -> one outputDelta notification per transport frame
  -> CodexIncoming
  -> Core streaming batch
  -> one Execution Evidence row per frame
  -> one Renderer live event per frame

Runtime continuity ends
  -> AgentRun remains waiting / recovery_blocked
  -> Camp open treats Run as nonterminal
  -> load every Evidence row for the Run (no limit)
  -> serialize + IPC parse + canonical attachment + sort/rebuild
  -> Camp open/recovery cannot reach a usable surface
```

### Transport frames were misclassified as durable semantic evidence

`command.output.delta` only carries partial stdout/stderr bytes. A frame does not add a new Command
identity, lifecycle transition, exit status, or final result. Codex already provides those facts in
`item/started` and terminal `item/completed`, whose `commandExecution` payload includes `command`,
`status`, `exitCode`, and `aggregatedOutput`.

Persisting both sources duplicated the same output at different granularities: thousands of
transport records plus one terminal semantic result. Managed Blob thresholds could bound a single
large body but could not bound tens of thousands of individually small rows.

### Complete nonterminal Evidence made transport cardinality part of Camp open

The Camp open read model intentionally returns complete Evidence for `queued`, `running`, and
`waiting` Runs so an active execution can be reconstructed after refresh. It supplies no row limit
for that collection. This is a valid completeness requirement only when durable event cardinality is
semantically bounded.

Once the affected Run became `waiting / recovery_blocked`, it remained on that complete path. The
output-frame count therefore determined the open response size even though the Renderer did not need
each frame to display the final command output.

### Downstream dropping alone left an unbounded ingress queue

PR #69 correctly made deltas transient after they reached Core, but the Codex stdout reader still
constructed `CodexIncoming` and sent it into `mpsc::unbounded_channel`. A high-output command could
therefore enqueue JSON events faster than Core consumed and discarded them. Replacing the whole
channel with a bounded blocking channel was unsafe because the same reader also handles JSON-RPC
responses and terminal events.

PR #72 separated method classification from route validation at Host ingress. Valid current-route,
stale, malformed, unbound, and legacy output-delta notifications are all consumed before
`CodexIncoming` construction. ID-bearing messages retain the existing server-request response path,
and semantic/terminal events continue through Core.

## Contributing factors

### Transaction batching optimized the wrong unit

Batching streaming deltas reduced SQLite transaction overhead, which improved throughput, but the
durability unit remained one frame. The optimization made high-cardinality ingestion cheaper without
placing a hard bound on the rows later consumed by read paths.

### Active Evidence completeness assumed bounded producers

The Camp open contract correctly avoided losing live execution state, but it did not distinguish
high-value semantic progress from transport-only output. There was no maximum event cardinality or
payload budget at the producer/read-model boundary.

### Renderer used a generic live-event path

Output frames entered the same live collection used for plan, narration, reasoning, Tool, and
lifecycle updates. Repeated append, sort, and progress reconstruction amplified the database and IPC
cost in React state even though the command display could use terminal aggregate output.

### Recovery preserved the expensive classification

After continuity loss, `waiting / recovery_blocked` honestly represented a nonterminal Run under the
then-current recovery model. It also kept all Evidence on the complete Camp-open path. Restarting the
App therefore replayed the workload instead of clearing it.

### Existing tests proved correctness at ordinary cardinality

Tests covered Evidence ordering, batching, paging, terminal output, and Renderer projection. They did
not inject 100,000 output frames through production ingress while keeping the receiver unconsumed, nor
assert zero durable rows and zero Renderer events.

### Incident observability lacked cardinality and phase timings

The product did not report per-Run Evidence type counts, Camp-open response bytes, JSON parse time,
Renderer rebuild time, or meaningful-paint latency in one diagnostic record. Investigation required
read-only database queries and source-level reconstruction.

## Why existing safeguards did not prevent the incident

- SQLite transaction batching reduced write amplification per transaction, not the number of rows.
- Managed Blob thresholds applied to large individual bodies and did not aggregate small delta rows.
- Stable Evidence sequence and canonical operation identity preserved ordering but imposed no producer
  cardinality bound.
- Terminal Run Evidence was already lazy-loaded, but the affected Run was `waiting`, so terminal
  history paging did not apply.
- Runtime route and epoch fences rejected stale events; the flood consisted mostly of then-current
  route events and therefore passed admission.
- Renderer result disclosure deferred large terminal Tool bodies, not the generic live-event array
  already populated by deltas.
- Restart recovery reused durable Run/Evidence state by design, so process restart was not a cleanup
  mechanism.

## What was not the cause

- SQLite corruption did not cause the failure; the retained backup passed `quick_check`.
- The terminal `aggregatedOutput` and Managed Blob path did not create the row count. They remain the
  correct final output authority and bounded large-content path.
- PR #63's Tool grouping and two-level disclosure did not create the historical deltas. It changed
  Renderer presentation while preserving Core Evidence identity and nonterminal open completeness.
- Other Runtime adapters did not produce Codex `command.output.delta`. The 13-Adapter audit found
  complete terminal semantic output for every current adapter and no adapter that required a spool.
- User command choice was not an error. The host is responsible for safely handling valid high-output
  Runtime traffic.
- Restarting the application did not create the amplification; it re-entered the same durable open and
  recovery path.
- The first reported Camp's stale Run did not contain the 78,837 deltas. It was a separate lifecycle
  blocker and is not reclassified as a delta incident in this report.

## Resolution and recovery

The immediate and product recoveries addressed different layers:

1. A pre-repair SQLite backup was retained and verified.
2. The affected `waiting / recovery_blocked` Run was converged to terminal failure without deleting
   Evidence. Its 84,620 historical rows remain available through exact-Run history reads.
3. PR #69 stopped future output deltas from writing Evidence, Canonical Activity, Managed Blobs, or
   Renderer live state. It retained semantic started/completed records, command identity, status,
   exit code, terminal aggregate output, and exact Tool result lazy loading.
4. Adapter review confirmed that all current adapters already provide terminal semantic output; no
   Core/Renderer accumulator or Adapter spool was added.
5. Runtime interruption now projects unsettled/stopped rather than fabricating authoritative
   cancellation.
6. PR #72 drops output-delta notifications at Codex Host stdout ingress after JSON-RPC response
   handling and under current Thread/Turn route validation. Legacy or unprovable shapes fail closed.
7. Core retains early unconditional transient guards as defense in depth, before batching, Runtime
   lookup, shutdown route permits, and database reads.
8. A production-ingress regression sends 100,000 current-route deltas while the receiver remains
   unconsumed, observes an empty receiver, then proves `item/completed` and `turn/completed` still
   arrive in order with terminal aggregate behavior intact.

The changes apply only to future Runtime traffic. They do not migrate, delete, rewrite, compact, or
rebuild historical Evidence, Blob, or Canonical Activity data. Historical performance remediation is
a separate governance and migration problem.

## What went well

- The daily database and a pre-repair backup preserved enough structure to distinguish corruption,
  recovery state, semantic operations, and transport frames.
- Exact counts showed that output transport, not Command count, dominated the affected Run.
- Immediate recovery preserved all Evidence instead of deleting rows to make the UI responsive.
- The review did not stop at database and Renderer elimination; it found and closed the remaining
  unbounded Core ingress queue.
- Terminal command semantics, large-output Managed Blob handling, Tool chronology, grouping, and exact
  Tool lazy disclosure were retained and regression tested.
- Both fixes passed repository CI before merge.

## What could be improved

- Transport-versus-semantic classification should be explicit at every Runtime adapter ingress before
  a new event type can enter durable or UI-generic paths.
- High-cardinality tests should exercise the production ingress and a deliberately non-consuming
  downstream receiver, not only a pure predicate or normal consumer.
- Camp-open diagnostics should report collection counts and serialized byte size before IPC without
  logging user content.
- Run recovery should make it easy to identify which nonterminal collection dominates a blocked open
  response.
- Incident response should retain structured detection, acknowledgement, repair, restart, and
  meaningful-paint timestamps.
- Historical delta treatment needs a separately reviewed migration/compaction policy rather than an
  incident-specific deletion.

## Where we were fortunate

- The database remained internally consistent and a backup was retained before operator recovery.
- The high-cardinality data was append-only Evidence, so terminalizing the Run restored the existing
  lazy-read boundary without destroying the incident record.
- Codex terminal events already carried complete aggregate output, allowing transport frames to be
  removed from durable and UI paths without inventing a new accumulator.
- No current non-Codex Adapter depended on the delta durability behavior.
- The remaining ingress queue risk was found before the first fix was treated as complete.

## Corrective and preventive actions

Status reflects evidence available when this postmortem was published. Accountable roles must be
mapped to a named maintainer before an open action starts.

| ID | Action | Accountable role | Priority | Status | Evidence or target |
|---|---|---|---|---|---|
| CDO-01 | Stop future Codex command output deltas from writing Evidence, Canonical Activity, Managed Blobs, or Renderer live state | Runtime Activity | P0 | Complete | PR #69; V1.28-D12 |
| CDO-02 | Preserve terminal command/status/exitCode/aggregatedOutput and large-output Blob behavior across all current adapters | Runtime Adapters | P0 | Complete | 13-Adapter durability audit; PR #69 |
| CDO-03 | Drop current, stale, malformed, unbound, and legacy output-delta notifications at Codex Host ingress without swallowing ID-bearing requests | Codex Runtime | P0 | Complete | PR #72; `CodexIngressDisposition` |
| CDO-04 | Prove 100,000 production-ingress deltas produce zero `CodexIncoming` sends and do not delay ordered terminal events | Codex Runtime | P0 | Complete | `stdout_ingress_drops_command_output_flood_and_preserves_terminal_events` |
| CDO-05 | Keep downstream transient guards before batching, Runtime lookup, shutdown permit, and database reads | Core Runtime | P0 | Complete | PR #72 defense-in-depth tests |
| CDO-06 | Define a separately governed historical delta migration or compaction policy, including backup, authorization, audit, and rollback requirements | Core Data | P1 | Planned | Future historical Evidence performance project; explicitly outside PR #69/#72 |
| CDO-07 | Add content-free Camp-open diagnostics for collection cardinality, response bytes, and meaningful-paint phase timing | Core Observability | P2 | Planned | Target: Diagnostics planning |
| CDO-08 | Record structured incident detection, mitigation, recovery, and verification timestamps | Release Engineering | P2 | Planned | Target: incident-response template update |

## Recurrence criteria

This incident is considered to have recurred if any future Codex output-delta notification:

- enters `CodexIncoming` or the Core `codex_tx` queue;
- creates Execution Evidence, Canonical Activity, a Managed Blob, or a Renderer live event;
- makes Camp-open work grow with stdout/stderr frame count rather than semantic operation count;
- delays or prevents JSON-RPC responses, `item/completed`, or `turn/completed` from being processed; or
- updates any operation after terminal, cancellation, Host unbind, Turn replacement, or route
  supersession.

The continued existence of historical delta rows is accepted debt, not by itself a recurrence. A new
automatic rewrite or deletion of that history without separately approved migration semantics would
be a different data-governance incident.

## Lessons

Streaming is a transport property, not a durability requirement. A frame should become durable only
when it adds a fact that cannot be reconstructed from the terminal semantic record. Optimizing how
quickly unbounded events are written does not bound the system; every downstream read, IPC, and UI
projection inherits the producer's cardinality.

Complete active-state recovery and bounded Camp open are compatible only when the durable event set is
semantically bounded before it reaches the read model. Finally, eliminating a database write is not
enough when an earlier unbounded queue still accepts the same flood. Cardinality control belongs at
the earliest ingress that can classify the event without blocking control and terminal traffic.

## References

- [PR #69: Make command output deltas transient](https://github.com/murray17/rovai-ai/pull/69)
- [PR #72: Drop Codex command output deltas at ingress](https://github.com/murray17/rovai-ai/pull/72)
- [PR #63: Continuous Tool grouping and two-level result disclosure](https://github.com/murray17/rovai-ai/pull/63)
- [V1.28-D12: Command output delta Host-ingress clean break](../versions/v1.28/decisions.md#v1-28-d12)
- [Current Execution Evidence and Canonical Activity invariants](../architecture/foundational-invariants.md#evidence-canonical-activity)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
- [Camp Open Projection v6](../contracts/camp-open-projection-v6.md)
- [Run Process Detail Surface v20](../contracts/run-process-detail-surface-v20.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md#command-output-durability-audit)
- [Codex ingress implementation](../../crates/rovai-core/src/codex.rs)
- [Camp open read-model implementation](../../crates/rovai-core/src/read_model.rs)
