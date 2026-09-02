---
document_type: architecture
authority: current-foundational-invariants
last_updated: 2026-09-02
---

# 当前基础架构不变量

本文收敛跨多个组件、合同或版本存在的当前规范内核。它直接说明系统现在必须遵守的长期边界；字段、错误、状态机和 wire shape 继续由相应的[当前合同](../contracts/README.md)拥有，决定形成的背景与取舍从[当前决定导航](../decisions/CURRENT.md)进入。

本文不证明代码已经实现这些规则。实现状态必须由代码、Migration、测试和当前版本验收共同证明。

## Core 数据、命令与 Read Side

<a id="desktop-authority-admission"></a>

### Desktop 可用性与权威准入

- Desktop 窗口、主题、本机偏好、Supervisor、重试和 bootstrap diagnostics 可以在 Full Core 不可用时继续工作；
  Camp、Member、Memory、Navigation 与其他业务读写只有 `authoritativeWorkspace` capability ready 后才能挂载。
  阻断期间不得创建替代数据库、查询未准入 authority 或用空集合冒充正常工作区。
  非权威页面框架不属于业务读写：本机恢复目标读取后先显示对应页面框架，正常慢启动/迁移沿用 400ms 内容区反馈，
  统一“正在打开会话”，不暴露内部阶段；只有最终阻断或 crashed 才展示“暂时无法打开会话”的 Bootstrap 恢复面。
- Core 必须先持有绑定 canonical data directory 与稳定对象身份的 OS 排他 lease，再观察或操作 SQLite。数据库
  准入只返回 existing、initializable、migration 或 typed blocked；票据绑定 lease、不可复制、一次消费并在打开、
  清理或发布前复核相关对象。只有 `lumen.sqlite` 时精确使用它，不创建 `rovai.sqlite`。
- 没有 main 但存在 WAL/journal 是不完整 authority，必须阻断；孤立 SHM 只有在票据消费时 exact identity 未变才能
  清理。全新 authority 只在两个 namespace 都确认无 main/WAL/journal 后，通过 staging 与原子 no-replace 发布。
- 只读探测报告需要正常 SQLite journal recovery 时，可在同一 lease 的 exact target 上让引擎完成恢复，再重新准入；
  不把正常 hot journal 回滚永久当作权限故障，也不授权业务写入或手动删除日志。正式连接统一配置 WAL 与同步策略。
- 受支持旧合同只在 ticket 的 exact 原库上执行逐版本事务，无 CREATE；任何写入前重验 contract/classifier/schema cookie/
  全部 receipts 与文件 identity。每步 DDL/DML/marker/receipt 一起提交，中断后从缺失步骤继续；不新建普通升级副本、
  备份或 manifest，不替换主文件，不默认全库扫描。迁移后只重新准入并打开同一 main，不以失败或原库消失为由建空库。
  旧 manifest 继续按 current main 的 original/migrated identity 恢复；未知 identity fail closed。
- Full Core Supervisor 发布单调 generation/revision 的完整快照。旧 child 的 frame、event、response 或 exit 不能污染
  当前 generation；准入/打开/迁移的明确瞬时故障使用独立 250/750/1500ms startup retry，确定性错误不自动重试，均不
  消耗 crash budget。已见 authority 的后续重启禁止初始化空库。Renderer-facing request 继续是 `Promise<T>`，内部 transport
  必须保留领域拒绝、基础设施失败、Full Core 不可用与 shutdown 的结构化类别；failure 以普通对象穿过 contextBridge，
  不能依赖 Error 自定义字段跨隔离世界保留。

<a id="core-command-transaction"></a>

### 权威写入与幂等事务

- Rust Core 是领域事实的唯一写入权威。新增、修改或终结权威事实必须经过封闭的强类型命令及命令专用 Handler；Renderer、Electron Main、Runtime、Skill 和文件投影都不得形成第二写入路径。
- 命令在规范化后计算版本化请求摘要，并在一个 SQLite 写事务中重查幂等结果、校验 Actor、epoch、Capability、expected version 和领域门禁，再提交对象变化、审计事件与唯一命令结果。相同命令身份和相同摘要永久返回首次结果；相同身份但不同语义必须稳定冲突。
- Repository 参加调用方拥有的 Unit of Work，不自行提交。Migration 只改变 schema 和数据，不在事务中执行 Runtime、Git、网络或文件系统补偿；提交后的唤醒只是可恢复提示，不是事实真源。
- 领域事件日志用于审计、幂等结果和增量失效，不是 Event Sourcing 状态库、Outbox、Worker 队列或业务对象的替代真源。
- 渠道 Host 的内部 tick 只推进已提交的 request/Outbox，不是新的业务意图入口，也不为每次唤醒保存永久命令回执。
  维护步骤仍在 Core 单个写事务内调用既有 Handler；真实 admission 的领域事件、FIFO 防重和 delivery lease/结算幂等
  均保留。Core event 只负责提早唤醒，provider outstanding、静默判定及请求/响应丢失恢复由
  [Channel Host Maintenance v5](../contracts/channel-host-maintenance-v5.md) 拥有。

<a id="core-managed-content"></a>

### 自然领域事实与受管内容

- Task 完成是显式授权的状态更新，不由通用 Evidence 服务判断。公共讨论、私有连续性、执行生命周期、副作用结果、本地不可变文件、Git 提交和状态转换分别由其自然领域对象拥有；引用这些对象不会把它们变成通用 Artifact 或 Task 完成门禁。
- `ManagedBlobStore` 只承担不可变、内容寻址的本地内容保存、完整性校验、去重、授权流式读取和按权威引用回收。它不是跨 Camp 内容库、发布系统或独立领域聚合。
- Blob 写入遵循“私有临时文件流式哈希 → fsync 与原子放置 → 事务性元数据/所有者引用 → 后续回收孤儿”的顺序。文件名、大小、媒体类型、路径穿越、权限和秘密安全在每个边界独立校验。
- 旧的消息附件可以根据当前权威改为 Camp-public stable path/directory snapshot；这是明确的领域存储边界，不意味着 `ManagedBlobStore` 自动拥有所有附件内容。Schema/data migration 只能在可验证的原子步骤中改写权威引用，不用后台 Runtime 副作用填补失败。

<a id="core-read-side"></a>

### Snapshot、订阅与 API 边界

- Renderer DTO 从 SQLite 权威表和确定性派生规则生成，不维护第二套持久投影或可独立写入的 Runtime 状态缓存。每个 Snapshot 在单一读事务中捕获 `throughGlobalSequence`；增量事件只用于失效和时间线更新。
- 影响 Desktop Navigation 投影的 mutation 只在权威提交完成后发 `navigation.invalidated`；该事件不携带可直接应用的状态。Renderer 通过一个全局 generation coordinator 合并事件、focus 与低频安全刷新，串行重读完整 Snapshot，不为每个 Camp 建立 timer，也不让 Overview 附属模块失败关闭 Navigation 恢复。
- 断连、序列缺口、未知 schema 或派生缓存不确定时，客户端丢弃相关缓存并重新获取 Snapshot，不能靠事件重放猜测权威状态。授权范围必须先于过滤和分页建立。
- Renderer 只能通过 Electron Main 的封闭 allowlist 和类型化合同访问 Core，不直接访问 SQLite、受管文件、Git 或 Shell。每个领域命令只有一个权威写入路径，每个读取入口都必须按调用者和 Camp scope 过滤。

<a id="core-notifications"></a>

### 通知事实与投影

- Core SQLite 是通知唯一持久真源。合格来源事实、不可变 `NotificationOccurrence`、独立 Disposition、聚合 `NotificationEpisode` 和最小 `NotificationChangeJournal` 在同一 SQLite 事务中提交；通知是用户注意力投影，不能批准 Approval、改变 CampTurn 或替代来源业务对象。
- Episode 的一般语义版本与新增注意事项 revision 分离；clear 绑定用户观察到的 attention revision，普通元数据变化、确认或解决不得复活已清除事项。
- Core 拥有聚合、原因计数、排序、最早未确认 mention、类型化 action 和 availability。Renderer 只负责本地化、布局与执行 action；Electron Main 不保存通知副本，普通 Agent 公屏消息也不会仅因出现而生成通知。
- 通知命令、snapshot、有界 incremental journal 与重新 snapshot 规则都是 Core API；Renderer 不保存可独立写入的 inbox、不从 Toast 生命周期推算已读/清除。序列缺口或未知 schema 时必须重取 snapshot。

## Camp、Workspace 与 Composer

<a id="camp-lifecycle"></a>

### Camp 创建、命名与激活

- Camp 创建是 User-only、幂等且原子的独立领域动作。它冻结 workspace、成员、Default Lead 和协作模式，但不创建 Conversation、消息、Turn、Run、Native Session 或执行 Workspace，也不把 Runtime ready 当成 Camp 创建前提。
- Camp 可以持久存在于零消息、零 Conversation 状态。Conversation 只在原子 Execution Admission 中为每个精确目标惰性创建；该业务准入不执行 Workspace 文件系统、Git、Runtime discovery、可执行文件或 fingerprint 检查，多目标提交保持 all-or-none。
- Camp 名称经过空白规范化并受 Unicode scalar 上限约束，持久记录 `default | generated | user` 来源。只有第一条已接受用户执行提交可把默认名确定性改为生成名；用户命名永不被自动覆盖。生成名从权威 Structured Content 中去掉连续的行首寻址 mention 后计算，不从原始 Markdown 猜测。
- 飞书/钉钉渠道 Camp 复用同一默认命名与原子生成流程；渠道类型由既有绑定只读投影，前缀只在 Renderer 展示，不写入 title 或模型输入。闭合的历史绑定仍保留来源，不批量改写旧名称。字段见 [Channel Camp Naming v1](../contracts/channel-camp-naming-v1.md)。
- Camp activation 是 Core-owned `pending | active` 状态。显式创建 Dialog 直接建立 Active Camp；经确认的一键入口建立 Pending Camp；Pending Camp 的第一条已接受用户提交在消息事务中将其激活。Pending Camp 不进入普通执行入口；空 Pending Camp 只能经受控丢弃或启动清理删除，有正文或附件的 Pending Draft 才能进入导航与恢复。

<a id="camp-workspace"></a>

### Workspace 与动态 Git 能力

- 每个 Camp 的持久 Workspace Binding 由 `projectBindingKind: quick_chat | directory` 和绝对、规范化、可遍历且安全的 `projectPath` 组成。`quick_chat` 指向应用受管的 Quick Chat 目录，`directory` 指向用户明确选择的安全目录。Core 拒绝文件系统根、产品私有数据树、直接 Git 元数据目录和 bare repository；Runtime 权限仍独立决定 Agent 实际可做什么。
- Git 是对当前目录的动态能力，而不是 Camp 身份。Core 在创建、Run 启动、Git 专用操作和 Run 终止等边界重新观测 `not_git | git_valid | git_invalid`；Git 失效只关闭 Git 专用行为，不废止安全目录、协作历史或普通文件工作。
- AgentRun 文件变化只来自 Runtime 在该 `agentRunId + executionEpoch` 内明确报告并已落库的可靠终态 Evidence。
  Core 不通过 Git tree、baseline/final、checkpoint ref、目录扫描或当前文件读取补充结果，也不跨 Run 合并；因此
  Git 与非 Git workspace 使用相同观测能力，并行 Run 分别形成自己的结果。
- execution root 是 Runtime path 的规范化基准，不是这项观察的文件权限来源。文件变化路径必须纯词法收敛为该
  root 内的相对路径或 root 外的规范化绝对路径。当前 Built-in Tool Process 的精确 `ROVAI_RUN_TMP` 及后代必须在
  durable Evidence ingress 前排除；该边界不扩大到应用 data dir、其他进程临时目录、同名前缀目录或普通 root 外
  用户文件，也不打开文件、不改变 ACP Client FS/Terminal 的 Runtime-owned 权限模型。
- AgentRun 仍冻结 workspace 路径及起止 Git observation 作为既有终态审计事实；这些 per-Run audit facts 不参与
  文件变化卡片归约，也不成为 Project/导航身份。导航继续按规范目录路径分组，不引入 Project 表或 Repository
  Scope。
- **Quick Chat / 快速对话** 是应用受管 workspace 的规范领域与产品分组术语，不是 Camp 或 Project。Rust variant 使用 `QuickChat`，存储与 IPC 值使用 `quick_chat`，JavaScript/TypeScript property 使用 `quickChat`，CSS/test identifier 与受管目录名使用 `quick-chat`。旧称只允许存在于历史快照和迁移证据；当前代码、合同与投影不保留 alias、deprecated field、dual read 或旧 wire value 翻译。

<a id="camp-composer"></a>

### Composer Draft 与用户发送

- 每个 Camp 至多一个 Core-owned Composer Draft。Draft 保存 Structured Content、准备中的附件、reply intent、显式接收者修复状态和 recipient continuation，并以统一 revision、恢复、过期和消费边界保持用户私有编辑状态。
- Composer 提交只能引用精确 Draft revision。Core 准入后直接物化 CampMessage、附件和执行意图，或原子转入私有 Pending Camp Input；两种成功都消费 Draft，冲突或拒绝不部分消费。用户消息、Agent 消息和系统来源都保存封闭、版本化的 Structured Content，而不是依赖 Renderer Markdown 推断身份。
- 用户 Draft 的 rendered body 非空或至少一个 Prepared Attachment 为 `ready` 时才可发送；两者同时为空继续拒绝。纯附件 accepted 消息忠实保存空 body 与空 Structured Content，不生成占位正文，并沿用同一 publication、consume、CampTurn 与 AgentRun 原子边界。
- Reply 是持久双意图：引用同 Camp 可回复消息，并从其最终冻结寻址推导接收者；引用失效时必须显式修复，不能静默退回 Default Lead。单一非 Lead 显式收件人可形成下一空白 Draft 的 continuation，Agent 发言、Default、Broadcast、多收件人或 Lead 消息不会推进该候选。
- 私有 Pending 不进入公共时间线、History 或 Runtime Context。Renderer 先等 Core 决定入队或发布；只有具有正式 Message 身份的输入才展示为消息。Pending 原子发布、FIFO、编辑占用与暂停见 [Pending Camp Input v1](../contracts/pending-camp-input-v1.md)。

<a id="camp-resources"></a>

### 附件、首次运行与删除

- Camp Attachment 是 `file | directory` 封闭联合。Core 负责分类、无 symlink 遍历、限制、复制、摘要和只读快照；一个目录作为一个层级附件全成全败，包含隐藏项和空目录。
- Prepared Attachment、Agent workspace 与 `ROVAI_RUN_TMP` ingress 在发送前只供 Core 使用。所有新写入在 Send 时复制一次到 Camp-scoped Managed Attachment v2；commit 后的 `managed_attachment` 是 Camp 公共资源，`camp_message_attachment_ref` 只表达有序引用。消息寻址、Prompt、Run、Conversation 或 Session 都不把 Camp-public 资源变成 Context-private capability。
- Managed v2 payload 是唯一长期物理副本，位于既有 Runtime Camp `attachments/.managed-v2/` 根并保存强制 digest/tree receipt。Runtime 被视为可信的同 UID 本地程序；只读 mode 防误写而非强隔离，没有第二份 Authority 自动重建。显式 preview/open/reveal 仍重验 exact Camp/Attachment、路径、类型与 receipt；Renderer 不接收本地路径或原始系统错误。
- Managed v2 使用 durable ingest intent、quota reservation、私有同卷 staging、no-replace promote、final reverify/fsync 与最终 SQLite semantic commit。它不取得 legacy View write admission，不等待 quiescence/AgentRun，不推进 generation，不停止或 fence 已运行 Run，也不创建 `projection_blocked` Delivery；新 Delivery 直接进入普通 Dispatch Pump。
- Context、Camp History 与 Camp Open 对 v2 只查持久 metadata 并组合路径，不 `stat/open/read_dir/digest` payload。文件后来不可读时由 Runtime 原生工具失败；Context 不生成 unavailable descriptor/Run Fact，也不据此改写全局附件状态。
- 历史 `message_attachment`、Authority 与 Published Attachment View 保持只读兼容，不批量迁移、不双写。Legacy writer intent、generation、recovery 与 `projection_blocked` 只收口既有 v1 operation；View verifier 忽略 `.managed-v2` 保留子树。旧 Camp 无需转换历史附件即可发送新 v2 消息和继续运行。
- 首次安装训练进度由 Electron Main 的私有版本化 Desktop 状态拥有，但 fresh/existing admission 只使用 Full Core
  已准入的 authority origin：全新初始化进入训练，existing/migrated grandfather 为既有安装；文件名存在性、sidecar
  或探测失败都不能代替该结论。损坏偏好使用内存默认、告警并保留原文件。正常 Provisioning 通过可重试 checkpoint
  幂等创建首个成员、Runtime 选择和“初次集结”Camp/Draft，不把半完成状态伪装为已完成；无可用 Runtime 且
  provisioning 尚未开始时可以原子完成为 `runtime_deferred`，但不得创建成员、Runtime 配置、Camp、Run 或
  onboarding restore target，也不得在以后启动时重新打开训练营。
- Camp 永久删除保持 User-only、exact-version 和单事务聚合删除。普通模式要求 quiescent；用户明确确认的 force 模式先持久化停止/隔离边界，再删除 Camp 聚合并异步清理受管资源，不能把未知 Runtime 外部效果宣称为已撤销。

## 成员身份、生命周期与投影

<a id="member-identity"></a>

### 三层身份与命名

- AgentProfile 使用三个当前身份层：SQLite 内部不可公开的 UUID、工具/模型/审计使用且不可复用的 `agent_<positive integer>`、用户可编辑且全局唯一的 Member Name。数字后缀不表达角色、能力、排序或权威。
- Agent ID 由应用级单调序列在创建事务中分配；已提交身份即使永久移除也不释放。内置成员使用同一格式和分配合同，不形成领域子类型。
- 模型和工具选择成员时同时投影 Agent ID、名称、团队角色和专业职责，不能从名称或数字猜 ID。旧 handle 只用于解释历史文本，不是当前目标、当前展示或新身份分配层。
- Member Name 在创建/编辑事务中规范化并执行全局冲突检查。Composer 展示名称但提交结构化 Agent ID；历史文本可投影当前名称而不改写原始 SQLite 正文。
- 历史的 summary-model 或可变名称配置不是当前身份层。模型配置属于原子 Member Runtime Configuration，不通过另一个“摘要模型”入口改变成员身份或公共历史语义。

<a id="member-lifecycle"></a>

### Presence、成员关系与历史保留

- `present | away | removed` 是 AgentProfile 的独立生命周期。Runtime 配置、可用性、认证或探测结果不得隐式改变 Presence；`removed` 是不可逆终态。
- `away` 阻止新 Run，但保留身份、CampMember、Task assignment、Runtime 配置、头像、Memory 和历史；归队只恢复未来活动资格。永久移除只在不存在非终态 Run 时推进 Presence 和审计，不物理删除身份或历史关联。
- removed 成员从活动名册、寻址、分配、Runtime/Skill/MCP 投影和未来 Memory counterparty 中排除，但历史消息、Task、Run 和审计继续显示原身份。历史配置可以成为不可执行的保留事实，不能阻止当前 Installation 清理。
- CampMember 表达 Camp 内关系而不是复制全局 Presence。成员顺序稳定，Default Lead 必须是当前有效关系；Camp 至少保留一位 active member。动态添加/移除使用 Camp membership generation 与关系 exact version；曾离开成员再次添加是普通添加但形成新的 membership lifetime，不复活旧授权。对当前 active member（包括 Presence 为 `away`）的相同 capability overrides add 是 no-op，不同 overrides 必须 conflict，不能借 add 静默旋转 lifetime；只有 left/不存在的真实添加要求 Profile 为 `present`。
- 移除复用现有定向 membership cutover：结束关系、修复 Lead、释放开放 Task，按原 selector 结算成员 lifetime 的 Run、收件/来源/Gather Delivery 及已物化目标 Run；同一事务完成 reconciliation 审计，只重算 affected Turns。无关 Run 和渠道投递不受整轮取消；外部来源仍受 allowlist、Camp-bound source 与 exact generation 约束。

<a id="member-projection"></a>

### 头像、内置外观与 Native Session 身份

- `avatarRef` 是 AgentProfile 唯一头像领域字段，引用受控内置外观或应用受管不可变本地资产。选择、解码、规范化、限尺/重编码、原子保存和引用提交分层校验；先物化不可变资产、再事务提交 ref，失败/替换产生的孤儿由延迟安全 GC 回收。原路径、原图元数据和图像正文不得进入 SQLite、日志、诊断或导出。
- 每个封闭内置角色只有一套当前 packaged appearance/preset；升级直接替换受控引用背后的当前内容，不维护旧图库，也不从外观推导角色、Capability、Runtime、权限或生命周期。
- 用户导入图像仅存本地，备份/导出默认只包含安全 ref/受控资产而不恢复原始文件路径；缺失、损坏或未随备份携带时降级为中性展示，不修改身份或从不可信路径回读。
- `MEMBER_IDENTITY` 是一个 Native Session 唯一完整的 self identity；`COLLABORATION_STATE` 只投影新 AgentRun 冻结时当前 Camp peers 的路由身份和 Lead 引用，不重复 self，也不包含人格、Presence、Runtime、busy、membership generation/version 或成员变化 delta。已冻结 Run 不因名册变化被原位打补丁。
- Collaboration projection digest 对完整最终模型计算，是否实际包含是独立 evidence；只有 Runtime Input accepted ACK 才推进 Conversation 水位，未知或失败投递必须在后续输入重试。

## 协作、Task、消息与 Delivery

<a id="collaboration-admission"></a>

### 协作聚合与执行准入

- Camp、CampMember、Default Lead、Conversation、CampMessage、CampTurn、AgentRun 和 Task 由 Core 作为同一协作边界协调。Presence、Camp membership、Runtime readiness、Capability、权限、预算和 fencing 是相互独立的准入轴，不能由其中一项推导其余项。
- CampMember 只表达 Camp 内关系，不复制全局 Presence。成员顺序使用稳定、不复用的关系序列；Default Lead 必须是当前有效关系且符合领导资格，Camp 至少保留一位 active member。动态关系命令使用 generation/version CAS，Lead successor 与影响预览由 Core 验证，不由 Renderer 自选替代。
- Camp 只冻结 workspace binding 和成员关系，Git/Project 是可重观测投影而不是新聚合。新 Camp 不预创建 Conversation 或 Run；原子 Execution Admission 为精确目标惰性创建 Conversation、公共消息、Turn 与 queued Run，多目标保持 all-or-none。Workspace、Git、Runtime 与可执行文件检查属于后续 Scheduler dispatch 边界。永久删除默认要求 quiescent，force 只能在用户明确确认和持久停止/隔离边界后执行。
- 外部渠道不得直接写 CampMessage、CampTurn 或 AgentRun；完成 transport dedup/聚合和 live binding recheck 后，必须复用同一原子 Execution Admission。尚未绑定或仍在渠道 FIFO 中的消息不是公共消息，也不进入 History、Context 或执行。`ExternalPrincipal` 只表达作者、上下文来源和回复目标，不继承 `local_user` 的项目、绑定或本机管理能力。
- Renderer 可以先本地显示待确认的用户消息，但不得把它当成 CampMessage。Core 接受发送时原子持久公共消息、Turn、目标 Run 和冻结配置；Scheduler 在执行边界完成 workspace、Runtime、Git、当前 exact membership lifetime/permission/fence 检查。所有 Agent 业务工具也必须匹配 Run 冻结的 membership version；再次添加同一 Agent 不恢复旧 Run 权限。失败产生诚实 Run 终态，不撤销已接受消息；per-Run ending Git observation 属于终态审计，Runtime 文件变化属于 terminal 后的附加 Evidence projection，二者都不是发送准入。
- 一次 CampTurn 的 root Run 与 A2A 后代共享冻结 execution budget。Core 以一个事务检查与消费总 AgentRun、accepted A2A、depth、fanout 和相关 allowance，并对重放返回同一结果；客户端、Runtime 或多条 Delivery 不能拆分请求绕过预算。
- CampMessage/CampTurn/AgentRun/Conversation 与 Domain Event 的创建、开始、更新和结束字段使用调用时 UTC wall clock；`AgentRun.created_at` 属于输入接受边界，`started_at` 属于实际 claim 边界。Execution Budget 另用非倒退 observation，取 wall clock、进程 awake elapsed anchor 和上次 observation 的最大值，使系统休眠计入 deadline、wall clock 回拨不延长预算；Budget observation 不得写入业务审计时间。
- Composer Stop 作用于整个 CampTurn；共享 ExecutionDrawer 的 Run Stop 只作用于当前 Run，不取消兄弟 Run 或关闭整轮渠道输出。两者都在 Core 事务提交 cancelled 业务终态，IPC 返回后结束等待；Runtime 后台清理不影响业务终态。发送与效果不确定性继续保存在 Input/Action 审计中，但取消不产生公共 hasUnsettledExternalEffects 提示，也不允许自动重发。待发送队列按业务 Turn 完成推进，同 Conversation 的新执行仍须通过旧 Runtime 清理隔离。

<a id="collaboration-task"></a>

### Durable Task 与 Run instruction

- Task 是跨 Run 持续的责任对象，通知和执行是独立层。当前生命周期是 `pending | in_progress | blocked | completed | cancelled`；terminal 不可变，blocked/completed 分别需要非空原因/总结。Task 的 owner、definition、assignment 与 execution state 各自有明确权威，不由通知、Run 或发送自动推进。
- 只有 User 或当前 Default Lead 可创建和修改 title/description/ordered acceptance criteria、分配、释放、改派、回到 pending 或取消；创建要求显式当前 CampMember assignee，且不发送消息或唤醒 Agent。Assignee 只能以 exact version 更新自己的 `pending/in_progress/blocked/completed` 执行状态与相应说明；任一越权字段使整个 patch fail closed。
- Unassigned 只能由 User/Lead 释放或 Camp membership 结束的原子 cutover 产生，必须保持 `pending`，不是可抢占共享队列。关系结束要在同一命令中释放其非终态任务；历史责任与已接受 Run 审计事实保留。
- Task-linked responsibility 在 direct/A2A 的原子接受边界只准入一次，冻结 Task ID、version 和 Assignee。后续 Task 释放、改派、编辑或终态不追溯否定/改派已接受责任；但新的 membership、Presence、Runtime、permission 和 fencing 仍在每次真实执行时使用当前事实。
- 触发 CampMessage/ConversationMessage 的 body 以 `CURRENT_INPUT` 作为 Run 唯一自然语言指令。Task 全文不复制到 Run，`purpose` 只用于 Core 审计/责任描述；不存在第二份 `expectedOutput` 或 Core 对自由文本交付质量的判断。

<a id="collaboration-history-addressing"></a>

### 公共消息、History 与寻址

- CampMessage 是唯一公共消息事实；ConversationMessage 只服务目标成员的私有连续性。公共 A2A、用户消息和允许的 Runtime 自动输出都必须先越过同一 publication fence，之后才可进入 History、Context、通知或 Delivery。
- History 的稳定职责分为 Camp discovery、单一显式 Camp 内 search/read、跨 Camp public search 和按 exact ID/sequence 分页读取；工具只返回结构化、有界、可继续的结果，不恢复旧 Summary 或让 relevance search 取代权威顺序读取。中文/短查询、转义、派生索引与 tombstone 使用确定性合同，索引可重建且不成为第二真源。
- `rovai camp read` 的 CLI 省略 mode 时只解释为 `timeline + before + limit 20`；显式 Camp ID 只改变单一 target，显式 direction/limit 覆盖对应默认，cursor 不设默认。item/around/thread 仍必须显式选择，message ID 和模式专属字段从不推断 mode。
- Agent 只能访问自己当前具备 Camp 关系和运行授权的公共历史；每次读取都重做 live authorization，ID、搜索命中、旧 Manifest、引用闭包或过去的关系不扩大 scope。跨 Camp search 只发现当前可见公开消息，后续 exact read 仍使用相同授权。
- `camp.message.send` 只有 `automatic | public_only` 两种持久寻址意图。只有显式 built-in routing operation 且意图允许 Agent addressing 时才创建 Delivery；Runtime 自动 final、普通用户消息和纯 public publication 不能靠正文意外唤醒 Agent。
- Agent Send 的 body 缺省为空字符串、files 缺省为空数组；trim 后正文非空或至少一个文件即可构成 payload，两者同时为空由领域服务拒绝。纯附件 accepted 消息忠实保存空 body，不生成占位正文，并沿用同一公共消息、publication、Delivery、receipt 与 Replay 边界。
- Canonical Agent ID 是稳定目标形式，`--to` 是 Agent 唯一推荐的目标 authoring 入口。Core-only inline 兼容解析可在逻辑行首接受由空白分隔的连续 canonical token 或精确当前成员显示名；只消费连续有效前缀，遇到未知、歧义或普通 prose 即结束并保留 Text，mid-line display-name 不寻址。既有 malformed canonical token 仍 fail closed。
- 当前 Run 作者可以按 exact message ID 读取自己刚提交且越过 publication fence 的消息；该窄例外不扩大历史高水位、其他作者或跨 Camp读取。

<a id="collaboration-delivery"></a>

### Message Delivery、返回链与恢复发布

- 公共 CampMessage 与 per-recipient Message Delivery 是两个事实；先通过唯一幂等 publication fence 接受消息，再为每个冻结收件人创建持久执行责任。Delivery admission 冻结收件人的 exact membership version；dispatch、materialization 与 retry 都必须匹配，离开后再次添加不能复活旧责任。普通 outbound A2A 还必须匹配 source Run 冻结的 membership lifetime：source 离开会终态化 pending Delivery，并把已 materialized 下游 Run 纳入 reconciliation。Source Run 的 frozen peer projection 不限制新 send 的 target roster；仍有效的旧 Run 可以联系后来加入的当前成员。Delivery 失败、取消或恢复不撤销公开消息，公开消息也不自动证明已投递。
- Dispatch Pump 是 recipient-scoped、事件驱动且可恢复的；accepted、attempt generation、waiting、retry eligibility、cancellation、terminal settlement 和当前 Run/Native Binding 由 Core 状态推进。中断在途 attempt 必须在新 attempt 前经 fencing/reconciliation，不轮询 Runtime 文本、不从进程消失猜结果。
- Delivery cancellation 是单调终态：零 attempt 的 pending/projection-blocked 或 interrupted-before-dispatch 行可直接成为 cancelled/terminal，不创建虚假 attempt；已有 attempt 保留正数 count 并终结当前 attempting/waiting attempt。显式与 CampTurn/预算批量取消共用同一状态转换，清除 wait、active attempt 与 projection gate/operation；迟到投影回调、Pump 和 startup recovery 只能推进仍匹配的 pending 行，不能复活 terminal Delivery。
- `forward | return` 是独立 Delivery 边类型。Caller return 使用 Core 管理的 reply reference、caller lineage 和显式收件人；模型不提交可伪造 reply target，返回不通过文本 mention、Conversation 默认目标或 Runtime 私有历史猜测。只有可证明的当前 Gather capture 可以在不创建普通 caller continuation 的情况下结算对应 Item。
- Runtime Adapter 明确冻结 public-output mode 和独立 Missing-Send Recovery policy。Runtime automatic final 只能按模式发布无收件人的公开输出，不从正文派生 Delivery/reply。普通输出与成功 Run 的 Missing-Send 候选都必须通过 frozen membership lifetime publication fence；终态 evidence 可以窄结算旧责任但不能发布。竞态、重放和终态恢复经同一 publication identity 去重。
- Current User 是 Core-owned `local_user`；Agent routing 与 User attention 是正交轴。结构化 user mention、持久 occurrence/episode、确认和导航水位由 Core 管理，Human/Agent Principal 使用不同受限投影，Renderer 不从正文或焦点猜用户身份。

<a id="collaboration-gather"></a>

### Gather

- Gather 复用统一 Message Delivery，但增加独立持久 Barrier：一条公共请求、固定 Item/recipient、逐 Item capture、原子 settlement 和一个异步 Completion Delivery。它不是临时轮询、多个普通 send 的客户端聚合，也不用 Runtime 文本作为完成真源。
- 每个 Item/generation 只保留按权威 accepted sequence 确定的最后一个合格 return capture，并使用独立于普通 A2A 的正文上限；它不消费普通 accepted-A2A 计数。旧 generation、错误 recipient/lineage、迟到或超限返回保留证据但不覆盖当前结果。
- Completion 输入必须是 self-contained typed Current Input，携带完整原请求、当前代、Item 结果/失败和限制证据；完成方不得依赖已经被上下文预算丢弃的旧公共消息。
- Gather 接受冻结 initiator membership version。移除发起者会在 cutover 中取消 Gather、开放 Items 与 pending completion，并请求精确运行中的 Run 停止；不改投 successor。只有正式 Delivery/Run terminal settlement 推进 membership reconciliation，再次添加不复活旧 Gather。

## Runtime 执行、安全与平台

<a id="runtime-catalog-installation"></a>

### 资源、Catalog 与 Installation

- 每个 Run 的文件、Shell、Git、网络和 Runtime tool 权限由接收 Runtime 的冻结配置拥有；A2A 不获得调用者
  workspace 参数。对 ACP Client FS，Core 只验证当前 Host/Run/epoch/Session/Prompt 和协议参数：Runtime 提供的
  绝对路径原样执行，相对路径只以 execution root 为解析基准，不做 containment、Workspace access 或一次性写授权
  检查。对 ACP Client Terminal，省略 cwd 时使用 execution root；显式 cwd 只要求是已存在的绝对目录，不调用
  `scoped_path()` 或拒绝 root 外目录。Rovai 对自有 blob、附件 Authority、私有配置、凭据、IPC 和领域命令的安全
  仍由各自产品边界强制，不把这些边界转换成 Runtime 已知路径的第二层文件或 Shell allowlist。
- Product Runtime Catalog 是编译时封闭的可执行 Adapter 集合；只有具备 Adapter、所需 built-in/MCP 能力、深检、冻结 Run 配置和必要 evidence 的 Runtime 才能进入。兼容性候选留在研究文档；Settings 可以显示明确标记为 pending/unsupported 的静态 Preview，但 Preview 不是 AdapterKind、Installation、Readiness、成员选项或执行能力，也不进入 Core/Contract。
- Catalog 与本机 Availability、成员 Readiness 是三个独立层。Core 拥有 discovery、check attempt、capability snapshot、退避和结果缓存；Renderer 只读缓存、发送 ensure/check 意图并展示一个可操作主状态，不从路径、版本或错误文本自行判定可执行性。
- Core 在启动和每次 rescan 时构建不可变 Runtime Search Environment。Windows 上，手动绝对路径、Adapter 专用环境 override、自动 PATH/known locations 是依次封闭的 candidate set；显式入口失败不能回退另一个同名 Runtime。Windows 每次 capture 只读合并 inherited process PATH、HKCU User PATH、HKLM Machine PATH 与 known locations，按该顺序稳定、大小写不敏感去重，并忽略无效或不存在目录；Registry 失败不阻断 inherited PATH。冻结 PATH 同时用于发现、version/deep/health Probe、AgentRun 与 Runtime 必要子命令。Windows 同目录候选只允许 `.exe → .cmd → .bat`，不随 PATHEXT 放开 `.ps1`。Codex npm/pnpm `.cmd` 只可作为受限 locator 解析到 package 内真实 native `codex.exe`；解析成功后脚本、Node entrypoint 与 `node.exe` 不成为 Installation 或 launch identity，但 Core 必须内部持久化 canonical shim/content、System32 interpreter identity 及 resolved target identity 的 locator evidence。locator digest 参与 Installation generation、snapshot 与 Host compatibility；shim 改写即使仍指向同一 native executable 也撤销旧 Ready evidence。其他 `.cmd/.bat` 必须保持 `windows_command_shim` identity，其 canonical path、内容 digest 与 canonical System32 interpreter identity 共同 fence snapshot/Host，并只经 Managed Runtime Process 的受控 batch serializer 启动。
- 静态 discovery/rescan 只允许路径、权限、文件身份和 Adapter 声明的无副作用有界身份命令。纯找到可执行文件是 `found_uninspected`；身份命令成功才可形成 `light_ready`，但二者都不声称认证、协议、模型、Session 或 capability Ready。启动、页面打开、成员选择、过期和重扫不自动深检；深检只由用户明确检查、模型 Picker 的按需刷新或真实 Run 的统一 Dispatch Preflight 触发。
- Runtime Check Manager 是 deep-verification attempt 生命周期的唯一所有者：同 Runtime 最多一个在途 attempt，全局上限为二，执行优先于显式检查。Ready/StableFailure/Superseded/error/timeout/panic/abort/cancel/shutdown 经同一 finalize 收口，提交必须同时匹配 search generation 与 fingerprint；短命进程必须有独立进程树、绝对 deadline、有界输出和有界 cleanup。Managed resolution 不在 Adapter Deep Probe 外重复启动 version gate；每轮包含 version 在内的完整 Probe 前后复核 executable file identity。首次被更新取代时在原 attempt/deadline 内重新绑定当前 path/fingerprint 并最多重试一次；第二次仍变化只 deferred，不持久化失败或唤醒执行，并在三秒进程内冷却后允许 Scheduler 自动发起新的有界 attempt。
- executable fingerprint 变化立即撤销旧 Deep Probe 对当前 Runtime 的 Ready、capability、认证、动态权限与 Session compatibility 资格。旧成功 models 与原 `lastSuccessfulProbeAt` 可以在既有 24 小时窗口内作为 stale LKG 保留，到期即 expired；它只服务模型选择体验，不能证明当前 binary 的模型支持或绕过 Dispatch Preflight。公开 `lastProbeAttempt` 只投影当前 snapshot fingerprint 的 attempt，旧行只保留历史诊断价值。
- TRAE 参加与其他 Runtime 相同的 light discovery、Availability Check、Installation Refresh、Health Probe 与 Dispatch Preflight 生命周期。`AvailabilityCheck` 与 `DispatchPreflight` 共享唯一 Machine Ready 合同：非空 version、当前 executable identity/fingerprint、ACP v1 `initialize`、`session/new` 与非空 Session ID、非空动态 model catalog、非空 permission/mode catalog，以及 current model/mode 都存在于相应 options 的 coherent Session config shape。检查不发送 Prompt、system marker、文件拒绝、sleep/cancel、Tool 副作用或 `session/set_config_option`；这些只属于独立 Adapter/version/platform 行为证据。旧 `ready` 缺少当前合同任一证据时先降级，不能让弱检查跳过 Scheduler 门禁。旧 `installed_unverified` 只可作为历史读状态，不再是可配置或可执行入口。TRAE 的本机真实进程验收必须串行，第三方密钥或状态文件竞争不形成产品分支。
- `MemberRuntimeConfiguration` 是成员唯一持久、公开投影的 Runtime 值，将 Product Runtime、model policy 和 Adapter-native permissions 作为一个 exact-version 原子值保存。通常只有当前 capability evidence 可验证的完整配置才能提交；`light_ready` 只允许已声明的 runtime-default model 和静态 permission descriptor。所有 Product Runtime 的新配置默认使用 Adapter 已验证的原生最高权限，Kimi 为 `yolo`、TRAE 为 `bypass_permissions`；用户仍可显式选择较窄模式。背景发现不代用户创建、扩权、补全或改写配置，capability/permission schema 漂移只改变 Readiness 并要求显式重存。
- 成员保存的 model policy 与单次 AgentRun 的实际模型观测是不同事实。`runtime_default` 只在 Runtime-native、结构化且可归因到当前 Thread/Session 的字段出现时记录首个模型；目录默认值、请求参数、冻结配置、Usage 或文本输出不得补推。观测按 Run execution epoch、default-only、write-once 持久化，缺失或拒绝不改变 Run 终态，也不回写成员配置。
- `ResolvedRuntimeBinding` 只是调度、诊断和 Run 冻结使用的内部执行状态，不进入普通 AgentProfile 读取或成员编辑。用户发送先按消息、目标和冻结配置完成业务接受，Runtime resolution、workspace launchability 和完整执行 Preflight 由 Scheduler 在真实执行边界重查；失败形成诚实 Run 结果，不回滚已接受消息或静默改派目标。
- AgentRun 冻结 Adapter、Installation、auth scope、model 语义和 permission 的逻辑 Runtime 身份，初始版本和 fingerprint 是不可变审计 evidence。排队/恢复等待 Run 只能经 Core-owned pre-dispatch command 在同一逻辑身份内有界重新发现、深检、原子 rebind 并重跑门禁；每 Run 最多一次，身份改变、二次漂移或无法重建信任必须 fail closed。
- 普通成员界面只展示产品选择和可操作 Readiness；可执行路径、来源、fingerprint、attempt、退避、自动迁移与 rebind 证据只属于高级诊断。本地数据对旧的部分路径偏好采用 clean break，不保留双读或自动补全字段。

<a id="runtime-process-verification"></a>

### 校验、进程与 Session 所有权

- 完整可执行文件 hash 不在消息发送热路径。安装、更新、受管迁移、轻量身份变化或用户显式检查才使用标准 SHA-256；成功后保存路径、hash、size、mtime 和平台文件 ID。执行边界先比较轻量身份，未变则不重读文件；变化时完整 hash 仍匹配冻结 fingerprint 才可更新轻量身份并继续。校验失败是已持久消息之后的诚实执行结果，不撤销消息。
- 每个正式 AgentRun 独占一个 Runtime 进程，内部作业使用临时独占进程；Adapter 明确声明哪些 Runtime 可进入 IdleWarm，one-shot/Burst 终态后关闭。Native Session 连续性不授予并行共享进程的资格。
- `AgentRuntimeFleetManager` 是唯一正式进程所有者，内聚 spawn/reuse/stop/reap、唯一 lease、Resident accounting、TTL/LRU/Sweeper、Core generation 与崩溃清理。Adapter 生成 opaque compatibility digest 并证明 health/quiescence；Manager 不解析模型、权限、MCP 或 Runtime 私有字段。所有事件、释放、取消与迟到回调必须匹配不可复制的 `process_id + agent_run_id + execution_epoch + lease_generation`。
- Reusable Host 的 `ROVAI_RUN_TMP` 使用进程稳定 exact path，但每次 bind 必须在 active lease/context 前 fail-closed 清空、重建并恢复私有权限；unbind/fence best-effort 清理不能替代下一 bind 重置。所有 Adapter 只把 execution workspace、当前 Camp exact attachment root 和该 exact writable Run tmp 交给 Runtime，不暴露 process root/父目录；file ingress 同时绑定 process、lease generation、Run、epoch 与 exact root。
- IdleWarm 复用必须精确匹配 `camp_id + agent_profile_id + runtime_compatibility_digest`；process digest 与 Native Session binding digest 是不同身份。Resident 的 per-member/global 配额只约束跨 Run 保留的 IdleWarm/BusyResident/Stopping，不阻止无兼容 Resident 时创建本 Run 独占且终态即关闭的 Burst。acquire 在一个锁下原子选择兼容空闲进程、Resident 容量或 Burst，必要时按 LRU 淘汰空闲 Resident。
- Runtime compatibility 必须绑定 Camp Published Attachment View contract 4、精确 `attachments` root 与 `live_append_v1` visibility mode；新 Run 不绑定 legacy generation，不取得 legacy read admission，也不因 unresolved publication/writer state触发 dispatch-time rebuild。Legacy View mutation gate/generation 仅收口升级前遗留 publication 与 cleanup。Runtime 不能收到 instance/Camps parent、其他 Camp 或 Authority attachment root。
- Run 结束只有在输入结果已知、输出和 tool work 收敛、Team/Run lease 已解绑且 Adapter 能证明进程 quiescent/healthy 时才可进入 IdleWarm；否则必须关闭。Fleet 启动时必须同时启动单调时间 TTL 与 LRU Sweeper，配置变更、Camp 删除、成员永久移除、不健康和容量回收也会立即使精确 scope 失效/停止；已冻结活跃 Run 只标记 run 后退役，不被容量策略中断。
- IdleWarm 可保留精确冻结的外部 MCP 投影、Runtime 内存、私有配置与其进程/连接直到 TTL、失效或容量回收；这不等于 AgentRun 终态即撤销外部凭据。空闲期没有活跃 Run lease，built-in/Team 调用 fail closed；不能证明安全保留精确字节时必须关闭整个 Runtime。
- Fleet 是单一 Core generation 的内存状态，不写 SQLite、不跨重启接管。正常关闭停止并 reap 全部进程；崩溃清理只能在 owner record、旧 generation、进程组组长与命令身份均可证明时终止，不能仅凭 PID、路径或 UID 猜测性杀进程。
- 正式 AgentRun 默认继承用户通用 `HOME` 与 Runtime 原生 state/config Home；Provider env、External MCP、Run tmp、私有 cwd 或 Skill projection 都不能隐式升级成独立 Runtime Home。只有当前产品合同明确要求隔离、同时定义迁移与清理时才能覆盖 Runtime-specific Home。Discovery/Probe/fixture 可以使用一次性临时 Home，但其 Session、认证和 continuation 证据不得外推到正式 AgentRun，也不得进入产品 Binding。
- Rovai 启动 Codex 时不设置/覆盖 `CODEX_HOME`，不拥有 Codex Home、Home lock、Camp cleanup 或 orphan GC；用户、Project、managed、plugin、hook、memory 和 native MCP 按目标 executable、process environment 与 cwd 的 Codex 原生规则生效。Conversation 只持久 Native Binding/thread ID 和证据，逻辑私有连续性不承诺 Camp/member 级物理 Home 隔离；Camp 删除也不宣称删除外部 Runtime 数据。
- Codex Adapter 在 thread start/resume 前通过 native `config/read(includeLayers=true, cwd=executionRoot)` 发现有效 top-level MCP 名称，只将不同名的 Rovai Server 以 thread-scoped addition 传入。Codex process compatibility 只包含真正 process-scoped 输入，不包含 Conversation Home 或 thread MCP；每次 acquire 都重新发现并 finalise 本 Run 的 additive projection。
- Runtime launch 明确区分 discovery、light verification、用户授权 deep probe 和执行期验证，且每次子进程启动必须通过中央 purpose policy。Probe/check attempt 由 Manager 拥有、按 generation/fingerprint fencing，使用比产品执行更窄的进程与权限边界；Probe 期间 identity 变化使整轮结果 superseded，未验证身份或 stale LKG 不能冒充 Ready。
- ACP Session 建立后的 `available_commands_update`、config/mode/session-info catalog、Idle usage metadata 与已准入 lifecycle extension 可以在无 Active Prompt 时合法到达。Host 将其路由为 Session metadata/内部 lifecycle，不进入 Prompt output，也不因无 Prompt 自动标记协议违规；未知 Idle shape 仍 fail closed。`session/load` response 后的迟到 replay 继续在有界 settling/quiet window 内隔离。

<a id="runtime-recovery-shutdown"></a>

### 恢复、取消与计划关闭

- Runtime accepted input 只有在能证明原 Native Turn 的 identity、接受状态和可重连终态时才能恢复。证据不足进入 `recovery_blocked` 或 continuity-lost，不能重发可能已经产生外部效果的输入。
- 新输入的恢复验证冻结 Manifest attachment receipt 的 closed shape/digest，再独立验证 admitted Runtime Files Root identity、精确 Camp root containment 与当前 Camp-root Auth Receipt；不要求 legacy View ready、append-only successor 或 generation 匹配。路径和历史 payload 不重新解析、探测或改写。Migration 99/100 的旧非终态输入按 delivery/action evidence 诚实终结，历史 Manifest/Blob/Auth Receipt/ACK 保留但不可再 dispatch。
- Cancellation 在业务事务内把目标 Run 结算为 cancelled 并收口义务和所属 Turn；未发送 Input 为 not_accepted，accepted/delivery_unknown 与可能已执行的 Action 证据保留，但不改变取消终态或产生公共待确认提示，原输入禁止自动重发。Runtime 使用原 active/launch token 有界清理，只有确认后写 cancel_acknowledged_at；清理不拥有业务终态。未确认清理的同 Conversation 新 Run 最多等待三秒，然后 failed/runtime_cleanup_unconfirmed，不允许重叠执行。
- 计划关闭保留 protocolVersion 3/report 和既有 writer/route barrier；持久化 cycle 后先统一结算业务，barrier 后补齐再完成 cycle，Runtime 清理只影响清理事实与 deadline。未知外部效果保留，不伪造 Runtime outcome。
- Diagnostics 是严格只读、最小化数据的 Core view；修复必须是用户显式选择的独立动作。导出集中脱敏，不能把 secret、完整路径、模型输入或 Runtime 原始输出作为便利诊断数据。

<a id="runtime-platform-security"></a>

### Runtime 权限与平台准入

- 队员 Runtime 权限默认是 Adapter 明确支持且已验证的产品选择；十二种 Product Runtime 都使用精确合同冻结的原生最高权限 default。Kimi `yolo`、TRAE `bypass_permissions`、Kiro trust-all 及其他 Adapter 的 permission/approval/sandbox 映射和 schema digest 都不能从字符串、descriptor recommendation 或版本猜测。该默认只建立新 draft，Discovery、Probe、migration 与 App upgrade 不得静默扩张已有成员配置。
- `session/request_permission` 是 Runtime 原生协议交互，不是 Client FS capability。全自动/绕过交互的冻结 Adapter
  模式若仍发出合格请求，Core 只为 ACP 兼容直接选择原生 allow；交互模式仍保留 fenced Approval 与 exact native
  option。两种响应都不授予、撤销或消费文件读写资格；stale Session、cancel/detach、非法 request 与协议关联仍
  fail closed。
- TRAE 的 light check、显式 availability verification、cold resume、HistoryRestore 和 replay quarantine 使用独立的用户授权、Session ID 校验和有界恢复路径；恢复响应 ID 不一致时 fail closed。
- Product execution qualification 是 `AdapterKind × HostPlatformKey` 的封闭准入。存在安装或能启动进程不等于平台合格；不合格组合保留配置但阻止执行，并提供结构化 reason/evidence。
- Windows 正式进程必须在创建时原子加入受管 Job 并限制继承 handle；本地 IPC、私有存储、DACL、validated Node shim、长路径和 descendant cleanup 都是平台 admission 的组成部分，不能在进程启动后补偿安全边界。

## Native Session、Context 与 Bootstrap

<a id="context-session-bootstrap"></a>

### Session continuity 与 Bootstrap

- Conversation handoff 只在明确、可验证的 Native Session continuation 边界保持连续性。Camp 公共历史与 portable context 属于 Rovai 逻辑连续性；Runtime native thread/session 是外部 binding。跨 Runtime、身份、Camp、binding generation 或不兼容 contract 的“恢复”必须创建新 Session，不能把摘要、同一路径或版本当作原生连续性证明。
- Native Session Bootstrap 是完整、不可变的交付 bytes/digest，固定按 `SESSION_CHARTER → MEMBER_IDENTITY → MEMORY_ENTRYPOINT` 三段组合。`MEMBER_IDENTITY` 始终包含一个 six-field self aggregate 的最新值；Dynamic Context 中的 `COLLABORATION_STATE` 只包含当前 Camp peer routing/Lead，不泄露 peer persona、Presence、Runtime、Memory 或 busy 状态。新 Session/替换 Session 使用当时最新身份，既有 Session 不因编辑被热改写。
- Session Charter 只拥有稳定产品合同、工具/Skill 进入方法与协作纪律，合同不兼容时通过版本和 Session rotation 切换，不把 operation schema 复制入永久 prompt。动态 AgentRun Context 只携带本次 `CURRENT_INPUT`、受限公共历史、Task/Run facts、附件和显式选择，不重复永久 Session 规则或把私有 Conversation 当公开上下文。
- Bootstrap 各组件、完整序列化 bytes 和实际投递是不同 evidence 层；不用“已生成完整 Bootstrap”替代 Runtime accepted evidence。ContextManifest 记录冻结 digest/versions，Runtime Input Delivery Evidence 记录实际 bytes 与 accepted ACK；只有当前有效 Run/epoch 和 Native Binding 的 accepted ACK 推进 Conversation 水位；明确未接受才可重新准备，accepted/unknown 不自动重发。迟到回执只补充证据，不修改 successor 水位。
- Bootstrap redelivery 是 durable requirement，但 detector signal 本身不证明 compaction、不授权发送。Core 通过每 Native Session 唯一的 observer lease/generation、Runtime-owned policy epoch、prepared-input cutoff 和幂等 Session-scoped command 决定下一个尚未准备的输入是否需要 redelivery；旧 binding、旧 generation、迟到信号或已经 prepare 的输入都 fail closed。
- 所有 Runtime 输入在一个 Core-owned 串行 preparation boundary 中冻结。Redelivery 是完整 Bootstrap 在本次输入上的 transient overlay，不改写 Session Charter、正常 Dynamic Context 或历史消息；Bootstrap+Current Input 共享有界 payload 门禁，无法完整交付时本次输入整体失败，不部分发送。
- Runtime 特定 compaction detector 只能在真实 probe 证明 best-effort、非阻塞、不消费/伪造用户输入、不破坏 Session 且有可控停止边界时准入。Detector state 不是 Runtime Readiness，中断/恢复不可追溯推断 compaction。admission 优先使用具有 occurrence identity 的结构化 lifecycle event；上游若把原生 lifecycle 确定性降格为与 assistant chunk 同形的文本，只允许 Runtime 私有 compatibility route 在源码与真实 wire shape 均固定后完整匹配官方 frame，并用 Prompt-scoped 状态相关 started 与 completed。单个 active-Prompt completion、token/usage 下降、历史变短、模型 summary、宽泛关键词或普通 assistant 文本不能补猜；lifecycle frame 必须从公开 streamed text、final 和 Missing-Send 消费。没有 source tag、occurrence ID 或 provenance 时只能声明 `best_effort`，并明确记录模型逐字复现完整 frame 序列仍无法在 wire 层排除。已按目标场景查找但未见可靠信号时状态为 `NotObserved` / `Unverified` 且 policy `Disabled`；只有结构化负证据证明上游不提供时才声明 `Unsupported`。

<a id="context-public-history"></a>

### 有界公共上下文与引用闭包

- 模型上下文只投影确定性、有界、已发布且当前授权的 raw public CampMessage，不使用会随运行重写的摘要、Coverage Baseline 或私有 Conversation 替代公开事实。`CURRENT_INPUT` 始终完整；嵌套 Member Call 另外投影不可由模型修改的 originating public user message lineage。
- 公共历史按稳定 sequence 选择最近候选，每条 body 与总预算都用 Unicode scalar 计算并在受控边界截断。选择、顺序、per-message/total limit、body digest、截断和 omission count/reason 由版本化 Context Delivery Profile/Formatter/Manifest 分别拥有，必须从冻结输入可复现。
- Recent public candidate 在数量限制前排除当前 Agent 自己发布的消息；用户、其他 Agent 和 system 消息继续按 sequence 竞争名额。自身消息不占 recent limit、也不计入 whole-history omission，但仍可作为理解 eligible message 所需的授权 reference ancestor。该规则只约束模型 recent projection，不删除 CampMessage、不改变 Timeline/History/Search/Renderer，也不影响独立的完整 `CURRENT_INPUT`。
- 定稿的 `COLLABORATION_STATE`、current input、public history 和 optional reference closure 有稳定段顺序。公共 history watermark 只由 Runtime accepted input 推进；省略提示只是证据，不是 Agent 自动读取授权。新 Manifest 不保存 Summary ID/覆盖区间或高级摘要设置，这些已从当前投递模型 clean break 移除。
- 引用链闭包使用独立的有界 Profile：只补齐理解当前公开消息所需的 exact public ancestors，有固定深度/数量/字符优先级，并保留来源、裁剪和遗漏证据。每个祖先在投影时重做 live authorization；闭包不绕过 History scope、不把私有 Conversation 公开，也不把引用的附件自动展开为模型输入。
- Whole-history omission 必须区分“候选真实为空”“候选存在但预算全部排除”“只投影部分”。当 exact ID 列表本身超过 evidence budget 时，Manifest 保留 total omitted count、可证明的 bounded digest/range 而不声称列出全部 ID。空 section 和整段省略有不同、显式、可测试证据。
- Agent 与 Human Principal 的 body/snippet/search offset 使用分开、版本化投影。Agent-facing 视图不默认获得 Human 原文或未脱敏字段；History、Search、Context 和 Gather 必须选择与受众一致的投影并保留结构化 Principal 线索。
- 外部渠道 reply 作为当前唯一触发 CampMessage 的受校验 Structured Content 引用段进入标准 body/Context 投影；被引消息不因此单独公开，transport message ID 不成为 Camp reply identity。Channel Host 不能用 prompt override 绕过 CampMessage、ContextManifest 或 Runtime Input Delivery Evidence。

<a id="context-manifest-run-facts"></a>

### ContextManifest 与结构化 Run Facts

- ContextManifest、模型输入 bytes、Runtime Input Delivery Evidence 和 Native Session/Run 状态是四个独立权威。Manifest 冻结模型实际可见选择、formatter/profile/section 版本、来源 digest、遗漏、水位和 exact compact payload digest；交付 evidence 记录 Runtime 实际接受。日志摘要、Run 状态或 Manifest 本身不能互相代替。
- Manifest 的附件 receipt 对成功解析的 legacy v1 引用冻结 Camp ID、稳定相对 View path 与 attachment semantic identity；无成功 legacy 引用时使用 `catalogRevision = -1` 的 no-legacy sentinel，不读取当前 View。Managed v2 identity/path 由 attachment refs冻结，不进入 legacy catalog。inode/device/file ID、root/Entry identity、publication operation、physical generation 与 physical catalog 不进入模型或新的 dispatch 前置条件。
- 模型投影可以 compact，但不得丢失、重命名或自由文本化 authoritative fact。稳定产品规则留在 Session Charter，per-Run 事实只出现一次；每个 schema/formatter/profile/manifest/section 版本跟随实际 owner 独立推进，不用一个全局数字伪造同步升级。
- Shared Conversation 始终属于一个 Camp，动态 continuation 使用有界公共消息而不复制私有历史。每个新 Run 的 closed、typed `RUN_FACTS` 必须包含当前 Camp exact Published Attachment root、enumerate/read、scope 与 read-only 事实；Task reference、Session continuity、accepted-input/outcome uncertainty、Gather generation 和 delegation budget 继续作为可选事实。字段缺失与值 unknown 必须可区分。
- Self-active Task snapshot 只选当前成员在当前 Camp 显式负责的非终态 Task，按 Profile 的稳定 order/limit/budget priority 冻结。真实空集合产生显式 empty snapshot；候选存在但被上限/预算全部排除时整段省略并记 aggregate omitted count，不泄露被排除 ID。Renderer/Skill 不得临时改排序。
- Gather Completion Delivery 始终获得 mandatory typed Current Input，包含完整原请求、barrier/generation、固定 Item 结果/失败、截断/遗漏证据和完成责任；即使旧公开消息已超出上下文预算也必须 self-contained。
- Structured Skill selection 以 per-Run frozen revision snapshot、verified exposure 和只读 resolver 形成可选 `CURRENT_INPUT.skills` 文件链接。链接使用结构化 Skill identity/revision/digest 而不从 Markdown 推断；路径必须位于本 Run 可读 projection root 且内容再次验证，解析失败显式报告而非静默降级或换用最新 Revision。

## Memory

<a id="memory-lifecycle"></a>

### 所有权、Scope 与生命周期

- Memory 是应用全局、Core-owned 的长期领域，不归某个 Camp、Conversation、Runtime 或 Agent 私有文件。Camp 和 Session 只获得当前授权的投影。
- Scope 在 Revision 创建后不可变；Companion、Relationship、Hearth 等封闭 Scope 使用稳定结构化身份。改变 Scope 必须创建新 Revision/Memory，不允许原地改写归属。
- 同一逻辑 Memory 的 supersession 是显式、原子、可追溯的 revision chain。当前有效集合只有一个可实施 head；并发写使用 expected revision/CAS，不能靠时间戳覆盖。
- Forget 是 Memory-domain 闭包操作：撤出当前和未来投影、清理/终结相关 review 或候选，并保留最小审计墓碑；它不通过删除 Camp、成员或 Runtime 隐式触发。
- Reactivation 只能对允许的 retired 状态显式发生，受 bounded history、scope validity 和用户/Actor authority 限制；forgotten 或被永久安全边界禁止的内容不能复活。

<a id="memory-write-store"></a>

### 写入、Review 与存储

- 在线捕获是 best-effort，排队/过载/失败不能阻塞、改写或伪造主 Run 结果。Agent 只能在当前 Actor 自己的 durable responsibility、Scope、Capability、完整 view 和 copyable revision target 约束内 add/revise；不能代替他人关系方向、用户 Hearth 判定或已失效对方写入。Core 在提交时重做 secret、quota、scope、presence、staleness 和 CAS 校验。
- Agent 使用单一 `memory.write`，输出明确区分 effective、review_pending、rejected/conflict 等结果。Hearth Review 与在线写隔离，review 接受通过正式 publication 创建/替代 Revision，拒绝和过期保持持久理由。
- Memory 与 Hearth Review 是两个独立权威聚合。Pending candidate body 位于隔离、Agent 不可读的受管内容；terminal review row 不保留 candidate body。接受同时需要 review expected version 和目标 Memory/revision expected version 两个独立 CAS，然后经唯一 publication 边界创建 effective Revision；拒绝/过期/冲突不留可被再发布的无目标正文。
- Normalized SQLite store 是权威真源；投影文件、Skill 工作区和 Runtime cache 都是可重建派生物。Revision body、scope、retrieval key、provenance、supersession、review、forget 和 audit 使用规范化关系，不能以自由 JSON 复制第二套真源。旧正式 Memory 迁移必须保留 body/provenance/effective history，不能为新 schema 把它们降成无正文候选或丢失审计。
- Forget 和 publication 都使用目标可证明的原子命令。Forget 封闭当前 effective head、候选、review 和未来投影；不得把隔离 candidate body 重新创建为无 provenance Memory，也不得通过 retry 绕过已结算 review。
- `memory.view` 对一个精确 Scope 返回完整当前适用集合，不能分页或部分成功。Search/Read 返回可复制的精确 revision target，使后续 revise 能绑定用户/Agent 实际看到的版本。

<a id="memory-read-projection"></a>

### 检索、导出与投影

- Memory 只能经 Core broker 的授权入口检索并在 Session/Run 边界投影；Runtime 不直接扫描数据库、用户文件或历史 cache。每次 Search/Read/View 先计算当前 applicable set，对 Actor、Presence/removed member、Relationship direction、Scope、lifecycle、secret 和 active quota fail closed；知道 ID 或过去被授权不扩大当前可见性。
- Retrieval key 绑定精确 Revision 且随不可变 body 可审计。Search 只返回有界 candidate/preview 和稳定 key，Read 重做当前授权后返回 exact body、revision target 与明确 cache state；失效、过期、不可见、forgotten 和 cache miss 使用可区分的结构化结果，不泄露记录是否曾存在。
- Session Memory Entrypoint 只投影当前适用、有界、可追溯的 effective Revisions 与省略 evidence，不用摘要/文件扫描替代 broker；投影失败不能把秘密、旧 revision 或不适用内容作为降级回退。读取与投影的选择/digest/omission 进入 evidence，但 Evidence 不授权未来读取。
- 用户导出是显式、最小化且以当前可见 Revision 为边界的操作；不存在后台云同步、隐式共享或 Agent 自主批量导出保证。
- Relationship/Companion projection 只面向仍合格的当前 counterparty；away 暂停新投影，removed 永久失去未来适用资格。Hearth 的应用级作用不因单一成员生命周期而改变。

## Skills、MCP 与 Built-in Operations

<a id="skills-builtin-transport"></a>

### Built-in 权威与运输

- Core 拥有封闭 canonical built-in operation catalog、授权、幂等、lease、receipt/replay、审计和完整 `BuiltinToolInvocationEnvelope`。一个 App 生命周期只有一个 Built-in Tool Router/Gateway 权威；CLI、Adapter 和外部 MCP 都不复制 Schema、Handler 或业务授权。
- Router 在每次 Agent 业务 operation invocation 时重验 current Run/lease/Native Binding 与 Run 冻结的 exact active Camp membership version；旧 ID、旧 receipt、已知 target 或离开后再次添加都不恢复授权。terminal evidence 使用独立窄入口，不属于业务 operation capability。
- Core IPC 先返回并校验完整 Envelope，然后按 operation 投影一份 closed Agent result JSON。普通 Agent 输出不包含 envelope wrapper、request identity 或 receipt，也不通过递归删字段得到；每个 operation 有明确 `agentOutputSchema` 与 golden fixture。完整 Envelope 只用于 Core、Evidence、Qualification 和 host-controlled debug 边界。
- `rovai` CLI 是 Runtime 调用 Rovai-owned built-ins 的唯一运输。内置 MCP/`rovai_team` Bridge、注入、alias map、Runtime 临时配置和 native permission bundle 已 clean break 删除；不存在 fallback 或同 Run 双运输。用户外部 MCP 继续走独立 Library/Runtime-native projection，不经 Built-in Router。
- CLI 使用领域分组命令，但 receipt、审计、Activity 与 Envelope 保留 canonical dotted operation identity。Native Session Bootstrap 只教稳定 CLI 入口和通用失败纪律；Agent 侧没有 `tool list`、`tool describe`、generic invoke 或全量 schema discovery。精确输入源和本命令约束由简短 `--help` 给出，复杂选择/恢复由 `cli-operations` Skill 说明。
- 每个业务命令一次只选 direct arguments、stdin/heredoc 或 `--input-file` 一个输入源，不合并也不建立覆盖优先级。`camp.read` 只在所选来源成为 JSON 对象之后、canonical Schema 校验之前补全安全 Timeline 默认；默认 Timeline 发送给 Core 的 canonical JSON 始终包含 mode/direction/limit，其他显式 mode 继续发送各自完整 branch。其他命令不引入业务默认；输入文件路径、Shell quoting 与临时文件不是 Core 信任边界或保密保证。
- 目标 Runtime 必须在接收 Run 输入前证明 CLI、当前 IPC、Run binding 和当前 contract 可用；否则以结构化理由 fail closed，不启动降级 Agent。发布资格按 Runtime 及宿主平台独立验收，不因一个平台未准入而否定其他已验收组合。
- Business rejection 投影稳定 code、safe message、closed recovery 和合同允许的 details；不泄露 stack、SQL、内部路径、IPC 地址、secret 或未筛底层错误。乐观冲突要求重读后重新判断；只有 Core 明确允许时才以同一 request identity 有界重试。幂等重试返回原 receipt/结果而不重复效果；无法证明时返回 outcome indeterminate 并要求核对当前状态。
- CLI 子进程通过当前 Run 的受保护本地 IPC endpoint 与新 lease 继承调用身份，不从可复用 Runtime 进程身份继承权力。Runtime 及它启动的子进程共享当前 Run/Member 归属和同一 scope/version/quota/fence，不根据父进程名、命令文本或层级猜测模型意图。Run release 先 fence lease，迟到子进程调用不得归属于后续 Run。
- Unix Socket 和受保护 Windows Named Pipe 共享 Local IPC v2 语义：每 App 一个 endpoint，基于 OS identity 加 process/lease token 的双重校验，当前用户专用权限，有界 frame/超时/重试，断连结果不明时不盲重发。v17 完整继承 v16 transport/security，只扩展当前 `camp.read` CLI 与 catalog 合同。
- 一次已由 Core 验证的 CLI invocation 在主 Activity 中以 canonical operation 呈现。Runtime Shell Evidence 只在具有显式 Core request/receipt 与结构化 command identity 关联时折叠为 supporting transport；无法证明时保留两项独立 Evidence，不用文本、时间或目录猜测。

<a id="user-automation-trial"></a>

### User Automation 与 Diagnostic Trial

- 一个安装包可以只交付一个 `rovai` binary，但 `rovai app` 普通用户自动化与已有 Agent CLI 必须使用不同 endpoint、credential、principal、授权和命令目录；共享可执行文件不构成共享能力。User Automation 不接受 process-private Run context，Agent CLI 不接受应用级用户 credential。macOS Core-managed Runtime/Probe 及其后代必须由统一 Managed Process 边界 OS-deny 完整 `automation-v1` tree；同 UID file mode 和环境变量不构成该隔离，CLI 隐藏/拒绝 `app` 只能作为纵深防御。
- Electron Main 是 User Automation endpoint、connection context、credential、封闭 operation dispatcher 与 Renderer navigation 的唯一 owner；Core 只提供既有领域 mutation 和显式安全 Read Model。不存在 generic invoke、独立 automation daemon 或隐式 Desktop launch。App 未运行稳定失败，不能把状态检查变成隐藏进程副作用。
- User Automation mutation 必须复用正式 Core Domain Command seam：成员创建与 Runtime 配置只映射到 `members.create/runtime.set/runtime.clear`，消息执行复用 Message/Turn/Run、预算和版本 fence；不能直接写 SQLite、调用 Runtime 或把用户 Composer 当 staging area。一次公共 mutation 对应一个幂等 Core Domain Command transaction；重放返回原结果且不重复效果，用户草稿在成功、拒绝和错误后都保持原样。调用方无法解释的新状态（包括 V1 非空 `pendingExecution`）必须要求合同升级；断连不能证明 mutation 未发生，无法证明时不盲目重发。
- User Automation Server 是 Desktop 可选控制面；监听、context publish 或初始化失败只能让该控制面降级并清理半初始化资源，不能终止 Desktop/Core。CLI shell exit 必须区分成功 `0`、业务拒绝/terminal failure `1`、输入/transport/contract error `2` 与 outcome/settlement indeterminate `3`，不能因已打印 JSON 把失败返回为 `0`。
- Diagnostic Trial 是 CLI-owned durable workflow，不是 Core Trial/Benchmark/Qualification entity。它在首次 Core mutation 前持久化 journal，每次只接受一个 root AgentRun，冻结单责任、零 A2A 与 elapsed budget，并以 global domain sequence、Run-local evidence sequence 双 cursor 观察；AgentRun terminal 只由领域状态决定。
- AgentRun 诊断采用字段 allowlist，不从 raw payload 黑名单删减。raw effective config、Runtime payload/final output、secret、environment、context/bootstrap bytes 与 Authority path 永不进入普通终端或 bundle；公共输出只取正式 CampMessage。Trial/export 必须明示非正式资格，不能自动晋升为 Benchmark 结果。

<a id="skills-external-mcp"></a>

### 外部 MCP 配置与投影

- `~/.rovai/mcp.json` 是用户管理外部 MCP Server、immutable server identity、enablement 和 Assignment 的唯一配置真源；SQLite 不复制 Server/Assignment 真源，秘密只通过安全引用和受限投影流动。
- 文件是一个封闭、版本化 canonical JSON envelope；Core 在完整校验、规范化和精确 compare-and-swap 后原子替换。管理用 identity/revision/provenance 元数据不投影给 Runtime，Server identity 不因显示名、参数或 secret 变化而改变，删除后不复用。诊断、日志和投影必须去除或引用敏感值，不因旧 Runtime 不支持而降级为明文。
- 新配置从空 `mcpServers`、空管理元数据和无 Assignment 开始；产品不内置、恢复、广告或自动创建第三方 preset/受审定义。所有外部 Server 都来自用户显式创建/导入。
- 每个 AgentRun 冻结当时已启用且分配给该成员的 server identity/revision 与经脱敏的 projection input；后续文件编辑不改写已冻结 Run。Runtime 投影只能写入 Core-owned 私有边界，不覆盖用户 Global/Project/Workspace 配置，Run 结束按进程复用与所有权规则清理。
- 外部 MCP Runtime 能力只有 `additive | unsupported`。Core 生成 projection request，Adapter 根据已验证的原生优先级和同名行为 finalise 实际配置；同名只能结构化拒绝、或在与较高优先级有效定义字节完全相同时结构化复用，不猜测 merge 或 override。不存在 Runtime-wide 降级、replacement fallback 或 transport fallback；一个 Server 失败不改变 built-in transport 或整台 Runtime 身份。
- Built-in transport、外部 additive projection 和 ambient isolation 是独立能力轴，必须由真实 probe/evidence 准入，不能按 Runtime 名称或泛化的“支持 MCP”猜测。用户可见配置错误与经脱敏的 Runtime 实际投影诊断分离。

<a id="skills-library-projection"></a>

### Skill Library、投影与完整性

- Rovai Skill Library 只包含 official 或用户显式导入的 Skill；名称全局唯一，Revision 内容不可变且按内容 digest 验证。新导入 Skill 默认 enabled；official Skill 首次安装采用 bundled registry 的 `enabled_by_default`。新安装 Skill 显式分配给全部当前 Skill Delivery Groups；后续 user-managed enablement 与 assignment 由用户管理，bootstrap、升级与修复不重置已保存的选择，不存在隐式“未分配即全部”语义。
- Skill 文件投递、Runtime 发现/加载与协议 advertised command/Skill 是三层独立能力，分别记录 `Verified | DocumentationOnly | Unverified | NotObserved | Unsupported`。当前 parser 未识别只表示 Host 分类缺口，不能反推 Runtime 没有提供。TRAE managed projection 只拥有已通过唯一内容 advertisement 与真实调用验证的项目 `.trae/skills`；Runtime 同时扫描的其他项目/用户路径不进入 Rovai ownership 或 cleanup。
- 投影只物化当前 Run 冻结且目标 Runtime 可投递的 Revision，不扫描未管理目录来扩大 Library。重叠 native discovery 必须有明确所有权/冲突策略，不覆盖 Project 或外部修改项。已启动 Run 使用冻结 exposure；新 Run 不得在 desired state 未收敛或内容无法证明时继续。
- Library desired state、root access ledger 和 per-Run frozen exposure 是三个独立权威。事件只标记精确 root dirty，Reconciler 在 root scope 内去重、串行收敛并以 generation/digest 阻止迟到结果；失败不回滚 Library 真源，但相关新 Run fail closed。Run 启动前必须重新验证 Revision 路径、类型、大小、权限和 digest，不依赖历史目录扫描或 active-Run 引用作为新 Run 准入。
- Bundled Skill bootstrap 在数据库 digest 与 expected digest 相同时走只读快速验证；只有变化或不一致才在私有 staging 中物化并原子 promote，经失败注入也不能让半成品满足执行门禁。Windows copy projection 使用 operation journal、backup/promote/verify/metadata/cleanup 多阶段恢复；Execution Root Gate 将 launch registration 与 replacement 串行化，崩溃后先按 journal 收敛再准入。
- Official inventory 是封闭、同名不可被 import 覆盖的产品集合；official provenance、pinned third-party 内容和 system-required management policy 作为产品配置审核。成员创建只由 Agent 发起受控 `member.create` workflow，在一条完整提案中给出身份、Runtime/model/permission/外观，并只在当前用户确认后调用；用户仍拥有最终授权和配置。
- Grill/Review 等协作 Skill 是普通 user-managed Skill，不因 official 身份获得额外领域权限。Grill Duo 保持一位固定搭档、稳定问题编号、开放轮次、迟到/错关联不推进和最终用户确认；Review Duo 保持独立 Spec/Standards 轴、四消息 session 协议、不可变 review range 和合格替补语义。Skill 只编排协作，不成为文档、代码或判定真源。

## Execution Evidence、Runtime Activity 与 Usage

<a id="evidence-canonical-activity"></a>

### Evidence 与 Canonical Activity

- Runtime source event、append-only Execution Evidence、Canonical Runtime Activity 和 Renderer presentation 是四个显式层。Runtime/Core 只声明它们真实观测或介入的事实；Evidence 保留来源、序列、原始观测边界和脱敏结果；Core classifier 拥有 canonical 语义；Renderer 只本地化/分组/呈现。任一层都不能用未报告行为、进程消失、命令文本或 UI 提示补写“已执行”。
- Canonical Runtime Activity 是 Core 从不可变 Evidence 构建、持久但可重建的版本化投影，不是新的效果真源。Lifecycle/Read Side 只从选定的 canonical projection 派生，不跳过它直接从 Runtime 标题或 evidence payload 猜状态。
- `source_event_key` 与 Core-scoped `operationId` 是严格分离的身份：前者只在一个已声明 observation scope 内去重单个来源事件，后者才能跨 phase/evidence 合并同一操作。Core 只接受协议原生 ID、自有调用/receipt 关联或 Adapter 按封闭规则构造的可证明身份；不用时间、文本、路径或顺序相似性聚合。重放使用同一规则得到同一 identity/归约结果。
- Activity Domain（历史字段名 `capabilityKind`）是稳定顶层观测域；可选 `semanticKind` 只能在 Evidence 支持时细分，`presentationHint` 永不成为 canonical semantics。Domain/kind 词汇扩展必须在 Mapping Registry 注册、版本化并提供 replay fixture；无证据时保留已有域或 `unknown`。
- `activity-v2` 的 Core 只保留 Runtime 明确 title，不生成本地化默认标题、Codex commandActions 标题或文件
  basename 标题；中文 fallback 与可靠 typed path 的 `修改 <basename>` 由 Renderer 拥有。Rovai 类型图标只由
  Core Catalog 验证后的 `sourceAuthority=core + credibility=core_verified + toolName` 证明，不能从标题或 Shell
  command 中的 `rovai` 字样识别。
- `phase` 只表示 started/progress/terminal 位置，`outcome` 独立表示证据支持的结果。乱序、冲突、waiting、Run 终态和 recovery 使用同一 reducer，不能从进程退出或 UI 消失猜 success/cancelled。Runtime 明确报告连续性中断时，未结算 operation 使用 `phase=terminal / outcome=unsettled / reasonCode=runtime_interrupted`；只有 Runtime 的权威取消终态才能写成 `cancelled`，仍可恢复的 Host 失联继续属于 recovery 而不是 interruption terminal。
- 每个 operation 的 classifier/version 首次建立后固定。分类升级必须显式选择“只切换新 operation”或“建立平行
  reprojection”；无论哪种都不得静默改写历史或让 live operation 中途换语义。当前 `activity-v2` 采用前者：
  Migration 116 只切换 current marker，既有 v1 operation 继续用 v1 结算，新 operation 才建立 v2。
- Read Side 可以按已声明的兼容窗口同时读取多个 classifier version，但必须有确定性优先级且不把双读冒充历史
  replay。当前 v2/v1 双读仅让原有 row 与新 row 都可见；没有批量回填、平行 projection、mapping digest 或任意
  Evidence replay 基础设施，因而不得声称这些能力已经存在。
- Runtime-reported Command Diff 只能由 Adapter/version 明确声明为完整 snapshot、exact mutation 或完整
  before/after 的结构化字段进入 append-only Evidence，并归约为既有 Canonical Activity 的 typed
  `diffProjection`。projection 保留 revision、全部 source Evidence IDs 和 available/unavailable/conflict；它不拥有
  独立 phase/outcome/identity。路径规范化不授予文件读取权，局部或语义不明字段不补猜，旧 Evidence 不推测回填。
- AgentRun File Changes 以 `agentRunId + executionEpoch` 为独立 read projection，在 Run terminal ingress 后从同一
  append-only Evidence 归约；它不依赖 Canonical Activity 的 Command Diff merge，也不创建第二套 Activity。
  最新 Runtime Run snapshot 优先，完整 before/after 连续链可收敛为净差异，roundtrip 消失，exact mutation 保留
  时序，链断裂或 operation-only 只保留操作历史。只有所有文件都是完整净差异时才能显示全局增删计数。
- 文件变化观察不执行 Git、filesystem scan 或当前文件读取，不解析 shell 命令，也不跨 Run 合并。失败或取消 Run
  可以展示此前已成功报告的文件变化；failed/cancelled Operation 自身不得进入。没有可靠 Evidence 时不生成卡片。
- managed `ROVAI_RUN_TMP` exclusion 只作用于新进入 Core 的 Evidence。历史 Evidence、Canonical Activity 与
  AgentRun projection 不重写、不回填；通过临时区发布出的 Managed Attachment 继续由 Attachment 合同独立拥有。
- 所有已接入 Runtime 共享同一 Activity contract/schema；Coverage level 只描述 Adapter 能实际观测的 `fine_grained | run_level | unknown`，不降级全局合同，也不表示未观测操作未发生。初始分层和每次升级都必须有真实 Runtime evidence、Registry 变更、fixture 与恢复一致性验证。
- 搜索 query 只有通过 Core-owned `runtimeSearchOperation` typed projection 才能进入 Evidence；通用
  `payload.query/item.query` 不在公开白名单。明确准入 Codex `webSearch`、Claude `WebSearch` 与 ACP
  `web_search`；对 ACP `search/fetch` 的推断必须同时绑定 Adapter identity、实测 Runtime 版本、协议 phase 与
  query-only 输入 shape，当前只允许 Copilot `1.0.79`、Qoder `1.1.28`、Kiro `2.18.1` 与 CodeBuddy
  `2.133.1` 的已记录 tuple。准入值只能是单个非空字符串或元素全为非空字符串的非空数组；多项 projection 以
  `query` 保存第一项，并以 `queries` 保存完整有序数组。每项原样保存，不做敏感词过滤或去重；相邻未准入字段仍
  保持私有。Renderer 还必须验证 projection available 与 Canonical `tool.web.search` 同时成立；详情第一行以
  `搜索 ` 紧接单项 query 或中文逗号连接的多项 query，存在公开结果时从下一行连续显示，不插入“搜索词 / 结果”
  标签或空白分隔行。该 Activity 仍计入连续 Tool 组操作数。历史 Evidence 不回填，缺失 typed projection 不生成占位。
- Shell command 只有在协议的封闭公共字段中出现时才能进入 Evidence：Claude 仅 Bash command，通用 ACP 仅
  `rawInput.command` 字符串，TRAE CLI CN 额外仅允许 `rawInput.Command` 字符串，Antigravity 仅明确 Shell
  工具的 `tool_info.parameters.CommandLine` 字符串。TRAE 的大小写例外必须绑定 `trae-cn-cli` Adapter identity，
  其他 ACP Adapter 收到同形大写字段时 fail closed。
  相邻 raw object 字段不公开；command 观察必须绑定同一原生 operation identity，terminal 优先采用自身当前的
  公共 command，仅在缺失时回退 started phase 缓存，不能要求 Renderer 从 digest、title、output 或私有
  terminal 还原。
- Codex `command.output.delta` 只是 stdout/stderr 运输片段。未来无 `id` 的
  `item/commandExecution/outputDelta` 在 Codex Host stdout ingress 的当前 Native Thread/Turn route 读锁内分类；
  精确当前 route 与非空 `itemId` 记为 current delta，旧 Turn、已 deactivate/unbind、字段缺失及 legacy
  `command/exec/outputDelta` 记为 rejected delta，两类都在构造或发送 `CodexIncoming` 前直接丢弃。带 `id` 的
  同名 JSON-RPC request 不参与 early-drop，继续走既有 request response 路径；Core 的漏网防御在 shutdown route
  permit、batching、Runtime lookup 和数据库读取前无条件丢弃 delta notification。因为没有任何 delta 接受态或可变
  sink，该路径不再执行 Run/epoch/lease 数据库 admission；terminal 尚未被 Core 消费的竞态中即使分类为 current，
  结果仍是丢弃。它不写 Execution Evidence、不推进 Canonical Activity、不创建 Managed Blob，也不进入 Renderer
  live event state。
  `item/completed` 的 `aggregatedOutput` 是 Command 最终输出的唯一权威，大输出继续按既有阈值进入 Managed Blob。
  已存在的历史 delta Evidence/Blob 保持原样且仍可读取，本规则不迁移、删除、重写或重建历史。
- Adapter 必须优先从原生 terminal semantic event 提供完整公开输出。若未来某个 Adapter 无法提供完整 terminal
  aggregate，只能在 Adapter 内使用有硬上限、Run 结束即删除的临时 spool，并在 terminal 生成完整或明确
  truncated 的单一结果；Core 与 Renderer 都不得无限拼接字符串，也不得退回逐片段持久化。

<a id="evidence-usage"></a>

### 用户可见 evidence 与 Usage

- AgentRun Execution Evidence 是独立、用户可见但默认不回流 Agent 的 append-only 权威记录，不归 Task、Message、Activity presentation 或 Runtime cache 所有。小元数据与内容 digest 在 SQLite，大正文进入 Managed Blob；Read Side 每次按当前 Camp/Run 授权、稳定 sequence 和有界分页读取，保留缺失/截断/完整性状态。
- Renderer 对文本、结构化数据、二进制/未知类型和链接使用安全、有界渲染；不执行 evidence 内容、不把它当作 Agent 消息、Task 完成证明或可重放命令。保留/回收由权威 Run/Camp 引用和 Managed Blob GC 决定，不因 UI 清理或 Agent 不可见而提前删除。
- Runtime Monitoring 只拥有 Usage-derived metering：原始 observation、归一化 usage、flush/rollup 和 bounded snapshot 由当前五表合同约束。缺失 token/cache/cost 保持稀疏 unknown，不补零或跨 grain 重复计费。
- Usage raw observation、normalized grain、flush cursor/lease、rollup 和 bounded snapshot 保持独立身份/幂等键；读取按成员/Run/时间范围限界，retention/rollup 不改写已归一化 grain 或从缺失值补数。Cost 只在精确模型、价格版本、token category/grain 可证明且不重复计费时估算；Coverage、unknown 与数据新鲜度随 Snapshot 返回，UI 不把部分支持展示成完整精确账单。

## Qualification 与 Benchmark

<a id="qualification-evidence"></a>

### 正式资格证据

- Team Delivery Qualification 是对精确 Team Configuration、sealed Case、fresh product state 和真实 Runtime 的外部可复核交付声明。Task dispatch 之后的工具、权限、Runtime、协调、预算、恢复或终止失败都属于被评估系统结果，不能通过人工重跑抹去。
- Formal Trial 在派发前冻结 Case、Environment Manifest、Intervention Isolation Profile、预算、超时和 verifier。人工介入边界必须精确记录；外部效果覆盖不足或隔离证据缺失使结论不可声明，而不是自动 pass/fail。
- Trial 只能在 pre-dispatch 且还没有产生被评估效果时作为 Invalid 并在同一 planned slot 内受控 replacement；dispatch 之后的 Runtime、tool、permission、timeout、恢复或 cleanup 问题是不可替换的产品结果。新一轮重试必须新建 planned set/trial identity，不在旧 Suite 中洗掉失败。
- Formal isolation 对 workspace writer、ambient tool、网络/子进程、本地凭据和外部效果表面使用 closed allowlist 与 before/after evidence。存在未受控写入路径或无法覆盖的外部效果时，不能声称 formal qualification，也不用事后“没看见变化”代替隔离证据。
- 每次 Trial 只有一个不可补偿的 Hard Outcome。Semantic/Process/Tool-use review 是附加判断，不能推翻确定性 verifier；重复按预先承诺的样本报告稳定性，不选择性保留最佳结果。
- Qualification authority 分为 deterministic Hard Outcome、Human Intervention/Isolation validity、advisory Semantic Review 和报告投影；彼此不得代写或补偿。Evidence 使用规范化 append-only ledger 和内容寻址引用，记录 authority class、coverage、sequence/digest、derivation 和 source locator；派生结论必须能追溯且不反向改写原始 ledger。
- 模型 Semantic Judge 使用 treatment-blind、allowlisted、伪名化、evidence-bound pack，不读取产品 Hard Outcome、arm 标签或未授权私有内容。两个 replica 独立返回合同化判定，只在两者完成后逐字段 reconcile disagreement/unknown；评语不改变 Hard Outcome 或为未观测过程补证据。

<a id="qualification-benchmark"></a>

### Benchmark、Judge 与协作价值

- Benchmark Protocol 和 Adapter Registry 都版本化；未知 major fail closed。历史 Suite/Portfolio artifact 不原地迁移或重算，只能生成带精确 source digest 的 derived projection。
- 每个 benchmark 轴只在 protocol、case、arm、runtime/adapter、budget、verifier 和 evidence coverage 可比时解释；一个轴不合格不得用其他轴或一个综合分补偿。Collaboration-value case 只使用封闭的结果 oracle 判断产出，不把消息数、语气或“看起来有协作”直接当价值。
- Outcome Judge 与 Process Judge 使用互盲、不可相互补偿的视图。双 replica 独立产出后逐项 reconciliation；模型意见不改变 Hard Outcome，也不把未观测过程编造成证据。
- Tool-use measurement 在 dispatch 前定义 opportunity，而不是按观测调用次数倒推。`forced_use | natural_use | non_use_control`、operation family、oracle、coverage 和独立 Tool-use Judge 一并冻结。
- 协作价值声明必须来自预注册的 Team/Solo paired experiment，共享 sealed Case/fixture/verifier 但使用独立 fresh arms。效率只在结果条件可比时解释，不能用失败更快证明协作更高效。
- Diagnostic Portfolio 与正式 Qualification Suite 分离；Portfolio definition、trial ledger、status projection 和 report 是分层权威。sealed Case、固定两次 repeats 和不可变报告都由内容 digest 保护，有效 Hard failure 不因修复被替换；修复后生成新 trial/report artifact 并与旧结论并存。

## 产品身份与 Renderer 边界

<a id="product-navigation"></a>

### 产品与导航

- 正式产品名是 **Rovai-ai**，仓库/package slug 为 `rovai-ai`，普通内部命名使用 `rovai`，Rust package/crate/executable 使用 `rovai-core` / `rovai_core`。旧 namespace 只在受控迁移或外部兼容边界保留。
- 普通导航使用“置顶 / 项目”投影：directory-backed Project 与 Quick Chat 分组来自 Camp workspace read model。设置在同一侧栏槽位以显式模式覆盖，不创造第二导航真源。
- Navigation 新鲜度采用事件驱动为主、前台约 20 秒安全刷新兜底；隐藏时暂停周期与后台 retry，focus 后立即重读。并发、trailing generation 与失败退避由 [Desktop Navigation Refresh](desktop-navigation-refresh.md) 统一拥有。
- Sidebar wordmark 是展示资产，不定义产品领域身份；Core 健康和诊断只从诊断入口读取，不常驻普通导航制造伪状态。

<a id="product-execution-surface"></a>

### Conversation、执行过程与 Inspector

- Conversation Header 的 Inspector 显隐是 Renderer 本地偏好，不产生领域命令。Stop 是时间线中的 CampTurn 终态投影；Copy 属于具体消息内容，Shared top bar 不取代页面自己的标题和动作。
- 执行过程以 Agent 为稳定聚合单位：同一 Camp 中一个 Agent 的 Run chronology 形成一个过程入口，状态必须由证据和 Run authority 归约，不能按最后一条文本或动画猜测。
- 普通 Camp Inspector 只有聚焦上下文和已定义的执行/详情入口；Approval 使用唯一 surface，不能在多个面板复制可操作控件或产生竞争决策。
- 渠道账号与队员 Bot 只在 Owner 本机设置 surface 可操作；渠道页不维护第二套项目目录或会话绑定。飞书只接受已验证 Owner，私聊自动 Quick Chat，群/话题首次项目选择只通过 Owner 私聊卡片完成。Renderer 只得到脱敏投影；App Secret、Cookie/CSRF、本机路径、原始外部身份和 Host 恢复游标留在 Main/Core 对应权威，不进入 DOM、Renderer state 或 Agent Context。
- Agent execution console 在一个已挂载 Camp workspace 内只有一个 Renderer-owned surface；其 `bottom | inspector`
  placement 是 Main-owned 的本机安装级展示偏好，最后一次成功的显式位置选择跨 Camp、页面切换和应用重启
  生效，但不进入 Camp/Core/SQLite 或云同步。旧偏好没有该字段时只补 `bottom`，不从历史 workspace、
  Inspector 显隐或窗口尺寸推断；权威偏好在 Camp 挂载前解析，写失败时保持旧位置和旧 snapshot。
- Placement 与 Inspector visibility 独立：右侧位置可随用户隐藏的 Inspector 一起不可见；没有 running Run
  的普通 Camp 切换和已挂载 workspace 中的后台事件不得强制显示 Inspector 或把执行台临时搬回底部。进入
  权威 snapshot 含 running Run 的 Camp 属于精确执行导航：Renderer 从当前事实选择最新 running Run，显示
  Inspector 并激活首个“执行”Tab，但不把键盘焦点移入执行台。该 selection 不持久化；重进时重新推导，
  不是恢复旧 Drawer 状态。显式“移到右侧”和其他既有精确执行导航仍会显示并激活“执行”。移动必须复用
  同一已挂载 DOM，保留 selection、disclosure、局部加载和嵌套阅读位置，不复制 console、不改变 Run 状态。
- Tool 全文不属于 Camp open 默认 DOM；截断 Evidence/Managed Blob 只在用户展开精确 Canonical Tool 行后读取，并只提取公开结果字段。读取成功后允许完整结果在当前 Drawer 会话内挂载于有最大高度的内部滚动 region，但不得暴露 Envelope 或建立 standalone raw Evidence surface。
- 任一 Shell Activity 只要同一公开 payload 提供 command，就使用统一完整脱敏标题；disclosure 第一行以
  `$ ` 紧接完整命令，存在公开输出时从下一行连续显示，不插入“命令 / 输出”标签或空白分隔行。没有 command
  时保留 Runtime toolName/title/domain fallback，不从其他字段补写。
- 运行中的 Runtime diagnostic 只能从 Adapter 严格白名单的结构化公开字段进入 Execution Evidence；它不改变
  AgentRun 终态、不证明 Tool Activity，也不从 raw stderr、provider body 或私有日志补写事实。Renderer 在
  精确 non-terminal Run 内明显显示最新可恢复状态；Run 终态后移除 live notice，并继续以权威 terminal failure
  或成功结果为准。
