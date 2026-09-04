---
document_type: development-guide
authority: test-policy-and-command-routing
last_updated: 2026-09-04
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

### CampOpen 业务读取边界

`read_model::camp_open_slow_tests` 拥有 Open 的完整 SQLite 读取边界：authorizer 拒绝任何直接或间接
`event_log` 读取后，带附件、Task、Run、Delivery、Approval 和活动 Evidence 的投影仍须成功。历史事件
`camp_id = NULL`、`task_id` 非空是保留的兼容输入。固定业务状态下分别加入 5 万、50 万、500 万无关事件，
验证投影不变、watermark 前进和 SQL VM 步数不变；5 次读取只用于报告耗时分布，不断言易波动的毫秒阈值。

这两个 owner 分别约束禁止越界读取与无关历史规模隔离；原有分页/完整 Snapshot 测试没有 SQL 授权边界，
不能证明嵌套 hydration 不访问事件表，纯函数测试也无法覆盖该事务 seam。共享 `OwnedTestDatabase` fixture
并在退出时清理，不访问日常数据库。Run 对象按 ID 比较完整字段，分别保留 Open 的活动优先顺序与
完整 Snapshot 的原有排序。最小命令：

```bash
cargo test -p rovai-core --features slow-tests --lib camp_open_slow_tests:: -- --nocapture
pnpm test:camp-open-projection
```

Electron 回归使用生产 adapter、CampWorkspace 与 CSS，验证空事件下的三类卡片、Task 业务原因、已加载
旧页与 DOM 阅读锚点，以及后台新消息不抢位置。排序/时钟回拨输入矩阵由既有 `App.test.ts` owner 负责。
夹具创建临时绝对 `userData`，不启动 Core/SQLite/Skill Library/Runtime；`ROVAI_KEEP_CAMP_OPEN_FIXTURE=1`
保留测量和双主题截图。手动 Full check 的 Linux job 使用 `xvfb-run -a pnpm test:camp-open-projection`。这些分别是数据库边界
和生产组件组合测试，不冒充已安装 App 的真实会话端到端耗时。

### 日常 commit 验证

```bash
pnpm typecheck
pnpm skills:test
pnpm skills:check
pnpm test
pnpm test:rust:staged
```

`pnpm test` 首先显式执行 `pnpm docs:test`、`pnpm docs:check`、`pnpm skills:test` 和
`pnpm skills:check`。`docs:test` 覆盖 Manifest 和历史正文篡改、迁移目标缺失/重复、
当前权威覆盖、数字 ADR 禁止、版本内 ID 与稳定锚点；`docs:check` 验证当前版本唯一性、
Version Decisions、Architecture 索引与全仓 Markdown 链接。Skill 检查覆盖通用 authoring fixture、
frontmatter、界面元数据和 bundle 内相对链接，不用自然语言逐字断言代替协作场景验收。文档治理改动至少单独运行：

```bash
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<目标分支 base SHA> pnpm docs:check:ci
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
| Cargo/Rust 配置、`src/lib.rs`、多 target、删除/重命名、未知 Rust 路径或分类失败 | `pnpm test:rust:workspace-default` |

Main 专属模块由 staged `src/main.rs` 声明、但未由 staged `src/lib.rs` 导出的模块动态确定。
脚本使用 NUL 分隔读取路径以支持空格等合法文件名；Git 读取、模块解析或分类失败都会 fail closed
到全量测试，不会静默跳过。

`test:rust:workspace-default` 的“workspace”仅指 default features。旧 `test:rust:full` 保留为同一
范围的兼容 alias，不能据此声称 slow integration、PR gate 或 all-features 已完成。显式范围为：

```bash
pnpm test:rust:workspace-default
pnpm test:rust:slow
pnpm test:rust:pr
```

### PR 快速门禁与手动完整验证

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
pnpm test:rust:pr
```

`.github/workflows/ci.yml` 在 pull request 时只启动一个 Ubuntu `gate` job。Rust 源码、Cargo 文件和
Rust 构建配置改动在自动门禁中执行：

```bash
cargo fmt --all --check
cargo check --workspace --all-targets
```

Clippy、all-features 测试、database smoke 与 Windows x64 原生编译/验证只在手动
`.github/workflows/full-check.yml` 中执行；Linux 深度命令为：

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
cargo test -p rovai-core --features slow-tests --lib slow_tests::
```

默认 fast suite 保留 parser/serde、纯 policy、幂等冲突、权限、路径与 symlink、安全脱敏、取消和
route/epoch/session fencing、当前 schema 与受支持 migration smoke，以及每个高风险域的代表性原子
E2E。`slow-tests` 承担需要完整 SQLite/Camp/Runtime fixture 的扩展场景；每个测试仍使用独立数据库
clone，不共享可写状态。

`legacy-migration-tests` 会隐式启用 `slow-tests`，只在手动 `Full check` 的全特性门禁中运行：

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

所有 feature-gated 测试因此都会在手动完整验证中编译并执行；历史兼容覆盖只是移出 PR 关键路径，未被
永久禁用。自动与手动 workflow 都使用 Cargo 缓存缩短重复构建，但测试是否通过不依赖缓存命中，也不在
job 间传递可写 `target` 目录制造顺序依赖。需要验证桌面构建时另行运行：

```bash
pnpm build:desktop
```

### Electron 隔离世界回归

所有从 `scripts/lib` 启动真实 Electron 的回归，都在 macOS 启动 Chromium 前运行最小
`sandbox-exec` 能力探针。探针可用时继续执行业务断言；只有命中已知的嵌套 macOS sandbox
`sandbox_apply: Operation not permitted` 才在本地标记为 `BLOCKED` / skipped，输出必须明示
业务断言未运行，不得将该结果声称为 Electron 验收通过。任意未知探针错误继续 fail closed，
不得通过 macOS `--no-sandbox` 绕过产品安全边界。Linux 不运行该 macOS 探针。

CI 和正式验收不允许嵌套 sandbox 被记为 skip；`CI=true` 或
`ROVAI_REQUIRE_ELECTRON_INTEGRATION=1` 会将同一环境阻断升级为明确失败。在 macOS 普通 Terminal
中执行强制验收示例：

```bash
ROVAI_REQUIRE_ELECTRON_INTEGRATION=1 pnpm test:desktop-bridge
```

能力分类由 `pnpm test:electron-sandbox-capability` 独立验证；手动 Full check 也显式启用
required 模式，防止未来迁移到 macOS runner 时把环境阻断当成通过。

执行台的头像轨道与协作投递收件人行运行 `pnpm test:execution-avatar-rail`。夹具挂载真实 CampWorkspace，
用原生指针和键盘验证队员轨道、来源归属、重复投递去重、0 / 1 / 2 / 16 / 48 人的完整单行与溢出名单，
以及名单滚动、焦点返回、Escape 层级、承载位置切换和双主题尺寸适配。它只使用临时 `userData` 与封闭
演示投影，不启动 Core、Skill Library 或模型，不访问日常数据；`ROVAI_KEEP_EXECUTION_AVATAR_FIXTURE=1`
保留截图与 fixture。Core 的投递来源 SQL → DTO seam 由 `read_model::tests::public_delivery_projection_preserves_causal_source_not_target_lineage`
独立验证，不用 UI 夹具代替数据库读取验证。

启动页面与 authority gate 的组合回归运行 `pnpm test:startup-presentation`。它在真实 Electron 中挂载生产 `App` 与 CSS，
仅替换本机 API 和反馈时钟：验证 null/starting、四类恢复目标、迁移、ready 交接、首次训练、订阅竞态与明确阻断；
同时检查 400ms 前无反馈、超时反馈只在内容区、未准入时没有权威请求、未知导航不显示空态。Main Window Session
延后冻结恢复目标与关闭窗口后的迟到读取由 `desktop-session.test.ts` 单独拥有。

夹具创建临时绝对 `userData`，不启动 Core/SQLite/Runtime，也不读取日常数据；它是生产组件组合测试，不冒充真实数据库
迁移端到端验收。默认删除本次夹具，`ROVAI_KEEP_STARTUP_PRESENTATION_FIXTURE=1` 可保留 Day/Night、最小窗口与
200%/reduced-motion 截图。手动 Full check 的 Linux job 通过 `xvfb-run -a pnpm test:startup-presentation` 执行。

文件预览分栏交互运行 `pnpm test:file-preview-layout`。它在真实 Electron 中挂载生产 `FilePreviewProvider`、
标题栏、分栏组件、文件 Tab 与 Viewer，以原生鼠标/键盘输入验证拖动提交、回弹、关闭与取消、焦点回退、
阅读位置和草稿保留、窗口缩放及重载后的比例。它还组合真实 Task、Files Changed、结构化 Composer 和
Approval/Recovery Dock，验证大屏中 481/480/450/420px 会话的容器断点、信息与按钮命中区域、DOM 保留，
并用受控查找工具组检查窄列排版。它还验证常驻预览按钮和空态、File Change/当前文件切换、不同 epoch 去重边界、
历史读取不访问当前文件、加载失败后重试、窄预览文件选择与阅读位置保留。原生窗口拖拽区验证覆盖顶栏与控件
的区域排除、预留空白及真实点击；系统标题栏双击的最大化/还原行为仍需平台验收。
查询行为仍由会话查找测试拥有。纯宽度输入矩阵仍由 `file-preview-layout.test.ts` 拥有；
静态 Markup/CSS 测试不能替代指针捕获、ResizeObserver 和浏览器布局组合。
夹具只使用临时绝对 `userData` 与受控文件 API，不启动 Core/SQLite/Skill Library/Runtime，不读取真实 Camp。
`ROVAI_KEEP_FILE_PREVIEW_FIXTURE=1` 保留双主题、宽/窄窗口、关闭提示和 200%/reduced-motion 截图；
默认清理本次夹具。手动 Full check 的 Linux job 使用 `xvfb-run -a pnpm test:file-preview-layout`。

消息文件引用运行 `pnpm test:file-reference-navigation`。它在同样隔离的真实 Electron 中挂载生产 Camp、Markdown 与预览，
验证有来源的短文件名定位、行范围高亮、字段误识别及 URL 中文尾部恢复；真实鼠标覆盖已有选区下的普通/inline-code
文件链接点击、链接内拖选不打开及其后的再次单击，键盘激活保持可用。并逐帧检查打开/关闭、键盘调宽和持续拖动时
阅读锚点偏移不超过 2px；还覆盖用户滚动后的可见消息回退、底部跟随、紧凑模式返回，以及旧
`authorization_required` 结果不会调用目录选择器或泄露内部授权原因。相同环境变量可保留双主题截图
和测量报告；手动 Full check 的 Linux job 使用 `xvfb-run -a pnpm test:file-reference-navigation`，不替代 Main 的来源、文件类型和系统动作测试。

涉及 Preload 请求 transport 或 Renderer 错误读取时，除普通 Vitest 外还运行：

```bash
pnpm test:desktop-bridge
```

该测试编译当前生产 Preload，并在真实 Electron `contextIsolation` 窗口中验证 Promise 成功值以及结构化拒绝的全部字段。
它使用临时 `userData`，不启动 Core 或调用模型；不能用 Main 单测或 jsdom 代替。无显示器 Linux 使用
`xvfb-run -a pnpm test:desktop-bridge`；手动 [Full check](../../.github/workflows/full-check.yml)通过统一的
`test:desktop:integration` script 覆盖该测试与其余真实 Electron 回归。

修改 Composer 的原生输入、IME、DOM 同步或光标恢复时，还运行：

```bash
pnpm test:composer-input
```

该测试把生产 Composer 装入独立 Electron Renderer，用真实 Chromium IME/input 事件与受控原生节点变动
验证可见正文、受控草稿值、焦点及页面存活。夹具隔离 `userData`，不启动 Core 或调用模型；不能用静态
Markup 测试替代。无显示器 Linux 使用 `xvfb-run -a pnpm test:composer-input`，同一手动完整验证工作流覆盖相关改动。

Composer 续发目标的发布时点与草稿保护运行 `pnpm test:composer-continuation`。夹具在隔离 Electron 中挂载生产
`CampWorkspace`，提供受控 Core 投影，验证入队不改址、正式发布即刷新而不等待 Run 结束，以及迟到读取、
已有正文/附件/显式接收者、冻结来源和切换 Camp 的保护。它不启动 Core 或真实 Runtime，不能代替 Core 路由
计算与队列调度验收；手动 Full check 的 Linux job 使用 `xvfb-run -a pnpm test:composer-continuation`。

### Core 可选功能启动回归

涉及 `run_core()` ready 边界、可选初始化或功能重试时，运行：

```bash
pnpm test:core-startup
```

该入口构建真实 Core，在独立 data-dir/Skill Library/MCP config/Runtime Files Root 中注入可选存储故障，验证
authority ready、业务 RPC 可达和同进程重试；另验证 mandatory recovery 失败为结构化拒绝而不是 crash 或 false ready。
不启动真实 Runtime 或调用模型。它拥有进程 seam，具体 cleanup/identity 规则仍由 Rust 单一 owner 测试；Rust fast CI
同时执行它。Windows bootstrap composition 由 `windows-bootstrap.test.ts` 拥有，native DACL/helper/identity 由
Windows x64 job 验证。改动还涉及完整桌面挂载和恢复时，在遵守[本地工作流](local-workflow.md)后运行隔离
`pnpm accept:bootstrap-shell-ui`，不能用 macOS 打包结果代替 Windows 原生验收。

### 非模型 Smoke

| 命令 | 主要范围 | 外部要求 |
| --- | --- | --- |
| `pnpm smoke:core` | 全新数据库、普通目录、空 Git 仓库、导航、重启和删除 | Git；不调用模型 |
| `pnpm smoke:member-config` | 十四种产品目录 identity、Installation、成员 Runtime 配置、Readiness 和重启 | 不调用模型；可用 `ROVAI_*_BIN` 覆盖发现；Cursor/Pi 验证 Catalog/Admission 阻断，不制造正式 Installation 或配置；macOS arm64/x64 Kimi 已准入，在 PATH 隔离 fixture 中按缺少 executable 返回 `runtime_configuration_unavailable`；Settings Preview 不进入该矩阵 |
| `pnpm smoke:memory` | Memory Migration、治理、Revision、导出、投影恢复和权限 | 不调用模型 |

### 真实 Runtime Smoke

下表中的命令会调用本机 Runtime 和上游模型，可能产生费用、限流或授权弹窗。运行前确认
账户、模型和权限策略。

| 命令 | 默认或支持的 Runtime | 额外说明 |
| --- | --- | --- |
| `pnpm smoke:intake` | Codex | 创建 Git fixture；验证 Camp 消息、连续 Conversation、重启和删除 |
| `pnpm smoke:acp-runtime` | 已完成接入的 ACP Runtime（含 TRAE、Kimi、Grok） | `ROVAI_ACP_SMOKE_ADAPTER` 可选择单一 Runtime；命令矩阵断言公开 command output 进入 `runtime.action.payload.output`。TRAE 覆盖 warm Host/Session 与 exact `session/load` HistoryRestore；Grok `>= 1.0.0` 覆盖 warm Host/Session 与标准 ACP `session/resume`；Kimi/Grok 的普通 ACP agent text（包括 provider `<think>`）原样进入执行台与 final。Grok 正式 Host 使用官方 `$GROK_HOME/config.toml` 和 mode-0600 `.env`；隔离 Probe/Smoke 使用同一官方布局 |
| `pnpm smoke:claude-runtime` | Claude Code | 验证原生权限、连续性和 Resume；两次无工具回复必须投影公开 narration；随后强制 `Bash` 固定 `printf`，断言公开 output、原生 tool-use ID 与同 Session/Conversation 关联 |
| `pnpm smoke:antigravity-runtime` | Antigravity + Codex | 要求 `output.stream_json`，强制原生 `run_command` 固定 `printf` 并断言公开 output/step ID；另覆盖同 Session 续接、私有日志清理和 Antigravity 到 Codex 换绑 |
| `pnpm smoke:pi-runtime` | Pi 0.84.4+ | 复制官方 Pi auth/settings/models 到临时 0700 `PI_CODING_AGENT_DIR`，隔离 Probe/Native Session/data/workspace；验证 exact cold resume、warm LRU、managed receipt、allow/deny、cancel 无副作用、Action output、locator 隐私与结构化 Usage。自动设置只在 debug Core 有效的 Pi qualification override；结果不是正式平台资格 |
| `pnpm smoke:action-approval` | Codex | 验证越界动作的 Approval 与唯一副作用 |
| `pnpm smoke:multi-agent` | Codex | 同一 CampTurn 的两个真实并发 AgentRun |
| `pnpm smoke:builtin-cli` | 默认十三种可执行实现；Cursor 未准入，Pi 仅 debug 验收 | 首个选中 Runtime 的先导 AgentRun 先通过真实 `rovai` lease 产生一条 Public A2A，并证明对应 Message Delivery 与 publication event；同一历史 Camp 另写真实文件附件。随后另一 Camp 的真实 AgentRun Manifest 冻结该历史 Camp，并以自己的 lease/context 执行 `history.search`、显式历史 `camp.search` 与 `camp.read item`，核对同一 A2A identity 及附件 `kind/fileCount`。每个真实 AgentRun 其余只使用固定业务命令，调用十五项 CLI operation；Gather case 额外验证成员公开回传被 capture、Lead 不逐条唤醒且只创建一次 completion。其余仍验证旧 send 输入拒绝、Projection/schema、冲突 recovery、release fence、Replay 与后续 AgentRun 新 lease；transport-independent indeterminate 由 CLI response-loss test 覆盖。选择 Pi 时复制官方配置到临时 Home，不污染用户 Session；通过不晋升平台资格 |
| `pnpm smoke:skills` | Codex 默认；`all` 为十三种可执行实现 | `ROVAI_SKILL_SMOKE_ADAPTERS=all` 逐一尝试十三组真实投递、发现与消息局部注意力；Cursor `.cursor/skills` 为 DocumentationOnly。Kimi `.kimi-code/skills`、Grok `.grok/skills` 与 Pi `.pi/skills` 进入矩阵；选择 Pi 时使用临时官方配置副本与 debug-only admission，结果不等于正式资格；`--to-user` 仅为隐藏兼容 alias |
| `pnpm smoke:mcp` | Codex、Claude Code、OpenCode、Copilot；可选 CodeBuddy、Qwen Code | 默认前四种；保留 Runtime 原生配置并逐 Run 追加 MCP；OpenCode 默认使用 `opencode/mimo-v2.5-free` |
| `pnpm smoke:mcp-projection` | Codex、Claude Code、OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen Code、TRAE、Kimi、Grok | 通过真实 Core、Assignment、AgentRun Projection 与 ContextManifest 验证原生配置保留及 Adapter-specific 同名策略。Grok 使用私有进程 Plugin 并 `NativeWinsSkip`；Kimi 覆盖 stdio、Streamable HTTP 和第二个 stdio Server；默认十一种。Pi 的 External MCP 为 `Unsupported`，不属于本 smoke，保存的 Assignment 在 Pi dispatch 时静默忽略 |
| `pnpm smoke:memory-runtime` | Codex + Claude Code | 可只选一种；Claude 有 bounded model/budget 配置 |
| `pnpm smoke:recovery` | OpenCode 默认 | 可选择其他产品 Runtime；创建 Git fixture 并杀死 Core 验证恢复 |
| `pnpm smoke:missing-send-recovery` | 十三种可执行实现（含 Pi、Kimi、Grok）；Cursor Disabled | 每种 Runtime 使用独立临时 data-dir/Git workspace，真实执行 zero-send 与 accepted-send suppression；ACP 额外执行 tool→final 并生成独立协议 fixture，Pi 额外执行原生 Read Tool→final 并验证 `agent_settled` 专属终点与 Tool Activity。Pi 官方配置与 Session root 同样逐 Runtime 临时复制；debug pass 不晋升正式资格 |
| `pnpm accept:planned-shutdown` | 当前平台正式 Runtime + packaged App | 在隔离 Git workspace/`userData` 中等待真实 input handoff 后退出，验证 5 秒目标、10 秒硬 deadline、400ms 关闭反馈门槛、无伪 terminal、进程 reap、重启 blocker、Run 取消审计与安全退出 modal 截图；运行前在 macOS 执行 `pnpm package:mac`，在 Windows x64 执行 `pnpm package:windows:x64` |
| `pnpm accept:onboarding-ui` | 本机首个可用正式 Runtime + packaged App | 不调用模型；用全新隔离 `userData` 验证三页断点、真实 provisioning、`初次集结`、Draft-only starter、重启与 `1040×700` 双主题截图 |
| `pnpm accept:bootstrap-shell-ui` | 无 Runtime；packaged App + 独立未知 authority / 崩溃恢复 fixture | 不调用模型；证明未知 authority 保留、业务树不挂载、显式重试不消耗 crash budget；另在真实 Core 写事务产生 WAL 后强杀该隔离子进程，验证结构化失败字段、自动恢复已提交数据和工作区重挂载；覆盖双主题、窄窗口、200% 等效布局与 reduced motion 截图 |

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
| `ROVAI_PI_BIN` | Pi 0.84.4+ executable；Pi 专用与通用 Runtime smoke 都只在 debug Core 对该 Adapter启用本机 qualification override |
| `ROVAI_PI_CONFIG_SOURCE` | Pi smoke 只读复制的官方配置根，默认 `~/.pi/agent`；副本与测试 Session 位于 fixture root，结束时删除 |
| `ROVAI_BUILTIN_CLI_ADAPTERS` | Built-in CLI Runtime 列表；选择 Pi 时自动隔离官方配置副本 |
| `ROVAI_WINDOWS_RUNTIME_QUALIFICATION_ADAPTER` | 仅 Windows debug Core 的逐 Runtime 资格采集；值为一个精确 `AdapterKind`，或仅在跨 Runtime 交接 Smoke / 本机资格 App 中使用逗号分隔的精确 `AdapterKind` 列表。它只允许列出的 Adapter 进入真实检查和执行，并把当前 Windows debug Catalog 中对应行投影为带 `local-debug` evidence 的 `qualified`，使训练营可以继续安装与认证检查；release 构建忽略该变量且仍使用正式平台准入矩阵 |
| `ROVAI_SKILL_SMOKE_ADAPTERS` | Skill Runtime 列表或 `all` |
| `ROVAI_SKILL_SMOKE_MODEL` | Skill Smoke 只选一种 Runtime 时要显式验证的模型 ID |
| `ROVAI_MCP_SMOKE_ADAPTERS` | MCP Runtime 列表 |
| `ROVAI_MCP_OPENCODE_MODEL` | MCP Smoke 的 OpenCode model；默认 `opencode/mimo-v2.5-free` |
| `ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS` | 同名 MCP Projection Runtime 列表或 `all` |
| `ROVAI_MCP_TRAE_MODEL` | TRAE MCP Projection Smoke 的可选显式动态模型 ID；省略时使用 Runtime 当前默认 |
| `ROVAI_CORE_EXECUTABLE` | 让 MCP Projection Smoke 使用指定 Core，例如 packaged App 内的 Release Core |
| `ROVAI_MCP_QODER_MODEL` / `ROVAI_MCP_CODEBUDDY_MODEL` / `ROVAI_MCP_QWEN_MODEL` | 同名 MCP Projection Smoke 的显式模型 |
| `ROVAI_CODEBUDDY_MODEL` | CodeBuddy ACP 资格探测启动时使用的显式模型；自定义模型需使用 CLI 报告的完整 ID（例如 `custom-local:deepseek-v4-flash`） |
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

`pnpm test:approval-dock` 使用生产 ApprovalDock/CSS 的独立 Electron fixture，验证原生顺序、标签与
决定身份，翻页边界与摘要焦点、普通刷新不抢焦点、Reason 精确去重/按审批隔离及无重渲染的容器宽度变化，
并覆盖双主题、最小窗口与 420px 会话列。临时 `userData` 与日常 App 隔离，不启动 Core 或 Runtime；
`ROVAI_KEEP_APPROVAL_FIXTURE=1` 保留截图，默认清理。手动 Full check 的 Linux job 使用 `xvfb-run -a`。

`pnpm test:camp-fast-layout` 使用生产 CampWorkspace/CSS 的独立 Electron fixture，无需打包或 Core。
关闭的模拟 API 只提供成员偏好与 Draft；临时 userData 与日常 App 完全分离，不调用模型。
它拥有 Fast 的 1280×720/窄屏/大屏布局、日夜主题、键盘焦点、失败保留、直接静默切换、旧观测不影响偏好与初始默认。
同一 owner 还验证打开队员浮层后的静默自动检测、正负结果复用、失败重开重试、同成员请求去重、切换绑定自动重测与旧响应隔离；
其他 Runtime 不检测，非官方认证的拒绝结果不显示入口，菜单不再暴露手动检测。
`ROVAI_KEEP_FAST_FIXTURE=1` 保留本次临时截图供排错；成功默认自动清理。手动 Full check 的 Linux job 通过 `xvfb-run -a` 执行。

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
- 选择 Pi 的 smoke 必须把官方 auth/settings/models 以 0600 复制到测试专用 0700 `PI_CODING_AGENT_DIR`，并让
  Probe 使用自己的 `--session-dir`；禁止把测试 prompt、Session 或 MCP/Skill exposure 写入用户 Pi Session 历史。
- 任何声明会写文件的测试都必须把目标限制在临时 fixture；失败后先检查脚本是否保留
  了排查路径，再决定清理。
- 模型回复、耗时和费用不是稳定断言。测试应断言协议、状态、证据和限定 marker。
- 某个 Smoke 通过只证明该 suite 的范围，不代表全部 Product Runtime 的完整兼容性复核；TRAE managed Skill
  projection Verified 不会升级用户级 Skill 调用或 Compaction detector，后者继续按独立证据保持
  `Unverified` / `NotObserved`。
