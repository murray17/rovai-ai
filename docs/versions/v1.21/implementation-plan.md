---
document_type: implementation-plan
version: v1.21
authority: implementation-and-acceptance-status
status: implemented
last_updated: 2026-08-21
---

# v1.21 User Automation 与 Runtime Diagnostic Trial 实施计划

## 1. 治理与合同

- [x] 冻结 v1.20，建立唯一 current v1.21；
- [x] 建立双 transport、Main-owned automation、无隐式启动与无 generic invoke 决策；
- [x] 建立 User Automation v1、长期 Architecture、基础不变量和文档路由；
- [x] 明确 Trial 为 `formalQualification: false`，不增加 Core Trial/Benchmark entity。

## 2. User Automation transport

- [x] Electron Main 创建当前用户私有 Unix Socket、随机 instance credential 与原子 connection context；
- [x] Server 验证 contract/instance/credential，限制 frame，并在 shutdown 清理本实例文件；
- [x] closed dispatcher 仅映射 V1 operation，不提供 method name/generic invoke；
- [x] `rovai app` 使用独立 context/credential，Desktop 未运行时返回 `app_not_running` 且不启动 App；
- [x] 既有 Agent CLI transport、context、lease、Envelope 与命令行为不变。

## 3. Camp、Run 与 Renderer

- [x] Camp create/send 复用正式 Core/Composer 路径，显式目标成员并冻结预算；
- [x] launch 只接受 dispatched/rejected，非空 `pendingExecution` 返回合同升级错误；
- [x] AgentRun show/watch/cancel/export 使用安全 read methods 和 version fence；
- [x] Camp open 经 Core existence check 后复用现有 window 与 Renderer activation flow。

## 4. Trial 与诊断安全

- [x] Trial 验证成员 Runtime 与 workspace，在首次 mutation 前持久化私有 journal；
- [x] 每次 Trial 创建单成员 Camp、单 root AgentRun，并冻结责任/A2A/elapsed budget；
- [x] watch 使用 global/evidence 双 cursor，terminal 只从 AgentRun 判断；
- [x] Core diagnostic view 使用字段 allowlist，公共输出只来自正式 CampMessage；
- [x] full/partial bundle 都排除 credential、raw config/context/bootstrap/environment/path/Runtime final output。

## 5. 验证

- [x] TypeScript typecheck 与 User Automation dispatcher Vitest；
- [x] Rust Core/CLI compile、CLI 参数/cursor 测试与 diagnostic allowlist slow test；
- [x] 全量前端、Rust fmt/Clippy、文档门禁与 Desktop production build；Rust PR suite 功能相关范围、18 项 CLI
  与 269 项 slow suite 通过，lib 296/297，唯一失败为 v1.20 已记录的 Runtime compatibility register 摘要
  digest 基线失配；
- [x] 提交 `d87eeee4` 的 macOS arm64 package 通过深度验签、三枚 Mach-O arm64 与 Core/CLI Sidecar UUID 校验；
- [x] 全新隔离 `userData` 验证 packaged User Automation status、instance credential、私有权限、CLI help 与
  受控关闭后的 socket/context 清理；App-not-running 负向行为已由 CLI 定向验证；
- [x] 以同文件系统暂存和原子改名非中断安装到 `/Applications/Rovai AI.app`，保留
  `/Applications/Rovai AI.backup-before-d87eeee4.app`；安装前日常进程仍存活且未热升级，用户退出后从规范路径
  重启即可生效；`~/.local/bin/rovai` 已指向安装包内 CLI 并通过 version/help 验证。

## References

- [v1.21 版本概览](README.md)
- [v1.21 决策记录](decisions.md)
- [User Automation v1](../../contracts/user-automation-v1.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
