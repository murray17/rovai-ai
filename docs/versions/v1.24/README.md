---
document_type: version-overview
version: v1.24
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: implemented
model_context_change: false
last_updated: 2026-08-21
---

# Rovai-ai v1.24：Runtime Probe 完整边界与自动恢复

> 当前状态：实现提交 `7f67ddde` 已同步到 `origin/main`，全量回归、App 打包、隔离验收和非终止安装交接
> 已完成；新包位于 `/Applications/Rovai AI.app`，当前承载会话的旧进程将在用户稍后退出后才切换。
>
> 前置版本：[v1.23 按需 Built-in CLI Help 与 Charter 精简](../v1.23/README.md)已按完成事实冻结为
> historical；其 Built-in Transport v20、Session Charter revision 2 与安装事实继续作为本版基线。

## 版本目标

关闭 v1.22 Runtime 更新容错评审发现的两个剩余入口：让 Adapter 的 version、认证、能力、协议和模型检查
全部位于同一 executable identity 保护范围内；让连续两次 Superseded 后的执行检查自动恢复，而不是永久依赖
用户打开模型目录、显式检查或重启 App 解锁。

## 交付范围

- 删除 managed Runtime resolution 在 Adapter Deep Probe 外重复执行的 `--version` gate；Adapter Deep Probe
  成为版本、认证、能力、协议与模型目录的唯一 manager-owned 结果；
- 保留 v1.22 每轮 Probe 前后 identity 复核、首次 Superseded 后约 300 ms 重绑、最多两轮、同一 attempt ID、
  single-flight 槽与 90 秒绝对 deadline；
- Execution 触发的两轮 Superseded 后，按 Runtime 写入三秒进程内冷却；冷却期 Scheduler 请求不延长截止时间，
  到期后的下一次 tick 自动建立新的有界检查；Catalog Open 或 User Check 可提前清除冷却；
- manager-level fake Runtime + 临时 SQLite 覆盖第一次 version 阶段原子替换后第二轮 Ready commit，以及第二轮
  StableFailure 绑定新 path/fingerprint；单元回归覆盖冷却到期自动放行；
- Runtime Launch and Verification 升级到 v18；公开 `ready | stable_failure | deferred` wire、LKG/Ready 分离、
  24 小时 TTL、正常 AgentRun 执行链和各 Adapter Probe 子命令保持不变。

## 明确不做

- 不增加逐子命令 SHA、完整 Probe Identity Lease、数据库 CAS、文件锁、更新锁或 binary 副本；
- 不增加无限重试，不延长 cleanup timeout，不增加 AGY 或其他 Runtime 专用分支；
- 不修改 Adapter `health.rs`、正常 AgentRun 执行链、数据库 Schema、模型上下文或 Renderer wire。

## 交付结果

- Rust lib 299 项、Core binary 118 项、CLI 20 项、slow suite 273 项和两条 manager-level fake Runtime 测试
  全部通过；4 条真实 Runtime smoke 按既有规则保持手工 ignored；
- `cargo fmt`、workspace/slow-feature Clippy、TypeScript、71 个 Vitest 文件/485 项、189 项 Node 测试以及
  文档、Skill、legal 门禁通过；
- `pnpm package:mac` 完成 arm64 release 构建、ad-hoc 签名和 732 个 legal payload 文件校验；App、Core 与
  CLI 的签名、架构和包内 help 已复验；
- 打包 App 使用一次性隔离 `userData` 完成 onboarding 全流程；独立隔离实例的 `rovai app status --json`
  返回 `appRunning=true`、`authorized=true`、Automation contract 1，随后受控退出；
- 新包已原子换入 `/Applications/Rovai AI.app`；上一版保留在
  `/Applications/Rovai AI.backup-v1.23-before-v1.24-20260821-2132.app`，日常 `userData` 未修改，承载当前
  会话的旧 App/Core 进程未被终止或误报为热升级。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.23 按完成事实冻结；本概览、计划、决定与版本索引建立唯一 current v1.24。 |
| Decisions | 已更新 | [V1.24-D01](decisions.md#v1-24-d01)记录完整 Probe identity 边界与有界自动恢复。 |
| Contracts | 已更新 | [Runtime Launch and Verification v18](../../contracts/runtime-launch-and-verification-v18.md)替代 v17，冻结单一 Adapter Deep Probe 与三秒冷却语义。 |
| Architecture | 已更新 | Runtime Catalog Boundaries、基础不变量和相关路由同步 v18 当前权威。 |
| UI | 确认无需更新 | `deferred` wire 与中性缓存文案不变，不新增 Renderer 状态或交互。 |
| Runtime Activity | 确认无需更新 | Superseded 与 cooldown 仍是 Availability 控制面，不新增 Activity 或 Evidence kind。 |
| Runtime compatibility | 确认无需更新 | 不改变支持 Runtime、Adapter 命令或实测能力，只修正统一 Check Manager 编排。 |
| Documentation routing | 已更新 | Version、Contract、Architecture、Decision 与任务入口指向 v1.24/v18。 |
| Root README | 确认无需更新 | 更新竞态正确性修复不改变项目定位、平台支持或安装入口。 |

## References

- [实施与验收计划](implementation-plan.md)
- [V1.24-D01](decisions.md#v1-24-d01)
- [Runtime Launch and Verification v18](../../contracts/runtime-launch-and-verification-v18.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
