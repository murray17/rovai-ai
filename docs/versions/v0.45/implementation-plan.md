---
document_type: implementation-plan
version: v0.45
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-07
---

# v0.45 实施与验收计划

> 当前停点：v0.45 生产实现已进入集成阶段。下方勾选项只标记已有代码与自动化测试证据的
> 子项；clean-break 静态门禁、打包 App、真实 Runtime smoke 和完整验收矩阵仍未完成。

## Checkpoint 1：设计真源（本阶段）

- [x] 建立 v0.45 当前版本入口和 clean-break 范围；
- [x] 冻结 Public A2A Message → `0..N` Message Delivery → `0..1` AgentRun 的权威关系；
- [x] 冻结 `camp.message.send` / `rovai send`、严格 Addressing Token、统一 recipient 解析、
  canonical Agent ID 排序、错误、幂等、fanout 和 lineage 合同；
- [x] 冻结 recipient-scoped event-driven Delivery pump、waitCondition、
  `interrupted_before_dispatch` 和显式 per-Delivery retry/cancel；
- [x] 冻结 Profile v2 的最多 3 条 Public Reference Context Closure、预算优先级、omission、
  ContextManifest/ACK 和 direct-parent failure boundary；
- [x] 冻结 Runtime public output modes；
- [x] 冻结 Scheme C、Run Pulse、Execution Drawer、Approval Dock、CampTurn Stop 和删除
  Inspector Activity 页的 Renderer 合同；
- [x] 放入只取会话区关键交互的 Scheme C 原型，并标注 HTML 非产品数据源。

## Checkpoint 2：Core domain、持久化与 clean break

- [x] 增加 Public A2A Message、Message Delivery、Dispatch Attempt、Retry Identity 和
  frozen presentation metadata 的新 Schema；
- [ ] 删除旧私有 Member Call / recipient / Conversation Input 投递路径及无使用者数据表；
- [x] 原子提交消息与 Deliveries，写入 canonical recipient digest、lineage 和 fanout 证据；
- [x] 增加 clean-break Migration，清理 Rovai-owned app data，不触碰用户工作区/外部 Runtime；
- [x] 更新 Read Side、search、audit、export 和 CampTurn settlement projection。

## Checkpoint 3：Message Delivery Dispatch Pump

- [x] 实现首次 dispatch attempt 的 durable fence 和崩溃窗口判定；
- [x] 实现 `target_busy`、`runtime_unavailable`、`capacity_unavailable` recipient-scoped
  waitCondition；
- [x] 只由接受、目标 Run 结束、Runtime 配置恢复、容量变化等直接相关事件调用
  `dispatchPending(agentId)`；
- [x] 禁止周期扫描、启动全局扫描、Camp 级继续事件和隐式历史复活；
- [x] 实现 explicit per-Delivery retry/cancel，并保持 frozen payload/recipient/lineage。

## Checkpoint 4：Context Delivery Profile v2

- [x] 增加 v2 immutable resolver 与 shared fixture；
- [x] 通过 ContextService 共享的 history-budget seam 固定 15 / 24,000 Unicode scalars /
  2,000 / 最多 3 条 direct-parent closure，并记录 omission 与 stable digest；
- [x] 在 Delivery dispatch attempt 内先冻结唯一权威的完整 Dynamic Context 选择与 Runtime
  payload，再创建 AgentRun；Runtime 只把同一冻结字节封装成正式 ContextManifest，不重新选历史；
- [x] direct parent/mandatory structure 无法容纳时 terminal `context_payload_too_large`，不创建
  AgentRun、不进入 waitCondition；
- [x] ACK 只推进既有 Accepted Public Context Boundary，不为 Closure 增加第二游标。

## Checkpoint 5：Runtime public output

- [x] 为每个 Adapter 冻结 `explicit_send_only` 或 `assistant_final_visible`；
- [x] 在可靠 final boundary 生成 recipient-free Public A2A Message；
- [x] 只对同一 Run 已显式发布的 recipient-free、同一规范化正文执行 exact final suppression；
  recipient-bound send、跨 Run、语义相似正文和时间窗均不去重（含 recipient-bound regression）；
- [x] Automatic final 默认 `replyToCampMessageId = null`，未知 Runtime output mode fail-safe 为
  `explicit_send_only`；
- [ ] 严禁通过语义相似度、时间窗或跨 Run body 去重。

## Checkpoint 6：Renderer、Preload、IPC 与原型收敛

- [x] 以现有 Arctic Dawn App Shell 为基线接入 per-Run Run Pulse 和按需 Execution Drawer；
- [x] Drawer 是 Timeline 下方、Approval Dock 上方的唯一非模态 Run 过程面，无 backdrop、
  focus trap、全屏覆盖或 Timeline 内第二套 Run process；
- [x] 删除 Inspector “活动”页及其独立状态，保留 Tasks/Context/Approvals/Audit；
- [x] Drawer 不提供 Run stop；Composer 发送位置在活跃 CampTurn 时切换为唯一的 Stop；
- [x] Approval Dock 始终紧贴 Composer 上方，Drawer 收缩时不遮挡 Approval Dock；
- [ ] 完成键盘、Focus Return、reduced motion、1040/1180px 断点和 200% zoom 验收。

## Checkpoint 7：验证与完成门槛

- [x] Core/Rust、CLI、IPC、Renderer、Migration、Search/Audit fixtures 全部通过（`cargo test --workspace`
  293+2+46、`pnpm test` 174+78）；
- [ ] Crash/restart matrix 证明无隐式 Delivery revive，显式 retry/cancel 才能恢复；
- [ ] 公共消息对用户/有权 Camp 成员/搜索可见，引用链不越过 Profile v2 限额；
- [ ] 打包 App 验证 Scheme C 和 Activity 页删除；
- [ ] 运行全量 format、typecheck、unit/integration、build、package 与真实 Runtime smoke；
- [ ] 完成证据回填后，才把 `implementation_status` 改为 `complete`。
