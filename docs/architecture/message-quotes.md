---
document_type: architecture
authority: message-quote-ownership-and-projection
status: accepted
last_updated: 2026-10-29
---

# 消息选文引用

[Message Quotes v2](../contracts/message-quotes-v2.md)拥有字段和可测试边界；选文与 Reply/路由仍然分离。

Renderer 在单条消息正文内提取选中的可见纯文本，保留 HTML 换行、表格分隔与代码空白，
排除操作、附件和引用卡片。仅提交 text 和可选 messageId，不维护原始正文对照、范围或跨端投影协议。
Core 直接保存 text；可选来源与作者只用于 UI 提示，查不到原消息不影响捕获。

引用由 Draft、Pending/edit 或发布消息拥有，不是正文 Atom，也不建立可读取来源仓库。
既有 mutation coordinator、私聊 revision、排队/编辑事务及迟到 ACK 隔离继续生效。
承载消息的权限与可见性仍由既有入口检查；被引用消息不再参与保存、发送、Context 或历史过滤。

Context 与消息读取工具只生成 kind=message_excerpt、text 的引用项，仍按选文文字计入既有预算。
引用不触发来源父链、派发或 Skill。旧记录的新请求读取已保存文字；已冻结输入由现有恢复入口
复用原字节与证据，Runtime adapter 不重建引用。无历史重算、批量修复或兼容投影算法。

草稿与历史复用紧凑标签和非模态气泡。来源存在时尝试跳转并聚焦当前会话消息；不做摘要匹配、
字符定位或行高亮。无来源、原文变化和跳转失败只影响导航，选文保持可读、可保存、可发送。

SafeMarkdown 沿用 react-markdown，按 rehype-raw → rehype-sanitize 默认 schema 清洗，随后生成
可信 Mention、前缀与文件链接间距。未知标签按库默认规则处理，代码与转义保持字面值。
用户普通 Text 和结构化 Thread/Mission 标题按实际显示选择；整条复制仍使用原有正文。
