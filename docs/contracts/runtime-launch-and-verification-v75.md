---
document_type: contract
name: Runtime Launch and Verification
version: v75
status: accepted
source_version: v1.72
last_updated: 2026-11-04
---

# Runtime Launch and Verification v75

继承 [v74](runtime-launch-and-verification-v74.md)。本版将 Claude 的空成功结果与局部问卷取消规则
扩展到 Pi、Codex、共享 ACP 和 Antigravity；运行成功与是否有聊天文字分别处理。

## 原生终态与文字发布

当前 Host、Run、execution epoch、Session／Turn 和输入投递的原有归属校验继续生效。
只有本轮有效的原生成功结果可以正常完成；不要求非空最终文字，也不要求此前已有公开发送。

| 路径 | 成功证据 |
| --- | --- |
| Claude | 当前执行的有效原生 success，沿用 v74 的 result／idle 和后续活动处理 |
| Pi | 当前 owner 的 `agent_settled`，且本轮 assistant 结束原因为 `stop` |
| Codex | 匹配当前 Turn 的 `turn/completed`，状态为 `completed` 且没有原生 error |
| 共享 ACP | 匹配当前 Prompt 的有效 `end_turn`，没有原生 response error |
| Antigravity stream-json | 匹配当前 Conversation 的完整最终 result，状态为 `SUCCESS` |

Antigravity 成功 result 的 `response` 可以为空字符串、空白、null 或省略；存在但不是字符串／null
仍是协议错误。原生失败、拒绝、整轮取消、中断、未知状态、错误会话及缺少可靠终态继续使用原有处理。
Antigravity 的 print 超时警告即使伴随 exit 0 也继续失败；legacy print 的空 stdout 不构成成功证据。
Core 原有 Action、Approval、输入投递及终态事务校验继续生效，不增加计时器、重试或新状态。

非空最终文字沿用既有发送、Missing-Send 补发与去重。空文字只完成 Run／队列，不写空消息、
不构造 Missing-Send 候选、不借用历史文字，也不额外调用模型生成答复。公共会话与 Single Chat
均遵守此规则，字段与幂等边界见 [Missing-Send v4](missing-send-recovery-publication-v4.md)。

## 局部问卷取消

不支持的原生问卷继续在当前请求处拒绝或取消，不提交答案，不通过执行审批或 bypass 代选。
保留诊断与请求去重；此前出现过问卷不再覆盖后续有效原生成功。若原生随后返回 error、refusal、
cancelled 或没有可靠终态，继续按实际结果结算。问卷取消不等于整轮用户取消，不自动重放 Run。

本版不新增问卷界面，不改变原生工具配置、取消响应、模型输入、Bootstrap、ContextManifest、
数据库 Schema 或 Runtime Activity wire shape；历史 Run 不回填。
