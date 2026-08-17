---
document_type: architecture
architecture: runtime-catalog-boundaries
authority: runtime-catalog-and-preview-boundaries
status: accepted
last_updated: 2026-08-17
---

# Runtime Catalog Boundaries

本文件定义 Runtime 名称出现在产品中时的权威分层。准入理由见
[ADR-0065](../adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)、
[ADR-0066](../adr/0066-managed-product-runtime-resolution.md)与
[ADR-0189](../adr/0189-settings-only-runtime-preview-outside-product-catalog.md)，Runtime 启动与延迟验证边界见
[ADR-0192](../adr/0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)和
[Runtime Launch and Verification v2](../contracts/runtime-launch-and-verification-v2.md)。实测版本和能力只由
[Runtime 兼容性清单](../runtime-compatibility.md)记录。

## 三层目录

| 层 | 真源 | 可以驱动 | 不能驱动 |
| --- | --- | --- | --- |
| Product Runtime Catalog | Rust/TypeScript closed `AdapterKind` 与 `AgentRuntimeAdapter` Registry | Installation、Probe、成员配置、AgentRun、诊断、Migration、Runtime Activity | 未接入候选或 roadmap |
| Product Runtime Availability | Core 对某一 Product Runtime 的 discovery、静态身份或 active/execution-deferred verification snapshot | checking、installed unverified、ready、needs login、not installed、incompatible、transient failure 等当前机器状态 | 新产品身份、静态伪造 Ready 或静默 Runtime fallback |
| Settings Runtime Preview Catalog | Renderer 内受审查的静态 presentation rows | Runtime 设置页中的名称、图标、`待支持`文案和 disabled 状态 | Contracts、Core request、数据库、成员选择、诊断、Probe、AgentRun 或支持数量 |

Product Runtime Catalog 当前包含十种可执行 Adapter。Preview 与它不是“同一目录的另一种状态”；
Renderer 只在绘制 Runtime 设置列表时组合两种 row。产品目录的机器可判数量、全量检查、诊断分母和
成员选项始终只来自 `AdapterKind`。

## 可执行准入

新增 Product Runtime 必须原子建立：

1. 稳定 wire identity、可执行发现和 Installation/Migration closed kind；
2. 由 Adapter launch policy 明确选择 active Probe 或 execution-deferred verification，并对协议、认证、必需 capability 与 transient failure 诚实分类；
3. 冻结模型、权限、Session、MCP、cwd 和进程策略的 AgentRun Adapter；
4. prompt 终态、cancel、Action/Approval、Tool ID、Runtime Activity 与兼容性证据；
5. 成员配置、Runtime 设置、诊断、测试与文档投影。

图标、版本输出、`initialize` 成功或 Settings Preview 都不能单独满足准入。

## TRAE CLI CN 当前边界

`trae-cn-cli` 通过既有 ACP v1 Host 启动 `traecli acp serve`。模型与 permission mode catalog 来自
每次真实 Session 返回；默认只接受安全的 `default`，不默认使用 `--yolo`。Session 恢复采用
统一 ACP continuation：兼容 IdleWarm 命中时直接复用同一 Host 已持有的 Session；冷 Host 只有在
`sessionCapabilities.resume` 存在时走 `session/resume`，否则建立 `session/new`。TRAE 的
`session/load` 只作为历史能力证据保留，禁止用于正式 AgentRun 续跑。

TRAE 是 static-only inspection Runtime。Core 的 discovery、设置页 check/ensure、managed/custom refresh、
health/diagnostics 与 dispatch preflight 只验证 ordinary executable、canonical path、fingerprint 和可信静态
version，不启动 `traecli`。这些证据持久化为 `installed_unverified`，不能声明登录、ACP、模型、权限或
Session Ready；版本没有可信 `Info.plist` / Go main-module metadata 时保持 unknown。

成员可以在该状态下原子保存 Runtime default model 与 `permission_mode=default`。首次真实 AgentRun 只启动
一个 TRAE Host，从同一个 Host 的 `initialize` 与 `session/new` response 生成 Ready snapshot 后继续发送
任务输入。后继 AgentRun 通过 Fleet LRU 串行复用兼容 Host；失败使用该 Host 已有错误分类，不启动 diagnostic
process。相同 path/fingerprint 的
静态复扫保留 Ready；身份变化回到 `installed_unverified`，等待下一次真实执行重新验证。

External MCP 沿用现有 `AdditivePerRun`：当前 AgentRun 的冻结 Definition 通过
`session/new` 参数追加；warm reuse 只允许完整 Runtime compatibility digest 相等，因此冻结 MCP Projection
的解析后 Server 集合、cwd 或其他 Host 输入不同时不会领取该 Host；只含 AgentRun ID 的投影文件
digest 不是 Host 输入。不写 Runtime 用户级或 Workspace 配置，也不新增独立 MCP 隔离层；回归必须证明
不同解析后 Server 集合不会命中同一 Host，以及 cwd、权限和 Session 绑定仍由各自 AgentRun 冻结。

TRAE 的 `append_system_prompt` 已实测为独立 system message，但正式集成仍使用首包 Charter；能力存在
不等于模型在冲突场景中可靠服从。Rovai Skill 原生投递路径和 compaction detector 仍无合格证据，
保持空/Disabled。Missing-Send Recovery 则只在 zero-send、accepted-send suppression 与真实
tool→final 三条专项 Smoke 通过后启用，不从“Runtime 已支持”反向推断。

## Preview 呈现与晋升

Preview row 必须同时满足：明确“待支持/尚未接入 AgentRun”、无可点击检查或配置入口、不会进入成员页
或诊断，并在键盘和辅助技术中表现为不可执行状态。DeepSeek Harness 是当前唯一 preview。

未来接入时不得把 preview identity 写入 Migration 或原地解释为 Installation。实现必须删除 preview row，
再按完整可执行准入增加新的 AdapterKind；用户从未保存过 preview 选择，因此没有 preview-to-product
数据迁移。
