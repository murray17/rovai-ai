---
document_type: architecture
architecture: runtime-catalog-boundaries
authority: runtime-catalog-and-preview-boundaries
status: accepted
last_updated: 2026-08-25
---

# Runtime Catalog Boundaries

本文件定义 Runtime 名称出现在产品中时的权威分层。Catalog、Installation 与机器状态的长期边界见
[Runtime Catalog 与 Installation 不变量](foundational-invariants.md#runtime-catalog-installation)。主机平台准入由
[Runtime 平台安全不变量](foundational-invariants.md#runtime-platform-security)与
[Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)拥有；Runtime 启动与延迟验证边界见
[Runtime 进程与校验不变量](foundational-invariants.md#runtime-process-verification)、
[Runtime 恢复与关闭不变量](foundational-invariants.md#runtime-recovery-shutdown)及
[Runtime Launch and Verification v27](../contracts/runtime-launch-and-verification-v27.md)。实测版本和能力只由
[Runtime 兼容性清单](../runtime-compatibility.md)记录。

## 四层权威

| 层 | 真源 | 可以驱动 | 不能驱动 |
| --- | --- | --- | --- |
| Product Runtime Catalog | closed `AdapterKind` 与 Rust `AgentRuntimeAdapter` Registry | 全局产品身份与 Adapter interface | 某个平台已验证、机器状态、未接入候选或 roadmap |
| Runtime Platform Admission | Rust Adapter Registry 的 `AdapterKind × HostPlatformKey` 矩阵 | 某平台上的 discovery/check/Installation、成员选择、AgentRun、诊断与 Migration 准入 | 当前机器是否安装/登录/Ready、Renderer roadmap |
| Product Runtime Availability | Core 对某一 Product Runtime 的 discovery、静态身份或 deep-verification snapshot | light ready、checking、legacy installed unverified、ready、needs login、not installed、incompatible、transient failure 等当前机器状态 | 新产品身份、把静态可尝试误作深检 Ready 或静默 Runtime fallback |
| Settings Runtime Preview Catalog | Renderer 内受审查的静态 presentation rows | Runtime 设置页中的名称、图标、`待支持`文案和 disabled 状态 | Contracts、Core request、数据库、成员选择、诊断、Probe、AgentRun 或支持数量 |

Product Runtime Catalog 当前 closed set 包含十四种已实现 Adapter。Preview 与它不是“同一目录的另一种状态”；
Renderer 只在绘制 Runtime 设置列表时组合两种 row。产品目录的机器可判数量、全量检查、诊断分母和
普通执行仍只来自逐平台 Admission。Cursor 虽保留 closed identity 和历史 reader，但未完成产品资格前不进入
Settings Runtime Preview Catalog；隐藏该 row 不删除持久 identity，也不改变未准入状态。普通成员 Runtime
selector 同样不展示 Cursor；其他成员选项来自 `AdapterKind`，并在当前主机上继续经过 Runtime Platform Admission。

`qualified` 是进入 Product Runtime Availability 的前置条件；`not_qualified` 按目标平台显示“Windows 尚未验证”或“当前平台尚未验证”，
`unsupported` 显示平台不支持。两者都不产生 discovery、Installation、Probe 或普通机器状态。既有未准入配置
可以原样读取并在修改无关队员字段时原样保留，但不能修改 Runtime 子对象、重新保存默认值或执行。

## 可执行准入

新增 Product Runtime 必须原子建立：

1. 稳定 wire identity、可执行发现和 Installation/Migration closed kind；
2. 由统一 purpose-scoped launch policy 管理深检，并对协议、认证、必需 capability 与 transient failure 诚实分类；
3. 冻结模型、权限、Session、MCP、cwd 和进程策略的 AgentRun Adapter；
4. prompt 终态、cancel、Action/Approval、Tool ID、Runtime Activity 与兼容性证据；
5. 成员配置、Runtime 设置、诊断、测试与文档投影。

图标、版本输出、`initialize` 成功或 Settings Preview 都不能单独满足准入。

Catalog admission 与平台 qualification 是独立轴。`cursor-agent` 已具备稳定 identity、Adapter、Migration、
ACP launch、保守配置与 Renderer projection，因此属于 Product Runtime Catalog；但 macOS arm64、macOS x64
与 Windows x64 都尚无完整行为 Smoke，当前三行均为 `not_qualified`。这不会把 Preview 升级为 Adapter，
也不会让未准入 Catalog row 获得 discovery、Installation、配置或执行语义。

每个 shipped `HostPlatformKey` 还必须逐 Adapter 完成 discovery、identity、auth、first run、Session
continuation、Built-in Tool、Approval、cancel、terminal、process cleanup 与 planned shutdown 证据。三种进程形态
的公共测试只证明平台基础设施，不能替代逐 Adapter 准入。`reasonCode` 是关闭枚举，qualified evidence 使用
不可变 digest-bound revision；TypeScript 不维护第二份矩阵。

## 浅检测与按需深检

只有平台准入为 `qualified` 的 Adapter 才参加 Core 启动和 Runtime 重扫。它们只建立 executable path、权限、metadata/fingerprint 与 Adapter 声明为无副作用的
有界 one-shot 身份证据。所有 Runtime 都只有在命令成功、输出未超限且识别到基础版本/身份时才写入 `light_ready`；
`found_uninspected` 既不是 light-ready，也不是 checking。`light_ready` 可以驱动成员 Runtime-default 配置和
“可用”主状态，但只表示 executable 已通过轻度启动验证、可选择和尝试运行。认证、协议、模型、Session 与
capability 仍要求用户显式检查或首次真实 AgentRun 的深检。

发现结束、页面进入和成员选择不排队深检；模型 Picker 按 60 秒/24 小时策略请求刷新。fingerprint 变化只替换
当前静态快照并立即使旧 Ready 失效；旧 capabilities、认证、动态 permission 与 Session compatibility 不迁移。
Runtime Check Manager 以内部 attempt identity、总 deadline、每 Runtime 单飞和全局并发二统一收口 success、
stable failure、superseded、timeout、JoinError、abort 与 shutdown；短生命周期 Runtime 子进程统一使用受限输出
和整进程树 cleanup。

Managed Runtime resolution 不在 Adapter Deep Probe 外重复执行 version gate；Adapter 自己的 version、认证、
capability、协议和模型检查共同构成一轮完整 Probe。每轮 Probe 前后复核同一 executable 的轻量 file identity；
开始可读而结束变化或无法复核时，无论 Probe 成功、直接错误还是 cleanup timeout，本轮都被 Runtime 更新
supersede。首次发生时在原 attempt/deadline 内重新解析 path、canonicalize、计算当前 SHA 并最多重试一次；
第二次仍变化则 deferred，不提交 snapshot、failure、diagnostic，也不唤醒等待执行。Execution 触发的 deferred
只建立三秒进程内冷却；冷却期 Scheduler 不启动新 Probe，过期后的下一次 tick 自动获得新的有界 attempt，
不要求打开 Picker、手动检查或重启 App。

### Machine Ready 与 Adapter 行为证据

机器 Ready 只回答“当前 canonical executable/fingerprint 是否能用当前结构化协议建立可配置 Session”。
Availability Check 与 Dispatch Preflight 必须共享同一 Adapter-specific requirements、evidence builder 与 persisted
snapshot validator；任一入口写入的 `ready` 必须正好可被 Scheduler 接受。若 requirements 变化，旧 snapshot
先降级，不能因数据库已有较弱 `ready` 而跳过 Dispatch Preflight。

TRAE 的统一 Machine Ready 精确定义为：非空 version、当前 executable identity/fingerprint、ACP v1
`initialize`、成功 `session/new` 与非空 Session ID、非空动态 model catalog、非空 permission/mode catalog，以及
current model/mode 均存在于相应 options 的 coherent Session config shape。成功结构化 handshake 产生
authenticated 分类；不发送模型 Prompt、system marker、文件写入/拒绝、sleep/cancel、Tool side effect 或
`session/set_config_option`。这些行为可以形成 Adapter/version/platform qualification evidence，但不成为每台机器
或每次 Dispatch 的 Ready 前置条件。

### Runtime advertised catalog 与 managed Skill delivery

ACP `available_commands_update` 属于 Session 建立后的动态 Runtime catalog；它可以在 Idle Session 合法到达，
不得进入当前 Prompt output，也不能因“没有 Active Prompt”标记协议违规。Host 对已知 config/mode/session-info/
usage metadata 与 lifecycle extension 使用同一 SessionMetadata 路由，未知 Idle shape 继续 fail closed。

Runtime advertised command、Runtime Skill discovery/load 与 Rovai managed Skill delivery 是三套证据。TRAE
`0.120.52` 已实测把内建 Slash Commands 和已加载 Skills 一起投影为 `availableCommands[]`；这只证明 Runtime
catalog。Rovai 只有在唯一内容的项目 Skill 同时通过新 Session advertisement 与真实调用、且 ownership/cleanup
边界明确时才建立 delivery group。当前 managed TRAE group 只写项目 `.trae/skills`；Runtime 兼容扫描到的
`.agents/skills`、`.traecli/skills` 或用户目录不因此成为 Rovai-owned 投影目标。

## 模型目录缓存与执行事实

模型目录是 Product Runtime Availability snapshot 的一部分，但其配置体验与执行事实分离。只有 deep probe
形成的 `ready` 成功 snapshot 才能创建或替换 catalog success；`light_ready`、`installed_unverified`、failed
attempt 或 synthetic runtime-default descriptor 不能自行制造动态目录。Core 从成功时间统一投影 `fresh`（60 秒内）、
`stale`（60 秒至 24 小时）、`expired`（24 小时及以上）、`unavailable` 与 `invalidated`，Renderer 不自行计算
TTL。

当前 executable fingerprint 改变时，旧 Deep Probe 不再构成当前 Runtime Ready evidence。发现事务可以只保留
旧成功 snapshot 的 models 与原 `lastSuccessfulProbeAt` 作为 stale LKG；即使原成功不足 60 秒也不能投影 fresh，
24 小时上限继续从原成功时间计算且不得刷新。LKG 只服务模型下拉，不证明新 binary 支持相同模型，不继承
capability/auth/permission/session evidence，也不能绕过当前 fingerprint 的 Dispatch Preflight。

切换队员 Runtime 只读取 Installation，不启动进程。打开模型 Picker 才进入 `runtime.modelCatalog.open` seam：
fresh 直接返回，stale 立即服务 last-known-good 并由 Check Manager 后台单飞刷新，其他状态等待一次用户动作
授权的 Availability Check。刷新失败只追加 failed Probe Attempt，保留成功 snapshot。Superseded 刷新不追加
attempt，等待式 Picker 返回 `deferred`；当前 fingerprint 尚未 Ready 时，未过期 LKG 继续以 stale 服务。只有
当前 Installation canonical path 自身的确定 fingerprint/identity 变化才可撤销当前 Ready；其他搜索候选的失败是
candidate-local transient attempt，不得修改当前 snapshot 的 `stale_at`。备用候选只有完整 deep probe 成功并
即将正式采用时，才能替换 Installation 并推进 generation。确定的安装或 capability identity 变化同样立即
失效。account/provider 变化只有 Adapter 提供稳定、非敏感 identity
evidence 时才自动比较，不能从凭据内容或错误文案猜测。

Picker catalog 只用于建立新的显式选择。既有已保存显式模型在目录暂不可用或 Provider 后续移除时保持原值，
并按当前证据显示尚未核对或目录未提供；不为人工修改或技术恢复的损坏数据提供兼容修复。真实 AgentRun
仍在 Host/Session 建立后核对当前目录，不存在或无法核对即 fail closed。`runtime_default` 不依赖 catalog，
内部 sentinel 只用于审计和冻结，Adapter 不向真实 Runtime 发送该 sentinel。

成员配置只拥有模型策略，不拥有某次 Run 的实际模型。使用 `runtime_default` 时，Core 只能从当前
Thread/Session 的 Runtime-native 结构化字段记录首个实际模型，并按 AgentRun execution epoch、default-only、
write-once 持久化；catalog default、请求模型、冻结 sentinel、Usage 或自由文本都不能补推。无观测时 Read
Model 继续表达“Agent 运行时默认”，不会把缺失升级为 Runtime failure；该事实也不反向改写配置或 catalog。

## 内部诊断与公开 Runtime failure

任一 Product Runtime 的真实执行失败，以及支持该边界的显式 Availability Check 失败时，Core 可以从 typed Runtime 证据形成
`RuntimeFailureView`。该对象只保存 Runtime identity、origin、phase、稳定 code、安全 summary/detail 与
retryable；完整 error chain、原始 stderr、私有日志、exit status、byte count 和 digest 仍属于内部诊断。
公开 detail 必须先脱敏、去控制字符并有界化，不能包含 Prompt、用户消息、Tool input 或完整 Tool output。

ACP matching Prompt error 至少保留安全数字 JSON-RPC error code 和有界 message；Prompt activity 与 matching
response 已证明输入 accepted 时，公开 failure 的 retryable 必须为 false，不能用 Provider 可重试分类覆盖 Core
的防重放门禁。原始 `error.data` 不进入公开投影。

`runtime` 只表示 Runtime/Provider 明确报错；协议、参数和输出格式问题是 `compatibility`，executable/cwd/
权限/附件目录问题是 `environment`，只有明确 Core 状态、持久化或配置生成证据才能是 `rovai`，否则为
`unknown`。Renderer 不重新分类，也不从内部 diagnostic code 或 digest 推断原因。

`AgentRunView.failure` 和 `ProductRuntimeAvailability.failure` 只投影该安全对象。显式检查可以持久化 Probe
Attempt failure；启动浅检测的瞬时 version failure 仍只用于内部发现，不升级为产品级 failure，也不覆盖
last-known-good。此增量不修改其他 Runtime 的执行路径或 Availability 状态集合。字段级合同见
[Runtime Launch and Verification v27](../contracts/runtime-launch-and-verification-v27.md)。

## TRAE CLI CN 当前边界

`trae-cn-cli` 通过既有 ACP v1 Host 启动 `traecli acp serve`。模型与 permission mode catalog 来自
每次真实 Session 返回；新队员默认使用已验证的 `bypass_permissions`，用户仍可改回 `default`。Session 恢复采用
有界 continuation：兼容 IdleWarm 命中时直接复用同一 Host 已持有的 Session；冷 Host 优先使用声明的
`session/resume`。本机 `0.120.52` 的 exact-ID Provider Resume 协议 Probe 不合格，因此当前下一层为
`session/load` HistoryRestore；所有 load replay 在当前 prompt 前进入独立 quarantine，失败才建立
`session/new`。禁止 `--resume AUTO`、私有 Session 文件解析和最近 Session 扫描。

TRAE 参加正常 light discovery：启动和显式 rescan 通过统一 Probe process owner 执行有界
`traecli --version`，成功持久化 `light_ready` 并在设置页显示“可用”，失败持久化 `light_failed`。轻检仍只
证明 executable identity，可以配置和尝试执行，不能声明登录、ACP、模型、权限或 Session Ready。

用户点击“检查可用性”授权 `AvailabilityCheck` 启动一次 TRAE ACP Host。Probe 使用保守
`permission_mode=default`，只执行版本、initialize 与 session/new，并要求动态模型/权限目录；它不发送 Prompt、
模型请求、工具或 Approval 行为测试。成功提交 Ready，随后的 discovery event 不重复静态落库覆盖该 Ready。
Installation Refresh、Health Probe 与 Dispatch Preflight 和其他 Runtime 一样可以启动有界 TRAE Probe；旧
`installed_unverified` 仍可读取，但不能配置或执行。

成员可以在 `light_ready` 下原子保存 Runtime default model 与静态声明的
`permission_mode=default|bypass_permissions`，新 draft 默认后者，但 Scheduler 必须先完成统一 Dispatch Preflight
并得到 Ready 才能启动正式 AgentRun。后继 AgentRun 通过 Fleet LRU 串行复用兼容 Host。相同
path/fingerprint 且 Adapter permission schema digest 相同的轻检复扫保留 Ready；任一权限 descriptor 改变时
降级为 light snapshot，等待显式检查、Picker 刷新或统一 Dispatch Preflight 重新验证。

TRAE 的模型 Picker、cache status、60 秒/24 小时窗口、失败保留和显式模型 AgentRun 校验与其他 Runtime
共用同一模块。产品代码不增加 TRAE-specific cache 或 refresh policy；只有真实 Runtime acceptance/smoke
在本机串行运行，避免第三方密钥或状态文件竞争。

冷 Host HistoryRestore 只在 executable fingerprint、installation/protocol、Host config、canonical workspace、
workspace access/isolation、模型和权限均兼容时尝试。Host initialize 后先把精确 Session route 标为
`LoadingReplay`，再调用 `session/load`；匹配成功 response 是进入 `Ready` 和发送当前 prompt 的唯一 barrier。
恢复期 assistant/tool/permission/usage/server request 均静默隔离，受 4096 event、8 MiB 和 30 秒上限约束；
异常持久记录 continuity lost、停止失败 Host、轮换 Binding 后才以新 Session 继续。

External MCP 沿用现有 `AdditivePerRun`：当前 AgentRun 的冻结 Definition 通过
`session/new` 参数追加；warm reuse 只允许完整 Runtime compatibility digest 相等，因此冻结 MCP Projection
的解析后 Server 集合、cwd 或其他 Host 输入不同时不会领取该 Host；只含 AgentRun ID 的投影文件
digest 不是 Host 输入。不写 Runtime 用户级或 Workspace 配置，也不新增独立 MCP 隔离层；回归必须证明
不同解析后 Server 集合不会命中同一 Host，以及 cwd、权限和 Session 绑定仍由各自 AgentRun 冻结。

TRAE 的 `append_system_prompt` 已实测为独立 system message，但正式集成仍使用首包 Charter；能力存在
不等于模型在冲突场景中可靠服从。Rovai managed Skill 投递只拥有已验证的项目 `.trae/skills`；Runtime
兼容扫描到的其他项目/用户路径不进入 Rovai ownership。Compaction detector 仍因可靠结构化完成信号
`NotObserved` 而保持 `Disabled`，不是 `Unsupported`。Missing-Send Recovery 则只在 zero-send、
accepted-send suppression 与真实 tool→final 三条专项 Smoke 通过后启用，不从“Runtime 已支持”反向推断。

## Cursor Agent 当前边界

`cursor-agent` 复用 ACP v1 Host，并依赖 Cursor vendor extensions。产品优先解析 `cursor-agent`；兼容别名
`agent` 必须先通过 Cursor build identity 校验，避免与 Grok Build 等同名程序碰撞。Host 使用
`<resolved-executable> acp`，initialize 后有界调用 `authenticate(cursor_login)`，再建立 `session/new`。

`cursor/ask_question` 与 `cursor/create_plan` 只能进入唯一 Active Prompt；当前分别返回 skipped/rejected。
三个已知 private notification 保持私有，未知 Cursor request 返回 Method not found。External MCP、cold
continuation、Missing-Send、Usage、Compaction 和细粒度 Activity 都没有真实资格证据，保持禁用或 run-level。
Cursor Host 完成 Run 后停止，不跨 Run 延伸未证明的进程状态。

项目 `.cursor/skills` 是 Rovai managed delivery target；该结论只建立可清理文件投影，不把上游文档中的
Skill 扫描能力冒充真实 load/invocation pass。当前所有平台未准入，因此普通产品路径不会实际投影或启动
Cursor。Settings 的 Agent Runtime 目录默认不展示 Cursor；closed identity 只用于内部兼容、历史读取和后续实现。
字段级行为见 [Runtime Launch and Verification v27](../contracts/runtime-launch-and-verification-v27.md)，
证据状态见 [Runtime 兼容性清单](../runtime-compatibility.md)。

## ACP Client Terminal 边界

ACP Client Terminal 是 Runtime-specific compatibility capability，不是全局 ACP 开关。Adapter registry 为每种
Runtime 返回 `disabled` 或 `local_bridged`：只有后者才同时在 initialize 声明 `terminal=true` 并在同一 Host
安装通用标准 Bridge。当前只有 Kimi Code 使用 `local_bridged`；其他 ACP Runtime 继续声明 `terminal=false`，
保留各自已资格验证的内部 Shell 路径。

Bridge 只在当前 AgentRun owner、execution epoch、Session 与 Active Prompt fence 内创建本地进程。进程从已
admitted Runtime Host 的 ManagedProcess launch snapshot 派生，继承其 workspace、provider/Built-in 环境、
macOS protected-tree deny 和平台进程树所有权；cwd 经 canonical/symlink 检查后不得逃逸 workspace。Run cancel、
detach、Host EOF/shutdown 与 fleet reap 回收遗留 Terminal，未清空的 Host 不得进入 warm reuse。stdout/stderr
使用有界私有 buffer，Terminal wire、output 与 error 不进入 Camp message 或 durable Evidence。字段与幂等合同见
[ACP Client Terminal v1](../contracts/acp-client-terminal-v1.md)。

## Kimi Code 当前边界

`kimi-code-cli` 通过 `kimi acp` 复用 ACP v1 Host。Core 不读取或改写用户 `~/.kimi`，而是从权限收窄的
`~/.config/rovai/kimi-code.env`（可由 `ROVAI_KIMI_CONFIG` 覆盖）读取严格 allowlist 的
`KIMI_MODEL_*` provider 字段，并只注入目标子进程。`KIMI_MODEL_CAPABILITIES=thinking` 只声明能力，
Rovai 不强制关闭 Kimi/MiniMax thinking。未知、重复、缺失、格式错误或权限过宽均在 launch 前
fail closed；秘密不进入数据库、Evidence、diagnostics 或公开 command。

Kimi Code 的 ACP compatibility policy 使用通用 Client Terminal `local_bridged` 模式。初始化真实声明
`clientCapabilities.terminal=true`，Shell 子进程由上述本地 Bridge 执行；这不是 Kimi 私有 Shell 协议，也不改变
其他 Runtime 的 Shell 路径。实际 `@moonshot-ai/kimi-code@0.38.0` 发布包的只读复核确认其 exact
create/output/wait/kill/release、4 MiB output limit 与 capability-unavailable 分支；一次性隔离 Home initialize
也返回 0.38.0 且接受 `terminal=true`。确定性 Host fixture 覆盖完整 wire、Run cancellation 与 workspace
escape。macOS arm64 本机随后通过 Homebrew 升级到 0.38.0；隔离开发 App 的 Deep Probe 返回 authenticated/ready，
真实 Camp AgentRun 经两次 Bash 调用读取 workspace cwd 与固定 marker 后成功结束，且未遗留 Kimi/Terminal 子进程。

Kimi 正式 AgentRun 不设置通用 `HOME` 或 `KIMI_CODE_HOME`：父进程已有 `KIMI_CODE_HOME` 时原样继承，未设置时
由 Kimi 使用其原生默认 Home。Core 不复制、合并或改写该 Home 的配置、认证与 Session；`KIMI_MODEL_*`
provider overlay 仍只存在于目标子进程。显式 Deep Probe 可以使用一次性临时 Home，但不得把 Probe Session
写入正式 Binding，且其行为不能外推为产品 continuation 证据。

Kimi AgentRun 正常结束后，健康、quiescent 且 compatibility digest 完全一致的 Host 进入 warm LRU；后继兼容
Run 直接复用同一 Host/Session。Host 被停止、淘汰或失效后，后继兼容 Run 在继承同一用户原生 Home 的新 Host
上优先 exact `session/resume`，只有没有 resume 能力时才用带 replay quarantine 的 `session/load`；返回
Session ID 必须与原 ID 完全相同。v22 创建的 Rovai 私有 Home 不再被新 Host 使用，也不自动迁移或删除；旧
Binding 不可见时沿用一次 continuity-lost replacement。

Kimi/MiniMax 可能在普通文本中返回 `<think>` 块。Core 不再以 provider 或标签推断私有推理：Kimi 的标准
ACP `agent_message_chunk` 与其他 ACP Runtime 一样原样进入 `agent.text.delta`、Runtime Evidence、terminal
final 与 Missing-Send candidate，只应用通用 whitespace trim。External MCP 以
`AdditivePerRun / RovaiWins` 经标准 ACP `session/new/resume/load.mcpServers` 投递，不写用户级 Runtime
配置；完整解析后的 Server 集合进入 Host compatibility，含 AgentRun identity 的 Run-local projection/evidence
digest 不进入，Server 定义变化仍 fence 旧 Host。stdio、Streamable HTTP、同名整项优先、ContextManifest 和
真实模型 Tool call 均已验证。Usage/Cost
保持 Disabled；Compaction 通过 Kimi-only Prompt lifecycle correlation 与 idle/detached exact completion frame
以 `best_effort` 接入。History Restore
仅作为 load-only fallback。异步 command/config
advertisement 只安全路由为私有 metadata，当前没有产品消费者，不作为遗留项。Rovai managed Skill 投影目标为
`.kimi-code/skills`。

本机 `kimi 0.32.0` 使用 MiniMax M3 在 macOS arm64 完成真实 prompt、Shell allow/deny、六类 terminal output、
Missing-Send、cancel 与 cleanup。早期 Built-in CLI `0/15` 是 fixture 在第一项 canonical operation 前错误检查
legacy stdin 非法输入退出码；改为当前 CLI 合同的 `2` 后，十五项 operation、三种输入、Gather、conflict、
lease fencing、exact successor read 与 logical/native continuation 全部通过，共产生 56 条 full-run evidence。
因此 snapshot 声明 built-in transport。macOS arm64、macOS x64 与 Windows x64 当前均为 digest-bound
`qualified`：arm64 由完整 Kimi 资格矩阵准入，macOS x64 由维护者完成平台验收后的独立发布确认准入，Windows
x64 由独立 Windows 资格证据准入。三者都进入普通 discovery、检查、成员配置和 AgentRun 路径。字段级行为见
[Runtime Launch and Verification v27](../contracts/runtime-launch-and-verification-v27.md)，证据状态见
[Runtime 兼容性清单](../runtime-compatibility.md)。

## Grok Build 当前边界

`grok-build` 通过 `grok --permission-mode <effective> --no-auto-update agent --no-leader [--plugin-dir
<private-root>] stdio` 复用 ACP v1 Host。initialize 成功后，BYOK 优先已广告的 `xai.api_key`；没有 BYOK
overlay 时只接受 Runtime 广告的安全非交互默认、`cached_token` 或 `xai.api_key`，不回退到浏览器/device
login。模型目录来自真实 Session，显式模型使用标准 `session/set_model`。

Grok 模型/provider 直接使用官方 `$GROK_HOME/config.toml` 的 `[models]`、`[model.<id>]` 与
`[model_providers.<id>]`；Core 不再定义或翻译 `GROK_MODEL_*` 私有三字段，也不改写用户配置。权限收窄的
`$GROK_HOME/.env` 只作为本机密钥环境源：Core 仅解析官方 TOML 的 `env_key` / `env_http_headers` 引用和
官方全局 API-key 名称，并把对应值注入目标子进程；未引用变量不进入。官方 `api_key` 字段同样兼容。

正式 AgentRun 继承用户原生 `HOME` / `GROK_HOME`。BYOK Probe 把官方 `config.toml`、managed config 与
requirements config 复制到临时 `GROK_HOME`，不复制 `.env`；account-auth Probe 为读取既有 cached token
保留原生 Home。官方配置摘要同时 fence warm Host 与 cold HistoryRestore。

Grok/MiniMax `<think>` 若由 Runtime 作为普通 `agent_message_chunk` 发出，就与其他 ACP agent text 一样原样
进入执行台 Evidence、Camp final 与 Missing-Send，不做 provider-specific 清洗或重分类。`_x.ai/*`
notification 只作为已知 Session metadata/lifecycle 安全路由。Runtime Fleet LRU 保留 compatible warm
Host/Session；当前版本没有
resume advertisement，cold continuation 只用 exact `session/load` HistoryRestore，replay 在 bounded loading
phase 隔离，失败后只允许一次 fresh fallback。

External MCP 为 `AdditivePerRun / NativeWinsSkip`。`grok 0.2.118` 的 ACP Session 忽略 `mcpServers`，Core 因此
在私有 Runtime 目录生成临时 Plugin 并用 process `--plugin-dir` 追加；`grok inspect --json` 已发现的所有
native 名称都保留，冲突 Assignment skip，不同名 Server 可追加，完整集合进入 Host compatibility，Plugin 随
Host 清理。Core 不写 project/user config。managed Skill 投影到 `.grok/skills`。Usage/Cost 保持 Disabled。

`grok-build × macos-arm64` 只绑定独立 adapter-scoped qualification evidence；macOS x64 与 Windows x64
保持 `not_qualified / runtime_platform.qualification_evidence_missing`。

## Pi Coding Agent 当前边界

`pi` 使用官方 LF JSONL `pi-jsonl-rpc-v1`，不是 ACP，也不解析 TUI。正式 Host 继承用户原生
`~/.pi/agent` 的认证、Subscription/BYOK、模型目录与 native default，不读取 Claude settings、不复制 MiniMax
token，也不覆盖 `PI_CODING_AGENT_DIR`。显式模型通过 `get_available_models -> set_model -> get_state` 精确验证；
Pi `0.84.2` 会把显式选择持久化为用户全局默认，该副作用属于已确认产品语义。

Pi 的 Host 策略为 `resident_multi_session`：共享 Runtime Fleet 只按 exact Workspace、可执行文件/版本/指纹、
协议、平台、权限和 `rovai-pi-host-v2` digest 复用进程。同一 Host single-flight，每个 AgentRun 通过递增 private
binding 执行 exact `switch_session` 或 `new_session`；Session、成员身份、Bootstrap、Skills、MCP、模型与 thinking
均不进入 process key。cold resume 只接受 full UUID + canonical Session file，失败记录 continuity lost 并 fail
closed，不使用 partial/recent/fuzzy resume。

Pi 单独使用 `managed_system_prompt`。Bootstrap Evidence v2 按 Native Binding 冻结完整 Member Identity 与 full
Bootstrap bytes；Extension 在 `before_agent_start` 把它追加到 Pi 当前 base System Prompt，并在 provider request
前提交 blocking Managed Input Receipt v1。身份属于 Binding，不属于 resident Host；同一 Session 不因 Profile
编辑热更，新 Session 才读取新身份。

Skills 每次 Session activation 只发现 exact `<workspace>/.pi/skills`，合并项目原生与 Rovai ready projection，
并由 `get_commands`/receipt 校验。External MCP 使用 `AdditivePerRun / RovaiWins / CoreManaged`：Core 拥有 stdio
Server/JSON-RPC/cleanup，Pi Extension 注册 per-Run proxy Tool，每次调用都 durable approve；Streamable HTTP 尚未
实现。Pi 本身没有 sandbox，native `bash/write/edit` 由 managed Approval fail closed。

上述行为由 [Runtime Launch and Verification v27](../contracts/runtime-launch-and-verification-v27.md)定义；但行为
实现与 First-Class evidence 是两条轴。合并新版 Checklist 后，Pi 当前 admission 仍为 `core_compatible`：
Compaction、结构化 Usage、Skill/MCP 完整 lifecycle、六类 output/Missing-Send/cleanup Golden Flows 和不可变平台证据尚未
全部闭合。closed catalog 与 macOS arm64 admission row 是待验收实现，不能单独证明正式 First-Class 发布。

## 队员最高权限默认

Runtime Host compatibility 还绑定 Camp Attachment View contract 3。Scheduler 在 Camp read admission 内、Claim
之前检查持久 publication writer intent；存在 pending/recovery operation 时 Run 保持 queued。一次 dispatch 的
Context freeze、Runtime authorization、Host acquire/resume 和 input delivery 复用同一 admission 与 verified
authorization，不能在公平 writer 排队后再次申请 read gate，也不能对同一 View 重复全量扫描。

用户显式选择 Product Runtime 时，Core 的 `memberRuntimeDefaults` 使用该 Adapter 已验证的最高权限值；
descriptor 的保守 `recommendedValue` 不替代队员 draft。静态 descriptor 只拥有配置/admission 语义，不升级为
认证、模型、Session 或动态 capability 证据。

Kiro 暴露 Host-scoped `trust_all_tools=off|on`，新 draft 默认 `on`；真实 ACP Host 映射为
`kiro-cli acp --agent rovai --trust-all-tools`。Probe 与 Runtime Check 不携带 trust-all，
`CoreEnforcedV1 + read_only Workspace` 的 effective launch 也会收窄为不传该 flag。既有成员配置不由
discovery 或迁移扩权；permission schema digest
变化时不能保留旧 Ready，用户必须通过既有 drift 流程显式重存。

Kimi 暴露 Session-scoped `permission_mode=default|plan|auto|yolo`，新 draft 默认原生最高权限 `yolo`；
writable AgentRun 通过标准 ACP `session/set_config_option` 投递 `mode=yolo`，read-only AgentRun 强制
`plan`。descriptor 的 `recommendedValue=default` 只是保守提示，不改变 Product default；已有成员保存的
`default`、`auto` 或 `plan` 不由 discovery、升级或 migration 静默扩权。Runtime 的 exact 默认矩阵见
[Runtime Launch and Verification v27](../contracts/runtime-launch-and-verification-v27.md)。

## Preview 呈现与晋升

Preview row 必须同时满足：明确“待支持/尚未接入 AgentRun”、无可点击检查或配置入口、不会进入成员页
或诊断，并在键盘和辅助技术中表现为不可执行状态。DeepSeek Harness 是当前唯一 preview。

未来接入时不得把 preview identity 写入 Migration 或原地解释为 Installation。实现必须删除 preview row，
再按完整可执行准入增加新的 AdapterKind 和逐平台 Admission；用户从未保存过 preview 选择，因此没有 preview-to-product
数据迁移。
