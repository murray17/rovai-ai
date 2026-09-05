---
document_type: contract
contract: runtime-file-change-observation
version: v3
status: accepted
source_version: v1.52
last_updated: 2026-09-06
---

# Runtime File Change Observation v3

v3 完整继承 [v2](runtime-file-change-observation-v2.md) 的文件变化三层模型、managed output 排除、Diff、
AgentRun 汇总与读取授权。本版把单文件操作投影升级为 typed read/write，并以 `activity-v3` 让可靠阅读成为
`file / file.read`。阅读是过程事实，不进入 AgentRun `Files Changed`。

## Runtime file operation schema 2

新 Evidence 中 available 投影为：

```json
{
  "runtimeFileOperation": {
    "schemaVersion": 2,
    "source": "runtime_reported",
    "status": "available",
    "operationKind": "read | write",
    "path": "normalized display path",
    "sourceMetadata": {
      "adapterKind": "...",
      "observedRuntimeVersion": "...",
      "sourceEventKind": "..."
    }
  }
}
```

`operationKind` 只允许 `read | write`。路径继续按 execution root 纯词法规范化，并继续执行 v2 的精确
`ROVAI_RUN_TMP` 排除。来源、种类、路径或 execution root 不满足条件时写 schema 2 unavailable 与稳定
`safeReasonCode`，不得保留可展示 path。

## 来源准入

只有成功终态或 Codex 自包含的 started/completed 结构化 read 可以产生候选：

| Runtime family | read | write |
| --- | --- | --- |
| ACP v1 adapters | effective native kind 精确为 `read`，同 ToolCall 标准 `locations[].path` 唯一 | effective native kind 精确为 `edit | write`；路径沿用 v2 已准入的唯一标准 location 与保守写入兼容来源 |
| Codex app-server | `commandExecution.commandActions` 非空、每项均为 `type=read`，且所有项只有一个唯一非空 path | 继续由结构化 `fileChange`／Diff 路径表示，不从 Shell command 生成 write operation |
| Claude stream-json | 完整 `tool_use(name=Read, input.file_path)` 与 matching 非错误 `tool_result` | 完整 `Edit | Write` 与 matching 非错误 `tool_result` |
| Pi JSONL RPC v1 | 同一 `toolCallId` 的 start/update 中 toolName 精确为 `read`、`args.path` 非空，并收到非错误 `tool_execution_end` | 同一关联中 toolName 精确为 `write | edit`、`args.path` 非空，并收到非错误 `tool_execution_end` |

Codex 不解析 `cat`、`head`、`tail`、`sed` 等命令文本。它们只有在 app-server 同时报告满足上表的
`commandActions.read` 时才成为阅读；混合 action、多路径、空路径、失败 shape 或没有 actions 时保持 Shell。
ACP/Claude/Pi 也不从 title、output、文件内容或当前磁盘猜操作。

## Canonical 与读取兼容

Migration 141 原子地把 data contract 标记切到 `v1.52 / projection schema 92 / activity-v3`，不重写 Evidence
或既有 Canonical rows。operation 首次建立的 classifier 继续冻结：在切换前已经以 v1/v2 建立的活动用原版本
结算；切换后的新活动使用 v3。Read Side 按 v3、v2、v1 的确定性优先级读取。

v3 对 available read 强制投影为 `file / file.read`；available write 和 available Diff 继续投影为
`file / file.write`。schema 1 历史 file operation 继续只按旧 write/changeKind 语义读取。AgentRun file-change
projector 显式排除 schema 2 read；失败、取消、拒绝或 unavailable operation 仍不得进入文件变化卡片。

## 验收

- 所有 ACP adapter 共享同一 terminal read/write admission，并覆盖 sparse update、冲突 kind、多路径和失败终态；
- Codex 的 cat/head/tail/sed 在唯一 structured read 时映射为阅读，复合命令、多文件与纯命令前缀保持 Shell；
- Claude Read/Write/Edit 与 Pi read/write/edit 只在 matching 成功终态发布 typed operation；Pi 结束事件省略参数时只复用同一 `toolCallId` 的 start/update 参数；
- activity-v3 的 read 在 live 与重启历史回读中一致，且从不出现在 `Files Changed`；
- migration 141 原子更新 marker 与 receipt，失败回滚，v1/v2 in-flight operation 不换语义。

## References

- [Runtime File Change Observation v2](runtime-file-change-observation-v2.md)
- [Runtime File Change Observation 架构](../architecture/runtime-file-change-observation.md)
- [Runtime Activity Registry](../runtime-activity/registry.md)
- [Run Process Detail Surface v31](run-process-detail-surface-v31.md)
