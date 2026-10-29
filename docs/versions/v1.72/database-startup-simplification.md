---
document_type: implementation-plan
version: v1.72
status: implemented
last_updated: 2026-10-29
---

# 数据库启动减重实施与验收

目标来源是 2026-10-29 User 的完整要求：普通用户稳定打开；已有库失败保留数据并可恢复；不再为元数据/普通可用权限
设置自定义启动模板；完成实现、验证、PR Review/CI、合并和遵守当前宿主保护的本地安装。

基线 `4d3aba9a550f2798245a18af403d0cbaa7bea7f8`（开始时最新 origin/main），独立 worktree/分支
`rovai/database-startup-simplify`。原工作目录及其他任务分支保持。当前 v1.72/schema 168/receipt 218；不新增迁移、
不更改业务数据格式/模型上下文/Runtime 平台资格，不调整版本指针或发布版本。
最终构建已合入 main 的并行任务，包含 `1dfbd52e2`（PR #949）；未覆盖其 Renderer 改动。

## 阻断条件与数据保护归属

| 原条件 | 保护对象与处置 | 当前承担者 |
| --- | --- | --- |
| Core 目录 OS 排他锁 | 阻止同一库的重复业务执行，保留 | OS 锁 + Core lease |
| 路径类型、reparse/symlink、主文件被替换 | 防止写错对象或失联库，保留基本身份检查 | OS 句柄/NOFOLLOW + Core |
| 两个主库、无主库但有 WAL/journal | 不猜库、不删除可能承载已提交数据的日志，恢复面 | Core 路径选择 |
| main/WAL/journal 时间戳/长度/状态快照 | 正常元数据和 SQLite 恢复不代表数据危险，删除 | SQLite 日志/事务 |
| macOS provenance 特判与再准入预算 | 删除，无平台例外 | 同一读写连接 |
| 只读预审、关闭、重开、重复结构检查 | 删除；版本分类后直接复用连接 | SQLite + Core 版本检查 |
| 当前版本全部历史功能/receipt 校验 | 移到对应升级；当前仅 marker/最终 receipt/无未来 receipt/核心表 | 事务 marker + 最终完成记录 |
| 未知/未来版本、当前缺少完成记录 | 防止错误程序写入不兼容数据，保留拒绝 | Core |
| 逐版本 DDL/DML/marker/receipt | 失败回滚当前步，中断从已提交步骤续跑，保留 | SQLite IMMEDIATE 事务 |
| SQLite 损坏/实际读写失败 | 原库原地保留，诊断/重试，禁止空库替代 | SQLite/OS 实际错误 |
| 新库发布竞态 | 两 namespace 确认无 main/log 后 staging + no-replace | 原子文件发布 |
| Windows 已有 ACL 模板/owner/WRITE_DAC | 数据库/启动必需路径删除模板准入与修权 | OS 实际读写；新对象创建保护 |
| 凭据 private API、Runtime 授权边界 | 不因启动减重放宽，按调用点区分 | 专用存储/平台合同 |
| 旧 manifest identity/state | 仅已存在的旧切换恢复仍需辨别原库/新库，保留；读取 manifest、备份日志及恢复文件不检查 ACL 模板 | Legacy recovery + OS 实际读写 |

所有宿主经 `application::run_core` → DatabaseAdmission → Database/AuthorityMigrationRunner，共享锁/连接/迁移策略。
Desktop 窗口由 Electron 独立维持；SQLite 每次锁争用 5 秒等待，Core 不套恢复重试；Desktop 明确瞬时失败最多再启动一次，
间隔 250ms。CLI/Web/Server 原样传递结果。UI 沿用可响应加载画布与恢复入口，不显示技术阶段。

## 外部参考与未采用部分

- [AionUi 的 AionCore SQLite](https://github.com/iOfficeAI/AionCore/blob/main/crates/aionui-db/src/database.rs)：普通打开、SQLite 超时与迁移；不采用损坏库自动备份后新建的策略。
- [Codeg 数据库入口](https://github.com/spacering-net/codeg/blob/main/src-tauri/src/db/mod.rs)：SQLite WAL/5 秒等待，迁移连接后建立运行连接池；参考其直接操作数据库的原则，不把连接池数误述为一个连接。
- [Multica Server](https://github.com/multica-ai/multica/blob/main/server/cmd/server/main.go)：PostgreSQL 的瞬时故障有界重试，只参考重试归属。
- [Windows Fleet PR #943](https://github.com/murray17/rovai-ai/pull/943)：沿用实际权限原则，数据库/启动目录采用专用调用点，不修改公共 private API。

## 测试归属与退役

优先扩展现有 owner，不新增 Rust 测试函数。`database_admission::confirmed_absence_initializes_and_reopens_a_current_authority`
覆盖首次/当前/原数据、真实 macOS main/WAL xattr、连接间合法提交、短锁等待与持续 busy、未来版本/缺最终 receipt/
双主库/损坏不覆盖；Windows 同一 owner 覆盖继承权限、额外 ACE、可写但无 WRITE_DAC、实际只读失败及 ACL 未改写。
孤立 WAL owner 扩为两 namespace 的 WAL/journal 表驱动；SQLite crash writer 保留真实进程强杀的 DELETE/WAL 恢复和已提交行。
Core lock 原有两个 Windows 拒绝继承 ACL 的 owner 改验正常获取、第二实例拒绝与释放后再获取。

迁移原位 owner 保留所有历史来源矩阵、会话/草稿保留；process-kill owner 保留 reconciliation、提交后续跑和旧 switch 两侧。
路径变动 owner 保留主文件移除/替换/另一 namespace，以及最终迁移后移除/替换不创建空库。
退出的 case 是 sidecar 状态变化与已删除的 reopen 边界，不再以正常日志变化作为身份攻击。

退役 `changing_an_orphan_shm_invalidates_the_ticket_instead_of_deleting_it` 与
`read_probe_tolerates_only_a_new_empty_wal_not_authority_changes`：相应文件状态票据、只读预审与 macOS 特判生产代码已删除，
有价值的日志恢复/原数据保留由上述 crash/metadata/absence owners 继承。
退役 `admitted_migration_rechecks_contract_schema_and_exact_receipts_before_writing`：快照票据/schema-cookie/applied-at
重比合同已退出；源版本合法性、每步事务回滚、未完成迁移续跑及路径保护仍由原位/rollback/kill owners 承担。
既有历史迁移测试未取消或降级；深度验证不移到健康打开。

最小命令：`cargo test -p rovai-core --lib --features extended-tests database_admission::`、
`cargo test -p rovai-core --lib --features extended-tests authority_migration::`、`pnpm test:core-startup`、
`pnpm test:host-startup`、CoreClient Vitest。提交前默认 `pnpm test:rust:pr`、typecheck 和通用 docs gates。
原生 Windows 通过 Full check 的 windows-runtime scope 执行权限/SQLite/迁移 owners，不以跨平台模拟替代。
所有自动 fixture 使用临时 data/Skill Library/MCP 和按实例派生的独立 Runtime Files Root，不连接真实模型。

## 独立 Review

使用 code-review Skill，对固定基线到 `7872ec20b` 分别进行 Standards/Spec 审查。
Standards 2 项：Windows 持锁文件意外共享删除、身份观察吞 I/O 原因；Spec 2 项：WAL 启动写 busy 不可重试、同一 I/O 分类问题。
`35adf7308` 修复全部三项独立问题，两个方向复核均无未解决发现。补充了 Windows 持锁改名拒绝、WAL BEGIN IMMEDIATE
持续占用可重试以及 TEMP 表证明配置阶段保持同一连接的验收。Review 是代码结论，不能替代原生执行结果。测试专用的 Windows ACL 设置顺序和 live-handle 夹具调整 `d91db3093` 再经 Standards 复核无阻断。

Windows 原生迁移暴露的旧恢复 ACL 模板遗漏在 `de9d24942` 修正，Standards/Spec 均复核无阻断。
旧测试 writer 先重建其原本要求的 private root，真实强杀后启用继承 ACL，再走生产恢复；长短路径按 canonical identity
比较。强杀测试并行读取 stdout/stderr，避免 Windows 小管道阻塞；60 秒仅是到达 failpoint 的看门狗，超时仍强杀并报错。
`e833043a0` 进一步保留恢复 helper 的原生 I/O 错误，真实独占打开 manifest 的断言要求可重试，释放后继续恢复数据；Spec 复核确认关闭旧限制。

## 验收与交付记录

已完成：

| 验证 | 结果 |
| --- | --- |
| macOS admission owners | 10 passed；真实 main/WAL provenance xattr、DELETE/WAL crash recovery、短锁/持续读锁/持续 WAL 写锁、原库保留、TEMP 表连接复用 |
| macOS migration owners | 7 passed；历史来源矩阵、事务回滚、断点续跑、旧 switch 两侧、metadata 与路径保护；恢复修正后再跑相关 4 项通过（含真实强杀，126.27s） |
| 默认 Rust workspace | `RUST_TEST_THREADS=2 pnpm test:rust:pr`：431 + 31 + 4 + 11 = 477 passed、1 existing ignored，无失败 |
| Supervisor | 21 passed；一次自动重试、显式重试重置、generation 与已见 authority fence |
| Host 进程 | 2 passed；首次显式初始化、第二实例拒绝、停机结算与重开 |
| Server / Web | 原生 standalone Server 首次启动、HTTP 协议 v5 登录/成员及 navigation 读取、重开后 roster 完全保留，见 [报告](../../../.github/assets/database-startup/server-macos.json) |
| Core 恢复进程 | 2 passed；实际恢复错误进入结构化恢复入口，已见库缺失不建替代空库 |
| Renderer 启动呈现 | 1 passed；真实 Electron 的首帧画布与恢复门禁 |
| typecheck / docs | typecheck、docs:test、docs:check、docs:check:ci、Rust format/check 通过；PR CI 采用相同通用门禁 |
| macOS arm64 daily 包 | 最终生产代码 `e833043a0` 构建、App/Host/CLI 签名架构门通过；隔离打包 App 首次初始化、带来源标记重开、成员/Thread 保留、quick_check=ok |
| 打包窗口锁等待 | Core starting 时 Renderer 300ms 内产生 17 个 animation frames；释放 WAL 写锁后直接 ready，无用户重试 |
| Windows | 原生 Windows Server 2022/x86_64：admission 10、migration 6、instance lock 4 项通过；真实继承权限、额外 ACE、无 WRITE_DAC、只读失败、WAL/journal crash、manifest sharing conflict 和恢复覆盖，见 [最终代码原生 CI](https://github.com/murray17/rovai-ai/actions/runs/40848570364) |

[macOS 打包报告](../../../.github/assets/database-startup/packaged-macos.json)与[截图](../../../.github/assets/database-startup/packaged-macos.png)
使用完全隔离 data/Skill Library/MCP，没有真实模型请求。物理系统主动写入 provenance 的事件未重复触发，证据是原生
setxattr 注入同名属性与真实 ctime/WAL 变化；Windows GUI、真实日常宿主重启不在已验证项内。原生 Windows runner 的组授权会让仅改 Allow ACE 的夹具仍持有 WRITE_DAC；
权限矩阵用 [icacls 的显式 WDAC deny](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)
固定该条件，同时保留普通读写/删除，避免以模拟布尔值冒充真实权限。
前一完整原生矩阵 [40846645109](https://github.com/murray17/rovai-ai/actions/runs/40846645109) 也通过；最后代码为
`e833043a0`，之后仅 Rust 格式及验收文档调整。早期原生失败用于修正真实恢复入口及夹具，未跳过权限/迁移 owners。

早期默认 Rust 同时与 Release 编译运行时，两项既有短时限进程测试超时；降低测试并发后完整 workspace 通过，未改测试阈值。
全量 `core-startup-availability.test.mjs` 有 6 项失败（含父套件），保存的未修改基线二进制复现相同失败：旧草稿 RPC、
已迁出的 Runtime 环境设置、Skill 故障位置断言及旧 sandbox probe。它们不属于本次数据库变更，未静默跳过或改成成功；
相关恢复 seam 单独执行并通过。首次 Renderer fixture 超时，Electron 下载/构建完成后原命令通过。

## 健康库耗时与连接流程

[可重跑的配对脚本](../../../.github/assets/database-startup/measure.mjs)和[原始结果](../../../.github/assets/database-startup/macos-arm64.json)：
macOS arm64、Node 26.12.1、相同健康临时库、debug Core+同版本 CLI，基线 `4d3aba9a` 对生产代码 `35adf7308`；
排除首次建库与 executable warmup，AB/BA 交替各 9 次，仅计 spawn → Core ready，不包含模型或日常会话。

| 指标 | 修改前 | 修改后 |
| --- | --- | --- |
| 启动中位数 | 122.73ms | 101.27ms（减少 17.5%） |
| 9 次范围 | 119.09–135.37ms | 95.45–105.99ms |
| 数据库阶段中位数 | 只读 assessment 14ms + 正式 open 17ms | 单次 open/version 8ms + configuration <1ms |
| 当前库连接流程 | 只读探测 → 关闭 → 读写重开 → 重验 | 一次读写连接 → 版本 → 运行配置 |

没有观察到健康库启动回退；不把这一小样本结论推广成所有机器或冷启动保证。TEMP 表跨接口断言直接证明同一连接被保留，
源码删除旧快照/重准入路径，trace 不只是改名。首次初始化仍为安全 staging/publish 保留必要连接，历史 manifest 恢复除外。

## 安装与回滚边界

[PR #948](https://github.com/murray17/rovai-ai/pull/948) 面向 `main`，记录最终 CI 与合并状态。
完整包验收先于安装；非终止安装结果、精确备份路径、旧 App/Core 存活和日常数据只读核对结果归本次 Thread 交接，
不把日常个人数据或进程记录提交到公开仓库。

日常 App 是当前会话宿主；安装不得自动结束现有 App/Core/Runtime。必须先完成隔离安装包打开验证，再按非终止安装流程
备份并替换 bundle，保留旧运行进程直到用户正常退出。没有新宿主实开证据时明确标为待验证，不把 bundle 安装成功称为重启完成。
回滚使用安装前的 App 备份或同 schema 的基线程序；不回滚/删除数据库或日志。旧程序可能恢复原元数据误阻断。
