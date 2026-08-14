# Search、Read 与最小写入

先分别查看所需 operation 的精确 help：

- `rovai memory search --help`
- `rovai memory read --help`
- `rovai memory write --help`

## 先读，再依赖

1. `[MEMORY_ENTRYPOINT]` 有相关 ID 或 Retrieval Key 时，只把它当发现入口。
2. 不确定对应哪条 Memory 时，用具体概念或 Retrieval Key 调用 search；`limit` 最大 6。
3. 搜索 snippet 只用于判断相关性，不是权威正文。
4. 对可能相关的 Memory 调用 read；每次最多读取 4 个 ID。
5. 按 cache state 处理：
   - `current`：使用返回的当前正文；
   - `revision_changed`：使用新正文与新 Revision ID，丢弃缓存表述；
   - `inactive`、`deleted`、`access_changed`、`unavailable`：停止使用，不复原或猜测旧正文。
6. revise 只允许选择本次 read 中同时返回正文与 Scope 身份的结果；把最新 `revisionId` 作为
   `baseRevisionId`，并原样复制 `scope`。Relationship 还必须原样复制 `counterpartyAgentId` 与
   `direction`。ID、Scope、counterparty 或 direction 有一项不能确定或不完全匹配时停止，不 revise。

## 只做一次最小 mutation

1. 先用一句话概括候选，不调用写 operation。
2. 选择最小 Scope、合法 Kind，以及仅在 Relationship add 时需要的 present counterparty 和 `directed`。
3. search 重叠内容，再 read 所有可能重叠的结果。
4. 只选一个结果：等价则 stop；同一理解需纠正则 revise；没有等价且确有长期价值则 add；不确定则 stop。
5. 用 `rovai memory write` 执行 add 或 revise。Hearth 也使用同一命令，不存在第二条 propose command。
6. 检查 closed outcome：
   - `effective`：`memoryId` 与 `revisionId` 对应正式且立即生效的 Memory；
   - `review_pending`：`reviewItemId` 只定位等待用户决定的 Hearth Review Item，不能声称已保存为 Memory；
   - 失败：遵循安全 recovery，不声称已写入，不猜测或泄露其他候选 ID/正文/keys。

不要通过连续 Revision 打磨细小措辞。revise 中的 Scope identity 只是不可变目标断言；命令只更新正文和
完整 Retrieval Key 集合，不能改变 Scope、Kind、counterparty 或 direction。

Companion add 示例：

```json
{
  "action": "add",
  "scope": "companion",
  "kind": "preference",
  "body": "实现方案应明确区分已经确认的决定、当前假设与仍待回答的问题。",
  "retrievalKeys": ["方案格式", "确认事项", "未决问题"]
}
```

Hearth add 使用相同 shape，把 `scope` 设为 `hearth`。Relationship revise 示例：

```json
{
  "action": "revise",
  "scope": "relationship",
  "counterpartyAgentId": "agent_3",
  "direction": "directed",
  "memoryId": "memory_123",
  "baseRevisionId": "revision_456",
  "body": "交接时同时提供测试命令、结果与对应提交。",
  "retrievalKeys": ["交接证据", "测试结果"]
}
```

Companion/Hearth revise 同样复制 read 的 `scope`，但不带 Relationship 两字段。
