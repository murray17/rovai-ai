---
document_type: implementation-plan
version: v1.71
authority: version-implementation-and-acceptance
status: in_progress
last_updated: 2026-09-24
---

# v1.71 实施与验收

## 实施切片

切片按可回滚的小步排列，每一步单独可合并、单独通过全量测试。

1. **S1 Core 参数化重构，行为不变。** 引入 `ChannelProviderSpec`，把飞书领域函数中的 `feishu_*` 表名与 provider
   常量改为由 Spec 提供；飞书 Host actor 与请求名映射集中到一处。不新增 provider、不改 Schema；飞书与钉钉全部既有
   测试不改断言即通过。负责人：川行。
2. **S2 Core 接入 Lark。** 新迁移建立 5 张 `lark_*` 表并重建 3 张中立表与 2 个目录视图；注册 `lark-channel-host`、
   8 个命令类型与 20 个 `channels.lark.*` 请求；provider 白名单、`AutomationNotifyChannel` 与 Feishu v17 的品牌收窄。
   负责人：川行。依赖 S1。
3. **S3 Main 第二实例。** 抽出 Provider Profile，覆盖登录配置、可信域、SDK 域、Core 方法名、失败码与文案；
   `index.ts` 创建 Lark 实例；协调器三路；credential store 与 Host 渠道请求接受 `lark`；飞书与 Lark 全部 SDK 构造点
   显式传入域；Feishu v17 遗留 `brand=lark` 处理。负责人：川行。依赖 S2。
4. **S4 Contracts、Renderer 与 Web。** `ChannelKind`、`AutomationNotifyChannel` 与 rovai-web 枚举增加 `lark`；
   Renderer 的标志与文案改为按 Provider 查表，新增 Lark 标志、未验收提示和自动化通知选项。负责人：屏知。类型改动可与
   S1 并行，联调依赖 S3。
5. **S5 自动化验收。** 维护本版验收矩阵，审阅 S1 到 S4 的负向测试是否覆盖隔离与拒绝路径，补齐 Main 与 Renderer
   测试缺口，并为真实租户验收准备逐项记录模板。负责人：验真。
6. **S6 真实租户验收。** 按 Lark Channel v1 第 8 节逐项执行并记录 qualification；未完成项保持未验证。依赖可用的
   Lark 租户。负责人：验真。

## 验收矩阵

| 验收项 | 证据 | 状态 |
| --- | --- | --- |
| S1 重构后飞书与钉钉行为不变 | `cargo test --workspace` 全绿且无既有断言修改 | 默认层通过；见下方记录 |
| `feishu_*` 与 `lark_*` 结构只在 brand 列与索引名不同 | 迁移结构等价测试 | 通过；见 S2+S3 记录 |
| 飞书与 Lark 各自单 connected 账号且互不影响 | Core 隔离测试 | 通过；见 S2+S3 记录 |
| 飞书 Host 写 Lark 行、Lark Host 写飞书行均被拒绝；账号、Bot、中立业务表、凭据与非 `command.result` 领域事件零变化，只提交唯一的 rejected 命令回执，幂等重放不新增事件 | Core 双向负向测试 | 通过（C1、C2、C3 复验） |
| `brand=lark` 的飞书账号命令被拒绝且无写入；历史行保持原位、可读且不复制到 Lark 表 | Core 兼容与迁移负向测试 | 通过；补强项 C4 |
| 8 个 actor 绑定请求以 `lark-channel-host` 执行；`channels.lark.account.disconnect` 以本地 Owner 执行 | Core 请求路由测试 | 通过（函数级路由表与 Owner-only 处理器断言） |
| 未列出的 `channels.lark.*` 请求被拒绝，payload 不能覆盖请求名推导的 actor | Core 请求准入负向测试 | 通过（函数级） |
| 三张中立表接受 `lark` 并保留旧行 | 迁移测试 | 通过 |
| 两个目录视图返回 Lark 分支，且飞书与钉钉既有目录行不变 | 迁移与目录视图测试 | 通过 |
| Lark 绑定 Camp 的 Charter 不含飞书文件交付提示 | Context 测试 | 通过 |
| 飞书在请求、身份归一化和 Session 恢复三层拒绝 Lark 主机；Lark 对飞书主机做对称拒绝；`open.larkoffice.com` 仍属于飞书 | Main 可信域参数化负向测试 | 通过 |
| Lark 登录配置与 `channels.lark.*` 方法名只注入 Lark 实例，飞书实例保持原值 | Main Provider Profile 隔离测试 | 通过 |
| 所有 SDK 构造点显式传入对应域，省略 domain 的构造在测试中失败 | Main 构造断言与缺省值负向测试 | 通过 |
| 遗留 `brand=lark` 飞书账号被过期、显示 `feishu_brand_moved_to_lark`，其已发布 Bot 不启动 | Main 恢复负向测试 | 通过 |
| 三个渠道服务实例并存；飞书或 Lark 任一启动失败不阻止另两者，全部失败才拒绝启动 | 协调器参数化失败测试 | 通过 |
| Snapshot 顺序固定为飞书、Lark、钉钉；Lark 重连错误映射不污染飞书与钉钉 | Main 聚合与错误映射测试 | 通过 |
| 三个 Provider 页签、Lark 标志和未验收提示存在，切换 Provider 不复用对方账号与错误状态 | Renderer 状态隔离测试 | 通过（静态渲染与纯函数级）；见 S4 记录 |
| `kind: \"lark\"` 的发布与重试只调用 Lark；Desktop IPC 的连接、断开、发布与重试入口接受 `lark`（2026-09-24 Principal 冒烟发现入口曾报 `Invalid channel kind`，已修正并补 `channel-kind-input.test.ts`）；Web 接受 Lark 且 `selectApprover` 仍拒绝非钉钉 | Renderer、Preload 与 Web 准入测试 | 通过（出口透传与 Web 准入）；见 S4 记录 |
| Rust、TypeScript 与文档门禁 | `cargo test --workspace`、`pnpm typecheck`、`pnpm test`、`pnpm docs:check` | 通过（提交 `049e202e`，上游 `44c461f3`）；扩展层与上游对照无新增失败，见第二次改号记录 |
| Lark 真实租户逐项验收 | [真实租户验收记录](lark-tenant-qualification.md) | 进行中：扫码连接与基础对话经 Principal 手工跑通，逐项证据不足 |

## 增量验收记录

### 2026-09-24：S1 Core 参数化重构

S1 按本计划声明的默认 workspace 门槛通过，允许进入 S2；扩展层保留一项非阻断基线失败。本次准入例外只适用于
S1，不自动延伸到 S2 或 S3 的最终验收。

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| 变更范围 | 通过 | 生产改动仅在 `crates/rovai-core/src/channel.rs` 与 `crates/rovai-core/src/application.rs`；`context.rs` 与 migrations 无 diff |
| 既有测试不改断言 | 通过 | 两个改动文件的既有 `tests` 模块与 `HEAD` 从 `mod tests` 起逐字比较无差异；S1 未新增测试 |
| 默认 workspace | 通过 | 临时 Rust 1.90.0 下 `cargo test --workspace` 为 412 passed、1 ignored；`cargo check --workspace --all-targets` 通过且无警告 |
| 扩展层渠道 owner | 基线失败 | `cargo test -p rovai-core --features extended-tests --lib channel::tests::` 为 30 passed、1 failed |
| Diff 完整性 | 通过 | `git diff --check` 通过；未修改 Schema，也未接入 Lark provider |

扩展层失败用例为
`pending_picker_upgrade_keeps_history_rolls_back_failure_and_reuses_the_old_card`。该失败已在独立、未修改的 `HEAD`
副本复现：旧 Migration fixture 重开迁移后遇到新增 Camp 列，历史快照列数不等。它不能表述为通过，也不能被默认层结果
覆盖；由于 S1 未修改该测试、Migration 或其断言，本次裁定为非 S1 回归，不阻断 S2。

S2 修改 Migration 后必须重新运行该用例，并验证旧行保留、失败回滚和旧卡复用。任何新增失败或相对上述基线的行为退化
均阻断 S2 验收。

另有一项待核实的环境差异：根 `Cargo.toml` 声明 `rust-version = "1.85"`，
`docs/development/environment.md` 仍写尚未声明；本机 Rust 1.88.0 无法编译既有 `rovai-host` 文件锁 API，而临时
Rust 1.90.0 可完成上述门禁。本记录不据此修改最低 Rust 版本、环境文档或 S1 结论；MSRV 与文件锁 API 兼容性需另行
核验。

### 2026-09-24：S2 Core 接入与 S3 Main 第二实例

结论：通过（C1–C4 于同日复核关闭，见本节末）。首轮为有条件通过：跨 provider 错误 Host 的拒绝路径只覆盖了
`account.upsert` 一个处理器。扩展层 `db::tests::` 3 条与 `application::tests::` 4 条既有基线失败不属于本切片，仍不得表述为全绿。

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| 定点 Rust 用例复跑 | 通过 | `--features slow-tests` 下迁移结构等价、账号隔离、actor 路由、Charter、S1 基线 picker 共 5 条均通过 |
| Main 定点用例复跑 | 通过 | 渠道设置、协调器、Host 渠道、凭据、可信域、开发者会话、Bot 发布、开放平台 API、身份 9 个文件 229 条通过 |
| 隔离测试的有效性 | 部分 | 在隔离副本把 `account.upsert` 的 provider 网关放宽为任意 Host，测试失败，说明断言有效 |
| 其余专属处理器 | 缺口 C1 | 同时放宽 `commitConnection`、`disconnect`、`expire`、`memberBot.upsert`、`publicationIntent.create/advance` 等 6 处网关，`channel::` 与 `application::` 全部渠道用例仍通过 |
| 中立表处理器 | 缺口 C2 | 同时放宽开发者会话、凭据删除、DM 轮换、名册、入站、投递、待绑定、执行控制台等 12 处按 provider 的网关，只有 1 条既有钉钉用例失败 |
| 扩展层 `application::` | 基线失败 | 4 条失败在 `git archive HEAD` 副本以相同位置复现，非本次回归，但此前回报未列出：`navigation_invalidation_covers_projection_writes_but_not_reads`、`v2_dispatch_admission_ignores_broken_legacy_view_and_managed_payload`、`execution_page_does_not_inherit_an_unrelated_non_database_wait`、`mission_git_reads_release_ingress_database_and_lifecycle_authority` |

待补测试与待裁定项：

- **C1（川行）** 表驱动覆盖其余 Lark 专属处理器：飞书 Host 调 Lark 服务、Lark Host 调飞书服务均得到拒绝码；
  账号、Bot、中立表、凭据与非 `command.result` 事件零变化；每条命令只有一个 rejected 回执，重放不新增。
- **C2（川行）** 中立表处理器的双向错误 Host：Lark Host 操作飞书行、飞书 Host 操作 Lark 行均被拒绝且零副作用，
  至少覆盖入站观察与完成、投递结算、名册对账、待绑定解决、DM 轮换、执行控制台三项、开发者会话替换与删除、凭据删除。
- **C3（砚舟已裁定）** `channels.lark.account.disconnect` 以本地 Owner 的用户信封执行，与飞书、钉钉同名请求一致；
  Lark Channel v1 第 2 节与 Lark 渠道架构已改为此表述。依据：飞书 v1/v2 与钉钉 v1/v2 均规定断开账号由本机 Owner
  发起，Core 中两家的 disconnect 都走用户信封；Host 能断开账号会扩大 Host 权限。未采用“保留 Host 执行”：它与继承的
  命令语义和钉钉先例冲突，代价是 `channel_request_host_component` 不再覆盖全部 `channels.lark.*`。川行改正路由与网关，
  拒绝消息去掉“Feishu”；补断言：两个 Host actor 调用均得到 `lark_account.owner_required` 且零副作用，Owner 以飞书
  账号 ID 调用得到 `lark_account.not_connected`，飞书账号与 `provider = 'feishu'` 的 Developer Session 不变。
- **C4（川行，补强）** `brand=lark` 越界命令在返回错误后补断言非 `command.result` 事件数不变；遗留行改写后补断言
  `lark_account` 行集不变，证明没有隐式复制。

C1、C2、C4 复验（2026-09-24）：通过。新测试
`channel::tests::wrong_provider_hosts_are_rejected_by_every_lark_capable_handler` 为飞书与 Lark 各建一套真实数据，
用对方 Host 双向调用全部专属与中立处理器；每条断言拒绝码、重放一致、唯一 rejected 回执、非 `command.result`
事件不变，以及除 `event_log`、`event_sequence` 外全库逐表行集不变。复跑扩展层 `channel::tests::` 为 33 passed。
在隔离副本中逐一把 22 处非钉钉 provider 网关放宽为任意 Host：新测试单独杀死 21 处；`account.upsert` 一处由既有
隔离测试杀死。变异所用快照恰逢 C3 改动进行中，既有隔离测试在该快照上本身失败，因此上述判定以新测试在未变异快照
上通过为基线；C3 交付后需在最终代码上重跑扩展层 `channel::tests::`、`application::tests::` 的 Lark 路由用例与
默认 workspace、`pnpm` 门禁，因为 C3 改动生产代码。

C3 与最终复核（2026-09-24）：通过。`channels.lark.account.disconnect` 已移出 Host 路由表并改走用户信封，
`disconnect_feishu_account` 对两家都只认本地 Owner，拒绝文案不再含 “Feishu”。
`lark_disconnect_is_owner_only_and_provider_scoped` 覆盖裁定的 (a)–(c)，路由测试覆盖 (d)。在隔离副本中把
disconnect 网关放宽为 Owner 或任意 Host，(a) 失败；把删除 Developer Session 的条件改为匹配全部 provider，(c) 失败。
最终代码（复核期间 `channel.rs`、`application.rs` 哈希未变）上：临时 Rust 1.90.0 `cargo test --workspace` 为
412 passed、1 ignored、0 failed，无警告；扩展层 `channel::tests::` 与 `application::tests::` 为 90 passed、
4 failed，失败项即上表登记的 `application::` 基线；`pnpm typecheck` 通过；`pnpm test` 通过（vitest 213 个文件、
2241 条）；`git diff --check` 通过。路由与 actor 准入测试仍为函数级，未经 IPC 分发端到端调用。

### 2026-09-24：S4 Contracts、Renderer 与 Web

结论：通过，带交互层限制。

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| Web 准入 | 通过 | `rovai-web` 11 passed：三家 publish/retry 接受且 kind 往返；`selectApprover` 只接受钉钉；`Lark`、`LARK`、`telegram`、空串、null、数字被拒 |
| 页签与提示 | 通过 | 静态渲染断言页签顺序为飞书、Lark、钉钉，Lark 标志与未验收提示只出现在 Lark 页 |
| 账号与错误隔离 | 通过 | 飞书与 Lark 同时连接时各页只显示本家租户、Bot 与管理链接；`channelActionErrorFor` 只把操作错误交给同一 provider；本次修正了此前整页共用操作错误的串状态缺陷 |
| 发布与重试只调用 Lark | 通过（出口级） | Desktop 适配器与 Web 客户端测试断言 `kind: "lark"` 原样透传，且不调用审批人选择；组件内 `provider.kind`、`publishKind` 的使用经代码审查确认 |
| Provisioning 归属 | 通过（审查） | 协调器为每个 provisioning 标注 kind，Renderer 的 `kind ?? 'feishu'` 兜底不会把 Lark 进度显示到飞书页 |
| 门禁 | 通过 | Rust 1.90.0 下 `cargo test --workspace` 共 415 passed、1 ignored，扩展层 `channel::tests::` 33 passed；`cargo fmt --all --check`、`pnpm typecheck`、`pnpm test`（vitest 216 个文件、2267 条）、`pnpm docs:check`、`git diff --check` 通过 |

限制：仓库没有 DOM 测试环境，点击切换页签与点击发布、重试没有交互级测试；组件把错误传给页签和对话框的两处调用
（`ChannelSettings.tsx` 中 `channelActionErrorFor(error, selectedKind)` 与 `channelActionErrorFor(error, publishKind)`）
若被改回直接传全局错误，现有静态渲染测试不会失败。按 provider 隔离操作错误是新增界面行为，
`docs/ui/components/channel-settings.md` 尚未记录。Lark 文案在拉丁词与汉字之间没有空格（如“Lark连接”“Lark管理”），
与 Main 出口改写的加空格规则不一致，属于文案一致性问题，不阻断。

### 2026-09-24：Principal 开发实例冒烟

Principal 在隔离 userData 的开发实例中用真实 Lark 账号试 Q1，暴露两处 Main 缺陷，自动化测试均未覆盖。两处都已修正，
但真实租户的 Q1 结论仍由[真实租户验收记录](lark-tenant-qualification.md)判定。

| 发现 | 根因 | 修正与证据 |
| --- | --- | --- |
| 点击 Lark“登录开放平台”报 `Invalid channel kind` | Desktop IPC 的 kind 校验只放行飞书与钉钉；Main 测试直接调用协调器，Renderer 测试模拟 IPC，中间层无人覆盖 | 改为按 `ChannelKind` 穷举的放行表，遗漏新 provider 时 typecheck 失败；准入测试由川行补齐 |
| 扫码与身份读取成功后，停在“暂时无法确认连接是否保存完成”，核对保存结果无效 | Main 以固定 `feishu-user` 计算 `userIdDigest`，Core 按 `<provider>-user` 校验，Lark 提交在进入命令网关前即报错，Main 将其当作结果未知反复重放 | Main 按 Profile 的 provider 计算摘要；新增飞书与 Lark 参数化测试，恢复旧实现时 Lark 用例失败 |

同一次尝试中，`accounts.larksuite.com` 的二维码初始化、轮询、扫码确认，以及 `open.larksuite.com/app` 的交接均返回
HTTP 200，并进入身份读取阶段。这是沿用飞书 Passport 取值可在 Lark 站点完成登录前半段的首个真实证据，完整结论待
重新扫码并完成本地提交后判定。

遗留观察：Core 对非法 payload 直接返回错误而不写 rejected 回执，Main 无法区分确定性校验失败与传输失败，只能提示
核对保存结果。这是飞书既有行为，本次不改，另行评估。

### 2026-09-24：合入上游并改号为 v1.70

以上 S1 到 S4 与冒烟记录，都是在基线 `ec290dc6` 上、以 v1.67 与 Migration 171 的编号取得的证据。上游随后发布了
v1.67（Task 去版本化）、v1.68 与 v1.69，占用了 Migration 171、172 与数据合同 v1.68 / schema 122。本版因此把本地
快照提交摘到上游 `4c726560` 之上，并整体改号：

| 项 | 原编号 | 改号后 |
| --- | --- | --- |
| 版本文档 | `docs/versions/v1.67`、V1.67-D01 | `docs/versions/v1.70`、V1.70-D01 |
| Lark 迁移 | Migration 171 | Migration 173，接在上游 171、172 之后 |
| 数据合同 | v1.67 / schema 121 | v1.70 / schema 123 |
| 合同引用 | ContextManifest Evidence v27 | ContextManifest Evidence v29 |

文本冲突只出现在 `db.rs` 的迁移链和合同版本、三个文档索引，以及 v1.67 版本目录的同名文件；上游的 v1.67 版本文档
原样保留。`application.rs`、`context.rs`、contracts、Web 与样式虽然自动合并，但语义要在新基线上重新编译和测试确认。
改号后的门禁结果补记在本节，补记前矩阵中的门禁行不视为通过。

改号后门禁（验真，2026-09-24，提交 `c29338fb`，上游 main `7ec57722`，Rust 1.90.0）：首轮**阻断**，修正本版测试 fixture 后除上游自带失败外均通过。

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| `cargo fmt --all --check` | 通过 | 无差异 |
| `cargo test --workspace` | 失败（上游自带） | `--no-fail-fast` 下 413 passed、1 failed、1 ignored。失败项 `runtime_platform_admission::tests::platform_evidence_revisions_bind_their_frozen_source_bytes`：上游 #525 修改了 `docs/runtime-compatibility.md`，没有同步 `MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION`；本提交未改该文件，`git archive 7ec57722` 未改副本同样失败 |
| `pnpm typecheck` | 通过 | 无错误 |
| `pnpm test` | 失败（本版） | vitest 217 个文件中 1 个失败，2272 passed、1 failed：本版新增用例 `apps/web/src/client.test.ts` 的 “sends the Lark provider kind unchanged for publish and retry” 在登录 fixture 中写死 `protocolVersion: 3`，上游已把 `HOST_WEB_PROTOCOL_VERSION` 升到 4，会话被拒绝 |
| `pnpm skills:test`、`pnpm skills:check` | 通过 | 12 个 Skill |
| 扩展层 `db::`、`application::`、`channel::` | 与上游一致 | 本提交 151 passed、43 failed；上游未改副本 147 passed、43 failed；两边失败名单逐条相同（db 39、application 3、channel 1），无新增失败 |
| Lark 定点用例 | 通过 | 迁移结构等价、两条渠道隔离、actor 路由、Charter，以及上游 `v171_removes_task_versions…`、`v172_preserves_historical_context…` |
| 审查：v172 测试断言 | 通过 | 由 `Current` 改为 `SupportedMigrationSource` 且精确为 v1.68 / 122，与上游 v171 测试迁移后断言 `SupportedMigrationSource(_)` 的先例一致且更严；旧写入拒绝与重开后历史字节不变的断言保持不变 |
| 审查：丢弃旧迁移测试链尾调用 | 通过 | 失败名单与上游逐条相同，没有一条因丢弃而新增失败 |

修正与复跑：本版测试 fixture 的 `protocolVersion` 由 3 改为 4，与上游 `HOST_WEB_PROTOCOL_VERSION` 一致，未改生产代码。
修正后砚舟在同一基线复跑 `pnpm test`，退出码 0，vitest 217 个文件、2273 条全部通过。Rust 的那条失败属于上游 main：
冻结证据哈希应由上游更新，本版不修改 `docs/runtime-compatibility.md` 或对应常量，并在 PR 中写明 CI 的 Rust 检查会因此失败。

### 2026-09-25：第二次改号为 v1.71

Draft PR #530 打开后，上游合入 #517（Skills Rebuild），占用了 v1.70、Migration 173 与数据合同 v1.69 / schema 123，
ContextManifest Evidence 也升到 v30。按 Issue #523 “版本号顺位继承”的约定，本版 rebase 到上游 `96aa85e9` 并再次改号。
上一节的门禁证据属于 v1.70 编号时的提交，不能沿用。

| 项 | 第一次改号 | 第二次改号 |
| --- | --- | --- |
| 版本文档 | `docs/versions/v1.70`、V1.70-D01 | `docs/versions/v1.71`、V1.71-D01 |
| Lark 迁移 | Migration 173 | Migration 174，接在上游 173 之后 |
| 数据合同 | v1.70 / schema 123 | v1.71 / schema 124 |
| 合同引用 | ContextManifest Evidence v29 | ContextManifest Evidence v30 |

上游 v1.70 的版本文档原样保留，只把其概览与版本决定的生命周期改为 historical，并补上后续链接；这是“唯一 current 版本”规则
要求的，不改变上游的实施状态。改号后的门禁结果补记在本节，补记前矩阵中的门禁行不视为通过。

改号后门禁（验真，2026-09-25，提交 `049e202e`，上游 main `44c461f3`，Rust 1.90.0）：**通过**。

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| `cargo fmt --all --check` | 通过 | 无差异 |
| `pnpm test:rust:pr` | 通过 | 422 passed、1 ignored、0 failed |
| `pnpm typecheck` | 通过 | 无错误 |
| `pnpm test` | 通过 | vitest 217 个文件、2279 条；node 测试 326 passed |
| `pnpm skills:test`、`pnpm skills:check` | 通过 | 12 个 Skill |
| 扩展层 `db::`、`application::`、`channel::` | 与上游对照无新增失败 | 本提交 43 条失败（db 39、application 3、channel 1），是 `git archive 44c461f3` 未改副本 44 条失败的真子集；少掉的一条是下文审查 (a) 的 preflight 用例 |
| Lark 与迁移定点用例 | 通过 | 迁移结构等价、两条渠道隔离、actor 路由、Charter，以及上游 v171、v172、v173 迁移测试 |
| 审查 (a)：preflight 用例改号 | 通过 | 该用例断言全新建库的迁移状态等于当前全链，并拒绝未来版本 store；上游仍断言 `migration_state_through(172)`，#517 加 v173 时漏改。改为 174 只随 current 前进，拒绝未来 store 的断言未改 |
| 审查 (b)：产品合同期望值 | 通过 | `collectProductContractFingerprint()` 用正则从源码常量读取（如 `PUBLIC_CAMP_BATCH_CONTEXT_MANIFEST_VERSION`），不读测试期望；在本提交上实测为 v1.71 / 124、ContextManifest 30、Formatter 30、DeliveryProfile 10，其余不变。上游测试仍期望 v1.67 与 28，而上游常量已是 v1.69 与 30，故上游本身失败 |
| 语义抽查 | 通过 | `FEISHU_FILE_DELIVERY_GUIDANCE` 只在 `conversation.provider = 'feishu'` 的绑定下注入；新增冻结工具箱 section 后，Charter 测试中 Lark 负向分支仍通过 |

## Rust 测试准入

S1 不新增测试，以既有飞书与钉钉测试不改断言全绿作为行为不变的证据。S2 新增的测试只覆盖新边界：结构等价、跨
provider 隔离、错误 provider 拒绝、actor 路由、中立表重建与 Charter 负向断言；它们无法由既有断言表达。新测试扩展
`channel.rs` 与 `db.rs` 已有的渠道和迁移测试 owner，不建立平行 fixture。
