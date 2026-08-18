---
document_type: version-decisions
version: v0.23
lifecycle: historical
last_updated: 2026-08-18
---

# v0.23 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0072](#adr-0072) | Directory Workspace Identity and Dynamic Git Capability | `accepted` |

<!-- legacy-adr:begin id=ADR-0072 source-file-sha256=3c716c28ce58fbdc8ecbb717e03e0fc1768dae9c8aa7fb3e4280f47b06904430 -->
<a id="adr-0072"></a>

## ADR-0072: Directory Workspace Identity and Dynamic Git Capability

迁移时原路径：`docs/adr/0072-directory-workspace-and-dynamic-git-capability.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0072
title: Directory Workspace Identity and Dynamic Git Capability
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.23
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0072 -->
<a id="adr-0072-context"></a>
### Context

Camp creation currently treats a verified Git worktree and its Repository Scope as the durable
Project identity. This prevents an ordinary directory, an empty directory, and an empty Git
repository without a first commit from becoming a Camp workspace. It also makes a Camp's continued
file and Agent behavior depend on Git metadata that can legitimately appear, disappear, move, or
become temporarily unreadable after creation.

Agent execution only requires a safe directory. Branch, commit, diff and worktree behavior require
Git, but do not require Rovai-ai to own a permanent repository identity. Persisting Repository
Binding would add identity conflicts, reconciliation commands, migrations and audit semantics that
are not needed for current execution.

This decision locally replaces ADR-0071's Repository Binding and Project Binding clauses. Its
configured Camp creation, durable empty Camp, collaboration-mode and lazy Conversation decisions
remain effective.

<a id="adr-0072-decision"></a>
### Decision

<a id="adr-0072-camp-persists-a-directory-workspace"></a>
#### Camp persists a directory workspace

Every Camp persists exactly:

```ts
interface CampWorkspaceBinding {
  projectBindingKind: 'lobby' | 'directory'
  projectPath: string
}
```

`projectPath` is always an absolute canonical real path. `lobby` identifies Rovai-ai's managed
Lobby directory. `directory` identifies the exact user-selected directory. Git state never changes
the binding kind.

Core is the final admission authority. For a user-selected directory, Core requires an absolute,
existing, traversable, readable directory; canonicalizes symlinks; rejects the filesystem root,
Rovai-ai's private data tree, direct Git metadata directories and bare repositories; and persists
only the canonical path. It does not maintain generic Home, Desktop, Documents or `.ssh`
blacklists. Runtime permissions remain responsible for what an Agent may actually execute.

Core repeats directory validation before every AgentRun. A failed check blocks that run but does
not invalidate or delete the Camp. Validation and capability reads do not silently update the
persisted path.

<a id="adr-0072-git-is-a-dynamic-capability"></a>
#### Git is a dynamic capability

Core observes one of:

```ts
type GitCapabilityState = 'not_git' | 'git_valid' | 'git_invalid'
```

A Git observation may contain repository root, Git common directory, `sha1 | sha256` object
format, nullable HEAD commit, nullable branch, nullable dirty state and observation time. An empty
Git repository is `git_valid` with `headCommit = null`. Rovai-ai never runs `git init`.

Core probes Git at Camp creation, before AgentRun launch, immediately before a Git-specific
operation, and after AgentRun termination. A directory that later gains `.git` immediately gains
Git behavior. Missing or invalid Git metadata disables only Git-specific behavior; ordinary file
work, Agent execution, collaboration and history remain available while the directory itself is
safe.

<a id="adr-0072-git-observations-are-agentrun-audit-facts"></a>
#### Git observations are AgentRun audit facts

AgentRun persists `workspacePath`, `startingGitObservation` and `endingGitObservation`. Recovery
preserves the original starting observation. Ending observations describe the terminal state that
Core could observe; they do not declare a permanent Camp repository.

Rovai-ai does not persist or expose Repository Binding, Repository Scope, repository
reconciliation, Camp-private Git refs, or cross-Camp repository identity aggregation.

<a id="adr-0072-project-navigation-groups-by-canonical-directory"></a>
#### Project navigation groups by canonical directory

Lobby Camps remain under Lobby even if the managed directory becomes a Git worktree. Directory
Camps group at read time by exact canonical `projectPath` using:

```text
directory:<canonical-project-path>
```

There is no Project table, Repository Scope key, or Git-common-directory grouping.

<a id="adr-0072-consequences"></a>
### Consequences

- Ordinary and empty directories can host durable Camps without Git initialization.
- A Camp survives Git initialization, removal, corruption, replacement and branch/commit changes.
- Git UI state is current observation rather than a promise made at creation.
- Run history can explain start/end commit, branch and dirty changes without conflating history
  with current capability.
- Core must keep directory safety validation and Git probing separate and must fail Git operations
  closed when the latest observation is not `git_valid`.
- The unreleased database may use an incompatible migration that removes repository identity
  columns and resets existing collaboration aggregates instead of dual-reading old bindings.

<a id="adr-0072-rejected-alternatives"></a>
### Rejected Alternatives

<a id="adr-0072-require-every-camp-directory-to-be-a-git-repository"></a>
#### Require every Camp directory to be a Git repository

Rejected because Agent execution and file work do not require Git, and empty or non-Git
directories are legitimate workspaces.

<a id="adr-0072-automatically-run-git-init"></a>
#### Automatically run `git init`

Rejected because it mutates user content, changes repository discovery for parent/child
directories, and turns directory selection into an unexpected source-control action.

<a id="adr-0072-persist-repository-binding-and-reconcile-identity-changes"></a>
#### Persist Repository Binding and reconcile identity changes

Rejected because current Git behavior does not require stable repository identity, while the model
would add mismatch, rebind, removal, migration and audit protocols.

<a id="adr-0072-snapshot-git-capability-permanently-at-camp-creation"></a>
#### Snapshot Git capability permanently at Camp creation

Rejected because Git metadata is mutable external state. A permanent snapshot would become stale
and either incorrectly block available Git behavior or incorrectly enable unavailable behavior.

<a id="adr-0072-group-projects-by-git-common-directory"></a>
#### Group Projects by Git common directory

Rejected because Project navigation is a directory-workspace view. Worktrees and later Git changes
must not silently move Camps between product groups.

<a id="adr-0072-references"></a>
### References

- [v0.23 version scope](README.md)
- [ADR-0071: Configured Camp Creation and Lazy Conversations](../v0.22/decisions.md#adr-0071)
- [Domain vocabulary](../../../CONTEXT.md)
- [Workspace and Git capability implementation](../../../crates/rovai-core/src/git.rs)
- [Directory workspace migration](../../../crates/rovai-core/src/db.rs)
<!-- legacy-adr-body:end id=ADR-0072 -->
<!-- legacy-adr:end id=ADR-0072 -->
