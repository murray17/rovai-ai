---
document_type: contract
contract: file-preview
version: 5
status: accepted
authority: desktop-file-preview-wire
last_updated: 2026-09-03
---

# File Preview v5

## 相对 v4 的变化

完整继承 [v3](file-preview-v3.md) 的来源校验、具体文件能力、Preview／系统打开分类、窗口句柄、读取、刷新、
系统操作、更新通知和资源释放边界；替代 [v4](file-preview-v4.md) 的消息渲染前文件存在性探测。

消息只有作者明确写出的 Markdown link 才能产生资源入口。`inlineCode` 永远只是代码样式；Renderer 不从中提取
候选，不向 Preload/Main 请求解析，不读取磁盘，也不因绝对路径触发系统目录权限。普通正文与代码块同样不扫描。

## 消息资源入口

消息 Markdown AST 按以下 closed rule 呈现：

```text
link       → 本地文件链接或 Web 链接
inlineCode → 普通 <code>
text       → 普通正文
```

- 本地目标 `[label](target)` 显示文件类型图标和 `label`，并在点击时发送既有 `message_reference` 打开请求；
- HTTPS 目标显示网页图标并沿用外链打开行为；
- `config.toml`、`src/App.tsx:20`、`./docs/prototype.html` 和绝对路径无论文件是否存在，只要位于 inline-code，
  都不生成链接、图标或点击事件；
- 显式文件链接不在消息渲染阶段检查存在性。文件不存在、不可访问或不是可打开目标时，由点击后的既有打开链路
  返回公开失败结果；
- 普通消息与结构化消息遵守同一规则。消息存储、复制和模型输入保持原始 Markdown。

Core 只在 `rawReference` 是 exact CampMessage 的显式本地 Markdown link destination 时授权
`message_reference`。同一字符串只出现在 inline-code、代码块、图片、网页 URL 或普通正文中不构成来源授权。

v4 新增的下列 wire 在 v5 中不存在：

```text
FilePreviewApi.resolveMessageReferences
rovai:file-preview-resolve-message-references
ResolveMessageFileReferencesRequest
ResolveMessageFileReferencesResult
```

## 共享资源视觉类型

共享资源类型定义只把文件名映射为 `ResourceVisualKind`。显式 Markdown 文件链接与普通文件 Preview Tab 必须
使用同一映射；未知扩展名使用通用 `file` 图标。它不参与 inline-code 或正文识别，也不拥有
`FilePreviewKind`、Preview 支持性或打开策略。

位置语法 `:line`、`:line:column`、`:start-end` 与 `#L...` 在查询图标时先从文件名移除，但点击请求保留消息中的
原始字符串。真正进入预览区后，Tab 继续按文件名选择 `ResourceVisualKind`，Viewer 继续按 Main 返回的
`FilePreviewKind` 选择。

## 点击与分类

用户点击显式本地 Markdown 链接后，完整重走 v3 打开链路：Core 校验 exact Message 来源，Main 解析相对或绝对
路径并检查文件身份，再由既有 classifier 结合扩展名、大小、MIME、内容和平台能力决定结果：

- 支持预览：创建或激活 Rovai Preview Tab；
- 不支持预览：交给系统默认应用，不创建 Preview Tab、长期 handle 或 watcher；
- 文件不存在、不可访问或来源不成立：返回既有公开错误。

本版本不修改 classifier、目录处理、外部具体文件、Root Grant 或系统打开边界。图标与打开结果彼此不能互相推断。
