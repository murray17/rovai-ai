---
document_type: contract
name: Runtime Launch and Verification
version: v5
status: accepted
source_version: v1.03
last_updated: 2026-08-18
---

# Runtime Launch and Verification v5

本合同继承 v4 的 launch purpose、light discovery、manager-owned attempt、execution-deferred AgentRun、
TRAE/Kiro 最高权限队员默认、permission schema digest fence、ACP continuation、Prompt fence 与 input ACK，
并按 [ADR-0208](../adr/0208-user-authorized-trae-light-and-availability-verification.md)让 TRAE 参与正常轻检与
用户显式可用性检查。

## 1. TRAE light discovery

TRAE 启动与 `runtime.discovery.rescan` 使用和其他 Product Runtime 相同的有界 identity 流程：

```text
ordinary executable + canonical path + executable bit
  -> fingerprint
  -> traecli --version through Probe process owner
  -> successful bounded recognized output
  -> light_ready
```

成功 snapshot 必须为 `probeStatus=light_ready`、`authenticationStatus=unknown`、非空
`reportedVersion`/fingerprint、空 capabilities/protocols/models，且保留 v4 的 TRAE 静态权限 descriptor。
命令失败、超时、输出为空或超限写 `light_failed`；单纯 path/fingerprint 不能写 Ready 或 light-ready。

`light_ready` 在公共设置页显示“可用”，允许 Runtime-default model 与
`permission_mode=default|bypass_permissions` 配置，并允许首次真实 AgentRun 走同一 Host 验证。它不声明登录、
ACP、模型目录、Session 或 capability Ready。

## 2. User-authorized TRAE availability check

`runtime.product.check({runtimeKind:'trae-cn-cli'})` 使用 `AvailabilityCheck` purpose，并进入 v4 的 Runtime Check
Manager。TRAE launch matrix 为：

| Purpose | Allowed |
| --- | --- |
| `DiscoveryVersion` | yes |
| `AvailabilityCheck` | yes |
| `AgentExecution` | yes |
| `InstallationRefresh` | no |
| `HealthProbe` | no |
| `DispatchPreflight` | no |

Availability Probe 命令固定使用 `traecli acp serve --permission-mode default`。它只允许：

```text
bounded --version
initialize(protocolVersion=1)
session/new(cwd=isolated temporary root, mcpServers=[])
read model catalog + permission mode catalog
terminate the complete Probe process tree
```

它不得发送 `session/prompt`、行为 marker、工具调用、Approval 测试或模型请求。成功必须至少形成
`acp.initialize`、`session.new`、`model.dynamic_catalog` 与 `permission.mode_catalog`，随后用当前 Session
descriptor 生成 `probeStatus=ready`、`authenticationStatus=authenticated` 的 snapshot。失败沿用 v4 分类，
且不得用旧 Ready 之外的静态证据伪装成功。

## 3. Ready commit and projection

深检成功先原子提交 verified managed Installation。紧随其后的 `runtime.discovery.updated` 只更新当前
generation 的内存 observation 和 Renderer；不得再次调用静态 Installation commit，否则动态 permission
schema 与静态 descriptor 的差异会在同一次检查中覆盖刚写入的 Ready。

后续独立启动/rescan 仍使用 v4 permission schema digest fence。相同 path、fingerprint 与 schema digest
可以保留 Ready；任一变化降级到新的 `light_ready`/`light_failed`，不自动深检。`installed_unverified` 仅作为
旧持久数据或禁止启动 purpose 的静态回退继续可读。

## 4. Unchanged v4 boundaries

- Runtime Check 继续单 Runtime 单飞、全局并发二、总 deadline 90 秒，并由 manager 唯一 finalize；
- 启动、页面进入、成员选择、缓存过期与定时任务不得自动深检；
- TRAE/Kiro 新队员最高权限默认与实际 Availability Probe 的保守权限相互独立；
- TRAE 首次真实任务仍可从 `light_ready`/legacy `installed_unverified` 启动唯一 Host，在同一 Host 建立 Ready
  后继续任务；
- External MCP、Workspace narrowing、Prompt fence、input ACK、continuation 与 Fleet LRU 不变；
- wire request/event 名称和数据库 schema 不变。

## References

- [Runtime Launch and Verification v4（历史）](runtime-launch-and-verification-v4.md)
- [ADR-0208](../adr/0208-user-authorized-trae-light-and-availability-verification.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Runtime compatibility evidence](../runtime-compatibility.md)
