---
document_type: adr
id: ADR-0134
title: Explicit Runtime Public Output Boundary
status: accepted
date: 2026-08-07
decision_scope: cross-version
source_version: v0.45
supersedes: []
superseded_by: null
---

# ADR-0134: Explicit Runtime Public Output Boundary

## Context

不同 Runtime 对“助手最终输出”的可观测边界不同。若 Core 把每个 stdout、stream chunk 或
最后一段文本都当作公共消息，会把中间思考、重复重连和无关日志写入公共 Camp；若完全依赖
Agent 明确发送，又无法利用 Adapter 已经可靠证明的 final boundary。

## Decision

每个 Runtime Adapter 必须声明且冻结一种 public output mode：

1. `explicit_send_only`：只有 `camp.message.send` 成功才写 Public A2A Message；
2. `assistant_final_visible`：Adapter 能证明同一 AgentRun 的 final boundary 且输出为
   recipient-free assistant final 时，Core 可以创建一条公共消息。

自动 final 输出不得推导 recipients、创建 Delivery、改变 reply-to 或替代显式发送。精确
重复抑制只在同一 Run、同一 output mode、规范化正文完全相同且已确认同一 final boundary
时生效；不做语义相似度、时间窗或跨 Run 去重。无法证明 final boundary 时按
`explicit_send_only` 处理并保留原始 evidence。

## Consequences

- Adapter 能力差异成为显式、可审计的合同，不由 Core 猜测 Runtime 文本；
- 公共区只接收可靠 final 或明确 send，减少中间输出污染；
- 每个 Adapter 需要提供 boundary evidence 和 exact suppression fixture；
- `assistant_final_visible` 仍不会产生 recipient-specific Delivery，回复/寻址必须另行显式
  发送。

## Rejected Alternatives

- **把最后一个 stdout 当 final**：无法区分日志、重试和模型输出，证据不足；
- **所有 Runtime 一律自动公开**：把低观测能力 Runtime 的猜测变成公共事实；
- **语义相似度去重**：会删除用户有意重复的更新，且不可重现；
- **让 Renderer 决定 final**：UI 不是 Runtime evidence authority，也无法保证重启一致性。

## References

- [v0.45 版本目标](../versions/v0.45/README.md)
- [Public A2A Message 架构](../architecture/public-a2a-message-delivery.md)
- [Camp Message Send v1](../contracts/camp-message-send-v1.md)
