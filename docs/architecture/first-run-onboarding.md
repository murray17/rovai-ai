---
document_type: architecture
authority: desktop-first-run-component-boundary
status: accepted
last_updated: 2026-08-17
---

# First-run Onboarding

## Component authority

| Component | Responsibility |
| --- | --- |
| Electron Main | Determines fresh install versus upgrade before Core creates SQLite, owns the private state machine, validates closed snapshots and serializes atomic writes. |
| Preload bridge | Exposes typed reads and transitions; it does not expose initialization or direct file access. |
| Renderer onboarding gate | Replaces the normal App shell while a mandatory page is unfinished, performs real Runtime discovery/health checks and persists each user choice through Main. |
| Provisioning saga | Converts the saved selection into idempotent existing Core commands, records stage checkpoints and commits the Camp restore target before completion. |
| Core member/runtime services | Retain or create the selected profile and apply the selected model plus Adapter-owned default permissions with normal command/version rules. |
| Core Camp service | Creates the durable Active Quick Chat Camp and remains the sole authority for membership, Default Lead and messages. |
| Camp Composer Draft | Owns starter text after page 3; starter selection never bypasses the normal Draft save or user-send boundary. |
| Restorable location store | Makes the real fourth-page Camp reopenable; it does not own onboarding completion. |

## Startup and state flow

```text
Electron ready
  -> inspect onboarding.json + pre-Core database existence
     -> existing product data: completed(existing_installation)
     -> fresh install: in_progress(welcome)
  -> start Core and Renderer
     -> welcome -> member -> runtime
     -> persist provisioning command IDs + normalized Runtime permissions
     -> retain/create member
     -> configure Runtime/model/default permissions
     -> create Active Quick Chat Camp "初次集结"
     -> commit Camp restorable location
     -> completed(onboarding)
     -> render the real Camp with draft-only starter rows
```

The state file intentionally stays outside Core. It is Desktop admission and progress metadata, while every product
object produced by onboarding is created through existing Core authority and remains after onboarding finishes.

## Recovery boundary

The saga has one durable checkpoint after each effect. Command IDs and the exact normalized Runtime permission payload
are frozen together before effects, so a crash between a Core commit and the following Desktop checkpoint is resolved
by the existing command replay contract without payload drift. Recovery uses the frozen operation and does not depend
on the selected Installation still being discoverable. A crash after a checkpoint skips that stage. The restorable
location is ordered before `complete`, preventing a completed state that has no durable fourth-page destination.

The fourth page is optional in lifecycle terms but durable in product terms. It uses the normal Active Camp, normal
Navigation and normal Composer Draft. The only onboarding-specific Renderer projection is the empty-Camp greeting and
starter row presentation; after the user sends a message, the Camp behaves like any other Quick Chat.

## Invariants

- Core SQLite existence is sampled before Core startup can create a fresh database.
- An unfinished mandatory page is never represented only in React or browser storage.
- Permissions are copied once from the selected Adapter Installation, frozen with the command IDs and never invented
  or subsequently reinterpreted by onboarding UI.
- `初次集结` contains exactly the selected member and makes that member Default Lead.
- Completion happens after the real Camp and its restore target exist, not after starter interaction.
- A starter choice is a durable Draft mutation and cannot produce execution side effects.
- Upgrades never receive a synthetic onboarding Camp.

## References

- [ADR-0202: Desktop-Owned Pre-Core First-Run Admission and Checkpointed Product Provisioning](../adr/0202-desktop-owned-first-run-admission-and-checkpointed-provisioning.md)
- [First-run Onboarding v1](../contracts/first-run-onboarding-v1.md)
- [Camp Activation Lifecycle](camp-activation-lifecycle.md)
- [Camp Composer Draft](camp-composer-draft.md)
- [Runtime Catalog Boundaries](runtime-catalog-boundaries.md)
