---
document_type: version-overview
version: v0.23
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-30
---

# Rovai-ai v0.23 普通目录工作区与动态 Git 能力

> 状态：实现完成
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.22 配置式 Camp 创建与延迟 Conversation](../v0.22/README.md)
>
> 跨版本决策：[ADR-0072](../../adr/0072-directory-workspace-and-dynamic-git-capability.md) ·
> [ADR-0071](../../adr/0071-configured-camp-creation-and-lazy-conversations.md) ·
> [ADR-0059](../../adr/0059-runtime-owned-resource-permissions.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.23 将 Camp 的持久工作区身份从 Git Repository Binding 收敛为安全 canonical
目录。普通目录、空目录、空 Git 仓库、正常仓库和 worktree 都可创建 Camp；Rovai-ai
不自动执行 `git init`。

Git 变为运行时动态能力。Core 在创建、AgentRun 开始、Git 专属动作前和 AgentRun
结束时探测当前状态。开始/结束 Observation 只作为 AgentRun 审计快照持久化，不建立
Repository Binding、Repository Scope 或 reconciliation。

## 已确认交付范围

- Camp 只持久化 `projectBindingKind: lobby | directory` 与 canonical `projectPath`；
- Core 统一执行目录存在性、类型、可读/可遍历、canonical、安全私有目录和 Git
  metadata 边界检查；
- 普通目录不是错误，Git 损坏或消失不影响普通文件工作和 Camp 历史；
- 空 Git 仓库为有效 `git_valid`，`headCommit = null`；
- AgentRun 保存 starting/ending Git Observation；
- Project Read Side 只按 `directory:<canonical-project-path>` 分组；
- 目录选择器与工作区显示普通目录、Git 仓库、空 Git 仓库、Git 状态异常和工作区
  不可用；
- 使用不兼容 Migration 移除旧 Repository identity 字段并直接重置未发布协作数据。

## 明确不在范围

- Repository Binding、Repository Scope 或仓库 reconciliation；
- Camp 私有 Git ref、跨 Camp 仓库聚合或持久 Camp Git 状态；
- 自动 `git init`；
- Home、Documents、Desktop、`.ssh` 等普通个人目录通用黑名单；
- Project 数据表或可独立管理的 Project 生命周期。

## 完成定义

- 普通目录、空 Git 仓库、正常仓库、worktree 和损坏 Git metadata 均有边界测试；
- Renderer 提示不把 `not_git` 当作错误；
- Run 启动前目录失效时不启动 Runtime，Camp 本身仍可读取；
- starting Observation 在恢复中保持不变，ending Observation 在终态持久化；
- Navigation、Camp Snapshot、IPC 和 TypeScript 契约不存在 Repository Binding 依赖；
- Migration、Rust 测试、Renderer 测试、typecheck、clippy 与 desktop build 全部通过。

当前完成进度只以 [implementation-plan.md](implementation-plan.md) 中有证据的勾选项为
准；ADR `accepted` 不表示实现已经完成。
