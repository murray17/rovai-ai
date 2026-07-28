---
document_type: version-architecture
version: v0.16
lifecycle: historical
authority: version-design
last_updated: 2026-07-28
---

# Rovai-ai v0.16 架构设计

> 版本范围：[README.md](README.md)
>
> 跨版本约束：
> [ADR-0059](../../adr/0059-runtime-owned-resource-permissions.md) ·
> [ADR-0060](../../adr/0060-opaque-member-routing-identity.md)
>
> 相关既有约束：
> [ADR-0014](../../adr/0014-stable-team-tool-gateway-v2.md) ·
> [ADR-0016](../../adr/0016-multi-runtime-execution-v2.md) ·
> [ADR-0049](../../adr/0049-reproducible-context-delivery-v2.md)
>
> UI 约束：[Meridian 详细规范](../../ui/meridian.md)

## 1. 权威边界

v0.16 将“权限”拆回不同真源，禁止一个字段同时代表业务授权、Runtime sandbox 和
工作目录：

| 事实 | 权威 | Core 是否裁决 |
|---|---|---:|
| Camp、Task、Team Tool 等业务 mutation | Core Capability + Domain Command | 是 |
| Agent 是否可创建新 Run | Presence、CampMember、Runtime Readiness、准入规则 | 是 |
| Run 使用哪个 Adapter/模型/权限配置 | 接收 AgentProfile 在 Run 创建时的冻结快照 | 校验并冻结 |
| 文件、Shell、Git、网络资源访问 | 接收 Agent 的 native Runtime | 否 |
| native permission request 的用户选择 | Runtime 请求提供的不可变原生选项 | 只持久化并转发 |
| Run 启动/恢复 cwd | Run Workspace path | 只检查可作为 cwd |
| Rovai-ai 自有文件 | 对应应用子系统 | 是 |

Core 不再把“可作为 cwd”推导成“只能访问 cwd 内部”，也不再把 Runtime 原生权限
配置压缩成跨 Adapter 的 `read_only | write`。

## 2. 当前实现漂移

当前代码有四个与 ADR-0059 冲突的路径：

1. `QueuedAgentRunCandidate::execution_workspace()` 根据 Core Capability
   `workspace.bind` 推导 `read_only | write`。
2. `team.post_message` 创建目标 Run 时复制发送方完整 `workspace_json`。
3. `prepare_agent_run_config` 为文件、Shell、Git、网络等 Action Kind 生成默认
   ask 规则，`ActionSafetyService` 再执行 scope/access/policy 判断。
4. Codex/ACP Adapter 将 `workspace.access` 叠加到 native sandbox 或在权限请求
   到达用户前直接拒绝。

v0.16 需要逐条移除这些字段对新 Run 的授权含义，而不是只删除某一个报错分支。

## 3. AgentRun 权限语义

### 3.1 不可变枚举

目标领域类型：

```rust
enum PermissionSemantics {
    CoreEnforcedV1,
    RuntimeManagedV2,
}
```

SQLite 使用稳定字符串：

```text
core_enforced_v1
runtime_managed_v2
```

`permission_semantics` 在 AgentRun 创建后不可修改。所有 AgentRun insert 路径必须
显式或通过安全默认写入 v2，包括：

- 首条消息创建 Camp；
- 普通 Camp execution；
- A2A target Run；
- retry/rework/successor Run；
- 测试 fixture 和恢复辅助路径。

只有恢复同一条迁移前 AgentRun 才继续使用 v1。升级后的 successor 是新 Run，必须
使用 v2。

### 3.2 Recipient Runtime snapshot

目标 Run 配置解析顺序继续遵循 ADR-0016：

```text
recipient AgentProfile defaults
→ recipient Conversation override（若存在）
→ current recipient AdapterInstallation capabilities
→ validate Adapter-specific model and permissions
→ freeze on target AgentRun
```

任何发送方字段均不得进入该链。Binding/Host reuse digest 必须继续覆盖所有
Adapter-specific permission values，防止不兼容的 native Session 或 Host 复用。

### 3.3 Runtime Readiness Projection 与执行准入

Runtime 状态分为两个用途，禁止由同一条同步读路径同时承担：

```text
AgentProfile / Lobby ordinary read
→ read latest persisted AdapterInstallation capability snapshot
→ derive advisory Runtime Readiness
→ no executable file I/O or fingerprint calculation

new AgentRun admission
→ resolve recipient Runtime configuration
→ hash current executable contents
→ compare with persisted snapshot fingerprint
→ freeze configuration or reject stale snapshot
```

Adapter installation refresh 负责探测 Runtime 并更新 snapshot。因文件可能在任意时刻
被替换，Readiness 投影只用于展示和引导，不是启动安全证明；执行前的权威指纹校验
不能被缓存的 Profile 状态或 Renderer 判断替代。

Renderer 启动不自动执行 `health.check` 或逐项刷新已启用安装；Runtime discovery
只在成员页和诊断页按需触发，安装刷新由用户显式操作触发。`health.check` 与
`runtime.installations.refresh` 在 Core 中使用独立的长请求调度，不占用普通交互
请求的串行队列；它们只短暂持有数据库锁读取或落盘 snapshot，文件哈希和子进程探测
期间不得持锁。因此，即使诊断正在扫描大型可执行文件，`camps.snapshot`、
`camps.reconcileDefaultLead` 和消息提交仍可继续。并发调度使标准输入更频繁回到等待
状态；macOS 返回瞬时 `WouldBlock/EAGAIN` 时必须短暂退避重试，不能把它当作 Core
崩溃。

Profile 列表等普通读取不得执行大型文件 I/O。Renderer 启动时只请求一次成员列表，
并从同一结果推导展示用 Camp creation preflight；Camp 打开由 Lead reconciliation
和单次权威 snapshot 组成，事件轮询从该 snapshot 的 sequence marker 继续，不重复
读取初始 snapshot。进入新会话和提交消息仍调用 Core preflight，最终创建 Run 仍以
Core 事务和权威准入为准。

### 3.4 Legacy Capability

- `workspace.bind` 对 v2 不再决定读写、路径范围或 Adapter sandbox；字段可以为
  legacy 数据继续存在。
- `action.request` 可以继续保护显式 Core-mediated 业务操作，但不得阻止当前、
  已认证 Runtime 的原生 permission request 被记录和展示，也不得阻止 Runtime
  reported action 被如实记录。
- `actionPermissionEnvelope` 对 v2 不生成资源 ask/allow/deny 规则。若为兼容合同保留
  空对象或旧字段，读取方不得把它当作 Runtime 权限。

## 4. Run Workspace

### 4.1 逻辑合同

```rust
struct Workspace {
    path: PathBuf,
}
```

不变量：

- `path` 为绝对路径；
- Dispatch 时目录存在且可作为 cwd；
- 同一 Run 的启动和恢复使用同一路径；
- 运行期间 Agent 可通过 Runtime 操作其他路径；
- Core 不将其他路径归一化后与 Workspace 比较以决定授权。

Runtime Adapter launch request 只从 Workspace 读取 cwd。sandbox、approval policy
和权限规则只从 `RunRuntimeConfiguration.permissions` 读取。

### 4.2 兼容存储

本版本不立即重写全部 `workspace_json` 消费方。既有物理形状可以继续保存：

```json
{
  "executionRoot": "/absolute/cwd",
  "access": "write",
  "isolation": "shared",
  "repositoryScopeId": null,
  "baseGitCommit": null
}
```

对 v2：

- `executionRoot` 只映射为 `Workspace.path`；
- `access` 不参与 Core 或 Adapter 授权；
- `isolation/repositoryScopeId/baseGitCommit` 只在仍有独立、非权限用途的功能中读取；
- Read Model 不得把 `access` 展示成当前 Run 的有效权限；
- 新代码使用 path accessor/typed projection，避免继续直接读取 legacy JSON 权限键。

是否在后续版本物理迁移为 `{ "path": ... }`，待 v1 Run 清空后另行决定。

### 4.3 正常 Run 与 A2A Run

普通用户消息：

```text
Camp.projectPath
→ validate absolute existing cwd
→ freeze target Run Workspace path
```

A2A：

```text
authenticated source Run
→ extract source Workspace path only
→ freeze target Run Workspace path
→ independently resolve recipient Runtime configuration
```

禁止把 source `workspace_json` 整体赋给 target。若 legacy source JSON 无法解析出可用
路径，A2A 原子失败并给出明确内部诊断，不能猜测权限或改用任意目录。

`TeamPostMessageInput`、MCP Tool Schema、Charter 参数说明和 connector payload 均不
增加 Workspace 字段。

## 5. A2A 可信元数据与语义内容

职责矩阵：

| A2A 内容 | 产生者 |
|---|---|
| recipient、body、references、reply linkage | 发送 LLM |
| 另一目录的工作要求 | LLM 写入 body 或持久 Task 描述 |
| source/parent/root Run、depth、epoch、CampTurn | Core 从认证 Binding 派生 |
| target Task association | 固定为空，不从 source 继承 |
| target Runtime config | Core 从 recipient Profile 解析并冻结 |
| target Workspace path | Core 从 source Run path 按规则传递 |
| target ContextManifest | Core 按 ADR-0049 确定性组装 |

发送方完整 Prompt、私有 Conversation、隐藏推理和 Runtime permission state 均不
作为 A2A context blob 复制。

## 6. Runtime permission request 合同

### 6.1 冻结请求

Adapter 将一个可无损往返的原生请求转换为：

```ts
type RuntimePermissionRequest = {
  requestId: string
  adapterKind: string
  nativeMethod: string
  nativeRequestIdentity: unknown
  actionSummary: string
  reason: string | null
  requestedResource: unknown
  options: RuntimePermissionOption[]
  requestDigest: string
}

type RuntimePermissionOption = {
  optionId: string
  kind: "allow_once" | "allow_session" | "deny" | "cancel" | "other"
  label: string
  consequence: string
  nativeResponseDigest: string
}
```

`optionId` 是该请求内稳定且不可伪造的选择键。原始 native response 模板保存在
Core/Adapter 私有持久数据中；Renderer 只回传 `optionId`，不能提交任意 native
JSON。

`kind` 只用于安全排序、文案和无障碍，不改变原生含义。Adapter 必须保证 label、
consequence、scope/lifetime 与实际 native response 一致。未知但可无损往返的选项
使用 `other` 并完整解释；无法保证往返时整个请求失败，不删减选项。

### 6.2 生命周期

```text
native Runtime request
→ validate Binding + Run + epoch + native Turn/request identity
→ freeze request, options and digest
→ persist pending Approval/Runtime Action Record
→ AgentRun waiting(runtime_permission)
→ user selects one optionId
→ CAS pending Approval and persist exact decision
→ create fenced runtime delivery
→ Adapter maps frozen option to native response
→ Runtime ACK / explicit failure / recovery state
```

Core 只验证身份、一致性和可往返性，不执行 requested path 与 Workspace 的包含关系
检查。

同一 Runtime request 的重复到达必须幂等返回同一个待处理或已处理记录。相同 identity
配不同 digest 必须进入冲突/诊断，不能覆盖旧请求。

### 6.3 用户决策

Resolution command 改为选择原生 option：

```ts
type ResolveRuntimePermissionRequest = {
  approvalId: string
  expectedVersion: number
  optionId: string
  reason?: string
}
```

不再使用只能表达 `approve | deny` 的公共合同。存储层可继续用 approved/denied 等
终态以兼容读取，但 `decision_json` 必须保存 native option identity、kind、scope 和
response digest。

选中 `allow_session` 不修改 AgentProfile；是否影响后续请求由同一 native Session
决定。

### 6.4 Adapter 能力

Adapter capability snapshot 明确区分：

- 能否配置启动时 permission；
- 能否发出结构化 dynamic permission request；
- 能否提供多个原生选择；
- 能否证明 resolution delivery/ACK。

Codex App Server 与 ACP 路径按实际协议实现。Claude Code、Antigravity 或未来
Adapter 只有在真实探测和 Smoke 证明后才能声明相同能力。产品不按名称假设支持。

## 7. Action/Approval 语义切换

### 7.1 v1 保持

`core_enforced_v1` Run 继续走现有：

- Workspace scope/access 检查；
- Action Permission Envelope；
- generic allow/ask/deny；
- legacy approve/deny delivery；
- 既有 recovery。

该分支只服务存量 Run，禁止新 Run 进入。

### 7.2 v2 Runtime request

`runtime_managed_v2` 的 intercepted request：

- 不调用 `evaluate_policy` 决定 allow/ask/deny；
- 不调用 `validate_workspace_scope` 或 `validate_runtime_permission_scope`；
- 不因 Workspace access 或 `workspace.bind/action.request` 拒绝；
- 固定进入“真实 Runtime 请求待用户决定”路径；
- 保留 action/request digest、native binding、epoch 和 delivery fencing。

### 7.3 v2 observed action

Runtime 报告 action/update/completion 时可继续创建或完成 Runtime Action Record。
校验范围只包括结构、身份、关联和摘要完整性，不反向声称该操作先经 Core 授权。

Runtime 没有报告的操作不补建记录。UI 和审计用语必须区分“Runtime 已报告”与
“Core 已授权”。

### 7.4 Core-mediated operation

若 Core 自己执行一个 Rovai-ai 业务或应用管理操作，仍可使用持久 ActionExecution、
attempt fencing 和 unknown reconciliation。它必须由该子系统的专属命令/Capability
授权，不能复用 Workspace access 充当授权。

## 8. Runtime Adapter 调整

### Codex

- `sandbox_mode`、`approval_policy` 等只来自冻结 Codex permission configuration；
- 不再由 `workspace.access` 强制改写 sandbox；
- command/file/permissions request 保存可用的 Codex 原生选择；
- `accept`、`acceptForSession`、`decline`、`cancel` 只在对应 method 支持时提供；
- resolution 根据冻结 option 生成协议响应。

### OpenCode / Copilot ACP

- Host/session permission 配置只来自各自 Adapter snapshot；
- 不再用 Workspace access 阻止 file/execute request；
- `session/request_permission.options` 全量冻结；
- 用户选择 exact `optionId`，不再自动寻找统一的 one-time allow/reject；
- 外部目录和相对路径只用于展示/审计，不做 Core scope denial。

### Claude Code / Antigravity

- 使用各自启动时冻结的原生配置；
- 未验证结构化 request/response 前不展示伪造 Approval；
- Runtime 自身失败按 Runtime failure/diagnostic 呈现，不回退到 v1 Core policy。

## 9. Renderer

Approval 卡保持 Meridian 的 attention 状态和证据优先结构，并改为：

- 展示执行引擎、Agent、Run、请求能力、准确命令/路径、原因和阻塞影响；
- 按请求冻结顺序展示全部原生选项；
- 每个按钮使用本地化 label，但保留真实 scope/lifetime 说明；
- deny/cancel 等最安全选项排在前并获得初始焦点；
- 不存在的 `allow_session` 不显示；
- unknown/other 选项没有完整 consequence 时禁止提交并显示执行引擎适配器诊断；
- resolving、stale version、delivery、recovery 和 terminal 状态均有明确文字；
- Day/Night、键盘、焦点和 1440×920/1040×700 功能等价。

成员执行引擎设置继续由 Adapter descriptor 渲染原生 permission 配置。支持能力旁
增加只读说明：是否支持“运行中在 Rovai-ai 内申请权限”。它不变成新的通用设置项。

产品文案边界与内部类型边界分离：Renderer 的普通标签、状态、空状态、Toast、
Dialog、动态错误和原生 option 说明统一将 generic Runtime/AdapterInstallation
显示为“执行引擎”；协议标识、诊断 JSON、代码类型和具体 CLI 产品名保持原样。

新对话欢迎区不投影初始 Lead 或 Readiness。每个新草稿从冻结的 Meridian 欢迎语集合
中随机选择一句，并在草稿期间保持稳定；默认 Lead 路由仍是 Core 行为，但不通过
头像 chip、欢迎副文案或空输入辅助行重复表达。显式 `@` 选择和目标反馈继续保留。

成员配置按 ADR-0060 只呈现全局唯一名称。创建请求不携带 handle，Core 生成 12 位
Base58 内部 ID；更新身份不修改该 ID。Composer 插入 `@成员名称` 并提交结构化
AgentProfile ID，Renderer 对旧消息、Camp 标题和导航中的 `@handle` 做只读名称
投影。

设置导航删除独立「上下文」目的地。原摘要模型表单作为成员详情的默认折叠
「高级设置」挂载，只有展开后才调用既有 `context.summaryModel.get`；保存继续调用
`context.summaryModel.set`。表单不展示执行引擎选择器；自动回退之外，installationId
固定为当前成员 Agent运行时，只列出该运行时默认模型及其 capability snapshot 模型。
该移动不改变 Context summary 的 Core 选择链或数据结构。

Camp 的高频执行过程不进入 `CampSnapshot` 持久化 Read Model。Core 继续通过现有
stdout 事件通道发送带 `agentRunId` 的 Runtime 原生通知，Renderer 在内存中维护有
上限的 live event ring，并只向当前 snapshot 中仍在运行的 AgentRun 投影：

```text
Codex reasoning summary delta / ACP exposed thought chunk
→ 思考摘要

agent message delta
→ 当前 Run 的进展说明

turn plan update
→ 计划及 pending / inProgress / completed

command / file / MCP / dynamic tool lifecycle
→ 结构化步骤及 running / completed / failed
```

Codex Turn 使用 `summary: auto` 请求 provider reasoning summary；短 Turn 或具体
模型可能不返回摘要，此时只展示其公开 Agent 进展说明及结构化步骤。
`item/reasoning/textDelta` 原始内容不进入产品投影。若 Runtime 没有报告摘要或步骤，
Renderer 只显示 AgentRun 正在运行，不合成虚假过程。Live execution event 只存在于
Renderer 的有界内存投影：不写入 SQLite、CampMessage、摘要或 FTS，不被
`context.search`、后续 AgentRun 输入或 A2A 上下文读取。公共消息正文、Action、
Approval 与审计的持久化边界不因 live projection 改变。

用户 Camp 消息保持可选择文本，并提供显式复制按钮。复制的是
`formatMentionDisplayText` 后的展示正文，避免历史 handle 经复制操作重新泄漏。

Team Tool 发送能力与 A2A 接收能力分离。发送者仍须通过冻结
`team_tool.post_message` capability；接收者只须是在队成员且自己的冻结 Runtime
ready。Antigravity 2.0 Desktop App 已验证支持标准 MCP；Core 不再按
`AdapterKind::AntigravityApp` 硬编码拒绝发送。当前同名 Adapter 实际启动的是
`agy --print` companion，尚未把 Desktop App 的 workspace MCP 配置纳入 Native
Binding，因此冻结 capability 仍不含 `team_tool.post_message`。它可作为叶子 A2A
目标并返回公共结果；未来 App Host 完成隔离注入后只需通过 capability 探测解锁。

## 10. Migration v27

Migration 使用一个事务：

1. 为 `agent_run` 增加 `permission_semantics TEXT NOT NULL` 约束或等价重建；
2. 将迁移前仍非终态的 Run 标记为 `core_enforced_v1`；
3. 将新行默认/显式值设为 `runtime_managed_v2`；迁移前终态 Run 使用不可执行的 v2
   默认标记，但不得据此重解释其历史 Action/Approval/Workspace 事实；
4. 保留 `workspace_json`、effective config、runtime permission snapshot、Action、
   Approval 和 delivery 字节内容；
5. 不修改 AgentProfile、Conversation override 或 AdapterInstallation snapshot；
6. 记录 schema migration 27；
7. 任一步失败完整回滚。

应用打开后，recovery 根据每条 Run 的显式 semantics 分支，不能按 status、
`workspace_json` 是否为空或数据库版本猜测。

## 11. 实现触点

| 位置 | 目标变化 |
|---|---|
| `db.rs` | Migration v27、Run semantics 与 upgrade tests |
| `runtime.rs` | typed semantics、Workspace path projection 与 claim/recovery |
| `collaboration.rs` | 新 Run v2、停止为 v2 生成资源 Action Policy |
| `team_tool.rs` | Schema 不变；A2A 只复制 cwd path，目标 Runtime 独立冻结，接收与发送 capability 解耦 |
| `action.rs` | v1 policy 保留；v2 request relay/record，不做 scope/access policy |
| `main.rs` | Adapter launch 与 permission request 分支，不再读取 access 授权 |
| `codex.rs` | Codex native option 冻结与 exact resolution |
| `acp.rs` | ACP options 全量冻结与 exact optionId resolution |
| `read_model.rs` | Run semantics、native request options 与 honest audit view |
| `agent_profile.rs` | snapshot-derived advisory Readiness；Run admission 前权威 executable fingerprint |
| `packages/contracts` | Workspace path/semantics、Approval option resolution |
| Renderer | native option Approval UI、能力限制、recovery 状态和复用成员列表的大厅 preflight |
| Runtime Smoke | Codex/ACP 配置、A2A 隔离、外部目录请求和 exact decision round-trip |
