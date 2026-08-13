---
document_type: implementation-plan
version: v0.71
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-13
---

# v0.71 实施与验收计划

## Checkpoint 0：合同冻结

- [x] 删除普通 Agent 消息通知及其设置；
- [x] 冻结 Occurrence / Disposition / Episode / Change Journal 三层模型；
- [x] 冻结 Episode version 与 attention revision、最小 Journal 与 opaque action；
- [x] 冻结逐 Mention 确认、completion satisfaction、failed/incomplete 和 approval generation；
- [x] 冻结 clean break、retention/floor/reset 与五方法 Core interface。

## Checkpoint 1：持久模型与原子来源

- [x] Migration 79 删除旧通知域并创建 v1 schema/default preferences/baseline；
- [x] Mention、CampTurn terminal、Approval pending/resolve 和后续用户输入同事务投影；
- [x] stable source keys、order-independent semantic、episode/attention revisions 与 Journal 原子性测试；
- [x] retention 只回收终结 Episode，维护 Journal floor 并发送 remove change。

## Checkpoint 2：Core interface 与跨进程合同

- [x] 实现 inbox、changesSince、acknowledge、clear、markAllRead 与 preference；
- [x] Read Side 水合当前 Camp/title、message summary、author 和逐 action availability；
- [x] 删除 createdSince、markRead、markCampRead、clearRead 及旧 schema/type；
- [x] 更新 JSON-RPC params、TypeScript contract、Electron allowlist 和事件失效提示。

## Checkpoint 3：Renderer

- [x] Episode 一项一卡、All/Unread、分页、badge、empty/loading/error/recovery；
- [x] 基于 opaque action 精确打开 Approval/Message/Turn/Camp，不静默 fallback；
- [x] exact visible Mention 只 acknowledge 当前 message occurrence；
- [x] Journal heads-up 同 Episode 原地更新、关闭后只因新 heads-up reason 重弹、reload 不补弹；
- [x] 设置页面切换到四类别加总开关并保留 optimistic/CAS rollback。

## Checkpoint 4：验证

- [x] 定向 Rust module/migration/main tests；
- [x] Renderer/Vitest、Typecheck、Desktop build 与通知静态验收；
- [x] `cargo test --workspace`、Fmt、Clippy；
- [x] docs test/check/diff-aware/generation；
- [x] 隔离 App 双主题截图、键盘、最小窗口与 200% zoom 验收。

## Checkpoint 5：十一项 official Skill 与管理策略

- [x] 新增 Rovai 原生 `campfire` 六文件包，冻结自然阶段标题、共享邀请、单次主动澄清、终止与迟到回复边界；
- [x] `cli-operations`、`memory-stewardship` 标记为 `system_required`，Core 拒绝 enablement/Assignment
  修改并在 bundled installation 时修复旧配置漂移；
- [x] Skill Settings 只展示九项 user-managed official Skills，不渲染系统必需行或锁定控件；
- [x] 更新 TypeScript contract、Core manifest/projection fixtures、smoke/capture、Architecture、Contract、
  UI acceptance 与 ADR-0176；
- [x] 完成 Campfire validator、三个无既有对话上下文的情景演练、完整 Rust/Renderer/文档门禁与 Desktop build。

## 当前证据

### 确定性门禁

- v0.71 实现完成后的 `cargo test --workspace`：404 个 library、11 个 CLI、72 个 Core binary
  测试通过，3 个显式 real-Runtime manual tests 按合同 ignored；最终快进 main 只新增 library/UI
  改动，随后 `cargo test -p rovai-core --lib` 的 405 个测试再次全部通过；并行隔离修复写入后，
  `cargo test -p rovai-core --bin rovai-core` 的 73 个非 ignored 测试通过；
- `cargo fmt --all -- --check` 与
  `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `pnpm test`：Docs 21、Vitest 47 files / 314 tests、Node 179 tests 全部通过；
  `pnpm typecheck`：通过；
- `pnpm package:mac`：通过，生成隔离验收使用的 `dist/mac-arm64/Rovai-ai.app`；
- `pnpm docs:test`、`pnpm docs:check`、`pnpm docs:adr:generate -- --check` 与
  `DOCS_BASE_REF=a6397f32 pnpm docs:check:ci`：通过；`git diff --check`：通过。

### 隔离打包 App 验收

`pnpm accept:notification-ui` 使用全新临时 `userData` 与数据库通过，证明：

- source facts 原子物化 Episode，既有历史和 App restart 都不补弹 heads-up；
- exact Mention 先确认当前 Occurrence，再精确定位消息；同 Turn 两次 Mention 更新同一 heads-up DOM；
- bounded mark-all、attention-revision clear、五个设置开关、关闭恢复焦点与 heads-up 不抢焦点成立；
- Porcelain Day、Steel Night、最小窗口、reduced motion 与 200% zoom 均无横向溢出且保留可操作性。

### Official Skill 增量

- `campfire` 通过 `skill-creator/scripts/quick_validate.py`；三次独立情景演练覆盖 Default Lead 共享邀请与
  话题替换、成员开场与终止纪要、单次主动澄清与无终止副作用；
- Skill Settings 聚焦测试证明两项 `system_required` Skill 即使搜索命中也不展示；Core tests 证明支持的
  配置命令失败关闭，并能恢复 DB-only legacy drift；
- `ROVAI_SKILL_SMOKE_ADAPTERS='' node scripts/smoke-skills.mjs` 在隔离 Core 上证明十一项 inventory、
  两项 system-required policy/命令拒绝、默认九组、重启恢复与 source-independent immutable copy；
- `pnpm build:desktop`、完整 workspace tests、Clippy、Typecheck、文档治理与 `git diff --check` 均通过。

Checkpoint 0–5 与全部发布门槛已完成，版本 `implementation_status` 为 `complete`。
