---
document_type: protocol-contract
contract: dingtalk-channel-v8
authority: dingtalk-channel-account-provisioning-admission-delivery
status: accepted
version: 8
source_version: v1.37
last_updated: 2026-09-01
---

# DingTalk Channel v8 Contract

继承 [DingTalk Channel v7](dingtalk-channel-v7.md) 的 Web Session、独立 Bot 发布、普通群准入、私聊 Quick Chat、项目卡、
三入口执行卡、紧凑 command、Owner callback 与恢复边界。本版修正普通群的 Bot 目标证明，并增加首次发布后的 Owner
欢迎卡；不新增 Migration，不接入 Topic。

## 1. 普通群 Bot 目标证明

Stream Robot callback 的 receiving Bot 身份使用 provider 字段 `chatbotUserId`；它必须出现在 `atUsers[].dingtalkId`，
并同时满足 `isInAtList=true`。不得再用“`atUsers` 恰好只有一项”代替 Bot identity：用户可以在同一消息中同时 @Bot 和
普通成员，普通成员不增加 Rovai target，也不导致消息静默丢弃。

同一 external message 若被多个已发布 Rovai App 的独立 Stream 实际接收，仍按 3 秒窗口得到多 App 事实并 fail closed；
不得从普通成员的 `staffId/dingtalkId` 推导 Agent。缺少 `chatbotUserId`、Bot identity 不在 `atUsers` 或未明确 @Bot 的群消息
继续拒绝。普通私聊不依赖该字段，继续按 receiving App 直接创建或复用 Quick Chat；不显示项目选择卡，精确 `/new` 语义不变。

## 2. 首次发布欢迎卡

新队员 Bot 完成版本、Stream、AI Card 验证并持久进入 `publicationIntent=completed` 后，使用发布时确认的 Owner `userId`
主动发送一张私聊 AI Card：

```text
<队员名> · 已发布

我已经在这里就绪。你可以直接发消息给我；在群聊中使用时，请先把我加入群聊并 @我。
```

`outTrackId` 由 `publicationIntentId` 稳定派生。发送失败只写脱敏诊断，不回滚 completed publication、不重建 App；已 completed
Bot 的启动、凭据恢复与连接核对不补发，不增加欢迎消息 Outbox 或持久状态机。

## 3. 验证边界

测试必须覆盖带 Bot 与普通成员两项 `atUsers` 的真实 callback 形状、Bot identity 缺失/不匹配的 fail-closed、私聊继续直接
Quick Chat、群首次项目选择，以及首次完成向 exact Owner 投递稳定 `outTrackId` 的欢迎卡。v7 的 command/result 与执行入口
测试保持不变。

## References

- [DingTalk Channel v7](dingtalk-channel-v7.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [渠道设置](../ui/components/channel-settings.md)
- [Feishu Channel v14](feishu-channel-v14.md)
- [V1.37-D11](../versions/v1.37/decisions.md#v1-37-d11)
