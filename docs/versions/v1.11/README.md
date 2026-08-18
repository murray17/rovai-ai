---
document_type: version-overview
version: v1.11
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-19
---

# Rovai-ai v1.11：Runtime 模型目录缓存与真实执行校验

> 当前状态：Core/Renderer、自动门禁、签名打包与隔离队员工作区验收均已完成；实现提交
> `a9cf6e06` 已推送 main，已替换并从 `/Applications/Rovai AI.app` 重新启动日常安装版。
>
> 前置版本：[v1.10 唯一 Camp ID 与安全公开 Runtime 失败](../v1.10/README.md)。v1.10 已完成并冻结为
> historical。
>
> 后续版本：[v1.12 Windows x64 产品实现与资格闭环](../v1.12/README.md)。

## 版本目标

队员切换 Agent Runtime 时继续保持零副作用；打开模型 Picker 后用统一 stale-while-revalidate 目录快速展示
可选模型。60 秒后后台刷新，最后成功目录最多服务 24 小时，失败不覆盖 last-known-good。缓存只服务配置
体验；显式模型仍由真实 Runtime Host/Session 最终核对，`runtime_default` 始终不发送显式 model。

本版同时修复主动“检查可用性”只返回已排队、Renderer 立即结束 busy，以及 manager timeout/panic 只写
内存诊断的问题。正常既有配置中的未知模型在没有当前目录时显示“尚未核对”，不再被空 catalog 误判成
“已失效”。TRAE 与其他 Product Runtime 使用同一模型目录产品语义；本机真实 Runtime 验收冲突由测试
串行化解决。

人工修改、技术恢复或其他不受支持方式产生的损坏数据不属于本版兼容、迁移或修复范围。

## 交付范围

### 模型目录 SWR

- Installation read model 增加 `fresh | stale | expired | unavailable | invalidated` 和 Core 计算的
  `observedAt / revalidateAfter / expiresAt`；
- 只有 deep-probe `ready` 成功证据构成可服务模型目录，`light_ready` 与 `installed_unverified` 不伪装目录；
- 新增 `runtime.modelCatalog.open`：fresh 直接返回、stale 即时返回并后台单飞刷新、其余状态等待 discovery；
- 切换 Runtime 不调用 Picker-open interface，不启动 Runtime；
- 刷新失败保留 last-known-good 与 failed Probe Attempt，不写空目录或 fallback；
- executable/安装/capability 的确定变化直接失效；account/provider 仅在 Adapter 有稳定非敏感 identity
  evidence 时自动比较。

### 配置与真实执行

- 新 explicit selection 只接受 24 小时内未失效目录；正常既有 explicit selection 保持原值；
- `runtime_default` 无目录也可保存/冻结，并使用各 Adapter 既有 sentinel 作为内部 identity；
- Codex 通过真实 Host `model/list` 完整分页核对 explicit model，runtime default 不向 Thread/Turn 传 model；
- ACP 从真实 Session model/config catalog 核对后才 set model；缺失或目录不可读返回 typed failure，禁止
  replacement Session 绕过或 silent fallback；
- Claude Code 与 Antigravity 继续省略 runtime-default sentinel，由真实 one-shot 进程判定 explicit model；
- AgentRun failure code 增加 `runtime_model_unavailable` 与 `runtime_model_catalog_unavailable` 的 typed 映射。

### 主动检查与 Renderer

- `runtime.product.check` 等到 manager terminal 后返回 `completed/ready`，enqueue/manager 错误不再吞掉；
- supervisor timeout/panic/join failure 尝试持久化 transient failed Probe Attempt；
- 队员页与首次训练模型选择共用受控 Picker，支持 loading、后台刷新、失败保留、过期与失效状态；
- 既有已保存模型按证据显示“当前目录未提供 / 缓存中未找到 / 尚未核对”；旧请求按 generation 隔离，不能
  污染用户刚切换的 Runtime draft；
- TRAE 没有独立 cache、Picker 或 refresh 分支；需要真实 TRAE 的验收用例串行运行。

## 数据与兼容性

本版复用 `adapter_capability_snapshot.last_successful_probe_at/stale_at` 与 `adapter_probe_attempt`。没有新增表、列、
持久 JSON shape 或历史 reader，因此不新增 Migration；Data Contract 保持 `v1.10`、projection schema 50、
migration 95。Runtime model catalog read model 与 Desktop method 是 additive 当前接口，不形成双写或旧 Picker
兼容层。

## 验收边界

- 自动门禁覆盖 Rust fmt、严格 Clippy、default/all-features、Core/CLI/slow tests、TypeScript typecheck、
  Renderer/contract tests、desktop build、docs check/CI/ADR generation 与 diff check；
- ACP/Codex 使用受控本地 fake Host/Session 验证真实目录缺失时 fail closed；
- TRAE acceptance/smoke 不并发，且不接触日常 App userData；
- Renderer 在 Day/Night 既有 Porcelain/Steel 世界中验证键盘打开、焦点、loading/error/LKG/empty、长模型名与
  Runtime 切换竞态；
- 推送 main、打包和替换 `/Applications` 只在本版组合门禁完成并获得当前任务授权后执行。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.10 冻结为 historical；本概览、实施计划与版本索引建立唯一 current v1.11。 |
| ADR | 已更新 | [ADR-0220](../../adr/0220-runtime-model-catalog-stale-while-revalidate.md)固定统一 SWR、LKG 与执行期显式模型校验边界。 |
| Contracts | 已更新 | [Runtime Launch and Verification v9](../../contracts/runtime-launch-and-verification-v9.md)定义 cache/read interface、终态检查和 AgentRun 校验。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)加入模型目录 cache authority、Picker-open 与 TRAE 统一边界。 |
| UI | 已更新 | 队员工作区 brief 与 UI 路由记录 Picker 的即时缓存、证据文案、错误和竞态要求。 |
| Runtime Activity | 确认无需更新 | 本版不增加 Runtime Activity canonical kind、映射规则或展示语义。 |
| Runtime compatibility | 确认无需更新 | 本版不改变已实测 Runtime 版本或兼容性结论；真实 Host 测试验证的是统一产品合同。 |
| Documentation routing | 已更新 | 文档导航、ADR CURRENT 与 Contract 索引切换到 ADR-0220 和 Runtime v9。 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持 Runtime 范围不变，版本流水账不进入根 README。 |

## References

- [v1.11 实施与验收计划](implementation-plan.md)
- [ADR-0220](../../adr/0220-runtime-model-catalog-stale-while-revalidate.md)
- [Runtime Launch and Verification v9](../../contracts/runtime-launch-and-verification-v9.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [ADR-0204](../../adr/0204-on-demand-runtime-deep-verification.md)
- [ADR-0208](../../adr/0208-user-authorized-trae-light-and-availability-verification.md)
