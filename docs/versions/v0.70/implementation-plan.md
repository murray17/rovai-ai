---
document_type: implementation-plan
version: v0.70
authority: implementation-plan-and-acceptance
status: closed_incomplete
last_updated: 2026-08-13
---

# v0.70 实施与验收计划

## Checkpoint 0：语义与版本边界

- [x] 确认缺陷属于 Agent-facing teaching，而不是 `mentionUser` Core execution；
- [x] 固定唯一逐消息判据：新的未解决用户决定、回答或行动，或用户明确要求的重要结果通知；
- [x] 明确闭环责任是 Agent 使用指导，不能转化为 Core role authorization；
- [x] 接受 Camp Message Send v5 与 Built-in Tool Transport v8，不新增 ADR、Migration 或 UI 合同。

## Checkpoint 1：精确 help 与 schema

- [x] 集中 catalog summary、schema description、`--to-user` exact-help 文案和基础示例；
- [x] 删除基础 `--to + --to-user` 组合示例，改为 public-only、Agent-only、User-attention-only；
- [x] 精确 help 覆盖正向判据、负向场景、message-local、无 Delivery 与无批准语义；
- [x] `mentionUser` schema description 使用相同约束，并保留 boolean/default-false wire。

## Checkpoint 2：Charter 与 Skill

- [x] Session Charter 增加一条短边界，不复制完整 schema 或组合决策树；
- [x] Send reference 删除“需要用户查看”条件，增加 message-local non-inheritance；
- [x] 记录内部 Agent 与用户侧闭环责任，以及独立行动才允许组合的规则；
- [x] 保持 `cli-operations` 窄触发；official inventory 的独立增量由 Checkpoint 6 与 ADR-0174 拥有。

## Checkpoint 3：Transport、catalog 与 Session compatibility

- [x] 升级 Built-in Tool contract/CLI command/capability 到 v8；
- [x] 保留 IPC、Envelope、receipt、Agent Output、Core send handler 与持久效果版本；
- [x] 增加 catalog digest 对 teaching schema 变化敏感的回归；
- [x] 增加 Antigravity v7 catalog identity 不能兼容续接 v8 binding 的回归，不全局轮换其他 Runtime Session。

## Checkpoint 4：自动化验证

- [x] 通过 `cargo fmt --all -- --check`；
- [x] 通过定向 Rust tests、`cargo test --workspace` 与 `cargo clippy --workspace --all-targets -- -D warnings`；
- [x] 通过 Built-in CLI/Skill 相关 Node 静态检查、全量 `pnpm test` 与 Codex v8 smoke；
- [x] 通过 `pnpm docs:test`、`pnpm docs:check`、ADR generated history 与 diff-aware docs CI；
- [x] 通过 `git diff --check` 并审阅无 Core effects、Migration、UI 或持久 schema 漂移。

## Checkpoint 5：真实 Runtime 行为

- [x] 使用 Codex Runtime 复现普通内部协作链，确认最终 Camp Message 不生成 Current User Mention；
- [x] 记录 Runtime/模型版本、Native Session 新建方式、输入场景与 exact addressing 证据；
- [ ] 在版本关闭前运行九 Runtime v8 Built-in CLI/Skill 矩阵；该门槛未按时完成，版本以
  `closed_incomplete` 冻结。
- [x] 关闭后在 v0.70 最终快照补跑矩阵并记录 `8/9 pass + 1 blocked` 的追溯证据，不倒推发布门槛完成。

## Checkpoint 6：固定 GitHub 来源的三项工程 Skill

- [x] 固定 `mattpocock/skills` 精确 Revision，完整 vendor 三个选定目录并附 MIT LICENSE/NOTICE；
- [x] 收窄 `diagnosing-bugs`、`tdd`、`writing-for-agents` description，并提供本地化
  `agents/openai.yaml`，不改写其余上游内容；
- [x] Core 构建 manifest、official installation、provenance、文件数与脚本风险摘要覆盖十项 inventory；
- [x] Settings 来源单测、fresh-Core smoke fixture、UI acceptance 数量与术语同步四项固定 GitHub 来源；
- [x] 完成 Skill validator、Rust/Renderer 聚焦回归、文档治理、生成 HISTORY 与 diff check。

## Checkpoint 7：自动生成 Camp 标题去噪

- [x] 标题生成改为读取权威 Structured Content，只移除开头连续的真实队员/所有队员 Mention；
- [x] 中后部 Mention 与手写 `@文字` 保留为普通标题文字，侧栏不新增 Mention 点击或人物卡入口；
- [x] 纯 Mention 首条消息稳定回退“未命名对话”并收口为 `generated`，不允许后续消息二次命名；
- [x] 日常数据库完成一致性检查、备份与四条 `generated` 历史标题刷新，用户命名不变；
- [x] 完成 Rust/文档最终门禁、macOS 打包安装与日常数据重启复核。

## 当前证据

### 确定性门禁

- `cargo test -p rovai-core --lib`：404 passed；`cargo test -p rovai-core --bin rovai`：11 passed；
- `cargo test --workspace`：404 lib + 11 CLI + 72 Core binary passed，3 个显式 real-Runtime manual tests ignored；
- `cargo fmt --all -- --check` 与 `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `pnpm test`：Docs 21、Vitest 47 files / 311 tests、Node 179 tests 全部通过；`pnpm typecheck`：通过；
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=origin/main pnpm docs:check:ci`、
  `pnpm docs:adr:generate -- --check`：通过；
- `rovai --version` 为 `contract-v8 ipc-v1`；精确 Send help 的三类分离示例与负向断言通过；
- Codex 单 Runtime `smoke-builtin-cli` 完成 13 项 v8 operation、successor exact reads 与 Native Session
  continuation。运行时发现夹具曾错误要求 started evidence 携带 Core Envelope；现已限定为验证
  completed/failed terminal evidence，产品合同未变。

### Skill inventory

- 三个新增目录分别通过 `skill-creator/scripts/quick_validate.py`；与 pinned archive 对比证明除
  description 和 `agents/openai.yaml` 外的上游正文/资源及三份 LICENSE 字节一致；
- `cargo test -p rovai-core skill::tests` 为 `13/13`，
  `cargo clippy -p rovai-core --all-targets -- -D warnings`、`cargo fmt --all -- --check` 通过；
  Skill Settings 聚焦 Vitest 为 `9/9`，并通过
  `pnpm typecheck` 与两个 smoke/acceptance 脚本的 Node syntax check；
- `ROVAI_SKILL_SMOKE_ADAPTERS='' node scripts/smoke-skills.mjs` 在隔离 Core 上证明十项 official
  inventory、三项共同 pinned provenance、默认九组、重启恢复与 source-independent immutable copy；
  此模式明确不调用真实模型，`runtimes=[]`，不新增 Runtime compatibility 结论；
- `pnpm docs:test` 为 `21/21`，`pnpm docs:check`、`DOCS_BASE_REF=origin/main pnpm docs:check:ci`、
  `pnpm docs:adr:generate -- --check` 与 `git diff --check` 通过，HISTORY 已包含 ADR-0174。

### Camp 标题去噪

- `cargo test -p rovai-core collaboration::tests` 为 `29/29`；单元边界覆盖多个开头 Mention、
  中后部 Mention、手写 `@文字`、纯 Mention 回退和 80 Unicode scalar 上限，端到端路径证明显式
  双成员寻址仍唤醒两名队员，而持久 Camp 标题只保留正文；
- 日常数据库在 App 退出后通过 SQLite Backup API 保存为
  `rovai.sqlite.pre-title-refresh-20260813-144339.backup`，备份和更新后数据库均通过 `integrity_check`；
  四条 `name_origin = generated` 标题按同一 Structured Content 规则刷新，数量与 origin 不变，
  `user` 标题未写入；
- `pnpm package:mac` 生成 arm64 App；bundle、Core、CLI 与原生预热模块均通过严格 codesign，
  Core/CLI Mach-O UUID 分别为 `ED25FC44-2996-3CAC-98B7-7CE649A329EE` 与
  `DFBDF1F5-2289-30EB-8DEB-899411DF6B56`，和 release 构建一致；
- packaged App 以独立临时 `userData` 启动到 Renderer/Core，临时数据库 `integrity_check = ok`，
  受控退出报告 `deadlineExpired=false`、`forcedSignal=null`；随后安装到 `/Applications/Rovai-ai.app`，
  旧 bundle 备份为 `/Applications/Rovai-ai.backup-20260813-154719.app`；
- 日常安装版从 `/Applications` 启动，Renderer 与 Core 均使用
  `/Users/murray.xue/Library/Application Support/Rovai-ai`；重启后的日常数据库一致性为 `ok`，
  四条 generated 标题均保持去除开头 Mention 后的值。

### 真实模型行为

2026-08-13 以自动验收通道、全新隔离 Core data-dir 和全新 Native Session 运行
`ROVAI_SKILL_SMOKE_ADAPTERS=codex-cli node scripts/smoke-skills.mjs`：

- Runtime：`codex-cli 0.147.0`；模型：`gpt-5.6-sol`；AgentRun：
  `5649c174-aff3-4a98-ae70-beb6edc882c6`；
- 输入场景是“创建已分配给目标 Agent 的持久责任，随后向同一 Agent 发布内部交接”；输入同时明确
  没有新的未解决用户决定、回答或行动，用户也未要求重要结果通知；
- Agent 读取 `rovai task create --help` 与 `rovai send --help` 后输出
  `attention=omit --to-user`；该 AgentRun 的最终结构化 Camp Message 不含
  `current_user_mention`；
- smoke 同时验证 official `cli-operations` Revision 与测试 Skill 均由隔离 managed library 投递。

v0.67 的九 Runtime v7 矩阵只证明旧 Core effects、CLI transport 和初版 Skill delivery，不证明本版本
收窄后的模型行为。v0.70 关闭时九 Runtime v8 正式矩阵尚未执行，因此历史状态为
`closed_incomplete`；关闭后的补测记录如下，不能改写当时的完成度。

### 关闭后九 Runtime v8 补测

2026-08-13 从 v0.70 最终产品快照 `a6397f32` 构建 debug Core/CLI，并为每个用例创建独立临时
Core data-dir、Skill Library、Git workspace 与 Native Session。产品代码保持该快照；补测过程中只
修正两项 smoke 自身的假阴性断言，并把相同修正带回当前分支：

- Shadowed 检查按 Core 返回的精确 `entryPath` 识别 projection，不再用逻辑 Runtime Group 猜测
  物理投递组；OpenCode 的逻辑组为 `opencode`，实际复用 `.claude/skills`；
- 对 `attention=omit --to-user` 的比较先去除 Markdown 反引号，允许 Runtime 把参数格式化为行内代码，
  同时继续要求 `mentionsCurrentUser=false` 并拒绝虚构参数。

| Runtime | 实测版本 / 模型 | Built-in CLI v8 | managed Skill v8 |
| --- | --- | --- | --- |
| Codex CLI | `0.147.0` / `gpt-5.6-sol` | pass | pass |
| OpenCode | `1.18.10` / `opencode/big-pickle` | pass | pass |
| GitHub Copilot CLI | `1.0.79` / `claude-sonnet-5` | blocked：月度配额耗尽 | blocked：月度配额耗尽，两次一致 |
| Claude Code | `2.1.220` / runtime default | pass（聚焦重试） | pass |
| Antigravity | `1.1.12` / runtime default | pass | pass |
| Kiro | `2.16.1` / `auto` | pass | pass |
| Qoder | `1.1.17` / `deepseek/deepseek-v4-flash-pg` | pass | pass |
| CodeBuddy | `2.133.1` / `deepseek-v4-flash` | pass | pass |
| Qwen Code | `0.21.5` / `deepseek-v4-flash(openai)` | pass | pass |

通过的八个 Built-in CLI Case 均完成 13 项 canonical operation、三种 send 输入、successor exact
reads、stale-version conflict、前后 lease fencing 以及 logical/native continuation；通过的八个 Skill
Case 均完成 managed projection、私有 marker、exact task/send help、消息局部 attention、重启恢复、
Shadowed 与删除边界。Claude Built-in 首次批量运行在接受输入后无 stderr 退出，聚焦重试完整通过；
最终记 pass。Copilot 两类用例均得到服务商明确配额错误，不能形成兼容性 pass，也没有证据表明是
产品回归。

最终追溯结论为 Built-in CLI v8 `8/9 pass + 1 blocked`、managed Skill v8
`8/9 pass + 1 blocked`。它补足了可执行证据，但仍未满足冻结前的九 Runtime 发布门槛，因此本计划
状态与版本 overview 一致保持 `closed_incomplete`。
