---
document_type: version-decisions
version: v0.48
lifecycle: historical
last_updated: 2026-08-18
---

# v0.48 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0138](#adr-0138) | Durable Bootstrap Redelivery Requirement and Accepted-Input Acknowledgement | `accepted` |
| [ADR-0139](#adr-0139) | Version-Owned Bootstrap Redelivery Runtime Policy and Enablement Transition | `accepted` |
| [ADR-0140](#adr-0140) | Runtime-Specific Compaction Signal Admission Point and Prepared-Input Cutoff | `accepted` |
| [ADR-0141](#adr-0141) | Atomic Bootstrap Redelivery Input Overlay and Transient Identity Boundary | `accepted` |
| [ADR-0142](#adr-0142) | Native-Session-Scoped Compaction Observer Lease and Uncertain-Submission Boundary | `accepted` |
| [ADR-0143](#adr-0143) | Best-Effort Non-Blocking Compaction Detector Capability | `accepted` |

<!-- legacy-adr:begin id=ADR-0138 source-file-sha256=edb1e9f4357f4c116238a2623c0663f37e6ec97d98067e0a15e50cc65290d5cb -->
<a id="adr-0138"></a>

## ADR-0138: Durable Bootstrap Redelivery Requirement and Accepted-Input Acknowledgement

迁移时原路径：`docs/adr/0138-durable-bootstrap-redelivery-requirement.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0138
title: Durable Bootstrap Redelivery Requirement and Accepted-Input Acknowledgement
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0138 -->
<a id="adr-0138-context"></a>
### Context

A Runtime may compact the ordinary context of an existing Native Session after its Bootstrap was
delivered. Compaction notification and the next Rovai-controlled prompt are asynchronous. A Boolean
stored inside an Adapter cannot survive Core restart and cannot distinguish a redelivery already
selected for an in-flight input from another compaction observed before that input is accepted.

For example, clearing one `pending` Boolean after calling the Runtime would lose a second compaction
that arrives between Delivery Gate selection and Runtime acknowledgement. Clearing on a successful
send call would also overstate an input whose delivery later becomes `delivery_unknown`.

Rovai already treats Runtime input as a durable `prepared | accepted | delivery_unknown` protocol and
advances the Accepted Public Context Boundary only after accepted acknowledgement. Bootstrap
redelivery needs the same recovery standard without making Adapter process memory a competing truth.

<a id="adr-0138-decision"></a>
### Decision

Bootstrap Redelivery Requirement is durable Core state scoped to one Native Binding identity and
generation. Product language may derive `clean | pending_redelivery`, but the authoritative state is
a pair of monotonic requested and acknowledged redelivery revisions.

An eligible, correctly fenced compaction observation advances the requested revision. A Bootstrap
Delivery Gate selects the currently requested revision and freezes that selected revision on the
corresponding Runtime Input Delivery. It does not acknowledge or clear the requirement.

Only the transaction that records the Runtime Input Delivery as `accepted` may advance the
acknowledged revision, and it may advance only through the revision frozen on that delivery. A send
failure, `delivery_unknown`, process loss or Core restart does not consume the requirement.

If another eligible observation arrives after the Gate selected a revision, its later revision remains
pending when the earlier input is acknowledged. A signal belonging to a replaced Native Binding,
another generation, a stale Host/Session route or a fenced execution identity cannot mutate the
current requirement.

This decision owns delivery accounting only. Runtime classification, detector success semantics,
Bootstrap composition and event-deduplication identity are separate v0.48 decisions and must preserve
this acknowledgement boundary.

<a id="adr-0138-consequences"></a>
### Consequences

- Crash recovery cannot silently forget an observed need for Bootstrap restoration.
- Runtime Input Delivery becomes the atomic bridge between a pending requirement and its consumption.
- Persistence needs monotonic revision fields or an equivalent ledger plus a delivery-side captured
  revision; a single persisted Boolean is insufficient.
- Adapter callbacks must carry enough trusted Binding/Host identity for Core to fence stale signals.
- `delivery_unknown` recovery must reconcile the original input before any new delivery can consume the
  same or a later requirement.

<a id="adr-0138-rejected-alternatives"></a>
### Rejected Alternatives

- Adapter-local `clean | pending` state: loses requirements on Core or Host restart and creates a second
  authority outside Core.
- Clear immediately before or after calling the Runtime: loses failed or ambiguous deliveries.
- Clear the current Boolean on ACK: can erase a newer observation that arrived after Gate selection.
- Treat every pending observation as a new user task or Camp Message: changes collaboration semantics
  and duplicates Session-recovery context into public history.

<a id="adr-0138-references"></a>
### References

- [v0.48 Native Session Compaction Bootstrap Redelivery](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](../v0.21/decisions.md#adr-0067)
- [ADR-0100: Latest Member Identity in Native Session Bootstrap](../v0.35/decisions.md#adr-0100)
- [ADR-0139: Version-Owned Bootstrap Redelivery Runtime Policy](decisions.md#adr-0139)
<!-- legacy-adr-body:end id=ADR-0138 -->
<!-- legacy-adr:end id=ADR-0138 -->

<!-- legacy-adr:begin id=ADR-0139 source-file-sha256=f0acc68b2e96692a318ab795f9897bedf67ebc977d7a8cd6695368519040e397 -->
<a id="adr-0139"></a>

## ADR-0139: Version-Owned Bootstrap Redelivery Runtime Policy and Enablement Transition

迁移时原路径：`docs/adr/0139-version-owned-bootstrap-redelivery-runtime-policy.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0139
title: Version-Owned Bootstrap Redelivery Runtime Policy and Enablement Transition
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0139 -->
> [ADR-0143](decisions.md#adr-0143)局部替代本文的
> `enabled` 标签与任何可能的 Readiness 含义：适用值现在是 `disabled | best_effort`，detector
> establishment 不阻塞 AgentRun。本文的版本 ownership、policy epoch、首次
> `disabled -> best_effort` 存量基线和 pending 不可清除条款继续有效。

<a id="adr-0139-context"></a>
### Context

Bootstrap redelivery needs Runtime-specific rollout because Runtime protocols expose different
compaction guarantees and detectors. The policy must not become a customer setting, but Rovai must
still be able to maintain the supported matrix by release and disable one Runtime independently.

A Native Binding generation is the lifetime of one Conversation-to-Native-Session binding, not a
Rovai release or AgentRun. It can survive multiple Runs and a Rovai process restart. Freezing an
enablement switch to that generation would prevent a new release from correcting detector policy for
an existing reusable Session. Conversely, changing enablement must not discard a durable compaction
fact already observed for that Session.

When a release enables detection for an existing Session, that Session might already have compacted
while an older release could not observe it. Waiting only for a future signal would leave the first
post-upgrade prompt without a known-good Bootstrap baseline.

<a id="adr-0139-decision"></a>
### Decision

For Runtimes whose Bootstrap can participate in ordinary Session compaction, Rovai owns an internal,
per-Runtime environment policy. Packaged/versioned launch configuration maintains its defaults. Core
reads the effective matrix once at process startup; it is not a Renderer setting, persisted customer
preference, remotely hot-reloaded flag or Native-Binding-frozen capability.

Claude Code and Codex do not define this switch and never enter the detector admission path because
their Bootstrap is delivered through a compaction-protected instruction layer. The v0.48 version
matrix enables signal-driven admission for Copilot, OpenCode, Kiro, Qoder, CodeBuddy and Qwen Code.
Antigravity remains disabled because no qualified official compaction lifecycle signal has been
accepted.

Core durably records the last applied policy epoch per Runtime and reconciles the process-start matrix
transactionally. The first effective `disabled -> best_effort` transition for one policy epoch advances
exactly one Bootstrap Redelivery Requirement for every already reusable current Binding of that
Runtime. A new Binding that has not yet accepted input already receives normal Bootstrap and needs no
synthetic transition requirement. Repeated startup under the same epoch is idempotent and does not
create another requirement.

The environment policy values are `disabled | best_effort`. Changing one Runtime to `disabled`
does not acknowledge, clear or bypass a Bootstrap Redelivery Requirement that Core already knows.
Such a Requirement remains governed by ADR-0138 and must be consumed by an accepted Runtime Input.
Policy transitions do not create a new Native Session or increment its Binding generation.

Exact environment keys and the implemented matrix are maintained in
[Native Session Bootstrap Redelivery Architecture](../../architecture/native-session-bootstrap-redelivery.md).
Detector identities, lifecycle-event success semantics and callback trust must not weaken this policy
transition or the ADR-0138 acknowledgement boundary.

<a id="adr-0139-consequences"></a>
### Consequences

- Rovai releases can maintain and roll back one Runtime detector without exposing product settings.
- An upgraded process can apply a new policy to an existing compatible Native Session.
- First enablement restores a deterministic Bootstrap baseline even if older compactions were never
  observable.
- Durable pending work cannot be silently lost by changing an environment value.
- Persistence needs an idempotent per-Runtime applied policy epoch in addition to Binding-scoped
  requested/acknowledged revisions.

<a id="adr-0139-rejected-alternatives"></a>
### Rejected Alternatives

- Customer-visible or persisted preference: exposes a protocol-correctness mechanism as a product
  choice and lets users violate delivery guarantees.
- Freeze enablement on Native Binding creation: prevents release policy corrections from reaching
  long-lived Sessions without needless Session replacement.
- Apply enablement only to newly created Bindings: leaves upgraded existing Sessions with an unknown
  Bootstrap baseline.
- Clear pending work when disabled: rewrites an already observed compaction fact as if it never
  happened.
- Force a new Native Session on first enablement: restores context but unnecessarily destroys verified
  Session continuity when one controlled Bootstrap redelivery suffices.

<a id="adr-0139-references"></a>
### References

- [v0.48 Native Session Compaction Bootstrap Redelivery](README.md)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](decisions.md#adr-0138)
- [Native Session Bootstrap Redelivery Architecture](../../architecture/native-session-bootstrap-redelivery.md)
- [ADR-0140: Runtime-Specific Compaction Signal Admission Point](decisions.md#adr-0140)
- [ADR-0143: Best-Effort Non-Blocking Compaction Detector](decisions.md#adr-0143)
<!-- legacy-adr-body:end id=ADR-0139 -->
<!-- legacy-adr:end id=ADR-0139 -->

<!-- legacy-adr:begin id=ADR-0140 source-file-sha256=77cd4121001b66dc41df53bb5aa445cbf99afea4e41ae81c6b56b1c66640a7bb -->
<a id="adr-0140"></a>

## ADR-0140: Runtime-Specific Compaction Signal Admission Point and Prepared-Input Cutoff

迁移时原路径：`docs/adr/0140-runtime-specific-compaction-signal-admission-point.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0140
title: Runtime-Specific Compaction Signal Admission Point and Prepared-Input Cutoff
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0140 -->
<a id="adr-0140-context"></a>
### Context

Runtime compaction protocols do not expose one uniform lifecycle. Some provide a reliable completed
event, while the selected Copilot CLI Hook surface exposes `preCompact` without a corresponding
post-compaction Hook. GitHub's separate Copilot SDK documents compaction start/complete events, but
those events are not automatically available through Rovai's current ACP/Hook adapter path. Kiro's ACP
extension reports compaction status with a target-version-qualified nested terminal schema.

Admitting every available pre-event would restore Bootstrap earlier but spend tokens when compaction
later aborts. Admitting only completed events would make Copilot impossible to support and can leave
one additional prompt window when asynchronous completion arrives after that prompt is already
immutable.

The phrase “prompt has not been submitted” is also too transport-specific. Rovai already persists a
prepared Runtime Input Delivery before calling a Runtime. Mutating the payload after that point would
break deterministic retry and delivery-unknown reconciliation.

<a id="adr-0140-decision"></a>
### Decision

Each enabled Runtime has exactly one version-qualified Compaction Signal Admission Point. Rovai
chooses the latest reliable lifecycle point that still makes the detector useful; it does not apply a
universal pre-event rule.

- If Copilot uses the current Hook/ACP candidate, it admits `preCompact` and immediately advances a
  Requirement because no completed event is qualified on that surface. This is a one-shot edge, not a
  sticky in-progress state: one deduplicated `preCompact` advances requested revision once; one
  accepted Bootstrap redelivery may acknowledge that revision immediately without waiting for a
  completed signal; only a later distinct `preCompact` creates another Requirement. One redundant
  Bootstrap after an aborted compaction is an accepted cost.
- OpenCode v1.18.10 admits only native event `session.compacted`.
- Qoder and Qwen Code admit only successful `PostCompact` with trigger `manual | auto`;
- CodeBuddy `2.133.1` admits only `SessionStart(source=compact)` after its emergency automatic compaction completes. Its separate pre-message compaction path bypasses `PreCompact`, `PostCompact` and `SessionStart(compact)` in real qualification, so that absence remains a documented best-effort coverage gap rather than a token-derived observation;
  their pre-events do not advance a Requirement.
- Kiro v2.16.1 admits only `_kiro.dev/compaction/status` where
  `params.status.type == "completed"`; its preceding `started` state does not advance a Requirement.
- Claude Code and Codex have no admission point. Antigravity has none in v0.48.

Started/delta telemetry, failed or cancelled completion, unknown status values, token-count changes
and inferred context-window discontinuities never advance a Requirement. One Runtime upgrade cannot
silently reinterpret an old event name or payload; the detector mapping and evidence must be revised
with the Rovai version policy.

GitHub documents that background compaction snapshots conversation history and preserves messages
added while compaction is running, and that `preCompact` fires before compaction begins. Copilot CLI
v1.0.78 qualification additionally observed a real `preCompact(manual)` Hook and a subsequent accepted
ACP input. v0.48 therefore accepts the one-shot pre edge; it does not wait on the unrelated SDK
complete event or use a timer.

The cutoff for carrying a newly admitted Requirement in the current input is the Core transaction
that persists `RuntimeInputDelivery.prepared` together with its immutable redelivery selection. An
observation committed before that transaction may be selected for this input. An observation
committed afterward cannot mutate it and remains pending for the next Runtime Input Delivery. The
later process, socket or protocol send call is not a mutability boundary.

Lifecycle duplicates belonging to one compaction occurrence must not create a second redelivery, but
the trusted occurrence identity and durable deduplication mechanism are a separate v0.48 decision.

<a id="adr-0140-consequences"></a>
### Consequences

- Copilot can implement redelivery despite exposing only a pre-compaction hook.
- Copilot does not remain pending merely because no post-compaction Hook arrives; ACK consumes the
  one-shot Requirement normally.
- Runtimes with reliable completion avoid unnecessary Bootstrap token spend and false positives.
- A late asynchronous completion may intentionally miss one already-prepared input and target the
  next; no immutable input is patched in place.
- Kiro's exact nested completed state is version-qualified and must be revalidated on incompatible
  upstream changes.
- Deterministic resend and `delivery_unknown` recovery retain exact prepared-input semantics.

<a id="adr-0140-rejected-alternatives"></a>
### Rejected Alternatives

- Admit every pre/in-progress event: spends Bootstrap tokens even when a reliable completion event can
  avoid false positives.
- Require completion for every Runtime: makes Copilot unsupported and ignores asymmetric official
  lifecycle capabilities.
- Treat the transport send call as the cutoff: permits payload mutation after durable preparation and
  makes retry bytes ambiguous.
- Infer completion from token telemetry or unknown status values: creates unqualified false facts.
- Hard-code one OpenCode event name across versions: confuses current and legacy event families.

<a id="adr-0140-references"></a>
### References

- [v0.48 Native Session Compaction Bootstrap Redelivery](README.md)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](decisions.md#adr-0138)
- [ADR-0139: Version-Owned Runtime Policy](decisions.md#adr-0139)
- [Native Session Bootstrap Redelivery Architecture](../../architecture/native-session-bootstrap-redelivery.md)
- [ADR-0141: Atomic Bootstrap Redelivery Input Overlay](decisions.md#adr-0141)
- [GitHub Copilot Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [GitHub Copilot CLI context management](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/context-management)
- [GitHub Copilot SDK streaming events](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events)
<!-- legacy-adr-body:end id=ADR-0140 -->
<!-- legacy-adr:end id=ADR-0140 -->

<!-- legacy-adr:begin id=ADR-0141 source-file-sha256=fd9ba3aee3f9a2d5c10ab72daa395ae6cd5532edb9222718c1bf1703faf02fea -->
<a id="adr-0141"></a>

## ADR-0141: Atomic Bootstrap Redelivery Input Overlay and Transient Identity Boundary

迁移时原路径：`docs/adr/0141-atomic-bootstrap-redelivery-input-overlay.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0141
title: Atomic Bootstrap Redelivery Input Overlay and Transient Identity Boundary
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0141 -->
<a id="adr-0141-context"></a>
### Context

Current context delivery materializes and persists one ContextManifest before separately preparing a
Runtime Input Delivery. Without one serialization boundary, a compaction observation could arrive
between those operations. If redelivery were selected only by the later operation, a previously
maximum-sized Dynamic Context might no longer have room for the complete Bootstrap. Mutating the
immutable ContextManifest after selection would break deterministic context evidence.

ADR-0100 intentionally keeps the complete formatted Bootstrap, Member Identity snapshot and any
identity-bearing prompt digest transient. Redelivery must reuse that privacy boundary while giving the
Delivery Gate durable evidence of which Requirement it attempted to consume.

<a id="adr-0141-decision"></a>
### Decision

<a id="adr-0141-one-serialized-runtime-input-preparation-boundary"></a>
#### One serialized Runtime input preparation boundary

Context selection and Runtime Input Delivery preparation form one logical Core critical section. The
implementation may stage managed blobs or commit an unsendable ContextManifest before the Delivery,
but it must hold the same exclusive Core database authority throughout. No compaction callback may
commit between redelivery selection and `RuntimeInputDelivery.prepared`, and no transport may receive
payload bytes until the Delivery exists.

The critical section revalidates the current AgentRun and Native Binding generation, reads the current
requested/acknowledged revisions, selects any pending revision, applies the combined payload budget,
persists the Dynamic Context-only ContextManifest, and inserts the Runtime Input Delivery with its
redelivery metadata. The implementation may use more than one SQLite transaction inside that section.
If it commits a Manifest first, that row is staging state only: a crash must reuse it and reselect the
then-current pending revision before any Delivery can become sendable. The Delivery `prepared` commit
is the ADR-0140 cutoff. A later observation advances a future Requirement and cannot patch the
prepared input.

<a id="adr-0141-redelivery-is-a-transient-input-overlay"></a>
#### Redelivery is a transient input overlay

When selected, Core invokes the existing Bootstrap assembler; it does not create a second Bootstrap
model. Stable components come from the current Binding generation's original Bootstrap Evidence, and
Member Identity is the latest committed six-field projection read once for this eligible delivery, as
defined by ADR-0100.

The versioned model-facing order is:

```text
[ROVAI_BOOTSTRAP_REDELIVERY]
【补发】Native Session Bootstrap
原因：Runtime 已报告当前 Native Session 已发生或即将发生会话上下文压缩。
以下内容用于恢复可能因压缩而丢失的会话级长期上下文。

<existing complete Native Session Bootstrap>
[/ROVAI_BOOTSTRAP_REDELIVERY]

<immutable AgentRun Dynamic Context>
```

The redelivery envelope encloses both the notice and the complete Bootstrap. Its wording and marker
are formatter-versioned. It is not a user task, Camp Message, Run Notice or new Native Session.

<a id="adr-0141-evidence-and-privacy"></a>
#### Evidence and privacy

ContextManifest continues to persist only the exact AgentRun Dynamic Context and its existing source
evidence. Runtime Input Delivery persists the selected redelivery revision, stable Bootstrap Evidence
ID, presence flag, and redelivery envelope/Bootstrap formatter versions. It does not persist the
complete overlay, complete Runtime input, Member Identity bytes or snapshot, or a digest incorporating
Member Identity.

An accepted Runtime Input proves that Core completed a delivery carrying the selected Requirement,
but retained evidence cannot reconstruct or prove the exact identity bytes. This deliberately extends
ADR-0100's transient complete-Bootstrap boundary to redelivery.

<a id="adr-0141-combined-budget-and-failure"></a>
#### Combined budget and failure

The complete redelivery envelope is non-truncatable and counts against the existing maximum Runtime
payload bytes. During serialized preparation Core deterministically reduces only optional Dynamic
Context according to the existing Context Delivery Profile until the combined payload fits;
ContextManifest records the resulting exact Dynamic Context and omission evidence. Required Bootstrap
sections and Current Input are never removed to make room.

If the envelope plus irreducible Dynamic Context exceeds the Runtime payload limit, preparation fails
closed before `RuntimeInputDelivery.prepared`; no partial Bootstrap or unbudgeted input is sent.

Because the identity-bearing bytes are transient, process loss cannot claim byte-identical overlay
reconstruction. A failed or `delivery_unknown` attempt does not acknowledge the Requirement. Recovery
must first reconcile the existing Delivery and may prepare a later eligible input only after proving
that doing so cannot duplicate an accepted input; it never blindly resends reconstructed “same” bytes.

<a id="adr-0141-consequences"></a>
### Consequences

- The materialize-to-prepare race is removed without requiring one oversized SQLite transaction or
  moving Bootstrap into ContextManifest.
- Redelivery uses the latest identity while creating no durable identity history.
- Every prepared combined input is within the same bounded Runtime payload contract as a new-Session
  first payload.
- Dynamic history may be smaller on a redelivery Run, but its deterministic omission remains visible in
  ContextManifest evidence.
- Runtime Input Delivery schema and preparation call sites require a clean migration and serialized
  Core API.

<a id="adr-0141-rejected-alternatives"></a>
### Rejected Alternatives

- Put the complete redelivery in ContextManifest: persists or digests Member Identity and contradicts
  ADR-0100.
- Append Bootstrap after an already prepared Dynamic Context: creates an unbudgeted payload and races
  immutable evidence.
- Reserve worst-case Bootstrap space on every ordinary prompt: permanently reduces useful Dynamic
  Context even when no Requirement exists.
- Truncate Bootstrap or Current Input: destroys the recovery contract or the user's actual task.
- Persist the combined Runtime payload for exact retry: creates the identity history ADR-0100 rejects.
- Rebuild and blindly resend after process loss: overclaims byte identity and may duplicate an accepted
  input.

<a id="adr-0141-references"></a>
### References

- [v0.48 Native Session Compaction Bootstrap Redelivery](README.md)
- [ADR-0100: Latest Member Identity in Native Session Bootstrap](../v0.35/decisions.md#adr-0100)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](decisions.md#adr-0138)
- [ADR-0140: Runtime-Specific Compaction Signal Admission Point](decisions.md#adr-0140)
- [Native Session Bootstrap Redelivery Architecture](../../architecture/native-session-bootstrap-redelivery.md)
- [ADR-0142: Native-Session-Scoped Compaction Observer Lease](decisions.md#adr-0142)
<!-- legacy-adr-body:end id=ADR-0141 -->
<!-- legacy-adr:end id=ADR-0141 -->

<!-- legacy-adr:begin id=ADR-0142 source-file-sha256=f9855b94f67d3ec8efd7b50e9f256a605c9ba6d4d03c2d867e149e839aff75e8 -->
<a id="adr-0142"></a>

## ADR-0142: Native-Session-Scoped Compaction Observer Lease and Uncertain-Submission Boundary

迁移时原路径：`docs/adr/0142-native-session-scoped-compaction-observer-lease.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0142
title: Native-Session-Scoped Compaction Observer Lease and Uncertain-Submission Boundary
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0142 -->
<a id="adr-0142-context"></a>
### Context

A completed compaction event can arrive after the AgentRun that triggered it has become terminal.
Routing every callback through `(agentRunId, executionEpoch)` would reject a valid Session fact.
Keeping the AgentRun lease alive would instead preserve prompt, Built-in Tool and collaboration
authority beyond the Run that owns it.

Runtime Hook and native event transports can also be interrupted. Treating every Host exit as possible
compaction would create unbounded false-positive Bootstrap token spend. Treating a callback whose Core
commit result is unknown as absent could lose a real observation.

<a id="adr-0142-decision"></a>
### Decision

<a id="adr-0142-independent-narrow-observer-authority"></a>
#### Independent narrow Observer authority

Rovai creates a Native Session Compaction Observer Lease after a Native Session bind or verified Resume
succeeds. Its identity is scoped at least to:

```text
adapterInstallationId
hostInstanceId
nativeSessionId
nativeBindingId
nativeBindingGeneration
detectorPolicyEpoch
```

The Observer Lease may survive multiple AgentRuns on that Native Session. It authorizes only submission
of the exact version-qualified Compaction Signal Admission Point selected for that Runtime. It cannot
send Runtime input, invoke Built-in Tools, obtain an AgentRun lease, mutate Camp/Task/Message/Memory
state, control the Runtime, or prove that a model observed the event.

Binding replacement, Host replacement or detach, Session invalidation, detector policy epoch change,
or explicit Observer revocation fences the Lease. A verified Resume of the same external Session on a
new Host creates a new Observer identity; callbacks from the prior Host remain stale even though the
provider-native Session ID is unchanged.

<a id="adr-0142-one-session-scoped-core-command"></a>
#### One Session-scoped Core command

Every Runtime-specific Hook, native event or ACP extension is normalized into one Session-scoped
compaction observation command. Core transactionally validates the Observer Lease, current Binding ID
and generation, Host/Session route, effective detector policy epoch, exact admission event and source
observation identity before advancing that Binding generation's requested revision.

No active AgentRun is required. If an AgentRun is active, its identity is optional diagnostic context
and grants no authority to this command. The later Delivery Gate consumes the resulting Requirement
under ADR-0138 independently of which Run, if any, observed the compaction.

<a id="adr-0142-interruption-is-not-compaction-evidence"></a>
#### Interruption is not compaction evidence

Ordinary Host exit, process crash, Core restart, relay restart, Session detach or missing callback is
not a compaction observation and must not create a Requirement.

Conservative recovery is allowed only after the Observer or relay has already accepted a concrete,
correctly scoped compaction observation but cannot determine whether Core committed its submission.
That `observation_submission_unknown` evidence retains the same source observation identity and may
advance at most one Requirement for its still-current Binding generation. Core commit or later replay
deduplicates against that identity. If the Binding, Host identity or policy epoch is stale, recovery
fences the record rather than applying it to a replacement Session.

The relay stages one private durable outbox record before Core submission. The record contains only
lifecycle metadata and its stable source identity; Core acknowledgement removes it. Core startup or
the matching Host-exit path replays the record before fencing the old Observer, and the Binding-scoped
dedupe key makes commit-before-response loss idempotent. Invalid or stale records are discarded; a
record whose database submission still fails remains for later recovery. This makes the
known-but-unknown boundary explicit rather than inferring it from generic process lifecycle.

<a id="adr-0142-consequences"></a>
### Consequences

- Late completed events remain admissible after the originating AgentRun ends.
- AgentRun business authority is never extended to solve a Session-observation problem.
- A provider-native Session ID alone cannot spoof or revive a stale observation route.
- Host replacement is safe even when the same external Session is resumed.
- Crash recovery creates a conservative false positive only for a known uncertain submission, not for
  every Host lifecycle event.

<a id="adr-0142-rejected-alternatives"></a>
### Rejected Alternatives

- Bind observations to AgentRun epoch: loses legitimate asynchronous Session events.
- Extend AgentRun leases: over-authorizes tools, prompts and domain mutation after Run completion.
- Trust only provider-native Session ID: cannot distinguish replaced Hosts, Bindings or policy epochs.
- Treat any Host/relay exit as compaction: turns ordinary lifecycle churn into recurring Bootstrap
  injection.
- Drop an acknowledged-by-relay but commit-unknown observation: can permanently lose Bootstrap
  restoration after a real compaction.

<a id="adr-0142-references"></a>
### References

- [v0.48 Native Session Compaction Bootstrap Redelivery](README.md)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](decisions.md#adr-0138)
- [ADR-0139: Version-Owned Runtime Policy](decisions.md#adr-0139)
- [ADR-0140: Runtime-Specific Signal Admission](decisions.md#adr-0140)
- [ADR-0141: Atomic Bootstrap Redelivery Input Overlay](decisions.md#adr-0141)
- [Native Session Bootstrap Redelivery Architecture](../../architecture/native-session-bootstrap-redelivery.md)
- [ADR-0143: Best-Effort Non-Blocking Compaction Detector](decisions.md#adr-0143)
<!-- legacy-adr-body:end id=ADR-0142 -->
<!-- legacy-adr:end id=ADR-0142 -->

<!-- legacy-adr:begin id=ADR-0143 source-file-sha256=b6358f17968b3ccbb572a21480f57f8cdebb8f5fd036f13d4a253967fb725a65 -->
<a id="adr-0143"></a>

## ADR-0143: Best-Effort Non-Blocking Compaction Detector Capability

迁移时原路径：`docs/adr/0143-best-effort-non-blocking-compaction-detector-capability.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0143
title: Best-Effort Non-Blocking Compaction Detector Capability
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0143 -->
<a id="adr-0143-context"></a>
### Context

Compaction detectors depend on external Runtime Hooks, ACP extensions and native event schemas that can
be temporarily unavailable or fail to establish after an upstream upgrade. Making detector readiness
an AgentRun admission condition would turn an optional continuity enhancement into a complete Runtime
outage.

Rovai still must preserve any Requirement it already knows. It also needs to distinguish a deliberate
version policy transition from ordinary detector recovery: the former can establish a one-time
Bootstrap baseline for existing Sessions, while the latter has no evidence that compaction occurred
during its observation gap.

<a id="adr-0143-decision"></a>
### Decision

<a id="adr-0143-closed-internal-policy"></a>
#### Closed internal policy

The version-owned per-Runtime environment policy has exactly two applicable values:

```text
disabled
best_effort
```

`disabled` establishes no detector. `best_effort` asks Core and the Runtime Host to establish the
version-qualified Hook, Observer or ACP compaction route asynchronously and in parallel with normal
Runtime startup. Claude Code and Codex remain outside this policy because their Bootstrap delivery
layer does not require redelivery.

The v0.48 matrix is:

- `best_effort`: GitHub Copilot, OpenCode, Kiro, Qoder, CodeBuddy and Qwen Code;
- `disabled`: Antigravity;
- not applicable and no environment switch: Claude Code and Codex CLI.

This locally replaces ADR-0139's `enabled` label with `best_effort`; ADR-0139's version ownership,
process-start snapshot, durable policy epoch and pending-preservation rules remain effective.

<a id="adr-0143-detector-state-is-not-runtime-readiness"></a>
#### Detector state is not Runtime Readiness

Detector establishment and operational state are internal enhancement diagnostics such as
`establishing | observing | unavailable`. They do not participate in Product Runtime Readiness,
Member Runtime Configuration validity, AgentRun admission, Native Session creation/Resume, model
selection or permission readiness.

An AgentRun proceeds normally while a best-effort detector is establishing, unavailable or recovering.
Rovai does not respond by forcing one-shot Sessions, changing Runtime/model selection, modifying user
configuration, or inferring compaction from token/context-window telemetry.

An already persisted Bootstrap Redelivery Requirement is independent of detector health and must still
be selected and acknowledged under ADR-0138/0141.

<a id="adr-0143-no-retrospective-inference-on-operational-recovery"></a>
#### No retrospective inference on operational recovery

When a detector becomes observing after temporary unavailability within the same policy epoch, it
admits only signals observed from that recovery point onward. It does not create a synthetic
Requirement for the gap and does not guess whether compaction occurred.

This differs from a version-owned policy transition from `disabled` to `best_effort`. ADR-0139's
idempotent transition requirement remains: existing reusable Bindings receive one deliberate
Bootstrap baseline when the new policy epoch is first applied. Repeated detector reconnects under that
epoch do not repeat it.

<a id="adr-0143-support-claims-remain-evidence-bound"></a>
#### Support claims remain evidence-bound

Real target-version Runtime smoke is required before documentation claims that a detector works. A
temporarily failed detector after qualification degrades only the enhancement state, not Runtime
availability. Compatibility evidence must describe the exact Runtime version, selected surface,
observed signal and known gaps; a configured but never observed Hook is not proof of support.

<a id="adr-0143-consequences"></a>
### Consequences

- Users can continue running an otherwise healthy Runtime during detector outages.
- Rovai honestly has an observation gap without inventing compaction facts.
- Known pending work remains reliable even when future observation is degraded.
- Version policy rollout and transient reconnect have distinct, deterministic semantics.
- UI and Runtime Readiness remain free of a protocol-internal detector status.

<a id="adr-0143-rejected-alternatives"></a>
### Rejected Alternatives

- Mandatory detector Readiness: makes third-party Hook availability a full Runtime outage.
- Silently run a fallback one-shot Session: changes continuity semantics and cost without product
  authorization.
- Mark pending whenever a detector reconnects: treats an observation gap as evidence of compaction.
- Clear pending while detector is unavailable: loses a fact Core already knows.
- Customer-visible detector toggle: exposes internal protocol correctness as a user preference.

<a id="adr-0143-references"></a>
### References

- [v0.48 Native Session Compaction Bootstrap Redelivery](README.md)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](decisions.md#adr-0138)
- [ADR-0139: Version-Owned Runtime Policy](decisions.md#adr-0139)
- [ADR-0142: Native-Session-Scoped Observer Lease](decisions.md#adr-0142)
- [Native Session Bootstrap Redelivery Architecture](../../architecture/native-session-bootstrap-redelivery.md)
<!-- legacy-adr-body:end id=ADR-0143 -->
<!-- legacy-adr:end id=ADR-0143 -->
