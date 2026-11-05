---
document_type: protocol-contract
contract: missing-send-recovery-publication-v4
authority: successful-agentrun-missing-send-publication
status: accepted
version: 4
last_updated: 2026-11-04
---

# Missing-Send Recovery Publication v4 Contract

继承 [v3](missing-send-recovery-publication-v3.md) 的候选归属、发布围栏、receipt 校验、去重、恢复抑制及幂等规则。
本版替代 v3 对空 final 仍要求已有公开发送、以及不支持问卷否决原生成功的规则。

## 成功与消息分别处理

运行结果以 [Runtime Launch v75](runtime-launch-and-verification-v75.md#原生终态与文字发布)的本轮有效原生终态为准。
`agent_run.succeed.finalOutput` 继续为必传字符串，允许空白，不要求先前已提交 `camp.message.send`。

- 有非空最终文字时，沿用普通发布及 Missing-Send 补发已有文字的规则；有效发送继续抑制重复补发。
- 没有最终文字时，Run 正常成功并推进队列；`finalOutputDigest` 为 null，不创建空公共消息或空
  `conversation_message`，不生成 Missing-Send 候选，不从此前公开正文伪造 final。
- 原生失败、拒绝、整轮取消、缺少可靠终态及原有事务拒绝不会因为已发送消息或产物落盘而成为成功。
  已提交消息和产物保留，继续使用原有失败／取消处理，不自动重放有副作用的整轮。

原生问卷仍不能被执行审批代答；当前请求的取消诊断与答案为空的边界保留，随后有效成功可以完成 Run。
公共会话和 Single Chat 共用这些空结果规则，既有 membership lifetime、Run／epoch、消息撤回与 receipt 围栏不变。
