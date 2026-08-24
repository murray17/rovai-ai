---
document_type: contract
name: Runtime Launch and Verification
version: v26
status: accepted
source_version: v1.28
last_updated: 2026-08-24
---

# Runtime Launch and Verification v26

v26 replaces [v25](runtime-launch-and-verification-v25.md). v25 的 Cursor 产品入口、用户原生 Runtime Home、
Probe 隔离、逐平台准入、Ready、模型目录、Runtime failure、附件授权和既有十二种 Runtime 权限默认均保持
不变。本版把 Pi Coding Agent 作为第十三种 Product Runtime 接入，并冻结其 JSONL RPC、Claude 本机
MiniMax provider、受管审批、Session continuation、Skill、MCP 与可观测能力边界。

## Product identity、discovery 与平台

- wire identity 为 `pi`，显示名为 `Pi Coding Agent`，canonical executable 为 `pi`，覆盖键为
  `ROVAI_PI_BIN`，协议 identity 为 `pi-jsonl-rpc-v1`；
- 轻检只运行有界 `pi --version`，不发 Prompt、不读取模型正文、不修改配置；可执行 identity、版本或
  fingerprint 改变后，旧 Ready 和 Host compatibility 不得直接复用；
- `pi × macos-arm64` 由 [Runtime 兼容性清单](../runtime-compatibility.md)的 digest-bound evidence 准入；
  `macos-x64` 与 `windows-x64` 没有独立资格证据，保持
  `not_qualified / runtime_platform.qualification_evidence_missing`；
- closed Adapter、Installation、成员配置、Settings、Onboarding、Monitoring、Skill group、Runtime Activity
  与 Migration 必须原子包含 Pi。Cursor 的隐藏和历史只读边界不变。

## Provider 与秘密边界

Pi 使用与本机 Claude Code 相同的 MiniMax Anthropic-compatible 配置来源，但不复制凭据到 Rovai 数据库、
成员配置或 Pi 用户配置：

1. Core 只读取 `~/.claude/settings.json` 中 exact `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL` 与
   `ANTHROPIC_MODEL`；缺失、重复语义、非普通文件、symlink、所有者不符、Unix group/other 可访问、非
   HTTPS URL 或 URL 含 credentials 均在 spawn 前 fail closed；
2. Core 为目标 Host 创建权限收窄的私有 `PI_CODING_AGENT_DIR`，其中 `models.json` 定义 provider
   `rovai-claude-minimax`、`api=anthropic-messages`，`apiKey` 仅引用进程环境变量
   `ROVAI_PI_MINIMAX_API_KEY`；真实 token 只进入目标子进程环境；
3. 正式 AgentRun 保留父进程通用 `HOME`，仅覆盖 `PI_CODING_AGENT_DIR`。这是为了禁止自动加载用户/项目
   Extension 并固定 provider/Session 行为的 Runtime-specific 安全隔离，不是 Probe Home，也不允许扫描或
   合并用户 Pi config；
4. argv、Evidence、diagnostics、公开 command、Runtime state 和兼容性 fingerprint 都不得包含 token、原始
   Claude settings、provider URL credentials 或 Session 文件正文。

## 正式启动与 Ready

首个 Session 使用以下等价启动合同：

```text
pi --mode rpc
  --provider rovai-claude-minimax
  --model <exact model id>
  --session-dir <private session directory>
  --session-id <new UUID>
  --no-extensions --no-skills --no-context-files --no-prompt-templates --no-themes --no-approve
  --tools read,bash,edit,write,grep,find,ls
  --extension <managed approval extension>
  --skill <each managed skill path>
  --append-system-prompt <frozen charter/context instruction>
```

具体 argv 顺序可以变化，但语义不得放宽；子进程同时设置 `PI_TELEMETRY=0`。Ready 必须同时证明当前 executable/version/fingerprint、
`get_state` 的非 streaming Session、固定 provider/model identity、受管 Approval Extension handshake、严格
LF JSONL framing 与进程树 cleanup；模型认证只有在真实 Prompt 成功后才可升级为行为证据。Pi Probe 使用
独立临时 config/session root，完成后清理，不把 Probe Session 绑定到正式 AgentRun。

## JSONL RPC、Tool 与 final

- stdin/stdout 为严格 LF-delimited JSON；`U+2028`/`U+2029` 是普通 JSON 字符，不是 framing boundary；
  banner/log 只能进入有界私有 stderr；
- 带 request ID 的 `prompt` response 只表示输入 accepted。它启用 accepted-send suppression，但不是成功
  terminal；
- `toolCallId` 是 Tool 生命周期 identity。`tool_execution_update` 的 result 按累积快照处理；同一调用只形成
 一个 started 和一个 terminal Action；
- `message_end.message` 是 assistant message 的权威完成快照；thinking、增量草稿、stderr 和 Extension 私有
  状态不进入公开 final；
- `agent_settled` 是 Prompt 的唯一成功 final boundary。`agent_end`、response、process exit 或静默窗口都
  不能替代它；Pi 的 Missing-Send boundary 为 `pi_agent_settled`；
- cancel 向 RPC 写入 `abort` 后不等待可能延迟的 response；Fleet Stop 是权威进程树 fence。cancel/error 不
  发布成功 final，且后续副作用不得发生。

## 受管 Approval 与权限

Pi 上游没有原生 sandbox 或权限系统，因此 Pi 只接受静态 `approval_mode=managed`，也是新队员 Product
default；它没有可扩权的 alternate mode。

- Rovai 受管 TypeScript Extension 在 `session_start` / `before_agent_start` 完成版本化 handshake；未握手、
  extension error、timeout、Core restart 或未知 mutating Tool 一律阻断；
- `read`、`grep`、`find`、`ls` 不触发交互式 Approval；它们的文件可达性来自 Pi 进程的 OS 用户权限、冻结
  cwd 和既有 Runtime Workspace/attachment 约束，Pi 本身不提供 sandbox。`bash`、`write`、`edit` 必须在
  Tool 执行前发出 blocking `extension_ui_request`，由 Core 建立 durable Action/Approval，再以
  `extension_ui_response` allow-once 或 deny；
- allow 只适用于 exact `toolCallId` 与 canonical action digest；deny 后不得产生目标副作用。Action 公开
  output 只保存经既有安全边界准入的结果，不保存 Extension envelope 或 provider secret；
- Runtime 的最高权限不绕过 Attachment View、Run tmp、Builtin CLI lease、execution epoch、审批恢复和 planned
  shutdown fence。

## Host LRU、Session resume 与身份保持

Pi 使用公共 Runtime Fleet LRU：每成员最多 20 个 warm Host、全局最多 200、idle 30 分钟、每 60 秒 sweep。
首版一个 Pi Host 只绑定一个 Native Session，不调用 `switch_session` 在同 Host 并发承载其他 Session。

continuation 顺序固定为：

1. compatibility digest 完全一致、健康且 quiescent 时直接复用 warm Host 和已知 Session；
2. Host 不可用时，用持久 binding 中的 exact canonical `sessionFile` 启动新 Host：
   `pi --mode rpc --session <exact path> ...`；禁止 partial ID、`--continue`、最近 Session 与目录扫描；
3. 启动后 `get_state` 必须核对同一 full Session UUID、canonical file、provider 与 model；任一不符即停止 Host、
   记录 continuity lost，并至多创建一个新 Session；Pi 不使用 replay 型 history restore。

Host compatibility 至少绑定 executable/version/fingerprint、协议、provider schema、私有 config/Extension
version、cwd/workspace access、权限、Built-in lease、附件授权、模型与 Skill exposure digest。Native Session
binding 保存 full Session UUID 和私有 locator；公共投影只暴露稳定 identity/fingerprint，不公开原始路径。
Host instance、AgentRun delivery/execution epoch 与 binding generation 各自 fencing，Core 重启后同一逻辑
Conversation 可以保持 Native Session identity，但新进程必须获得新的 Host instance 与 Built-in lease。

## Skill、MCP、Built-in 与可观测能力

- Rovai managed Skill delivery group 为 `pi`，投影目标为项目 `.pi/skills`。Pi 在 Session 启动时扫描 Skill，
  因此每个受管 Skill 用 exact `--skill <path>` 显式投递，完整 exposure digest 进入 compatibility；变化后不得
  直接复用旧 Session；
- External MCP 为 `Unsupported`。Pi 不接收 Assignment 的 MCP server projection，也不写用户配置；第三方
  Extension 不自动成为产品能力；
- Built-in transport 通过 Pi 的受管 `bash` Tool 调用 bundled `rovai` CLI，继续使用当前十五项 catalog/help、
  per-Run lease 和 successor fencing；它不是 MCP；
- Runtime Activity 使用 `fine_grained` Pi mapping；稳定 `toolCallId`、结构化 Tool start/update/end 和公开
  message snapshot 可以进入 Canonical Activity，不从正文补猜未上报行为；
- Usage/Cost 与 Compaction 首版均为 `Disabled`。上游存在结构化候选不等于 Rovai 已证明 per-Run attribution、
  occurrence/dedupe 与 resume 语义；它们不参与 Ready，也不从文本、token 差值或 Session totals 推断。

## Acceptance

- strict LF/Unicode framing、provider 文件权限、秘密不落公开数据、Extension handshake、Action/Approval
  allow/deny 与 durable recovery fixture 通过；
- 真实 `pi 0.84.2` + 本机 Claude MiniMax 配置完成 first Prompt、受管 Bash、allow write、deny no-side-effect、
  cancel no-late-effect、warm reuse、Core restart 后 cold exact resume、Missing-Send、`.pi/skills` 与十五项
  Built-in CLI；
- cold resume 保持 Native Session UUID、切换 Host instance，并能在删除源 marker 后只依赖原 Session 回忆；
- External MCP 明确 `unsupported`，Usage/Cost 与 Compaction 明确 `disabled`；
- macOS arm64 qualified；macOS x64/Windows x64 不从 arm64 证据外推。

## References

- [Runtime Launch and Verification v25](runtime-launch-and-verification-v25.md)
- [Runtime Platform Admission v1](runtime-platform-admission-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Pi Runtime Research](../research/pi-runtime-research.md)
- [Runtime 兼容性清单](../runtime-compatibility.md)
