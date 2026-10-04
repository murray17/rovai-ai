# Scope, Kind and direction

Choose the smallest Scope that fully expresses the meaning. Revision preserves Scope, Kind, counterparty and direction. Copy the returned `target` intact; similar text or membership in a writable set cannot establish identity.

| Scope | Purpose and Agent authority |
| --- | --- |
| Companion | User-to-current-member collaboration. `preference`, `agreement`, `lesson`; write only your own Companion. `effective` applies immediately. |
| Relationship | Your future responsibility toward one present member in the current Thread. `agreement` or `lesson`; write only `directed(self -> counterparty)`. |
| Hearth | Application-global understanding for all members in the user's local Rovai home, across Threads. All three Kinds; `memory write` creates a pending user review. |

A Relationship View for A and B returns `directed(A -> B)` and `mutual(A, B)`, not `directed(B -> A)`. Reading mutual information grants no write authority. Do not write reverse or mutual relationships, another member's Companion, or commitments on their behalf.

Hearth success is `review_pending`. Its candidate is not Memory, a Revision or Agent-readable content until accepted by the user. Hearth is application-global, not Thread-wide.

## Capacity and user governance

Both active count and current-body byte limits apply:

| Scope | Active limit |
| --- | --- |
| Hearth, application-wide | 32 entries / 16 KiB |
| Companion, per member | 32 entries / 16 KiB |
| Relationship, per unordered pair | 12 entries / 12 KiB |

Retire/Forget releases capacity. On `memory.capacity_exceeded`, stop; do not fragment the meaning or reuse a `runtimeToolCallId` as a new command.

Retire, Reactivate, Forget, Supersession and review scheduling/decisions belong to structured user governance. Do not simulate forgetting with a contradictory body.
