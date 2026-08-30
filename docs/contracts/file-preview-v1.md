---
document_type: contract
contract: file-preview
version: 1
status: accepted
authority: desktop-file-preview-wire
last_updated: 2026-08-29
---

# File Preview v1

## 打开来源

```ts
type OpenFilePreviewRequest =
  | { kind: 'message_reference'; campId: string; messageId: string; rawReference: string }
  | { kind: 'camp_workspace'; campId: string; rawReference: string }
  | { kind: 'attachment'; campId: string; attachmentId: string }
  | { kind: 'run_evidence'; campId: string; agentRunId: string; executionEpoch: number; evidenceFileId: string; action: 'review' | 'open_current' }
  | { kind: 'child_of_handle'; parentHandleId: string; rawReference: string }
  | { kind: 'authorized_root'; campId: string; rootGrantId: string; rawReference: string }

type OpenFilePreviewResult =
  | { kind: 'evidence_review'; campId: string; agentRunId: string; executionEpoch: number; evidenceFileId: string }
  | { kind: 'file_preview'; file: ResolvedFilePreview }
  | { kind: 'opened_in_system'; fileName: string }
```

请求对象拒绝未知字段，字符串有界；Main 校验 sender 是当前应用窗口的主 frame并且请求 Camp 已提交为该窗口的
当前 Camp。`opened_in_system` 只在一次明确用户激活中成功调用默认应用后返回，不创建任何长期资源。

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

`displayPath` 只允许项目/root 相对路径或 Attachment 显示名；响应、错误和 Renderer 日志不得包含 canonical path、
authorized root、receipt、watcher ID 或来源 token 内容。

## 读取

```ts
readText({ handleId, expectedGeneration })
  → { text, contentGeneration, contentVersion }

readPage({ handleId, expectedGeneration, offset, maxBytes })
  → { text, startOffset, endOffset, startLine, hasPrevious, hasNext, contentGeneration, contentVersion }

resolveLine({ handleId, expectedGeneration, line })
  → { offset, line, contentGeneration }

readBinary({ handleId, expectedGeneration })
  → { bytes, mime, contentGeneration, contentVersion }
```

文本按 UTF-8 严格解码。普通整文本最大 4 MiB；页请求最大 256 KiB；图片二进制最大 32 MiB。所有读取绑定 generation。
内部 `stale_generation`、`handle_expired` 先触发按服务端来源重开并最多重试一次，不能直接进入 Renderer。

## 刷新、系统动作与释放

```ts
reopen({ campId, reopenToken }): Promise<OpenFilePreviewResult>
reload({ handleId, reopenToken, expectedGeneration }): Promise<ResolvedFilePreview>
release({ handleId }): Promise<{ released: true }>
openInSystem({ handleId }): Promise<{ opened: true }>
revealInFolder({ handleId }): Promise<{ revealed: true }>
copyPath({ handleId, format: 'display' | 'absolute' }): Promise<{ copied: true }>
```

`format:'absolute'` 只允许 Main 直接写系统剪贴板，绝对路径不经返回值进入 Renderer。Attachment 系统动作继续履行
既有更严格的来源规则。释放幂等。

## Root Grant

授权失败可以附带 `{pendingOpenId, campId, displayReference, expiresAt}`。`pendingOpenId` TTL 五分钟、绑定原请求与窗口、
单次消费。`chooseAuthorizedRoot({campId,pendingOpenId})` 只返回 `{rootGrantId, displayName, result}`，不返回目录路径。

## 外部更新

```ts
interface FilePreviewExternalUpdateEvent { campId: string; previewKeys: string[] }
onExternalUpdate(listener): () => void
```

Renderer 收到事件只能幂等设置 `hasExternalUpdate=true`。刷新开始后若收到更晚事件，较早刷新成功不得清除该标志。

## 选区

选区请求绑定同窗口、Camp、handle 与 generation，最大 64 KiB；每 Draft 最多 8 项、合计 256 KiB。持久快照只包含
`selectionId/displayPath/selectedText/range/utf-16/exclusive/contentVersion/verification/sourceKind/sourceIdentityDigest`，
不包含 handle、generation、token 或 canonical path。Draft revision 使用现有 exact-revision 冲突语义。

## 公开错误

```ts
type FilePreviewErrorCode =
  | 'source_not_authorized' | 'reference_not_clickable' | 'file_not_found'
  | 'authorization_required' | 'too_many_open_files' | 'evidence_identity_unavailable'
  | 'selection_too_large' | 'not_regular_file' | 'outside_authorized_root'
  | 'file_too_large' | 'decode_failed' | 'read_failed' | 'open_failed' | 'reveal_failed'
```

公开错误可携带安全显示引用、phase、retryable 和建议动作。`root_grant_expired/handle_expired/handle_limit_reached/
file_changed/stale_generation` 只属于 Core/Main 内部控制结果。
