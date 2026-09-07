---
document_type: protocol-contract
contract: camp-open-projection-v17
authority: camp-open-public-approval-projection
status: accepted
version: 17
source_version: v1.54
last_updated: 2026-09-07
---

# Camp Open Projection v17

继承 [v16](camp-open-projection-v16.md) 全部 wire shape、读取与图片准入规则。公共 Camp Snapshot / Open
的 `approvals` 及对应 coverage 总数排除 `conversation.kind = single_chat` 的审批；私有审批只由精确 Single Chat Snapshot
返回，见 [Single Chat v3](single-chat-v3.md)。Open schema 6、Snapshot 34 不变。
