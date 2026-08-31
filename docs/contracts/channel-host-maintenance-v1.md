---
document_type: protocol-contract
contract: channel-host-maintenance-v1
authority: channel-host-maintenance-transaction-and-poll-recovery
status: accepted
version: 1
last_updated: 2026-08-31
---

# Channel Host Maintenance v1

本合同拥有飞书、钉钉共享的内部维护接口。账号、Bot、Owner、项目、入站与永久输出继续由各 Provider 合同拥有；
本次只移除把每次 Host 唤醒保存为永久领域命令回执的实现，不改变业务 admission、Outbox 或真实领域命令的幂等性。

## 1. 封闭维护接口

`channels.host.tick` 与 `channels.dingtalk.host.tick` 仅供 Main Host 调用，Core 按方法名固定对应 System Actor。
它们使用相同的强类型 `ChannelHostTickRequest`，不是 `DomainCommand`，不接受 `commandId/command` Envelope、
客户端 Actor 或其他未知字段：

```json
{ "workerId": "host-worker", "limit": 20 }
```

`workerId` 不得为空白，`limit` 缺省为 20，范围为 1–100。响应直接返回：

```json
{ "deliveries": [], "rosterRefreshes": [] }
```

delivery 和 roster refresh 的内容与既有 Provider 合同一致；钉钉的 `rosterRefreshes` 为空。此响应不是
`StoredCommandResult`，不带 command identity、status、code 或 replay 语义。非法参数、非受信 Actor 或基础设施错误
直接拒绝本次维护调用，不追加永久回执，也不把失败伪装成空列表。

## 2. 事务与业务事实

一次 tick 在 Core 单个 IMMEDIATE SQLite 写事务中执行现有的超时收口、项目卡恢复、执行台/输出投影、终态请求结算、
FIFO 提升和 delivery 领取；任何步骤失败整笔回滚。空响应不等于没有维护副作用，不能根据 deliveries 是否为空决定提交。

所有 tick，包括实际领取 delivery 或推进队列的 tick，都不向 `event_log` 写 `channel_host.tick` 命令结果。
既有 DomainCommandGateway 不增加跳过日志的通用开关。用户意图仍由原入站/项目绑定等命令形成持久 ChannelTurnRequest；
维护接口不接收新的消息正文、项目路径或执行目标，只推进已经提交的工作。

FIFO 提升仍调用统一 `CollaborationService` admission。检查 queued/head/无 active root、创建 CampMessage/CampTurn/Run、
真实领域审计事件和 request 状态推进在同一事务中完成。维护发起的 admission 使用由持久 request ID 派生的稳定审计关联，
不再关联随机 poll ID。重复唤醒不能重复准入；运行中的冻结执行上下文、roster gate、附件/正文顺序和控制台 recall 均不变。

## 3. 响应丢失与恢复

delivery 的持久 status、lease owner、lease expiry、attempt count 和 dedupe key 继续拥有恢复事实：

- 领取后但响应丢失：原 delivery 保持 attempting；后续 poll 不重放旧响应，也不能在 lease 有效期内再次领取；
- lease 到期：按既有策略回到 pending，领取同一个 delivery ID 并增加 attempt，不创建第二条 delivery；
- 旧 worker 不能结算新 worker 的 lease；实际 `channel_delivery.settle` 仍是永久、可幂等 replay 的领域命令；
- 外部发送仍使用 Provider 的既有去重能力与失败策略，不因取消 poll 回执而宣称远端 exactly-once；
- Core/Main 重启从持久 request、delivery 和 roster 等对象恢复，不依赖历史 poll 回执或 Renderer 缓存。

Main 保留原有串行 pump、定时器、roster 优先顺序和错误处理，不新增并行投递或网络重试。本次不更改轮询频率。

## 4. 历史与验证

历史 `channel_host.tick` 记录保持原样；本合同不授权删除旧 event、执行 Evidence、凭据或 Session，也不执行 VACUUM。
delta 存储与数据库备份/复制策略不在本次范围内。

Core 维护接口测试拥有零回执/零空闲行写入、封闭参数和 Actor 拒绝；既有 FIFO fixture 扩展覆盖事务失败回滚、丢失响应后的
同 delivery lease 恢复、真实结算 replay 和下一根只准入一次。现有 Topic roster、超时、项目卡和执行台测试继续覆盖其语义。
Main 测试只验证两种 Host 发送直接参数并消费直接响应，不复制 Core 状态机。

## References

- [Core 权威写入与幂等事务](../architecture/foundational-invariants.md#core-command-transaction)
- [飞书渠道架构](../architecture/feishu-channel.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [v1.36 实施记录](../versions/v1.36/implementation-plan.md)
