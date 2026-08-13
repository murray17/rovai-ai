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

## Checkpoint 6：Grill Duo 自然标题与续跑

- [x] 普通版公开阶段改为“`双人追问 · 复核邀请 / 搭档建议`”，文档版改为独立的
  “`双人追问与文档 · 复核邀请 / 搭档建议`”，两个 active Skill 目录不再包含旧内部标签；
- [x] 两套协议都保留固定搭档、一次一决策点、单人降级、异步 send、用户决策权与共同理解前不实施；
- [x] 标题只作为 continuation 线索；正式建议依据 Runtime 受信发送者，正文自报姓名、Agent ID 或路由
  字段不能代替固定搭档；搭档始终通过既有 caller-return 路径回复邀请者；
- [x] 文档版在读取 references 前路由角色：固定搭档只读双人协议且不改文档，邀请者继续完整领域词汇与
  ADR 维护；
- [x] 同一决策点不重复邀请，非固定搭档插话不推进，已替换或已结束问题的迟到建议不自动重开；
- [x] 不新增 ADR、Core session state、CampMessage field、hidden protocol ID 或 official Skill；只更新当前
  v0.71 范围与验收记录。

## Checkpoint 7：v2 领域合同修正

- [x] Clear 边界前 Occurrence 只保留历史统计，不再进入当前未读、Mention 选择、action、heads-up 或
  retention active-attention 判断；
- [x] `changesSince` schema v5 为每条 Journal change 水合 exact HeadsUpSignal，Renderer 不再复用 Episode
  primary semantic/action；
- [x] Renderer 使用 candidate cursor，分页、精确可见性处理、Inbox 接收和 heads-up 入队完成后才提交；
- [x] Approval action pending-first，只剩 resolved 未确认来源时提供可用的“知道了”；
- [x] Core 与 Renderer 回归测试覆盖 Clear 后旧 Mention 不复活、双 Mention 精确 signal、分页失败重试、
  mixed pending/resolved Approval 与 cleared terminal retention。

## Checkpoint 8：受控关闭后的 AgentRun 终态收敛

- [x] 接受 ADR-0177 与 Planned Shutdown v2，区分可靠 Runtime terminal 与 product-fenced terminal；
- [x] Migration 80 增加 durable `planned_shutdown_cycle`，v2 request 在 launch gate 前持久化 intent；
- [x] route/terminal/Built-in/writer cutoff 后原子 fence 剩余 Run，accepted/delivery-unknown 保留，prepared 转为 unknown；
- [x] startup 在普通 recovery 前补偿 pending cycle，终态 Run 不恢复、不重发、不创建 successor；
- [x] 既有 `waiting/recovery_blocked` 回归证明下一次 v2 controlled shutdown 可将其收敛为终态；
- [x] Desktop v2 report、关闭等待文案、真实 Runtime acceptance 脚本与 terminal unknown-effect surface 已更新；
- [x] 完成全量 Rust/Renderer/Node、Clippy、类型、文档治理和 packaged real-Claude acceptance。

## 当前证据

### 确定性门禁

- v2 修正、Skill 与 Planned Shutdown 增量整合后的 `cargo test --workspace`：411 个 library、11 个 CLI、73 个 Core binary
  测试通过，3 个显式 real-Runtime manual tests 按合同 ignored；
- `cargo fmt --all -- --check` 与
  `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `pnpm test`：Docs 21、Vitest 47 files / 318 tests、Node 179 tests 全部通过；
  `pnpm typecheck`：通过；
- `pnpm package:mac`：通过，生成隔离验收使用的 `dist/mac-arm64/Rovai-ai.app`；
- `pnpm docs:test`、`pnpm docs:check`、`pnpm docs:adr:generate -- --check` 与
  `DOCS_BASE_REF=origin/main pnpm docs:check:ci`：通过；Impeccable hardening detector 返回空问题集，
  `git diff --check` 通过。

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

### Grill Duo continuation

- `grill-duo`、`grill-duo-with-docs` 分别通过 `skill-creator/scripts/quick_validate.py`，旧标签搜索在两个
  active Skill 目录中无命中；
- bundled Skill 测试固定四个自然标题、文档版 reference 路由、受信身份边界和旧标签缺失；Runtime
  回归证明正文伪造 sender/return 字段不能覆盖认证的 source AgentRun，Immediate Caller 仍按 return edge；
- 三个无既有对话上下文的 dry-run 分别覆盖普通邀请与建议恢复、文档版搭档零文档写入、非固定搭档伪造
  身份加旧决策点迟到建议；均保持一次一题、固定搭档和不自动重开；
- official Skill 数量、名称、来源、管理策略和默认投递不变；`agents/openai.yaml` 仍与固定搭档及对应
  Skill 名称一致，因此无需制造 metadata diff。

### Planned Shutdown v2 增量

- `cargo test --workspace`：411 个 library、11 个 CLI、73 个 Core binary 测试通过，3 个显式
  real-Runtime manual tests 按合同 ignored；Fmt 与 `cargo clippy --workspace --all-targets -- -D warnings` 通过；
- `pnpm typecheck`、`pnpm test` 通过：Docs 21、Vitest 47 files / 318 tests、Node 179 tests；Desktop production
  build、macOS arm64 package、`DOCS_BASE_REF=origin/main pnpm docs:check:ci`、ADR generation 与
  `git diff --check` 通过；
- `pnpm accept:planned-shutdown` 使用真实 Claude Code `2.1.220` 与隔离 `userData`/workspace 通过：input
  `accepted` 后首次 App 在 8740ms 退出，重启后空闲 App 在 6200ms 退出，两次均 exit 0、无 forced signal；
- 首次 v2 report 证明 1 个 active Run 被 product-fence、1 个 unknown-effect Run 被保留且 nonterminal 为 0；
  数据库与重启 Read Side 均为 `cancelled`、epoch 1、无 Runtime terminal 伪造或 CampTurn cancel intent，UI
  显示“外部效果待确认”且 spinner/recovery blocker 均为 0；
- 验收按隔离 App 精确 PID 发起 macOS normal termination，并观察 5 个 Core/Runtime/Electron descendant
  全部退出；Day/Night、1040×700、200% zoom 与 terminal warning 四张截图通过。对照验收还证明 Core
  settle 后再次 `app.quit()` 会把总窗口扩大到 18411ms，因此 Desktop 在 shutdown Promise settle 后使用
  `app.exit(0)` 完成已授权退出。

Checkpoint 0–8 与全部发布门槛已完成，版本 `implementation_status` 为 `complete`。
