---
document_type: implementation-plan
version: v1.27
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-08-22
---

# v1.27 Kimi Code + MiniMax M3 实施验收计划

## 1. Research、provider 与秘密边界

- [x] 复核 Kimi provider 配置和 MiniMax Token Plan 官方文档，并与本机 `kimi 0.32.0` 行为区分；
- [x] 建立权限 `0600` 的外部 env 配置，只允许六个 `KIMI_MODEL_*` 键，不回显 token，且不强制关闭
  Kimi/MiniMax thinking；
- [x] 验证国内 MiniMax endpoint 接受该 Plan token，国际 endpoint 拒绝，固定国内 endpoint；
- [x] 保持用户 `~/.kimi/config.toml` 不变。

## 2. Product Runtime 与数据合同

- [x] 扩展 Rust/TypeScript Adapter closed set、Skill group、discovery、health、monitoring 与 shutdown；
- [x] Migration 105 扩展 closed kinds 和系统 Skill assignment，升级 Data Contract v1.19 / schema 60；
- [x] Kimi Host 使用按兼容逻辑会话稳定寻址的隔离 home、严格 provider 环境和跨新 Host exact
  continuation；
- [x] Renderer catalog、成员参数、Onboarding、侧栏、监控和官方来源图标覆盖 Kimi。

## 3. ACP、安全与真实验收

- [x] 真实 initialize、session/new、MiniMax M3 prompt 与 `end_turn` 通过；
- [x] 真实 Shell allow-once、pending→in_progress→completed、固定 command output 通过；
- [x] 真实 `session/cancel` 在有界时间内返回 cancelled，未留下目标进程；
- [x] `<think>` 块不会进入公开输出，未闭合推理 fail closed；
- [x] External MCP、Usage/Cost 与 Compaction 不出现在 Kimi capability snapshot；真实 `session.resume/load`
  保留，Built-in transport 在完整资格矩阵通过后声明；
- [x] ACP Client 文件写入无授权时 fail closed；危险写入无 Tool/Approval/文件副作用时如实记录 Runtime 预拒绝。
- [x] 真实 deny Approval roundtrip 返回 `rovai_approval_denied`，目标 Tool `not_executed` 且没有文件副作用；
- [x] stdout、stderr、mixed、empty、nonzero 与 large output 六类终态 command Evidence 通过；
- [x] Missing-Send zero-send、accepted-send suppression 与 ACP tool→final 三场景通过；
- [x] 原始 ACP 同 Host 多 Session 隔离、同 home exact resume/load、跨隔离 home 失败边界通过；产品级回归
  证明两个不同 Host 使用同一 scoped home，依次执行 `session/new` 与 exact `session/resume` 且 Session ID 不变；
- [x] 原始 ACP stdio MCP happy path 与相邻空 MCP Session 隔离通过；Rovai projection 因完整
  precedence/definition/compatibility 矩阵未完成而继续 Disabled；
- [x] 多轮 Prompt、resume/load、MCP 与手动 `/compact` 未产生可消费的结构化 Usage/Compaction 事件；
- [x] 完整十五项 Built-in CLI matrix 通过。早期 `0/15` 是验收脚本把 legacy stdin 非法输入退出码错误期待
  为 `1`，Kimi 实际在第一项 operation 前因断言停止；修正为当前契约退出码 `2` 后，十五项 operation、
  56 条 full-run evidence、三种输入、Gather、conflict、lease fencing 与 logical/native continuation 全部通过。

## 4. 最终门禁

- [x] Rust fmt/check、Kimi 配置/ACP/Health/Migration/Platform Admission 回归通过；
- [x] TypeScript typecheck、Renderer 定向测试、Impeccable detector 与 legal asset gate 通过；
- [x] docs test/check、benchmark contract 与敏感信息扫描通过；
- [x] 使用持久私有配置重新运行项目级真实 Kimi smoke，并核对配置权限与进程清理。

验收不包含 macOS x64、Windows x64 的平台资格，也没有开启 External MCP、warm Host、Usage/Cost 或
Compaction；native resume 已进入产品，History Restore 只在 load-only 时作为既有 quarantine fallback。
十五项 Built-in CLI matrix 已在 macOS arm64 完整通过，该平台已准入；其他平台仍需独立完成同等级证据。
