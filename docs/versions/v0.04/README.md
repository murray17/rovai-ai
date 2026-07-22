---
document_type: version-overview
version: v0.04
lifecycle: current
authority: version-scope-and-status
last_updated: 2026-07-22
---

# Lumen AI v0.04 主工作区导航

> 状态：五个实施检查点已完成；预发布验收通过
>
> 文档规则：[文档导航](../../README.md)
>
> 跨版本约束：[ADR 索引](../../adr/README.md)
>
> 前置版本：[v0.03 多 Runtime 成员管理](../v0.03/README.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)
>
> 更新日期：2026-07-22

## 版本目标

v0.04 将主界面收敛为固定左侧导航、项目/Camp 树与单一主工作区，减少大厅、项目、任务、成员和诊断之间的重复入口。运行、审批、Diff 与审计继续属于当前 Camp 工作区；成员和设置保留为全局入口。

本版本的领域投影、创建语义、状态来源和删除边界已经收口，并已按 [实施与验收记录](implementation-plan.md) 完成五个检查点。代码仍处于预发布阶段；本状态表示 v0.04 范围内的实现与本地验收完成，不代表已经签名、公证或对外发布。

## 实施结果

- SQLite Migration、强类型 Camp 命令、Navigation Read Side、首条消息原子 Intake 与 Camp 工作区已经落地。
- Renderer 主路径不再依赖 legacy Project/Task 列表；Project 仅由共享 Project Binding 的 Camp 确定性派生。
- 运行中 Camp 的永久删除会被 Core 阻止；用户可先显式停止当前运行，待 AgentRun/CampTurn 收敛后再次确认删除。
- 新安装不会物化大厅 Project 或 compatibility Camp；删除最后一个 Camp 后 Project 分组消失，并在应用重启后保持消失。
- Rust、TypeScript、Renderer、真实 Runtime Smoke、生产构建、macOS 打包及 1040×700 / 1440×920 真实 App 流程均已验收。具体命令与范围见 [implementation-plan.md](implementation-plan.md)。

## 已确认决策

### NAV-01 用户可见工作区映射到 Camp

- **状态**：已确认。
- 左侧每条用户可打开的协作记录在领域上对应一个 `Camp`；产品界面可以把创建动作称为“新对话”，但 Contracts、Core 和领域代码继续使用 `Camp`。
- `Conversation` 继续只表示一个 `AgentProfile` 在一个 Camp 内的私有长期连续性，不作为项目树中的公共入口。
- `Task` 继续是 Camp 内可选的结构化工作承诺；普通讨论不创建 Task，Task 也不充当对话或导航容器。
- “大厅”是无项目绑定 Camp 的虚拟分组，不是伪造项目，也不是承载所有大厅讨论的单例 Camp。
- 项目分组下可以出现多个 Camp。当前 `camp.repository_scope_id` 的唯一约束与绑定模型需要在后续决策中调整，不能在 Renderer 中用 Task 临时掩盖这一冲突。

```text
大厅（虚拟分组）
└── Camp：讨论产品方向

项目 lumen-ai（项目分组）
├── Camp：调整主导航
├── Camp：CC-02 决策
└── Camp：Runtime 讨论

Camp
├── CampMessage（公共）
├── Conversation（洛可，私有）
├── Conversation（沐瓦，私有）
├── Conversation（眠枝，私有）
└── Task（可选）
```

### NAV-02 Project 是 Camp 的派生分组

- **状态**：已确认。
- v0.04 不建立独立 `Project` 领域实体、聚合根或权威表。Project 是产品与读取模型中的分组：共享同一 Project Binding 的 Camp 显示在同一个项目节点下。
- Project Binding 是 `Camp` 的可选组成部分，不是对 Project 实体的外键。没有 Project Binding 的 Camp 显示在“大厅”分组。
- Project 的名称、最近活动、运行数、待处理数和错误提示均由关联 Camp 确定性派生；Renderer 不单独保存一份 Project 状态。
- 当最后一个携带某 Project Binding 的 Camp 被永久删除后，该 Project 分组自然消失。Project 没有独立删除、归档或保留生命周期。
- “打开本地项目”不能只创建一个空 Project 记录。用户完成目录选择后，必须进入创建首个 Camp 的流程；只有 Camp 成功持久化后，项目节点才出现。
- 当前 legacy `project` 表继续只是迁移来源和兼容结构，不能重新成为 v0.04 写入真源；完成新导航迁移后应停止新写入并按显式迁移计划处理。
- 当前 `camp.repository_scope_id UNIQUE` 与一项目多 Camp 冲突，必须改为允许多个 Camp 共享同一稳定 Project/Repository Scope。

```text
Camp A ─┐
Camp B ─┼─ Project Binding X ──> UI Project X
Camp C ─┘

Camp D ── Project Binding = null ──> 大厅
```

### NAV-03 Project Binding 使用共享 Repository Scope

- **状态**：已确认。
- Git Project 的读取分组身份使用稳定 `repositoryScopeId`，而不是 `projectRoot`。`projectRoot` 与 `gitCommonDir` 是可重新验证的位置事实，不定义 Project 身份。
- 多个 Camp 可以保存同一个 `repositoryScopeId`；它们在 UI 中聚合成一个 Project。当前 `camp.repository_scope_id` 的非空唯一约束必须移除，但字段仍属于每个 Camp 的 Project Binding，不建立 Repository Scope 或 Project 实体表。
- 创建绑定 Git Repository 的 Camp 时，Core 规范化所选路径并读取 Git Common Directory、Object Format 等事实；若与现有 Camp 的有效绑定匹配，则复用其 `repositoryScopeId`，否则生成新的稳定 Scope ID。
- 共享同一 Git Common Directory 的普通工作目录与 Git Worktree 归入同一 Project；每个 Camp 仍保存自己实际使用的 `projectRoot`。
- Repository 移动或路径失效不会自动改变 Scope 身份。重新定位必须由用户显式确认，并由 Core 原子更新或校验受影响的 Camp Binding，不能根据目录名、Remote URL 或相似内容模糊猜测。
- 大厅 Camp 的 Project Binding 为 `null`。
- v0.04 首先维持 Git Repository 作为可执行项目的可靠边界；普通非 Git 目录不伪装成具有 Repository Scope 的 Project，是否支持留给后续版本。

```ts
type ProjectBinding = {
  repositoryScopeId: string;
  projectRoot: string;
  gitCommonDir: string;
  objectFormat: "sha1" | "sha256";
};
```

### NAV-04 新 Camp 自动组建全体活跃成员

- **状态**：已确认。
- 点击“新对话”后只进入 Renderer 临时输入态，不存在 Camp Draft 领域对象；取消输入不产生空 Camp。首次发送使用幂等命令原子创建 Camp、初始 CampMember、每成员唯一 Conversation、Default Lead、首条 CampMessage，以及该消息明确请求执行时的 CampTurn/AgentRun。
- 创建事务以当时 `AgentProfile.status = active` 的集合为快照，自动把全部活跃 AgentProfile 加入新 Camp；不要求用户逐个选择初始成员。
- 该规则只发生在 Camp 创建时。之后新增或重新启用 AgentProfile 不自动侵入既有 Camp；加入既有 Camp 继续使用显式成员命令。
- Starter Profile 中“小熊猫”是洛可，对应稳定 ID `agent-luoke`，并在默认 Member Order 中排第一。初始 Lead 不再通过角色 ID、显示名、头像或 `personaLabel` 硬编码，统一使用 NAV-07 的可调整成员顺序。
- 不存在活跃成员时，常规“新对话”入口不创建 Camp，并引导用户前往成员页创建或启用成员。领域层保留无成员 Camp 的合法性，但 v0.04 不从常规入口暴露。
- Default Lead 仍只是未定向消息的默认入口，不因“小熊猫”身份获得额外 Capability，也不与 Runtime 或 Native Session 绑定。
- 当前兼容逻辑优先 `agent-muwa` 的行为必须迁移为上述规则；Renderer 中硬编码“给沐瓦发送”的文案也不能继续作为新 Camp 语义。

### NAV-05 新 Camp 至少需要一名 Runtime Ready 成员

- **状态**：已确认并实现创建门禁与首次发送原子复核。
- Runtime 不可用统一表示该成员当前未就绪，但 UI 必须保留具体 blocker，例如未配置、认证失效、模型失效、安装消失或 Adapter 不可用。
- 常规“新对话”是可执行协作入口，不作为无 Agent 笔记功能。创建 Camp 前至少必须存在一名同时满足 `AgentProfile.status = active` 与 `runtimeReadiness.status = ready` 的成员。
- 所有活跃成员均未就绪时，不进入新对话临时输入态、不写入 Camp，并把用户引导到成员页修复 Runtime 配置。快捷键、项目 `+` 和其他创建入口必须使用同一门禁，不能只禁用一个按钮。
- Camp 创建时仍按 NAV-04 把全部活跃 AgentProfile 加入成员快照；Runtime 未就绪的活跃成员可以成为 CampMember，但不能创建或启动 AgentRun。
- Readiness 必须在首次提交事务前重新校验。进入临时输入态后能力、认证或配置发生变化时，命令原子拒绝并保留 Renderer 输入内容，不能留下部分 Camp、CampTurn 或 AgentRun。
- 已存在的 Camp 不因之后所有成员变为未就绪而消失或归档；历史仍可查看，新的执行请求按实际 Preflight 阻止。

### NAV-06 Default Lead 可以随时显式调整

- **状态**：已确认。
- 活跃 Camp 必须在主工作区提供明确的 Default Lead 调整入口。用户可以随时发出 `ChangeDefaultLead`；拥有 `camp.default_lead.change` Capability 的 Agent 仍可按既有强类型命令协议发起变更。
- 新 Lead 必须是该 Camp 的有效活跃 CampMember。命令使用 `commandId`、Camp `expectedVersion` 和事件审计，在一个事务中原子更新 `Camp.defaultLeadAgentId`；不通过修改多个 CampMember 布尔值表达。
- 变更只影响提交成功后新产生的 `default` 地址解析。已经持久化的 CampMessage 地址快照、正在运行或排队的 AgentRun、既有 Task Assignee、InboxMessage 和 Native Session 均不改变。
- 显式 `@Agent`、回复目标、Task 定向入口和广播继续优先于 Default Lead；调整 Lead 不转移工作责任，也不取消当前执行。
- Runtime 临时故障不会自动更换 Lead。用户可以主动把 Runtime 未就绪但有效活跃的 CampMember 设为 Lead；UI 必须展示具体未就绪原因并要求明确确认，但 Core 不以瞬时 Runtime Readiness 否决关系变更。
- 未就绪 Lead 不影响普通公共消息持久化，但后续默认执行请求由 Preflight 阻止。系统不得自动改派；用户可以修复 Runtime、显式指定其他 Agent，或再次更换 Lead。
- 归档 Camp 不允许调整 Lead；归档事务继续按既有规则清空 `defaultLeadAgentId`。

### NAV-07 Member Order 决定新 Camp 的初始 Lead

- **状态**：已确认。
- AgentProfile 具有用户可调整的全局 Member Order；成员管理页面提供排序入口。Starter 默认顺序把“小熊猫”洛可（`agent-luoke`）放在第一位，但用户排序是后续唯一选择依据。
- 新 Camp 创建时，Core 按当前 Member Order 读取全部活跃 AgentProfile，并选择其中第一个 `runtimeReadiness.status = ready` 的成员作为初始 Default Lead。未就绪成员被跳过但仍按 NAV-04 加入 Camp。
- 如果顺序中的所有活跃成员都未就绪，则按 NAV-05 拒绝创建，不使用名称、创建时间、数组偶然顺序或其他隐藏 fallback。
- Member Order 变化影响成员管理与 Camp 成员列表的展示顺序，以及之后创建的 Camp；不得自动改变任何既有 Camp 的 Default Lead、成员资格、Task Assignee、消息地址或运行职责。
- 排序是展示与初始化策略，不表达成员权限或组织等级。相同位置等异常数据必须用稳定 AgentProfile ID 确定性打破平局，并由排序命令在单个事务中重新规范化。
- 建议持久字段使用明确的 `memberOrder`，通过用户命令原子重排；不使用可编辑角色标签推导顺序，也不把顺序仅保存在 Renderer Local Storage。

### NAV-08 主 Composer 的用户消息默认请求执行

- **状态**：已确认。
- 常规“新对话”不是纯笔记入口。新 Camp 的第一条用户消息使用 `default` 地址并携带结构化 ExecutionRequest，目标为 NAV-07 选出的初始 Default Lead。
- 首次提交以一个幂等领域命令原子创建 Camp、全部初始 CampMember、每成员 Conversation、Default Lead、首条 CampMessage、CampTurn 和首个 AgentRun。Runtime Preflight 或任一不变量失败时不持久化半成品，并保留 Renderer 输入内容供用户修复后重试。
- Camp 建立后的主 Composer 中，用户普通发送仍默认请求当前 Default Lead 执行；显式 `@Agent` 可以请求一名或多名有效成员，并按既有多目标原子规则创建 AgentRun。
- v0.04 主 Composer 不提供“仅发送但不唤醒 Agent”模式，避免两种发送语义挤占主路径。Core 继续保留不携带 ExecutionRequest 的 CampMessage 能力，供系统消息、Agent 最终回复、审批/状态事件、Agent 间普通通知和未来明确入口使用。
- Agent 最终回复、流式片段、系统事件、审批通知和普通 Inbox 投递不会因进入 Camp 时间线而递归创建新的 CampTurn/AgentRun。
- 当前把大厅首条消息包装成 legacy Task 的路径必须替换为上述 Camp 主链；不得为了打开工作区继续隐式创建 Task。

### NAV-09 Camp 标题取自首条用户消息

- **状态**：已确认。
- Camp 拥有持久、可显式修改的 `title`，侧栏和上下文栏读取该字段；不得长期用 Task 标题、Native Session 名称或查询时动态截取消息替代。
- 创建 Camp 时，Core 将首条用户消息去除首尾空白、把换行及连续空白规范化为单个空格，并在同一事务写入初始标题。标题生成不调用 LLM，不增加隐藏模型成本或后台状态。
- 初始标题直接使用规范化后的首条用户消息，不把侧栏宽度换算成固定字符上限，也不把展示用省略号写回 `Camp.title`。首条 CampMessage 始终保存未经标题规范化的完整原文；相同标题允许存在，身份始终是 `campId`。
- 当前 Lumen 侧栏宽度为 220px。扣除侧栏内边距、Camp 层级缩进、行内边距和状态标记后，标题位预计约为 140–150px。Renderer 必须让标题占据剩余弹性宽度，并使用单行 `text-overflow: ellipsis` 按实际像素宽度显示 `…`；不得用“48 个字符”等固定长度近似布局。
- 上下文栏等更宽位置可以显示更多标题内容。字体、窗口缩放、层级和状态标记变化时，省略位置由布局自然重算；中英文及其他 Unicode 文本不需要不同的截断规则。
- 用户可以通过带 `commandId` 和 Camp 版本前置条件的 `RenameCamp` 显式修改标题；后续消息、Agent 输出、Native Thread 改名和 Runtime 恢复均不得自动覆盖。
- 标题为空不构成额外 fallback：NAV-08 已要求首条用户消息非空，创建命令必须复用同一校验。

### NAV-10 Camp 行只显示运行与未读完成标记

- **状态**：已确认。
- v0.04 不为侧栏引入 `running / waiting / failed / idle` Camp 状态机，也不在 Camp 行聚合审批数、失败数、Agent 头像或 Runtime 信息。详细状态留在当前 Camp 工作区。
- Camp 行只有三种互斥展示：存在当前非终态 AgentRun 时显示 loading 标记；运行结束且产生尚未查看的新结果时显示蓝点角标；其他情况不显示标记。loading 的展示优先于旧的未读蓝点。
- 蓝点表示“有新的运行结果尚未查看”，不是 `completed` 领域状态。成功、失败或取消等具体终态不改变侧栏标记颜色，用户进入 Camp 后在工作区查看真实结果。
- 用户打开该 Camp 并看到最新活动后清除蓝点；当前正在查看的 Camp 收到运行结果时视为已读，不额外显示蓝点。实现可持久化每个 Camp 的最后已查看活动水位，以便应用重启后保持一致，但不得把该水位解释成 Camp 生命周期状态。
- Agent 最终回复、AgentRun 终态与蓝点水位必须基于同一条已提交的增量活动序列更新，避免先显示完成角标、实际回复却尚未可读。纯系统提示或普通未触发执行的消息不点亮完成蓝点。

### NAV-11 每个分组默认展示最近五个 Camp

- **状态**：已确认。
- “大厅”和每个 Project 分组内部均按 Camp 的最后活动时间倒序展示，默认最多显示最近 5 个 Camp；不足 5 个时不填充占位项。
- 分组中的 Camp 超过 5 个时才显示“查看全部”，并在文案中携带总数；5 个及以下不显示该入口。
- Camp 的最后活动时间由已提交的公共协作事实推进，包括用户 CampMessage、Agent 最终回复以及 AgentRun 的有效终态；查看、展开、折叠、重命名和 loading 动画不更新时间，流式片段也不得持续改变排序。
- Project 分组之间按各自最新 Camp 的最后活动时间倒序；最后一个 Camp 被永久删除后，Project 依 NAV-02 自然消失。大厅保持在 Project 列表之前，不参与 Project 间排序。
- 排序和数量限制由 Read Side 返回，Renderer 不维护另一份最近列表，也不使用 legacy Project/Task 的创建时间替代 Camp 活动时间。

### NAV-12 Project 节点只负责展开 Camp

- **状态**：已确认。
- v0.04 不保留独立 Project 概览页面。Project 只是由共享 Project Binding 的 Camp 构成的侧栏分组，不获得与其派生身份不相称的独立主工作区。
- 点击 Project 名称或展开箭头执行同一个展开/折叠动作；不得让名称跳转页面、箭头改变树状态，从而形成两个隐蔽命中区域和不同语义。
- 点击 Camp 才打开单一主工作区。Project 折叠不会关闭当前 Camp、停止运行或改变选择，只改变侧栏树的可见性。
- Camp 超过 5 个时，“查看全部”在当前侧栏分组内展开全部 Camp，并切换为可收起状态；不为此跳转到 Project 页面。搜索与跨 Camp 管理若进入范围，应使用独立明确入口，而不是伪装成 Project 概览。
- Project 行不展示独立生命周期操作。其标题、排序与是否存在继续完全由所含 Camp 派生。

### NAV-13 旧 Task 对话按 Camp 导入，脏数据直接丢弃

- **状态**：已确认。
- 已经由 v0.02/v0.03 权威命令创建、且领域关系完整的真实 Camp 原样保留，不因导航改版拆分；其内部 Task 继续只是可选工作承诺。
- 对旧版由 Project/Task/RuntimeSession 构成、把 Task 当作独立对话工作区的数据，按“一条有效 legacy Task → 一个导入 Camp”转换。导入 Camp 的标题沿用 Task 标题，Project Binding 从可验证的 Git Project 信息复制；原 Task、事件和执行记录作为该 Camp 下的只读历史保留。
- 导入只恢复 Lumen 可以确定表达的领域事实，不尝试恢复或续接旧 Native Session。导入 Camp 按当前有效 AgentProfile 建立成员与 Conversation，并依 NAV-07 选择 Runtime Ready 的初始 Lead；历史 owner/assignee 不因此获得额外权限。
- legacy 大厅中的 Task 导入为 Project Binding 为 `null` 的 Camp。没有任何有效 Camp 的 legacy Project 不生成空分组，依 NAV-02 直接消失。
- Lumen 仍处于初创阶段。迁移遇到悬空外键、重复且冲突的归属、无法验证的 Git Binding、缺失必需正文或其他不能确定映射的脏数据时，直接跳过并清理相关兼容记录；不得使用路径名、时间接近或自由文本进行猜测性修复，也不为救回脏数据污染新模型。
- 丢弃必须按最小一致关系集进行，不能留下半个 Camp、孤立 Conversation 或无归属 Task。迁移结束记录简短诊断摘要与被丢弃的 legacy ID，便于开发期排查；不因此阻塞其余有效数据启动。
- 迁移命令必须幂等。成功导入的数据使用稳定 legacy 来源键防止重复 Camp；完成切换后，新的创建和导航路径停止向 legacy Project/Task-as-conversation 投影写入。

### NAV-14 设置承载诊断，Core 正常时不显示状态点

- **状态**：已确认。
- “设置”固定在左侧栏底部；原顶级“诊断”入口删除，诊断作为设置页中的一个明确分区。设置页仍是完整主页面，不使用临时弹窗承载故障排查。
- 设置入口旁的 Core 健康标记只回答本地 Rust Core 是否可用。正常状态不显示任何圆点；Core 连接中断、SQLite 无法打开、必要迁移失败或 Snapshot/增量订阅无法恢复时显示红点。
- 红点不是 Camp、AgentRuntimeAdapter、成员 Readiness、审批或 AgentRun 状态。成员 Runtime 问题留在成员页，当前 Camp 的运行与审批问题留在 Camp 工作区，不能混入一个含义不清的“整体橙色”状态。
- 红点必须具有可访问名称与简短说明；点击设置后，诊断区展示结构化原因和对应局部恢复动作，不能只依赖颜色表达故障。
- 顶栏不保留全局“刷新”按钮。正常状态通过 Snapshot 与增量订阅自动更新；局部读取或执行失败时，在错误所在页面提供重试。Core 级恢复失败才通过设置红点与诊断区处理。

### NAV-15 新对话只在首条消息发送时创建 Camp

- **状态**：已确认。
- 点击左上角“新对话”只进入 Renderer 的临时输入界面，不创建 Camp、Camp Draft 领域实体、成员、Conversation、消息、CampTurn 或 AgentRun，也不写入 SQLite。
- 若当前正在查看带 Project Binding 的 Camp，临时输入界面预选同一 Project Binding；若当前位于大厅、成员或设置，则预选无 Project Binding，即大厅。预选值只是首次创建命令的 UI 参数，不是持久状态。
- 用户在发送第一条非空消息前可以切换该预选归属。取消、离开或始终未发送时不产生任何待清理记录。
- 只有用户发送第一条非空消息时，Renderer 才提交一个幂等创建命令；Core 使用该命令携带的最终 Project Binding，按 NAV-04、NAV-05、NAV-07、NAV-08 与 NAV-09 在同一事务中创建完整 Camp 主链。
- Camp 创建后，后续导航不得因为用户切换页面或打开其他目录而静默改变其 Project Binding。需要重新定位或显式改变绑定时，继续遵守 NAV-03 的校验与命令边界。

### NAV-16 Camp 菜单提供重命名与永久删除

- **状态**：已确认。
- 每个 Camp 行提供三点操作菜单，v0.04 只包含“重命名”和“删除”。菜单按钮必须独立于 Camp 行的打开动作，支持键盘与可访问名称；点击菜单不得同时切换主工作区。
- “重命名”调用 NAV-09 已定义的显式 `RenameCamp`，不改变 Project Binding、最后活动时间或运行状态。
- “删除”表示永久删除 Camp 及其从属协作数据，不是归档、隐藏或移入回收站。删除前必须显示不可撤销确认，并明确说明消息、Conversation、Task、Run、审批与本地受管附件等 Camp 内历史将被移除。
- v0.04 不提供 Archive、Unarchive、回收站或搜索界面。旧 `Camp.status = archived` / `archivedAt` 数据只属于迁移兼容输入，不能继续作为新删除路径；无法可靠迁移的 archived 脏数据依 NAV-13 丢弃。
- 删除最后一个共享某 Project Binding 的 Camp 后，该 Project 分组依 NAV-02 立即从读取模型消失；AgentProfile、外部 Git Repository、用户工作目录和已存在的 Git Commit 不因删除 Camp 而删除。
- `DeleteCamp` 只允许 User Actor 发出，并携带 `commandId` 与 Camp `expectedVersion`。存在非终态 CampTurn/AgentRun、pending Approval、prepared/executing/active-unknown ActionExecution、未完成取消/成员退出、仍被 Worker 租用的 Inbox/Runtime Delivery 或其他尚未对账副作用时，Core 返回结构化 blocker，不删除任何记录。
- 删除弹窗在有 blocker 时提供“停止运行”，但停止与删除是两个显式步骤：先请求现有运行收敛，待重新读取确认 Camp 静止后，用户再次确认永久删除。v0.04 不增加 `deleting`、`delete_requested` 或后台删除状态机。
- 静止 Camp 的删除在单个 SQLite 事务内移除 CampMember、Conversation/Message、CampMessage、Task/Dependency、CampTurn/AgentRun、Inbox、Approval、Action、证据关系、事件及其他 Camp 从属记录，最后删除 Camp。任一数据库步骤失败则整体回滚，不能留下半删除聚合。
- Lumen 管理的附件 Blob 在引用删除后进入确定性 GC；仍被其他权威引用的去重 Blob 保留。Lumen 可以清理自己创建且只属于该 Camp 的内部 Git Ref，但不得删除 Repository、用户文件、普通 Branch、Worktree 或 Commit。外部 Adapter 的 Native Session 只解除本地绑定；是否能清理 Provider 自有历史不作为删除成功门禁。
- 已成功删除的 `DeleteCamp` 命令结果可保留最小幂等记录，使相同 `commandId` 重试返回原结果；它不保留 Camp 内容，也不构成归档或回收站。
- 该决策明确修订 v0.02 “普通删除实现为 ArchiveCamp”的历史方案；[ADR-0008](../../adr/0008-collaboration-v2.md) 已完整替代 ADR-0002，后续实现不得同时支持两套相反语义。

## 待逐项确认

- 无。v0.04 主导航的领域、交互与五个实施检查点均已收口；新增范围进入后续版本，不继续扩张本版本。

## 明确不做

- 不把领域 `Conversation` 改造成公共聊天线程。
- 不把现有 Task 永久改名或投影成 Conversation。
- 不仅通过 Renderer 本地状态拼装项目/Camp 真源。
- 不恢复独立 Project 领域实体或让 legacy `project` 表重新成为权威真源。
- 不在决策收口前直接照搬参考报告实施导航。
