---
document_type: version-overview
version: v1.29
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-08-25
---

# Rovai-ai v1.29：Pi Coding Agent Runtime 接入

> 当前状态：Pi Coding Agent `0.84.2` 的 Core 接入和经开发者确认的
> [model-context-change revision 1](model-context-change.md)已经实现：正式 Host 使用 Pi 原生认证和默认模型，
> 进入 workspace 级 resident LRU，并按 AgentRun 动态绑定 Bootstrap、Skills、stdio MCP、模型和 exact
> Native Session。合并 `main` 后按新版 First-Class Checklist 重新审计，当前结论是
> **`core_compatible`，尚不能标记 `first_class`**：Compaction、结构化 Usage、Skill/MCP 完整 lifecycle 矩阵、完整
> Tool output/Missing-Send/cleanup Golden Flows 与不可变平台资格证据仍未全部闭合。代码中的目录投影因此是
> 待完成准入的实现事实，不应被本文解释为已经满足新版正式发布门槛。
>
> 前置版本：[v1.28 Grok Build + MiniMax M3 本地 Runtime 接入](../v1.28/README.md)已按冻结时事实转为
> historical。

## 版本目标

依据 [Pi Runtime Research](../../research/pi-runtime-research.md)与
[Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)，直接使用 Pi 官方 JSONL RPC，
不抓取 TUI，也不引入第三方 ACP shim。Rovai 保留 Pi 原生 Session 和认证体系，同时以受管 Extension、私有
binding/receipt、Core MCP bridge 和 durable Approval 补齐 Pi 没有原生 sandbox/permission system 的边界。

Revision 1 的模型输入变化已在 `2026-08-25T10:34:14+08:00` 由 Murray Xue 二次确认。Bootstrap 在 Pi System
Prompt 中的位置、项目原生 `.pi/skills`、MCP schema/result、身份冻结或模型选择副作用若再次改变，必须递增
revision 并重新确认。

## 交付范围

- 保留 `AdapterKind=pi`、`pi-jsonl-rpc-v1`、Runtime Activity descriptor、Renderer 目录和 macOS arm64
  admission 实现；Migration 109 增加 Pi catalog，Migration 110 增加 managed context，最终 Data Contract 为
  `v1.24 / schema 65 / migration 110`；
- 正式启动只固定隔离门禁和 `rovai-pi-host-v2`，不再传 `--provider/--model/--append-system-prompt/--skill/
  --tools`，也不覆盖 `PI_CODING_AGENT_DIR` 或读取 Claude settings；
- `pi://runtime-default` 使用 Pi 原生默认；显式 `pi://model?...` 通过 `get_available_models -> set_model ->
  get_state` 精确验证，并诚实保留 Pi 会更新原生全局默认的副作用；
- Pi Host compatibility 改为 workspace/process 级。Camp、member、Session、identity、Bootstrap、Skills、MCP、
  model 和 thinking 都由逐 Run binding/receipt fence，不污染 resident LRU key；
- 每个 Run 先 `switch_session(<exact canonical file>)` 或 `new_session`，再验证 full UUID、file、cwd、模型、
  Skill catalog 和 active Tools。一个 Host 只串行执行；并发 Run 分配不同 Host，跨 Workspace 不复用；
- Pi 单独使用 `managed_system_prompt`。Bootstrap Evidence v2 冻结完整六字段 Member Identity 和 full Bootstrap
  bytes；Extension 以 `P_final = Pi base prompt + "\n\n" + frozen Bootstrap` 投递，并在 provider request 前提交
  blocking Managed Input Receipt v1；
- `.pi/skills` 每次 Session activation 动态发现，包含 Workspace 合格的项目原生 Pi Skills和 Rovai
  Reconciler 的 ready Skills；`get_commands` 与 receipt 验证 once-only、name、description、path 和 containment；
- External MCP 改为 `AdditivePerRun / RovaiWins / CoreManaged`：stdio 由 Core 完成 initialize/list/call 并注册
  Pi proxy Tools，每次调用都 durable approve；Streamable HTTP 继续 unsupported；
- `bash/write/edit` 继续 blocking Approval，read/search 不弹审批；未知 Extension UI、Tool、mutation、超时、
  restart、receipt/cleanup mismatch 全部 fail closed；Pi 本身仍没有 sandbox；
- `message_end.message` 是权威 assistant snapshot，`agent_settled` 是唯一成功 terminal/Missing-Send boundary；
  prompt response 只有在 managed receipt committed 后才可成为 accepted ACK；
- Pi 不建立 Bootstrap ordinary-message redelivery 或 compaction Requirement。Usage/Cost Disabled；Compaction 在
  ordinary/manual/threshold/overflow+retry 四类真实证据齐备前保持 Disabled/unqualified。

## Session、身份与迁移

Native Session continuation 只保存 full Pi UUID 与 exact canonical Session file。cold resume 不使用 partial ID、
`--continue`、recent scan、fuzzy match 或 portable history replay；失败记录 controlled continuity loss 并 fail
closed，不为同一输入悄悄建立 replacement Session。

Identity 属于 Native Binding，不属于 Host。同一 Binding 的后继 Run 复用 Evidence v2 冻结的 exact Member
Identity/Bootstrap；AgentProfile 编辑不会热更既有 Pi Session。新 Native Session/Binding 才读取新身份，所以
一个 resident Host 可以先后承载不同成员而不串身份。

Migration 110 fence 所有缺少 frozen identity/managed receipt 的旧非终态 Pi technical state，使用稳定
`pi_managed_context_v1_required` 失败码并清除旧 locator；已完成的 CampMessage、Task、Action/Approval、Activity、
final 和历史 Evidence 保留只读。启动时旧 Pi session/config root 移入版本化 inactive-data quarantine；非 Pi
Binding、ContextManifest 和 Runtime Input Delivery 不失效。

## 验证与新版 Checklist 状态

- 真实本机 `/opt/homebrew/bin/pi` `0.84.2` 通过 native-default Prompt、`rovai-pi-host-v2` managed receipt 和
  `agent_settled`；Rovai 未读取或输出本机认证秘密；
- `pnpm smoke:pi-runtime` 的 Core→Pi→真实 provider 链路通过 cold exact resume、workspace resident warm reuse、
  managed allow/deny 和取消后的 descendant cleanup；
- 真实 Pi `0.84.2` 经 Core-owned bridge 调用了两个 assigned stdio MCP Tool，逐次 durable Approval 成功；HTTP
  exposure 保持 `adapter_unsupported`；
- 真实 Pi Skill smoke 完成 managed Skill native invocation、Core restart、project-owned conflict 保留与
  hard-delete lifecycle；更新/删除后的相邻 Session 隔离仍待完整 Golden Flow；
- 真实 Missing-Send smoke 的 zero-send publication 与 accepted-send suppression 通过；Pi 独立 tool→final
  recovery 断言仍待补齐；
- Rust 回归覆盖 workspace resident reuse、member/camp invalidation 不淘汰 Pi Host、Bootstrap identity freeze、
  accepted receipt gate、无 Pi redelivery overlay，以及 Grok 107/108 后的 Pi Migration 109/110；
- 合并后的确定性门禁与真实 smoke 结果由[新版 Checklist 对比报告](checklist-report.md)逐项记录，未执行的
  Golden Flow 不以旧分支结果、fixture 或实现存在冒充；
- 合并后 Built-in CLI full smoke 的 source 15-operation Run 和 Gather completion 已执行，但 recipient Run 被
  当前 Pi native-default provider 的 concurrent-request budget 拒绝；该次结果不计 Pass，也不据此误判 CLI
  实现失败；
- revision 1 没有把 Usage/Cost 或 Compaction 晋升为产品能力，也没有把 arm64 结果外推到 macOS x64/Windows；
  按新版 Checklist，这两项 Disabled 状态本身就是 First-Class 阻断项，而不是可忽略差异。

## Pi 与其他 Runtime 的关键区别

| 轴 | Pi | 其他主要 Runtime |
| --- | --- | --- |
| Resident LRU | workspace 级进程复用，Session/identity/model/MCP 都逐 Run 切换 | Codex/ACP 多按更完整的 Host compatibility 复用；Claude/Antigravity 为 one-shot，不进入 resident Fleet |
| Bootstrap | `before_agent_start` 动态追加，完整身份/Bootstrap 冻结并有 cross-process receipt | 主要是 native append 或 first payload；没有 Pi managed receipt |
| Skills | 每次 Session activation 只发现 exact `W/.pi/skills`，项目原生与 Rovai managed 合并验证 | 使用各 Runtime 原生目录/投影机制，常见为启动或 Session 参数固定 |
| MCP | Core-owned stdio bridge + Pi proxy Tool + 每次 Core durable Approval；HTTP 不支持 | ACP/Claude/Codex 等多走 Runtime-native additive projection 与其原生 approval；Antigravity 当前仅 native MCP |
| Resume | full UUID + exact canonical file，`switch_session`，失败 fail closed | ACP/Codex 使用各自 native resume/load；Claude/Antigravity one-shot 由新进程续接其原生 conversation |
| Identity | 按 Native Binding 冻结，Host 可跨成员串行复用，不热更既有 Session | 通常与 Native Session Bootstrap 一起固定，但不会使用 Pi 的 per-run managed receipt |

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.28 冻结为 historical，v1.29 成为唯一 current；revision 1 在同一已确认版本内完成受治理的模型上下文修正。 |
| Model context | 已确认并实施 | [Revision 1](model-context-change.md)冻结最终 System Prompt、Skills/MCP、receipt、迁移和模型副作用。 |
| Decisions | 已更新 | [V1.29-D02](decisions.md#v1-29-d02)替代 D01 中的 provider overlay、一 Host 一 Session、fixed Skill 与 MCP Unsupported。 |
| Contracts | 已更新 | [Runtime Launch and Verification v27](../../contracts/runtime-launch-and-verification-v27.md)成为当前入口；v26 转为历史。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)记录 Pi resident/process key 与 per-run binding。 |
| UI | 确认无需更新 | 既有 Pi Runtime/模型/权限入口继续消费 capability snapshot；revision 1 只改变 Runtime 与 Evidence 语义。 |
| Runtime Activity | 已更新 | [Mapping Registry](../../runtime-activity/registry.md)补充 managed receipt、MCP Approval 与当前真实证据层次。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)与[新版 Checklist 报告](checklist-report.md)区分真实、fixture 和未资格化证据。 |
| Documentation routing | 已更新 | 文档导航、Checklist、合同索引和当前决定导航全部路由到 Runtime Launch v27。 |
| Root README | 已更新 | Pi 能力表改为 Core-managed stdio MCP、native+managed Skills 与 binding-frozen identity。 |

## References

- [确认的模型上下文变更](model-context-change.md)
- [实施与验收计划](implementation-plan.md)
- [新版 Checklist 对比报告](checklist-report.md)
- [版本决定](decisions.md)
- [Runtime Launch and Verification v27](../../contracts/runtime-launch-and-verification-v27.md)
- [Pi Runtime Research](../../research/pi-runtime-research.md)
- [Runtime 接入与准入 Checklist](../../development/runtime-integration-checklist.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
