---
document_type: implementation-plan
version: v0.99
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-17
---

# v0.99 实施与验收计划

## 计划状态与使用方式

本计划实现 [ADR-0205](../../adr/0205-minimal-runtime-usage-metering.md)与
[Runtime Usage Monitoring v2](../../contracts/runtime-usage-monitoring-v2.md)。修改 Rust 测试遵守
[Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)；启动 Core、Desktop、
打包 App 或真实 Runtime 前遵守[本地 Runtime 工作流](../../development/local-workflow.md)。

## Checkpoint 0：治理与 clean break

- [x] 开启唯一 current v0.99、冻结 v0.98；
- [x] 接受 ADR-0205，替代 ADR-0201；
- [x] 建立 Runtime Usage Monitoring v2、Architecture、UI brief 与文档路由；
- [ ] 生成 ADR HISTORY 并通过全部文档门禁。

## Checkpoint 1：五表 Usage persistence

- [x] Migration 92/Data Contract v0.99/projection schema 47 删除 v1 Monitoring schema；
- [x] 建立 collection、logical Run summary、hourly、reconciliation、active checkpoint 五表；
- [x] terminal trigger finalizes summary 并删除 checkpoint；无 backfill、compatibility view 或 dual write；
- [x] 45 天/72 小时 retention 与每日分批清理不进入页面路径。

## Checkpoint 2：Parser、Buffer 与 Flush

- [x] 统一稀疏字段、counter mode、input semantics、Cost/currency 校验与 Runtime/version Eligibility；
- [x] source identity 内存去重与合并，cumulative/gauge baseline、reset、重启 checkpoint；
- [x] 4 秒周期 Flush 与 terminal 强制 Flush；周期 Flush 不触发立即 Snapshot；
- [x] 移除 Usage-as-Evidence、raw/normalized observation 和 Evidence count monitoring 热路径。

## Checkpoint 3：Snapshot 与 Renderer

- [x] `monitoring.snapshot` schema v2 返回 summary/trend/breakdown/Coverage/可选 reconciliation；
- [x] 24h 小时与 7d/30d 日趋势只读 rollup，不扫描 Evidence/Transcript/Blob；
- [x] Renderer 删除 Overview/Reliability Tab 和旧类型，只保留 Usage 页面；
- [x] single-flight、12 秒可见轮询、10 秒事件最短间隔、terminal Debounce、隐藏停止；
- [x] empty/partial/populated/stale/error/export 与未知/Coverage 可访问呈现。

## Checkpoint 4：自动化与打包验收

- [ ] Rust focused/workspace、TypeScript/Vitest、Node、docs、skills、fmt、Clippy 与 diff 门禁通过；
- [ ] `pnpm package:mac` 与隔离 `accept:runtime-monitoring-ui` 通过；
- [ ] `/Applications/Rovai AI.app` 可恢复替换，从安装路径启动并核对 Main/Core/CLI/app.asar；
- [ ] 最终提交 fast-forward 推送 `origin/main`，worktree 无未保存内容并按治理规则清理。

## 实施结果

待自动化、打包、安装和推送全部完成后记录不可变 SHA、测试计数、产物摘要、备份与安装验收。

## References

- [v0.99 版本概览](README.md)
- [ADR-0205](../../adr/0205-minimal-runtime-usage-metering.md)
- [Runtime Usage Monitoring v2](../../contracts/runtime-usage-monitoring-v2.md)
- [Runtime Monitoring 架构](../../architecture/runtime-monitoring.md)
- [本地 Runtime 工作流](../../development/local-workflow.md)
- [桌面 UI 验收](../../development/ui-acceptance.md)

