---
document_type: architecture
authority: file-preview-components-and-boundaries
status: accepted
last_updated: 2026-09-22
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
- **Preload** 只暴露 [File Preview v20](../contracts/file-preview-v20.md) 的场景化方法；iframe 不获得 Preload；
- **Renderer** 拥有按 Camp 隔离的窗口内 Tab shell、布局与阅读状态，只把显式 Markdown link 分类为本地文件或 Web
  入口；inline-code 和正文不进入文件识别，也不读取磁盘。Activity 与 Execution 是 Renderer-only 合成标签，
  只借用同一 Tab shell 和分栏 host，不进入文件 controller、resource owner 或恢复来源。Tab shell 不拥有文件能力
  或当前文件事实。

预览仅提供阅读能力。文字选择与系统复制是本地阅读行为，不连接 Composer 写入、消息持久化或 Agent input；
引用能力不在当前组件图内。

`Files Changed` 卡片的入口由 Renderer 根据冻结的 `presentationKind` 路由：可靠差异进入不可变 Review，
`operation_only` 使用同一 Run Evidence 身份打开普通当前文件 Tab。后者仍经过 Core/Main 当前文件映射与具体文件能力
校验，并采用成功后提交；它不把当前文件内容写回历史 Evidence，也不改变 Runtime 文件变化投影。
Core 解析 `run_evidence/open_current` 时，以 exact AgentRun + execution epoch + Camp 绑定读取冻结的
`workspace_json.executionRoot`；有效绝对路径优先于 Camp 项目目录。只有缺少有效 executionRoot 的旧 Run 才回退到
active directory Camp 的绝对 `project_path`。相对 Evidence 路径仍拒绝父目录跳转并按 Run 根解析；规范化绝对路径按证据
给出的原位置解析，包括 Run 根外的具体普通文件。因此 Mission worktree 的新增文件以及与原项目同名的文件不会
误开原项目副本。

Command View 的 canonical diff 文件行和无 Diff 的终态 Read/Write 文件操作行共用 `run_activity_file`。
Core 先用 exact Camp、AgentRun、execution epoch 和 Evidence ID 找到该 Evidence 所关联的 canonical activity；
Diff 路径须精确命中 available diff projection，无 Diff 的文件操作路径须精确命中同一终态 Evidence
中已准入的 schema 2 `runtimeFileOperation.path`，且 activity 已成功。通过后，相对路径复用上述
`executionRoot` 优先、历史 Camp 项目回退的根目录规则；绝对路径保持原位置。该来源
因此可在 Run 尚未终态、尚无
`AgentRunFileChangesView.evidenceFileId` 时打开 Mission worktree 文件，同时不会把 Renderer 的任意路径升级为
Run 根目录授权。根外绝对路径仍须精确命中 Evidence，Main 只授予已解析的具体普通文件能力。终态 Read/Write
缺少 Evidence identity 时拒绝打开；缺少身份的历史 Diff presentation 才保留 Camp workspace 兼容回退。

任何打开来源必须先成为封闭 `OpenFilePreviewRequest`。消息来源中的 `rawReference` 必须由 Core 证明是 exact
CampMessage 的显式本地 Markdown link destination；Core 返回的 root/base/candidate 只在 Core↔Main 内部存在；
Main 对 root 和目标分别 realpath，拒绝特殊文件，并把一次可信用户激活最终定位到的普通文件收敛成“具体文件能力”。
该能力不要求 canonical file 位于 Camp/project root：外部文件使用 `dirname(canonicalFile)` 作为临时 watcher、相对子链接
和资源边界，但不创建、持久化或公开 Root Grant。Message、Camp Workspace、Attachment、Run Evidence `open_current`、
Run Activity File 及 `child_of_handle` 使用同一规则；绝对路径、Home 相对路径、file URI 与 symlink 最终指向的具体文件没有第二次授权交互。

附件入口使用 composer、pending、pending_edit 或 message 的 exact owner locator。Core 在每次显式
preview/open/reveal 时解析私有 source path 或既有 Managed/legacy path，并返回当前 availability。附件卡片按 exact owner 懒加载实际位置，不自行猜测路径；已解析的本机路径可展示、完整复制和定位。SQLite 历史读取不预先 stat 附件，动作结果只更新
当前 Renderer 卡片且不持久化。

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

## 路径呈现与系统操作

Main 在来源校验、path resolution、realpath、普通文件检查和 classifier 成功后，以实际打开的 canonical
文件生成呈现：canonical 文件位于 canonical Camp 项目根内时签发项目相对路径；项目外普通文件签发
canonical 绝对路径，位于 canonical Home 内时可投影为 `~/`。Renderer 只使用 Main 签发的
`project_relative | external | file_name_only` 呈现，不从字符串反推项目归属或文件身份。

Core 的内部 Attachment target 对已定位的本机附件允许路径展示，Source Ref、Managed 与 legacy 均适用。
Preview bar 展示当前实际读取位置，消息标签保持文件名；完整路径悬停和复制不受视觉截断影响。
Web 标明服务器位置，不提供本机文件管理器操作。旧存储权限与内容校验保持原规则。
位置查询复用 owner/record 解析，不为展示读取全文或验证发布摘要。

路径行的系统定位、Tab 菜单的系统打开与复制完整路径都以当前句柄记录为输入。Main 在操作前重验来源、
binding generation 和 canonical 文件身份；复制始终使用重验后的 canonical 绝对路径。可见 `displayPath`
不反向进入 Main，不创建 Root Grant，不授权父目录，也不更改 Camp、会话或 Runtime 工作目录。

## 窗口文件能力

每个成功预览在 Main 中映射为窗口级句柄。记录包含 `webContentsId + campId + sourceIdentity + canonicalPath +
capabilityRoot + capabilities + contentVersion + contentGeneration`。逻辑句柄随预览 session 保留，不设空闲 TTL；
底层描述符空闲 30 分钟可关闭。每窗口最多 64 项，满额先回收非可见、可恢复且无必要操作的最旧句柄。

`previewKey` 由窗口、Camp 与已校验的 canonical path 摘要生成，仅用于 Renderer Tab 去重；不包含消息/Run 来源或行号，
同一实际文件从不同入口打开仍激活现有 Tab。已有同一来源标签热命中直接复用；真正打开新来源时单独校验并创建来源绑定的 handle。
已加载 Tab 只按 `previewKey` 去重，不把不同执行根中的同名相对路径合并；只有尚无 `previewKey` 的冷恢复 Tab 才使用
Main 签发的稳定来源路径匹配。去重不升级权限。
`reopenToken` 在 Main 绑定各自原始来源链；刷新或句柄过期时重新验证来源、realpath 和文件身份并最多自动重试一次。子文件成功打开后获得
独立 token，父 Tab 关闭不撤销子 Tab。若 `child_of_handle` 最终打开的是当前 Camp 业务工作区内的普通文件，Main 还会
独立读取当前 Camp/workspace authority、重新 canonicalize 工作区根并签发相对工作区根的 `camp_workspace`
`restoreRequest`；它不保存或延长父 handle，也不把项目外临时能力升级为业务来源。

## Camp 文件会话与恢复

Renderer 的 `file-preview-session.ts` 保存最多 24 个 Camp 的轻量快照：稳定标签 ID、可重验来源、安全呈现、
顺序、活动项、显隐和阅读位置。File Change 保存既有 summary、selected evidence ID、projection revision 和位置，
不复制 detail。来源水位推进时，Renderer 以 exact Run/epoch 原位更新同一标签，保留选择、展开、查找与滚动；
较旧的异步 detail response 不能覆盖较新的 projection，刷新失败时继续显示上一份明确标为 stale 的可读内容。
`file-preview-resources.ts` 是窗口级资源所有者，`file-preview-controller.ts` 维护各 session 的正文、分页、Blob URL、
句柄、资源映射、站点和加载请求。React 只订阅状态，通过稳定的预览容器显示当前 Camp；不常驻完整 Camp 或 Runtime。

最多 8 个热 Camp、128 MiB 不可见可重建内容、4 个 HTML 页面实例分别回收；集中配置与完整规则见
[File Preview v20](../contracts/file-preview-v20.md)。保留不可重新取得内容，不通过普通回收丢弃临时唯一副本。
24 个快照包含热 Camp。只有用户切回/打开/激活更新 LRU，后台完成和监听不更新。

切 Camp 只切显示。热命中直接复用标签内容、Blob URL 和 iframe，不重读、不重验、不重新准备站点；冷恢复仅加载
当前需要显示的标签。原请求继续归原 Camp/session/tab/generation，关闭、淘汰、代次替代才拒绝并释放迟到资源。
HTML 保留页面和站点，隐藏时退出交互与焦点范围，接受有限实例继续执行作者脚本，不增加冻结或监控系统。

Main 将 `{campId, previewSessionId, bindingGeneration}` 与当前导航分开。来源读取检查存活 session；系统打开、
目录选择等原生效果仍检查发起时导航。session 结束释放自己的 handle、Grant、challenge、token 与 watcher。
`restore` 仍只接受可重验业务来源，不产生原生副作用。无法恢复的临时来源在热集合中保持能力；实际能力被撤销后
保留 unavailable shell，不把项目外临时能力升级为业务来源。

刷新用独立候选句柄/内容/映射，不原地修改旧记录。HTML 候选确认根文档已加载、通道已连接后一起切换，显示提交
才释放旧版本；失败只释放候选。新旧共存纳入容量。读取新分页仍验证版本，旧缓存显示不经过验证路径。

## 读取与 generation

全文源码、Markdown 和代码渲染上限为 4 MiB；HTML 网页预览使用独立的 32 MiB 文档上限，分类器与
`prepareHtmlSite` 的资源响应执行同一 HTML 上限，不因超过源码阈值而降级。`readText` 仍限制为 4 MiB，
Markdown 经 `prepareHtml` 取得资源 token 时也不扩大该限制。超过相应上限的文本使用 generation-bound 分页。
HTML 的 UTF-8 校验、来源与 generation 重验、隔离 iframe 和子资源保护保持原有边界。每个响应携带当前
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

事件不执行 read/stat，只标记已有标签有更新。最后一个订阅释放时关闭 watcher；session 回收、窗口销毁、来源撤销与退出
分别清理自己的引用。watcher 失败后关闭 entry 并记录去路径诊断，不启动轮询。

## HTML 预览站点与 Markdown 资源

Desktop 原生 HTML 正式链路为：已有文件能力 → Electron-free 预览站点 → 实际 HTTP 文档 → 不同源 iframe。
共享 `packages/html-preview` 拥有静态资源映射、实例、响应、注入位置映射、诊断和浏览器宿主通道；Desktop Main
拥有 loopback 生命周期适配、文件来源与窗口绑定。Renderer 只接收 descriptor，不接收磁盘根或通用文件接口。
WebUI/MobileUI 复用 Viewer 和浏览器通道；其 HTML 根文档由统一 Rust Host 认证读取后在同来源静态壳中运行。
Web 按可信 HTML 使用原生 Storage、表单、弹窗和新窗口，不提供附件与工作台的来源或登录材料隔离；
精确权限与取舍由 [Host Web v2](../contracts/host-web-v2.md#workspaces-uploads-and-resources)拥有。
下述独立 `.localhost` 站点和不同源保证仅适用于 Desktop 原生预览。

每实例使用独立 `.localhost` origin，并以入口 capability 兑换 HttpOnly partitioned cookie；Host、来源、cookie、
现有 authority、generation、文件身份与路径范围共同验证，随机端口不是授权。资源保留原文、相对位置和查询参数，
只在作者脚本前插入同步诊断加载标签；不使用 srcdoc、History shim、全局 API 替换或资源正则重写。

HTML iframe 使用 allow-scripts + allow-same-origin；站点必须与宿主及其他实例不同源。CSP 允许作者脚本、样式、
HTTP(S) 网络依赖和必要子页面，保留 CORS/证书/混合内容与第三方嵌入限制。无信任、交互或逐资源审批，加载失败
保留真实状态。内部 iframe 可访问当前 HTML 的其他 query，也可按已有能力读取子页面；附件 self-only 能力不扩张。

诊断按受校验的 source/origin/实例/generation/challenge/document 消息通道送回宿主，同源子页面仅经直属 frame
窗口校验后转发。脚本错误、资源错误、文档加载和诊断连接分别管理；可见正文及用户路由保留，失败不伪造恢复。
受管 HTTP 站点不设置空闲关闭计时器，由现有预览资源层关闭或淘汰。HTTP 资源诊断流与页面消息通信分离，
断流不影响文档状态、查找、滚动或候选提交；仅在当前文档内有限重连，恢复清除对应暂态提示。握手和请求超时仍独立有效。
Renderer 的文档期限由当前根 `documentId` 拥有，重复握手及子 frame 不重置；iframe load 只触发确认，不代表成功。
无响应显示非阻塞的未知状态。服务端诊断采用有界回放与文档订阅起点，按请求开始序号过滤旧记录和延迟旧请求，
子页面不清空根页面诊断，新的导航不继承历史页已耗尽的展示额度。
查找使用有界可见正文快照、现有 Worker 和高亮定位；源码独立读取未注入内容。完整 wire、限制和状态见
[File Preview v20](../contracts/file-preview-v20.md)。

Markdown 继续使用 `rovai-preview://asset/<tab-token>/<segments>`，在 app.ready 前注册 secure standard scheme，
实际窗口 Session 安装 sender gate 与 protocol handler。token 绑定窗口、Camp、句柄、generation 和文档目录；
只接受 GET，逐段解码并检查文档目录 containment、类型、大小和 MIME。Markdown 资源 token 不用于 HTML URL 入口。

## 资源释放

- Tab 关闭：handle、reopen token、asset token、HTML 站点的请求/诊断流/端口与 watcher subscription；
- Pane 隐藏/Camp route commit：只改变显示，保留 session 资源和阅读状态；
- LRU：按内容、HTML 实例、逻辑句柄、热 Camp、冷快照分别回收，不删除业务对象；
- Camp 永久删除：Core accepted 后立即阻止当前 route 离开 effect 把删除前 shell 写回，并在请求关键路径之外
  best-effort 清除该 Camp 的窗口 session；释放失败不推翻删除受理，由后台资源 owner 继续安全清理；
- webContents 销毁/应用退出：幂等释放对应或全部资源。

不支持格式在来源与本地文件校验后直接交给系统默认应用，并在返回前释放一次性解析材料；它不进入上述长期资源图。
