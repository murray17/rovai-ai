---
document_type: version-overview
version: v0.71
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-13
---

# Rovai-ai v0.71：Notification Episode、Skill 管理与受控关闭终态收敛

> 当前状态：Notification Episode 的领域模型、合同、ADR、Core/IPC/Renderer clean-break 与隔离打包
> App 验收均已完成；Campfire、系统必需 operational Skill 与 Grill Duo 自然标题增量也已完成。
> 同一 current snapshot 的 durable AgentRun product fence、真实 Runtime 关闭/重启验收与完整门禁也已完成。
>
> 前置版本：[v0.70 User Attention 教学与十项 official Skill](../v0.70/README.md)

## 版本目标

把旧“一来源一张通知行”收敛为 Core-owned Notification Episode：同一 CampTurn 的多次 Current User
Mention 与权威终态只呈现一张卡片，同时每条 Mention 保持精确独立确认；所有写操作绑定观察边界，
Episode 更新通过最小 Change Journal 驱动浮层和增量刷新。

普通 Agent 公屏消息只留在 Camp 时间线。通知中心只承载待审批、提到你、本轮完成、执行失败和执行
未完成。用户主动 Stop 静默；`turn_failed` 与只能证明未完成的 `turn_incomplete` 必须诚实区分。

同一版本另把 official Skill inventory 从十项扩展为十一项：新增 Rovai 原生 `campfire`，并把
`cli-operations`、`memory-stewardship` 收口为始终启用、投递全部 Runtime Group 且不在 Settings
展示的系统必需 Skill。该增量不改变 CampMessage wire shape、Runtime 权限或 Notification Episode。

两项既有 Grill Duo Skill 也把公开阶段线索从方括号内部标签改为互不混淆的自然标题：普通版使用
“双人追问”，文档版使用“双人追问与文档”。标题只负责 Skill-only continuation；发送者和直接调用者
返回仍由 Runtime 的受信 Current Input 与 Message Delivery lineage 决定，不新增 message kind 或会话对象。

受控关闭增量把“外部效果是否确定”与“Rovai 是否仍持有执行权”拆开：可靠 Runtime terminal 继续优先；
主动退出后的剩余 Run 必须终态收敛，同时保留 accepted/delivery-unknown input 与 unknown Action 现场，
不得在下次启动继续显示永久 spinner 或自动重发原输入。

## 交付范围

### Core 深模块

- Migration 79 提升 Rovai Data Contract 至 `v0.71 / projection schema 34`，clean-break 删除旧
  `in_app_notification` 表、triggers、preferences 和旧 read/clear 接口；
- 新增 immutable Occurrence、mutable Disposition、materialized Episode、minimal Change Journal；
- 来源事实、Occurrence、Episode 与 Journal 同事务；
- collaboration/message/approval-generation 三种聚合键；
- `episodeVersion` / `attentionRevision` 分离，bounded acknowledge/clear/mark-all；
- Clear 前历史来源与 Active Attention 分离；当前未读、动作、heads-up 与 retention 只看 Active Attention；
- changesSince schema v5 返回 exact HeadsUpSignal；Approval 使用 pending-first / acknowledge-only action；
- Journal floor、reset、分页 high-water 与 90 天终结 Episode 保留。

### 受控关闭的 durable product fence

- Migration 80 把当前 Data Contract 提升到 `v0.71 / projection schema 35`，新增 generation-local
  `planned_shutdown_cycle`；
- `core.shutdown` v2 在关闭 launch admission 前持久化 cycle，可靠 Runtime terminal 仍保留既有 provenance；
- terminal/live-route、Built-in invocation 与受跟踪 writer 全部 fence 后，剩余 `queued | running | waiting`
  Run 原子收敛为 `cancelled`，但不伪造 Provider cancellation；
- accepted/delivery-unknown input 保留，prepared input 在模糊 handoff 边界转为 `delivery_unknown`；
- fence transaction 未提交时由下一 Core generation 在普通 recovery 前幂等补偿，不恢复、重发或创建 successor；
- Renderer 关闭面明确无法确认的执行也会停止；终态 Run 可独立显示“外部效果待确认”。

### Current User Attention v3

- 同 CampTurn Mention 一卡聚合但逐消息独立确认；
- 最早未确认 Mention 成为当前精确消息 action，确认后逐条推进；
- exact visible acknowledgement 与导航失败不回滚语义保持；
- 后续用户输入只满足此前 completion，不确认 Mention。

### Renderer 与设置

- Notification Center 只渲染 Core Episode，不做二次聚合；
- display semantic 与 attention action 分离，主动作不可用时仅展示显式次动作；
- 当前浮层同 Episode 原地升级，reload 建立 high-water 而不补弹历史；
- 浮层只消费 exact signal；增量分页全部成功并接收 Inbox 后才提交共享 cursor；
- 设置固定为总开关、待审批、提到你、本轮完成、执行未完成，默认开启；
- 保持 Porcelain Day / Steel Night、键盘焦点、长文本、错误恢复和 200% zoom 合同。

### Official Skill 与管理策略

- 新增六文件 Rovai 原生 `campfire`，用自然公屏标题组织 2–3 位成员独立开场、有限定向回应与终止纪要；
- Campfire Skill-only v1 使用受信 Runtime 发送者身份，不新增 discussion state、隐藏协议 ID 或自动副作用；
- `cli-operations`、`memory-stewardship` 使用 `system_required` policy，Core 拒绝配置修改并在 bundled
  installation 时恢复 enabled 与全部九组 Assignment；
- Renderer Skill Settings 只展示九项 `user_managed` official Skills；两项系统必需 Skill 仍参与
  Runtime 原生发现与投递。
- `grill-duo` 与 `grill-duo-with-docs` 分别使用自己的“复核邀请 / 搭档建议”自然标题；邀请者只接受
  固定搭档的正式建议，同一决策点不重复邀请，已替换或结束问题的迟到建议不自动重开；
- 文档版在角色路由后渐进读取 reference：固定搭档只加载双人协议并且不修改项目文档，邀请者收到建议后
  恢复完整领域词汇与 ADR 维护职责。

## Clean break

功能尚未上线，不迁移旧通知数据、已读/清除、设置或 cursor。Migration 只清理 Rovai-owned 通知域，
不修改 Camp、CampMessage、CampTurn、Approval、Project、附件、Runtime Session 或 Runtime-owned 数据；
没有 alias、双 reader、双 writer 或回填路径。

受控关闭 fence 同样不把 process exit、interrupt acknowledgement 或 route detach 当作 Runtime terminal，
不写 CampTurn Stop intent，也不改变没有 durable shutdown cycle 的普通 crash/断电恢复边界。

## 发布门槛

1. Core module tests 覆盖事务原子性、聚合/顺序无关、逐 Mention 确认、并发边界、approval generation、
   completion satisfaction、失败诚实性、clear reappearance、Journal reset 与 retention；
2. JSON-RPC、TypeScript 与 Main allowlist 只暴露 v2/schema v5 深模块接口，旧方法不可调用；
3. Renderer tests 覆盖同 Episode heads-up 原地更新、启动不补弹、不可用主动作、部分未读与 CAS 错误恢复；
4. 双主题真实 App 验收覆盖 Drawer、Toast、设置、长 CJK/emoji、键盘、最小窗口与 200% zoom；
5. `cargo test --workspace`、Fmt、Clippy、Typecheck、Desktop build、`pnpm test` 与全部文档治理通过；
6. Campfire validator/情景演练、十一项 fresh-Core smoke、system-required 命令拒绝与九项 Settings
   列表 fixture 通过；
7. 两项 Grill Duo validator、自然标题 bundled manifest、受信 sender/caller-return 回归与普通/文档/伪造
   迟到建议三类 continuation dry-run 通过，两个 active Skill 目录中的旧方括号标签归零；
8. Planned Shutdown v2 验收证明 durable intent、writer fence、可靠 terminal 优先、fallback terminal、
   accepted/prepared uncertainty、startup compensation、Desktop report 与 terminal unknown-effect UI。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.70 以未执行九 Runtime v8 matrix 的事实冻结为 historical/closed_incomplete；v0.71 成为唯一 current，并承载受控关闭增量 |
| ADR | 已更新 | ADR-0175 细化通知真源、聚合、Journal 与 Renderer seam；ADR-0176 替代十项 official inventory 并冻结 system-required policy；新增 [ADR-0177](../../adr/0177-controlled-shutdown-fences-product-execution.md)冻结 product fence 与 unknown effects 分离；Grill Duo 标题与 Notification v2 合同修正不改变既有 ADR 决策 |
| Contracts | 已更新 | Notification Episode v2 替代 v1，冻结 Active Attention、exact HeadsUpSignal、事务式 cursor 与 acknowledge-only；Current User Attention v3 继续拥有逐消息精确确认；SkillView 增加 management policy；[Planned Shutdown v2](../../contracts/planned-shutdown-v2.md)替代 v1 当前入口；Grill Duo 仍使用既有 CampMessage 与 caller-return 合同 |
| Architecture | 已更新 | Notification Episode 架构补齐 Active Attention、signal hydration 和 Renderer cursor commit seam；Built-in Tool Runtime 与 Skill Projection 记录十一项 inventory 及系统必需自愈边界；Planned Shutdown 增加 durable cycle、writer fence、product settlement 与 startup compensation |
| UI | 已更新 | 通知中心组件合同补齐 exact signal 呈现/点击、“知道了”动作与失败重试边界；Settings surface 同步九项可配置 Skill；[Camp 会话工作区](../../ui/components/conversation-workspace.md)同步关闭等待与 terminal unknown-effect 文案 |
| Runtime Activity | 确认无需更新 | 不新增 Runtime operation、provider event、Activity classifier 或 Evidence mapping |
| Runtime compatibility | 确认无需更新 | 不改变 Adapter、Native Session、Built-in Transport v8 或模型教学 identity |
| Documentation routing | 已更新 | docs map、Contract/Architecture/UI/ADR/current-version 路由到 v0.71；Skills 指向 ADR-0176，Planned Shutdown 当前入口切换到 ADR-0177/v2 |
| Root README | 确认无需更新 | 产品定位、常青能力与 Runtime 支持范围不变，根 README 不记录版本局部实现 |

## References

- [实施与验收计划](implementation-plan.md)
- [Notification Episode v2](../../contracts/notification-episode-v2.md)
- [Current User Attention v3](../../contracts/current-user-attention-v3.md)
- [ADR-0175](../../adr/0175-core-owned-notification-occurrence-episode-and-change-journal.md)
- [ADR-0176](../../adr/0176-eleven-skill-official-inventory-and-system-required-operations.md)
- [ADR-0177](../../adr/0177-controlled-shutdown-fences-product-execution.md)
- [Notification Episode 架构](../../architecture/notification-episodes.md)
- [`campfire` bundled source](../../../skills/campfire/SKILL.md)
- [Planned Shutdown v2](../../contracts/planned-shutdown-v2.md)
