---
document_type: architecture
architecture: runtime-catalog-boundaries
authority: runtime-catalog-and-preview-boundaries
status: accepted
last_updated: 2026-08-18
---

# Runtime Catalog Boundaries

本文件定义 Runtime 名称出现在产品中时的权威分层。准入理由见
[ADR-0065](../adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)、
[ADR-0066](../adr/0066-managed-product-runtime-resolution.md)与
[ADR-0189](../adr/0189-settings-only-runtime-preview-outside-product-catalog.md)。主机平台准入由
[ADR-0210](../adr/0210-platform-qualified-product-runtime-admission.md)与
[Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)拥有；Runtime 启动与延迟验证边界见
[ADR-0192](../adr/0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)、
[ADR-0204](../adr/0204-on-demand-runtime-deep-verification.md)和
[ADR-0207](../adr/0207-explicit-maximum-authority-member-runtime-defaults.md)、
[ADR-0208](../adr/0208-user-authorized-trae-light-and-availability-verification.md)、
[ADR-0209](../adr/0209-bounded-trae-cold-session-history-restore.md)及
[Runtime Launch and Verification v7](../contracts/runtime-launch-and-verification-v7.md)。实测版本和能力只由
[Runtime 兼容性清单](../runtime-compatibility.md)记录。

## 四层权威

| 层 | 真源 | 可以驱动 | 不能驱动 |
| --- | --- | --- | --- |
| Product Runtime Catalog | closed `AdapterKind` 与 Rust `AgentRuntimeAdapter` Registry | 全局产品身份与 Adapter interface | 某个平台已验证、机器状态、未接入候选或 roadmap |
| Runtime Platform Admission | Rust Adapter Registry 的 `AdapterKind × HostPlatformKey` 矩阵 | 某平台上的 discovery/check/Installation、成员选择、AgentRun、诊断与 Migration 准入 | 当前机器是否安装/登录/Ready、Renderer roadmap |
| Product Runtime Availability | Core 对某一 Product Runtime 的 discovery、静态身份或 active/execution-deferred verification snapshot | light ready、checking、installed unverified、ready、needs login、not installed、incompatible、transient failure 等当前机器状态 | 新产品身份、把静态可尝试误作深检 Ready 或静默 Runtime fallback |
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
2. 由 Adapter launch policy 明确深检 purpose 或 execution-deferred verification，并对协议、认证、必需 capability 与 transient failure 诚实分类；
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
有界 one-shot 身份证据。非 TRAE 只有命令成功、输出未超限且识别到基础版本/身份才写入 `light_ready`；
`found_uninspected` 既不是 light-ready，也不是 checking。`light_ready` 可以驱动成员 Runtime-default 配置和
“可用”主状态，但只表示 executable 已通过轻度启动验证、可选择和尝试运行。认证、协议、模型、Session 与
capability 仍要求用户显式检查或首次真实 AgentRun 的深检。

发现结束、缓存过期、fingerprint 变化、页面进入和成员选择都不排队深检。fingerprint 变化只替换静态快照并
使旧 Ready 失效。Runtime Check Manager 以内部 attempt identity、总 deadline、每 Runtime 单飞和全局并发二
统一收口 success、failure、timeout、JoinError、abort 与 shutdown；短生命周期 Runtime 子进程统一使用受限输出
和整进程树 cleanup。

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
Installation refresh、health/diagnostics 与 dispatch preflight 继续不启动 `traecli`；旧
`installed_unverified` 仍可读取，但不再是正常启动轻检成功后的主状态。

成员可以在该状态下原子保存 Runtime default model 与 `permission_mode=default|bypass_permissions`，新 draft
默认后者。首次真实 AgentRun 只启动
一个 TRAE Host，从同一个 Host 的 `initialize` 与 `session/new` response 生成 Ready snapshot 后继续发送
任务输入。后继 AgentRun 通过 Fleet LRU 串行复用兼容 Host；失败使用该 Host 已有错误分类，不启动 diagnostic
process。相同 path/fingerprint 且 Adapter permission schema digest 相同的轻检复扫保留 Ready；任一权限
descriptor 改变时降级为 light snapshot，等待显式检查或下一次真实执行重新验证。

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
不等于模型在冲突场景中可靠服从。Rovai Skill 原生投递路径和 compaction detector 仍无合格证据，
保持空/Disabled。Missing-Send Recovery 则只在 zero-send、accepted-send suppression 与真实
tool→final 三条专项 Smoke 通过后启用，不从“Runtime 已支持”反向推断。

## 队员最高权限默认

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
