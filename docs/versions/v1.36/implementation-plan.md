---
document_type: implementation-plan
version: v1.36
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-31
---

# v1.36 实施计划

> 当前状态：钉钉已按 [DingTalk Channel v5](../../contracts/dingtalk-channel-v5.md) 接入 Web Session 发布与内置扫码。
> 同一测试应用的免审发布、产品只读恢复/头像上传/Stream 已通过隔离实测；Owner 入站/Core/群聊/卡片与 packaged
> 恢复尚未完成，钉钉整体仍为 NO-GO。早期 checkpoint 记录不再代表当前协议完成度，详见[研究记录](../../research/dingtalk-web-session-probe.md)。

## 仓库内实施

- [x] Migration 122/123/124/125、Data Contract `v1.38 / schema 79`、helper mode 数据保留、共享渠道 SQLite storage 与显式升级测试；
- [x] DingTalk account、Owner identity、publication intent、member Bot、per-App identity 和 provider-neutral directory；
- [x] Electron Main Web Session/Console API：固定 endpoint、封闭 operation/argument、staged Cookie jar、超时/取消和 Renderer 秘密隔离；
- [x] 飞书/钉钉账号与 Developer Session 原子连接、publication credential 与 intent 原子推进、启动单次批量读取；
- [x] 删除 safeStorage/Keychain/独立 `.bin` 读取路径；旧文件只按严格名称 best-effort 清理，不迁移或解密；
- [x] 删除 DWS binary、版本/SHA、签名排除、打包资源、subprocess 生命周期与 stdout/stderr 协议；
- [x] 唯一官方网页登录、staged 账号切换和 Core 失败时只丢弃新 jar；不依赖 OAuth Client、Device Flow 或第三方 Client Secret；
- [x] schema-2 Cookie 重启恢复、官方 SSO 续接、临时失败保留、轮换 CAS 保存重试与迟到检查 fence；旧 OAuth row 保留到显式重连成功；
- [x] 每队员单 App 状态机、创建中断 fence/已知 ID 保存失败恢复、现代凭据、console 头像、数字 Robot 字段、grouped scopes、Owner-only 冻结版本和审批；
- [x] 每 App Stream、Robot/Card callback fast ACK、身份规范化和 topic fail-closed；
- [x] Owner-only 私聊/普通群、精确 `/new`、ExternalQuote、项目卡、单根 FIFO 与统一原子 admission；
- [x] 群 roster 与 Camp Membership reconcile、Core ChannelDelivery、AI 卡片、执行控制台安全投影和 Markdown 输出；
- [x] 设置页 Provider Tab、钉钉连接/发布/审批/管理入口、Provider-local 诊断与双主题样式；
- [x] 单元测试覆盖 Console API wire、Web Session、Provisioner、Open API、Stream readiness/ACK、Inbound、Migration、Core admission 和 Renderer；
- [x] 完成仓库全量 Rust、TypeScript、文档、UI detector 与 Desktop build 门禁并记录本次结果。

## 2026-08-31 合入主线执行正文与文件预览修复

- 先将渠道 Camp 命名与飞书紧凑实时卡保存为 `32fd0804`。最初获取主线 `33003e13` 后，远端引用在执行期间推进；
  首轮合并 `0f124a4a` 的实际主线父提交是 `3baf46c9`，随后按固定 SHA 补齐至 `main@cda05852`，不再跟随移动引用。
  合入完整执行正文、文件引用打开、预览 Tab 收缩/滚动、Runtime 发现诊断隐藏、侧栏滚动条和执行浮层宽度修复；
  没有新增数据库迁移。
- `ui-model.ts` 保留渠道分支的共享模块 re-export。主线“完整正文”修复迁入共享 presentation owner，
  默认 narration/plan 不裁掉开头；仅显式 `live_tail` 消费者保留原有尾部预览，飞书 v7 的整卡/行数预算不变。
- 首轮合并后 typecheck、131 文件/1276 项 Vitest、Desktop build、fmt、文档治理及以 `33003e13` 为显式 base 的
  docs CI 通过。合并前同一 Rust 源码的 staged library 门通过：workspace/all-targets check 和 462 项 Library；
  Node suite 220 通过、1 项 Windows 专属跳过，Skill authoring 3 项及文档治理 9 项通过。
- 隔离原生 Electron 的渠道 Camp 命名、文件预览布局和消息文件引用三项通过；检查 Day 命名与 Night Tab 截图。
  userData 全部在本轮临时目录内，未访问日常数据、启动真实 Runtime 或发送渠道消息。
- 补齐 `cda05852` 后再次通过 typecheck、131 文件/1276 项 Vitest 和以该 SHA 为 base 的 docs CI；
  原生 Electron 重跑上述三项并增加执行头像栏/浮层回归，共四项通过，包含长正文完整换行、指令单行和展开结果有界。
  检查执行结果截图；新主线增量没有 Rust、锁文件或打包配置变化，复用已验证的同一 Release Core。
- 同 worktree 的 `dingtalk-avatar.ts/test.ts` 与 `dingtalk-developer-gateway.ts/test.ts` 并行改动原样保留且未纳入此提交；
  以上 TypeScript 测试覆盖当前组合工作树。这不改变钉钉真实 Owner/Core/群聊/卡片及 packaged 恢复的 NO-GO 边界。
- 后续按本次用户指令生成 daily App、执行隔离打包验收并非终止安装到 Applications；打包与安装结果另记。
  本次不推送、不创建 PR，也不授权重启当前日常 App。

## 2026-08-31 飞书紧凑实时执行卡

- 实时默认只显示最新正文（5行）、当前一条command和真实进度。总原生面板默认关闭，最多保留最近10条command、
  20个timeline blocks；实际Card JSON受16,000 UTF-8 bytes/30个递归elements约束，超限从最早历史移出并更新提示。
  不改变Core Evidence、完整终态timeline或永久Agent回复；超大不可拆command诚实提示在Rovai查看，不静默改名。
- 共享ExecutionStep新增publicResult，仅从明确完成输出生成安全预览；本地detail不变，飞书不直接投影detail。
  继续20行/4KiB、先脱敏后截断，增加长行首尾保留与Core canonicalResult/error文本覆盖；空结果按方案提示。
- 初次终态显式关闭总面板、pageIndex为0。v6同步分页回包、900ms封存、Owner/App/message/sequence授权、下一根撤回均保持；
  钉钉纯文本输出及既有NO-GO验收范围不变，不回退附件中的旧分支/基线。
- 当前规范升级为[Feishu Channel v7](../../contracts/feishu-channel-v7.md)，v6保持冻结。此为局部可逆presentation变更，
  不增加Version Decision、Migration或Core/模型协议，不以本地卡片JSON测试冒充真实飞书客户端验收。
- 定向4文件119项、全量131文件/1257项Vitest、typecheck和Desktop build通过；回归覆盖100/200/1000条指令实时窗口、
  200条终态完整顺序、UTF-8字节驱动裁剪、超大单条诚实降级、跨窗口脱敏、独立publicResult、Host send/update及既有同步分页。
  文档治理9项、docs:check和以main e95f192d为显式base的docs:check:ci通过，UI detector无告警。
  Core封存/授权/撤回实现未修改；本轮不重复宣称外部客户端或打包验收。

本轮不访问日常渠道凭据，不发外部测试消息，不提交/push、不打包/安装/重启App；保留同worktree的命名与钉钉改动。

## 2026-08-31 渠道 Camp 命名

- 共享渠道创建改为普通 `default` 命名；首次成功 admission 复用现有确定性命名函数，继续使用同一原子
  CampMessage/Turn/Run 提交。五种已支持渠道均不再预填昵称/群名/项目名；既有标题不批量改写。
- Navigation、Camp Snapshot/Open 与 Notification hydration 只从既有绑定投影 `channelSource`，闭合绑定同样保留。
  Renderer 统一加来源前缀；重命名仍只保存原始标题，不新增 Migration、路由、权限或模型输入协议。
- 扩展既有 Rust admission/投影/通知 fixture，未新增昂贵独立数据库测试。渠道25项、普通协作44项、Read Model14项、
  Notification11项通过；`cargo clippy -p rovai-core --lib --tests -- -D warnings` 与格式检查通过。
- `pnpm typecheck`、Desktop build、文档治理9项、`docs:check`、显式 main base 的 `docs:check:ci` 通过。
  最后一轮 `pnpm exec vitest run --maxWorkers=2` 为130文件/1232项全通过；共享目录并行钉钉头像改动保持原样。
- `pnpm test:channel-camp-naming` 使用全新临时 userData/Skill Library，挂载生产侧栏、顶部和 Quick Chat，
  验证五种前缀、普通名称不变、长标题裁切及完整名称、键盘打开重命名、原生输入只保存原始标题、Day/Night与200%缩放。
  隐藏窗口使用与既有 sidebar acceptance 相同的 Chromium 键盘注入，退出前解除 debugger 并销毁测试窗口；
  不以窗口未收系统键盘事件修改产品菜单。200%下沿用现有窄视口滚动，不扩展为全局响应式重做。UI detector 无告警。

UI 夹具仅使用内存投影，不启动 Core/Runtime、不调用飞书或钉钉、不读取日常凭据；它不是外部渠道端到端验收。
本轮未提交、push、打包、安装或重启日常 App，钉钉既有 NO-GO 边界保持不变。

## 2026-08-31 PR #136 主线合并验证

先将下节钉钉内置扫码和静默取消的已验证改动保存为 `7b39e744`，再合入
`main@e95f192d8c50760321792d7b692a1772aa565957`（包含 PR #136 Camp Fast 自动检测）。
保留渠道共享 `execution-presentation` 与 Renderer re-export，把主线年月日标签迁入当前 owner；
主题同时保留渠道/二维码 Token 与主线资源链接 Token。执行台默认采用主线浮层，已保存的 `bottom`
仍原样恢复；对应渠道设置旧 schema 用例显式断言保存值，不把新默认值当作覆盖用户选择的依据。
主线 v1.34 Fast 的源验收记录随合并保留，当前版本仍为 v1.36，不新增 Migration 或 Version Decision。

合并后在当前共享 worktree 使用隔离 fixture 完成：

- `pnpm typecheck`、`pnpm test`（128 文件 / 1202 项 Vitest，220 项 Node 通过、1 项既有平台 skip）和
  `pnpm build:desktop`；
- staged 多 Rust target 路由执行 default-feature workspace 全量；另有292项 slow integration、
  `cargo clippy --workspace --all-targets -- -D warnings` 与 `cargo fmt --all --check` 通过；
- 真实 Electron 的钉钉内置扫码、contextBridge、Fast、文件导航、Composer 续发、执行头像栏和启动页面回归；
  执行头像栏首次未取得原生键盘焦点，单独复跑通过，未放宽断言或修改该夹具；
- `pnpm test:core-startup` 9项通过，涵盖旧失败 Turn 收敛、空闲 Camp 再接收输入、私有队列通知和启动恢复；
- 文档治理9项、`docs:check`、以同一 main SHA 为 base 的 `docs:check:ci` 与 diff 空白检查通过。

上述不调用模型、不读取日常渠道凭据，不等于钉钉真实扫码后的组织交互或远端收发验收；既有 NO-GO 项保留。

### 分支与 daily App 交付

- 合并提交 `972542ed` 已推送；GitHub 原生分支改名把 `rovai/channel接入` 统一为
  `rovai/channel-integration`，本地 upstream 同步，未强推或创建 PR；共享 worktree 目录不变。
- 以该代码快照执行 `pnpm package:mac:daily`，生成0.0.4 arm64 ad-hoc App，App/Core/CLI 签名门通过；
  Main SHA-256 为 `9bd20f67e78461ba2c9de99aced2b8a6231418f4e52bb305cfc5de86523303a6`，包内与构建产物一致，
  Core/CLI Mach-O UUID 也分别一致。此本地 daily 包不声称具有正式分发签名或公证资格。
- 独立 fixture `rovai-channel-main-bootstrap.xkP7PKM8Dm` 的 packaged Bootstrap、未知 authority 保留、
  Core 崩溃/WAL 恢复、可选子系统失败与同进程重试、双主题和200%布局验收通过；没有调用模型或访问日常凭据。
- `pnpm install:mac:daily` 已完成源/同卷暂存/最终目标三处验证，安装到 `/Applications/Rovai AI.app`；
  旧包保留为 `/Applications/Rovai AI.backup-before-channel-integration-20260831-972542ed.app`。
  安装后 Main SHA 与 Core/CLI UUID 与验收候选一致。
- 安装未退出或重启旧实例；Main34994/Core35007及原 Helper 继续存活，文件映射已随旧 bundle 移至备份。
  这是磁盘安装交接，不是热升级；用户退出后须从规范 Applications 路径启动新版本。没有写入、复制或清空日常数据。

钉钉新内置 Dialog 的真实扫码后验收、Owner/Core/群聊/卡片等外部 NO-GO 项继续保留。

## 2026-08-31 钉钉内置扫码与静默取消

- [x] `dingtalk_operation_cancelled` 在 Host 作为 no-op 收敛，Renderer 兼容 Electron 的自定义 Error 包装；
  网络/身份/存储失败仍显示，取消或迟到身份不提交连接、不清除旧账号；初始读取失败也释放 attempt；
- [x] 沿用飞书的 Rovai Dialog、图标、按钮与 Day/Night Token，DingTalk QR 直接读取官方可见 canvas；
  状态与存储说明分行，二维码留白；不打开独立可见窗口，不伪造 QR 或过期倒计时；
- [x] Main sandbox `WebContentsView` 在必要交互时嵌入内容区；只给 Renderer 有界 PNG/封闭阶段，只接收 exact-attempt
  矩形和刷新，不暴露 Cookie/Token、URL、脚本或通用浏览能力。缩放、滚动、动画和退出清理均有回归；
- [x] 定向 Vitest 5 文件139项、全量 Vitest 127文件1171项、typecheck、Desktop build、真实 contextBridge 回归通过；
  新 `pnpm test:dingtalk-login` 使用生产 Renderer/preload/native view 和本机页面，验证11类 UI/隔离行为；
  人工检查 Day/Night QR、过期、原生页单独截图与200%内容裁剪，不把 Renderer 占位截图当原生页面；
- [x] 匿名官方登录页的真实 QR 已在隔离 Electron 中经产品 DOM observer 读取；无用户 Cookie、扫码提交或应用创建。
  frame 读取不等待无关资源完成，另有真实 Electron 的慢资源 fixture 覆盖；
- [x] `pnpm docs:test`（9项）、`pnpm docs:check`、以 `48a9140f` 为 base 的 `pnpm docs:check:ci` 通过；
  [DingTalk Channel v5](../../contracts/dingtalk-channel-v5.md) 新增本轮交互/错误合同，v4 保持冻结；
- [ ] 用户在新内置 Dialog 中真实扫码后的组织选择/安全挑战、Core 原子连接及 packaged 验收仍需单独验证；
  不以本地 fixture 代替，不改变钉钉其他外部端到端 NO-GO 项。

这是局部可逆的登录呈现调整，不新增 Version Decision、不改变模型上下文、持久数据协议、发布或权限规则。
Impeccable 仅用于沿用既有 surface 和安静取消的错误交互；没有新视觉体系或 hook。本轮没有 Git index 写入、提交/推送、
打包、安装或重启日常 App。首次 Electron 并行运行的 bridge 用例退出超时，单独复跑通过；新夹具等待 DOM 的期限及
macOS 原生层截图清理已收敛，不放宽产品超时、安全设置或真实验收标准。

## 2026-08-31 渠道轮询与索引优化

- [x] 飞书/钉钉 Host 共享 `ChannelHostTickRequest`，Main 直接传 worker/limit；Core 直接返回 claims/roster refresh，
  不再生成或持久化 `channel_host.tick` command result；既有轮询间隔不变；
- [x] 维护、FIFO admission 和领取保留同一个 IMMEDIATE 写事务。真实 admission 审计、queued/head 防重、delivery lease、
  stable dedupe key 与 settlement 的永久幂等回执不变；没有给通用 DomainCommandGateway 增加日志豁免开关；
- [x] Migration 129 保留已冻结的 128 及更早迁移，通过新 Data Contract `v1.40 / projection schema 81` 精确准入；
  先确认等价 `UNIQUE(agent_run_id, sequence)` 索引存在，再原子删除额外普通索引，不修改 Evidence/Blob/业务行；
- [x] 不清理历史 poll 回执或旧 delta，不执行 VACUUM，不修改备份复制或其等待策略；释放页仅供 SQLite 复用，
  不承诺升级后文件马上缩小。本轮不推送、不打包、不安装或重启日常 App，不写日常数据；
- [x] 本轮 Rust、TypeScript、文档与 Desktop 构建验证。

测试归属：新增 `host_ticks_are_ephemeral_and_reject_untrusted_or_invalid_requests` 拥有此前没有的维护请求/零回执合同，
修复前空轮询会新增 event 行；需完整 SQLite 查询面，但不启动 Runtime，其他域的既有 happy path 不重复。
新增 `v129_removes_only_the_redundant_index_atomically_and_keeps_sequence_uniqueness` 使用最小 in-memory schema，
拥有独立的 128→129 升级、缺失唯一约束拒绝、DDL/marker 回滚、保留内容和 indexed range scan。
修复前已升级来源仍保留重复索引；该索引/回滚矩阵此前没有 owner，不并入只负责整库 copy/switch 的集成 fixture。
既有 FIFO fixture 扩展响应丢失/lease 恢复/真实 settlement replay/下一根只准入一次；既有 copy/switch fixture 增加 joined-128
来源并保留其他四种来源，未新增第二个完整迁移 fixture。未删除或禁用 active Rust tests。
最小回归为 `cargo test -p rovai-core --lib channel::tests::`、
`cargo test -p rovai-core --lib db::tests::v129_` 和
`cargo test -p rovai-core --lib authority_migration::tests::supported_database_is_migrated_on_a_copy_and_atomically_readmitted`。

本轮本机验证：

- `cargo fmt --all -- --check`、`cargo check -p rovai-core --all-targets` 与
  `cargo clippy --workspace --all-targets -- -D warnings` 通过；Rust 构建限制为 `CARGO_BUILD_JOBS=2`；
- `cargo test --workspace --quiet -- --test-threads=2` 通过：Library 454、CLI 32、Core 184，保留原有 4 项 ignored；
- `cargo test -p rovai-core --features slow-tests --lib slow_tests:: --quiet -- --test-threads=2`：291 通过；
- 最后扩展的 FIFO fixture 另用
  `cargo test -p rovai-core --features slow-tests --lib channel::tests::group_binding_freezes_messages_sends_one_card_and_promotes_fifo_atomically -- --exact`
  复核通过：固定过期/有效 lease，既验证领取失败的 lease 回滚，也验证已创建 Message/Turn/Run 与审计事件整笔回滚；
- `pnpm typecheck`、`pnpm test` 通过：Vitest 124 文件 / 1124 项，Node 220 项通过 / 原有 1 项平台 skip；
  两个 Channel Settings 文件最后定向复核 81 项通过；`pnpm build:desktop` 通过；
- `pnpm docs:test`（9 项）、`pnpm docs:check`、以 `91ecd6d40d8618af20e3a3aa3d839d22da320637` 为
  `DOCS_BASE_REF` 的 `pnpm docs:check:ci` 和 `git diff --check` 通过。

首次默认并发全量曾在未改动的 `installed_catalog_discovery_runs_only_bounded_identity_commands` 出现版本探测失败；
该测试单独复跑和上述 2 线程 workspace 全量均通过，没有修改、忽略或删除该测试。以上均为隔离 fixture/构建验证，
不代表重新进行渠道远端验收或 packaged App 验收。

## 普通升级原位事务与启动反馈

本节替代上文实施当时的默认 copy/switch 执行方式；不改主线汇合的编号、历史 Migration 128 封口或现有 129。
当前目标仍为 `v1.40 / projection schema 81 / migration 129`。规范见
[Desktop Runtime Availability v2](../../contracts/desktop-runtime-availability-v2.md)、
[Channel/Main Schema Join v2](../../contracts/channel-main-schema-join-v2.md)与 [V1.36-D07](decisions.md#v1-36-d07)。

- [x] 普通 Upgrade 只消费 lease-bound ticket 的 exact path，以 READ_WRITE/NOFOLLOW/NO_MUTEX、无 CREATE 打开；
  WAL/NORMAL/FK ON/busy_timeout 5000。任何写入前重验合同、classifier、schema cookie、完整 receipts 与文件身份；
- [x] 既有逐版本 migration/精确 reconciliation 原位执行，不新建普通 snapshot/backup/manifest、不切换 main；
  失败回滚当前步骤、已提交 receipts 保留，重开从缺失步骤继续；
- [x] 旧 manifest recovery 保留 original/migrated 两侧恢复；仅该兼容 rename 允许解释 ctime，普通 admission 仍严格；
- [x] 移除受支持旧来源升级中的全库 quick_check/foreign_key_check。重建步骤提交前只检查显式受影响表及其入向 FK
  依赖；入向关系只读 schema metadata，不扫描无关历史。Pending/Fast 与 sealed snapshot/credential 关键对象单独核对；
- [x] 重新 assessment/reopen 前后保持同一 main identity。Supervisor 跨 generation 保留已确认存在或瞬时未能确认的
  authority 边界，以 `--require-existing-authority` 禁止失败、手动重试或 crash restart 初始化空库；首次明确 absence 不受影响；
- [x] 数据库启动瞬时错误独立 250/750/1500ms 重试，等待旧 child 退出，不占 crash budget；确定性错误和领域恢复不自动重试；
- [x] 沿用 rail/顶行/400ms 延迟与双主题，启动文案统一“正在打开会话”；最终失败为“暂时无法打开会话”，提供
  “重新打开”/“导出诊断”，原始错误仅进诊断；无业务空态或提前挂载 authority hooks；
- [x] 记录 assessment/open、reconciliation、逐 migration、reassessment/reopen 与 core_ready 的 stage、耗时和源/目标合同；
- [x] 当前最终快照的全量测试、静态检查、Desktop build 与文档 gates，实际结果见下方。

### 迁移审计

117–125 均使用自身 IMMEDIATE 事务；schema/data、marker、receipt 在同一个事务提交。没有外部文件写入、远端调用或
依赖主文件切换，全部进入同一原位链。保留原有已发布 clean-break 语义，不利用本次优化重新定义旧迁移的数据处理。

| Migration | 操作与局部边界 | 失败/恢复 |
| --- | --- | --- |
| 117 | Developer identity 列、publication intent；按既有合同断开旧账号并仅删除未被 Bot 引用的旧账号 | 整步事务；无外部 Session/凭据文件迁移 |
| 118 | Owner/项目目录/Pending binding 与 Channel 队列、投递表重建 | 临时关闭 FK，提交前局部 FK 检查，失败整步回滚 |
| 119 | Execution Console、outbox/schema 重建及身份 trigger | 同一事务，FK 约束保持，receipt 不早于 schema |
| 120 | 当时的 console display/page/view 列 | 同一 additive 事务；后续由 125 清理，不在本次另造兼容状态 |
| 121 | terminal_pending/terminal_sealed 与 console 重建 | 临时关闭 FK，局部检查在提交前 |
| 122 | DingTalk account/publication/Bot/Owner 与 provider-neutral views | 同一事务，原 Feishu 数据保留 |
| 123 | DingTalk publication 模式表重建与已知应用身份保留 | 同一事务，不重新创建远端应用 |
| 124 | `channel_credentials`/`channel_developer_sessions` | 同一事务；不读取、解密或迁入已退役 `.bin` |
| 125 | terminal snapshot 列、旧 view state 清理、历史已 sealed 内容及 Blob reference 固化 | 为保持不可变历史所需的转换留在本事务，失败不提交 receipt；无通用历史重算 |
| 126/127 | Pending schema；Fast revision 列/回填、偏好表/trigger | 各自事务；main 精确来源先用独立事务映射 receipt，保留 applied_at |
| 128/129 | 两侧完成后 seal；验证等价 UNIQUE 后删除重复索引 | 分开的事务，当前目标129，不改128历史意义 |

同时复核受支持更早来源的可达链：72/90/96/97 原本有事务外 DDL，已并入本步 IMMEDIATE 事务；此前25处在提交后做的
全库 FK 检查改为本步提交前的局部检查。最早的1/2 bootstrap DDL 仅用于 fresh initialization 并在同一事务写 receipt，
已获旧库 ticket 的升级不再重放首次初始化语句。99 的 preflight 只读核验旧附件，必要时临时恢复受管目录的 owner read/execute
用于检查并恢复原 mode；它不复制/替换数据库或发布外部附件，但不宣称完全没有文件系统操作。100 的既有 DB-only
历史 receipt 转换仍随本步提交。更早不可准入来源没有新增 snapshot fallback，也没有新增猜测性修复。

### 测试归属与隔离边界

- 既有完整迁移 owner 更名为 `supported_database_is_migrated_in_place_and_readmitted_without_snapshots`，保留五种来源和
  全部业务/credential/Session 保留断言，增加 main identity 不变、无新 snapshot/backup/manifest；含 Lumen 精确路径；
- 既有进程中断 owner 扩展为四个窗口：旧切换前/后、精确 receipt 重映射后、126 提交后。进程强杀不能由正常关闭连接的
  低层单测替代；测试 writer 只在 cfg(test) 编译，生产 Upgrade 不再包含 snapshot writer；
- 新增最小 in-memory owner 验证72/90/96/97的 DDL/receipt 同事务回滚，和局部 FK 检查的入向依赖/无关历史边界。
  修复前 receipt 失败会遗留列、或全库检查把无关表问题带入升级；不为这些输入建立完整 workspace；
- source recheck owner 在已消费能力中改变 contract/projection/classifier/receipt/schema cookie，隔离验证 SQL 复核；
  原文件字节不变。path owner 单独覆盖删除/替换、sidecar、另一 namespace 和重新准入/重开窗口，较低层纯函数无法
  证明 exact connection 不会另建空库。原子步骤 owner 注入127失败，验证126保留且重试不重复；
- legacy rename 用纯 token 矩阵拒绝换对象、变长度/mtime和畸形状态，普通票据仍不接受 ctime 差异；
- Main tests 覆盖有限重试、独立预算、旧 generation、取消与跨次启动的禁止初始化标志；真实 Core 隔离进程验证
  `--require-existing-authority` 在 absence 上拒绝、不创建 Rovai/Lumen。首次明确 absence 与后续 Runtime preparation
  失败的状态区分有单独回归；
- 真实 Electron 自动 fixture 验证400ms、先订阅后读取、authority gate、安全错误文案与双主题/200%/reduced motion；
  未启动真实 Runtime，不读取日常 SQLite，不安装/重启日常 App。Impeccable clarify 只影响文案层次与已有布局适配。

最小复核：`cargo test -p rovai-core --lib authority_migration::tests::`、
`cargo test -p rovai-core --lib db::tests::additive_migrations_commit_columns_and_receipt_in_one_transaction`、
`cargo test -p rovai-core --lib db::tests::migration_foreign_key_checks_`、
`pnpm exec vitest run apps/desktop/src/main/core-client.test.ts apps/desktop/src/renderer/src/App.test.ts` 和
`pnpm test:startup-presentation`。全部新增 owner 均为独立失败语义，没有禁用或删除 active Rust tests。

### 本轮最终验证

- `CARGO_BUILD_JOBS=2 cargo test --workspace --all-features --quiet -- --test-threads=2` 通过：
  Library 781（含 slow/legacy migration）、CLI 32、Core 189；保留原有4项 ignored，无新增 ignored；
- `cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets --all-features -- -D warnings`、
  debug Core build、`pnpm typecheck` 与 `git diff --check` 通过；
- `pnpm test` 通过：Vitest 124文件/1130项，Node 220项通过/1项既有平台 skip；文档9项与 Skill authoring 3项也通过。
  最后 Main/App 定向163项通过；`pnpm build:desktop` 通过，只生成构建输出，没有打包/安装；
- `node --test scripts/lib/core-startup-availability.test.mjs` 7项通过，使用最终 debug Core 与全新临时 data-dir。
  证明真实 startup assessment 的 existing/absence 区分、领域恢复拒绝、可选子系统恢复及禁止空库初始化；
- `pnpm test:startup-presentation` 的真实 Electron Renderer 回归通过，并人工检查 Day/Night 的 loading、最终阻断和
  局部错误截图，以及200%/reduced-motion。Capture 的本地 API 返回与指定主题一致，避免测试桩的迟到 day snapshot
  污染夜间截图；没有改产品主题或另建视觉体系；
- Impeccable detector 已手动运行；其现有全局边框/动画提示均不在本次新增的三条布局规则中，不为消除工具提示重设计
  无关页面，也未安装 hook/plugin；
- `pnpm docs:test`、`pnpm docs:check`、显式 `DOCS_BASE_REF=91ecd6d40d8618af20e3a3aa3d839d22da320637` 的
  `pnpm docs:check:ci` 通过。该主线基线尚无渠道 `v1.35/decisions.md`，既有 Git 查询仍输出缺失路径提示，
  治理检查最终成功；未添加 checker 例外。

首次启用全量 legacy 测试时，旧 v80 fixture 仍断言 current schema 只接受 Shutdown v2，忽略113已引入 v2/v3。
已把断言同步为当前 schema 的兼容约束；未改变产品协议、删除测试或跳过失败。上述最终全量已经包含修正后复跑。
本轮没有写日常 SQLite、清理历史记录、运行 VACUUM、复制日常库、推送、打包、安装或重启日常 App；不等同于
Windows/macOS packaged 验收或渠道远端验收，既有钉钉 NO-GO 项保持原状。

## main 48a9140f 汇合与日常安装

本次按用户要求合入最新main并打包到Applications；原位升级协议、独占lease、精确Rovai/Lumen票据、有限启动重试和
禁止空库回退保持不变。`database_admission.rs`、CoreClient生产逻辑和Desktop Runtime Availability v2与合并前存储提交一致。

- main新增119与渠道119重号：保留渠道116–129的含义，Fast生命周期修复追加130，131单独封闭 `v1.41/schema 82`；
  精确main `v1.34/schema 73` 将119重映射130，保留applied_at、Fast覆盖/代次以及已经重新检测的资格缓存。
- 新source加入既有最小schema拒绝矩阵；现有原位集成owner覆盖七种来源，原有四种强杀窗口保留并增加
  main119重映射后、130提交后两个窗口。main119偏好保留测试按130编号接入同一owner，增加事务失败回滚和缺失trigger拒绝封口；
  没有删除、禁用或替换其他active Rust case。
- 已核对三项Fast trigger的规范化SQL与main原定义一致。128仍封闭v1.39/schema80，129仍封闭v1.40/schema81；
  新功能receipt与最终seal分离，避免映射后的130跳过合同推进，不恢复复制库路径或增加迁移框架。
- 数据库定向59项、TypeScript检查、Vitest126文件/1142项、Node220项（1项既有平台skip）、文档与Skill门禁通过；
  真实Electron启动呈现、连续输入、执行头像栏与审批Dock四组回归通过。
- 首轮并行构建暴露启动重试fixture的5秒外层超时短于其6秒内部等待；仅将该测试上限设为15秒，保证清理先于下一case。
  产品250/750/1500ms重试与generation逻辑未改，定向和全量Vitest复跑通过。
- Rust all-features全量通过：Library783、CLI32、Core189，保留4项既有ignored；Clippy all-targets/all-features、
  `cargo fmt --check`、debug Core构建和真实Core启动8项通过，后者覆盖私有队列通知、功能恢复与禁止空库初始化。
- 合并代码提交为 `201b93d2`。`pnpm package:mac:daily` 生成0.0.4 arm64 App并通过ad-hoc签名门；
  App内Core/CLI Mach-O UUID与本次Release二进制一致。
- `pnpm accept:bootstrap-shell-ui` 使用全新临时data-dir/Skill Library通过：unknown authority字节保留、明确重试不消耗
  crash budget、Day/Night/200%/reduced motion、真实Core强杀后的事务回滚、1024条已提交fixture行保留、Renderer错误结构与
  generation恢复，以及Skills降级后原Core内恢复。另只读核对fixture实际合同为 `v1.41/schema82/migration131`；
  人工检查阻断与恢复截图，没有使用日常数据或启动模型。
- 已通过 `pnpm install:mac:daily` 安装到 `/Applications/Rovai AI.app`，源/同卷暂存/目标三处验证通过；
  旧包保留为 `Rovai AI.backup-before-channel-main-20260831-133034.app`，安装后Core/CLI UUID再次与Release一致。
  原日常App/Core/Helper六个PID均仍存活；没有重启日常App，也未留下本轮dist验收进程。
- `pnpm docs:test`、`pnpm docs:check` 及显式main SHA的 `pnpm docs:check:ci` 通过；没有为渠道历史目录增加检查例外。

本次不推送或创建PR；不修改日常SQLite，不替换用户数据，不主动终止日常App。钉钉外部端到端NO-GO边界仍保留。

## 主线合并兼容

- [x] 合并 `main@91ecd6d4` 的 Camp Pending/Fast 与文件预览；保留主线 v1.33/v1.34，渠道记录顺延到 v1.35/v1.36；
- [x] 保留已安装渠道 Migration 116–125；精确识别旧 main 117/118 并在 staging copy 重映射至 126/127，128 封闭新合同；
- [x] 既有 copy/switch owner 扩展四种升级来源，证明渠道 credential/Session、Camp/Draft、Pending 和 Fast binding 保留；
- [x] 合并 `main@4e796bde` 的外部附件快照、Camp Detail Popover、局部启动 loading 与 Composer 输入修复；
  保留主线 v1.32，当次渠道历史/当前记录顺延为 v1.33/v1.34，不改模型确认或历史验收事实；
- [x] 合并 `main@27c6b16f` 的 File Preview 与 Availability-first Runtime；版本编号冲突按来源记录迁入 v1.32/v1.33；
- [x] 渠道 Host 随 Core authority generation 启停和恢复，旧启动/关闭并发不会留下重复连接；
- [x] 保留完整渠道 migration chain，并通过真实 ticket/copy migration 验证旧飞书 marker collision 与 Bot/账号保留；
- [x] ExternalQuote 保留普通 Camp 的不可跳转引用外观，同时消息正文继续支持主线文件预览入口。

## 飞书执行卡呈现回归

- [x] 按 [Feishu Channel v6](../../contracts/feishu-channel-v6.md) 实现总折叠内的真实 timeline、文字最多 10 行、单条原生
  command 折叠和无二级标题结果框；长结果前 9 / 提示 / 后 10，并限 4KiB，先脱敏再截断，apply_patch 仅结构化文件变化；
- [x] 15-command、50 个递归 element 与整卡 24,000 UTF-8 bytes 预算分页，文字和后续首条 command 尽量同页；
  首次终态总面板收起，任何翻页后展开，单条 command 仍收起；钉钉纯文本格式不变；
- [x] Migration 125 清理旧 view state，封存内容及 Blob reference；迟到 evidence/正文不改 sealed timeline，重启/旧数据
  copy migration 保留 App/message/sequence，完整 Blob 缺失 fail closed；
- [x] 分页复用 Owner/原 App/原消息/sealed sequence 授权，唯一更新放进同步 response card，不单独 PATCH、发 upsert 或触发 pump；
- [x] 正式卡和显式预览共用分页呈现及 2.5 秒响应预算，超时后不追加迟到卡片；SDK 按 event ID 去重，
  成功无 Toast，错误只返回安全 Toast；完全离线时由飞书处理，不增加云端服务；非 callback 更新仍检查业务码；
- [x] 通过真实 SDK WebSocket 帧和 ACK 编码验证 200-command 卡的 2→3→2→1 与末页往返，目标页随同步应答返回、
  无 pre-ACK PATCH；覆盖不同点击与相同 event 重投、非 Owner、超时与预览不可变性；
- [x] 扩展现有卡片/Main 测试与 Core 生命周期 owner，覆盖安全输出、空结果、成功/失败/取消、分页/UTF-8 边界、
  长 Blob 恢复与不可变性；不新增重复 Rust fixture owner，既有 migration 准入矩阵继续覆盖所有受支持来源；
- [ ] 在实际飞书客户端验收新终态卡的展开/收起与多页往返；既有 sealed 卡不批量回填。

## 飞书永久正文卡

- [x] 实际作者 Bot 新建无标题 Card 2.0；正文下方的接收对象行使用空格分隔原生 @，没有逗号、顿号、角色标签或 callback；
- [x] Core 以公共 MessageDelivery 顺序投影 A2A 对象，以 Structured Content 投影 Owner attention；移除飞书专用正文中的
  结构化 CurrentUserMention，但不改源消息、digest、普通字面 `@你`、Renderer 或 Agent Context；跨账号/不可用 Bot 不猜身份；
- [x] 从真实 `reply_to_camp_message_id` 投影同 Camp 直接父消息；卡片顶部显示静态作者/3 行、240 字符摘要，不回退到 Topic
  root，不嵌套引用、不额外 @；缺失/删除/越界显示不可用，无关系不显示；无需新增数据库字段；
- [x] 完整长正文按 24KB 预算拆成连续卡片，保留 Unicode/代码围栏，每片都使用原 Topic root；仅末片 @，稳定分片 UUID 覆盖
  飞书一小时内的部分发送重试；仅首片显示回复摘要；原 Outbox/附件顺序/失败边界保留；
- [x] 未发送旧 delivery 在 claim 内升级，已有投影重试不重算；已发历史不回填，钉钉输出保持不变；
- [ ] 授权安装新构建后，在真实 Camp → Core Outbox → 飞书链路验收正文、真实回复摘要、A2A/Owner footer 和超长卡片；
  此前同一话题的双样式预览仅证明原生 mention 和布局可行。

## 外部验收与生产门槛

- [x] Web Session 路径不需要生产 OAuth Client 或 token broker；不再作为本版本阻塞项，不保留设备授权备用；
- [x] 在用户授权的测试组织证明连接后应用数不变，显式创建后只有一个普通内部应用；无需重新扫码即可配置/发布；
- [x] 隔离 Electron 首次扫码、完整进程重启恢复 Cookie，以及仅缺失 console access_token 时由官方 SSO 续接；
- [x] 同一应用的凭据、头像、Bot、四项最小权限、Owner-only 1.0.0 免审发布与冻结版本读回；产品 completed 只读恢复零 mutation；
- [x] 编译后的产品 PNG multipart 上传与真实 Stream connected readiness；OpenAPI Owner 私聊请求接受、AI 卡片实例创建；
- [ ] 真实撤销/取消/断网矩阵、账号切换失败、需要显式审批的组织和 packaged App/Core 重启恢复；
- [ ] 证明每 App Stream 断线恢复、Owner 私聊、Owner 群 `@`、non-owner gate 和 `/new`；
- [ ] 证明项目卡投递/callback、执行卡 streaming/终态翻页、Markdown 永久输出与应用管理链接；
- [ ] 取得多 Bot canonical mentions、话题和 app-only 附件官方可行性证据后，另行决定是否解除对应 feature gate。

## 2026-08-31 主线汇合验证

- `pnpm typecheck`、`pnpm test` 通过：124 个 Vitest 文件 / 1124 项；Node suite 220 通过，1 项 Windows 专属跳过；
- `pnpm test:rust:pr` 通过：Library 452、CLI 32、slow integration 291；严格 workspace/all-targets Clippy 与 fmt 通过；
- Core binary tests 184 通过，4 项既有显式 ignore 保留；不代表 all-features、Windows 原生或真实 Runtime 付费执行验收；
- 原 `supported_database_is_migrated_on_a_copy_and_atomically_readmitted` 扩展旧主线、旧渠道、main Pending/Fast
  四种来源，保留 Camp/Draft、凭据/Session、队列及 Fast binding；没有另建重复完整 fixture owner；
- 新增 `main_camp_collision_rejects_lookalike_markers_and_partial_schemas`，只用最小 in-memory SQLite，拥有新旧编号
  冲突的精确准入拒绝边界；修复前 main marker 不可升级。该 schema/ledger 矩阵不能由纯布尔 admission 或 copy seam 代替；
  最小命令为 `cargo test -p rovai-core --lib db::tests::main_camp_collision_rejects_lookalike_markers_and_partial_schemas`；
- 既有 Pending/Fast migration owner 保留全部输入与配置断言并适配追加编号，未删除或禁用 active Rust tests；
- 原生 Electron 的 Composer continuation、Camp Fast、file preview layout、desktop bridge 共四项通过；Desktop build 通过；
- 文档测试、版本/决定/链接门禁及以 `91ecd6d4` 为显式 base 的 docs CI 通过；未用日常 SQLite 或真实渠道发消息做本次回归。

## Go / No-Go

仓库门禁通过只表示实现可构建和本地合同成立。任一真实租户关键链路未证实时，钉钉渠道仍是
`NO-GO`；不得用本地 mock、Developer API 本地响应或卡片实例创建替代远端收发证据。

## 2026-08-30 主线合并验证

本次合入 `main@4e796bde`，以新的 v1.34 路由执行验证：

- `pnpm typecheck`、`pnpm test` 通过：123 个 Vitest 文件 / 1041 项；Node suite 220 通过，1 项 Windows 专属检查跳过；
- `pnpm test:rust:staged` 按多 target 路由执行 `cargo test --workspace`：Library 438、CLI 32、Core 182 通过，
  4 项既有显式 ignore 保留；不代表 slow/all-features 或真实 Runtime 验收；
- `pnpm test:composer-input`、`pnpm test:startup-presentation` 在隔离 Electron 夹具中通过；
- 文档版本、决定、链接检查及 `DOCS_BASE_REF=4e796bde pnpm docs:check:ci` 通过；
- `cargo fmt --all --check` 通过；仅对钉钉 checkpoint 的 Cookie 校验与既有测试执行 rustfmt，不改变语义；
- 惠的 200-command 混排预览已由飞书创建并回读，14 页，同 UUID 重放返回同一条消息；这不替代实际 callback 往返验收。

上述是主线合并时的证据快照；钉钉后续进展见下一节，不因主线合并或打包自动转为已验收。

## 2026-08-30 钉钉 Web Session 发布接入

- `pnpm typecheck` 与全量 `vitest run` 通过：123 个文件 / 1109 项，包含同 worktree 的飞书回归；
- `pnpm build:desktop`、`pnpm docs:test`（9 项）、`pnpm docs:check` 与 `DOCS_BASE_REF=4e796bde pnpm docs:check:ci` 通过；
- DingTalk 定向回归覆盖控制台 payload、同应用恢复、创建/版本 checkpoint、Owner-only scope、PNG、void success 与 Stream 假成功/迟到连接；
- 隔离远端证据见[研究记录](../../research/dingtalk-web-session-probe.md)。没有新增第二个测试应用，也没有更换其冻结版本；
- 本轮无 Rust 产品变更，不把此前 Rust 或 packaged 结果当作本轮新增实测；没有提交、推送、打包、安装或重启日常 App。
