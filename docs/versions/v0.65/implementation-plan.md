---
document_type: implementation-plan
version: v0.65
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-12
---

# v0.65 实施与验收计划

> Phase 1 与 Phase 2 只决定执行顺序，不是发布切分。任一阶段、任一 Runtime real smoke 或完整
> 门禁未完成时，本计划和版本概览都保持 `in_progress`。

## Checkpoint 0：领域、ADR 与合同

- [x] 冻结唯一 `local_user`、Agent routing / User attention 正交轴与原子通知边界；
- [x] 区分 `submittedBody`、Structured Camp Message Content 与 `projectedBody`；
- [x] 冻结 Camp Message Send v4、Current User Attention v1、Built-in Tool Transport v7；
- [x] 冻结精确 Camp read addressing、compact send output 与无 locator `confirm_outcome` stop；
- [x] 冻结 Charter / operation help / `cli-operations` / `memory-stewardship` 的分层职责。
- [x] 冻结恰好七项 official Skill inventory、普通 `cli-operations` 投递与 pinned `tasteful-ui` 继承。

## Phase 1：`--to-user` 完整领域合同

### Checkpoint 1：Core 内容、身份与迁移

- [ ] 在 `camp_content.rs` 增加 closed `current_user_mention` segment，并由 Core 唯一常量解析
  `userId = "local_user"`；
- [ ] Agent send 先把 `submittedBody` 的 strict inline Agent tokens 转成结构化 Member Mention，
  再在 `mentionUser=true` 时前置 Current User Mention；
- [ ] plain-text renderer、digest、Camp search/index、Context selection 与消息 read side 全部由
  Structured Content 投影，不把持久 `body` 当第二真源；
- [ ] 把 `camp_message.body` 收敛为可重建 projected-body cache；消息接受时同步生成，当前用户显示名或
  fallback locale 变化时事务内重投影相关消息并刷新 FTS，失败不留下混合版本；
- [ ] Migration 77 发布 Data Contract `v0.65` / projection schema 32、CampSnapshot 29、Notification
  item 3、Context Formatter 14 / Manifest 12，并使 incompatible frozen delivery context 与 native
  context markers 按 clean break 重建；
- [ ] 一次性把 Rovai-owned `local-user` 身份引用重建为 `local_user`，不保留 alias、双读或双写；
- [ ] migration 只处理 Rovai-owned data，不删除用户 Project、外部 Runtime session 或 Runtime-owned file。

### Checkpoint 2：原子发送与通知

- [ ] `CampMessageSendInput`、CLI schema 与 domain command 增加 optional/default-false `mentionUser`；
- [ ] 接受事务同时写 CampMessage、structured mention、canonical agent recipients、Delivery/slot、
  `camp_message_user_mention` notification、receipt 与 events；任一失败全部回滚；
- [ ] notification 唯一键固定为
  `(kind, recipient_user_id, source_message_id)`，同消息 replay 返回原 message/notification；
- [ ] `source_message_id` 保存稳定 locator 且不对单条 CampMessage 做级联；`camp_id` 继续
  `ON DELETE CASCADE`，因此 Camp 仍在而消息不可读时保留“来源不可用”，整 Camp 删除时移除通知；
- [ ] `mentionUser=true` 且零 Agent recipient 创建消息和通知但零 Delivery；带 `taskId` 时因此以
  `message.task_recipient_ambiguous` 拒绝；
- [ ] 通知 read/clear/retention/source-unavailable、`campId + messageId` 导航全部复用现有 Inbox
  生命周期；现有 clear 作为删除/归档动作且不删除 CampMessage，不新增第二个 archive state；
- [ ] notification summary 只在读取时形成有界 projected-body projection，表中不保存 summary/body。

### Checkpoint 3：Transport v7、CLI 与读侧

- [ ] `rovai send --to-user`、direct flags/stdin/input-file 三输入路径与 command-local help 完成；
- [ ] contract/CLI/capability 升到 v7，十三项命令数、Unix IPC、Envelope、receipt、lease 与 Agent
  Output v2 保持；
- [ ] exact `camp.read(mode="item")` 每个唯一 item 返回 closed `addressing`；其他 mode 与 search
  snippet 保持 compact；
- [ ] send stdout 继续精确为 `{messageId,effectiveRecipients}`，不出现 `local_user`、notificationId
  或 `userMentioned`；
- [ ] error recovery 与 help 覆盖 zero/one/many task recipient、unknown field、handwritten lookalike、
  replay、idempotency conflict 与 outcome indeterminate。

### Checkpoint 4：Context、Renderer 与 Notification UI

- [ ] Current Input 与 Shared Conversation model projection 从 Structured Content 输出可见 Mention 文本，
  并增加 `mentionsCurrentUser` metadata；Context Formatter v14 / ContextManifest v12 冻结 exact bytes/digest；
- [ ] Camp timeline 把 Current User Mention 显示为非交互蓝色 inline token；无底色、无常驻边框、
  不进入 tab order，aria-label 为“提及当前用户：{显示名称}”；
- [ ] plain-text copy 输出可见 `@显示名称`，私有 structured Clipboard 保留 segment；粘入用户 Composer
  时降级为 Text，不能让用户 Draft 创建 Agent-only Current User Mention；
- [ ] Notification Center 增加固定 kind 文案、消息摘要和精确消息定位；来源不可用时只显示明确退化态；
- [ ] 单项/单条 heads-up 点击继续并行发起幂等 mark-read 与精确导航：任一失败不阻塞或回滚另一项；
  已知来源不可用只标记已读，不关闭到错误 Camp；
- [ ] preference 增加默认开启的 `userMentionHeadsUpEnabled`，关闭只影响新 heads-up；
- [ ] 在现有单槽/最多三项/溢出摘要上增加 8 秒同 Camp user-mention heads-up 聚合；底层 Inbox
  每条消息仍独立，聚合项不批量标记已读；
- [ ] Day/Night、1440×920、1040×700、200% zoom、键盘、读屏、拖选和 reduced-motion 验收通过。

## Phase 2：CLI 渐进式教学

### Checkpoint 5：Session Charter 与精确 help

- [ ] 精简 `charter-rovai-cli.md`，保留固定命令、current Run Camp、输入来源、compact result、公共
  send 义务与 `confirm_outcome` 安全边界；
- [ ] Charter 固定文案：先运行 `rovai --help` 选择 operation，再运行该 operation 的精确
  `--help`；不得假设 command family 有独立 help；
- [ ] catalog/CLI golden 覆盖 `rovai --help`、`rovai send --help`、全部 group+action help，并负向
  断言 `rovai task|camp|memory --help` 不是教学入口；
- [ ] `--to-user` 的 flag、例子和约束只由 `rovai send --help` 拥有。

### Checkpoint 6：`cli-operations` official bundled Skill

- [ ] 新增 `skills/cli-operations/SKILL.md`、`agents/openai.yaml` 与有效相对链接 references：
  `send.md`、`task.md`、`camp-history.md`、`memory.md`、`recovery.md`；
- [ ] `agents/openai.yaml` 固定显示名“CLI 操作协调”、已确认短简介与包含 `$cli-operations` 的默认
  prompt；SKILL front matter 只含 `name/description`，不增加 README、安装指南、changelog 或空资源目录；
- [ ] description 仅触发命令族歧义、message→Task 判断、多操作协调或复杂 recovery；普通单一
  send/recipient flag/list/get/search/read 明确不触发；
- [ ] recovery reference 冻结 locator-present camp.read confirmation 与 locator-absent stop/no-resend；
- [ ] Skill 不复制完整 schema，不制造 family-level help，不含 ChatGPT URL、坏相对链接或嵌套 fence；
  五份 reference 从 SKILL.md 一层直达并通过 front matter/link/bundled manifest 校验；
- [ ] Core bundled manifest/inventory/test 加入该 Skill，默认 enabled + 九组，用户禁用/Assignment
  修改继续保持，不增加 special source 或 required 状态。

### Checkpoint 7：`memory-stewardship` 无损整理

- [ ] 先建立现有规则 checklist，再把长正文按需要搬到 references；SKILL.md 仍明确何时触发与读取顺序；
- [ ] 保留 user/current authority、Entrypoint discovery cache、read-before-ID、五类 cache state、禁止
  file/SQLite/projection access、secret/untrusted instruction、scope/kind/direction、latest baseRevision、
  body/retrieval-key 限制、dedupe/revise/Hearth 顺序；
- [ ] 所有调用名改为 `rovai memory search|read|write|propose-hearth`，help 只使用完整 operation path；
- [ ] 用 golden semantic assertions 证明拆分前后上述规则逐项存在，不以字节相等代替无损语义。

## Checkpoint 8：自动化、真实 Runtime 与发布收口

- [ ] Core 单元/集成覆盖 structured digest、projection、search、Context、atomic rollback、notification
  uniqueness/replay、task cardinality、read addressing、display-name/locale reindex、source unavailable、
  preference/retention；
- [ ] CLI/catalog 覆盖 v7 constants/capability、closed input、`--to-user`、compact output、exact help 与
  outcome-indeterminate recovery；
- [ ] Skill tests 覆盖七个 official inventory、默认九组、用户修改保持、全部 reference 文件与
  `memory-stewardship` semantic checklist；
- [ ] Renderer tests 与 packaged acceptance 覆盖 token、copy/paste、a11y、notification row、8 秒聚合、
  unread/clear、source unavailable 和设置即时生效；
- [ ] 九 Runtime 各在隔离 data-dir/workspace 完成 public-only `--to-user`、Agent+user 双轴、exact
  camp.read addressing、single-operation help 与一次 Skill 复杂协调场景；
- [ ] 完成 Rust workspace、fmt/clippy/check、Vitest/Node、typecheck/build、docs gates、diff check；
- [ ] 回填真实命令、计数、Runtime 版本、截图与限制；只有全部完成才把两个状态改为 `complete`。
