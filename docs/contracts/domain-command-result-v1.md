---
document_type: protocol-contract
contract: domain-command-result-v1
authority: command-result-persistence-replay-and-event-projection
status: accepted
version: 1
last_updated: 2026-09-07
---

# Domain Command Result v1 Contract

本合同规定 Core Domain Command 的持久结果、幂等回放和 `command.result` 事件投影。存储编码是 Core
内部实现；对外事件、直接命令响应与回放结果继续使用完整结果值。

## 1. 命令结果与事务

Core 使用 `command_id + command_type + request_digest_version + request_digest` 判断重放。相同身份和相同
语义请求返回第一次已提交的结果，不再次执行 Handler、业务写入或事件写入；相同 ID 对应不同语义请求
稳定返回幂等冲突。`applied | accepted | rejected` 都是已提交的业务结果，Handler 执行错误则回滚业务写入
与回执，不能伪造成 `rejected`。

业务变化、领域事件与唯一 `command.result` 在原有同一 SQLite 事务提交。持久回放必须保留第一次提交的
完整结果、状态、code、结果实体和 `recorded_at`，不得查询当前业务对象重建旧结果。

## 2. 内部存储编码

新写入的 `command.result` 以专用列作为完整回执权威：

| 专用列 | 含义 |
| --- | --- |
| `command_type` | 原始命令类型 |
| `result_status` | `applied | accepted | rejected` |
| `result_code` | 原始结果 code |
| `result_payload_json` | 唯一完整结果正文，可为任意合法 JSON 值，包括 JSON `null` |
| `result_entity_type` + `result_entity_id` | 同时为空或同时存在的结果实体引用 |

同一行的 `payload_json` 固定为内部标记：

```json
{"_rovaiStorage":"command-result-columns-v1"}
```

标记不是第二份结果、摘要或对外 payload。写入路径不得先构造、克隆或序列化完整事件正文再丢弃。
除 `command.result` 外的事件继续按原方式在 `payload_json` 保存和读取完整 payload。

## 3. 事件读取合同

`events.subscribe` 与完整 Snapshot 对 `command.result` 继续返回原公开 shape：

```json
{
  "commandType": "…",
  "status": "applied",
  "code": "…",
  "result": {},
  "resultEntity": null
}
```

`result` 必须是第一次提交时的完整 JSON 值；`resultEntity` 必须为 `null` 或完整引用。事件的 event ID、
global sequence、Camp、Actor、实体、执行 epoch、时间戳、排序、过滤、分页、游标和 reset 语义不变。
`EVENT_BATCH_SCHEMA_VERSION` 保持 9，因为 wire shape 没有变化。

Read Side 在一次批量 SELECT 中同时取得事件与专用列，再按以下规则投影，不得逐行回查回执：

- 非 `command.result`：直接解析原 `payload_json`；
- 不含内部标记的历史 `command.result`：原样解析并返回历史 `payload_json`，不以专用列宽松修复；
- 只含已知 v1 标记的新记录：严格校验专用列并还原上述公开 payload；
- 标记未知、标记对象含额外字段、必需列缺失、状态非法、结果 JSON 损坏或实体引用不完整：返回可定位
  的读取错误，不跳过、不填默认值、不泄漏内部标记或完整结果正文。

合法 SQL `NULL` 与 `result_payload_json = 'null'` 不得混淆。历史 payload 的额外字段属于历史值，旧格式
分支原样保留。

## 4. 升级、历史与回退

Migration 144 仅从精确 `v1.53/schema 94/activity-v3` 来源原子增加 receipt 并发布
`v1.53/schema 95/activity-v3`。它不改写、删除或规范化任何 `event_log` 历史行；升级后旧格式与新格式
可混读，新写入立即停止重复正文。

具备本合同双读能力的 schema 95 Core 是直接回退基线。若必须回退到只会直接返回 `payload_json` 的旧
Core，必须先停止新写入，并在隔离验证后的显式流程中把所有已知标记行反向物化为旧公开 payload；确认
不存在标记行后才能回退 authority marker。只恢复旧写入逻辑不足以兼容已经提交的新格式行。

历史去重是独立、显式授权的治理任务，不属于启动迁移或普通读取。本合同不改变回执保留期限、请求摘要、
事件数量、Renderer 状态模型、数据库压缩或其他事件架构。

## References

- [当前基础架构不变量](../architecture/foundational-invariants.md#core-command-transaction)
- [Availability-first Runtime](../architecture/availability-first-runtime.md#migration-switch)
- [V1.53-D06](../versions/v1.53/decisions.md#v1-53-d06)
