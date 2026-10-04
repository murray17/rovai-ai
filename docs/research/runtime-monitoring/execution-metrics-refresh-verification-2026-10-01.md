---
document_type: verification-report
status: verified-with-scoped-limitations
verified_at: 2026-10-02
baseline_ref: e3bd6b626d746f5773b334a4660756dfaaab1863
---

# 执行指标读取与引用复用验收

本轮只收口执行面板取数：可见性、请求范围、相同结果复用及迟到落盘通知。
保持既有速度／耗时／Run Card／Context／气泡布局和 v3 算法，不修改原生字段资格。取数收口本身不改变数据库结构；后续 main 更名冲突的兼容迁移另见下节。
接口与生命周期由 [Runtime Execution Metrics v1](../../contracts/runtime-execution-metrics-v1.md#renderer-读取生命周期) 拥有。

## 改动与证据

| 要求 | 实现与 owner | 验收 |
| --- | --- | --- |
| 隐藏停止 UI 请求 | `useExecutionMetricsVisibility` 观察页面与实际裁切后的卡片；速度组件撤下，Core 继续计数 | Electron 中面板隐藏与页面隐藏分别等待 4.5s，没有新增 `monitoring.*` 请求；恢复立即重读且速度重新预热 |
| 缩小 Run 范围 | 当前活动＋视口卡片＋新展开；活动周期只读活动；后端参数化批量 SQL | 500 个合成 Run 中实际请求最多 7 个；滚到远端历史和展开缓存卡片都会重读，不扫稳定全部历史 |
| 相同结果不更新 state | 按完整 DTO 比较，保留对象／数组；只移除请求内缺失及无效代次 | 8 个确定性 Vitest owner 覆盖细微原始数值变化、null／0、Session 时间／模型／代次及 whole-view 删除 |
| 终态迟到 | 250ms／1s／4s 有限尾读，之后依赖已提交变更；新增周期 Flush 终态 batch 通知 | 真实 Renderer 尾读结束后再等 10.5s 请求数不变，再发送落盘通知后由时钟入口切换为 `1k`；气泡保留四项＋耗时 |
| 在途与恢复 | 一个在途请求、保留 trailing，隐藏／范围／epoch fencing，有限失败重试 | 最低层虚拟时钟覆盖通知突发、旧响应、重试停止和重新可见；Core SQL owner 覆盖活动／终态通知资格 |

周期 Flush 默认不发通知，因此不能只依赖既有终态通知。当前补丁在 Usage／Context 实际提交后，
检查 batch 中是否有终态 Run，仅这类周期提交补发 `monitoring.changed`；活动 Run 不增加通知。
如果分类查询失败，只保守失效，不恢复已经提交的 batch，不重复累计。

## 最小复现

```bash
pnpm exec vitest run apps/desktop/src/renderer/src/execution-metrics-reader.test.ts
cargo test -p rovai-core --lib execution_usage_batch_keeps_requested_scope
ROVAI_KEEP_EXECUTION_METRICS_FIXTURE=1 pnpm test:execution-metrics-ui
```

UI 入口挂载生产 ThreadWorkspace/CSS，复用已有封闭 Fixture API；Electron 使用本次临时 userData 和
Skill Library，不启动 Core／Runtime，也不访问日常数据库。保留目录含 `metrics-report.json` 和双主题截图。
测试脚本、固定请求与数值来源分别位于：

- [Renderer 生命周期 owner](../../../apps/desktop/src/renderer/src/execution-metrics-reader.test.ts)
- [Core 批量查询与迟到通知资格 owner](../../../crates/rovai-core/src/monitoring.rs)
- [Electron 入口](../../../scripts/lib/execution-metrics-ui.test.mjs)
- [生产 Renderer 动态步骤](../../../scripts/fixtures/camp-fast-layout/metrics-main.cjs)
- [封闭合成数据](../../../scripts/fixtures/camp-fast-layout/renderer.tsx)

60 秒固定稳定终态回放只产生首次读取（两个可见 Run）；主动展开另一个历史 Run 才新增一次。
原基线源码在该窗口为首次＋每 10 秒读取最多 500 条，即最多 7 次／3,500 个 Run 查询执行。
这不是两个真实 Provider 回答的性能比较，也不是新的 Runtime 支持证明。

## 范围与已知事项

- 全量 Vitest：224 文件／2,422 项通过；TypeScript 和 Desktop／Web 构建通过。
- 默认 Rust workspace：449 通过／1 项既有忽略；Monitoring 扩展 owner 12 项通过。
  通用 docs:test、docs:check 和对 main `4aa0e9ed` 的 diff-aware 文档门禁通过。
- UI 动态验收通过，1280×720 的双主题截图没有页面横向溢出。最低层控制器负责确定性请求次数、引用和竞争；
  Electron owner 只验证真实可见性、生产 UI 和传递 seam，不重复该输入矩阵。
- 尝试执行已有 `test:camp-fast-layout` 时，旧脚本仍读取已退出的 `.execution-disclosure.open`，在基线
  `e3bd6b62` 的 `hideSummary` Run Card 结构上也不适用；本轮没有改写该旧 Fast 验收场景，也不计为通过。
- 本轮未重新打包 App 或调用 Provider；前轮真实原生边界证据继续由[原生边界验收](native-boundaries-verification-2026-10-01.md)拥有。
  Windows／移动 Web 的实际可见性验收不从本次 macOS Electron 结果推定通过。


## 2026-10-02 合入 main 的兼容收口

合入 main `4aa0e9ed`（含 Camp → Thread）。生产 Renderer 改为 `ThreadWorkspace`，指标两接口使用
`threadId`，接受旧 `campId` 并拒绝重复同义字段；Run／Session 的数值含义和采集边界保持原合同。

main 的更名和已安装指标分支都占用 Migration 178 / schema 128。保留指标分支既有 178/179，
将 Thread 格式迁移放在 180，当前 schema 为 130：

- 已安装指标 schema 128/129：保留上下文数量／比例，通过既有 179 和新 180 升级；
- 已安装 main Thread schema 128：只接受完整 v32 准入、没有指标表且没有后续收据的精确布局；
  179 原子补建指标投影和比例，180 记录收口，不重建已具备的 Thread Context 表；
- 原 schema 127：顺序经过指标 178/179 和 Thread 180。

两条路径沿用原 ID、Native Binding、Bootstrap、历史 Context 字节和原生 Session；没有访问日常数据库。
现有 DB owner 扩展回滚、保留与重开边界，相关结果由本轮附件保存。更名前的测试计数属于上节基线，
更名后全量 Vitest 已为 225 文件／2,430 项。生产 ThreadWorkspace 的同一隔离 Renderer 验收再次通过。

合并后的默认 Rust workspace 449 项通过／1 项既有忽略，Monitoring 扩展 12 项、数据库扩展 91 项和
Thread 双路径升级 owner 1 项通过。TypeScript、Desktop／Web 构建、Product Contract 指纹、docs:test
10 项及对 `4aa0e9ed` 的 diff-aware 文档门禁通过；没有通过测试的旧 Fast 脚本仍按上节单独记录。

随后同步 main `a49594fc`（Sidecar 行操作）：Core 和执行指标组件的代码与前次合并相同，数据库迁移不变。
该头上的 TypeScript、227 文件／2,441 项 Vitest、Desktop／Web 构建和 diff-aware 文档门禁通过；
macOS namespace 夹具的冲突保留已验证的未标记基线，定向 owner 通过。上节 Renderer 截图仍对应
合入 `4aa0e9ed` 后的执行指标组件，不作为新的 Sidecar 交互验收。
