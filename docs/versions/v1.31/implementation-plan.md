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
- [x] DB 后 authority recovery 保留前置门禁，其余 Skill/MCP/adapter/IPC/清理按功能降级并支持原进程重试；
- [x] Windows 先准入独立私有壳层并取实例锁，正式 data-root preparation 失败不阻止壳层；
- [x] pending cleanup 限制到启动候选；Windows 文件身份改用稳定 Win32 handle API。

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

## 可选启动功能 / Windows 壳层修正的测试归属

- `scripts/lib/core-startup-availability.test.mjs` 拥有真实 Core 的 startup/RPC/process seam。表驱动向 MCP 配置、
  Skill staging、Runtime 私有目录和后台维护路径注入 obstruction，覆盖 ready、结构化单功能拒绝、成员/导航仍可用、
  移除 obstruction 后同进程恢复；另用隔离 DB trigger 精确命中 mandatory authority recovery，验证 typed refusal、
  无 false ready、退出码 0 与下次重启恢复。构造器单测不能证明 `run_core()` 的错误传播与 ready 顺序，所以保留真实子进程。
  最小命令 `pnpm test:core-startup`，不启动模型 Runtime；Rust fast CI 同时执行此 seam。
- `CollaborationService` 既有 `discard_empty_pending_camps_on_startup` slow-test owner 增加快照后创建 Camp 和重复 cleanup
  断言，保持事务中重新核对空草稿条件，不增建平行 DB fixture。初始化状态保留领域已删除但目录清理失败的 exact targets。
- `core_data_dir_lock::tests::filesystem_identity_tracks_objects_not_paths_or_contents` 拥有纯文件对象身份边界：目录与文件
  重读稳定、内容写入不改变对象身份、原对象仍存活时替换同一路径必须不同。无 SQLite fixture；保留原对象避免依赖 inode
  回收时序。既有 lease 测试只覆盖争锁而不能检查 SQLite artifact identity；Windows 修复前 stable 编译在不稳定
  `MetadataExt` API 失败，改为 metadata-only no-follow handle + `FILE_ID_INFO`，继续拒绝 reparse/device。
  最小命令 `cargo test -p rovai-core --lib core_data_dir_lock::tests::`。
- `windows_bootstrap_root_prepares_only_private_shell_directories` 拥有原生 Windows helper 的独立、Core-free、可重复准入
  与 private DACL 边界，复用 native storage fixture，不打开 SQLite。完整 data-root owner 必须创建 Core，不能替代此断言。
  最小命令 `cargo test -p rovai-core --all-targets windows_bootstrap_root`；仅 Windows CI 执行原生分支。
- `windows-bootstrap.test.ts` 拥有 Desktop composition：缺失 binary/环境、超时/异常输出/ACL 拒绝、部分路径绑定回滚，
  primary/secondary 顺序与稳定锁 profile；`core-client.test.ts` 验证 null authority path 不能 spawn 或消耗 generation。
- Renderer feature notice 只覆盖状态呈现；打包 App 额外拥有真实 bridge、工作区 DOM 节点保持和同 generation 按钮重试，
  不重复底层四种故障矩阵。沿用现有 Impeccable 视觉世界，以 footer 呈现功能故障，不重做工作区。

### 本轮验证记录（2026-08-30）

- 原 MCP 目录故障复现脚本在同一隔离 fixture 重跑：healthy / fault / repeat / restored 均 `databaseReady=true`、
  `coreReady=true`、exit 0 与 `quick_check=ok`；保留修复前两次 fail 和修复后的独立日志。
- `pnpm test:core-startup` 通过四个可选故障 case 与 mandatory authority recovery refusal/restart case；
  `pnpm test:desktop-bridge` 验证真实 Electron Promise failure 字段保留。
- `cargo test --workspace --no-fail-fast`、291 项 slow library、Clippy `-D warnings`、fmt、`pnpm test`、
  typecheck 与文档/skills gates 通过；最终 PR 记录对应最新提交的 CI 状态，不以本机 macOS 结果代替 Windows 原生验证。
- `pnpm package:mac:unsigned` 与扩展打包验收通过。fixture 为独立 `rovai-availability-accept.*`，显式隔离
  `userData`、Skill Library、MCP config、Runtime Files Root；不使用日常配置，不调用模型。
  Skill 故障时成员/导航可用，修复后 generation 保持 1，工作区 DOM 节点未重挂载，失败字段跨真实 bridge 保留；
  Day 1040×700 与 Night/200%/reduced-motion 截图已检查，提示可滚动、重试键盘可达、无横向溢出。
- 同轮打包回归在真实 Core 写出 4,787,440 字节未提交 WAL 后强杀，仅此隔离 child 被终止；generation 1→2 自动恢复，
  1024 行已提交数据保留。已有未知 authority 两次检查、原文件保留与 Bootstrap capability gate 验收继续通过。
