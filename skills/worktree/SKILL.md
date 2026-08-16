---
name: worktree
description: 当用户明确要求使用 Git worktree，或需要为一项独立开发工作创建、查找、复用、交接或清理隔离工作目录时使用。普通只读任务、非 Git 仓库，以及当前工作无需独立分支或工作目录时不使用。
---

# Git Worktree

为一个逻辑改动准备独立、可复用的 Git worktree，使它与主工作目录和其它并行改动彼此隔离。

## 原则

- 一个逻辑改动使用一个分支和一个 worktree。
- 创建前先查找并复用已有 worktree 或分支。
- 仓库自己的开发说明、分支规则和目录约定始终优先。
- 需要先落地主线的版本、ADR 等治理文档时，先提交文档，再建立编码基线。
- 不自动 stash、移动未提交改动或执行破坏性清理。
- 不覆盖已有目录，不强制删除分支或 worktree。
- 后续命令和文件修改都在选定的 worktree 中执行。

## 1. 检查现状

确认当前目录属于 Git 仓库，并查看现有工作区：

```bash
git rev-parse --show-toplevel
git status --short --branch
git worktree list --porcelain
git branch --list
```

读取实际存在的仓库说明，例如 `AGENTS.md`、`CONTRIBUTING.md`、`CLAUDE.md`、`README.md` 或相关 `docs/`。

先判断：

- 当前目录是否已经是这项改动的正确 worktree；
- 目标分支是否已在其它 worktree 中；
- 是否存在可复用的分支或目录；
- 当前工作是否依赖未提交改动；
- 本次改动是否要求先新增或更新 version、ADR、implementation plan、contract、changelog 等治理文档。

若需要携带未提交改动，不要静默 stash、复制或移动；先让用户选择提交、生成 patch，或留在当前工作区。

## 2. 先处理主线治理文档

如果仓库规则或用户要求本次改动先新增或更新版本、ADR 等治理文档，并要求这些文档先进入主线，则在开始编码前完成：

1. 确认仓库的主线分支；在以 `main` 为主线的仓库中使用 `main`。
2. 使用当前已经检出该主线分支的干净工作目录，按仓库规则同步它，不覆盖其它未提交工作。
3. 只创建或更新本次改动所需的治理文档。
4. 运行仓库规定的文档检查。
5. 把治理文档作为独立提交提交到主线。
6. 记录该提交的不可变 SHA，并将它作为编码 worktree 的基线。

```bash
git rev-parse HEAD
```

完成主线文档提交后，才创建新的编码 worktree。这样编码分支从一开始就包含已经落地的版本范围和架构决定，不需要在编码开始后再补合并。

如果编码 worktree 已经创建但尚未产生代码改动，先把其分支快进或按仓库规则更新到治理文档提交，再开始编码。

如果编码 worktree 已经存在代码提交或未提交改动，不要自动重写历史或强制移动分支。先按仓库规则把主线治理文档提交合入该分支，确认工作区和基线正确后再继续。

如果当前没有权限提交主线，或主线工作目录不干净且不能安全处理，停止编码并明确报告阻塞，不要把要求主线先行的治理文档只留在功能分支中。

## 3. 确定分支、基线和目录

名称优先使用用户指定值、Issue/PR/任务编号，或由改动目标生成的简短 slug。

分支名遵循仓库约定。没有约定时使用合适的：

```text
feat/<slug>
fix/<slug>
docs/<slug>
chore/<slug>
work/<slug>
```

基线优先级：

1. 已提交的主线治理文档提交；
2. 用户明确指定的 commit、tag 或分支；
3. 仓库说明指定的基线；
4. 与当前工作直接相关的当前分支或提交；
5. 当前 `HEAD`。

不要默认假设 `main`、`master` 或远端默认分支就是正确基线。不同选择会改变结果时，先向用户确认。

记录不可变基线：

```bash
git rev-parse <base-ref>
```

目录优先使用仓库或用户指定位置；否则优先放在主工作目录旁边，例如：

```text
<repository-name>-<slug>
```

只有仓库已经约定并忽略内部目录时，才使用 `.worktrees/<slug>`。不要擅自修改项目 `.gitignore`。

## 4. 复用或创建

按以下顺序处理：

- 当前目录就是目标 worktree：直接使用；
- 目标分支已在某个 worktree 中：使用该路径；
- 目标分支存在但未被其它 worktree 使用：为它添加 worktree；
- 没有对应分支和 worktree：创建新分支和 worktree。

复用已有分支：

```bash
git worktree add "$WORKTREE_PATH" "$BRANCH"
```

创建新分支：

```bash
git worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_COMMIT"
```

目标路径已存在但不是登记过的 Git worktree 时停止，不覆盖或删除。出现多个合理候选时列出它们，让用户选择。

只有用户要求最新远端状态或仓库规则要求同步时才 fetch；无法联网时明确说明使用本地基线。

## 5. 验证并使用

```bash
git -C "$WORKTREE_PATH" rev-parse --show-toplevel
git -C "$WORKTREE_PATH" branch --show-current
git -C "$WORKTREE_PATH" rev-parse HEAD
git -C "$WORKTREE_PATH" status --short --branch
```

确认路径、分支和基线符合预期。若本次存在主线治理文档提交，还要确认该提交已经包含在 worktree 的历史中。

此后的命令、文件读写、依赖安装、构建和测试都使用该 worktree 作为工作目录。环境准备与校验命令遵循仓库说明，不从其它工作目录自动复制 secrets、运行时状态、缓存或未提交文件。

## 6. 交接

需要后续会话或协作者继续时，记录：

```text
Worktree: <absolute path>
Branch: <branch>
Base: <base commit>
Governance: <主线文档提交；没有则写“无”>
Status: active | ready | merged | abandoned
Changes: <简短摘要>
Validation: <已运行的检查和结果>
Next: <下一步>
```

把信息写入项目实际使用的任务、Issue、交接记录或最终回复。后续工作先复用该路径，不因更换会话或执行者而创建重复分支和目录。

## 7. 清理

一次会话结束本身不是清理条件。改动已合入或明确放弃后，按仓库规则完成同次收口；仓库没有更严格规则时，只在用户要求清理时执行。

先确认工作区干净：

```bash
git -C "$WORKTREE_PATH" status --porcelain
```

然后可以执行：

```bash
git -C "$PRIMARY_ROOT" worktree remove "$WORKTREE_PATH"
git -C "$PRIMARY_ROOT" branch -d "$BRANCH"
git -C "$PRIMARY_ROOT" worktree prune
```

分支未合入、存在未提交内容或清理意图不明确时，保留现场并说明原因。未经明确授权不使用 `--force`。

## 完成

向用户报告 worktree 的绝对路径、分支、基线提交、主线治理文档提交、当前状态和下一步。
