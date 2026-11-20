---
document_type: protocol-contract
contract: run-facts-v11
status: accepted
version: 11
source_version: v1.72
last_updated: 2026-11-19
---

# Run Facts v11

继承 [v10](run-facts-v10.md)。公共 batch 使用内部 Facts schema **14**，非 batch 延用 **13**。
版本配对见 [ContextManifest v45](context-manifest-evidence-v45.md)。

## historyHint

公共 batch 继续用本次冻结的前次接受边界 `P` 和额外可见消息判断选择基础提示。

| 边界 | 有额外可见消息 | 基础提示 |
| --- | --- | --- |
| `P = 0` | 否 | `All visible messages in this Thread are in RUN_INPUT or were written by you.` |
| `P = 0` | 是 | `There are additional visible messages in this Thread beyond RUN_INPUT and messages written by you.` |
| `P > 0` | 否 | `All visible messages after sequence {P} are in RUN_INPUT or were written by you.` |
| `P > 0` | 是 | `There are additional visible messages after sequence {P} beyond RUN_INPUT and messages written by you.` |

普通初始输入的 `RUN_INPUT.messages` 中只要有一个 `edited: true`，在基础提示后加一个 ASCII 空格，
并追加以下句子一次。其他初始输入以及 Steer 只使用基础提示。

```text
A message marked edited replaces any earlier version with the same messageId; follow its current content.
```

每个领取候选按自身入选消息计算提示和字节数。提示取最终入选批次并随 claim 持久化。
已冻结的旧输入按原提示及原字节恢复。
