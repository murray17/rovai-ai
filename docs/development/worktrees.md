---
document_type: development-guide
authority: local-worktree-lifecycle
last_updated: 2026-08-15
---

# Git Worktree 生命周期与清理

本文规定 Rovai-ai 开发用 Git worktree 的创建、复用、交接和收口纪律。它适用于人类开发者和
AI Agent。具体创建步骤继续以仓库内 [`worktree` Skill](../../skills/worktree/SKILL.md) 为准；
本文补充本仓库构建体积较大时必须遵守的磁盘和生命周期边界。

## 为什么必须及时收口

Git worktree 共享 Git object database，但不共享工作目录里的生成物。每个执行过开发、测试或
打包的 worktree 都可能独立拥有：

| 目录 | 主要内容 |
| --- | --- |
| `target/` | Rust Debug、Test、Release、依赖与 incremental 产物 |
| `node_modules/` | pnpm 依赖目录与链接树 |
| `resources/bin/` | 开发 App 使用的 Core 与 CLI |
| `out/` | Electron Vite 构建结果 |
| `dist/` | `.app` 与 DMG 打包结果 |

一次 Rust workspace 构建就可能产生数 GiB；多个已完成 worktree 长期共存时，磁盘占用会按任务
累积。`du` 显示的是目录视角，APFS clone、hard link 和可回收空间会影响实际值，最终空闲空间以
`df` 为准。

因此，**Task 已合入或明确放弃后，worktree 清理属于同一次任务收口，不是以后再做的可选维护。**
一次 AgentRun 结束并不代表 Task 完成；仍在实现、等待 review、等待 CI 或准备继续修订的 Task
必须保留原 worktree。

## 生命周期规则

| Task 状态 | Worktree 处理 |
| --- | --- |
| `active` | 保留并在后续 AgentRun 复用；不得因暂时空闲另建 `-2`、`-3` 目录 |
| `ready` / review 或 CI 中 | 保留；代码写完但尚未合入不算完成 |
| 已合入目标分支 | 在同一次完成交接中验证并删除 worktree，再安全删除已合入本地分支 |
| 明确放弃且 worktree 干净 | 立即删除 worktree 以释放生成物；未合入分支默认保留，除非另有明确删除决定 |
| 有未提交或未跟踪内容 | 不自动删除；报告文件、分支、体积和下一步，由用户明确决定如何保存或丢弃 |

工作目录不是长期成果或证据。需要在 worktree 删除后继续保留的代码，必须进入可达 Commit，
并按任务流程合入或推送；普通 Patch、聊天摘要和“目录还在”都不能替代这一点。

## 创建与复用

创建前先查已有 worktree 和分支：

```bash
git worktree list --porcelain
git branch --list
```

一个 durable Task 只对应一个 worktree，并跨 AgentRun 复用。创建后应在 Task 交接中记录：

```text
Task: <task id or title>
Worktree: <absolute path>
Branch: <branch>
Base: <base ref and commit>
Status: active | ready | merged | abandoned
Validation: <commands and results>
Next: <next concrete step>
```

默认让每个 worktree 自己拥有 `target/`。不要静默创建指向其他 worktree 的 `target` symlink，
也不要把全局 `CARGO_TARGET_DIR` 指向另一个活跃任务：这会引入 Cargo 锁竞争、跨分支旧指纹和
清理所有权不清。若开发者显式选择共享缓存，交接中必须记录真实目录，并且不能把“删除 worktree”
误报为已经释放共享缓存。

## 活跃期间的磁盘管理

活跃 worktree 的增量缓存是在用磁盘换编译速度，不应按天清理，也不应在 `pnpm dev` 或测试脚本
里自动运行 `cargo clean`。磁盘异常时先检查：

```bash
du -sh "$WORKTREE_PATH"
du -sh "$WORKTREE_PATH/target"
du -sh "$WORKTREE_PATH/target/debug/deps"
du -sh "$WORKTREE_PATH/target/debug/incremental"
```

选择性清理规则见[常见问题排查](troubleshooting.md#target-占用异常增长或磁盘不足)。如果 Task
已经满足收口条件，应删除整个 worktree，而不是逐个清理 `target/`、`node_modules/`、`out/`
和 `dist/` 后继续保留空壳目录。

## 任务收口与安全清理

### 1. 确认精确目标

从主 checkout 记录绝对路径、分支和登记状态：

```bash
git -C "$PRIMARY_ROOT" worktree list --porcelain
git -C "$WORKTREE_PATH" branch --show-current
git -C "$WORKTREE_PATH" status --short
du -sh "$WORKTREE_PATH"
```

禁止用模糊目录名、glob、`~` 或未解析变量确定删除范围。不要把主 checkout 当作待清理 worktree。

### 2. 确认没有活跃进程

停止从目标 worktree 启动的 Cargo、Rust 测试、`pnpm dev`、Electron、打包和验收进程。若状态不明，
先只读检查进程当前目录；存在占用时先完成或正常停止进程，不边构建边删除。

### 3. 确认内容已安全收口

已合入 Task 需要同时满足：

```bash
git -C "$PRIMARY_ROOT" fetch origin main
git -C "$WORKTREE_PATH" status --porcelain
git -C "$PRIMARY_ROOT" merge-base --is-ancestor "$BRANCH" origin/main
```

后两条成功时都不输出内容并以状态码 `0` 结束。若目标不是 `origin/main`，使用任务实际目标分支。
发现未提交、未跟踪、未合入或未推送内容时停止清理并报告，不能仅凭 Task 标题或“看起来做完了”
推断内容已保存。

明确放弃的 Task 仍须先检查 `status --porcelain`。普通自动清理只处理干净 worktree；丢弃未提交
内容或强删未合入分支是独立的破坏性决定，不属于默认完成流程。

### 4. 使用 Git 正常移除

已合入且干净时：

```bash
git -C "$PRIMARY_ROOT" worktree remove "$WORKTREE_PATH"
git -C "$PRIMARY_ROOT" branch -d "$BRANCH"
git -C "$PRIMARY_ROOT" worktree prune
```

明确放弃但仍需保留未合入分支时，只执行 `worktree remove` 和 `worktree prune`。分支本身占用很小，
保留它不会继续保留 `target/` 等工作目录生成物。

日常收口禁止用 `rm -rf`、`git worktree remove --force` 或 `git branch -D` 绕过检查。只有用户在
看到精确路径、分支和未保存内容后，另行明确授权永久丢弃时，才能进入破坏性删除流程。

### 5. 验证并报告

```bash
git -C "$PRIMARY_ROOT" worktree list --porcelain
git -C "$PRIMARY_ROOT" branch --list "$BRANCH"
df -h "$PRIMARY_ROOT"
```

完成消息必须说明：

- 删除的 worktree 绝对路径和分支；
- 删除依据是“已合入”还是“明确放弃”；
- 是否仍保留本地或远端分支；
- 是否丢弃了任何未提交内容；
- 清理后的剩余 worktree 和磁盘空间。

## 定期审计是兜底，不是主要流程

任务收口时及时删除是主要机制。磁盘巡检只用于发现遗漏：

```bash
git worktree list --porcelain
```

对每个非主 worktree 分别检查 Task 状态、Git 状态、分支合入情况、进程占用和目录体积。不能仅凭
创建时间、目录大小或分支落后提交数批量删除；无法确认归属时保留并报告候选清单。
