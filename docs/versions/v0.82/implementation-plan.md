---
document_type: implementation-plan
version: v0.82
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-15
---

# v0.82 实施与验收计划

## Checkpoint 0：版本与基线

- [x] 从完成的 v0.81 最新 `origin/main` 开启唯一 current v0.82；
- [x] 确认普通恢复已使用轻量 `camps.enter`，剩余等待来自全屏 gate 与 Core 冷启动；
- [x] 记录旧安装包同一隔离 Skill Library 第二次 Core ready 基线约 3.80 s；
- [x] 接受 ADR-0188 与两阶段恢复责任边界。

## Checkpoint 1：Renderer 与 Desktop

- [x] Main Window Session 快照返回后立即显示目标页面框架；
- [x] Camp 候选 target 与 committed active Camp 分离，Members/Memory 使用局部 loading/error；
- [x] 将 Overview、常规偏好、Runtime health、项目导航恢复与已读维护放到 route shell/内容首屏之后；
- [x] 删除 Navigation 全分页存在性扫描，接入轻量 `camps.exists`；
- [x] 增加 Main/Core/Renderer data-minimized 启动阶段日志。

## Checkpoint 2：Core bundled Skills

- [x] 从 embedded definition 在内存计算 expected snapshot；
- [x] 未变化 Revision 使用 exact paths/types/sizes/modes 快速验证，不物化 staging；
- [x] bundle 变化或明显损坏继续完整物化、digest verify、publish/repair；
- [x] 保留 AgentRun SkillProjection preflight 全文 digest fail-closed；
- [x] 覆盖首次安装、快速路径、单项修复与 system-required configuration 回归。

## Checkpoint 3：验证与发布

- [x] Core/Renderer 定向与完整测试、Rust format/Clippy、typecheck、Desktop build 通过；
- [x] Impeccable detector 结果已审阅，局部 loading UI 验收通过；
- [x] 同机隔离安装包完成 7 次冷启动恢复 before/after 对照并回填 p50/p95；
- [x] 文档治理与 diff gate 通过；
- [x] 回填最终数值和剩余瓶颈后标记 complete。

## 完成证据

- Renderer/脚本：51 个 Vitest 文件、341 项测试与 179 项 Node 协议/资格测试通过；
- Rust：workspace 453 个 library、12 个 CLI、73 个 Core binary 测试通过，3 个手动 Runtime smoke 按既有策略忽略；
- 静态与交付：`cargo fmt`、strict Clippy、TypeScript typecheck、文档 diff gate、Desktop package 与 strict codesign verify 通过；
- 冷启动：可见恢复等待 p50 1.667 s → 0.041 s，进程启动到 Camp 内容 p50 3.402 s → 2.542 s；
- bundled Skill：持久 Library 冷进程 Core ready p50 3.370 s → 0.225 s，首次完整安装路径保持约 3.1 s。
