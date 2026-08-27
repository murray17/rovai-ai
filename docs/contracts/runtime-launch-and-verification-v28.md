---
document_type: contract
name: Runtime Launch and Verification
version: v28
status: accepted
source_version: v1.29
last_updated: 2026-08-27
---

# Runtime Launch and Verification v28

v28 replaces [v27](runtime-launch-and-verification-v27.md). v27 的 Runtime Home、Probe、模型、Session、
continuation、External MCP、公开 Runtime activity/failure、时间域、逐平台准入和 Grok Build 边界全部保持不变。
本版只收敛 ACP Client Filesystem 与 `session/request_permission` 的权限所有权：文件权限由冻结的 Adapter
配置和原生 Runtime 独立拥有，Core 的 ACP Client FS 只执行协议请求，不再形成第二层文件鉴权。

## 1. Runtime-owned filesystem permission

- 一个新 AgentRun 的文件、Shell 与网络权限继续由其冻结的 Adapter Permission Configuration 和原生 Runtime
  决定。Runtime 的 sandbox、permission mode、approval mode 或 trust-all 配置才是 Agent 文件访问边界；
- Core 不把 Run Workspace access、execution root containment、Runtime Permission Request、Approval 或 Action
  resolution 转换成 ACP Client FS 的额外文件 capability；
- Core 自己创建、更新或通过产品 API 读取 blob、附件 Authority、私有配置、socket、日志、临时文件和领域命令时
  继续执行各自的 Application-Managed File Safety，也不主动把私有路径作为 Runtime 输入。这些产品边界不等于
  对 Runtime 独立知道的任意路径再建立一份 allowlist。

## 2. ACP Client Filesystem proxy

匹配当前 Host、Run、execution epoch、Native Session、Prompt 与 Delivery fence 的 ACP 请求可以调用
`fs/read_text_file` 和 `fs/write_text_file`。Core 仍执行 JSON-RPC 与参数校验：read 必须提供类型正确的
`path` 字符串；write 必须提供类型正确的 `path` 与 `content` 字符串。操作系统读取、建目录或写入失败按标准
ACP error response 返回。

路径解释固定为：

- 绝对路径按 Runtime 提供的路径执行；
- 相对路径以冻结的 execution root 为解析基准；这只是 cwd-compatible resolution，不是 containment；
- Core 不再对该路径调用 `scoped_path()`，不 canonicalize 后做 `starts_with(executionRoot)`，也不拒绝 `..`、
  symlink 或 execution root 外目标；最终可访问性由 Runtime sandbox/permission mode 和操作系统决定；
- write 不检查 Workspace `read_only` metadata，不查找或消费一次性授权。相同或不同路径可以在同一 Run 中
  连续写入；父目录仍按请求需要创建；
- read 与 write 都不因 `session/request_permission` 是否出现、选择或投递成功而改变执行资格。

## 3. ACP permission request compatibility

`session/request_permission` 仍是 Runtime 原生协议交互，不是 ACP Client FS token minting。Core 必须先验证当前
Run、epoch、Session、active Prompt、稳定 Tool Call identity、路径规范化语义和原生 option shape；stale、
detached、cancelled、非法参数或没有可用 native option 的请求继续拒绝。

对 `RuntimeManagedV2` Run，以下冻结配置表示 Runtime 已选择全自动或绕过交互的原生模式：

| Adapter | 自动响应配置 |
| --- | --- |
| OpenCode | `permission=allow` |
| Copilot | `allow_all=on` |
| Kiro | `trust_all_tools=on` |
| Qoder / TRAE | `permission_mode=bypass_permissions` |
| CodeBuddy / Grok Build | `permission_mode=bypassPermissions` |
| Qwen Code | `approval_mode=yolo` |
| Cursor Agent | `approval_policy=force` |
| Kimi Code | `permission_mode=yolo` |

若这些模式下 Runtime 仍发送合格的 `session/request_permission`，Core 直接选择请求中匹配的原生
`allow_once`（或等价非持久 allow）选项并回复，不创建 Approval、Action execution 或文件写授权。这个响应只保证
ACP wire 兼容，不把 Runtime 模式升级成 Core 权限事实，也不影响后续 Client FS 请求。

较窄或交互式 Runtime 模式继续使用既有 fenced Runtime Permission Request、Approval、exact native option 与
response delivery 流程；用户决定属于 Runtime 原生交互，不产生 Client FS token。legacy `CoreEnforcedV1` 只为
既有非终态 Run 的恢复保留既有 Action mediation；它同样不再控制 Client FS read/write。

## 4. 保留的 Core 边界

- Host、Run、execution epoch、Session、Prompt、Delivery 与 request identity fencing 不变；
- cancel、detach、stale callback、未知 method、缺字段、字段类型错误与 JSON-RPC response correlation 继续由 Core
  fail closed；
- Rovai 领域命令、Camp 授权、Managed Blob API、附件 API 与 Built-in Tool lease 的业务校验保持不变，也不把
  私有路径主动投影给 Runtime；ACP Client FS 本身不替这些 API 对 Runtime 独立知道的路径再做授权。若同 UID
  Runtime 已知该路径，文件隔离只能由 Runtime sandbox/permission mode 或操作系统提供；
- 本版没有 schema、Migration、Renderer 或 Runtime Activity wire 变化。

## 5. Acceptance

- 未调用任何 authorize API 的 `RuntimeManagedV2` ACP Host 可以写入 execution root 外的绝对路径；
- 即使 Run Workspace metadata 为 `read_only`，Client FS 仍按 Runtime 请求连续两次写同一文件并读回第二次内容；
- `authorized_file_writes`、`authorize_file_write()`、one-time matching error 和 Runtime Delivery 中的 scope-to-token
  bridge 均不存在；
- 十种 ACP Adapter 的全自动配置以表驱动回归直接选择原生 allow；相应交互配置不会被误判为自动模式；
- invalid params、stale Session/Prompt、cancel/detach 与 OS read/write failure 仍返回协议错误，不伪造成功。

## References

- [Runtime Launch and Verification v27](runtime-launch-and-verification-v27.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [当前基础架构不变量](../architecture/foundational-invariants.md#runtime-platform-security)
- [v1.29 decisions](../versions/v1.29/decisions.md#v1-29-d10)
