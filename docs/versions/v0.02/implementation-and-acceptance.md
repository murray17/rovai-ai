# Lumen AI v0.02 实施与验收清单

> 状态：实施中
> 验收基线：`888c50d`
> 首次验收日期：2026-07-21
> 上级文档：[v0.02 多 Agent 协作架构基线](README.md)
> 实施约束：[v0.02 核心组件与实施包](core-components.md)

## 文档用途

本文件记录“v0.02 架构基础已经存在，但真实 APP 尚不能完成的产品闭环”、下一阶段实施顺序，以及直接影响交付范围的窄实施决策和待讨论问题。它不是新的领域模型，也不重复 ADR。

处理原则：

- 先恢复一条真实 Codex 执行链，再迁移为多 Agent；不能用静态控制面代替运行闭环。
- 健康检查、UI 可操作性和 Core 最终校验必须一致；UI 预检不能替代 Core 校验。
- 每项修复必须以真实 APP 验收为终点，单元测试、Schema 或 DTO 存在本身不算完成。
- 不为解决本清单而绕过能力探测、强类型命令、fencing、Action/Approval 或 SQLite 权威状态。

## 当前验收结论

### 已通过

- `cargo test -p lumen-core`：42 项通过。
- `pnpm typecheck`、`pnpm test`、`pnpm build:desktop` 通过。
- macOS arm64 安装包构建、签名校验和冷启动通过。
- 新数据目录能够创建 Lobby Camp；项目打开后能够物化 Camp、四名成员和 Default Lead。
- Camp Snapshot 与全局序列增量刷新有效：创建失败的测试 Task 后，界面从 `#0` 更新到 `#2`，开放 Task 从 0 更新到 1。
- 1440×920 与 1040×700 下未发现横向溢出或主要操作被遮挡。

### 总体判断

控制平面与首条 v0.02 Runtime 纵切已经连通：真实 Default Lead AgentRun 可以由 Scheduler 认领，经独立 Codex App Server / Native Session 执行，并将最终输出原子写回 Conversation 与 Camp。多目标真实并发、Action/Approval、Inbox 执行唤醒、取消/重试、Renderer 完整入口和破坏性 APP 验收仍未完成，因此当前 APP 仍不能宣称已经交付完整多 Agent 协同执行。

## 待处理问题

### APP-01 Codex 精确版本门禁阻断真实执行

- **状态**：能力探测已实现；已与首条 v0.02 真实 AgentRun 联合验证
- **优先级**：P0
- **现象**：本机 Codex 为 `0.144.6`，Lumen 固定支持 `0.144.5`。诊断页正确显示不兼容，`smoke:core`、恢复 Smoke 和真实 Task 启动均被阻断。
- **根因**：当前健康检查把 CLI 报告版本当成兼容性白名单，而不是由 `AgentRuntimeAdapter` 对用户本机安装执行握手和能力探测。
- **决策**：删除 Codex 精确版本白名单。`CodexRuntimeAdapter` 发现用户本机 CLI，通过握手、非副作用能力探测和集成测试形成能力结果；报告版本只用于诊断、二进制更新识别和 AgentRun 运行快照。未知通知可以保留为原始事件，未知反向请求或缺失必需能力必须失败关闭。

#### Probe 读取模型

Probe 是 `AgentRuntimeAdapter` 的只读结果，不是领域实体、数据表、运行状态真源或 Approval：

```ts
type AgentRuntimeProbeResult = {
  runtimeKind: "codex";
  executablePath: string | null;
  reportedVersion: string | null;
  executableFingerprint: string | null;

  status:
    | "ready"
    | "not_installed"
    | "authentication_required"
    | "missing_capabilities"
    | "probe_failed";

  capabilities: string[];
  missingCapabilities: string[];
  detail: string | null;
  probedAt: string;
};
```

Probe 最少执行：

```text
发现用户本机 Codex CLI
→ 记录 --version 与可执行文件 Fingerprint
→ 检查认证状态
→ 启动 codex app-server
→ 完成 initialize / initialized 握手
→ 通过 Schema 检查或安全方法探测验证 Required Capabilities
→ 关闭 Probe Host
```

Probe 不启动模型 Turn、不修改仓库、不创建 Native Thread，不得为了判断兼容性产生用户可见副作用。结果可以按可执行文件 Fingerprint 与进程级配置摘要缓存；CLI 或配置变化后必须重新探测。

v0.02 使用 Lumen 自己的规范化能力名，不把某个 Codex 版本的方法字符串直接泄漏给 Renderer：

```text
app_server.initialize
thread.start
thread.resume
turn.start
turn.interrupt
event.agent_message
event.turn_terminal
approval.command_request
approval.file_request
correlation.thread_turn_item
```

真实多 Thread 并发、共享 Host 隔离、两个 Approval 不串线、Host 崩溃恢复和迟到事件 fencing 属于 `CodexRuntimeAdapter` 集成验收，不要求每次 APP 启动都执行昂贵或有副作用的动态 Probe。

#### 实现范围

- 删除 `CODEX_VERSION_BASELINE` 对运行时健康和启动的门禁作用；v0.01 历史文档与旧 Schema 目录保留原基线。
- 用 `AgentRuntimeProbeResult` 替换 Core/Renderer 的 `compatible: boolean` 语义。
- `verify_compatibility()` 改为 Adapter Probe/Required Capability 校验，不再比较精确版本字符串。
- Renderer 展示实际安装、认证、Probe 状态和缺失能力，不再显示“兼容基线 0.144.5”。
- Smoke 和 bootstrap 根据 `status = ready` 与缺失能力失败，不再读取 `compatible === false`。

- **完成条件**：
  - 能力探测通过的 Codex 安装，其真实请求、事件流、审批和恢复 Smoke 全部通过。
  - 不因精确版本号不同而拒绝安装；缺失当前 AgentRun 必需能力时，只阻止相关 Runtime/Run，并显示缺失能力和解决路径。
  - `docs/versions/v0.01` 中的历史精确基线保持为历史事实；v0.02 记录新的能力协商协议。
  - Core、Renderer、Smoke 和 bootstrap 不再使用精确版本兼容布尔值决定可执行性。

### APP-02 启动预检与失败语义不一致

- **状态**：已完成；后续运行失败和恢复语义归 APP-03
- **优先级**：P1
- **现象**：诊断页已经知道 Codex 不兼容，但项目页的“创建并开始”仍可点击。Renderer 先持久化 Task，再调用启动；Core 将版本不兼容等启动前置错误统一写成 `Task = failed`，留下用户本来不应创建的失败 Task。
- **根因**：健康状态没有参与启动操作的可用性判断；“命令未满足启动条件”与“执行已经开始后失败”没有分层。
- **决策**：采用“只读 Start Preflight → 原子受理执行请求 → Scheduler 再校验”的三层协议；删除 Renderer 顺序调用 `tasks.create → tasks.start` 的产品路径。

#### Start Preflight

Start Preflight 是即时只读查询，不创建 Task、CampTurn、AgentRun、事件或 `command.result`：

```ts
type StartPreflightResult = {
  admissible: boolean;
  checkedAt: string;
  blockers: Array<{
    code: "agent_unavailable" | "workspace_invalid";
    detail: string | null;
  }>;
  workspace: AgentRunWorkspace | null;
  targets: Array<{
    agentProfileId: string;
    conversationId: string;
    runtimeKind: string;
    executableFingerprint: string | null;
    blockers: Array<{
      code:
        | "runtime_not_installed"
        | "runtime_authentication_required"
        | "runtime_capability_missing"
        | "runtime_probe_failed"
        | "agent_unavailable"
        | "workspace_invalid";
      detail: string | null;
    }>;
    queueConditions: Array<
      | "conversation_busy"
      | "earlier_run_queued"
    >;
  }>;
};
```

Camp、地址解析或 Workspace 级问题放在顶层 `blockers`；某个目标 Runtime 的问题放在对应 target。`workspace` 是 Core 只读检查后形成的冻结候选快照，Renderer 在提交组合命令时原样回传。Core 会重新执行 Preflight 并比对快照；发生变化时以 `workspace_invalid` 拒绝受理，不静默换用新的 HEAD。Workspace 是命令业务参数的一部分，必须进入 `requestDigest`，不得通过序列化例外隐藏。

它组合 APP-01 的 Adapter Probe 与当前 CampMember、Conversation、Workspace 等可立即判断的受理条件。多目标执行只要存在一个必需目标存在硬 blocker，`admissible = false`，避免 UI 展示可以受理却只创建部分 AgentRun。

Conversation 已有 running/waiting Run 或更早 queued Run 只表示本次执行将排队，不是受理 blocker；v0.02 允许同一 Conversation 保存多个 queued AgentRun。UI 应显示“将排队”，不能因此禁止用户提交。

Preflight 只改善用户体验，不是安全或一致性真源。UI 不得自行拼装健康条件；它只消费 Core 返回的结构化结果。

#### 原子受理命令

项目 Task 对话框的“创建并开始”改为一个强类型命令 `CreateTaskAndQueueExecution`：

```text
按 commandId 查询既有 command.result
→ 已存在：直接返回第一次结果，不重新执行 Preflight
→ 不存在：Core 执行只读 Start Preflight
→ 不通过：返回结构化原因，不进入领域写事务
→ 通过：进入 Domain Command Gateway，并在写事务内再次查询 command.result
→ 同一 SQLite 事务创建 Task(pending)
                 + CampTurn
                 + AgentRun(queued)
                 + 冻结配置/输入/Workspace 引用
                 + event_log / command.result
→ 提交后最佳努力 Wake Scheduler
```

事务内不得启动 Codex、访问网络或执行文件系统副作用。普通 Camp 执行请求继续由带 `ExecutionRequest` 的 CampMessage 命令原子创建 CampTurn/AgentRun；不需要 Task 时不得为了启动 Runtime 强制创建 Task。

Preflight 未通过不会写入 `command.result`，因此环境修复后可以使用原 `commandId` 再次尝试；一旦同一 `commandId` 已经产生 applied、accepted 或 rejected 领域结果，后续调用必须永久返回原结果，不能被更新后的 Probe 覆盖。

如果产品保留“仅创建 Task”，必须提供名称和语义明确的独立 `CreateTask` 操作。它创建 `pending` Task，不承诺立即执行，不能与“创建并开始”共用模糊按钮语义。

#### 提交后的竞态与状态语义

外部 Runtime 状态无法与 SQLite 事务原子锁定。Preflight 通过后，CLI、认证或配置仍可能在命令提交前后变化，因此 Scheduler 在认领 queued AgentRun 时必须重新检查完整启动资格和当前 Adapter Probe：

```text
Preflight 未通过
→ 不创建 Task/CampTurn/AgentRun

领域命令门禁拒绝
→ 不创建业务对象；保存幂等 rejected command.result

命令已受理，但 Runtime 随后不可用
→ AgentRun 保持 queued，并显示 Runtime blocker
→ Task 保持 pending

AgentRun 已 queued → running 后发生可恢复 Runtime 故障
→ AgentRun waiting(runtime_recovery)
→ Task 保持 in_progress

AgentRun 已开始后发生不可恢复执行失败
→ AgentRun failed
→ Task 保持 in_progress，等待 Retry、替代执行、Cancel 或后续完成门
```

v0.02 Task 只有 `pending / in_progress / completed / cancelled`，不存在 `failed`。Runtime、模型或 AgentRun 错误不得直接把 Task 写成失败；首个关联 Run 在满足全部启动门并原子进入 running 时，才同时推动 `Task pending → in_progress`。

APP-01 的 Probe 负责解释 Runtime 为什么不可用；APP-02 只定义何时允许用户提交、对象何时创建以及失败归属，不复制第二份健康状态。

#### 2026-07-21 实施记录

- `execution.preflight` 返回结构化全局/目标 blocker、排队条件与冻结 Workspace 候选。
- `tasks.createAndQueueExecution` 在查询既有 `command.result` 后执行新鲜 Preflight；受理事务原子创建 Task、CampMessage、CampTurn、AgentRun、冻结配置与审计事件。
- 普通 `SendCampMessage` 与 Task 组合命令共用同一 `queue_camp_message_and_runs` 协调器，不维护两套 Turn/Run 插入协议。
- Renderer 项目任务入口已删除 `tasks.create → tasks.start` 两步调用；对话框在 Preflight 不通过时禁用提交并直接显示原因。
- `smoke:intake` 已在本机 Codex `0.144.6` 上通过：无效 Agent 结构化阻断；同一命令稳定回放；最终恰好一组 `Task(pending) + CampTurn(running) + AgentRun(queued)`，未提前启动 Runtime。
- Preflight 后 Runtime 失效、Run 认领和实际执行后的恢复/终态失败属于 Scheduler/Adapter 行为，随 APP-03 完成。

- **完成条件**：
  - Runtime 不可用时，“创建并开始”不可提交，并直接显示结构化原因、诊断入口或修复说明。
  - Combined Flow 不再先创建 Task 后单独调用 start；同一 `commandId` 重试不重复创建 Task、CampTurn 或 AgentRun。
  - Preflight 后环境突变时，Scheduler 不启动不合格 Runtime；已受理 Run 保持 queued，Task 保持 pending。
  - 只有 queued Run 原子进入 running 时 Task 才进入 in_progress；AgentRun 失败不产生 `Task = failed`。
  - 自动化覆盖“UI 已知不健康”“Preflight 后失效”“领域命令拒绝”“实际启动后可恢复失败”“实际启动后终态失败”五条路径。

### APP-03 多 Agent 仍停留在读侧，产品链路尚未迁移

- **状态**：进行中；单 Agent v0.02 Runtime 纵切已通过真实 Codex 验证
- **优先级**：P1，APP-01 之后的主线
- **现象**：Renderer 能展示 Camp、成员、Default Lead、Agent 泳道和 Snapshot，但真实请求仍通过 legacy Project/Task API 启动固定沐瓦 Runtime。Electron 暴露的 v0.02 接口以查询、完成 Task 和订阅为主，尚无完整的 CampMessage、CampTurn、AgentRun、Inbox 和运行控制产品入口。
- **根因**：IP-01～IP-05 先完成了持久化和协议骨架，尚未用一条用户请求把 Addressing、Command Gateway、Scheduler、Native Thread、Inbox、Action/Approval 与 Read Side 串成垂直闭环。
- **决策**：把 v0.02 的真实产品主链迁移为“CampMessage → CampTurn → AgentRun → Codex Native Thread”。多 Agent 表示同一 Camp 内多个 AgentProfile 通过各自唯一 Conversation 和独立 Native Thread 执行；v0.02 仍只使用一个 `CodexRuntimeAdapter`，不以增加 Provider 数量代替多 Agent 协作。
- **处理边界**：下一阶段只实现首条最小闭环，不扩展 Memory、第二种 `AgentRuntimeAdapter`、动态组织、结构化 Review、通用工作流引擎或 Worktree 管理器。RT-02 的 AgentRun 输入精确重现协议继续留待讨论；APP-03 只要求已冻结的水位、触发输入和运行配置足以安全启动及恢复，不借此承诺逐字节重现首次 Prompt。

#### 当前实施进度

已完成：

- Scheduler 从 SQLite 权威状态扫描可执行 Run，按 Conversation 排队，并通过强类型命令 claim；Task 只在实际 claim 后从 `pending` 进入 `in_progress`。
- AgentProfile 冻结配置生成本轮 Developer Instructions、模型和 Sandbox；新链路不使用固定沐瓦 Prompt。
- `AgentRun + executionEpoch` 是 Runtime 路由和终态 fencing 身份；每个当前 Run 使用隔离的 App Server 进程，先以故障隔离保证正确性，后续再验证共享 Host/Host Pool 优化。
- Conversation 当前 Native Session 可以 resume；resume 失败时创建替代 Native Thread，并通过版本与 epoch 校验换绑。
- Codex 的 `item/completed` AgentMessage 是最终文本权威来源，stream delta 只作回退；`turn/completed` 负责终态信号，不能假设其中总有最终文本。
- 成功 Run 只写一次公共 CampMessage，并物化到自己的 Conversation；所有当前必需职责终态后，CampTurn 才确定性聚合。
- Agent 最终回复不会自动完成 Task。真实 smoke 已验证 `AgentRun=succeeded`、`CampTurn=completed` 时 Task 仍为 `in_progress`。

尚未完成：

- 两个 Agent 的真实并发和事件隔离 smoke。
- v0.02 ActionExecution/Approval 对 Codex Server Request 的映射；当前新 Adapter 对受限反向请求失败关闭。
- 执行型 Inbox、取消、人工重试/放弃重试与租约超时协调。
- Renderer CampMessage/多目标执行入口和打包 APP 破坏性验收。

当前验证：

```text
cargo test -p lumen-core
cargo clippy -p lumen-core --all-targets -- -D warnings
pnpm typecheck
pnpm test
pnpm smoke:intake
pnpm smoke:agent-runtime
```

#### 权威产品链路

```text
用户发送带结构化 ExecutionRequest 的 CampMessage
→ Message Addressing 解析 Default Lead / 显式目标
→ Core 原子写入 CampMessage、不可变地址快照、一个 CampTurn 与 N 个 AgentRun
→ Scheduler 从 queued AgentRun 权威状态认领可启动工作
→ CodexRuntimeAdapter 按 Conversation 启动或恢复独立 Native Thread
→ 每个 AgentRun 的输出回写自己的 Conversation 与公共 Camp
→ Agent 可通过 InboxMessage 定向请求另一 Agent 执行
→ 受限动作进入 ActionExecution，并在需要时等待 Approval 后写入确定结果
→ CampTurn 依据职责的当前有效 AgentRun 确定性收敛
→ Renderer 通过 Snapshot + 增量序列展示真实状态
```

普通 CampMessage 没有结构化 `ExecutionRequest` 时只写公共消息，不创建 CampTurn 或 AgentRun。`Default Lead`、显式 `@Agent`、回复目标和 Task 定向入口只负责确定执行目标；Core 不从自然语言正文推断是否需要执行。

一个执行请求只创建一个 CampTurn。多目标请求必须在同一 SQLite 事务中全部受理或全部拒绝，并为每个目标创建独立 AgentRun；不得先为部分 Agent 启动 Runtime，再补写剩余职责。`CreateTaskAndQueueExecution` 是 APP-02 的 Task 专用组合命令，但必须复用同一 Turn Coordinator，不得继续委托 legacy `tasks.start`。

#### 强类型命令面

首条产品闭环至少暴露以下强类型能力；Electron IPC 允许使用适合前端的 method 名映射，但不能退化为通用 `execute(type, payload)`：

```text
SendCampMessage
    写入普通公共消息；可选 ExecutionRequest 原子创建 CampTurn/AgentRun。

CreateTaskAndQueueExecution
    原子创建 Task 与首个 CampTurn/AgentRun，复用 APP-02 的 Preflight 和幂等规则。

SendInboxMessage
    写入 Agent 间可靠定向消息；可选 ExecutionRequest 时，Core 必须先创建或关联
    targetAgentRunId，Dispatcher 只能投递输入，不能自行创建 Run。

SubmitAgentRunInput
    只向明确处于 waiting(user_input) 的 AgentRun 提交 continuation；必须携带稳定的
    waiting input token/代际，不能按 Conversation 的“当前 Run”猜测目标。

CancelAgentRun / CancelCampTurn
    持久化取消意图，再由 Runtime Adapter 以 agentRunId + executionEpoch 幂等中断。

RetryAgentRun / DeclineAgentRunRetry
    对失败 Run 建立显式后继或持久化放弃重试事实。
```

所有产生领域写入的命令都经过 Domain Command Gateway，并遵守 `commandId + requestDigest + command.result` 幂等。消息地址解析、初始公共/私有连续前缀物化、输入水位冻结、CampTurn/AgentRun 创建和命令结果必须处于同一事务；事务内不得启动 Codex、访问网络或执行文件系统副作用。

执行型 InboxMessage 本身不增加 `request/inform/response` 意图枚举。发送命令在 Inbox 投递前创建目标 AgentRun，并把 `targetAgentRunId` 固化到消息；投递事务只创建或复用接收方 ConversationMessage、填充该 Run 的显式触发输入并 ACK。Dispatcher 重试不得产生第二个 Run，也不得因普通通知自动唤醒 Agent。

#### Scheduler 与 Runtime 迁移

Scheduler 只扫描和认领权威的 `AgentRun.status = queued`，并执行 core-components 中已确定的全部启动门：成员与 Profile 可用、输入已就绪、配置已冻结、Conversation 无在途 Run、Workspace 有效、Adapter Probe ready 且无未解决 blocker。

```text
queued AgentRun 满足启动门
→ 同一事务认领执行、分配 executionEpoch、AgentRun → running
→ 若关联 Task 仍为 pending，同时 Task → in_progress
→ 提交后最佳努力唤醒 RuntimeHostManager
→ CodexRuntimeAdapter 在事务外 thread/start 或 thread/resume
→ turn/start 成功后建立可信 Native Binding
```

每个运行绑定至少能从 `hostInstanceId + nativeThreadId + nativeTurnId` 反查 `agentRunId + executionEpoch`。共享 Codex App Server Host 是实现优化，不是领域不变量；无论共享或独占 Host，中央事件分流都必须验证 Native 身份、当前 Run 与 Epoch，拒绝旧 Host、旧 Epoch 和跨 Conversation 事件。

当前以 `taskId` 为键的 legacy Codex Manager/Runtime Session 不能继续承担 v0.02 主链。新的 Runtime 调度和恢复必须以 AgentRun 为执行身份、Conversation 为长期逻辑连续性、Native Session 为可替换句柄。DB 事务提交前不得发送 Runtime 输入；Native 请求发送结果不确定时必须进入既有恢复/对账协议，不能盲目重放。

#### 输出、动作与状态回写

Adapter 只能通过强类型 Gateway 报告事实，不能直接修改 Task、CampTurn、AgentRun、Approval 或 ActionExecution：

- 流式文本、thinking delta 和临时日志可以作为非权威实时投影；需要长期保留的最终输出必须持久化。
- Agent 私有连续性写入自己的 ConversationMessage；面向 Camp 的最终回答同时发布为带来源 AgentRun 的 CampMessage。公开发布和 AgentRun 终态提交必须幂等，不能因重连重复消息。
- Shell、文件写入、网络或其他受控 Tool 请求先创建 ActionExecution；需要授权时进入 Approval。只有具体 `actionId + actionDigest` 的批准才能继续该动作。
- 终态、等待、取消和恢复由明确 Runtime 事件及 Core Gate 推进。Agent 自述“完成”或自然语言 `LGTM` 不改变 Task 或 CampTurn 权威状态。
- 未识别普通通知可以保存为诊断事实；未识别反向请求必须失败关闭，不能自动批准或执行。

CampTurn 只根据各职责当前有效 AgentRun 的持久状态聚合。一次 Run 失败、等待输入或等待审批不会由 Renderer 猜测成 Turn 完成；取消、重试和放弃重试均使用已确定的强类型命令。

#### Renderer 与切换策略

Renderer 的主工作区迁移为 Camp 产品入口：

- Composer 明确区分“仅发送消息”和“请求 Agent 执行”，并支持 Default Lead、显式单目标和显式多目标。
- Camp 时间线展示公共消息和系统事实；Agent 泳道展示每个 AgentRun 的职责、queued/running/waiting/terminal 状态、blocker、动作、审批和最终结果。
- waiting(user_input)、Approval、取消、重试、放弃重试和 Inbox 定向请求都有明确操作入口，并调用强类型 Core API。
- 首次读取使用 Camp Snapshot；增量事件从 `throughGlobalSequence` 继续，用于失效通知和时间线更新。序列缺口或缓存不确定时重新拉取 Snapshot，不能由 Renderer 重放事件构造业务真源。

切换期间不得对同一请求同时写 legacy 和 v0.02 两条执行链。legacy Task API 可以暂时用于读取历史 v0.01 数据或保留开发兼容入口，但新 Camp UI 一旦切换，只能通过上述 v0.02 命令创建工作；产品路径中不得再出现 `tasks.create → tasks.start` 或固定 `agent-muwa`。

#### 实施切片

1. **命令与 IPC**：实现 `SendCampMessage`、Task 组合命令、运行控制和 Inbox 命令；先用持久化测试证明单事务、全有或全无与命令幂等。
2. **单 Run 新主链**：让 Default Lead 请求完整经过 Scheduler、AgentRun Binding、Codex App Server、Conversation/Camp 输出和终态聚合；此时即可删除新 UI 对 legacy `tasks.start` 的依赖。
3. **多目标并发**：一个 CampTurn 创建两个 AgentRun，在两个 Conversation/Native Thread 中真实并发；补齐中央事件分流、Epoch fencing 与独立恢复。
4. **协作与副作用**：接通执行型 Inbox、ActionExecution、Approval、continuation 输入、取消和重试，验证投递/动作幂等。
5. **Renderer 切换与破坏性验收**：接通所有操作入口，分别杀死 Codex Host、Rust Core 和 Electron，确认权威状态扫描可以恢复或明确收敛。

- **完成条件**：
  - 普通闲聊不强制创建 Task；明确执行请求只创建一个 CampTurn。
  - Default Lead 请求真实经过新主链；同时显式指定两个 Agent 时，原子创建两个 AgentRun，并在两个独立 Conversation/Native Thread 中真实执行。
  - Instructions、cwd、Sandbox、审批、事件、输出和 `executionEpoch` 不串线。
  - Agent 最终公开回复只写入一次；私有 Conversation 连续性与公共 Camp 结果边界可验证。
  - Inbox 投递重试不重复插入 ConversationMessage 或创建第二个 Run，也不递归触发无限执行。
  - Action/Approval 只恢复对应 AgentRun 的对应动作；迟到或跨 Thread 回调被 fencing 拒绝。
  - 取消、人工重试和放弃重试在应用重启后仍保留，并推动 Run/Turn 确定性收敛。
  - 杀死 Codex Host、Rust Core 或 Electron 后，两个 AgentRun 分别恢复、换绑、保持明确 waiting 或收敛为失败；不得静默丢失或重复副作用。
  - UI 能解释每个 Run 的 Agent、职责、状态、等待原因、动作和最终结果；仅展示四个“idle”成员不算通过。
  - 新 Camp UI 和自动化测试不再调用 legacy `tasks.start`，也不存在固定沐瓦的 Developer Instructions 或运行时路由。

## 实施顺序

1. **AgentRuntimeAdapter Capability Probe**：完成 APP-01，恢复真实单 Agent Smoke；这是后续 Runtime 验收的前置。
2. **Start Preflight**：完成 APP-02，修正 UI 可操作性和“未启动 / 执行失败”的状态语义。
3. **Collaboration Command Surface**：补齐发送 CampMessage、形成 CampTurn/AgentRun、查询运行状态和发送 InboxMessage 的强类型 Core/Electron API。
4. **Runtime Vertical Slice**：把一个双 Agent 请求接入 Scheduler、独立 Native Thread、Context Builder、fencing 与 Action/Approval，不再调用 legacy `tasks.start` 作为主链。
5. **APP Acceptance**：补齐 Renderer 操作入口，运行打包 APP、双 Agent 隔离、审批、Inbox、崩溃恢复和窄窗口验收。

每一步完成后应独立测试并提交；后一步不得通过临时绕过前一步的安全边界推进。

## 实施范围决策

### RT-03 AgentRuntimeAdapter 支持范围与集成方式

- **状态**：已接受
- **版本范围**：Lumen v0.02
- **决策**：v0.02 只正式实现 `CodexRuntimeAdapter`，使用用户本机 Codex CLI 提供的 `codex app-server`，通过 stdio 上的双向 JSONL 协议接入。
- **扩展边界**：Claude Code、GitHub Copilot CLI、ACP 和其他本机 Code Agent 延后；v0.02 不建立动态 Adapter 注册、插件市场或通用弱类型 Runtime 协议。

#### 支持范围

v0.02 唯一产品执行路径为：

```text
CodexRuntimeAdapter
→ 发现用户本机 Codex CLI
→ 启动 codex app-server
→ JSON-RPC 2.0 语义 / JSONL over stdio
```

Lumen 不安装、升级、降级或替换用户的 Codex CLI，也不复制其认证秘密。CLI 报告版本只用于诊断、二进制变化识别和 AgentRun 运行快照，不作为精确版本白名单。

v0.02 不实现：

```text
ClaudeCodeRuntimeAdapter
CopilotCliRuntimeAdapter
通用 ACP Adapter
CustomCliRuntimeAdapter
```

OpenAI Agents SDK、AgentScope 等属于 Agent 开发或编排框架，不是本机 Code Agent Runtime，不进入 `AgentRuntimeAdapter` 候选清单。

#### Codex 集成边界

`codex app-server` 是 OpenAI 官方提供并文档化的深度集成接口，但当前成熟度仍为 Experimental。Lumen 接受这一演进风险，并以安装级握手、能力探测、宽容事件解码和未知反向请求失败关闭控制风险。

`codex exec --json` 当前能够输出结构化 JSONL 并恢复已有 Session，但它面向非交互式自动化。Lumen 选择 App Server 的原因是需要长期双向连接、Server Request、Approval 响应、Turn 控制和多个 Native Thread 的统一事件通道，而不是因为 `codex exec` 缺少结构化事件或 Resume。

`codex exec --json` 可以作为开发诊断工具，但不形成第二套正式 Runtime Adapter、恢复协议或产品执行路径。

参考：

- [Codex App Server](https://learn.chatgpt.com/docs/app-server.md)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

#### AgentRuntimeAdapter 职责

`CodexRuntimeAdapter` 负责：

- 发现本机安装，探测认证、握手和当前能力。
- 启动、连接和关闭 App Server Host。
- 把 Native Thread、Turn、Item、Server Request 和通知映射为 Lumen 稳定协议。
- 保留未知普通通知的原始事实；对无法安全处理的未知反向请求失败关闭。
- 将可信 Native 身份映射为 `agentRunId + executionEpoch + commandId/actionId` 后调用强类型 Gateway。
- 规范化事件与错误，但不绕过 Gateway 直接修改 Task、AgentRun、Approval 或 ActionExecution。

App Server 提供相关 Native 标识和事件流；中央事件分流、fencing、幂等、恢复协调和领域状态收敛仍由 Lumen 实现。

#### 权威上下文边界

Lumen 是公共/私有消息、Conversation Summary、AgentRun、Approval 和 ActionExecution 等领域事实的权威来源。确定终态的 ActionExecution 可以投影为 `ActionReceipt`，但 Receipt 不是独立实体、数据表或第二份动作真源。

ConversationMessage 可以保存供模型继续理解的 Tool Result 表示；动作是否发生、结果是否确定以及副作用范围仍以 ActionExecution 为准。

Codex Native Session 是 Conversation 当前可复用、可替换的 Runtime 侧连续性资源，不是 Conversation 的领域身份，也不是上述领域事实的唯一载体。Native Session 丢失后，Lumen 必须使相关 AgentRun 安全继续、保持等待或收敛到明确终态；不能承诺所有 Run 都能无损恢复，也不能盲目重放结果未知的输入或副作用。

以下内容不在 RT-03 定案：

- 同一个 AgentRun 恢复时使用精确冻结输入还是语义等价输入。
- Native Session 的输入确认水位和未知投递协议。
- Recovery Summary 的物化清单与版本协议。
- 是否需要窄化的 Binding Epoch，以及它与已否决 Session Generation 的边界。

这些内容继续归属 RT-02。RT-03 不新增 `NativeSessionBindingSnapshot`、`bindingGeneration` 或 Session Chain。

#### Runtime Host 与 Codex 原生 Subagent

共享 `CodexRuntimeHost` 继续作为 `CodexRuntimeAdapter` 的默认托管策略，而不是 Conversation 的领域不变量。真实多 Thread 并行、配置隔离或故障半径未通过验收时，可以升级为有限 Host Pool，领域模型不变。

Codex 原生的 Subagent/Subagent Workflow 不映射为 Lumen 的 AgentProfile、CampMember、Conversation、Task、CampTurn、AgentRun 或 InboxMessage。它们属于父 Lumen AgentRun 的内部执行实现；相关 Native 子线程、动作、审批和结果仍须可靠关联到父 `agentRunId + executionEpoch`，不能逃逸 Lumen 的 Action/Approval 与审计边界。

#### CodexRuntimeAdapter 验收

发布前至少验证：

- 用户本机 Codex CLI 发现、认证检查、App Server 初始化和 Required Capability 探测。
- 不因精确版本号不同而拒绝；缺失必需能力时只阻止相关 Runtime/AgentRun，并显示结构化原因。
- Native Thread 创建与 Resume、Turn 启动与 Interrupt、流式文本和最终状态。
- Approval Server Request、ActionExecution 和 Runtime Delivery 映射。
- 两个 Conversation 真实并发，Thread、Turn、Approval、cwd、Sandbox、Identity、Skill、模型和工具上下文不串线。
- 单个 Thread 的失败、取消、迟到事件和 Codex 原生 Subagent 不推进其他 AgentRun。
- 共享 Host、Rust Core 或 Electron 崩溃后，各 AgentRun 能独立继续、等待或失败并最终收敛。
- Native Session 丢失和未知副作用不会触发盲目重放。

在 RT-02 定案前，验收不得宣称同一 AgentRun 的 Prompt 或输入清单可逐字节重现。

#### 决策结果

- v0.02 只交付 `CodexRuntimeAdapter`；Claude Code、Copilot CLI、ACP 和其他 Runtime 不进入本版本实现、测试与发布承诺。
- 唯一产品接口是用户本机 `codex app-server` 的 stdio 通道；`codex exec --json` 仅可用于诊断。
- 兼容性由能力探测和真实集成验收决定，CLI 版本只记录、不设精确白名单。
- Lumen 保存领域事实并负责恢复收敛；Native Session 是可替换的连续性资源，不是领域身份。
- 输入物化、同步水位和 Recovery Summary 协议仍由 RT-02 决定。

## 不可误判为完成

- Camp、成员和泳道出现在 UI 中，不等于多 Agent 已能执行。
- 两个 AgentRun 写入数据库，不等于两个 Native Thread 已真实隔离运行。
- 删除 Codex 精确版本白名单，不等于完成握手、能力探测和协议兼容。
- Renderer 预检通过，不等于 Core 可以省略最终校验。
- 单元测试通过，不等于打包 APP 的真实 Codex、审批和重启恢复通过。

## 验收记录更新规则

每次处理一项问题，在对应小节追加：

```text
状态：待处理 | 进行中 | 已完成 | 阻塞
完成提交：<commit>
验证命令：<commands>
APP 场景：<manual/e2e scenario>
遗留限制：<known limitations>
```

只有自动化测试与真实 APP 场景均通过，问题才能标记为“已完成”。
