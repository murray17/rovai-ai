---
document_type: implementation-plan
version: v0.28
authority: implementation-status
status: complete
last_updated: 2026-08-01
---

# v0.28 实施与验收

> 生产合同：[production-design.md](production-design.md)

本版本已从 macOS 系统通知切换为持久应用内通知，生产设计已经确认并冻结。用户于
2026-08-01 单独授权进入代码实施；下列生产实施与验收已完成。

## 已确认范围

- [x] 使用持久通知中心与不抢焦点的临时浮层，不再实现 macOS 系统通知。
- [x] 排除尚无生产闭环的 `waiting(user_input)` 与“等待回复”通知。
- [x] 待审批只接受真实 `intercepted` Runtime Permission Request，并以 Camp 级
  Attention Episode 聚合，同一 Episode 内不重复产生同类通知。
- [x] 执行结果以 CampTurn 聚合；`completed` 为完成，`failed` 为未完成，用户主动 Stop
  产生的 `cancelled` 不通知。
- [x] 排除直接 Runtime Availability/Readiness/Discovery 与人工重试通知。
- [x] 点击待审批与执行结果通知时复用权威重读和逐级安全退化的内部导航规则。
- [x] 修复所有生产 CampTurn 状态变化同事务追加 `camp_turn.status_changed` 的通用
  不变式，不为通知新增平行的终态事件语义。
- [x] 接受 ADR-0087：Core SQLite 是持久 In-App Notification 收件箱真源，在来源事实
  同一事务创建；Core 提供分页读取和已读/清除命令，Renderer 负责呈现，Main 不保存副本。
- [x] 首次升级使用空收件箱且不回填旧事实；启用后新事务正常记录。关窗但 App 仍运行时
  继续记录，完全退出期间不记录；重启只为真正新提交的恢复终态创建通知。
- [x] 新通知默认未读；浮层出现不算已读，点击浮层/列表项或真正呈现来源 Camp 后才已读，
  通知中心打开本身不清空，并提供显式“全部已读”。
- [x] 通知最多保留 90 天和最近 1,000 项；支持清除单项与清除已读，不提供清空全部。
  清除不改变来源事实；Camp 永久删除时级联删除，归档或单独来源失效时按安全规则保留。
- [x] 两类通知始终持久化并计算未读；用户只控制默认开启的浮层总开关和两个事件子开关，
  关闭期间仍记录且重新开启不补弹，不再提供启用邀请、系统权限或关闭通知中心的设置。
- [x] 通知表只保存类型、来源 ID、状态与时间；Read Side 动态关联当前 Camp 标题。浮层
  与列表使用固定提示，不复制成员、Prompt、审批详情、路径、错误或 Runtime 信息。

## 设计门禁

- [x] 冻结 In-App Notification 的 Core/Main/Renderer 所有权与持久化真源。
- [x] 冻结通知生成事务、稳定身份、数据库唯一去重、Episode 与 CampTurn 关联。
- [x] 冻结冷启动、升级不回填、App 关闭期间和恢复期间的生成语义。
- [x] 冻结未读、已读、全部已读、清除、来源失效、Camp 删除和保留上限。
- [x] 冻结通知中心入口、列表、空态、浮层、键盘和读屏交互。
- [x] 冻结应用内内容与隐私范围。
- [x] 冻结用户可配置的事件/浮层偏好。
- [x] 更新 `CONTEXT.md` 中 Runtime Permission Attention Episode 与 In-App Notification。
- [x] 仅为长期、高逆转成本且有真实取舍的 Core 持久真源创建 ADR-0087。
- [x] 完整记录生产设计、非目标、Migration 边界和完成标准。
- [x] 用户明确确认文档已形成共同理解，并冻结设计。
- [x] 用户另行明确授权进入代码实施。

## 生产实施

- [x] 检查点 1：增加 v43 空收件箱 Migration、通知/偏好合同、唯一约束和升级测试。
- [x] 检查点 2：把 Runtime Permission Attention Episode 与所有 CampTurn 终态生成接入
  同一事务，修复 inbox delivery failure 的通用状态事件缺口。
- [x] 检查点 3：实现分页 Read Side、创建增量、已读/清除命令、保留清理与浮层偏好。
- [x] 检查点 4：实现全局入口、未读徽标、通知抽屉、筛选、分页、空态和设置页。
- [x] 检查点 5：实现浮层队列、当前 Camp 自动已读、精确导航和目标失效退化。
- [x] 检查点 6：完成 Core/Renderer/集成验收、打包 App 截图和文档实施状态更新。

实现没有引入新依赖，也没有加入 Electron/macOS 系统通知路径。

## 验收

- [x] 验证两类通知的生成、聚合、去重、未读和持久恢复。
- [x] 验证通知中心分页、全部已读、清除、来源失效与 Camp 删除。
- [x] 验证浮层不抢焦点、当前来源 Camp 行为、精确导航与目标退化。
- [x] 验证升级边界、并发边界、Core 重启、Renderer 重载和 fail-closed 恢复。
- [x] 验证 Arctic Dawn V3 视觉、键盘操作、读屏名称、焦点与 reduced-motion。

## 完成证据

- `cargo test --workspace`：Core library 226 项、Core binary 46 项通过；5 项显式手工真实
  Runtime smoke 按预期忽略。
- `cargo clippy --workspace --all-targets -- -D warnings`：通过。
- `pnpm typecheck` 与 `pnpm test`：通过，Renderer 26 个测试文件、148 项测试通过。
- `pnpm smoke:core`：全新数据库、普通目录、空 Git、重启和删除通过，不调用模型。
- `pnpm package:mac`：arm64 `Rovai-ai.app` 构建和 ad-hoc 签名通过；未执行发布公证。
- `pnpm accept:notification-ui`：使用隔离数据库验证打包 App 的启动不补弹、未读徽标、
  抽屉、固定内容、偏好即时生效、重启持久化、实时浮层不抢焦点、Escape Focus Return、
  `1440×920` 与 `1040×700` reduced-motion 布局和无横向溢出，并生成三张截图。
- `git diff --check`：通过。
