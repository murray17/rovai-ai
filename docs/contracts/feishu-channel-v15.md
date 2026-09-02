---
document_type: protocol-contract
contract: feishu-channel-v15
authority: feishu-channel-account-provisioning-admission-delivery
status: accepted
version: 15
source_version: v1.37
last_updated: 2026-09-02
---

# Feishu Channel v15 Contract

继承 [Feishu Channel v14](feishu-channel-v14.md) 的入站、Bot 发布、执行状态、最近输出、固定 LAN URL、
Owner callback、欢迎卡和恢复边界。本版只修订执行卡动作的视觉层级与窄端排列；不新增 Migration，
不保留旧动作布局分支。

## 1. 动作层级

执行卡继续按“显示最近输出 / 打开执行台 / 停止执行”的顺序呈现三个入口。“打开执行台”使用 Card 2.0
`primary` 按钮，作为唯一蓝色主动作；“显示最近输出”保持默认样式，“停止执行”保持危险样式。终态仍移除
“停止执行”，没有可用执行台 URL 时仍省略“打开执行台”。

动作按钮均使用 `width=fill`。承载按钮的 `column_set` 使用 `flex_mode=stretch`，每个 `column` 保持相同
`weight`：宽端同行等宽排列，手机或其他窄端由飞书客户端把列伸展为独占整行的纵向按钮。Host 不读取 User-Agent、
不维护桌面/手机两套卡片，也不通过缩短按钮文案解决窄端问题。

最近输出继续继承 v13：安全 Command 使用默认收起的原生折叠面板，结果最多两行，超长 Command 保留首尾；
本版按钮调整不得把该区域退回平铺文本。

## 2. 验证边界

测试必须证明非终态卡的三个按钮顺序不变，“打开执行台”为 `primary` 且继续使用直接 `open_url`，列容器为
`flex_mode=stretch`，所有按钮和列均保持填充/等权布局；终态无停止入口。v14 的欢迎卡和 v13 的最近输出折叠、
预算、Token、Owner callback 与授权测试保持不变。

## References

- [Feishu Channel v14](feishu-channel-v14.md)
- [飞书渠道架构](../architecture/feishu-channel.md)
- [渠道设置](../ui/components/channel-settings.md)
- [DingTalk Channel v10](dingtalk-channel-v10.md)
