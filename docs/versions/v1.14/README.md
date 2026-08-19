---
document_type: version-overview
version: v1.14
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-19
---

# Rovai-ai v1.14：`camp.read` 安全 Timeline 默认

> 当前状态：CLI、catalog、Skill、合同与文档路由已完成，并通过 Rust、Skill、文档和 smoke 模板门禁。
>
> 前置版本：[v1.13 AgentRun 实际 Runtime 模型展示](../v1.13/README.md)。v1.13 已完成并冻结为 historical。

## 版本目标

让 `rovai camp read` 成为安全、可直接使用的最近消息读取命令：省略 mode 时固定解释为
`timeline + before + limit 20`，显式 `--camp-id` 只改变目标 Camp。以消息为锚点的读取继续要求显式选择
`item`、`around` 或 `thread`，不根据 `messageId` 或其他模式专属字段猜测意图。

## 交付范围

### CLI 默认补全与错误

- direct flags、JSON stdin/heredoc 与 `--input-file` 先各自解析为单一 JSON 对象，再进入同一默认补全；
- 省略 mode 时补入 `timeline`，Timeline 中省略的 direction/limit 分别补为 `before`/`20`；显式值覆盖默认，
  cursor 不设默认；
- 补全发生在 canonical Schema 校验之前；Core 始终收到完整、已验证的 canonical input；
- 省略 mode 却传入 message-anchored 字段时返回定向 `fix_input`，要求显式选择模式，不自动推断。

### 教学与兼容

- `camp.read --help` 反映 CLI 的真实 optional/default 行为，同时保留各模式 requiredness、方向和分页说明；
- operation catalog 与 `cli-operations` Camp/History reference 说明默认、显式模式和 cursor 延续；
- Built-in Tool Transport 提升为 v17，Runtime capability 为 `builtin_cli.transport.v17`，Camp History 提升为 v4；
- Session Charter、`skills/cli-operations/agents/openai.yaml`、Bootstrap、Formatter 20 与 ContextManifest 18 不变。

## 明确不做

- 不修改 canonical Core `camp.read` Schema 的 required 字段；
- 不把 CLI 默认下沉为 Router、授权、分页、receipt 或 replay 的隐式状态；
- 不从 `messageId`、`bodyOffset`、`before` 或 `after` 猜测 message-anchored mode；
- 不修改 Session Charter 或 Skill 默认模型提示，不触发模型上下文 revision；
- 不改变 Camp ID、历史可见性、授权、输出 shape、cursor 数值或最大页大小。

## 数据与兼容性

本版没有数据库 Migration 或持久数据 shape 变化。v17 通过 capability、CLI command version、Camp History v4
和 catalog digest 对旧 Runtime Binding fail closed；已存 receipt 仍重放原 canonical result。CLI shorthand
不会写入持久状态，也不会改变 Core service 的 20 条页大小兜底。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.13 冻结为 historical；本概览、实施计划与版本索引建立唯一 current v1.14。 |
| Decisions | 已更新 | [V1.14-D01](decisions.md#v1-14-d01)记录安全 Timeline 默认与 message-anchored 显式模式的取舍。 |
| Contracts | 已更新 | [Camp History Retrieval v4](../../contracts/camp-history-v4.md)与[Built-in Tool Transport v17](../../contracts/builtin-tool-transport-v17.md)冻结 CLI 补全与兼容边界。 |
| Architecture | 已更新 | Built-in Tool Runtime、基础不变量与 Camp Identity 路由明确解析后/Schema 前补全及 canonical Core 边界。 |
| UI | 确认无需更新 | 本版只改变 Agent CLI 输入与教学，不改变 Renderer、交互或可见消息投影。 |
| Runtime Activity | 确认无需更新 | canonical operation、Activity 与 Evidence shape 不变；CLI shorthand 不产生新活动类型。 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 准入或实测结论；安装快照仅按现有机制广告 v17 capability。 |
| Documentation routing | 已更新 | 文档导航、Contract 索引、Decisions CURRENT 与当前架构引用切换到 v17/v4/v1.14。 |
| Root README | 确认无需更新 | 项目定位、常青能力与支持范围不变，命令局部默认不进入根 README。 |

## References

- [v1.14 实施计划](implementation-plan.md)
- [v1.14 决策记录](decisions.md)
- [Camp History Retrieval v4](../../contracts/camp-history-v4.md)
- [Built-in Tool Transport v17](../../contracts/builtin-tool-transport-v17.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
