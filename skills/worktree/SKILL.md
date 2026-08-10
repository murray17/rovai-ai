---
name: worktree
description: 为 ROVAI Camp 中的非 trivial 实现工作创建或复用隔离 Git worktree。开始代码、schema、migration、script、API、UI、runtime 或跨文件修改前使用；一个 durable Task 对应一个 worktree，并跨 AgentRun 复用。
---

# ROVAI Worktree

为实现工作准备一个可持续复用的 Git worktree，避免在主 checkout 中直接开发，也避免同一任务在不同 AgentRun 中重复创建分支和目录。

## 核心不变量

- **Worktree 属于 durable Task，不属于 Agent、Camp 或 AgentRun。**
- 同一 Task 后续产生的新 AgentRun 必须优先复用已有 worktree。
- 一个 Camp 可以有多个独立 Task，因此也可以有多个 worktree。
- 实现工作不直接修改主 checkout；主 checkout 主要用于同步、发现和管理 worktree。
- 仓库自己的 `AGENTS.md`、`CLAUDE.md`、README、分支命名和开发说明始终优先于本 Skill。
- 不执行隐式 stash、`reset --hard`、`clean -fd`、强制删分支或强制删 worktree。

## 何时使用

在以下工作开始前使用：

- 修改代码、API、schema、migration、脚本、构建配置或运行时行为；
- 修改 UI、桌面端、Gateway、Daemon 或 Core；
- 跨多个文件或可能与其他任务并行的改动；
- 需要持续多个 AgentRun 才能完成的实现任务。

以下情况通常不需要新建 worktree：

- 只读调查、代码搜索或方案讨论；
- 仓库规则允许的低风险纯文档修订；
- 当前工作目录已经是该 durable Task 的正确 worktree。

## 工作流

### 1. 确认仓库与任务身份

先定位仓库根目录：

```bash
git rev-parse --show-toplevel
```

读取仓库指令，至少检查存在的：

```text
AGENTS.md
CLAUDE.md
README.md
docs/README.md
```

确定本次 durable Task 的稳定身份，优先使用：

1. Task ID；
2. 已记录的分支名或 worktree 路径；
3. Task 标题生成的简短 slug。

不要把一次 AgentRun 的 ID 当作 worktree 身份。

### 2. 先查是否已有 worktree

```bash
git worktree list --porcelain
```

同时检查本地分支：

```bash
git branch --list
```

复用规则：

- Task 已记录 worktree 路径且仍有效：直接复用；
- 对应分支已在某个 worktree 中 checkout：复用那个目录；
- 对应分支存在但尚未 checkout：把它加入新的 worktree；
- 只有确认没有对应 worktree 和分支时，才创建新分支。

如果出现多个可能匹配的 worktree，不要猜。报告候选路径和分支，让上层任务状态先统一。

### 3. 选择分支名和目录

分支名优先遵循仓库约定。没有约定时使用：

```text
feat/<task-slug>
fix/<task-slug>
docs/<task-slug>
chore/<task-slug>
```

`task-slug` 使用小写 ASCII、数字和连字符；有 Task ID 时可加入简短 ID，避免同名冲突。

目录位置优先级：

1. 仓库文档指定的位置；
2. 主 checkout 的同级目录，例如 `<repo>-wt-<task-slug>`；
3. 如果运行环境无法访问同级目录，使用仓库内的 `.worktrees/<task-slug>`。

使用仓库内 `.worktrees/` 时，只加入本地 exclude，不修改项目 `.gitignore`：

```bash
GIT_COMMON_DIR=$(git rev-parse --git-common-dir)
mkdir -p "$GIT_COMMON_DIR/info"
grep -qxF '.worktrees/' "$GIT_COMMON_DIR/info/exclude" 2>/dev/null \
  || printf '%s\n' '.worktrees/' >> "$GIT_COMMON_DIR/info/exclude"
```

### 4. 确定基线

优先从远端默认分支创建：

```bash
BASE_REF=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
```

如果为空，依次检查：

```text
origin/main
origin/master
HEAD
```

远端可用时先获取默认分支的最新状态；获取失败时明确说明使用了本地 ref，不要假装已经同步。

### 5. 创建或复用

已有分支但未被其他 worktree 使用：

```bash
git worktree add "$WORKTREE_PATH" "$BRANCH"
```

创建新分支：

```bash
git worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_REF"
```

如果目标目录已经存在但不是已登记的 Git worktree，停止并报告；不要覆盖或删除该目录。

### 6. 切换到 worktree 工作

创建或复用后验证：

```bash
git -C "$WORKTREE_PATH" branch --show-current
git -C "$WORKTREE_PATH" status --short
```

此后把该绝对路径作为所有 Shell、文件读写和构建命令的 `workdir`。不要依赖一次 `cd` 会自动影响后续工具调用。

依赖安装和环境配置遵循仓库文档。默认不要复制：

- `.env` 或其他 secrets；
- 数据库、上传文件和 Runtime 状态；
- 构建缓存或用户目录；
- 其他 worktree 的未提交文件。

确实需要共享配置时，只复制仓库明确允许的模板或重新生成本地配置。

## ROVAI 仓库校验

在 `rovai-ai` 仓库中：

- 从根目录 `AGENTS.md` 和 `docs/README.md` 路由到相关开发文档；
- TypeScript、桌面端或 UI 改动使用适用的：

```bash
pnpm install
pnpm typecheck
pnpm test
```

- Rust 改动在迭代时优先运行受影响 crate 的定向测试；跨 crate、Core、Daemon、Gateway 或 Runtime 改动在交付前运行：

```bash
cargo test --workspace
```

- 跨 TypeScript 与 Rust 的改动运行两侧适用校验。
- 不要机械运行无关命令；校验范围应覆盖实际改动和受影响边界。

## 跨 AgentRun 交接

在结束当前 AgentRun 前，把以下信息写入 durable Task 状态或 Camp 交接消息：

```text
Task: <task id or title>
Worktree: <absolute path>
Branch: <branch>
Base: <base ref and commit>
Status: active | ready | merged | abandoned
Validation: <commands and results>
Next: <next concrete step>
```

后续 AgentRun 先读取这些信息并复用现有 worktree。不要因为启动了新 Run 就创建新的 `-2`、`-3` 分支或目录。

## 清理

一个 AgentRun 结束时**不要自动清理**。只有 Task 已合入或明确放弃时才处理。

先确认 worktree 干净：

```bash
git -C "$WORKTREE_PATH" status --porcelain
```

合入后可执行：

```bash
git -C "$PRIMARY_ROOT" worktree remove "$WORKTREE_PATH"
git -C "$PRIMARY_ROOT" branch -d "$BRANCH"
git -C "$PRIMARY_ROOT" worktree prune
```

如果分支未合入、存在未提交内容或清理意图不明确，保留现场并报告，不使用 `--force`。

## 完成标准

本 Skill 完成时应得到：

- 一个已复用或新建的隔离 worktree；
- 明确的绝对路径、分支和基线；
- 后续工具调用使用该 worktree 作为工作目录；
- durable Task 中记录了可供下一 AgentRun 继续工作的交接信息。
