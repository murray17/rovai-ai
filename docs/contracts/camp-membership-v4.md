---
document_type: protocol-contract
contract: camp-membership-v4
authority: current-thread-membership-removal
status: accepted
version: 4
source_version: v1.72
last_updated: 2026-11-23
---

# Camp Membership v4

继承 [v3](camp-membership-v3.md) 的命令字段、权限、队长交接和事务结算。本版调整当前会话移出队员时，确认窗口如何取得提交所需的版本号。

- 打开确认窗口时，固定用户所选的 Thread、队员、名册版本和这次入队的成员版本。
- 影响详情可读时，展示实际影响。只有同一 Thread、队员及成员版本的可移出预览可以用于提交，名册版本和候选队长取自该预览。
- 影响详情读取失败时，使用打开窗口时的名册版本和成员版本。不指定继任队长，由 Core 在提交事务中按既有规则选定。此时只说明一般后果，不显示估算数量。
- 明确返回空结果或不可移出时禁止提交。用户关闭窗口或另选队员后，迟到的读取结果失效。
- 提交仍由 Core 检查权限、名册版本、成员版本和当前成员状态。冲突时刷新名单，由用户重新选择和确认。移出成功后刷新会话。

全局永久移除继续遵循 [v3 的永久移除预览与提交](camp-membership-v3.md#永久移除预览与提交)。
