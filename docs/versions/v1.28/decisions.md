---
document_type: version-decisions
version: v1.28
lifecycle: current
last_updated: 2026-08-25
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
`grok.com`/device auth。官方配置与 `.env` 的摘要进入 warm Host 和 Native Session resume compatibility。

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

`grok-build × macos-arm64`、`grok-build × macos-x64` 与 `grok-build × windows-x64` 分别绑定本版本各自独立的
evidence digest。Usage/Cost 在语义未验证前保持 Disabled。本决定同时取代 v1.27 冻结时的 Kimi
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
## V1.28-D04：load-only cold continuation 复用 TRAE HistoryRestore，不冒充 Resume（已由 D06 替代）

本节保存 `0.2.118` 接入时的真实取舍；`grok >= 1.0.0` 的当前产品 continuation 已由
[V1.28-D06](#v1-28-d06) clean break 替代。TRAE 与其他 Runtime 的 HistoryRestore 结论不受影响。

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
Dynamic Context。禁止使用 `systemPromptOverride`，same-host reuse 与 exact-ID `session/resume` 不重复注入，resume
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
- resume 时重发 rules：Grok 把 rules 定义为 creation-only，恢复保留原 Session 的 system prompt；
- 在 completion 回调中立即插入 prompt：会与 Runtime 内部重采样竞态；
- 根据 token、summary 或 assistant 文本猜测压缩：没有稳定 occurrence identity，无法幂等准入。

<a id="v1-28-d06"></a>
## V1.28-D06：Grok `>= 1.0.0` 只使用标准 ACP resume，删除 load-only fallback

### 背景

初始接入冻结在 `grok 0.2.118`，只能使用 `session/load`。Grok `1.0.0` 已正式在
`initialize.agentCapabilities.sessionCapabilities.resume` 广告标准 ACP resume。继续同时支持旧版 load-only
路径会保留两套 Grok cold continuation、HistoryRestore replay 语义和两种兼容 key，并让 Ready 文案与实际
Provider 能力继续分叉。

### 决定

三个宿主平台共用 `grok >= 1.0.0` 最低版本合同；light discovery 对更低或不可解析版本返回
`light_failed / runtime_version_below_minimum`，Deep Probe 与 machine Ready 必须观察 resume capability 对象，并对
刚创建的 exact Session ID 成功调用一次 `session/resume`，不得只信广告。
Grok continuation 固定为 compatible same-host Session → exact `session/resume` → continuity-lost 后一次 replacement
`session/new`。Grok 不再声明或选择 `session.load` 产品能力，也不保留 `0.2.118` fallback；其他 Runtime 的通用
load/HistoryRestore 实现不变。新 Session 继续携带两个 additional roots；Grok Resume 固定使用
`additionalDirectories=[]`，不得尝试更新 creation-time roots。

Bootstrap 内容和创建期投递不变：只有 `session/new._meta.rules` 携带 Rovai Bootstrap；resume 不重新提供 rules，
由 Grok 恢复原 Session 已冻结的 system prompt。Grok Native Session compatibility key 切换为
`grok-build:resume-v1`，继续绑定 installation、protocol、executable fingerprint、Host config、workspace、模型、
权限、官方配置摘要和 native-rules revision。任一输入或 rules generation 改变都建立新 Binding/Session。

### 后果

低于 `1.0.0` 的既有安装即使曾保存 Ready snapshot，也会在解析/dispatch 时要求重新 Probe 并被版本门拒绝。
Grok cold continuation 与其他支持 ACP resume 的 Runtime 使用同一方法和 exact Session ID 规则；TRAE 等仍可独立
使用其 load-only HistoryRestore。macOS arm64/x64 与 Windows x64 已分别完成目标主机取证；版本门共享不代表
平台验证可以互相外推。

### 被拒绝方案

- 保留 `0.2.118` load fallback：会让已正式具备 resume 的当前合同继续承担旧双路径复杂度；
- resume 时重新注入 rules：违反 creation-only 语义，也可能在恢复 Session 中重复 system prompt；
- 删除通用 `session/load`：会破坏 TRAE、Kimi 等仍使用的既有 fallback；
- 用一个平台的 `1.0.0` 结果直接准入另外两个平台：混淆共享版本合同与 adapter-scoped 平台证据。

<a id="v1-28-d07"></a>
## V1.28-D07：macOS Runtime Files identity 使用稳定卷 UUID，旧 marker 只在私有实例根内 rekey

### 背景

macOS 的 Runtime Files Root marker、SQLite View receipt 与 Entry physical identity 曾直接包含 Unix `st_dev`。
本机重启实证显示，同一路径、inode、owner 与内容均未变化时，APFS mount assignment 仍会使 `st_dev` 改变，导致
Core 在打开 SQLite 前误报 `root marker identity mismatch` 并退出。数据库 quick check 与 Data Contract 均正常；
继续降级数据库既不能修复文件系统身份算法，也会再次丢弃新版本投影。

### 决定

macOS marker schema 升为 2。root 与 Entry 的持久 physical identity 使用 canonical path digest、inode、owner 和
Darwin `getattrlist(ATTR_VOL_UUID)` 返回的稳定本地卷 UUID；`st_dev` 只保留为非持久诊断事实，不进入 digest。
卷 UUID 改变、inode/owner/path 改变或 schema-2 marker digest 不匹配仍 fail closed。View contract、Runtime auth
receipt schema 与 Data Contract 不变；新的 root digest 会自然 fence 旧物理 receipt 和当前 Core generation。

schema-1 marker 的一次性兼容只在 Core 已证明 macOS deterministic instance path、当前用户 ownership、本地
filesystem、无 symlink/nested marker 并取得独占 root lock 后发生。由于 View 是可从 SQLite/Authority 重建的
派生物，旧 digest 可在该边界内原子 rekey；Database 随后以新 root identity 完整验证每个 Camp，并把旧 physical
receipt 作为 integrity incident 受控重建。unmarked 非空 root、instance/platform 不匹配、未知 schema 与 schema-2
identity mismatch 不进入该入口。

### 后果

同一 APFS 卷在重启后保持 root/Entry identity，App 不再因 boot-local device number 漂移退出。首次从 schema 1
升级可能对已有 Published Attachment View 做一次受控重建并推进 physical generation，但不修改公共消息、
Authority Attachment、semantic catalog、历史 Context bytes 或 Data Contract。重建失败保持 fail closed，原
Authority 与审计数据不被删除。

### 被拒绝方案

- 继续持久化 `st_dev`：同一目录跨重启不稳定，会重复制造启动故障与无意义 rebuild；
- 只删除 device 而不绑定卷：弱化了卷替换检测；
- 对 schema-2 mismatch 也自动 rekey：会把真正的目录替换伪装成兼容迁移；
- 再次降级 SQLite 或删除 Runtime Files Root：前者与根因无关，后者丢失诊断证据且绕过受控重建。

<a id="v1-28-d08"></a>
## V1.28-D08：startup rebuild failure 按已收敛的 Camp fail closed，不扩大为全局 Core 退出

### 背景

schema-1 marker rekey 后，Core 会按新稳定 root identity 重建旧 physical View receipt。真实日常库中有一个历史
`message_attachment` 仍保留完整公共语义与审计记录，但其 Authority 目录在本次升级前已不存在。该 Camp 的
controlled rebuild 正确失败并 rollback，旧实现却把这个已收敛的 Camp-local integrity failure 继续上抛为全局
startup failure，导致所有无关 Camp 都无法使用。降级数据库、删除附件行或把派生 View 反向提升为 Authority 都会
破坏现有权威边界。

### 决定

startup 仍逐 Camp 完整 reconciliation。单个 Camp 失败后，Core 只在数据库再次证明以下全部条件时隔离该错误：

- View 已持久化为 `integrity_failed`，有稳定 `last_error_code` 且 `active_operation_id IS NULL`；
- 该 Camp 没有 `completed/rolled_back` 之外的 operation，说明 copy/promote/rollback journal 已完全收敛；
- 数据库本身仍可读取这些闭合事实。

满足条件时，该 Camp 继续拒绝 Context freeze、Runtime authorization、launch/resume/dispatch；Core 记录不含 Authority
locator 的私有启动诊断，并继续 reconciliation 其他 Camp。`message_attachment` 的 available 语义、公共消息、历史
receipt、Authority locator 与审计行全部保留，不把缺失来源伪装成 terminal publication failure。root admission、未知
orphan、数据库错误、缺少 View receipt、仍有 active/nonterminal operation 或不能证明 rollback 完整的错误继续阻断
Core startup。

### 后果

一个历史 Camp 的 Authority 丢失不再使整个 App 退出；该 Camp 仍诚实显示为不可供 Runtime 使用，并可在 Authority
恢复后的下一次 startup 自动重试 controlled rebuild。每次 startup 最多为该 Camp 追加一个已 rolled-back 的恢复
operation，不会自动删除、改写或恢复业务数据。没有 Data Contract、View receipt wire、错误 closed set、Runtime
compatibility 或 Renderer API 变化。

### 被拒绝方案

- 继续全局退出：把已持久化且无悬挂 operation 的 Camp-local failure 扩大到所有 Camp；
- 把 `available` 直接改成 `failed`：会事后改写已提交的语义 ledger 与历史 receipt；
- 从残留 Runtime View 反向恢复 Authority：派生只读副本不是业务 Authority，且当前实例中该副本也可能已损坏；
- 忽略任意 reconciliation 错误：会掩盖 root compromise、数据库错误或未收敛 journal。

<a id="v1-28-d09"></a>
## V1.28-D09：零附件 Camp 的 controlled rebuild 允许空 completion，并提交当前 root receipt

### 背景

root marker rekey 会使每个旧 View 的 root receipt 需要受控重建，包括 Desired/Actual 都为空的零附件 Camp。现有
rebuild pipeline 能建立空目录、提交空 catalog 并推进 generation，却复用了普通 publication completion 的“至少一条
operation entry”前提，因而把已经 committed 的合法空 rebuild 转成 `recovery_required`。同时 View commit 没有写回
当前 root identity，使非空健康 rebuild 在完成校验时也会继续看到旧 receipt。

### 决定

只有 `kind = controlled_rebuild` 的 committed operation 可以在零 operation entries 时进入 completion；普通 publish 与
initial backfill 继续拒绝空 committed operation。空 rebuild 仍必须通过完整 ready View 校验：Desired、View receipts 和
filesystem entries 都为空，root-relative path、root identity、catalog/semantic/resolution receipt 与目录权限全部一致。

每次 controlled rebuild 的原子 View commit 除原有 generation、catalog 与 Entry identity 外，必须从当前已准入 Database
connection 写回 `rovai_runtime_camp_files_root_identity_digest()`。completion 验证通过后 operation 才成为 `completed`；
任何非空漂移、错误 kind、非法目录或 receipt mismatch 仍进入既有 integrity failure 路径。

### 后果

零附件 Camp 在 schema-1 rekey 后可以不制造 synthetic Entry 地收敛为 Ready；健康非空 Camp 也会把新 root identity 与
新的 Entry physical identities 一起提交。该修复不改变 Desired 定义、semantic catalog、View receipt wire、Data Contract
或 Runtime compatibility，只补齐 controlled rebuild 已有的空集与 physical receipt 语义。

### 被拒绝方案

- 为零附件 Camp 插入 synthetic Entry：污染 Runtime-visible catalog 与 semantic receipt；
- 对所有 operation 删除非空检查：会让非法空 publish 伪装成已完成；
- completion 时忽略旧 root digest：会绕过当前实例身份 fence；
- 手工修改日常 View 行：缺少可复用 journal、测试和后续机器的确定性恢复路径。

<a id="v1-28-d10"></a>
## V1.28-D10：已成功发布附件的当前完整性故障只降级附件，不阻断 Camp

### 背景

D08 先把旧二进制触发的 root rekey 与 Authority 缺失故障从全局 Core 退出收窄到单个 Camp fail closed，但该
Camp 仍无法运行。真实故障表明 `message_attachment`、公共消息、成功 publication ledger 与审计记录都完整，只有
一个派生 View entry 的 digest 校验失败且对应 Authority payload 已缺失。把“曾经成功发布”与“现在仍能为新
Runtime 提供字节”当成同一个布尔值，使一个附件故障不必要地拒绝整个 Camp，也让无附件依赖的后续消息无法执行。

### 决定

成功 publication resolution 与当前 Runtime availability 分轴。成功 resolution、semantic revision、历史 receipt、
CampMessage 和审计事实不可逆；当前 `runtime_projection_state` 可在后续完整性事件中从 `available` 变为
`recovery_required`。只有 operation 仍 unresolved 的 `pending | recovery_required` 是 writer intent 并继续阻断
调度；已成功 resolved operation 上的 `recovery_required` 只表示该附件当前没有 Runtime path。

startup 与 pre-dispatch reconciliation 逐项用原 kind、byte size、digest 和 no-follow tree receipt 验证 Authority。
健康项照常重建；缺失或不一致项只把自身改为 `recovery_required`，从 physical View、Published Attachment Path、
新 Context current/history attachment refs 中省略。受控重建验证剩余 catalog 后把 Camp 提交为 `ready`，记录私有
`camp_attachment_integrity_degraded` 诊断。Scheduler 在 Claim 前完成该校验/修复，成功 authorization 与同一 read
admission 覆盖 Claim 和整个 Run。

后续只有 exact Authority 再次通过原 receipt 时才能把附件恢复为 `available` 并受控重建原稳定 path；派生 View
从不反向修复 Authority。root marker/identity、未知节点、symlink/reparse、containment、数据库错误、未收敛 journal
或无法安全替换 View 的故障仍 fail closed。本决定以附件局部可用性规则替代 D08 中“Authority 缺失必然使整个 Camp
继续拒绝 Runtime”的条款；D08 的跨 Camp 隔离与全局安全边界继续有效。

### 后果

一个坏附件不会再使 Camp、其他附件或无附件后续消息失效。模型不会收到坏附件的 stale path 或未验证字节；用户
公共历史与审计也不会因修复被删除或伪造 terminal failure。语义 catalog 可以大于当前 physical catalog，因此
`CampAttachmentViewReceiptV2` 历史语义仍有效，而新授权只包含当前 `available` 项。View contract 升到 v4 并 fence
旧 Host；receipt wire、Runtime Auth Receipt、Data Contract 和 Renderer API 不变。

### 被拒绝方案

- 忽略 digest 并继续暴露现有 View bytes：会把未验证内容交给 Runtime；
- 继续拒绝整个 Camp：把附件级可用性故障扩大为协作与执行故障；
- 删除 `message_attachment` 或把成功 publication 改成 `failed`：会重写公共历史、ledger 与审计事实；
- 从残留 View 复制回 Authority：颠倒 Authority/派生关系，且可能固化已损坏字节；
- 对所有路径/根错误都局部降级：会掩盖 containment 或实例身份破坏。

<a id="v1-28-d11"></a>
## V1.28-D11：Windows Runtime discovery 冻结 `.exe/.cmd/.bat` closed set 与 Registry PATH hydration

### 背景

Windows 官方 Codex installer 将 binary 安装到 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` 并只为后续进程更新
User PATH；npm/pnpm 的常见入口则是 `codex.cmd`。Desktop 已启动后仅复用 inherited PATH、Discovery 只接受
`.exe`，会让其他新开的工具可找到 Codex 而 Agent Runtime rescan 仍显示 Missing。另一方面，直接扩大 PATHEXT 或
把任意脚本伪装成 executable 会破坏 executable identity、argv 安全与 Job ownership。

### 决定

Windows 每次 Runtime Search Environment capture/rescan 只读读取 HKCU User PATH 与 HKLM Machine PATH，在当前
环境变量快照下展开 `REG_SZ/REG_EXPAND_SZ`，过滤空、相对、未展开与不存在目录，并按 inherited、HKCU、HKLM、
known locations 稳定、大小写不敏感去重。该 PATH 快照显式进入 discovery、version/deep/health Probe、AgentRun 与
Runtime 子命令，不修改 Registry 或 Core 全局环境。Codex installer 默认目录继续作为 known-location fallback。

entrypoint closed set 固定为 `.exe/.cmd/.bat`，同目录按该顺序；`.ps1/.com` 与 PowerShell fallback 不开放。手动绝对
路径和 Adapter override 各自是 terminal candidate set，错误或 Probe 失败不回退自动 PATH。已知 Codex npm/pnpm
`.cmd` 只能在有界、exact-template、package containment 与 metadata 校验全部通过后解析到 platform package 的真实
`codex.exe`，正式 path、fingerprint、Probe 与 launch 均绑定 native target。不能验证为 native target 的 bounded
`.cmd` 与 `.bat` 保持 `windows_command_shim` identity。

`windows_command_shim` 只通过 Managed Runtime Process 启动：固定 canonical System32 `cmd.exe` 为
`lpApplicationName`，使用 `/e:on /v:off /d /c` 与 Core-owned batch serializer，拒绝 raw command fragment 和
NUL/CR/LF。compatibility composite fingerprint 覆盖 shim kind、canonical path、content digest、interpreter path
及 fingerprint；CreateProcess 前在打开 identity 下复核。已解析为 native target 的 Codex shim 另存不公开的 durable
locator identity，覆盖 shim path/content、interpreter path/fingerprint、resolved target path/fingerprint；其 composite
digest 进入 Installation generation、snapshot Session key 与 Host compatibility，因此只改 shim 也会撤销旧 Ready 并
重新 Deep Probe。现有原子 Job-list、stdio handle list、cancel、timeout 与 cleanup 不变。诊断只新增 source、
entrypoint kind、candidate extension、native target resolution 与 version Probe 结果，并继续经过既有路径脱敏。

### 后果

Desktop 无需重启即可发现 installer 写入 User/Machine PATH 的 Runtime；npm/pnpm Codex 优先绕过 Node wrapper并获得
native identity；只有 `.bat` 或通用 `.cmd` 的 Runtime 也能被明确发现、Probe 和正式运行。shim 内容、native target、
interpreter、PATH winner 或 reported version 变化都会触发新 Probe/Host compatibility。batch 脚本内部若再次使用
`%*` 或自定义变量展开，其二次解析语义仍属于脚本，不由 Core 伪装成 native argv 保证；generic shim argv 中无法
普遍无损表示的字面引号、`%` 与末尾反斜杠会在 CreateProcess 前 fail closed，因此 prompt 继续只经 stdin。

### 被拒绝方案

- 只增加 Codex known location：仍无法解决 Rovai 启动后新增 User/Machine PATH 与其他 Runtime；
- 直接按 PATHEXT 启动 `.cmd/.bat/.ps1`：扩大解释器面且丢失真实 entrypoint identity；
- 使用 `cmd.exe /c` 字符串拼接：允许 metacharacter 注入、AutoRun 改义与不可验证 argv；
- 对 npm shim 执行后观察 child 来猜 target：执行了未验证脚本，也可能把任意 executable 误绑定为 Codex；
- 显式路径失败后继续 PATH：把用户选择静默替换成另一安装，破坏 fail-closed 语义。
