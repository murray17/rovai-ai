---
document_type: architecture
architecture: runtime-catalog-boundaries
authority: runtime-catalog-and-preview-boundaries
status: accepted
last_updated: 2026-08-20
---

# Runtime Catalog Boundaries

本文件定义 Runtime 名称出现在产品中时的权威分层。Catalog、Installation 与机器状态的长期边界见
[Runtime Catalog 与 Installation 不变量](foundational-invariants.md#runtime-catalog-installation)。主机平台准入由
[Runtime 平台安全不变量](foundational-invariants.md#runtime-platform-security)与
[Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)拥有；Runtime 启动与延迟验证边界见
[Runtime 进程与校验不变量](foundational-invariants.md#runtime-process-verification)、
[Runtime 恢复与关闭不变量](foundational-invariants.md#runtime-recovery-shutdown)及
[Runtime Launch and Verification v14](../contracts/runtime-launch-and-verification-v14.md)。实测版本和能力只由
[Runtime 兼容性清单](../runtime-compatibility.md)记录。

## 四层权威

| 层 | 真源 | 可以驱动 | 不能驱动 |
| --- | --- | --- | --- |
| Product Runtime Catalog | closed `AdapterKind` 与 Rust `AgentRuntimeAdapter` Registry | 全局产品身份与 Adapter interface | 某个平台已验证、机器状态、未接入候选或 roadmap |
| Runtime Platform Admission | Rust Adapter Registry 的 `AdapterKind × HostPlatformKey` 矩阵 | 某平台上的 discovery/check/Installation、成员选择、AgentRun、诊断与 Migration 准入 | 当前机器是否安装/登录/Ready、Renderer roadmap |
| Product Runtime Availability | Core 对某一 Product Runtime 的 discovery、静态身份或 deep-verification snapshot | light ready、checking、legacy installed unverified、ready、needs login、not installed、incompatible、transient failure 等当前机器状态 | 新产品身份、把静态可尝试误作深检 Ready 或静默 Runtime fallback |
| Settings Runtime Preview Catalog | Renderer 内受审查的静态 presentation rows | Runtime 设置页中的名称、图标、`待支持`文案和 disabled 状态 | Contracts、Core request、数据库、成员选择、诊断、Probe、AgentRun 或支持数量 |

Product Runtime Catalog 当前包含十种可执行 Adapter。Preview 与它不是“同一目录的另一种状态”；
Renderer 只在绘制 Runtime 设置列表时组合两种 row。产品目录的机器可判数量、全量检查、诊断分母和
成员选项始终只来自 `AdapterKind`，但在当前主机上还必须先经过 Runtime Platform Admission。

`qualified` 是进入 Product Runtime Availability 的前置条件；`not_qualified` 显示“Windows 尚未验证”，
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

发现结束、页面进入和成员选择不排队深检；模型 Picker 按 60 秒/24 小时策略请求刷新。fingerprint 变化只替换静态快照并
使旧 Ready 失效。Runtime Check Manager 以内部 attempt identity、总 deadline、每 Runtime 单飞和全局并发二
统一收口 success、failure、timeout、JoinError、abort 与 shutdown；短生命周期 Runtime 子进程统一使用受限输出
和整进程树 cleanup。

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
形成的 `ready` 成功 snapshot 才是 catalog success；`light_ready`、`installed_unverified`、failed attempt
或 synthetic runtime-default descriptor 不能冒充动态目录。Core 从成功时间统一投影 `fresh`（60 秒内）、
`stale`（60 秒至 24 小时）、`expired`（24 小时及以上）、`unavailable` 与 `invalidated`，Renderer 不自行计算
TTL。

切换队员 Runtime 只读取 Installation，不启动进程。打开模型 Picker 才进入 `runtime.modelCatalog.open` seam：
fresh 直接返回，stale 立即服务 last-known-good 并由 Check Manager 后台单飞刷新，其他状态等待一次用户动作
授权的 Availability Check。刷新失败只追加 failed Probe Attempt，保留成功 snapshot。只有当前 Installation
canonical path 自身的确定 fingerprint/identity 变化才可使目录立即失效；其他搜索候选的失败是
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

Claude Code 与 Antigravity 的执行或显式 Availability Check 失败时，Core 可以从 typed Runtime 证据形成
`RuntimeFailureView`。该对象只保存 Runtime identity、origin、phase、稳定 code、安全 summary/detail 与
retryable；完整 error chain、原始 stderr、私有日志、exit status、byte count 和 digest 仍属于内部诊断。
公开 detail 必须先脱敏、去控制字符并有界化，不能包含 Prompt、用户消息、Tool input 或完整 Tool output。

`runtime` 只表示 Runtime/Provider 明确报错；协议、参数和输出格式问题是 `compatibility`，executable/cwd/
权限/附件目录问题是 `environment`，只有明确 Core 状态、持久化或配置生成证据才能是 `rovai`，否则为
`unknown`。Renderer 不重新分类，也不从内部 diagnostic code 或 digest 推断原因。

`AgentRunView.failure` 和 `ProductRuntimeAvailability.failure` 只投影该安全对象。显式检查可以持久化 Probe
Attempt failure；启动浅检测的瞬时 version failure 仍只用于内部发现，不升级为产品级 failure，也不覆盖
last-known-good。此增量不修改其他 Runtime 的执行路径或 Availability 状态集合。字段级合同见
[Runtime Launch and Verification v14](../contracts/runtime-launch-and-verification-v14.md)。

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

## Preview 呈现与晋升

Preview row 必须同时满足：明确“待支持/尚未接入 AgentRun”、无可点击检查或配置入口、不会进入成员页
或诊断，并在键盘和辅助技术中表现为不可执行状态。DeepSeek Harness 是当前唯一 preview。

未来接入时不得把 preview identity 写入 Migration 或原地解释为 Installation。实现必须删除 preview row，
再按完整可执行准入增加新的 AdapterKind 和逐平台 Admission；用户从未保存过 preview 选择，因此没有 preview-to-product
数据迁移。
