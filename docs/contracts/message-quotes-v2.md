---
document_type: interface-contract
contract: message-quotes
version: 2
status: accepted
authority: immutable-message-excerpts
last_updated: 2026-10-29
---

# Message Quotes v2

替代 [v1](message-quotes-v1.md) 的来源准入和跨端投影；已确认范围见[变更说明](../versions/v1.72/model-context-change-html-quotes-simple.md)。

## 保存与归属

选中文字就是引用内容。捕获请求为 `{text: string, messageId?: string}`；Renderer 从单条消息的实际
DOM 选区提取可见纯文本，保留 br 换行、段落与表格分隔、代码空白。排除操作按钮、附件及其他卡片。
Core 不重读正文或验证字符范围、来源摘要、投影版本；选中后正文继续变化不影响保存。

快照保留 `version:1`、`quoteId`、`text`、`format:plain_text`、`capturedAt`。
`source`（scope、campId、可选 conversationId、messageId）和 `authorAtCapture` 均可省略，
只作为 UI 提示。有 messageId 时可按当前 owner 查询作者；查不到不拒绝选文。
移除 sourceContentDigest、snapshotDigest、locator 及跨端投影机制。
旧记录的这些字段不再参与读取、保存或发送，不回写历史 text。

Draft、Pending/edit、发布消息仍各自拥有有序 quotes；承载消息原有会话权限、可见性、草稿归属、
revision、幂等与原子提交保持。被引用消息不参与权限、归属或状态过滤。
选文总计上限 12,000 Unicode scalar，空白选文不接纳，超限失败，不截断。
仅引用而无新问题不能发送。失败保留问题与全部引用；移除按 quoteId 保持剩余顺序。
已有 restore 操作继续使用保存的文本与顺序，不重新校验来源。

## 模型与读取

新生成的 CURRENT_INPUT、RUN_INPUT、共享历史及所有消息读取工具只使用一种格式：

```json
{"kind":"message_excerpt","text":"用户保存的选文"}
```

quotes 仍在原位置；空时省略。schema 只声明 kind、text，不要求或输出来源、作者。
历史记录用于未来请求时直接读取已保存 text。来源缺失、变化、删除或跳转失败均不影响引用使用。
承载消息自身仍受既有可见性、会话归属及上下文预算约束。

当前问题与全部选文为必要输入；超载显式失败。可选历史按 body + quotes.text 计费且整条省略，
不单独丢弃引用；既有条数、正文与总预算不变。引用不触发 Mention、Skill、Reply、派发或权限解析。
Manifest 保留 quoteId/text 与完整输入证据；已有冻结 Blob、投递与恢复沿用原字节，不重算旧选文。
版本准入见 [ContextManifest v43/v44](context-manifest-evidence-v44.md)。

## 呈现与跳转

复用紧凑引用标签和非模态气泡，作者存在时展示作者。无来源仍可展开、选择文字、移除和发送。
有来源时只尝试滚动并聚焦当前会话中的消息，不恢复字符范围或绘制精确行高亮。
来源不在当前会话或已不可用时保留选文，并反馈“原消息暂不可用，已保留引用选文”。
不为导航扩大读取权限；来源提示不是引用文本的有效性证明。
