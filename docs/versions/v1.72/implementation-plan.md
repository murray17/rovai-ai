---
document_type: implementation-plan
version: v1.72
authority: version-implementation-and-acceptance
status: in_progress
last_updated: 2026-10-10
---

# v1.72 实施与验收

## 2026-10-10 Pi 目录观察与思考强度

按 User 修订实现三个边界：Pi 目录准入、调度、提交、读取独立于健康；目标 Session 激活后避免同模型重复选模；
目录只作有效观察且不破坏 Pi 已选模型/强度。复用原表与 metadata，无 schema 迁移、新缓存或 Provider 管理系统。
单一 Core 解析器输出 thinking_level，现有控件、配置摘要和 Run 历史消费；显式值由目标任务 Host 严格回读。

当前规范：[Runtime Launch v55](../../contracts/runtime-launch-and-verification-v55.md)、
[Runtime Catalog](../../architecture/runtime-catalog-boundaries.md#pi-coding-agent-当前边界)、
[队员配置](../../ui/components/member-identity.md)。这是局部实现修正，未新增需要长期取舍治理的 Version Decision。

验收、两个新增 Rust owner 的准入理由、Pi 0.84.4 原生无生成对照、复现脚本和明确未测边界见
[Pi 思考强度验收](../../research/pi-thinking-level-2026-10-10/README.md)。默认 workspace 与定向 Rust、前端、Electron 交互、
typecheck 与桌面构建通过；扩展筛选中的两项既有失败已在独立基线构建复现，保留原样，不报告全套通过。

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
[Runtime Launch v48](../../contracts/runtime-launch-and-verification-v48.md)。

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

## Claude 运行中 Context 修复（2026-10-03）

按 [Execution Metrics v6](../../contracts/runtime-execution-metrics-v6.md) 提前发出最近根模型调用 used，
窗口在匹配原生 result 到达后补齐；不新增迁移、公共字段、轮询、测速或模型上下文文本。
这是既有数值采集路径的可逆修复，无新增 Version Decision 准入事项。
真实故障和逐 Runtime 时机审计见[本轮记录](../../research/runtime-monitoring/live-context-verification-2026-10-03.md)。
既有 Rust stream/持久化 owner 扩展用例，App 验收新增可选的运行中 used-only 数值与气泡一致性门槛。

本地验证：Claude 33 项、monitoring 13 项、ACP 输入确认 owner 与默认 Rust workspace 450 项通过；
隔离打包 App 的 Claude 2.1.280 真实多工具 Run 成功，运行中 used-only 六次更新，终态窗口和四项用量
与 Renderer 一致。脚本当前版本/Thread 命名适配、原生脱敏数字、真实验收范围与尚未解决的 ACP/ZCode
时机限制均写入上述记录；不将代码审计扩大为全部 Runtime 的动态验收。

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
不重复保存 Key，不新增探活。按 [D15](decisions.md#v1-72-d15) 收窄为保存时原生切换、完整内存草稿与直接原生执行。
实施与验证统一见[验收记录](runtime-custom-api-verification.md)，
字段以 [Runtime Launch v48](../../contracts/runtime-launch-and-verification-v48.md) 为准。
### 2026-10-04 Context 运行中可用性

按用户确认的 [Execution Metrics v7](../../contracts/runtime-execution-metrics-v7.md) 移除输入 accepted
等待与延后 Context 缓冲；有效实际模型/配置下复用窗口，三个字段独立可用，原生 Run 用量结算不变。
ZCode 根调用结束/压缩触发合并读取，Pi/Antigravity 保留独立字段；界面仅时间刷新复用旧对象。
实现与 App 证据由[本轮验收](../../research/runtime-monitoring/live-context-usability-2026-10-04.md)拥有。
继续 PR Review，本轮不自动合并或替换日常 App/数据库。


## 2026-10-05 训练营默认 Runtime 配置复制

- Worktree：`rovai/onboarding-runtime-copy`，基线 `cb33fdc0c6203340609e0ac435e09c2a1cfc7ba1`。
- 在所选成员配置后冻结其余未配置内置队员的版本与命令 ID，逐人保存同一 Runtime、模型参数及默认权限。
- Desktop onboarding 升级 schema 3；旧未完成进度保持检查点并补齐复制，所有完成来源继续终态、不补写。
- 未知结果复用原命令；已知拒绝才换命令重试；并发变更和移除跳过，完成准入要求复制计划全部收口。
- 同步 [First-run Onboarding v6](../../contracts/first-run-onboarding-v6.md)、Architecture、UI 与当前文档路由。
- 不新增 Rust/Core 行为或数据库表，不修改模型上下文；既有队员页手动应用入口保持独立。
- 验证已通过：`pnpm typecheck`、`pnpm test`（包含新增 14 项真实 Desktop 状态文件恢复测试，Node 汇总 334 通过 / 2 平台跳过）、`pnpm build:desktop`、`pnpm test:desktop-bridge`（真实隔离 Electron contextBridge）、`git diff --check` 及基于上述基线的 `pnpm docs:check:ci`。
- `pnpm test:rust:pr` 默认 workspace 回归：453 项通过，1 项既有忽略；使用本机 Rust 1.97.1，仅为该命令补充工具链 PATH。未新增、删除或改动 Rust 测试。恢复测试使用确定性 Core 命令账本，不冒充真实 Runtime 执行验收。

## 2026-10-05：更新入口与关于设置 R2

按 User 确认的 R2 HTML 稿落实普通侧栏与「关于与更新」。侧栏使用可读的透明状态入口，设置菜单图标与更新
状态采用独立尺寸规则，修复状态被 22px 图标槽挤压的问题；英文窄栏允许入口另起一行。页面顶部合并当前
版本、状态与操作，日志优先于折叠检查记录，版本号进入日志 Tab，下载只保留一处可见百分比。当前
[设置 brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md#关于与更新)同步实际 880px 阅读轨道。

当前/候选版本分离、语言切换、安全 Markdown、明确下载/安装、提示代次、只读 Desktop Web、Server 重连
和精确发布回退链接继续原合同；无 Main/Core 更新状态机、API、Schema、发布源、模型上下文或 Runtime 变化。

验证：

- `pnpm typecheck`、全量 Vitest 238 文件 / 2600 项通过。原有 About 静态布局断言转由真实 Electron 的
  几何与交互检查覆盖；进度 Token、提示、Mobile 44px 操作区等既有断言保留。
- `pnpm test:rust:pr`：453 passed、1 项原有 ignored；`pnpm test:navigation-shell` 通过。
- `pnpm test:release-notes-ui`：日夜与中英文、8 种侧栏状态、200/270/420px、原生方向键、
  切换语言保留所选版本且零请求、日志/检查记录顺序、下载单一百分比、显式安装和 390px 手机布局通过。
- `pnpm build:desktop`、`pnpm package:mac` 与 `accept-app-updates-ui.mjs`：独立 userData/Skill Library，
  真实 packaged 0.4.4 的内置日志/发布日期、确定性关闭联网自动检查、Day 1440×920、Night 1040×700、
  reduced motion 与 200% 等效布局通过。未操作日常 App、下载真实更新或执行升级安装。
- `pnpm docs:test`、`DOCS_BASE_REF=2d0d5171… pnpm docs:check:ci` 通过。

既有验收限制：`pnpm test:startup-presentation` 在本分支和冻结 `2d0d5171` 的生产模块上均报告
`Pre-ready authority calls: windowClose.get`。macOS 夹具的泛化 Proxy 暴露了 Windows-only 能力；
本次保留原脚本和准入断言，不将其列为通过，也不把 UI 修改扩大到启动与 Camp 清理逻辑。
签名跨版本升级与实体 Windows/手机不属于本次样式实施证据。

## 2026-10-05 Runtime 轻量启动

在独立 worktree 完成静态发现、配置/队列解耦、真实 Host 验证、初始化状态和具体失败展示。
未启动日常 App、未使用日常 Core 数据或真实账户 Runtime。自动化使用隔离 SQLite 和合成协议进程；
真实 CLI 登录、模型服务与跨平台兼容性不由这些夹具证明。

验证环境为 macOS arm64、Rust 1.97.1；工作分支 `rovai/runtime-launch-validation`，基线
`36a0e92cc28819b13a50198e2483bb8ab5c7ada2`。Spec 与 Standards 两轮静态审核已收口。

已通过：

- `pnpm typecheck`、`pnpm test`：Vitest 238 文件 / 2600 项通过；最后一组 Node 测试 334 通过、2 项平台跳过，文档/Skill/隔离 sandbox 检查通过。
- `pnpm test:rust:pr`：默认 workspace 共 453 通过、0 失败、1 项原人工 Runtime smoke 忽略。
- `pnpm build:desktop` 与 `cargo check --workspace --all-targets --features slow-tests`。
- Runtime 定向 owner 回归：359 通过、0 失败、6 项保留原人工环境忽略；真实 Host 验证、默认模型零目录、取消/替换零输入、错误投影及修复后新任务均通过。实际命令如下。
- `ROVAI_FAST_CHECK_ONLY=1 pnpm test:camp-fast-layout`：生产组件、隔离 Electron，零自动检查、手动重试、绑定与迟到响应围栏、共享偏好和原生输入通过。
- Impeccable detector 对修改的界面文件无发现。其 context 工具另报告 4 个既有 brief 的路径过期及未识别的 `desktop` 平台词汇；本切片未改这些仓库资料。
- `cargo fmt --all --check`、`git diff --check`、`pnpm docs:check` 与基于上述 SHA 的 `pnpm docs:check:ci`。

```bash
cargo test -p rovai-core --features slow-tests --lib -- \
  acp:: agent_profile:: antigravity:: camp_fast:: claude:: claude_control:: codex:: \
  context:: delivery_queue:: health:: pi:: runtime:: runtime_discovery:: \
  application::tests::runtime_check_manager application::runtime_check_environment:: \
  application::tests::availability_ application::tests::later_success \
  application::tests::detected_entry application::tests::trae_version \
  collaboration::slow_tests::multi_target_send
```

扩大验证的既有边界：

- `cargo test -p rovai-core --features slow-tests --lib` 初次完整运行未全绿；本切片相关失败经修正后按 owner 重跑。
  下列 4 项数据库/authority 测试在上述干净基线 worktree 独立复现相同失败，本切片保留原测试与迁移实现：
  `authority_migration::tests::macos_provenance_added_after_ticket_is_readmitted_without_losing_business_data`、
  `db::tests::database_contract_preflight_admits_current_and_rejects_future_store`、
  `db::tests::navigation_summary_migration_preserves_tables_backfills_and_rolls_back_with_events`、
  `db::thread_names::tests::thread_upgrade_preserves_existing_tables_and_rolls_back_on_receipt_failure`。
  分别涉及 macOS provenance 再验证、v183 预期值和 `pending_camp_draft_presence` 历史迁移 fixture。
- `cargo clippy -p rovai-core --all-targets --features slow-tests -- -D warnings` 剩余 10 项错误，与同命令的干净基线一致，
  位于 Pi host、CLI output、Context、execution window 和 monitoring；本次新增 lint 已修正，未添加抑制规则。
- 默认完整 `pnpm test:camp-fast-layout` 仍在旧执行过程 disclosure 的 `.open` 断言失败。
  未改生产代码的基线先暴露过期 `camps.members.fast.*` fixture 路由；仅将该 fixture 路由修正为已存在的
  `threads.members.fast.*` 后，复现相同 `.open` 失败。本次 Fast 定向模式通过不代表整套历史布局/Stop 验收通过。

未执行真实 CLI/账户、发布包或 Windows 实体验收。没有变更数据库 schema、提高权限或替换日常 App。

### 2026-10-06：身份读取与文件校验锁边界收尾

按 PR #642 的两项 P2 审查修复 `ff573057` 中残留的健康快照读取依赖和持锁同步哈希。
`verified_executable_identity` 仅绑定 Installation/路径/请求指纹；locator 保留当前安装的重新解析线索，
健康快照缺失、旧指纹或文件身份失效都不隐藏保存的 shim 路径，实际入口依赖仍须复核。
静态发现和 dispatch rebind 共用锁外 blocking worker，文件身份与指纹一致后才取数据库锁提交；
SQL 层只接收私有字段的验证结果。保留搜索环境代次、原子 Installation 更新及真实 Host 输入前验证。

针对性回归使用现有 owner 与隔离 fixture：48 项通过，覆盖新安装、旧快照升级、身份/路径拒绝、
Core 重开、静态扫描不启动 Runtime 和诊断重绑定。新增唯一 Core 锁边界 owner 通过阻塞线程池屏障验证
等待文件校验时仍能执行并行 SQL，不用大文件或 wall-clock 阈值推断性能。Codex 原真实 Host owner
另补并通过销毁 Host 后再次默认执行的场景，`--version` 挂起不影响两次实际协议初始化，且无模型目录请求。
这些是 Core 持久化/重新初始化与合成协议的分层证据，不是发布 App 或真实账户的重启验收。

Windows 既有 shim owner 在 `slow-tests` 下增加目标内容更新、npm platform package 从 hoisted 搬至 nested、
无快照/无文件身份下读取旧 locator 并重新解析的场景。本机不能执行 Windows 测试；尝试
`cargo check -p rovai-core --target x86_64-pc-windows-msvc --all-targets --features slow-tests`
停在 `ring` C 依赖缺少 Windows `assert.h`，未计为编译或测试通过。待 Windows 的最小验证命令为
`cargo test -p rovai-core --features slow-tests --lib runtime_discovery::windows_tests::resolved_npm_shim_content_change_invalidates_locator_identity_and_snapshot_key`。

`cargo check --workspace --all-targets --features slow-tests`、文档两道门禁和格式检查通过。
本轮重新执行 `pnpm test:rust:pr`：453 通过、0 失败、1 项原有人工 Runtime smoke 忽略。
Clippy 与首轮基线比较仍是原有 10 项错误，本切片没有新增 lint、抑制规则或全局健康机制。


## 2026-10-06 Fast 偏好直接应用

- 基线：`0baa74144ba52de257c98656e72b445c9bc43d4e`；分支 `rovai/fast-runtime-preference`。
- 现有偏好表支持首次事务写入，控制投影不读资格/健康；保存、绑定与 Run 冻结沿用原边界。
- 删除 Claude/Codex Fast 专用资格与额外子进程路径，保留通用诊断及真实 Host 的必要验证。
- 控件直接保存三态，原生反馈进入现有 Run Evidence；缺失字段为 unknown、禁用原因经过脱敏，不反写偏好。
- `pnpm test:rust:pr` 通过：workspace 451 项通过、1 项既有人工 Runtime smoke 忽略。
- `extended-tests` 定向 owner 通过：`camp_fast::` 2 项、`claude::` 33 项、`codex::` 22 项及 1 项原有忽略、
  `execution_evidence::tests::` 17 项、`runtime::tests::scheduler_rebinds_one_compatible_runtime_drift_and_preserves_initial_audit` 1 项。
  在既有 owner 中验证三态首次写入、新连接读取、真实进程的新建/恢复与显式模型参数、未知版本零资格子进程、
  明确关闭、拒绝单 Turn 参数后零重放，以及 Run 逻辑窗口可见的脱敏反馈。
- `pnpm test` 最终通过：Vitest 238 个文件、2601 项通过，后续 Node 脚本 334 项通过、2 项平台跳过。
  首轮飞书附件恢复测试超时；该文件独立 81 项通过后，完整命令重跑通过，未改动该模块。
- `pnpm check:rust`、`pnpm typecheck`、`pnpm build:desktop`、`cargo fmt --all --check`、`git diff --check`、
  `pnpm docs:test`、`pnpm docs:check` 及以上述基线运行的 `pnpm docs:check:ci` 通过。
- `ROVAI_FAST_CHECK_ONLY=1 pnpm test:camp-fast-layout` 通过，覆盖真实 Renderer 的双入口、三态、保存并发与迟到回执隔离、
  原生反馈不反写偏好、零资格请求；日夜截图已检查。完整 `pnpm test:camp-fast-layout` 仍在上轮已记录的
  执行 disclosure `.open` 旧断言失败，未修改或跳过该断言，不能算整套布局/Stop 验收通过。
- 未执行真实 CLI 账户、实体 Windows、实际计费或日常 App 安装验收；合成进程与隔离 Renderer 结果不替代这些验证。

## 2026-10-06 Fast 二态与初始化值

- 基线：`4099bc3843eb3b6bdbe51d9bb09c3df2fdc2d347`；分支 `rovai/fast-native-baseline`。
- 保留现有 Thread 队员偏好表、nullable override、绑定代次和 Run 冻结，不改成 Session 级存储。
  真实初始化值复用现有默认列，只用于控件显示；历史诊断 fingerprint 记录不充当原生默认。
- Codex 正常 start/resume 响应读取 `serviceTier`，Claude 正常 control initialize 读取
  `fast_mode_state`；缺失保持内部未知。两者不新增请求、子进程、配置文件解析或正文等待。
- Fast 控件恢复单按钮、固定文字和二态 ARIA，保存明确布尔值。已有选择优先于 baseline，
  保存期间仅初值刷新的投影不能丢掉回执；普通运行观察保持独立。
- 扩展既有 `camp_fast`、Claude/Codex 启动测试及隔离 Renderer owner，不增加框架或独立测试 owner。
  覆盖默认来源、历史诊断隔离、保存/重绑、缺字段继续输入、无额外 RPC/进程及新建/恢复参数。
- `pnpm typecheck`、`pnpm check:rust`、`pnpm build:desktop` 通过；`pnpm test` 包含文档/Skill 门禁，
  Vitest 2601 项通过，末轮 Node 334 项通过、2 项平台限定跳过。
  固定上述 base 的 `pnpm docs:check:ci` 通过。
- `pnpm test:rust:pr` 451 项通过、1 项真实 Runtime smoke 保持忽略；启用 `extended-tests` 的
  `camp_fast::` / `claude::` / `codex::` 定向回归分别通过 2 / 33 / 22 项，Codex 1 项真实 smoke 保持忽略。
- `ROVAI_FAST_CHECK_ONLY=1 pnpm test:camp-fast-layout` 通过，日夜截图已检查；验证二态、初始化值、
  明确关闭、双入口同步及保存期间迟到刷新。未增加或退役 Rust owner。
- 不执行真实账户计费、实体 Windows 或日常 App 安装验收；沿用上一节完整布局测试的已知限制。


## 2026-10-06 Codex Host 失败恢复

基线 `4099bc3843eb3b6bdbe51d9bb09c3df2fdc2d347`，worktree `rovai-ai-codex-host-recovery`，分支 `rovai/codex-host-recovery`。
本次不需要主线先行治理提交；状态与验证以本节和分支最终提交为准。

- `application.rs`：原生终态与业务交付分别判定；成功先做安全释放，失败事务建门禁后交既有 worker；未确认回收不解锁。
- `runtime.rs` / `delivery_queue.rs`：复用现有清理意图、ACK 与 claim 事务；新增内部显式需要清理的终态入口，保留原生来源。
  输入未知的 Codex 失败接入既有 abortive settlement，默认轮换原生绑定。
- `codex.rs`：进程先交 Fleet，再 initialize / account / model 验证；显式释放策略；thread/resume 校验 ID，不隐式回退空 Thread。
- `runtime_fleet.rs`：四种释放结果、迟到检查防止误停后继、停止未确认保留租约/容量；现有 owner record 延长到数据库清理 ACK，
  记录 Run/epoch 与停止回执以支持重启对账。没有新增认证、调度、恢复管理器或后台健康轮询。
- `runtime_failure.rs`：仅可信 Codex 失败对象进入结构化优先分类，认证拒绝不等于未登录。

测试 owner 与准入：扩展 Codex 真实 Host 验证 fixture，初始化/认证/模型失败均断言零正文和已回收；新增假 Runtime
进程测试拥有 warm→失败→换 Host→精确冷恢复的跨进程合同，覆盖失败前/后更新假凭据。原生状态和错误分类矩阵由
小型 parser/policy 测试拥有。复用 Fleet 清理超时及 runtime 未知结果测试，补齐回收回执跨重启的唯一 owner。
Core 并发 seam 测试实际执行终态事务、Delivery claim 和带停止屏障的 Fleet worker，验证已排队输入不被领取，
且无关会话能推进；这一竞态不能仅用纯函数或源码字符串测试证明。

Adapter 审计：

| Adapter | 状态 | 本次结论 |
| --- | --- | --- |
| Codex | 已接入，受控验证通过 | 本次闭环范围；不操作日常故障会话 |
| ACP | 已审计，发现缺口，未接入 | prepare_agent_run_terminal_visibility 在持久终态前释放；多数 Adapter 仍申请 Reusable。ZCode 后台任务归属必须单独处理 |
| Pi | 已审计，发现缺口，未接入 | 失败已有 Stop 路径，但仍以业务输出判断完成且忽略清理结果；需独立接入原生终态策略 |

验证命令与证据（macOS arm64；`slow-tests` 包含 `extended-tests`）：

| 命令 / filter | 结果 |
| --- | --- |
| `cargo fmt --all --check`、`cargo check --workspace` | 通过 |
| `pnpm test:rust:pr` | workspace 452 项通过；1 项现有人工验证按声明跳过 |
| `cargo test -p rovai-core --lib --features slow-tests codex::` | 24 项通过；1 项真实 Runtime smoke 按声明跳过 |
| 同上 `runtime_fleet::` / `runtime::tests::` / `runtime_failure::` | 分别 23 / 34 / 5 项通过 |
| 同上 `acp::` / `pi::` | 74 / 21 项通过；Pi 真实安装 smoke 按声明跳过 |
| 同上 `native_failure_gates_already_queued_input_until_managed_reap` | 已排队输入、暂停回收、无关 lane、ACK 后单次 claim 通过 |
| 同上 `codex_native_terminal_controls_host_independently_of_business_delivery` | 实际回调覆盖 completed 缺少回复、失败、取消、中断、中间 error、旧终态及绑定保留 |
| 同上 `runtime_cleanup_dispatch_is_non_blocking_and_deduplicated` / `cancellation_covers_launch_without_a_handle_and_has_one_total_deadline` | 均通过 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=4099bc3843eb3b6bdbe51d9bb09c3df2fdc2d347 pnpm docs:check:ci` | 通过 |

状态：ready，独立 worktree 保留供后续审查，下一步为人工审阅远程分支；本次不自动创建 PR。
所有 Runtime 测试使用临时目录、受控假进程和假凭据，不访问用户账号，不重启日常 Core/Host。
真实 Runtime 与 Windows 运行验证未执行；不能将夹具成功描述为故障会话已经现场恢复。

## 2026-10-06 Windows owner record 与重启回执修复

基线 `088fbfc1d3772653c0599cc7fb25491002670428`，继续提交到 `rovai/codex-host-recovery`。
平台为实体 Windows 10 Pro 22H2 x64（build 19045），Rust/Cargo 1.97.1。

- 修复 fresh Fleet owner 目录由普通 mkdir 创建、继承 DACL 导致原子私有写入拒绝全部 Host 登记的问题。
  `runtime-fleet/owners` 使用原生私有创建；已准入 Core 根下的旧目录/JSON 只迁移精确继承的 user/SYSTEM ACL。
  更宽 ACL、未知 owner、reparse 和错误类型继续阻断，初始化错误向 Core 返回，不再静默停用持久记录。
- Windows Managed Process 创建私有、不可继承、禁止 breakaway 的唯一全局 Job；Codex owner record 保存 Job 身份
  和进程创建时间。该轮曾以“Job 消失且根实例退出”补齐重启证明；下节记录 2026-10-07 审查发现及修正，
  此旧推导不再作为当前回收准入。不补杀无关进程。
  当前代际的 Codex bounded reap 等待整个 Job 为空，再写回已回收凭据；回执保留到精确 Run/epoch 的数据库 ACK。
- 兼容边界：旧 `reaped=true` 回执继续有效；旧匿名 Job 的未确认 scoped 记录缺少树退出证据，继续保留门禁。
  本次不凭裸 PID 缺失为这些旧记录补造 ACK，不处理日常故障会话。
- 默认 workspace 首轮暴露既有 Claude permission 夹具将 `/tmp/project` 当作 Windows 绝对路径的问题；改用本机
  临时目录下的绝对路径，保留其原生 request/input/approval 全部正向、拒绝与防串用断言，完整命令重跑通过。

测试准入：扩展既有 `scoped_cleanup_receipt_survives_restart_until_durable_ack`，覆盖真实原生进程的重启回执、
同一 Run 的 live/dead 多记录、PID 身份差异、非法/缺失 Job 身份及旧 epoch ACK。扩展既有 Job 孙进程与 Core
强杀 owner，证明可重新查询的生命周期。新增 `windows_owner_registration_admits_only_private_or_legacy_inherited_storage`
拥有独立的私有目录/旧 ACL 迁移 seam；纯策略测试不能证明生产 Fleet 准备全部父目录、成功私有写入及保留旧回执。
全部进程/文件 fixture 隔离在临时目录，新增 owner 属于 `extended-tests`，没有新增真实账号 smoke 或重复数据库 fixture。

| 命令 / owner | Windows 结果 |
| --- | --- |
| `cargo test --workspace` | 492 项通过，8 项按声明忽略 |
| `cargo check --workspace --all-targets --features slow-tests` | 全部目标编译通过 |
| `cargo test -p rovai-core --features extended-tests --lib runtime_fleet::tests:: -- --test-threads=1` | 23 项通过，含两处缺陷的回归 |
| 扩展 libtest `managed_process::tests::windows_` / `codex::tests::` / `runtime_failure::tests::` | 分别 12 / 21 / 5 项通过；7 个子进程 helper 和 1 个真实账号 smoke 按声明忽略，helper 由 native owner 显式调用 |
| 扩展 libtest 的 Runtime loss/provenance、startup accepted-unknown、network no-replay 与两个 Delivery cleanup gate owner | 6 项精确用例通过，保留 ACK 前门禁及跨 execution-root 隔离 |
| `cargo fmt --all --check`、`git diff --check` | 通过 |
| `pnpm docs:test`、`pnpm docs:check`、以上述修复基线运行 `pnpm docs:check:ci` | 通过 |

本节补充上一节的 Windows 证据；未运行 Windows 11、真实 CLI 账户/计费或日常 App 验收。
当前修补不扩大 ACP/Pi 的原生终态接入范围，也不把受控进程验证描述为用户已有故障会话已经恢复。

## 2026-10-07 Windows Job 回收证明修正

基线 `396c6a01ba1b5594f83e26827f5163238d76bbfe`；User 授权修复、创建 PR 并合入 main。
先合入主线 `520320a8`，保留原生 API 配置与 Fast 初始化改动；主线已使用 Runtime Launch v48，
因此 Codex Host 恢复增量顺延至 [v49](../../contracts/runtime-launch-and-verification-v49.md)，继承完整 v48。

- 删除“Job 名称不存在时查询根 PID”的捷径。Windows 原生 CI 随后在持有同一孙进程 handle 的条件下
  复现 `ActiveProcesses=0` 先于 handle signaled（run `37495892005`，提交 `cd25153a`），因此也撤销
  “重新打开空 Job 即可证明回收”的推导。跨 Core 只接受已有精确 Run/epoch 的持久回执。
- 当前 Windows Managed Process 在空 Job 上绑定私有 IOCP，按去重成员通知保留进程 handle；全部确认退出后，
  最后核对 Job 生命周期总成员数与活跃数，才允许既有 `tree_is_empty()` 成功。丢通知、重复 PID 少计、
  查询未知均保留门禁；通知读取与成员核验均有单轮预算。只增加本 owner 的退出证据，不新增恢复管理器或后台轮询。
- 扩展既有 Fleet receipt owner：即使真实 Job 可查询为空，未持久回执时仍未确认；owner 确认退出并持久回执后，
  关闭 handle 再重启仍可精确 ACK。缺失 Job、根仍活、PID 不存在与复用均不能补造回执。
  既有 Managed Process 孙进程 owner 保持精确 handle，增加首次观察后创建后代、丢成员通知、重复通知与
  非法通知后再次轮询的负向断言；强杀 owner 的实际退出与跨 Core 可用证明分别由两层 owner 验证。
  没有新增或退役 Rust 测试。
- 手动 Full check 增加 `windows-runtime` scope 复用既有 Windows job；显式运行 extended Fleet/Codex owner，
  不以 default-feature 过滤到 0 项的结果替代跨平台验证。

最小定向命令为 `cargo test -p rovai-core --lib --features extended-tests runtime_fleet::tests::`、
同参数的 `codex::tests::`，以及 `cargo test -p rovai-core --lib managed_process::tests::windows_`。
后者仅 Windows 有有效用例；Unix/macOS 限定的冷恢复、初始化零正文与两条 Core 集成用例在 macOS 独立执行。
本轮 macOS 验证：默认 workspace 455 项通过、1 项真实 Runtime 按声明忽略；slow-tests 下 Fleet 23 项、
Codex 24 项通过（另 1 项真实账号 smoke 忽略），两条 Core 原生终态／已排队输入门禁 owner 各 1 项通过。
`cargo check --workspace`、format、文档单测 10 项与以 `520320a8` 为 base 的全部文档门禁通过。
Fleet/Codex 采用独立 CI step，避免 PowerShell 后续成功覆盖前一失败码。Windows 新增句柄边界修正的
两路静态复核已通过；追加修正后 workspace 编译、Fleet 23 项、format 和全部文档门禁再次通过。
上列默认套件、Codex/Core 的 macOS 数量属于追加 Windows 句柄修正前的验证，不冒充后续原生结果。
Windows 原生运行结果归档于 [PR #652](https://github.com/murray17/rovai-ai/pull/652) 的检查记录；
既有 Windows 10 的 492 项结果只覆盖上一节提交，不能代替本轮修复。本轮不运行真实账号或日常 App。

## Member CLI 最小增量

- 工作分支 `rovai/member-cli`，复用独立 worktree；提示词 r1 的确认消息为 `d283c49e-6894-4274-a584-ce449b544d44`。
- 仅 list/get/update；封闭读取、事务内 PATCH、文字与资产引用原子提交，create 及 Single Chat allowlist 保持。
- 无持久字段扩展：现有创建快照支持同 Thread 原创建者；requestId 显式传递解决重启 CLI 的重放身份；现有复合资产保存与 Run tmp 生命周期复用。
- 内置 portrait 原先只在 renderer AVIF 包中，Core 无法读取或复用 PNG/JPEG 裁切流程；最小补充为同源 PNG 编译资源，不增加运行期解码依赖或资产服务。
- 最终集成基线 `5421fed778fcdd62f3b2c0e7f517a6e3e2b86c51`；同步上游仅解决版本概览文本冲突，保留并行工作的记录。
- `pnpm test:rust:pr`：454 项通过、1 项原有 Runtime smoke 忽略；`cargo fmt --all --check` 通过。
  定向回归全部通过：`member_` 18 项、租约生命周期 2 项、Bootstrap/冻结补发/新 Session 4 项。
- 重建 CLI 的根帮助与四项 member 帮助、Bootstrap 资源、cli-operations 正文均与 r1 逐字一致；
  独立 tmp 中的 stdin/输入文件封闭拒绝行为一致，不连接日常 Core。
- 文档测试 10 项、Skill 测试 3 项及 12 项 Skill 校验通过；`docs:check` 与以上述基线运行的 `docs:check:ci` 通过。
  Standards 与 Spec 独立复核的代码问题均已关闭，完整记录见[实施证据](model-context-change-member-cli.md#2026-10-06-实施与验收记录)。
- 真实任务 Gate：等待具体 Runtime/model 与固定快照 Judge 配置，尚未运行或声明通过；不沿用其他工作项的豁免。

- 复核修正：列表沿用 `member_order,id`；图片更新复用创建流程的请求绑定不可变资产。原 Run 源文件消失后先匹配既有领域回执，未提交请求仍拒绝；源文件存在时验证规范化内容，避免同路径换图被租约缓存吞掉。无新表或第二份请求结果。
- 后续复核修正：等价 source/crop/icon 保留原引用和版本；有持久回执时只验证准备资产，缺失或损坏不得重新发布该资产 ID。两项均在原 PATCH owner 中补回归。
- User 针对 `c069b3f5` 的追加复核确认两项 P2：Lead 为 null 时列表报错；相对图片路径在 Core cwd 下解析。
  扩展原 Member 与 CLI owner 后均先复现失败；修复使用 SQL `COALESCE` 与 CLI 三路共用出口的绝对路径转换，
  不自动任命 Lead，不提前检查图片是否仍存在。隔离的双进程 IPC 夹具在不同 cwd 各放一张不同内容的同名 PNG，
  直接参数、JSON 文件、stdin 修复前均选中接收端图片，修复后均选中调用者图片，请求 ID 保持一致。
  本夹具证明实际 CLI 的输入／IPC 边界，不冒充真实 Core/Runtime 或模型 Gate。
- 追加修复后：Member 18 项、CLI 29 项、默认 workspace 454 项通过，原有 1 项 Runtime smoke 仍忽略；
  格式、文档测试 10 项、文档治理及提示词／帮助逐字对照通过。没有新增或退役 Rust owner。

- 2026-10-07 按 User 追加要求统一文件语义，取代上一阶段的 CLI cwd 方案：CLI 保留原始
  `avatarFile`，Core 认证 Run 后使用现有 `agent_file_ingress_scope` 读取冻结的 `execution_root`。
  create/update 共用输入入口，绝对路径原样保留；与 Agent 附件共享纯路径 helper，既不 canonicalize
  也不提前检查文件存在性。头像仍即时导入 immutable asset，无新增字段、授权／幂等机制或附件记录。
- 定向验证：Member 18、CLI 29、附件 5 项通过，沿用原测试 owner。隔离 CLI IPC 夹具覆盖
  create/update × 直接参数／JSON 文件／stdin × 相对／绝对路径共 12 种组合，路径和命令身份原样传输；
  Core 入口与真实 SQLite fixture 的两个 owner 另在隔离子进程 cwd 下执行，同名 PNG 内容不同，
  最终导入的像素来自冻结 Run 根目录。此证据不等同于真实 Core/Runtime 端到端或模型 Gate。
  失效 epoch／缺失 workspace 拒绝、绝对路径不变、symlink 拒绝和缺失源回放均已覆盖。
  Bootstrap、Skill 与 CLI help 继续逐字符合已批准文本。
- 本轮最终默认 workspace 回归：454 项通过、1 项既有 Runtime smoke 忽略；格式、文档测试 10 项及
  diff-aware 文档治理通过。没有新增或退役 Rust owner；真实模型 Gate 仍待配置和验收。

- 2026-10-07：User 在已收到 Gate 缺口说明后，通过消息
  `10a0a3f7-2d2b-478f-bb99-6726b07d37cb` 再次明确要求“pr main merge”；据此推进本项交付，
  真实模型 Gate 保持未运行，不记为通过。已合入主线 `520320a8`；版本概览冲突保留 Member CLI
  与 Runtime 探测修复两段记录，未改动后者的实现或验收结论。
- 合入 `520320a8` 后最终验证：默认 workspace 454 项通过、1 项既有 Runtime smoke 忽略；
  扩展 Member 18 项、租约 2 项通过（均先确认非空清单）；重建 CLI 后 12 种文件输入组合、
  封闭输入拒绝与已批准 Bootstrap／Skill／help 逐字对照通过。格式、文档测试 10 项、Skill 测试 3 项、
  12 个 Skill 规范检查和以该 main SHA 为 base 的通用文档门禁通过。
- 独立复核：Spec 未关闭问题 0 项；Standards 的当前版本文档漂移修正并复核后，未关闭问题 0 项。
  复核与上述确定性检查不代表真实模型 Gate 通过；按已记录的 User 后续合并指令推进 PR。

## 2026-10-07 设置保存仅本地提交

基线 `3acf1f28`（已包含主线 `921e37e1`），工作分支 `rovai/local-settings-save`。
按 User 的保存流程说明新增 [Runtime Launch v51](../../contracts/runtime-launch-and-verification-v51.md)，
继承原生文件归属和安全写入；这是可逆的操作链调整，没有新增配置存储或架构决策。

- `runtime.startup.save` 移除 shell 捕获、程序扫描、全 Runtime discovery 和 Codex 模型元数据子进程。
  自动入口只使用已有发现或独立 Owner 读取确认的进程内记录；PATH 改变或入口未知时不猜测写入目标。
  这份可失效的入口记录不持久化、不拥有连接配置或凭据。模型文件使用已有原生目录或已包含的
  兼容默认结构，保留隐藏元数据、未知字段、字段 CAS、目录修订和凭据 Keep/Replace/Clear。
- 保存回执（包括冲突最新值）不携带完整 Key；表单从回执更新基线和完成状态，只保留编辑器已有的、
  来源及版本匹配的 Key 或本次替换值。移除父组件 reload 与保存触发的来源 observation，迟到读取不得
  覆盖已提交字段；同时选择来源与编辑连接时，只提交启动选择并保留尚未提交的连接草稿。
- 环境捕获及发现文件校验移至提交锁之外，发布时核对代次并合并最新配置；保存仅更新本地修订与失效标记。
  不重启或取消已有 Host/Run，后续执行继续使用原有配置快照兼容检查。

测试准入与退役：新增 slow owner
`application::runtime_check_environment::tests::local_saves_finish_while_environment_capture_is_held_and_never_launch_work`
独占“环境捕获尚未完成时保存仍可提交”的交错；修复前保存会等待同一提交锁，或补跑环境/CLI/发现。
已有 probe-race owner 的屏障发生在环境捕获之后，无法覆盖这一失败窗口；必须通过隔离 Core、SQLite 和
真实 RPC handler 验证锁与提交边界，纯函数测试不足。一个 owner 表驱动覆盖两种 Runtime 的 URL、Key、模型、
环境和程序选择，并核对旧快照失效、无发现发布、无额外捕获、回执脱敏和迟到刷新保留新配置。
最小命令：`cargo test -p rovai-core --features slow-tests --lib application::runtime_check_environment::tests::local_saves_finish_while_environment_capture_is_held_and_never_launch_work`。

扩展已有 `discovered_runtime_verification_keeps_database_available_and_identity_after_restart`，通过阻塞唯一
文件 worker 验证生产 discovery 发布既不占数据库锁，也不占保存提交锁。改写原环境读取失败 owner 为保存
不依赖失败 reader。删除 `native_resource::tests::selected_wrapper_reads_local_catalog_without_resource_fingerprints`：
其唯一生产路径（保存时启动 CLI 读取 bundled catalog）在本次退出，没有保留永久禁用测试。模型本地转换与
未知元数据保留继续由 `codex_catalog::tests` 及 `runtime_custom_api::tests` 拥有。新增一个、删除一个 Rust owner，
其他变化扩展原有 owner；前端在原 Electron fixture 验证请求计数、回执屏障、失败/冲突草稿及 Key 三态。

本轮验证（macOS arm64）：

| 命令 / owner | 结果 |
| --- | --- |
| `pnpm test:rust:pr` | workspace 455 项通过，1 项既有真实 Runtime smoke 按声明忽略；包含原生 fixture example 编译 |
| slow-tests 的 `application::runtime_check_environment::tests::` | 4 项通过，包含环境屏障、旧 probe 隔离、未知自动目标拒绝、独立读取后的入口复用和 PATH 改变后失效 |
| slow-tests 的 `runtime_custom_api::` | 4 个 owner 通过，覆盖配置格式、来源权限、凭据三态、字段冲突、未知字段、目录元数据和写入回退 |
| discovery 文件 worker 锁 owner / `runtime_fleet::tests::warm_hosts_never_cross_camp_compatibility_keys` | 各 1 项通过 |
| `pnpm test` | Vitest 238 文件、2,603 项通过；Node 主脚本集 334 项通过、2 项 Windows 用例在 macOS 跳过；文档、Skill、sandbox 子集均通过 |
| `pnpm typecheck`、`cargo fmt --all --check`、`git diff --check` | 通过 |
| `ROVAI_KEEP_CUSTOM_API_FIXTURE=1 node --test scripts/lib/runtime-custom-api-ui.test.mjs` | 隔离 Electron fixture 通过；人工查看窄屏与保存回执截图，原有日夜主题和表单布局保持 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=921e37e1 pnpm docs:check:ci` | 干净工作树通过；未修改主工作区被 Git 忽略的原型稿及其过期链接 |

JavaScript 全套与文档门禁在仅含受版本控制文件及本次补丁的临时工作树执行，复用既有依赖，关闭 pnpm 的
自动依赖安装；未删改依赖或为文档检查添加例外。Core/Rust 和 Electron 定向 fixture 在原工作区执行，
数据均来自临时目录。未运行真实 Provider/账号 smoke、Windows 原生验收或更换当前日常 App。

## 2026-10-07 智能体状态文案精简

- 按 User 要求，入口存在的状态显示为“可用”，删除执行验证说明与检查成功后的重复提示行；
  检查失败、延后及登录/安装入口保留。仅调整 Renderer 展示，不改变 Core 检查或启动语义。
- 分支：`rovai/runtime-status-copy`；worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-runtime-status-copy`；
  基线：`921e37e1`；无需独立治理前置提交。状态为 ready，下一步按 User 指令创建 PR。
- TypeScript 检查、相关 Renderer 测试 54 项、桌面构建、文档治理及默认 Rust workspace 回归通过；
  Impeccable 机械检查无发现。沿用既有状态测试，没有新增 Rust 测试或界面测试文件。
- 生产目录组件在隔离 Electron 中通过日夜主题、1440×920、1040×700 与 200% 缩放检查：
  成功检测无提示行，失败/延后仍显示错误，成功重试清除旧错误，页面无横向溢出。
- 完整 `test:settings-workspace` 在进入未修改的连接编辑页时失败：夹具初始 `startup` 为空，
  `runtime.startup.observe` 返回 undefined，触发 `connectionReadError` 读取异常；本轮目录专项通过
  不代表完整设置页回归通过。截图及专项运行脚本保存在本次 Thread 的 `runtime-status-copy` 附件目录。


## 2026-10-07 移除自定义 API 配置

基线 `a5e202ab`，分支 `rovai/remove-custom-api`；已整合原本的本地保存修复及主线 `f67682c8`。
按 User 明确取消要求执行 [Runtime Launch v53](../../contracts/runtime-launch-and-verification-v53.md)。

- 移除 Claude/Codex 官方/API 单选、连接登录状态、URL、Key、模型映射及模型列表；普通启动设置保持。
- Core、Desktop 与 Web 均退出 `runtime.startup.observe`，封闭输入拒绝旧连接补丁和 `apiKey/customApi`。
- 删除原生写回、迁移、认证切换、目录生成及辅助账号/来源进程；没有修改用户已有文件或凭据。
- 原生 `model/list` 与能力继续拥有模型选择，移除编辑器的二次过滤；不实现此前取消的推理强度 fallback。
- 历史冻结快照解析、只读原生来源摘要、Host 兼容与输出脱敏保留；没有新增数据表或模型上下文。

Rust 退役清单（生产写路径与合同在同一改动退出）：

| 原 owner | 处理与保留边界 |
| --- | --- |
| `configuration_rejects_ambiguous_connections_and_preserves_optional_models` | 退出 API 表单校验；普通字段及旧请求拒绝由 `runtime_startup::tests::environment_validation_preserves_values_and_rejects_ambiguous_or_reserved_names` 拥有 |
| `native_editor_reads_without_writing_merges_fields_and_never_copies_credentials` | 替换为 `startup_saves_preserve_native_files_and_merge_only_local_preferences`，沿用 SQLite fixture 验证 CAS、合并、提交失败、隐藏旧凭据及原生文件不变 |
| `native_sources_keep_environment_references_and_replace_only_the_selected_connection` | 替换为 `native_sources_are_read_only_and_keep_secrets_out_of_snapshots`，保留文件/环境/命令/AWS/云认证来源、无执行读取、脱敏、解析错误、symlink 身份与冻结兼容；原生替换/迁移 case 随 writer 退出 |
| `native_catalog_preserves_internal_entries_and_unknown_ids_use_only_native_defaults` | 原生目录生成生产路径退出，不再为此功能生成目录 |
| Windows `windows_native_edits_preserve_acl_and_guard_publication` | 原生写回/ACL 发布生产路径退出；通用私有存储与 Windows 平台测试保留 |

上述模块可执行 owner 从跨平台合计 5 项收窄为 2 项；不是删除当前 Migration、权限、恢复或脱敏合同。
Core 阻塞环境读取、正式检查代次与本地保存 4 个 owner 原位保留；profile 冻结/重绑定 owner 保留。
API 专用 UI/CLI fixture 退役，启动页 UI 回归由既有 settings-workspace fixture 继续承担；更新其本地提交 mock，
并修正 About 页已更名的链接选择器，未改变 About 产品代码。

已完成的定向验证：

- `pnpm typecheck` 通过；启动草稿、队员参数、Main 白名单 3 个 Vitest 文件共 39 项通过。
- `runtime_custom_api::` 的 2 个保留 owner（extended-tests）、Core 环境与保存的 4 个 owner
  （slow-tests）、profile 冻结/重绑定 1 个 owner（slow-tests）均实际执行并通过。
- 完整 `test:settings-workspace` 通过；两种启动页均无 API 入口，保存只发送一次本地请求。
  独立 Electron fixture 使用 `/var/folders/pm/zmpfxggd0glcm8vx3p3y3mmr0000gq/T/rovai-settings-workspace-test-Yv9gdQ/user-data`，
  Skill Library 为其 `managed-skill-library/`，不启动 Core 或真实 Runtime。
  已检查日夜主题、1040×700 与 200% 截图，Impeccable 机械检查无发现。

完整回归与治理：

| 验证 | 结果 |
| --- | --- |
| `pnpm test:rust:pr` | workspace 453 项通过；1 项既有真实 Runtime smoke 按声明忽略 |
| `pnpm test` | Vitest 238 文件、2,602 项通过；Node 主脚本集 334 项通过、2 项 Windows 用例在 macOS 跳过；文档、Skill、sandbox 子集通过 |
| `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=f67682c8 pnpm docs:check:ci` | 通过，未增加治理例外 |
| `cargo fmt --all --check`、`git diff --check` | 通过 |

完整 JavaScript 与文档门禁使用提交 `9e09d4b1` 的临时 detached 检出
`/private/tmp/rovai-remove-api-verify-9e09d4b1`，复用既有 `node_modules` 并关闭自动依赖安装，
不共享 Rust target、不修改主工作区被 Git 忽略的原型稿及其过期链接。
主开发目录仍为 `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai`，分支 `rovai/remove-custom-api`；
验证检出没有独立变更，收尾时移除，任务分支保留并推送。没有运行真实 Provider/账号 smoke 或 Windows 原生验收。

打包与非终止安装交接：

- `pnpm package:mac:daily` 通过，App/Core/Host/CLI 的 arm64 架构与 ad-hoc 签名门通过；安装代码为 `9e09d4b1`。
- 真实打包 App 在 `/private/tmp/rovai-remove-api-packaged-zqq2egic/user-data` 完成独立验收，
  Skill Library 为其 `managed-skill-library/`；核对实际数据库路径、两种启动页入口移除、
  普通环境变量本地保存、回执字段和旧 `apiKey` 输入拒绝。验收实例已关闭，没有启动真实 Provider Run。
- 安装到 `/Applications/Rovai AI.app`，源、暂存、最终目标三处安装验证通过。
  旧版备份为 `/Applications/Rovai AI.backup-before-remove-custom-api-20261007-9e09d4b1.app`，保留不删除。
- 日常 App/Helper/Host PID `39161/39165/39166/39167/39168` 安装后均存活，日常数据未改动。
  新版本已安装，当前会话仍运行旧版；退出后应从规范安装路径显式打开新版，不从备份启动。


## 2026-10-08 Cline 原生认证简化（User 89）

- 删除 `cline_hub/auth.rs` 的认证选择/白名单/字段准入/Provider 投影与 `NativeAuthLease`。
- Hub 与显式登录统一直引原生源，保留普通环境；账号与 BYOK 均按 Fleet 复用、回收及并行。
- 当前 Provider 的非挥发配置参与兼容性；缺可读账号标识不阻断，轮换及无关 Provider 更新不重绑。
- 登录 completed 改为原生命令流程完成；零模型检查 authenticationStatus 保持 unknown。
- 原生匹配回复 `ok:true / finishReason:error` 也进入已有脱敏错误分类，输入不重放。
- 代码、真实负例、账号 warm/双成员并行、BYOK 和 App 结果见
  [本轮报告](../../research/cline-runtime/native-auth-warm-parallel-2026-10-08.md)。
- 无 schema 或其他 Runtime 改造，保留 Preview；首次完整授权、真实刷新和外部并发刷新未验证不再封禁普通执行。

## 2026-10-08 移除 Core legacy heartbeat

用户授权范围为完整迁移消费者并删除全局 500ms 循环，保持既有事务、执行、恢复和渠道重试语义。
替代入口、保留计时器、测试 owner 和实际结果统一记录在[验收记录](heartbeat-removal-verification.md)。
普通 batch Scheduler 的 claim owner 与 30 秒恢复入口继续保留；没有新增通用 Job 表、事件总线或持久状态机。

## 2026-10-08 取消普通执行默认 24 小时上限

- 基线为 heartbeat 移除提交 `3e6c22fc`，任务分支 `rovai/unbounded-default-execution`。
- 公共 `freeze_camp_turn_execution_budget` 对缺省预算与显式 null 均冻结为 schema 2、无 deadline；
  有限时长保持请求值，正数、时长范围和截止时间溢出仍拒绝。Run/A2A 数量限制继续使用原上限。
- 核对生产创建路径：Single Chat 直接发送与 Pending 发布共用 `admit_single_chat_message`；
  普通 batch 消息及其排队发布不创建 CampTurn 预算。没有其他入口补回普通 24 小时默认值。
- 历史 migration 的 86,400 秒常量改名为 `LEGACY_EXECUTION_ELAPSED_SECONDS`，数值与迁移逻辑不变。
  不新增 migration、不改写历史或已冻结预算。Automation、评测显式策略及操作超时不变。
- `process_execution_budgets` 生产逻辑没有修改：继续等待有效 deadline；没有 deadline 时仅等通知。
- 测试扩展既有 owner，没有新增独立测试：公共预算 owner 验证缺省/null、两天时长、数量上限与溢出；
  Single Chat 发送、私有终态和 FIFO owner 验证新 queued/running Run 推进两天仍无时间取消；
  FIFO fixture 的显式两天预算在一天未到期、两天时结算并隔离 Run 一次；原 driver 空闲 owner 在 active
  schema-2 Turn 下验证两天内任务 poll 与 SQLite VM 操作均无增量。原手动停止、恢复、取消、Automation 超时和
  v47 历史迁移 owner 用作回归。
- 隔离回归通过：`pnpm test:rust:pr` 453 项通过、1 项既有真实 Runtime smoke 按声明忽略；
  `cargo test -p rovai-core --features slow-tests --lib <owner>` 覆盖公共预算 3、Single Chat 9、driver 2、
  Automation 9、Runtime 34、legacy execution budget 2、Camp Open 3，共 62 项；额外使用
  `--features legacy-migration-tests` 运行 v47 冻结 owner 1 项，总计 63 项不同定向用例通过。
  所有定向命令先核对 `-- --list` 非零，重复回归不重复计数。
- `node --test scripts/lib/qualification-evaluation.test.mjs` 22 项通过；`pnpm docs:test` 10 项通过；
  `cargo fmt --all --check`、`git diff --check` 通过。
- 文档门禁使用同基线、包含完整改动的干净验证 worktree，执行 `pnpm docs:check` 与
  `DOCS_BASE_REF=3e6c22fc pnpm docs:check:ci`；日常工作区的本机原型保持原样。
  仅使用隔离测试 fixture，不启动日常 App 或真实模型；48 小时推进使用确定性测试时间，并非实机连续运行两天。


## 一键草稿邀请队外队员

- Work item：Pending Composer outsider invitations；User 2026-10-08 已确认实现、PR 与合入 main。
- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-pending-composer-invitations`。
- Branch：`rovai/pending-composer-invitations`；Base：`a77b537d59d7cc8c01d520d9fd1d0174a194e1e7`；Governance：none（同 PR 同步当前权威）。
- Status：ready；前端复用候选/提示，Pending 首发直接提交，Core 复用成员写入并用局部 savepoint 撤销业务拒绝。
- Rust 新增唯一 owner `collaboration::pending_invitation_tests::pending_invitations_commit_with_first_message_and_roll_back_every_failure`：
  修复前当前 inline 入口拒绝队外 Atom；既有 legacy Draft 激活 owner 无法覆盖这一入口。此 owner 拥有成员与首发布
  的跨表原子性，需隔离 SQLite 来证明业务拒绝、SQL 错误、presence trigger、回放和串行首发竞争；归入 `extended-tests`。
  最小命令：`cargo test -p rovai-core --features extended-tests --lib pending_invitation_tests`。没有删除或停用 Rust owner。
- Renderer 验收使用生产 ThreadWorkspace 与隔离 Electron transport，覆盖候选、失败保留、本机恢复、成功清空、Active 邀请顺序；
  不启动 Core 或真实 Runtime。事务事实由上述 SQLite owner 拥有。
- 规格审查发现成功回执早于名册投影时会丢失续发目标，已修复并补回归：延迟 Active 投影时先清空、保留 continuation，
  输入、清空、离开及重挂载不再写 Pending presence/discard；投影前阻止误发，投影后无 @ 续发仍指向新队员。
  激活事实只按成功回执在 transport 生命周期内缓存，不复制成员权威，也不修改本机持久格式。
- Validation：`pnpm typecheck`、`pnpm test`（Node 334 通过、2 项 Windows 跳过）、
  最终 `pnpm exec vitest run`（238 文件、2606 项通过）、
  `cargo test --workspace`（455 通过、1 项既有忽略）、上述定向 Rust owner（1 通过）、
  `cargo test -p rovai-core --features slow-tests --lib collaboration::slow_tests::`（46 通过）、
  `pnpm test:composer-input`（28 项既有编辑用例 + 新增生产 Composer 流程）、`pnpm build:desktop`、
  `DOCS_BASE_REF=a77b537d59d7cc8c01d520d9fd1d0174a194e1e7 pnpm docs:check:ci` 全部通过。
  同步 main `7f1562f3` 后完整 Rust、JavaScript、类型、构建与文档门再次通过；最终文档 diff 基线为该提交。
  隔离 Electron 验收覆盖 1040×700 日夜主题及键盘选择；未调用真实模型，也不宣称 Windows 真机验收。
- Next：review、推送 PR、CI 与合入后清理。

## 2026-10-08 Cline 官方 ACP 与 Hub 完整退役（User 95）

- 接回共享 ACP Client/Host/Fleet、诊断、事件、权限、load 重放隔离与工具解码；无版本或认证字段门槛。
- 删除 Hub 模块、类型、WebSocket 依赖、登录 UI/IPC、全部 Hub/shim 实验入口；Pi 结算与共享进程能力保留。
- 原生认证源直引，无凭据副本。冻结 Bootstrap 使用成员 Host 不可变原生文件 Rule，普通 warm 和并行不依赖认证类型。
- 旧 Binding 按共享不兼容替换，公开历史及原生历史保留，旧输入不自动重发。
- 当前安装 3.0.3 广告 loadSession 却返回 -32601；cold 真实验收不通过，不能沿用 Hub 结论。
- 合同/Architecture/Context/当前导航已更新，历史报告固定退役前复现链接；当前验收见
  [ACP 退役报告](../../research/cline-runtime/acp-retirement-2026-10-08.md)。后端切换不改变其他 Runtime 合同；主干分叉数据由 186/187 汇合到 schema 137，current_version 不变。

## 2026-10-08 主干 schema 135 与 Preview 合流

- 保留 main 的 Mission 原子保存、结构化提及、Pending 首发邀请和续做修复。
- Migration 184/185 的双来源由完整 schema 识别，186 汇合 Runtime catalog/续做，187 保留或回填 Mission 描述到 schema 137。
- 扩展已有 `runtime_catalog_migrations_preserve_rows_and_roll_back_with_their_receipts`，覆盖 main/135 结构化 Atom、部分结构拒绝、失败回滚和重开库；保留 Mission 描述及 continuation 的原 owner。未新增平行测试体系。
- 主干 Runtime Launch v53 和 D17/D18 保留原编号；本分支决定顺延 D22–D30，现行后端由 v54/D30 拥有。

## 2026-10-08 官方 ACP 切换交付

- 最终实现 `9b8fa131`：共享 ACP 69 项、Fleet/Pi/进程与迁移 owner、Rust workspace/all-feature 编译、前端类型及 2611 项测试通过。
- Windows runner 对该提交执行 workspace/all-targets 编译通过；macOS arm64 App 签名与真实账号/BYOK 主路径通过。
- 打包账号 6 成功 / 1 预期取消，独立双成员并行、同 Host warm、审批与取消后继续成立；BYOK 打包 first/warm 两轮通过。
- 无凭据诊断返回原生 authentication_required，未自动登录。3.0.3 load 广告与实际不符仍是明确 native cold 缺口，ACP compact 不宣称修复。
- 最终边界、负例、真实/模拟验证区分和公开证据见 [ACP 退役验收](../../research/cline-runtime/acp-retirement-2026-10-08.md)。PR #662 更新后保留未合并。

## 2026-10-09 headless 候选与最新主干合流（User 101）

- headless 显式 A→B→A 同 Session 与 System Mod 已由实际 1.66.0 和官方 1.79.1 对照验证；
  普通写入仍受原生 print permission gate 阻断，生产保持 ACP，不把全权限 Mod 实验冒充普通审批。
  真实 BYOK 四次成功、一次预期取消及无模型覆盖的差异见[专门报告](../../research/command-code-runtime/headless-resume-2026-10-09.md)。
- 合流 main `81f8b1fc`，保留 Mention v33、DSH 原生/Web 模型来源与 Windows Job 当前活跃数清理。
  共享 ACP 同时保留本分支 Session permissions 和 DSH 来源字段，Cline 保持隐藏。
- 保留主干 D19–D21；本分支当前版本决定顺延 D22–D31，仅调整追溯链接，不改变已接受的语义。
- 两种 receipt 187 按真实格式识别，189/schema 139 收敛；原有 184–188 兼容与收据保留，
  既有 Mention 迁移 owner 扩展两种来源、部分结构、失败回滚及冻结证据保留。

本地合流验证：默认 Rust workspace 465 通过／2 人工 Smoke 忽略，共享 ACP 69 通过／2 人工 Smoke 忽略，
Claude 34、DSH 5 与模型目录 owner 通过。前端类型、239 文件／2615 Vitest、339 Node 测试、文档门禁
及桌面构建通过。Mention 两来源／回滚／旧收据保留与修正后的 v104/v105 fixture 定向通过。
这些检查不新增 headless 产品准入，也不代替 Windows runner 或真实打包模型验收。


## 2026-10-09 headless 退役与两个 ACP 暂缓公开（User 105）

- 删除 Command Code headless Rust transport/activity、五个专属 Rust owner、两份 Python 探针及模型对照中的 print 请求；ACP/RPC 探针继续保留。
- Cline 与 Command Code 官方 ACP、System Rule/Mod、权限、工具、恢复、共享 Fleet/进程及历史身份保留；Command 撤回 macOS arm64 Preview，与 Cline 一样全平台 NotQualified。
- 可见目录统一隐藏两者，覆盖设置、新手引导、队员/Skill 选择、安装引导和监控筛选；保留既有 Run/用量标签与配置，无数据库迁移。
- 已知缺口分别记录于兼容性清单与两份研究索引。已删代码链接固定到 `2b9a2dbaf8d4312c2f539c91a1aa500c1e5c279e`，失败证据未删除。
- 本轮不发送真实模型请求，不升级 Runtime、不运行 headless、不恢复 Hub，不触碰用户凭据或原生历史。
- 首轮验证：Rust workspace 462 passed / 1 个人工 Smoke ignored；相关 Renderer 5 文件 213 项、TypeScript、两个 System Hook Node 测试、文档 10 项及版本/治理门禁、格式检查通过。
- 合流 `3a83b2b7`（DSH 目标模型思考选项）时保留两套独立语义：Cline/Command 原生默认哨兵与 DSH 目标选项；没有扩大 headless 范围或恢复公开入口。
- 合流后前端 239 文件 / 2615 项、typecheck、共享 ACP 69 passed / 2 个真实 Smoke ignored、Command 专属 1 项、Cline 专属 3 项、Adapter 25 项通过；桌面/Web 构建和隔离 Electron Runtime Picker（实际菜单隐藏、键盘、IME、双主题/尺寸、DSH 目标选项）通过。
- 扩展平台证据 owner 首次发现兼容清单新增说明后摘要未同步；按原合同更新当前 register digest，不增加任何 Runtime 的资格，随后复验。用户凭据、原生历史与日常安装没有改动。
- `562e1bb4` 的默认 workspace 462/1、平台 5 项、CI 与 Windows all-targets 编译通过。检查期间再次合流 main `2256db53`，保留后续 DSH 能力缓存与图片菜单修复；最新合流的默认 workspace 462 passed / 1 ignored、前端 239 文件 / 2616 项、typecheck、文档门禁、桌面构建及隔离 Electron Runtime Picker 复验通过。最终 CI 与 Windows 编译以 PR 当前提交回执为准。


## 2026-10-10 两个隐藏 ACP 与最新主干合流

合流 main `0a7e183c8`，保留内部续做请求、DSH 目录迟到响应处理、macOS 进程退出修复及 v0.4.7
发布内容。Cline/Command 仍保持不公开，headless 专属实现和探针没有恢复。
主干 188/schema 138 与 Preview 同号收据按实际结构区分，经 190/schema 140 收敛内部请求与保留的
ACP catalog；旧收据、公开历史、待执行请求和冻结证据保持。既有迁移 owner 扩展两种来源、
残缺结构拒绝、失败回滚和重开，未新增独立测试。

macOS 主干的 `EPERM` 后退出确认接到现有身份信号路径，保留活跃后代、捕获失败和其他信号错误的
拒绝语义，不留下被平台条件排除的分支。原进程清理 owner 的正负例全部保留。

本地验证：默认 Rust workspace 463 passed / 1 个人工 Smoke ignored；迁移、续做、Adapter、Cline 与
平台准入定向通过。DSH catalog 既有 owner 首次因漏记主干上下文字段失败，补齐该字段的输入与断言后
通过；最终进程清理与 ACP 复验 76 passed / 2 个真实 Smoke ignored。TypeScript、239 文件 / 2616
Vitest、339 Node 测试、文档通用门禁及 Desktop/Web 构建通过。隔离 Electron 的真实 Runtime 菜单确认
两个隐藏项均未展示，并通过键盘、IME、双主题/尺寸、缩放与 DSH 迟到目录验证；夹具已清理，未启动
Core 或真实 Runtime。CI 与 Windows all-targets 编译以 PR 当前提交回执为准。

## 2026-10-09 消息 Mention 元数据

按[确认稿 r1](model-context-change-message-mentions.md)实施公开 batch/read 的公共目标投影，
复用名称与正文、原版本恢复、封闭 Schema、预算与摘要。仅 Agent Output 升至 10；
Transport/CLI、Bootstrap、非 batch 与 Binding 兼容身份保持。验证记录统一追加在确认稿，避免多份验收状态。

## 2026-10-09 Windows Claude 后继任务排队修复

本节按 [V1.72-D20](decisions.md#v1-72-d20) 取代上文 2026-10-07 Windows Job 回收证明的当前执行要求；
旧段落保留当时的实现和验收记录，不再要求累计计数、完成端口通知及逐后代句柄退出。
Windows Managed Process 现在只以本次有效 Job 查询 `ActiveProcesses == 0` 放行。
Claude 的可信原生成功或失败先结算业务，未确认的 Job 清理保留精确 Run/epoch 门禁并唤醒现有 worker；
启动临时文件删除失败仅记录诊断，启动时对本 Core 私有 `claude-inputs` 做限定范围的尽力回收。
用户 Stop 在 Windows 使用五秒单次总预算与既有局部重试；直接排队请求在清理期间保留，
执行台以清理中／清理未确认重试中代替普通排队提示。macOS/Linux 原有预算保持。

验收以隔离 Windows Core、Thread 和工作区中第二条非队长 Claude 消息实际执行为准，另查
Stop 后续做、真实工具停止、Job 活跃成员、暂时查询失败、文件删除错误及持久回执门禁。
定向 owner 为 `managed_process::tests::windows_job_contains_an_immediate_grandchild_after_leader_exit`
和 `claude::tests::cmd_and_native_roots_keep_both_files_until_the_job_descendants_exit`；真实模型复测
及未覆盖环境须在合入前记录，不把测试函数返回当作队列验收结果。

隔离实测使用 Windows 10 22H2（19045）、Core 0.4.6 开发构建、Claude Code 2.1.288、
本机已有的 Claude 默认模型配置；新建独立 Core 数据目录、Thread 和 Git 工作区，没有操作日常 Core。
非队长 Claude 的第一条执行期间提交第二条：正常结束时两条 Run 均 succeeded，第二条无需重启即启动；
Stop 场景中取消命令在两次实测中分别用时 26 和 23 毫秒，第一条 cancelled，第二条自动 succeeded，等待 22 秒后
被取消工具预定的延迟写入没有出现。两组原始报告保存在本次会话附件的
`claude-final-normal-report.json` 与 `claude-final-stop-report.json`（另保留先前构建的对照报告）。
这两次真实模型试验使用环境现有的 `bypassPermissions` 默认值；修复没有改变权限配置。
Windows 11、打包版和其他模型／权限模式尚未在本机验收，Job 查询持续失败需在现场诊断中观察。


<a id="dsh-native-web-models"></a>
### 2026-10-09：DSH 原生 ACP 与 Web 模型配置兼容

范围收敛为一个模型准备入口，最低支持仍为 `0.1.5-rc.2`。迁移归 DSH，术语统一为
“DSH 原生迁移期间的 Patch 隔离”。普通 Web 的 llm-pi-ai 模型可受控补充，原生模型和权限、
Bootstrap、Session/Fleet 主路径保留；不建设配置平台、迁移数据库或持久化来源账本。

Probe 与 Host 注入相同插件，在原生初始化后准备完整配置并原位应用到 Loader 的内存 entry。
私有结果只含来源 ID、诊断、摘要与文件指纹；目录来自 ACP。变化检测覆盖 Web 模型设置，
发布前检查过期结果，失败时保留原生能力，显式失败选择不切换同名路由。

测试延伸既有 `dsh::tests`、`grouped_acp_models_keep_opaque_provider_routes_and_reject_empty_catalogs`
与 `scripts/lib/dsh-host.test.mjs` owner。Rust settings 转换的 Provider/Model 显式 true/false/null、
其他协议与空配置断言移到实际 JS 转换 owner；Rust 继续拥有命令私密性、文件不变、权限与摘要。
没有删除、合并或禁用 Rust owner。新增 JS owner 分别拥有 Provider 冲突、兼容默认与原生异步导入完成。

| 验收 | 证据与边界 |
| --- | --- |
| 最低版与旧共享版 | `smoke-dsh-model-configuration.mjs` 在 `0.1.5-rc.2`、`0.1.5-rc.3` 各完成 3 次本地 HTTP 请求，原路由、Provider/Model 显式兼容参数通过；旧版不等待迁移 |
| Profile 版补充 | `0.2.1-alpha.1` 普通 Web-only、原生冲突保留、不同 Provider 同名模型、坏 Web、补充拒绝、迁移后删除 Web、先 Web 后 ACP 等原生进程场景通过；端点、凭据与 strict 在接收端核验 |
| Core 主链 | `smoke-dsh-responses-tools.mjs` 检查、实际 Host、两轮工具调用/结果完成，包含缺省 strict、Provider/Model 显式关闭及原生参数拒绝；使用独立 data-dir、Skill Library、DSH Home 和本地服务 |
| 真实中转 | 仅一次模型请求：隔离复制当前 Web 的 `sub2api / gpt-6.1-sol`，原生选模后返回 `OK`；没有改动日常配置，不推广为其他中转站或所有模型资格 |
| 单元与命令 | 默认 workspace 通过；DSH 与 grouped ACP 定向 owner、JS 模型准备及 Bootstrap owner 通过 |
| 限制 | 其他真实中转服务、Windows/Linux 实机与 Renderer 点击不由本轮本地 HTTP 证据代替；不存在模型质量或所有 Web 专用插件可复用的承诺 |

可重复入口：`node scripts/smoke-dsh-model-configuration.mjs <DSH 安装包目录>`；
`node scripts/smoke-dsh-responses-tools.mjs`，或设置 `ROVAI_DSH_SMOKE_SOURCE=web` 验证 Web-only。
后者需先构建当前 worktree 的 Core/CLI；`ROVAI_DEEPSEEK_HARNESS_BIN` 可指定隔离安装的原生 DSH。
所有夹具只使用合成凭据，结束时回收自身进程与目录，日常 App 与 DSH 配置不参与。

#### 858e8295 后的两处可用性修复

先保留原生 Provider，再处理无法解析的同名 Web Provider；Web 整体故障不再用局部 nativeProviders
集合拒绝其他原生插件。沿用目录 runtime metadata 和现有成员/冻结选择 JSON，增加可选 dshSource
标记，区分同 ID 的原生与 Web 选择；不新增表，不改模型 ID、参数或提示词。
目录刷新不改写已有选择。准备完成与目录发布继续检查输入，后续显式选模只读取准备结果并校验路由，
配置更新由已有 Host 兼容性入口负责，活动 Run 与清理机制保持原行为。

扩展既有 JS Provider 冲突、Rust DSH 摘要/路由、grouped ACP 目录、成员无健康证据配置/冻结及 Renderer 选择 owner：
同名不透明 Web、显式禁用、非 pi 原生身份、同 ID 不同来源、主题变化与过期准备结果均在原矩阵中验证，
没有新增或删除 Rust owner。新增 smoke 入口
`node scripts/smoke-dsh-model-availability.mjs <DSH 安装包目录>` 使用隔离 Core/DSH 与本地 Responses/Messages 接收服务，
验证实际端点、合成凭据、来源保存与冻结、复用 Host 以及失效 Web 选择的零业务请求。
纯配置函数无法证明这些跨 Run 行为，因此由真实进程 smoke 单独拥有。
定向入口：`cargo test -p rovai-core --lib dsh::`；
`cargo test -p rovai-core --features extended-tests --lib grouped_acp_models_keep_opaque_provider_routes_and_reject_empty_catalogs`；
`cargo test -p rovai-core --features slow-tests --lib discovered_entry_configures_and_freezes_without_health_evidence`。
目录迟到结果的共享代次门禁沿用并运行
`cargo test -p rovai-core --features slow-tests --lib codex_catalog_waiters_share_refresh_without_satisfying_full_validation`；
DSH 输入在准备期间变化的检查由其摘要 owner 验证，两者不互相替代。

#### 按目标模型读取思考强度

目录只把当前 ACP 模型的选项绑定给该模型；目标选项通过既有目录入口按需读取。执行选中目标后
替换完整选项状态并校验显式值；DSH 未保存强度时冻结配置保持缺省，复用 Session 交由原生选模
恢复默认。Renderer 支持模型默认、读取中、无档位与失败重试，迟到响应不覆盖当前目标；主动换模
只修改草稿，刷新目录不删除保存值。最低版本、Web 配置准备、来源核验和 Cleanup 均保持。

扩展现有 grouped ACP 与 `model_option_validation_rejects_preserved_effort_after_catalog_refresh`
Rust owner，不新增或删除测试函数。真实协议与 HTTP 断言扩展上述两个 DSH smoke 入口；
`pnpm test:runtime-model-picker` 的生产组件夹具覆盖目标切换、迟到结果、失败重试与默认选择。

macOS arm64 隔离验证：`0.1.5-rc.2`、`0.1.5-rc.3` 和 `0.2.1-alpha.1` 均通过原生选项与
同 Session 默认恢复，分别接收 7、7、15 次本地 HTTP 请求。当前 Core + alpha.1 的 11 次本地
请求验证目标读取零正文、B 不继承 A 的 max、先选模再设置 xhigh、冻结配置缺省、未改配置时
Session 复用、无可选档位正常执行、无效 max 零正文及 Web reasoningEfforts 刷新保留保存值；
既有原生/失败 Web 路由与非模型设置 Host 复用场景仍通过。成员配置变更可能按既有 Binding
规则创建 Session，未新增重建路径；原生同 Session 的旧强度复位由三版本协议 smoke 直接验证。
这些证据不覆盖 Windows/Linux 实机、打包日常 App 或真实中转；付费请求为零。

#### 思考强度缓存与静默读取

能力继续存入现有模型目录 metadata，以安装/环境、模型/来源及复用的 DSH 配置摘要为有效性边界。
每个模型保存自己的成功时间和已确认状态（包括无档位）；60 秒内直接复用，过期时展示历史并按需刷新。
本地 `cacheOnly` 校验不启动 Runtime，同目标请求共用现有检查队列，完整刷新与目标读取在同一事务入口
累计能力。配置改变时旧结果不再确认有效；失败不改成功时间，删除模型不被历史能力重新加入。

默认模型不查询；具体模型立即选中，静默读取不阻塞保存。移除独立加载和无档位提示，确认无档位且无
显式旧值时隐藏控件。失败保留历史并提供重试；用户已修改或保存的选择不受迟到结果清理。
执行前原生校验、缺省强度、最低版本、模型准备、Host 兼容性与 Cleanup 保持原行为。

macOS arm64 验证结果：

| 验收 | 证据与边界 |
| --- | --- |
| 原生请求计数 | Core + `0.2.1-alpha.1` 的既有 availability smoke：本地缓存校验零探测，三个并发 B 请求只选模一次；A/B 返回命中缓存，确认空档位重复选择只探测一次；将隔离数据库中 B 的时间调旧 61 秒，并发重访只重新探测一次 |
| 失败及发布门禁 | 原生协议故障保留选项和成功时间；选模屏障期间修改 Web 配置，旧结果未发布；60 秒内配置变更也重新读取；普通目录刷新保留其他模型的能力与时间 |
| 执行保持 | 12 次本地 HTTP 请求核对端点与合成凭据；TTL 重新验证后复用业务 Host，默认强度不追加 ACP 设置，无效显式强度零正文；原生与失败 Web 路由回归继续通过 |
| Renderer | 生产组件夹具覆盖默认模型零查询、A/B 乱序、过期历史、空结果隐藏、失败重试、用户后续选值/保存不被迟到响应改写；Day/Night、1040/1440/2560 宽度、200% 缩放与键盘交互通过 |
| 兼容基线 | `0.1.5-rc.2`、`0.1.5-rc.3`、`0.2.1-alpha.1` 的既有原生协议 smoke 分别通过 7/7/15 次本地 HTTP 请求；Core 缓存端到端实测使用 alpha.1，不冒充三个版本完整 Core 矩阵 |
| 代码门禁 | 默认 Rust workspace 459 通过、1 个既有 ignore；新增事务 owner 与既有检查队列 owner 各 1 通过；Vitest 239 文件/2612 测试、类型检查、Desktop 构建、DSH JS owner 5 项通过 |

事务 owner 的准入理由与命令见[测试指南](../../development/testing.md#dsh-逐模型能力缓存)。
版本与决策治理门在当前受版本控制文件副本通过，比较基线 `3a83b2b7`；原工作目录中既有、未跟踪的
`docs/prototypes/` 原型断链使直接文档检查失败，未修改这些原型。没有新增缓存表、服务或定时扫描。
未实测 Windows、Linux、macOS x64、打包 App 及真实中转；付费请求为零。本轮只提交并推送
`rovai/dsh-web-models`，不创建 PR、合并、安装或修改日常 DSH 配置。

#### Windows DSH 能力指纹路径归一修复

Windows 探测路径经 `canonicalize()` 带有长路径前缀，提交目录使用去前缀路径；同一程序的两种写法
不能被当作配置变化。`model_options_context()` 在共同入口复用 `runtime_visible_path()` 归一真实路径，
命令环境观察、文件身份观察和指纹计算使用同一路径；真实文件、模型配置或环境变化仍使能力失效。
不修改首次检查状态机、Host 复用、权限、会话恢复或 Cleanup，不包含同 ID 模型来源切换的 UI 修复。

默认层回归 `cargo test -p rovai-core --lib dsh` 使用隔离 Home 与 task-local 环境，覆盖普通/长路径
指纹相等及程序、配置、环境变化失效。`scripts/smoke-dsh-model-availability.mjs` 为 Windows 使用
`.cmd` 记录入口，`ROVAI_DSH_SMOKE_CORE` 可指定本次构建 Core；既有隔离协议、合成凭据与本地
HTTP 场景验证首次完整检查、重复刷新和投递，无真实中转请求，不改日常 DSH 配置。

## 2026-10-09 续做公屏记录移除

User 按 [r3](model-context-change-quiet-continuation.md) 授权新续做不新增消息记录、PR 合入 main 并本机安装；
已生成的记录保留原样。Migration 188 / schema 138 调整既有 Delivery 来源与独立序号；公共读取、FIFO 和原输入证据由
`delivery_queue::tests::user_continuation_preserves_source_and_claims_independent_fifo_batches` 扩展覆盖。
未新增平行 SQLite fixture 或独立 Rust 测试；既有正负向测试保留。既有 migration owner 验证
188 回滚；填充后的队列 fixture 验证旧续做来源转换、旧消息、公开序号与冻结证据保持。
thread.runs 按实际输入次数统计 queued 数量并取队首原文；Desktop 复用输入 ID 和既有锚点，
消息发送对象页脚排除续做，避免原 A2A 收件人重复。

2026-10-10 本地验证：TypeScript、完整 pnpm test（239 文件／2613 Vitest，337 Node 通过、2 既有跳过）、
Rust workspace（460 通过、1 既有忽略）、continuation 扩展 5 项、thread_runs 扩展 4 项通过。
最终页脚调整的既有 App owner 181 项、生产继续按钮交互与基于 main 的文档治理均通过。
真实 Runtime 与安装产物证据随 PR 交付记录；缺少固定 snapshot Judge 配置，未完成通用 12 Case
基线／候选语义 Gate，专项验证不替代该 Gate。
