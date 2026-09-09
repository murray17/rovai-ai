---
document_type: architecture
authority: message-quote-ownership-and-projection
status: accepted
last_updated: 2026-09-09
---

# 消息选文引用

[Message Quotes v1](../contracts/message-quotes-v1.md)拥有字段和可测试边界；[V1.56-D01](../versions/v1.56/decisions.md#v1-56-d01)解释为何与 Reply/路由分离。

Renderer 只在单条真实消息正文中捕获选区，排除作者、操作、文件、附件、引用卡片与过程。短期选区映射和源版本提交给 Core；Core 根据当前 owner 权限和源消息解析作者、验证可读投影并签发不可变快照。剪贴板不参与准入。

引用是 owner 元数据，不是 Lexical Atom、正文或全局可读取的引用仓库。公共 Draft mutation coordinator 串行提交正文与引用操作；私有 Conversation 使用自己的 draft revision。Pending/edit 拥有完整 working copy，发布事务冻结快照，再消费原草稿。Late ACK 必须匹配原 owner。

Context 在已有统一投影入口添加 quotes，与当前问题分开，并冻结引用证据及完整输入摘要。快照不触发来源父链、派发或 Skill；只有明确 Reply 继续既有语义。Runtime adapter 只运输 Core 已冻结字节，不自行生成引用。来源回跳只定位整条真实消息；普通来源失效不影响历史选文。
