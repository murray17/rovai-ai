---
document_type: architecture
authority: desktop-first-run-component-boundary
status: accepted
last_updated: 2026-08-30
---

# First-run Onboarding

## Component authority

| Component | Responsibility |
| --- | --- |
| Electron Main | Owns the private state machine, validates closed snapshots and serializes atomic writes; it initializes only from an admitted Full Core authority origin. |
| Preload bridge | Exposes typed reads and transitions; it does not expose initialization or direct file access. |
| Renderer onboarding gate | Replaces the normal App shell while a page is unfinished, performs real Runtime discovery/health checks, projects either configured selection or the zero-usable empty page, and persists user choices through Main. |
| Provisioning saga | Converts the saved selection into idempotent existing Core commands, records stage checkpoints and commits the Camp restore target before completion. |
| Core member/runtime services | Retain or create the selected profile and apply the selected model plus Adapter-owned default permissions with normal command/version rules. |
| Core Camp service | Creates the durable Active Quick Chat Camp and remains the sole authority for membership, Default Lead and messages. |
| Camp Composer Draft | Owns starter text after page 3; starter selection never bypasses the normal Draft save or user-send boundary. |
| Restorable location store | Makes the real fourth-page Camp reopenable; it does not own onboarding completion. |

## Startup and state flow

```text
Electron ready
  -> show Bootstrap Shell + load onboarding.json into memory
  -> start Full Core
     -> authority initialized: initialize in_progress(welcome)
     -> authority existing/migrated: initialize completed(existing_installation)
     -> authority blocked: keep Bootstrap Shell; do not initialize onboarding
  -> Full Core ready -> mount authoritative Renderer
     -> welcome -> member -> runtime
        -> usable Runtime exists:
           -> persist provisioning command IDs + normalized Runtime permissions
           -> retain/create member
           -> configure Runtime/model/default permissions
           -> create Active Quick Chat Camp "初次集结"
           -> commit Camp restorable location
           -> completed(onboarding)
           -> render the real Camp with draft-only starter rows
        -> usable Runtime count = 0 or scan produced no reliable result:
           -> rescan, or completed(runtime_deferred)
           -> render the normal App shell without onboarding product mutations
```

The state file intentionally stays outside Core. It is Desktop admission and progress metadata, while every product
object produced by the configured path is created through existing Core authority and remains after onboarding
finishes. The deferred path creates no onboarding-owned product object and therefore has no partial Core state to
reconcile.

## Recovery boundary

The saga has one durable checkpoint after each effect. Command IDs and the exact normalized Runtime permission payload
are frozen together before effects, so a crash between a Core commit and the following Desktop checkpoint is resolved
by the existing command replay contract without payload drift. Recovery uses the frozen operation and does not depend
on the selected Installation still being discoverable. A crash after a checkpoint skips that stage. The restorable
location is ordered before `complete`, preventing a completed state that has no durable fourth-page destination.

The fourth page is optional in lifecycle terms but durable in product terms. It uses the normal Active Camp, normal
Navigation and normal Composer Draft. The only onboarding-specific Renderer projection is the empty-Camp greeting and
starter row presentation; after the user sends a message, the Camp behaves like any other Quick Chat.

`runtime_deferred` is a second completed lifecycle outcome, not a fourth page and not a paused onboarding state. It is
available only before provisioning begins. Its three product identities are null, it commits no Camp restore target,
and normal startup never routes it back into training. A later Runtime install or login is handled by normal Settings
and member configuration surfaces.

## Invariants

- First-run admission uses Full Core's ticketed `authorityState.current.origin`; Desktop never infers it from a filename.
- A corrupt or unreadable onboarding file uses an in-memory default and warning while preserving the original; Core readiness is independent.
- An unfinished mandatory page is never represented only in React or browser storage.
- Valid schema 1 state is normalized to schema 2 without losing an unfinished page or provisioning checkpoint.
- Permissions are copied once from the selected Adapter Installation, frozen with the command IDs and never invented
  or subsequently reinterpreted by onboarding UI.
- The empty Runtime page is shown only after scanning settles without a directly continuable Runtime; a scan error is
  an honest no-result input to that page, not a fabricated Runtime failure category.
- Deferring Runtime setup is terminal, requires `provisioning = null`, and cannot issue member, Runtime, Camp or
  restorable-location mutations.
- `初次集结` contains exactly the selected member and makes that member Default Lead.
- Completion happens after the real Camp and its restore target exist, not after starter interaction.
- A starter choice is a durable Draft mutation and cannot produce execution side effects.
- Upgrades never receive a synthetic onboarding Camp.

## References

- [Camp 资源不变量](foundational-invariants.md#camp-resources)
- [First-run Onboarding v3](../contracts/first-run-onboarding-v3.md)
- [Availability-first Runtime](availability-first-runtime.md)
- [Camp Activation Lifecycle](camp-activation-lifecycle.md)
- [Camp Composer Draft](camp-composer-draft.md)
- [Runtime Catalog Boundaries](runtime-catalog-boundaries.md)
