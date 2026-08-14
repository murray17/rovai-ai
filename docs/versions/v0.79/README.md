---
document_type: version-overview
version: v0.79
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-14
---

# Rovai-ai v0.79：Camp 会话轻量打开与分段性能诊断

> 当前状态：版本方向已确认，但生产代码尚未实施；因 v0.80 开启，本版本按未完成事实冻结为 historical。
> 原计划先建立跨 Renderer、Electron Main 与 Core
> 的分段性能证据，再收窄会话进入关键路径并交付有界的 Desktop 打开投影；历史消息、已结束执行证据、
> Context Manifest、Actions 与完整 Timeline 改为按需读取。
>
> 这些 `camps.*` 能力是 Desktop 内部的 typed IPC / Core read surface，不进入 Agent Built-in CLI、
> help、catalog、Bootstrap 或模型可见工具集合。
>
> 前置主线版本：[v0.78 完整 Exact-Scope Memory View 与 Copyable Target](../v0.78/README.md)
>
> 后续版本：[v0.80 接收者延续与可修复路由](../v0.80/README.md)
>
> 主线重放说明：已完成的 v0.78 Memory 版本是本版本的 canonical predecessor；v0.79 保持独立的
> Camp 打开性能范围，不覆盖或静默并入 v0.78 的 Memory 交付。

## 版本目标

把“打开 Camp”的成本从“读取、传输并渲染整个历史现场”改为“读取并呈现首屏所需的有界权威投影”。
短会话和具有大量历史执行证据的长会话，在首屏数据量与打开耗时上都应落入同一预算级别。

本版本同时区分三个不同目的：

1. **进入会话：** 恢复合法 Default Lead 后返回首屏所需权威状态；
2. **继续阅读：** 以游标分页读取较早消息，并保留精确消息锚点导航；
3. **检查执行现场：** 用户打开过程详情时，才读取指定 Run 的阶段、Evidence、Action 或 Manifest 详情。

“首屏完成”必须以 Camp 的有意义内容已经 commit 并完成下一次 paint 为准，不能把只显示
“正在打开会话”的 Shell 当成完成。

## 已确认的实现事实

- Renderer `activateCamp` 当前把 `camps.reconcileDefaultLead` 与 `camps.snapshot` 连续送入
  Core 的串行 main queue，并等待二者；随后还在 `setCampSnapshot` 前等待 directory project
  navigation restore；
- Desktop 启动恢复路径直接调用 `camps.snapshot`，没有复用点击进入路径，形成
  [ADR-0058](../../adr/0058-collaboration-v4-presence-aware-admission.md) 所要求“进入后先
  reconcile、再读 snapshot”的文档—实现漂移；
- 当前 `CampSnapshot` 在一个事务中读取 Camp、成员、Task、最近 1000 条消息、Delivery、Turn、
  AgentRun、最多 1200 条 Execution Evidence、全部 Context Manifest、Approval、Action，以及最近
  500 条 Timeline event；
- Delivery、Turn、AgentRun、Context Manifest、Approval 与 Action 当前没有首屏用途驱动的历史上界；
  普通事件刷新也会重新请求完整 `camps.snapshot`；
- [ADR-0013](../../adr/0013-managed-content-and-read-side-v2.md) 要求 Renderer 权威状态来自 SQLite
  Read Side，snapshot 捕获 `throughGlobalSequence`，Renderer 不得靠 event replay 自建第二真源；
- [Camp 会话工作区](../../ui/components/conversation-workspace.md) 已要求世界地图消费有界只读投影，
  过程 Evidence 按需读取，并为 Loading、Partial、Error 与 Recovery 保留诚实状态。

## 关键设计判断

### Default Lead reconcile 不能移到首屏之后

原始止血建议中“先显示 snapshot，再后台 reconcile”不能直接采用。
[ADR-0058](../../adr/0058-collaboration-v4-presence-aware-admission.md) 明确要求进入已有 Camp 时先执行
幂等 `camp.default_lead.reconcile`，再读取权威 snapshot；`camps.snapshot` 仍必须是纯读。

本版本采用一个 Desktop 内部 enter/read 流程（最终 method 名由 Contract 冻结）：

```text
Renderer enter request
  → Core serialized queue
  → idempotent Default Lead reconcile
  → post-reconcile lightweight open projection
  → Renderer first meaningful paint
  → navigation restore / campViewed / navigation refresh
```

这样既消除两个 Renderer/Main 往返和错误的并发错觉，也不改变 Default Lead 的持久语义。若 reconcile
未修改 Lead，仍直接返回同一轻量投影；若发生修改，返回值已经是修改后的权威状态，不再额外读取一次
完整 snapshot。

### 缓存只负责更快恢复，不负责掩盖无界读取

可兼容的 recent projection 可以在切换时立即恢复阅读面，再按 event high-water 刷新；缓存 miss、
schema 不兼容、sequence gap 或 Core 重启必须重新读取权威投影。不得通过扩大缓存时间、保留完整
`CampSnapshot` 或忽略失效条件来伪造性能改善。

## 交付范围

### 1. 端到端分段性能证据

一次进入操作使用同一 data-minimized trace ID，至少记录：

- 用户点击或 Desktop 恢复目标；
- Renderer 发出请求；
- Electron Main 接收、进入与离开 Core queue；
- Core 开始 enter、开始/结束 reconcile、开始/结束 projection transaction；
- JSON 序列化完成、payload byte count 与各集合 item count；
- Electron Main 收到并完成解析；
- Renderer 收到、state commit、首个有意义 paint；
- 首屏后 navigation restore、`campViewed` 与 navigation refresh 完成。

日志只记录 method、阶段、duration、bytes、counts、schema/high-water 与匿名 trace ID；不得记录消息正文、
附件路径、命令内容、模型输出、稳定实体 ID 或其他用户内容。基线必须区分 queue wait、SQLite query /
hydration、serialization / IPC 与 React commit / paint，不能只给一个总耗时。

### 2. 收窄会话进入关键路径

- 点击进入、Desktop 启动恢复、通知精确导航与返回 Camp 复用同一 enter 语义；
- Default Lead reconcile 与轻量投影保持顺序一致，并由 selection generation 防止旧请求覆盖新选择；
- directory project navigation restore、current-project persistence、`navigation.campViewed` 和 navigation
  refresh 在首个有意义 paint 后运行，不阻塞会话内容；
- 后台步骤失败保留已打开 Camp，并在其所属 surface 提供可恢复错误；不得把用户踢回快速对话；
- 只有权威投影或增量 high-water 可以推进当前 Camp cache；迟到或倒退的响应必须丢弃。

### 3. Desktop 轻量打开投影

新投影在一个 SQLite read transaction 中捕获 `throughGlobalSequence`，并只返回首屏需要的状态：

- Camp 基本信息、Default Lead 与当前成员；
- 非终态 Task 的有界首段、总数和后续读取游标；
- 最近一段 Camp Message，以及明确的 oldest/newest coverage 与较早历史游标；
- 当前 non-terminal Turn / AgentRun、恢复 blocker、未收敛外部效果，以及呈现当前状态所需的最小摘要；
- pending Approval；
- 可见消息所需的最小 recipient / delivery 事实；
- schema version、`throughGlobalSequence`、各集合 coverage、omitted count 或 next cursor。

首屏投影不得包含：

- 已结束 Run 的 Execution Evidence 全集；
- Context Manifest 与 Runtime Input Delivery Evidence；
- 历史 Action 详情；
- 完整 Domain Event Timeline；
- 所有历史 Delivery、Turn 或 AgentRun；
- 为隐藏 Inspector、Drawer 或世界地图预先构造的完整详情。

所有截断都必须显式可见于 typed coverage，不能让 Renderer 把“未加载”解释为“不存在”。最终字段、
窗口大小、排序、cursor 和 schema compatibility 在 Checkpoint 0 的 Contract 中冻结。

### 4. 按需历史与过程详情

- 较早消息使用稳定 keyset cursor / frozen high-water 分页，不使用随新消息漂移的 offset；
- 精确通知、reply parent 与搜索结果继续复用 same-Camp `camp.messages.around` 锚点读取，不退化为
  “滚到最近位置”；
- Run Evidence 复用 `agentRunEvidence.list` 与 `agentRunEvidence.getContent`，过程 Drawer 只为用户
  展开的精确 Run 加载详情；
- terminal Task、历史 Run / Delivery、Action、Manifest 与 Timeline 仅在对应 detail surface 或诊断路径
  请求；普通 Camp open 和事件刷新不读取这些集合；
- 分页合并按 stable ID、sequence 与 captured high-water 去重，sequence gap 或 schema mismatch 回到
  权威轻量投影，不由 Renderer 猜测。

### 5. Renderer 渐进呈现与刷新

- 将 Camp open state 与完整历史详情 state 分离，避免继续用一个全量 `CampSnapshot` 对象驱动所有
  surface；
- Camp 基本信息、最近消息、Composer、pending Approval 与活跃执行先可用；Inspector history、过程
  Evidence 和 Timeline 按需进入 Partial / Loading；
- hidden timeline、世界地图或关闭的 Drawer 不预先 map 全部历史 JSX；
- Core event 先按 Camp 与 entity kind 合并 invalidation，再请求轻量 refresh 或精确 detail，不因每个
  event 重取完整 snapshot；
- Draft、消息滚动、通知锚点、Inspector 选择与世界地图切换在 refresh/pagination 中保持稳定。

## 非目标与冻结边界

- 不新增或修改 Agent Built-in CLI command、help、catalog、Bootstrap digest、Runtime tool 或模型上下文；
- 不改变 Default Lead validity、选择顺序、发送 admission、无 fallback 或 `camps.snapshot` 纯读语义；
- 不把 Renderer 改为 event-sourced projection，也不新增第二个持久 projection database；
- 不以扩大 cache、压缩日志内容、隐藏 Loading 文案或预取完整历史作为性能完成证据；
- 不重新设计 Camp 视觉世界、消息样式、世界地图、Inspector 信息架构或 Composer；
- 不删除完整 `CampSnapshot` 的诊断/测试用途；是否弃用由后续 Contract 与调用点证据决定。

## 发布门槛

1. 在实现轻量投影前冻结 click/open 与 startup-restore 的绝对 p50/p95 预算、测试硬件、fixture 和 payload
   hard limit；不能只声称“体感更快”；
2. 相同首屏状态、但历史消息 / Evidence / Action / event 规模相差至少两个数量级的 fixtures，首屏
   payload 不随历史规模增长，open p95 差异不超过已冻结容差；
3. 测试证明 reconcile 总在权威 open projection 之前，startup 不再绕过它，普通 open/refresh 不请求
   完整 `camps.snapshot`；
4. 测试覆盖 cache hit/miss、快速切换、Core 重启、sequence gap、长消息、目录项目、pending Approval、
   live Run、recovery blocker、exact notification anchor 和较早消息分页；
5. 性能日志经测试证明不含正文、附件路径、命令、模型输出或稳定实体 ID，并能独立归因 queue、DB、
   serialization/IPC 和 React paint；
6. Core / Renderer 定向与完整测试、typecheck、build、文档治理、diff 检查，以及隔离 `userData`
   的真实打包 App 冷/热打开验收通过；
7. 只有记录 before/after 数值、剩余瓶颈与全部门禁证据后，才把本版本与实施计划标记为 `complete`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本版本曾按 canonical predecessor 开启，现因 v0.80 接续而以未实施事实冻结为 historical；[版本索引](../README.md)维护唯一 current v0.80 |
| ADR | 确认无需更新 | 本版本保留 ADR-0013 的 SQLite Read Side / sequence authority 与 ADR-0058 的 reconcile-before-read 语义；若 Checkpoint 0 需要改变二者，必须先新增替代 ADR |
| Contracts | 确认无需更新 | 本次只开启版本，尚未冻结新的 wire shape；Checkpoint 0 必须在编码前新增或升级 Desktop open projection Contract，不能让版本文档代替字段合同 |
| Architecture | 确认无需更新 | 当前仍是 Renderer → Electron Main allowlist → Core SQLite Read Side；若过程详情拆分形成新的稳定组件责任，实施前再更新 Architecture |
| UI | 确认无需更新 | 尚无生产 UI 行为变更；现有 Camp 会话工作区已经拥有有界地图读取、按需 Evidence 与 Loading/Partial 诚实呈现，实施时按最终交互补充进入/分页合同 |
| Runtime Activity | 确认无需更新 | 只改变 Desktop read path 与性能观测，不新增 provider event、Canonical Activity domain、semantic kind 或 Evidence shape |
| Runtime compatibility | 确认无需更新 | Agent Runtime、Native Session、adapter capability 与实测版本不变；轻量打开投影不暴露给 Runtime |
| Documentation routing | 已更新 | [版本索引](../README.md)新增 v0.79 current 入口与本版本实施计划；长期主题路由待 Checkpoint 0 的 Contract/Architecture 文件落定后更新 |
| Root README | 确认无需更新 | 项目定位、常青能力和 Runtime 支持范围不变；根 README 不记录版本局部性能计划 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0013: Managed Content and Read Side v2](../../adr/0013-managed-content-and-read-side-v2.md)
- [ADR-0058: Collaboration v4 Presence-Aware Admission](../../adr/0058-collaboration-v4-presence-aware-admission.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [Run Process Detail Surface v5](../../contracts/run-process-detail-surface-v5.md)
- [Current User Attention v4](../../contracts/current-user-attention-v4.md)
