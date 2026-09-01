---
document_type: contract
contract: file-preview
version: 3
status: accepted
authority: desktop-file-preview-wire
last_updated: 2026-09-01
---

# File Preview v3

## 相对 v2 的变化

继承 [v2](file-preview-v2.md) 的来源校验、窗口句柄、读取、刷新、系统操作、更新通知和资源释放边界；
把一次明确文件点击收敛为临时的具体文件能力。普通文件不再因 canonical path 位于来源 root 外返回
`authorization_required`，Renderer 也不再把该错误自动升级为目录选择。`rootGrant` 保留，但只服务显式目录访问。

HTML/Markdown 的本地资源 token 改为绑定当前文档所在目录，而不是 Camp root 或持久 Grant。Tab 关闭、Camp
切换、窗口销毁或 token 过期时，该资源范围随之释放。

## 打开来源与具体文件意图

```ts
type OpenFilePreviewRequest =
  | { kind: 'message_reference'; campId: string; messageId: string; rawReference: string }
  | { kind: 'camp_workspace'; campId: string; rawReference: string }
  | { kind: 'attachment'; campId: string; attachmentId: string }
  | { kind: 'run_evidence'; campId: string; agentRunId: string; executionEpoch: number; evidenceFileId: string; action: 'review' | 'open_current' }
  | { kind: 'child_of_handle'; parentHandleId: string; rawReference: string; allowSystemOpen?: boolean }
  | { kind: 'authorized_root'; campId: string; rootGrantId: string; rawReference: string }

type OpenFilePreviewResult =
  | { kind: 'evidence_review'; campId: string; agentRunId: string; executionEpoch: number; evidenceFileId: string }
  | { kind: 'file_preview'; file: ResolvedFilePreview }
  | { kind: 'opened_in_system'; fileName: string }
```

请求对象拒绝未知字段，字符串有界；Main 校验 sender 是当前应用窗口的主 frame，且请求 Camp 已提交为该窗口的
当前 Camp。Core 仍须把 Message、Camp Workspace、Attachment、Run Evidence 映射成封闭来源；Renderer 不能提交
任意宿主路径跳过来源校验。

来源最终定位到一个现存普通文件后，Main 对候选执行 `realpath + stat`，并把本次用户激活视为打开该具体文件的
意图。目标是否位于 Camp/project root 内不改变结果：

- 支持预览的文件创建只读 `ResolvedFilePreview` 和独立窗口 handle；
- 不支持预览的文件在同一次用户激活中交给系统默认应用，不创建长期 handle；
- `message_reference`、`camp_workspace`、`attachment`、`run_evidence/open_current` 和
  `child_of_handle` 使用同一规则；绝对路径、Home 相对路径、本机 file URI 和最终指向外部文件的 symlink
  不触发目录选择；
- `run_evidence/review` 仍只返回不可变 Evidence；Attachment 的子文件限制和不受信 HTML 的
  `allowSystemOpen:false` 仍保持；
- 目录不取得文件读取 handle。来源允许的目录操作只在系统文件管理器中显示；需要浏览或新增目录能力时，
  必须进入独立的显式目录流程。

`authorization_required` 不得成为具体文件点击的正常结果，Renderer 不得因它调用 `chooseAuthorizedRoot()`。
无法定位、文件消失、不是普通文件或读取失败时才返回失败；用户文案不得出现 Camp root、Grant、handle、token
或 capability 原因。

消息中的带行号短名仍只有在同条消息存在唯一明确文件路径时复用来源。尾部单个 `:` 的恢复仍要求原路径不存在、
没有位置目标、去掉冒号后为现存普通文件；恢复不修改原始消息或 Core 来源校验。

## 公开文件描述

```ts
type FilePreviewKind = 'markdown' | 'html' | 'code' | 'text' | 'paged_text' | 'image' | 'svg' | 'patch'
interface FileContentVersion { size: number; mtimeMs: number; fileId?: string }
interface FileLocationTarget { line?: number; column?: number; endLine?: number; endColumn?: number; heading?: string; htmlFragment?: string }

interface ResolvedFilePreview {
  handleId: string
  reopenToken: string
  previewKey: string
  displayPath: string
  pathPresentation: 'project_relative' | 'file_name_only'
  fileName: string
  size: number
  mime: string
  extension: string
  kind: FilePreviewKind
  hasExternalUpdate: boolean
  contentVersion: FileContentVersion
  contentGeneration: string
  capabilities: Array<'read' | 'read_child' | 'open_in_system' | 'preview_asset'>
  target?: FileLocationTarget
}
```

`displayPath` 只允许 Camp 项目相对路径、Attachment 显示名或外部具体文件的安全文件名。
`pathPresentation:project_relative` 只在 Main 完成 `realpath` 后确认 canonical 文件仍位于当前 Camp 项目根目录、
且 `displayPath` 确实以该项目根目录为基准时签发；Attachment、项目外具体文件、显式 authorized root 和已经离开
项目根目录的 `child_of_handle` 均为 `file_name_only`。Renderer 不从字符串形态、文件名或 managed Attachment
存储位置反推来源。响应、错误和 Renderer 日志不得包含 canonical path、临时资源 root、authorized root、receipt、
watcher ID 或来源 token 内容。

Renderer 仅在 `project_relative` 且 `displayPath` 含目录层级时常驻显示路径；项目根目录文件、Attachment 和项目外
文件只在 Tab 显示文件名。外部更新仍可按需显示独立更新操作，不得为了该操作保留空路径占位。

`previewKey` 是窗口与 Camp 内 canonical file 的不可读去重身份。同一文件不因来源、相对写法或行号分裂 Tab；
每次打开仍独立校验来源并创建来源绑定的 handle，去重不共享或升级权限。

## 读取、重开与系统动作

```ts
readText({ handleId, expectedGeneration })
readPage({ handleId, expectedGeneration, offset, maxBytes })
resolveLine({ handleId, expectedGeneration, line })
readBinary({ handleId, expectedGeneration })
reopen({ campId, reopenToken })
reload({ handleId, reopenToken, expectedGeneration })
release({ handleId })
openInSystem({ handleId })
revealInFolder({ handleId })
copyPath({ handleId, format: 'display' | 'absolute' })
```

文本按 UTF-8 严格解码；普通整文本最大 4 MiB、页最大 256 KiB、图片最大 32 MiB。所有读取绑定 generation。
内部 `stale_generation`、`handle_expired` 先按原始来源重新验证 canonical file identity 并最多自动重试一次。

外部具体文件的临时能力随 handle/reopen token 保存，描述符过期、刷新、系统打开、显示所在位置和复制绝对路径
均重新验证同一来源与文件身份，不重新弹目录选择。来源不再成立、文件被移动/删除或身份改变时失败，不扩大为目录能力。

## HTML 与 Markdown 本地资源

`prepareHtml()` 为当前 HTML 或 Markdown handle 签发窗口、Camp、handle、generation 绑定的 `tabToken`；其资源 root
固定为 `dirname(canonicalFile)`，公开 `assetBasePath` 为空。相对 CSS、脚本、图片、字体与媒体通过
`rovai-preview://asset/<tab-token>/<segments>` 从该目录解析。

资源 handler 只接受 GET，并在每次读取时验证 token、sender、generation、路径段、canonical containment、普通文件、
大小与 MIME；`..` 不得越过文档目录。HTML iframe 继续无 `allow-same-origin`，禁止网络、连接、表单、顶层导航
和下载。Tab 关闭后 token 与资源范围立即失效。

Markdown/HTML 中一次可信点击的本地文件链接使用 `parentHandleId + rawReference` 解析；成功目标获得自己的 handle
与 reopen token。父 Tab 关闭不撤销已经打开的子 Tab；自动资源读取不创建子文件 handle，也不能启动系统应用。

## Root Grant

`rootGrant` 只属于“选择目录、打开文件夹、添加外部目录、浏览目录内容”等明确目录级操作。一次性
`pendingOpenId` 绑定窗口、Camp、原目录请求并保持五分钟；`chooseAuthorizedRoot()` 只返回
`{rootGrantId, displayName, result}`，不返回目录路径。

普通文件点击不得创建 pending challenge、不得调用目录选择器、不得把文件意图升级为持久或短期 Root Grant。
`authorized_root` 请求仍严格受所选 canonical root containment 约束，不继承具体文件直开的外部例外。

## 外部更新与公开错误

```ts
interface FilePreviewExternalUpdateEvent { campId: string; previewKeys: string[] }

type FilePreviewErrorCode =
  | 'source_not_authorized' | 'reference_not_clickable' | 'file_not_found'
  | 'authorization_required' | 'too_many_open_files' | 'evidence_identity_unavailable'
  | 'not_regular_file' | 'outside_authorized_root'
  | 'file_too_large' | 'decode_failed' | 'read_failed' | 'open_failed' | 'reveal_failed'
```

外部具体文件使用其临时 capability root 参与 watcher 去重；事件仍只发布已验证文件的 `previewKey`，不暴露目录。
`authorization_required/outside_authorized_root` 仅可服务显式目录/既有 Grant 流程，不是普通文件点击的用户可见恢复分支。
Renderer 对意外的内部访问错误统一显示“无法打开文件”及可恢复说明，不展示内部权限原因。
