---
document_type: version-overview
version: v1.53
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in-progress
model_context_change: false
last_updated: 2026-09-07
---

# Rovai-ai v1.53：Runtime 图片、工具一致性、正文块、命令回执、网络恢复与创建性能

前置：[v1.52](../v1.52/README.md)。本版本保留 Runtime 结构化图片观察、混合存储、按需读取和既有图片
Gallery，只收紧 Runtime 图片自动进入 Camp 公屏的来源准入。

## 范围与当前状态

- Codex 仅在当前 route 的 `item/completed` 且 item type 为 `imageGeneration` 时确认原生生图来源。
- Antigravity 仅在精确 conversation/step 关联、generate-image step type 和 done status 全部成立时读取
  `generateImage.generatedMedia` 并确认来源；既有 Run/epoch 和 terminal 去重 fence 保留。
- Claude、ACP、Codex MCP、TRAE、Copilot、截图、读图及其他工具图片继续可以被 Adapter 解析和保存，但
  来源为空，不自动附加到 Agent 消息，也不生成终态独立兜底。工具名 `generate_image` 不提升资格。
- Migration 141 / Data Contract `v1.53` / projection schema 92 增加 nullable 闭集
  `agent_run_image.public_display_source`；历史行不猜测、不回填，默认不展示但保留数据。
- Camp 图片 metadata 查询在同一 Core seam 过滤来源；实时更新、刷新、重开、消息合并与无公开消息兜底
  因而使用同一集合，Renderer wire 和 UI 结构不变。
- `rovai send --file` 的显式图片附件继续走 CampMessage 与 Managed Attachment 链，不读取来源标记，行为不变。

## 正文持久化补充

本轮补充正文持久化与维护写放大修复，见 [V1.53-D02](decisions.md#v1-53-d02)和
[实施与验收](implementation-plan.md#正文持久化补充)。补充任务更新 Runtime Evidence、Camp Open 读取
与可见通知调用源。Migration 143 对旧库中已被同一 Canonical Command 终态完整输出覆盖的历史 delta
及无正文生命周期空壳做一次性压缩，原子修复 Canonical 来源引用，并将 marker 推进到
`v1.53/schema 94/activity-v3`；没有终态的部分输出和所有真实工具事实保留。显式模型已由冻结配置拥有，
因此其 Runtime 观察不再提交空命令。上述变化不改变 UI 布局、Runtime 平台准入或本版本原生图片过滤边界。

## 工具一致性与已部署数据库兼容

合入 PR #245 的 typed read/write、Shell 阅读摘要、统一工具状态及成功读取后提交文件预览；保留主线
文件阅读器改动，不重新设计界面。Migration 142 将 classifier 切换到 `activity-v3` 并形成
`v1.53/schema 93` 的 Migration 143 精确来源；此前主线 `v1.53/schema 92` 和工具分支
`v1.52/schema 92/activity-v3` 均有明确升级路径，随后统一进入 `v1.53/schema 94/activity-v3`。
旧工具 141 的时间在原子汇合中保留，未知/部分 schema 不准入。见 [V1.53-D03](decisions.md#v1-53-d03)
及 [Runtime File Change Observation v3](../../contracts/runtime-file-change-observation-v3.md)。

## 命令结果正文去重补充

新 `command.result` 只在 `result_payload_json` 保存一份完整结果正文；`payload_json` 改为显式小型内部
marker。`events.subscribe` 与完整 Snapshot 在原批量查询中从专用列还原原公开 payload，兼容旧格式同行
混读，普通事件、直接命令响应、幂等重放、事务与 `EVENT_BATCH_SCHEMA_VERSION = 9` 均不变。Migration 144
只从精确 schema 94 来源发布 current `v1.53/schema 95/activity-v3` 及 receipt，不自动转换旧历史行。
具备双读能力的 schema 95 Core 是直接回退基线；更旧 Core 需要先反向物化 marker 行。见
[V1.53-D06](decisions.md#v1-53-d06)、[Domain Command Result v1](../../contracts/domain-command-result-v1.md)与
[实施与验收](implementation-plan.md#命令结果正文去重补充)。

## 运行中网络恢复补充

- Core 增加职责单一的进程内网络恢复队列，固定使用 `1, 2, 3, 5, 10, 15, 30, 30...` 秒且无 jitter；每档从前一
  attempt 结束时起算，无登记项时不轮询。
- ACP Prompt 仅在 failed terminal、当前 Delivery 为 `not_accepted` 且严格网络 classifier 通过时，于普通失败结算前
  转为 `waiting/network_recovery`；旧 Prompt route 先解绑，新 attempt 继续经正式 Scheduler/Fleet。
- 每次 attempt 重验 Run/version/epoch、取消、预算、成员、授权、Input Delivery、Approval、Action 与 Runtime Delivery；
  accepted、unknown 或已开始 dispatch 的输入不重发。
- `online` 与系统 resume 只提前唤醒安全检查；重复信号合并，in-flight singleflight，不直接调用 Adapter，也不重置
  backoff。
- Runtime Input 在新 epoch 被正式接受后才清除网络恢复提示；连接或 Session 建立本身不算任务恢复。
- Renderer 与共享渠道 presentation 增加“连接中断，等待恢复”“正在恢复”“需要处理”，并保留 Run Stop、既有输出、
  草稿、附件、Approval 与 Evidence。
- 自动接管代码已接入十个 ACP Adapter 共用的 prompt terminal/not-accepted seam；在真实双链路 qualification 完成前，
  这些只算候选覆盖，不声明任一 Adapter/平台已获网络恢复资格。Claude Code 现有原生 API retry 仍由 Runtime 单独拥有；
  Codex、Pi、Antigravity、ACP Host 未分类退出、accepted/unknown 输入及无强网络证据阶段保持既有终态或人工处理边界。
- 自动化实现与定向回归已经完成；Claude Code 真实断网原生恢复通过，OpenCode 接管分支仍待实机验证。
  完整资格未通过，操作者已停止继续断网验证并决定先合入实现；本版本继续保持 `in-progress`。
  详见[网络恢复实施与验收](implementation-plan.md#运行中网络恢复补充)和 [V1.53-D04](decisions.md#v1-53-d04)。

## 单聊与执行台反馈补充

单聊与执行台的发送确认前及排队显示“连接中”，开始处理但尚未输出时显示“思考中”；正文、计划、工具或 final 到达即移除等待提示，
不再在后续正文下追加。整轮终态才显示耗时并折叠过程；单聊直接复用执行台工具组、
命令图标、精确结果和步骤计数。保留审批、重试、网络恢复、停止和失败事实，以及已展开结果状态。
这是已确认界面的局部修复，不新增 Runtime、数据库或投递合同；验证记录见[实施与验收](implementation-plan.md#单聊与执行台反馈补充)。

## 新对话创建性能补充

- `camps.create` 只重新执行 Core directory admission 与路径规范化，不运行 Git 子进程；Camp 持久化不再被
  工作树大小或未跟踪文件数量阻塞。
- 显式 Workspace inspection 与 AgentRun 起止 observation 保留 capability、HEAD、branch 等轻量 metadata，
  但不执行 `git status` 或扫描工作树。新 observation 的 `dirty` 为 `null`，历史布尔值继续兼容读取。
- Files Changed / Diff Card 的权威不变，继续只来自当前 AgentRun 与 execution epoch 的 Runtime evidence；
  本次优化不改变 Renderer 布局、文件变化归约或 Git 专用操作。

边界与理由见 [V1.53-D05](decisions.md#v1-53-d05)、[User Automation v2](../../contracts/user-automation-v2.md)
及[实施与验收](implementation-plan.md#新对话创建性能补充)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.52 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.53，并记录创建性能及命令回执补充 |
| Decisions | 已更新 | [V1.53-D01](decisions.md#v1-53-d01)拥有图片准入理由，[D02](decisions.md#v1-53-d02)拥有正文块与维护调用理由，[D03](decisions.md#v1-53-d03)拥有部署迁移汇合理由，[D04](decisions.md#v1-53-d04)拥有网络安全续接理由，[D05](decisions.md#v1-53-d05)拥有 Camp 创建与 Git observation 的性能边界，[D06](decisions.md#v1-53-d06)拥有命令结果单份正文与回退理由；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Runtime Images v5](../../contracts/runtime-images-v5.md)、[Camp Open Projection v16](../../contracts/camp-open-projection-v16.md)、[Runtime File Change Observation v3](../../contracts/runtime-file-change-observation-v3.md)与 [Run Process Detail Surface v31](../../contracts/run-process-detail-surface-v31.md)分别拥有图片、读取、typed 操作与工具呈现；[Network Interruption Recovery v1](../../contracts/network-interruption-recovery-v1.md)拥有网络恢复；[User Automation v2](../../contracts/user-automation-v2.md)拥有创建和轻量 Git observation 边界；[Domain Command Result v1](../../contracts/domain-command-result-v1.md)拥有回执存储、重放与事件投影 |
| Architecture | 已更新 | [Runtime 图片](../../architecture/runtime-images.md)、[文件操作](../../architecture/runtime-file-change-observation.md)、[Availability-first Runtime](../../architecture/availability-first-runtime.md#migration-switch)同步保留式投影与 schema 95 精确升级源汇合；[AgentRun Recovery](../../architecture/agent-run-recovery.md)同步进程内恢复协调与生命周期；[Workspace 不变量](../../architecture/foundational-invariants.md#camp-workspace)与 [User Automation](../../architecture/user-automation.md)同步无工作树扫描边界；[命令不变量](../../architecture/foundational-invariants.md#core-command-transaction)同步命令结果单份正文及双读 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)与 [File Preview](../../ui/components/file-preview.md)保留合入分支的工具一致性和文件阅读语义；正文优化不增加界面设计改动；网络恢复补充等待、恢复与需处理状态及 Stop 保留规则；创建性能和命令回执补充均不改变界面 |
| Runtime Activity | 已更新 | [Registry](../../runtime-activity/registry.md)记录 activity-v3、可靠 typed read/write、历史 classifier 冻结和两种部署源兼容 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 启动、协议能力或平台资格；创建性能与命令回执补充也不改变 Runtime 文件变化 Evidence |
| Documentation routing | 已更新 | 文档任务导航、Contracts/Architecture 索引、版本指针和当前决定导航已包含 User Automation v2、Domain Command Result v1 与对应边界 |
| Root README | 确认无需更新 | 项目定位、安装方法与公开 Runtime 支持范围不因本地公屏图片集合、创建路径或命令回执内部优化而变化 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Runtime Images v5](../../contracts/runtime-images-v5.md)
- [Camp Open Projection v16](../../contracts/camp-open-projection-v16.md)
- [User Automation v2](../../contracts/user-automation-v2.md)
- [Domain Command Result v1](../../contracts/domain-command-result-v1.md)
- [Runtime 图片架构](../../architecture/runtime-images.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md#runtime-图片与消息图片)
