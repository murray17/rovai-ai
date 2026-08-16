---
document_type: version-overview
version: v0.94
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: true
last_updated: 2026-08-16
---

# Rovai-ai v0.94：核心模型输入精简与结构化 Run Facts

> 当前状态：设计、二次确认、实施与自动验收已完成。
>
> 前置版本：[v0.93 Review Duo 会话语义精简](../v0.93/README.md)
>
> 后续版本：[v0.95 官方 Skill 测试去文案化与协议去重](../v0.95/README.md)

## 版本目标

在不改变上下文选择、预算与 `COLLABORATION_STATE` v2 的前提下，精简 Native Session Charter 和
历史消息模型投影，把自然语言 `RUN_NOTICES` 收敛为字段化 `RUN_FACTS`。ContextManifest 继续保留
完整来源、正文、截断、附件和精确字节证据，使更短的模型输入仍可冻结、复现和审计。

## 交付范围

- 用已确认完整文本替换 `SESSION_CHARTER`，保留调用时重新授权、遗漏读取与 Unicode scalar offset 规则；
- `SHARED_CONVERSATION` 顶层投影唯一 `campId`，单消息移除长度、截断布尔和完整 continuation；
- `mentionsCurrentUser` 仅在完整结构化消息包含当前用户 mention 时投影 literal `true`；
- 截断消息只投影 `nextBodyOffset`，且与 `camp.read item.bodyOffset` 使用同一 Unicode scalar 文本空间；
- `omittedMessages` 只保留 count 与最小/最大 sequence envelope，不再携带固定 navigation 文本；
- `RUN_FACTS` v1 字段化表达 Task 引用、Session 连续性、未决外部效果、Gather 与 delegation budget；
- AgentRun Formatter 升至 v17、ContextManifest Evidence 升至 v15，并对旧动态上下文技术状态 clean break；
- 建立核心模型上下文独立变更说明与开发者二次确认的常青开发规则和文档门禁。

## 明确不做

- 不修改 `COLLABORATION_STATE` schema v2、`professionalResponsibilities`、digest 或刷新条件；
- 不修改 Memory Entrypoint、Self Active Tasks、Current Input 或 Gather completion input；
- 不修改历史选择、引用闭包、消息数量、字符/payload budget、遗漏计算或 Context Delivery Profile v3；
- 不增加旧 `RUN_NOTICES`、Formatter v16 或旧 ContextManifest 的兼容 reader、双写或降级分支；
- 不改变 Built-in CLI 命令集合、Transport、授权、发送 acceptance 或用户注意力合同。

## 验收边界

- Charter 精确字节、section 顺序和 `CURRENT_INPUT` 最后不漂移；
- 中文、emoji 与组合字符正文可由投影 prefix 加 `nextBodyOffset` 读取结果精确往返；
- 截断前缀外的结构化 mention 仍投影 `mentionsCurrentUser: true`，false 必须省略；
- 所有三类历史消息均来自顶层 `campId`；sequence envelope 明确可有空洞且不可执行；
- Run Facts 各触发组合、Gather fallback generation 和 delegation budget 的负向语义有测试；
- ContextManifest v15 证明完整投影来源、facts 精确 JSON 字节与 digest；旧技术状态不被新 formatter 读取；
- Rust、TypeScript、文档治理和 migration 测试通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.93 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[核心上下文变更说明](model-context-change.md)与版本索引建立唯一 current v0.94。 |
| ADR | 已更新 | [ADR-0200](../../adr/0200-compact-context-projection-and-structured-run-facts.md)局部替代历史 Charter、完整 continuation、显式 false mention 与 Run Notice 决定，同时保留 Collaboration v2。 |
| Contracts | 已更新 | ContextManifest Evidence v15 与 Run Facts v1 拥有新的字段、精确字节和 clean-break 边界。 |
| Architecture | 已更新 | Built-in Tool Runtime 同步 Bootstrap/Dynamic Context section、历史恢复 locator 与 Run Facts 职责。 |
| UI | 确认无需更新 | 模型输入和内部 evidence 改动不改变 Renderer 数据或交互。 |
| Runtime Activity | 确认无需更新 | 没有新增 operation、phase 或 Canonical Activity 映射。 |
| Runtime compatibility | 确认无需更新 | Native Runtime 能力与实测版本不变；切换通过 Core contract/binding 失效完成。 |
| Documentation routing | 已更新 | 开发手册新增核心上下文治理，文档导航、CURRENT、Contract 与领域词汇指向新合同。 |
| Root README | 确认无需更新 | 项目定位、常青能力与用户支持范围不变。 |

## References

- [核心模型上下文变更说明](model-context-change.md)
- [实施与验收计划](implementation-plan.md)
- [核心模型上下文变更治理](../../development/model-context-change-governance.md)
- [ADR-0200](../../adr/0200-compact-context-projection-and-structured-run-facts.md)
- [ContextManifest Evidence v15](../../contracts/context-manifest-evidence-v15.md)
- [Run Facts v1](../../contracts/run-facts-v1.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
