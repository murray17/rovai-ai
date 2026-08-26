---
document_type: acceptance-record
version: v1.30
authority: version-runtime-integration-acceptance
status: core_compatible
last_updated: 2026-08-26
---

# v1.30 Pi Runtime 新版 Checklist 对比报告

本报告按合并 `main` 后的
[Agent Runtime 一等接入与准入 Checklist](../../development/runtime-integration-checklist.md)重新审计 Pi。清单当前
文档状态虽为 `proposed`，本报告按其中最严格完成定义判断，不沿用旧分支中“Disabled 不阻断基础 Runtime”的
口径。实现存在、fixture 通过、平台代码为 `qualified` 和 First-Class evidence 是四件不同的事。

## 准入记录

```yaml
runtime: Pi Coding Agent
adapter_kind: pi
upstream_version: 0.84.2
platform: macos-arm64
nearest_production_adapter: codex-cli for managed native protocol; kimi-code-cli for native auth/model and exact continuation
host_strategy: resident_multi_session
session_strategy: full UUID plus exact canonical session file; switch_session or new_session; fail-closed resume
bootstrap_strategy: managed_system_prompt with Bootstrap Evidence v2 and blocking Managed Input Receipt v1
compaction_strategy: native_system_prompt_preserved candidate; not yet qualified
auth_model_strategy: Pi native home/default; explicit list/set/state with disclosed global-default side effect
skill_strategy: per-session exact workspace .pi/skills, native project plus Rovai-managed ready Skills
mcp_strategy: AdditivePerRun / RovaiWins / CoreManaged stdio proxy; HTTP not implemented
usage_strategy: Disabled pending structured-event attribution and dedupe qualification
evidence_revision: pending immutable adapter-scoped artifact
admission: core_compatible
accepted_upstream_differences:
  - official JSONL RPC instead of ACP
  - explicit set_model persists Pi's global native default
  - no native sandbox or approval system; Core-managed durable approval is required
known_limitations:
  - compaction continuity Golden Flow incomplete
  - structured usage/cache/cost not qualified
  - real Skill update/delete isolation and MCP assignment lifecycle Golden Flow incomplete
  - six-class command-output and Missing-Send tool-to-final matrix incomplete
  - post-merge Built-in CLI full smoke was externally interrupted by the native provider's concurrent-request budget
  - crash, probe-timeout and App-shutdown cleanup matrix incomplete
  - macos-arm64 lacks an immutable adapter-scoped First-Class artifact; macos-x64 and windows-x64 are not qualified
  - current catalog/platform visibility is ahead of this strict admission conclusion
reviewer: Codex
date: 2026-08-25
```

## Parity Matrix

| 核心能力轴 | Rovai 标准行为 | Pi 上游能力面 | 接入策略 | 状态与证据 | 接受的差异 / 阻断 |
| --- | --- | --- | --- | --- | --- |
| Auth / Provider / Model | Runtime 原生认证/default 与真实 catalog；secret 隔离；状态 drift 可刷新或 fence | 原生 `~/.pi/agent`、login/BYOK/subscription、`get_available_models/set_model/get_state` | 正式 Host 不读 Claude、不建 overlay；default 原样使用，显式选择逐 Run 核对 | **Verified + Implemented**：native-default 真实 Prompt 通过，argv/env/公开 Evidence 脱敏测试通过 | 接受显式选择会修改 Pi 全局默认；仍需把 auth/model drift 的完整 resident refresh 纳入资格 artifact |
| Host / Fleet / LRU | 声明策略并进入统一 Fleet；multi-session 要 switch-back、并发与无泄漏 | RPC 进程可驻留，`switch_session/new_session` 会重建 Session resources | workspace/process compatibility key；single-flight；per-Run binding；并发新 Host | **DocumentationOnly + Implemented**：Fleet/invalidations/cleanup 确定性测试和 warm smoke 已有，真实 A→B→A + concurrency Golden Flow 未完整冻结 | 非上游 Unsupported；阻断 First-Class |
| Native Session / Continuation | stable binding；warm、Host restart、Core restart exact resume；禁止模糊恢复 | full Session UUID、canonical JSONL file、exact `switch_session` | full UUID + exact file；失败 continuity-lost 并 fail closed | **Verified + Implemented**：真实 Core restart/cold exact resume 与 deterministic wrong-locator fence 通过 | Pi 新 Session file 延迟 materialize；成功 release 才要求 header/UUID/cwd |
| Bootstrap / Context | 高权限层；first/warm/switch/cold 正确且不重复、不串线 | `before_agent_start` 可覆盖本轮 System Prompt；ResourceLoader 随 Session 重建 | `managed_system_prompt`、Evidence v2、private binding、blocking receipt | **Verified + Implemented**：真实 managed receipt Prompt、identity-freeze/no-redelivery tests 通过 | Pi 独有 cross-process receipt；Compaction 连续性另列阻断 |
| Compaction continuity | 明确策略；manual/threshold/overflow+retry/cold resume 全部保持 Context 合同 | System Prompt 候选可由 Pi Session/compaction 保留；存在结构化 compaction/usage 候选事件 | 当前只实现 protected System layer 与 no ordinary-message redelivery | **NotObserved + Disabled**：未完成四类真实矩阵 | 不是 accepted Unsupported；硬阻断 |
| Skills | 统一设置/group；native/project 兼容追加；更新删除无泄漏；真实列出或调用 | `.pi/skills`、ResourceLoader、`get_commands` | exact workspace root；项目原生 + Rovai ready；每 Session receipt 验证 | **Verified + Implemented（基础调用）**：真实 Pi `0.84.2` 调用了 managed Skill；restart、project-owned conflict 与 hard-delete lifecycle 通过 | 同一真实链路尚未证明 update/delete 后下一 eligible Session 生效及 A→B→A 无泄漏；阻断 First-Class |
| External MCP | Prepared projection；追加/同名/secret/approval/cancel/无泄漏 | 核心无内建 MCP，但官方 Extension Tool API 可注册代理 Tool | Core-owned stdio bridge + per-Run Pi proxy + durable Approval | **Verified + Implemented（stdio 基础调用）/ NotImplemented（HTTP）**：真实 Pi `0.84.2` 经 Core bridge 调用两个 assigned stdio Tool 并逐次 durable approve；HTTP exposure 为 `adapter_unsupported` | assignment 更新/删除、deny/cancel、相邻空 Session 无泄漏仍未形成真实矩阵；HTTP 也未获上游 Unsupported 证据；硬阻断 |
| Tool / Action / Command Output | stable ID；唯一 lifecycle；stdout/stderr/mixed/empty/nonzero/large 全部真实验证 | `tool_execution_start/end` 提供原生 ID/name/input/result | 结构化 Action、bounded output、managed mutation approval | **NotObserved + Implemented**：基础 read/write/allow/deny/cancel 真实通过；六类 output 全矩阵未执行 | 硬阻断 |
| Narration / Final / Missing-Send | 公开文本边界；唯一 final；三类 Missing-Send | `message_end.message` snapshot；`agent_settled` terminal | accepted receipt gate；settled-only success；stream/snapshot 去重 | **Verified + Implemented（两类）**：合并后真实 Pi 的 zero-send publication 与 accepted-send suppression 通过 | 独立 tool→final recovery 断言未覆盖 Pi；三类尚未在同一 adapter-scoped artifact 中闭合 |
| Permission / Approval / Workspace | 最高权限默认/read-only 收窄；allow-once/deny/cancel；真实 workspace 限制；unknown fail closed | Pi 无原生 sandbox/permission；Extension 可拦截 native Tool/UI | managed-only；`bash/write/edit` durable approve；unknown mutation/request fail closed | **Verified + Blocked**：allow/deny/cancel 实证；Pi read/search 仍依赖 OS 用户权限，严格 workspace filesystem containment 未完整证明 | 接受无 native sandbox，但不豁免 Rovai workspace 要求；硬阻断 |
| Built-in `rovai` CLI | 当前 bundled CLI、lease 与完整正式 operation smoke | 经 native `bash` 可执行 CLI | per-Run atomic lease；与 MCP 分开声明 | **NotObserved + Implemented**：合并后真实 rerun 已执行 source 15-operation Run 和 Gather completion，但 recipient Run 被 Pi native-default provider 的 concurrent-request budget 拒绝 | 属外部验收环境阻断，不是本次观察到的 CLI 合同失败；严格清单仍不能记 Pass |
| Usage / Cache / Cost | 有结构化字段就实现可证明字段；scope/counter/dedupe 正确 | RPC 存在候选 usage/message update 与 Session totals，需要确认字段语义 | 当前不采集、不推断、不写零值 | **NotObserved + Disabled** | Disabled 不能通过；需探测并实现可证明字段，或逐字段证明 Unsupported；硬阻断 |
| Retry / Queue / Cancel / Cleanup | accepted 防重投；迟到隔离；cancel 无延迟副作用；所有退出无残留 | RPC prompt/abort、process tree、Extension/MCP 子进程 | receipt 后 accepted；generation fence；abort + Fleet Stop | **NotObserved + Implemented**：real cancel/descendant cleanup 通过；crash、协议错、Probe timeout、App shutdown 与 late-event 全矩阵未冻结 | 硬阻断 |
| Ready / Version / Platform | availability/auth/qualification 分离；能力逐项绑定版本平台；每个发布平台 Golden Flow | `pi --version`、RPC state；上游有多平台实现 | 仅代码中 macOS arm64 admission；x64/Windows 拒绝 | **DocumentationOnly + Blocked**：arm64 缺独立不可变 First-Class artifact，其他平台无证据 | 当前 `qualified` row 与严格审计不一致；硬阻断 |

结论：明确通过的轴不足以抵消任何一项 Disabled、Blocked、DocumentationOnly 或 NotObserved。按新清单，Pi 不得
标记 `first_class`。

## Golden Flow 对比

| Flow | 当前结果 | 证据层次 | First-Class 结论 |
| --- | --- | --- | --- |
| First Run | native default、managed receipt、公开 final、基础 Tool/Approval、真实 Skill 与 stdio MCP 调用通过；Built-in 完整 rerun 未收敛 | 真实 Pi + deterministic | 部分通过；需闭合 Built-in/output 并合并为同一冻结资格链 |
| Warm Host | same-workspace warm reuse 通过 | 真实 Pi + Fleet test | 部分通过 |
| Multi-Session / Concurrency | exact switch/new 与 generation fencing 已实现 | deterministic/source evidence | 未通过；缺真实 A→B→A、并发双 Host、无泄漏 |
| Cold Resume | Core/Host restart 后 exact file/full UUID 通过 | 真实 Pi | 通过 |
| Context / Compaction | ordinary managed prompt 通过 | 真实 Pi | 未通过；manual/threshold/overflow+retry/compact cold resume 缺失 |
| Skill / MCP Projection | 真实 managed Skill 调用、两个 assigned stdio MCP Tool 与 durable Approval 通过 | 真实 Pi + deterministic | 未通过；缺真实 update/delete、MCP deny/cancel 与相邻 Session 无泄漏 |
| Safety / Output | allow/deny/cancel 通过 | 真实 Pi | 未通过；缺 read-only/workspace containment 与六类 output |
| Monitoring | Usage 保持 unknown/Disabled | implementation only | 未通过 |
| Failure / Cleanup | cancel descendant cleanup 通过 | 真实 Pi | 未通过；缺 crash/protocol/probe/shutdown 完整矩阵 |

## Runtime × version × platform × capability 证据

| Runtime | Version | Platform | Capability | 当前 evidence | 资格 |
| --- | --- | --- | --- | --- | --- |
| Pi | 0.84.2 | macOS arm64 | native auth/default、first run、managed receipt、final | 本机真实 smoke；未保存 secret/Prompt/Session locator | 可作为后续 artifact 输入 |
| Pi | 0.84.2 | macOS arm64 | cold exact resume、warm reuse、allow/deny、cancel cleanup | `scripts/smoke-pi-runtime.mjs` 真实链路 | Core Compatible |
| Pi | 0.84.2 | macOS arm64 | Bootstrap identity freeze、receipt/accepted gate、LRU/binding fences | Rust deterministic/slow tests | Fixture，不替代 Golden Flow |
| Pi | 0.84.2 | macOS arm64 | managed Skill native discovery/invocation | `ROVAI_SKILL_SMOKE_ADAPTERS=pi pnpm smoke:skills` | 基础真实调用通过；更新/删除 Session 矩阵未闭合 |
| Pi | 0.84.2 | macOS arm64 | stdio MCP initialize/list/call/result normalization、durable Approval、HTTP rejection | `ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS=pi pnpm smoke:mcp-projection` | 基础真实调用通过；完整 assignment/cancel/isolation 矩阵未闭合 |
| Pi | 0.84.2 | macOS arm64 | Missing-Send zero-send 与 accepted-send suppression | `ROVAI_MISSING_SEND_RECOVERY_ADAPTERS=pi pnpm smoke:missing-send-recovery` | 两类真实通过；tool→final 仍缺 |
| Pi | 0.84.2 | macOS arm64 | Built-in CLI full operation set | `ROVAI_BUILTIN_CLI_ADAPTERS=pi pnpm smoke:builtin-cli` | source operations 完成；recipient 被 native provider concurrent budget 拒绝，结果不计 Pass |
| Pi | 0.84.2 | macOS arm64 | Compaction、Usage、完整 output/cleanup | 无完整证据 | 未资格化 |
| Pi | 0.84.2 | macOS x64 | 全部 | 未执行 | Not qualified |
| Pi | 0.84.2 | Windows x64 | 全部 | 未执行 | Not qualified |

仓库当前没有 `qualification/runtime-platform/macos-arm64-pi-*.json` 这类不可变、adapter-scoped First-Class
artifact；兼容性文档 digest 不能替代缺失的真实轴。

## 与其他 Runtime 的用户可观察差异

| 维度 | Pi | 其他 Runtime 的典型形态 |
| --- | --- | --- |
| LRU | workspace 级 resident multi-session Host；Session/identity/model/Skills/MCP 都逐 Run 切换 | ACP/Codex 多复用 compatible resident Host；Claude/Antigravity 是 one-shot process，不存在“关闭 LRU 开关” |
| Bootstrap | Pi base System Prompt 尾部动态追加；full identity/Bootstrap 按 Binding 冻结并有 blocking receipt | 常见为 native append、first payload 或 Runtime rules；通常没有 Pi 的 cross-process managed receipt |
| Skills | 每次 Session activation 重建 ResourceLoader，精确发现 `.pi/skills`，项目原生与 managed 合并 | 其他 Runtime 多通过各自原生目录、argv 或 Session projection，刷新粒度随 Runtime 不同 |
| MCP | Core 运行 stdio Server，Pi 只看到 proxy Tool，每次调用由 Core durable approve | ACP/Codex/Claude 等通常把 server 定义投给 Runtime-native MCP；Antigravity 当前只保留 native MCP |
| Resume | full UUID + exact canonical file，通过 `switch_session` 恢复；失败 fail closed | ACP 常用 `session/resume/load`，Codex 用 native thread resume；Claude/Antigravity one-shot 由新进程续接原生 conversation |
| 身份保持 | 身份属于 Native Binding，不属于 Host；同 Session 冻结，Profile edit 不热更，新 Session 才更新 | 其他 Runtime 通常也按 Native Session Bootstrap 固定，但不经过 Pi 的 per-Run binding/receipt |
| Auth/model | 直接使用 Pi native Home/default；显式模型会更新 Pi 全局默认 | 各 Runtime 使用自身 native auth/config；不允许借 Claude key 冒充 Pi provider |
| Compaction/Usage | 当前未达到新版 First-Class | 多个现有 Runtime 也有 Disabled/NotObserved 历史项；新版清单同样要求未来重新审计，不能拿旧 Runtime 的宽松历史口径豁免 Pi |

## 收口条件

Pi 只有同时满足以下条件才可把本文件 `status/admission` 改为 `first_class`：

1. 补齐所有失败轴的真实 Golden Flow，并生成不含 secret/Prompt/完整 Native ID 的 immutable adapter-scoped
   artifact；
2. 对 Usage 与 Compaction 实现可证明语义，或提供可靠上游 Unsupported 证据并新增版本决定；
3. 对 Streamable HTTP MCP 作实现或可靠 Unsupported 裁决，不能以“首版没有做”结案；
4. 解决当前 Product Catalog/platform `qualified` 投影早于严格 admission 的不一致；
5. 重新运行合并后完整 Rust、Node、TypeScript、Desktop build、文档治理和真实 Pi smoke。
