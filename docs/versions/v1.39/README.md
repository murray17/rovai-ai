---
document_type: version-overview
version: v1.39
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-09-03
---

# Rovai-ai v1.39：Pi Runtime 安全重接入

前置：[v1.38](../v1.38/README.md)。本版本基于
`main@aae13734669c363e7b307a6407e6868eda1e6b8e` 重新接入 Pi Coding Agent；旧 Pi 分支只作为协议与负向
边界参考，没有 merge、rebase 或 cherry-pick。实现使用独立 `pi-jsonl-rpc-v1` Adapter，不把 Pi 伪装成 ACP。

## 范围与当前状态

- Product Runtime closed set、Migration 135、Core optional subsystem、Fleet、Desktop 配置、模型目录、Skill group、
  MCP projection、Activity、Usage 与 smoke 已加入 Pi；旧 Runtime、渠道、附件、membership、取消和 planned
  shutdown 分支保持原样。
- Pi executable 不存在时只有 `runtime.pi` optional subsystem degraded；Core、Skills、MCP 与其他 Runtime 继续启动。
  安装存在性不替代独立的 version、Machine Ready、capability 与 platform admission。
- 正式 AgentRun 继承 Pi 官方 `PI_CODING_AGENT_DIR`/原生默认配置；Core 不读取 Claude Home、不建立 Pi 私有
  provider 真源，也不把 secret 写入 argv、SQLite、Prompt、Evidence、diagnostics 或公开事件。
- Host 策略为 workspace/process-compatible 的 `resident_multi_session`：同一 Host 串行服务多个 Session，并发 Run
  获取不同 Host；Pi 的复用 identity 是 canonical workspace + process digest，当前独占 lease 的 Camp/member 则单独
  保留用于删除失效，其他 Runtime 的 Camp/member 复用语义不变。动态 Session/model/Bootstrap/Skill/MCP 不进入 process
  digest；只有 healthy、quiescent 且无 pending command/tool/MCP/lease 的 Host 才进入统一 LRU。
- Native Session 只用完整 Session ID 与 Core 私有 canonical session file 精确恢复。Availability Probe 在临时
  `--session-dir` 中用 private `--session` seed 创建、切换、验证并清理空测试 Session，不发送 Prompt、不调用模型，
  也不污染用户 Pi 历史；Prompt/final、receipt、Approval、Tool/MCP 与 Usage 只由显式 smoke 验证。
- Bootstrap 通过官方 extension `before_agent_start` 进入高权限 system prompt；每轮由不可变 managed-input receipt
  证明 exact binding、Bootstrap、Skills、MCP、Tool 集与 session digest，并与 input acceptance 原子提交。
- Pi 没有内建 MCP，但官方 extension Tool API 足以建立 Core-owned bridge；因此 External MCP 是
  `AdditivePerRun / RovaiWins / CoreManaged`，支持 stdio 与 Streamable HTTP，不写 Pi 全局配置。
- Pi 结构化 assistant `message_end.message.usage` 进入当前稀疏 Usage；只记可证明的 model-call delta，未知 reasoning
  与无法归因的 cost 保持 `NULL`。
- macOS arm64、macOS x64、Windows x64 都没有 Pi 专属 immutable qualification artifact，正式 Admission 均为
  `not_qualified / runtime_platform.qualification_evidence_missing`。本机 debug smoke 不是发布资格，普通 discovery、
  成员选择和 AgentRun 不会绕过此门禁。

## 已接受的差异与未关闭证据

- Pi 原生没有 sandbox 或 permission popup；所有 mutation 由 managed extension 在执行前阻塞，并交给 Core Durable
  Approval。Shell Action 保存 Pi 实际解析出的 shell path、args 与 command transport，不伪造成 `/bin/zsh -lc`。
- Pi system prompt 独立于 Session message compaction，策略固定为 `native_system_prompt_preserved`；Pi 不加入
  Bootstrap redelivery requirement 或 compaction observer lease closed set。
- Images、结构化 Web Search 与 Camp Fast 没有可靠 Pi 0.84.4 evidence，保持明确 unsupported/hidden；不从正文、
  path、MCP 名或普通 query 猜测。
- 当前 macOS arm64 + Pi 0.84.4 + MiniMax M3 已取得 first run、cold exact resume、warm Host reuse、allow/deny、
  cancel、Action output、结构化 Usage、真实 Skill 调用、stdio/HTTP MCP、三类 Missing-Send 与 Built-in CLI 15-operation
  smoke；本机又完成 A→B→A、跨 Camp workspace Host 复用、真实并发 Host、六类 shell output、Skill
  update/disable/re-enable/unassign/delete、MCP update/disable/unassign/delete/deny/cancel/no-leak，以及 Core planned
  shutdown 的完整子进程回收。完整 compaction、idle eviction、packaged App shutdown、故障注入、安全 workspace
  边界及另外两个平台仍需各自真实验收，所以本版尚不宣称 Pi 为任一 shipped platform 的 First-Class Runtime。

## 数据合同

Migration 135 只接受 `Data Contract v1.44 / Projection Schema 85`，原子升级到
`Data Contract v1.45 / Projection Schema 86`。它从当前 v1.44 DDL 扩展五个 closed set，新增
`runtime_input_delivery_pi_binding_unique`、禁止直接改删且允许父 Delivery cascade 的
`pi_managed_input_receipt` 及三类 guard；失败整体回滚，提交后执行 `foreign_key_check`，重开数据库不会重复应用。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.38 冻结为 historical；本概览、实施计划、确认说明和版本索引建立唯一 current v1.39 |
| Decisions | 已更新 | [v1.39 决定](decisions.md)记录独立 JSONL Host、私有 exact resume、managed receipt 与 MCP bridge 的高成本取舍；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Runtime Launch and Verification v30](../../contracts/runtime-launch-and-verification-v30.md)成为当前入口，完整拥有 Pi wire、Ready、Session、receipt、MCP、Action、Usage 与未准入边界 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)和[基础不变量](../../architecture/foundational-invariants.md)加入 Pi 的独立 transport、Fleet、隐私、managed input 与 bridge 边界 |
| UI | 确认无需更新 | Pi 复用既有 Runtime/成员/监控表面和通用状态，不引入新的跨版本交互；本版只补 closed-set row 与 logo |
| Runtime Activity | 已更新 | [Activity Registry](../../runtime-activity/registry.md)与维护指南加入 Pi verified tool lifecycle 映射，未知 shape 继续 fail closed |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录 Pi 0.84.4 本机证据、专属未准入矩阵与剩余 Golden Flow |
| Documentation routing | 已更新 | [文档导航](../../README.md)、Contract/Architecture 索引和当前决定导航指向 v30、Pi research 与 parity matrix |
| Root README | 确认无需更新 | Pi 在所有 shipped platform 仍未准入，不应加入面向用户的 Supported Runtime 表 |

## References

- [实施与验收](implementation-plan.md)
- [模型上下文变更 revision 1](model-context-change-pi-managed-system-prompt.md)
- [Parity Matrix](../../research/pi-runtime-reintegration-parity-matrix.md)
- [Runtime Launch and Verification v30](../../contracts/runtime-launch-and-verification-v30.md)
- [Runtime 接入 Checklist](../../development/runtime-integration-checklist.md)
