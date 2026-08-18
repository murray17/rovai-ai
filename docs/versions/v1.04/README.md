---
document_type: version-overview
version: v1.04
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-18
---

# Rovai-ai v1.04：TRAE Cold Resume 与历史重放隔离

> 当前状态：[ADR-0209](../../adr/0209-bounded-trae-cold-session-history-restore.md)与
> [Runtime Launch and Verification v7](../../contracts/runtime-launch-and-verification-v7.md)已经接受；实现与
> 验收已按[计划](implementation-plan.md)完成。
>
> 前置版本：[v1.03 TRAE 轻检与显式可用性验证](../v1.03/README.md)

## 版本目标

让 TRAE 在 ACP Host 回收、Core 重启或应用重启后继续精确的 Rovai Native Session，同时把 load 产生的
历史事件完整隔离在当前 AgentRun 之外；恢复不可用时诚实记录 continuity lost 并安全建立新 Session。

## 交付范围

- 使用同一次 ACP `session/new` 的精确 ID 重测 Provider Resume 两种 `=` 赋值位置；
- Provider Resume 不合格时启用 TRAE `HistoryRestore`，在当前 prompt 前执行 `session/load`；
- `LoadingReplay` 隔离历史 assistant/tool/approval/usage/server request 与异常诊断；
- replay 设置 4096 event、8 MiB、30 秒三类独立上限；
- restore response 只接受省略或等于原始目标的 Session ID，不同 ID fail closed 且不得换绑；
- 冻结 executable、workspace、模型、权限、Host config 等 Session compatibility；
- 失败持久记录 continuity lost，停止失败 Host、轮换 Binding 并从 `session/new` 继续当前请求；
- 保持同 Host warm reuse、当前 Run tool/approval/cancel 和 Camp/Conversation route fence。

## 明确不做

- 不使用 `--resume AUTO`，不扫描最近 Session；
- 不解析 `~/Library/Caches/trae-cli/sessions/*/events.jsonl` 或其他 TRAE 私有状态；
- 不把历史 replay 作为当前 Run 的 Evidence、Usage、Action、Renderer 或输出；
- 不修改公开 wire、Renderer schema、Run Facts 或模型输入合同；
- 不从 help 或 capability 名称推断 Provider Resume 可用。

## 验收边界

- 同 Host 后继 Run 继续复用原 Session；冷 Host 以精确 ID 恢复 marker；
- Core 重启后恢复相同 Runtime 私有上下文；
- 历史 tool、approval、usage、assistant 输出和 replay 异常不进入新 Run；
- 新 Run 的 prompt、tool、approval 与 cancel 不受 quarantine 影响；
- 错误 Session ID、workspace、模型、权限或 executable 变化安全回退；
- 两个 Camp 的 Host、Binding、Session 和事件不发生串线；
- Rust、真实 Runtime smoke 与文档治理门禁通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.03 冻结为 historical；本概览、计划和索引建立唯一 current v1.04。 |
| ADR | 已更新 | ADR-0209 冻结 exact-ID Provider Probe、HistoryRestore quarantine 与 fail-closed fallback。 |
| Contracts | 已更新 | Runtime Launch and Verification v7 成为当前 continuation、exact-ID response、预算、兼容性和失败语义入口。 |
| Architecture | 已更新 | Runtime Catalog Boundaries 与 Built-in Tool Runtime 记录 TRAE cold Host 的受控 HistoryRestore。 |
| UI | 确认无需更新 | 恢复发生在 Runtime 控制面，不新增 Renderer 状态、动作或展示合同。 |
| Runtime Activity | 确认无需更新 | replay 被隔离且当前 Run 仍使用既有 ACP Activity 映射。 |
| Runtime compatibility | 已更新 | 记录 `0.120.52` exact-ID Provider Resume 负向 Probe 和 session/load 正向能力。 |
| Documentation routing | 已更新 | 顶层导航、ADR CURRENT/HISTORY、Contract 和 Version 索引切换到 ADR-0209/v6/v1.04。 |
| Root README | 确认无需更新 | Runtime 支持集合、产品定位与用户能力名称不变。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0209](../../adr/0209-bounded-trae-cold-session-history-restore.md)
- [Runtime Launch and Verification v7](../../contracts/runtime-launch-and-verification-v7.md)
- [TRAE ACP Probe](../../research/trae-cli-runtime/probe/README.md)
