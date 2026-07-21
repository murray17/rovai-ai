# Lumen Architecture Decision Records

本目录保存进入版本控制、直接约束实现的各版本 ADR。ADR 的接受状态与代码实施状态分开记录；实际完成范围必须由代码、迁移和测试共同证明。

| ADR | 实施包 | 决策状态 | 当前代码状态 |
|---|---|---|---|
| [0001](0001-core-transaction.md) | IP-01 Core Transaction | Accepted | 基础已实现 |
| [0002](0002-collaboration.md) | IP-02 Collaboration | Accepted | 领域与持久化基础已实现 |
| [0003](0003-execution-runtime.md) | IP-03 Execution Runtime | Accepted | Scheduler、共享 Host、多 Thread 分流与 Fencing 已实现；运行控制待补齐 |
| [0004](0004-action-safety.md) | IP-04 Action & Safety | Accepted | Codex Server Request、Action/Approval 与恢复安全门已实现；破坏性验收待补齐 |
| [0005](0005-evidence-read-side.md) | IP-05 Evidence & Read Side | Accepted | Evidence、快照订阅与 Renderer 控制面基础已实现 |
| [0006](0006-multi-runtime-adapter-boundary.md) | v0.03 Multi-Runtime Adapter | Accepted | 通用边界、Codex CLI Adapter、成员与本机 Runtime 管理 UI 已实现；其余 Adapter 待实施 |
| [0007](0007-portable-conversation-handoff.md) | v0.03 Conversation Handoff | Accepted | 复合 Native Binding 与同 Adapter 惰性交接已实现；跨 Adapter 交接待实施 |

## 实施检查点（2026-07-21）

当前代码已经具备五个实施包的可测试基础，但这不等于 v0.02 发布完成：

- SQLite migration、强类型命令幂等、Camp/Conversation/Task/CampTurn/AgentRun/Inbox、Action/Approval、Managed Blob、稳定 Evidence、快照与增量订阅均已有实现和领域测试。
- Renderer 能从同一 SQLite 快照展示 Camp 成员、Agent 泳道、Task、Approval、规范化动作参数和未收敛 Action；它不通过事件重放维护第二套业务状态。
- 现有 Project/Task API 在同一事务中物化兼容 Camp 数据，因此运行期间新打开的项目无需重启即可进入 v0.02 读模型。
- 新 Camp 产品链已经通过真实 Codex 单 Agent、双 Agent 和动作审批 Smoke：多个 AgentRun 共用一个默认 Host，但分别拥有 Conversation、Native Thread、Native Turn 与 Epoch；Server Request 先进入持久 Action/Approval，再按精确动作授权。
- 当前主要缺口是执行型 Inbox、continuation、取消/重试以及 Codex Host、Rust Core、Electron 三类故障的完整产品验收；完成这些之前不得把 v0.02 标记为发布完成。

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
