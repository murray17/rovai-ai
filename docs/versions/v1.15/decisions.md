---
document_type: version-decisions
version: v1.15
lifecycle: current
last_updated: 2026-08-20
---

# v1.15 决策记录

本文件只解释 v1.15 的重要取舍；当前字段与行为规范由 Architecture、Contracts 和 UI 直接拥有。

<a id="v1-15-d01"></a>

## V1.15-D01：运行中 AgentRun 优先完整过程而非固定事件窗口

### 背景

Camp open 原本只返回 non-terminal AgentRun 最近 80 条 Execution Evidence，Renderer 同时只保留最近 600 个
live Runtime event。Runtime 经常把一段正文拆成逐字符 delta，因此这两个窗口并不等价于 80 或 600 个用户
可理解的步骤；长 Run、中途进入或刷新可能静默缺少早期正文和 Tool chronology。terminal Run 已有稳定分页，
但运行中 Run 没有同等补全路径，与执行台“完整保留 Tool chronology”的当前合同冲突。

### 决定

`camps.enter` 与 `camps.open` 返回当前 Camp 所有 non-terminal AgentRun 的完整 Execution Evidence，不再使用
固定 80 条窗口。Renderer 以稳定 Evidence identity 合并投影和 live event，并取消 600 项滚动裁剪；当前
Main Window Session 内已接收的运行事件全部保留。terminal Evidence、单条大内容 preview 与 Managed Blob
按需全文读取在本决策时保持原边界；后续 [V1.15-D02](#v1-15-d02) 局部替代了用户
显式展开 Tool 后的 DOM 展示取舍，但不改变 Camp open 和 Managed Blob 按需读取边界。

### 后果

- 运行中过程在首次进入、刷新和持续 streaming 时都能从最早 Evidence 开始检查；
- Camp open 响应和 Renderer live state 随 non-terminal Run 活动量增长，不再承诺固定 Evidence 条目预算；
- 其他 Camp open collection 仍有界，terminal Evidence 继续按需分页；大 Tool 结果的当前显式
  展开规则由 [V1.15-D02](#v1-15-d02) 拥有；
- Core/Renderer 测试必须使用超过旧 80/600 边界的数据，证明首项仍存在且 coverage 诚实。

### 被拒绝方案

- 仅提高 80/600 的数值：仍会在更长 Run 上静默丢失，只是推迟问题；
- 保持 Camp open 有界、仅给 selected Run 增加后台分页：可以控制首屏，但进入时会先展示不完整过程，并引入
  running high-water、分页追赶和 live suffix 合并的第二套状态机；
- 只依赖 live event、不扩大 Core 投影：中途进入、刷新和 Core/Renderer 重连无法恢复早期过程；
- 把大 Tool payload 全文一并加载：完整 chronology 不要求扩大内容安全边界，会制造无必要 DOM 与 IPC 成本。

### 当前权威影响

- [Camp Open Projection v5](../../contracts/camp-open-projection-v5.md)
- [Camp Open Read Path](../../architecture/camp-open-read-path.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [Run Process Detail Surface v14](../../contracts/run-process-detail-surface-v14.md)

<a id="v1-15-d02"></a>

## V1.15-D02：显式展开后优先完整 Tool 结果而非有界预览复制

### 背景

Run Process Detail Surface v8 为避免大 payload 进入 Drawer DOM，只渲染 10 行/2,000 scalar 预览，
再通过 Icon-only 复制按钮按需读取 Managed Blob。这保持了有界 DOM，但用户无法在执行过程
中连续阅读、搜索或键盘检查完整 Step 结果；底部与 Inspector 移动时条件渲染还会卸载
Drawer，使已展开状态和阅读位置丢失。

### 决定

保持 Camp open 有界 Evidence 和 Managed Blob 按需读取；只在用户展开精确 Canonical Tool 行后，
读取并在原位渲染完整公开 `result/error/output/input/patch`。结果不再截断、不提供复制按钮，
而在固定最大高度的可聚焦 region 中内部滚动。读取失败在原 disclosure 显示精确错误和重试。

执行台使用稳定 portal container 在底部和 Inspector host 间移动同一 DOM，并按可滚动范围比例
保留 Drawer 与结果阅读位置。Tool 行同时收口为四个固定轨道、九类 16px 线性 SVG；
队员入口只保留头像、最多两行名称和带形状的状态标记。

### 后果

- 用户明确展开后可在一个表面阅读完整结果，键盘、200% zoom 和紧凑 Inspector 共用同一行为；
- 显式展开的大结果会占用当前 Drawer 会话的 Renderer DOM/内存；切换 Agent、关闭 Drawer 或卸载
  workspace 后释放，不持久化；
- Envelope、request/receipt、canonical input 与无法关联 Tool identity 的 Evidence 仍不可展示；
- 自动验收必须用 8,000 行以上的 Blob 验证延迟读取、首/中/末内容、内部滚动、键盘、
  DOM identity 与位置保持。

### 被拒绝方案

- 继续“有界预览 + 复制全文”：不能满足原位完整阅读的明确产品目标；
- Camp open 直接携带所有大 payload：会把用户未展开的结果也常驻 IPC/DOM，无必要地扩大成本；
- 移动时只记录 selection 后重建 Drawer：无法可靠保留已读全文、disclosure、加载/错误和嵌套滚动位置；
- 仅依赖颜色精简队员状态：Forced Colors 和非颜色识别不足，因此保留形状语法与辅助名称。

### 当前权威影响

- [Run Process Detail Surface v14](../../contracts/run-process-detail-surface-v14.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [Product/Renderer 基础不变量](../../architecture/foundational-invariants.md#product-execution-surface)

<a id="v1-15-d03"></a>

## V1.15-D03：自身公屏输出不作为同一 Agent 的 recent 未读候选

### 背景

CampMessage 是所有成员共享、持久且可检索的公共事实；此前 recent selector 只按 Camp、sequence boundary、
trigger 与 tombstone 选择，所以 Agent 通过 `rovai send` 发布的上一轮输出会在下一 AgentRun 重新进入自己的
`SHARED_CONVERSATION.recentMessages`。更新的自身消息还能占用 15 条名额并把用户或其他 Agent 消息挤出。
Renderer 隐藏无法修复模型输入，发布后删除消息又会破坏公共事实和其他成员可见性。

### 决定

Profile v4 在 recent `LIMIT` 和 whole-history omission aggregate 前排除
`author_type = agent AND author_id = currentAgentId`。过滤只属于当前 recipient Agent 的模型 recent
projection：消息继续持久化并对用户、其他 Agent、Timeline、History/Search 与 Renderer 可见；当前 trigger
继续通过完整 `CURRENT_INPUT` 交付；自身消息仍可作为理解 eligible message 所需的 reference ancestor。

该选择推进 ContextManifest 至 v19，并以 Migration 98 对 Profile v3 的 Binding、冻结 context 与恢复 Evidence
执行 clean break，避免旧选择语义在重试或恢复中与新 reader 混用。

### 后果

- 自身输出不再占 recent top-15 或制造 whole-history omission，较早 eligible 消息可以回填；
- accepted public boundary 仍跨过自身消息 sequence，避免后续重新注入；
- direct materialization 与 A2A preflight 必须使用同一 recipient Agent ID、selector 和 omission predicate；
- schema 52 store 升到 schema 53 时，非终态执行稳定关闭并清除旧 Session/Binding/Evidence；CampMessage 和其他
  业务事实保留；
- Profile v3/Manifest v18 没有 compatibility reader、dual write 或 downgrade reader。

### 被拒绝方案

- 在 Renderer 隐藏自身消息：只改变人类展示，模型输入和候选名额仍错误；
- 发布后删除或标记自身 CampMessage：会破坏公共时间线、其他成员理解、History/Search 与引用链；
- 在 `LIMIT 15` 后过滤：自身消息仍会占名额，无法保证返回 15 条 eligible 消息；
- 把自身消息从 reference closure 一并隐藏：会切断其他 eligible 消息的必要因果祖先；
- 只按 `source_agent_run_id` 过滤：旧消息或非 Run 来源的自身发布仍会漏入，作者 identity 才是稳定边界。

### 当前权威影响

- [Context Delivery Profile v4](../../contracts/context-delivery-profile-v4.md)
- [ContextManifest Evidence v20](../../contracts/context-manifest-evidence-v20.md)
- [有界公共上下文与引用闭包](../../architecture/foundational-invariants.md#context-public-history)
- [Public A2A Message Delivery](../../architecture/public-a2a-message-delivery.md)

<a id="v1-15-d04"></a>

## V1.15-D04：Published Attachment 采用 Camp 共享 Runtime View

### 背景

权威附件位于 Core 私有 data directory；把其路径写入模型输入并不能保证 TRAE 等沙箱化 Runtime 可以读取。
最初考虑为每个 AgentRun 或 Agent Session 建立最小投影，但这会把文件授权错误地绑定到“附件进入当前
Context”：Agent B 无法主动查看 Agent A 已经发布到同一 Camp 的文件，稳定 Session 还要承担不断变化的
授权根和副本生命周期。直接放开 Authority 根则会把 Draft、Core metadata 和同根其他 Camp 一并推入
Runtime 信任边界。

### 决定

保留 `<data_dir>/camp-attachments/` 为唯一 Authority；Prepared Attachment 始终 Core-private。附件随
CampMessage 事务成功成为 `message_attachment` 时，转为整个 Camp 共享的 Published Attachment，并通过
实例隔离、按 Camp 稳定的派生 Runtime View 供该 Camp 全体 Agent 枚举和只读访问。Runtime 只接收当前 Camp
精确 `attachments` 根；Context 是否显式引用某个附件只决定模型输入，不决定 Camp 内读取权。

发布使用 Runtime 不可达 staging、全组校验、journal、per-Camp mutation gate 与原子 promote；新 Context
统一解析 View path，并推进 Formatter 21、Manifest 20 和 Run Facts v2。所有 Adapter 在没有真实增量可见性
正向 Probe 前使用 generation-fenced Host compatibility。Migration 99 保留 Authority 与历史 Evidence，按
accepted-input 事实终结旧非终态 Formatter 20 执行，再从 `message_attachment` 回填 View。

### 后果

- 同一 Camp 的 Agent 可以主动发现此前任何成员发布的附件，不要求附件再次进入当前 Prompt；Draft、其他
  Camp、Core metadata 和 View 的实例父目录仍不在授权范围；
- 每个 Published Attachment 只有一个 Camp 级 Runtime 副本，路径在 Camp 生命周期内稳定；View 可删除、
  重建并随 Camp 删除，但不能反向成为业务权威；
- 发布与整次 Runtime Run 通过读写 gate 串行化；当前 generation-fenced 模式会在新增附件时 fence 旧 Host，
  而不是为每个 Run 创建新目录；
- `0500/0400` 和 protected DACL 只提供防误写与最小暴露加固；同 UID/SID 的跨 Camp 强隔离仍取决于 Adapter
  sandbox 或 exact-directory allowlist 的真实证据；
- 历史 Authority path、ContextManifest、模型输入 Blob、摘要、Managed Blob 和 `contentDigest` 不改写。

### 被拒绝方案

- 为每个 AgentRun 复制获准附件：把 Camp 协作文件降为 Prompt-scoped capability，并产生重复副本和恢复路径；
- 为每个 Agent Session 累积授权目录：仍按单 Agent 历史划分共享事实，且 Session/compaction/rebuild 使授权难以收敛；
- 把 Authority Camp 根直接交给 Runtime：会暴露 Draft 和 Core-private metadata，并让派生访问问题污染权威布局；
- 授权实例 root、`camps` parent 或全局 Home root：扩大到其他 Camp/实例，破坏精确业务授权；
- 使用 symlink/hardlink：把 Authority 节点和 Runtime 可见节点的身份、权限与删除边界耦合；
- 假设 TRAE Warm Host 自动看到新增目录：没有 Adapter×platform×binary 正向 Probe，不能据此取消 generation fence。

### 当前权威影响

- [Camp Published Attachment View](../../architecture/camp-published-attachment-view.md)
- [Camp Published Attachment View v1](../../contracts/camp-published-attachment-view-v1.md)
- [Camp Attachment v2](../../contracts/camp-attachment-v2.md)
- [ContextManifest Evidence v20](../../contracts/context-manifest-evidence-v20.md)
- [Run Facts v2](../../contracts/run-facts-v2.md)
- [Runtime Launch and Verification v10](../../contracts/runtime-launch-and-verification-v10.md)
- [Accepted Input Recovery v2](../../contracts/accepted-input-recovery-v2.md)
- [Camp Permanent Deletion v2](../../contracts/camp-permanent-deletion-v2.md)
- [Windows Private Storage v2](../../contracts/windows-private-storage-v2.md)

<a id="v1-15-d05"></a>

## V1.15-D05：执行台位置采用本机安装级全局偏好

### 背景

ADR-0190 把 `bottom | inspector` 定义为每个 mounted Camp Workspace 的 Renderer 瞬时状态，并明确不
持久化。该边界避免了最初实现引入 Core 状态，但也使用户在切换 Camp、进入其他页面或重启应用后反复
执行同一布局操作。执行台位置表达的是个人工作台布局，而不是任何 Camp、AgentRun 或协作事实；按 Camp
分别保存会把一个全局阅读习惯错误地绑定到业务对象。

现有 Inspector visibility 已是独立的本机展示偏好，Main 也已有原子、串行写入的 General Preferences。
因此真正的取舍不是“是否把位置写进 Camp”，而是让直接操纵的结果成为稳定的本机偏好，还是继续把用户
选择限制在一次组件挂载期。

### 决定

执行台最后一次成功的显式位置选择成为 Main-owned 的本机安装级全局偏好，跨 Camp、页面切换和应用重启
生效。现有“移到右侧 / 移回底部”按钮是唯一写入口；Settings 不增加第二个“默认位置”。Main 写入成功并
返回权威 snapshot 后，Renderer 才移动同一个已挂载 Drawer；写入失败保持旧位置并原位提供重试。

Placement 与 Inspector visibility 独立成立。用户隐藏 Inspector 时，右侧执行台随 Inspector 不可见，
普通 Camp 切换、应用恢复和后台事件不推翻隐藏选择，也不偷偷把执行台搬到底部；用户显式移到右侧或使用
既有精确执行导航时仍显示 Inspector、激活“执行”。Camp workspace 在权威偏好到位后才挂载，避免恢复时
先显示底部再跳到右侧。

旧 General Preferences 没有位置字段时只补 `bottom`，并保留可识别的其他偏好。不从历史 Camp、旧
Renderer 瞬时状态、Inspector 显隐或窗口尺寸推断位置，不提供旧版本 downgrade reader。本决定局部替代
[ADR-0190](../v0.84/decisions.md#adr-0190) 的 mounted-workspace 生命周期和“不持久化”条款；其单一执行台、
两种承载位置、焦点、唯一 DOM 与不改变 Run 事实等其余边界继续有效。

### 后果

- 一次成功的位置选择会影响以后所有 Camp，用户不再逐 Camp 重复操作；
- General Preferences schema、Main/Preload API、启动投影和 Renderer ownership 需要同步推进，但 Core、
  SQLite、Camp Snapshot、Runtime 与云同步语义不变；
- Inspector hidden 与右侧 placement 可以同时存在，Header 显隐控件必须保持可发现、可键盘到达；
- 自动验收必须覆盖旧偏好默认、跨 Camp/页面/重启、写失败不移动、首屏无闪跳以及 hidden 组合；
- Agent/Run selection、Drawer 开合、已读 Tool 全文和滚动位置仍是 workspace/Drawer 局部状态，不随全局
  placement 跨 Camp 持久化。

### 被拒绝方案

- 只在当前 Main Window Session 跨 Camp 保留：应用重启后仍要求重复设置，不能形成稳定偏好；
- 按 Camp 分别持久化：把个人布局误建模为 Camp 事实，并正面保留逐 Camp 配置负担；
- 在 Settings 增加“默认位置”，位置按钮只作临时覆盖：制造“当前”和“默认”两个概念及竞争写入口；
- 仅写 Renderer localStorage：与现有 Main-owned General Preferences 分裂加载、失败和迁移生命周期；
- Inspector hidden 时自动显示或回退底部：前者推翻用户显式隐藏，后者让偏好位置与实际位置静默分叉。

### 当前权威影响

- [产品/Renderer 基础不变量](../../architecture/foundational-invariants.md#product-execution-surface)
- [Run Process Detail Surface v14](../../contracts/run-process-detail-surface-v14.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [桌面 UI 验收](../../development/ui-acceptance.md#agent-执行过程门禁)
