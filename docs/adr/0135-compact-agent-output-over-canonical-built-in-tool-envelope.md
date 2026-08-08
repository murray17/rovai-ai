---
document_type: adr
id: ADR-0135
title: Compact Agent Output over Canonical Built-in Tool Envelope
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.46
supersedes: []
superseded_by: null
---

# ADR-0135: Compact Agent Output over Canonical Built-in Tool Envelope

## Context

ADR-0124 established the Core-owned Built-in Tool Invocation Envelope as the response boundary for
Rovai's CLI transport. That envelope is the right authority for IPC, receipts, idempotent replay,
evidence, and qualification, but it is too transport-oriented to be the normal model-facing result.
The envelope's `contractVersion`, `ok`, `operation`, `requestId`, `receipt`, and `result` wrapper are
audit and routing identity, not business decisions an Agent normally needs to make.

v0.46 also removes Agent-facing catalog discovery. A Runtime must use fixed business commands and
command-local `--help`; a model must not need to retrieve an internal catalog or an envelope schema in
order to perform an ordinary operation. The boundary therefore needs to be explicit and stable rather
than an accidental collection of CLI print statements.

## Decision

### 1. Keep one complete Core envelope

Core IPC always returns and validates the complete `BuiltinToolInvocationEnvelope` (Envelope v1):

- `contractVersion`, `ok`, canonical `operation`, `requestId`, and `receipt` remain Core-owned;
- exactly one canonical `result` or `error` is present;
- receipt preimage, replay identity, evidence, and qualification consume this complete envelope;
- the CLI cannot create, alter, or use a projection to recompute a receipt.

### 2. Project only after validation

The Agent-facing path is fixed:

```text
Core IPC complete Envelope
  → Envelope validation
  → explicit operation projection
  → one JSON document on stdout
```

Success emits the operation's business result directly. Business failure emits an `error` object. The
ordinary Agent document never contains the Envelope's `contractVersion`, `ok`, `operation`,
`requestId`, `receipt`, or `result` wrapper. This is a rule about the Envelope-to-Agent boundary only:
a future business result may legitimately contain a property with one of those names.

Each of the twelve operations has a closed, explicit `agentOutputSchema` and a golden fixture. The
fixture and schema validate the complete projected document and reject schema-extra fields. There is
no generic recursive "forbidden field" remover, and no percentage target may justify deleting a
business field. An operation that needs no business trimming projects its canonical result unchanged.

### 3. Define the Agent result contract by operation

The v0.46 transport contract defines the projection for all twelve operations. The only additional
business trimming initially approved is:

- `camp.message.send` → `messageId` and `effectiveRecipients`;
- `memory.write` → `memoryId` and `revisionId`.

Task operations retain their v0.45 input and business-result semantics. Search, read, list, and Hearth
proposal operations retain their canonical result fields, including meaningful `false`, `null`, empty
arrays, truncation markers, cursors, and cache states.

### 4. Keep discovery inside Core

The Core catalog remains the sole source for IPC validation, contract tests, Qualification, and
development diagnostics. Catalog entries may carry `resultSchema`, `agentOutputSchema`, error
contracts, and projection identity, but Agent Runtime CLI has no `tool list`, `tool describe`, hidden
discovery alias, or generic `tool invoke`/`tool call` entry point. `--help` is concise and command-local:
it lists accepted input sources, necessary constraints, and a short example; it does not print a full
schema, envelope, receipt, or catalog.

### 5. Make output mode host-owned

The Runtime cannot select a full-envelope mode through an environment variable, hidden flag, or
`--full` switch. Normal Runtime CLI stdout is always Agent Result Projection. Complete envelopes remain
available only through Core IPC, Evidence, Qualification, and an explicitly host-controlled debug
channel that is outside the Agent command surface.

### 6. Publish safe error channels

Business rejection is a projected `error` with the stable `code`, safe `message`, `recovery`, and only
contract-approved business `details`. `builtin_tool.outcome_indeterminate` is special: because no
Agent-callable request lookup/replay API exists, its Agent projection contains only:

```json
{"error":{"code":"builtin_tool.outcome_indeterminate","message":"Confirm current state before acting again.","recovery":"confirm_outcome"}}
```

It does not expose `requestId` or operation identity. Predictable CLI, context, IPC, and protocol
failures use a safe generic structured JSON document and exit code `2`; unstructured stderr is reserved
for process-level failures and is redacted. No stable `builtin_tool.protocol_violation` product error is
introduced.

### 7. Locally replace ADR-0124's Agent-facing clauses

This ADR locally replaces ADR-0124's Agent-facing response and Bootstrap/discovery clauses: the normal
Agent response is a projection, and Agent discovery is removed. ADR-0124's Core-owned envelope, IPC,
receipt, lease, replay, and external-MCP separation remain in force. The v0.46 transport and version
documents are the field-level authority for the replacement clauses.

## Consequences

- Core keeps one auditable response truth; projection cannot corrupt receipt or replay semantics.
- Agents receive stable business JSON and actionable errors without transport identity noise.
- Every operation needs an explicit schema, golden fixture, and projection test; adding a business field
  requires an intentional schema decision.
- Catalog tooling remains available to Core and Qualification without becoming a model-facing protocol.
- Runtime adapters and Bootstrap become smaller, but command-local help must stay accurate.
- Output reduction percentage is recorded as an observability metric only. It is not a release gate and
  cannot override business information retention.
- Qualification/debug tooling must preserve access to complete envelopes without exposing a Runtime
  switch that an Agent can invoke.

## Rejected Alternatives

- **Return a reduced Envelope.** It keeps transport identity in every ordinary result and invites
  consumers to depend on fields that are intentionally Core-only.
- **Strip a global list of forbidden field names recursively.** It would corrupt legitimate future
  business JSON and cannot distinguish an Envelope boundary from a nested domain object.
- **Let an environment variable or hidden flag choose envelope output.** Agent-controlled shells could
  bypass the product boundary and make the same command have two undocumented contracts.
- **Expose `requestId` for indeterminate outcomes.** Without an Agent-callable lookup/replay endpoint it
  does not enable a safe action and encourages blind identity handling.
- **Keep `tool list`/`tool describe` for convenience.** It preserves a second discovery protocol and
  makes the internal catalog an accidental Agent contract.
- **Optimize to a fixed compression percentage.** A percentage cannot decide which business fields are
  necessary and would reward lossy output.

## References

- [v0.46 version overview](../versions/v0.46/README.md)
- [v0.46 implementation plan](../versions/v0.46/implementation-plan.md)
- [Built-in Tool Transport v3](../contracts/builtin-tool-transport-v3.md)
- [Camp Message Send v2](../contracts/camp-message-send-v2.md)
- [ADR-0124: CLI-Only Transport for Rovai Built-in Operations](0124-cli-only-transport-for-rovai-built-in-operations.md)
- [ADR-0118: Local Data Clean Break and Managed Reset Boundary](0118-v041-local-data-clean-break-and-managed-reset-boundary.md)
- [Rovai-ai domain language](../../CONTEXT.md)
