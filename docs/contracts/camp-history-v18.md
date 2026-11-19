---
document_type: protocol-contract
contract: camp-history-v18
authority: public-camp-history-read-scope
status: accepted
version: 18
source_version: v1.72
last_updated: 2026-11-19
---

# Camp History v18

继承 [v17](camp-history-v17.md) 的输入、可见边界、排序、消息片段、引用和读取预算。
`thread.search` 和 `history.search` 完整扫描允许范围后返回成功。成功对象只含 `results` 数组与
`truncated` 布尔值，两者必填。数量上限或响应大小裁剪时 `truncated=true`。
完整零命中结果为 `{"results":[],"truncated":false}`。读取或扫描失败返回工具错误。

新成功结果移除 `searchIncomplete`。历史回执和冻结输出保留曾记录的值，包括零命中且
`searchIncomplete=true` 的旧结果。配套投递版本见 [Built-in Tool Transport v46](builtin-tool-transport-v46.md)。
