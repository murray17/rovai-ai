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
- [x] macOS 所有 Core-managed Runtime/Probe 及后代通过 Managed Process OS policy deny `automation-v1` tree，CLI
  guard 只作纵深防御；
- [x] Automation Server 初始化/监听失败清理半初始化资源并降级，Desktop/Core 保持运行；
- [x] 既有 Agent CLI transport、context、lease、Envelope 与命令行为不变。

## 3. Camp、Run 与 Renderer

- [x] Camp create 复用正式 Core 路径；send 使用一个幂等 Domain Command transaction，显式目标成员并冻结预算，
  不读取、写入或消费用户 Composer；
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
- [x] 定向验证 Automation send 单 Core call/幂等重放/无 staging/保留现有草稿、macOS sandbox 文件拒绝、
  optional server startup 降级，以及 mutation/terminal shell exit code 映射；
- [x] 全量前端、Rust fmt/Clippy、文档门禁与 Desktop production build；Rust PR suite 功能相关范围、20 项 CLI
  与 272 项 slow suite 通过，lib 297/298，唯一失败为 v1.20 已记录的 Runtime compatibility register 摘要
  digest 基线失配；Core binary 套件另有 5 项既存 ACP fixture/run-tmp 前置条件失败，本次未修改这些模块；
- [x] 提交 `55dc5aa0` 的 macOS arm64 package 通过深度验签、三枚 Mach-O arm64、Core/CLI Sidecar UUID 与
  SHA-256 校验；
- [x] 全新隔离 `userData` 验证 packaged User Automation status、instance credential、私有权限、CLI help 与
  受控关闭后的 socket/context 清理；App-not-running 负向行为已由 CLI 定向验证；
- [x] 以同文件系统暂存和原子改名非中断安装到 `/Applications/Rovai AI.app`，保留
  `/Applications/Rovai AI.backup-before-55dc5aa0.app`；安装前日常进程仍存活且未热升级，用户退出后从规范路径
  重启即可生效；`~/.local/bin/rovai` 已指向安装包内 CLI 并通过 version/help 验证。

## 6. 当前版本维护修复

- [x] Git Diagnostics 只以共享 Runtime 搜索环境解析出的绝对 executable 启动 Managed Process；
- [x] 显式 Skill repair 退役 Observation 已证明的旧 `.lumen` missing symlink，自动 reconcile 继续 preserve；
- [x] Renderer 依据 `broken_or_unavailable_symlink` 展示具体原因、影响边界和动作；
- [x] 修复显式隔离 `HOME` 下 Desktop/Core Runtime Files Root 派生分歧；
- [x] 完整前端、文档、TypeScript、strict Clippy、CLI 20 项与 slow suite 272 项通过；fast lib 298/299，
  唯一失败仍为既有 Runtime compatibility register digest 基线；
- [x] macOS arm64 package 深度验签、架构检查和隔离 Diagnostics UI 成品验收通过；
- [x] 提交 `fe7cc952` 推送 main；原子替换日常 `/Applications/Rovai AI.app`，旧包保留为
  `/Applications/Rovai AI.backup-before-fe7cc952.app`，并从规范路径启动新 App/Core。

## References

- [v1.21 版本概览](README.md)
- [v1.21 决策记录](decisions.md)
- [User Automation v1](../../contracts/user-automation-v1.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
