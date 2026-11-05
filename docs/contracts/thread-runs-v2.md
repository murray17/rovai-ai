---
document_type: protocol-contract
contract: thread-runs-v2
authority: public-thread-execution-query
status: accepted
version: 2
source_version: v1.72
last_updated: 2026-11-05
---

# Thread Runs v2

继承 [v1](thread-runs-v1.md) 未被以下条款替代的输入、输出、授权、预览、排队聚合和分页规则。

## 公开运行归属

`thread.runs` / `rovai thread runs` 是公开执行查询，实际 Run 仅由 `agent_run.camp_id = threadId`
选入；继续排除 Single Chat invocation 和私有 Conversation。不再读取 CampTurn 或合并 Turn-only Run。
这与 [Thread Open v31](camp-open-projection-v31.md) 的公开 Run 归属一致。

仅通过旧 Turn 关联的运行不进入普通、active 或 status 筛选结果，即使其存储状态仍为 waiting。
原始运行和状态不迁移、回填或删除；此工具不作为保留旧执行列表的诊断入口。
当前 waiting Delivery 仍按其直接会话归属独立聚合，未 claim 时继续返回 queued / null agentRunId；
续做请求的输入计数与首条预览来源保持。

候选 Run 只使用已有直接会话索引；不得随同会话的旧 Turn-only Run 或其他会话 Run 数量逐行增长。
时间戳排序仍会检查本会话匹配的运行，队列计数仍覆盖本会话完整 waiting 集合；不承诺 O(limit)。

输入／输出 schema、CLI flags、工具描述、Agent 输出格式和错误保持。游标继续使用 v1 编码；
旧 Run 离开候选集合按既有动态分页处理，不增加 Session 失效、持久状态或历史修复。
取舍与授权见 [V1.72-D75](../versions/v1.72/decisions.md#v1-72-d75)。
