---
document_type: protocol-contract
contract: camp-permanent-deletion-v1
authority: camp-permanent-deletion-command-and-runtime-cleanup
status: accepted
version: 1
last_updated: 2026-08-17
---

# Camp Permanent Deletion v1 Contract

## 1. Command

`camps.delete` accepts a user command with the following shape:

```json
{
  "commandId": "uuid",
  "command": {
    "campId": "camp-id",
    "expectedVersion": 4,
    "force": true
  }
}
```

`force` is optional and defaults to `false`. The command is rejected with
`camp.delete_user_required`, `camp.not_found` or `command.version_conflict` before deletion when the
corresponding authority or identity check fails.

## 2. Non-force behavior

When `force` is false, Core evaluates the current deletion blockers. Any non-empty set returns
`camp.delete_blocked` with:

```json
{"campId":"camp-id","blockers":[{"code":"nonterminal_agent_run","count":1}]}
```

No Camp-owned business row is removed by that rejected result.

## 3. Force behavior

When `force` is true, Core captures non-terminal `agentRunId + executionEpoch + adapterKind`
identities under the same database lock used to begin deletion. Blockers do not reject the command.
The existing aggregate deletion removes every Camp-owned row and relationship in one SQLite
transaction and returns:

```json
{
  "campId": "camp-id",
  "forced": true,
  "bypassedBlockers": [{"code":"nonterminal_agent_run","count":1}]
}
```

`forced` is true only when one or more blockers were actually bypassed. A force request against an
already-quiescent Camp returns `forced: false` and an empty `bypassedBlockers` array.

The committed deletion prevents later Runtime, delivery or action callbacks from restoring any
Camp-owned row. The same `commandId` replays the stored `camp.deleted` result without repeating
business deletion.

## 4. Post-commit cleanup

Before returning a successful force request, Core attempts to stop each captured active Runtime
identity, removes its generation-local active-execution registration and invalidates the Camp's
resident Fleet entries. Managed attachment storage is then removed through the existing Camp
attachment cleanup boundary.

These cleanup operations are post-commit and best effort. Their failure does not recreate the Camp,
change `camp.deleted` into a rejection or imply that already-completed provider/external effects were
reversed. No project directory, ordinary branch, worktree, file or commit is deleted.

## 5. Renderer

The destructive Dialog is the explicit force authorization. Its copy names active execution stop,
physical removal, irreversibility and the project-directory boundary. While submission is pending,
all Dialog dismissal and duplicate-submit controls are disabled. Success removes the Camp from
local pagination/cache and navigates an active deleted Camp to the new-conversation surface.

## References

- [ADR-0206](../adr/0206-user-confirmed-force-camp-deletion.md)
- [ADR-0058](../adr/0058-collaboration-v4-presence-aware-admission.md)
- [ADR-0123](../adr/0123-exclusive-agentrun-runtime-fleet.md)
