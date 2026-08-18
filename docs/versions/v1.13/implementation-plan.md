---
document_type: implementation-plan
version: v1.13
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-08-19
---

# v1.13 实施与验收计划

## 1. 合同与版本切换

- [x] 冻结 Run Process Detail Surface v11 与 Camp Open Projection v3；
- [x] 建立 V1.13-D01 并切换唯一 current version；
- [x] 更新 Runtime、Camp Open、Conversation Workspace 与文档路由。

## 2. Runtime 与 Core

- [x] 为 Codex、七个 ACP Runtime、Claude Code 与 Antigravity 建立 Runtime-native 结构化模型观测；
- [x] 增加 Migration 96 与 default-only、epoch-fenced、write-once 持久化；
- [x] 将无值、非法值与持久化拒绝保持为不影响 Run 的可诊断日志。

## 3. Read Model 与 Renderer

- [x] 投影 `runtimeModel: { modelId: string | null } | null` 并提升 Read Model/Camp Open schema；
- [x] 将观测事件接入当前 Camp projection refresh；
- [x] 在共享 ExecutionDrawer 的 Run meta 中实现默认回退、实际模型、长 ID 与无障碍状态。

## 4. 验证与发布

- [x] 通过定向 Runtime 持久化、Adapter 解析、TypeScript 与 Renderer 测试；
- [x] 通过完整 Rust、TypeScript、Renderer、文档、Clippy、format 与 Desktop build 门禁；
- [x] 完成 Day/Night、底部/Inspector、1040×700、200% 缩放、长 ID、焦点与三态真实 UI 验收；
- [x] 同步最新 main、推送、打包安装 App，并通知后续任务继续及最终锁屏。

## References

- [v1.13 版本概览](README.md)
- [V1.13-D01](decisions.md#v1-13-d01)
- [Run Process Detail Surface v11](../../contracts/run-process-detail-surface-v11.md)
- [Camp Open Projection v3](../../contracts/camp-open-projection-v3.md)
