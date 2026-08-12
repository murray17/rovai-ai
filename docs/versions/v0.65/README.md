---
document_type: version-overview
version: v0.65
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-12
---

# Rovai-ai v0.65：当前用户注意力与渐进式 CLI 教学

> 当前状态：产品决定、长期 ADR、字段级合同和两阶段实施规格已接受；业务代码、Migration、
> bundled Skill、Renderer 与九 Runtime 验收尚未完成，因此版本保持 `in_progress`。
>
> 前置版本：[v0.64 Accepted Input 恢复阻断与安全收敛](../v0.64/README.md)

## 版本目标

让 Agent 通过 `rovai send --to-user` 在一条公共 CampMessage 中显式提醒唯一当前本地用户，
同时由 Core 原子创建持久通知；再以精简 Session Charter、窄触发的 `cli-operations` official
bundled Skill、operation-local help 和无损整理后的 `memory-stewardship` 建立渐进式 CLI 教学。

这是一个统一版本，不是两个可独立发布的功能。实施按 Phase 1、Phase 2 排序，但只有两阶段、
clean-break 数据升级、完整门禁和九 Runtime 验收都完成后，v0.65 才能转为 `complete`。

## 交付范围

### Phase 1：`--to-user` 完整领域合同

- Camp Message Send 升到 v4，Agent 输入闭合为 `body / to / mentionUser / taskId`；CLI 增加
  `--to-user`，Agent 不传 user ID、别名或特殊收件人字符串；
- Core 以唯一 `currentUserId = "local_user"` 解析并冻结
  `current_user_mention(local_user)`，Agent routing 与 User attention 保持正交；
- 同一接受事务原子创建 CampMessage、Structured Current User Mention、每个 Agent recipient 的
  Message Delivery，以及唯一 `camp_message_user_mention` Notification；
- `submittedBody` 只属于输入证据，Structured Camp Message Content 是唯一正文真源，Renderer、
  search/read、Context、Clipboard、通知摘要和 accessibility 均使用 `projectedBody`；
- exact `camp.read(mode="item")` 增加 `addressing.effectiveAgentRecipients` 与
  `addressing.mentionsCurrentUser`；`rovai send` 成功输出仍只有 `messageId / effectiveRecipients`；
- Built-in Tool Transport 升到 v7；Core data/read-model/notification/Context 合同按 clean break
  升版，不保留 `local-user` 与 `local_user` 的双身份或 v3/v4 双读写。

### Phase 2：CLI 渐进式教学

- Session Charter 只保留固定命令集合、精确 help 入口、公共输出义务、输入来源与恢复安全边界；
- 新增窄触发 `cli-operations` official bundled Skill，正文与 references 只拥有命令族选择、
  message→Task 判断、多操作协调和复杂 recovery；
- 普通单一 send、`--to`、`--to-user`、list/get/search/read 直接使用 operation 的精确
  `--help`，不要求加载 `cli-operations`；
- `memory-stewardship` 保留全部既有权威、安全、cache state、revision、正文和 retrieval-key
  约束，只做无损 references 拆分与真实 CLI 名称整理；
- 两个 Skill 都使用现有 official source、默认 enabled、默认九 Runtime Groups，并继续允许用户
  禁用或修改 Assignment；不增加锁定分组、required 状态或第二套投递机制。

完整字段、事务、投影、文件落点和验收矩阵见[实现规格](implementation-spec.md)与
[实施计划](implementation-plan.md)。

## 冻结边界

- 本版本只有一个当前本地用户 `local_user`，不提前设计多用户 authenticated binding、可变 user ID
  或 Renderer 身份推断；
- `--to` / strict inline `@agent_<id>` 只决定 Agent recipients、Delivery、Run 与 A2A budget；
  `--to-user` 只决定 Current User Mention 与 User Mention Notification，不创建 Message Delivery；
- `taskId` 要求恰好一个 Effective Agent Recipient；Current User Mention 不计入也不改变该数量；
- 手写 `@你`、显示名称、`@local_user` 或其他 lookalike 始终只是 Text，不创建 Mention、Notification
  或 Agent Delivery；
- Agent success stdout 不增加 `userMentioned`，也不暴露 `local_user` 或内部 Notification ID；
- 没有权威 `messageId` 或其他 CampMessage locator 的 `confirm_outcome` 不搜索正文、不猜近似消息、
  不盲目重发；Agent 只能报告结果不确定并停止该 mutation；
- `cli-operations` 不是普通 flag 帮助，`memory-stewardship` 不能因拆分而弱化任何治理规则；
- v0.65 不新增 Runtime、外部 MCP、系统通知、用户可编辑身份资料或新的 Skill delivery authority。

## 统一发布门槛

以下条件必须同时满足，不能把 Phase 1 单独结束为公开 v0.65：

1. Camp Message Send v4、Current User Attention v1、Built-in Tool Transport v7、Core migration、
   Renderer、notification preference 与 exact Camp read 全部实现；
2. Charter、`cli-operations`、五组 reference、`memory-stewardship` 无损拆分、bundled inventory 与
   Skill 设置投影全部实现；
3. Core/CLI/Renderer/Skill/Context/notification 自动化、packaged UI 验收、clean-break migration
   验证和九 Runtime real smoke 全部通过；
4. 实施计划记录真实命令、测试计数、截图/证据与已知限制后，才把 overview 与 plan 改为
   `complete`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.64 按已完成事实冻结为 historical，v0.65 成为唯一 current，并新增统一范围、实现规格与两阶段计划 |
| ADR | 已更新 | [ADR-0165](../../adr/0165-core-owned-current-user-message-attention.md)冻结 `local_user`、正交 addressing 与原子通知；[ADR-0166](../../adr/0166-progressive-built-in-cli-teaching.md)冻结 progressive CLI teaching；[ADR-0167](../../adr/0167-seven-skill-official-inventory.md)接替六项 inventory 并冻结完整七项 official Skill 集合与普通投递 |
| Contracts | 已更新 | 新增 [Camp Message Send v4](../../contracts/camp-message-send-v4.md)、[Current User Attention v1](../../contracts/current-user-attention-v1.md)、[Built-in Tool Transport v7](../../contracts/builtin-tool-transport-v7.md)和[ContextManifest Evidence v12](../../contracts/context-manifest-evidence-v12.md) |
| Architecture | 已更新 | Public A2A 与 Built-in Tool Runtime 增加 User attention 轴、结构化正文投影、v7 help/Charter/Skill 分层和无 locator recovery stop |
| UI | 已更新 | 当前 Porcelain/Steel 规范增加 Current User Mention、消息通知、独立浮层偏好与普通 official Skill 列表行为 |
| Runtime Activity | 确认无需更新 | User Mention 与 Notification 都不是 Runtime operation；不改变 Canonical Activity identity、classifier 或 provider event mapping |
| Runtime compatibility | 已更新 | 当前 transport authority 路由到 v7，并明确旧九 Runtime 证据不自动证明 v0.65；真实 v7/Skill smoke 留作发布门槛 |
| Documentation routing | 已更新 | 文档导航、CURRENT、Architecture/Contract/UI 索引与当前版本指针共同路由到 v0.65 权威链 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持 Runtime 集合不变；根 README 不记录当前版本协议细节 |

## References

- [v0.65 实现规格](implementation-spec.md)
- [v0.65 实施与验收计划](implementation-plan.md)
- [ADR-0165](../../adr/0165-core-owned-current-user-message-attention.md)
- [ADR-0166](../../adr/0166-progressive-built-in-cli-teaching.md)
- [ADR-0167](../../adr/0167-seven-skill-official-inventory.md)
- [Camp Message Send v4](../../contracts/camp-message-send-v4.md)
- [Current User Attention v1](../../contracts/current-user-attention-v1.md)
- [Built-in Tool Transport v7](../../contracts/builtin-tool-transport-v7.md)
- [ContextManifest Evidence v12](../../contracts/context-manifest-evidence-v12.md)
- [Public A2A Message 与 Message Delivery](../../architecture/public-a2a-message-delivery.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
