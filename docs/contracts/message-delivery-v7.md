---
document_type: protocol-contract
contract: message-delivery-v7
authority: message-delivery-lifecycle
status: accepted
version: 7
last_updated: 2026-08-26
---

# Message Delivery v7 Contract

v7 replaces [v6](message-delivery-v6.md). The membership-lifetime fence, closed delivery union, FIFO, attempts,
projection gate, wait conditions, retry and settlement remain. v7 makes cancellation a monotonic terminal transition
for both zero-attempt and attempted Deliveries.

## Membership lifetime

Every newly admitted recipient Delivery freezes:

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

## Cancellation state

The following terminal state is valid even though no dispatch attempt exists:

```text
status = cancelled
dispatchPhase = terminal
dispatchAttemptCount = 0
endedAt = <required timestamp>
failureCode = <explicit cancellation reason>
```

Cancellation never creates a synthetic attempt. A `pending` Delivery in `never_attempted` or `projection_blocked`, and
an `interrupted_before_dispatch` Delivery, can become `cancelled / terminal` while retaining attempt count 0. If at
least one attempt already exists, cancellation preserves the positive count. The current `attempting` or `waiting`
attempt, when present, becomes `cancelled`, clears its wait condition and records its terminal timestamp and reason.

Explicit Delivery cancellation and CampTurn/budget bulk cancellation use the same low-level transition. That transition
atomically clears:

- `waitCondition`;
- `activeDispatchAttemptId`;
- `preDispatchGate`;
- `projectionOperationId`;
- stale failure detail and manual-intervention state.

It writes the cancellation reason, `endedAt`, a new Delivery version and the cancellation event in the same transaction.
Explicit and bulk entry points may keep their own authorization, membership and aggregate settlement policy; they cannot
implement a second Delivery state mutation.

## Projection and restart monotonicity

Attachment projection success and failure may mutate their own publication records after a cancellation race, but they
can release or fail only a Delivery that is still `pending`, still owns the matching projection operation and still has
attempt count 0. Cancellation removes that association. A late success, late terminal failure, ordinary Dispatch Pump
event or startup recovery therefore cannot change a cancelled Delivery or create an AgentRun for it.

Startup recovery may classify only eligible nonterminal rows. `cancelled / terminal` is durable across restart and is
never rewritten to `pending` or `interrupted_before_dispatch`.

## Required regression boundaries

Tests cover the real `projection_blocked` CampTurn Stop call chain, pending zero-attempt explicit and bulk cancellation,
`interrupted_before_dispatch -> cancelled`, attempted cancellation, late projection success and failure, restart
monotonicity, and direct upgrade from the v1.23/schema-64 Migration-110 database. These tests do not depend on a future
attachment storage schema or compatibility reconciler.

## References

- [Message Delivery v6](message-delivery-v6.md)
- [Camp Membership v1](camp-membership-v1.md)
- [Camp Published Attachment View v4](camp-published-attachment-view-v4.md)
- [Public A2A architecture](../architecture/public-a2a-message-delivery.md)
- [V1.29-D05](../versions/v1.29/decisions.md#v1-29-d05)
