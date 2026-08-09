---
document_type: adr
id: ADR-0118
title: v0.41 Local Data Clean Break and Managed Reset Boundary
status: accepted
date: 2026-08-05
decision_scope: version-scope
source_version: v0.41
supersedes: []
superseded_by: null
---

# ADR-0118: v0.41 Local Data Clean Break and Managed Reset Boundary

## Context

v0.41 的 Canonical Activity Projection、版本化分类和生命周期合同会改变本地持久化结构。
为旧版本数据库设计兼容迁移会扩大状态空间、保留不再可信的旧语义，并降低新合同的验证阈值。

## Decision

### 1. v0.41 不兼容 v0.40 及更早本地数据

v0.41 只接受带有当前 data contract、Projection schema 和必要 catalog/classifier marker 的
Rovai-owned app data。对 v0.40 及更早数据库不做迁移、回填、双读、旧字段兼容或隐式修复。

### 2. 不兼容时执行受管 Clean Reset

启动校验发现缺少 marker、未知 schema、无法验证的 Projection/Evidence 关系、损坏或不兼容
结构时，Core 在明确的 Rovai-owned app-data 根范围内清理并重新初始化 v0.41 store。Reset 必须
留下可诊断的原因和新 store 的 contract marker；不得静默继续读取部分旧数据。

“本地数据”在本 ADR 中不包括用户工作区、用户文件、外部 Runtime 配置或凭据、Native Runtime
Home、项目 `.codex`/Runtime 原生状态。经用户确认，受管 reset allowlist 只包括下表中的
Rovai-owned 路径；它是闭集，不得用 `--data-dir` 根目录递归删除来代替：

| 类别 | `data_dir` 下的受管目标 | 边界 |
| --- | --- | --- |
| SQLite store | `rovai.sqlite`、其 `-wal`/`-shm` sidecar，以及旧名 `lumen.sqlite` 的文件和 sidecar | `lumen.sqlite` 只允许作为不兼容残留清理，v0.41 不读取它 |
| Managed Blob | `managed-blobs/**` | 包括其 `tmp/**` staging 内容 |
| Camp attachment | `camp-attachments/**` | 包括 prepared/temporary attachment 内容 |
| Runtime projection | `runtime/mcp/**`、`runtime/opencode/**`、`runtime/copilot/**`、`runtime/kiro/**`、`runtime/qoder/**`、`runtime/codebuddy/**`、`runtime/qwen/**` | 只清理 Rovai 生成的 projection/config snapshot |
| Runtime private state | `runtime-private/**` | 只清理 Rovai 管理的 Claude/Antigravity/team 私有日志与状态 |
| 隔离 Codex Home | `codex-homes/**` | 仅限 Rovai 为 Camp/成员创建的隔离 Home |
| Quick Chat | `quick-chat/**` | 仅限受管 Quick Chat 工作树和其临时内容 |
| App-owned temporary artifacts | 由 v0.41 reset manifest 明确登记的 `data_dir` 内 staging/lock/temp 子路径 | 未登记的根级或外部临时路径不得删除 |

Core 还可以在进程生命周期清理自己创建的精确 Team Tool endpoint（当前形式为
`/tmp/rovai-team-<pid>/core.sock`），但这不是 app-data reset 的泛化授权；清理必须验证路径
前缀、PID/进程归属和 socket 类型，禁止扫描或递归删除 `/tmp`。

allowlist 外的 `data_dir` 内容既不读取也不删除；启动诊断必须记录不兼容原因、未处理条目和
新 store 的 contract marker。任何新增 Rovai-owned 路径都必须先更新 reset manifest、测试和
本 ADR/后续 ADR，不能借由“临时文件”类别隐式扩大范围。

### 3. v0.41 内部版本化仍然有效

本 Clean Break 不取消 v0.41 内部的 Evidence append-only、Canonical Projection version、
classifier replay 和显式历史重投影。它只拒绝跨版本本地数据兼容；新 store 建立后，v0.41
自己的历史和并行 Projection 必须继续遵守 ADR-0112 与 ADR-0116。

## Consequences

- Migration 和双表面兼容成本显著降低，v0.41 可以以干净 schema 验证；
- 用户可能丢失 Rovai-owned 的旧本地会话/证据，需要启动诊断明确告知；
- 实现必须有可测试的 contract marker、受管 reset 路径、备份/诊断策略和不触碰外部状态的断言；
- 任何希望保留旧数据的需求都必须另立决策，不能在实现中偷偷加入兼容分支。

## Rejected Alternatives

- 为 v0.40 或更早的 Canonical/Execution 数据提供隐式 migration/backfill；
- 同时读取 legacy 和 v0.41 表并按字段猜测优先级；
- 只删除部分无法解析的行而继续使用同一 store；
- 把用户工作区、Runtime credentials 或 Native Home 当作 reset 目标。

## References

- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md)
