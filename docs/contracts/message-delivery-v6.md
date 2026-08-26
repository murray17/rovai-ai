---
document_type: protocol-contract
contract: message-delivery-v6
authority: message-delivery-lifecycle
status: accepted
version: 6
last_updated: 2026-08-26
---

# Message Delivery v6 Contract

v6 replaces [v5](message-delivery-v5.md). Its closed delivery union, FIFO, attempts, projection gate, wait conditions,
retry/cancel and settlement remain. Every newly admitted recipient Delivery additionally freezes:

```text
recipientMembershipVersionAtAdmission: integer >= 1
```

Dispatch, materialization and explicit retry require that the recipient is present and has an active Camp membership
whose exact version equals the frozen value. Absence, leave or a later ordinary add with a new version cannot be treated
as temporary readiness; the old Delivery settles terminally with the membership fence reason, and retry cannot revive it.

普通 `public_a2a`（非 Gather）还绑定 source AgentRun 冻结的 `campMemberVersion`。Source version 可从
`sourceAgentRunId` 的 immutable effective config 取得，不增加重复的 Delivery 字段。Source member 离开或进入
新的 membership lifetime 后：

- remove cutover 以 `source_membership_ended` 终态化尚未 materialize 的 outbound Delivery；
- 已 materialized 的 target Run 纳入同一 membership reconciliation 并请求取消；
- dispatch/materialization 以 `source_membership_changed` fail closed；
- explicit retry 拒绝为 `message_delivery.source_membership_changed`。

Source Run 的 frozen peer projection 不是 target admission roster。一个仍处于有效 membership lifetime 的旧 Run
可以在新 send 时寻址后来加入的当前 active member；这不会修改旧 Run 的 Context。Source fence 只阻止已结束
lifetime 的既有 Delivery 继续产生新工作。Gather 继续由 [Gather v4](gather-v4.md)的 initiator/item/completion
lifetime 规则拥有，不从普通 outbound source fence 推导。

Terminal evidence may settle an already running attempt through the narrow terminal path, but any public output from
that Run remains subject to [Missing-Send Recovery Publication v2](missing-send-recovery-publication-v2.md) and the
general publication fence.

## References

- [Message Delivery v5](message-delivery-v5.md)
- [Camp Membership v1](camp-membership-v1.md)
- [Public A2A architecture](../architecture/public-a2a-message-delivery.md)
