---
document_type: version-decisions
version: v0.31
lifecycle: historical
last_updated: 2026-08-18
---

# v0.31 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0089](#adr-0089) | Attested Built-in MCP Tool Parity | `accepted` |
| [ADR-0090](#adr-0090) | Team Delivery Qualification Evidence Boundary | `accepted` |

<!-- legacy-adr:begin id=ADR-0089 source-file-sha256=cac3eb00fcf536f2f8afc9f168fc73a28d77a4cf618a210f227dbf5d3614ce9c -->
<a id="adr-0089"></a>

## ADR-0089: Attested Built-in MCP Tool Parity

迁移时原路径：`docs/adr/0089-attested-built-in-mcp-tool-parity.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0089
title: "Attested Built-in MCP Tool Parity"
status: accepted
date: 2026-08-02
decision_scope: cross-version
source_version: v0.31
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0089 -->
> [ADR-0108](../v0.40/decisions.md#adr-0108) 局部替代本文记录的
> v0.31 十三个工具目录。v0.40 使用十二个 canonical tools，并以 Alias Map v3 将
> `camp.list`、`camp.search`、`history.search`、`camp.read` 映射为对应下划线别名；完整目录
> 对等、精确权限和 canonical receipt 规则继续有效。

<a id="adr-0089-context"></a>
### Context

[ADR-0088](../v0.30/decisions.md#adr-0088) established a credentialless,
OS-attested MCP attachment for Runtimes that can launch native MCP but cannot prove an exact
per-Run replacement of their ambient MCP set. Its first Antigravity implementation intentionally
exposed only `post_message` while process proof, configuration ownership, exact permission and
real model invocation were validated.

Rovai's credentialed built-in Gateway already exposes thirteen Team, Context Retrieval and Memory
operations through one authenticated Native Binding. Keeping an otherwise execution-capable Runtime
on a permanent `post_message` subset makes the Agent's collaboration and memory ability depend on
the transport used to attach the same Core-owned Gateway. It also makes a default team qualification
measure a known Adapter omission rather than the configured Member's actual business authority.

The attested path can reuse the same Core handler and live authorization boundary. The remaining
trade-off is how to provide full semantic parity without reintroducing dotted-name incompatibility,
global permission bypass, ambient-MCP claims, or a second copy of domain logic.

<a id="adr-0089-decision"></a>
### Decision

<a id="adr-0089-one-canonical-built-in-catalog"></a>
#### One canonical built-in catalog

Every `AttestedNativeBridge` attachment MUST expose the complete current built-in MCP catalog that
an exact-injection Runtime receives. The v0.31 catalog is the following closed set:

| Canonical Core operation | Antigravity-visible alias |
|---|---|
| `team.post_message` | `post_message` |
| `team.create_task` | `create_task` |
| `team.update_task` | `update_task` |
| `team.list_tasks` | `list_tasks` |
| `context.search` | `context_search` |
| `context.get_message` | `context_get_message` |
| `context.get_message_window` | `context_get_message_window` |
| `context.get_message_thread` | `context_get_message_thread` |
| `context.get_summary` | `context_get_summary` |
| `memory.search` | `memory_search` |
| `memory.read` | `memory_read` |
| `memory.write` | `memory_write` |
| `memory.propose_hearth` | `memory_propose_hearth` |

The canonical catalog, schemas, output contracts and receipt identities have one Core-owned source.
The attested Bridge MAY translate canonical names into an Adapter-safe native dialect, but MUST NOT
fork schemas, descriptions, pagination, quotas, error codes, Memory rules, Task rules or result
shapes. Future additions to the built-in catalog are not considered ready on an attested Runtime
until their alias, exact permission, real discovery, real call and negative-path evidence have been
validated together.

Alias names exist only at the Runtime MCP and permission boundary. The Bridge selects the canonical
operation from a closed mapping; the model cannot submit or override a canonical name. Structured
receipts, command identity, idempotency, audit and execution evidence continue to use the canonical
operation.

<a id="adr-0089-discovery-proves-attachment-not-authority"></a>
#### Discovery proves attachment, not authority

An unbound Bridge returns an empty `tools/list`. A Bridge bound to a current attested AgentRun and a
ready complete permission bundle returns the same thirteen semantic operations as an exact-injection
Runtime. Tool discovery does not grant domain authority.

Every `tools/call` MUST reacquire and validate the connection-bound attested lease and resolve the
current AgentRun, Native Binding, generation and Execution Epoch. The Core handler then applies the
same per-operation checks used by credentialed attachments, including:

- present Camp membership, current Run fencing and operation idempotency;
- A2A target and CampTurn depth/run quotas for `team.post_message`;
- Task visibility, business Capability and optimistic version checks;
- the frozen context boundary for every Context Retrieval read;
- current Memory applicability, lifecycle, policy, Capability, scope, quota and secret filtering.

The attested identity MAY authorize the prepared Binding associated with that exact active Run, but
it cannot be generalized into a reusable bearer credential. All thirteen operations converge on the
existing Core Gateway handler; neither the Bridge nor the Adapter may read SQLite or implement a
parallel authorization path.

Built-in MCP Tool Parity means transport and semantic parity, not equal business authority for every
Member. A Member lacking a mutation Capability receives the same structured denial it would receive
through any other Runtime.

<a id="adr-0089-exact-permission-is-a-complete-user-consented-bundle"></a>
#### Exact permission is a complete user-consented bundle

Rovai manages one explicit permission bundle containing the thirteen exact rules:

```text
mcp(rovai_team/post_message)
mcp(rovai_team/create_task)
mcp(rovai_team/update_task)
mcp(rovai_team/list_tasks)
mcp(rovai_team/context_search)
mcp(rovai_team/context_get_message)
mcp(rovai_team/context_get_message_window)
mcp(rovai_team/context_get_message_thread)
mcp(rovai_team/context_get_summary)
mcp(rovai_team/memory_search)
mcp(rovai_team/memory_read)
mcp(rovai_team/memory_write)
mcp(rovai_team/memory_propose_hearth)
```

The user consents to this built-in bundle separately from installing the credentialless Plugin.
Rovai MUST apply the same ownership record, full-file compare-and-swap, crash journal, unknown-field
preservation and conflict behavior required by ADR-0088. A missing, denied, shadowed or divergent
rule makes complete parity unavailable; it MUST NOT be reported as a ready full built-in attachment.

Rovai does not enable `dangerously-skip-permissions` or another global auto-approval mode to obtain
parity. User-owned broader permission settings remain user-owned and cannot substitute for evidence
that the managed exact bundle is complete.

<a id="adr-0089-tool-contract-participates-in-session-compatibility"></a>
#### Tool contract participates in Session compatibility

The canonical catalog digest, Adapter alias-map version, input/output schema digest, Bridge protocol
and build identity, permission-bundle version and corresponding Charter content participate in the
Native Session compatibility identity. Moving from the v0.30 single-tool contract to the complete
catalog requires a new compatible Native Binding; an existing Session is never hot-upgraded to a
different tool contract.

Adapter capability reporting distinguishes full built-in parity from external MCP projection and
ambient isolation. Antigravity can therefore report:

```text
ExternalMcpProjection = Unsupported
TeamGatewayAttachment = AttestedNativeBridge
AmbientMcpIsolation   = PreservedUncontrolled
BuiltInMcpToolParity  = Complete
```

This does not allow assigned external MCP to be silently ignored and does not claim that Rovai can
enumerate or remove Antigravity's ambient MCP.

<a id="adr-0089-real-evidence-gates-readiness"></a>
#### Real evidence gates readiness

Readiness requires all of the following for the currently discovered Runtime behavior:

1. a bound model run discovers all thirteen aliases with the canonical schemas and output contracts;
2. real calls exercise A2A, Task create/update/list, bounded Context Retrieval and Memory
   search/read/write/propose behavior through the attested path;
3. mutation calls demonstrate the same Capability, policy, version, quota and idempotency failures as
   the credentialed path;
4. permission removal, ownership divergence, Binding/Epoch change, cancellation and Runtime exit
   revoke subsequent calls;
5. a normal non-Rovai Runtime sees an empty list, receives `run_not_bound` for direct calls, and
   produces no domain writes;
6. exact-injection Runtimes retain their existing thirteen-tool behavior without migration.

Writing configuration, completing MCP initialization or validating only `tools/list` is insufficient.

<a id="adr-0089-consequences"></a>
### Consequences

- Antigravity Members can coordinate Tasks, retrieve bounded Camp context and use authorized Memory
  through the same built-in semantic surface as other supported Agent Runtimes.
- The attested request protocol, permission manager, capability snapshot, Charter compatibility and
  real Smoke matrix become catalog-aware rather than `post_message`-specific.
- Full parity increases the permission rules managed in Antigravity's native configuration, but each
  rule remains exact and the Bridge remains credentialless and useless outside an active proved Run.
- Memory and Task mutations widen the consequences of an Adapter bug, so per-call attestation and the
  existing Core authorization handler are mandatory; Bridge-side authorization is never sufficient.
- Antigravity still preserves uncontrolled ambient MCP and still cannot receive Rovai external MCP
  Assignments. Built-in parity must not be presented as general MCP parity.
- A later built-in tool addition creates a catalog compatibility change and requires equivalent
  evidence on every Runtime claiming complete parity.

<a id="adr-0089-rejected-alternatives"></a>
### Rejected Alternatives

- **Keep Antigravity permanently on `post_message`.** Rejected because it makes collaboration and
  Memory behavior depend on attachment transport despite a reusable attested Core identity.
- **Expose only the four `team.*` operations.** Rejected because Context Retrieval and Memory are
  part of Rovai's fixed built-in Gateway and the confirmed goal is parity with other Agent Runtimes.
- **Use dotted canonical names in Antigravity.** Rejected because the v0.30 Spike demonstrated a
  native naming compatibility boundary; aliases preserve semantics without repeating that failure.
- **Create separate `rovai-team`, `rovai-context` and `rovai-memory` Servers.** Rejected because it
  multiplies global configuration, permission and ownership surfaces without adding an authority
  boundary.
- **Copy the credentialed Bridge implementation into the attested Bridge.** Rejected because schemas,
  error handling and authorization would drift. Both attachments must share the canonical catalog
  and Core handler.
- **Enable a global permission bypass.** Rejected because one built-in bundle does not justify
  auto-approving unrelated native or ambient tools.
- **Treat tool discovery as a Capability grant.** Rejected because Member business authority and
  current domain visibility remain live Core decisions.

<a id="adr-0089-references"></a>
### References

- [v0.31 Default Team Delivery Qualification](README.md)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0051: Boundary-Capped Context Retrieval](../v0.12/decisions.md#adr-0051)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](../v0.21/decisions.md#adr-0068)
- [ADR-0069: Single Effective Memory and Scope-Bounded Agent Mutation](../v0.21/decisions.md#adr-0069)
- [ADR-0088: Attested Native Team Gateway Attachment](../v0.30/decisions.md#adr-0088)
<!-- legacy-adr-body:end id=ADR-0089 -->
<!-- legacy-adr:end id=ADR-0089 -->

<!-- legacy-adr:begin id=ADR-0090 source-file-sha256=7653b5d3189db557049de8da34eef87e1219c305382705a18e18aebfd3a6153a -->
<a id="adr-0090"></a>

## ADR-0090: Team Delivery Qualification Evidence Boundary

迁移时原路径：`docs/adr/0090-team-delivery-qualification-evidence-boundary.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0090
title: "Team Delivery Qualification Evidence Boundary"
status: accepted
date: 2026-08-02
decision_scope: cross-version
source_version: v0.31
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0090 -->
<a id="adr-0090-context"></a>
### Context

Rovai has real Runtime Smoke tests for launch, Session continuity, permissions, Team Tool calls,
recovery and A2A routing. Those tests prove specific integration contracts, but they do not prove
that a configured Agent team can complete an unfamiliar software-delivery task. Conversely, a
Task's `completed` status is an authorized actor declaration rather than Core verification, and an
Agent's final response cannot be its own acceptance evidence.

The first team evaluation must answer a narrower question before comparing team configurations or
attributing value to individual roles: can one frozen production team deliver externally verified
workspace behavior and settle its execution tree under a fixed budget without post-dispatch human
help? The evidence boundary must prevent harness failures, subjective transcript impressions and
retry-friendly metrics from silently changing that claim.

<a id="adr-0090-decision"></a>
### Decision

<a id="adr-0090-qualification-is-an-externally-verified-delivery-claim"></a>
#### Qualification is an externally verified delivery claim

A Team Delivery Qualification evaluates one exact Qualification Team Configuration against a
versioned Qualification Case. One Formal Qualification Trial passes only when both results hold:

1. **Verified Delivery**: the final workspace satisfies every build, public, withheld, requirement,
   regression and forbidden-change check owned by the external case verifier.
2. **Orchestration Convergence**: the complete AgentRun tree reaches terminal state within the case's
   elapsed-time, AgentRun and A2A budgets without Post-Dispatch Human Intervention.

Agent output, Reviewer approval and Task status never create or override either result. Correct code
with an unsettled or looping Run tree remains an overall failure while retaining its separate
`verifiedDelivery = true` diagnostic fact.

A pre-dispatch fixture, verifier, Runner or required Runtime precondition failure is an Invalid
Qualification Trial and is excluded from the denominator. After accepted task dispatch, Runtime,
permission, tool, timeout, coordination and recovery failures are valid failures of the tested
configuration. A system cannot discard inconvenient post-dispatch outcomes as infrastructure noise.

<a id="adr-0090-human-intervention-has-an-exact-boundary"></a>
#### Human intervention has an exact boundary

Runtime installation, login, Member configuration, case materialization and preflight occur before
dispatch. After Core accepts the task for the Default Lead, any human message, permission decision,
workspace edit, command, configuration change, Runtime restart or continuation prompt is an
intervention and makes the Trial fail.

Passive observation, Runner-owned evidence capture, automatic deadline enforcement, post-terminal
verification and Core's own recovery behavior are not interventions. The Runner does not retry the
task or synthesize “continue” messages.

<a id="adr-0090-formal-trials-use-fresh-product-state-and-real-runtimes"></a>
#### Formal Trials use fresh product state and real Runtimes

A Formal Qualification Trial is driven through public Core commands against one recorded packaged
Release Core. It uses a fresh Core data directory, Camp, Conversations, Native Sessions and Run
Workspace. The Runner configures the frozen Members through domain commands, selects the Default
Lead and sends one ordinary outcome-focused user request. It does not mutate SQLite, drive Renderer,
reuse production Camp/Memory/Task continuity or substitute a mock Runtime.

The host's real Runtime installations, accounts, model services, frozen native permissions and
observable ambient tools remain part of the qualification environment. A formal run requires no
competing Rovai Core process. Debug Core and public demo fixtures can validate the harness but cannot
produce qualification evidence.

Every comparable result set has one immutable Qualification Environment Manifest identifying the
Rovai and Runner builds, host, exact team identities and Capabilities, Runtime executables and
fingerprints, models and options, native permissions, capability snapshots, Team Gateway and ambient
MCP state, case seals and relevant toolchains. Material drift stops the set; later results use a new
Manifest rather than extending the prior sample.

<a id="adr-0090-cases-are-sealed-before-scoring"></a>
#### Cases are sealed before scoring

A Qualification Case contains a clean starting workspace, an outcome-focused request, a Withheld
Verifier, explicit change boundaries and a Trial Budget. Before sealing it MUST demonstrate:

- healthy task-independent installation, build and baseline checks;
- a stable task-specific failure on the starting workspace;
- a stable full pass from an independently prepared reference implementation;
- deterministic repeated verifier results;
- one content identity covering prompt, fixture, verifier, budgets and boundaries.

Correction after sealing creates a new case version and invalidates affected results. Scored case
inputs cannot be used to tune roles, prompts, models or permissions between Independent Qualification
Repeats; a tuned team is a new Qualification Team Configuration.

The scored Sealed Qualification Pack remains outside the open-source repository. Only one starting
workspace and request are materialized for a Trial. The Withheld Verifier and reference answer are
not placed in the Run Workspace and execute only after all Trial Runtime processes terminate. This
is non-adversarial information withholding, not an OS security claim against a same-user process
that intentionally searches the host.

Each materialized workspace is a disposable Git repository with one Runner-created baseline commit
and no Remote. Agents may use normal Git workflows; the Runner retains an external baseline tree
identity so Git metadata changes cannot hide final filesystem changes. Correctness is behavioral and
never measured by similarity to a reference patch.

<a id="adr-0090-repeats-report-reliability-without-retry-friendly-inflation"></a>
#### Repeats report reliability without retry-friendly inflation

An Independent Qualification Repeat creates all product and workspace state anew while keeping the
sealed case and team configuration unchanged. Results report raw pass counts and pass rate. They do
not use `Pass@k` as a synonym for reliability, because “at least one success in k attempts” hides
intermittent failure.

Small samples remain exploratory evidence. A demonstrated pass on the evaluated case is not a claim
of general Agent intelligence, superiority to a solo Agent, causal role contribution, statistical
significance or performance on another technology stack.

<a id="adr-0090-collaboration-evidence-remains-separate"></a>
#### Collaboration evidence remains separate

Each Trial produces a Collaboration Evidence Matrix containing observable participation, delegation
paths, handoff closure, A2A depth, repeated routing, overlapping work, feedback-integration evidence,
loops and budget use. Case metadata may identify relevant and unnecessary role categories for this
diagnostic view, but role participation is not a delivery hard gate.

The Matrix has no composite score and does not alter Verified Delivery or Orchestration Convergence.
Unavailable attribution and semantic judgments unsupported by authoritative evidence remain
`indeterminate`. An optional post-hoc human blind review may interpret exported evidence. v0.31 does
not give a participating model or an independent LLM Judge authority over the qualification result.

<a id="adr-0090-evidence-is-private-by-default"></a>
#### Evidence is private by default

A Qualification Evidence Bundle privately retains the Environment Manifest, case identity,
authoritative snapshots, normalized AgentRun Execution Evidence, A2A/Task facts, final workspace
change, verifier output, outcome and Collaboration Evidence Matrix for both successes and failures.

Runtime-private logs, credentials, environment-variable values, hidden reasoning, reference answers
and Withheld Verifiers are excluded. Nothing is written into the source repository automatically.
Publishing requires an explicit redacted export that preserves the claim boundary without revealing
sealed material.

<a id="adr-0090-consequences"></a>
### Consequences

- Rovai can distinguish “the integration mechanism works” from “this exact team delivered this exact
  case,” and can diagnose correctness and convergence independently.
- Formal evidence is more expensive than a Smoke test: every repeat requires fresh product state,
  real model use, an immutable environment record and external verification.
- A private case pack improves first-use leakage resistance but prevents full public reproduction;
  exported seals and reports prove identity and outcome without revealing the verifier.
- Non-adversarial withholding and preserved ambient MCP limit the claim to the recorded real host
  environment. The result is not a security benchmark or a clean-room model comparison.
- Deterministic rules cannot fully judge architecture taste or whether feedback was semantically
  absorbed. Those gaps remain visible rather than being hidden behind an uncalibrated Judge score.
- Comparative baselines, role ablations and stable benchmark statistics can be added later without
  redefining what a single formal delivery pass means.

<a id="adr-0090-rejected-alternatives"></a>
### Rejected Alternatives

- **Treat Task `completed` or the Lead's final response as verification.** Rejected because both are
  participant-authored declarations rather than external delivery evidence.
- **Score reference-patch similarity.** Rejected because a behaviorally correct implementation may
  have a different valid structure.
- **Use one composite correctness-and-collaboration score.** Rejected because it can let conversational
  activity compensate for broken delivery or conceal a correct artifact behind subjective weights.
- **Use `Pass@3` as the primary reliability result.** Rejected because it rewards repeated attempts
  and can report success despite two failures.
- **Let an LLM Judge determine pass/fail.** Rejected because semantic judgment is useful but biased and
  cannot outrank deterministic build, behavior, boundary and lifecycle evidence.
- **Run formal evidence through Debug Core, Renderer automation or reused production state.** Rejected
  because those paths either change the product boundary or introduce hidden continuity.
- **Commit scored fixtures and hidden tests to the open repository.** Rejected because public access
  destroys the first-use sealed boundary and may leak into future model training.
- **Exclude post-dispatch Runtime failures as invalid.** Rejected because Runtime and Team Tool
  reliability are part of the production configuration being qualified.

<a id="adr-0090-references"></a>
### References

- [v0.31 Default Team Delivery Qualification](README.md)
- [ADR-0012: Collaboration v3 Lightweight Task](../v0.06/decisions.md#adr-0012)
- [ADR-0061: Durable Agent-Inaccessible Execution Evidence](../v0.17/decisions.md#adr-0061)
- [ADR-0062: Interruptible Run Trees](../v0.17/decisions.md#adr-0062)
- [ADR-0089: Attested Built-in MCP Tool Parity](decisions.md#adr-0089)
- [Large Language Models are not Fair Evaluators](https://arxiv.org/abs/2305.17926)
- [Don't Judge Code by Its Cover](https://arxiv.org/abs/2505.16222)
<!-- legacy-adr-body:end id=ADR-0090 -->
<!-- legacy-adr:end id=ADR-0090 -->
