---
document_type: implementation-plan
version: v1.72
authority: version-implementation-and-acceptance
status: in_progress
last_updated: 2026-10-03
---

# v1.72 实施与验收

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


## 2026-09-27 合并主线与审查修复

对齐主线 `762370b1`（包括 #548 钉钉入站附件）：保留 public history claim Migration 174，Lark 建表顺延为 Migration 175，数据合同为
v1.71 / schema 125；ContextManifest/Formatter 沿用主线 31。降级 fixture 按相反顺序还原，旧迁移与结构检查继续保留。
主线的持久入站下载保持飞书、钉钉范围，Lark 不进入尚无消费者的下载队列。

- 话题派发：补齐 Lark roster 身份、按 provider 隔离的 Host 刷新请求、发布状态和成员存在性校验。
- 标题：共享 `CampChannelSource`/formatter 增加 Lark 三种来源；搜索可匹配前缀，重命名不写入前缀。
- 新增测试 owner：`message_delivery::tests::topic_dispatch_waits_for_its_provider_roster_and_checks_its_published_bot`。
  它以最小 SQLite fixture 验证持久等待到放行的状态转换和跨 provider 冲突；现有 channel membership 测试只验证
  Camp roster 同步，不能证明派发等待门禁。修复前 Lark 首次派发直接放行，且 Bot 查询错误依赖飞书表。
  最小命令：`cargo test -p rovai-core --lib topic_dispatch_waits_for_its_provider_roster_and_checks_its_published_bot`。
- 标题与导航搜索扩展现有表驱动/搜索测试；迁移测试保留原有回滚、数据保留和结构等价断言，更新实际来源为 174。

本轮验证代码为 `c80c48a8`（含主线 `762370b1`），结果如下；真实租户未验收项保持原状态。

| 验证 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm exec vitest run --maxWorkers=2` | 219 个文件、2311 项通过；高并发两轮分别出现 2、3 项超时，定点复跑及降低并发后的全量均通过，未修改超时阈值或禁用用例 |
| `pnpm build:desktop` | Web、Main、Preload、Renderer 构建通过 |
| `cargo test --workspace -- --test-threads=4` | 434 项通过、1 项既有忽略，无失败 |
| `cargo test -p rovai-core --features extended-tests --lib -- channel::tests:: db::tests::lark_migration db::tests::v171_ db::tests::v172_ db::tests::v173_ db::tests::current_migration_state_admission_matrix db::tests::database_contract_preflight` | 41 项通过，包含飞书、钉钉、Lark 渠道回归、迁移 171–175 衔接、结构等价、回滚和历史数据保留 |
| `cargo test -p rovai-core --features extended-tests --lib lark_actor_routes_are_closed_and_payload_cannot_supply_authority` | 1 项通过 |
| `cargo fmt --all --check` | 通过 |
| `node --test scripts/benchmark/protocol/product-contract.test.mjs scripts/lib/channel-camp-naming.test.mjs` | 2 项通过；命名验收使用独立临时 userData 和 Skill Library |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=762370b1a741c4942aed9a130941acbbf72b4990 pnpm docs:check:ci` | 10 项文档测试及全部通用门禁通过 |
| Standards / Spec 独立复核 | 两条检查线均通过；同步 #548 后补查未发现新增问题 |

本轮没有运行真实 Lark 租户操作，也未把既有能力 Gate 改为已验证。


## 2026-09-27 同步通知模型主线

上一轮验证及 CI 通过后，主线合入 #549（`3b49137b`），通知模型占用 v1.71、Migration 175、schema 125。
保留该版本的完整文档与生产迁移，Lark 文档顺延到 v1.72，建表迁移为 Migration 176，数据合同为 v1.72 / schema 126。
更新迁移来源准入、反向 fixture、产品合同指纹及当前文档路由；新建库和升级先完成 175，再执行 Lark 176。
原有逐项验收记录保留当时版本号和基线，不改写为新的验证证据。

本轮以主线 `3b49137b` 为基线，对完成冲突处理的代码重新验证：

| 验证 | 结果 |
| --- | --- |
| `cargo test --workspace -- --test-threads=4` | 435 项通过、1 项既有忽略，无失败 |
| `cargo test -p rovai-core --features extended-tests --lib -- channel::tests:: db::notification_model::tests:: db::tests::lark_migration db::tests::v171_ db::tests::v172_ db::tests::v173_ db::tests::current_migration_state_admission_matrix db::tests::database_contract_preflight application::tests::lark_actor_routes` | 43 项通过；覆盖通知 175→Lark 176、结构等价、回滚、历史数据保留、渠道隔离与 actor 路由 |
| `pnpm exec vitest run --maxWorkers=2` | 219 个文件、2313 项全部通过 |
| `pnpm typecheck`、`pnpm build:desktop` | 类型检查及 Web、Main、Preload、Renderer 构建通过 |
| `node --test scripts/benchmark/protocol/product-contract.test.mjs` | 1 项通过，指纹为 v1.72 / schema 126 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=3b49137b0e4e24ed1f84251efe6645b6c7b68578 pnpm docs:check:ci` | 10 项文档测试及全部通用门禁通过 |
| Standards / Spec 独立复核 | 均通过；通知版本文档和生产迁移保留，Lark 编号、迁移顺序、来源准入及反向 fixture 一致 |

真实租户验收状态保持不变。

## 2026-09-27 Lark 入站附件补充

基线为主线 `0f7b101a`。先前“Lark 不进入下载队列”是当时尚无 Lark 完成请求时的范围记录；本次按
[V1.72-D03](decisions.md#v1-72-d03)补上第 21 个 `channels.lark.*` 请求，并让 Lark Host 复用资源提取、
持久队列、消息准入与 Source Ref。请求名确定 `lark-channel-host`；飞书 Host 的完成结果不能结算 Lark Request。

验收范围：飞书与 Lark 参数化的流式下载、临时文件清理和文件夹失败提示；Core Lark 资源观察、队列领取、
错误 Host 拒绝、正确 Host 完成及 Agent 消息的 Source Ref。真实 Lark 租户的消息资源权限和客户端文件行为
仍未完成逐项验收。

| 验证 | 结果 |
| --- | --- |
| `pnpm exec vitest run apps/desktop/src/main/channel-settings.test.ts --maxWorkers=2` | 78 项通过；包含飞书与 Lark 的下载恢复、去重和文件夹失败路径 |
| `pnpm exec vitest run apps/desktop/src/main/feishu-inbound-attachments.test.ts apps/desktop/src/main/channel-settings-coordinator.test.ts --maxWorkers=2` | 15 项通过 |
| `pnpm typecheck`、`pnpm build:desktop` | 类型检查及 Web、Main、Preload、Renderer 构建通过 |
| `cargo test -p rovai-core --features extended-tests --lib wrong_provider_hosts_are_rejected_by_every_lark_capable_handler` | 1 项通过；覆盖 Lark 附件的 provider 隔离与 Agent 输入路径 |
| `cargo test -p rovai-core --features extended-tests --lib inbound_attachments_` | 2 项通过；飞书与钉钉原有准入、重试、失败、删除及 20＋2/FIFO 回归 |
| `cargo test -p rovai-core --features extended-tests --lib lark_actor_routes_are_closed_and_payload_cannot_supply_authority` | 1 项通过；新完成方法由 Lark Host 执行，payload 不可自报 actor；飞书、钉钉原有完成方法仍有各自 Host 路由 |
| `cargo fmt --all --check`、`pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=0f7b101a226da2158f1de0fe95baead27e4c47ae pnpm docs:check:ci` | 格式与文档通用门禁通过 |

## 2026-09-27 侧栏与 Skills 并行切片

侧栏按 [Navigation Read v1](../../contracts/navigation-read-v1.md) 实施单 Camp、单分组与摘要完整快照读取。
从主线 v1.72/schema 126 经 Migration 177 升为 schema 127：camp 增加三项摘要字段，消息首次发布和 Agent
消息撤回在原事务维护，保留 camp_view_state 已读；新增业务表为 0。普通切换只处理目标 Camp，状态与成员变化按已知
范围刷新，缺可信基础时从摘要恢复完整快照。SQL 分组窗口替代先读全体再截断，正常读取不聚合历史事件。
Skills 则在现有 NativeSkillDiscovery 内改为 128 目录、300 秒 TTL 的原始元数据缓存，合并同目录在途扫描和一次
Camp 手动刷新中的重复目录；Settings 与选择器仍按需同步返回，不增加启动预热或后台订阅。

测试准入：`navigation_summary_migration_preserves_tables_backfills_and_rolls_back_with_events` 独立拥有 schema 126→127
的回填、表集合不变、receipt 失败回滚、摘要事务一致性与重启边界；必须用 SQLite，现有迁移 owner 不覆盖这些事实。
`navigation_reads_no_history_and_scoped_work_does_not_grow_with_other_groups` 在 SQLite authorizer 禁止 event_log
读取时验证行、组、完整、分页与已读，并用 2,000 个无关 Camp、50,000 条历史事件验证局部读取工作量。
最小命令分别是 `cargo test -p rovai-core --lib --features extended-tests navigation_summary_migration` 与
`cargo test -p rovai-core --lib --features extended-tests navigation_reads_no_history`；Skills 目录共享/强刷去重由
`native_skills::tests::shared_directory_keeps_runtime_paths_and_refreshes_once_per_request` 拥有。

此前在隔离 Core 中对 342 Camp、18 组、57,000 条人工历史事件的 30 次请求测得：完整侧栏中位数
61.76→9.95ms，排在它后面的打开请求 38.47→13.24ms，单行/单组读取为 0.61/0.87ms。
这是同步当前主线前的顺序阶段测量，不能当作本次合并后的点击到绘制验收；最新主线集成门禁另行记录。

合并主线 `0f7b101a2` 后的集成验证：Rust 默认 workspace 436 项通过、1 项既有 ignore；导航 Migration 177、
无历史读取、回复首次发布／撤回、Lark Migration 176 定向测试通过。Vitest 219 文件／2,317 项、TypeScript
检查、Desktop 构建、Product Contract Fingerprint、Rust 格式及通用文档门禁通过。未运行日常 App 的真实点击到绘制复测。

## 2026-09-28 渠道网页执行台还原

Principal 确认本地交互稿后，以主线 `41aa0e2e` 为实施基线，完成飞书、Lark、钉钉共用的只读网页执行台。
网页阅读面从生产 Renderer 复用 `ToolActivityGroup`、`ExecutionStatusGlyph`、`SafeMarkdown`、Run 卡片 CSS 与主题 Token；
独立 Vite 入口随 `pnpm dev` / `pnpm build:desktop` 生成同源静态资源，由原局域网服务按固定白名单提供。
原 `channels.executionConsole.webSnapshot`、Bearer grant、SSE 和公开字段范围保持原有权威边界；网页没有新增私有 Evidence 读取、文件预览、停止或重跑入口。

| 验证 | 结果与边界 |
| --- | --- |
| `pnpm typecheck`、`pnpm build:desktop` | 通过；Web、只读执行台、Main、Preload、Renderer 均构建成功 |
| `pnpm exec vitest run --maxWorkers=2` | 222 个文件、2348 项通过；网页服务 owner 覆盖只读页面与静态资源白名单、公开 Snapshot 授权及 SSE |
| `pnpm test:rust:pr` | 通过；default-feature Rust workspace 无失败 |
| 文档治理与版本门禁 | 在仅含 Git 跟踪文件的源码快照运行 Decision 单元测试（10 项）、版本检查及含 `--require-base` 的 PR 差异检查，均通过 |
| 其余 `pnpm test` 子门禁 | 在原 checkout 逐项运行：Skills 测试 3 项、Skills 检查 12 项、Electron sandbox 测试 7 项、Node 测试 346 项通过且 2 项跳过 |
| Chrome 局域网预览 | 使用固定公开演示 Snapshot，在桌面与 390px 手机宽度核对交互稿；Run 标题只切换触发消息，历史区与 Command 独立展开，结果保持只读；未连接真实渠道或 Runtime |
| Impeccable 机械检查 | 对新网页入口、样式与页面壳运行一次 detector，结果 `[]` |

本机 Git 忽略的旧 `docs/prototypes/` 含失效相对链接，直接在原 checkout 运行 `pnpm test` 会在文档检查阶段被这些未提交文件拦截；
提交范围内的文档门禁在干净源码快照复核，其余测试按相同子命令在原 checkout 复核，不改动该本地原型目录。

## 2026-09-28 当前版本发布日期

v0.4.0 的 `build/release-metadata.json` 使用[正式 GitHub Release](https://github.com/murray17/rovai-ai/releases/tag/v0.4.0) 的 `publishedAt`：
`2026-09-25T18:30:52.000Z`。Desktop Main 与 Desktop 托管 Web 将其随包编译，并只在运行版本一致且日期规范时
投影给当前版本；候选版本仍取 updater 返回值。缺失、旧版本或无效值维持日期未知。桌面构建入口增加源文件
前置校验，使后续版本提升必须同时更新日志与日期。

| 验证 | 结果与边界 |
| --- | --- |
| `node --test scripts/lib/release-notes.test.mjs`、定向 App Update Vitest | 6 项源校验与 28 项 Main/Renderer 测试通过；覆盖版本不符、无效日期、离线快照、成功检查后保留日期及页面日期呈现 |
| `pnpm typecheck`、`pnpm build:desktop`、`pnpm test` | 通过；构建输出的 Main、Renderer 与 Web 均包含版本绑定时间戳 |
| `pnpm test:rust:pr` | 通过；共享 Rust workspace 无回归 |
| `pnpm package:mac`、`pnpm accept:app-updates-ui` | 通过；隔离打包 App 在 Day/Night、1440×920、1040×700 及 200% 等效宽度下，快照日期与页面一致；当前时区显示 2026 年 9 月 26 日，无横向溢出 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=<本次 origin/main 基线> pnpm docs:check:ci` | 通用文档治理、版本与 PR 差异门禁通过 |

正式签名发布和跨版本升级不在这次本地验收范围；本次打包只验证版本绑定的离线日期投影。

## 2026-09-29 候选版本发布日期兼容

对[正式 v0.4.1](https://github.com/murray17/rovai-ai/releases/tag/v0.4.1) 清单的复现确认：合并后的
`latest-mac.yml` 将 `releaseDate` 输出为无引号时间戳，`electron-updater` 自身的 YAML 解析器返回
`Date` 对象；Main 原先仅接受字符串，导致候选日期变成 `null`。同版本 Windows 清单仍保留字符串，
不触发该缺陷。此前随包日期修复覆盖的是已安装版本，未覆盖这一生成端与消费端的类型差异。

macOS 清单序列化启用 YAML 1.1 字符串兼容，保留旧客户端所需的字符串类型；Main 接受有限时间戳的
`Date` 对象并转换成 UTC ISO 字符串，无效日期仍为 `null`。App Update v6 的公开字段与版本来源不变。

| 验证 | 结果与边界 |
| --- | --- |
| 生成端与 Main 回归 | 两项新增回归在修改前分别复现日期类型变化及候选日期丢失；修复后 macOS 清单 6 项、Main/Renderer 36 项通过，覆盖实际 Provider 解析、已安装日期独立保留及无效日期 |
| `pnpm typecheck`、`pnpm test`、`pnpm build:desktop` | 通过；Main 与发布清单生成链路可编译，完整 TypeScript/Node 回归通过 |
| `pnpm test:rust:pr` | 本机基线失败：Core lib 391 通过、1 失败、1 忽略，后续 workspace target 未执行。`read_probe_tolerates_only_a_new_empty_wal_not_authority_changes` 假定新文件没有 `com.apple.provenance`，实际已存在；单独重跑同样失败。`Cargo.toml`、`Cargo.lock`、`crates/` 与 `.cargo/` 对主线基线 `ab6f67fb` 无差异 |
| 文档门禁 | `pnpm docs:test` 与带真实基线 SHA 的 `docs:check:ci` 通过 |
| 已发布清单的修补预演 | 对 v0.4.1 清单重新序列化，仅增加日期引号；解析后的字段值、文件地址与安装包哈希一致，配套 checksum 仅更新清单一行。该预演不表示已替换远端 Release 资产 |

此项未重新打包、签名或安装 App；本地生成物与现有公开发布资产分别记录。

## 2026-09-30 Claude Code 原生双向审批

PR #592 的审批通道替换为 stream-json 输入/输出和 stdio 原生控制请求。删除审批 command Hook、专用 IPC
与完整输入匹配缓存；按 request_id 回填、按 tool_use_id 结算。Action/Approval 与历史数据复用既有表，
用户配置冻结，Fast settings 和 `rovai send` 业务 lease 保留。stdin 在协议初始化后投递任务，在末轮
结果与 Session idle、无未决请求/任务后关闭；异常有界清理。合同与理由见
[Runtime Launch v45](../../contracts/runtime-launch-and-verification-v45.md)和[V1.72-D06](decisions.md#v1-72-d06)。

原 2026-09-29 的 CLI 2.1.274 Hook Smoke 和组件夹具已不构成本实现验收证据。当前原生协议的确定性、
真实 Core 与实际 Desktop 点击验收如下；完整回执见[Runtime 兼容性清单](../../runtime-compatibility.md#claude-code-原生双向审批2026-09-30)。

| 验证 | 结果与边界 |
| --- | --- |
| 控制协议确定性矩阵 | `cargo test -p rovai-core --features extended-tests --lib claude` 44 项通过、1 项人工目录 Smoke 忽略。初始化失败、模式漂移、缺少可靠工具 ID 拒绝；256 次普通工具后仍审批；相同命令的并发请求按独立 ID 回填；取消/断线撤回已排队允许；长审批/后台任务暂停计时，两个官方任务终态形态解除跟踪；多结果与 idle 联合决定 stdin 关闭 |
| 既有 Action 事务 | 慢速 native-resolution owner 1 项通过；在原 SQLite fixture 内覆盖已交付响应的 ACK，以及 Codex/Claude 未决 Approval 取消、实际 Runtime 来源署名 |
| 真实 Core 审批 | CLI `2.1.280`，冻结 `acceptEdits`；允许一次后真实发送并根据工具结果结算，拒绝后无消息/回执，待审批取消为 `not_executed` |
| 完整 Claude 回归 | `ROVAI_CLAUDE_APPROVAL_SMOKE=1 node scripts/smoke-claude-runtime.mjs` 通过；新 Session 与同 Session resume、Runtime model、文本、工具输出、真实 Edit mutation、取消进程树及允许/拒绝/待审批取消均覆盖。多结果末轮输出与用量保留由上述 reader 确定性测试拥有 |
| 实际 Desktop 点击 | 真实 `pnpm dev`，隔离 userData/Skill Library/MCP；实际点击 Dock 的允许与拒绝，直接核对 Core Native Session binding 事件相同、两次 Shell canonical argv 完全一致、Action digest 相同但 Action/request digest 独立，分别真实发送和无新增消息/回执。保存四张截图与结果 JSON；这次未打包或安装日常 App |
| TypeScript / JavaScript 回归 | `pnpm typecheck`、`pnpm test` 通过；Vitest 222 文件/2376 测试，Node 业务协议 328 通过/2 跳过，文档治理 10 项通过 |
| 默认 Rust 门禁 | `pnpm test:rust:pr` 本机 394 通过、1 失败、1 忽略；失败仍是未改动的 `database_admission::tests::read_probe_tolerates_only_a_new_empty_wal_not_authority_changes` 对已有 `com.apple.provenance` 的假设，后续 workspace target 被该失败阻断。未删除、禁用或修改该测试 |
| Rust 后续目标补充检查 | 显式 `--skip database_admission::tests::read_probe_tolerates_only_a_new_empty_wal_not_authority_changes` 后，workspace 共 438 通过、1 忽略、1 过滤；Core bin、CLI、Host、Web 和 doc-tests 均完成。最终 compatibility source digest 的独立定向测试通过；这不改写默认门禁失败结论 |
| 文档治理 | `pnpm docs:test`、`pnpm docs:check` 和真实 PR base `cb9cd309593cc9403cddd25ce9cf0a114863063a` 的 `docs:check:ci` 通过 |

推送 `7f14abae` 后同步主线 `a39cf861`（#593 执行文案与 #594 Agent 指令英文化）。唯一冲突位于当前版本
概览，保留两项交付与各自生效边界；原生控制生产路径没有冲突。合并后 `pnpm typecheck`、
`cargo check --workspace`、44 项 Claude 定向回归（另 1 项人工 Smoke 忽略）及以
`a39cf861d8f2dd8db4f78603838d57c131958d2e` 为真实基线的文档 CI 门禁通过。上表完整回归与实际
Desktop 点击证据属于 `7f14abae`，未将主线同步冒充新的实际模型验收。

## 2026-09-30 Claude 原生选项与规则记忆

在主线 `df7f7abd1a43b9e1002d6974e693f79e2f0b0f0c` 上补充原生建议的规则记忆。stdio 请求没有按钮标签数组，
使用本机 Claude Code `2.1.280` 可核实的原生 `Yes`、`No` 和 `Yes, and don’t ask again for: …` 模板。
ACP 原生标签和 Codex 的固定英文决定标签原样展示；Claude 同样不随界面语言翻译。旧 Claude Approval 的两个
中文 host 标签只在展示时兼容，不修改历史冻结响应和 ID。Core 自有审批文案继续按界面语言显示。

有效 addRules/allow 建议分别冻结为记忆选项，原生范围保留在按钮标签，destination 保留在冻结元数据；允许一次不携带权限更新。
记忆决定原样回填 selected suggestion，Claude 负责规则保存与未来匹配；suppression 或无效/未支持建议
不会产生记忆选项。控制 writer 与转换层共用建议准入，只保存未决请求有效记忆响应的 digest，完成、取消和
断线时清理；响应的范围、destination 或 input 改动不能通过校验。当前合同见
[Runtime Launch v46](../../contracts/runtime-launch-and-verification-v46.md)。

| 验证 | 结果与边界 |
| --- | --- |
| Claude 确定性回归 | `cargo test -p rovai-core --features extended-tests --lib claude` 44 项通过、1 项人工目录 Smoke 忽略。扩展既有纯转换及 writer/reader seam owners，覆盖建议精确透传、四种 destination、suppression、重复/无效建议、独立响应 digest、规则范围/目的地篡改、跨请求借用和取消/断线后的迟到记忆写入；原有 256 次普通工具、并发、初始化、多结果和收尾测试保留 |
| 生产 ApprovalDock（`69acb895`，布局调整前） | `pnpm test:approval-dock` 通过；中英文界面均保持 Claude 原生英文，语言切换保留 optionId/digest。Core 标签继续本地化，其他 Runtime 标签保持原样。当时记忆 scope 可见且作为无障碍描述，长规则在桌面与手机换行，44px 控件、完整请求和队列焦点边界保留；后续展示收敛见下节 |
| 类型与格式 | `pnpm typecheck`、`cargo fmt --package rovai-core -- --check` 通过 |
| 真实 Desktop 点击 | CLI `2.1.280 (Claude Code)`、冻结 acceptEdits，独立临时 userData/Skill Library/MCP 与 Git 项目；依次实际点击 Yes、No、记忆，Action 分别 succeeded/not_executed/succeeded。三个相同命令的请求与 Action ID 独立，使用同一 Native Session；允许与记忆各有对应 Run 的 Core receipt 和 exact message，拒绝均无发送 |
| 原生保存与后续执行 | Claude 写入隔离项目 `.claude/settings.local.json`，allow 数组仅含本次选中 `Bash(rovai send *)`，无 bypass 模式。第四个 resumed Run 没有新增 Approval，仍产生独立 Core send receipt 与 exact message；结果 JSON、七张真实截图和 native button source 证据保存在任务附件中 |
| UI 检查 | 对三个改动 UI 文件执行 Impeccable detector，文件中 116 项既有报告，本次改动行零命中；结合生产桌面/手机截图人工核验，未新增忽略规则 |

首轮真实记忆点击发现旧 writer 只允许不带 updatedPermissions 的响应，导致批准后的投递失败、Action unknown，
验收在 240 秒上限内失败并清理隔离进程。保留失败证据后补齐精确建议 digest 校验，再以全新隔离环境完成上表
全部真实点击与第四轮发送验收；没有用旧允许/拒绝结果代替记忆证据。本补充只验证开发版，未重新打包或安装日常 App。

## 2026-09-30 审批选项展示收敛

按用户确认去掉左下方配置文件与 destination 说明，移除记忆选项独占整行的包装。Desktop 和 Mobile
共享按内容宽度排列、空间不足自然换行的选项区；Claude 三个选项放得下为一排，放不下为两排。
原生英文标签与其中的规则范围完整保留，Mobile 控件保留至少 44px 触控区域。冻结 optionId、响应 digest、
规则保存和审批投递不变；本次只调整展示及既有验收夹具。

`pnpm test:approval-dock` 通过：无 Core/Runtime 的隔离生产组件在桌面宽屏与 430px 手机视口为一排，
375px 手机视口为两排；长标签、配置文件说明隐藏、原生决定身份、实际按钮点击与长选项列表滚动均通过。
`pnpm typecheck`、`pnpm docs:test`、`pnpm docs:check` 与真实分支基线 `df7f7abd` 的文档 CI 门禁通过。
上节 Claude Code `2.1.280` 真实 Desktop/发送证据属于布局调整前的 `69acb895`，不作为本次新布局的实际 Runtime 验收。


## 2026-10-02 Sidecar v3 交互实现

Principal 确认 v3 HTML 后授权实施、创建 PR 并合入 main。本次范围保留既有 Porcelain Day / Steel Night、
270px 默认宽度与 200–420px 调宽、项目 34px / 对话 28px 行高，不替换视觉世界。

- 项目和对话的右键、三点、Shift+F10 / ContextMenu 与触屏长按使用同一菜单；右键不导航或折叠，
  Escape 恢复行焦点，滚动和失焦关闭。项目行的创建图标复用既有 New Chat，增加原生目录定位与复制路径。
- 操作默认隐藏，选中行也不常驻。运行环与未读点独立并列，悬浮/可见焦点/菜单打开时隐藏状态簇，
  最右侧显示三点；标题空间不变。运行环 Day 为 `#7a7d80`，Night 为 `#a2a6aa`。
- 导航偏好 schema 5 保存手动提醒与本机 read-through；合法旧 schema 2/3/4 读取不重写或降级。
  串行原子保存、失败保留旧值、重启恢复和其他窗口/标签页同步均保持。Core schema 与真实查看水位不变。
- 标记已读仅覆盖当前已知回复。聚焦、后台刷新和 Run 结束不清除手动提醒；显式完整打开（含历史导航）
  才清除。取消离开、打开失败与缓存预览保留提醒，再次打开预览可以重试完整投影。

验证：`pnpm typecheck`、`pnpm test`（225 个 Vitest 文件，2428 项；随后 Node owner 328 通过、2 平台跳过）、
`pnpm test:rust:pr`、`pnpm test:desktop-bridge`、`pnpm test:startup-presentation`、`pnpm test:navigation-shell`
与 `pnpm build:desktop` 通过。Electron 验收使用独立临时 userData，不启动 Core、SQLite 或 Runtime。
真实原生输入覆盖双状态、悬浮替换/标题稳定、菜单位置/边界、两种入口、键盘焦点、读状态切换/重启、
目录定位传参、路径复制、远程 Web 缺少原生入口及 200px 布局；Day/Night、默认/悬浮、两类菜单和窄栏截图已人工核对。

默认 Rust 门禁发现既有 namespace comparator 测试假设临时文件没有 `com.apple.provenance`，当前 macOS
自动加标签会打破该假设。在原 owner 内显式构造无标签的旧观察值，继续使用真实带标签文件并保留 authority
变更的拒绝断言；无新增、删除或禁用 Rust 测试，生产数据库 admission 逻辑不变。

本次可逆行操作沿用既有导航权威，无新增 Version Decision 准入事项。当前 Contract、Architecture 与 UI 同步更新，
版本指针与 Runtime/Context 合同确认无需变化。

## 2026-10-02 AI 优先添加队员

Principal 确认实现并要求独立 worktree、PR 到 main 后合入。工作基线 `9028e5fb`，分支
`rovai/ai-first-member-creation`。本切片保留队员页右侧信息/Runtime 表单与离队资料；只调整名册入口、
直接排序、普通草稿会话的起步操作与静态成功卡片。合同与理由见
[Member Creation Flow v1](../../contracts/member-creation-flow-v1.md)和[V1.72-D09](decisions.md#v1-72-d09)。

实现采用单个可用协助者、窗口内草稿 overlay 和现有发送激活事务。Profile、静态回执及最近成功协助者在同一
Gateway 事务中提交；Migration 180/schema 130 增加两张业务表，不改模型上下文或 Skill。

测试准入：扩展现有 `team_tool` 的幂等创建 owner，覆盖回执失败导致 Profile 回滚、重试只出一张卡、改名/离队后快照
不变、Open 可读且不增加消息/会话成员。新增迁移测试独立拥有当时 schema 129→130 原子边界；不复制旧 migration owner。
Renderer 的纯函数覆盖可用性优先、回退和过滤后排序；Electron 使用 production BusinessApp 与隔离内存 transport，
不启动真实 Core/Runtime，不读取日用 userData/Skill Library。

已验证：

- `pnpm typecheck`、`cargo test --workspace`。
- 现有 member-create 扩展 owner 与新 Migration 180 owner。
- `node --test scripts/lib/member-editor.test.mjs`：19 项，含排序保存失败回退、键盘操作、分隔线、设置表单及桌面双主题。
- `pnpm test:member-creation`：14 项，含新空草稿、输入后侧栏、同窗口恢复、发送拒绝、普通激活、静态卡、离队配置跳转、
  无可用协助者手动降级、手机原生触摸拖拽、英文 starter/Return 换行与明暗卡片。
- 人工检查生产 fixture 的桌面入队卡、390px 英文名册及手机夜间入队卡，未见水平溢出或头像遮挡。

合并主线 `63225393` 后，本切片顺延为 Migration 180/schema 130、V1.72-D09；新旧 Migration 的完成准入逐级衔接。
`pnpm test` 全通过：226 个 Vitest 文件/2,431 项，Node 回归 328 通过、2 项平台跳过。`pnpm build:desktop`、
Typecheck、Rust format 与基于 `63225393` 的文档门禁通过。Open 的 3 项慢测试证明零 event-log 读取、
标题分页稳定与无关会话规模不扩大读取。最终 `cargo test --workspace` 为 439 通过、1 项人工 Runtime smoke 保持忽略。DB 扩展组 96 项中 95 项首轮通过；
旧 v99 fixture 降级时遇到主线新增的 `agent_v2` 约束，修复 test-only downgrade 后该用例单独复跑通过。
真实模型执行及实体手机软键盘尚未在本切片验收；
隔离 fixture 只证明交互和投影，不宣称模型端到端或发布安装完成。


## 2026-10-02 安装前的双分支迁移收口

合入 main `91b315e9` 时，本机日常库仍是指标预览的 schema 128 / Migration 178。
保留指标分支 178/179 和 Thread 收口 180，User 投影、队员回执顺延为 181/182，当前 schema 132。
main 已部署的 schema 128/129/130 按完整表、约束与连续收据组合识别；补建空指标投影并原子追加缺失收据，
不修改既有收据时间、业务行或冻结输入证据。未知、缺损或混杂布局拒绝升级。

测试继续扩展 `db::thread_names` 的既有双分支收口 owner，增加 main 129/130、收据失败回滚、损坏结构拒绝、
原队员创建回执与偏好保留、重新打开幂等性；没有新增独立 Rust 测试函数。
已安装指标 schema 128 的旧数量与 null 比例仍由 `session_context_migration` owner 验证。
最小命令为 `cargo test -p rovai-core --features extended-tests --lib db::`；
打包验收使用按日常只读 DDL 构造的空 schema 128 fixture，不复制日常业务行或凭据。

## 2026-10-02 队员运行配置应用

Principal 确认交互稿后授权独立 worktree 实现、PR 到 main 并合入。工作基线 `91b315e9`，分支
`rovai/member-runtime-apply`。范围为队员设置中的“应用到其他队员”，不包含新手训练的配置复制。
沿用正式队员页、Dialog、主题和 Runtime 表单；中英文共用状态，手机使用可滚动底部面板和固定操作区。

入口只应用来源队员已保存的 Runtime、模型原生选项和权限；打开时冻结来源配置及目标版本，默认只选未配置队员。
已有配置显示替换前后摘要；目标 Runtime 草稿、保存中与平台只读配置不可选，身份草稿独立保留。
逐队员复用 `members.runtime.set` 和原有目录拒绝恢复，不新增批量命令或数据库结构。
仅有效 applied 回执记为保存成功，部分失败保留已完成项；结果未知先读回核对，不自动重放。
并发冲突重新读取并展示选择，用户复核后才使用新版本提交。提交期间保护关闭与页面导航。

本次是既有命令的可逆界面组合，无新增 Version Decision 准入事项。当前 Architecture、Contract、版本指针和
Runtime/Context 合同无需变化；稳定交互规则同步至 [Member Identity](../../ui/components/member-identity.md#应用运行配置到其他队员)。

已验证：

- `pnpm typecheck`；Runtime 批量恢复、既有单队员保存和语言目录共 21 项 Vitest 通过。
- `pnpm test:rust:pr`：439 项通过、1 项人工 Runtime smoke 维持忽略；没有修改、新增、删除或禁用 Rust 测试。
- `pnpm test:member-runtime-apply`：51 项检查通过，零 Renderer console error，覆盖真实按钮操作、草稿隔离、
  部分失败重试、未知回执读回、并发版本冲突、读取失败恢复和键盘焦点约束。
- 生产组件截图人工核验：桌面覆盖提示、375px 英文夜间、390px 中文日间与 200% 缩放；另外自动检查
  430px 手机、844×390 横屏及 1040/1440/2560 桌面视口、375px 超长队员名、搜索/空状态、两种主题和减少动态效果。
- `node --test scripts/lib/member-editor.test.mjs`：原有 19 项队员编辑验收通过。
- `pnpm test`：227 个 Vitest 文件、2438 项通过；随后 Node 回归 328 项通过、2 项平台跳过。
- `pnpm build:desktop`、文档普通门禁与基于真实 `91b315e9` 的 `pnpm docs:check:ci` 通过。

Electron 采用独立临时 userData/Skill Library 与显式内存 transport，不启动 Core/Runtime 或读取日用数据。
原生 fixture 字段保持原值；上述证据不代表真实模型执行、实体手机或已打包安装。首轮验收末项暴露 200% 缩放下
测试驱动的 CSS/DIP 坐标差，按 zoomFactor 修正点击坐标后全量通过，未以改动产品布局绕过该检查。
最终截图复核修正了短视口继承旧 `.dialog-actions` 背景的问题；新弹窗操作区保持本层背景，位置由固定 footer 管理。

## 2026-10-02 指标原生格式兼容与补采

用户明确要求指标采集不以 CLI 精确版本或指标专用最小版本阻断；Grok 等产品最低准入继续生效。
实现改为原生格式、根 Session、workspace、模型和字段语义校验。CodeBuddy、Kiro、TRAE、Antigravity
新增来源，OpenCode 补失败占位记录过滤。两轮同 Session 冷恢复及独立 raw fixture 见
[原生格式兼容验收](../../research/runtime-monitoring/native-format-compatibility-2026-10-02.md)。

当前合同为 [Runtime Usage Monitoring v8](../../contracts/runtime-usage-monitoring-v8.md) 和
[Runtime Execution Metrics v5](../../contracts/runtime-execution-metrics-v5.md)；不新增迁移、输出测速、
模型提示或 Renderer 布局。未验证字段保持未知，CLI 实测版本和版本准入明确分开。
默认 Rust gate 与生产 Renderer 500 Run 回放通过；真实逐 Runtime 同调用打包 App、正缓存写、
未提供窗口和其他来源的 Context 仍按验收记录保留边界。

## 2026-10-03 缺失字段修正

补接 DSH 原生 totalTokens 与 ZCode 原生 Session snapshot 的 contextUsage；不添加版本门槛、
历史上下文、测速或 UI 布局。修正先前 null/null 一致被当作完整采集通过的结论。
真实打包 App 已复跑和核对：DSH 93.6k，ZCode 18.8k / 200k、9.4%；整体仍有缺口，
见[逐字段证据与未决项](../../research/runtime-monitoring/missing-fields-verification-2026-10-03.md)。

## 2026-10-03 五类原生来源补查

补接 Antigravity 原生 SQLite 同调用数值、Qoder 明确配置窗口与原生输入的配对、TRAE 原生校准占用，
以及 Kiro 精确 Session 的模型窗口。CodeBuddy 当前自定义模型窗口、Kiro 精确 used/Run token
在已查来源中仍缺失，不从比例反推或借用其他模型容量。Kiro 卡头与气泡的比例统一为一位小数。
[Usage v8](../../contracts/runtime-usage-monitoring-v8.md) 与
[Execution Metrics v5](../../contracts/runtime-execution-metrics-v5.md)拥有新增来源；schema 不变。

Rust 测试准入、原始字段与实际 App 证据见[本轮来源验收](../../research/runtime-monitoring/native-source-completion-2026-10-03.md)。
新增唯一 extended SQLite owner，TRAE 保留原进程边界 owner 并增补目录读取，其他扩展既有 owner。
本切片为已有指标的局部来源补齐，不新增 Version Decision，不改变模型上下文、运行配置或发布 Skill。


## Usage 分批刷盘一致性收口（2026-10-03）

按 [Usage v8](../../contracts/runtime-usage-monitoring-v8.md) 在入缓冲时逐调用归一化，保留累计帧序、
单调用去重与缓存请求计数。summary 的已有质量字段承接 Input/Output 部分状态；
[Execution Metrics v5](../../contracts/runtime-execution-metrics-v5.md) 把完整性送入现有总量入口守卫。
本次无数据库迁移、正文或历史回填；合成回放证明刷盘分区不影响数值及完整性，不扩大 Runtime 原生支持结论。
证据与测试归属见[分批刷盘验收](../../research/runtime-monitoring/flush-partition-verification-2026-10-03.md)。

## 2026-10-02 Run 内容块与 command 组分页

- Worktree：`rovai/run-block-pagination`，基线 `f229ce3edf24d4054499babf98b0b3d984e46868`；User 明确要求 PR 合入 main。
- Core 读取时薄索引构造完整组摘要，主线块、子窗口与输出分别按需；旧 RPC 和 schema 2 调用仍有效。
- Renderer 主线首屏 4–24 块、历史 12 块，组内 24 项；首次不足视口有界续接，无嵌套滚动框。
- Rust 测试准入：扩展原有 slow-tests 的 SQLite pagination owner，复用完整 schema fixture 覆盖万条组、游标、归属与旧子项变更。
  纯命令语法 proof 使用无 I/O 的独立单测，拥有与读取计数相关的静态语法边界，不复制 SQLite fixture。
- 初步隔离样本：10,000 commands 的首屏（组摘要及后一正文）1,621 bytes，单次本机读取约 325 ms。
  这是单 fixture 观测，不是跨机器基准；薄索引仍需全量元数据扫描，有序载体候选索引为 O(N log N)。
- 自动验收复用生产 Run/Tool 组件和临时 Electron userData，无 Core/真实 Runtime；覆盖底部/侧栏、日夜主题、
  初次补齐、组内与主线失败重试、独立游标、缓存、输出/diff 惰性读取、键盘和位置锚点。
- 最终验证记录见下；不据本机模拟扩大真实 Runtime/移动设备资格。

审核修正：规范轴发现逐 Shell 全 Run SQL 扫描和 generic Shell 可见性分歧；需求轴另发现流式正文遗漏、自动组分页
误关跟随、静止加载边界无法由新滚动意图重启。改为批量候选索引，现代载体只检查相邻 Core；无 digest 历史结果
按候选惰性取证。共享载体与可见性 fixture 覆盖两端规则；扩展既有正文 owner，验证 1,000 个 delta 不写 SQLite
但窗口正文继续增长。组自动续接保留跟随，新 wheel/key 即使不发生 scroll 也重新检查边界。
新增样本：10,000 带 canonical 的载体／Core 行（相同 digest，保留歧义）读取约 458 ms；此数字同样是本机单次观测。

复核补充相邻历史 start/end 的空区间保护，原 SQLite owner 覆盖未关联 Shell 仍独立可见。
规范轴 3 项、需求轴 5 项发现全部关闭（两轴有重叠），两名独立审核者在合并基线 `1111eadc` 确认通过。

最终本地证据：

- `pnpm typecheck`；`pnpm test`：233 个 Vitest 文件／2,490 tests 通过，Node suite 328 通过、2 项 Windows-only 跳过。
- `pnpm test:rust:pr`：workspace 默认 owner 441 通过、1 项既有人工 smoke ignored；并定向执行两个 `slow-tests`
  owner：SQLite pagination 和 streaming text（各 1 项，非零）。新增测试复用既有 fixture，不扩充默认 SQLite 集成 owner。
- `pnpm test:camp-open-projection`：11 项通过；`pnpm test:command-view`：1 项通过。合并最新 main 后再运行
  execution-window、block-pagination、command-interaction 三个受影响 Electron 模式，3 项通过。
- `pnpm build:desktop`、`cargo fmt --all -- --check`、`pnpm docs:check:ci` 通过；文档门禁使用当前 PR base `97aa3fde`。
- 上游 Run 最小初始宽度／Windows 窗口关闭改动已合入；只解决版本文档末尾追加冲突，并保留双方内容。

最初全套并发执行时出现既有 evaluation-host 等待超时及 Electron 资料卡返回焦点失败；停止并发 Electron/构建后，
完整原门禁通过，未降低断言或修改无关产品逻辑。CI、PR 与最终 merge SHA 由 PR 和任务完成记录保留。

## 2026-10-02 Windows 关闭选择与托盘

由 Windows Main 持有关闭偏好、当前弹窗与单一 Tray；以现有 GeneralSettings/AppDialog 展示三态选项和“记住我的选择”。
本机 `window-close.json` 独立于 Core/Host，macOS 和 Web 不获得 capability。Main 验证主窗口主 frame 和当前 promptId，
保存失败保留原设置，托盘失败保持窗口可见，显式退出使待完成隐藏失效并等待偏好写入后复用原退出路径。

这是可逆的本机窗口交互扩展，无新增 Version Decision 准入事项；不改变 Core schema、Runtime 生命周期、模型上下文或版本指针。
当前规范已同步 Windows Platform、Windows Interaction Delta、Settings surface brief 与 Windows Window Close v1。

本地验证：`pnpm typecheck`、`pnpm test`、`pnpm build:desktop` 通过；Rust 默认 workspace 回归 440 项通过、
1 项既有人工 smoke 忽略，无 Rust 测试改动。`pnpm test:windows-close` 的隔离 Electron 验收覆盖两种主题、
1040/1440 视口、英文 200% 缩放、真实 preload 请求、原 DOM/草稿/滚动保留、取消/记忆/三态切换、
失败恢复、普通最小化和更新退出；既有 `test:window-close` 与 `test:desktop-bridge` 通过。

`pnpm test:windows-close` 在非 Windows 上只验证控制流和真实 Electron 界面，
在 Windows runner 上额外创建原生托盘。固定 Server CI 不能代替 Windows 10/11 的任务栏、Explorer 重启、多屏 DPI、
NVDA、High Contrast 或安装升级的真人验收，未取得这些证据前不宣称这些项目完成。

## 消息寻址与执行查询

按已确认[方案 r2](model-context-change-thread-runs.md)实施：正常 thread read collection 增加已有 addressing；新增只读 thread.runs，
统一返回实际 Run 与队员排队集合。复用现有认证、事务、CLI、结果 Schema 和错误合同，保留动态分页限制与 null 等待原因。
不扩展执行诊断、调度管理、权限、存储或 Session 迁移；旧 Bootstrap 和已有绑定保持，Skill 随包同步。
验证覆盖公开范围、来源计数、首条输入、状态、Unicode、分页、Single Chat policy 和冻结 Bootstrap/Skill 更新。
实现与验证结果在[方案验证记录](model-context-change-thread-runs.md#实施验收记录)收口。
User 于 2026-10-03 明确豁免本次真实任务 Gate；其余本地检查、独立复核与 CI 已通过，交付见 [PR #616](https://github.com/murray17/rovai-ai/pull/616)。

## 2026-10-03 普通一键新对话草稿恢复

- 回归来源：`ba545f799903d9de7a88e9b3ee03c745e3655614` 删除 public Core Draft 后，一键 Pending 首条输入只存 mounted Renderer；`ad47663f767d6dd9ab93e2c16f6f934650863dc0` 仅恢复 Active 本机草稿。两者在 PR #429 合入 main。
- 实现：普通 Pending 复用按 Thread 的本机 snapshot；已认证客户端 presence 驱动 Core 导航并保护空壳清理。首次发送事务清理标记，接受响应落盘空快照。同项目无数量限制。AI 创建队员保留既有窗口内草稿合同。
- 数据：Migration 183 / schema 133 从完整 schema 132 来源加性迁移；旧数据保留，DDL/marker/收据失败同事务回滚。不读取日常数据目录，不启动真实 Runtime。
- 自动化：本机存储与保存失败重试单测；Core 两客户端导航、同项目多草稿、清空、删除、激活回滚与重启清理；隔离 Electron 生产组件验收切换/刷新/窗口重建、拒绝/接受首发、清空及日夜最小窗口，既有 AI 创建流程一并回归。

### Rust 测试准入

新增两个 default owner，各拥有不同的失败边界：`pending_thread_draft` 测试生命周期及客户端隔离，
`db_pending_draft` 测试 schema 132 升级中途失败、重试和重开保留。旧 Draft 测试向 Core 写正文，既有空壳清理测试
没有客户端标记，不能证明本次边界；旧迁移测试止于 schema 132。两者都必须用临时 SQLite 验证事务与重开，
复用 seeded fixture，未启动模型或增加真实 Runtime 测试。准入矩阵在原 owner 增补 schema 133 缺收据的拒绝 case。
最小命令：`cargo test -p rovai-core pending_draft`。完整门禁结果在提交前记入本节。

提交前门禁通过：`cargo fmt --all --check`、默认 `cargo test --workspace`（452 passed，1 既有 ignored）、
`pnpm typecheck`、完整 `pnpm test`（236 个 Vitest 文件 / 2527 项，Node 328 passed / 2 平台 skipped）、
`pnpm build:desktop`、`pnpm test:member-creation`（2 个隔离 Electron 场景）及三项通用文档门禁。
全量第二轮曾遇到既有 Lark 附件流用例等待超时；该文件独立 81 项及随后完整套件均通过，未改该用例或渠道代码。
界面夹具使用内存服务替身，Core 持久化/清理由 SQLite 测试独立验证；未安装或重启日常 App，未运行真实模型。

## Claude Code 与 Codex 原生连接编辑

User 已确认原生配置复用、共享影响范围、两张简单表单及字段级冲突交互，并要求 worktree 实施后推送分支。
不重复保存 Key，不新增探活。实施与验证统一见[验收记录](runtime-custom-api-verification.md)，
字段以 [Runtime Launch v47](../../contracts/runtime-launch-and-verification-v47.md) 为准。
