---
document_type: contract
name: Runtime Launch and Verification
version: v30
status: accepted
source_version: v1.39
last_updated: 2026-09-03
---

# Runtime Launch and Verification v30

v30 replaces [v29](runtime-launch-and-verification-v29.md). v29 的所有 Runtime、Fast、权限、平台、Discovery、Probe、
模型目录、Session、continuation 与错误语义保持不变；v30 只增加 Pi Coding Agent 的 closed Product Runtime identity、
独立 JSONL transport 和下列 Adapter-specific contract。

## 1. Identity、配置与平台

- `adapterKind = "pi"`，command `pi`，environment override `ROVAI_PI_BIN`，protocol
  `pi-jsonl-rpc-v1`，最低正式版本 `>= 0.84.4`。
- 正式 Host 继承用户通用 `HOME` 与 Pi 官方 `PI_CODING_AGENT_DIR`；Core 不读取/复制 Claude Home，不创建 provider
  overlay，不把 secret 写入数据库、argv、Prompt、日志、Evidence、Activity、diagnostics 或公开事件。
- runtime-default 不传 provider/model。显式 `pi://model?provider=<encoded>&id=<encoded>` 必须先存在于
  `get_available_models`，再 `set_model`，最后由 `get_state` 精确核对 provider/id；未知或不一致 fail closed。
- Pi 的 macOS arm64、macOS x64、Windows x64 行都固定为
  `not_qualified / runtime_platform.qualification_evidence_missing / evidenceRevision=null`，直到该精确平台取得 Pi
  专属 immutable evidence。Debug build 可以用本机显式 override 跑隔离 smoke；release 必须忽略它。

## 2. Machine Ready

Availability Check 与 Dispatch Preflight 使用同一 Pi requirements、builder 和 snapshot validator。Ready 必须同时证明：

1. canonical executable identity/fingerprint 与 non-prerelease `>=0.84.4` version；
2. managed extension `rovai-pi-host-v3` handshake；
3. 非空、coherent 的原生 model catalog/current model；
4. `new_session` 后 `get_state` 给出完整 UUID session ID、absolute canonical-or-future session file 与 exact cwd；
5. 再创建一个不同 Session，实际调用 `switch_session` 传入第一项 exact canonical file；
6. 最后 `get_state` 的 session ID、canonical materialized file 与 cwd 与第一项完全一致。

只有第 6 步成功才声明 `conversation.exact_resume`。Probe 使用 private
`--session-dir <probe-root>/sessions`；所有测试 Session、binding、extension 和子进程随 probe root 清理，不写用户
Native Session root。正式 AgentRun 不传 `--session-dir`。

旧 Ready 缺少上述任一 capability，或 version/fingerprint/requirements digest 不匹配，Snapshot validation 和
dispatch blocker 都必须降级并重新检查，不能复用较弱 evidence。

## 3. Host、Fleet 与 Session

Host strategy 为 `resident_multi_session`，但每个 Host 同时最多一个 Active Prompt。统一 Fleet 是唯一进程所有者；
Pi 实现 `pid/executable_path/is_alive/is_quiescent/shutdown_and_reap/force_reap_until/shutdown_and_reap_until` 与当前
planned shutdown protocol 3。

统一 Fleet 默认仍以 Camp ID + member Agent ID + process digest 复用。Pi 是显式的 workspace-scoped 例外：复用 identity
为 canonical workspace + Pi process digest，当前独占 lease 的 Camp ID/member Agent ID 作为独立 invalidation scope，并在
每次跨 scope 领取时更新；Camp 删除或成员永久移除仍停止当前属于该 scope 的 Host，其他 Runtime 的复用与失效行为不变。
Pi workspace Resident 使用独立 quota bucket，并继续受 global quota、TTL 与 LRU 约束。Pi process digest 包含 canonical
workspace、Pi executable/fingerprint、protocol、minimum-version policy、managed extension、固定 managed permission
boundary 与真实 process-scoped launch inputs。Session ID/file、Bootstrap、Skills、MCP、model、Prompt、AgentRun 和
Built-in lease 不进入 process digest。只有没有 pending RPC、queue、Approval、Tool/MCP call、Run lease，且
healthy/quiescent 的 Host 才能 IdleWarm；失败、协议错误、取消未收敛、receipt/capability drift 一律停止。

Conversation binding 保存完整 native session ID 和 Core-private canonical session file。恢复还必须精确匹配
installation id/generation、executable/entrypoint identity、runtime compatibility digest、
`pi-jsonl-rpc-v1:managed-system-prompt-v1`、binding id/generation、expected session ID 与 execution epoch。每次 warm
switch、Host restart 或 Core restart 都实际 `switch_session(exact file)` 并由 `get_state` 核对 ID/file/cwd。
recent Session、partial ID、目录扫描或 filename guess 禁止。失败 Host 先停止并记录 continuity lost，当前 Run 最多
创建一个 replacement Session。

完整 locator 只存在 Core private binding/session state。公开 Runtime event、Activity、diagnostic、failure、read model
和 exported bundle 禁止 `sessionFile`/`nativeSessionFile`；最多允许 materialized boolean 或 lowercase SHA-256 digest。

## 4. Managed system prompt 与 receipt

Pi 启动固定使用 `--mode rpc --no-extensions --no-skills`，并只加载 Core 写入 private、0600 config root 的 managed
extension。用户/project third-party extension、prompt template、context file、theme、approval 和 builtin tool 自动加载
保持禁用；Rovai 只显式注册受管 native tools、Skill、MCP proxy 与 Built-in CLI transport。

每个 Prompt 的 `before_agent_start` 形成：

```text
effective system prompt = Pi base system prompt + "\n\n" + exact complete Bootstrap bytes
user prompt             = exact frozen Dynamic Context bytes
```

`native_session_bootstrap_evidence.delivery_mode = managed_system_prompt`。extension 在返回 system prompt 前必须提交
[revision 1](../versions/v1.39/model-context-change-pi-managed-system-prompt.md)定义的 closed receipt；Core 核对
Host/binding generation、run/epoch、delivery/prompt/session、canonical cwd、private session-file digest、base/effective
prompt、Bootstrap evidence/payload、Skill exposure/catalog/model visibility、active tool names、MCP catalog/projection 与
binding document digest。nonce 必须是 exact canonical receipt digest；unknown field、ordering drift、missing field、
mismatch 或 timeout 都 fail closed。

Migration 135 的 `pi_managed_input_receipt` 以 delivery/run/epoch/binding/generation composite FK 精确绑定
`runtime_input_delivery`。insert 只允许 `prepared|delivery_unknown`、dispatch 已开始、matching
`managed_system_prompt` bootstrap；row insert 后不可 update/delete。managed delivery 没有 version-1 receipt 不可转为
accepted。Core 必须在单一 SQLite transaction 插入 receipt 并调用 acceptance transition；transaction 任一步失败都
不留下半状态。

Compaction strategy 为 `native_system_prompt_preserved`：Pi 每次 provider request 重新取得 Session system prompt，
因此 Pi 不进入 `bootstrap_redelivery_requirement`、`compaction_detector_policy` 或
`native_session_compaction_observer_lease`。manual/threshold/overflow+retry 后的下一 Prompt 仍必须产生新 receipt；
compaction fail/cancel 不构成成功或 input acceptance。

## 5. Skills 与 External MCP

Pi 使用现有 Skill Library/Assignment，delivery group root 为 workspace `.pi/skills`。每次 Session activation 重新
resource discovery；只加入当前 frozen、digest-verified、model-visible exposure，不建立 Pi 私有设置真源。Skill
catalog 的 name、description digest、canonical entry path 与 model visibility 必须出现在 receipt；同名、增删改、
disable 和 A→B→A no-leak 由下一 eligible Session/Run 验证。

Pi 上游没有内建 MCP，但官方 extension Tool API 是受支持的接入面，所以 External MCP 不是 Unsupported：

```text
projection:       additive_per_run
same-name policy: rovai_wins
approval:         core_managed
transport:        stdio | streamable_http
```

Core 拥有 Assignment、PreparedMcpProjection、logical/runtime name、private header/secret、连接、stdio server process、
HTTP session、cancel 与 cleanup。extension 仅注册当前 Run 的 `mcp_<server>_<tool>` proxy 并设置 active tools。每次 call
核对 host/run/epoch/projection/tool identity，mutation 创建 Durable Action/Approval；deny/cancel/bridge failure 不执行
目标副作用。HTTP 只接受当前 MCP Config 已准入的 http(s) URL、禁 redirect、bounded JSON/SSE 与 session continuity；Host
解绑、cancel 或 stop 后发送有界 cleanup/DELETE 并回收子进程。相邻 Run/Session 的 catalog 必须重建为空或当前值。

## 6. Action、Final、Cancel 与 Usage

Pi `tool_execution_start/update/end` 的 `toolCallId` 是唯一 lifecycle identity。update 是 cumulative presentation，end
是唯一 terminal；replay/partial/metadata 不得重复 Action。已知 read/grep/find/ls 是 read，write/edit/bash 与 MCP
mutation 在执行前拦截；未知 mutating tool 或未知 message shape poison Host。只有已验证 terminal write/edit shape
产生 file observation；没有可靠 path 时只保留 ending Git observation。

Bash extension 必须从 Pi `SettingsManager.getShellConfig()` 提供实际 canonical shell path、args 与
`commandTransport = argv|stdin`。Core 验证 command 的 exact insertion/index 或 stdin transport，并保存
`CanonicalActionInput::ShellCommand`；不得声称固定 `/bin/zsh -lc`。无法无损表达即拒绝。command 与有界
stdout/stderr/exit outcome 进入 `runtime.action` payload；空输出和 nonzero 保留 input/outcome，不从 final 补猜。

公开 narration 只消费 Pi assistant text delta；`message_end.message` 是去重后的 assistant snapshot，不证明 Run
成功。只有当前 Host/run/epoch/binding/prompt 的唯一 `agent_settled` 才是 authoritative success boundary，并允许
`IfNoAcceptedSend` Missing-Send。error、EOF、idle、最后 stdout 或未认证 settled 均不触发成功 recovery。

取消先按 Cancellation Settlement v2 提交 Run/Turn/义务为 cancelled，再 best-effort `clear_queue`、`abort` 与有界
进程树回收；cleanup 不阻塞业务终态。可能已接受的 Input/Action 保持 unknown audit且禁止重发；迟到 text/tool/final/
receipt 由 epoch/binding fence 丢弃，旧新 execution 不得重叠。

Usage 只从当前 Prompt 的 terminal assistant `message_end.message.usage` 产生
`source=runtime_event / scope=model_call / counterMode=delta / inputSemantics=exclusive_buckets` observation，并绑定
native session、prompt 与 message digest 去重。input/output/cacheRead/cacheWrite 和结构化 provider-reported USD cost
按实际字段稀疏记录；缺失 reasoning、currency、cost 或未证明字段保持 NULL，不补零、不查价。`message_update`、
session stats、普通 ToolResult 或未成功 compaction usage 不进入当前 Pi Run metering。

## 7. 明确 unsupported 与准入

- Camp Fast：Pi 没有当前资格，配置 UI 隐藏且不会静默忽略值。
- Runtime Images：没有 verified structured image result，不从正文或 path 猜测。
- Web Search：没有 verified Pi-specific structured search event，不从 MCP 名、Tool text 或 query 猜测。
- Native sandbox/permission popup：上游明确不提供；由 Core-managed Approval 补齐产品安全语义。

这些差异不允许绕过平台资格。只有接入 Checklist 全轴和精确平台 Golden Flow 完成后，才可通过新的版本决定与
Pi-specific digest-bound artifact 把某一平台晋升为 `qualified`。

## References

- [v29](runtime-launch-and-verification-v29.md)
- [Runtime Platform Admission v1](runtime-platform-admission-v1.md)
- [Pi Parity Matrix](../research/pi-runtime-reintegration-parity-matrix.md)
- [v1.39 decisions](../versions/v1.39/decisions.md)
