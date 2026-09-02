---
document_type: protocol-contract
contract: dingtalk-channel-v10
authority: dingtalk-channel-account-provisioning-admission-delivery
status: accepted
version: 10
source_version: v1.37
last_updated: 2026-09-02
---

# DingTalk Channel v10 Contract

继承 [DingTalk Channel v9](dingtalk-channel-v9.md) 的 exact Stream App、opaque ID、群路由、通用 AI Card
callback、私聊 Quick Chat、普通群准入、三入口执行卡、最近输出和欢迎卡边界。本版为 AI Card 增加明确的
更新/撤回双身份，并让执行卡与排队卡使用钉钉 Robot OpenAPI 真实撤回；不新增 Migration，不保留以更新结束
文案代替撤回的分支。

## 1. AI Card 双身份

`/v1.0/card/instances/deliver` 必须返回且只返回一个成功 result，并包含非空 `carrierId`。Host 将两个 Provider
身份分开使用：

| 身份 | 用途 | Core 投影 |
| --- | --- | --- |
| 稳定 `outTrackId` | `updateCard`、卡片 callback 鉴权与 execution console 当前消息身份 | `execution_console.external_message_id` |
| 投递返回的 `carrierId` | Robot message recall 的 `processQueryKey` | 初次执行卡或排队卡 sent delivery 的 `external_delivery_message_id` |

`channels.dingtalk.deliveries.settle` 因而分别提交 `externalUpdateMessageId` 与
`externalDeliveryMessageId`。后续 execution upsert 只更新前者；Core 在 recall claim 中从同一 console 最近一次
成功且拥有撤回身份的初次 upsert 读取 `recallMessageId`。排队卡 recall 从同一 request 的成功 queue ack 读取该字段，
其 `updateMessageId` 必须为空，不得把 carrier 当成 outTrack。飞书继续使用单一消息身份，claim 不暴露钉钉
`recallMessageId`。

缺少 `carrierId`、投递 result 非成功、result 数量异常或 recall claim 缺少撤回身份均 fail closed；不得把
`outTrackId` 猜作 `processQueryKey`。

## 2. 执行卡与排队卡真实撤回

下一条 root request admission 后，`execution_console_recall` 按 conversation kind 调用：

- 群聊：`POST /v1.0/robot/groupMessages/recall`，携带 `openConversationId`、`robotCode` 和
  `processQueryKeys=[carrierId]`；
- 私聊：`POST /v1.0/robot/otoMessages/batchRecall`，携带 `robotCode` 和
  `processQueryKeys=[carrierId]`。

响应必须没有 `failedResult` 项，且 `successResult` 明确包含请求的 `carrierId`，否则 delivery 不能结算 sent。
成功后撤销对应的内存执行台 URL grant，并删除该 Run 的 Main 卡片状态；不再把原卡更新为“此执行记录已结束”。

只有真正进入 FIFO 的请求发送排队 AI Card。该请求 admission 后，Core 产生 queue ack recall，Host 使用同一真实
Robot recall；不把排队卡更新成“已开始”或“状态已结束”。AI Card 创建失败时，既有 Markdown 降级返回的
`processQueryKey` 仍是该次实际投递的撤回身份，不伪造卡片成功。

运行中的钉钉执行卡继续显示“显示最近输出 / 打开执行台 / 停止执行”，其中停止是 App-scoped Owner callback，
只调用 exact-run Core cancel；终态移除停止入口。执行结束先显示终态，直到下一条 root request 入场才撤回；
真实撤回能力不改变永久 Markdown 输出、Topic/附件 gate 或直接多 Bot gate。

## 3. 验证边界

测试必须覆盖 AI Card 单一成功 result 与 `carrierId`、私聊/群聊 recall 的 endpoint 和 body、partial failure
拒绝、queue ack 保存并复用撤回身份、DingTalk queue recall 的 `updateMessageId=null`、execution recall 使用 carrier
而更新/callback 继续使用 outTrack，以及运行中/终态停止入口。还必须以连续两条请求证明第二条产生排队卡，入场时
同时产生排队卡和上一张执行卡的真实撤回。v9 的群目标、路由、通用 callback 与欢迎卡测试保持不变；真实桌面端/
手机端租户撤回仍单独验收。

## References

- [DingTalk Channel v9](dingtalk-channel-v9.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [渠道设置](../ui/components/channel-settings.md)
- [Feishu Channel v15](feishu-channel-v15.md)
- [V1.37-D15](../versions/v1.37/decisions.md#v1-37-d15)
