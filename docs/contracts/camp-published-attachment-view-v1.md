---
document_type: protocol-contract
contract: camp-published-attachment-view-v1
authority: camp-published-attachment-runtime-view
status: accepted
version: 1
last_updated: 2026-08-20
---

# Camp Published Attachment View v1 Contract

## 1. Root、布局与准入

Desktop 必须显式传入绝对 `--runtime-camp-files-root`。macOS root 为：

```text
<canonical-home>/.rovai/instances/v1-<64-lowercase-sha256-hex>/runtime-files
```

digest 输入为 `rovai-runtime-camp-files-instance-v1\0 || utf8(canonicalUserDataPath)`。Windows root 固定为
`<data_dir>\runtime-files`；其他实例、开发和显式 user-data 必须使用各自 root。Core 不推断共享 Home root。

```text
<root>/
├── .runtime-camp-files-root.json
├── .runtime-camp-files.lock
├── .staging/<operation-id>/...
└── camps/<camp-id>/attachments/<attachment-id>/payload/<authority-safe-leaf>
```

root admission 在 SQLite migration 前验证规范化绝对路径、所有既有组件非 symlink/reparse、实例 key、marker
schema/identity/platform、ancestor/nested marker、root exclusive lock、当前用户、本地文件系统和 managed-root/
workspace containment。macOS root 为 `0700`；Windows 使用 Private Storage 的 local fixed NTFS、stable identity、
protected DACL 和 non-reparse admission。未标记的非空 root、marker mismatch 或 overlap 都返回
`runtime_camp_files_root_invalid`，不得接管或清空。

Runtime 只接收 `<root>/camps/<current-camp-id>/attachments`，绝不接收 root、`camps` parent、Camp parent、
其他 Camp 或 `<data_dir>/camp-attachments`。

## 2. View Entry 与 catalog

一个 Published Attachment 在 Camp View 中恰有一个稳定 Entry。Entry payload 不包含 Authority
`.rovai-attachment.json`、display metadata、receipt、index、ACL/xattr/resource fork 或 executable mode。
普通文件和目录都从 Authority no-follow handle 复制为新节点；symlink/reparse、hardlink source、socket、FIFO、
device、mount escape、类型/identity drift 或摘要不符整项拒绝。

`camp_attachment_view` 保存 Camp state、generation、root identity、entry/byte aggregate、catalog digest 和 active
operation。`camp_attachment_view_entry` 保存 attachment ID、kind/count/bytes/digest、safe leaf、root-relative path、
entry identity、published generation 和 publication operation。catalog digest 是全部 ready Entry receipt 按
attachment ID 排序后的 canonical digest。

state 为：

```text
initializing | ready | mutating | rebuilding | integrity_failed | cleanup_pending
```

只有整个 Camp View 为 `ready` 且 receipt/文件树一致时，Context freeze、A2A preflight、launch、resume 和 prompt
dispatch 才可进入。

## 3. Publication journal 与线性化

operation kind 为 `publish | initial_backfill | controlled_rebuild | camp_delete_cleanup`。publish 状态机为：

```text
planned → copying → staged → gated → promoting → promoted → committing → committed → completed
                  ↘ rolling_back → rolled_back
                                      ↘ recovery_required
```

带附件发送先注册幂等 operation，把全部 Draft Attachment 复制到 `.staging`，重新计算并复核 Authority receipt，
再取得 per-Camp mutation gate。staging directory/file 为 `0700/0600`。gate 内 final directory/file 加固为
`0500/0400`，完整 `<attachment-id>` subtree 在同一文件系统原子 rename；只有必要 parent 在最短窗口临时可写。

随后一个短 SQLite transaction 原子提交 CampMessage、`message_attachment`、View Entry、generation、Draft
consumption 和既有 Turn/Run 事实。该 commit 是消息接受及 Published/Camp-shared 授权的唯一线性化点。失败时
按 journal 删除本 operation 新 promote 的 Entry；回滚不完整进入 `recovery_required`，不能公开缺附件消息。
已 `committed` command 重试先验证最终 View 再幂等 replay；验证失败保持 business commit，startup 走受控 rebuild，
不得回滚成未发布。

mutation gate 与覆盖整次 Runtime launch/run 的 Camp read admission 互斥。gate 等待最多 55 秒；超时返回
`camp_attachment_view_busy`，Draft revision 与公共时间线不变。全部 Adapter 当前使用
`generation_fenced_v1`；发布/重建在 promote 前停止或 fence 旧 Host。

## 4. Receipts

Manifest 使用 `CampAttachmentViewReceiptV1`：

```json
{
  "schemaVersion": 1,
  "campId": "rvcamp_...",
  "publishedAttachmentRoot": "/absolute/current-camp/attachments",
  "rootIdentityDigest": "sha256:...",
  "minimumReadyGeneration": 2,
  "catalogEntryCount": 3,
  "catalogDigest": "sha256:...",
  "referencedAttachmentIds": [],
  "referencedAttachmentSetDigest": "sha256:..."
}
```

Runtime Input Delivery 使用 `RuntimeAttachmentAuthReceiptV1`：

```json
{
  "schemaVersion": 1,
  "campId": "rvcamp_...",
  "publishedAttachmentRoot": "/absolute/current-camp/attachments",
  "rootIdentityDigest": "sha256:...",
  "dispatchGeneration": 2,
  "catalogDigestAtDispatch": "sha256:...",
  "visibilityMode": "generation_fenced_v1",
  "compatibilityGeneration": 2,
  "manifestViewReceiptDigest": "sha256:..."
}
```

`live_append_v1` 的 compatibility generation 必须为 null；`generation_fenced_v1` 必须等于 dispatch generation。
没有真实正向 Probe 不得启用 live append。Runtime request digest 绑定 Auth Receipt digest；只有 accepted ACK
证明对应输入实际被 Runtime 接受。

## 5. Quota、恢复与清理

| Boundary | Limit |
| --- | ---: |
| One Camp View aggregate bytes | 4 GiB |
| One instance all Camp Views | 16 GiB |
| One instance staging bytes | 512 MiB |
| Concurrent staging operations | 8 |

quota 按 unique attachment ID 计算，并在注册、复制后和 commit 前复核；不驱逐或裁剪已发布 Entry。

startup 在 Runtime admission 前按 operation 和数据库 commit 事实 adopt/rollback。ready Entry 缺失、被替换、
摘要漂移或多出非法节点先标记 `integrity_failed`、fence Camp Host，再通过 `controlled_rebuild` 从全部
`message_attachment` Authority 重建并推进 generation。Authority 不一致保持 fail closed。Camp 删除使用
`camp_delete_cleanup` journal；删除只接受 typed root-relative target，未知节点或 symlink/reparse 保留并阻断。

Migration 99 只从空、已准入的当前实例 root 回填全部 `message_attachment`；`prepared_attachment` 永不进入。
root 只允许 marker、lock 和空 `.staging/camps`，任何其他内容在 schema 修改前拒绝。

## 6. Stable errors

```text
runtime_camp_files_root_invalid
runtime_camp_files_root_locked
camp_attachment_view_not_ready
camp_attachment_view_busy
camp_attachment_view_source_invalid
camp_attachment_view_digest_mismatch
camp_attachment_view_quota_exceeded
camp_attachment_view_storage_unavailable
camp_attachment_view_publish_failed
camp_attachment_view_integrity_failed
camp_attachment_view_backfill_failed
camp_attachment_view_runtime_unsupported
camp_attachment_view_generation_mismatch
camp_attachment_view_recovery_required
```

这些错误不授权 authority-root fallback、历史 path rewrite、部分消息 acceptance 或扩大清理范围。

## References

- [Camp Published Attachment View architecture](../architecture/camp-published-attachment-view.md)
- [Camp Attachment v2](camp-attachment-v2.md)
- [V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)
