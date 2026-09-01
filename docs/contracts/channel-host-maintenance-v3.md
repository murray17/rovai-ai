---
document_type: protocol-contract
contract: channel-host-maintenance-v3
authority: channel-maintenance-cancelled-run-recovery
status: accepted
version: 3
source_version: v1.37
last_updated: 2026-09-01
---

# Channel Host Maintenance v3

继承 [v2](channel-host-maintenance-v2.md) 的封闭 tick、Main Actor、目标 Camp 半取消修复、无 poll receipt、FIFO、
suppression 和迟到 sent 规则。目标 Camp 修复改用
[Cancellation Settlement v2](cancellation-settlement-v2.md)：被取消 Run 公开为 cancelled，保留底层投递证据，
不生成外部效果待确认提示。

普通 waiting/recovery、其他 Camp、正常 Outbox/Provider pump、真实业务命令幂等和
[Channel Storage v3](channel-storage-v3.md) 的整轮 retry suppression 均不改变。
