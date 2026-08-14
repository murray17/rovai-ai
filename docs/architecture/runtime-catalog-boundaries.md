---
document_type: architecture
architecture: runtime-catalog-boundaries
authority: runtime-catalog-and-preview-boundaries
status: accepted
last_updated: 2026-08-15
---

# Runtime Catalog Boundaries

本文件定义 Runtime 名称出现在产品中时的权威分层。准入理由见
[ADR-0065](../adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)、
[ADR-0066](../adr/0066-managed-product-runtime-resolution.md)与
[ADR-0189](../adr/0189-settings-only-runtime-preview-outside-product-catalog.md)。实测版本和能力只由
[Runtime 兼容性清单](../runtime-compatibility.md)记录。

## 三层目录

| 层 | 真源 | 可以驱动 | 不能驱动 |
| --- | --- | --- | --- |
| Product Runtime Catalog | Rust/TypeScript closed `AdapterKind` 与 `AgentRuntimeAdapter` Registry | Installation、Probe、成员配置、AgentRun、诊断、Migration、Runtime Activity | 未接入候选或 roadmap |
| Product Runtime Availability | Core 对某一 Product Runtime 的 discovery/deep-probe snapshot | checking、ready、needs login、not installed、incompatible、transient failure 等当前机器状态 | 新产品身份或静默 Runtime fallback |
| Settings Runtime Preview Catalog | Renderer 内受审查的静态 presentation rows | Runtime 设置页中的名称、图标、`待支持`文案和 disabled 状态 | Contracts、Core request、数据库、成员选择、诊断、Probe、AgentRun 或支持数量 |

Product Runtime Catalog 当前包含十种可执行 Adapter。Preview 与它不是“同一目录的另一种状态”；
Renderer 只在绘制 Runtime 设置列表时组合两种 row。产品目录的机器可判数量、全量检查、诊断分母和
成员选项始终只来自 `AdapterKind`。

## 可执行准入

新增 Product Runtime 必须原子建立：

1. 稳定 wire identity、可执行发现和 Installation/Migration closed kind；
2. 深度 Probe 对协议、认证、必需 capability 与 transient failure 的诚实分类；
3. 冻结模型、权限、Session、MCP、cwd 和进程策略的 AgentRun Adapter；
4. prompt 终态、cancel、Action/Approval、Tool ID、Runtime Activity 与兼容性证据；
5. 成员配置、Runtime 设置、诊断、测试与文档投影。

图标、版本输出、`initialize` 成功或 Settings Preview 都不能单独满足准入。

## TRAE CLI CN 当前边界

`trae-cn-cli` 通过既有 ACP v1 Host 启动 `traecli acp serve`。模型与 permission mode catalog 来自
每次真实 Session 返回；默认只接受安全的 `default`，不默认使用 `--yolo`。Session 恢复走
`session/load`，第一版完成 Run 后停止 Host。

External MCP 沿用现有 `AdditivePerRun`：当前 AgentRun 的冻结 Definition 通过
`session/new` / `session/load` 参数追加，不写 Runtime 用户级或 Workspace 配置。这里不新增独立
MCP 隔离层；回归只需证明未配置的相邻 Run 不继承本次追加项，以及 cwd、权限和 Session 绑定仍由
各自 AgentRun 冻结。

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
