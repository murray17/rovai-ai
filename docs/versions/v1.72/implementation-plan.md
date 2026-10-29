---
document_type: implementation-plan
version: v1.72
authority: version-implementation-and-acceptance
status: in_progress
last_updated: 2026-10-29
---

# v1.72 实施与验收

## 数据库启动减重（2026-10-29）

实现与验收归 [数据库启动实施记录](database-startup-simplification.md)；替代本页旧 macOS 来源标记重新准入方案。
当前合同为 [Desktop Runtime Availability v3](../../contracts/desktop-runtime-availability-v3.md#数据库启动与有界重试)，
不新增 Migration、不改业务格式。日常宿主保护与原有会话保留是交付边界。

## 手动停止保留执行条（2026-10-29）

- Worktree：`../rovai-ai-retain-stopped-run`；
  分支 `rovai/retain-stopped-run`，基线 `4d3aba9a550f2798245a18af403d0cbaa7bea7f8`；Governance：none。
- 沿用现有公开 Run 投影、继续命令与样式，手动停止保留静态状态和最终耗时；停止／失败的操作只显示图标。
  每位队员保留最新未受理继续的停止／普通失败，输入过大拒绝仍保留原输入详情且不可重试。
- 停止条跟随最后回复／完整产物组，没有输出则留在启动锚点；保留期间省去重复中断标记。
  `hasAcceptedContinuation`、缓存首屏门禁与新 Run 替换负责跨会话／刷新收起，不新增状态或存储。
- 已通过类型检查、全部 Vitest（3022 passed / 2 skipped）、文档治理单测与上述基线的差分门禁。
  presence 浏览器 owner 独立通过 38 个状态、6 个视口以及停止／继续／刷新链路；
  [日夜截图](../../../.github/assets/run-stop-retained/README.md)使用真实组件与固定演示数据。
- `pnpm test` 的 Node 层为 357 passed / 2 skipped / 1 failed：Product Contract Fingerprint
  固定期望 schema 167，当前源码为 168。聚合 `test:run-presence-ui` 的 reply-details 在
  `regroup-middle` 断言失败。两者均在未改动基线 `4d3aba9a5` 独立复现；不改写无关断言。
- 默认 Rust workspace PR 回归 `pnpm test:rust:pr` 通过。审查补齐了停止条未知回执保持普通入口，
  以及 Applied 回执先于权威投影时同时恢复历史中断标记的边界；对应浏览器回归覆盖同一 commandId 核对。

## Windows Fleet 记录存储修复（2026-10-29）

- 基线 `6996d1042`，分支 `codex/fix-windows-fleet-storage-942`。复用当前 checkout 与本地构建缓存；
  Windows 验证只使用临时目录和隔离 Core/Skills/MCP/Runtime Files Root，不访问日常会话数据或真实模型。
- Issue #942 已确认 Fleet 初始化失败导致 Core 退出，但现场缺少底层 cause。此前本地已复现当前用户与
  SYSTEM 均有 FullControl、目录缺少继承标志时的相同退出；不能将本地复现当作用户现场原因已确认。
- Windows Fleet 直接创建目录，记录写入使用普通权限的新建临时文件、flush 和 write-through 原子替换。
  移除仅为 Fleet 使用的旧权限迁移；其他私有存储、凭据、IPC、Job、非 Windows 行为保持。
- 原 `windows_owner_registration_admits_only_private_or_legacy_inherited_storage` 在同一 seam 改为
  `windows_owner_records_use_effective_file_permissions_without_rewriting_acls`，测试函数数量不变。
  旧 ACL 模板拒绝与修权断言随对应合同退出；保留新建、继承和旧 scoped record 的 case，并加入
  FullControl 无继承、多余 ACE、无 WRITE_DAC 但可读写、真实写入/替换失败及原记录保留。
  实际注册、stop receipt、重建 Store 和 cleanup ACK 经过生产方法，避免只测试底层文件 helper。
- 最小命令：`cargo test -p rovai-core --features extended-tests --lib runtime_fleet::tests::windows_owner_records_use_effective_file_permissions_without_rewriting_acls -- --exact`。
  相关 Fleet 生命周期、私有存储/Windows 安全、默认 workspace 与文档门禁继续执行。
- Windows 本机定向验证：上述 owner 修复前以 `private_acl_invalid` 失败，修复后通过全部权限与失败保留 case；
  Fleet 23 项、platform 10 项、ManagedProcess 14 项通过（7 个独立 helper 入口按原规则忽略）。
  `cargo fmt --all --check`、`pnpm docs:test`（10 项）、`pnpm docs:check` 与带基线的 `pnpm docs:check:ci` 通过。
  完整 workspace、隔离 Core 启动对比和远端 CI 的最终回执记录在本次 PR；不将 fixture 结果宣称为真实模型验收。

## macOS 来源标记启动修复（2026-10-28）

- 分支 `rovai/macos-wal-provenance`，基线 `c4dedf32683179070ee90e72eb1e6a1161c8228f`。
  工作使用独立 worktree；所有复现均为合成 SQLite、独立 Skills/MCP 与 Runtime Files Root，不复制日常会话数据。
- 0.5.1 与 0.5.2 tag 的 admission/migration 校验没有差异。原规则只观察 main 的 provenance，漏掉 WAL/journal；
  current authority 的 READ_WRITE open 也没有迁移路径已有的来源标记重新准入。
- 在已有合成数据库保留 32,992 字节已提交 WAL，安装版 0.5.2 首次打开返回 `identity_changed`。
  WAL 的对象、长度、mtime 未变，`com.apple.provenance` 从无到有、ctime 改变；数据完整性检查通过。
  这属于 macOS 文件元数据兼容问题，不能归因于数据库损坏或本轮 schema migration。
- 修复扩展同一 artifact 判定到 main/WAL/journal，existing open 在写入前消费旧证明、完整重新准入一次并严格
  复核新票据。未知标记、权限/属主/mtime/长度/对象变化、另一 authority 出现及真实写入仍拒绝。
  Windows 的 last-write/size 比较不变；没有把本机 macOS 结果当成 Windows 真机验收。
- 沿用 `read_probe_tolerates_only_a_new_empty_wal_not_authority_changes` 扩展 artifact 与拒绝条件矩阵；
  修复前 WAL case 明确失败。沿用 `confirmed_absence_initializes_and_reopens_a_current_authority`，
  复用原 SQLite fixture 验证只读探测重新准入、读写打开重新准入、真实写入仍拒绝、业务行与生产连接配置保留。
  新增 Rust 测试函数为零。最小命令为 `cargo test -p rovai-core --lib database_admission::tests::`，12 项通过。
- 原生进程复验将安装版 Host 的来源标记复制到临时修复版 Host，使 macOS 在同一合成场景实际添加数据库标记。
  main 与非空 WAL 均出现来源标记，二者对象、长度与 mtime 未变，修复版首次即 `ready`、无需手动 Retry；
  关闭后只读验证业务行仍为 `preserved`、SQLite `quick_check` 为 `ok`。未带来源标记的调试 Host 也能启动，
  但那条未触发系统标记的路径不作为本回归的充分证据。
- 既有迁移来源标记回归通过（`cargo test -p rovai-core --features extended-tests --lib
  authority_migration::tests::macos_provenance_added_after_ticket_is_readmitted_without_losing_business_data -- --exact`）。
  默认 `cargo test --workspace` 的 Core 为 434 passed / 1 failed / 1 ignored；唯一失败为既有
  `successful_leader_with_stdio_holding_descendant_finishes_bounded` 的 500ms stdout cleanup 超时。
  未修改 main 与修复分支的同一 owner 各做三次交替对照，均为一次相同超时、两次通过，证实既有时序不稳定；
  保留失败记录，不改写或跳过该 owner，也不将整套回归记为全绿。随后单独补完 CLI 31、Host 4、Web 11 项，全部通过。
- `cargo check --workspace`、`cargo fmt --all --check`、`git diff --check`、`pnpm docs:test`、
  `pnpm docs:check` 和以本节基线为 `DOCS_BASE_REF` 的 `pnpm docs:check:ci` 通过。
  安装与正式发行是独立交付边界，以上结果不代表已经发布修复版或完成 Windows 真机验收。

## MCP Run 快照与 Grok 启动清理（2026-10-26）

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-mcp-run-snapshot`；
  分支 `rovai/mcp-run-snapshot`，基线 `db8cd6e34aa9e0348fa750020105acf8f04869fd`；Governance：none。
- 共用 effective-config 构造入口写入 `mcpSnapshotLayout: "run_v1"` 并参与原摘要；
  缺标记走旧布局，未知值只在该 Run 准备时拒绝。恢复、重绑定和历史记录不回填。
- 新路径为 `runtime/mcp/<run-id>/snapshot/canonical.json`，沿用私有临时目录与目录发布；
  新布局不扫描旧 epoch。竞争失败方读取并校验胜出文件，已有快照不覆盖；格式、摘要和冻结恢复保持。
- 并发回归实际复现 Unix `mkdir` 到 `chmod` 之间的权限窗口；既有目录准备函数改为创建时设置
  `0700` 并复核权限。只在目录提交竞争失败后复用胜出文件，不掩盖本次写入或同步错误。
- Grok 的生成与清理共用新前缀常量，沿既有 Adapter 初始化门禁执行。旧插件目录不动，
  正常 Host 生命周期与复用保留，清理失败仅影响对应可选 Runtime 子系统。
- Contract 与外部 MCP 架构不变量同步；不新增迁移、注册器、后台服务、租约或数据库字段。

验证归属：

- 扩展既有 Context MCP 恢复 owner：真实创建与 Manifest 持久化、旧布局缺标记、新布局、数据库重开、
  跨 epoch、未知布局拒绝、冻结材料丢失和隐藏 staging 回收；SQLite/文件边界不能由纯解析测试代替。
- 扩展既有 Runtime rebind、MCP epoch 复用和 Grok 插件生命周期 owner；保留其原有权限、凭据、
  原生配置与旧布局断言，新增 Grok Adapter 初始化接线与旧前缀保留检查。
- 原 Pi optional-storage owner 扩展为 Pi/Grok 矩阵，并更名为
  `private_storage_failure_is_isolated_from_core_and_peer_runtimes`：保留失败隔离，补齐健康子系统
  不重复初始化、失败后原进程重试和恢复健康；没有新增可选服务或失败全局升级。
- 既有 Node `optional startup failures` 进程矩阵增加 Grok 的 `external-mcp` 非目录故障；
  用真实隔离 Core 验证 authority ready、业务 RPC 与同进程恢复，不调用真实模型。
- 唯一新增 `concurrent_run_snapshot_publishers_reuse_one_complete_winner`，位于 `extended-tests`：
  两个文件发布者必须读到同一完整快照；原先只存在顺序 epoch 复制 owner，不能证明并发原子发布。
  只创建私有临时文件，不使用数据库或真实 Runtime；同时验证损坏胜出文件和错误 Run 身份拒绝。
- 最小命令：`cargo test -p rovai-core --features slow-tests --lib mcp`、
  `cargo test -p rovai-core --features slow-tests --lib rebind`、
  `cargo test -p rovai-core --features slow-tests --lib private_storage_failure_is_isolated`。
  另运行 `pnpm test:core-startup`、默认 workspace、扩展回归与通用文档门禁。
- 上述三个定向 Rust owner 分别通过 39、5、1 项；`pnpm typecheck` 与 `pnpm test` 通过，
  包括 Vitest 3005 passed / 2 skipped、Node 358 passed / 2 skipped。
- `pnpm test:rust:extended` workspace 1075 passed / 8 ignored；`pnpm test:rust:pr` workspace
  477 passed / 1 ignored。ignored 均为既有用例。
- 真实隔离 Core 的新增 Grok 启动故障、业务 RPC 可达及同进程恢复场景通过。完整
  `pnpm test:core-startup` 为 7 passed / 6 failed / 1 skipped；未修改基线的独立源码归档构建
  为 6 passed / 6 failed / 1 skipped，复现相同五个叶子失败与一个父测试失败：原生 sandbox
  Probe 未生成结果、Skill 故障夹具未降级、两个已移除的 `camp.composerDraft` RPC，以及旧 Runtime
  environment settings 接口。没有修改、跳过或移除这些既有测试，不将整套启动验收记为通过。
- `cargo check --workspace`、`cargo fmt --all --check`、`git diff --check`、`pnpm docs:test`、
  `pnpm docs:check` 和以本节基线为 `DOCS_BASE_REF` 的 `pnpm docs:check:ci` 通过。
- 初次交付状态：`ready`。提交并推送功能分支，保留该 worktree 供后续评审；按当时 User 偏好不自动创建 PR。
  未调用真实 Grok 模型、未做 Windows/Linux 实机验收，也未合入或安装日常 App。
- 后续 User 明确授权创建 PR、合入 main 并安装本机 App。整合主线 `71f915be4` 时只需合并新增文档章节，
  保留双方记录；本次生产代码没有冲突。安装遵循 daily 构建、隔离验收及非终止交接流程。

## 简化对话命名恢复（2026-10-27）

- User 确认 HTML 交互稿并授权独立 worktree 实现、PR 到 main 并合入。
- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-automation-title-simple`；
  Branch：`rovai/automation-title-simple`；Base：`f73a70cf675142313b23f4f90c63727db24acbb5`；
  Governance：none；Status：ready。
- 共享编辑器恢复默认折叠入口：日期/时间两个勾选、前后分段单选与完整实时预览，复用已确认的样式。
  保留生产总览、保存与通知行为；交互稿的主题切换工具、模拟运行提示和示例数据不进入产品。
- Core 恢复 admission 标题生成，定时取计划时间、手动取实际时间；格式固定为 `YYYY-MM-DD` / `HH:mm`。
  存取结构沿用 schema 165，格式枚举收敛为 `iso` / `24`；无迁移、回填或旧格式兼容逻辑。
- Rust 不新增、删除或禁用测试函数。既有纯命名 owner 覆盖四种勾选组合、前后位置、零点/正午、Unicode、
  closed schema；旧格式正例随生产枚举退出，改为拒绝输入断言。既有 manual snapshot/replay、once overlap
  与 delayed schedule owners 覆盖时间来源、长标题、关闭两项、历史保留及 schedule 不变。
  最小命令：`cargo test -p rovai-core --features extended-tests --lib automation`。
- 生产 Electron fixture 扩展既有 owner：勾选/键盘单选、自动保存失败与重试、任务切换、五主题 action 色、
  最小详情宽度、1040/1440/2560 窗口与 200% 缩放；独立临时 userData/Skill Library，无真实 Runtime。
- 验证通过：`pnpm typecheck`、`pnpm test`（Vitest 257 文件 / 3007 passed / 2 skipped；Node 358 passed / 2 skipped）、
  `pnpm test:automation-splitter`；Core automation 定向 16 passed；`cargo test --workspace`
  478 passed / 1 ignored；跳过和忽略均为既有平台/人工用例。
- `cargo fmt --all --check`、`git diff --check`、`pnpm docs:test`、`pnpm docs:check` 和基于本节 Base 的
  `pnpm docs:check:ci` 通过。Day/Night、最小详情宽度与 200% 缩放截图已核对。
  本次不安装本机 App、不发布版本。

## 定时任务对话命名（2026-10-26）

本功能初次实现及颜色修正分别经 PR #913、#915 合入。User 随后要求先隐藏功能，并明确
“同时停用日期标题，恢复任务名”；以下保留该次停用与初次交付记录；当前开放状态见上方 2026-10-27 恢复记录。

- 本次 worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-disable-automation-titles`；
  分支 `rovai/disable-automation-titles`；基线 `17a7fbba9dc55dbff1ad77837033968decef5b63`；
  Governance：none；Status：ready。User 已授权 PR 合入 main、安装本机后停止，交互稿后续再讨论。
- Desktop/Web 的共享编辑器撤下命名入口；Core 的手动和定时 occurrence 均直接采用任务名。
  已有 schema 165 不回退；本次没有迁移、历史数据回填或新增兼容分支。
- 不新增、删除或禁用 Rust 测试函数：扩展既有 manual snapshot/replay、once overlap 和 delayed schedule
  owners，验证默认配置、保留的非默认配置、80 个 Unicode scalar 名称均不加日期，重放和已有标题不变。
  标题时间来源断言随该生产行为停用而替换；计划推进、去重、CAS 和 overlap 断言保留。
  最小命令：`cargo test -p rovai-core --features extended-tests --lib automation`。
- 生产 Electron fixture 改验入口隐藏，并保留保存失败、手势取消、主题、宽度与缩放验收。
  `pnpm typecheck`、`pnpm test:automation-splitter` 已通过；使用独立临时 userData 和 Skill Library，
  memory-only RPC，无真实 Runtime。Day 与窄屏截图已人工核对。
- Core automation 定向回归 16 项通过，`cargo fmt --all --check`、`git diff --check`、
  `pnpm docs:test`、`pnpm docs:check` 及基于本次基线的 `pnpm docs:check:ci` 通过。

初次交付记录：

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-issue-875-automation-title`；
  分支 `rovai/issue-875-automation-title`，基线 `db8cd6e34aa9e0348fa750020105acf8f04869fd`；Governance：none。
- Core 持有命名配置，创建 occurrence 时按定时/手动来源生成并持久化标题；Renderer 只提供格式预览和编辑。
  默认日期+时间后置，支持四种日期、三种时间格式，允许完整长标题；旧对话不变。
- Migration 215 原子新增定义配置并将当前 schema 升为 165。既有定义默认开启；不补写旧 Thread/occurrence。
  Agent automation 输入/输出保留原形状，旧命令 canonical payload/digest 与历史回执保持兼容，
  没有 Bootstrap、Context、Manifest 或工具目录版本变化。
- Rust 扩展既有命名纯函数 owner、manual snapshot/replay owner、once overlap/time-source owner 和 current schema
  admission owners。新增一个 schema-only migration owner，独立验证 DDL/receipt 回滚、旧标题保留与生产重开；
  其他 owner 无法证明升级失败语义，不启动 Runtime。最小命令：`cargo test -p rovai-core --lib automation`，
  `cargo test -p rovai-core --features extended-tests --lib database_contract` 和 `cargo test -p rovai-core --features extended-tests --lib current_schema_contains_required_contract_objects`。
- 前端扩展生产 Automation fixture，覆盖保存失败保留、重试、重新进入、键盘单选、五套主题、最小宽度和缩放。
  格式矩阵使用纯函数单测；共享表单类型检查、语言目录和通用文档门禁同步验证。
- 已通过 Core automation 16 项扩展回归（包含旧版迁移、原子性、重放与新配置），migration admission matrix、
  当前数据库准入/结构、旧 Team schema 升级各 1 项；`cargo check --workspace` 与 Rust 格式检查通过。
- `pnpm typecheck`、11 项定向 Vitest、生产 Electron fixture、文档单测及基于上述基线的通用文档门禁通过。
  fixture 使用新建的临时 userData/Skill Library，memory-only RPC，无 Core/真实 Runtime；五套主题、
  320px 详情、700px 窗口和 125% 缩放截图已人工查看。
- 初次全量 Vitest 与 Rust workspace 编译并行时，既有 `core-client` 启动重试的 6 秒等待超时
  （3006 passed / 1 failed / 2 skipped）；该文件及实现与基线相同，单独复测 21 项全部通过。
  后续完整 `pnpm test` 通过：Vitest 3007 passed / 2 skipped，Node 358 passed / 2 skipped，
  文档、Skills 和 Electron sandbox 检查全部通过。schema fingerprint owner 已同步到 165。
- Worktree 状态：ready；User 已授权创建 PR 并合入 main，[PR #913](https://github.com/murray17/rovai-ai/pull/913)
  待 CI 通过后合并并清理 worktree。Issue #875 保持开启至发布；issue 回复先提供署名爱丽丝的草稿。

## Runtime PATH 与主动检查一致性（2026-10-26）

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-issue-891-runtime-path`；
  分支 `rovai/issue-891-runtime-path`，基线 `db8cd6e34aa9e0348fa750020105acf8f04869fd`；Governance：none；Status：ready（未合入）。
- Issue #891：启动复用公共采集策略，macOS/Linux 只采集交互式登录 shell PATH；主动单项检查总是先刷新。
  旧 `interactiveShell` 字段兼容接收，策略由 Core 决定。Windows、超时、输出处理、回退和候选排序沿用原实现。
- 环境输入比较、未变代次、发布时重读最新配置、结果围栏和检查合并保持；普通运行不逐消息重扫，
  不增加全局检查门禁或持久环境。额外变量继续由用户的通用／队员配置承接。
- 更新 [Runtime Launch v73](../../contracts/runtime-launch-and-verification-v73.md) 及当前 Architecture／路由；
  v64 已接受语义保留，由 v73 替代其检查复用规则。局部可逆修复，不新增 Version Decision。
- 扩展既有 shell capture 与 `runtime_check_environment::tests` owners，替换旧跳过刷新断言，
  保留原并发、配置保存、文件身份与草稿隔离；Rust 测试函数净增零。
- 定向验证通过：`runtime_check_environment::tests` 8 项、`runtime_discovery::` 12 项、
  `member_environment::tests` 4 项，以及 `launch_version_uses_the_frozen_program_without_blocking_ordinary_execution` 1 项。
  使用 `cargo test -p rovai-core --features slow-tests --lib runtime_check_environment::tests -- --list`
  确认 owner 已编译，再执行同一测试二进制的各过滤器。慢速刷新夹具默认线程栈发生溢出，
  设置 `RUST_MIN_STACK=33554432`、`--test-threads=2` 后 8 项全部通过；没有改变生产线程栈或测试断言。
- `pnpm test:rust:pr` 默认 workspace：477 passed / 1 ignored；`cargo check --workspace`、
  `cargo fmt --all --check`、`pnpm typecheck`、`pnpm docs:test`、`pnpm docs:check` 及以上述基线执行的
  `DOCS_BASE_REF=<base> pnpm docs:check:ci` 均通过。
- 完整 `pnpm test`：256 个 Vitest 文件、3005 passed / 2 skipped；末组脚本 358 passed / 2 skipped。
  首次执行的文件预览 watcher 用例等待通知超时，单独复跑和完整复跑均通过，未修改该功能。
- 验收只使用既有临时数据库与合成程序；未执行用户实际 asdf 安装、Dock 重启或真实模型任务，
  也不代表 Windows/Linux 真机验收。后续复用本 worktree；依用户偏好提交并推送任务分支，不自动创建 PR。
- 评审后补齐 shell 采集的总期限：原实现只限制主 shell 等待，退出后的 stdout reader join 可能被
  后台进程持有的管道拖住。采集函数改为非阻塞读取，进程退出与 EOF 共用原期限；失败时关闭管道并
  终止采集进程组，尚未回收的主进程交后台 wait，不让收尾继续阻塞调用方。保留原输出上限、标记解析及回退。
- 在原 `shell_path_capture_uses_interactive_login_and_bounds_failures` owner 内补入 shell 退出后
  后台进程持有 stdout 的成功／失败场景，以及缺失标记、输出超限；不增加测试函数或环境管理机制。
  修复前新增回归在 100 ms 期限下等待约 3.5 秒后错误返回 Captured。
- 用同一采集函数构建隔离探针，`HOME`／`ZDOTDIR` 指向本 worktree 的临时目录，`.zshrc` 运行
  `/bin/sleep 5 &`：`5d937a757` 返回 Captured / 5463 ms；修复后返回 TimedOut / 3000 ms，空结果交给原回退。
  探针没有启动 App、Core 或真实 Runtime，也没有修改日常 shell 配置。
- 追加修复复跑 `pnpm test:rust:pr`：477 passed / 1 ignored；`cargo check --workspace`、
  `cargo fmt --all --check`、`pnpm docs:test` 与 `pnpm docs:check` 通过。本次没有前端改动，未重复前端整套回归。
  最小复验为 `cargo test -p rovai-core --lib shell_path_capture_uses_interactive_login_and_bounds_failures`。

## Run 启动与停止展示（2026-10-26）

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-run-start-stop-ui`；
  分支 `rovai/run-start-stop-ui`，基线 `e5b80b28408fcb73d82058b1d7e45730d088ba57`；Governance：none。
- 只修改前端共享展示及组件。Run 创建与 Runtime 初始化统一“启动中…”，Delivery 默认“准备中…”，
  执行台已有的同队员执行／清理事实沿用“排队中”，具体原因降为悬浮说明。
- Run Card 复用启动与执行布局；停止提交时隐藏停止按钮，只在卡头显示中性文字，保留既有过程。
  单聊移除有色提示，步骤组保留原摘要，终态不被本地停止标记覆盖。图标保留时间线。
- 不增加 Core 读投影或业务字段，不改变调度、取消、恢复与 cleanup；不建立全局阶段引擎。
- 验证沿用现有展示单测、真实组件浏览器测试、类型检查及通用文档门禁；本次没有 Rust 变更。
- 已通过 `pnpm typecheck`、完整 Vitest（3005 passed / 2 skipped）、`pnpm docs:test` 与基于上述 SHA 的
  `pnpm docs:check:ci`。`execution-state-transition` 浏览器回归通过；生产组件的 Desktop/Web 启动、
  当前轮次内容、停止悬浮、取消终态及日夜字体检查通过，状态图标仍在时间线。
- `test:run-presence-ui` 中独立的 reply-details 导航用例在 `scroll-after-opening` 场景等待
  `[data-reply-message-id=reply-a]` 超时；任务分支和未改动的 `e5b80b284` 前端基线均复现，
  作为既有回归问题记录，不修改回复定位逻辑。

## 撤回消息两分钟重新编辑（2026-10-23）

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-withdraw-reedit`；
  分支 `rovai/withdraw-reedit`，基线 `984e82281ee57c5b33ac5ec320d1e4bf52e4cf4a`；Governance：none。
- `MessageReeditStore` 拥有逐条本机副本、pending / ready 固定有效期、容量保护和每前端实例一个清理器。
  读取／回放按 scope 隔离；清理可回收旧 scope 的过期副本，不删除普通草稿或提前淘汰有效副本。
- `MessageWithdrawal` 保存原命令与参数并复用已有回放；请求未知保留 pending，业务拒绝删除，
  正常成功与列表刷新分开处理。存储失败不阻止撤回，不增加通用命令队列或重试平台。
- 正式消息区提供蓝色无下划线入口；已有草稿先确认替换，最终回填再读有效期。只恢复正文和显式成员 @，
  保留当前附件／引用／回复元数据；默认显示 @ 不带回。撤回与到期不主动结束 ↑↓ 历史预览。
- [Message Reedit v1](../../contracts/message-reedit-v1.md) 固定客户端合同；Core、数据库、原撤回命令、
  模型上下文保持原状。交互稿 v4 直接构建正式恢复模块和组件，仅使用合成 transport 与独立存储。
- 容量为最佳努力占用限制，不预留普通草稿配额；多窗口不新增锁、跨窗口事务或全局调度服务。

验证与交付状态：

- `pnpm typecheck`、`pnpm build:desktop` 通过；后者包含 Web 构建。
- `pnpm test` 通过：254 个 Vitest 文件、2934 项通过、2 项既有跳过；后续 Node 套件
  358 项通过、2 项 Windows 专用验证跳过；包含文档与 Skill 通用门禁。
- `pnpm test:message-reedit-ui` 通过夹具类型检查及 11 组真实组件交互：确认取消／替换、
  回填后普通草稿与到期分离、默认／显式 @、重启不续期、弹窗跨期、两阶段存储失败、
  撤回成功但刷新失败、拒绝与未知回执、历史浏览保留／接管、实际同源第二窗口通知和日夜主题。
  已人工核对截图；仅使用隔离 Chrome 和合成 transport，没有启动日常 App、Core 或真实 Runtime。
- `pnpm test:rust:pr` 默认 workspace 475 项通过、1 项既有 ignored；未修改 Rust 或测试 owner。
- `pnpm docs:test`、`pnpm docs:check` 与以本节真实基线执行的 `pnpm docs:check:ci` 通过，无治理例外。
- 工作树状态 `ready`；交付功能分支和由正式组件构建的 HTML v4，保留 worktree 等待后续评审。
  按 User 既有偏好只推送分支，不自动创建 PR 或安装日常 App。

### 评审后恢复边界修正（2026-10-23）

- 继续使用上述 worktree / 分支；评审基线 `e356d2a121ce6a0d4ccdc33d364e9e872b1385b0`。
  新增真实 `ConsoleClient → ThreadAdapter → MessageWithdrawal → MessageReeditStore` 组合复现：
  原 Promise 在第 90 秒由补查完成时，旧实现错误延长到第 210 秒。另两项无副本重试在旧实现均换 ID，
  修复前对应 3 项断言失败；不将原有重试缺口描述为新增重复撤回漏洞。
- 沿现有命令恢复路径携带客户端 `direct / recovery` 来源；补查、Core 错误后补查和显式重放均使用
  原 pending 剩余窗口，正常直接响应仍从确认成功开始两分钟。原请求、Core 回执与持久化格式不变。
- 当前撤回实例仅在内存保留未知请求身份与原参数，不依赖正文副本；成功或拒绝后清理。
  没有跨重启保证，也没有新增自动重试队列。副本过期后的显式重试不能重新创建正文副本。
- 复用 `validateComposerDocument`，去掉嵌套 JSON 转换；按消息 key 通知订阅者，无变化 sweep 不广播。
  点击及最终回填继续实时校验；没有引入缓存框架、持久化索引或新的性能承诺。
- 补齐直接慢响应、三条恢复路径、迟到补查、无副本重试及清理、自动到期与不影响无关历史行的检查。
  真实 Web 组合验证第 90 秒收到补查结果后仍于第 120 秒失效；正常直接响应则于第 210 秒失效，
  第 125 秒迟到补查不能重建已删除副本。显式重放保持原 ID 和完整参数。
- `pnpm test` 通过：255 个 Vitest 文件、2947 项通过、2 项既有跳过；后续 Node 358 项通过、
  2 项 Windows 专用跳过。`pnpm typecheck`、`pnpm build:desktop` 和 11 组正式组件 UI 验证通过。
- `pnpm test:rust:pr` 默认 workspace 475 项通过、1 项既有 ignored；通用文档门禁及以原 worktree
  基线执行的 `pnpm docs:check:ci` 通过。没有修改 Core、Rust 测试或协议。
- 工作树状态 `ready`；追加修正提交并推送原功能分支，保留 worktree 等待评审，尚未合入 main。

## 字面 HTML 间距与遍历收尾（2026-10-22）

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-markdown-spacing`；
  分支 `rovai/markdown-spacing`，基线 `1dde043f6cb3b074682141d328a52e3d3c7e4ad8`；Governance：none。
- 文件引用间距显式接收 `rawHtmlPolicy`，在 `text` 下以 HTML 字面字符作为相邻边界，
  在 `drop` 下跳过隐藏节点。共用忽略列表保留，HTML 块内的 Markdown 形状不进入文件引用解析。
- raw→text 只替换对应子节点并保留原 children 数组；`drop` 直接返回，交由现有 `skipHtml` 删除。
  插件顺序和可信 Mention 机制保持；未增加缓存、解析层或性能框架。
- 扩展既有 SafeMarkdown owner：前后两个 HTML 间距 case 修复前均失败；补充显式 drop 间距、
  HTML 块内伪文件引用和被丢弃块中的 Mention 边界。无 Rust、Core、引用投影或模型上下文变更。
- 属于已有显示合同的局部修正，无需新增 Version Decision、schema 迁移或协议版本。

验证：

- 定向 129 项通过；`pnpm typecheck`、`pnpm build:desktop` 和文档通用门禁通过。
- `pnpm test` 通过：252 个 Vitest 文件、2868 项通过、2 项既有跳过；后续 Node 套件
  357 项通过、2 项 Windows 专用验证跳过。
- `pnpm test:file-reference-navigation` 隔离 Electron 验收通过：两侧 HTML 场景在日间、夜间的
  实际附加边距均为 `0px`，字面标签完整；文件打开、原生选文、键盘、阅读锚点与宽内容约束保持。
  已核对两主题截图；没有启动 Core、真实 Runtime 或日常 App。
- `pnpm test:message-quotes` 通过，复用已有 71 项投影对照和可信 Mention／旧引用边界。
  本次未改 Rust 或引用协议，未重复执行 Rust workspace 套件；不声明整体性能提升幅度。
- 已完成验证，进入 PR 与 main 合入流程；合入后清理独立 worktree。

## 消息字面 HTML 与引用投影（2026-10-22）

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-markdown-literal-text`；
  分支 `rovai/markdown-literal-text`，基线 `8d236422c8225e14ff649e854acaf868fc1bbb4f`；Governance：none。
- 聊天/单聊/执行台默认 `text`；更新日志、Markdown 文件和 Skill 阅读面显式 `drop`。
  两种策略都不执行原始 HTML。raw 节点在可信 Mention 替换前文本化，避免内部 token 外露。
- 执行说明判空与正文策略一致；引用新捕获使用 projectionVersion=3，Core HTML inline/block 与 Renderer
  DOM 保持 Unicode scalar/空白一致。原 v2 对照集保留，v3 继承旧例并覆盖占位符、HTML 块、注释、
  可执行形状的字面文本、代码/转义、自动链接和结构化 Mention。
- 扩展原 Rust 纯投影和 SQLite capture owners；没有新增、删除或停用 Rust 测试函数。
  修复前占位符为空、原始 HTML 选文无法匹配；最小命令为 `cargo test -p rovai-core --lib message_quote::tests::`。
  SQLite seam 同时验证 v1/v2 冻结快照保留，UI owner 验证原生选文、v3 捕获与旧定位失败边界。
- 此变更只影响显示及新用户主动选文的内部 locator，不改模型输入格式、选择/预算、上下文证据版本或
  既有快照字节；引用仍按已有 plain_text 合同发送用户选中的文本，不触发核心模型上下文变更。
  复用已有投影版本与兼容机制，无需新增 Version Decision、迁移或文档路由。

验证：

- `pnpm typecheck`、`pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check` 和使用真实基线的
  `pnpm docs:check:ci` 通过；没有新增治理例外。
- `pnpm test` 通过：252 个 Vitest 文件、2864 项通过、2 项既有跳过；后续 Node 套件
  357 项通过、2 项 Windows 专用验证跳过。全量门禁发现主干 benchmark 产品合同仍断言旧 schema 161，
  在未修改的主干复现后，将该测试期望同步为已存在的 162；没有修改生产 schema 或迁移。
- `pnpm test:rust:pr` 默认 workspace 回归通过：474 项通过、1 项既有 ignored；
  `cargo fmt --all --check` 通过。扩展原有 owner，没有新增 Rust 测试函数或运行真实模型。
- `pnpm test:message-quotes` 隔离 Electron 验收通过；Core 与 Renderer 共用的 71 项 v3 对照覆盖
  完整占位符路径、可见字面 HTML、可信 Mention、原生选文与新引用定位；旧 v1/v2 快照保持，
  无法精确匹配当前正文时不伪造高亮。日间和夜间截图人工核对通过。
- 已完成验证，进入 PR 与 main 合入流程；合入后清理独立 worktree。日常 App 未安装此修复。

## TRAE ACP 错误详情（2026-10-22）

- 工作目录：同级 worktree `rovai-ai-trae-acp-error-detail`，分支 `rovai/trae-acp-error-detail`，
  基线 `bdd13d20fa95178d5a8687392ab17435c2d75daa`；无需治理先行提交。
- 只读核对同一原生 Session 的两次 `task_complete.error.message`，均包含个人配额耗尽详情；
  Rovai 的持久 failure 与 input rejection 只保留 `ACP error -32603: Internal error`，详情在 Core 内已丢失。
  不把这些私有 Session、Run ID、业务输入或原始日志提交到仓库。
- 使用已安装 TRAE 0.209.1，在独立 `TRAE_HOME`、项目与临时目录中运行 ACP 探针；仅使用合成认证，
  OS sandbox 禁止网络与日常目录写入。`session/new` 的原生错误为
  `{code:-32603,message:"Internal error",data:"Trae CheckLogin failed before model fetch: …"}`。
  这证明当前版本返回字符串 detail；没有重新调用真实模型，也未捕获历史配额失败的完整 ACP wire。
- `AcpRpcError::from_response` 兼容字符串 `error.data` 与既有 `error.data.error`；复用统一脱敏、
  去重与长度限制。共享 Prompt/RPC 路径保留详情；原生会话、输入接受判定、retryable 门禁及旧 Run 保持。
- 扩展既有 `acp_rpc_error_keeps_only_allowlisted_bounded_fields` 的类型与清洗矩阵，
  以及 `prompt_error_after_activity_keeps_input_accepted_while_early_rejection_does_not` 的
  两种格式、activity 前后和 input rejection 详情；不新增、删除或停用 Rust 测试函数。

验证：

- 修复前新增字符串 case 失败：实际只有 `ACP error -32603: Internal error`；修复后解析 owner 通过。
- 合成 ACP 进程 owner 的四种格式／activity 组合通过；统一 Runtime failure 的 5 项分类与清洗测试通过。
- `pnpm typecheck`、`pnpm test` 通过：252 个 Vitest 文件、2857 项通过、2 项跳过；后续 Node 套件
  357 项通过、2 项 Windows 专用验证跳过。
- `pnpm docs:test`、`pnpm docs:check` 与使用真实基线的 `pnpm docs:check:ci` 通过。
- `pnpm test:rust:pr` 默认 workspace 回归通过：474 项通过、1 项既有 ignored；
  `cargo fmt --all --check` 与 `cargo check --workspace` 通过。未执行全量 extended/slow-tests。
- 已完成验证，进入 PR 与 main 合入流程；合入后清理独立 worktree。日常 App 未安装此修复。

## 操作提示精简（2026-10-21）

- 工作目录：同级 worktree `rovai-ai-remove-action-toasts`，分支 `rovai/remove-action-toasts`，
  基线 `9d4f17b6e`；不要求治理先行提交。
- 移除 User 列出的操作 Toast：复制会话 ID／项目路径／附件完整路径、项目改名／移除、消息撤回、
  结束单聊、队员邀请／移出（含生效时机与收尾）、定时任务创建／运行／开启／关闭／删除
  （含运行已跳过与未启动），以及 Web 附件下载准备与交接成功。不新增局部提示。
- 移除定时任务与成员面板不再使用的通知回调，清理独占翻译；保留其他错误回调、草稿、
  异步刷新、操作忙碌状态、成员收尾区域与通知分类开关。
- 既有侧栏／成员验收改为检查剪贴板、名册与 Dialog 收起后没有 Toast；定时任务创建验收
  等待持久定义界面，不再依赖成功提示。不新增、删除或停用 Rust 测试。

验证：

- `pnpm typecheck`、验收夹具 TypeScript 检查、`pnpm build:desktop`、文档治理门禁通过。
- `pnpm test` 通过：249 个 Vitest 文件、2832 个用例；后续 Node 套件 357 个通过、
  2 个 Windows 专用用例按平台跳过。首次执行的文件监听用例发生等待超时，单独复查与
  完整重跑均通过，未改动该用例。
- `pnpm test:rust:pr` 默认 workspace 套件通过；`pnpm test:automation-splitter`
  隔离 Electron 集成验收通过。侧栏／成员验收脚本通过语法检查，未运行完整打包验收。
- 浏览器使用生产 Renderer 的内存夹具，验证定时任务创建、运行、关闭、开启、删除后
  状态更新且没有操作 Toast；未启动真实 Runtime 或访问日常实例数据。
- Impeccable 对六个改动的生产组件检查无发现；未改动布局、主题或 CSS。

## 原路径附件显示名（2026-10-21）

- 工作目录：同级 worktree `rovai-ai-source-attachment-display-name`，分支
  `rovai/source-attachment-display-name`，基线 `2773f3bc3`；不要求治理先行提交。
- Source Ref 读写与观察入口使用展示文本检查，保留通过检查的原名；不再要求显示名等于
  `normalize_display_name` 的安全落盘名称。路径、身份、owner 授权与文件有效性规则不变。
- Contract 升为 [v11](../../contracts/camp-attachment-v11.md)，同步当前架构和导航。
  无字段或模型输入结构变更、数据库迁移或新增版本决定。
- 扩展已有 Rust owner：`source_ref_json_is_closed_and_pathless_view_is_stable` 负责名称输入矩阵、
  序列化/恢复与展示；`resolver_returns_exact_stored_paths_for_files_and_directories` 负责原路径与
  Core/Agent 观察；`source_path_message_bypasses_managed_attachment_publication` 负责 Desktop 原始
  显示名实际发布、持久化与 Runtime 路径。未新增、删除或禁用 Rust 测试函数。
- 扩展已有 Desktop registry 恢复测试，确认带冒号显示名在重启恢复后保留 ID 和真实路径。
- 渠道入站复用原有有界 MIME 探测，直接传递既有展示标签，避免将带 `file-` 前缀的实际文件名
  当成显示名检查。原渠道原子准入 owner 增加 120 码点标签，确认安全落盘名称和 MIME 识别保持。

修复前附件模块的两项新增 case 分别复现“显示名被替换”和原始 normalized 报错；修复后该模块
5 项测试全部通过。Desktop registry 13 项、`pnpm typecheck`、`pnpm test`（Vitest 2816 项）、
`pnpm build:desktop` 与使用真实 base 的 `pnpm docs:check:ci` 已通过。
最终代码的默认 Rust workspace 回归通过：474 项通过、1 项既有 ignored。实际发布
（`slow-tests`）、渠道原子准入（`extended-tests`）与旧安全文件名清洗三个定向 owner 均通过。
规范与需求两个独立静态审查均无发现；未启动日常 App 或调用真实模型。

`pnpm test:rust:extended` 的 Core 扩展套件完成：1015 项通过、8 项既有 ignored、6 项失败，
命令以 101 退出。六项失败均为主干既有问题：

- `every_acp_adapter_uses_terminal_runtime_action_output_not_command_delta`：实际 ACP 数量为 15，
  旧断言为 14。
- `v103_adds_trae_delivery_without_overriding_custom_skill_assignments`、
  `v104_adds_cursor_catalog_and_delivery_without_expanding_custom_skills`、
  `v105_adds_kimi_catalog_and_delivery_without_expanding_custom_skills` 与
  `v107_adds_grok_catalog_and_preserves_runtime_and_skill_rows`：旧迁移夹具的 Skill `group_key`
  CHECK 约束失败。
- `active_inputs_preserve_initial_context_and_unsubmitted_sources`：开头的 Runtime 能力矩阵断言
  实际为 true、预期为 false，尚未进入上下文或附件部分。

独立 detached worktree 在未修改的基线 `2773f3bc3` 编译并定向运行这六项，全部复现同样失败。
相关测试、AdapterKind 与 Steer 定义未改动。保留失败记录，扩展层不记为全绿；本次没有改写或跳过无关断言。

## 单次长文本粘贴转附件（2026-10-20）

复用分支 `rovai/long-text-paste-attachment` 与同级 worktree `rovai-ai-long-text-paste`，本轮合入 main 基线
`85a57b3c7`，保留原分支历史。按 User 确认的五条范围，采用单向发送保护，不增加发送关联或清理框架。

- 普通文本 paste 使用可选 Desktop 能力；10,000／10,001 按码点分流，文件／图片／合法内部结构优先。
  原正文及选区保留，显示名避开当前 ready/preparing 项；计数准入放在既有附件串行准备队列中。
- Main 通过本机 Host/Core 读取 Thread 输出目录，直接写 UUID `.txt`。原登记增补生成来源和单向发送标记；
  只对最终发送快照中的生成附件先持久保存保护再转发发布，物理删除复用同一队列。已移除附件不连带保护，
  本次无附件也不解除更早标记。未承担恢复或清理责任后释放登记，其他附件仍按原缓存规则。
- 明确本机保存完成点，随后 Pending presence 失败不回填。未接纳先追加到原编辑器最新内容，再尝试清理已准备文件；
  回填沿用既有保存、重试与离开保护，失败时不重读旧快照覆盖新增输入。创建阶段尚未返回登记身份时的异常残留
  留到 Thread 删除，不另设恢复或清理任务。
- 用户移除先成功保存新草稿，再异步删除未保护生成文件；已保护文件仅移除引用。清理失败不回滚草稿、不锁住编辑。
  发送成功先保存后续草稿再 discard；保存失败保留文件与登记。纯附件 Pending 离开也等待已有 presence 确认。
- 普通弹窗零消息 Active 保留；一键 Pending 沿用空草稿隐藏／离开／启动清理。启动清理补齐同 Thread 输出目录，
  复用既有删除通知释放 Main 登记。没有目录扫描、定时任务、引用计数或新建垃圾回收器。

验证 owner：Main registry 定向测试覆盖完整 UTF-8、重启恢复、Thread 隔离、外部文件、单向保护、删除与发送串行、
登记写入失败、unlink 失败、最终附件快照范围与缓存裁剪豁免。原生产 Composer Electron 夹具覆盖阈值、选区、HTML／文件／图片／内部
复制、快速粘贴、数量上限、延迟失败期间编辑，以及两种状态下的空正文附件发送、移除顺序和发送后清空失败。
界面使用临时 userData 与独立 Skill Library，不连接日常 App。

Rust 继续扩展既有 `application::tests::source_path_message_bypasses_managed_attachment_publication` owner：
使用 Pending 首条纯附件发布、Thread 目录的完整 Unicode 文件，验证 Active 激活、消息 source ref、运行附件路径
解析与逐字读取，同时保留“不走 legacy managed publication”的原断言；不新增平行 Rust fixture。最小命令为
`cargo test -p rovai-core --lib --features slow-tests source_path_message_bypasses_managed_attachment_publication`。
现有 Core 启动进程夹具新增目录生命周期场景，证明 root RPC、空 Pending 重启清理、带 presence 的 Pending 保留、
零消息 Active 保留与离开时受保护 discard；领域单元测试不能证明启动器是否实际接上文件清理。

验证：`pnpm typecheck`、`pnpm build:desktop`、`pnpm test` 通过；完整回归包含 247 个 Vitest 文件／2,812 项，
后续 Node 357 项通过、2 项平台专属跳过。补充最终附件快照边界后，Main registry 的 11 项定向测试与生产
Composer 隔离 Electron 场景再次通过，证明移除项不进入请求、无附件发送不连带删除或保护其他文件。
`pnpm test:composer-input` 的 3 个生产输入套件与 `pnpm test:desktop-bridge` 的真实 preload/contextBridge
验证通过；人工核对长粘贴的日夜主题截图，沿用原附件卡片和短提示。

`pnpm test:rust:pr` 474 项通过、1 项既有 ignored；上述 slow Rust owner 和 Core 真实启动目录场景均通过。
文档 10 项测试、普通及基于 `85a57b3c7` 的 diff-aware 文档门禁、Rust 格式与 diff 检查通过。
证据覆盖真实 Core 发布与运行附件解析，不声称已经让外部模型实际读取；没有安装日常 App。

保持 v1.72。当前长期规范升级为 [Composer Draft v17](../../contracts/camp-composer-draft-v17.md)，
Architecture、UI、合同索引、文档入口与 [V1.72-D53](decisions.md#v1-72-d53) 同步。
不改变模型上下文字段、Runtime 启动协议或其他附件入口，Runtime Activity、Runtime compatibility、Root README 无需改动。

后续按 User 对固定提交 `035902a5e` 的复核，在同一分支完成局部修正：
空附件发送在读取登记和入队前返回；最终发送清单中的相同 `sourcePath` 能保护另一 Thread 的原生成登记，
附件 ID 匹配仍限定 Thread。Preload 在读取完整缓冲区前检查现有 25 MiB 上限，Main 最终校验保留。
明确保存完成点不变，协调器不重复发布已接纳的同一快照，Active 的 onChange 跳过该已成功保存对象的重复写入。
没有增加常驻任务、发送关联、去重、引用计数或新存储系统；真实文件和少量失败残留仍承担原有存储成本。
同路径复用只限制草稿移除时的物理删除，不改变所属 Thread 删除（含空 Pending 清理）的目录寿命。
后续验证：27 项定向测试、生产 preload/contextBridge 及隔离生产 Composer 回归通过，覆盖空发送绕过阻塞清理、
跨 Thread 路径保护与 ID 隔离、超限时零字节读取／零 IPC、正常添加与保留正文时移除各一次快照保存。
既有清空后的草稿重读保持原样，没有把独立重读的空快照写入算作本次接纳重复通知。
`pnpm typecheck`、`pnpm build:desktop` 和 `pnpm test` 通过（247 个 Vitest 文件／2,816 项，
Node 357 通过／2 项平台跳过）；文档 10 项测试、普通及基于 `035902a5e` 的 diff-aware 门禁通过。
本轮未修改 Rust，不重复运行既有 Rust 回归；没有测量整机内存或磁盘占用，也没有更新日常 App。

### 内部纯正文复制修正（2026-10-21）

分支 `rovai/long-paste-text-only`，同级 worktree `rovai-ai-long-paste-text-only`，初始基线 `527582452`。
User 实测输入框复制的纯正文也带私有 MIME，导致此前合法内部格式整体豁免了长文本阈值。
只调整生产 Clipboard Extension 的 paste 分流：恢复后仍含 Member、All Members 或 Skill Atom 时保留
结构化优先级；其余内部文档用自身完整正文判断 10,000 码点阈值，普通 `@名字`、`/skill` 字符不构成 Atom。
既有文件优先级、短文本插入、选区、未启用回调的入口及异步回填保持原路径，不增加持久字段或后台机制。

新增场景先在旧代码复现失败，再在隔离 Electron 的生产 Composer 中通过；使用编辑器自身 Copy 产生私有 MIME，
验证纯正文回贴生成附件且不覆盖选区。补齐边界、Unicode／空白全文、内外文本不一致、三种 Atom 保留，
并用内部纯文本覆盖既有延迟失败期间继续输入的回填场景。夹具隔离 userData 和 Skill Library，不启动 Core／Runtime。
初始基线上的 `pnpm typecheck`、`pnpm build:desktop`、`pnpm test` 通过（249 个 Vitest 文件／2,832 项，
Node 357 通过／2 项平台跳过），生产 Composer 回归通过。当前规范升级为
[Composer Draft v18](../../contracts/camp-composer-draft-v18.md)，复制 wire format 和 v17 的附件生命周期不变。

同步语言设置主线 `94a1d843c` 后再次通过 `pnpm typecheck`、`pnpm build:desktop`、`pnpm test`
（251 个 Vitest 文件／2,847 项，Node 357 通过／2 项平台跳过）、`pnpm test:composer-input` 的 3 个生产输入套件，
以及基于该 main SHA 的 diff-aware 文档门禁。默认 `pnpm test:rust:pr` 474 项通过、1 项既有 ignored；
本次及合入的语言更新均未修改 Rust。日常 App 未在本轮安装或重启。

## 会话执行条（2026-10-20）

User 确认第七版交互稿的 01 浅灰、C 无底图标和转圈，并授权独立 worktree、PR 到 main 后合并。
分支 `rovai/conversation-execution-bar`，基线 `923f9919b669b5d0c5fba8654f852106806deae0`，
worktree 为同级 `rovai-ai-execution-bar`；没有治理先行要求。

实现限于会话执行条及其设置导航接线：42px 浅灰完整单行、28px 常驻中性停止图标、整行悬浮浅红底，
移除停止区竖线与 RunningText。运行时间由真实 start/end 计算，未知时省略，并与正文共用精确 Run 入口。
连接候选采用 02／03／05，处理候选采用 02／04／05；Run ID 与阶段决定稳定选项，中英文共用选择，
真实正文、命令与合法思考标题优先。独立圆环不受系统／应用减少动态设置影响，forced-colors 保留静态图形。
执行台、设置控件、消息、头像、输入区和其他界面不移植交互稿样式；停止确认、来源定位、重试与执行证据路径保持原有语义。

保持 v1.72；这是局部可逆的 Renderer 变化，没有协议、存储、Runtime 或 Rust 测试变更，不新增 Version Decision。
扩展现有单元测试与生产 ThreadWorkspace 浏览器夹具，覆盖候选稳定性、中英文切换、时间事实、计时导航及动效独立性。
删除旧可选 HTML 分隔区对照入口，以当前生产组件的几何、交互与截图验证取代。

验证：`pnpm typecheck`、`pnpm test`（246 个 Vitest 文件／2,803 项；Node 357 通过、2 项平台跳过）、
`pnpm build:desktop`、`pnpm docs:test` 与基于实际 main 基线的 `docs:check:ci` 通过。
`pnpm test:run-presence-ui` 在独立 Chrome profile 中通过 38 个场景状态、37 项交互记录及日夜主题的 6 组桌面尺寸；
另覆盖 200% 等效缩放、粗指针、系统／应用减少动态效果、forced-colors 组合、中英文即时切换、时间精确 Run 导航和终态收口。
人工浏览器核对了生产组件在 1440×920 下的日夜主题、28px 无底停止、整行悬浮浅红底及既有停止确认；控制台无错误。
夹具只替换 transport，不启动 Core 或真实 Runtime，不修改日常 App 数据。

后续 User 要求完全随机：分支 `rovai/execution-copy-random` 从 `9d3a9ed67767b8351142f3b7ef9bd27758b41a22`
创建同级 worktree `rovai-ai-execution-copy-random`。选句改为每个 Run/阶段独立、等概率随机，允许连续重复，
不再由 Run ID 哈希决定。Renderer 仅临时保留最近 512 个阶段选项，避免计时、快照更新、重挂载和切换语言
触发换句；完整页面重载可重新抽取。不新增持久设置，不修改样式、动效或真实进度优先级。
既有候选测试改用受控随机样本验证三个区间、连续重复、阶段独立性和中英文一致性，避免概率性断言。
后续验证：12 项定向单测、`pnpm typecheck`、`pnpm test`（2,803 项 Vitest，Node 357 通过／2 项平台跳过）、
`pnpm build:desktop`、文档门禁及 `pnpm test:rust:pr`（474 通过／1 项既有忽略）均通过。
独立 Chrome 的 `pnpm test:run-presence-ui` 继续通过 38 个场景状态、37 项交互记录和 6 组桌面尺寸。

## Claude 执行结束后的失败收口（2026-10-20）

User 报告 Claude 子进程已退出、Run 长期运行中且后续消息排队。当前源码核查发现：
`execution_lease_expires_at` 只在领取时写入，没有周期续租，因此它和 `agent_run.updated_at`
都不能单独作为执行器失联时间；Claude Adapter 已监听进程退出并限制退出后的输出收集。
但 stdin writer、退出后输出收集和进程等待的部分普通错误返回后，已绑定的 handoff 会使
上层提前返回，跳过 Run 失败结算。现场尚缺可追溯构建身份、Core 错误链与进程退出码，
不能认定该报告命中此分支，也不能仅凭会话没有 error 或系统没有 crash report 排除原生错误。

分支 `rovai/fix-claude-ended-run`，基线 `1da9da7ccafa8fc896ca82958029c0f48770c41f`。
复用现有 Adapter result、Runtime loss 和 cleanup worker：内部 `ClaudeCodeRunEnded` 只标记
已返回结果的 worker，不标记仍可能运行的 caller-abort 或结果通道意外丢失。可信原生终态继续
走原有结算；没有可信终态且 handoff 已绑定时，按 Run/epoch 收口 unknown input。保留精确
取消、计划关闭、旧执行隔离与后继 FIFO，不增加租约轮询、运行时长上限、重放或新的持久状态。
这是实现对齐现有恢复合同的局部修复，不新增 Version Decision、协议、Schema 或模型上下文。

回归 owner：

- 既有 `claude::tests::output_failure_terminates_the_still_running_process_before_cleanup`
  增加内部结束标记断言，验证真实协议进程的错误保留原公开原因且能传递 worker 结束证据。
- 新增 slow owner
  `application::tests::ended_claude_run_fails_unknown_input_before_releasing_queued_delivery`，
  使用既有隔离 Core/SQLite fixture 验证 bound handoff 下的普通错误不夺取 owner、已结束错误
  结算为 `accepted_input_outcome_unknown`、输入不重放、cleanup 前不领取、确认后单次领取与迟到
  结果 fencing。Adapter owner 无法观察持久队列；domain owner 不经过 Core 的错误路由，因此需要此
  跨模块 owner，不增加平行 Runtime/网络夹具。
- 最小命令：
  `cargo test -p rovai-core --lib --features slow-tests ended_claude_run_fails_unknown_input_before_releasing_queued_delivery`。

47 项定向 Rust 回归通过：上述新 owner 1 项、Claude Adapter 34 项、现有 Runtime loss owner
1 项、Planned Shutdown 11 项。`pnpm typecheck`、`pnpm test`（Vitest 2801 项及 Node suites）、
`cargo fmt --all --check`、`cargo check --workspace`、`pnpm docs:test`、`pnpm docs:check`
及使用上述基线的 `docs:check:ci` 均通过。

首次默认 Rust 回归为 427 passed / 1 failed / 1 ignored；失败是兼容性文档摘要常量与当前文件不符。
在未修改的基线以 `platform_evidence_revisions_bind_their_frozen_source_bytes` 单独复现同一失败。
主线 `5c70ee814` 更新 Qwen 问卷证据后遗漏了摘要同步，本分支将该常量同步到实际文件 SHA-256，
不改变准入集合或任何资格测试断言；作为独立修正提交。重跑 `pnpm test:rust:pr` 通过：
workspace 共 474 passed / 0 failed / 1 ignored；保留原有手动验收跳过项。
本次不启动真实模型、不修改故障电脑或日常实例数据。

User 后续授权 PR 到 main 并合入。交付前同步主线
`923f9919b669b5d0c5fba8654f852106806deae0`，采用其最新兼容性证据摘要；最终相对 main
不再修改平台准入常量。仓库规范与需求一致性两路静态审查均为 0 项 findings。
交付与最终检查状态见 [PR #834](https://github.com/murray17/rovai-ai/pull/834)。

后续现场报告（2026-10-20，User 转述；未取得原始数据库和日志独立复核）：

- 故障机报告 Rovai App/Host `0.4.14`、实际运行的 Claude Code `2.1.212`；故障窗口为
  `07:33:30–07:42:07 UTC`。App/Host 版本号尚不能唯一映射构建提交；现场报告 Core/Host
  在此窗口没有退出、重启或计划关闭迹象。
- 数据库副本显示旧 Run 为 `running`，输入为 `accepted`，
  `accepted_at = resolved_at = 07:33:36.916 UTC`，错误字段和取消请求/确认字段均为空。
  `resolved_at` 在输入接受时写入，不证明模型完成或 Run 已结算；取消字段为空也不支持
  “已进入 cleanup、只是确认迟到”的判断。
- 现场未保留 Core stderr，Claude 的实际退出码/信号未知；当前无残留进程不能证明退出时刻
  没有子进程持有输出管道。会话停在工具成功输出、UI XPC 连接活动均不能唯一定位退出原因。
  结论保持为“已接受输入的 Run 未写入终态，症状与本次修复路径一致但未确认命中”，不把
  “跳过失败分支”或“执行器失联”提升为现场已证事实。
- 修复后的复现不能要求旧 `preserving unresolved accepted input` 日志作为成功判据：
  已标记的结束错误会在打印该行之前结算。应保留新 Run/epoch、构建身份、
  `last_error_code`、`last_error_details_ref` 和 `agent_run.failed` 事件的 `errorDetail`；
  对本次路径预期为 `accepted_input_outcome_unknown`，错误链含
  `Claude Code managed run has ended` 及底层原因，再核对清理请求、确认和后继领取。
  这仍不能保证取得每种底层退出的实际退出码。
- 当前基线已有精确 Stop、Core 重启恢复与 cleanup 路径；本次补的是运行期间特定错误返回后的
  失败收口，并非新增全部回收能力。现场恢复需等待旧执行清理确认；后续复现须使用新的明确
  输入，先核对原任务已产生的效果。日志持久化开关未包含在本补丁中。

## 执行入口与空状态（2026-10-20）

User 确认 HTML 交互稿后授权独立 worktree、PR 到 main 并合并。分支 `rovai/execution-entry-cleanup`，
基线 `1da9da7ccafa8fc896ca82958029c0f48770c41f`，worktree 为同级 `rovai-ai-execution-entry`。

生产变更只涉及 `ThreadDetailPopover.tsx`、`ThreadWorkspace.tsx` 和 `styles.css`：
移除入口 Hover/Focus 名单气泡，保留可访问人数／姓名、头像、双弧与原尺寸；将原位置菜单提取为同文件控件，
放到浮层标题栏，删除空状态中的独立“移到底部”。底部／右侧空记录保留位置控件，以便返回；
未激活草稿在三种已保存位置下都不新增执行控件。有记录时底部／右侧布局及稳定 Drawer host 继续复用。

保持 v1.72，属于局部可逆的 Renderer 调整；同步现有 UI 规范。没有新增协议、存储、Version Decision、
Runtime 或 Rust 测试变更。验收扩展既有执行台原生输入夹具，覆盖无名单气泡、可访问姓名、
空状态三位置往返、保存失败与重试、嵌套 Escape，以及未激活草稿；原有执行详情场景继续完整运行。

验证：`pnpm typecheck`、`pnpm test`（246 个 Vitest 文件／2,801 项、Node 357 通过／2 项平台跳过）
与真实基线的 `docs:check:ci` 通过。生产执行台原生输入夹具和状态切换夹具均通过；覆盖日夜主题、
1040／1440／2560 宽度、200% 缩放、完整过程阅读、Drawer identity、键盘焦点及空状态。
首次全量前端回归出现三项超时；对应 37 项单 worker 复核及完整 `pnpm test` 重跑均通过。

额外检查保留两个基线问题：手机执行夹具在 844×390 横屏断言详情高度应大于 40px，原始基线与本次
均测得 33px；`pnpm test:rust:pr` 的平台证据 owner 因 `docs/runtime-compatibility.md` 哈希不匹配失败
（Core library 427 通过、1 失败、1 项既有忽略）。直接读取基线 Git 对象得到文档 SHA-256
`9d3e34b827046ad071c350638c3317182e7061373eaf1a8fb31e89ea90fda6c2`，
基线常量仍为 `596f26ee3fdf0a6812737967e0e2f97cecb34a70595cf52a58d2309cdd93c3a5`。
本次不修改这两处既有行为或放宽断言；没有将这些检查声明为通过。

## 四适配器原生问卷（2026-10-20）

按 User 确认的四适配器范围在独立 worktree 实施。启动参数、接收端问卷分流、Host 兼容、
未承接问卷终态与测试证据统一记录于[原生问卷验证](native-questionnaire-verification.md)。
不改 MiniMax 用户配置，不扩大到 Codex 或其他适配器。

后续按 User 范围仅补 Qwen `--exclude-tools=ask_user_question` 与 Host compatibility，
保留既有问卷取消兜底；Kimi 仅核实 Skip/取消不终止原生执行，未改策略。
增量版本、生产路径与门禁证据见同一验证记录的 [Qwen 增量](native-questionnaire-verification.md#qwen-启动禁用增量2026-10-20)。

本轮按 User 授权禁用 ZCode、OpenCode V2 的问卷工具，生产改动限于原生配置和 Host compatibility。
不增加通用交互取消、Run 终态或重放处理；保持 v1.72，不新增 Version Decision。
基线、worktree 和验收见 [ZCode/OpenCode 增量](native-questionnaire-verification.md#zcodeopencode-v2-禁用增量2026-10-20)。

## 主动停止后的会话蓝点（2026-10-19）

**已撤回。** 原功能通过 [PR #821](https://github.com/murray17/rovai-ai/pull/821) 合入并安装后，
User 反馈问题，要求先撤回，并确认将回退 PR 合入 main 后安装到本机 App。

回退分支 `rovai/revert-manual-stop-unread`，基线 `7dbc9ed24170dac6032582285995da7af36702cd`，
使用现有 checkout。移除 `BusinessApp` 中停止成功写入 `manualUnread` 的逻辑及丢失回执的提醒核对集合；
恢复停止动作与回复未读的原有边界。现有停止、终态核对、回复未读和显式标记未读不变；
不批量清理已有本机提醒，继续由显式打开或标记已读清除。

既有生产 App Electron 夹具改为验证成功停止、切换会话、聚焦／自动刷新、丢失回执和迟到终态均不新增蓝点，
日夜截图覆盖停止后的原会话。保留 #821 中与该功能独立的 Runtime 状态查询、同 tick 合并、schema 9 和 Task 顶栏夹具修正。

保持 v1.72；UI 和 Architecture 已同步撤回后的规则，Navigation Read v1 的本机偏好字段与 Core 水位不变。
没有新增 Rust 测试、存储迁移、模型上下文、Runtime、Contract 或 Version Decision 变更。

回退验证：`pnpm typecheck`、相关 Vitest 188 项、`pnpm test:startup-presentation` 和 `pnpm docs:test` 10 项通过；
日夜截图确认停止后的会话没有新增蓝点。生产 `BusinessApp.tsx` 与 #821 合入前的 `f6f359f2c` 完全一致。
文档在只含受版本管理文件的临时 clone 中直接运行 package scripts 对应的版本检查、决定治理和
`--require-base` 门禁，均通过；base 为上述回退基线，未扫描本机忽略的旧原型或增加门禁例外。

## 记忆工作区 R4（2026-10-19）

User 批准独立 worktree 实施、PR 合入 main，并从最新 main 构建安装本机 App。
分支 `rovai/memory-r4-ui`，worktree 为同级 `rovai-ai-memory-r4`，基线
`0fc75fda45ad7765c2ee22440464da767e718bd3`。最终 R4 HTML 的 SHA-256 为
`29cb2e955daa7eae9f5c5bbed533ccff134d89875fa3a21866c8bfe55e54a62f`。

实现采用生产 MemoryLibrary 和共享 Dialog/Menu 组件；统一灰阶 token，保留原 App shell，移除容量和
治理筛选，增加 All 范围并兼容旧导航状态。列表只压缩预览，正文和版本仍可完整展开。
编辑保留字节校验、草稿和冲突后显式重试；领域容量、持久化和权限约束不改变。
自动通知按 Memory ID 合并事件，区分创建/修订；scope 缺失时通过已有 `memory.get` 补足，查询失败显示
通用“记忆”而不猜测共同范围。迟到读取不能恢复已关闭通知。

保持 v1.72；这是局部可逆的 Renderer 调整，不新增 Version Decision、协议或数据库迁移。
同步 DESIGN、主题和 Memory surface brief、开发验收命令；Architecture、Contracts、Runtime Activity、
模型输入、Runtime compatibility 与根 README 无变化。退役已移除容量组件的 TypeScript 展示测试，
用通知归属/去重测试及生产组件交互验收覆盖新行为；没有新增、合并或退役 Rust 测试。

验证：`pnpm typecheck`、`pnpm test`（246 个 Vitest 文件 / 2,800 项，Node 357 通过、2 项平台跳过）、
`pnpm test:rust:pr`（474 通过、1 项既有忽略）与真实 base 的 `docs:check:ci` 通过。
`test:memory-workspace-ui` 覆盖 10 组双主题/尺寸，完整正文、折叠版本、全部范围、通知查看/关闭、草稿、
校验、失败与冲突显式重试、操作对齐与黄点居中；`test:memory-web-ui` 通过真实 Host 的手机新增、修订、
返回及重入。`test:navigation-shell` 通过。隔离 `accept:memory-ui` 通过实际 Core IPC、复核设置/并发冲突、
停止/恢复、永久遗忘、SQLite 重开以及日夜/200% 缩放。

补充边界：`test:startup-presentation` 的 `runtime.availability.updated: refresh health once` 断言在本分支和
原始基线 `0fc75fda` 均失败，不由本次 Memory 改动引入。既有 `test:host-web-mobile` 在进入 Memory 前的
导航槽位/旧 CSS 断言失败，另有横屏执行台及缺少 debug Server 产物的问题；本次不修改这些无关行为，
以独立生产 Web/Host Memory 验收证明本次路径。
初次打包在前置构建完成后遇到 GitHub DNS 失败；按 packaging 文档校验 Electron 缓存 SHA-256 后，
继续相同 daily ad-hoc 打包参数并通过 App/Core/CLI/Host 架构与签名门。日常安装使用非终止交接，
最终 main 提交与安装位置记录在 Thread 交付中。
最新 main 安装复验还发现页头几何检查偶尔抢在启动画布退出动画之前；验收入口改为等待画布移除及
Memory 读取就绪，保留原始命中检测和几何断言，不修改生产交互或放宽结果。

## Antigravity 长任务与工具收尾（2026-10-19）

User 批准独立 worktree 实施、创建 PR 并合入 main。分支 `rovai/fix-antigravity-turn-timeout`，
worktree 为同级 `rovai-ai-antigravity-timeout`，基线 `90b4f46b458943170a1f1541cb2928f320db311c`。
真实 agy 1.4.2 复现中，短请求与多工具请求完成；长请求在第六轮工具未收口时结束，Run 总计 311.7 秒、
输入准备后 300.7 秒，后端错误地呈现成功。该五分钟复现没有直接出现空正文，不能与原用户反馈混为同一次证据。
[上游 1.1.28](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md#1128) 明确
超时返回部分结果并成功退出；[1.2.6](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md#126)
已默认不限时，但旧适配器的显式 `5m` 覆盖了该值。

生产改动为 `--print-timeout 0`、精确原生 stderr 超时识别及共享终态工具投影。没有数据库迁移、
模型输入或原生配置更改；没有取消初始化、停止与清理期限。缺失工具结果显示未知，底层 Evidence
和迟到结果保持。保持 v1.72；局部可逆修复不新增 Version Decision，当前合同、架构和 UI 同步；
Runtime Activity 映射、准入资格、根 README 和文档路由保持。

Rust 扩展既有 `structured_runtime_failure_preserves_sanitized_provider_detail` 进程 owner，覆盖零退出
部分文本／空白文本超时及原有配额失败脱敏；现有工具生命周期 owner 同时验证无限时参数与非致命警告。
没有新增或退役独立 Rust 测试。最小回归为 `cargo test -p rovai-core --lib antigravity::tests::`。
原有人工 smoke 新增显式 `ROVAI_ANTIGRAVITY_LONG_TURN_SMOKE=1` 入口，以真实适配器顺序执行八次 40 秒只读命令，
不进入普通测试。UI 在既有分组 owner 和生产 ThreadWorkspace 浏览器 fixture 中验证三种终态与展开状态。

真实适配器长任务使用 agy 1.4.2、原生默认模型，在独立临时 workspace 和日志目录执行，367.81 秒后
返回 `AGY_LONG_TURN_OK`；跨过旧期限并保留正常最终结果。未启动第二个 Core 或修改日常 App 数据。
第一次人工验收沿用了旧 CoreEnforcedV1/read_only 配置，会强制 plan 模式，在 63.94 秒返回空正文；
它不是长任务通过证据，也说明空正文不能一概归因于五分钟时限。本次只对有明确超时证据的结果重新分类，
其他空正文仍诚实失败；长任务 fixture 已使用当前 RuntimeManagedV2 权限语义。

提交前定向 Antigravity 回归 16 passed、1 项人工 smoke 默认 ignored；默认 Rust workspace、
`pnpm typecheck`、`pnpm test`（2798 项 Vitest、后续 Node 357 passed／2 个平台 skip）、
`pnpm build:desktop`、真实 base SHA 的 `docs:check:ci`、Rust 格式与差异空白检查均通过。
生产 ThreadWorkspace 浏览器验收覆盖日夜主题 × 底部／Inspector／Mobile，三种 Run 终态均无悬挂
工具转圈，成功结果与展开状态保持；两轮截图检查确认结果未知图标可见。Impeccable 本次目标静态检查无发现。

## Composer 链接高亮稳定性（2026-10-19）

按 User 确认在独立 worktree 的 `rovai/composer-link-stability` 分支实施，基线为 `4ccfd8270`。
生产改动集中在 `composer-web-links.ts`：每个已识别链接保存内存中的 TextNode key 和逻辑 offset，
按节点索引接收 DOM 提交后的 mutation，包括节点销毁。仅比较相关节点的前后文本，将链接之外的
编辑映射到既有 Range；不读取布局，不在输入路径遍历整棵编辑树或全部链接，不产生 editor update、草稿字段、
保存或撤销记录。单个变化节点采用一个保守替换区间；改到 URL／尾部、跨节点或无法验证原文的范围
立即撤下，150 ms 合并投影及用户操作前的刷新负责完整语义。卸载和草稿替换释放旧记录。

在生产 Composer 的隔离 Electron fixture 中，先添加回归，再修改生产代码：原版在同 TextNode 尾部
更新后，高亮 Range 的文本立即变为空串；修复后提交同步时和第一帧均保留原 URL 与同一 Range。
新增 5 组回归覆盖前方插入／删除、重复 URL 位移碰撞及释放、日夜主题逐帧连续输入与前后方 IME、
URL 自身／尾部修改及操作前目标刷新、节点拆合、跨行代码围栏与撤销。原有长草稿、原文、Atom、
复制／发送、保存／恢复和无 Highlight 能力回归继续通过，共 46 个原生场景；Chrome Web 链接用例通过。
IME 证据来自 CDP 组合输入事件，不替代每种系统输入法的真人验收。

同机、隔离 Electron、没有并行运行本任务编译的前后采样，单位 ms。每个值包含一次 CDP 输入与两帧，
不是纯范围维护耗时；本组只用于发现明显输入回退，不声称普遍性能提升。

| 草稿 | 修复前六次输入 | 修复后六次输入 |
| --- | --- | --- |
| 112034 字符单行 | 34, 33, 34, 33, 33, 34 | 26, 33, 33, 34, 33, 34 |
| 800 行／26190 字符 | 18, 33, 34, 33, 34, 33 | 18, 33, 34, 34, 33, 33 |

完整识别仍在连续输入结束后合并执行；原有投影次数和保存版本断言继续通过。
提交前 `pnpm typecheck`、`pnpm test`（2798 项 Vitest；后续 Node 回归 357 passed、2 个平台 skip）、
`pnpm build:desktop`、`docs:check:ci`（真实 base SHA）及差异空白检查通过；默认 Rust workspace 为
474 passed、1 ignored。Impeccable 对本次生产目标的静态检测无发现。未运行真实模型或改动日常 App 数据。

## 文件预览自动刷新（2026-10-18）

基于 `682f6bf58` 按 User 批复实施，主要改动位于共享 `file-preview-controller.ts`：300ms 末尾防抖、
重新显示统一检查、首次读取后的更新检查和刷新结束后的合并补刷。继续使用原有忙碌状态、更新版本、请求代次
与刷新错误；读取前检查可见性，冷恢复等待期间切走也保持冷态。失败后的重复通知只保留更新标记，
明确重试或重新显示才再尝试。关闭、淘汰和 session 换代清理任务，迟到候选沿原代次规则释放。

句柄已回收的缓存以候选恢复；分页记录可见行号，用既有 `resolveLine`、`readPage` 在新内容中定位，
缩短时回落到最后有效行，重新建立分页位置与缓存。HTML 继续等待原就绪条件再切换，仅处理打开文件自身变化。
未增加刷新服务、通用任务队列、文件版本协议、文本对齐、依赖追踪或界面设置。

测试归入原四组，扩展既有 resources、Desktop service、Web adapter 和 Electron 预览夹具：

- 共享控制器验证当前更新、后台重新显示、连续修改串行收敛、失败与关闭；包含首次加载、HTML 等待、
  防抖及资源接线期间切走、句柄淘汰、分页新偏移和缩短回落。五个相关测试文件合计 **130 项通过**。
- Desktop service 通过真实磁盘保存与 watcher 通知读取新候选；Web adapter 验证现有轮询通知和候选读取接线。
- 隔离 Electron 夹具实际显示更新后的文本、PNG 和 HTML，并验证非首页滚动行号刷新及缩短回落；
  复用原分栏、标签与阅读交互回归，不启动 Core/Runtime，不使用日常 userData。

当前合同按既有冻结规则新增 v22，并同步架构、UI 与当前导航；不改写历史合同语义。

最终 `pnpm typecheck`、`pnpm build:desktop`（含 Web 构建）、`pnpm test:file-preview-layout` 与带基线的
`pnpm docs:check:ci` 通过。`pnpm test` 为 Vitest **2780 项通过**、后续脚本 **357 项通过、2 项既有 Windows 跳过**；
`pnpm test:rust:pr` 为默认 workspace **474 项通过、1 项既有忽略**。并行验证曾出现渠道与评测的两项等待超时，
对应 86 项定向复跑及最终全量均通过，未调整超时或测试准入。差异检查与改动界面的机械设计检查通过。

评审修正（2026-10-18）：临时标签交给系统应用后，回退入口检查恢复显示的标签；分页快照未采样到
可见行号时保存当前页 `startLine`，覆盖普通加载及预加载，保留首次目标高亮；自动刷新复用
`pageRequests` 等待翻页完成，再沿原调度补刷，避免请求代次提前使用户翻页失效。
生产改动只在原共享控制器，未增加状态或调度机制。新增四个复现用例在修复前均失败，修复后通过；
关联五个测试文件 **134 项通过**，类型检查通过。本轮完整 `pnpm test` 为 Vitest **2784 项通过**、
后续脚本 **357 项通过、2 项既有 Windows 跳过**；默认 Rust workspace **474 项通过、1 项既有忽略**。
本轮带基线的文档门禁与差异检查通过。

## 文件传输主线集成（2026-10-18）

按 User seq29 创建 PR 并合入 main，先整合 `25c49c6b3`，再整合期间新进入主线的 `dba014d0c` 和 `1dc593088`。
保留主线 Task 能力、MiniMax Runtime 更新和 Web 登录协议 5；文件传输合同改为继承主线 v6 的
Host Web v7，决策使用 V1.72-D52，避免覆盖主线已占用的合同和决策编号。相关登录夹具同步协议 5，
旧协议拒绝断言仍保留。未增加传输机制或调整已确认布局。

首次主线集成后 `pnpm typecheck`、Host/Web 构建、Rust 格式检查、完整 `pnpm test` 通过：
247 个 Vitest 文件、2764 项；Node 脚本 356 项通过、2 项平台跳过。真实 Host 文件传输、托管渠道、
Chrome HTML/图片原生下载及上传取消 owner 通过。Rust 默认工作区 474 项通过、1 项既有 ignored；
整合 MiniMax 更新后的 native usage owner 另行通过。最终合并检查及完整结果登记在 PR #800。

整合术语清理后再次通过 TypeScript、完整 `pnpm test`（246 个文件、2750 项；Node 357 项通过、2 项平台跳过）、
Host 构建和真实文件传输 HTTP owner。该 HTTP 测试首次停在旧 `Camp` 错误文案断言，更新为主线已采用的
`Thread` 后通过；只调整测试预期，未修改生产错误路径。以最终主线 `1dc593088` 为基线的文档门禁通过。

完整移动端 owner 为 1 通过、4 失败，未记为全绿。隔离构建 `25c49c6b3` 的 Web 界面后，使用同一 Host
和登录协议 5 重跑，在相同位置复现导航 CSS、已变更导航选择器、横屏执行区高度和设置页选择器四处失败。
这些检查发生在文件传输之外；保留原断言，不扩展本轮布局修改。对照使用临时源码和独立浏览器数据，
完成后清理临时源码；此前的多标签草稿与跨平台未验证范围仍按原记录保留。

## 文件下载准入后直接传输（2026-10-18）

按 User seq27 从 `ce11c2c4f` 继续，保留该提交的冷标签与回收边界修复。此次明确调整旧行为合同，
不把前端三行修复当作下载链路简化完成：

- `downloads.rs` 删除两秒授权轮询、Core 业务事件订阅/缺口恢复、Session/Core 活动流撤销监听、
  `Flow::Checking/Ready` 暂停协调，以及下载摘要、尾块留存、最终重开/状态/来源校验。
- 申请只验证来源并打开检查元数据；GET/HEAD 校验短期票据、Session、安全打开和独立大小额度后直接传输。
  `resources.rs` 删除下载专用来源重验对象与预览摘要扫描；可选旧 expectedGeneration 字段只作 wire 兼容，
  不提供严格模式，不改变预览读取自身的版本约束。
- 保留安全无跟随打开、64 KiB 块、单槽背压、并发与空闲额度、取消/断开释放和安全中断日志。
  下载当前内容，不保证旧预览或快照；Session 撤销阻止新准入，业务来源失效阻止新申请，已准入流不主动撤销。
- 不修改 Renderer 布局、下载入口或上传恢复，不新增管理模块、UI 步骤、状态机或存储。
  同步 Host Web v7、统一 Host 架构、D52、UI 与用户指南，历史验收记录保留为当时行为的证据。

测试退役说明：删除 `downloads::tests::event_gaps_revalidate_before_releasing_bytes_and_keep_explicit_revocations`，
其事件暂停/持续撤销合同与生产路径在同一补丁退出。`rovai-web --lib` 可执行测试由 12 项变为 11 项，其他 owner 保留。
继任边界由既有 `scripts/lib/host-web.test.mjs` HTTP owner 扩展，不新建 Rust/进程 fixture：验证来源准入、
当前文件/长度、超预览预算、链接替换拒绝、独立额度、取消释放、短读中断，以及退出/删除后的准入与传输边界。
既有 `host-web-html.test.mjs` 浏览器 owner 改验旧预览下载当前 HTML 且保留预览，局部失败通过原按钮重试恢复。
最小命令为 `cargo test -p rovai-web --lib`、`pnpm test:host-web`、`pnpm test:host-web-html`；
全量使用 `pnpm test:rust:pr`、`VITEST_MAX_WORKERS=2 pnpm test`，文档门禁以 `ce11c2c4f` 为基线。

验收：`cargo test -p rovai-web --lib` 11 项通过，Host 构建与 `pnpm typecheck` 通过。
`pnpm test:rust:pr` 为 474 项通过、0 失败、1 项既有 ignored；相对基线只退役上述已退出合同的一项测试。
`VITEST_MAX_WORKERS=2 pnpm test` 通过：247 个 Vitest 文件、2756 项；Node 脚本 355 项通过、2 项既有平台跳过，
文档和 Skill 检查及以 `ce11c2c4f` 为基线的通用文档门禁通过。
真实 Host HTTP owner 与时钟 owner 独立复跑 2 项通过；最终 HTTP owner 再验传输中追加只发送
原声明长度、截断报短读失败、退出/删除不中断已准入流，来源、Session、链接替换和下载额度仍在准入边界生效。
`pnpm test:host-web-html` 通过，含当前 HTML 原字节下载且不刷新旧预览、文件暂缺后的原按钮重试、
移动视口反馈归属、图片和普通 patch 下载及上传取消。浏览器首轮因测试预期的缺失文件文案不匹配失败，
按现有客户端文案修正断言后通过，未改生产文案或界面。

`pnpm test:host-web` 不记为全绿：多标签 owner 及其独立复跑均在新标签等待 `.camp-nav-open` 时失败，
发生在下载操作之前，与下述已登记的默认视口/导航选择器问题一致；本轮未改该测试或扩展界面范围。
最初整套运行的时钟用例被提前终止，上述独立完整复跑确认其通过。自动验收均使用 macOS 的隔离数据、
Skill Library、MCP 与 Chrome profile，不使用日常 App 或真实模型；Linux/Windows 原生及实体手机仍未验证。

## 文件下载冷标签与回收边界（2026-10-18）

按 User seq25 独立核对 `26564a2fa`，继续在 `rovai/web-file-transfers` 做局部修复：

- 菜单下载移除前置标签激活，直接调用既有 `download`；冷标签按已有来源申请，不启动预览恢复或切走当前文件。
  保留原能力判断和请求代次，不交换调用顺序、不新增等待、重试或下载状态。
- `evict` 与 `evictBytes` 更换预览代次时同步清除临时下载状态；保留文本正文、保留 HTML 页面两条路径均可再次下载。
  旧申请结果仍由原代次校验丢弃，不覆盖后续申请，也不阻止预览资源回收。

生产修改仅菜单删一行、两处回收各补一行；布局、Host 协议、来源授权、版本校验与流式传输均沿用现有实现。
原资源测试覆盖冷标签按来源下载、两种回收及旧结果迟到；原 Renderer 自动验收增加真实右键菜单首次点击。
修复前，两种回收用例均因残留 `preparing` 失败，真实菜单点击用例因下载申请为零失败；修复后上述用例通过。
相关资源与标签测试共 42 项通过，`pnpm typecheck` 和 `pnpm test:file-preview-layout` 通过。
Renderer 自动验收运行于 macOS 的隔离 Electron 夹具，下载 API 使用受控替身，不将其视为新的 Host 端到端或跨平台传输验收。
`pnpm build:desktop` 通过。首次全量测试与构建并行时，既有 `evaluation-host.test.ts` 两项等待后台任务结束超时；
构建结束后该文件 5 项独立复核通过，未修改相关代码、断言或超时。随后 `VITEST_MAX_WORKERS=2 pnpm test`
通过：247 个 Vitest 文件、2756 项，以及 355 项 Node 测试、2 项既有平台跳过；文档及 Skill 检查通过。
`pnpm test:rust:pr` 为 475 项通过、1 项既有 ignored；以 `26564a2fa` 为基线的通用文档门禁通过。

## 文件下载可用性收尾（2026-10-18）

按 User seq23 从 `rovai/web-file-transfers` 的 `787ea974a` 继续，保持 56px 文件行、图标、日夜主题与现有传输链路。
本轮修改限于 Renderer 反馈、下载入口能力及 Web 正文读取错误分类：

- 下载按钮的忙碌状态与结果归入既有文件标签，替换原按钮局部状态和菜单独立反馈；工具栏、菜单、恢复页
  共用 `canDownloadFile` 和 `download`。错误放回所属面板，隐藏、切换或关闭后不覆盖其他页面；迟到结果不激活标签。
  刷新／重新打开用既有请求代次排除旧反馈。成功只有无障碍状态；图片反馈同样留在灯箱内。
- `#readResponse` 接收原调用方的取消信号，成功及错误响应的正文读取使用与发送阶段一致的分类。
  主动取消不报离线；内部恢复超时、真实读流故障仍报连接不可用，旧连接结果受原 generation 约束。
  取消重选核对时清理本次进度，原 commandId、未知绑定及 Core 回执不丢失。
- 差异比较态不提供下载；磁盘上的 `.diff`／`.patch` 是有真实来源的普通文件，按来源及服务端能力下载原字节。
  不增加前端权限系统、下载管理器、轮询或协议；Host、数据库及文件生命周期保持原实现。

验证：`pnpm typecheck`、`pnpm build:desktop` 通过。`pnpm test` 为 247 个 Vitest 文件、2753 项通过，
Node 脚本 355 项通过、2 项既有平台跳过；文档及 Skill 检查通过。扩展原 ConsoleClient owner 覆盖
上传请求／成功正文／错误正文取消，以及核对正文时主动取消、超时、无主动取消的 AbortError 和连接替换；
原预览资源 owner 覆盖同一申请防重复、迟到反馈、跨会话及已关闭标签。
`test:file-preview-layout`、`test:host-web-recovery`、`test:host-web-recovery-live` 和 `test:host-web-html` 通过；
真实 Host 的手机视口验证错误归属、切换隐藏、收起与刷新、不支持预览时菜单下载、普通 patch 下载及图片无成功浮层，
下载保留逐字节比对和不创建整文件 Blob 的断言。Rust 本轮无改动，未重复执行其测试。
自动验收使用隔离数据、Skill Library、MCP 与 Chrome profile；Linux/Windows 原生及实体手机仍未实测。

## 文件查看与下载交互落地（2026-10-18）

沿用 `rovai/web-file-transfers` 工作树；合并主线 `80d11450b` 的断线恢复后，将已确认的 A 方案接入正式组件。
会话卡片整行打开、Agent 文件列表每行 56px，下载只位于查看界面；Diff/Patch 不提供下载，图片不新增可见标题。
HTML 预览／源码与下载统一图标，图片灯箱提供复制及浏览器原图下载／本机保存，手机触区为 44×44px。
文件恢复页和图片解码失败灯箱仍可按有效来源下载；文件已变化保留结构化错误，提供刷新预览入口。

复用既有下载、预览、上传恢复 owner，不新增平台或状态机。与主线合并时保留统一断线恢复入口，上传仍使用
原 commandId 和 Core 回执；刷新丢失字节先恢复连接再重选，摘要阶段断线释放本地进度记录。

真实 Host 验收发现并修正合并边界：主动取消上传只保留原操作的未知回执，不将健康页面切入全页断线恢复；
真正断线仍走统一恢复。既有 ConsoleClient owner 增加取消后仍可正常请求、原回执未丢失的用例。
同步协议测试的 schema 断言到本次合入主线的 155，保留其余指纹及兼容性断言。

验收结果（均在隔离数据及浏览器配置中运行，不使用日常 App 数据）：

- `pnpm typecheck`、`pnpm build:desktop` 通过；最后的取消修复重新执行 `pnpm build:web` 通过。
- `pnpm test`：Vitest 247 文件、2745 项通过；Node 脚本 355 项通过、2 项既有平台跳过；文档与 Skill 检查通过。
- `pnpm test:rust:pr`：475 passed、0 failed、1 个既有 ignored；本轮未新增 Rust 测试函数。
- `pnpm test:file-preview-layout`、`pnpm test:html-preview`（5 项）、`pnpm test:host-web-recovery`、
  `pnpm test:host-web-recovery-live` 与 `pnpm test:host-web-html` 全部通过。
  真实 Host 覆盖 HTML 交互／源码、二进制下载、同页重登后下载、图片解码失败仍下载、Diff 无下载、上传超限／取消／重选；
  HTML、二进制及图片下载逐字节比对，确认新下载未额外创建整文件 Blob。
- 正式组件视觉夹具验证日夜主题、桌面及 375px 手机视口：文件列表 56px，图标桌面 32px、手机 44px；
  文件变化提示可刷新，图片灯箱无新增标题，超预览预算仍有下载。未将夹具 HTML 通道用于正式实现。

仅 macOS 隔离环境和浏览器响应式视口，不代替 Linux/Windows 原生或实体手机验收。

## 文件传输审查收尾（2026-10-17）

针对 `208343138` 的固定提交审查，继续在 `rovai/web-file-transfers` 实施。独立核对后的处理：

- 确认重登回归：下载句柄改用已有的已证明编辑身份边界，再由 Core 重验来源；新票据只绑定新 Session，
  保留所见版本校验，另一个编辑身份仍被拒绝。没有增加前端句柄恢复机制。
- 确认阻塞扫描许可缺口：准备摘要和安全打开把许可交给实际阻塞操作，取消 HTTP 不提前释放；
  最终打开也保留活动许可，Body 取消与 worker 并发退出按已取消处理。
- 调整 Lagged 策略：暂停正文放行，建立新订阅窗口并核对当前来源；新缺口再核对，明确撤销仍终止。
  来源重验合并为一个循环；两秒兜底仍覆盖 Core 之外的路径变化和既有非统一撤销路径，不直接删除。
- 完成票据在缓存紧张时先回收，保留空闲重试；单独表达不可回收的票据容量，避免暗含小文件下载次数限制。
- 中断记录非凭证操作标识、阶段、安全错误码和交给 HTTP 的字节数，不记录 URL、票据、来源或路径。
- 上传多 Map 的维护风险成立，但没有发现本轮必须修复的新状态错误；本轮不重写原 commandId/回执恢复。

测试归属：扩展既有 content scan owner，以受控阻塞操作证明取消后许可仍被占用；既有 HTTP owner 覆盖
同编辑身份重登/跨身份拒绝/旧票据撤销/所见版本、20 次顺序下载及日志字段。新增一个低成本内存 owner
`event_gaps_revalidate_before_releasing_bytes_and_keep_explicit_revocations`，负责广播缺口、重验中的再次缺口、
字节门及明确撤销；这些时序不是原解析/分页测试的职责，不引入 SQLite/Core fixture。
最小命令：`cargo test -p rovai-web --lib`（12 项通过），Host HTTP owner 与
`pnpm test:host-web-html`（含设置退出、同页重登、原预览下载）通过；Web client/adapter 32 项及 TypeScript 通过。
最终 `pnpm test:rust:staged` 路由至完整 `cargo test --workspace` 并通过；Host/Web 构建、
`pnpm docs:test` 及以 `c69a97fbf` 为基线的 `pnpm docs:check:ci` 通过。工具链的 rust-objcopy
缺少 libLLVM 警告未阻断构建和测试；既有多标签草稿基线问题仍按下述记录处理。

交互稿由真实 ThreadNavigation、AppHeader、ThreadWorkspace、AttachmentCard、ImageGallery、FilePreviewProvider/Pane
和生产 CSS 编译成独立 HTML，模拟下载结果，不连接 Host、不传真实文件。保留 Porcelain Day / Steel Night，覆盖
桌面、手机、准备中、交给浏览器、文件变化、来源失效、不能预览及图片附件下载。原型源码按本地规则放在忽略目录，
交付 HTML 与截图独立提供；它是交互评审材料，不能替代上述真实 Host 验收。
本轮仍在 macOS arm64 隔离环境验证；Linux/Windows 原生与实体手机资格没有因此增加。

## 浏览器文件传输（2026-10-17）

独立分支实现 [Host Web v7](../../contracts/host-web-v7.md)：上传 30 MiB 与独立预览预算，
下载专用短期能力、背压、最终块校验、权限撤销和浏览器原生下载；恢复沿用 Core command receipt。
没有新 Rust 测试 fixture；扩展既有 HTTP Host owner 验证传输 seam，前端 transport owner 验证地址/代次/取消。

验证基线 `c69a97fbf`，工作分支 `rovai/web-file-transfers`。本机 macOS arm64：

- TypeScript、`pnpm test`（246 个 Vitest 文件／2,730 项，脚本 355 通过／2 项平台跳过）、
  Rust 默认工作区（473 通过／1 项既有忽略）、收尾 `rovai-web` 11 项、Desktop/Web 构建通过。
- 既有 Host HTTP owner 扩展并通过：30 MiB 精确边界及附加信息、取消后未绑定清理、私有来源拒绝、
  33 MiB 文件、64 MiB 背压／中途变化、空文件、独立额度、HEAD／Range、所见版本、退出及 Desktop 删除 Camp 撤销。
- 隔离 Chrome 使用生产界面验证原生 HTML／二进制下载、零下载 Blob、390px 直接入口、超限保留正文与附件、
  上传进度／取消／重选。未知上传重选和刷新恢复在 transport owner 中核对原 intent，避免第二个来源。
- Host 渠道和定时任务回归通过。`test:host-web` 的多标签用例未通过：新 CDP 标签默认 756px，桌面导航选择器失效；
  统一测试视口后进一步发现新标签复用了旧正文。独立构建基线 Web 也复现后者，当前本地 Composer store 仍按 Camp
  使用共享 localStorage。本次保留原测试判据，不把该套件记为全绿；跨标签草稿隔离需另行修复。

文档按通用治理门禁验证。本次没有真实模型调用、Linux/Windows 原生运行或实体手机验收，不推断这些平台已实测。

## 旧概念残留收口（2026-10-18）

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-legacy-concepts`；分支 `rovai/legacy-concepts`；
  基线 `dfb96a7ecba17490e5c9637944d8872644ab8da7`，与创建时 `origin/main` 一致。未触碰主工作区改动。
- Benchmark evidence 导入改用 `threads.create`／`thread.messages.send`／`threads.snapshot`，读取
  `payload.threadId` 和 `snapshot.thread`。既有报告的 `reviewCampId` 等字段与 legacy Trial 选项保留，
  避免改写已有报告协议。定向用例使用当前 Core shape，覆盖创建拒绝、发送拒绝和意外执行。
- `thread.list` help 说明新 Run 使用当前目录、旧 Run 保留冻结目录、目录读取不推进消息搜索边界。
  新生成的错误说明使用 Thread，机器错误码与持久数据名保持；运行和上下文行为没有改变。
- 当前操作指南、架构／UI 路由、领域词汇与评测教学对齐 Thread/User、reply-chain、当前历史可见性、
  Automation result 和原生 Skills／工具箱。DEMO-105 导航说明普通多目标协作，sealed manifest 的历史标题保持。
- 删除未挂载的 `SkillSettings`、专属单元测试及旧 preview 组件，共享正文去 frontmatter helper 独立保留。
  现有 Electron fixture 改挂生产 `NativeSkillsSettings`／`ToolboxSettings`，继续覆盖 MCP；
  历史 Library/Revision/恢复的 Core owner 保持。临时 userData 不启动 Core/Runtime、不接触日常数据。
- 评测等待脚本以 `--thread-id` 为当前用法，接受旧 `--camp-id`；daily export 使用当前 trace flags，
  文档配置字段与现有 `DailyScope` 一致。
- 已通过 `pnpm typecheck`；全量 `pnpm exec vitest run` 为 246 个文件、2,728 项通过。
- Benchmark、Qualification 与 Context Evaluation 的定向 Node 回归 76 项通过；等待脚本另用临时回执
  验证 `--thread-id`、旧别名及重复参数拒绝，未连接日常 App。
- `pnpm test:capability-workspace` 通过；复核原生 Skills／工具箱截图。覆盖 day/night、1040px/2560px、
  200% zoom、文件导航、失败恢复、迟到响应、过滤后的成员配置及保留的 MCP 交互。
- `cargo test -p rovai-core --lib`：428 通过、0 失败、1 项既有忽略；完整库回归包含 CLI catalog、
  历史读取、冻结上下文、成员、附件及 Runtime owner。`cargo check -p rovai-core --all-targets`、
  `cargo fmt --all -- --check` 和 `git diff --check` 通过；Rust 只改错误／帮助字符串及必要格式，
  已有 unused/dead-code warning 未作为本次清理范围。
- `pnpm docs:test` 10 项通过，`pnpm docs:check` 与以基线 SHA 运行的 `pnpm docs:check:ci` 通过。
  本次不宣称真实模型调用、历史数据迁移或跨平台发布验收。Worktree 状态为 `ready`，保留至后续审阅／合入。

跨版本复核：Version lifecycle 保持 v1.72；Decisions 无新取舍；Contracts 沿用 Thread Naming v1、
User Naming v1、History v14 与 Skills Rebuild v2；Architecture 更新当前 teaching 和 result shape；
UI 更新文档路由／测试归属，生产页面行为保持；Runtime Activity 和 Runtime compatibility 无变化；
Documentation routing 已更新；Root README 无需更新（产品定位和支持范围未改变）。

## 会话 Task 能力开关

R4 已按 User 确认在独立 worktree 实施。范围、完整模型输入前后对照、兼容和 worktree 记录见
[独立变更说明](model-context-change-task-capability.md)，界面依据见
[设计稿](../../research/task-capability-ui.md)。默认关闭实例级 Task 能力；Send 与会话执行解耦，
界面入口采用执行／队员／单聊／任务，数字快捷键一次性迁移为 1–4。
功能、隔离 App 验证与回归结果见[实施与验证记录](task-capability-implementation.md)。两侧合同检查通过；真实场景均在 Runtime 预检受阻，且 Judge 不可用，Gate 为证据不足。

## Web 断线统一恢复（2026-10-17）

- 基线 `c69a97fbff1e986bbd1ff12ecfa55797b73e0553`；分支 `rovai/web-offline-recovery`。
  沿用公共 ConsoleClient 的原提交与回执机制，不增加持久队列或业务页面的独立禁用逻辑。
- 传输失败／SSE 断线进入统一可用性状态；显式恢复先验证服务并等待现有核对，未知结果只重试冻结原请求。
  Core 明确失败与成功缺失回执查询可以结算原 Promise；仅本次重试被拒绝不能抹掉此前未知提交。
- 生产 `WebConnectionRecovery` 保持页面与弹窗挂载，拦截底层键盘快捷键，使用中性主操作。
  刷新丢失上传内容时保留意图并允许重选原文件，不无限锁定页面。
- 验证命令：`pnpm exec vitest run apps/web/src`（54 项）、`pnpm typecheck`、`pnpm build:web`、
  `pnpm test:host-web-recovery`、`pnpm test:host-web-recovery-live`，以及通用文档门禁。
  故障注入 HTTP fixture 拥有回执丢失、冻结原提交、明确失败解锁、模态／快捷键、双主题和手机布局；
  Live 用例另用正式 WebEntry／BusinessApp 与真实 Host 验证停服重启、原 Composer DOM／草稿和 Session 保留，
  并检查刷新后的原提交恢复不阻断导航初始化。
  首轮 Rust 未修改、Live 复用已有 Host，仅通过重命名恢复，不能证明公共发送核对与草稿清理闭环。
  复审后补齐 `commands.reconcile.operation` 的 Thread/Camp 归一化、公共草稿按原提交匹配清理与
  已挂载 Composer 同步，并接入界面语言、移除额外 focus-visible 描边。
  本次重新构建当前 worktree 的 Host；Live 增补真实 Core 校验失败的原 Promise 结算、真实提交丢响应
  的零重发核对、刷新后公共草稿清理和后续编辑保留，报告记录二进制 SHA-256。
  `web_commands` 新增低成本 serde 兼容入口 owner：修复前 canonical Thread 名不进入既有核对分支，
  原 task 字段拒绝 owner 不拥有名称兼容；定向命令为 `cargo test -p rovai-core --lib application::web_commands::`。
  `host-web.test.mjs` 扩展既有真实接口 owner 的新旧名称、recorded/unknown 回执覆盖，未新增 Rust 数据库 fixture。
  定向 Web／草稿／语言测试 62 项、默认 Rust workspace 474 项通过（已有 1 项忽略）。没有调用 Runtime，
  不据此宣称实体手机网络切换或跨平台发布验收通过。日常服务和数据未参与测试。

## Steer 入队回执与阻塞工具核验（2026-10-15）

User seq90–96 的可用性反馈由 [Delivery v18](../../contracts/message-delivery-v18.md) 收口。
Pi、Kiro、ZCode 在原生入队证据成立后确认接收，不等待消费；不改普通输入、版本门槛、数据库或上下文。
Pi 去掉额外消费等待和正文匹配状态，停止仍先清队列后 abort。ZCode 已接收但未 drained 的 guide
仍参加原执行结束清理；Provider 过载只映射固定安全错误，不自动重试。

- Pi 扩展既有 RPC／取消 owner，改为原生完全不发送消费事件：连续两条仍收到回执，延迟写入、
  延迟 ACK、停止先清队列、晚到 ACK 不污染后继继续覆盖。原消费门禁退出，取消和精确 RPC 关联不变。
- Kiro 扩展既有 ACP 回执 owner：原生 queued 通知合并正文仍按逐 RPC 回执确认，错误目标、
  queued=false 和终态后 ACK 不能接受。退出逐正文／injected 门禁，其他 ACP 的拒绝、迟到、owner 关联矩阵保留。
  回执归属在 reader 接收时判断；配对覆盖 ACK 后终态、终态后 ACK，避免 waiter 调度顺序把已接收改成未知。
- ZCode 扩展既有事件 owner 的精确 queued、重复与错误关联矩阵；新增
  `guide_receipts_precede_consumption_and_terminal_clears_the_queue` 扩展 owner，以内存双向流证明
  两条输入不依赖消费而返回，结束必须先清队列。仅事件 parser 不能覆盖回执 sender 已移除后 transport
  是否仍清理的跨 worker 回归；不使用进程、数据库或模型。
- 最小验证：`cargo test -p rovai-core --features extended-tests --lib active_input_` 与
  `cargo test -p rovai-core --features extended-tests --lib zcode::`。
- 真实模型统一通过 `probe-steer-version.mjs receipts` 的隔离 Core／Builder／Adapter 路径，记录工具释放前
  与最终结果；停止用例在确认入队但工具仍阻塞后取消，再普通续接。结果见
  [九种 Runtime 回执报告](../../research/runtime-monitoring/steer-queued-receipts-2026-10-15.md)。

版本缓存与展示分支按 User seq98 合入同一 PR。复核确认该分支未处理启动摘要错误，本次在补齐版本时刷新现有
config_digest；扩展已有 launch-version slow owner，沿真实 prepare／rebind／claim 路径验证 Pi、Qwen
版本补齐与版本检测失败两种普通启动均可领取。不新增 owner 或全局健康检查。
最小入口：`cargo test -p rovai-core --features slow-tests --lib launch_version_uses_the_frozen_program_without_blocking_ordinary_execution`。
本次属于局部可逆的回执语义对齐，未达到新版本决策的准入门槛；既有 Run／Host 边界保持。

## 智能体已知版本保留（2026-10-15）

按 [Runtime Launch v64](../../contracts/runtime-launch-and-verification-v64.md) 修复正式版本投影：
静态发现没有重读版本时，以当前路径及非空 fingerprint 关联同一 Installation 的历史值，不再按搜索代次
切换版本来源。三条快照写入路径在程序 fingerprint 相同时保留已有非空版本，程序替换后清除旧值。
队员配置去掉本地 snapshot 回退，与设置目录统一消费 Core 的版本字段；执行准入和启动发现保持。

验证覆盖：

- 新增唯一纯投影 owner `runtime_versions_follow_program_identity_instead_of_search_generation`，覆盖静态发现、
  读取空值／失败、真实新版本、路径变化、指纹变化／缺失和搜索代次切换；原代码的同代次空值会丢失版本。
  现有 readiness owner 不拥有版本字段，因此单独建立最低成本的无进程矩阵。
- 扩展 `failed_probe_keeps_the_last_successful_catalog_and_marks_it_stale`，在原 SQLite fixture 中验证
  Command、managed 和 static 三条保存路径的空值保留与程序替换；没有新增平行数据库 fixture。
- 扩展 `discovered_runtime_verification_keeps_database_available_and_identity_after_restart`，通过真实隔离
  数据库重开与公开 health 投影验证版本恢复。持久化／重启链路不能只由纯函数证明；沿用原 fixture。
- 上述 owner，以及 `runtime_check_manager_rebinds_after_version_replacement_and_commits_ready`、
  `detected_entry_remains_launchable_after_an_explicit_diagnostic_failure`、
  `launch_version_uses_the_frozen_program_without_blocking_ordinary_execution` 的定向测试通过。
  命令为 `cargo test -p rovai-core --features slow-tests --lib <owner>`，每个筛选均实际运行一项。
- `App.test.ts` 既有平台矩阵同时渲染设置与队员表单，确认二者使用同一版本、未知时不复活原 snapshot。
  与 `runtime-check.test.ts`、`runtime-status.test.ts` 合计 211 项通过；`pnpm typecheck`、
  `pnpm build:desktop`、`cargo fmt --all --check` 通过。
- `pnpm test:rust:pr` 默认 workspace 回归通过。干净副本的 `pnpm test` 首轮 Vitest 为
  2715 通过、1 项语言目录扫描超过既有 5 秒预算；该文件单独重跑 2 项均通过，未改超时或测试内容。
  随后执行原脚本剩余 Node 阶段，355 通过、2 项 Windows 专用验证按原条件跳过。

以上为版本分支合并前记录。组合审查另补首次版本保存遗漏：实际读取成功后，认证／协议检查失败或
普通启动和静态发现也保存既有版本字段；无快照时保持 `installed_unverified`。程序升级后重置旧健康证据，
同程序只更新版本；保存失败不阻断普通启动。没有新增表、字段、探测或缓存服务。
扩展既有 `discovered_entry_configures_and_freezes_without_health_evidence` 的首次版本、空值、错路径、
旧指纹及升级矩阵；扩展 `runtime_check_manager_binds_stable_failure_to_rebound_fingerprint` 的检查失败／重启
公开投影；扩展 launch-version owner 的启动补存。原 launch owner 新断言在修复前为 None 对 Some 红测，
另以临时 SQLite trigger 注入版本缓存保存失败，普通 prepare／claim 仍成功。
既有 discovery／restart owner 从实际 versioned observation 入口保存，再验证重启和无版本发现保留值；
保留原本无健康快照重启、全局锁不跨文件等待的断言，不为静态版本增加探测。
不新增 Rust owner。最小命令为 `cargo test -p rovai-core --features slow-tests --lib <owner>`。

该独立分支此前没有真实模型调用或日常 App 安装。原主 checkout 的文档检查会扫描 Git 忽略的本地原型并报告旧坏链接；
提交内容的文档门禁在隔离的干净提交副本通过（包括真实 base SHA 的 diff-aware 检查），
不修改原型或添加 checker 例外。

## Claude 受管执行回执与启动期待插话（2026-10-15）

按 User seq86、seq88 实施 [Delivery v17](../../contracts/message-delivery-v17.md)。不调用真实 LLM，
没有修改数据库、正文存储或模型输入。生产变化在 writer／回执、Core 终态与启动路由、版本传递和 UI 投影。

- 既有 Claude writer／idle owner 改为覆盖内部 result 前后回显均接受；错 Session／UUID 拒绝，FIFO、
  可靠 idle 后缺回执不阻塞、退出后输出收集、取消零字节撤销及部分帧不重发保持。原“必须同前台段”
  断言随产品合同退出；进程／Run／Session 隔离继续覆盖。
- 既有 Delivery owner 增补 queued 和初始化阶段意图，不物化正文、不改初始输入；初始接受后才可投递，
  启动失败／停止不续跑。真实 success 命令分别覆盖 prepared 和 unknown 补充输入，不以手改终态替代验证。
- 新增 launch-version Core owner：旧 Pi 发现缓存会造成冻结版本缺失；仅发现探针测试不能验证 Core 缓存到
  冻结配置的传递。隔离 Core＋假程序覆盖精确路径、旧摘要拒绝、有效缓存和版本失败仍普通运行。
  最小入口：`cargo test -p rovai-core --features slow-tests --lib launch_version_uses_the_frozen_program_without_blocking_ordinary_execution`。
- 既有生产 UI 夹具补启动期入口、待插话／发送中及多人互斥摘要；版本表仍由 Core 拥有。
- 定向 Claude、Delivery、冻结版本、迁移／故障恢复、生产 UI、TypeScript、`pnpm test` 和文档门禁已通过。
  主线同步后的完整回归与安装证据见 [PR #772](https://github.com/murray17/rovai-ai/pull/772) 验收记录；
  不把可控协议测试解释为新增真实 LLM 实测。

## 消息回执对齐与 Claude 写入边界（2026-10-15）

以 main `95110b4b` 为基线实施 User seq74 的交互稿与 seq75 的两项补充修复。无数据库迁移、额外正文、
回执存储或提示词变化；CodeBuddy #762 和最低版本政策保持。

- Claude 复用既有 writer／idle 扩展 owner：可控 AsyncWrite 分别提供零字节 Pending 和一字节后 Pending，
  注入取消／原轮 result，检查唤醒、明确未接受与未知的区别、后继阶段无旧零字节输入、部分帧不重发，以及后台任务／idle 完整收尾。
  新零字节用例在修复前失败，修复后通过；只在同步 poll 中持有状态锁，不跨异步等待。
- 生产 UI 夹具扩展既有 Steer owner：12 类 Composer／回执路径、10 组消息回执 × 日夜 × 1440/1040，
  覆盖左右对齐、hover 不位移、键盘／复制／展开、失败／停止／无 Run、已接收但 Run 失败的互斥计数与图标。
  失败／停止汇总为“未完成”，详情区分两者；成功普通目标退出摘要。
- 验证通过：`pnpm typecheck`、`pnpm test`（Vitest 2714、Node 355 通过／2 平台跳过）、
  `pnpm test:rust:pr`（473 通过／1 既有忽略）、显式 extended-tests 的 Claude 3 个 owner（先核对清单），
  `pnpm test:steer-ui`、格式检查与差异文档门禁。
- `pnpm package:mac:daily` 的 arm64 签名检查通过；隔离 packaged Desktop/Core 冷启动、独立数据库／Skill／MCP 路径、
  日夜主题与零 Renderer 错误通过。验收脚本首轮因 `/var` 与 `/private/var` 的路径表示断言失败，改用同一目录的规范路径后通过，产品代码未为此改变。
- 本次不调用真实 LLM，不把可控写入测试解释为真实 Claude 事故复现。PR #769 只交付这些局部修复。

## Steer 局部修正（User seq54–63）

复用 `pi::host` 的消费／取消 owner 验证持锁延迟写入、Steer ACK 等待清队列、abort 到达时队列为空，
以及停止后原生 streaming 事件不能重新开放输入；复用 `claude_control` 的 writer／idle owner 验证
包含／不包含 UUID 的原轮 result、后继回显与尚未写入的旧帧不能跨阶段。沿用扩展层，不新增 Rust owner。
`delivery_queue` 的冻结准入 owner 同时验证新消息关闭撤回、旧标记只读投影与直接 API 拒绝。
生产组件 UI 夹具覆盖空输入／输入／清空时的按钮切换、队长运行时只提及空闲队员、执行结束、多人混合摘要、成功／未知无撤回和普通待发可撤回；
交互稿复用相同组件；合并门槛包括默认／扩展回归、文档门禁和桌面构建，安装前另做隔离打包验收。
实际键入并选中提及、再添加所有队员及删除提及，验证按钮在草稿延迟保存前已使用实时接收者。

## Steer 合入前自检（2026-10-15，User seq47）

以主线 `1681b99e` 为合入基线。主线 203 的操作格式与分支 203 的 Steer 结构分别识别，
204／schema 154 只补缺少的结构；既有填充夹具追加分支 203 的 accepted／unknown／prepared 保全、
回执保存失败回滚及重复打开验证。来源、视图和去重约束不完整时拒绝准入。
历史数据库矩阵沿用既有 owner 并归入 extended-tests，不新增平行测试。

Desktop Main 精确开放 `runtimeInputs.reconcile`；生产 Composer 以 continuation 物化后的正文预览，
提交时依据 flush 后正文和点击时 Run 快照计算目标。Pi Start／Steer 共用图片授权字节准备、
模型能力校验、MIME／大小检查和发送前证据；扩展既有 RPC owner 检查原字节与拒绝零写入。
规范与需求审查分别复核以上修复；既有 CodeBuddy #762 不关闭。
收尾复现了 waiting／approval 状态下准备 Steer 的拒绝；仅补充输入接受 waiting，普通首次输入仍要求 running。
沿用多输入 owner 验证回执不解除原等待，修正前红测、修正后定向绿测分别保留。

User seq49 的存储复核沿用普通输入和执行记录的现有合同：Steer 不复制最终输入的各节正文，
也不持久化 `canSteer` 或原生输入回显。既有多输入恢复 owner 补上退役快照列保持 NULL、最终 Blob
原字节可读和事件无输入正文的断言；删除 Read Model 的未使用重复查询。
隔离打包存储升级脚本使用合并后的 schema 154，继续验证旧正文、格式 4、输出预算、文件展开和重启不重投。
验证结果与审查分别记录于[合入前自检](../../research/runtime-monitoring/steer-release-review-2026-10-15.md)。

## Steer 版本复核（2026-10-15，User seq44）

CodeBuddy 从离散名单改为 `>=2.109.1`；按 User seq46 移除大版本上限及推荐版本。
增加专用 ACP `session/steer` 与原生请求归属，
仅明确方法不存在时复验原执行后使用旧并发 Prompt；识别新版精确 metadata 通知。
普通执行资格、共同上下文、数据库和 UI 保持。ZCode 对 User 使用 App 3.12.2，内部沿用内核核验。
Claude 2.1.81／2.1.83 官方包及 sub2api 实测确认当前接线边界。

真实 LLM 主验证十个尝试共 30 case：26 通过、4 失败全部归档；
结束协议补齐后的构建另做结束／失效目标 1/1 补验，总计 31 case。CodeBuddy 2.167.0 修正后三次连续输入与三项
停止／结束均通过；2.133.1 前后各 3/3；2.109.1 新复测 2/3，不关闭 #762。
TRAE CN 0.207.1 完成连续输入、附件、普通排队、多目标、停止续接与结束边界。
准确范围与二进制身份见[报告](../../research/runtime-monitoring/steer-version-followup-2026-10-15.md)。

Rust 扩展既有 ACP 回执 owner、metadata owner 与 frozen Run 准入 owner，三个定向测试通过；
没有新增测试 owner。完整门禁结果记录于报告末尾。

## 队员头像简化（2026-10-14）

Mission `rvm_01a1390f1fc377028f1bae8eb8f78cf0`，分支 `rovai/mission/062`，基线 `3d4db22df`。
User 消息 27 授权按确认的 R8 实现并 PR 合入 main，解除此前仅设计稿限制。
实现覆盖队员配置、会话/Mission 身份卡、引导、欢迎区和历史入队回执；回执仍使用创建快照。
新 schema 3 只存 source 与取景，Desktop/Web/Agent 共用新路径；旧 schema 1/2 和旧确定性创建重试保持。
渠道冻结静态 PNG 到既有 Core data 的私有资源目录，无数据库迁移；身份、运行配置和模型上下文边界不变。
`member-studio` 只调整本任务明确授权的可选头像教学，不变更自动 Bootstrap、Skill description 或身份生成规范。

测试 owner：扩展 `member_avatar::tests` 原有 14 项，不新增或移除 Rust 测试；旧协议、恶意路径、损坏、
格式及幂等矩阵保持。渠道 resolver owner 增加持久冻结/并发/重启验证，UI 使用生产组件夹具，真实 GIF
seam 连接隔离 Core 与 Web adapter。原型内存模拟不是生产验收证据。

本机验证（macOS arm64，Apple M5 / 32 GiB）：

- TypeScript、完整 Vitest 243 个文件 / 2,669 项、Desktop/Web/Execution Web 构建通过。
- 队员页生产组件 22 组检查通过，包括上传后裁切、取消/坏图/晚到读取、确认失败重试、一次主保存清除 dirty，
  以及原有分区保存、部分成功、冲突、个人资料、移除与菜单。双主题、窄窗口、2K、缩放截图已检查。
- Chrome 生产会话 fixture 的 38 个状态及交互回归通过；身份卡覆盖鼠标/键盘、焦点恢复、非模态关闭、
  折叠/展开、当前与未配置 Runtime，以及 1440×920、375×812、844×390 的长资料与双主题截图。
- 真实隔离 Core + Web 图片 adapter 的 GIF 六组检查通过：动画预览/稳定 URL、单文件保真、保存/重选/刷新，
  以及 192/240 静态封面。静态非居中取景与 GIF 首帧局部画布、旧资产/replay、安全输入由 Rust owner 覆盖。
- 文档单元 10 项、普通与基线 `3d4db22df` 的 diff-aware 门禁、Skill 单元 3 项及 12 个 Skill 检查通过。

直接显示预算使用两组低字节但接近 3200 万累计像素的合成 GIF：512×512×120 帧（109,473 B）和
1024×1024×30 帧（57,213 B），40 ms/帧，三色轮换，12 个独立受管引用与 Blob URL 同时显示。
上传受 Core 完整校验；读取新资产核对 hash/结构/元数据，不再重复解码整段动画。
Electron 两组均 12/12 实际截图颜色变化，3 秒帧间隔 p95 分别 17.6 / 16.8 ms，无 >50 ms 主线程长任务；
Renderer 峰值工作集约 281 / 268 MiB。1024 组的 12 张首读至图片加载完成为 54 ms。
Chrome 在桌面和 375px 视口均 12/12 动画，p95 16.7–16.8 ms，无长任务；最大观测帧间隔 33.3 ms。
因此保留单边 1024、累计 3200 万像素、200 帧和 10 MiB 的联合预算，不按压缩文件大小单独准入。
这些结果证明本机桌面与浏览器渲染路径，不代表实体手机、Safari、Windows 或全部设备性能。

复现入口：生成指定画布/帧数/40ms 三色 GIF 后，以 `ROVAI_AVATAR_STRESS_GIF=<绝对 GIF 路径>`、
`ROVAI_MEMBER_AVATAR_FIXTURE_ROOT=<新建规范绝对目录>`、`ROVAI_KEEP_MEMBER_AVATAR_FIXTURE=1` 运行
`pnpm test:member-avatar-flow`；再运行 `node scripts/review-member-avatar-browser-budget.mjs <同一目录>`。
后者读取前者真实 Core 产生的受管结果，以独立 Chrome profile 验证相同生产组件和浏览器图片 adapter；
不声明真实远端 Host 或渠道账号验收。计时记录而不设机器相关的 CI 断言；实际动画、文件数、字节和导出为硬断言。
Rust `cargo test --workspace` 通过（471 项，1 项既有人工 smoke 忽略）；
`cargo test -p rovai-core --features extended-tests --lib -- member_avatar::tests member_profile_reads_and_patches_preserve_scope_atomicity_and_replay confirmed_user_input_can_create_one_idempotent_member_but_agent_input_cannot`
16 项通过，涵盖头像 codec/存储及 Agent 创建、修改、重放/回滚 seam。Rust 格式检查通过。

合并前按代码规范与 Mission/R8 需求分别独立审查，规范轴 4 项（3 P2、1 P3）、需求轴 2 项（P2）已全部修复并复核：
旧 GIF 确定性重放恢复规范化后的取景夹紧；钉钉空图不会冻结为不可恢复的发布快照，补图可在同一 intent 重试；
外部指定的验收目录一律保留；删除新增焦点外框；头像 Dialog 按 R8 返回实际入口的限定例外同步到上层规范；
读屏与视觉缩放倍率一致。修正后渠道 resolver/钉钉 79 项、扩展 Rust 16 项、队员页 22 组、TypeScript 及
diff-aware 文档门禁再次通过。未新增剩余审查发现；真实渠道账号、实体移动端和 Windows 不在本次执行证据内。

## Pi 接收容量与连接失败原因（2026-10-14）

User 确认优先修 Pi 接收容量及错误类型，采用单帧默认 64 MiB。基线
`7a40768ccded50af6e4ec062d355f17e6efc3337`，分支 `rovai/pi-inbound-frame-budget`。
独立 worktree 为 `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-pi-inbound-frame-budget`；
无需先行治理提交。当前合同为 [Runtime Launch v63](../../contracts/runtime-launch-and-verification-v63.md)。

- 触发证据：Pi 1.1.0 的图片 read result 在 content 与 structuredContent 重复 base64；
  本次 1,860,849 字节 GIF 返回的 RPC 事件约 4.73 MiB，超过原 4 MiB 接收限制。
- Pi 入站改为 64 MiB，保持读取时的有界检查；出站 4 MiB、stderr 64 KiB 及其他 Adapter 不变。
  错误通过 typed cause 传到 pending command、Host 退出事件与受 Run/epoch 保护的 loss 事务。
  公开 detail 仅含安全原因/字节数，非法记录诊断不复制正文。
- 内部 unknown-outcome 代码、禁止重放、终态 fencing、Fleet 停止/reap 与 Single Chat 取消保持。
  无数据库迁移、头像修改、上下文格式变化或 App 安装。

测试归属：扩展既有 JSONL parser owner，保留 Unicode 分隔符并增加跨块、CRLF、EOF 和 64 MiB
临界输入；扩展既有 Runtime loss owner 检查持久原因、accepted/unknown、不重试及旧代次/已知终态；
扩展 Single Chat 原 policy/restart owner 验证 Snapshot 仍显示当前回复已取消，安全原因保留在 Run 记录。
新增 `pi::host::tests::inbound_image_frames_preserve_host_health_and_typed_loss` 作为管道/Host seam owner：
修复前大于 4 MiB 的合法图片事件杀死 reader，原 parser owner 不能证明 Host 健康、pending RPC 和
退出事件的原因传递，既有 Host fixture 只拥有会话切换与 abort correlation，因此复用 fixture 增加一个
独立扩展层 owner；精确尺寸矩阵仍只由 parser 拥有。

最小验证命令为 `cargo test -p rovai-core --features extended-tests --lib -- pi:: runtime_loss_settles_uncertain_input_and_fences_old_or_terminal_executions built_in_policy_is_closed_and_runtime_loss_cancels_only_the_reply`。
本机验证结果：

- `cargo test --workspace`：471 项通过、1 项既有人工 Runtime smoke 忽略。
- 上述定向扩展层命令：27 项通过、1 项既有 Pi Machine Ready smoke 忽略，包含新增管道 owner、
  64 MiB 精确边界、RPC 原生拒绝/协议错误/EOF、持久原因和 unknown 输入保护。
- `cargo fmt --all --check`、`git diff --check`、`pnpm docs:test`（10 项）、`pnpm docs:check` 与
  相对上述基线的 `pnpm docs:check:ci` 通过。

User 于 2026-10-14 要求合入 PR #743。合入前同步主干 `321cffdc0a21ef0a2c6b1721e0f75bd430477e8e`，
仅版本概览的并列新增段落发生冲突，两项记录均保留；七个 Rust 文件相对新主干的修复与原提交一致。
同步后再次通过默认 Rust 471 项、定向 27 项，以及格式和通用文档门禁，既有人工 smoke 仍忽略。
验证使用隔离临时数据库及合成 Pi 管道，不启动日常 Core、App 或真实模型。

## 会话切换读取回归修复（2026-10-13）

基线 `50d50d3a46ec409420a9c1382ab5101ba16892bd`，分支 `codex/remove-session-rebuild-notice`。
User 要求删除原生会话重建提示和对应事件历史判断，并授权 PR 合入及日常 App 安装。
删除公开/单聊 Renderer 提示与翻译、两类 Run View 字段及各自 SQL 子查询。
恢复和 continuity 审计仍由原 Runtime 路径拥有；不新增迁移或模型上下文变更。
字段边界见 [Runtime Launch v62](../../contracts/runtime-launch-and-verification-v62.md)。

复用 `read_model::camp_open_slow_tests` 的完整首屏事件访问禁止及规模 owner；
在既有 `single_chat::tests::successful_final_is_private_and_a_cancelled_run_cannot_append_late_output`
增加公聊/单聊投影的 SQLite authorizer 禁止事件读取断言，不新建独立测试或放宽原性能边界。

- 5 项 CampOpen 慢测与上述单聊 owner 通过。无关事件从 5 万增至 500 万、无关 Evidence 从
  1,000 增至 100,000 时，首屏 SQL VM 步数保持 3,085。
- 同机两个真实会话的生产 ReadModel 只读测量，11 次采样的后 10 次中位数从 985/1,105 ms
  降至 21/22 ms；这是 Debug Read Side 测量，不含 Electron 渲染、IPC 或共享数据库锁等待。
- 类型检查与完整 `pnpm test` 通过：242 个 Vitest 文件、2,656 项用例；后续 Node 340 项通过、
  2 项平台跳过。文档带 base 的 CI 门禁通过。
  主目录的 Git 忽略原型存在既有坏链接，因此完整前端及文档门禁在同基线加本次 patch 的干净
  临时检出运行，共用已锁定的 Node 依赖；未改动本机原型或跳过测试。
- User 后续明确要求只跑专项：正在运行的 Rust workspace 全量已停止，不计为通过；后续只做
  与会话打开相关的定向验收及构建/安装校验。

## 项目目录 JSON 保存（2026-10-12）

基线主线 `bab6034df3459269a4a15628dc436d660716f1ac`，分支 `rovai/json-project-navigation`，复用原隔离
worktree `rovai-ai-sqlite-project-registry`。User 明确撤回未发布的 SQLite 登记方案，不保留实验表迁移或读取兼容。
旧分支的项目建表／迁移、Core 接口、Web 身份、业务事务自动登记、持续观察与补登全部退出；生产数据库代码
与所接入主线一致，保留主线现有 schema 与支持来源。实验 schema 不作为发布过的升级来源，日常数据不作修改。

schema 6 导航偏好保存规范路径集合与 `legacyProjectsSynced`。成功完整启动读取只尝试一次补齐；晚到结果在
统一写入入口重新应用最新移除记录。实际写入后才更新内存并展示新目录，失败不误标记、不覆盖损坏文件。
完成后直接使用登记清单，普通导航刷新不再补缺、重读偏好或写目录。目录增删与别名等共用原安全写入口。
Web 复用现有 IndexedDB 的短事务串行保护原 localStorage JSON，没有新目录库、持久队列、锁轮询或自动重试。

按 User 后续要求，从 `4b1fae539` 收敛保存失败反馈：删除专属横幅、重试闭包与临时路径状态，失败只走已有
短提示／表单错误，不改变当前目录；再次添加即可重新保存。旧补齐失败等下次启动，可选登记失败不阻止会话。

Rust 测试退役：实验生产合同同时退出，删除 `project_registry::tests` 三项（目录生命周期、初始化失败、
登记附加事务故障）及 `db::project_registry::tests` 一项实验迁移 owner；原业务事务、路径权限、Main 项目访问恢复、
主线数据库准入／升级测试保留。目录持久化语义由真实文件 `navigation-preferences.test.ts`、Web 偏好 owner、
真实双窗口导航 fixture 与生产 App 启动 fixture 接替；不以降低测试数量为目标。

初版验证结果（反馈收敛后的定向结果另记）：

- `pnpm test`：242 个 Vitest 文件、2,643 项通过；后续 Node 339 项通过、2 项平台跳过；文档、Skill 与 Electron 能力门禁通过。
- `pnpm test:rust:pr`：465 项通过、1 项既有 ignored。首次运行的 detached child 回收测试超时，定向重跑及第二次完整 workspace 均通过；未修改该测试。
- Main 真实文件、Web 与目录投影定向 32 项通过。生产 App 目录专项 4 组通过：空目录切换／重启、完成后零补齐、主动移除后的空清单、失败降级／显式重试与后续保存失败不重置标记。
- 真实 Electron 双窗口并发登记／别名写入与移除优先通过；普通导航原生操作及 contextBridge 回归通过。
- `pnpm typecheck`、`pnpm build:desktop`（含 Web）、带上述 base 的文档 CI 门禁与 diff 检查通过；前端机械扫描无发现，截图修正并复核失败提示栏。
- 完整启动 fixture 仍在 `Leaving the loaded empty Camp must initiate cleanup before the race is tested` 失败。
  在 `bab6034df` 独立临时 checkout 上复现相同失败；双方仅把 darwin fixture 的 Windows-only `windowClose` 能力按真实 preload 设为 undefined，基线生产代码未改。
  该既有空会话清理断言未删除或跳过；目录专项另外执行并通过，不把完整启动套件记为通过。

反馈收敛验证：类型检查及目录专项 4 组通过，验证失败不显示／选中目录、普通提示自动消失、再次添加成功、
下次启动补齐以及完成标记保持。`pnpm test` 重跑 2,643 项 Vitest 和后续 Node 339 项通过、2 项平台跳过。
首次全量中 CoreClient 的 Supervisor 等待超时，其文件 21 项定向及完整重跑均通过，未改该测试。
前端机械扫描无发现，截图确认使用普通短提示。持久化、并发与 Rust 代码未修改，沿用初版验证。

未安装日常 App、不启动真实 Runtime、不操作用户数据库；临时基线 checkout 已清理，任务 worktree 保留供评审。

## Charter 与 Memory 入口精简（2026-10-12）

User 消息 `ed8ae499-ebbe-44ae-a6ba-e0b588e04912` 已确认
[R2 文案及兼容边界](model-context-change-charter-memory-concision.md)并授权 PR 合入 main。
分支 `rovai/charter-concision-r2` 从 `bab6034df3459269a4a15628dc436d660716f1ac` 创建，
先合入此前尚未进入 main 的 Codex 专属提示删除，再实施共享精简。
本次只替换固定文案、维护 revision 与既有测试；共享兼容摘要不变，无数据库或动态 Context 变化。

实施已完成。生产文案与确认 R2 逐字一致；复用既有 Charter／Bootstrap／Single Chat／Binding／Codex
Adapter owner，定向 29 项通过，未新增、删除或禁用独立 Rust 测试。
`pnpm test:rust:pr` 465 项通过、1 项既有 ignored；文档 10 项测试、普通及基于上述 base 的
diff-aware 文档门禁、Rust 格式和 diff 检查通过。未运行真实模型行为评测，
不把字符缩减或确定性测试表述为模型行为改善。

## CJK Markdown 与引用投影（2026-10-11）

基线 `4522057d5e5af503647a5f883902c6babb98f314`，分支 `rovai/cjk-markdown-quotes`。
SafeMarkdown 与两处正文解析辅助函数使用 remark 的现成 CJK 扩展；Core 改用启用同等扩展的
Comrak 0.48（满足 workspace 的 Rust 1.85 下限）。保留单波浪线字面值、隐藏任务框后的正文空格和既有段落边界。
新引用沿用 locator 的 projectionVersion=2；快照仍为 version 1，不迁移消息或引用。
旧摘要失配只影响高亮，完整引用继续展示与进入模型输入；不新增服务、队列或模糊定位。

复用现有 Rust 纯投影、SQLite capture owner 与隔离 Electron 引用 owner，共读
`packages/contracts/fixtures/message-quote-projection-v2.json`，保留全部旧例并增加原问题片段、中文标点、
嵌套、代码、转义、流式未闭合、GFM 和结构化 Mention。SQLite owner 同时验证旧快照字节不变与捕获摘要。
Electron 继续验证原生选文、复制关闭、v1/v2 回跳、旧定位失败后的完整展示、移除与重排、私聊视口和高亮重排。
共享用例增加后，回跳验收改为在有限时间内等待行进入视口，避免将原固定 400ms 误当滚动完成。
未新增、删除或停用 Rust 测试函数；复用现有最小内存 schema，不启动 Core 或模型。

当前权威同步到 Message Quotes 合同、架构与会话区 UI。此为可逆的解析器适配，现有投影版本和不可变快照
已拥有兼容边界，不满足新 Version Decision 的高变更成本准入，不新增决定或修改版本指针。

验证结果：共享用例 55 组（全部保留原 21 组），Core 投影/capture 的 3 个既有 owner 与真实 Electron
引用交互均通过；包含日夜主题截图、CJK 原生选文、代码字面量、引用复用与失配反馈。
`pnpm test` 通过：Vitest 2,625 项，后续 Node 339 项通过、2 项平台专属跳过；文档 10 项、Skill 3 项与
Electron 能力分类 7 项通过。`pnpm test:rust:pr` 465 项通过、1 项既有 ignored。
最终空代码块边界修正与旧快照用例完善后，Core 定向 3 项再次通过；55 组 Electron 用例通过。
`pnpm typecheck`、包含 Web/执行台构建的 `pnpm build:desktop`、带上述 base 的 `pnpm docs:check:ci`、
Rust 格式与 diff 检查通过；前端机械设计扫描无发现。未安装日常 App，未启动真实 Runtime。

## Windows Web 凭据可用性（2026-10-11）

基线 `70510b3fa43a7fe845e339fd5dbbe8391ad20e39`，分支 `rovai/windows-web-auth-availability`。
`rovai-web/auth.rs` 的读取和持久化在 Windows 改用凭据专用平台入口，非 Windows 继续调用原私有文件接口。
平台例外只生成/读取固定 `web-auth.json`，同目录新 sibling 保留原子替换；加固只操作新空文件的既有句柄。
Host 生命周期与 HTTP 保存失败传递安全分类，Desktop 使用已有失败 envelope，Web 登录/注销显示保存原因。
不更改 schema、协议版本、存储格式、位置或正常认证逻辑，不涉及模型上下文。

### 测试归属与复现

- 扩展既有 `authentication_reopen_preserves_renewals_and_never_resurrects_revocation`：
  Windows 有效继承文件在修复前因缺少 protected DACL 失败；修复后读不改内容/ACL，后续登录、续期、
  回收、注销、关闭、轮换、重开和失败时保留 registry 沿用同一 owner。无数据库、网络或 Runtime。
- 新增最低成本平台 owner `web_auth_hardening_failure_preserves_atomic_io_and_path_checks`：
  真实临时 NTFS 文件验证定向注入的额外 DACL 加固失败不阻断创建/替换，而原子替换 I/O 失败仍保留旧字节并清理 sibling。
  同时验证非普通文件拒绝、通用私有接口仍严格；既有通用 private JSON owner 不能注入凭据专用加固边界。
- 扩展既有 Host pipe/HTTP owner，使用隔离 Core 和合成凭据检查内容异常、真实拒读、继承/额外 ACE/
  无 WRITE_DAC 的读取，以及保存失败的 503/具体原因/零 Session；沿用该 owner 的完整 Host 重启验证。
  已准入 Core 目录暂时拒绝创建文件时，Token 查询仍可读取；初版重复父目录 DACL 门禁的红测失败已复现，
  最终实现只在凭据 I/O 重验路径/卷/身份，Core/Server 的初次目录准入不变。
- 扩展真实 Electron contextBridge owner 与 Web client 失败重试 owner，检查错误文案传递及失败不清空有效客户端会话。

### 验证记录

- 修复前 Windows 定向 auth 回归：1 项失败，错误为文件 DACL 未保护；未读取或记录日常 Token。
- Windows `rovai-web` 全部 11 项通过；平台 private-storage 全部 7 项通过；真实 Electron bridge 1 项通过。
- 完整 Host pipe/HTTP owner 通过，包括目录拒绝新建文件时的首次 Token 查询与进程重启；Web client 23 项通过。
  TypeScript、Web 构建、Rust 格式、文档 10 项测试、普通及 diff-aware 文档门禁通过。
- Windows 全量 Vitest：2597 通过、16 跳过、11 失败。失败均为原有六个文件预览/评测/分析测试模块的
  符号链接创建 `EPERM`；在未修改的同基线 main checkout 重跑六个模块，复现相同 11 项失败。
  不将本轮全量结果记为通过，不修改这些独立模块或提升系统权限；PR Linux CI 单独验证跨平台门禁。
- 未测试实际磁盘耗尽、断电、杀毒软件特定拦截或网络共享；目录准入不扩展至这些场景。
  加固失败为专用闭包注入，未伪称本机操作系统出现该故障。macOS/Linux 的运行结果由实际 CI/测试另记。

最小命令：`cargo test -p rovai-web auth::tests::`、
`cargo test -p rovai-core --lib platform::private_storage::tests::`、
`cargo build -p rovai-host` 后 `node --test --test-name-pattern='Desktop and Web share one Core' scripts/lib/host-web.test.mjs`、
`pnpm test:desktop-bridge` 与 `pnpm exec vitest run apps/web/src/client.test.ts`。

## Send 正文文件输入

按 User 消息 19 确认的 [r5](model-context-change-send-input-file.md)实施：Send 文件按现有 Schema
识别完整请求，否则保留 UTF-8 原文作为正文；只有正文文件可与发送参数组合。同步精简 Bootstrap、
Send help、根 help 和 cli-operations。正文文件目录不受新增限制，Skill interface 元数据保持原样。

Worktree：`rovai-ai-send-input-file`；分支：`rovai/send-input-file`；基线方案提交：`33f180460`，
产品源码基线：`70c9214bf47a677d018a7f2448583d6ec3422d22`（已 fetch 确认仍为 origin/main）。
状态：代码与确定性验证完成，保留 worktree 供评审；未合入或安装日常 App。

### 测试准入

新增两个 CLI 单元 owner：`send_file_input_preserves_text_and_complete_schema_requests` 拥有新文件分流、
原文保留、完整字段与参数冲突；`send_file_reader_accepts_only_regular_utf8_text_and_removes_one_bom`
拥有普通文件、编码和 BOM 准入。修复前原始正文文件不能发送，非法类型可能被普通 serde struct 接受；
现有 help owner 只有一个合法 JSON 文件案例，无法保护这些新边界。最低层临时文件夹具即可验证，
无需 SQLite 或真实 Runtime。更新教学、版本与 Charter owner。旧空正文 owner 扩展并改名为
`public_send_rejects_empty_and_oversized_bodies_without_publishing`，保留原空白拒绝并加入 ASCII/中文/emoji
超限与数据库消息数量不变；没有删除或永久禁用可执行测试。新增 CLI 进程边界 owner
`scripts/lib/send-file-input.test.mjs` 复用生产 CLI 和本地 IPC 夹具，验证 stdin/FIFO/零 IPC，
不能被纯 parser 代替；不把它误报为真实模型或 Core 发布验证。

最小命令：`cargo test -p rovai-core --bin rovai send_file_` 和 `pnpm test:send-input-file`。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| `cargo test --workspace` | 465 通过，1 个既有 ignored；含 31 项 CLI 测试及新增两个 owner |
| 最后修改后 `cargo test -p rovai-core --bin rovai` | 31 通过 |
| `cargo test -p rovai-core --features extended-tests --lib context::tests::` | 9 通过 |
| `cargo check --workspace` / `cargo fmt --all --check` / `git diff --check` | 全部通过 |
| `--features slow-tests --lib` 的 8 个定向 owner | Charter 全文、冻结 Bootstrap、补发冻结、正文空白/字节超限零发布、publicOnly 寻址、原子发布/重放、User 通知、纯附件；全部通过 |
| `pnpm test:send-input-file` | 独立 CLI 进程及本地 IPC 验证通过；有外层 5 秒退出上限，未启动 App、Core 或真实 Runtime |
| Full check 接入 | `full` scope 的 `Rust full` job 显式执行 `pnpm test:send-input-file` 一次；本地命令及 YAML/前置工具顺序检查通过，尚未执行远端完整 workflow |
| 真实 Core / 原生 Codex 专项 | 基线旧 JSON → 候选恢复旧 JSON 并读新帮助 → 正文文件；3 次 Run、3 条消息，逐字读回、原 Native Binding 与冻结 Bootstrap 保留，使用脚本 Provider，详见[证据](../../research/send-input-file/README.md) |
| `pnpm skills:check` / `pnpm skills:test` | 12 个 Skill 校验、3 项治理测试通过 |
| `pnpm docs:test` / `pnpm docs:check` / 带真实 base 的 `pnpm docs:check:ci` | 10 项治理测试、版本与决定/链接门禁通过 |
| 完整教学对照 | 五组前后文本和九个基线源码摘要核对；新二进制 Send/root help 与 r5 全文逐字一致，其余 29 个命令 help 与当前 v36 CLI 逐字一致；Send reference、Schema、索引描述与 interface 元数据未改 |

慢速 Charter owner 首次运行发现一条旧断言仍要求 Bootstrap 出现 `--input-file`，已按确认文本修正并重跑通过。
IPC 夹具初次错误读取了请求的 `requestId` 而非既有 wire `request_id`，修正夹具后通过；生产 wire 未修改。

真实模型 12 Case Gate 缺少本次可用的冻结 team/模型和真实 Judge 配置，尚未执行。旧 Session
恢复、读取新帮助再发送已补原生 Codex + 真实 Core 的脚本驱动验收；不能据此宣称真实模型会自行
选择正确用法，或不会重复发送、循环查询帮助。真实模型连续发送、已学习新帮助后的旧版回滚、
其他 Runtime 与 Windows 真机专项仍未运行。默认 Node/Rust 回归和自动 PR gate 不包含 CLI 进程测试，
它由手动 Full check 稳定调用，不把其他入口通过当作该项通过。
旧 `smoke:builtin-cli` 仍有与本次无关的 Gather/Principal 过时断言；本次只同步相关输入教学断言，
检查脚本语法，不宣称该历史 Smoke 整体通过。

## 2026-10-10 Kimi 官方 Provider 配置

删除正式 ACP Host 与 Probe 的私有 env 注入、加载器和 `kimiProviderEnvironmentDigest`，
原生 Home、ACP 选模、权限、MCP 与 Session 恢复保持。指标验收脚本改用显式官方配置来源的隔离 Home。
没有数据迁移或模型上下文变更；旧文件不自动删除，官方配置不被 Rovai 改写。

测试退役：`kimi_provider_configuration_is_allowlisted_and_process_local`、
`kimi_provider_configuration_rejects_unknown_keys`、`kimi_provider_configuration_rejects_group_readable_secrets`
随唯一生产解析器和私有配置合同退出。未新增独立 Rust 测试；扩展既有
`acp_probes_keep_native_homes_without_prompting` 与 `kimi_stopped_host_inherits_native_home_and_exactly_resumes`，
分别验证默认/自定义原生 Home、旧文件两种入口被忽略、无变量注入、配置原样保留以及精确冷恢复。
这些 owner 需要隔离子进程证明环境继承，使用假凭据且不调用模型；修复前旧文件会触发拒绝或注入错误 Provider。
`warm_compatibility_matches_process_inputs_across_acp_adapters` 保留 MCP、Host 配置与 Session mode 边界。

验证：`pnpm test:rust:pr` 通过（463 passed、1 ignored）；`pnpm typecheck`、`pnpm test`
（239 个 Vitest 文件、2616 tests）、`pnpm docs:check:ci`、`cargo fmt --all --check` 与脚本语法检查通过。
Kimi、原生 Home Probe 与 Host compatibility 定向扩展 owner 通过；冷恢复 owner 移到
`acp/tests/native_home.rs`，在测试子进程中隔离环境，不放宽生产源码检查。
本机真实 Kimi 2.1.1 在隔离 Home 中读取官方 TOML 并完成新建、停止后精确恢复；配置保持不变，
未发送 Prompt 或使用真实凭据，结果不外推为模型生成验收。

扩展层的两个既有失败已在未修改的 `main`（`0baa26ebb018298156241d7cf0c86ad94fad4d77`）独立复现：

- `authority_migration::tests::macos_provenance_added_after_ticket_is_readmitted_without_losing_business_data`：
  `authority_contract_changed`，与 Kimi 修改无关。
- `channel::tests::pending_picker_upgrade_keeps_history_rolls_back_failure_and_reuses_the_old_card`：
  fixture 缺少 `last_delivery_sequence` 列，与 Kimi 修改无关。

`pnpm test:rust:extended` 执行中发现上述失败，完成主干对照后停止其余无关模块的扩展探索。
本次受影响的 Kimi、原生 Home 与 Host compatibility owner 均完成验证；完整扩展套件未跑完，
不报告全套通过。未修改或跳过两个失败 owner，也未放宽仓库门禁。

## 2026-10-10 受管原生自动记忆

按 User 最终确认，仅调整 Claude/Codex 启动配置：保留 Claude settings 文件运输、Fast 三态与 Bootstrap，
在私有 settings 和最终子进程环境中关闭自动记忆；Codex App-Server 无条件携带三个关闭参数。
Host 固定策略修订与 Native Binding 兼容性分离，正常替换后继续原 ID Resume。
不改 Windows shim、数据库、配置管理或其他 Adapter；既有 Runtime failure 不静默降级。

复用现有命令、文件生命周期、Thread、Fleet 与失败测试 owner，未新增 Rust 测试函数；Windows Full check
补入已有 Claude 扩展测试。隔离对照和实际 Core 执行证据、基线失败、平台边界见
[原生自动记忆验收](../../research/native-auto-memory/verification-2026-10-10.md)。
这是固定启动策略的局部实现，未新增通用策略体系或改写历史决策。

## 2026-10-10 Pi 目录观察与思考强度

按 User 修订实现三个边界：Pi 目录准入、调度、提交、读取独立于健康；目标 Session 激活后避免同模型重复选模；
目录只作有效观察且不破坏 Pi 已选模型/强度。复用原表与 metadata，无 schema 迁移、新缓存或 Provider 管理系统。
单一 Core 解析器输出 thinking_level，现有控件、配置摘要和 Run 历史消费；显式值由目标任务 Host 严格回读。

当前规范：[Runtime Launch v55](../../contracts/runtime-launch-and-verification-v55.md)、
[Runtime Catalog](../../architecture/runtime-catalog-boundaries.md#pi-coding-agent-当前边界)、
[队员配置](../../ui/components/member-identity.md)。这是局部实现修正，未新增需要长期取舍治理的 Version Decision。

验收、两个新增 Rust owner 的准入理由、Pi 0.84.4 原生无生成对照、复现脚本和明确未测边界见
[Pi 思考强度验收](../../research/pi-thinking-level-2026-10-10/README.md)。默认 workspace 与定向 Rust、前端、Electron 交互、
typecheck 与桌面构建通过；扩展筛选中的两项既有失败已在独立基线构建复现，保留原样，不报告全套通过。

## 实施切片

切片按可回滚的小步排列，每一步单独可合并、单独通过全量测试。

1. **S1 Core 参数化重构，行为不变。** 引入 `ChannelProviderSpec`，把飞书领域函数中的 `feishu_*` 表名与 provider
   常量改为由 Spec 提供；飞书 Host actor 与请求名映射集中到一处。不新增 provider、不改 Schema；飞书与钉钉全部既有
   测试不改断言即通过。负责人：川行。
2. **S2 Core 接入 Lark。** 新迁移建立 5 张 `lark_*` 表并重建 3 张中立表与 2 个目录视图；注册 `lark-channel-host`、
   8 个命令类型与 20 个 `channels.lark.*` 请求；provider 白名单、`AutomationNotifyChannel` 与 Feishu v17 的品牌收窄。
   负责人：川行。依赖 S1。
3. **S3 Main 第二实例。** 抽出 Provider Profile，覆盖登录配置、可信域、SDK 域、Core 方法名、失败码与文案；
   `index.ts` 创建 Lark 实例；协调器三路；credential store 与 Host 渠道请求接受 `lark`；飞书与 Lark 全部 SDK 构造点
   显式传入域；Feishu v17 遗留 `brand=lark` 处理。负责人：川行。依赖 S2。
4. **S4 Contracts、Renderer 与 Web。** `ChannelKind`、`AutomationNotifyChannel` 与 rovai-web 枚举增加 `lark`；
   Renderer 的标志与文案改为按 Provider 查表，新增 Lark 标志、未验收提示和自动化通知选项。负责人：屏知。类型改动可与
   S1 并行，联调依赖 S3。
5. **S5 自动化验收。** 维护本版验收矩阵，审阅 S1 到 S4 的负向测试是否覆盖隔离与拒绝路径，补齐 Main 与 Renderer
   测试缺口，并为真实租户验收准备逐项记录模板。负责人：验真。
6. **S6 真实租户验收。** 按 Lark Channel v1 第 8 节逐项执行并记录 qualification；未完成项保持未验证。依赖可用的
   Lark 租户。负责人：验真。

## 验收矩阵

| 验收项 | 证据 | 状态 |
| --- | --- | --- |
| S1 重构后飞书与钉钉行为不变 | `cargo test --workspace` 全绿且无既有断言修改 | 默认层通过；见下方记录 |
| `feishu_*` 与 `lark_*` 结构只在 brand 列与索引名不同 | 迁移结构等价测试 | 通过；见 S2+S3 记录 |
| 飞书与 Lark 各自单 connected 账号且互不影响 | Core 隔离测试 | 通过；见 S2+S3 记录 |
| 飞书 Host 写 Lark 行、Lark Host 写飞书行均被拒绝；账号、Bot、中立业务表、凭据与非 `command.result` 领域事件零变化，只提交唯一的 rejected 命令回执，幂等重放不新增事件 | Core 双向负向测试 | 通过（C1、C2、C3 复验） |
| `brand=lark` 的飞书账号命令被拒绝且无写入；历史行保持原位、可读且不复制到 Lark 表 | Core 兼容与迁移负向测试 | 通过；补强项 C4 |
| 8 个 actor 绑定请求以 `lark-channel-host` 执行；`channels.lark.account.disconnect` 以本地 Owner 执行 | Core 请求路由测试 | 通过（函数级路由表与 Owner-only 处理器断言） |
| 未列出的 `channels.lark.*` 请求被拒绝，payload 不能覆盖请求名推导的 actor | Core 请求准入负向测试 | 通过（函数级） |
| 三张中立表接受 `lark` 并保留旧行 | 迁移测试 | 通过 |
| 两个目录视图返回 Lark 分支，且飞书与钉钉既有目录行不变 | 迁移与目录视图测试 | 通过 |
| Lark 绑定 Camp 的 Charter 不含飞书文件交付提示 | Context 测试 | 通过 |
| 飞书在请求、身份归一化和 Session 恢复三层拒绝 Lark 主机；Lark 对飞书主机做对称拒绝；`open.larkoffice.com` 仍属于飞书 | Main 可信域参数化负向测试 | 通过 |
| Lark 登录配置与 `channels.lark.*` 方法名只注入 Lark 实例，飞书实例保持原值 | Main Provider Profile 隔离测试 | 通过 |
| 所有 SDK 构造点显式传入对应域，省略 domain 的构造在测试中失败 | Main 构造断言与缺省值负向测试 | 通过 |
| 遗留 `brand=lark` 飞书账号被过期、显示 `feishu_brand_moved_to_lark`，其已发布 Bot 不启动 | Main 恢复负向测试 | 通过 |
| 三个渠道服务实例并存；飞书或 Lark 任一启动失败不阻止另两者，全部失败才拒绝启动 | 协调器参数化失败测试 | 通过 |
| Snapshot 顺序固定为飞书、Lark、钉钉；Lark 重连错误映射不污染飞书与钉钉 | Main 聚合与错误映射测试 | 通过 |
| 三个 Provider 页签、Lark 标志和未验收提示存在，切换 Provider 不复用对方账号与错误状态 | Renderer 状态隔离测试 | 通过（静态渲染与纯函数级）；见 S4 记录 |
| `kind: \"lark\"` 的发布与重试只调用 Lark；Desktop IPC 的连接、断开、发布与重试入口接受 `lark`（2026-09-24 Principal 冒烟发现入口曾报 `Invalid channel kind`，已修正并补 `channel-kind-input.test.ts`）；Web 接受 Lark 且 `selectApprover` 仍拒绝非钉钉 | Renderer、Preload 与 Web 准入测试 | 通过（出口透传与 Web 准入）；见 S4 记录 |
| Rust、TypeScript 与文档门禁 | `cargo test --workspace`、`pnpm typecheck`、`pnpm test`、`pnpm docs:check` | 通过（提交 `049e202e`，上游 `44c461f3`）；扩展层与上游对照无新增失败，见第二次改号记录 |
| Lark 真实租户逐项验收 | [真实租户验收记录](lark-tenant-qualification.md) | 进行中：扫码连接与基础对话经 Principal 手工跑通，逐项证据不足 |

## 增量验收记录

### 2026-09-24：S1 Core 参数化重构

S1 按本计划声明的默认 workspace 门槛通过，允许进入 S2；扩展层保留一项非阻断基线失败。本次准入例外只适用于
S1，不自动延伸到 S2 或 S3 的最终验收。

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| 变更范围 | 通过 | 生产改动仅在 `crates/rovai-core/src/channel.rs` 与 `crates/rovai-core/src/application.rs`；`context.rs` 与 migrations 无 diff |
| 既有测试不改断言 | 通过 | 两个改动文件的既有 `tests` 模块与 `HEAD` 从 `mod tests` 起逐字比较无差异；S1 未新增测试 |
| 默认 workspace | 通过 | 临时 Rust 1.90.0 下 `cargo test --workspace` 为 412 passed、1 ignored；`cargo check --workspace --all-targets` 通过且无警告 |
| 扩展层渠道 owner | 基线失败 | `cargo test -p rovai-core --features extended-tests --lib channel::tests::` 为 30 passed、1 failed |
| Diff 完整性 | 通过 | `git diff --check` 通过；未修改 Schema，也未接入 Lark provider |

扩展层失败用例为
`pending_picker_upgrade_keeps_history_rolls_back_failure_and_reuses_the_old_card`。该失败已在独立、未修改的 `HEAD`
副本复现：旧 Migration fixture 重开迁移后遇到新增 Camp 列，历史快照列数不等。它不能表述为通过，也不能被默认层结果
覆盖；由于 S1 未修改该测试、Migration 或其断言，本次裁定为非 S1 回归，不阻断 S2。

S2 修改 Migration 后必须重新运行该用例，并验证旧行保留、失败回滚和旧卡复用。任何新增失败或相对上述基线的行为退化
均阻断 S2 验收。

另有一项待核实的环境差异：根 `Cargo.toml` 声明 `rust-version = "1.85"`，
`docs/development/environment.md` 仍写尚未声明；本机 Rust 1.88.0 无法编译既有 `rovai-host` 文件锁 API，而临时
Rust 1.90.0 可完成上述门禁。本记录不据此修改最低 Rust 版本、环境文档或 S1 结论；MSRV 与文件锁 API 兼容性需另行
核验。

### 2026-09-24：S2 Core 接入与 S3 Main 第二实例

结论：通过（C1–C4 于同日复核关闭，见本节末）。首轮为有条件通过：跨 provider 错误 Host 的拒绝路径只覆盖了
`account.upsert` 一个处理器。扩展层 `db::tests::` 3 条与 `application::tests::` 4 条既有基线失败不属于本切片，仍不得表述为全绿。

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| 定点 Rust 用例复跑 | 通过 | `--features slow-tests` 下迁移结构等价、账号隔离、actor 路由、Charter、S1 基线 picker 共 5 条均通过 |
| Main 定点用例复跑 | 通过 | 渠道设置、协调器、Host 渠道、凭据、可信域、开发者会话、Bot 发布、开放平台 API、身份 9 个文件 229 条通过 |
| 隔离测试的有效性 | 部分 | 在隔离副本把 `account.upsert` 的 provider 网关放宽为任意 Host，测试失败，说明断言有效 |
| 其余专属处理器 | 缺口 C1 | 同时放宽 `commitConnection`、`disconnect`、`expire`、`memberBot.upsert`、`publicationIntent.create/advance` 等 6 处网关，`channel::` 与 `application::` 全部渠道用例仍通过 |
| 中立表处理器 | 缺口 C2 | 同时放宽开发者会话、凭据删除、DM 轮换、名册、入站、投递、待绑定、执行控制台等 12 处按 provider 的网关，只有 1 条既有钉钉用例失败 |
| 扩展层 `application::` | 基线失败 | 4 条失败在 `git archive HEAD` 副本以相同位置复现，非本次回归，但此前回报未列出：`navigation_invalidation_covers_projection_writes_but_not_reads`、`v2_dispatch_admission_ignores_broken_legacy_view_and_managed_payload`、`execution_page_does_not_inherit_an_unrelated_non_database_wait`、`mission_git_reads_release_ingress_database_and_lifecycle_authority` |

待补测试与待裁定项：

- **C1（川行）** 表驱动覆盖其余 Lark 专属处理器：飞书 Host 调 Lark 服务、Lark Host 调飞书服务均得到拒绝码；
  账号、Bot、中立表、凭据与非 `command.result` 事件零变化；每条命令只有一个 rejected 回执，重放不新增。
- **C2（川行）** 中立表处理器的双向错误 Host：Lark Host 操作飞书行、飞书 Host 操作 Lark 行均被拒绝且零副作用，
  至少覆盖入站观察与完成、投递结算、名册对账、待绑定解决、DM 轮换、执行控制台三项、开发者会话替换与删除、凭据删除。
- **C3（砚舟已裁定）** `channels.lark.account.disconnect` 以本地 Owner 的用户信封执行，与飞书、钉钉同名请求一致；
  Lark Channel v1 第 2 节与 Lark 渠道架构已改为此表述。依据：飞书 v1/v2 与钉钉 v1/v2 均规定断开账号由本机 Owner
  发起，Core 中两家的 disconnect 都走用户信封；Host 能断开账号会扩大 Host 权限。未采用“保留 Host 执行”：它与继承的
  命令语义和钉钉先例冲突，代价是 `channel_request_host_component` 不再覆盖全部 `channels.lark.*`。川行改正路由与网关，
  拒绝消息去掉“Feishu”；补断言：两个 Host actor 调用均得到 `lark_account.owner_required` 且零副作用，Owner 以飞书
  账号 ID 调用得到 `lark_account.not_connected`，飞书账号与 `provider = 'feishu'` 的 Developer Session 不变。
- **C4（川行，补强）** `brand=lark` 越界命令在返回错误后补断言非 `command.result` 事件数不变；遗留行改写后补断言
  `lark_account` 行集不变，证明没有隐式复制。

C1、C2、C4 复验（2026-09-24）：通过。新测试
`channel::tests::wrong_provider_hosts_are_rejected_by_every_lark_capable_handler` 为飞书与 Lark 各建一套真实数据，
用对方 Host 双向调用全部专属与中立处理器；每条断言拒绝码、重放一致、唯一 rejected 回执、非 `command.result`
事件不变，以及除 `event_log`、`event_sequence` 外全库逐表行集不变。复跑扩展层 `channel::tests::` 为 33 passed。
在隔离副本中逐一把 22 处非钉钉 provider 网关放宽为任意 Host：新测试单独杀死 21 处；`account.upsert` 一处由既有
隔离测试杀死。变异所用快照恰逢 C3 改动进行中，既有隔离测试在该快照上本身失败，因此上述判定以新测试在未变异快照
上通过为基线；C3 交付后需在最终代码上重跑扩展层 `channel::tests::`、`application::tests::` 的 Lark 路由用例与
默认 workspace、`pnpm` 门禁，因为 C3 改动生产代码。

C3 与最终复核（2026-09-24）：通过。`channels.lark.account.disconnect` 已移出 Host 路由表并改走用户信封，
`disconnect_feishu_account` 对两家都只认本地 Owner，拒绝文案不再含 “Feishu”。
`lark_disconnect_is_owner_only_and_provider_scoped` 覆盖裁定的 (a)–(c)，路由测试覆盖 (d)。在隔离副本中把
disconnect 网关放宽为 Owner 或任意 Host，(a) 失败；把删除 Developer Session 的条件改为匹配全部 provider，(c) 失败。
最终代码（复核期间 `channel.rs`、`application.rs` 哈希未变）上：临时 Rust 1.90.0 `cargo test --workspace` 为
412 passed、1 ignored、0 failed，无警告；扩展层 `channel::tests::` 与 `application::tests::` 为 90 passed、
4 failed，失败项即上表登记的 `application::` 基线；`pnpm typecheck` 通过；`pnpm test` 通过（vitest 213 个文件、
2241 条）；`git diff --check` 通过。路由与 actor 准入测试仍为函数级，未经 IPC 分发端到端调用。

### 2026-09-24：S4 Contracts、Renderer 与 Web

结论：通过，带交互层限制。

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| Web 准入 | 通过 | `rovai-web` 11 passed：三家 publish/retry 接受且 kind 往返；`selectApprover` 只接受钉钉；`Lark`、`LARK`、`telegram`、空串、null、数字被拒 |
| 页签与提示 | 通过 | 静态渲染断言页签顺序为飞书、Lark、钉钉，Lark 标志与未验收提示只出现在 Lark 页 |
| 账号与错误隔离 | 通过 | 飞书与 Lark 同时连接时各页只显示本家租户、Bot 与管理链接；`channelActionErrorFor` 只把操作错误交给同一 provider；本次修正了此前整页共用操作错误的串状态缺陷 |
| 发布与重试只调用 Lark | 通过（出口级） | Desktop 适配器与 Web 客户端测试断言 `kind: "lark"` 原样透传，且不调用审批人选择；组件内 `provider.kind`、`publishKind` 的使用经代码审查确认 |
| Provisioning 归属 | 通过（审查） | 协调器为每个 provisioning 标注 kind，Renderer 的 `kind ?? 'feishu'` 兜底不会把 Lark 进度显示到飞书页 |
| 门禁 | 通过 | Rust 1.90.0 下 `cargo test --workspace` 共 415 passed、1 ignored，扩展层 `channel::tests::` 33 passed；`cargo fmt --all --check`、`pnpm typecheck`、`pnpm test`（vitest 216 个文件、2267 条）、`pnpm docs:check`、`git diff --check` 通过 |

限制：仓库没有 DOM 测试环境，点击切换页签与点击发布、重试没有交互级测试；组件把错误传给页签和对话框的两处调用
（`ChannelSettings.tsx` 中 `channelActionErrorFor(error, selectedKind)` 与 `channelActionErrorFor(error, publishKind)`）
若被改回直接传全局错误，现有静态渲染测试不会失败。按 provider 隔离操作错误是新增界面行为，
`docs/ui/components/channel-settings.md` 尚未记录。Lark 文案在拉丁词与汉字之间没有空格（如“Lark连接”“Lark管理”），
与 Main 出口改写的加空格规则不一致，属于文案一致性问题，不阻断。

### 2026-09-24：Principal 开发实例冒烟

Principal 在隔离 userData 的开发实例中用真实 Lark 账号试 Q1，暴露两处 Main 缺陷，自动化测试均未覆盖。两处都已修正，
但真实租户的 Q1 结论仍由[真实租户验收记录](lark-tenant-qualification.md)判定。

| 发现 | 根因 | 修正与证据 |
| --- | --- | --- |
| 点击 Lark“登录开放平台”报 `Invalid channel kind` | Desktop IPC 的 kind 校验只放行飞书与钉钉；Main 测试直接调用协调器，Renderer 测试模拟 IPC，中间层无人覆盖 | 改为按 `ChannelKind` 穷举的放行表，遗漏新 provider 时 typecheck 失败；准入测试由川行补齐 |
| 扫码与身份读取成功后，停在“暂时无法确认连接是否保存完成”，核对保存结果无效 | Main 以固定 `feishu-user` 计算 `userIdDigest`，Core 按 `<provider>-user` 校验，Lark 提交在进入命令网关前即报错，Main 将其当作结果未知反复重放 | Main 按 Profile 的 provider 计算摘要；新增飞书与 Lark 参数化测试，恢复旧实现时 Lark 用例失败 |

同一次尝试中，`accounts.larksuite.com` 的二维码初始化、轮询、扫码确认，以及 `open.larksuite.com/app` 的交接均返回
HTTP 200，并进入身份读取阶段。这是沿用飞书 Passport 取值可在 Lark 站点完成登录前半段的首个真实证据，完整结论待
重新扫码并完成本地提交后判定。

遗留观察：Core 对非法 payload 直接返回错误而不写 rejected 回执，Main 无法区分确定性校验失败与传输失败，只能提示
核对保存结果。这是飞书既有行为，本次不改，另行评估。

### 2026-09-24：合入上游并改号为 v1.70

以上 S1 到 S4 与冒烟记录，都是在基线 `ec290dc6` 上、以 v1.67 与 Migration 171 的编号取得的证据。上游随后发布了
v1.67（Task 去版本化）、v1.68 与 v1.69，占用了 Migration 171、172 与数据合同 v1.68 / schema 122。本版因此把本地
快照提交摘到上游 `4c726560` 之上，并整体改号：

| 项 | 原编号 | 改号后 |
| --- | --- | --- |
| 版本文档 | `docs/versions/v1.67`、V1.67-D01 | `docs/versions/v1.70`、V1.70-D01 |
| Lark 迁移 | Migration 171 | Migration 173，接在上游 171、172 之后 |
| 数据合同 | v1.67 / schema 121 | v1.70 / schema 123 |
| 合同引用 | ContextManifest Evidence v27 | ContextManifest Evidence v29 |

文本冲突只出现在 `db.rs` 的迁移链和合同版本、三个文档索引，以及 v1.67 版本目录的同名文件；上游的 v1.67 版本文档
原样保留。`application.rs`、`context.rs`、contracts、Web 与样式虽然自动合并，但语义要在新基线上重新编译和测试确认。
改号后的门禁结果补记在本节，补记前矩阵中的门禁行不视为通过。

改号后门禁（验真，2026-09-24，提交 `c29338fb`，上游 main `7ec57722`，Rust 1.90.0）：首轮**阻断**，修正本版测试 fixture 后除上游自带失败外均通过。

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| `cargo fmt --all --check` | 通过 | 无差异 |
| `cargo test --workspace` | 失败（上游自带） | `--no-fail-fast` 下 413 passed、1 failed、1 ignored。失败项 `runtime_platform_admission::tests::platform_evidence_revisions_bind_their_frozen_source_bytes`：上游 #525 修改了 `docs/runtime-compatibility.md`，没有同步 `MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION`；本提交未改该文件，`git archive 7ec57722` 未改副本同样失败 |
| `pnpm typecheck` | 通过 | 无错误 |
| `pnpm test` | 失败（本版） | vitest 217 个文件中 1 个失败，2272 passed、1 failed：本版新增用例 `apps/web/src/client.test.ts` 的 “sends the Lark provider kind unchanged for publish and retry” 在登录 fixture 中写死 `protocolVersion: 3`，上游已把 `HOST_WEB_PROTOCOL_VERSION` 升到 4，会话被拒绝 |
| `pnpm skills:test`、`pnpm skills:check` | 通过 | 12 个 Skill |
| 扩展层 `db::`、`application::`、`channel::` | 与上游一致 | 本提交 151 passed、43 failed；上游未改副本 147 passed、43 failed；两边失败名单逐条相同（db 39、application 3、channel 1），无新增失败 |
| Lark 定点用例 | 通过 | 迁移结构等价、两条渠道隔离、actor 路由、Charter，以及上游 `v171_removes_task_versions…`、`v172_preserves_historical_context…` |
| 审查：v172 测试断言 | 通过 | 由 `Current` 改为 `SupportedMigrationSource` 且精确为 v1.68 / 122，与上游 v171 测试迁移后断言 `SupportedMigrationSource(_)` 的先例一致且更严；旧写入拒绝与重开后历史字节不变的断言保持不变 |
| 审查：丢弃旧迁移测试链尾调用 | 通过 | 失败名单与上游逐条相同，没有一条因丢弃而新增失败 |

修正与复跑：本版测试 fixture 的 `protocolVersion` 由 3 改为 4，与上游 `HOST_WEB_PROTOCOL_VERSION` 一致，未改生产代码。
修正后砚舟在同一基线复跑 `pnpm test`，退出码 0，vitest 217 个文件、2273 条全部通过。Rust 的那条失败属于上游 main：
冻结证据哈希应由上游更新，本版不修改 `docs/runtime-compatibility.md` 或对应常量，并在 PR 中写明 CI 的 Rust 检查会因此失败。

### 2026-09-25：第二次改号为 v1.71

Draft PR #530 打开后，上游合入 #517（Skills Rebuild），占用了 v1.70、Migration 173 与数据合同 v1.69 / schema 123，
ContextManifest Evidence 也升到 v30。按 Issue #523 “版本号顺位继承”的约定，本版 rebase 到上游 `96aa85e9` 并再次改号。
上一节的门禁证据属于 v1.70 编号时的提交，不能沿用。

| 项 | 第一次改号 | 第二次改号 |
| --- | --- | --- |
| 版本文档 | `docs/versions/v1.70`、V1.70-D01 | `docs/versions/v1.71`、V1.71-D01 |
| Lark 迁移 | Migration 173 | Migration 174，接在上游 173 之后 |
| 数据合同 | v1.70 / schema 123 | v1.71 / schema 124 |
| 合同引用 | ContextManifest Evidence v29 | ContextManifest Evidence v30 |

上游 v1.70 的版本文档原样保留，只把其概览与版本决定的生命周期改为 historical，并补上后续链接；这是“唯一 current 版本”规则
要求的，不改变上游的实施状态。改号后的门禁结果补记在本节，补记前矩阵中的门禁行不视为通过。

改号后门禁（验真，2026-09-25，提交 `049e202e`，上游 main `44c461f3`，Rust 1.90.0）：**通过**。

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| `cargo fmt --all --check` | 通过 | 无差异 |
| `pnpm test:rust:pr` | 通过 | 422 passed、1 ignored、0 failed |
| `pnpm typecheck` | 通过 | 无错误 |
| `pnpm test` | 通过 | vitest 217 个文件、2279 条；node 测试 326 passed |
| `pnpm skills:test`、`pnpm skills:check` | 通过 | 12 个 Skill |
| 扩展层 `db::`、`application::`、`channel::` | 与上游对照无新增失败 | 本提交 43 条失败（db 39、application 3、channel 1），是 `git archive 44c461f3` 未改副本 44 条失败的真子集；少掉的一条是下文审查 (a) 的 preflight 用例 |
| Lark 与迁移定点用例 | 通过 | 迁移结构等价、两条渠道隔离、actor 路由、Charter，以及上游 v171、v172、v173 迁移测试 |
| 审查 (a)：preflight 用例改号 | 通过 | 该用例断言全新建库的迁移状态等于当前全链，并拒绝未来版本 store；上游仍断言 `migration_state_through(172)`，#517 加 v173 时漏改。改为 174 只随 current 前进，拒绝未来 store 的断言未改 |
| 审查 (b)：产品合同期望值 | 通过 | `collectProductContractFingerprint()` 用正则从源码常量读取（如 `PUBLIC_CAMP_BATCH_CONTEXT_MANIFEST_VERSION`），不读测试期望；在本提交上实测为 v1.71 / 124、ContextManifest 30、Formatter 30、DeliveryProfile 10，其余不变。上游测试仍期望 v1.67 与 28，而上游常量已是 v1.69 与 30，故上游本身失败 |
| 语义抽查 | 通过 | `FEISHU_FILE_DELIVERY_GUIDANCE` 只在 `conversation.provider = 'feishu'` 的绑定下注入；新增冻结工具箱 section 后，Charter 测试中 Lark 负向分支仍通过 |

## Rust 测试准入

S1 不新增测试，以既有飞书与钉钉测试不改断言全绿作为行为不变的证据。S2 新增的测试只覆盖新边界：结构等价、跨
provider 隔离、错误 provider 拒绝、actor 路由、中立表重建与 Charter 负向断言；它们无法由既有断言表达。新测试扩展
`channel.rs` 与 `db.rs` 已有的渠道和迁移测试 owner，不建立平行 fixture。


## 2026-09-27 合并主线与审查修复

对齐主线 `762370b1`（包括 #548 钉钉入站附件）：保留 public history claim Migration 174，Lark 建表顺延为 Migration 175，数据合同为
v1.71 / schema 125；ContextManifest/Formatter 沿用主线 31。降级 fixture 按相反顺序还原，旧迁移与结构检查继续保留。
主线的持久入站下载保持飞书、钉钉范围，Lark 不进入尚无消费者的下载队列。

- 话题派发：补齐 Lark roster 身份、按 provider 隔离的 Host 刷新请求、发布状态和成员存在性校验。
- 标题：共享 `CampChannelSource`/formatter 增加 Lark 三种来源；搜索可匹配前缀，重命名不写入前缀。
- 新增测试 owner：`message_delivery::tests::topic_dispatch_waits_for_its_provider_roster_and_checks_its_published_bot`。
  它以最小 SQLite fixture 验证持久等待到放行的状态转换和跨 provider 冲突；现有 channel membership 测试只验证
  Camp roster 同步，不能证明派发等待门禁。修复前 Lark 首次派发直接放行，且 Bot 查询错误依赖飞书表。
  最小命令：`cargo test -p rovai-core --lib topic_dispatch_waits_for_its_provider_roster_and_checks_its_published_bot`。
- 标题与导航搜索扩展现有表驱动/搜索测试；迁移测试保留原有回滚、数据保留和结构等价断言，更新实际来源为 174。

本轮验证代码为 `c80c48a8`（含主线 `762370b1`），结果如下；真实租户未验收项保持原状态。

| 验证 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm exec vitest run --maxWorkers=2` | 219 个文件、2311 项通过；高并发两轮分别出现 2、3 项超时，定点复跑及降低并发后的全量均通过，未修改超时阈值或禁用用例 |
| `pnpm build:desktop` | Web、Main、Preload、Renderer 构建通过 |
| `cargo test --workspace -- --test-threads=4` | 434 项通过、1 项既有忽略，无失败 |
| `cargo test -p rovai-core --features extended-tests --lib -- channel::tests:: db::tests::lark_migration db::tests::v171_ db::tests::v172_ db::tests::v173_ db::tests::current_migration_state_admission_matrix db::tests::database_contract_preflight` | 41 项通过，包含飞书、钉钉、Lark 渠道回归、迁移 171–175 衔接、结构等价、回滚和历史数据保留 |
| `cargo test -p rovai-core --features extended-tests --lib lark_actor_routes_are_closed_and_payload_cannot_supply_authority` | 1 项通过 |
| `cargo fmt --all --check` | 通过 |
| `node --test scripts/benchmark/protocol/product-contract.test.mjs scripts/lib/channel-camp-naming.test.mjs` | 2 项通过；命名验收使用独立临时 userData 和 Skill Library |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=762370b1a741c4942aed9a130941acbbf72b4990 pnpm docs:check:ci` | 10 项文档测试及全部通用门禁通过 |
| Standards / Spec 独立复核 | 两条检查线均通过；同步 #548 后补查未发现新增问题 |

本轮没有运行真实 Lark 租户操作，也未把既有能力 Gate 改为已验证。


## 2026-09-27 同步通知模型主线

上一轮验证及 CI 通过后，主线合入 #549（`3b49137b`），通知模型占用 v1.71、Migration 175、schema 125。
保留该版本的完整文档与生产迁移，Lark 文档顺延到 v1.72，建表迁移为 Migration 176，数据合同为 v1.72 / schema 126。
更新迁移来源准入、反向 fixture、产品合同指纹及当前文档路由；新建库和升级先完成 175，再执行 Lark 176。
原有逐项验收记录保留当时版本号和基线，不改写为新的验证证据。

本轮以主线 `3b49137b` 为基线，对完成冲突处理的代码重新验证：

| 验证 | 结果 |
| --- | --- |
| `cargo test --workspace -- --test-threads=4` | 435 项通过、1 项既有忽略，无失败 |
| `cargo test -p rovai-core --features extended-tests --lib -- channel::tests:: db::notification_model::tests:: db::tests::lark_migration db::tests::v171_ db::tests::v172_ db::tests::v173_ db::tests::current_migration_state_admission_matrix db::tests::database_contract_preflight application::tests::lark_actor_routes` | 43 项通过；覆盖通知 175→Lark 176、结构等价、回滚、历史数据保留、渠道隔离与 actor 路由 |
| `pnpm exec vitest run --maxWorkers=2` | 219 个文件、2313 项全部通过 |
| `pnpm typecheck`、`pnpm build:desktop` | 类型检查及 Web、Main、Preload、Renderer 构建通过 |
| `node --test scripts/benchmark/protocol/product-contract.test.mjs` | 1 项通过，指纹为 v1.72 / schema 126 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=3b49137b0e4e24ed1f84251efe6645b6c7b68578 pnpm docs:check:ci` | 10 项文档测试及全部通用门禁通过 |
| Standards / Spec 独立复核 | 均通过；通知版本文档和生产迁移保留，Lark 编号、迁移顺序、来源准入及反向 fixture 一致 |

真实租户验收状态保持不变。

## 2026-09-27 Lark 入站附件补充

基线为主线 `0f7b101a`。先前“Lark 不进入下载队列”是当时尚无 Lark 完成请求时的范围记录；本次按
[V1.72-D03](decisions.md#v1-72-d03)补上第 21 个 `channels.lark.*` 请求，并让 Lark Host 复用资源提取、
持久队列、消息准入与 Source Ref。请求名确定 `lark-channel-host`；飞书 Host 的完成结果不能结算 Lark Request。

验收范围：飞书与 Lark 参数化的流式下载、临时文件清理和文件夹失败提示；Core Lark 资源观察、队列领取、
错误 Host 拒绝、正确 Host 完成及 Agent 消息的 Source Ref。真实 Lark 租户的消息资源权限和客户端文件行为
仍未完成逐项验收。

| 验证 | 结果 |
| --- | --- |
| `pnpm exec vitest run apps/desktop/src/main/channel-settings.test.ts --maxWorkers=2` | 78 项通过；包含飞书与 Lark 的下载恢复、去重和文件夹失败路径 |
| `pnpm exec vitest run apps/desktop/src/main/feishu-inbound-attachments.test.ts apps/desktop/src/main/channel-settings-coordinator.test.ts --maxWorkers=2` | 15 项通过 |
| `pnpm typecheck`、`pnpm build:desktop` | 类型检查及 Web、Main、Preload、Renderer 构建通过 |
| `cargo test -p rovai-core --features extended-tests --lib wrong_provider_hosts_are_rejected_by_every_lark_capable_handler` | 1 项通过；覆盖 Lark 附件的 provider 隔离与 Agent 输入路径 |
| `cargo test -p rovai-core --features extended-tests --lib inbound_attachments_` | 2 项通过；飞书与钉钉原有准入、重试、失败、删除及 20＋2/FIFO 回归 |
| `cargo test -p rovai-core --features extended-tests --lib lark_actor_routes_are_closed_and_payload_cannot_supply_authority` | 1 项通过；新完成方法由 Lark Host 执行，payload 不可自报 actor；飞书、钉钉原有完成方法仍有各自 Host 路由 |
| `cargo fmt --all --check`、`pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=0f7b101a226da2158f1de0fe95baead27e4c47ae pnpm docs:check:ci` | 格式与文档通用门禁通过 |

## 2026-09-27 侧栏与 Skills 并行切片

侧栏按 [Navigation Read v1](../../contracts/navigation-read-v1.md) 实施单 Camp、单分组与摘要完整快照读取。
从主线 v1.72/schema 126 经 Migration 177 升为 schema 127：camp 增加三项摘要字段，消息首次发布和 Agent
消息撤回在原事务维护，保留 camp_view_state 已读；新增业务表为 0。普通切换只处理目标 Camp，状态与成员变化按已知
范围刷新，缺可信基础时从摘要恢复完整快照。SQL 分组窗口替代先读全体再截断，正常读取不聚合历史事件。
Skills 则在现有 NativeSkillDiscovery 内改为 128 目录、300 秒 TTL 的原始元数据缓存，合并同目录在途扫描和一次
Camp 手动刷新中的重复目录；Settings 与选择器仍按需同步返回，不增加启动预热或后台订阅。

测试准入：`navigation_summary_migration_preserves_tables_backfills_and_rolls_back_with_events` 独立拥有 schema 126→127
的回填、表集合不变、receipt 失败回滚、摘要事务一致性与重启边界；必须用 SQLite，现有迁移 owner 不覆盖这些事实。
`navigation_reads_no_history_and_scoped_work_does_not_grow_with_other_groups` 在 SQLite authorizer 禁止 event_log
读取时验证行、组、完整、分页与已读，并用 2,000 个无关 Camp、50,000 条历史事件验证局部读取工作量。
最小命令分别是 `cargo test -p rovai-core --lib --features extended-tests navigation_summary_migration` 与
`cargo test -p rovai-core --lib --features extended-tests navigation_reads_no_history`；Skills 目录共享/强刷去重由
`native_skills::tests::shared_directory_keeps_runtime_paths_and_refreshes_once_per_request` 拥有。

此前在隔离 Core 中对 342 Camp、18 组、57,000 条人工历史事件的 30 次请求测得：完整侧栏中位数
61.76→9.95ms，排在它后面的打开请求 38.47→13.24ms，单行/单组读取为 0.61/0.87ms。
这是同步当前主线前的顺序阶段测量，不能当作本次合并后的点击到绘制验收；最新主线集成门禁另行记录。

合并主线 `0f7b101a2` 后的集成验证：Rust 默认 workspace 436 项通过、1 项既有 ignore；导航 Migration 177、
无历史读取、回复首次发布／撤回、Lark Migration 176 定向测试通过。Vitest 219 文件／2,317 项、TypeScript
检查、Desktop 构建、Product Contract Fingerprint、Rust 格式及通用文档门禁通过。未运行日常 App 的真实点击到绘制复测。

## 2026-09-28 渠道网页执行台还原

Principal 确认本地交互稿后，以主线 `41aa0e2e` 为实施基线，完成飞书、Lark、钉钉共用的只读网页执行台。
网页阅读面从生产 Renderer 复用 `ToolActivityGroup`、`ExecutionStatusGlyph`、`SafeMarkdown`、Run 卡片 CSS 与主题 Token；
独立 Vite 入口随 `pnpm dev` / `pnpm build:desktop` 生成同源静态资源，由原局域网服务按固定白名单提供。
原 `channels.executionConsole.webSnapshot`、Bearer grant、SSE 和公开字段范围保持原有权威边界；网页没有新增私有 Evidence 读取、文件预览、停止或重跑入口。

| 验证 | 结果与边界 |
| --- | --- |
| `pnpm typecheck`、`pnpm build:desktop` | 通过；Web、只读执行台、Main、Preload、Renderer 均构建成功 |
| `pnpm exec vitest run --maxWorkers=2` | 222 个文件、2348 项通过；网页服务 owner 覆盖只读页面与静态资源白名单、公开 Snapshot 授权及 SSE |
| `pnpm test:rust:pr` | 通过；default-feature Rust workspace 无失败 |
| 文档治理与版本门禁 | 在仅含 Git 跟踪文件的源码快照运行 Decision 单元测试（10 项）、版本检查及含 `--require-base` 的 PR 差异检查，均通过 |
| 其余 `pnpm test` 子门禁 | 在原 checkout 逐项运行：Skills 测试 3 项、Skills 检查 12 项、Electron sandbox 测试 7 项、Node 测试 346 项通过且 2 项跳过 |
| Chrome 局域网预览 | 使用固定公开演示 Snapshot，在桌面与 390px 手机宽度核对交互稿；Run 标题只切换触发消息，历史区与 Command 独立展开，结果保持只读；未连接真实渠道或 Runtime |
| Impeccable 机械检查 | 对新网页入口、样式与页面壳运行一次 detector，结果 `[]` |

本机 Git 忽略的旧 `docs/prototypes/` 含失效相对链接，直接在原 checkout 运行 `pnpm test` 会在文档检查阶段被这些未提交文件拦截；
提交范围内的文档门禁在干净源码快照复核，其余测试按相同子命令在原 checkout 复核，不改动该本地原型目录。

## 2026-09-28 当前版本发布日期

v0.4.0 的 `build/release-metadata.json` 使用[正式 GitHub Release](https://github.com/murray17/rovai-ai/releases/tag/v0.4.0) 的 `publishedAt`：
`2026-09-25T18:30:52.000Z`。Desktop Main 与 Desktop 托管 Web 将其随包编译，并只在运行版本一致且日期规范时
投影给当前版本；候选版本仍取 updater 返回值。缺失、旧版本或无效值维持日期未知。桌面构建入口增加源文件
前置校验，使后续版本提升必须同时更新日志与日期。

| 验证 | 结果与边界 |
| --- | --- |
| `node --test scripts/lib/release-notes.test.mjs`、定向 App Update Vitest | 6 项源校验与 28 项 Main/Renderer 测试通过；覆盖版本不符、无效日期、离线快照、成功检查后保留日期及页面日期呈现 |
| `pnpm typecheck`、`pnpm build:desktop`、`pnpm test` | 通过；构建输出的 Main、Renderer 与 Web 均包含版本绑定时间戳 |
| `pnpm test:rust:pr` | 通过；共享 Rust workspace 无回归 |
| `pnpm package:mac`、`pnpm accept:app-updates-ui` | 通过；隔离打包 App 在 Day/Night、1440×920、1040×700 及 200% 等效宽度下，快照日期与页面一致；当前时区显示 2026 年 9 月 26 日，无横向溢出 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=<本次 origin/main 基线> pnpm docs:check:ci` | 通用文档治理、版本与 PR 差异门禁通过 |

正式签名发布和跨版本升级不在这次本地验收范围；本次打包只验证版本绑定的离线日期投影。

## 2026-09-29 候选版本发布日期兼容

对[正式 v0.4.1](https://github.com/murray17/rovai-ai/releases/tag/v0.4.1) 清单的复现确认：合并后的
`latest-mac.yml` 将 `releaseDate` 输出为无引号时间戳，`electron-updater` 自身的 YAML 解析器返回
`Date` 对象；Main 原先仅接受字符串，导致候选日期变成 `null`。同版本 Windows 清单仍保留字符串，
不触发该缺陷。此前随包日期修复覆盖的是已安装版本，未覆盖这一生成端与消费端的类型差异。

macOS 清单序列化启用 YAML 1.1 字符串兼容，保留旧客户端所需的字符串类型；Main 接受有限时间戳的
`Date` 对象并转换成 UTC ISO 字符串，无效日期仍为 `null`。App Update v6 的公开字段与版本来源不变。

| 验证 | 结果与边界 |
| --- | --- |
| 生成端与 Main 回归 | 两项新增回归在修改前分别复现日期类型变化及候选日期丢失；修复后 macOS 清单 6 项、Main/Renderer 36 项通过，覆盖实际 Provider 解析、已安装日期独立保留及无效日期 |
| `pnpm typecheck`、`pnpm test`、`pnpm build:desktop` | 通过；Main 与发布清单生成链路可编译，完整 TypeScript/Node 回归通过 |
| `pnpm test:rust:pr` | 本机基线失败：Core lib 391 通过、1 失败、1 忽略，后续 workspace target 未执行。`read_probe_tolerates_only_a_new_empty_wal_not_authority_changes` 假定新文件没有 `com.apple.provenance`，实际已存在；单独重跑同样失败。`Cargo.toml`、`Cargo.lock`、`crates/` 与 `.cargo/` 对主线基线 `ab6f67fb` 无差异 |
| 文档门禁 | `pnpm docs:test` 与带真实基线 SHA 的 `docs:check:ci` 通过 |
| 已发布清单的修补预演 | 对 v0.4.1 清单重新序列化，仅增加日期引号；解析后的字段值、文件地址与安装包哈希一致，配套 checksum 仅更新清单一行。该预演不表示已替换远端 Release 资产 |

此项未重新打包、签名或安装 App；本地生成物与现有公开发布资产分别记录。

## 2026-09-30 Claude Code 原生双向审批

PR #592 的审批通道替换为 stream-json 输入/输出和 stdio 原生控制请求。删除审批 command Hook、专用 IPC
与完整输入匹配缓存；按 request_id 回填、按 tool_use_id 结算。Action/Approval 与历史数据复用既有表，
用户配置冻结，Fast settings 和 `rovai send` 业务 lease 保留。stdin 在协议初始化后投递任务，在末轮
结果与 Session idle、无未决请求/任务后关闭；异常有界清理。合同与理由见
[Runtime Launch v45](../../contracts/runtime-launch-and-verification-v45.md)和[V1.72-D06](decisions.md#v1-72-d06)。

原 2026-09-29 的 CLI 2.1.274 Hook Smoke 和组件夹具已不构成本实现验收证据。当前原生协议的确定性、
真实 Core 与实际 Desktop 点击验收如下；完整回执见[Runtime 兼容性清单](../../runtime-compatibility.md#claude-code-原生双向审批2026-09-30)。

| 验证 | 结果与边界 |
| --- | --- |
| 控制协议确定性矩阵 | `cargo test -p rovai-core --features extended-tests --lib claude` 44 项通过、1 项人工目录 Smoke 忽略。初始化失败、模式漂移、缺少可靠工具 ID 拒绝；256 次普通工具后仍审批；相同命令的并发请求按独立 ID 回填；取消/断线撤回已排队允许；长审批/后台任务暂停计时，两个官方任务终态形态解除跟踪；多结果与 idle 联合决定 stdin 关闭 |
| 既有 Action 事务 | 慢速 native-resolution owner 1 项通过；在原 SQLite fixture 内覆盖已交付响应的 ACK，以及 Codex/Claude 未决 Approval 取消、实际 Runtime 来源署名 |
| 真实 Core 审批 | CLI `2.1.280`，冻结 `acceptEdits`；允许一次后真实发送并根据工具结果结算，拒绝后无消息/回执，待审批取消为 `not_executed` |
| 完整 Claude 回归 | `ROVAI_CLAUDE_APPROVAL_SMOKE=1 node scripts/smoke-claude-runtime.mjs` 通过；新 Session 与同 Session resume、Runtime model、文本、工具输出、真实 Edit mutation、取消进程树及允许/拒绝/待审批取消均覆盖。多结果末轮输出与用量保留由上述 reader 确定性测试拥有 |
| 实际 Desktop 点击 | 真实 `pnpm dev`，隔离 userData/Skill Library/MCP；实际点击 Dock 的允许与拒绝，直接核对 Core Native Session binding 事件相同、两次 Shell canonical argv 完全一致、Action digest 相同但 Action/request digest 独立，分别真实发送和无新增消息/回执。保存四张截图与结果 JSON；这次未打包或安装日常 App |
| TypeScript / JavaScript 回归 | `pnpm typecheck`、`pnpm test` 通过；Vitest 222 文件/2376 测试，Node 业务协议 328 通过/2 跳过，文档治理 10 项通过 |
| 默认 Rust 门禁 | `pnpm test:rust:pr` 本机 394 通过、1 失败、1 忽略；失败仍是未改动的 `database_admission::tests::read_probe_tolerates_only_a_new_empty_wal_not_authority_changes` 对已有 `com.apple.provenance` 的假设，后续 workspace target 被该失败阻断。未删除、禁用或修改该测试 |
| Rust 后续目标补充检查 | 显式 `--skip database_admission::tests::read_probe_tolerates_only_a_new_empty_wal_not_authority_changes` 后，workspace 共 438 通过、1 忽略、1 过滤；Core bin、CLI、Host、Web 和 doc-tests 均完成。最终 compatibility source digest 的独立定向测试通过；这不改写默认门禁失败结论 |
| 文档治理 | `pnpm docs:test`、`pnpm docs:check` 和真实 PR base `cb9cd309593cc9403cddd25ce9cf0a114863063a` 的 `docs:check:ci` 通过 |

推送 `7f14abae` 后同步主线 `a39cf861`（#593 执行文案与 #594 Agent 指令英文化）。唯一冲突位于当前版本
概览，保留两项交付与各自生效边界；原生控制生产路径没有冲突。合并后 `pnpm typecheck`、
`cargo check --workspace`、44 项 Claude 定向回归（另 1 项人工 Smoke 忽略）及以
`a39cf861d8f2dd8db4f78603838d57c131958d2e` 为真实基线的文档 CI 门禁通过。上表完整回归与实际
Desktop 点击证据属于 `7f14abae`，未将主线同步冒充新的实际模型验收。

## 2026-09-30 Claude 原生选项与规则记忆

在主线 `df7f7abd1a43b9e1002d6974e693f79e2f0b0f0c` 上补充原生建议的规则记忆。stdio 请求没有按钮标签数组，
使用本机 Claude Code `2.1.280` 可核实的原生 `Yes`、`No` 和 `Yes, and don’t ask again for: …` 模板。
ACP 原生标签和 Codex 的固定英文决定标签原样展示；Claude 同样不随界面语言翻译。旧 Claude Approval 的两个
中文 host 标签只在展示时兼容，不修改历史冻结响应和 ID。Core 自有审批文案继续按界面语言显示。

有效 addRules/allow 建议分别冻结为记忆选项，原生范围保留在按钮标签，destination 保留在冻结元数据；允许一次不携带权限更新。
记忆决定原样回填 selected suggestion，Claude 负责规则保存与未来匹配；suppression 或无效/未支持建议
不会产生记忆选项。控制 writer 与转换层共用建议准入，只保存未决请求有效记忆响应的 digest，完成、取消和
断线时清理；响应的范围、destination 或 input 改动不能通过校验。当前合同见
[Runtime Launch v48](../../contracts/runtime-launch-and-verification-v48.md)。

| 验证 | 结果与边界 |
| --- | --- |
| Claude 确定性回归 | `cargo test -p rovai-core --features extended-tests --lib claude` 44 项通过、1 项人工目录 Smoke 忽略。扩展既有纯转换及 writer/reader seam owners，覆盖建议精确透传、四种 destination、suppression、重复/无效建议、独立响应 digest、规则范围/目的地篡改、跨请求借用和取消/断线后的迟到记忆写入；原有 256 次普通工具、并发、初始化、多结果和收尾测试保留 |
| 生产 ApprovalDock（`69acb895`，布局调整前） | `pnpm test:approval-dock` 通过；中英文界面均保持 Claude 原生英文，语言切换保留 optionId/digest。Core 标签继续本地化，其他 Runtime 标签保持原样。当时记忆 scope 可见且作为无障碍描述，长规则在桌面与手机换行，44px 控件、完整请求和队列焦点边界保留；后续展示收敛见下节 |
| 类型与格式 | `pnpm typecheck`、`cargo fmt --package rovai-core -- --check` 通过 |
| 真实 Desktop 点击 | CLI `2.1.280 (Claude Code)`、冻结 acceptEdits，独立临时 userData/Skill Library/MCP 与 Git 项目；依次实际点击 Yes、No、记忆，Action 分别 succeeded/not_executed/succeeded。三个相同命令的请求与 Action ID 独立，使用同一 Native Session；允许与记忆各有对应 Run 的 Core receipt 和 exact message，拒绝均无发送 |
| 原生保存与后续执行 | Claude 写入隔离项目 `.claude/settings.local.json`，allow 数组仅含本次选中 `Bash(rovai send *)`，无 bypass 模式。第四个 resumed Run 没有新增 Approval，仍产生独立 Core send receipt 与 exact message；结果 JSON、七张真实截图和 native button source 证据保存在任务附件中 |
| UI 检查 | 对三个改动 UI 文件执行 Impeccable detector，文件中 116 项既有报告，本次改动行零命中；结合生产桌面/手机截图人工核验，未新增忽略规则 |

首轮真实记忆点击发现旧 writer 只允许不带 updatedPermissions 的响应，导致批准后的投递失败、Action unknown，
验收在 240 秒上限内失败并清理隔离进程。保留失败证据后补齐精确建议 digest 校验，再以全新隔离环境完成上表
全部真实点击与第四轮发送验收；没有用旧允许/拒绝结果代替记忆证据。本补充只验证开发版，未重新打包或安装日常 App。

## 2026-09-30 审批选项展示收敛

按用户确认去掉左下方配置文件与 destination 说明，移除记忆选项独占整行的包装。Desktop 和 Mobile
共享按内容宽度排列、空间不足自然换行的选项区；Claude 三个选项放得下为一排，放不下为两排。
原生英文标签与其中的规则范围完整保留，Mobile 控件保留至少 44px 触控区域。冻结 optionId、响应 digest、
规则保存和审批投递不变；本次只调整展示及既有验收夹具。

`pnpm test:approval-dock` 通过：无 Core/Runtime 的隔离生产组件在桌面宽屏与 430px 手机视口为一排，
375px 手机视口为两排；长标签、配置文件说明隐藏、原生决定身份、实际按钮点击与长选项列表滚动均通过。
`pnpm typecheck`、`pnpm docs:test`、`pnpm docs:check` 与真实分支基线 `df7f7abd` 的文档 CI 门禁通过。
上节 Claude Code `2.1.280` 真实 Desktop/发送证据属于布局调整前的 `69acb895`，不作为本次新布局的实际 Runtime 验收。


## 2026-10-02 Sidecar v3 交互实现

Principal 确认 v3 HTML 后授权实施、创建 PR 并合入 main。本次范围保留既有 Porcelain Day / Steel Night、
270px 默认宽度与 200–420px 调宽、项目 34px / 对话 28px 行高，不替换视觉世界。

- 项目和对话的右键、三点、Shift+F10 / ContextMenu 与触屏长按使用同一菜单；右键不导航或折叠，
  Escape 恢复行焦点，滚动和失焦关闭。项目行的创建图标复用既有 New Chat，增加原生目录定位与复制路径。
- 操作默认隐藏，选中行也不常驻。运行环与未读点独立并列，悬浮/可见焦点/菜单打开时隐藏状态簇，
  最右侧显示三点；标题空间不变。运行环 Day 为 `#7a7d80`，Night 为 `#a2a6aa`。
- 导航偏好 schema 5 保存手动提醒与本机 read-through；合法旧 schema 2/3/4 读取不重写或降级。
  串行原子保存、失败保留旧值、重启恢复和其他窗口/标签页同步均保持。Core schema 与真实查看水位不变。
- 标记已读仅覆盖当前已知回复。聚焦、后台刷新和 Run 结束不清除手动提醒；显式完整打开（含历史导航）
  才清除。取消离开、打开失败与缓存预览保留提醒，再次打开预览可以重试完整投影。

验证：`pnpm typecheck`、`pnpm test`（225 个 Vitest 文件，2428 项；随后 Node owner 328 通过、2 平台跳过）、
`pnpm test:rust:pr`、`pnpm test:desktop-bridge`、`pnpm test:startup-presentation`、`pnpm test:navigation-shell`
与 `pnpm build:desktop` 通过。Electron 验收使用独立临时 userData，不启动 Core、SQLite 或 Runtime。
真实原生输入覆盖双状态、悬浮替换/标题稳定、菜单位置/边界、两种入口、键盘焦点、读状态切换/重启、
目录定位传参、路径复制、远程 Web 缺少原生入口及 200px 布局；Day/Night、默认/悬浮、两类菜单和窄栏截图已人工核对。

默认 Rust 门禁发现既有 namespace comparator 测试假设临时文件没有 `com.apple.provenance`，当前 macOS
自动加标签会打破该假设。在原 owner 内显式构造无标签的旧观察值，继续使用真实带标签文件并保留 authority
变更的拒绝断言；无新增、删除或禁用 Rust 测试，生产数据库 admission 逻辑不变。

本次可逆行操作沿用既有导航权威，无新增 Version Decision 准入事项。当前 Contract、Architecture 与 UI 同步更新，
版本指针与 Runtime/Context 合同确认无需变化。

## 2026-10-02 AI 优先添加队员

Principal 确认实现并要求独立 worktree、PR 到 main 后合入。工作基线 `9028e5fb`，分支
`rovai/ai-first-member-creation`。本切片保留队员页右侧信息/Runtime 表单与离队资料；只调整名册入口、
直接排序、普通草稿会话的起步操作与静态成功卡片。合同与理由见
[Member Creation Flow v1](../../contracts/member-creation-flow-v1.md)和[V1.72-D09](decisions.md#v1-72-d09)。

实现采用单个可用协助者、窗口内草稿 overlay 和现有发送激活事务。Profile、静态回执及最近成功协助者在同一
Gateway 事务中提交；Migration 180/schema 130 增加两张业务表，不改模型上下文或 Skill。

测试准入：扩展现有 `team_tool` 的幂等创建 owner，覆盖回执失败导致 Profile 回滚、重试只出一张卡、改名/离队后快照
不变、Open 可读且不增加消息/会话成员。新增迁移测试独立拥有当时 schema 129→130 原子边界；不复制旧 migration owner。
Renderer 的纯函数覆盖可用性优先、回退和过滤后排序；Electron 使用 production BusinessApp 与隔离内存 transport，
不启动真实 Core/Runtime，不读取日用 userData/Skill Library。

已验证：

- `pnpm typecheck`、`cargo test --workspace`。
- 现有 member-create 扩展 owner 与新 Migration 180 owner。
- `node --test scripts/lib/member-editor.test.mjs`：19 项，含排序保存失败回退、键盘操作、分隔线、设置表单及桌面双主题。
- `pnpm test:member-creation`：14 项，含新空草稿、输入后侧栏、同窗口恢复、发送拒绝、普通激活、静态卡、离队配置跳转、
  无可用协助者手动降级、手机原生触摸拖拽、英文 starter/Return 换行与明暗卡片。
- 人工检查生产 fixture 的桌面入队卡、390px 英文名册及手机夜间入队卡，未见水平溢出或头像遮挡。

合并主线 `63225393` 后，本切片顺延为 Migration 180/schema 130、V1.72-D09；新旧 Migration 的完成准入逐级衔接。
`pnpm test` 全通过：226 个 Vitest 文件/2,431 项，Node 回归 328 通过、2 项平台跳过。`pnpm build:desktop`、
Typecheck、Rust format 与基于 `63225393` 的文档门禁通过。Open 的 3 项慢测试证明零 event-log 读取、
标题分页稳定与无关会话规模不扩大读取。最终 `cargo test --workspace` 为 439 通过、1 项人工 Runtime smoke 保持忽略。DB 扩展组 96 项中 95 项首轮通过；
旧 v99 fixture 降级时遇到主线新增的 `agent_v2` 约束，修复 test-only downgrade 后该用例单独复跑通过。
真实模型执行及实体手机软键盘尚未在本切片验收；
隔离 fixture 只证明交互和投影，不宣称模型端到端或发布安装完成。


## 2026-10-02 安装前的双分支迁移收口

合入 main `91b315e9` 时，本机日常库仍是指标预览的 schema 128 / Migration 178。
保留指标分支 178/179 和 Thread 收口 180，User 投影、队员回执顺延为 181/182，当前 schema 132。
main 已部署的 schema 128/129/130 按完整表、约束与连续收据组合识别；补建空指标投影并原子追加缺失收据，
不修改既有收据时间、业务行或冻结输入证据。未知、缺损或混杂布局拒绝升级。

测试继续扩展 `db::thread_names` 的既有双分支收口 owner，增加 main 129/130、收据失败回滚、损坏结构拒绝、
原队员创建回执与偏好保留、重新打开幂等性；没有新增独立 Rust 测试函数。
已安装指标 schema 128 的旧数量与 null 比例仍由 `session_context_migration` owner 验证。
最小命令为 `cargo test -p rovai-core --features extended-tests --lib db::`；
打包验收使用按日常只读 DDL 构造的空 schema 128 fixture，不复制日常业务行或凭据。

## 2026-10-02 队员运行配置应用

Principal 确认交互稿后授权独立 worktree 实现、PR 到 main 并合入。工作基线 `91b315e9`，分支
`rovai/member-runtime-apply`。范围为队员设置中的“应用到其他队员”，不包含新手训练的配置复制。
沿用正式队员页、Dialog、主题和 Runtime 表单；中英文共用状态，手机使用可滚动底部面板和固定操作区。

入口只应用来源队员已保存的 Runtime、模型原生选项和权限；打开时冻结来源配置及目标版本，默认只选未配置队员。
已有配置显示替换前后摘要；目标 Runtime 草稿、保存中与平台只读配置不可选，身份草稿独立保留。
逐队员复用 `members.runtime.set` 和原有目录拒绝恢复，不新增批量命令或数据库结构。
仅有效 applied 回执记为保存成功，部分失败保留已完成项；结果未知先读回核对，不自动重放。
并发冲突重新读取并展示选择，用户复核后才使用新版本提交。提交期间保护关闭与页面导航。

本次是既有命令的可逆界面组合，无新增 Version Decision 准入事项。当前 Architecture、Contract、版本指针和
Runtime/Context 合同无需变化；稳定交互规则同步至 [Member Identity](../../ui/components/member-identity.md#应用运行配置到其他队员)。

已验证：

- `pnpm typecheck`；Runtime 批量恢复、既有单队员保存和语言目录共 21 项 Vitest 通过。
- `pnpm test:rust:pr`：439 项通过、1 项人工 Runtime smoke 维持忽略；没有修改、新增、删除或禁用 Rust 测试。
- `pnpm test:member-runtime-apply`：51 项检查通过，零 Renderer console error，覆盖真实按钮操作、草稿隔离、
  部分失败重试、未知回执读回、并发版本冲突、读取失败恢复和键盘焦点约束。
- 生产组件截图人工核验：桌面覆盖提示、375px 英文夜间、390px 中文日间与 200% 缩放；另外自动检查
  430px 手机、844×390 横屏及 1040/1440/2560 桌面视口、375px 超长队员名、搜索/空状态、两种主题和减少动态效果。
- `node --test scripts/lib/member-editor.test.mjs`：原有 19 项队员编辑验收通过。
- `pnpm test`：227 个 Vitest 文件、2438 项通过；随后 Node 回归 328 项通过、2 项平台跳过。
- `pnpm build:desktop`、文档普通门禁与基于真实 `91b315e9` 的 `pnpm docs:check:ci` 通过。

Electron 采用独立临时 userData/Skill Library 与显式内存 transport，不启动 Core/Runtime 或读取日用数据。
原生 fixture 字段保持原值；上述证据不代表真实模型执行、实体手机或已打包安装。首轮验收末项暴露 200% 缩放下
测试驱动的 CSS/DIP 坐标差，按 zoomFactor 修正点击坐标后全量通过，未以改动产品布局绕过该检查。
最终截图复核修正了短视口继承旧 `.dialog-actions` 背景的问题；新弹窗操作区保持本层背景，位置由固定 footer 管理。

## 2026-10-02 指标原生格式兼容与补采

用户明确要求指标采集不以 CLI 精确版本或指标专用最小版本阻断；Grok 等产品最低准入继续生效。
实现改为原生格式、根 Session、workspace、模型和字段语义校验。CodeBuddy、Kiro、TRAE、Antigravity
新增来源，OpenCode 补失败占位记录过滤。两轮同 Session 冷恢复及独立 raw fixture 见
[原生格式兼容验收](../../research/runtime-monitoring/native-format-compatibility-2026-10-02.md)。

当前合同为 [Runtime Usage Monitoring v8](../../contracts/runtime-usage-monitoring-v8.md) 和
[Runtime Execution Metrics v5](../../contracts/runtime-execution-metrics-v5.md)；不新增迁移、输出测速、
模型提示或 Renderer 布局。未验证字段保持未知，CLI 实测版本和版本准入明确分开。
默认 Rust gate 与生产 Renderer 500 Run 回放通过；真实逐 Runtime 同调用打包 App、正缓存写、
未提供窗口和其他来源的 Context 仍按验收记录保留边界。

## 2026-10-03 缺失字段修正

补接 DSH 原生 totalTokens 与 ZCode 原生 Session snapshot 的 contextUsage；不添加版本门槛、
历史上下文、测速或 UI 布局。修正先前 null/null 一致被当作完整采集通过的结论。
真实打包 App 已复跑和核对：DSH 93.6k，ZCode 18.8k / 200k、9.4%；整体仍有缺口，
见[逐字段证据与未决项](../../research/runtime-monitoring/missing-fields-verification-2026-10-03.md)。

## 2026-10-03 五类原生来源补查

补接 Antigravity 原生 SQLite 同调用数值、Qoder 明确配置窗口与原生输入的配对、TRAE 原生校准占用，
以及 Kiro 精确 Session 的模型窗口。CodeBuddy 当前自定义模型窗口、Kiro 精确 used/Run token
在已查来源中仍缺失，不从比例反推或借用其他模型容量。Kiro 卡头与气泡的比例统一为一位小数。
[Usage v8](../../contracts/runtime-usage-monitoring-v8.md) 与
[Execution Metrics v5](../../contracts/runtime-execution-metrics-v5.md)拥有新增来源；schema 不变。

Rust 测试准入、原始字段与实际 App 证据见[本轮来源验收](../../research/runtime-monitoring/native-source-completion-2026-10-03.md)。
新增唯一 extended SQLite owner，TRAE 保留原进程边界 owner 并增补目录读取，其他扩展既有 owner。
本切片为已有指标的局部来源补齐，不新增 Version Decision，不改变模型上下文、运行配置或发布 Skill。


## Usage 分批刷盘一致性收口（2026-10-03）

按 [Usage v8](../../contracts/runtime-usage-monitoring-v8.md) 在入缓冲时逐调用归一化，保留累计帧序、
单调用去重与缓存请求计数。summary 的已有质量字段承接 Input/Output 部分状态；
[Execution Metrics v5](../../contracts/runtime-execution-metrics-v5.md) 把完整性送入现有总量入口守卫。
本次无数据库迁移、正文或历史回填；合成回放证明刷盘分区不影响数值及完整性，不扩大 Runtime 原生支持结论。
证据与测试归属见[分批刷盘验收](../../research/runtime-monitoring/flush-partition-verification-2026-10-03.md)。

## 2026-10-02 Run 内容块与 command 组分页

- Worktree：`rovai/run-block-pagination`，基线 `f229ce3edf24d4054499babf98b0b3d984e46868`；User 明确要求 PR 合入 main。
- Core 读取时薄索引构造完整组摘要，主线块、子窗口与输出分别按需；旧 RPC 和 schema 2 调用仍有效。
- Renderer 主线首屏 4–24 块、历史 12 块，组内 24 项；首次不足视口有界续接，无嵌套滚动框。
- Rust 测试准入：扩展原有 slow-tests 的 SQLite pagination owner，复用完整 schema fixture 覆盖万条组、游标、归属与旧子项变更。
  纯命令语法 proof 使用无 I/O 的独立单测，拥有与读取计数相关的静态语法边界，不复制 SQLite fixture。
- 初步隔离样本：10,000 commands 的首屏（组摘要及后一正文）1,621 bytes，单次本机读取约 325 ms。
  这是单 fixture 观测，不是跨机器基准；薄索引仍需全量元数据扫描，有序载体候选索引为 O(N log N)。
- 自动验收复用生产 Run/Tool 组件和临时 Electron userData，无 Core/真实 Runtime；覆盖底部/侧栏、日夜主题、
  初次补齐、组内与主线失败重试、独立游标、缓存、输出/diff 惰性读取、键盘和位置锚点。
- 最终验证记录见下；不据本机模拟扩大真实 Runtime/移动设备资格。

审核修正：规范轴发现逐 Shell 全 Run SQL 扫描和 generic Shell 可见性分歧；需求轴另发现流式正文遗漏、自动组分页
误关跟随、静止加载边界无法由新滚动意图重启。改为批量候选索引，现代载体只检查相邻 Core；无 digest 历史结果
按候选惰性取证。共享载体与可见性 fixture 覆盖两端规则；扩展既有正文 owner，验证 1,000 个 delta 不写 SQLite
但窗口正文继续增长。组自动续接保留跟随，新 wheel/key 即使不发生 scroll 也重新检查边界。
新增样本：10,000 带 canonical 的载体／Core 行（相同 digest，保留歧义）读取约 458 ms；此数字同样是本机单次观测。

复核补充相邻历史 start/end 的空区间保护，原 SQLite owner 覆盖未关联 Shell 仍独立可见。
规范轴 3 项、需求轴 5 项发现全部关闭（两轴有重叠），两名独立审核者在合并基线 `1111eadc` 确认通过。

最终本地证据：

- `pnpm typecheck`；`pnpm test`：233 个 Vitest 文件／2,490 tests 通过，Node suite 328 通过、2 项 Windows-only 跳过。
- `pnpm test:rust:pr`：workspace 默认 owner 441 通过、1 项既有人工 smoke ignored；并定向执行两个 `slow-tests`
  owner：SQLite pagination 和 streaming text（各 1 项，非零）。新增测试复用既有 fixture，不扩充默认 SQLite 集成 owner。
- `pnpm test:camp-open-projection`：11 项通过；`pnpm test:command-view`：1 项通过。合并最新 main 后再运行
  execution-window、block-pagination、command-interaction 三个受影响 Electron 模式，3 项通过。
- `pnpm build:desktop`、`cargo fmt --all -- --check`、`pnpm docs:check:ci` 通过；文档门禁使用当前 PR base `97aa3fde`。
- 上游 Run 最小初始宽度／Windows 窗口关闭改动已合入；只解决版本文档末尾追加冲突，并保留双方内容。

最初全套并发执行时出现既有 evaluation-host 等待超时及 Electron 资料卡返回焦点失败；停止并发 Electron/构建后，
完整原门禁通过，未降低断言或修改无关产品逻辑。CI、PR 与最终 merge SHA 由 PR 和任务完成记录保留。

## 2026-10-02 Windows 关闭选择与托盘

由 Windows Main 持有关闭偏好、当前弹窗与单一 Tray；以现有 GeneralSettings/AppDialog 展示三态选项和“记住我的选择”。
本机 `window-close.json` 独立于 Core/Host，macOS 和 Web 不获得 capability。Main 验证主窗口主 frame 和当前 promptId，
保存失败保留原设置，托盘失败保持窗口可见，显式退出使待完成隐藏失效并等待偏好写入后复用原退出路径。

这是可逆的本机窗口交互扩展，无新增 Version Decision 准入事项；不改变 Core schema、Runtime 生命周期、模型上下文或版本指针。
当前规范已同步 Windows Platform、Windows Interaction Delta、Settings surface brief 与 Windows Window Close v1。

本地验证：`pnpm typecheck`、`pnpm test`、`pnpm build:desktop` 通过；Rust 默认 workspace 回归 440 项通过、
1 项既有人工 smoke 忽略，无 Rust 测试改动。`pnpm test:windows-close` 的隔离 Electron 验收覆盖两种主题、
1040/1440 视口、英文 200% 缩放、真实 preload 请求、原 DOM/草稿/滚动保留、取消/记忆/三态切换、
失败恢复、普通最小化和更新退出；既有 `test:window-close` 与 `test:desktop-bridge` 通过。

`pnpm test:windows-close` 在非 Windows 上只验证控制流和真实 Electron 界面，
在 Windows runner 上额外创建原生托盘。固定 Server CI 不能代替 Windows 10/11 的任务栏、Explorer 重启、多屏 DPI、
NVDA、High Contrast 或安装升级的真人验收，未取得这些证据前不宣称这些项目完成。

## 消息寻址与执行查询

按已确认[方案 r2](model-context-change-thread-runs.md)实施：正常 thread read collection 增加已有 addressing；新增只读 thread.runs，
统一返回实际 Run 与队员排队集合。复用现有认证、事务、CLI、结果 Schema 和错误合同，保留动态分页限制与 null 等待原因。
不扩展执行诊断、调度管理、权限、存储或 Session 迁移；旧 Bootstrap 和已有绑定保持，Skill 随包同步。
验证覆盖公开范围、来源计数、首条输入、状态、Unicode、分页、Single Chat policy 和冻结 Bootstrap/Skill 更新。
实现与验证结果在[方案验证记录](model-context-change-thread-runs.md#实施验收记录)收口。
User 于 2026-10-03 明确豁免本次真实任务 Gate；其余本地检查、独立复核与 CI 已通过，交付见 [PR #616](https://github.com/murray17/rovai-ai/pull/616)。

## Claude 运行中 Context 修复（2026-10-03）

按 [Execution Metrics v6](../../contracts/runtime-execution-metrics-v6.md) 提前发出最近根模型调用 used，
窗口在匹配原生 result 到达后补齐；不新增迁移、公共字段、轮询、测速或模型上下文文本。
这是既有数值采集路径的可逆修复，无新增 Version Decision 准入事项。
真实故障和逐 Runtime 时机审计见[本轮记录](../../research/runtime-monitoring/live-context-verification-2026-10-03.md)。
既有 Rust stream/持久化 owner 扩展用例，App 验收新增可选的运行中 used-only 数值与气泡一致性门槛。

本地验证：Claude 33 项、monitoring 13 项、ACP 输入确认 owner 与默认 Rust workspace 450 项通过；
隔离打包 App 的 Claude 2.1.280 真实多工具 Run 成功，运行中 used-only 六次更新，终态窗口和四项用量
与 Renderer 一致。脚本当前版本/Thread 命名适配、原生脱敏数字、真实验收范围与尚未解决的 ACP/ZCode
时机限制均写入上述记录；不将代码审计扩大为全部 Runtime 的动态验收。

## 2026-10-03 普通一键新对话草稿恢复

- 回归来源：`ba545f799903d9de7a88e9b3ee03c745e3655614` 删除 public Core Draft 后，一键 Pending 首条输入只存 mounted Renderer；`ad47663f767d6dd9ab93e2c16f6f934650863dc0` 仅恢复 Active 本机草稿。两者在 PR #429 合入 main。
- 实现：普通 Pending 复用按 Thread 的本机 snapshot；已认证客户端 presence 驱动 Core 导航并保护空壳清理。首次发送事务清理标记，接受响应落盘空快照。同项目无数量限制。AI 创建队员保留既有窗口内草稿合同。
- 数据：Migration 183 / schema 133 从完整 schema 132 来源加性迁移；旧数据保留，DDL/marker/收据失败同事务回滚。不读取日常数据目录，不启动真实 Runtime。
- 自动化：本机存储与保存失败重试单测；Core 两客户端导航、同项目多草稿、清空、删除、激活回滚与重启清理；隔离 Electron 生产组件验收切换/刷新/窗口重建、拒绝/接受首发、清空及日夜最小窗口，既有 AI 创建流程一并回归。

### Rust 测试准入

新增两个 default owner，各拥有不同的失败边界：`pending_thread_draft` 测试生命周期及客户端隔离，
`db_pending_draft` 测试 schema 132 升级中途失败、重试和重开保留。旧 Draft 测试向 Core 写正文，既有空壳清理测试
没有客户端标记，不能证明本次边界；旧迁移测试止于 schema 132。两者都必须用临时 SQLite 验证事务与重开，
复用 seeded fixture，未启动模型或增加真实 Runtime 测试。准入矩阵在原 owner 增补 schema 133 缺收据的拒绝 case。
最小命令：`cargo test -p rovai-core pending_draft`。完整门禁结果在提交前记入本节。

提交前门禁通过：`cargo fmt --all --check`、默认 `cargo test --workspace`（452 passed，1 既有 ignored）、
`pnpm typecheck`、完整 `pnpm test`（236 个 Vitest 文件 / 2527 项，Node 328 passed / 2 平台 skipped）、
`pnpm build:desktop`、`pnpm test:member-creation`（2 个隔离 Electron 场景）及三项通用文档门禁。
全量第二轮曾遇到既有 Lark 附件流用例等待超时；该文件独立 81 项及随后完整套件均通过，未改该用例或渠道代码。
界面夹具使用内存服务替身，Core 持久化/清理由 SQLite 测试独立验证；未安装或重启日常 App，未运行真实模型。

## Claude Code 与 Codex 原生连接编辑

User 已确认原生配置复用、共享影响范围、两张简单表单及字段级冲突交互，并要求 worktree 实施后推送分支。
不重复保存 Key，不新增探活。按 [D15](decisions.md#v1-72-d15) 收窄为保存时原生切换、完整内存草稿与直接原生执行。
实施与验证统一见[验收记录](runtime-custom-api-verification.md)，
字段以 [Runtime Launch v48](../../contracts/runtime-launch-and-verification-v48.md) 为准。
### 2026-10-04 Context 运行中可用性

按用户确认的 [Execution Metrics v7](../../contracts/runtime-execution-metrics-v7.md) 移除输入 accepted
等待与延后 Context 缓冲；有效实际模型/配置下复用窗口，三个字段独立可用，原生 Run 用量结算不变。
ZCode 根调用结束/压缩触发合并读取，Pi/Antigravity 保留独立字段；界面仅时间刷新复用旧对象。
实现与 App 证据由[本轮验收](../../research/runtime-monitoring/live-context-usability-2026-10-04.md)拥有。
继续 PR Review，本轮不自动合并或替换日常 App/数据库。


## 2026-10-05 训练营默认 Runtime 配置复制

- Worktree：`rovai/onboarding-runtime-copy`，基线 `cb33fdc0c6203340609e0ac435e09c2a1cfc7ba1`。
- 在所选成员配置后冻结其余未配置内置队员的版本与命令 ID，逐人保存同一 Runtime、模型参数及默认权限。
- Desktop onboarding 升级 schema 3；旧未完成进度保持检查点并补齐复制，所有完成来源继续终态、不补写。
- 未知结果复用原命令；已知拒绝才换命令重试；并发变更和移除跳过，完成准入要求复制计划全部收口。
- 同步 [First-run Onboarding v6](../../contracts/first-run-onboarding-v6.md)、Architecture、UI 与当前文档路由。
- 不新增 Rust/Core 行为或数据库表，不修改模型上下文；既有队员页手动应用入口保持独立。
- 验证已通过：`pnpm typecheck`、`pnpm test`（包含新增 14 项真实 Desktop 状态文件恢复测试，Node 汇总 334 通过 / 2 平台跳过）、`pnpm build:desktop`、`pnpm test:desktop-bridge`（真实隔离 Electron contextBridge）、`git diff --check` 及基于上述基线的 `pnpm docs:check:ci`。
- `pnpm test:rust:pr` 默认 workspace 回归：453 项通过，1 项既有忽略；使用本机 Rust 1.97.1，仅为该命令补充工具链 PATH。未新增、删除或改动 Rust 测试。恢复测试使用确定性 Core 命令账本，不冒充真实 Runtime 执行验收。

## 2026-10-05：更新入口与关于设置 R2

按 User 确认的 R2 HTML 稿落实普通侧栏与「关于与更新」。侧栏使用可读的透明状态入口，设置菜单图标与更新
状态采用独立尺寸规则，修复状态被 22px 图标槽挤压的问题；英文窄栏允许入口另起一行。页面顶部合并当前
版本、状态与操作，日志优先于折叠检查记录，版本号进入日志 Tab，下载只保留一处可见百分比。当前
[设置 brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md#关于与更新)同步实际 880px 阅读轨道。

当前/候选版本分离、语言切换、安全 Markdown、明确下载/安装、提示代次、只读 Desktop Web、Server 重连
和精确发布回退链接继续原合同；无 Main/Core 更新状态机、API、Schema、发布源、模型上下文或 Runtime 变化。

验证：

- `pnpm typecheck`、全量 Vitest 238 文件 / 2600 项通过。原有 About 静态布局断言转由真实 Electron 的
  几何与交互检查覆盖；进度 Token、提示、Mobile 44px 操作区等既有断言保留。
- `pnpm test:rust:pr`：453 passed、1 项原有 ignored；`pnpm test:navigation-shell` 通过。
- `pnpm test:release-notes-ui`：日夜与中英文、8 种侧栏状态、200/270/420px、原生方向键、
  切换语言保留所选版本且零请求、日志/检查记录顺序、下载单一百分比、显式安装和 390px 手机布局通过。
- `pnpm build:desktop`、`pnpm package:mac` 与 `accept-app-updates-ui.mjs`：独立 userData/Skill Library，
  真实 packaged 0.4.4 的内置日志/发布日期、确定性关闭联网自动检查、Day 1440×920、Night 1040×700、
  reduced motion 与 200% 等效布局通过。未操作日常 App、下载真实更新或执行升级安装。
- `pnpm docs:test`、`DOCS_BASE_REF=2d0d5171… pnpm docs:check:ci` 通过。

既有验收限制：`pnpm test:startup-presentation` 在本分支和冻结 `2d0d5171` 的生产模块上均报告
`Pre-ready authority calls: windowClose.get`。macOS 夹具的泛化 Proxy 暴露了 Windows-only 能力；
本次保留原脚本和准入断言，不将其列为通过，也不把 UI 修改扩大到启动与 Camp 清理逻辑。
签名跨版本升级与实体 Windows/手机不属于本次样式实施证据。

## 2026-10-05 Runtime 轻量启动

在独立 worktree 完成静态发现、配置/队列解耦、真实 Host 验证、初始化状态和具体失败展示。
未启动日常 App、未使用日常 Core 数据或真实账户 Runtime。自动化使用隔离 SQLite 和合成协议进程；
真实 CLI 登录、模型服务与跨平台兼容性不由这些夹具证明。

验证环境为 macOS arm64、Rust 1.97.1；工作分支 `rovai/runtime-launch-validation`，基线
`36a0e92cc28819b13a50198e2483bb8ab5c7ada2`。Spec 与 Standards 两轮静态审核已收口。

已通过：

- `pnpm typecheck`、`pnpm test`：Vitest 238 文件 / 2600 项通过；最后一组 Node 测试 334 通过、2 项平台跳过，文档/Skill/隔离 sandbox 检查通过。
- `pnpm test:rust:pr`：默认 workspace 共 453 通过、0 失败、1 项原人工 Runtime smoke 忽略。
- `pnpm build:desktop` 与 `cargo check --workspace --all-targets --features slow-tests`。
- Runtime 定向 owner 回归：359 通过、0 失败、6 项保留原人工环境忽略；真实 Host 验证、默认模型零目录、取消/替换零输入、错误投影及修复后新任务均通过。实际命令如下。
- `ROVAI_FAST_CHECK_ONLY=1 pnpm test:camp-fast-layout`：生产组件、隔离 Electron，零自动检查、手动重试、绑定与迟到响应围栏、共享偏好和原生输入通过。
- Impeccable detector 对修改的界面文件无发现。其 context 工具另报告 4 个既有 brief 的路径过期及未识别的 `desktop` 平台词汇；本切片未改这些仓库资料。
- `cargo fmt --all --check`、`git diff --check`、`pnpm docs:check` 与基于上述 SHA 的 `pnpm docs:check:ci`。

```bash
cargo test -p rovai-core --features slow-tests --lib -- \
  acp:: agent_profile:: antigravity:: camp_fast:: claude:: claude_control:: codex:: \
  context:: delivery_queue:: health:: pi:: runtime:: runtime_discovery:: \
  application::tests::runtime_check_manager application::runtime_check_environment:: \
  application::tests::availability_ application::tests::later_success \
  application::tests::detected_entry application::tests::trae_version \
  collaboration::slow_tests::multi_target_send
```

扩大验证的既有边界：

- `cargo test -p rovai-core --features slow-tests --lib` 初次完整运行未全绿；本切片相关失败经修正后按 owner 重跑。
  下列 4 项数据库/authority 测试在上述干净基线 worktree 独立复现相同失败，本切片保留原测试与迁移实现：
  `authority_migration::tests::macos_provenance_added_after_ticket_is_readmitted_without_losing_business_data`、
  `db::tests::database_contract_preflight_admits_current_and_rejects_future_store`、
  `db::tests::navigation_summary_migration_preserves_tables_backfills_and_rolls_back_with_events`、
  `db::thread_names::tests::thread_upgrade_preserves_existing_tables_and_rolls_back_on_receipt_failure`。
  分别涉及 macOS provenance 再验证、v183 预期值和 `pending_camp_draft_presence` 历史迁移 fixture。
- `cargo clippy -p rovai-core --all-targets --features slow-tests -- -D warnings` 剩余 10 项错误，与同命令的干净基线一致，
  位于 Pi host、CLI output、Context、execution window 和 monitoring；本次新增 lint 已修正，未添加抑制规则。
- 默认完整 `pnpm test:camp-fast-layout` 仍在旧执行过程 disclosure 的 `.open` 断言失败。
  未改生产代码的基线先暴露过期 `camps.members.fast.*` fixture 路由；仅将该 fixture 路由修正为已存在的
  `threads.members.fast.*` 后，复现相同 `.open` 失败。本次 Fast 定向模式通过不代表整套历史布局/Stop 验收通过。

未执行真实 CLI/账户、发布包或 Windows 实体验收。没有变更数据库 schema、提高权限或替换日常 App。

### 2026-10-06：身份读取与文件校验锁边界收尾

按 PR #642 的两项 P2 审查修复 `ff573057` 中残留的健康快照读取依赖和持锁同步哈希。
`verified_executable_identity` 仅绑定 Installation/路径/请求指纹；locator 保留当前安装的重新解析线索，
健康快照缺失、旧指纹或文件身份失效都不隐藏保存的 shim 路径，实际入口依赖仍须复核。
静态发现和 dispatch rebind 共用锁外 blocking worker，文件身份与指纹一致后才取数据库锁提交；
SQL 层只接收私有字段的验证结果。保留搜索环境代次、原子 Installation 更新及真实 Host 输入前验证。

针对性回归使用现有 owner 与隔离 fixture：48 项通过，覆盖新安装、旧快照升级、身份/路径拒绝、
Core 重开、静态扫描不启动 Runtime 和诊断重绑定。新增唯一 Core 锁边界 owner 通过阻塞线程池屏障验证
等待文件校验时仍能执行并行 SQL，不用大文件或 wall-clock 阈值推断性能。Codex 原真实 Host owner
另补并通过销毁 Host 后再次默认执行的场景，`--version` 挂起不影响两次实际协议初始化，且无模型目录请求。
这些是 Core 持久化/重新初始化与合成协议的分层证据，不是发布 App 或真实账户的重启验收。

Windows 既有 shim owner 在 `slow-tests` 下增加目标内容更新、npm platform package 从 hoisted 搬至 nested、
无快照/无文件身份下读取旧 locator 并重新解析的场景。本机不能执行 Windows 测试；尝试
`cargo check -p rovai-core --target x86_64-pc-windows-msvc --all-targets --features slow-tests`
停在 `ring` C 依赖缺少 Windows `assert.h`，未计为编译或测试通过。待 Windows 的最小验证命令为
`cargo test -p rovai-core --features slow-tests --lib runtime_discovery::windows_tests::resolved_npm_shim_content_change_invalidates_locator_identity_and_snapshot_key`。

`cargo check --workspace --all-targets --features slow-tests`、文档两道门禁和格式检查通过。
本轮重新执行 `pnpm test:rust:pr`：453 通过、0 失败、1 项原有人工 Runtime smoke 忽略。
Clippy 与首轮基线比较仍是原有 10 项错误，本切片没有新增 lint、抑制规则或全局健康机制。


## 2026-10-06 Fast 偏好直接应用

- 基线：`0baa74144ba52de257c98656e72b445c9bc43d4e`；分支 `rovai/fast-runtime-preference`。
- 现有偏好表支持首次事务写入，控制投影不读资格/健康；保存、绑定与 Run 冻结沿用原边界。
- 删除 Claude/Codex Fast 专用资格与额外子进程路径，保留通用诊断及真实 Host 的必要验证。
- 控件直接保存三态，原生反馈进入现有 Run Evidence；缺失字段为 unknown、禁用原因经过脱敏，不反写偏好。
- `pnpm test:rust:pr` 通过：workspace 451 项通过、1 项既有人工 Runtime smoke 忽略。
- `extended-tests` 定向 owner 通过：`camp_fast::` 2 项、`claude::` 33 项、`codex::` 22 项及 1 项原有忽略、
  `execution_evidence::tests::` 17 项、`runtime::tests::scheduler_rebinds_one_compatible_runtime_drift_and_preserves_initial_audit` 1 项。
  在既有 owner 中验证三态首次写入、新连接读取、真实进程的新建/恢复与显式模型参数、未知版本零资格子进程、
  明确关闭、拒绝单 Turn 参数后零重放，以及 Run 逻辑窗口可见的脱敏反馈。
- `pnpm test` 最终通过：Vitest 238 个文件、2601 项通过，后续 Node 脚本 334 项通过、2 项平台跳过。
  首轮飞书附件恢复测试超时；该文件独立 81 项通过后，完整命令重跑通过，未改动该模块。
- `pnpm check:rust`、`pnpm typecheck`、`pnpm build:desktop`、`cargo fmt --all --check`、`git diff --check`、
  `pnpm docs:test`、`pnpm docs:check` 及以上述基线运行的 `pnpm docs:check:ci` 通过。
- `ROVAI_FAST_CHECK_ONLY=1 pnpm test:camp-fast-layout` 通过，覆盖真实 Renderer 的双入口、三态、保存并发与迟到回执隔离、
  原生反馈不反写偏好、零资格请求；日夜截图已检查。完整 `pnpm test:camp-fast-layout` 仍在上轮已记录的
  执行 disclosure `.open` 旧断言失败，未修改或跳过该断言，不能算整套布局/Stop 验收通过。
- 未执行真实 CLI 账户、实体 Windows、实际计费或日常 App 安装验收；合成进程与隔离 Renderer 结果不替代这些验证。

## 2026-10-06 Fast 二态与初始化值

- 基线：`4099bc3843eb3b6bdbe51d9bb09c3df2fdc2d347`；分支 `rovai/fast-native-baseline`。
- 保留现有 Thread 队员偏好表、nullable override、绑定代次和 Run 冻结，不改成 Session 级存储。
  真实初始化值复用现有默认列，只用于控件显示；历史诊断 fingerprint 记录不充当原生默认。
- Codex 正常 start/resume 响应读取 `serviceTier`，Claude 正常 control initialize 读取
  `fast_mode_state`；缺失保持内部未知。两者不新增请求、子进程、配置文件解析或正文等待。
- Fast 控件恢复单按钮、固定文字和二态 ARIA，保存明确布尔值。已有选择优先于 baseline，
  保存期间仅初值刷新的投影不能丢掉回执；普通运行观察保持独立。
- 扩展既有 `camp_fast`、Claude/Codex 启动测试及隔离 Renderer owner，不增加框架或独立测试 owner。
  覆盖默认来源、历史诊断隔离、保存/重绑、缺字段继续输入、无额外 RPC/进程及新建/恢复参数。
- `pnpm typecheck`、`pnpm check:rust`、`pnpm build:desktop` 通过；`pnpm test` 包含文档/Skill 门禁，
  Vitest 2601 项通过，末轮 Node 334 项通过、2 项平台限定跳过。
  固定上述 base 的 `pnpm docs:check:ci` 通过。
- `pnpm test:rust:pr` 451 项通过、1 项真实 Runtime smoke 保持忽略；启用 `extended-tests` 的
  `camp_fast::` / `claude::` / `codex::` 定向回归分别通过 2 / 33 / 22 项，Codex 1 项真实 smoke 保持忽略。
- `ROVAI_FAST_CHECK_ONLY=1 pnpm test:camp-fast-layout` 通过，日夜截图已检查；验证二态、初始化值、
  明确关闭、双入口同步及保存期间迟到刷新。未增加或退役 Rust owner。
- 不执行真实账户计费、实体 Windows 或日常 App 安装验收；沿用上一节完整布局测试的已知限制。


## 2026-10-06 Codex Host 失败恢复

基线 `4099bc3843eb3b6bdbe51d9bb09c3df2fdc2d347`，worktree `rovai-ai-codex-host-recovery`，分支 `rovai/codex-host-recovery`。
本次不需要主线先行治理提交；状态与验证以本节和分支最终提交为准。

- `application.rs`：原生终态与业务交付分别判定；成功先做安全释放，失败事务建门禁后交既有 worker；未确认回收不解锁。
- `runtime.rs` / `delivery_queue.rs`：复用现有清理意图、ACK 与 claim 事务；新增内部显式需要清理的终态入口，保留原生来源。
  输入未知的 Codex 失败接入既有 abortive settlement，默认轮换原生绑定。
- `codex.rs`：进程先交 Fleet，再 initialize / account / model 验证；显式释放策略；thread/resume 校验 ID，不隐式回退空 Thread。
- `runtime_fleet.rs`：四种释放结果、迟到检查防止误停后继、停止未确认保留租约/容量；现有 owner record 延长到数据库清理 ACK，
  记录 Run/epoch 与停止回执以支持重启对账。没有新增认证、调度、恢复管理器或后台健康轮询。
- `runtime_failure.rs`：仅可信 Codex 失败对象进入结构化优先分类，认证拒绝不等于未登录。

测试 owner 与准入：扩展 Codex 真实 Host 验证 fixture，初始化/认证/模型失败均断言零正文和已回收；新增假 Runtime
进程测试拥有 warm→失败→换 Host→精确冷恢复的跨进程合同，覆盖失败前/后更新假凭据。原生状态和错误分类矩阵由
小型 parser/policy 测试拥有。复用 Fleet 清理超时及 runtime 未知结果测试，补齐回收回执跨重启的唯一 owner。
Core 并发 seam 测试实际执行终态事务、Delivery claim 和带停止屏障的 Fleet worker，验证已排队输入不被领取，
且无关会话能推进；这一竞态不能仅用纯函数或源码字符串测试证明。

Adapter 审计：

| Adapter | 状态 | 本次结论 |
| --- | --- | --- |
| Codex | 已接入，受控验证通过 | 本次闭环范围；不操作日常故障会话 |
| ACP | 已审计，发现缺口，未接入 | prepare_agent_run_terminal_visibility 在持久终态前释放；多数 Adapter 仍申请 Reusable。ZCode 后台任务归属必须单独处理 |
| Pi | 已审计，发现缺口，未接入 | 失败已有 Stop 路径，但仍以业务输出判断完成且忽略清理结果；需独立接入原生终态策略 |

验证命令与证据（macOS arm64；`slow-tests` 包含 `extended-tests`）：

| 命令 / filter | 结果 |
| --- | --- |
| `cargo fmt --all --check`、`cargo check --workspace` | 通过 |
| `pnpm test:rust:pr` | workspace 452 项通过；1 项现有人工验证按声明跳过 |
| `cargo test -p rovai-core --lib --features slow-tests codex::` | 24 项通过；1 项真实 Runtime smoke 按声明跳过 |
| 同上 `runtime_fleet::` / `runtime::tests::` / `runtime_failure::` | 分别 23 / 34 / 5 项通过 |
| 同上 `acp::` / `pi::` | 74 / 21 项通过；Pi 真实安装 smoke 按声明跳过 |
| 同上 `native_failure_gates_already_queued_input_until_managed_reap` | 已排队输入、暂停回收、无关 lane、ACK 后单次 claim 通过 |
| 同上 `codex_native_terminal_controls_host_independently_of_business_delivery` | 实际回调覆盖 completed 缺少回复、失败、取消、中断、中间 error、旧终态及绑定保留 |
| 同上 `runtime_cleanup_dispatch_is_non_blocking_and_deduplicated` / `cancellation_covers_launch_without_a_handle_and_has_one_total_deadline` | 均通过 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=4099bc3843eb3b6bdbe51d9bb09c3df2fdc2d347 pnpm docs:check:ci` | 通过 |

状态：ready，独立 worktree 保留供后续审查，下一步为人工审阅远程分支；本次不自动创建 PR。
所有 Runtime 测试使用临时目录、受控假进程和假凭据，不访问用户账号，不重启日常 Core/Host。
真实 Runtime 与 Windows 运行验证未执行；不能将夹具成功描述为故障会话已经现场恢复。

## 2026-10-06 Windows owner record 与重启回执修复

基线 `088fbfc1d3772653c0599cc7fb25491002670428`，继续提交到 `rovai/codex-host-recovery`。
平台为实体 Windows 10 Pro 22H2 x64（build 19045），Rust/Cargo 1.97.1。

- 修复 fresh Fleet owner 目录由普通 mkdir 创建、继承 DACL 导致原子私有写入拒绝全部 Host 登记的问题。
  `runtime-fleet/owners` 使用原生私有创建；已准入 Core 根下的旧目录/JSON 只迁移精确继承的 user/SYSTEM ACL。
  更宽 ACL、未知 owner、reparse 和错误类型继续阻断，初始化错误向 Core 返回，不再静默停用持久记录。
- Windows Managed Process 创建私有、不可继承、禁止 breakaway 的唯一全局 Job；Codex owner record 保存 Job 身份
  和进程创建时间。该轮曾以“Job 消失且根实例退出”补齐重启证明；下节记录 2026-10-07 审查发现及修正，
  此旧推导不再作为当前回收准入。不补杀无关进程。
  当前代际的 Codex bounded reap 等待整个 Job 为空，再写回已回收凭据；回执保留到精确 Run/epoch 的数据库 ACK。
- 兼容边界：旧 `reaped=true` 回执继续有效；旧匿名 Job 的未确认 scoped 记录缺少树退出证据，继续保留门禁。
  本次不凭裸 PID 缺失为这些旧记录补造 ACK，不处理日常故障会话。
- 默认 workspace 首轮暴露既有 Claude permission 夹具将 `/tmp/project` 当作 Windows 绝对路径的问题；改用本机
  临时目录下的绝对路径，保留其原生 request/input/approval 全部正向、拒绝与防串用断言，完整命令重跑通过。

测试准入：扩展既有 `scoped_cleanup_receipt_survives_restart_until_durable_ack`，覆盖真实原生进程的重启回执、
同一 Run 的 live/dead 多记录、PID 身份差异、非法/缺失 Job 身份及旧 epoch ACK。扩展既有 Job 孙进程与 Core
强杀 owner，证明可重新查询的生命周期。新增 `windows_owner_registration_admits_only_private_or_legacy_inherited_storage`
拥有独立的私有目录/旧 ACL 迁移 seam；纯策略测试不能证明生产 Fleet 准备全部父目录、成功私有写入及保留旧回执。
全部进程/文件 fixture 隔离在临时目录，新增 owner 属于 `extended-tests`，没有新增真实账号 smoke 或重复数据库 fixture。

| 命令 / owner | Windows 结果 |
| --- | --- |
| `cargo test --workspace` | 492 项通过，8 项按声明忽略 |
| `cargo check --workspace --all-targets --features slow-tests` | 全部目标编译通过 |
| `cargo test -p rovai-core --features extended-tests --lib runtime_fleet::tests:: -- --test-threads=1` | 23 项通过，含两处缺陷的回归 |
| 扩展 libtest `managed_process::tests::windows_` / `codex::tests::` / `runtime_failure::tests::` | 分别 12 / 21 / 5 项通过；7 个子进程 helper 和 1 个真实账号 smoke 按声明忽略，helper 由 native owner 显式调用 |
| 扩展 libtest 的 Runtime loss/provenance、startup accepted-unknown、network no-replay 与两个 Delivery cleanup gate owner | 6 项精确用例通过，保留 ACK 前门禁及跨 execution-root 隔离 |
| `cargo fmt --all --check`、`git diff --check` | 通过 |
| `pnpm docs:test`、`pnpm docs:check`、以上述修复基线运行 `pnpm docs:check:ci` | 通过 |

本节补充上一节的 Windows 证据；未运行 Windows 11、真实 CLI 账户/计费或日常 App 验收。
当前修补不扩大 ACP/Pi 的原生终态接入范围，也不把受控进程验证描述为用户已有故障会话已经恢复。

## 2026-10-07 Windows Job 回收证明修正

基线 `396c6a01ba1b5594f83e26827f5163238d76bbfe`；User 授权修复、创建 PR 并合入 main。
先合入主线 `520320a8`，保留原生 API 配置与 Fast 初始化改动；主线已使用 Runtime Launch v48，
因此 Codex Host 恢复增量顺延至 [v49](../../contracts/runtime-launch-and-verification-v49.md)，继承完整 v48。

- 删除“Job 名称不存在时查询根 PID”的捷径。Windows 原生 CI 随后在持有同一孙进程 handle 的条件下
  复现 `ActiveProcesses=0` 先于 handle signaled（run `37495892005`，提交 `cd25153a`），因此也撤销
  “重新打开空 Job 即可证明回收”的推导。跨 Core 只接受已有精确 Run/epoch 的持久回执。
- 当前 Windows Managed Process 在空 Job 上绑定私有 IOCP，按去重成员通知保留进程 handle；全部确认退出后，
  最后核对 Job 生命周期总成员数与活跃数，才允许既有 `tree_is_empty()` 成功。丢通知、重复 PID 少计、
  查询未知均保留门禁；通知读取与成员核验均有单轮预算。只增加本 owner 的退出证据，不新增恢复管理器或后台轮询。
- 扩展既有 Fleet receipt owner：即使真实 Job 可查询为空，未持久回执时仍未确认；owner 确认退出并持久回执后，
  关闭 handle 再重启仍可精确 ACK。缺失 Job、根仍活、PID 不存在与复用均不能补造回执。
  既有 Managed Process 孙进程 owner 保持精确 handle，增加首次观察后创建后代、丢成员通知、重复通知与
  非法通知后再次轮询的负向断言；强杀 owner 的实际退出与跨 Core 可用证明分别由两层 owner 验证。
  没有新增或退役 Rust 测试。
- 手动 Full check 增加 `windows-runtime` scope 复用既有 Windows job；显式运行 extended Fleet/Codex owner，
  不以 default-feature 过滤到 0 项的结果替代跨平台验证。

最小定向命令为 `cargo test -p rovai-core --lib --features extended-tests runtime_fleet::tests::`、
同参数的 `codex::tests::`，以及 `cargo test -p rovai-core --lib managed_process::tests::windows_`。
后者仅 Windows 有有效用例；Unix/macOS 限定的冷恢复、初始化零正文与两条 Core 集成用例在 macOS 独立执行。
本轮 macOS 验证：默认 workspace 455 项通过、1 项真实 Runtime 按声明忽略；slow-tests 下 Fleet 23 项、
Codex 24 项通过（另 1 项真实账号 smoke 忽略），两条 Core 原生终态／已排队输入门禁 owner 各 1 项通过。
`cargo check --workspace`、format、文档单测 10 项与以 `520320a8` 为 base 的全部文档门禁通过。
Fleet/Codex 采用独立 CI step，避免 PowerShell 后续成功覆盖前一失败码。Windows 新增句柄边界修正的
两路静态复核已通过；追加修正后 workspace 编译、Fleet 23 项、format 和全部文档门禁再次通过。
上列默认套件、Codex/Core 的 macOS 数量属于追加 Windows 句柄修正前的验证，不冒充后续原生结果。
Windows 原生运行结果归档于 [PR #652](https://github.com/murray17/rovai-ai/pull/652) 的检查记录；
既有 Windows 10 的 492 项结果只覆盖上一节提交，不能代替本轮修复。本轮不运行真实账号或日常 App。

## Member CLI 最小增量

- 工作分支 `rovai/member-cli`，复用独立 worktree；提示词 r1 的确认消息为 `d283c49e-6894-4274-a584-ce449b544d44`。
- 仅 list/get/update；封闭读取、事务内 PATCH、文字与资产引用原子提交，create 及 Single Chat allowlist 保持。
- 无持久字段扩展：现有创建快照支持同 Thread 原创建者；requestId 显式传递解决重启 CLI 的重放身份；现有复合资产保存与 Run tmp 生命周期复用。
- 内置 portrait 原先只在 renderer AVIF 包中，Core 无法读取或复用 PNG/JPEG 裁切流程；最小补充为同源 PNG 编译资源，不增加运行期解码依赖或资产服务。
- 最终集成基线 `5421fed778fcdd62f3b2c0e7f517a6e3e2b86c51`；同步上游仅解决版本概览文本冲突，保留并行工作的记录。
- `pnpm test:rust:pr`：454 项通过、1 项原有 Runtime smoke 忽略；`cargo fmt --all --check` 通过。
  定向回归全部通过：`member_` 18 项、租约生命周期 2 项、Bootstrap/冻结补发/新 Session 4 项。
- 重建 CLI 的根帮助与四项 member 帮助、Bootstrap 资源、cli-operations 正文均与 r1 逐字一致；
  独立 tmp 中的 stdin/输入文件封闭拒绝行为一致，不连接日常 Core。
- 文档测试 10 项、Skill 测试 3 项及 12 项 Skill 校验通过；`docs:check` 与以上述基线运行的 `docs:check:ci` 通过。
  Standards 与 Spec 独立复核的代码问题均已关闭，完整记录见[实施证据](model-context-change-member-cli.md#2026-10-06-实施与验收记录)。
- 真实任务 Gate：等待具体 Runtime/model 与固定快照 Judge 配置，尚未运行或声明通过；不沿用其他工作项的豁免。

- 复核修正：列表沿用 `member_order,id`；图片更新复用创建流程的请求绑定不可变资产。原 Run 源文件消失后先匹配既有领域回执，未提交请求仍拒绝；源文件存在时验证规范化内容，避免同路径换图被租约缓存吞掉。无新表或第二份请求结果。
- 后续复核修正：等价 source/crop/icon 保留原引用和版本；有持久回执时只验证准备资产，缺失或损坏不得重新发布该资产 ID。两项均在原 PATCH owner 中补回归。
- User 针对 `c069b3f5` 的追加复核确认两项 P2：Lead 为 null 时列表报错；相对图片路径在 Core cwd 下解析。
  扩展原 Member 与 CLI owner 后均先复现失败；修复使用 SQL `COALESCE` 与 CLI 三路共用出口的绝对路径转换，
  不自动任命 Lead，不提前检查图片是否仍存在。隔离的双进程 IPC 夹具在不同 cwd 各放一张不同内容的同名 PNG，
  直接参数、JSON 文件、stdin 修复前均选中接收端图片，修复后均选中调用者图片，请求 ID 保持一致。
  本夹具证明实际 CLI 的输入／IPC 边界，不冒充真实 Core/Runtime 或模型 Gate。
- 追加修复后：Member 18 项、CLI 29 项、默认 workspace 454 项通过，原有 1 项 Runtime smoke 仍忽略；
  格式、文档测试 10 项、文档治理及提示词／帮助逐字对照通过。没有新增或退役 Rust owner。

- 2026-10-07 按 User 追加要求统一文件语义，取代上一阶段的 CLI cwd 方案：CLI 保留原始
  `avatarFile`，Core 认证 Run 后使用现有 `agent_file_ingress_scope` 读取冻结的 `execution_root`。
  create/update 共用输入入口，绝对路径原样保留；与 Agent 附件共享纯路径 helper，既不 canonicalize
  也不提前检查文件存在性。头像仍即时导入 immutable asset，无新增字段、授权／幂等机制或附件记录。
- 定向验证：Member 18、CLI 29、附件 5 项通过，沿用原测试 owner。隔离 CLI IPC 夹具覆盖
  create/update × 直接参数／JSON 文件／stdin × 相对／绝对路径共 12 种组合，路径和命令身份原样传输；
  Core 入口与真实 SQLite fixture 的两个 owner 另在隔离子进程 cwd 下执行，同名 PNG 内容不同，
  最终导入的像素来自冻结 Run 根目录。此证据不等同于真实 Core/Runtime 端到端或模型 Gate。
  失效 epoch／缺失 workspace 拒绝、绝对路径不变、symlink 拒绝和缺失源回放均已覆盖。
  Bootstrap、Skill 与 CLI help 继续逐字符合已批准文本。
- 本轮最终默认 workspace 回归：454 项通过、1 项既有 Runtime smoke 忽略；格式、文档测试 10 项及
  diff-aware 文档治理通过。没有新增或退役 Rust owner；真实模型 Gate 仍待配置和验收。

- 2026-10-07：User 在已收到 Gate 缺口说明后，通过消息
  `10a0a3f7-2d2b-478f-bb99-6726b07d37cb` 再次明确要求“pr main merge”；据此推进本项交付，
  真实模型 Gate 保持未运行，不记为通过。已合入主线 `520320a8`；版本概览冲突保留 Member CLI
  与 Runtime 探测修复两段记录，未改动后者的实现或验收结论。
- 合入 `520320a8` 后最终验证：默认 workspace 454 项通过、1 项既有 Runtime smoke 忽略；
  扩展 Member 18 项、租约 2 项通过（均先确认非空清单）；重建 CLI 后 12 种文件输入组合、
  封闭输入拒绝与已批准 Bootstrap／Skill／help 逐字对照通过。格式、文档测试 10 项、Skill 测试 3 项、
  12 个 Skill 规范检查和以该 main SHA 为 base 的通用文档门禁通过。
- 独立复核：Spec 未关闭问题 0 项；Standards 的当前版本文档漂移修正并复核后，未关闭问题 0 项。
  复核与上述确定性检查不代表真实模型 Gate 通过；按已记录的 User 后续合并指令推进 PR。

## 2026-10-07 设置保存仅本地提交

基线 `3acf1f28`（已包含主线 `921e37e1`），工作分支 `rovai/local-settings-save`。
按 User 的保存流程说明新增 [Runtime Launch v51](../../contracts/runtime-launch-and-verification-v51.md)，
继承原生文件归属和安全写入；这是可逆的操作链调整，没有新增配置存储或架构决策。

- `runtime.startup.save` 移除 shell 捕获、程序扫描、全 Runtime discovery 和 Codex 模型元数据子进程。
  自动入口只使用已有发现或独立 Owner 读取确认的进程内记录；PATH 改变或入口未知时不猜测写入目标。
  这份可失效的入口记录不持久化、不拥有连接配置或凭据。模型文件使用已有原生目录或已包含的
  兼容默认结构，保留隐藏元数据、未知字段、字段 CAS、目录修订和凭据 Keep/Replace/Clear。
- 保存回执（包括冲突最新值）不携带完整 Key；表单从回执更新基线和完成状态，只保留编辑器已有的、
  来源及版本匹配的 Key 或本次替换值。移除父组件 reload 与保存触发的来源 observation，迟到读取不得
  覆盖已提交字段；同时选择来源与编辑连接时，只提交启动选择并保留尚未提交的连接草稿。
- 环境捕获及发现文件校验移至提交锁之外，发布时核对代次并合并最新配置；保存仅更新本地修订与失效标记。
  不重启或取消已有 Host/Run，后续执行继续使用原有配置快照兼容检查。

测试准入与退役：新增 slow owner
`application::runtime_check_environment::tests::local_saves_finish_while_environment_capture_is_held_and_never_launch_work`
独占“环境捕获尚未完成时保存仍可提交”的交错；修复前保存会等待同一提交锁，或补跑环境/CLI/发现。
已有 probe-race owner 的屏障发生在环境捕获之后，无法覆盖这一失败窗口；必须通过隔离 Core、SQLite 和
真实 RPC handler 验证锁与提交边界，纯函数测试不足。一个 owner 表驱动覆盖两种 Runtime 的 URL、Key、模型、
环境和程序选择，并核对旧快照失效、无发现发布、无额外捕获、回执脱敏和迟到刷新保留新配置。
最小命令：`cargo test -p rovai-core --features slow-tests --lib application::runtime_check_environment::tests::local_saves_finish_while_environment_capture_is_held_and_never_launch_work`。

扩展已有 `discovered_runtime_verification_keeps_database_available_and_identity_after_restart`，通过阻塞唯一
文件 worker 验证生产 discovery 发布既不占数据库锁，也不占保存提交锁。改写原环境读取失败 owner 为保存
不依赖失败 reader。删除 `native_resource::tests::selected_wrapper_reads_local_catalog_without_resource_fingerprints`：
其唯一生产路径（保存时启动 CLI 读取 bundled catalog）在本次退出，没有保留永久禁用测试。模型本地转换与
未知元数据保留继续由 `codex_catalog::tests` 及 `runtime_custom_api::tests` 拥有。新增一个、删除一个 Rust owner，
其他变化扩展原有 owner；前端在原 Electron fixture 验证请求计数、回执屏障、失败/冲突草稿及 Key 三态。

本轮验证（macOS arm64）：

| 命令 / owner | 结果 |
| --- | --- |
| `pnpm test:rust:pr` | workspace 455 项通过，1 项既有真实 Runtime smoke 按声明忽略；包含原生 fixture example 编译 |
| slow-tests 的 `application::runtime_check_environment::tests::` | 4 项通过，包含环境屏障、旧 probe 隔离、未知自动目标拒绝、独立读取后的入口复用和 PATH 改变后失效 |
| slow-tests 的 `runtime_custom_api::` | 4 个 owner 通过，覆盖配置格式、来源权限、凭据三态、字段冲突、未知字段、目录元数据和写入回退 |
| discovery 文件 worker 锁 owner / `runtime_fleet::tests::warm_hosts_never_cross_camp_compatibility_keys` | 各 1 项通过 |
| `pnpm test` | Vitest 238 文件、2,603 项通过；Node 主脚本集 334 项通过、2 项 Windows 用例在 macOS 跳过；文档、Skill、sandbox 子集均通过 |
| `pnpm typecheck`、`cargo fmt --all --check`、`git diff --check` | 通过 |
| `ROVAI_KEEP_CUSTOM_API_FIXTURE=1 node --test scripts/lib/runtime-custom-api-ui.test.mjs` | 隔离 Electron fixture 通过；人工查看窄屏与保存回执截图，原有日夜主题和表单布局保持 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=921e37e1 pnpm docs:check:ci` | 干净工作树通过；未修改主工作区被 Git 忽略的原型稿及其过期链接 |

JavaScript 全套与文档门禁在仅含受版本控制文件及本次补丁的临时工作树执行，复用既有依赖，关闭 pnpm 的
自动依赖安装；未删改依赖或为文档检查添加例外。Core/Rust 和 Electron 定向 fixture 在原工作区执行，
数据均来自临时目录。未运行真实 Provider/账号 smoke、Windows 原生验收或更换当前日常 App。

## 2026-10-07 智能体状态文案精简

- 按 User 要求，入口存在的状态显示为“可用”，删除执行验证说明与检查成功后的重复提示行；
  检查失败、延后及登录/安装入口保留。仅调整 Renderer 展示，不改变 Core 检查或启动语义。
- 分支：`rovai/runtime-status-copy`；worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-runtime-status-copy`；
  基线：`921e37e1`；无需独立治理前置提交。状态为 ready，下一步按 User 指令创建 PR。
- TypeScript 检查、相关 Renderer 测试 54 项、桌面构建、文档治理及默认 Rust workspace 回归通过；
  Impeccable 机械检查无发现。沿用既有状态测试，没有新增 Rust 测试或界面测试文件。
- 生产目录组件在隔离 Electron 中通过日夜主题、1440×920、1040×700 与 200% 缩放检查：
  成功检测无提示行，失败/延后仍显示错误，成功重试清除旧错误，页面无横向溢出。
- 完整 `test:settings-workspace` 在进入未修改的连接编辑页时失败：夹具初始 `startup` 为空，
  `runtime.startup.observe` 返回 undefined，触发 `connectionReadError` 读取异常；本轮目录专项通过
  不代表完整设置页回归通过。截图及专项运行脚本保存在本次 Thread 的 `runtime-status-copy` 附件目录。


## 2026-10-07 移除自定义 API 配置

基线 `a5e202ab`，分支 `rovai/remove-custom-api`；已整合原本的本地保存修复及主线 `f67682c8`。
按 User 明确取消要求执行 [Runtime Launch v53](../../contracts/runtime-launch-and-verification-v53.md)。

- 移除 Claude/Codex 官方/API 单选、连接登录状态、URL、Key、模型映射及模型列表；普通启动设置保持。
- Core、Desktop 与 Web 均退出 `runtime.startup.observe`，封闭输入拒绝旧连接补丁和 `apiKey/customApi`。
- 删除原生写回、迁移、认证切换、目录生成及辅助账号/来源进程；没有修改用户已有文件或凭据。
- 原生 `model/list` 与能力继续拥有模型选择，移除编辑器的二次过滤；不实现此前取消的推理强度 fallback。
- 历史冻结快照解析、只读原生来源摘要、Host 兼容与输出脱敏保留；没有新增数据表或模型上下文。

Rust 退役清单（生产写路径与合同在同一改动退出）：

| 原 owner | 处理与保留边界 |
| --- | --- |
| `configuration_rejects_ambiguous_connections_and_preserves_optional_models` | 退出 API 表单校验；普通字段及旧请求拒绝由 `runtime_startup::tests::environment_validation_preserves_values_and_rejects_ambiguous_or_reserved_names` 拥有 |
| `native_editor_reads_without_writing_merges_fields_and_never_copies_credentials` | 替换为 `startup_saves_preserve_native_files_and_merge_only_local_preferences`，沿用 SQLite fixture 验证 CAS、合并、提交失败、隐藏旧凭据及原生文件不变 |
| `native_sources_keep_environment_references_and_replace_only_the_selected_connection` | 替换为 `native_sources_are_read_only_and_keep_secrets_out_of_snapshots`，保留文件/环境/命令/AWS/云认证来源、无执行读取、脱敏、解析错误、symlink 身份与冻结兼容；原生替换/迁移 case 随 writer 退出 |
| `native_catalog_preserves_internal_entries_and_unknown_ids_use_only_native_defaults` | 原生目录生成生产路径退出，不再为此功能生成目录 |
| Windows `windows_native_edits_preserve_acl_and_guard_publication` | 原生写回/ACL 发布生产路径退出；通用私有存储与 Windows 平台测试保留 |

上述模块可执行 owner 从跨平台合计 5 项收窄为 2 项；不是删除当前 Migration、权限、恢复或脱敏合同。
Core 阻塞环境读取、正式检查代次与本地保存 4 个 owner 原位保留；profile 冻结/重绑定 owner 保留。
API 专用 UI/CLI fixture 退役，启动页 UI 回归由既有 settings-workspace fixture 继续承担；更新其本地提交 mock，
并修正 About 页已更名的链接选择器，未改变 About 产品代码。

已完成的定向验证：

- `pnpm typecheck` 通过；启动草稿、队员参数、Main 白名单 3 个 Vitest 文件共 39 项通过。
- `runtime_custom_api::` 的 2 个保留 owner（extended-tests）、Core 环境与保存的 4 个 owner
  （slow-tests）、profile 冻结/重绑定 1 个 owner（slow-tests）均实际执行并通过。
- 完整 `test:settings-workspace` 通过；两种启动页均无 API 入口，保存只发送一次本地请求。
  独立 Electron fixture 使用 `/var/folders/pm/zmpfxggd0glcm8vx3p3y3mmr0000gq/T/rovai-settings-workspace-test-Yv9gdQ/user-data`，
  Skill Library 为其 `managed-skill-library/`，不启动 Core 或真实 Runtime。
  已检查日夜主题、1040×700 与 200% 截图，Impeccable 机械检查无发现。

完整回归与治理：

| 验证 | 结果 |
| --- | --- |
| `pnpm test:rust:pr` | workspace 453 项通过；1 项既有真实 Runtime smoke 按声明忽略 |
| `pnpm test` | Vitest 238 文件、2,602 项通过；Node 主脚本集 334 项通过、2 项 Windows 用例在 macOS 跳过；文档、Skill、sandbox 子集通过 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=f67682c8 pnpm docs:check:ci` | 通过，未增加治理例外 |
| `cargo fmt --all --check`、`git diff --check` | 通过 |

完整 JavaScript 与文档门禁使用提交 `9e09d4b1` 的临时 detached 检出
`/private/tmp/rovai-remove-api-verify-9e09d4b1`，复用既有 `node_modules` 并关闭自动依赖安装，
不共享 Rust target、不修改主工作区被 Git 忽略的原型稿及其过期链接。
主开发目录仍为 `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai`，分支 `rovai/remove-custom-api`；
验证检出没有独立变更，收尾时移除，任务分支保留并推送。没有运行真实 Provider/账号 smoke 或 Windows 原生验收。

打包与非终止安装交接：

- `pnpm package:mac:daily` 通过，App/Core/Host/CLI 的 arm64 架构与 ad-hoc 签名门通过；安装代码为 `9e09d4b1`。
- 真实打包 App 在 `/private/tmp/rovai-remove-api-packaged-zqq2egic/user-data` 完成独立验收，
  Skill Library 为其 `managed-skill-library/`；核对实际数据库路径、两种启动页入口移除、
  普通环境变量本地保存、回执字段和旧 `apiKey` 输入拒绝。验收实例已关闭，没有启动真实 Provider Run。
- 安装到 `/Applications/Rovai AI.app`，源、暂存、最终目标三处安装验证通过。
  旧版备份为 `/Applications/Rovai AI.backup-before-remove-custom-api-20261007-9e09d4b1.app`，保留不删除。
- 日常 App/Helper/Host PID `39161/39165/39166/39167/39168` 安装后均存活，日常数据未改动。
  新版本已安装，当前会话仍运行旧版；退出后应从规范安装路径显式打开新版，不从备份启动。


## 2026-10-08 Cline 原生认证简化（User 89）

- 删除 `cline_hub/auth.rs` 的认证选择/白名单/字段准入/Provider 投影与 `NativeAuthLease`。
- Hub 与显式登录统一直引原生源，保留普通环境；账号与 BYOK 均按 Fleet 复用、回收及并行。
- 当前 Provider 的非挥发配置参与兼容性；缺可读账号标识不阻断，轮换及无关 Provider 更新不重绑。
- 登录 completed 改为原生命令流程完成；零模型检查 authenticationStatus 保持 unknown。
- 原生匹配回复 `ok:true / finishReason:error` 也进入已有脱敏错误分类，输入不重放。
- 代码、真实负例、账号 warm/双成员并行、BYOK 和 App 结果见
  [本轮报告](../../research/cline-runtime/native-auth-warm-parallel-2026-10-08.md)。
- 无 schema 或其他 Runtime 改造，保留 Preview；首次完整授权、真实刷新和外部并发刷新未验证不再封禁普通执行。

## 2026-10-08 移除 Core legacy heartbeat

用户授权范围为完整迁移消费者并删除全局 500ms 循环，保持既有事务、执行、恢复和渠道重试语义。
替代入口、保留计时器、测试 owner 和实际结果统一记录在[验收记录](heartbeat-removal-verification.md)。
普通 batch Scheduler 的 claim owner 与 30 秒恢复入口继续保留；没有新增通用 Job 表、事件总线或持久状态机。

## 2026-10-08 取消普通执行默认 24 小时上限

- 基线为 heartbeat 移除提交 `3e6c22fc`，任务分支 `rovai/unbounded-default-execution`。
- 公共 `freeze_camp_turn_execution_budget` 对缺省预算与显式 null 均冻结为 schema 2、无 deadline；
  有限时长保持请求值，正数、时长范围和截止时间溢出仍拒绝。Run/A2A 数量限制继续使用原上限。
- 核对生产创建路径：Single Chat 直接发送与 Pending 发布共用 `admit_single_chat_message`；
  普通 batch 消息及其排队发布不创建 CampTurn 预算。没有其他入口补回普通 24 小时默认值。
- 历史 migration 的 86,400 秒常量改名为 `LEGACY_EXECUTION_ELAPSED_SECONDS`，数值与迁移逻辑不变。
  不新增 migration、不改写历史或已冻结预算。Automation、评测显式策略及操作超时不变。
- `process_execution_budgets` 生产逻辑没有修改：继续等待有效 deadline；没有 deadline 时仅等通知。
- 测试扩展既有 owner，没有新增独立测试：公共预算 owner 验证缺省/null、两天时长、数量上限与溢出；
  Single Chat 发送、私有终态和 FIFO owner 验证新 queued/running Run 推进两天仍无时间取消；
  FIFO fixture 的显式两天预算在一天未到期、两天时结算并隔离 Run 一次；原 driver 空闲 owner 在 active
  schema-2 Turn 下验证两天内任务 poll 与 SQLite VM 操作均无增量。原手动停止、恢复、取消、Automation 超时和
  v47 历史迁移 owner 用作回归。
- 隔离回归通过：`pnpm test:rust:pr` 453 项通过、1 项既有真实 Runtime smoke 按声明忽略；
  `cargo test -p rovai-core --features slow-tests --lib <owner>` 覆盖公共预算 3、Single Chat 9、driver 2、
  Automation 9、Runtime 34、legacy execution budget 2、Camp Open 3，共 62 项；额外使用
  `--features legacy-migration-tests` 运行 v47 冻结 owner 1 项，总计 63 项不同定向用例通过。
  所有定向命令先核对 `-- --list` 非零，重复回归不重复计数。
- `node --test scripts/lib/qualification-evaluation.test.mjs` 22 项通过；`pnpm docs:test` 10 项通过；
  `cargo fmt --all --check`、`git diff --check` 通过。
- 文档门禁使用同基线、包含完整改动的干净验证 worktree，执行 `pnpm docs:check` 与
  `DOCS_BASE_REF=3e6c22fc pnpm docs:check:ci`；日常工作区的本机原型保持原样。
  仅使用隔离测试 fixture，不启动日常 App 或真实模型；48 小时推进使用确定性测试时间，并非实机连续运行两天。


## 一键草稿邀请队外队员

- Work item：Pending Composer outsider invitations；User 2026-10-08 已确认实现、PR 与合入 main。
- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-pending-composer-invitations`。
- Branch：`rovai/pending-composer-invitations`；Base：`a77b537d59d7cc8c01d520d9fd1d0174a194e1e7`；Governance：none（同 PR 同步当前权威）。
- Status：ready；前端复用候选/提示，Pending 首发直接提交，Core 复用成员写入并用局部 savepoint 撤销业务拒绝。
- Rust 新增唯一 owner `collaboration::pending_invitation_tests::pending_invitations_commit_with_first_message_and_roll_back_every_failure`：
  修复前当前 inline 入口拒绝队外 Atom；既有 legacy Draft 激活 owner 无法覆盖这一入口。此 owner 拥有成员与首发布
  的跨表原子性，需隔离 SQLite 来证明业务拒绝、SQL 错误、presence trigger、回放和串行首发竞争；归入 `extended-tests`。
  最小命令：`cargo test -p rovai-core --features extended-tests --lib pending_invitation_tests`。没有删除或停用 Rust owner。
- Renderer 验收使用生产 ThreadWorkspace 与隔离 Electron transport，覆盖候选、失败保留、本机恢复、成功清空、Active 邀请顺序；
  不启动 Core 或真实 Runtime。事务事实由上述 SQLite owner 拥有。
- 规格审查发现成功回执早于名册投影时会丢失续发目标，已修复并补回归：延迟 Active 投影时先清空、保留 continuation，
  输入、清空、离开及重挂载不再写 Pending presence/discard；投影前阻止误发，投影后无 @ 续发仍指向新队员。
  激活事实只按成功回执在 transport 生命周期内缓存，不复制成员权威，也不修改本机持久格式。
- Validation：`pnpm typecheck`、`pnpm test`（Node 334 通过、2 项 Windows 跳过）、
  最终 `pnpm exec vitest run`（238 文件、2606 项通过）、
  `cargo test --workspace`（455 通过、1 项既有忽略）、上述定向 Rust owner（1 通过）、
  `cargo test -p rovai-core --features slow-tests --lib collaboration::slow_tests::`（46 通过）、
  `pnpm test:composer-input`（28 项既有编辑用例 + 新增生产 Composer 流程）、`pnpm build:desktop`、
  `DOCS_BASE_REF=a77b537d59d7cc8c01d520d9fd1d0174a194e1e7 pnpm docs:check:ci` 全部通过。
  同步 main `7f1562f3` 后完整 Rust、JavaScript、类型、构建与文档门再次通过；最终文档 diff 基线为该提交。
  隔离 Electron 验收覆盖 1040×700 日夜主题及键盘选择；未调用真实模型，也不宣称 Windows 真机验收。
- Next：review、推送 PR、CI 与合入后清理。

## 2026-10-08 Cline 官方 ACP 与 Hub 完整退役（User 95）

- 接回共享 ACP Client/Host/Fleet、诊断、事件、权限、load 重放隔离与工具解码；无版本或认证字段门槛。
- 删除 Hub 模块、类型、WebSocket 依赖、登录 UI/IPC、全部 Hub/shim 实验入口；Pi 结算与共享进程能力保留。
- 原生认证源直引，无凭据副本。冻结 Bootstrap 使用成员 Host 不可变原生文件 Rule，普通 warm 和并行不依赖认证类型。
- 旧 Binding 按共享不兼容替换，公开历史及原生历史保留，旧输入不自动重发。
- 当前安装 3.0.3 广告 loadSession 却返回 -32601；cold 真实验收不通过，不能沿用 Hub 结论。
- 合同/Architecture/Context/当前导航已更新，历史报告固定退役前复现链接；当前验收见
  [ACP 退役报告](../../research/cline-runtime/acp-retirement-2026-10-08.md)。后端切换不改变其他 Runtime 合同；主干分叉数据由 186/187 汇合到 schema 137，current_version 不变。

## 2026-10-08 主干 schema 135 与 Preview 合流

- 保留 main 的 Mission 原子保存、结构化提及、Pending 首发邀请和续做修复。
- Migration 184/185 的双来源由完整 schema 识别，186 汇合 Runtime catalog/续做，187 保留或回填 Mission 描述到 schema 137。
- 扩展已有 `runtime_catalog_migrations_preserve_rows_and_roll_back_with_their_receipts`，覆盖 main/135 结构化 Atom、部分结构拒绝、失败回滚和重开库；保留 Mission 描述及 continuation 的原 owner。未新增平行测试体系。
- 主干 Runtime Launch v53 和 D17/D18 保留原编号；本分支决定顺延 D22–D30，现行后端由 v54/D30 拥有。

## 2026-10-08 官方 ACP 切换交付

- 最终实现 `9b8fa131`：共享 ACP 69 项、Fleet/Pi/进程与迁移 owner、Rust workspace/all-feature 编译、前端类型及 2611 项测试通过。
- Windows runner 对该提交执行 workspace/all-targets 编译通过；macOS arm64 App 签名与真实账号/BYOK 主路径通过。
- 打包账号 6 成功 / 1 预期取消，独立双成员并行、同 Host warm、审批与取消后继续成立；BYOK 打包 first/warm 两轮通过。
- 无凭据诊断返回原生 authentication_required，未自动登录。3.0.3 load 广告与实际不符仍是明确 native cold 缺口，ACP compact 不宣称修复。
- 最终边界、负例、真实/模拟验证区分和公开证据见 [ACP 退役验收](../../research/cline-runtime/acp-retirement-2026-10-08.md)。PR #662 更新后保留未合并。

## 2026-10-09 headless 候选与最新主干合流（User 101）

- headless 显式 A→B→A 同 Session 与 System Mod 已由实际 1.66.0 和官方 1.79.1 对照验证；
  普通写入仍受原生 print permission gate 阻断，生产保持 ACP，不把全权限 Mod 实验冒充普通审批。
  真实 BYOK 四次成功、一次预期取消及无模型覆盖的差异见[专门报告](../../research/command-code-runtime/headless-resume-2026-10-09.md)。
- 合流 main `81f8b1fc`，保留 Mention v33、DSH 原生/Web 模型来源与 Windows Job 当前活跃数清理。
  共享 ACP 同时保留本分支 Session permissions 和 DSH 来源字段，Cline 保持隐藏。
- 保留主干 D19–D21；本分支当前版本决定顺延 D22–D31，仅调整追溯链接，不改变已接受的语义。
- 两种 receipt 187 按真实格式识别，189/schema 139 收敛；原有 184–188 兼容与收据保留，
  既有 Mention 迁移 owner 扩展两种来源、部分结构、失败回滚及冻结证据保留。

本地合流验证：默认 Rust workspace 465 通过／2 人工 Smoke 忽略，共享 ACP 69 通过／2 人工 Smoke 忽略，
Claude 34、DSH 5 与模型目录 owner 通过。前端类型、239 文件／2615 Vitest、339 Node 测试、文档门禁
及桌面构建通过。Mention 两来源／回滚／旧收据保留与修正后的 v104/v105 fixture 定向通过。
这些检查不新增 headless 产品准入，也不代替 Windows runner 或真实打包模型验收。


## 2026-10-09 headless 退役与两个 ACP 暂缓公开（User 105）

- 删除 Command Code headless Rust transport/activity、五个专属 Rust owner、两份 Python 探针及模型对照中的 print 请求；ACP/RPC 探针继续保留。
- Cline 与 Command Code 官方 ACP、System Rule/Mod、权限、工具、恢复、共享 Fleet/进程及历史身份保留；Command 撤回 macOS arm64 Preview，与 Cline 一样全平台 NotQualified。
- 可见目录统一隐藏两者，覆盖设置、新手引导、队员/Skill 选择、安装引导和监控筛选；保留既有 Run/用量标签与配置，无数据库迁移。
- 已知缺口分别记录于兼容性清单与两份研究索引。已删代码链接固定到 `2b9a2dbaf8d4312c2f539c91a1aa500c1e5c279e`，失败证据未删除。
- 本轮不发送真实模型请求，不升级 Runtime、不运行 headless、不恢复 Hub，不触碰用户凭据或原生历史。
- 首轮验证：Rust workspace 462 passed / 1 个人工 Smoke ignored；相关 Renderer 5 文件 213 项、TypeScript、两个 System Hook Node 测试、文档 10 项及版本/治理门禁、格式检查通过。
- 合流 `3a83b2b7`（DSH 目标模型思考选项）时保留两套独立语义：Cline/Command 原生默认哨兵与 DSH 目标选项；没有扩大 headless 范围或恢复公开入口。
- 合流后前端 239 文件 / 2615 项、typecheck、共享 ACP 69 passed / 2 个真实 Smoke ignored、Command 专属 1 项、Cline 专属 3 项、Adapter 25 项通过；桌面/Web 构建和隔离 Electron Runtime Picker（实际菜单隐藏、键盘、IME、双主题/尺寸、DSH 目标选项）通过。
- 扩展平台证据 owner 首次发现兼容清单新增说明后摘要未同步；按原合同更新当前 register digest，不增加任何 Runtime 的资格，随后复验。用户凭据、原生历史与日常安装没有改动。
- `562e1bb4` 的默认 workspace 462/1、平台 5 项、CI 与 Windows all-targets 编译通过。检查期间再次合流 main `2256db53`，保留后续 DSH 能力缓存与图片菜单修复；最新合流的默认 workspace 462 passed / 1 ignored、前端 239 文件 / 2616 项、typecheck、文档门禁、桌面构建及隔离 Electron Runtime Picker 复验通过。最终 CI 与 Windows 编译以 PR 当前提交回执为准。


## 2026-10-10 两个隐藏 ACP 与最新主干合流

合流 main `0a7e183c8`，保留内部续做请求、DSH 目录迟到响应处理、macOS 进程退出修复及 v0.4.7
发布内容。Cline/Command 仍保持不公开，headless 专属实现和探针没有恢复。
主干 188/schema 138 与 Preview 同号收据按实际结构区分，经 190/schema 140 收敛内部请求与保留的
ACP catalog；旧收据、公开历史、待执行请求和冻结证据保持。既有迁移 owner 扩展两种来源、
残缺结构拒绝、失败回滚和重开，未新增独立测试。

macOS 主干的 `EPERM` 后退出确认接到现有身份信号路径，保留活跃后代、捕获失败和其他信号错误的
拒绝语义，不留下被平台条件排除的分支。原进程清理 owner 的正负例全部保留。

本地验证：默认 Rust workspace 463 passed / 1 个人工 Smoke ignored；迁移、续做、Adapter、Cline 与
平台准入定向通过。DSH catalog 既有 owner 首次因漏记主干上下文字段失败，补齐该字段的输入与断言后
通过；最终进程清理与 ACP 复验 76 passed / 2 个真实 Smoke ignored。TypeScript、239 文件 / 2616
Vitest、339 Node 测试、文档通用门禁及 Desktop/Web 构建通过。隔离 Electron 的真实 Runtime 菜单确认
两个隐藏项均未展示，并通过键盘、IME、双主题/尺寸、缩放与 DSH 迟到目录验证；夹具已清理，未启动
Core 或真实 Runtime。CI 与 Windows all-targets 编译以 PR 当前提交回执为准。

## 2026-10-09 消息 Mention 元数据

按[确认稿 r1](model-context-change-message-mentions.md)实施公开 batch/read 的公共目标投影，
复用名称与正文、原版本恢复、封闭 Schema、预算与摘要。仅 Agent Output 升至 10；
Transport/CLI、Bootstrap、非 batch 与 Binding 兼容身份保持。验证记录统一追加在确认稿，避免多份验收状态。

## 2026-10-09 Windows Claude 后继任务排队修复

本节按 [V1.72-D20](decisions.md#v1-72-d20) 取代上文 2026-10-07 Windows Job 回收证明的当前执行要求；
旧段落保留当时的实现和验收记录，不再要求累计计数、完成端口通知及逐后代句柄退出。
Windows Managed Process 现在只以本次有效 Job 查询 `ActiveProcesses == 0` 放行。
Claude 的可信原生成功或失败先结算业务，未确认的 Job 清理保留精确 Run/epoch 门禁并唤醒现有 worker；
启动临时文件删除失败仅记录诊断，启动时对本 Core 私有 `claude-inputs` 做限定范围的尽力回收。
用户 Stop 在 Windows 使用五秒单次总预算与既有局部重试；直接排队请求在清理期间保留，
执行台以清理中／清理未确认重试中代替普通排队提示。macOS/Linux 原有预算保持。

验收以隔离 Windows Core、Thread 和工作区中第二条非队长 Claude 消息实际执行为准，另查
Stop 后续做、真实工具停止、Job 活跃成员、暂时查询失败、文件删除错误及持久回执门禁。
定向 owner 为 `managed_process::tests::windows_job_contains_an_immediate_grandchild_after_leader_exit`
和 `claude::tests::cmd_and_native_roots_keep_both_files_until_the_job_descendants_exit`；真实模型复测
及未覆盖环境须在合入前记录，不把测试函数返回当作队列验收结果。

隔离实测使用 Windows 10 22H2（19045）、Core 0.4.6 开发构建、Claude Code 2.1.288、
本机已有的 Claude 默认模型配置；新建独立 Core 数据目录、Thread 和 Git 工作区，没有操作日常 Core。
非队长 Claude 的第一条执行期间提交第二条：正常结束时两条 Run 均 succeeded，第二条无需重启即启动；
Stop 场景中取消命令在两次实测中分别用时 26 和 23 毫秒，第一条 cancelled，第二条自动 succeeded，等待 22 秒后
被取消工具预定的延迟写入没有出现。两组原始报告保存在本次会话附件的
`claude-final-normal-report.json` 与 `claude-final-stop-report.json`（另保留先前构建的对照报告）。
这两次真实模型试验使用环境现有的 `bypassPermissions` 默认值；修复没有改变权限配置。
Windows 11、打包版和其他模型／权限模式尚未在本机验收，Job 查询持续失败需在现场诊断中观察。


<a id="dsh-native-web-models"></a>
### 2026-10-09：DSH 原生 ACP 与 Web 模型配置兼容

范围收敛为一个模型准备入口，最低支持仍为 `0.1.5-rc.2`。迁移归 DSH，术语统一为
“DSH 原生迁移期间的 Patch 隔离”。普通 Web 的 llm-pi-ai 模型可受控补充，原生模型和权限、
Bootstrap、Session/Fleet 主路径保留；不建设配置平台、迁移数据库或持久化来源账本。

Probe 与 Host 注入相同插件，在原生初始化后准备完整配置并原位应用到 Loader 的内存 entry。
私有结果只含来源 ID、诊断、摘要与文件指纹；目录来自 ACP。变化检测覆盖 Web 模型设置，
发布前检查过期结果，失败时保留原生能力，显式失败选择不切换同名路由。

测试延伸既有 `dsh::tests`、`grouped_acp_models_keep_opaque_provider_routes_and_reject_empty_catalogs`
与 `scripts/lib/dsh-host.test.mjs` owner。Rust settings 转换的 Provider/Model 显式 true/false/null、
其他协议与空配置断言移到实际 JS 转换 owner；Rust 继续拥有命令私密性、文件不变、权限与摘要。
没有删除、合并或禁用 Rust owner。新增 JS owner 分别拥有 Provider 冲突、兼容默认与原生异步导入完成。

| 验收 | 证据与边界 |
| --- | --- |
| 最低版与旧共享版 | `smoke-dsh-model-configuration.mjs` 在 `0.1.5-rc.2`、`0.1.5-rc.3` 各完成 3 次本地 HTTP 请求，原路由、Provider/Model 显式兼容参数通过；旧版不等待迁移 |
| Profile 版补充 | `0.2.1-alpha.1` 普通 Web-only、原生冲突保留、不同 Provider 同名模型、坏 Web、补充拒绝、迁移后删除 Web、先 Web 后 ACP 等原生进程场景通过；端点、凭据与 strict 在接收端核验 |
| Core 主链 | `smoke-dsh-responses-tools.mjs` 检查、实际 Host、两轮工具调用/结果完成，包含缺省 strict、Provider/Model 显式关闭及原生参数拒绝；使用独立 data-dir、Skill Library、DSH Home 和本地服务 |
| 真实中转 | 仅一次模型请求：隔离复制当前 Web 的 `sub2api / gpt-6.1-sol`，原生选模后返回 `OK`；没有改动日常配置，不推广为其他中转站或所有模型资格 |
| 单元与命令 | 默认 workspace 通过；DSH 与 grouped ACP 定向 owner、JS 模型准备及 Bootstrap owner 通过 |
| 限制 | 其他真实中转服务、Windows/Linux 实机与 Renderer 点击不由本轮本地 HTTP 证据代替；不存在模型质量或所有 Web 专用插件可复用的承诺 |

可重复入口：`node scripts/smoke-dsh-model-configuration.mjs <DSH 安装包目录>`；
`node scripts/smoke-dsh-responses-tools.mjs`，或设置 `ROVAI_DSH_SMOKE_SOURCE=web` 验证 Web-only。
后者需先构建当前 worktree 的 Core/CLI；`ROVAI_DEEPSEEK_HARNESS_BIN` 可指定隔离安装的原生 DSH。
所有夹具只使用合成凭据，结束时回收自身进程与目录，日常 App 与 DSH 配置不参与。

#### 858e8295 后的两处可用性修复

先保留原生 Provider，再处理无法解析的同名 Web Provider；Web 整体故障不再用局部 nativeProviders
集合拒绝其他原生插件。沿用目录 runtime metadata 和现有成员/冻结选择 JSON，增加可选 dshSource
标记，区分同 ID 的原生与 Web 选择；不新增表，不改模型 ID、参数或提示词。
目录刷新不改写已有选择。准备完成与目录发布继续检查输入，后续显式选模只读取准备结果并校验路由，
配置更新由已有 Host 兼容性入口负责，活动 Run 与清理机制保持原行为。

扩展既有 JS Provider 冲突、Rust DSH 摘要/路由、grouped ACP 目录、成员无健康证据配置/冻结及 Renderer 选择 owner：
同名不透明 Web、显式禁用、非 pi 原生身份、同 ID 不同来源、主题变化与过期准备结果均在原矩阵中验证，
没有新增或删除 Rust owner。新增 smoke 入口
`node scripts/smoke-dsh-model-availability.mjs <DSH 安装包目录>` 使用隔离 Core/DSH 与本地 Responses/Messages 接收服务，
验证实际端点、合成凭据、来源保存与冻结、复用 Host 以及失效 Web 选择的零业务请求。
纯配置函数无法证明这些跨 Run 行为，因此由真实进程 smoke 单独拥有。
定向入口：`cargo test -p rovai-core --lib dsh::`；
`cargo test -p rovai-core --features extended-tests --lib grouped_acp_models_keep_opaque_provider_routes_and_reject_empty_catalogs`；
`cargo test -p rovai-core --features slow-tests --lib discovered_entry_configures_and_freezes_without_health_evidence`。
目录迟到结果的共享代次门禁沿用并运行
`cargo test -p rovai-core --features slow-tests --lib codex_catalog_waiters_share_refresh_without_satisfying_full_validation`；
DSH 输入在准备期间变化的检查由其摘要 owner 验证，两者不互相替代。

#### 按目标模型读取思考强度

目录只把当前 ACP 模型的选项绑定给该模型；目标选项通过既有目录入口按需读取。执行选中目标后
替换完整选项状态并校验显式值；DSH 未保存强度时冻结配置保持缺省，复用 Session 交由原生选模
恢复默认。Renderer 支持模型默认、读取中、无档位与失败重试，迟到响应不覆盖当前目标；主动换模
只修改草稿，刷新目录不删除保存值。最低版本、Web 配置准备、来源核验和 Cleanup 均保持。

扩展现有 grouped ACP 与 `model_option_validation_rejects_preserved_effort_after_catalog_refresh`
Rust owner，不新增或删除测试函数。真实协议与 HTTP 断言扩展上述两个 DSH smoke 入口；
`pnpm test:runtime-model-picker` 的生产组件夹具覆盖目标切换、迟到结果、失败重试与默认选择。

macOS arm64 隔离验证：`0.1.5-rc.2`、`0.1.5-rc.3` 和 `0.2.1-alpha.1` 均通过原生选项与
同 Session 默认恢复，分别接收 7、7、15 次本地 HTTP 请求。当前 Core + alpha.1 的 11 次本地
请求验证目标读取零正文、B 不继承 A 的 max、先选模再设置 xhigh、冻结配置缺省、未改配置时
Session 复用、无可选档位正常执行、无效 max 零正文及 Web reasoningEfforts 刷新保留保存值；
既有原生/失败 Web 路由与非模型设置 Host 复用场景仍通过。成员配置变更可能按既有 Binding
规则创建 Session，未新增重建路径；原生同 Session 的旧强度复位由三版本协议 smoke 直接验证。
这些证据不覆盖 Windows/Linux 实机、打包日常 App 或真实中转；付费请求为零。

#### 思考强度缓存与静默读取

能力继续存入现有模型目录 metadata，以安装/环境、模型/来源及复用的 DSH 配置摘要为有效性边界。
每个模型保存自己的成功时间和已确认状态（包括无档位）；60 秒内直接复用，过期时展示历史并按需刷新。
本地 `cacheOnly` 校验不启动 Runtime，同目标请求共用现有检查队列，完整刷新与目标读取在同一事务入口
累计能力。配置改变时旧结果不再确认有效；失败不改成功时间，删除模型不被历史能力重新加入。

默认模型不查询；具体模型立即选中，静默读取不阻塞保存。移除独立加载和无档位提示，确认无档位且无
显式旧值时隐藏控件。失败保留历史并提供重试；用户已修改或保存的选择不受迟到结果清理。
执行前原生校验、缺省强度、最低版本、模型准备、Host 兼容性与 Cleanup 保持原行为。

macOS arm64 验证结果：

| 验收 | 证据与边界 |
| --- | --- |
| 原生请求计数 | Core + `0.2.1-alpha.1` 的既有 availability smoke：本地缓存校验零探测，三个并发 B 请求只选模一次；A/B 返回命中缓存，确认空档位重复选择只探测一次；将隔离数据库中 B 的时间调旧 61 秒，并发重访只重新探测一次 |
| 失败及发布门禁 | 原生协议故障保留选项和成功时间；选模屏障期间修改 Web 配置，旧结果未发布；60 秒内配置变更也重新读取；普通目录刷新保留其他模型的能力与时间 |
| 执行保持 | 12 次本地 HTTP 请求核对端点与合成凭据；TTL 重新验证后复用业务 Host，默认强度不追加 ACP 设置，无效显式强度零正文；原生与失败 Web 路由回归继续通过 |
| Renderer | 生产组件夹具覆盖默认模型零查询、A/B 乱序、过期历史、空结果隐藏、失败重试、用户后续选值/保存不被迟到响应改写；Day/Night、1040/1440/2560 宽度、200% 缩放与键盘交互通过 |
| 兼容基线 | `0.1.5-rc.2`、`0.1.5-rc.3`、`0.2.1-alpha.1` 的既有原生协议 smoke 分别通过 7/7/15 次本地 HTTP 请求；Core 缓存端到端实测使用 alpha.1，不冒充三个版本完整 Core 矩阵 |
| 代码门禁 | 默认 Rust workspace 459 通过、1 个既有 ignore；新增事务 owner 与既有检查队列 owner 各 1 通过；Vitest 239 文件/2612 测试、类型检查、Desktop 构建、DSH JS owner 5 项通过 |

事务 owner 的准入理由与命令见[测试指南](../../development/testing.md#dsh-逐模型能力缓存)。
版本与决策治理门在当前受版本控制文件副本通过，比较基线 `3a83b2b7`；原工作目录中既有、未跟踪的
`docs/prototypes/` 原型断链使直接文档检查失败，未修改这些原型。没有新增缓存表、服务或定时扫描。
未实测 Windows、Linux、macOS x64、打包 App 及真实中转；付费请求为零。本轮只提交并推送
`rovai/dsh-web-models`，不创建 PR、合并、安装或修改日常 DSH 配置。

#### Windows DSH 能力指纹路径归一修复

Windows 探测路径经 `canonicalize()` 带有长路径前缀，提交目录使用去前缀路径；同一程序的两种写法
不能被当作配置变化。`model_options_context()` 在共同入口复用 `runtime_visible_path()` 归一真实路径，
命令环境观察、文件身份观察和指纹计算使用同一路径；真实文件、模型配置或环境变化仍使能力失效。
不修改首次检查状态机、Host 复用、权限、会话恢复或 Cleanup，不包含同 ID 模型来源切换的 UI 修复。

默认层回归 `cargo test -p rovai-core --lib dsh` 使用隔离 Home 与 task-local 环境，覆盖普通/长路径
指纹相等及程序、配置、环境变化失效。`scripts/smoke-dsh-model-availability.mjs` 为 Windows 使用
`.cmd` 记录入口，`ROVAI_DSH_SMOKE_CORE` 可指定本次构建 Core；既有隔离协议、合成凭据与本地
HTTP 场景验证首次完整检查、重复刷新和投递，无真实中转请求，不改日常 DSH 配置。

## 2026-10-09 续做公屏记录移除

User 按 [r3](model-context-change-quiet-continuation.md) 授权新续做不新增消息记录、PR 合入 main 并本机安装；
已生成的记录保留原样。Migration 188 / schema 138 调整既有 Delivery 来源与独立序号；公共读取、FIFO 和原输入证据由
`delivery_queue::tests::user_continuation_preserves_source_and_claims_independent_fifo_batches` 扩展覆盖。
未新增平行 SQLite fixture 或独立 Rust 测试；既有正负向测试保留。既有 migration owner 验证
188 回滚；填充后的队列 fixture 验证旧续做来源转换、旧消息、公开序号与冻结证据保持。
thread.runs 按实际输入次数统计 queued 数量并取队首原文；Desktop 复用输入 ID 和既有锚点，
消息发送对象页脚排除续做，避免原 A2A 收件人重复。

2026-10-10 本地验证：TypeScript、完整 pnpm test（239 文件／2613 Vitest，337 Node 通过、2 既有跳过）、
Rust workspace（460 通过、1 既有忽略）、continuation 扩展 5 项、thread_runs 扩展 4 项通过。
最终页脚调整的既有 App owner 181 项、生产继续按钮交互与基于 main 的文档治理均通过。
真实 Runtime 与安装产物证据随 PR 交付记录；缺少固定 snapshot Judge 配置，未完成通用 12 Case
基线／候选语义 Gate，专项验证不替代该 Gate。


## 会话内队员占位

初版在 User 确认 v5 HTML 后授权独立 worktree 实现。下列保留初版验证记录；后续增量见本节「停止区分隔与重试恢复」及「单行进度读取恢复」。基线 `f9acc2395283d49f0ce247dc0af2207c155f6eb6`；
分支 `rovai/teammate-presence-v5`，worktree 为 `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-teammate-presence-v5`。
初版为 Renderer 增量，无需治理文档主线前置，不修改 Core 或模型上下文。
状态 `ready`；验证后提交、推送上述分支，按 User 偏好不自动创建 PR，保留 worktree 供后续验收。

- `ConversationRunPresence` 作为消息时间线末尾独立节点，消费同一 Evidence/live progress；复制／回复、消息分组和产物布局不变。
- 轻量 open/re-entry 复用 `ExecutionWindow` 的 blocks API，单块恢复最新正文/命令，并以既有变化水位更新；缓存窗口与 Drawer 历史阅读隔离，不读全文 Blob、不增加轮询。
- `conversationRunPresence` 只投影实际运行／已开始等待及每位队员最新公开 batch 失败；顺序服从公开消息 sequence，头像是否重复按精确 Run 判断。
- 消息区确认停止使用原回调及 Run version；`ContinueAgentRunButton` 增加内联重试外观，共享原请求身份与未知回执核对。
- CSS 复用 v5 的 30px 行、14px 状态/工具图标、26px 停止按钮和单行省略；粗指针 44px，日夜主题及 reduced-motion 共用语义 token。

验证：

- `pnpm typecheck`、`pnpm test` 通过（240 个 Vitest 文件、2621 项用例；另有 339 项 Node 测试通过、2 项平台跳过）；新增 5 项占位投影、8 项 ExecutionWindow 及原有产物渲染回归通过。
- `pnpm test:run-presence-ui` 覆盖 8 类场景、37 个阶段、真实增量 Evidence 模拟、交错消息、原按钮显隐、停止确认、重试拒绝／未知回执及草稿保留；额外验证轻量 open 无 Evidence 时单块恢复命令、增量正文且不读 Blob。
- 与 User 确认的 v5 原文件逐项比对行高、间距、字体、颜色及停止按钮：日夜主题 × 1040×700、1440×920、2560×1440 共 6 组通过；另通过 200% 等效布局、44px 粗指针目标及 reduced-motion。
- 原有 `pnpm test:run-continuation-ui` 及 `execution-state-transition` 浏览器回归通过；`pnpm test:rust:pr` 为 465 passed、1 ignored；`pnpm package:mac` 成功。
- `pnpm accept:runtime-activity-ui` 完整通过：隔离桌面包/Core 的 13 类结构化 Runtime 夹具、冷启动命令恢复、紧凑消息尾占位、执行台三种位置、工具正文阅读恢复、停止、日夜主题与 200% 等效布局均通过。浏览器和桌面验收使用受控证据与命令回执，不代表真实模型执行。
- 验收同时复现并修复底部执行台高度测量晚于阅读位置恢复的问题：等待高度边界提交后恢复，原 3% 精度断言保留；底部往返前后外层比例均为 `0.3715415`，正文比例均为 `0.5297483`。最终修复再通过类型检查、执行台浏览器回归与完整桌面包验收。

验收维护：主线 Built-in transport 的断言仍为 36，已在未改动的基线重现并与当前 37 同步；
通用桌面夹具的 Manifest 32 更新为 33，按当前 Accepted Input Recovery v8 检查结果不明 Run 的失败终态和主动继续，
并使用当前带数量的标签结构、“智能体默认”文案、执行台统一背景及重入总览契约；Runtime 断言按成员身份定位，已停止步骤计入收口总数。浏览器关闭等待拥有的进程退出，解除 Crashpad 继承日志管道导致的悬挂；
缺少浏览器时保留清晰的未执行提示，额外验证启动失败能够释放资源。未修改 Core 恢复规则或模型上下文。

本地证据保存在 worktree 的 `docs/prototypes/run-presence-implementation/`（忽略的生成物），含浏览器逐项
对照、桌面验收 JSON 与截图。最终隔离 `userData` 为
`/private/var/folders/pm/zmpfxggd0glcm8vx3p3y3mmr0000gq/T/rovai-presence-native-layout-4c6zdmds/user-data`，
Skill Library 为其 `managed-skill-library/`；未安装、重启或改写日常 App。

### 停止区分隔与重试恢复（2026-10-11）

在 `2890a04251774e348f01444f60eb9bc4bf777ccf` 上继续使用原 worktree 和分支，按 User 选定的 v10
「停止区分隔」实现；随后按 User 修正恢复 v8 默认中性色、悬浮红色的停止按钮。
该次合同为 [Run Process Detail Surface v48](../../contracts/run-process-detail-surface-v48.md)。

- 透明行内增加 1px × 16px 操作区分隔，36px 行高、34px 内容入口、26px 停止按钮；粗指针扩大为 44px 目标。
  进行中图标使用执行台颜色与动画，停止图标提取为共用组件。保留单行流式省略、消息顺序和原复制／回复显隐。
- `AgentRunView.hasAcceptedContinuation` 从 `camp_run_continuation` 与真实 Delivery 派生；同一读取覆盖
  完整快照和轻量打开。受理后收起旧失败入口，切群／刷新可恢复，不依赖组件 Set 或有界 Delivery 列表。
  切群先展示缓存时暂不呈现中断行，权威读取完成后再判断，避免缓存短暂复活旧入口。
  旧 Run 状态/version 不变；新 Run 失败只重试新 Run，执行台仍允许对历史 Run 多次主动授权。
- 消息区提交中显示「正在提交…」，回执丢失只保留普通重试，内部继续复用同一 commandId；没有新增结果未知状态。
  数据库结构、调度、授权命令和模型上下文均不变。

验证证据：

- `pnpm typecheck`、`pnpm test` 通过：240 个 Vitest 文件、2621 项用例；339 项 Node 测试通过、2 项平台跳过。
- `pnpm test:run-presence-ui` 通过 37 个场景阶段、19 项交互记录、6 组主题/尺寸，以及 v10 原文件的 6 组几何/排版对照；
  单独验证双主题的默认中性色、悬浮红色、鼠标移开恢复、200% 等效布局、粗指针与 reduced-motion。
  暂缓调度领取后实际点击侧栏切群再返回（含旧缓存预览）、完整刷新，旧失败行均不复活且只有一条等待 Delivery；
  后继失败点击指向新 Run；执行台两次主动继续分别产生独立授权，返回消息区仍收起旧提示。
- 扩展既有 Rust owner `user_continuation_preserves_source_and_claims_independent_fifo_batches`，覆盖事务回滚未受理、
  已受理但尚无新 Run、SQLite 重开与轻量投影恢复、source version 不变、后继 Run 不继承源 Run 的受理标记。
  使用真实 SQLite 验证持久化边界；未新增重复测试 owner。
- `pnpm test:rust:pr` 通过 465 项，1 项忽略；定向扩展 owner 通过。`pnpm test:run-continuation-ui`、
  `pnpm build:desktop` 与文档通用门禁通过；最终定向 App、界面语言与占位测试通过。

截图与浏览器报告保存在 worktree 的 `docs/prototypes/run-presence-divider-implementation/`（忽略的生成物）。
浏览器使用生产 React 组件和模拟服务端记录；Core 测试使用隔离数据库。这次未运行真实 Runtime，未安装或重启日常 App。
完成后提交并推送原分支，按 User 偏好不自动创建 PR，保留 worktree。

### 单行进度读取恢复（2026-10-11）

在固定提交 `63c3f2be1dea1be0b5de729a53f033dbdc2033fc` 上复现：首次 page 失败后，连续三次
refresh 不再请求；首次 page 在途期间收到更新也被丢弃。User 随后授权在原 worktree 修复。
当前边界为 [Run Process Detail Surface v49](../../contracts/run-process-detail-surface-v49.md)。

- `ExecutionWindow` 先记录在途失效，再判断是否已有数据。活动尾窗首次失败可由新更新或连接
  resync 重新读取；多个在途更新合并为一次补拉，持续失败不自行循环。未读取窗口保持冷态，
  执行台历史分页仍保留显式重试及方向／游标，释放窗口清除待刷新并隔离迟到回执。
- 单行预览与 Thread 复用同一 Evidence 合并函数，先按身份／版本／流式增长合并，再投影内容；
  移除旧恢复结果优先于全部实时进度的选择，避免正文回退，并拒绝旧版本流式事件覆盖新恢复记录。
- 没有 CSS、按钮或 Core 改动；排队、完成展示、已受理重试收起及 v8 默认停止色保持。

验证：`pnpm typecheck` 通过；`pnpm test` 为 241 个 Vitest 文件、2627 项用例通过，另有
339 项 Node 测试通过、2 项平台跳过。新增读取类测试覆盖失败后恢复、慢首读补拉、持续失败不循环
和释放后不补拉；Evidence 合并测试覆盖新旧版本两种方向及同版本流式增长。

`pnpm test:run-presence-ui` 使用生产 React 组件和受控服务读取，验证无 Run 字段变化的重连原位恢复、
慢首读后无须新通知即可追上、补拉延迟时新实时正文不回退；原 37 个场景阶段与按钮／重试回归通过。
`execution-state-transition` 浏览器回归、`pnpm build:desktop` 及文档通用门禁通过。
本次没有运行桌面包或真实 Runtime；验证不依赖启动或修改日常 App。

## 队员环境按进程启动读取（2026-10-12）

按 User 方案 A 实施。领取/执行准备不再读取历史环境；现有 Fleet 创建分支携带私有配置读取来源，
创建 CLI 时组装一次内存映射，Warm 命中不读取配置。Codex/ACP/Pi 使用既有 native binding 身份限制
会话复用；Claude/Antigravity 在独立进程启动路径读取。派生工具进程保持 ManagedProcess 的父 CLI 环境。
新环境映射不序列化入 Run，不改变既有 Run 身份、执行代次或输入确认。Migration 193/schema 143
无需旧密钥/快照解密即退役两张历史环境表；队员配置与原生历史保留。

单队员配置解析失败接入现有 lane 失败结算，SQL/数据库错误仍返回外层。环境读取错误发生于新 CLI
创建，沿既有单 Run 失败路径展示；保存 env 不引入停止、重置或环境版本失效行为。
界面采用约定的一句进程启动说明，重置文案仅解释原生上下文重启。

测试归属、旧测试退役理由与命令见[测试指南](../../development/testing.md#队员运行环境-owner2026-10-11)。
本机 macOS 验证结果：

- `pnpm test:rust:pr`：workspace 465 项通过，1 项已有人工测试忽略。
- `cargo test -p rovai-core --features extended-tests --lib` 按上述 owner、Codex/ACP/Pi/Claude/Antigravity、
  Fleet、Runtime startup、Delivery queue、迁移准入、v163/continuation 迁移过滤运行：212 项通过。
  加强后的 193 历史消息/原生 Session 保留案例通过；既有原生会话重置 slow owner 1 项通过。
- `cargo check --workspace`、`cargo fmt --all --check`、`pnpm typecheck` 通过；Vitest 242 文件、2639 项通过。
- `node scripts/smoke-member-environment.mjs` 与 `node scripts/smoke-member-environment-ui.mjs` 通过，
  覆盖 Core 私有接口、重启/加密/并发写保护和双语界面；数据、Skill Library 与 MCP 均使用临时目录。
- `pnpm docs:test`、`pnpm docs:check` 与基于 PR base 的 `pnpm docs:check:ci` 通过。

未安装或重启日用 App，未修改真实聊天数据库；未运行真实 Provider/模型或 Windows 真机验收。
UI 仅修改已确认文案；设计扫描提示的旧 surface 路径与平台元数据漂移不属于本次改动。

### 升级后原生绑定续接修正（2026-10-12）

已有 Session 的绑定摘要与当前安装、协议、Session 权限投影精确一致时，保持原先未纳入默认 Host
连接的身份；不为决定 Warm/续接资格读取队员 env 或历史环境。原先包含默认连接身份的绑定仍执行
连接兼容检查；未知摘要、安装与权限不兼容仍按既有规则处理。

从 PR 之前的 `7973c7ffd1b0a360dea02c936458fb69f591c11e` 构建 Core，使用正式私有配置与消息执行
建立 schema 142 的 Claude/Codex 原生绑定，再通过新 Core 重启升级至 schema 143。
`smoke-member-environment-upgrade.mjs` 在 `d8726819` 复现两者错误地发送 `start`/`thread/start`；
修复后实际发送 `--resume`/`thread/resume` 并携带原 ID，绑定身份/代次保持，前后两个 Run 均成功。
两次启动之间只改变 Host 继承值，队员配置未修改；新 CLI 收到当前 Host 值与原队员覆盖，证明未恢复旧环境。
此验收使用两个实际 Core 版本与合成原生 CLI，不代表真实 Provider 恢复成功率。

摘要/权限矩阵扩展原 `discovered_entry_configures_and_freezes_without_health_evidence` owner 并通过；
Rust 测试函数数量不变。最小命令、隔离目录和跨版本 fixture 归属见上述测试指南。

## 同类 CLI 优先恢复原生会话（2026-10-12）

后续真实 CLI 审计与修复基于 `d41778bfcc71d0223e70cbbdd442c3e500eb3559`，分支
`codex/runtime-resume-audit`。15 类真实 Runtime 均完成原 ID 冷恢复；缺历史时发现五类明确缺口，
User 授权一并修复：CodeBuddy 精确文件核验，Copilot/Qwen 资源目标匹配，Qoder 结构化目标拒绝，
ZCode 原生 resume 错误跨桥接保留。其余未知错误保持原 ID，不扩大自动降级。
没有新增数据库/迁移、摘要或上下文资格门槛；五款修复后的实际恢复、输入与提示计数见
[独立审计及复测](../../research/runtime-monitoring/native-session-resume-2026-10-12.md#五类-runtime-修复与复测)。
测试 owner 与新增测试理由见[测试指南](../../development/testing.md#原生会话恢复-owner2026-10-12)。

基线 `bab6034df3459269a4a15628dc436d660716f1ac`；分支 `codex/native-session-resume`。
User 明确要求整套已确认方案一并完成。规范见 [Runtime Launch v60](../../contracts/runtime-launch-and-verification-v60.md)，
取舍见 [V1.72-D37](decisions.md#v1-72-d37)。

- 当前 Conversation 的类型由既有安装/历史 Run 解析；同类 CLI 保留 exact-ID Resume 资格，历史摘要、安装代次和受控恢复记录不提前否决。
- Adapter 在恢复调用处提供可靠结论；退役全局文本及 Claude/Antigravity/Pi 的日志猜测。Command Code 后续已按原生尽力恢复删除目录预检（见本页 Command 收口）；Pi 区分精确目标不存在与普通 IO 错误。
- 新建前保留旧目标，当前输入 dispatch/accepted/unknown、取消与 epoch 仍阻止自动降级。成功替换与提示事件在绑定事务一同提交；公开/私聊执行详情显示一句提示。
- 新 Run 正常装配 Bootstrap，不依赖旧 Blob。Migration 195/schema 145 保留所有历史行与引用，仅解除 Binding/generation 唯一约束；同一 Run 已准备输入保持不可变。
- 进程丢失或重启时，未知输入正常失败并保留清理/防重证据，同时保留原生目标。用户显式续做的未知执行隔离机制不变。

验收 owner 扩展现有 `scripts/smoke-member-environment-upgrade.mjs`：从 `7973c7ffd1b0a360dea02c936458fb69f591c11e`
构建 schema 142 Core，正式建立 Claude/Codex 原生绑定与队员 env；在隔离 fixture 中改变旧安装/连接/上下文元数据、
破坏旧 Bootstrap digest，然后用候选 Core 重启。实际 `--resume`/`thread/resume` 携带原 ID，新进程读取当前
Host＋队员环境，第二条输入只提交一次，两个 Run 均成功。TRAE 模拟 ACP 验证能力缺失的一次新建、
新建失败保留旧目标、初始化/恢复/模型误导文本报错、真实取消与恢复超时，输入后进程退出只提交一次并保留原 ID。
Codex 的 MCP / 认证反例分别触发实际 `config/read` / `account/read` RPC 错误，并验证零新建、零业务输入；
成功提示只随已绑定替代会话出现。
所有目录、Home、MCP 和凭据均为临时 fixture，无真实模型调用。

Rust owner 与准入说明见[测试记录](../../development/testing.md#原生会话恢复-owner2026-10-12)。
审查已修复 Claude 重复绑定、Pi 缺目录分类、迁移外键/索引准入与提示原子性；两个审查轴复核无剩余核心发现。

本机 macOS 验证结果：

- `cargo test --workspace`：465 项通过、1 项既有人工测试忽略；`cargo check --workspace` 和格式检查通过。
- `slow-tests` 定向恢复、Bootstrap、替换回滚、Pi 精确目标、主动重置、启动恢复、坏配置调度隔离和 Warm
  环境 owner 通过。曾启动完整扩展/慢速组合，发现未修改的 `acp_runtime_classification_covers_every_acp_backed_adapter`
  中 Command Code/Cline 顺序断言失败后停止该整套运行；本次不宣称完整 slow suite 通过，也未禁用该测试。
- `pnpm typecheck`、Vitest 全部 242 文件 / 2639 项通过；文档测试 10 项及相对上述基线的通用治理门禁通过。
- 上述跨版本 + 合成 CLI 执行验收通过，包括旧 ID 的实际恢复请求、当前启动环境、有界降级、错误来源和输入次数。

验证范围为隔离 Core/合成 CLI，未运行真实 Provider/模型或 Windows 真机，未安装或重启日常 App。
状态：保留 `codex/native-session-resume` worktree 供 PR 评审，未合并。

### Pi 定位范围与 ACP 恢复拒绝接线（PR #714 补充审查）

以 `896b4d55e980901c5f3e5ef74a5fd9ad7b9cc5ac` 二进制运行新增的正式 Core 协议场景，复现两项遗漏：
同 Camp/队员的 Pi 公聊 S1 → 单聊 S2 → 公聊 S1 在第三步报 locator 身份错配；ACP 广告支持 load、
实际返回 `-32601` 后没有调用一次新建。前者是已有定位文件范围过粗，后者是 RPC 传递时丢弃结构化错误。

修复仍在现有 Adapter 内：Pi 按 canonical Session UUID 保存独立定位文件，旧 locator 仅在 ID 匹配时回读，
不把错配改判为缺历史；ACP 用原 `AcpRpcError` 跨请求通道传递脱敏机器字段，只在恢复调用处解释 `-32601`。
resume 方法不可用时，若广告且 Adapter 允许 load，则以原 ID 尝试一次 load；可用恢复方式均明确不可用
才回到既有的一次新建。初始化/模型/目录请求错误不获得该结论，没有新数据库状态、迁移或历史扫描。

回归复用原 Core smoke 和 Rust owner，详见[测试说明](../../development/testing.md#原生会话恢复-owner2026-10-12)。
Spec 与 Standards 静态复核均无剩余核心问题。

修复后的 `--adapter-regressions` 执行验收通过：Pi 在 Warm/重启两轮交替恢复公聊、单聊的原 ID 和文件路径，
8 条输入各提交一次；ACP 覆盖 load 拒绝后新建成功/失败、resume 拒绝后 load 成功及两者都不支持的有界降级，
并验证初始化/模型同码、取消、超时和输入未知不会降级或重复发送。ACP/Pi 定向扩展测试分别 66/14 项通过，
各有 2/1 项既有人工测试忽略；`cargo test --workspace` 重新通过 465 项、1 项既有人工测试忽略。
格式、生产编译及文档治理门禁通过。验收仍使用隔离 Core 与合成 CLI。

## 执行行固定位置、原文逐行与 RunCard 高亮（2026-10-12）

User 确认 v12 并要求实施；基线为 `1edacb5348ae22f9a34d404b4a0f18adde197de1`，
分支 `rovai/conversation-presence-stability`。Renderer 增量，不改变 Core、数据库或模型上下文；
当前边界见 [Run Process Detail Surface v50](../../contracts/run-process-detail-surface-v50.md)。

- 每 Run 使用既有已领取输入锚点，只有自己的已提交公开消息推进位置；消息／产物顺序保持。
  分页与切群使用现有投影恢复，行组件按 Run ID 保持身份，停止确认和读取窗口不因移动重建。
- 正文只按原文换行在一个物理行内推进，保留空行间的最后非空内容；完整原文仍在执行详情。
- 复用 RunningText 扫光并去掉左侧运行圈，保留工具图标、停止区和失败／等待状态；
  减少动态效果和强制颜色仍显示实时文字。时间线预留滚动条空间，避免停止目标横向移动。
- 更新已有浏览器夹具与 owner 测试，没有引入演示依赖或新的动画库。

已通过类型检查、7 项投影／正文单测及 30 项既有产物测试，生产组件浏览器回归通过 37 个阶段、
原始 LF／CRLF／空行、单行几何、高亮、停止／重试、草稿、重入读取和 6 组主题尺寸、
200% 等效布局及粗指针检查。截图位于本地忽略目录 `docs/prototypes/run-presence-v12-implementation/`。
完整 `pnpm test` 已在提交 `4709bf3b` 的干净检出通过：242 个 Vitest 文件／2641 项用例，
Node 脚本 339 项通过、2 项平台跳过，文档与 Skill 门禁通过。主 checkout 的旧本地原型 Markdown
坏链接保持原样；验证检出只复用同一锁定依赖，关闭 pnpm 自动重装，不跳过任何测试。

`pnpm package:mac` 与 `pnpm accept:runtime-activity-ui` 通过。后者为生产桌面包／Core 的
13 Runtime 受控数据验收，覆盖执行行恢复、三种执行台位置、两主题、2K 居中、紧凑窗口、
200% 布局、滚动、工具详情与停止。App 使用一次性 `userData` 和独立 Skill Library／MCP config；
不代表真实 Provider 请求验收。最终报告在上述目录的 `native/runtime-activity-acceptance.json`，
隔离路径与代码提交记在 `isolation.json`。

浏览器补充验证自己发送后 DOM／焦点保持，以及完整重载确实进入新文档。桌面验收保持原有
点击命中与主题色断言，改为等实际布局／主题传播完成后检查；紧凑窗口按当前 Run 的真实锚点
定位。验收发现的滚动条 6px 中心偏差已通过两侧对称预留消除；首次发送前的中间产物、
未加载输入锚点与时钟倒退均不会把执行行带到新消息后。


## 内部实现减重（2026-10-12）

独立 worktree `context-tool-simplification`，分支 `codex/context-tool-simplification`，基线
`07ca89ec5f9dea8c27bf15602bc076c7cf200f73`。User 已授权 1—5 一起实施并提交 PR。
已合入最新主线 `d41778bfcc71d0223e70cbbdd442c3e500eb3559`，保留同 CLI 类型原生恢复的行为。

当前实现：Migration 196/schema 146；当前 DB 结构准入；Context 使用最终输入并停止重复证明材料写入；
Transport/CLI 38、IPC 3、Envelope 2 删除工具结果与目录摘要；Domain Command 以 ID 和归属返回首次结果。
Usage summary 在现有后台 worker 收尾；原生输入、授权、租约、消息与结果查询保持。

测试 owner：Context 的实际输入/重启/预算、Domain Command 的结果/回滚/归属、DB 的迁移/准入、
工具协议及调用方 Node 测试。摘要自证和生成版本组合专属断言随生产路径退役；对应实际结果和历史恢复
由原 owner 保留。没有使用日常 App 或日常数据库验收。

新增 `db::simplification::tests::upgrade_preserves_legacy_results_and_blob_bytes_and_rolls_back_atomically`
拥有 schema 145→146 的 DDL/事务边界：旧 NOT NULL 与命令 CHECK 在取消摘要后会拒绝新写入；测试保留
真实旧结果和 Blob，注入迁移记录失败，验证整次回滚、再次升级与重开。既有迁移 owner 属于不同来源步骤，
纯函数不能证明 DDL 和业务行原子性，因此建立一个 `extended-tests` owner。

随生产合同退出删除五个独立测试：工具 `receipt_is_stable_and_covers_the_outcome`、
`receipt_v1_keeps_the_existing_canonical_digest_goldens`、`catalog_digest_changes_with_agent_facing_send_teaching`，
命令 `execution_epoch_fences_processing_without_changing_command_semantics` 的请求摘要不变性，以及
Context `dispatch_admission_accepts_current_and_frozen_predecessor_contracts` 的证据版本组合门禁。
工具字段/错误/输出由原 Envelope 与 CLI projection owner 继续覆盖；命令结果、epoch 处理、只读查询和
事务回滚仍由原 Command/Runtime owner 负责；历史输入与原生恢复仍由原 Context owner 验证。
同 ID 内容变化改为返回首次结果，跨 actor/Camp/来源 Run 仍拒绝；私有草稿和上传直接记录已有编辑器 ID，
保持编辑器隔离。旧记录没有单独编辑器 ID，继续按原有 actor/Camp 查询，不重建指纹。
最低定向命令为 `cargo test -p rovai-core --all-features --lib -- <owner filters>`；默认 PR 与进程 IPC 另验。

本机 macOS 验证结果：

- `pnpm test:rust:pr`：460 项通过、1 项既有人工测试忽略。
- `pnpm test`：Vitest 242 文件 / 2645 项通过；Node 339 项通过、2 项平台跳过。
- `cargo check --workspace`、`pnpm typecheck`、`pnpm build:desktop`（含 Web）、`pnpm test:send-input-file` 通过。
- Context、Usage、数据库准入/升级、Web reconcile 的 71 项定向回归通过；旧迁移、私有编辑器、
  同 ID 结果查询、停止/继续和原生恢复等补充失败场景修正后分别复跑通过。
- `cargo test --workspace --all-features` 首轮：1329 通过、25 失败、8 忽略。该轮暴露的 22 项失败
  已修正或独立复跑通过；包括退出的摘要断言、降级迁移夹具，以及主线同 CLI 恢复后的旧期望。
  未重复执行整套慢测，不把定向通过描述为全量通过。
- 剩余 3 项 `read_model::camp_open_slow_tests`（业务状态、分页标题、与历史规模无关）均报
  `event_log.entity_type access denied`。在干净的上述 main 上执行
  `cargo test -p rovai-core --features slow-tests --lib read_model::camp_open_slow_tests::`，
  同样 2 通过 / 3 失败；本次不修改无关的 CampOpen 投影，也不删除或忽略这些测试。
- 相对上述主线的 `pnpm docs:check:ci`、文档测试和格式检查通过。

状态：实现完成，保留当前 worktree 供 PR 评审。验证仅使用隔离数据库和合成 CLI，未调用真实模型、
安装或重启日常 App。

### MCP 同 Run 重复准备与诊断读取

以 PR #720 的 `94b62c6b` 为修复基线，扩展既有 Context MCP owner，使用正式 Manifest writer
生成 NULL 摘要后再次准备同一个 Run，实测复现 `mcp_exposure_digest` 的 NULL/String 类型错误。
MCP 恢复现在只读取保留的 exposure JSON 和私有配置文件，移除冻结摘要比较及无人消费的
exposure digest 计算；保留文件权限、Run/Adapter 归属、原生同名选择和进程复用所需文件标记。

同一夹具继续经过数据库关闭/重开、同 epoch 准备、新 epoch 重派发，检查原配置与文件字节；
没有新增独立 Rust 测试或平行夹具。该 owner 更名为
`context::slow_tests::context_manifest_recovers_redacted_frozen_mcp_exposure_without_digests`，
保留原有凭据不入 SQLite 的断言。顺沿读取方还复现了 Run 诊断对 `rendered_payload_digest` 的
同类错误；退役字段现按已有 Option 类型返回 NULL，同一完整快照夹具覆盖诊断读取。

最小命令：`cargo test -p rovai-core --features slow-tests --lib -- context_manifest_recovers_redacted_frozen_mcp_exposure_without_digests mcp_projection::tests:: agent_run_diagnostic_projects_only_safe_frozen_and_public_facts`。
结果：上述 10 项全部通过；`cargo check --workspace`、格式检查、相对 `d41778bf` 的通用文档门禁通过。
本轮未重复无关的完整慢测，前述 3 项 main 已有 CampOpen 失败的结论不变。


## 执行反馈减速与动态效果入口（2026-10-13）

User 确认 4.8 秒、执行行右键入口及连接／处理两阶段文案，并授权独立 worktree 实现与 PR 合入。
基线 `79b156d71f6921245c7e5bcb1d138ccfc7c4967b`，分支 `rovai/conversation-motion-feedback`；
边界见 [Run Process Detail Surface v51](../../contracts/run-process-detail-surface-v51.md)。

- RunningText 全部消费处统一为 4.8 秒，含会话执行行、RunCard 和单聊反馈；
  外观“始终减少”、系统 reduced-motion 与 forced-colors 隐藏高亮层，实际内容仍推进。
- 执行行保留左键详情，右键／长按／键盘菜单可直达外观既有选择器；
  复用设置导航，不改写记住的分类，Esc 在菜单焦点锁释放后回到执行行。
- 初始化使用 Run 的 runtime_initializing，真实受理后转为处理兜底；停止、失败和等待优先，
  不新增计时猜测、思考正文、后端状态或迁移。

类型检查、242 个 Vitest 文件／2656 项用例、文档治理与其 10 项单测通过。
生产组件浏览器夹具通过 37 个阶段、6 组主题尺寸与 26 项交互记录，包含
右键／Shift+F10／长按松手、设置聚焦与保存、减少动态效果、强制颜色和既有锚点／重试回归。
外观保存使用隔离内存适配器，未启动日常 App、Core 或真实 Runtime；BusinessApp 的设置跳转
复用既有离开保护与草稿 owner，浏览器夹具只验证组件路径，不替代完整 App 的导航验收。

## 执行行与回复产物顺序（2026-10-13）

User 确认修正执行行拆开回复与 Files Changed／入队卡片，以及连续输入后新执行回插到上一轮回复之前。
基线 `997856a8317531b6daaeb3c0d27a20644f4aaaaa`，分支 `rovai/run-presence-order`，独立 worktree 实施。

- Snapshot / Open 的 Run View 直接投影已持久化的启动公开消息边界，输入锚点与模型上下文不变，
  没有迁移、新查询或新持久副本。精确读取合同见 [Camp Open Projection v27](../../contracts/camp-open-projection-v27.md)。
- 执行行初始使用冻结边界，自己的公开回复后才推进；插入时越过锚点所属 Run 的整个连续输出组，
  同一队员不同 Run 仍显示各自身份。边界见 [Run Process Detail Surface v53](../../contracts/run-process-detail-surface-v53.md)。
- 单元覆盖排队输入、后来插话、时钟回拨、分页与重入、旧字段兼容、连续回复和跨 Run 卡片组。
  生产组件浏览器夹具新增明确 DOM 顺序断言，不用同一个投影函数充当预期结果。
- Rust 扩展既有分页 owner 为 `camp_open_run_titles_and_start_boundaries_survive_message_paging`，
  保留摘要全部 case，增加冻结序号与旧 null 在 Open / Snapshot 中的投影断言；没有新增独立 Rust fixture。
  该 owner 属于 `slow-tests`，必须显式开启；仅 `extended-tests` 不执行它。

本机验证：`pnpm typecheck`、`pnpm test`、`cargo check --workspace`、Rust 格式检查通过。
定向执行上述分页 owner，以及 `camp_open_preserves_business_state_without_reading_event_history`，
验证有界分页读取、wire 字段与零事件历史访问。生产组件浏览器验收通过 38 个阶段、6 组主题尺寸、
28 项交互记录，包含新初始位置、完整附属卡片、resync 及仅在自身公开回复后移动。
浏览器使用独立临时 Chrome profile 与合成投影，Rust 使用隔离数据库；没有调用真实 Runtime。

## 执行行误回到启动状态（2026-10-13）

User 报告远程执行行在公开回复后再次显示连接／处理文案，随后确认 dsh 与 Trae CLI 也有同样现象。
基线 `50d50d3a46ec409420a9c1382ab5101ba16892bd`，分支 `fix/run-presence-startup`。
截图对应的只读运行记录显示：GitHub Copilot 已产生工具活动，输入受理却到 prompt 结束才确认。
共享预览把 `runtime_initializing` 无条件置于实际活动之前，导致同一 Run 被错误呈现为仍在连接。

- 按 [Run Process Detail Surface v52](../../contracts/run-process-detail-surface-v52.md)，在共享预览内部
  保留原始 Evidence 的 Run / executionEpoch 归属，再投影实际活动；不新增 Adapter 名称分支。
- 初始化期间只允许当前 Run、当前轮次的公开正文和工具替换连接反馈；旧／缺失／未来轮次、
  其他 Run、空白正文与原生阶段元数据仍不能覆盖。失败、停止和等待优先级不变。
- ACP 的 response-only ACK、交付水位及恢复隔离不变；没有 Rust、数据库或模型上下文变更。

测试准入：扩展既有 `conversation-run-presence.test.ts` 的启动反馈 owner 与
`scripts/lib/run-presence.test.mjs` 的生产组件夹具，没有新增独立测试 owner。
修复前失败输入是 `runtime_initializing` 与同轮次正文／工具同时存在；单元覆盖选择与轮次隔离，
浏览器覆盖实际共享组件。完整远程探针补足纯组件无法证明的 HTTP/SSE 读取、公开消息移动与重连。

本机自动验收结果：

- `pnpm exec vitest run apps/desktop/src/renderer/src/conversation-run-presence.test.ts apps/desktop/src/renderer/src/execution-events.test.ts`：2 文件、11 项通过。
- `pnpm typecheck`、`pnpm build:web` 通过；构建保留既有大 chunk 提示。
- `pnpm docs:test`（10 项）、`pnpm docs:check` 及相对上述基线的 `pnpm docs:check:ci` 通过。
- `pnpm test:run-presence-ui`：37 个阶段、6 组主题尺寸、27 项交互记录通过，含回执前后的当前工具、
  锚点与消息顺序、原文增量、停止／重试、慢读取和恢复。
- 同一隔离 Host / Chrome 远程探针分别加载已安装旧 Web 和候选 Web：旧版在正文、公开回复、
  工具和断线恢复后持续显示连接，复现通过；候选版显示当前活动，晚到 ACK 不产生状态回退，
  完成后执行行移除。包含 700 ms 延迟读取、390 px 窄窗口及主动切断 SSE 后恢复；两组无浏览器错误。

远程探针使用独立临时 data-dir、Skill Library、MCP 配置、Runtime 文件根与 Chrome profile，
只在合成数据库中注入执行记录，没有调用真实 Runtime；dsh / Trae 的真实模型运行不是本轮验收项。
未写入日常数据库，未安装或重启日常 App。修改只交付任务分支，待后续发布后生效。

## 执行行队员卡片与模型（2026-10-13）

User 反馈独立执行行缺少头像／姓名卡片入口与模型展示。基线
`a8704823a219334ac73603bc6bfcc5c7dde16373`，分支 `rovai/run-presence-member`，
独立 worktree `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-run-presence-member`。

- 将原消息头的队员卡片触发组件提为共享组件，执行行接入同一弹层、键盘与焦点路径；
  离开／删除队员保留静态身份，同 Run 回复后的执行行省去整组重复身份。
- 模型摘要与浮层复用消息组件。Run 的模型投影复用公开消息的冻结选择／默认观察函数，
  补齐适配器与强度；不读取当前队员配置，也不增加查询、数据库字段、事件或配置副本。
  旧 Host 的仅 modelId、null、未观察默认值分别按已有事实呈现。
- 当前合同为 [Camp Open Projection v29](../../contracts/camp-open-projection-v29.md) 与
  [Run Process Detail Surface v54](../../contracts/run-process-detail-surface-v54.md)。
- 扩展既有 Camp Open 零事件历史访问 owner，核对 Snapshot / Open 的显式选择和默认观察。
  选项矩阵仍由 `message_model` 纯函数 owner 负责，没有新增独立 Rust 测试或数据库 fixture。
  最小命令为 `cargo test -p rovai-core --features slow-tests --lib read_model::camp_open_slow_tests`
  和 `cargo test -p rovai-core --features slow-tests --lib model_metadata_uses_frozen_options_and_default_only_observation`。
- 生产浏览器 owner 增补头像／姓名点击、Enter／Space、关闭与焦点归还、当前资料与冻结运行模型的区分，
  以及跨适配器、默认／观察／旧 Host／缺失记录、队员删除／离开和连续回复；原执行行按钮数量断言
  只统计活动行本身，新增资料入口不计入停止／重试区。缩放窗口使用长模型名检查溢出。

类型检查、242 个 Vitest 文件／2658 项用例、5 项 Camp Open owner、1 项模型投影矩阵、
Rust 格式检查及文档治理通过。生产浏览器验收通过 38 个阶段、6 组主题尺寸与 29 项交互记录，
包含新入口及原有顺序、停止、重试、远程记录恢复回归。浏览器使用隔离临时 Chrome profile 与合成投影，Rust 使用隔离数据库；
没有启动日常 App、Core 或真实 Runtime。

交付前同步主干 `ffabe40b3`（PR #739 的停止文字确认），保留其非模态气泡、错误恢复、中英文和长姓名规则。
解决共享组件导入与浏览器夹具的冲突后，再次通过类型检查和完整执行行浏览器验收。


## 空会话与队员移除（2026-10-13）

User 在当前 Thread 确认交互稿后，明确要求去掉失效接收者的输入/附件保留长提示并开启 worktree 实现。
分支 `rovai/empty-thread-members`，基线 `a8704823a219334ac73603bc6bfcc5c7dde16373`。
共用 membership cutover；无数据库迁移，无模型上下文修改。

测试归属：扩展既有 `collaboration::slow_tests::removal_cutover_releases_work_persists_reconciliation_and_never_revives_the_old_run`
与 `remove_member_atomically_ends_membership_releases_tasks_and_reconciles_lead`，取消原最后成员拒绝断言并以
空会话保留、无接收者拒绝、重新邀请恢复替代；旧 lifetime、防重、任务释放与非终态全局删除保护保留。
不新增 Rust test function。Renderer 扩展原 Composer 与 Member Editor 的生产组件 fixture，数据库事务由上述 SQLite owner 验证。

本机验证结果：

- `pnpm typecheck`、`pnpm test` 通过；Vitest 242 文件、2658 项通过，通用 Node 回归 340 项通过、2 项平台限定跳过。
- `cargo check --workspace`、`cargo fmt --all --check` 通过。
  `cargo test --workspace -j4 -- --test-threads=4` 共 460 项通过、1 项既有 ignored。
  首轮并发执行遇到既有 `runtime_probe_process` 子进程输出清理超时；该 owner 单独重试与完整受限并发回归均通过。
- `collaboration::slow_tests` 的 46 项覆盖通过：首轮 45 项通过；全局移除 owner 修正测试夹具的终态值后定向重跑通过。
  包含最后成员 cutover、历史保留、空默认/广播拒绝、重新邀请、旧 lifetime 不复活和全局运行中阻断。
- `pnpm build:desktop` 通过。生产组件的 Composer Invitations 与 Member Editor 浏览器夹具通过，
  覆盖实际菜单/确认按钮、中文名称、逐会话影响、冲突刷新、失败重试、空会话保留、显式接收者修复及不自动发送。
  已核对空会话与永久移除弹窗的日夜主题截图。
- `pnpm docs:test`、`pnpm docs:check` 及相对上述基线的 `pnpm docs:check:ci` 通过。

浏览器验收使用独立临时 Electron userData、Skill Library 与闭合 transport，Rust 测试使用隔离 SQLite 数据库；没有调用真实 Runtime 或写入日常数据。
工作树路径与生命周期由当前 Thread 交接记录维护；PR 视觉对照见[生产组件截图](../../../.github/assets/empty-thread-members/README.md)。


## 执行记录存储精简：组合预览与删除回收（2026-10-14）

基线 main `a72d58840` 已包含 #743；Pi 入站预算保持 64 MiB。
本项对应 [Execution Record Storage v1](../../contracts/execution-record-storage-v1.md)。

- 新操作格式 2 只保留输入／结果，组合预览读取时生成；分页预选 ID 后才组合，薄索引只读取小字段。
  后台 ZCode 身份与完成判断、Trace 和文件授权读取同时衔接。旧格式 1 继续原路径收尾。
- migration 200 / schema 150 只增加标记与触发器、扩展 Blob 元数据 GC owner；不转换历史正文或 Blob。
  删除聚合在原业务事务中登记实际解除的引用；公共 GC 检查补齐无外键 Action 结果，沿用原回收与恢复。
- 扩展既有 lifecycle owner：升级 receipt 失败回滚、旧字节及 Blob 引用保持、重新打开、新旧分页、128 次
  进度归并、UTF-8 预算／短结果替换／状态更新；普通输出后缀在 SQL、event_log、活动 diff 及 Blob 中均不存在。
  扩展同一夹具验证正常删除的回滚、宽限期、最后引用释放、共享与无外键引用保护。
- 工作区 Rust：471 通过，1 项人工 Runtime smoke 跳过。定向 Evidence 17、文件授权 10、回收 3、删除 3、
  Trace 2 均通过；另运行当前 schema／准入矩阵、v168 升级 owner 和 10,000 条操作折叠／组分页 owner。
  准入测试中旧的 196/197 receipt 与 v33 trigger 期望同步到实际当前版本，不减少拒绝条件。
- 合成混合夹具中 6 条新操作：原本需重复保存的组合预览为 10,128 UTF-8 字节，现在固定标记合计 12 字节，
  少写 10,116 字节（此项 99.88%）。独立输入、结果和必要的长内容 Blob 保留；这不是整个数据库降幅。
  10,000 条既有夹具的单次折叠页为 1,621 字节；本次并行测试下读取 468 ms、载体夹具 527 ms，仅作功能
  回归记录，正式同环境性能／物理占用比较由第三项独立验收。未运行日常 App、历史清理或迁移。

交付对齐：main 随后合入 #748／#749（`3d4db22df`）。保留消息发送者投影和 migration 199，
本项改用 migration 200 / schema 150；升级夹具按顺序回退／推进，不重写日常实例。

## 执行记录存储精简：实时会话目录（2026-10-14）

基于组合预览 PR #750，独立于活动存储整合。对应 [Camp History v14](../../contracts/camp-history-v14.md)。

- migration 201 / schema 151 为 ContextManifest 增加创建后固定的目录模式标记，旧行默认冻结模式；
  两条新 Run 物化路径仅捕获原消息正文边界，不复制会话目录。数据库触发器拒绝为实时模式添加快照。
- 实时目录复用公开消息发布／撤回／删除规则，按可见消息发送时间排序；无消息回退创建时间，稳定 ID 破同时间。
  当前名称、改名和新消息即时生效；消息正文读取仍执行原边界，不借目录开放正文。
- 扩展既有冻结目录测试，覆盖旧快照、升级失败回滚／重新打开、旧会话后续 Run 零新增、模式固定、
  改名／消息／撤回／删除、updated_at 无效和同时间排序。另运行现有历史 7 项及 5 项上下文边界 owner。
- 工作区 Rust 471 项通过，1 项人工 Runtime smoke 跳过；文档三项治理通过。
- 合成夹具原快照 2 行／目录正文 143 字节，新 Run 为 0 行／0 字节，只保留一个模式字段；旧 2 行保持。
  此项每个新 Run 省去整份目录，不改变旧数据库的现有占用。

评审定点修正（User 28）：目录当前摘要与后台初始化

- 同一未发布 migration 201 增加 Camp 的消息时间／ID 和初始化标志，公开发布及可见性维护在原事务中完成。
  新 Camp 已确认无消息；旧 Camp 未初始化时走会话内有序索引回退。既有 housekeeping 每秒最多 32 个 Camp，
  会话间检查 10 ms 预算；完成后停止。目录不再全局聚合发布事件，正文边界及旧目录读取不变。
- 扩展原冻结／实时目录 owner（无新增 Rust 测试函数），在完整表结构与生产 WAL/NORMAL 配置、应用 bundled
  SQLite 3.53.2 上构造 601 个会话／120,000 条消息。目录每种状态 7 次、发布与撤回各 12 次，小样本仅报告范围。
  修改前读取 423.20–458.62 ms，全部未初始化回退 2.12–4.07 ms，初始化完成后 0.40–0.78 ms；不据此承诺稳定倍数。
- 升级含建索引 208.49 ms；601 个旧会话共 19 批，批耗时 1.19–2.14 ms，合计 30.31 ms（不含调度间隔）。
  发布语句含现有导航触发器为 1.29–1.84 ms，最新消息撤回语句 0.085–0.160 ms；这是事务内语句成本，
  不包含完整业务请求及提交。初始化不在 App 启动事务内汇总正文。
- 完成后的 SQL 只使用 camp_history_directory_idx；回退／重算只按 camp_message_history_activity_idx 定位本会话，
  用 event_log_entity_sequence_idx 判断发布。目录／摘要不选择 message.body、structured_content_json、event payload
  或 Blob。报告保留 EXPLAIN QUERY PLAN、Column/OpenRead/临时表等 VM 指令及对应 schema root，避免以应用计数代替 SQL 证据。
- 覆盖初始化期间排序一致、空与未知区分、发布／撤回事务回滚、旧消息撤回及 recall 关闭不触发摘要更新、删除最后
  发布事件／消息回退。既有 owner 继续覆盖新模式目录零新增、改名、正文边界及旧格式升级收尾。

原始样本及查询计划：[实时目录定向比较](live-directory-query-comparison.json)。这些数字只描述合成工作负载，
不代表日常实例耗时，也不声称现有存量自动缩小。

该修正的目标基线为 #750 `7c47ab128`：`cargo test --workspace` 471 通过／1 项人工 Runtime smoke 跳过，
`context::slow_tests` 44 项通过，另行运行含大历史测量的目录 owner 1 项通过；三项文档治理通过。


## 执行记录存储精简：操作与活动统一保存（2026-10-14）

第三项基于 #751，单独验收；三份 PR 已对齐 main `9d9f216b5`，保留 #743 的 Pi 64 MiB 入站预算、
#748 的发送者投影及 #752 的头像改动。当前合同为 [Execution Record Storage v2](../../contracts/execution-record-storage-v2.md)。

- migration 202 / schema 152 在 Evidence 上增加活动小字段；新操作固定格式 3，不再写独立活动行或完整 diff 副本。
  格式 1、2 按创建格式收尾，旧正文、Blob 和活动表不迁移。三份分别要求 schema 150、151、152 的 Core；
  正式 App 版本由发布流程分配，旧实现被既有数据库版本准入拒绝写入，不提供逆向迁移。
- 复用既有分类、生命周期归并和输出裁剪。固定只读视图兼容旧活动与新操作；分页／筛选、文件授权、
  Trace 和恢复 smoke 的 SQL 使用兼容来源。后台完成判断读取独立结构字段，不从截断输出推断成功。
  请求页按 Evidence 主键读取活动小字段；展开修改复用该次已授权的原正文，保留 diff 冲突状态。
- 保留 #615 的轻量索引、主线折叠、组内分页、计数及 Renderer 状态，不新增整轮正文或 Blob 扫描。
  没有可靠操作 ID 时保持独立观察，仅精确来源事件重放去重；同命令文本不合并。
- 扩展现有 lifecycle、迁移、Trace 和分页 owner，没有增加独立 Rust test function。最新基线工作区 Rust
  471 项通过、1 项既有人工 Runtime smoke 跳过，包含 doctest 阶段；定向 50 项通过（与工作区有重叠）：
  Evidence 17、文件授权 10、GC 3、删除 3、Trace 3、准入 2、旧领取格式／实时目录 2、历史查询 7、取消／未知结果 3。
  旧 v32／v33／v36／v38 领取输入走正式升级链后仍按冻结格式物化。
- `pnpm typecheck`、Renderer 的 ExecutionToolGroup／execution-window／execution-group-window／agent-run-file-preview
  四个文件 54 项通过；恢复协议 Node 测试 6 项通过。该阶段未运行打包 App smoke，后续补测见下文；日常实例未作验收对象。
- 生命周期夹具覆盖 128 次进度归并、UTF-8 预算、完整结果替换及状态更新；后缀 canary 不存在于 Evidence、
  活动元数据、event_log 或任何测试 Blob。Rovai 的持久化与日志调用链没有新增原始输出备份；不检查模型自己的原生日志。
  正常删除的候选登记沿用现有事务及 GC，覆盖回滚、宽限期、共享／无外键引用、重新引用与中断恢复。

以下空间／耗时来自隔离合成数据，不能推算现有日常数据库上线后自动缩小。PR 不自动合并，不停止或更新日常 App。

### 同负载空间与读取测量

原始样本：[execution-storage-comparison.json](execution-storage-comparison.json)。macOS 26.6／arm64、Rust 1.97.1、
未优化 test build，三个隔离数据库来自同一 seed，按格式 1、2、3 顺序重放同一事件流。基线为本次保留的旧格式写入／读取路径，
不是三款已发布 App 的端到端对比；旧格式测试视图直接读取原活动表，恢复原查询计划。测量时没有并行运行本任务其他构建或测试。

负载为 10,000 次操作（9,900 次普通命令、100 次约 40 KB 文件修改），20,000 次开始／结束事件，10 个叙述分隔；
另一个操作接收 128 次超限进度快照。三种格式均只有 10,001 条操作，进度操作实际 revision 更新均为 128 次。
普通输出截断后缀不落库；完整修改内容留在原 Blob，展开断言仍可获得大于 40 KB 的 patch。

| 指标 | 原格式 1 | 仅组合去重 2 | 统一活动 3 |
|---|---:|---:|---:|
| 操作行数 | 10,001 | 10,001 | 10,001 |
| 独立活动行数 | 10,001 | 10,001 | 0 |
| 选定 JSON 字段最终字节 | 163,421,487 | 83,907,024 | 82,566,788 |
| 相同字段按变更累计值字节 | 169,518,391 | 86,974,510 | 88,297,402 |
| 数据库页字节 | 186,716,160 | 104,497,152 | 94,928,896 |
| 数据库相对 seed 增长字节 | 183,611,392 | 101,392,384 | 91,824,128 |
| 主文件长度字节 | 186,716,160 | 104,497,152 | 94,896,128 |
| WAL 峰值字节 | 4,202,432 | 4,218,912 | 4,194,192 |
| Blob 正文字节／峰值 | 4,041,089 | 4,041,089 | 4,041,089 |

数据库页按 page_count × page_size，含索引、空闲页和固定 seed；主文件长度单列，最后未 checkpoint 的页可能仍在 WAL。
未以 VACUUM 或强制 checkpoint 制造比较结果。WAL 峰值为每次写入后的文件长度采样；该负载 Blob 单调新增，
末值即峰值。上述是 SQLite 页／文件长度口径，不是 APFS 独占 extent 或实际可回收字节。

JSON 口径为 Evidence 的组合／输入／结果预览及活动小字段，再加旧活动表的 diff JSON；不重复计 Blob 引用长度。
累计值只在操作 revision 改变时计同一组字段，不是操作系统累计写盘字节，也不含所有标量、索引及 WAL 重写量。
格式 3 把部分原标量放入小 JSON，因此该累计指标相对格式 2 增加 1.52%；数据库页仍减少 9.16%，独立活动行归零。
相对原格式 1，最终选定 JSON 减少 **49.48%**，数据库页减少 **49.16%**，相对 seed 的页增长减少 **49.99%**；
选定字段累计值减少 **47.91%**。必要 Blob 保持 4,041,089 字节，没有把应保留的修改内容当普通日志删除。

每项读取 5 个样本，下表是中位数（最小–最大），单位 ms，不用 5 个样本推导 P95。

| 读取 | 原格式 1 | 仅组合去重 2 | 统一活动 3 |
|---|---:|---:|---:|
| 首屏折叠页 | 767.380（707.731–1619.307） | 795.303（791.787–812.782） | 601.761（599.314–605.074） |
| 下一页 | 792.033（701.615–821.670） | 794.349（792.569–804.985） | 601.010（598.221–612.525） |
| 展开组（24 条） | 776.038（726.847–810.248） | 795.945（795.405–802.550） | 665.986（663.605–668.427） |
| 组内下一页（24 条） | 723.552（698.014–943.048） | 798.392（794.927–805.887） | 666.657（664.081–667.537） |
| 展开普通结果 | 0.227（0.210–0.236） | 0.212（0.205–0.229） | 0.185（0.167–0.197） |
| 展开文件修改 | 60.974（56.852–72.650） | 55.807（55.523–61.222） | 0.545（0.481–4.820） |

三个格式首屏／下一页均仅组合 2 条预览，组页各 24 条；这些读取完整正文次数与 Blob 读取次数均为 0。
展开普通结果为 1 次完整正文、0 次 Blob；展开文件修改为 1 次完整正文、1 次 Blob。计数位于应用读取入口，
不是 SQLite 的页 I/O 计数，也不把允许的单 Run 轻量元数据扫描算成完整正文读取。

128 个进度更新样本的 P50／P95（nearest rank）：
- 格式 1：1.3795／2.518 ms；每次 0 次显式完整正文读取、0 次 Blob 读取。
- 格式 2：0.9440／1.146 ms；每次 0 次显式完整正文读取、0 次 Blob 读取。
- 格式 3：0.7600／0.876 ms；每次 0 次显式完整正文读取、0 次 Blob 读取。

三种格式主负载总计时分别为 45,670／33,955／13,962 ms，包含事件构造和测量查询，不作纯事务吞吐承诺。
首次测量发现按 Run 查找新活动会拖慢展开；已改为选中 Evidence 主键读取，上表为修正后的最终对比。
最终格式相对原格式的首屏、下一页、组展开及结果展开均无该样本内的明显退化；仍保留既有轻量扫描，
没有声称消除所有长 Run 延迟。既有 10,000 条折叠／载体 owner 同次通过：折叠响应 1,621 字节、读取 289 ms，载体 501 ms。

复现入口：先按仓库说明准备依赖，再运行下列现有 owner（仅临时合成库，不启动真实 Runtime）：

```sh
cargo test -p rovai-core --features slow-tests --lib read_model::slow_tests::execution_evidence_is_counted_in_snapshot_and_paged_by_agent_run -- --exact --nocapture
```

定向失败已修复：旧领取输入夹具曾仅升级到旧 schema，缺少新目录列；现在走正式升级链，旧输入格式断言全部保留。
本阶段未执行真实模型组合；打包 App 升级 smoke 由下方补测覆盖。合并与发布留给 User，现存几 GB 不因上线自动缩小。


### 单文件授权定点修正与升级后旧数据测量

目标基线 #751 `2c8c30d8c`；文件授权按 Evidence 主键与存储格式分流。旧格式只选旧活动小主键后读取那条 diff，
新格式只读选中活动元数据；无 diff 的成功 Read/Write 按需提取本行预览的准入对象。原 Camp／Run／epoch、工作目录、
路径检查保留，不改 Renderer、分页／分组或权限系统。

复用 exact-evidence/worktree owner，生产 SQLite 3.53.2、完整表结构及 WAL/NORMAL，构造同 Run 的 512 条旧操作和
256 条新操作，每次 patch 输入 66,007 字节。先经正式 151→152 migration 测全旧，再添新记录测混合；旧 append-only
无 operation ID 单列。始终保留升级后的真实 UNION ALL 视图，未换为简化旧视图。每类 7 次，未并行运行本任务构建／测试。

| 状态 | 修正前授权 SQL（ms） | 修正后实际 Core 文件来源入口（ms） |
|---|---:|---:|
| 全旧，生命周期记录 | 15.54–26.29 | 0.86–1.33 |
| 全旧，append-only 记录 | 15.34–18.93 | 1.31–1.70 |
| 混合，选旧记录 | 16.86–21.05 | 0.86–1.03 |
| 混合，选新记录 | 16.99–18.83 | 0.079–0.221 |

前列是原 PR 的 SQL，后列包含真实 resolve_file_preview_source 的归属／工作目录校验；实际文件内容验证在计时后执行。
这是同机小样本范围，不作稳定倍数或 P95 声明。原查询计划明确 MATERIALIZE execution_activity 并装入同 Run 旧 diff；
修正后选中 Evidence 走主键，旧活动先筛小键再主键取单条 diff，新格式不访问旧活动表、不读输入／输出预览和 Blob。
仅无 diff 的文件操作会取选中行预览里的小对象；SQLite 为 JSON 提取仍须读取该列，不能声称从未读过预览列。

原始 [文件授权查询证据](file-authority-query-comparison.json) 保留实际计划、VM Column/OpenRead/临时表指令、
schema root 对应及实际入口经 SQLite authorizer 请求的列。authorizer 是列访问证据，不是磁盘页读取次数；旧格式仍读取
选中的完整 diff_projection_json，无操作 ID 时仍可能扫同 Run 的旧 source-ID 元数据，但不临时复制整轮 diff。
该修正不改变先前 10,000 操作同负载的存储减量；常规输出预算与必要修改 Blob 保持。


### 隔离打包升级与最终回归

`pnpm package:mac` 产物通过显式临时 userData、独立 Skill Library／MCP 启动；合成 schema 149 库经
Desktop → Host → Core 正式链升级至 152，未直接打开日常数据库。使用既有测试 downgrade/export helper 构造旧库，
只有合成夹具会执行该构造过程，产品启动和读取没有逆向迁移入口。

- 60 条旧公开消息在真实页面可读；512 条旧操作保持 12+12 翻页、不重叠，折叠组计数 512、展开组 12 条。
- 经真实 preload/Main/Core 文件入口读取旧文件，按需展开大于 60 KB 的旧修改详情；添加新 Run 后再次验证新旧历史。
- 显式指定合成 Codex app-server，并在发送前核对可执行文件。一次命令经历 40 次输出进度后仍为一条操作，正常结束，
  持久输出恰为 7,680 UTF-8 字节且标记截断；另一个文件修改操作可预览。新活动副本 0 行、新目录副本 0 行。
- 检查隔离 data-dir 的 614 个普通文件（包括数据库、WAL 和 Blob），截断后缀 canary 未出现；合成输入脚本位于其外。
  此检查不包含 provider 自有原生日志，不改变智能体实际接收结果。
- 关闭并重启这个验收 App，新旧预览及分页仍通过；旧操作预览列／Blob 引用摘要不变，合成输入仅投递一次。
  两个独立临时夹具均通过，提交第二次完整脚本结果；单次首次就绪约 1.086 s，重启约 0.523 s，包含壳层启动，
  不将两个样本当作稳定启动性能。

原始聚合结果：[storage-app-upgrade-comparison.json](storage-app-upgrade-comparison.json)。复现（两个路径须为新临时目录和隔离候选 App）：

```sh
ROVAI_STORAGE_UPGRADE_FIXTURE=/private/tmp/rovai-storage-upgrade-example \
cargo test -p rovai-core --features extended-tests --lib file_preview_authority::tests::run_activity_file_uses_the_exact_evidence_and_mission_worktree -- --exact
node scripts/smoke-storage-app-upgrade.mjs /private/tmp/rovai-storage-upgrade-example '/absolute/candidate/Rovai AI.app'
```

最终目标基线 #751 `2c8c30d8c`：`cargo test --workspace` 471 通过／1 项既有人工 Runtime smoke 忽略；
文件授权 10、旧领取操作升级 1、执行记录 17、升级后大 diff 查询 owner 1 通过；TypeScript 检查、
6 文件 114 项 Renderer/Main 定向测试、6 项恢复协议 Node 测试及文档三项门禁通过。
首轮并行构建期间一个既有 500 ms Runtime 清理测试超时，未修改超时阈值；该项独立重跑及随后完整 workspace 重跑均通过。
本轮只补具体查询和验收；审批、command.result、投递／结算、分页算法、权限系统及 Pi 入站预算没有变更。


## 执行记录存储精简：新操作正文与进度写入（2026-10-15）

按 User 消息 38，从 main `d6ae891f` 在当前使命 checkout 继续前三项定点优化。合同为
[Execution Record Storage v3](../../contracts/execution-record-storage-v3.md)，理由见 [V1.72-D46](decisions.md#v1-72-d46)。

新操作格式 4：精确匹配的 Codex 修改正文去重；每份输入／结果预览限 16 KiB 序列化 UTF-8；
结果摘要保存于同一行的小字段，只有摘要变化的进行中事件不重写正文／活动元数据、不推进展示版本。
旧格式 1–3、command.result、审批／投递／结算、正常删除 GC、Files Changed 聚合算法不变。
准备失败 Blob 候选登记是第四项，本轮不改。migration 203 / schema 153 不扫描或回填旧正文。

测试扩展既有生命周期、精确文件授权、大 Run 分页及打包升级 owner；新增纯函数 owner 仅覆盖
总字节预算与“必须同时匹配路径、种类、正文才删除原生副本”这两个独立回归，不新建完整数据库测试平台。
最小命令：`cargo test -p rovai-core --lib execution_evidence`；文件与升级入口使用既有 extended-tests owner，
大 Run 比较使用既有 slow-tests owner。实际验证和测量结果见本节后续数据。

定向结果：旧格式 1–3 继续原格式收尾，混合页与展开详情可读；CLI/Core 结果关联在分页和分组索引中均保留。
重启后仅收到完成状态仍保留最新摘要，晚到开始／冲突终态不覆盖已接受的结果证明；合法完整替换、
有序追加、取消围栏和未知结果处理复用原测试。升级注入收据失败时事务回滚，升级及重开后旧正文／引用逐值相同。
轨迹导出覆盖格式 3/4，SQLite authorizer 禁止正文读取和 DML，导出仍成功。

复用的生命周期夹具给出以下定点结果（字节均为 UTF-8 序列化长度）：

| 合成场景 | 原格式 3 | 新格式 4 |
| --- | ---: | ---: |
| 216,657 字节输入的数据库预览 | 216,703 | 16,383 |
| 含单份 36,016 字节 diff 的完整结果 | 72,495 | 36,466 |
| 相同保留前缀、128 次进度的正文 UPDATE 数 | 127 | 0 |
| 上述进度的活动元数据 UPDATE 数 | 128 | 1 |
| 上述进度的全部 UPDATE 数 | 255 | 128 |
| 上述进度的可见版本数 | 128 | 1 |

新格式仍有必要的摘要标量写入；此处不宣称 SQLite 零写入。原输入／完整修改可从所选操作详情读取，
普通输出仍为 7,680 字节，被裁掉的标识未出现在持久预览、Blob 或事件中。

在 bundled SQLite 3.53.2 / debug 完整表结构下，既有大 Run owner 对各格式播放相同的
10,000 个操作、20,000 个开始／结束事件，另加一个操作的 128 次进度。含 100 份宽输入和 100 份重复 diff。
格式 3、4 均使用升级后实际视图，比较保留的旧写入路径与新路径；历史格式 1、2 的数据仅作附录。
原始结果、每次读耗时及读次数见 [storage comparison](compact-operation-storage-comparison.json)。

| 同等负载 | 格式 3 | 格式 4 |
| --- | ---: | ---: |
| 操作记录／独立活动副本 | 10,001 / 0 | 10,001 / 0 |
| 预览、活动小字段及 diff JSON 逻辑字节 | 92,640,889 | 83,668,647 |
| 数据库页占用字节（包含空闲页） | 105,291,776 | 96,677,888 |
| Blob 字节／峰值（含宽限期候选） | 17,723,766 | 13,720,866 |
| WAL 峰值字节 | 4,358,992 | 4,227,152 |
| SQL 写入 JSON 值字节 | 108,021,282 | 90,238,551 |
| SQL 写入摘要值字节（另计） | 0 | 641,792 |

本样本数据库页约少 8.2%，Blob 少 22.6%，JSON 逻辑正文少 9.7%；把摘要值也计入后，
观测到的 SQL 值写入量约少 15.9%。SQL 值字节不是磁盘实际写入量，不能用 WAL 峰值推算累计 I/O。
这些是固定合成负载的新写入对比，不是日常实例占用，也不保证实际业务按同一比例减少。

该轮每条读取路径 5 次，范围为：首屏 693–954 → 625–828 ms、翻页 693–893 → 621–675 ms、
展开组 743–876 → 689–812 ms、组内翻页 740–943 → 689–737 ms；结果详情 0.191–0.330 →
0.158–0.333 ms，修改详情 0.723–4.735 → 0.505–8.920 ms（包含第一次 Blob 读取）。
首屏／翻页各读 2 份预览，组内页各读 24 份；均不读完整正文或 Blob。修改详情只读选中操作的一份正文／Blob。
沿用既有单 Run 轻量元数据扫描；小样本不宣称稳定加速或 P95。

整批写入第一轮为 19,542 → 24,488 ms，因新格式耗时升高而针对性复测，同等负载第二轮为
20,582 → 17,381 ms。不能据此宣布稳定吞吐提升或稳定退化；两轮数据均保留。复测的首屏为
653–1,059 → 605–619 ms，翻页 663–795 → 607–657 ms，展开组 715–1,027 → 667–686 ms，
组内翻页 716–978 → 666–684 ms。128 次进度处理总耗时两轮为 115.914/130.429 →
57.928/51.198 ms，正文写次数及逻辑字节减量一致。测试没有消除系统负载／缓存波动，
不以这组小样本替代长期生产延迟监测。

文件授权使用实际 Core 入口与升级后的实际视图。512 个旧 diff、128 个格式 3、128 个格式 4，
每份 diff 66,007 字节，每条路径 7 次：全旧单项 0.825–1.385 ms，混合中的旧项 0.863–0.970 ms，
格式 3 为 0.080–0.155 ms，格式 4 为 0.082–0.207 ms。查询计划、VM 步数、实际读取列和完整相关表结构见
[file authority](compact-operation-file-authority.json)。旧路径只读选中 diff，新路径仅按主键读所选小字段；
没有进入整轮联合视图或临时复制同 Run 的大正文。该文件保留的旧联合 SQL 对比是此前 #753 的参考，
不作为本次格式 3→4 的加速收益。

隔离打包升级使用基于 `be6ae4868` 的 macOS arm64 ad-hoc 候选，正式启动从合成 schema 149 升级到 153，
未安装到日常 App。512 个旧操作的正文／Blob 引用 hash 不变，旧会话、两页各 12 条、组计数／展开、
所选旧文件和新文件预览、混合历史与重启均通过。新 Run 生成 2 个格式 4 操作，活动副本／目录副本均为 0；
40 次进度仍维护同一命令记录，保存输出 7,680 字节，614 个实例文件均无截断后缀标识。重启后输入投递总数仍为 1。
启动至 Core 可用 1,113 ms、重启 509 ms，仅单次样本。机器可读证据见
[packaged upgrade](compact-operation-app-upgrade.json)。验收脚本使用准确按钮定位，并在自己的测试页忽略物理输入，
避免其他桌面操作点错会话或产生额外输入；业务桥接与“不得重复投递”断言保持。

验证命令与结果：

- `pnpm test:rust:pr`：473 passed，1 项既有人工 Runtime smoke ignored。
- `cargo test -p rovai-core --features slow-tests --lib execution_evidence -- --nocapture`：20 passed，
  包含 19 个执行记录测试及既有大 Run owner；文件授权 owner 10 passed，精确查询／升级 owner 独立复测通过。
- `--features slow-tests --lib` 下的 `current_migration_state_admission_matrix`、
  `database_contract_preflight_admits_current_and_rejects_future_store`、
  `export_queries_current_schema_without_reading_bodies_or_writing_state` 各 1 passed。
- `cargo check --workspace --all-targets`、`cargo fmt --all --check` 通过。
- `pnpm exec vitest run`：243 文件、2,686 项通过；`pnpm typecheck` 通过。
- `CARGO_BUILD_JOBS=2 pnpm package:mac` 与 `node scripts/smoke-storage-app-upgrade.mjs <fresh-fixture> <candidate-app>` 通过。
- `pnpm docs:test` 10 项、`pnpm docs:check`、按 `be6ae4868` base 的 `pnpm docs:check:ci` 及 `git diff --check` 通过。

日常 App、日常数据库、旧 Blob 和旧目录未修改；未清理、VACUUM、安装更新或自动合并。
运行结束汇总的独立详情及准备失败 Blob 登记缺口仍为明确未处理项，不承诺现有 GiB 随上线缩小。

## 旧上传头像坐标统一（2026-10-15）

按 User 消息 61 实施[已确认方案](model-context-change-legacy-avatar-source.md)：仅 Agent get 统一源图与原取景，
不迁移旧资产，不改变 UI/渠道。契约为 Member Avatar v3、Transport/CLI 41、Agent Output 14。
默认 workspace 471 通过、1 原有 ignored；头像 14、成员读写 1、CLI 29 通过。
Claude Code/sub2api 新旧共 8 Run 完成，候选四场景满足标准；基线复现空取景导致首次误设后纠正。
通用 Gate 两版同样两项数据库断言失败，24 槽位未运行，不作通过声明；
详见[验证索引](legacy-avatar-source-verification.json)。本次 PR/合并已由消息 61 授权。


## 内置头像裁切坐标统一（2026-10-15）

User 消息 66（1f83dd0c-00c9-45ce-8711-34650afd5914）授权修复内置头像读取／修改底图不一致。
沿用使命 checkout，从 main `059ef5157` 实施；当前契约为 [Member Avatar v4](../../contracts/member-avatar-v4.md)。

- 修改前：get 返回 packaged icon，crop-only 更新却读取保留的大图；修改后：二者使用同一 packaged icon。
- 首次修改生成 schema 3 源图与取景，后续编辑不累积裁切；保留内置文件及旧大图，不迁移任何已有头像。
- 读取字段、文件选择、空值语义和所有提示词保持，不改变核心模型上下文或工具输出格式；这是写入底图选择的修复。
  Transport/CLI 41、Agent Output 14、IPC 3、Envelope 2 保持，不触发新的上下文替换、冻结基线或真实模型 Gate。
- 测试扩展既有 `member_avatar::tests::imports_four_by_five_image_with_lightweight_crop_and_deterministic_identity`：
  四个内置头像的非居中区域按像素验证，随后从受管结果恢复完整取景；替换原来只证明“大图仍保留”的错误预期。
  `team_tool::tests::member_profile_reads_and_patches_preserve_scope_atomicity_and_replay` 只拥有 get/update、引用提交及回放衔接，
  不复制像素矩阵。不新增或退役 Rust 测试函数。
- 最小验证为上述两个 owner（后者显式启用 `extended-tests`），再运行头像 owner、默认 workspace、格式及通用文档门禁。

验证：增强后的头像用例在修复前失败，明确得到 768×960 大图而非 get 返回的 192×192 头像；修复后
头像 owner 14 项通过，成员读写／幂等 owner 1 项通过。默认 `cargo test --workspace` 为 471 passed、
0 failed、1 既有 ignored；`cargo fmt --all --check`、`git diff --check`、文档测试 10 项及
`docs:check`、以 `059ef5157` 为 base 的 `docs:check:ci` 均通过。
没有启动 App/Core/真实模型进程或修改日常数据；此前通用模型 Gate 的既有失败记录不被本次测试替代。


## Steer 合并与资格收口（2026-10-15）

User seq40 授权整个收口。主线 d6ae891f 与 Mission 064 b8349985 合并；新增 Migration 203／schema 153、
public Manifest 39，分支 37／14／10 与主线 37／12／6、38／13／9 保留原字节。
最终同步 main 2d4c61af7 的日期标记及锚点作者读取，补验普通测试、读取 owner 和生产界面。
Core 按活跃 Run 冻结身份提供 canSteer／reason；普通执行资格独立，实际发送前及原生 owner 校验继续收口。
TRAE CN 接入 `_session/steering`；CodeBuddy 异常保留原样并追踪。模型可见变化只继承主线发送者投影，
[逐段对照](model-context-change-steer-merge.md)不增加 Steer 提示词。

新增测试 owner：来源收敛拥有两条 199 的结构识别及幂等；populated legacy upgrade 拥有 accepted／unknown／
未完成来源的精确保全；Steer admission 拥有 UI/Core 共同冻结资格，fault recovery 拥有 ACK 崩溃窗口与后继 fence。
均需 SQLite 事务验证，不能由 Adapter 小文本探针替代。已有 ACP 回执 owner 扩充 TRAE；新 race outcome
断言器的反例证明重复、错轮和全失败会被发现。命令、结果、真实版本及模型见
[收口报告](../../research/runtime-monitoring/steer-hardening-2026-10-15.md)与其逐次证据。
九种 Runtime 均有合并后正例，TRAE 3/3；旧 Pi 0.87／Kiro 2.7 普通执行和提前排队真实通过。
CodeBuddy 2.132 新试验 3/3 通过，原失败保持未知归因，在问题 #762 追踪；不自动关闭。


## 用户 Steer（2026-10-14）

User seq18 确认 [R3](model-context-change-steer-shared-input.md)，实施分支 `rovai/mission/064`。
共用普通动态上下文与 RUN_INPUT，执行身份和环境保持冻结；仅 Runtime 层区分开始执行与注入。
用户一次多队员发送按队员能力处理，支持附件及纯附件；保留原有视觉风格及普通消息回执。
首批接入 Codex turn/steer，其余 Runtime 当时忙碌时排队。未安装日常 App，未创建 PR。
完整 [15 类 Runtime 报告](../../research/runtime-monitoring/steer-2026-10-14.md) 与 [证据索引](steer-verification.json)
区分原生探针、产品验收和尚未验证的边界。

新增的唯一独立 Rust owner 是 `delivery_queue::tests::active_inputs_preserve_initial_context_and_unsubmitted_sources`
（extended-tests）：一个 Run 的第二条输入在原实现中会复用第一份 Manifest／回执，旧单输入 fixture
不能覆盖这个事务边界。因此复用 DeliveryQueue fixture 增加该 owner，检查来源隔离、同水位多输入、
恢复原字节、逆序 ACK、目标 Run／epoch 失效、正常结束回队列、取消后不重启、未知不重发及迟到回执。
这些是持久化与跨模块事务语义，不能仅以纯函数测试替代。没有删除或禁用原测试。
迁移 199 回滚与旧证据逐字保留扩展既有 member_routing / claim_context 迁移 owner；
历史迁移 fixture 先恢复真实旧 schema，再用正式升级链回到当前 schema 后调用新业务 API。
版本断言更新为当前 37/14/10，既有旧数据、错误分支、FK、事务回滚断言保留。
既有 Codex 真实子进程夹具补充指定 turn 的正向接受／读取、目标不匹配、校验拒绝、内部错误与
Host 退出矩阵；只有明确的原生校验拒绝允许回队列，内部错误和传输中断保持未知。未为此增加独立测试。

主要复现入口（Rust 使用本机已配置的 rustup）：

```sh
cargo test --workspace
cargo test -p rovai-core --features slow-tests --lib context::
cargo test -p rovai-core --features extended-tests --lib delivery_queue::tests::
cargo test -p rovai-core --features extended-tests --lib db::member_routing::tests::
pnpm typecheck
pnpm exec vitest run apps/desktop/src/renderer/src/ThreadWorkspace*.test.ts apps/desktop/src/renderer/src/composer-*.test.ts apps/desktop/src/renderer/src/camp-composer-local-store.test.ts
node --test --test-name-pattern='Steer uses' scripts/lib/camp-open-projection.test.mjs
pnpm test:composer-input
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=41c8ca19238de8465c23ff0c030f5c7620dd2c02 pnpm docs:check:ci
```

真实 Smoke：先构建 Core 和 `rovai` CLI，放在同一产品 bin 目录；创建一个新的空绝对路径目录，运行
`node scripts/smoke-steer.mjs <空目录> <Core绝对路径>`。脚本明示独立 data、Skill Library、MCP、cache、
workspace，记录 Core SHA-256、实际 Runtime 版本、每条输入 Manifest、目标及结果文件。
使用现有登录和 Runtime 默认模型，本次不是固定模型质量 A/B。

最终默认 Rust workspace **471 passed，0 failed，1 个既有 ignored**；上下文 slow owner 53 项、
Delivery 与迁移定向 39 项通过，首次扩展失败项修正后的 19 项定向 owner 也已逐项通过。
Codex 子进程错误分类 owner、前端 12 文件 123 项、两项 Composer 集成、类型检查、双主题 UI
12 组（含 900 px / 200% 缩放）、文档测试及带基线治理均通过。未重跑整个扩展集；首次
992 passed / 16 failed / 8 ignored 的原日志保留，15 项在定向复测中修复，剩余一项为下述基线失败。

验证结果以 [JSON 索引](steer-verification.json) 为准。完整 12 Case 语义 Gate 缺固定 Judge 未运行，
保留证据不足。扩展套件中的 macOS provenance / IdentityChanged 失败在实施前 HEAD 的独立源码归档
中复现，没有修改或跳过该安全检查；不能将整套扩展测试写为全绿。

## 执行行原消息引用（2026-10-18）

按确认的交互稿在生产 `ConversationRunPresence` 接入原消息引用，沿用现有消息引用、批量输入列表、
Footer 与消息动作。来源严格使用 Run 的输入 ID，与时间线定位锚点和流式进展分离；支持首条摘要、
去重后的批量来源、用户／队员消息和纯附件，旧记录与撤回／缺失来源明确回退。

`useRunSourceNavigation` 只在用户定位时读取既有 `thread.messages.around`，保留一个有界消息窗口，
按版本合入时间线。新定位、其他会话导航与发送使旧请求失效，原消息聚焦、高亮和返回均不改草稿。
返回时先取消平滑滚动，再恢复原 Run 位置，避免浏览器已排队的滚动帧覆盖返回结果。
规范见 [Run Process Detail Surface v55](../../contracts/run-process-detail-surface-v55.md)。

扩展现有生产组件浏览器 owner，直接断言来源 ID、作者、数量、精确定位、可见焦点、草稿及迟到响应，
同时继续执行原有 Run 位置、身份／模型、执行详情、停止／重试、日夜主题和窄宽度场景。
本次默认测试发现主线 Product Contract Fingerprint 仍期待 schema 157；主线代码早已为 158，
仅将该旧断言同步到 158，不更改 Core schema 或迁移。

验证结果：类型检查、完整 `pnpm test`（247 个 Vitest 文件／2742 项；Node owner 356 passed、2 个平台 skip）、
默认 Rust workspace（474 passed、1 个既有 ignored）和 Web 构建通过。生产组件浏览器 owner 通过，
覆盖 38 个既有状态、6 组主题／窗口组合及新增来源交互；可见焦点、快速返回和粗指针目标均通过。
`pnpm docs:test`、`pnpm docs:check` 与以 `102b24f12a66af8151cb5b43cc4bb8e5feaafa69` 为基线的
`pnpm docs:check:ci` 通过。

## 撤回智能体检测简化（2026-10-18）

按 User seq17 要求，完整反向应用 PR #797 的合并提交 `7358905fcedfe52b8e28576c66b52f48e53f9096`，
恢复合入前的智能体管理界面和检测行为。回退在 `rovai/revert-runtime-detection-simplification` 独立 worktree
进行，基线为 `dc2863086c7ea397fd980e0c2e7735f80f6d08c2`；后续其他功能和业务数据不回滚。
31 个原变更文件的反向范围及增删行数逐项吻合；生产 `MemberManagement`、`RuntimeInstallationGuide` 和
`BusinessApp` 与 PR 合入前版本一致。没有新增表、迁移、缓存或替代实现。

测试退役依据：`independent_diagnostics_reuse_environment_and_same_target_check` 与
`supervisor_failure_belongs_only_to_the_captured_installation` 两个 slow owner 随其新增生产路径和合同一起撤回，
不以忽略或放宽断言保留。其余既有 owner 恢复原用例，保留程序选择、配置变更围栏、文件替换与本地保存等
原有检查；默认层没有新增或删除 owner。最低回归为 `pnpm test:rust:pr`、
`cargo test -p rovai-core --features slow-tests --lib application::runtime_check_environment::tests::`，
以及恢复后的静态发现与程序替换 owner。TypeScript、Vitest、桌面构建和文档门禁按当前开发规范执行。


## 文件预览读取复用（2026-10-18）

按 User seq15 确认的三项范围实施。独立分支 `rovai/preview-read-reuse`，worktree 为
`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-preview-read-reuse`，基线
`35cbc308dba33d02031bb21f93fa3b217bbf9b73`；无主线治理先行要求。

- Desktop 在现有 handle 中增加一条最近成功定位记录，只有相同 offset 命中才复用行号；原读取前后校验保持。
- Web 在现有 Analysis 保存大小和原始修改时间。分页/定位从块行号选定区间读取；属性变化、缺失匹配 Analysis、
  短读直接失败，不重新分析或全文哈希回退；其他读取继续完整摘要。没有全文字节缓存。
- 共享 reload 在 HTML 资源预留前确认同一文件及两端既有版本字段；仅健康、有内容和句柄的自动刷新可短路。
  候选由既有 finally 释放，只消费开始水位，手动/错误/无句柄恢复完整加载。

当前规范由 [File Preview v23](../../contracts/file-preview-v23.md)、[Host Web v8](../../contracts/host-web-v8.md)
和对应架构拥有。旧已接受合同冻结，新增继承条款并更新现有导航；没有新增公开字段、协议版本、依赖、调度或重试系统。

效果计数都在现有测试夹具中，不建立基准测试框架：

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| Desktop 第 524289 行，3.5 MiB 前缀 | 定位 3.5 MiB，分页再次读 3.5 MiB 前缀及 256 KiB 正文 | 定位一次，随后只读 256 KiB 正文 |
| Web 2165539 字节文件，第 250000 行 | 候选、定位、分页三次全文扫描/摘要，共 6496617 字节 | 候选 2165539 字节/1 次摘要，定位 65536 字节/0 次，分页 308200 字节/0 次 |
| 慢 HTML 的同版本重复通知 | 同一个新版本准备两次 HTML | 准备一次；补刷仅取得并释放同版本候选 |

Desktop 与 HTML 修改前由本 Thread 的临时夹具复现；Web 修改前依据原 scanner 三次完整读取路径，
修改后均由实际读盘字节和摘要/HTML 准备计数断言。分页读取包含块内前缀和最多三个 UTF-8 边界字节。

Rust 扩展既有 `resources::content::tests` owner 并按当前合同改名，没有新增或删除测试函数；
只替换已退出的“同候选分页必须拒绝等属性改写”断言。保留并扩展完整读取摘要拒绝、原始时间精度、
读中变化、UTF-8 跨块、长行、缩短和空文件；Host 集成同步接口约定。
共享控制器继续保留后台不读、失败不重试与迟到结果释放，并补同版本、水位推进、文件身份、摘要差异和强制恢复。

验证已通过：类型检查，五个相关 TypeScript 文件的 144 项测试，Web 读取 owner 定向测试，
完整 `pnpm test`（246 个 Vitest 文件／2793 项，脚本 357 passed／2 个既有平台 skip），
默认 Rust workspace（474 passed／1 个既有 ignored），Desktop/Web 构建，以及
现有 Host HTTP 集成 `node --test --test-name-pattern='Desktop and Web share' scripts/lib/host-web.test.mjs`。
Host 验收使用独立临时 data、Skill Library 与 MCP 路径，不启动模型。
`pnpm docs:test`、`pnpm docs:check`、以上述真实 base 为输入的 `docs:check:ci` 与 `git diff --check` 通过。

## 智能体检测减重第一批（2026-10-18）

按 User seq25 从撤回后的实现逐项实施公共减重与 Codex，工作基线为
`9a5127ed8a26531808a61c62565c097cf498fd43`，使用独立 `rovai/runtime-check-weight` 分支。
保留“重新检测”“检查状态”的名称、位置、文案、状态映射、安装／登录引导、参数选择与平台准入。
本批不包含 MiniMax 参数工作移位、ZCode/Grok/Claude/Antigravity 的后续局部优化或冷启动顺序调整。
没有新增表、迁移、后台服务、持久字段、缓存体系、第二套 generation 或检查管理器。

### 删除或合并的工作

- 本批原规则为单项检查复用有效入口与搜索环境、无有效入口才补充搜索；2026-10-26 已由
  [Issue #891 修复](#runtime-path-与主动检查一致性2026-10-26)替代为主动单项检查总是先刷新。显式重新检测仍捕获一次环境。
  有效输入未变化时保留搜索 generation，同目标请求继续由既有 pending/active 队列合并。
- 静态发现直接复用已有文件身份，原生稳定文件完整哈希为未变 0 次、首次或升级 1 次。
  必要校验与手动版本补读均留在各 Runtime 工作任务，形成既有 `VerifiedDiscoveredRuntimeEntry` 后短提交；
  收集循环不再执行第二遍完整哈希或等待版本命令。正常候选成功时不构建保存路径的备用候选。
- 完整检查复用同轮入口指纹，移除 health 层重复完整哈希，保留结束前的身份复核。
  Windows shim、解释器和 ZCode bundle 依赖继续按原有规则校验，不套用普通原生程序的 0/1 计数。
- Codex 删除独立 `login status` 和第二个 app-server；一个临时进程依次完成初始化响应校验、
  `initialized` 通知、现有 Host 认证判定及分页模型读取。必要版本与 Schema 能力检查继续保留。
- 设置页改为行级 pending/error；完成后按钮与事件共用 `runtime.status.get` 和统一安装列表读取，
  一个在途 Promise 加补刷标记处理读取期间及补刷期间的新事件。取消这条路径对 Overview、导航、记忆、
  `health.check` 中 Git 探针的等待。

### 保留的正确性边界

自动启动发现和页面打开仍静态；手动重新检测只补读未知或新程序的有界版本，未变可信版本直接复用。
版本命令期间程序变化则丢弃该结果，后续显式重扫可读取新程序；未知版本不构成额外执行禁用条件。
静态结果不写完整 Ready，同一程序的检查失败不会被普通重扫清除。真实 Host、消息投递和权限行为不变。

合并及写回复用现有安装 ID/version、文件身份与 locator；路径消失／恢复只在实际变化时推进 version。
当前安装身份决定安装是否变化，健康快照决定旧 Ready／认证／能力是否有效，旧 F1 快照不会让已发现 F2
在检查开头再次推进版本。Supervisor 在数据库锁外观察文件，返回后复核原目标才写失败；无法证明归属的
错误只交给原请求。公开错误也按当前已记录指纹筛选，防止旧快照保留 F1 错误或隐藏 F2 的合法超时；
该读取只用现有数据库身份，不做文件 I/O。没有不断改变 active attempt 目标，也没有新失效层。

首次 Pi 目录请求从未知安装变成已建立安装时，后来的请求保守排队一次；已知同目标请求继续合并。
本批不为消除这个首次重复增加例外管理。

### 定向回归与 owner

复用 `runtime_check_refresh_tests` 的 Core／临时进程夹具，增加三个 slow owner：

- `independent_checks_reuse_environment_and_same_target_check`：原正式／草稿用例覆盖配置切换，不能证明
  同代次 A/B 独立结束、同目标合并及 F1 健康快照 → 静态 F2 → 检查 F2 的版本稳定。
- `supervisor_failure_belongs_only_to_the_captured_installation`：普通完成路径不经过 Supervisor 超时分支；
  该 owner 控制文件检查与数据库提交间的替换，验证旧错误归属、合法失败持久化及锁外文件检查。
- `manual_rescan_reuses_versions_and_discards_replaced_version_responses`：现有纯发现 owner 不拥有版本持久化，
  用同一临时程序验证被动发现零进程、重复重扫只补读一次、升级重读、检查失败保留及版本执行期间替换。

这些失败涉及现有管理器、数据库和子进程之间的时序，纯 helper 测试无法覆盖；全部沿用已有夹具与 slow 层，
没有新增默认层 owner 或测试框架。原发现 owner 补充 0/1 哈希计数，原发现提交 owner 补迟到缺失／恢复／升级；
Codex 原认证 owner 扩展为认证、通知、分页、Schema 分支和进程回收矩阵，原目录 owner 保留“目录成功不替代完整检查”。

最小相关命令：

```sh
cargo test -p rovai-core --features slow-tests --lib application::runtime_check_environment::tests::
cargo test -p rovai-core --features slow-tests --lib discovered_runtime_verification_keeps_database_available_and_identity_after_restart
cargo test -p rovai-core --features slow-tests --lib agent_profile::slow_tests::
cargo test -p rovai-core --features slow-tests --lib codex_catalog_waiters_share_refresh_without_satisfying_full_validation
cargo test -p rovai-core --features slow-tests --lib pi_catalog_observations_are_independent_of_health_and_fenced_by_identity
cargo test -p rovai-core --features slow-tests --lib runtime_check_task_ids_clear_activity_after_success_panic_abort_and_shutdown
cargo test -p rovai-core --features slow-tests --lib application::tests::runtime_check_manager_
cargo test -p rovai-core --features extended-tests --lib codex_probe_requires_login_unless_native_provider_explicitly_waives_it
cargo test -p rovai-core --features extended-tests --lib installed_catalog_discovery_runs_only_bounded_identity_commands
```

设置页专项使用生产 `RuntimeInstallationsPanel`，覆盖行级等待、错误隔离、按钮路由、启动设置和原有状态文案。
其 `onReload` 为夹具回调，因此不据此声称验证了真实 BusinessApp 全链路；生产接线另以源码核查确认只调用
Runtime 聚合及安装列表。刷新函数用受控 Promise 验证首读与补刷期间的连续事件，以及失败后的补刷／重试。
夹具中原已过期的环境编辑器、隐藏 Cline 和通知数量断言按当前页面纠正，不改生产界面。

### 验收结果与同机计时

本地定向 Rust 共 49 项通过，包含上述 owner、既有程序替换后的有界重试 owner 以及 32 项 managed 安装／快照
回归。默认 `cargo test --workspace` 为 474 passed、0 failed、1 个既有 ignored；类型检查、Web 构建及设置页
生产组件专项通过。完整 `pnpm test` 为 246 个 Vitest 文件／2784 项通过，Node owner 为 357 passed、2 个平台 skip。
提交前合入主线 `6554b12fffec44835843fc480c9b436e79540a2a` 的独立文件预览变更，继续运行类型、Node、
Web Rust 和差异文档门禁。最终错误归属修正后，7 项并发／环境 owner、32 项安装／快照 owner、
2 项错误投影 owner 再次通过；Web Rust 11 项通过。

同步主线后的完整 Vitest 为 2794 passed、1 failed：文件预览既有真实 watcher 用例等待通知超时。
该 owner 在本 worktree 单独复测 59 项通过，在未修改主线源码归档中也通过，但整套运行仍出现失败，
包括关闭 Vitest 缓存的一次运行。保留该本机验收限制，不改或跳过该测试，也不将其认定为已证明的基线失败。

计数与竞态结论：

| 验收 | 结果与证据范围 |
| --- | --- |
| 普通原生未变／首次／升级发现 | 既有发现夹具完整哈希计数分别 0／1／1，提交路径不再补一遍哈希；不是 Windows 多文件入口计数 |
| 版本补读 | 被动发现 0 命令；同一目标三次手动重扫只读一次版本；升级重读；命令期间替换的结果不入库 |
| Codex 直接启动 | 未复用版本的夹具为 3 次，可选 experimental Schema 分支 4 次；相对原流程 5／6 次，删除 login 与第二个 app-server；可信版本再少一次 |
| 并发与归属 | A 尚未结束时 B 已结束；同目标合并；同 generation 迟到扫描、路径缺失／恢复、F1 快照与 F2 安装、旧超时及异常均通过 |
| 刷新终态 | 首次读取、补刷期间连续事件均读到终态；检查后读取只接 Runtime 数据，生产接线源码核查无 Overview／导航／记忆／Git |
| 清理与功能 | Codex 临时进程回收、取消／panic／shutdown、目录请求不替代完整检查通过；参数、权限、默认模型及失效目录的原有测试保留 |

同一 macOS arm64 机器、相同现有登录及默认配置，以独立全新数据库／Skill Library／MCP／runtimeFilesRoot
启动改前 Debug Core（`9a5127ed8`）与改后 Debug Core，先等首次静态发现结束，再依次做三次重新检测、
三次 Codex 完整检查，每次分别读取 Runtime 与安装列表。前后 16 个已发现入口的路径及指纹逐项相同，
Codex 为 `0.162.1`；不向模型提交 Prompt。以下为 RPC 发出至回复耗时，单位 ms：

| 场景 | 改前 | 改后 |
| --- | --- | --- |
| 初始化后首次手动重新检测 | 7637 | 924（包含未知版本补读） |
| 后续两次重新检测 | 7631／6396 | 70／68（可信版本复用） |
| 三次重新检测后的数据读取 | 24／14／16 | 3／4／4 |
| 三次 Codex 完整检查 | 2285／2132／1736 | 2297／1940／2032 |
| 三次 Codex 检查后的数据读取 | 15／15／16 | 5／4／4 |
| 全新 Debug Core／数据库启动到首轮发现完成 | 13295 | 14765 |

改后最终复测日志中的首轮静态发现阶段为 4155 ms，首次手动发现阶段为 840 ms，重复发现阶段为 11／12 ms；
它们不含各自前置等待，不能替代上表总 RPC／启动耗时。改前没有相同发现阶段日志，不推算阶段提升。
数据读取的改前入口为 `health.check` 加安装列表，改后为 `runtime.status.get` 加安装列表，表示实际接线变化。

计时表使用最终错误投影修正后的重新构建。第一次改后样本的重新检测为 748／71／73 ms，Codex 为
3766／1986／2080 ms，冷启动为 12148 ms；同样保留该样本，不只选择更快的数据。
重复重新检测已明显减少等待；Codex 完整检查和冷启动耗时没有稳定下降，不能仅凭减少两次进程就宣称端到端提速。
首次版本补读、实际认证／网络／模型 RPC、Schema、完整检查的结束前文件复核及最后短读取仍需等待。
全新数据库与可选子系统初始化仍保留，首轮全量发现完成也不等于首个智能体可用或 UI 开始响应。
本轮没有测桌面真实点击到渲染总耗时，没有实测 Windows，亦未重跑整个 Rust 扩展／慢速集；这些边界不写成通过。


### PR #807 前端终态恢复补验（2026-10-19）

本次修订只涉及三处现有前端生产文件，不再改后端或后续智能体批次：

- 行操作锁只由本行实际 pending 请求持有。服务端徽标仍使用原状态映射；请求结束而最终读取失败时，旧 `checking` 快照不能继续禁用“检查状态”和“启动设置”，错误仍留在对应行，重复请求继续由 Core 合并。
- 共享安装列表改为复用已有 `createRuntimeRefresh`。该函数只增加返回最后一次读取结果的能力；Overview、成员与 Runtime 共享一个在途请求和补刷标记。终态刷新加入旧列表请求时，必须补读后才向所有等待者返回最后结果，补刷期间的新事件也按原规则处理。
- 按钮名称、位置、文案、状态映射、安装登录引导和平台准入不变；没有新增表、持久字段、缓存、队列或协调器。

定向验证：

- 现有设置页 Electron 夹具挂载生产 `RuntimeInstallationsPanel`：先显示真实组件的 checking 快照，结束本行请求，再令替代 `onReload` 失败；原行错误保留，检查与启动设置重新可用，点击原行能重新发起检查，另一行的错误不受影响。此项仍是受控回调的组件验证。
- 现有 `runtime-check.test.ts` 补充生产所用两个刷新函数的组合时序：较早安装列表尚未返回 → 检查完成 → Runtime 终态刷新 → 旧列表返回 → 再读新列表。验证新状态与新列表一致，先前列表等待者也收到最终列表；原有首轮、补刷期间连续事件及失败恢复用例继续通过。这不是完整 BusinessApp 挂载测试；生产接线另按源码及下述真实 App 核对。
- `pnpm typecheck`、定向 Vitest 191 项、`pnpm test:settings-workspace` 通过。完整 `pnpm test`：246 个文件 / 2796 项 Vitest 全通过；Node 357 passed、2 个既有 skipped。本次整套文件预览 watcher 用例通过，未对其做任何修改；上次超时记录保留。

真实 App 验收使用 `pnpm dev`、macOS arm64、独立全新 userData / Skill Library / MCP 配置、实际 Debug Core 与本机 Codex 0.162.1、Claude Code 2.1.287；没有发送 Prompt。计时从真实鼠标点击事件到本行按钮恢复后的第二个 animation frame：

| 操作 | 点击到恢复操作 | Core 检查 RPC | 结果 |
| --- | ---: | ---: | --- |
| Codex 普通检查 1 | 2096 ms | 2073 ms | 本行恢复；另一行检查和设置可操作 |
| Codex 普通检查 2 | 1998 ms | 1968 ms | 同上 |
| Codex 普通检查 3 | 2215 ms | 2194 ms | 同上 |
| Codex 检查期间点击 Claude 检查 | 1890 ms | 1866 ms | 两行独立结束 |
| Codex 最终读取故障注入 | 1894 ms | 1881 ms | 行内错误保留，检查与设置恢复 |
| 故障解除后原行重试 | 2124 ms | 2095 ms | 检查成功，行内错误清除 |

故障注入仅在验收进程内临时拦截 Renderer 的 `runtime.status.get` / `runtime.installations.list`：先收到 Core 真实 `checking: true` 快照，再拒绝后续读取；`runtime.product.check` 始终调用真实 Core。未向产品加入注入开关。截图确认原有页面内容与可操作入口。

各次检查 RPC 结束到该行恢复期间只发起 Runtime 状态和安装列表读取，没有等待 Overview、记忆或 Git 探针。全 App 在第三次检查期间另有既有导航、使命与通知轮询，与检查完成回调分开；最初把整个 App 期间都断言为“没有导航请求”过宽，因此按真实完成区间核对，未为此修改生产逻辑。

以上为开发版 App 的实际操作样本，没有旧版桌面点击到渲染对照，不能据此证明单项检查稳定提速，也不替代 Windows 或打包 Release 验收。主要等待仍在约 1.9–2.2 秒的完整检查 RPC；本次不继续扩展后端验证或增加性能平台。

## 单项检查必要工作减重（2026-10-19）

基于主线 `7000026f3ed148233591c00dcc44784525c0835e`，在独立 worktree 的
`rovai/runtime-check-simplify` 分支实施。没有恢复此前撤回的界面改动；“重新检测”“检查状态”、
页面布局／文案／状态映射、安装登录引导与平台准入保持。PR #807 的行级等待和 Runtime 刷新不重做。
当前边界同步到 [Runtime Launch v64](../../contracts/runtime-launch-and-verification-v64.md)。

### 删除与复用的实际工作

- MiniMax 普通检查保留 initialize、认证、一次必要 session/new、当前模型及目录一致性，删除逐模型
  set_config_option 和最后恢复；仅原 CatalogOpen 请求保留完整参数遍历。同一 Check Manager 的
  pending/active 用既有 trigger 区分 MiniMax 意图，同意图／同目标继续合并；首次目录回退仍传递目录意图。
- 健康成功与完整目录成功使用既有字段分别写入。普通检查保留同一有效身份／配置的完整目录和原时间；
  无完整目录只保存已读信息，不以健康成功时间回填 MiniMax 目录时间。现有 unavailable/invalidated
  使部分结果不参与已保存参数过滤，没有新增目录状态或持久字段。复用成功写入 helper 删除原重复 SQL。
- Pi 删除 new_session/get_state/switch_session/get_state 四次演练 RPC 及专用 locator 记录；
  Grok 删除 resume 与重复 set_model，Kiro 删除重复 set_model；同步收窄普通 Ready 要求，不伪造实测标志。
  ZCode 由明确 probe 入口跳过 subscribe/setMode；正式 new/resume 保持，未以有无 Prompt 判断。
- 将既有可信版本传给现有检查函数；成功、同身份、未失效能力快照可复用 Claude/Antigravity help 与
  Codex 普通 Schema 证据。动态认证、模型读取、最低版本/启动代际门槛仍保留。OpenCode 版本为空时沿
  既有代际门槛失败，不再运行第二遍版本命令。Codex 仍一个 app-server 完成通知、认证及模型分页，
  可选 Fast 缺证据时仍可单独导出 experimental Schema，失败不降级普通能力。
- 安装 ID/version、locator、文件身份与锁外复核沿已合入流程；正式运行、恢复、权限及模型应用未删改。
  没有新表、迁移、缓存体系、后台服务、检查模式、第二套代次、管理器或性能平台。

### 定向验收与计数

新增一个 MiniMax 集成 owner，使用现有 Core/DB/Check Manager 与临时协议进程；准入原因及旧测试要求
退役记录见 [Rust 测试准入](../../development/testing.md#单项-runtime-检查减重)。其他情况扩展原测试。

| 验收项 | 结果 |
| --- | --- |
| MiniMax 2/8 模型、检查先到/目录先到 | 普通检查模型设置 0、恢复 0；目录请求为 N+1；各 probe 仅一次 session/new、Prompt 0；pending/active 同类合并、异类不冒充完成 |
| 首次目录及参数保留 | 无健康快照时完整检查回退取得全部参数；部分结果 unavailable；完整目录内容/时间保留；失效后部分结果不复活旧目录；前端保存参数不被过滤 |
| Pi/Grok/Kiro/ZCode | 既有协议夹具计数分别删除 4/2/1/2 次 RPC，必要初始化成功；Grok/Kiro 当前模型缺失仍失败；Pi/ZCode 正式会话与 ACP 恢复测试保持 |
| 静态证据与版本 | 可信版本不运行版本命令，未知值仅一次；Claude 4→2、Antigravity 3→1 个直接进程；Codex 可信版本/普通 Schema 证据时 1 个 app-server，可选缺证据分支另加 1 个进程；动态认证/模型失败仍失败 |
| 安装变更/并发 | 既有环境、版本命令期间替换、Supervisor 旧失败归属、同 generation 安装变更用例通过；原安装 ID/version 与身份保护未绕开 |

进程/RPC 精确计数来自受控协议进程夹具与生产调用路径，不称为对真实 CLI 后代进程的采样计数。

已通过：默认 Rust workspace 474 passed、1 ignored；health 24 passed、3 ignored；OpenCode 空版本
定向用例；ACP 正式协议 67 passed、2 ignored；Pi Host 15 passed、1 ignored；ZCode transport 5 passed；
Adapter 25 passed；环境/管理器 8 passed；安装/快照 32 passed；最终 MiniMax 集成 owner；Renderer 参数
36 passed；类型检查、Debug App 构建、cargo fmt、差异空白检查，以及 docs:test/docs:check/docs:check:ci。
各集合有交叉，不将重复执行累加成总覆盖数。

### 同机真实 App 前后对比

使用同一 macOS arm64 与原生程序/账号配置，前后各运行隔离 `pnpm dev` Electron + Debug Core，
等待静态发现完成，再对每款依次执行首次检查和三次重复检查。Core RPC 包围真实 runtime.product.check；
UI 时间从真实鼠标点击事件到本行按钮恢复后的第二个 animation frame。前后安装列表的路径、指纹、
版本逐项相同；所有检查 Prompt 为 0。不是夹具耗时，也不是打包 Release 测试。

原生版本：MiniMax 0.6.12、Pi 1.1.0、Grok 1.0.50、Kiro 2.21.1、ZCode 0.16.9、Claude 2.1.287、
Antigravity 1.4.2、Codex 0.162.1。每格「UI / RPC」，单位 ms；超时样本保留：

| 智能体 | 阶段 | 首轮 | 重复 1 | 重复 2 | 重复 3 |
| --- | --- | ---: | ---: | ---: | ---: |
| MiniMax | 改前 | 1666 / 1619 | 1549 / 1510 | 1549 / 1509 | 1516 / 1481 |
| MiniMax | 改后 | 1649 / 1615 | 1433 / 1392 | 1416 / 1377 | 1400 / 1360 |
| Pi | 改前 | 766 / 720 | 501 / 482 | 516 / 487 | 616 / 589 |
| Pi | 改后 | 515 / 481 | 332 / 307 | 315 / 301 | 332 / 308 |
| Grok | 改前 | 749 / 716 | 766 / 739 | 749 / 715 | 749 / 716 |
| Grok | 改后 | 815 / 781 | 699 / 661 | 683 / 652 | 682 / 646 |
| Kiro | 改前 | 4285 / 4252 | 2017 / 1988 | 2050 / 2009 | 2050 / 2017 |
| Kiro | 改后 | 2334 / 2297 | 2067 / 2037 | 2084 / 2050 | 2117 / 2081 |
| ZCode | 改前 | 4469 / 4428 | 1400 / 1360 | 1400 / 1358 | 1400 / 1367 |
| ZCode | 改后 | 1400 / 1367 | 1067 / 1028 | 883 / 853 | 866 / 839 |
| Claude | 改前 | 1166 / 1134 | 933 / 892 | 932 / 902 | 916 / 890 |
| Claude | 改后 | 1149 / 1114 | 883 / 847 | 883 / 849 | 850 / 825 |
| Antigravity | 改前 | 9856 / 9813 | 31658 / 31616（超时） | 9939 / 9885 | 7145 / 7104 |
| Antigravity | 改后 | 5169 / 5133 | 6687 / 6658 | 6071 / 6041 | 5487 / 5456 |
| Codex | 改前 | 3301 / 3263 | 1867 / 1829 | 1834 / 1798 | 4853 / 4830 |
| Codex | 改后 | 2250 / 2219 | 1717 / 1682 | 1728 / 1684 | 2451 / 2416 |

三次重复 UI 中位数：MiniMax 1549→1416、Pi 516→332、Grok 749→683、Kiro 2050→2084、
ZCode 1400→883、Claude 932→883、Antigravity 9939→6071、Codex 1867→1728 ms。
MiniMax 确实取消了本机 7 模型原来的 8 次设置，但只减少约 0.13 秒；Kiro 没有观察到提速。
Antigravity 改前包含一次超时，Codex 也有波动，不能用三次样本宣称稳定网络性能收益。

本机额外验证 MiniMax：四次普通检查后目录仍 unavailable，目录首次请求用约 1410 ms 补全参数并成为
fresh；随后普通检查保留完整内容和目录成功时间、更新健康成功时间，按钮与启动设置可操作。额外操作的
animation-frame 监听等待超时，后续直接读取真实 RPC 完成和按钮状态确认功能；这次补验没有
混入上述计时样本。既有 TTL 后目录自然 stale，没有用健康检查刷新时间。参数保存和请求竞态使用上述
定向夹具验证，不将帧监听超时误记为 Core 超时。

首次指隔离数据库的首次健康检查，不代表 OS 冷启动或原生首次安装；前后顺序测试仍受原生缓存/网络影响。
本轮没有单独测程序升级耗时、Windows、打包 Release 或真实用户任务恢复，升级身份由已有定向测试覆盖。
认证/初始化/当前模型读取、进程回收、完整检查结束前文件复核及最终 Runtime 数据读取仍需等待；MiniMax
完整目录打开仍执行全参数读取。未压缩超时、提前结束等待或在后台继续原普通检查。验收 App 已受控退出，
独立 userData/Skill Library/MCP 未触及日常 App。完整计时 JSON、身份清单与截图随本次 Thread 附件交付。

## 单项检查末尾复核与 Codex Fast 导出减重（2026-10-19）

本次以 PR #812 的 `543ac8f63` 为对照，只补两项实际工作删减，保留前述 MiniMax、Pi、Grok、Kiro、
ZCode 等已完成的调整。没有再改协议范围、目录、Renderer 或界面，没有新增数据表、迁移、缓存、后台服务、
检查模式或管理层。

- 末尾 `verify_runtime_entry` 接收本轮 `VerifiedDiscoveredRuntimeEntry` 中与指纹成对验证的文件身份，
  直接使用既有 `verify_executable_integrity` 的 `Unchanged` 分支；保留执行条件、locator、安装 ID/version、
  搜索代次和替换后的旧结果拒收。I/O 仍在数据库锁外。Windows 命令包装入口沿用原依赖完整校验例外。
- 删除 Codex 为 Fast 单独执行的 `generate-json-schema --experimental`。普通 Schema 顺带提供的 Fast
  字段及同程序已有正向证据可以保留，缺字段不启动补证进程。必要普通 Schema、初始化响应校验、
  `initialized` 通知、原生认证、分页模型读取和清理保持。Fast 保存／冻结／真实参数下发没有改动。
- 只在原函数加起止时间日志：原生检查（含回收）、有界命令及回收、末尾复核、提交发布；不输出参数、
  原生认证内容或新增计时服务。异常提前退出不保证产生全部阶段日志，缺日志不能当作耗时为零。

### 工作量与回归

原有发现夹具的线程内计数覆盖：稳定普通入口首次／升级发现加末尾复核共 1 次完整哈希，未变的重复
发现加末尾复核共 0 次；替换文件时完整复核并拒收旧结果。Core 正常单候选检查在入口与末尾连接该规则，
深检继续消费同一指纹。此计数不概括 Windows 包装依赖、构造异常或候选替换／重试路径。

Codex 原进程夹具覆盖普通 Schema 有／无 Fast 字段、有效账号、明确无需 OpenAI 认证、缺认证字段、
错误 RPC、分页及清理：可信版本和普通静态证据有效时仅 1 个 app-server；Fast 专用导出均为 0。
首次且版本／普通静态证据均未知时仍为版本、app-server、普通 Schema 共 3 个直接进程。
真实运行的 Fast 偏好不以该标志准入；原 Fast 保存与参数映射用例通过。

沿用既有 owner，通过 Codex 进程、普通发现计数、环境／管理器 8 项、替换身份、进程回收 5 项、Fast 2 项、
安装持久化与数据库锁可用性、成功／失败 rebind，以及平台证据 5 项定向测试。
补跑时修正两处原 PR 的验证遗漏：版本命令替换夹具原先预置可信版本，已改为未知版本以真正触发替换；
兼容登记文档已在前一提交更新但摘要仍旧，按现有规则同步摘要，不更改任何平台准入名单。
最终 `cargo test --workspace` 为 474 passed、1 ignored；Debug App 构建、`cargo fmt`、差异空白检查、
`docs:test`（10 passed）和 `docs:check:ci` 通过。测试集合有交叉，不累计成覆盖总数。

### 真实 App 采样与范围

同一 macOS arm64、同一隔离开发版 `pnpm dev`、同一 userData／Skill Library／MCP、同一原生程序和账号
配置。前后版本、路径及指纹逐项相同：MiniMax 0.6.12、Kiro 2.21.1、Antigravity 1.4.2、Codex 0.162.1。
改前为 `543ac8f63` 加相同计时日志；测量期间没有并行运行本任务的编译或测试。每组第一轮单列，三次重复取中位数；
第一轮是已有健康快照的 App 启动后检查，不代表新安装／升级或冷数据库。

下表每格为「UI / RPC」，单位 ms。UI 从 DOM 点击事件到按钮恢复后的第二个 animation frame；RPC 包围
真实 `runtime.product.check`。改前使用自动鼠标点击，改后窗口可见后使用原生辅助功能点击。后者逐次确认
状态，调用间隔更长，不能把这组前后差值当作同节奏的 UI 性能因果结论。所有成功样本原样保留：

| 智能体 | 阶段 | 首轮 | 重复 1 | 重复 2 | 重复 3 |
| --- | --- | ---: | ---: | ---: | ---: |
| MiniMax Code | 改前自动点击 | 1781 / 1750 | 1556 / 1525 | 1614 / 1583 | 1565 / 1527 |
| MiniMax Code | 改后原生点击 | 2498 / 2457 | 1981 / 1945 | 2264 / 2218 | 2032 / 1996 |
| Kiro | 改前自动点击 | 4522 / 4487 | 2139 / 2109 | 2607 / 2573 | 2149 / 2120 |
| Kiro | 改后原生点击 | 2825 / 2788 | 2559 / 2515 | 2463 / 2409 | 2472 / 2433 |
| Antigravity | 改前自动点击 | 6639 / 6612 | 5107 / 5079 | 5531 / 5502 | 4206 / 4183 |
| Antigravity | 改后原生点击 | 6675 / 6626 | 5840 / 5782 | 3990 / 3938 | 6663 / 6624 |
| Codex CLI | 改前自动点击 | 3930 / 3899 | 1839 / 1811 | 1856 / 1830 | 1797 / 1761 |
| Codex CLI | 改后原生点击 | 4390 / 4346 | 3359 / 3308 | 3097 / 3058 | 7509 / 7434 |

改前→改后原生点击的 UI 中位数为 MiniMax 1565→2032、Kiro 2149→2472、Antigravity 5107→5840、
Codex 1839→3359 ms；本组没有证明 UI 总耗时改善，不能隐去这些样本或将后端时间替代它们。
改后采样最初有一次窗口隐藏：Core 已约 1679 ms 完成、按钮已恢复，但绘制帧计时未结束。保存原始记录，
不计入有效 UI 样本；可见窗口重新采集首轮加三次重复，没有修改生产加载逻辑或禁用后台限速。

为减少输入驱动和采样间隔对解释的干扰，另用相同 Desktop client 连续提交 Core 请求，每次完成后间隔
100 ms，首轮加三次重复；与改前自动连续点击的 RPC 时间对照。此组只测 Core RPC，**不作为点击到渲染
耗时**，不替换上面的 UI 数据；系统负载、原生缓存及动态服务没有被严格控制，三次小样本不证明稳定收益。

| 智能体 | 连续补测首轮 | 重复 1 | 重复 2 | 重复 3 | 改前 RPC 中位数 | 补测 RPC 中位数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MiniMax Code | 1519 | 1462 | 1452 | 1952 | 1527 | 1462 |
| Kiro | 2194 | 2245 | 1950 | 1930 | 2120 | 1950 |
| Antigravity | 5449 | 5590 | 3960 | 4293 | 5079 | 4293 |
| Codex CLI | 1685 | 1380 | 1251 | 1468 | 1811 | 1380 |

阶段中位数如下（ms），右侧使用连续 RPC 补测。原生检查包含启动、协议／模型读取和清理，不把它全称为
网络时间；清理已包含在该列中，不能再次相加：

| 智能体 | 原生检查（含清理）改前→补测 | 末尾复核改前→补测 | 提交发布改前→补测 |
| --- | ---: | ---: | ---: |
| MiniMax Code | 1505.346 → 1439.358 | 0.143 → 0.082 | 0.639 → 0.616 |
| Kiro | 1911.097 → 1929.708 | 184.937 → 0.080 | 0.588 → 0.512 |
| Antigravity | 4713.899 → 4267.418 | 343.254 → 0.105 | 0.498 → 0.881 |
| Codex CLI | 1336.462 → 1355.406 | 455.202 → 0.170 | 0.587 → 1.074 |

Codex 与 Kiro 连续 RPC 的差值基本对应移除的末尾完整哈希；MiniMax 的入口仅 274 字节，末尾原已不足
1 ms，不能把其约 65 ms 差值归因于哈希。Antigravity 的 `agy models` 原生命令仍在秒级波动，移除约
343 ms 文件校验并不能解释全部差值。各组清理为毫秒级，没有固定等待 2 秒；提交发布也只在毫秒级。

本机改前重复样本未触发 Fast 专用 Schema，不能把这组 Codex 节省归因于删除 experimental 导出，更不能
声称省去其 5 秒上限。缺 Fast 标志时零额外进程由受控夹具证明。

仍需等待真实初始化、认证、动态模型读取、进程回收和最终 Runtime 读取。未减少超时、提前结束转圈或让
原检查转入后台；没有继续删除 MiniMax／Kiro 会话步骤或增加预热。Windows 真机、打包 Release、首次安装／
升级耗时与真实任务未在本次复测；替换归属与 Fast 下发语义使用原定向测试。验收 App 已受控退出，日常 App
及数据未操作。完整原始计时、分段日志、无效窗口样本与安装身份清单随 Thread 附件交付。

## Send 输入文件退出文件变化卡片（2026-10-19）

User 在本轮确认按实际 Send 输入路径过滤，并授权独立 worktree、PR 与 main 合入。
来源通过内部 IPC 绑定到已认证 Run/epoch，写入现有 Evidence JSON；无 SQL migration。过滤发生在原有终态
归约后，覆盖 snapshot/fallback、项目内外路径、多个 Send、统计与空卡片；成功来源推进原有失效水位。

新增纯归约 owner `successful_send_sources_filter_snapshot_and_operation_files_with_exact_paths`：原实现不能
消费成功 Send 来源；既有 managed-output owner 只处理 ingress unavailable，不能拥有“已准入文件被成功
业务来源排除”的不同语义。最小命令为 `cargo test -p rovai-core --lib --features extended-tests successful_send_sources`。
持久化／迟到／重启扩展现有 `terminal_runs_in_a_non_git_directory_project_independent_replayable_cards`，
复用其 SQLite fixture，因为纯归约不能证明 JSON 保存和水位恢复。CLI 来源扩展既有 `send_file_` 和
`send-file-input.test.mjs` owner；replay 来源绑定扩展既有 Built-in lease owner。

验证通过：`cargo check --workspace`、`cargo fmt --all --check`、
`cargo test -p rovai-core --lib --features extended-tests agent_run_file_change::`（22 passed）、
`cargo test -p rovai-core --bin rovai send_file_`（2 passed）、`pnpm test:send-input-file`（1 passed）、
`pnpm test:rust:pr`（474 passed，1 项既有手动 Runtime smoke ignored）、`pnpm typecheck`、
`pnpm test`（Vitest 2,798 passed；组合脚本 357 passed、2 项平台相关 skip）及文档治理门禁。
新增断言在首次验证时修正了 snapshot／operation 输出顺序假设及 macOS 临时目录 cwd 别名，未改变生产
路径身份规则。未启动真实 Runtime、模型或 Renderer；本项不宣称真实 Session 或 UI 点击验收。

## 跟随系统界面语言（2026-10-21）

按 User 确认的 HTML 交互稿实施：复用设置语言行、训练营欢迎页位置和登录表单，统一三个选择。Desktop Main 和 Web 本地偏好各自解析设备语言，不将远端 Host 语言当作访问者语言。持久化 schema 6 只保存偏好，运行时快照携带解析结果、读取状态与顺序版本。

有效 schema 1–4 保留中文，schema 5 保留原语言，缺失配置默认 system。损坏记录保留且阻止无关自动写入；恢复读取后才解除保护。语言读写独立于业务服务，较早读取、事件和保存响应不能覆盖较晚选择；system 保存失败回退时按当前设备重新解析。

训练营 schema 4 固定具体资料语言，旧检查点保留进度与命令 ID；创建和重启恢复使用冻结值。界面切换保持草稿、页面、角色和执行状态。Web 登录前选择在内存中暂存，认证后仅将用户明确选择接续到既有 owner 作用域。

工作分支 `rovai/system-interface-language` 从 `010e762f0` 建立，随后合入 `527582452` 的主干更新；没有主线治理先行要求。通用门禁使用同级干净检出 `rovai-ai-language-validation`，避免工作目录中被忽略的历史 HTML 原型参与文档扫描，未修改检查器或删除原型。

验证结果：

- `pnpm typecheck` 与 `pnpm test` 通过：251 个 Vitest 文件、2,847 项用例；后续 Node 套件 357 项通过、2 项 Windows 专用测试按平台跳过。覆盖旧配置迁移、system 持久化、读取损坏保护、恢复、请求顺序、Web 作用域和创建资料冻结。
- `pnpm test:startup-presentation` 在隔离 Electron 中通过：语言读取前保持中性首帧，训练营三个选择更新页面语言属性；从 English 切回 system 保留选择方式，且原组件树保持不变。`pnpm test:desktop-bridge` 验证生产 preload 的语言读取、保存、事件清理及创建语言参数。
- `pnpm build:desktop`（包含 Web、Execution Web、Main、preload 与 Renderer）和以真实主干为 base 的 `pnpm docs:check:ci` 通过。
- `pnpm test:rust:pr` 在语言实现提交 `7c62e5580` 通过：474 项通过、1 项既有手动 smoke ignored；本功能未修改 Rust。后续主干合并仅处理翻译、文档与验收夹具的并行增量。
- 规范与需求两项独立审查发现的读取异常提示丢失、登录交接期间新选择丢失均已修复，并通过回归与复核。保存失败文案按回退后的当前语言显示。
- 完整复验曾触发未改动的 `cline-observer` 测试误判：它的敏感字段正则匹配到了 `observedAt` 的 `.999` 毫秒值；单项复查与完整重跑通过，未改动该 owner。

本次只启动隔离自动验收进程，未启动真实 Runtime，也未安装或重启日常 App；不将 macOS 验收当作 Windows 原生系统通知验证。

## App 退出提醒收口（2026-10-21）

- User seq73 授权按退出范围简化并清理旧代码；独立分支 `rovai/app-exit-attention`。
- User seq75 确认保留 Run 异常退出提醒，seq77 授权四处复核修复；不收窄既有 `execution_lost`，统一使用执行中断文案。
- Migration 210 / schema 160 只替换终态 producer；退出取消/确认丢失仍沿原通知事务，
  手动停止停止准入。旧 `user_stop` 不再参与侧栏候选，原审计不被删除或伪造为已读。
- 前台正式 Thread 展示按已观察边界确认，无需精确 Run/command/output；显式标记已读保留分步与重试语义。
- 删除短亮计时、本机停止意图、精确准入描述及专属 DOM 可见观察；移除未合入的无输出终态标记补丁。
- 稳定通知 dispatcher，普通快照/进度不触发读取，空增量不读投影；成功批次及后续刷新不被慢批次阻塞。
  Web 沿原 SSE 附加通知失效标识，普通消息失效不触发通知轮询。
- 自动确认执行时再次校验快照代次，与工作区共用正式展示条件；拉取中的通知信号合并补读，
  不跳过失败退避。恢复普通失败气泡可见来源，保持中断提醒的 Thread 范围确认。
- 当前规范与验证边界见[退出提醒验收](interruption-attention-validation.md#当前收口退出提醒2026-10-21)。
  本轮未安装或重启日常 App；没有新增运行中清单、恢复扫描、轮询器或已读存储。

## 紧凑文件卡片与粘贴内容前缀（2026-10-21）

- 独立 worktree `rovai-ai-compact-attachment-cards`，分支 `rovai/compact-attachment-cards`，基线 `caf66a6ea`。
- 所有文件卡片最大宽度 224px；粘贴内容显示有界原文前缀及中英文类型标签。图片、原文件名、预览和移除流程保持。
- [Camp Attachment v12](../../contracts/camp-attachment-v12.md) 仅增加可选展示前缀。复用现有登记、草稿、发送快照和 Source Ref JSON；不新增迁移或后台读取。
- 扩展既有 Rust owner `source_ref_json_is_closed_and_pathless_view_is_stable`：旧记录兼容、前缀边界和序列化／投影；`source_path_message_bypasses_managed_attachment_publication`：实际发布持久化、全文读取保持。新字段在修改前会被 closed JSON 拒绝。没有新增、删除或禁用 Rust 测试函数。
- 最小 Rust 验证：`cargo test -p rovai-core --lib source_ref_json_is_closed_and_pathless_view_is_stable`；发布 seam 使用 `cargo test -p rovai-core --features slow-tests --lib source_path_message_bypasses_managed_attachment_publication`。沿用原有 fixture，不新建数据库测试。

验证结果：`pnpm typecheck`、`pnpm build:desktop`、`DOCS_BASE_REF=caf66a6eac581a62cb242b0c4037f60cb6855ed5 pnpm docs:check:ci` 通过。
`pnpm test` 最终完整通过：252 个 Vitest 文件／2854 项、Node 357 项通过／2 项平台跳过。此前并行构建时出现既有配置读取、评测子进程等超时；隔离复验与最终默认命令均通过，未修改其测试或超时配置。
`pnpm test:rust:pr` 默认 workspace 474 项通过／1 项既有 ignored；两个既有 Source Ref／实际发布 owner 定向通过。
`pnpm test:composer-input` 三项通过；最终共享卡片夹具额外验证中英文／日夜主题、恢复、纯附件发送与队员文件列表的实际宽度，截图人工复核通过。未启动日常 App、改动其数据或调用真实模型。

### Agent 文件列表宽度恢复（2026-10-21）

User 后续要求恢复 Agent 文件列表并通过 PR 合入 main。分支 `rovai/restore-agent-file-width`，
worktree `rovai-ai-restore-agent-file-width`，基线 `c0f8a0df7309913f63f8e12c1fa41badd2e90950`。
恢复 PR #856 之前的 620px 列表上限和整行宽度，解除 Agent 文件区对用户 224px 上限的依赖；
用户文件卡片和长粘贴内容前缀保持。同步当前 UI、附件合同与版本概览；不改变数据、模型上下文或发布版本。

`pnpm typecheck` 通过；`pnpm test` 完整通过 252 个 Vitest 文件／2854 项与 Node 357 项／2 项平台跳过。
首次全量的既有钉钉文件交付用例等待超时，定向复验和完整重跑均通过，未修改该测试或超时配置。
`pnpm test:composer-input` 三项通过：既有生产夹具验证中英文、日夜主题、用户卡片 224px、
Agent 列表 620px 上限及 200px 窄容器收缩，截图人工复核通过。验收使用隔离 Electron，无 Core 或真实 Runtime。
基于上述基线运行通用文档门禁；源码布局评估与机械扫描未发现本次恢复的阻断问题。


## Thread read 正向增量读取（2026-10-22）

User 在接口与提示词清单交付后确认实施、PR 与合入 main。范围和完整前后文本见
[已确认 r1](model-context-change-thread-read-after.md)；当前字段由 [History v16](../../contracts/camp-history-v16.md)
与 [Transport v44](../../contracts/builtin-tool-transport-v44.md) 拥有。

- after 与 before 互斥；after=0；正向跨页、空页、序列空洞、实时新增及 reply-chain。
- 延用输出字段、权限、撤回/附件投影及历史 receipt；无 migration 或 Bootstrap/Manifest 升级。
- 复用既有 Rust owner；实际检查结果统一记录在方案的实施验证段，未执行项不得视为通过。

## 全界面分隔线快速松手（2026-10-23）

User 在分隔线交互 Thread sequence 11 授权全界面实施、PR 到 main 并合并；独立 worktree
`rovai-ai-splitter-release-consistency`，分支 `rovai/splitter-release-consistency`，基线 `e9cfbeac4`。

共享 `useCollapsibleSplitter` 取消最小值停留计时。越过最小值 64px 立即进入可收起状态并显示短暂提示，
按住时不自动收起；反向退出阈值取消意图。松手按最终指针坐标提交，未越过阈值保持最小值；
确认收起后保留 160ms 动画，系统或 App 减少动态效果设置只省去动画。取消、失焦、捕获异常、
容器或作用域变化恢复手势前状态，正常松手释放捕获不取消已接受的折叠。

覆盖全局导航、队员／团队共用名册、文件／执行 Sidecar、回复详情、定时任务详情和底部执行详情。
定时任务只在松手后 flush 草稿；失败保留草稿与最小宽度，取消后的迟到响应不得收起面板。
MCP、原生 Skills、工具箱接入同一提交与取消逻辑，保持 240–560px 调宽范围和独立偏好，不新增折叠。
修正 CSS zoom 的逻辑像素换算，并防止仅高度变化的 ResizeObserver 重置实时宽度。
Mission 抽屉和 Diff 文件树已有最终指针提交与缩放换算，保留其全展开／只调宽语义。

同步 DESIGN、当前 UI 页面、队员 surface brief 和中英文文案；属于 Renderer 局部交互收口，
无 Core、模型上下文、数据库 schema、偏好格式或发布版本变更，无需新增 Version Decision。


验证结果：

- `pnpm typecheck`、`pnpm build:desktop` 通过；全量 Vitest 为 253 个文件、2,921 项通过、2 项既有 skip。
  首次与构建并行时既有 `restorable-location` 文件读取测试触发 5s 超时；独立全量复验通过，未修改超时或业务代码。
- 七个隔离 Electron owner 通过：`navigation-shell`、`member-editor`、`file-preview-layout`、
  `automation-splitter`、`execution-avatar-rail`、`capability-workspace` 和 `reply-details`。
  增加无 pointermove 的最终坐标提交、快速松手、按住不收起、反向取消、草稿保留与异步保存取消断言；
  设置页覆盖 MCP／原生 Skills／工具箱独立偏好、CSS zoom、仅高度变化和失焦恢复。
- 文件预览生产组件截图确认短暂“松开收起预览区”提示位置；Skills 阅读页及设置页保持原有视觉结构。
  既有日夜主题、1040／1440／2560 尺寸、200% 缩放、键盘操作和减少动态效果检查随 owner 回归通过。
- 回归同步修正 MCP 原生拖动夹具漏带按住标志的问题，以及文件预览 Night 色值断言：旧值已与
  当前主题 token 不符，本次仅更新测试预期，未修改主题。
- `pnpm docs:test`、`pnpm docs:check` 与以 `e9cfbeac4` 为 base 的 `pnpm docs:check:ci` 通过。
  验收全部使用显式隔离 userData 与内存 bridge，无 Core、真实 Runtime 或日常 App 数据写入；未安装日常 App。


## Command Code 原生接入简化（2026-10-24）

官方 1.88.0、用户原生 HOME、官方 Mod、ACP MCP 和共享 Fleet 身份复用作为同一交付；删除配置镜像与
摘要兼容性链。旧 Session/Binding 保留，结构简化本身不恢复公开准入。实现、复杂度对照及定向验证见
[Command Code 简化记录](command-code-native-simplification.md)。

2026-10-25 按 User 收口继续删除冷恢复 `session/list`，Run 发送前通过已有 ACP 控制命令更新 Mod 内存，
首次/warm/cold 同路，删除 Bootstrap binding 文件及专属读写、SHA 与文件名限制；补共享
`.agents/skills` user/project 来源。问卷通过现有 Mod 的官方 active-tools 过滤器移除；原生明确 edit
新建与普通编辑片段进入现有 Diff 展示，write 创建状态不明确时不推测。没有新生产文件、专属状态或锁。
固定 1.88 的确定性原生验证与既有 sub2api 真实模型证据分开，详见上述报告。

2026-10-25 User seq61 另行确认 macOS 两架构开放，沿现有 Preview 准入与共享产品目录实施；
同日 Windows x64 补验后也按 Preview 开放，Linux 保持 NotQualified。最低版本、原生接入和生命周期不变，
不新增资格门禁；Windows 实测和已知限制见[实施记录](command-code-native-simplification.md#windows-preview-开放2026-10-25)。
完整 Intel/Core/App 验收不由此次开放推导，决定见 [V1.72-D60](decisions.md#v1-72-d60)。


2026-10-25 Linux x64 随独立目标机验收开放 Command Code Preview，保持官方稳定版 ≥1.88.0。
真实 Core/浏览器、能力、生命周期和已接受差异分别记录于
[Linux 验收](../../research/command-code-runtime/linux-acceptance-2026-10-25.md)；
公开范围见 [V1.72-D61](decisions.md#v1-72-d61)，不增加 Runtime 管理机制。
