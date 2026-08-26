---
document_type: implementation-plan
version: v1.29
authority: implementation-and-acceptance-status
status: not_started
last_updated: 2026-08-26
---

# v1.29 Command Diff 与 Workspace Change Window 实施计划

本计划记录实现与验收事实。当前只有设计、合同和文档路由完成；未勾选项不得从 accepted Contract 推导为代码已交付。

## 1. 设计与数据模型

- [x] 冻结两层产品定义、Camp/exact execution root scope、非归因语义、DB/ref 权威与 fail-open 原则；
- [x] 建立当前 Architecture、Contract、版本决定与跨版本路由；UI 方案明确留待后续独立确认；
- [ ] 设计并迁移 `WorkspaceChangeWindow`、active-key 唯一约束、参与关系、捕获时间、candidate/ready OID、
  capture manifest、状态、Managed Blob root 和清理 ledger；
- [ ] 为 `windowId` 建立至少 128-bit 随机生成、固定长度 ref token 与碰撞/CAS 测试；
- [ ] 冻结 v1 的时间、文件数、总字节、patch 大小、rename detection 和 closing bind deadline 常量及诊断 code。

## 2. Git checkpoint 与 synthetic tree

- [ ] 实现 repository/worktree identity 观测与 canonical execution root 计算；开始和结束时复核
  `repositoryRoot + worktreeGitDir + gitCommonDir + objectFormat + object database layout`，允许 HEAD/branch 变化
  但拒绝身份替换；清除 Git env/config 注入并禁用 hooks；
- [ ] 使用 gix 或受控 Git plumbing 写 raw blob/tree；证明不经过 index、clean/LFS filter、textconv 或 external diff，
  且不修改 staged 状态和普通 refs；
- [ ] 实现 candidate DB write -> ref create/verify -> DB ready promotion 的 recoverable saga，以及
  `refs/rovai/w/<token>/b|f` 的 create-if-absent CAS、diff 前 expected-OID 验证和 compare-and-delete；
- [ ] 实现 exact-root 路径集合：tracked、捕获时 non-ignored untracked、baseline sticky ignored path；永久排除 `.git`；
- [ ] 持久化 baseline/final capture manifest，并对 materialized/sparse-omitted 来源切换做等价证明或 fail unavailable；
- [ ] 正确处理 symlink target、executable bit、sparse-checkout 未物化路径、nested repository/submodule opaque boundary、
  delete 与 bounded rename detection；
- [ ] 实现连续两次 OID 相同的稳定捕获、严格 deadline/count/bytes 限制与 `captureStartedAt` / `capturedAt`。

## 3. Window Coordinator 与恢复

- [ ] 在首个 Runtime 获准写入前持久化 baseline 结果；失败时保持 Run 可启动并让 Window 在参与期维持
  `captureStatus=unavailable`；
- [ ] 以 active-key unique/CAS 合并并发首个 `opening`，并原子实现同 key join 与最后参与者
  `active -> closing` 互斥；参与 Run 只保存 `windowId`；
- [ ] 把 Run lease fence/unbind 与 Runtime/CLI/Tool descendant quiescence 接入 final 边界；证明 IdleWarm Host 不阻塞；
- [ ] 对同一 physical execution root 的 closing bind 使用严格 deadline，成功或不可用后立即开放下一 Window；
- [ ] 启动恢复只依据持久状态、OID 和 fence 收口；Core crash、ref 缺失/漂移、身份变化或未知边界均标记
  `unavailable`，不做事后 rescan；
- [ ] 记录 Core 可证明的其他 Rovai scope 重叠为 `externalWriterObserved`，不保存或投影对方 identity；
- [ ] Camp 删除与 orphan cleanup 使用 best-effort expected-OID ref 清理，不调用 prune，不因用户仓库暂不可达破坏
  Core 领域删除。

## 4. Diff、存储与读取授权

- [ ] 对两个已验证 synthetic tree 生成 bounded tree-to-tree diff；禁用 external diff/textconv，二进制与截断状态明确；
- [ ] 在 DB 事务中持久化摘要、Managed Blob reference 与最终状态后清理 refs；把 Window blob 纳入现有 GC root；
- [ ] 只开放 `campId + windowId` 的授权读取；拒绝 ref、OID、blob ID 或 Run ID 的全局读取与存在性泄露；
- [ ] v1 read 只允许 User/Desktop principal；证明 Window 内容不进入 Agent built-in、Runtime、Session Bootstrap、
  Dynamic Context 或 Camp public message；
- [ ] 验证 lifecycle `opening | active | closing | closed` 与 captureStatus
  `pending | baseline_ready | complete | no_changes | unavailable` 的合法组合和崩溃恢复；
- [ ] 非 Git root 不创建 Window；`no_changes` 与 `unavailable` 在授权 read projection 中保持可区分。

## 5. Command Diff 与 Canonical Activity

- [ ] 为首批明确支持的 Adapter/version 建立语义 allowlist；逐一确认 complete snapshot / exact mutation 边界；
- [ ] 在对应 public normalizer 中保留所需结构化字段，并更新 Runtime Activity Registry 与 replay fixtures；
- [ ] 把 diff 更新写为 append-only Evidence，在既有 Canonical Activity 上确定性归约 typed `diffProjection`；
- [ ] 验证 projection 的 `revision`、`sourceEvidenceIds`、available/unavailable/conflict、迟到/重复/乱序 replay；
- [ ] 路径规范化和越界拒绝不得触发额外文件读取；旧 Evidence 不做推测性回填。

## 6. Presentation handoff 与验收

- [ ] 在独立 UI 讨论中确认布局、组件、入口、文案和交互，再按 UI 治理更新对应 current authority；
- [ ] 任一 presentation 复用既有 Activity identity，不建立第二套 phase/outcome 或可独立写入的 diff Activity；
- [ ] 任一 Window presentation 保留单一对象、非归因、外部修改可能性和 `no_changes/unavailable` 区分；
- [ ] `externalWriterObserved` 只表达 Core 观察到的其他 Rovai scope 重叠，不声称完整探测外部进程；
- [ ] 完成 Linux/macOS/Windows Git fixture：SHA-1 与支持时的 SHA-256、linked worktree、sparse checkout、symlink、
  executable、ignored transition、nested repo、submodule、ref tamper、并发 join/close、crash/restart 与严格超限；
- [ ] 运行 Rust/TypeScript、后续 Renderer 定向测试、完整文档门禁和安全扫描，并把真实验收结果写回本计划。

## 交付阻断条件

- 任一路径允许绕过 `campId + windowId` 读取 Window 或 Managed Blob；
- baseline 尚未落成明确结果就允许首个 Runtime 写入；
- checkpoint 触发 filter、修改用户 index/staged/普通 refs，或把 ref 当长期权威；
- closing 可无限阻塞普通 Run，或失败后通过重新扫描伪造旧边界；
- 任一 presentation 把 Window Diff 归因给单个 Agent/Run，或把 `externalWriterObserved` 解释成完整外部进程探测；
- Runtime 字段在没有 Adapter/version 语义证明时进入完整 Diff View。
