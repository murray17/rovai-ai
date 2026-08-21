---
document_type: implementation-plan
version: v0.89
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-16
---

# v0.89 实施与验收计划

## Checkpoint 0：版本与合同门

- [x] 从本地最新 `main` 的 `9c3a87a824278749b08e772d0a543e7c173b3c55` 建立独立
  `<local-worktree>/rovai-ai-wt-v0.89-gather` worktree 与
  `codex/v0.89-gather` 分支；
- [x] 冻结 complete v0.88，建立唯一 current v0.89 与九范围跨版本影响记录；
- [x] 接受两份 ADR、五份 current Contract、Gather Architecture 与 canonical spec；
- [x] 通过 `docs:test`、`docs:check`、ADR generator 与 base-aware CI 文档门禁。

## Checkpoint 1：Migration 与接受事务

- [x] Migration 87 建立 Gather/GatherItem、Message Delivery v3、AgentRun generation 与独立预算账本；
- [x] `team.gather` 原子验证 Default Lead、closed input、canonical addressing、N+1 responsibility；
- [x] 一条公共 message、N forward Delivery/Item、receipt/result/event 与 replay 原子接受；
- [x] schema、foreign-key、check、historical backfill 与 fresh-database gates 通过。

## Checkpoint 2：Capture、Item settlement 与 Barrier

- [x] 普通 send 在事务内冻结精确 `gather_captured` return，保持公开消息/Mention/reply 与混合 recipient；
- [x] pre-run Delivery terminal 与 current-generation member Run terminal 分别关闭 Item；
- [x] successful zero-return 保存 2 KiB Unicode-safe fallback/digest/length/truncation；
- [x] 最后一个 Item 以 CAS 冻结 48 KiB completion input 并创建唯一 Completion Delivery；
- [x] Stop/close/initiator leave、lead change、duplicate target、multi-gather 与 retry 竞态测试通过。

## Checkpoint 3：Completion FIFO 与 Context

- [x] Completion Delivery 进入原 initiator Conversation 的普通 recipient FIFO；
- [x] 物化唯一 `gather_completion` AgentRun 并单写 `completionRunId`；
- [x] Formatter v15 / Manifest v13 投递 mandatory `gather_completed` Current Input 与 exact frozen recovery；
- [x] CampTurn optional member / required completion settlement 与 failure/cancellation 状态闭合。

## Checkpoint 4：Transport、CLI、Skill 与 Read Side

- [x] Transport/catalog/capability/CLI command 升级 v13，固定命令数 15；
- [x] root/exact help、direct/stdin/input-file、repeatable `--to`、output/error/evidence 测试通过；
- [x] Session Charter 与 `skills/cli-operations/**` 增加 Gather；`skills/campfire/**` diff 为空；
- [x] packages/contracts、Core Read Side 与 Renderer 对 Delivery/Run 判别联合穷尽处理。

## Checkpoint 5：发布证据

- [x] Rust fmt、定向/全量测试与 strict Clippy 通过；
- [x] TypeScript typecheck、Vitest、Node package tests、docs governance 通过；
- [x] Runtime/CLI product smoke 与必要 crash/concurrency fixtures 已执行并诚实记录结果；
- [x] macOS package、签名、架构与隔离 `userData` 启动验收通过；
- [ ] 解除 Kiro/Qwen 本机 readiness、CodeBuddy 模型拒绝与 Qoder 余额阻塞，补齐十 Runtime 完整 v13 pass；
- [ ] 满足全部发布门后把本计划及 overview 标记 complete；
- [x] 提交并无 force 推送 `main`；
- [x] 从已验收产物升级 `/Applications/Rovai AI.app`，不覆盖日常 `userData`。

## 当前验收事实

- 确定性门禁：Rust workspace 481 个 library test、12 个 CLI test、79 个 Core main test 全部通过，3 个真实
  Runtime manual test 按定义 ignored；strict Clippy、fmt、TypeScript、Vitest、Node、Desktop build 与文档治理通过；
- 完整 v13 Runtime pass：Codex CLI、OpenCode、GitHub Copilot CLI、Claude Code、Antigravity、TRAE CLI CN；
- Qoder `1.1.17` 已通过首轮 15 项、Gather capture、唯一 Completion Delivery/Run；successor Run 由上游
  `Insufficient Balance` 终止，因此不记完整 pass；
- CodeBuddy `2.133.1` / `deepseek-v4-flash` 两个独立 fixture 均在任何工具调用前返回
  `runtime_prompt_refusal`；
- Kiro 与 Qwen Code 在显式 executable 下均于产品配置阶段得到 `resolved=null`；本机同时存在早于本轮
  验收的对应 ACP 孤儿进程。本记录只陈述相关环境事实，不把孤儿进程未经证明地认定为唯一原因；
- smoke 夹具已修复普通 A2A ACK 诱发的 Agent 往返链，并自动结算同 recipient FIFO 前序 Run 的有界权限审批；
  该修复不改变产品语义或 Gather 断言。
- `pnpm package:mac` 从已推送的 `4386a0a7` 构建 323 MiB arm64 App；App、Core 与 CLI ad-hoc 签名通过，
  package 内 Core/CLI UUID 与 release resources 分别一致；
- 打包 App 以显式隔离 `userData` 启动至 Core ready，fresh database 为 Migration 87 / contract `v0.89`，
  controlled shutdown 自然完成且无遗留子进程；
- 日常 App 正常退出后保留旧 bundle 与 SQLite 恢复副本，再升级 `/Applications/Rovai AI.app`。从安装位置
  重启后日常数据由 Migration 86 升到 87，14 Camp、10 Agent、137 CampMessage、4 Task 与 92 个历史
  AgentRun 均保持原计数和终态分布。
