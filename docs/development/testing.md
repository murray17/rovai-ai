---
document_type: development-guide
authority: test-policy-and-command-routing
last_updated: 2026-08-17
---

# 测试与 Smoke Test

[`package.json#scripts`](../../package.json)是 JavaScript 命令名和组合的真源。Rust 测试
目标由 Cargo workspace 和测试代码决定。

## Rust 测试准入与退役门槛

测试总数不是质量指标，本仓库不设置“每个功能必须新增几项测试”或“每个 PR 最多新增几项测试”的
固定配额。评审门槛是每项测试是否拥有清晰、唯一且值得长期维护的合同；相同覆盖应优先扩展既有
owner，而不是继续增加平行 fixture 和断言。

### 新增独立测试

新增一个 Rust `#[test]` 前必须同时满足以下条件：

1. **拥有独立失败语义**：覆盖新的状态转换、错误分支、安全边界、兼容入口或可复现 regression；
   仅再次证明已有 happy path、同一个 schema 字段或同一个 mapping case 不构成新增理由。
2. **选中最低成本 owner**：纯函数和常量优先由单元测试、类型系统或模块级 `const` assertion 负责；
   只有跨模块事务、持久化、重启或进程边界才建立完整 SQLite / Runtime fixture。Integration 测试只
   证明 seam 能传递结果，输入矩阵仍由较低层的唯一 owner 负责。
3. **先检查等价覆盖**：同一 setup、同一执行路径、仅输入或期望值不同的 case，优先加入表驱动测试；
   同一份稳定 JSON、schema、digest 或教学文案只保留一个 golden/fixture owner，其他层只断言自己
   消费的结构或传递合同。
4. **结果必须确定且隔离**：断言业务 outcome、持久状态或公开合同，不依赖 inode 必须变化、未冻结的
   wall clock、线程调度、目录枚举顺序或真实网络偶然性。文件与数据库只能使用临时 fixture；真实
   Runtime / 模型验证归入明确的 Smoke，不混入普通 `cargo test`。
5. **重复执行必须证明额外性质**：确定性 replay、parser 或 database call 默认执行一次。循环、并发或
   多次重启只在测试明确拥有 race、顺序、幂等窗口或有界统计性质时使用，并在名称或邻近注释中说明
   次数为何影响合同。
6. **名称描述当前合同**：使用行为与结果命名，不使用 `checkpoint_N` 等已结束里程碑。Migration fixture
   可以保留受支持的 source contract / schema 版本，因为版本本身就是兼容入口。

永久禁用的测试代码不予准入：不得用 `#[cfg(any())]`、注释掉的 `#[test]` 或永远为假的 feature 条件
保存未来可能有用的测试。仍有当前合同就修复并启用；合同已退出就删除，由 Git 历史保存。只有需要
人工凭据、真实外部 Runtime 或专用硬件的可执行验证才能使用带原因的 `#[ignore = "..."]`，并应优先
由上文定义的 Smoke 入口拥有。

新增测试的变更说明至少回答四件事：合同 owner 是谁、修复前哪个输入会失败、为何不能扩展现有测试、
以及最小验证命令是什么。使用完整数据库或进程 fixture 时，还必须说明为什么较低层测试不足。无法
回答时，不新增独立测试函数。

### 删除、合并或改写测试

删除 active test 必须给出以下一种可审阅证据：生产路径与合同在同一改动中退出；等价合同已有唯一
owner 并保留全部有意义的 case；或约束已上移到类型系统、编译期 assertion 或更强的边界测试。合并为
表驱动测试时，必须逐项保留原测试的正向、负向和边界输入，不能只保留最常见 case。

以下类别不得仅因测试长、数量多、名称含旧版本或执行较慢而删除：

- 当前支持来源的数据库 Migration 与业务数据保留 / clean-break 验证；
- unknown outcome、崩溃恢复、重启 reconciliation、generation / execution fencing；
- 权限、symlink、path traversal、fail-closed 与 closed schema；
- raw body、token、credential、Authorization 等泄密防护；
- Unicode 边界、immutable manifest、幂等冲突与只读 replay lookup。

Migration 测试只有在最低支持升级版本和 fresh-database baseline 已于同一改动中明确收口后才能退役。
大测试若确实拥有多个独立失败原因，应按 owner 拆分；拆分后测试数增加是可接受结果，不能为了净减少
数量而牺牲故障定位。

测试清理的变更说明应记录删除/合并前后的可执行测试清单变化、保留下来的 successor owner，以及定向
和全量命令。可以用以下命令核对数量，但数量只用于解释 diff，不作为通过门槛：

```bash
cargo test -p rovai-core --lib -- --list
cargo test --workspace -- --list
```

## 测试层级

### 日常 commit 验证

```bash
pnpm typecheck
pnpm skills:test
pnpm skills:check
pnpm test
pnpm test:rust:staged
```

`pnpm test` 首先显式执行 `pnpm docs:test`、`pnpm docs:check`、`pnpm skills:test` 和
`pnpm skills:check`。`docs:test` 覆盖 YAML/Markdown 解析、直接替代图、CURRENT/HISTORY、链接、
legacy exception、amendment 和 diff freeze fixture；`docs:check` 验证当前版本唯一性以及真实仓库的
ADR/Architecture/链接快照。Skill 检查覆盖通用 authoring fixture、
frontmatter、界面元数据和 bundle 内相对链接，不用自然语言逐字断言代替协作场景验收。文档治理改动至少单独运行：

```bash
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<目标分支 base SHA> pnpm docs:check:ci
pnpm docs:adr:generate -- --check
```

`docs:check:ci` 缺少 base SHA 或无法读取 base object 时必须失败，不能退回本地 `origin/main`。
这些命令不替代其余代码测试。

#### Staged Rust 路由

`pnpm test:rust:staged` 读取 `git diff --cached`，只根据 staged 快照选择 Rust 验证范围：

| staged 改动 | 执行命令 |
| --- | --- |
| 无 Rust/Cargo 文件 | 跳过 Rust 验证并明确输出 skip 消息 |
| 仅 `crates/rovai-core/src/bin/rovai.rs` | `pnpm check:rust`、`pnpm test:rust:cli` |
| 仅普通 Library 模块 | `pnpm check:rust`、`pnpm test:rust:lib` |
| 仅 `rovai-core` Main 或其专属模块 | `pnpm check:rust`、`pnpm test:rust:core` |
| Cargo/Rust 配置、`src/lib.rs`、多 target、删除/重命名、未知 Rust 路径或分类失败 | `pnpm test:rust:full` |

Main 专属模块由 staged `src/main.rs` 声明、但未由 staged `src/lib.rs` 导出的模块动态确定。
脚本使用 NUL 分隔读取路径以支持空格等合法文件名；Git 读取、模块解析或分类失败都会 fail closed
到全量测试，不会静默跳过。

### 完整 PR 验证

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p rovai-core --lib
cargo test -p rovai-core --features slow-tests --lib slow_tests::
```

`.github/workflows/rust.yml` 在 pull request 时，对 Rust 源码、Cargo 文件和 Rust 构建/lint
配置改动并行执行三个独立 job：

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p rovai-core --lib
cargo test -p rovai-core --features slow-tests --lib slow_tests::
```

默认 fast suite 保留 parser/serde、纯 policy、幂等冲突、权限、路径与 symlink、安全脱敏、取消和
route/epoch/session fencing、当前 schema 与受支持 migration smoke，以及每个高风险域的代表性原子
E2E。`slow-tests` 承担需要完整 SQLite/Camp/Runtime fixture 的扩展场景；每个测试仍使用独立数据库
clone，不共享可写状态。

`legacy-migration-tests` 会隐式启用 `slow-tests`，只在 `.github/workflows/rust-nightly.yml` 的定时或
手动全特性门禁中运行：

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

所有 feature-gated 测试因此都会在 nightly 中编译并执行；历史兼容覆盖只是移出 PR 关键路径，未被
永久禁用。CI 使用 Cargo 缓存缩短重复构建，但测试是否通过不依赖缓存命中。三个 PR job 并行启动，
各自恢复与其构建目标相容的既有 cache；不通过 job 间传递可写 `target` 目录制造顺序依赖。需要验证
桌面构建时另行运行：

```bash
pnpm build:desktop
```

### 非模型 Smoke

| 命令 | 主要范围 | 外部要求 |
| --- | --- | --- |
| `pnpm smoke:core` | 全新数据库、普通目录、空 Git 仓库、导航、重启和删除 | Git；不调用模型 |
| `pnpm smoke:member-config` | 十种产品目录、Installation、成员 Runtime 配置、Readiness 和重启 | 不调用模型；可用 `ROVAI_*_BIN` 覆盖发现；Settings Preview 不进入该矩阵 |
| `pnpm smoke:memory` | Memory Migration、治理、Revision、导出、投影恢复和权限 | 不调用模型 |

### 真实 Runtime Smoke

下表中的命令会调用本机 Runtime 和上游模型，可能产生费用、限流或授权弹窗。运行前确认
账户、模型和权限策略。

| 命令 | 默认或支持的 Runtime | 额外说明 |
| --- | --- | --- |
| `pnpm smoke:intake` | Codex | 创建 Git fixture；验证 Camp 消息、连续 Conversation、重启和删除 |
| `pnpm smoke:acp-runtime` | OpenCode + Copilot + TRAE | `ROVAI_ACP_SMOKE_ADAPTER` 可选其中一个；三者都执行固定 `printf` 并断言公开 command output 进入 `runtime.action.payload.output`；TRAE 使用 `traecli acp serve` 与动态 Session capability，并覆盖 completion、后继 Run 复用同一 warm Host/Session、allow-once 与 deny；冷 Host 续跑不得回退 `session/load` |
| `pnpm smoke:claude-runtime` | Claude Code | 验证原生权限、连续性和 Resume；强制 `Bash` 固定 `printf`，断言公开 output、原生 tool-use ID 与同 Session/Conversation 关联 |
| `pnpm smoke:antigravity-runtime` | Antigravity + Codex | 要求 `output.stream_json`，强制原生 `run_command` 固定 `printf` 并断言公开 output/step ID；另覆盖同 Session 续接、私有日志清理和 Antigravity 到 Codex 换绑 |
| `pnpm smoke:action-approval` | Codex | 验证越界动作的 Approval 与唯一副作用 |
| `pnpm smoke:multi-agent` | Codex | 同一 CampTurn 的两个真实并发 AgentRun |
| `pnpm smoke:builtin-cli` | 全部十种正式 Runtime | 每个真实 AgentRun 只使用固定业务命令，调用十五项 CLI operation；Gather case 额外验证成员公开回传被 capture、Lead 不逐条唤醒且只创建一次 completion。其余仍验证旧 send 输入拒绝、Projection/schema、冲突 recovery、release fence、Replay 与后续 AgentRun 新 lease；transport-independent indeterminate 由 CLI response-loss test 覆盖；任一选中 Runtime 缺失、未认证或漏项即失败 |
| `pnpm smoke:skills` | Codex 默认；selector 接受九种已证明 Skill projection 的 Runtime | `ROVAI_SKILL_SMOKE_ADAPTERS=all` 会逐一尝试既有九组真实投递与发现；TRAE 第一版没有静态 Skill 路径证据，明确不在该 selector 中 |
| `pnpm smoke:mcp` | Codex、Claude Code、OpenCode、Copilot；可选 CodeBuddy、Qwen Code | 默认前四种；保留 Runtime 原生配置并逐 Run 追加 MCP；OpenCode 默认使用 `opencode/mimo-v2.5-free` |
| `pnpm smoke:mcp-projection` | Codex、Claude Code、OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen Code、TRAE | 通过真实 Core、Assignment、AgentRun Projection 与 ContextManifest 验证原生配置保留及 Adapter-specific 同名策略；Codex 同名项应跳过，另外八种应由 Rovai 整项优先；默认九种 |
| `pnpm smoke:memory-runtime` | Codex + Claude Code | 可只选一种；Claude 有 bounded model/budget 配置 |
| `pnpm smoke:recovery` | OpenCode 默认 | 可选择其他产品 Runtime；创建 Git fixture 并杀死 Core 验证恢复 |
| `pnpm smoke:missing-send-recovery` | 全部十种 Runtime | 每种 Runtime 使用独立临时 data-dir/Git workspace，真实执行 zero-send 与 accepted-send suppression；七个 ACP 额外执行 tool→final 并生成独立协议 fixture；TRAE 使用同一严格 candidate/抑制规则 |
| `pnpm accept:planned-shutdown` | Claude Code + packaged App | 在隔离 Git workspace/`userData` 中等待真实 input accepted 后退出，验证 deadline、自然 child exit、无伪 terminal、进程 reap、重启 blocker 与关闭 modal 截图；运行前先执行 `pnpm package:mac` |
| `pnpm accept:onboarding-ui` | 本机首个可用正式 Runtime + packaged App | 不调用模型；用全新隔离 `userData` 验证三页断点、真实 provisioning、`初次集结`、Draft-only starter、重启与 `1040×700` 双主题截图 |

`pnpm smoke:runtime-permissions` 是 `smoke:action-approval` 与
`smoke:multi-agent` 的聚合命令。

v0.47 的 `smoke:builtin-cli` 不得通过 Agent-facing `tool list`/`tool describe` 发现合同；Core
catalog 只在 host-controlled Qualification/debug 路径使用。Projection 压缩比例只作为观测
指标记录，不是本命令或发布的硬门槛。

### Qualification 与本地结果投影

| 命令 | 用途 | 安全边界 |
| --- | --- | --- |
| `pnpm qualification:case` | 创建、密封或检查 Case | 正式私有 Pack 不进入仓库 |
| `pnpm qualification:run` | 执行单一隔离 Trial | 正式模式要求 packaged Release Core |
| `pnpm qualification:evaluate` | 对保留的同一 Snapshot 恢复评测，或在已有完整性失败证据后显式标记不可恢复 | 不得重新投递团队；`--mark-irrecoverable` 只接受已有失败 attempt 的固定 reason code |
| `pnpm qualification:suite` | 执行校准和确定性重复矩阵 | 校准失败时不得产生正式 Pass Rate；诊断模式必须引用失败校准 |
| `pnpm qualification:project` | 从完成的正式 Suite 或显式诊断 3×4 选取清单生成脱敏报告并投影到本地 Rovai Project | 写日常 Core 前要求 App/Core 已停止；使用 `execution=null`，不得制造 AgentRun |

`qualification:project` 对 `status=completed`、校准通过且 12 个正式 Trial 完整的 Qualification
Suite 直接使用 Suite 中的 3×4 身份；post-gate 诊断仍必须同时传入显式 selection 与失败的前置
校准摘要。脚本验证每个 round/case 只有一个有效结果，保留旧报告到 Project 的 `reports/`
目录，并可用 `--sync-default-team-runtimes` 把已验证的冻结四角色配置写回日常 Core。它不是自动
挑选最好结果或绕过校准的入口。

Team Case 可在密封 manifest 中声明 `collaboration` 合同。Runner 将它与功能 Verifier 分开审计：
指定成员必须真实获得 Run，Member Call 达到下限，持久输入与投递完成机械收敛，Task 完成和
轮询证据满足合同。路由是否必要、消息是否重复以及 Lead 是否正确整合属于 Judge 的语义评审，
不能由协议计数推断。没有该字段的旧 Case 仍只评估交付与编排，不应据此声称测到了 Team 协作。

## 常用选择器

| 环境变量 | 使用者 |
| --- | --- |
| `ROVAI_ACP_SMOKE_ADAPTER` | `smoke:acp-runtime` |
| `ROVAI_ACP_COMMAND_OUTPUT_ONLY=1` | `smoke:acp-runtime` 在固定 `printf` output 断言后停止；不替代默认完整 write/deny 回归 |
| `ROVAI_SKILL_SMOKE_ADAPTERS` | Skill Runtime 列表或 `all` |
| `ROVAI_SKILL_SMOKE_MODEL` | Skill Smoke 只选一种 Runtime 时要显式验证的模型 ID |
| `ROVAI_MCP_SMOKE_ADAPTERS` | MCP Runtime 列表 |
| `ROVAI_MCP_OPENCODE_MODEL` | MCP Smoke 的 OpenCode model；默认 `opencode/mimo-v2.5-free` |
| `ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS` | 同名 MCP Projection Runtime 列表或 `all` |
| `ROVAI_MCP_TRAE_MODEL` | TRAE MCP Projection Smoke 的可选显式动态模型 ID；省略时使用 Runtime 当前默认 |
| `ROVAI_CORE_EXECUTABLE` | 让 MCP Projection Smoke 使用指定 Core，例如 packaged App 内的 Release Core |
| `ROVAI_MCP_QODER_MODEL` / `ROVAI_MCP_CODEBUDDY_MODEL` / `ROVAI_MCP_QWEN_MODEL` | 同名 MCP Projection Smoke 的显式模型 |
| `ROVAI_MEMORY_RUNTIME_ADAPTERS` | Memory Runtime 列表 |
| `ROVAI_RECOVERY_ADAPTER` | Recovery Runtime |
| `ROVAI_MISSING_SEND_RECOVERY_ADAPTERS` | Missing-Send Recovery Runtime 列表或 `all`（默认） |
| `ROVAI_MISSING_SEND_RECOVERY_REPORT_DIR` | Missing-Send Recovery 的持久 report/protocol fixture 输出目录 |
| `ROVAI_MISSING_SEND_RECOVERY_MODEL_<ADAPTER_SLUG>` | 为单个 Missing-Send Runtime 选择真实显式模型；Adapter slug 转为大写并把 `-` 换成 `_`，例如 `ROVAI_MISSING_SEND_RECOVERY_MODEL_COPILOT_CLI=gpt-5.6-sol` |
| `ROVAI_PLANNED_SHUTDOWN_ACCEPT_FIXTURE_ROOT` | Planned Shutdown 验收的显式隔离 fixture root |
| `ROVAI_PLANNED_SHUTDOWN_ACCEPT_OUTPUT_DIR` | Planned Shutdown JSON report 与四张截图输出目录 |
| `ROVAI_KEEP_PLANNED_SHUTDOWN_FIXTURE=1` | 成功后保留 Planned Shutdown 隔离 fixture |
| `ROVAI_ONBOARDING_ACCEPT_FIXTURE_ROOT` | 首次训练验收的显式隔离 fixture root |
| `ROVAI_ONBOARDING_ACCEPT_OUTPUT_DIR` | 首次训练验收 JSON report 与截图输出目录 |
| `ROVAI_KEEP_SMOKE_FIXTURE=1` | 保留 intake fixture 供排查 |

脚本支持的精确值、默认值和额外模型变量以脚本源码为准。新增 selector 时应在同一改动
中更新本表。

## UI 验收命令

以下命令使用已打包 App 和隔离 `userData`，不调用模型：

```bash
pnpm package:mac
pnpm accept:memory-ui
pnpm accept:member-avatar-ui
pnpm accept:member-lifecycle-ui
pnpm accept:notification-ui
pnpm accept:sidebar-ui
pnpm accept:structured-mentions-ui
pnpm accept:task-card-ui
```

fixture、截图、窗口尺寸和直接调用 capture 脚本的方法见
[桌面 UI 验收](ui-acceptance.md)。

`accept:v0.16`、`accept:v0.17` 等带版本号的聚合命令属于历史版本验收入口，不是常青
日常门禁。其精确断言、Migration 版本和证据应从对应版本实施文档或测试源码读取。

## 隔离与副作用

- Smoke 应使用临时 Core `data-dir`、临时工作区和独立配置投影；不得读写日常
  Rovai-ai SQLite。
- Runtime Smoke 会继承当前进程可见的上游认证环境，但不应改写用户级 Runtime 配置。
- 任何声明会写文件的测试都必须把目标限制在临时 fixture；失败后先检查脚本是否保留
  了排查路径，再决定清理。
- 模型回复、耗时和费用不是稳定断言。测试应断言协议、状态、证据和限定 marker。
- 某个 Smoke 通过只证明该 suite 的范围，不代表十种 Runtime 的完整兼容性复核；未启用的 TRAE Skill 或 compaction 轴也不能从其他 suite 推断。
