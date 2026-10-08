---
document_type: protocol-contract
contract: agent-run-continuation-v1
authority: user-authorized-independent-run-continuation
status: accepted
version: 1
source_version: v1.72
last_updated: 2026-10-08
---

# AgentRun Continuation v1

## 用户授权

Desktop 与已认证 Web User 调用 `agentRuns.continue`：

```json
{"commandId":"request-uuid","command":{"threadId":"rvcamp_…","agentRunId":"source-run","useNewSession":false}}
```

`useNewSession` 可省略，默认 false；闭合输入不接收其他字段。只允许 User，Agent Built-in Tool 无入口。
Core 复用命令网关，幂等键为 commandId 与原请求摘要。同一请求重传返回同一结果；同一来源 Run 可以提交多个
不同请求，不限制后继数量，不改变来源 Run 的状态、版本、结束时间、输入或 Runtime 接受记录。

本期来源为公开 Thread 的 batch Run，状态为 failed/cancelled 且具有完整 AgentRunInput。Conversation 为
当前有效 camp_member 路由，Thread 未删除，成员在场且未离队；原消息存在、未撤回且摘要仍匹配。
明确绑定的 Task 不得已完成、取消或改派，所属 Mission 不得已完成。Core 不分析自然语言职责或对业务交付评分。

## 持久化、排队与领取

一次事务提交系统操作消息、waiting Delivery、不可变内部来源记录和命令回执。系统记录为 system 作者、
public_only，不伪造用户消息，不添加 Composer 内容。来源 ID 只用于内部范围定位，不注入模型，也不投影状态链。
Applied 回执 code 为 `agent_run.continuation_requested`，payload 为 `{threadId, deliveryId, messageId}`。

复用现有 `(Thread, Agent)` lane 和调度器，按入队顺序等待；不抢占、不提前创建 Run。普通消息合批不得跨越
续做请求；每个续做请求完整、有序地选择来源 Run 的业务输入集合，单独形成一次新 Run。超过 payload 上限时
完整创建失败执行，不截成多个 Run。清理／executionRoot 隔离未确认时保持 waiting，换 Native Session 不越过门禁。

领取时重验可见消息与当前成员／业务关联，失效请求结算为 cancelled，failureCode 为
`agent_run.continuation_unavailable`；同一事务记录取消事件，刷新现有快照，并继续检查后面的输入。
当前 Runtime 和工作区沿正常 claim 逻辑冻结。原 Run 不是回滚点；
不重开 CampTurn，不自动恢复 Task/Mission/Automation，不重启其他成员。

## 输入与会话

新授权引用原业务消息正文、引用、附件和 Skill，使用现有 builder 构建当前 Tasks、成员职责、RUN_FACTS。
不复用完整旧 prompt，不复制旧 Delivery/Manifest/接受记录，不追加证据、产物、恢复计划、CLI 教学或“继续”句子。
Formatter / ContextManifest 32、公开 Run Facts 9、Delivery Profile 10 的模型字段保持不变。

兼容且安全时沿用 Conversation 当前 Native Session。已知不兼容或已接受但 native turn 结果未确认时，未授权
换会话的请求拒绝为 `agent_run.new_session_confirmation_required`；前端一次确认后以新命令提交
`useNewSession: true`。若排队中兼容性变化，领取时产生明确失败 Run，用户可再次选择新会话。

实际 Native Session 恢复失败时，续做 Run 失败，公开错误为 `continuation_session_unavailable`；
不得在同一次续做内隐式创建空会话再次投递。恢复失败记录用于下次新会话确认；若之后同一 Conversation
当前绑定／会话已有可信的原生成功完成记录，旧失败不再强制换会话。完成记录必须与已接受输入的
binding ID、generation、execution epoch 和 native turn ID 匹配，先后以事件序列为准；仅接受输入、
其他绑定的成功或发生在失败之前的成功均不足。历史事件保留不改写。
明确换会话只清理当前 Conversation 绑定，保留当前工作区、历史和业务状态。
本能力不承诺业务效果恰好发生一次，也不新增效果对账系统。

## 错误与 UI

越权为 `agent_run.continue_user_required`，Thread 不匹配为 `agent_run.camp_mismatch`，来源失效为
`agent_run.continuation_unavailable`；输入不合 schema 或 commandId 摘要冲突沿现有命令网关处理。
拒绝不占用“来源的重试机会”，新的明确点击可使用新的 commandId。

原卡片提供 24×24 图标，title/aria-label 为“继续执行”；提交中禁用，受理后恢复可点击。响应未确认时保留
原 commandId，再点击核对同一请求。原 Run 不显示新 Run 状态；请求／新 Run 在现有执行区独立显示，
无“已继续”替换、后继链接或执行链聚合。

waiting Delivery 读模型可携带 `continuationRequest: true`；普通／历史 Delivery 省略该字段。
共享 UI 按此字段保持排队批次边界。创建、结算及失效沿既有快照／事件通道刷新。

## 存储升级

Migration 184 将 v1.72/schema 133 增量升级为 schema 134。内部 `camp_run_continuation` 绑定新 Delivery
及来源 Run、会话选择，不是一套队列。AgentRunInput 允许同一续做 Delivery 在同一新 Run 中承载多个原消息；
普通 Delivery 仍限一个输入，同一 Delivery 不得跨 Run。旧输入、Manifest、Runtime 回执和接受事实原样保留。

参见 [Accepted Input Recovery v7](accepted-input-recovery-v7.md)、[Message Delivery v11](message-delivery-v11.md)
与 [AgentRun Recovery](../architecture/agent-run-recovery.md)。
