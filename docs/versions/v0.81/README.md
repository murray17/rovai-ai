---
document_type: version-overview
version: v0.81
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-14
---

# Rovai-ai v0.81：Camp 轻量打开与渐进历史

> 当前状态：Camp 轻量打开、渐进历史、分段耗时日志与安装版验收均已完成。
>
> 前置版本：[v0.80 接收者延续与可修复路由](../v0.80/README.md)

## 版本目标

普通打开 Camp 不再读取、传输和渲染完整历史现场。点击、启动恢复和通知进入统一调用一次
`camps.enter`，返回首屏所需的有界权威投影；较早消息和 terminal Run Evidence 仅在用户需要时读取。

本机 evidence-heavy 基线 Camp 的完整 `camps.snapshot` 响应约 22.1 MB，Core 冷进程端到端约 5.74 s；
其中首屏只需 37 条消息与 20 个 Run 摘要，却携带 1200 条 Evidence、6 个 Manifest、158 个 Action 和
500 个 Timeline event。v0.81 以相同数据库副本记录 before/after。

最终安装版对同一 Camp 只返回最近 20 / 37 条消息、20 个 Run 摘要、0 条 terminal Evidence 与 3 条
presentation Timeline event；wire response 为 98,129 bytes，约为旧完整 snapshot 的 1/225。Release
Core 热请求 20 次的 p50 / p95 为 46 / 68 ms；一次无 Renderer cache 的安装版点击实测 Main roundtrip
42.6 ms、Renderer received 47.4 ms、meaningful paint 140.5 ms、后台项目导航维护完成 166.0 ms。

冷启动仍需等待 Core 进程初始化；同一机器上一次启动恢复样本约 3.3 s，已经脱离完整 snapshot 与
React 长历史成本，但不等同于应用内点击打开。若继续优化，应把“冷启动可恢复壳层”作为独立版本范围，
不能重新把完整 Camp 现场放回首屏路径。

## 交付范围

- `camps.enter` 在一个 Core queue operation 中先 reconcile Default Lead、再返回 post-reconcile
  [Camp Open Projection v1](../../contracts/camp-open-projection-v1.md)；
- `camps.open` 服务普通事件/命令刷新，`camp.messages.page` 读取较早消息；`camps.snapshot` 保留但退出
  普通 Renderer 路径；
- 首屏投影保留 Camp、成员、最近消息、活跃/最近运行摘要、pending Approval 与明确 coverage，移除
  Context Manifest、Action history 和 terminal Evidence 预取；
- Renderer 在 meaningful paint 后再恢复项目导航、刷新侧栏，并保持 selection/high-water fence；
- Renderer 在 cache miss 时保留当前工作区，投影返回后原子提交目标 Camp/项目；普通预算内不显示 loading，
  超过 400 ms 仅在目标侧栏行显示非阻塞进度，失败与过期响应不撤销当前 surface；
- 日志以匿名 trace 记录 Renderer、Main、Core 阶段和 payload/count，不记录用户内容或稳定实体 ID；
- 会话顶部提供“加载更早消息”，prepend 后保持阅读位置；Run Evidence 继续按用户展开读取。

## 完成证据

- Rust：library 453 passed；`rovai-core` binary 73 passed / 3 manual smoke ignored；最终窗口定向回归通过；
- Renderer/Node：Vitest 51 files / 340 tests，Node 179 tests；TypeScript typecheck 通过；
- 质量门：Rust format、strict Clippy、Impeccable detector、1200 px 与约 1100 px 桌面 UI 验收通过；
- 打开交互：隔离安装包暂停 Core 后，cache miss 的原工作区持续可见；400 ms 后只有目标侧栏行显示
  进度，恢复 Core 后原子切换；快速 A→B 只提交最新目标，整个过程不出现整页打开占位；
- 文档：`docs:test`、`docs:check`、diff-aware `docs:check:ci` 与 ADR generate check 通过；
- 交付：arm64 Release App 构建、ad-hoc codesign、隔离 `userData` smoke 与
  `/Applications/Rovai AI.app` 提升通过，真实日常 `userData` 未迁移或覆盖。

## 非目标

- 不改变 Agent CLI、Runtime tool、模型上下文或 `camps.snapshot` 纯读语义；
- 不改变 Default Lead validity、发送准入、Draft、Message Delivery 或 Runtime activity 事实；
- 不重设计 Camp 视觉世界，不用扩大缓存或只改写 loading 文案替代真实性能改善；
- 本版本不把 Renderer 改成 event-sourced projection，也不新增第二个持久数据库。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.80 已完成并冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v0.81。 |
| ADR | 确认无需更新 | 保留 ADR-0013 SQLite Read Side/high-water 与 ADR-0058 reconcile-before-read；没有改变长期决定。 |
| Contracts | 已更新 | [Camp Open Projection v1](../../contracts/camp-open-projection-v1.md)冻结 enter/open/page wire、coverage、窗口、错误和 instrumentation。 |
| Architecture | 已更新 | [Camp Open Read Path](../../architecture/camp-open-read-path.md)冻结 Renderer/Main/Core 责任与渐进读取 seam。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)补充 meaningful paint、Partial 与 earlier-message 阅读位置合同。 |
| Runtime Activity | 确认无需更新 | 不改变 provider event、Canonical Activity 映射或 Evidence shape，只改变 Desktop 何时读取。 |
| Runtime compatibility | 确认无需更新 | Runtime adapter、Native Session capability 与实测版本不变。 |
| Documentation routing | 已更新 | 文档、Contract、Architecture 与版本索引新增 Camp 打开读取入口。 |
| Root README | 确认无需更新 | 项目定位与常青能力不变；根 README 不记录版本局部性能实现。 |

## References

- [实施与验收计划](implementation-plan.md)
- [Camp Open Projection v1](../../contracts/camp-open-projection-v1.md)
- [Camp Open Read Path](../../architecture/camp-open-read-path.md)
