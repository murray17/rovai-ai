---
document_type: architecture
authority: camp-published-attachment-view-composition
last_updated: 2026-08-20
---

# Camp Published Attachment View

本架构拥有 Camp 已发布附件从私有 Authority 到 Runtime 可读共享视图的组件边界、数据流、并发门和恢复关系。
字段、状态、路径、限额与错误由 [Camp Published Attachment View v2](../contracts/camp-published-attachment-view-v2.md)
和 [Camp Attachment v2](../contracts/camp-attachment-v2.md)拥有。

## Authority 与授权域

`<data_dir>/camp-attachments/` 仍是唯一 Authority Attachment 根。`prepared_attachment` 是 Composer Draft
的 Core-private 引用；只有 Camp Message 发送事务成功消费它并写入 `message_attachment` 后，附件才成为
Published Attachment。发布者、消息寻址、当前 Prompt、AgentRun、Conversation 或 Native Session 都不缩小
它的授权域：Published Attachment 对当前 Camp 全体合格成员可枚举、可读，Draft 永远不进入共享视图。

Runtime View 位于实例隔离的派生根，不是第二套业务权威：

```text
Authority Attachment ──copy + digest/identity verification──> Camp Published Attachment View
       ▲                                                    │
       └──────────── message_attachment / contentDigest ────┘
```

View 不反向修复 Authority，不保存 `.rovai-attachment.json`、display metadata 或数据库 receipt。删除或重建
View 不改变消息、历史 ContextManifest、Managed Blob、摘要或 Authority `storage_path`。

## 组件职责

- Desktop 从 canonical `userData` 派生 macOS instance key，或在 Windows 选择 `<data_dir>\runtime-files`，并把
  完整绝对 `--runtime-camp-files-root` 显式传给 Core；Core 不从 Home 猜共享默认值。
- `CampAttachmentStore` 只负责 Authority ingress、不可变快照和 no-follow 打开/复制源校验。
- `CampAttachmentViewStore` 负责 root admission/lock、staging、journal、Camp catalog、generation、完整性、
  rebuild 与受管清理。
- `PublishedAttachmentPathResolver` 只从 ready View Entry receipt 解析稳定 Runtime path；它不做字符串前缀替换，
  不从模型、Manifest 或目录扫描接受任意路径。
- Context materializer 在同一 Camp read admission 内选择消息、解析所有显式 attachment occurrence、加入
  `RUN_FACTS.campResources` 并冻结 Formatter 21 / Manifest 21；模型 bytes 不因 Manifest 版本推进而改变。
- Runtime launch 再验证同一 View receipt，记录 Runtime Attachment Auth Receipt，并且只把当前 Camp 精确
  `attachments` 根交给 Adapter。

## 发布与并发

带附件的 Camp Message 先用短数据库锁冻结 CopyPlan、journal 和 quota reservation，释放全局 Database mutex 后在
Runtime 不可达的 `.staging/<operation-id>` 完成全组复制、摘要/identity 复核与 fsync，再以短数据库 CAS 复核
Draft/CopyPlan 并进入 staged。同一 Camp 在任意时刻最多存在一个非终态 publish operation；短规划事务与数据库
insert guard 共同串行化不同 command ID，幂等重试继续复用同一 operation。之后才取得 per-Camp mutation gate，
并在 promote 前再次复核精确 Draft revision 与有序 Prepared Attachment 集合；已过期 staging 按自身 journal
回滚，不得删除另一个已提交 operation 拥有的 final Entry。该 gate 与 Context freeze、Host acquire、resume、
prompt dispatch 的 Camp read admission 互斥。Core 在 gate 内停止或 fence 不兼容 Host、原子 promote 完整 Entry subtree，最后在一个短
SQLite transaction 中提交消息、`message_attachment`、View Entry、generation 和既有 Turn/Run 业务事实。
SQLite commit 是 Draft→Published 与 Camp 共享授权的线性化点。

调度器必须在把 AgentRun 从 queued Claim 为 running 前先取得 Camp View read admission，并把 owned guard 移入
AgentRun task，使其覆盖 Skill/MCP 准备、launch 和整次 Run。这样 write gate 已进入时新 Run 保持 queued，Run
已获 read admission 时 publication 等待，不会形成“running Run 等待 publication write guard”的锁序环。
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

Core 在开放任何 Runtime admission 前取得 data-dir/root locks，收敛 publication/cleanup journal，并逐 Camp 比较：

```text
Desired = 全部 message_attachment
Actual  = View Entry receipts + filesystem entries
```

未提交 operation 按数据库事实 adopt 或 rollback；已提交 Entry 缺失、被替换或摘要漂移先进入
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

## 安全声明

Unix final directory/file 使用 `0500/0400`，staging 使用 `0700/0600`；Windows root 使用现有 local NTFS、
no-reparse 和 protected DACL admission。副本是新文件/目录，不使用 symlink 或 hardlink。权限位和 DACL 是防误写、
完整性与最小暴露加固，不是对同 UID/SID 恶意进程的强隔离；跨 Camp 保证仍取决于 Adapter 的真实 sandbox/native
directory allowlist evidence。存在不受控 ambient filesystem access 时，附件 Runtime 能力必须 fail closed。

## References

- [Camp Published Attachment View v2](../contracts/camp-published-attachment-view-v2.md)
- [Camp Attachment v2](../contracts/camp-attachment-v2.md)
- [ContextManifest Evidence v21](../contracts/context-manifest-evidence-v21.md)
- [Runtime Launch and Verification v11](../contracts/runtime-launch-and-verification-v11.md)
- [V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)
- [V1.15-D05](../versions/v1.15/decisions.md#v1-15-d05)
