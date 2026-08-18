---
document_type: contract
name: Runtime Launch and Verification
version: v1
status: accepted
source_version: v0.87
last_updated: 2026-08-16
---

# Runtime Launch and Verification v1

本合同冻结 Product Runtime 的启动目的、静态 Installation 证据、执行期验证和用户状态投影。决策理由见
[ADR-0192](../versions/v0.87/decisions.md#adr-0192)，组件边界见
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

公共 Product Runtime Availability 增加 `installed_unverified`。AgentProfile Readiness 同样增加
`installed_unverified`，并带 blocker `runtime_verification_deferred`。它在 UI 中表示“已安装，待首次运行验证”，
不得映射成 checking、available/Ready、失败或未安装。

该状态下仅允许保存：

```ts
{
  adapterKind: 'trae-cn-cli'
  model: { source: 'runtime_default' }
  permissions: {
    adapterKind: 'trae-cn-cli'
    schemaVersion: 1
    values: { permission_mode: 'default' }
  }
}
```

显式 model 或未由静态安全 descriptor 允许的 permission 必须拒绝为
`runtime_model_requires_verification` 或既有 permission validation error。配置仍以一个 version-checked
command 原子保存；静态发现不能自动替用户配置成员。

## 4. Agent execution transition

允许的首次真实执行顺序唯一为：

```text
static path/fingerprint preflight
  -> spawn traecli acp serve once
  -> initialize
  -> session/new or session/load
  -> persist capability/auth/model/permission evidence from that host
  -> bind Session
  -> send the AgentRun input through the same host
```

冻结 binding 的 `reportedVersion` 为 nullable；未验证执行使用内部 Runtime-default sentinel，但不得把该
sentinel 发送为 TRAE model config。真实 Session 返回的 current/default model 在 Ready snapshot 中替代它。

成功 evidence 必须包含 ACP v1、可用默认 model 与安全 `default` permission mode，随后状态转为 Ready。
initialize/Session 失败按现有 authentication-required、incompatible 或 transient/launch-failed 分类；同一次
AgentRun 不得启动 replacement、version、Probe 或 diagnostic TRAE process。若 Ready 已在同一 Host 成功记录，
之后的输入或业务失败不得把它降回静态状态。

## 5. Wire compatibility and persistence

- `runtimeAvailability[].status` 与 `RuntimeReadinessStatus` 都接受 `installed_unverified`；
- Adapter snapshot `probeStatus` 接受 `installed_unverified`；
- frozen Runtime 与 AgentRun 的 `reportedVersion` 接受 `null`；
- 现有 SQLite 列已允许 nullable version 和文本状态，本合同不要求 schema migration 或历史数据重写；
- 既有 Ready、authentication-required、incompatible、missing、transient 与其他 Runtime 行为保持兼容。
