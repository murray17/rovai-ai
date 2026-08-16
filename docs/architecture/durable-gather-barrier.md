---
document_type: architecture
architecture: durable-gather-barrier
authority: gather-component-boundaries
status: accepted
last_updated: 2026-08-16
---

# 持久 Gather Barrier 架构

本架构组合 [ADR-0193](../adr/0193-durable-gather-barrier-over-unified-message-delivery.md)、
[ADR-0195](../adr/0195-generation-scoped-last-gather-return.md)、
[ADR-0196](../adr/0196-self-contained-gather-completion-request.md)、[Gather v2](../contracts/gather-v2.md)
与 [Message Delivery v4](../contracts/message-delivery-v4.md)。

## 组件与权威

```text
Lead AgentRun --team.gather--> acceptance transaction
  ├─ one public request CampMessage
  ├─ GatherRecord + GatherItem × N
  ├─ optional forward Delivery × N ──> member AgentRun × 0..N
  └─ reserve one required completion responsibility

member normal send
  ├─ public CampMessage / Mention / reply (always visible)
  └─ exact return Delivery ──> gather_captured / settled / no Lead Run

member/forward terminal --same transaction--> Item terminal --> Barrier CAS
  ├─ immutable gather_completed snapshot
  ├─ Gather ready
  └─ one required Completion Delivery ──normal Lead FIFO──> one completion Run
```

`CampMessage` owns public content and rendering. `MessageDelivery` owns recipient execution, queue, attempt, wait and
target Run. `GatherRecord/GatherItem` own aggregate responsibility and Barrier state. ContextManifest owns exact model
input evidence; Runtime Input Delivery owns accepted transport evidence. No component derives another component's facts
from rendered body or mutable Session state.

## 接受与分账

Gather reuses the public-send addressing pipeline but requires a non-empty Effective Recipient set and current Default
Lead authorization. The transaction reserves two independent monotonic quantities: accepted public recipient Deliveries
and possible AgentRun responsibilities. N forward Deliveries consume N/N; the future completion consumes 0/1. A
captured return consumes 0/0 and is instead bounded to 16 writes per Item/current target Run/retry generation. The
ordinary CampTurn cap and deadline remain unchanged.

Each forward Delivery is optional from acceptance onward so a pre-materialization failure cannot fail the CampTurn before
the aggregate completion. The later Completion Delivery is required and closes the aggregate's Lead responsibility.

## Capture and Barrier linearization

Capture is decided inside the ordinary send transaction from persisted source Run, trigger Delivery generation,
GatherItem and frozen initiator identities. A captured return is terminal before commit and never reaches the Dispatch
Pump. Other recipients in the same send remain ordinary Deliveries. Barrier result selection uses only the current Item
target/generation and keeps its final accepted message; older progress and retry-generation facts remain public audit
history but do not enter the current completion.

All terminal and retry paths call one helper while their immediate transaction is open. The helper first updates the
current Item, then serializes retry-vs-ready and stop-vs-ready through Gather status/version. The winning final terminal
transaction creates the immutable input and Completion Delivery before CampTurn recompute; therefore observers cannot
see “all Items terminal” without either cancellation or a queued required completion.

## Completion delivery and Context

Completion is a regular dispatchable Delivery with a different kind. It uses the frozen original Conversation instead
of resolving the current Default Lead, but otherwise uses recipient FIFO, attempt fence, target busy, Runtime readiness,
capacity, Context preflight and explicit interrupted recovery. Materialization validates that Conversation still belongs
to the initiator and CAS-writes completionRunId.

Formatter v16 projects the Barrier snapshot as mandatory `gather_completed` Current Input, including the full durable
request and current-generation Item/result evidence. Public history selection may include the same messages, but
duplicates do not change snapshot authority. Recovery reads frozen Context bytes; it never re-runs the Barrier or
reselects results. Frozen input v1 / Formatter v15 continuations remain exact legacy recovery facts.

## Cancellation and read projection

CampTurn Stop, Camp close and initiator leave mark collecting/ready/completing Gather cancelled and cancel pending
completion within the same lifecycle transaction. A Default Lead change is intentionally ignored. Read Side exposes
Delivery/Run discriminants for diagnostics and avoids adding completion to public request recipients. V2 has no Gather
card or private result surface.
