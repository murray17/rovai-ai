---
document_type: protocol-contract
contract: dingtalk-channel-v9
authority: dingtalk-channel-account-provisioning-admission-delivery
status: accepted
version: 9
source_version: v1.37
last_updated: 2026-09-02
---

# DingTalk Channel v9 Contract

继承 [DingTalk Channel v8](dingtalk-channel-v8.md) 的 Web Session、独立 Bot 发布、私聊 Quick Chat、项目卡、
三入口执行卡、紧凑 command、Owner callback、首次发布欢迎卡与恢复边界。本版纠正普通群 receiving Bot 的证明：
不再比较 provider 的两个 opaque 用户 ID；不新增 Migration，不接入 Topic。

## 1. 普通群 Bot 目标证明

每个已发布 Bot 使用自己的 `appKey/appSecret` 建立独立 Stream client。Robot callback 只从该 credential-bound client
进入对应 App 的 handler；若 callback 携带 `robotCode`，它还必须与该 App 的冻结 `robotCode` 或 `appKey` 匹配。
普通群在此 exact receiving App 事实之外必须满足 `isInAtList=true`，才进入 3 秒观察窗。

`chatbotUserId` 是 provider 声明可忽略的 opaque 机器人 ID，`atUsers` 是本条消息的 mention 元数据；真实 Stream callback
可能对二者使用不同编码。因此它们继续做有界 shape 归一化，但不得要求
`chatbotUserId === atUsers[].dingtalkId`，也不得从 `atUsers[].staffId/dingtalkId` 推导 Agent target。

同一 external message 若被多个已发布 Rovai App 的独立 Stream 实际接收，仍按 3 秒窗口得到多 App 事实并整条
fail closed。普通私聊不依赖 `isInAtList`、`chatbotUserId` 或 `atUsers`，继续按 receiving App 直接创建或复用
Quick Chat；精确 `/new` 语义不变。

## 2. 其余行为

首次发布欢迎卡、群 roster reconcile、Owner-only admission、项目或 Quick Chat 首次绑定、FIFO/Outbox、执行状态卡、
LAN 只读执行台、最近输出与 exact-run 停止全部继承 v8，不因本次目标证明修正而扩大。

## 3. 验证边界

测试必须覆盖 `isInAtList=true` 且 `chatbotUserId` 与 `atUsers[].dingtalkId` 不同的真实 callback 形状，并证明它由
exact Stream App 接受；`isInAtList=false` 的群消息、callback `robotCode` 不匹配、同消息多个 receiving App 继续
fail closed。私聊回归、群 roster 与首次项目卡不得退化。

## References

- [DingTalk Channel v8](dingtalk-channel-v8.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [V1.37-D12](../versions/v1.37/decisions.md#v1-37-d12)
