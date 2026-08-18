---
document_type: contract
name: Runtime Launch and Verification
version: v2
status: accepted
source_version: v0.98
last_updated: 2026-08-17
---

# Runtime Launch and Verification v2

本合同继承 v1 的 Product Runtime 启动目的、静态 Installation 证据和执行期验证边界，并新增 ACP
Session 续接、历史 replay 隔离、Prompt fencing 与 warm Host 复用规则。决策理由见
[ADR-0192](../versions/v0.87/decisions.md#adr-0192)和
[ADR-0123](../versions/v0.41/decisions.md#adr-0123)，组件边界见
[Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)。

## 1. Launch purpose

Core 内每个 Runtime child launch 必须先绑定以下一个 purpose：

```ts
type RuntimeLaunchPurpose =
  | 'discovery_version'
  | 'availability_check'
  | 'installation_refresh'
  | 'health_probe'
  | 'dispatch_preflight'
  | 'agent_execution'
```

TRAE 的 policy 仅允许 `agent_execution`。`runtime.discovery.rescan`、`runtime.product.check`、
`runtime.product.ensure`、managed/custom Installation refresh、health/diagnostics 与 dispatch preflight
都不得启动 TRAE。并发、交互式 shell 选择、显式按钮或缓存失效不改变该规则。

其他 Runtime 的当前 policy 允许上述全部目的。低层 version runner、active health probe 和 ACP Host
各自重复执行 policy guard；调用者提前分流不能替代被调用边界的防御。

## 2. Static snapshot

TRAE 静态发现成功时持久化：

```ts
interface InstalledUnverifiedSnapshot {
  probeStatus: 'installed_unverified'
  authenticationStatus: 'unknown'
  reportedVersion: string | null
  executableFingerprint: string
  capabilities: []
  protocols: []
  models: []
  lastSuccessfulProbeAt: null
  staleAt: null
  lastError: null
}
```

它还要求 absolute canonical executable path、普通文件、执行位、批准的 discovery source 与可读取的
file identity。静态版本只接受进程内解析的 `.app/Contents/Info.plist` 或明确 TRAE main module 的 Go
build information；无结果时必须保持 `null`。mtime、size、inode、fingerprint 和二进制任意 semver 字符串
都不是 reported version。

相同 path/fingerprint 的静态复扫保留现有 Ready snapshot，只更新 Installation 的最近身份校验时间；
path 或 fingerprint 改变时 generation/version 递增并写 relocation audit，snapshot 回到
`installed_unverified`。

## 3. Availability、Readiness 与成员配置

公共 Product Runtime Availability 接受 `installed_unverified`。AgentProfile Readiness 同样接受
`installed_unverified`，并带 blocker `runtime_verification_deferred`。它在 UI 中表示“已安装，待首次运行验证”，
不得映射成 checking、available/Ready、失败或未安装。

该状态下 TRAE 仅允许保存 Runtime-default model 与 `permission_mode=default`。显式 model 或未由静态安全
descriptor 允许的 permission 必须拒绝为 `runtime_model_requires_verification` 或既有 permission validation
error。配置仍以一个 version-checked command 原子保存；静态发现不能自动替用户配置成员。

## 4. TRAE execution transition

首次真实执行顺序为：

```text
static path/fingerprint preflight
  -> spawn traecli acp serve once
  -> initialize
  -> session/new
  -> persist capability/auth/model/permission evidence from that host
  -> bind Session
  -> send the AgentRun input through the same host
```

冻结 binding 的 `reportedVersion` 为 nullable；未验证执行使用内部 Runtime-default sentinel，但不得把该
sentinel 发送为 TRAE model config。真实 Session 返回的 current/default model 在 Ready snapshot 中替代它。
TRAE readiness 不要求 `session.load`；`session.resume` 按 ACP v1 的
`agentCapabilities.sessionCapabilities.resume` 对象标记观察，是可选能力。

成功 evidence 必须包含 ACP v1、可用默认 model 与安全 `default` permission mode，随后状态转为 Ready。
initialize/Session 失败按现有 authentication-required、incompatible 或 transient/launch-failed 分类；同一次
AgentRun 不得启动 version、Probe 或 diagnostic TRAE process。若 Ready 已在同一 Host 成功记录，之后的输入
或业务失败不得把它降回静态状态。

## 5. ACP Session continuation

正式 AgentRun 的正常续接选择顺序为：

```text
same Host knows Session -> ReuseSameHost
new Host + session.resume capability -> Resume
otherwise -> New
```

`session/load` 表示带历史 replay 的加载，不是正常续跑 primitive。TRAE 跨 Host 正常续跑永远不得调用
`session/load`，`session/resume` 失败也不得回退到 `session/load`。没有 resume 能力的冷 TRAE Host 使用
`session/new`，并通过既有 Prepared Native Binding 换代流程绑定新的 Session；旧 AgentRun 历史保持不变。

现有非 TRAE ACP Adapter 可以在缺少 resume 时保留显式 `LoadHistory` 兼容路径。该路径必须在
`session/load` request 发出前建立 `LoadingReplay` route；匹配 response 是唯一正常 replay barrier，禁止固定
等待时间、正文相似度、Tool ID 或事件数量启发式。Loading replay 不得进入 Evidence、Action、Usage、
Missing-Send Recovery、Compaction、Renderer emit 或 input ACK。

## 6. Prompt event isolation and input ACK

Session route 至少区分 `LoadingReplay`、`Ready`、`PromptActive`、`PromptCompleted` 与
`ProtocolViolated`。只有 `PromptActive` 可以把 Session-scoped message 转交 AgentRun。Ready/Completed 阶段
出现无法关联的 Session message 必须 fail closed，并使该 Host 不再具备 IdleWarm 资格。

每个内部 ACP message 在任何业务副作用前必须同时匹配：

```text
Host instance + AgentRun + execution epoch + Native Session + Native Prompt + Delivery
```

Prompt 观察状态按 Prompt 建立并持有 streamed text、Missing-Send collector 与 Tool metadata；不得跨 Prompt、
AgentRun 或 Host 复用。ACP v1 的普通 `session/update` 和 `session/request_permission` 只有 Session ID，不构成
当前输入的 accepted 证明。匹配 `session/prompt` request 的成功 response 产生 `InputAccepted`，匹配错误
response 产生 `InputNotAccepted`；无明确 Prompt correlation 的事件不得提前 ACK。

## 7. Wire compatibility and persistence

- 公开 IPC、Runtime Event 名称与公开 payload 不变；新增 fence 字段仅存在于 Core 内部；
- `runtimeAvailability[].status`、`RuntimeReadinessStatus` 与 Adapter snapshot 继续接受
  `installed_unverified`；
- frozen Runtime 与 AgentRun 的 `reportedVersion` 继续接受 `null`；
- 不要求数据库 migration，不重写旧 Evidence、Action、AgentRun 或 Native Session 历史；
- 新 Session 只更新当前逻辑 Conversation 面向后续 Run 的 Native Binding；
- 旧 capability snapshot 只有 `session.load` 时无需改写：TRAE 选择 New，允许 legacy load 的其他 ACP
  Adapter 保持兼容路径。

## References

- [Runtime Launch and Verification v1（历史）](runtime-launch-and-verification-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- [Accepted Input Recovery v1](accepted-input-recovery-v1.md)
