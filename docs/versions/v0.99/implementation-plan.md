---
document_type: implementation-plan
version: v0.99
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-17
---

# v0.99 实施与验收计划

## 计划状态与使用方式

本计划实现 [ADR-0205](decisions.md#adr-0205)与
[Runtime Usage Monitoring v2](../../contracts/runtime-usage-monitoring-v2.md)。修改 Rust 测试遵守
[Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)；启动 Core、Desktop、
打包 App 或真实 Runtime 前遵守[本地 Runtime 工作流](../../development/local-workflow.md)。

## Checkpoint 0：治理与 clean break

- [x] 开启唯一 current v0.99、冻结 v0.98；
- [x] 接受 ADR-0205，替代 ADR-0201；
- [x] 建立 Runtime Usage Monitoring v2、Architecture、UI brief 与文档路由；
- [x] 生成 ADR HISTORY 并通过全部文档门禁。

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

- [x] Rust focused/workspace、TypeScript/Vitest、Node、docs、skills、fmt、Clippy 与 diff 门禁通过；
- [x] `pnpm package:mac` 与隔离 `accept:runtime-monitoring-ui` 通过；
- [x] `/Applications/Rovai AI.app` 可恢复替换，从安装路径启动并核对 Main/Core/CLI/app.asar；
- [x] 最终提交 fast-forward 推送 `origin/main`，worktree 无未保存内容并按治理规则清理。

## 实施结果

### 实现与自动化

- Usage-only 实现提交：`c99bf8c3`；Data Contract 为 `v0.99`、projection schema 47、Migration 92；
- `cargo test --workspace -- --quiet --test-threads=2`：608 passed、0 failed、3 ignored；此前默认全并发下的
  Runtime probe timeout 经低并发全量重跑证明为资源竞争，不是功能失败；
- `pnpm test`：ADR 21、Skill 3、Vitest 398、Node/Protocol 187 项全部通过；
- `pnpm typecheck`、`cargo fmt --all --check`、`cargo clippy --workspace --all-targets -- -D warnings`、
  `git diff --check`、`DOCS_BASE_REF=origin/main pnpm docs:check:ci` 全部通过。

### 打包与隔离验收

- `pnpm package:mac` 成功生成 ad-hoc signed arm64 `dist/mac-arm64/Rovai-ai.app`；App、Core、CLI 均通过
  `codesign --verify --strict`；
- `accept:runtime-monitoring-ui` 通过 Renderer-to-Core、clean-break empty state、Usage-only 五筛选、日夜主题、
  compact/reduced-motion、200% 缩放与无横向溢出；capture 位于
  `/var/folders/49/z0f8w56s28j4pfc7t80cm3w80000gq/T/rovai-monitoring-ui-captures-GU6KA0`；
- SHA-256：`app.asar` = `2ef7587a361048c3a0cee6bc749c30da26eae6b0941c6a74f394275f03b1f3ef`，
  `rovai-core` = `c4899164441f297fbc66a6fd64861064d6976544046e4315ac38743666c6a4b8`，
  `rovai` = `605adf4a82ed328ebedbb48bc90f4e79fbbb1785ae2aabeda56ccffaa7c4c8f1`。

### 日常安装与 clean break

- 旧 App 可恢复备份：`/Users/murray.xue/Downloads/Rovai AI.app.backup-v0.98-pre-v0.99-20260817-180707`；
- 新 App 安装到 `/Applications/Rovai AI.app`，安装后 Main、Core、CLI 从该路径启动，三项 hash 与打包产物一致；
- 安装验收与另一个已授权的数据恢复任务短暂重叠；最终由恢复任务独占 SQLite restore/WAL 收口后再做本版验收，
  未用开发 fixture 或空库覆盖恢复结果；首次 stale-WAL 尝试保留在
  `restore-attempt-stale-wal-20260817-182751/`，恢复前空库保留为
  `rovai.sqlite.pre-full-restore-20260817-182409.backup`；
- 完整备份经当前安装 v0.99 Core 正式迁移后，日常 `rovai.sqlite` 为 Data Contract `v0.99`、schema 47、
  Migration 92；`integrity_check=ok`、外键检查无行，10 个 Agent Profile、14 个 Camp、46 个 Camp Member、
  137 条 Camp Message 和 22 个 Conversation 均保留；
- Monitoring persistence 精确只含五张 Usage 表，Run Summary 与 Checkpoint 均为 0，证明旧 Monitoring 数据
  未补算，同时 Core 历史未被 Monitoring clean break 删除。

### ACP 私有 Usage 增量验收

- Parser version 3 接入 OpenCode 1.18.15 terminal Usage、CodeBuddy 2.133.1
  `usage_update._meta.usage` 与 Qwen Code 0.21.5 `agent_message_chunk._meta.usage`；不改变 schema、Migration
  或 collection epoch；
- 三份 Fixture 来自本机真实 Runtime 调用并已脱敏。CodeBuddy 同一 request 的重复补发按稳定 ID 去重；
  OpenCode 独立 thought bucket 被归一为 Output 子集语义；三者未上报的 Cache Write 保持 `NULL`；
- `cargo test --workspace -- --test-threads=2`：325 passed、0 failed、3 ignored；Monitoring 定向 5/5、
  `cargo fmt --all --check`、严格 Clippy、TypeScript、399 项 Vitest、文档及 diff-aware 文档门禁通过；
- 聚合 `pnpm test` 的唯一失败来自主线已有 Benchmark profile 仍引用已合并删除的 DB 测试名；本增量没有
  修改该无关 Benchmark 合同，其他 186 项 Node/Protocol 测试通过；
- arm64 App 重新打包并通过 App/Core/CLI 严格签名、Mach-O 架构与隔离 packaged Core 验收；SHA-256：
  `app.asar` = `39e57d5e95c2a2641127e832521a74bf12bf239af813c1acc01effabcd04be82`，
  `rovai-core` = `954592b42599668a4666581f83ccc6b3081bdf9c085775b303ec9580670d9f8a`，
  `rovai` = `368bcc197e0bc7e89d315c8ce4f6bbab474a3e4fefcee1fd29fd73069d21c9f4`。
- 旧安装版已可恢复移动到
  `/Users/murray.xue/Downloads/Rovai AI.app.backup-v0.99-pre-private-usage-20260817-212844`；新产物安装到
  `/Applications/Rovai AI.app` 后三项 hash 与打包产物一致，Main、Core、Renderer 均从安装路径启动；
  日常数据库保持 contract v0.99、projection schema 47、Migration 92，`integrity_check=ok`、外键检查无行。

## References

- [v0.99 版本概览](README.md)
- [ADR-0205](decisions.md#adr-0205)
- [Runtime Usage Monitoring v2](../../contracts/runtime-usage-monitoring-v2.md)
- [Runtime Monitoring 架构](../../architecture/runtime-monitoring.md)
- [本地 Runtime 工作流](../../development/local-workflow.md)
- [桌面 UI 验收](../../development/ui-acceptance.md)
