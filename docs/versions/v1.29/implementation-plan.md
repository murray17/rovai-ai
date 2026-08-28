---
document_type: implementation-plan
version: v1.29
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-27
---

# v1.29 Camp 动态队员管理与 Workspace Change Observation 实施计划

本计划记录 Camp 动态队员管理、Workspace Change Observation 与 ACP Client FS 权限收敛的实现和验收事实。
Camp 动态队员管理、Managed Attachment v2 与 ACP Client FS 权限收敛已完成；Workspace Change Observation 的
未勾选项仍不得从 accepted Contract 或局部测试推导为交付。

## 已完成：Camp 动态队员管理与 Managed Attachment v2

- [x] 确认添加、移除、至少一位成员、Lead successor、普通再次添加与模型上下文边界；
- [x] active member（包括 away）相同 capability overrides 保持 no-op，不同 overrides 显式 conflict；受信
  source 的 accepted no-op 正常推进 source reconciliation generation；
- [x] 完成 Migration 110、membership generation/version、外部来源绑定与旧非终态工作 clean break；
- [x] 独立完成 Migration 111 zero-attempt cancellation hotfix：从 current-main v110 数据库升级到
  Data Contract v1.24/schema 65，显式/批量取消复用转换并清除 wait/attempt/projection association；
- [x] 完成 Migration 112 Managed Attachment v2：新 Composer/Agent 文件经 durable intent 一次 ingest，最终
  Message/ref/Delivery 事务绕过 legacy View gate，历史 v1 保持只读兼容；
- [x] 完成 Migration 113 planned shutdown protocol 扩展：保留历史 pending v2 cycle，并允许新 v3 cancel-all
  intent 持久化与重启补偿；
- [x] 保持 Context DB-only：v2 payload 缺失时仍投影持久路径，不增加 unavailable descriptor 或 Run Fact；
- [x] 解除新 Run 对 legacy View readiness 的隐式依赖：no-legacy receipt 不查 View，失败 legacy locator 安全省略，
  dispatch 使用稳定 Camp root 且不取得 read admission、不检查 unresolved writer intent、不触发 rebuild；
- [x] 完成 add、removal preview、atomic cutover、durable reconciliation 与任务释放；
- [x] 给 Agent 业务工具、Message Delivery、Gather completion 和公开输出增加 exact membership lifetime fence；
- [x] 收口 ordinary outbound source lifetime：pending Delivery cutover、materialized target reconciliation 与
  dispatch/retry 双重 fence；
- [x] 完成 Desktop typed IPC、Camp open projection 与 event invalidation；
- [x] 完成添加多选、成员 `•••` 菜单、权威移除预览、最后成员禁用和 reconciliation 状态；
- [x] 完成安全退出交互：立即阻止新界面操作，400ms 内完成不闪现等待面，慢退出显示中性 busy modal；
- [x] 关闭状态停止页面投影刷新，抑制取消结算期间的晚到错误横幅与 Toast；
- [x] 完成 Rust、TypeScript、Renderer 与 Migration 定向回归；
- [x] 运行完整自动化、文档治理和格式/Clippy 门禁；
- [x] 使用隔离 userData 在真实 App 验收日/夜主题、键盘、添加、移除、冲突和恢复；
- [x] 提交并推送 `rovai/dynamic-camp-membership` worktree 分支；
- [x] dynamic membership 基线已通过独立 PR 合入 `main`；zero-attempt cancellation 继续使用独立 PR，
  不替换本机 App；
- [x] 以真实 `projection_blocked` CampTurn Stop、显式 pending/interrupted 取消、已有 attempt 取消、迟到
  projection success/failure、current-main v110→v111 升级及 restart 回归证明 cancelled terminal 单调；

### 验收原则

- 添加只改变未来新 Run；旧 Run 的 Context、授权和 membership lifetime 不被改写；
- 旧 Run 可以按 send admission 的当前名册联系后来加入的成员，但其 accepted outbound Delivery 不能越过 source
  membership cutover；
- 移除提交成功即阻止新业务效果，reconciliation 只描述已接受工作的正式终态进度；
- 离开后再添加不会恢复任何旧 Run、Delivery、Gather、Task ownership 或 Tool capability；
- UI 不用乐观假状态代替 Core generation/version，也不隐藏至少一位成员的约束。

### 验证证据

- `pnpm test`：82 个 Vitest 文件、585 个 Renderer/TypeScript 测试通过；Node 协议测试 219 个通过、
  1 个既有用例按环境条件跳过；
- `pnpm typecheck`、`cargo check --workspace --all-targets`、
  `cargo clippy --workspace --all-targets --all-features -- -D warnings` 通过；
- `cargo test -p rovai-core --all-targets`：Core library 326/326、CLI 25/25、Host 161/161 通过，4 个显式
  manual Runtime smoke 保持 ignored；其中 Migration 111 回归从 current-main 的
  `v1.23 / schema 64 / migration 110` 数据库复现 SQLite 275，再升级到 `v1.24 / schema 65`，验证
  zero-attempt cancellation 可写、Migration 111 重启幂等且 terminal Delivery 不复活；Migration 112 再从
  `v1.24 / schema 65 / migration 111` 升级到 `v1.25 / schema 66` 并验证重启幂等；Migration 113 保持该
  contract/schema marker，验证 pending v2 cycle 不丢失、新 v3 cycle 可写且重启幂等；
- Managed v2 回归覆盖源 Run 仍为 `running` 时发送 4 个共 14 MiB 文件、Delivery 在源 Run 结束前开始、零
  legacy publication operation/gate、同一 attachmentId 多 Message ref 不二次复制、Context 在 payload 被删后
  仍只按数据库投影稳定路径、legacy rebuild 不删除 v2 resource，以及 staging/promote 两个 commit 前 crash
  窗口的 orphan cleanup 与同 command id 重试；
- `cargo clippy -p rovai-core --all-targets --all-features -- -D warnings` 通过；
- `cargo test -p rovai-core --features slow-tests --lib slow_tests::`：291/291 通过，覆盖动态 membership、
  active-away no-op/source generation、当前名册 target admission、ordinary outbound source-lifetime
  cutover/dispatch/retry fence、exact-run business-tool fence、Delivery/Gather settlement 与 Missing-Send
  Recovery publication fence；
- `node --test scripts/benchmark/protocol/product-contract.test.mjs`、`pnpm docs:test`、`pnpm docs:check` 通过；
- `DOCS_BASE_REF=f588c773c2652a9e78887a31d17de8ed37524bb0 pnpm docs:check:ci` 通过；
- `pnpm package:mac:unsigned` 通过；`pnpm accept:member-lifecycle-ui` 使用系统临时目录中的隔离 userData
  与打包 App 通过，覆盖最后成员禁用、模型详情、添加、移出预览、普通再次添加、日/夜主题、键盘、无横向
  溢出、重启持久化和旧库迁移；当前受限执行环境不允许 macOS/Chromium sandbox 初始化，因此仅该验收进程
  使用 `ROVAI_MEMBER_LIFECYCLE_ACCEPT_NO_SANDBOX=1`，产品默认启动参数未改变；
- `pnpm package:mac` 与 `pnpm accept:planned-shutdown` 通过；隔离打包 App 在真实 Runtime 活跃时满足 5 秒
  关闭目标，并验证 400ms 防闪、“正在安全退出”日/夜主题、200% zoom、reduced motion、无操作按钮、
  无关闭阶段错误横幅、Run-local 取消审计、未知效果保留、自然退出和完整进程树回收；
- 本次 `pnpm test:rust:pr` 三个分组全部通过，无忽略或失败测试。

## 1. 设计与数据模型

- [x] 冻结两层产品定义、Camp/exact execution root scope、非归因语义、DB/ref 与历史 Evidence 权威、fail-open 原则；
- [x] 建立当前 Architecture、Contract、版本决定、Runtime audit、UI 方案与跨版本路由；
- [x] 设计并迁移 `WorkspaceChangeWindow`、active-key 唯一约束、参与关系、捕获时间、candidate/ready OID、
  capture manifest、状态、Managed Blob root 和清理 ledger；
- [x] 完成 Migration 114，将当前 Data Contract 升为 `v1.27 / schema 68`；以 lifecycle 独立的 cleanup ledger
  保存 baseline/final expected OID、失败码与重试次数，并迁移 closed Window 遗留 candidate；
- [x] 为 `windowId` 建立 UUID v4、固定长度随机 ref token、create-if-absent CAS 与 ref target/type 校验；
- [x] 冻结 v1 的 capture deadline、attempt、文件数、总字节、单文件、patch 和 rename 常量及诊断 code；

## 2. Git checkpoint 与 synthetic tree

- [x] 实现 repository/worktree identity 观测与 canonical execution root 计算；开始和结束时复核
  `repositoryRoot + worktreeGitDir + gitCommonDir + objectFormat + object database layout`，允许 HEAD/branch 变化
  但拒绝身份替换；清除 Git env/config 注入并禁用 hooks；
- [x] 使用受控 Git plumbing 写 raw blob/tree；定向 fixture 证明不触碰 index，调用路径不经过 clean/LFS filter、textconv 或 external diff，
  且不修改 staged 状态和普通 refs；
- [x] 实现 candidate DB write -> ref create/verify -> DB ready promotion 的 recoverable saga，以及
  `refs/rovai/w/<token>/b|f` 的 create-if-absent CAS、diff 前 expected-OID 验证和 compare-and-delete；
- [x] 实现 exact-root 路径集合：tracked、捕获时 non-ignored untracked、baseline sticky ignored path；永久排除 `.git`；
- [x] 持久化 baseline/final capture manifest，并对 materialized/sparse-omitted 来源切换做等价证明或 fail unavailable；
- [x] 实现 symlink no-follow、executable bit、sparse-checkout 未物化路径、nested repository/submodule opaque boundary、
  delete 与 bounded rename detection；
- [x] 实现连续两次 OID 相同的稳定捕获、attempt/count/bytes 限制与 `captureStartedAt` / `capturedAt`；
- [x] 为 Git discovery、capture plumbing、ref 与 diff 使用同一边界的剩余绝对 deadline；stdout/stderr 流式限容，
  超时/超限终止并 reap 进程树，不再以无界 `wait_with_output()` 承担输出上限；
- [ ] 补齐 Linux/Windows/SHA-256/linked-worktree/sparse/symlink/submodule/ignored-transition 的独立 fixture 证据。

## 3. Window Coordinator 与恢复

- [x] 在首个 Runtime 获准写入前持久化 baseline 结果；失败时保持 Run 可启动并让 Window 在参与期维持
  `captureStatus=unavailable`；
- [x] 以 Coordinator gate + active-key unique/CAS 合并并发首个 `opening`，并原子实现同 key join 与最后参与者
  `active -> closing` 互斥；参与 Run 只保存 `windowId`；
- [x] 把现有 terminal/quiescent 收口路径接入 participant release；IdleWarm Host 不作为 participant；
- [x] 将全局 gate 改为按 `canonicalExecutionRoot + repository worktree identity` 分片的 coordinator；key 不含
  Camp，因此同一物理 workspace 的跨 Camp 边界互斥，而无关 workspace 可并行；Git 子进程硬 deadline 证明
  success/unavailable 后会释放 gate；
- [x] 取消 ACK 后先等待 Runtime/CLI/Tool quiescence；证明成功复用普通 settlement，期限内无法证明则原子释放
  participant 并把 Window 收敛为 unavailable，避免旧 active Window 永久吸收后续 Run；
- [x] 启动恢复只依据持久状态、OID 和 fence 收口；Core crash、ref 缺失/漂移、身份变化或未知边界均标记
  `unavailable`，不做事后 rescan；
- [x] final publication 的所有失败出口清除 final candidate/manifest root，并先登记 baseline/final expected OID
  后尝试 compare-and-delete；cleanup failure 在 closed Window 上保持可重试，ref 已不存在按幂等成功处理；
- [x] 记录 Core 可证明的其他 Rovai scope 重叠为 `externalWriterObserved`，不保存或投影对方 identity；
- [ ] Camp 删除与 orphan cleanup 使用 best-effort expected-OID ref 清理，不调用 prune，不因用户仓库暂不可达破坏
  Core 领域删除。

## 4. Diff、存储与读取授权

- [x] 对两个已验证 synthetic tree 生成 bounded tree-to-tree diff，禁用 external diff/textconv，并在超限时整窗 unavailable；
- [x] 在 DB transaction 中同时写 Window final 与不可变 `WorkspaceDiffCompleted`，持久化 Managed Blob 后清理 refs，并纳入 GC root；
- [x] 只开放 `campId + windowId` 的读取；历史卡片/View 从 immutable Evidence 查找，拒绝 ref、OID、blob ID 或 Run ID 全局读取；
- [x] v1 read 只通过 Desktop IPC 暴露；Window 内容不进入 Agent built-in、Runtime、Session Bootstrap、
  Dynamic Context 或 Camp public message；
- [x] 用 DB constraint 与 migration fixture 验证 lifecycle `opening | active | closing | closed` 与 captureStatus
  `pending | baseline_ready | complete | no_changes | unavailable` 的合法组合和崩溃恢复；
- [x] 非 Git root 跳过 Window；`no_changes` 与 `unavailable` 不生成完成 Evidence/卡片；
- [ ] 补齐 binary/mode-only/rename summary 与主动 Camp 删除时 ref cleanup 的 fixture。

## 5. Command Diff 与 Canonical Activity

- [x] 将“成功文件操作”和“可展开 Diff”拆成同一 terminal Evidence 的两个独立子投影：ACP terminal
  `edit | write` + 同 ToolCall 唯一标准 location 生成既有 Activity 的 `修改 <basename>`，没有 old/new 时不生成
  `diffProjection`、计数或空 inline diff；
- [x] ACP ToolCall 累计状态保留先前非空 location，并保留首次可信结构化 kind，覆盖 Kimi terminal location、Qoder
  sparse terminal location 以及实测 `read -> terminal edit` 冲突不伪造写操作；
- [x] Kiro 单 entry rooted-relative Diff 仅在同 ToolCall 唯一已准入 location 与去根锚路径完全相等时纠正；不做
  suffix 猜测、不读取文件、不扩展到其他 ACP adapter；
- [x] 为 Codex app-server terminal fileChange、全部十个 ACP v1 adapter 与 Claude 原生 Edit matching
  tool-use/result exact mutation 建立协议语义 allowlist；Claude 其他 Tool 与 Antigravity fail closed；
- [x] 在 Codex/ACP public normalizer 中保留内部候选，并更新 Runtime Activity Registry 与 terminal fixtures；
- [x] 把 terminal diff 写为 append-only Evidence，在既有 Canonical Activity 上确定性归约 typed `diffProjection`；
- [x] 验证 projection lineage、相同结论 replay 与冲突 fail-closed；
- [x] 路径纯词法规范化、root escape/`.git`/size 拒绝不读取工作区；旧 Evidence 不做推测性回填；
- [x] Claude Edit 只暂存字段完整且 `replace_all != true` 的 `file_path/old_string/new_string`；matching 非错误
  `tool_result` 才发布 Evidence，失败/缺失/取消/其他 Tool 不生成 Diff，同文件连续 Edit 不合并；
- [x] Claude Code `2.1.220` 真实 smoke 已验证 native Edit matching terminal Evidence、同 Activity available
  projection、无 `@@` exact fragment 与实际文件更新；
- [ ] 用修复后的真实 App 复测 Kimi Code `0.38.0`、Qoder `1.1.28` 的 path-only `修改 xxx`，以及 Kiro `2.18.1`
  的同 Activity `修改 xxx` + inline Diff；再对其余支持 Runtime 逐个执行 terminal file-diff smoke 并冻结 wire artifact。

## 6. Presentation handoff 与验收

- [x] 按 Rovai 现有视觉系统确认 HTML 设计稿、文件行、`Files Changed` 卡片与只读 View；
- [x] presentation 复用既有 Activity identity；多个 change 只是同级 rows，不建立第二套 phase/outcome；
- [x] `exact_mutation` 文件行只展开 `−/+` 片段，不生成 `@@` 或旧/新文件行号；
- [x] Window presentation 只读 immutable Evidence，不归因；`no_changes/unavailable` 不生成卡片；
- [x] 执行台不增加 Workspace observation，现有 Camp rail、placement 与 Tool list 宽度保持不变；
- [ ] 完成 Linux/macOS/Windows Git fixture：SHA-1 与支持时的 SHA-256、linked worktree、sparse checkout、symlink、
  executable、ignored transition、nested repo、submodule、ref tamper、并发 join/close、crash/restart 与严格超限；
- [x] 通过 `cargo test --workspace`：Rust lib 349 项、CLI 25 项、Core bin 169 项（另有 4 项手动 Runtime
  smoke ignored）；
- [x] 通过 TypeScript typecheck、完整 Renderer 534 项、`pnpm test`、Desktop production build、文档测试与
  diff-aware 文档门禁；
- [x] 在 HTML 评审稿完成 Porcelain Day / Steel Night、底部/右侧执行台、文件行展开、无可靠终态隐藏与
  `View` 入口的浏览器视觉检查；
- [ ] 完成真实 App 双主题、键盘/焦点与实际 Runtime file-diff acceptance，并把证据写回本计划。

## 7. ACP Client FS/Terminal 权限收敛

- [x] 删除 `authorized_file_writes`、`authorize_file_write()`、one-time matching error，以及 Runtime Delivery
  中把 Approval scope 映射成单次文件 token 的桥；
- [x] `fs/read_text_file` / `fs/write_text_file` 不再调用 `scoped_path()` 或读取 Workspace access；绝对路径按
  Runtime 请求执行，相对路径仅以 execution root 为解析基准；
- [x] 保留 path/content 参数、Host/Run/epoch/Session/Prompt、cancel/detach 与 JSON-RPC correlation 校验；
- [x] 十种 ACP Adapter 的全自动/绕过模式直接选择 native allow 作协议兼容，不创建 Approval/Action；交互模式
  保留现有 exact native option 流程，且两种结果都不参与 Client FS 鉴权；
- [x] 新增唯一 ACP Client FS 回归 owner：修复前在首次写入处以
  `read-only AgentRun cannot write files` 失败；修复后在 `read_only` metadata 下成功写 execution root 外绝对路径、
  连续覆盖同一路径并读回第二次内容；
- [x] 更新真实 ACP smoke 的目的与决策文案，不再声称存在 one-time file write authorization；
- [x] 建立 [Runtime Launch and Verification v28](../../contracts/runtime-launch-and-verification-v28.md)、
  [V1.29-D10](decisions.md#v1-29-d10)、当前 Architecture、术语和跨版本路由；无 schema 或 Migration 变化。
- [x] `pnpm test:rust:staged` 通过 workspace all-target check 与 Core bin 169/169（另 4 项 manual smoke ignored）；
  `cargo clippy -p rovai-core --bin rovai-core -- -D warnings`、`cargo fmt --all -- --check`、ACP smoke 脚本语法、
  `pnpm docs:test`、`pnpm docs:check` 与精确 merge-base 的 `docs:check:ci` 均通过。
- [x] `terminal_working_directory()` 不再调用 `scoped_path()`；显式 cwd 只保留 absolute + existing directory
  校验，execution root 外目录和 symlink 目录不再由 Core 拒绝，省略 cwd 仍使用 execution root；
- [x] Terminal 的 command/env、Run/epoch/Session/Prompt、process tree、output bound、kill/release、cancel/detach 与
  cleanup 路径未改变；
- [x] 扩展既有 Terminal lifecycle 与 cwd validation owner，覆盖 root 外绝对 cwd、相对 cwd、省略 cwd 和不存在的
  绝对 cwd；旧 workspace/symlink escape rejection 随旧合同退出；
- [x] [ACP Client Terminal v2](../../contracts/acp-client-terminal-v2.md)替代 v1，并同步 Architecture、当前决定与
  文档路由；无 schema、Migration、Renderer 或 Runtime Activity 变化；
- [x] `cargo fmt --all -- --check`、Terminal 定向 5 项、Core bin 169/169（另 4 项 manual smoke ignored）、
  `cargo clippy -p rovai-core --bin rovai-core -- -D warnings`、`pnpm test:rust:staged`、`pnpm docs:test`、
  `pnpm docs:check` 与精确 merge-base 的 `docs:check:ci` 均通过。

## 交付阻断条件

- 任一路径允许绕过 `campId + windowId` 读取 Window 或 Managed Blob；
- baseline 尚未落成明确结果就允许首个 Runtime 写入；
- checkpoint 触发 filter、修改用户 index/staged/普通 refs，或把 ref 当长期权威；
- closing 可无限阻塞普通 Run，或失败后通过重新扫描伪造旧边界；
- 任一 presentation 把 Window Diff 归因给单个 Agent/Run，或把 `externalWriterObserved` 解释成完整外部进程探测；
- Runtime 字段在没有 Adapter/version 语义证明时进入完整 Diff View。
