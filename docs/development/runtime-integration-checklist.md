---
document_type: development-checklist
authority: development-procedure
status: proposed
last_updated: 2026-08-24
---

# Agent Runtime 一等接入与准入 Checklist

本清单用于判断一个新 Runtime 是否已经成为 Rovai 的一等 Product Runtime。

> 接入目标不是“第三方 CLI 能在 Rovai 中运行”，而是该 Runtime 能完整遵守 Rovai 的 Host、Native Session、Context、Capability Projection、Action Safety、Monitoring 和 Product Catalog 语义。

实现方式可以不同，但用户可观察行为应与其他一等 Runtime 保持一致。

权威边界：

- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Runtime Platform Admission v2](../contracts/runtime-platform-admission-v2.md)
- [Contracts Index](../contracts/README.md)
- [Runtime 兼容性清单](../runtime-compatibility.md)
- [`AdapterKind::ALL`](../../crates/rovai-core/src/agent_profile.rs)

## 1. 完成定义

| 阶段 | 定义 | 产品可见性 |
| --- | --- | --- |
| Research | 已确认命令、协议和候选接入面 | 不进入普通 Runtime 目录 |
| Core Compatible | 基础执行、Tool、Final、Approval、Cancel、Session 和 Built-in CLI 已闭合 | 仅内部测试 |
| First-Class | 本文所有核心能力轴均已闭合，或有明确的上游 Unsupported 产品决定 | 才能进入正式 Product Runtime Catalog |

**正式“第一版接入”必须达到 First-Class。** Core Compatible 只是开发中的中间状态，不能作为“已完成接入”发布。
经当前 Version Decision 明确接受的 Runtime Platform `preview` 可以把已进入 Product Runtime Catalog 的 Adapter
开放给用户主动测试，但必须显示实验性、保留缺失资格 reason/空 evidence revision，且不计作 First-Class 完成。

每个能力轴分别记录：

- Runtime evidence：`Verified | DocumentationOnly | NotObserved | Unsupported`
- Rovai implementation：`Implemented | NotImplemented | Disabled | Blocked`

一个能力轴只有以下两种情况可以通过：

1. `Verified + Implemented`；
2. 上游能力已被可靠证明为 `Unsupported`，并在当前版本 Decision 中接受该产品差异。

`DocumentationOnly`、`NotObserved`、`NotImplemented`、`Disabled` 或 `Blocked` 都不能通过 First-Class 准入。

## 2. 实现前必须完成 Parity Matrix

先选出最接近的生产 Adapter，并填写下表。不得先写 Adapter，再用已有实现反推产品语义。

| 核心能力轴 | Rovai 标准行为 | 上游能力面 | 接入策略 | 状态与证据 | 接受的差异 |
| --- | --- | --- | --- | --- | --- |
| Auth / Provider / Model | | | | | |
| Host / Fleet / LRU | | | | | |
| Native Session / Continuation | | | | | |
| Bootstrap / Context | | | | | |
| Compaction continuity | | | | | |
| Skills | | | | | |
| External MCP | | | | | |
| Tool / Action / Command Output | | | | | |
| Narration / Final / Missing-Send | | | | | |
| Permission / Approval / Workspace | | | | | |
| Built-in `rovai` CLI | | | | | |
| Usage / Cache / Cost | | | | | |
| Retry / Queue / Cancel / Cleanup | | | | | |
| Ready / Version / Platform | | | | | |

所有差异必须属于以下之一：

- 上游协议或架构必需；
- Rovai 安全合同要求；
- 用户明确需求；
- 当前版本已批准的上游 Unsupported 差异。

“实现方便”“竞品也是这样做”或“先不做”不是可接受差异。

## 3. 核心能力轴

### 3.1 Auth、Provider 与 Model

- [ ] 正式 AgentRun 使用该 Runtime 自身的官方认证、Subscription、OAuth、BYOK 和原生配置来源。
- [ ] 不借用另一个 Runtime 的 Home、凭据、Provider 或模型配置；Probe 的临时 Home 不进入生产启动。
- [ ] 支持 Runtime native default；显式模型从真实 catalog/state 选择并在启动后核对。
- [ ] 凭据、模型或 Provider 改变后，已驻留 Host/Session 会 live refresh 或被精确 fence，不继续使用旧状态。
- [ ] Secret 不进入数据库、argv、Prompt、日志、Evidence、diagnostics 或公开 Runtime 事件。

### 3.2 Host、Fleet 与 LRU

- [ ] 明确声明一种 Host 策略：`resident_multi_session | resident_single_session | one_shot_resumable | one_shot_new_only`。
- [ ] Runtime 有可驻留 Host 时接入统一 `RuntimeFleet`，不再建立 Adapter 私有进程池。
- [ ] 复用只要求 Host healthy、idle 且 process compatibility 相同；Prompt、AgentRun 和可动态刷新的 Session 能力不进入进程复用键。
- [ ] `resident_multi_session` 必须通过精确 Session switch、切回、并发新 Host 和跨 Session 无泄漏验证。
- [ ] 成功后只有真正 quiescent 的 Host 才进入 LRU；失败、协议错误、取消未收敛或 capability drift 后停止 Host。
- [ ] idle eviction、App shutdown 和 Core crash recovery 后没有残留进程树。

### 3.3 Native Session 与 Continuation

- [ ] 一个 Rovai Conversation 稳定绑定一个 Native Session identity。
- [ ] warm continuation、Host 重启后的 exact resume、Core 重启后的 cold resume 均有真实证据。
- [ ] 不使用“最近 Session”、模糊 ID、部分 ID 或私有历史猜测代替精确恢复。
- [ ] 恢复失败会停止失败 Host、记录 continuity lost，并且至多创建一个替代 Session。
- [ ] `new_only` 不能宣称支持 continuation；若上游确实不支持 resume，必须作为明确产品差异审批。

### 3.4 Bootstrap 与 Context

- [ ] Session Charter、Member Identity 和 Memory Entrypoint 位于 Runtime 的 System、Developer 或等价高权限指令层。
- [ ] Bootstrap 不伪装成普通用户消息，不进入 Tool output 或公开 narration。
- [ ] 首次 Session、warm reuse、Host 切换 Session、cold resume 后均使用目标 Native Binding 的正确 Bootstrap。
- [ ] Bootstrap 不重复、不丢失、不从 Session A 串入 Session B。
- [ ] 每个 Prompt 使用当前冻结的 ContextManifest、Skill exposure、MCP exposure、附件授权和 delivery/epoch。

### 3.5 Compaction Continuity

Compaction 的目标是保持 Context 合同，不是机械地监听某个事件。

- [ ] 明确选择一种策略：`native_system_prompt_preserved | core_bootstrap_redelivery | native_compaction_disabled`。
- [ ] Manual compact、threshold auto compact、overflow compact + automatic retry 后 Bootstrap 和 Native Session 语义保持正确。
- [ ] Compaction 后 Skills、MCP、权限和当前 Session 不发生隐式变化。
- [ ] Compaction fail/cancel 不被误记为完成；cold resume 能恢复压缩后的同一 Session。
- [ ] 只有正确性依赖 lifecycle signal 时才接入 detector；若 System Prompt 原生持续存在，不要求为了打勾而监听 Compaction。

### 3.6 Skills

- [ ] 复用现有 Skill 设置页和 Runtime delivery group，不增加 Adapter 私有的第二套 Skill 配置。
- [ ] 分配给该 group 的 Skill 通过 Runtime 原生目录、协议或资源发现真实可用，并与原生/project Skill 兼容追加。
- [ ] 同名冲突、更新、删除和禁用具有明确语义；下一次 eligible Session/Run 能看到最新结果。
- [ ] 未分配的 Skill 不可见；Host/Session 复用后不存在上一 Session 的 Skill 泄漏。
- [ ] 真实 Runtime 能列出或调用预期 Skill，而不是只验证投影文件存在。

### 3.7 External MCP

- [ ] 复用 Rovai 现有 MCP Assignment 和 `PreparedMcpProjection`，不增加 Runtime 私有配置入口。
- [ ] Rovai MCP 与 Runtime native Tool/MCP 兼容追加；logical name、runtime name 和同名策略明确。
- [ ] MCP 只在目标 AgentRun/Session 可见，配置更新后不会继续暴露旧 Tool。
- [ ] Secret 不写 Runtime 全局配置，不进入 Prompt、argv、日志或公开事件。
- [ ] Mutation Tool 经过 Runtime-native 或 Core-managed Approval；cancel 能终止调用和 Server 子进程。
- [ ] 未配置 MCP 的相邻 Session 看不到前一 Session 的 Server/Tool。
- [ ] “上游没有内建 MCP”不自动等于 `Unsupported`；若可通过官方 Extension、Tool API 或安全 Bridge 接入，未实现状态应记录为 `NotImplemented`。

### 3.8 Tool、Action 与 Command Output

- [ ] 每个 Tool 有稳定 Native ID，并形成唯一 `started → terminal` 生命周期。
- [ ] 重复、partial、cumulative 和 metadata 补发不会创建重复 Action 或重复结果。
- [ ] 真实 Runtime 分别验证 stdout、stderr、混合输出、空输出、非零退出和超大输出。
- [ ] 固定 marker 出现在对应 `runtime.action.payload.output`，而不是只存在于 final、日志或文件差异。
- [ ] 空输出命令仍保留安全的 command input；非零退出不被误记成功。
- [ ] 不从未知 metadata、私有日志、Diff 或最终回答补猜 Tool 和输出。

### 3.9 Narration、Final 与 Missing-Send

- [ ] 公开 narration 只来自 Runtime 明确标记的公开文本；thinking、调试和 Provider metadata 保持私有。
- [ ] authoritative final boundary 明确；进程退出、idle 或最后一段 stdout 不单独构成成功。
- [ ] streamed text 与 terminal snapshot 不重复发布；success、failed、cancelled、timeout 各有唯一终态。
- [ ] Missing-Send 的 zero-send、accepted-send suppression 和 tool→final 均通过真实验证。
- [ ] 没有可靠 final boundary 时，不启用 Missing-Send Recovery。

### 3.10 Permission、Approval 与 Workspace

- [ ] Product default 使用该 Runtime 已验证的原生最高权限；read-only Run 按 Rovai 规则收窄。
- [ ] Runtime-native Approval、Core-managed Approval 或 Sandbox 最终投影到同一 Action Safety 语义。
- [ ] allow-once 只产生一次副作用；deny 和 cancel 后目标副作用均未发生。
- [ ] Workspace、Attachment、Skill resource 和临时目录边界真实限制 Runtime Tool，不只记录在 digest 中。
- [ ] 未知 mutation、未知 Tool shape 和 Approval bridge 失败全部 fail closed。

### 3.11 Built-in `rovai` CLI

- [ ] Runtime 使用当前 bundled `rovai` CLI、当前 operation catalog 和当前 Charter，不使用旧 Research 中的命令别名。
- [ ] Built-in binding/lease 按 AgentRun 建立、恢复和解除，不从前一 Run 泄漏。
- [ ] 真实 Runtime 完成当前正式 operation 集的 Smoke。
- [ ] 能调用 Built-in CLI 不等于支持 MCP，两项能力分别声明和验收。

### 3.12 Usage、Cache 与 Cost

- [ ] 上游存在结构化 Usage 时，First-Class 接入必须实现可证明字段；不能仅因实现成本将其长期标为 `Disabled`。
- [ ] 每个字段记录来源、scope、counter mode 和版本；未知或语义不确定的字段保持 `NULL`。
- [ ] uncached input、cache read、cache write、output 和 reasoning 使用 Rovai canonical bucket，且不重复累计。
- [ ] cumulative/gauge 建立 baseline；重发、retry、compaction 和 cold resume 不造成重复归属。
- [ ] Session totals 不直接保存为当前 AgentRun usage/cost；币种和价格来源不明确时不估算。
- [ ] 上游确实不提供某字段时可逐字段标记 `Unsupported`，不能用零值伪装支持。

### 3.13 Retry、Queue、Cancel 与 Cleanup

- [ ] Input accepted 使用 Runtime 原生证据；response error、Host exit 和已发生 activity 的场景不会导致重复投递。
- [ ] 自动 retry 不重复用户输入或副作用；旧 Run 和迟到事件不能进入下一 Run。
- [ ] Host 回到 LRU 前 pending command、steer/follow-up queue、Approval 和 Tool 均已清空或终结。
- [ ] cancel 严格收敛为 `cancelled`，并在 grace window 后仍无延迟文件、命令、网络或 MCP 副作用。
- [ ] completion、failure、cancel、Probe timeout 和 App shutdown 后均无残留进程。

### 3.14 Ready、Version 与 Platform

- [ ] Machine availability、认证 Ready 和 Adapter/version/platform 行为资格分开记录。
- [ ] `--version`、普通回复或 ACP `initialize` 不会自动声明 Resume、Tool、MCP、Compaction、Usage 等能力。
- [ ] 每项能力绑定明确 Runtime 版本范围、平台和 Evidence revision；升级后相关证据会 stale。
- [ ] 每个 shipped 平台独立通过真实 Runtime Golden Flows。
- [ ] 只有全部 First-Class 轴闭合后，Runtime 才进入 Settings、成员选择和正式 Product Runtime Catalog。

## 4. 必过 Golden Flows

| Flow | 必须证明 |
| --- | --- |
| First Run | 原生认证/default model、Bootstrap、公开回复、Tool、Final 和 Built-in CLI 正确 |
| Warm Host | 按声明策略复用 Host，不重复启动、不串 Prompt/Session/capability |
| Multi-Session / Concurrency | 支持多 Session 的 Host 能精确切换；并发时使用独立 Host；切回后上下文正确 |
| Cold Resume | Core/Host 重启后以精确 Native Session 恢复；错误恢复 fail closed |
| Context / Compaction | Bootstrap 在 manual、threshold、overflow+retry 和 compact 后 cold resume 中保持正确 |
| Skill / MCP Projection | Assignment 增加、更新、删除后生效；与 native capability 兼容追加；相邻 Session 无泄漏 |
| Safety / Output | read-only、allow、deny、cancel，以及 stdout/stderr/empty/nonzero/large output 全部正确 |
| Monitoring | Usage 重发、cache bucket、retry、compaction 和 resume 后无重复统计；不支持字段保持未知 |
| Failure / Cleanup | Runtime crash、协议错误、Probe timeout、App shutdown 后状态可恢复且无残留进程 |

`Not applicable` 只能用于已证明的上游 `Unsupported`，并附当前版本产品差异决定。Fixture 和模拟协议不能替代目标版本真实 Runtime Smoke。

## 5. 最小协议要求

无论 ACP、JSON-RPC、JSONL RPC、stream-json 或 one-shot CLI，都必须满足：

- [ ] 协议输出有界且结构化，日志与协议通道分离。
- [ ] Input accepted、Session identity、Tool ID、Final boundary 和 Cancel terminal 都有原生依据。
- [ ] Host、Session、Prompt、delivery 和 execution epoch 可以可靠 fencing。
- [ ] Idle metadata、Prompt event、replay 和迟到事件不会互相污染。
- [ ] 非法 JSON、身份错误、预算溢出和生命周期不变量破坏时 fail closed。

ACP、自定义 extension、history replay 和 Runtime-specific message shape 的细节由当前 [Contracts Index](../contracts/README.md) 中的对应合同约束，不在本清单重复展开。

## 6. 硬性阻断条件

出现任一情况，不得标记为 First-Class：

- [ ] 使用另一个 Runtime 的认证、Provider、模型或 Home 代替目标 Runtime 原生来源。
- [ ] Runtime 可驻留但没有明确 Fleet/LRU 策略，或可安全复用时仍每轮无理由重启。
- [ ] 声称 continuation，但 warm/cold/Core restart 后不能维持精确 Native Session。
- [ ] Bootstrap 在 Session switch、resume 或 Compaction 后丢失、重复或串线。
- [ ] Skill 设置页或 MCP Assignment 已投递，但 Runtime 不可用、不可刷新或跨 Session 泄漏。
- [ ] Tool ID、Command Output 或 authoritative final 不可靠。
- [ ] Approval deny、read-only 或 cancel 后仍发生副作用。
- [ ] Retry、queue、replay 或迟到事件进入错误 AgentRun。
- [ ] 上游提供结构化 Usage，但 Rovai 仍错误归属、重复累计或用零值伪装未知。
- [ ] Probe、Run、MCP Server 或 shutdown 后存在残留进程。
- [ ] 只有文档、Fixture、`initialize` 或一次普通回复，没有完整 Golden Flow 证据。
- [ ] 任一核心能力轴仍是 `NotImplemented`、`Disabled`、`Blocked`、`DocumentationOnly` 或 `NotObserved`，却进入正式 Runtime Catalog。

## 7. 准入记录

```yaml
runtime:
adapter_kind:
upstream_version:
platform:
nearest_production_adapter:
host_strategy:
session_strategy:
bootstrap_strategy:
compaction_strategy:
auth_model_strategy:
skill_strategy:
mcp_strategy:
usage_strategy:
evidence_revision:
admission: research | core_compatible | first_class
accepted_upstream_differences: []
known_limitations: []
reviewer:
date:
```

提交 PR 前必须附上：

1. 完整 Parity Matrix；
2. Golden Flow 真实运行结果；
3. 每个 `Unsupported` 的上游证据和产品差异决定；
4. `Runtime × version × platform × capability` 证据清单；
5. 对现有一等 Runtime 用户可观察行为的差异摘要。
