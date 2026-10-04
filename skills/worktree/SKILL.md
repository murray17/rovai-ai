---
name: worktree
description: Use when the user requests a Git worktree or a development task needs an isolated directory to create, find, reuse, hand off, or clean up. Exclude read-only work, non-Git repositories, and tasks that need no separate branch or directory.
---

# Git Worktree

Use one reusable branch and worktree per logical change. Follow repository and user rules. Run later commands and edits in the selected worktree. Respond in the user's language.

Do not silently stash, move uncommitted work, overwrite directories, or force-delete branches or worktrees.

## Inspect and reuse

```bash
git rev-parse --show-toplevel
git status --short --branch
git worktree list --porcelain
git branch --list
```

Read relevant repository instructions. Determine whether the current worktree fits the task, the target branch is checked out elsewhere, an existing branch/directory can be reused, uncommitted work is required, or governance documents must precede coding.

If uncommitted changes must move, ask the user to choose committing, making a patch, or staying in the current worktree. Do not transport them silently.

## Conditional governance baseline

Only when repository or user rules require governance documents to enter the mainline before coding:

1. Identify the actual mainline; do not assume `main`.
2. Use its existing clean checkout and synchronize according to repository rules without overwriting other work.
3. Change only required governance documents, run documentation gates, and commit them separately on the mainline.
4. Record the immutable commit SHA as the coding baseline.
5. Bring an empty coding worktree to that baseline. If it already contains code, integrate by the repository's merge rules without rewriting history.

If permissions or dirty state prevent this safely, report the obstacle before coding.

## Select branch, base, and directory

Prefer user-specified names and repository conventions; otherwise use a short task slug with `feat/`, `fix/`, `docs/`, `chore/`, or `work/` as appropriate.

Choose the base in this order: required governance commit, explicit user choice, repository rule, related branch, then current `HEAD`. Clarify a choice that materially changes the work. Fetch only when requested for freshness or required by repository rules; disclose an offline baseline.

Use the specified directory or repository convention; otherwise a sibling `<repo>-<slug>`. Use `.worktrees/` only under an existing ignored convention; do not edit `.gitignore` merely to create one.

Reuse in order:

1. The current worktree if suitable.
2. The existing worktree attached to the target branch.
3. An existing unattached branch: `git worktree add <path> <branch>`.
4. A new branch: `git worktree add -b <branch> <path> <base>`.

Stop for an existing unregistered target directory or unresolved ambiguous target; do not delete or overwrite it.

## Verify and hand off

Check the actual root, branch, base SHA, worktree status, and required governance ancestry. Run installs, builds, tests, and edits in that root. Do not copy secrets, runtime state, caches, or uncommitted changes from another worktree.

Record absolute path, branch, base, governance commit if applicable, status (`active`, `ready`, `merged`, or `abandoned`), changes, validation, and next action in the task, issue, handoff, or final report. Follow-up sessions reuse that checkout; a new session alone does not justify a new branch or worktree.

## Clean up

Follow repository rules for merged or abandoned worktrees; otherwise clean up only when requested. Verify the worktree is clean, then use `git worktree remove`, safe branch deletion with `git branch -d`, and `git worktree prune` as appropriate. Preserve unmerged, dirty, or uncertain work. Force operations require explicit authorization.
