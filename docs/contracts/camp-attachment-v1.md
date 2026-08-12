---
document_type: interface-contract
contract: camp-attachment
version: 1
status: accepted
authority: camp-attachment-ingress-storage-read-model
last_updated: 2026-08-13
---

# Camp Attachment v1

## Scope

本合同冻结 ordinary Camp Composer 中普通文件与目录快照的 ingress、Draft、受管存储、消息消费、
Read Side 与 Runtime 路径语义。它不增加纯附件消息、部分发送、云上传、原路径引用或 Quick Chat
Composer。

## Closed attachment shape

`PreparedAttachmentView` 与 `CampMessageAttachmentView` 共享以下字段：

```json
{
  "id": "<opaque attachment id>",
  "displayName": "项目资料",
  "kind": "directory",
  "fileCount": 128,
  "mediaType": "inode/directory",
  "byteSize": 19293798,
  "previewKind": "none"
}
```

- `kind` 必须是 `file | directory`；Renderer 不从名称、大小或 MIME 反推。
- `fileCount` 是非负整数。普通文件固定为 `1`；目录只统计普通文件，空目录为 `0`。
- `byteSize` 是普通文件字节数；目录为其中全部普通文件的聚合字节数，目录节点不贡献字节。
- 目录的 `mediaType` 固定为 `inode/directory`，`previewKind` 固定为 `none`。
- Prepared View 继续额外拥有 `state / errorMessage / createdAt`；一旦进入 Message Attachment，
  上述公共字段保持不变。

CampSnapshot Read Model 从 schema 28 升为 schema 29，只增加 `kind / fileCount`。旧普通文件记录
投影为 `kind = "file" / fileCount = 1`。

## Ingress and snapshot

1. Electron Preload 只通过 `webUtils.getPathForFile(file)` 把磁盘项目路径交给 Main；Renderer
   不获得绝对路径。没有磁盘路径的 Clipboard `File` 继续走有界 bytes ingress，并只能形成普通文件。
2. Core 对顶层项目执行 `symlink_metadata`，目录遍历使用 `O_NOFOLLOW` 的已打开目录句柄和
   `openat` 子项；复制期间目录名称集合、目录指纹或文件指纹变化时整项失败。
3. 目录项按原始文件名 bytes 确定性排序。普通目录、空目录、普通文件与 dotfile 原样复制；
   symlink、socket、FIFO、device 和其他特殊节点整项拒绝。
4. 树摘要为 `sha256:` 加 canonical tree bytes 的 SHA-256。canonical bytes 以
   `rovai-directory-snapshot-v1\0` 开头，随后按 preorder 写入目录记录和按名称排序的子项；
   文件记录包含相对路径、字节数和文件内容 SHA-256，目录记录包含相对路径。
5. 受管位置固定为
   `<userData>/camp-attachments/<camp-id>/<attachment-id>/<safe-name>`。文件权限为 owner read-only，
   目录权限为 owner read/execute；Attachment parent 与 Camp root 继续不可枚举。
6. Attachment parent 的 Core-private `.rovai-attachment.json` 保存 schema version、kind、fileCount、
   byteSize 与 contentDigest。它不是消息附件内容、Renderer 字段或 Runtime Context 入口。

## Limits and atomicity

| Boundary | Limit |
| --- | ---: |
| Top-level attachments per Draft | 10 |
| One ordinary file, including a file inside a directory | 25 MiB |
| Aggregate bytes of all Draft attachments | 64 MiB |
| Regular files inside one directory attachment | 2,000 |
| Files + directories below one directory root | 4,000 |
| Maximum directory depth below the attached root | 32 |

顶层目录本身不计入 4,000 个子节点。目录快照计为一个顶层附件，其全部文件字节参与 64 MiB Draft
总量。准备在消息事务前完成；发送事务只消费 Draft 中按顺序排列的全部 Prepared Attachment ID，
不重新复制、不部分发送。

## Runtime and read boundaries

- Current Input 的既有 `attachments: string[]` 可包含普通文件路径或目录根路径；Runtime 通过原生
  文件工具检查并读取该路径。
- Shared Conversation 继续投影 `name / mediaType / path`，其中目录使用 `inode/directory`。
- ContextManifest Formatter 保持 v13；`attachmentRefs` 的 ID/path/digest shape 不变，目录树摘要
  直接作为该 attachment 的 content digest。
- exact `camp.read` 的 attachment metadata 增加 `kind / fileCount`，不返回 storage path。
- Renderer 图片 preview 只接受既有安全 raster 文件；目录永不进入 preview 读取。
- 删除 Prepared Attachment、过期 Draft 或 Camp 时，Core 只递归清理 Rovai-owned attachment parent，
  不修改原始文件或目录。

## Failure categories

以下任一情况整项失败并清理未拥有副本：顶层 symlink/特殊节点、目录内 symlink/特殊节点、读取失败、
复制期间变化、单文件/总字节/文件数/节点数/深度超限、受管元数据不一致或 Draft revision 冲突。
失败项保留在 Renderer 的本地 error 卡供用户移除；Core Draft 中不写入半成品记录。

## References

- [ADR-0169](../adr/0169-core-owned-directory-attachment-snapshots.md)
- [ADR-0080](../adr/0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md)
- [ADR-0081](../adr/0081-camp-public-attachment-paths-and-frozen-discovery.md)
- [Camp 会话区拖放 UI](../ui/conversation-drop-zone.md)
