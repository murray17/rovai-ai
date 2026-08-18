---
document_type: adr
id: ADR-0209
title: Bounded TRAE Cold Session History Restore
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.04
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0209: Bounded TRAE Cold Session History Restore

## Context

TRAE 的 Native Session 可以比承载它的 ACP Host 和 Rovai Core 存活更久。只复用同一 Host 会使 Host
回收、Core 重启或应用重启后的下一次 AgentRun 丢失 Runtime 私有上下文；直接建立新 Session 又会把
continuation 误报为成功。

本机 TRAE `0.120.52` 已证明 ACP `session/load` 可以跨 Host 恢复精确 Session marker，但顶层
`--resume` 与 ACP server 的组合不能使用：以同一次 ACP `session/new` 返回的精确 ID，分别执行
`traecli --resume=<id> acp serve` 和 `traecli acp serve --resume=<id>`，两者均未在有界时间内响应
`initialize`，而普通 `traecli acp serve` 正常响应。恢复过程还可能输出历史 tool、permission、usage
和 assistant 事件，不能把它们当成当前 AgentRun 的执行。

## Decision

1. TRAE continuation 顺序为：同 Host Session 复用、ACP `session/resume`、经真实协议 Probe 证明可用的
   exact-ID Provider Resume、受控 ACP History Restore、最后建立新 Session。当前已验证构建没有可用的
   Provider Resume，因此实际冷恢复从 ACP resume 直接进入 History Restore。
2. Provider Resume 只能使用 Rovai 为该 Conversation 持久化的精确 Native Session ID，并必须在真实
   `initialize`、上下文 marker 与后续 ACP prompt 均通过后才能启用。禁止 `--resume AUTO`、最近 Session
   扫描和读取 TRAE 私有 Session 存储；恢复 Host 在绑定完成前不得服务其他 Conversation。
3. History Restore 是独立 continuation，不等同普通 resume。新 Host initialize 后必须先把精确 Session
   route 绑定为 `LoadingReplay`，再调用 `session/load(existingSessionId)`；成功 response 是 replay barrier，
   barrier 后 route 才能进入 `Ready` 并接收当前 AgentRun prompt。
4. `LoadingReplay` 内所有 Session event 和 server request 都属于恢复控制面，必须在进入 Execution
   Evidence、Action/Approval、Usage、Missing-Send Recovery、Compaction、Renderer 或最终输出前丢弃。
   恢复 route 只接受目标 Session；事件数、累计字节和时间必须有固定上限，非法 JSON、串 Session、超限、
   timeout 或失败 response 都使 Host protocol-violated 并中止恢复。
5. 精确 Session ID 只有在 executable fingerprint、installation/protocol、Host config、canonical
   workspace、workspace access/isolation、model 和 permission 配置兼容时才可尝试恢复。兼容性不匹配直接
   轮换 Native Binding 并建立新 Session，不把错误 Session 交给新 Host。
6. 恢复失败时，Core 必须在发送当前 prompt 前持久记录 `native_session_continuity_lost`，停止失败 Host、
   轮换 Binding、建立新 Session，再发送当前请求。不得静默沿用旧 ID、冒充恢复成功或把失败恢复产生的
   内容拼入新 Run。

本决定局部替代 ADR-0203 同期缺陷修正中“TRAE 冷 Host 不使用 `session/load`”的当前约束；其
Structured Skill、Prompt response-only ACK 和其他 Runtime continuation 决定保持不变。

## Consequences

- TRAE 在 Host/Core/App 冷启动后可以延续 Runtime 私有上下文，同时当前 AgentRun 的证据仍只来自当前 prompt。
- 恢复会增加一次有界 `session/load` 往返；失败路径会诚实丢失连续性并建立全新 Session。
- 上游若提供真正可组合的 exact-ID Provider Resume，仍需重新运行真实 Probe 并显式启用，不能从 help 文案推断。
- 兼容性键变化会主动放弃旧 Session；这比跨 workspace、模型、权限或 executable 版本误载入更保守。

## Rejected Alternatives

- **直接解析 TRAE `events.jsonl` 或扫描最近 Session。** 这是未经合同保证的私有存储，且可能混入 Rovai 外会话。
- **使用 `--resume AUTO`。** 它不能证明恢复的是当前 Conversation，存在跨用户会话串线风险。
- **把 load replay 当作当前 Run event。** 历史工具、审批、usage 和输出会污染当前执行证据并可能重复副作用。
- **恢复失败后继续使用旧 Binding。** 这会把新 Session 冒充为原 Session，破坏连续性证据和后续恢复选择。

## References

- [v1.04 version scope](../versions/v1.04/README.md)
- [Runtime Launch and Verification v7](../contracts/runtime-launch-and-verification-v7.md)
- [TRAE ACP Probe](../research/trae-cli-runtime/probe/README.md)
- [ADR-0203](0203-structured-current-input-skill-links.md)
