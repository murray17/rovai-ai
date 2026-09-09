---
document_type: contract
contract: context-delivery-profile-v5
status: accepted
target_version: v1.56
last_updated: 2026-09-09
---

# Context Delivery Profile v5

继承 [Profile 4](context-delivery-profile-v4.md) 的候选资格、顺序及数值：最多 15 条 recent、24,000 Unicode
scalar 公共历史预算、每条 2,000、最多 3 层回复链、8 个 self-active Task。profileVersion=5。

无引用历史消息仍使用 body prefix 与 nextBodyOffset。含引用的可选历史候选按正文加全部 quote.text 的 Unicode
scalar 总量计数，作为不可拆分整体；超过单条预算整条省略，记录 `quote_message_over_body_budget`。
总预算和 Runtime 字节预算也只移除整条候选，不裁剪 quote.text。空引用不增加模型字段。

本次 `CURRENT_INPUT.message + quotes` 与含引用的必要 originatingPublicUserMessage 必须完整交付，后者不受
可选候选 2,000 字符 gate 丢弃。可选历史、Task 等依次让出预算后仍不能容纳时，整体返回明确的 Runtime
payload overload，不能改发摘要或整条来源消息。quote 本身不建立 Reply closure。

冻结 Profile 4 Evidence 继续按旧证据回放，不使用 Profile 5 重新选择历史。字段与完整性由
[ContextManifest v23](context-manifest-evidence-v23.md) 和 [Message Quotes v1](message-quotes-v1.md) 约束。
