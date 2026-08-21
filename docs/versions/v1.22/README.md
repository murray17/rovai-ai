---
document_type: version-overview
version: v1.22
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: implemented
model_context_change: false
last_updated: 2026-08-21
---

# Rovai-ai v1.22：Runtime Probe 更新容错

> 当前状态：设计与实现已完成，核心/Renderer/文档回归已通过，实现提交 `e2187f02` 已同步到
> `origin/main`；尚未执行 App 打包安装。
>
> 前置版本：[v1.21 User Automation 与 Runtime Diagnostic Trial](../v1.21/README.md)已按完成事实冻结为
> historical；其普通用户自动化、Runtime OS 隔离与诊断投影继续作为本版基线。

## 版本目标

让 Runtime 在一次 Deep Probe 期间原地更新、原子替换或切换 symlink 时，不再把已经过时的 Probe 结果、
stdout/stderr cleanup timeout 或混合版本证据持久化为当前 Runtime 故障。Check Manager 对完整 Probe 做轻量
file identity 前后复核，首次被更新取代时在原 attempt/deadline 内重新绑定当前 binary 并最多重试一次。

同时把模型下拉体验与当前 binary 的执行资格严格分离：旧 fingerprint 的最后成功模型目录可以在原 24 小时
窗口内作为 stale LKG 展示，但旧 capabilities、认证、权限动态证据和 Ready 资格不得迁移到新 fingerprint，
Dispatch Preflight 仍必须为当前 binary 建立新的 Deep Probe evidence。

## 交付范围

- Runtime Check Manager 在每次完整 Deep Probe 前后读取 `ExecutableFileIdentity`，并对 `Ok`、`Err` 和
  stdout/stderr cleanup timeout 使用同一 supersession 分类；
- 首次 Superseded 后在同一 attempt ID、single-flight 槽和 90 秒绝对 deadline 内等待约 300 ms，重新解析、
  canonicalize、计算当前 SHA fingerprint 并最多再 Probe 一次；
- Core 内部使用 `Ready | StableFailure | Superseded` 三态，Superseded 不提交 snapshot、failure、diagnostic
  或公开 `lastProbeAttempt`，模型打开与显式检查投影为 deferred，执行保持 queued/blocked；连续两轮均被取代后
  由进程内闸门抑制 Scheduler 自动循环，直到模型目录打开或显式检查再次触发；
- fingerprint 变化立即用当前静态 snapshot 取代旧 Ready，并清除旧 capabilities、protocols、认证、动态权限、
  Session compatibility 与执行资格；只保留最近成功的 models 和 `lastSuccessfulProbeAt`；
- retained LKG 从原成功时间计算 24 小时 TTL，当前 fingerprint 未深检时至少投影为 stale，到期后 expired；
- 公开 `lastProbeAttempt` 只选择与当前 Installation snapshot fingerprint 匹配的 attempt，旧记录仍留在历史表；
- 回归覆盖原子替换、更新进程持有 stdout、稳定 cleanup timeout、连续两次更新、第二次稳定失败、Ready/LKG
  分离和旧 attempt 过滤。

## 数据与 Context 兼容性

本版不增加数据库 Migration，不修改既有 digest 算法、Adapter Probe 子命令、Managed Runtime 正常 AgentRun
进程或模型输入字节。`adapter_capability_snapshot` 继续保存当前 executable snapshot；发现事务只在已有可信
Deep Probe 模型目录时保留 `model_catalog_json` 与原 `last_successful_probe_at`，不新增持久状态或 CAS 协议。

Runtime Launch and Verification 升级到 v17，模型目录 refresh status 增加 `deferred`，显式产品检查增加
`ready | stable_failure | deferred` 终态投影。Formatter 21、ContextManifest 21、Run Facts v2、Profile v4、
Built-in Tool transport 和 User Automation contract 均不改变。

## 明确不做

- 不在每个 Probe 子命令前后重新计算 SHA，不实现完整 Probe Identity Lease；
- 不增加数据库 CAS、文件锁、更新锁、binary 副本或数据库 Migration；
- 不无限重试，不延长 cleanup timeout，不增加 AGY 或其他 Runtime 专用分支；
- 不修改各 Adapter 的 `health.rs` Probe 流程或正常 AgentRun Runtime 执行链；
- 不把 stale LKG 当成当前 binary 的模型支持、认证、capability 或 dispatch Ready evidence。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.21 按完成事实冻结；本概览、实施计划、决定记录与版本索引建立唯一 current v1.22。 |
| Decisions | 已更新 | [V1.22-D01](decisions.md#v1-22-d01)记录 bounded supersession/rebind 与 LKG/Ready 证据分离。 |
| Contracts | 已更新 | Runtime Launch and Verification v17 冻结三态 outcome、一次重试、deferred 投影、LKG TTL 与当前 fingerprint attempt 过滤。 |
| Architecture | 已更新 | Runtime Catalog Boundaries 与基础不变量同步 Check Manager supersession、当前 Ready evidence 和 stale LKG 权威。 |
| UI | 确认无需更新 | Renderer 已为合同新增的 deferred 使用中性缓存文案；现有 surface、交互层级和长期 UI 规范不变。 |
| Runtime Activity | 确认无需更新 | Probe supersession 是 Availability 控制面状态，不新增 AgentRun activity、Evidence kind 或 Runtime grammar。 |
| Runtime compatibility | 确认无需更新 | 不改变 Adapter、实测版本或能力结论；方案对所有 Runtime 使用同一 Check Manager。 |
| Documentation routing | 已更新 | 版本索引、当前决定导航、Architecture/Contract 索引与 Runtime 路由切换到 v1.22/v17。 |
| Root README | 确认无需更新 | 这是 Runtime 更新竞态的正确性修复，不改变项目定位、平台范围或用户安装入口。 |

## References

- [v1.22 实施与验收计划](implementation-plan.md)
- [v1.22 决策记录](decisions.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [Runtime 进程与校验不变量](../../architecture/foundational-invariants.md#runtime-process-verification)
