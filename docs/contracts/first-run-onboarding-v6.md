---
document_type: interface-contract
contract: first-run-onboarding
version: 6
status: accepted
authority: desktop-first-run-state-authority-origin-provisioning-deferral-and-local-entry
source_version: v1.72
last_updated: 2026-10-05
---

# First-run Onboarding v6 Contract

v6 extends [v5](first-run-onboarding-v5.md) with automatic Runtime configuration of the other unconfigured built-in
members during configured onboarding. Authority-origin admission, the three pages, Runtime deferral and the
Desktop-local starter remain unchanged. Public naming follows [Thread Naming v1](thread-naming-v1.md).

## State and compatibility

New snapshots use the same closed union with `schemaVersion: 3`. An in-progress provisioning operation adds one
required field:

```ts
runtimeCopies: Array<{
  agentId: string
  expectedVersion: number
  commandId: string
  status: 'pending' | 'applied' | 'skipped'
}> | null
```

`null` means the copy plan has not been frozen; `[]` means no eligible targets were found. A plan contains at most
three distinct stable member IDs, excludes the selected member, uses positive safe integer versions and distinct
UUID command IDs, and cannot reuse the selected member/create/Thread command IDs. Each object is exact-key.
A plan can exist only after the selected member's Runtime checkpoint.

Valid schema 1/2 snapshots normalize to schema 3 on read without losing existing identities, command IDs, choices
or checkpoints. Their in-progress operations acquire `runtimeCopies: null`; the next continuation prepares the
missing plan even if the first Thread already exists. Completed snapshots retain their terminal origin and never
reopen or backfill member configurations. Schema 1 still cannot contain `runtime_deferred`. Legacy
`quickChatCampId` normalizes to `quickChatThreadId`; mixed spellings remain invalid.

## Configured provisioning

After any language initialization and the selected member's Runtime checkpoint, the saga reads current members.
For each other built-in preset it retains the present, non-removed profile matching that preset's avatar reference.
Only profiles whose Runtime configuration is null enter the plan. Missing, removed, already configured and unrelated
profiles do not receive writes; missing members are not recreated. Identity customization is preserved.

Main's `prepareRuntimeCopies(targets)` freezes target IDs, exact observed versions and fresh command IDs before any
copy. An existing plan wins over later preparation requests, including recovery after a lost preparation response.
Every pending target receives the existing `members.runtime.set` command with the frozen Runtime kind, complete
model selection/options and Adapter-owned permissions already chosen for onboarding.

Main's `recordRuntimeCopy(agentId, commandId, outcome)` serializes each result:

- `applied`: the Core receipt must be applied with version `expectedVersion + 1`; mark that target applied.
- `skipped`: a known member version conflict, removal or not-found rejection settles that target without a write.
  A later user edit wins; the saga never refreshes the target version to overwrite it.
- `retry`: any other known rejection retains the target/version/configuration but durably allocates a fresh command
  ID before surfacing the existing retry error. Core's cached rejection must not trap the next attempt.

Transport exceptions, unknown outcomes and incomplete receipts do not rotate command IDs or mark progress. Recovery
replays the exact command, allowing Core to return its original committed receipt even if the member has since been
edited. Already applied/skipped checkpoints are not replayed. A response for an older command ID cannot settle or
rotate its replacement; repeated matching terminal checkpoints are idempotent.

Only a non-null plan with no pending target permits new Thread checkpointing and onboarding completion. The first
`初次集结` Thread still contains exactly the selected member as Default Lead. Its restore target is committed before
completion. Runtime copies add no training page, model invocation, message, Run or automatic invitation.

## Verification ownership

- `onboarding-runtime-copy.test.ts`: real Desktop state files with a deterministic Core command ledger; four-member
  Chinese/English initialization, exact model/options/permissions, exclusions, lost responses at each durable boundary,
  known rejection retry, concurrent edits/removal, schema compatibility and completion admission.
- `onboarding-preferences.test.ts` and `onboarding-provisioning.test.ts`: existing admission, permissions,
  selected-member identity, first Thread and restorable-location behavior.

## References

- [First-run architecture](../architecture/first-run-onboarding.md)
- [First-run UI](../ui/components/first-run-onboarding.md)
- [Domain Command Result v1](domain-command-result-v1.md)
- [Camp Composer Draft v16](camp-composer-draft-v16.md)
