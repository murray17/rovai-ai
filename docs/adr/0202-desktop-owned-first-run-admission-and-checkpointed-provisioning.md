---
document_type: adr
id: ADR-0202
title: Desktop-Owned Pre-Core First-Run Admission and Checkpointed Product Provisioning
status: accepted
date: 2026-08-17
decision_scope: cross-version
source_version: v0.97
supersedes: []
superseded_by: null
---

# ADR-0202: Desktop-Owned Pre-Core First-Run Admission and Checkpointed Product Provisioning

## Context

Rovai needs to distinguish a genuinely fresh Desktop installation from an upgrade before showing mandatory training.
Core startup creates its SQLite database as part of normal bootstrap, so checking only after Core starts destroys the
evidence needed to distinguish those cases. Renderer memory or browser storage is also too weak to own a mandatory,
restart-safe product admission decision.

Completing training creates real Member, Runtime configuration and Camp objects through separate existing Core
authorities. A process can stop after a Core effect commits but before Desktop records the next page state. Replaying
mutable defaults or generating new operation identities after that boundary can duplicate objects or turn one logical
retry into a different command. This requires a durable ownership and recovery choice rather than a page-local UI
implementation detail.

## Decision

Electron Main owns first-run admission and mandatory training progress in a private, versioned Desktop state outside
Core SQLite. Before starting Core, Main samples that state together with current and legacy product-database existence.
A persisted state always wins. With no state, existing product data is admitted as an already-completed installation;
only the absence of product data begins mandatory training.

Renderer may request typed transitions but cannot initialize, reinterpret or bypass this state. Every accepted
mandatory-page transition is durably committed before it is returned to Renderer. Product objects created by training
remain owned by their existing Core services; the Desktop state must never become a second Member, Runtime, Camp,
Message or Draft authority.

Before the first Core mutation, Desktop durably freezes one provisioning operation containing stable command
identities and every mutable payload fragment needed for deterministic retry. It records a checkpoint after each Core
effect. Recovery reuses the same identities and frozen payload, skips recorded stages, and commits a restorable
location for the resulting real product surface before marking mandatory training complete.

Post-training exploration is not another mandatory state. It uses the real Camp and normal durable Composer Draft;
execution still requires the user's ordinary explicit send action.

## Consequences

- Desktop maintains a small admission/progress file in addition to Core product data and must validate and write it
  atomically before exposing transitions to Renderer.
- Upgrades are never blocked by newly introduced training, while a fresh installation cannot skip unfinished
  mandatory pages by restarting the App.
- Provisioning must coordinate existing Core commands and version checks instead of inserting domain rows directly or
  attempting a cross-authority rollback.
- A failed restorable-location commit leaves training incomplete even when the Camp already exists; recovery resumes
  without creating another Camp.
- Field shapes, page order, selected preset, Camp configuration and starter interaction remain in the current Contract
  and UI specifications rather than this ADR.

## Rejected Alternatives

- Store admission only in Core SQLite: rejected because ordinary Core bootstrap creates that database before the
  fresh-versus-upgrade decision can be made, and Desktop startup would lose the required evidence.
- Store progress in Renderer state or browser storage: rejected because it is neither an authoritative nor a reliable
  restart boundary for mandatory product admission.
- Re-run setup from current Adapter defaults after a crash: rejected because the same command identity could acquire a
  different payload and fail idempotent replay or silently change the selected configuration.
- Create onboarding-only copies of Member, Camp or Draft data: rejected because duplicate authorities would require
  migration and reconciliation with normal product behavior.
- Make the post-training starter interaction part of completion: rejected because an optional exploration action must
  not trap an otherwise provisioned user in mandatory training.

## References

- [v0.97 持久首次训练与“初次集结”](../versions/v0.97/README.md)
- [First-run Onboarding v1](../contracts/first-run-onboarding-v1.md)
- [First-run Onboarding architecture](../architecture/first-run-onboarding.md)
- [ADR-0071](0071-configured-camp-creation-and-lazy-conversations.md)
- [ADR-0083](0083-background-runtime-checks-and-actionable-status.md)
- [ADR-0127](0127-atomic-member-runtime-configuration.md)
- [ADR-0128](0128-structured-draft-only-user-message-submission.md)
