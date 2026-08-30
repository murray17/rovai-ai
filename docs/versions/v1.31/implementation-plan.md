---
document_type: implementation-plan
version: v1.31
status: completed
last_updated: 2026-08-30
---

# v1.31 Implementation Plan

## Checkpoint 1 — Lease and admission

- [x] data-dir OS lease、canonical directory identity 与 typed active-owner result；
- [x] Rovai/Lumen exact artifact observation、read-only-first contract probe、受控 journal recovery 与 opaque one-shot tickets；
- [x] WAL/journal/SHM、未知合同、busy、permission、corrupt 与 identity-race regression。

## Checkpoint 2 — Exact open, initialization and migration

- [x] production Core 只使用 admitted open/init/migration surface；旧 direct-create path 限制到测试；
- [x] staging initialization + pre-publish absence revalidation + atomic create-if-absent；
- [x] SQLite Backup API copy migration、validation、backup、manifest、switch 与 recovery；
- [x] supported fixture 与 switch-boundary process-kill regression；
- [x] 新建/重开/迁移后的运行连接统一配置 WAL、NORMAL 与 foreign keys；
- [x] bundled SQLite 升级并核对版本。

## Checkpoint 3 — Supervisor and transport

- [x] startup NDJSON frames、generation/child-token fencing、完整 revision snapshot；
- [x] deterministic refusal 不消耗 crash budget；
- [x] request generation-scoped failure 与 structured value/failure IPC transport；
- [x] failure 普通对象穿过 contextBridge，真实 Electron 测试保留全部字段，Renderer 统一读取 message；
- [x] 全量 Desktop/Main 回归与 packaged sidecar smoke。

## Checkpoint 4 — Shell-first Desktop

- [x] BrowserWindow 先创建，本机默认与偏好加载不阻塞 Full Core；
- [x] preference corruption 保留原文件并发布 local degradation；
- [x] Renderer capability gate、Bootstrap Shell、主题/重试/诊断与 migration 状态；
- [x] Onboarding 使用 admitted authority origin；
- [x] Day/Night、窄窗口、200% zoom 与 reduced-motion 视觉验收。

## Checkpoint 5 — Governance and release evidence

- [x] Architecture、Contract、UI、Version 与 decision routing 更新；
- [x] `pnpm docs:test && pnpm docs:check` 与 merge-base governance；
- [x] `cargo check --workspace --all-targets`、Rust library/bin suites、full Vitest、Desktop build；
- [x] Impeccable changed-target detector 与最终 diff audit。

## Completion evidence

- `cargo test --workspace --no-fail-fast`、`cargo check --workspace --all-targets` 与
  `cargo clippy --workspace --all-targets -- -D warnings` 通过；migration switch-boundary process-kill regression 包含在全仓套件；
- `pnpm test`、`pnpm typecheck`、`pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check` 与
  `DOCS_BASE_REF=origin/main pnpm docs:check:ci` 通过；
- `pnpm package:mac:unsigned && pnpm accept:bootstrap-shell-ui` 以隔离 `userData` 证明未知 authority 在两次检查后
  byte-for-byte 不变，业务树未挂载，retry 不消耗 crash budget，并产生 Day 与 Night/200%/reduced-motion 截图；
- Impeccable changed-target detector 未命中新 Bootstrap Shell 代码；报告项均位于本版本未修改的既有 CSS 区域。

## Crash recovery / contextBridge 修正的测试归属

- `database_admission::tests::crashed_sqlite_writer_is_recovered_and_readmitted` 拥有 SQLite 正常崩溃恢复合同；表驱动覆盖
  current DELETE、legacy-name migration DELETE 和 current WAL。修复前真实 hot journal 产生 776 并永久停在权限拒绝。
  既有 migration-switch kill 测试只拥有文件切换恢复，正常 drop 又会自动回滚，均不能覆盖此输入，所以需要独立子进程
  强杀 owner；`sqlite_crash_writer_helper` 仅为该 owner 的子进程入口，无环境参数时不执行 fixture。
- `read_probe_tolerates_only_a_new_empty_wal_not_authority_changes` 拥有探测副作用与票据重验边界；最低成本为临时文件
  identity fixture，不初始化 schema。覆盖无 WAL→空 WAL、非空 WAL、已有 WAL 变化、main/journal 变化和消费时拒绝。
  既有孤立 SHM owner 不覆盖“存在 main 且只读探测创建空 WAL”的转换。
- WAL/synchronous/foreign-key 配置断言扩展既有初始化/重开和 copy-migration owner，没有增加平行 full-schema 测试。
- 最小 Rust 命令：`cargo test -p rovai-core --lib database_admission::tests::` 与
  `cargo test -p rovai-core --lib authority_migration::tests::`。
- `pnpm test:desktop-bridge` 拥有真实 Electron 跨世界字段保留；错误读取函数的输入矩阵由 Vitest 拥有。
  `pnpm accept:bootstrap-shell-ui` 的新增场景只拥有真实 App/Core 写入中断、自动恢复与工作区重挂载的组合边界，不复制
  底层 DELETE/WAL/migration 输入矩阵。夹具在 Core 停止时安装测试 trigger，等待真实请求产生未提交 WAL 后才发 SIGKILL，
  并核对 PID、父 App、二进制和独立 data-dir，不能强杀日常进程。

### 修正后的验证记录（2026-08-30）

- 修复前两个定向回归分别观察到 `SQLITE_READONLY_ROLLBACK` 被归为权限拒绝、真实 contextBridge 丢失 Error 自定义字段；
  修复后定向回归通过，且干净 WAL 数据库重开不再因 SQLite 自建空 WAL/SHM 被误拒绝。
- `pnpm test:rust:pr` 通过（398 fast library、25 CLI、291 slow integration）；`pnpm test:rust:core` 通过
  （182 passed，4 项既有人工 Runtime smoke ignored）；`cargo clippy --workspace --all-targets -- -D warnings` 与 fmt 通过。
- `pnpm test`（633 Vitest、219 Node script passed，1 项 Windows-only skipped，以及 docs/skills gates）、
  `pnpm typecheck`、`pnpm test:desktop-bridge` 和 `pnpm build:desktop` 通过。
- `pnpm package:mac:unsigned` 与扩展后的 `pnpm accept:bootstrap-shell-ui` 通过：真实 Core 写出 4,251,840 字节
  未提交 WAL 后被 SIGKILL，generation 1→2 自动 ready；1024 行已提交数据与成员 version 保留，`quick_check=ok`，
  旧工作区树卸载并重新挂载，真实 Renderer 收到全部结构化 crash failure 字段。
- 上述打包验收使用独立 data-dir/Skill Library，不调用模型、不改日常 App；脚本先 canonicalize 夹具 root，避免 macOS
  `/tmp`、`/var` 符号链接别名被误当作可用于 Core managed roots 的路径。
- `DOCS_BASE_REF=e96503a600ceddba72922888e425bcfbbf0fe01f pnpm docs:check:ci` 通过；该 SHA 为验证时目标主线基准。
