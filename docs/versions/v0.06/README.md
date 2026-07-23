---
document_type: version-overview
version: v0.06
lifecycle: current
authority: version-scope-and-status
last_updated: 2026-07-23
---

# Lumen AI v0.06 Team Task 协作工具

> 状态：已完成；五个检查点均已通过
>
> 文档规则：[文档导航](../../README.md)
>
> 跨版本约束：[ADR 索引](../../adr/README.md)
>
> 前置版本：[v0.05 上下文治理与 Agent 间通信](../v0.05/README.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)
>
> 更新日期：2026-07-23

## 版本目标

v0.06 为 Team Tool 增加长期事项管理能力，让用户与 Agent 可以在 Camp 内创建、查看、分派和更新跨消息、跨 AgentRun 持续存在的 Task。普通回答中的临时步骤、Agent 内部计划和一次性 A2A 请求不因此物化为 Task。

本版本同时重新收口 Task 的领域语义、权限与可见性，并决定每轮动态工作上下文如何向 Lead 和普通成员呈现相关 Task。五个实施检查点均已完成：v17 协作断代、轻量 Task Core、授权读取边界、用户 Task IPC、Camp Inspector 管理面、Team MCP Task 工具、有预算的 `[TASK_CONTEXT]`、真实多 Agent 交接与恢复验收已经形成闭环。

长期架构边界由 [ADR-0012](../../adr/0012-collaboration-v3-lightweight-task.md)、[ADR-0013](../../adr/0013-managed-content-and-read-side-v2.md)、[ADR-0014](../../adr/0014-stable-team-tool-gateway-v2.md)、[ADR-0015](../../adr/0015-action-safety-v2.md) 与 [ADR-0016](../../adr/0016-multi-runtime-execution-v2.md) 共同定义。

## 已确认决策

### TASK-01 Task 是长期责任事项

- **状态**：已确认。
- Task 是 Camp 内可选、长期可跟踪的责任事项，适用于需要跨消息、跨 AgentRun 或多成员协作持续可见的工作。
- Task 不表示当前回答的临时执行步骤、Agent 私有计划或一次性局部委托；能通过一次 `team.post_message` 完成的协作默认不创建 Task。
- `completed` 表示具有操作权的用户或 Agent 已声明完成，不表示 Lumen Core 已验证代码质量、测试结果、Acceptance Criteria 或自然语言结论。
- Core 只执行确定性领域校验，包括 Actor/AgentRun/Execution Epoch、Camp 范围、Capability、Task 当前状态、版本前置条件与命令幂等。
- 该决定将替代 ADR-0005 中“Task 完成必须提交 Criterion—Evidence 映射”的约束；Evidence 与受管文件能力是否继续服务其他场景不在本条中删除。

### TASK-02 Task 不再拥有结构化 Acceptance Criteria

- **状态**：已确认。
- v0.06 从权威 Task 模型中删除结构化 `acceptanceCriteria`；需要说明完成条件时，由创建者把它写入 `description`。
- Task 完成不创建 Criterion—Evidence 映射，也不要求逐条 Criterion 状态、证据绑定或 `semanticAttestation`。
- 现有 `task_evidence_binding` 和 Task 完成证据命令退出当前 Task 权威协议；具体 Migration 在实施方案中定义，不保留两套可写语义。
- `ManagedBlobStore`、MessageAttachment、ActionExecution 结果及其完整性能力继续存在，不因 Task Evidence Gate 被移除而删除。
- 如果未来需要机器强制验收，应引入名称和生命周期明确的 Verification/Review 机制，而不是把隐藏门禁重新塞回 Task。

### TASK-03 Task 使用四态显式生命周期

- **状态**：已确认。
- 新 Task 统一从 `pending` 创建；允许 `pending ↔ in_progress`，并允许 `pending` 或 `in_progress` 进入 `completed` 或 `cancelled`。
- `completed` 表示有权限的 Actor 声明完成，`cancelled` 表示事项被明确放弃；两者都是不可再修改的终态。
- `pending` 可以直接进入 `completed`，不强制先进入 `in_progress`。
- v0.06 不提供 Reopen，也不保留 `generation` 作为重新打开协议；需要继续工作时创建新的 Task。
- 只有显式 Task 命令可以改变 Task 状态。AgentRun 启动、成功、失败、A2A 请求、消息文本和 Runtime 输出均不得自动推进或回退 Task。
- 产品文案和 API 分别使用“完成”与“取消”，不使用无法区分两种结果的“关闭 Task”。

```text
创建 → pending

pending ↔ in_progress

pending / in_progress → completed
pending / in_progress → cancelled
```

### TASK-04 Task 最多拥有一个可空 Assignee

- **状态**：已确认。
- `Task.assigneeAgentId` 可以为空或指向一个当前 CampMember；Task 不支持多人共同 Assignee。
- 创建 Task 时可以不指定 Assignee，形成待分配事项；未分配不构成独立 TaskStatus。
- 只有 `pending` 与 `in_progress` Task 可以显式改派，改派本身不自动改变状态。
- Assignee 变化只影响之后的 Task 可见性和 Task 定向执行；已经冻结的 AgentRun 不取消、不转移、不改写。
- `completed` 与 `cancelled` Task 不允许改派。
- Assignee 被禁用或移出 Camp 时，Core 不自动选择继任者。Task 保留稳定引用并派生 `assignee_unavailable`；由于其他 Agent 无权修改不属于自己的 Task，只能由用户改派或取消。
- 任意有权创建 Task 的 CampMember 都可以创建未分配 Task；未分配 Task 是 Camp 公共待处理事项，不属于某个创建者的私有范围。

### TASK-05 Default Lead 拥有全 Camp Task 读取范围

- **状态**：已确认。
- 用户可以读取当前 Camp 的全部 Task；Default Lead 因协调职责天然读取当前 Camp 的全部 Task，包括未分配 Task。
- 普通成员默认读取 `assigneeAgentId` 指向自己的 Task，以及全部未分配 Task。已分配给其他成员的 Task 仍不可见；创建者既不是 Assignee、也不是当前 Default Lead 时，不因创建者身份继续获得读取权限。
- Default Lead 的全量范围是关系派生的读取权限，不自动授予创建、编辑、改派、完成或取消 Task 的写 Capability。
- 更换 Default Lead 后，全量读取范围立即随 `Camp.defaultLeadAgentId` 变化，不把 `task.read_all` 复制进 AgentProfile 或 CampMember。
- Core 必须对 `list_tasks`、按 ID 读取和动态工作上下文执行同一可见性过滤；普通成员不能通过猜测 Task ID 读取已分配给其他成员的 Task。
- 状态过滤只决定返回哪些活跃或终态 Task，不改变 Actor 的可见范围。

### TASK-06 普通成员可以认领未分配 Task

- **状态**：已确认。
- 未分配 Task 是所有有效 CampMember 可见的公共待处理池；任意普通成员可以把非终态未分配 Task 原子认领给自己。
- 普通成员的公共认领能力只允许 `assigneeAgentId: null → self`，不能借此把 Task 指派给第三人。
- 认领必须带版本前置条件。多人并发认领时只有第一个事务成功，后续请求返回结构化版本冲突，不覆盖已有 Assignee。
- 一次 `update_task` 可以同时提交 `assignee = self` 与 `status = in_progress`；仅认领时 Task 保持原状态。
- 认领不创建 AgentRun、不唤醒 Runtime，也不代表实际工作已经开始。需要立即执行时仍使用明确的执行入口。

### TASK-07 Task 使用无需接收确认的直接分配

- **状态**：已确认。
- 创建者可以把新 Task 保持未分配、分配给自己，或直接分配给任意有效 CampMember。
- 当前 Assignee 可以把自己的非终态 Task 转交给另一有效 CampMember，或把它释放回未分配公共池。
- v0.06 不建立 Assignment Proposal、接受/拒绝流程或“等待接收”状态；接收方无需先确认，Task 关系即刻生效。
- 普通成员不能修改已经分配给其他成员的 Task；Default Lead 也不因协调身份获得修改其他成员 Task 的权限。用户可以改派任意非终态 Task。
- 指派、转交和释放只改变长期责任与之后的可见性，不创建 AgentRun、不发送 InboxMessage，也不唤醒目标 Runtime。
- 需要接收方立即执行时，调用方必须另行使用 `team.post_message`。Task 改派不取消、不转移、不重写已经冻结的 AgentRun。

### TASK-08 Team Task 工具与 Capability 分离

- **状态**：已确认。
- Team Tool 暴露 `team.create_task`、`team.update_task` 与 `team.list_tasks`；工具名称表达 Agent 可以请求的操作，Capability 表达 Core 是否授权该类写操作。
- Task 只定义 `task.create` 与 `task.update` 两项写 Capability；不定义 `task.manage_all`、`task.list` 或 `task.read_all`。
- `team.list_tasks` 是所有有效 CampMember 的基础读取工具，不需要单独 Capability。Core 必须按照 TASK-05 对列表、按 ID 读取和动态上下文执行一致的数据范围过滤。
- `task.update` 不是修改任意可见 Task 的全局权限。Agent 只能更新分配给自己的非终态 Task，或通过 TASK-06 将未分配 Task 认领给自己；不能修改已分配给其他成员的 Task。
- Default Lead 的全量可见性不带来额外写权限。用户可以创建、更新、改派、完成或取消 Camp 内任意符合状态约束的 Task。
- Agent 调用写工具时，Core 还必须校验其 Actor、来源 AgentRun、Execution Epoch、Camp 归属、对象版本和状态；拥有 Capability 不能绕过这些确定性约束。
- Capability 与 Adapter 的文件、Shell、网络等 Runtime 权限彼此独立。Task Capability 只约束 Lumen 领域操作。

### TASK-09 当前职责与可见 Task 分区注入

- **状态**：已确认。
- 保留 `[WORK_BRIEF]`，不将其改名为宽泛的 `[WORK_CONTEXT]`。它只描述当前 AgentRun 已确定的执行职责，包括本轮目标、关联 Task（如有）和预期输出。
- 新增独立的 `[TASK_CONTEXT]`，用于提供当前 Agent 可见的长期 Task 摘要。该区域是协作背景，不表示其中所有 Task 都属于本轮执行范围。
- Default Lead 的 `[TASK_CONTEXT]` 可以包含 Camp 内全部活跃 Task；普通成员只包含分配给自己的活跃 Task与未分配的公共 Task，范围必须与 TASK-05 的 Core 查询过滤一致。
- Task 属于每轮 AgentRun 的动态上下文，不进入静态 Session Charter。`[WORK_BRIEF]` 和 `[TASK_CONTEXT]` 由领域数据确定性组装，不能由 Runtime 自由改写。
- 当前 AgentRun 关联某个 Task 时，该 Task 的本轮责任信息放入 `[WORK_BRIEF]`；它仍可在 `[TASK_CONTEXT]` 中以压缩摘要出现，但组装器应明确标记为当前 Task，避免被理解为两项工作。
- `[TASK_CONTEXT]` 不替代 `team.list_tasks`。上下文只提供受预算约束的协作概览，Agent 需要完整字段或终态历史时使用查询工具。

### TASK-10 TASK_CONTEXT 是有预算的活跃 Task 索引

- **状态**：已确认。
- `[TASK_CONTEXT]` 默认只列出 `pending` 与 `in_progress` Task；`completed` 和 `cancelled` 历史不自动注入，按需通过 `team.list_tasks` 查询。
- 每项只包含稳定 Task ID、标题、状态与 Assignee，不注入 `description`。当前 Task 的完整目标与描述由 `[WORK_BRIEF]` 提供。
- 上下文组装器必须为该区域设置独立预算并确定性截断，不能因为 Camp Task 数量增长而无限扩张每轮 Prompt。
- 排序优先级依次为：当前 Task、当前成员负责的 `in_progress` Task、当前成员负责的 `pending` Task、未分配 Task；Default Lead 随后可看到其他成员的活跃 Task。相同优先级采用稳定排序。
- 发生截断时必须显示遗漏的活跃 Task 数量，并提示使用 `team.list_tasks` 查询；不得让 Agent 误以为当前索引是完整集合。
- `[TASK_CONTEXT]` 是只读快照，可能在 Agent 使用时已经变化。任何 Task 更新必须先通过查询工具取得完整详情和最新 `version`，不能直接把注入摘要当作并发写前置条件。

### TASK-11 Task 工具加入现有 Team MCP

- **状态**：已确认。
- 现有 Team MCP 在 `team.post_message` 之外增加 `team.create_task`、`team.update_task` 与 `team.list_tasks`；不建立独立 Task MCP、第二套 Connector 或另一种 Runtime 注入路径。
- 新工具复用现有稳定 Team Tool Gateway、Native Binding 凭据和当前 Run 动态解析。模型不能提交或覆盖 `campId`、Actor、AgentRun、Execution Epoch、Capability、`commandId` 或幂等键；Core 从当前有效 Binding 与 Runtime Tool Call 身份推导这些字段。
- Agent 发起写操作时继续执行 TASK-08 的 Capability 与对象范围校验；MCP 工具可见不等于写操作必然获准。

```ts
team.create_task({
  title: string,
  description?: string,
  assigneeAgentId?: string
})

team.update_task({
  taskId: string,
  expectedVersion: number,
  title?: string,
  description?: string,
  status?: "pending" | "in_progress" | "completed" | "cancelled",
  assigneeAgentId?: string,
  clearAssignee?: boolean
})

team.list_tasks({
  statuses?: Array<"pending" | "in_progress" | "completed" | "cancelled">,
  assigneeAgentId?: string,
  unassignedOnly?: boolean,
  limit?: number,
  cursor?: string
})
```

- `team.create_task` 的 Assignee 字段省略表示创建未分配 Task；新 Task 状态固定为 `pending`。
- `team.update_task` 至少提供一个可变字段。标题、描述、状态和 Assignee 可以在同一事务中原子更新；字段省略表示保持不变，`clearAssignee: true` 表示释放到公共待处理池，且不能同时传 `assigneeAgentId`。
- `team.update_task` 必须携带最新 `expectedVersion`；版本冲突时不做部分更新，调用方重新查询后再决定，Core 不执行 last-write-wins。
- 非终态 Task 允许修改标题，便于长期事项随认识加深而澄清命名；终态 Task 仍受 TASK-03 的不可变约束。
- `team.list_tasks` 默认查询 `pending` 与 `in_progress`，并先应用 TASK-05 的可见范围，再应用状态、Assignee 和数量过滤。`assigneeAgentId` 省略表示所有可见 Assignee；`unassignedOnly: true` 表示只查未分配 Task，且不能同时传 `assigneeAgentId`。
- Core 内部仍使用“保持不变 / 清空 / 指定成员”的三态 Assignee Patch。MCP 线协议采用独立布尔字段表达“清空/只查未分配”，避免根级或属性级联合 Schema 被不同 CLI Adapter 丢弃；旧的显式 `null` 输入只作为兼容解析，不出现在模型可见 Schema 中。
- 查询结果必须返回完整描述、当前 `version` 和调用者当前可执行的 Task 操作，使 Agent 能在乐观并发约束下调用 `team.update_task`。
- `limit` 受 Core 上限约束；结果被截断时必须返回可识别的截断信息，不能假装是完整集合。
- `cursor` 是 Core 生成的不透明分页游标；调用方不得自行解析或构造。响应在仍有后续数据时返回 `nextCursor`。
- v0.06 的三个 Team Tool 参数不包含 Task Dependency。

### TASK-12 删除 Task Dependency

- **状态**：已确认。
- v0.06 从当前权威 Task 模型中删除 `TaskDependency`、Dependency DAG、依赖 Readiness、环路校验与依赖管理 API；三个 Task Team Tool 均不接受依赖参数。
- 该决定显式替代 v0.02 的“扁平 Task + 可选 Dependency DAG”。实施时删除旧关系和不可达协议，不同时保留新旧两套 Task 依赖语义。
- Task 是长期责任记录，不是工作流调度节点。`pending`、`in_progress`、`completed` 与 `cancelled` 的显式转换不受另一 Task 状态阻止。
- Agent 可以在 Task 描述或 `team.post_message` 中引用其他 Task 来说明建议顺序，但这类自然语言引用不形成 Core 强制约束。
- 如果未来出现自动调度、机器强制先后关系或稳定阻塞查询的真实需求，应以边界明确的 `blocked_by` 协议重新建模，而不是恢复一个不影响状态转换的装饰关系。

### TASK-13 Team Tool 规则是编译进 Core 的 Charter 资源

- **状态**：已确认。
- Team Tool 使用说明的权威源文件放在 `crates/lumen-core/resources/charter-team-tools.md`，不放在 `docs/` 根目录，也不作为部署后可任意缺失的外部文档读取。
- Core 使用编译期资源嵌入读取该文件；文件缺失或路径错误必须在构建阶段失败，不能等到某个 AgentRun 才静默丢失协作规则。
- 只有当前 Adapter 已成功绑定 Team MCP 时，Core 才把该文件作为 Session Charter 的组成部分追加。它不得替换 Provider 或 Agent 自带的 System Prompt。
- 规则只在创建或重建 Native Session 时注入一次；Resume 同一个 Session 时不重复发送。资源内容参与 Charter Compatibility Digest，实质变化会使旧 Native Session 解绑并建立新 Session。
- 文件说明 `team.post_message` 与长期 Task 的适用边界、三个 Task 工具的语义、成员可见范围，以及工具调用成功与实际工作完成的区别。
- 文件不复制 MCP JSON Schema。参数、必填项和类型以 Team MCP Tool Schema 为唯一真源，防止运行时 Schema 与提示文档漂移。

### TASK-14 Camp 内提供最小用户 Task 管理面

- **状态**：已确认。
- v0.06 将现有 Camp 工作区中的 Task 标签页从只读列表升级为最小管理面；不恢复顶级 Task 导航，也不建立独立 Task 页面。
- 用户可以在当前 Camp 中创建 Task，查看完整详情，并修改非终态 Task 的标题、描述、Assignee 和状态；创建表单包含标题、描述与可选负责人。
- Renderer 不通过 Team MCP 代表用户操作。用户界面调用与 Agent Team Tool 汇聚到相同的强类型 Core Task 命令，但 Actor 明确为 User，并继续执行状态、Camp 范围、版本和幂等校验。
- 编辑提交携带 `expectedVersion`。发生版本冲突时保留用户草稿、重新读取当前 Task 并明确提示冲突，不执行静默覆盖。
- 用户创建、指派或更新 Task 只改变 Task 权威状态，不自动创建 AgentRun、不向 Assignee 发送消息，也不唤醒 Runtime；需要立即执行时仍从 Camp 对话明确发起。
- 管理面不增加 Task Dependency、搜索、归档、自动执行或工作流配置；`completed` 与 `cancelled` Task 只读。
- UI 沿用现有 Camp Inspector、Radix 组件和语义状态 Token，并覆盖 loading、empty、validation error、version conflict 与提交失败状态；在 `1040×700` 最小窗口下仍须可操作。

### TASK-15 Task 使用最小权威数据模型

- **状态**：已确认。

```ts
type Task = {
  id: string;
  campId: string;

  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  assigneeAgentId: string | null;

  createdByType: "user" | "agent";
  createdById: string;
  sourceAgentRunId: string | null;

  version: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};
```

- Agent 创建 Task 时，`sourceAgentRunId` 必须指向调用者当前有效的 AgentRun；用户创建时该字段必须为 `null`。Router 与 System 不自行创建新的业务 Task。
- `createdByType`、`createdById` 与 `sourceAgentRunId` 只记录稳定来源，不赋予额外读取、更新或撤销权限；实际权限继续由 TASK-05、TASK-08 与当前关系决定。
- Task 行只保存当前权威状态。每次更新的 Actor、原因、前后版本和字段变化进入 `event_log`，不在 Task 内累积历史数组。
- 删除旧 Task 协议中的 `objective`、结构化 `acceptanceCriteria`、`generation`、`originTaskId`、`sourceMessageId`、Task 级 `dedupKey` 与 `archivedAt`；不保留兼容写路径。
- `description` 使用非空字符串存储，允许为空；标题必须是规范化后的非空文本。
- `closedAt` 只在进入 `completed` 或 `cancelled` 时写入；非终态始终为 `null`。终态不可变，因此无需分别维护 Completed/Cancelled 修改代际。
- 命令幂等沿用 ADR-0001：由 `DomainCommandGateway`、Team Tool Runtime Call 身份和 `event_log` 中唯一持久的 `command.result` 保证；不建立独立 `CommandRecord` 表，也不在 Task 行重复保存幂等键。

### TASK-16 Task 创建、指派与 Agent 唤醒完全解耦

- **状态**：已确认。
- 用户和 Agent 创建 Task 时都可以指定一个有效 CampMember，也可以保持未分配；无论是否指定 Assignee，创建操作本身都不发送消息、不创建 AgentRun、不唤醒 Runtime。
- 后续指派、改派、释放和状态更新同样只修改 Task，不向新旧 Assignee 发送隐式通知，也不触发执行。
- `team.post_message` 不增加可选 `taskId`，目标 AgentRun 也不继承源 AgentRun 的可选 Task 关联；正文和通用引用提供协作语境，但不形成结构化 Task—Run 绑定。
- 正常 Agent 协作路径为：Agent A 创建或更新 Task；如果需要 Agent B 立即行动，再显式调用 `team.post_message` 通知 Agent B。消息正文或现有通用实体引用可以指出 Task，但这只是协作上下文，不改变 Task 或 AgentRun 关系。
- 用户需要负责人立即行动时，也从普通 Camp 对话中显式向该成员发出消息；Task 管理面不增加一键启动或隐式执行动作。
- 接收者通过本轮消息、`[TASK_CONTEXT]` 和 `team.list_tasks` 理解相关责任事项，并自行决定何时把 Task 改为 `in_progress` 或 `completed`。

### TASK-17 所有活跃成员默认获得 Task 写 Capability

- **状态**：已确认。
- 所有新建的活跃 AgentProfile 默认包含 `task.create` 与 `task.update`，使普通 CampMember 开箱即可创建 Task、认领未分配 Task并更新自己负责的 Task。
- v0.06 Migration 为现有活跃 AgentProfile 补齐这两项默认 Capability；不得继续依赖洛可、沐瓦等角色专属种子权限决定谁能使用 Task 工具。
- CampMember 的 Capability Override 可以在单个 Camp 中撤销任一默认权限：撤销 `task.create` 后不能创建 Task；撤销 `task.update` 后不能认领、修改、转交、完成或取消 Task。
- `team.list_tasks` 是有效 CampMember 的基础读取能力，不因上述写 Capability 被撤销而不可用；Core 仍按 TASK-05 过滤可见数据。
- User Actor 不依赖 Agent Capability，可以管理 Camp 内全部 Task；Default Lead 不因角色获得额外写权限。
- AgentProfile 的默认 Capability 只提供基线，实际调用仍必须经过 CampMember Override、当前 AgentRun/Execution Epoch 和对象作用域校验。

### TASK-18 Task 不支持单独删除或归档

- **状态**：已确认。
- v0.06 不提供 `DeleteTask`、`ArchiveTask`、回收站或对应 Team Tool；创建错误、不再需要或明确放弃的事项使用 `cancelled`。
- `completed` 与 `cancelled` Task 保留稳定 ID、创建来源、最终状态和审计关系，避免 CampMessage、InboxMessage、Agent 输出或 `event_log` 中的引用悬空。
- 活跃查询和 `[TASK_CONTEXT]` 默认排除终态 Task，减少长期 Camp 的工作区噪音；用户和 Agent仍可通过显式状态过滤查询历史。
- 删除整个 Camp 时，Task 作为 Camp 聚合内部数据随 Camp 一起永久删除，并遵守 Camp 删除已有的完整性与清理协议。

### TASK-19 v0.06 执行协作领域断代迁移

- **状态**：已确认。
- 项目仍处于开发期，v0.06 不为旧 Task 语义保留兼容层，也不把旧执行型 Task 猜测映射为新的长期责任事项。
- Migration 原子清除现有 Camp 聚合及其 CampMessage、Conversation、Task、CampTurn、AgentRun、InboxMessage、Approval、Action、上下文清单和其他从属协作历史；相关 Native Session 与 Binding 同时失效。
- 保留 AgentProfile、全局成员顺序、Adapter Installation、模型/权限偏好和独立应用设置，使用户无需重新配置本机 Agent Runtime。
- 创建单一的新 Task Schema，并删除旧 `objective`、Acceptance Criteria、Evidence Binding、Task Dependency、旧状态和 legacy Task 写入口；不保留隐藏旧表、双写或只为开发期历史服务的 Facade。
- 同步删除已经不可达的命令、Handler、Contract、Renderer 分支、测试夹具与兼容代码。不得只隐藏旧 UI 而让旧领域协议继续存活。
- 旧 `task.complete`、`task.cancel`、`task.dependency.manage` 等 Capability 与命令按新模型收口为 `task.create`、`task.update`；Migration 与种子数据不得继续注入废弃权限。
- Migration 使用同一正式启动路径执行，记录明确 Schema Version，并保证失败时整体回滚；开发环境不得依赖用户手工删除 SQLite 才能进入一致状态。

## 决策收口

- Task 基础语义、Team Tool、权限、上下文、Charter、用户界面与断代迁移策略均已确认。
- 五份替代 ADR 已建立并接续旧约束；后续产品或架构变化必须通过新决策修订，不能在实施中静默改变。
- 字段限制、分页上限、表单布局和具体错误码属于 [实施计划](implementation-plan.md) 内的低风险实现细节。

## 实施状态

五个检查点均已完成。v17 已用轻量 Task Schema 断代替换旧 Evidence/Dependency 协议，Core 命令与授权查询、User IPC、Camp Inspector 管理面、Team MCP 三个 Task 工具、Charter 资源、Read Model Schema v4 与不可变 `[TASK_CONTEXT]` 均已落地。真实 Copilot→Copilot 验收已证明“Task 分配不唤醒、显式 A2A 才创建接收者 Run、接收者自行更新 Task”；OpenCode 硬中断恢复已证明已接收输入不会被盲目重发，命令重放和第二次重启均不产生重复 Task、Run 或 InboxMessage。OpenCode、Copilot 和 Claude Code 已以最终 Schema 完成真实创建—查询—更新闭环；Codex MCP 启动与注入正常，但本轮最终模型复验仍被本机账户 `usageLimitExceeded` 阻断，历史真实 Codex Task Tool 闭环已通过。最终测试、生产构建、macOS 打包、签名校验和双尺寸 App 验收结果见 [implementation-plan.md](implementation-plan.md)。
