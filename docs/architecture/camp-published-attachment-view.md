---
document_type: architecture
authority: camp-published-attachment-view-composition
last_updated: 2026-08-21
---

# Camp Published Attachment View

本架构拥有 Camp 已发布附件从私有 Authority 到 Runtime 可读共享视图的组件边界、数据流、并发门和恢复关系。
字段、状态、路径、限额与错误由 [Camp Published Attachment View v3](../contracts/camp-published-attachment-view-v3.md)
和 [Camp Attachment v5](../contracts/camp-attachment-v5.md)拥有。

## Authority 与授权域

`<data_dir>/camp-attachments/` 仍是唯一 Authority Attachment 根。Composer `prepared_attachment` 与 Agent
Run-local ingress 都先冻结为 Core-private Authority descriptor；Camp Message 事务写入 `message_attachment`
后，附件成为 Camp-wide 公共事实。公共可见不等于 Runtime 可读：只有 `available` 项进入 Runtime Desired
Catalog；`pending | recovery_required` 阻断新 Runtime admission，`failed` 只保留公共/UI 事实和 tombstone。

Runtime View 位于实例隔离的派生根，不是第二套业务权威：

```text
Authority Attachment ──copy + digest/identity verification──> Camp Published Attachment View
       ▲                                                    │
       └──────────── message_attachment / contentDigest ────┘
```

View 不反向修复 Authority，不保存 `.rovai-attachment.json`、display metadata 或数据库 receipt。删除或重建
View 不改变消息、历史 ContextManifest、Managed Blob、摘要或 Authority `storage_path`。

用户在 Desktop 打开已发布附件使用 Authority，而不是 Runtime View。Renderer 只提交 canonical Camp ID 与
Attachment ID；Core 只从同 Camp 的 `message_attachment` 解析精确 Authority payload，重验路径、节点、receipt
和完整树 identity 后，把一次性的 path 与风险结论只交给 Desktop Main。Main 独占原生确认与系统 Shell；
Renderer 不接收 path 或原始系统错误。`pending | recovery_required | failed` 只表达 Runtime/队员可读性，不阻止
仍然完整的 Authority 图片预览、系统打开或显示所在位置。

Unix Authority Camp root 保持 `0100`，只允许 Core 通过已知不透明 identity 穿越；精确 Attachment container
使用不可写的 `0500`，payload 文件/目录继续使用 `0400/0500`。因此 Finder 可以枚举已授权的单个 container，
但不能删除、改名或创建内容，也不能枚举同 Camp 的兄弟 Attachment ID。Desktop open-target 校验在同一
per-Camp ingress admission 内把历史 `0100` container 按需收敛为 `0500`。Main 在调用 best-effort native
reveal 前必须先确认 parent 可枚举且 target 仍存在；预检失败不得把 `void` Shell 调用伪装成成功。

## 组件职责

- Desktop 从 canonical `userData` 派生 macOS instance key，或在 Windows 选择 `<data_dir>\runtime-files`，并把
  完整绝对 `--runtime-camp-files-root` 显式传给 Core；Core 不从 Home 猜共享默认值。macOS Desktop 与子 Core
  必须使用同一 Home：进程环境提供非空 `HOME` 时 Main 以该值派生 root，否则使用 Electron Home；Windows
  root 不依赖 Home。这样显式隔离 Home 不会与 Core 的 root admission 产生分歧。
- `CampAttachmentStore` 只负责 Composer/Agent Authority ingress、不可变快照和 no-follow 源校验。所有实例按
  exact Authority root + Camp ID 共享 per-Camp ingress admission；Camp root 权限切换、child create/remove、
  failure cleanup 与 Camp Authority removal 必须持有一次 admission，已持有者使用私有 root helper，不可重入。
- `CampAttachmentPublicationCoordinator` 以一个小 interface 统一语义 commit、revision、reservation、writer
  intent、operation 与 Delivery gate；两条 ingress adapter 不复制 publication 规则。
- `CampAttachmentProjectionWorker` 按 Camp semantic revision FIFO 驱动 View copy/promote/recovery；
  `CampAttachmentViewStore` 继续拥有 root、staging、journal、catalog、generation、完整性、rebuild 与清理。
- `PublishedAttachmentPathResolver` 只从 `available` View Entry receipt 解析稳定 Runtime path；它不做字符串前缀替换，
  不从模型、Manifest 或目录扫描接受任意路径。
- Scheduler 为每个 AgentRun 只取得一次带 Camp identity 的 read admission；Context materializer、Runtime
  authorization、Host acquire、resume 与模型输入投递都复用这份 admission，不在内部嵌套申请 read gate。
- Core 在该 admission 内为一次 dispatch 生成一份 verified Runtime authorization；Context materializer 复用其
  结果冻结 Formatter 21 / Manifest 21 与 `RUN_FACTS.campResources`，Runtime launch 用同一结果记录 Runtime
  Attachment Auth Receipt，并且只把当前 Camp 精确 `attachments` 根交给 Adapter。Adapter 另把当前 lease
  已重置的 exact `ROVAI_RUN_TMP` 作为 writable root 交给 Runtime，但不暴露其父目录；模型 bytes 不因
  Manifest 版本推进而改变。

## 发布与并发

Composer/Agent 先在一个短 SQLite transaction 中提交 CampMessage、ordered `message_attachment`、semantic
revision、quota reservation、publication operation、writer intent、Turn/Run 与必要 Delivery gate。该 commit
是公共语义和真实 accepted IDs 的线性化点，不在其中复制或哈希文件。同一 Camp 可以积累多个 operation，
Worker 只按 semantic revision FIFO 处理 contiguous head，followers 不得越过 recovery-required 项。

Worker 取得 per-Camp write admission 后 fence 不兼容 Host，在无全局 Database mutex 的 blocking phase 中向
`.staging/<operation-id>` 复制、摘要/identity 复核和 fsync，再以短事务 CAS promote。成功标记 `available`、
推进 catalog/resolved revision、消费 reservation 并释放 Delivery/Scheduler gate；可恢复失败保留 intent 与
reservation；terminal failure 写 `failed` tombstone、推进 resolution digest、释放 reservation 并终态结算
Delivery。常规 completion 只校验本 operation 新 Entry 与既有 catalog/resolution receipt，不重哈希历史 View。

Authority ingress admission 与 Published View write admission 是两把不同的 per-Camp 锁。前者只保护私有
Authority 根的权限 mode 和 child mutation，可在同 Camp copy/hash 期间保持；后者只保护派生 Runtime View 与
Host generation。Authority ingress 不持有 Database mutex 或 built-in invocation guard，不同 Camp 可并行。

调度器必须在把 AgentRun 从 queued Claim 为 running 前先取得 Camp View read admission，并把 owned guard 移入
AgentRun task，使其覆盖 Skill/MCP 准备、launch 和整次 Run。这样 write gate 已进入时新 Run 保持 queued，Run
已获 read admission 时 publication 等待，不会形成“running Run 等待 publication write guard”的锁序环。
Context freeze 或 Runtime launch 不得再次申请同一 Camp read gate；否则等待中的公平 write gate 会与 Run 已持有
的 read admission 形成锁等待环。
发布、Draft discard、Camp 删除和完整性重建取得
有界 write gate；force Camp delete 先停止/fence 相关 Runtime，再等待 write gate，避免 read guard 与 stop
互相等待。gate 超时不会消费 Draft或产生公共消息。

## Generation 与 Host

同一 Camp/attachment ID 的 View path 在 Camp 生命周期内稳定。每次成功追加或整 Camp rebuild 推进 generation。
所有 Adapter 在没有真实正向 Probe 时使用 `generation_fenced_v1`：generation 进入 Host compatibility，发布前
停止旧 Host，下一次 dispatch 使用相同 Camp root 的新 generation。只有 Adapter×platform×binary 的真实 Probe
证明同一 IdleWarm Host 能观察原子追加且满足 quiescence/liveness，才可使用 `live_append_v1`；当前没有这样的
TRAE 正向证据。

Host compatibility 同时绑定 Camp identity、Agent identity、精确 root、View contract、visibility mode 和必要
generation。Camp A 与 Camp B 不共享 Host/Session/Binding。Runtime 从不收到 instance root、`camps` parent、
其他 Camp root 或 Authority Camp root。

## 启动恢复与生命周期

每次新 dispatch 或明确可重试 dispatch 仍对当前 Camp 做一次完整物理校验，但完整文件读取不占用全局
Database mutex：Core 在短数据库锁内冻结 generation、catalog receipt 与 Entry 预期值，在 `spawn_blocking`
中无数据库锁地枚举和哈希整个 View，再以短数据库锁确认 generation/catalog 未变化并提交 verified
authorization。Context 构造和 Runtime launch 共享该结果，不重复扫描。

Core 在开放任何 Runtime admission 前取得 data-dir/root locks，收敛 publication/cleanup journal，并逐 Camp 比较：

```text
Desired = runtime_projection_state = available 的 message_attachment
Actual  = View Entry receipts + filesystem entries
```

同时验证 semantic/resolved revision 和包含 failed tombstone 的 resolution digest；failed row 不可作为 missing
Entry 重建。未提交 operation 按数据库事实 adopt 或 rollback；available Entry 缺失、被替换或摘要漂移先进入
`integrity_failed` 并 fence Camp Host，再用 journaled whole-Camp rebuild 从 Authority 重建。受控重建只更新
root/Entry identity、operation 和 physical generation；稳定 catalog revision、Entry semantic identity 与 digest
必须保持不变，使历史 Manifest 21 在模型可见语义未变时仍可恢复。Authority 不一致时
保持 fail closed。Camp 存在期间 View Entry 不因 Run、Session、Context 或预算结束而删除；Camp 永久删除捕获
typed cleanup identity，业务事务提交后清理派生 View。未知名称、symlink/reparse 或 containment 异常保留并阻断，
删除不会跟随链接或越出已准入实例根。

Migration 99 对 schema 53 做本机 clean break：旧非终态 Formatter 20 输入按 accepted/delivery/action evidence
诚实终结，旧 Manifest/Blob/ACK/执行证据逐字节保留且不可再 dispatch；随后只从 `message_attachment` 回填 View。
`prepared_attachment` 和历史 Authority 路径从不迁移到 View。

Migration 100 对 schema 54 做第二次本机 clean break：旧非终态 Manifest 20/Receipt v1 继续按同一 evidence
分类诚实终结，历史物理 receipt 与执行证据不改写；现有 View 回填稳定 semantic catalog 后，新写入只接受
Manifest 21/Receipt v2。物理 identity 继续用于当前本机完整性与 Runtime authorization，不再决定历史 Context
是否有效。

Migration 101 从完整 schema 55 安装同一 Camp 单一非终态 publish 的数据库 insert guard，并推进到 schema 56；
它不改写 Context、Authority、View Entry 或遗留 operation。已有重复 operation 由 startup recovery 按已提交
消息/Entry ownership 收敛，不能把合法 final View 标成由待回滚 operation 所有。

Migration 102 从完整 schema 56 升到 schema 57/Data Contract v1.17，回填既有附件为 `available`，安装统一
publication/revision/reservation/tombstone/Delivery gate 状态，并把遗留 operation 纳入 FIFO startup recovery。
新 schema 不再保留“同 Camp 只允许一个语义提交”的限制；串行性由持久 revision head 保证。

## 安全声明

Unix final directory/file 使用 `0500/0400`，staging 使用 `0700/0600`；Windows root 使用现有 local NTFS、
no-reparse 和 protected DACL admission。副本是新文件/目录，不使用 symlink 或 hardlink。权限位和 DACL 是防误写、
完整性与最小暴露加固，不是对同 UID/SID 恶意进程的强隔离；跨 Camp 保证仍取决于 Adapter 的真实 sandbox/native
directory allowlist evidence。存在不受控 ambient filesystem access 时，附件 Runtime 能力必须 fail closed。

## References

- [Camp Published Attachment View v3](../contracts/camp-published-attachment-view-v3.md)
- [Camp Attachment v5](../contracts/camp-attachment-v5.md)
- [ContextManifest Evidence v21](../contracts/context-manifest-evidence-v21.md)
- [Runtime Launch and Verification v20](../contracts/runtime-launch-and-verification-v20.md)
- [V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)
- [V1.20-D01](../versions/v1.20/decisions.md#v1-20-d01)
- [V1.17-D01](../versions/v1.17/decisions.md#v1-17-d01)
- [V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)
- [V1.15-D05](../versions/v1.15/decisions.md#v1-15-d05)
