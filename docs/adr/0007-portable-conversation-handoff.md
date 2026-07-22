---
document_type: adr
id: ADR-0007
title: "Portable Conversation Handoff"
status: accepted
date: 2026-07-22
decision_scope: cross-version
source_version: v0.03
supersedes: []
superseded_by: null
---

# ADR-0007: Portable Conversation Handoff

## Context

Lumen 的 `Conversation` 表达成员在 Camp 内的长期私有连续性，而上游 Runtime 的 Native Session 只在特定 Adapter Installation 和兼容配置中有意义。成员默认 Runtime、Installation 或 Session 级配置发生变化时，Lumen 需要保留逻辑 Conversation，同时不能把一个 Runtime 的 Session ID、隐藏推理或私有工具状态错误交给另一个 Runtime。

直接覆盖绑定会在新 Session 创建失败时丢失旧连续性；批量立即迁移成员的全部 Conversation 又会产生无用户执行意图的外部 I/O 和大量半迁移状态。

## Decision

`Conversation` 的逻辑身份不随有效 Runtime 改变。有效配置按以下顺序解析：

```text
AgentProfile 默认配置
→ Conversation 可选显式 Override
→ AgentRun 创建时冻结的实际配置
```

已经创建或正在执行的 `AgentRun` 始终使用冻结配置，不受后续 Profile 或 Conversation 编辑影响。

Conversation 的当前 Native Binding 必须同时包含：

```ts
type NativeBinding = {
  adapterInstallationId: string;
  nativeSessionId: string;
  bindingCompatibilityDigest: string;
};
```

只有同一 Installation 且兼容摘要允许 Resume 时，Adapter 才能继续当前 Native Session。Adapter、Installation 或不兼容的 Host/Session 级配置发生变化时，必须创建新的 Native Session；旧 Session ID 不得交给新 Adapter 尝试恢复。

跨 Adapter 交接只携带 Lumen 拥有的可移植上下文，包括 Conversation 消息、摘要、水位、当前职责和稳定引用。Lumen 不承诺迁移上游 Runtime 的隐藏推理、内部压缩状态、未公开工具状态或其他私有上下文。

交接采用准备后换绑：

```text
解析并校验新 Runtime 配置
→ 创建新 Native Session
→ 物化可移植上下文
→ 使用 Conversation version、旧 Installation、旧 Session ID 和旧兼容摘要执行 CAS
→ CAS 成功后允许新 AgentRun 调度
```

新 Session 创建、上下文物化或 CAS 任一步失败时保留旧 Binding，并且不能启动使用半迁移上下文的 Run。换绑成功后停止旧 Host 对该 Conversation 的事件路由；旧 Session 与 Host 的清理由原 Adapter 最佳努力完成，不阻塞权威换绑。

`bindingCompatibilityDigest` 由 Adapter 根据影响 Resume 语义的 Host/Session 级配置规范化生成。纯 Run 级选项不得无故触发 Session 迁移；CLI 版本是否参与摘要由 Adapter 的真实兼容能力决定，不能全局硬编码。

Profile 默认配置变更采用惰性交接：保存偏好时不创建 Session、不启动 Host，也不批量迁移 Conversation；只有下一次明确创建 Run 的 Preflight 发现绑定不兼容时才执行上述流程。

## Consequences

- 用户可以在保持同一 Lumen Conversation 的情况下更换 Runtime，但只能保证 Lumen 持有上下文的连续性。
- 每个 Native Session 都具有明确的 Installation 与兼容配置身份，避免跨账户、跨协议或跨权限配置错误 Resume。
- 交接失败不会破坏旧 Binding，也不会留下半绑定 Run；代价是创建新 Run 前可能需要额外 Session 准备与上下文物化。
- Adapter 必须稳定计算兼容摘要并明确哪些配置影响 Resume；Core 不能替所有 Runtime 硬编码同一规则。
- 保存成员配置保持快速且无外部副作用，但多个 Conversation 会在各自下一次运行时分别完成惰性交接。

## Rejected Alternatives

- 把 Native Session ID 脱离 Adapter Installation 单独保存或跨 Adapter Resume。
- 宣称可以迁移 Runtime 的隐藏推理、私有压缩或未公开工具状态。
- 保存成员配置时立即批量迁移该成员的全部 Conversation。
- 在新 Session 准备完成前覆盖旧 Binding。
- 交接失败后保留半迁移 Binding 或启动使用不完整上下文的 Run。
- 把所有模型或 Run 级选项变化都视为 Session 不兼容。

## References

- [ADR-0002: Collaboration](0002-collaboration.md)
- [ADR-0003: Execution Runtime](0003-execution-runtime.md)
- [ADR-0006: Multi-Runtime Adapter Boundary](0006-multi-runtime-adapter-boundary.md)
- [v0.03 多 Runtime 成员管理](../versions/v0.03/README.md)
- [v0.03 实施计划与验收清单](../versions/v0.03/implementation-plan.md)
