---
document_type: version-decisions
version: v1.56
lifecycle: historical
authority: decision-rationale
last_updated: 2026-09-09
---

# v1.56 版本决定

<a id="v1-56-d01"></a>
## V1.56-D01：不可变选文作为输入材料，独立于 Reply 和路由

- 状态：accepted
- 日期：2026-09-09
- 当前权威：[Message Quotes v1](../../contracts/message-quotes-v1.md)、[Message Quotes 架构](../../architecture/message-quotes.md)

用户需要连续选取多段消息文字，同时保留自己的问题和接收者。复用 Reply 会加载整条来源及父链，并改变接收者；将选文拼入正文会使 Mention/Skill/命令混入本轮意图，也无法证明选取时的文字。

因此由 Core 验证同会话来源与可读投影并签发不可变快照，Draft/Pending/Message 拥有按序 quotes。模型只在 CURRENT_INPUT 与相同会话历史消息中看到来源、作者和纯文本，当前问题保持独立。代价是新增跨持久化、上下文证据与完整预算的合同；收益是来源不可伪造、失败可恢复、路由不被引用内容改变。
