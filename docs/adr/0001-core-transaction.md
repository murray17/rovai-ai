---
document_type: adr
id: ADR-0001
title: "Core Transaction"
status: accepted
date: 2026-07-20
decision_scope: cross-version
source_version: v0.02
supersedes: []
superseded_by: null
---

# ADR-0001: Core Transaction

## Context

v0.01 的数据库方法可以直接提交状态，`event_log` 仅按 Task 排序，且没有统一的命令身份、请求摘要、永久结果或 Runtime fencing 入口。v0.02 的多 Agent、后台扫描器和恢复流程会从 UI、Agent、Runtime 与 System 多个入口并发重试；如果每个 Service 自行实现幂等和事务，重复状态、重复副作用资格和恢复歧义将不可避免。

## Decision

Rust Core 建立唯一的静态强类型 `DomainCommandGateway`。任何创建、修改或终结权威领域事实的操作都必须通过编译期封闭的命令类型和命令专用 Handler。

公共信封至少包含：

```text
commandId
actor（user / agent+sourceAgentRunId / system component）
命令特定业务参数
命令特定 expectedVersion
可选 reason / evidence references
Agent 命令的 executionEpoch fencing 上下文
```

处理顺序固定为：

```text
认证与规范化
→ 计算 versioned requestDigest
→ 查询既有 command.result
→ 可选只读 Preflight
→ BEGIN IMMEDIATE
→ 再次查询 command.result
→ 校验 epoch / capability / version / 领域门禁
→ 修改权威对象
→ 追加普通事件与唯一 command.result
→ COMMIT
→ best-effort typed Wake
```

相同 `commandId + commandType + requestDigest` 永久返回第一次结果；同一 `commandId` 携带不同语义请求返回 `idempotency_conflict`。幂等命中不重复写事件、不产生 Wake，也不重新执行副作用。

`event_log` 同时保存普通审计事件和特殊 `command.result`，但不是业务状态真源、Event Sourcing 存储、Outbox 或 Worker 队列。全局自增序列作为增量订阅游标；旧的 Task 维度序列只保留兼容读取所需语义。

Repository 只在调用方 Unit of Work 中读写，不自行提交事务。Migration 只改变 Schema/数据，不执行 Runtime、Git、网络或文件系统补偿。

## Schema and migration

第一阶段采用兼容迁移：

- 扩展/重建 `event_log`，允许无 legacy Task 的领域事件，并增加全局序列、Actor、实体引用、命令类型、请求摘要版本、结果码与结果 payload。
- 对非空 `command_id` 建立部分唯一索引，只允许 `event_type = 'command.result'` 持有命令结果字段。
- 保留 v0.01 可读取的 `task_id / turn_id / sequence / native_method / payload_json`，直到 Renderer 完成迁移。
- 在 `schema_migration` 记录新版本；迁移必须可重复打开数据库且不复制历史事件。
- 不在本阶段删除 legacy Project、Task、RuntimeSession、Approval 或 Artifact。

## Failure semantics

- 事务回滚：没有对象变化、事件、结果或 Wake。
- 提交后 Wake 丢失：类型化扫描器从对象状态恢复。
- 进程在响应前崩溃：客户端以同一 commandId 重试并获得原结果。
- Agent 的旧 executionEpoch：不存在历史结果时拒绝；历史完全匹配的幂等查询仍可返回原结果，但必须通过当前读取权限。
- 外部 Preflight 变化：写事务内必须重新验证其冻结摘要或版本。

## Implementation boundary

- `db.rs` 继续拥有 SQLite 连接与 Migration，但新增明确 Unit of Work/transaction API。
- 强类型命令、Actor、Digest 和结果信封放在独立 Core 模块，不能以任意 JSON Command Bus 实现。
- v0.01 现有写方法可在迁移期作为 legacy facade，但所有新增 v0.02 写入口从第一天起使用 Gateway。
- 使用版本化 canonical JSON 计算 Digest；秘密只能以稳定引用或安全摘要参与，不能进入日志明文。

## Acceptance

- 同一命令重复 100 次只产生一次对象变化和一个 `command.result`。
- 相同 commandId、不同 payload 返回稳定冲突。
- 在数据库提交后、Wake 前模拟崩溃，扫描器仍能发现工作。
- Migration 从 v0.01 数据库升级两次结果一致，旧事件仍可读取。
- 测试证明事务内不会调用 Runtime、Git、网络或文件系统执行器。

## Consequences

- 所有新增权威写入都必须经过静态强类型命令入口；调用方需要提供稳定 `commandId`、命令特定版本前置条件以及 Agent fencing 上下文。
- 幂等结果、对象变化和审计事件共享一个事务边界，使重试与崩溃恢复可解释，但也要求为每种领域意图维护显式命令和结果 Schema。
- Runtime、Git、网络和文件系统 I/O 必须与数据库事务分离；提交后的工作通过持久资格和扫描恢复，而不是依赖进程内回调可靠到达。
- Migration 与 legacy facade 必须保持单一权威写入方向，迁移期会承担额外的兼容与测试成本。

## Rejected Alternatives

- 通用弱类型 Command Bus。
- 独立 `command_record` 真源。
- 依赖进程内 Mutex 提供幂等正确性。
- 通过重放 `event_log` 恢复对象或触发副作用。

## References

- [v0.02 核心组件与实施包](../versions/v0.02/core-components.md)
- [v0.02 领域模型](../versions/v0.02/domain-model.md)
- [v0.02 实施与验收清单](../versions/v0.02/implementation-and-acceptance.md)
