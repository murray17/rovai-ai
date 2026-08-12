# Search、Read 与最小写入

先分别查看所需 operation 的精确 help：

- `rovai memory search --help`
- `rovai memory read --help`
- `rovai memory write --help`
- `rovai memory propose-hearth --help`

## 先读，再依赖

1. `[MEMORY_ENTRYPOINT]` 有相关 ID 或 retrieval key 时，只把它当发现入口。
2. 不确定对应哪条 Memory 时，用具体概念或 retrieval key 调用 `rovai memory search`；`limit` 最大 6。
3. 搜索 snippet 只用于判断相关性，不是权威正文。
4. 对可能相关的 Memory 调用 `rovai memory read`；每次最多读取 4 个 ID。
5. 按状态处理：
   - `current`：使用返回的当前正文。
   - `revision_changed`：使用返回的新正文和新 Revision ID，丢弃缓存表述。
   - `inactive`、`deleted`、`access_changed`、`unavailable`：停止使用，不复原或猜测旧正文。
6. revise 必须使用本次 read 返回的最新 `revisionId` 作为 `baseRevisionId`。

## 最小 mutation 顺序

1. 用一句话概括候选 Memory，先不调用写 operation。
2. 选择最小 Scope、合法 Kind 和 Relationship direction。
3. search 重叠内容，再 read 所有可能重叠的结果。
4. dedupe 后只选一个结果：
   - 已有等价 Memory：不写；
   - 同一理解需纠正或合并：revise；
   - 没有等价内容且通过持久性判断：add；
   - 属于 Hearth：propose。
5. 使用 `rovai memory write` 或 `rovai memory propose-hearth` 执行一次最小 mutation。
6. 检查 receipt：write 成功才说明 active Memory 或 Revision 已存在；propose 成功只说明 pending
   proposal 已存在；失败时不得声称已保存、更新或生效。

不要通过连续 Revision 打磨细小措辞。revise 只能更新正文和完整 retrieval-key 集合，不能改变 Scope、
Kind、counterparty 或 direction。

JSON payload 只能按精确 help 通过 stdin 或 `--input-file` 传给上述 operation。例如新增 Companion：

```json
{
  "action": "add",
  "scope": "companion",
  "kind": "preference",
  "body": "实现方案应明确区分已经确认的决定、当前假设与仍待回答的问题。",
  "retrievalKeys": ["方案格式", "确认事项", "未决问题"]
}
```

修订时还要提交 `memoryId` 与最新 `baseRevisionId`；Relationship add 还要提交合法的
`counterpartyAgentId` 与 `direction`；Hearth payload 交给 `rovai memory propose-hearth`，不能直接写入。
