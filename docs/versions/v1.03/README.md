---
document_type: version-overview
version: v1.03
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-18
---

# Rovai-ai v1.03：TRAE 轻检与显式可用性验证

> 当前状态：[ADR-0208](../../adr/0208-user-authorized-trae-light-and-availability-verification.md)与
> [Runtime Launch and Verification v5](../../contracts/runtime-launch-and-verification-v5.md)已经接受；实施与验收已按
> [计划](implementation-plan.md)完成。
>
> 前置版本：[v1.02 Runtime Usage 补全与 Codex 公价估算](../v1.02/README.md)

## 版本目标

消除 TRAE 在 Runtime 设置页的静态特例：启动期有界 `--version` 成功后与其他 Runtime 一样显示“可用”，
用户点击“检查可用性”后完成快速 ACP Session 验证并持久化 Ready，而不是继续停留在“已安装”。

## 交付范围

- TRAE 允许 `DiscoveryVersion` 与 `AvailabilityCheck`，启动轻检成功写 `light_ready`；
- 设置页 TRAE 行使用统一“检查可用性/正在检查”动作；
- 用户检查只执行版本、ACP initialize 与 session/new，不发送行为 Prompt 或模型请求；
- 深检 Ready 提交后的 discovery event 不再用静态 snapshot 覆盖同一次成功；
- `light_ready` TRAE 成员继续允许 Runtime-default 配置和首次任务同 Host 验证；
- 保留后台 health、Installation refresh 与 dispatch preflight 的 TRAE 零进程边界。

## 明确不做

- 不把轻检当成登录、模型或 capability Ready；
- 不在用户检查中运行 Tool/Approval/cancel/native prompt 的完整兼容性矩阵；
- 不修改 TRAE 凭据、钥匙串、用户配置或默认 permission mode；
- 不新增数据库字段、wire method 或自动后台深检。

## 验收边界

- 本机 TRAE `0.120.52` 的 `--version` 成功并生成 light-ready 所需版本；
- 真实用户授权 Availability Probe 在 90 秒 manager deadline 内返回 Ready Session evidence；
- Rust 测试覆盖 launch matrix、轻检执行、light-ready 成员 dispatch 和 health 零进程保护；
- Renderer 测试覆盖十个 Product Runtime 的统一检查动作；
- Rust、TypeScript、Vitest、Desktop build 和文档门禁通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.02 冻结为 historical；本概览、计划和索引建立唯一 current v1.03。 |
| ADR | 已更新 | ADR-0208 局部替代 ADR-0192/0204 的 TRAE 启动轻检和用户检查禁令。 |
| Contracts | 已更新 | Runtime Launch and Verification v5 成为当前入口，冻结 launch matrix、轻检、快速 Session Probe 与 Ready commit。 |
| Architecture | 已更新 | Runtime Catalog Boundaries 记录 TRAE light-ready、显式 Availability Probe 和仍被禁止的后台 purpose。 |
| UI | 已更新 | Settings workspace brief 删除 TRAE “重新扫描安装”特例并统一检查动作。 |
| Runtime Activity | 确认无需更新 | Probe 仍不进入 AgentRun Execution Evidence 或 Canonical Activity。 |
| Runtime compatibility | 已更新 | 记录 `0.120.52` 有界版本输出与用户授权 Session Probe 的本机结果。 |
| Documentation routing | 已更新 | 顶层导航、ADR CURRENT/HISTORY、Contract 和 Version 索引切换到 ADR-0208/v5/v1.03。 |
| Root README | 确认无需更新 | Product Runtime 集合、产品定位与用户能力名称不变。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0208](../../adr/0208-user-authorized-trae-light-and-availability-verification.md)
- [Runtime Launch and Verification v5](../../contracts/runtime-launch-and-verification-v5.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
