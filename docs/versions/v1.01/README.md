---
document_type: version-overview
version: v1.01
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-17
---

# Rovai-ai v1.01：TRAE 与 Kiro 最高权限队员默认

> 当前状态：[ADR-0207](../../adr/0207-explicit-maximum-authority-member-runtime-defaults.md)与
> [Runtime Launch and Verification v4](../../contracts/runtime-launch-and-verification-v4.md)已经接受；Core、
> Renderer、文档治理与定向自动化已经完成，证据见[实施计划](implementation-plan.md)。
>
> 前置版本：[v1.00 用户确认后的 Camp 强制永久删除](../v1.00/README.md)

## 版本目标

把 TRAE CLI CN 的新队员默认从安全 `default` 改为 `bypass_permissions`，并把本机已验证的 Kiro ACP
`--trust-all-tools` 提升为队员级 Host 权限字段，默认开启。十种 Product Runtime 的显式队员配置因而统一采用
各自已验证的最高权限初始值，同时保留用户在保存前改回保守值的能力。

## 交付范围

- TRAE `memberRuntimeDefaults` 使用 `permission_mode=bypass_permissions`；静态 descriptor 同时允许
  `default` 与 `bypass_permissions`；
- Kiro 新增 `trust_all_tools=off|on` descriptor、队员页开关和 Host compatibility 输入，新 draft 默认 `on`；
- Kiro 真实 ACP Host 在 `on` 时追加 `--trust-all-tools`，Probe 与 read-only effective launch 不追加；
- permission schema digest 改变时不再仅凭 executable fingerprint 保留旧 Ready snapshot；
- 已保存的旧 Kiro 配置不被迁移扩权，descriptor 漂移后要求用户显式重存；
- 更新 Runtime 兼容性证据、Architecture、UI brief、ADR/Contract 路由与定向测试。

## 明确不做

- 不修改日常 App 数据库中的既有队员权限，不替用户保存任何配置；
- 不让 Runtime Check、Health Probe 或 discovery 使用最高权限参数；
- 不把静态 permission descriptor 声称为认证、模型或动态 capability Ready；
- 不新增通用跨 Runtime “权限等级”抽象，不从 enum 顺序或 label 猜测最高权限；
- 不改变 TRAE execution-deferred 单 Host 验证、Kiro Agent/MCP 投影或 Workspace read-only 边界。

## 验收边界

- Core 默认值和 descriptor 测试覆盖 TRAE/Kiro 的精确 native value；
- Kiro 启动参数测试证明 `on -> --trust-all-tools`、`off/Probe -> omit`；
- TRAE 静态保存和真实 Session revalidation 覆盖 `bypass_permissions`；
- Renderer 测试证明 Kiro 开关默认开启、TRAE select 默认最高权限且保存沿用 Core draft；
- permission schema drift 测试证明旧 Ready 不被保留，旧配置不被静默扩权；
- Rust、TypeScript、相关 Vitest、fmt、Clippy、Desktop build、文档门禁和 Impeccable detector 通过；聚合
  `pnpm test` 中与本版本无关的既有 benchmark profile locator 失配单独记录，不冒充本版本回归。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.00 冻结为 historical；本概览、实施计划和版本索引建立唯一 current v1.01。 |
| ADR | 已更新 | ADR-0207 局部替代 ADR-0192 的 TRAE 安全默认，并冻结 Kiro trust-all 与非静默扩权边界。 |
| Contracts | 已更新 | Runtime Launch and Verification v4 替代 v3 作为当前入口，冻结默认值、launch mapping 与 schema drift。 |
| Architecture | 已更新 | Runtime Catalog Boundaries 记录 TRAE/Kiro 的当前队员权限与 Probe/执行边界。 |
| UI | 已更新 | Member workspace brief 把 Kiro trust-all 开关和 TRAE 最高权限 draft 纳入现有运行参数区。 |
| Runtime Activity | 确认无需更新 | 权限默认和启动 flag 不新增 Canonical Activity kind 或映射。 |
| Runtime compatibility | 已更新 | 记录 Kiro 2.16.1 `--trust-all-tools` 本机证据和 TRAE 已广告的 `bypass_permissions`。 |
| Documentation routing | 已更新 | 文档导航、ADR CURRENT/HISTORY、Contract 索引和版本索引切换到 ADR-0207/v4。 |
| Root README | 确认无需更新 | Product Runtime 支持数量和产品定位不变；权限默认由 Runtime 合同与版本入口拥有。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0207](../../adr/0207-explicit-maximum-authority-member-runtime-defaults.md)
- [Runtime Launch and Verification v4](../../contracts/runtime-launch-and-verification-v4.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
