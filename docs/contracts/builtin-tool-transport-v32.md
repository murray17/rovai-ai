---
document_type: protocol-contract
contract: builtin-tool-transport-v32
authority: builtin-tool-transport
status: accepted
version: 32
last_updated: 2026-09-23
---

# Built-in Tool Transport v32

继承 [v31](builtin-tool-transport-v31.md) 的 operation 集合、IPC 2、Envelope 1、receipt 1、
Core Router、命令 ID 幂等与完整 canonical result 运输。Contract/CLI version 为 32，Agent Output
Projection wire version 为 5，Runtime capability 为 `builtin_cli.transport.v32`。

Task 输入与结果采用 [Durable Task v5](durable-task-v5.md)。`team.update_task` 和
`rovai task update` 不接受 `expectedVersion` / `--expected-version`，CLI 不自动读取或填写 Task
版本。`team.create_task`、`team.get_task`、`team.update_task`、`team.list_tasks` 的 Agent
结果统一省略 Task `version` 与 `availableActions`；canonical/UI 权限提示可保留，调用时仍由 Core
重新校验。Task 旧输入由闭合 schema 拒绝，`task.version_conflict` 不再属于 Task 恢复目录。

`rovai task --help` 的 get 项为 `Read task details.`；精确 update help 只列业务字段。
其他 operation 的独立版本规则保持。Bootstrap v4、公开 ContextManifest 28 和非 batch 26 随模型
投影变更轮换，Session Charter revision 12 的正文不变。旧冻结 CLI 运行不跨版本转换或重播。
