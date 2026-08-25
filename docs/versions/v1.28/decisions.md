---
document_type: version-decisions
version: v1.28
lifecycle: historical
last_updated: 2026-08-24
---

# v1.28 决策记录

<a id="v1-28-d01"></a>
## V1.28-D01：Grok provider 采用官方 config.toml，密钥环境源归入原生 Home

### 背景

Grok Build 官方用户配置位于 `$GROK_HOME/config.toml`，自定义模型使用 `[models]`、`[model.<id>]` 或
`[model_providers.<id>]`，凭据可由 `api_key` 或 `env_key` 提供。此前 Rovai 自定义
`~/.config/rovai/grok-build.env` 三字段并翻译为 Grok 环境变量，虽然 BYOK 可运行，但不是 Grok 官方配置
schema，普通 Grok 用户不能直接复用模型配置。官方 CLI 接受进程环境变量但不自动读取 `.env`。

### 决定

正式 AgentRun 直接继承官方 `$GROK_HOME/config.toml`，不再定义或翻译 `GROK_MODEL_*` 私有 schema。
Rovai 额外把 mode `0600` 的 `$GROK_HOME/.env` 作为本机密钥环境源，只读取官方 TOML 中 `env_key` /
`env_http_headers` 明确引用的名称和 Grok 官方全局 API-key 名称，并只注入目标 Grok 子进程；未引用变量不注入。
官方 `api_key` 字段也保持可用。Core 不写或改写这些用户文件。

存在 BYOK 时 Probe 把 `config.toml`、`managed_config.toml` 与 `requirements.toml` 原样复制到一次性临时
`GROK_HOME`，密钥文件不复制、只经进程环境传递，并优先已广告的 `xai.api_key`；没有 BYOK 时 Probe 保留
原生 Grok Home，只选择已广告的安全非交互默认、`cached_token` 或 `xai.api_key`，不自动启动
`grok.com`/device auth。官方配置与 `.env` 的摘要进入 warm Host 和 cold HistoryRestore compatibility。

### 后果

普通 Grok CLI 与 Rovai 共用同一模型 schema；使用 `env_key` 时密钥只存在于权限收窄的原生 Home 文件与
目标子进程，配置变化会 fence 旧 Host/Session。用户原生 Grok 状态和既有 account token 保持可用。BYOK
已真实验收；当前机器没有 cached token，因此 account-auth 只具备实现与上游方法证据，不能冒充实测通过。

### 被拒绝方案

- 复用 Kimi env 文件或变量：会把两个 Adapter 的配置合同耦合；
- 保留 Rovai 三字段并只把文件挪到 `.grok`：路径正确但 schema 仍不具备 Grok 官方通用性；
- 由 Core 自动生成或覆盖 `config.toml`：会改变用户日常 Grok 行为；
- CLI 参数传 Key：会进入进程参数和诊断面。

<a id="v1-28-d02"></a>
## V1.28-D02：ACP agent text 不做 provider 清洗，平台资格按 Grok adapter-scoped 证据准入

### 背景

真实 Kimi/Grok ACP Probe 显示 MiniMax 可能把带 `<think>` 标签的内容作为普通
`agent_message_chunk` 返回。仅凭 provider 与文本标签把该标准 ACP agent text 改写成私有推理，会产生
Runtime 特例、丢失上游证据，并让执行台与实际 wire 不一致。平台上，已有 macOS/Windows 聚合证据均早于
Grok identity，不能自动覆盖新 Adapter。

### 决定

Kimi 与 Grok 不再识别、删除、重分类或压制 provider 文本中的 `<think>` 块。两者与其他 ACP Runtime 一样，
把 `agent_message_chunk` 原样投影为 `agent.text.delta` / Runtime Evidence；terminal final 与 Missing-Send
candidate 只使用通用 whitespace trim。若上游发送 thinking text，执行台和最终公开候选都如实保留。
`_x.ai/*` vendor notification 仍只作 metadata/lifecycle，不冒充 agent text。

`grok-build × macos-arm64` 仅绑定本版本独立 evidence digest；macOS x64 与 Windows x64 保持
`not_qualified`。Usage/Cost 在语义未验证前保持 Disabled。本决定同时取代 v1.27 冻结时的 Kimi
provider-specific sanitizer 当前边界，但不改写历史验收事实。

### 后果

执行台可检查 Runtime 实际返回的完整 agent text；如果 provider 把 reasoning 标签混入普通文本，Camp final
或 Missing-Send publication 也可能包含它。Rovai 不替 provider 猜测哪部分可公开。新增平台需要独立完成
同级资格，不能借用共享进程基础设施或其他 Runtime 结果。

### 被拒绝方案

- terminal fail-closed sanitizer：会静默丢弃或改写 Runtime 声明为 agent text 的内容；
- 按 `<think>` 重分类为 thought：仍是 MiniMax 专用协议推断，不是 ACP 事实；
- 压制 Kimi/Grok assistant chunk、只在 terminal 发布：会造成执行台与其他 ACP Runtime 不一致；
- 复用旧 macOS/Windows aggregate digest：其证据没有 Grok 行为样本。

<a id="v1-28-d03"></a>
## V1.28-D03：Grok External MCP 使用私有进程 Plugin 追加，原生同名优先

### 背景

Grok 的 ACP schema 接受 Session `mcpServers` 字段，但 `grok 0.2.118` 的真实产品链路会忽略该字段。原生
project/user config 会修改用户状态且没有逐 Run 回收边界。该版本同时广告并实测了 process-level
`--plugin-dir`，Plugin 内 `.mcp.json` 可以在不写用户目录的前提下加载 stdio/HTTP Server。

### 决定

`grok-build` 声明 `AdditivePerRun / NativeWinsSkip`。Core 在权限为 `0700/0600` 的私有 Runtime 目录生成临时
Plugin，以 `--plugin-dir` 启动专属 `--no-leader` Host；Host compatibility 绑定完整 MCP 集合，RAII 与 Host
cleanup 删除 Plugin。启动前 `grok inspect --json` 返回的全部已发现名称都保留给 native，包括 disabled 或
untrusted 定义，因为 Grok 的同名合并先于 trust/enable gate；冲突 Assignment 显式 `skipped_native_name_conflict`。

### 后果

不同名 Rovai Server 可与两个原生 Server 同时启动并由 MiniMax-M3 真实调用；ContextManifest 如实记录两个
冲突 skip 和一个 ready。代价是 MCP 集合变化会得到不兼容 Host，且同名时 Rovai 不覆盖原生定义。

### 被拒绝方案

- 继续使用 ACP Session `mcpServers`：真实 Runtime 静默忽略；
- 写入 `.grok/config.toml` 或用户 `$GROK_HOME/config.toml`：污染用户状态且生命周期超过单次 Run；
- RovaiWins：Grok 在 trust/enable gate 前按名称合并，覆盖会使 native 配置语义不可预测。

<a id="v1-28-d04"></a>
## V1.28-D04：load-only cold continuation 复用 TRAE HistoryRestore，不冒充 Resume

### 背景

`grok 0.2.118` 广告 `agentCapabilities.loadSession=true`，但不广告 ACP `sessionCapabilities.resume`，直接调用
`session/resume` 返回 Method not found。新进程用相同原生 Home 和 exact Session ID 调用 `session/load` 时会
回放历史 user/assistant/vendor 事件；如果普通路由接收这些事件，会污染当前 Run。

### 决定

Grok continuation 顺序为 compatible same-host Session → 未来真实广告并取证的 resume → exact
`session/load` HistoryRestore → new Session。HistoryRestore 复用 TRAE 的 LoadingReplay quarantine、response
后 bounded quiet window、exact returned-ID check 和一次性 continuity-lost fallback；兼容 key 绑定安装、协议、
可执行 fingerprint、Host config、canonical workspace/access/isolation、模型、权限与 Grok 官方配置摘要。

### 后果

真实 Core/Host 重启后保持同一 Session ID 并找回 session marker；17 条 replay event 没有生成额外公开正文、Action、
Approval 或 Missing-Send。恢复后的 Tool/Approval 与 cancel 正常；错误 ID 只记录一次 continuity-lost 并建立一个
新 Session。产品和报告必须写 `HistoryRestore`，不能写 native/session resume。

### 被拒绝方案

- 把 `loadSession` 当 `resume`：混淆协议能力并遗漏 replay quarantine；
- 解析“最近 Session”或私有数据库：不是 exact ID，且扩大用户状态读取面；
- load 失败后反复重试：可能重复输入或副作用，只允许一次受控 fresh fallback。

<a id="v1-28-d05"></a>
## V1.28-D05：Grok Bootstrap 使用原生追加 rules，结构化 completion 驱动既有 Redelivery

### 背景

Grok `0.2.118` 的 `session/new._meta.rules` 会把字符串追加进 Runtime 内建 system prompt 的
`<human_rules>`，而 `systemPromptOverride` 会替换整个上游 system prompt。真实 no-leader wire 同时提供
`_x.ai/session_notification`：auto compaction 完成态带 exact Session ID、非空 `_meta.eventId` 与
`auto_compact_completed`。此前产品仍把 Bootstrap 放在首轮 user payload，并把 Grok detector 保持 Disabled。

### 决定

按开发者明确确认的[模型上下文变更 revision 2](model-context-change-grok-native-rules.md)，继续由既有
Formatter 3 生成完全相同的 `SESSION_CHARTER + MEMBER_IDENTITY + MEMORY_ENTRYPOINT` bytes。只有创建新 Grok
Native Session 时，把完整 payload 原样放入 `session/new._meta.rules`；首轮和后继 `session/prompt` 只发送
Dynamic Context。禁止使用 `systemPromptOverride`，same-host reuse 与 exact-ID `session/load` 不重复注入，load
失败后的 replacement Session 对新 Binding/generation 注入一次。

Grok compaction policy 为 `best_effort`。只准入无 JSON-RPC request ID 的
`_x.ai/session_notification`，且 Session ID 命中 active Observer Lease、update 为
`auto_compact_completed`、`tokens_after` 是非负整数、event ID 为非空字符串并且不是 replay。event ID 是 Runtime
occurrence identity；started、failed、cancelled、nested envelope、未知 shape、文本或 token-drop heuristic 全部
忽略。合格 completion 不打断 Grok 当前内部 compact-and-resubmit，只推进 durable requested revision；下一次
尚未 prepared 的 Core 输入使用既有 Redelivery Envelope/Formatter v2，并在 accepted ACK 后确认 revision。

Migration 108 只扩展三个 Adapter closed set，Data Contract 为 v1.22/schema 63。Grok Binding compatibility
加入 native-rules revision 1；旧 `first_payload` Binding 不兼容。其他 Runtime 的 delivery mode、detector policy
与模型输入全部不变。

### 后果

Bootstrap 获得 Grok 原生 system-level 权限层级，同时不覆盖 Runtime 自带工具、权限与 agent prompt。真实强制
压缩产品 smoke 捕获结构化 completion，revision 1 在下一轮同 Session/warm Host 输入中恰好一次 accepted，
requested 与 acknowledged 均收敛为 1。detector 丢失仍不阻断 Readiness 或 AgentRun；Usage/Cost 保持 Disabled。

### 被拒绝方案

- 继续首轮 user prompt 注入：权限层级低于 Grok 已验证的原生追加通道；
- `systemPromptOverride`：会替换上游 system prompt，不满足追加语义；
- load 时重发 rules：Grok 只在创建时折叠 rules，且 exact load 已保留原规则；
- 在 completion 回调中立即插入 prompt：会与 Runtime 内部重采样竞态；
- 根据 token、summary 或 assistant 文本猜测压缩：没有稳定 occurrence identity，无法幂等准入。
