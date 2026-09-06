---
document_type: implementation-plan
version: v1.53
authority: implementation-and-acceptance-status
status: in-progress
last_updated: 2026-09-06
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
  schema 93 现在是 Migration 143 的精确来源，迁移完成后的 current marker 为 `v1.53/schema 94/activity-v3`。
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
