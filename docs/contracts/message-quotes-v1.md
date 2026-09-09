---
document_type: interface-contract
contract: message-quotes
version: 1
status: accepted
authority: immutable-message-excerpts
last_updated: 2026-09-09
---

# Message Quotes v1

补充 Camp Composer Draft v12、Pending Camp Input v3、Single Chat v3 与消息读取合同。已确认输入说明：[v1.56 revision 6](../versions/v1.56/model-context-change-partial-message-quotes.md)。

## 归属与快照

每个公共/私有 Draft、Pending（含 edit working copy）、发布消息拥有有序 `quotes`，历史无引用为 `[]`。快照为 version 1、quoteId、source（camp/single_chat、真实 campId、私有 conversationId、messageId）、authorAtCapture（user 或 agent，Core 解析）、text、format=plain_text、capturedAt、sourceContentDigest、snapshotDigest。ID 不授予读取权限；来源必须与 owner 为同一会话。

Core 建立快照前验证源可读、来源版本和 MessageQuoteTextProjection v1 的 Unicode scalar 选区；正文 CRLF 转 LF，段落两个换行，显式换行一个换行，列表/表格固定分隔，代码保留缩进/空行。引用由用户实际选择的正文可见文本构成，不补 Markdown 包装或隐藏 URL。请求冲突须重新选择。草稿变更进入既有 revision 队列，同一次操作幂等。总选文上限 12,000 Unicode scalar，超限失败，不截断已有文本；仅引用而无问题不能发送。

发送、排队、编辑保存和提升原子携带快照；失败保留正文及全部引用。编辑取消恢复 canonical Pending。来源后续变动/不可用不改变已保存选文，owner 永久删除清理其引用。移除以 quoteId 定位；撤销保留原顺序且不覆盖后来新增的条目。

## 模型与读取

CURRENT_INPUT 的 message 保持本轮问题，quotes 为 skills/attachments 同级可选字段，空时省略。每段投影 `{kind:"message_excerpt",source:{scope:"current_conversation_messages",messageId,author},text}`，不暴露 campId/conversationId、quoteId 或摘要。user 作者 displayName 为“用户”。相对 scope 只用于本次会话；其他会话检索由结果外层保留真实 owner，不重新标为当前会话。

引用纯文本不进入 Mention、Skill、reply、接收者、Current User attention、命令或权限解析。Native Charter 的两条完整新增解释见已确认说明；工具调用仍受原 Core 权限约束。ExternalQuote 不变。

当前问题和全部选文为必要输入，超载显式失败。含引用可选历史以 body + quotes.text 合计计费且不可分割，超过每条 2,000 scalar 时以 quote_message_over_body_budget 省略；必要 originating 输入保留。最近 15、历史 24,000、父引用 3 的数值不变。精确读取返回完整引用，普通正文分页语义保留且不截断引用。

有序快照和完整 projection 进入 Manifest 证据，正文 digest 保留原义，另记 projectedInputDigest。恢复只能使用冻结快照和投递字节。Formatter 23 / Manifest 23 / Profile 5 / Charter revision 6，历史冻结证据不回写。
