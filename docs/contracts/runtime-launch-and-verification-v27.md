---
document_type: contract
name: Runtime Launch and Verification
version: v27
status: accepted
source_version: v1.30
last_updated: 2026-08-26
---

# Runtime Launch and Verification v27

v27 replaces [v26](runtime-launch-and-verification-v26.md). It incorporates the accepted v1.28 TRAE/ACP/Grok changes
recorded below and the v1.30 Pi contract. All other Runtime terms from v26 remain unchanged. For Pi, this version
replaces the v26 provider overlay, one-Host/one-Session, fixed launch-time Bootstrap/Skill and
unsupported-MCP terms with the confirmed
[model-context-change revision 1](../versions/v1.30/model-context-change.md). If a v26 Pi term conflicts with this
document, v27 is authoritative.

## Product identity、discovery 与平台

- wire identity remains `pi`, display name remains `Pi Coding Agent`, canonical executable remains `pi`, executable
  override remains `ROVAI_PI_BIN`, and transport remains the official LF-delimited `pi-jsonl-rpc-v1`;
- light discovery runs only bounded `pi --version`. A behavioral check or real AgentRun may invoke the model, but it
  must use the same managed Host/input path as production;
- executable path, version, fingerprint, protocol qualification or managed-extension digest drift invalidates the
  corresponding Ready/Host evidence;
- the existing `pi × macos-arm64` admission remains the only qualified Pi platform. macOS x64 and Windows x64 remain
  `not_qualified / runtime_platform.qualification_evidence_missing`.

## Native authentication and model selection

Formal Pi Hosts inherit the user's normal `HOME` and do not override `PI_CODING_AGENT_DIR`. Authentication, provider
catalog, model catalog and default provider/model therefore come from Pi's native `~/.pi/agent` state, including Pi
login, subscription and BYOK mechanisms.

- Core does not read Claude settings, create a MiniMax provider overlay, copy a token, inject
  `ROVAI_PI_MINIMAX_API_KEY`, or write a Rovai-owned `models.json`;
- a new Session launched with `pi://runtime-default` receives no `--provider` or `--model` and uses Pi's native
  default. An exact resumed Session first restores its recorded provider/model;
- an explicit `pi://model?provider=<provider>&id=<id>` selection must resolve through
  `get_available_models -> set_model -> get_state` and match exactly. Pi `0.84.2` persists that explicit choice as its
  global native default; the product must not describe it as Run-local;
- model and thinking identity are per-Run facts and do not enter the Pi Host LRU key. Missing authentication and
  missing model fail closed as `authentication_required` and `model_required`; there is no Claude/MiniMax fallback.

## Resident Host launch and compatibility

The formal launch is semantically equivalent to:

```text
pi --mode rpc
  --no-extensions --no-skills --no-context-files --no-prompt-templates --no-themes
  --no-approve --no-builtin-tools
  --extension <rovai-pi-host-v2>
```

The launch must not fix `--append-system-prompt`, `--skill`, `--tools`, `--provider`, `--model`, or a Rovai-owned
`PI_CODING_AGENT_DIR`. `--no-builtin-tools` is required: `--no-tools` would permanently prevent later
`setActiveTools()` activation in Pi `0.84.2`.

Pi participates in the public Runtime Fleet LRU, but its resident compatibility key is workspace-scoped and contains
only process-level boundaries: exact workspace/execution root, Pi executable path/version/fingerprint, qualified
JSONL protocol revision, `rovai-pi-host-v2` digest, platform and process permission boundary. Camp, member, Native
Session, identity, Bootstrap, Skills, MCP, model, thinking, attachment generation, Built-in lease and AgentRun are
not Host-key inputs.

One Host executes at most one AgentRun at a time. Compatible Runs in the same workspace may serially reuse it;
concurrent Runs receive separate Hosts and cross-workspace reuse is forbidden. A clean release fences per-Run
Approval/MCP/Built-in leases and clears the current binding. Any protocol, receipt, cleanup, MCP, Extension or Session
validation error poisons and stops the Host instead of returning it to the LRU.

Claude Code and Antigravity remain one-shot process integrations and therefore do not enter this resident Host LRU.
That is an execution-shape distinction, not a disabled user-facing LRU option.

## Native Session activation, resume and identity

Every AgentRun publishes a new private binding generation and then activates exactly one Session:

1. an existing binding uses `switch_session(<exact canonical session file>)`;
2. a new binding uses `new_session`;
3. Core verifies the full Pi Session UUID, canonical file, cwd and actual provider/model/thinking state before prompt;
4. cold resume uses only the persisted full UUID and exact canonical file. Partial IDs, `--continue`, recent-session
   scan, fuzzy matching and portable history replay are forbidden.

An exact resume failure is fail-closed and records controlled continuity loss; it does not silently create a new
Session for the same input. Pi `0.84.2` may create the JSONL Session file only after the first assistant entry, so a
new provisional locator may refer to an owned regular-file destination, but successful release must verify the
materialized file header, full UUID and cwd.

Member identity is frozen per Native Binding, not per Host. Bootstrap Evidence v2 stores the exact six-field Member
Identity bytes/digest and full Bootstrap bytes/digest. Profile edits do not patch an existing Pi Session; a new
binding generation for a new Native Session reads the new identity. A resident Host can therefore serve different
members without treating identity as resident process state.

## Managed Bootstrap and input receipt

Pi alone uses `CharterDeliveryMode=managed_system_prompt`. Bootstrap v3/Formatter 3 bytes and Dynamic Context
Formatter 21 remain unchanged, but delivery changes:

```text
P_base  = Pi native system prompt with current active tools + current Skills + exact cwd
P_final = P_base + "\n\n" + frozen Bootstrap
```

`rovai-pi-host-v2` performs this exact append in `before_agent_start`. Dynamic Context remains the exact
`prompt.message`; Bootstrap is not duplicated as a user message or Tool result. Pi never creates a
`ROVAI_BOOTSTRAP_REDELIVERY` payload overlay or compaction-redelivery requirement.

Before returning `P_final`, the Extension submits a blocking Pi Managed Input Receipt v1. Core verifies and durably
binds Host/binding/Run/epoch/Session identities, Bootstrap evidence/digest, Pi base and final prompt digests, exact
Skill catalog, active Tool names, MCP catalog/projection and binding-document digest. Only a committed receipt yields
the private commit nonce. A Pi prompt response can become the accepted ACK only after that receipt exists, and the
Runtime request digest schema 2 binds its digest. Receipt failure, timeout, restart or generation mismatch prevents
the provider request.

The private binding document is atomically published at a fixed Core-owned path with parent mode `0700` and file
mode `0600`. Unknown fields/version, wrong owner/mode, symlink/non-regular file, partial write, stale generation,
digest mismatch or wrong workspace/Run/Binding/Session fail closed. Its body and private receipt do not enter argv,
public diagnostics, Activity, model-visible ordinary messages or public read models.

## Skills

Pi starts with `--no-skills`. On each Session activation the managed Extension's `resources_discover` returns only
the exact `<workspace>/.pi/skills` root. That root may contain both project-native Pi Skills and Rovai-reconciled
ready Skills; user-home, ancestor, Package and third-party Extension discovery remain disabled.

Core calls `get_commands` before prompt and verifies every expected managed Skill exactly once, its name,
description digest and lexical entry path, plus canonical target containment. Duplicate real files, duplicate names,
missing expected Skills, prior-Session paths and workspace escapes stop the Host. `switch_session`/`new_session`
rebuilds Pi's ResourceLoader, so Skill changes take effect per Session activation without restarting the process.

## External MCP and Approval

Pi exposes:

```text
ExternalMcpProjection = AdditivePerRun
McpSameNamePolicy     = RovaiWins
McpApprovalControl    = CoreManaged
stdio                 = supported
Streamable HTTP       = unsupported
```

Core owns each ready stdio MCP process tree, performs initialize/initialized and paginated `tools/list`, validates
description and input schema, and publishes stable non-colliding `mcp_<server>_<tool>` proxy Tools in the current
binding. The Extension registers those proxies and activates the seven Pi native Tools followed by MCP names in
bytewise order. MCP definitions are refreshed for every Session activation and never written to user Pi config.

Every MCP call, including read-only-hinted Tools, creates a durable `mcp_tool` Approval. After `allow_once`, the
private Core bridge revalidates Host/binding/Run/epoch/projection/Tool/argument digests before one call; deny,
timeout, cancel, restart, late response and unknown UI/Tool/mutation do not call the server. Text, image and bounded
resource content are normalized to Pi results; audio, unknown content, invalid base64 and over-limit payloads return
a bounded error. MCP secrets, stderr and private envelopes are never model-visible or public.

Native `read/bash/edit/write/grep/find/ls` keep their Pi schemas. `bash/write/edit` retain blocking durable Approval;
read/search Tools do not prompt, and Pi still has no native sandbox. The bundled `rovai` CLI continues through native
`bash` with a per-Run lease and is not MCP.

## Final, cleanup, Usage and Compaction

`prompt` response remains accepted-only, `message_end.message` remains the authoritative assistant snapshot, and
`agent_settled` remains the only successful terminal/Missing-Send boundary. `agent_end`, process exit, receipt or
silence cannot replace it. Abort plus Fleet Stop remains the authoritative cancel/descendant fence.

Usage/Cost remain Disabled. Pi compaction remains product-disabled/unqualified until ordinary, manual, threshold
automatic and overflow+automatic-retry real smokes all prove the same effective System Prompt digest and identity
marker. Structured compaction lifecycle may be private monitoring only; it never changes Bootstrap revision or
causes ordinary-message redelivery.

## Data transition

Migration 109 first records the durable Runtime entrypoint locator identity without changing the Data Contract.
Migration 110 then follows Grok's Migration 107/108 chain and upgrades `v1.22 / schema 63 / migration 109` to
`v1.23 / schema 64` by adding the Pi adapter/catalog/Skill closed sets. Migration 111 finally upgrades to
`v1.24 / schema 65`:

- adds `managed_system_prompt`, Bootstrap Evidence v2 identity/full-Bootstrap fields and the private one-to-one
  `pi_managed_input_receipt` acceptance gate;
- fences nonterminal legacy Pi Runs as `pi_managed_context_v1_required`, clears legacy Pi binding/compaction technical
  state and never fabricates receipts for completed history;
- preserves non-Pi bindings/evidence and completed Pi Camp messages, Tasks, Actions, Activity and final output;
- startup quarantines legacy Pi session/config roots before the new managed Host can reuse them.

## Acceptance

- Rust fixtures cover launch argv/env privacy, managed receipt acceptance, Bootstrap identity freeze, no Pi
  redelivery overlay, workspace Host reuse/member invalidation separation, exact Session validation and migration;
- a real Pi `0.84.2` native-default prompt must pass through `rovai-pi-host-v2` and a committed receipt;
- a real stdio MCP fixture covers initialize/list/call and process cleanup; Streamable HTTP remains rejected;
- capability claims must distinguish these qualified paths from the still-disabled Usage/Cost and unqualified
  compaction/platform rows.

This contract specifies the implemented Pi behavior; it does not by itself grant First-Class admission. The current
[v1.30 checklist report](../versions/v1.30/checklist-report.md) remains authoritative for evidence completeness.

## v1.28 Runtime changes retained by v27

v26 的 Runtime Home、Probe、TRAE command、
ACP Prompt error/failure、时间域、权限、External MCP、逐平台准入与 Cursor 边界全部保持不变。本版只收敛
Grok Build 的最低版本与 continuation：三个宿主平台共用 `>= 1.0.0` 版本门，Ready 必须观察到标准 ACP
`sessionCapabilities.resume`；Grok cold continuation 从 load-only HistoryRestore 切到 `session/resume`，
而创建期原生 rules、compaction、Plugin MCP、auth 与公开输出边界不变。

### 1. TRAE Bash command allowlist

通用 ACP Adapter 继续只允许非空字符串 `rawInput.command` 进入公开 `input`。`trae-cn-cli` 额外允许
非空字符串 `rawInput.Command`；这是 `traecli 0.120.52` Bash `tool_call` 的实测字段，并且只在当前
Adapter identity 已明确为 `trae-cn-cli` 时生效。

`rawInput.Command` 的相邻 `Description` 及所有未知字段保持私有，只参与完整 `rawInputDigest`。其他
Adapter 收到相同大写字段时必须 fail closed，不公开 command，也不能据此补写 `execute`。TRAE 的公开
Command 在缺少原生 kind 时可补全 `execute`；同一 `toolCallId` 的 terminal update 省略 `rawInput` 时，
Core 从当前 Prompt 的进程内 started observation 携带相同 command、kind 与 digest，不从 title、output
或 digest 反推。结构化 permission request 的 Shell argv 归一化必须复用同一 Adapter-scoped allowlist。

### 2. ACP Prompt error 与输入确认

Host 仍把一个 prepared Runtime Input Delivery 绑定到当前 Session 的唯一 active Prompt。stdin write/flush 和
单独的 Session event 不产生早期 ACK；History Restore replay 与 idle metadata 继续留在既有隔离 route。

匹配 `session/prompt` JSON-RPC request ID 的 response 按以下顺序结算输入：

- success response 产生 `InputAccepted`；
- error response 到达前，若当前 active Prompt 已经收到至少一个经 Host/Run/epoch/Session/Prompt/Delivery fence
  准入的非 metadata Prompt activity，则产生 `InputAccepted`，随后把同一个 response 作为 AgentRun failure；
- error response 前没有任何当前 Prompt activity 时产生 `InputNotAccepted`；
- response 前 Host 丢失仍为 `delivery_unknown`，不得从 pipe flush 或未完成的 route 猜测结果。

Prompt activity 与 matching response 必须组合使用：activity 本身不提前推进水位，matching error 本身也不能在
已经产生 Tool、assistant 或 permission activity 后把输入降级为未接收。Input disposition 必须先于同一 response
的 terminal completion 持久化。accepted input 后的失败禁止原 Run 重放，`manualRetryAllowed=false`；只有 failed
且 durable delivery 为 `not_accepted` 时才允许普通手动重试。

### 3. ACP 公开 Runtime failure

所有 Product Runtime 都可以形成既有 `RuntimeFailureView`；ACP Prompt error 至少保留 matching JSON-RPC 的
安全数字 `error.code` 与有界、脱敏 `message`。原始 `error.data`、Prompt、用户正文、Tool input/output、stderr
和私有日志不得进入公开 failure。

ACP terminal failure 使用 `origin=runtime`、`phase=execution` 和稳定 code；auth、rate limit、quota、model 与
permission 可以继续经统一分类器收敛到高价值 code。公开 `retryable` 必须同时满足 Provider 分类和 Core 输入
重试安全，Provider 的可重试提示不能覆盖 accepted input 禁止重放。

本版不修改 `RuntimeFailureView` wire shape，也不增加 Migration。历史 `public_runtime_failure_json = null` 不回填。

### 4. AgentRun 时间域

CampMessage、CampTurn、AgentRun、Conversation、Domain Event 及其 `created_at / started_at / updated_at / ended_at`
使用调用时的 UTC wall clock。`AgentRun.created_at` 表示触发输入被 Core 接受并创建 Run 的时间；`started_at`
表示 Scheduler 真正 claim Run 的时间，排队时可以晚于输入，不能改写成最后输入时间。

Execution Budget 使用独立的进程内非倒退 observation：取当前 wall clock、进程启动 wall anchor 加 awake elapsed、
以及上次 observation 的最大值。系统休眠导致 wall clock 前进时必须计入预算；wall clock 回拨不能延长已经观察到
的预算。Budget comparison/lease 可以使用该 observation，持久化审计时间仍使用当时 wall clock。重启后继续由
持久 UTC deadline 拥有跨进程边界。

### 5. Grok Build

- identity 为 `grok-build`，命令为 `grok`；ACP argv 为
  `--permission-mode <effective> --no-auto-update agent --no-leader [--plugin-dir <private-root>] stdio`；
  initialize 后只能选择已广告的非交互 `xai.api_key` 或 `cached_token`，不得自动启动 browser/device auth；
- 模型/provider 使用官方 `$GROK_HOME/config.toml` 的 `[models]`、`[model.<id>]` 与
  `[model_providers.<id>]`；Core 不定义或翻译 `GROK_MODEL_*` 三字段，也不修改官方配置；
- `$GROK_HOME/.env` 是 mode `0600` 的本机密钥环境源。Core 只向 Grok 子进程注入官方 TOML 的
  `env_key` / `env_http_headers` 明确引用项与官方全局 API-key 变量；未引用项不得注入。官方 TOML
  `api_key` 同样兼容；
- 正式 Host 不覆盖 `GROK_HOME`。BYOK Probe 把官方配置层复制到临时 Home，但不复制 `.env`；无 BYOK 的
  account-auth Probe 保留原生 Home 读取既有 cached token。配置摘要进入 Host 与 Native Session resume compatibility；
- Host permission `default|acceptEdits|auto|dontAsk|bypassPermissions|plan` 通过
  `--permission-mode` 投影；新 draft default 为 `bypassPermissions`，Core read-only 强制 `plan`；
- 模型 catalog 来自真实 Session；显式模型只调用已验证的 `session/set_model`，不声明或调用
  `session/set_config_option`；
- Kimi/Grok 不对 `<think>` 或其他 provider agent text 做专用清洗、重分类或抑制；标准
  `agent_message_chunk` 原样进入执行台 Evidence、final 与 Missing-Send candidate，只有通用 trim；
  `_x.ai/*` notification 不生成公开输出；
- 三个宿主平台共用 `grok >= 1.0.0` 最低版本门；light discovery 低于门槛时为 `light_failed`。Deep Probe 与
  Ready 必须同时观察 `initialize.agentCapabilities.sessionCapabilities.resume` 对象，并对刚创建的 exact Session ID
  成功调用一次无 Prompt 的 `session/resume`；只广告但拒绝调用时仍为 incompatible；
- warm Host 进入 Runtime Fleet LRU。compatible same-host Session 直接复用；cold exact continuation 使用标准
  ACP `session/resume`。Grok `session/new` 保留 attachment root 与 Run tmp，`session/resume` 必须发送空
  `additionalDirectories`，不得尝试更新 creation-time roots。Grok 不声明或选择 `session/load` 产品能力；
  resume 失败只允许一次 continuity-lost replacement `session/new`。其他 Runtime 的通用 load/HistoryRestore
  路径不变；
- Native Session Bootstrap 内容与 Formatter 3 不变。新 Grok Session 必须把完整 Bootstrap 原样追加到
  `session/new._meta.rules`，首轮与后继 `session/prompt` 只含 Dynamic Context；不得出现
  `systemPromptOverride`，same-host/resume 不得重复注入，replacement new 必须按新 Binding/generation 注入一次；
- compaction detector release default 为 `best_effort`，只接受 exact Session-scoped、无 request ID 的
  `_x.ai/session_notification` `auto_compact_completed`，并要求非空 `_meta.eventId` 与非负 `tokens_after`。
  completion 只推进既有 Bootstrap Redelivery revision，下一次尚未 prepared 的 Core 输入用 Envelope v2；
  replay、started/failed/cancelled、文本与 token heuristic 不得准入；
- External MCP 为 `AdditivePerRun / NativeWinsSkip`：当前真实 Runtime 忽略 ACP Session `mcpServers`，Core 改用
  私有临时 Plugin 的 process `--plugin-dir`，保留 inspect 发现的全部 native 名称并随 Host 清理，不写
  project/user config；Skill group 为 `grok` / `.grok/skills`，原生发现已实测；Usage/Cost disabled。

### 6. Acceptance

- TRAE 实测 `tool_call` shape `rawInput = { Command, Description }` 只公开 `Command`，并生成
  `kind = execute` 与完整 raw-input digest；`Description` 不进入公开 Evidence、Action result 或 Renderer payload；
- 同一大写 `Command` 对非 TRAE ACP Adapter 不产生公开 input 或 execute kind，稀疏 terminal update 保留
  started phase 的 TRAE command、kind 与 digest；
- TRAE stdout、stderr、mixed、empty、nonzero 与 large command-output matrix 均显示原始受控命令，
  其他相邻 raw 字段不公开；v25 的 status 与非零 exit-code 规则保持独立；
- macOS 休眠后创建的新 AgentRun，`created_at` 与触发输入同一 wall-clock 边界，`started_at` 为真实 claim 时间；
- suspend 前后 Execution Budget observation 前进且不倒退，审计字段不使用进程启动 wall anchor；
- ACP activity 后返回 `-32603 Internal error` 时 Delivery 为 accepted、Run 为 failed、普通重试关闭；
- ACP 在任何 Prompt activity 前返回 error 时 Delivery 为 not accepted，失败 Run 可以按既有门禁重试；
- ACP failure 投影 Runtime kind、稳定 code、安全 summary/detail 与安全 retryable，不泄露私有 payload；
- Host 在 response 前退出仍进入 `delivery_unknown`，accepted ACK 水位规则不变。
- Grok 新 draft 为 `permission_mode=bypassPermissions`；新 Session wire 只出现一次 `_meta.rules` 且不含
  `systemPromptOverride`；真实 structured completion 推进一次 revision，下一轮 accepted ACK 后
  requested/acknowledged 收敛且不重复；
- Grok `>= 1.0.0` Deep Probe 必须广告标准 ACP resume，并以同一 Session ID 真实成功调用一次；确定性 fixture
  必须证明只广告但拒绝 Resume 不能 Ready，cold path 只调用 `session/resume`、不调用 `session/load`，且
  Resume params 为 `additionalDirectories=[]`、不重新携带 creation-only `_meta.rules`；
- 私有 Plugin External MCP、Managed Skill、Built-in CLI、Missing-Send 与 generic ACP agent text 保持 v26 行为；
  每个平台的目标版本真实产品 Smoke 与 adapter-scoped qualification 仍分别记录，不互相外推。

## References

- [Runtime Launch and Verification v26](runtime-launch-and-verification-v26.md)
- [Confirmed Pi model-context change](../versions/v1.30/model-context-change.md)
- [Pi Runtime Research](../research/pi-runtime-research.md)
- [Runtime 兼容性清单](../runtime-compatibility.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [AgentRun Recovery](../architecture/agent-run-recovery.md)
- [Evidence 与 Canonical Activity](../architecture/foundational-invariants.md#evidence-canonical-activity)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
- [Run Process Detail Surface v20](run-process-detail-surface-v20.md)
- [v1.28 model-context change revision 2](../versions/v1.28/model-context-change-grok-native-rules.md)
