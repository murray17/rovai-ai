---
document_type: implementation-plan
version: v1.29
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-27
---

# v1.29 Command Diff 与 Workspace Change Window 实施计划

本计划记录实现与验收事实。Core/Renderer 主路径已经实现；未勾选项仍不得从 accepted Contract 或局部测试推导为交付。

## 1. 设计与数据模型

- [x] 冻结两层产品定义、Camp/exact execution root scope、非归因语义、DB/ref 与历史 Evidence 权威、fail-open 原则；
- [x] 建立当前 Architecture、Contract、版本决定、Runtime audit、UI 方案与跨版本路由；
- [x] 设计并迁移 `WorkspaceChangeWindow`、active-key 唯一约束、参与关系、捕获时间、candidate/ready OID、
  capture manifest、状态、Managed Blob root 和清理 ledger；
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
- [ ] 为每个 Git 子进程补齐硬 timeout/kill，使卡住的 Git 调用也不能越过 capture deadline；
- [ ] 补齐 Linux/Windows/SHA-256/linked-worktree/sparse/symlink/submodule/ignored-transition 的独立 fixture 证据。

## 3. Window Coordinator 与恢复

- [x] 在首个 Runtime 获准写入前持久化 baseline 结果；失败时保持 Run 可启动并让 Window 在参与期维持
  `captureStatus=unavailable`；
- [x] 以 Coordinator gate + active-key unique/CAS 合并并发首个 `opening`，并原子实现同 key join 与最后参与者
  `active -> closing` 互斥；参与 Run 只保存 `windowId`；
- [x] 把现有 terminal/quiescent 收口路径接入 participant release；IdleWarm Host 不作为 participant；
- [ ] Coordinator gate 在普通捕获成功/不可用后开放下一 Window；仍需以 Git 子进程硬 timeout 证明 closing 不会被
  卡住的 Git 调用无限占用；
- [x] 启动恢复只依据持久状态、OID 和 fence 收口；Core crash、ref 缺失/漂移、身份变化或未知边界均标记
  `unavailable`，不做事后 rescan；
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
- [ ] 对支持 Runtime 逐个执行真实 terminal file-diff smoke，冻结实测版本与 wire artifact。

## 6. Presentation handoff 与验收

- [x] 按 Rovai 现有视觉系统确认 HTML 设计稿、文件行、`Files Changed` 卡片与只读 View；
- [x] presentation 复用既有 Activity identity；多个 change 只是同级 rows，不建立第二套 phase/outcome；
- [x] `exact_mutation` 文件行只展开 `−/+` 片段，不生成 `@@` 或旧/新文件行号；
- [x] Window presentation 只读 immutable Evidence，不归因；`no_changes/unavailable` 不生成卡片；
- [x] 执行台不增加 Workspace observation，现有 Camp rail、placement 与 Tool list 宽度保持不变；
- [ ] 完成 Linux/macOS/Windows Git fixture：SHA-1 与支持时的 SHA-256、linked worktree、sparse checkout、symlink、
  executable、ignored transition、nested repo、submodule、ref tamper、并发 join/close、crash/restart 与严格超限；
- [x] 通过 `cargo test --workspace`：Rust lib 332 项、CLI 25 项、Core bin 165 项（另有 4 项手动 Runtime
  smoke ignored）；
- [x] 通过 TypeScript typecheck、完整 Renderer 534 项、`pnpm test`、Desktop production build、文档测试与
  diff-aware 文档门禁；
- [x] 在 HTML 评审稿完成 Porcelain Day / Steel Night、底部/右侧执行台、文件行展开、无可靠终态隐藏与
  `View` 入口的浏览器视觉检查；
- [ ] 完成真实 App 双主题、键盘/焦点与实际 Runtime file-diff acceptance，并把证据写回本计划。

## 交付阻断条件

- 任一路径允许绕过 `campId + windowId` 读取 Window 或 Managed Blob；
- baseline 尚未落成明确结果就允许首个 Runtime 写入；
- checkpoint 触发 filter、修改用户 index/staged/普通 refs，或把 ref 当长期权威；
- closing 可无限阻塞普通 Run，或失败后通过重新扫描伪造旧边界；
- 任一 presentation 把 Window Diff 归因给单个 Agent/Run，或把 `externalWriterObserved` 解释成完整外部进程探测；
- Runtime 字段在没有 Adapter/version 语义证明时进入完整 Diff View。
