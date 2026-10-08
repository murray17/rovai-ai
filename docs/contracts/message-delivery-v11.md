---
document_type: protocol-contract
contract: message-delivery
version: 11
status: accepted
authority: public-message-delivery-route-reconciliation
source_version: v1.72
last_updated: 2026-10-08
---

# Message Delivery v11

继承 [v10](message-delivery-v10.md) 的唯一 FIFO lane、路由补建、领取、隔离和结算规则。
[AgentRun Continuation v1](agent-run-continuation-v1.md) 的用户授权请求复用 waiting Delivery：
系统操作消息负责排队位置，业务输入来自已选 Run 的完整 AgentRunInput 集合。

每次续做独立成批，普通消息合批停在续做请求之前；后续消息不能跨过请求合并。同一来源允许多次请求，
幂等限 commandId，不限 source Run。领取后请求只结算其新 Delivery，来源 Run／Delivery 不参与状态传播。
Migration 184 / schema 134 的专用约束允许同一续做 Delivery 对应同一新 Run 的多个原业务输入，
普通 Delivery 的单输入和所有 Delivery 的单 Run 归属保持。

The ordinary Scheduler remains the sole owner of batch claims and retains its fixed 30-second recovery
fallback. The inherited v9 clause retaining a separate 500ms maintenance task is superseded: non-batch Runs
now wake after committed input, terminal settlement, readiness or resource release; time-dependent duties use
their own effective deadlines. The legacy loop and its registration are removed. Non-batch preparation remains
independent of ordinary batch coordination and must not claim or dispatch ordinary batch work. See
[current execution drivers](../architecture/public-a2a-message-delivery.md) and
[shutdown ownership](../architecture/planned-shutdown.md).
