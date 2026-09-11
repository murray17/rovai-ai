---
document_type: version-overview
version: v1.57
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: in-progress
model_context_change: false
last_updated: 2026-09-10
---

# Rovai-ai v1.57：官方 ZCode Runtime

前置：[v1.56](../v1.56/README.md)。本版本新增官方 ZCode App 内置 Runtime，支持原生账号登录配置与 BYOK，
复用现有 Runtime Fleet、Context FirstPayload、审批与文件 Evidence 链路。

## 范围与当前状态

- Product identity 为 `zcode-app`；只接受官方 App bundle，不接受社区 npm CLI/ACP 包。
- macOS arm64 在实现与资格验收期间为 Preview；其他平台保持 NotQualified。
- 原生 NDJSON 在进程内转换为既有 Core Session transport；公开来源仍标明 ZCode 协议。
- 官方用户/项目配置提供模型与 MCP，Rovai 不建立 provider 或密钥配置页。
- App 账号配置 fallback 与目录加载已实现。按用户确认的 zcode-acp 处理边界交付：个人 Coding Plan
  凭据交给官方内核，Start Plan 的临时验证回调明确拒绝并给出认证错误；免费账号生成未打通。
  个人 Coding Plan 具有配置与协议回归，缺少真实订阅验收；该项不再阻止本次 Preview 收口，不冒充实测通过。
- Read/Write/Edit 路径事实与 Edit 结构化 patch 分别准入；不从参数或磁盘猜测 Diff。
- Migration 149 增加 Runtime、Skill 和 Compaction 闭集，从 `v1.56/schema 98/activity-v4` 升级到
  `v1.57/schema 99/activity-v4`。既有分类规则与历史 Evidence 不变。
- 当前验证进度见[实施与验收](implementation-plan.md)；协议实验与产品资格分别记录。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.56 冻结为 historical；本概览、实施计划和版本索引建立 current v1.57 |
| Decisions | 已更新 | [V1.57-D01](decisions.md#v1-57-d01)解释官方内核与共享生命周期，[D02](decisions.md#v1-57-d02)明确 Preview 资格边界 |
| Contracts | 已更新 | [Runtime Launch v37](../../contracts/runtime-launch-and-verification-v37.md)、[File Change v5](../../contracts/runtime-file-change-observation-v5.md)定义新增 Runtime 的 wire 与证据边界 |
| Architecture | 已更新 | [Runtime Catalog](../../architecture/runtime-catalog-boundaries.md)、[Bootstrap Redelivery](../../architecture/native-session-bootstrap-redelivery.md)、[File Change](../../architecture/runtime-file-change-observation.md)增加 ZCode |
| UI | 确认无需更新 | 新 Runtime 使用既有产品选项、Preview、参数表单与文件 Evidence 呈现；无新交互合同 |
| Runtime Activity | 已更新 | [Registry](../../runtime-activity/registry.md)新增原生工具映射；现有分类语义不变，无历史重分类 |
| Runtime compatibility | 已更新 | [Compatibility](../../runtime-compatibility.md)分开记录官方实验、产品验证与未资格化平台 |
| Documentation routing | 已更新 | Contracts 索引、当前决定导航和任务入口指向新合同 |
| Root README | 确认无需更新 | 项目定位与常青能力不变；Preview Runtime 资格由当前兼容性清单拥有 |

后续：[v1.58](../v1.58/README.md)。
