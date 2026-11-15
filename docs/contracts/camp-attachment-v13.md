---
document_type: interface-contract
contract: camp-attachment
version: 13
status: accepted
authority: live-source-attachment-download
last_updated: 2026-11-15
---

# Camp Attachment v13

继承 [v12](camp-attachment-v12.md) 的附件身份、展示、owner 授权、当前内容读取与生命周期规则。
增加队员普通文件行的下载动作；不改变消息、Source Ref、Core 请求、数据库或 Runtime 输入。

## Desktop 保存副本

`RovaiApi.attachments.save(locator)` 通过 `rovai:attachment-save` 只接收现有 `LocalAttachmentOwnerLocator`，
不接收 Renderer 提交的源路径或目标路径。Main 验证 locator，并复用已有 Desktop 附件解析器取得普通文件。
默认文件名从已授权显示名派生，去除路径分隔符与平台非法字符；目标位置只能来自系统保存窗口。
取消窗口不写入文件，不作为失败。

系统窗口确认后再次按同一 owner 解析当前源，归属失效、源缺失或变为目录时不保存。
普通文件按字节流写入目标同目录的临时文件，完成后替换用户选定的目标；失败保留既有目标并清理临时文件。
沿用已授权 Source Ref 的符号链接解析规则，取得最终普通文件后持有其句柄完成复制，不读取目录或特殊文件。
保存到原文件或其同一文件身份时不截断、不替换原文件。
不依赖预览成功、文件类型解码或预览容量预算，不启动系统应用，也不通过 HTTP 读取本机源。

结果为 `{ saved, error, availability }`：

- 成功：`saved=true`、`error=null`、`availability=available`。
- 取消：`saved=false`、`error=null`，保留已观察的 availability。
- 源不可用：`saved=false`、`error=target_unavailable`，返回对应 availability。
- 其他失败：`saved=false`、`error=save_failed`；结果不包含源路径、目标路径或底层异常。

## Renderer 与 Web

队员普通文件行保留主体点击预览及既有右键菜单，右侧增加独立下载按钮。
Web 复用既有 exact-owner 附件下载能力与短期授权，下载当前文件，不为下载打开预览。
用户文件卡、Composer、目录和图片缩略图维持原有操作。
进行中禁止重复触发，取消静默恢复；失败原位提供重试，成功只作无障碍通知。
附件或客户端 scope 改变后不以迟到结果更新新卡片，也不打开旧预览或抢焦点。
视觉、悬浮、键盘与触屏规则归[会话附件 UI](../ui/components/conversation-workspace.md)。
