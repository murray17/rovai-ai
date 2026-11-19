---
document_type: protocol-contract
contract: camp-history-v17
authority: public-camp-history-read-scope
status: accepted
version: 17
source_version: v1.72
last_updated: 2026-11-19
---

# Camp History v17

继承 [v16](camp-history-v16.md) 的请求、分页、读取权限、消息可见性和预算。
公开、跨 Thread 及私聊消息的 quotes 统一遵循 [Message Quotes v2](message-quotes-v2.md)：
每项只含 kind=message_excerpt、text，来源与作者不进入输出 schema。
只检查承载消息的读取边界，不查询或过滤其引用来源。已保存文字不随来源变化。
历史冻结输出与 receipt 原样保留；未来的新工具读取采用新格式。
配套 CLI/Core 准入见 [Transport v45](builtin-tool-transport-v45.md)。

## 消息正文搜索

`thread.search` 省略 `threadId` 时读取当前 Thread 的实时发布边界，显式指定其他公开 Thread 时使用
Run 冻结的全局发布边界。`history.search` 在同一冻结边界内搜索其他公开 Thread，支持 `threadIds` 及
RFC 3339 时间范围。`dateFrom` 包含端点，`dateTo` 排除端点。撤回与 tombstone 不进入搜索，
已发布的 recallable/waiting 消息仍可命中。详细读取继续使用 `thread.read`。

两个搜索工具的 `query` 都是最多 512 个 Unicode 标量的非空白字符串。普通正文按不区分大小写的连续子串
匹配。空格、引号、`%`、`_` 等都作为原字符串的一部分，所有词长使用同一规则。匹配、出现次数、
首个位置、长度与片段以 Agent 可见正文为准。结构化当前 User 提及可用 `@User` 或兼容别名 `@Principal`，
返回片段显示 `@User`。已派生的引用编号继续补充命中。

`thread.search` 的 `limit` 默认 10、最大 20，`history.search` 默认 15、最大 30。排序依次考虑
精确引用、出现次数、首个位置、正文长度、消息新近度和稳定 ID。Core 扫描允许的范围后按该顺序返回。
`searchIncomplete` 表示扫描未完成，`truncated` 表示结果受数量或响应预算裁剪。完成扫描且零命中时，
`results` 为 []，两个标志均为 false。
