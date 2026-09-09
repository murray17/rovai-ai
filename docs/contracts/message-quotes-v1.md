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

可选内部 locator 包含 projectionVersion=1、startScalar、endScalar、projectionDigest。它使用 Core 验证后的投影范围与 UTF-8 SHA-256 摘要，并纳入 snapshotDigest；不进入模型输入。旧快照无 locator 时仍可读取、发送和重放。

投影复用 Renderer 的结构化前缀语义：当前用户前缀与其后的 Markdown 正文分块，队员前缀按首个 Markdown 段落决定内联或独立行。用户正文保持纯文本与字面 Markdown。选择请求可携带 currentUserDisplayName，仅用于已有 CurrentUserMention 的当前展示名称；Core 验证名称边界和真实结构，不能借此替换其他正文或声明作者。只有用户明确选进引用的可见文字进入新快照，后续改名不改写源消息、历史引用或已冻结上下文。

Core 建立快照前验证源可读、来源版本和 MessageQuoteTextProjection v1 的 Unicode scalar 选区；正文 CRLF 转 LF，段落两个换行，显式换行一个换行，列表/表格固定分隔，代码保留缩进/空行。引用由用户实际选择的正文可见文本构成，不补 Markdown 包装或隐藏 URL。请求冲突须重新选择。草稿变更进入既有 revision 队列，同一次操作幂等。总选文上限 12,000 Unicode scalar，超限失败，不截断已有文本；仅引用而无问题不能发送。

发送、排队、编辑保存和提升原子携带快照；失败保留正文及全部引用。编辑取消恢复 canonical Pending。来源后续变动/不可用不改变已保存选文，owner 永久删除清理其引用。移除以 quoteId 定位，不改变剩余条目的顺序。草稿 UI 不提供撤销移除；已有 restore 操作及移除暂存保留协议兼容，恢复时仍保持原顺序且不覆盖后来新增的条目。

## 模型与读取

CURRENT_INPUT 的 message 保持本轮问题，quotes 为 skills/attachments 同级可选字段，空时省略。每段投影 `{kind:"message_excerpt",source:{scope:"current_conversation_messages",messageId,author},text}`，不暴露 campId/conversationId、quoteId 或摘要。user 作者 displayName 为“用户”。相对 scope 只用于本次会话；其他会话检索由结果外层保留真实 owner，不重新标为当前会话。

引用纯文本不进入 Mention、Skill、reply、接收者、Current User attention、命令或权限解析。Native Charter 的两条完整新增解释见已确认说明；工具调用仍受原 Core 权限约束。ExternalQuote 不变。

当前问题和全部选文为必要输入，超载显式失败。含引用可选历史以 body + quotes.text 合计计费且不可分割，超过每条 2,000 scalar 时以 quote_message_over_body_budget 省略；必要 originating 输入保留。最近 15、历史 24,000、父引用 3 的数值不变。精确读取返回完整引用，普通正文分页语义保留且不截断引用。

有序快照和完整 projection 进入 Manifest 证据，正文 digest 保留原义，另记 projectedInputDigest。恢复只能使用冻结快照和投递字节。Formatter 23 / Manifest 23 / Profile 5 / Charter revision 6，历史冻结证据不回写。

## 来源定位与呈现

草稿及历史默认只显示引用段数和作者。悬浮或键盘聚焦展开非模态气泡，完整选文的整行是来源跳转入口，移除是独立按钮。正文来源必须仍属当前 Camp 或当前精确 Single Chat Conversation；不支持群聊/单聊或两个私聊之间搬运引用。

回跳仅给选区涉及的完整视觉行短暂底色，不使用竖线或整条消息底色。Renderer 先校验完整投影摘要，再恢复标量范围；同文重复也不能选错位置。旧快照只接受唯一完整匹配，过期或歧义定位返回可见反馈，保留选文。布局重排重新计算行矩形；装饰层不改变可复制文本或选区准入。
