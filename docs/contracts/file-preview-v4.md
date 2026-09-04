---
document_type: contract
contract: file-preview
version: 4
status: historical
authority: desktop-file-preview-wire
last_updated: 2026-09-03
---

# File Preview v4

## 相对 v3 的变化

完整继承 [v3](file-preview-v3.md) 的来源校验、具体文件能力、Preview／系统打开分类、窗口句柄、读取、刷新、
系统操作、更新通知和资源释放边界。本版本只在消息呈现前增加一个只读存在性探测，并用一份共享资源类型定义统一
inline-code 候选准入、会话文件图标和普通文件 Tab 图标。

存在性探测不读取文件内容、不调用 Preview classifier、不打开系统应用，也不创建 Tab、handle、reopen token、
asset token 或 watcher。点击后仍完整重走 v3 打开链路；探测结果不是文件能力。

## 消息 inline-code 呈现准入

```ts
interface ResolveMessageFileReferencesRequest {
  campId: string
  messageId: string
  rawReferences: string[]
}

interface ResolveMessageFileReferencesResult {
  resolvedReferences: string[]
}

interface FilePreviewApi {
  resolveMessageReferences(
    request: ResolveMessageFileReferencesRequest
  ): Promise<ResolveMessageFileReferencesResult>
}
```

Renderer 只从完整 inline-code AST 节点提取候选，不扫描普通正文、代码块、Markdown link、图片或链接 label。
单次请求包含 1–64 个候选；`messageId` 最长 128 个字符，每个引用最长 4096 个字符，字符串必须非空且不含 NUL。
Main 拒绝错误 shape、非法 Camp ID 和越界输入，并校验 sender 是当前应用窗口主 frame、请求 Camp 已绑定为当前窗口 Camp。

每个候选按以下顺序独立解析：

1. Core 确认 `messageId` 属于该 active Camp、消息未删除，且同一 `rawReference` 确实位于该消息的完整
   inline-code 或显式 Markdown 文件链接语法中；
2. 相对路径使用该消息来源的工作目录：有来源 AgentRun 时使用其绝对 `executionRoot`，否则使用 directory Camp 的
   绝对 `project_path`；绝对路径、Home 相对路径和本机 file URI 沿用 v3 的直接解析；
3. Main 沿用打开链路的路径解析、`realpath`、外部具体文件规则和 `stat`，但只判断结果是否为现存普通文件；
4. 成功时在 `resolvedReferences` 中原样返回该 `rawReference`；不存在、目录、非法、来源不成立或单项解析失败时省略。

Main 可以对输入去重，但响应顺序必须按去重后的首次出现顺序稳定返回。单个候选失败不使其他候选失败；整个请求的
结构、sender 或当前 Camp 门禁失败时请求拒绝。Renderer 把未返回候选继续显示为普通 `<code>`，不显示资源图标，
不生成文件链接，也不把降级当成用户可见错误。

显式 Markdown 文件链接继续表达作者已经给出的链接意图，不依赖本探测才显示为链接；点击时仍必须通过 v3 的来源与
文件校验。普通正文中的路径和 `/compact` 等命令不进入候选集合。

## 共享资源类型定义

```ts
type ResourceVisualKind =
  | 'markdown' | 'html' | 'code' | 'config' | 'text'
  | 'image' | 'svg' | 'patch' | 'pdf' | 'document'
  | 'spreadsheet' | 'presentation' | 'notebook' | 'archive'
  | 'audio' | 'video' | 'database' | 'executable'

interface ResourceTypeDefinition {
  extensions: string[]
  visualKind: ResourceVisualKind
  fileNames?: string[]
  fileNamePrefixes?: string[]
}
```

定义中的扩展名为带点的小写值且全局唯一；`fileNames` 与 `fileNamePrefixes` 只保留既有无扩展名配置文件的识别。
共享定义只回答两件事：目标是否属于已知资源类型，以及使用哪个资源图标。文件引用语法仍与视觉类型分离；
Preview／系统打开／无法打开仍完全由 Main 的既有 classifier 根据扩展名、大小、MIME 与内容等信息决定。

会话文件链接与普通文件 Tab 都以目标文件名查询 `ResourceVisualKind`；同一个文件不能因入口不同而选择不同图标。
File Change Tab 固定使用 `patch` 图标。未知类型使用通用 `file` 图标，但不得因此推断打开策略。

## 点击、分类与时序

存在性响应只证明探测时同一来源可解析到普通文件，不包含 canonical path、能力 ID 或分类结果。文件可能在探测与点击
之间变化，因此每次点击仍发送原始 `message_reference` 并重新执行 v3 的 Core 来源校验、路径解析、文件身份检查和
Main classifier：

- classifier 支持的文件创建或激活 Rovai Preview Tab；
- classifier 暂不支持的文件交给系统默认应用，不创建 Preview Tab、长期 handle 或 watcher；
- classifier 拒绝或点击时文件已消失则返回既有公开错误，不使用旧探测结果放宽权限。

位置语法 `:line`、`:line:column`、`:start-end` 与 `#L...` 只影响打开后的定位。判断资源类型和文件存在性前先移除
位置部分，但 `resolvedReferences` 和后续点击请求始终保留消息中的原始字符串。
