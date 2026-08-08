---
document_type: version-overview
version: v0.48
lifecycle: current
authority: version-scope-and-status
design_status: complete
implementation_status: complete
last_updated: 2026-08-08
---

# Rovai-ai v0.48：Native Session Compaction Bootstrap Redelivery

> 当前状态：设计、实现与确定性验收完成；六个 signal-driven Runtime 已完成目标版本真实
> compaction detector smoke。detector 是非阻塞增强能力，运行时短暂不可用不影响 AgentRun admission。
>
> 前置版本：[v0.47 Durable Task v2 与责任准入边界](../v0.47/README.md)

## 版本结果

v0.48 为普通会话上下文层可能被压缩的 Runtime 增加统一 Bootstrap Redelivery：Runtime-specific
Observer 只把受信 compaction signal 提交为当前 Native Binding generation 的持久 Requirement；
Bootstrap Delivery Gate 在下一次尚未 prepared 的真实 Runtime 输入上方补发完整 Bootstrap。补发
不是用户任务、Camp Message、AgentRun 或新 Native Session。

权威状态不是进程内 Boolean，而是 Binding-generation-scoped、单调的
`requestedRevision / acknowledgedRevision`。Delivery Gate 把所选 revision 冻结到
`RuntimeInputDelivery.prepared`；只有 Runtime accepted ACK 才推进 acknowledged revision。
发送失败、`delivery_unknown`、Core restart 或更晚到达的新 observation 都不会误清 pending。

ContextManifest 继续只冻结 Dynamic Context。完整 Bootstrap 复用现有 assembler，以最新已提交
Member Identity 组装，在内存中放入带 `【补发】` 的版本化 envelope，再接 Dynamic Context。
Delivery 只持久化 revision、Bootstrap Evidence ID 和 formatter 版本，不保存完整 Bootstrap、Identity
snapshot 或 identity-bearing digest。

## Runtime policy 与 detector 结果

是否尝试建立 detector 由版本维护的内部环境变量控制，值只有 `disabled | best_effort`，不对客
展示，也不进入 Runtime Readiness。六个目标 Runtime 默认 `best_effort`；Antigravity 默认且强制
`disabled`；Claude Code 与 Codex 的 Bootstrap 位于 compaction-protected instruction layer，不定义
开关也不进入 redelivery。

| Runtime | v0.48 policy / admission | 实现通道与目标版本实测 |
| --- | --- | --- |
| GitHub Copilot | `best_effort` / `preCompact` one-shot edge | `1.0.78` 官方 Plugin Hook；真实 `/compact` 观察到 `preCompact(manual)`，随后 ACP 输入仍 accepted。Hook payload 未带 event name，因此 relay command 冻结 source identity；Unix command 字段使用上游要求的 `bash` |
| OpenCode | `best_effort` / completed | `1.18.10` 隔离 native Plugin 观察 `session.compacted`；真实 summarize API 完成并发出该事件。主 prompt transport 仍为 ACP |
| Kiro | `best_effort` / completed | `2.16.1` 直接观察 ACP `_kiro.dev/compaction/status`；真实 compact 依次发出 nested `started`、`completed`，只接受 `status.type=completed` |
| Qoder | `best_effort` / completed | `1.1.14` 隔离 `--settings` Hook；真实 `/compact` 发出 `PostCompact(manual)` |
| CodeBuddy | `best_effort` / completed | `2.133.1` 隔离 `--plugin-dir` Hook；真实 emergency auto compaction 完成后发出 `SessionStart(source=compact)`；CLI additional settings 未进入 Hook registry。pre-message compaction 实测不发相关 Hook，作为已知 coverage gap 记录且不做 token 推断 |
| Qwen Code | `best_effort` / completed | `0.21.5` 私有 `QWEN_HOME` user-scope Hook；真实 `/compress` 发出 `PostCompact(manual)`。上游 matcher 是 exact match，使用 `*` 后由 relay 校验 trigger |
| Claude Code / Codex CLI | 不适用 | protected instruction layer，无 detector、无开关 |
| Antigravity | `disabled` | 缺少合格 compaction lifecycle event；不做 token heuristic |

Copilot 的 `preCompact` 是一次性 requirement-producing event，不是 sticky in-progress 状态。一个去重
occurrence 只推进一次 revision；一次 accepted redelivery 即可消费，不等待不存在的 completed Hook。
其余五个 Runtime 均只接受实测成功完成态，避免提前补发 token。

## Observer、时序与失败边界

Observer Lease 绑定 Native Session / Native Binding generation，不绑定 AgentRun，可跨 Run 存续，
但只授权提交合格 observation。Binding、Host、Session 或 policy epoch 替换会 fence Lease；同一
Session Resume 到新 Host 后使用新 Observer identity。去重键属于 Binding generation，不属于单个
Lease，因此 relay/Host 替换后的同一 observation replay 不会再次推进 revision。

Core database mutex 串行化 materialization、redelivery selection 与
`RuntimeInputDelivery.prepared`，Observer 不能在 selection 与 prepared 之间提交。ContextManifest 与
Delivery 目前是两个 SQLite commit；前一个 commit 的 Manifest 仍不可发送，crash recovery 会复用它
并重新选择当前 pending revision，因此不存在可送出未受 Gate 约束 payload 的窗口。prepared 后到达
的 signal 保留给下一输入。

detector 建立、失败与恢复始终 best-effort：AgentRun 正常继续，不切 one-shot Session、不修改用户
配置、不回溯猜测 observation gap，也不使用 token heuristic。已持久化 pending 与 detector 当前
health 无关。普通 Host/relay 中断本身不产生 compaction；只有已知具体 observation、提交结果不确定
时，relay 才会保留一条仅含 lifecycle metadata 的私有 durable outbox record。收到 Core ACK 后删除；
Core restart 或对应 Host exit fencing 前以同一 observation identity 幂等回放，随后清理 record。

## 实现与验收

- Migration 66 / Data Contract `v0.48` schema 26 增加 policy epoch、Requirement、Observer Lease、
  observation ledger 与 Runtime Input Delivery redelivery metadata；
- Core/Runtime Host 并行建立 detector，不参与 Runtime admission；
- Hook/native event/ACP extension 统一进入 Session-scoped observation command；
- prepared cutoff、accepted-only ACK、unknown 保留、后到 observation 与跨 Lease 去重均有确定性测试；
- 六个目标 Runtime 均以真实压缩操作验证所选 detector surface；完整记录见
  [Runtime 兼容性清单](../../runtime-compatibility.md)；
- 完整命令与通过状态见[实施与验收计划](implementation-plan.md)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.48 是唯一 current；v0.47 为 historical |
| ADR | 已更新 | ADR-0138～0143 固化 durable revision、policy、admission、overlay、Observer 与 non-blocking detector |
| Contracts | 确认无需更新 | envelope 与持久字段由 ADR、Migration 和 formatter version 约束；Agent-facing CLI/IPC 不变，无需新增独立公开合同 |
| Architecture | 已更新 | 长期架构维护两个生命周期、九 Runtime policy 与 detector transport |
| UI | 确认无需更新 | 内部增强能力不对客展示，不增加设置或 Renderer 状态 |
| Runtime Activity | 确认无需更新 | detector evidence 不投影为用户可见 Runtime Activity |
| Runtime compatibility | 已更新 | 记录六 Runtime 目标版本的 compaction signal smoke 与边界 |
| Documentation routing | 已更新 | 文档导航增加 compaction 专门入口 |
| Root README | 确认无需更新 | 项目定位和用户可见 Runtime 目录未改变 |

## References

- [v0.48 实施与验收计划](implementation-plan.md)
- [Native Session Bootstrap Redelivery Architecture](../../architecture/native-session-bootstrap-redelivery.md)
- [ADR-0138](../../adr/0138-durable-bootstrap-redelivery-requirement.md)
- [ADR-0139](../../adr/0139-version-owned-bootstrap-redelivery-runtime-policy.md)
- [ADR-0140](../../adr/0140-runtime-specific-compaction-signal-admission-point.md)
- [ADR-0141](../../adr/0141-atomic-bootstrap-redelivery-input-overlay.md)
- [ADR-0142](../../adr/0142-native-session-scoped-compaction-observer-lease.md)
- [ADR-0143](../../adr/0143-best-effort-non-blocking-compaction-detector-capability.md)
- [Runtime 兼容性清单](../../runtime-compatibility.md)
