---
document_type: model-context-change
version: v1.58
change_id: source-attachment-live-reference
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray.xue
confirmed_at: 2026-09-11T23:10:11+08:00
authority: confirmed-model-input-change-statement
implementation_baseline: aa8a56c27c71e2f077c97714071fa6420dff05e6
implementation_status: complete
last_updated: 2026-09-12
---

# v1.58 核心模型上下文变更：Source Attachment 原路径投影

本文只冻结 Source Attachment 在 `CURRENT_INPUT.attachments` 中的字符串语义替换。开发者先审阅了完整的
实现边界、隐私变化、失败时机、删除范围、兼容关系与验收建议，随后在 Camp 消息
`19a0b74b-bf98-4a44-84de-1ca48eee464a` 中明确接受修正并要求按该范围实现 revision 1。本文逐项记录该已确认
内容，不增加新的交付模式、授权体系或兼容分支。

## 二次确认

开发者在阅读 Camp 消息 `337cc0ca-9c87-4d07-9d1b-f4ea6612c2cf` 所列完整前后语义、隐私边界、失败时机、
删除点、兼容关系与验收范围后，于 2026-09-11 通过消息 `19a0b74b-bf98-4a44-84de-1ca48eee464a` 明确表示
“接受这份批复的边界修正”并要求实施。确认 revision 与本文 revision 均为 1；任何语义扩展都使该确认失效。

## Revision 变更记录

| Revision | 状态 | 结论 |
| --- | --- | --- |
| 1 | confirmed | Run 前保留宿主重检，成功后把完全相同的 stored source path 投影给 Agent；删除外部来源复制。 |

## 变更前

### Source Attachment 选择与模型可见值

Camp 和 Single Chat 从触发用户 Message 加载 ordered `LocalAttachmentSourceRef[]`。当前 resolver 的完整相关
输入与输出语义为：

```text
resolve_source_attachments_for_run(source_refs, execution_root, run_tmp)
  → 每项检查 exists、host-readable、file | directory kind unchanged
  → canonicalize source 与 execution_root
  → source 位于 execution_root 内：返回 stored source_path
  → source 位于 execution_root 外：
      复制文件，或递归复制目录到 run_tmp/source-attachments
      目录含 nested symlink 或特殊节点时拒绝
      返回 Run-local copy path
```

Context builder 随后把 resolver 的有序结果追加到同一个字段：

```json
{
  "attachments": ["<stored source path or Run-local copy path>"]
}
```

因此 `CURRENT_INPUT.attachments` 的字段名、数组、顺序与省略规则稳定，但一个外部 Source Ref 的模型可见字符串
是副本路径；模型看到它时不能从字段本身区分 source、Managed、legacy 或临时副本。已接受 Message、数据库中的
Source Ref 与历史 ContextManifest 不因复制而改写。

### 隐私与失败

`sourcePath` 不进入 Renderer、公共消息或历史 View。execution root 内路径可能直接进入当前模型输入，外部路径则
由 Run-local path 替代。外部目录复制会预扫全部子项，并可在 Context 构造前因 symlink、特殊节点或复制失败而使
Run 失败。复制借用通用 Run Temp 生命周期，但不建立长期附件资产。

## 变更后

### Source Attachment 选择与模型可见值

Camp 和 Single Chat 仍从触发用户 Message 加载同一 ordered `LocalAttachmentSourceRef[]`。resolver 的完整相关
输入与输出语义替换为：

```text
resolve_source_attachments_for_run(source_refs)
  → 在现有 spawn_blocking 边界中逐项：
      fs::metadata(source_path)
      file 时 File::open(source_path)
      directory 时 fs::read_dir(source_path)
      检查 exists、host-readable、file | directory kind unchanged
  → 每项成功后原样返回 stored source_path
```

`fs::metadata` 继续跟随顶层 symlink。目录只打开 `read_dir`，不枚举子项；nested symlink、dangling symlink 和
特殊节点不会在 Context 前被检查或拒绝。resolver 不再接收 execution root 或 Run Temp，不 canonicalize、不创建
filesystem symlink、不复制文件或目录，也不创建 `run_tmp/source-attachments`。

Context builder 仍把 resolver 的有序结果追加到完全相同的字段：

```json
{
  "attachments": ["<exact stored source_path>"]
}
```

数组为空、非空、顺序、与 Managed/legacy attachment path 合并的位置以及外层 `CURRENT_INPUT` section 的发送条件
全部不变。唯一模型可见变化是：每个 Source Ref 现在无条件投影完全相同的 stored source path，workspace 内外不再
分流。

### 隐私与失败

`sourcePath` 的边界为 public/view-private、dispatch-visible：它仍不进入 Renderer、公共消息或历史 View，但会进入
目标 Run 的 `CURRENT_INPUT.attachments`，对 Runtime、Agent 可见，并可能随请求对模型 Provider 可见。

宿主重检失败仍在 Context 构造前传播现有 missing/unreadable/kind-changed 错误。宿主可读不保证 Runtime 可读，
Source Attachment 投影不改变 working directory、Runtime read roots 或 OS 权限。Runtime/OS 错误只在 Agent 实际
访问时由原生文件工具报告；Core 不增加 Runtime preflight、合成附件错误、重试、复制、上传、权限扩大或 fallback。
Agent 未访问路径时，不产生虚构的 Runtime-read failure。

## 明确不变

- Native Session Bootstrap、AgentRun Context Formatter、Context Delivery Profile、ContextManifest Evidence、
  `CURRENT_INPUT` JSON shape、section 顺序、选择预算与 omission evidence 均不升级。
- rendered payload 与其既有 digest 继续证明实际发送字节；不新增 Source Attachment receipt，也不改写历史 Manifest。
- Camp Attachment 从 v8 升至 [v9](../../contracts/camp-attachment-v9.md)，Single Chat 从 v3 升至
  [v4](../../contracts/single-chat-v4.md)。Prepared、Managed、Agent 与 legacy attachment 合同不变。
- 通用 Run Temp、Tool output、Runtime images、Evidence exclusion、`CampAttachmentRunAccess`、Managed/legacy root
  与 Runtime Adapter wire shape 不变。
- 不新增 delivery mode、Runtime capability 分流、external read roots、snapshot mode、配置开关、旧复制兼容或
  materialize/upload fallback。

## 迁移、失效与恢复

这是后续 Run 的 clean semantic cutover。数据库不迁移，既有 Source Refs 在下一次 resolution 直接采用新行为；
已经持久化的 ContextManifest、prepared Runtime input 与历史投递证据保持原值。无需使 Native Session Binding 失效，
因为变化位于每轮 Dynamic Context 的 attachment string，既有 formatter/profile/manifest 仍能如实冻结新 payload。

已确认的比较基线保持为 `aa8a56c27c71e2f077c97714071fa6420dff05e6`。最终集成与验证前，main 快进到
`cde7c12f405c11b197e1bbf7bad1d9f1aec032fe`；其中另行批准的 V1.58-D05 Runtime sandbox 变更不属于本次权限
工作。本 revision 没有新增或扩大 Runtime 权限，也没有因同步而恢复 Source Attachment 的复制或分流。

## 验证

- resolver 对文件、目录与顶层 symlink 返回逐字相同的 stored path；
- 含 dangling symlink 和 Unix special node 的目录通过 resolution，证明无递归预扫；
- missing、unreadable 和 kind-changed 的现有宿主重检仍生效；
- Camp 与 Single Chat 共用单参数 resolver，Context builder 直接接收其返回值；
- 代码中不存在 Source Attachment 的 `source-attachments` 创建、递归 copy 或 execution-root 分流；
- Rust 定向测试、Core all-target check、格式化及文档治理门禁通过。

2026-09-12 的最终工作区验证结果：resolver 定向测试 5 项、Single Chat 定向测试 1 项、Camp slow test 1 项通过；
`rovai-core` lib 553 项全部通过，Main 236 项通过且 5 项既有 manual smoke ignored；all-targets check、零警告
Clippy、格式化、diff 检查及三道文档治理命令均通过。
