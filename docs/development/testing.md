---
document_type: development-guide
authority: test-policy-and-command-routing
last_updated: 2026-10-26
---

# 测试与 Smoke Test

[`package.json#scripts`](../../package.json)是 JavaScript 命令名和组合的真源。Rust 测试
目标由 Cargo workspace 和测试代码决定。

## 用户 Steer 的 Runtime 验收

普通队列与运行中插话共用 `scripts/smoke-steer.mjs`。真实模型调用先满足
[本地工作流隔离规则](local-workflow.md)，并取得当前任务的真实 LLM 授权。Core 与配套 `rovai`
二进制必须放在同一目录，fixture 必须是新建空绝对路径；脚本打印独立 data、Skills、MCP、cache
和 workspace，并将目标 Runtime 的原生配置复制到 fixture 的私有目录。凭据不进入 JSON 报告。

```sh
node scripts/smoke-steer.mjs /absolute/empty-fixture /absolute/bin/rovai-core qwen-code
```

第三参数为 `codex-cli`（默认）、`claude-code-cli`、`pi`、`codebuddy-cli`、`qwen-code`、`grok-build`、`kiro-cli` 、`zcode-app`、`trae-cn-cli` 或 `minimax-code-cli`。
可选第四参数 `steer-only` 仅验同轮文字与纯附件，`mixed-only` 仅验多队员混合投递，`cancel-only`
仅验取消后的副作用与后继 Run；默认顺序验证同轮输入、普通后继和多队员混合。混合场景额外调用
OpenCode 作为忙碌且不支持 Steer 的接收者。Claude 使用本机显式配置的 API，报告记录其 endpoint
和模型供核对。单项通过不能覆盖其余场景的超时，失败报告也必须保留。

可选第五参数为目标原生程序绝对路径，保存独立的 Runtime startup 配置并核对安装入口，防止旧版
验收自动回退到本机新版。混合场景的 OpenCode 只复制配置、认证和模型选择，XDG 配置、数据、状态、
缓存均指向 fixture，不复制日常 Session／数据库；取消继承的 `OPENCODE_DB`。

CodeBuddy 新旧 ACP 插话归属由既有 `active_input_receipts_preserve_the_original_prompt_and_fence_late_sources`
owner 覆盖：专用 owner 回执、方法不存在后旧路径、拒绝、迟到与错误 owner。生命周期通知矩阵扩展
`codebuddy_private_command_notification_is_narrow_idle_metadata`；版本范围扩展既有 frozen Run 准入
owner。不增加独立 Rust 测试，真实新版与最低版另以 `probe-steer-version.mjs` 验证。

历史版本使用 `scripts/probe-steer-version.mjs`，第四参数必须是已下载的官方历史包绝对入口：

```sh
node scripts/probe-steer-version.mjs /absolute/new-fixture /absolute/bin/rovai-core pi /absolute/historical/pi positive
```

第五参数 `positive` 验证三个独立 Thread 的同轮连续输入及逐消息 `RUN_INPUT` 引用；
`receipts` 在同样场景额外保留工具释放前最多 15 秒的回执观察，分别记录原生接收与最终结果；
没有及时回执不自动算作最终失败，也不把工具仍运行解释为未收到输入。
`boundaries` 验证待接收输入／首条回执后停止、普通续接、工具释放附近插话和失效目标；
`preflight` 仅运行当前生产准入；`ineligible` 验证普通执行可用、Steer 在原生写入前被 Core 排队，
随后普通后继成功且没有 Steer 输入行。每次使用不同的新目录。`ROVAI_STEER_PROBE_FILTER`
可按 case 名称子串只复查某个异常，必须保留原失败记录，不能把筛选后的通过当成全套通过。
脚本保存明确的 Runtime 启动路径并核对真实入口，避免自动发现回退到本机新版；不删除生产必传参数，
不绕过普通 Runtime 或 Steer 门槛。特殊原生配置可通过对应 Runtime 的 Home 环境变量指向隔离副本，
报告中必须注明差异。原生小文本探针与本脚本的生产 Builder／Adapter 验收分别记账。

`node --test scripts/lib/steer-race-outcome.test.mjs scripts/lib/steer-ui.test.mjs` 分别验证三种合法竞态结果及反例、生产 UI 的逐目标路线／原因和接收文案。

`report.json` 和 fixture 原生日志属于私有诊断，可能含本机路径、服务地址、上下文和原生错误；
不得直接作为公开附件。只导出版本、摘要、回执关联、case 结果与必要的脱敏错误，并清理本次复制的凭据。
有限次数通过只覆盖已执行的场景，不证明所有结束竞态或所有历史版本；边界未覆盖时使用“最早已测通过”，
不用“最低兼容”。合并后产品证据见[Steer 收口报告](../research/runtime-monitoring/steer-hardening-2026-10-15.md)，
此前低版本边界见[低版本验证报告](../research/runtime-monitoring/steer-low-versions-2026-10-15.md)。

### Hermes 原生 Steer 边界探针

Hermes 0.22.4 的 slash Steer 已接入生产 Core。下面保留的早期原生探针不经过 Core、CLI 或 UI，
不能替代生产链路验收：

```sh
node scripts/probe-hermes-steer.mjs /absolute/official-v0.22.4-source /absolute/prepared-python
node scripts/probe-hermes-steer.mjs /absolute/official-v0.22.4-source /absolute/prepared-python --real-model
```

源码 checkout 须位于官方 tag `v0.22.4`，含原生 `install-stamp.json`；Python 须已具备该安装依赖。
脚本在新建临时目录克隆未修改源码，并建立隔离测试用户 Home、项目和原生 `.hermes`。
每个夹具仅有一个共享 Gateway；退出只停止夹具创建的 ACP 与 Gateway，不访问日常 Session。
默认通过 loopback Provider 验证正常插话、冷恢复、延迟终态、ACP 关闭后的后继执行及图片排队。
`--real-model` 需要当前任务的真实模型调用授权，只从本机现有配置读取 Responses Provider，
通过内存 relay 使用凭据；不向夹具文件写真实凭据，不修改日常配置。它验证两个原生任务的实际文件结果，
不重跑受控竞态。原始 `result.json` 与日志保留在私有夹具，只公开白名单脱敏摘要。
当前结果与缺口见[Hermes 实测](../research/hermes-runtime/README.md#0224-原生-acp-steer-实测2026-10-28)。

生产链路使用同样的未补丁官方源码与独立测试用户 Home，先构建本分支 Core 和 CLI：

```bash
cargo build -p rovai-core --bin rovai-core --bin rovai
node scripts/smoke-hermes-steer.mjs /absolute/official-v0.22.4-source /absolute/prepared-python
node scripts/smoke-hermes-steer.mjs /absolute/official-v0.22.4-source /absolute/prepared-python --real-model
```

默认受控 Provider 验证连续输入与文件引用、原 Session 冷恢复、延迟原终态后的原生后继与 CLI 归属、
普通队列、取消、丢失回执不重发和明确拒绝回队列。传输延迟/丢帧/拒绝只在验收代理中发生，不修改
上游或生产协议。真实模型模式只转发 Provider 字节，凭据只在 relay 内存；运行前须有模型使用授权。
最终证据与失败尝试保留在[Core Steer 验证](../research/hermes-runtime/README.md#core-steer-接通2026-10-28)。
扩展既有 `active_input_receipts_preserve_the_original_prompt_and_fence_late_sources`，拥有多请求终态合并、
两种返回顺序、已接受执行失败、拒绝、取消与未知；扩展 `active_inputs_preserve_initial_context_and_unsubmitted_sources`
验证 Hermes 无配置摘要时仍复核 Run/epoch/终态。新增 Rust 测试函数为零。
最小命令：`cargo test -p rovai-core --features extended-tests --lib active_input`。

## MiniMax Code 控制服务验收

先构建配套 Core/CLI，再用实际安装入口运行：

```sh
cargo build -p rovai-core --bins
node scripts/smoke-minimax-runtime.mjs /absolute/path/to/mcode
node scripts/smoke-minimax-runtime.mjs /absolute/path/to/mcode --files-only
node scripts/smoke-minimax-runtime.mjs /absolute/path/to/mcode --completion-only --fixture-root /absolute/empty-fixture
node scripts/smoke-minimax-runtime.mjs /absolute/path/to/mcode --questionnaires-only --fixture-root /absolute/empty-fixture
```

脚本在新建隔离目录启动真实 mcode、生产 Core、确定性 loopback Provider 与 MCP fixture。
合成 API key 仅用于本地服务，不使用日常账户。覆盖普通 Host 复用、Core 重启同 Session、精确
缺失 Session 替换、系统层 Bootstrap、图片 Steer 到模型请求、MCP 调用/移除、allow/deny、
六类命令输出、零发送恢复和取消子进程。脚本模型不能替代真实账户、视觉理解或完整 First-Class
Golden Flows；短 Run 的异步 journal Usage 可能为空。结果留在打印的临时目录，原始 report
是私有诊断，只导出白名单摘要；本次数据目录及派生 Runtime Files Root 都不属于日常实例。
真实模型流程另用 `smoke-acp-runtime.mjs` / `smoke-steer.mjs` 的 `minimax-code-cli` 入口。
当前证据见[MiniMax 接入报告](../research/minimax-code-runtime/README.md)。

`--completion-only` 通过真实 mcode 和确定性本地 Provider 验证发送后空 final、后继 Host 复用、
未发送且空 final、发送后原生错误的不同结算。它不调用真实 LLM，不证明问卷已从模型工具清单移除。
终态修改扩展既有 `accepted_send_suppresses_missing_send_recovery_for_recipient_matrix`（slow-tests）、
ACP suffix、审批 option、失败重试和 native cursor owners；Usage 生命周期扩展原有 flush partition owner。

`--questionnaires-only` 保持原生问卷工具启用，验证单选、多选、发送后问卷、default 权限模式、
取消后新指令、Core 重启精确恢复，以及后继普通命令 allow/deny。断言原生问卷为 dismissed、
答案与注入字段为空、`runtime_questionnaire_unsupported` 及可操作公开提示、失败 Run 不可自动重放；
已经发送的消息保留。Host 观察使用 Core 直属子进程
PID 集合，不能替代跨 Session 或并发 Fleet 资格。该矩阵不假造问卷 permission 请求；
`questionnaire:` option 的防代答反例由既有 extended owner
`approval_selects_the_exact_native_option_id` 负责。三种 focused 参数互斥。

`--files-only` 验证原生 Read/Write/Edit、绝对/相对及中文空格路径、新建/覆盖/空文件、成功/失败编辑、
原生 patch 与持久化 Files Changed，并重启 Core 核对卡片。它不启动 Renderer，不能代替点击展开验收。
真实 CLI 的首轮调查发现显示预览被误记 full_before_after；修复使用原生 details.patch 和 created。
文件校正扩展既有 `paired_tools_accept_permission_only_denial_without_crossing_session_or_prompt`、
`opencode_write_uses_terminal_metadata_exists_only_with_a_corroborated_path`、
`pi_edit_patch_is_path_bound_normalized_and_counted_inside_hunks`、
`acp_tool_events_expose_only_the_public_command_and_payload_digests` owners；不新增 Rust 测试函数。

Rust 不增加平行 owner：模型与 per-model effort 扩展 `grouped_acp_models_keep_opaque_provider_routes_and_reject_empty_catalogs`；
审批 ID 配对扩展 `paired_tools_accept_permission_only_denial_without_crossing_session_or_prompt`；
私有输出字段反例扩展 `acp_command_output_uses_standard_content_and_allowlisted_raw_fallbacks`；
精确 Session 错误/Steer 归属复用既有 RPC/active-input owners；Usage baseline/重放/身份不符
扩展 `native_usage` 既有 cursor owners；schema 155 扩展 catalog migration 回滚和历史源收敛 owners。
修复前真实 0.6.12 审批终态无法关联、输出正文被丢弃；新输入矩阵保留跨 Session/Prompt 和私有字段负例。

```sh
cargo test -p rovai-core --lib --features extended-tests paired_tools_accept_permission_only_denial_without_crossing_session_or_prompt
cargo test -p rovai-core --lib --features extended-tests acp_command_output_uses_standard_content_and_allowlisted_raw_fallbacks
cargo test -p rovai-core --lib --features extended-tests native_
cargo test -p rovai-core --lib --features extended-tests runtime_catalog_migrations_preserve_rows_and_roll_back_with_their_receipts
```

## Rust 测试准入与退役门槛

Hermes 入口/逻辑 Session、Ready、接受账本、compaction 禁用、lease、CLI 单次派发与 ManagedProcess
根进程清理均扩展原 owner；迁移/历史读取仍保留。原私有 Home controller、维护 CLI 与其专属测试
随生产路径删除，不保留失效的 smoke 入口。完整退役与 successor 见 [测试归属](../research/hermes-runtime/README.md#rust-测试归属)。
当前原生验证入口 `node scripts/smoke-hermes-native-session.mjs <official-source> <prepared-python>`
使用未补丁官方源码、共享测试用户 Home、预先启动 Gateway、隔离 Core/data/Skills/MCP 与受控 Provider。
最低 Rust 命令 `cargo test --workspace` 与 `cargo test -p rovai-core --features slow-tests,extended-tests --lib hermes`。
实际结果见 [实施记录](../versions/v1.72/hermes-first-input-implementation.md)，不等同真实付费模型或跨平台验收。

Hermes 全平台普通开放扩展既有 Admission 矩阵、诊断和 Renderer owners；不新增 Rust 测试函数。
Windows 的 `managed_process::tests::windows_job_contains_an_immediate_grandchild_after_leader_exit`
同时覆盖连接根进程的归属、强制终止和 Drop 后共享服务仍存活；其原有整树 Job 断言保留。
最小命令为 `cargo test -p rovai-core --features extended-tests --lib runtime_platform_admission::`
及 `cargo test -p rovai-core --features extended-tests --lib managed_process::`，默认 workspace 仍须通过。

Web 长粘贴扩展既有 Host HTTP 与浏览器适配/恢复 owners；schema 161→162 的 DDL 失败回滚
无法由 HTTP 测试证明，新增一个复用 schema-only fixture 的迁移 owner。准入与最小命令见
[Web 长粘贴实施记录](../versions/v1.72/web-pasted-text-implementation.md#验证归属)。

通用环境配置扩展既有环境合并、启动设置事务、检测环境和 Renderer owner；仅 schema 160→161 的
新增表事务增加独立 owner，覆盖无 key 升级、失败回滚和旧凭据保留。准入理由、fixture 边界及最小命令见
[通用配置实施记录](../versions/v1.72/shared-environment-implementation.md#验证归属)。

退出提醒沿用通知事务/Thread 确认及批量查询规模 owner；本次在原 owner 内覆盖 schema 160、
手动停止退出候选及按 Thread 展示确认，删除随短亮接口退役的描述断言，不增加 Rust 测试函数。
修复前失败输入、fixture 成本及最小命令见[中断注意力验收](../versions/v1.72/interruption-attention-validation.md#验证边界与-owner)。
已存在的单聊终态、retention 和 Portal owner 原地扩展，不新增等价覆盖。

Send 文件输入改动先运行 `cargo test -p rovai-core --bin rovai send_file_`，再运行
`pnpm test:send-input-file`。后者构建当前 CLI，以隔离临时目录和本地 IPC 夹具验证请求传递、
业务拒绝不降级、输入失败零 IPC、继承 stdin 不阻塞和 Unix FIFO/设备/权限拒绝；不启动 Core 或模型。
Core 的正文、寻址与发布合同继续由 `team_tool::tests` 拥有，真实 Session 行为单独验收。
该进程测试接入手动 `Full check` 的 `full` scope，由 `Rust full` job 准备 Node/pnpm 后显式执行一次。
`pnpm test`、`cargo test --workspace` 和自动 PR `CI / gate` 不包含它；这些入口通过不能替代该项结果。

测试总数不是质量指标，本仓库不设置“每个功能必须新增几项测试”或“每个 PR 最多新增几项测试”的
固定配额。评审门槛是每项测试是否拥有清晰、唯一且值得长期维护的合同；相同覆盖应优先扩展既有
owner，而不是继续增加平行 fixture 和断言。

### 单项 Runtime 检查减重

`runtime_check_environment::tests::minimax_check_and_catalog_keep_their_intent_and_complete_options`
拥有 MiniMax 的新健康／完整目录分离边界：普通检查不随模型数切换、pending/active 同意图合并、首次
目录回退、完整目录时间保留与失效后部分结果不参与参数过滤。原 Codex 失败夹具没有模型参数和目录成功
写入，不能覆盖此回归，因此复用它的私有 Core/DB/Check Manager fixture 增加一个有真实协议进程的 owner；
单纯测合并谓词无法证明第一次目录回退或持久化成功时间。表中 2／8 个模型分别执行检查先到／目录先到，
不同重复请求用于证明合并与完整目录幂等，不是性能统计。最小命令：
`cargo test -p rovai-core --features slow-tests --lib minimax_check_and_catalog`。

其余扩展既有 health、Pi Host、ZCode transport、Adapter 和 Renderer 参数 owner。Grok 旧的“恢复必须执行
成功”要求随普通检查的恢复演练一同退役，原协议进程测试改验 Grok/Kiro 当前模型与零重复设置；正式恢复
错误归属、准确 Session ID、权限及模型设置的原 Host/transport 用例继续保留。Pi probe 的四次演练 RPC
断言改为只验证初始 Session；ZCode 同一个内存协议夹具同时验证 probe 省略、正式 new/resume 保留两步。
静态证据复用扩展原 Codex、Claude、Antigravity 进程 fixture，仍验证动态认证失败和模型失败，不能用缓存
伪造成功。真实安装、账号和点击耗时另记在当前版本实施记录，不混入确定性测试。

末尾文件复核继续扩展 `installed_catalog_discovery_runs_only_bounded_identity_commands` 的既有哈希计数：
首次／升级的发现加末尾复核共一次，未变的重复发现加末尾复核零次，检查期间替换则拒收旧结果。
Codex 原认证 fixture 同时拥有普通 Schema 有／无 Fast 字段时的进程计数：可信版本与普通静态证据有效时
仅一个 app-server，Fast 专用 experimental 导出为零；普通导出顺带取得或同程序已有的正向证据保留。
安装变化、超时归属、进程清理与 Fast 保存／实际参数映射继续运行原 owner，不另建计数或性能测试框架。

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

### Rust 执行层级与默认预算

Rust owner 分成四个可执行层级；feature gating 只改变日常路由，不表示合同或测试被删除：

| 层级 | 命令 | 职责 |
| --- | --- | --- |
| 默认快速层 | `pnpm test:rust:pr` | PR/日常反馈；当前 macOS workspace 基线为 400 项 |
| 扩展层 | `pnpm test:rust:extended` | 大型模块矩阵、SQLite fixture、子进程与并发 owner |
| 慢速层 | `pnpm test:rust:slow` | 显式 `slow_tests` owner；`slow-tests` 会同时启用 `extended-tests` |
| 完整层 | `pnpm test:rust:full` | `--all-features`，包含扩展、慢速和历史 Migration owner |

400 是默认快速层的反馈预算，不是全仓测试总数或质量配额。新增纯 parser/serde、确定性 policy、常量和
最小原子 regression 可以进入默认层；需要完整数据库、进程、重启、广泛 Runtime 矩阵或并发时序的 owner
进入 `extended-tests`。历史 Migration 继续由 `legacy-migration-tests` 拥有。

修改 feature-gated owner 时，定向命令必须显式加 `--features extended-tests`；若 owner 同时标为
`slow-tests`，则使用 `--features slow-tests`。过滤命令显示 `0 tests` 不构成验证证据，提交前先用
`-- --list` 确认目标 owner 实际进入清单。

## Command Code headless 测试退役（2026-10-09，User 105）

User 已停止 headless 候选；删除唯一消费者 `command_code.rs`、其专属 `command_code_activity.rs`、
`local_headless_probe.py`、`headless_resume_probe.py`，并移除跨 Runtime 模型探针中的 print 正向对照。
ACP 的 `command_code_acp.rs`、System Mod、Cline、共享 ACP、文件证据、Usage 与 ManagedProcess 仍保留。
删除的 Rust owner 共五个（三个默认单元、一个扩展进程、一个人工 ignored Smoke）：

- `command_code::tests::usage_counts_root_calls_once_and_keeps_context_separate`
- `command_code::tests::headless_decoder_fences_session_and_terminal_outcome`
- `command_code::tests::isolated_command_code_reports_live_calls_and_exact_resume_usage`
- `command_code::tests::managed_headless_process_delivers_stdin_and_exact_resume`
- `command_code_activity::tests::command_code_activity_separates_public_text_tool_outcomes_and_private_state`

这些 owner 的私有 NDJSON/print 合同随唯一执行入口退出，没有迁移给 ACP，也不保留永久停用代码。
当前后端继续由 `acp::tests`、`command_code_acp::tests`、`cline::tests` 及
`scripts/lib/command-code-bootstrap.test.mjs` / `scripts/lib/cline-observer.test.mjs` 负责。
平台与 Renderer 既有 owner 补充不公开两个产品的断言；历史身份和用量标签保留，未新增独立 Rust 测试。
最低验证：`cargo test --workspace`、`cargo test -p rovai-core --features extended-tests --lib acp::tests::`、
`cargo test -p rovai-core --features extended-tests --lib command_code_acp::tests::`、
`cargo test -p rovai-core --features extended-tests --lib cline::tests::`，以及相关 Renderer/Node 测试、typecheck 与文档门禁。
以下 2026-10-04 的 headless owner/命令是退役前历史，不能作为当前测试入口。

## 队员运行环境 owner（2026-10-11）

2026-10-12 方案 A 改写既有 `member_environment::tests`：会话快照固定、缺快照拒绝和重置才生效
随生产机制退出，原 `private_versions_preserve_credentials_and_freeze_retries_across_reopen` 改为
`private_versions_preserve_credentials_and_new_launches_read_current_configuration`；原并行进程 owner
改为 `parallel_child_processes_inherit_their_cli_environment_without_changing_parent`。
保留私有版本 CAS、事务回滚、加密、遮蔽、短凭据脱敏、重开与并行隔离矩阵，增加派生工具继承父 CLI
环境和删除覆盖恢复 Host 的断言。旧 Agents 归档 owner 保留，191/192 的 receipt 回滚保留并扩展至 193。

新增三个 `extended-tests` regression owner，分别拥有不能由纯函数覆盖的事务/进程边界：

- `codex::tests::warm_host_ignores_unreadable_environment_and_new_process_loads_latest`：真实合成 CLI
  经 Fleet 的创建任务读取配置；Warm A 不读取已损坏的新配置，新建失败不阻断其他 Camp，创建前保存的新值被读取。
  既有 Host 兼容测试不读取私有数据库，不能证明解密依赖是否仍在 Warm 路径。
- `delivery_queue::tests::malformed_member_configuration_fails_its_lane_without_blocking_other_camps`：
  坏队员配置失败结算、其他 Camp 同批领取、已有原生 Session 无快照继续。既有 SQL 故障 owner
  `history_query_failure_rolls_back_every_claim_in_the_transaction` 继续要求整体回滚，防止吞掉数据库错误。
- `db::member_environment::tests::retirement_needs_no_old_ciphertext_or_key_and_preserves_member_configuration`：
  schema 142 损坏快照及缺 key 仍能退役；私有队员配置和业务数据保留，密钥恢复后原配置可读。

最小命令先 `cargo test -p rovai-core --features extended-tests --lib -- --list` 确认 owner，再以对应
模块或完整函数名过滤运行。`runtime_startup::tests` 继续负责变量输入规则；`runtime_fleet::tests`
继续负责同 Camp/成员/当前会话隔离和工作目录兼容；`codex::tests` 的未知输入/原生恢复 owner 不变。
原生绑定重置复验 slow owner `manual_native_session_restart_keeps_conversation_identity_and_generation`。
历史 v163 fixture 在重新 claim 前补齐 191/192/193，旧迁移数据保留与回滚断言不变。

完整私有 RPC seam 使用 `node scripts/smoke-member-environment.mjs`（先构建 Core）；Host 数据、
Skill Library、MCP 全隔离，CLI 与凭据均为 fixture。`node scripts/smoke-member-environment-ui.mjs`
使用生产组件验证保存回读、重置 CAS/活动任务拒绝、进程启动文案与双语移动布局，不启动 Core 或真实 Runtime。

升级后原生续接使用 `node scripts/smoke-member-environment-upgrade.mjs /absolute/previous/rovai-core`
（可加第二个候选 Core 路径，默认 `target/debug/rovai-core`）。旧 Core 必须是 schema 142 且旁边具有其
配套 `rovai` CLI；候选 Core 从当前源码构建。该 owner 用两个实际版本的 Core 与模拟 Claude/Codex，
通过正式保存、发送、执行与重启路径生成旧绑定，默认 Host 同时具有可读取的原生连接。它检查升级后的
实际 `--resume`/`thread/resume` 携带旧 Session ID、绑定代次保持，以及进程读取当前 Host＋队员配置。
私有 RPC smoke 没有执行消息，单元/迁移测试只检查记录，均不能替代此跨版本进程边界。
无需真实账号或模型；数据、Home、Skill Library 与 MCP 均使用自动清理的临时目录。

摘要选择的输入矩阵扩展既有 `agent_profile::slow_tests::discovered_entry_configures_and_freezes_without_health_evidence`，
覆盖两种 Runtime 的旧绑定、默认 Host 绑定、未知摘要与原权限语义；不新增 Rust fixture owner。
最小命令为 `cargo test -p rovai-core --lib --features slow-tests discovered_entry_configures_and_freezes_without_health_evidence`。

## 主干 / Preview Migration 合流（2026-10-08）

扩展既有 `runtime_catalog_migrations_preserve_rows_and_roll_back_with_their_receipts`，保留 schema 133
与 Preview 134 case，并增加主干 continuation 134 的来源、残缺结构拒绝、两个 catalog 同事务回滚、
重开后当前 schema 检查；不增加平行 owner。后续 main/135 的 Mission 描述来源加入同一矩阵，
验证结构化 Atom 保留、186 catalog 合流失败回滚及 187/137 重开。继续执行与 Mission 描述既有
migration owner 保留 frozen evidence、FK 恢复与 receipt failure case。纯 admission owner 补入
135/136 来源及缺失合流收据。SQLite 结构、事务和重开边界不能由纯 parser 代替；定向命令为
`cargo test -p rovai-core --features extended-tests --lib migration`，默认门禁仍为 `pnpm test:rust:pr`。

## Cline 官方 ACP 与 Hub 退役 owner（2026-10-08，User 95）

User 95 退役整个 Hub 执行合同，因此删除 cline_hub 的 config/events/failure/login/platform/transport/tests，
以及 native_hub_*、仅供旧 SDK/shim 实验的 compaction fixtures 和专用 Bun 依赖。历史复现链接固定 ada6f6c1，
成功、失败证据不删。对应 Hub 握手、WebSocket 限额、认证登录状态机/锁和全历史恢复已无当前 successor。
保留 ManagedProcess/Pi 结算及共享权限、取消、generation/未知输入、文件证据 owner。

恢复既有 ACP owner（不恢复固定版本门槛测试）：Cline 原生 Rule/observer、工具失败与 mutation 配对、
原生配置投影、模式、load replay quarantine；Node 的 cline-observer owner 继续检查数值过滤；Rust Host owner 检查冻结 Rule、成员隔离与源文件不变。
默认模型不在 switchable catalog 的本机负例扩展 grouped_acp_models 既有 owner：原生当前模型可以使用 shared
runtime-default 哨兵，不伪造可切换模型。协议分类、旧 Hub Missing-Send 拒绝和文件来源扩展原有 owner。
Host 配置/协议/恢复定向测试以 extended-tests 执行，分类全表 owner 使用 slow-tests；不以零测试通过替代执行。
真实安装与打包 App 使用精简 acp_product_probe/packaged_client，和模拟服务、旧 Hub 矩阵分开记录。
验证结果及未通过项见 [ACP 退役验收](../research/cline-runtime/acp-retirement-2026-10-08.md)。

以下小节保留先前测试演变的历史，并非当前入口清单。

## Cline 原生账号认证初版 owner（2026-10-08，历史）

本节是 User 85/87 阶段记录；当前测试归属与退役说明见下方 User 89 简化小节。

- `cline_hub::auth::tests::auth_source_and_projection_preserve_selected_metadata_without_oauth_copies`
  拥有账号/BYOK/未知来源与端点冲突、无关 OAuth 不复制及选中原生元数据保留的纯函数边界。
  旧配置 owner 只拥有 MCP 准备清理，不能发现凭据来源与投影错误。
- `cline::tests::native_refresh_keeps_binding_identity_but_account_and_byok_changes_fence_it`
  拥有 token 轮换不重绑、账号和 BYOK 变化仍重绑的纯兼容性边界；稀疏 Usage owner 不拥有配置摘要。
- `cline_hub::login::tests::login_interaction_is_private_and_cancel_releases_only_proven_empty_ownership`
  用最小私有 CLI 子进程验证交互、脱敏、取消后进程退出、单源租约、后续登录及未确认 owner 阻断。
  归入 extended-tests，纯函数不能证明内核进程所有权释放；不使用模型/真实 token，不代表 OAuth 刷新通过。
- 既有 `cline_hub::failure::tests` 增加认证/订阅/网络分类；既有产品 Smoke 增加显式 `--native-account`，
  无静态 key、直接引用授权原生源，保留失败记录。既有 diagnostic/recovery fixture 扩展已保存路径与凭据源的 Core 登录路由，
  发现并防止 fresh discovery 丢失已保存配置的回归。Renderer 登录交互由现有 settings-workspace fixture 承接。

最小命令：`cargo test -p rovai-core --features extended-tests --lib cline`、`pnpm test:settings-workspace`。
真实账号/刷新/并发结论必须来自独立[验收矩阵](../research/cline-runtime/native-account-auth-2026-10-08.md)。

## Cline 认证简化的测试变更（2026-10-08，User 89）

`cline_hub/auth.rs` 与其 `auth_source_and_projection_preserve_selected_metadata_without_oauth_copies`
测试一同退役：Provider/字段/端点准入、凭据投影与全生命周期认证锁已退出生产合同。
现有配置准备 owner 保留失败清理、live/preexisting 所有权边界，改断言不创建 Provider 副本、源文件不变。
现有 login owner 保留交互、脱敏、取消/整树清理；以未知账号格式、并存登录及持锁的旧 starting 记录
取代已退出的互斥/账号元数据准入断言。原生退出成功仅表示流程完成。
现有配置 identity owner 扩展缺 tokenSource/accountId 的轮换、无关 Provider 更新和当前 Key/账号/端点变化。
原生错误 owner 的 typed-error 传播 case 改用仍有效的原生未登录错误；拒绝/未知/脱敏断言全部保留。
没有新增 Rust 测试函数，未改动共享进程、Migration、权限或输入重放测试。

最小命令仍为 `cargo test -p rovai-core --features extended-tests --lib cline`。
已有产品脚本增加同源双成员 barrier 与各自审批/发送，并统一验证同 Host warm；BYOK 也直引原生来源。
真实刷新与首次授权不由模拟 fixture 或既有登录请求推断。

## Cline Hub 评审修正与测试退役（2026-10-08）

User 消息 83 明确删除 Cline ACP 后端，因而退役 `cline_backend_tests`、
`isolated_cline_acp_host_observes_warm_and_exact_cold_prompts`、原 `cline::tests` 的 Plugin 文件租约/
Host overlay owner，以及 `scripts/lib/cline-observer.test.mjs`。生产 ACP transport、Plugin 和对应
恢复合同在同一改动中退出；`paired_tools_accept_permission_only_denial_without_crossing_session_or_prompt`
及 ACP Application/文件 owner 中的 Cline 专属 case 随不可达分支退出。Hub 的 Run/Session fencing、
拒绝无副作用和已完成文件变更分别由 Hub 验收与共享文件来源 owner 承接。历史记录不构成兼容需求。原指标解析的全部稀疏桶、窗口和非法来源
case 保留到 `cline::tests::native_metrics_keep_sparse_usage_and_verified_context_windows`；
共享 ACP、文件解析、未知输入与 epoch fencing owner 保留。

新增 owner 均覆盖评审中的独立失败边界：

- `cline_hub::failure::tests`：纯函数验证明确拒绝/传输未知和原生错误秘密排除，旧实现丢失分类。
- `cline_hub::config::tests::native_catalog_exposes_all_configured_models_without_cross_provider_or_secret_metadata`：
  原配置只有默认模型，新纯 parser 验证多模型、当前 Provider 边界和私有元数据排除。
- `cline_hub::config::tests::preparation_failure_removes_private_copies_but_never_claims_a_live_or_preexisting_host`：
  最小临时文件 fixture，证明复制后 MCP 校验失败的清理及所有权移交，属于 extended-tests；纯 parser 无法证明文件删除。
- `cline_hub::transport::tests`：实际 loopback WebSocket 证明超过旧 16 MiB 的历史帧和超限头部拒绝，
  属于 extended-tests；只测 JSON 长度不能发现库自身的帧限制。没有模型调用。
- `cline_hub::tests::installed_hub_known_rejection_and_bounded_history_cold_restore`：显式 ignored 真原生
  protocol fixture，覆盖 native `ok:false` 到 Run 终态的完整链、禁止重发、有界合成历史的同 ID 冷恢复与拒绝无副作用。
  可通过 `ROVAI_CLINE_HUB_HISTORY_BYTES` 在 1 KiB–32 MiB 范围选择合成大小，默认 1 MiB；超限负例不得算作通过。
  只向不存在的 Session 提交失败请求，不执行模型；普通 CI 不依赖安装或私有配置。

最小验证：`cargo test -p rovai-core --features extended-tests --lib cline`；恢复、文件来源与
ACP 的既有扩展 owner 按改动范围执行，最终默认 workspace 门禁仍使用 `pnpm test:rust:pr`。
Windows 真机编译使用手动 `Full check` 的 `windows-check` scope；不把 macOS 或 Ubuntu 检查当作 Windows 证据。

以下 2026-10-07/04 小节是准入历史，已退役 owner 的当前归属以上文为准。

## Cline Native Hub owner（2026-10-07）

- 新纯函数 owner `cline_hub::config::tests::native_compaction_preferences_preserve_off_and_reject_unknown_defaults`
  覆盖独立的原生偏好边界：多行 CLI help 默认、明确 off/basic/agentic、非法类型与未知默认。
  原 ACP observer 不能拥有新原生配置解析；默认层运行 `cargo test -p rovai-core --lib native_compaction_preferences`。
- `cline_hub::tests::installed_hub_rule_approval_usage_and_cleanup` 是独立 WS/进程边界 Smoke，归入
  extended-tests 且带明确凭据/模型费用原因的 ignored。需要 `ROVAI_CLINE_HUB_ACCEPTANCE_EXECUTABLE`
  和隔离原生 CLINE_DIR/CLINE_DATA_DIR；命令 `cargo test -p rovai-core --features extended-tests --lib
  installed_hub_rule_approval_usage_and_cleanup -- --ignored --nocapture`。不将真实模型混入默认层。
- `agent_profile::cline_backend_tests::backend_provenance_uses_the_current_binding_and_preserves_legacy_acp`
  拥有现有 Binding 的后端查询：旧 ACP 不迁移、新 Hub 保留、错误 digest 不匹配、缺证据阻断、其他
  Runtime 切入走共享重绑。两个最小内存表验证 JOIN，纯枚举测试不能证明该读取边界；默认层运行
  `cargo test -p rovai-core --lib cline_backend_tests`，不启动完整迁移或进程。
- `runtime::tests::recovery_boundaries_are_closed_over_the_product_adapter_catalog` 与 runtime_diff/runtime_file_operation 既有
  owner 扩展 Hub/ACP 冻结边界、成功/失败补丁 case；没有复制 SQLite fixture 或删除原 case。
- 历史 v103/v107 fixture 的封闭 Skill group 列表排除后来引入的 Cline/Command Code；原 Migration
  保留断言不变。当前 catalog owner 补齐两个已有 Runtime，并将 ACP 数量预期与现有清单对齐。
- `docs/research/cline-runtime/fixtures/native_hub_product_probe.mjs` 拥有隔离 Core→Native Hub→builtin IPC
  的产品 seam，读取 SQL 证据但不写数据库。每个 first/warm/cold 必须有一条实际 source_operation_id
  发送，missing-send fallback 不算通过。流程与参数见 [产品报告](../research/cline-runtime/hub-adapter-implementation.md)。

<a id="command-code--cline-数值通道2026-10-04"></a>
## Command Code / Cline 数值通道（2026-10-04）

新增 owner 按数值来源和失败边界划分，不复制公共 Monitoring fixture：

| Owner | 独立失败语义与最低成本 |
| --- | --- |
| `command_code::tests::usage_counts_root_calls_once_and_keeps_context_separate` | root start/end 配对、终态重述/子事件去重、稀疏桶和最新 Context；现有 decoder 只拥有帧和权威终态，不能证明计量语义。纯事件进入默认层 |
| `cline::tests::observer_records_are_private_bounded_and_owned_by_one_prompt` | 新的官方 Plugin 文件边界：精确 lease、跨 Run/重复序号、预算、只读 poll 与终态消费；复用单个最小临时目录，归入 extended-tests。纯 DTO 不能证明文件隔离/消费 |
| `cline::tests::host_overlay_preserves_native_paths_and_fences_config_changes` | Host 私有配置必须保留原生路径/插件、合并 MCP、限制文件权限并感知 credential 变化；最小文件 fixture，归入 extended-tests，不启动进程/数据库/模型 |
| `db::tests::runtime_catalog_migrations_preserve_rows_and_roll_back_with_their_receipts` | 新的已部署 schema 133 来源，七个 CHECK 表及其触发器/收据/marker 必须在故障后整体回滚；沿用 extended-tests 数据库 owner 层级。旧 DSH migration 不拥有此来源；纯函数无法证明事务回滚与重开 |

真实 `isolated_command_code_reports_live_calls_and_exact_resume_usage` 和
`isolated_cline_acp_host_observes_warm_and_exact_cold_prompts` 使用显式原因的 ignored Smoke，
只接受隔离环境与真实凭据。前者核对逐调用四桶和等于原生最终 result，并证明 Context 在结束前到达；
后者覆盖共享 Host/原生 Plugin seam、live/terminal 去重、精确恢复及工具/取消行为。
普通 fixture 无法证明当前官方 Runtime 和模型实际返回这些字段。数值记录及环境约束见
[真实验收](../research/runtime-monitoring/command-cline-verification-2026-10-04.md)。

现有 Command transport owner 扩展为大 stdin 与两个输出管道同时阻塞的回归，并验证写入期间可取消，
不新增等价进程测试。现有 Monitoring parser/flush、ACP event 和数据库 preflight/来源矩阵 owner
直接加入 Cline case。JS 的 `scripts/lib/cline-observer.test.mjs` 独立拥有官方 Hook 对私有正文、子代理、
迟到调用与非数值字段的排除；已进入 `pnpm test`。没有退役测试。

合入主干指标后，既有 TRAE LRU owner 将 `models --json` 查询与 `acp serve` Host 启动分别计数，
仍要求两个 prompt 共用同一 Host/Session。原 `private_host_config_is_created_only_for_kiro` 更名为
`private_host_config_is_scoped_to_profiles_that_require_it`，保留全部原输入并补 Cline 私有目录 case。

本次 `reported_mutation` 新增纯函数 owner
`runtime_diff::tests::reported_mutations_preserve_native_fragments_without_claiming_exact_or_full_states`：
拥有新持久化语义的来源白名单、字段剔除、路径排除和 Evidence 读回；既有 exact mutation owner 不拥有模糊匹配语义。
它不创建文件、数据库、子进程或真实模型。Cline 配对、Command Code 生命周期、ACP 公共 seam、AgentRun reducer
和 Renderer 均扩展既有 owner，不复制同一链路。沿现有 Runtime Diff owner 的 extended-tests 层级；定向命令为 `cargo test -p rovai-core --features extended-tests --lib runtime_diff::tests::`。
真实模型与隔离 App 属于单独验收，见研究记录。

Cline 窗口补采扩展既有 observer/config 两个 Rust owner 和 `scripts/lib/cline-observer.test.mjs`：
覆盖精确 Provider/模型匹配、Host 快照与配置变更栅栏、无 used 的独立窗口、无效值/未知来源回退和私有字段排除。
未增加独立测试或退役测试；定向命令为 `cargo test -p rovai-core --features extended-tests --lib cline::tests::`
与 `node --test scripts/lib/cline-observer.test.mjs`。真实目录、模型调用和 UI 证据见
[窗口补采](../research/runtime-monitoring/command-cline-context-window-2026-10-05.md)。

最小命令：`cargo test -p rovai-core --features extended-tests --lib command_code::tests::`、
`cargo test -p rovai-core --features extended-tests --lib cline::tests::`、
`cargo test -p rovai-core --features extended-tests --lib runtime_catalog_migrations_preserve_rows_and_roll_back_with_their_receipts`；
其余定向与真实 Smoke 命令见上述验收记录，默认 workspace 门禁仍按下方路由。

## 2026-10-09 主干合流的回归归属

迁移编号 186 的冲突由既有 `db::user_anchors::tests::direct_reply_index_migration_is_atomic` 扩为两种来源：
Preview/137 缺索引，main/136 有索引但缺 Cline/Command catalog；后者先经 187 保留 Mission 描述，
再由 188/schema 138 收敛。失败收据回滚、部分来源拒绝、历史摘要不变及重开准入均保留；没有新增 Rust owner。
既有 catalog migration owner 同步去掉后续 188 receipt 后再构造旧来源，不删除原输入矩阵。

随后 Mention 主干也使用 receipt 187。扩展其既有
`db::message_mentions::tests::mention_format_upgrade_preserves_frozen_rows_and_is_atomic`：覆盖 Preview/138 的 v32
升级与 main/137 已有 v33、缺 Preview catalog 的来源，189/schema 139 收敛；验证部分 v33 拒绝、
收据失败回滚、冻结行摘要与旧 187 收据不变及重开。沿既有 downgrade 链构造旧数据，不新增或退役 owner。
最低命令为 `cargo test -p rovai-core --features extended-tests --lib db::`。
完整迁移回归另发现 v104/v105 的旧目录 fixture 从当前 ALL 枚举意外带入 Cline/Command；
只从其旧来源中排除后加入的两项，原迁移结果、Skill 分配及自定义范围断言不变。

2026-10-10 合流内部续做请求后，主干 188/schema 138 与 Preview 同号收据也按完整结构区分，
190/schema 140 收敛队列与 ACP catalog。扩展既有
`db::run_continuation::tests::continuation_migration_rolls_back_and_preserves_frozen_evidence`：
覆盖主干已具备内部请求但缺 catalog、Preview 139 仍使用消息来源、部分结构拒绝、失败回滚、旧 188
收据与冻结证据保留及重开。既有 `delivery_queue::tests::user_continuation_preserves_source_and_claims_independent_fifo_batches`
拥有带历史消息/排队数据的转换。该主干来源 fixture 先移除后加的 191/192 层，避免残留新收据伪装旧来源；
原有失败回滚与冻结证据断言保持。没有新增或退役 Rust owner；最小命令为
`cargo test -p rovai-core --features extended-tests --lib continuation_`，并复验 Mention 与 catalog migration owner。



macOS 采用一个内核身份树，保留主干取消时捕获与本分支的可选持久 ledger。既有
`runtime_probe_process::tests::cancelling_the_owner_kills_the_spawned_process_group` 在合流时暴露 100 ms
缓存漏掉新 fork 的问题；取消捕获改为新鲜快照，原断言保留。PID-version 内核负例与崩溃恢复仍由
`managed_process::process_tree::tests::pid_version_and_restart_ledger_preserve_process_ownership` 拥有，
模块路径从原 macos 名称归入共享 process_tree 后同步 helper filter，未退役测试。

Claude 既有公开文本测试保留 thinking/text/tool 交错与批量终态矩阵；绑定原生 message ID 后允许
私有 thought started/completed 事件，并精确检查它们只有 itemId。公开文本仍单独断言，私有内容不外发。

定向执行上述 owner、`managed_process::`、`acp::`、`claude::`、`antigravity::` 和 `continuation_`；
默认 workspace、前端与文档门禁在合流后重跑。模型测试仍与这些本地控制夹具分开记录。

## 续做可靠性回归

复用 `managed_process::tests::cancellation_reaps_captured_detached_children_after_parent_exit`，将既有 Linux
owner 扩展到 macOS，证明捕获后脱离进程组的子进程被回收、无关进程仍存活。Claude 既有初始化失败和
stdin 中断 owner 增加缺失会话、投递门禁取消；ACP 模型目录 owner 增加恢复成功后的配置 RPC 拒绝。
`delivery_queue::tests::continuation_rechecks_scope_and_selects_safe_session_at_claim` 增加可信失败终态和
binding/epoch/native turn 不匹配矩阵；既有 unknown、取消、Task 关联和整批范围断言保留。

新增 `runtime::tests::failed_session_replacement_retains_reference_without_reviving_old_binding` 拥有替代启动
失败后的持久引用恢复：修复前旧引用清空；须同时验证凭证不复活、旧 epoch/unknown 不准入和新会话不覆盖。
已有会话选择 owner 不拥有凭证轮换事务，故复用最小 claimed-run SQLite fixture，纯函数不足以证明该 seam。
新增 `antigravity::tests::stream_input_waits_for_exact_session_and_dispatch_authority` 拥有真实 pipe 的初始化／
输入边界；输出 parser owner 无法证明输入尚未发送，覆盖明确缺失、非缺失身份冲突、门禁取消、调用方 abort
和释放后原始字节。使用本地受控子进程，不访问模型或真实用户数据，属于扩展层。

macOS `killpg` 的已退出进程组修正扩展既有
`managed_process::tests::cancellation_reaps_captured_detached_children_after_parent_exit`，不新增独立 owner：
复用原真实后代 fixture，检查活跃树、根退出但 detached child 仍活跃、整树确认退出后的 `EPERM`，
以及其他错误和不完整捕获仍拒绝放行；无关进程存活断言保留。旧错误策略在确认整树退出的正向输入上失败。
最小命令为 `cargo test -p rovai-core --lib managed_process::tests::cancellation_reaps_captured_detached_children_after_parent_exit -- --exact`；
随后运行整个 `managed_process`、`antigravity::tests::` 和默认 workspace。未删除、禁用或放宽现有测试。

最小命令：`cargo test -p rovai-core --features extended-tests --lib` 后分别过滤以上 owner，以及
`managed_process::`、`claude::`、`antigravity::`、`acp::`、`planned_shutdown::`、`continuation_`。
真实模型、透明代理终止原生进程和隔离数据目录的验收单列于
[续做可靠性验收](../versions/v1.72/continuation-reliability-verification.md)，不以协议夹具替代真实结果。

## Run 思考反馈

`runtime_thinking::tests` 拥有两个纯状态 owner：分片短标题的有界解析与清除，以及 root/child/replay/旧 item
隔离。修复前仅有无文本 phase 推导，既有 owner 没有原生标题解析状态；因此新增最低成本单元测试，
不新增数据库夹具。最小命令为 `cargo test -p rovai-core --lib runtime_thinking::tests::`。

Claude/Pi 空思考块和 ACP 订阅协商扩展已有 Runtime owner（`--features extended-tests`）；标题不落库复用
`execution_text::slow_tests::text_blocks_preserve_interleaving_live_reads_and_shutdown_without_fragment_writes`
（`--features slow-tests`）。前端复用 `App.test.ts`、分页缓存和事件缓冲 owner；
`node --test scripts/lib/execution-state-transition.test.mjs` 验证真实浏览器布局、旧读取/旧 epoch 隔离与重连恢复。

显式真实模型验收：`node scripts/smoke-runtime-thinking.mjs codex-cli copilot-cli claude-code-cli pi`。
脚本使用独立 Core data-dir、Skill Library 与 Workspace，只保留 phase/标题长度和终态元数据。
Pi 默认未开启思考时可用 `ROVAI_THINKING_PI_MODEL` 指定该机器已配置的原生模型 ID，在隔离成员上设置
`thinking_level=high`；不修改全局配置。可选标题是否实际产生与原生 Runtime/模型有关，未观察到不能报告标题实测成功。

## Member CLI

复用 `team_tool::tests` 的真实 Run/数据库 fixture。新增扩展 owner
`member_profile_reads_and_patches_preserve_scope_atomicity_and_replay`：既有创建 owner 不拥有
全局 PATCH 的事务合并、版本、图文原子提交及输出路径边界；修复前这三个操作不存在。
创建后编辑与原创建者/跨 Thread 限制扩展既有
`confirmed_user_input_can_create_one_idempotent_member_but_agent_input_cannot`，不新增数据库 fixture。
图片矩阵扩展 `member_avatar::tests::imports_four_by_five_image_with_lightweight_crop_and_deterministic_identity`；
封闭输入和 null/空 PATCH 扩展既有 `member_studio` schema owner。
PATCH owner 同时覆盖相同图片的新请求无版本变化、源文件消失后的持久回放、同路径换图冲突，
以及已提交资产缺失时不得重建其 ID。Run tmp 轮换删除与图片重取扩展既有
`builtin_tool_runtime::tests::lease_rotates_fences_and_replays_exact_request`。
无 Lead 的名单与零写入扩展原 PATCH owner。CLI 的
`direct_flags_and_input_file_are_mutually_exclusive` 覆盖 create/update 直接参数与 JSON 文件保持原始
相对／绝对路径。原创建与 PATCH owner 覆盖认证 Run 的文件入口：冻结 execution root 与 Thread
workspace 不同、同名图片内容不同、失效 epoch／缺失 workspace 拒绝、缺失源仍能解析和回放、
绝对路径原样保留、symlink 仍由 importer 拒绝。附件 helper 的等价性扩展
`local_attachment_source::tests::resolver_returns_exact_stored_paths_for_files_and_directories`。
修复前 update 在 CLI cwd 解析、create 在 Core cwd 解析；本次未新增 Rust owner，沿用已有
数据库 fixture 验证冻结 Run 的权威，纯路径测试不能证明该 SQL 归属。

最小验证：先 `cargo test -p rovai-core --features extended-tests --lib member_ -- --list` 确认 owner 非零，
再执行同命令去掉 `-- --list`；租约 owner 使用
`cargo test -p rovai-core --features extended-tests --lib builtin_tool_runtime::tests::`，
同样先核对清单；默认 workspace 回归仍执行 `pnpm test:rust:pr`。

### GIF 队员头像

复用 `member_avatar::tests` 的 import/read、recrop、结构解析与资源限制 owner，增加 PNG 上传尾部
与受管严格校验、GIF 长宽图及缩放取整后贴边取景的保存/读取/再次裁剪、PNG 渠道封面及超限拒绝。
新增最低成本纯 codec owner `gif_crop_preserves_transparency_disposal_and_loop_semantics`：修复前透明
部分帧会留下残影、无循环扩展会变为无限循环；现有持久化 owner 只检查整帧颜色，不拥有部分帧
disposal 的逐像素状态转换，因此不用完整数据库或重复文件夹具验证此矩阵。最小命令为
`cargo test -p rovai-core --lib member_avatar::`。
创建路径复用 `confirmed_user_input_can_create_one_idempotent_member_but_agent_input_cannot`，在现有
PNG 成员创建/幂等矩阵中增加 Run 相对路径 GIF；认证与 Migration owner 不变。该 owner 需
`--features extended-tests`，不能用默认构建的同名过滤结果宣称已经执行。

Desktop/Web 的原始文件检查共用 `packages/contracts/src/member-avatar-image.ts`，原
`member-avatar-assets.test.ts` owner 覆盖标准循环扩展、逐位置截断、越界帧、元数据和浏览器 MIME
不可靠输入；UI 的静态图片与提交失败恢复继续由现有 avatar image/submit owner 负责。

`cargo build -p rovai-core --bin rovai-core` 后运行 `pnpm test:member-avatar-flow`：真实编辑器与
Web 序列化适配调用独立 Core，覆盖动画预览、调整取景不重建 Blob URL、超宽图规范化后
保存/重开/重新裁剪、页面刷新与渠道静态 PNG 首帧。夹具通过 Chromium 指定测试文件，不启动真实 Runtime；
userData、Skill Library 和 MCP 路径均为本次临时目录，成功后清理。可通过
`ROVAI_CORE_BINARY` 指定已构建 Core，`ROVAI_KEEP_MEMBER_AVATAR_FIXTURE=1` 保留验收数据。

## Thread 执行查询

`thread_runs::tests` 拥有新的输入/游标封闭边界与 Unicode 预览语义；现有 owner 没有执行游标或该截断约定，
故用两个纯函数测试覆盖空值、过滤绑定、状态和 200 码点边界。最小命令为 `cargo test -p rovai-core --lib thread_runs::tests::`。
`thread_runs::read_tests` 拥有公共 Run/动态队列/冻结输入的 SQL 读取 seam；用最小隔离 SQLite 表验证私有候选排除、
历史归属、计数不依赖可见性、缺失来源、逻辑状态、游标条目消失和无写入。纯函数不能证明 JOIN、聚合或事务读取，
现有 claim owner 也不拥有该查询；最小命令为 `cargo test -p rovai-core --features extended-tests --lib thread_runs::read_tests::`。
其中 `candidate_pages_bound_materialization_and_use_thread_indexes` 复用该夹具，独立拥有长历史查询的候选读取上限与索引访问：
5 万条目标 Run、5 万条其他 Thread Run 和 2,000 条 waiting Delivery 下，SQL 只返回本页加一条；
同时验证混合时间格式、纳秒与同刻身份排序、深页游标和完整聚合计数。修复前单页会物化全部 50,002 个候选，
原可见性测试的小数据集不能证明这个成本边界。执行计划断言只验证现有 Thread/turn/队列索引的访问，
不声称时间排序或完整等待计数是 O(limit)；不依赖耗时阈值，最小验证命令沿用该 read_tests owner。
消息 addressing、实时历史范围、Single Chat、Bootstrap 和 Skill 升级复用现有 owner，不另建等价 fixture。
历史 collection 结果沿用 `execution_evidence` 的既有持久化 owner，验证 inline/blob 原始字节、digest、receipt
与当前 CLI 的严格 Schema 分离；不放宽新结果合同。

## 渠道入站附件

本次不新增 Rust fixture owner；扩展 `channel::tests` 的既有附件准入与队列测试为飞书/钉钉矩阵，保留原有
ready、retry、failed、deleted、folder 和 20＋2/FIFO 输入，并新增跨 Provider 下载候选/完成拒绝断言。
修复前钉钉资源在 observe 被拒绝、tick 不返回附件、complete 只接受飞书 Host；这属于同一个持久队列到
CampMessage/Delivery 的 seam，继续使用现有隔离 SQLite/文件 fixture。钉钉多 Bot owner 同时验证文本和图文，
两个接收 Bot 使用不同 downloadCode 时仍冻结首观察 Bot 的 grant，绑定选择和下载完成后仅派发一次。
最小命令为 `cargo test -p rovai-core --features extended-tests --lib channel::tests::`。

Lark 入站资源下载扩展既有 `wrong_provider_hosts_are_rejected_by_every_lark_capable_handler` owner：
同一 provider 世界内验证观察、待下载任务、错误 Host 拒绝、正确 Host 完成与 Camp Source Ref。
Main 的飞书/Lark 参数化 owner 覆盖流式下载、临时文件清理、文件夹失败提示与各自完成请求路由。
这不增加独立 Rust fixture owner；真实 Lark 租户权限仍按版本验收记录单独验证。

Main 的现有 normalizer owner 覆盖官方 picture/richText/file/audio/video 字段；新增钉钉下载适配器测试拥有
Open API grant 兑换、独立 CDN 请求无 token、取消与丢失 grant 的 seam；共同字节限制和临时文件清理由既有
飞书下载测试继续覆盖。Host 既有 fixture 扩展文件成功、folder 明确失败和 receiving Bot 选择，不运行真实模型
或使用日常账号凭据。真实租户收发与权限验收仍须单独记录。

## 原生连接编辑退役

按 User 2026-10-07 的取消要求，原生连接表单、写回、迁移、Key 编辑和模型目录生成在同一改动中退出，
对应写路径测试退役。`runtime_custom_api::tests` 保留只读来源、摘要/凭据变化、脱敏、历史快照和原生字节不变，
其中 SQLite owner 改为证明普通启动字段的 CAS、合并、提交失败回滚及隐藏历史凭据；没有新增数据库夹具。
`runtime_startup::tests` 扩展封闭输入与旧字段拒绝；Core `runtime_check_environment::tests` 继续验证阻塞读取不妨碍
本地保存、迟到结果不覆盖新设置，并把旧 API 保存矩阵改为明确拒绝。现有 agent profile owner 保留冻结/重绑定隔离。

最小命令：`cargo test -p rovai-core --features extended-tests --lib runtime_custom_api::`、
同参数的 `runtime_startup::` 与 `runtime_check_environment::tests::`；冻结 seam 属于 `slow-tests`，
按既有 owner 单独执行。UI 复用 `pnpm test:settings-workspace`，覆盖两种智能体无连接表单、保存一次请求、
立即结束加载、失败草稿、主题及缩放。已删除专用 API UI/CLI smoke，原生执行回归仍由 Claude/Codex owner 拥有。
完整退役清单及证据见 [v1.72 实施计划](../versions/v1.72/implementation-plan.md#2026-10-07-移除自定义-api-配置)。

## 测试层级

### DeepSeek Harness ACP

Responses 工具兼容由 `dsh::tests::responses_tool_defaults_preserve_native_overrides_and_private_settings`
拥有：此前显式 `openai-responses` 路由缺少兼容默认值，工具定义省略 `strict`；测试只用临时 settings，
覆盖默认投影、Provider / Model 显式开关不复制或改写、其他协议不投影、私有字段不进入 patch、解析错误脱敏。
既有权限 owner 不拥有 Provider 配置投影，因此增加这一个独立 owner；无需数据库或真实模型。
最小命令：`cargo test -p rovai-core --lib dsh::tests::`。
构建 Debug Core/CLI 后运行 `node scripts/smoke-dsh-responses-tools.mjs`，用已安装 DSH 与受控本机 Responses
端点验证实际 wire `strict: false`、原生 Provider / Model 覆盖优先级、真实 shell 副作用与非法空理由仍拒绝。
该 Smoke 自动隔离 Core data、Skills、MCP 与 DSH Home，不使用真实凭据或远端模型；模型行为仍需真实调用验证。

新增 owner 均使用临时目录，不读取真实凭据、不启动模型；最小命令为
`cargo test -p rovai-core --lib dsh` 和
`cargo test -p rovai-core --lib frozen_permissions_preserve_native_values_without_rewriting_native_home`。

- `dsh_version_requires_the_first_acp_release` 拥有 CLI 最低版本边界：旧 rc 与 ACP 自报桥接版本不能取得准入。
  既有版本 owner 依赖其他 Runtime 的版本语义，不能证明本包的首个 ACP rc。
- `dsh_native_configuration_fences_profile_and_credentials` 拥有原生配置变更 fence：此前遗漏
  `profiles/acp/cordis.yml`，更换该 composition 的模型路由可能继续复用旧 Host；使用临时文件覆盖
  profile/凭据/settings 变化、摘要稳定与不可读拒绝。已有权限 patch owner 不拥有配置输入摘要；
  最小命令为 `cargo test -p rovai-core --lib dsh_native_configuration`，无需真实进程或数据库。
- `dsh_observation_is_exact_consumed_once_and_never_infers_exit_from_text` 拥有官方 observer → ACP 的独立文件 seam：
  串 Session、重复消费、非零退出正文伪装成功、write 显式 `before:null` 转 add Diff、edit 双字符串转 update Diff，
  以及缺少 before、edit null 和大文件的路径级回退与缺失用量字段。
  纯 ACP fixture 没有 DSH 的一次性观测文件，因此使用临时文件而非数据库/真实进程；Shell、文件与 usage 共用同一 owner。
- `frozen_permissions_preserve_native_values_without_rewriting_native_home` 拥有六种原生参数组合：原生 preset 曾覆盖
  Host 参数并拒绝 full/ask、read-only/never；测试要求 `sandbox_mode`/`approval_policy` 原样进入 patch，Workspace
  access 不收窄或改名，并确认 bootstrap 不再携带自造 MCP guard 配置。
- `dsh_catalog_migration_preserves_rows_and_rolls_back_with_its_receipt` 拥有新增 v1.59/schema 106 → 107 入口：
  旧闭集拒绝新 Adapter/Skill，扩集须保留现有行/约束并与 receipt 原子回滚。SQLite 的 DDL、trigger 与 FK
  不能由字符串解析证明，因此采用一次隔离事务及重启验证；已有 migration owner 不覆盖这个 source schema。

共享 Fleet、ACP approval、Monitoring、quota 分类、闭集和历史升级继续扩展既有测试，不新增重复 owner。
`warm_hosts_never_cross_camp_compatibility_keys` 同时拥有 DSH native lock replacement：idle/busy 都必须等待确认回收，
busy Run 不被抢占，回收失败阻断 replacement。
`node --test scripts/lib/dsh-host.test.mjs` 拥有官方扩展点的 Bootstrap/父子身份、完整 Server 遮蔽、MCP
配置投影和最小结构化 observer 合同；它明确区分 write 的显式 null 与缺失 before，拒绝 edit null/超限状态，
断言没有 Core `tools/pre-execute` 安全层，且不保存其他完整工具输出。
`scripts/smoke-mcp-projection.mjs` 断言 DSH 三组权限下 synthetic Approval 为 0；
`scripts/smoke-acp-runtime.mjs` 的现有文件矩阵对最终 UTF-8 内容作逐字节、fail-closed 断言，并断言 add `+1/-0`、
edit `+1/-1`、空文件 edit `+1/-0`；内容不匹配时即使 Diff 正确也必须失败。缺失、类型错误、超限或不可信
状态仍由 owner fixture 断言为路径级回退。
真实验证入口与隔离参数见
[DSH Parity Matrix](../research/deepseek-harness-runtime/acp-0.1.5-parity.md)。受控模型只用于明确标注的协议和权限
实验，不替代真实模型/Built-in CLI 验收。

### Linux Server ABI 与原生 OS

`node --test scripts/lib/linux-server-abi.test.mjs` 拥有 ELF 导入版本的解析和兼容拒绝矩阵；构建必须检查实际包内
所有 ELF。`scripts/smoke-linux-server.py` 拥有同归档、普通用户、无开发工具 PATH 的 Server OS seam，
不调用 Runtime。Ubuntu 两个原生 runner 与 Debian 12 独立 VM 运行同一包，发布草稿依赖这些 gate。
既有 `runtime_platform_admission::tests::registry_projects_the_complete_closed_matrix` 扩展 Linux 显式适配范围的 preview
和 Cursor 阻断行；DeepSeek Harness 的 Linux x64 独立资格也由同一矩阵 owner 绑定自己的 evidence digest，
不新增重复 Rust owner。最小 Rust 验证为 `cargo test -p rovai-core --lib runtime_platform_admission::tests::`。


### Codex 自定义 Provider 与 Server Runtime

`managed_process::tests::linux_cancellation_reaps_captured_detached_children_after_parent_exit` 拥有 Linux pidfd
取消回收边界：真实子进程 `setsid` 后，原父进程先退出，已捕获子进程仍须退出，另一个同 UID 对照进程须存活。
修复前仅 killpg 会留下该子进程。既有 Unix stdio/PID owner 没有后代重挂靠状态，纯 parser 不能证明内核身份和
信号语义，因此使用有握手、截止时间和清理的最小进程 fixture，不启动 Runtime/数据库。最小命令：
`cargo test -p rovai-core --lib managed_process`（Linux）。Antigravity 则扩展既有
`structured_runtime_failure_preserves_sanitized_provider_detail` 的 exit 0/1 输入矩阵，证明明确 ERROR 的语义和脱敏
不会被非零退出码吞掉；无结构化终点仍由既有 process failure owner 负责，不新增重复测试。

`acp::tests::codebuddy_launch_preserves_native_default_and_explicit_model_selection` 拥有 CodeBuddy 启动模型选择：
RuntimeDefault 不得作为 `--model` 原生参数，显式模型仍须在 session/new 前传入。修复前传入内部 sentinel
导致 BYOK 执行被拒绝。现有 launch owner 分别拥有 Kiro/Cursor 权限，未覆盖此模型边界；新 owner 仅检查命令
构造，不创建进程或数据库。最小命令：`cargo test -p rovai-core --features extended-tests --lib codebuddy_launch_preserves_native_default_and_explicit_model_selection`。

`health::tests::codex_probe_requires_login_unless_native_provider_explicitly_waives_it` 拥有 Codex 原生认证进程边界：
同一隔离 fixture 覆盖 OpenAI 登录成功、自定义 Provider 明确免登录，以及 true、缺失、类型错误、RPC 拒绝。
既有 ACP Native Home owner 使用另一协议，不能证明 `account/read` 的语义。fixture 不修改环境或读取真实凭据，
故意返回空 capability schema，确保认证通过不会自动变成 Ready。最小命令：
`cargo test -p rovai-core --features extended-tests --lib codex_probe_requires_login_unless_native_provider_explicitly_waives_it`。

既有 `zcode::tests::official_bundle_layouts_reject_launchers_and_missing_resources` 增补官方 Linux 平面布局、
缺失 App 资源和 kernel symlink 越界拒绝；同时检查 Linux 默认位置不纳入相对 Home，不新增重复 owner。
最小命令：`cargo test -p rovai-core --lib zcode::tests::official_bundle_layouts_reject_launchers_and_missing_resources`。

`node scripts/smoke-server-runtime.mjs /absolute/server-package codex-cli /absolute/new-fixture` 是显式调用模型的
包内 HTTP 验收入口，也接受其他显式准入的 Linux Runtime。调用方须提供隔离 HOME 与私有原生 CLI 配置；脚本从新 data-dir
派生 Skills/MCP 根，验证工具的公开投影、warm/cold continuation 和运行中取消。结果保留源码提交，任何未闭合
断言均记失败，不能单独替代完整 Runtime 资格清单。

### Web 文件资源开销与一致性

`rovai-web::resources::content::tests::candidate_analysis_bounds_paging_and_preserves_other_digest_checks` 拥有候选完整
分析、分页/定位的读取量与摘要次数、原始修改时间检查、UTF-8 跨块、长行及缩短/空文件的有效位置。
计数和读取中变化注入只在既有文件夹具中启用。新约定只放宽同候选分页/定位，等大小等修改时间改写
可以继续读取；新候选、完整正文和父 generation 的摘要验证保留。旧的分页摘要拒绝断言随该合同替换，
没有删除测试 owner 或其他负向/边界 case。最小命令为 `cargo test -p rovai-web resources::content::tests::`。

既有 `host-web.test.mjs` owner 验证上述属性校验与 generation 接线，并保留认证字节、其他读取的摘要拒绝、
上传取消/拒绝/重放清理与构建缓存边界。Node SQLite fixture 使用有界 busy timeout。
`file-preview-service.test.ts` 在真实文件描述符上计数，验证紧接定位的分页只读正文，其他偏移和其他句柄仍定位。
`file-preview-resources.test.ts` 验证同版本 HTML 只准备一次、摘要不同继续读取、手动/错误/无句柄恢复及新通知水位。
`camp-adapter.test.ts` 和 `file-digest.test.ts` 继续验证通知接线、Host 确认后的本地图片复用及浏览器摘要缓冲上限。
手机实际 Host 用例检查上传后无原图回传、刷新后恢复 Host 读取；Run 文案由既有执行组件场景验证。
`node scripts/measure-host-web-resources.mjs` 对独立 Host 执行 20 MiB / 80 页固定工作量，断言内容与行号一致并记录计时；
`--legacy-json` 可对旧 Host 记录 Base64 膨胀并核对解码后的原始字节。可用 `ROVAI_HOST_BIN` / `ROVAI_WEB_UI` 选择包内产物。


### Pi Windows 工作目录

`pi::host::tests::host_cwd_uses_safe_dos_spelling_and_rejects_extended_only_paths` 拥有 Pi 命令构造边界的
路径转换矩阵：规范化的本地英文/中文路径必须传为等价 DOS 写法；需要 verbatim 语义的路径必须明确失败。
既有 argv/Session 参数测试不检查 cwd，因此不能覆盖 Issue #346 的默认 Session 目录命名回归。
Windows 定向命令为 `cargo test -p rovai-core --features extended-tests --bin rovai-core pi::host::tests::`。

独立的 ignored `native_pi_host_starts_with_canonical_workspace` 使用真实 native Pi、Managed Process 和正式
Host 参数验证 canonical Quick Chat/中文目录上的 `get_state`，不指定 Session 目录、不调用模型，并回收进程。
运行前将 `ROVAI_PI_STARTUP_SMOKE_EXE` 指向官方 `pi.exe`，将 `ROVAI_PI_STARTUP_SMOKE_ROOT` 指向独立绝对
临时目录，`PI_CODING_AGENT_DIR` 必须等于该目录下的 `agent`；Home/AppData 也应隔离，不继承认证环境。
通过 `cargo test -p rovai-core --features extended-tests --bin rovai-core pi::host::tests::native_pi_host_starts_with_canonical_workspace -- --exact --ignored`
显式执行。该 smoke 证明原生进程解释 cwd 的结果，不能由命令字段断言代替。

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

### Claude Code 无 Prompt 目录验证

原生审批转换由 `claude_permission::tests::native_permission_ids_and_exact_input_bind_frozen_approval_options`
拥有最低成本输入矩阵：request_id/tool_use_id 区分、原 input 回填、缺失身份拒绝及重复命令独立绑定；
原生建议的精确 updatedPermissions、四种 destination、suppression、无效/未支持建议、建议去重与响应 digest
在同一纯转换 owner 内扩展，不新建 SQLite 或进程 fixture。
最低成本控制准入由 `claude_control::tests::incompatible_initialization_and_missing_tool_identity_never_admit_permission`
拥有：初始化错误、模式漂移和可选 tool_use_id 缺失必须拒绝，不能自动放行。
最小命令：`cargo test -p rovai-core --lib claude_permission::tests::`、
`cargo test -p rovai-core --lib incompatible_initialization_and_missing_tool_identity`。

控制写入并发与关闭由 `claude_control::tests::native_decisions_are_serialized_by_id_and_close_only_after_the_last_idle_result`
拥有，覆盖 256 次普通工具后、相同输入的独立 ID、NDJSON 串行化、后台任务与多结果收尾。
同一 owner 扩展精确记忆响应：范围/目的地篡改、跨请求借用及 suppression 均拒绝；允许的 updatedPermissions
逐字段保留在原 request_id 的输出中。
暂停的 Tokio 时钟验证长审批/后台任务不触发结束计时，两个官方任务终态形态均能解除跟踪并重新计时。
`cancelled_queued_decisions_and_disconnect_never_write_late_allowances` 单独拥有排队响应被撤销的竞态。
该 owner 使用记忆响应验证取消和断线清理，迟到的永久规则允许也不能写入。
这两个 seam 无法由 Action 转换纯函数证明，进入 extended-tests；最小命令为
`cargo test -p rovai-core --features extended-tests --lib claude_control::tests::`。
`claude::tests::native_permissions_do_not_block_stdout_or_replace_the_last_result` 拥有 reader 与控制通道
组合边界：未决审批期间普通文本仍可读取，早期 result 不截断后续输出，末轮结果和用量保留。
writer-only owner 无法覆盖该解析链路，使用 extended-tests 的内存 pipe，不创建进程或数据库；最小命令为
`cargo test -p rovai-core --features extended-tests --lib native_permissions_do_not_block_stdout`。
既有慢速 `action::tests::slow_tests::native_request_resolution_is_the_exact_authorization_delivery_ack`
扩展未决取消矩阵，验证 Codex/Claude 的审批失效由实际 Runtime actor 署名，复用其唯一 SQLite fixture。
该署名属于同一 native-resolution 事务，纯控制测试不能证明持久状态；最小命令为
`cargo test -p rovai-core --features slow-tests --lib native_request_resolution_is_the_exact_authorization_delivery_ack`。
既有 `claude::tests` 进程清理与 stdout owner 改为原生初始化/结构化输入夹具，保留原先的故障、取消、
多结果和私有文件清理边界。原 Hook/完整工具输入匹配测试随生产路径退出，Git 保留旧实现。
真实允许、拒绝、取消与 Core receipt 使用 `ROVAI_CLAUDE_APPROVAL_SMOKE=1 node scripts/smoke-claude-runtime.mjs`；
实际 Desktop 点击由 `node scripts/accept-claude-permission.mjs` 在独立 userData/Skill Library/MCP 下验证。
允许一次、拒绝之后追加原生记忆点击，核对隔离项目的 settings 只保存选中规则，再执行相同命令验证无新增
Approval 且有本轮 Core send receipt 和 exact message；记忆按钮、scope 与 CLI 版本随证据保存。
模型 Smoke 不进入普通 Rust 测试。旧 Hook Smoke 不作为原生协议通过记录。

目录协议与进程生命周期由共享 Core library 的 `health::claude_catalog_tests` owner 验证，正常门禁使用临时
可执行夹具，不启动真实模型。安装版手工验证使用显式 ignored 测试：

```bash
cargo test -p rovai-core --features extended-tests --lib health::claude_catalog_tests::claude_catalog_real_runtime_smoke -- --ignored --nocapture
```

执行前遵守 [本地隔离流程](local-workflow.md)，确认实际 Claude 可执行入口与继承的配置；该命令只发送
初始化控制请求，不发送用户消息。原生初始化 hook 可按 Runtime 配置执行，认证与 Provider 配置不改写。
测试输出仅含 Runtime 版本和模型条目，不输出完整初始化账户响应。此目录证据不替代生成类 smoke。

### 日常 commit 验证

```bash
pnpm typecheck
pnpm skills:test
pnpm skills:check
pnpm test
cargo test -p rovai-core --lib runtime_discovery::
```

Rust 示例对应 `runtime_discovery.rs`。局部修改直接用 Cargo 名称过滤运行相关 owner；涉及共享基础设施时
扩大范围。同一轮集成只由一个执行者运行完整回归，不在每个 worktree 重复执行。名称过滤减少执行项，
但同一个 library 测试目标仍需编译；要降低长期编译与进程开销，应合并等价 owner，而不是扩展路径解析器。

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

#### 兼容 Staged Rust 路由

`pnpm test:rust:staged` 读取 `git diff --cached`，只根据 staged 快照选择 Rust 验证范围：

| staged 改动 | 执行命令 |
| --- | --- |
| 无 Rust/Cargo 文件 | 跳过 Rust 验证并明确输出 skip 消息 |
| 仅 `crates/rovai-core/src/bin/rovai.rs` | `pnpm check:rust`、`pnpm test:rust:cli` |
| 仅普通 Library 模块 | `pnpm check:rust`、`pnpm test:rust:lib` |
| 仅 `rovai-core` Main 或其专属模块 | `pnpm check:rust`、`pnpm test:rust:core` |
| Cargo/Rust 配置、`src/lib.rs`、多 target、删除/重命名、未知 Rust 路径或分类失败 | `pnpm test:rust:workspace-default` |

`test:rust:core` 保留为共享 library 回归的兼容入口：应用运行层与 Runtime Adapter 单测已随库化迁入
library，薄 stdio main 不再重复编译这些测试。

Main 专属模块由 staged `src/main.rs` 声明、但未由 staged `src/lib.rs` 导出的模块动态确定。
脚本使用 NUL 分隔读取路径以支持空格等合法文件名；Git 读取、模块解析或分类失败都会 fail closed
到全量测试，不会静默跳过。该入口为既有调用方保留，不再作为日常默认：普通 Library 文件最终仍会
运行整个 Library，无法替代上面的模块级 Cargo 过滤，也不继续扩展源码解析规则。

`test:rust:workspace-default` 与 `test:rust:pr` 都运行 400 项 default-feature workspace；后者是 PR
集成入口。`test:rust:extended` 启用扩展 owner，`test:rust:full` 运行 all-features workspace，包含
`extended-tests`、`slow-tests` 与 `legacy-migration-tests`。显式范围为：

```bash
pnpm test:rust:workspace-default
pnpm test:rust:extended
pnpm test:rust:slow
pnpm test:rust:pr
pnpm test:rust:full
```

`test:rust:slow` 只用于定向诊断 slow owner，不再作为 `test:rust:pr` 的组成部分。

### PR 快速门禁与手动完整验证

```bash
cargo fmt --all --check
pnpm test:rust:pr
```

`.github/workflows/ci.yml` 在 pull request 时只启动一个 Ubuntu `gate` job。Rust 源码、Cargo 文件和
Rust 构建配置改动在自动门禁中执行：

```bash
cargo fmt --all --check
cargo check --workspace
```

自动 PR gate 不编译测试 target。默认 400 项由提交前的 `pnpm test:rust:pr` 承担；测试 target、
All-features Clippy、测试与 Windows x64 原生编译/验证只在手动
`.github/workflows/full-check.yml` 中执行；Linux 深度命令为：

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
pnpm test:rust:full
```

Windows Runtime 改动可用 `Full check` 的 `windows-runtime` scope 单独执行既有 Windows 原生 job，
其中 Fleet 回收凭据及 Codex 释放策略显式启用 `extended-tests`。该 runner 证据不替代实体 Windows 10/11、
真实 CLI 账号，或仍由 Unix/macOS 条件编译限定的 Codex/Core 集成测试。
既有 Managed Process 孙进程 owner 验证根进程退出后仍有活跃后代时继续阻塞，以及
`ActiveProcesses` 归零时直接放行；完成端口通知、累计计数与后代句柄不再是必需条件。
Fleet receipt owner 继续验证精确 Run/epoch 的持久化回执与跨 Core 恢复边界。

默认 fast suite 保留纯 parser/serde、确定性 policy、常量和最小原子 regression，并以 400 项作为当前
反馈预算。`extended-tests` 承担大型模块矩阵、SQLite、子进程、并发与跨边界 owner；`slow-tests`
承担需要完整 SQLite/Camp/Runtime fixture 的显式慢速场景，并隐式启用扩展层。每个数据库测试仍使用
独立 clone，不共享可写状态。

`legacy-migration-tests` 会隐式启用 `slow-tests`，只在手动 `Full check` 的全特性门禁中运行：

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

所有 feature-gated 测试因此都会在手动完整验证中编译并执行；`--all-features` 已包含 slow tests，
Full Check 不再用 `slow_tests::` 过滤器重复运行同一批数据库测试。历史兼容覆盖只是移出 PR 关键路径，
未被永久禁用。自动与手动 workflow 都使用 Cargo 缓存缩短重复构建，但测试是否通过不依赖缓存命中，
也不在 job 间传递可写 `target` 目录制造顺序依赖。需要验证桌面构建时另行运行：

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
同时检查首帧即显示不透明整窗品牌画布、就绪交接持续覆盖、未准入时没有权威请求、未知导航不显示空态。Main Window Session
延后冻结恢复目标与关闭窗口后的迟到读取由 `desktop-session.test.ts` 单独拥有。

夹具创建临时绝对 `userData`，不启动 Core/SQLite/Runtime，也不读取日常数据；它是生产组件组合测试，不冒充真实数据库
迁移端到端验收。默认删除本次夹具，`ROVAI_KEEP_STARTUP_PRESENTATION_FIXTURE=1` 可保留 Day/Night、最小窗口与
200%/reduced-motion 截图。手动 Full check 的 Linux job 通过 `xvfb-run -a pnpm test:startup-presentation` 执行。

Markdown 代码块复制运行 `pnpm test:markdown-code-copy`。先执行根目录 `pnpm install --frozen-lockfile` 和
`npm ci --prefix website`；使用本机 Chrome（可由 `ROVAI_TEST_CHROME` 指定）。夹具直接挂载生产会话、文件
预览与代码组件，并构建真实 VitePress 页面，在独立临时浏览器 profile 中验证剪贴板、键盘、失败恢复、
引用/查找排除、代码更新与页面导航时的异步竞争，以及双主题和窄屏。没有 Chrome 时明确 skip，不能视为通过。
可设置 `ROVAI_CODE_COPY_OUTPUT=/absolute/path` 保留截图与结果；此入口不启动 Electron、Core 或 Runtime。

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
验证显式 Markdown 短文件名定位、行范围高亮、inline-code/正文不生成文件入口、字段误识别及 URL 中文尾部恢复；
真实鼠标覆盖已有选区下的普通/带位置 Markdown 文件链接点击、链接内拖选不打开及其后的再次单击，键盘激活保持可用。
并逐帧检查打开/关闭、键盘调宽和持续拖动时
阅读锚点偏移不超过 2px；还覆盖用户滚动后的可见消息回退、底部跟随、紧凑模式返回，以及旧
`authorization_required` 结果不会调用目录选择器或泄露内部授权原因。宽度回归经过真实消息容器，覆盖宽屏断点、
预览开合与拖窄后的长代码和宽表格独立滚动，并挂载首页验证最近对话长标题、时间与状态在双主题和缩放下不撑宽页面。
相同环境变量可保留双主题截图
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

当前 Public Camp Composer 不再有 Core Draft 或未公开 Pending。`pnpm test:camp-open-projection` 的隔离
Electron 夹具验证 Camp-local 草稿在业务投影刷新和重挂载后保留，并确认页面没有私有 Pending 队列；
`camp-composer-local-store.test.ts` 验证续发目标只来自已接受的唯一非 Lead 路由，以及按 Camp 隔离、成功发送后
替换和无效快照拒绝。历史 `test:composer-continuation` 夹具依赖已退出的 Core Draft/Pending 接口，不能作为
当前发布门禁。

公共/单聊输入历史复用上述 CampOpen 与 `single-chat-panel` Electron 夹具的 `--input-history` 模式：
验证固定浏览列表、零历史请求、结构化预览、原草稿/Undo 保留、有效输入驱动发送及 pending 变化。
最小命令为
`node --test --test-concurrency=1 --test-name-pattern='input history' scripts/lib/camp-open-projection.test.mjs scripts/lib/single-chat-panel.test.mjs`。
`input-history.test.ts` 覆盖独立内容提取、筛选、固定数组、导航边界和退出恢复。
历史专用 Core 查询及两个 SQLite 测试随生产路径一起退役；消息读取与草稿保存继续由原 owner 覆盖。
退役依据和验证命令见[实施记录](../versions/v1.72/input-history-implementation.md#验证归属)。

### Core 可选功能启动回归

Headless Host 的进程准入与 Unix 受控停止使用 `pnpm test:host-startup`；精确边界见
[Host Lifecycle v1](../contracts/host-lifecycle-v1.md)。Windows console 停止另做原生验收；该测试不调用模型，
不代替完整 Headless 执行、审批或平台安全验证。

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
| `pnpm smoke:claude-runtime` | Claude Code | 验证原生权限、连续性和 Resume；两次无工具回复必须投影公开 narration；随后强制 `Bash` 固定 `printf`，断言公开 output、原生 tool-use ID 与同 Session/Conversation 关联。`ROVAI_CLAUDE_APPROVAL_SMOKE=1` 追加 `acceptEdits` 下真实 `rovai send` 允许一次、拒绝及待审批取消，核对 Action、Run 和消息效果 |
| `pnpm smoke:antigravity-runtime` | Antigravity + Codex | 要求 `output.stream_json`，强制原生 `run_command` 固定 `printf` 并断言公开 output/step ID；另覆盖同 Session 续接、私有日志清理和 Antigravity 到 Codex 换绑 |
| `pnpm smoke:pi-runtime` | Pi 0.84.4+ | 复制官方 Pi auth/settings/models 到临时 0700 `PI_CODING_AGENT_DIR`，隔离 Probe/Native Session/data/workspace；验证 exact cold resume、warm LRU、managed receipt、allow/deny、cancel 无副作用、Action output、locator 隐私与结构化 Usage。自动设置只在 debug Core 有效的 Pi qualification override；结果不是正式平台资格 |
| `pnpm smoke:action-approval` | Codex | 验证越界动作的 Approval 与唯一副作用 |
| `pnpm smoke:multi-agent` | Codex | 同一 CampTurn 的两个真实并发 AgentRun |
| `pnpm smoke:builtin-cli` | 当前可执行 Runtime；平台和 debug 限制以脚本准入为准 | 先导 Run 通过真实 `rovai` lease 产生普通 Public A2A 与附件，另一 Thread 的 Run 以自己的 lease 执行公开历史 search/read，核对消息 identity、附件和输出 Schema。Operation 集合由脚本 `expectedOperations` 维护；覆盖 Automation、Mission、Member、Task、Memory、Thread 及公开发送。另验证旧 send 输入拒绝、冲突 recovery、release fence、Replay 与后续 Run 新 lease；不存在 Gather capture 或 completion 验收。脚本仍覆盖旧 `camp` 输入别名，输出使用当前 Thread 字段。transport-independent indeterminate 由 CLI response-loss test 覆盖；Pi debug 结果不晋升正式资格 |
| `pnpm smoke:skills` | 历史受管 Skill Library 的 Codex 默认／十三 Runtime 矩阵 | 保留旧导入、Revision 与原投递路径的兼容验证；不作为 v1.70 原生 Skills／工具箱新路径通过证据。当前 UI 验收见[桌面 UI 验收](ui-acceptance.md)，模型上下文 Gate 见[评测](evaluation.md)；Cursor `.cursor/skills` 仍为 DocumentationOnly，Pi debug 结果不晋升正式资格 |
| `pnpm smoke:mcp` | Codex、Claude Code、OpenCode、Copilot；可选 CodeBuddy、Qwen Code | 默认前四种；保留 Runtime 原生配置并逐 Run 追加 MCP；OpenCode 默认使用 `opencode/mimo-v2.5-free` |
| `pnpm smoke:mcp-projection` | Codex、Claude Code、OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen Code、TRAE、Kimi、Grok | 通过真实 Core、Assignment、AgentRun Projection 与 ContextManifest 验证原生配置保留及 Adapter-specific 同名策略。Grok 使用私有进程 Plugin 并 `NativeWinsSkip`；Kimi 覆盖 stdio、Streamable HTTP 和第二个 stdio Server；默认十一种。Pi 的 External MCP 为 `Unsupported`，不属于本 smoke，保存的 Assignment 在 Pi dispatch 时静默忽略 |
| `pnpm smoke:memory-runtime` | Codex + Claude Code | 可只选一种；Claude 有 bounded model/budget 配置 |
| `pnpm smoke:recovery` | OpenCode 默认 | 可选择其他产品 Runtime；创建 Git fixture 并杀死 Core 验证恢复 |
| `pnpm smoke:missing-send-recovery` | 十三种可执行实现（含 Pi、Kimi、Grok）；Cursor Disabled | 每种 Runtime 使用独立临时 data-dir/Git workspace，真实执行 zero-send 与 accepted-send suppression；ACP 额外执行 tool→final 并生成独立协议 fixture，Pi 额外执行原生 Read Tool→final 并验证 `agent_settled` 专属终点与 Tool Activity。Pi 官方配置与 Session root 同样逐 Runtime 临时复制；debug pass 不晋升正式资格 |
| `pnpm accept:network-recovery` | Claude Code + OpenCode | macOS 普通交互式终端；使用同一隔离 Core generation 与隔离 Git workspace，先验证 Claude Code 的 `runtime_api_retrying` 原生自恢复，再验证 OpenCode ACP `not_accepted` terminal 由 Rovai 在新 epoch 接管并于 Input accepted 后清除恢复标记。脚本只提示操作者断开／恢复 Wi-Fi，不修改系统网络设置；失败时操作者必须手动恢复网络，fixture 与脱敏报告会保留 |
| `pnpm accept:planned-shutdown` | 当前平台正式 Runtime + packaged App | 在隔离 Git workspace/`userData` 中等待真实 input handoff 后退出，验证 5 秒目标、10 秒硬 deadline、400ms 关闭反馈门槛、无伪 terminal、进程 reap、重启 blocker、Run 取消审计与安全退出 modal 截图；运行前在 macOS 执行 `pnpm package:mac`，在 Windows x64 执行 `pnpm package:windows:x64` |
| `pnpm accept:onboarding-ui` | 本机首个可用正式 Runtime + packaged App | 不调用模型；用全新隔离 `userData` 验证三页断点、真实 provisioning、`初次集结`、Draft-only starter、重启与 `1040×700` 双主题截图 |
| `pnpm accept:bootstrap-shell-ui` | 无 Runtime；packaged App + 独立未知 authority / 崩溃恢复 fixture | 不调用模型；证明未知 authority 保留、业务树不挂载、显式重试不消耗 crash budget，并验证已保存英文在 Core 阻断时恢复；另在真实 Core 写事务产生 WAL 后强杀该隔离子进程，验证结构化失败字段、自动恢复已提交数据和工作区重挂载；覆盖双主题、窄窗口、200% 等效布局与 reduced motion 截图 |

仅验证启动与故障壳层时可设 `ROVAI_BOOTSTRAP_ACCEPT_SCOPE=bootstrap`；默认 `all` 仍执行崩溃恢复与可选子系统场景。

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
| `ROVAI_NETWORK_RECOVERY_ACCEPT_FIXTURE_ROOT` | Network Recovery 验收的显式隔离 data/workspace root |
| `ROVAI_NETWORK_RECOVERY_ACCEPT_OUTPUT_DIR` | Network Recovery 验收的脱敏 JSON 报告目录 |
| `ROVAI_KEEP_NETWORK_RECOVERY_FIXTURE=1` | 成功后保留 Network Recovery 隔离 fixture；失败 fixture 总是保留以供诊断 |
| `ROVAI_PLANNED_SHUTDOWN_ACCEPT_FIXTURE_ROOT` | Planned Shutdown 验收的显式隔离 fixture root |
| `ROVAI_PLANNED_SHUTDOWN_ACCEPT_OUTPUT_DIR` | Planned Shutdown JSON report 与四张截图输出目录 |
| `ROVAI_KEEP_PLANNED_SHUTDOWN_FIXTURE=1` | 成功后保留 Planned Shutdown 隔离 fixture |
| `ROVAI_ONBOARDING_ACCEPT_FIXTURE_ROOT` | 首次训练验收的显式隔离 fixture root |
| `ROVAI_ONBOARDING_ACCEPT_OUTPUT_DIR` | 首次训练验收 JSON report 与截图输出目录 |
| `ROVAI_RUNTIME_PICKER_FIXTURE` | 模型选择器 Electron 验收的显式隔离临时目录 |
| `ROVAI_KEEP_RUNTIME_PICKER_FIXTURE=1` | 保留模型选择器验收截图与临时目录 |
| `ROVAI_KEEP_SMOKE_FIXTURE=1` | 保留 intake fixture 供排查 |

脚本支持的精确值、默认值和额外模型变量以脚本源码为准。新增 selector 时应在同一改动
中更新本表。

## UI 验收命令

`pnpm test:execution-metrics-ui` 复用 ThreadWorkspace 的隔离 Renderer fixture，独立验证当前指标的
500 Run 范围读取、可见收起卡片、滚动与展开、面板／页面隐藏、恢复速度基线、有限终态尾读后的
迟到用量，以及当前 Context 整体换代和删除；夹具数值不是 Runtime 能力证据。
`ROVAI_KEEP_EXECUTION_METRICS_FIXTURE=1` 保留报告与双主题截图；默认清理本次临时目录。
最低层 `execution-metrics-reader.test.ts` 拥有确定性时钟、single-flight／trailing、有限重试、引用复用和
旧代次响应隔离；不通过重复真实网络调用验证刷新次数。

批量 SQL 新增 `monitoring::tests::execution_usage_batch_keeps_requested_scope_collection_and_sparse_fields`：
该读接口此前没有独立 SQL owner；原有 Context 写入与 Usage 累计测试不拥有请求范围或 collection 过滤。
一次内存 SQLite 最小表验证跨 Camp／旧 collection 拒绝、指定顺序、空范围、缺失与零、参数化查询及
终态 batch 通知资格（活动／missing／空范围不命中）；
不建立完整 Database、迁移或 Runtime fixture。原实现逐 Run 查询的数值结果一致，新增失败语义是批量读取
改变范围或稀疏语义。最小命令为 `cargo test -p rovai-core --lib execution_usage_batch_keeps_requested_scope`。

`pnpm test:runtime-model-picker` 在隔离 Electron 中挂载生产模型、推理强度、权限与运行时选择组件，
验证队员页和训练营共享字段的默认值、本地搜索、中文输入法、键盘与焦点、目录失败/迟到响应和双主题布局。
覆盖 1040×700、1440×920、2560×1440 与 200% 缩放。它属于 `test:desktop:integration`；Linux 使用 `xvfb-run -a`。
不启动 Core、Skill Library 或 Runtime。`ROVAI_KEEP_RUNTIME_PICKER_FIXTURE=1` 保留截图；
`ROVAI_RUNTIME_PICKER_FIXTURE` 可指定已存在、位于系统临时目录下且以 `rovai-runtime-picker-` 开头的独立绝对路径。

`pnpm test:notification-attention` 在隔离 Electron 中挂载生产通知 Controller 与 CSS，验证当前公屏 / 精确
单聊的完成静默、抑制不等于已读、原始来源点击、单卡与手动队列、前后台收敛，以及悬停 / 焦点暂停剩余
时间。`ROVAI_KEEP_NOTIFICATION_FIXTURE=1` 保留双主题截图。`pnpm test:single-chat-pending` 已纳入
`test:desktop:integration`，验证私有待发送撤回的回执恢复、导航围栏与命令重放；
`node --test scripts/lib/single-chat-panel.test.mjs` 的既有 owner 另验证原 Conversation / Run 定位、结束来源明确失败且不创建后继对话。两者使用临时绝对 userData 和
封闭 RPC 投影，不启动 Core、Runtime 或日常 App，不代替真实模型 Smoke。

`pnpm test:approval-dock` 使用生产 ApprovalDock/CSS 的独立 Electron fixture，验证原生顺序、标签与
决定身份，翻页边界与摘要焦点、普通刷新不抢焦点、Reason 精确去重/按审批隔离及无重渲染的容器宽度变化，
并覆盖双主题、最小窗口与 420px 会话列。临时 `userData` 与日常 App 隔离，不启动 Core 或 Runtime；
`ROVAI_KEEP_APPROVAL_FIXTURE=1` 保留截图，默认清理。手动 Full check 的 Linux job 使用 `xvfb-run -a`。

`pnpm test:camp-fast-layout` 使用生产 CampWorkspace/CSS 的独立 Electron fixture，无需打包或 Core。
关闭的模拟 API 只提供成员偏好与 Draft；临时 userData 与日常 App 完全分离，不调用模型。
它拥有 Fast 的 1280×720/窄屏/大屏布局、日夜主题、键盘焦点、失败保留、直接静默切换、旧观测不影响偏好与初始默认。
同一 owner 验证打开/切换零资格请求、三态保存、同成员保存去重、跨成员并发、绑定与迟到回执隔离；
Claude/Codex 无历史证据仍有入口，其他 Runtime 不显示，原生反馈在 Run 中展示且不反写偏好。
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

侧栏可见窗口可独立运行 `ROVAI_SIDEBAR_ACCEPT_SCOPE=navigation-windows pnpm accept:sidebar-ui`。
它复用同一隔离 packaged App/Core fixture，覆盖 5 → 15 条、收起重开、第八条改名/删除补位、快速对话、
项目置顶迁移、重启及双主题小窗口；等待 Core ready 并明确模拟前台。默认 `all` 保留完整菜单/设置/确认
Dialog 验收，专项结果不能替代默认全套结果。

`accept:v0.16`、`accept:v0.17` 等带版本号的聚合命令属于历史版本验收入口，不是常青
日常门禁。其精确断言、Migration 版本和证据应从对应版本实施文档或测试源码读取。

## 隔离与副作用

### 主动检查的环境刷新

当前语义由 [Runtime Launch v73](../contracts/runtime-launch-and-verification-v73.md) 拥有。
`runtime_check_refresh_tests` 是 macOS/Windows Check Manager、保存 CAS、正式状态与草稿隔离的集成 owner：使用可注入的
基础环境读取器、UUID 临时目录、私有 SQLite 和合成程序，不读取真实 Runtime 安装或账号。
它覆盖旧入口仍存在时主动检查刷新 PATH、未变输入不推进代次及独立检查继续执行、目录变化、原路径升级、
指定路径失效不回退、进程 PATH 不参与主程序选择、草稿/恢复自动不发布、
保存及新请求与旧探测交错、环境读取失败不沿用缓存。程序替换继续复用既有 identity-checked probe owner。
恢复自动的回归在基础查找目录变化后预览并保存，直接断言保存后的正式路径与版本，不追加正式检查；
同时验证其他 Runtime 设置保留、CAS 拒绝和环境读取失败不发布、同配置重试幂等。
这些跨 manager/数据库的断言不能降为单独的发现函数测试；不新增第二套协议模拟或真实模型 Smoke。
Issue #891 扩展上述 owner，旧“只有显式重扫才采集”断言随合同替换，保留配置保存、并发与过期结果案例。
既有 shell capture owner 同时验证交互式登录参数、启动噪声、含空格 PATH、失败与超时清理；Rust 测试函数净增零。

```bash
cargo test -p rovai-core --lib --features slow-tests runtime_check_environment::tests
pnpm exec vitest run apps/desktop/src/renderer/src/runtime-check.test.ts
pnpm test:settings-workspace
```

Renderer 复用生产设置组件和既有隔离 Electron fixture，增加恢复自动、失败预览及离开后迟到结果检查。
测试中的 `userData` 与 Skill Library 均属于临时夹具，不启动真实 Core 或 Runtime。

### 通用隔离规则

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

## HTML 预览 HTTP 链路

`pnpm test:html-preview` 使用共享 HTTP 核心、正式 FilePreviewProvider/Pane、桌面文件能力适配和普通 Chrome
分别验证 History 初始化、query 内部画布、依赖加载及错误诊断。服务路径和访问矩阵由 `packages/html-preview`
Vitest owner 负责，窗口/代际释放由 Main 既有 service owner 负责，文件布局与查找继续归 `test:file-preview-layout`。

所有浏览器使用临时绝对 userData/profile，Electron 不启动 Core、Runtime 或日常 Skill Library。
`ROVAI_TEST_CHROME` 指定普通 Chrome 路径；缺失时该项标记未运行，不能宣称跨端验收已通过。
`ROVAI_HTML_HISTORY_SAMPLE` 和 `ROVAI_HTML_CANVAS_SAMPLE` 可提供两份独立原稿，测试仅复制、核验摘要并验证实际正文与
子画布联动；`ROVAI_KEEP_HTML_PREVIEW_FIXTURE=1` 保留临时资源和截图。详见
[v1.58 记录](../versions/v1.58/html-preview-http.md)。

### Web 标签页恢复

续期的时间边界由 `rovai-web::auth` 既有生命周期 owner 和 `apps/web/src/client.test.ts` 使用可控时钟验证，
不等待 30 天，也不提供生产调时接口。`authentication_reopen_preserves_renewals_and_never_resurrects_revocation`
拥有私有认证文件的写失败、重开和撤销竞争；最小命令为 `cargo test -p rovai-web --lib auth::tests`。
真实 Desktop Host/Server 重启扩展既有 HTTP/entry 测试，浏览器进程重开与双标签页由恢复 smoke 验证。

`apps/web/src/client.test.ts` 拥有 Bearer/proof 恢复、复制材料 fork、过期重登及原命令恢复；`navigation-history.test.ts` 拥有浏览器历史适配的拒绝、刷新与跨 Desktop 上限的浏览器历史。现有 `host-web.test.mjs` 扩展真实 HTTP resume/fork 归属校验，现有 Rust Session 生命周期测试扩展 fork 继承到期时间、独立撤销与撤销后拒绝，不另建 SQLite fixture。

构建 Host 与 Web 后，`node scripts/smoke-web-recovery.mjs` 运行真实 Host/生产 Web/隔离 Chrome 验收；只使用独立数据和默认队员，不调用模型。

入口通过一次性 fragment 票据自动登录，检查立即清理地址、StrictMode 仅兑换一次、票据不进入恢复存储，以及刷新后原身份和草稿、复制标签页隔离；
场景并行利用票据有效窗口后等待真实 120 秒到期并核对拒绝，整个 smoke 至少约两分钟。输出位置可用 `ROVAI_RECOVERY_OUTPUT` 指定。
票据过期、替换、关闭／轮换和消费竞争的确定性输入矩阵扩展 Rust `auth` 的既有 Session 生命周期 owner，不新增 Core fixture。

默认队伍回归由 `apps/web/src/preferences.test.ts` 覆盖浏览器本地旧值不遮蔽 Host、保存合并与迟到失效请求；
既有 `scripts/lib/host-web.test.mjs` owner 覆盖本机/HTTP 双入口、一次性导入、并发字段保留、重启及损坏记录。
`pnpm package:mac:daily` 后，`node scripts/smoke-web-preferences.mjs <输出目录>` 验证实际 Main 的旧偏好导入、
Web 通用设置回显、跨端保存、创建弹窗默认勾选、一键 Pending 创建和刷新。脚本创建独立 userData/Skill/MCP 与 Chrome profile；
仅 Runtime 可用性使用浏览器响应夹具，以免触发真实模型或修改用户 Runtime 配置。持久设置与 Camp 创建仍走实际包内 Host。
截图通过正式主题选择控件切换日夜，并验证新建按钮中性色。该证据不代替真实 Runtime、Windows 或第二实体设备验收。

真实 HTTP owner 验证本机签发与 HTTP 兑换接线、双客户端竞争、旧票据撤销，以及公共操作不能签发票据。
Windows 平台实测独立记录，不能由此 macOS 浏览器结果推断。


### Weekly 无时间上限

`automation::tests::owner_time_limit_is_frozen_per_occurrence_and_unbounded_runs_still_recover` 拥有 Owner 配置、
冻结 occurrence、Core 时间到期与重启收口的跨模块持久化边界。修复前显式空时限无法配置且执行会被一小时
截止；既有普通 Automation owner 没有时间策略切换。两个策略共享同一个隔离数据库，以显式未来时间验证，
不启动 Runtime、不等待真实时长。最小命令：`cargo test -p rovai-core --lib owner_time_limit_is_frozen_per_occurrence`。
其余输入矩阵扩展现有 execution_budget、Qualification 和 Host owner；不建立平行数据库 fixture。


`db::tests::automation_time_limit_migration_preserves_definitions_and_rolls_back_with_its_receipt` 使用现有快速 schema
夹具构造真实 schema 104 来源，验证新列与 receipt 同事务回滚、定义版本/Prompt/计划不变以及默认一小时。
该边界需要 SQLite DDL 与准入记录，纯函数或无关历史迁移不能覆盖。最小命令：
`cargo test -p rovai-core --features extended-tests --lib automation_time_limit_migration`；原有来源矩阵继续保留全部旧输入。


既有 `team_tool::tests::public_send_atomically_persists_one_message_and_canonical_deliveries` 扩展为有限/无限
两种时间策略矩阵，保留全部原断言；证明 NULL 截止时间仍可登记、派发 A2A 并幂等重放，而不是只检查计时常量。


### 原路径 Agent 附件（v1.59）

新增 `db::attachment_paths::tests::attachment_path_schema_and_receipt_commit_atomically` 拥有 schema 105→106
的 SQLite DDL/迁移回执原子边界；注入最后回执写入失败时，表重建和版本号必须一起回滚，重试成功后拒绝
仅保留同名空触发器的半成品 schema。该失败不属于旧 v155 Automation 迁移；需要真实 SQLite transaction，
纯函数无法证明 DDL 回滚。最小命令：`cargo test -p rovai-core --features extended-tests --lib attachment_path_schema_and_receipt`。
原有受支持来源、冻结 ContextManifest 和 FK 迁移测试全部保留，升级链补接 v156。

删除 CLI `send_attachments` 的 7 个 active tests，随同删除的生产模块一起退出：
`body_only_and_empty_files_do_not_require_attachment_roots`、
`mixed_sources_keep_order_names_and_frozen_bytes_until_transport_finishes`、
`invalid_sources_and_promotion_collision_publish_nothing_and_cleanup_owned_staging`、
`quota_includes_internal_sources_but_directory_limit_is_not_per_file_limit`、
`original_links_special_files_and_import_parent_redirects_are_rejected`、
`ipc_failure_cleans_unsent_snapshots_but_retains_unconfirmed_dispatches`、
`ipc_retry_reuses_snapshot_when_original_source_has_disappeared`。
这些断言拥有已取消的 CLI 冻结/导入/清理合同；新发布允许源链接并不创建链接，目录也不再递归扫描以执行快照大小限额。
传输结果不确定、同一内部请求重放、大小受限 IPC 与当前 lease 仍由 CLI transport 和 Core invocation 的既有 owner 保留。

改写既有 `team_tool::tests::attachment_send_keeps_source_path_and_dispatches_without_projection_gate`，
覆盖工作区、外部只读源、Run 临时源、默认输出、目录、跨 Camp 原路径、替换保存及源消失后内部重放；
扩展既有 Camp 删除 journal、Pi 当前图片、Desktop file preview、Host HTTP/Chrome HTML 和临时实例清理 owner。
定向验证：`cargo test -p rovai-core --features extended-tests --lib attachment_send_keeps_source_path`、
`cargo test -p rovai-core --bin rovai`、`node --test scripts/lib/host-web-html.test.mjs scripts/lib/host-web.test.mjs`；
完整 Core library 与 Context slow suite 继续执行，不用删除旧迁移测试换取通过。

## 原生执行指标 Runtime 验收

2026-10-03 遗漏字段修复沿用 `monitoring::tests::runtime_parsers_emit_sparse_usage_without_antigravity_inference`
和 `zcode::transport::tests::provider_failure_reaches_core_without_poisoning_the_host` owner：前者增加
DSH 原生精确 total 与缺失/矛盾分类，后者增加数值 Context、Session 栅栏与终态投递顺序。
没有新增或退役 Rust owner；最低命令为对应完整测试名的 `cargo test -p rovai-core --features extended-tests --lib`。
`node --test scripts/lib/dsh-host.test.mjs` 继续验证 bootstrap 的数值白名单和内容隔离。
实测报告必须独立列出字段可用性，不能用 null/null 的对照通过替代采集完整性。

`node scripts/probe-runtime-execution-metrics.mjs <runtime-kind>` 创建独立 Core、bundled CLI、data-dir、
Skill Library、MCP 和工作区，执行包含只读工具调用的原生用量／上下文任务，最长观察 8 分钟。
探针只保存原生字段形态、匿名身份、Token／Gauge 数值、观测时刻及持久化读回，不采集字符数量、
速度、正文、思考正文或内容哈希；`rendererVerified` 固定为 false，不能作为界面验收。

可选环境变量使用 `ROVAI_METRICS_` 前缀：`CORE` 指定 Core，`MODEL`／`MODEL_OPTIONS` 选择模型，
`PROMPT_FILE` 指定任务，`THINKING_LEVEL` 配置隔离 Pi／DSH 思考级别，`NATIVE_HOME` 只复制 Grok／DSH
必要配置到私有夹具，Kimi `SUB2API=1` 使用已授权 Provider 配置。`RESUME=1` 在健康首 Run 后复用同一
Native Session 再执行一轮；`COLD_RESTART=1` 先关闭隔离 Core，再读回并核对持久化与同一绑定。
`GROK_COMPACT_AFTER_RESTART=1` 与 Grok 冷恢复一起验证原生压缩。日常 Runtime 配置保持只读。
证据导出只选 `evidence.json` 和 `native-shapes.jsonl`，不能打包含凭据的整个 fixture。

打包 App 的可重复入口：

```bash
ROVAI_RUNTIME_ACTIVITY_ACCEPT_METRICS_STREAM_ONLY=1 node scripts/accept-runtime-activity-ui.mjs <packaged-app>
ROVAI_RUNTIME_ACTIVITY_ACCEPT_METRICS_REAL=1 node scripts/accept-runtime-activity-ui.mjs <packaged-app>
```

第一项用合成 ACP 流验证途中打开、切历史 Run、运行耗时、终态、迟到 Usage 和私有标记不进入
数据库、Blob、文件、公开 IPC 或 Renderer。第二项使用 `scripts/fixtures/native-execution-metrics-task.txt`，
可以用 `ROVAI_METRICS_PROMPT_FILE` 覆盖任务，`ROVAI_METRICS_RUNTIME` 选择 Runtime，
`ROVAI_METRICS_VERIFY_USAGE=1` 核对落盘四项与气泡，`ROVAI_METRICS_VERIFY_CONTEXT=1` 核对
已证实的 Session 数值与圆环／气泡。两者均隔离 App/Core，CDP 请求有 30 秒超时，不结束日常 App。
`ROVAI_METRICS_VERIFY_LIVE_CONTEXT=1` 额外要求新 Run 仍在 running 时，当前 Session 的非零 used
已落盘且与 Renderer 气泡一致；取值 `used-only` 还要求 window/nativeRatio 保持 null、比例显示未知。
可搭配 `scripts/fixtures/native-live-context-task.txt` 的独立顺序工具调用与停顿；终态成功不能替代
运行中证据。仅启用该验收选项时增加测试端的范围读取，不改变产品轮询。
重启验收使用原隔离 fixture，核对 `monitoring.execution` 的四项／Session modelKey／代次，
不重新调用模型或修改数据库。原生字段历史证据见[原生 Usage 与 Context 核验](../research/runtime-monitoring/native-usage-context-verification-2026-09-30.md)。

### 测速退役与保留的测试（2026-10-02）

所有 Runtime 的测速生产路径和临时协议一并退出。删除 `observable_output::tests` 的 3 个分类／计数／
去重测试、Web 数值快照白名单测试，以及 `execution-token-speed.test.ts` 的 5 个显示状态机测试；
这些合同无 successor，由 Git 历史保留。Claude owner 改为验证私有思考身份和完整块／子 Agent 排除，
移除仅为测速维护的 UTF-16 游标。Codex ingress 保留当前 turn／旧 turn 栅栏，移除测速 receipt 断言。
共享根身份检查移入 `runtime::is_root_output`，原有 ACP、Pi、ZCode 与原生 Usage owner 继续覆盖其边界。

原生 Usage／Context、迁移、恢复、权限和内容隔离测试继续执行。`pnpm test:execution-metrics-ui` 保留
隐藏暂停、恢复刷新、500 Run 范围收敛、稳定终态和迟到用量测试；打包 App 混合验收移除测速断言，
继续检查四项用量与思考内容不扩散。最低验证命令为 `pnpm typecheck`、`pnpm test:execution-metrics-ui`、
`pnpm test:rust:pr` 和以下原生 owner 的定向命令。历史测速脚本／环境变量仅适用于 `ee444ab1` 及此前记录。

### 原生 Usage／Context 测试准入（2026-09-30）

2026-10-04 可用性收口继续扩展现有 owner，没有新增/删除/合并/停用 Rust 测试：

- `session_context_rejects_late_observations_after_binding_rotation`：最小 SQLite 拥有未确认输入、绑定/epoch、实际模型及冻结模型配置、窗口省略/撤销/矛盾、下降/新鲜度的持久化边界。
- `provider_failure_reaches_core_without_poisoning_the_host`：现有 ZCode 双工 RPC owner 暂扣 prompt 最终响应与第一次读取；20 次重复触发只产生一次合并补读，单请求在途、至少两次 Context 在终态前到达 Core，终态旧请求参数不变。
- Pi `numeric_context_rejects_content_and_stale_run_host_session_or_binding`、Antigravity `native_database_supplements_only_the_current_completed_call` 和 native_usage 既有 owner：独立字段不因缺少分母丢失；显式零窗口交给 latest 层撤下分母，不能继承成旧窗口。
- `call_normalization_and_request_counts_do_not_depend_on_flush_partition` 保持每调用归一化、未知/零和完整性不受 Context 改动影响。

最低命令为 `pnpm test:rust:pr`，以及 `cargo test -p rovai-core --features extended-tests --lib <owner>`；
`pnpm test:execution-metrics-ui` 验证隐藏暂停、范围读取、稳定引用和迟到结果，新增时间戳单独变化的引用复用断言。
打包 App 真实验收使用上述 `METRICS_REAL` 入口；`ROVAI_METRICS_VERIFY_WINDOW_REUSE=1` 在同一 Session 执行两轮，
`ROVAI_METRICS_MIN_LIVE_UPDATES=2` 强制不同占用至少两次在终态前显示。`ROVAI_METRICS_HELD_FINAL=1` 显式切为
受控 ACP（不能标成真实 Qwen 样本），验证 prepared 输入、used-only、下降和返回旧数值；
`ROVAI_METRICS_VERIFY_VISIBILITY=1` 隐藏执行面板 5 秒后重新读取当前值。
`ROVAI_INTERNAL_CONTEXT_ACCEPTANCE_TRACE=1` 仅与隔离实例标记同时存在时输出固定数字/身份/时间白名单，
记录事务提交和 ZCode snapshot 次数/耗时；默认关闭，不输出 payload、正文、思考或原始错误。
脚本报告明确区分原生数值返回、Core 收到、提交后时刻、首次数据库读回和 Renderer 采样时间。

2026-10-03 Claude 运行中 Context 修复扩展既有
`root_call_usage_is_numeric_and_context_pairs_latest_call_with_its_model`：完整根调用在 result 前即
发出 used-only，覆盖稀疏字段补齐、显式零、子调用/起始暂定值排除与模型窗口不拼接。
既有 `session_context_rejects_late_observations_after_binding_rotation` 增加 Claude 数值事件→parser→
最小 SQLite 的 used-only 读回与原生用量隔离。修复前首个用例缺少运行中 Gauge；持久化用例守住
下游边界，不另建数据库/进程 owner。没有新增、删除、合并或停用 Rust 测试。

新增 owner 均不调用真实模型；没有删除、合并或停用现有 Rust 测试。

| Owner | 修复前失败输入、单一职责与层级 |
| --- | --- |
| `native_usage::tests::native_dialects_select_root_calls_preserve_missing_and_ignore_restated_content` | CodeBuddy／Kimi 的私有 envelope 不被 ACP parser 读取；该纯 DTO owner 拥有根身份、互斥桶、缺失／零、重述排除和真实脱敏帧回放，不能扩展 ACP wire owner 来证明不同来源 |
| `native_usage::tests::native_cursor_excludes_history_replays_partial_lines_and_file_resets` | 历史行、重复调用、半行、截断／替换或终态之后 75ms 的新 step 可能被错认或漏读；文件 cursor seam 需要最小临时文件与尾写线程，归入 `extended-tests`，纯 DTO 无法证明读取顺序 |
| `native_usage::tests::opencode_metadata_excludes_old_pending_child_and_repeated_calls` | ACP 终态只有最后调用，历史 pending 完成和子 Session 也不能归属本 Run；使用最小三字段 Session／四字段 Message SQLite fixture，归入 `extended-tests`，不创建完整 Core 数据库；回放实际数字并检查重复 poll |
| `claude::tests::root_call_usage_is_numeric_and_context_pairs_latest_call_with_its_model` | 起始暂定零或整轮 result 会代替最新调用，且多模型可能拼错窗口；纯 stream state owner 不建立进程，已有公开正文／思考 owner 不拥有私有数值事件；沿用该模块的 `extended-tests` 路由 |
| `pi::host::tests::numeric_context_rejects_content_and_stale_run_host_session_or_binding` | 旧 Host／Run／Session／绑定或额外内容字段可能穿过私有 status，校验后重新读取 owner 还可能在交接时错贴新 Run；纯封闭 DTO 与 fence owner 同时检查 packet 保留已校验的 Run／epoch／Session／prompt／delivery，现有 session locator owner 不拥有这个新 status 通道；沿用该模块的 `extended-tests` 路由 |

既有 `monitoring` checkpoint／parser owner 扩展 Claude 首调用累计计入、终态不重加、Pi Gauge 与 Kimi
版本准入；既有 `grouped_acp_models` owner 扩展 CodeBuddy 原生已选 API 模型别名。它们沿用原 fixture。
本地最低命令：

```bash
cargo test -p rovai-core --features extended-tests --lib native_usage::tests::
cargo test -p rovai-core --features extended-tests --lib monitoring::tests::
cargo test -p rovai-core --features extended-tests --lib root_call_usage_is_numeric_and_context_pairs_latest_call_with_its_model
cargo test -p rovai-core --features extended-tests --lib numeric_context_rejects_content_and_stale_run_host_session_or_binding
cargo test -p rovai-core --features extended-tests --lib grouped_acp_models
```

2026-10-01 继续扩展上述 native DTO／cursor／OpenCode owner：Qoder 自定义来源、隐藏用量、
比例独立性、旧 pending、重复与半行使用同一文件 seam；OpenCode 增加最新调用占用，不猜窗口。
既有 `runtime_parsers_emit_sparse_usage_without_antigravity_inference` 增加实际版本 banner、
Copilot 逐调用／子 Agent／dataOmitted／缺失与终态累计排除，以及 Grok 独立 Context 来源。
`session_context_rejects_late_observations_after_binding_rotation` 以最小表覆盖比例零／无效值、
数量清空、输入确认前只保留最新 Gauge、确认后的同源重试和拒绝输入；它不放宽接受栅栏。
既有 `session_context_migration_upgrades_schema_127_and_rolls_back_atomically` 同时拥有
已安装 schema 128 → 129 的保留与 179 收据失败回滚。Grok 原生配置 owner 只扩展显式窗口和
未知模型断言。未新增、删除、合并或停用 Rust owner；实际 App／字段证据见
[本轮核验](../research/runtime-monitoring/native-context-ratio-verification-2026-10-01.md)。

同日追加的边界验收继续扩展既有 owner：`codex_context_changes_independently_of_cumulative_run_usage`
回放真实压缩时累计值不变而 last 占用下降的两帧，并重复第二帧，断言独立来源去重与较小 Context；
原生 DTO／OpenCode SQLite／ACP parser owner 分别回放 9 个 Qoder 调用（真实与受控正值有明确标签）、
11 个 OpenCode 调用及 Grok 两个终态聚合。原始形态、归一化数字和最终读取同时保留；
没有新增、删除、合并或停用 Rust owner，亦未为真实网络请求添加单元测试。
真实原生压缩、四类健康冷恢复、同次 Grok 思考 UI 与 App 重开见[边界证据](../research/runtime-monitoring/native-boundaries-verification-2026-10-01.md)。


2026-10-02 合入 Thread 更名时，扩展既有
`db::thread_names::tests::thread_upgrade_preserves_existing_tables_and_rolls_back_on_receipt_failure`
owner，覆盖已安装指标 schema 129 和 main Thread schema 128 两条路径、179/180 收据失败回滚、
冻结 Context 摘要及收据保留、重开后 schema 130 准入。该 owner 使用独立 SQLite 目录及
`fresh_schema_database_at`，沿用 `extended-tests`；不新增 Rust owner。既有 Session Context 迁移
owner 继续拥有指标数量保留与 127/128 升级；默认 workspace 与字段级回归另行执行。
最低命令：`cargo test -p rovai-core --features extended-tests --lib thread_upgrade_preserves_existing_tables_and_rolls_back_on_receipt_failure`。

## Command Code 官方 ACP 增量（2026-10-05）

合并后的 catalog migration owner 同时保留 Migration 184/schema 133 和 185/schema 134 的来源、行数、
故障回滚及重开断言，没有退役旧边界。Tool、Usage、权限、MCP 名称和平台 case 扩展已有最低层 owner。
新增 ignored `isolated_command_code_acp_bootstrap_gate_and_resident_sessions` 拥有真实官方 Mod 在 initialize
前加载、同 PID A→B→A 控制 RPC 与缺失绑定结束真实 Host 的跨进程边界；fixture 无法证明原生可选 Mod
执行位置。它要求显式隔离 Home/可执行文件，不默认联网调用模型。`scripts/lib/command-code-bootstrap.test.mjs`
拥有 Node hook 的 A/B 绑定及缺失/摘要/预算负例，已纳入 `pnpm test`。


真实 App 拒绝审批暴露 Cline 在执行前只发送 `tool_call_update.pending → failed`，缺少 `tool_call` 时
原配对器会退出读取，Run 停在 waiting。新增最低层纯状态 owner
`acp::tests::paired_tools_accept_permission_only_denial_without_crossing_session_or_prompt`：拥有权限提案的
稀疏失败、原生重复失败、权限通知不提前生成审计结果、后续 completed/result 仍保留拒绝结果，以及相同 Tool ID 在不同
Session/Prompt 的隔离；成功但没有初始输入仍拒绝。
现有 completion/路径 owner 没有配对状态，不能证明此回归；该测试不启动数据库或进程，沿用 ACP 的
`extended-tests` 路由。最小命令：`cargo test -p rovai-core --features extended-tests --lib paired_tools_accept_permission_only_denial_without_crossing_session_or_prompt`。

Run 权限刷新扩展既有 `kimi_completed_run_keeps_the_warm_session_and_idle_compaction_observer`：
第二轮冻结 mode 改为 plan，仍断言同 Host/Session，并直接核对原生 RPC 先 default 后 plan。
Cline/Command Code 同样将动态配置移到 AcpRuntime，不再由 Host 保存旧值；两者的模式切换及执行行为
由隔离 packaged App 真实验证。未新增平行进程 fixture。

## ACP leader 退出与继承管道（2026-10-05）

新增 extended owner `acp::tests::leader_exit_reaps_inherited_pipes_and_preserves_buffered_response`。
真实 Cline/Command Code SIGKILL 验收复现 leader 已死但子进程持有 stdout，原 reader 不产生 EOF，
Command 延迟写入且 Run 留在 waiting。现有 client-terminal cancel owner 不经过 Runtime 原生子进程，
无法覆盖该失败。最小真实进程 fixture 验证非零强杀清理、pending RPC 失败、精确一次退出通知，
同时保留退出前已写入管道的权威 response；不使用数据库或网络。定向命令：
`cargo test -p rovai-core --features extended-tests --lib leader_exit_reaps_inherited_pipes_and_preserves_buffered_response`。

另以 `managed_process::macos::tests` 最小真实进程 owner 覆盖 macOS detached 子进程，
验证 kernel PID version 拒绝替代身份，以及私有 ledger 在原 owner 消失后的回收和重复恢复。
只用有界 sleep/标记文件，无数据库或模型；进程组内 fixture 无法证明 setsid 后代与 Core 重启路径。

既有 `runtime::tests::startup_recovery_terminalizes_an_accepted_unknown_input_without_a_waiting_blocker`
扩展 accepted / delivery_unknown / 已 dispatch 的 prepared 三种输入，并分别经过重启和同 Core Runtime loss。
沿用最小数据库 owner，验证失败、未确认 cleanup、原输入保留、Delivery 收口与重复恢复不再处理，
并断言完整公开快照仍为 failed、无旧恢复操作，避免 cleanup 记账被误投影为用户取消；不新增平行 DB fixture。
最小命令：`cargo test -p rovai-core --features extended-tests --lib startup_recovery_terminalizes_an_accepted_unknown_input_without_a_waiting_blocker`。

两项既有 slow `action::tests::slow_tests::runtime_loss_*` 保留审批取消、未执行/unknown、attempt 与 delivery 的
全部断言，将过时的永久 waiting 预期对齐 v6 的失败终态，并追加 cleanup 仍未确认的断言；未删除或降低覆盖。
与主干真实 Host-loss 边界合并后，两项 fixture 显式记录原生工具执行前已 accepted 的输入；复用从
runtime owner 移到 test_support 的同一最小输入 helper，不复制数据库场景。恢复 owner 另验证失败清理
不会命中旧用户取消的公开投影，保留 unknown input 不重放与旧 epoch fence。

既有 ignored 原生 owner `isolated_command_code_acp_bootstrap_gate_and_resident_sessions` 增加不存在完整 ID
和截短 ID 的恢复反例：官方 Runtime 的 resume/load 静默成功，Rovai 必须在打开前以 session/list 拒绝；
复用同一真实 Host 验证没有登记假 Session，不新增默认 fixture 或数据库。真实模型的有效 cold 恢复独立在 App 验收。
既有 `controlled_native_resume_classifies_only_explicit_rejection_as_incompatible` 同时检查 catalog 明确缺失为
incompatible、无效响应为 ambiguous，保证后续共享 continuity-lost 回退保留正确失败分类。

## Runtime 轻量启动回归 owner

首轮轻量启动改造复用既有 Rust 测试 owner。原 light-ready uniform preflight owner 改为
`agent_profile::slow_tests::discovered_entry_configures_and_freezes_without_health_evidence`，覆盖无快照配置、
精确意图及 hash/file identity 不一致拒绝。原 Codex live-model owner 扩展为
`codex::tests::real_host_validates_before_input_and_executes_in_the_same_process`，以合成协议进程验证启动次数、
默认模型零目录、version 超时无关，以及初始化/登录/模型选项失败零正文。
`delivery_queue` 既有 claim owner 扩展历史状态矩阵、公开错误、原终止原因优先、未知错误不公开、失败不循环及修复后新任务；
`collaboration` 原多目标无 Runtime owner 改为每个目标产生具体失败 Run，保留消息与 Delivery 数量及原子准入断言。
Antigravity 原取消 owner 同时覆盖初始化期间取消及接收后终止，保留原有进程树和私有日志清理。
原诊断成功、失败、身份漂移与快照保留测试继续拥有诊断语义，不删除权限、取消、Session 或去重断言。
最小命令为 `cargo test -p rovai-core --features slow-tests --lib agent_profile::`、
`cargo test -p rovai-core --features extended-tests --lib codex::`、
`cargo test -p rovai-core --lib delivery_queue::` 与 `cargo test -p rovai-core --lib antigravity::`。
完整切片结果记录在当前版本实施计划，合成测试不替代真实账户、CLI 与跨平台验收。

`ROVAI_FAST_CHECK_ONLY=1 pnpm test:camp-fast-layout` 使用原隔离 Electron fixture 验证零资格检查、直接三态保存、
绑定与迟到响应 fence、保存去重、两处界面共享偏好及原生键鼠/主题/响应式布局。默认无此变量时继续执行原有完整布局与 Stop 回归，
不将旧夹具的其他失败静默跳过；两种范围的结果分别记录。

PR #642 的身份读取/锁边界修复继续扩展以上 owner：无健康快照和旧指纹快照下必须读取当前文件身份并得到
`ExecutableIntegrityStatus::Unchanged`，旧 hash 与 Installation 路径漂移仍拒绝；locator 在没有快照或文件身份失效时
仍可用于重新解析。Windows 既有 `resolved_npm_shim_content_change_invalidates_locator_identity_and_snapshot_key`
在 `slow-tests` 下增加无快照的目标升级和 npm platform package 搬迁回归，必须在 Windows 执行，不能由 macOS 结果代替。
Codex 既有真实 Host owner 增加销毁 Host 后的第二次默认模型执行，保留版本命令挂起及每个 Host 仅一次任务输入断言。

新增唯一 owner `application::tests::discovered_runtime_verification_keeps_database_available_and_identity_after_restart`
拥有文件 worker / 全局数据库锁的异步边界；原同步校验不能在阻塞线程池暂停时让出 executor，或若先取数据库锁再等待 worker，
并行 SQL 会被挡住。现有纯身份测试和诊断 manager owner 不拥有这项并发合同，因此复用 `runtime_resolution_test_core`
而单列此 owner；纯函数无法证明真实 Core 锁和持久化重开。测试以单线程阻塞池和 channel 屏障确定顺序，不依赖文件大小、
磁盘速度、sleep 或性能阈值；并在 Core 重开后验证同一安装身份的元数据快速路径。最小命令为
`cargo test -p rovai-core --features slow-tests --lib application::tests::discovered_runtime_verification`。


Fast v3 复用 `camp_fast::tests` 的持久化/冻结 owner，新增无快照首次写入、receipt 重放不覆盖新选择和旧缓存不准入的输入；
同一 SQLite fixture 保留绑定切换、模型/权限变化、两 Thread 隔离和冻结摘要验证，并进入 `extended-tests`。
原 Claude auth/version 与 Codex eligibility parser/metadata 进程测试随其生产资格路径退出；临时 settings 三态映射仍由
`native_overrides_preserve_three_states_without_qualification` 拥有。通用 schema 诊断测试保留。
Claude 既有真实进程错误 owner 扩展新建/恢复、显式/默认模型和三态参数矩阵，验证实际临时文件、权限独立、
version/auth 零调用及一次正文/零重放。Codex 既有真实 Host owner 扩展三态单 Turn、零持久档位、缺失反馈仍执行，
以及关闭参数被原生协议拒绝时返回错误且不重放。
最小命令：`cargo test -p rovai-core --features extended-tests --lib camp_fast::`、相同参数的 `claude::`、`codex::`，
以及 `execution_evidence::tests::` 的字段脱敏、Run/epoch 所属和逻辑执行窗口回归。


### 模型消息 Mention 测试准入（2026-10-09）

`camp_content::model_mention_tests` 拥有保存目标的顺序、去重与一次投影名称复用。此前只有正文渲染 owner，
无法发现正文之外的显式目标丢失或离队目标被过滤；使用三行 profile 的内存 SQLite，不创建完整 Core。
`context::slow_tests::claimed_legacy_batch_keeps_its_format_after_mention_upgrade` 拥有已领取、未物化 Run 的升级恢复，
单纯 formatter 断言不能证明数据库新约束允许旧版本物化；复用既有 Run fixture，检查重试字节和摘要。
`db::message_mentions::tests` 拥有 schema 136 → 137 的 DDL 回滚和冻结证据保留；纯投影测试无法证明事务原子性。
其余作者、三种 read 模式、旧回执、封闭 Schema、输入大小和非 batch 字段扩展既有 owner，不删除或停用测试。

最小命令为 `cargo test -p rovai-core --lib model_mention_tests`、
`cargo test -p rovai-core --features slow-tests --lib claimed_legacy_batch_keeps_its_format_after_mention_upgrade`、
`cargo test -p rovai-core --features extended-tests --lib db::message_mentions::`。

## DSH 逐模型能力缓存

新增 `agent_profile::slow_tests::dsh_catalog_updates_accumulate_capabilities_without_reviving_removed_routes`
拥有目录事务的逐模型累积、乱序成功时间、普通刷新、来源切换与删除边界。修复前读取 B 会覆盖 A；
已有 parser 与失败快照 owner 不经过目标目录和完整检查的共同写入位置，因此复用现有 SQLite fixture
新增这一独立 owner，保持 `slow-tests` 层。没有新增表或迁移测试。最小命令：
`cargo test -p rovai-core --features slow-tests --lib dsh_catalog_updates_accumulate_capabilities_without_reviving_removed_routes`。

现有 Core 检查队列 owner `codex_catalog_waiters_share_refresh_without_satisfying_full_validation` 验证其他
Runtime 的合并与检查强度不变；DSH 原生计数和配置变更屏障进入既有
`scripts/smoke-dsh-model-availability.mjs`，使用合成凭据和本地接收服务。60 秒过期场景仅在隔离数据库
将对应成功时间调旧，不通过睡眠拖慢验收，不修改日常数据库。生产参数控件继续由
`node --test scripts/lib/runtime-model-picker.test.mjs` 验证默认模型零查询、历史显示及迟到结果保护。

## 原生会话恢复 owner（2026-10-12）

扩展既有跨版本 owner `smoke-member-environment-upgrade.mjs`，覆盖生产 Core 的 exact-ID 恢复、当前启动
环境、旧安装/上下文摘要和坏 Bootstrap，不只检查数据库留存。复用同一隔离 harness 增加模拟 ACP 的
一次新建成功/失败、误导错误文本、模型请求错误、取消、超时和输入后进程退出，并断言真实 prompt 次数和成功提示。
Codex 另以真实 `config/read` / `account/read` 请求注入 MCP / 认证错误，要求零新建、零业务输入并保留原 ID。
最小命令：`node scripts/smoke-member-environment-upgrade.mjs /absolute/schema142/rovai-core`。
旧二进制可从 `7973c7ffd1b0a360dea02c936458fb69f591c11e` 构建，旁边需配套 `rovai`；候选为当前 debug binaries。

PR #714 补充审查继续扩展同一 owner：Pi 用正式公聊/单聊发送接口交替建立与恢复 S1/S2，在 Warm 和 Core
重启后检查实际 `switch_session` 路径、Session ID、每条 prompt 次数及各 Conversation 的进程复用。
ACP 覆盖广告 load 后实际返回 `-32601` 的新建成功/失败、resume 不可用后的 load 替代，以及初始化/模型
同码不得降级。定向重跑可用 `node scripts/smoke-member-environment-upgrade.mjs --adapter-regressions`，不冒充跨版本验收。
Pi 原 session-header owner 保留缺文件/父目录矩阵，增加旧 locator 精确 ID 回读、错 ID 拒绝及新文件优先；
ACP 原终端协议 owner 在相同脱敏断言之外检查结构化错误码仍存在。不新增 Rust 测试函数或平行 Core harness。

真实 CLI 审计后的修复继续扩展错误字段 owner `acp_rpc_error_keeps_only_allowlisted_bounded_fields`，
覆盖 Copilot / Qwen / Qoder / ZCode 的 Adapter 范围、精确目标、错误文本反例和字段长度上限。
原 ACP 终端 wire owner 同时检查 Qoder 所需的机器字段经过响应通道后仍可用，保留脱敏断言。
PR #721 的 P2 补正继续扩展同一 `kimi_038_fixture_uses_the_standard_terminal_wire_lifecycle` owner：
配置短凭据 `test`，令 Session ID、URI 和 `/work/test/project` 路径包含该值，另覆盖原因码与凭据碰撞。
实际经过 `complete_pending()` 和 oneshot 响应通道后，Qoder/Copilot/Qwen 仍能识别精确目标，
Display / Debug / anyhow 的普通及 alternate 格式均不暴露凭据；不新增 Rust 测试函数或真实 CLI 调用。
新增两个扩展层 owner，均有独立的修复前失败语义：

- `codebuddy_restore_verifies_only_the_exact_file_in_the_launch_environment`：最小临时文件夹验证缺少精确
  历史才能降级，其他文件不能冒充目标；启动时的配置目录不会被后续修改取代，非法目标/文件类型仍报普通错误。
  原 usage 路径测试不拥有恢复结论，协议测试不能证明本机文件边界，无需 Core / 数据库 fixture。
- `only_the_native_resume_rejection_authorizes_session_replacement`：内存双工协议验证 ZCode 原生错误到
  ACP 的来源传递；resume 的明确拒绝能到达 Core，而初始化、订阅、权限、模型同码不能触发替换。
  原选模成功测试不覆盖错误来源；纯映射测试不足以验证桥接响应与原生请求的关联，不启动真实 CLI。

最小命令：`cargo test -p rovai-core --features extended-tests --lib codebuddy_restore_verifies`、
`cargo test -p rovai-core --features extended-tests --lib only_the_native_resume_rejection`；相关 ACP、ZCode
与 native_usage owner 另做定向回归。真实 Runtime 验收和未测范围见
[15 类 Runtime 实测与五类修复复测](../research/runtime-monitoring/native-session-resume-2026-10-12.md)。

Rust 复用原 owner 并保持所有仍有效的保护：

- `runtime::tests` 的摘要资格矩阵改为同类型恢复，历史 attempted/ambiguous/incompatible 不挡新 Run；
  `failed_session_replacement_retains_reference_without_reviving_old_binding` 保留 stale epoch、unknown 和取消，
  扩展为旧目标留存与绑定/提示事务回滚。主动重置、网络恢复、防重 owner 保留。
- `context::slow_tests::newly_bound_session_bootstraps_on_its_current_generation` 保留同 Run 冻结字节，后续 Run
  使用独立审计证据且不换 Session；unknown 输入 owner 按当前重启失败合同验证迟到 ACK 不复活 Run、不推进水位，原 Session 仍保留。
- Claude/Antigravity 未发送输入 owner 不再把 stderr 文字当缺历史证据；保留精确 ID、实际发送 gate 与取消。
  Pi 原 session-header owner 合并真实 locator 指向缺文件和缺父目录，普通文本/超时仍属未知。
- 新增 `db::tests::run_bootstrap_migration_keeps_audit_and_rolls_back_its_schema_change`（扩展层）：拥有 195
  的 FK-off rebuild、入站引用、DDL/receipt 回滚和错误唯一索引拒绝。此前没有移除 Bootstrap 唯一约束的 owner，
  纯函数不足以证明 SQLite 回滚后旧审计仍在，因此使用最小真实数据库 fixture。既有 async Usage/环境降级
  fixture 先逆转 195，不放宽生产 schema 分类。

定向命令使用 `cargo test -p rovai-core --features slow-tests --lib`，分别过滤 `resume`、`bootstrap`、
`failed_session_replacement`、`uncertain_input_acknowledgement`、`session_header_scan`、`manual_native_session_restart`。
PR 默认层仍为 `cargo test --workspace`；Renderer 复用 `SingleChatPanel.test.ts`、`App.test.ts` 与 typecheck。
不新增真实模型调用、常驻验证进程或永久禁用测试。


## 会话 Task 开关的合同 owner（2026-10-17）

复用既有 Rust owner，不新增独立 Rust fixture：`lightweight_task_updates_submitted_fields_and_is_terminal`
扩展默认关闭、旧记录禁读写、精确回执重放、重开、升级数据/冻结证据保留与迁移故障回滚；
`self_active_tasks_are_compact_bounded_and_frozen_in_input` 与空快照 owner 分别覆盖冻结选择不变、关闭时整节缺席。
`continuation_rechecks_scope_and_selects_safe_session_at_claim` 保留目标和 Session 栅栏，但 Task 变更不再使等待/续做失败。
原 Task 推导接收者 owner 改名为 `legacy_task_link_is_ignored_without_changing_explicit_recipients`：
新 Send 的关联和接收者推导已由 Send v28 退役，显式接收者、消息授权与 raw input 幂等身份仍保留。
原始 requestId/digest 冲突由既有 `lease_rotates_fences_and_replays_exact_request` owner 验证；
领域 commandId 仍沿用首次结果重放，不能将运输层的摘要比较强加到领域网关。
通知 inbox/cursor owner 扩展任务关闭时的 SQL 分页、未读数、变化水位与重新开启断言。
数据库当前准入和 Steer 升级 owner 更新到 schema 156，继续检查保留的输入唯一性与迁移回滚；
固定 Task 通知边界继续扩展同一 inbox/cursor owner，验证同值保存不后移、重启保留与已安装 schema 155 升级。
Task 升级 owner 同时验证 Migration 206 列与收据的原子回滚；没有新增 Rust owner。
同一 inbox/cursor owner 还验证通知批次携带同事务能力快照、无新通知的切换顺序、空页/reset 快照、同值保存不递增及事务回滚。
既有通知 Electron owner 覆盖设置 get pending、失败和迟到时普通提醒及精确 Task acknowledgement 各处理一次，
旧 Task 不补弹、迟到开启批次不能覆盖较新关闭，以及 Host 保存/切换隔离；不新建等待队列或平行 fixture。
历史夹具的降级只用于测试，生产迁移不修改旧输入字节。
Pending invitation owner 将旧 `execution.taskId` 从拒绝分支移到成功发送分支，验证未知旧 Task
不会阻断首次发布/邀请，且不建立关联；无效回复、权限拒绝和事务回滚断言保留。
`user_continuation_preserves_source_and_claims_independent_fifo_batches` 在原输入冻结后显式开启 Task，
继续验证新 claim 选择当前任务、原输入不变、独立 FIFO 与完整历史读取。
CLI 解析与教学 owner 保留文件输入矩阵并覆盖旧 taskId 兼容；`pnpm test:send-input-file` 的唯一进程 owner
增加缺失/损坏/旧版/未来版/无 lease 投影、关闭错误和帮助零 IPC。普通 Rust/Renderer 通过不能替代该进程检查。

最小定向命令为 `cargo test -p rovai-core --lib --features slow-tests,extended-tests task`、
`cargo test -p rovai-core --lib --features slow-tests,extended-tests continuation_rechecks_scope_and_selects_safe_session_at_claim`、
`cargo test -p rovai-core --bin rovai` 和 `pnpm test:send-input-file`。

### 当前 Skills 设置的验收归属

`pnpm test:capability-workspace` 挂载生产 `NativeSkillsSettings`、`ToolboxSettings` 和 `McpSettings`。
它拥有原生文件阅读、失败恢复、迟到响应、键盘导航、逐队员配置与 MCP 凭据编辑的 Electron 交互覆盖；
完整范围见 [fixture 说明](../../scripts/fixtures/capability-workspace/README.md)。旧 `SkillSettings` 页面及仅服务
旧导入／交付组的单元测试已退役。Core 的历史 Library、Revision、投影恢复与兼容测试继续拥有旧数据路径。


## Hermes 首次输入与历史证据

`context::slow_tests::hermes_rules_follow_accepted_inputs_and_ignore_retired_compaction_requirements` 拥有 Hermes 完整 B
摘要、接受状态和冻结最终输入的组合合同。旧共享 Bootstrap owner 的稳定摘要刻意不含身份，不能证明
身份单独变化、prepared/unknown 去重及旧实验记录不参与规则基线的行为；复用现有 Context fixture，
不引入完整 Core/进程 fixture。覆盖首次、重复、身份更新、未知恢复、冻结正文和旧 pending 不消费。
`db::hermes::rules_tests::rules_migration_preserves_data_and_rolls_back_with_receipt` 拥有 Migration 217
新增 FK/nullable 字段与 receipt 的 DDL 原子性；现有 catalog owner 验证的是闭集表重建，不能替代它。
使用既有 seeded database；catalog owner 从 schema 165 验证 Hermes Migration 216，保留原有 rollback 矩阵。

最低命令：`cargo test -p rovai-core --features slow-tests,extended-tests --lib hermes`。
原 compaction policy owner 验证 Hermes 完成事件不再准入；共享 CLI outbox 的其他 Runtime case 保留。
原生请求与生产 Core 的边界由 `scripts/smoke-hermes-native-session.mjs` 拥有，使用隔离测试用户 Home；
合成 usage 只用于触发官方压缩，不作为实际账单或模型效果证明。

同一入口追加 `--observations`，使用未补丁官方 ACP 与本地受控 Provider 比较每轮已报告计数和
终态 usage，覆盖另一客户端保持 Session、模型切换、Core 强杀后续轮、工具之后模型失败。
测试专用 stdio 记录器只保留字段名/数值/关联标识，不改 ACP 消息；不进入生产启动链。
额外原生客户端显式订阅标准压缩通知，并主动调用一次 `/compress`，只用于排除未订阅的解释，
不增加 Core Run 或生产隐藏命令。测试里的原生日志是验收依据，不是新的运行时采集通道。
现版的缺口、数字及失败尝试见[原生观测验证](../research/hermes-runtime/README.md#原生-acp-观测验证2026-10-25)；
此分支是版本行为刻画，若上游改变计数/通知语义，应重新核验断言，不能把旧限制永久固化为能力合同。

2026-10-26 `clarify` 分类修复扩展既有 `approval_selects_the_exact_native_option_id`，不新增 Rust
测试函数：官方选择题 fixture、开放题、字段缺失/冲突、普通审批及其他 Adapter 不误分类均由该 owner
负责。修复前 Hermes 两种提问都落入 Execution；最小命令为
`cargo test -p rovai-core --features extended-tests --lib approval_selects_the_exact_native_option_id`。
共享终态 owner 继续覆盖问卷失败不能被 final/Send 掩盖及原生错误/取消优先。
上述原生 smoke 追加 `--questionnaires`，仅在一次性测试用户配置启用 clarify，验证真实官方提问、
精确取消回执、零 Approval、无用户答案、已发送消息保留，以及后继 Core 冷恢复原 Session。
它使用本地受控 Responses，不能替代真实模型或完整 Renderer 验收；与 `--observations` 分开运行。

User 明确授权真实模型后，同一入口追加 `--real-model <第二个模型 ID>`：

```sh
node scripts/smoke-hermes-native-session.mjs /absolute/official-source /absolute/prepared-python --real-model <second-model-id>
```

真实分支读取当前原生配置中的默认模型及 Responses Provider，使用一次性用户 Home、独立 Core data、
Skill Library、MCP 文件和未修改的源码副本。测试 relay 原样转发真实模型响应，凭据只留在测试进程内，
不复制到 fixture；不生成工具调用或伪造模型回复。测试用 stdio observer 只记录 ACP 方法、Session、
模型/模式等白名单元数据，不改变消息。它不是生产代理、插件或 CLI wrapper。
两成员真实工具与 Send、原 Session 冷恢复、同值省略设置、目录外显式模型切换和固定 Skills 文件选择
使用生产 Core 入口验收。报告区分请求模型、原生设置、落盘文件与公开 Send 回执，不靠模型自报身份。
该分支不重跑压缩、取消、MCP 或平台矩阵；它不能替代默认受控分支的相应证据。
启动解释器也可能触发官方 bootstrap 的依赖准备，必须在已明确隔离的 Home/源码副本中执行，
不要为了检查依赖在日常 Home 导入 bootstrap。

## Command Code 1.88 简化测试归属（2026-10-24）

macOS 两架构 Preview 开放扩展既有 `macos_catalog_qualifies_each_runtime_only_with_its_bound_evidence`：
Command 允许使用但不伪称 qualified，保留缺失证据原因。同日 Windows 开放扩展既有
`windows_catalog_qualifies_only_adapter_scoped_frozen_evidence` 验证相同 Preview 语义，Linux 继续验证拒绝。
Renderer 沿既有 App、OnboardingFlow、RuntimeInstallationGuide、RuntimeMonitoring 与 member-runtime-apply
owner 验证公开目录、两种 macOS 与 Windows 的配置准入和 Linux 的只读限制；不增加 Rust owner。
App CLI 的既有 `member_runtime_configuration_admits_native_runtime_defaults` 同步允许解析 Command 配置，
目标 Host 平台仍由 Core 准入；现有隔离 Electron Runtime Picker 覆盖实际菜单选择与默认模型保留。

退役 `native_configuration_tracks_scoped_mod_sources_without_hashing_history`：其唯一生产路径（配置扫描、
HOME 镜像和原生文件合并）已删除。同模块 owner 后续更名为 `native_home_and_bootstrap_control`，
验证原生 HOME 不被改写、一次握手清理和直接控制正文编码。health owner 中的 `mcp list` 格式矩阵随已删除
解析器退役；真实 1.88 原生同名优先验证由隔离 native-contract 探针承接。

扩展既有 `member_sessions_reuse_only_within_their_camp_and_current_session` 覆盖显式身份策略与跨 cwd/owner；
`binding_transitions_preserve_public_accepted_boundary` 覆盖旧摘要迁移到无摘要 Run 的 Binding 提交；
`private_host_config_is_scoped_to_profiles_that_require_it` 增加构造失败时实际进程回收先于目录删除。
既有成员配置写入 owner 扩展并更名为
`runtime_configuration_writes_preserve_startups_and_retire_changed_command_hosts`：保留原 Codex 启动中写入
边界，覆盖实际 dispatcher 的 MCP 分配/撤销、定义、启停、删除、有效成员变化与冲突拒绝；重复保存不退役，
无关成员及其他 Runtime Host 保留。导入的实际/无变化成员事实归既有
`import_commit_rehydrates_credentials_and_fences_replacement_before_startup`。
`launch_version_uses_the_frozen_program_without_blocking_ordinary_execution` 同时拥有 Command 缺失入口下
允许 warm 准入、cold 拒绝启动，以及显式禁用/删除安装的拒绝；
`trae_completed_run_enters_lru_and_reuses_the_same_host_session` 覆盖共享 ACP cold callback 只在创建执行，
warm 不调用、cold 失败不创建进程/材料。
终态矩阵移除基线已失效的 14 个 Adapter 固定计数（实际为 15），改验非空后继续遍历全部 Adapter；
目录数量仍由 Registry owner 拥有。保留取消/终态 owner，不新增等价 Rust 测试。真实控制面继续使用既有 ignored
`isolated_command_code_acp_direct_bootstrap_and_cold_resume`（原 bootstrap_gate owner 更名），
基线为 1.88，以实际 ManagedProcess/ACP Host 和本地确定性 Provider 验证逐轮直接交付。

最小命令：`cargo test -p rovai-core --features slow-tests --lib`，分别过滤上述 owner 与 `command_code`；
Core dispatcher owner 使用 `cargo test -p rovai-core --features slow-tests --lib runtime_configuration_writes`；
Node 沿用 `node --test scripts/lib/command-code-bootstrap.test.mjs`。再执行默认 `cargo test --workspace`。
真实 native Home 仅由验收夹具创建，adapter 本身不得覆盖共享 HOME；真实模型/MCP 与平台资格分别记账。

2026-10-25 跟进扩展既有 owner，不增加测试文件或平行 Rust owner：
原 `native_home_and_immutable_bootstrap_materials` 曾验证已有文件不重写；其 Host 生命周期冻结断言
已由下述 User 确认的 Run 边界交付替代，不再作为当前合同；
长正文 owner 更名为 `long_bootstrap_bindings_preserve_utf8_and_enforce_body_limits`，与既有 Node Mod owner
共同验证 128 KiB 引号正文即使 JSON 大于 256 KiB 仍可交付，正文超限仍拒绝。
`private_versions_preserve_credentials_and_new_launches_read_current_configuration` 覆盖成员环境的值、继承、
格式无变化与重放事实；`acp_probe_failure_classification_separates_auth_protocol_and_transient_errors` 扩展
假 ACP 进程，对照 Command/Kimi 的认证、协议与临时错误，确认真实 probe 边界保留原因与 stderr。

六项审查跟进继续扩展上述 dispatcher owner：控制一个 Fleet startup 等待数据库，安装更新进入退役后
确认数据库锁已释放，再完成启动/回收；同命令 replay 和新命令保存相同值均保留 Host 及安装版本。
该跨 Core/SQLite/Fleet 等待关系不能由纯函数证明，复用原隔离 fixture，不增加锁或生产测试入口。
已有 `local_saves_finish_while_environment_capture_is_held_and_never_launch_work` 增加旧字段请求重放且
程序入口暂时移走的情况；原事务 owner 保留冲突/失败回滚并确认已应用编辑为空。
MCP dispatcher/import owner 覆盖保留成员不退役、关闭 Server 的修改不退役与重新启用生效。
新增唯一纯函数 owner `command_code_acp::tests::version_gate_accepts_native_release_labels`：
修复前 `v1.88.0`、`Command Code v1.88.0` 与 `1.88.0+build-name` 会失败；此前 Command 无版本解析
owner，HOME/binding fixture 不拥有该独立边界。该测试不创建文件或进程，同时保留低版本/预发布/无版本拒绝。
最小命令为 `cargo test -p rovai-core --features slow-tests --lib version_gate_accepts_native_release_labels`；
其余定向命令复用同一入口并过滤上述既有 owner。Rust 测试函数净增 1，无测试文件新增或已有 owner 退役。

stdio 资源跟进新增纯函数 owner
`command_code_acp::tests::mcp_wire_uses_session_cwd_without_a_launcher_and_preserves_literals`：修复前共享投影
补全的默认 cwd 会触发多余 Node launcher；同目录应保持原 command/args，不同目录继续保留参数式包装。
该 owner 同时保留 env/header 的单次 wire 转义和含空格／空参数／shell 字面值。现有 HOME/binding 与版本
owner 不经过 MCP wire，`runtime_mcp` 的原生文件 owner 也不拥有 Command ACP 适配，故不能用它们替代。
测试不创建文件、进程或数据库；最小命令为
`cargo test -p rovai-core --lib mcp_wire_uses_session_cwd_without_a_launcher_and_preserves_literals`。

2026-10-25 Run 边界收口继续扩展原 owners，不增加 Rust 测试函数或 fixture 文件：
`native_home_and_run_bootstrap_materials`（原 immutable owner 更名）拥有同 Session 的新 B 覆盖、
相同冻结字节重复发布、不同 Session 隔离和非法输入不覆盖旧文件；不可变整 Host 正文断言随旧行为退役。
`history_restore_replay_is_quarantined_and_only_current_prompt_accepts_input` 增加 Command 协议进程分支，
没有 `session/list` 回应也可完成 load、历史隔离与当前输入；真实 ignored Command owner 不再要求目录预检
拒绝缺失 ID。`native_resume_consumes_only_adapter_evidence` 保留原生明确拒绝与模糊错误的分类，删除专属目录案例。
`runtime_directory_overrides_change_native_candidates_without_explicit_refresh` 增加 Command 的四处原址发现；
`acp_tool_events_expose_only_the_public_command_and_payload_digests` 增加 edit 新建、失败/提案/异路径、已有空文件
和 write 回执矩阵，并检查内容进入共享 Diff 准入。2026-10-26 在同一 owner 补齐 write 的精确 created
成功回执：空旧正文到非空 content 显示 update、准确增删统计，含中文空格路径及 CRLF；空 content、
非空覆盖、未知/异路径回执、未完成与失败仍无 Diff。修复前成功 write 行数案例失败；无新增 Rust owner。
Node Mod owner 验证过滤问卷且保留其余 active tools。
固定官方 1.88 的 active-tools、真实文件回执、warm B 更新和 cold 同 ID 证据记录在
[实施报告](../versions/v1.72/command-code-native-simplification.md#run-边界与原生能力补齐2026-10-25)。
最小命令沿用 `cargo test -p rovai-core --features extended-tests --lib <owner>`、Node Mod owner 与默认 workspace。
真实 cwd 与进程父子关系由隔离官方 1.88 控制探针验证：CLI 初始 cwd 与 Session cwd 不同，分别执行
`session/new` 和同 ID 的 `session/load`，检查 MCP `tools/list` 回执及停止后回收；这不替代历史恢复、
真实模型工具调用或 Windows/Linux 资格。证据追加到已有 Command JSON，不新增测试文件或常驻验收服务。


2026-10-25 Bootstrap 直接传输接入继续复用上述 owners，Rust 测试函数和文件均未增加：

- `native_home_and_bootstrap_control` 拥有中文／换行／引号等控制编码、完整 128 KiB UTF-8 正文预算、
  无效输入拒绝、原生 HOME 和 ready 清理；原 binding 文件发布／不同文件名断言随正文文件路径退役。
  Windows npm 入口修复扩展同一 owner 的 revision/nonce、PID 类型／范围和归属拒绝矩阵。
  `managed_process::tests::windows_bat_entrypoint_job_owns_the_complete_child_tree` 原地核对存活后代、
  已退出根进程、无关当前进程、零 PID 与终止后代；复用已有真实 Job fixture，不新增 Rust 测试函数。
  修复前官方 `.cmd` 入口的根 PID 与 Mod Node PID 不同，实际 Run 被 `command_code_bootstrap_readiness_invalid`
  拦截；纯 ready 解析不能证明 OS Job 归属，因此后者由既有 Windows 进程 owner 拥有。
  最小命令分别为 `cargo test -p rovai-core --features extended-tests --lib native_home_and_bootstrap_control`
  与 `cargo test -p rovai-core --features extended-tests --lib windows_bat_entrypoint_job_owns_the_complete_child_tree`。
- `history_restore_replay_is_quarantined_and_only_current_prompt_accepts_input` 保留 TRAE/Command 恢复
  回放隔离，扩展生产交付调用：控制 end_turn、usage、mode 仅属准备，错误／cancelled 返回不提交业务
  prompt；成功后只有原业务输入生成接受和终态。复用 Ready 路由与普通 RPC waiter，没有新状态机。
- 既有真实 ignored owner 更名为 `isolated_command_code_acp_direct_bootstrap_and_cold_resume`。
  使用实际官方 1.88 executable、ManagedProcess、生产 Mod 与 AcpRuntime；保留五种 mode 和本地
  `rovai-probe/model` 显式 BYOK 选模，同 PID/Session A→B→A、
  128 KiB 引号正文、新 PID 精确 ID cold，以及四类无效控制参数。每次控制后业务事件为空，每轮原始
  user 输入仅接受一次；Host 材料只含 Mod，shutdown 清除。测试所需隔离 HOME 由调用者提供，不能替代
  完整 Core/App 或跨平台资格。旧文件缺失／坏 SHA 时退出及多 binding 文件断言随唯一生产路径删除；
  所属范围仍由既有 Fleet/Native Binding owner 负责，不新增跨 Session 内存管理器。
- `long_bootstrap_bindings_preserve_utf8_and_enforce_body_limits` 保留 Cline 的文件交付断言，删除 Command
  文件分支；Command 容量由其控制 owner 和既有 Node Mod owner 承接。
- `scripts/lib/command-code-bootstrap.test.mjs` 验证注册完成后才写 ready、A→B→A 直接替换、失败保留旧值、
  固定错误不含输入、完整 128 KiB 和原问卷过滤。删除旧文件读写／SHA／文件名门禁测试。

定向命令仍为 `cargo test -p rovai-core --features extended-tests --lib <owner>` 和上述 Node 文件；
真实 owner 显式 `--ignored --nocapture`，需 `ROVAI_COMMAND_CODE_SMOKE_ROOT` 与
`ROVAI_COMMAND_CODE_SMOKE_EXECUTABLE` 指向一次性原生夹具与官方 CLI。默认 workspace 和文档门禁继续运行。
