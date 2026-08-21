---
document_type: version-overview
version: v1.23
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: implemented
model_context_change: true
last_updated: 2026-08-21
---

# Rovai-ai v1.23：按需 Built-in CLI Help 与 Charter 精简

> 当前状态：[模型上下文变更 revision 3](model-context-change-cli-help-reuse.md) 已按最新 `origin/main`
> 由开发者二次确认并完成实现、回归、App 打包安装与 `main` 交付；实现提交为 `3b8902fa`。
>
> 前置版本：[v1.22 Runtime Probe 更新容错](../v1.22/README.md)已按完成事实冻结为 historical；其
> Runtime Probe supersession 与 stale LKG 边界继续作为本版基线。
>
> 后续版本：[v1.24 Runtime Probe 完整边界与自动恢复](../v1.24/README.md)。

## 版本目标

把 Session Charter 中的无条件两段式 help 教学改为按需查询：operation 不清楚时使用根帮助，本次
invocation 所需 syntax 不清楚时查看精确 operation help，并尽量复用当前 Native Session 已有 help。
同时合并重复的 Principal 定义，以正向 CLI 路由表达完整 operation catalog，并把 `--to-principal`
指导收敛到当前消息何时产生新的 Principal 需求。

## 提案范围

- 完整替换 Session Charter 中的 Principal 定义、operation catalog、progressive-help 与
  `--to-principal` 四处文案；十五项 operation、输入源、send/public-only/Principal 和授权语义不变；
- 当前 `rovai --help` 已由 v1.21 分离 Agent operations 与 User Automation，本版保持其 bytes 不变；
- Built-in Tool Transport 与 CLI Command 从 v19 提升为 v20，Runtime capability 提升为
  `builtin_cli.transport.v20`；Send v12、operation catalog、IPC、Envelope、receipt、Agent Output 与业务
  Schema 不变；
- Native Binding context contract 加入内部 `sessionCharterRevision: 2`，使旧 Charter Binding 在新 Run
  解析时不兼容并建立新 Native Session；该 revision 不显示给模型；
- Bootstrap v3/Formatter 3、Dynamic Formatter 21/Manifest 21/Profile v4、Data Contract v1.17、projection
  schema 58 与 Migration 103 保持不变；
- 通过 Charter/root-help snapshot、Binding digest 负向测试、Rust 回归、打包 App 内置 CLI 与
  `rovai app` User Automation 验证交付。

## 实施结果

- Session Charter 已按确认文本替换四处 passage；根 CLI help bytes、十五项 operation、Send v12、数据合同和
  User Automation contract 均保持不变；
- Built-in Tool Transport/CLI 与 capability 已原子提升到 v20，Native Binding contract 已加入内部
  `sessionCharterRevision: 2`，旧 Binding 不会承载新 Charter；
- 文档、TypeScript、Vitest/Node、Rust CLI/slow、fmt、Clippy、Desktop build 与打包门禁通过；全量 lib 的
  298 项通过，唯一失败仍是当前 `main` 已记录的 Runtime compatibility frozen digest 基线不一致，本版未越界
  修改该登记；
- macOS arm64 App 已通过签名、架构与包内 CLI/Core 检查，隔离 App 的真实 `rovai app status` 验证
  `authorized=true`；产物已安装到 `/Applications/Rovai AI.app` 并从该规范路径启动；
- 安装前 v19 App 保留在
  `/Applications/Rovai AI.backup-v1.22-before-v1.23-20260821-195957.app`，日常 `userData` 未替换。

## 明确不做

- 不让 CLI 缓存或拒绝重复 `--help`；是否查询仍由 Agent 根据当前上下文决定；
- 不把任意 Camp 历史、Memory、文件或用户示例视为权威 help；
- 不修改 operation flags、默认值、Schema、Router、授权、幂等、receipt、Send v12 或 User Automation；
- 不通过 compaction redelivery 修改旧 Session，不重写历史 Bootstrap Evidence，不增加 Migration；
- 不承诺概率模型绝不重复查询；本版改变稳定教学和兼容边界，不增加 Shell 命令去重器。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.22 按已交付事实冻结为 historical；本概览、计划和索引建立唯一 current v1.23 implementation。 |
| Decisions | 确认无需更新 | 按需查询、等义文案精简与 Binding 轮换落实既有 authority、progressive-help 和 Session compatibility 不变量，没有新增高成本取舍。 |
| Contracts | 已更新 | [Built-in Tool Transport v20](../../contracts/builtin-tool-transport-v20.md)冻结 v19→v20 compatibility、Charter delta 与不变 transport 边界。 |
| Architecture | 已更新 | [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)记录按需 help、v20 capability 与 Charter revision Binding fence；Principal/catalog/attention 业务语义不变。 |
| UI | 确认无需更新 | 不改变 Renderer、交互、可见消息或设置。 |
| Runtime Activity | 确认无需更新 | help 仍是 Runtime command evidence，不增加 activity kind、classifier 或展示语义。 |
| Runtime compatibility | 确认无需更新 | 不改变上游 Runtime 准入或实测版本；v20 使用既有 packaged capability/catalog refresh。 |
| Documentation routing | 已更新 | 版本索引进入 v1.23；Contract、Architecture、Decision 与文档任务入口统一指向 v20。 |
| Root README | 确认无需更新 | Agent CLI 教学不改变项目定位、平台支持或用户安装方式。 |

## References

- [实施与验收计划](implementation-plan.md)
- [模型上下文变更 revision 3](model-context-change-cli-help-reuse.md)
- [Built-in Tool Transport v20](../../contracts/builtin-tool-transport-v20.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [核心模型上下文变更治理](../../development/model-context-change-governance.md)
