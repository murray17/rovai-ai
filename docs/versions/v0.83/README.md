---
document_type: version-overview
version: v0.83
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-15
---

# Rovai-ai v0.83：TRAE CLI CN Runtime

> 当前状态：真实 ACP Probe、生产 Adapter、数据迁移和 Renderer 接入已完成；completion、Approval、
> Missing-Send、MCP Projection、打包态 UI 与交付门禁均已通过。
>
> 前置版本：[v0.82 冷启动恢复壳层与 bundled Skill 快速路径](../v0.82/README.md)

## 版本目标

把 TRAE CLI 中国企业版作为第十种可执行 Product Runtime 接入 Rovai。入口固定为
`traecli acp serve`，协议固定为 ACP v1；实现复用现有 ACP Host、AgentRun、Action/Approval、
Native Session 与 Runtime Activity 路径，不增加独立 Transport。

准入先来自真实 `initialize`、`session/new` 和行为 Probe，再进入正式 AgentRun。模型目录、权限
mode、Session 恢复和 MCP 能力全部按目标安装的实际返回建立，不静态伪造；默认权限为 `default`，
不得默认使用 `--yolo`。

设置页同时显示一个不具备执行语义的 DeepSeek Harness “待支持”预告。它不是
`AdapterKind`、Installation、成员选项、健康状态或数据库 kind，不能触发 Probe 或 AgentRun。

## 实测准入基线

2026-08-15 对本机 `traecli 0.120.52`（commit
`6756e52a9238b6d493928e55b05127957dbfefb4`）执行了隔离临时工作区 Probe：

| 轴 | 观察结果 |
| --- | --- |
| ACP / stdout | `protocolVersion: 1`；stdout 全程为合法 JSON-RPC，stderr 无协议污染 |
| Session / model | `session/new` 返回稳定 ID；模型 select 与 16 项目录来自 Session 动态返回；跨 Host `session/load` 成功 |
| Prompt / cancel | 普通 prompt 为 `end_turn`；运行中 cancel 为 `cancelled`，延迟副作用未发生 |
| Tool / permission | tool lifecycle ID 稳定；结构化 permission request 的 allow/reject option 可映射 Rovai Approval |
| MCP | 通过 `session/new` / `session/load` 做 `AdditivePerRun`；只追加到当前 AgentRun，未写 Runtime 全局配置，未泄漏到未配置的相邻 Session |
| System prompt / Charter | `append_system_prompt` 的独立 system message 与 marker 行为已实测；正式集成仍使用 `FirstPayload` Charter，不把模型服从性当协议保证 |
| Skill / recovery | 未证明 Rovai Skill 原生路径，保持 documentation-only empty；Missing-Send zero-send、accepted-send suppression、tool→final 正式 Smoke 通过 |

原始研究简报、脱敏 Capability Snapshot 和 Probe 判定见
[TRAE CLI Runtime Research](../../research/trae-cli-runtime/README.md)。

## 交付范围

- Rust/TypeScript `AdapterKind` 增加稳定 wire identity `trae-cn-cli`；可执行候选名为 `traecli`；
- Product Runtime deep probe 区分 Ready、Authentication Required、Incompatible 与 transient Probe failure；
- Registry 从实际 ACP Session 建立模型与权限 mode catalog，并要求安全的 `default` mode；
- 正式 AgentRun 复用 ACP Host，支持 prompt 终态、取消、结构化 Approval、Session load 与
  per-Run additive MCP；完成后停止 Host，不声称 warm reuse；
- Runtime Activity 以 ACP 结构化 kind 和稳定 `toolCallId` 进入既有 fine-grained mapping；
- Data Contract 升级为 `v0.83 / projection schema 41 / migration 86`，保留旧绑定并只新增
  `trae-cn-cli` closed kind；
- Runtime 设置、成员参数和所有 Adapter label 接入 TRAE 官方图标；DeepSeek Harness 只作为
  Renderer 内的 disabled “待支持”预告；
- 未证明的 Skill projection 和 compaction detector 不随支持状态自动开启；Missing-Send Recovery 只因
  TRAE 专项 zero-send、accepted-send suppression、tool→final 证据而启用。

## 非目标

- 不新增 TRAE Transport、全局配置副本、MCP 隔离模式或默认 `--yolo`；
- 不把当前实测模型清单、Session ID、用户级 instruction/Skill 路径写成产品常量；
- 不让 DeepSeek Harness 进入 Contracts、Core、Migration、Probe、诊断、成员选择或 AgentRun；
- 不因一次登录态 Probe 推断所有版本、账号或上游构建均兼容。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.82 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v0.83。 |
| ADR | 已更新 | [ADR-0189](../../adr/0189-settings-only-runtime-preview-outside-product-catalog.md)允许严格 presentation-only 的设置页待支持预告，同时保留 executable catalog 的实证准入边界。 |
| Contracts | 已更新 | TypeScript/Rust closed `AdapterKind` 与 [Diagnostics Center v1](../../contracts/diagnostics-center-v1.md)扩展为全部受支持目录项；DeepSeek 不进入合同。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)记录 Product Runtime、Availability 与 Settings Preview 的权威分层。 |
| UI | 已更新 | [Settings workspace brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)记录受支持 Runtime 与 disabled preview 的视觉、交互和状态边界。 |
| Runtime Activity | 已更新 | [Mapping Registry](../../runtime-activity/registry.md)加入 `trae-cn-cli` ACP v1 fine-grained 映射及真实 Probe 证据。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录 TRAE `0.120.52` 的 capability/行为实测，并把 DeepSeek Harness 标为 UI-only preview。 |
| Documentation routing | 已更新 | [文档导航](../../README.md)增加 Runtime 接入研究/Probe 入口并路由到本版本与长期目录边界。 |
| Root README | 已更新 | [项目 README](../../../README.md)把常青支持范围表述为十种可执行 Runtime，并明确待支持预告不等于可执行能力。 |

## References

- [实施与验收计划](implementation-plan.md)
- [TRAE CLI Runtime Research](../../research/trae-cli-runtime/README.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [ADR-0189](../../adr/0189-settings-only-runtime-preview-outside-product-catalog.md)
