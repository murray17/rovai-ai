---
document_type: protocol-contract
contract: camp-open-projection-v15
authority: camp-open-storage-blind-attachment-projection
status: accepted
version: 15
source_version: v1.40
last_updated: 2026-09-04
---

# Camp Open Projection v15

v15 inherits [v14](camp-open-projection-v14.md) and changes only the attachment projection used by Camp Open,
history windows, around/thread/timeline reads and current message rendering.

Every source, Managed v2 and legacy attachment is projected through the same
`CampMessageAttachmentView` defined by [Camp Attachment v8](camp-attachment-v8.md). The View contains display
metadata and `availability`, but never an absolute path or `source_ref | managed_v2 | legacy_v1` discriminator.

All SQLite-backed history reads return `availability = unknown`. They do not `stat`, open or enumerate source or
managed payloads, and do not start a watcher or persist an availability result. Preview/open/reveal performs the
owner-scoped check only after an explicit user action; its result may update the current Renderer card without
changing this read model.

Open schema 6, Snapshot 34, Navigation 3 and `CURRENT_INPUT.attachments: string[]` remain unchanged. The latter
is populated by the Core Runtime resolver, not by this public history projection.

## v1.52：按需进入维护

Active `camps.enter` 先做只读 command receipt lookup 和当前 Default Lead 有效性检查。有原结果仍按原
Envelope 回放（包括拒绝与 digest conflict）；新 User enter 且 Lead 仍为 present、active、无 leave intent
时不提交 reconcile，不制造 `default_lead_unchanged` receipt。需要修复或 actor 不合格时保持原 Gateway
语义。直接调用 `camps.reconcileDefaultLead` 的幂等、结果与审计不变。

业务 `camps.open` 仍不读取 event_log。Navigation 的历史排序与完成游标仍依赖真实 publication/terminal
事件，但聚合前过滤其他事件；不能把维护 receipt 当作业务活动，也不能删除现有事件来优化读取。

## References

- [Camp Attachment v8](camp-attachment-v8.md)
- [File Preview v5](file-preview-v5.md)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
