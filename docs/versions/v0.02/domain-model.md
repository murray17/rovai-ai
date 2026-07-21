# Lumen AI v0.02 领域模型讨论记录

> 状态：领域决策已收口；待拆分实施 ADR 与迁移计划
> 上级文档：[v0.02 多 Agent 协作架构基线](README.md)
> 更新日期：2026-07-20

## 文档用途

本文件记录 Lumen v0.02 各领域点的最终选择、推导理由和正式讨论结果。

- 这里讨论的是领域语义，不等同于“一项一个数据库表”。
- v0.02 不建立通用 Outbox；可靠推进由权威对象自身状态、租约、fencing、窄化 ACK 与类型化扫描器承担。
- `ManagedBlob` 是受控文件存储资源；`MessageAttachment` 才是消息与文件快照之间的领域关系。
- 状态可取：`待讨论`、`讨论中`、`已接受`、`已修订`、`已否决`、`已延期`。
- 上方决策表与进度表只作索引；讨论过程和决策结果只在下方对应 DM 条目维护，避免双写。
- 本目录是本地讨论区；被接受的结论仍需整理为受版本控制的 ADR。

## 总体边界

```text
Camp 管长期公共协作上下文
Conversation 管单个 Agent 的私有连续性
Task 管可选的结构化工作
CampTurn 管一次可执行公共触发形成的有界协作过程
AgentRun 管某个 Conversation 在 CampTurn 中的一次实际执行
Native Session 是 Conversation 当前可替换的运行句柄
InboxMessage 管 Agent 间可靠定向投递
```

## 领域模型决策表

| ID | 领域点 | Lumen v0.02 决策 | 边界摘要 |
|---|---|---|---|
| DM-01 | 项目边界 | Camp 保存项目路径与可空稳定 Repository Binding；暂不引入独立 `Project` | Project 仅作为按 Camp 路径派生的分组概念 |
| DM-02 | 用户目标 | 不引入 `TeamRun`；Camp 可承接闲聊和多个连续问题 | 需要结构化执行时才创建 Task |
| DM-03 | Camp 成员 | 显式 `CampMember` + Capability 覆盖 + 可恢复退出，暂不引入 `Team` | 分离长期 Agent 身份与 Camp 内成员关系 |
| DM-04 | 长期 Agent 身份 | 可直接修改的 `AgentProfile` | 保存稳定身份、角色描述与默认运行配置；AgentRun 快照实际配置 |
| DM-05 | 身份版本 | 不引入 `AgentProfileVersion` | 以运行时有效配置快照保证历史可审计 |
| DM-06 | 运行参与者 | 不引入 `AgentInstance` | CampMember 管资格、Conversation 管连续性、AgentRun 管执行 |
| DM-07 | 工作节点 | Camp 内按需创建的扁平 `Task` | 无 Proposal；创建时绑定唯一且不可变的 Assignee；四态生命周期 |
| DM-08 | 工作依赖 | 可选 `TaskDependency` DAG | 只表达同一 Camp 内的硬前置关系 |
| DM-09 | Agent 执行 | `AgentRun` 必属 CampTurn 与 Conversation，可选关联 Task，并冻结初始输入水位 | 只在完整启动资格满足时执行 |
| DM-10 | 原生会话链 | 不建 Session Chain；`Conversation.nativeSessionId` 保存当前绑定 | 逻辑 Conversation 不随底层 Session 换绑而改变 |
| DM-11 | Runtime 元数据 | `Conversation` 保存 Provider/模型覆盖和当前 Session 绑定；运行状态由 AgentRun 投影 | 逻辑上下文与 Provider 原生 Session 解耦 |
| DM-12 | 公共执行轮次 | `CampTurn` 属于 Camp，包含一个或多个 AgentRun | 不是所有消息都会创建 CampTurn；输出与状态消息只关联或独立记录 |
| DM-13 | 对话记录 | `CampMessage` 与 `ConversationMessage` 使用各自单调序列；每个 AgentProfile 在 Camp 内有一个私有 Conversation | 唯一 Conversation + 每 Run 初始输入水位 |
| DM-14 | Agent 通信 | `InboxMessage` | 单接收者持久投递；通用实体引用；Core ACK；不跟踪消费 |
| DM-15 | 责任交接 | v0.02 不提供责任转移功能，也不引入 `Handoff` | Task Assignee 创建后不可变；InboxMessage 不表达责任转移 |
| DM-16 | 审查协作 | 不引入 `Review`；使用 InboxMessage、Conversation、CampTurn 与 AgentRun | 自然语言反馈不产生 Verdict、Finding、返工状态或完成门 |
| DM-17 | 系统决策 | 不引入 `Decision`；由显式领域命令、对象状态、`Approval` 与 `event_log` 分工表达 | 命令表达意图，状态表达结果，Approval 表达授权等待；Core 不解析自然语言决定 |
| DM-18 | 输出与证据 | 不引入 `Artifact`；输出保留在自然权威对象中，以稳定 `EntityReference` 组成验收证据 | 独立文件使用 MessageAttachment + ManagedBlob；不自动提升普通输出 |
| DM-19 | 人类审批 | `Approval` | 对 AgentRun 内一个已持久化、参数冻结的受限动作进行一次性人类授权；批准不等于执行成功 |
| DM-20 | 受限动作与副作用 | 单一 `ActionExecution`；确定终态提供 `ActionReceipt` 读模型 | 一条记录贯穿参数冻结、授权、派发、结果未知与对账 |
| DM-21 | 命令与事件记录 | `event_log` + 特殊 `command.result` 事件 | 不建独立 CommandRecord 表；同一追加式存储同时承载审计事件与永久命令结果 |
| DM-22 | 事务后可靠推进 | 不引入通用 Outbox；权威对象状态 + 类型化扫描器 | 提交后本地 Wake 只作加速，启动/周期扫描负责恢复 |
| DM-23 | Worktree | 不建 Worktree/WorktreeRevision 实体；AgentRun 冻结实际 Workspace，Worktree 仅为可选 Skill 策略 | 不做单写者锁；长期代码证据只接受带仓库作用域的完整 Git Commit OID |

## 当前关系

```text
Camp
├── CampMember / CampMessage / Resource / Evidence Reference
├── Conversation ──> AgentProfile
│   ├── ConversationMessage / Summary / Camp Cursor
│   └── current Native Session Handle
├── Task（需要结构化跟踪时才创建）
│   └── TaskDependency
├── CampTurn（仅在出现可执行触发时创建）
│   └── AgentRun ──使用──> Conversation
│       ├── optional Task
│       ├── optional immutable Workspace snapshot
│       ├── ActionExecution（prepared → execution → result/reconcile）
│       └── Approval ──一次性授权──> ActionExecution(prepared)
├── InboxMessage
├── MessageAttachment ──> ManagedBlob
└── event_log

SQLite 事务提交
└── best-effort local Wake Signal

权威对象状态
└── 启动扫描 / 周期扫描 / 类型化 Worker 恢复未完成工作

显式领域命令
└── Core Gate ──> 对象状态/请求事实 + event_log(command.result)
```

## 讨论进度

| ID | 领域点 | 状态 | 决策摘要 |
|---|---|---|---|
| DM-01 | 项目边界 | 已修订 | v0.02 不建 Project 表；Camp 保存项目路径、稳定 Repository Binding，并仅支持归档 |
| DM-02 | 用户目标 / TeamRun | 已否决 | 不引入 TeamRun；Camp 长期存在，Task 按需创建 |
| DM-03 | Camp 成员 | 已修订 | CampMember 保存 Capability 覆盖和可恢复退出；固定 Task Assignee 不清空；Camp 保持唯一有效 Default Lead |
| DM-04 | AgentProfile | 已修订 | 长期身份与默认配置可直接修改；运行时冻结唯一 Capability/动作权限快照 |
| DM-05 | AgentProfileVersion | 已否决 | 不维护 Profile 版本实体或发布流程 |
| DM-06 | AgentInstance | 已否决 | 不建立 AgentInstance；每个 Conversation 最多一个 running/waiting AgentRun 持有执行锁 |
| DM-07 | Task | 已修订 | 扁平 Task；无 Proposal；固定 Assignee；Task 级 Readiness 与 Run 活动条件分离 |
| DM-08 | TaskDependency | 已修订 | 可选硬前置 DAG；queued Run 启动时重检；取消请求不伪装成原子终态 |
| DM-09 | AgentRun | 已修订 | 六态可恢复生命周期；完整启动资格与初始输入水位；同 CampTurn 后继和 Retry/Decline 原子互斥 |
| DM-10 | 原生会话链 | 已修订 | 不建 Session Chain；当前 Session 唯一绑定 Conversation，并通过强类型命令换绑 |
| DM-11 | RuntimeSession | 已修订 | 逻辑 Conversation 与 Provider Session/Runtime Host 解耦；进程拓扑不进入领域身份 |
| DM-12 | CampTurn | 已修订 | 有界公共执行过程；按当前职责、Task 取消与 Retry/Decline 事实确定性聚合 |
| DM-13 | 对话记录 | 已修订 | 公私消息各自单调排序；Conversation 管私有连续性，每个 Run 冻结初始可见水位 |
| DM-14 | InboxMessage | 已修订 | 单接收者可靠投递；增加通用实体引用；写入 Conversation 后由 Core ACK |
| DM-15 | Handoff | 已否决 | v0.02 不支持责任转移；不建 Handoff；InboxMessage 不承担该语义 |
| DM-16 | Review | 已修订 | 不建 Review 实体；同 CampTurn rework 与跨 CampTurn 新执行严格分开 |
| DM-17 | Decision | 已修订 | 不建 Decision；补齐强类型命令、Actor fencing、持久幂等及 Retry/Decline 协议 |
| DM-18 | Artifact / 输出与证据 | 已修订 | 不建 Artifact；普通 Patch 只用于协作，长期代码证据使用带仓库作用域且保持可达的完整 Commit OID |
| DM-19 | Approval | 已接受 | 一次性授权一个已持久化的具体受限动作；只由目标用户决定，解决后按动作投递结果并重新聚合 Run blocker |
| DM-20 | ActionExecution / ActionReceipt | 已修订 | 单一动作真源；observed 与受控执行分离；allow 不盲重发，旧 Runtime 可受限安全关闭投递 |
| DM-21 | command.result / event_log | 已修订 | 永久 `command.result`；Task 无 generation，完成证据保存 Actor attestation |
| DM-22 | Outbox / 事务后推进 | 已否决 | 不建通用 Outbox；各权威对象作为自己的持久工作来源，以类型化扫描、租约、ACK 和最佳努力 Wake 推进 |
| DM-23 | Worktree | 已修订 | 不建 Worktree/WorktreeRevision 或写锁；Workspace 冻结 Repository Scope，Commit 以同一 Scope 保持可达 |

## 逐点讨论记录

以下每一项使用相同的记录结构。讨论完成后，同时更新上方“讨论进度”表。

### DM-01 项目边界

- **状态**：已修订
- **Lumen 决策**：Camp 直接保存项目工作目录引用；v0.02 不引入独立 `Project` 实体或数据表。
- **核心问题**：在暂不建设项目级生命周期的前提下，以最小模型表达 Camp 所在的代码空间。

#### 讨论记录

本轮比较过两种方案：

```text
方案 A：Camp.project_path
方案 B：Camp.project_id → Project → workspace/path/git identity
```

v0.02 选择方案 A。当前 Project 不拥有独立生命周期、配置、记忆或索引，因此不为未来能力提前建设 `Project` 聚合与数据表。界面需要展示项目分组时，可根据未归档 Camp 保存的规范化路径派生；最后一个 Camp 被归档后，该分组自然从默认视图消失。

Camp 保存的是创建或打开协作上下文时的项目工作目录引用。DM-23 已确认 Agent 的实际执行目录和可选 Git Worktree 只进入 AgentRun Workspace 快照，不由 Project 表承载。

为避免把可移动路径误当作 Git 证据身份，Git Camp 还保存一个内嵌的稳定 Repository Binding；它是 Camp 的值对象，不是 `Project` 或独立 Repository 聚合：

```ts
type CampRepositoryBinding = {
  scopeId: string;          // Core 创建、在当前 Camp 生命周期内稳定
  gitCommonDir: string;     // 当前可解析的规范化绝对路径，可显式重定位
  objectFormat: 'sha1' | 'sha256';
  internalRefNamespace: string;
  boundAt: string;
  relocatedAt: string | null;
};

type Camp = {
  id: string;
  projectPath: string;
  repositoryBinding: CampRepositoryBinding | null;
  defaultLeadAgentId: string | null;
  status: 'active' | 'archived';
  lastMessageSequence: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};
```

`scopeId` 由 Core 生成，必须全局唯一、不可转让、不可在另一个 Camp 中复用，并对数据库建立唯一约束；`internalRefNamespace` 必须从同一 Camp 的稳定身份确定性派生或在绑定时冻结，不能与其他 Camp 冲突。`scopeId` 在目录移动、同一仓库的 Worktree 切换和 Camp 路径重定位后保持不变；`gitCommonDir` 只能通过显式、带版本前置条件的重定位命令修改，并须重新验证 object format 和既有内部 Ref。不同 Camp 即使指向同一 Git common directory，v0.02 仍拥有不同的 scopeId，因为当前不支持跨 Camp 证据共享。

v0.02 不提供 Camp 硬删除。用户界面的“删除”实现为 `ArchiveCamp`，且它只能归档已经静止的 Camp：所有 Task 与 CampTurn 已终态，不存在非终态 AgentRun、pending Approval、prepared/executing/active-unknown ActionExecution、未终结（既未 ACK 也未安全关闭）的 Runtime Delivery、尚未投递且未失败的 InboxMessage，或未完成的取消/退出编排。Core 必须在同一事务重新检查这些门禁，再写入 `status = archived`、`archivedAt`，清空 `defaultLeadAgentId` 并递增 `version`；不能先归档再依赖后台 Worker 收尾。归档是 v0.02 的终态，不提供 Unarchive；归档后禁止新消息、Task、CampTurn 和 AgentRun，但保留 CampMember、全部历史、幂等结果、未解决效果、证据与内部 Git Ref。需要继续协作时创建新 Camp，不复活旧 Camp。依法或安全要求的物理擦除使用 DM-21 的独立擦除协议，不属于普通 CRUD。

`ArchiveCamp` 在 v0.02 只允许 User Actor 发出；Agent 可以在 CampMessage 中建议归档，但不拥有对应 Capability。否则 Agent 必须依赖一个非终态 `sourceAgentRunId` 发命令，而归档门又要求不存在非终态 Run，会形成无法满足的自锁。

#### 决策结果

- **决策**：v0.02 不建立 `Project` 实体或 `project` 表；Camp 直接保存项目工作目录引用。
- **理由**：当前业务事实以 Camp 为中心，尚无必须脱离 Camp 独立存在的项目级数据；先避免引入项目去重、路径迁移和删除生命周期。
- **领域影响**：Project 暂为 UI/查询层的派生分组，不是聚合根；一个 Camp 绑定一个主项目工作目录；Git 证据身份来自 Camp 内稳定 Repository Binding，而不是路径字符串。
- **数据/API 影响**：Camp 增加项目路径、可空 Repository Binding、状态、版本和归档字段；Conversation 通过 Camp 间接获得路径，不重复保存；普通删除改为受门禁约束的归档。
- **后续事项**：在引入跨 Camp 项目记忆、项目级配置/索引或跨 Camp 证据共享时，重新评估独立 `Project`/Repository 聚合；普通目录重定位由 Camp Repository Binding 命令处理，不再自动迫使引入 Project。

### DM-02 用户目标 / TeamRun

- **状态**：已否决
- **Lumen 决策**：不引入 `TeamRun` 概念或实体；Camp 本身是可长期延续的协作会话。
- **核心问题**：是否必须把 Camp 内每个问题包装成具有开始、阶段和结束状态的一次团队运行。

#### 讨论记录

本轮比较过两种模型：

```text
方案 A：Camp → TeamRun → Task
方案 B：Camp → CampMessage / Conversation / 按需创建的 Task
```

v0.02 选择方案 B。Camp 可以持续存在并承接不同性质的交流：用户可以连续讨论同一个问题，也可以十天后提出另一个问题，还可以只打一声招呼。系统不应为了满足预设状态机，强迫每条消息归属于一个具有明确终点的 TeamRun。

Camp 没有“完成”状态。普通交流只形成公共消息和各 Agent 的 Conversation 连续性；只有当工作需要分派、依赖、进度、重试或验收时，才按需创建 Task。一次复杂目标如何由多个扁平 Task 和可选依赖 DAG 表达，留给 DM-07、DM-08 继续讨论。

取消 TeamRun 后，原先候选的成员快照、身份版本固定、预算和终止条件不能继续默认挂在 TeamRun 上；其实际归属分别由 DM-03、DM-05、DM-06、DM-07 和 DM-09 的最终决策确定。

#### 决策结果

- **决策**：v0.02 不引入 `TeamRun` 概念、实体、数据表或状态机。
- **理由**：保持 Camp 像长期会话一样灵活，允许闲聊、连续解决一个问题或跨时间处理多个问题，不强制人为划分运行边界。
- **领域影响**：Camp 是长期协作与上下文边界，但不是一次必须结束的任务；Task 成为可选的结构化工作对象。
- **数据/API 影响**：不增加 `team_run` 表及其 CRUD；公共消息可直接进入 Camp，Task 可引用其来源消息，具体字段留待 DM-07。
- **后续事项**：DM-07/DM-08 已用按需 Task 与可选依赖 DAG 承载结构化工作；DM-05/DM-06 已否决 ProfileVersion 与 AgentInstance。实施时不得重新引入隐藏 TeamRun、根 Task 或运行参与者层。

### DM-03 Camp 成员

- **状态**：已修订
- **Lumen 决策**：以显式 `CampMember` 表达 Agent 与 Camp 的成员关系；暂不引入可复用 `Team`、`TeamMember`。
- **核心问题**：如何让 Agent 动态加入、退出和重新加入 Camp，同时保持权限、路由、Task 分派和 Conversation 连续性一致。

#### 讨论记录

已选择方案 B：

```text
AgentProfile（长期身份）
      │
      ▼
CampMember（当前 Camp 内的成员资格与权限）
      │
      ├── Router 路由资格
      ├── Task 创建与分派资格
      └── Conversation 私有连续性
```

本决策只确认显式 Camp 成员关系，不提前创建可跨 Camp 复用的 Team 聚合。Agent 可用于领域命令的 Capability 使用封闭枚举；增加新 Capability 必须更新 Core 注册表和 Schema，不能接受任意字符串：

```ts
type AgentCapability =
  | 'camp.member.manage'
  | 'camp.default_lead.change'
  | 'task.create'
  | 'task.complete'
  | 'task.cancel'
  | 'task.dependency.manage'
  | 'agent_run.create'
  | 'agent_run.retry'
  | 'agent_run.cancel'
  | 'inbox.send'
  | 'workspace.bind'
  | 'action.request';

type CapabilityOverride = 'allow' | 'deny';

type ActionPermissionEnvelopeSnapshot = {
  schemaVersion: number;
  rules: Array<{
    ruleId: string;
    actionKind: RestrictedActionKind;
    effect: 'allow' | 'ask' | 'deny';
    constraintSchemaVersion: number;
    constraints: JsonObject;
  }>;
  digest: string;
};
```

Capability 只控制 Lumen 领域命令资格；Shell、文件、Git、网络和 MCP 等具体动作的参数范围由独立的 Action Permission Policy 表达。二者不能共用一组模糊字符串。Permission 规则的 `actionKind` 来自 DM-19/DM-20 的封闭注册表，`constraints` 必须由对应 Kind + Schema Version 校验；规范化规则顺序和完整内容进入 Digest，不能接收未经 Schema 验证的任意 JSON。同一动作命中多条规则时按最保守结果合并：`deny > ask > allow`，参数约束取交集；没有匹配规则时默认 deny。当前用户/全局 hard deny 永远位于冻结 Envelope 之外并在动作前重新检查。

最小逻辑结构：

```ts
type CampMember = {
  campId: string;
  agentProfileId: string;
  status: 'active' | 'left';
  capabilityOverrides: Partial<Record<AgentCapability, CapabilityOverride>>;

  leaveRequestedAt: string | null;
  leaveRequestCommandId: string | null;
  pendingDefaultLeadSuccessorAgentId: string | null;

  version: number;
  joinedAt: string;
  leftAt: string | null;
};

// UNIQUE(campId, agentProfileId)
```

成员生命周期采用软退出。`leaveRequestedAt != null` 是仍在编排退出、但尚未提交 `left` 的持久事实：

```text
active → leave requested → left
left → active（重新加入并清空当前退出请求字段）
```

同一 Agent 在同一 Camp 内复用唯一 CampMember 记录，不因退出和重入创建新的成员身份。成员一旦出现 `leaveRequestedAt`，立即停止 Router 路由、新 Task 分派和 queued AgentRun 启动，但在相关 Run 尚未安全终结前仍保持 `status = active`；重新加入后继续使用原 Conversation。成员退出不等于删除 AgentProfile。

成员退出不受未完成 Task 阻止。`LeaveCamp` 第一事务冻结必要的 Default Lead 继任者、写入退出请求字段，并在退出者原为 Lead 时立即把 `defaultLeadAgentId` 切换到该继任者或置空；随后以 `member_left` 原因请求取消该成员在 Camp 内的全部非终态 AgentRun。这样从 `leaveRequestedAt` 生效起，Default Lead 仍始终指向有效活跃成员。CampMember Finalizer 只在这些 Run 已终态、动作已按 DM-20 收敛后，把 CampMember 标记为 `left`。应用重启后只扫描 `leaveRequestedAt != null && status = active` 即可继续，不从 event_log 重放退出。

未完成 Task 保留原 `assigneeAgentId`，并因 `assignee_unavailable` 派生为 blocked；既有 Message、AgentRun、ActionExecution、MessageAttachment、Git Commit 引用和审计记录全部保留。若工作必须由另一 Agent 继续，应取消原 Task，再创建带新 Assignee 的替代 Task，并用 `originTaskId` 关联原 Task，不能原地改写 Assignee。

Agent 的新 Run/路由资格采用“有效活跃成员”而不是只看 CampMember.status：

```text
Camp.status = active
AND CampMember.status = active
AND CampMember.leaveRequestedAt = null
AND AgentProfile.status = active
```

AgentProfile 的默认 Capability 与 Camp 内覆盖按以下规则解析：默认集合先应用 CampMember 的显式 allow/deny，deny 优先；随后再与本次 AgentRun 的能力上限相交并冻结到有效配置快照。CampMember 的 allow 不能绕过用户/全局硬性 Policy。Capability 覆盖只能由用户或拥有 `camp.member.manage` 的 Agent 修改；Agent 不得授予自己或他人其自身不可委派的能力，也不得移除硬性 deny。

Camp 采用唯一 Default Lead：

```text
存在至少一个有效活跃成员 → 必须且只能有一个 Default Lead
不存在有效活跃成员       → Default Lead 为空
```

`defaultLeadAgentId` 保存在 Camp 上，不在多个 CampMember 上维护 `isDefaultLead`。复合外键保证目标 Agent 属于该 Camp，Core 领域校验保证目标是有效活跃成员；SQLite 外键本身无法表达 Profile 状态与退出请求条件。

Default Lead 只是普通未定向消息的默认入口和协调角色，不自动获得 Task 创建、审批或成员管理权限，也不绑定任何原生 Runtime Session。显式 `@Agent`、回复目标、Task 定向入口和显式广播均优先于 Default Lead。

当前 Lead 请求退出、被禁用或归档时，如果 Camp 仍有其他有效活跃成员，必须在写入退出请求或 Profile 状态变化的同一数据库事务中指定继任者；如果已无有效活跃成员，则把 `defaultLeadAgentId` 置空。`LeaveCamp` 在请求阶段冻结并立即应用 `pendingDefaultLeadSuccessorAgentId`；`DisableAgentProfile`/`ArchiveAgentProfile` 必须为该 Profile 担任 Lead 的每个 Camp 提供继任映射，缺少任一必要继任者时整个命令拒绝。临时 Runtime 故障只触发对应 Conversation 恢复，不自动更换 Lead。

创建 Camp 时可以暂时没有成员并令 Lead 为空；加入或重新激活第一个有效成员时，必须在同一事务把该成员设为 Default Lead。加入后已有有效 Lead 时不得隐式更换；必须使用 `ChangeDefaultLead`。归档 Camp 不允许新增/重新激活成员，并按 DM-01 在归档事务清空 Lead。

#### 决策结果

- **决策**：使用显式 `CampMember` 表达 Agent 与 Camp 的成员关系；不建立独立 Team；成员软退出并可恢复原 Conversation；Camp 在有有效活跃成员时保持唯一 Default Lead。
- **理由**：Camp 已是协作边界，显式成员关系足以支持动态加入、退出、路由和授权，不需要再引入可复用 Team 聚合。
- **领域影响**：AgentProfile 表达长期身份，CampMember 表达当前成员资格，Conversation 表达私有连续性；Default Lead 仅是默认消息入口，不等于权限角色。
- **数据/API 影响**：增加 `camp_member` 唯一键、Capability 覆盖、版本和可恢复退出请求字段；Camp 增加可空 `default_lead_agent_id`；增加 CampMember Finalizer 的资格扫描；Profile 禁用/归档命令接受必要的多 Camp Lead 继任映射。
- **后续事项**：实现 ADR 固定 Capability 注册表的物理编码、可委派边界、成员退出扫描索引及 Default Lead 复合外键/领域校验；新增 Capability 视为协议演进，不通过任意字符串动态扩展。

### DM-04 AgentProfile

- **状态**：已修订
- **Lumen 决策**：使用可直接修改的 `AgentProfile` 表达长期稳定身份、角色描述和默认能力，不维护 Profile 版本。
- **核心问题**：如何保持 Agent 身份简单可编辑，同时保证既有运行不受后续 Profile 修改影响。

#### 讨论记录

```ts
type AgentProfile = {
  id: string;

  handle: string;
  displayName: string;
  avatarRef: string | null;

  roleDescription: string;
  instructions: string;
  defaultCapabilities: AgentCapability[];

  defaultProvider: string | null;
  defaultModel: string | null;

  status: 'active' | 'disabled' | 'archived';

  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};
```

属于 AgentProfile：稳定 ID、名称、头像、`@handle`、长期角色描述、默认行为指令、默认能力、默认 Provider/模型偏好，以及长期启用、禁用和归档状态。

不属于 AgentProfile：Camp 内 Default Lead 和实际权限、当前 Task 或协作职责、在线或错误状态、Conversation 与原生 Session、当前实际模型/工具/权限，以及 Token、重试和运行错误。

实际运行配置按以下顺序解析：

```text
AgentProfile 默认身份、Provider、模型与 Capability
→ CampMember Capability allow/deny
→ Conversation Provider/模型/动作权限覆盖
→ Task / AgentRun 能力与动作权限上限
→ 不可变有效配置快照

Approval 在上述上限内决定单个动作是否获准，
不反向修改 AgentRun 的配置快照
```

每次 AgentRun 必须保存不可变的有效配置快照，至少包括：

```ts
type EffectiveAgentConfigSnapshot = {
  agentProfileId: string;
  agentProfileVersion: number;
  campMemberVersion: number;
  conversationVersion: number;
  roleDescription: string;
  instructions: string;
  runtimeAdapter: string;
  provider: string;
  model: string;
  capabilities: AgentCapability[];
  tools: string[];
  actionPermissionEnvelope: ActionPermissionEnvelopeSnapshot;
  configDigest: string;
};
```

`capabilities` 是领域命令授权的唯一冻结真源；`actionPermissionEnvelope` 是受限动作参数范围的冻结上限。AgentRun 不再重复保存另一个 `capabilityEnvelope`。三个来源版本与规范化 `configDigest` 用于解释快照来源；真正执行与回放始终读取快照内的完整值，不反查当前 Profile/Member/Conversation。

该快照是 AgentRun 的运行证据，不是 `AgentProfileVersion`。Profile/CampMember 后续修改不能原地改写任何已经创建的 queued、running、waiting 或终态 AgentRun；快照不可变不等于 queued Run 永远获准启动。Scheduler 在启动前仍须确认当前 Profile/Member 授权没有撤销该快照中的能力或动作范围，撤权后的 queued Run 保持 blocked，需取消并按新配置创建 Run。更宽松的新授权也不会自动扩张旧快照。已经 running/waiting 的 Run 继续使用原快照；若需立即撤权，必须显式取消该 Run，当前 hard-deny Policy 仍可在每个具体动作前阻断。若 Provider 无法在既有原生 Session 中安全应用后续 Run 的新配置，后续创建的 AgentRun 必须通过 Conversation 恢复机制换绑 Session。

`nativeSessionId` 和 `nativeRunId` 不属于不可变配置快照。一个 AgentRun 可以跨 Native Session，并包含多次原生模型请求；Conversation 保存当前 Session 绑定，每次绑定、换绑和原生请求 ID 作为带 `executionEpoch` 的执行事件记录。AgentRun 上即使保留“当前/最近 Native ID”查询字段，也不能把它们当作完整审计事实源。

AgentProfile 可以直接修改，但所有创建、修改、禁用、启用和归档命令仍须经过 Rust Core 授权并留下审计事件。Agent 不能通过修改本地配置静默改变自己的身份、指令或默认能力。

Agent 可加入多个 Camp，并在各 Camp 通过 CampMember 获得不同实际权限。禁用或归档后不得创建新的 AgentRun，也不得把既有 queued Run 启动为 running；已经 running/waiting 的 Run 继续遵循创建时冻结的配置，Profile 状态变化不静默终止它们。归档不删除历史 CampMember、Conversation、Message、Task 或 AgentRun。Default Lead 继任与有效活跃成员判断沿用 DM-03；未完成 Task 保留原 Assignee 并变为 `assignee_unavailable`，不得重新分派。

#### 决策结果

- **决策**：AgentProfile 保存长期身份、角色说明和默认运行配置，并允许直接修改；不通过版本实体管理变化。
- **理由**：保持本地个人 Agent 管理简单直观，同时用 AgentRun 有效配置快照满足运行隔离与历史审计。
- **领域影响**：Agent 身份不随改名、模型切换或 Session 重建改变；Default Lead、Assignee、审查参与行为、运行状态和实际权限仍是其他上下文的关系或运行事实。
- **数据/API 影响**：AgentProfile 增加乐观版本；统一以 `agent_profile_id` 供 CampMember、Camp Default Lead、Conversation 和 Task 引用；AgentRun 通过 Conversation 确定逻辑身份，并只在 `effectiveConfig` 中保存最终 Capability/动作权限快照；Disable/Archive 命令携带必要的多 Camp Lead 继任映射。
- **后续事项**：实现 ADR 定义 Profile 状态转换与用户/管理权限；长期记忆与成长画像另行讨论。Capability 枚举和覆盖语义以 DM-03 为准，不再作为未决项。

### DM-05 AgentProfileVersion

- **状态**：已否决
- **Lumen 决策**：v0.02 不引入 `AgentProfileVersion`、发布流程或 Profile 历史版本链。
- **核心问题**：不通过 Profile 版本化，如何保证修改不会污染已经开始的运行和历史审计。

#### 讨论记录

AgentProfile 作为当前长期身份与默认配置直接修改。运行隔离由 AgentRun 的 `EffectiveAgentConfigSnapshot` 保证：创建 AgentRun 时解析并冻结当次实际指令、能力、Provider、模型、工具和权限上限。queued Run 后续开始执行以及历史 Run 回放都读取自己的快照，而不是反查 AgentProfile 当前值。

Profile 更新仍写审计事件，但审计事件不构成可选择、发布或回滚的 ProfileVersion。未来只有在出现跨运行配置回滚、灰度发布或可重复实验的实际需求时，才重新评估版本实体。

#### 决策结果

- **决策**：不建立 `agent_profile_version` 表或领域实体。
- **理由**：当前可编辑 Profile 加运行快照已经覆盖身份管理与审计需求，额外版本发布机制会增加不必要的生命周期复杂度。
- **领域影响**：Profile 表示当前默认值；AgentRun 有效配置快照才是某次执行的事实来源。
- **数据/API 影响**：不增加 ProfileVersion 外键和 CRUD；AgentRun 或 ContextManifest 必须持久化完整有效配置，而不能只保存 AgentProfile ID。
- **后续事项**：当需要配置回滚、A/B 实验、跨 Camp 固定版本或自动成长发布时重新评估，不能用可变 Profile 反推历史运行配置。

### DM-06 AgentInstance

- **状态**：已否决
- **Lumen 决策**：v0.02 不建立独立 `AgentInstance`；现有对象已经完整覆盖身份、成员资格、连续性和实际执行。
- **核心问题**：在 `AgentProfile + CampMember + Conversation + AgentRun` 已经分层后，是否还存在需要独立运行参与者身份承载的事实。

#### 讨论记录

采用以下边界：

```text
AgentProfile   Agent 是谁
CampMember     Agent 是否属于 Camp，以及在 Camp 中拥有哪些权限
Conversation  该 Agent 在该 Camp 中的长期逻辑连续性
Task          系统接受的工作承诺，以及创建时绑定的固定 Assignee
AgentRun      Agent 的 Conversation 在某个 CampTurn 中的一次实际执行
Native Session
              Runtime 提供的可替换外部句柄
```

`CampMember` 表达长期参与资格，`Conversation` 表达长期私有连续性，二者职责不同。由于每个 `(camp_id, agent_profile_id)` 只有一个 Conversation，同一个 AgentProfile 在同一个 Camp 中不允许出现多个并行“化身”，因此不需要再插入 AgentInstance 层。

AgentRun 以 `conversation_id` 作为必选身份归属，并可选关联 `task_id`。按照 DM-04，执行时的 `agentProfileId` 必须冻结在 AgentRun 的不可变有效配置快照中；它是审计快照，不是另一条可独立修改、可能与 Conversation 冲突的参与者关系。

v0.02 每个 Conversation 同时最多有一个持有执行锁的 AgentRun，以保证私有历史、公共消息消费游标和当前 Native Session 的顺序一致。`running` 与 `waiting` 持有执行锁；尚未开始且不改写 Conversation 的 `queued` AgentRun 可以有多个并按序等待。多 Agent 并行来自不同 Conversation；同一 AgentProfile 可以在不同 Camp 的不同 Conversation 中并行执行。

Native Session 始终只是 Conversation 当前可替换的 Runtime 句柄。Session 换绑、进程重启或模型切换不会创建 AgentInstance，也不会改变 AgentProfile、CampMember 或 Conversation 身份。

#### 决策结果

- **决策**：不建立 `AgentInstance` 领域实体、数据表或 API。
- **理由**：CampMember、Conversation 和 AgentRun 已分别覆盖成员资格、长期连续性和一次执行；AgentInstance 不再承载独有事实，只会增加外键与生命周期同步成本。
- **领域影响**：Conversation 是 AgentProfile 在一个 Camp 内唯一的长期执行入口；AgentRun 是唯一的一次执行身份；并发按 Conversation 隔离。
- **数据/API 影响**：AgentRun 必须引用 `conversation_id`，`task_id` 可空；调度层对每个 Conversation 强制最多一个 `running/waiting` AgentRun，并允许多个 `queued` AgentRun 等待；不增加 `agent_instance_id`。
- **后续事项**：只有出现“同一 AgentProfile 在同一 Camp 内需要多个隔离化身”或分布式 Worker 身份时，才重新评估 AgentInstance。

### DM-07 Task

- **状态**：已修订
- **Lumen 决策**：Task 是 Camp 内按需创建的扁平结构化工作对象；不建立 Task 树、根 Task 或 TaskProposal。
- **核心问题**：在不牺牲 Camp 自然对话的前提下，为确需跟踪、绑定责任人、执行和验收的工作提供最小生命周期。

#### 讨论记录

Task 不等于一条消息，也不是每段对话的强制容器。普通聊天、咨询、分析和无需结构化跟踪的只读交互不创建 Task；只有工作需要修改或其他持久副作用，或者需要明确责任人、依赖、重试、审批、Review、验收时才创建。

创建规则：

1. 用户可以明确创建 Task。
2. 用户提出工作请求后，由被唤醒且拥有 `task.create` 权限的 Agent 根据实际工作决定是否创建；若需要持久副作用，必须在首次副作用前创建。
3. 无 `task.create` 权限的 Agent 只能在 Camp 公共消息中建议创建，不引入 `TaskProposal` 实体。
4. Rust Core 校验创建者权限、Camp 范围、字段和 `dedupKey`，并负责幂等持久化；`AgentRuntimeAdapter` 不能创建 Task。
5. 系统仅可在迁移或恢复补偿中创建，并必须记录来源事件。

Router 只负责把 Camp 消息投递给合适的 Agent，不是 Task 的业务决策者，也不作为 `Task.createdBy`；真正发出创建命令的 User/Agent/System Actor 才是创建者。

Task 最小逻辑结构：

```ts
type Task = {
  id: string;
  campId: string;

  title: string;
  objective: string;
  acceptanceCriteria: Array<{ id: string; text: string }>;

  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  assigneeAgentId: string;

  sourceMessageId: string | null;
  originTaskId: string | null;
  createdBy: ActorRef; // 正式定义见 DM-17；所有变体都具有稳定非空身份
  dedupKey: string | null;

  cancelRequestedAt: string | null;
  cancelRequestCommandId: string | null;
  version: number;

  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  archivedAt: string | null;
};
```

`dedupKey` 非空时建立 `UNIQUE(camp_id, dedup_key)`，用于阻止同一来源工作因 Agent/Router 恢复使用新 commandId 而重复建 Task；它不能替代 DM-21 的命令幂等。`sourceMessageId` 如非空必须引用同 Camp 的 CampMessage。`originTaskId` 如非空必须引用同 Camp 的另一 Task，禁止自引用或形成来源环，但不产生父子汇总、状态传播或取消级联。

每个 Acceptance Criterion 的 `id` 必须在 Task 内唯一、创建后不可修改且不得复用；条件文本如被允许修改，必须递增 Task `version`。完成证据始终按 `criterionId` 绑定，不依赖数组位置，也不重复保存条件文本。一个 Criterion 可以关联一个或多个证据引用；引用的不可变性、完整性和可见性规则由 DM-18 定义。

Task 采用四态生命周期：

```text
创建 → pending
pending → in_progress
pending/in_progress → completed
pending/in_progress → cancelled
```

`completed` 与 `cancelled` 都是终态，不支持 reopen。追加修改创建新 Task，并以 `originTaskId` 指向旧 Task。`archivedAt` 只控制展示，不属于状态，但只能对终态 Task 设置；不能把仍在运行、等待或取消编排中的 Task 隐藏为“已归档”。正常 UI 不硬删除 Task。

`pending → in_progress` 不增加 `StartTask` 命令。首个关联该 Task 且满足全部启动门的 AgentRun 在 `queued → running` 时，Core 在同一事务把仍为 `pending` 的 Task 改为 `in_progress`；如果 Task 已为 `in_progress` 则保持不变。没有 AgentRun 的 Task 允许由 `pending` 直接完成或取消。Task 进入终态或出现 `cancelRequestedAt` 后不得再创建/启动关联 AgentRun。

`blocked` 不是 TaskStatus。Task Readiness 只根据依赖、Assignee 可用性、取消编排和 Task 范围内的未知副作用等会阻止任何新执行的事实派生；输入投递、Approval、用户输入、既有 Run 和 Workspace 可用性属于特定 AgentRun 的活动条件，单独聚合给 UI。自由文本审查消息不会产生 blocker；终态 Task 的 Readiness 为 `null`。v0.02 不因 Workspace 冲突派生 blocker，也不提供写目录锁。

```ts
type TaskReadinessBlockerCode =
  | 'assignee_unavailable'
  | 'dependency_not_completed'
  | 'dependency_cancelled'
  | 'unknown_action_outcome'
  | 'cancellation_in_progress';

type TaskActivityConditionCode =
  | 'input_delivery_pending'
  | 'approval_pending'
  | 'user_input_required'
  | 'agent_run_active'
  | 'workspace_unavailable';

type TaskReadModel = {
  task: Task;
  readiness: 'ready' | 'blocked' | null;
  readinessBlockers: Array<{
    code: TaskReadinessBlockerCode;
    source: EntityReference | null;
  }>;
  activityConditions: Array<{
    code: TaskActivityConditionCode;
    source: EntityReference;
  }>;
  unresolvedEffects: EntityReference<'action_execution'>[];
};
```

`readinessBlockers` 只包含会阻止任何新的 Task 关联执行开始的 Task 级事实；Scheduler 只使用这一组事实。`activityConditions` 是 UI 对既有 AgentRun 局部等待/活动的聚合，不得因为某个 Run 正在执行、等待 Approval 或尚未收到输入，就阻止另一个 Conversation 为同一 Task 并行启动独立职责。`unresolvedEffects` 与 Readiness 分离：终态 Task 的 readiness 仍为 null，但被用户放弃主动对账的 unknown ActionExecution 必须继续显示，不能因 Task 取消而隐藏；非终态 Task 存在 unknown ActionExecution 时仍由 `unknown_action_outcome` 阻止新增执行与完成。

每个 Task 必须在创建时绑定且只绑定一个 Assignee，引用稳定 `AgentProfile`。Core 必须确认该 Agent 是当前 Camp 的有效活跃成员且存在可用 Conversation；`assigneeAgentId` 创建后不可变，不提供清空或重新分派命令。Reviewer、Consultant 或受邀协作者不因此成为 Assignee，但可以通过关联同一 `taskId` 的 AgentRun 贡献分析、实现或审查。需要由另一 Agent 接管剩余工作的，应取消原 Task 并创建带新 Assignee 的替代 Task，以 `originTaskId` 关联；需要独立进度、依赖或验收的并行工作仍应拆成多个 Task。

Assignee 后续退出 Camp、被禁用或归档时，Task 保留原绑定并派生 `assignee_unavailable` blocker，不修改 Assignee。原 Agent 恢复可用后可以继续；否则只能取消并创建替代 Task。

只有 Rust Core 能提交 `completed`。完成门至少要求：Task 未处于取消编排、固定 Assignee 仍是有效活跃成员、依赖已满足、没有关联的非终态 AgentRun，也没有仍对该 Task 开放 Retry/Decline 选择的必需职责，没有未决审批或任何 unknown 副作用、每条验收条件至少绑定一条持久证据，并由用户或具备 `task.complete` Capability 的 Agent 显式请求完成。Core 校验证据覆盖是否完整、引用是否有效；请求者对“这些证据在语义上满足自然语言 Criterion”作显式受审计声明，Core 不自行理解正文。Agent 自述“完成”“通过”或“LGTM”不会自动改变状态，只有进入合法 `CompleteTask` 命令的 Criterion—Evidence 绑定后才参与验收。Assignee 不可用时不允许由其他 Agent 绕过该 blocker 关闭原 Task；只能等待其恢复，或取消后创建绑定新 Assignee 的替代 Task。CampTurn 可以同时承载多个 Task，因此其他 Task 的 Run 或 CampTurn 尚未终态本身不阻止当前 Task 完成。

`CancelTask` 在没有非终态 Run、pending Approval、prepared/executing 动作或 active unknown 时可以立即提交 `cancelled`。否则第一事务只写入 `cancelRequestedAt + cancelRequestCommandId`，停止创建新 Run/动作，并以 `task_cancelled` 原因请求停止关联的非终态 Run；关联的 pending Approval 必须按父级取消规则收敛，尚未派发的动作转为 not_executed。Task Cancellation Finalizer 从这些权威事实恢复推进；全部相关 Run 已终态、Approval 已解决、prepared/executing 动作已收敛且不存在 active unknown 后，Finalizer 提交 `cancelled`。每次写入 Task 取消请求或最终取消状态的事务，都要同时重算受影响 CampTurn；未能当场终结的 CampTurn 由 DM-22 Aggregation Finalizer 从 Task/Run 当前事实恢复。Task 一旦取消，关联该 Task 的职责不再提供 Retry/Rework 入口；CampTurn 按 DM-12 把“当前职责关联 Task 已取消”作为持久聚合依据，即使该职责的 Run 在取消前已经 failed，也不会留下 `waiting(retry_decision)`。`unknown(abandoned)` 不阻止取消，但继续出现在 `unresolvedEffects`；它永远阻止 `completed`。

需要 Agent 执行但不需要结构化 Task 的交互仍会产生 CampTurn 和 AgentRun，因此 `taskId` 必须可空；纯记录型消息则不会产生二者。具体物理关系见 DM-09、DM-12。

#### 决策结果

- **决策**：采用 Camp 内按需创建的扁平 Task；不引入 TaskProposal；Task 为四态、创建时绑定唯一且不可变的 Assignee、无 reopen，Readiness 单独派生。
- **理由**：让自然对话保持无负担，同时为真正需要协调和验收的工作建立可恢复、可审计的承诺边界。
- **领域影响**：Camp 没有完成状态；Task 承担可选工作承诺但不成为隐藏的 TeamRun；Agent 决定何时需要 Task，Core 掌握持久化与状态转换权。
- **数据/API 影响**：新 Task 直接引用 `camp_id`；`assignee_agent_id` 非空且创建后禁止修改；创建者使用稳定 ActorRef；增加来源、幂等键、取消请求、乐观版本和归档字段；首个 Run 启动与 Task `in_progress` 原子提交；AgentRun 必属 CampTurn 与 Conversation，并可选关联 Task。
- **后续事项**：DM-16 已确认不建立 Review 物理模型；DM-21/DM-22 已分别落实命令幂等审计、完成门事务与状态驱动的可靠副作用推进；实现 ADR 落实 Task 与 CampTurn/AgentRun 的索引。

### DM-08 TaskDependency

- **状态**：已修订
- **Lumen 决策**：采用可选 `TaskDependency` DAG，只表达同一 Camp 内的硬执行前置关系。
- **核心问题**：如何在不引入 Task 树和工作流引擎的情况下，可靠阻止前置条件尚未满足的 Task 执行。

#### 讨论记录

```ts
type TaskDependency = {
  taskId: string;
  dependsOnTaskId: string;
};
```

大多数 Task 没有依赖；只有确有硬执行前置时才建立记录。依赖两端必须属于同一 Camp，组合键唯一，禁止自依赖，由 Core 在同一事务中执行环检测。

依赖不形成父子层级，不负责根 Task 汇总，也不表达 Review、责任归属或普通因果关系。`originTaskId` 只用于追溯追加工作的来源，不参与依赖判定。

依赖只能在下游 Task 仍为 `pending` 且尚未请求取消时增加或移除。Add/Remove 命令必须携带下游 Task 的版本前置条件，并在关系变化的同一事务递增该 Task `version`；`TaskDependency` 本身不再维护第二个乐观版本。pending Task 可以已经拥有 queued AgentRun；增加依赖后这些 Run 继续排队，但 Scheduler 必须在每次认领时重新检查 TaskReadiness，依赖满足前不得 `queued → running`。全部前置 Task 完成只解除下游阻塞，不会自动启动或完成下游 Task。前置 Task 取消会让下游保持 `blocked`，但不自动取消；用户或有权限的 Agent 必须显式修改依赖、取消或替换相关 Task。

复杂工作需要整体取消时，系统可以根据 `sourceMessageId`、`originTaskId` 和依赖图给出候选集合，但必须明确展示并一次确认；Core 可以在同一事务中为候选 Task 分别写入幂等取消请求，但不能把仍有运行或未知副作用的 Task 直接写成 `cancelled`。各 Task 随后按 DM-07/DM-17 的可恢复取消编排独立收敛，不采用隐式级联。

Readiness 是查询投影，不持久成 TaskStatus：

```text
pending + ready       可以开始
pending + blocked     前置条件尚未满足
in_progress + ready   可以继续或重试
in_progress + blocked 当前无法继续
completed/cancelled   readiness = null
```

#### 决策结果

- **决策**：使用独立、可选、单类型的 `TaskDependency(task_id, depends_on_task_id)` 表达硬前置 DAG。
- **理由**：扁平 Task 覆盖常态，只有真实执行约束才付出依赖图复杂度，且不会退化成 Task 树或通用工作流引擎。
- **领域影响**：TaskStatus 只表达自身生命周期；依赖与其他阻塞事实共同派生 Readiness；依赖不自动传播完成或取消。
- **数据/API 影响**：增加组合唯一键、同 Camp 校验、自依赖/环检测，以及仅允许 pending 下游修改依赖的 Core 命令。
- **后续事项**：在实现 ADR 中定义环检测事务、Readiness 查询和批量取消命令；性能证明需要前不增加闭包表或专用图数据库。

### DM-09 AgentRun

- **状态**：已修订
- **Lumen 决策**：AgentRun 是某个 Conversation 为履行 CampTurn 中一项不可变执行职责而创建的一次持久、可恢复、终态不可逆的逻辑执行生命周期。
- **核心问题**：如何在允许多次模型请求、安全自动重试、审批等待和进程恢复的同时，保持职责、执行身份、副作用和终态可审计。

#### 讨论记录

AgentRun 不是一次 HTTP 请求、模型 Completion、工具调用、操作系统进程、Native Session 或整个 Task。它可以包含多次模型请求、多次工具调用、安全自动重试、审批与用户输入等待、应用重启恢复、Runtime 进程重启，以及 Native Session 换绑。

只有系统确实准备调度某个 Agent 执行时才创建 AgentRun。如果一次触发路由给多个 Agent，则在同一个 CampTurn 下为每个目标 Conversation 分别创建 AgentRun；最终回复、流式片段、状态和错误只关联既有 AgentRun。

```text
CampTurn
├── responsibility: plan
│   └── AgentRun → Conversation（洛可）
├── responsibility: implement
│   └── AgentRun → Conversation（沐瓦）
└── responsibility: review
    └── AgentRun → Conversation（眠枝）
```

##### 执行职责与继任链

`purpose` 自由文本不能充当职责身份。每项职责必须在 CampTurn 内拥有稳定的 `responsibilityKey`；同一非终态 CampTurn 内的重试和返工 Run 沿用该 key。跨 CampTurn 的再次执行是新 CampTurn 的初始职责，只通过触发消息/correlation 关联历史。v0.02 不为职责增加独立实体或数据表，而是在 AgentRun 上保存不可变职责字段。

```ts
type AgentRunStartReason =
  | 'initial'
  | 'retry'
  | 'rework';

type AgentRunCompletionRole = 'required' | 'optional';
```

每个职责的 AgentRun 形成单向、无分叉的继任链：

```text
Run A failed
  → Run B retry, predecessor = A
  → Run C rework, predecessor = B
```

`responsibilityGeneration` 从 0 开始并在创建后继 Run 时递增。前驱必须属于同一仍非终态的 CampTurn、Conversation 与 `responsibilityKey`，后继 generation 必须等于前驱加一。Core 必须保证同一职责同一 generation 唯一、每个 Run 最多一个直接后继，并且只有前一 Run 进入终态后才能创建后继。失败 Run 的人工 Retry 还要求 `manualRetryAllowed = true` 且 `retryDeclinedAt = null`；Rework 还要求 CampTurn 非终态，并在 `taskId` 非空时要求关联 Task 也非终态。CampTurn 聚合时查看每个 `responsibilityKey` 当前没有后继的有效 Run，而不是被历史失败永久污染。v0.02 不允许把既有职责的后继 Run 改绑给另一 Conversation/Agent，也不允许跨 CampTurn 建立 predecessor 链。

`completionRole` 是职责属性。由于 v0.02 不建立 Responsibility 实体，它被复制到每代 Run 并由 Core 保证不可改变。真正需要脱离当前因果过程长期运行的后台工作必须创建新的 CampTurn 或 Task，不能作为已结束 CampTurn 下的活跃子 Run。

##### 同一个 AgentRun 的边界

AgentRun 的逻辑身份由以下内容共同确定：

```text
campTurnId
+ conversationId
+ responsibilityKey
+ immutable execution contract
```

不可变执行契约至少包括执行目的、预期输出、Task 引用、能力/权限上限和 Completion Role。`agentProfileId` 由 Conversation 唯一确定，并冻结在有效配置快照中，不作为另一条可单独修改的执行身份。

以下情况延续原 AgentRun：

- 在既定能力/权限上限内等待某个已准备受限动作的 Approval。
- 等待与当前职责相关的用户补充信息。
- 应用重启、Runtime 进程重启和 Native Session 失效换绑。
- Provider 限流、连接失败、明确安全重放的临时错误。
- 尚未产生未知或不可逆副作用时的输出校验与自动修正。
- 其他不改变执行契约的临时运行资源等待。
- Agent 内部调用普通模型或工具；若明确请求另一个 Lumen Agent 执行，则创建另一个 AgentRun。

以下情况必须创建新 AgentRun；它是“同 CampTurn 后继”还是“新 CampTurn 初始 Run”由当前 CampTurn/Task 是否仍可接收执行决定：

- 原 Run 已进入 `succeeded`、`failed` 或 `cancelled` 后再次执行。
- 同一 Conversation/Agent 对终态 Run 进行人工重试或返工；只有原 CampTurn 仍非终态时才能成为 predecessor 后继，否则创建新 CampTurn 的 `initial` Run，并通过触发消息/correlation 追溯旧 Run。
- CampTurn、Task、`responsibilityKey`、执行目的或预期输出发生实质变化。
- Provider、模型、Instructions、工具集合或权限上限发生实质变化。
- 原 Run 被取消后又决定继续。

更换 Conversation/Agent 不属于后继 Run，而是新的独立职责。若它意味着另一个 Agent 接管未完成 Task，则 v0.02 不支持该操作；必须取消原 Task，并创建绑定新 Assignee 的替代 Task。

终态 Task 不得再关联新的 AgentRun。Review 或其他反馈发生在 Task 完成后时，继续工作必须创建以旧 Task 为 `originTaskId` 的新 Task；如果原 Task 尚为 `pending/in_progress` 但原 CampTurn 已终态，则为同一 Task 创建新的 CampTurn，而不是伪造跨 CampTurn 后继。

Approval 结果不等于修改权限上限：在既定上限内批准某个待执行动作仍属于原 Run；请求超出原契约的新权限范围必须创建新 Run。

一个 AgentRun 可以同时存在多个待审批动作。权威 blocker 来自仍为 `pending` 的 Approval 和其他未解除事实；`waitReason = 'approval'` 只是 AgentRun 当前主要等待原因的摘要。解决一条 Approval 后，Core 必须重新聚合全部 blocker：只有不再存在其他等待条件时才允许 `waiting → running`，不能因单条审批结束而无条件恢复 Run。需要返回 Runtime 的每条审批/动作结果由 ActionExecution 上带 `actionId`、payload Digest 与目标 epoch 的窄化投递 Checkpoint 分别确认，避免把多个并行动作的结果混在一起。

##### 最小状态机

```ts
type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

type AgentRunWaitReason =
  | 'approval'
  | 'user_input'
  | 'retry_backoff'
  | 'runtime_recovery'
  | 'native_session_rebind'
  | 'runtime_delivery'
  | 'workspace_unavailable'
  | 'unknown_action_outcome';

type AgentRunCancelReason =
  | 'user_requested'
  | 'camp_turn_cancelled'
  | 'task_cancelled'
  | 'member_left'
  | 'retry_declined'
  | 'policy';
```

合法转换：

```text
queued  → running | failed | cancelled
running → waiting | succeeded | failed | cancelled
waiting → running | failed | cancelled

succeeded / failed / cancelled → 无出向转换
```

`recovering`、`retrying` 和 `interrupted` 不作为顶层状态，以等待原因和事件表达。创建时已知 Task 依赖未满足时不应创建 AgentRun；若 queued 后新增依赖，Run 保持 queued 并由启动资格阻止，因此 `dependency` 仍不是 AgentRunWaitReason。终态不可逆指 `status`、执行结果、执行契约和错误事实不可修改；允许在失败后追加一次性的协调元数据 `retryDeclinedAt`，但它不改变原执行结果。

只有 Rust Core 能提交状态转换。AgentRun 的 `succeeded` 只表示本次执行契约已结束、必要输出已持久化，且不存在未决 Approval、仍需执行的 prepared/executing/unknown 动作或未终结的 Runtime Delivery Checkpoint；成功 Run 的投递必须 ACK，只有正在收敛为 failed/cancelled 的 Run 才能使用下文严格限定的无 ACK 安全关闭。不代表 Task 已验收、任何审查意见已被接受或 CampTurn 必然完成。Agent 自述“完成”不能直接提交状态。

取消首先记录 `cancelRequestedAt + cancelReasonCode` 并停止新动作。`AgentRuntimeAdapter` 以 `agentRunId + executionEpoch` 幂等请求中断；只有确认对应 Runtime 已停止或失去继续写入资格后，Core 才能写入一次性的 `cancelAcknowledgedAt`。如果 Adapter 无法提供显式 ACK，Core 必须先终止进程/解绑 Native Session、释放执行租约并递增 fencing epoch，以这些可验证事实确认旧 Runtime 不会继续回写。

`cancelRequestedAt` 一旦写入不得清空。此后普通 Runtime success/failure 回调只能作为停止过程中的观察，不能再把 Run 提交为 `succeeded/failed`；在停止、动作对账和 Delivery 终结门通过后，Run 统一进入 `cancelled`。Decline 路径中原本已经 `failed` 的职责 Run 不会被取消请求改写，只有其他仍非终态 Run 按 `retry_declined` 收敛为 cancelled。

若仍有在途或结果未知的动作，AgentRun 即使已经 `cancelAcknowledgedAt != null`，仍必须保持 `waiting(unknown_action_outcome)`，待对账后才能进入终态；不能用 `cancelled` 掩盖未知结果。DM-20 允许用户显式放弃继续对账，但 ActionExecution 仍保持 `unknown`：此时 Run 只能收敛为 `failed/cancelled`，不能 `succeeded`，相关 Task 继续保留 `unknown_action_outcome` blocker。父 Run 已确定将进入 failed/cancelled、且目标 Runtime epoch 已被不可逆 fencing 后，Core 可按 DM-20 安全关闭指向该旧执行上下文的未 ACK Delivery；该关闭只终结投递义务，不证明 allow 未被接收，也不改变 Action 的 unknown/结果事实。

##### 自动重试与终态后继

Runtime 临时失败后的安全自动重试属于原 AgentRun，通过 `automaticRetryCount` 和追加事件记录，不建立 `AgentRunAttempt` 表。允许自动重试的前提是 Core 能证明请求未发生，或副作用具有可靠幂等键且可安全重放。

以下情况不得自动重试：

- 工具、文件、命令、Git 或外部 API 的执行结果未知。
- Provider 表示请求可能已经被处理。
- 已经提交不可撤回的公共输出；仅存在未提交的传输流片段不在此列。
- Approval 被拒绝或用户明确取消。

副作用未知时进入 `waiting(unknown_action_outcome)` 并先对账。自动重试耗尽或确认不可恢复后进入 `failed`。进入 `failed` 时，Core 必须根据已经确认的错误分类冻结 `manualRetryAllowed`，不能在后续读取时按可能变化的策略重新推导。终态后的人工重试或返工始终创建新的 AgentRun；只有原 CampTurn 仍非终态时，它才作为同一 Conversation/`responsibilityKey` 的后继递增 generation。原 CampTurn 已终态时，创建新 CampTurn 的 initial Run，不设置 `predecessorAgentRunId`。原 Run 的终态执行事实永不改写。

`DeclineAgentRunRetry` 只适用于当前必需职责的失败 Run，要求 `manualRetryAllowed = true`、尚无后继、`retryDeclinedAt = null`，且原 CampTurn 仍非终态；若 Run 关联 Task，该 Task 也必须仍为 `pending/in_progress` 且未请求取消。命令以该 Run 的 `expectedVersion` 参与乐观并发校验，在同一事务中将 `retryDeclinedAt` 从 `null` 设置一次、递增 `version` 并追加 `agent_run.retry_declined` 事件。设置后不得清空，也不得再为该 Run 创建任何后继。Actor 和 Reason 进入命令记录与 `event_log`，不回填到执行结果字段。

`RetryAgentRun` 与 `DeclineAgentRunRetry` 必须原子互斥：二者都要在写事务内重新检查当前有效 Run、版本、后继与 `retryDeclinedAt`。Retry 原子创建唯一后继；Decline 原子写入拒绝重试事实。SQLite 的单写者行为不能代替这些领域校验和唯一约束。

##### 启动资格

`status = queued` 不是完整的可执行资格。Scheduler 每次认领都必须在同一个 SQLite 写事务中重新计算：

```ts
type AgentRunStartEligibility = {
  eligible: boolean;
  blockers: Array<
    | 'cancel_requested'
    | 'conversation_busy'
    | 'agent_unavailable'
    | 'authorization_revoked'
    | 'task_not_executable'
    | 'task_dependency_blocked'
    | 'input_not_ready'
    | 'workspace_not_bound'
    | 'runtime_config_invalid'
  >;
};
```

只有同时满足以下条件才能 `queued → running`：

1. Run 仍为 queued 且 `cancelRequestedAt = null`。
2. Conversation 没有 running/waiting Run 持有执行锁。
3. 对应 CampMember 仍是 DM-03 定义的有效活跃成员。
4. 关联 Task（如有）仍为 `pending/in_progress`、未请求取消且 Readiness 为 ready。
5. `inputReadyAt != null`，初始上下文水位与触发输入已经持久化；若来源是执行型 InboxMessage，其 `deliveredAt/recipientMessageId` 必须与本 Run 的 `triggerConversationMessageId` 一致。
6. 有文件/Git 能力的 Run 已绑定不可变 Workspace，纯对话 Run 明确允许 `workspace = null`。
7. 当前 AgentProfile/CampMember 授权重新解析后仍覆盖快照中的 Capability 与动作权限范围；撤权阻止启动，更宽松的变化不能静默扩大快照。Profile 的名称、Instructions、Provider 或模型偏好变化本身不改写旧快照。
8. 冻结的 Runtime 配置仍可由声明能力相符的 Adapter 执行；当前 hard-deny 安全规则仍可阻止启动。

认领事务必须同时取得执行租约、递增 `executionEpoch` 并写入 running；若关联 Task 仍为 pending，同时提交 `Task → in_progress`。任何条件失败都保持 queued 并在读取模型显示 blocker；不能先启动 Runtime 再补做这些检查。

##### Conversation 锁与恢复 fencing

同一 Conversation 同时最多一个 `running` 或 `waiting` AgentRun 持有执行锁。多个 `queued` AgentRun 可以持久化排队，但不得启动或改写 Conversation；相关用户回复通过 correlation 恢复正在等待的 AgentRun，非相关新请求形成新的 queued Run。

SQLite 应用部分唯一索引兜底：

```text
UNIQUE(conversation_id) WHERE status IN ('running', 'waiting')
```

从 queued 认领为 running 必须与执行租约写入处于同一事务。

`waiting` 保留逻辑执行锁，因此 UI 必须显示等待原因、排队请求及继续/取消入口；可配置 `waitDeadlineAt`，但不得通过静默超时掩盖未知副作用。

SQLite `version` 只能提供乐观并发控制，不能阻止崩溃前的旧 Runtime 继续回写。每次 Core 将 Run 交给 Runtime 执行或恢复时必须取得带 fencing 的执行租约并递增 `executionEpoch`；所有 Runtime 回调、Native 输出和副作用回执都必须携带对应 epoch，旧 epoch 一律拒绝。

应用启动恢复规则：

```text
queued
  → 保持 queued，重新参与调度

cancelRequestedAt != null AND cancelAcknowledgedAt = null
  → 重新尝试中断当前 epoch 的 Runtime
  → 确认停止后持久化 cancelAcknowledgedAt

waiting
  → 保留原等待原因、correlation 和执行锁
  → Runtime 失联只追加恢复事实，不覆盖主要 blocker

running
  → waiting(runtime_recovery)
  → fencing 旧 Host Instance，核对 Approval、ActionExecution、Runtime Delivery 和工具日志
  → unknown 副作用先完成对账；未证明安全前不得重放模型或工具动作
  → 确认可安全继续后重新取得执行租约并递增 executionEpoch
  → Resume 当前 Native Session；失败时事务换绑新 Session
  → 重新聚合全部 blocker，进入 running、继续 waiting 或收敛终态
```

无论 Run 原先是 `running` 还是已经 `waiting`，Runtime 恢复都必须先完成动作与投递对账。`executionEpoch` 只在 Core 再次把 Run 交给 Runtime 时递增；仍被 Approval、用户输入、unknown 动作或其他事实阻塞的 Run 不得仅因 Host 重建而恢复为 `running`。

Conversation 执行锁只防止同一私有连续性被两个 AgentRun 同时推进，不保护文件系统。DM-23 已决定 v0.02 不建立 Workspace 写锁：多个 AgentRun 可以指向同一执行目录，Core 不宣称能够阻止它们或用户、IDE、外部进程并发修改。需要隔离时由 Agent/User 在启动目标 Run 前选择独立 Git Worktree。

##### 幂等

AgentRun 创建命令必须携带幂等键，最低数据库约束为：

```text
UNIQUE(camp_turn_id, conversation_id, idempotency_key)
UNIQUE(camp_turn_id, responsibility_key, responsibility_generation)
UNIQUE(predecessor_agent_run_id) WHERE predecessor_agent_run_id IS NOT NULL
```

同一 Router 投递、UI 重复点击、网络重试、应用恢复或队列重投必须返回既有 AgentRun。人工创建后继 Run 使用新的运行幂等键，但重试命令本身也必须按 `predecessorRunId + clientRequestId` 幂等。执行型 Agent 间投递通过 `InboxMessage.targetAgentRunId` 引用 Core 已创建或已关联的目标 Run；Inbox 重投只能复用该 Run，不能重新创建职责。

AgentRun 幂等不代替 ActionExecution；受限读取、文件写入、命令、Git 和外部 API 必须拥有自己的动作身份、尝试 fencing 与对账协议。

##### 最小逻辑结构

```ts
type AgentRun = {
  id: string;

  campTurnId: string;
  conversationId: string;
  taskId: string | null;

  triggerConversationMessageId: string | null;
  inputReadyAt: string | null;
  initialCampContextThroughSequence: number;
  initialConversationContextThroughSequence: number;

  responsibilityKey: string;
  responsibilityGeneration: number;
  predecessorAgentRunId: string | null;
  startReason: AgentRunStartReason;

  purpose: string;
  expectedOutput: string;
  completionRole: AgentRunCompletionRole;
  effectiveConfig: EffectiveAgentConfigSnapshot;
  workspace: AgentRunWorkspace | null; // 值对象定义见 DM-23

  status: AgentRunStatus;
  waitReason: AgentRunWaitReason | null;
  waitDeadlineAt: string | null;

  idempotencyKey: string;
  automaticRetryCount: number;
  lastErrorCode: string | null;
  lastErrorDetailsRef: string | null;
  manualRetryAllowed: boolean;
  retryDeclinedAt: string | null;

  executionEpoch: number;
  executionLeaseOwner: string | null;
  executionLeaseExpiresAt: string | null;
  cancelRequestedAt: string | null;
  cancelReasonCode: AgentRunCancelReason | null;
  cancelAcknowledgedAt: string | null;
  version: number;

  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
};
```

Core 必须保证：`waiting` 时 `waitReason` 非空；`running` 记录必须拥有执行租约身份和到期时间，但租约在崩溃后允许自然过期，过期意味着失去健康执行资格并等待恢复，不是数据库非法状态；终态时 `endedAt` 非空并释放执行租约；取消请求的时间和原因必须同时存在，进入 `cancelled` 前必须已有 `cancelAcknowledgedAt` 且所有动作完成必要对账；`startedAt` 记录第一次进入 running 的时间，不因恢复而重置；`retryDeclinedAt` 只能出现在允许人工重试的 `failed` Run 上并且只能设置一次。需要文件或 Git 能力的 Run 必须在 Native Runtime 绑定前拥有 Workspace 快照；该快照一经绑定即不可修改。

`nativeSessionId`、`nativeRunId`、进程 ID、输出正文、独立文件和受限动作结果不进入这份最小权威结构；它们分别属于 Conversation 当前绑定、执行事件、CampMessage/ConversationMessage、MessageAttachment/ManagedBlob 或 ActionExecution。查询模型可以投影“当前/最近”值。

#### 决策结果

- **决策**：采用六态、可恢复、终态不可逆的 AgentRun；安全自动重试留在原 Run；终态后的再次执行仅在原 CampTurn 仍非终态时形成线性后继，否则进入新 CampTurn。
- **理由**：把 Agent 的逻辑执行从模型请求、进程和 Native Session 中解耦，同时用稳定职责键、fencing 和副作用对账保证恢复不会造成重复执行或错误聚合。
- **领域影响**：CampTurn 是公共执行边界，Conversation 是私有连续性与执行锁边界，AgentRun 是不可变职责契约下的一次逻辑执行；Task 保持可选。
- **数据/API 影响**：增加 `agent_run`、职责 generation/前驱约束、创建幂等、输入消息/公共上下文水位、Conversation 部分唯一执行锁、持久执行租约、`executionEpoch` fencing、结构化错误/等待字段、不可变 Workspace 快照，以及失败时冻结的 `manualRetryAllowed`、一次性 `retryDeclinedAt` 和带原因的取消/停止确认；Capability 与动作权限只从 `effectiveConfig` 读取；Native Session/Run 明细进入事件记录而非配置快照。
- **后续事项**：DM-20 已确定 ActionExecution 对账协议；DM-22 已确定 queued/cancelRequested Run 由类型化扫描器和窄化 ACK 恢复，不使用通用 Outbox；DM-23 已确认不建立 Workspace 写锁，实施 ADR 需定义 Workspace 绑定、路径校验和 v0.01 字段迁移。

### DM-10 原生会话链

- **状态**：已修订
- **Lumen 决策**：v0.02 不建立 Session Chain 或 Session Generation；Conversation 只保存当前 `nativeSessionId`。
- **核心问题**：底层 Session 失效时，如何在不改变逻辑 Conversation 的前提下恢复。

#### 讨论记录

2026-07-19 确认：优先续接当前原生 Session；失效时创建新 Session，并注入私有摘要/增量、未读公共消息和当前任务上下文。换绑同时更新 Conversation 当前绑定并记入 `event_log`，但不形成一等 Session 代际模型。

当前绑定必须满足：一个 Conversation 最多绑定一个 Native Session，一个 Native Session 同时最多属于一个 Conversation。当前实现只有 `CodexRuntimeAdapter`，因此以非空 `Conversation.nativeSessionId` 的部分唯一索引兜底；未来引入多个 `AgentRuntimeAdapter` 时再扩展为 `(adapterKind, nativeSessionId)` 唯一。Session 换绑必须通过强类型命令，在同一事务校验旧绑定与新 ID 唯一性、更新 Conversation 并写入 `event_log`，不能只改 Runtime Manager 的内存映射。

v0.02 的物理约束为：

```sql
CREATE UNIQUE INDEX uq_conversation_native_session
ON conversation(native_session_id)
WHERE native_session_id IS NOT NULL;
```

若未来把 Adapter 类型持久化到 Conversation，该索引迁移为 `(adapter_kind, native_session_id)` 的非空部分唯一索引，避免不同 Adapter 的原生 ID 命名空间互相碰撞。

#### 决策结果

- **决策**：v0.02 明确不实现 Session Chain。
- **理由**：优先保持领域模型和 UI 简单，并允许不同 Provider 的原生 Session 被统一替换。
- **领域影响**：Conversation 是逻辑连续性边界；原生 Session 只是当前运行句柄。
- **数据/API 影响**：Conversation 保存可空 `nativeSessionId`；增加非空值部分唯一索引、强类型换绑命令和最小事件记录。
- **后续事项**：如故障分析证明确有需要，再增加原生 Session 历史，不提前引入 Generation 模型。

### DM-11 RuntimeSession

- **状态**：已修订
- **Lumen 决策**：逻辑会话与 Provider Runtime 连接必须拆分；Conversation 保存配置覆盖和当前 Session 绑定，AgentRun 冻结实际配置。
- **核心问题**：逻辑 Conversation 与 Provider Runtime 的职责边界已确认；物理表迁移方式仍待实施设计。

#### 讨论记录

2026-07-19 确认：当前 `runtime_session` 不再被视为 Agent 长期上下文的领域身份。Provider、模型和权限的默认覆盖，以及当前原生 Session 绑定属于 Conversation；每次实际使用的 `AgentRuntimeAdapter`、Provider、模型、能力和权限冻结在 AgentRun 配置快照中；Native Session 换绑及每次 Native Run 另记执行事件。

CodexRuntimeHost、OS 进程、App Server 连接、Host Instance 和 Thread Binding Registry 都是 Adapter 的可重建运行资源，不属于领域模型。一个 Host 可以承载多个 Native Session，也可以因隔离或容量需要形成有限 Host Pool；无论物理拓扑如何变化，都不能改变 Conversation 与当前 Native Session 的唯一绑定、Conversation 执行锁或 AgentRun `executionEpoch`。

#### 决策结果

- **决策**：Conversation 独立于任何一次原生 Session。
- **理由**：Lumen 必须在 Provider 原生 Session 失效、重建或迁移后仍保持自身会话连续性。
- **领域影响**：Runtime Host 不拥有长期身份或记忆；私有历史和摘要属于 Conversation，进程共享/池化策略不进入领域关系。
- **数据/API 影响**：需要从现有 Task→Runtime 归属迁移到 Camp×Agent 的 Conversation 归属；Native Session 当前绑定由 Conversation 持久化并以部分唯一索引防止跨 Conversation 复用。
- **后续事项**：在实施 ADR 中确定复用、迁移或废弃现有 `runtime_session` 表。

### DM-12 CampTurn

- **状态**：已修订
- **Lumen 决策**：CampTurn 属于 Camp，表示一次可执行公共触发形成的有界协作过程，并包含一个或多个 AgentRun。
- **核心问题**：如何把真正需要 Agent 执行的触发与被动记录区分开，并根据多项职责的当前有效 AgentRun 安全聚合终态。

#### 讨论记录

Camp 才是长期公共上下文本身；CampTurn 只是其中一次短期、可终止的协作执行边界。不是所有 CampMessage 或系统事件都会创建 CampTurn。只有结构化意图明确表示“需要一个或多个 Agent 执行”，并且 Router 得到至少一个有效目标时，Core 才创建 CampTurn 及其首批 AgentRun。

最小逻辑结构：

```ts
type CampTurnTrigger =
  | { type: 'camp_message'; id: string }
  | { type: 'inbox_message'; id: string }
  | { type: 'system_event'; id: string };

type CampTurn = {
  id: string;
  campId: string;
  trigger: CampTurnTrigger;
  status: CampTurnStatus;

  cancelRequestedAt: string | null;
  cancelRequestCommandId: string | null;

  version: number;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
};
```

触发引用必须属于同一 Camp，并对物理列建立 `UNIQUE(camp_id, trigger_type, trigger_id)`：同一条明确执行触发最多创建一个 CampTurn，Router/UI 重试返回既有 CampTurn，而不是复制一次协作过程。一个触发同时定向多个 Agent 时，在该唯一 CampTurn 下原子创建多条 AgentRun。后续结构化 execution intent 若明确属于既有非终态 CampTurn，可以只追加职责 Run；它不改写该 CampTurn 的原始 trigger，并继续依赖 AgentRun 职责/幂等约束防重。

`trigger` 创建后不可修改。`cancelRequestedAt/cancelRequestCommandId` 必须同时为空或同时非空；终态必须有 `endedAt`，非终态必须为空。CampTurn 至少拥有一个 AgentRun。追加普通职责或创建 Retry/Rework 前，Core 必须重新校验 CampTurn 仍为 running/waiting、未请求取消，且当前职责/关联 Task 中不存在已经确定会令该 CampTurn failed/cancelled 的终止事实；一旦进入取消、Decline、不可重试失败或关联 Task 取消收敛路径，不得再追加新职责拖延终态。

`CancelCampTurn` 在无非终态 Run/未决副作用时可以立即提交；否则第一事务只写入取消请求并以 `camp_turn_cancelled` 原因请求停止全部非终态子 Run。CampTurn Aggregation Finalizer 扫描该请求、Retry/Decline、关联 Task 取消和当前职责 Run 等权威事实，待全部子 Run 终态和必要对账完成后按下文优先级提交结果。终态原因不能只从 event_log 或“所有 Run 恰好都取消了”反推。

建议语义如下：

| 输入或记录 | 是否创建 CampTurn / AgentRun |
|---|---|
| 用户向 Default Lead 提问并要求回答 | 创建一个 CampTurn，并为 Default Lead 创建一个 AgentRun |
| 用户同时明确请求多个 Agent 执行 | 创建一个 CampTurn，并为各目标 Conversation 创建独立 AgentRun |
| Agent 的最终回复 | 不创建；关联已有 CampTurn 和 AgentRun |
| 流式输出片段 | 不创建；属于已有 AgentRun 的传输或增量事件 |
| Agent 间普通通知 | 不创建；作为公共或 Inbox 事实记录 |
| Agent 明确请求另一个 Agent 执行 | 创建 AgentRun；若仍属于当前因果过程则加入当前 CampTurn，否则新建 CampTurn |
| 系统状态、审批提醒和错误提示 | 不创建；作为事件或状态投影记录 |
| 审批结果、Tool 回调和进程恢复 | 不新建 CampTurn；继续推动原 CampTurn 与 AgentRun |
| 与 `waiting(user_input)` 明确关联的用户回复 | 不新建；恢复原 AgentRun |
| 与等待 Run 无关的新执行请求 | 创建新的 CampTurn 和 queued AgentRun，等待目标 Conversation 执行锁 |

“是否请求执行”必须由消息命令或结构化元数据明确表达，不能仅靠扫描自然语言或看到 `@Agent` 文本推断。Agent 的普通回复即使提到另一个 Agent，也不会自动触发递归路由。

```text
CampMessage / System Trigger 已持久化
  → 判断是否具有 execution intent
  → Router 选择目标 Conversation
  → 无目标：不创建 CampTurn，记录路由结果
  → 有目标且属于一个非终态 causal CampTurn：Core 原子追加 AgentRun并物化其初始输入
  → 有目标但无可复用 causal CampTurn：Core 原子创建 CampTurn + 首批 AgentRun + 初始输入
  → 输出继续关联该 CampTurn / AgentRun
  → 因果执行结束后 CampTurn 进入终态
```

CampTurn 不拥有长期目标、成员、Task DAG 或跨问题完成语义，因此不是改名后的 TeamRun。一个 Task 可以跨多个 CampTurn；一个无 Task 的普通问答也可以形成 CampTurn。

##### CampTurn 状态聚合

```ts
type CampTurnStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';
```

CampTurn 可能同时被多个 AgentRun 或人工选择阻塞，因此不持久化单一 `waitReason`。`waiting(retry_decision)` 是读取模型简写，不对应 Decision 实体或待处理记录。UI 应展示由当前 Run、待重试选择和未知副作用共同派生的 blocker 列表。

`retry_decision` 只在以下事实同时成立时派生：

```text
某项 required 职责的当前有效 AgentRun = failed
AND manualRetryAllowed = true
AND 不存在后继 AgentRun
AND retryDeclinedAt = null
AND 该 Run 未关联 Task，或关联 Task 仍为 pending/in_progress 且未请求取消
AND CampTurn.cancelRequestedAt = null
```

应用重启后可以从这些权威事实恢复同一提示。用户选择 Retry 时执行 `RetryAgentRun` 并创建后继；用户选择放弃时执行 `DeclineAgentRunRetry` 并持久化 `retryDeclinedAt`，读取模型随即停止显示该提示。

CampTurn 不因任意一条历史 AgentRun 失败而失败。Core 按 `responsibilityKey` 找到当前没有后继的有效 Run，并在一个事务内按下列优先级聚合；先匹配的规则胜出：

```text
存在 queued/running Run
  → CampTurn = running

不存在 queued/running，但存在 waiting Run
  → CampTurn = waiting

从此处起要求所有子 Run 已终态且必要副作用已完成对账。

CampTurn.cancelRequestedAt != null
  → CampTurn = cancelled

任一 required 当前职责关联的 Task 已请求取消或已 cancelled，
或该 Run 的 cancelReasonCode = task_cancelled
  → CampTurn = cancelled

存在上述 retry_decision 条件
  → CampTurn = waiting

任一 required 当前职责 failed 且不可人工重试/已 Decline，
或因成员退出、用户单独取消 Run、不可恢复策略等非 Task/CampTurn 原因 cancelled
  → CampTurn = failed

每项 required 当前职责均 succeeded
  → CampTurn = completed
```

`CancelCampTurn` 与 `DeclineAgentRunRetry` 在前置阶段仍须请求停止其他非终态 Run；上表只定义所有子 Run 收敛后的唯一终态选择。Task 取消不改写已经终态的失败 Run，而是由 Task 自身的取消请求/终态提供稳定聚合依据，因此不会遗留 retry_decision。若没有任何规则可匹配，Core 必须拒绝提交终态并暴露不变量错误，不能猜测结果。

`optional` 职责不要求成功，但其 Run 仍须进入终态；Core 可以在必需职责完成后显式取消尚未结束的 optional Run，再提交 CampTurn。optional Run 的失败或取消不单独决定 CampTurn 终态。CampTurn 一旦进入 `completed/failed/cancelled`，不得新增 AgentRun，也没有出向转换；终态后出现的 Retry/Review/Rework 必须建立新 CampTurn，不能跨 CampTurn 建 predecessor 链。真正的后台工作必须使用新的 CampTurn 或 Task，不能在终态 CampTurn 下继续运行。

必需 AgentRun 失败但仍允许人工重试时，CampTurn 保持 `waiting(retry_decision)`；重试会在同一职责下创建后继 Run。`DeclineAgentRunRetry` 表达“该必需职责已经失败且不再尝试”，最终推动 CampTurn 进入 `failed`；`CancelCampTurn` 表达“主动终止仍在进行的工作”，最终进入 `cancelled`，二者不得混用。两条路径都可能先请求停止其他非终态 Run 并等待副作用对账。在此期间，`retryDeclinedAt`、各 Run 的 `cancelRequestedAt/cancelAcknowledgedAt` 和未决对账共同构成可恢复的编排进度，不再重复提示 Retry/Decline。

#### 决策结果

- **决策**：CampTurn 作为 Camp 内一次可执行公共触发的有界协作过程；每个 CampTurn 至少包含一个 AgentRun，但并非每条消息或事件都会创建 CampTurn；状态按每项职责的当前有效 Run 聚合。
- **理由**：既为多 Agent fan-out 提供统一因果边界，又避免最终回复、流式片段和系统通知引发重复执行或无限路由。
- **领域影响**：CampTurn 属于 Camp；AgentRun 属于 CampTurn 与 Conversation；公共消息可以不关联 CampTurn，也可以作为触发或输出关联已有 CampTurn。
- **数据/API 影响**：`camp_turn` 需要 `camp_id`、结构化触发来源、状态、取消请求和乐观版本；AgentRun 需要 `camp_turn_id`、初始输入/上下文水位、失败时冻结的 `manualRetryAllowed`、一次性 `retryDeclinedAt` 和取消原因；CampMessage 对 `camp_turn_id`、`agent_run_id` 的关联均可空。公共消息触发时，CampTurn、首批 AgentRun 和各目标 Conversation 的初始输入应在同一 Core 事务创建；执行型 Inbox 只延迟触发 ConversationMessage，公共/私有初始前缀仍在创建 Run 时冻结。终态提交必须验证全部子 Run 已终态。
- **后续事项**：在 Router ADR 中定义 execution intent 与 correlation 协议；DM-14 已落实可靠 Inbox 投递；DM-20/DM-22 已落实停止其他 Run 时的副作用对账、取消 ACK 与状态扫描编排。

### DM-13 对话记录

- **状态**：已修订
- **Lumen 决策**：Camp 保存长期公共协作上下文；每个 Agent 在每个 Camp 内恰有一个私有 Conversation。
- **核心问题**：公共与私有上下文边界已确定；Camp 自身长期存在，不再引入 TeamRun 层。

#### 讨论记录

2026-07-19 确认：

```text
Camp 负责“团队共同知道什么”
Conversation 负责“某个 Agent 自己延续什么”
```

`Camp` 是长期存在的公共协作上下文，承载同行者、公共讨论、资源引用和成果引用。`Conversation` 是一个同行者在 Camp 内的私有连续性。

```text
Camp
├── Participants / 同行者
├── CampMessage
├── Shared Context / Resource / Evidence Reference
├── Conversation（洛可）
├── Conversation（沐瓦）
└── Conversation（眠枝）
```

最小逻辑结构：

```ts
type CampMessage = {
  id: string;
  campId: string;
  sequence: number;
  author: ActorRef;
  body: string;
  campTurnId: string | null;
  agentRunId: string | null;
  tombstonedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type ConversationMessage = {
  id: string;
  conversationId: string;
  sequence: number;
  author: ActorRef;
  body: string;

  sourceCampMessageId: string | null;
  sourceInboxMessageId: string | null;
  campTurnId: string | null;
  agentRunId: string | null;

  createdAt: string;
};

type Conversation = {
  id: string;
  campId: string;
  agentProfileId: string;

  providerOverride: string | null;
  modelOverride: string | null;
  actionPermissionProfileRef: string | null;
  nativeSessionId: string | null;

  summary: string | null;
  summaryThroughConversationMessageSequence: number;
  lastSeenCampMessageSequence: number;
  lastMessageSequence: number;

  version: number;
  createdAt: string;
  updatedAt: string;
};
```

顺序约束：

```text
UNIQUE(camp_id, sequence)                    on CampMessage
UNIQUE(conversation_id, sequence)            on ConversationMessage
UNIQUE(conversation_id, sourceCampMessageId) where sourceCampMessageId is not null
UNIQUE(sourceInboxMessageId)                 where sourceInboxMessageId is not null
UNIQUE(nativeSessionId)                      on Conversation where nativeSessionId is not null
```

Camp 与 Conversation 分别持有 `lastMessageSequence` 计数器。追加消息时，Core 在同一事务中递增对应计数器并写入消息，不能使用 UUID、时间戳或 `MAX(sequence) + 1` 作为并发顺序协议。

Conversation 不持久化一套与 AgentRun 竞争的运行状态。`idle/queued/running/waiting/failed` 等 UI 状态由当前执行锁、queued AgentRun 和 Native Session 健康信息投影；AgentRun 才是一次执行生命周期的权威状态源。

公共消息通过消费游标增量物化为各 Conversation 的输入记录。v0.02 没有“已跳过公共消息”实体，因此游标每推进一个连续前缀，就必须把该前缀内的全部 CampMessage（或其受 Tombstone 约束的可见表示）按序物化，不能只凭一次路由判断挑选“必要”消息后永久越过其余序列。公开回答写回 Camp；私有输入、输出、工具结果和恢复摘要留在 Conversation。这里的私有历史不包含模型未公开的隐藏推理过程。

每个 AgentRun 在创建时先冻结 `initialCampContextThroughSequence`。Router/Core 在同一事务为目标 Conversation 物化该 Camp 水位内尚未消费的完整连续公共消息前缀，再记录普通触发 `ConversationMessage`，随后冻结 `initialConversationContextThroughSequence` 并设置 `inputReadyAt`。Adapter 启动 Run 时只能读取不超过这两个初始水位的历史及之后明确关联该 Run 的 continuation 输入，不能根据 Conversation 当前最新游标把更晚 queued CampTurn 的消息提前注入。

执行型 InboxMessage 是唯一允许先创建 Run、后补齐触发 ConversationMessage 的情况，但延迟的只有 Inbox 触发本身：创建 Inbox/CampTurn/目标 Run 的事务必须先完成上述公共连续前缀物化，再冻结两个初始上下文水位，并令 `triggerConversationMessageId` 与 `inputReadyAt` 为空。Inbox 投递事务不得再补公共前缀或改写水位，只把新建的触发消息作为一个显式额外输入写入 `triggerConversationMessageId` 并设置 `inputReadyAt`。Adapter 为该 Run 组装“冻结前缀 + 显式触发消息”，必须跳过两者之间属于其他 queued CampTurn 的非关联消息。投递延迟不能扩大该 Run 可见的公共或私有上下文范围。

Conversation summary 只能覆盖连续的 ConversationMessage 前缀，并保存覆盖水位。只要存在 queued/running/waiting AgentRun，Compactor 不得把 summary 水位推进到这些 Run 中最小的 `initialConversationContextThroughSequence` 之后，否则较早 Run 将无法恢复自己创建时可见的上下文。

已确认的语义约束：

1. 同一个 Camp 内，每个 AgentProfile 只有一个逻辑 Conversation；物理约束为 `UNIQUE(camp_id, agent_profile_id)`。
2. Agent 的公开结论写回 Camp；仅对该 Agent 有用的工作上下文保留在 Conversation。
3. `summary` 是恢复快照，不是原始历史或长期 Memory 的替代品。
4. 公共消息已经持久写入 Conversation 的输入记录后，`lastSeenCampMessageSequence` 才能按连续前缀推进；存在序列空洞时不得跳跃。
5. `sourceCampMessageId` 与 `sourceInboxMessageId` 最多一个非空；Runtime 私有输出可令二者都为空，但必须关联产生它的 AgentRun。
6. CampMessage 成为 Task 证据后只能 Tombstone，不能物理删除内容；普通 ConversationMessage 不具备 Task 证据资格，清理策略不得破坏尚未结束 Run 的初始水位与恢复历史。

```text
用户写入 Camp
  → 路由器选择同行者
  → Conversation 获得私有历史/摘要、未读公共消息和当前工作上下文
  → Agent 执行
  → 公开输出写回 Camp，私有执行记录留在 Conversation
```

原生 Session 有效时优先续接；失效时创建新 Session，并用 Conversation 摘要、必要私有增量和未读公共消息恢复。换绑写入 `event_log`，v0.02 不建立 Session Chain。

#### 决策结果

- **决策**：引入 `Camp` 与 `Conversation`；每个 AgentProfile 在一个 Camp 中只有一个逻辑 Conversation，数据约束为 `UNIQUE(camp_id, agent_profile_id)`。
- **理由**：公共协作和 Agent 私有连续性需要不同事实边界，同时保持用户可理解的单一 Camp UI。
- **领域影响**：Camp 成为长期公共协作上下文；Conversation 成为 Agent 私有恢复单元；二者均不等于长期 Memory。
- **数据/API 影响**：确定 `camp`、`camp_message`、`conversation`、`conversation_message` 的最小逻辑字段、每作用域单调序列、来源唯一键、Native Session 部分唯一约束、版本与摘要/公共消息水位；Conversation 直接引用 AgentProfile，不经过 AgentInstance。
- **后续事项**：实现 ADR 固定消息正文的版本化内容 Schema、Tombstone 展示、批量物化查询和 Compactor 索引；初始输入水位与 queued Run 隔离语义不再作为未决项。

### DM-14 InboxMessage

- **状态**：已修订
- **Lumen 决策**：引入持久 `InboxMessage`，用于同一 Camp 内 Agent 之间的定向可靠投递。模块和领域实体统一使用 `Inbox` / `InboxMessage`，数据库表命名为 `inbox_message`。
- **核心问题**：如何在不把通信、路由和执行状态混为一体的前提下，提供单接收者投递、幂等、租约、重试、回复关联和明确的 Core ACK。

#### 讨论记录

##### 领域边界

```text
InboxMessage
    Agent 之间的可靠定向投递记录。

ConversationMessage
    接收方 Conversation 中已经成立的消息事实。

CampTurn
    一次可执行公共触发形成的有界协作过程。

AgentRun
    接收方实际执行工作的生命周期。
```

`InboxMessage` 只负责可靠传输，不替代 ConversationMessage、Task、Approval 或 AgentRun，也不表达或触发责任转移。每条消息只有一个接收者；广播由 Core 展开为多条拥有共同 `batchId` 的独立消息，使每个接收者可以独立投递、重试和失败。

v0.02 不设置 `inform/request/response` 等通信意图枚举。回复使用 `inReplyToMessageId` 和 `correlationId` 表达。是否需要执行由此前已经确认的结构化 execution intent、Router 和 Core 决定，不能由 Dispatcher 扫描 `body` 推断。

当 Agent 间消息确实触发执行时，Core 必须在 Inbox 投递前创建或关联目标 `AgentRun`，并写入 `targetAgentRunId`。这不是通信意图类型，而是对既有执行契约的引用。创建该 Run 的事务已经物化并冻结 DM-13 的公共/私有初始前缀；只有 Inbox 触发 ConversationMessage 延迟到 Dispatcher。该 Run 在投递前保持 `queued + triggerConversationMessageId = null + inputReadyAt = null`，Scheduler 不得启动。普通通知不设置该字段，也不会创建 CampTurn 或 AgentRun。

##### 通用实体引用

InboxMessage 可以携带通用、非 Review 专属的实体引用，使 UI 和审计无需解析自然语言即可定位协作对象。引用不赋予权限，也不改变被引用实体的状态或归属。统一 `EntityReference` 的正式定义见 DM-18。

```ts
type InboxReferenceType =
  | 'task'
  | 'camp_message'
  | 'agent_run'
  | 'conversation_message'
  | 'git_commit'
  | 'action_execution'
  | 'message_attachment';

type InboxMessageReference = EntityReference<InboxReferenceType>;
```

引用数组在消息创建后不可修改。Core 发送时必须校验引用类型、数量、可见权限，以及引用目标与当前 Camp/仓库的作用域关系。Workspace 路径通过所引用的 AgentRun 快照查看，不作为 EntityReference；Git Commit 使用 DM-18 定义的仓库作用域与完整 OID。Inbox 的协作引用不自动获得 Task 验收证据资格。

##### 最小数据结构

```ts
type InboxMessage = {
  id: string;
  campId: string;

  senderAgentId: string;
  recipientAgentId: string;

  body: string;
  references: InboxMessageReference[];

  sourceConversationId: string;
  sourceCampTurnId: string | null;
  sourceAgentRunId: string | null;

  targetConversationId: string;
  targetAgentRunId: string | null;

  inReplyToMessageId: string | null;
  correlationId: string;
  batchId: string | null;
  retryOfMessageId: string | null;

  idempotencyKey: string;

  recipientMessageId: string | null;
  deliveredAt: string | null;

  attemptCount: number;
  availableAt: string;

  leaseOwner: string | null;
  leaseExpiresAt: string | null;

  expiresAt: string | null;

  failedAt: string | null;
  lastError: string | null;

  createdAt: string;
  updatedAt: string;
};
```

`senderAgentId` 与 `recipientAgentId` 均引用稳定的 AgentProfile；对应的 source/target Conversation 必须属于同一 Camp，并分别属于发送者和接收者。`targetAgentRunId` 如非空，必须属于目标 Conversation 和同一 Camp。`references` 是通用协作元数据，不形成 Review、Handoff 或其他领域对象。

##### 投递 ACK

v0.02 不建立完整投递状态机。投递是否成功只以 `deliveredAt` 为准：

```text
deliveredAt = null      尚未成功写入接收方 Conversation
deliveredAt != null     已写入接收方 Conversation，并由 Core 完成投递 ACK
```

只有以下操作在同一 SQLite 事务中成功后，Core 才能设置 `deliveredAt`：

```text
1. 按 InboxMessage.id 创建或复用接收方 ConversationMessage
2. 若 targetAgentRunId 非空，把该消息关联到已经存在的 AgentRun/CampTurn
3. 若 targetAgentRunId 非空，确认 Run 仍为 queued、尚无触发输入，且创建 Run 时冻结的
   initialCampContextThroughSequence / initialConversationContextThroughSequence 仍存在；只写入
   triggerConversationMessageId 和 inputReadyAt，不得在投递时扩大或改写初始上下文水位
4. 写入 recipientMessageId
5. 设置 deliveredAt，并清除投递租约
```

Dispatcher 不得在投递阶段创建、选择或更换 CampTurn/AgentRun。接收方 ConversationMessage 必须保存 `sourceInboxMessageId`，并对其建立唯一约束，确保应用重启或 Dispatcher 重试不会重复插入消息。目标 Run 已终态、已拥有另一触发输入或不再属于目标 Conversation 时，本次投递必须永久失败，不能把消息附加到一个无关的当前 Session。

这里的 ACK 只表示“接收方 Conversation 已持久接收”，不表示 Runtime 已读取、Agent 已处理或 AgentRun 已成功。v0.02 不增加消费 ACK 或 `consumedAt`。

##### 租约、重试与失败

Dispatcher 只能通过条件更新原子获取满足以下条件的消息：尚未投递、尚未失败、尚未过期、`availableAt` 已到达，并且不存在有效租约。`leaseOwner` 与 `leaseExpiresAt` 必须同时为空或同时非空。

```text
原子获取短期租约
→ 再次校验消息仍可投递
→ 写入接收方 Conversation
→ 成功：设置 deliveredAt，清除租约
→ 临时失败：attemptCount++，更新 availableAt，清除租约
→ 永久失败或达到最大重试次数：设置 failedAt/lastError，清除租约
```

`failedAt != null` 的消息停止自动重试并继续保留，供用户查看。人工重新发送必须创建新的 `InboxMessage` 和新的幂等键，并通过 `retryOfMessageId` 关联原消息；不得把失败记录原地改回待投递。

如果永久失败消息带有 `targetAgentRunId`，Core 必须在设置 Inbox failed 的同一事务把仍为 queued 且尚未获得输入的目标 Run 收敛为 `failed(input_delivery_failed)`，`manualRetryAllowed = false`，随后聚合 CampTurn。重新发送执行请求必须创建新的 AgentRun；不能让新 Inbox 指向已经失败的旧 Run。

##### 过期与删除

```text
expiresAt 已到期且 deliveredAt 仍为空且 targetAgentRunId 为空
→ 不再投递
→ 直接删除 InboxMessage
```

执行型 InboxMessage 在 v0.02 必须令 `expiresAt = null`，直到投递成功或以失败事务终结目标 Run，避免删除目标 Run 的唯一输入契约。普通投递事务必须在提交前重新校验 `expiresAt`，避免租约期间到期的消息仍被写入 Conversation。已成功投递的消息不再因 `expiresAt` 删除；之后由普通数据保留策略管理。无目标 Run 的失败消息如设置了 `expiresAt`，到期后同样删除。

直接删除意味着 Inbox 的幂等保护和 `retryOfMessageId` 追溯只在记录保留期内有效。实现时，指向可被过期删除记录的自引用外键应使用 `ON DELETE SET NULL`，而 `correlationId` 继续保留同一通信链的关联。

##### 核心约束

```text
发送者与接收者在发送时必须是同一 Camp 的有效活跃成员。
senderAgentId != recipientAgentId。
sourceConversationId 和 targetConversationId 必须匹配各自 Agent 与 Camp。
每条 InboxMessage 只有一个接收者。
UNIQUE(campId, idempotencyKey)。
inReplyToMessageId 必须属于同一 Camp；直接回复时收发双方必须反转。
回复和人工重发沿用原 correlationId。
retryOfMessageId 必须指向同 Camp、同方向且 failedAt 非空的原消息。
targetAgentRunId 如非空，必须属于 targetConversationId；投递不得据此新建 Run。
targetAgentRunId 非空时 expiresAt 必须为空；目标 Run 在投递前必须 queued 且 inputReadyAt 为空。
references 中每个目标必须通过发送者可见性与 Camp/工作目录作用域校验。
references 内 `(entityType, entityId)` 不得重复，且消息创建后不可修改。
deliveredAt 非空时 recipientMessageId 必须非空，failedAt 和租约必须为空。
failedAt 非空时 deliveredAt 必须为空，lastError 必须非空，租约必须为空。
已成功投递的消息不再自动重试。
```

接收者在创建后退出 Camp、目标 Conversation 无效等不可恢复错误可以直接设置 `failedAt`，无需耗尽自动重试次数。

##### 建议命令

```text
SendInboxMessage
ReplyInboxMessage
AcquireInboxDeliveryLease
AcknowledgeInboxDelivery        Core 内部命令
RetryFailedInboxMessage         创建新 InboxMessage
DeleteExpiredInboxMessages
ListAgentInbox
ListSentInboxMessages
```

发送方查询使用 `ListSentInboxMessages`。这里的“发件箱”只是 InboxMessage 的发送方读模型，不是 DM-22 已否决的通用 Outbox。

#### 决策结果

- **决策**：采用单接收者持久 `InboxMessage`；支持通用实体引用；广播由 Core 展开；写入接收方 Conversation 后由 Core 原子 ACK；不跟踪 Agent 是否消费；通过幂等键、短期租约、自动重试、失败保留和到期删除实现可靠投递。
- **理由**：把传输事实与 Conversation 消息事实、执行生命周期和业务状态分离，既能在应用重启后恢复投递，又不会让消息 Dispatcher 获得路由或执行状态转换权。
- **领域影响**：Agent 间普通通知只产生 Inbox/Conversation 消息；显式执行请求由 Router/Core 先建立或关联 CampTurn/AgentRun，再由 Inbox 完成定向传输；Inbox 不改变 Task Assignee 或任何职责归属。
- **数据/API 影响**：增加 `inbox_message.references` 通用引用 JSON、`ConversationMessage.sourceInboxMessageId` 唯一约束、`(camp_id, idempotency_key)` 唯一约束、租约条件更新、投递事务和 Inbox 查询/重发命令；执行型投递通过可空 `target_agent_run_id` 与既有 Run 关联，并在同一事务只填充 Run 的显式触发输入与 `inputReadyAt`，不改写创建时冻结的水位；永久投递失败同步终结尚未启动的目标 Run。
- **后续事项**：DM-18 已确认不引入 Artifact，并区分 Inbox 协作引用与 Task 稳定证据；DM-20/DM-23 分别确认 ActionExecution 与仓库作用域 Git Commit 的稳定标识；DM-22 已确认 InboxMessage 自身就是其持久投递真源，事务提交后只发送可丢失 Wake，Dispatcher 通过启动/周期扫描恢复；实施 ADR 决定引用数量上限、最大重试次数、退避策略、租约时长和普通保留周期。

### DM-15 Handoff

- **状态**：已否决
- **Lumen 决策**：v0.02 暂不提供责任转移功能，不引入 `Handoff` 实体，也不提供提出、接受、拒绝、超时、重新分派或责任转移流程。
- **核心问题**：确认 Task 的责任是否可以在创建后改变，以及 InboxMessage 是否承担责任转移语义。

#### 讨论记录

##### 核心原则

v0.02 没有 Handoff 行为。Task 在创建时绑定唯一 Assignee，此后不允许转移。InboxMessage 只是 Agent 间消息通道，不能表示、暗示或触发 Task、AgentRun 或 Conversation 的责任转移。

Agent 仍可通过 `InboxMessage` 发送普通通知、问题、结果或明确的执行请求，例如说明：

- 当前已经完成的工作。
- 希望对方继续处理的内容。
- 推荐的下一步。
- 风险和注意事项。
- 相关 Task、CampMessage、ConversationMessage、AgentRun、ActionExecution、Git Commit 或 MessageAttachment 引用。

InboxMessage 是 Agent 间唯一的可靠定向投递通道；CampMessage 仍可承载公开讨论和公共事实，但不能代替对指定 Agent 的可靠投递。消息投递成功只表示接收方 Conversation 已持久接收，不表示接收 Agent 接受、开始或完成了工作。

##### 固定 Task Assignee

通过 Inbox 邀请其他 Agent 协作时：

```text
Task.assigneeAgentId 保持不变
```

原 Assignee 始终承担 Task 的协调和最终推进责任，但不因此获得绕过 Core 完成门的权限；只有合法 Actor 显式提交 `CompleteTask` 且全部门禁通过后，Rust Core 才能根据持久证据提交 Task 完成。

接收 Agent 可以：

- 对同一个 Task 开展分析、实现或审查。
- 通过 Core 创建或关联同一个 `taskId` 的 AgentRun。
- 产出公开消息、MessageAttachment、Git Commit 或审查反馈。
- 将结果通过 InboxMessage 回复给原 Assignee。

```text
Task.assigneeAgentId
    表示 Task 的单一最终责任人。

AgentRun.agentProfileId
    表示实际履行某次执行职责的 Agent。
```

两者不要求相同。多个 Agent 可以先后或在权限允许的不同资源上并行为同一个 Task 产生 AgentRun，但 Task 仍只有一个 Assignee；需要独立进度、依赖或验收的工作必须拆为独立 Task。

##### 执行创建规则

接收 Agent 不得仅因 Inbox 正文包含“请继续处理”等自然语言便自行创建 AgentRun。执行型协作必须沿用 DM-12、DM-14 已确认的边界：

```text
Agent A 发出结构化 execution intent
→ Router 选择 Agent B 的 Conversation
→ Core 校验权限与职责幂等键
→ Core 创建或关联 Agent B 的 CampTurn/AgentRun
→ InboxMessage.targetAgentRunId 引用该 Run
→ Dispatcher 将消息可靠写入 Agent B 的 Conversation
→ Runtime 调度既有 AgentRun
```

普通协作通知没有 `targetAgentRunId`，不会自动唤醒新的执行。接收者是否采取后续行动，由新的结构化执行命令或后续 AgentRun 事实体现，不建立独立的 Handoff 接受状态。

##### 普通协作流程

```text
Agent A 是 Task Assignee
→ Agent A 请求 Agent B 协作，并引用 Task
→ Router/Core 为 Agent B 创建或关联目标 AgentRun
→ Core 创建带 targetAgentRunId 的 InboxMessage
→ Agent B 执行并产出结果
→ Agent B 通过 InboxMessage 回复结果
→ Agent A 继续协调 Task
→ 有权 Actor 显式提交 CompleteTask，Core 根据完整证据校验是否允许完成
```

如果 Agent B 无法履行职责，结果由目标 AgentRun 及回复消息表达；Task Assignee 不自动变化。

##### 并发与权限

InboxMessage 不授予 Capability、Approval 或执行锁。接收 Agent 产生副作用前仍必须通过正常的：

- Camp Capability。
- Approval。
- Conversation 的 AgentRun 执行锁。

v0.02 不建立 Workspace 写锁。多个 AgentRun 可以同时写入同一目录，Inbox 与 Core 不替它们消除覆盖、交错修改或 Git 冲突；Agent/User 应在需要并行写入时通过 Worktree Skill 为目标 Run 选择不同目录。无论是否隔离，都不能绕过最终证据和完成门。

##### Assignee 不可变

`Task.assigneeAgentId` 创建后不可修改，也不存在普通赋值或重新分派接口。Assignee 退出 Camp、被禁用或归档时，原 Task 保留绑定并派生 `assignee_unavailable`。若必须换人继续，应取消原 Task 并创建带新 Assignee 的替代 Task，通过 `originTaskId` 保留来源关系；这不是责任转移。

##### 明确不建立

不新增以下实体或表：

```text
handoff
task_handoff
task_transfer_request
handoff_proposal
```

不新增以下 Handoff 专用命令：

```text
ProposeHandoff
AcceptHandoff
RejectHandoff
ExpireHandoff
ReassignTask
```

不设计 Handoff 状态机、接受/拒绝状态、超时、责任转移事务、专用证据表或与 AgentRun 重复的绑定规则。

##### 理由

1. v0.02 的 Task 无需在 Agent 之间转移责任。
2. Task 创建时固定 Assignee，责任边界最清楚。
3. InboxMessage 只传递消息，避免文本被误解释为责任变化。
4. 其他 Agent 的协作由其自身 AgentRun、InboxMessage 或独立 Task 记录。
5. 删除 Handoff 可以减少重复实体、事务边界和异常恢复逻辑。

#### 决策结果

- **决策**：v0.02 不支持责任转移，不建立 Handoff 领域实体、数据表、状态机或专用 API；Task 创建时绑定唯一且不可变的 Assignee；InboxMessage 不表达责任转移。
- **理由**：首版不需要接棒流程，固定 Assignee 已能提供清晰责任边界；加入 Handoff 只会增加没有业务需求支撑的状态和恢复逻辑。
- **领域影响**：非 Assignee Agent 可以通过自己的 AgentRun、InboxMessage 或独立 Task 参与协作，但不能接管既有 Task；需要换人时取消原 Task 并创建带 `originTaskId` 的替代 Task。
- **数据/API 影响**：不增加 Handoff 或 ReassignTask 表/命令；`task.assignee_agent_id` 非空且不可更新；InboxMessage、AgentRun 与 Conversation 均不因消息发生所有权变化。
- **后续事项**：未来只有在出现真实的运行中换人需求时，才重新开启责任转移设计；届时不得通过扩展 InboxMessage 文本语义实现。

### DM-16 Review

- **状态**：已修订
- **Lumen 决策**：v0.02 不引入独立 Review 实体或 Review 专用成果包装，也不固化 Verdict、Finding、Review 状态或返工状态。审查暂时作为普通多 Agent 协作行为，由 InboxMessage、ConversationMessage、CampTurn、AgentRun 和 Task 共同表达。
- **核心问题**：如何保留自然语言审查的灵活性，同时保证执行触发、回复链、返工 Run 和 Task 完成门仍遵守既有协议。

#### 讨论记录

##### 行为边界

Review 不是新的领域对象，而是一种协作过程：

```text
某个 Agent 检查 Task、代码或阶段成果
→ 通过 InboxMessage 向相关 Agent 反馈意见
→ 相关 Agent 自行判断是否继续修改、解释或请求复查
```

消息正文可以包含审查对象、发现的问题、风险与理由、修改建议，以及“建议继续修改”或“可以进入下一步”等自然语言意见。相关 Task、AgentRun、ActionExecution、Git Commit、CampMessage、ConversationMessage 或 MessageAttachment 使用 DM-14 的通用 `InboxMessage.references` 关联，不增加 Review 专用字段。当前执行目录通过 AgentRun Workspace 快照定位，不建立 Worktree 引用。

Reviewer 不是固定领域角色，也不必是 Task Assignee。任何具备相应读取权限的有效活跃 Camp Agent 都可以参与检查。Agent 自行决定是否请求检查、检查范围、是否采纳反馈以及是否再次复查；Core 不根据正文猜测这些意图。

##### 请求执行

普通 InboxMessage 只投递消息，不会创建 CampTurn 或 AgentRun。Agent A 决定需要 Agent B 实际执行检查时，必须发出结构化 execution intent：

```text
Agent A 决定请求 Agent B 检查
→ 发出结构化 execution intent
→ Router 选择 Agent B 的 Conversation
→ Core 在当前因果 CampTurn 追加 AgentRun，或创建新的 CampTurn/AgentRun
→ AgentRun 使用普通自由文本 purpose/expectedOutput 描述检查契约
→ InboxMessage.targetAgentRunId 引用该 Run
→ Dispatcher 将请求写入 Agent B 的 Conversation
```

不增加 `AgentRun.kind='review'` 或固定的 `purpose='review'`。AgentRun 仍必须填写普通自由文本 `purpose` 和 `expectedOutput`；它可以关联同一 Task，也可以在无 Task 的 CampTurn 中执行。最终反馈是该 AgentRun 的输出，不再创建第二个 Review 实体或 Review ID。

##### 回复与复查

Agent B 通过 InboxMessage 回复审查意见，沿用：

```text
inReplyToMessageId
correlationId
references
sourceAgentRunId
targetAgentRunId（仅在回复需要恢复或触发目标 Run 时）
```

无需额外 Review Thread。再次复查仍是 Agent 决定发起的普通结构化执行请求，并产生新的 AgentRun；自然语言中出现“复查”“LGTM”或“需要修改”不会自动调度 Agent。

##### 反馈后的执行

审查反馈是否需要修改由 Agent 或用户决定，并通过显式执行命令进入既有 AgentRun 协议：

```text
原实现 AgentRun 仍为非终态，且反馈不改变执行契约
→ 把相关反馈作为输入继续原 Run，不创建重复 Run

原实现 AgentRun 已进入终态，原 CampTurn 与 Task 均仍非终态，需要在同一职责上返工
→ 通过 CreateReworkAgentRun 为同一 Conversation 和 responsibilityKey
  创建 startReason='rework' 的后继 Run

原 CampTurn 已终态，但原 Task 仍为 pending/in_progress
→ 创建新 CampTurn 与 startReason='initial' 的 Run
→ 通过触发 Inbox/ConversationMessage 与 correlation 追溯原审查，不跨 CampTurn 建 predecessor

原 Task 已 completed/cancelled
→ 创建以旧 Task 为 originTaskId 的新 Task，再创建新的 CampTurn/Run

反馈揭示独立范围的新工作
→ 按现有规则创建绑定固定 Assignee 的新 Task
→ 不使用 TaskProposal
```

审查不能借机改绑既有 AgentRun 或 Task Assignee；DM-15 的无责任转移决策继续生效。

##### 与 Task 的关系

Review 消息不会自动修改：

```text
Task.status
Task.assigneeAgentId
TaskReadiness
```

因此不引入：

```text
in_review
rework
review_blocked
approved
changes_requested
```

需要继续修改时，Task 通常保持 `in_progress`。自由文本审查意见不产生或解除 Task Readiness blocker；依赖、Assignee 可用性、取消编排与未知副作用决定 Task 级 Readiness，Approval、用户输入和运行状态则继续约束各自 AgentRun，并可通过“仍有非终态 Run/未决 Approval”阻止 Task 完成。

##### 审计与完成边界

审查行为的可审计事实来自：

- InboxMessage 的发送者、接收者、正文、回复链和通用引用。
- 发起检查和后续修改所对应的 CampTurn/AgentRun。
- Task、带仓库作用域的 Git Commit、ActionExecution、CampMessage、ConversationMessage 与 MessageAttachment 的稳定引用。
- 后续状态转换和命令写入的 `event_log`。

Lumen 不解析自然语言生成权威 Verdict，也不会因消息出现“通过”“LGTM”或“需要修改”而改变 Task。v0.02 不把 Review 设置为 Rust Core 可机器判断的硬完成门。

Review 消息可以成为人类可读的候选证据，但它本身不会满足完成门或改变 Task。只有用户或具备 `task.complete` Capability 的 Agent 显式提交 `CompleteTask`，把公开、稳定的 Review 结论绑定到具体 Criterion 并作语义满足声明后，它才可能成为该 Criterion 的证据；Core 只校验机器规则、引用资格和声明者权限，不判断自由文本问题是否全部解决。对于“代码状态已经长期保存”这类声明，普通消息或 Patch Attachment 仍不能替代 Repository-scoped Git Commit。

##### 明确不建立

不新增以下实体、表或专用成果类型：

```text
review
review_finding
review_verdict
review_request
review_artifact
review_status
```

不新增以下专用命令：

```text
RequestReview
ApproveReview
RejectReview
ResolveFinding
ReopenReview
```

如果未来明确需要强制 Review Gate、结构化 Verdict、Finding 逐条关闭、多人 Review、与特定 Commit 强绑定或自动阻止 Task 完成，再重新评估独立 Review 模型。

#### 决策结果

- **决策**：v0.02 不建立 Review 领域模型或 Review 专用成果类型；审查作为由 Agent 自主发起的普通多 Agent 协作，通过 InboxMessage、ConversationMessage、CampTurn、AgentRun、Task 和 `event_log` 表达。
- **理由**：当前审查没有独立且必须由平台收敛的生命周期；固化 Verdict、Finding 和返工状态会提前引入工作流与失效规则，而通用消息、引用和执行记录已经足够支撑首版协作与审计。
- **领域影响**：Reviewer 不是固定身份；审查反馈不改变 Task 状态、Assignee 或 Readiness，也不是硬完成门；Agent 决定是否检查、采纳、返工和复查，Core 只处理显式执行意图与状态命令。
- **数据/API 影响**：不增加 Review 表或状态；复用 DM-14 的 `InboxMessage.references`、回复关系和可空 `targetAgentRunId`；增加窄化的 `CreateReworkAgentRun` 命令，并明确它只适用于仍非终态的原 CampTurn，以及存在 Task 时仍非终态的原 Task；跨 CampTurn 返工使用普通新 Run。
- **后续事项**：DM-18 已确认稳定证据引用边界；DM-21/DM-22 已落实完成命令、审计与事务后推进边界；DM-23 已确认 Worktree 只是执行策略，代码审查应引用 AgentRun、Commit 或 Patch Attachment；真实需求出现前不设计 Review Gate。

### DM-17 Decision

- **状态**：已修订
- **Lumen 决策**：v0.02 不引入独立 `Decision` 实体、数据表、状态机或通用 CRUD/API。权威变化由具体领域命令触发，由 Rust Core 校验并原子提交到所属对象状态与 `event_log`；事务后的工作资格必须由这些权威状态直接表达。
- **核心问题**：如何区分授权等待、状态变更意图、机器门禁、Runtime 观察事实与非权威自然语言意见，而不制造万能 Decision 聚合。

#### 讨论记录

##### 语义分工

```text
Approval
    表达一个受限动作尚未获得授权，需要批准或拒绝。

领域命令
    表达某个 Actor 明确请求改变所属领域对象。

Core Gate
    表达权限、对象版本、依赖、运行状态、Approval、
    副作用和持久证据等机器可验证条件。

对象状态
    表达命令最终产生的权威结果。

CampMessage / InboxMessage
    表达建议、解释、Review 反馈和普通协作，不拥有状态转换权。

AgentRun / Runtime Event
    表达执行观察；只有经 executionEpoch fencing、幂等与领域校验后
    由 Core 提交的状态才是 Lumen 的权威事实。

event_log
    记录谁在何时提交了什么命令，以及产生了哪些状态变化。
```

Core 不扫描“完成”“通过”“LGTM”“取消”等自然语言来推断权威决定。Agent 自述、Review 反馈和 Runtime 输出可以成为可读信息或候选证据，但对象状态只能由显式命令或已经定义的确定性聚合规则改变。

`Approval` 的范围必须保持窄：它只回答“这个受限动作是否获准”。并非所有跨重启等待都属于 Approval：补充信息继续使用 `AgentRun.waiting(user_input)`，失败后的继续或放弃分别由 `RetryAgentRun` / `DeclineAgentRunRetry` 处理，普通业务选择由对应的具体领域命令表达。

`Core Gate` 只是各强类型命令自身校验逻辑的统称，不是 `CoreGate` 实体、通用规则引擎、可配置 Workflow 或万能 Gate API。不同命令分别校验自己需要的权限、版本、状态、依赖、运行、Approval、副作用和证据条件。

Approval 必须通过 `actionId` 绑定 `ActionExecution(prepared)`，并冻结用户当时确认的 Kind/Digest；AgentRun 归属由 ActionExecution 确定。批准只对该动作有效，且不能扩大 AgentRun 已冻结的能力/权限上限；长期可复用权限属于 Agent、Camp 或 Conversation 配置，不通过模糊 Approval 授予。批准后的动作是否已经执行、能否重放仍由 DM-20 ActionExecution 负责。

##### 命令边界

典型命令包括：

```text
CompleteTask
CancelTask
RetryAgentRun
CreateReworkAgentRun
DeclineAgentRunRetry
CancelCampTurn
AddTaskDependency
RemoveTaskDependency
ChangeDefaultLead
LeaveCamp
```

上述名称描述不同领域动作，不形成一套可任意装载 `subjectType + payload JSON` 的通用 Decision API。命令可以共享传输信封，但每个命令仍有自己的参数、权限、前置条件和结果类型。

Agent Actor 的最低 Capability 映射固定为：

| 命令 | Capability |
|---|---|
| CreateTask | `task.create` |
| CompleteTask | `task.complete` |
| CancelTask | `task.cancel` |
| Add/RemoveTaskDependency | `task.dependency.manage` |
| 创建新的执行职责/CampTurn | `agent_run.create` |
| RetryAgentRun / CreateReworkAgentRun / DeclineAgentRunRetry | `agent_run.retry` |
| CancelAgentRun / CancelCampTurn | `agent_run.cancel` |
| SendInboxMessage | `inbox.send` |
| BindAgentRunWorkspace | `workspace.bind` |
| 请求受跟踪动作 | `action.request` |
| ChangeDefaultLead | `camp.default_lead.change` |
| 管理其他成员或其 Capability | `camp.member.manage` |
| ArchiveCamp | 仅 User Actor；Agent 无对应 Capability |

CampMember 可以执行自己的 `LeaveCamp`，不需要借助 `camp.member.manage`；移除其他成员仍需要该 Capability。User Actor 的授权来自用户策略，不伪装成 Agent Capability。

公共 Actor 和命令信封仅表达跨命令的基础设施要求：

```ts
type ActorRef =
  | {
      type: 'user';
      userId: string;
    }
  | {
      type: 'agent';
      agentProfileId: string;
      sourceAgentRunId: string;
    }
  | {
      type: 'system';
      componentId: string;
    };

type DomainCommandEnvelope = {
  commandId: string;
  actor: ActorRef;
  expectedVersions: EntityVersionPrecondition[];
  reason?: string;
  evidenceRefs?: EntityReference[];
} & (
  | { actor: Extract<ActorRef, { type: 'agent' }>; executionEpoch: number }
  | { actor: Exclude<ActorRef, { type: 'agent' }>; executionEpoch?: never }
);
```

所有 Actor 都必须有稳定身份，不能用 `null` 代替审计主体。System Actor 使用 `runtime-reconciler`、`inbox-dispatcher` 等稳定组件 ID。Agent 命令必须关联 `sourceAgentRunId` 和本次 Runtime 回调的 `executionEpoch`；Core 校验该 Run 确实属于该 Agent、目标 Camp 和当前 fencing epoch，并依据 `AgentRun.effectiveConfig.capabilities` 授权，不能反查可变 AgentProfile 默认能力，也不存在第二份 `capabilityEnvelope`。旧 epoch 的新命令、输出和状态更新在进入领域命令处理前拒绝；可能对应既有 Action Attempt 的迟到观察不得直接提交结果，但应按 DM-20 的 Action/Attempt fencing 保存为对账输入，避免丢失“副作用其实已经发生”的线索。

`expectedVersions` 不是要求所有命令只校验一个统一 `expectedVersion`。每个命令只声明自己将读取或修改的权威对象版本；涉及 Camp、CampMember 和 Task 等多个对象的原子不变量时，可以携带多个版本前置条件。Core 仍需在同一事务中重新读取并校验真实状态，客户端版本不能代替领域校验。

具体命令保持强类型。例如：

```ts
type CompleteTaskCommand = DomainCommandEnvelope & {
  taskId: string;
  semanticAttestation: true;
  acceptanceEvidence: Array<{
    criterionId: string;
    references: TaskEvidenceReference[];
  }>;
};

type RetryAgentRunCommand = DomainCommandEnvelope & {
  failedAgentRunId: string;
};

type CreateReworkAgentRunCommand = DomainCommandEnvelope & {
  predecessorAgentRunId: string;
  purpose: string;
  expectedOutput: string;
};

type DeclineAgentRunRetryCommand = DomainCommandEnvelope & {
  failedAgentRunId: string;
};

type ChangeDefaultLeadCommand = DomainCommandEnvelope & {
  campId: string;
  successorAgentId: string;
};
```

`CompleteTaskCommand.acceptanceEvidence` 必须恰好覆盖 Task 当前版本中的全部 Criterion；每个 `criterionId` 只出现一次并至少包含一个引用，不得引用未知或已经移除的 Criterion。引用本身不授予访问权，也不证明自然语言条件成立；`semanticAttestation: true` 表示合法 Actor 明确声明当前映射在语义上满足这些 Criterion，并进入 request Digest 与审计。Core 仍对 Git Commit、ActionExecution 和 Attachment 等可机器判断的证据资格执行各自硬校验。

不得提供以下弱类型入口：

```ts
ExecuteDecision({
  type: 'anything',
  payload: unknown,
});
```

##### 命令幂等结果

`commandId` 只是幂等身份，不是幂等实现。Core 必须为所有已经通过信封、身份和 fencing 校验并进入领域处理的命令持久化稳定结果，包括领域门禁拒绝：

```ts
type CommandResultRecord = {
  eventId: string;
  commandId: string;
  commandType: string;
  requestDigestAlgorithm: 'sha256';
  requestDigestVersion: number;
  requestDigest: string;

  outcome: 'accepted' | 'applied' | 'rejected';
  resultCode: string;
  resultSchemaVersion: number;
  resultPayload: JsonObject | null;
  resultDigest: string;
  resultEntityRefs: EntityReference[];

  recordedAt: string;
};
```

`CommandResultRecord` 是读取契约，不是独立领域实体或数据表。DM-21 已确定它由 `event_log` 中唯一、不可变的 `command.result` 事件提供。

`accepted` 表示编排请求已经可靠落库但最终外部结果尚未完成；`applied` 表示立即型状态变化已经在本事务完成；`rejected` 表示命令已被领域层受理，但命令特定门禁未通过。未认证、格式错误、稳定 Actor/来源 Run 不匹配或首次提交时携带旧 `executionEpoch` 的输入在命令受理前拒绝，不写 `command.result`。

`requestDigest` 基于规范化后的命令类型、稳定 Actor 身份、业务参数和版本前置条件计算，并记录 canonicalization 版本；不包含传输时间、Trace ID 等非语义字段。`executionEpoch` 是 fencing 上下文而非业务意图，不进入 digest，使同一语义命令在安全恢复后的新 epoch 可以查询原结果，但首次应用仍必须通过当前 epoch 校验。结果 payload 必须有大小上限、Schema Version 和脱敏规则；大型输出、工具结果与秘密只能通过受控引用返回，不能复制进幂等记录。

行为契约：

```text
相同 commandId + commandType + requestDigestAlgorithm
              + requestDigestVersion + requestDigest
  → 返回已持久化的原 outcome/result
  → 不重复修改状态、写事件或发送 Wake Signal

相同 commandId + 上述任一语义摘要字段不同
  → idempotency_conflict
```

幂等查询必须先于会随时间变化的领域门禁与 epoch 校验：完成认证、解析、规范化和稳定来源校验后，Core 先按 `commandId` 查询既有 `command.result`；完全匹配时直接返回原结果且不重新校验当前对象状态，冲突时返回 `idempotency_conflict`。只有不存在原结果时，才校验当前 `executionEpoch`、Capability、版本和领域门禁。这样，恢复后的合法重试能够得到第一次调用的稳定答案，旧 Runtime 又不能借不存在的命令产生新写入。

一个命令可以产生多个拥有独立 `eventId` 的事件，所以 `commandId != eventId`。`command.result` 是命令基础设施事实，不是 Decision；其唯一约束、事务顺序、事件信封与永久保留规则由 DM-21 定义。

##### 立即提交与编排型命令

命令被 Core 接受不必然表示外部操作已经完成：

```text
立即型命令
    门禁可在当前 SQLite 事务内完全判断并落地。
    例如门禁通过后的 CompleteTask、AddTaskDependency。

编排型命令
    需要停止 Runtime、等待副作用回执或完成对账。
    例如存在活跃 Run 时的 CancelTask、CancelCampTurn、LeaveCamp。
```

立即型命令在同一事务中更新权威状态并写入 `event_log`。如果新状态产生事务后工作资格，提交成功后可以发送可丢失的本地 Wake Signal；类型化扫描器必须能够仅凭权威状态恢复同一工作。

编排型命令的第一事务只能持久化可恢复的“已请求”事实与 `event_log`，不能提前写入虚假的终态。v0.02 的请求真源固定为：Task 的 `cancelRequestedAt/cancelRequestCommandId`、CampTurn 的同名字段、CampMember 的 `leaveRequestedAt/leaveRequestCommandId/pendingDefaultLeadSuccessorAgentId`，以及各目标 AgentRun 的 `cancelRequestedAt/cancelReasonCode`。类型化 Finalizer 从这些字段扫描并推进，待 Runtime 停止、ActionExecution 对账和其他门禁完成后，再由拥有独立幂等身份的系统命令提交最终状态；不得依赖重放 event_log。

几条命令的最低语义如下：

- `RetryAgentRun` 只为当前可人工重试、尚未放弃、没有后继且原 CampTurn 仍非终态的失败 Run 创建同一 Conversation、同一 `responsibilityKey` 的唯一后继，不修改或复活原 Run；若原 Run 关联 Task，该 Task 也必须仍为 `pending/in_progress` 且未请求取消。CampTurn 已终态时改用新 CampTurn 的初始执行请求；Task 已终态时只能按需要创建 origin Task。
- `CreateReworkAgentRun` 只为终态 Run 在同一仍非终态 CampTurn、Conversation 和职责下创建 rework 后继；若原 Run 关联 Task，该 Task 也必须仍非终态。原 CampTurn 或关联 Task 已终态时拒绝，调用方必须创建新 CampTurn，必要时创建新的 origin Task。
- `DeclineAgentRunRetry` 在失败 Run 上一次性持久化 `retryDeclinedAt`，禁止再创建任何后继，请求取消其余非终态 Run，并在对账完成后由聚合规则推动 CampTurn 进入 `failed`。
- `CancelCampTurn` 没有待停止工作时立即应用；否则写入 CampTurn 取消请求，以 `camp_turn_cancelled` 请求取消所有非终态子 Run，只有子 Run 全部终态且副作用完成对账后才进入 `cancelled`。
- `CancelTask` 没有待停止工作时立即应用；否则写入 Task 取消请求，并以 `task_cancelled` 请求停止相关 Run。active unknown 必须继续对账；用户已显式 abandon 的 unknown 允许取消收敛，但永久保留为 Task 的 unresolved effect，不能被终态隐藏。
- `LeaveCamp` 沿用 DM-03：第一事务冻结并立即应用必要继任者、写入成员退出请求，再以 `member_left` 停止该成员的非终态 AgentRun，保留固定 Task Assignee 并派生 `assignee_unavailable`；最后只提交成员 `left`，不延迟 Lead 切换。
- `CompleteTask` 由用户或拥有 `task.complete` Capability 的 Agent 发起；门禁通过时可以直接提交，不需要先创建 Decision 或 Approval。

不提供普通用户命令 `FailCampTurn`。放弃某项必需职责的重试与主动取消整个 CampTurn 具有不同语义：前者通过 `DeclineAgentRunRetry` 最终得到 `failed`，后者通过 `CancelCampTurn` 最终得到 `cancelled`。Retry 与 Decline 都携带失败 Run 的版本前置条件，并在同一写事务中对当前有效 Run、后继和 `retryDeclinedAt` 重新校验，二者只能有一个成功。

##### Task 完成门

`CompleteTask` 至少校验：

- Task 仍处于 `pending/in_progress`、`cancelRequestedAt = null`，且相关版本前置条件未过期。
- 固定 Assignee 仍是当前 Camp 的有效活跃成员；否则原 Task 只能等待恢复或取消后替换，不能以 `CompleteTask` 变相完成责任转移。
- 所有硬依赖已完成。
- 没有关联的非终态 AgentRun。
- 不存在当前 required 职责的失败 Run 同时关联该 Task、仍处于非终态 CampTurn、`manualRetryAllowed = true`、无后继且尚未 Decline 的情况；这项 Task 相关 `retry_decision` 必须先 Retry 或 Decline，不能被完成命令越过。其他 Task 使同一 CampTurn 保持非终态，不阻止当前 Task。
- 没有未决 Approval或任何 active/abandoned unknown ActionExecution。
- `acceptanceEvidence` 恰好覆盖当前 Task 版本中的每条 Acceptance Criterion，且每条至少包含一个持久、可引用的证据。
- `semanticAttestation = true`。
- Actor 是用户，或来源 AgentRun 当前 epoch 合法且其冻结 `effectiveConfig.capabilities` 包含 `task.complete` 的 Agent。Profile/CampMember 后续变化不追溯改写已启动 Run；需要立即撤权时必须显式取消该 Run。

Core 校验的是证据是否存在、引用是否有效、范围是否匹配、各证据类型的机器资格，以及声明者是否有权作语义满足声明；它不从自由文本判断证据是否真正证明了验收条件。v0.02 不把自然语言 Review 当作机器 Review Gate，也不允许普通消息在没有显式 CompleteTask/attestation 时自动完成 Task。

`CompleteTask = applied` 时，Criterion 到证据引用的映射必须作为不可变完成事实持久化，使后续审计不必依赖命令请求正文或重新解析消息。仅保存 `requestDigest` 不足以恢复这条证据链；DM-18 已固定逻辑结构，DM-21 已确定使用与完成事务同写的专用不可变关系存储。

如果当前 AgentRun 在结构化最终输出中同时请求 `CompleteTask`，Runtime 完成回调与 `CompleteTask` 是两个因果关联但结果独立的操作；二者必须有各自的幂等身份和事件语义。Core 在同一个 SQLite 事务中按以下顺序处理：

```text
1. 校验 sourceAgentRunId、Actor 和 executionEpoch
2. 持久化最终输出及验收证据
3. 校验并提交 AgentRun → succeeded
4. 按 DM-12 用更新后的 Run 集合重新聚合并提交 CampTurn 状态
5. 使用更新后的事务内 AgentRun/CampTurn 状态检查 Task 完成门
6. 门禁通过：Task → completed，CompleteTask = applied
7. 门禁未通过：Task 保持原状态，CompleteTask = rejected
8. 写入各自的幂等结果和 event_log；提交后按新状态最佳努力唤醒 Worker
```

只有 AgentRun 成功门通过后才处理 `CompleteTask`；若 Run 仍有未决 Approval、未知副作用或输出自身不完整，Run 终态转换失败，Task 完成请求本轮不进入领域处理。这样可以在 Run 恢复后安全重试，而不会留下一个与非终态 Run 冲突的完成结果。

如果 AgentRun 成功门通过、但 Task 完成门未通过，事务允许提交 `AgentRun = succeeded`、Task 保持原状态，以及持久化的 `CompleteTask = rejected`。这不是半提交：Run 成功与 Task 完成是两个独立结果，不能因为 Task 尚未满足依赖、证据或其他门禁而把已经结束的 Run 回滚成 `running`。事务原子性保证三项结果要么一起持久化，要么都不持久化。

##### 原子提交与审计

每个已受理命令的结果必须在一个 SQLite 事务中落定：

```text
applied
  command.result(applied)
  + 权威领域状态变化
  + 零个或多个其他 event_log 事件
  → 提交后可发送 best-effort Wake Signal

accepted
  command.result(accepted)
  + 可恢复的编排请求事实
  + 零个或多个其他 event_log 事件
  → 提交后可发送 best-effort Wake Signal
  → 启动/周期扫描从请求事实恢复推进

rejected
  command.result(rejected + 结构化原因)
  + 可选的命令特定拒绝事件
  + 不修改命令目标状态、不产生事务后工作资格
```

`command.result` 本身已经是拒绝命令的必需审计事实；只有领域确实需要额外业务语义时才追加专用拒绝事件，不能为每次拒绝机械复制一条同义事件。

编排型命令的最终状态由后续拥有独立幂等身份的系统命令，在 Runtime 停止、ActionExecution 或其他外部事实确认后提交；初始 `command.result(accepted)` 保持不可变，不回写成 `applied`。调用方通过返回的实体引用、correlation 以及后续对象状态/事件追踪最终结果。`AgentRuntimeAdapter` 只能上报带 fencing 的观察，不可绕过 Core 直接改变领域状态。

当同一事务还包含独立的 AgentRun 完成转换时，`CompleteTask = rejected` 只禁止修改 Task，不回滚已经合法提交的 `AgentRun = succeeded`；两者分别写事件并通过因果引用关联。

#### 决策结果

- **决策**：不建立 `Decision` 领域实体。显式领域命令表达变更意图，对象自身状态表达结果，`Approval` 只表达受限动作的授权等待，`event_log` 负责审计。
- **理由**：不同决定拥有不同权限、门禁、等待条件与副作用；通用 Decision 最终只能依赖弱类型 payload，并与对象状态重复。让状态所属对象处理具体命令，语义和事务边界更清楚。
- **领域影响**：Rust Core 只响应显式强类型命令和确定性聚合规则，不从 Camp/Inbox 消息、Review 反馈、Agent 自述或未校验 Runtime 输出推断状态变化；`task.complete` 成为 Task 完成 Capability；`retry_decision` 只是读取模型，放弃重试通过一次性 `retryDeclinedAt` 收敛。
- **数据/API 影响**：不增加 `decision` 表、`decisionId` 或通用 CRUD；命令携带 `commandId`、稳定 Actor、命令特定的版本前置条件，以及可选 Reason/EvidenceRefs。Agent 命令必须关联来源 Run 与 fencing epoch；所有已受理命令的 applied、accepted 或 rejected 结果都必须持久幂等，并与相应状态/请求事实和 `event_log` 原子提交。
- **后续事项**：DM-19 已明确 Approval 的具体动作摘要、范围和有效期；DM-20 已定义获批动作的执行幂等及证据终态；DM-21 已确定 `command.result`/`event_log`、结果脱敏、永久幂等保留和 Criterion—Evidence 物理边界；DM-22 已确定编排型命令由权威请求事实、类型化扫描器和窄化 ACK 恢复，不建立通用 Outbox。

### DM-18 输出与证据（Artifact）

- **状态**：已修订
- **Lumen 决策**：v0.02 不建立通用 `Artifact` 实体、状态、版本、发布流程或专用 CRUD。输出保留在其自然权威对象中；Task 验收通过不可变 Criterion—Evidence 映射引用稳定对象；独立文件使用 MessageAttachment 与 Core 管理的 ManagedBlob。
- **核心问题**：如何在不重复包装 Message、AgentRun、ActionExecution 和 Git Commit 的前提下，让结果可引用、文件可持久保存、Task 完成证据可审计且不会随执行目录清理失效。

#### 讨论记录

##### 输出的自然权威边界

```text
公开自然语言输出
    → CampMessage

Agent 私有连续性中的消息
    → ConversationMessage

Agent 间定向投递记录
    → InboxMessage

投递后在接收方成立的内容事实
    → ConversationMessage

一次公共执行过程与 Agent 执行履历
    → CampTurn / AgentRun

受限动作、平台可观察的副作用及结果
    → ActionExecution（确定终态可投影为 ActionReceipt）

本次执行使用的可变代码空间
    → AgentRun Workspace 快照所指向的文件系统目录

用于 Review 的未提交差异
    → Patch MessageAttachment（非完整、不可重建）

已经提交的代码
    → 带 Repository 作用域的完整 Git Commit OID

显式保存的独立文件快照
    → MessageAttachment + ManagedBlob

状态变化
    → 对象自身状态 + event_log
```

InboxMessage 是可靠传输事实，不是接收方协作结果的唯一真源。投递 ACK 后，接收方 ConversationMessage 才是已经进入对话的内容事实；Agent 对外形成的公开结论应写入 CampMessage。InboxMessage 仍保留发送、回复、关联和投递审计。

##### 不自动提升普通输出

Core 不根据正文措辞、文件扩展名、大小、MIME 或 Agent 自述自动创建成果对象。计划和报告可以是 CampMessage；较长或独立文件可以由用户上传，或由 Agent 显式调用受控“附加/发布文件”工具形成 MessageAttachment。普通 Workspace 文件写入可由 ActionExecution 记录，但不会自动冻结完整工作区，也不会自动复制进 ManagedBlob。

Agent 可以显式附加普通 Patch 供 Review 和协作，但 v0.02 不把它定义为可重建的完整代码快照。Patch 可能缺少未跟踪文件、二进制内容、文件模式、符号链接、Submodule 或工作区其他状态，因此不能仅凭 `baseGitCommit + Patch` 声称已经保存完整 Revision，也不能据此安全清理仍有未提交内容的执行目录。

因此不存在：

```text
Agent 输出“已完成”
→ Core 自动创建 Artifact
→ Artifact 自动满足 Task 验收
```

正确路径是显式保存输出、显式发出 `CompleteTask`，再由 Core 校验 Criterion—Evidence 覆盖和其他完成门。

##### 统一 EntityReference

v0.02 使用闭集、带作用域校验的引用，而不是自由字符串类型：

```ts
type EntityReferenceType =
  | 'agent_profile'
  | 'camp'
  | 'conversation'
  | 'task'
  | 'camp_turn'
  | 'camp_message'
  | 'conversation_message'
  | 'agent_run'
  | 'inbox_message'
  | 'approval'
  | 'action_execution'
  | 'git_commit'
  | 'message_attachment';

type EntityReference<
  T extends EntityReferenceType = EntityReferenceType,
> = {
  entityType: T;
  entityId: string;
};
```

引用记录创建后不可修改，不授予访问权，也不改变目标状态。所有引用必须由 Core 校验类型、存在性、Camp 作用域和调用者可见权限。v0.02 不支持跨 Camp 证据。

`git_commit` 是一个带 Repository 作用域的特殊引用，其语义身份为：

```text
repositoryScope + objectFormat + fullCommitOid
```

`repositoryScope` 使用 DM-01 中 `Camp.repositoryBinding.scopeId`，不是 Git common directory 路径。创建引用时，Core 通过 Binding 当前的 `gitCommonDir` 校验完整 OID、object format 和内部 Ref，然后把稳定 scopeId 随引用冻结；目录重定位只更新 Binding 当前位置，不改变既有引用身份。对 `git_commit` 而言，通用 `EntityReference.entityId` 是上述复合身份的 Core 规范化编码，不等于裸 OID。不能使用裸短 SHA、仅靠可移动分支名定位，也不能把另一个 Camp/Repository Scope 中碰巧相同的 OID 当作当前 Camp 的证据。

同一个 EntityReference 基础格式可以用于不同场景，但允许类型和保留强度不同。DM-14 的 `InboxMessageReference` 使用完整的操作性引用集合；Task 验收使用更窄的集合：

```ts
type TaskEvidenceReferenceType =
  | 'camp_message'
  | 'agent_run'
  | 'action_execution'
  | 'git_commit'
  | 'message_attachment';

type TaskEvidenceReference = EntityReference<TaskEvidenceReferenceType>;
```

Workspace 通过 AgentRun 快照定位，不是 EntityReference。TaskEvidenceReference 的目标必须不可变、Camp/用户可见且受保留保护，不能指向 Task 自身、InboxMessage、执行目录路径、普通 Patch 所代表的未提交工作区或私有 ConversationMessage。Agent 若要使用私有消息中的结论作为完成证据，必须先将必要结论公开为 CampMessage，避免用用户无法审查的私有上下文关闭公共 Task。引用只提供机器可验证资格；合法 CompleteTask Actor 通过 `semanticAttestation` 对自然语言 Criterion 的满足关系负责。

不同证据目标还必须满足：

- AgentRun 已进入终态，且引用只证明该执行及其公开结果确实存在，不代表自然语言验收自动成立。
- ActionExecution 必须满足 DM-20 的证据资格；`prepared/executing/unknown` 不能作为完成证据，人工结果必须保留来源并接受更严格门禁。
- Git Commit 必须携带 Repository 作用域与完整 OID，并在作为长期证据时保持可解析；Core 使用内部 Ref 固定或等价的内容保留机制，不能因分支改写、Worktree 删除或普通 Git GC 失效。若采用内部 Ref，Ref 固定必须先作为可恢复的 Git ActionExecution 达到确定成功，`CompleteTask` 才能接受该 Commit，不能在完成事务后用最佳努力补做。
- MessageAttachment 指向不可变 Blob 快照，且 Attachment 对 Camp/用户可见。
- `kind = review_patch` 的 MessageAttachment 只证明该附件内容存在，可用于 Review；它不证明附件覆盖了完整工作区，也不能充当“代码 Revision 已长期保存”的机器证据。Core 根据显式 kind 判断，不从扩展名、MIME 或正文猜测。
- CampMessage 在成为证据后不得物理删除；普通 UI 删除只能形成仍保留证据内容与完整性信息的 Tombstone。若未来硬性擦除策略必须移除内容，系统必须把相关证据显式标记为不可用并暴露审计影响，不能继续把空 Tombstone 当作有效证据。

##### Criterion—Evidence 映射

Task 完成时必须持久化以下逻辑事实：

```ts
type TaskAcceptanceEvidenceBinding = {
  taskId: string;
  taskVersionAtEvaluation: number;
  criterionId: string;
  references: TaskEvidenceReference[];
  attestedBy: ActorRef;
  semanticAttestation: true;
  completionCommandId: string;
  recordedAt: string;
};
```

Core 在 `CompleteTask` 事务中保证：

- 映射恰好覆盖当前 Task 版本中的所有 Criterion。
- 每个 `criterionId` 只出现一次，且至少拥有一个引用。
- Criterion ID 与引用目标均真实、同 Camp、可见并满足稳定性要求。
- `attestedBy` 与命令 Actor 一致，且 `semanticAttestation = true` 进入请求摘要和不可变完成记录。
- Task 完成后映射不可修改、替换或删除。
- `command.result` 的 `requestDigest` 不能代替这份证据映射。

这是一条 Task 与证据之间的不可变关系，不是 Artifact。DM-21 已确定使用 `task_completion_evidence` 关系存储，并由 `task.completed` 事件引用该完成批次；Task 详情页必须能直接还原每条 Criterion 的文本快照与证据。

##### MessageAttachment 与 ManagedBlob

独立文件拆成领域关联与存储资源两层：

```ts
type ManagedBlob = {
  id: string;
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  storageKey: string;
  createdAt: string;
};

type MessageAttachment = {
  id: string;
  campId: string;
  messageRef: EntityReference<'camp_message' | 'conversation_message'>;
  blobId: string;
  kind: 'file' | 'review_patch';
  fileName: string;
  createdBy: ActorRef;
  createdAt: string;
};
```

ManagedBlob 是 Core 管理的不可变、内容寻址存储资源，不是领域成果，也不直接作为 TaskEvidenceReference。MessageAttachment 表达“哪个消息显式携带哪个文件快照”；DM-20 的 ActionExecution 也可以用 `resultBlobId` 直接保存超出主记录上限的结构化结果，不需要先制造一条消息附件。同一内容可以去重到同一个 Blob，但各领域对象的归属、Actor 和可见性仍彼此独立。

创建文件附件必须来自用户上传或 Agent 的显式受控工具调用。普通附件使用 `kind = file`；Review Patch 必须通过显式 Patch 附加命令创建为 `kind = review_patch`，Core 不从文件名、MIME 或正文推断。若来源是 Worktree 文件，Core 在授权后读取并复制当时内容，后续 Worktree 修改不能改变已经创建的 Attachment。实现至少需要限制大小、规范化文件名、校验/嗅探媒体类型、阻止路径逃逸、避免默认执行或自动打开不可信内容，并在 Blob 元数据与文件落盘不一致时支持恢复对账。

只要 Blob 仍被 MessageAttachment、ActionExecution 或 TaskAcceptanceEvidenceBinding 直接或间接引用，就不得垃圾回收。消息删除、Camp/动作清理和 Blob GC 必须先检查证据保留关系；不能因为删除 UI 消息或普通动作历史而破坏已完成 Task 的验收证据。

##### Workspace、Patch 与 Git 的稳定性

共享目录或 Git Worktree 都是可变运行资源，不是长期成果。AgentRun Workspace 快照只能说明某次执行使用了哪个目录、访问模式、隔离方式和起始 Commit，不能冻结该目录后续内容。

普通 Patch MessageAttachment 只作为 Review/协作附件，不被定义为完整、可重建的代码快照。未提交工作区不能作为长期代码 Revision 证据；如果它仍需保留，用户或 Agent 必须先保留原执行目录，不能因为已经附加 Patch 就清理 Worktree。

需要在执行目录或 Worktree 清理后仍可解析的强代码证据，统一使用 Camp Repository Binding 作用域下的完整 Git Commit OID。Core 必须在证据生效前通过该 Binding 的 `internalRefNamespace` 或等价机制保持 Commit 可达；固定 Ref 属于 Git ActionExecution，必须先确定成功再提交引用它的 Task 完成命令，不能依赖事务后的最佳努力操作。未来出现“不创建 Commit 也要冻结完整工作区”的明确需求时，再评估规范化 ChangeSet 或 WorktreeRevision；v0.02 不引入两者。

##### v0.01 artifact 表迁移

v0.01 数据库中已经存在 `artifact` Schema 骨架，但当前没有完整写入、读取或产品展示路径。v0.02 不再向该表写入，也不把它复用成 ManagedBlob：现有列只有 Task、Kind、Title、URI 和 Metadata，无法提供内容完整性、附件归属、引用保留与 Blob 生命周期语义。

迁移时先保留该表，避免在尚未检查用户数据库前进行破坏性删除。若数据库中没有历史行，可在后续 Schema 整理中移除；若意外存在历史行，应显式迁移或保留只读兼容视图，不能静默丢弃，也不能让新的 EntityReference 指向 legacy Artifact。

#### 决策结果

- **决策**：v0.02 不建立通用 Artifact 领域模型。不同输出保留在 CampMessage、ConversationMessage、AgentRun、ActionExecution、带仓库作用域的 Git Commit 与 MessageAttachment 中；Task 以不可变 EntityReference 映射表达验收证据。
- **理由**：现有自然边界已经分别拥有内容、执行、副作用和代码状态；通用 Artifact 会重复包装权威对象，并引入版本同步、权限、清理和真源冲突。独立文件的实际缺口由窄作用域 Attachment/Blob 模型解决即可。
- **领域影响**：InboxMessage 仍是投递记录而非协作结果真源；可变 Workspace 与普通 Patch 不能冒充完整代码 Revision；私有 ConversationMessage 必须先公开必要结论才能用于关闭公共 Task；Core 不从正文或 Agent 自述自动生成成果。
- **数据/API 影响**：不新增 Artifact API 或新的 Artifact 写入；删除 Inbox 引用中的 `artifact`、`worktree` 和 `worktree_revision`，增加 CampMessage、ActionExecution、Camp Repository Binding 作用域的 Git Commit 和 MessageAttachment 等引用类型；增加统一 EntityReference、带 Actor attestation 的不可变 Criterion—Evidence 映射，以及区分 `file/review_patch` 的 MessageAttachment/ManagedBlob 存储能力。legacy `artifact` 表暂时保留但停止新写入。
- **后续事项**：DM-20 已固定 ActionExecution 的证据终态、来源与完整性边界；DM-21 已确定 Criterion—Evidence 专用关系与事件引用；DM-22 已确定 Blob 优先采用内容寻址预写入 + SQLite 引用 + 孤儿 GC，不为文件移动建立通用队列；DM-23 已确认长期代码证据使用带仓库作用域且保持可达的完整 Commit OID，不建立 WorktreeRevision；实施 ADR 定义 Commit 作用域/固定、附件大小、安全、路径、对账、保留和 GC 策略。当出现独立成果库、跨 Camp 复用、独立 ACL、脱离消息的生命周期或明确发布流程时，再重新评估 Artifact。

### DM-19 Approval

- **状态**：已接受
- **Lumen 决策**：建立一等、持久化 `Approval`，但只表达目标用户对某个 AgentRun 已准备执行的单一具体受限动作所作的一次性授权。
- **核心问题**：让授权跨应用重启仍可恢复，同时精确绑定动作身份和冻结参数，不能被复用于其他动作、代替普通业务决定、扩张 AgentRun 权限或冒充动作执行结果。

#### 讨论记录

##### 严格边界

Approval 回答且只回答一个问题：

> 某个 AgentRun 已经准备好的这个具体受限动作，是否得到指定用户的一次性授权？

它不是：

- 用户补充信息、计划确认或普通业务选择。
- Task 创建、完成、取消，Camp 成员变更或 Default Lead 变更。
- Review Verdict、失败后的重试决定或责任转移。
- 长期工具、命令前缀、目录或 Session 权限。
- Agent 扩大自身 capability/permission 上限的入口。
- 动作已经开始、成功、失败或结果未知的证明。

上述事项分别由 `AgentRun.waiting(user_input)`、强类型领域命令、InboxMessage、权限配置和 DM-20 的 ActionExecution 承担。Approval 的 `approved` 只是一条授权事实，不是动作执行结果。

##### 动作策略：allow / deny / ask

Runtime 请求动作后，Core 先校验 `sourceAgentRunId + executionEpoch`，确认 `effectiveConfig.capabilities` 包含 `action.request`，规范化动作，并在 `effectiveConfig.actionPermissionEnvelope` 与当前不可绕过的安全规则交集中计算策略：

```text
allow
  → 不创建 Approval，进入动作执行协议

deny
  → 不创建 Approval，返回 action_denied_by_policy

ask
  → 持久化 Approval(pending)，形成 approval blocker
```

`ask` 只允许出现在 AgentRun 已冻结上限之内。超出上限、未知 `actionKind` 或命中硬性 deny 的动作必须失败关闭；用户不能通过批准临时扩权。长期权限策略即使随后修改，也不反向改变当前 AgentRun 的有效配置快照；当前更严格的安全策略仍可在执行前阻止旧授权。

Policy 决策本身必须可审计。至少记录 `policyVersion`、命中的稳定规则 ID、`allow/deny/ask` 结果、动作引用和 AgentRun；敏感参数只记录安全摘要，不能复制到 event_log。

是否需要 Approval 由动作策略判断，不按工具名称一刀切。首版常见候选包括未预先允许的 Shell 命令、敏感路径写入或删除、AgentRun executionRoot 外写入、Git Push/Ref 更新/集成、外部写 API 和受限 MCP Tool。只读操作、已在 AgentRun 权限上限内明确允许的 executionRoot 内写入、普通模型请求、Inbox 投递和 `CompleteTask` 等领域命令通常不进入 Approval。

##### 先持久化动作，再等待授权

Approval 不能只引用 Runtime 内存中的 ToolCall。Core 最迟必须在创建 Approval 的同一事务中创建或复用 `ActionExecution(prepared)`；`ActionExecution.id` 就是本节的 `actionId`，在应用和 Native Session 重启后仍能解析到：

- 不可变的规范化语义参数。
- `actionKind`、AgentRun、动作幂等身份与创建时 fencing 信息。
- 实际执行所需的安全参数引用。
- 独立于审批期限的 `executeBefore` 或等价执行有效期。
- 当前动作是否仍可执行，以及后续 Receipt/对账事实。

DM-20 已决定使用单一 ActionExecution 贯穿准备、执行、结果与对账，不建立独立 PreparedAction/ActionReceipt 表。Approval 通过外键引用它，并保留用户当时看到的 Kind/Digest 绑定；不复制完整命令、请求体或秘密。

创建 `pending` Approval 的事务必须同时完成或验证：

```text
创建/复用 ActionExecution(prepared)
→ 创建 Approval
→ 将 AgentRun 聚合为 waiting(approval)
→ 写入 policy / approval event_log
```

事务提交后才能最佳努力提醒用户。提醒丢失不影响恢复：UI 始终从 `Approval.status = pending` 查询权威待办，启动/周期扫描按 Core 时间处理过期与失效。

##### 动作身份、摘要与秘密

Approval 必须绑定：

```text
actionId → ActionExecution.id
+ actionKind
+ actionDigest
+ digestAlgorithm
+ canonicalizationVersion
```

`agentRunId` 由不可变的 ActionExecution 归属确定，不在 Approval 中重复保存。

约束：

- `UNIQUE(action_id)`；一个逻辑动作最多拥有一条 Approval。
- 相同 Action ID 与相同 Kind/Digest 重投时返回既有 Approval。
- 相同 Action ID 携带不同 Kind/Digest 时返回 `action_id_conflict`。
- 语义参数发生变化时，旧 ActionExecution 失效；仍为 pending 的旧 Approval 转为 `cancelled`，并使用新的 Action ID 重新走 Policy。
- 已终结 Approval 永不改写；即使其授权过的 ActionExecution 后来失效，也只在动作记录中表达未执行原因。

`actionKind` 必须来自 Core 管理的封闭、版本化注册表；未知 Kind 失败关闭。`actionDigest` 针对完整规范化语义参数，而不是 UI Summary。规范化至少考虑：

- Shell 的 argv、cwd、相关环境引用与执行模式。
- 文件动作的解析后路径、根目录身份和操作类型。
- Git 动作的仓库、ref、期望 OID 与变更类型。
- 网络动作的 scheme、host、port、method 和请求体摘要。
- MCP 动作的 server、tool 与规范化 arguments。

`actionSummary` 仅用于给人核对，必须由 Core 或受信任 Adapter 从 ActionExecution 的规范化输入派生并脱敏，不能直接相信 Agent 提供的描述。秘密不得以明文进入 Approval、Summary、Digest 输入快照或 event_log；使用稳定 SecretRef + version，或受保护的 keyed digest。对低熵秘密直接做普通哈希仍会泄露可猜测信息。

##### 状态机与最小逻辑结构

```ts
type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "expired";

type ApprovalResolutionCode =
  | "user_approved"
  | "user_denied"
  | "parent_cancelled"
  | "action_invalidated"
  | "policy_hard_deny"
  | "approval_expired";

type Approval = {
  id: string;
  actionId: string; // FK → ActionExecution.id
  actionKind: RestrictedActionKind;
  actionDigest: string;
  digestAlgorithm: string;
  canonicalizationVersion: string;
  actionSummary: string;

  requestedForUserId: string;
  requestPolicyVersion: string;
  matchedPolicyRuleId: string | null;

  status: ApprovalStatus;
  decisionExpiresAt: string | null;

  resolvedBy: ActorRef | null;
  resolutionCode: ApprovalResolutionCode | null;
  resolutionReason: string | null;
  resolvedAt: string | null;

  version: number;
  requestedAt: string;
  updatedAt: string;
};
```

合法转换只有：

```text
pending → approved | denied | cancelled | expired
```

所有终态不可重新打开；新的动作请求创建新的 Action ID 和 Approval。`resolved*` 使用统一命名，因为 `cancelled/expired` 不是人的“决定”。其中：

- `approved/denied` 的 `resolvedBy` 必须是与 `requestedForUserId` 匹配的 User Actor。
- `cancelled/expired` 由稳定 System Actor 提交，并通过 causation 关联父级取消、动作失效或过期扫描。
- `resolutionCode` 使用受控机器码；自由文本理由仅作补充，不驱动状态机。

Approval 不重复保存 `agentRunId`、`campId`、`taskId`、`agentProfileId` 或 `conversationId`，它们由 `actionId → ActionExecution → AgentRun` 确定。`executionEpoch` 也不是 Approval 身份；创建动作与 Approval 的 Runtime 请求必须通过当前 epoch fencing，但恢复后只要逻辑 AgentRun、Action ID 与 Digest 未变化，原 Approval 可以延续。

##### 一次性授权，不承诺 exactly-once

```text
一个 Approval
→ 一个 actionId
→ 一个参数冻结的逻辑动作身份
```

同一动作在传输或进程层面的安全重试可以继续使用原授权，但必须保持相同 Action ID、Digest 和 DM-20 动作级 fencing。是否允许再次派发、如何识别确定结果或 `unknown`，由 ActionExecution 与对账协议决定。Lumen 不因存在 Approval 就宣称外部副作用 exactly-once。

语义上再次执行相同命令仍是新动作，必须生成新 Action ID 并重新经过 Policy。v0.02 不支持 `approve_for_session`、`always_allow`、命令前缀或目录永久授权。未来若 UI 提供“允许本次并更新长期策略”，必须明确提交两个独立命令：

```text
ApproveAction
+ UpdatePermissionPolicy
```

二者分别校验、幂等、审计和显示结果；权限策略更新不改变当前 Run 的冻结快照，也不能复用为当前动作的 Approval。

##### 多审批、投递与 Run 聚合

同一个 AgentRun 可以拥有多个 Approval，每条只对应一个动作。`pending` Approval 才是 blocker，不能把 `AgentRun.waitReason` 或 UI 状态当作审批真源。

Approve/Deny 使用 DM-17 的 `commandId`、请求摘要和 `expectedVersion`，在写事务内以条件更新实现 first-answer-wins：

```text
pending + ApproveAction → approved
pending + DenyAction    → denied
terminal + 任意相反提交 → approval_already_resolved
```

`ApproveAction` 在提交 `approved` 前还必须重新校验目标 User Actor、决定期限、AgentRun 非终态、ActionExecution 仍为 `prepared`、Kind/Digest 一致、冻结能力上限和当前 hard-deny Policy。动作已失效或被当前 Policy 禁止时，Core 应以受控原因把 pending Approval 收敛为 `cancelled`，而不是留下永远无法执行的 approved 或 pending 记录。

解决一条 Approval 的事务写入 Approval 终态、唯一 `command.result`、其他必要 event_log 事件，并按 DM-20 在 ActionExecution 上建立相应执行资格或 Runtime Delivery Checkpoint。事务本身不调用 Runtime，也不执行动作；提交后只发送可丢失 Wake Signal，Action/Runtime 类型化扫描器按 actionId、payload Digest、目标 epoch 和租约恢复。

平台代理的动作由动作执行组件消费授权结果；Provider 内部执行的 ToolCall 则由 `AgentRuntimeAdapter` 接收并回传 Provider。后一类只能按可观察能力记录和对账，不能因为 Lumen 持有 Approval 就声称拥有强幂等或 exactly-once 保证。

Core 随后重新聚合 AgentRun 的全部 blocker：

- 仍有其他 pending Approval 或其他等待事实：Run 保持 `waiting`。
- 所有 blocker 已解除且 Run 仍可继续：才允许 `waiting → running`。
- 拒绝一个动作：向原 Run 投递 `approval_denied_by_user`，由 Agent 重新规划。
- Approval 取消或过期：分别投递 `approval_cancelled` 或 `approval_expired`。
- Policy 直接拒绝：返回 `action_denied_by_policy`，不能与人的拒绝混写。

任何单条审批结束都不会自动完成或失败 Task/CampTurn，也不会无条件把 AgentRun 改为 running。

##### 期限、失效与 TOCTOU

`decisionExpiresAt` 只限制用户能否作出决定。Approve/Deny 与 Expire 使用 Core/数据库时间和同一个 `pending + version` 条件竞争；到期边界统一为 `now >= decisionExpiresAt` 时不能再批准。后台扫描器延迟不延长授权窗口，用户提交时也必须内联检查期限。

动作执行期限属于 ActionExecution 的 `executeBefore`，与审批期限分离。即使 Approval 已 approved，真正执行前仍必须重新验证：

- AgentRun 非终态且动作仍是当前待执行动作。
- Action ID、Kind、Digest 和规范化版本完全一致。
- ActionExecution 仍为 `prepared`；已有确定结果或 `unknown` 时不得派发。
- `executeBefore` 尚未到期。
- AgentRun 的冻结 `effectiveConfig.capabilities` 与 `actionPermissionEnvelope` 仍覆盖该动作。
- 当前不可绕过的 hard-deny Policy、路径解析、Git expected OID 和其他环境前置条件仍成立。

任一条件失败都不得执行。Approval 保留为历史授权事实，动作记录/Receipt 保存失效或拒绝执行结果；不能把 `approved` 偷改成 `denied`。这是防止用户查看与实际执行之间参数、路径、ref 或策略发生变化的 TOCTOU 边界。

父 AgentRun 或 CampTurn 被取消、关联 Task 取消导致 Run 停止、ActionExecution 被替换/失效，或当前硬性 Policy 已禁止该动作时，pending Approval 由 Core 转为 `cancelled`。超过决定期限的 pending Approval 转为 `expired`。两者均不可复用。

##### 恢复与迁移

应用启动后：

1. 重建 pending Approval 列表并按 Core 时间处理已过期记录。
2. 校验每条 Approval 的 AgentRun、ActionExecution、Digest 与可执行性。
3. 从 pending Approval、用户输入和 ActionExecution 等权威事实重新聚合 AgentRun blocker。
4. 扫描已解决 Approval 对应的 ActionExecution：恢复可执行动作和尚未 ACK/安全关闭的 Runtime Delivery Checkpoint；Native Session 可换绑，但旧 epoch 的新写入仍被拒绝。

v0.01 的 Approval 以 Task/native request 为中心，保存 Provider 原始请求，使用 `declined`，支持 `acceptForSession`，并在解决任意一条审批后无条件把 Task 改回 running。v0.02 迁移必须：

- 改为 `agentRunId + ActionExecution` 归属。
- 将 `declined` 统一映射为 `denied`。
- 删除 Session/Task 级授权选项；长期策略使用独立命令。
- 用脱敏 Summary 与动作引用替代 Approval 中的原始敏感参数。
- 用逐动作结果投递和 blocker 聚合替代无条件恢复。
- 对无法补出稳定 Action ID、完整 Digest 和 ActionExecution 的 legacy pending Approval 失败关闭并转为 cancelled，不继承其授权。

#### 决策结果

- **决策**：建立持久 Approval，严格限定为目标用户对一个已持久化、参数冻结的具体受限动作所作的一次性授权。
- **理由**：精确动作绑定、跨重启等待、并发 first-answer-wins、期限与旧授权防复用无法仅靠消息或 AgentRun 的单一等待字段可靠表达；同时保持窄边界可避免 Approval 退化成通用 Decision 或权限系统。
- **领域影响**：Approval 是 AgentRun blocker 的权威来源之一；批准不等于执行成功，拒绝不等于 Run 失败，且任何结果都不能扩大冻结权限。动作执行继续由 ActionExecution 负责。
- **数据/API 影响**：新增 Approval 持久记录；`actionId` 外键引用 ActionExecution，按该动作唯一；保留 Digest/规范化版本、目标用户、决定期限、统一 resolution 字段和乐观版本；提供 `ApproveAction`、`DenyAction` 及内部 Cancel/Expire 命令；创建和解决事务必须同时写入唯一 `command.result`、其他必要 event_log 事件，以及 ActionExecution 上必要的工作资格/投递 Checkpoint。
- **后续事项**：DM-20 已确定 ActionExecution、`executeBefore`、动作级 fencing、Runtime Delivery Checkpoint 和 unknown 对账；DM-21 已固定 Approval/Policy 事件的通用信封、结果脱敏和 v0.02 不自动清理；DM-22 已确认提醒使用 UI 权威查询 + 最佳努力 Wake，动作推进使用类型化状态扫描；实现 ADR 定义 actionKind 注册表、Digest 规范、SecretRef、Policy 匹配与 legacy Approval 迁移。

### DM-20 ActionExecution / ActionReceipt

- **状态**：已修订
- **Lumen 决策**：建立单一、持久化 `ActionExecution`，覆盖动作参数冻结、授权等待、派发、确定结果、unknown 与对账；不建立一一对应的 PreparedAction 和 ActionReceipt 两张表。确定终态的 ActionExecution 可投影为 `ActionReceipt`，但 Receipt 不是第二个领域实体。
- **核心问题**：以一个权威动作身份同时满足 DM-19 的先持久化后审批、动作级 fencing、崩溃恢复、执行能力降级、外部幂等、结果未知和可信对账。

#### 讨论记录

##### 定义与命名

`ActionExecution` 是某个 AgentRun 提出的、语义参数已经规范化并冻结、需要由 Lumen 跟踪授权或执行结果的一个逻辑动作。它覆盖两类风险：

- 需要用户授权的受限动作，包括敏感读取。
- 可能产生平台可观察副作用、重放风险或恢复歧义的动作。

它不是 AgentRun、一次 HTTP 传输尝试、Approval、Lumen 领域命令、Git Commit、Workspace 快照或普通 Runtime 日志。

物理表统一命名为 `action_execution`。`ActionExecution.id` 就是跨协议使用的 `actionId`；不再同时维护另一个语义相同的 ID。`ActionReceipt` 只是 ActionExecution 得到确定终态后的不可变查询/展示投影，不建立独立表、状态机或 EntityReference 类型。

```text
ActionExecution(prepared)
  → 可被 Approval 引用
  → 执行与对账始终沿用同一 actionId
  → 确定终态可读取为 ActionReceipt
```

##### 哪些动作必须进入

是否记录由 Core 的封闭、版本化 `actionKind` 注册表决定，不能由 Agent 正文、工具自述或 HTTP method 自行声明。

必须记录：

- 所有可能成为 Approval 目标的动作，包括敏感文件或凭据读取。
- 所有 Shell 命令；Core 不依赖命令文本猜测“只读”。
- 文件写入、覆盖、删除、Patch 与 AgentRun executionRoot 外访问。
- Git Ref 更新、Push、Merge、Commit 与 Worktree 集成。
- 外部写 API、PR/Issue/消息发送、部署等动作。
- 有副作用或语义未知的 MCP Tool。
- 无法由注册表证明为纯读取且可安全重放的网络调用。

默认不记录：

- 注册表明确证明为纯读取的文件读取、代码搜索和纯计算工具。
- 普通模型请求。
- CampMessage、ConversationMessage 与 InboxMessage 投递；它们已有自己的可靠持久化协议。
- `CompleteTask`、`RetryAgentRun` 等 Lumen 强类型领域命令；它们由 `command.result` 和对象状态记录。

Core/Agent 主动请求的未知 actionKind 一律失败关闭。对于 Runtime 事后才暴露、暂时无法分类的动作，只能使用注册表中专门的隔离 Kind（例如 `runtime_observed_unknown`）创建降级 observed ActionExecution；它不能被重新派发、成为 Approval 目标或自动作为 Task 证据，也不能反向声称已经完成执行前 Policy。

##### 单记录状态机

```ts
type ActionExecutionStatus =
  | "prepared"
  | "executing"
  | "succeeded"
  | "failed"
  | "unknown"
  | "not_executed";

type ActionNotExecutedReason =
  | "policy_denied"
  | "approval_denied"
  | "approval_cancelled"
  | "approval_expired"
  | "execute_before_expired"
  | "parent_cancelled"
  | "precondition_failed"
  | "action_replaced";
```

```text
prepared
  → executing | not_executed

executing
  → succeeded
  → failed
  → unknown
  → prepared       仅当能证明没有触达副作用边界且仍可执行
  → not_executed   仅当能证明未触达边界且动作已失效

unknown
  → succeeded
  → failed
  → prepared       仅 mediated/intercepted 经确定性对账证明未执行且仍可执行
  → not_executed   确认未执行但动作已失效
```

状态语义：

- `prepared`：动作身份与参数已经持久化，尚未进入可能产生副作用的派发；可以等待 Approval。
- `executing`：对 mediated/intercepted，Core 已完成执行前校验并为当前 Attempt 取得动作租约；在 `dispatchMayHaveStartedAt` 持久化后，该 Attempt 才被视为可能已经触达副作用边界。对 observed，它只表示 Runtime 已报告动作开始而结果尚未确定，不声称 Core 曾认领或派发。两种情况都是保守状态，不保证外部动作最终成功。
- `succeeded`：Executor、Reconciler 或受审计人工证明确认动作契约成功。
- `failed`：已得到明确失败结果；可能仍存在已知的部分副作用，不能推导为“未执行”。
- `unknown`：动作可能发生但结果无法确认；不是失败或终态，不得盲目重放。
- `not_executed`：Core 已确认未触达副作用边界，且该逻辑动作不再执行。

`succeeded/failed/not_executed` 是不可变终态。`unknown` 保持可对账；用户放弃继续对账也不把未知事实伪造成终态，具体规则见下文。

Approval 状态不进入 ActionExecutionStatus。批准只使动作具备执行资格；动作仍从 `prepared` 开始进入自己的派发协议。

##### 执行权与控制能力

```ts
type ActionExecutionAuthority = "core" | "runtime";

type ActionControlMode =
  | "mediated"
  | "intercepted"
  | "observed";
```

三种控制能力不可混写：

```text
mediated
  Core/受控 Executor 实际派发动作。
  可提供 prepare-before-execute、动作租约、幂等键和较强对账。

intercepted
  原生 Runtime 负责执行，但会在副作用前暂停并等待 Lumen 返回授权。
  Lumen 可保证先持久化动作与 Approval，执行结果仍以 Runtime 可观察能力为限。

observed
  Runtime 已经开始或完成动作后 Lumen 才收到事件。
  只能记录观察，不保证先落盘、执行前授权、强幂等或完整结果。
```

`executionAuthority = core` 通常对应 `mediated`；`runtime` 可以是 `intercepted` 或 `observed`。Approval 只能引用 `mediated/intercepted + prepared` 的动作。策略要求强制审批或执行前阻断的危险 actionKind 不得在 observed 模式运行；Adapter 能力不足时必须收紧 Sandbox、改由 Core 代理或直接拒绝。

observed 是状态机入口的明确降级例外：由于 Lumen 第一次看见动作时它可能已经开始或结束，Core 可以按可信观察直接创建为 `executing/succeeded/failed/unknown`，并记录 `firstObservedAt` 与缺失的执行前保证；不得伪造一次并未发生的 prepared 转换。只有 mediated/intercepted 动作遵循严格的 `prepared` 起点。

Runtime 若没有提供完整语义参数，observed 记录必须标记 `inputCompleteness = partial`；其 Digest 只证明“已观察字段没有被悄悄改写”，不能代表完整动作身份。这类记录只能用于诊断和对账，不能获批、重放或自动成为完成证据。

每个 `AgentRuntimeAdapter` 必须声明并由集成测试验证：

- 是否支持 prepare-before-execute。
- 是否支持在执行前暂停和回传 Approval。
- 是否提供稳定 Native Action/Tool Call ID。
- 是否提供 started/result 关联。
- 是否支持外部幂等键。
- 是否支持确定性查询或 Transcript 对账。

现有 v0.01 `CodexRuntimeAdapter` 只在特定 Approval RPC 上具备 intercepted 能力，普通事件是事后观察；v0.02 不得把这些 observed 事件升级描述为受 Core 控制的动作。

##### Runtime Delivery Checkpoint

不建立通用 Outbox 后，确实需要送入 Runtime 的结果由所属 ActionExecution 保存一个窄化、类型安全的当前投递 Checkpoint：

```ts
type RuntimeDeliveryCheckpoint = {
  kind: 'authorization_resolution' | 'action_result';
  payloadDigest: string;

  targetExecutionEpoch: number;
  targetNativeRequestId: string | null;

  attemptCount: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;

  acknowledgedAt: string | null;
  closedWithoutAckAt: string | null;
  closeReason: 'parent_run_terminated_after_target_fenced' | null;
  automaticRetryStoppedAt: string | null;
  lastError: string | null;
};
```

这不是第二份动作结果或通用消息队列：结果正文仍只属于 Approval/ActionExecution，Checkpoint 只回答“哪个不可变 payload 是否已经被哪个 Runtime 执行上下文接收”。规则如下：

- 每个 ActionExecution 在 v0.02 最多拥有一个当前 Checkpoint，且 `kind` 由控制模式固定：`intercepted → authorization_resolution`，`mediated → action_result`，`observed → null`。同一动作不得先后把两种投递复用到一个可变槽位；若未来协议确实需要多个独立回传，再引入子记录而不是覆盖历史身份。
- `intercepted` 动作用 `authorization_resolution` 把 allow/deny 送回稳定 Native Request；允许执行的响应可能立即释放 Runtime 副作用，因此发送前必须先建立 Attempt、递增动作 epoch 并持久化 `dispatchMayHaveStartedAt`。
- `mediated` 动作进入确定终态后用 `action_result` 把结构化结果返回 AgentRun；`observed` 动作通常不需要 Lumen 向原 Runtime 回送协议结果。
- `authorization_resolution.targetNativeRequestId` 必须非空。`action_result.targetNativeRequestId` 只有在 Adapter 明确定义了以 `actionId + payloadDigest + targetExecutionEpoch` 恢复上下文的协议时才可为空；空值不能表示“发送给任意当前 Session”。
- `payloadDigest + targetExecutionEpoch + targetNativeRequestId` 决定一次投递目标；ACK 必须匹配全部字段，旧 epoch 或旧 Native Request 的 ACK 只能记为迟到观察。
- Runtime 换绑且尚未 ACK 时必须按 kind 与结果分流，不能统一重绑定：
  - `action_result` 是已经确定的动作结果；Adapter 若支持以 `actionId + payloadDigest` 幂等恢复上下文，可以绑定到经 Core 校验的新 epoch/request。
  - deny/cancel/expired 等不会释放副作用的 `authorization_resolution`，可以绑定到被证明代表同一逻辑动作的新 Native Request，并记录旧目标失效事件。
  - allow 的 `authorization_resolution` 一旦写入 `dispatchMayHaveStartedAt` 或开始第一次发送，就不得仅因 ACK 缺失而绑定到新 Native Request。只有 Reconciler 证明旧请求未接收/未执行，或 Runtime 对同一 actionId 提供已验证的副作用幂等保证时才允许安全重投；否则 ActionExecution 进入/保持 unknown，并先对账。
- 即使目标 epoch/request 没有变化，`authorization_resolution(allow)` 的自动重发也必须由 Adapter 证明其接收协议按 `actionId + payloadDigest + targetExecutionEpoch + targetNativeRequestId` 幂等；否则第一次发送后 ACK 丢失就已经跨过未知边界，Worker 必须停止盲重发并把 ActionExecution 置为/保持 `unknown`。同一目标不天然比换绑目标安全。
- `acknowledgedAt = null && automaticRetryStoppedAt != null` 表示自动重试已经耗尽但“是否曾被接收”仍未知，使 AgentRun 保持 `waiting(runtime_delivery)` 并显示 `automatic_retry_stopped` 细节，等待安全重绑定或人工重试，不能静默丢弃。迟到但身份完全匹配的 ACK 仍可结束投递；它不能被旧 Worker 的迟到错误覆盖。
- `acknowledgedAt` 与 `closedWithoutAckAt` 互斥；任一非空后 Checkpoint 都不再自动重试、重绑定或接受迟到 ACK 改写。无 ACK 关闭只允许稳定 System Actor 在同一事务证明：父 AgentRun 正在提交 `failed/cancelled`，目标 `targetExecutionEpoch` 已不可逆 fencing，且不会再有 Runtime 消费该 payload；`closeReason` 固定为 `parent_run_terminated_after_target_fenced`。普通重试耗尽、Native Session 暂时断开或用户不想等待都不足以关闭。
- 对可能释放副作用的 `authorization_resolution(allow)`，无 ACK 关闭绝不等于“未执行”：只要曾越过 `dispatchMayHaveStartedAt`，ActionExecution 必须先进入/保持 unknown，并按对账或用户 abandon 规则收敛。关闭只表示旧 Runtime 的投递义务终止。迟到 ACK/结果继续作为 late observation 保存，不能重开 Checkpoint 或覆盖 Action 事实。
- 只有 `acknowledgedAt/closedWithoutAckAt` 均为空时才允许人工重试；命令必须清除 `automaticRetryStoppedAt`、设置新的 `availableAt` 并追加审计事件，不得重建 ActionExecution、改变 payloadDigest 或绕过当前目标的 fencing。重新绑定目标则使用单独命令并重新校验父 AgentRun 与新 Runtime 身份。
- ActionExecution 的确定状态和结果一旦终结仍不可修改；Checkpoint 的租约、尝试和 ACK 可以继续推进，但不能反向改变动作事实。

pending Approval 的桌面提醒不使用该 Checkpoint；UI 直接查询 Approval 真源，通知只是最佳努力加速。

##### 动作身份、幂等与外部键

动作由以下不可变事实确定：

```text
actionId
+ agentRunId
+ actionKind
+ actionSchemaVersion
+ actionDigest
+ canonicalizationVersion
```

规则：

- `actionId` 是全局主键，也是 Lumen 内部逻辑幂等身份。
- 相同 ID 与相同 Kind/Schema/Digest 重投时返回既有 ActionExecution。
- 相同 ID 携带不同语义时返回 `action_id_conflict`。
- 语义上再次执行同一个命令仍须使用新 Action ID，并重新经过 Policy/Approval。
- Provider 的稳定 Native Action ID 如存在，应建立 `(agent_run_id, authority, native_action_id)` 唯一约束或等价映射，防止重复观察创建两条动作。

无需再增加语义重复的内部 `idempotencyKey`。但外部系统的键可能有长度、字符集或版本要求，因此使用时必须把实际值与派生版本持久化：

```ts
externalIdempotencyKey: string | null;
idempotencyDerivationVersion: string | null;
```

应用重启或 Adapter 升级后不能临时重新推导出不同外部键。

##### 派发、Attempt 与动作级 fencing

v0.02 暂不建立 `ActionAttempt` 表，但“无表”不等于只保存一个计数器。ActionExecution 必须持久保存当前 Attempt 的稳定身份和动作级 fencing：

```text
activeAttemptId
+ activeAttemptNumber
+ actionExecutionEpoch
+ agentRunExecutionEpochAtDispatch
```

所有 Executor/Runtime 回调必须携带或由 Adapter 稳定映射到上述身份。Core 只有在 actionId、activeAttemptId 和 actionExecutionEpoch 全部匹配时才能条件更新当前动作。AgentRun epoch 用于证明来源 Run；Action epoch 用于阻止同一 Run 内旧 Attempt 的迟到回调。

旧 Epoch、旧 Attempt 或无法关联的回调只追加为 late observation，不能直接改写当前状态，也不能仅因“不匹配”就把当前动作改成 unknown。若该观察可能与当前动作有关，交给 Reconciler 判断。

动作变为可执行时，`ActionExecution(prepared)` 本身就是持久执行意图，不再创建 ExecuteAction Outbox。Action Executor 只扫描 `controlMode = mediated` 且同时满足以下条件的记录：Policy/Approval 已满足、父 AgentRun 仍允许继续、`executeBefore` 未过期、`nextDispatchAt` 为空或已到达，并且不存在有效动作租约。`nextDispatchAt = null` 表示可以立即尝试。`intercepted` 动作由 Runtime Delivery Worker 发送授权结果并按下述同一派发边界建 Attempt。

Executor 第一步在 SQLite 写事务中认领当前 Attempt：

```text
重新校验 Policy / Approval / executeBefore / 前置条件
→ prepared CAS 为 executing
→ 创建 activeAttemptId，递增 actionExecutionEpoch
→ 获取动作执行租约
→ 设置 dispatchMayHaveStartedAt = null
→ 提交事务
```

认领成功仍不允许直接执行外部 I/O。紧邻派发前，Executor 必须在第二个短事务中重新校验 Action/Attempt/Epoch/租约，并先持久化保守边界：

```text
executing + 当前 Attempt/租约仍有效
→ dispatchMayHaveStartedAt = now
→ 提交事务
→ 才允许执行外部 I/O
```

`dispatchMayHaveStartedAt` 表达“从该持久点起，副作用边界可能已经触达”，不是对真实外部开始时间的精确声称。崩溃恢复时：

```text
dispatchMayHaveStartedAt = null
且租约过期、没有 Native/External Operation 证据
  → 可以证明尚未派发，允许回到 prepared 或收敛为 not_executed

dispatchMayHaveStartedAt != null
  → 除非外部幂等键或确定性查询能够给出答案，必须进入 unknown
```

intercepted 动作向 Runtime 发送允许执行的授权结果时也遵循相同保守边界，因为 Runtime 收到 allow 后可能立即执行。拒绝/取消响应不会释放副作用，可以直接把动作收敛为 `not_executed` 并投递拒绝结果。

触达边界前的临时错误可以清除 Attempt、退回 prepared，并通过 `nextDispatchAt` 退避；触达边界后的超时或连接中断不得伪装为普通重试错误。

同一 Action ID 只有在以下任一事实成立时才能再次派发：

- 上一 Attempt 被证明尚未触达副作用边界。
- 外部目标明确支持同一已持久化幂等键的安全重放。
- Reconciler 已确认上一 Attempt 没有执行。

`attemptCount`、当前 Attempt 元数据和最终外部 Operation ID 保存在 ActionExecution；每次尝试的开始、派发边界、Adapter、Native Call ID、结果和错误追加到 event_log。DM-21 已确定 v0.02 不自动删除事件，并要求这些 Attempt 事件至少与 ActionExecution 等寿命保留；未来若无法保证，必须增加最小 action_attempt 存储，不能让恢复依赖已被清理的审计日志。

取消动作只设置 `cancelRequestedAt` 并停止新派发。executing 动作不能因取消请求直接变为 not_executed；必须先得到确定结果或进入 unknown。

##### 结果、部分副作用与 Receipt

结果必须同时区分“动作契约是否成功”和“副作用发生到什么程度”：

```ts
type EffectDisposition =
  | "none"
  | "complete"
  | "partial"
  | "unknown";

type ActionResultSource =
  | "executor"
  | "reconciler"
  | "user"
  | "policy"
  | "system";
```

因此 `failed` 不等于 `effectDisposition = none`；它可以拥有已知 partial effect。`unknown` 对应未知作用范围，禁止自动重试。各 actionKind 的 resultCode、resultData 和对账证据必须由对应版本化 Schema 管理；大结果由 ActionExecution 直接引用 ManagedBlob，不强行伪装成 MessageAttachment，也不把任意无界 JSON 塞入主表。只要动作仍被保留，该 Blob 就属于 GC root。

确定终态的 ActionExecution 可以读取为 ActionReceipt：

```text
ActionReceipt = terminal ActionExecution read model
```

Receipt 沿用同一 Action ID、Kind、Digest、结果来源、EffectDisposition 和完整性摘要，不拥有第二份状态或数据。`action_execution` 是 EntityReference 类型；不新增 `action_receipt` 引用类型。

##### unknown、对账与人工出口

典型 unknown 来源：

- 动作租约过期且无法证明未派发。
- 外部请求发出后、结果提交前崩溃。
- Runtime Session 断开，无法判断 Tool 是否执行。
- Provider 明确表示请求可能已经处理。
- 当前 Attempt 的结果无法与稳定 Native/External ID 对上。

每个 actionKind 可以提供 Reconciler，但结果不能只是一个裸字符串：

```ts
type ReconcileResult = {
  outcome:
    | "confirmed_succeeded"
    | "confirmed_failed"
    | "confirmed_not_executed"
    | "still_unknown";
  observedAt: string;
  evidenceRefs: EntityReference[];
  externalOperationId: string | null;
  result: CanonicalActionResult | null;
};
```

文件可使用解析后路径与前后 Hash，Git 可使用 expected/current/target OID，外部 API 可使用持久幂等键或 Operation ID，Runtime ToolCall 可使用 Native ID、Transcript 与 Tool Result。任意 Shell 如果没有预置动作标记或外部可查询状态，通常不能自动确认。

确定性 Reconciler 可以执行 `unknown → succeeded/failed/not_executed`；仅 mediated/intercepted 在确认未执行且原动作仍有效时才可 `unknown → prepared`。observed 动作永远不能回到 prepared 或由 Core 派发。

完全不可对账时提供两个不同的人工命令，不能用一个“选择结果”API 混淆语义：

```text
AttestUnknownActionResult
  用户提供 outcome、理由和证据引用。
  可收敛为 succeeded / failed / not_executed。
  resolutionSource 固定为 user。

AbandonUnknownActionReconciliation
  用户只表示停止继续追查，不声称实际结果。
  ActionExecution 仍保持 unknown，unknownDisposition = abandoned。

ResumeUnknownActionReconciliation
  用户重新开启主动对账，abandoned → active。
```

两条命令只允许 User Actor，必须携带 `commandId + expectedVersion` 并与 Reconciler 的条件更新 first-writer-wins。Attest 必须提供同 Camp、用户可见、不可自引用的稳定证据；Agent、Default Lead、`AgentRuntimeAdapter` 和 System Policy 均不能替用户作人工证明。

人工 `not_executed` 不得使原 Action ID 回到 prepared；若要再试，创建新 Action ID、重新经过 Policy/Approval。人工确认的 succeeded 默认不能被 Agent 发出的 `CompleteTask` 自动接受，只有用户显式提交完成或策略明确允许人工证据时才能使用。

`unknownDisposition = abandoned` 可以解除 AgentRun 对“必须继续主动对账”的运行占用，使 Run 收敛为 failed/cancelled，但：

- Run 不能 succeeded。
- 非终态相关 Task 继续保留 `unknown_action_outcome` blocker，只能等待后续证据或执行 CancelTask。CancelTask 可以把 abandoned unknown 作为“用户接受未知风险并停止等待”的事实完成取消，但 Task 的 `unresolvedEffects` 必须永久显示该动作；它仍绝不能用于完成 Task。
- 旧动作不能重放。
- 后续权威观察仍可继续对账并更新 unknown。

人工终结后若出现冲突的迟到权威观察，不能静默覆盖终态；追加 `action_execution.observation_conflict`，在 UI 标记争议并阻止进一步自动使用。

##### 与 Approval 的事务关系

```text
Policy = ask
  创建/复用 ActionExecution(prepared)
  + Approval(pending)
  + AgentRun blocker 聚合
  + event_log
  → 提交后 best-effort 唤醒 UI

Approval = approved + mediated
  Approval → approved
  + ActionExecution 保持 prepared
  → 提交后 best-effort 唤醒 Action Executor

Approval/Policy = allow + intercepted
  建立 authorization_resolution RuntimeDeliveryCheckpoint
  → Runtime Delivery Worker 按动作/epoch 认领并投递

Approval = denied/cancelled/expired
  仅在 ActionExecution 仍为 prepared 时：
  Approval → 对应终态
  + ActionExecution → not_executed
  + 建立与控制模式匹配的 RuntimeDeliveryCheckpoint
  → 提交后 best-effort 唤醒 Runtime Delivery Worker
```

上述状态变化各自在单一 SQLite 事务中提交；事务本身不执行外部动作。若 ActionExecution 已不再是 prepared，Approval 解决命令必须失败关闭或进入冲突处理，不能覆盖已经存在的执行事实。Wake 丢失后，Executor/Delivery Worker 必须能从 ActionExecution 与 Approval 的权威状态重新发现同一工作。

Policy 直接 allow 的受跟踪动作仍先创建 ActionExecution(prepared)，再由对应类型化 Worker 可靠推进。Policy deny 的受跟踪动作在同一事务中记录为 `not_executed(policy_denied)`，必要时建立动作结果投递 Checkpoint，但不创建 Approval。

##### 与 AgentRun、Task 和证据的关系

ActionExecution 不直接推动 AgentRun 成功：

```text
succeeded / failed / not_executed
  → mediated：建立 action_result RuntimeDeliveryCheckpoint
  → intercepted：由 Runtime 原生执行流返回结果，不重复建立 Lumen 结果投递
  → observed：仅记录观察
  → Agent 决定继续、改道或结束

unknown(active)
  → AgentRun waiting(unknown_action_outcome)
```

AgentRun 进入 succeeded 前必须确保：

- 没有仍需执行的 prepared 动作。
- 没有 executing 动作。
- 没有 unknown 动作，包括 abandoned unknown。
- 没有未决 Approval。
- 每个 Runtime Delivery Checkpoint 都已终结：`succeeded` 只接受 ACK，`failed/cancelled` 才可接受父 Run 终止后的安全关闭；仅设置 `automaticRetryStoppedAt` 仍是未终结 blocker。

解决一条 Approval 或 Action 终态不会直接执行通用 `ResumeAgentRun`。每次状态/ACK 变化后 Core 重新聚合全部 blocker；只有 pending Approval、Action 执行/unknown、Runtime Delivery、用户输入和其他等待事实全部解除时，Run Scheduler 才能把原 AgentRun 从 waiting 恢复为 running。

Task 验收统一引用 `EntityReference<"action_execution">`：

- `prepared/executing/unknown` 不能作为完成证据。
- `not_executed` 不能证明目标副作用完成。
- `failed` 可以作为诊断或明确负向验收的证据，但不能证明预期写操作成功。
- 具有完整、可验证结果的 `succeeded` 通常可以作为对应动作证据。
- `resolutionSource = user` 的成功必须保留证据与人工标识，默认不允许 Agent 自主据此完成 Task。
- `controlMode = observed` 的证据必须显示降级保证，是否满足 Criterion 由完成门策略明确决定。
- `inputCompleteness = partial` 只能用于诊断和对账，不能满足 Task Criterion。

##### 最小逻辑结构

```ts
type ActionExecution = {
  id: string; // 即 actionId
  agentRunId: string;

  actionKind: RestrictedActionKind;
  actionSchemaVersion: string;
  actionDigest: string;
  digestAlgorithm: string;
  canonicalizationVersion: string;

  canonicalInput: CanonicalActionInput;
  inputCompleteness: "complete" | "partial";
  actionSummary: string;

  executionAuthority: ActionExecutionAuthority;
  controlMode: ActionControlMode;
  nativeActionId: string | null;
  firstObservedAt: string | null;

  executeBefore: string | null;
  status: ActionExecutionStatus;
  notExecutedReason: ActionNotExecutedReason | null;
  unknownDisposition: "active" | "abandoned" | null;

  attemptCount: number;
  activeAttemptId: string | null;
  activeAttemptNumber: number | null;
  actionExecutionEpoch: number;
  agentRunExecutionEpochAtDispatch: number | null;

  executionLeaseOwner: string | null;
  executionLeaseExpiresAt: string | null;
  dispatchMayHaveStartedAt: string | null;
  nextDispatchAt: string | null;
  cancelRequestedAt: string | null;

  externalIdempotencyKey: string | null;
  idempotencyDerivationVersion: string | null;
  externalOperationId: string | null;

  resultCode: string | null;
  resultSchemaVersion: string | null;
  resultSummary: string | null;
  resultData: CanonicalActionResult | null;
  resultBlobId: string | null; // FK → ManagedBlob，仅用于大结果
  resultDigest: string | null;
  effectDisposition: EffectDisposition | null;
  resolutionSource: ActionResultSource | null;
  resolutionEvidenceRefs: EntityReference[];

  runtimeDelivery: RuntimeDeliveryCheckpoint | null;

  lastErrorCode: string | null;
  nextReconcileAt: string | null;
  version: number;

  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
};
```

`canonicalInput` 与 `resultData` 在逻辑模型中是 actionKind + schemaVersion 对应的封闭 discriminated union；即使 SQLite 使用 JSON，也只能由 Core 的对应 Schema 编解码和校验。秘密使用稳定 SecretRef + version 或受保护摘要，不能复制到 Summary、event_log 或普通结果 JSON。

核心不变量：

- 参数、Kind、Schema、Digest、Authority 和 ControlMode 创建后不可修改。
- mediated/intercepted 从 prepared 开始；observed 可从首次可信观察对应的状态进入，但必须有 `firstObservedAt`。
- mediated/intercepted 必须拥有 complete input；partial input 只允许 observed，且不得审批、派发或自动作为 Task 证据。
- prepared 没有 active Attempt，且 `dispatchMayHaveStartedAt = null`。mediated/intercepted 的 executing 必须有 Attempt、动作 Epoch 与租约身份，允许在认领后、保守派发边界写入前短暂保持 marker 为空；租约可以因进程崩溃而过期，过期表示当前 Worker 已失去写资格并触发恢复，不使持久记录违反数据库约束。observed 的 executing 是 Runtime 观察状态，不要求也不得伪造 Core 执行租约/Attempt，但必须有 `firstObservedAt` 和可用的 Native/External 观察身份，且永远不具备派发资格。
- unknown 保留最后一个可能触达副作用的 Attempt 身份；observed 动作没有 Core Attempt 时，至少保留 `firstObservedAt`、可得的稳定 Native/External Operation 身份和观察事件引用。
- unknown 时 disposition 必须为 active/abandoned，其他状态必须为 null。
- 确定终态必须有 `endedAt`、result source 和完整性信息，并释放动作租约。
- not_executed 必须有受控原因且 `effectDisposition = none`。
- failed 的 effectDisposition 不能缺失；partial effect 必须在结构化结果中可见。
- observed 动作不得拥有 Approval，也不得伪造执行前 Policy 事实。
- Runtime Delivery Checkpoint 的 payload Digest 必须由 Approval/ActionExecution 权威内容派生；传输失败或无 ACK 安全关闭不改写 Approval 或 ActionExecution 的既有业务结果。
- ActionExecution 进入确定终态后，只有 Runtime Delivery 的租约、重试、重绑定和 ACK 元数据仍可推进；状态、结果、EffectDisposition 与证据保持不可变。

##### 恢复、保留与迁移

应用启动后：

1. `prepared` 根据 Approval、Policy、executeBefore、`nextDispatchAt` 和父 Run 状态继续等待、由 Action Executor 认领，或收敛为 not_executed。
2. mediated/intercepted 的 `executing` 先检查动作租约、`dispatchMayHaveStartedAt`、Native/External Operation 和外部幂等能力；marker 为空且能证明未派发才回 prepared，否则进入 unknown 或确定结果。observed 的 `executing` 只等待或对账 Runtime 观察，绝不回 prepared 或由 Core 重新派发。
3. `unknown(active)` 按 `nextReconcileAt` 调度 Reconciler；abandoned unknown 不主动高频重试，但保留人工恢复入口。
4. 尚未 ACK/安全关闭的 Runtime Delivery Checkpoint 按 `availableAt` 和租约重试；失败记录保持可见，不能改变动作结果。父 Run 终止且目标 epoch 已 fencing 时，可以用受审计系统命令安全关闭投递；allow 可能已送达时仍须保留 Action unknown/对账事实。
5. 确定终态不重放；迟到回调只按 Attempt fencing 接受或记录冲突。

被 Task 证据、未完成 AgentRun、pending Approval 或 unknown 对账引用的 ActionExecution 及必要 Attempt 事件不得清理。DM-21 已确定 v0.02 不自动删除 event_log；后续引入归档前必须先满足该引用和同寿命约束。

v0.01 没有可证明完整的 prepare-before-execute 动作记录，不从普通 Tool Event 猜测并回填历史 ActionExecution。新协议启用后只写新记录；legacy pending Approval 按 DM-19 失败关闭。v0.01 `CodexRuntimeAdapter` 必须先完成能力声明和 Native ID/Attempt 映射，才能把对应动作标记为 intercepted，而不是 observed。

#### 决策结果

- **决策**：建立单一 ActionExecution 权威记录；确定终态按同一记录投影 ActionReceipt，不建立 PreparedAction、ActionReceipt 或 ActionAttempt 领域表。
- **理由**：准备、授权、执行、结果与对账共享同一动作身份；拆成一一对应对象会重复 ID/Digest 并制造同步窗口。单记录可以真实表达 `executing → unknown → reconcile`，同时通过动作级 fencing 阻止旧 Attempt 污染。
- **领域影响**：Approval 只授权 ActionExecution；AgentRun 从 Approval 与 ActionExecution 聚合 blocker；人工放弃对账不改写 unknown 真相；平台代理、Runtime 拦截和事后观察拥有不同保证等级。
- **数据/API 影响**：新增 `action_execution` 表、状态机、动作执行租约、activeAttemptId、actionExecutionEpoch、`dispatchMayHaveStartedAt`、`nextDispatchAt`、外部幂等键、Runtime Delivery Checkpoint、结果来源与 EffectDisposition；Approval 外键引用 ActionExecution；Runtime 提议、投递 ACK 和回调必须携带或可稳定映射 Action/Attempt/Epoch/Native Request；增加 Prepare/Claim/MarkDispatchMayStart/RecordResult/MarkUnknown/Reconcile/Attest/Abandon 等强类型命令。
- **后续事项**：DM-21 已定义 Attempt、对账、人工证明和冲突观察事件的同寿命保留；DM-22 已确认 Action Executor、Reconciler 与 Runtime Delivery Worker 直接扫描 ActionExecution，不建立 ExecuteAction/DeliverResult Outbox；DM-23 已确认文件/Git/Worktree 操作仍走 ActionExecution，并以带仓库作用域的完整 Commit OID 作为可跨 Workspace 清理保留的代码证据；实现 ADR 定义 actionKind Schema 注册表、Adapter 能力矩阵、SecretRef 和 v0.01 降级迁移。

### DM-21 command.result / event_log

- **状态**：已修订
- **Lumen 决策**：扩展现有 `event_log` 为通用追加式审计时间线；不建立独立 `command_record` 表或 CommandRecord 领域实体。每个已进入领域处理的命令在 `event_log` 中写且只写一条特殊、不可变的 `command.result`，作为幂等结果真源。
- **核心问题**：既避免重复的命令记录体系，又必须保证命令结果唯一、并发安全、可长期查询且不会被普通日志清理破坏。

#### 讨论记录

##### 权威边界

Lumen 使用三类不同事实，不互相替代：

```text
对象表
    当前业务状态的权威来源。

event_log 普通事件
    已发生状态变化、执行观察与因果关系的追加式审计记录。

event_log.command.result
    一个已受理强类型命令当时返回结果的永久幂等事实。
```

`event_log` 不是 Event Sourcing 真源，不能取代 Task、AgentRun、Approval 或 ActionExecution 的当前状态表；也不是持久工作队列。类型化 Worker 只能扫描权威对象的当前资格，不能通过重放事件触发副作用。

`command.result` 是一种有特殊约束的基础设施事件，不是 Decision、CampTurn、AgentRun，也不拥有独立业务生命周期。一个命令可以产生多个普通领域事件，但只能产生一条 `command.result`，且 `commandId != eventId`。

##### 最小事件信封

所有新 v0.02 事件使用统一信封：

```ts
type EventEnvelope = {
  eventId: string;
  globalSequence: number;

  transactionId: string;
  transactionIndex: number;

  eventType: string;
  schemaVersion: number;

  commandId: string | null;
  correlationId: string;
  causationEventId: string | null;

  actor: ActorRef;
  primarySubject: EntityReference | null;

  payload: JsonObject;

  occurredAt: string;
  recordedAt: string;
};
```

语义约束：

- `eventId` 是跨导入、重试和同步仍稳定的事件身份；`globalSequence` 只表达本地 SQLite 提交顺序。
- 同一事务共享 `transactionId`，按 `transactionIndex` 和 `globalSequence` 保留确定顺序。
- `commandId` 关联直接由该命令产生的全部事件；非命令事实可以为空。
- `causationEventId` 指向直接触发当前事实的事件；`correlationId` 关联跨多个命令、类型化 Worker 和 Runtime 回调的同一业务过程。
- `primarySubject` 只用于稳定索引主要对象；其他相关对象放在类型化 payload 的 `references` 中，不能依靠任意 JSON 扫描完成核心查询。
- `occurredAt` 表示外部事实实际发生时间，`recordedAt` 表示 Core 持久化时间。Core 自身状态转换通常二者相同。
- `eventType` 必须来自注册表并采用版本化 payload；不提供接受任意 `eventType + payload` 的公共 `AppendEvent` API。

Actor 使用 DM-17 的 `ActorRef`。事件不得保存模型隐藏推理、原始秘密、无限日志或二进制正文；大结果通过 EntityReference 或 ManagedBlob 引用，敏感值在写入前完成脱敏。

##### command.result 契约

`command.result` 的 payload 使用封闭结构：

```ts
type CommandResultEventPayload = {
  commandType: string;

  requestDigestAlgorithm: 'sha256';
  requestDigestVersion: number;
  requestDigest: string;

  outcome: 'accepted' | 'applied' | 'rejected';
  resultCode: string;
  resultSchemaVersion: number;
  resultPayload: JsonObject | null;
  resultDigest: string;
  resultEntityRefs: EntityReference[];
};
```

`resultPayload` 必须由 `(commandType, resultSchemaVersion, resultCode)` 对应的封闭 Schema 校验，并设置硬大小上限；超限内容只能写入自然权威对象或受管 Blob，再保存引用。`resultDigest` 基于规范化、脱敏后的结果计算，用于完整性检查，不作为第二份业务状态。

`accepted`、`applied`、`rejected` 均为第一次处理时的最终命令返回值，写入后不可修改：

- `accepted` 表示编排请求已经可靠落库；后续最终状态由对象状态、correlation 及拥有新 commandId 的系统命令表达，不能回写原事件。
- `applied` 表示该命令的立即型领域变化已在同一事务完成。
- `rejected` 表示命令已进入领域处理，但 Capability、版本或命令特定门禁未通过。`command.result` 本身就是必需拒绝审计；只有存在额外业务语义时才追加专用拒绝事件。

事件表必须把 `command_id`、`command_type`、`request_digest_algorithm`、`request_digest_version` 和 `request_digest` 作为可直接约束、索引的列；它们对普通事件可以为空，对 `command.result` 必须非空。最低数据库约束为：

```sql
CREATE UNIQUE INDEX uq_event_log_command_result
ON event_log(command_id)
WHERE event_type = 'command.result';
```

同时使用 `CHECK` 或等价的 Core 写入约束，保证 `command.result` 的命令列和结果 payload 齐全。`commandId` 在整个本地数据库中使用全局命名空间，不按 Camp、AgentRun 或实体重新计数。

##### commandId 与请求摘要来源

`commandId` 必须在可信边界生成并在重试中复用：

- UI 在第一次提交前生成并持有随机 ID。
- Agent 工具调用由 Core/`AgentRuntimeAdapter` 根据已持久化的 Native Tool Call 映射生成；模型正文中的自由文本 ID 不可信。
- System/Reconciler/Scanner 命令使用已持久化 ID，或根据稳定原因、目标版本与命令类型确定性派生。

`requestDigest` 覆盖命令类型、可信 Actor、规范化业务参数和版本前置条件；排除 Trace ID、传输时间、租约拥有者和 `executionEpoch` 等非语义传输/fencing 字段。秘密使用稳定 SecretRef 或不可逆摘要参与规范化，不能把秘密明文复制进事件。规范化算法升级必须递增 `requestDigestVersion`，历史结果继续按原版本比较。

##### 记录范围

以下入口必须产生 `command.result`：Renderer/API/Agent 可重试的状态变更命令、会创建或修改领域对象的命令、会产生事务后工作资格的命令、Runtime 重连后可能重复上报的关键状态提交，以及 Approval、Retry、Decline、Cancel、Complete 等一次性选择。

查询、流式 Token/Thinking Delta、普通运行日志、纯内存计算、同一命令事务内的确定性派生更新和受理前失败不产生 `command.result`。例如 `CompleteAgentRun` 同事务聚合 CampTurn 时只记录外部命令的一条结果；只有聚合被延后并由新的可重试系统命令推进时，后者才拥有自己的 commandId 和结果。

##### 受理、幂等与 fencing 顺序

命令处理顺序固定为：

```text
认证、解析 Schema、解析可信 Actor、规范化并计算 requestDigest
    ↓
开始 SQLite 写事务并按 commandId 查询 command.result
    ├─ 类型、Digest 算法、版本和 Digest 完全相同
    │    → 返回原始结果；不重新校验当前状态，不写事件或发送 Wake
    ├─ 任一项不同
    │    → idempotency_conflict；不得覆盖原结果
    └─ 不存在
         → 校验来源 Run、当前 executionEpoch、Capability、版本和领域门禁
         → 提交 applied / accepted / rejected
```

完全相同的历史命令可以在 Runtime 恢复换用新 epoch 后查询原结果，因此 `executionEpoch` 不进入业务摘要；但一个尚无结果的新命令必须携带当前 epoch，旧 Runtime 不得产生新状态、事件或副作用。向调用方返回原 payload 仍需通过当前读取权限检查；幂等命中本身绝不重新执行命令。

以下输入在领域受理前失败，不写 `command.result`：未认证、命令 Schema/规范化失败、无法解析可信 Actor、Agent 与来源 Run 的稳定身份不匹配，以及不存在历史结果时的旧 epoch 回调。合法命令进入领域层后，即使因 expectedVersion、Capability 或业务门禁被拒绝，也必须写 `command.result(rejected)`；调用方修正请求后需要使用新的 commandId。

##### 事务与并发

同一命令的读取、门禁、状态变化、普通事件和 `command.result` 必须位于同一个 SQLite 写事务。实现应使用单写者或 `BEGIN IMMEDIATE` 尽早取得写锁，并在锁内再次查询 commandId：

```text
BEGIN IMMEDIATE
  → 查询既有 command.result
  → 校验当前领域状态
  → 更新对象状态或写入可恢复请求事实
  → 追加普通领域事件
  → 最后追加 command.result
COMMIT
  → 根据已提交的新状态 best-effort 发送本地 Wake Signal
```

事务内不得进行 Runtime、文件系统、网络或其他不可回滚外部 I/O；Wake 也只能在提交成功后发送。极端并发下如果唯一索引仍冲突，整个事务回滚后重新读取已提交结果；不得保留部分状态或事件。

完全重复的调用不追加“再次看见命令”事件。需要统计重试时使用不影响领域审计的运行指标。Digest 冲突可以写入限流的安全/运维日志，但不能修改原 `command.result`，也不能把冲突尝试伪装成该 commandId 产生的业务事件。

##### Task 完成证据

Task 完成不能只依赖 `CompleteTask` 请求或 `task.completed` 事件中的可清理 JSON。v0.02 使用不可变关系存储 Criterion—Evidence 映射；它是 Task 完成事实的一部分，不是 Artifact 或新领域实体：

```ts
type TaskCompletionEvidenceRow = {
  taskId: string;
  taskVersionAtEvaluation: number;

  criterionId: string;
  criterionTextSnapshot: string;
  evidenceOrdinal: number;
  evidenceRef: TaskEvidenceReference;

  attestedBy: ActorRef;
  semanticAttestation: true;
  completionCommandId: string;
  completedEventId: string;
  recordedAt: string;
};
```

`taskVersionAtEvaluation` 是完成门读取并验证 Acceptance Criteria 时的 Task 版本，不是状态转换后的新版本。`Task → completed`、全部证据行、`task.completed` 和 `command.result(applied)` 在同一事务写入。主键至少覆盖 `(task_id, criterion_id, evidence_ordinal)`；同一 Criterion 的重复引用必须拒绝，attestation 与命令 Actor 必须一致。Task 不支持 reopen，因此不存在 Task generation；追加工作创建新的 Task，并以 `originTaskId` 关联旧 Task，新 Task 必须提交自己的完整证据映射。

##### 保留与清理

v0.02 不自动删除 `event_log` 行。以下规则是协议约束，而不是普通日志配置：

- `command.result` 必须在当前数据库生命周期内永久、可索引地保留，否则旧 commandId 会在清理后被错误地再次执行；它不得随 Camp、Task、AgentRun 或 Subject 做级联删除。
- Task 完成证据和对应 `task.completed` 事件不得早于 Task 历史删除。
- Action Attempt、派发边界、对账、人工证明和冲突观察事件至少与其 ActionExecution 同寿命；如果未来无法保证，必须增加最小 `action_attempt` 子表，不能让恢复依赖已清理事件。
- 被非终态 AgentRun、pending Approval、active/abandoned unknown ActionExecution 或其他活跃 blocker 引用的事件不得清理。

Camp、Task 和作为完成证据的消息在 v0.02 只归档/Tombstone，不做普通硬删除，因此外键、审计和证据保留不与 UI 删除冲突。允许按 DM-14 到期硬删除的普通 InboxMessage 是明确的短保留例外：它不能成为 Task 证据，也不能带 `targetAgentRunId`；历史 `command.result`/event_log 中保存的 Inbox ID 仍作为已发生命令的标识，但解析目标时可以返回 `not_retained`，不得据此重新执行原命令。`retryOfMessageId` 按 DM-14 使用 `ON DELETE SET NULL`。

未来若为普通审计事件增加归档或保留期限，必须先证明 `command.result` 查询仍永久有效。可以把永久命令结果胶囊迁移到新的物理存储，但迁移前后只能有一个逻辑真源，不能静默删除后重新开放 commandId。

若用户执行要求物理擦除的安全删除，系统必须同时阻断旧客户端、Runtime 和扫描器租约输入并轮换该数据库的 command namespace；或者仅保留不含业务正文的最小防重放胶囊。不能一边删除幂等事实，一边继续接受旧 commandId。

##### v0.01 event_log 迁移

当前 v0.01 `event_log` 以非空 `task_id` 和 `UNIQUE(task_id, sequence)` 为核心，无法承载无 Task 命令、Camp、Inbox、Approval、ActionExecution 和全局事件顺序。v0.02 必须通过 SQLite table-rebuild migration 建立通用事件表，不能只追加少数字段继续沿用旧约束。

迁移规则：

1. 为旧事件分配新 `eventId` 和 `globalSequence`，以 Task EntityReference 作为 `primarySubject`。
2. 保存旧表 ID、Task 内 sequence、原 eventType 和原 payload 作为 legacy schema 信息，避免冒充新协议事件。
3. 不从 v0.01 Tool Event、Message 或 Task 事件猜测和补造历史 `command.result`。
4. 切换后所有新写入只使用 v0.02 事件信封；legacy 数据保持可读但不参与命令幂等判断。

建议最小索引包括 `event_id` 唯一索引、`global_sequence` 顺序索引、上述 commandId 部分唯一索引，以及 `(primary_subject_type, primary_subject_id, global_sequence)`、`(correlation_id, global_sequence)` 和 `(event_type, global_sequence)`。

##### API 边界

保留强类型领域命令，不增加 `ExecuteDecision`、任意 payload 的 `ExecuteCommand` 或 event CRUD。基础设施可以提供受权限控制的内部读取：

```text
GetCommandResult(commandId)
ListEventsBySubject(subject, cursor)
ListEventsByCorrelation(correlationId, cursor)
```

`GetCommandResult` 返回第一次提交时的结果快照，不重新读取对象并拼装一个“最新结果”。普通事件只能追加，修正错误事实时写 compensating/correction 事件，不原地编辑历史行。

#### 决策结果

- **决策**：采用方案 C。不建独立 `command_record` 表；每个已受理命令在通用 `event_log` 中保存唯一、不可变、永久的 `command.result`，普通事件与对象状态继续承担审计和当前真源。
- **理由**：CampTurn/AgentRun 无法覆盖所有命令，独立 CommandRecord 表又会与审计日志重复；特殊事件既能复用统一因果时间线，又能通过部分唯一索引和严格保留规则提供完整幂等保证。
- **领域影响**：命令结果不属于 CampTurn、AgentRun 或 Decision；`accepted` 不回写，重复命令不重跑领域门禁；Task 完成证据使用独立不可变关系保存；event_log 不成为 Event Sourcing 或副作用队列。
- **数据/API 影响**：重建 v0.01 的 Task 专属 event_log 为通用事件表；增加全局顺序、事务/因果/Actor/Subject 字段、commandId 部分唯一索引和 `task_completion_evidence` 关系存储；不新增 CommandRecord 表或通用命令 CRUD。
- **后续事项**：DM-22 已确定 accepted 编排命令由权威请求事实、类型化扫描器与窄化 ACK 推进；实现 ADR 固定事件类型注册表、各命令结果 Schema、摘要规范与大小上限、SQLite migration 和查询索引；未来引入事件清理前必须先设计不破坏 commandId 防重放的永久存储。

### DM-22 Outbox / 事务后可靠推进

- **状态**：已否决
- **Lumen 决策**：v0.02 不建立通用 Outbox、OutboxEntry、Kind 注册表、Dead Letter 表或统一 Dispatcher。事务后的工作资格由 Task、CampTurn、CampMember、AgentRun、Approval、ActionExecution 与 InboxMessage 自身的权威状态表达，并由类型化 Worker 通过启动扫描、周期扫描和最佳努力本地 Wake 推进。
- **核心问题**：不复制领域状态，同时保证 Wake 丢失、应用崩溃和 Runtime 换绑后，系统仍能确定什么工作尚未完成、由谁认领、是否可能已产生副作用以及何时停止重试。

#### 讨论记录

##### 不是“最佳努力处理”

只有本地 Wake Signal 可以是最佳努力；业务推进必须可恢复：

```text
SQLite 事务
  → 提交权威对象状态
  → 写入 command.result 与必要领域事件
COMMIT
  → best-effort local Wake Signal

Wake 丢失或应用重启
  → 启动扫描 / 周期扫描重新发现同一权威状态
```

Wake Signal 不落库、不拥有状态、不承诺一次投递，也不携带唯一业务事实。它只提示某类 Worker 提前扫描，不能成为恢复真源。

不建立通用 Outbox 不等于没有持久工作队列。v0.02 采用“聚合内持久工作协议”：每个权威对象只保存自己独有的待办资格、租约、fencing、退避、ACK 与失败事实；普通事件不得被重放为副作用。

##### 类型化 Worker 的最低契约

每类事务后 Worker 必须独立定义以下协议，不能只写一个定时器循环：

1. **Eligibility Query**：由权威状态完整、确定性地判断是否有工作，并建立对应索引。
2. **CAS Claim**：在短 SQLite 写事务中重新校验资格，以版本/状态条件更新获取租约。
3. **Lease & Fencing**：跨事务或执行外部 I/O 的 Worker 使用租约拥有者、到期时间和 epoch/Attempt 防止旧 Worker 回写；只在一个短 SQLite 事务内完成的纯 Finalizer 可以使用对象 version/CAS，不为轮询额外制造租约。
4. **Stable Operation Identity**：外部调用使用 actionId、agentRunId、InboxMessage.id 或稳定 Native ID，不按扫描次数生成新身份。
5. **Backoff**：临时失败持久化 attemptCount、availableAt/nextAttemptAt 与最后错误，避免热循环。
6. **Completion Fact**：以对象终态、窄化 ACK 或明确 Checkpoint 表达完成，不能只依赖内存回调。
7. **Visible Exhaustion**：重试耗尽后保留失败事实和人工恢复入口；不建立通用 Dead Letter，但也不能静默丢弃。

这些字段是各协议的必要事实，不是对同一业务状态的重复缓存。不同对象可以复用实现辅助类型，但不建立一个接受任意 Kind/Payload 的公共队列表。

领域对象的 `version` 只在语义状态、请求事实、Attempt/epoch、结果或用户可观察协调状态变化时递增。纯 lease heartbeat/续期按 `leaseOwner + fencing epoch/attempt` 条件更新自己的到期时间，不递增领域 version，也不生成事件或 `command.result`；否则高频心跳会让 Cancel/Retry/Approval 等命令产生虚假乐观并发冲突。首次认领若同时创建 Attempt、递增 epoch 或改变状态，仍必须递增 version。

纯租约获取、续租和扫描游标属于内部协调更新，不必为每次轮询生成 `command.result`。真正创建 Attempt、改变业务状态、确认 ACK、结束重试或提交外部观察的操作仍使用强类型系统命令和稳定 commandId；租约续期不能绕过 DM-17/DM-21 的幂等与审计边界。

##### 权威工作来源

| 后续工作 | Eligibility 真源 | 认领/完成事实 |
|---|---|---|
| 调度 AgentRun | DM-09 `AgentRunStartEligibility.eligible = true`，包括输入、Task、成员、Workspace、配置和 Conversation 锁 | AgentRun 执行租约 + 新 `executionEpoch`；成功进入 `running`，必要时原子推进 Task |
| 中断 Runtime | `cancelRequestedAt != null && cancelAcknowledgedAt = null` | 按 `agentRunId + executionEpoch` 中断；确认旧 Runtime 已停止/失去写资格后写 `cancelAcknowledgedAt` |
| 完成 Task 取消 | Task 已请求取消，相关 Run 已终态，prepared/executing 与 active unknown 已收敛 | version CAS 提交 `Task = cancelled`；abandoned unknown 保留在 unresolvedEffects |
| 聚合 CampTurn | 非终态 CampTurn 的当前职责、关联 Task 取消事实、Retry/Decline 或自身取消请求已足以按 DM-12 确定下一状态 | 全部子 Run/副作用满足门禁后，以 version CAS 提交 waiting/terminal 状态；不只扫描 `cancelRequestedAt` |
| 完成成员退出 | CampMember 已请求退出且其非终态 Run 已收敛 | version CAS 提交 `left`；Default Lead 已在请求事务切换 |
| 展示/过期 Approval | `Approval.status = pending` | UI 直接查询；Expire Scanner 以版本 CAS 提交终态 |
| 执行 mediated Action | eligible `ActionExecution(prepared)` | 动作租约、Attempt、actionExecutionEpoch 与 `dispatchMayHaveStartedAt` |
| 对账 unknown Action | `status = unknown(active)` 且 `nextReconcileAt <= now` | Reconcile 租约；确定结果或新的 `nextReconcileAt` |
| 返回 Runtime | 尚未 ACK/安全关闭的 `ActionExecution.runtimeDelivery` | Checkpoint 租约；匹配 payload/epoch/request 的 `acknowledgedAt`、可见 `automaticRetryStoppedAt`，或父 Run 终止且目标 epoch 已 fencing 后的受审计安全关闭 |
| Agent 间消息 | 可投递的 `InboxMessage`；执行型消息的目标 Run 仍 queued 且无输入 | 既有投递租约、ConversationMessage 唯一来源、Run 输入绑定与 `deliveredAt/failedAt`；永久失败同步终结未启动目标 Run |

类型化逻辑模块至少包括 AgentRun Scheduler、Runtime Cancellation Worker、Task Cancellation Finalizer、CampTurn Aggregation Finalizer、CampMember Leave Finalizer、Approval Expiry Scanner、Action Executor、Action Reconciler、Runtime Delivery Worker 和 Inbox Dispatcher。它们可以先位于同一个 Rust Core 进程，不代表独立服务或领域实体。

##### Action 派发的崩溃边界

没有 Action Outbox 后，ActionExecution 自身必须证明派发处于哪个安全区间：

```text
prepared
  → CAS 为 executing，建立 Attempt/Epoch/租约
  → dispatchMayHaveStartedAt 仍为空

紧邻外部 I/O 前
  → 再次校验租约与 fencing
  → 先持久化 dispatchMayHaveStartedAt
  → 再执行外部 I/O
```

恢复时，marker 为空且没有 Native/External Operation 证据，才能证明未派发并安全返回 prepared；marker 非空只说明“可能已经派发”，即使实际 I/O 尚未发生也必须保守进入查询、外部幂等重放或 unknown。该保守假阳性是没有跨系统原子事务时必须接受的安全代价。

intercepted Runtime 收到 allow 后可能立即执行，因此允许执行的授权回传也必须在发送前建立 Attempt/Epoch 并写入同一保守 marker。拒绝、取消或过期不会释放副作用，可以直接收敛为 not_executed。

##### Runtime 投递不是一个时间戳

Runtime Delivery 使用 DM-20 定义的 ActionExecution 内嵌 Checkpoint，而不是 Approval 上的模糊 `deliveredAt`：

```text
kind
+ payloadDigest
+ targetExecutionEpoch
+ targetNativeRequestId
+ attemptCount / availableAt / lease
+ acknowledgedAt | closedWithoutAckAt / closeReason
+ automaticRetryStoppedAt / lastError
```

适用边界：

- intercepted 动作返回 `authorization_resolution`。
- mediated 动作返回确定的 `action_result`。
- observed 动作通常不创建 Lumen→Runtime 投递。
- 每个 ActionExecution 最多有一个当前 Checkpoint，类型由控制模式固定；不允许用同一可变槽位依次覆盖不同 payload。

一条 ACK 只证明对应 Digest 已被对应 epoch/request 接收。Native Session 换绑时不能把旧 ACK 当作新 Session 已消费。`action_result` 以及不释放副作用的拒绝类授权响应，可以在 Adapter 支持且 Core 确认逻辑动作一致时重新绑定；未 ACK 的 `authorization_resolution(allow)` 在可能派发边界之后，无论目标是否换绑，都不得盲目重发，必须先按 DM-20 证明接收协议幂等、证明未执行、依赖外部副作用幂等保证，或进入 unknown 对账。

投递失败不反向改写 Approval 的决定或 ActionExecution 的结果。未 ACK/未安全关闭且已耗尽的 Checkpoint 继续作为 AgentRun blocker；UI 显示自动重试已停止并允许 Runtime 重绑或人工重试。父 Run 已确定失败/取消且目标 epoch 已 fencing 时，可按 DM-20 关闭旧投递；该关闭不证明 allow 未被消费。只有所有相关投递、Approval、Action 和其他 blocker 都解除后，Scheduler 才能恢复 AgentRun，不存在通用 `ResumeAgentRun` 消息。

##### 启动、周期扫描与顺序

应用启动时按类型恢复，不要求跨类型使用一个全局队列：

1. 处理过期 Approval 和过期的 prepared Action。
2. 处理失效租约与崩溃遗留的 running/executing 状态。
3. 恢复 unknown Action 对账和尚未 ACK/安全关闭的 Runtime Delivery。
4. 恢复 InboxMessage 投递和执行型 Run 的输入绑定。
5. 恢复 cancelRequested AgentRun、Task/CampTurn/成员 Finalizer 与满足完整启动资格的 queued AgentRun。

这个顺序只用于降低无效尝试，不构成正确性依赖。每个 Handler 在认领事务中都必须重新校验自己的全部前置条件；例如 Approval 尚未批准时 Action Executor 无权认领，Action 结果尚未 ACK 或按严格规则安全关闭时 AgentRun 无权因一次 Wake 直接恢复。

周期扫描必须使用到期时间/状态复合索引、有限批次和退避，不能全表高频轮询。进程内可合并计时器和数据库访问，但 Handler、资格查询、租约字段与错误语义保持类型化。

##### 事务与失败窗口

```text
对象状态 + command.result + 领域事件
→ 同一 SQLite 事务提交
→ 事务提交后发送 Wake
```

- 提交前崩溃：状态和工作资格均不存在，不能执行后续动作。
- 提交后、Wake 前崩溃：启动/周期扫描发现工作。
- 重复 Wake：CAS/租约只允许一个当前 Worker 认领。
- 认领后、外部 I/O 前崩溃：根据对象的派发 marker 判断能否安全重试。
- 外部 I/O 后、结果落库前崩溃：使用外部幂等键/Operation ID 对账，否则进入 unknown。
- ACK 响应丢失：只有接收协议对相同稳定身份确实幂等时才能重投，否则从对象/Runtime 当前状态确认或进入 unknown；尤其不能盲目重发可能释放副作用的 allow，也不能生成新的逻辑动作。

事务内禁止 Runtime、网络或其他不可回滚 I/O。文件/Blob 协议优先采用“内容寻址临时写入并 fsync/rename，再在 SQLite 中建立引用；孤儿文件由 GC 清理”，而不是为了文件移动引入通用 Outbox。

##### 何时重新评估 Outbox

只有出现以下真实需求时，才重新评估 Transactional Outbox：

- 跨进程或远端 Connector 无法从领域状态可靠重新派生投递。
- 提交后操作没有自然权威对象可以承载资格与 ACK。
- 派发类型显著增加，聚合内字段开始大量重复同一传输状态机。
- 需要严格的跨类型全局顺序、独立吞吐扩展或长期消息保留。
- 状态扫描经索引和批处理后仍成为已测量的性能瓶颈。

引入条件满足时，也必须把 Outbox 定位为派发基础设施而非第二份业务状态；当前 Task、CampTurn、CampMember、AgentRun、Approval、ActionExecution 和 InboxMessage 仍保持权威。

#### 决策结果

- **决策**：否决 v0.02 通用 Transactional Outbox。使用各权威对象自身的状态、租约、fencing、退避、窄化 ACK 和恢复扫描驱动事务外处理；本地 Wake Signal 只负责降低延迟。
- **理由**：当前事务后工作都能从 Task、CampTurn、CampMember、AgentRun、Approval、ActionExecution 或 InboxMessage 确定性派生；通用 Outbox 会复制资格和投递状态，引入 Kind/Payload、重试、清理与 Dead Letter 的第二套协议，不符合单机 SQLite 首版的最小边界。
- **领域影响**：不存在通用 ResumeAgentRun 或事件重放副作用；各对象仍是唯一真源，所有 Worker 按类型重新校验前置条件。可靠性从“通用队列表”转为“聚合内持久工作协议”，而不是降级为最佳努力执行。
- **数据/API 影响**：不新增 `outbox_entry` 表、Outbox Kind 注册表、Dead Letter 或通用 Dispatcher/API，也不定义 `NotifyApprovalRequested`、`ExecuteAction`、`DeliverApprovalResolution`、`DeliverActionResult`、`ReconcileAction`、`InterruptAgentRun` 等持久 Outbox Kind；Task/CampTurn/CampMember 增加窄化编排请求字段，AgentRun 增加取消原因与 ACK，ActionExecution 增加 `nextDispatchAt`、`dispatchMayHaveStartedAt` 和 Runtime Delivery Checkpoint；为各 eligibility/Finalizer/租约查询建立复合索引并实现类型化 Worker。
- **后续事项**：实施 ADR 固定各 Worker 的扫描间隔、批次、租约、退避、最大重试、System commandId 派生、启动顺序和故障注入测试；出现远端 Connector、不可派生提交后操作、严格跨类型顺序或已测量扫描瓶颈时再重新评估 Outbox。

### DM-23 Worktree

- **状态**：已修订
- **Lumen 决策**：v0.02 不建立 Worktree 或 WorktreeRevision 领域实体，不强制使用 Worktree，也不建立 Workspace 单写者锁。AgentRun 在 Native Runtime 绑定前冻结实际 Workspace；Worktree 仅是 Agent/User 在 Skill 引导下选择的执行隔离策略。长期代码证据只接受带 Repository 作用域且保持可达的完整 Git Commit OID。
- **核心问题**：在保留执行方式灵活性的同时，明确 Workspace 绑定、权限、审计、证据、清理和 v0.01 迁移边界，不把目录路径或普通 Patch 冒充长期代码 Revision。

#### 讨论记录

##### 领域边界

Worktree 不属于 Task。Task 只表达结构化工作承诺，同一 Task 的不同 AgentRun 可以使用共享目录、不同 Git Worktree，或完全不接触文件系统。

Worktree 也不是 AgentRun 子实体。AgentRun 只保存本次执行实际使用的不可变 Workspace 快照：

```ts
type AgentRunWorkspace = {
  executionRoot: string;
  access: 'read_only' | 'write';
  isolation: 'shared' | 'git_worktree';
  repositoryScopeId: string | null;
  baseGitCommit: string | null;
  boundAt: string;
};
```

`executionRoot` 是 Core 校验后的绝对规范化路径；`isolation` 是 Core 根据 Git 元数据确认的事实，不接受 Agent 自报。Git Workspace 的 `repositoryScopeId` 必须等于当前 Camp Repository Binding 的稳定 `scopeId`，`baseGitCommit` 必须是通过该 Binding 在绑定时解析出的完整 OID；非 Git Workspace 的两者均为空。它们只说明本次执行的仓库与起始上下文，不是内容快照，也不能证明此后哪些修改仅由该 AgentRun 产生。

纯聊天、规划或不具备文件能力的 AgentRun 可以令 `workspace = null`。

##### 绑定与不可变性

需要文件或 Git 能力的 AgentRun 必须在 Native Runtime 创建/换绑以及 `queued → running` 前完成 Workspace 绑定。原因是 cwd、Sandbox、文件权限和有效配置都属于执行契约，不能等到第一次文件写入时才决定。

绑定后以下字段在该 AgentRun 内不可修改：

```text
executionRoot
access
isolation
repositoryScopeId
baseGitCommit
```

强类型命令 `BindAgentRunWorkspace` 只允许作用于尚未绑定 Workspace、尚未创建 Native Runtime 且仍为 `queued` 的 AgentRun，并携带 `commandId + expectedVersion`。同一命令重投返回既有绑定；不同参数不能覆盖已经成功的绑定。Actor Capability 已固定为 `workspace.bind`，物理 API 由实施 ADR 固定。

Agent 可以按照 Worktree Skill 为未来的 AgentRun 建议或创建 Worktree；用户也可以直接选择目录。若一个已经启动的 Run 才发现需要切换目录或把 `read_only` 提升为 `write`，必须结束当前执行并创建具有新执行契约的后继/新 AgentRun，不能静默迁移 Native Session。

Conversation 当前绑定的 Native Session 只有在 cwd、Sandbox 和 Workspace 契约兼容时才能复用。新 AgentRun 选择了不同 execution root 或访问模式，而 Provider 又不支持安全重配时，Adapter 必须创建替代 Native Session，并依照 Conversation 的摘要与公共消息游标恢复逻辑连续性；这仍不建立 Session Chain。

Core 绑定时只负责确定性边界校验：Actor/Run 具有 `workspace.bind`、目录存在且为允许访问的路径、访问模式未超出 `effectiveConfig.actionPermissionEnvelope` 与 Sandbox、声明的 Git Worktree 可由 Git 元数据验证、其 common directory 与 Camp Repository Binding 一致、Base OID 在该稳定 Repository Scope 中存在。绑定失败不创建模糊的半有效 Workspace；恢复时目录消失则进入 `waiting(workspace_unavailable)`，由用户或后续 Run 处理，Core 不自动重建。

##### Worktree 是可选 Skill 策略

Worktree Skill 可以在以下情况下建议隔离：

- 多个 Agent 可能并行修改代码。
- 当前共享目录已有用户修改。
- 工作持续时间较长或需要独立实验。
- 需要让审查基于明确分支/Commit。
- 用户明确要求隔离。

只读分析、小型单写者修改或用户明确接受共享目录时，可以直接使用 Camp 项目目录。Skill 是工作流建议，不是权限或安全边界；Core 不因为 Skill 建议自动创建 Worktree。

一个 AgentRun 可以通过显式 Git ActionExecution 为后续 AgentRun 创建 Worktree。创建完成后，由 Core 在启动目标 Run 前验证并绑定新目录。Worktree 创建、Commit、Merge、Cherry-pick、Rebase、Push、Ref 更新和删除都继续遵循 DM-19/DM-20 的参数冻结、权限、Approval、结果与 unknown 对账协议。

##### v0.02 不提供 Workspace 写锁

v0.02 不新增 `workspace_lease`、`write_lease`、路径唯一约束或 `write_lease_busy` blocker。多个 Lumen AgentRun 可以同时拥有指向同一目录的 `write` Workspace；用户、IDE 和外部进程也可能同时修改该目录。

因此 Core 不承诺：

- 防止覆盖、交错写入或 Git 冲突。
- 将某个目录中的全部最终差异唯一归因于一个 AgentRun。
- 仅凭 `baseGitCommit` 区分运行前修改、其他 Agent 修改和当前 Run 修改。

并行安全由 Agent/User 通过 Worktree Skill 和协作约定负责。`read_only` 仍必须由 Sandbox/工具能力实际执行；不建立写锁不等于允许只读 Run 写入，也不绕过受限文件/Git Action 的 Approval 和审计。

##### 代码证据

Workspace 路径是可变运行上下文，不是 EntityReference 或长期成果。`worktree` 与 `worktree_revision` 均不进入引用类型。

显式 `kind = review_patch` 的 MessageAttachment 可以用于 Review、讨论和人工比较，但不被定义为完整、可重建的代码快照。Core 不从扩展名/MIME 猜测该 kind。它不能证明覆盖了未跟踪文件、二进制、文件模式、符号链接、Submodule 或所有工作区状态，也不能单独支持清理仍有未提交内容的 Worktree。

需要在 Workspace/Worktree 清理后仍可解析的强代码证据统一使用：

```text
repositoryScope + objectFormat + fullCommitOid
```

Core 在接受 Git Commit 为 Task 证据时，必须通过 `Camp.repositoryBinding.scopeId` 解析作用域，使用 Binding 当前 `gitCommonDir` 校验对象，并确认 `internalRefNamespace` 下的固定 Ref 或等价保留 ActionExecution 已达到确定成功。目录移动只通过 Repository Binding 重定位，不改变证据 scopeId。Commit 证明对应树内容存在；在无写锁、无运行前完整快照的 v0.02 中，它不自动证明其中所有修改都由某个 AgentRun 独占产生。关联该 Run 的 Commit/Ref ActionExecution、Diff 与审计时间线共同说明产生过程。

测试、命令和文件/Git 副作用证据引用 `ActionExecution`；`ActionReceipt` 仍只是确定终态 ActionExecution 的读模型，不是独立引用类型。

未来出现“无 Commit 也必须冻结完整未提交工作区”的明确需求时，再评估规范化 ChangeSet 或 WorktreeRevision。v0.02 不引入二者。

##### 合入、清理与恢复

Core 可以提供受控 Git Helper，但不维护 Worktree 状态机、所有权或自动 Integration 流程。是否 Merge、Cherry-pick 或 Rebase 由 Agent/User 通过显式 Git 动作决定。

Worktree 清理由 Agent Skill 或用户显式发起。删除前必须检查未提交、未跟踪、未合入和未推送内容；存在未提交内容时，普通 Patch Attachment 不能充当已安全保存的依据，Core 不自动强制删除。删除结果和不确定性仍由 ActionExecution 记录。

应用恢复时只验证 AgentRun Workspace 路径、访问权限和 Git 上下文是否仍有效；已删除 Worktree 不自动重建。已经由 Repository-scoped Commit 固定的证据不依赖 Worktree 继续存在。

##### v0.01 迁移

v0.01 当前把 `execution_root`、`start_branch` 和 `base_revision` 保存在 Task，并把 `runtime_session.cwd` 绑定到同一路径。v0.02 迁移时：

1. 将旧 Task 对应执行的路径和 Base Revision 转换为首个迁移 AgentRun 的 Workspace 快照；Git 路径必须同时绑定迁移 Camp 的 `repositoryScopeId`。
2. 根据 Camp Repository Binding 与 Git 元数据校验并派生 `isolation`；无法确认 Worktree 身份但能确认同一 Repository Scope 时可降级为 `shared`。无法确认 Repository Scope 时必须令仓库字段为空、禁用该迁移 Run 的 Git 动作并暴露诊断，直到用户显式重新绑定；不能伪称为 Git Worktree，也不能保留未经验证的 Base OID。
3. 将旧 `runtime_session.cwd` 与迁移后的 Workspace 对账，存在冲突时停止自动恢复并暴露诊断。
4. 在迁移验证完成前保留旧字段的只读兼容读取；不得静默丢失历史路径或 Base Revision。
5. 新 Task 不再拥有 execution root、branch 或 revision 字段；新 Workspace 只属于实际 AgentRun。

#### 决策结果

- **决策**：不建立 Worktree/WorktreeRevision 实体，不强制 Worktree，也不建立 Workspace 写锁；Worktree 仅为 Skill 引导的可选执行策略，AgentRun 在 Runtime 启动前冻结实际 Workspace。
- **理由**：Worktree 没有必须由平台独立收敛的生命周期；强制隔离会增加非 Git、小改动、恢复与清理成本。与此同时，目录路径和普通 Patch 不具备长期代码证据需要的完整性，因此不把它们包装成伪 Revision。
- **领域影响**：Task 不拥有执行目录；AgentRun Workspace 是执行契约的一部分且绑定后不可变；同一目录允许多个 Writer，冲突风险由 Agent/User 通过 Skill 管理；Worktree 不参与 Task 或 Review 状态。
- **数据/API 影响**：不新增 `worktree`、`worktree_revision`、Workspace lease 或写锁表/API；AgentRun 增加包含可空 `repositoryScopeId/baseGitCommit` 的 Workspace 快照；从 EntityReference 删除 `worktree/worktree_revision`；长期代码证据使用 Repository-scoped full Commit OID，Patch Attachment 仅用于协作；迁移 v0.01 Task workspace 字段到首个 AgentRun。
- **后续事项**：编写 Worktree Skill，定义推荐触发条件、创建位置、环境初始化、显式 Git 动作、合入和安全清理步骤；实现 ADR 定义路径规范化/授权、Workspace 绑定命令、Camp Repository Binding 的物理列/重定位、Commit 固定 Ref、v0.01 迁移和故障测试。当需要 Core 级并发写保护或无 Commit 完整快照时，再分别评估 Workspace lease 与 ChangeSet/WorktreeRevision。
