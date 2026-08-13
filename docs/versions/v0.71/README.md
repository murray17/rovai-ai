---
document_type: version-overview
version: v0.71
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-13
---

# Rovai-ai v0.71：Notification Episode

> 当前状态：领域模型、合同、ADR、Core/IPC/Renderer clean-break 与隔离打包 App 验收均已完成。
>
> 前置版本：[v0.70 User Attention 教学与十项 official Skill](../v0.70/README.md)

## 版本目标

把旧“一来源一张通知行”收敛为 Core-owned Notification Episode：同一 CampTurn 的多次 Current User
Mention 与权威终态只呈现一张卡片，同时每条 Mention 保持精确独立确认；所有写操作绑定观察边界，
Episode 更新通过最小 Change Journal 驱动浮层和增量刷新。

普通 Agent 公屏消息只留在 Camp 时间线。通知中心只承载待审批、提到你、本轮完成、执行失败和执行
未完成。用户主动 Stop 静默；`turn_failed` 与只能证明未完成的 `turn_incomplete` 必须诚实区分。

## 交付范围

### Core 深模块

- Migration 79 提升 Rovai Data Contract 至 `v0.71 / projection schema 34`，clean-break 删除旧
  `in_app_notification` 表、triggers、preferences 和旧 read/clear 接口；
- 新增 immutable Occurrence、mutable Disposition、materialized Episode、minimal Change Journal；
- 来源事实、Occurrence、Episode 与 Journal 同事务；
- collaboration/message/approval-generation 三种聚合键；
- `episodeVersion` / `attentionRevision` 分离，bounded acknowledge/clear/mark-all；
- Journal floor、reset、分页 high-water 与 90 天终结 Episode 保留。

### Current User Attention v3

- 同 CampTurn Mention 一卡聚合但逐消息独立确认；
- 最早未确认 Mention 成为当前精确消息 action，确认后逐条推进；
- exact visible acknowledgement 与导航失败不回滚语义保持；
- 后续用户输入只满足此前 completion，不确认 Mention。

### Renderer 与设置

- Notification Center 只渲染 Core Episode，不做二次聚合；
- display semantic 与 attention action 分离，主动作不可用时仅展示显式次动作；
- 当前浮层同 Episode 原地升级，reload 建立 high-water 而不补弹历史；
- 设置固定为总开关、待审批、提到你、本轮完成、执行未完成，默认开启；
- 保持 Porcelain Day / Steel Night、键盘焦点、长文本、错误恢复和 200% zoom 合同。

## Clean break

功能尚未上线，不迁移旧通知数据、已读/清除、设置或 cursor。Migration 只清理 Rovai-owned 通知域，
不修改 Camp、CampMessage、CampTurn、Approval、Project、附件、Runtime Session 或 Runtime-owned 数据；
没有 alias、双 reader、双 writer 或回填路径。

## 发布门槛

1. Core module tests 覆盖事务原子性、聚合/顺序无关、逐 Mention 确认、并发边界、approval generation、
   completion satisfaction、失败诚实性、clear reappearance、Journal reset 与 retention；
2. JSON-RPC、TypeScript 与 Main allowlist 只暴露 v1 深模块接口，旧方法不可调用；
3. Renderer tests 覆盖同 Episode heads-up 原地更新、启动不补弹、不可用主动作、部分未读与 CAS 错误恢复；
4. 双主题真实 App 验收覆盖 Drawer、Toast、设置、长 CJK/emoji、键盘、最小窗口与 200% zoom；
5. `cargo test --workspace`、Fmt、Clippy、Typecheck、Desktop build、`pnpm test` 与全部文档治理通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.70 以未执行九 Runtime v8 matrix 的事实冻结为 historical/closed_incomplete；v0.71 成为唯一 current |
| ADR | 已更新 | 新增 ADR-0175，细化 ADR-0087/0165 的通知真源、聚合、Journal 与 Renderer seam |
| Contracts | 已更新 | Notification Episode v1 成为通知接口；Current User Attention v3 替代 v2 的 per-message Inbox row |
| Architecture | 已更新 | 新增 Notification Episode 架构并更新 Public A2A 的 User Mention projection ownership |
| UI | 已更新 | 新增通知中心组件合同并更新 Settings surface 的 Episode/类别/动作边界 |
| Runtime Activity | 确认无需更新 | 不新增 Runtime operation、provider event、Activity classifier 或 Evidence mapping |
| Runtime compatibility | 确认无需更新 | 不改变 Adapter、Native Session、Built-in Transport v8 或模型教学 identity |
| Documentation routing | 已更新 | docs map、Contract/Architecture/UI/ADR/current-version 路由切换到 v0.71 权威 |
| Root README | 确认无需更新 | 产品定位、常青能力与 Runtime 支持范围不变，根 README 不记录版本局部实现 |

## References

- [实施与验收计划](implementation-plan.md)
- [Notification Episode v1](../../contracts/notification-episode-v1.md)
- [Current User Attention v3](../../contracts/current-user-attention-v3.md)
- [ADR-0175](../../adr/0175-core-owned-notification-occurrence-episode-and-change-journal.md)
- [Notification Episode 架构](../../architecture/notification-episodes.md)
