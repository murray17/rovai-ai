---
document_type: protocol-contract
contract: camp-permanent-deletion-v3
authority: camp-deletion-terminal-before-runtime-cleanup
status: accepted
version: 3
source_version: v1.37
last_updated: 2026-09-01
---

# Camp Permanent Deletion v3

继承 [v2](camp-permanent-deletion-v2.md) 的 User/exact-version authority、blocker、删除事务、附件 gate/journal、
受管目录 identity 和幂等 replay。仅改变 force 删除的执行收尾顺序。

先验证 Camp exact version，再以统一 abortive settlement 在事务内结束活跃 Turn、Run 与渠道义务，随后按捕获的
Run/epoch 并行、有界清理 Runtime，再进入原 Camp Fleet fence、attachment gate 和聚合删除。未确认旧 launch/进程
已停止时保留 Camp 并返回失败；已提交的业务终态不回滚成 active，也不等待领域 cancellation ACK。

成功删除后的 callback 不能重建 Camp。非 force 删除与外部文件、Managed Blob、其他 Camp 的保护边界完全不变。
