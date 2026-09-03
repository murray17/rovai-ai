---
document_type: architecture
authority: file-preview-components-and-boundaries
status: accepted
last_updated: 2026-09-03
---

# File Preview Architecture

## 组件与权威

```text
Renderer entry
  → typed Preload API
  → Desktop Main sender/camp gate
  → Core source authority
  → Main canonical path + handle + reader + watcher
  → safe metadata/content response
```

消息只有显式 Markdown link 会成为 entry：

```text
Renderer Markdown link node
  → local file link | Web link

inlineCode / text / code block
  → presentation only; no disk access

explicit local-link click
  → existing v3 open pipeline
  → unchanged Main classifier
  → Preview Tab | system application | public failure
```

- **Core** 拥有 Camp、Message、Attachment、Runtime Evidence 与当前文件身份映射；
- **Desktop Main** 拥有宿主路径、原生选择器、Root Grant、只读文件能力、reopen token、HTML/asset token、watcher 和系统操作；
- **Preload** 只暴露 [File Preview v5](../contracts/file-preview-v5.md) 的场景化方法；iframe 不获得 Preload；
- **Renderer** 拥有当前 Camp 的 Tab、布局与阅读状态，只把显式 Markdown link 分类为本地文件或 Web 入口；
  inline-code 和正文不进入文件识别，也不读取磁盘。

预览仅提供阅读能力。文字选择与系统复制是本地阅读行为，不连接 Composer 写入、消息持久化或 Agent input；
引用能力不在当前组件图内。

任何打开来源必须先成为封闭 `OpenFilePreviewRequest`。消息来源中的 `rawReference` 必须由 Core 证明是 exact
CampMessage 的显式本地 Markdown link destination；Core 返回的 root/base/candidate 只在 Core↔Main 内部存在；
Main 对 root 和目标分别 realpath，拒绝特殊文件，并把一次可信用户激活最终定位到的普通文件收敛成“具体文件能力”。
该能力不要求 canonical file 位于 Camp/project root：外部文件使用 `dirname(canonicalFile)` 作为临时 watcher、相对子链接
和资源边界，但不创建、持久化或公开 Root Grant。Message、Camp Workspace、Attachment、Run Evidence `open_current`
及 `child_of_handle` 使用同一规则；绝对路径、Home 相对路径、file URI 与 symlink 最终指向的具体文件没有第二次授权交互。

目录不取得文件读取能力：仅在来源已校验的明确用户激活中交给系统文件管理器显示，不创建 Tab、handle 或 watcher。
消息/工作区中的显式绝对路径、Home 相对路径或本机 file URI 若直接指向项目外目录，可只执行系统显示；相对路径或
项目内 symlink 越界目录仍需进入显式目录流程。目录包同样只显示，不调用可能启动应用的默认打开动作；Attachment、
历史 Evidence 和非交互子资源不扩展到目录。

消息/工作区引用的尾部单个冒号仅由 Main 在原路径不存在、无行列/范围目标、去掉冒号后仍为合法路径且普通文件
实际存在时恢复；不修改原始引用或 Core 来源校验，刷新、重开与系统动作重复相同解析及 containment 检查。

## 消息文件入口准入与视觉类型

`SafeMarkdown` 只转换 Markdown AST 的 `link` 节点。显式本地 target 显示文件图标并保留原始引用供点击；HTTPS
target 显示网页图标。`inlineCode` 始终渲染普通 `<code>`，普通正文和代码块同样不扫描、不猜测、不查询存在性。
结构化消息与普通消息使用相同边界。

显式本地链接在渲染时不检查文件。点击后，相对引用以消息来源工作目录解析：来源 AgentRun 的绝对
`executionRoot` 优先，否则使用 directory Camp 的绝对项目目录；绝对路径、Home 相对路径和本机 file URI 沿用
既有解析。Core 只授权 exact Message 中的显式 Markdown destination，Main 随后执行 path resolution、realpath、
文件身份检查和既有 classifier。不存在或不可访问的目标在点击后返回既有公开失败。

共享资源类型定义只拥有文件名到 `ResourceVisualKind` 的映射。会话显式文件链接与普通文件 Tab 以同一个文件名查询
同一视觉类型；未知扩展名使用通用文件图标。它不参与消息语法识别，也不拥有 `FilePreviewKind` 或打开策略。Main 的
既有 classifier 继续独立结合扩展名、大小、MIME 与内容决定 Preview、系统应用或失败，不支持预览的文件不会因
已经显示类型图标而创建 Preview Tab。

## 窗口文件能力

每个成功预览在 Main 中映射为窗口级句柄。记录包含 `webContentsId + campId + sourceIdentity + canonicalPath +
capabilityRoot + capabilities + contentVersion + contentGeneration`。TTL 为 30 分钟，每窗口最多 64 项；正常读取、
刷新和系统动作延长 TTL，但没有 Renderer heartbeat。

`previewKey` 由窗口、Camp 与已校验的 canonical path 摘要生成，仅用于 Renderer Tab 去重；不包含消息/Run 来源或行号，
同一文件从不同入口打开仍激活现有 Tab。每次打开继续单独校验来源、创建来源绑定的 handle；去重不共享或升级权限。
`reopenToken` 在 Main 绑定各自原始来源链；刷新或句柄过期时重新验证来源、realpath 和文件身份并最多自动重试一次。子文件成功打开后获得
独立 token，父 Tab 关闭不撤销子 Tab。

## 读取与 generation

整文件 Markdown/HTML/代码渲染上限为 4 MiB；更大文本使用 generation-bound 分页。每个响应携带当前
`contentGeneration`，旧 generation 的并发结果被拒绝。分页响应携带绝对 byte offset 与绝对起始行，Renderer
不得把上一页末尾半个 UTF-8 code point 拼成新 Authority。

文件没有读取锁。每次刷新、系统打开、reveal、子资源读取前重新校验来源、文件身份与对应 capability containment。刷新开始后 Viewer
继续显示旧 generation；成功时原子替换，失败时旧内容仍为可读真值。

## Root Grant

Root Grant 只服务“选择目录、打开文件夹、添加外部目录、浏览目录”等显式目录操作。目录流程可返回一次性
`pendingOpenId`；用户通过 Main 原生目录选择器选择 root，Main 判断它是否覆盖原目录候选，成功后签发绑定 Camp
与窗口的短期 `rootGrantId`。Renderer 从不接收所选绝对路径，也不能提交任意路径登记为 Grant。

普通文件点击不创建 pending challenge，也不从 Renderer 自动调用目录选择器。旧 `authorization_required` 若意外到达
普通文件入口，只能降级为通用“无法打开文件”反馈，不能恢复旧的自动授权分支。

## Root watcher

`RootWatchRegistry` 以 capability root identity 为键，一个 root 最多一个 `fs.watch(..., {recursive:true})`。
每个打开 Tab 登记窗口、Camp、previewKey 与已验证 relative identity。事件经平台路径归一化后只发布匹配
`previewKeys`；filename 缺失或只报告 root 时保守标记该 root 的全部订阅。

事件不执行 read/stat，不改动 Viewer。最后一个订阅释放时关闭 watcher；Camp 切换、窗口销毁、来源撤销与退出
分别清理自己的引用。watcher 失败后关闭 entry 并记录去路径诊断，不启动轮询。

## HTML 资源

`rovai-preview://asset/<tab-token>/<segments>` 在 `app.ready` 前注册为 secure standard scheme，并在实际窗口 Session
安装 webRequest sender gate 与 protocol handler。token 绑定窗口、Camp、Tab、父句柄、generation 和
`dirname(canonicalFile)`；handler 只接受 GET，逐段解码并每次执行文档目录 containment、文件类型、大小和 MIME 检查。
HTML/Markdown 的公开 `assetBasePath` 为空，相对资源从当前文档目录开始；`..` 不得越过该目录。

HTML 通过无 `allow-same-origin` 的 sandbox iframe 执行；CSP 在用户文档之前注入，禁止网络、连接、表单、顶层
导航和下载。宿主拦截主/子 frame 导航与新窗口。消息桥只接受 ready、受限高度和本地链接选择三类有界消息，
同时验证 `event.source`、token、字段长度和当前 iframe 实例。可信本地链接点击使用 `child_of_handle` 打开新的具体
文件 handle；自动资源读取不创建子 handle，也不能启动系统应用。

## 资源释放

- Tab 关闭：handle、reopen token、asset/HTML token 与 watcher subscription；
- Pane 隐藏：保留 Tab 与阅读状态，句柄仍受 TTL；
- Camp route commit：释放旧 Camp 全部窗口能力、Grant、challenge 和订阅，再清空 Renderer state；
- webContents 销毁/应用退出：幂等释放对应或全部资源。

不支持格式在来源与本地文件校验后直接交给系统默认应用，并在返回前释放一次性解析材料；它不进入上述长期资源图。
