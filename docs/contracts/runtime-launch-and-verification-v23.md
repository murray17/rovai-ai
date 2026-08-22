---
document_type: contract
name: Runtime Launch and Verification
version: v23
status: accepted
source_version: v1.27
last_updated: 2026-08-23
---

# Runtime Launch and Verification v23

v23 replaces [v22](runtime-launch-and-verification-v22.md). v22 的 launch purpose、identity fencing、Ready、
LKG、检查 attempt、公开 failure、MiniMax provider secret、thinking 清洗、warm Host reuse、cold exact
continuation、Kimi External MCP、Cursor 默认隐藏及逐平台准入保持不变；本版停止为正式 Kimi AgentRun
创建 Rovai 私有 state home，改为继承用户原生 Kimi Home，并明确正式运行与一次性 Probe 的隔离边界。

## Kimi 用户原生 Home

Kimi 仍以 `<resolved-executable> acp` 启动，使用 ACP v1 newline-delimited JSON-RPC。正式 AgentRun Host
不得设置、删除或重写进程的通用 `HOME` 与 `KIMI_CODE_HOME`：

- 父进程已有 `KIMI_CODE_HOME` 时，Kimi 子进程原样继承；
- 父进程未设置时，由 Kimi 自身解析其默认 Home；
- Core 不复制、合并或改写该 Home 内的 `config.toml`、认证、Session、Skill 或日志；
- 权限收窄的 Rovai provider 文件仍只把六个 allowlisted `KIMI_MODEL_*` 变量注入目标子进程。该
  process-local provider overlay 不构成 state/config Home 隔离，也不得持久化到用户 Kimi 配置。

这一行为与其他正式 Product Runtime 的默认原则一致：除非存在单独确认的产品隔离需求、生命周期合同和
迁移方案，否则 Runtime 使用用户已配置的原生状态根。临时 cwd、Run tmp、External MCP 文件或进程级 provider
overlay 不能被描述成独立 Runtime Home。

显式 Capability/Deep Probe 可以为一次性进程设置 Probe-owned 临时 `KIMI_CODE_HOME`，前提是 Probe 不复用
正式 Native Session、不把临时 Session ID 写入产品 Binding，并在超时、失败或完成后清理。Probe 的临时 Home
证据不能代替正式 AgentRun 的 Home、认证或 continuation 验证。

升级前由 v22 创建的 `<data-dir>/runtime/kimi-code/home` 不再用于新 Host。Core 不自动把该目录合并进用户
Home，也不自动删除其中数据。若旧 Binding 只存在于该旧目录，新 Host 的 exact resume 可以按既有恢复合同
fail closed；Core 记录 continuity lost、停止失败 Host，并至多建立一个使用用户原生 Home 的新 Session。

## Kimi continuation 与 Host reuse

每个 Kimi AgentRun terminal 可见前都必须完成 Host release。Host 健康、协议未违规、无 pending RPC、无绑定
Session route 且 Frozen Runtime、Camp、成员、workspace、permission、MCP、attachment 与 Built-in compatibility
digest 完全一致时，Host 进入 warm LRU；兼容后继 Run 持有该 Host 已知的 Native Session ID 时直接复用同一
Host/Session，不发送 `session/resume` 或 `session/load`。

Host 被显式停止、容量/TTL 淘汰、崩溃或 compatibility 不一致时不得 warm reuse。兼容后继 Run 持有既有 Native
Session ID 时，优先在继承同一用户原生 Home 的新 Host 上发送 exact `session/resume`；只有 Runtime 不支持
resume、但支持 `session.load` 时才进入既有 History Restore replay quarantine。不得为普通 continuation 人为
更换 `HOME`、`KIMI_CODE_HOME`、认证目录或用户身份后再把失败归因于 Runtime。返回其他 Session ID、协议异常、
超时或 replay 超限都必须 fail closed。cancel、planned shutdown、Camp 删除与 App shutdown 仍停止并回收完整
进程树。

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

- 正式 Kimi command 没有显式 `HOME` / `KIMI_CODE_HOME` override；两个 Host 均观察到父进程原值或同样的
  unset 状态，且不创建 `<data-dir>/runtime/kimi-code/home`；
- Kimi Deep Probe 使用独立临时 Home，结束后不留下正式 Binding 或持久 Probe Session；
- 两个兼容且正常完成的连续 AgentRun 使用相同 Host instance 与 Native Session ID，协议只有一次
  `session/new`，不得出现 `session/resume/load`；
- 显式停止首个 Host 后，兼容后继 AgentRun 在同一用户原生 Home 下使用不同 Host instance，执行 exact
  `session/resume` 并保持 Native Session ID 不变；
- v22 旧私有 Home 中的 Session 不可见时只触发一次既有 continuity-lost replacement，不复制或删除用户数据；
- Kimi capability snapshot 声明 `session.resume/load`、Built-in transport 与
  `mcp.external_projection.additive_per_run / mcp.same_name_policy.rovai_wins`；
- 真实 Kimi MCP smoke 同时调用 stdio、Streamable HTTP 和同名 Server，所有结果都来自 Rovai 的完整定义，
  ContextManifest 中三项均为 `ready`；
- Kiro 每 Host 临时配置、其他 Runtime continuation 与 External MCP 策略不发生语义变化；
- Settings Agent Runtime 目录不渲染 Cursor；其内部 identity、历史读取和平台未准入状态仍保留；
- async command/config advertisement 不列入当前 Kimi 遗留问题。

## References

- [Runtime Launch and Verification v22](runtime-launch-and-verification-v22.md)
- [Runtime Platform Admission v1](runtime-platform-admission-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Kimi Code Runtime Research](../research/kimi-code-runtime-research.md)
- [V1.27-D06](../versions/v1.27/decisions.md#v1-27-d06)
