---
document_type: protocol-contract
contract: feishu-channel-v13
authority: feishu-channel-execution-card-and-lan-readonly-view
status: accepted
version: 13
source_version: v1.37
last_updated: 2026-09-01
---

# Feishu Channel v13 Contract

继承 [Feishu Channel v12](feishu-channel-v12.md) 的入站规范化、执行卡状态入口、固定 `open_url`、全局 LAN HTTP
服务、内存 Token、授权 scope、Owner callback、设置默认值、已发布 Bot listener 门槛和恢复边界。本版只修订执行卡
“最近输出”的 command 呈现；Web 执行台、永久正文卡、端口、Token 和 Core 授权不变。不新增 Migration。

## 1. 最近输出结构

“显示最近输出”仍是 Owner callback，展开后按真实顺序读取最后 30 个 Agent 公开正文或安全 command。公开正文继续使用
普通 Markdown；每条 command 改用 Card 2.0 原生 `collapsible_panel`，默认 `expanded=false`，不新增逐条 callback、分页或
持久展示状态。整个最近输出仍是群卡内容；Owner 展开卡片后，能够看到该群卡的人可以看到其中的公开投影。

command 标题使用状态符号和 Shell 提示符：有公开 shell command 时显示 `$ <safe-command>`；`apply_patch` 等没有可公开
shell command 的操作只显示安全工具标题。标题先经过整条 Run 的既有 redactor，再按约 72 个终端显示列截断，保留开头
与目标尾部并在中间插入省略号。完整安全 command 只在 Web 执行台中保留。

## 2. 折叠结果

command 面板只消费既有 `publicResult`：它已经排除工具输入、隐藏推理、环境变量、原始 patch、结构化工具 envelope、
私有消息回显及其他不安全内容，并经过 Run 级敏感值清理。卡片不得从 `detail`、raw Evidence 或完整工具 payload 回退生成
结果。结果最多显示两个逻辑行，每行约 72 个显示列，超出部分用省略号表示；运行中尚无结果或终态无可展示结果时使用
明确占位。钉钉不消费该折叠结果投影。

## 3. 卡片预算与生命周期

最近输出先取最后 30 个逻辑项，再受 Card 2.0 的 50-element 与 24 KiB JSON 预算约束；超限时只从最旧项开始淘汰，
不得截断或替换按钮、标题、固定 URL 和最新 command。执行中、终态、按钮可用性、Main 重启默认收起、per-card 串行更新
及下一轮召回语义保持 v12 继承边界。

## 4. 验证边界

测试必须分别证明：飞书 command 默认折叠且结果最多两行；长 ASCII/中文 command 保留首尾并有省略号；卡片不超过
50 elements/24 KiB；钉钉同一 command 预览不包含 result；redactor 和 `apply_patch` 边界不因紧凑呈现退化。

## References

- [Feishu Channel v12](feishu-channel-v12.md)
- [飞书渠道架构](../architecture/feishu-channel.md)
- [渠道 UI](../ui/components/channel-settings.md)
- [v1.37 实施计划](../versions/v1.37/implementation-plan.md)
- [V1.37-D10](../versions/v1.37/decisions.md#v1-37-d10)
