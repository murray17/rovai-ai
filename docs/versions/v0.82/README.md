---
document_type: version-overview
version: v0.82
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-15
---

# Rovai-ai v0.82：冷启动恢复壳层与 bundled Skill 快速路径

> 当前状态：实现、自动验证与同机隔离安装包冷启动对照均已完成。
>
> 前置版本：[v0.81 Camp 轻量打开与渐进历史](../v0.81/README.md)

## 版本目标

Main Window Session 只决定恢复目标，不再把 Camp/成员/记忆页面框架锁在全屏“正在恢复上次位置”中等待
Core ready。恢复目标一旦读取，Renderer 立即显示对应一级页面；Camp 权威内容随后只通过 v0.81 的轻量
`camps.enter` 完成，其他导航与维护工作保持在首屏之后。

同时移除 Core 每次冷启动对未变化 official bundled Skills 的 staging、复制、`fsync` 与全文哈希，使普通
冷启动恢复不再无条件承担 bundle 物化成本，并保留 AgentRun 执行前完整哈希的 fail-closed 门禁。

## 交付范围

- StartupGate 只覆盖 Main Window Session 本地快照读取；Camp、Members、Memory 使用各自局部 loading/error；
- Camp 候选恢复目标与 committed active Camp 分离，只有 `camps.enter` 成功后才提交权威内容；
- Overview、常规偏好、Runtime health、项目恢复、`campViewed` 与导航刷新不得抢占恢复关键请求；
- `camps.enter` 失败只调用轻量 `camps.exists` 区分已删除目标，不再分页扫描全部 Navigation Camps；
- Renderer/Main/Core 记录 data-minimized 的 session、shell、Core ready、bundle bootstrap 与内容首屏阶段；
- bundled Skill 未变化时走内存 expected digest + 文件树元数据快速路径；变化或明显损坏仍在 ready 前完整修复；
- 不做数据库连接池、全局 Core request queue 或 Runtime 架构重写。

## 验收口径

- 隔离安装包恢复同一 Camp，分别记录进程启动到一级页面框架和 Camp meaningful content 的耗时；
- 旧版与新版使用同机、同架构、等价隔离数据库，各至少五次完全退出后的冷进程样本；
- 单独记录同一 Skill Library 第二次启动的 Core ready，用于解释 bundle fast path 的贡献；
- 首屏后维护失败不得撤销已显示页面，缺失 Camp 只通过 `camps.exists` 回到 Quick Chat；
- AgentRun preflight 的完整 Revision digest verification 回归必须通过。

## 验收结果

2026-08-15 在同一台 Apple Silicon Mac 上，以 v0.81 已安装应用和 v0.82 ad-hoc 签名安装包分别创建
等价隔离数据库与可恢复 Camp。每个版本完成初始化后，执行 7 次应用完全退出后的冷进程恢复；统计采用
nearest-rank p50/p95。这里的“可见恢复等待”是 Renderer 一级框架出现到 Camp meaningful content 出现的
时间，直接对应用户看到“正在恢复上次位置”后继续等待的体感。

| 冷启动指标 | v0.81 before | v0.82 after | 改善 |
| --- | ---: | ---: | ---: |
| 可见恢复等待 p50 | 1.667 s | 0.041 s | -97.53% |
| 可见恢复等待 p95 | 3.363 s | 0.179 s | -94.66% |
| 进程启动到 Camp 内容 p50 | 3.402 s | 2.542 s | -25.29% |
| 进程启动到 Camp 内容 p95 | 5.668 s | 3.348 s | -40.93% |

Core 二进制另用独立 data/Skill roots 交替启动 4 次。排除首次必须完整安装 bundle 的样本后，保留同一
Skill Library 的冷进程 ready p50 从 3.370 s 降至 0.225 s（-93.33%）；v0.82 三次稳态样本为
212/225/275 ms。首次全新安装仍为 3.119 s，与旧版 3.088 s 同量级，证明完整物化路径没有被绕过。

v0.82 安装包的 `camps.enter` trace 中，request lock 为 0 ms、Default Lead reconcile 为 0–5 ms、轻量
projection 为 0–3 ms，payload 约 2.4 KB；bundle bootstrap 为 19–112 ms，十二项 official Skill 全部走
fast path。剩余约 2–3 s 的总冷启动时间主要位于 macOS/Electron 进程和页面启动，而不再表现为页面框架
出现后的“正在恢复上次位置”阻塞。

## 非目标

- 不改变 `CampOpenProjection` 字段、窗口、Default Lead reconcile-before-read 或 `camps.snapshot` 语义；
- 不让候选 Camp 在 Core 验证前成为 active/committed route；
- 不把文件系统完整性交给 Renderer，也不降低 Runtime 启动前的 fail-closed 校验；
- 不重设计现有 Porcelain + Steel 视觉世界。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.81 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v0.82。 |
| ADR | 已更新 | [ADR-0188](../../adr/0188-bundled-skill-bootstrap-fast-path-and-execution-integrity.md)冻结 bundled bootstrap 快速路径与 AgentRun 完整性门禁。 |
| Contracts | 已更新 | [Camp Open Projection v1](../../contracts/camp-open-projection-v1.md)增加 Desktop-only `camps.exists` 与启动恢复使用边界，不改变投影 shape。 |
| Architecture | 已更新 | [Camp Open Read Path](../../architecture/camp-open-read-path.md)与[Skill Projection Reconciliation](../../architecture/skill-projection-reconciliation.md)记录两阶段恢复和 bootstrap/preflight 分工。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)记录冷启动候选 route shell 与局部 loading 合同。 |
| Runtime Activity | 确认无需更新 | 不改变 provider event、Canonical Activity、Evidence shape 或展示映射。 |
| Runtime compatibility | 确认无需更新 | Runtime adapter、Native Session capability 与实测版本不变。 |
| Documentation routing | 已更新 | 文档导航把冷启动恢复、`camps.exists` 与 Skill bootstrap integrity 路由到本版本的稳定文档。 |
| Root README | 确认无需更新 | 项目定位与常青能力不变；根 README 不记录版本局部启动性能实现。 |

## References

- [实施与验收计划](implementation-plan.md)
- [Camp Open Read Path](../../architecture/camp-open-read-path.md)
- [ADR-0188](../../adr/0188-bundled-skill-bootstrap-fast-path-and-execution-integrity.md)
