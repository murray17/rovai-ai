---
document_type: version-overview
version: v1.43
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-09-04
---

# Rovai-ai v1.43：Pi 原生输入边界与 Fleet 并发启动

前置：[v1.42](../v1.42/README.md)。本版本收敛 Pi Coding Agent 的责任边界：Rovai 只投递普通 Agent
Prompt、结构化图片、Bootstrap、最小 receipt 与部分审批，Pi 自己发现原生资源；同时把公共 Runtime Fleet 的
耗时 spawn 移出全局锁，并精确限定 exact-resume replacement。

## 范围与当前状态

- 正式 Pi 永远以原生资源加 `rovai-pi-host-v6` 薄 extension 的一种模式启动；删除 `--no-extensions` fallback、
  `resources_discover.skillPaths` 和 Runtime catalog attestation。
- Rovai 不模拟 Pi TUI：不调用 `get_commands`，不解析或展开 `/command`；Formatter 22 的
  `prepared_context.rendered_payload` 原样成为 `prompt.message`。
- 图片继续由结构化 ContextManifest attachment refs 经过授权、MIME、digest 和大小复核后进入
  `prompt.images`；私有证据直接绑定 Runtime Input Delivery，不再依赖 Prompt Transform。
- exact resume 只有明确 `ResumeContinuityLost` 才创建一个 replacement；Host、RPC、model、thinking、binding、
  receipt、diagnostic 与 Fleet 错误保持原错误并直接失败。
- Fleet `acquire` 使用 `Reserve → Spawn outside lock → Commit`；`Starting` 计入容量，相同 Run 等待同一结果，
  不同 Run/Runtime 可以并发启动，shutdown/删除 fencing 会退役在途 reservation。
- Pi External MCP 仍为 `Unsupported`，平台仍为 Preview；设置页、Assignment、其他 Runtime 与 qualification
  artifact 均不改变。

## 数据合同

Migration 138 只接受 `Data Contract v1.47 / Projection Schema 88`，原子升级为
`Data Contract v1.48 / Projection Schema 89`。它把 `pi_prompt_image_evidence` 升为直接绑定 Delivery 的 schema 2，
保留现有图片事实并删除 `pi_runtime_prompt_transform`。Pi receipt 与 Input accepted 的原子事务不变；Receipt 和
Image 都随父 `runtime_input_delivery` 合法级联删除，迁移后执行 `PRAGMA foreign_key_check`。

Pi binding/receipt 升为 closed schema 3，extension 版本为 `rovai-pi-host-v6`；删除 Skill root/exposure 与 command/
transform identity，只证明 Host、Run/epoch、Native Binding、Delivery/Prompt/Session、Bootstrap 和三个 governed Tool。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.42 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.43 |
| Decisions | 已更新 | [V1.43-D01](decisions.md#v1-43-d01)记录 Pi 原生资源和普通 Prompt 边界；[V1.43-D02](decisions.md#v1-43-d02)记录 Fleet Reserve/Spawn/Commit；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Runtime Launch and Verification v34](../../contracts/runtime-launch-and-verification-v34.md)替代 v33，定义 Pi binding/receipt schema 3、图片 evidence 2、resume taxonomy 与 Fleet reservation |
| Architecture | 已更新 | [Runtime 基础不变量](../../architecture/foundational-invariants.md#runtime-process-verification)与[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)同步原生资源、输入、恢复和锁外启动职责 |
| UI | 确认无需更新 | Pi 继续开放 Preview 供主动测试，MCP 页面、Assignment、成员配置与显示文案均不改变 |
| Runtime Activity | 确认无需更新 | Final、Action、Approval、Usage、diagnostic 与 Canonical Activity 映射没有字段或展示变化 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)把 Pi Skill 调整为 `DocumentationOnly`，并记录单一路径和普通 Prompt 的新证据边界 |
| Documentation routing | 已更新 | 文档总导航、Contracts 索引、当前决定导航与 Pi research matrix 均指向 Runtime Launch v34/current v1.43 |
| Root README | 确认无需更新 | 产品定位、安装方法和十四种 Runtime 公开支持范围不变；Pi 仍为 Preview |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [核心模型上下文变更 revision 1](model-context-change-pi-native-prompt.md)
- [Runtime Launch and Verification v34](../../contracts/runtime-launch-and-verification-v34.md)
- [Pi parity matrix](../../research/pi-runtime-reintegration-parity-matrix.md)
