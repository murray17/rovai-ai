---
document_type: version-overview
version: v0.92
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-16
---

# Rovai-ai v0.92：Grill Duo 有界开放轮次与路由收敛

> 当前状态：设计、实施与自动验收已完成。
>
> 前置版本：[v0.91 空 MCP Library 与用户自主管理](../v0.91/README.md)
>
> 后续版本：[v0.93 Review Duo 会话语义精简](../v0.93/README.md)

## 版本目标

把两份 Grill Duo Skill 从“一次一个问题”收敛为每轮 1–4 个彼此独立问题的轻量开放轮次，同时补齐
部分回答、问题变更、当前 Run 与固定搭档直接回复的最小关联规则。文档版保持可独立投递，但不再携带
第二份共享 duo 协议 reference。

## 交付范围

- `grill-duo` 与 `grill-duo-with-docs` 每轮只选择前提已确认、彼此不依赖的 1–4 个问题；
- 一条初始邀请、一条搭档逐题建议和一条合并用户问题覆盖正常轮次，不接入 Gather；
- 当前轮全部问题回答、取消或失效前保持开放，未回答题保留编号和已有建议；
- 开放轮次不混入新题，问题、选项或约束变化时只重新复核该题；
- 固定搭档必须是当前 Camp 中可接收请求的非自身成员，并以可信 Agent ID 寻址；
- 只有当前搭档对当前有效邀请的直接回复能推进轮次，旧轮与迟到建议只作补充；
- 所有发送分支都等待 `rovai send` 返回 `accepted` 后结束当前响应；
- 普通版明确排除领域词汇或 ADR 同步维护，文档版只记录用户已确认的术语与合格决定；
- 删除文档版共享 `references/grill-duo.md`，同步 Core embedded manifest、文件集合与语义测试；
- Skill `description` 只承担自然语言路由，界面 `short_description` 保持推荐长度与简洁定位；
- Campfire 的 `description` 同步采用适用场景、继续使用场景与排除边界，不改变其 Gather 讨论流程。

## 明确不做

- 不新增 Core 持久 Grill Round、数据库 Migration、IPC 字段或 Renderer 状态；
- 不修改 Message Delivery、Public A2A、Built-in Tool Transport 或 Gather 合同；
- 不使用 Gather 替代单一固定搭档的普通 `rovai send`；
- 不修改 Campfire 的角色、Gather 轮次、成员输出或纪要协议；
- 不支持旧的一题一轮触发词、消息兼容分支或会话迁移；
- 不改变十三项 official Skill inventory、management policy 或 Runtime Group Assignment。

## 验收边界

- 两份 Skill 均覆盖 1–4 题、有界开放轮次、部分回答、单题失效重审和旧轮隔离；
- 两份 Skill 均明确当前 AgentRun、可信发送者、直接回复与 `accepted` 边界；
- 普通版与文档版的适用场景互斥清楚，description 不依赖内部消息标题或工具名；
- 文档版 bundled Revision 精确包含五个文件，不再存在共享 duo reference 或编译期引用；
- Skill validator、Core 官方 Skill 测试、Rust workspace 与文档治理门禁通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.91 冻结为 historical；本概览、[实施计划](implementation-plan.md)与版本索引建立唯一 current v0.92。 |
| ADR | 已更新 | [ADR-0198](../../adr/0198-bounded-open-round-grill-duo-skills.md)局部替代历史的一题一轮 Grill 行为，保持 inventory 与 transport 决定不变。 |
| Contracts | 确认无需更新 | 轮次仍由 Skill 公共消息表达，不增加持久对象、Envelope、receipt、字段或错误语义。 |
| Architecture | 已更新 | Built-in Tool Runtime 更新两份 Grill Skill 的有界开放轮次、自包含文件和当前直接回复边界。 |
| UI | 确认无需更新 | 只调整 existing Skill 的 description 与 short description，不改变 Renderer 交互或稳定 UI 合同。 |
| Runtime Activity | 确认无需更新 | 普通 send 与既有 AgentRun 活动映射不变，没有新增 operation 或 phase。 |
| Runtime compatibility | 确认无需更新 | Runtime 能力、版本矩阵、CLI transport 与 native projection 要求不变。 |
| Documentation routing | 已更新 | ADR CURRENT/HISTORY、领域词汇、Skill 编写指南和唯一当前版本指针切换到 v0.92。 |
| Root README | 确认无需更新 | 项目定位、常青能力和用户支持范围没有变化。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0198](../../adr/0198-bounded-open-round-grill-duo-skills.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [Skill 编写与 description 路由规范](../../development/skill-authoring.md)
