---
document_type: contract
name: Runtime Launch and Verification
version: v3
status: accepted
source_version: v0.98
last_updated: 2026-08-17
---

# Runtime Launch and Verification v3

本合同继承 v2 的 launch purpose、TRAE execution-deferred verification、ACP continuation、Prompt fencing 与
response-only input ACK，并新增启动浅检测、显式深检、manager-owned attempt 和统一 Probe process lifecycle。
决策理由见 [ADR-0204](../versions/v0.98/decisions.md#adr-0204)。

## 1. Light discovery

`run_runtime_discovery()` 与 `runtime.discovery.rescan` 只允许：

```text
resolve executable candidate
  -> canonical ordinary executable + permission check
  -> file metadata + executable fingerprint
  -> bounded side-effect-free identity/version command permitted by Adapter policy
  -> require successful exit + recognized bounded identity for light_ready
  -> persist static snapshot
  -> publish discovery/availability
```

非 TRAE Product Runtime 的静态快照为：

```ts
interface LightReadySnapshot {
  probeStatus: 'light_ready'
  authenticationStatus: 'unknown'
  executableFingerprint: string
  reportedVersion: string
  capabilities: []
  protocols: []
  models: []
  lastSuccessfulProbeAt: null
  staleAt: null
  lastError: null
}
```

one-shot 失败或输出超限时保存内部 `light_failed` 静态结果并投影为“需要处理”，不能建立可选成员默认值。
静态 permission descriptors 可以支持 Runtime-default 成员配置，但不属于 capability evidence。TRAE 保持 v2
`installed_unverified` shape 和静态版本规则。相同 path/fingerprint 的扫描保留 Ready；身份改变增加
Installation generation 并替换为对应静态快照，不排队深检。

## 2. Public projection and configuration

`runtimeAvailability[].status` 新增 `light_ready | needs_attention`。公共主状态按以下语义投影：

| Evidence | 主界面 | 含义 |
| --- | --- | --- |
| executable 未找到 | 未安装 | 当前搜索环境无候选 |
| `found_uninspected` | 暂时无法确认 | 只找到 executable，尚无成功轻度启动证据，也不表示 checking |
| `light_ready` | 可用 | 已通过有界轻度启动与身份识别，可以选择并尝试运行；未证明认证、协议、模型或能力 |
| active attempt | 正在检查 | 仅当前 manager attempt 存在期间 |
| Ready snapshot | 可用 | 深检证据满足当前 Adapter requirements |
| 显式检查或真实启动失败 | 需要处理/对应登录或兼容状态 | 失败与当前 fingerprint 匹配 |

`RuntimeReadinessStatus` 新增 `light_ready`。该状态只允许 `ModelSelection.runtime_default` 和静态 descriptor
验证通过的权限配置；explicit model 返回 `runtime_model_requires_verification`。Core 可以建立仅供 admission 的
Runtime-default sentinel 与已知 transport protocol，但它们不得写回 capability evidence。非 TRAE 首次 dispatch
必须先深检、提交 Ready、重新 resolve/rebind 后才可 launch。TRAE 继续按 v2 在同一真实 Host 内验证并执行。

## 3. Deep-check admission

深检只接受两种触发：

```ts
type RuntimeCheckTrigger = 'user_check' | 'execution'
```

- `runtime.product.check(runtimeKind)` 只排队指定 Runtime；
- 首次真实 AgentRun 在 `runtime_probe_required` blocker 上排队并等待 execution-priority attempt；
- `runtime.product.ensure` 保留 wire compatibility，但不得由页面加载、选择或 discovery 发起深检；
- 启动、rescan、版本刷新、fingerprint 变化和固定间隔不得自动排队；
- 同 Runtime 的重复请求合并为一个 attempt，waiter 附着到该 attempt；全局同时运行至多二个。

TRAE 仍受 v2 launch policy 收窄：availability/health purpose 不启动 `traecli`，首次真实执行使用同一 Host 验证。

## 4. Attempt lifecycle

每个内部 attempt 至少保存：

```ts
interface RuntimeCheckAttempt {
  attemptId: string
  runtimeKind: AdapterKind
  taskId: RuntimeTaskId | null
  trigger: RuntimeCheckTrigger
  deadline: Instant
}
```

Manager 在 queued/running 时拥有 activity。所有 success、classified failure、total timeout、worker panic/JoinError、
abort/cancel、channel close 与 shutdown 都调用同一幂等 finalize：

1. 仅当 `attemptId` 仍是该 Runtime 当前 owner 时移除 activity；
2. classified 产品失败保存可脱敏产品诊断；deadline/panic 保存 supervisor 诊断；cancel、superseded 与 shutdown
   不写产品失败或退避；
3. 唤醒全部 waiter；
4. 对该 attempt 至多发出一个 terminal `runtime.availability.updated`；
5. Ready 时触发既有 pending delivery pump。

任一 attempt 必须在 90 秒总期限内进入终态。旧 attempt 的结果还必须匹配当前 Runtime search generation 与
fingerprint；不匹配时作为 superseded 收口，不提交 snapshot。

## 5. Probe process owner

版本命令、ACP initialize/Session probe、Codex initialize/model/schema 与其他短生命周期 Runtime 子进程必须使用
同一 owner：

- Unix spawn 前创建独立 process group；cleanup 对 PGID 整树 `SIGKILL`，再 bounded wait leader；
- total deadline 覆盖协议交换，child/reader cleanup 各自有上限；leader 成功退出后也先清理进程组，再等待
  stdout/stderr reader，防止孙进程继承 pipe；
- stdout、stderr、单行 frame 分别有固定容量；超过容量停止协议读取或继续 drain 但不继续分配，并记录
  `truncated=true`；
- owner Drop 必须具有同步 kill fallback，临时目录由 RAII 清理；
- Windows 进入支持矩阵前必须以 Job Object 和 `KILL_ON_JOB_CLOSE` 提供等价进程树语义。

## 6. Wire and persistence compatibility

- `runtime.product.check` request shape 与 availability event 名称不变，`attemptId` 不进入公共 UI contract；
- 新增 snapshot/readiness/availability 枚举值，不要求数据库 migration；既有 text columns 接受新值；
- v2 Ready、`installed_unverified`、ACP Session continuation、Prompt fence、input ACK 与历史对象保持有效；
- 不自动改写成员选择；light discovery 只建立/更新 managed Installation 与静态 snapshot。

## References

- [Runtime Launch and Verification v2（历史）](runtime-launch-and-verification-v2.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [ADR-0192](../versions/v0.87/decisions.md#adr-0192)
