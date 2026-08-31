---
document_type: protocol-contract
contract: channel-host-maintenance-v2
authority: channel-maintenance-targeted-cancellation-recovery
status: accepted
version: 2
source_version: v1.37
last_updated: 2026-09-01
---

# Channel Host Maintenance v2

继承 [v1](channel-host-maintenance-v1.md) 的封闭 tick 参数、Main Actor、单事务维护、无 poll receipt 和 FIFO 幂等。
只增加与 [Cancellation Settlement v1](cancellation-settlement-v1.md) 及 [Channel Storage v3](channel-storage-v3.md)
一致的两条规则：

- 一个已提交 queued request 在准入检查旧 active root 前，先定向收敛它所绑定 Camp 的旧半取消；普通 waiting 和
  其他 Camp 不变，不新增启动全库修复器。
- suppression 非空 Delivery 不因 lease 到期恢复 pending，也不能被 claim。原 attempt 的迟到 sent 仅记录证据。

正常 Outbox、roster、控制台、Provider pump 与真实业务命令的永久幂等保持不变。
