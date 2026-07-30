---
document_type: adr
id: ADR-0072
title: Directory Workspace Identity and Dynamic Git Capability
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.23
supersedes: []
superseded_by: null
---

# ADR-0072: Directory Workspace Identity and Dynamic Git Capability

## Context

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

## Decision

### Camp persists a directory workspace

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

### Git is a dynamic capability

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

### Git observations are AgentRun audit facts

AgentRun persists `workspacePath`, `startingGitObservation` and `endingGitObservation`. Recovery
preserves the original starting observation. Ending observations describe the terminal state that
Core could observe; they do not declare a permanent Camp repository.

Rovai-ai does not persist or expose Repository Binding, Repository Scope, repository
reconciliation, Camp-private Git refs, or cross-Camp repository identity aggregation.

### Project navigation groups by canonical directory

Lobby Camps remain under Lobby even if the managed directory becomes a Git worktree. Directory
Camps group at read time by exact canonical `projectPath` using:

```text
directory:<canonical-project-path>
```

There is no Project table, Repository Scope key, or Git-common-directory grouping.

## Consequences

- Ordinary and empty directories can host durable Camps without Git initialization.
- A Camp survives Git initialization, removal, corruption, replacement and branch/commit changes.
- Git UI state is current observation rather than a promise made at creation.
- Run history can explain start/end commit, branch and dirty changes without conflating history
  with current capability.
- Core must keep directory safety validation and Git probing separate and must fail Git operations
  closed when the latest observation is not `git_valid`.
- The unreleased database may use an incompatible migration that removes repository identity
  columns and resets existing collaboration aggregates instead of dual-reading old bindings.

## Rejected Alternatives

### Require every Camp directory to be a Git repository

Rejected because Agent execution and file work do not require Git, and empty or non-Git
directories are legitimate workspaces.

### Automatically run `git init`

Rejected because it mutates user content, changes repository discovery for parent/child
directories, and turns directory selection into an unexpected source-control action.

### Persist Repository Binding and reconcile identity changes

Rejected because current Git behavior does not require stable repository identity, while the model
would add mismatch, rebind, removal, migration and audit protocols.

### Snapshot Git capability permanently at Camp creation

Rejected because Git metadata is mutable external state. A permanent snapshot would become stale
and either incorrectly block available Git behavior or incorrectly enable unavailable behavior.

### Group Projects by Git common directory

Rejected because Project navigation is a directory-workspace view. Worktrees and later Git changes
must not silently move Camps between product groups.

## References

- [v0.23 version scope](../versions/v0.23/README.md)
- [ADR-0071: Configured Camp Creation and Lazy Conversations](0071-configured-camp-creation-and-lazy-conversations.md)
- [Domain vocabulary](../../CONTEXT.md)
- [Workspace and Git capability implementation](../../crates/rovai-core/src/git.rs)
- [Directory workspace migration](../../crates/rovai-core/src/db.rs)
