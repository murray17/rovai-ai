---
document_type: protocol-contract
contract: dingtalk-channel-v12
authority: dingtalk-channel-renderer-management-entry
status: accepted
version: 12
source_version: v1.38
last_updated: 2026-09-03
---

# DingTalk Channel v12 Contract

继承 [DingTalk Channel v11](dingtalk-channel-v11.md) 的账号、发布、入站聚合、卡片、永久输出、诊断、恢复和平台限制。
本版只解除 Renderer 的“敬请期待”管理门禁，不增加 Snapshot 字段、Migration、Provider 能力或远端权限。

## 1. Renderer 管理入口

`ChannelSettingsSnapshot.channels` 中的钉钉 Provider 与飞书使用同一可管理 Provider 路径：

- 渠道页不得再过滤 `kind=dingtalk`，也不得额外生成禁用的钉钉预告 Tab；
- Snapshot 中存在的每个 Provider 各生成一个可选择 Tab，显示真实 `displayName`、`hostStatus` 和连接状态；
- `selectedKind` 存在时选择 exact Provider；它不存在时回退到 Snapshot 中第一个 Provider。DingTalk-only Snapshot 不得再进入
  “当前版本没有可用的渠道”空状态；
- 选择钉钉后，Renderer 展示现有 typed Snapshot 中的连接账号、队员 Bot、发布状态与受控 `managementUrl`，并复用
  `connect / disconnect / publishMemberBot / retryMemberBot / selectPublicationApprover` 的 provider 参数；
- Renderer 仍不得接收或显示 Cookie、AppSecret、credential、access token、完整控制面响应、项目绝对路径或外部 identity。

钉钉 Tab 使用与飞书相同的原生 button/Tab、键盘焦点和 `aria-selected` 语义。`hostStatus != ready` 只禁用该 Provider 的连接与
发布动作，不把 Provider 重新解释为“敬请期待”。

## 2. 保留能力门禁

管理入口开放不改变 v11 的平台能力边界：话题、Managed 入站附件、出站附件、原生 A2A `@`、native reply、超长正文 durable
分片和逐 Command disclosure 仍保持明确 unsupported 或 summary-only。Owner、App、AgentRun、卡片、Outbox、项目选择和
conversation binding 继续由 Main/Core 的既有校验拥有；Renderer 可见或可点击不能替代授权。

桌面端或手机端仍未完成的真实租户矩阵作为 Provider 能力的后续验收，不再关闭整个 Renderer 管理入口。任何具体能力只有在
对应合同与真实平台证据成立后才能扩大，不能用已开放 Tab 绕过。

## 3. 验证边界

Renderer 自动测试必须覆盖双 Provider 都可选、钉钉连接状态与已保存 Bot 可见、DingTalk-only Snapshot 回退、Provider 数量、
无“敬请期待”或 `aria-disabled` 预告，以及秘密和项目绝对路径仍不泄露。类型检查、Renderer 全量测试和 packaged App 构建
继续是合入门禁；真实扫码、发布、私聊、群聊与手机卡片仍由独立真实租户验收拥有。

## References

- [DingTalk Channel v11](dingtalk-channel-v11.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [渠道设置](../ui/components/channel-settings.md)
- [V1.38-D02](../versions/v1.38/decisions.md#v1-38-d02)
