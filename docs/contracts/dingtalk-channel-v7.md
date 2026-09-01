---
document_type: protocol-contract
contract: dingtalk-channel-v7
authority: dingtalk-channel-account-provisioning-admission-delivery
status: accepted
version: 7
last_updated: 2026-09-01
---

# DingTalk Channel v7 Contract

继承 [DingTalk Channel v6](dingtalk-channel-v6.md) 的渠道范围、Web Session、Bot 发布、普通群准入、项目/Quick Chat、
三入口状态卡、固定 LAN URL、Owner callback、公开 Web 投影、恢复与真实验收边界。本版只修订最近输出的 command 标签
和新发布 Bot 的默认描述前缀；不新增 Migration。

## 1. 最近输出 command

“显示最近输出”仍展开最多最后 30 个 Agent 公开正文与安全 command，并继续使用钉钉内置 AI 模板的单个
`staticMsgContent` 区域。钉钉不模拟逐 command 折叠，也不展示 command result、结果占位、逐条统计或分页。

安全 shell command 统一显示为 `状态符号 + $ <safe-command>`；`apply_patch` 等没有可公开 shell command 的操作只显示
安全工具标题。标签与飞书共用约 72 个终端显示列的预览规则：先做整条 Run 的敏感值清理，再保留开头和目标尾部，中间
插入省略号。完整安全 command 和公开 result 仍只在 Web 执行台中查看。

## 2. 队员 Bot 描述

新建钉钉队员应用的默认描述与飞书统一为：

```text
Rovai AI Teammate · <teamRole 或 协作者>
```

钉钉控制台仍可按既有字符白名单把中点规范化为空格。该变化只作用于后续新建应用；已发布 Bot、冻结 App identity 和
completed credential 恢复均不得为了更新描述而重建或修改远端应用。

## 3. 兼容与验证边界

执行卡按钮、Owner 鉴权、fixed URL、SSE、Token、Topic/附件/多 Bot gate 及永久 Markdown 输出保持 v6 不变。测试必须
证明长 command 有 `$`、首尾与省略号，同时 `staticMsgContent` 不包含公开或原始 command result；Bot publication 使用
统一前缀且 completed 恢复仍保持只读。

## References

- [DingTalk Channel v6](dingtalk-channel-v6.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [渠道设置](../ui/components/channel-settings.md)
- [Feishu Channel v13](feishu-channel-v13.md)
- [V1.37-D10](../versions/v1.37/decisions.md#v1-37-d10)
