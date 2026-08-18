---
document_type: implementation-plan
version: v0.98
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-17
---

# v0.98 实施与验收计划

## 计划状态与使用方式

本计划基于 `main@595c234319472efcf63e02eac16d26effae83673` 和开发者已确认的
[model-context-change revision 1](model-context-change.md)。实现不得偏离其中的模型 shape、发送/省略
条件、Evidence、版本轴或 clean break；若必须语义调整，先递增 revision 并重新确认。

修改 Rust 测试前遵守 [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)；
启动 Core、Desktop、打包 App 或真实 Runtime 前遵守
[本地 Runtime 工作流](../../development/local-workflow.md)。

## 不变量

- Picker identity 与正文 Marker 分离：token 是结构化身份，`message` 始终保留 `/name`；
- eligibility 在 Direct user send 的每个 Run 冻结，late enable 不回溯；
- start-time desired state 与 ready Exposure 都必须通过，旧 link 存在不代表当前可用；
- 合法无路径静默省略；全量 projection `error/stale/digest/ownership` 仍 fail closed；
- Resolver 是只读深 Module，Reconciler 独占 filesystem side effect；
- `skills` 与 message/attachments 同级，零 entry 时字段省略；Skill path 指向 `SKILL.md`；
- Skill 文件链接不改变 Runtime Adapter、Attachment、Profile、Bootstrap、其他 Context section 与 ACK；
- 同期 ACP 修正只以 Prompt response 结算 ACK，隔离 replay，不改公开 Runtime Event wire；
- Runtime command output 只能来自各 Adapter 原生结构化协议中的公开 Content/result 字段；私有日志、
  workspace diff、terminal locator、未知 `rawOutput` 字段与最终自然语言不得作为工具证据；
- Model Context Projection、Context Evidence 和 Runtime Input Delivery Evidence 不合并。

## Checkpoint 0：治理基线

- [x] 开启唯一 current v0.98、冻结 v0.97 并记录 revision 1 二次确认；
- [x] 接受 [ADR-0203](decisions.md#adr-0203)；
- [x] 建立 [Current Input Skill Links v1](../../contracts/current-input-skill-links-v1.md)与
  [ContextManifest Evidence v16](../../contracts/context-manifest-evidence-v16.md)；
- [x] 建立 Architecture/CONTEXT/UI/文档路由并生成 ADR HISTORY；
- [x] 通过 docs:test、docs:check 与真实 base 的 docs:check:ci；治理 SHA 在本次独立提交后记录。

## Checkpoint 1：Structured Content 与 Composer

- [x] Rust/TypeScript closed union 增加 `skill_mention`，校验 ID 与 canonical name；
- [x] body projection、digest、current/historical rendering 支持 `/nameAtSend`；
- [x] Picker 选择改为原子 token + 普通尾随空格；手写、粘贴和旧 Draft 保持 Text；
- [x] Draft persistence、undo/redo、Backspace、selection、IME、keyboard menu 与 a11y 回归；
- [x] 时间线 token 在 disabled/deleted/renamed 后仍显示发送 Marker，不查询当前名称改写正文。

## Checkpoint 2：发送时选择快照

- [x] 定义 versioned `SkillSelectionSnapshot`、五类发送 omission reason 与 canonical digest；
- [x] Direct send 按每 Run 冻结 Adapter Groups 和 Library desired state，并与 AgentRun 原子提交；
- [x] A2A/Gather/旧 terminal Run 使用 versioned empty snapshot，不扫描 Slash 文本；
- [x] 重复 ID first occurrence 去重、不同接收者差异、rollback、retry/recovery 不重算测试；
- [x] AgentRun Snapshot/read side 不把 selection 当成 path、permission 或 Exposure。

## Checkpoint 3：Resolver、Formatter 与 Evidence

- [x] 实现 start-time `RunSkillAvailabilityView` 和只读 `CurrentInputSkillResolver`；
- [x] Resolver 与全量 `PreparedSkillExposure` 相交，按冻结 Group precedence 稳定选择 ready
  `entryPath/SKILL.md`；
- [x] later disabled/unassigned/deleted/renamed 与 shadowed/pending-removal 产生确定 omission evidence；
- [x] 保持全量 preflight error/stale/digest/ownership fail closed；
- [x] Formatter v18 输出 optional sibling `skills`，保持正文、附件、section 顺序和 canonical JSON；
- [x] Manifest v16 保存 selection/Exposure/resolution/exact payload evidence，恢复复用冻结结果。

## Checkpoint 4：Migration 91 与 clean break

- [x] Data Contract v0.98、projection schema 46、Migration 91 与 current-state admission；
- [x] AgentRun snapshot 列和 ContextManifest resolution 列为 non-null/versioned/digested；
- [x] 终态业务历史保留，非终态 Run/Turn/Delivery/Gather 显式收口；
- [x] 不兼容 Manifest/Delivery/Bootstrap/Binding/Session/frozen context 删除并要求新 Session；
- [x] 无 Formatter v17/Manifest v15 reader、alias、backfill inference 或 dual write；
- [x] current fixture upgrade、foreign-key check、idempotent reopen 与 tamper tests 通过。

## Checkpoint 5：自动化与 UI hardening

- [x] Rust focused/workspace、TypeScript/Vitest、Node protocol/acceptance、shared fixture 全部通过；
- [x] rustfmt、Clippy `-D warnings`、typecheck、docs gates 与 `git diff --check` 通过；
- [x] Composer 在 1040×700、双主题、键盘、IME、长 Skill 名、禁用/失效 token 与 Draft restart 下通过；
- [x] 运行 Impeccable detector，一次批量修复 findings，最多一次确认 pass；
- [x] Runtime Adapter 回归证明无 Provider-specific item、正文重复、Attachment 误用或 ACK 变化。

## Checkpoint 5A：ACP Session 续接与事件隔离

- [x] 统一 `ReuseSameHost -> Resume -> New`，仅对明确允许的 legacy Adapter 保留
  `LoadHistory`；
- [x] TRAE 移除 Host Stop 特例并进入 Fleet LRU；warm 命中复用同一 Host/Session，冷 Host
  不使用 `session/load`；
- [x] `LoadingReplay/Ready/PromptActive/PromptCompleted/ProtocolViolated` route 和
  Host/Run/epoch/Session/Prompt/Delivery fence 在业务副作用前 fail closed；
- [x] Prompt 观察状态按 prompt 隔离；ACP input ACK 仅由匹配 prompt request ID 的 response 产生；
- [x] Core 全回归、真实 TRAE smoke 与文档门禁通过；打包验收由 Checkpoint 6 独立记录。

## Checkpoint 5B：Runtime command output

- [x] 通用 ACP 支持标准嵌套 Content Text、明确 Terminal 边界，并仅从 `rawOutput` 的
  `stdout/stderr/output/text` 顶层白名单回退；
- [x] OpenCode、GitHub Copilot、TRAE 固定 `printf` smoke 增加 output 硬断言；确定性测试同时证明
  未授权敏感字段不会进入公开 payload；
- [x] Claude 消费 partial/full `tool_use` 与 `tool_result`，以原生 ID 关联生命周期并把 Bash 等工具映射
  到既有 Activity/Evidence，同时保持 final result、Usage、Session 校验不变；
- [x] AGY 以健康能力证据选择 stream-json，解析原生 step/tool/result；未声明能力的旧版继续保持
  text/run-level 展示，不从日志、diff 或最终文本推断 command；
- [x] ACP、Claude、AGY parser/process fixture 与相关 Rust 全量、Clippy、脚本语法和文档门禁通过；本轮
  没有调用真实模型，兼容性清单不登记新的 Runtime 实机 pass。

## Checkpoint 6：打包、安装与发布验收

- [x] `pnpm package:mac` 生成 arm64 Application，严格 codesign 验证通过；
- [x] 隔离 userData 从打包路径完成 Picker -> send -> `CURRENT_INPUT.skills`/Evidence smoke；
- [x] 保存当前 `/Applications/Rovai AI.app` 的可恢复备份，原子替换安装版；
- [x] 只从 `/Applications/Rovai AI.app` 启动，核对 Main/Core/CLI/app.asar 摘要与进程来源；
- [x] 最终实现提交以 fast-forward 推送 `origin/main`，不改写主工作区并保留其中并行用户改动；
- [x] 编码 worktree 已无未提交内容，可在发布记录提交后安全移除，不丢弃用户改动。

## 实施结果

- 实现提交：`d95b17940689665299ee632f2dedce688248ecda`，包含并基于
  `main@d1c035a43d0323f31ea2860bb4a3262f1aee726b`；
- 自动化：Rust 全量 602 项通过、3 项手工 Runtime smoke 按设计 ignored；最终 `main` monitoring 增量另有
  19 项 library 与 79 项 Core binary 测试通过。Vitest 56 files / 388 tests、Node 187 tests、TypeScript、
  docs、skills、rustfmt、Clippy `-D warnings` 与 `git diff --check` 全部通过；
- 同期 Runtime command-output 修正复跑当前 Rust 套件：623 项通过、3 项既有手工 Runtime smoke 按设计
  ignored；`cargo fmt --check`、workspace Clippy `-D warnings`、ACP smoke 脚本语法、docs:test、
  docs:check、真实 Git base 的 docs:check:ci 与 `git diff --check` 通过；
- 打包验收：`accept:composer-skill-context`、`accept:structured-mentions-ui`、
  `accept:runtime-activity-ui` 均从隔离 userData 通过；最终 Skill smoke 证据位于
  `/var/folders/49/z0f8w56s28j4pfc7t80cm3w80000gq/T/rovai-structured-mentions-ui-captures-pINYFI`；
- 最终 arm64 资源摘要：app.asar
  `d9f70f812d25122ec7337bef191b99e561e6cf45c69cbd79416c3996300e0bc3`、Core
  `dc8cd896265bc5cefa1ddd4621e3c91bd4be83662c4e2ce081c9107de3492f4e`、CLI
  `d6c721598e34aee7c3ac91abe3cb648dd47f83807cda888e5476742ce39d418a`；
- 安装：`/Applications/Rovai AI.app` 已从该包启动，Main/Core 进程来源正确；日常数据为
  Data Contract v0.98、projection schema 46、Migration 91，foreign-key check 为空；
- 回滚：原 v0.97 备份为
  `/Users/murray.xue/Downloads/Rovai AI.app.backup-v0.97-20260817-122925`，最终交换前 v0.98 备份为
  `/Users/murray.xue/Downloads/Rovai AI.app.backup-v0.98-pre-final-20260817-123550`。

## References

- [v0.98 版本概览](README.md)
- [核心模型上下文变更 revision 1](model-context-change.md)
- [ADR-0203](decisions.md#adr-0203)
- [Current Input Skill Links v1](../../contracts/current-input-skill-links-v1.md)
- [ContextManifest Evidence v16](../../contracts/context-manifest-evidence-v16.md)
- [Runtime Launch and Verification v3](../../contracts/runtime-launch-and-verification-v3.md)
- [本地 Runtime 工作流](../../development/local-workflow.md)
- [桌面 UI 验收](../../development/ui-acceptance.md)
