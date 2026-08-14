# View、广泛回忆与最小写入

先分别查看所需 operation 的精确 help：

- `rovai memory view --help`
- `rovai memory search --help`
- `rovai memory read --help`
- `rovai memory write --help`

## 在线捕获：完整 View 后再决定

1. 先把候选压缩成一个原子理解，并选择一个精确 Scope；此时不调用 write。
2. Hearth 调用 application-global Hearth View；Companion 调用当前 Agent 自己的 Companion View；
   Relationship 必须指定一个当前 Camp 在场 counterparty，并读取该 exact unordered pair 对当前 Agent 的
   complete applicable set。
3. 成功结果必须同时满足 `complete: true`、`itemCount == items.length`，并把 `totalBodyBytes` 当作完整
   集合的正文计量。View 失败、不是 complete 或结构不一致时停止，不 add、不 revise。
4. 检查全部 items：等价则 stop；同一不可分割理解需要纠正且 `agentCanRevise: true` 时 revise；没有等价
   且确有长期价值时 add；不确定则 stop。
5. Relationship View 只包含 `当前 Agent -> counterparty` 的 directed 与该 pair 的 mutual，不包含反向
   directed。`agentCanRevise: false` 的 mutual 只能帮助查重和理解，不能用于 Agent revise。
6. revise 将选中 item 的 `target` 对象逐字段原样复制；不要重组 Memory ID、Revision ID、Scope、
   counterparty 或 direction。Core 仍会重新校验权限和 Revision CAS。

View 与后续 write 不是一个跨调用事务。并发 revise 由 `target.revisionId` 的 CAS 保护；并发语义重复 add
只能 best effort 避免。因此 View 后立即做一次决定，不在两次调用之间加入无关工作。

## 广泛回忆：Search 后 Read

1. `[MEMORY_ENTRYPOINT]` 有相关 ID 或 Retrieval Key 时，只把它当发现入口。
2. 不确定对应哪条 Memory 时，用具体概念或 Retrieval Key 调用 search；`limit` 最大 6。
3. 搜索 snippet 只用于判断相关性，不是权威正文。
4. 对可能相关的 Memory 调用 read；每次最多读取 4 个 ID。
5. 按 cache state 处理：
   - `current`：使用返回的当前正文；
   - `revision_changed`：使用新正文与新 Revision ID，丢弃缓存表述；
   - `inactive`、`deleted`、`access_changed`、`unavailable`：停止使用，不复原或猜测旧正文。
6. 当前 read 返回正文时，也返回不可分割的 `target` 与 `agentCanRevise`。依赖该正文时使用当前结果；若
   广泛回忆触发新的捕获判断，先切换到对应精确 Scope 的 View，再对完整集合决定 add/revise/stop。

## 只做一次最小 mutation

1. 先用一句话概括候选，不调用写 operation。
2. 选择最小 Scope、合法 Kind，以及仅在 Relationship add 时需要的 present counterparty 和 `directed`。
3. 用 View 检查所选 Scope 的完整当前适用集合。
4. 只选一个结果：等价则 stop；同一理解需纠正且允许修改则 revise；没有等价且确有长期价值则 add；
   不确定则 stop。
5. 用 `rovai memory write` 执行 add 或 revise。Hearth 也使用同一命令，不存在第二条 propose command。
6. 检查 closed outcome：
   - `effective`：`memoryId` 与 `revisionId` 对应正式且立即生效的 Memory；
   - `review_pending`：`reviewItemId` 只定位等待用户决定的 Hearth Review Item，不能声称已保存为 Memory；
   - 失败：遵循安全 recovery，不声称已写入，不猜测或泄露其他候选 ID/正文/keys。

不要通过连续 Revision 打磨细小措辞。revise 的 `target` 是不可分割的目标断言；命令只更新正文和完整
Retrieval Key 集合，不能改变 Scope、Kind、counterparty 或 direction。

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
  "target": {
    "memoryId": "memory_123",
    "revisionId": "revision_456",
    "scope": "relationship",
    "counterpartyAgentId": "agent_3",
    "direction": "directed"
  },
  "body": "交接时同时提供测试命令、结果与对应提交。",
  "retrievalKeys": ["交接证据", "测试结果"]
}
```

Companion/Hearth target 同样包含 `memoryId`、`revisionId` 和 `scope`，但不带 Relationship 两字段。
