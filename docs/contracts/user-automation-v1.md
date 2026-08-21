---
document_type: interface-contract
contract: user-automation
version: 1
authority: desktop-user-automation-transport-and-diagnostic-trial
status: accepted
last_updated: 2026-08-21
---

# User Automation v1

本文冻结普通用户从终端控制正在运行的 Rovai Desktop，以及执行一次 Runtime Diagnostic Trial 的 V1
边界。它不是调试接口，也不是 Agent Runtime 的 Built-in Tool transport。决定理由见
[V1.21-D01](../versions/v1.21/decisions.md#v1-21-d01)和
[V1.21-D02](../versions/v1.21/decisions.md#v1-21-d02)。Runtime 隔离与原子发送的修正理由见
[V1.21-D03](../versions/v1.21/decisions.md#v1-21-d03)和
[V1.21-D04](../versions/v1.21/decisions.md#v1-21-d04)。

## 1. 一个 binary、两条运输

安装包只交付一个 `rovai` binary：

```text
rovai send ...       -> Agent CLI transport
rovai app ...        -> User Automation transport
```

两条运输只共享可执行文件，不共享 endpoint、credential、调用身份、授权、Envelope、receipt 或命令目录。
`rovai app` 不能使用 AgentRun process-private context，Agent CLI 也不能使用 User Automation credential。
Electron Main 拥有 User Automation Server；每条命令是短进程，经当前用户私有的本地 IPC 调用 Main，再由
Main 调用封闭的 Core method。不存在 `rovai-app` daemon、generic Core invoke 或 schema discovery。

V1 的 User Automation transport 只在 macOS 交付，使用 Unix Socket。Desktop 未运行、context 过期或 socket
不可连接时返回 `app_not_running`；命令不得暗中启动 App。未来启动能力必须使用另行定义的显式
`rovai app launch`。

## 2. 本机发现与鉴权

Desktop 每次启动创建随机 `instanceId`、高熵 User Automation credential 与 Unix Socket，并将最小连接
context 原子写入当前用户应用数据目录的 `automation-v1/connection-v1.json`。目录和 socket 为 `0700`，
context 为 `0600`；context 至少包含 contract version、instance ID、PID、endpoint 和 credential。

CLI 默认只读标准 Rovai AI 应用数据目录。测试可以显式设置
`ROVAI_APP_AUTOMATION_CONTEXT` 指向隔离实例；这不是生产远程寻址或任意 endpoint 参数。Server 对每个请求
同时验证 `contractVersion`、`instanceId` 与 credential，限制单帧为 4 MiB，只接受一行完整 JSON，并在
关闭时移除本实例 socket/context。credential 不进入 stdout、日志、错误 details 或 Trial bundle。

`0700/0600` 只隔离其他 OS 用户，不隔离同一用户下的受管 Runtime。macOS 上，所有 Core-managed Probe、Host、
one-shot Runtime 及其后代必须由 Managed Process 边界施加 OS 级 file read/write deny，覆盖当前实例完整
`automation-v1` 树；sandbox 无法建立时在投递输入前 fail closed。Runtime 环境中的 `rovai --help` 不展示
`app` namespace，直接调用 `rovai app ...` 也稳定拒绝；这只是纵深防御，安全性不能依赖可被子进程修改的环境
变量、PATH 或 CLI 分支。普通用户自己启动的同 UID 终端进程仍可使用该 credential，这是 User Automation 的
目标 principal。

请求和响应 envelope 为：

```ts
type UserAutomationRequest = {
  contractVersion: 1
  requestId: string
  instanceId: string
  credential: string
  operation: UserAutomationOperation
  params: object
}

type UserAutomationResponse =
  | { requestId: string; ok: true; result: object }
  | { requestId: string; ok: false; error: { code: string; message: string; details?: object | null } }
```

CLI stdout 始终为一个 JSON document；业务拒绝使用非零退出码和稳定错误对象。底层 stack、SQL、绝对应用数据
路径、socket、credential、Runtime secret 与原始 Core error 不得投影。

## 3. 公共命令目录

V1 只提供以下普通用户命令：

```text
rovai app status
rovai app runtime list
rovai app member list
rovai app member show --member-id <id>
rovai app camp create [--name <name>] (--workspace <directory> | --quick-chat)
                      --member <id> [--member <id> ...] [--lead <id>]
rovai app camp send --camp-id <id> --agent-id <id> (--body <text> | --body-file <path>) [budget]
rovai app camp open --camp-id <id>
rovai app agent-run show --agent-run-id <id>
rovai app agent-run watch --agent-run-id <id>
rovai app agent-run export --agent-run-id <id> --output <directory>
rovai app agent-run cancel --agent-run-id <id>
rovai app trial run --agent-id <id> --workspace <directory> --task-file <file> [--timeout 30m]
                    [--wait | --no-wait] [--export <directory>] [--open]
```

`camp send` 的 budget 可以使用单一 `--timeout`，或完整地给出 Core 当前接受的执行预算字段；不能静默混合
不完整预算。`member show`、`runtime list` 与 workspace inspection 是 Trial admission 使用的安全 read model，
不会修改成员 Runtime。V1 不提供成员 Runtime mutation、Camp delete、AgentRun list、任意 Evidence/raw input
导出或 generic invoke。

`camp open` 先由 Main 向 Core 验证 canonical Camp ID 当前存在，再创建、恢复或聚焦 Desktop window，并沿现有
Renderer Camp activation 路径导航。它不得启动未运行的 Desktop，也不得接受 URL、路由字符串或任意 path。

## 4. Camp send 与 launch 结果

自动发送使用一次 `userAutomation.camp.send` Core command，而不是 Main 中的 get/save/send 组合、直接写表或
调用 Runtime。该命令在一个 Domain Command transaction 中验证 Camp、显式目标成员、预算与执行准入，写入
CampMessage，并在需要时创建 CampTurn/AgentRun。`commandId` 同时覆盖消息与 launch 的幂等结果；相同 payload
重放返回原结果，不重复效果，不产生或消费 Composer draft。用户现有草稿及其 revision、reply、附件与接收者
状态必须原样保留，拒绝和中途错误也不能遗留 staging draft。

V1 launch 结果只有以下闭集：

```ts
type AutomationLaunchResult =
  | {
      status: 'dispatched'
      campMessageId: string
      campTurnId: string
      agentRunIds: string[]
      executionBudget: CampTurnExecutionBudgetView
      replayed: boolean
    }
  | {
      status: 'rejected'
      code: string
      message: string
      preflight: StartPreflightResult | null
      replayed: boolean
    }
```

User Automation 不返回或承诺 `deliveryIds`。`pendingExecution` 必须为 `null`；如果 Core 返回非空值，Main
必须以 `automation_contract_upgrade_required` fail closed，不能猜测未来异步执行语义。Diagnostic Trial 的
成功 launch 必须恰好返回一个 `agentRunId`。

## 5. Diagnostic Trial

Trial 是 CLI-owned 的一次性 Runtime 诊断编排，不在 Core 新增 Trial、Benchmark 或 Qualification entity，
也不产出正式通过率。每次 `trial run`：

1. 验证目标成员存在、未移除、Runtime 已配置且当前可用；
2. 检查 workspace 为真实目录并记录只读 Git baseline；
3. 在第一次 Core mutation 前创建私有 durable journal，记录 `trialId`、phase、幂等 command IDs 与预定导出目录；
4. 创建一个隔离、单成员、lead-coordinated Camp；
5. 以显式目标成员和冻结 timeout/budget 发送 task file 原文；
6. 接受且只接受一个 root AgentRun；按选择等待、导出和打开 Camp。

默认 `--wait`；`--no-wait` 在已调度后立即返回可继续查询的 IDs。timeout 只冻结 Core 执行预算：

```json
{
  "elapsedSeconds": "由 --timeout 解析",
  "maxAgentRunResponsibilities": 1,
  "maxAcceptedA2a": 0
}
```

CLI 等待超时或中断不伪造 AgentRun terminal，也不自动扩大预算。任何创建后失败都保留 journal 与已知
Camp/CampTurn/AgentRun ID；若请求导出，则尽力生成 partial bundle 并在错误 details 中返回位置，便于恢复。

## 6. 双 cursor 观察

`agent-run watch` 与 Trial settlement 同时维护两条互不替代的 cursor：

- domain event 使用全局 `globalSequence`，只筛选精确 AgentRun；
- Execution Evidence 使用 Run-local `evidenceSequence`，按有界页面读取。

CLI presentation ordinal 只能表达本次输出顺序，不是领域 cursor。AgentRun 是否 terminal 只从 Core 的
AgentRun 状态读取，不能由最后一条 Evidence、Runtime 进程退出、空闲超时或 CLI 断连推断。断连重试从已确认
cursor 继续；无法证明结果时返回可恢复错误而不重发 mutation。

## 7. 安全诊断投影

Core method `agentRuns.diagnostic.get` 返回 `schemaVersion: 1` 的 `AgentRunDiagnosticView`。它只包含：

- Run/Camp/Conversation identity、状态、version、创建/开始/结束时间与当前 `globalSequence`；
- 冻结的 `adapterKind`、configured runtime ID、model、permission mode、`effectiveConfigDigest`；
- 最新 ContextManifest 的 formatter/profile/manifest 版本、rendered digest、bootstrap delivery mode、Camp boundary、
  Skill/MCP/Attachment digests；
- workspace path 的 digest、Git baseline/final commit/dirty 与 availability；
- Evidence count、最后 sequence、kind 计数与 terminal-evidence presence；
- `finalOutputDigest`、`finalCampMessageId`、来自仍可见公共 CampMessage 的 `publicOutput`，以及封闭
  `unavailableReason`。

投影不得包含 raw effective config、Runtime payload 或 payload digest、secret、credential、environment、
bootstrap/context bytes、authority path、原始 Runtime final output 或私有 failure。`publicOutput` 只来自正式发布
且未 tombstone 的 CampMessage；成功但未发布时保持不可用，不能用 Runtime final output 填充。

## 8. 导出 bundle

`agent-run export` 与 Trial export 创建仅当前用户可读的私有目录。Trial bundle 可包含：

```text
trial.json
task.md
launch.json
workspace-baseline.json
runtime-configured.json
agent-run-diagnostic.json
watch.jsonl
evidence.jsonl
public-output.md          # 仅在公共消息可用时
attachments.json
README.md                 # 明示敏感性、边界与非正式资格
```

bundle 不包含 credential、socket、raw config/context/bootstrap、environment、authority path、私有 Runtime
final output 或未公开附件正文。`trial.json` 必须写明 `formalQualification: false`。Journal 与 bundle 的写入采用
同目录 staging + fsync/close + atomic replace；既有目标不被静默覆盖。

## 9. 错误与后续范围

稳定错误至少包括 `app_not_running`、`automation_unauthorized`、`automation_invalid_input`、
`automation_not_found`、`automation_conflict`、`automation_contract_upgrade_required`、
`automation_settlement_incomplete` 和 `automation_internal_error`。只有 error contract 允许的 safe details 可输出。

Shell 退出码闭集为：

| code | 含义 |
| --- | --- |
| `0` | read 成功、mutation applied/accepted/dispatched，或等待到 `succeeded` |
| `1` | 领域 mutation/launch rejected，或等待到 `failed`/`cancelled` |
| `2` | 输入、发现、鉴权、transport、协议或合同错误，命令未得到可解释业务结果 |
| `3` | mutation outcome 或等待 settlement 无法证明，调用方必须复核稳定 ID 后再决定恢复 |

`trial run --wait` 与 `agent-run watch` 必须把最终 AgentRun `failed`/`cancelled` 映射为 `1`；settlement deadline
后仍非终态映射为 `3`。打印 JSON 不得把失败降级为 shell success。

V1 明确延后 Windows User Automation transport、App launch、成员 Runtime mutation、Camp delete、通用
AgentRun/Evidence 浏览、input export、pending execution、正式 Benchmark/Eval、远程 automation 和 daemon。
