---
document_type: implementation-plan
version: v1.53
authority: implementation-and-acceptance-status
status: in-progress
last_updated: 2026-09-07
---

# v1.53 实施与验收

## 正文持久化补充

- [x] Core 以原生消息身份或明确连续边界聚合正文、thought 与 reasoning summary；每块单行、首次位置不变。
- [x] 原生完成结果覆盖同块累计内容；工具事实、旧历史和已有 reasoning 保留语义不变。
- [x] 活动读取叠加内存正文；正常关闭、取消、失败保存已收到的中断块；大正文使用既有 Blob。
- [x] Renderer 数据适配支持块定稿、偏移去重、稀疏历史序号与按需全文读取，不改变 UI 布局。
- [x] 有效 Lead enter 跳过新 reconcile；可见通知按 Camp 记忆局部变化并冻结 UUID/request 重试，A/B/A 切换不重复空确认；Roster sweep 尊重已有缓存。
- [x] Navigation 聚合先过滤实际影响 marker 的事件；CampOpen 业务读继续不访问 event_log。
- [x] 离线工具默认只操作副本；显式原库模式获得 Core 同款 flock、SQLite 排他锁和完整恢复备份。
- [x] 本地历史副本逐块内容/序号/状态校验，并验证 event_log、工具投影、封存渠道快照不变。
- [x] 成品 App 隔离验收及真实新 Run 的正文块/写入量验证。
- [x] 用户授权的日常 App 安装替换，保留旧安装备份；不把安装成功等同于真实升级源验收通过。
- [x] 用户授权的原库一次性聚合：确认 App/Core 已退出，持锁创建独立完整恢复备份，处理后完整性、外键和保护表校验通过。
- [x] 经用户确认合入 PR #245，保留主线图片 141，将 classifier cutover 统一为 142；既有工具 141 原子映射并保留 applied-at。
- [x] 两种升级源的 marker/schema 准入、部分状态拒绝、三个事务失败点回滚，以及生产 lease/ticket/migration/reopen 路径测试通过。
- [x] 日常新版读取验收：兼容修复后重新构建、隔离副本升级、用户授权安装与目标 Camp 全部历史读回。
- [x] Migration 143 在单一 IMMEDIATE 事务压缩 terminal aggregate 已覆盖的历史 command delta 与未引用空壳，
  按原顺序修复 Canonical source IDs，并验证非空、文件投影隔离和无悬挂引用。
- [x] 新原生 `userMessage` 空生命周期不再写 Evidence；显式模型在 Gateway 前跳过
  `runtime_model.observe`，`runtime_default` 首次观察和 handler 防御保持不变。
- [ ] 合并后停止日常 App，创建新完整恢复备份，迁移原库、执行显式孤儿 Managed Blob GC 与 VACUUM，
  验证真实新增/删除行数、引用、完整性、文件体积和目标 Camp 读取，再启动最新 App。

### 合同 owner 与最小验证

新增 `execution_text::slow_tests` 拥有跨 Runtime ingress、SQLite/Blob、活动读取和正常关闭的完整 seam。
原 Evidence 测试只证明单条持久化和取消 fence，不能捕捉 1,000 个片段写放大、多组正文/工具交错与定稿
原位覆盖；同一集成 owner 同时覆盖失败、epoch 复用、重启读取和重试零写入。UTF-8 有界前缀由低成本纯函数
owner 覆盖。原生消息矩阵扩展已有 Claude/Pi 测试，批处理、CampOpen 和分页直接扩展既有 owner，不创建平行数据库夹具。

```bash
cargo test --workspace
cargo test -p rovai-core --features slow-tests --lib execution_text::
cargo test -p rovai-core --features slow-tests --lib camp_open_slow_tests:: -- --nocapture
cargo test -p rovai-core --features slow-tests --lib camp_open::slow_tests::
pnpm exec vitest run apps/desktop/src/renderer/src/App.test.ts apps/desktop/src/renderer/src/NotificationAttentionController.test.ts apps/desktop/src/shared/execution-presentation/public-result.test.ts apps/desktop/src/main/channel-settings.test.ts
python3 scripts/aggregate-execution-text.test.py
```

测量工具 `measure_camp_open` 仅在 `slow-tests` 下以 SQLite READ_ONLY/query_only 打开明确副本，禁止迁移、
恢复、Runtime 和后台任务；报告首样本及重复分布，不冒充 Renderer 或锁等待的端到端时间。
`aggregate-execution-text.py` 的报告只包含数量、哈希与操作者本地路径，不记录正文或凭据；含用户数据的
副本/备份不得提交仓库。重跑必须使用新输出目录，原库模式不能覆盖已有备份或忽略 Core 独占锁。

`verify_deployed_upgrade` 仅接受 OS 临时目录内明确命名的独立副本，执行生产 admission/migration 与 Camp Open，
不启动 Core 服务、Runtime、渠道或 Skill Library。新增部署回归由数据库 owner 负责精确源与原子映射；
既有 `authority_migration::tests::supported_database_is_migrated_in_place_and_readmitted_without_snapshots`
扩展两种来源，拥有租约、票据和重开组合边界，不重复其完整失败矩阵。

真实运行验收复用 `accept:planned-shutdown`；设置 `ROVAI_EXECUTION_TEXT_ACCEPT=1` 时先验证三个正文块与
工具交错，再在下一次运行输出正文期间正常退出并验证中断正文恢复。SQLite 写入计数触发器只安装在该
自动验收 fixture 中，不进入产品 Schema 或日常数据库。
`text-and-partial` 执行相同的正文写入量与正常退出/重开验证，但不运行无关的空闲浮层截图阶段；
原完整模式 `1` 和原截图覆盖保持不变。

### 正文补充验证记录

- 合入最新主线后的 `cargo test --workspace` 通过；正文定向 2 个、CampOpen 定向 3 个用例通过。
- 合入主线 `2ffc49ea` 与 PR #245 后，`pnpm test`：156 个 Vitest 文件、1,597 个用例通过；最终 Node 批次
  220 通过、1 个 Windows-only 跳过。`pnpm typecheck`、文档治理、Rust format 与 diff 检查通过。
- 正文 Core 集成验证 1,000 个片段在首块占位后不新增 SQL 写入，覆盖原生完成覆盖、正文/工具交错、活动
  读取、取消/失败、旧 epoch fence、Blob 全文和重开。Default Lead 有效 enter 零新增日志、原命令重放和真实修复通过。
  补充 ACP `messageId` 的 A/B/A 交错与空 `itemId` fallback；Core 与离线聚合使用同一原生身份优先级。
- 独立 Electron 正文场景通过：稀疏 sequence、35,023 字符 Blob 全文、失败重试、3 段正文和 2 组工具、
  reasoning 不泄漏到公开展示。原完整 CampOpen 图片截图场景仍有图片解码时序断言失败，未调整图片 UI 或删减原覆盖。
- 合并成品 `4401a870` 的真实 Codex 验收：593 个 text/reasoning 流式片段保存为 9 条块记录、18 次正文 SQL
  行写入；加上工具等事实共 19 条 Evidence、28 次 SQL 行写入。该指标不是物理磁盘写入字节数。
- 合并后重新 `package:mac:daily` 并验签；`ROVAI_EXECUTION_TEXT_ACCEPT=text-and-partial` 成品正常退出/重开
  场景通过：513 字符未完成正文被保留为 interrupted，退出 1,742ms、重开后退出 350ms，无强制信号，最新 Draft 保留。
  此定向模式不运行无关的空闲退出浮层截图；原完整脚本该环节因 App 先退出导致 CDP 关闭，不能计为完整通过。
- 离线聚合 3 个 Python 用例及真实副本逐块内容、顺序、状态、引用和工具不变校验通过；副本原位重跑零变化。
- 用户授权的原库聚合及独立校验通过，完整恢复备份留在用户私有目录。日常启动验收另发现并行分支
  Migration 141 冲突：聚合前备份已包含 PR #245 的 classifier cutover，而不是当前主线的图片来源列。
  安装前的隔离新库验收没有覆盖这一真实升级源；不得把正文测试或聚合完整性通过表述为日常 App 可用。
- 经用户授权合入 PR #245 后，63 个数据库测试和生产迁移组合测试通过。聚合后的真实隔离副本从
  `v1.52/schema 92/activity-v3` 原子迁移为 `v1.53/schema 93/activity-v3`，原 classifier receipt 的时间保留于 142；
  schema 93 是 Migration 143 的精确来源，迁移完成后形成 `v1.53/schema 94/activity-v3`；后续
  Migration 144 再从该来源推进当前 schema 95，且不重写这里已验收的数据。
  9 张正文/工具/事件/业务表逐表摘要不变，完整性与外键检查通过，目标 Camp 的 18 个 Run 可读取。
  合并后的执行正文与文件预览 Electron 验收均通过。
- 用户授权安装后的日常 App/Core 正常启动，原库生产兼容迁移和目标 Camp 的全部 Run/Evidence CLI 读回通过；
  正文、Canonical 与文件投影摘要不变，原事件日志行没有缺失或改写，完整性与外键检查通过。
  正常渠道启动的既有七天运输清理另按生命周期生效，并非本次聚合或兼容迁移删减；完整恢复备份保留。
  三次真实往返切 Camp 后没有新增可见通知或 Default Lead 空日志；这里只证明业务读取/维护行为，不冒充 Renderer 端到端计时。
  `f3f7e2f2` 仅修正合入 Claude 测试的单元素循环 lint，产品产物仍对应 `4401a870`；该实现/测试提交 PR CI 通过。
- 全量 slow Rust 检查仍有基线已有的 `current_input_skill_links_are_direct_user_siblings_with_canonical_bytes`
  断言失败；Clippy 在未修改的 `core_subsystems.rs` 报 `let_and_return`。不为本次正文任务修改 Skill 上下文
  或清理无关模块，完整门禁不宣称全绿。另仅修正旧 Single Chat 测试夹具已经失效的 `draft_revision` 字段。

## 命令结果正文去重补充

- [x] 核对 `command.result` 全部生产写入、幂等回放、事件订阅、完整 Snapshot、Camp History、Team Tool、
  诊断/迁移与历史清除入口；确认生产写入唯一收口于 `append_command_result`，回放只读专用列。
- [x] 新写入的 `payload_json` 固定为 `command-result-columns-v1` 内部 marker，完整正文只序列化并写入
  `result_payload_json`；所有回执列、事件元数据和事务边界保留。
- [x] `load_events` 在原批量 SELECT 中取得专用列；旧 `command.result` 原样读取，新 marker 严格还原公开
  payload，普通事件不变，不增加 N+1 查询或读取时写入。
- [x] 缺列、非法状态、损坏 JSON、不完整实体引用、未知或带额外字段的 marker fail closed；错误只带事件
  ID/序号和错误类别，不打印结果正文。
- [x] Migration 144 从精确 `v1.53/schema 94/activity-v3` 原子发布 schema 95 与 receipt，不改写历史事件；
  authority admission、逐步恢复和旧来源升级链同步扩展。
- [x] 保持直接响应、三种状态、幂等摘要/冲突、首次时间戳、Handler 错误回滚、事件 wire 与
  `EVENT_BATCH_SCHEMA_VERSION = 9` 不变。
- [x] 完成定向 Rust、PR Rust、workspace check 与文档治理门禁，记录 Clippy 基线失败及实际逻辑字节对比。

### 合同 owner 与验证范围

低成本 JSON 边界、marker 识别和错误矩阵由 `command::tests` 的纯投影 owner 表驱动覆盖；同一 owner 扩展
既有重放测试，覆盖 `applied/accepted/rejected`、物理列与单份正文，避免为每种状态复制数据库夹具。
持久重开和 Handler 回滚需要跨事务边界，保留一个完整临时数据库 owner。`read_model::slow_tests` 只证明
真实事件入口能在同一批次混读旧回执、新 marker 和普通事件，并保持顺序、分页、游标与 fail-closed 定位；
`db::tests` 与 `authority_migration::tests` 分别拥有 marker-only 原子迁移和正式 lease/ticket/reopen 链。

所有数据库验证只使用 OS 临时目录。默认升级不转换旧历史、不执行 VACUUM，也不接触日常 App 数据。

### 验证记录（2026-09-07）

- `cargo fmt --all --check`、`cargo check --workspace --all-targets` 通过。
- `cargo test -p rovai-core --lib command::` 运行 7 项并全通过；
  `cargo test -p rovai-core --lib read_model::` 运行 3 项并全通过。Migration 144、完整 Migration 链和
  authority in-place/reopen 定向测试均实际运行并通过。
- `pnpm test:rust:pr` 通过：527 项 library、33 项 CLI、307 项 slow tests 全部通过；slow suite 包含真实
  `events.subscribe` Read Side 的旧回执、新 marker、普通事件和大正文混合分页夹具。
- `pnpm docs:test` 9 项全通过；`pnpm docs:check` 与基于
  `0ee42c5064b0f2950704b7ea8bb38f6198b977bd` 的 `pnpm docs:check:ci` 通过。
- `cargo clippy --workspace --all-targets -- -D warnings` 已执行，但被本分支未修改的
  `crates/rovai-core/src/main.rs:17558` 既有 `clippy::too_many_arguments` 阻断；本任务没有借机改动该函数。
- 代表性隔离夹具的结果 JSON 为 426,030 字节。旧编码的 `payload_json + result_payload_json` 为
  852,200 字节；新编码为 45 字节 marker + 426,030 字节正文，共 426,075 字节，单行减少
  426,125 字节（50.003%）。这是大结果回执行的逻辑字节，不代表全库大小或订阅传输量同比下降；订阅仍
  返回完整公开结果。生产查询保持单次批量 SELECT，没有逐事件查询或读取时写入。

### 回退基线

schema 95 的双读 Core 可先恢复旧格式写入并继续读取两种行。若回退到不支持 marker 的 schema 94 Core，
必须先停止新写入，使用另行授权和隔离验证的工具把所有 marker 行反向物化为旧公开 payload，确认 marker
为零后才能回退 authority；只切换 writer 不能修复已经提交的新格式行。

## 实施范围

- [x] 为 Runtime 图片观察增加可选、闭集的 Adapter 确认公屏来源，不从工具名、路径或格式推断。
- [x] Codex 原生 `imageGeneration` 与 Antigravity 已完成精确 step 分别写入唯一允许来源。
- [x] Claude、Codex MCP、ACP、TRAE 与 Copilot 图片继续保留观察和存储，但不写入公屏来源。
- [x] Migration 141 增加 nullable `public_display_source`，旧行保持 `NULL`，DDL、marker 与 receipt 原子提交。
- [x] 在 `list_camp_images` 单一 Core 投影 seam 过滤闭合集，保持 Snapshot/Open/实时刷新/重开共用语义。
- [x] 保留 Camp-scoped bytes 读取、底层行、Blob GC root、稳定路径及显式 CampMessage 图片附件行为。
- [x] 增加 CUA 截图、两类原生生图、工具名伪装、历史保留、闭集约束及迁移原子性回归。
- [x] 更新 Runtime Images、Camp Open、Architecture、UI 和版本治理文档。

## 验收重点

- `mcp__cua_repl/js` 的 Codex MCP image 仍能保存，但 `agentRunImages` 为空，因而不能成为消息图片区或独立兜底；
- Codex `item/completed + imageGeneration` 和 Antigravity 精确 done generate-image step 仍进入公屏集合；
- Claude `tool_result`、ACP `content:image`、TRAE Read、Copilot view-image 与名为 `generate_image` 的第三方工具
  均保持未确认来源；
- 历史 `agent_run_image` 行升级后保留且来源为 `NULL`，不会按旧 toolCallId、文件名或路径重新分类；
- 同一来源过滤同时覆盖实时刷新、Snapshot/Open、重新进入 Camp、公开消息合并与终态无消息兜底；
- `rovai send --file` 显式图片附件、同摘要显式附件优先和按需读取授权不变。

## 必跑命令

```bash
cargo test -p rovai-core --lib agent_run_image::tests
cargo test -p rovai-core --lib db::tests::current_migration_state_admission_matrix -- --exact
cargo test -p rovai-core --lib db::tests::v141_retains_historical_runtime_images_as_unconfirmed -- --exact
cargo test -p rovai-core --lib db::tests::v127_preserves_saved_bindings_and_introduces_no_fast_override -- --exact
cargo test -p rovai-core --lib db::tests::v143_compacts_terminal_command_deltas_and_empty_text_shells_atomically -- --exact
cargo test -p rovai-core --bin rovai-core tests::only_runtime_default_model_selection_submits_observation_commands -- --exact
cargo test -p rovai-core
pnpm typecheck
pnpm test
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
cargo fmt --all -- --check
git diff --check
```

## 最终验证记录

- Runtime 图片 6 个定向用例通过，覆盖 Adapter 来源、CUA 截图隐藏、两类原生生图、存储/读取、限额、显式附件
  去重与路径生命周期；
- Migration 141 的准入矩阵、历史行保留、闭集约束、receipt failure 回滚和完整迁移链定向用例通过；
- `cargo test -p rovai-core` 通过：Library 508、CLI 33、Main 221 个用例通过，5 个手动真实 Runtime smoke 忽略；
- `pnpm test` 通过：Vitest 154 个文件、1566 个用例通过，最终 Node 批次 220 个通过、1 个 Windows-only 用例跳过；
- `pnpm typecheck`、`pnpm docs:test`、`pnpm docs:check`、
  `DOCS_BASE_REF=91af2eeebd7ebfb581820c2f68d259ff51497199 pnpm docs:check:ci`、
  `cargo fmt --all -- --check` 与 `git diff --check` 通过。

## 运行中网络恢复补充

### 实施范围

- [x] 增加严格 structured/text 网络 classifier，并显式排除鉴权、权限、配额、模型、配置、取消、限流和服务端错误。
- [x] 增加 Core generation-local queue、固定退避、attempt-end 计时、重复 signal 合并与 in-flight singleflight。
- [x] 在 ACP failed terminal 的 `not_accepted` seam 于普通终态前登记恢复，并先完成旧 Prompt route/Host 可见性清理。
- [x] 增加 system-only mark/arm/complete 命令，复用正式 Scheduler/Fleet，并重验 version/epoch/取消/预算/成员/授权/
  Delivery/Approval/Action/Runtime Delivery。
- [x] 只在新 epoch 的 Runtime Input accepted 后清除网络提示；再次网络失败沿同一 Run 推进下一档。
- [x] Renderer `online` 与 Electron system resume 只调用 wake；Core 后台独立工作，无项不轮询。
- [x] planned/unplanned shutdown 停止协调器；Core restart 把 durable live marker 归一到既有 startup recovery。
- [x] 增加 Renderer/共享 presentation 的等待、恢复、需处理文案，blocked 不显示 spinner 且保留 Run Stop。
- [x] 增加固定时钟、分类、queue、领域 fence、ACK、restart、ACP ingress、Core allowlist 与 Renderer 回归。
- [x] 使用隔离 App data/workspace 验证 Claude Code 原生 API retry 在同一 AgentRun/epoch 自恢复，Rovai 未接管。
- [ ] 使用隔离 App data/workspace 完成 ACP terminal 后 Rovai 接管、新 epoch accepted 和无副作用验收。

### 自动化验收重点

- interval 精确为 `1, 2, 3, 5, 10, 15, 30, 30...`，零耗时累计点为
  `1, 3, 6, 11, 21, 36, 66, 96...`；第二档从第一 attempt 完成时起算；
- online/resume 提前 wake 只使待检查项到期；同一故障周期至多消费一次提示，重复 signal 与同时到期不形成并行
  attempt，也不能逐档绕过 backoff；
- structured `ECONNRESET/EAI_AGAIN/ETIMEDOUT` 等准入，generic request failure、证书错误、HTTP 5xx、鉴权、配额、
  限流、模型、配置和取消不准入；
- ACP 只有 failed + `not_accepted` + network evidence 在 terminal settlement 前转为等待；accepted/unknown 不重放；
- attempt 只通过正式 claim 增加 epoch，Input ACK 前不清除提示，ACK 后不遗留 queue；旧 epoch、取消、期限和安全条件
  变化不能再 dispatch；
- network-blocked 显示“需要处理”且没有 spinner，Run Stop 仍可用；页面切换、无 online signal 时 Core timer 仍独立；
- shutdown 清空 process-local queue；启动不恢复 attempt/delay，只按现有 startup recovery 重新分类 durable Run。

### 必跑命令

```bash
cargo fmt --all -- --check
cargo test -p rovai-core network_recovery --lib
cargo test -p rovai-core core_restart_hands_live_network_wait_to_existing_startup_recovery --lib
cargo test -p rovai-core --bin rovai-core acp_rpc_error_keeps_only_a_bounded_structured_kind
cargo test -p rovai-core --bin rovai-core acp_prompt_failure_is_retryable_only_when_input_was_not_accepted
cargo test -p rovai-core --bin rovai-core runtime_probes_do_not_occupy_the_interactive_request_queue
cargo check -p rovai-core --bin rovai-core
pnpm typecheck
pnpm exec vitest run apps/desktop/src/renderer/src/App.test.ts apps/desktop/src/main/runtime-core-methods.test.ts
pnpm build:desktop
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
git diff --check
```

真实 Runtime 双链路资格验收在普通 macOS 交互式终端运行：

```bash
pnpm accept:network-recovery
```

该入口只使用隔离 data/workspace，并在精确阶段提示操作者断开或恢复 Wi-Fi；它不会自行修改系统网络设置。
只有报告同时证明 Claude Code 原生自恢复与 OpenCode ACP terminal 后 Rovai 新 epoch 接管，才可勾选网络恢复的最后一项；
整个版本的完成状态仍取决于本计划全部范围的验收。

### 网络恢复测试 owner

`network_recovery::tests` 以纯函数和固定时钟拥有网络类别、退避与队列合并矩阵；实现前的网络 terminal 直接失败，
既有恢复测试没有运行中队列与 hint 消费合同，因此这些性质由新增低成本 owner 独立验证。
`runtime::tests` 复用已有 claimed-run fixture，覆盖等待、正式新 epoch claim、accepted ACK 清除、重复输入拒绝、
安全条件变化及重启交还；只有该 SQLite 事务 seam 能证明 persisted state 与 version/epoch fence 同时成立。
ACP 原有错误/投递测试扩展网络类别与 accepted/not-accepted 分流，不另建真实 Runtime 测试夹具。
最小验证命令为本节列出的 `network_recovery`、startup handoff 与 ACP 两个定向命令。

### 合入前验证记录

- `cargo fmt --all -- --check`、`cargo check -p rovai-core` 与网络恢复定向用例通过；Core binary 全量结果为
  `222 passed / 5 manual ignored`。Lib 全量为 `512 passed / 1 failed`，唯一失败是嵌套 macOS sandbox 下的
  `macos_runtime_sandbox_denies_user_automation_root_but_keeps_other_files_visible`；同一能力的 Electron sandbox gate
  在 `pnpm test` 中通过。
- `pnpm typecheck`、Desktop build、两份定向 Vitest（165 个用例）以及 `pnpm test` 全量通过；全量包括 154 个
  Vitest 文件／1567 个用例和 Node 220 个通过／1 个 Windows-only skip。Impeccable detector 无命中。
- `pnpm docs:test`（9 个用例）、`pnpm docs:check`、以基线 `91af2eeebd7ebfb581820c2f68d259ff51497199`
  执行的 `docs:check:ci` 与 `git diff --check` 通过。
- `smoke:recovery` 的临时目录已改为先 canonicalize，避免 macOS `/var` 别名触发 Runtime Files Root 所有权拒绝；
  随后 OpenCode 1.18.20 与 Codex 的隔离运行均未取得 Product Runtime resolution。额外隔离 inventory 显示本 Native
  Session 子进程中的已发现 CLI 全部以 `runtime_version_failed` 收口，未进入模型执行阶段；临时数据已清理。
  真实 Runtime 原生自恢复与 ACP terminal 后 Rovai 接管两链路仍未验收；完成前不得把任何 Adapter/平台的新网络
  恢复 qualification 记为已实证。

### 本次实机结果与合入边界

- 2026-09-06 在独立交互式终端执行 `pnpm accept:network-recovery`：Claude Code 与 OpenCode 在线基线通过；
  Claude Code 发出 `runtime_api_retrying` 后恢复成功，保持同一 Native Session、AgentRun 与 epoch，未进入 Rovai 接管。
- OpenCode 第二链路先遇到 `session/resume` 超时并回退新 Session，随后在 epoch 1 接受输入、返回预期 marker 并成功结束；
  未观察到 `runtime.input_not_accepted` 或 `agent_run.network_recovery_waiting`，因此整体验收报告为失败，不能算接管成功。
  日志未记录全过程网络状态，无法仅据此确定联网时机或判定产品缺陷。
- 该 Run 无工具调用及文件变更 Evidence；隔离工作区仍有启动期生成的 `mcp-gateway/standalone.json`，
  完整工作区洁净门禁未通过验收，不声明双链路无副作用资格已经完成。
- 操作者停止进一步断网验证并决定先合入实现。网络恢复实机资格保持待验收，不晋升任何候选 Adapter/平台组合。

### 整合主线后的自动化验证

- 整合 `ec3b4295` 后，`cargo fmt --all --check`、`cargo check --workspace --all-targets` 通过。
  `pnpm test:rust:pr` 全部通过：Library 524、CLI 33、slow integration 306；`pnpm test:rust:core`
  230 通过、5 个需人工真实 Runtime 的用例忽略。网络恢复的分类、队列、领域 fence 与 startup handoff 均通过。
- `pnpm typecheck`、`pnpm test`、`pnpm build:desktop` 通过：Vitest 157 个文件／1,608 个用例，最终 Node
  批次 222 通过／1 个 Windows-only 跳过；文档与 Skill 单测、Electron sandbox capability gate 通过。
  同步主线已过期的 Product Contract Fingerprint 测试期望到实际 schema 94，未改变产品 schema。
- `DOCS_BASE_REF=ec3b4295 pnpm docs:check:ci` 与 diff 检查通过。
- `cargo clippy --workspace --all-targets -- -D warnings` 未通过：`main.rs` 的
  `record_available_runtime_model` 具有 8 个参数，触发 `too_many_arguments`。该函数与主线 `ec3b4295`
  完全一致，本次保留并记录基线 lint；不声明完整 Clippy 门禁全绿。
- 实机恢复资格仍采用上节结果；自动化检查通过不代替 ACP 接管链路的真实验收。

## 单聊与执行台反馈补充

- [x] 排队不再返回空过程；发送确认前及排队显示“连接中”，开始处理但尚未输出时显示“思考中”；正文、计划、工具或 final 到达即移除普通提示，不出现耗时总结。
- [x] 单聊与执行台共用 `ExecutionToolGroup`；组按 Canonical Activity 计数，尾组延续、类型图标、四轨布局、结果加载/重试及键盘行为一致。
- [x] 终态才出现中文耗时；成功自动折叠外层，final 独立展开。状态切换不卸载已打开的组和工具结果。
- [x] TypeScript、完整 Vitest（157 文件 / 1,610 项）、Electron 双主题/七阶段、发送确认与拒绝、轮询与事件、工具结果失败重试、键盘及状态保留验证。

后续反馈修正：最小渲染回归复现“正文下残留 Thinking”，原因是普通状态行只避让工具、未避让 narration。
单聊和执行台现共用初始反馈判断；正文、计划、工具或 final 在同次渲染接替提示，保留整轮终态和异常状态边界。
定向 180 项测试与真实 Electron 双主题/七阶段验收通过；MutationObserver 验证首段及续写正文不与普通提示短暂共存，
同时验证 final 去重后不恢复提示，以及网络恢复仍显示具体状态。

本轮沿用已有 `SingleChatPanel` Electron fixture，并加入独立合成公共任务验证执行台，二者不共享正文或工具输出。
不新建数据/Runtime 夹具、不运行真实模型或写入日常 userData；不将合成证据验收宣称为真实 Runtime 资格测试。

验证命令：`pnpm typecheck`、`pnpm exec vitest run`、`node --test scripts/lib/single-chat-panel.test.mjs`、
`pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check` 与 `DOCS_BASE_REF=<PR base> pnpm docs:check:ci`。

成品补充验证：`pnpm package:mac:daily` 的 arm64/ad-hoc App、Core、CLI 校验通过。带隔离 userData 和
Skill Library 的工具详情定向验收通过，验证“完成了 1 个步骤”、Web 查询全文和 Shell 无输出结果展开。
全量 `accept:runtime-activity-ui` 本轮未通过：消息操作栏现有 `margin-left: -5px` 与旧脚本要求的零偏移不符；
该偏移在 PR #255 的基线已存在，本轮不修改消息操作栏或放宽全量断言。定向脚本的旧“已执行 1 项操作”
断言已同步当前工具组合同；该补充只改变验收脚本和记录，已打包的生产代码不变。

## 新对话创建性能补充

- [x] `camps.create` 改为只执行 `select_workspace` 的目录准入与规范化，不调用 Git inspection。
- [x] `observe_git` 移除 `git status` 工作树扫描，保留 capability、root/common directory、object format、
  HEAD 与 branch；新 observation 的 `dirty` 为 `None`。
- [x] 保留 `GitObservation.dirty` 的 nullable wire、数据库与历史读取兼容，不伪造 clean 状态，不修改诊断 schema。
- [x] 扩展既有 `git::tests` owner，证明 clean 与 modified 工作树都只返回相同 HEAD/branch 且 dirty unavailable；
  Files Changed / Diff Card 仍完全由 Runtime evidence 投影拥有。
- [x] 更新 Workspace / User Automation 权威、v2 合同、版本决定与导航。
- [x] 执行 Core、Desktop、文档治理与合入前门禁，并在下方记录结果及已确认的主线 Clippy 基线。

本轮不新增平行测试夹具：既有 `git::tests` 已拥有 Git metadata observation，直接扩展它即可捕捉重新引入
dirty scan 的行为合同；`smoke:core` 继续拥有临时数据目录与 Git / 非 Git Camp 创建的端到端 seam。性能边界
由调用图保证：Camp 创建路径不再包含 Git 子进程，Git observation 也不再包含工作树命令；不设置依赖机器负载的
毫秒阈值。

### 必跑命令

```bash
cargo fmt --all -- --check
cargo test -p rovai-core --lib git::tests::
cargo test -p rovai-core --bin rovai-core
pnpm smoke:core
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm test:rust:pr
cargo clippy --workspace --all-targets -- -D warnings
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
git diff --check
```

### 验证记录

- Git observation 定向 4 个用例通过；Core binary 230 个用例通过，5 个手工真实 Runtime smoke 按设计忽略。
- `TMPDIR=/private/tmp pnpm smoke:core` 通过，覆盖 fresh Core、Git / 非 Git Camp 创建、重启读取与删除；默认
  macOS `tmpdir()` 返回的 `/var` 别名会被既有 Runtime Files Root symlink 门禁拒绝，因此使用规范临时目录，
  未修改 smoke 脚本或产品门禁。
- `pnpm test:rust:pr` 通过：Library 524、CLI 33、slow integration 306 个用例全部通过。
- `pnpm typecheck`、`pnpm test` 与 `pnpm build:desktop` 通过；整合最新主线后的全量前端为 159 个 Vitest 文件／1,616 个用例，
  最终 Node 批次 222 个通过／1 个 Windows-only 跳过。
- `pnpm docs:test`（9 个用例）、`pnpm docs:check`、
  `DOCS_BASE_REF=c1582f4b6987b37979ca1b01fc7c639b5b800614 pnpm docs:check:ci`、Rust format 与 diff 检查通过。
- `cargo clippy --workspace --all-targets -- -D warnings` 仍只在未修改的
  `record_available_runtime_model` 报既有 `too_many_arguments`；该函数与本分支基线一致，本次不扩大范围修改。
- 当前工作树重复三次完整 `git status --porcelain=v1 -z` 分别耗时 1.69s、1.62s、1.39s；新的
  `camps.create` 调用图不含 Git 子进程，因而直接移除该段随工作树增长的创建等待。

真实 Runtime、日常 Electron userData 与用户工作区未参与本轮自动验收。

## Pi 未安装状态收敛补充

- [x] 删除 Pi optional subsystem 对 executable 安装存在性的重复检查，只保留 Pi Adapter 私有存储初始化。
- [x] 保留统一 Runtime discovery / Availability 的 `missing | path_missing` 与成员 Readiness / dispatch preflight 门禁。
- [x] 保留 Pi 私有存储初始化失败时 `runtime.pi` 单项 degraded 和进程内 retry，不在 Renderer 过滤真实故障。
- [x] 扩展既有 Core startup availability owner，在隔离搜索路径下同时断言 `runtime.pi=ready` 与 Pi
  Availability `missing`；Windows 使用 explicit override 的封闭候选集，Linux 使用空 PATH 并禁用 login-shell PATH
  补充，macOS 因固定 known locations 可能命中开发机安装而跳过该用例。
- [x] 同步当前决定、Architecture、Contract、兼容性清单和研究矩阵；v1.39 历史快照不改写。

测试前的失败输入是 Windows x64 fresh Core 加绝对但不存在的 `ROVAI_PI_BIN`：旧实现会把
`runtime.pi` 标成 degraded，同时 Availability 已经报告 missing。`scripts/lib/core-startup-availability.test.mjs`
原本就拥有真实 `run_core → ready → optional initialization → RPC` seam，因此直接扩展该 owner，不新增平行 Core
夹具。`core_subsystems::tests` 继续拥有 Pi 私有初始化失败只影响本 Runtime 的低成本隔离合同。

### 必跑命令

```bash
cargo fmt --all -- --check
cargo test -p rovai-core --bin rovai-core core_subsystems::tests:: -- --nocapture
pnpm test:core-startup
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
git diff --check
```

### 验证记录

- `cargo fmt --all -- --check`、Core subsystem 定向测试与 Core binary 全量通过：定向 2 个用例，
  全量 230 个通过、5 个手工真实 Runtime smoke 按设计忽略。
- Runtime status 与 Core subsystem notice 两份定向 Vitest 通过：25 个用例通过，确认继续复用既有“未安装”呈现，
  无需 Renderer 特判。
- `pnpm test:core-startup` 中 optional startup failure 四个子场景及其他 authority 场景通过；当前 macOS 主机的缺 Pi
  用例按设计跳过。套件另有两个与本次改动无关的既有 queue fixture 失败，均为
  `invalid type: map, expected u32`；单独重跑仍复现。Windows/Linux 隔离搜索路径回归留给对应 CI/目标主机执行。
- `pnpm docs:test`（9 个用例）、`pnpm docs:check`、
  `DOCS_BASE_REF=23bcc06435bd7ea906b562b474030756481e7d67 pnpm docs:check:ci` 与 `git diff --check` 通过。
