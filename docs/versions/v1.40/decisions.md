---
document_type: version-decisions
version: v1.40
lifecycle: current
last_updated: 2026-09-04
---

# v1.40 决定

<a id="v1-40-d01"></a>
## V1.40-D01：新用户附件是弱持久 source path ref，不是 Rovai 文件资产

### 背景

旧 Desktop 用户路径先复制为 Prepared snapshot，发布又物化为 Managed v2；私有 Pending Queue 因没有附件字段而
拒绝所有带附件输入。产品目标不是保留发布后冻结和永久恢复，而是删除用户附件资产管理，并让运行中的下一条消息
可以正常携带附件。

Runtime 又只获得 executionRoot、Camp attachment root 和 `ROVAI_RUN_TMP`，不能假定任意宿主 source path 对每个
Adapter 都可读。该授权边界需要一次执行期适配，但不能成为重新建立长期附件系统的理由。

### 决定

从本版本开始，Desktop 新用户附件只保存 Core-private `LocalAttachmentSourceRef`。Native File 保留原 path；没有 path
的 bytes/Blob 由 Main 写一次 OS Temp。Composer、Pending、Pending Edit 与 CampMessage 各自在 owner JSON 中保存同一
closed shape；Renderer 和历史只得到无路径、无 storage discriminator 的统一 View。

Composer source refs 可以直接发布或连同完整发送意图原子入队。Pending Edit 在独立 working JSON 上添加、删除、排序；
Save 整体覆盖 canonical refs，Cancel 放弃 working refs，Delete 取消整条 Pending。发布前只检查 exists/readable/kind，
不检查内容变化。历史 availability 默认 unknown，只在 preview/open/reveal 当次检查且不写回。

Run 前由统一 Core resolver 比较 canonical source 与 canonical executionRoot：contained 则返回原 path，否则普通复制到
本次 `ROVAI_RUN_TMP/source-attachments`。Adapters 仍只接收 `CURRENT_INPUT.attachments: string[]`。复制失败使已发布
Message 对应的 AgentRun 失败，不回滚消息、不升级为 Managed。

Migration 只加四个 owner JSON 字段。已有 Prepared Draft 不转换、不移动，保持互斥 legacy Draft，直到直接发送、删除
附件或丢弃；Agent 产物与历史 Managed/legacy 模型不变。

### 后果与被拒绝方案

来源修改会影响后续读取，来源移动/删除/失权和 OS Temp 清理会让引用失效，不同 Run 可能看到不同内容。这些是明确
接受的弱持久语义。Rovai 不自动恢复、寻找同名文件或发布时冻结。

拒绝“发布时再 Managed 一次”：它仍保留附件实体、ref 表、长期目录、digest、intent、staging/promote、reconciler 与
清理职责，没有完成删除用户附件资产管理的目标。拒绝迁移旧 Prepared path：它会把 Rovai 私有旧文件伪装成普通外部
source，并制造新的 GC 特例。

拒绝 Runtime-specific policy、capability matrix、copy strategy enum、hard limit/budget/quota、预扫描/reservation、
availability watcher/catalog 和新的横向路径脱敏框架。现有 `source path + owner JSON + Pending Queue + ROVAI_RUN_TMP`
已经完成本次需求；如未来确有独立产品需求，必须另行证明和设计。
