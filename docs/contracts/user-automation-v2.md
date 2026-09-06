---
document_type: interface-contract
contract: user-automation
version: 2
authority: desktop-user-automation-transport-and-diagnostic-trial
status: accepted
source_version: v1.53
last_updated: 2026-09-07
---

# User Automation v2

## 1. 继承范围

v2 完整继承 [User Automation v1](user-automation-v1.md) 的本机 IPC、鉴权、封闭命令、幂等、
Diagnostic Trial、双 cursor、退出码、安全投影与私有 bundle 边界，只收敛 Workspace 创建和 Git
observation 的工作树扫描语义。

## 2. Workspace 创建与检查

`camps.create` 只重新执行 Core-owned 目录准入：绝对路径、存在性、规范化、可读目录、文件系统根、
应用私有数据和 Git metadata/bare repository 边界。创建命令不执行 Git 子进程，不采集 Git
observation，也不依赖 Renderer 或 CLI 之前返回的 inspection 才能安全提交。

`workspaces.inspect` 保留动态 Git capability、repository root、common dir、object format、HEAD、branch
和 observation time，用于目录选择展示与 Diagnostic Trial baseline。该读取不得执行 `git status`、扫描
tracked/untracked 文件或把工作区内容规模带入创建延迟。

## 3. Git observation 兼容语义

`GitObservation.dirty` 保持 `boolean | null` wire shape。v2 新 observation 固定返回 `null`，表示未采集，
不能用 `false` 表示 clean。历史 AgentRun 已保存的 `true | false` 原样读取，不迁移、不重写。

AgentRun 启动与终止仍冻结当时可读的 Git capability、HEAD 和 branch，供诊断还原执行版本背景；它们不
扫描工作树。`agentRuns.diagnostic.get` schema 保持 1，baseline/final 的 `dirty` 因而可以同时包含历史
boolean 与新 `null`。Trial 的 `workspace-baseline.json` 使用相同语义。

## 4. 文件变化边界

Git observation 不参与 AgentRun 文件变化归约。Files Changed Card 只使用 Runtime 在精确
`agentRunId + executionEpoch` 内明确报告并已落库的可靠终态 Evidence；移除工作树扫描不得增加 Git diff、
目录扫描或当前文件读取作为替代来源。

## 5. 验收

- Git 与非 Git 目录仍可创建 Camp，持久化规范化目录身份；创建路径不启动 Git 子进程。
- Git inspection 和 Run 起止 observation 仍返回 capability、HEAD、branch；新 `dirty` 为 `null`。
- 大量未跟踪文件不再增加创建、inspection 或 Run observation 的 Git 工作树扫描成本。
- 既有历史 boolean dirty 值可继续通过 AgentRun 与 Diagnostic 投影读取。
- Files Changed Card 的内容、顺序和来源不变。
