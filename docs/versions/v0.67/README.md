---
document_type: version-overview
version: v0.67
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-13
---

# Rovai-ai v0.67：当前用户注意力与渐进式 CLI 教学补完

> 当前状态：v0.65 冻结时未实施的统一范围已在 v0.66 受控关闭之后前向实现；Migration、
> Core/CLI、bundled Skill、Renderer、packaged App 验收和九 Runtime real smoke 均已完成。
>
> 前置版本：[v0.66 计划内受控关闭与可靠终态收口](../v0.66/README.md)

## 版本目标

补完 v0.65 已接受但因优先级切换而关闭的统一范围：让 Agent 通过 `rovai send --to-user`
在一条公共 CampMessage 中显式提醒唯一当前本地用户，由 Core 原子创建持久通知；同时以精简
Session Charter、窄触发的 `cli-operations` official bundled Skill、operation-local help 和无损
整理后的 `memory-stewardship` 建立渐进式 CLI 教学。

本版本保留 v0.66 的 planned-shutdown 数据与终态语义。Current User Attention 使用后续
Migration 78 发布 Data Contract `v0.67` / projection schema 33，不复用或改写 v0.66 的 Migration 77。

## 交付范围

### Current User Attention

- Camp Message Send v4 与 `rovai send --to-user` 使用闭合的 `mentionUser` 输入；Agent 不提供 user ID；
- Core 以 `local_user` 生成 closed `current_user_mention`，它与 Agent recipient、Delivery、Run 和
  Task cardinality 正交；用户 Composer 的保存与发送边界拒绝该 Core-owned segment；
- 同一接受事务原子创建 CampMessage、Structured Mention、Agent Delivery 与唯一 Message Mention
  Notification；public-only user mention 创建零 Delivery；
- timeline、exact read/search、Context、Clipboard、通知摘要与 accessibility 均从 Structured Content
  投影；`camp_message.body` 只是可重建 cache；
- Notification Center 支持独立 Inbox row、精确消息导航、来源不可用、独立 heads-up preference 与
  8 秒同 Camp transient 聚合，聚合不合并已读或清除状态；完成后勘误增加按 `messageId` 的有界
  锚点读取、真实视口确认和 Message Mention 独立已读语义，避免最近 1,000 条快照与 Camp 级已读误伤；

### Progressive CLI teaching

- Built-in Tool Transport v7 保持十三项 canonical operation 和 compact Agent Output；
- Session Charter 只保留固定命令集合、精确 operation help、公共输出义务和安全恢复边界；
- 新增窄触发 `cli-operations` official Skill 及五份 references；普通单命令继续直接使用精确 `--help`；
- `memory-stewardship` 无损拆分 references，保留既有 authority、安全、cache、revision、正文与
  retrieval-key 规则；
- official inventory 固定为七项，两个 Skill 继续使用现有普通投递、默认九 Runtime Groups 与用户可控
  Assignment。

完整字段与稳定边界继续由 [Camp Message Send v4](../../contracts/camp-message-send-v4.md)、
[Current User Attention v2](../../contracts/current-user-attention-v2.md)、
[Built-in Tool Transport v7](../../contracts/builtin-tool-transport-v7.md)、ADR-0165～0170 和当前代码拥有；
完整实施证据见[实施计划](implementation-plan.md)。

## 验收证据

- Core、CLI、Renderer、Skill、Context、notification 与 clean-break migration 自动化通过：378 library、
  11 CLI、69 Core、304 Vitest、155 Node 与 21 docs tests 全绿，3 个 manual Runtime smoke ignored；
- arm64 packaged App 通过签名验证，并完成 Day/Night、1440×920、1040×700、200% zoom、reduced
  motion、Current User Mention、copy/paste、通知导航/聚合/设置和 Skill 列表验收；
- Codex、OpenCode、Copilot、Claude、Antigravity、Kiro、Qoder、CodeBuddy、Qwen 的 v7 Built-in CLI
  与 `cli-operations` real smoke 全部通过；
- Antigravity 与 Kiro 均有 successor Run 复用同一 Native Session 的专项证据；Kiro 的 per-Run Host
  在终态公开前释放原生 Session lock，再由新 Host 执行 `session/load`。

精确命令、计数、截图名、Runtime 版本和限制记录在
[实施计划的当前证据](implementation-plan.md#当前证据)与
[Runtime 兼容性清单](../../runtime-compatibility.md)。

## 冻结边界

- 只有一个 Core-owned 本地身份 `local_user`；不增加多用户 binding 或用户资料编辑 UI；
- `--to-user` 不创建 Message Delivery，Current User Mention 不计入 `taskId` recipient cardinality；
- 手写 `@你`、显示名、`@local_user` 或 lookalike 始终是 Text；
- Agent success stdout 仍精确为 `{messageId,effectiveRecipients}`，不暴露用户或 Notification ID；
- 没有权威 locator 的 `confirm_outcome` 不搜索正文、不猜近似消息、不盲目重发；
- 当前 Run 只可对自己已提交且由权威 command result 绑定的消息做边界后 exact item 核验；所有
  collection read 与其他来源消息继续受不可变 ContextManifest fence；
- 不新增 Runtime、外部 MCP、系统通知或第二套 Skill delivery authority。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.66 按完整验收事实冻结为 historical；v0.67 成为唯一 current，并记录 v0.65 统一范围的前向补完 |
| ADR | 已更新 | ADR-0170 冻结 current-Run committed self-write 的窄 exact-read 例外；ADR-0165～0167 继续拥有其原稳定决定 |
| Contracts | 已更新 | Current User Attention v2 冻结 Message Mention 独立已读、锚点窗口、焦点确认和 Markdown 保真；Camp Message Send v4 与 Built-in Tool Transport v7 的 Agent wire/version 不变 |
| Architecture | 已更新 | Public A2A 与 Built-in Tool Runtime 已组合正交 User attention、结构化正文投影、原子通知和 Charter/help/Skill 分层，同时保留 v0.66 planned-shutdown 边界 |
| UI | 已更新 | 当前 Porcelain/Steel 规范中的 Current User Mention、消息通知、独立浮层偏好与普通 official Skill 列表已完成生产实现和 packaged 验收 |
| Runtime Activity | 确认无需更新 | User Mention、Notification 与 CLI teaching 不新增 Canonical Runtime Activity identity、classifier 或 provider event mapping |
| Runtime compatibility | 已更新 | 九 Runtime 已完成 v7 `--to-user`、exact addressing、精确 help 与 `cli-operations` real smoke；AGY/Kiro 原生续接均有实测证据 |
| Documentation routing | 已更新 | 版本索引切换到 v0.67；文档地图、CURRENT、Architecture、Contract 和 UI 索引继续路由到现行稳定权威 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持 Runtime 集合不变；根 README 不记录当前版本协议细节 |

## References

- [v0.67 实施与验收计划](implementation-plan.md)
- [v0.65 原始实现规格](../v0.65/implementation-spec.md)
- [ADR-0165](../../adr/0165-core-owned-current-user-message-attention.md)
- [ADR-0166](../../adr/0166-progressive-built-in-cli-teaching.md)
- [ADR-0167](../../adr/0167-seven-skill-official-inventory.md)
- [Camp Message Send v4](../../contracts/camp-message-send-v4.md)
- [Current User Attention v1](../../contracts/current-user-attention-v1.md)
- [Current User Attention v2](../../contracts/current-user-attention-v2.md)
- [Built-in Tool Transport v7](../../contracts/builtin-tool-transport-v7.md)
- [ADR-0170](../../adr/0170-current-run-committed-self-write-exact-read.md)
- [ContextManifest Evidence v12](../../contracts/context-manifest-evidence-v12.md)
- [Public A2A Message 与 Message Delivery](../../architecture/public-a2a-message-delivery.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
