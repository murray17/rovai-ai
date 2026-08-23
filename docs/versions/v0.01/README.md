---
document_type: version-overview
version: v0.01
lifecycle: historical
authority: historical-context
last_updated: 2026-08-23
---

# Lumen AI v0.01 版本架构记录

> 生命周期：历史快照，不代表当前架构约束或实施状态。当前读取规则见[文档导航](../../README.md)，跨版本规范见[有效 ADR](../../adr/README.md)。
>
> 状态：当前实现基线
>
> 基线提交：`65d2a04` (`feat: streamline self-hosting MVP workflow`)
>
> 更新日期：2026-07-18

## 版本目标

v0.01 验证一条本地、可审计、可恢复的单 Agent 闭环：用户通过 macOS 桌面应用与沐瓦对话，或显式打开 Git 项目，让本机 Codex 在指定上下文中执行任务，并在 UI 中查看过程、审批、文件变化、Diff 和恢复状态。

这个版本优先证明：

- Renderer 不需要获得 Node、Shell、文件系统或 Git 权限；
- 产品任务、Codex Thread、Turn 和 Worker Process 可以独立管理；
- SQLite 中的持久状态能够跨 Electron/Core/Codex 重启保留；
- 用户可以看见高风险操作并作出明确审批；
- 项目任务可以直接在用户选择的项目目录完成真实开发工作。

## 文档导航

- [architecture.md](architecture.md)：系统结构、边界、主要流程、风险和演进约束；
- [implementation-status.md](implementation-status.md)：当前代码已经实现的能力清单；
- [Codex app-server 0.144.5 Schema 快照](schemas/codex-app-server/0.144.5/codex_app_server_protocol.schemas.json)：v0.01 固定上游实验协议参考；
- [开发者指南](../../development/README.md)：开发、测试、Smoke Test 和 macOS 构建命令；
- [../../ui/README.md](../../ui/README.md)：Renderer 视觉与交互规范。

## 系统摘要

```text
React Renderer (sandboxed)
        │ typed preload API
        ▼
Electron Main ── supervises ──> Rust Core
        │                         │
        │                         ├── SQLite / state / audit
        │                         ├── Git inspection and diff
        │                         └── Codex app-server adapter
        │                                      │
        └── native dialogs / Finder            ▼
                                      Lobby or selected Git project
```

## 已锁定架构决策

| 决策 | v0.01 选择 |
| --- | --- |
| 桌面容器 | Electron，目标 macOS 14+ Apple Silicon |
| UI | React + TypeScript + Radix + 原生 CSS |
| 业务核心 | 随 App 打包的 Rust 子进程 |
| 持久化 | bundled SQLite，WAL + Foreign Keys + Migration |
| Agent Runtime | 本机已安装并登录的 Codex CLI |
| Runtime 协议 | `codex app-server` over stdio JSON-RPC/JSONL |
| Codex 基线 | `codex-cli 0.144.5`，不做静默兼容 |
| 项目执行目录 | 直接使用用户选择的 Git 项目根目录，不自动创建 Worktree |
| 并发写入 | 同一项目上下文最多一个活跃任务 |
| 恢复 | Resume Native Thread；失败时增加 Session Generation |
| 高风险操作 | `on-request` 审批，未知 Server Request 失败关闭 |

## v0.01 明确边界

- 只有沐瓦启用真实 Runtime；其他伙伴只保存身份和职责。
- 默认大厅不绑定 Git 项目，不主动读取用户项目目录。
- Lumen 不自动切换分支、创建 Worktree、Commit、Push、创建 PR、Reset 或丢弃修改。
- 项目任务直接修改当前项目，Lumen 不提供文件副本或完整 OS 隔离。
- 只支持 Codex Provider；不包含多 Agent 编排、长期记忆、云同步、多用户或远程执行。
- 打包后的 App 不依赖系统 Node.js、pnpm 或 Rust，但依赖本机 Git 和兼容的 Codex CLI。

## 完成定义

版本文档只能把满足以下条件的能力标记为已实现：

1. 存在实际产品调用路径，而不只是 Schema、数据表或占位 UI；
2. 至少有单测、Smoke Test 或可重复的人工验收证据；
3. 架构边界、安全语义和失败路径与代码一致；
4. 对外表现与 [implementation-status.md](implementation-status.md) 描述一致。
