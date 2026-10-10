---
document_type: model-context-change
version: v1.72
revision: 3
confirmation_status: confirmed
confirmed_revision: 3
confirmed_by: local_user
confirmed_at: 2026-10-10
confirmation_message_id: e1936409-efce-4386-9fd9-77b2fea9270b
last_updated: 2026-10-10
---

# 续做操作退出公开消息 r3

User 已授权去除续做系统消息、PR 合入 main 并安装本机；随后明确已生成的记录不批量处理。
在看到空隐藏消息仍落库后，User 要求讨论不落消息的设计。Thread 已说明：内部持久授权／排队／原输入来源、
同一 FIFO 支持两种来源、不新增消息或消息序号；已创建 Run 和 RUN_INPUT 不加续做标记，
queued 计数／预览指向实际业务输入。User 在上述确认消息答复“没问题”，并确认复用现有消息锚点。
r3 记录这次明确的方案修订；不声称 User 此前阅读过本文件。

## 变更前

点击继续会保存并发布 system/run-continuation 消息，正文为
`你继续了爱丽丝的执行。`（强制新会话为 `你使用新会话继续了爱丽丝的执行。`）。
Desktop/Web 历史、thread.read 的 timeline/item/replyChain、thread.search 与 history.search 可见。
该消息不属于 RUN_INPUT，但会令 claim 的额外公共消息 EXISTS 为真。

只有原业务消息 m1 和续做记录时，本轮输入为：

```text
[RUN_FACTS]
{"attachmentOutputRoot":"/workspace/attachments/thread-example","historyHint":"The latest public message before your last recorded run in this Thread had sequence 1. As of this run's start, there are additional visible messages after that sequence beyond RUN_INPUT and messages written by you."}
[/RUN_FACTS]
[RUN_INPUT]
{"messages":[{"body":"检查导出流程","messageId":"m1","senderId":"local_user","senderType":"user","sequence":1,"mentions":[]}]}
[/RUN_INPUT]
```

## 变更后

相同输入及条件的完整两个 section：

```text
[RUN_FACTS]
{"attachmentOutputRoot":"/workspace/attachments/thread-example","historyHint":"The latest public message before your last recorded run in this Thread had sequence 1. As of this run's start, all visible messages after that sequence are already in RUN_INPUT or were written by you."}
[/RUN_FACTS]
[RUN_INPUT]
{"messages":[{"body":"检查导出流程","messageId":"m1","senderId":"local_user","senderType":"user","sequence":1,"mentions":[]}]}
[/RUN_INPUT]
```

不发布新的续做公屏消息，不向模型附加“继续”。新请求不产生任何 camp_message 行，不参与界面消息、
消息分页／定位／搜索、Agent 历史读取／搜索或额外消息判断。仍有其他可见消息时继续使用原来的 true 提示。
消息返回 shape、分页预算、withdrawn 占位与其他 system 消息均保留；已生成的公开续做记录也保留原样。
排队和新 Run 仍从原执行区观察；内部操作记录不作为业务输入或消息预览。

## 明确不变

Bootstrap、Charter、成员、Task、Skills、原业务输入集合、消息字段、预算和序列化模板保持。
Formatter/Manifest 33、Run Facts 9、Profile 10、Agent Output 10、CLI/Transport 36 保持；
这是内部操作退出公共读取集合，未增加字段或改变序列化与证据编码。
既有冻结 Manifest、Runtime 输入、工具回执和 Native Session 历史不重写、不清空、不补发。
幂等、FIFO、cleanup、会话选择、取消响应和多次独立续做沿用原合同。

## 排队返回与锚点

`thread.runs` 的输入、顶层和 item 字段保持。已创建 Run 继续从自己的 agent_run_input 计数并取首条预览；
无新增续做字段或来源 Run ID。待领取的 queued item 仍按 Thread／Agent 聚合，
messageCount 统计将要处理的业务输入次数：普通 Delivery 为 1，续做为来源 Run 的完整输入数量，
重复续做分别计数，不按 message ID 去重。messagePreview 使用队首请求的首条原业务消息，并沿用历史可见性门禁。
例如队列只有一个含 m1、m2 的续做请求时，唯一 queued item 的变化如下（其余字段逐字不变）：

```json
{"agentRunId":null,"agentId":"agent_1","status":"queued","messageCount":1,"messagePreview":null,"waitReason":null,"cancelRequestedAt":null,"createdAt":"2026-10-10T00:00:00Z","startedAt":null,"endedAt":null}
```

```json
{"agentRunId":null,"agentId":"agent_1","status":"queued","messageCount":2,"messagePreview":{"messageId":"m1","text":"检查导出流程","truncated":false},"waitReason":null,"cancelRequestedAt":null,"createdAt":"2026-10-10T00:00:00Z","startedAt":null,"endedAt":null}
```

Desktop waiting Delivery 保留 continuationRequest 批次边界，messageId 投影到首条业务消息，
可选 inputMessageIds 仅在续做时提供完整有序的原输入 ID，供既有计数／定位使用。
新 Run 仍使用原输入和既有 anchorMessageId 选择规则；用户锚点数量／顺序不变，around 与首条有效直接回复规则复用。

## 迁移与兼容

Migration 188 / schema 138 只调整内部队列结构：Delivery 明确 source_kind=message|continuation，
普通来源必须有 message_id，续做来源必须为空并由既有 camp_run_continuation 提供授权来源。
Camp 的 last_delivery_sequence 独立分配 FIFO 序号，不推进 last_message_sequence。
既有续做 Delivery 转换为内部来源；已生成的消息和原事件不删除、不隐藏、不改写索引。
原业务输入、原 Run、冻结 Manifest、Runtime 投递与旧命令回执原字节保留；新命令回执只有 threadId、deliveryId，
不再返回占位 messageId。已有幂等回执按原字节回放，不重新执行。
旧 Core 拒绝新 schema；不清空 Native Session，不执行 clean break，不增加第二套队列。

## 二次确认

移除公开消息与完整交付授权：35e8bd36-37f6-4e2e-9d54-82a6ca25db97。
保留已有记录：d37611df-603b-4a2e-9050-e5c6183b8305。
不落消息及单一队列方案公开答复：4182665a-09c3-4fe0-a056-4d4c305636b5。
Run／上下文不加标记、修正 queued 投影的公开答复：667ffa2e-a60c-4927-922a-fe8fdca300bd。
User 在 e1936409-efce-4386-9fd9-77b2fea9270b 答复“没问题”，并确认现有锚点可复用。

## 验证

扩展现有 delivery_queue 事务 owner，验证消息表和公共序号没有新增、公开历史／搜索／分页及额外消息判断不受续做影响，
普通消息及普通 system 消息仍可见，源输入与证据保持，重复点击、幂等、FIFO、cleanup 和重启仍成立。
同一 owner 复用两条 waiting 请求，并验证已有公开续做记录在重启后正文、可见性、版本和搜索结果不变；
必须用隔离 SQLite，纯函数无法覆盖 FTS 触发器与队列事务。
同时扩展既有 migration owner 验证结构迁移回滚、旧公开消息／冻结证据不变，
并扩展 thread_runs 与 UI owner 验证排队计数／预览和锚点复用。
最小命令为 cargo test -p rovai-core --features extended-tests --lib continuation。
同环境真实 Codex 续做专项验证记录为补充证据；通用语义 Judge Gate 的覆盖单独如实报告，
不能以确定性测试或专项 Runtime 测试冒充通用 Gate。
验证总预算 90 分钟；不改模型提示词、Case 评分或原生会话恢复规则。
