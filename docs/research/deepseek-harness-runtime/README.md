---
title: "Rovai AI × DeepSeek Harness 运行时接入 Research Brief"
status: "pre-implementation"
reviewed_at: "2026-08-14"
target_repo: "murray17/rovai-ai"
upstream_repo: "deepseek-ai/deepseek-harness"
upstream_ref: "master"
upstream_version_observed: "0.1.0-rc.5"
target_adapter: "deepseek-harness"
---

# Rovai AI × DeepSeek Harness 运行时接入 Research Brief

> 本文研究对象是 DeepSeek AI 官方仓库 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)，不是其他同名的协议适配库、模型包装器或第三方 Coding TUI。
>
> 目标是明确：官方 DeepSeek Harness 能否作为 Rovai Runtime、应通过哪一层接入、哪些能力已经由上游代码证明、哪些行为必须实机验证，以及 Rovai 需要调整哪些运行时边界。

## 0. 使用方式

本文件是一份实现前 Research 与兼容性决策记录。建议依次执行：

1. 先阅读“推荐决策”“证据台账”和“兼容性门槛”。
2. 决定 Rovai 使用的 Harness 启动闭包：官方 ACP 示例二进制、Rovai 管理的 `dsh` Profile，或 Rovai 自有轻量 Launcher。
3. 在固定版本、固定依赖闭包上完成实机 Probe。
4. 先验证 ACP 基线、工具注入、审批证据和取消，再修改正式 AgentRun。
5. 只有在工具与审计链完整后，才把 Runtime 状态从 Experimental 提升为正式可用。

本次 Research 基于截至 **2026-08-14** 的官方仓库源码和 Rovai `main`。当前环境没有使用真实 DeepSeek API Key 对发布包完成端到端运行，因此：

- 上游源码明确声明的行为可作为实现依据；
- 发布安装、包闭包、实际模型请求、跨平台行为和 Rovai 工具注入仍需实机验证；
- DeepSeek Harness 当前处于 Developer Preview，上游明确提示会发生破坏性兼容变更。

---

# 1. 推荐决策

## 1.1 总体判断

**有条件可行。**

官方 DeepSeek Harness 已提供一个 Automation-only ACP Server：

```text
@deepseek-ai/dsh-acp
```

它通过 JSON-RPC stdio 暴露：

- `initialize`；
- `session/new`；
- `session/prompt`；
- `session/cancel`；
- committed assistant text；
- one-shot structured permission request。

这与 Rovai 当前 ACP Host 的基本传输方向一致，因此不需要新建第三套 Runtime Transport。

但它**不能直接视为与 Qoder/Qwen/CodeBuddy 等当前 ACP Adapter 等价**。官方 ACP Bridge 明确不支持：

- `session/new.mcpServers`；
- 非空 `additionalDirectories`；
- Session load / resume / list / delete / fork；
- Session 级模型和配置切换；
- 工具调用、推理、计划、进度和 usage 的 ACP 更新；
- 每个 Session 单独 close。

因此建议将第一版定义为：

```text
DeepSeek Harness Experimental Runtime
+ ACP v1 baseline
+ Rovai-managed process/profile composition
+ Rovai-controlled tool plane
```

而不是“发现一个 `dsh` 命令后直接标记 Ready”。

## 1.2 Adapter 身份

建议 Rust 枚举：

```rust
AdapterKind::DeepseekHarness
```

建议序列化名称：

```text
deepseek-harness
```

建议产品显示名：

```text
DeepSeek Harness（Preview）
```

建议主命令候选：

```text
dsh
```

建议环境变量覆盖：

```text
ROVAI_DEEPSEEK_HARNESS_BIN
```

不过，`dsh` 本身主要是 Profile Launcher；官方 `@deepseek-ai/dsh` 默认安装并不等于已经具备可运行的 ACP Profile。Runtime Probe 必须同时验证：

```text
可执行文件
+ 版本
+ ACP 运行闭包
+ Profile / config
+ 所需插件包
```

## 1.3 推荐启动形态

### POC 候选

官方发布包中存在：

```text
@deepseek-ai/dsh-acp-demo
bin: dsh-acp-demo
```

启动方式：

```bash
dsh-acp-demo --config /absolute/path/to/rovai.cordis.yml
```

它可以快速验证 ACP 协议和自定义 Cordis Composition，但包名和定位都是 `demo`，不建议直接作为长期生产合同。

### 正式候选

推荐由 Rovai 维护一个固定版本的 Harness 启动闭包：

```text
Rovai-managed DSH profile / launcher
├── DeepSeek LLM adapter
├── Agent spine / loop
├── ACP bridge
├── private session persistence or ephemeral session store
├── Rovai MCP client instances
├── sandbox / permission policy
└── minimal context composition
```

启动形态可选：

```bash
dsh --profile rovai-acp --patch /path/to/run-overlay.yml
```

或：

```bash
rovai-dsh-acp --config /path/to/run.cordis.yml
```

两者都应：

- 固定 npm package 版本；
- 固定 package-lock / integrity；
- 使用 Rovai 私有 `DSH_HOME`；
- 禁止运行时使用 `npx ...@latest`；
- 在启动前计算完整 Host Config Digest。

## 1.4 第一版保守策略

| 能力 | 第一版建议 |
|---|---|
| Product status | Experimental |
| Transport | ACP v1 over stdio |
| Public output | `ExplicitSendOnly` |
| Missing-send recovery | `Disabled` |
| Host warm reuse | 禁用；每个 AgentRun 使用独立 Host |
| Native Session recovery | 不支持；每次创建新 Session |
| Workspace | 仅主 `cwd` |
| Additional roots | 不支持 |
| Session MCP injection | 不支持；`session/new.mcpServers` 保持空数组 |
| Rovai tools | 通过 Harness 的 process-level MCP Client Plugin 注入 |
| Harness native mutating tools | 首版尽量不加载，避免绕过 Rovai 证据与审批 |
| Model | Host-frozen / Runtime Default；不伪装 Session 级切换 |
| Permission | `workspace-write`，禁止默认 `danger-full-access` |
| Skills | 首版不启用 Harness Native Skill |
| Subagents / workflows | 首版关闭，避免与 Rovai 多 Agent 模型重叠 |
| Compaction | 首版关闭或明确标记为不可观察 |
| Telemetry | 强制硬关闭 |
| User DSH config | 不读取、不修改用户现有 Profile 和凭据文件 |

## 1.5 推荐工具架构

DeepSeek Harness 官方 ACP Bridge 不接受 Session 传入的 MCP Server，但 Harness 自身提供：

```text
@deepseek-ai/dsh-mcp-client
```

它可以在 Cordis Profile 中连接 stdio 或 Streamable HTTP MCP Server，并将工具注册成：

```text
mcp__<serverName>__<toolName>
```

因此第一版建议：

```text
Rovai Core
  ├── AgentRun / Action / Approval / Evidence
  ├── Rovai Built-in Tool Server
  └── External MCP definitions
             │
             │ process-level MCP config
             ▼
Rovai-managed DeepSeek Harness Host
  ├── @deepseek-ai/dsh-mcp-client → Rovai tools
  ├── minimal Agent loop
  └── @deepseek-ai/dsh-acp
             │
             │ ACP v1 stdio
             ▼
Rovai ACP Host
```

为了保持“per-AgentRun additive tools”的语义，首版每个 AgentRun 使用一个独立 Harness Host。这样 process-level MCP 在效果上等价于 Run-scoped MCP，且不会泄漏到其他 AgentRun。

---

# 2. 证据台账

## 2.1 已确认

| 事实 | 证据等级 | 对实现的含义 |
|---|---|---|
| DeepSeek Harness 是 DeepSeek AI 官方开源 Agent Harness | 官方仓库 | 研究目标应锁定 `deepseek-ai/deepseek-harness` |
| 当前处于 Developer Preview，并明确会发生破坏性变更 | 官方 README | 只能先作为 Experimental Runtime，并锁定版本 |
| 官方 CLI 包为 `@deepseek-ai/dsh`，可执行名为 `dsh` | 官方 package manifest | Runtime Discovery 可从 `dsh` 开始，但不能止于此 |
| 当前源码观察版本为 `0.1.0-rc.5` | 官方 package manifest | Adapter 兼容性应按精确版本或版本范围冻结 |
| Node 要求为 `^22.19.0 || >=24.0.0` | 官方 root manifest | Probe 必须检查 Node Runtime Closure |
| Harness 使用 Profile + Cordis Patch 组合插件树 | 官方 CLI 文档 | Rovai 可以生成私有 Profile / Run Overlay |
| 官方 ACP 包为 `@deepseek-ai/dsh-acp` | 官方 package manifest | 可复用 Rovai ACP Transport |
| ACP Bridge 使用 JSON-RPC stdio，stdout 仅承载协议 | 官方源码与 README | 符合 Rovai Host 的协议卫生要求 |
| ACP 支持新 Session、文本 Prompt、Cancel 和 committed text | 官方 ACP README/source | 可实现最小 AgentRun |
| ACP Permission Request 提供 allow-once / reject-once | 官方 ACP source | 基础审批决策链可行 |
| ACP 一条 Connection 可拥有多个 Session | 官方 ACP README | 未来具备 Host 复用可能，但首版不启用 |
| ACP Bridge 拒绝非空 `mcpServers` | 官方 ACP source | 不能沿用 Rovai 当前 Session MCP 注入方式 |
| ACP Bridge 拒绝非空 `additionalDirectories` | 官方 ACP source | 首版只能使用主 Workspace |
| ACP Bridge 不支持 load/resume/list/delete/fork | 官方 ACP README | 不得宣称原生 Session 恢复 |
| ACP 只发送 committed assistant text，不发送 reasoning、tools、plans、usage | 官方 ACP README/source | Rovai 工具证据需要走另一条权威链 |
| Harness 提供 process-level MCP Client Plugin | 官方 MCP Client README | 可由 Rovai Profile 注入 Built-in / External MCP |
| MCP Client 支持 stdio 与 Streamable HTTP | 官方 MCP Client README | 可覆盖 Rovai 两类 MCP Transport |
| MCP Client 工具具备稳定 server-qualified 命名 | 官方 MCP Client README | 可构造可重复的 Tool Catalog Digest |
| `dsh` Profile 支持多个 `--patch` Overlay | 官方 CLI reference | 可为每个 Host 生成临时 Run 配置 |
| Provider Credential 默认由环境、私有 credentials/settings 解析 | 官方 CLI/Provider 文档 | Rovai 可通过私有 HOME + 环境注入避免污染用户配置 |
| 官方 ACP Demo 提供完整 coding-agent 示例 Composition | 官方 example | 可作为 Profile 起点，但不应原样投入 Rovai |

## 2.2 已确认的上游限制

### ACP 输入

支持：

- text；
- baseline `resource_link`，但会被展开成文本引用。

不支持：

- image；
- audio；
- embedded context；
- 非空 additional directories；
- 非空 Session MCP。

### ACP 输出

只输出：

- committed assistant text；
- Prompt stop reason；
- Permission Request。

不会输出：

- 原始流式 token；
- reasoning；
- Tool Call lifecycle；
- plan；
- title；
- usage；
- retry marker。

### Session

- 每个 `session/new` 创建一个 fresh Agent；
- 每个 Session 只允许一个 in-flight Prompt；
- Connection 关闭时统一释放其 Session；
- 没有 per-session close；
- 没有原生 load / resume。

## 2.3 有依据的工程推断

以下结论由上游合同和 Rovai 架构共同推导，仍需实机验证：

| 推断 | 理由 |
|---|---|
| 第一版应一 AgentRun 一 Host | MCP、模型、Profile 都是进程级；ACP 又无 per-session close |
| Rovai tools 应通过 DSH MCP Client 注入 | `session/new.mcpServers` 被明确拒绝 |
| 应创建私有 `DSH_HOME` | 避免读取用户全局 Profile、凭据、Patch、Telemetry 设置和插件 |
| 应禁用 Harness 原生 Subagent / Workflow | 它们会形成 Rovai 不可见的第二套 Agent 编排 |
| 应禁用或延后 Harness Native Skill | 防止与 Rovai Skill Projection 重复或冲突 |
| 应禁用原生 Compaction 或增加观察桥 | 否则 Context 变化不受 Rovai 证据链观察 |
| 应用一个固定 Host Config Digest | provider、model、permission、MCP、profile、package closure 都影响语义 |
| `dsh-acp-demo` 适合 POC，不适合直接成为长期产品合同 | 官方将其命名和定位为 demo composition |

## 2.4 必须实机确认

- 已发布 `@deepseek-ai/dsh` 与 ACP 相关包的实际安装闭包。
- `dsh` 或自有 Launcher 在 macOS / Windows / Linux 的真实可执行路径。
- `dsh --version` 输出和退出码。
- 官方发布包是否包含构建完整的 ACP 依赖族。
- 私有 Profile 中安装/解析 ACP、Agent Spine、Persistence、LLM、MCP Client 的方式。
- 使用 `--patch` 动态插入 MCP 实例时，是否在首个 Prompt 前完成 Tool Catalog 注册。
- `session/cancel` 是否停止模型、MCP 调用、子进程和等待审批。
- Permission Request 是否只包含 ID，还是实际运行时会携带更多 Tool Metadata。
- Rovai Built-in Tool 调用是否能稳定关联到 AgentRun / Delivery / Action。
- 不加载 Harness Native Bash/FS 时，Agent 是否仍可完全通过 Rovai 工具工作。
- `workspace-write` 是否与 Rovai Worktree / Shared Workspace 语义一致。
- Provider Credential 缺失、错误或过期时的 JSON-RPC / stderr 诊断。
- Profile / Session JSONL 是否包含敏感数据，以及清理策略。
- SIGTERM、stdin EOF、进程崩溃和超时的资源释放。
- Developer Preview 升级后的协议兼容性。

---

# 3. 上游资料索引

## 3.1 官方项目与版本

- 官方仓库：  
  <https://github.com/deepseek-ai/deepseek-harness>
- Root README：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md>
- Root package manifest：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json>
- CLI package：  
  <https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/cli>
- CLI behavior reference：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md>

## 3.2 ACP

- ACP group overview：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/README.md>
- ACP server contract：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md>
- ACP implementation：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/src/index.ts>
- ACP package manifest：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/package.json>
- ACP demo composition：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/examples/acp-agent/cordis.yml>
- ACP demo executable：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/examples/acp-demo/src/bin.ts>

## 3.3 MCP 与工具

- MCP Client Plugin：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md>
- 官方 ACP Agent Example：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/examples/acp-agent/README.md>

## 3.4 Provider、模型和凭据

- Model / Provider 配置：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md>
- Python SDK（仅用于评估替代接入路径）：  
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/python-sdk.md>

## 3.5 ACP 官方协议

- 文档索引：  
  <https://agentclientprotocol.com/llms.txt>
- Initialization：  
  <https://agentclientprotocol.com/protocol/v1/initialization>
- Session Setup：  
  <https://agentclientprotocol.com/protocol/v1/session-setup>
- Prompt Turn：  
  <https://agentclientprotocol.com/protocol/v1/prompt-turn>
- Tool Calls：  
  <https://agentclientprotocol.com/protocol/v1/tool-calls>
- Cancellation：  
  <https://agentclientprotocol.com/protocol/v1/cancellation>

Rovai 当前使用 ACP v1。本次不要顺手迁移到 Draft v2。

## 3.6 同名项目边界

以下项目不是本文目标：

- `HenryZ838978/deepseek-harness`：DeepSeek V4 协议包装库 / CLI / MCP Server；
- 其他名为 `deepseek-harness` 的 Coding TUI 或实验项目。

它们可以作为模型协议或工具包装参考，但不能替代官方 Harness Runtime 的 Session、Agent Loop、工具和 ACP 合同。

---

# 4. 实机 Probe 包

建议建立：

```text
docs/research/deepseek-harness-runtime/probe/
├── environment.md
├── package-closure.txt
├── version.txt
├── cli-help.txt
├── profile-dump.yml
├── generated-run-config.yml
├── initialize.json
├── session-new.json
├── prompt-transcript.jsonl
├── builtin-tool-transcript.jsonl
├── external-mcp-transcript.jsonl
├── permission-allow-transcript.jsonl
├── permission-deny-transcript.jsonl
├── cancel-transcript.jsonl
├── multi-host-isolation.jsonl
├── shutdown-transcript.txt
└── findings.md
```

## 4.1 安装与闭包

记录：

```bash
node --version
npm --version
command -v dsh
dsh --version
dsh --help
npm ls -g @deepseek-ai/dsh
```

若使用 ACP Demo POC：

```bash
command -v dsh-acp-demo
npm ls -g @deepseek-ai/dsh-acp-demo
```

若使用 Rovai Profile：

```bash
dsh --profile rovai-acp --dump-default-config
dsh --profile rovai-acp --patch ./probe-overlay.yml --dump-config
```

必须保存：

- Node 版本；
- npm/pnpm package 版本；
- package integrity / lockfile；
- `dsh` 真实路径；
- ACP Package 是否实际可解析；
- Profile 所加载的完整 Bundle / Plugin 列表；
- 生成配置的 Digest。

不要把下面这种命令作为生产启动方式：

```bash
npx -y @deepseek-ai/dsh@latest ...
```

它会让 Runtime 版本和依赖闭包在每次运行时变化。

## 4.2 私有运行环境

Probe 应使用隔离目录：

```text
<temp>/dsh-home/
<temp>/profile/
<temp>/sessions/
<temp>/workspace/
<temp>/mcp/
```

启动时至少设置：

```bash
DSH_HOME=<temp>/dsh-home
DSH_TELEMETRY_DISABLED=1
DSH_PERMISSION_MODE=workspace-write
```

并验证：

- 不读取用户 `$DSH_HOME`；
- 不读取用户 Profile Patch；
- 不修改用户 `.credentials.yaml` / `settings.yaml`；
- 不连接用户已有 MCP；
- 不加载用户 Native Skill；
- Session Log 只写入 Rovai 私有目录。

## 4.3 ACP 基线

发送 Rovai 当前形态的初始化：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": {
        "readTextFile": true,
        "writeTextFile": true
      },
      "terminal": false
    },
    "clientInfo": {
      "name": "rovai_probe",
      "title": "Rovai AI Runtime Probe",
      "version": "probe"
    }
  }
}
```

随后执行：

```text
session/new（absolute cwd，mcpServers=[]）
session/prompt（普通文本）
session/prompt（第二轮文本）
session/cancel
```

同时做负向测试：

```text
session/new + non-empty mcpServers          → 应明确拒绝
session/new + additionalDirectories        → 应明确拒绝
session/prompt + image/audio                → 应明确拒绝
同 Session 并发两个 Prompt                 → 应明确拒绝
unknown session cancel                     → 应安全 no-op
```

## 4.4 Rovai Tool Plane Probe

启动配置中插入一个 Process-level MCP Client：

```yaml
- id: mcp-rovai-probe
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: rovai
    transport: stdio
    command: /absolute/path/to/rovai-probe-mcp
    args: []
    failOnStartupError: true
```

测试 MCP 先只暴露：

```text
rovai_probe_echo
rovai_probe_read_file
rovai_probe_write_file
rovai_probe_send_camp_message
```

要求验证：

1. Tool Catalog 在首个 Prompt 前可用。
2. 模型可以调用 `mcp__rovai__rovai_probe_echo`。
3. 写操作必须经过 Rovai 权威 Action / Approval 链。
4. `send_camp_message` 只执行一次并关联当前 AgentRun。
5. 下一 AgentRun 使用新 Host，不继承上一个工具实例和状态。
6. MCP 子进程在 Host 退出时被终止。
7. MCP stderr 不污染 ACP stdout。

## 4.5 Native Tool 与证据 Probe

官方 ACP Bridge 不发送 Tool Call lifecycle，因此必须分别测试两种 Composition：

### A. 只使用 Rovai 工具

不加载 Harness Native Bash / FS / Subagent / Workflow。所有操作都经过 Rovai MCP。

这是首选路径。

### B. 保留 Harness Native Tool

触发 Bash / FS 写入和权限升级，观察：

- Permission Request 是否只有 `toolCallId`；
- 是否存在可用于 Action Summary 的名称、输入和位置；
- Rovai 是否能产生完整 Canonical Action Input；
- Tool Result 是否能进入 Rovai Evidence。

若只能得到 opaque ID，且没有另一条结构化证据来源，则 Native Mutating Tool 必须在正式集成中关闭。

## 4.6 Approval Probe

至少覆盖：

```text
allow_once
reject_once
client response cancelled
client disconnected while waiting
cancel session while waiting
same toolCallId duplicate request
unknown toolCallId
```

通过标准不仅是“模型继续/停止”，还包括：

- 用户看到可理解的动作摘要；
- 输入、路径、命令或工具名称可审计；
- Decision 与 Tool Call 稳定关联；
- 拒绝后不得执行；
- 允许只生效一次；
- 失败关闭而不是默认允许。

## 4.7 Model 与凭据 Probe

第一版建议固定 Provider / Model 到 Host Config。验证：

```text
DEEPSEEK_API_KEY 缺失
DEEPSEEK_API_KEY 错误
base URL 错误
model 不存在
rate limit
provider 5xx
请求超时
```

要求映射成：

```text
authentication_required
runtime_model_unavailable
probe_failed
transient
incompatible
```

不能仅因为 ACP `initialize` 成功就判定已登录；官方 ACP Server 的 `authMethods` 为空，模型凭据由 Host 进程配置。

## 4.8 Cancel 与 Shutdown Probe

分别在以下阶段 Cancel：

- 模型思考中；
- MCP Tool 执行中；
- 等待 Permission；
- committed assistant message 已产生但 Prompt 尚未 settle；
- 多 Session Host 中另一个 Session 正在运行。

然后测试：

```text
SIGTERM
SIGINT
stdin EOF
parent process crash
MCP child crash
Harness process crash
```

要求：

- Cancel 只影响目标 Session / Host；
- 不产生虚假 completed；
- 不留下 MCP / shell / worker 子进程；
- Pending Prompt 明确 settle 为 cancelled 或 failed；
- Session Log 完成 flush 或明确标记不完整。

## 4.9 脱敏规则

不得提交：

- API Key、Bearer Token、Cookie；
- 用户 `$DSH_HOME` 内容；
- 私有 MCP URL 和环境变量；
- 本机用户名和真实 HOME；
- 私有仓库正文；
- Session JSONL 中的敏感 Prompt / Tool Result。

可以保留：

- 方法名、Capability；
- ID 的一致性关系；
- 状态和错误类别；
- 经过替换的路径；
- 配置 Digest；
- 经过脱敏的 Tool Schema。

---

# 5. 兼容性门槛

## 5.1 协议层必须通过

| 门槛 | 通过标准 |
|---|---|
| 协议卫生 | stdout 只含合法逐行 ACP JSON-RPC |
| ACP v1 | `initialize` 返回受支持版本 |
| Session | `session/new` 返回稳定 Session ID |
| Prompt | 有明确成功、取消或失败终态 |
| Cancel | 能停止目标工作，不只是关闭展示 |
| Process ownership | Host、MCP、子进程在退出时完整清理 |
| Workspace | 主 `cwd` 正确绑定，不越界 |
| Error classification | 鉴权、模型、协议和临时错误可区分 |

## 5.2 Rovai 产品层必须通过

| 门槛 | 通过标准 |
|---|---|
| Team tools | Harness 能调用 Rovai Built-in Tools |
| Public send | `camp.message.send` 可稳定执行且不重复 |
| Tool evidence | Tool Name、Input、Result 和 Run 可关联 |
| Approval evidence | 用户看到可理解动作，不是 opaque ID |
| Explicit output | Runtime final 不绕过 Rovai 公共消息合同 |
| Isolation | MCP、模型、上下文、Session、cwd 不跨 Run 泄漏 |
| Context ownership | Harness 不偷偷叠加与 Rovai 冲突的 Persona / Skill / Subagent 指令 |
| Security | 默认 workspace-write，Telemetry 强制关闭 |

以下任一情况都是正式接入 Blocker：

- 无法通过 Process-level MCP 注入 Rovai Built-in Tools；
- Native Tool 绕过 Rovai Action / Evidence，且无法关闭；
- Permission Request 只能展示 opaque ID；
- 取消无法停止 MCP 或子进程；
- Profile 会读取/修改用户全局 Harness 配置；
- Session Log 或 Telemetry 不受 Rovai 控制；
- Runtime final 与 accepted `camp.message.send` 无法去重；
- 版本升级无法冻结或兼容检查。

## 5.3 可接受的第一版降级

| 能力 | 第一版状态 |
|---|---|
| Native Session load/resume | unsupported |
| Session MCP | unsupported；改用 Process-level Profile MCP |
| Additional workspace roots | unsupported |
| Image / audio prompt | unsupported |
| Session model switching | unsupported；Host-frozen |
| Live reasoning / plan / usage | unsupported |
| Tool activity via ACP | unsupported；由 Rovai Tool Plane 记录 |
| Host reuse | deferred |
| Missing-send recovery | deferred |
| Native Skill | deferred |
| Native Subagent / Workflow | disabled |
| Native Compaction observation | deferred |

## 5.4 不能静默降级

- ACP MCP 不支持时改为读取用户全局 MCP。
- Permission 元数据不足时显示“未知操作”并默认允许。
- 模型不可用时自动换模型。
- Workspace-write 失败时自动切换 danger-full-access。
- Session resume 不支持时伪装成原生继续。
- Process-level MCP 启动失败时继续启动无工具 Agent。
- Runtime final 存在但 `camp.message.send` 缺失时自动发布，除非单独启用了经过验证的 Recovery。
- Upstream Version 变化后继续复用旧 Capability Snapshot。

---

# 6. Rovai 代码地图

## 6.1 P0：一定要阅读，基本一定会修改

| 文件 / 模块 | 关注内容 |
|---|---|
| `packages/contracts/src/index.ts` | TS `AdapterKind`、Catalog、Capability、模型和权限合同 |
| `crates/rovai-core/src/agent_profile.rs` | Rust `AdapterKind`、wire value、display name、command、`uses_acp`、输出和 Recovery Policy |
| `crates/rovai-core/src/agent_runtime_adapter.rs` | Adapter Policy、Skill/MCP Projection、Capability Snapshot、Host Config Digest |
| `crates/rovai-core/src/runtime_discovery.rs` | `dsh` / launcher 的 PATH、Login Shell、Known Location、版本和指纹 |
| `crates/rovai-core/src/health.rs` | ACP Probe、Profile Probe、Credential/Model/Error 分类 |
| `crates/rovai-core/src/acp.rs` | ACP Host、Session、Prompt、Permission、Cancel、退出 |
| `crates/rovai-core/src/runtime_mcp.rs` | Process-level MCP 配置生成和私有 Profile / Patch |
| `crates/rovai-core/src/builtin_tool_runtime.rs` | Rovai Built-in Tool Server 的启动和环境注入 |
| `crates/rovai-core/src/action.rs` | Permission / Tool Call 到 Action / Approval 的映射 |
| `crates/rovai-core/src/runtime_fleet.rs` | 首版 Host retire、未来兼容键复用 |
| `crates/rovai-core/src/runtime_resolution.rs` | Package/Profile/Model/MCP/Permission 的冻结配置 |
| `crates/rovai-core/src/context_contract.rs` | 避免 Harness Persona/Skill 与 Rovai Context 重复 |
| DB migrations / fixtures | Adapter 字符串、安装、Snapshot 和旧数据兼容 |

建议先运行：

```bash
rg "AdapterKind" crates packages apps
rg "uses_acp|acp_required_capabilities|configure_acp_command" crates
rg "McpProjectionCapability|ExternalMcpProjection" crates
rg "PublicOutputMode|MissingSendRecoveryMode" crates
rg "RuntimeCompatibilityKey|FleetReleaseDisposition" crates
rg "builtin_tool|camp.message.send" crates
rg "ObservedToolMetadata|request_permission|toolCallId" crates
```

## 6.2 P1：Probe 结果决定是否修改

| 模块 | 触发条件 |
|---|---|
| `runtime_activity_mapping.rs` | 需要映射 committed-only ACP 更新 |
| `builtin_tool_evidence_projection.rs` | Rovai MCP Tool 返回需新增 Evidence 映射 |
| `mcp_projection.rs` | 增加 Process/Profile-scoped MCP Delivery 机制 |
| `skill_projection.rs` | 未来接 Harness Native Skill |
| `compaction.rs` | 未来观察 Harness Compaction |
| `planned_shutdown.rs` | Harness/MCP/Session 子进程清理有特殊顺序 |
| `execution_evidence.rs` | 需要记录 Profile Digest、Harness Session Log 证据 |
| `context.rs` / `context_delivery.rs` | Harness Composition 需要特殊 Native Binding |
| `runtime_basis.rs` | Profile / Package Closure 成为 Runtime Basis 的一部分 |
| `diagnostics.rs` | Package closure、Profile、Credential 和 tool-plane 诊断 |

## 6.3 P2：Core 兼容后再处理

```text
RuntimeInstallationsPanel
MembersView
DiagnosticsCenter
App.tsx
Contract fixtures
Renderer tests
Core integration tests
Runtime documentation
Upgrade compatibility UI
```

UI 不需要新增 Harness 专属工作台。复用现有 Runtime 安装、成员配置、诊断和模型入口；只展示真实受支持能力。

---

# 7. Rovai 当前实现中需要特别警惕的点

## 7.1 当前 ACP Required Capabilities 过于统一

Rovai 当前通用 ACP Probe 把以下能力视为标准路径的一部分：

```text
session.new
session.prompt
session.cancel
session.update
structured_permission_request
workspace.additional_roots
mcp.additive_per_run
session.set_config_option / session.set_model
```

DeepSeek Harness 官方 Bridge 只满足其中一部分。

不要为了让它通过 Probe 而伪造这些 Capability。建议把 ACP 能力拆成适配器轴：

```text
Session lifecycle
Workspace roots
MCP delivery mechanism
Model configuration scope
Permission metadata quality
Activity evidence level
Native recovery level
```

## 7.2 `session/new` 成功不能推断完整能力

当前 Rovai 的 `acp_observed_capabilities` 对成熟 Adapter 有一些推断逻辑。DeepSeek Harness 必须使用 Behavioral Probe：

- Cancel 要真的执行；
- Permission 要真的触发；
- Tool evidence 要真的可关联；
- Model/config 方法要真的存在；
- MCP 要通过 Profile 实际调用。

## 7.3 MCP 是 Process Scope，不是 Session Scope

官方 ACP Bridge 明确拒绝非空 `mcpServers`。Rovai 需要新增或复用一种明确的 Delivery Mechanism：

```text
ProcessProfileAdditivePerRun
```

不能把 DeepSeek Harness 加入现有 “ACP Session MCP 已验证” 白名单。

建议 Capability 同时记录：

```text
semantic scope: per AgentRun
mechanism: process profile
host reuse: false
```

## 7.4 Tool Activity 不在 ACP Wire 上

官方 Bridge 刻意只发送 committed assistant text。Native Tool Activity 留在 Harness Session Log 中。

这会导致：

- Rovai Timeline 看不到工具进度；
- Action 可能没有输入和结果；
- Permission Request 可能只有 Tool Call ID；
- 无法满足 Evidence-first 体验。

首选修复是：

```text
不加载 Harness Native Mutating Tools
→ 只加载 Rovai MCP Tools
→ Rovai Tool Server 成为 Action/Evidence 权威
```

若必须使用 Harness Native Tool，则需要上游 Bridge 扩展或 Rovai Companion Plugin 发出结构化 Tool Updates。

## 7.5 Context 可能重复

官方 `dsh` Profile 可以加载：

- Persona；
- AGENTS.md / CLAUDE.md；
- Skills；
- time context；
- plan mode；
- subagent instructions。

Rovai 已有自己的身份、职责、Context Contract、Skill 和 Team Tool 指令。首版 Profile 应只保留最小 Agent Loop，避免模型同时接收两套权威指令。

## 7.6 Native Subagent 与 Rovai 多 Agent 冲突

官方 ACP Demo 默认 Composition 包含：

- in-process subagent；
- fork；
- background continuable children；
- workflow；
- Ralph；
- todo。

这些能力会在一个 Rovai Agent 内再启动一套不可见团队。首版必须关闭。

## 7.7 Compaction 不可观察

官方示例可以启用 Harness Compaction，但 ACP 不报告 Compaction 事件。首版建议关闭；否则 Rovai 无法证明 Context 何时、如何被压缩。

## 7.8 Session Persistence 重复

Harness 可把 Session 写成 JSONL；Rovai 自己也持久化 AgentRun、Conversation、Action 和 Evidence。

首版应：

- 使用私有 Session Root；
- 明确 JSONL 仅是 Runtime 内部状态；
- 不把它当 Rovai 权威记录；
- 设置保留与清理策略；
- 禁止用户全局 Session 混入。

## 7.9 ACP Auth 不代表模型已鉴权

官方 ACP `initialize` 返回空 `authMethods`，因为凭据由 Harness Host 配置。Rovai Probe 必须执行一个最小模型请求，才能判定：

```text
ready
vs authentication_required
vs model unavailable
```

## 7.10 Preview Version 不能宽松匹配

上游明确会发生 breaking changes。首版建议：

- 精确锁定 `0.1.0-rc.5` 或实际验证版本；
- Package Closure 进入 Compatibility Digest；
- 版本变化后强制重新 Probe；
- 不自动沿用旧 Snapshot；
- UI 标记 Preview / Experimental。

## 7.11 Warm Host Reuse 暂时不安全

虽然一个 ACP Connection 支持多 Session，但：

- MCP 是进程级；
- Provider / Model 是 Host 级；
- 没有 per-session close；
- Profile 可能包含共享插件状态；
- Connection 关闭会统一释放 Session。

首版应每 Run 退役 Host。未来只有在相同 Compatibility Key、多 Session 隔离和资源上限测试通过后才复用。

---

# 8. 接入路径与参考实现

## 8.1 路径 A：Rovai-managed ACP Profile（推荐）

```text
dsh --profile rovai-acp --patch <run-overlay>
```

优点：

- 使用官方 Product Launcher；
- Profile / Bundle / Patch 有明确优先级；
- 可通过私有 `DSH_HOME` 隔离；
- 可插入 Process-level MCP Client；
- 可输出完整 Config Dump 和 Digest。

风险：

- 需要维护 Profile Package Closure；
- 官方默认 `dsh` 安装不一定包含 ACP Plugin；
- Preview 期间 Bundle/Config 可能变化。

## 8.2 路径 B：`dsh-acp-demo --config`（适合 POC）

优点：

- 官方提供现成 stdio bin；
- 自定义 Cordis YAML；
- stdout 协议纯净；
- 快速完成兼容性验证。

风险：

- 上游定位为 Demo；
- 官方可能不承诺长期 CLI 合同；
- 示例 Composition 过重，包含大量 Rovai 不应启用的工具和子 Agent。

## 8.3 路径 C：Rovai 自有轻量 Launcher（长期备选）

创建一个固定依赖的 Node Package：

```text
rovai-dsh-acp
```

只组合：

- DeepSeek Adapter；
- Agent Loop / Session；
- ACP Bridge；
- Rovai MCP Client；
- 最小 Persistence；
- Sandbox Policy。

优点是合同最清楚；缺点是需要跟随上游 Preview API。

## 8.4 路径 D：Python SDK（不作为首选 Runtime Transport）

官方 Python SDK 可以启动 Bundled Runtime、持续 Session 和 Bash 状态，但 Rovai 若采用它，需要新增：

- Python 运行时依赖；
- Python JSON-RPC Bridge；
- 自定义 Session / Approval / Cancel 协议；
- 跨平台打包；
- 两套 Runtime Host。

已有 ACP 路径更符合 Rovai 当前架构，因此 Python SDK 只作为行为参考和故障诊断工具。

## 8.5 路径 E：Headless CLI（不适合作为正式 Runtime）

```bash
dsh --profile headless "task"
```

它适合一次性脚本，但只打印最终文本，不提供 Rovai 所需的持续 Session、结构化审批、工具证据和精细取消合同。

## 8.6 Rovai 内部参考 Adapter

主参考：

```text
QoderCli
QwenCode
CodebuddyCli
OpenCodeCli
```

原因：共享 ACP Host、Session、Permission 和 Runtime Fleet。

隔离/Profile 参考：

```text
KiroCli
AntigravityApp
```

原因：私有配置目录、Host 配置和 Runtime-specific Setup。

不要把 Codex App Server 或 Claude print-mode 作为 Transport 主模板。

---

# 9. 推荐实现顺序

## Phase 0：冻结目标与版本

- 确认目标为官方 `deepseek-ai/deepseek-harness`。
- 固定验证版本和 Node 版本。
- 选择启动路径 A / B / C。
- 生成完整 Package Closure 与 Config Dump。
- 明确是否能够安装官方 ACP Package。

此阶段输出：

```text
runtime closure manifest
launch command
version policy
private DSH_HOME layout
```

## Phase 1：Catalog 与 Discovery

- Rust / TS 增加 `DeepseekHarness`。
- wire value：`deepseek-harness`。
- display：`DeepSeek Harness（Preview）`。
- command candidate：`dsh` 或 Rovai Launcher。
- 环境覆盖：`ROVAI_DEEPSEEK_HARNESS_BIN`。
- 记录 Node / Harness / ACP Package 版本和指纹。
- 增加 DB / Fixture / Exhaustive Match 测试。

此阶段不得把 Runtime 标记为 Ready。

## Phase 2：Baseline ACP Probe

- 启动私有 Profile / Launcher。
- 验证 initialize、fresh Session、Prompt、Cancel、stdout hygiene。
- 明确记录上游已知 Unsupported Capability。
- 增加 Credential / Model Probe。
- 取消当前通用 Probe 对 additional roots、Session MCP、set_config_option 的错误推断。

## Phase 3：Rovai Tool Plane

- 为每 Run 生成 MCP Client Config。
- 启动 Rovai Built-in Tool Server。
- 注入 Team Tool、Camp Send、FS/Shell 等工具。
- 验证 Tool Catalog Digest。
- 关闭 Harness Native Mutating Tools、Subagent、Workflow 和 Skill。
- 验证 `camp.message.send`。

如果此阶段失败，停止正式接入。

## Phase 4：最小 AgentRun

仅支持：

```text
primary cwd
host-frozen model
workspace-write
fresh Session
one AgentRun per Host
ExplicitSendOnly
no missing-send recovery
```

验证：

- 普通回答；
- 文件读取；
- 文件修改；
- Shell；
- Camp Message Send；
- 用户拒绝；
- Cancel；
- 进程崩溃。

## Phase 5：Action / Evidence 完整性

- 所有 Rovai Tool Call 形成 Action / Evidence。
- Approval 展示名称、摘要、输入和路径。
- 禁止 opaque Native Tool。
- Runtime final 只作为 Evidence。
- accepted Camp Send 与 final 去重。

## Phase 6：产品化

- Runtime Installation 显示 Preview。
- Diagnostics 显示 Node、Profile、Package、Credential 和 Tool Plane 状态。
- 成员可选择该 Runtime。
- 只展示真实可选 Model。
- 修复文案不暴露内部 JSON-RPC。
- 文档说明首版 Unsupported Capability。

## Phase 7：独立解锁可选能力

按顺序单独验证：

1. Host reuse；
2. Missing-send recovery；
3. Native Skill；
4. Compaction observation；
5. Session recovery；
6. Image input；
7. Additional roots；
8. 更完整 ACP Tool Update。

不要把它们合并成一次“大适配”。

---

# 10. 验收测试矩阵

## 10.1 Installation / Discovery

- `dsh` 在 inherited PATH。
- 只在 Login Shell PATH。
- Rovai 环境变量覆盖。
- Node 缺失或版本不满足。
- Harness Package 缺失。
- ACP Package 缺失。
- Profile 缺失或 Plugin Resolve 失败。
- Package Integrity 变化。
- Preview Version 超出验证范围。
- Config Dump 与预期 Digest 不一致。

## 10.2 ACP 生命周期

- initialize 成功。
- protocol version 不匹配。
- session/new absolute cwd。
- relative cwd 被拒绝。
- non-empty MCP 被拒绝。
- additional roots 被拒绝。
- Prompt 正常完成。
- Prompt 模型失败。
- 同 Session 并发 Prompt 被拒绝。
- Cancel 在不同阶段生效。
- Unknown Session Cancel 安全 no-op。
- Connection 关闭释放全部 Session。

## 10.3 Tool Plane

- Process-level MCP 在首个 Prompt 前 Ready。
- stdio MCP。
- Streamable HTTP MCP。
- MCP Tool Schema 稳定。
- 同名 Server 拒绝。
- Tool List Change 正确更新。
- MCP Crash 自动恢复或明确失败。
- `failOnStartupError=true` 时启动失败阻止 Runtime Ready。
- 下一 Run 不继承 Tool / Connection。
- `camp.message.send` exactly once。

## 10.4 Approval / Evidence

- 读操作不错误升级。
- 写文件产生可理解 Approval。
- Shell 产生可理解 Approval。
- allow once 只执行一次。
- reject once 不执行。
- cancelled 失败关闭。
- Tool Call ID 稳定。
- Input / Result / Path 可审计。
- 重复事件不创建重复 Action。
- Opaque Native Tool 被禁用或阻断。

## 10.5 Workspace / Security

- workspace-write 不越过 cwd。
- 临时目录策略明确。
- danger-full-access 不可作为默认。
- 用户 DSH_HOME 不被读取。
- 用户 Profile 不被修改。
- Telemetry 强制关闭。
- Session JSONL 写入私有目录。
- MCP 环境变量经过最小化和脱敏。
- Host 退出后无孤儿进程。

## 10.6 Model / Credential

- DeepSeek Key 缺失。
- Key 错误。
- Provider 401 / 403。
- Rate limit。
- Model 不存在。
- Base URL 错误。
- Host-frozen Model 进入 Compatibility Digest。
- 不支持 Session switch 时 UI 不展示切换。

## 10.7 Context / Composition

- 不重复加载 AGENTS.md / CLAUDE.md。
- 不加载 Harness Native Skill。
- 不加载 Native Subagent / Workflow。
- 不加载冲突 Persona。
- Rovai Context Contract 正确进入模型输入。
- Tool Prompt 只来自启用工具。
- Compaction 首版关闭。

## 10.8 Output / Recovery

- Runtime final 不直接发布 Camp Message。
- accepted `camp.message.send` 是公共输出权威。
- Missing-send recovery 默认关闭。
- final 唯一性验证前不启用 recovery。
- Process Crash 不标记 completed。
- Cancel 不产生虚假 final。
- Session 不支持 resume 时明确建立新 Session。

## 10.9 Upgrade

- 同版本、同 Closure 可复用 Snapshot。
- Package 版本变化强制 Probe。
- ACP Package 变化强制 Probe。
- Profile Digest 变化强制 Probe。
- 旧 Installation 不静默升级。
- 不兼容版本显示明确 blocker。

---

# 11. 实施任务说明（可直接复制）

```text
任务：
在 Rovai AI 中新增 DeepSeek Harness Experimental Runtime Adapter。

目标上游：
- Repository: deepseek-ai/deepseek-harness
- Product CLI: @deepseek-ai/dsh / dsh
- ACP package: @deepseek-ai/dsh-acp
- Observed upstream version: 0.1.0-rc.5
- Protocol: ACP v1 over stdio

目标 Adapter：
- Rust: AdapterKind::DeepseekHarness
- Wire value: deepseek-harness
- Display name: DeepSeek Harness（Preview）
- Executable candidate: dsh or a Rovai-managed launcher
- Env override: ROVAI_DEEPSEEK_HARNESS_BIN

关键判断：
官方 DeepSeek Harness 可以通过 ACP 提供 fresh session、text prompt、committed assistant text、cancel 和 one-shot permission，但 stock ACP bridge 不支持 session MCP、additional directories、session resume/load、session model config，也不会发送 tool/reasoning/plan/usage updates。

架构约束：
1. 复用 Rovai 当前 ACP Host，不新增专用消息传输。
2. 不使用 dsh web 或 headless 作为正式 Runtime Transport。
3. 不把其他同名 deepseek-harness 项目作为目标。
4. Runtime 必须使用 Rovai 私有 DSH_HOME、Profile、Session Root 和临时配置。
5. 固定 Harness / ACP / Node package 版本和完整依赖闭包；运行时禁止 latest。
6. PublicOutputMode 保持 ExplicitSendOnly。
7. MissingSendRecoveryMode 第一版设为 Disabled。
8. 第一版一 AgentRun 一 Host，禁止 warm reuse。
9. session/new.mcpServers 必须为空；Rovai Tools 通过 @deepseek-ai/dsh-mcp-client 在 Process Profile 中注入。
10. 首版尽量不加载 Harness Native Bash/FS/Subagent/Workflow/Skill/Compaction；所有写操作优先经过 Rovai Tool Plane。
11. 默认权限为 workspace-write，禁止静默切换 danger-full-access。
12. 强制 DSH_TELEMETRY_DISABLED。
13. 不读取或修改用户现有 Harness Profile、settings、credentials 和 MCP。
14. 不宣称 session load/resume、additional roots、image、session model switching 或 live tool updates 已支持。

开始实现前：
1. 选择并记录启动闭包：Rovai-managed dsh profile、Rovai launcher 或 dsh-acp-demo POC。
2. 生成 package closure manifest、profile dump 和 config digest。
3. 完成 initialize、session/new、prompt、cancel、credential、tool-plane 和 approval transcript。
4. 验证 Rovai Built-in MCP Tools 能被模型调用。
5. 验证 camp.message.send exactly once。
6. 验证所有写操作拥有可理解的 Action / Approval / Evidence。
7. 若 Native Tool 只能提供 opaque toolCallId，关闭 Native Tool 或停止正式接入。

实现顺序：
A. 扩展 Rust/TS AdapterKind、Catalog、wire value、display name、Discovery、DB/fixtures。
B. 增加 Harness package/profile closure probe，不仅检查 dsh --version。
C. 增加 adapter-specific ACP requirement profile；不要伪造 MCP、additional roots 或 config capability。
D. 生成私有 Profile / Run overlay，并通过 DSH MCP Client 注入 Rovai Built-in Tools。
E. 接入最小 AgentRun：fresh session、primary cwd、host-frozen model、workspace-write、one host per run。
F. 完成 Approval / Cancel / Evidence / Process cleanup。
G. 最后更新 Runtime UI、Diagnostics、文档和集成测试。

重点文件：
- packages/contracts/src/index.ts
- crates/rovai-core/src/agent_profile.rs
- crates/rovai-core/src/agent_runtime_adapter.rs
- crates/rovai-core/src/runtime_discovery.rs
- crates/rovai-core/src/health.rs
- crates/rovai-core/src/acp.rs
- crates/rovai-core/src/runtime_mcp.rs
- crates/rovai-core/src/builtin_tool_runtime.rs
- crates/rovai-core/src/action.rs
- crates/rovai-core/src/runtime_resolution.rs
- crates/rovai-core/src/runtime_fleet.rs
- crates/rovai-core/src/context_contract.rs
- crates/rovai-core/src/diagnostics.rs
- DB migrations、contract fixtures、Core/Renderer tests

主要参考 Adapter：
- QoderCli
- QwenCode
- CodebuddyCli
- OpenCodeCli
隔离与私有配置参考：
- KiroCli
- AntigravityApp

需要主动修正的现有假设：
- session/new 成功不能推断 cancel、permission、MCP、additional roots 或 config option 已验证。
- DeepSeek Harness 不得加入 ACP Session MCP 白名单。
- MCP semantic scope 可以是 per AgentRun，但 delivery mechanism 是 process profile。
- ACP initialize 成功不代表模型凭据可用。
- committed assistant text 不等于 Rovai 公共消息。

Blocker：
- 无法构造稳定、固定版本的 ACP 运行闭包；
- 无法通过 Process Profile 注入 Rovai Built-in Tools；
- camp.message.send 不可用或可能重复；
- Native mutating tools 绕过 Rovai Evidence；
- Approval 只有 opaque ID；
- Cancel 无法停止模型、工具或 MCP；
- Profile 读取/污染用户全局配置；
- stdout 不是纯 ACP JSON-RPC；
- 子进程或 Session 无法清理；
- Preview 升级无法触发重新 Probe。

交付物：
1. Experimental Adapter 的最小、安全实现。
2. Package/Profile Closure Probe 与 Capability Snapshot 测试。
3. Rovai Tool Plane 注入、Approval、Cancel 和 Evidence 测试。
4. Discovery、DB、Contracts、UI Catalog 和 Diagnostics 回归测试。
5. 一份 verified / unsupported / deferred / blocked 兼容性表。
6. 不得声称未实测能力已受支持。

验证：
- 运行仓库既有格式化、TypeScript 类型检查、Rust/TS 单测和相关集成测试。
- 增加至少：缺少 Node、缺少 Package、Profile 错误、Credential 缺失、普通 Prompt、Tool Call、Permission allow/deny、Cancel、MCP 启动失败、Host 清理、进程崩溃和跨 Run 隔离测试。
- 最终总结列出实际运行命令、通过结果、尚未完成的实机验证，以及 Runtime 是否仍保持 Experimental。
```

---

# 12. 建议交付边界

第一份变更：

```text
AdapterKind + Catalog + Discovery + Package/Profile Closure Probe + Diagnostics
```

第二份变更：

```text
Rovai-managed ACP Profile / Launcher + Process-level MCP Tool Plane
```

第三份变更：

```text
最小 AgentRun + Explicit Send + Approval + Cancel + Evidence + Cleanup
```

后续独立变更：

```text
Host reuse
→ Missing-send Recovery
→ Native Skill
→ Compaction observation
→ Session recovery
→ Additional roots
→ Rich ACP Tool Updates
```

第一版不应包含：

- Web UI 嵌入；
- Headless 文本解析；
- Python SDK Transport；
- Harness Native Team / Subagent；
- 用户全局 Profile 导入；
- 自动安装 latest package；
- Session resume 伪兼容；
- Runtime final 自动发布。

---

# 13. 最终兼容性记录模板

实现完成后填表：

| 能力 | 状态 | 证据 | 备注 |
|---|---|---|---|
| `dsh` 安装发现 | pending |  |  |
| Node 版本检查 | pending |  |  |
| Harness package closure | pending |  |  |
| ACP package closure | pending |  |  |
| Private DSH_HOME | pending |  |  |
| Profile/config digest | pending |  |  |
| Credential readiness | pending |  |  |
| Model readiness | pending |  |  |
| ACP v1 initialize | pending |  |  |
| session/new | pending |  | fresh only |
| text prompt | pending |  |  |
| committed message update | pending |  | final text only |
| prompt terminal | pending |  |  |
| session/cancel | pending |  |  |
| structured permission | pending |  | one-shot |
| approval metadata quality | pending |  |  |
| Rovai built-in MCP | pending |  | process profile |
| external MCP stdio | pending |  | process profile |
| external MCP HTTP | pending |  | process profile |
| MCP per-run isolation | pending |  | one Host per Run |
| Tool call correlation | pending |  |  |
| Action / Evidence completeness | pending |  |  |
| `camp.message.send` | pending |  | exactly once |
| primary workspace | pending |  |  |
| additional roots | unsupported | upstream contract |  |
| session MCP | unsupported | upstream contract | use process profile |
| image/audio prompt | unsupported | upstream contract |  |
| live reasoning / plans | unsupported | upstream contract |  |
| live tool updates via ACP | unsupported | upstream contract |  |
| session model switching | unsupported | upstream contract | Host-frozen |
| session load/resume | unsupported | upstream contract |  |
| per-session close | unsupported | upstream contract |  |
| Native Skill | deferred |  |  |
| Native Subagent / Workflow | disabled |  | conflicts with Rovai |
| Compaction observation | deferred |  |  |
| warm Host reuse | deferred |  |  |
| missing-send recovery | deferred |  |  |
| telemetry hard opt-out | pending |  |  |
| process cleanup | pending |  |  |
| Preview upgrade re-probe | pending |  |  |

状态只允许：

```text
verified
unsupported
deferred
disabled
blocked
pending
```
