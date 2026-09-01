---
document_type: protocol-contract
contract: feishu-channel-v14
authority: feishu-channel-account-provisioning-admission-delivery
status: accepted
version: 14
source_version: v1.37
last_updated: 2026-09-01
---

# Feishu Channel v14 Contract

继承 [Feishu Channel v13](feishu-channel-v13.md) 的入站、Bot 发布、执行状态卡、最近输出、固定 LAN URL、Owner callback、
公开 Web 投影与恢复边界。本版只增加首次发布后的 Owner 欢迎卡；不新增 Migration，不改变已有 Bot 或执行卡。

## 1. 首次发布欢迎卡

新队员 Bot 完成 App identity 冻结、版本发布、长连接建立及 `publicationIntent=completed` 后，使用该 Bot 已确认的
`ownerOpenId` 主动发送一张私聊 Card 2.0：

```text
<队员名> · 已发布

我已经在这里就绪。你可以直接发消息给我；在群聊中使用时，请先把我加入群聊并 @我。
```

消息使用由 `publicationIntentId` 派生的稳定 provider `uuid`。发送是发布完成后的 best-effort 通知：失败只写脱敏诊断，
不得回滚 Bot、把 completed 改成 failed、创建第二个应用或阻止渠道页显示已发布。已经 completed 的 Bot 启动恢复、凭据恢复、
连接核对或重新启用不得补发欢迎卡；不建立单独欢迎消息 Outbox 或数据库状态机。

## 2. 验证边界

测试必须证明首次完成向 exact `ownerOpenId` 发送 interactive card，标题与正文使用队员身份，`uuid` 稳定且不包含明文凭据；
欢迎卡失败不改变 completed publication，completed 恢复不重复投递。v13 的最近输出预算、Token 与授权测试保持不变。

## References

- [Feishu Channel v13](feishu-channel-v13.md)
- [飞书渠道架构](../architecture/feishu-channel.md)
- [渠道设置](../ui/components/channel-settings.md)
- [DingTalk Channel v8](dingtalk-channel-v8.md)
- [V1.37-D11](../versions/v1.37/decisions.md#v1-37-d11)
