---
document_type: development-guide
authority: test-policy-and-command-routing
last_updated: 2026-10-07
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

`rovai-web::resources::content::tests::bounded_scan_preserves_digest_unicode_and_same_metadata_changes` 拥有分块
读取的有界保留、UTF-8 跨块、稀疏行号与新鲜摘要校验。修复前每页保留整份文件；原有纯分页 parser owner
没有文件 I/O 或跨请求摘要事实的 seam，因此该独立 owner 使用单一临时文件与固定修改时间，避免 Core/数据库 fixture。
最小命令为 `cargo test -p rovai-web resources::content::tests::`。

既有 `host-web.test.mjs` owner 扩展认证原始字节、相同大小/修改时间下的变化拒绝、上传取消/拒绝/重放清理与
构建缓存边界。Node SQLite fixture 设置有界 busy timeout，避免与隔离 Host 的正常事务争抢造成偶发失败。
`camp-adapter.test.ts` 和 `file-digest.test.ts` 分别验证空句柄轮询、Host 确认后的本地图片复用及浏览器摘要缓冲上限。
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
既有 Managed Process 孙进程 owner 用稳定 handle 验证 Job 计数不能抢先确认退出，并覆盖首次观察后
新增后代、缺失/重复/非法成员通知；Fleet receipt owner 验证跨 Core 仅凭已持久化回执放行。

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
| `pnpm smoke:builtin-cli` | 默认十三种可执行实现；Cursor 未准入，Pi 仅 debug 验收 | 首个选中 Runtime 的先导 AgentRun 先通过真实 `rovai` lease 产生一条 Public A2A，并证明对应 Message Delivery 与 publication event；同一历史 Camp 另写真实文件附件。随后另一 Camp 的真实 AgentRun Manifest 冻结该历史 Camp，并以自己的 lease/context 执行 `history.search`、显式历史 `camp.search` 与 `camp.read item`，核对同一 A2A identity 及附件 `kind/fileCount`。每个真实 AgentRun 其余只使用固定业务命令，调用二十二项 CLI operation；Automation case 覆盖定义 CRUD、读取、列表与无 Runtime 队员的确定性立即运行失败；Gather case 额外验证成员公开回传被 capture、Lead 不逐条唤醒且只创建一次 completion。其余仍验证旧 send 输入拒绝、Projection/schema、冲突 recovery、release fence、Replay 与后续 AgentRun 新 lease；transport-independent indeterminate 由 CLI response-loss test 覆盖。选择 Pi 时复制官方配置到临时 Home，不污染用户 Session；通过不晋升平台资格 |
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

当前语义由 [Runtime Launch v42](../contracts/runtime-launch-and-verification-v42.md) 继承 v41 并拥有。
`runtime_check_refresh_tests` 是 macOS/Windows Check Manager、保存 CAS、正式状态与草稿隔离的集成 owner：使用可注入的
基础环境读取器、UUID 临时目录、私有 SQLite 和合成程序，不读取真实 Runtime 安装或账号。
它覆盖目录变化、原路径升级、指定路径失效不回退、进程 PATH 不参与主程序选择、草稿/恢复自动不发布、
保存及新请求与旧探测交错、环境读取失败不沿用缓存。程序替换继续复用既有 identity-checked probe owner。
恢复自动的回归在基础查找目录变化后预览并保存，直接断言保存后的正式路径与版本，不追加正式检查；
同时验证其他 Runtime 设置保留、CAS 拒绝和环境读取失败不发布、同配置重试幂等。
这些跨 manager/数据库的断言不能降为单独的发现函数测试；不新增第二套协议模拟或真实模型 Smoke。

```bash
cargo test -p rovai-core --bin rovai-core --features slow-tests runtime_check_environment::tests
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


Command Code 原生配置指纹回归由
`command_code_acp::tests::native_configuration_tracks_scoped_mod_sources_without_hashing_history` 拥有。
新增此默认 Rust owner 的原因是没有既有测试覆盖其官方 Mod scope：同一嵌套 cwd 下，用户相对路径、
项目相对路径、自动发现 Mod 和本地 source 的正文变化必须使配置不兼容，而 Session 历史追加必须不改变
配置指纹；非法 settings 必须拒绝。这是保留 Host/Native Binding 的跨文件行为门禁，不是枚举快照测试。

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
