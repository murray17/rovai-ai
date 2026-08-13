---
document_type: version-overview
version: v0.74
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-14
---

# Rovai-ai v0.74：Runtime 对齐的协作 Skill 与双轴代码评审

> 当前状态：设计已确认；四个 Skill 内容、`review-duo` official bundle 与 successor ADR 正在实施，
> 自动化、打包安装和最终发布证据尚未完成。
>
> 前置版本：[v0.73 在线长期记忆捕获与 Hearth 审核隔离](../v0.73/README.md)

## 版本目标

让 Campfire、Grill Duo 系列和新的 Review Duo 只依赖 Rovai 已有且真实可执行的协作事实：Runtime
提供可信发送者，Core 把每次 Agent send 的 reply reference 固定到当前 AgentRun 触发消息，显式
`--to` 建立 Message Delivery，accepted 只证明消息与 Delivery 已提交。

本版本不新增 workflow session、stage、attempt、message kind 或可选择的 reply target。自然标题继续
帮助 Skill discovery、公屏阅读和审计，但不承担身份认证、关联或完成判断。

## 交付范围

### Campfire 与 Grill Duo 校准

- `campfire` 的触发描述覆盖邀请、开场观点、定向回应与澄清，但最终《篝火纪要》只终止、不续跑；
- Default Lead 使用共享邀请和准确 Agent ID；参与者从请求触发的 Run 返回给可信请求者；
- 定向回应需要引用非当前触发观点时写入正文，不伪装成可以选择任意历史 reply target；
- 最终纪要 public-only 发布，未回复或含糊成员不被代写，结束后迟到回复不自动重开；
- `grill-duo` 与 `grill-duo-with-docs` 保留各自自然标题，固定搭档从当前邀请触发的 Run 返回，
  Retry 创建新邀请，旧邀请回复不满足新请求；
- 文档版继续由邀请者维护领域词汇与达到项目准入门槛的 ADR，搭档只做独立复核。

### Review Duo

- 新增 `review-duo` 作为 Rovai original、`user_managed` official Skill；它只在用户明确要求双人、
  双轴或团队 code review 时自动触发，不接管普通单人 review；
- Review Lead 与一位固定搭档分别负责 Spec 和 Standards，两个轴锁定后独立呈现，不跨轴合并、
  去重、改严重度或重排；
- Lead 初始 Run 的启动标记、Standards 请求、Spec 结果和可选等待状态都回复同一用户触发消息；
  搭档结果直接回复 Standards 请求，最终报告从该结果触发的 Lead 续跑 public-only 发布；
- 同一 Lead/Camp 同时只推进一场未结束 Review Duo；Retry 使用新 Standards 请求，wrong sender、
  wrong direct parent、snapshot mismatch、重复和迟到结果都不能推进当前评审；
- 完整 duo 的 Skill-only v1 只接受双方可解析的 Git-object-backed SHA 范围，或用户已提供且双方
  可读取的不可变 patch/附件；没有共享 artifact 的 dirty worktree 必须请求稳定输入、solo fallback
  或停止；
- 评审默认只读，最终报告不授权修复、提交、push、PR、Task、Issue、Memory 或 ADR。

### Official inventory 与 Settings

- official Skill inventory 从十一项扩展为十二项，新增 `review-duo`；
- `cli-operations` 与 `memory-stewardship` 继续为 `system_required`、始终启用、全 Runtime Group 投递，
  并继续不出现在 Settings；
- 其余十项为 `user_managed`，首次安装默认启用并投递到全部 Runtime Group；Settings 因而展示十项
  可配置 official Skill；
- `review-duo` 保留原则级 Matt Pocock attribution，但不 vendoring 上游文件，也不声明 GitHub-origin。

## 非目标与冻结边界

- 不修改 CampMessage schema、Message Delivery、AgentRun、Context Formatter 或 Built-in Tool Transport；
- 不新增 Discussion/ReviewSession 持久对象、workflow router、timer、polling、隐式 send 或私密消息；
- 不让 Markdown 标题改变 Core 状态，不从正文自报身份推导可信 sender；
- 不为 Review Duo 自动创建 snapshot attachment、修改 dirty worktree 或扩展 `rovai send` 参数；
- 不改变两项 system-required Skill 的隐藏、不可关闭和全组投递语义；
- 不重设计 Skill Settings 的信息架构、视觉系统或交互。

## 发布门槛

1. 四个 Skill 通过 `skill-creator` validator，frontmatter trigger、references、`agents/openai.yaml` 与
   bundled file table 一致；
2. Core 精确安装十二项 official Skill，`review-duo` 十一文件、无 upstream，全部 Skill 默认全组投递；
3. Settings 只展示十项 `user_managed` official Skill，两项 `system_required` 无列表行或配置控件；
4. 定向测试证明 Campfire、Grill 与 Review Duo 的自然标题不承担身份认证，并冻结真实 reply topology、
   accepted/pending、Retry、duplicate、late result 与 snapshot fallback 边界；
5. `pnpm test`、`pnpm typecheck`、完整 Rust tests、Clippy、Desktop build、Skill validator、文档治理和
   `git diff --check` 通过；
6. macOS App 从已验证 commit 打包，签名与 bundle 内 Core/CLI 检查通过，并按用户授权提升到
   `/Applications`；
7. 只有上述证据完成后，才把本版本与实施计划状态改为 `complete`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.73 以尚有真实 Runtime/UI 验收缺口的事实冻结为 historical；v0.74 成为唯一 current，并新增本概览与[实施计划](implementation-plan.md) |
| ADR | 已更新 | [ADR-0181](../../adr/0181-twelve-skill-official-inventory-and-runtime-aligned-collaboration.md)替代 ADR-0176，冻结十二项 inventory、management policy 与协作 Skill 的 Runtime 对齐边界 |
| Contracts | 确认无需更新 | 本版本只消费 Camp Message Send v5、Message Delivery v2 与 Context Delivery Profile v3 的现有可信 sender、显式 recipient 和 Core-managed reply；不改变字段或 wire 语义 |
| Architecture | 已更新 | [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)更新为十二项 official Skill、十项 Settings 可配置项与 Review Duo composition |
| UI | 确认无需更新 | Skill Settings 继续使用既有通用列表与 identity-color 规则；新增一项数据行不改变 Renderer 交互或视觉合同 |
| Runtime Activity | 确认无需更新 | Skill 消息继续走现有 send/Delivery/AgentRun activity，不新增 domain、provider event 或 classifier |
| Runtime compatibility | 确认无需更新 | 不改变 Adapter、Native Session、Built-in Transport 或支持版本；本版本没有新的真实 Runtime 兼容性证据 |
| Documentation routing | 已更新 | 当前版本指针、CURRENT、ADR/Architecture 路由和 Skill UI 验收数量同步到 v0.74/ADR-0181 |
| Root README | 确认无需更新 | 项目定位、常青能力和 Runtime 支持范围不变；根 README 不记录版本局部 inventory 流水账 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0181: Twelve-Skill Official Inventory and Runtime-Aligned Collaboration](../../adr/0181-twelve-skill-official-inventory-and-runtime-aligned-collaboration.md)
- [Camp Message Send v5](../../contracts/camp-message-send-v5.md)
- [Message Delivery v2](../../contracts/message-delivery-v2.md)
- [Context Delivery Profile v3](../../contracts/context-delivery-profile-v3.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [`campfire` bundled source](../../../skills/campfire/SKILL.md)
- [`grill-duo` bundled source](../../../skills/grill-duo/SKILL.md)
- [`grill-duo-with-docs` bundled source](../../../skills/grill-duo-with-docs/SKILL.md)
- [`review-duo` bundled source](../../../skills/review-duo/SKILL.md)
