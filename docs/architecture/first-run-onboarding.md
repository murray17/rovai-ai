---
document_type: architecture
authority: desktop-first-run-component-boundary
status: accepted
last_updated: 2026-10-05
---

# First-run Onboarding

## Component authority

| Component | Responsibility |
| --- | --- |
| Electron Main | Owns the private state machine, validates closed snapshots and serializes atomic writes; it initializes only from an admitted Full Core authority origin. |
| Preload bridge | Exposes typed reads and transitions; it does not expose initialization or direct file access. |
| Renderer onboarding gate | Replaces the normal App shell while a page is unfinished, performs real Runtime discovery/health checks, projects either configured selection or the zero-usable empty page, and persists user choices through Main. |
| Provisioning saga | Converts the saved selection into idempotent existing Core commands, freezes and copies the configuration to other unconfigured built-in members, records per-target checkpoints and commits the Thread restore target before completion. |
| Core member/runtime services | Retain or create the selected profile and apply the selected model plus Adapter-owned default permissions with normal command/version rules. |
| Core Thread service | Creates the durable Active Quick Chat Thread and remains the sole authority for membership, Default Lead and messages. |
| Desktop-local Composer | Owns the Active Thread starter snapshot after page 3; starter selection only replaces that local input and never bypasses the user-send boundary. |
| Restorable location store | Makes the real fourth-page Thread reopenable; it does not own onboarding completion. |

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
           -> configure selected member Runtime/model/default permissions
           -> freeze eligible built-in targets and copy the same configuration
           -> create Active Quick Chat Thread "初次集结"
           -> commit Thread restorable location
           -> completed(onboarding)
           -> render the real Thread with local-input starter rows
        -> usable Runtime count = 0 or scan produced no reliable result:
           -> rescan, or completed(runtime_deferred)
           -> render the normal App shell without onboarding product mutations
```

The state file intentionally stays outside Core. It is Desktop admission and progress metadata, while every product
object produced by the configured path is created through existing Core authority and remains after onboarding
finishes. The deferred path creates no onboarding-owned product object and therefore has no partial Core state to
reconcile.

Core initially seeds four Chinese built-in profiles. Before recording the selected member checkpoint, configured
English onboarding initializes every present factory profile with its English preset only when it has no Runtime
configuration and all six identity fields still exactly match the Chinese factory preset. It uses existing versioned
`members.update` commands: the selected member retains the provisioning member command ID; other seeds use IDs
derived from that command ID and their member ID. The selected member receives Runtime configuration using its
returned version. Afterward, the saga reads the latest profiles and copies the same frozen Runtime/model/options/permissions to the other present, unconfigured
built-in members. Only the selected member joins the first Thread. Customized, configured or removed profiles retain
their saved identity;
a language switch after onboarding never translates saved member data. If initialization stops partway before the
member checkpoint, recovery recognizes already initialized English profiles and writes only the remaining seeds.

## Recovery boundary

The saga has one durable checkpoint after each effect. The additional Runtime copies freeze target versions and
command IDs before the first copy; each member settles independently. Unknown outcomes replay the exact command.
Known version conflicts/removal settle as skipped; other known rejections allocate a new command ID before retry.
The copy plan must be settled before completion, and later user edits are never overwritten.

Command IDs and the exact normalized Runtime permission payload
are frozen together before effects, so a crash between a Core commit and the following Desktop checkpoint is resolved
by the existing command replay contract without payload drift. Recovery uses the frozen operation and does not depend
on the selected Installation still being discoverable. A crash after a checkpoint skips that stage. The restorable
location is ordered before `complete`, preventing a completed state that has no durable fourth-page destination.

The fourth page is optional in lifecycle terms but durable in product terms. It uses the normal Active Thread and normal
Navigation. Its Composer input is Desktop-local and restorable by Thread; the only onboarding-specific projection is the empty-Thread greeting
and starter row presentation. After the user sends a message, the Thread behaves like any other Quick Chat.

`runtime_deferred` is a second completed lifecycle outcome, not a fourth page and not a paused onboarding state. It is
available only before provisioning begins. Its three product identities are null, it commits no Thread restore target,
and normal startup never routes it back into training. A later Runtime install or login is handled by normal Settings
and member configuration surfaces.

## Invariants

- First-run admission uses Full Core's ticketed `authorityState.current.origin`; Desktop never infers it from a filename.
- A corrupt or unreadable onboarding file uses an in-memory default and warning while preserving the original; Core readiness is independent.
- An unfinished mandatory page is never represented only in React or browser storage.
- Valid schema 1/2 state is normalized to schema 3 without losing an unfinished page or provisioning checkpoint. Completed installations never reopen for configuration backfill.
- Permissions are copied once from the selected Adapter Installation, frozen with the command IDs and never invented
  or subsequently reinterpreted by onboarding UI.
- The empty Runtime page is shown only after scanning settles without a directly continuable Runtime; a scan error is
  an honest no-result input to that page, not a fabricated Runtime failure category.
- Deferring Runtime setup is terminal, requires `provisioning = null`, and cannot issue member, Runtime, Thread or
  restorable-location mutations.
- `初次集结` contains exactly the selected member and makes that member Default Lead.
- Completion happens after the real Thread and its restore target exist, not after starter interaction.
- A starter choice updates only the Desktop-local Active Thread Composer snapshot; it cannot create Core Draft, public-message or execution side effects.
- Upgrades never receive a synthetic onboarding Thread.

## References

- [Thread 资源不变量](foundational-invariants.md#camp-resources)
- [First-run Onboarding v7](../contracts/first-run-onboarding-v7.md)
- [Availability-first Runtime](availability-first-runtime.md)
- [Thread Activation Lifecycle](camp-activation-lifecycle.md)
- [Thread Composer Draft](camp-composer-draft.md)
- [Runtime Catalog Boundaries](runtime-catalog-boundaries.md)

## 跟随系统语言

新配置默认跟随本机语言；旧配置保留原语言。偏好和显示结果分离，首次呈现文本前完成本地解析。欢迎页提供“跟随系统 / 简体中文 / English”，继续使用现有位置和三步流程。创建开始时将具体资料语言写入 schema 4 检查点；系统变化只更新应用文案，不改变本次创建资料或已保存的队员身份。字段、迁移和恢复规则见 [Interface Language v2](../contracts/interface-language-v2.md)。
