---
document_type: version-overview
version: v0.93
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-16
---

# Rovai-ai v0.93：Review Duo 会话语义精简

> 当前状态：设计、实施与自动验收已完成。
>
> 前置版本：[v0.92 Grill Duo 有界开放轮次](../v0.92/README.md)

## 版本目标

把 Review Duo 从结果分片、manifest 与历史 locator 协议收敛为正常 Camp 会话中的四消息双人评审，使用
可信固定搭档、直接回复和不可变代码范围关联结果。同时把两份 Grill Duo 的三种发送动作集中到各自唯一的
“消息方式”章节，删除分阶段重复的 CLI 示例。

## 交付范围

- Review Duo 正常流程固定为搭档请求、公开需求结果、搭档规范结果和公开最终报告四条消息；
- 四条消息都携带相同不可变 Git 或 patch 评审范围，不依赖请求消息 ID，也不增加 review key 或完成 locator；
- 每轴最多 8 条 finding，每字段 1–2 句，单轴目标约 2,000–2,500 个中文字符；
- 最终报告只保留每轴状态、数量、最多 3 条重要问题和覆盖限制，不复制完整轴结果；
- public-only 与定向结果验证预期 `effectiveRecipients`，非寻址 `@` 内容必须转义或进入代码块；
- 请求 accepted 后固定搭档保持不变，只有明确不可用或 Delivery 失败时更换；
- Review Duo bundled Revision 从十一项收敛为五项，删除六个旧协议 reference 及 Core 编译期引用；
- 两份 Grill Duo 各保留一个集中“消息方式”章节，三种 CLI 动作只出现一次，轮次语义不变；
- 同步 Core manifest、语义测试、Architecture、领域词汇、版本和 ADR 导航。

## 明确不做

- 不新增 ReviewRecord、review key、completion locator、数据库 Migration 或 Renderer 状态；
- 不保证 Native Session 和可见上下文全部丢失后的确定性恢复或 exactly-once 最终发布；
- 不让 Review Duo 使用 Gather，也不修改 Gather、Message Delivery 或 Built-in Tool Transport 合同；
- 不改变 Grill Duo 的 1–4 题开放轮次、部分回答或固定搭档直接回复语义；
- 不保留 Review Duo 旧 parts、manifest、locator 或十一文件 bundle 的兼容分支；
- 不改变十三项 official Skill inventory、management policy 或 Runtime Group Assignment。

## 验收边界

- Review Duo 文件集合精确为五项，Core 不再编译或投影六个删除 reference；
- Skill 路由正确区分普通单人评审、双人评审，以及“只要求修改”和“评审后修改”；
- 四消息范围关联、固定搭档替换、结果字数、收件人边界、最终摘要和迟到结果规则均有语义测试；
- 两份 Grill Duo 的 `rovai send` 示例各只保留三次并集中在一个章节；
- 三个 Skill validator、Core 定向测试、Rust workspace 与文档治理门禁通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.92 冻结为 historical；本概览、[实施计划](implementation-plan.md)与版本索引建立唯一 current v0.93。 |
| ADR | 已更新 | [ADR-0199](../../adr/0199-session-semantic-four-message-review-duo.md)局部替代 ADR-0191 继承的 Review Duo 包装与结果传输语义。 |
| Contracts | 确认无需更新 | 继续使用既有 `rovai send`、公开消息、显式收件人和 Core-managed reply；不增加 wire 字段、持久对象或错误语义。 |
| Architecture | 已更新 | Built-in Tool Runtime 记录 Review Duo 四消息会话语义和 Grill Duo 集中 CLI 教学。 |
| UI | 确认无需更新 | 仅同步 existing Skill 的列表文案，不改变 Renderer 交互或稳定 UI 合同。 |
| Runtime Activity | 确认无需更新 | 普通 send 与 AgentRun 活动映射不变，没有新增 operation 或 phase。 |
| Runtime compatibility | 确认无需更新 | Runtime 能力、版本矩阵、CLI transport 与 Skill projection 要求不变。 |
| Documentation routing | 已更新 | ADR CURRENT/HISTORY、领域词汇和唯一当前版本指针切换到 v0.93；任务入口职责不变。 |
| Root README | 确认无需更新 | 项目定位、常青能力和用户支持范围没有变化。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0199](../../adr/0199-session-semantic-four-message-review-duo.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [Skill 编写与 description 路由规范](../../development/skill-authoring.md)
