# Lumen v0.02 Architecture Decision Records

本目录保存进入版本控制、直接约束实现的 v0.02 ADR。它们描述目标边界，不代表功能已经实现；实际完成状态必须由代码、迁移和测试共同证明。

| ADR | 实施包 | 状态 |
|---|---|---|
| [0001](0001-core-transaction.md) | IP-01 Core Transaction | Accepted |
| [0002](0002-collaboration.md) | IP-02 Collaboration | Accepted |
| [0003](0003-execution-runtime.md) | IP-03 Execution Runtime | Accepted |
| [0004](0004-action-safety.md) | IP-04 Action & Safety | Accepted |
| [0005](0005-evidence-read-side.md) | IP-05 Evidence & Read Side | Accepted |

## 共同约束

- Rust Core 是唯一业务写入和系统能力边界；Renderer 与 Electron Main 不直接修改领域状态。
- SQLite 权威对象是恢复真源；`event_log` 用于审计和永久命令结果，不用于事件溯源或副作用重放。
- 外部 I/O 不得发生在 SQLite 事务中；事务后的执行资格必须能从权威对象状态重新发现。
- Agent 自述、自然语言 Review 和 Runtime 回调都不能绕过强类型命令与 fencing 改变权威状态。
- v0.02 迁移优先采用可验证的增量/重建步骤，旧表在确认数据迁移前不得静默删除。
- 每份 ADR 对应一个可独立验证的实施边界；实现提交必须包含迁移测试、领域测试或端到端验证。

## 实施顺序

1. ADR-0001：事务、命令幂等和迁移基础。
2. ADR-0002：Camp、Conversation、Task、CampTurn、AgentRun 与 Inbox。
3. ADR-0004 与 ADR-0003：先建立动作安全事实，再接入多 Thread Runtime 与恢复。
4. ADR-0005：证据、Blob、查询快照、增量订阅和 Renderer。

RT-02（同一 AgentRun 恢复时的输入物化精度）仍是延期问题。当前实现只能依赖冻结水位和稳定引用，不得宣称具有逐字节 Prompt 可重现性。
