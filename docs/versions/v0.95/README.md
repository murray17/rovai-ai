---
document_type: version-overview
version: v0.95
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-16
---

# Rovai-ai v0.95：官方 Skill 测试去文案化与协议去重

> 当前状态：设计、实施、协议 dry-run 与自动验收已完成。
>
> 前置版本：[v0.94 核心模型输入精简与结构化 Run Facts](../v0.94/README.md)
>
> 后续版本：[v0.96 运行监控与原生 Usage 观测](../v0.96/README.md)

## 版本目标

把 official bundled Skill 的 Core 测试收回到 Core 真正拥有的结构化事实，不再用 Rust
`contains(...)` 或固定出现次数冻结自然语言文案。同时精简 `review-duo`、两份 Grill Duo 和 Campfire
中跨章节重复的规则，在不改变既有 Core wire、持久化和协作工具合同的前提下，为每条 Skill 规则建立
清楚的单一正文权威位置。

## 计划基线

原始计划按 `24b020de1e0524110dbd43450d9eb03530a2b5c4` 编写；本版本建立时仓库已经前进到
`44f0b5a8`。附件中的绝对行号只作为定位提示，实施必须按当前符号、文件内容和测试事实重新解析，不能
机械套用旧行号。

## 交付范围

- 为 bundled Skill 测试建立通用 materialization helper，逐项验证文件集合、完整内容、mode、来源和管理策略；
- 删除 `skill.rs` 中面向 Skill 自然语言句子、标题、数字和命令出现次数的逐字断言；
- 保留 official inventory、management policy、默认启用、Runtime Group assignment、repair、事件与用户设置保留等结构化测试；
- repair 验证改为比较完整编译期 bundled bytes，不再只搜索名称片段；
- 把 frontmatter/YAML/链接、description authoring、协作场景和真实 Delivery 行为分别交给对应校验层；
- 精简 Review Duo 根文件中与 `references/findings.md` 重复的结果规模、消息边界和最终报告规则；
- 精简两份 Grill Duo 中与角色、开放轮次和 CLI Operations 重复的 accepted、迟到与部分回答说明；
- 删除 Campfire 的转交启动入口，并精简根 Skill、Lead、Member 和 Notes 中重复的 Gather、回复长度、用户介入和发布说明；
- 保留 Review Duo 四消息拓扑、Grill Duo 有界开放轮次、Campfire 第一轮/可选第二轮、主持权变化和唯一纪要。
- 建立通用 Skill authoring validator，检查 frontmatter、UI metadata、内部路由 token 和 bundle 内链接；
- 链接校验解析真实 Markdown link/image 节点，代码围栏和行内代码中的示例链接不作为文件依赖；
- 同步移除 `cli-operations` 与 `member-studio` description 中的执行细节，并把 Memory 界面短描述补到推荐长度；
- 以角色、可信输入和消息拓扑完成[协作场景 Dry Run](scenario-acceptance.md)，不再用 Rust 文案搜索充当行为验收。

## 明确不做

- 不改变 official Skill inventory、bundled management policy 或 Runtime Group Assignment；
- 不修改 `rovai send`、Gather、Message Delivery、Built-in Tool Transport 或 Context 合同；
- 不修改 Native Session Bootstrap、AgentRun Dynamic Context、ContextManifest 或相关 formatter/profile 版本轴；
- 不通过另一批中英文、标题、正则或命令计数断言替换被删除的 Rust 文案断言；
- 不以文本搜索冒充 Agent 行为验收；
- 不修改 Review Duo、Grill Duo 或 Campfire 的持久化模型，因为这些流程仍由既有公开消息与 Gather 表达；

## 验收边界

- Core 通用 helper 精确覆盖所有 official bundled Skill 的 manifest、bytes、mode、来源与管理策略；
- `skill.rs` 不再把上述 Skill 的自然语言文案、标题、数字或 `rovai send` 次数当作接口；
- 删除文案断言前，Skill validator、authoring lint 和场景验收已经明确承接对应职责；
- Review Duo 仍为五文件 bundle，四消息和两个独立轴不变；
- 两份 Grill Duo 的三种发送方式各只有一个正文权威位置，开放轮次语义不变；
- Campfire 不再接受成员转交启动，但仍保留用户直接请求 Default Lead、Gather 两轮上限、Lead 变化和最终纪要；
- Authoring validator 继续拒绝缺失或越界的真实相对链接，但允许代码示例使用虚构链接目标；
- Rust workspace、fmt、Clippy、Skill 校验、协作场景、TypeScript 和文档门禁通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.94 冻结为 historical；本概览、[实施计划](implementation-plan.md)和版本索引建立唯一 current v0.95。 |
| ADR | 确认无需更新 | 有效 ADR 冻结 official inventory、四消息 Review、开放轮次 Grill 和 Gather 领域合同，但不拥有已删除的 Campfire 普通成员代发入口；本次未形成新的长期高成本取舍。 |
| Contracts | 确认无需更新 | 计划明确保持 send、Gather、Message Delivery、Built-in Transport 与 Context wire 不变。 |
| Architecture | 已更新 | [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)移除旧交接/Opening Barrier 描述，改为当前 Gather capture、Barrier、Completion FIFO 与原发起者收口事实。 |
| UI | 确认无需更新 | 不改变 Renderer 数据、交互或稳定 UI 文案合同。 |
| Runtime Activity | 确认无需更新 | 不新增 operation、phase 或 Canonical Activity 映射。 |
| Runtime compatibility | 确认无需更新 | Runtime 能力、版本矩阵、Skill projection 和 CLI transport 不变。 |
| Documentation routing | 已更新 | 唯一当前版本指针切换到 v0.95；Skill authoring 与测试指南加入通用 validator 命令和责任边界。 |
| Root README | 确认无需更新 | 项目定位、常青能力和用户支持范围没有变化。 |

## References

- [实施与验收计划](implementation-plan.md)
- [协作 Skill 场景 Dry Run](scenario-acceptance.md)
- [Skill 编写与 description 路由规范](../../development/skill-authoring.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [ADR-0198](../../adr/0198-bounded-open-round-grill-duo-skills.md)
- [ADR-0199](../../adr/0199-session-semantic-four-message-review-duo.md)
