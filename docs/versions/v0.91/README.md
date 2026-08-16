---
document_type: version-overview
version: v0.91
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-16
---

# Rovai-ai v0.91：空 MCP Library 与用户自主管理

> 当前状态：设计、实施、隔离打包验收与安装已完成。
>
> 前置版本：[v0.90 Gather 当前代最后结果与自包含 Completion](../v0.90/README.md)
>
> 后续版本：[v0.92 Grill Duo 有界开放轮次与路由收敛](../v0.92/README.md)

## 版本目标

移除 Context7、Playwright 和全部 `source: builtin` MCP 预设。新建配置从空 Library 开始，用户仍
可手动添加、从本机配置导入、编辑、删除、启停、分配并投影任意外部 MCP Server。

## 交付范围

- `~/.rovai/mcp.json` 缺失时原子创建 schema v2 空配置，不生成 Server 或 Assignment；
- 启动时对未发布配置执行幂等 clean break：只按明确 `source: builtin` 删除定义、元数据和引用其
  Server ID 的 Assignment；无法进入当前严格 Schema 的预发布配置直接移除；
- 删除 preset ID、固定第三方包版本、built-in provenance 的生产模型、IPC、Renderer 和专项 Smoke；
- MCP 设置页不再显示内置/官方预设，空状态只提供手动添加和从本机配置导入；
- CRUD、导入、Assignment、风险确认、Runtime Projection、冻结 Exposure/Evidence 边界保持不变。

## 明确不做

- 不按 Server Name 推断来源或删除用户创建/导入的同名 Server；
- 不新增 SQLite Migration，不改写历史 AgentRun Exposure Snapshot、Evidence 或审计记录；
- 不新增 MCP marketplace、推荐列表、自动扫描、自动导入或默认 Assignment；
- 不改写历史版本、Postmortem 或原型中的当时事实。

## 验收边界

- 全新配置字节对应 `mcpServers={}`、schemaVersion 2、空 servers/assignments，文件权限为 `0600`；
- 混合配置只移除明确 built-in 及其 Assignment，保留 `source: user/import` 的 Context7、Playwright；
- clean break 第二次执行不改变配置字节；无效预发布配置删除后重新初始化为空；
- 设置页空状态只有两个创建入口，不存在内置/官方预设文案、preset 特殊标记或 built-in 样式；
- MCP 手动添加、导入、编辑、删除、分配、风险确认和 Runtime Projection 回归通过；
- 本版本相关 Rust、TypeScript、文档治理、Desktop build、打包 App 隔离验收与签名检查通过；
  全工作区 Rust 基线中与本版本无关的 Campfire 规则失败单独记录，不伪装为通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.90 冻结为 historical；本概览、[实施计划](implementation-plan.md)与版本索引建立唯一 current v0.91。 |
| ADR | 已更新 | [ADR-0197](../../adr/0197-empty-user-owned-mcp-library.md)局部替代 ADR-0103 的 reviewed built-in definitions。 |
| Contracts | 已更新 | `McpServerView` 删除 `presetId` 与 `builtin` source；其余 MCP IPC shape 不变。 |
| Architecture | 已更新 | Built-in Tool Runtime 明确外部 MCP Library 空默认与用户创建/确认导入来源。 |
| UI | 已更新 | 设置页 MCP Library 空状态收敛为手动添加和本机配置导入两个入口。 |
| Runtime Activity | 确认无需更新 | MCP 配置来源不改变 canonical Runtime Activity mapping。 |
| Runtime compatibility | 确认无需更新 | Adapter additive channel、Same-Name Policy 与 Runtime minimum 不变。 |
| Documentation routing | 已更新 | ADR CURRENT/HISTORY、领域词汇、测试入口和唯一当前版本指针切换到 v0.91。 |
| Root README | 确认无需更新 | 项目定位和常青外部 MCP 能力不变，README 未宣称内置第三方 MCP。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0197](../../adr/0197-empty-user-owned-mcp-library.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
