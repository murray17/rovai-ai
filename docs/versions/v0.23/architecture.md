---
document_type: version-architecture
version: v0.23
lifecycle: historical
authority: version-design
last_updated: 2026-07-30
---

# v0.23 Architecture

## 1. Persistent workspace identity

```ts
interface CampWorkspaceBinding {
  projectBindingKind: 'lobby' | 'directory'
  projectPath: string
}
```

`projectPath` is an absolute canonical real path. Lobby and directory are product workspace kinds,
not Git states. Lobby remains Lobby if `.git` appears.

## 2. Directory admission

Electron's picker is only a hint boundary. Core revalidates selection at Camp creation and again
before every AgentRun:

1. input is absolute;
2. path exists and canonicalizes;
3. target is a readable, traversable directory;
4. target is not the filesystem root;
5. target is outside Rovai-ai private data, except the exact managed Lobby;
6. target is not `.git`, a gitdir target, a worktree private gitdir, or a bare repository.

The persisted value is the canonical result. Validation reads never repair or rewrite a Camp.

## 3. Dynamic Git observation

```ts
type GitCapabilityState = 'not_git' | 'git_valid' | 'git_invalid'

interface GitObservation {
  state: GitCapabilityState
  repositoryRoot: string | null
  gitCommonDir: string | null
  objectFormat: 'sha1' | 'sha256' | null
  headCommit: string | null
  branch: string | null
  dirty: boolean | null
  observedAt: string
}
```

`git_valid` requires a working tree but not a commit. A bare repository is never a Camp workspace.
Git absence disables Git-only behavior. Git invalidity fails Git actions closed while normal
directory behavior remains available.

## 4. AgentRun audit

```text
Camp(projectPath)
└── CampTurn
    └── AgentRun
        ├── workspace.executionRoot
        ├── startingGitObservation
        └── endingGitObservation
```

The scheduler validates the directory and captures the starting observation before launch. Runtime
recovery reuses the frozen workspace and does not overwrite the first starting observation.
Terminal success, failure and cancellation capture an ending observation when the directory
remains observable.

## 5. Read side and UI

Directory Camps group by exact canonical path. Navigation group keys are
`directory:<canonical-project-path>`. Git roots and common directories are display-only dynamic
facts and never grouping keys.

The selector and workspace badge map dynamic state to explicit text. `not_git` is neutral, not an
error; `git_invalid` is attention and explains that ordinary file work remains available.

## 6. Schema

Migration v35 directly resets existing collaboration aggregates, replaces the Camp table with the
directory binding shape, drops repository evidence/identity indexes, and adds nullable
`starting_git_observation_json` / `ending_git_observation_json` to AgentRun. The product is not
released, so no dual read or binding backfill is retained. Migration v36 repairs orphaned
Camp-message mention/reference index rows from databases that already ran an early v35 build.
