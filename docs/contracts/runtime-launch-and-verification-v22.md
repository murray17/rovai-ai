---
document_type: contract
name: Runtime Launch and Verification
version: v22
status: accepted
source_version: v1.27
last_updated: 2026-08-22
---

# Runtime Launch and Verification v22

v22 replaces [v21](runtime-launch-and-verification-v21.md). v21 的 launch purpose、identity fencing、Ready、
LKG、检查 attempt、公开 failure、MiniMax provider secret、thinking 清洗、cold exact continuation fallback 与
macOS arm64 平台准入保持不变；本版把 Kimi 的多 scope Session home 收敛为一个 Rovai 私有 home，启用兼容
warm Host reuse，并在真实产品链路验证后启用 Kimi External MCP。

## Kimi 全局私有 home

Kimi 仍以 `<resolved-executable> acp` 启动，使用 ACP v1 newline-delimited JSON-RPC。Core 不读取、改写或
复用用户 `~/.kimi/config.toml`，也不修改进程的通用 `HOME`。所有 Kimi Host 的 `KIMI_CODE_HOME` 固定为：

```text
<Rovai data-dir>/runtime/kimi-code/home
```

Rovai 不再按 Camp、成员、Installation 或 auth scope 派生额外目录。该目录是 Kimi 自己管理多个 Native
Session 的持久存储，创建后必须保持用户私有权限，不随单个 Host shutdown 删除。Runtime installation、
binding、model、permission、workspace、MCP 与 attachment 的兼容性仍由既有冻结配置和 Session compatibility
门禁决定；共享物理 home 不授权不兼容 AgentRun 恢复或复用 Native Session。

每个 Kimi AgentRun terminal 可见前都必须完成 Host release。Host 健康、协议未违规、无 pending RPC、无绑定
Session route 且 Frozen Runtime、Camp、成员、workspace、permission、MCP、attachment 与 Built-in compatibility
digest 完全一致时，Host 进入 warm LRU；兼容后继 Run 持有该 Host 已知的 Native Session ID 时直接复用同一
Host/Session，不发送 `session/resume` 或 `session/load`。

Host 被显式停止、容量/TTL 淘汰、崩溃或 compatibility 不一致时不得 warm reuse。兼容后继 Run 持有既有 Native
Session ID 时，优先在新 Host 上发送 exact `session/resume`；只有 Runtime 不支持 resume、但支持
`session.load` 时才进入既有 History Restore replay quarantine。返回其他 Session ID、协议异常、超时或 replay
超限都必须 fail closed。cancel、planned shutdown、Camp 删除与 App shutdown 仍停止并回收完整进程树。

## Kimi External MCP

Kimi 的 External MCP 使用标准 ACP Session 字段，不写 Runtime 用户级配置：

- Projection 为 `AdditivePerRun`，同名策略为 `RovaiWins`；
- `session/new`、`session/resume` 和 `session/load` 都接收本次冻结的 `mcpServers` 完整定义；
- stdio 与 Streamable HTTP 均受支持，环境引用在投影冻结阶段解析；
- MCP Server 集合与 projection digest 继续进入 Runtime compatibility digest；不兼容集合不得复用 Host；
- ContextManifest 保存 Server logical name、runtime name、transport、状态与同名策略，不保存解析后的秘密值；
- 未分配或未配置 Server 的相邻 AgentRun 不继承前一 Run 的投影。

真实发布证据必须走 Core、Assignment、AgentRun Projection、ContextManifest 和模型 Tool call 全链路，同时验证
stdio、Streamable HTTP 与同名整项优先。原始 ACP Probe、文档或只看到 Tool catalog 不能单独建立产品资格。

## Runtime catalog 与 Cursor 展示

Runtime 的异步 command/config advertisement 可以继续作为私有 Session metadata 安全路由；当前产品没有消费
它的需求，因此“不维护权威 async catalog snapshot”不是功能缺口或准入遗留项。未来只有在产品表面实际消费
该 catalog 时，才需要建立独立的 replacement/generation 合同。

Cursor Agent identity 继续保留，以便读取历史配置和完成后续实现；三个目标平台仍为 `not_qualified`，默认
discovery、检查和 AgentRun 均不准入。Settings 的 Agent Runtime 目录不得展示 Cursor，直到其真实产品链路
完成并以新合同明确开放；这不要求删除 closed `AdapterKind` 或历史数据 reader。

## Acceptance

- 任意两个 Kimi Host 的 `KIMI_CODE_HOME` 都等于唯一 `<data-dir>/runtime/kimi-code/home`，且通用 `HOME`
  保持不变；
- 两个兼容且正常完成的连续 AgentRun 使用相同 Host instance 与 Native Session ID，协议只有一次
  `session/new`，不得出现 `session/resume/load`；
- 显式停止首个 Host 后，兼容后继 AgentRun 使用不同 Host instance，执行 exact `session/resume` 并保持
  Native Session ID 不变；
- Kimi capability snapshot 声明 `session.resume/load`、Built-in transport 与
  `mcp.external_projection.additive_per_run / mcp.same_name_policy.rovai_wins`；
- 真实 Kimi MCP smoke 同时调用 stdio、Streamable HTTP 和同名 Server，所有结果都来自 Rovai 的完整定义，
  ContextManifest 中三项均为 `ready`；
- Kiro 每 Host 临时配置、其他 Runtime continuation 与 External MCP 策略不发生语义变化；
- Settings Agent Runtime 目录不渲染 Cursor；其内部 identity、历史读取和平台未准入状态仍保留；
- async command/config advertisement 不列入当前 Kimi 遗留问题。

## References

- [Runtime Launch and Verification v21](runtime-launch-and-verification-v21.md)
- [Runtime Platform Admission v1](runtime-platform-admission-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Kimi Code Runtime Research](../research/kimi-code-runtime-research.md)
- [V1.27-D04](../versions/v1.27/decisions.md#v1-27-d04)
