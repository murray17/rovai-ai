---
document_type: implementation-plan
version: v1.24
authority: implementation-and-acceptance-status
status: implemented
last_updated: 2026-08-21
---

# v1.24 Runtime Probe 完整边界与自动恢复实施验收计划

## 1. 版本与权威

- [x] 冻结已交付 v1.23，建立唯一 current v1.24；
- [x] 接受 V1.24-D01 与 Runtime Launch and Verification v18；
- [x] 同步 Runtime Architecture、基础不变量、Contract/Decision/Documentation routing；
- [x] 确认 public wire、数据库、模型上下文、Renderer 与正常 AgentRun 执行链不变。

## 2. Runtime Check Manager

- [x] 删除 identity 保护外重复的 managed-resolution version gate；
- [x] 让 Adapter version、认证、能力、协议与模型检查共同进入完整 identity 复核；
- [x] 把永久 Execution deferral 集合替换为三秒、不被 deferred 请求续期的进程内冷却；
- [x] 冷却到期后允许 Scheduler 自动建立下一次有界 attempt，Catalog/User Check 可提前清除。

## 3. 回归与交付

- [x] manager-level fake Runtime + SQLite 覆盖 version 自替换后的 Ready commit 与新 fingerprint failure；
- [x] 单元回归覆盖冷却前抑制、到期放行、后续持续放行与显式触发提前清除；
- [x] Rust fmt、workspace/slow-feature Clippy、定向 manager 测试、CLI/slow、TypeScript/Vitest 和文档门禁通过；
- [x] 实现提交 `7f67ddde` 已 fast-forward push 到 `main`；
- [x] 构建、验签、隔离验收并以非终止交接方式安装 macOS App。

## 4. 验证结论

- 评审前的 manager-level 红测可复现外层 version gate：第一次替换直接形成 StableFailure，且 failure 绑定旧
  fingerprint；删除 gate 后 Ready 与 StableFailure 场景均只执行两次 version，并绑定新 fingerprint；
- Rust lib 299 项、Core binary 118 项、CLI 20 项、slow suite 273 项、manager-level fake Runtime 测试、
  fmt、workspace/slow-feature Clippy、TypeScript、71 个 Vitest 文件/485 项、189 项 Node 测试和文档门禁通过；
  4 条真实 Runtime smoke 按既有规则保持手工 ignored；
- `pnpm package:mac` 通过 source/binary/package legal gate，App/Core/CLI 签名有效且均为 arm64；包内
  `rovai --help` 与 `rovai app --help` 保持 Transport v20 / User Automation v1 分层；
- 打包 App 使用一次性隔离 `userData` 完成 onboarding 全流程；另一个隔离实例的 User Automation status
  返回 `appRunning=true`、`authorized=true`、contract 1，并在验收后完成受控 Core shutdown；
- 新包已安装到 `/Applications/Rovai AI.app`，上一版保留在
  `/Applications/Rovai AI.backup-v1.23-before-v1.24-20260821-2132.app`；当前会话的旧 App/Core 仍存活，
  日常 `userData` 未修改，新版本在用户稍后退出并从规范路径重新打开后生效。

## References

- [v1.24 版本概览](README.md)
- [V1.24-D01](decisions.md#v1-24-d01)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
