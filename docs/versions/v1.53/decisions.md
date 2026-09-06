---
document_type: version-decisions
version: v1.53
lifecycle: current
last_updated: 2026-09-07
---

# v1.53 决定

<a id="v1-53-d01"></a>
## V1.53-D01：自动公屏只接受 Adapter 确认的原生生图来源

### 背景

Runtime 图片链原先把所有已适配的结构化 image result 都视为可展示 supplement。该边界能避免从文本或目录猜图，
却仍会把截图和读图结果带进 Camp 公屏：例如 Codex `mcp__cua_repl/js` 返回的屏幕截图会被保存并随 Run 的最后
公开消息显示。图片确实是结构化结果，并不等于它是 Agent 希望公开呈现的生成作品。

### 决定

继续保留结构化图片观察与底层存储，但把自动展示资格改为 Adapter 在原生事件验证时写入的闭集来源：Codex
`item/completed` 的 `imageGeneration`，以及精确 conversation/step 关联、类型为 generate-image 且状态为 done 的
Antigravity `generateImage.generatedMedia`。Core 持久化 nullable `public_display_source`，Camp 图片 metadata 查询只
投影这两个值。字段缺失、历史行和所有其他 Adapter 图片都按未确认处理。

显式 CampMessage 图片附件不经过该字段。过滤只改变公屏集合，不删除 Runtime 图片行、Blob 或稳定原文件引用，
也不阻断 Runtime 使用截图、读图和工具结果。

### 后果与被拒绝方案

- 实时、刷新、重开、消息合并和终态独立兜底在 Core 查询处共享同一 fail-closed 结果；Renderer 不需要第二套判断。
- 历史来源无法可靠恢复，保持 `NULL` 和隐藏；未来若接入第三方生图，必须先增加 Adapter 原生事件证明与闭集版本。
- 拒绝按工具显示名（包括 `generate_image`）准入：名称可由第三方任意选择，不能证明结果语义。
- 拒绝按文件名、目录、扩展名、MIME 或图片内容猜测：这些只描述载体，不能证明生成来源。
- 拒绝停止解析或删除截图/读图记录：本次范围是展示投影，保留底层数据避免改变 Runtime 工具链和历史生命周期。
- 拒绝只在 Renderer 隐藏：它会让 Snapshot/Open、实时更新与无消息兜底产生分叉，并把来源权威泄漏到 UI。

当前规范见 [Runtime Images v5](../../contracts/runtime-images-v5.md)、
[Camp Open Projection v16](../../contracts/camp-open-projection-v16.md)与
[Runtime 图片架构](../../architecture/runtime-images.md)。

<a id="v1-53-d02"></a>
## V1.53-D02：正文按消息块定稿，维护空调用在源头收敛

流式文本的运输粒度不应成为历史粒度。逐 delta 写入放大 Evidence 行数，而仅保留最后 final answer 又会
丢失工具之间的过程正文。因此每个正文块保留独立身份和首次位置，优先采用原生 item 完成结果；无可靠
完成结果时在 Core 聚合到明确连续边界。短暂占位允许定稿更新，工具事实继续 append-only；读取叠加当前
未定稿正文以保持切换/重进运行中 Camp 的完整性。原生 `userMessage` 的无正文 started/completed 仅是输入
生命周期壳，不形成用户可见 Evidence；用户消息继续由 CampMessage 权威拥有。

拒绝仅在数据库入口丢弃 delta、只保留 Run 最后一段、重复保存累计正文及完成正文，以及按 UI 隐藏状态
删除已有 reasoning 历史。取消、失败和正常退出保存已收到正文，但不承诺强制杀进程或断电后恢复未落盘
片段。用户已对本地历史治理明确授权后，Migration 143 只删除同一 Canonical Command 内已有后续
`activity.completed + aggregatedOutput` 覆盖的 `command.output.delta`，以及无正文且未被任何投影引用的文本
生命周期空壳；它在同一事务按原顺序过滤 Canonical source IDs、重算首末 Evidence sequence，并拒绝空来源、
文件投影引用或悬挂引用。没有终态输出的 command delta、完整正文/reasoning 块和工具 started/completed
继续保留。该迁移不执行 VACUUM，也不把一次性历史治理扩张为通用压缩系统。

维护写放大优先减少明确的空调用，不用统一日志策略削弱命令保证：有效 Lead 的新 enter 不提交 reconcile，
可见通知不因全局游标推进重复确认。Roster 的 observed-at/generation 仍参与新鲜度与待投递授权；只复用
仍有效的已有短期缓存，不按成员列表相同跳过更新。已执行命令继续保留原结果回放、审计和恢复职责。
固定模型已经是 AgentRun 冻结配置，不需要 Runtime 再观察；明确 `model.source=explicit` 的启动回执与
`runtime.model.observed` 事件在 Command Gateway 前停止，不再制造 `runtime_model.observe` 的 unchanged result。
`runtime_default` 的首次可信模型观察仍提交原命令，保留既有幂等、审计与 Read Model 收敛保证。

当前规范见 [Evidence 持久化边界](../../contracts/run-process-detail-surface-v31.md#evidence-持久化与模型观察边界)、
[Camp Open](../../contracts/camp-open-projection-v16.md)、[通知合同](../../contracts/notification-episode-v5.md)与
[Evidence 不变量](../../architecture/foundational-invariants.md#evidence-usage)。

<a id="v1-53-d03"></a>
## V1.53-D03：已部署的工具分类与图片来源迁移原子汇合

工具一致性分支和主线图片来源已分别使用迁移 141，且工具分支数据已在日常使用。仅选择一侧代码会拒绝
另一侧的真实升级源，直接删除 receipt 或改 marker 又会丢失既有分类切换的含义和时间。

保留主线已发布 141 的图片语义，工具 classifier cutover 使用 142。对精确识别的旧工具分支库，在单一
原位事务内保留原 classifier receipt 时间并映射到 142，补齐图片 schema/receipt，发布统一 marker。
主线图片库沿正常链执行 142；两条路径都不重写历史执行事实，未知或部分状态保持 fail closed。

拒绝为了快速启动而降级 classifier、伪造已完成步骤、删除旧 receipt 或全库重分类；也不为本次冲突新增
通用迁移策略系统。当前规范由 [Availability-first Runtime](../../architecture/availability-first-runtime.md#migration-switch)
和 [Runtime File Change Observation v3](../../contracts/runtime-file-change-observation-v3.md#canonical-与读取兼容)拥有。

<a id="v1-53-d04"></a>
## V1.53-D04：Core 进程内固定退避，只有可证明未接收的输入才自动续接

### 背景

短暂断网可能让仍有效的用户任务在 Runtime terminal seam 直接失败，但“失败可重试”不等于原输入可安全重发。
Provider 可能已经接收输入或产生工具／消息效果；把所有 retryable error 自动 replay 会造成重复副作用。另一方面，把
网络 timer 放在 Renderer 会使最小化、页面切换或窗口未挂载时失去恢复能力；新建持久队列又会复制 AgentRun、Input
Delivery 和现有 Startup Recovery 的权威。

### 决定

Core 在同一 generation 内维护最小内存索引，使用无 jitter 的固定 `1, 2, 3, 5, 10, 15, 30, 30...` 秒退避。
网络／系统恢复信号只提前唤醒同一安全检查，不直接发送。每次 attempt 通过 system-only 领域命令把明确
`not_accepted` 的 ACP terminal Run 从 `network_recovery` 移交给既有 `runtime_recovery` Scheduler；Scheduler/Fleet
继续拥有 claim、epoch、lease 与并发。Runtime Input accepted 是清除故障周期所需的首个有效进展证据。

网络类别采用结构化 code 优先和封闭文本 allowlist，并显式排除 auth、permission、quota、model、config、cancel、
rate limit 与 server error。任何 accepted、delivery-unknown、dispatch-started 输入或未结算 Approval/Action/Runtime
Delivery 都 fail closed。Claude Code 明确仍在原生 API retry 时不登记 Rovai timer，保证任一时刻只有一个恢复 owner。

### 后果与被拒绝方案

- 页面切换和窗口最小化不影响 Core timer；无待恢复项时没有周期轮询。
- 退避不跨 Core restart 持久化；遗留 `network_recovery` marker 在启动时回交既有 Startup Recovery，而不是恢复旧
  deadline。退出、取消和预算不获得新例外。
- 当前只有 ACP terminal/not-accepted seam 取得 Rovai 接管；无法证明安全的 Adapter/phase 继续失败或人工处理，不能为
  扩大表面覆盖而盲发。
- 拒绝由 Renderer `online` 直接重发：它既不拥有业务状态，也不能证明目标 Provider 或 Input Delivery。
- 拒绝持久 Outbox／事件重放：它会复制 Run/Input 权威并无意扩大跨重启承诺。
- 拒绝“统一 ping 成功即重置”：公共网络可达不证明目标 Runtime 恢复，也会让重复 signal 绕过 backoff。
- 拒绝先把 Run 终结再复活：终态是不可逆历史；恢复资格必须在 terminal settlement 前接入。

当前规范见 [Network Interruption Recovery v1](../../contracts/network-interruption-recovery-v1.md)、
[AgentRun Recovery](../../architecture/agent-run-recovery.md)与
[Camp 会话工作区](../../ui/components/conversation-workspace.md)。

<a id="v1-53-d05"></a>
## V1.53-D05：Camp 创建只做目录准入，Git observation 不扫描工作树

### 背景

标准新建对话流程会先调用 `workspaces.inspect` 展示工作区信息，随后 `camps.create` 又执行一次完整 Git
inspection。后者实际只消费规范化项目路径，却连带运行 `git status --porcelain=v1 -z`；该命令的成本会随
工作树和未跟踪内容增长，在较大仓库中可把本应为毫秒级的 Camp 持久化放大到数秒。

Files Changed / Diff Card 已由 Runtime execution evidence 及其文件变更投影拥有，不读取 Git dirty。
`GitObservation.dirty` 只进入诊断和历史导出，未参与 Camp 准入、调度、AgentRun 生命周期判断或 Renderer
产品展示，因此不能用创建路径的同步延迟换取这一弱观测。

### 决定

`camps.create` 只通过 Core directory admission 完成目录存在性、类型、受管目录排除和规范化校验，不执行
任何 Git 子进程。显式 `workspaces.inspect` 以及 AgentRun 开始／结束 observation 继续读取 Git capability、
repository root、common directory、object format、HEAD 和 branch，但不运行 `git status`，也不扫描工作树；
新 observation 的 `dirty` 写为 `null`。

保留 nullable `dirty` 字段与历史布尔值的读取兼容，不修改诊断 schema。仓库测试、发布脚本或开发门禁中
有明确目的的 `git status` 不属于产品运行路径，继续保留。

### 后果与被拒绝方案

- 新建对话的后端路径不再随仓库未跟踪文件数量增长；标准对话框仍可显示 branch 等轻量 Git metadata。
- 新产生的诊断记录不再声称掌握运行前后工作树 dirty；历史 `true` / `false` 仍可原样读取。
- 拒绝缓存或复用一次完整 `git status`：它既保留首次延迟，也会快速失效，且创建流程不消费其结果。
- 拒绝 `--untracked-files=no`：它仍扫描索引和已跟踪文件，同时把不完整结果包装成 dirty 事实。
- 拒绝改用 Git diff 驱动 Files Changed：它会丢失 Runtime owner、epoch、工具证据和实时投影语义。

当前规范见 [Workspace / Git 不变量](../../architecture/foundational-invariants.md#camp-workspace)、
[User Automation v2](../../contracts/user-automation-v2.md)与
[Runtime 文件变更架构](../../architecture/runtime-file-change-observation.md)。
