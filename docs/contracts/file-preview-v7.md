---
document_type: contract
contract: file-preview
version: 7
status: accepted
authority: desktop-file-preview-wire
last_updated: 2026-09-06
---

# File Preview v7

## 相对 v6 的变化

完整继承 [v6](file-preview-v6.md) 的显式 Markdown 文件入口与共享资源视觉类型，以及 [v3](file-preview-v3.md)
的来源校验、具体文件能力、Preview／系统打开分类、读取、刷新、HTML 沙箱、watcher 和资源释放边界。本版本增加
窗口生命周期内按 Camp 隔离的文件 Tab 恢复，并为自动恢复建立无原生副作用的独立 wire。

本版本不新增磁盘或 Core 持久化。App 重启后不恢复文件 Tab；消息、附件、Evidence、Draft 和模型输入均不增加字段。

## Renderer 窗口会话快照

Renderer 以 `campId` 为键保存有界、最近使用优先的内存快照。每个快照只包含：

```text
tabs[] =
  file:
    stable renderer tab id
    revalidatable source request | null
    safe presentation { fileName, displayPath, pathPresentation }
  file_change:
    stable renderer tab id
    campId + immutable AgentRun/epoch summary + selectedEvidenceFileId
activeTabId
paneVisible
```

快照不得包含 `handleId`、`reopenToken`、`rootGrantId`、`pendingOpenId`、HTML/asset token、Blob URL、已读取正文、分页
缓存、watcher 引用、绝对路径投影或旧 `previewKey`。安全呈现只能来自 Main 已签发的呈现字段，或在首次校验前从入口
得到的文件名／允许显示的项目相对引用；未经校验的绝对路径只投影 basename。

可重验 source closed set 为：

```ts
type RestoreFilePreviewRequest = Extract<OpenFilePreviewRequest, {
  kind: 'message_reference' | 'camp_workspace' | 'attachment' | 'run_evidence'
}>
```

`child_of_handle` 与 `authorized_root` 依赖已经释放的临时能力，快照中必须写成 `sourceRequest = null`。恢复后其 Tab
保留安全文件名和顺序，但进入 `unavailable`，不能重新使用父 handle 或 Root Grant。File Change Tab 继续只读取不可变
Evidence detail；“打开当前文件”仍以 `campId + agentRunId + executionEpoch + evidenceFileId` 重新请求当前身份。

快照状态只允许 `cold / opening / ready / missing / unavailable / error`。恢复 shell 从 `cold` 开始，不得把旧的
`ready`、正文、尺寸或图像 URL 当成当前事实。删除 Camp 后立即清除其快照；缓存和删除收尾标记都必须有界。

## Camp 切换与惰性恢复

Camp route commit 按以下顺序执行：

1. 递增 Renderer Camp scope generation，保存旧 Camp 的安全快照并撤销 Blob URL；
2. 先调用 Main `bindCamp(nextCampId)`，恢复本地 Tab shell、顺序、active Tab 与 Pane 可见性；
3. 等 `bindCamp` 成功后，仅当 Pane 可见时调用一次 `restore(activeFileSource)`；
4. 后台 File Tab 保持 `cold`，首次激活时才恢复；Pane 隐藏不删除 Tab，关闭 Tab 才从下次快照移除；
5. `bindCamp` 失败时只把当前 cold Tab 降级为 `unavailable`，不得触发其他恢复动作。

Renderer 为每个 Camp scope 和每次 Tab request 各维护单调 generation。任何 late open/read 结果只有同时匹配当前 Camp、
Tab 和 request generation 才能安装；否则撤销新 Blob URL并释放返回的 handle。A→B→A 不能仅凭相同 `campId` 接受旧 A
的完成结果。

## 自动恢复 wire

Preload 暴露：

```ts
filePreview.restore(
  request: RestoreFilePreviewRequest
): Promise<FilePreviewOperationResult<OpenFilePreviewResult>>
```

IPC channel 为 `rovai:file-preview-restore`。Main 输入解析器拒绝 `child_of_handle` 和 `authorized_root`；Renderer 不得
把 `open` 或 `reopenToken` 当作自动恢复替代品。

| 目标 | 明确用户打开 `open` | 自动 `restore` |
| --- | --- | --- |
| 当前可预览普通文件 | 校验后签发新 handle | 同样完整重验后签发新 handle |
| 目录 | 可按既有规则显示于文件管理器 | 返回 `reference_not_clickable`，不 reveal |
| 系统应用格式 | 可按既有规则确认并打开 | 返回 `reference_not_clickable`，不 confirm/open |
| 需要目录授权 | 可返回一次性 challenge | 返回原公开失败且不附 challenge，不打开选择器 |
| 临时 child/root 来源 | 按现有能力校验 | IPC closed set 拒绝 |

Main 为每个 `webContentsId` 保存 `{campId, bindingGeneration}`，Camp 绑定变更即递增 generation。来源解析完成后、原生
效果前、文件 handle 注册前以及需要等待确认的效果继续执行前，都必须复核同一个绑定对象；只比较 Camp ID 不足以
阻止 A→B→A 的旧请求。旧 generation 的 handle、Grant、challenge、HTML token 与 watcher subscription 只清理自身，
不得误删后来重新绑定到同一 Camp 的新 generation。

## 失败呈现

无法形成当前可读内容时，Tab 保留原图标、文件名与关闭动作；视觉上不增加错误点、Badge 或错误色，状态只追加到
可访问名称。正文区域只显示居中的 32px 通用文件轮廓和一句公开文案，不显示路径行、文件尺寸、标题、卡片、边框、
按钮、错误详情或内部能力名称。若仍有稳定 source，用户可从 Tab 菜单明确“重新打开”；没有稳定 source 时该动作禁用。

公开文案由错误码封闭映射，至少遵守：

| 错误码 | 正文唯一文案 |
| --- | --- |
| `file_not_found` | `找不到这个文件` |
| `attachment_missing` | `找不到这个附件` |
| `source_not_authorized` / `authorization_required` / `outside_authorized_root` | `文件访问已失效` |
| `evidence_identity_unavailable` | `无法定位这个历史记录对应的当前文件` |
| `read_failed` | `暂时无法读取文件` |
| `attachment_unreadable` | `暂时无法读取这个附件` |
| `attachment_kind_changed` | `这个附件的类型已变化` |
| `decode_failed` | `无法读取这个文件的内容` |
| `file_too_large` | `这个文件太大，无法预览` |
| `too_many_open_files` | `打开的文件太多` |
| `not_regular_file` / `reference_not_clickable` | `无法在这里预览这个文件` |
| `open_failed` | `暂时无法打开这个文件` |
| `reveal_failed` | `暂时无法显示这个文件的位置` |

系统打开、显示所在位置和复制路径只在当前 Tab 仍持有 Main handle 时可用。恢复 shell 与失败 shell 不得借旧呈现字段
伪造这些能力。
